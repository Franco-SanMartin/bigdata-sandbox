"""Receta → script de PySpark (Spark MLlib en YARN): la contraparte de codigo._Sklearn.

Se corre con spark-submit --master yarn: los datos se leen de HDFS (o de Hive)
y el entrenamiento se reparte en los executors. El orden cambia un poco
respecto de scikit-learn: primero se parte (los bordes de los extremos se
calculan con el entrenamiento) y después se arma el Pipeline.
"""
from __future__ import annotations

import json

from . import catalogo as cat
from .codigo import lit, nombre_archivo, titulo
from .receta import huella, variables

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


def generar_spark(r: dict, experimento: str | None, fecha: str) -> str:
    return _Spark(r, experimento, fecha).script()


class _Spark:
    def __init__(self, r, exp, fecha):
        self.r, self.exp, self.fecha = r, exp, fecha
        self.m = cat.MODELOS[r["modelo"]["id"]]
        self.vars = variables(r)
        self.sup = r["tarea"] in ("regresion", "clasificacion")
        self.clasif = r["tarea"] == "clasificacion"
        self.pre, self.val, self.bus = r["preproceso"], r["validacion"], r["busqueda"]
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
        for f in (self.datos, self.variables_, self.particion, self.preproceso, self.modelo):
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
              "- Se corre en YARN: `spark-submit --master yarn " + nombre_archivo(r, self.exp) + "`",
              "- El entrenamiento se reparte en los executors; los datos tienen que estar en HDFS (o en Hive)."]
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
        hive = ".enableHiveSupport()" if r["datos"]["origen"] == "hive" else ""
        self.out += [
            "",
            "try:",
            "    from sandbox_ml import estudio  # registra la corrida para la pantalla de ML",
            "except ImportError:",
            "    estudio = None",
            "",
            f"SEMILLA = {self.val['semilla']}",
            f"PARALELO = {self.bus['n_jobs']}   # modelos que CrossValidator entrena a la vez",
            f"EXPERIMENTO = estudio.carpeta().name if estudio else {lit(self.exp or 'experimento')}",
            "INICIO = time.perf_counter()",
            "resultado = {}",
            "",
            "",
            "def paso(avance, mensaje):",
            '    print(f"[{avance:3d}%] {mensaje}", flush=True)',
            "",
            "",
            f"RECETA = json.loads(r'''{json.dumps(r, ensure_ascii=False, indent=1)}''')",
            "",
            'paso(3, "Arrancando Spark en YARN")',
            f'spark = SparkSession.builder.appName("estudio-ml: " + EXPERIMENTO){hive}.getOrCreate()',
            'resultado["app_id"] = spark.sparkContext.applicationId',
            'print("Aplicación de YARN:", resultado["app_id"])',
        ]

    def datos(self):
        d = self.r["datos"]
        self.celda("1. Datos", "## 1. Datos")
        self.l('paso(10, "Leyendo los datos")')
        sep = d.get("separador", ",")
        if d["origen"] == "hive":
            self.l(f"datos = spark.table({lit(d['tabla'])})")
        else:
            ruta = d["ruta"]
            if d["origen"] == "local":
                nombre = ruta.rsplit("/", 1)[-1]
                self.l("# Los executors de YARN leen de HDFS: el archivo de /datos se sube primero",
                       f"EN_HDFS = {lit('/user/root/ml/estudio/' + nombre)}",
                       'subprocess.run(["hdfs", "dfs", "-mkdir", "-p", "/user/root/ml/estudio"], check=True)',
                       f'subprocess.run(["hdfs", "dfs", "-put", "-f", {lit(ruta)}, EN_HDFS], check=True)')
                ruta_expr = "EN_HDFS"
            else:
                ruta_expr = lit(ruta)
            if d["formato"] == "parquet":
                self.l(f"datos = spark.read.parquet({ruta_expr})")
            else:
                s = "" if sep == "," else f", sep={lit(sep)}"
                self.l(f"datos = spark.read.csv({ruta_expr}, header=True, inferSchema=True{s})")
        if d.get("limite"):
            self.l(f"datos = datos.limit({d['limite']})")
        self.l("datos = datos.cache()", "n_filas = datos.count()", 'print(f"{n_filas:,} filas y {len(datos.columns)} columnas")')

    def variables_(self):
        r, v = self.r, self.vars
        self.celda("2. Objetivo y variables", "## 2. Objetivo y variables")
        if self.sup:
            self.l(f"OBJETIVO = {lit(r['objetivo'])}")
        for nombre, rol in (("NUMERICAS", "numerica"), ("CATEGORICAS", "categorica"), ("FECHAS", "fecha"), ("TEXTOS", "texto")):
            self.l(f"{nombre} = {lit(v[rol])}")
        if self.sup:
            self.l("datos = datos.dropna(subset=[OBJETIVO])")
        if v["numerica"]:
            self.l("for c in NUMERICAS:",
                   '    datos = datos.withColumn(c, F.col(c).cast("double"))')
            if self.pre["imputar_num"] == "cero":
                self.l("datos = datos.fillna(0.0, subset=NUMERICAS)")
        if v["categorica"]:
            self.l("# Spark no imputa categorías: los nulos pasan a ser la categoría '(vacío)'",
                   "for c in CATEGORICAS:",
                   '    datos = datos.withColumn(c, F.coalesce(F.col(c).cast("string"), F.lit("(vacío)")))')
        if v["texto"]:
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
        self.celda("3. Partición", "## 3. Partición en entrenamiento y prueba")
        p = float(val["prueba"])
        if val["particion"] == "temporal":
            ct = val["columna_tiempo"]
            self.l(f"COLUMNA_TIEMPO = {lit(ct)}",
                   "# Lo más viejo entrena, lo más nuevo prueba",
                   'tiempo = F.col(COLUMNA_TIEMPO).cast("timestamp").cast("double") if dict(datos.dtypes)[COLUMNA_TIEMPO] in '
                   '("string", "date", "timestamp") else F.col(COLUMNA_TIEMPO).cast("double")',
                   'datos = datos.withColumn("_t", tiempo)',
                   f'corte = datos.approxQuantile("_t", [{lit(1 - p)}], 0.001)[0]',
                   'ent, prueba = datos.filter(F.col("_t") <= corte).drop("_t"), datos.filter(F.col("_t") > corte).drop("_t")')
        elif val["particion"] == "estratificada" and self.clasif:
            self.l("# Estratificada: la misma fracción de cada clase (sampleBy), el resto es prueba",
                   'datos = datos.withColumn("_fila", F.monotonically_increasing_id())',
                   f"ent = datos.sampleBy(\"label\", fractions={{float(i): {lit(1 - p)} for i in range(len(CLASES))}}, seed=SEMILLA)",
                   'prueba = datos.join(ent.select("_fila"), "_fila", "left_anti").drop("_fila")',
                   'ent = ent.drop("_fila")')
        else:
            self.l(f"ent, prueba = datos.randomSplit([{lit(1 - p)}, {lit(p)}], seed=SEMILLA)")
        self.l("ent, prueba = ent.cache(), prueba.cache()",
               'resultado["filas"] = {"entrenamiento": ent.count(), "prueba": prueba.count()}',
               'print("Filas:", resultado["filas"])')

    def preproceso(self):
        pre, v = self.pre, self.vars
        self.celda("4. Preprocesamiento", "## 4. Preprocesamiento\nLas etapas del Pipeline de Spark ML: aprenden solo con "
                                           "el entrenamiento (salvo los bordes de los extremos, que se calculan acá).")
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
                           "bordes = {c: ent.approxQuantile(c, [0.01, 0.99], 0.001) for c in NUMERICAS}")
                else:
                    k = lit(float(pre["factor_iqr"]))
                    self.l(f"# Extremos: bordes en Q1 − {pre['factor_iqr']}·IQR y Q3 + {pre['factor_iqr']}·IQR del ENTRENAMIENTO",
                           "bordes = {}",
                           "for c in NUMERICAS:",
                           "    q1, q3 = ent.approxQuantile(c, [0.25, 0.75], 0.001)",
                           f"    bordes[c] = [q1 - {k} * (q3 - q1), q3 + {k} * (q3 - q1)]")
                self.l('recortes = ", ".join(f"least(greatest(`{c}`, {lo}), {hi}) AS `{c}_rec`" for c, (lo, hi) in bordes.items())',
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
        if v["categorica"]:
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
        else:
            args.append("featuresCol=columna")
            if self.sup:
                args.append('labelCol="label"')
        for p in self.m["params"]:
            n = p["nombre"]
            if n not in params:
                continue
            if p["tipo"] == "layers":
                args.append(f"{n}=[n_entradas, {params[n].replace(',', ', ')}, n_salidas]")
            else:
                args.append(f"{n}={lit(params[n])}")
        if self.m.get("semilla"):
            args.append("seed=SEMILLA")
        return f"{clase}(\n    " + ",\n    ".join(args) + ",\n)"

    def modelo(self):
        self.celda("5. Modelo", f"## 5. Modelo: {self.m['etiqueta']}\n{self.m['que']}")
        if any(p["tipo"] == "layers" for p in self.m["params"]):
            self.l("# La red necesita el tamaño de la entrada (columnas que salen del preprocesamiento) y de la salida (clases)",
                   "muestra = Pipeline(stages=etapas).fit(ent.limit(2000)).transform(ent.limit(1)).first()",
                   "n_entradas, n_salidas = muestra[columna].size, len(CLASES)")
        self.l(f"modelo = {self.constructor()}", "pipeline = Pipeline(stages=etapas + [modelo])")

    def evaluadores(self) -> list[str]:
        nombres = [k for k in EVAL if cat.METRICAS[k]["tarea"] == self.r["tarea"]]
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
                ratio = round(1 - (val["validacion"] or 0.2), 3)
                self.l(f"ajustador = TrainValidationSplit(estimator=pipeline, estimatorParamMaps=grilla, evaluator=evaluador(PRINCIPAL),",
                       f"                                 trainRatio={lit(ratio)}, parallelism=PARALELO, seed=SEMILLA)")
            else:
                self.imp("pyspark.ml.tuning", "CrossValidator")
                self.l(f"ajustador = CrossValidator(estimator=pipeline, estimatorParamMaps=grilla, evaluator=evaluador(PRINCIPAL),",
                       f"                           numFolds={val['k']}, parallelism=PARALELO, seed=SEMILLA)")
            self.l('paso(20, f"Validando {len(grilla)} combinaciones en YARN")',
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
        self.celda("8. Probar", "## 8. Probar con datos que no vio")
        self.l('paso(80, "Probando")',
               "t0 = time.perf_counter()",
               "pred = modelo_final.transform(prueba).cache()",
               'resultado["prueba"] = medir(pred)',
               'resultado["tiempo_predecir"] = time.perf_counter() - t0',
               'resultado["entrenamiento"] = medir(modelo_final.transform(ent))',
               'for nombre, v in resultado["prueba"].items():',
               '    print(f"  {nombre:>22}: {v:.4f}   (entrenamiento {resultado[\'entrenamiento\'][nombre]:.4f})")')
        if self.clasif:
            self.l('print("Matriz de confusión (filas = real, columnas = predicho):")',
                   'pred.groupBy("label").pivot("prediction").count().orderBy("label").show()')

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
               (", clases=CLASES" if self.clasif else "") + ")",
               "spark.stop()",
               'paso(100, "Listo")')
