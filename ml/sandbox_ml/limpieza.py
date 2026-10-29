"""La receta de limpieza, columna por columna: validarla, generar su PySpark y la vista previa antes/después.

    {"nombre": "ventas", "version": 3, "pasos": [
        {"tipo": "regex", "columna": "precio", "patron": "[$.]", "reemplazo": ""},
        {"tipo": "tipo", "columna": "precio", "a": "double"},
        {"tipo": "nulos", "columna": "precio", "estrategia": "mediana", "indicador": true},
        {"tipo": "duplicados", "columnas": ["id_venta"]},
        {"tipo": "filtro", "condicion": "cantidad > 0"},
        ...]}

Cada paso cae en una de dos fases:

    entrenamiento  duplicados, filtros y "sacar filas": se aplican a los datos con los que se
                   entrena, antes de partir. Los datos nuevos no pasan por acá.
    modelo         todo lo demás: tipos, texto, regex, fechas, nulos, extremos, categorías raras,
                   mapeos y columnas derivadas. Va ADENTRO del modelo (el paso Limpiar del
                   Pipeline, transformadores_spark.py): al predecir se aplica igual. Lo que se
                   aprende (medianas, bordes, categorías) sale solo del entrenamiento.

Los pasos sobre la columna objetivo son siempre de entrenamiento (los datos nuevos no la traen).

    python3 -m sandbox_ml.limpieza '{"datos": {...}, "limpieza": {...}, "objetivo": "vuelve", "filas": 5000}'

corre la vista previa en Spark local sobre una muestra e imprime '@@limpieza@@ {json}': por paso, las
filas que tocó, lo que aprendió y ejemplos antes/después (o '@@error@@ {json}').
No importa Spark salvo para la vista previa.
"""
from __future__ import annotations

import inspect
import json
import math
import re
import sys
import time
from pathlib import Path

from . import fuentes

MAX_PASOS = 100
NOMBRE_COL = re.compile(r"^[^\x00-\x1f`]{1,120}$")
NOMBRE_RECETA = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_ .\-]{0,59}$")
PARTES_FECHA = ("anio", "mes", "dia", "dia_semana", "hora")
OPS_TEXTO = ("recortar", "espacios", "sin_acentos", "minusculas", "mayusculas", "vacio_a_nulo")
ROLES = ("numerica", "categorica", "fecha", "texto", "id", "ignorar")
# En la columna objetivo: lo que no aprende nada (y los que sacan filas)
EN_OBJETIVO = ("tipo", "texto", "regex", "mapeo", "fecha")
VISTA_FILAS = 5000
EJEMPLOS = 8

PASOS = {
    "tipo": {"etiqueta": "tipo", "fase": "modelo",
             "ayuda": "Convierte la columna a otro tipo (texto a número, a fecha...). Lo que no se puede convertir queda vacío: "
                      "mirá las filas afectadas."},
    "texto": {"etiqueta": "texto", "fase": "modelo",
              "ayuda": "Recorta espacios, junta los repetidos, saca acentos, pasa a minúsculas o mayúsculas y convierte "
                       "los vacíos en nulos. «Frecuente», «frecuente » y «FRECUENTE» pasan a ser la misma categoría."},
    "regex": {"etiqueta": "expresión regular", "fase": "modelo",
              "ayuda": "Reemplaza lo que coincide con el patrón (los grupos son $1, $2...) o extrae un grupo a la misma "
                       "columna o a una nueva. Es el regex de Java: \\d, \\s, [^0-9] andan igual que en Python."},
    "fecha": {"etiqueta": "fecha", "fase": "modelo",
              "ayuda": "Lee el texto como fecha con un formato (dd/MM/yyyy, yyyy-MM-dd HH:mm...) y puede separar año, mes, "
                       "día, día de la semana y hora en columnas numéricas."},
    "nulos": {"etiqueta": "nulos", "fase": "modelo",
              "ayuda": "Rellena los vacíos con la media, la mediana o la más común DEL ENTRENAMIENTO, o con un valor fijo. "
                       "La columna indicadora (0/1) guarda dónde faltaba: a veces que falte es información. "
                       "«Sacar las filas» es solo de entrenamiento."},
    "outliers": {"etiqueta": "extremos", "fase": "modelo",
                 "ayuda": "Bordes con el rango intercuartil (Q1 − k·IQR, Q3 + k·IQR), con percentiles o con z (media ± z·desvío), "
                          "calculados con el entrenamiento. Recortar lleva al borde; vaciar los deja nulos; sacar filas es "
                          "solo de entrenamiento (y se calcula antes de partir)."},
    "raras": {"etiqueta": "categorías raras", "fase": "modelo",
              "ayuda": "Junta en «(otra)» las categorías que aparecen menos que el mínimo en el entrenamiento: evita miles "
                       "de columnas one-hot y categorías que el modelo vio dos veces."},
    "mapeo": {"etiqueta": "mapeo", "fase": "modelo",
              "ayuda": "Cambia valores por otros (si → 1, «Bs As» → «Buenos Aires»). Lo que no está en la tabla se deja, "
                       "se vacía o pasa a un valor fijo."},
    "derivada": {"etiqueta": "columna derivada", "fase": "modelo",
                 "ayuda": "Una columna nueva con una expresión de Spark SQL sobre las demás: precio * cantidad, "
                          "datediff(fecha_entrega, fecha), length(comentario)..."},
    "duplicados": {"etiqueta": "duplicados", "fase": "entrenamiento",
                   "ayuda": "Saca las filas repetidas (en todas las columnas o en las que elijas, como un id). Se hace antes "
                            "de partir: si no, la misma fila puede caer en entrenamiento y en prueba."},
    "filtro": {"etiqueta": "filtro", "fase": "entrenamiento",
               "ayuda": "Deja solo las filas que cumplen una condición de Spark SQL (cantidad > 0, pais = 'AR'). Ve las "
                        "columnas como vienen en los datos, antes de la limpieza del modelo."},
}
OPCIONES = {
    "texto": [{"valor": "recortar", "etiqueta": "recortar espacios"}, {"valor": "espacios", "etiqueta": "juntar espacios"},
              {"valor": "sin_acentos", "etiqueta": "sin acentos"}, {"valor": "minusculas", "etiqueta": "minúsculas"},
              {"valor": "mayusculas", "etiqueta": "mayúsculas"}, {"valor": "vacio_a_nulo", "etiqueta": "vacío → nulo"}],
    "estrategia": [{"valor": "mediana", "etiqueta": "mediana"}, {"valor": "media", "etiqueta": "media"},
                   {"valor": "moda", "etiqueta": "la más común"}, {"valor": "constante", "etiqueta": "un valor fijo"},
                   {"valor": "eliminar", "etiqueta": "sacar las filas (entrenamiento)"}],
    "metodo": [{"valor": "iqr", "etiqueta": "IQR (Tukey)"}, {"valor": "percentiles", "etiqueta": "percentiles"},
               {"valor": "zscore", "etiqueta": "z (desvíos)"}],
    "accion": [{"valor": "recortar", "etiqueta": "recortar al borde"}, {"valor": "nulo", "etiqueta": "vaciar"},
               {"valor": "eliminar", "etiqueta": "sacar las filas (entrenamiento)"}],
    "resto": [{"valor": "conservar", "etiqueta": "dejarlo"}, {"valor": "nulo", "etiqueta": "vaciarlo"},
              {"valor": "valor", "etiqueta": "un valor fijo"}],
    "modo": [{"valor": "reemplazar", "etiqueta": "reemplazar"}, {"valor": "extraer", "etiqueta": "extraer un grupo"}],
    "a": [{"valor": t, "etiqueta": t} for t in fuentes.TIPOS_ESQUEMA],
    "partes": [{"valor": p, "etiqueta": e} for p, e in zip(PARTES_FECHA, ("año", "mes", "día", "día de la semana", "hora"))],
}
FACTOR = {"iqr": (0.5, 10.0, 1.5), "percentiles": (0.1, 25.0, 1.0), "zscore": (1.0, 10.0, 3.0)}


def como_json() -> dict:
    return {"pasos": PASOS, "opciones": OPCIONES, "factor": {k: {"min": a, "max": b, "defecto": c} for k, (a, b, c) in FACTOR.items()}}


# ---------------------------------------------------------------- SQL (también van tal cual al script generado)

def q(c):
    """El nombre de una columna para Spark SQL (entre acentos graves)."""
    return "`" + str(c).replace("`", "``") + "`"


def sql(v):
    """Un valor de Python como literal de Spark SQL."""
    import datetime
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return repr(v).upper() + "D" if v == v and abs(v) != float("inf") else "NULL"
    if isinstance(v, datetime.datetime):
        return "TIMESTAMP '" + v.isoformat(sep=" ") + "'"
    if isinstance(v, datetime.date):
        return "DATE '" + v.isoformat() + "'"
    if hasattr(v, "is_finite"):     # Decimal
        return sql(float(v))
    return "'" + str(v).replace("\\", "\\\\").replace("'", "\\'") + "'"


# ---------------------------------------------------------------- lo que se aprende (también va al script)

def mediana(df, c):
    """La mediana aproximada de la columna (error relativo 0,001), sin los nulos."""
    v = df.select(F.col(q(c)).cast("double").alias("v")).approxQuantile("v", [0.5], 0.001)
    return v[0] if v else None


def media(df, c):
    return df.agg(F.avg(F.col(q(c)).cast("double"))).first()[0]


def moda(df, c):
    """El valor más común (sin contar los nulos); si empatan, el menor."""
    fila = (df.where(F.col(q(c)).isNotNull()).groupBy(F.col(q(c)).alias("v")).count()
            .orderBy(F.desc("count"), "v").first())
    return fila["v"] if fila else None


def bordes(df, c, metodo, factor):
    """(bajo, alto): los bordes de los valores extremos, o (None, None) si la columna está vacía."""
    v = df.select(F.col(q(c)).cast("double").alias("v"))
    if metodo == "zscore":
        m, s = v.agg(F.avg("v"), F.stddev("v")).first()
        return (m - factor * s, m + factor * s) if m is not None and s is not None else (None, None)
    if metodo == "percentiles":
        qs = v.approxQuantile("v", [factor / 100, 1 - factor / 100], 0.001)
        return (qs[0], qs[1]) if len(qs) == 2 else (None, None)
    qs = v.approxQuantile("v", [0.25, 0.75], 0.001)
    if len(qs) < 2:
        return None, None
    return qs[0] - factor * (qs[1] - qs[0]), qs[1] + factor * (qs[1] - qs[0])


def frecuentes(df, c, min_pct, max_n):
    """Las categorías que aparecen al menos en min_pct de las filas (las max_n más comunes)."""
    v = df.select(F.col(q(c)).cast("string").alias("v")).where("v IS NOT NULL")
    total = v.count()
    filas = (v.groupBy("v").count().where(F.col("count") >= min_pct * total)
             .orderBy(F.desc("count"), "v").limit(max_n).collect())
    return [f["v"] for f in filas]


def agrupar_raras(c, conservar, otra):
    """CASE que deja las categorías de `conservar` y junta el resto en `otra` (los nulos siguen nulos)."""
    t = "CAST(" + q(c) + " AS STRING)"
    if not conservar:
        return "CASE WHEN " + q(c) + " IS NULL THEN NULL ELSE " + sql(otra) + " END"
    return ("CASE WHEN " + q(c) + " IS NULL THEN NULL WHEN " + t + " IN (" + ", ".join(sql(x) for x in conservar)
            + ") THEN " + t + " ELSE " + sql(otra) + " END")


def en_bordes(c, bajo, alto, accion):
    """La expresión que recorta (o vacía) lo que queda fuera de [bajo, alto]."""
    x = "CAST(" + q(c) + " AS DOUBLE)"
    if accion == "nulo":
        return "CASE WHEN " + x + " < " + sql(bajo) + " OR " + x + " > " + sql(alto) + " THEN NULL ELSE " + x + " END"
    return ("CASE WHEN " + x + " < " + sql(bajo) + " THEN " + sql(bajo) + " WHEN " + x + " > " + sql(alto)
            + " THEN " + sql(alto) + " ELSE " + x + " END")


class PasosLimpieza:
    """La limpieza que va adentro del modelo: [columna, expresión] en orden, en un solo paso Limpiar del Pipeline."""

    def __init__(self):
        self.expresiones = []   # [[columna, expresión de Spark SQL], ...]
        self.pasos = []         # de qué paso de la receta salió cada expresión

    def poner(self, columna, expresion, paso=None):
        """Reemplaza la columna (o la agrega) con el resultado de la expresión."""
        self.expresiones.append([columna, expresion])
        self.pasos.append(paso)

    def etapa(self, hasta=None):
        return Limpiar(expresiones=json.dumps(self.expresiones[:hasta], ensure_ascii=False))

    def aplicar(self, df, hasta=None):
        """Los datos con la limpieza hasta acá (para aprender el paso siguiente sobre datos ya limpios)."""
        return self.etapa(hasta).transform(df) if self.expresiones[:hasta] else df


AYUDANTES = (q, sql, mediana, media, moda, bordes, frecuentes, agrupar_raras, en_bordes, PasosLimpieza)


# ---------------------------------------------------------------- validar

def fase(p: dict, objetivo: str | None) -> str:
    """entrenamiento (solo los datos con los que se entrena) o modelo (adentro del Pipeline)."""
    if p["tipo"] in ("duplicados", "filtro"):
        return "entrenamiento"
    if p["tipo"] == "nulos" and p.get("estrategia") == "eliminar":
        return "entrenamiento"
    if p["tipo"] == "outliers" and p.get("accion") == "eliminar":
        return "entrenamiento"
    if objetivo and p.get("columna") == objetivo:
        return "entrenamiento"
    return "modelo"


def creadas(p: dict) -> dict[str, str]:
    """{columna nueva: rol sugerido} que agrega el paso."""
    t, c = p["tipo"], p.get("columna")
    if t == "nulos" and p.get("indicador"):
        return {f"{c}_nulo": "numerica"}
    if t == "fecha":
        return {f"{c}_{x}": "numerica" for x in p.get("partes") or []}
    if t == "regex" and p.get("destino") and p["destino"] != c:
        return {p["destino"]: "categorica"}
    if t == "derivada":
        return {p["nombre"]: p.get("rol", "numerica")}
    return {}


def toca(p: dict) -> list[str]:
    """Las columnas que escribe el paso (las que se comparan antes y después)."""
    t, c = p["tipo"], p.get("columna")
    if t in ("duplicados", "filtro"):
        return []
    if t == "derivada":
        return [p["nombre"]]
    if t == "regex":
        return [p.get("destino") or c]
    return [c] + list(creadas(p))


def _num(v, lo, hi, entero=False) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi and (not entero or float(v).is_integer())


def normalizar(lim, objetivo: str | None = None, conocidas: list[str] | None = None) -> tuple[dict, list[dict], list[dict], dict]:
    """(limpieza completa, errores, avisos, {columna creada: rol}). conocidas: las columnas de los datos
    (del perfil); sin ellas no se revisa que existan."""
    err: list[dict] = []
    av: list[dict] = []

    def error(campo, mensaje):
        err.append({"campo": f"limpieza.{campo}" if campo else "limpieza", "mensaje": mensaje})

    if lim is None:
        return {"pasos": []}, err, av, {}
    if not isinstance(lim, dict):
        error("", "es {nombre, version, pasos: [...]}")
        return {"pasos": []}, err, av, {}
    out: dict = {}
    nombre = lim.get("nombre")
    if nombre not in (None, ""):
        if not isinstance(nombre, str) or not NOMBRE_RECETA.match(nombre):
            error("nombre", "letras, números, espacios, punto, guion y guion bajo (hasta 60)")
        else:
            out["nombre"] = nombre
    v = lim.get("version")
    if v is not None:
        if not isinstance(v, int) or isinstance(v, bool) or v < 1:
            error("version", "es un número de versión (1, 2, 3...)")
        else:
            out["version"] = v
    pasos = lim.get("pasos") or []
    if not isinstance(pasos, list):
        error("pasos", "es una lista de pasos")
        pasos = []
    if len(pasos) > MAX_PASOS:
        error("pasos", f"hasta {MAX_PASOS} pasos")
        pasos = pasos[:MAX_PASOS]
    hay = set(conocidas) if conocidas is not None else None
    nuevas: dict[str, str] = {}
    limpios = []
    for i, p in enumerate(pasos):
        n = len(err)
        lp = _paso(p, i, objetivo, hay, error, av)
        if lp is None:
            continue
        limpios.append(lp)
        if len(err) == n and lp.get("activo", True):
            for c, rol in creadas(lp).items():
                nuevas[c] = rol
                if hay is not None:
                    hay.add(c)
    out["pasos"] = limpios
    return out, err, av, nuevas


def _paso(p, i: int, objetivo, hay: set | None, error, av: list) -> dict | None:
    campo = f"pasos.{i}"
    if not isinstance(p, dict) or p.get("tipo") not in PASOS:
        error(campo, "el tipo de paso es " + ", ".join(PASOS))
        return None
    t = p["tipo"]
    o: dict = {"tipo": t}
    if p.get("activo") is False:
        o["activo"] = False
    nota = p.get("nota")
    if isinstance(nota, str) and nota.strip():
        o["nota"] = nota.strip()[:200]

    def col(k="columna", nueva=False):
        c = p.get(k)
        if not isinstance(c, str) or not NOMBRE_COL.match(c):
            error(f"{campo}.{k}", "elegí una columna" if not c else f"nombre de columna inválido: {c!r}")
            return None
        if not nueva and hay is not None and c not in hay:
            error(f"{campo}.{k}", f"{c} no está en los datos (ni la crea un paso anterior)")
        return c

    def texto(k, maximo, obligatorio=True, defecto=None):
        v = p.get(k, defecto)
        if v is None and not obligatorio:
            return None
        if not isinstance(v, str) or (obligatorio and not v) or len(v) > maximo or "\n" in v:
            error(f"{campo}.{k}", f"es un texto de una línea, hasta {maximo} caracteres")
            return defecto
        return v

    def opcion(k, validas, defecto):
        v = p.get(k, defecto)
        if v not in validas:
            error(f"{campo}.{k}", "es " + ", ".join(map(str, validas)))
            return defecto
        return v

    if t not in ("duplicados", "filtro", "derivada"):
        o["columna"] = col()
    if t == "tipo":
        o["a"] = opcion("a", fuentes.TIPOS_ESQUEMA, "double")
        if o["a"] in ("date", "timestamp") and p.get("formato"):
            o["formato"] = texto("formato", 60)
    elif t == "texto":
        ops = p.get("ops") or []
        if not isinstance(ops, list) or not ops or any(x not in OPS_TEXTO for x in ops):
            error(f"{campo}.ops", "elegí qué hacer: " + ", ".join(OPS_TEXTO))
            ops = [x for x in ops if x in OPS_TEXTO] if isinstance(ops, list) else []
        if "minusculas" in ops and "mayusculas" in ops:
            error(f"{campo}.ops", "minúsculas o mayúsculas, no las dos")
        o["ops"] = [x for x in OPS_TEXTO if x in ops]
    elif t == "regex":
        o["patron"] = texto("patron", 500)
        try:
            re.compile(o["patron"] or "")
        except re.error as e:
            error(f"{campo}.patron", f"la expresión regular no es válida: {e}")
        o["modo"] = opcion("modo", ("reemplazar", "extraer"), "reemplazar")
        if o["modo"] == "reemplazar":
            o["reemplazo"] = texto("reemplazo", 200, obligatorio=False, defecto="") or ""
        else:
            g = p.get("grupo", 1)
            if not _num(g, 0, 20, entero=True):
                error(f"{campo}.grupo", "es el número de grupo, de 0 a 20")
                g = 1
            o["grupo"] = int(g)
        if p.get("destino") and p.get("destino") != o.get("columna"):
            o["destino"] = col("destino", nueva=True)
    elif t == "fecha":
        f = p.get("formato")
        if f:
            o["formato"] = texto("formato", 60)
        o["con_hora"] = bool(p.get("con_hora", False))
        partes = p.get("partes") or []
        if not isinstance(partes, list) or any(x not in PARTES_FECHA for x in partes):
            error(f"{campo}.partes", "son " + ", ".join(PARTES_FECHA))
            partes = []
        o["partes"] = [x for x in PARTES_FECHA if x in partes]
    elif t == "nulos":
        o["estrategia"] = opcion("estrategia", ("mediana", "media", "moda", "constante", "eliminar"), "mediana")
        if o["estrategia"] == "constante":
            v = p.get("valor")
            if v is None or isinstance(v, (list, dict)) or (isinstance(v, str) and len(v) > 200):
                error(f"{campo}.valor", "falta el valor con el que se rellena")
            o["valor"] = v
        ind = p.get("indicador", False)
        if not isinstance(ind, bool):
            error(f"{campo}.indicador", "es sí o no")
        if ind and o["estrategia"] == "eliminar":
            error(f"{campo}.indicador", "si se sacan las filas no queda nada que marcar")
        o["indicador"] = ind is True and o["estrategia"] != "eliminar"
    elif t == "outliers":
        o["metodo"] = opcion("metodo", tuple(FACTOR), "iqr")
        lo, hi, defecto = FACTOR[o["metodo"]]
        k = p.get("factor", defecto)
        if not _num(k, lo, hi):
            error(f"{campo}.factor", f"va de {lo} a {hi}")
            k = defecto
        o["factor"] = float(k)
        o["accion"] = opcion("accion", ("recortar", "nulo", "eliminar"), "recortar")
    elif t == "raras":
        mp = p.get("min_pct", 0.01)
        if not _num(mp, 0.0, 0.5):
            error(f"{campo}.min_pct", "es una proporción de 0 a 0,5 (0,01 = 1 %)")
            mp = 0.01
        o["min_pct"] = float(mp)
        mx = p.get("max_categorias", 50)
        if not _num(mx, 1, 1000, entero=True):
            error(f"{campo}.max_categorias", "va de 1 a 1000")
            mx = 50
        o["max_categorias"] = int(mx)
        o["otra"] = texto("otra", 60, defecto="(otra)") or "(otra)"
    elif t == "mapeo":
        m = p.get("mapa")
        if not isinstance(m, dict) or not m or len(m) > 500:
            error(f"{campo}.mapa", "falta la tabla de valores (de → a), hasta 500")
            m = {}
        limpio = {}
        for k, v in m.items():
            if not isinstance(k, str) or len(k) > 200 or isinstance(v, (list, dict)) or (isinstance(v, str) and len(v) > 200):
                error(f"{campo}.mapa", f"valor inválido: {k!r} → {v!r}")
                continue
            limpio[k] = v
        o["mapa"] = limpio
        o["resto"] = opcion("resto", ("conservar", "nulo", "valor"), "conservar")
        if o["resto"] == "valor":
            o["otro"] = p.get("otro")
            if o["otro"] is None or isinstance(o["otro"], (list, dict)):
                error(f"{campo}.otro", "falta el valor para lo que no está en la tabla")
    elif t == "derivada":
        o["nombre"] = col("nombre", nueva=True)
        o["expresion"] = texto("expresion", 1000)
        if o["expresion"] and ";" in o["expresion"]:
            error(f"{campo}.expresion", "es una sola expresión de Spark SQL (sin ;)")
        o["rol"] = opcion("rol", ROLES, "numerica")
    elif t == "duplicados":
        cols = p.get("columnas") or []
        if not isinstance(cols, list) or any(not isinstance(c, str) for c in cols):
            error(f"{campo}.columnas", "es una lista de columnas (vacía = todas)")
            cols = []
        if hay is not None:
            for c in cols:
                if c not in hay:
                    error(f"{campo}.columnas", f"{c} no está en los datos")
        o["columnas"] = cols
    elif t == "filtro":
        o["condicion"] = texto("condicion", fuentes.MAX_FILTRO)
        if o["condicion"] and ";" in o["condicion"]:
            error(f"{campo}.condicion", "es una sola condición de Spark SQL (sin ;)")
    if objetivo and o.get("columna") == objetivo:
        quita = (t == "nulos" and o["estrategia"] == "eliminar") or (t == "outliers" and o["accion"] == "eliminar")
        if t not in EN_OBJETIVO and not quita:
            error(campo, f"{objetivo} es el objetivo: ahí solo valen pasos que no aprenden nada (tipo, texto, regex, mapeo, "
                         "fecha) o los que sacan filas; los datos nuevos no traen el objetivo")
        elif t == "fecha" and o["partes"]:
            error(f"{campo}.partes", f"{objetivo} es el objetivo: no se le sacan partes")
        elif t == "regex" and o.get("destino"):
            error(f"{campo}.destino", f"{objetivo} es el objetivo: el resultado va a la misma columna")
    if t == "outliers" and o["accion"] == "eliminar":
        av.append({"campo": f"limpieza.{campo}", "tipo": "info",
                   "mensaje": "sacar filas por extremos se calcula y se aplica antes de partir: también saca filas de la prueba"})
    return o


# ---------------------------------------------------------------- generar el código

def expresiones(p: dict) -> list[tuple[str, str]]:
    """[(columna, expresión)] de los pasos que no aprenden nada (tipo, texto, regex, fecha, mapeo, derivada, constante)."""
    t, c = p["tipo"], p.get("columna")
    if t == "tipo":
        if p["a"] in ("date", "timestamp") and p.get("formato"):
            f = "to_date" if p["a"] == "date" else "to_timestamp"
            return [(c, f"{f}(CAST({q(c)} AS STRING), {sql(p['formato'])})")]
        return [(c, f"CAST({q(c)} AS {p['a'].upper()})")]
    if t == "texto":
        x = f"CAST({q(c)} AS STRING)"
        ops = p["ops"]
        if "recortar" in ops:
            x = f"trim({x})"
        if "espacios" in ops:
            x = f"regexp_replace({x}, {sql(chr(92) + 's+')}, ' ')"
        if "sin_acentos" in ops:
            x = f"translate({x}, 'áéíóúàèìòùäëïöüâêîôûñçÁÉÍÓÚÀÈÌÒÙÄËÏÖÜÂÊÎÔÛÑÇ', 'aeiouaeiouaeiouaeiouncAEIOUAEIOUAEIOUAEIOUNC')"
        if "minusculas" in ops:
            x = f"lower({x})"
        if "mayusculas" in ops:
            x = f"upper({x})"
        if "vacio_a_nulo" in ops:
            x = f"nullif(trim({x}), '')"
        return [(c, x)]
    if t == "regex":
        x = f"CAST({q(c)} AS STRING)"
        destino = p.get("destino") or c
        if p["modo"] == "extraer":
            return [(destino, f"nullif(regexp_extract({x}, {sql(p['patron'])}, {p['grupo']}), '')")]
        return [(destino, f"regexp_replace({x}, {sql(p['patron'])}, {sql(p['reemplazo'])})")]
    if t == "fecha":
        x = f"CAST({q(c)} AS STRING)"
        if p.get("formato"):
            f = "to_timestamp" if p["con_hora"] else "to_date"
            out = [(c, f"{f}({x}, {sql(p['formato'])})")]
        else:
            out = [(c, f"CAST({q(c)} AS {'TIMESTAMP' if p['con_hora'] else 'DATE'})")]
        fn = {"anio": "year({})", "mes": "month({})", "dia": "dayofmonth({})", "dia_semana": "(dayofweek({}) + 5) % 7",
              "hora": "hour({})"}
        return out + [(f"{c}_{x}", fn[x].format(q(c))) for x in p["partes"]]
    if t == "mapeo":
        casos = " ".join(f"WHEN {sql(k)} THEN {sql(v)}" for k, v in p["mapa"].items())
        resto = {"conservar": q(c), "nulo": "NULL"}.get(p["resto"]) or sql(p.get("otro"))
        return [(c, f"CASE CAST({q(c)} AS STRING) {casos} ELSE {resto} END")]
    if t == "derivada":
        return [(p["nombre"], f"({p['expresion']})")]
    if t == "nulos" and p["estrategia"] == "constante":
        out = [(f"{c}_nulo", f"CAST({q(c)} IS NULL AS INT)")] if p["indicador"] else []
        return out + [(c, f"coalesce({q(c)}, {sql(p['valor'])})")]
    raise ValueError(f"el paso {t} aprende con los datos: no tiene una expresión fija")


def titulo_paso(p: dict) -> str:
    t, c = p["tipo"], p.get("columna")
    if t == "tipo":
        return f"{c} → {p['a']}" + (f" ({p['formato']})" if p.get("formato") else "")
    if t == "texto":
        return f"{c}: " + ", ".join(o["etiqueta"] for o in OPCIONES["texto"] if o["valor"] in p["ops"])
    if t == "regex":
        return f"{c}: {'extraer' if p['modo'] == 'extraer' else 'reemplazar'} /{p['patron']}/" + (
            f" → {p['destino']}" if p.get("destino") else "")
    if t == "fecha":
        return f"{c} como fecha" + (f" ({p['formato']})" if p.get("formato") else "") + (
            f" y {', '.join(p['partes'])}" if p["partes"] else "")
    if t == "nulos":
        e = next(o["etiqueta"] for o in OPCIONES["estrategia"] if o["valor"] == p["estrategia"])
        return f"nulos de {c}: {e}" + (f" ({p['valor']!r})" if p["estrategia"] == "constante" else "") + (
            f", con {c}_nulo" if p["indicador"] else "")
    if t == "outliers":
        return f"extremos de {c}: {p['metodo']} {p['factor']:g}, {p['accion']}"
    if t == "raras":
        return f"categorías raras de {c}: menos de {p['min_pct'] * 100:g} % → {p['otra']}"
    if t == "mapeo":
        return f"{c}: {len(p['mapa'])} valores cambiados"
    if t == "derivada":
        return f"{p['nombre']} = {p['expresion']}"
    if t == "duplicados":
        return "duplicados" + (f" por {', '.join(p['columnas'])}" if p["columnas"] else " (todas las columnas)")
    return f"filtro: {p['condicion']}"


def bloque_entrenamiento(i: int, p: dict) -> list[str]:
    """Las líneas que limpian `datos` (antes de partir) en el paso i."""
    t, c = p["tipo"], p.get("columna")
    L = [f"# Paso {i + 1}: {titulo_paso(p)}"]
    if t == "filtro":
        L.append(f"datos = datos.filter({fuentes.lit(p['condicion'])})")
    elif t == "duplicados":
        L.append(f"datos = datos.dropDuplicates({fuentes.lit(p['columnas'])})" if p["columnas"] else "datos = datos.dropDuplicates()")
    elif t == "nulos":
        L.append(f"datos = datos.dropna(subset=[{fuentes.lit(c)}])")
    elif t == "outliers":
        L += [f"bajo, alto = bordes(datos, {fuentes.lit(c)}, {fuentes.lit(p['metodo'])}, {p['factor']!r})",
              f'APRENDIDO[{i + 1}] = {{"bajo": bajo, "alto": alto}}',
              "if bajo is not None:",
              f"    x = F.col(q({fuentes.lit(c)})).cast(\"double\")",
              "    datos = datos.filter(x.isNull() | x.between(bajo, alto))"]
    else:
        for col, e in expresiones(p):
            L.append(f"datos = datos.withColumn({fuentes.lit(col)}, F.expr({fuentes.lit(e)}))")
    return L


def bloque_modelo(i: int, p: dict) -> list[str]:
    """Las líneas que agregan el paso i a `limpieza` (aprendiendo con `ent` lo que haga falta)."""
    t, c = p["tipo"], p.get("columna")
    n = i + 1
    L = [f"# Paso {n}: {titulo_paso(p)}"]
    lc = fuentes.lit(c)
    if t == "nulos" and p["estrategia"] != "constante":
        L += ["base = limpieza.aplicar(ent)",
              f"valor = {p['estrategia']}(base, {lc})",
              f'APRENDIDO[{n}] = {{"{p["estrategia"]}": valor}}']
        if p["indicador"]:
            L.append(f"limpieza.poner({fuentes.lit(c + '_nulo')}, {fuentes.lit(f'CAST({q(c)} IS NULL AS INT)')}, paso={n})")
        L.append(f"limpieza.poner({lc}, {fuentes.lit('coalesce(' + q(c) + ', ')} + sql(valor) + \")\", paso={n})")
    elif t == "outliers":
        L += ["base = limpieza.aplicar(ent)",
              f"bajo, alto = bordes(base, {lc}, {fuentes.lit(p['metodo'])}, {p['factor']!r})",
              f'APRENDIDO[{n}] = {{"bajo": bajo, "alto": alto}}',
              "if bajo is not None:",
              f"    limpieza.poner({lc}, en_bordes({lc}, bajo, alto, {fuentes.lit(p['accion'])}), paso={n})"]
    elif t == "raras":
        L += ["base = limpieza.aplicar(ent)",
              f"conservar = frecuentes(base, {lc}, {p['min_pct']!r}, {p['max_categorias']})",
              f'APRENDIDO[{n}] = {{"conservar": conservar}}',
              f"limpieza.poner({lc}, agrupar_raras({lc}, conservar, {fuentes.lit(p['otra'])}), paso={n})"]
    else:
        for col, e in expresiones(p):
            L.append(f"limpieza.poner({fuentes.lit(col)}, {fuentes.lit(e)}, paso={n})")
    return L


def activos(lim: dict | None) -> list[tuple[int, dict]]:
    return [(i, p) for i, p in enumerate((lim or {}).get("pasos") or []) if p.get("activo", True)]


def por_fase(lim: dict | None, objetivo: str | None) -> tuple[list[tuple[int, dict]], list[tuple[int, dict]]]:
    ps = activos(lim)
    return ([(i, p) for i, p in ps if fase(p, objetivo) == "entrenamiento"],
            [(i, p) for i, p in ps if fase(p, objetivo) == "modelo"])


def fuente_limpiar() -> str:
    """El código de la clase Limpiar (transformadores_spark.py), para copiarla en el script."""
    texto = Path(__file__).with_name("transformadores_spark.py").read_text(encoding="utf-8")
    return "class Limpiar" + texto.split("\nclass Limpiar", 1)[1].rstrip()


def cabecera(usa_modelo: bool = True) -> list[str]:
    """La importación de Limpiar y las funciones de ayuda que usan los pasos."""
    L = []
    if usa_modelo:
        L += ["try:",
              "    from sandbox_ml.transformadores_spark import Limpiar   # el paso del Pipeline que limpia",
              "except ImportError:  # fuera del sandbox: la misma clase, copiada de sandbox_ml/transformadores_spark.py",
              "    from pyspark import keyword_only",
              "    from pyspark.ml import Transformer",
              "    from pyspark.ml.param import Param, Params, TypeConverters",
              "    from pyspark.ml.util import DefaultParamsReadable, DefaultParamsWritable",
              ""]
        L += ["    " + x if x else "" for x in fuente_limpiar().splitlines()]
        L.append("")
    L += ["", "# Lo que aprendió cada paso (medianas, bordes, categorías): queda escrito en el modelo", "APRENDIDO = {}"]
    for f in AYUDANTES:
        if not usa_modelo and f is PasosLimpieza:
            continue
        L += ["", ""] + inspect.getsource(f).rstrip().splitlines()
    return L


def script(d: dict, lim: dict, objetivo: str | None = None, fecha: str = "") -> str:
    """Un script de PySpark autónomo que limpia los datos con esta receta y los guarda limpios en HDFS (Parquet),
    junto con el paso Limpiar como PipelineModel (lo mismo que después va adentro de cada modelo)."""
    entrena, modelo = por_fase(lim, objetivo)
    base = (d.get("ruta") or d.get("tabla") or "datos").rstrip("/").rsplit("/", 1)[-1].split(".")[0]
    nombre = re.sub(r"[^A-Za-z0-9_\-]+", "_", lim.get("nombre") or base).strip("_") or "datos"
    destino = f"/user/root/ml/limpios/{nombre}" + (f"-v{lim['version']}" if lim.get("version") else "")
    master = "local[2]" if d["origen"] == "local" else "yarn"
    lit = fuentes.lit
    L = ["# %% [markdown]", f"# # Limpieza de {base}" + (f" (versión {lim['version']})" if lim.get("version") else ""), "#",
         f"# Generado por el estudio de ML de BigData Sandbox{' el ' + fecha if fecha else ''}.",
         f"# Se corre con `spark-submit --master {master} limpieza_{nombre}.py`.",
         "#",
         "# - **Solo de entrenamiento** (duplicados, filtros, filas que se sacan): se aplican a estos datos.",
         "# - **Adentro del modelo** (tipos, texto, nulos, extremos, categorías...): el paso `Limpiar` del Pipeline.",
         "#   Acá se aprende con todas las filas; en el entrenamiento, solo con las de entrenamiento.",
         "", "# %% Librerías y Spark", "import json", "", "from pyspark.ml import PipelineModel",
         "from pyspark.sql import SparkSession, functions as F", ""]
    L += cabecera(usa_modelo=True)
    L += ["", "", f"DESTINO = {lit(destino)}",
          f'spark = SparkSession.builder.appName({lit("estudio-ml: limpieza de " + base)})'
          + (".enableHiveSupport()" if d["origen"] == "hive" else "") + ".getOrCreate()",
          "", "# %% 1. Leer los datos"]
    L += fuentes.codigo_lector(d, lit("file://" + d["ruta"]) if d["origen"] == "local" else None)
    L += ["datos = datos.cache()", "filas = datos.count()", 'print(f"Leídas: {filas:,} filas y {len(datos.columns)} columnas")']
    if entrena:
        L += ["", "# %% 2. Limpieza solo de entrenamiento (cuántas filas quedan después de cada paso)"]
        for i, p in entrena:
            L += bloque_entrenamiento(i, p)
            L += ["datos = datos.cache()", "antes, filas = filas, datos.count()",
                  f'print(f"Paso {i + 1} ({p["tipo"]}): {{antes - filas:,}} filas menos, quedan {{filas:,}}")']
    L += ["", "# %% 3. Limpieza del modelo (acá aprende con todas las filas que quedaron)", "ent = datos",
          "limpieza = PasosLimpieza()"]
    for i, p in modelo:
        L += bloque_modelo(i, p)
    L += ["limpio = limpieza.aplicar(ent)",
          'print("Lo que aprendió cada paso:", json.dumps(APRENDIDO, ensure_ascii=False, default=str))',
          "for columna, expresion in limpieza.expresiones:",
          '    print(f"  {columna} = {expresion}")',
          "limpio.show(10, truncate=False)",
          "", "# %% 4. Guardar los datos limpios y el paso de limpieza",
          'limpio.write.mode("overwrite").parquet(DESTINO)',
          'PipelineModel(stages=[limpieza.etapa()]).write().overwrite().save(DESTINO + "_limpieza")',
          'print(f"Datos limpios en hdfs://{DESTINO} y la limpieza en hdfs://{DESTINO}_limpieza "',
          '      "(PipelineModel.load para aplicarla a datos nuevos)")',
          "spark.stop()"]
    return "\n".join(L) + "\n"


# ---------------------------------------------------------------- vista previa (Spark local, sobre una muestra)

def _py(v):
    import datetime
    import decimal
    if isinstance(v, float):
        return v if math.isfinite(v) else None
    if isinstance(v, (datetime.date, datetime.datetime)):
        return v.isoformat(sep=" ") if isinstance(v, datetime.datetime) else v.isoformat()
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, (list, tuple)):
        return [_py(x) for x in v]
    if isinstance(v, dict):
        return {str(k): _py(x) for k, x in v.items()}
    if v is None or isinstance(v, (bool, int, str)):
        return v
    return str(v)


def vista_previa(spark, datos, lim: dict, objetivo: str | None = None, ejemplos: int = EJEMPLOS) -> dict:
    """Corre los pasos sobre `datos` (una muestra chica, en caché) y devuelve, por paso: filas antes y después,
    filas afectadas, lo aprendido y ejemplos antes → después. Un paso que falla queda marcado y no se aplica."""
    from pyspark.sql import functions as F
    t0 = time.perf_counter()
    ns = {"spark": spark, "F": F, "json": json}
    exec(compile("\n".join(cabecera()), "<limpieza>", "exec"), ns)
    entrena, modelo = por_fase(lim, objetivo)
    actual = datos.localCheckpoint()   # sin linaje largo: cada paso arranca de una tabla chica ya calculada
    n_leidas = actual.count()
    pasos = []

    def resultado(i, p, **kw):
        r = {"paso": i, "tipo": p["tipo"], "titulo": titulo_paso(p), "fase": fase(p, objetivo), **kw}
        pasos.append(r)
        return r

    def comparar(antes, despues_fn, cols):
        """(afectadas, ejemplos): las filas donde cambió alguna de cols, con sus valores antes y después."""
        d = antes
        copias = {}
        for j, c in enumerate(cols):
            if c in antes.columns and c not in copias:
                copias[c] = f"__antes{j}"
                d = d.withColumn(copias[c], F.col(q(c)))
        d = despues_fn(d)
        # Afectadas: donde cambió alguna columna que ya estaba; si el paso solo agrega columnas, donde tienen valor
        cambio = None
        for c in (cols if not copias else [c for c in cols if c in copias]):
            x = ~F.col(copias[c]).eqNullSafe(F.col(q(c))) if c in copias else F.col(q(c)).isNotNull()
            cambio = x if cambio is None else cambio | x
        d = d.localCheckpoint()
        afect = d.where(cambio).count() if cambio is not None else 0
        sel, nombres = [], []
        for c in cols:
            if c in copias:
                sel.append(F.col(copias[c]))
                nombres.append(f"{c} (antes)")
            sel.append(F.col(q(c)))
            nombres.append(f"{c} (después)")
        filas = [list(map(_py, f)) for f in d.where(cambio).select(*sel).limit(ejemplos).collect()] if cambio is not None else []
        return afect, {"columnas": nombres, "filas": filas}, d.drop(*copias.values())

    for i, p in entrena:
        antes = actual
        n0 = antes.count()
        ns["datos"] = antes
        try:
            if p["tipo"] in ("filtro", "duplicados", "nulos", "outliers"):
                exec("\n".join(bloque_entrenamiento(i, p)), ns)
                despues = ns["datos"].localCheckpoint()
                n1 = despues.count()
                quitadas = antes.exceptAll(despues)
                ej = {"columnas": antes.columns, "filas": [list(map(_py, f)) for f in quitadas.limit(ejemplos).collect()]}
                resultado(i, p, ok=True, filas_antes=n0, filas_despues=n1, afectadas=n0 - n1, quita=True, ejemplos=ej,
                          aprendido=_py(ns["APRENDIDO"].get(i + 1)))
            else:
                exprs = expresiones(p)

                def aplicar(d, exprs=exprs):
                    for c, e in exprs:
                        d = d.withColumn(c, F.expr(e))
                    return d
                afect, ej, despues = comparar(antes, aplicar, toca(p))
                n1 = despues.count()
                resultado(i, p, ok=True, filas_antes=n0, filas_despues=n1, afectadas=afect, ejemplos=ej)
        except Exception as e:  # noqa: BLE001 — el error de Spark se muestra en el paso
            resultado(i, p, ok=False, error=fuentes.explicar_error(_texto_error(e)), filas_antes=n0)
            continue
        actual = despues
    ent = actual
    ns["ent"] = ent
    ns["limpieza"] = ns["PasosLimpieza"]()
    n_ent = ent.count()
    for i, p in modelo:
        lz = ns["limpieza"]
        k = len(lz.expresiones)
        antes = actual
        try:
            exec("\n".join(bloque_modelo(i, p)), ns)
            nuevas = lz.expresiones[k:]

            def aplicar(d, nuevas=nuevas):
                for c, e in nuevas:
                    d = d.withColumn(c, F.expr(e))
                return d
            afect, ej, despues = comparar(antes, aplicar, toca(p))
            resultado(i, p, ok=True, filas_antes=n_ent, filas_despues=n_ent, afectadas=afect, ejemplos=ej,
                      aprendido=_py(ns["APRENDIDO"].get(i + 1)), expresiones=[list(x) for x in nuevas])
        except Exception as e:  # noqa: BLE001
            del lz.expresiones[k:], lz.pasos[k:]
            resultado(i, p, ok=False, error=fuentes.explicar_error(_texto_error(e)), filas_antes=n_ent)
            continue
        actual = despues
    final = actual.limit(20).collect()
    pasos.sort(key=lambda r: r["paso"])
    return {"filas": {"leidas": n_leidas, "entrenamiento": n_ent}, "pasos": pasos,
            "final": {"columnas": actual.columns, "filas": [list(map(_py, f)) for f in final]},
            "expresiones": [list(x) for x in ns["limpieza"].expresiones],
            "segundos": round(time.perf_counter() - t0, 2)}


def _texto_error(e: BaseException) -> str:
    """El mensaje entero de una excepción de Spark (las de Py4J traen el de Java adentro)."""
    partes = [f"{type(e).__name__}: {e}"]
    java = getattr(e, "java_exception", None)
    if java is not None:
        try:
            partes.append(str(java.toString()))
        except Exception:  # noqa: BLE001
            pass
    return "\n".join(partes)


def main(argv: list[str]) -> None:
    pedido = json.loads(argv[1])
    try:
        from pyspark.sql import SparkSession, functions as F
        d = pedido["datos"]
        b = SparkSession.builder.master("local[2]").appName("estudio-ml: vista previa de la limpieza") \
            .config("spark.ui.enabled", "false").config("spark.sql.shuffle.partitions", "4")
        if d["origen"] == "hive":
            b = b.enableHiveSupport()
        spark = b.getOrCreate()
        spark.sparkContext.setLogLevel("ERROR")
        ns = {"spark": spark, "F": F}
        ruta = fuentes.lit("file://" + d["ruta"]) if d["origen"] == "local" else None
        exec("\n".join(fuentes.codigo_lector(d, ruta)), ns)
        filas = int(pedido.get("filas") or VISTA_FILAS)
        out = vista_previa(spark, ns["datos"].limit(filas), pedido.get("limpieza") or {}, pedido.get("objetivo"))
        out["muestra"] = filas
        print("@@limpieza@@ " + json.dumps(out, ensure_ascii=False), flush=True)
        spark.stop()
    except Exception as e:  # noqa: BLE001
        print("@@error@@ " + json.dumps(fuentes.explicar_error(_texto_error(e)), ensure_ascii=False), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv)
