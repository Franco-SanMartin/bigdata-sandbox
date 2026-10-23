"""Lo de adentro de un modelo entrenado, para dibujarlo en la pantalla de ML (GET /api/ml/models/{id}/viz).

Lo usan entrenar_sklearn.py y entrenar_spark.py. No dibuja nada: arma un JSON con lo
que el modelo aprendió (pesos y sesgos de la red, nodos del árbol, centros de KMeans,
coeficientes) y una muestra de filas con lo que predijo el modelo de verdad. La
interfaz hace la misma cuenta con esos números y tiene que llegar a la misma
predicción (los tests lo comparan con una tolerancia de 1e-6), así que los pesos
finales van sin redondear: json escribe cada float con todos sus dígitos.

Va a un archivo (la ruta viene en la variable SANDBOX_VIZ), no a la salida: una
línea de cientos de KB no la lee el servidor (lee de a líneas de hasta 64 KB) y
además viajaría a cada navegador conectado.

Topes, para que un modelo grande no tape la pantalla ni la memoria:
- muestra: hasta TOPE_MUESTRA filas (TOPE_MUESTRA_RED en la red, que hace más cuentas)
- red: hasta TOPE_PESOS pesos + sesgos; con más, se mandan solo las capas y el motivo
- épocas: hasta TOPE_EPOCAS cuadros del entrenamiento (siempre la primera, la última
  y la mejor), con los pesos redondeados a 5 decimales (son para la animación)
- árbol: hasta TOPE_NODOS nodos; con más, se cortan los niveles de abajo y se avisa
- archivo: hasta TOPE_BYTES; si se pasa, se sacan las épocas y se achica la muestra
"""
import json
import math
import os
import struct

try:
    import numpy as np
except ImportError:   # las pasadas (pasada_*) no lo usan: el humo las importa sin numpy
    np = None

VERSION = 1
TOPE_MUESTRA = 500
TOPE_MUESTRA_RED = 200
TOPE_PESOS = 20000
TOPE_EPOCAS = 40
TOPE_NODOS = 1023
TOPE_BYTES = 3_000_000
CLASES = ["no vuelve", "vuelve"]
SEMILLA = 42


# ------------------------------------------------------------------ ayudas


def flotantes(a):
    """Arreglo de numpy (o lista) → listas de float de Python, sin redondear."""
    return np.asarray(a, dtype=float).tolist()


def redondeados(a, dec=5):
    return np.round(np.asarray(a, dtype=float), dec).tolist()


def indices_muestra(n, tope, semilla=SEMILLA):
    """Hasta `tope` posiciones de 0..n-1, siempre las mismas para los mismos datos, en orden."""
    if n <= tope:
        return list(range(n))
    rng = np.random.RandomState(semilla)
    return sorted(int(i) for i in rng.choice(n, size=tope, replace=False))


def epocas_elegidas(n, tope=TOPE_EPOCAS, mejor=None):
    """Qué épocas (0..n-1) van como cuadro: parejas, con la primera, la última y la mejor."""
    if n <= 0:
        return []
    if n <= tope:
        elegidas = set(range(n))
    else:
        elegidas = {int(round(i * (n - 1) / (tope - 1))) for i in range(tope)}
        if mejor is not None and 0 <= mejor < n and mejor not in elegidas:
            # cambia la más cercana por la mejor, así no se pasa del tope
            cerca = min((e for e in elegidas if e not in (0, n - 1)), key=lambda e: abs(e - mejor), default=None)
            if cerca is not None:
                elegidas.discard(cerca)
            elegidas.add(mejor)
    return sorted(elegidas)


def contar_pesos(capas):
    return sum(a * b + b for a, b in zip(capas, capas[1:]))


def escribir(viz, ruta=None):
    """Guarda el JSON en SANDBOX_VIZ (si está). Devuelve el JSON que quedó (o None)."""
    ruta = ruta or os.environ.get("SANDBOX_VIZ")
    if not ruta or viz is None:
        return None
    viz = {"v": VERSION, **viz}
    texto = json.dumps(viz, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    if len(texto.encode()) > TOPE_BYTES and viz.get("epochs"):
        viz["epochs"] = {**viz["epochs"], "frames": [], "note": "Sin cuadros por época: no entraban en el tope"}
        texto = json.dumps(viz, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    while len(texto.encode()) > TOPE_BYTES and viz.get("sample") and len(viz["sample"]["rows"]) > 20:
        mitad = len(viz["sample"]["rows"]) // 2
        viz["sample"] = {k: (v[:mitad] if isinstance(v, list) else v) for k, v in viz["sample"].items()}
        viz["truncated"] = f"La muestra quedó en {mitad} filas para no pasar de {TOPE_BYTES // 1_000_000} MB"
        texto = json.dumps(viz, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    with open(ruta, "w", encoding="utf-8") as fh:
        fh.write(texto)
    return viz


def muestra(X, real=None, pred=None, proba=None, extra=None):
    """{rows, real, pred, proba}: X ya recortado a la muestra. Todo lo que predijo el modelo, sin redondear."""
    out = {"rows": flotantes(X)}
    if real is not None:
        out["real"] = [v if isinstance(v, str) else float(v) for v in list(real)]
    if pred is not None:
        out["pred"] = flotantes(pred)
    if proba is not None:
        out["proba"] = flotantes(proba)
    if extra:
        out.update(extra)
    return out


# ------------------------------------------------------------------ red neuronal (MLP)


def clase_red_con_epocas():
    """MLPClassifier que guarda, al final de cada época, una copia de sus pesos.

    Es la trayectoria del mismo modelo que se entrena y se mide (no de otro entrenado
    aparte): scikit-learn llama a _update_no_improvement_count después de cada
    pasada por los datos, con la pérdida ya anotada en loss_curve_. Si una versión
    de scikit-learn no lo tuviera, entrena igual y queda sin cuadros.
    """
    from sklearn.neural_network import MLPClassifier

    class MLPConEpocas(MLPClassifier):
        def fit(self, X, y, *args, **kwargs):
            self.cuadros_ = []
            return super().fit(X, y, *args, **kwargs)

        def _update_no_improvement_count(self, *args, **kwargs):
            r = super()._update_no_improvement_count(*args, **kwargs)
            self.cuadros_.append(([c.copy() for c in self.coefs_], [b.copy() for b in self.intercepts_]))
            return r

    MLPConEpocas.__name__ = MLPConEpocas.__qualname__ = "MLPClassifier"
    return MLPConEpocas


def red_sklearn(escalador, red, entradas, X, real):
    """Pipeline StandardScaler + MLPClassifier ya entrenado → viz 'mlp'. X: filas de prueba (DataFrame o array)."""
    capas = [int(red.coefs_[0].shape[0])] + [int(c.shape[1]) for c in red.coefs_]
    base = {"kind": "mlp", "engine": "sklearn", "features": list(entradas), "classes": CLASES,
            "layers": capas, "hidden": str(red.activation), "out": str(red.out_activation_),
            "scaler": {"mean": flotantes(escalador.mean_), "scale": flotantes(escalador.scale_)}}
    if contar_pesos(capas) > TOPE_PESOS:
        return {**base, "weights": None, "biases": None,
                "truncated": f"La red tiene {contar_pesos(capas)} pesos: se dibuja hasta {TOPE_PESOS}"}
    Xa = np.asarray(X, dtype=float)
    idx = indices_muestra(len(Xa), TOPE_MUESTRA_RED)
    Xm = Xa[idx]
    real = np.asarray(real)[idx]
    proba = red.predict_proba(escalador.transform(Xm))
    pred = red.predict(escalador.transform(Xm))
    viz = {**base, "weights": [flotantes(c) for c in red.coefs_], "biases": [flotantes(b) for b in red.intercepts_],
           "sample": muestra(Xm, real, pred, proba)}
    perdida = [float(x) for x in getattr(red, "loss_curve_", []) or []]
    val = getattr(red, "validation_scores_", None)
    val = [float(x) for x in val] if val else None
    mejor = int(np.argmax(val)) if val else None
    cuadros = getattr(red, "cuadros_", []) or []
    elegidas = epocas_elegidas(len(cuadros), TOPE_EPOCAS, mejor)
    viz["epochs"] = {
        "loss": [round(x, 6) for x in perdida],
        "val": [round(x, 6) for x in val] if val else None,
        "best": mejor,
        "frames": [{"epoch": i, "weights": [redondeados(c) for c in cuadros[i][0]],
                    "biases": [redondeados(b) for b in cuadros[i][1]]} for i in elegidas],
        "chosen": "mejor validación" if val else "última época",
    }
    return viz


def red_spark(capas, pesos, media, desvio, entradas, X, real, pred, proba):
    """MultilayerPerceptronClassificationModel de Spark → viz 'mlp'.

    Spark guarda todos los pesos en un vector: por cada capa, la matriz (salidas × entradas)
    por columnas y después los sesgos. Leído en orden, eso es W[entrada][salida] por filas,
    igual que coefs_ de scikit-learn. Las capas ocultas usan sigmoide y la salida softmax.
    """
    capas = [int(c) for c in capas]
    base = {"kind": "mlp", "engine": "mllib", "features": list(entradas), "classes": CLASES,
            "layers": capas, "hidden": "logistic", "out": "softmax",
            "scaler": {"mean": flotantes(media), "scale": flotantes(desvio), "zeroScale": "zero"}}
    if contar_pesos(capas) > TOPE_PESOS:
        return {**base, "weights": None, "biases": None,
                "truncated": f"La red tiene {contar_pesos(capas)} pesos: se dibuja hasta {TOPE_PESOS}"}
    w = np.asarray(pesos, dtype=float)
    assert len(w) == contar_pesos(capas), (len(w), capas)
    pesos_capas, sesgos, off = [], [], 0
    for a, b in zip(capas, capas[1:]):
        pesos_capas.append(w[off:off + a * b].reshape(a, b).tolist())
        off += a * b
        sesgos.append(w[off:off + b].tolist())
        off += b
    return {**base, "weights": pesos_capas, "biases": sesgos, "sample": muestra(X, real, pred, proba),
            "epochs": None, "epochsNote": "Spark MLlib no expone los pesos de cada iteración: se ve la red final"}


def pasada_red(viz, x):
    """La misma cuenta que hace la interfaz (lib/viz/forward.ts), para los tests: probabilidades de cada clase."""
    sc = viz["scaler"]
    a = []
    for v, m, s in zip(x, sc["mean"], sc["scale"]):
        a.append(0.0 if s == 0 and sc.get("zeroScale") == "zero" else (v - m) / (s if s != 0 else 1.0))
    act = {"relu": lambda z: max(z, 0.0), "logistic": lambda z: 1 / (1 + math.exp(-z)), "tanh": math.tanh,
           "identity": lambda z: z}[viz["hidden"]]
    n = len(viz["weights"])
    for k, (W, b) in enumerate(zip(viz["weights"], viz["biases"])):
        z = [sum(a[i] * W[i][j] for i in range(len(a))) + b[j] for j in range(len(b))]
        a = z if k == n - 1 else [act(v) for v in z]
    if viz["out"] == "softmax":
        mx = max(a)
        e = [math.exp(v - mx) for v in a]
        return [v / sum(e) for v in e]
    p = 1 / (1 + math.exp(-a[0]))
    return [1 - p, p]


# ------------------------------------------------------------------ árbol


def nodos_a_lo_ancho(raiz, leer):
    """Recorre el árbol a lo ancho con leer(nodo) -> (item, hijos o None) y numera los nodos en ese orden.

    Si el árbol pasa de TOPE_NODOS, los nodos que no entran quedan afuera y su padre marca cut.
    Devuelve (nodos, cuántos quedaron afuera).
    """
    nodos, cola, afuera = [], [(raiz, 0)], 0
    while cola:
        nodo, d = cola.pop(0)
        item, hijos = leer(nodo)
        item.update(d=d, l=-1, r=-1, cut=False)
        if hijos is not None:
            if len(nodos) + len(cola) + 3 <= TOPE_NODOS:
                base = len(nodos) + len(cola) + 1
                item["l"], item["r"] = base, base + 1
                cola += [(hijos[0], d + 1), (hijos[1], d + 1)]
            else:
                item["cut"] = True
                afuera += 2
        nodos.append(item)
    return nodos, afuera


def arbol_sklearn(arbol, entradas, X, real):
    t = arbol.tree_

    def leer(i):
        hoja = t.children_left[i] == -1
        v = np.asarray(t.value[i][0], dtype=float)
        v = v / v.sum() if v.sum() > 0 else v
        item = {"f": -1 if hoja else int(t.feature[i]), "t": None if hoja else float(t.threshold[i]),
                "imp": float(t.impurity[i]), "n": int(t.n_node_samples[i]), "p": v.tolist()}
        return item, None if hoja else (int(t.children_left[i]), int(t.children_right[i]))

    nodos, afuera = nodos_a_lo_ancho(0, leer)
    Xa = np.asarray(X, dtype=float)
    idx = indices_muestra(len(Xa), TOPE_MUESTRA)
    Xm = Xa[idx]
    viz = {"kind": "tree", "engine": "sklearn", "features": list(entradas), "classes": CLASES,
           "impurity": str(arbol.criterion), "nodes": nodos, "float32": True,
           "sample": muestra(Xm, np.asarray(real)[idx], arbol.predict(Xm), arbol.predict_proba(Xm))}
    if afuera:
        viz["truncated"] = f"El árbol tiene {t.node_count} nodos: se dibujan los primeros {len(nodos)}"
    return viz


def arbol_spark(raiz, entradas, X, real, pred, proba, impureza="gini"):
    """rootNode() del modelo de Spark (objeto de Java, por py4j) → viz 'tree', con el mismo tope."""

    def leer(nodo):
        stats = [float(x) for x in nodo.impurityStats().stats()]
        tot = sum(stats)
        item = {"f": -1, "t": None, "imp": float(nodo.impurity()), "n": int(round(tot)),
                "p": [x / tot if tot else 0.0 for x in stats]}
        if nodo.getClass().getSimpleName() == "LeafNode":
            return item, None
        split = nodo.split()
        item["f"], item["t"] = int(split.featureIndex()), float(split.threshold())
        return item, (nodo.leftChild(), nodo.rightChild())

    nodos, afuera = nodos_a_lo_ancho(raiz, leer)
    viz = {"kind": "tree", "engine": "mllib", "features": list(entradas), "classes": CLASES, "impurity": impureza,
           "nodes": nodos, "float32": False, "sample": muestra(X, real, pred, proba)}
    if afuera:
        viz["truncated"] = f"El árbol tiene más de {TOPE_NODOS} nodos: se dibujan los primeros {len(nodos)}"
    return viz


def pasada_arbol(viz, x):
    """Camino de la raíz a la hoja (índices) y las proporciones de la hoja, como lib/viz/tree.ts."""
    if viz.get("float32"):
        x = [struct.unpack("f", struct.pack("f", v))[0] for v in x]   # scikit-learn compara en float32
    i, camino = 0, [0]
    while viz["nodes"][i]["f"] != -1 and not viz["nodes"][i]["cut"]:
        n = viz["nodes"][i]
        i = n["l"] if x[n["f"]] <= n["t"] else n["r"]
        camino.append(i)
    return camino, viz["nodes"][i]["p"]


# ------------------------------------------------------------------ KMeans


def pca3(Z):
    """Media y 3 direcciones principales de Z (filas = puntos); signo fijo: la carga más grande, positiva."""
    Z = np.asarray(Z, dtype=float)
    media = Z.mean(axis=0)
    _, _, vt = np.linalg.svd(Z - media, full_matrices=False)
    comps = vt[:3]
    for k in range(len(comps)):
        j = int(np.argmax(np.abs(comps[k])))
        if comps[k][j] < 0:
            comps[k] = -comps[k]
    return {"mean": media.tolist(), "comps": comps.tolist()}


def recorrido_lloyd(Z, centros_modelo, k, semilla=SEMILLA, tope=60):
    """Centros de cada iteración de Lloyd desde un arranque k-means++, con los grupos numerados como el modelo.

    KMeans de scikit-learn y de Spark no guardan los centros intermedios: se rehace el
    recorrido desde un arranque con la misma semilla. El último cuadro son siempre los
    centros del modelo de verdad; `same` dice si el recorrido llegó a ellos.
    """
    from sklearn.cluster import kmeans_plusplus
    Z = np.asarray(Z, dtype=float)
    finales = np.asarray(centros_modelo, dtype=float)
    c, _ = kmeans_plusplus(Z, k, random_state=semilla)
    cuadros = [c.copy()]
    for _ in range(tope):
        d = ((Z[:, None, :] - c[None, :, :]) ** 2).sum(axis=2)
        g = d.argmin(axis=1)
        nuevo = np.array([Z[g == j].mean(axis=0) if np.any(g == j) else c[j] for j in range(k)])
        cuadros.append(nuevo)
        if np.allclose(nuevo, c, atol=1e-10, rtol=0):
            break
        c = nuevo
    # numerar como el modelo: cada centro final del recorrido va con el centro del modelo más cercano
    ultimo = cuadros[-1]
    orden, libres = [0] * k, set(range(k))
    for j in range(k):
        m = min(libres, key=lambda i: float(((ultimo[j] - finales[i]) ** 2).sum()))
        orden[j] = m
        libres.discard(m)
    alineados = []
    for cu in cuadros:
        a = np.zeros_like(cu)
        for j in range(k):
            a[orden[j]] = cu[j]
        alineados.append(a)
    same = bool(np.allclose(alineados[-1], finales, atol=1e-6, rtol=0))
    if not same:
        alineados.append(finales)
    alineados[-1] = finales
    return [{"it": i, "centers": (flotantes(a) if i == len(alineados) - 1 else redondeados(a, 6))}
            for i, a in enumerate(alineados)], same


def kmeans(engine, entradas, log, media, escala, Z, centros, k, X_crudo, segmento, grupos):
    """viz 'kmeans'. Z: todas las filas escaladas (para el recorrido y la PCA); el resto, ya recortado a la muestra."""
    cuadros, same = recorrido_lloyd(Z, centros, k)
    return {"kind": "kmeans", "engine": engine, "features": list(entradas), "k": int(k),
            "transform": {"log": [bool(x) for x in log], "mean": flotantes(media), "scale": flotantes(escala),
                          "zeroScale": "zero" if engine == "mllib" else "one"},
            "frames": cuadros, "replaySame": same,
            "pca": pca3(Z) if len(entradas) > 3 else None,
            "sample": muestra(X_crudo, segmento, grupos)}


def escalar_kmeans(viz, x):
    t = viz["transform"]
    out = []
    for v, lg, m, s in zip(x, t["log"], t["mean"], t["scale"]):
        v = math.log(v) if lg else v
        out.append(0.0 if s == 0 and t.get("zeroScale") == "zero" else (v - m) / (s if s != 0 else 1.0))
    return out


def grupo_kmeans(viz, x):
    z = escalar_kmeans(viz, x)
    c = viz["frames"][-1]["centers"]
    return min(range(len(c)), key=lambda j: sum((a - b) ** 2 for a, b in zip(z, c[j])))


# ------------------------------------------------------------------ regresión, logística y tonto


def rangos(X):
    X = np.asarray(X, dtype=float)
    return {"mean": X.mean(axis=0).tolist(), "min": X.min(axis=0).tolist(), "max": X.max(axis=0).tolist()}


def lineal(engine, entradas, coef, intercepto, objetivo, X_ent, X, real, pred):
    return {"kind": "linear", "engine": engine, "features": list(entradas), "target": objetivo,
            "coef": flotantes(coef), "intercept": float(intercepto), "ranges": rangos(X_ent),
            "sample": muestra(X, real, pred)}


def logistica(engine, entradas, coef, intercepto, media, escala, X_ent, X, real, pred, proba):
    return {"kind": "logistic", "engine": engine, "features": list(entradas), "classes": CLASES,
            "coef": flotantes(coef), "intercept": float(intercepto),
            "scaler": {"mean": flotantes(media), "scale": flotantes(escala),
                       "zeroScale": "zero" if engine == "mllib" else "one"},
            "ranges": rangos(X_ent), "sample": muestra(X, real, pred, proba)}


def tonto(entradas, prior, estrategia, X, real, pred, proba):
    return {"kind": "dummy", "engine": "sklearn", "features": list(entradas), "classes": CLASES,
            "prior": flotantes(prior), "strategy": estrategia, "sample": muestra(X, real, pred, proba)}


def pasada_lineal(viz, x):
    return sum(c * v for c, v in zip(viz["coef"], x)) + viz["intercept"]


def pasada_logistica(viz, x):
    sc = viz["scaler"]
    z = viz["intercept"]
    for c, v, m, s in zip(viz["coef"], x, sc["mean"], sc["scale"]):
        z += c * (0.0 if s == 0 and sc.get("zeroScale") == "zero" else (v - m) / (s if s != 0 else 1.0))
    p = 1 / (1 + math.exp(-z))
    return [1 - p, p]
