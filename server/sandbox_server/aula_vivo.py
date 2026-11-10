"""El aula en vivo (versión empresa, en el maestro): lo que pasa entre las PCs mientras corre un trabajo.

Cada 2 s el maestro toma una muestra, sin tocar las PCs:

- **Tráfico.** La red es una estrella: todo lo que va de una PC a otra pasa por el `wg0` del maestro.
  - `wg show wg0 dump` da los bytes de cada PC con el hub: el tráfico por PC, siempre.
  - Si está `nft`, unos contadores en el maestro dan la matriz PC a PC y para qué. Los sets son dinámicos,
    con una entrada por par que aparece, en la tabla `inet aula_trafico`:
      - bloques de HDFS: 9866/9867;
      - shuffle de MapReduce: 13562;
      - YARN: 8030 a 8042 y 10020.
    Si `nft` no está o no se puede, el tráfico queda por PC y lo dice.
- **HDFS**: los bloques con copias de menos (`UnderReplicatedBlocks`) y los que se están copiando
  (`PendingReplicationBlocks`), del JMX del NameNode que el servidor ya lee.
- **YARN en vivo**: los contenedores de cada PC y de qué trabajo son, de `/ws/v1/node/containers` de cada NodeManager
  (por el túnel, cada 6 s).
- **Caídas**: cuando una PC pasa de arriba a sin respuesta o caída, empieza una línea de tiempo (la lámpara, los
  bloques con copias de menos y en copia, los contenedores que tenía) que cierra con un resumen: cuántos contenedores
  se perdieron, cuántos bloques se re-copiaron y en cuánto tiempo.

Se guardan los últimos 10 minutos (300 muestras). Todo lo que calcula es función pura de las muestras: las pruebas
arman muestras a mano.
"""
from __future__ import annotations

import asyncio
import json
import re
import shutil
import subprocess
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor

from . import probes

CADA_S = 2.0
MUESTRAS = 300                    # 10 minutos
TECHO_MBPS = 50                   # lo que midió la sonda por PC (D-03)
MAESTRO_IP = "10.13.0.1"
_IP_PC = re.compile(r"^10\.13\.0\.(\d+)$")
_CONT = re.compile(r"^container_(?:e\d+_)?(\d+)_(\d+)_(\d+)_(\d+)$")
CLASES = ("hdfs", "shuffle", "yarn")
PUERTOS = {"hdfs": "9866, 9867", "shuffle": "13562", "yarn": "8030-8033, 8040-8042, 10020"}
TABLA = "aula_trafico"


def nodo_de_ip(ip: str) -> str:
    """10.13.0.1 → maestro, 10.13.0.17 → pc07 (red.sh: pcNN = 10.13.0.(10+NN)); otra cosa queda como vino."""
    if ip == MAESTRO_IP:
        return "maestro"
    m = _IP_PC.match(ip or "")
    if m and int(m.group(1)) > 10:
        return f"pc{int(m.group(1)) - 10:02d}"
    return ip


# ---------------------------------------------------------------- nftables

def reglas_nft(iface: str = "wg0") -> str:
    """La tabla de contadores: un set dinámico por clase, con un contador por par (origen . destino).
    Mira lo que entra y sale por el túnel en el maestro: forward (PC → PC) e input/output (PC ↔ maestro)."""
    sets = "\n".join(f"  set {c} {{ type ipv4_addr . ipv4_addr; flags dynamic; counter; timeout 15m; }}"
                     for c in ("total", *CLASES))
    def reglas(cond: str) -> str:
        out = [f"    {cond} update @total {{ ip saddr . ip daddr }}"]
        for c in CLASES:
            for lado in ("dport", "sport"):
                out.append(f"    {cond} tcp {lado} {{ {PUERTOS[c]} }} update @{c} {{ ip saddr . ip daddr }}")
        return "\n".join(out)
    entra, sale = 'iifname "%s"' % iface, 'oifname "%s"' % iface
    return (f"table inet {TABLA} {{\n{sets}\n"
            f"  chain forward {{\n    type filter hook forward priority -5; policy accept;\n"
            f"{reglas(entra + ' ' + sale)}\n  }}\n"
            f"  chain input {{\n    type filter hook input priority -5; policy accept;\n{reglas(entra)}\n  }}\n"
            f"  chain output {{\n    type filter hook output priority -5; policy accept;\n{reglas(sale)}\n  }}\n"
            "}\n")


def leer_set_nft(doc: dict) -> dict[tuple[str, str], int]:
    """`nft -j list set inet aula_trafico <set>` → {(ip origen, ip destino): bytes}."""
    out: dict[tuple[str, str], int] = {}
    for item in (doc or {}).get("nftables", []):
        s = item.get("set") if isinstance(item, dict) else None
        if not s:
            continue
        for e in s.get("elem") or []:
            el = e.get("elem", e) if isinstance(e, dict) else {}
            val = el.get("val") if isinstance(el, dict) else None
            cont = (el.get("counter") or {}) if isinstance(el, dict) else {}
            par = (val or {}).get("concat") if isinstance(val, dict) else None
            if isinstance(par, list) and len(par) == 2:
                out[(str(par[0]), str(par[1]))] = out.get((str(par[0]), str(par[1])), 0) + int(cont.get("bytes", 0) or 0)
    return out


class Nft:
    """Los contadores por par en el maestro. Si no se pueden armar, `motivo` dice por qué y el tráfico queda por PC."""

    def __init__(self, iface: str = "wg0"):
        self.iface = iface
        self.listo = False
        self.motivo: str | None = None

    def preparar(self) -> bool:
        if self.listo:
            return True
        if not shutil.which("nft"):
            self.motivo = "falta nft en el maestro: el tráfico se ve por PC (wg), no por par"
            return False
        try:
            subprocess.run(["nft", "delete", "table", "inet", TABLA], capture_output=True, timeout=5)
            r = subprocess.run(["nft", "-f", "-"], input=reglas_nft(self.iface), capture_output=True, text=True, timeout=10)
        except (OSError, subprocess.SubprocessError) as e:
            self.motivo = f"nft no anduvo ({e}): el tráfico se ve por PC"
            return False
        if r.returncode != 0:
            self.motivo = f"nft no armó los contadores ({(r.stderr or '').strip()[:200]}): el tráfico se ve por PC"
            return False
        self.listo, self.motivo = True, None
        return True

    def leer(self) -> dict[str, dict[tuple[str, str], int]] | None:
        if not self.listo:
            return None
        out = {}
        for c in ("total", *CLASES):
            try:
                r = subprocess.run(["nft", "-j", "list", "set", "inet", TABLA, c], capture_output=True, text=True, timeout=5)
                out[c] = leer_set_nft(json.loads(r.stdout)) if r.returncode == 0 else {}
            except (OSError, subprocess.SubprocessError, ValueError):
                out[c] = {}
        return out


# ---------------------------------------------------------------- YARN en vivo

def app_de_contenedor(cid: str) -> tuple[str, bool] | None:
    """container_e03_1794289929080_0005_01_000001 → (application_1794289929080_0005, True si es el ApplicationMaster)."""
    m = _CONT.match(cid or "")
    if not m:
        return None
    return f"application_{m.group(1)}_{int(m.group(2)):04d}", int(m.group(4)) == 1


def contenedores_de_nm(doc: dict | None) -> list[dict]:
    """/ws/v1/node/containers → [{app, am}] de los que están corriendo."""
    out = []
    for c in ((doc or {}).get("containers") or {}).get("container") or []:
        if c.get("state") not in (None, "RUNNING", "NEW", "LOCALIZING"):
            continue
        a = app_de_contenedor(c.get("id", ""))
        if a:
            out.append({"app": a[0], "am": a[1]})
    return out


def apps_por_pc(conts: list[dict]) -> list[dict]:
    """[{app, am}] → [{app, n, am}] (cuántos contenedores de cada trabajo y si tiene el ApplicationMaster)."""
    por: dict[str, dict] = {}
    for c in conts:
        x = por.setdefault(c["app"], {"app": c["app"], "n": 0, "am": False})
        x["n"] += 1
        x["am"] = x["am"] or c["am"]
    return sorted(por.values(), key=lambda x: x["app"])


# ---------------------------------------------------------------- muestras

def muestra(t: float, estado: dict, nft: dict | None, jmx: dict | None, conts: dict[str, list[dict]]) -> dict:
    """Una muestra: lo mínimo para el tráfico, la línea de tiempo y YARN en vivo (estado es lo de aula.armar)."""
    fsn = probes.jmx_beans(jmx or {}).get("Hadoop:service=NameNode,name=FSNamesystem", {})
    pub = {}
    pcs = {}
    for p in estado.get("pcs", []):
        t_ = (p.get("tunel") or {})
        pcs[p["nodo"]] = {"estado": p["estado"], "ip": p.get("ipTunel"),
                          "contenedores": (p.get("nodemanager") or {}).get("contenedores", 0),
                          "usadoMb": (p.get("datanode") or {}).get("usadoMb"),
                          "rxMb": t_.get("rxMb"), "txMb": t_.get("txMb")}
        pub[p["nodo"]] = p
    return {
        "t": t,
        "pcs": pcs,
        "hdfs": {"sub": int(fsn.get("UnderReplicatedBlocks", 0) or 0), "pend": int(fsn.get("PendingReplicationBlocks", 0) or 0),
                 "perdidos": int(fsn.get("MissingBlocks", 0) or 0)},
        "pares": nft,
        "apps": {n: apps_por_pc(c) for n, c in conts.items()},
    }


def _mbps(delta_bytes: float, dt: float) -> float:
    return round(max(0.0, delta_bytes) * 8 / dt / 1e6, 3) if dt > 0 else 0.0


def trafico(muestras: list[dict], desde_ms: int | None = None, fuente: str = "wg", motivo: str | None = None) -> dict:
    """Las tasas entre muestras seguidas: por PC (con el hub, de wg) y por par y clase (de nft, si hay).
    {fuente, motivo, techoMbps, serie: [{t, total, pcs: {nodo: {rx, tx}}}], pares: [{de, a, mbps, clases}], porPc}"""
    serie = []
    pares_ult: list[dict] = []
    for a, b in zip(muestras, muestras[1:]):
        dt = b["t"] - a["t"]
        if dt <= 0:
            continue
        pcs = {}
        for n, x in b["pcs"].items():
            y = a["pcs"].get(n) or {}
            if x.get("rxMb") is None or y.get("rxMb") is None:
                continue
            # rx/tx de wg son vistos desde el hub: rx = lo que la PC mandó, tx = lo que recibió
            pcs[n] = {"manda": _mbps((x["rxMb"] - y["rxMb"]) * 1024 * 1024, dt),
                      "recibe": _mbps((x["txMb"] - y["txMb"]) * 1024 * 1024, dt)}
        pares = []
        if a.get("pares") and b.get("pares"):
            tot_a, tot_b = a["pares"].get("total", {}), b["pares"].get("total", {})
            for par, bytes_b in tot_b.items():
                d = bytes_b - tot_a.get(par, 0)
                if d <= 0:
                    continue
                clases = {c: _mbps(b["pares"].get(c, {}).get(par, 0) - a["pares"].get(c, {}).get(par, 0), dt) for c in CLASES}
                total = _mbps(d, dt)
                clases["otro"] = round(max(0.0, total - sum(clases.values())), 3)
                pares.append({"de": nodo_de_ip(par[0]), "a": nodo_de_ip(par[1]), "mbps": total, "clases": clases})
        pares.sort(key=lambda p: -p["mbps"])
        t_ms = int(b["t"] * 1000)
        if desde_ms is None or t_ms > desde_ms:
            serie.append({"t": t_ms, "total": round(sum(p["manda"] for p in pcs.values()), 3), "pcs": pcs})
        pares_ult = pares
    ult = serie[-1]["pcs"] if serie else {}
    return {"fuente": fuente, "motivo": motivo, "techoMbps": TECHO_MBPS, "cadaS": CADA_S, "serie": serie[-MUESTRAS:],
            "pares": pares_ult[:40],
            "porPc": sorted(({"nodo": n, **v, "usoTecho": round(max(v["manda"], v["recibe"]) / TECHO_MBPS, 3)}
                             for n, v in ult.items()), key=lambda x: -(x["manda"] + x["recibe"]))}


CAIDO = ("sin-respuesta", "caida")


def caidas(muestras: list[dict]) -> list[dict]:
    """Cada vez que una PC deja de estar arriba: la línea de tiempo desde ese momento y el resumen.
    [{nodo, desde, hasta, abierta, serie: [{s, estado, sub, pend, contenedores}], resumen}] (la más nueva primero)."""
    out = []
    abiertas: dict[str, dict] = {}
    previo: dict[str, str] = {}
    for m in muestras:
        for n, x in m["pcs"].items():
            e, antes = x["estado"], previo.get(n)
            if n not in abiertas and antes == "arriba" and e in CAIDO:
                # Lo que tenía justo antes de caerse
                ult = next((mm["pcs"][n] for mm in reversed(muestras) if mm["t"] < m["t"] and n in mm["pcs"]
                            and mm["pcs"][n]["estado"] == "arriba"), x)
                abiertas[n] = {"nodo": n, "desde": int(m["t"] * 1000), "hasta": None, "abierta": True, "serie": [],
                               "_cont": ult.get("contenedores", 0) or 0, "_mb": ult.get("usadoMb"), "_t0": m["t"]}
            if n in abiertas:
                c = abiertas[n]
                c["serie"].append({"s": round(m["t"] - c["_t0"], 1), "estado": e, "sub": m["hdfs"]["sub"],
                                   "pend": m["hdfs"]["pend"], "contenedores": x.get("contenedores", 0)})
                # Cierra cuando la PC volvió, o cuando ya está caída y HDFS terminó de copiar
                volvio = e == "arriba"
                copiado = e == "caida" and len(c["serie"]) > 3 and m["hdfs"]["sub"] == 0 and m["hdfs"]["pend"] == 0
                if volvio or copiado:
                    c["hasta"], c["abierta"] = int(m["t"] * 1000), False
                    out.append(_cerrar(c, "volvió" if volvio else "HDFS terminó de copiar"))
                    del abiertas[n]
            previo[n] = e
    for c in abiertas.values():
        out.append(_cerrar(c, None))
    return sorted(out, key=lambda c: -c["desde"])[:20]


def _cerrar(c: dict, como: str | None) -> dict:
    s = c["serie"]
    pico = max((x["sub"] for x in s), default=0)
    hasta_roja = next((x["s"] for x in s if x["estado"] == "caida"), None)
    sin_sub = next((x["s"] for x in s if hasta_roja is not None and x["s"] >= hasta_roja and x["sub"] == 0 and x["pend"] == 0), None)
    res = {"contenedoresPerdidos": c["_cont"], "bloquesRecopiados": pico, "mbRecopiados": c["_mb"],
           "rojaALosS": hasta_roja, "copiadoALosS": sin_sub, "duracionS": s[-1]["s"] if s else 0, "cierre": como}
    partes = [f"{c['nodo']} dejó de contestar"]
    if hasta_roja is not None:
        partes.append(f"el NameNode la dio por muerta a los {hasta_roja:.0f} s")
    if c["_cont"]:
        partes.append(f"se perdieron {c['_cont']} contenedores (YARN reintenta sus tareas en otras PCs)")
    if pico:
        txt = f"HDFS re-copió {pico} bloques"
        if c["_mb"]:
            txt += f" (~{c['_mb']:.0f} MB)"
        if sin_sub is not None:
            txt += f" en {sin_sub - (hasta_roja or 0):.0f} s"
        partes.append(txt)
    if como == "volvió":
        partes.append(f"volvió a los {res['duracionS']:.0f} s")
    res["texto"] = "; ".join(partes) + "."
    return {k: v for k, v in c.items() if not k.startswith("_")} | {"resumen": res}


class Muestreador:
    """Toma una muestra cada 2 s mientras haya alguien mirando (se apaga solo si nadie pide nada por 2 min)."""

    def __init__(self, aula, nft: Nft | None = None):
        self.aula = aula
        self.nft = nft or Nft()
        self.muestras: deque[dict] = deque(maxlen=MUESTRAS)
        self._tarea: asyncio.Task | None = None
        self._pedido = 0.0
        self._conts: dict[str, list[dict]] = {}
        self._conts_t = 0.0
        self._pool = ThreadPoolExecutor(max_workers=8)

    def tocar(self) -> None:
        self._pedido = time.monotonic()
        if self._tarea is None or self._tarea.done():
            self._tarea = asyncio.get_running_loop().create_task(self._correr())

    async def _correr(self) -> None:
        if self.aula.modo and self.aula.modo["red"] == "wireguard" and self.aula.c.s.probe:
            await asyncio.to_thread(self.nft.preparar)
        while time.monotonic() - self._pedido < 120:
            try:
                await asyncio.to_thread(self.tomar)
            except Exception:  # noqa: BLE001 - una muestra que falla no corta el muestreo
                pass
            await asyncio.sleep(CADA_S)

    def _contenedores(self, rm: dict | None) -> dict[str, list[dict]]:
        if time.monotonic() - self._conts_t < 6 or not self.aula.c.s.probe:
            return self._conts
        nodos = [((n.get("nodeHostName") or "").split(".")[0], n.get("nodeHTTPAddress"))
                 for n in ((rm or {}).get("nodes") or {}).get("node") or [] if n.get("state") == "RUNNING"]
        def uno(par):
            host, addr = par
            doc = probes.get_json(f"http://{addr}/ws/v1/node/containers", timeout=1.5) if addr else None
            return host, contenedores_de_nm(doc)
        self._conts = dict(self._pool.map(uno, nodos))
        self._conts_t = time.monotonic()
        return self._conts

    def tomar(self) -> dict:
        estado = self.aula.estado_sync()
        rm = self.aula._rm_nodes()   # noqa: SLF001 - el mismo cache de 1,5 s
        m = muestra(time.time(), estado, self.nft.leer(), self.aula.c.nn_jmx, self._contenedores(rm))
        self.muestras.append(m)
        return m

    def trafico(self, desde_ms: int | None) -> dict:
        fuente = "nft" if self.nft.listo else "wg" if self.aula.modo and self.aula.modo["red"] == "wireguard" else "ninguna"
        motivo = self.nft.motivo if fuente != "nft" else None
        if fuente == "ninguna":
            motivo = "aula simulada (RED=docker): no hay túnel que medir"
        return trafico(list(self.muestras), desde_ms, fuente, motivo)

    def caidas(self) -> list[dict]:
        return caidas(list(self.muestras))

    def apps(self) -> dict[str, list[dict]]:
        return self.muestras[-1]["apps"] if self.muestras else {}
