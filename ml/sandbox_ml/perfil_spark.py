"""Perfil de un dataset calculado con Spark: el de perfil.py, pero a escala y para cualquier formato.

    spark-submit --master yarn perfil_spark.py '{"origen": "hdfs", "ruta": "/user/root/ventas"}' [objetivo] [muestra|completo] [filas]

Con «muestra» lee todo para contar las filas y perfila una muestra al azar
(con semilla) de hasta `filas`; con «completo» hace la pasada entera. Por
columna: tipo de Spark, nulos, distintos aproximados (HyperLogLog), mínimo,
máximo, media, desvío, cuantiles aproximados (1, 5, 25, 50, 75, 95 y 99 %),
extremos, histograma, categorías más comunes y fechas. De la fuente: formato,
compresión, archivos, tamaño en disco y particiones.

Son pocas pasadas sobre los datos (en caché): una para contar, una con todos
los agregados juntos, una para los cuantiles, una para histogramas y extremos
y una por columna categórica para su top. La asociación de cada columna con el
objetivo (un árbol por columna) queda para el perfil con pandas.

Imprime '@@perfil@@ {json}' al final (o '@@error@@ {json}' con el error explicado).
Las funciones de acá no dependen de sandbox_ml: el código que muestra el
estudio (script()) las copia en un script de PySpark autónomo.
"""
from __future__ import annotations

import inspect
import json
import sys
import time

CUANTILES = (0.01, 0.05, 0.25, 0.5, 0.75, 0.95, 0.99)
MAX_TOP = 60
VISTA = 20
ID_NOMBRE = r"(^id$|^id_|_id$|^cod(igo)?_|uuid|^dni$|^cuit$|^legajo$)"


def tipo_spark(dt):
    """El tipo del estudio (int, float, bool, fecha, str o complejo) de un tipo de Spark (dtypes)."""
    if dt in ("tinyint", "smallint", "int", "bigint"):
        return "int"
    if dt in ("float", "double") or dt.startswith("decimal"):
        return "float"
    if dt == "boolean":
        return "bool"
    if dt in ("date", "timestamp", "timestamp_ntz"):
        return "fecha"
    if dt == "string":
        return "str"
    return "complejo"


def rol_spark(nombre, tipo, unicos, n, largo, fechas_pct, fecha_dmy_pct, fecha_ymd_pct=0.0):
    """(rol, por qué): las mismas reglas que perfil.rol_sugerido, con lo que sale de los agregados."""
    import re
    if tipo == "complejo":
        return "ignorar", "es un tipo anidado (struct, array o map): sacá un campo con una columna derivada"
    if unicos <= 1:
        return "ignorar", "tiene un solo valor"
    ratio = unicos / max(n, 1)
    if tipo == "fecha":
        return "fecha", "es una fecha"
    if tipo in ("int", "str") and re.search(ID_NOMBRE, nombre, re.I) and ratio > 0.5:
        return "id", "el nombre y los valores distintos parecen un identificador"
    if tipo == "bool":
        return "categorica", "es sí/no"
    if tipo in ("int", "float"):
        return "numerica", "es un número"
    if fechas_pct > 0.9:
        return "fecha", "los valores se leen como fechas"
    if fecha_dmy_pct > 0.9:
        return "categorica", "parece una fecha dd/mm/aaaa: convertila con un paso «fecha» de la limpieza"
    if fechas_pct + fecha_dmy_pct + fecha_ymd_pct > 0.9:
        return "categorica", ("son fechas en varios formatos: convertilas con una columna derivada, "
                              "coalesce(to_date(c, 'dd/MM/yyyy'), to_date(c, 'yyyyMMdd'), ...)")
    if ratio > 0.95 and largo < 40:
        return "id", "casi todos los valores son distintos: parece un identificador"
    if largo > 30 and ratio > 0.3:
        return "texto", f"texto largo ({largo:.0f} caracteres en promedio)"
    return "categorica", f"unas {unicos} categorías"


def a_py(v):
    """Un valor de una fila de Spark como algo que entra en JSON."""
    import datetime
    import decimal
    import math
    if isinstance(v, float):
        return v if math.isfinite(v) else None
    if isinstance(v, datetime.datetime):
        return v.isoformat(sep=" ")
    if isinstance(v, datetime.date):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return float(v)
    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, (bytes, bytearray)):
        return f"<{len(v)} bytes>"
    if hasattr(v, "asDict"):
        return json.dumps({k: a_py(x) for k, x in v.asDict(recursive=False).items()}, ensure_ascii=False, default=str)
    if isinstance(v, (list, tuple, dict)):
        return json.dumps(v, ensure_ascii=False, default=str)
    return str(v)


def fuente_info(spark, d, df):
    """Formato, compresión, archivos, bytes en disco y particiones de lo que se leyó."""
    import re
    info = {"formato": d.get("formato"), "compresion": d.get("compresion")}
    raiz = None
    if d["origen"] == "hive":
        desc = {r[0].strip(): (r[1] or "").strip() for r in spark.sql(f"DESCRIBE FORMATTED {d['tabla']}").collect() if r[0]}
        raiz = desc.get("Location")
        entrada = desc.get("InputFormat", "")
        info["formato"] = next((f for k, f in (("Orc", "orc"), ("Parquet", "parquet"), ("Avro", "avro"), ("Text", "texto"))
                                if k in entrada), entrada.rsplit(".", 1)[-1] or None)
        info["tabla"] = d["tabla"]
        try:
            parts = [r[0] for r in spark.sql(f"SHOW PARTITIONS {d['tabla']}").collect()]
            if parts:
                info["particiones"] = {"columnas": [x.split("=")[0] for x in parts[0].split("/")], "n": len(parts),
                                       "ejemplos": parts[:5]}
        except Exception:  # noqa: BLE001 — no es una tabla particionada
            pass
    else:
        raiz = ("file://" + d["ruta"]) if d["origen"] == "local" else d["ruta"]
    if raiz:
        try:
            jvm = spark._jvm
            p = jvm.org.apache.hadoop.fs.Path(raiz)
            fs = p.getFileSystem(spark._jsc.hadoopConfiguration())
            cs = fs.getContentSummary(p)
            info["bytes"], info["archivos"] = int(cs.getLength()), int(cs.getFileCount())
            info["ubicacion"] = str(fs.makeQualified(p).toString())
        except Exception as e:  # noqa: BLE001
            info["aviso"] = f"no se pudo medir el tamaño: {str(e).splitlines()[0][:200]}"
    archivos = df.inputFiles()
    info["leidos"] = len(archivos)
    comp = set()
    for a in archivos:
        nombre = a.rsplit("/", 1)[-1].lower()
        for ext, c in ((".gz", "gzip"), (".bz2", "bz2"), (".snappy", "snappy"), (".zst", "zstd"), (".lz4", "lz4"),
                       (".deflate", "deflate")):
            if nombre.endswith(ext) or f"{ext}." in nombre:
                comp.add(c)
    if comp:
        info["compresion"] = ", ".join(sorted(comp))
    if d["origen"] != "hive" and archivos:
        pares = set()
        cols = None
        for a in archivos:
            segs = [s for s in a.split("/")[:-1] if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", s)]
            if segs:
                pares.add("/".join(segs))
                cols = cols or [s.split("=")[0] for s in segs]
        if pares:
            info["particiones"] = {"columnas": cols, "n": len(pares), "ejemplos": sorted(pares)[:5]}
    return info


def perfilar_df(df, objetivo=None, modo="muestra", filas=200_000, semilla=42):
    """El perfil de un DataFrame de Spark (lo mismo que perfil.perfilar, con agregados de Spark)."""
    from pyspark import StorageLevel
    from pyspark.sql import functions as F

    def q(c):
        return "`" + c.replace("`", "``") + "`"

    t0 = time.perf_counter()
    total = df.count()
    if modo == "muestra" and total > filas:
        m = df.sample(False, min(1.0, filas * 1.15 / total), seed=semilla).limit(filas)
    else:
        m = df
    m = m.persist(StorageLevel.MEMORY_AND_DISK)
    n = m.count()
    tipos = {c: tipo_spark(t) for c, t in m.dtypes}
    cols = m.columns
    num = [c for c in cols if tipos[c] in ("int", "float")]
    strs = [c for c in cols if tipos[c] == "str"]
    obj_num = objetivo in num if objetivo else False

    # Pasada 1: nulos, distintos, extremos, medias, largos y fechas de todas las columnas a la vez
    ag = []
    for i, c in enumerate(cols):
        x = F.col(q(c))
        ag.append(F.sum(F.when(x.isNull(), 1).otherwise(0)).alias(f"n{i}"))
        if tipos[c] != "complejo":
            ag.append(F.approx_count_distinct(x, 0.02).alias(f"u{i}"))
        if c in num:
            ag += [F.min(x).alias(f"mn{i}"), F.max(x).alias(f"mx{i}"), F.avg(x).alias(f"me{i}"),
                   F.stddev(x).alias(f"de{i}"), F.sum(F.when(x == 0, 1).otherwise(0)).alias(f"z{i}")]
            if c == objetivo:
                ag.append(F.sum(F.when(x != F.floor(x), 1).otherwise(0)).alias(f"dec{i}"))
        if c in strs:
            ts = F.to_timestamp(x)
            iso = x.rlike(r"^\d{1,4}[-/]\d{1,2}[-/]\d{1,4}")
            ag += [F.avg(F.length(x)).alias(f"l{i}"), F.sum(F.when(iso & ts.isNotNull(), 1).otherwise(0)).alias(f"f{i}"),
                   F.sum(F.when(x.rlike(r"^\d{1,2}/\d{1,2}/\d{4}"), 1).otherwise(0)).alias(f"dmy{i}"),
                   F.sum(F.when(x.rlike(r"^(19|20)\d{6}$"), 1).otherwise(0)).alias(f"ymd{i}"),
                   F.min(F.when(iso, ts)).alias(f"fmin{i}"), F.max(F.when(iso, ts)).alias(f"fmax{i}")]
        if tipos[c] == "fecha":
            ag += [F.min(x).alias(f"fmin{i}"), F.max(x).alias(f"fmax{i}")]
    r1 = m.agg(*ag).first().asDict() if ag else {}

    # Pasada 2: cuantiles aproximados de todas las numéricas (error relativo 0,001)
    qs = {}
    if num:
        vals = m.select(*[F.col(q(c)).cast("double").alias(f"c{j}") for j, c in enumerate(num)]) \
            .approxQuantile([f"c{j}" for j in range(len(num))], list(CUANTILES), 0.001)
        qs = dict(zip(num, vals))

    # Pasada 3: extremos (1,5·IQR) e histograma de ancho fijo de cada numérica, y la correlación con el objetivo
    ag2, hist = [], {}
    for c in num:
        i = cols.index(c)
        mn, mx, u = r1.get(f"mn{i}"), r1.get(f"mx{i}"), r1.get(f"u{i}") or 0
        if mn is None or len(qs.get(c) or []) < len(CUANTILES):
            continue
        x = F.col(q(c)).cast("double")
        q1, q3 = qs[c][2], qs[c][4]
        lo, hi = q1 - 1.5 * (q3 - q1), q3 + 1.5 * (q3 - q1)
        ag2.append(F.sum(F.when((x < lo) | (x > hi), 1).otherwise(0)).alias(f"x{i}"))
        nb = max(1, min(20, int(u)))
        ancho = (float(mx) - float(mn)) / nb or 1.0
        b = F.least(F.floor((x - float(mn)) / ancho), F.lit(nb - 1))
        ag2 += [F.sum(F.when(b == k, 1).otherwise(0)).alias(f"h{i}_{k}") for k in range(nb)]
        hist[c] = (float(mn), ancho, nb)
        if obj_num and c != objetivo:
            ag2.append(F.corr(x, F.col(q(objetivo)).cast("double")).alias(f"r{i}"))
    r2 = m.agg(*ag2).first().asDict() if ag2 else {}

    vista = m.limit(VISTA).collect()
    columnas = []
    for i, c in enumerate(cols):
        t = tipos[c]
        nulos = int(r1.get(f"n{i}") or 0)
        unicos = int(r1.get(f"u{i}") or 0) if t != "complejo" else 0
        largo = float(r1.get(f"l{i}") or 0.0)
        no_nulos = max(n - nulos, 1)
        rol, porque = rol_spark(c, t, unicos, n, largo, (r1.get(f"f{i}") or 0) / no_nulos,
                                (r1.get(f"dmy{i}") or 0) / no_nulos, (r1.get(f"ymd{i}") or 0) / no_nulos)
        info = {"nombre": c, "tipo": "str" if t == "complejo" else t, "dtype": dict(m.dtypes)[c], "nulos": nulos,
                "nulos_pct": round(nulos / n, 4) if n else 0, "unicos": unicos, "unicos_pct": round(unicos / n, 4) if n else 0,
                "unicos_aprox": True, "rol": rol, "por_que": porque,
                "ejemplos": [a_py(f[c]) for f in vista if f[c] is not None][:3]}
        if c in hist:
            p = qs[c]
            info["num"] = {"min": float(r1[f"mn{i}"]), "max": float(r1[f"mx{i}"]), "media": float(r1[f"me{i}"]),
                           "desvio": float(r1.get(f"de{i}") or 0.0), "p01": p[0], "p05": p[1], "p25": p[2], "p50": p[3],
                           "p75": p[4], "p95": p[5], "p99": p[6], "ceros": int(r1.get(f"z{i}") or 0),
                           "extremos": int(r2.get(f"x{i}") or 0)}
            mn, ancho, nb = hist[c]
            info["histograma"] = {"bordes": [mn + k * ancho for k in range(nb + 1)],
                                  "cuentas": [int(r2.get(f"h{i}_{k}") or 0) for k in range(nb)]}
            if r2.get(f"r{i}") is not None:
                info["correlacion"] = round(float(r2[f"r{i}"]), 4)
        if r1.get(f"fmin{i}") is not None:
            info["fecha"] = {"min": a_py(r1[f"fmin{i}"]), "max": a_py(r1[f"fmax{i}"])}
        if t == "str":
            info["largo_medio"] = largo
        columnas.append(info)

    # Una pasada por columna categórica (o con pocos valores): sus 10 valores más comunes
    for info in columnas:
        c = info["nombre"]
        if tipos[c] == "complejo" or not (tipos[c] in ("str", "bool") or info["unicos"] <= 20):
            continue
        if sum("top" in x for x in columnas) >= MAX_TOP:
            break
        top = m.where(F.col(q(c)).isNotNull()).groupBy(F.col(q(c)).alias("v")).count() \
            .orderBy(F.desc("count")).limit(10).collect()
        info["top"] = [{"valor": str(a_py(r["v"])), "n": int(r["count"])} for r in top]

    simples = [q(c) for c in cols if tipos[c] != "complejo"]
    out = {"filas": n, "filas_total": total, "recortado": n < total, "columnas": columnas,
           "duplicadas": int(n - m.select(*simples).dropDuplicates().count()) if simples else None, "memoria_mb": None,
           "vista": {"columnas": cols, "filas": [[a_py(f[c]) for c in cols] for f in vista]},
           "motor": "spark", "modo": modo, "muestra_filas": filas if modo == "muestra" else None}
    if objetivo and objetivo in cols:
        info = next(x for x in columnas if x["nombre"] == objetivo)
        i = cols.index(objetivo)
        t, u = tipos[objetivo], info["unicos"]
        if t in ("int", "float") and u > 20:
            tarea, porque = "regresion", f"es un número con unos {u} valores distintos"
        elif t == "float" and (r1.get(f"dec{i}") or 0) > 0:
            tarea, porque = "regresion", "es un número con decimales"
        else:
            tarea, porque = "clasificacion", f"tiene {u} valores distintos (clases)"
        out["objetivo"] = {"columna": objetivo, "tarea": tarea, "por_que": porque}
        if u <= 200:
            vc = m.where(F.col(q(objetivo)).isNotNull()).groupBy(F.col(q(objetivo)).alias("v")).count() \
                .orderBy(F.desc("count")).limit(50).collect()
            tot = sum(r["count"] for r in vc) or 1
            info["balance"] = [{"clase": str(a_py(r["v"])), "n": int(r["count"]), "pct": round(r["count"] / tot, 4)} for r in vc]
    m.unpersist()
    out["segundos"] = round(time.perf_counter() - t0, 2)
    return out


FUNCIONES = (tipo_spark, rol_spark, a_py, fuente_info, perfilar_df)


def script(d: dict, objetivo: str | None = None, modo: str = "muestra", filas: int = 200_000, fecha: str = "") -> str:
    """Un script de PySpark autónomo que calcula este perfil (lo que muestra el estudio en «Código»)."""
    from . import fuentes
    ruta = fuentes.lit("file://" + d["ruta"]) if d["origen"] == "local" else None
    master = "local[2]" if d["origen"] == "local" else "yarn"
    nombre = (d.get("ruta") or d.get("tabla") or "datos").rstrip("/").rsplit("/", 1)[-1]
    L = ["# %% [markdown]",
         f"# # Perfil de {nombre} con Spark",
         "#",
         f"# Generado por el estudio de ML de BigData Sandbox{' el ' + fecha if fecha else ''}.",
         f"# Se corre con `spark-submit --master {master} perfil_{nombre.split('.')[0]}.py`: "
         + ("lee todo para contar y perfila una muestra al azar." if modo == "muestra" else "una pasada completa."),
         "", "# %% Librerías y Spark", "import json", "import time", "", "from pyspark.sql import SparkSession, functions as F",
         "", f"CUANTILES = {CUANTILES!r}", f"MAX_TOP = {MAX_TOP}", f"VISTA = {VISTA}", f"ID_NOMBRE = {ID_NOMBRE!r}",
         f"OBJETIVO = {fuentes.lit(objetivo) if objetivo else None}", f"MODO = {fuentes.lit(modo)}", f"FILAS = {filas}",
         "DATOS = json.loads(r'''" + json.dumps(d, ensure_ascii=False) + "''')",
         "", f'spark = SparkSession.builder.appName("estudio-ml: perfil de {nombre}")'
         + (".enableHiveSupport()" if d["origen"] == "hive" else "") + ".getOrCreate()",
         "", "# %% 1. Leer los datos"]
    L += fuentes.codigo_lector(d, ruta)
    L += ["", "# %% 2. Las funciones del perfil (las mismas que usa el estudio)"]
    for f in FUNCIONES:
        L += ["", ""] + inspect.getsource(f).rstrip().splitlines()
    L += ["", "", "# %% 3. Perfilar",
          "perfil = perfilar_df(datos, OBJETIVO, MODO, FILAS)",
          "perfil[\"fuente\"] = fuente_info(spark, DATOS, datos)",
          'print(f"{perfil[\'filas\']:,} filas perfiladas de {perfil[\'filas_total\']:,} en {perfil[\'segundos\']} s")',
          "for c in perfil[\"columnas\"]:",
          "    extra = f\"{c['num']['min']:g} a {c['num']['max']:g}\" if \"num\" in c else \", \".join(t[\"valor\"] for t in c.get(\"top\", [])[:3])",
          "    print(f\"  {c['nombre']:>24} {c['dtype']:>10}  nulos {c['nulos_pct'] * 100:5.1f} %  distintos ~{c['unicos']:<8} {c['rol']:<10} {extra}\")",
          f'with open("perfil_{nombre.split(".")[0]}.json", "w") as f:',
          "    json.dump(perfil, f, ensure_ascii=False, indent=1)",
          "spark.stop()"]
    return "\n".join(L) + "\n"


def main(argv: list[str]) -> None:
    import traceback
    try:
        from sandbox_ml import fuentes
    except ImportError:     # corrido como archivo suelto con spark-submit: sandbox_ml está al lado
        sys.path.insert(0, __file__.rsplit("/", 2)[0])
        from sandbox_ml import fuentes
    d = json.loads(argv[1])
    objetivo = argv[2] if len(argv) > 2 and argv[2] else None
    modo = argv[3] if len(argv) > 3 and argv[3] in ("muestra", "completo") else "muestra"
    filas = int(argv[4]) if len(argv) > 4 and argv[4].isdigit() else 200_000
    try:
        from pyspark.sql import SparkSession, functions as F
        b = SparkSession.builder.appName("estudio-ml: perfil con Spark")
        if d["origen"] == "hive":
            b = b.enableHiveSupport()
        spark = b.getOrCreate()
        spark.sparkContext.setLogLevel("WARN")
        ns = {"spark": spark, "F": F}
        ruta = fuentes.lit("file://" + d["ruta"]) if d["origen"] == "local" else None
        exec("\n".join(fuentes.codigo_lector(d, ruta)), ns)
        datos = ns["datos"]
        out = perfilar_df(datos, objetivo, modo, filas)
        out["datos"] = d
        out["fuente"] = fuente_info(spark, d, datos)
        if d.get("formato") == "csv":
            # Las primeras líneas, ya descomprimidas: ¿el separador elegido es el que usa el archivo?
            lineas = [r.value for r in spark.read.text(d["ruta"] if d["origen"] != "local" else "file://" + d["ruta"])
                      .limit(20).collect()]
            sep = fuentes.adivinar_separador(lineas)
            if sep and sep != d.get("separador", ","):
                out["sugerencias"] = {"separador": sep}
        out["app_id"] = spark.sparkContext.applicationId
        out["master"] = spark.sparkContext.master
        print("@@perfil@@ " + json.dumps(out, ensure_ascii=False, default=str), flush=True)
        spark.stop()
    except Exception as e:  # noqa: BLE001
        texto = traceback.format_exc()
        java = getattr(e, "java_exception", None)
        if java is not None:
            try:
                texto += "\n" + str(java.toString())
            except Exception:  # noqa: BLE001
                pass
        print("@@error@@ " + json.dumps(fuentes.explicar_error(texto), ensure_ascii=False), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main(sys.argv)
