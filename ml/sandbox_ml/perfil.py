"""Perfil de un conjunto de datos: lo que muestra el paso «Datos» del estudio.

    python3 -m sandbox_ml.perfil '{"origen": "local", "ruta": "/datos/clientes_senal.csv"}' [objetivo]

Por columna: tipo, nulos, valores distintos, estadísticas, distribución
(histograma o categorías más comunes), el rol sugerido (numérica, categórica,
fecha, texto, id o ignorar) y, si se pasa el objetivo, qué tan bien lo predice
esa columna sola (para avisar de fugas de datos). Del objetivo: el tipo de
problema sugerido y el balance de clases. Lee hasta 200.000 filas.

Imprime una línea '@@perfil@@ {json}' al final (lo que lee el servidor).
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

MAX_FILAS = 200_000
VISTA = 20
ID_NOMBRE = re.compile(r"(^id$|^id_|_id$|^cod(igo)?_|uuid|^dni$|^cuit$|^legajo$)", re.I)


def leer(d: dict, max_filas: int | None = MAX_FILAS):
    """El DataFrame de pandas de una fuente {origen, ruta|tabla, formato, separador}."""
    import pandas as pd
    origen = d.get("origen", "local")
    fmt = d.get("formato") or ("parquet" if str(d.get("ruta", "")).endswith(".parquet") else "csv")
    sep = d.get("separador", ",")
    if origen == "hive":
        from pyspark.sql import SparkSession
        spark = SparkSession.builder.master("local[2]").appName("estudio-ml: perfil").enableHiveSupport().getOrCreate()
        df = spark.table(d["tabla"])
        df = (df.limit(max_filas) if max_filas else df).toPandas()
        spark.stop()
        return df
    ruta = d["ruta"]
    if origen == "hdfs":
        carpeta = Path(tempfile.mkdtemp(prefix="hdfs-"))
        subprocess.run(["hdfs", "dfs", "-get", ruta, str(carpeta)], check=True, capture_output=True)
        local = carpeta / ruta.rstrip("/").rsplit("/", 1)[-1]
    else:
        local = Path(ruta)
    if fmt == "parquet":
        df = pd.read_parquet(local)
        return df.head(max_filas) if max_filas else df
    partes = sorted(p for p in local.glob("part-*") if p.stat().st_size) if local.is_dir() else [local]
    frames, faltan = [], max_filas
    for p in partes:
        f = pd.read_csv(p, sep=sep, nrows=faltan)
        frames.append(f)
        if faltan is not None:
            faltan -= len(f)
            if faltan <= 0:
                break
    return pd.concat(frames, ignore_index=True) if len(frames) > 1 else frames[0]


def _py(v):
    from .estudio import _py as conv
    return conv(v)


def tipo_de(s) -> str:
    import pandas as pd
    if pd.api.types.is_bool_dtype(s):
        return "bool"
    if pd.api.types.is_integer_dtype(s):
        return "int"
    if pd.api.types.is_float_dtype(s):
        return "float"
    if pd.api.types.is_datetime64_any_dtype(s):
        return "fecha"
    return "str"


def parece_fecha(s) -> bool:
    import pandas as pd
    m = s.dropna().astype(str).head(200)
    if len(m) == 0 or not m.str.contains(r"\d{1,4}[-/]\d{1,2}", regex=True).mean() > 0.9:
        return False
    import warnings
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        return pd.to_datetime(m, errors="coerce").notna().mean() > 0.9


def rol_sugerido(nombre: str, s, tipo: str, unicos: int, n: int) -> tuple[str, str]:
    """(rol, por qué)."""
    if unicos <= 1:
        return "ignorar", "tiene un solo valor"
    ratio = unicos / max(n, 1)
    if tipo == "fecha":
        return "fecha", "es una fecha"
    if tipo in ("int", "str") and ID_NOMBRE.search(nombre) and ratio > 0.5:
        return "id", "el nombre y los valores distintos parecen un identificador"
    if tipo == "int" and ratio > 0.99 and n > 50 and s.is_monotonic_increasing:
        return "id", "es un número correlativo: parece un identificador"
    if tipo == "bool":
        return "categorica", "es sí/no"
    if tipo in ("int", "float"):
        return "numerica", "es un número"
    if parece_fecha(s):
        return "fecha", "los valores se leen como fechas"
    largo = s.dropna().astype(str).str.len().mean() if s.notna().any() else 0
    if ratio > 0.95 and largo < 40:
        return "id", "casi todos los valores son distintos: parece un identificador"
    if largo > 30 and ratio > 0.3:
        return "texto", f"texto largo ({largo:.0f} caracteres en promedio)"
    return "categorica", f"{unicos} categorías"


def tarea_sugerida(s, tipo: str, unicos: int) -> tuple[str, str]:
    import pandas as pd
    if tipo in ("int", "float") and unicos > 20:
        return "regresion", f"es un número con {unicos} valores distintos"
    if tipo == "float":
        vals = s.dropna()
        if len(vals) and not (vals == vals.round()).all():
            return "regresion", "es un número con decimales"
    if pd.api.types.is_numeric_dtype(s) and unicos > 20:
        return "regresion", "es un número"
    return "clasificacion", f"tiene {unicos} valores distintos (clases)"


def asociacion(X, y, tarea: str, semilla: int = 0) -> dict[str, float]:
    """Qué tan bien predice el objetivo cada columna SOLA (un árbol chico, medido con filas que no vio): 0 a 1."""
    import numpy as np
    import pandas as pd
    from sklearn.model_selection import train_test_split
    from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor
    out = {}
    if len(X) > 20000:
        idx = X.sample(20000, random_state=semilla).index
        X, y = X.loc[idx], y.loc[idx]
    ok = y.notna()
    X, y = X[ok], y[ok]
    if len(y) < 30:
        return out
    clasif = tarea == "clasificacion"
    if clasif:
        y = y.astype(str)
        base = y.value_counts(normalize=True).iloc[0]
    for c in X.columns:
        s = X[c]
        if pd.api.types.is_numeric_dtype(s) and not pd.api.types.is_bool_dtype(s):
            v = s.astype(float).fillna(s.astype(float).median()).to_numpy().reshape(-1, 1)
        else:
            codigos = s.astype(str).fillna("(vacío)")
            v = codigos.map(codigos.value_counts()).to_numpy(dtype=float).reshape(-1, 1)
            v = np.column_stack([v, pd.factorize(codigos)[0]])
        try:
            strat = y if clasif and y.value_counts().min() >= 2 else None
            a, b, ya, yb = train_test_split(v, y, test_size=0.3, random_state=semilla, stratify=strat)
            m = (DecisionTreeClassifier if clasif else DecisionTreeRegressor)(max_depth=6, min_samples_leaf=5,
                                                                              random_state=semilla).fit(a, ya)
            s_ = m.score(b, yb)
            out[c] = float(max(0.0, (s_ - base) / (1 - base) if clasif and base < 1 else s_))
        except ValueError:
            continue
    return out


def perfilar(d: dict, objetivo: str | None = None, max_filas: int = MAX_FILAS) -> dict:
    import numpy as np
    import pandas as pd
    t0 = time.perf_counter()
    df = leer(d, max_filas + 1)
    recortado = len(df) > max_filas
    df = df.head(max_filas)
    n = len(df)
    cols = []
    for c in df.columns:
        s = df[c]
        tipo = tipo_de(s)
        nulos = int(s.isna().sum())
        unicos = int(s.nunique(dropna=True))
        rol, porque = rol_sugerido(str(c), s, tipo, unicos, n)
        if rol == "fecha" and tipo == "str":
            tipo_mostrado = "str"
        else:
            tipo_mostrado = tipo
        info = {"nombre": str(c), "tipo": tipo_mostrado, "dtype": str(s.dtype), "nulos": nulos,
                "nulos_pct": round(nulos / n, 4) if n else 0, "unicos": unicos, "unicos_pct": round(unicos / n, 4) if n else 0,
                "rol": rol, "por_que": porque, "ejemplos": _py(s.dropna().head(3).tolist())}
        if tipo in ("int", "float") and s.notna().any():
            v = s.dropna().astype(float)
            info["num"] = {"min": float(v.min()), "max": float(v.max()), "media": float(v.mean()), "desvio": float(v.std()),
                           "p25": float(v.quantile(0.25)), "p50": float(v.median()), "p75": float(v.quantile(0.75)),
                           "ceros": int((v == 0).sum())}
            q1, q3 = info["num"]["p25"], info["num"]["p75"]
            info["num"]["extremos"] = int(((v < q1 - 1.5 * (q3 - q1)) | (v > q3 + 1.5 * (q3 - q1))).sum())
            cuentas, bordes = np.histogram(v, bins=min(20, max(unicos, 1)))
            info["histograma"] = {"bordes": _py(bordes), "cuentas": _py(cuentas)}
        if rol == "fecha" or tipo == "fecha":
            import warnings
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                f = pd.to_datetime(s, errors="coerce")
            if f.notna().any():
                info["fecha"] = {"min": str(f.min()), "max": str(f.max())}
        if tipo in ("str", "bool") or unicos <= 20:
            top = s.astype(str).where(s.notna()).value_counts().head(10)
            info["top"] = [{"valor": str(k), "n": int(v)} for k, v in top.items()]
        if tipo == "str":
            info["largo_medio"] = float(s.dropna().astype(str).str.len().mean()) if s.notna().any() else 0.0
        cols.append(info)
    out = {"datos": d, "filas": n, "recortado": recortado, "columnas": cols,
           "duplicadas": int(df.duplicated().sum()) if n <= 200_000 else None,
           "memoria_mb": round(float(df.memory_usage(deep=True).sum()) / 1024 ** 2, 2),
           "vista": {"columnas": [str(c) for c in df.columns],
                     "filas": [_py(list(f)) for f in df.head(VISTA).itertuples(index=False)]}}
    if objetivo and objetivo in df.columns:
        s = df[objetivo]
        info = next(c for c in cols if c["nombre"] == objetivo)
        tarea, porque = tarea_sugerida(s, tipo_de(s), info["unicos"])
        out["objetivo"] = {"columna": objetivo, "tarea": tarea, "por_que": porque}
        if info["unicos"] <= 200:
            vc = s.astype(str).where(s.notna()).value_counts()
            total = int(vc.sum())
            info["balance"] = [{"clase": str(k), "n": int(v), "pct": round(int(v) / total, 4)} for k, v in vc.items()][:50]
        otras = [c for c in df.columns if c != objetivo]
        asoc = asociacion(df[otras], s, tarea)
        for c in cols:
            if c["nombre"] in asoc:
                c["asociacion"] = {"valor": round(asoc[c["nombre"]], 4), "metodo": "árbol con esa columna sola"}
            if c["nombre"] != objetivo and "num" in c and pd.api.types.is_numeric_dtype(s):
                corr = df[c["nombre"]].astype(float).corr(s.astype(float))
                if corr == corr:
                    c["correlacion"] = round(float(corr), 4)
    out["segundos"] = round(time.perf_counter() - t0, 3)
    return out


def main(argv: list[str]) -> None:
    d = json.loads(argv[1])
    objetivo = argv[2] if len(argv) > 2 and argv[2] else None
    print("@@perfil@@ " + json.dumps(_py(perfilar(d, objetivo)), ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main(sys.argv)
