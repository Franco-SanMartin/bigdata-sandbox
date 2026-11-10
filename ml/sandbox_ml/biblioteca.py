"""Biblioteca de modelos: los modelos que se usan, con sus versiones, su estado y de dónde salió cada uno.

Un experimento es una corrida; un modelo de la biblioteca es un nombre ("churn", "gasto") con versiones, y
cada versión es un experimento que alguien decidió guardar. Todo queda en el volumen:

    /hadoop/ml/biblioteca/<nombre>/modelo.json      el modelo, sus versiones y el historial de cambios
    /hadoop/ml/biblioteca/<nombre>/v<N>/            la versión N: experimento.json, informe.json, codigo.py,
                                                    referencia.json (la deriva) y modelo.joblib (scikit-learn)
    hdfs:///user/root/ml/biblioteca/<nombre>/v<N>   el PipelineModel de Spark (o una copia del modelo.joblib)

La versión se copia: borrar el experimento no rompe la biblioteca.

Estados de una versión:

    candidato    recién guardada; se puede comparar y probar
    produccion   la que usa la predicción cuando no se elige otra (a lo sumo una por modelo)
    archivado    ya no se usa; se puede volver a promover

Promover una versión archiva la que estaba en producción. Volver atrás promueve la que estuvo en producción
antes de la actual. Cada cambio queda en el historial con la fecha y la nota.

Es un registro propio y no MLflow (decisión D-08): MLflow suma un servidor, una base y ~100 MB de librerías
para guardar lo mismo que ya guarda el estudio. Las ideas son las de su Model Registry (versiones, estados,
linaje), y `exportar` arma un paquete que se puede usar fuera del sandbox.

    from sandbox_ml import biblioteca
    biblioteca.listar()
    biblioteca.registrar("churn", "/hadoop/ml/experimentos/exp-...", nota="primer bosque")
    biblioteca.promover("churn", 1, nota="le gana a la logística en la prueba")
"""
from __future__ import annotations

import json
import os
import re
import shutil
from datetime import datetime
from pathlib import Path

from . import catalogo as cat

RAIZ = Path(os.environ.get("SANDBOX_ML_BIBLIOTECA", "/hadoop/ml/biblioteca"))
HDFS = "/user/root/ml/biblioteca"
NOMBRE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,47}$")
ESTADOS = ("candidato", "produccion", "archivado")
COPIAR = ("experimento.json", "informe.json", "codigo.py", "referencia.json", "modelo.joblib")


class ErrorBiblioteca(ValueError):
    """Un pedido que no se puede cumplir (nombre inválido, versión que no existe...): el mensaje va a la pantalla."""


def raiz() -> Path:
    try:
        RAIZ.mkdir(parents=True, exist_ok=True)
        if os.access(RAIZ, os.W_OK):
            return RAIZ
    except OSError:
        pass
    return Path("biblioteca")


def _ahora() -> str:
    return datetime.now().isoformat(timespec="seconds")


def _leer_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def _escribir(p: Path, obj) -> None:
    from .estudio import _py
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(_py(obj), ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(p)


def nombre_ok(nombre: object) -> str:
    if not isinstance(nombre, str) or not NOMBRE.match(nombre):
        raise ErrorBiblioteca("El nombre va en minúsculas, con números, - o _ (hasta 48 letras), por ejemplo churn o gasto-v2")
    return nombre


def carpeta(nombre: str, base: Path | None = None) -> Path:
    return (base or raiz()) / nombre_ok(nombre)


def ruta_hdfs(nombre: str, version: int) -> str:
    return f"{HDFS}/{nombre_ok(nombre)}/v{int(version)}"


def leer(nombre: str, base: Path | None = None) -> dict:
    p = carpeta(nombre, base) / "modelo.json"
    if not p.is_file():
        raise ErrorBiblioteca(f"No hay un modelo {nombre} en la biblioteca")
    return _leer_json(p)


def _guardar(m: dict, base: Path | None = None) -> None:
    m["actualizado"] = _ahora()
    _escribir(carpeta(m["nombre"], base) / "modelo.json", m)


def version(m: dict, v: object) -> dict:
    try:
        n = int(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        raise ErrorBiblioteca(f"La versión es un número (v1, v2...), no {v!r}") from None
    for x in m["versiones"]:
        if x["version"] == n:
            return x
    raise ErrorBiblioteca(f"{m['nombre']} no tiene la versión {n}")


def en_produccion(m: dict) -> dict | None:
    return next((x for x in m["versiones"] if x["estado"] == "produccion"), None)


def elegir(nombre: str, v: object = None, base: Path | None = None) -> tuple[dict, dict]:
    """(modelo, versión) para predecir: la pedida o la que está en producción."""
    m = leer(nombre, base)
    if v not in (None, ""):
        return m, version(m, v)
    p = en_produccion(m)
    if not p:
        raise ErrorBiblioteca(f"{nombre} no tiene una versión en producción: elegí una versión o promové una")
    return m, p


def carpeta_version(nombre: str, v: int, base: Path | None = None) -> Path:
    return carpeta(nombre, base) / f"v{int(v)}"


# ---------------------------------------------------------------- listar

def _valor(x: dict, metrica: str | None) -> float | None:
    m = (x.get("metricas") or {}).get(metrica or "", {})
    return m.get("prueba", m.get("cv"))


def resumen(m: dict) -> dict:
    p = en_produccion(m)
    ult = m["versiones"][-1] if m["versiones"] else None
    return {"nombre": m["nombre"], "descripcion": m.get("descripcion"), "tarea": m["tarea"], "objetivo": m.get("objetivo"),
            "metrica": m.get("metrica"), "versiones": len(m["versiones"]),
            "produccion": p["version"] if p else None, "valor": _valor(p, m.get("metrica")) if p else None,
            "motor": (p or ult or {}).get("motor"), "modeloEtiqueta": ((p or ult or {}).get("modelo") or {}).get("etiqueta"),
            "candidatas": sum(1 for x in m["versiones"] if x["estado"] == "candidato"),
            "creado": m.get("creado"), "actualizado": m.get("actualizado")}


def listar(base: Path | None = None) -> list[dict]:
    out = []
    for p in sorted((base or raiz()).glob("*/modelo.json")):
        try:
            out.append(resumen(_leer_json(p)))
        except (OSError, ValueError, KeyError):
            continue
    return sorted(out, key=lambda r: r.get("actualizado") or "", reverse=True)


# ---------------------------------------------------------------- registrar

def linaje(exp: dict) -> dict:
    """De dónde salió la versión: datos, limpieza, receta, variables, parámetros, métricas y la app de YARN."""
    r = exp.get("receta") or {}
    lim = r.get("limpieza") or {}
    busq = exp.get("busqueda") or {}
    return {
        "experimento": exp["id"], "nombre_experimento": exp.get("nombre"), "entrenado": exp.get("terminado"),
        "datos": exp.get("datos"), "filas": exp.get("filas"),
        "limpieza": {"nombre": lim.get("nombre"), "version": lim.get("version"),
                     "pasos": sum(1 for p in lim.get("pasos") or [] if p.get("activo", True))} if lim.get("pasos") else None,
        "huella_receta": exp.get("huella"), "objetivo": exp.get("objetivo"), "variables": exp.get("variables"),
        "validacion": {k: (r.get("validacion") or {}).get(k) for k in ("particion", "prueba", "validacion", "cv", "k", "metrica", "umbral", "semilla")},
        "busqueda": {"tipo": busq.get("tipo"), "candidatos": busq.get("candidatos"), "mejores_params": busq.get("mejores_params")} if busq else None,
        "yarn": (exp.get("yarn") or {}).get("app_id"), "recursos": exp.get("recursos"),
        "entorno": exp.get("entorno"), "editado": exp.get("editado", False),
    }


def registrar(nombre: str, exp_dir: str | Path, *, nota: str = "", descripcion: str | None = None,
              base: Path | None = None, modelo_hdfs: str | None = None) -> dict:
    """Guarda el experimento como una versión nueva (candidato) de `nombre`; crea el modelo si no existe.

    modelo_hdfs: dónde quedó la copia del PipelineModel de Spark (la hace quien llama, con hdfs dfs -cp, porque
    necesita el cluster); si no se pasa, la versión apunta al modelo del experimento."""
    nombre_ok(nombre)
    exp_dir = Path(exp_dir)
    try:
        exp = _leer_json(exp_dir / "experimento.json")
    except (OSError, ValueError):
        raise ErrorBiblioteca(f"No se pudo leer el experimento en {exp_dir}") from None
    if exp.get("estado") != "listo":
        raise ErrorBiblioteca(f"El experimento {exp.get('id', exp_dir.name)} no terminó bien ({exp.get('estado')}): "
                              "solo se guardan los que están listos")
    if exp.get("motor") == "sklearn" and not (exp_dir / "modelo.joblib").is_file():
        raise ErrorBiblioteca("El experimento no guardó su modelo (modelo.joblib)")
    if exp.get("motor") == "spark" and not (modelo_hdfs or exp.get("modelo_hdfs")):
        raise ErrorBiblioteca("El experimento no guardó su modelo en HDFS")
    d = carpeta(nombre, base)
    try:
        m = leer(nombre, base)
    except ErrorBiblioteca:
        m = {"nombre": nombre, "descripcion": descripcion or "", "creado": _ahora(), "tarea": exp["tarea"],
             "objetivo": exp.get("objetivo"), "metrica": exp.get("metrica"), "versiones": [], "historial": []}
    if m["tarea"] != exp["tarea"] or (m.get("objetivo") or None) != (exp.get("objetivo") or None):
        raise ErrorBiblioteca(f"{nombre} es de {cat.TAREAS[m['tarea']]['etiqueta'].lower()}"
                              + (f" sobre {m['objetivo']}" if m.get("objetivo") else "")
                              + ": este experimento predice otra cosa. Guardalo con otro nombre")
    if any(x["experimento"] == exp["id"] for x in m["versiones"]):
        v = next(x for x in m["versiones"] if x["experimento"] == exp["id"])
        raise ErrorBiblioteca(f"Ese experimento ya es la versión {v['version']} de {nombre}")
    if descripcion:
        m["descripcion"] = descripcion
    n = max((x["version"] for x in m["versiones"]), default=0) + 1
    dv = d / f"v{n}"
    dv.mkdir(parents=True, exist_ok=True)
    for f in COPIAR:
        if (exp_dir / f).is_file():
            shutil.copyfile(exp_dir / f, dv / f)
    hdfs = modelo_hdfs or exp.get("modelo_hdfs")
    if exp.get("motor") == "spark":
        # La copia de la versión apunta al modelo de la biblioteca: predecir.py la usa tal cual
        e2 = _leer_json(dv / "experimento.json")
        e2["modelo_hdfs"] = hdfs
        _escribir(dv / "experimento.json", e2)
    x = {
        "version": n, "estado": "candidato", "creado": _ahora(), "nota": (nota or "").strip()[:500],
        "experimento": exp["id"], "motor": exp.get("motor"), "tarea": exp["tarea"], "objetivo": exp.get("objetivo"),
        "metrica": exp.get("metrica"),
        "modelo": {k: (exp.get("modelo") or {}).get(k) for k in ("id", "etiqueta", "clase", "params")},
        "metricas": exp.get("metricas") or {}, "umbral": exp.get("umbral"), "clases": exp.get("clases"),
        "entrada": exp.get("entrada"), "deriva": (dv / "referencia.json").is_file(),
        "artefacto": hdfs if exp.get("motor") == "spark" else str(dv / "modelo.joblib"),
        "modelo_bytes": exp.get("modelo_bytes"),
        "linaje": linaje(exp),
    }
    m["versiones"].append(x)
    m["historial"].append({"cuando": x["creado"], "accion": "registrar", "version": n, "nota": x["nota"],
                           "detalle": f"desde {exp['id']}"})
    _guardar(m, base)
    return x


# ---------------------------------------------------------------- estados

def _evento(m: dict, accion: str, v: int, nota: str, detalle: str = "") -> None:
    m["historial"].append({"cuando": _ahora(), "accion": accion, "version": v, "nota": (nota or "").strip()[:500],
                           "detalle": detalle})


def promover(nombre: str, v: object, *, nota: str = "", base: Path | None = None) -> dict:
    m = leer(nombre, base)
    x = version(m, v)
    if x["estado"] == "produccion":
        raise ErrorBiblioteca(f"La versión {x['version']} ya está en producción")
    antes = en_produccion(m)
    if antes:
        antes["estado"] = "archivado"
        _evento(m, "archivar", antes["version"], "", f"la reemplazó la versión {x['version']}")
    x["estado"] = "produccion"
    x["promovida"] = _ahora()
    _evento(m, "promover", x["version"], nota, f"antes estaba la versión {antes['version']}" if antes else "primera en producción")
    _guardar(m, base)
    return m


def archivar(nombre: str, v: object, *, nota: str = "", base: Path | None = None) -> dict:
    m = leer(nombre, base)
    x = version(m, v)
    if x["estado"] == "archivado":
        raise ErrorBiblioteca(f"La versión {x['version']} ya está archivada")
    era = x["estado"]
    x["estado"] = "archivado"
    _evento(m, "archivar", x["version"], nota, "estaba en producción: el modelo queda sin versión en producción"
            if era == "produccion" else "")
    _guardar(m, base)
    return m


def volver_atras(nombre: str, *, nota: str = "", base: Path | None = None) -> dict:
    """Promueve la versión que estuvo en producción antes de la actual (la última promovida que no es la actual)."""
    m = leer(nombre, base)
    actual = en_produccion(m)
    previa = None
    for h in reversed(m["historial"]):
        if h["accion"] in ("promover", "volver") and (not actual or h["version"] != actual["version"]):
            previa = h["version"]
            break
    if previa is None:
        raise ErrorBiblioteca("No hay una versión anterior en producción a la que volver")
    if actual:
        actual["estado"] = "archivado"
        _evento(m, "archivar", actual["version"], "", f"volver atrás a la versión {previa}")
    x = version(m, previa)
    x["estado"] = "produccion"
    x["promovida"] = _ahora()
    _evento(m, "volver", previa, nota, f"desde la versión {actual['version']}" if actual else "")
    _guardar(m, base)
    return m


def describir(nombre: str, descripcion: str, base: Path | None = None) -> dict:
    m = leer(nombre, base)
    m["descripcion"] = (descripcion or "").strip()[:500]
    _guardar(m, base)
    return m


# ---------------------------------------------------------------- comparar

def comparar(nombre: str, versiones: list[object] | None = None, base: Path | None = None) -> dict:
    """Las versiones lado a lado: cada métrica (con cuál gana), los hiperparámetros que cambian y los datos."""
    m = leer(nombre, base)
    xs = [version(m, v) for v in versiones] if versiones else list(m["versiones"])
    if not xs:
        raise ErrorBiblioteca(f"{nombre} no tiene versiones")
    nombres = sorted({k for x in xs for k in (x.get("metricas") or {})}, key=lambda k: (k != m.get("metrica"), k))
    metricas = []
    for k in nombres:
        info = cat.METRICAS.get(k, {})
        vals = [_valor({"metricas": x.get("metricas")}, k) for x in xs]
        hay = [v for v in vals if v is not None]
        mejor = None
        if hay:
            obj = max(hay) if info.get("mayor_mejor", True) else min(hay)
            mejor = [x["version"] for x, v in zip(xs, vals) if v == obj]
        metricas.append({"metrica": k, "etiqueta": info.get("etiqueta", k), "mayor_mejor": info.get("mayor_mejor", True),
                         "valores": vals, "mejor": mejor, "principal": k == m.get("metrica")})
    claves = sorted({p for x in xs for p in ((x.get("modelo") or {}).get("params") or {})})
    params = []
    for p in claves:
        vals = [((x.get("modelo") or {}).get("params") or {}).get(p) for x in xs]
        params.append({"param": p, "valores": vals, "cambia": len({json.dumps(v, sort_keys=True, default=str) for v in vals}) > 1})
    return {
        "nombre": nombre, "metrica": m.get("metrica"),
        "versiones": [{"version": x["version"], "estado": x["estado"], "motor": x.get("motor"),
                       "modelo": (x.get("modelo") or {}).get("etiqueta"), "experimento": x["experimento"],
                       "creado": x["creado"], "umbral": x.get("umbral")} for x in xs],
        "metricas": metricas,
        "params": params,
        "datos": [{"version": x["version"], "fuente": ((x.get("linaje") or {}).get("datos") or {}).get("ruta")
                   or ((x.get("linaje") or {}).get("datos") or {}).get("tabla"),
                   "filas": (x.get("linaje") or {}).get("filas"), "huella": (x.get("linaje") or {}).get("huella_receta"),
                   "limpieza": (x.get("linaje") or {}).get("limpieza")} for x in xs],
    }
