"""Receta → script de Python completo y autónomo que la reproduce exacta.

El estudio de ML no tiene un "motor" escondido: lo que corre cuando apretás
Entrenar es este script, el mismo que se muestra, se edita y se baja (.py o
.ipynb). Está partido en celdas "# %%" (el formato de VS Code y Jupytext):
cada una es una celda del notebook.

    from sandbox_ml import codigo, receta
    r = receta.validar({...})
    print(codigo.generar(r))

scikit-learn: pandas + Pipeline/ColumnTransformer, una sola máquina.
Spark MLlib: PySpark + pyspark.ml.Pipeline, en YARN (spark-submit).
"""
from __future__ import annotations

import inspect
import json
import textwrap
from datetime import datetime

from . import catalogo as cat
from . import transformadores
from .receta import huella, variables

ESCALADORES = {"estandar": "StandardScaler()", "minmax": "MinMaxScaler()", "robusto": "RobustScaler()"}
IMPUTAR_NUM = {"mediana": 'SimpleImputer(strategy="median"{ind})', "media": 'SimpleImputer(strategy="mean"{ind})',
               "cero": 'SimpleImputer(strategy="constant", fill_value=0{ind})'}
ESTRATEGIA = {"mediana": "median", "media": "mean"}


def lit(v) -> str:
    """Un valor como literal de Python (strings con comillas dobles, sin escapar acentos)."""
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, float):
        if v == int(v) and abs(v) < 1e15:
            return f"{v:.1f}"
        return repr(v)
    if isinstance(v, (list, tuple)):
        return "[" + ", ".join(lit(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ", ".join(f"{lit(k)}: {lit(x)}" for k, x in v.items()) + "}"
    return repr(v)


def valor_codigo(p: dict, v) -> str:
    """Cómo se escribe un hiperparámetro en el constructor (las capas de la red van como tupla)."""
    if p["tipo"] == "layers" and isinstance(v, str):
        capas = [int(x) for x in v.split(",") if x.strip()]
        return "(" + ", ".join(str(c) for c in capas) + ("," if len(capas) == 1 else "") + ")"
    return lit(v)


def _clase(path: str) -> tuple[str, str]:
    mod, _, nombre = path.rpartition(".")
    return mod, nombre


def titulo(r: dict) -> str:
    m = cat.MODELOS[r["modelo"]["id"]]
    fuente = r["datos"].get("ruta") or r["datos"].get("tabla") or ""
    return f"{m['etiqueta']} ({cat.TAREAS[r['tarea']]['etiqueta'].lower()}) con {fuente.rsplit('/', 1)[-1]}"


def nombre_archivo(r: dict, experimento: str | None = None) -> str:
    return f"{experimento or 'experimento'}.py"


def generar(r: dict, experimento: str | None = None, fecha: str | None = None) -> str:
    """El script de la receta (ya normalizada con receta.validar)."""
    fecha = fecha or datetime.now().strftime("%Y-%m-%d %H:%M")
    if r["motor"] == "spark":
        from .codigo_spark import generar_spark
        return generar_spark(r, experimento, fecha)
    return _Sklearn(r, experimento, fecha).script()


# ---------------------------------------------------------------- scikit-learn

class _Sklearn:
    def __init__(self, r: dict, experimento: str | None, fecha: str):
        self.r = r
        self.exp = experimento
        self.fecha = fecha
        self.m = cat.MODELOS[r["modelo"]["id"]]
        self.vars = variables(r)
        self.sup = r["tarea"] in ("regresion", "clasificacion")
        self.clasif = r["tarea"] == "clasificacion"
        self.pre = r["preproceso"]
        self.val = r["validacion"]
        self.bus = r["busqueda"]
        self.imports: dict[str, set[str]] = {}
        self.out: list[str] = []
        self.xgb = self.m.get("extra") == "xgboost"

    # ---------------------------------------------------- utilidades

    def imp(self, modulo: str, *nombres: str) -> None:
        self.imports.setdefault(modulo, set()).update(nombres)

    def celda(self, titulo: str, markdown: str | None = None) -> None:
        if markdown:
            self.out.append("")
            self.out.append("# %% [markdown]")
            for linea in markdown.strip().splitlines():
                self.out.append(f"# {linea}".rstrip())
        self.out.append("")
        self.out.append(f"# %% {titulo}")

    def l(self, *lineas: str) -> None:
        for linea in lineas:
            self.out.extend(linea.split("\n"))

    # ---------------------------------------------------- partes

    def script(self) -> str:
        r = self.r
        cuerpo_partes = [self.datos, self.variables_, self.preproceso, self.modelo]
        if self.sup:
            cuerpo_partes += [self.particion, self.metricas, self.busqueda, self.validacion_cruzada, self.entrenar,
                              self.curvas, self.guardar, self.registrar]
        elif r["tarea"] == "clustering":
            cuerpo_partes += [self.agrupar, self.guardar, self.registrar]
        else:
            cuerpo_partes += [self.reducir, self.guardar, self.registrar]
        for f in cuerpo_partes:
            f()
        cuerpo = self.out
        self.out = []
        self.cabecera()
        return "\n".join(self.out + cuerpo).rstrip() + "\n"

    def cabecera(self) -> None:
        r = self.r
        h = huella(r)
        lineas = [
            f"# {titulo(r)}",
            "",
            f"Generado por el estudio de ML de BigData Sandbox el {self.fecha}"
            + (f" para el experimento **{self.exp}**" if self.exp else "") + f" (receta `{h}`).",
            "Reproduce la corrida exacta: mismos datos, misma semilla, mismos hiperparámetros.",
            "",
            "- Corre solo, con pandas y scikit-learn: `python3 " + nombre_archivo(r, self.exp) + "`",
            "- Si está `sandbox_ml` (las versiones ml y full), además registra la corrida en "
            "/hadoop/ml/experimentos y la pantalla de ML la muestra.",
        ]
        self.out.append("# %% [markdown]")
        for linea in lineas:
            self.out.append(f"# {linea}".rstrip())
        self.out.append("")
        self.out.append("# %% Librerías, semilla y avance")
        std = ["json", "time"]
        if r["datos"]["origen"] == "hdfs":
            std += ["subprocess", "tempfile"]
        self.out += [f"import {m}" for m in sorted(std)]
        self.out.append("from pathlib import Path")
        self.out.append("")
        self.out += ["import joblib", "import numpy as np", "import pandas as pd"]
        for mod in sorted(self.imports):
            nombres = sorted(self.imports[mod])
            linea = f"from {mod} import {', '.join(nombres)}"
            if len(linea) > 110:
                linea = f"from {mod} import (\n    " + ",\n    ".join(nombres) + ",\n)"
            self.out.append(linea)
        if self.usa_transformadores():
            self.out.append("")
            self.out.append("try:")
            self.out.append("    from sandbox_ml.transformadores import " + ", ".join(sorted(self.usa_transformadores())))
            self.out.append("except ImportError:  # fuera del sandbox: la misma clase, copiada de sandbox_ml/transformadores.py")
            self.out.append("    from sklearn.base import BaseEstimator, TransformerMixin")
            self.out.append("    from sklearn.utils.validation import check_is_fitted")
            for nombre in sorted(self.usa_transformadores()):
                fuente = inspect.getsource(getattr(transformadores, nombre))
                self.out.append(textwrap.indent(fuente.rstrip(), "    "))
        self.out += [
            "",
            "try:",
            "    from sandbox_ml import estudio  # registra la corrida para la pantalla de ML",
            "except ImportError:                # fuera del sandbox el script anda igual, sin registrar",
            "    estudio = None",
            "",
            f"SEMILLA = {self.val['semilla']}",
            f"N_JOBS = {self.bus['n_jobs']}   # procesos en paralelo (cada uno ocupa su memoria)",
            'SALIDA = estudio.carpeta() if estudio else Path("salida-ml")',
            "SALIDA.mkdir(parents=True, exist_ok=True)",
            "INICIO = time.perf_counter()",
            "resultado = {}   # todo lo que sale de la corrida (lo guarda estudio.registrar al final)",
            "",
            "",
            "def paso(avance, mensaje):",
            '    """Avance de la corrida: la pantalla de ML lee estas líneas"""',
            '    print(f"[{avance:3d}%] {mensaje}", flush=True)',
        ]
        receta_txt = json.dumps(r, ensure_ascii=False, indent=1, sort_keys=False)
        self.out += ["", "", "# La receta que armó el estudio (queda guardada con el experimento)",
                     f"RECETA = json.loads(r'''{receta_txt}''')"]

    def usa_transformadores(self) -> set[str]:
        out = set()
        if self.pre["outliers"] in ("recortar_iqr", "recortar_pct") and self.vars["numerica"]:
            out.add("RecortarExtremos")
        if self.vars["fecha"] and self.pre["fecha"]:
            out.add("PartesDeFecha")
        return out

    def datos(self) -> None:
        d = self.r["datos"]
        self.celda("1. Datos", "## 1. Datos")
        self.l('paso(5, "Leyendo los datos")')
        sep = d.get("separador", ",")
        sep_arg = "" if sep == "," else f", sep={lit(sep)}"
        if d["origen"] == "local":
            if d["formato"] == "parquet":
                self.l(f"datos = pd.read_parquet({lit(d['ruta'])})")
            else:
                self.l(f"datos = pd.read_csv({lit(d['ruta'])}{sep_arg})")
        elif d["origen"] == "hdfs":
            self.l(
                "",
                "",
                "def leer_hdfs(ruta):",
                '    """Baja el archivo (o la carpeta de partes) de HDFS con el cliente hdfs: anda con uno o varios NameNodes."""',
                '    carpeta = Path(tempfile.mkdtemp(prefix="hdfs-"))',
                '    subprocess.run(["hdfs", "dfs", "-get", ruta, str(carpeta)], check=True)',
                '    local = carpeta / ruta.rstrip("/").rsplit("/", 1)[-1]',
            )
            if d["formato"] == "parquet":
                self.l("    return pd.read_parquet(local)")
            else:
                self.l('    partes = sorted(p for p in local.glob("part-*") if p.stat().st_size) if local.is_dir() else [local]',
                       f"    return pd.concat([pd.read_csv(p{sep_arg}) for p in partes], ignore_index=True)")
            self.l("", "", f"datos = leer_hdfs({lit(d['ruta'])})")
        else:
            self.imp("pyspark.sql", "SparkSession")
            lim = f".limit({d['limite']})" if d.get("limite") else ""
            self.l(
                "# Hive: Spark en modo local lee la tabla (el metastore dice dónde están los archivos en HDFS)",
                'spark = SparkSession.builder.master("local[2]").appName("estudio-ml: leer Hive").enableHiveSupport().getOrCreate()',
                f"datos = spark.table({lit(d['tabla'])}){lim}.toPandas()",
                "spark.stop()",
            )
        if d.get("limite"):
            self.l(f"LIMITE = {d['limite']}",
                   "if len(datos) > LIMITE:   # una muestra fija (con la semilla), en el orden original",
                   "    datos = datos.sample(n=LIMITE, random_state=SEMILLA).sort_index().reset_index(drop=True)")
        self.l('print(f"{len(datos):,} filas y {datos.shape[1]} columnas")')

    def variables_(self) -> None:
        r, v = self.r, self.vars
        self.celda("2. Objetivo y variables", "## 2. Objetivo y variables\nCada columna con su rol; las de rol id o "
                                               "ignorar no entran al modelo.")
        if self.sup:
            self.l(f"OBJETIVO = {lit(r['objetivo'])}")
        for nombre, rol in (("NUMERICAS", "numerica"), ("CATEGORICAS", "categorica"), ("FECHAS", "fecha"),
                            ("TEXTOS", "texto")):
            self.l(f"{nombre} = {lit(v[rol])}")
        fuera = [c for c, rol in r["columnas"].items() if rol in ("id", "ignorar") and c not in (r["objetivo"], r["referencia"])]
        if fuera:
            self.l(f"# Quedan afuera (id o ignorar): {', '.join(fuera)}")
        self.l("VARIABLES = NUMERICAS + CATEGORICAS + FECHAS + TEXTOS")
        if self.sup:
            self.l("",
                   "antes = len(datos)",
                   "datos = datos.dropna(subset=[OBJETIVO]).reset_index(drop=True)",
                   "if len(datos) < antes:",
                   '    print(f"Se descartan {antes - len(datos):,} filas sin {OBJETIVO}")')
        if v["categorica"]:
            self.l("# Las categóricas como texto (también una columna de números marcada como categórica)",
                   "datos[CATEGORICAS] = datos[CATEGORICAS].astype(str).where(datos[CATEGORICAS].notna())")
        if v["texto"]:
            self.l("datos[TEXTOS] = datos[TEXTOS].fillna(\"\")")
        if v["numerica"]:
            self.l("datos[NUMERICAS] = datos[NUMERICAS].apply(pd.to_numeric, errors=\"coerce\")")
        self.l("X = datos[VARIABLES]")
        if self.sup:
            self.l("y = datos[OBJETIVO]")
            if self.clasif:
                if self.xgb:
                    self.imp("sklearn.preprocessing", "LabelEncoder")
                    self.l("# XGBoost quiere las clases como 0, 1, 2...: se codifican y se guardan sus nombres",
                           "codificador = LabelEncoder()",
                           "y = pd.Series(codificador.fit_transform(y.astype(str)), index=y.index, name=OBJETIVO)",
                           "CLASES = list(codificador.classes_)")
                else:
                    self.l("CLASES = sorted(y.unique().tolist(), key=str)")
                self.l("BINARIA = len(CLASES) == 2",
                       'print("Clases:", (datos[OBJETIVO].value_counts(normalize=True) * 100).round(1).to_dict(), "(%)")')
            else:
                self.l('print(f"{OBJETIVO}: media {y.mean():,.2f}, desvío {y.std():,.2f}")')
        self.l('print(f"{len(VARIABLES)} variables: {len(NUMERICAS)} numéricas, {len(CATEGORICAS)} categóricas, '
               '{len(FECHAS)} fechas, {len(TEXTOS)} de texto")')

    def preproceso(self) -> None:
        pre, v = self.pre, self.vars
        self.imp("sklearn.compose", "ColumnTransformer")
        self.imp("sklearn.pipeline", "Pipeline")
        self.celda("3. Preprocesamiento", "## 3. Preprocesamiento\nUn ColumnTransformer: cada tipo de columna con sus "
                                           "pasos. Va adentro del Pipeline, así que aprende solo con las filas de "
                                           "entrenamiento (sin fuga hacia la prueba).")
        ramas = []
        ind = ", add_indicator=True" if pre["indicador_nulos"] else ""
        if v["numerica"]:
            pasos = []
            if pre["imputar_num"] != "ninguna":
                self.imp("sklearn.impute", "SimpleImputer")
                pasos.append(f'("imputar", {IMPUTAR_NUM[pre["imputar_num"]].format(ind=ind)})')
            if pre["outliers"] in ("recortar_iqr", "recortar_pct"):
                met = "iqr" if pre["outliers"] == "recortar_iqr" else "pct"
                arg = f'metodo="{met}"' + (f", factor={lit(float(pre['factor_iqr']))}" if met == "iqr" else "")
                pasos.append(f'("recortar", RecortarExtremos({arg}))')
            if pre["escalar"] != "ninguno":
                self.imp("sklearn.preprocessing", ESCALADORES[pre["escalar"]].rstrip("()"))
                pasos.append(f'("escalar", {ESCALADORES[pre["escalar"]]})')
            self.l(self._pipe("numericas", pasos))
            ramas.append('("num", numericas, NUMERICAS)')
        if v["categorica"]:
            self.imp("sklearn.impute", "SimpleImputer")
            imp = ('SimpleImputer(strategy="most_frequent")' if pre["imputar_cat"] == "mas_frecuente"
                   else 'SimpleImputer(strategy="constant", fill_value="(vacío)")')
            if pre["codificar"] == "onehot":
                self.imp("sklearn.preprocessing", "OneHotEncoder")
                cod = (f'OneHotEncoder(handle_unknown="infrequent_if_exist", max_categories={pre["max_categorias"]}, '
                       "sparse_output=False)")
            else:
                self.imp("sklearn.preprocessing", "OrdinalEncoder")
                cod = 'OrdinalEncoder(handle_unknown="use_encoded_value", unknown_value=-1)'
            self.l(self._pipe("categoricas", [f'("imputar", {imp})', f'("codificar", {cod})']))
            ramas.append('("cat", categoricas, CATEGORICAS)')
        if v["fecha"] and pre["fecha"]:
            self.imp("sklearn.impute", "SimpleImputer")
            pasos = ['("partes", PartesDeFecha())', '("imputar", SimpleImputer(strategy="median"))']
            if pre["escalar"] != "ninguno":
                self.imp("sklearn.preprocessing", ESCALADORES[pre["escalar"]].rstrip("()"))
                pasos.append(f'("escalar", {ESCALADORES[pre["escalar"]]})')
            self.l("# Cada fecha → año, mes, día, día de la semana y hora", self._pipe("fechas", pasos))
            ramas.append('("fecha", fechas, FECHAS)')
        for i, c in enumerate(v["texto"]):
            self.imp("sklearn.feature_extraction.text", "TfidfVectorizer")
            ramas.append(f'("texto{i}", TfidfVectorizer(max_features={pre["texto_max"]}), {lit(c)})')
        self.l("preproceso = ColumnTransformer(",
               "    [" + (",\n     ".join(ramas)) + "],",
               '    remainder="drop",',
               "    sparse_threshold=0.0,   # siempre una matriz densa (algunos modelos no aceptan dispersas)",
               ")")

    @staticmethod
    def _pipe(nombre: str, pasos: list[str]) -> str:
        if not pasos:
            return f'{nombre} = "passthrough"'
        return f"{nombre} = Pipeline([\n    " + ",\n    ".join(pasos) + ",\n])"

    def constructor(self, params: dict, n_jobs: str | None) -> str:
        mod, clase = _clase(self.m["clase"])
        self.imp(mod, clase)
        args = []
        for p in self.m["params"]:
            if p["nombre"] in params:
                args.append(f"{p['nombre']}={valor_codigo(p, params[p['nombre']])}")
        if self.m.get("semilla"):
            args.append(f"{self.m['semilla']}=SEMILLA")
        if n_jobs and self.m.get("paralelo"):
            args.append(f"n_jobs={n_jobs}")
        if self.xgb and self.clasif:
            args.append('eval_metric="logloss"')
        if not args:
            return f"{clase}()"
        return f"{clase}(\n    " + ",\n    ".join(args) + ",\n)"

    def modelo(self) -> None:
        r, pre = self.r, self.pre
        self.celda("4. Modelo", f"## 4. Modelo: {self.m['etiqueta']}\n{self.m['que']}")
        hay_busqueda = self.bus["tipo"] != "ninguna"
        self.l(f"modelo = {self.constructor(r['modelo']['params'], '1' if hay_busqueda else 'N_JOBS')}")
        pasos = ['("preproceso", preproceso)']
        if pre["seleccion"] == "varianza":
            self.imp("sklearn.feature_selection", "VarianceThreshold")
            pasos.append(f'("seleccion", VarianceThreshold(threshold={lit(float(pre["umbral_varianza"]))}))')
        elif pre["seleccion"] == "kbest" and self.sup:
            f = "f_classif" if self.clasif else "f_regression"
            self.imp("sklearn.feature_selection", "SelectKBest", f)
            pasos.append(f'("seleccion", SelectKBest({f}, k={pre["k"]}))')
        elif pre["seleccion"] == "modelo" and self.sup:
            bosque = "RandomForestClassifier" if self.clasif else "RandomForestRegressor"
            self.imp("sklearn.feature_selection", "SelectFromModel")
            self.imp("sklearn.ensemble", bosque)
            pasos.append(f'("seleccion", SelectFromModel({bosque}(n_estimators=100, random_state=SEMILLA, n_jobs=N_JOBS), '
                         'threshold="median"))')
        if pre["pca"] is not None:
            self.imp("sklearn.decomposition", "PCA")
            pasos.append(f'("pca", PCA(n_components={pre["pca"]}, random_state=SEMILLA))')
        pasos.append('("modelo", modelo)')
        self.l("pipeline = Pipeline([\n    " + ",\n    ".join(pasos) + ",\n])", "print(pipeline)")

    def particion(self) -> None:
        val = self.val
        self.imp("sklearn.model_selection", "train_test_split")
        self.celda("5. Partición", "## 5. Partición en entrenamiento" + (", validación" if val["validacion"] else "")
                   + " y prueba\nLa prueba no se toca hasta el final: es la estimación honesta de cómo anda con datos nuevos.")
        self.l(f"PRUEBA = {lit(float(val['prueba']))}")
        if val["validacion"]:
            self.l(f"VALIDACION = {lit(float(val['validacion']))}   # aparte, para comparar modelos sin mirar la prueba")
        estrat = val["particion"] == "estratificada"
        if val["particion"] == "temporal":
            ct = val["columna_tiempo"]
            es_fecha = self.r["columnas"].get(ct) in ("fecha", None) or ct not in self.vars["numerica"]
            clave = (f"pd.to_datetime(datos[{lit(ct)}], errors=\"coerce\")" if es_fecha else f"datos[{lit(ct)}]")
            self.l(f"COLUMNA_TIEMPO = {lit(ct)}",
                   "# Lo más viejo entrena, lo más nuevo prueba (sin mezclar: así se usa un modelo que predice el futuro)",
                   f"orden = np.argsort({clave.replace(lit(ct), 'COLUMNA_TIEMPO')}.to_numpy(), kind=\"stable\")",
                   "X, y = X.iloc[orden], y.iloc[orden]",
                   "corte = int(len(X) * (1 - PRUEBA))",
                   "X_ent, X_prueba, y_ent, y_prueba = X.iloc[:corte], X.iloc[corte:], y.iloc[:corte], y.iloc[corte:]")
            if val["validacion"]:
                self.l("corte = int(len(X_ent) * (1 - VALIDACION / (1 - PRUEBA)))",
                       "X_ent, X_val, y_ent, y_val = X_ent.iloc[:corte], X_ent.iloc[corte:], y_ent.iloc[:corte], y_ent.iloc[corte:]")
        else:
            s = ", stratify=y" if estrat else ""
            self.l(f"X_ent, X_prueba, y_ent, y_prueba = train_test_split(X, y, test_size=PRUEBA{s}, random_state=SEMILLA)")
            if val["validacion"]:
                s = ", stratify=y_ent" if estrat else ""
                self.l("X_ent, X_val, y_ent, y_val = train_test_split(",
                       f"    X_ent, y_ent, test_size=VALIDACION / (1 - PRUEBA){s}, random_state=SEMILLA)")
        if self.pre["outliers"] == "eliminar_iqr" and self.vars["numerica"]:
            k = lit(float(self.pre["factor_iqr"]))
            self.l("# Valores extremos: se sacan del ENTRENAMIENTO las filas con alguna numérica fuera de Q1 − k·IQR / Q3 + k·IQR",
                   "q1, q3 = X_ent[NUMERICAS].quantile(0.25), X_ent[NUMERICAS].quantile(0.75)",
                   f"fuera = ((X_ent[NUMERICAS] < q1 - {k} * (q3 - q1)) | (X_ent[NUMERICAS] > q3 + {k} * (q3 - q1))).any(axis=1)",
                   "X_ent, y_ent = X_ent[~fuera], y_ent[~fuera]",
                   'print(f"Se sacan {int(fuera.sum()):,} filas con valores extremos del entrenamiento")')
        lineas = '"entrenamiento": len(X_ent), "prueba": len(X_prueba)' + (', "validacion": len(X_val)' if val["validacion"] else "")
        self.l(f"resultado[\"filas\"] = {{{lineas}}}", 'print("Filas:", resultado["filas"])')
        cv = val["cv"]
        if cv != "ninguna":
            k = val["k"]
            if cv == "kfold":
                self.imp("sklearn.model_selection", "KFold")
                self.l(f"particiones = KFold(n_splits={k}, shuffle=True, random_state=SEMILLA)")
            elif cv == "estratificada":
                self.imp("sklearn.model_selection", "StratifiedKFold")
                self.l(f"particiones = StratifiedKFold(n_splits={k}, shuffle=True, random_state=SEMILLA)")
            elif cv == "repetida":
                clase = "RepeatedStratifiedKFold" if self.clasif else "RepeatedKFold"
                self.imp("sklearn.model_selection", clase)
                self.l(f"particiones = {clase}(n_splits={k}, n_repeats={val['repeticiones']}, random_state=SEMILLA)")
            else:
                self.imp("sklearn.model_selection", "TimeSeriesSplit")
                self.l(f"particiones = TimeSeriesSplit(n_splits={k})   # cada parte valida con datos posteriores")

    def metricas(self) -> None:
        self.imp("sklearn.metrics", "get_scorer")
        self.celda("Métricas")
        nombres = [k for k, m in cat.METRICAS.items() if m["tarea"] == self.r["tarea"] and m.get("sklearn")]
        if self.clasif and not self.m.get("proba"):
            nombres = [k for k in nombres if k != "log_loss"]   # sin predict_proba no hay log loss
        if self.clasif:
            fijas = {k: cat.METRICAS[k]["sklearn"] for k in nombres if k not in ("roc_auc", "pr_auc")}
            self.l(f"METRICAS = {lit(fijas)}",
                   "if BINARIA:",
                   '    METRICAS.update(roc_auc="roc_auc", pr_auc="average_precision")',
                   "else:",
                   '    METRICAS["roc_auc"] = "roc_auc_ovr"')
            if "log_loss" not in nombres:
                self.l("# (sin log loss: este modelo no da probabilidades)")
        else:
            self.l(f"METRICAS = {lit({k: cat.METRICAS[k]['sklearn'] for k in nombres})}")
        self.l(f"PRINCIPAL = {lit(self.val['metrica'])}   # la que decide qué modelo es mejor",
               "METRICA = METRICAS[PRINCIPAL]",
               "",
               "",
               "def medir(modelo, X, y):",
               '    """Cada métrica sobre (X, y), con los errores en positivo (scikit-learn los da negativos)"""',
               "    out = {}",
               "    for nombre, scorer in METRICAS.items():",
               "        v = get_scorer(scorer)(modelo, X, y)",
               '        out[nombre] = float(-v if scorer.startswith("neg_") else v)',
               "    return out")

    def espacio(self) -> list[str]:
        """El espacio de búsqueda como dict de Python (con distribuciones de scipy para los rangos)."""
        lineas = []
        for k, vals in self.bus["espacio"].items():
            p = cat.param(self.m, k)
            if isinstance(vals, dict):
                self.imp("scipy.stats", "loguniform" if vals["log"] else ("randint" if p["tipo"] == "int" else "uniform"))
                if vals["log"]:
                    d = f"loguniform({lit(vals['min'])}, {lit(vals['max'])})"
                elif p["tipo"] == "int":
                    d = f"randint({vals['min']}, {vals['max'] + 1})"
                else:
                    d = f"uniform({lit(vals['min'])}, {lit(vals['max'] - vals['min'])})   # de {vals['min']} a {vals['max']}"
                lineas.append(f'"modelo__{k}": {d},')
            else:
                lineas.append(f'"modelo__{k}": [' + ", ".join(valor_codigo(p, v) for v in vals) + "],")
        return lineas

    def busqueda(self) -> None:
        b = self.bus
        if b["tipo"] == "ninguna":
            self.l("", "busqueda = None   # sin búsqueda de hiperparámetros: entrena con los de la receta")
            return
        titulo = cat.BUSQUEDAS["sklearn"][b["tipo"]]["etiqueta"]
        self.celda("6. Búsqueda de hiperparámetros", f"## 6. Búsqueda de hiperparámetros: {titulo}\n"
                                                      f"{cat.BUSQUEDAS['sklearn'][b['tipo']]['ayuda']} Cada combinación se "
                                                      "valida con las mismas particiones; la mejor se reentrena con todo el "
                                                      f"entrenamiento. Presupuesto: {b['ajustes']} entrenamientos, "
                                                      f"{b['max_minutos']} min como máximo.")
        self.l("espacio = {", *("    " + x for x in self.espacio()), "}")
        comun = "scoring=METRICA, cv=particiones, n_jobs=N_JOBS, refit=True, verbose=3"
        if b["tipo"] == "grid":
            self.imp("sklearn.model_selection", "GridSearchCV")
            self.l(f"busqueda = GridSearchCV(pipeline, espacio, {comun})")
        elif b["tipo"] == "random":
            self.imp("sklearn.model_selection", "RandomizedSearchCV")
            self.l(f"busqueda = RandomizedSearchCV(pipeline, espacio, n_iter={b['iteraciones']}, {comun}, random_state=SEMILLA)")
        else:
            self.imp("sklearn.experimental", "enable_halving_search_cv")
            clase = "HalvingGridSearchCV" if b["tipo"] == "halving" else "HalvingRandomSearchCV"
            self.imp("sklearn.model_selection", clase)
            extra = f", n_candidates={b['iteraciones']}" if b["tipo"] == "halving_random" else ""
            self.l("# (enable_halving_search_cv habilita las búsquedas por halving, que todavía son experimentales)",
                   f"busqueda = {clase}(pipeline, espacio, factor={b['factor']}{extra}, {comun.replace(', refit=True', '')}, "
                   "random_state=SEMILLA)")
        self.l('paso(15, "Buscando hiperparámetros")',
               "t0 = time.perf_counter()",
               "busqueda.fit(X_ent, y_ent)",
               'resultado["tiempo_busqueda"] = time.perf_counter() - t0',
               "pipeline = busqueda.best_estimator_   # la mejor combinación, ya reentrenada con todo X_ent",
               'mejor = {k.removeprefix("modelo__"): v for k, v in busqueda.best_params_.items()}',
               "puntaje = -busqueda.best_score_ if METRICA.startswith(\"neg_\") else busqueda.best_score_",
               'print(f"Mejor: {mejor} → {PRINCIPAL} = {puntaje:.4f} ({resultado[\'tiempo_busqueda\']:.1f} s)")')

    def validacion_cruzada(self) -> None:
        if self.val["cv"] == "ninguna":
            self.l("cv = None   # sin validación cruzada")
            return
        self.imp("sklearn.model_selection", "cross_validate")
        nombre = cat.CV[self.val["cv"]]["etiqueta"]
        if self.val["cv"] == "repetida" and self.clasif:
            nombre = "RepeatedStratifiedKFold"
        self.celda("7. Validación cruzada", f"## 7. Validación cruzada ({nombre})\nCada métrica con su promedio y su "
                                            "desvío entre particiones: el desvío dice cuánto se puede confiar en el número.")
        self.l('paso(45, "Validación cruzada")',
               "t0 = time.perf_counter()",
               "cv = cross_validate(pipeline, X_ent, y_ent, cv=particiones, scoring=METRICAS, n_jobs=N_JOBS, return_train_score=True)",
               'resultado["tiempo_cv"] = time.perf_counter() - t0',
               "for nombre, scorer in METRICAS.items():",
               "    signo = -1 if scorer.startswith(\"neg_\") else 1",
               '    cv[f"test_{nombre}"], cv[f"train_{nombre}"] = signo * cv[f"test_{nombre}"], signo * cv[f"train_{nombre}"]',
               '    print(f"  {nombre:>22}: {cv[f\'test_{nombre}\'].mean():.4f} ± {cv[f\'test_{nombre}\'].std():.4f}")')

    def entrenar(self) -> None:
        self.celda("8. Entrenar y probar", "## 8. Entrenar con todo el entrenamiento y probar\nRecién acá se mira la "
                                           "partición de prueba.")
        if self.bus["tipo"] != "ninguna":
            self.l("# La búsqueda ya lo reentrenó con todo X_ent (refit)",
                   'resultado["tiempo_entrenar"] = busqueda.refit_time_')
        else:
            self.l('paso(70, "Entrenando")',
                   "t0 = time.perf_counter()",
                   "pipeline.fit(X_ent, y_ent)",
                   'resultado["tiempo_entrenar"] = time.perf_counter() - t0')
        self.l('paso(80, "Probando con datos que no vio")',
               "t0 = time.perf_counter()",
               "pred = pipeline.predict(X_prueba)",
               'resultado["tiempo_predecir"] = time.perf_counter() - t0',
               'resultado["prueba"] = medir(pipeline, X_prueba, y_prueba)',
               'resultado["entrenamiento"] = medir(pipeline, X_ent, y_ent)')
        if self.val["validacion"]:
            self.l('resultado["validacion"] = medir(pipeline, X_val, y_val)')
        self.l('print(f"Entrenó en {resultado[\'tiempo_entrenar\']:.2f} s; en la prueba:")',
               'for nombre, v in resultado["prueba"].items():',
               '    print(f"  {nombre:>22}: {v:.4f}   (entrenamiento {resultado[\'entrenamiento\'][nombre]:.4f})")')
        if self.clasif:
            self.imp("sklearn.metrics", "classification_report")
            nombres = "CLASES" if not self.xgb else "CLASES"
            self.l(f"print(classification_report(y_prueba, pred, target_names=[str(c) for c in {nombres}], zero_division=0))"
                   if self.xgb else "print(classification_report(y_prueba, pred, zero_division=0))")

    def curvas(self) -> None:
        inf = self.r["informe"]
        if not (inf["curva_aprendizaje"] or inf["curva_validacion"] or inf["permutacion"]):
            return
        particiones = "particiones" if self.val["cv"] != "ninguna" else "5"
        self.celda("9. Curvas e importancia", "## 9. Curvas e importancia\nCurva de aprendizaje: ¿mejoraría con más "
                                              "datos? Curva de validación: cómo cambia el puntaje con un hiperparámetro. "
                                              "Importancia por permutación: cuánto empeora si se mezcla cada columna.")
        self.l('paso(85, "Curvas e importancia")', "t0 = time.perf_counter()")
        if inf["curva_aprendizaje"]:
            self.imp("sklearn.model_selection", "learning_curve")
            self.l("tamanos, ent, val = learning_curve(",
                   f"    pipeline, X_ent, y_ent, cv={particiones}, scoring=METRICA, train_sizes=np.linspace(0.1, 1.0, 5), n_jobs=N_JOBS)",
                   "signo = -1 if METRICA.startswith(\"neg_\") else 1",
                   'resultado["curva_aprendizaje"] = {"filas": tamanos.tolist(), "entrenamiento": (signo * ent).tolist(),',
                   '                                  "validacion": (signo * val).tolist()}')
        if inf["curva_validacion"]:
            cv = inf["curva_validacion"]
            p = cat.param(self.m, cv["param"])
            self.imp("sklearn.model_selection", "validation_curve")
            self.l(f"VALORES = [{', '.join(valor_codigo(p, v) for v in cv['valores'])}]",
                   "ent, val = validation_curve(",
                   f"    pipeline, X_ent, y_ent, param_name=\"modelo__{cv['param']}\", param_range=VALORES, cv={particiones},",
                   "    scoring=METRICA, n_jobs=N_JOBS)",
                   "signo = -1 if METRICA.startswith(\"neg_\") else 1",
                   f'resultado["curva_validacion"] = {{"param": {lit(cv["param"])}, "valores": [str(v) for v in VALORES],',
                   '                                 "entrenamiento": (signo * ent).tolist(), "validacion": (signo * val).tolist()}')
        if inf["permutacion"]:
            self.imp("sklearn.inspection", "permutation_importance")
            self.l("perm = permutation_importance(pipeline, X_prueba, y_prueba, scoring=METRICA, n_repeats=5,",
                   "                              random_state=SEMILLA, n_jobs=N_JOBS)",
                   'resultado["permutacion"] = {"columnas": list(X_prueba.columns), "media": perm.importances_mean.tolist(),',
                   '                            "desvio": perm.importances_std.tolist()}',
                   'for c, m_ in sorted(zip(X_prueba.columns, perm.importances_mean), key=lambda x: -x[1])[:10]:',
                   '    print(f"  {c:>22}: {m_:+.4f}")')
        self.l('resultado["tiempo_curvas"] = time.perf_counter() - t0')

    def agrupar(self) -> None:
        r = self.r
        self.imp("sklearn.metrics", "silhouette_score", "davies_bouldin_score", "calinski_harabasz_score")
        self.celda("5. Agrupar", "## 5. Agrupar\nClustering no tiene respuesta correcta: se entrena con todas las filas y se "
                                 "mide qué tan compactos y separados quedan los grupos.")
        self.l('paso(40, "Agrupando")',
               "t0 = time.perf_counter()",
               "grupos = pipeline.fit_predict(X)",
               'resultado["tiempo_entrenar"] = time.perf_counter() - t0',
               "Xt = pipeline[:-1].transform(X)   # las columnas como las ve el modelo (preprocesadas)",
               "validos = grupos != -1   # DBSCAN marca el ruido con −1",
               "n_grupos = len(set(grupos[validos]))",
               'resultado["filas"] = {"entrenamiento": len(X), "prueba": 0}',
               'resultado["prueba"] = {}',
               "if 2 <= n_grupos < validos.sum():",
               "    muestra = min(5000, int(validos.sum()))",
               '    resultado["prueba"]["silhouette"] = float(silhouette_score(Xt[validos], grupos[validos], sample_size=muestra, random_state=SEMILLA))',
               '    resultado["prueba"]["davies_bouldin"] = float(davies_bouldin_score(Xt[validos], grupos[validos]))',
               '    resultado["prueba"]["calinski_harabasz"] = float(calinski_harabasz_score(Xt[validos], grupos[validos]))')
        if r["referencia"]:
            self.imp("sklearn.metrics", "adjusted_rand_score")
            self.l(f"REFERENCIA = {lit(r['referencia'])}   # no se usó para entrenar: solo para comparar",
                   'resultado["prueba"]["rand_ajustado"] = float(adjusted_rand_score(datos[REFERENCIA].astype(str), grupos))')
        self.l('print(f"{n_grupos} grupos; tamaños:", dict(zip(*np.unique(grupos, return_counts=True))))',
               'print({k: round(v, 4) for k, v in resultado["prueba"].items()})')
        cv = r["informe"]["curva_validacion"]
        if cv:
            self.imp("sklearn.base", "clone")
            p = cat.param(self.m, cv["param"])
            self.celda("6. Curva de validación", f"## 6. ¿Cuántos grupos? Silhouette (y la inercia, el codo) según {cv['param']}")
            self.l('paso(70, "Probando otros valores")',
                   f"VALORES = [{', '.join(valor_codigo(p, v) for v in cv['valores'])}]",
                   f'curva = {{"param": {lit(cv["param"])}, "valores": [str(v) for v in VALORES], "silhouette": [], "inercia": []}}',
                   "for v in VALORES:",
                   f'    otro = clone(pipeline).set_params(modelo__{cv["param"]}=v)',
                   "    g = otro.fit_predict(X)",
                   "    ok = g != -1",
                   "    s = silhouette_score(Xt[ok], g[ok], sample_size=min(5000, int(ok.sum())), random_state=SEMILLA) \\",
                   "        if 2 <= len(set(g[ok])) < ok.sum() else None",
                   '    curva["silhouette"].append(None if s is None else float(s))',
                   '    curva["inercia"].append(float(otro[-1].inertia_) if hasattr(otro[-1], "inertia_") else None)',
                   '    print(f"  {v}: silhouette {s if s is None else round(s, 4)}")',
                   'resultado["curva_validacion"] = curva')
        self.l('resultado["grupos"] = grupos')

    def reducir(self) -> None:
        self.celda("5. Reducir", "## 5. Reducir\nCuánta varianza junta cada componente.")
        self.l('paso(40, "Calculando las componentes")',
               "t0 = time.perf_counter()",
               "componentes = pipeline.fit_transform(X)",
               'resultado["tiempo_entrenar"] = time.perf_counter() - t0',
               "varianza = pipeline[-1].explained_variance_ratio_",
               'resultado["filas"] = {"entrenamiento": len(X), "prueba": 0}',
               'resultado["prueba"] = {"varianza_acumulada": float(varianza.sum())}',
               'for i, v in enumerate(varianza):',
               '    print(f"  componente {i + 1}: {v * 100:5.1f} %   (acumulada {varianza[:i + 1].sum() * 100:5.1f} %)")',
               'resultado["componentes"] = componentes')

    def guardar(self) -> None:
        self.celda("Guardar el modelo", "## Guardar el modelo\nEl Pipeline entero (preprocesamiento + modelo): para "
                                        "predecir alcanza con `joblib.load(...).predict(filas_nuevas)`.")
        self.l('paso(95, "Guardando el modelo")',
               'joblib.dump(pipeline, SALIDA / "modelo.joblib", compress=3)',
               'resultado["tiempo_total"] = time.perf_counter() - INICIO',
               'print(f"Modelo en {SALIDA / \'modelo.joblib\'} ({(SALIDA / \'modelo.joblib\').stat().st_size / 1024:,.0f} KB); '
               'todo tardó {resultado[\'tiempo_total\']:.1f} s")')

    def registrar(self) -> None:
        self.celda("Registrar en el estudio")
        if self.sup:
            extra = ("X_val=X_val, y_val=y_val, " if self.val["validacion"] else "") + \
                    ("codificador=codificador, " if self.xgb and self.clasif else "")
            args = (f"RECETA, pipeline, resultado, datos=datos, X_ent=X_ent, y_ent=y_ent, X_prueba=X_prueba, y_prueba=y_prueba, "
                    f"{extra}cv=cv, busqueda=busqueda")
        else:
            args = "RECETA, pipeline, resultado, datos=datos, X=X"
        self.l("if estudio:",
               f"    estudio.registrar({args})",
               'paso(100, "Listo")')


def a_notebook(codigo: str, titulo_nb: str | None = None) -> dict:
    """El script partido en celdas (# %%) como notebook de Jupyter (nbformat 4)."""
    celdas: list[dict] = []
    tipo, lineas = "code", []

    def cerrar():
        texto = "\n".join(lineas).strip("\n")
        if not texto:
            return
        if tipo == "markdown":
            md = "\n".join(l[2:] if l.startswith("# ") else l.lstrip("#") for l in texto.splitlines())
            celdas.append({"cell_type": "markdown", "metadata": {}, "source": _fuente(md)})
        else:
            celdas.append({"cell_type": "code", "metadata": {}, "execution_count": None, "outputs": [],
                           "source": _fuente(texto)})

    for linea in codigo.splitlines():
        if linea.startswith("# %%"):
            cerrar()
            lineas = []
            tipo = "markdown" if "[markdown]" in linea else "code"
            resto = linea[4:].replace("[markdown]", "").strip()
            if resto and tipo == "code":
                lineas.append(f"# {resto}")
            continue
        lineas.append(linea)
    cerrar()
    return {"cells": celdas, "metadata": {"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
                                          "language_info": {"name": "python"}, "title": titulo_nb or ""},
            "nbformat": 4, "nbformat_minor": 5}


def _fuente(texto: str) -> list[str]:
    ls = texto.split("\n")
    return [l + "\n" for l in ls[:-1]] + [ls[-1]]
