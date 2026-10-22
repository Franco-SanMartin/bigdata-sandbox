"""Humo completo de la versión full, contra la imagen de verdad (Hadoop real).

Lo corre el CI (.github/workflows/full.yml) contra la imagen recién armada. Va
contra un servidor ya levantado y solo usa la biblioteca estándar:

    docker run -d --name humo -p 8080:8080 franki678/bigdata-sandbox:full
    HUMO_CONTENEDOR=humo python3 server/tests/humo/humo_full.py

Es "blando": cada chequeo anota si dio bien, cuánto tardó y qué vio, y sigue
con el próximo aunque falle. Al final escribe todo en HUMO_SALIDAS
(humo-salidas/ de fábrica):

    resumen.md, resumen.json   cada chequeo con su resultado y su tiempo
    api/*.json                 lo que contestó el servidor
    crudas/*                   salidas reales de Hadoop, Hive, MariaDB y MongoDB
                               (con docker exec, si está HUMO_CONTENEDOR), con
                               los mismos nombres que tests/fixtures

Termina con código 1 si falló algún chequeo.

Hace dos arranques:
  1. Solo HDFS, 2 DataNodes: YARN tiene que dar service_down; subida, put
     terminado, fsck, replicación y DataNodes apagados y prendidos.
  2. Todo (YARN, Hive, MySQL, MongoDB): trabajos de YARN, el pipeline completo
     y sus variantes, Datos y Machine Learning.
"""
import json
import os
import subprocess
import sys
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

URL = os.environ.get("SANDBOX_URL", "http://localhost:8080").rstrip("/")
CONT = os.environ.get("HUMO_CONTENEDOR", "")
SALIDAS = Path(os.environ.get("HUMO_SALIDAS", "humo-salidas"))
ARRANQUE = float(os.environ.get("HUMO_TIMEOUT", "900"))

SOLO_HDFS = {"datanodes": 2, "replication": 2, "blockSize": "1m", "namenodes": 1, "services": "hdfs",
             "mongodb": False, "jupyter": False, "pigHeapsize": 512}
TODO = {"datanodes": 2, "replication": 2, "blockSize": "128m", "namenodes": 1, "services": "todo",
        "mongodb": True, "jupyter": False, "pigHeapsize": 512}

RESULTADOS: list[dict] = []
TIEMPOS: dict[str, float] = {}


# ---------------------------------------------------------------- utilidades

class Chequeo:
    """with Chequeo("nombre") as c: ...  — anota ok/falla, tiempo y c.detalle."""

    def __init__(self, nombre: str):
        self.nombre = nombre
        self.detalle = ""

    def __enter__(self):
        self.t0 = time.time()
        print(f"--> {self.nombre}", flush=True)
        return self

    def __exit__(self, tipo, valor, tb):
        seg = round(time.time() - self.t0, 1)
        ok = tipo is None
        error = "" if ok else "".join(traceback.format_exception_only(tipo, valor)).strip()[-1500:]
        RESULTADOS.append({"nombre": self.nombre, "ok": ok, "segundos": seg, "detalle": self.detalle, "error": error})
        print(f"    {'ok' if ok else 'FALLA'} ({seg} s) {self.detalle} {error}", flush=True)
        return True


def pedir(metodo, ruta, cuerpo=None, timeout=30):
    datos = None if cuerpo is None else json.dumps(cuerpo).encode()
    req = urllib.request.Request(URL + ruta, data=datos, method=metodo, headers={"content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            texto = r.read().decode()
            return r.status, (json.loads(texto) if texto and "json" in r.headers.get("content-type", "") else texto)
    except urllib.error.HTTPError as e:
        texto = e.read().decode()
        try:
            return e.code, json.loads(texto)
        except ValueError:
            return e.code, texto


def q(v: str) -> str:
    return urllib.parse.quote(v, safe="/")


def guardar(nombre: str, obj) -> None:
    p = SALIDAS / "api" / f"{nombre}.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")


def en_contenedor(cmd: str, timeout: int = 300) -> tuple[int, str, str]:
    if not CONT:
        return 127, "", "sin HUMO_CONTENEDOR"
    try:
        p = subprocess.run(["docker", "exec", CONT, "bash", "-c", cmd], capture_output=True, text=True, timeout=timeout)
        return p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired:
        return 124, "", f"tardó más de {timeout} s"


def capturar(nombre: str, cmd: str, timeout: int = 300, juntar: bool = False) -> str:
    """Corre cmd adentro del contenedor y guarda la salida en crudas/<nombre>."""
    rc, out, err = en_contenedor(cmd, timeout)
    p = SALIDAS / "crudas" / nombre
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(out + err if juntar else out)
    if err and not juntar:
        p.with_name(nombre + ".stderr").write_text(err)
    (SALIDAS / "crudas" / "comandos.txt").open("a").write(f"{nombre}: {cmd} (rc={rc})\n")
    return out + err


def curl(nombre: str, url: str) -> None:
    capturar(nombre, f"curl -s --max-time 20 {json.dumps(url)}")


def estado():
    return pedir("GET", "/api/status")[1]


def esperar(cond, segundos, que, cada=2.0):
    fin = time.time() + segundos
    ultimo = None
    while time.time() < fin:
        try:
            ultimo = cond()
        except Exception as e:  # el servidor puede tardar en contestar mientras arranca
            ultimo = None
            print(f"    (esperando {que}: {e})", flush=True)
        if ultimo:
            return ultimo
        time.sleep(cada)
    raise AssertionError(f"no llegó a {que} en {segundos:g} s")


def procesos():
    return {p["id"]: p["state"] for p in estado()["processes"]}


# ---------------------------------------------------------------- eventos SSE

EVENTOS: list[tuple[float, str, dict]] = []


def escuchar():
    while True:
        try:
            with urllib.request.urlopen(URL + "/api/events", timeout=600) as r:
                tipo = None
                for linea in r:
                    linea = linea.decode().rstrip("\n")
                    if linea.startswith("event: "):
                        tipo = linea[7:]
                    elif linea.startswith("data: ") and tipo:
                        try:
                            EVENTOS.append((time.time(), tipo, json.loads(linea[6:])))
                        except ValueError:
                            pass
                        tipo = None
        except Exception:
            time.sleep(1)


def eventos(tipo: str, desde: float) -> list[dict]:
    return [d for t, k, d in EVENTOS if k == tipo and t >= desde]


# ---------------------------------------------------------------- arranque

def arrancar(config: dict, nombre: str) -> None:
    with Chequeo(f"arranque {nombre}") as c:
        codigo, r = pedir("POST", "/api/cluster/start", {"config": config})
        assert codigo == 202, (codigo, r)
        t0 = time.time()

        def listo():
            s = estado()
            if s["phase"] == "stopped" and s.get("boot") and any(p["state"] == "failed" for p in s["boot"]["steps"]):
                f = next(p for p in s["boot"]["steps"] if p["state"] == "failed")
                raise SystemExit(f"el arranque falló en '{f['name']}': {f['log'][-8:]}")
            return s if s["phase"] == "running" else None
        try:
            s = esperar(listo, ARRANQUE, "running", 3)
        except SystemExit as e:
            raise AssertionError(str(e)) from None
        TIEMPOS[f"arranque {nombre}"] = round(time.time() - t0, 1)
        guardar(f"status_{nombre}", s)
        pasos = [(p["name"], p["state"], round(((p.get("finishedAt") or 0) - (p.get("startedAt") or 0)) / 1000, 1))
                 for p in s["boot"]["steps"]]
        c.detalle = f"{TIEMPOS[f'arranque {nombre}']} s; pasos: {pasos}"
        assert all(p["state"] in ("done", "skipped") for p in s["boot"]["steps"])


def apagar(nombre: str) -> None:
    with Chequeo(f"apagado {nombre}") as c:
        t0 = time.time()
        codigo, _ = pedir("POST", "/api/cluster/stop")
        assert codigo == 202
        s = esperar(lambda: (lambda s: s if s["phase"] == "stopped" else None)(estado()), 120, "stopped")
        TIEMPOS[f"apagado {nombre}"] = round(time.time() - t0, 1)
        vivos = [p["id"] for p in s["processes"] if p["id"] != "ui" and p["state"] == "up"]
        rc, out, _ = en_contenedor("pgrep -a java | cut -c1-160; pgrep -a 'mysqld|mariadbd|mongod'")
        _, act = pedir("GET", "/api/activity?limit=15")
        guardar(f"activity_apagado_{nombre}", act)
        pasos = [(a.get("title"), a.get("output")) for a in (act if isinstance(act, list) else act.get("entries", []))
                 if a.get("source") == "Cluster"][-6:]
        c.detalle = f"{TIEMPOS[f'apagado {nombre}']} s; vivos según el estado: {vivos}; actividad: {pasos}"
        assert not vivos
        assert not out.strip(), out


# ---------------------------------------------------------------- 1. solo HDFS

def solo_hdfs() -> None:
    with Chequeo("el servidor contesta enseguida y SSE saluda") as c:
        t0 = time.time()
        s = estado()
        c.detalle = f"{round(time.time() - t0, 2)} s, fase {s['phase']}"
        assert time.time() - t0 < 1.5 and s["phase"] == "stopped"
        with urllib.request.urlopen(URL + "/api/events", timeout=10) as r:
            assert r.headers["content-type"].startswith("text/event-stream")
            assert r.readline() == b": conectado\n"

    with Chequeo("compose de la versión full") as c:
        codigo, y = pedir("POST", "/api/config/compose", {"config": SOLO_HDFS})
        assert codigo == 200 and "bigdata-sandbox:full" in y and 'AUTOSTART: "1"' in y and "stop_grace_period: 20s" in y

    with Chequeo("sin la interfaz, / contesta igual") as c:
        codigo, html = pedir("GET", "/")
        c.detalle = f"{codigo}"
        assert codigo == 200

    arrancar(SOLO_HDFS, "solo-hdfs")
    with Chequeo("NameNode y 2 DataNodes arriba") as c:
        esperar(lambda: (lambda p, s: p.get("nn1") == "up" and p.get("dn1") == "up" and p.get("dn2") == "up"
                         and (s["hdfs"] or {}).get("liveDataNodes", 0) >= 2)(procesos(), estado()), 180, "dn1 y dn2")

    with Chequeo("YARN con solo HDFS: service_down") as c:
        r1 = pedir("GET", "/api/yarn/cluster")
        r2 = pedir("GET", "/api/yarn/apps")
        r3 = pedir("POST", "/api/yarn/apps", {"example": "mr-ventas"})
        c.detalle = str([(x[0], x[1].get("code") if isinstance(x[1], dict) else x[1]) for x in (r1, r2, r3)])
        assert all(x[0] == 503 and x[1]["code"] == "service_down" for x in (r1, r2, r3))

    carpeta = "/user/root/humo"
    archivo = carpeta + "/humo.csv"
    with Chequeo("mkdir y subida multipart (2 bloques, replicación 2)") as c:
        codigo, r = pedir("POST", "/api/hdfs/mkdir", {"path": carpeta})
        assert codigo == 200 and r["state"] == "done", r
        filas = "".join(f"{i},producto{i % 7},{i % 5}\n" for i in range(60000)).encode()
        codigo, r = subir(carpeta, "humo.csv", b"id,producto,cantidad\n" + filas, blockSize="1m")
        assert codigo == 202, r
        t0 = time.time()
        ent = esperar(lambda: put_terminado(carpeta), 120, "put terminado", 0.5)
        c.detalle = f"put terminado en {round(time.time() - t0, 1)} s"
        e = next(x for x in ent if x["name"] == "humo.csv")
        assert e["blocks"] == 2 and e["replication"] == 2, e

    with Chequeo("ls, file y fsck de la carpeta") as c:
        codigo, ls = pedir("GET", "/api/hdfs/ls?path=" + q(carpeta))
        guardar("hdfs_ls", ls)
        codigo, d = pedir("GET", "/api/hdfs/file?path=" + q(archivo))
        guardar("hdfs_file", d)
        assert codigo == 200 and d["preview"]["columns"] == ["id", "producto", "cantidad"], d
        assert len(d["blocks"]) == 2 and all(sorted(b["locations"]) == [1, 2] for b in d["blocks"]), d["blocks"]
        codigo, f = pedir("GET", "/api/hdfs/fsck?path=" + q(carpeta), timeout=60)
        guardar("hdfs_fsck", f)
        assert codigo == 200 and f["healthy"] and f["files"] == 1 and f["blocks"] == 2, f
        codigo, files = pedir("GET", "/api/hdfs/files")
        guardar("hdfs_files", files)
        assert any(x["path"] == archivo for x in files)

    with Chequeo("capturas de HDFS (fsck, dfsadmin, jps, JMX, WebHDFS)") as c:
        capturar("fsck.txt", "hdfs fsck / -files -blocks -locations")
        capturar("dfsadmin_report.txt", "hdfs dfsadmin -report")
        capturar("jps.txt", "jps -l")
        capturar("nn_jmx.json", "for n in FSNamesystemState FSNamesystem NameNodeInfo; do "
                                "curl -s 'http://localhost:9870/jmx?qry=Hadoop:service=NameNode,name='$n; echo; done")
        curl("nn_status_active.json", "http://localhost:9870/jmx?qry=Hadoop:service=NameNode,name=NameNodeStatus")
        curl("webhdfs_ls_raiz.json", "http://localhost:9870/webhdfs/v1/?op=LISTSTATUS")
        curl("webhdfs_ls_user_root.json", "http://localhost:9870/webhdfs/v1/user/root?op=LISTSTATUS")
        curl("webhdfs_status_archivo.json", f"http://localhost:9870/webhdfs/v1{archivo}?op=GETFILESTATUS")
        curl("webhdfs_status_dir.json", f"http://localhost:9870/webhdfs/v1{carpeta}?op=GETFILESTATUS")
        curl("webhdfs_contentsummary.json", f"http://localhost:9870/webhdfs/v1{carpeta}?op=GETCONTENTSUMMARY")
        curl("webhdfs_404.json", "http://localhost:9870/webhdfs/v1/no/existe?op=GETFILESTATUS")

    with Chequeo("put terminado = no quedan archivos writing (archivo grande)") as c:
        en_contenedor("head -c 300M /dev/urandom > /tmp/grande.bin")
        en_contenedor(f"nohup hdfs dfs -D dfs.blocksize=1m -put -f /tmp/grande.bin {carpeta}/ > /tmp/put.log 2>&1 &")
        visto = False
        for _ in range(60):
            out = capturar("fsck_escribiendo.txt", "hdfs fsck / -files -blocks -locations -openforwrite")
            if "OPENFORWRITE" in out:
                visto = True
                curl("webhdfs_ls_humo_escribiendo.json", f"http://localhost:9870/webhdfs/v1{carpeta}?op=LISTSTATUS")
                _, ls = pedir("GET", "/api/hdfs/ls?path=" + q(carpeta))
                guardar("hdfs_ls_escribiendo", ls)
                break
            time.sleep(0.5)
        t0 = time.time()
        esperar(lambda: put_terminado(carpeta) and "grande.bin" in [x["name"] for x in put_terminado(carpeta)],
                300, "sin writing", 1)
        t_ls = round(time.time() - t0, 1)
        # Lo que dice HDFS en ese mismo momento: -put cierra el archivo (espera el ack de
        # todos los bloques) y recién ahí lo renombra; la JVM de FsShell tarda un poco más en salir
        _, ls = pedir("GET", "/api/hdfs/ls?path=" + q(carpeta))
        _, st, _ = en_contenedor(f"curl -s 'http://localhost:9870/webhdfs/v1{carpeta}/grande.bin?op=GETFILESTATUS'")
        _, abiertos, _ = en_contenedor(f"hdfs fsck {carpeta} -openforwrite 2>/dev/null | grep -c OPENFORWRITE")
        try:
            bytes_hdfs = json.loads(st)["FileStatus"]["length"]
        except (ValueError, KeyError):
            bytes_hdfs = None
        largo = next((x.get("sizeMb") for x in ls["entries"] if x["name"] == "grande.bin"), None)
        # [F]sShell: que pgrep no se encuentre a sí mismo (el bash -c lo lleva en la línea)
        fin = esperar(lambda: "sin-put" in en_contenedor("pgrep -f '[F]sShell' || echo sin-put")[1] or None,
                      60, "fin del -put", 0.5)
        _, log, _ = en_contenedor("cat /tmp/put.log")
        c.detalle = (f"OPENFORWRITE visto: {visto}; el ls dijo terminado a los {t_ls} s y el proceso -put salió "
                     f"{round(time.time() - t0 - t_ls, 1)} s después; grande.bin {largo} MB ({bytes_hdfs} bytes), "
                     f"abiertos: {abiertos.strip()}; estados: {[(x['name'], x.get('state')) for x in ls['entries']]}; "
                     f"log: {log.strip()[-200:]}")
        assert visto and fin
        assert bytes_hdfs == 300 * 1024 * 1024, "el ls dijo terminado pero grande.bin no tiene los 300 MB"
        assert abiertos.strip() == "0", "el ls dijo terminado pero el fsck lo tiene abierto"
        assert "Exception" not in log and "put:" not in log, "el -put dejó errores"

    with Chequeo("replicación: setrep 1 y de vuelta a 2") as c:
        codigo, r = pedir("PATCH", "/api/hdfs/files", {"path": archivo, "replication": 1}, timeout=120)
        assert codigo == 204, (codigo, r)
        codigo, rep = pedir("GET", "/api/hdfs/replication")
        guardar("hdfs_replication", rep)
        codigo, r = pedir("PATCH", "/api/hdfs/files", {"path": archivo, "replication": 2}, timeout=120)
        assert codigo == 204, (codigo, r)
        esperar(lambda: all(sorted(b["locations"]) == [1, 2]
                            for b in pedir("GET", "/api/hdfs/file?path=" + q(archivo))[1]["blocks"]), 120, "2 copias")

    with Chequeo("apagar dn2: el NameNode lo da por muerto y los bloques lo marcan stale") as c:
        t0 = time.time()
        codigo, r = pedir("POST", "/api/processes/dn2/stop")
        assert codigo == 202, r
        esperar(lambda: pedir("GET", f"/api/actions/{r['id']}")[1]["state"] != "running", 60, "acción")
        dns = esperar(lambda: (lambda d: d if any(x["id"] == 2 and x["state"] == "dead" for x in d) else None)(
            pedir("GET", "/api/hdfs/datanodes")[1]), 180, "dn2 dead")
        guardar("hdfs_datanodes_dn2_muerto", dns)
        muerto = round(time.time() - t0, 1)
        TIEMPOS["DataNode muerto para el NameNode"] = muerto

        def con_stale():
            _, d = pedir("GET", "/api/hdfs/file?path=" + q(archivo))
            _, files = pedir("GET", "/api/hdfs/files")
            f = next(x for x in files if x["path"] == archivo)
            listo = all(b.get("stale") == [2] and 2 not in b["locations"] for b in d["blocks"] + f["blocks"])
            return (d, f) if listo else None
        try:
            d, f = esperar(con_stale, 60, "stale [2]", 2)
        except AssertionError:
            _, d = pedir("GET", "/api/hdfs/file?path=" + q(archivo))
            _, files = pedir("GET", "/api/hdfs/files")
            f = next(x for x in files if x["path"] == archivo)
        guardar("hdfs_file_dn2_muerto", d)
        c.detalle = f"dead a los {muerto} s; detail stale {[b.get('stale') for b in d['blocks']]}; " \
                    f"files stale {[b.get('stale') for b in f['blocks']]}"
        capturar("nn_jmx_dn_muerto.json", "curl -s 'http://localhost:9870/jmx?qry=Hadoop:service=NameNode,name=NameNodeInfo'")
        capturar("fsck_dn_muerto.txt", "hdfs fsck / -files -blocks -locations -openforwrite")
        capturar("dfsadmin_report_dn_muerto.txt", "hdfs dfsadmin -report")
        assert all(b.get("stale") == [2] for b in d["blocks"]), d["blocks"]
        assert all(b.get("stale") == [2] for b in f["blocks"]), f["blocks"]

    with Chequeo("prender dn2 de nuevo") as c:
        t0 = time.time()
        codigo, r = pedir("POST", "/api/processes/dn2/start")
        assert codigo == 202, r
        esperar(lambda: any(x["id"] == 2 and x["state"] == "live" for x in pedir("GET", "/api/hdfs/datanodes")[1]),
                180, "dn2 live")
        c.detalle = f"live a los {round(time.time() - t0, 1)} s"

    with Chequeo("borrar la carpeta") as c:
        codigo, r = pedir("DELETE", f"/api/hdfs/files?path={q(carpeta)}&recursive=1", timeout=120)
        assert codigo == 200 and r["state"] == "done", r
        codigo, r = pedir("GET", "/api/hdfs/ls?path=" + q(carpeta))
        assert codigo == 404 and r["code"] == "not_found", r

    apagar("solo-hdfs")


def put_terminado(carpeta: str):
    """Lo que hace la interfaz: el put terminó cuando no queda nada 'writing' en la carpeta."""
    codigo, ls = pedir("GET", "/api/hdfs/ls?path=" + q(carpeta))
    if codigo != 200 or not ls["entries"] or any(e.get("state") == "writing" for e in ls["entries"]):
        return None
    return ls["entries"]


def subir(destino, nombre, contenido: bytes, **campos):
    borde = "humo" + str(time.time_ns())
    partes = [f'--{borde}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
              for k, v in {"dest": destino, **campos}.items()]
    partes.append(f'--{borde}\r\nContent-Disposition: form-data; name="file"; filename="{nombre}"\r\n'
                  f"Content-Type: application/octet-stream\r\n\r\n".encode() + contenido + b"\r\n")
    partes.append(f"--{borde}--\r\n".encode())
    req = urllib.request.Request(URL + "/api/hdfs/upload", data=b"".join(partes), method="POST",
                                 headers={"content-type": f"multipart/form-data; boundary={borde}"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


# ---------------------------------------------------------------- 2. todo

def esperar_app(app_id: str, segundos=600) -> dict:
    return esperar(lambda: (lambda d: d if d.get("state") in ("FINISHED", "FAILED", "KILLED") else None)(
        pedir("GET", f"/api/yarn/apps/{app_id}")[1]), segundos, f"{app_id} terminado", 3)


def yarn() -> None:
    with Chequeo("YARN: cluster y apps") as c:
        codigo, cl = pedir("GET", "/api/yarn/cluster")
        guardar("yarn_cluster", cl)
        assert codigo == 200, cl
        codigo, apps = pedir("GET", "/api/yarn/apps")
        assert codigo == 200, apps
        for n, u in (("rm_metrics.json", "ws/v1/cluster/metrics"), ("rm_nodes.json", "ws/v1/cluster/nodes"),
                     ("rm_scheduler.json", "ws/v1/cluster/scheduler"), ("rm_conf.xml", "conf?format=json")):
            curl(n, f"http://localhost:8088/{u}")

    ids = {}
    for ejemplo in ("mr-ventas", "spark-ventas", "hive-ventas"):
        with Chequeo(f"YARN: submit {ejemplo}") as c:
            t0 = time.time()
            codigo, r = pedir("POST", "/api/yarn/apps", {"example": ejemplo}, timeout=180)
            bloqueo = round(time.time() - t0, 1)
            assert codigo == 202, (codigo, r)
            app = r["id"]
            ids[ejemplo] = app
            if ejemplo == "mr-ventas":
                curl("nm_containers.json", "http://localhost:8042/ws/v1/node/containers")
            d = esperar_app(app)
            total = round(time.time() - t0, 1)
            TIEMPOS[f"YARN {ejemplo}"] = total
            guardar(f"yarn_app_{ejemplo}", d)
            c.detalle = f"{app}: POST bloqueó {bloqueo} s, terminó {d['state']} a los {total} s"
            assert d["state"] == "FINISHED", d.get("state")

    with Chequeo("YARN: capturas de RM, JobHistory, Spark History y yarn logs") as c:
        curl("rm_apps.json", "http://localhost:8088/ws/v1/cluster/apps")
        if "mr-ventas" in ids:
            a = ids["mr-ventas"]
            job = a.replace("application_", "job_")
            curl("rm_app_mr.json", f"http://localhost:8088/ws/v1/cluster/apps/{a}")
            curl("jhs_tasks.json", f"http://localhost:19888/ws/v1/history/mapreduce/jobs/{job}/tasks")
            curl("jhs_counters.json", f"http://localhost:19888/ws/v1/history/mapreduce/jobs/{job}/counters")
            info = capturar("yarn_logs_info.txt", f"yarn logs -applicationId {a} -show_application_log_info", juntar=True)
            cont = next((w for w in info.split() if w.startswith("container_")), "")
            capturar("yarn_logs.txt", f"yarn logs -applicationId {a} -containerId {cont} "
                                      "-log_files stdout,stderr,syslog -size -65536")
        if "spark-ventas" in ids:
            a = ids["spark-ventas"]
            curl("rm_app_spark.json", f"http://localhost:8088/ws/v1/cluster/apps/{a}")
            curl("shs_stages.json", f"http://localhost:18080/api/v1/applications/{a}/stages")
            curl("shs_jobs.json", f"http://localhost:18080/api/v1/applications/{a}/jobs")
        if "hive-ventas" in ids:
            curl("rm_app_tez.json", f"http://localhost:8088/ws/v1/cluster/apps/{ids['hive-ventas']}")

    for ejemplo, app in ids.items():
        with Chequeo(f"YARN: detalle y logs de {ejemplo}") as c:
            codigo, d = pedir("GET", f"/api/yarn/apps/{app}", timeout=60)
            assert codigo == 200, d
            codigo, lg = pedir("GET", f"/api/yarn/apps/{app}/logs", timeout=120)
            guardar(f"yarn_logs_{ejemplo}", lg)
            lineas = sum(len(f["lines"]) for f in lg.get("files", [])) if codigo == 200 else 0
            c.detalle = f"{len(lg.get('containers', []))} contenedores, {lineas} líneas de log"
            assert codigo == 200 and lg["containers"] and lineas > 0, lg

    with Chequeo("YARN: kill") as c:
        codigo, r = pedir("POST", "/api/yarn/apps", {"example": "spark-ventas"}, timeout=180)
        assert codigo == 202, r
        a = r["id"]
        # Antes de cancelarlo, las salidas de una app corriendo (con sus
        # contenedores en el NodeManager): son las fixtures de los tests.

        def corriendo():
            _, out, _ = en_contenedor("curl -s http://localhost:8042/ws/v1/node/containers")
            _, st, _ = en_contenedor(f"curl -s http://localhost:8088/ws/v1/cluster/apps/{a}")
            return '"container"' in out and '"RUNNING"' in st and out.count("container_") >= 2
        try:
            esperar(corriendo, 90, f"{a} corriendo con contenedores", 1)
        except AssertionError:
            pass
        for n, u in (("nm_containers_corriendo.json", "http://localhost:8042/ws/v1/node/containers"),
                     ("rm_apps_corriendo.json", "http://localhost:8088/ws/v1/cluster/apps"),
                     ("rm_app_spark_corriendo.json", f"http://localhost:8088/ws/v1/cluster/apps/{a}"),
                     ("rm_metrics_corriendo.json", "http://localhost:8088/ws/v1/cluster/metrics"),
                     ("rm_nodes_corriendo.json", "http://localhost:8088/ws/v1/cluster/nodes"),
                     ("rm_scheduler_corriendo.json", "http://localhost:8088/ws/v1/cluster/scheduler"),
                     ("driver_stages.json", f"http://localhost:8088/proxy/{a}/api/v1/applications/{a}/stages"),
                     ("driver_jobs.json", f"http://localhost:8088/proxy/{a}/api/v1/applications/{a}/jobs")):
            curl(n, u)
        t0 = time.time()
        codigo, k = pedir("POST", f"/api/yarn/apps/{a}/kill", timeout=120)
        assert codigo == 204, (codigo, k)
        d = esperar_app(a, 120)
        curl("rm_app_killed.json", f"http://localhost:8088/ws/v1/cluster/apps/{a}")
        c.detalle = f"{r['id']} {d['state']} a los {round(time.time() - t0, 1)} s"
        assert d["state"] == "KILLED"


def paso(stage: str, tool: str, opciones: dict | None = None, segundos=1200) -> dict:
    nombre = f"{stage}:{tool}" + (f" {opciones}" if opciones else "")
    paso.ultimo = {}
    with Chequeo(f"pipeline {nombre}") as c:
        t0 = time.time()
        codigo, r = pedir("POST", "/api/pipeline/steps", {"stage": stage, "tool": tool, "options": opciones or {}})
        if codigo == 409:
            # Quedó corriendo el paso de un chequeo anterior que falló: se espera
            # a que termine para no arrastrar la falla a todos los que siguen.
            esperar(lambda: not any(x["state"] == "running" for x in pedir("GET", "/api/pipeline/steps")[1]),
                    segundos, "que termine el paso anterior", 5)
            codigo, r = pedir("POST", "/api/pipeline/steps", {"stage": stage, "tool": tool, "options": opciones or {}})
        assert codigo == 202, (codigo, r)
        sid = r["id"]

        def fin():
            evs = [e["step"] for e in eventos("step", t0) if e.get("step", {}).get("id") == sid]
            if evs and evs[-1]["state"] != "running":
                return evs[-1]
            return None
        s = esperar(fin, segundos, f"paso {sid}", 2)
        seg = round(time.time() - t0, 1)
        TIEMPOS[f"pipeline {nombre}"] = seg
        n = len([e for e in eventos("step", t0) if e.get("step", {}).get("id") == sid])
        guardar(f"pipeline_{stage}_{tool}", s)
        c.detalle = f"{s['state']} en {seg} s, {n} eventos step; {s.get('message', '')} {s.get('error', '')}"[:600]
        paso.ultimo = s
        assert s["state"] == "done", s.get("error")
        return s
    return paso.ultimo


def pipeline() -> None:
    with Chequeo("pipeline: catálogo") as c:
        codigo, cat = pedir("GET", "/api/pipeline/catalog")
        guardar("pipeline_catalog", cat)
        no = [(s["stage"], t["id"], t.get("unavailableReason")) for s in cat for t in s["tools"] if not t["available"]]
        c.detalle = f"no disponibles: {no}"
        pedir("POST", "/api/pipeline/reset")
    paso("ingesta", "put")
    paso("etl", "pyspark")
    paso("almacen", "hivetab")
    paso("analisis", "hive", {"por": "producto"})
    paso("ml", "sklearn", {"task": "clasificacion"})
    paso("resultados", "mysql", {"por": "producto"})
    with Chequeo("pipeline: lo que quedó (HDFS, MySQL, modelo)") as c:
        codigo, ls = pedir("GET", "/api/hdfs/ls?path=" + q("/user/root/resultados/por_producto"))
        assert codigo == 200 and ls["entries"], ls
        codigo, r = pedir("POST", "/api/data/query", {"source": "mysql", "text": "SELECT * FROM resumen_producto"},
                          timeout=120)
        assert codigo == 200 and r["rows"], r
        codigo, st = pedir("GET", "/api/pipeline")
        guardar("pipeline_state", st)
        c.detalle = f"{len(r['rows'])} filas en tienda.resumen_producto; etapas {[s['state'] for s in st['stages']]}"
        assert all(s["state"] == "done" for s in st["stages"])

    # Variantes
    with Chequeo("sqoop import con SANDBOX_SQOOP_*: la clave no aparece en el comando") as c:
        s = paso("ingesta", "sqoop")
        texto = json.dumps(s)
        assert "--password \"$SQOOP_PASS\"" in texto or "SQOOP_PASS" in texto, "el comando no usa la variable"
        _, out, _ = en_contenedor("cat /datos/ejemplos/sqoop.sh 2>/dev/null | grep -o -- '--password [^ ]*' | head -1")
        clave = out.strip().split(" ")[-1] if out.strip() else ""
        c.detalle = f"clave del ejemplo presente: {bool(clave)}"
        assert not clave or clave not in texto, "la clave aparece en el paso"
    paso("etl", "pandas")
    paso("analisis", "sparksql", {"por": "sucursal"})
    paso("analisis", "pandas", {"por": "mes"})
    paso("resultados", "getmerge", {"por": "sucursal"})
    paso("ml", "mllib", {"task": "clasificacion"}, 1800)


def datos() -> None:
    with Chequeo("datos: catálogo y esquemas") as c:
        codigo, cat = pedir("GET", "/api/data/catalog", timeout=180)
        guardar("data_catalog", cat)
        assert codigo == 200, cat
        nombres = {(e["source"], e["name"]) for e in cat}
        c.detalle = f"{sorted(nombres)}"[:600]
        fallas = []
        for src, name in sorted(nombres):
            codigo, sch = pedir("GET", f"/api/data/schema?source={src}&name={q(str(name))}", timeout=180)
            guardar(f"data_schema_{src}_{name}", sch)
            if codigo != 200:
                fallas.append((src, name, codigo))
        assert any("ventas_limpias" in n for s, n in nombres if s == "hive"), "falta ventas_limpias en Hive"
        assert any(s == "mysql" for s, _ in nombres) and any(s == "mongodb" for s, _ in nombres)
        assert not fallas, fallas

    with Chequeo("ejemplos/sqoop.sh de punta a punta (deja las tablas tienda_* del JOIN de Hive)") as c:
        t0 = time.time()
        rc, out, err = en_contenedor("cd /datos && bash ejemplos/sqoop.sh > /tmp/sqoop_sh.log 2>&1; echo rc=$?; "
                                     "tail -5 /tmp/sqoop_sh.log", timeout=1800)
        TIEMPOS["ejemplos/sqoop.sh"] = round(time.time() - t0, 1)
        c.detalle = out.strip()[-400:]
        assert "rc=0" in out, out

    with Chequeo("datos: los ejemplos") as c:
        codigo, ej = pedir("GET", "/api/data/examples")
        res = []
        for e in ej:
            t0 = time.time()
            codigo, r = pedir("POST", "/api/data/query", {"source": e["source"], "text": e["text"]}, timeout=900)
            seg = round(time.time() - t0, 1)
            TIEMPOS[f"datos {e['source']}: {e['label']}"] = seg
            res.append((e["source"], e["label"], codigo, seg, r.get("appId") if isinstance(r, dict) else None,
                        r.get("error") if isinstance(r, dict) else None))
        guardar("data_examples", res)
        c.detalle = "; ".join(f"{s}/{l}: {k} {t}s{' ' + a if a else ''}{' ' + str(er) if er else ''}"
                              for s, l, k, t, a, er in res)[:2000]
        assert all(k == 200 for _, _, k, _, _, _ in res)

    with Chequeo("datos: Hive con GROUP BY va por Tez y trae appId") as c:
        texto = "SELECT producto, COUNT(*) AS n FROM ventas_limpias GROUP BY producto"
        codigo, r = pedir("POST", "/api/data/query", {"source": "hive", "text": texto}, timeout=900)
        guardar("data_query_hive_tez", r)
        c.detalle = f"{codigo} engine {r.get('engine')} appId {r.get('appId')} {r.get('ms')} ms"
        assert codigo == 200 and r.get("appId", "").startswith("application_") and r["engine"] == "tez", r
        capturar("beeline_tez.txt", f"beeline -u jdbc:hive2://localhost:10000 --outputformat=tsv2 -e {json.dumps(texto)}",
                 juntar=True)

    for src, texto in (("hive", "SELECT producto FROM ventas_limpias WHERE cantidad > 2"),
                       ("mysql", "SELECT * FROM ventas WHERE producto = 'termo'"),
                       ("mongodb", 'db.pedidos.find({ cliente_id: 42 })')):
        with Chequeo(f"datos: explain {src}") as c:
            codigo, r = pedir("POST", "/api/data/explain", {"source": src, "text": texto}, timeout=300)
            guardar(f"data_explain_{src}", r)
            c.detalle = f"{codigo} {str(r)[:300]}"
            assert codigo == 200, r

    errores = {"hive": ("SELECT * FROM no_existe_humo", "beeline -u jdbc:hive2://localhost:10000 --outputformat=tsv2 "
                                                         "-e 'SELECT * FROM no_existe_humo'"),
               "mysql": ("SELECT * FROM no_existe_humo", "mysql --batch tienda -e 'SELECT * FROM no_existe_humo'"),
               "mongodb": ("db.productos.find({ $nada: 1 })", "mongosh --quiet tienda --eval 'db.productos.find({ $nada: 1 }).toArray()'")}
    for src, (texto, cmd) in errores.items():
        with Chequeo(f"datos: error de {src}") as c:
            codigo, r = pedir("POST", "/api/data/query", {"source": src, "text": texto}, timeout=300)
            guardar(f"data_error_{src}", r)
            capturar(f"error_{src}.txt", cmd, juntar=True)
            c.detalle = f"{codigo} {r}"[:500]
            assert codigo == 500 and r["code"] == "failed" and r["error"].strip(), r
            assert "Closing:" not in r["error"] and not r["error"].startswith("at "), r["error"]


def ml() -> None:
    def entrenar(engine: str) -> dict:
        t0 = time.time()
        codigo, r = pedir("POST", "/api/ml/train", {"task": "clasificacion", "model": "arbol", "engine": engine,
                                                     "target": "vuelve", "params": {"max_depth": 3}})
        assert codigo == 202, (codigo, r)
        mid = r["id"]

        def fin():
            evs = [e["run"] for e in eventos("model", t0) if e.get("run", {}).get("id") == mid]
            return evs[-1] if evs and evs[-1]["state"] != "running" else None
        m = esperar(fin, 1800, f"modelo {mid}", 2)
        TIEMPOS[f"ML {engine}"] = round(time.time() - t0, 1)
        guardar(f"ml_{engine}", m)
        assert m["state"] == "done", m.get("error")
        return m

    referencia = None
    with Chequeo("ML: matriz de confusión de modelos_sklearn.py (referencia)") as c:
        rc, out, err = en_contenedor(
            "cd /datos && [ -s clientes_senal.csv ] || python3 ejemplos/ml/generar_senal.py > /dev/null; "
            "MPLBACKEND=Agg python3 -c \"import runpy, json; from sklearn.metrics import confusion_matrix; "
            "g = runpy.run_path('ejemplos/ml/modelos_sklearn.py', run_name='__main__'); "
            "print('@@', json.dumps(confusion_matrix(g['c_prueba']['vuelve'], g['arbol'].predict(g['X_prueba']), "
            "labels=[0, 1]).tolist()))\"", 600)
        linea = next((l for l in out.splitlines() if l.startswith("@@ ")), None)
        assert linea, (rc, out[-500:], err[-500:])
        referencia = json.loads(linea[3:])
        c.detalle = f"{referencia}"

    with Chequeo("ML: scikit-learn igual que modelos_sklearn.py") as c:
        m = entrenar("sklearn")
        mat = m.get("confusion", {}).get("matrix")
        c.detalle = f"{TIEMPOS['ML sklearn']} s; matriz {mat}; métricas {m.get('metrics')}"
        assert mat == referencia, (mat, referencia)

    with Chequeo("ML: MLlib con appId de YARN") as c:
        m = entrenar("mllib")
        app = m.get("appId")
        c.detalle = f"{TIEMPOS['ML mllib']} s; appId {app}; matriz {m.get('confusion', {}).get('matrix')}; " \
                    f"métricas {m.get('metrics')}"
        assert app and app.startswith("application_"), m
        codigo, d = pedir("GET", f"/api/yarn/apps/{app}", timeout=60)
        guardar("yarn_app_mllib", d)
        assert codigo == 200, d

    with Chequeo("ML: lista de modelos") as c:
        codigo, ms = pedir("GET", "/api/ml/models")
        guardar("ml_models", ms)
        c.detalle = f"{[(x['engine'], x['model'], x['state']) for x in ms]}"
        assert codigo == 200 and len(ms) >= 2


# ---------------------------------------------------------------- resumen

def resumen() -> int:
    SALIDAS.mkdir(parents=True, exist_ok=True)
    (SALIDAS / "resumen.json").write_text(json.dumps({"chequeos": RESULTADOS, "tiempos": TIEMPOS}, indent=2,
                                                     ensure_ascii=False) + "\n")
    malos = [r for r in RESULTADOS if not r["ok"]]
    L = [f"## Humo full: {len(RESULTADOS) - len(malos)} de {len(RESULTADOS)} bien", "",
         "| | Chequeo | Segundos | Detalle |", "|---|---|---|---|"]
    for r in RESULTADOS:
        det = (r["detalle"] + (" — " + r["error"] if r["error"] else "")).replace("|", "/").replace("\n", " ")
        L.append(f"| {'✅' if r['ok'] else '❌'} | {r['nombre']} | {r['segundos']} | {det[:700]} |")
    L += ["", "### Tiempos", "", "| Qué | Segundos |", "|---|---|"]
    L += [f"| {k} | {v} |" for k, v in TIEMPOS.items()]
    (SALIDAS / "resumen.md").write_text("\n".join(L) + "\n")
    print("\n".join(L))
    return 1 if malos else 0


def main() -> int:
    threading.Thread(target=escuchar, daemon=True).start()
    esperar(lambda: estado(), 60, "el servidor")
    try:
        solo_hdfs()
        arrancar(TODO, "todo")
        with Chequeo("todos los servicios arriba") as c:
            esperar(lambda: (lambda p: all(p.get(x) == "up" for x in ("nn1", "dn1", "dn2", "rm", "nm", "jh", "hiveserver2", "mysql", "mongodb")))(procesos()),
                    300, "servicios")
            c.detalle = str(procesos())
        yarn()
        pipeline()
        datos()
        ml()
        with Chequeo("actividad: sin errores inesperados") as c:
            _, acts = pedir("GET", "/api/activity?limit=500")
            guardar("activity", acts)
            c.detalle = f"{len(acts)} entradas"
        if os.environ.get("HUMO_DEJAR_PRENDIDO") != "1":    # humo_ui.py sigue con el cluster prendido
            apagar("todo")
    except Exception:
        traceback.print_exc()
        RESULTADOS.append({"nombre": "el humo se cortó", "ok": False, "segundos": 0, "detalle": "",
                           "error": traceback.format_exc()[-1500:]})
    return resumen()


if __name__ == "__main__":
    sys.exit(main())
