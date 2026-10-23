"""Arma los dibujos de los modelos para la demo (ui/src/api/demo/viz/*.json).

No inventa números: genera clientes_senal.csv con datos/ejemplos/ml/generar_senal.py,
entrena cada modelo con server/sandbox_server/jobs/entrenar_sklearn.py (los mismos
parámetros por defecto que la pantalla) y guarda lo que deja en SANDBOX_VIZ, con la
muestra recortada para que la demo pese poco.

La red de Spark MLlib no se puede entrenar sin Spark: se entrena acá con numpy una red
con la misma forma que la de MLlib (capas ocultas con sigmoide, salida softmax, entradas
con StandardScaler de Spark) y se guarda con viz.red_spark(), igual que el job de Spark.
El resto de los modelos de MLlib usa en la demo el dibujo de scikit-learn.

Hace falta Python con numpy, pandas y scikit-learn (las versiones de conf/requirements-ml.txt):

    python3 ui/scripts/viz_demo.py

Siempre da lo mismo (semillas fijas): si el JSON cambia, cambió el modelo o viz.py.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parents[2]
JOBS = RAIZ / "server" / "sandbox_server" / "jobs"
SALIDA = RAIZ / "ui" / "src" / "api" / "demo" / "viz"
sys.path.insert(0, str(JOBS))
import viz  # noqa: E402

ENTRADAS = ["antiguedad_meses", "visitas_mes", "ticket_promedio", "reclamos", "edad"]
MODELOS = [  # archivo, problema, modelo, parámetros, columnas, filas de muestra en la demo
    ("lineal", "regresion", "lineal", {}, ENTRADAS, 120),
    ("arbol", "clasificacion", "arbol", {"max_depth": 3}, ENTRADAS, 120),
    ("logistica", "clasificacion", "logistica", {"C": 1}, ENTRADAS, 120),
    ("tonto", "clasificacion", "tonto", {"strategy": "most_frequent"}, ENTRADAS, 60),
    ("mlp", "clasificacion", "mlp", {"hidden_layer_sizes": "16,8", "max_iter": 500}, ENTRADAS, 80),
    ("kmeans", "clustering", "kmeans", {"n_clusters": 3, "n_init": 10}, ["visitas_mes", "ticket_promedio"], 300),
]


def recortar(v, n):
    s = v.get("sample")
    if s and len(s["rows"]) > n:
        idx = viz.indices_muestra(len(s["rows"]), n, semilla=7)
        v["sample"] = {k: [x[i] for i in idx] for k, x in s.items()}
    return v


def entrenar(csv, tarea, modelo, params, columnas):
    with tempfile.TemporaryDirectory() as tmp:
        ruta = Path(tmp) / "viz.json"
        p = subprocess.run([sys.executable, str(JOBS / "entrenar_sklearn.py"), str(csv), tarea, modelo, "80",
                            json.dumps(params), ",".join(columnas)],
                           capture_output=True, text=True, env={**os.environ, "SANDBOX_VIZ": str(ruta)}, check=True)
        assert '"viz": true' in p.stdout, p.stdout[-500:]
        return json.loads(ruta.read_text())


def red_como_spark(csv, n_muestra):
    """Red [5, 16, 8, 2] con sigmoide y softmax (como MultilayerPerceptronClassifier), con Adam en numpy."""
    import pandas as pd
    from sklearn.model_selection import train_test_split

    datos = pd.read_csv(csv)
    X, y = datos[ENTRADAS].to_numpy(float), datos["vuelve"].to_numpy(int)
    X_ent, X_prueba, y_ent, y_prueba = train_test_split(X, y, test_size=0.2, random_state=42)
    media, desvio = X_ent.mean(axis=0), X_ent.std(axis=0, ddof=1)      # StandardScaler de Spark: desvío muestral
    Z = (X_ent - media) / desvio
    capas = [5, 16, 8, 2]
    azar = np.random.default_rng(42)
    W = [azar.normal(0, np.sqrt(1 / a), (a, b)) for a, b in zip(capas, capas[1:])]
    B = [np.zeros(b) for b in capas[1:]]
    sig = lambda z: 1 / (1 + np.exp(-z))  # noqa: E731
    Y = np.eye(2)[y_ent]
    m = [np.zeros_like(p) for p in W + B]
    v = [np.zeros_like(p) for p in W + B]
    for paso in range(1, 401):
        acts = [Z]
        for k in range(len(W)):
            zk = acts[-1] @ W[k] + B[k]
            if k < len(W) - 1:
                acts.append(sig(zk))
            else:
                e = np.exp(zk - zk.max(axis=1, keepdims=True))
                acts.append(e / e.sum(axis=1, keepdims=True))
        delta = (acts[-1] - Y) / len(Z)
        grads_w, grads_b = [], []
        for k in reversed(range(len(W))):
            grads_w.insert(0, acts[k].T @ delta)
            grads_b.insert(0, delta.sum(axis=0))
            if k:
                delta = (delta @ W[k].T) * acts[k] * (1 - acts[k])
        for i, (p, g) in enumerate(zip(W + B, grads_w + grads_b)):
            m[i] = 0.9 * m[i] + 0.1 * g
            v[i] = 0.999 * v[i] + 0.001 * g * g
            p -= 0.05 * (m[i] / (1 - 0.9 ** paso)) / (np.sqrt(v[i] / (1 - 0.999 ** paso)) + 1e-8)
    plano = np.concatenate([np.concatenate([w.ravel(), b]) for w, b in zip(W, B)])
    idx = viz.indices_muestra(len(X_prueba), n_muestra, semilla=7)
    Xm = X_prueba[idx]
    base = viz.red_spark(capas, plano, media, desvio, ENTRADAS, Xm, y_prueba[idx], [0] * len(Xm), [[0.5, 0.5]] * len(Xm))
    proba = [viz.pasada_red(base, x) for x in Xm.tolist()]
    base["sample"] = viz.muestra(Xm, y_prueba[idx], [int(p[1] > p[0]) for p in proba], proba)
    todas = [viz.pasada_red(base, x) for x in X_prueba.tolist()]
    print("red como Spark: aciertos", round(float(np.mean([int(p[1] > p[0]) == r for p, r in zip(todas, y_prueba)])), 4))
    return base


def main():
    SALIDA.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        csv = Path(tmp) / "clientes_senal.csv"
        subprocess.run([sys.executable, str(RAIZ / "datos" / "ejemplos" / "ml" / "generar_senal.py"), "20000", str(csv)],
                       check=True, capture_output=True)
        for nombre, tarea, modelo, params, columnas, n in MODELOS:
            v = recortar(entrenar(csv, tarea, modelo, params, columnas), n)
            if nombre == "mlp":     # menos cuadros de entrenamiento: la demo no necesita los 40
                ep = v["epochs"]
                elegidas = set(viz.epocas_elegidas(len(ep["frames"]), 24, None))
                ep["frames"] = [f for i, f in enumerate(ep["frames"]) if i in elegidas or f["epoch"] == ep["best"]]
            (SALIDA / f"{nombre}.json").write_text(json.dumps(v, ensure_ascii=False, separators=(",", ":")) + "\n")
            print(nombre, (SALIDA / f"{nombre}.json").stat().st_size, "bytes")
        v = {"v": viz.VERSION, **red_como_spark(csv, 80)}
        (SALIDA / "mlp-mllib.json").write_text(json.dumps(v, ensure_ascii=False, separators=(",", ":")) + "\n")
        print("mlp-mllib", (SALIDA / "mlp-mllib.json").stat().st_size, "bytes")


if __name__ == "__main__":
    main()
