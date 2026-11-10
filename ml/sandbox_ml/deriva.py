"""Deriva de los datos: cuánto se parecen los datos nuevos a los del entrenamiento.

Al registrar un experimento se guarda una **referencia** de cada variable de entrada, contada sobre el
entrenamiento:

    numérica    los cortes de los deciles y qué proporción de filas cae en cada tramo
    categórica  la proporción de las 20 categorías más comunes y de "(otras)"
    las dos     la proporción de nulos (un tramo más)

Con datos nuevos se cuentan las mismas proporciones, con los mismos cortes, y se comparan con el PSI
(índice de estabilidad de la población):

    PSI = Σ (p_nuevo − p_ref) · ln(p_nuevo / p_ref)

    menos de 0,1   estable
    0,1 a 0,25     moderada: mirar qué cambió
    más de 0,25    fuerte: el modelo está prediciendo sobre otra población

Se cuenta con pandas (scikit-learn, datos chicos) o con Spark en los executors: al driver llegan los
conteos, no las filas.

    from sandbox_ml import deriva
    ref = deriva.referencia_pandas(X_ent, variables)
    deriva.comparar(ref, deriva.contar_pandas(X_nuevos, ref))
"""
from __future__ import annotations

import math

DECILES = [i / 10 for i in range(1, 10)]
TOP = 20              # categorías que se guardan; el resto va a "(otras)"
EPS = 1e-4            # una proporción en 0 rompe el logaritmo: se reemplaza por esto
UMBRALES = [(0.1, "estable"), (0.25, "moderada")]
ORDEN = {"estable": 0, "moderada": 1, "fuerte": 2}
OTRAS = "(otras)"
NULOS = "(nulos)"


def nivel(psi: float | None) -> str | None:
    if psi is None:
        return None
    for tope, n in UMBRALES:
        if psi < tope:
            return n
    return "fuerte"


def psi(ref: list[float], nuevo: list[float]) -> float:
    total = 0.0
    for a, b in zip(ref, nuevo):
        a, b = max(a, EPS), max(b, EPS)
        total += (b - a) * math.log(b / a)
    return round(total, 4)


def _proporciones(conteos: list[int | float], n: int) -> list[float]:
    return [round(c / n, 6) if n else 0.0 for c in conteos]


def etiquetas(col: dict) -> list[str]:
    """El nombre de cada tramo, en el orden de las proporciones (el último, los nulos)."""
    if col["tipo"] == "numerica":
        c = col["cortes"]
        if not c:
            return ["todas", NULOS]
        f = [_corto(x) for x in c]
        return [f"≤ {f[0]}"] + [f"{f[i - 1]} a {f[i]}" for i in range(1, len(f))] + [f"> {f[-1]}", NULOS]
    return [str(x) for x in col["categorias"]] + [OTRAS, NULOS]


def _corto(x: float) -> str:
    return f"{x:.4g}"


# ---------------------------------------------------------------- pandas

def referencia_pandas(df, vars: dict[str, list[str]]) -> dict:
    """La referencia de las variables numéricas y categóricas de df (el entrenamiento)."""
    import numpy as np
    import pandas as pd
    n = len(df)
    cols: dict[str, dict] = {}
    for c in vars.get("numerica", []):
        if c not in df.columns:
            continue
        s = pd.to_numeric(df[c], errors="coerce")
        v = s.dropna().to_numpy(dtype=float)
        cortes = sorted({round(float(x), 6) for x in np.quantile(v, DECILES)}) if len(v) else []
        cols[c] = {"tipo": "numerica", "cortes": cortes,
                   "media": float(v.mean()) if len(v) else None, "desvio": float(v.std()) if len(v) else None}
        cols[c]["proporciones"] = _proporciones(_conteos_num(v, cortes) + [int(s.isna().sum())], n)
    for c in vars.get("categorica", []):
        if c not in df.columns:
            continue
        s = df[c].astype(str).where(df[c].notna())
        vc = s.value_counts(dropna=True)
        top = [str(x) for x in vc.index[:TOP]]
        conteos = [int(vc[x]) for x in vc.index[:TOP]]
        nulos = int(s.isna().sum())
        cols[c] = {"tipo": "categorica", "categorias": top,
                   "proporciones": _proporciones(conteos + [n - nulos - sum(conteos), nulos], n)}
    return {"filas": n, "columnas": cols}


def _conteos_num(v, cortes: list[float]) -> list[int]:
    import numpy as np
    if not cortes:
        return [len(v)]
    idx = np.searchsorted(np.asarray(cortes), v, side="left")      # tramo i: cortes[i-1] < v <= cortes[i]
    return np.bincount(idx, minlength=len(cortes) + 1).astype(int).tolist()


def contar_pandas(df, ref: dict) -> dict:
    """Las proporciones de df con los tramos de la referencia: {columna: [p, ...]} y las filas."""
    import pandas as pd
    n = len(df)
    out: dict[str, list[float] | None] = {}
    for c, r in ref["columnas"].items():
        if c not in df.columns:
            out[c] = None
            continue
        if r["tipo"] == "numerica":
            s = pd.to_numeric(df[c], errors="coerce")
            out[c] = _proporciones(_conteos_num(s.dropna().to_numpy(dtype=float), r["cortes"]) + [int(s.isna().sum())], n)
        else:
            s = df[c].astype(str).where(df[c].notna())
            vc = s.value_counts(dropna=True)
            conteos = [int(vc.get(x, 0)) for x in r["categorias"]]
            nulos = int(s.isna().sum())
            out[c] = _proporciones(conteos + [n - nulos - sum(conteos), nulos], n)
    return {"filas": n, "proporciones": out}


# ---------------------------------------------------------------- Spark

def referencia_spark(df, vars: dict[str, list[str]]) -> dict:
    """Lo mismo que referencia_pandas, contado en los executors: approxQuantile para los cortes, una pasada
    para los tramos y un groupBy por categórica."""
    from pyspark.sql import functions as F
    num = [c for c in vars.get("numerica", []) if c in df.columns]
    cat = [c for c in vars.get("categorica", []) if c in df.columns]
    d = df.select(*[F.col(c).cast("double").alias(c) for c in num], *[F.col(c).cast("string").alias(c) for c in cat])
    n = d.count()
    cortes: dict[str, list[float]] = {}
    if num and n:
        qs = d.approxQuantile(num, DECILES, 0.001)
        cortes = {c: sorted({round(float(x), 6) for x in q if x is not None}) for c, q in zip(num, qs)}
    momentos = {}
    if num and n:
        fila = d.agg(*[F.mean(c).alias(f"m_{i}") for i, c in enumerate(num)],
                     *[F.stddev_pop(c).alias(f"s_{i}") for i, c in enumerate(num)]).first()
        momentos = {c: (fila[f"m_{i}"], fila[f"s_{i}"]) for i, c in enumerate(num)}
    conteos = _conteos_spark(d, {c: cortes.get(c, []) for c in num}, cat)
    cols: dict[str, dict] = {}
    for c in num:
        cols[c] = {"tipo": "numerica", "cortes": cortes.get(c, []), "media": momentos.get(c, (None, None))[0],
                   "desvio": momentos.get(c, (None, None))[1], "proporciones": _proporciones(conteos[c], n)}
    for c in cat:
        filas = (d.where(F.col(c).isNotNull()).groupBy(c).count().orderBy(F.desc("count"), F.asc(c)).limit(TOP).collect())
        top = [str(r[c]) for r in filas]
        cuenta = [int(r["count"]) for r in filas]
        nulos = conteos[c][-1]
        cols[c] = {"tipo": "categorica", "categorias": top,
                   "proporciones": _proporciones(cuenta + [n - nulos - sum(cuenta), nulos], n)}
    return {"filas": n, "columnas": cols}


def _conteos_spark(d, num: dict[str, list[float]], cat: list[str]) -> dict[str, list[int]]:
    """Una sola pasada: cuántas filas caen en cada tramo de cada numérica, y los nulos de todas."""
    from pyspark.sql import functions as F
    exprs, claves = [], []
    for c, cortes in num.items():
        col = F.col(c)
        conds = []
        if cortes:
            conds.append(col <= cortes[0])
            conds += [(col > cortes[i - 1]) & (col <= cortes[i]) for i in range(1, len(cortes))]
            conds.append(col > cortes[-1])
        else:
            conds.append(col.isNotNull())
        conds.append(col.isNull())
        for i, cond in enumerate(conds):
            exprs.append(F.sum(F.when(cond, 1).otherwise(0)).alias(f"n{len(claves)}"))
            claves.append((c, i))
    for c in cat:
        exprs.append(F.sum(F.when(F.col(c).isNull(), 1).otherwise(0)).alias(f"n{len(claves)}"))
        claves.append((c, 0))
    out: dict[str, list[int]] = {c: [] for c in [*num, *cat]}
    if not exprs:
        return out
    fila = d.agg(*exprs).first()
    for i, (c, _) in enumerate(claves):
        out[c].append(int(fila[f"n{i}"] or 0))
    return out


def contar_spark(df, ref: dict) -> dict:
    """Las proporciones de los datos nuevos con los tramos de la referencia, contadas en los executors."""
    from pyspark.sql import functions as F
    cols = ref["columnas"]
    num = {c: r["cortes"] for c, r in cols.items() if r["tipo"] == "numerica" and c in df.columns}
    cat = [c for c, r in cols.items() if r["tipo"] == "categorica" and c in df.columns]
    d = df.select(*[F.col(c).cast("double").alias(c) for c in num], *[F.col(c).cast("string").alias(c) for c in cat])
    n = d.count()
    conteos = _conteos_spark(d, num, cat)
    out: dict[str, list[float] | None] = {c: None for c in cols}
    for c in num:
        out[c] = _proporciones(conteos[c], n)
    for c in cat:
        cats = cols[c]["categorias"]
        filas = d.where(F.col(c).isin(cats)).groupBy(c).count().collect() if cats else []
        por = {str(r[c]): int(r["count"]) for r in filas}
        cuenta = [por.get(x, 0) for x in cats]
        nulos = conteos[c][0]
        out[c] = _proporciones(cuenta + [n - nulos - sum(cuenta), nulos], n)
    return {"filas": n, "proporciones": out}


# ---------------------------------------------------------------- comparar

def comparar(ref: dict, actual: dict) -> dict:
    """{nivel, psi_max, columnas: [{columna, tipo, psi, nivel, etiquetas, referencia, nuevo}]}, de la que más
    cambió a la que menos. Una columna que falta en los datos nuevos va con psi None."""
    filas = []
    for c, r in ref.get("columnas", {}).items():
        nuevo = actual["proporciones"].get(c)
        p = psi(r["proporciones"], nuevo) if nuevo is not None else None
        filas.append({"columna": c, "tipo": r["tipo"], "psi": p, "nivel": nivel(p), "etiquetas": etiquetas(r),
                      "referencia": r["proporciones"], "nuevo": nuevo})
    filas.sort(key=lambda f: math.inf if f["psi"] is None else f["psi"], reverse=True)   # las que faltan, primero
    psis = [f["psi"] for f in filas if f["psi"] is not None]
    peor = max(psis) if psis else None
    return {"nivel": nivel(peor), "psi_max": peor, "filas_referencia": ref.get("filas"), "filas_nuevas": actual.get("filas"),
            "columnas": filas,
            "explicacion": "PSI por variable contra el entrenamiento: menos de 0,1 estable, de 0,1 a 0,25 moderada, "
                           "más de 0,25 fuerte."}
