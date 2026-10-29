"""Predecir con un modelo guardado: filas nuevas (JSON) o un archivo entero.

    python3 -m sandbox_ml.predecir /hadoop/ml/experimentos/exp-... --filas '[{"edad": 40, ...}]'
    python3 -m sandbox_ml.predecir /hadoop/ml/experimentos/exp-... --archivo /datos/nuevos.csv [--salida /datos/x.csv]

Con --archivo deja <archivo>_predicciones.csv al lado (o en --salida) (las columnas de
entrada más la predicción y, si el modelo las da, las probabilidades de cada
clase). Imprime '@@prediccion@@ {json}' con las primeras filas.

Los datos pasan por los mismos arreglos que en el script (categóricas como
texto, números como número, texto sin nulos) y después por el Pipeline
guardado, que tiene adentro todo el preprocesamiento.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from .estudio import _py
from .receta import variables

MAX_ARCHIVO = 5_000_000


def preparar(df, receta: dict):
    import pandas as pd
    v = variables(receta)
    faltan = [c for cols in v.values() for c in cols if c not in df.columns]
    if faltan:
        raise SystemExit(f"Faltan columnas: {', '.join(faltan)}")
    df = df.copy()
    if v["categorica"]:
        df[v["categorica"]] = df[v["categorica"]].astype(str).where(df[v["categorica"]].notna())
    if v["texto"]:
        df[v["texto"]] = df[v["texto"]].fillna("")
    if v["numerica"]:
        df[v["numerica"]] = df[v["numerica"]].apply(pd.to_numeric, errors="coerce")
    return df[v["numerica"] + v["categorica"] + v["fecha"] + v["texto"]]


def predecir_sklearn(exp: dict, carpeta: Path, df):
    import joblib
    import numpy as np
    modelo = joblib.load(carpeta / "modelo.joblib")
    X = preparar(df, exp["receta"])
    tarea = exp["tarea"]
    if tarea == "reduccion":
        comp = modelo.transform(X)
        return {f"componente_{i + 1}": comp[:, i] for i in range(comp.shape[1])}
    pred = modelo.fit_predict(X) if tarea == "clustering" and not hasattr(modelo[-1], "predict") else modelo.predict(X)
    out = {}
    clases = exp.get("clases")
    codificadas = exp["modelo"]["clase"].startswith("xgboost") and tarea == "clasificacion"
    out["prediccion"] = [clases[int(p)] for p in pred] if codificadas else pred
    if tarea == "clasificacion":
        try:
            proba = modelo.predict_proba(X)
            nombres = clases if codificadas else [str(c) for c in modelo.classes_]
            for i, c in enumerate(nombres):
                out[f"prob_{c}"] = np.round(proba[:, i], 4)
        except (AttributeError, NotImplementedError):
            pass
    return out


def predecir_spark(exp: dict, df):
    import numpy as np
    from pyspark.ml import PipelineModel
    from pyspark.ml.functions import vector_to_array
    from pyspark.sql import SparkSession
    spark = SparkSession.builder.master("local[2]").appName("estudio-ml: predecir").getOrCreate()
    X = preparar(df, exp["receta"])
    modelo = PipelineModel.load(exp["modelo_hdfs"])
    pred = modelo.transform(spark.createDataFrame(X))
    cols = ["prediction"] + (["probability"] if "probability" in pred.columns else [])
    if "probability" in cols:
        pred = pred.withColumn("probability", vector_to_array("probability"))
    pdf = pred.select(*cols).toPandas()
    spark.stop()
    out = {}
    clases = exp.get("clases")
    if exp["tarea"] == "clasificacion" and clases:
        out["prediccion"] = [clases[int(p)] for p in pdf["prediction"]]
        if "probability" in pdf:
            proba = np.vstack(pdf["probability"].to_numpy())
            for i, c in enumerate(clases):
                out[f"prob_{c}"] = np.round(proba[:, i], 4)
    else:
        out["prediccion"] = pdf["prediction"].to_numpy()
    return out


def main(argv: list[str]) -> None:
    import pandas as pd
    carpeta = Path(argv[1])
    exp = json.loads((carpeta / "experimento.json").read_text(encoding="utf-8"))
    archivo = None
    if "--filas" in argv:
        filas = json.loads(argv[argv.index("--filas") + 1])
        if not isinstance(filas, list) or not filas:
            raise SystemExit("--filas es una lista de objetos {columna: valor}")
        df = pd.DataFrame(filas)
    elif "--archivo" in argv:
        from .perfil import leer
        archivo = argv[argv.index("--archivo") + 1]
        d = json.loads(archivo) if archivo.startswith("{") else {"origen": "local", "ruta": archivo}
        df = leer(d, MAX_ARCHIVO)
    else:
        raise SystemExit("Falta --filas '[...]' o --archivo /datos/...")
    res = predecir_spark(exp, df) if exp.get("motor") == "spark" else predecir_sklearn(exp, carpeta, df)
    salida = df.copy()
    for k, v in res.items():
        salida[k] = list(v)
    resumen = {"filas": len(salida), "columnas": [str(c) for c in salida.columns],
               "muestra": [_py(list(f)) for f in salida.head(50).itertuples(index=False)]}
    if archivo:
        if "--salida" in argv:
            destino = Path(argv[argv.index("--salida") + 1])
        else:
            ruta = archivo if not archivo.startswith("{") else json.loads(archivo).get("ruta", "predicciones")
            destino = Path(ruta).with_name(Path(ruta).stem + "_predicciones.csv")
        salida.to_csv(destino, index=False)
        resumen["archivo"] = str(destino)
    print("@@prediccion@@ " + json.dumps(_py(resumen), ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main(sys.argv)
