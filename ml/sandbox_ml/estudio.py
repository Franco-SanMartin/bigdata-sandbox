"""Registro de experimentos: lo que llama el script generado al final.

Cada corrida queda en una carpeta del volumen (/hadoop/ml/experimentos/<id>):

    experimento.json   receta, huella, datos (con hash), métricas con desvío,
                       búsqueda, tiempos, memoria pico, tamaño del modelo
    informe.json       lo que dibuja la pantalla: ROC, PR, calibración,
                       residuos, matriz de confusión, proyección 2D, curvas...
    codigo.py          el script que la produjo
    modelo.joblib      el Pipeline entrenado (scikit-learn; Spark lo guarda en HDFS)

Desde un notebook (versión ml):

    from sandbox_ml import estudio
    estudio.tabla()                      # todos los experimentos, como DataFrame
    modelo = estudio.cargar("exp-...")   # el Pipeline, listo para .predict()
"""
from __future__ import annotations

import hashlib
import json
import os
import platform
import re
import secrets
import shutil
import sys
from datetime import datetime
from pathlib import Path

from . import catalogo as cat
from .receta import huella, variables

RAIZ = Path(os.environ.get("SANDBOX_ML_EXPERIMENTOS", "/hadoop/ml/experimentos"))
MAX_PUNTOS = 2000      # puntos de los gráficos de dispersión
MAX_CURVA = 200        # puntos de las curvas ROC y PR
_CARPETA: Path | None = None


def nuevo_id() -> str:
    return datetime.now().strftime("exp-%Y%m%d-%H%M%S-") + secrets.token_hex(2)


def raiz() -> Path:
    """Donde van los experimentos: el volumen si se puede escribir, si no ./experimentos."""
    try:
        RAIZ.mkdir(parents=True, exist_ok=True)
        if os.access(RAIZ, os.W_OK):
            return RAIZ
    except OSError:
        pass
    return Path("experimentos")


def carpeta() -> Path:
    """La carpeta de esta corrida: la que dio el estudio (SANDBOX_ML_EXP) o una nueva."""
    global _CARPETA
    if _CARPETA is None:
        env = os.environ.get("SANDBOX_ML_EXP")
        _CARPETA = Path(env) if env else raiz() / nuevo_id()
        _CARPETA.mkdir(parents=True, exist_ok=True)
    return _CARPETA


# ---------------------------------------------------------------- utilidades

def _py(v):
    """numpy y pandas → tipos de JSON."""
    try:
        import numpy as np
        if isinstance(v, np.generic):
            v = v.item()
        elif isinstance(v, np.ndarray):
            return [_py(x) for x in v.tolist()]
    except ImportError:
        pass
    if isinstance(v, float) and (v != v or v in (float("inf"), float("-inf"))):
        return None
    if isinstance(v, (list, tuple)):
        return [_py(x) for x in v]
    if isinstance(v, dict):
        return {str(k): _py(x) for k, x in v.items()}
    if isinstance(v, (str, int, float, bool)) or v is None:
        return v
    return str(v)


def _escribir(path: Path, obj) -> None:
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(_py(obj), ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)


def memoria_pico_mb() -> float | None:
    """El máximo de memoria residente de este proceso y de sus hijos (joblib), en MB."""
    try:
        import resource
    except ImportError:
        return None
    propio = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    hijos = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    div = 1024 * 1024 if sys.platform == "darwin" else 1024
    return round(max(propio, hijos) / div, 1)


def hash_datos(df) -> str:
    import pandas as pd
    h = hashlib.sha256(pd.util.hash_pandas_object(df, index=False).values.tobytes())
    h.update(",".join(map(str, df.columns)).encode())
    return h.hexdigest()[:16]


def _muestra_idx(n: int, k: int = MAX_PUNTOS, semilla: int = 0):
    import numpy as np
    if n <= k:
        return np.arange(n)
    return np.sort(np.random.default_rng(semilla).choice(n, k, replace=False))


def _reducir(xs, ys, extra=None, k: int = MAX_CURVA):
    """Una curva con a lo sumo k puntos (los extremos quedan)."""
    import numpy as np
    n = len(xs)
    if n <= k:
        idx = np.arange(n)
    else:
        idx = np.unique(np.linspace(0, n - 1, k).round().astype(int))
    out = {"x": _py(np.asarray(xs)[idx]), "y": _py(np.asarray(ys)[idx])}
    if extra is not None:
        out["umbral"] = _py(np.asarray(extra)[np.minimum(idx, len(extra) - 1)])
    return out


def _entorno(motor: str) -> dict:
    e = {"python": platform.python_version(), "maquina": platform.machine(), "cpus": os.cpu_count()}
    for mod in ("sklearn", "numpy", "pandas", "xgboost", "pyspark"):
        m = sys.modules.get(mod)
        if m is not None and getattr(m, "__version__", None):
            e[mod] = m.__version__
    return e


def _params_reales(receta: dict, est) -> dict:
    """Los hiperparámetros que tiene de verdad el modelo entrenado (si editaron el código, cambian)."""
    m = cat.MODELOS.get(receta.get("modelo", {}).get("id", ""))
    if m is None or not hasattr(est, "get_params"):
        return dict(receta.get("modelo", {}).get("params", {}))
    reales = est.get_params(deep=False)
    out = {}
    for p in m["params"]:
        if p["nombre"] in reales:
            v = reales[p["nombre"]]
            if p["tipo"] == "layers" and isinstance(v, (tuple, list)):
                v = ",".join(str(x) for x in v)
            elif p["tipo"] == "layers" and isinstance(v, int):
                v = str(v)
            out[p["nombre"]] = _py(v)
    return out


def _nombres_salida(pipeline) -> list[str] | None:
    """Nombres de las columnas que le llegan al modelo (sin el prefijo de cada rama)."""
    try:
        nombres = pipeline[:-1].get_feature_names_out()
    except Exception:  # noqa: BLE001 (algún paso no sabe nombrar sus columnas)
        return None
    return [str(n).split("__", 1)[-1] for n in nombres]


def _importancia(pipeline) -> dict | None:
    import numpy as np
    est = pipeline[-1]
    if hasattr(est, "feature_importances_"):
        v, tipo = np.asarray(est.feature_importances_, dtype=float), "impureza"
    elif hasattr(est, "coef_"):
        c = np.asarray(est.coef_, dtype=float)
        v, tipo = (np.abs(c).mean(axis=0) if c.ndim > 1 else np.abs(c)), "coeficientes"
    else:
        return None
    nombres = _nombres_salida(pipeline) or [f"x{i}" for i in range(len(v))]
    if len(nombres) != len(v):
        nombres = [f"x{i}" for i in range(len(v))]
    orden = np.argsort(-v)[:30]
    out = {"tipo": tipo, "columnas": [nombres[i] for i in orden], "valores": _py(v[orden])}
    if tipo == "coeficientes" and np.asarray(est.coef_).ndim == 1:
        out["signo"] = _py(np.sign(np.asarray(est.coef_)[orden]))
    return out


# ---------------------------------------------------------------- informes por tarea

def informe_regresion(y, pred, semilla: int = 0) -> dict:
    import numpy as np
    y, pred = np.asarray(y, dtype=float), np.asarray(pred, dtype=float)
    res = y - pred
    idx = _muestra_idx(len(y), semilla=semilla)
    cuentas, bordes = np.histogram(res, bins=30)
    return {"real": _py(y[idx]), "predicho": _py(pred[idx]), "residuo": _py(res[idx]),
            "histograma_residuos": {"bordes": _py(bordes), "cuentas": _py(cuentas)}}


def informe_clasificacion(y, pred, clases, puntajes=None, proba=True, semilla: int = 0) -> dict:
    """Matriz de confusión, reporte por clase y, si hay puntajes, ROC, PR, umbrales y calibración."""
    import numpy as np
    from sklearn.metrics import (auc, average_precision_score, classification_report, confusion_matrix,
                                 precision_recall_curve, roc_curve)
    y, pred = np.asarray(y), np.asarray(pred)
    etiquetas = list(clases)
    nombres = [str(c) for c in etiquetas]
    out = {"clases": nombres,
           "confusion": _py(confusion_matrix(y, pred, labels=etiquetas))}
    rep = classification_report(y, pred, labels=etiquetas, target_names=nombres, output_dict=True, zero_division=0)
    out["reporte"] = [{"clase": n, "precision": rep[n]["precision"], "recall": rep[n]["recall"], "f1": rep[n]["f1-score"],
                       "soporte": rep[n]["support"]} for n in nombres]
    out["reporte_promedios"] = {k: {"precision": rep[k]["precision"], "recall": rep[k]["recall"], "f1": rep[k]["f1-score"]}
                                for k in ("macro avg", "weighted avg") if k in rep}
    if puntajes is None:
        return out
    p = np.asarray(puntajes, dtype=float)
    if len(etiquetas) == 2:
        s = p[:, 1] if p.ndim == 2 else p
        pos = (y == etiquetas[1]).astype(int)
        fpr, tpr, thr = roc_curve(pos, s)
        out["roc"] = [{"clase": nombres[1], "auc": float(auc(fpr, tpr)), **_reducir(fpr, tpr, thr)}]
        prec, rec, thr2 = precision_recall_curve(pos, s)
        out["pr"] = [{"clase": nombres[1], "ap": float(average_precision_score(pos, s)), **_reducir(rec, prec, thr2)}]
        out["positiva"] = nombres[1]
        if proba:
            # Para mover el umbral en la pantalla: la matriz de confusión en 51 umbrales
            umbrales = np.linspace(0, 1, 51)
            out["umbrales"] = [{"umbral": float(u), "vp": int(((s >= u) & (pos == 1)).sum()),
                                "fp": int(((s >= u) & (pos == 0)).sum()), "fn": int(((s < u) & (pos == 1)).sum()),
                                "vn": int(((s < u) & (pos == 0)).sum())} for u in umbrales]
            from sklearn.calibration import calibration_curve
            frac, media = calibration_curve(pos, np.clip(s, 0, 1), n_bins=10, strategy="uniform")
            cuentas, _ = np.histogram(np.clip(s, 0, 1), bins=10, range=(0, 1))
            out["calibracion"] = {"predicha": _py(media), "real": _py(frac), "histograma": _py(cuentas)}
    elif p.ndim == 2 and p.shape[1] == len(etiquetas) and len(etiquetas) <= 12:
        out["roc"], out["pr"] = [], []
        for i, nombre in enumerate(nombres):
            pos = (y == etiquetas[i]).astype(int)
            if pos.sum() == 0 or pos.sum() == len(pos):
                continue
            fpr, tpr, thr = roc_curve(pos, p[:, i])
            out["roc"].append({"clase": nombre, "auc": float(auc(fpr, tpr)), **_reducir(fpr, tpr, thr)})
            prec, rec, thr2 = precision_recall_curve(pos, p[:, i])
            out["pr"].append({"clase": nombre, "ap": float(average_precision_score(pos, p[:, i])), **_reducir(rec, prec, thr2)})
    return out


def _puntajes(pipeline, X):
    """(puntajes, son_probabilidades): predict_proba si hay; si no, decision_function (sirve para ROC y PR)."""
    try:
        return pipeline.predict_proba(X), True
    except (AttributeError, NotImplementedError):
        pass
    try:
        return pipeline.decision_function(X), False
    except (AttributeError, NotImplementedError):
        return None, False


def informe_grupos(Xt, grupos, referencia=None, centros=None, semilla: int = 0) -> dict:
    import numpy as np
    from sklearn.decomposition import PCA
    grupos = np.asarray(grupos)
    vals, cuentas = np.unique(grupos, return_counts=True)
    out = {"tamanos": [{"grupo": int(v), "filas": int(c)} for v, c in zip(vals, cuentas)]}
    Xt = np.asarray(Xt, dtype=float)
    idx = _muestra_idx(len(Xt), semilla=semilla)
    if Xt.shape[1] >= 2:
        pca = PCA(n_components=2, random_state=semilla).fit(Xt)
        xy = pca.transform(Xt[idx])
        out["proyeccion"] = {"x": _py(xy[:, 0]), "y": _py(xy[:, 1]), "grupo": _py(grupos[idx]),
                             "varianza": _py(pca.explained_variance_ratio_)}
        if centros is not None and np.asarray(centros).shape[1] == Xt.shape[1]:
            c = pca.transform(np.asarray(centros, dtype=float))
            out["proyeccion"]["centros"] = {"x": _py(c[:, 0]), "y": _py(c[:, 1])}
    else:
        out["proyeccion"] = {"x": _py(Xt[idx, 0]), "y": [0.0] * len(idx), "grupo": _py(grupos[idx]), "varianza": [1.0, 0.0]}
    if referencia is not None:
        out["proyeccion"]["referencia"] = _py(np.asarray(referencia).astype(str)[idx])
        import pandas as pd
        tabla = pd.crosstab(pd.Series(grupos, name="grupo"), pd.Series(np.asarray(referencia).astype(str), name="ref"))
        out["contra_referencia"] = {"grupos": _py(tabla.index), "referencia": _py(tabla.columns), "cuentas": _py(tabla.values)}
    validos = grupos != -1
    if len(set(grupos[validos])) >= 2:
        from sklearn.metrics import silhouette_samples
        i2 = idx[validos[idx]]
        s = silhouette_samples(Xt[i2], grupos[i2])
        out["silhouette_por_grupo"] = [{"grupo": int(g), "media": float(s[grupos[i2] == g].mean()),
                                        "valores": _py(np.sort(s[grupos[i2] == g])[::-1][::max(1, len(s) // 400)])}
                                       for g in np.unique(grupos[i2])]
    return out


# ---------------------------------------------------------------- registrar (scikit-learn)

def registrar(receta: dict, pipeline, resultado: dict, *, datos=None, X_ent=None, y_ent=None, X_prueba=None,
              y_prueba=None, X_val=None, y_val=None, cv=None, busqueda=None, codificador=None, X=None) -> Path:
    """Guarda la corrida en su carpeta: experimento.json, informe.json y el código. Devuelve la carpeta."""
    import numpy as np
    dest = carpeta()
    tarea = receta["tarea"]
    semilla = receta.get("validacion", {}).get("semilla", 0)
    modelo = cat.MODELOS[receta["modelo"]["id"]]
    est = pipeline[-1]
    informe: dict = {"tarea": tarea}

    metricas: dict = {}
    for nombre, v in (resultado.get("prueba") or {}).items():
        metricas[nombre] = {"prueba": v}
        for parte in ("entrenamiento", "validacion"):
            if nombre in (resultado.get(parte) or {}):
                metricas[nombre][parte] = resultado[parte][nombre]
        if cv is not None and f"test_{nombre}" in cv:
            t = np.asarray(cv[f"test_{nombre}"], dtype=float)
            metricas[nombre].update(cv=float(t.mean()), cv_desvio=float(t.std()), cv_particiones=_py(t))
            if f"train_{nombre}" in cv:
                metricas[nombre]["cv_entrenamiento"] = float(np.asarray(cv[f"train_{nombre}"], dtype=float).mean())
    if cv is not None and "fit_time" in cv:
        informe["cv_tiempos"] = {"entrenar": _py(cv["fit_time"]), "medir": _py(cv["score_time"])}

    if tarea in ("regresion", "clasificacion") and X_prueba is not None:
        pred = pipeline.predict(X_prueba)
        if tarea == "regresion":
            informe.update(informe_regresion(y_prueba, pred, semilla))
        else:
            clases = list(codificador.classes_) if codificador is not None else sorted(np.unique(np.asarray(y_ent)).tolist(), key=str)
            etiquetas = list(range(len(clases))) if codificador is not None else clases
            puntajes, es_proba = _puntajes(pipeline, X_prueba)
            informe.update(informe_clasificacion(np.asarray(y_prueba), pred, etiquetas, puntajes, es_proba, semilla))
            if codificador is not None:
                informe["clases"] = [str(c) for c in clases]
                for k in ("roc", "pr"):
                    for curva in informe.get(k, []):
                        curva["clase"] = str(clases[int(curva["clase"])])
                if "positiva" in informe:
                    informe["positiva"] = str(clases[1])
                for fila in informe["reporte"]:
                    fila["clase"] = str(clases[int(fila["clase"])])
        filas = X_prueba.head(20)
        p20 = pipeline.predict(filas)
        if codificador is not None:
            p20 = codificador.inverse_transform(np.asarray(p20).astype(int))
            real = codificador.inverse_transform(np.asarray(y_prueba.head(20)).astype(int))
        else:
            real = y_prueba.head(20).to_numpy()
        informe["ejemplos"] = {"columnas": [str(c) for c in filas.columns] + ["real", "predicho"],
                               "filas": [_py(list(f)) + [_py(r), _py(p)] for f, r, p in
                                         zip(filas.itertuples(index=False), real, p20)]}
        imp = _importancia(pipeline)
        if imp:
            informe["importancia"] = imp
    elif tarea == "clustering":
        grupos = resultado.get("grupos")
        Xt = pipeline[:-1].transform(X)
        ref = datos[receta["referencia"]] if receta.get("referencia") and datos is not None else None
        informe.update(informe_grupos(Xt, grupos, ref, getattr(est, "cluster_centers_", None), semilla))
    elif tarea == "reduccion":
        comp = np.asarray(resultado.get("componentes"))
        idx = _muestra_idx(len(comp), semilla=semilla)
        nombres = None
        try:
            nombres = [str(n).split("__", 1)[-1] for n in pipeline[:-1].get_feature_names_out()]
        except Exception:  # noqa: BLE001
            pass
        informe["varianza"] = _py(est.explained_variance_ratio_)
        informe["proyeccion"] = {"x": _py(comp[idx, 0]), "y": _py(comp[idx, 1]) if comp.shape[1] > 1 else [0.0] * len(idx)}
        cargas = np.asarray(est.components_)[:min(4, len(est.components_))]
        informe["cargas"] = {"columnas": nombres or [f"x{i}" for i in range(cargas.shape[1])], "valores": _py(cargas)}

    for k in ("curva_aprendizaje", "curva_validacion", "permutacion"):
        if resultado.get(k) is not None:
            informe[k] = resultado[k]
    if hasattr(est, "loss_curve_"):
        informe["perdida"] = {"perdida": _py(est.loss_curve_),
                              "validacion": _py(getattr(est, "validation_scores_", None) or []),
                              "iteraciones": int(est.n_iter_)}
    elif hasattr(est, "train_score_") and len(getattr(est, "train_score_", [])) > 1:
        informe["perdida"] = {"perdida": _py(est.train_score_),
                              "validacion": _py(getattr(est, "validation_score_", None) if hasattr(est, "validation_score_") else []),
                              "iteraciones": int(getattr(est, "n_iter_", len(est.train_score_))), "es_puntaje": True}

    busq = None
    if busqueda is not None and hasattr(busqueda, "cv_results_"):
        r = busqueda.cv_results_
        signo = -1 if str(busqueda.scoring).startswith("neg_") else 1
        orden = np.argsort(r["rank_test_score"])[:50]
        busq = {"tipo": receta["busqueda"]["tipo"], "candidatos": len(r["params"]),
                "mejores_params": {k.removeprefix("modelo__"): _py(v) for k, v in busqueda.best_params_.items()},
                "mejor_puntaje": float(signo * busqueda.best_score_),
                "resultados": [{"params": {k.removeprefix("modelo__"): _py(v) for k, v in r["params"][i].items()},
                                "media": _py(signo * r["mean_test_score"][i]), "desvio": _py(r["std_test_score"][i]),
                                "rango": int(r["rank_test_score"][i]), "tiempo": _py(r["mean_fit_time"][i])}
                               for i in orden]}
        if hasattr(busqueda, "n_iterations_"):
            busq["rondas"] = int(busqueda.n_iterations_)
            busq["recursos"] = _py(busqueda.n_resources_)
            busq["candidatos_por_ronda"] = _py(busqueda.n_candidates_)
        if "iter" in r:
            busq["resultados_ronda"] = _py(np.asarray(r["iter"])[orden])

    modelo_path = dest / "modelo.joblib"
    datos_info = dict(receta["datos"])
    if datos is not None:
        datos_info.update(filas=int(len(datos)), columnas=int(datos.shape[1]), hash=hash_datos(datos))
    exp = _base(receta, dest, "sklearn")
    exp.update({
        "modelo": {"id": modelo["id"], "etiqueta": modelo["etiqueta"], "clase": modelo["clase"],
                   "params": _params_reales(receta, est)},
        "datos": datos_info,
        "filas": resultado.get("filas"),
        "metricas": metricas,
        "busqueda": busq,
        "tiempos": {k.removeprefix("tiempo_"): round(float(v), 4) for k, v in resultado.items() if k.startswith("tiempo_")},
        "memoria_pico_mb": memoria_pico_mb(),
        "modelo_bytes": modelo_path.stat().st_size if modelo_path.exists() else None,
        "artefactos": sorted(p.name for p in dest.iterdir() if p.is_file() and not p.name.endswith(".tmp")),
        "n_jobs": receta.get("busqueda", {}).get("n_jobs", 1),
    })
    if tarea == "clasificacion":
        exp["clases"] = informe.get("clases")
    _cerrar(dest, exp, informe)
    return dest


def _base(receta: dict, dest: Path, motor: str) -> dict:
    previo = {}
    try:
        previo = json.loads((dest / "experimento.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    codigo = dest / "codigo.py"
    script = Path(sys.argv[0]) if sys.argv and sys.argv[0].endswith(".py") else None
    if not codigo.exists() and script and script.is_file():
        shutil.copyfile(script, codigo)
    return {
        "id": dest.name, "nombre": receta.get("nombre") or previo.get("nombre"),
        "creado": previo.get("creado") or datetime.now().isoformat(timespec="seconds"),
        "terminado": datetime.now().isoformat(timespec="seconds"), "estado": "listo",
        "origen": previo.get("origen") or os.environ.get("SANDBOX_ML_ORIGEN", "script"),
        "receta": receta, "huella": huella(receta), "motor": motor, "tarea": receta["tarea"],
        "objetivo": receta.get("objetivo"), "variables": variables(receta),
        "metrica": receta["validacion"]["metrica"],
        "editado": previo.get("editado", False),
        "entorno": _entorno(motor),
    }


def _cerrar(dest: Path, exp: dict, informe: dict) -> None:
    _escribir(dest / "informe.json", informe)
    if "informe.json" not in exp["artefactos"]:
        exp["artefactos"] = sorted(exp["artefactos"] + ["informe.json"])
    _escribir(dest / "experimento.json", exp)
    m = exp["metricas"].get(exp["metrica"], {})
    v = m.get("cv", m.get("prueba"))
    print(f"Experimento {exp['id']} registrado en {dest}" + (f" ({exp['metrica']} = {v:.4f})" if v is not None else ""),
          flush=True)


# ---------------------------------------------------------------- registrar (Spark MLlib)

def _vector_a_lista(df, col):
    from pyspark.ml.functions import vector_to_array
    return df.withColumn(col, vector_to_array(col))


def _nombres_vector(df, col: str) -> list[str] | None:
    """Nombres de cada posición de un vector de Spark ML (los deja VectorAssembler en los metadatos)."""
    try:
        attrs = df.schema[col].metadata["ml_attr"]["attrs"]
    except (KeyError, TypeError):
        return None
    pares = [(a["idx"], a["name"]) for grupo in attrs.values() for a in grupo]
    return [n for _, n in sorted(pares)]


def _nombres_legibles(modelo_final, nombres: list[str] | None) -> list[str] | None:
    """num_esc_3 → la columna de verdad: el escalador no guarda los nombres, pero el VectorAssembler que arma num_vec sí
    sabe cuáles entraron (sin los sufijos _imp y _rec que agregan el Imputer y el recorte de extremos)."""
    if not nombres:
        return nombres
    entradas = None
    for etapa in getattr(modelo_final, "stages", []):
        try:
            if etapa.getOutputCol() == "num_vec":
                entradas = list(etapa.getInputCols())
        except Exception:  # noqa: BLE001 (etapas sin outputCol)
            continue
    if not entradas:
        return nombres
    out = []
    for n in nombres:
        m = re.fullmatch(r"num_(?:esc|vec)_(\d+)", n)
        if m and int(m.group(1)) < len(entradas):
            n = re.sub(r"(_imp|_rec)+$", "", entradas[int(m.group(1))])
        out.append(n)
    return out


def _importancia_spark(est, nombres_cols) -> dict | None:
    """featureImportances (árboles), |coeficientes| (lineales) o la ganancia de XGBoost, con el nombre de cada columna."""
    import numpy as np
    if hasattr(est, "featureImportances"):
        v, tipo = est.featureImportances.toArray(), "impureza"
    elif hasattr(est, "coefficients"):
        v, tipo = np.abs(est.coefficients.toArray()), "coeficientes"
    elif hasattr(est, "coefficientMatrix"):
        v, tipo = np.abs(est.coefficientMatrix.toArray()).mean(axis=0), "coeficientes"
    elif hasattr(est, "get_feature_importances"):   # xgboost.spark
        g = est.get_feature_importances(importance_type="gain")
        n = len(nombres_cols) if nombres_cols else 1 + max((int(k[1:]) for k in g if k[1:].isdigit()), default=-1)
        v, tipo = np.array([float(g.get(f"f{i}", 0.0)) for i in range(n)]), "ganancia"
    else:
        return None
    if not len(v):
        return None
    nombres_cols = nombres_cols if nombres_cols and len(nombres_cols) == len(v) else [f"x{i}" for i in range(len(v))]
    orden = np.argsort(-v)[:30]
    return {"tipo": tipo, "columnas": [nombres_cols[i] for i in orden], "valores": _py(v[orden])}


def registrar_spark(receta: dict, modelo_final, resultado: dict, *, pred=None, clases=None,
                    recursos: dict | None = None) -> Path:
    import numpy as np
    dest = carpeta()
    tarea = receta["tarea"]
    semilla = receta.get("validacion", {}).get("semilla", 0)
    modelo = cat.MODELOS[receta["modelo"]["id"]]
    est = modelo_final.stages[-1]
    informe: dict = {"tarea": tarea}
    metricas = {}
    for nombre, v in (resultado.get("prueba") or {}).items():
        metricas[nombre] = {"prueba": v}
        for parte in ("entrenamiento", "validacion"):
            if nombre in (resultado.get(parte) or {}):
                metricas[nombre][parte] = resultado[parte][nombre]
    busq = None
    if resultado.get("busqueda_spark"):
        filas = resultado["busqueda_spark"]
        principal = receta["validacion"]["metrica"]
        if len(filas) == 1 and receta["busqueda"]["tipo"] == "ninguna":
            metricas.setdefault(principal, {}).update(cv=filas[0]["media"], cv_desvio=filas[0]["desvio"])
        else:
            busq = {"tipo": receta["busqueda"]["tipo"], "candidatos": len(filas), "mejores_params": filas[0]["params"],
                    "mejor_puntaje": filas[0]["media"],
                    "resultados": [{**f, "rango": i + 1} for i, f in enumerate(filas[:50])]}
            if receta["busqueda"]["tipo"] == "cv":
                metricas.setdefault(principal, {}).update(cv=filas[0]["media"], cv_desvio=filas[0]["desvio"])
    col = "features"
    for etapa in modelo_final.stages:
        out = etapa.getOutputCol() if hasattr(etapa, "getOutputCol") else None
        if out in ("sel", "pca"):
            col = out
    supervisada = tarea in ("regresion", "clasificacion", "recomendacion")
    if supervisada and resultado.get("informe"):
        # Lo contó el script en los executors (curvas por cubetas, residuos y error por rango): no hace falta muestrear
        informe.update(resultado["informe"])
        auc = (resultado.get("prueba") or {}).get("roc_auc")
        if auc is not None and len(informe.get("roc") or []) == 1:
            informe["roc"][0]["auc_cubetas"], informe["roc"][0]["auc"] = informe["roc"][0]["auc"], auc
        if pred is not None and tarea != "recomendacion":
            imp = _importancia_spark(est, _nombres_legibles(modelo_final, _nombres_vector(pred, col)))
            if imp:
                informe["importancia"] = imp
    elif pred is not None and tarea in ("regresion", "clasificacion"):
        cols = ["label", "prediction"] + (["probability"] if "probability" in pred.columns else []) + \
               (["rawPrediction"] if "rawPrediction" in pred.columns else [])
        muestra = pred.select(*cols)
        for c in cols[2:]:
            muestra = _vector_a_lista(muestra, c)
        pdf = muestra.limit(20000).toPandas()
        if tarea == "regresion":
            informe.update(informe_regresion(pdf["label"], pdf["prediction"], semilla))
        else:
            etiquetas = list(range(len(clases)))
            punt, es_proba = None, False
            if "probability" in pdf:
                punt, es_proba = np.vstack(pdf["probability"].to_numpy()), True
            elif "rawPrediction" in pdf:
                punt = np.vstack(pdf["rawPrediction"].to_numpy())
            inf = informe_clasificacion(pdf["label"].astype(int).to_numpy(), pdf["prediction"].astype(int).to_numpy(),
                                        etiquetas, punt, es_proba, semilla)
            nombres = [str(c) for c in clases]
            inf["clases"] = nombres
            for k in ("roc", "pr"):
                for curva in inf.get(k, []):
                    curva["clase"] = nombres[int(curva["clase"])]
            for fila in inf["reporte"]:
                fila["clase"] = nombres[int(fila["clase"])]
            if "positiva" in inf:
                inf["positiva"] = nombres[1]
            informe.update(inf)
        imp = _importancia_spark(est, _nombres_legibles(modelo_final, _nombres_vector(pred, col)))
        if imp:
            informe["importancia"] = imp
    elif pred is not None and tarea == "clustering":
        from pyspark.ml.functions import vector_to_array
        pdf = pred.select(vector_to_array(col).alias("x"), "prediction").limit(MAX_PUNTOS * 5).toPandas()
        Xt = np.vstack(pdf["x"].to_numpy())
        centros = np.asarray(est.clusterCenters()) if hasattr(est, "clusterCenters") else None
        informe.update(informe_grupos(Xt, pdf["prediction"].to_numpy(), None, centros, semilla))
        tam = {r["prediction"]: r["count"] for r in pred.groupBy("prediction").count().collect()}
        informe["tamanos"] = [{"grupo": int(g), "filas": int(n)} for g, n in sorted(tam.items())]
    elif pred is not None and tarea == "reduccion":
        from pyspark.ml.functions import vector_to_array
        pdf = pred.select(vector_to_array("componentes").alias("c")).limit(MAX_PUNTOS).toPandas()
        comp = np.vstack(pdf["c"].to_numpy())
        informe["varianza"] = _py(est.explainedVariance.toArray())
        informe["proyeccion"] = {"x": _py(comp[:, 0]), "y": _py(comp[:, 1]) if comp.shape[1] > 1 else [0.0] * len(comp)}
    if resultado.get("curva_validacion"):
        informe["curva_validacion"] = resultado["curva_validacion"]
    if resultado.get("recomendaciones"):
        informe["recomendaciones"] = resultado["recomendaciones"]
    if resultado.get("umbral"):
        informe["umbral_elegido"] = resultado["umbral"]
    if hasattr(est, "summary") and hasattr(est.summary, "objectiveHistory"):
        try:
            informe["perdida"] = {"perdida": _py(est.summary.objectiveHistory), "validacion": [],
                                  "iteraciones": len(est.summary.objectiveHistory)}
        except Exception:  # noqa: BLE001 (no todos los modelos tienen resumen de entrenamiento)
            pass
    params = {}
    for p in modelo["params"]:
        try:
            v = est.getOrDefault(p["nombre"])
        except Exception:  # noqa: BLE001
            continue
        if p["tipo"] == "layers" and isinstance(v, list):
            v = ",".join(str(x) for x in v[1:-1])
        params[p["nombre"]] = _py(v)
    # Lo que el modelo entrenado no guarda (ALSModel no tiene regParam, por ejemplo) sale de la receta
    for k, v in (receta.get("modelo", {}).get("params") or {}).items():
        params.setdefault(k, v)
    import subprocess
    tam = None
    if resultado.get("modelo_hdfs"):
        try:
            out = subprocess.run(["hdfs", "dfs", "-du", "-s", resultado["modelo_hdfs"]], capture_output=True, text=True,
                                 timeout=60).stdout.split()
            tam = int(out[0]) if out else None
        except (OSError, ValueError, subprocess.SubprocessError):
            tam = None
    exp = _base(receta, dest, "spark")
    exp.update({
        "modelo": {"id": modelo["id"], "etiqueta": modelo["etiqueta"], "clase": modelo["clase"], "params": params},
        "datos": dict(receta["datos"]),
        "filas": resultado.get("filas"), "metricas": metricas, "busqueda": busq,
        "tiempos": {k.removeprefix("tiempo_"): round(float(v), 4) for k, v in resultado.items() if k.startswith("tiempo_")},
        "memoria_pico_mb": memoria_pico_mb(), "modelo_bytes": tam, "modelo_hdfs": resultado.get("modelo_hdfs"),
        "yarn": {"app_id": resultado.get("app_id")},
        "artefactos": sorted(p.name for p in dest.iterdir() if p.is_file() and not p.name.endswith(".tmp")),
        "n_jobs": receta.get("busqueda", {}).get("n_jobs", 1),
        "recursos": recursos or receta.get("recursos"),
        "umbral": resultado.get("umbral"),
        "evaluacion": "entrenamiento, validación y prueba separados; la prueba se usó una sola vez, al final"
                      if supervisada and (resultado.get("filas") or {}).get("validacion") is not None else None,
    })
    if tarea == "clasificacion":
        exp["clases"] = [str(c) for c in clases]
    _cerrar(dest, exp, informe)
    return dest


# ---------------------------------------------------------------- para notebooks

def experimentos(carpeta_raiz: Path | None = None) -> list[dict]:
    """Los experimentos guardados (lo de experimento.json), del más nuevo al más viejo."""
    base = carpeta_raiz or raiz()
    out = []
    for d in sorted(base.glob("exp-*"), reverse=True):
        try:
            out.append(json.loads((d / "experimento.json").read_text(encoding="utf-8")))
        except (OSError, ValueError):
            continue
    return out


def tabla(tarea: str | None = None):
    """Tabla de posiciones como DataFrame: modelo, métrica principal (CV y prueba), tiempo y memoria."""
    import pandas as pd
    filas = []
    for e in experimentos():
        if tarea and e.get("tarea") != tarea:
            continue
        m = (e.get("metricas") or {}).get(e.get("metrica"), {})
        filas.append({"id": e["id"], "modelo": e["modelo"]["etiqueta"], "motor": e["motor"], "tarea": e["tarea"],
                      "metrica": e.get("metrica"), "cv": m.get("cv"), "cv_desvio": m.get("cv_desvio"),
                      "prueba": m.get("prueba"), "segundos": (e.get("tiempos") or {}).get("total"),
                      "memoria_mb": e.get("memoria_pico_mb"), "estado": e.get("estado")})
    return pd.DataFrame(filas)


def cargar(exp_id: str):
    """El Pipeline de scikit-learn de un experimento (joblib)."""
    import joblib
    return joblib.load(raiz() / exp_id / "modelo.joblib")
