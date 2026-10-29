"""Receta → script de PySpark (Spark MLlib en YARN): la contraparte de codigo._Sklearn.

Se corre con spark-submit --master yarn: los datos se leen de HDFS (o de Hive)
y el entrenamiento se reparte en los executors. El orden cambia un poco
respecto de scikit-learn: primero se parte (los bordes de los extremos se
calculan con el entrenamiento) y después se arma el Pipeline.

La evaluación es honesta: entrenamiento, validación y prueba se separan de
entrada. La búsqueda (CrossValidator o TrainValidationSplit) mira solo el
entrenamiento; la validación mide al modelo elegido y elige el umbral; la prueba
se usa una sola vez, al final. Las curvas (ROC, PR, umbrales, residuos, error
por rango) se cuentan en los executors.
"""
from __future__ import annotations

import json

from . import catalogo as cat
from . import fuentes
from . import limpieza as lz
from .codigo import lit, nombre_archivo, titulo
from .receta import argumentos_spark, huella, variables

EVAL = {
    # métrica del catálogo → (evaluador, metricName)
    "r2": ("RegressionEvaluator", "r2"), "rmse": ("RegressionEvaluator", "rmse"), "mae": ("RegressionEvaluator", "mae"),
    "varianza_explicada": ("RegressionEvaluator", "var"),
    "exactitud": ("MulticlassClassificationEvaluator", "accuracy"), "f1_ponderado": ("MulticlassClassificationEvaluator", "f1"),
    "log_loss": ("MulticlassClassificationEvaluator", "logLoss"),
    "roc_auc": ("BinaryClassificationEvaluator", "areaUnderROC"), "pr_auc": ("BinaryClassificationEvaluator", "areaUnderPR"),
}
ESCALADOR = {"estandar": "StandardScaler(inputCol=\"num_vec\", outputCol=\"num_esc\", withMean=True, withStd=True)",
             "minmax": "MinMaxScaler(inputCol=\"num_vec\", outputCol=\"num_esc\")",
             "robusto": "RobustScaler(inputCol=\"num_vec\", outputCol=\"num_esc\")"}


EVAL_CLUSTER = r'''
# Las curvas y las matrices se cuentan en los executors: al driver solo llegan los totales por cubeta
# (≤ 200 filas), no las predicciones. Sirve igual con mil filas o con mil millones.
CUBETAS = 200


def puntaje(pred, clase=1):
    """La probabilidad de la clase; sin probabilidades (SVM), el puntaje crudo pasado por una sigmoide."""
    if "probability" in pred.columns:
        return vector_to_array("probability")[clase]
    return 1 / (1 + F.exp(-vector_to_array("rawPrediction")[clase]))


def cubetas(pred, clase=1):
    """Por cubeta de puntaje: positivos, negativos y la suma de los puntajes (para la calibración)."""
    s = puntaje(pred, clase)
    b = F.least(F.floor(F.col("s") * CUBETAS), F.lit(CUBETAS - 1)).cast("int")
    filas = (pred.select(s.alias("s"), (F.col("label") == clase).cast("int").alias("pos"))
             .groupBy(b.alias("b")).agg(F.sum("pos").alias("pos"), F.count("*").alias("n"), F.sum("s").alias("suma"))
             .collect())
    pos, neg, suma = [0] * CUBETAS, [0] * CUBETAS, [0.0] * CUBETAS
    for f in filas:
        i = min(max(int(f["b"] or 0), 0), CUBETAS - 1)
        pos[i] += int(f["pos"])
        neg[i] += int(f["n"]) - int(f["pos"])
        suma[i] += float(f["suma"] or 0.0)
    return pos, neg, suma


def curvas(pos, neg):
    """ROC y PR desde las cubetas, del umbral más alto al más bajo (positivo = puntaje ≥ umbral)."""
    P, N = sum(pos), sum(neg)
    vp = fp = 0
    roc = {"x": [0.0], "y": [0.0], "umbral": [1.0]}
    pr = {"x": [], "y": [], "umbral": []}
    for i in range(CUBETAS - 1, -1, -1):
        vp, fp = vp + pos[i], fp + neg[i]
        roc["x"].append(fp / N if N else 0.0)
        roc["y"].append(vp / P if P else 0.0)
        roc["umbral"].append(i / CUBETAS)
        if vp + fp:
            pr["x"].append(vp / P if P else 0.0)
            pr["y"].append(vp / (vp + fp))
            pr["umbral"].append(i / CUBETAS)
    xs, ys = roc["x"], roc["y"]
    roc["auc"] = sum((xs[j] - xs[j - 1]) * (ys[j] + ys[j - 1]) / 2 for j in range(1, len(xs)))
    pr["ap"] = sum((pr["x"][j] - (pr["x"][j - 1] if j else 0.0)) * pr["y"][j] for j in range(len(pr["x"])))
    return roc, pr


def tabla_umbrales(pos, neg):
    """La matriz de confusión en 51 umbrales (0, 0,02 … 1): para moverlo en la pantalla y para elegirlo."""
    P, N = sum(pos), sum(neg)
    out = []
    for j in range(51):
        desde = j * CUBETAS // 50
        vp, fp = sum(pos[desde:]), sum(neg[desde:])
        out.append({"umbral": j / 50, "vp": vp, "fp": fp, "fn": P - vp, "vn": N - fp})
    return out


def elegir_umbral(tabla, criterio):
    """El umbral de mejor F1 (o de Youden: TPR − FPR) entre 0,02 y 0,98."""
    def nota(t):
        if criterio == "youden":
            p, n = t["vp"] + t["fn"], t["fp"] + t["vn"]
            return (t["vp"] / p if p else 0.0) - (t["fp"] / n if n else 0.0)
        d = 2 * t["vp"] + t["fp"] + t["fn"]
        return 2 * t["vp"] / d if d else 0.0
    candidatos = [t for t in tabla if 0.02 <= t["umbral"] <= 0.98]
    mejor = max(candidatos, key=nota)
    return mejor["umbral"], nota(mejor)


def calibracion(pos, neg, suma, bins=10):
    """Probabilidad predicha contra la frecuencia real, en 10 franjas."""
    paso = CUBETAS // bins
    out = {"predicha": [], "real": [], "histograma": []}
    for j in range(bins):
        p, n, s = sum(pos[j * paso:(j + 1) * paso]), sum(neg[j * paso:(j + 1) * paso]), sum(suma[j * paso:(j + 1) * paso])
        out["histograma"].append(p + n)
        if p + n:
            out["predicha"].append(s / (p + n))
            out["real"].append(p / (p + n))
    return out


def matriz_confusion(pred, k):
    m = [[0] * k for _ in range(k)]
    for f in pred.groupBy("label", "prediction").count().collect():
        r, p = int(f["label"]), int(f["prediction"])
        if r < k and p < k:
            m[r][p] += int(f["count"])
    return m


def reporte(m, nombres):
    filas = []
    for i, n in enumerate(nombres):
        vp = m[i][i]
        pred_i, real_i = sum(m[j][i] for j in range(len(m))), sum(m[i])
        prec, rec = (vp / pred_i if pred_i else 0.0), (vp / real_i if real_i else 0.0)
        filas.append({"clase": n, "precision": prec, "recall": rec, "f1": 2 * prec * rec / (prec + rec) if prec + rec else 0.0,
                      "soporte": real_i})
    total = sum(f["soporte"] for f in filas) or 1
    prom = {"macro avg": {k: sum(f[k] for f in filas) / len(filas) for k in ("precision", "recall", "f1")},
            "weighted avg": {k: sum(f[k] * f["soporte"] for f in filas) / total for k in ("precision", "recall", "f1")}}
    return {"reporte": filas, "reporte_promedios": prom}


def informe_clasificacion(pred):
    nombres = [str(c) for c in CLASES]
    m = matriz_confusion(pred, len(CLASES))
    inf = {"clases": nombres, "confusion": m, **reporte(m, nombres), "calculado": "cluster"}
    con_proba = "probability" in pred.columns
    if BINARIA and (con_proba or "rawPrediction" in pred.columns):
        pos, neg, suma = cubetas(pred, 1)
        roc, pr = curvas(pos, neg)
        inf.update(roc=[{"clase": nombres[1], **roc}], pr=[{"clase": nombres[1], **pr}], positiva=nombres[1])
        if con_proba:
            inf.update(umbrales=tabla_umbrales(pos, neg), calibracion=calibracion(pos, neg, suma))
    elif con_proba and len(CLASES) <= 12:
        inf["roc"], inf["pr"] = [], []
        for i, n in enumerate(nombres):
            pos, neg, _ = cubetas(pred, i)
            if sum(pos) and sum(neg):
                roc, pr = curvas(pos, neg)
                inf["roc"].append({"clase": n, **roc})
                inf["pr"].append({"clase": n, **pr})
    return inf


def informe_regresion(pred, puntos=2000):
    """Residuos y error por rango del valor real, contados en los executors; una muestra para el gráfico."""
    r = (pred.select(F.col("label").cast("double").alias("y"), F.col("prediction").cast("double").alias("p"))
         .filter(~F.isnan("p")).withColumn("e", F.col("y") - F.col("p")).cache())
    lo, hi, n = r.agg(F.min("e"), F.max("e"), F.count("*")).first()
    if not n:
        return {"calculado": "cluster", "real": [], "predicho": [], "residuo": []}
    ancho = (hi - lo) / 30 or 1.0
    cuentas = [0] * 30
    for f in r.groupBy(F.least(F.floor((F.col("e") - lo) / ancho), F.lit(29)).cast("int").alias("b")).count().collect():
        cuentas[min(max(int(f["b"]), 0), 29)] += int(f["count"])
    cortes = sorted(set(r.approxQuantile("y", [j / 10 for j in range(1, 10)], 0.001)))
    rangos = (Bucketizer(splits=[-float("inf")] + cortes + [float("inf")], inputCol="y", outputCol="rango").transform(r)
              .groupBy("rango").agg(F.min("y").alias("desde"), F.max("y").alias("hasta"), F.count("*").alias("filas"),
                                    F.avg(F.abs("e")).alias("mae"), F.sqrt(F.avg(F.col("e") ** 2)).alias("rmse"),
                                    F.avg("e").alias("sesgo"))
              .orderBy("rango").collect())
    muestra = r.sample(fraction=min(1.0, 1.2 * puntos / n), seed=SEMILLA).limit(puntos).collect()
    return {"calculado": "cluster",
            "real": [f["y"] for f in muestra], "predicho": [f["p"] for f in muestra], "residuo": [f["e"] for f in muestra],
            "histograma_residuos": {"bordes": [lo + j * ancho for j in range(31)], "cuentas": cuentas},
            "error_por_rango": [{k: (int(f[k]) if k == "filas" else float(f[k])) for k in
                                 ("desde", "hasta", "filas", "mae", "rmse", "sesgo")} for f in rangos]}
'''


def comando(r: dict, archivo: str) -> str:
    """spark-submit con los recursos de la receta."""
    return " ".join(["spark-submit", "--master", "yarn", *argumentos_spark(r.get("recursos")), archivo])


def generar_spark(r: dict, experimento: str | None, fecha: str) -> str:
    return _Spark(r, experimento, fecha).script()


class _Spark:
    def __init__(self, r, exp, fecha):
        self.r, self.exp, self.fecha = r, exp, fecha
        self.m = cat.MODELOS[r["modelo"]["id"]]
        self.vars = variables(r)
        self.sup = r["tarea"] in ("regresion", "clasificacion", "recomendacion")
        self.clasif = r["tarea"] == "clasificacion"
        self.rec = r["tarea"] == "recomendacion"
        self.xgb = self.m.get("extra") == "xgboost"
        self.roles_rec = {rol: next((c for c, x in r["columnas"].items() if x == rol), None)
                          for rol in cat.ROLES_RECOMENDACION}
        self.pre, self.val, self.bus = r["preproceso"], r["validacion"], r["busqueda"]
        # La limpieza: lo que es solo del entrenamiento (antes de partir) y lo que va adentro del modelo
        self.lim_ent, self.lim_mod = lz.por_fase(r.get("limpieza"), r.get("objetivo"))
        self.ml: dict[str, set[str]] = {}
        self.out: list[str] = []

    def imp(self, mod, *n):
        self.ml.setdefault(mod, set()).update(n)

    def celda(self, t, md=None):
        if md:
            self.out += ["", "# %% [markdown]"] + [f"# {x}".rstrip() for x in md.strip().splitlines()]
        self.out += ["", f"# %% {t}"]

    def l(self, *ls):
        for x in ls:
            self.out.extend(x.split("\n"))

    def script(self) -> str:
        for f in (self.datos, self.variables_, self.particion,
                  self.preproceso_als if self.rec else self.preproceso, self.modelo):
            f()
        if self.sup:
            self.entrenar_supervisado()
        elif self.r["tarea"] == "clustering":
            self.agrupar()
        else:
            self.reducir()
        self.guardar()
        cuerpo = self.out
        self.out = []
        self.cabecera()
        return "\n".join(self.out + cuerpo).rstrip() + "\n"

    def cabecera(self):
        r = self.r
        md = [f"# {titulo(r)} (Spark MLlib)", "",
              f"Generado por el estudio de ML de BigData Sandbox el {self.fecha}"
              + (f" para el experimento **{self.exp}**" if self.exp else "") + f" (receta `{huella(r)}`).",
              "Reproduce la corrida exacta: mismos datos, misma semilla, mismos hiperparámetros.", "",
              "- Se corre en YARN: `" + comando(r, nombre_archivo(r, self.exp)) + "`",
              "- El entrenamiento se reparte en los executors; los datos tienen que estar en HDFS (o en Hive)."]
        if self.sup:
            md += ["- Evaluación honesta: entrenamiento, validación y prueba se separan de entrada; la prueba se usa "
                   "una sola vez, al final."]
        self.out += ["# %% [markdown]"] + [f"# {x}".rstrip() for x in md] + ["", "# %% Librerías, Spark y avance"]
        self.out += ["import json", "import time"]
        if r["datos"]["origen"] == "local":
            self.out.append("import subprocess")
        self.out += ["", "from pyspark.ml import Pipeline", "from pyspark.sql import SparkSession, functions as F"]
        for mod in sorted(self.ml):
            ns = sorted(self.ml[mod])
            linea = f"from {mod} import {', '.join(ns)}"
            if len(linea) > 110:
                linea = f"from {mod} import (\n    " + ",\n    ".join(ns) + ",\n)"
            self.out.append(linea)
        hive = "\n         .enableHiveSupport()" if r["datos"]["origen"] == "hive" else ""
        rec = {**cat.RECURSOS_DEFECTO, **(r.get("recursos") or {})}
        self.out += [
            "",
            "try:",
            "    from sandbox_ml import estudio  # registra la corrida para la pantalla de ML",
            "except ImportError:",
            "    estudio = None",
            "",
            f"SEMILLA = {self.val['semilla']}",
            f"PARALELO = {self.bus['n_jobs']}   # modelos que CrossValidator entrena a la vez (parallelism)",
            "# Lo que se le pide a YARN. El servidor lo pasa también a spark-submit; si editás estos números,",
            "# se usan los de acá (la memoria del driver solo cambia con --driver-memory).",
            f"RECURSOS = {lit(rec)}",
            f"EXPERIMENTO = estudio.carpeta().name if estudio else {lit(self.exp or 'experimento')}",
            "INICIO = time.perf_counter()",
            "resultado = {}",
            "",
            "",
            "def paso(avance, mensaje):",
            '    print(f"[{avance:3d}%] {mensaje}", flush=True)',
            "",
            "",
        ]
        if self.lim_ent or self.lim_mod:
            self.out += [""] + lz.cabecera(usa_modelo=bool(self.lim_mod)) + [""]
        self.out += [
            "",
            f"RECETA = json.loads(r'''{json.dumps(r, ensure_ascii=False, indent=1)}''')",
            "",
            'paso(3, "Arrancando Spark en YARN")',
            "spark = (SparkSession.builder.appName(\"estudio-ml: \" + EXPERIMENTO)",
            '         .config("spark.executor.instances", str(RECURSOS["executors"]))',
            '         .config("spark.executor.cores", str(RECURSOS["cores"]))',
            f'         .config("spark.executor.memory", f"{{RECURSOS[\'memoria_executor_mb\']}}m"){hive}',
            "         .getOrCreate())",
            'resultado["app_id"] = spark.sparkContext.applicationId',
            'print("Aplicación de YARN:", resultado["app_id"])',
        ]

    def datos(self):
        d = self.r["datos"]
        self.celda("1. Datos", "## 1. Datos")
        self.l('paso(10, "Leyendo los datos")')
        if d["origen"] == "local":
            nombre = d["ruta"].rsplit("/", 1)[-1]
            self.l("# Los executors de YARN leen de HDFS: el archivo de /datos se sube primero",
                   f"EN_HDFS = {lit('/user/root/ml/estudio/' + nombre)}",
                   'subprocess.run(["hdfs", "dfs", "-mkdir", "-p", "/user/root/ml/estudio"], check=True)',
                   f'subprocess.run(["hdfs", "dfs", "-put", "-f", {lit(d["ruta"])}, EN_HDFS], check=True)')
        self.l(*fuentes.codigo_lector(d, "EN_HDFS" if d["origen"] == "local" else None))
        if d.get("limite"):
            self.l(f"datos = datos.limit({d['limite']})")
        if self.lim_ent:
            self.l("", "# Limpieza solo de entrenamiento: duplicados, filtros y filas que se sacan, antes de partir.",
                   "# Los datos nuevos (al predecir) no pasan por acá.", "filas_crudas = datos.count()")
            for i, p in self.lim_ent:
                self.l(*lz.bloque_entrenamiento(i, p))
        self.l("datos = datos.cache()", "n_filas = datos.count()", 'print(f"{n_filas:,} filas y {len(datos.columns)} columnas")')
        if self.lim_ent:
            self.l('print(f"Limpieza de entrenamiento: {filas_crudas:,} → {n_filas:,} filas")',
                   'resultado["filas_limpieza"] = {"antes": filas_crudas, "despues": n_filas}')

    def variables_(self):
        r, v = self.r, self.vars
        self.celda("2. Objetivo y variables", "## 2. Objetivo y variables")
        if self.sup:
            self.l(f"OBJETIVO = {lit(r['objetivo'])}")
        if self.rec:
            self.l(f"USUARIO = {lit(self.roles_rec['usuario'])}", f"ITEM = {lit(self.roles_rec['item'])}")
            if not self.lim_mod:
                self.l("for c in (USUARIO, ITEM):   # ALS pide índices: se pasan a texto y después StringIndexer",
                       '    datos = datos.withColumn(c, F.col(c).cast("string"))')
        for nombre, rol in (("NUMERICAS", "numerica"), ("CATEGORICAS", "categorica"), ("FECHAS", "fecha"), ("TEXTOS", "texto")):
            self.l(f"{nombre} = {lit(v[rol])}")
        if self.sup:
            self.l("datos = datos.dropna(subset=[OBJETIVO])")
        if self.lim_mod:
            self.l("# Los tipos de cada rol se ponen adentro del modelo, después de la limpieza (paso 4)")
        if v["numerica"] and not self.lim_mod:
            self.l("for c in NUMERICAS:",
                   '    datos = datos.withColumn(c, F.col(c).cast("double"))')
            if self.pre["imputar_num"] == "cero":
                self.l("datos = datos.fillna(0.0, subset=NUMERICAS)")
        if v["categorica"] and not self.lim_mod:
            self.l("# Spark no imputa categorías: los nulos pasan a ser la categoría '(vacío)'",
                   "for c in CATEGORICAS:",
                   '    datos = datos.withColumn(c, F.coalesce(F.col(c).cast("string"), F.lit("(vacío)")))')
        if v["texto"] and not self.lim_mod:
            self.l('datos = datos.fillna("", subset=TEXTOS)')
        if self.clasif:
            self.imp("pyspark.ml.feature", "StringIndexer")
            self.l("# Las clases como 0, 1, 2... (en orden alfabético, como scikit-learn)",
                   'indexador = StringIndexer(inputCol=OBJETIVO, outputCol="label", stringOrderType="alphabetAsc").fit(datos)',
                   "datos = indexador.transform(datos)",
                   "CLASES = list(indexador.labels)",
                   "BINARIA = len(CLASES) == 2",
                   'print("Clases:", CLASES)')
        elif self.sup:
            self.l('datos = datos.withColumn("label", F.col(OBJETIVO).cast("double"))')

    def particion(self):
        if not self.sup:
            self.l("ent = datos")
            return
        val = self.val
        p, v = float(val["prueba"]), float(val["validacion"] or 0)
        e = round(1 - p - v, 4)
        self.celda("3. Partición", "## 3. Entrenamiento, validación y prueba\n"
                                   "Se separan ahora, antes de mirar nada: la búsqueda usa solo el entrenamiento, la "
                                   "validación mide al modelo elegido (y elige el umbral) y la prueba se usa una sola "
                                   "vez, al final.")
        self.l(f"FRACCIONES = {lit({'entrenamiento': e, 'validacion': v, 'prueba': p})}")
        if val["particion"] == "temporal":
            ct = val["columna_tiempo"]
            self.l(f"COLUMNA_TIEMPO = {lit(ct)}",
                   "# Lo más viejo entrena, lo del medio valida y lo más nuevo prueba",
                   'tiempo = F.col(COLUMNA_TIEMPO).cast("timestamp").cast("double") if dict(datos.dtypes)[COLUMNA_TIEMPO] in '
                   '("string", "date", "timestamp") else F.col(COLUMNA_TIEMPO).cast("double")',
                   'datos = datos.withColumn("_t", tiempo)',
                   f'corte_val, corte_prueba = datos.approxQuantile("_t", [{lit(e)}, {lit(round(1 - p, 4))}], 0.001)',
                   'ent = datos.filter(F.col("_t") <= corte_val).drop("_t")',
                   'val = datos.filter((F.col("_t") > corte_val) & (F.col("_t") <= corte_prueba)).drop("_t")',
                   'prueba = datos.filter(F.col("_t") > corte_prueba).drop("_t")')
        elif val["particion"] == "estratificada" and self.clasif:
            self.l("# Estratificada: la misma fracción de cada clase (sampleBy) en cada parte",
                   'datos = datos.withColumn("_fila", F.monotonically_increasing_id())',
                   f"ent = datos.sampleBy(\"label\", fractions={{float(i): {lit(e)} for i in range(len(CLASES))}}, seed=SEMILLA)",
                   'resto = datos.join(ent.select("_fila"), "_fila", "left_anti")',
                   f"val = resto.sampleBy(\"label\", fractions={{float(i): {lit(round(v / (v + p), 4))} for i in range(len(CLASES))}}, "
                   "seed=SEMILLA + 1)",
                   'prueba = resto.join(val.select("_fila"), "_fila", "left_anti").drop("_fila")',
                   'ent, val = ent.drop("_fila"), val.drop("_fila")')
        else:
            self.l(f"ent, val, prueba = datos.randomSplit([{lit(e)}, {lit(v)}, {lit(p)}], seed=SEMILLA)")
        self.l("ent, val, prueba = ent.cache(), val.cache(), prueba.cache()",
               'resultado["filas"] = {"entrenamiento": ent.count(), "validacion": val.count(), "prueba": prueba.count()}',
               'print("Filas:", resultado["filas"])',
               'if not resultado["filas"]["validacion"]:',
               "    val = None   # sin validación aparte: el umbral queda el del modelo")

    def preproceso(self):
        pre, v = self.pre, self.vars
        self.celda("4. Preprocesamiento", "## 4. Preprocesamiento\nLas etapas del Pipeline de Spark ML: aprenden solo con "
                                           "el entrenamiento (salvo los bordes de los extremos, que se calculan acá).")
        base = "ent"
        if self.lim_mod:
            self.l("# Limpieza adentro del modelo: cada paso es una expresión de Spark SQL del paso Limpiar del Pipeline.",
                   "# Lo que aprende (medianas, bordes, categorías) sale del entrenamiento y queda escrito en la expresión.",
                   "limpieza = PasosLimpieza()")
            for i, p in self.lim_mod:
                self.l(*lz.bloque_modelo(i, p))
            self.l("# Los tipos de cada rol, también adentro del modelo: los datos nuevos llegan igual que el entrenamiento")
            if v["numerica"]:
                self.l("for c in NUMERICAS:", '    limpieza.poner(c, f"CAST({q(c)} AS DOUBLE)")')
                if pre["imputar_num"] == "cero":
                    self.l("    limpieza.poner(c, f\"coalesce({q(c)}, 0.0D)\")")
            if v["categorica"]:
                self.l("for c in CATEGORICAS:   # Spark no imputa categorías: los nulos pasan a ser '(vacío)'",
                       """    limpieza.poner(c, f"coalesce(CAST({q(c)} AS STRING), '(vacío)')")""")
            if v["texto"]:
                self.l("for c in TEXTOS:", """    limpieza.poner(c, f"coalesce(CAST({q(c)} AS STRING), '')")""")
            self.l('print("Lo que aprendió la limpieza:", APRENDIDO)',
                   "etapas = [limpieza.etapa()]", "base = limpieza.aplicar(ent)   # el entrenamiento limpio, para los bordes",
                   "numericas = list(NUMERICAS)")
            base = "base"
        else:
            self.l("etapas = []", "numericas = list(NUMERICAS)")
        if v["fecha"] and pre["fecha"]:
            self.imp("pyspark.ml.feature", "SQLTransformer")
            self.l("# Cada fecha → año, mes, día, día de la semana (0 = lunes) y hora",
                   "partes = \", \".join(",
                   '    f"year(`{c}`) AS `{c}_anio`, month(`{c}`) AS `{c}_mes`, dayofmonth(`{c}`) AS `{c}_dia`, "',
                   '    f"(dayofweek(`{c}`) + 5) % 7 AS `{c}_dia_semana`, hour(`{c}`) AS `{c}_hora`" for c in FECHAS)',
                   'etapas.append(SQLTransformer(statement=f"SELECT *, {partes} FROM __THIS__"))',
                   'numericas += [f"{c}_{p}" for c in FECHAS for p in ("anio", "mes", "dia", "dia_semana", "hora")]')
        if v["numerica"] or (v["fecha"] and pre["fecha"]):
            if pre["outliers"] != "ninguno" and v["numerica"]:
                self.imp("pyspark.ml.feature", "SQLTransformer")
                if pre["outliers"] == "recortar_pct":
                    self.l("# Extremos: bordes en los percentiles 1 y 99 del ENTRENAMIENTO",
                           f"bordes = {{c: {base}.approxQuantile(c, [0.01, 0.99], 0.001) for c in NUMERICAS}}")
                else:
                    k = lit(float(pre["factor_iqr"]))
                    self.l(f"# Extremos: bordes en Q1 − {pre['factor_iqr']}·IQR y Q3 + {pre['factor_iqr']}·IQR del ENTRENAMIENTO",
                           "bordes = {}",
                           "for c in NUMERICAS:",
                           f"    q1, q3 = {base}.approxQuantile(c, [0.25, 0.75], 0.001)",
                           f"    bordes[c] = [q1 - {k} * (q3 - q1), q3 + {k} * (q3 - q1)]")
                self.l("# CASE y no least/greatest: esas se saltean los nulos (un nulo quedaría en el borde de abajo)",
                       'recortes = ", ".join(f"CASE WHEN `{c}` < {lo} THEN {lo} WHEN `{c}` > {hi} THEN {hi} ELSE `{c}` END AS `{c}_rec`"',
                       '                     for c, (lo, hi) in bordes.items())',
                       'etapas.append(SQLTransformer(statement=f"SELECT *, {recortes} FROM __THIS__"))',
                       'numericas = [f"{c}_rec" if c in NUMERICAS else c for c in numericas]')
            if pre["imputar_num"] in ("mediana", "media"):
                self.imp("pyspark.ml.feature", "Imputer")
                est = "median" if pre["imputar_num"] == "mediana" else "mean"
                self.l(f'etapas.append(Imputer(strategy="{est}", inputCols=numericas, outputCols=[f"{{c}}_imp" for c in numericas]))',
                       'numericas = [f"{c}_imp" for c in numericas]')
            self.imp("pyspark.ml.feature", "VectorAssembler")
            self.l('etapas.append(VectorAssembler(inputCols=numericas, outputCol="num_vec", handleInvalid="keep"))')
            if pre["escalar"] != "ninguno":
                clase = ESCALADOR[pre["escalar"]].split("(")[0]
                self.imp("pyspark.ml.feature", clase)
                self.l(f"etapas.append({ESCALADOR[pre['escalar']]})")
                vec = '["num_esc"]'
            else:
                vec = '["num_vec"]'
            self.l(f"vectores = {vec}")
        else:
            self.l("vectores = []")
        if v["categorica"] and pre["codificar"] == "hashing":
            self.imp("pyspark.ml.feature", "FeatureHasher")
            self.l("# Hashing: cada categoría cae en una de N columnas por su hash (sin diccionario: aguanta categorías nuevas)",
                   f'etapas.append(FeatureHasher(inputCols=CATEGORICAS, categoricalCols=CATEGORICAS, outputCol="cat_hash", '
                   f'numFeatures={pre["hash_columnas"]}))',
                   'vectores.append("cat_hash")')
        elif v["categorica"]:
            self.imp("pyspark.ml.feature", "StringIndexer")
            self.l('etapas.append(StringIndexer(inputCols=CATEGORICAS, outputCols=[f"{c}_idx" for c in CATEGORICAS], '
                   'handleInvalid="keep"))')
            if pre["codificar"] == "onehot":
                self.imp("pyspark.ml.feature", "OneHotEncoder")
                self.l('etapas.append(OneHotEncoder(inputCols=[f"{c}_idx" for c in CATEGORICAS], '
                       'outputCols=[f"{c}_oh" for c in CATEGORICAS], handleInvalid="keep"))',
                       'vectores += [f"{c}_oh" for c in CATEGORICAS]')
            else:
                self.l('vectores += [f"{c}_idx" for c in CATEGORICAS]')
        if v["texto"]:
            self.imp("pyspark.ml.feature", "Tokenizer", "HashingTF", "IDF")
            self.l("for c in TEXTOS:",
                   '    etapas += [Tokenizer(inputCol=c, outputCol=f"{c}_pal"),',
                   f'               HashingTF(inputCol=f"{{c}}_pal", outputCol=f"{{c}}_tf", numFeatures={pre["texto_max"]}),',
                   '               IDF(inputCol=f"{c}_tf", outputCol=f"{c}_tfidf")]',
                   '    vectores.append(f"{c}_tfidf")')
        self.imp("pyspark.ml.feature", "VectorAssembler")
        self.l('etapas.append(VectorAssembler(inputCols=vectores, outputCol="features", handleInvalid="keep"))',
               'columna = "features"')
        if pre["seleccion"] == "varianza":
            self.imp("pyspark.ml.feature", "VarianceThresholdSelector")
            self.l(f'etapas.append(VarianceThresholdSelector(featuresCol=columna, outputCol="sel", '
                   f'varianceThreshold={lit(float(pre["umbral_varianza"]))}))', 'columna = "sel"')
        elif pre["seleccion"] == "kbest" and self.sup:
            self.imp("pyspark.ml.feature", "UnivariateFeatureSelector")
            etiqueta = "categorical" if self.clasif else "continuous"
            self.l(f'etapas.append(UnivariateFeatureSelector(featuresCol=columna, outputCol="sel", labelCol="label", '
                   f'selectionMode="numTopFeatures").setFeatureType("continuous").setLabelType("{etiqueta}")'
                   f'.setSelectionThreshold({pre["k"]}))', 'columna = "sel"')
        if pre["pca"] is not None:
            self.imp("pyspark.ml.feature", "PCA")
            self.l(f'etapas.append(PCA(k={pre["pca"]}, inputCol=columna, outputCol="pca"))', 'columna = "pca"')

    def constructor(self) -> str:
        mod, _, clase = self.m["clase"].rpartition(".")
        self.imp(mod, clase)
        params = self.r["modelo"]["params"]
        args = []
        if self.r["tarea"] == "reduccion":
            args += ['inputCol=columna', 'outputCol="componentes"']
        elif self.rec:
            args += ['userCol="usuario_idx"', 'itemCol="item_idx"', 'ratingCol="label"']
        elif self.xgb:
            args += ["features_col=columna", 'label_col="label"']
        else:
            args.append("featuresCol=columna")
            if self.sup:
                args.append('labelCol="label"')
        for p in self.m["params"]:
            n = p["nombre"]
            if n not in params or params[n] is None:   # None = el de la librería (no se pasa)
                continue
            if p["tipo"] == "layers":
                args.append(f"{n}=[n_entradas, {params[n].replace(',', ', ')}, n_salidas]")
            else:
                args.append(f"{n}={lit(params[n])}")
        if self.m.get("semilla"):
            args.append(f"{self.m['semilla']}=SEMILLA")
        return f"{clase}(\n    " + ",\n    ".join(args) + ",\n)"

    def preproceso_als(self):
        self.celda("4. Preprocesamiento", "## 4. Preprocesamiento\nALS pide índices enteros para usuarios e ítems: "
                                           "StringIndexer los numera (los que no vio al entrenar quedan afuera).")
        self.imp("pyspark.ml.feature", "StringIndexer")
        if self.lim_mod:
            self.l("limpieza = PasosLimpieza()")
            for i, p in self.lim_mod:
                self.l(*lz.bloque_modelo(i, p))
            self.l("for c in (USUARIO, ITEM):", '    limpieza.poner(c, f"CAST({q(c)} AS STRING)")',
                   'print("Lo que aprendió la limpieza:", APRENDIDO)', "etapas = [limpieza.etapa()]")
        else:
            self.l("etapas = []")
        self.l('etapas.append(StringIndexer(inputCols=[USUARIO, ITEM], outputCols=["usuario_idx", "item_idx"], '
               'handleInvalid="keep"))',
               "columna = None")

    def modelo(self):
        self.celda("5. Modelo", f"## 5. Modelo: {self.m['etiqueta']}\n{self.m['que']}")
        if any(p["tipo"] == "layers" for p in self.m["params"]):
            self.l("# La red necesita el tamaño de la entrada (columnas que salen del preprocesamiento) y de la salida (clases)",
                   "muestra = Pipeline(stages=etapas).fit(ent.limit(2000)).transform(ent.limit(1)).first()",
                   "n_entradas, n_salidas = muestra[columna].size, len(CLASES)")
        self.l(f"modelo = {self.constructor()}", "pipeline = Pipeline(stages=etapas + [modelo])")

    def evaluadores(self) -> list[str]:
        nombres = [k for k in EVAL if cat.METRICAS[k]["tarea"] == cat.tarea_metrica(self.r["tarea"])]
        if self.clasif and not self.m.get("proba"):
            nombres = [k for k in nombres if k != "log_loss"]
        return nombres

    def entrenar_supervisado(self):
        b, val = self.bus, self.val
        nombres = self.evaluadores()
        for k in nombres:
            self.imp("pyspark.ml.evaluation", EVAL[k][0])
        self.celda("6. Métricas")
        dic = ", ".join(f'{lit(k)}: ({EVAL[k][0]}, {lit(EVAL[k][1])})' for k in nombres
                        if EVAL[k][0] != "BinaryClassificationEvaluator")
        self.l(f"METRICAS = {{{dic}}}")
        if self.clasif and any(EVAL[k][0] == "BinaryClassificationEvaluator" for k in nombres):
            self.l("if BINARIA:",
                   '    METRICAS.update(roc_auc=(BinaryClassificationEvaluator, "areaUnderROC"),',
                   '                    pr_auc=(BinaryClassificationEvaluator, "areaUnderPR"))')
        self.l(f"PRINCIPAL = {lit(val['metrica'])}",
               "",
               "",
               "def evaluador(nombre):",
               "    clase, metrica = METRICAS[nombre]")
        if self.clasif:
            self.l("    if clase is BinaryClassificationEvaluator:   # ROC y PR miran el puntaje, no la clase",
                   '        return clase(labelCol="label", rawPredictionCol="rawPrediction", metricName=metrica)')
        self.l('    return clase(labelCol="label", predictionCol="prediction", metricName=metrica)',
               "",
               "",
               "def medir(pred):",
               "    return {nombre: float(evaluador(nombre).evaluate(pred)) for nombre in METRICAS}")
        self.imp("pyspark.ml.functions", "vector_to_array")
        self.imp("pyspark.ml.feature", "Bucketizer")
        self.celda("Evaluación en el cluster", "## Evaluación en el cluster\nROC, PR, umbrales, calibración, matriz "
                                               "de confusión, residuos y error por rango: se cuentan en los executors.")
        self.l(*EVAL_CLUSTER.strip("\n").split("\n"))
        tipo = b["tipo"]
        con_cv = tipo == "cv" or (tipo == "ninguna" and val["cv"] == "kfold")
        if tipo != "ninguna" or con_cv:
            self.imp("pyspark.ml.tuning", "ParamGridBuilder")
            titulo = cat.BUSQUEDAS["spark"][tipo]["etiqueta"] if tipo != "ninguna" else "CrossValidator (validación cruzada)"
            self.celda("7. Validación y búsqueda", f"## 7. {titulo}\n" + (
                f"{cat.BUSQUEDAS['spark'][tipo]['ayuda']} Presupuesto: {b.get('ajustes', 0)} entrenamientos."
                if tipo != "ninguna" else f"Una sola combinación con {val['k']} particiones: el promedio y el desvío de la métrica."))
            self.l("grilla = ParamGridBuilder()")
            for k, vals in b["espacio"].items():
                p = cat.param(self.m, k)
                if p["tipo"] == "layers":
                    vs = ", ".join(f"[n_entradas, {v.replace(',', ', ')}, n_salidas]" for v in vals)
                else:
                    vs = ", ".join(lit(v) for v in vals)
                self.l(f"grilla = grilla.addGrid(modelo.{k}, [{vs}])")
            self.l("grilla = grilla.build()")
            if tipo == "tvs":
                self.imp("pyspark.ml.tuning", "TrainValidationSplit")
                self.l("ajustador = TrainValidationSplit(estimator=pipeline, estimatorParamMaps=grilla, evaluator=evaluador(PRINCIPAL),",
                       "                                 trainRatio=0.8, parallelism=PARALELO, seed=SEMILLA)")
            else:
                self.imp("pyspark.ml.tuning", "CrossValidator")
                self.l(f"ajustador = CrossValidator(estimator=pipeline, estimatorParamMaps=grilla, evaluator=evaluador(PRINCIPAL),",
                       f"                           numFolds={val['k']}, parallelism=PARALELO, seed=SEMILLA)")
            self.l("# La búsqueda ve solo el entrenamiento: ni la validación ni la prueba",
                   'paso(20, f"Validando {len(grilla)} combinaciones en YARN")',
                   "t0 = time.perf_counter()",
                   "ajuste = ajustador.fit(ent)",
                   'resultado["tiempo_busqueda"] = time.perf_counter() - t0',
                   "modelo_final = ajuste.bestModel",
                   "metricas = ajuste.validationMetrics if hasattr(ajuste, \"validationMetrics\") else ajuste.avgMetrics",
                   'desvios = list(getattr(ajuste, "stdMetrics", None) or [0.0] * len(metricas))',
                   "mayor_mejor = evaluador(PRINCIPAL).isLargerBetter()",
                   "orden = sorted(range(len(metricas)), key=lambda i: -metricas[i] if mayor_mejor else metricas[i])",
                   'resultado["busqueda_spark"] = [{"params": {p.name: (v if isinstance(v, (int, float, str, bool)) else str(v))',
                   "                                          for p, v in grilla[i].items()},",
                   '                                "media": float(metricas[i]), "desvio": float(desvios[i])} for i in orden]',
                   'mejor = resultado["busqueda_spark"][0]',
                   'print(f"Mejor: {mejor[\'params\']} → {PRINCIPAL} = {mejor[\'media\']:.4f} ± {mejor[\'desvio\']:.4f}")')
        else:
            self.celda("7. Entrenar", "## 7. Entrenar en los executors")
            self.l('paso(30, "Entrenando en YARN")',
                   "t0 = time.perf_counter()",
                   "modelo_final = pipeline.fit(ent)",
                   'resultado["tiempo_entrenar"] = time.perf_counter() - t0')
        umbral = self.clasif and val["umbral"] != "fijo" and self.m.get("proba") and not self.xgb
        self.celda("8. Validación", "## 8. Validación: el modelo elegido con datos que la búsqueda no vio" +
                   ("\nAcá se elige el umbral de decisión (la prueba no se mira para eso)." if umbral else ""))
        self.l('paso(70, "Midiendo en la validación")',
               "if val is not None:",
               "    pred_val = modelo_final.transform(val).cache()")
        if umbral:
            self.l(f"    CRITERIO_UMBRAL = {lit(val['umbral'])}",
                   '    if BINARIA and "probability" in pred_val.columns:',
                   "        pos, neg, _ = cubetas(pred_val, 1)",
                   "        UMBRAL, nota = elegir_umbral(tabla_umbrales(pos, neg), CRITERIO_UMBRAL)",
                   "        # thresholds = [1 − u, u]: predice positivo cuando p(positivo) ≥ u (queda guardado en el modelo)",
                   "        est = modelo_final.stages[-1]",
                   '        if est.hasParam("threshold"):   # la logística tiene threshold (binaria) además de thresholds',
                   "            est.setThreshold(UMBRAL)",
                   "        else:",
                   "            est.set(est.thresholds, [1 - UMBRAL, UMBRAL])",
                   '        resultado["umbral"] = {"criterio": CRITERIO_UMBRAL, "valor": UMBRAL, "nota": nota}',
                   '        print(f"Umbral elegido en la validación ({CRITERIO_UMBRAL}): {UMBRAL:.2f}")',
                   "        pred_val = modelo_final.transform(val)")
        self.l('    resultado["validacion"] = medir(pred_val)',
               '    for nombre, v in resultado["validacion"].items():',
               '        print(f"  validación {nombre:>22}: {v:.4f}")')
        self.celda("9. Prueba", "## 9. Prueba: una sola vez, al final\nCon todo ya decidido (modelo, hiperparámetros y "
                                "umbral): es la nota honesta.")
        self.l('paso(80, "Probando (una sola vez)")',
               "t0 = time.perf_counter()",
               "pred = modelo_final.transform(prueba).cache()",
               'resultado["prueba"] = medir(pred)',
               'resultado["tiempo_predecir"] = time.perf_counter() - t0',
               'resultado["entrenamiento"] = medir(modelo_final.transform(ent))',
               'for nombre, v in resultado["prueba"].items():',
               '    print(f"  {nombre:>22}: {v:.4f}   (entrenamiento {resultado[\'entrenamiento\'][nombre]:.4f})")',
               'paso(86, "Curvas y matrices en el cluster")',
               "t0 = time.perf_counter()",
               f'resultado["informe"] = {"informe_clasificacion" if self.clasif else "informe_regresion"}(pred)',
               'resultado["tiempo_curvas"] = time.perf_counter() - t0')
        if self.clasif:
            self.l('print("Matriz de confusión (filas = real, columnas = predicho):")',
                   'for fila in resultado["informe"]["confusion"]:',
                   '    print("  ", fila)')
        if self.rec:
            self.imp("pyspark.ml.feature", "StringIndexerModel")
            self.l("# Cinco usuarios con sus cinco recomendaciones (con los ids de verdad, no los índices)",
                   'indices = next(s for s in modelo_final.stages if isinstance(s, StringIndexerModel))',
                   "usuarios, items = indices.labelsArray",
                   'resultado["recomendaciones"] = [',
                   '    {"usuario": usuarios[int(f["usuario_idx"])],',
                   '     "items": [{"item": items[int(x["item_idx"])], "puntaje": float(x["rating"])} for x in f["recommendations"]]}',
                   "    for f in modelo_final.stages[-1].recommendForAllUsers(5).limit(5).collect()]",
                   'print("Recomendaciones:", resultado["recomendaciones"][:2])')

    def agrupar(self):
        self.imp("pyspark.ml.evaluation", "ClusteringEvaluator")
        self.celda("6. Agrupar", "## 6. Agrupar\nSe entrena con todas las filas y se mide la silhouette.")
        self.l('paso(30, "Agrupando en YARN")',
               "t0 = time.perf_counter()",
               "modelo_final = pipeline.fit(datos)",
               'resultado["tiempo_entrenar"] = time.perf_counter() - t0',
               "pred = modelo_final.transform(datos).cache()",
               'resultado["filas"] = {"entrenamiento": n_filas, "prueba": 0}',
               'resultado["prueba"] = {"silhouette": float(ClusteringEvaluator(featuresCol=columna).evaluate(pred))}',
               'print("Tamaños:", {r["prediction"]: r["count"] for r in pred.groupBy("prediction").count().collect()})',
               'print("silhouette:", round(resultado["prueba"]["silhouette"], 4))')
        cv = self.r["informe"]["curva_validacion"]
        if cv:
            self.l(f"VALORES = {lit(cv['valores'])}",
                   f'curva = {{"param": {lit(cv["param"])}, "valores": [str(v) for v in VALORES], "silhouette": []}}',
                   "for v in VALORES:",
                   f"    m = pipeline.copy({{modelo.{cv['param']}: v}}).fit(datos)",
                   '    curva["silhouette"].append(float(ClusteringEvaluator(featuresCol=columna).evaluate(m.transform(datos))))',
                   'resultado["curva_validacion"] = curva')

    def reducir(self):
        self.celda("6. Reducir", "## 6. Componentes principales")
        self.l('paso(30, "Calculando las componentes en YARN")',
               "t0 = time.perf_counter()",
               "modelo_final = pipeline.fit(datos)",
               'resultado["tiempo_entrenar"] = time.perf_counter() - t0',
               "varianza = modelo_final.stages[-1].explainedVariance.toArray()",
               'resultado["filas"] = {"entrenamiento": n_filas, "prueba": 0}',
               'resultado["prueba"] = {"varianza_acumulada": float(varianza.sum())}',
               "pred = modelo_final.transform(datos)",
               "for i, v in enumerate(varianza):",
               '    print(f"  componente {i + 1}: {v * 100:5.1f} %")')

    def guardar(self):
        self.celda("Guardar el modelo", "## Guardar el modelo en HDFS\nEl PipelineModel entero: `PipelineModel.load(ruta)` "
                                        "lo vuelve a cargar.")
        self.l('paso(92, "Guardando el modelo en HDFS")',
               'MODELO = f"/user/root/ml/modelos/{EXPERIMENTO}"',
               "modelo_final.write().overwrite().save(MODELO)",
               'resultado["modelo_hdfs"] = MODELO',
               'resultado["tiempo_total"] = time.perf_counter() - INICIO',
               'print(f"Modelo en hdfs://{MODELO}; todo tardó {resultado[\'tiempo_total\']:.1f} s")',
               "if estudio:",
               "    estudio.registrar_spark(RECETA, modelo_final, resultado, pred=pred" +
               (", clases=CLASES" if self.clasif else "") + ", recursos=RECURSOS)",
               "spark.stop()",
               'paso(100, "Listo")')
