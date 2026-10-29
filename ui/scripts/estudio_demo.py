"""Arma los experimentos y perfiles del estudio de ML para el modo demo (ui/src/api/demo/ml/*.json).

No inventa números: le pide al servidor de una full corriendo (con el cluster arriba) que entrene
cada receta de RECETAS, igual que la pantalla, y guarda lo que quedó registrado (experimento,
informe y código). Los gráficos de dispersión se recortan a 400 puntos para que la demo pese poco.

    python3 ui/scripts/estudio_demo.py http://127.0.0.1:8080

Usa las recetas que ya estén entrenadas (mismo nombre) y entrena las que falten.
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8080").rstrip("/")
DEST = Path(__file__).resolve().parent.parent / "src" / "api" / "demo" / "ml"
D = {"origen": "local", "ruta": "/datos/clientes_senal.csv"}
COLS = {"antiguedad_meses": "numerica", "visitas_mes": "numerica", "ticket_promedio": "numerica", "reclamos": "numerica",
        "edad": "numerica", "segmento_real": "categorica", "gasto_mes_siguiente": "ignorar", "vuelve": "ignorar"}
SIN_SEG = {**COLS, "segmento_real": "ignorar"}
RECETAS = [
    {"nombre": "demo: bosque con grilla", "tarea": "clasificacion", "objetivo": "vuelve", "columnas": COLS,
     "modelo": {"id": "bosque_clf", "params": {"n_estimators": 100}},
     "busqueda": {"tipo": "grid", "espacio": {"max_depth": [4, 8, None], "min_samples_leaf": [1, 10]}},
     "informe": {"curva_validacion": {"param": "max_depth", "valores": [2, 4, 6, 8, 12]}}},
    {"nombre": "demo: logística (línea base)", "tarea": "clasificacion", "objetivo": "vuelve", "columnas": COLS,
     "modelo": {"id": "logistica", "params": {"C": 1.0}}},
    {"nombre": "demo: red neuronal con adam", "tarea": "clasificacion", "objetivo": "vuelve", "columnas": COLS,
     "modelo": {"id": "mlp_clf", "params": {"hidden_layer_sizes": "32,16", "early_stopping": True, "max_iter": 300}}},
    {"nombre": "demo: XGBoost al azar", "tarea": "clasificacion", "objetivo": "vuelve", "columnas": COLS,
     "modelo": {"id": "xgb_clf", "params": {"n_estimators": 150}},
     "busqueda": {"tipo": "random", "iteraciones": 6, "espacio": {"max_depth": [3, 5, 8], "learning_rate": {"min": 0.03, "max": 0.3, "log": True}}}},
    {"nombre": "demo: boosting de histogramas (gasto)", "tarea": "regresion", "objetivo": "gasto_mes_siguiente", "columnas": COLS,
     "modelo": {"id": "hgb_reg"}},
    {"nombre": "demo: KMeans contra los segmentos", "tarea": "clustering", "referencia": "segmento_real", "columnas": SIN_SEG,
     "modelo": {"id": "kmeans", "params": {"n_clusters": 3}}},
    {"nombre": "demo: PCA", "tarea": "reduccion", "columnas": SIN_SEG, "modelo": {"id": "pca", "params": {"n_components": 3}}},
    {"nombre": "demo: bosque en Spark MLlib", "tarea": "clasificacion", "objetivo": "vuelve", "columnas": COLS,
     "modelo": {"id": "bosque_clf_spark", "params": {"numTrees": 30}},
     "validacion": {"particion": "aleatoria", "cv": "kfold", "k": 3, "metrica": "f1_ponderado"},
     "busqueda": {"tipo": "cv", "espacio": {"maxDepth": [4, 8]}}},
]


def pedir(m, ruta, cuerpo=None, crudo=False):
    req = urllib.request.Request(BASE + ruta, method=m, data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
                                 headers={"Content-Type": "application/json"} if cuerpo is not None else {})
    with urllib.request.urlopen(req, timeout=900) as r:
        datos = r.read()
        return datos.decode() if crudo else json.loads(datos or b"null")


def recortar(inf: dict, n: int = 400) -> dict:
    """Los gráficos de dispersión con a lo sumo n puntos (cada k-ésimo)."""
    def cada(xs, paso):
        return xs[::paso] if isinstance(xs, list) else xs
    for claves in (("real", "predicho", "residuo"),):
        if inf.get(claves[0]) and len(inf[claves[0]]) > n:
            paso = len(inf[claves[0]]) // n + 1
            for k in claves:
                inf[k] = cada(inf[k], paso)
    p = inf.get("proyeccion")
    if p and len(p.get("x", [])) > n:
        paso = len(p["x"]) // n + 1
        for k in ("x", "y", "grupo", "referencia"):
            if k in p:
                p[k] = cada(p[k], paso)
    for g in inf.get("silhouette_por_grupo") or []:
        g["valores"] = g["valores"][::max(1, len(g["valores"]) // 60)]
    return inf


def main():
    hechos = {e.get("nombre"): e for e in pedir("GET", "/api/ml/experiments") if e.get("estado") == "listo"}
    for r in RECETAS:
        if r["nombre"] in hechos:
            continue
        print("entrenando", r["nombre"], flush=True)
        lanz = pedir("POST", "/api/ml/experiments", {"receta": {"datos": D, **r}})
        while pedir("GET", f"/api/ml/runs/{lanz['run']}")["estado"] == "corriendo":
            time.sleep(2)
        hechos = {e.get("nombre"): e for e in pedir("GET", "/api/ml/experiments") if e.get("estado") == "listo"}
    salida = []
    for r in RECETAS:
        fila = hechos.get(r["nombre"])
        if not fila:
            print("falta", r["nombre"])
            continue
        exp = pedir("GET", f"/api/ml/experiments/{fila['id']}")
        exp["informe"] = recortar(exp.get("informe") or {})
        exp["corriendo"] = None
        codigo = pedir("GET", f"/api/ml/experiments/{fila['id']}/download?formato=py", crudo=True)
        salida.append({"fila": fila, "experimento": exp, "codigo": codigo})
    perfiles = {}
    for obj in ("vuelve", "gasto_mes_siguiente", None):
        perfiles[obj or ""] = pedir("POST", "/api/ml/profile", {"datos": D, "objetivo": obj})
    DEST.mkdir(parents=True, exist_ok=True)
    (DEST / "experimentos.json").write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    (DEST / "perfiles.json").write_text(json.dumps(perfiles, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"{len(salida)} experimentos y {len(perfiles)} perfiles en {DEST}")


if __name__ == "__main__":
    main()
