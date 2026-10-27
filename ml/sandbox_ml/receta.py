"""La receta de un experimento: todo lo que hace falta para reproducirlo, en un JSON.

    {
      "nombre": "bosque contra la logística",            (opcional)
      "datos": {"origen": "local", "ruta": "/datos/clientes_senal.csv"},
                (origen: local | hdfs | hive; para hive, "tabla": "default.ventas")
      "tarea": "clasificacion",                          (regresion | clasificacion | clustering | reduccion)
      "objetivo": "vuelve",                              (None en clustering y reducción)
      "referencia": None,                                (clustering: columna para comparar, no se usa para entrenar)
      "columnas": {"edad": "numerica", "id_cliente": "id", ...},
      "preproceso": {...},                               (ver catalogo.PREPROCESO_DEFECTO)
      "validacion": {"particion": "estratificada", "prueba": 0.2, "validacion": 0.0, "columna_tiempo": None,
                     "cv": "estratificada", "k": 5, "repeticiones": 2, "semilla": 42, "metrica": "f1_macro"},
      "modelo": {"id": "bosque_clf", "params": {"n_estimators": 200}},
      "busqueda": {"tipo": "ninguna", "espacio": {}, "iteraciones": 20, "factor": 3, "max_minutos": 15, "n_jobs": 1},
      "informe": {"curva_aprendizaje": True, "curva_validacion": None, "permutacion": True}
    }

normalizar() completa lo que falta con los valores por defecto y valida contra
el catálogo; con el perfil de los datos (perfil.py) además avisa de fugas,
columnas id, desbalance y tipos que no cierran. No importa scikit-learn: lo
usa el servidor para validar antes de generar el código.
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import re

from . import catalogo as cat

RECETA_VERSION = 1
CAPAS = re.compile(r"^\s*\d{1,4}(\s*,\s*\d{1,4}){0,4}\s*$")
NOMBRE_COL = re.compile(r"^[^\x00-\x1f]{1,200}$")
TABLA = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$")
SUPERVISADAS = ("regresion", "clasificacion")


class RecetaInvalida(ValueError):
    """La receta tiene errores: .errores es [{campo, mensaje}]."""

    def __init__(self, errores: list[dict]):
        super().__init__("; ".join(f"{e['campo']}: {e['mensaje']}" for e in errores))
        self.errores = errores


class _Rev:
    def __init__(self):
        self.errores: list[dict] = []
        self.avisos: list[dict] = []

    def error(self, campo: str, mensaje: str) -> None:
        self.errores.append({"campo": campo, "mensaje": mensaje})

    def aviso(self, campo: str, mensaje: str, tipo: str = "aviso") -> None:
        self.avisos.append({"campo": campo, "mensaje": mensaje, "tipo": tipo})


# ---------------------------------------------------------------- valores

def _es_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _igual(a, b) -> bool:
    """Igualdad que no confunde True con 1 ni '1' con 1."""
    if isinstance(a, bool) or isinstance(b, bool):
        return isinstance(a, bool) and isinstance(b, bool) and a == b
    if _es_num(a) and _es_num(b):
        return float(a) == float(b)
    return type(a) is type(b) and a == b


def valor_param(p: dict, v, modelo: str):
    """El valor normalizado de un hiperparámetro, o ValueError con el motivo."""
    t = p["tipo"]
    if v is None:
        if p.get("nulo") or (t == "choice" and any(o["valor"] is None for o in p["opciones"])):
            return None
        raise ValueError("no puede quedar vacío")
    if t == "int":
        if isinstance(v, float) and v.is_integer():
            v = int(v)
        if isinstance(v, bool) or not isinstance(v, int):
            raise ValueError("tiene que ser un entero")
        if not p["min"] <= v <= p["max"]:
            raise ValueError(f"va de {p['min']} a {p['max']}")
        return v
    if t == "float":
        if not _es_num(v):
            raise ValueError("tiene que ser un número")
        if not p["min"] <= v <= p["max"]:
            raise ValueError(f"va de {p['min']} a {p['max']}")
        return float(v) if isinstance(v, float) or not float(v).is_integer() else (float(v) if p["tipo"] == "float" else v)
    if t == "bool":
        if not isinstance(v, bool):
            raise ValueError("es sí o no (true/false)")
        return v
    if t == "choice":
        for o in p["opciones"]:
            if _igual(o["valor"], v):
                return o["valor"]
        raise ValueError("tiene que ser uno de " + ", ".join(repr(o["valor"]) for o in p["opciones"]))
    if t == "layers":
        if isinstance(v, (list, tuple)):
            v = ",".join(str(x) for x in v)
        if isinstance(v, int) and not isinstance(v, bool):
            v = str(v)
        if not isinstance(v, str) or not CAPAS.match(v):
            raise ValueError("son neuronas por capa separadas por coma, p. ej. 64,32 (hasta 5 capas)")
        capas = [int(x) for x in v.split(",")]
        if any(c < 1 for c in capas):
            raise ValueError("cada capa tiene que tener al menos una neurona")
        return ",".join(str(c) for c in capas)
    if t == "str":
        if not isinstance(v, str) or len(v) > 200:
            raise ValueError("tiene que ser un texto corto")
        return v
    raise ValueError(f"tipo desconocido {t}")


def activo(p: dict, params: dict) -> bool:
    """Si el parámetro se usa con los valores de los otros (campo 'si' del catálogo)."""
    for otro, valores in (p.get("si") or {}).items():
        v = params.get(otro)
        if valores == "no_nulo":
            if v is None:
                return False
        elif not any(_igual(v, x) for x in valores):
            return False
    return True


def params_modelo(mid: str, dados, rev: _Rev, campo: str = "modelo.params") -> dict:
    """Los defaults del catálogo pisados por los dados; solo quedan los activos."""
    m = cat.MODELOS[mid]
    out = cat.defectos(mid)
    if dados is None:
        dados = {}
    if not isinstance(dados, dict):
        rev.error(campo, "tiene que ser un objeto {parámetro: valor}")
        dados = {}
    for k, v in dados.items():
        p = cat.param(m, k)
        if p is None:
            rev.error(f"{campo}.{k}", f"{k} no es un hiperparámetro de {m['etiqueta']}")
            continue
        try:
            out[k] = valor_param(p, v, mid)
        except ValueError as e:
            rev.error(f"{campo}.{k}", f"{k} {e}")
    return {k: v for k, v in out.items() if activo(cat.param(m, k), out)}


# ---------------------------------------------------------------- partes de la receta

def _datos(d, rev: _Rev) -> dict:
    if not isinstance(d, dict):
        rev.error("datos", "faltan los datos: {origen, ruta} o {origen: hive, tabla}")
        return {"origen": "local", "ruta": ""}
    origen = d.get("origen", "local")
    out = {"origen": origen}
    if origen not in ("local", "hdfs", "hive"):
        rev.error("datos.origen", "es local (/datos), hdfs o hive")
    elif origen == "hive":
        t = d.get("tabla")
        if not isinstance(t, str) or not TABLA.match(t):
            rev.error("datos.tabla", "tiene que ser una tabla de Hive: nombre o base.nombre")
        out["tabla"] = t if isinstance(t, str) else ""
    else:
        r = d.get("ruta")
        # (también C:\... para correr los scripts en Windows)
        absoluta = isinstance(r, str) and (r.startswith("/") or bool(re.match(r"^[A-Za-z]:[\\/]", r)))
        if not absoluta or ".." in re.split(r"[\\/]", r) or "\x00" in r:
            rev.error("datos.ruta", "tiene que ser una ruta absoluta (/datos/... o /user/...)")
            r = r if isinstance(r, str) else ""
        out["ruta"] = r
        fmt = d.get("formato") or ("parquet" if r.endswith(".parquet") or (origen == "hdfs" and "." not in r.rsplit("/", 1)[-1])
                                   else "csv")
        if fmt not in ("csv", "parquet"):
            rev.error("datos.formato", "es csv o parquet")
        out["formato"] = fmt
        if fmt == "csv":
            sep = d.get("separador", ",")
            if sep not in (",", ";", "\t", "|"):
                rev.error("datos.separador", "es coma, punto y coma, tabulación o barra")
            out["separador"] = sep
    lim = d.get("limite")
    if lim is not None and (not isinstance(lim, int) or isinstance(lim, bool) or not 100 <= lim <= 50_000_000):
        rev.error("datos.limite", "es un número de filas entre 100 y 50.000.000 (o vacío para todas)")
    out["limite"] = lim if isinstance(lim, int) and not isinstance(lim, bool) else None
    return out


def _preproceso(d, rev: _Rev) -> dict:
    out = dict(cat.PREPROCESO_DEFECTO)
    if d is None:
        d = {}
    if not isinstance(d, dict):
        rev.error("preproceso", "tiene que ser un objeto")
        return out
    for k, v in d.items():
        if k not in out:
            rev.error(f"preproceso.{k}", f"{k} no es una opción de preprocesamiento")
            continue
        out[k] = v
    for k in ("imputar_num", "imputar_cat", "escalar", "outliers", "codificar", "seleccion"):
        validos = [o["valor"] for o in cat.PREPROCESO[k]["opciones"]]
        if out[k] not in validos:
            rev.error(f"preproceso.{k}", f"es {', '.join(validos)}")
    for k in ("indicador_nulos", "fecha"):
        if not isinstance(out[k], bool):
            rev.error(f"preproceso.{k}", "es sí o no")
    _rango(out, "factor_iqr", 0.5, 10.0, rev, "preproceso")
    _rango(out, "max_categorias", 2, 1000, rev, "preproceso", entero=True)
    _rango(out, "texto_max", 10, 20000, rev, "preproceso", entero=True)
    _rango(out, "k", 1, 10000, rev, "preproceso", entero=True)
    _rango(out, "umbral_varianza", 0.0, 1e6, rev, "preproceso")
    if out["pca"] is not None:
        _rango(out, "pca", 1, 500, rev, "preproceso", entero=True)
    return out


def _rango(d: dict, k: str, lo, hi, rev: _Rev, base: str, entero: bool = False) -> None:
    v = d.get(k)
    if isinstance(v, float) and entero and v.is_integer():
        v = d[k] = int(v)
    ok = _es_num(v) and lo <= v <= hi and (not entero or isinstance(v, int))
    if not ok:
        rev.error(f"{base}.{k}", f"va de {lo} a {hi}" + (" (entero)" if entero else ""))


def _validacion(d, tarea: str, motor: str, rev: _Rev) -> dict:
    sup = tarea in SUPERVISADAS
    out = {"particion": "estratificada" if tarea == "clasificacion" else "aleatoria", "prueba": 0.2, "validacion": 0.0,
           "columna_tiempo": None, "cv": ("estratificada" if tarea == "clasificacion" else "kfold") if sup else "ninguna",
           "k": 5, "repeticiones": 2, "semilla": 42,
           "metrica": (cat.METRICA_DEFECTO_SPARK if motor == "spark" else cat.METRICA_DEFECTO)[tarea]}
    if motor == "spark" and sup:
        out["particion"] = "aleatoria"
        out["cv"] = "kfold"
    if d is None:
        d = {}
    if not isinstance(d, dict):
        rev.error("validacion", "tiene que ser un objeto")
        return out
    for k, v in d.items():
        if k not in out:
            rev.error(f"validacion.{k}", f"{k} no es una opción de validación")
            continue
        out[k] = v
    if out["particion"] not in cat.PARTICIONES:
        rev.error("validacion.particion", "es aleatoria, estratificada o temporal")
    if out["cv"] not in cat.CV:
        rev.error("validacion.cv", "es ninguna, kfold, estratificada, repetida o temporal")
    _rango(out, "prueba", 0.05, 0.5, rev, "validacion")
    _rango(out, "validacion", 0.0, 0.4, rev, "validacion")
    _rango(out, "k", 2, 20, rev, "validacion", entero=True)
    _rango(out, "repeticiones", 1, 10, rev, "validacion", entero=True)
    _rango(out, "semilla", 0, 2 ** 31 - 1, rev, "validacion", entero=True)
    if _es_num(out["prueba"]) and _es_num(out["validacion"]) and out["prueba"] + out["validacion"] > 0.6:
        rev.error("validacion.validacion", "prueba y validación juntas no pueden pasar el 60 % de las filas")
    met = cat.METRICAS.get(out["metrica"])
    if met is None or met["tarea"] != tarea:
        rev.error("validacion.metrica", f"{out['metrica']} no es una métrica de {cat.TAREAS[tarea]['etiqueta'].lower()}")
    elif motor == "spark" and sup and not met.get("spark"):
        rev.error("validacion.metrica", f"Spark MLlib no tiene {met['etiqueta']}: elegí otra métrica")
    if not sup:
        out["cv"] = "ninguna"
        return out
    if out["particion"] == "estratificada" and tarea != "clasificacion":
        rev.error("validacion.particion", "la partición estratificada es para clasificación (en regresión no hay clases)")
    if out["cv"] == "estratificada" and tarea != "clasificacion":
        rev.error("validacion.cv", "StratifiedKFold es para clasificación")
    if out["particion"] == "temporal" or out["cv"] == "temporal":
        if not isinstance(out["columna_tiempo"], str) or not out["columna_tiempo"]:
            rev.error("validacion.columna_tiempo", "la partición temporal necesita una columna de fecha u orden")
    if motor == "spark":
        if out["cv"] in ("repetida", "temporal", "estratificada"):
            rev.error("validacion.cv", "Spark MLlib solo tiene validación cruzada KFold (CrossValidator)")
        if out["particion"] == "estratificada":
            rev.aviso("validacion.particion", "en Spark la partición estratificada se arma con sampleBy por clase "
                                              "(proporciones aproximadas)", "info")
    return out


def _busqueda(d, mid: str, motor: str, tarea: str, val: dict, rev: _Rev) -> dict:
    out = {"tipo": "ninguna", "espacio": {}, "iteraciones": 20, "factor": 3, "max_minutos": 15, "n_jobs": 1}
    if d is None:
        d = {}
    if not isinstance(d, dict):
        rev.error("busqueda", "tiene que ser un objeto")
        return out
    for k, v in d.items():
        if k not in out:
            rev.error(f"busqueda.{k}", f"{k} no es una opción de la búsqueda")
            continue
        out[k] = v
    tipos = cat.BUSQUEDAS[motor]
    if out["tipo"] not in tipos:
        rev.error("busqueda.tipo", f"con {'Spark MLlib' if motor == 'spark' else 'scikit-learn'} es "
                                   f"{', '.join(tipos)}")
        out["tipo"] = "ninguna"
    _rango(out, "iteraciones", 1, 500, rev, "busqueda", entero=True)
    _rango(out, "factor", 2, 10, rev, "busqueda", entero=True)
    _rango(out, "max_minutos", cat.LIMITES["min_minutos"], cat.LIMITES["max_minutos"], rev, "busqueda", entero=True)
    _rango(out, "n_jobs", 1, cat.LIMITES["max_n_jobs"], rev, "busqueda", entero=True)
    if out["tipo"] == "ninguna":
        out["espacio"] = {}
        return out
    if tarea not in SUPERVISADAS:
        rev.error("busqueda.tipo", "la búsqueda de hiperparámetros es para regresión y clasificación "
                                   "(en clustering usá la curva de validación de k)")
        return out
    if motor == "sklearn" and val["cv"] == "ninguna":
        rev.error("busqueda.tipo", "la búsqueda necesita validación cruzada: elegí KFold u otra")
    esp = out["espacio"]
    if not isinstance(esp, dict) or not esp:
        rev.error("busqueda.espacio", "elegí al menos un hiperparámetro con sus valores para buscar")
        out["espacio"] = {}
        return out
    m = cat.MODELOS[mid]
    limpio, combos, rangos = {}, 1, False
    for k, vals in esp.items():
        p = cat.param(m, k)
        if p is None:
            rev.error(f"busqueda.espacio.{k}", f"{k} no es un hiperparámetro de {m['etiqueta']}")
            continue
        if isinstance(vals, dict):
            if out["tipo"] not in ("random", "halving_random") or p["tipo"] not in ("int", "float"):
                rev.error(f"busqueda.espacio.{k}", "un rango (min, max) solo sirve en las búsquedas al azar y para números")
                continue
            lo, hi = vals.get("min"), vals.get("max")
            try:
                lo, hi = valor_param(p, lo, mid), valor_param(p, hi, mid)
            except ValueError as e:
                rev.error(f"busqueda.espacio.{k}", f"el rango de {k} {e}")
                continue
            if lo is None or hi is None or lo >= hi:
                rev.error(f"busqueda.espacio.{k}", "el mínimo tiene que ser menor que el máximo")
                continue
            log = bool(vals.get("log", p.get("log", False)))
            if log and lo <= 0:
                rev.error(f"busqueda.espacio.{k}", "en escala logarítmica el mínimo tiene que ser mayor que 0")
                continue
            limpio[k] = {"min": lo, "max": hi, "log": log}
            rangos = True
            continue
        if not isinstance(vals, list) or not vals:
            rev.error(f"busqueda.espacio.{k}", "es una lista de valores (o {min, max} en las búsquedas al azar)")
            continue
        ok = []
        for v in vals:
            try:
                nv = valor_param(p, v, mid)
            except ValueError as e:
                rev.error(f"busqueda.espacio.{k}", f"{v!r}: {k} {e}")
                continue
            if not any(_igual(nv, x) for x in ok):
                ok.append(nv)
        if len(ok) > 50:
            rev.error(f"busqueda.espacio.{k}", "hasta 50 valores por hiperparámetro")
        limpio[k] = ok
        combos *= max(len(ok), 1)
    out["espacio"] = limpio
    if rangos and out["tipo"] in ("grid", "halving", "cv", "tvs"):
        rev.error("busqueda.espacio", "la grilla necesita listas de valores, no rangos")
    particiones = _particiones(val, motor, out["tipo"])
    if out["tipo"] in ("random", "halving_random"):
        candidatos = out["iteraciones"] if _es_num(out["iteraciones"]) else 1
        if not rangos:
            candidatos = min(candidatos, combos)
    else:
        candidatos = combos
    out["candidatos"] = candidatos
    out["ajustes"] = candidatos * particiones if out["tipo"] not in ("halving", "halving_random") \
        else _ajustes_halving(candidatos, particiones, out["factor"] if _es_num(out["factor"]) else 3)
    if candidatos > cat.LIMITES["max_combinaciones"]:
        rev.error("busqueda.espacio", f"son {candidatos} combinaciones: el máximo es {cat.LIMITES['max_combinaciones']} "
                                      "(sacá valores o usá la búsqueda al azar)")
    elif out["ajustes"] > cat.LIMITES["max_ajustes"]:
        rev.error("busqueda.espacio", f"son {out['ajustes']} entrenamientos (combinaciones × particiones): el máximo es "
                                      f"{cat.LIMITES['max_ajustes']}")
    elif out["ajustes"] > 300:
        rev.aviso("busqueda.espacio", f"{out['ajustes']} entrenamientos: puede tardar. El límite de tiempo es "
                                      f"{out['max_minutos']} min.")
    return out


def _particiones(val: dict, motor: str, tipo: str) -> int:
    if motor == "spark":
        return 1 if tipo == "tvs" else int(val["k"]) if _es_num(val["k"]) else 3
    k = int(val["k"]) if _es_num(val["k"]) else 5
    return k * int(val["repeticiones"]) if val["cv"] == "repetida" and _es_num(val["repeticiones"]) else k


def _ajustes_halving(candidatos: int, particiones: int, factor: int) -> int:
    """Entrenamientos de successive halving: cada ronda deja 1/factor de los candidatos."""
    total, c = 0, candidatos
    while c >= 1:
        total += c * particiones
        if c == 1:
            break
        c = math.ceil(c / factor)
    return total


def _informe(d, tarea: str, motor: str, mid: str, rev: _Rev) -> dict:
    out = {"curva_aprendizaje": motor == "sklearn" and tarea in SUPERVISADAS, "curva_validacion": None,
           "permutacion": motor == "sklearn" and tarea in SUPERVISADAS}
    if tarea == "clustering" and motor == "sklearn":
        clave = "n_clusters" if cat.param(cat.MODELOS[mid], "n_clusters") else \
            "n_components" if cat.param(cat.MODELOS[mid], "n_components") else None
        if clave:
            out["curva_validacion"] = {"param": clave, "valores": [2, 3, 4, 5, 6, 7, 8]}
    if d is None:
        return out
    if not isinstance(d, dict):
        rev.error("informe", "tiene que ser un objeto")
        return out
    for k in ("curva_aprendizaje", "permutacion"):
        if k in d:
            if not isinstance(d[k], bool):
                rev.error(f"informe.{k}", "es sí o no")
            else:
                out[k] = d[k]
    if "curva_validacion" in d:
        cv = d["curva_validacion"]
        if cv is None:
            out["curva_validacion"] = None
        elif not isinstance(cv, dict) or not isinstance(cv.get("valores"), list):
            rev.error("informe.curva_validacion", "es {param, valores: [...]} o nada")
        else:
            p = cat.param(cat.MODELOS[mid], cv.get("param", ""))
            if p is None or p["tipo"] not in ("int", "float", "choice"):
                rev.error("informe.curva_validacion.param", "elegí un hiperparámetro numérico o de opciones del modelo")
            else:
                vals = []
                for v in cv["valores"][:20]:
                    try:
                        vals.append(valor_param(p, v, mid))
                    except ValueError as e:
                        rev.error("informe.curva_validacion.valores", f"{v!r}: {e}")
                if len(vals) < 2:
                    rev.error("informe.curva_validacion.valores", "hacen falta al menos 2 valores")
                out["curva_validacion"] = {"param": p["nombre"], "valores": vals}
    if motor == "spark" and out["permutacion"]:
        rev.aviso("informe.permutacion", "en Spark no se calcula la importancia por permutación (sería un trabajo de "
                                         "YARN por columna): se muestra la importancia del modelo", "info")
        out["permutacion"] = False
    return out


# ---------------------------------------------------------------- la receta entera

def normalizar(receta, perfil: dict | None = None) -> tuple[dict, list[dict], list[dict]]:
    """(receta completa, errores, avisos). Con errores, la receta no se puede correr."""
    rev = _Rev()
    if not isinstance(receta, dict):
        rev.error("receta", "tiene que ser un objeto JSON")
        return {}, rev.errores, rev.avisos
    out: dict = {"version": RECETA_VERSION}
    nombre = receta.get("nombre")
    if nombre is not None and (not isinstance(nombre, str) or len(nombre) > 120):
        rev.error("nombre", "hasta 120 caracteres")
    out["nombre"] = nombre.strip() if isinstance(nombre, str) and nombre.strip() else None
    out["datos"] = _datos(receta.get("datos"), rev)

    m = receta.get("modelo")
    mid = m.get("id") if isinstance(m, dict) else None
    if mid not in cat.MODELOS:
        rev.error("modelo.id", f"no existe el modelo {mid!r}" if mid else "falta el modelo")
        return out, rev.errores, rev.avisos
    mod = cat.MODELOS[mid]
    motor = mod["motor"]
    tarea = receta.get("tarea") or mod["tarea"]
    if tarea not in cat.TAREAS:
        rev.error("tarea", "es regresion, clasificacion, clustering o reduccion")
        tarea = mod["tarea"]
    if tarea != mod["tarea"]:
        rev.error("modelo.id", f"{mod['etiqueta']} es para {cat.TAREAS[mod['tarea']]['etiqueta'].lower()}, "
                               f"no para {cat.TAREAS[tarea]['etiqueta'].lower()}")
    out["tarea"] = tarea
    out["motor"] = motor

    obj = receta.get("objetivo")
    ref = receta.get("referencia")
    if tarea in SUPERVISADAS:
        if not isinstance(obj, str) or not obj:
            rev.error("objetivo", "elegí la columna que querés predecir")
            obj = None
        ref = None
    else:
        if obj:
            rev.aviso("objetivo", f"{cat.TAREAS[tarea]['etiqueta']} no usa columna objetivo: {obj} queda afuera", "info")
        obj = None
        if ref is not None and not isinstance(ref, str):
            rev.error("referencia", "es el nombre de una columna")
            ref = None
    out["objetivo"] = obj
    out["referencia"] = ref or None

    cols = receta.get("columnas")
    if not isinstance(cols, dict) or not cols:
        rev.error("columnas", "faltan los roles de las columnas: {columna: numerica | categorica | fecha | texto | id | ignorar}")
        cols = {}
    limpio = {}
    for c, rol in cols.items():
        if not isinstance(c, str) or not NOMBRE_COL.match(c):
            rev.error("columnas", f"nombre de columna inválido: {c!r}")
            continue
        if rol not in cat.ROLES:
            rev.error(f"columnas.{c}", f"el rol es {', '.join(cat.ROLES)}")
            continue
        limpio[c] = rol
    for especial in (obj, ref):
        if especial and especial in limpio:
            limpio[especial] = "ignorar"
    out["columnas"] = limpio
    variables = [c for c, r in limpio.items() if r in ("numerica", "categorica", "fecha", "texto")]
    if not variables:
        rev.error("columnas", "marcá al menos una columna como variable (numérica, categórica, fecha o texto)")
    if obj and obj in variables:
        rev.error("objetivo", "el objetivo no puede ser también una variable")

    out["preproceso"] = _preproceso(receta.get("preproceso"), rev)
    out["validacion"] = _validacion(receta.get("validacion"), tarea, motor, rev)
    ct = out["validacion"].get("columna_tiempo")
    if ct is not None and ct not in limpio and ct != obj:
        rev.error("validacion.columna_tiempo", f"{ct} no es una columna de los datos")
    out["modelo"] = {"id": mid, "params": params_modelo(mid, m.get("params"), rev)}
    out["busqueda"] = _busqueda(receta.get("busqueda"), mid, motor, tarea, out["validacion"], rev)
    out["informe"] = _informe(receta.get("informe"), tarea, motor, mid, rev)
    _por_modelo(out, mod, rev)
    if perfil:
        _con_perfil(out, perfil, rev)
    return out, rev.errores, rev.avisos


def _por_modelo(r: dict, mod: dict, rev: _Rev) -> None:
    pre, params = r["preproceso"], r["modelo"]["params"]
    tipos = set(r["columnas"].values())
    if mod.get("escala") and pre["escalar"] == "ninguno" and "numerica" in tipos:
        rev.aviso("preproceso.escalar", f"{mod['etiqueta']} mide distancias o usa gradientes: sin escalar, la columna con "
                                        "números más grandes manda sobre las demás")
    if pre["imputar_num"] == "ninguna" and not mod.get("nulos"):
        rev.aviso("preproceso.imputar_num", f"{mod['etiqueta']} no acepta nulos: si alguna numérica tiene, va a fallar")
    if mod["id"] == "logistica" and params.get("l1_ratio", 0) > 0 and params.get("solver") not in ("saga", "liblinear"):
        rev.error("modelo.params.solver", "con l1_ratio mayor a 0 (L1 o ElasticNet) el solver tiene que ser saga "
                                          "(o liblinear si l1_ratio = 1)")
    if mod["id"] in ("mlp_clf", "mlp_reg") and params.get("solver") == "lbfgs" and params.get("early_stopping"):
        rev.aviso("modelo.params.early_stopping", "lbfgs no usa parada temprana", "info")
    if mod["id"] == "aglomerativo" and params.get("linkage") == "ward" and params.get("metric", "euclidean") != "euclidean":
        rev.error("modelo.params.metric", "ward solo funciona con distancia euclídea")
    if pre["pca"] is not None and r["tarea"] == "reduccion":
        rev.error("preproceso.pca", "la tarea ya es PCA: sacá el PCA del preprocesamiento")
    if r["motor"] == "spark":
        if pre["outliers"] == "eliminar_iqr":
            rev.aviso("preproceso.outliers", "en Spark se recortan los extremos en lugar de sacar filas", "info")
        if pre["seleccion"] == "modelo":
            rev.error("preproceso.seleccion", "en Spark la selección es por varianza o por las k mejores")


def _con_perfil(r: dict, perfil: dict, rev: _Rev) -> None:
    info = {c["nombre"]: c for c in perfil.get("columnas", [])}
    filas = perfil.get("filas") or 0
    for c in r["columnas"]:
        if c not in info:
            rev.error(f"columnas.{c}", f"{c} no está en los datos")
    obj = r["objetivo"]
    if obj:
        if obj not in info:
            rev.error("objetivo", f"{obj} no está en los datos")
        else:
            o = info[obj]
            num = o.get("tipo") in ("int", "float")
            unicos = o.get("unicos") or 0
            if r["tarea"] == "regresion" and not num:
                rev.error("objetivo", f"{obj} no es numérica: para predecir una categoría elegí clasificación")
            if r["tarea"] == "clasificacion":
                if unicos > 200:
                    rev.error("objetivo", f"{obj} tiene {unicos} valores distintos: es para regresión, no clasificación")
                elif num and unicos > 20:
                    rev.aviso("objetivo", f"{obj} tiene {unicos} valores numéricos distintos: ¿no es regresión?")
                if unicos < 2:
                    rev.error("objetivo", f"{obj} tiene un solo valor: no hay nada que predecir")
                bal = o.get("balance") or []
                if bal:
                    menor = min(b["pct"] for b in bal)
                    if menor < 0.1:
                        rev.aviso("objetivo", f"clases desbalanceadas (la menor tiene {menor * 100:.1f} %): usá partición "
                                              "estratificada, class_weight=balanced y una métrica como F1 macro o PR AUC",
                                  "desbalance")
                    k = r["validacion"]["k"]
                    chica = min(b["n"] for b in bal)
                    if r["validacion"]["cv"] in ("estratificada", "kfold") and chica < k:
                        rev.error("validacion.k", f"la clase más chica tiene {chica} filas: no alcanza para {k} particiones")
                if r["motor"] == "spark" and cat.MODELOS[r["modelo"]["id"]].get("binaria") and unicos > 2:
                    rev.error("modelo.id", f"{cat.MODELOS[r['modelo']['id']]['etiqueta']} de Spark es solo para dos clases "
                                           f"({obj} tiene {unicos})")
                met = cat.METRICAS[r["validacion"]["metrica"]]
                if met.get("binaria") and unicos > 2:
                    rev.error("validacion.metrica", f"{met['etiqueta']} es para dos clases ({obj} tiene {unicos})")
                if met.get("spark_binaria") and r["motor"] == "spark" and unicos > 2:
                    rev.error("validacion.metrica", f"en Spark {met['etiqueta']} es solo para dos clases")
            if o.get("nulos"):
                rev.aviso("objetivo", f"{obj} tiene {o['nulos']} filas sin valor: se descartan", "info")
    for c, rol in r["columnas"].items():
        i = info.get(c)
        if not i or rol in ("ignorar",):
            continue
        if rol == "id":
            continue
        if i.get("rol") == "id" and rol in ("numerica", "categorica"):
            rev.aviso(f"columnas.{c}", f"{c} parece un identificador (casi todos los valores distintos): el modelo lo "
                                       "memoriza y no generaliza. Marcalo como id.", "id")
        asoc = (i.get("asociacion") or {}).get("valor")
        if obj and asoc is not None and asoc >= 0.97:
            rev.aviso(f"columnas.{c}", f"{c} predice a {obj} casi perfecto ({asoc:.2f}): ¿no se calcula a partir del "
                                       "objetivo o se conoce después? Es una posible fuga de datos.", "fuga")
        if rol == "numerica" and i.get("tipo") not in ("int", "float", "bool"):
            rev.error(f"columnas.{c}", f"{c} no es numérica en los datos (es {i.get('tipo')}): marcala como categórica o texto")
        if rol == "categorica" and (i.get("unicos") or 0) > max(r["preproceso"]["max_categorias"], 50) \
                and r["preproceso"]["codificar"] == "onehot":
            rev.aviso(f"columnas.{c}", f"{c} tiene {i['unicos']} categorías: one-hot agrupa las menos frecuentes "
                                       f"(quedan {r['preproceso']['max_categorias']})", "info")
        if rol == "fecha" and i.get("tipo") not in ("fecha", "str"):
            rev.aviso(f"columnas.{c}", f"{c} no parece una fecha", "info")
        if (i.get("unicos") or 0) <= 1 and rol in ("numerica", "categorica"):
            rev.aviso(f"columnas.{c}", f"{c} tiene un solo valor: no aporta nada", "info")
    ct = r["validacion"].get("columna_tiempo")
    if ct and ct in info and info[ct].get("tipo") not in ("fecha", "int", "float", "str"):
        rev.error("validacion.columna_tiempo", f"{ct} no sirve para ordenar en el tiempo")
    mod = cat.MODELOS[r["modelo"]["id"]]
    lim = r["datos"].get("limite") or filas
    if mod.get("max_filas") and lim > mod["max_filas"]:
        rev.error("datos.limite", f"{mod['etiqueta']} usa memoria cuadrática: hasta {mod['max_filas']:,} filas "
                                  "(poné un límite de filas)".replace(",", "."))
    if mod["id"] in ("svc", "svr") and lim > 30000:
        rev.aviso("modelo.id", f"SVM tarda en cuadrado de las filas: con {lim:,} filas puede tardar mucho".replace(",", "."))
    if r["referencia"] and r["referencia"] not in info:
        rev.error("referencia", f"{r['referencia']} no está en los datos")


def validar(receta, perfil: dict | None = None) -> dict:
    """La receta normalizada; RecetaInvalida si tiene errores."""
    out, errores, _ = normalizar(receta, perfil)
    if errores:
        raise RecetaInvalida(errores)
    return out


def huella(receta: dict) -> str:
    """Hash corto de lo que cambia el resultado (sin el nombre): dos corridas con la misma huella son la misma receta."""
    r = {k: v for k, v in receta.items() if k != "nombre"}
    texto = json.dumps(r, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(texto.encode()).hexdigest()[:12]


def variables(receta: dict) -> dict[str, list[str]]:
    """{rol: [columnas]} solo de las que entran al modelo, en el orden de la receta."""
    out: dict[str, list[str]] = {"numerica": [], "categorica": [], "fecha": [], "texto": []}
    for c, rol in receta["columnas"].items():
        if rol in out and c != receta.get("objetivo"):
            out[rol].append(c)
    return out


def copia(receta: dict) -> dict:
    return copy.deepcopy(receta)
