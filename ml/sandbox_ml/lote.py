"""Predicción por lotes: datos nuevos de HDFS o Hive → la versión elegida de la biblioteca → predicciones en
HDFS o en una tabla de Hive. Genera un script de PySpark completo que se corre con spark-submit en YARN.

Lo que hace el script, en orden:

    1. lee los datos nuevos en el formato que estén (lo mismo que el estudio: Parquet, ORC, CSV, JSON...)
    2. valida el esquema contra el del entrenamiento: si falta una columna que el modelo usa, para; si una
       numérica llega como texto, la convierte y cuenta los valores que no se pudieron convertir
    3. mide la deriva de cada variable contra el entrenamiento (PSI, en los executors)
    4. predice: con Spark, el PipelineModel guardado (con la limpieza adentro); con scikit-learn, el Pipeline de
       joblib repartido en los executors con mapInPandas (cada executor carga el modelo una vez)
    5. escribe las columnas originales más la predicción (y las probabilidades) en HDFS o en Hive
    6. imprime '@@prediccion@@ {json}' con el resumen: filas, salida, esquema, deriva y una muestra

    from sandbox_ml import lote
    print(lote.generar(version, carpeta_version, {"origen": "hdfs", "ruta": "/user/root/nuevos", "formato": "parquet"},
                       {"tipo": "hdfs", "ruta": "/user/root/ml/predicciones/churn-v3", "formato": "parquet"}))
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from . import fuentes
from .codigo import lit

FORMATOS_SALIDA = ("parquet", "orc", "csv", "json")
MODOS = ("overwrite", "append", "error")
TABLA = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$")
RUTA = re.compile(r"^/[A-Za-z0-9_./=-]+$")
PREDICCION = "@@prediccion@@ "
MUESTRA = 20
NUMERICOS = ("double", "float", "int", "bigint", "smallint", "tinyint", "decimal", "long")


def normalizar_salida(s: object, nombre: str, version: int) -> tuple[dict, list[dict]]:
    """(salida, errores): {tipo: hdfs, ruta, formato, modo} o {tipo: hive, tabla, modo}."""
    errores: list[dict] = []
    s = dict(s) if isinstance(s, dict) else {}
    tipo = s.get("tipo") or "hdfs"
    modo = s.get("modo") or "overwrite"
    if modo not in MODOS:
        errores.append({"campo": "salida.modo", "mensaje": f"El modo es {', '.join(MODOS)}"})
    if tipo == "hive":
        tabla = s.get("tabla") or f"default.pred_{nombre.replace('-', '_')}_v{version}"
        if not isinstance(tabla, str) or not TABLA.match(tabla):
            errores.append({"campo": "salida.tabla", "mensaje": "La tabla es nombre o base.nombre (letras, números y _)"})
        return {"tipo": "hive", "tabla": tabla, "modo": modo}, errores
    if tipo != "hdfs":
        errores.append({"campo": "salida.tipo", "mensaje": "La salida va a hdfs (una carpeta) o a hive (una tabla)"})
    ruta = s.get("ruta") or f"/user/root/ml/predicciones/{nombre}-v{version}"
    if not isinstance(ruta, str) or not RUTA.match(ruta) or ".." in ruta:
        errores.append({"campo": "salida.ruta", "mensaje": "La ruta de HDFS empieza con / (letras, números, _ - . = y /)"})
    fmt = s.get("formato") or "parquet"
    if fmt not in FORMATOS_SALIDA:
        errores.append({"campo": "salida.formato", "mensaje": f"El formato es {', '.join(FORMATOS_SALIDA)}"})
    return {"tipo": "hdfs", "ruta": ruta, "formato": fmt, "modo": modo}, errores


def generar(x: dict, carpeta: Path, datos: dict, salida: dict, *, nombre: str, fecha: str = "") -> str:
    """El script de PySpark que predice con la versión x (de biblioteca) los datos de `datos` y escribe en `salida`.
    carpeta: la carpeta de la versión (referencia.json, experimento.json, modelo.joblib)."""
    exp = json.loads((Path(carpeta) / "experimento.json").read_text(encoding="utf-8"))
    motor, tarea = x.get("motor"), x["tarea"]
    entrada = x.get("entrada") or []
    clases = x.get("clases")
    ref = Path(carpeta) / "referencia.json"
    variables = exp.get("variables") or {}
    codificadas = (x.get("modelo") or {}).get("clase", "").startswith("xgboost") and tarea == "clasificacion"
    L: list[str] = [
        f"# Predicción por lotes con {nombre} v{x['version']} ({(x.get('modelo') or {}).get('etiqueta')}, "
        f"{'Spark MLlib' if motor == 'spark' else 'scikit-learn'}) · BigData Sandbox{' · ' + fecha if fecha else ''}",
        "#",
        "#     spark-submit --master yarn lote.py",
        "#",
        "# Lee los datos nuevos, valida el esquema contra el del entrenamiento, mide la deriva, predice y escribe.",
        "import json",
        "import sys",
        "import time",
        "",
        "from pyspark.sql import SparkSession, functions as F",
        "",
        "try:",
        "    from sandbox_ml import deriva   # el PSI contra el entrenamiento (si no está, no se mide la deriva)",
        "except ImportError:",
        "    deriva = None",
        "",
        f"MODELO, VERSION = {lit(nombre)}, {int(x['version'])}",
        f"MOTOR, TAREA = {lit(motor)}, {lit(tarea)}",
        f"ARTEFACTO = {lit(x['artefacto'])}",
        f"ENTRADA = {lit(entrada)}   # las columnas que usa el modelo y su tipo en el entrenamiento",
        f"VARIABLES = {lit(variables)}",
        f"CLASES = {lit(clases)}",
        f"SALIDA = {lit(salida)}",
        f"REFERENCIA = {lit(str(ref)) if ref.is_file() else 'None'}",
        "INICIO = time.perf_counter()",
        "resumen = {\"modelo\": MODELO, \"version\": VERSION, \"motor\": MOTOR, \"salida\": SALIDA, \"avisos\": []}",
        "",
        "",
        "def paso(avance, mensaje):",
        '    print(f"[{avance:3d}%] {mensaje}", flush=True)',
        "",
        "",
        "def parar(mensaje, detalle=None):",
        '    print("@@error@@ " + json.dumps({"mensaje": mensaje, "detalle": detalle}, ensure_ascii=False), flush=True)',
        "    sys.exit(1)",
        "",
        "",
        "spark = (SparkSession.builder.appName(f\"estudio-ml: predecir {MODELO} v{VERSION}\")"
        + ("\n         .enableHiveSupport()" if datos["origen"] == "hive" or salida["tipo"] == "hive" else "")
        + ".getOrCreate())",
        "resumen[\"app_id\"] = spark.sparkContext.applicationId",
        'print("Aplicación de YARN:", resumen["app_id"], flush=True)',
        "",
        "# %% 1. Los datos nuevos",
        'paso(5, "Leyendo los datos nuevos")',
    ]
    if datos["origen"] == "local":
        archivo = datos["ruta"].rsplit("/", 1)[-1]
        L += ["import subprocess",
              "# Los executors de YARN leen de HDFS: el archivo de /datos se sube primero",
              f"EN_HDFS = {lit('/user/root/ml/estudio/' + archivo)}",
              'subprocess.run(["hdfs", "dfs", "-mkdir", "-p", "/user/root/ml/estudio"], check=True)',
              f'subprocess.run(["hdfs", "dfs", "-put", "-f", {lit(datos["ruta"])}, EN_HDFS], check=True)']
    L += fuentes.codigo_lector(datos, "EN_HDFS" if datos["origen"] == "local" else None)
    if datos.get("limite"):
        L.append(f"datos = datos.limit({int(datos['limite'])})")
    L += [
        "ORIGINALES = list(datos.columns)",
        "",
        "# %% 2. Esquema: lo que el modelo necesita",
        'paso(15, "Revisando el esquema contra el del entrenamiento")',
        "faltan = [c[\"columna\"] for c in ENTRADA if c[\"columna\"] not in datos.columns]",
        "if faltan:",
        "    parar(\"Faltan columnas que el modelo usa: \" + \", \".join(faltan),",
        "          \"llegaron: \" + \", \".join(datos.columns))",
        "usadas = {c[\"columna\"] for c in ENTRADA}",
        "tipos = dict(datos.dtypes)",
        f"NUMERICOS = {lit(list(NUMERICOS))}",
        "conversiones = []",
        "for c in ENTRADA:",
        "    col, esperado, llego = c[\"columna\"], c.get(\"tipo\"), tipos[c[\"columna\"]]",
        "    numerica = c[\"rol\"] == \"numerica\" or (esperado or \"\").split(\"(\")[0] in NUMERICOS",
        "    if numerica and llego.split(\"(\")[0] not in NUMERICOS:",
        "        conversiones.append((col, llego, \"double\"))",
        "    elif c[\"rol\"] == \"categorica\" and esperado == \"string\" and llego != \"string\":",
        "        conversiones.append((col, llego, \"string\"))",
        "# Las copias de las columnas tal como llegaron: la limpieza del modelo las cambia y la salida lleva las originales",
        "datos = datos.select(\"*\", *[F.col(c).alias(f\"_orig_{i}\") for i, c in enumerate(ORIGINALES)])",
        "fallas = {}",
        "if conversiones:",
        "    cuenta = datos.agg(*[F.sum(F.when(F.col(c).isNotNull() & F.col(c).cast(a).isNull(), 1).otherwise(0)).alias(c)",
        "                         for c, _, a in conversiones]).first()",
        "    fallas = {c: int(cuenta[c] or 0) for c, _, _ in conversiones}",
        "    for c, _, a in conversiones:",
        "        datos = datos.withColumn(c, F.col(c).cast(a))",
        "resumen[\"esquema\"] = {",
        "    \"faltan\": [],",
        "    \"sobran\": [c for c in ORIGINALES if c not in usadas],",
        "    \"convertidas\": [{\"columna\": c, \"de\": de, \"a\": a, \"no_convertidos\": fallas.get(c, 0)} for c, de, a in conversiones],",
        "}",
        "for c in resumen[\"esquema\"][\"convertidas\"]:",
        "    if c[\"no_convertidos\"]:",
        "        resumen[\"avisos\"].append(f\"{c['columna']}: {c['no_convertidos']:,} valores no son números y quedan nulos\")",
        "",
        "# %% 3. Deriva: ¿se parecen al entrenamiento?",
        "if deriva and REFERENCIA:",
        '    paso(25, "Midiendo la deriva contra el entrenamiento")',
        "    with open(REFERENCIA, encoding=\"utf-8\") as f:",
        "        referencia = json.load(f)",
        "    resumen[\"deriva\"] = deriva.comparar(referencia, deriva.contar_spark(datos, referencia))",
        "    for c in resumen[\"deriva\"][\"columnas\"]:",
        "        print(f\"  deriva de {c['columna']:<24} PSI {c['psi'] if c['psi'] is not None else '—'} ({c['nivel'] or 'falta'})\")",
        "else:",
        "    resumen[\"deriva\"] = None",
        "",
        "# %% 4. Predecir",
        'paso(40, "Prediciendo en los executors")',
    ]
    if motor == "spark":
        L += _predecir_spark(tarea, clases)
    else:
        L += _predecir_sklearn(tarea, clases, variables, codificadas)
    L += [
        "salida = pred.select(*[F.col(f\"_orig_{i}\").alias(c) for i, c in enumerate(ORIGINALES)], *NUEVAS)",
        "",
        "# %% 5. Escribir",
        'paso(70, "Escribiendo las predicciones")',
    ]
    if salida["tipo"] == "hive":
        L += ["salida.write.mode(SALIDA[\"modo\"]).format(\"parquet\").saveAsTable(SALIDA[\"tabla\"])",
              "escrito = spark.table(SALIDA[\"tabla\"])",
              "resumen[\"destino\"] = SALIDA[\"tabla\"]"]
    else:
        L += ["escritor = salida.write.mode(SALIDA[\"modo\"])",
              "if SALIDA[\"formato\"] == \"csv\":",
              "    escritor = escritor.option(\"header\", True)",
              "escritor.format(SALIDA[\"formato\"]).save(SALIDA[\"ruta\"])",
              "lector = spark.read.option(\"header\", True).option(\"inferSchema\", True) if SALIDA[\"formato\"] == \"csv\" else spark.read",
              "escrito = lector.format(SALIDA[\"formato\"]).load(SALIDA[\"ruta\"])",
              "resumen[\"destino\"] = \"hdfs://\" + SALIDA[\"ruta\"]"]
    L += [
        'paso(90, "Contando lo escrito")',
        "resumen[\"filas\"] = escrito.count()",
        "resumen[\"columnas\"] = escrito.columns",
        f"resumen[\"muestra\"] = [[v if isinstance(v, (int, float, str, bool)) or v is None else str(v) for v in f] for f in escrito.limit({MUESTRA}).collect()]",
        "resumen[\"nuevas\"] = NUEVAS",
        "if TAREA in (\"clasificacion\", \"clustering\"):",
        "    col = \"prediccion\" if TAREA == \"clasificacion\" else \"grupo\"",
        "    resumen[\"conteo\"] = {str(r[col]): r[\"count\"] for r in escrito.groupBy(col).count().orderBy(F.desc(\"count\")).limit(30).collect()}",
        "resumen[\"tiempo\"] = round(time.perf_counter() - INICIO, 2)",
        "print(f\"{resumen['filas']:,} predicciones en {resumen['destino']} ({resumen['tiempo']} s)\", flush=True)",
        f"print({lit(PREDICCION)} + json.dumps(resumen, ensure_ascii=False, default=str), flush=True)",
        "spark.stop()",
        'paso(100, "Listo")',
    ]
    return "\n".join(L) + "\n"


def _predecir_spark(tarea: str, clases: list | None) -> list[str]:
    L = ["from pyspark.ml import PipelineModel",
         "try:",
         "    from sandbox_ml.transformadores_spark import Limpiar  # noqa: F401  (el paso de limpieza del modelo)",
         "except ImportError:",
         "    pass",
         "modelo = PipelineModel.load(ARTEFACTO)",
         "pred = modelo.transform(datos)"]
    if tarea == "clasificacion":
        L += ["from pyspark.ml.functions import vector_to_array",
              "NUEVAS = [\"prediccion\"]",
              "etiquetas = F.array(*[F.lit(str(c)) for c in CLASES])",
              "pred = pred.withColumn(\"prediccion\", F.element_at(etiquetas, F.col(\"prediction\").cast(\"int\") + 1))",
              "if \"probability\" in pred.columns:",
              "    pred = pred.withColumn(\"_p\", vector_to_array(\"probability\"))",
              "    for i, c in enumerate(CLASES):",
              "        pred = pred.withColumn(f\"prob_{c}\", F.round(F.col(\"_p\")[i], 4))",
              "        NUEVAS.append(f\"prob_{c}\")"]
    elif tarea == "clustering":
        L += ["pred = pred.withColumn(\"grupo\", F.col(\"prediction\").cast(\"int\"))", "NUEVAS = [\"grupo\"]"]
    elif tarea == "reduccion":
        L += ["from pyspark.ml.functions import vector_to_array",
              "salida_pca = modelo.stages[-1].getOutputCol()",
              "k = modelo.stages[-1].getK()",
              "pred = pred.withColumn(\"_c\", vector_to_array(salida_pca))",
              "NUEVAS = []",
              "for i in range(k):",
              "    pred = pred.withColumn(f\"componente_{i + 1}\", F.col(\"_c\")[i])",
              "    NUEVAS.append(f\"componente_{i + 1}\")"]
    elif tarea == "recomendacion":
        L += ["# ALS no predice para usuarios o ítems que no vio al entrenar (coldStartStrategy=drop): esas filas no salen",
              "pred = pred.withColumn(\"prediccion\", F.round(F.col(\"prediction\"), 4))",
              "NUEVAS = [\"prediccion\"]"]
    else:
        L += ["pred = pred.withColumn(\"prediccion\", F.col(\"prediction\"))", "NUEVAS = [\"prediccion\"]"]
    return L


def _predecir_sklearn(tarea: str, clases: list | None, variables: dict, codificadas: bool) -> list[str]:
    L = [
        "import os",
        "import shutil",
        "import tempfile",
        "from pyspark.sql.types import DoubleType, IntegerType, StringType, StructField, StructType",
        "",
        "# El Pipeline de scikit-learn viaja a cada executor (addFile) y cada uno lo carga una sola vez",
        "spark.sparkContext.addFile(ARTEFACTO)",
        "try:   # los pasos propios del sandbox (RecortarExtremos, ...) tienen que poder importarse en los executors",
        "    import sandbox_ml",
        "    zip_ml = shutil.make_archive(os.path.join(tempfile.mkdtemp(), \"sandbox_ml\"), \"zip\",",
        "                                 os.path.dirname(os.path.dirname(sandbox_ml.__file__)), \"sandbox_ml\")",
        "    spark.sparkContext.addPyFile(zip_ml)",
        "except ImportError:",
        "    pass",
        f"CODIFICADAS = {codificadas}   # XGBoost predice el número de clase: se pasa a la etiqueta con CLASES",
        "ORDEN = VARIABLES.get(\"numerica\", []) + VARIABLES.get(\"categorica\", []) + VARIABLES.get(\"fecha\", []) + VARIABLES.get(\"texto\", [])",
        "",
        "",
        "def preparar(pdf):",
        "    import pandas as pd",
        "    X = pdf[ORDEN].copy()",
        "    for c in VARIABLES.get(\"categorica\", []):",
        "        X[c] = X[c].astype(str).where(X[c].notna())",
        "    for c in VARIABLES.get(\"texto\", []):",
        "        X[c] = X[c].fillna(\"\")",
        "    for c in VARIABLES.get(\"numerica\", []):",
        "        X[c] = pd.to_numeric(X[c], errors=\"coerce\")",
        "    return X",
        "",
        "",
    ]
    campos = {"regresion": "DoubleType()", "clasificacion": "StringType()", "clustering": "IntegerType()"}
    if tarea == "reduccion":
        L += ["import joblib",
              "from pyspark import SparkFiles",
              "K = joblib.load(SparkFiles.get(os.path.basename(ARTEFACTO)))[-1].n_components_",
              "NUEVAS = [f\"componente_{i + 1}\" for i in range(K)]",
              "esquema = StructType(datos.schema.fields + [StructField(c, DoubleType()) for c in NUEVAS])",
              "",
              "",
              "def predecir(partes):",
              "    import joblib",
              "    from pyspark import SparkFiles",
              "    modelo = joblib.load(SparkFiles.get(os.path.basename(ARTEFACTO)))",
              "    for pdf in partes:",
              "        comp = modelo.transform(preparar(pdf))",
              "        for i, c in enumerate(NUEVAS):",
              "            pdf[c] = comp[:, i].astype(float)",
              "        yield pdf",
              ""]
    else:
        nombre = "grupo" if tarea == "clustering" else "prediccion"
        L += [f"NUEVAS = [{lit(nombre)}]",
              f"campos = [StructField({lit(nombre)}, {campos.get(tarea, 'StringType()')})]"]
        if tarea == "clasificacion":
            L += ["campos += [StructField(f\"prob_{c}\", DoubleType()) for c in CLASES]",
                  "NUEVAS += [f\"prob_{c}\" for c in CLASES]"]
        L += ["esquema = StructType(datos.schema.fields + campos)",
              "",
              "",
              "def predecir(partes):",
              "    import joblib",
              "    import numpy as np",
              "    from pyspark import SparkFiles",
              "    modelo = joblib.load(SparkFiles.get(os.path.basename(ARTEFACTO)))",
              "    if not hasattr(modelo[-1], \"predict\"):",
              "        raise ValueError(\"este modelo de agrupamiento no predice datos nuevos (solo agrupa los del entrenamiento)\")",
              "    for pdf in partes:",
              "        X = preparar(pdf)",
              "        p = modelo.predict(X)"]
        if tarea == "clasificacion":
            L += ["        pdf[\"prediccion\"] = [str(CLASES[int(v)]) for v in p] if CODIFICADAS else [str(v) for v in p]",
                  "        try:",
                  "            proba = modelo.predict_proba(X)",
                  "            nombres = [str(c) for c in (CLASES if CODIFICADAS else modelo.classes_)]",
                  "            for c in CLASES:",
                  "                pdf[f\"prob_{c}\"] = np.round(proba[:, nombres.index(str(c))], 4) if str(c) in nombres else np.nan",
                  "        except (AttributeError, NotImplementedError):",
                  "            for c in CLASES:",
                  "                pdf[f\"prob_{c}\"] = np.nan"]
        elif tarea == "clustering":
            L += ["        pdf[\"grupo\"] = p.astype(int)"]
        else:
            L += ["        pdf[\"prediccion\"] = p.astype(float)"]
        L += ["        yield pdf", ""]
    L += ["pred = datos.mapInPandas(predecir, schema=esquema)"]
    return L
