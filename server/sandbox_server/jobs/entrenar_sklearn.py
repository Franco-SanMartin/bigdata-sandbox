"""Entrena UN modelo con scikit-learn sobre clientes_senal.csv (lo corre POST /api/ml/train).

Es lo mismo que hace ejemplos/ml/modelos_sklearn.py, pero solo con el modelo
que pediste y con el porcentaje para entrenar que elegiste. Lo corre el
servidor del sandbox con el python3 de la imagen (el que tiene pandas y
scikit-learn), así que lo podés correr igual a mano:

    python3 entrenar_sklearn.py /datos/clientes_senal.csv clasificacion arbol 80 '{"max_depth": 3}' antiguedad_meses,visitas_mes

Mientras entrena imprime líneas '== <mensaje>|<progreso de 0 a 1>' y al final
una línea '@@resultado@@ {json}' con las métricas, lo aprendido, la matriz de
confusión y algunas predicciones. Todo lo que devuelve está medido acá: no hay
valores de referencia.

Si está la variable SANDBOX_VIZ, además deja en ese archivo lo de adentro del
modelo (pesos de la red con sus épocas, nodos del árbol, centros de KMeans,
coeficientes) para dibujarlo en la pantalla de ML: ver viz.py.

Los hiperparámetros tienen los nombres de scikit-learn y por defecto valen lo
mismo que en modelos_sklearn.py: max_depth (árbol, 3), C (logística, 1),
hidden_layer_sizes ("16,8") y max_iter (500) en la red neuronal, n_clusters (3)
y n_init (10) en KMeans, strategy (most_frequent) en el tonto. El último
argumento (opcional) son las columnas de entrada separadas por coma.
"""
import json
import os
import sys
import time
import tracemalloc
import warnings

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import viz  # noqa: E402  (al lado de este archivo)

ENTRADAS = ["antiguedad_meses", "visitas_mes", "ticket_promedio", "reclamos", "edad"]
REGLA_GASTO = {"antiguedad_meses": "50", "visitas_mes": "1.500", "ticket_promedio": "0,8",
               "reclamos": "−1.500", "edad": "0 (no influye)"}
SEMILLA = 42


def paso(mensaje, progreso):
    print(f"== {mensaje}|{progreso}", flush=True)


def num(x, dec=0):
    """1234.5 -> 1.234,5 (como se escriben los números acá)."""
    s = f"{abs(x):,.{dec}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return ("−" if x < 0 and float(f"{abs(x):.{dec}f}") != 0 else "") + s


def entrenar(modelo, X, y):
    """(segundos, MB pico de Python) de modelo.fit, como modelos_sklearn.py."""
    tracemalloc.start()
    t0 = time.perf_counter()
    modelo.fit(X, y)
    segundos = time.perf_counter() - t0
    pico = tracemalloc.get_traced_memory()[1] / 1024 ** 2
    tracemalloc.stop()
    return segundos, pico


def main(argv):
    archivo, tarea, modelo_id = argv[1], argv[2], argv[3]
    pct = int(argv[4]) if len(argv) > 4 else 80
    params = json.loads(argv[5]) if len(argv) > 5 and argv[5] else {}
    entradas = [c for c in argv[6].split(",") if c] if len(argv) > 6 and argv[6] else ENTRADAS

    paso("Leyendo clientes_senal.csv", 0.1)
    import numpy as np
    import pandas as pd
    from sklearn.model_selection import cross_val_score, train_test_split
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    clientes = pd.read_csv(archivo)
    X = clientes[entradas]
    paso("Separando columnas de entrada y objetivo", 0.25)
    X_ent, X_prueba, c_ent, c_prueba = train_test_split(X, clientes, train_size=pct / 100, random_state=SEMILLA)
    n_ent, n_prueba = len(X_ent), len(X_prueba)
    paso(f"train_test_split: {num(n_ent)} / {num(n_prueba)}", 0.35)

    res = {"filas": len(clientes), "trainRows": n_ent, "testRows": n_prueba, "metrics": {}, "learned": []}
    adentro = None   # qué dibujar: una función que arma el JSON de viz.py (se llama al final)
    muestra = X_prueba.head(8)
    nota = "Algunas filas de prueba (no las vio al entrenar): lo real y lo que predijo"

    if tarea == "regresion":
        from sklearn.linear_model import LinearRegression
        from sklearn.metrics import mean_absolute_error, r2_score
        if modelo_id != "lineal":
            raise SystemExit(f"{modelo_id} no sirve para regresión")
        m = LinearRegression()
        paso("Entrenando (Regresión lineal)", 0.5)
        seg, mem = entrenar(m, X_ent, c_ent["gasto_mes_siguiente"])
        paso(f"Probando con {num(n_prueba)} filas que no vio", 0.8)
        pred = m.predict(X_prueba)
        y = c_prueba["gasto_mes_siguiente"]
        cv = cross_val_score(LinearRegression(), X, clientes["gasto_mes_siguiente"], cv=5, scoring="r2")
        res["metrics"] = {"r2": round(r2_score(y, pred), 4), "error_medio": round(mean_absolute_error(y, pred)),
                          "cv": round(cv.mean(), 4)}
        res["learned"] = [{"title": "Coeficientes aprendidos contra la regla real",
                           "rows": [["(constante)", num(m.intercept_, 1), "5.000"]] +
                                   [[c, num(v, 2), REGLA_GASTO[c]] for c, v in zip(entradas, m.coef_)]}]
        p = m.predict(muestra)
        filas = []
        for i in range(len(muestra)):
            real, pred_i = int(y.loc[muestra.index[i]]), round(float(p[i]))
            filas.append([int(v) for v in muestra.iloc[i]] + [real, pred_i, pred_i - real])
        res["predictions"] = {"columns": entradas + ["real", "predicho", "diferencia"], "rows": filas,
                              "total": n_prueba, "note": nota}

        def adentro():
            idx = viz.indices_muestra(n_prueba, viz.TOPE_MUESTRA)
            Xm = X_prueba.iloc[idx]
            return viz.lineal("sklearn", entradas, m.coef_, m.intercept_, "gasto_mes_siguiente", X_ent, Xm,
                              y.iloc[idx], m.predict(Xm))

    elif tarea == "clasificacion":
        from sklearn.dummy import DummyClassifier
        from sklearn.linear_model import LogisticRegression
        from sklearn.metrics import accuracy_score, confusion_matrix
        from sklearn.tree import DecisionTreeClassifier
        if modelo_id == "tonto":
            m = DummyClassifier(strategy=str(params.get("strategy", "most_frequent")))
        elif modelo_id == "arbol":
            m = DecisionTreeClassifier(max_depth=int(params.get("max_depth", 3)), random_state=SEMILLA)
        elif modelo_id == "logistica":
            m = make_pipeline(StandardScaler(), LogisticRegression(C=float(params.get("C", 1))))
        elif modelo_id == "mlp":
            capas = tuple(int(x) for x in str(params.get("hidden_layer_sizes", "16,8")).split(",") if x.strip())
            # La misma MLPClassifier, que además guarda los pesos de cada época (viz.py)
            red = viz.clase_red_con_epocas()
            m = make_pipeline(StandardScaler(), red(hidden_layer_sizes=capas, max_iter=int(params.get("max_iter", 500)),
                                                    early_stopping=True, random_state=SEMILLA))
        else:
            raise SystemExit(f"{modelo_id} no sirve para clasificación")
        paso("Entrenando", 0.5)
        seg, mem = entrenar(m, X_ent, c_ent["vuelve"])
        paso(f"Probando con {num(n_prueba)} filas que no vio", 0.75)
        y = c_prueba["vuelve"]
        pred = m.predict(X_prueba)
        paso("Validación cruzada (5 partes)", 0.85)
        cv = cross_val_score(m, X, clientes["vuelve"], cv=5)
        res["metrics"] = {"aciertos": round(accuracy_score(y, pred), 4), "cv": round(cv.mean(), 4)}
        mat = confusion_matrix(y, pred, labels=[0, 1])
        res["confusion"] = {"labels": ["no vuelve", "vuelve"], "matrix": mat.tolist()}
        if modelo_id == "arbol":
            imp = sorted(zip(entradas, m.feature_importances_), key=lambda x: -x[1])
            res["learned"].append({"title": "Importancia de cada columna", "rows": [[c, num(v, 3)] for c, v in imp]})
            res["learned"].append({"title": "Reglas del árbol (cada hoja: condiciones → clase)",
                                   "rows": reglas_arbol(m, entradas) +
                                   [["regla real", "vuelve", "antiguedad_meses ≥ 36, o visitas_mes ≥ 4 y reclamos ≤ 1"]]})
        p = m.predict(muestra)

        def adentro():
            if modelo_id == "mlp":
                return viz.red_sklearn(m[0], m[-1], entradas, X_prueba, y)
            idx = viz.indices_muestra(n_prueba, viz.TOPE_MUESTRA)
            Xm = X_prueba.iloc[idx]
            if modelo_id == "arbol":
                return viz.arbol_sklearn(m, entradas, Xm, y.iloc[idx])
            if modelo_id == "logistica":
                esc, lr = m[0], m[-1]
                return viz.logistica("sklearn", entradas, lr.coef_[0], lr.intercept_[0], esc.mean_, esc.scale_, X_ent, Xm,
                                     y.iloc[idx], m.predict(Xm), m.predict_proba(Xm))
            return viz.tonto(entradas, m.class_prior_, m.strategy, Xm, y.iloc[idx], m.predict(Xm), m.predict_proba(Xm))

        res["predictions"] = {"columns": entradas + ["real", "predicho"],
                              "rows": [[int(v) for v in muestra.iloc[i]] + [int(y.loc[muestra.index[i]]), int(p[i])]
                                       for i in range(len(muestra))],
                              "total": n_prueba, "note": nota + " (1 = vuelve, 0 = no vuelve)"}

    elif tarea == "clustering":
        from sklearn.cluster import KMeans
        from sklearn.metrics import adjusted_rand_score, silhouette_score
        if modelo_id != "kmeans":
            raise SystemExit(f"{modelo_id} no sirve para agrupamiento")
        k, n_init = int(params.get("n_clusters", 3)), int(params.get("n_init", 10))
        datos = clientes[entradas]
        # Escalado, y el ticket en logaritmo (6.000 contra 9.000 pesa como 60.000 contra 90.000)
        escalador = StandardScaler()
        escalados = escalador.fit_transform(np.column_stack(
            [np.log(datos[c]) if c == "ticket_promedio" else datos[c] for c in entradas]))
        paso("Entrenando (KMeans, columnas escaladas)", 0.5)
        m = KMeans(n_clusters=k, n_init=n_init, random_state=SEMILLA)
        seg, mem = entrenar(m, escalados, None)
        grupos = m.labels_
        paso("Comparando con los segmentos reales", 0.75)
        sin = KMeans(n_clusters=k, n_init=n_init, random_state=SEMILLA).fit_predict(datos)
        sil = silhouette_score(escalados, grupos, sample_size=5000, random_state=SEMILLA)
        res["metrics"] = {"rand_ajustado": round(adjusted_rand_score(clientes["segmento_real"], grupos), 4),
                          "rand_sin_escalar": round(adjusted_rand_score(clientes["segmento_real"], sin), 4),
                          f"silhouette_k{k}": round(sil, 4)}
        tabla = pd.crosstab(grupos, clientes["segmento_real"])
        filas = []
        for g, fila in tabla.iterrows():
            orden = fila.sort_values(ascending=False)
            orden = orden[orden > 0]
            top = f"{num(int(orden.iloc[0]))} {plural_seg(orden.index[0])}" if len(orden) else "—"
            resto = " · ".join(f"{num(int(v))} {plural_seg(s, int(v))}" for s, v in orden.iloc[1:].items()) or "—"
            filas.append([f"grupo {g}", top, resto])
        res["learned"].append({"title": "Grupos encontrados contra los segmentos reales", "rows": filas})
        # Clustering no separa entrenamiento y prueba: usa todas las filas
        res["trainRows"], res["testRows"] = len(clientes), 0
        res["predictions"] = {"columns": entradas + ["segmento_real", "grupo"],
                              "rows": [[int(v) for v in datos.iloc[i]] + [str(clientes["segmento_real"].iloc[i]), int(grupos[i])]
                                       for i in range(min(8, len(clientes)))],
                              "total": len(clientes),
                              "note": "Primeras filas del archivo con el grupo que les tocó (KMeans no ve segmento_real)"}

        def adentro():
            idx = viz.indices_muestra(len(clientes), viz.TOPE_MUESTRA)
            return viz.kmeans("sklearn", entradas, [c == "ticket_promedio" for c in entradas], escalador.mean_,
                              escalador.scale_, escalados, m.cluster_centers_, k, datos.iloc[idx],
                              clientes["segmento_real"].iloc[idx], m.predict(escalados[idx]))
    else:
        raise SystemExit(f"No existe el problema {tarea}")

    res["seconds"] = round(seg, 3)
    res["memoryMb"] = round(mem, 1)
    if adentro and os.environ.get("SANDBOX_VIZ"):
        paso("Guardando lo que aprendió para dibujarlo", 0.95)
        try:
            with warnings.catch_warnings():
                warnings.simplefilter("ignore")
                viz.escribir(adentro())
            res["viz"] = True
        except Exception as e:  # noqa: BLE001 (sin dibujo, el entrenamiento vale igual)
            res["vizError"] = f"{type(e).__name__}: {e}"
    paso("Listo", 1)
    print("@@resultado@@ " + json.dumps(res, ensure_ascii=False), flush=True)


def plural_seg(s, n=2):
    s = str(s)
    if n == 1:
        return s
    return s + ("es" if s.endswith(("r", "l")) else "s")


def reglas_arbol(m, entradas):
    """Cada hoja del árbol como [condiciones, clase, ''] (hojas que dicen lo mismo quedan separadas)."""
    t = m.tree_
    out = []

    def walk(i, conds):
        if t.children_left[i] == -1:
            clase = "vuelve" if t.value[i][0].argmax() == 1 else "no vuelve"
            out.append([" y ".join(conds) or "siempre", clase, ""])
            return
        col = entradas[t.feature[i]]
        u = num(t.threshold[i], 1)
        walk(t.children_left[i], conds + [f"{col} ≤ {u}"])
        walk(t.children_right[i], conds + [f"{col} > {u}"])

    walk(0, [])
    return out


if __name__ == "__main__":
    main(sys.argv)
