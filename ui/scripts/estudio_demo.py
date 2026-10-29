"""Arma los experimentos y perfiles del estudio de ML para el modo demo (ui/src/api/demo/ml/*.json).

No inventa números: le pide al servidor de una full corriendo (con el cluster arriba) que entrene
cada receta de RECETAS, igual que la pantalla, y guarda lo que quedó registrado (experimento,
informe y código). Los gráficos de dispersión se recortan a 400 puntos para que la demo pese poco.

    python3 ui/scripts/estudio_demo.py http://127.0.0.1:8080

Usa las recetas que ya estén entrenadas (mismo nombre) y entrena las que falten.

    python3 ui/scripts/estudio_demo.py http://127.0.0.1:8080 --datos

arma solo lo de la etapa (b) (ui/src/api/demo/ml/datos.json): las fuentes de HDFS en varios formatos, sus
perfiles con Spark y la vista previa de la receta de limpieza de ejemplo. Antes hay que dejar los datos en
HDFS con ml/preparar_demo_hdfs.py (adentro del contenedor, con spark-submit).
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

BASE = (sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "http://127.0.0.1:8080").rstrip("/")
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


# ---------------------------------------------------------------- etapa (b): formatos, perfil con Spark y limpieza

VENTAS_GZ = {"origen": "hdfs", "ruta": "/user/root/ml/crudo/ventas_sucias.csv.gz", "formato": "csv", "separador": ","}
FECHA = "coalesce(to_date(fecha, 'yyyyMMdd'), to_date(fecha, 'dd/MM/yyyy'), to_date(fecha, 'yyyy-MM-dd'))"
LIMPIEZA = {"nombre": "ventas", "pasos": [
    {"tipo": "texto", "columna": "sucursal", "ops": ["recortar", "sin_acentos", "minusculas"]},
    {"tipo": "texto", "columna": "producto", "ops": ["recortar", "sin_acentos", "minusculas"]},
    {"tipo": "texto", "columna": "medio_pago", "ops": ["recortar", "sin_acentos", "minusculas", "vacio_a_nulo"]},
    {"tipo": "regex", "columna": "precio", "patron": "[.]", "reemplazo": ""},
    {"tipo": "regex", "columna": "precio", "patron": ",", "reemplazo": "."},
    {"tipo": "tipo", "columna": "precio", "a": "double"},
    {"tipo": "derivada", "nombre": "fecha_ok", "expresion": FECHA, "rol": "fecha"},
    {"tipo": "outliers", "columna": "precio", "metodo": "iqr", "factor": 3, "accion": "recortar"},
    {"tipo": "nulos", "columna": "precio", "estrategia": "mediana", "indicador": True},
    {"tipo": "nulos", "columna": "medio_pago", "estrategia": "moda", "indicador": True},
    {"tipo": "raras", "columna": "producto", "min_pct": 0.01, "max_categorias": 50, "otra": "(otra)"},
    {"tipo": "duplicados", "columnas": []},
    {"tipo": "filtro", "condicion": "cantidad > 0 AND cantidad < 100"},
]}


def datos():
    fuentes = pedir("GET", "/api/ml/sources")
    fuentes["hdfs"] = [f for f in fuentes["hdfs"] if f["ruta"].startswith("/user/root/ml/") and "/modelos/" not in f["ruta"]]
    perfiles = {}
    for f in fuentes["hdfs"]:
        d = {k: f[k] for k in ("origen", "ruta", "formato", "separador", "multilinea") if k in f}
        print("perfil con Spark de", d["ruta"], flush=True)
        perfiles[d["ruta"]] = pedir("POST", "/api/ml/profile", {"datos": d, "motor": "spark", "modo": "muestra", "filas": 50000})
    print("vista previa de la limpieza", flush=True)
    vista = pedir("POST", "/api/ml/cleaning/preview", {"datos": VENTAS_GZ, "limpieza": LIMPIEZA, "filas": 5000})
    receta = {"datos": VENTAS_GZ, "objetivo": None, "limpieza": LIMPIEZA}
    codigo = {"perfil": pedir("POST", "/api/ml/code", {"receta": receta, "parte": "perfil", "opciones": {"modo": "muestra", "filas": 50000}}),
              "limpieza": pedir("POST", "/api/ml/code", {"receta": receta, "parte": "limpieza"})}
    salida = {"hdfs": fuentes["hdfs"], "perfiles": perfiles, "limpieza": {"datos": VENTAS_GZ, "receta": LIMPIEZA, "vista": vista},
              "codigo": codigo}
    DEST.mkdir(parents=True, exist_ok=True)
    (DEST / "datos.json").write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    malos = [p["titulo"] for p in vista["pasos"] if not p["ok"]]
    print(f"{len(fuentes['hdfs'])} fuentes, {len(perfiles)} perfiles y {len(vista['pasos'])} pasos ({len(malos)} con error: {malos}) en {DEST}")


if __name__ == "__main__":
    datos() if "--datos" in sys.argv else main()
