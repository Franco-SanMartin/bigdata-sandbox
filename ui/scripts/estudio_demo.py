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

    python3 ui/scripts/estudio_demo.py http://127.0.0.1:8080 --biblioteca

arma lo de la etapa (d) (ui/src/api/demo/ml/biblioteca.json), con los experimentos de arriba ya entrenados: guarda
versiones de "churn" y "gasto" en la biblioteca, las promueve y vuelve atrás, sube datos nuevos con deriva a HDFS
(clientes_nuevos.csv: más antigüedad, tickets más caros, una columna de más y visitas como texto) y corre lotes de
predicción con un modelo de scikit-learn y uno de Spark, más predicciones al instante. Corre adentro del contenedor
(usa hdfs dfs y /datos).
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
    # Con los valores por defecto de Spark: entrenamiento, validación y prueba (70 / 15 / 15) y el umbral elegido
    # en la validación; los recursos se piden a YARN con los flags de spark-submit
    {"nombre": "demo: logística en Spark (umbral por F1)", "tarea": "clasificacion", "objetivo": "vuelve", "columnas": COLS,
     "modelo": {"id": "logistica_spark", "params": {"regParam": 0.01}},
     "validacion": {"metrica": "roc_auc", "umbral": "f1"},
     "recursos": {"executors": 2, "memoria_executor_mb": 768, "cores": 1, "memoria_driver_mb": 768}},
    {"nombre": "demo: GLM en Spark (gasto)", "tarea": "regresion", "objetivo": "gasto_mes_siguiente", "columnas": COLS,
     "modelo": {"id": "glm_spark", "params": {"family": "gaussian", "regParam": 0.01}},
     "recursos": {"executors": 2, "memoria_executor_mb": 768, "cores": 1, "memoria_driver_mb": 768}},
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


# ---------------------------------------------------------------- etapa (d): biblioteca, lotes y deriva

NUEVOS_LOCAL = "/datos/clientes_nuevos.csv"
NUEVOS_HDFS = "/user/root/ml/nuevos/clientes_nuevos.csv"
UNA = {"antiguedad_meses": 40, "visitas_mes": 6, "ticket_promedio": 2500, "reclamos": 0, "edad": 35, "segmento_real": "frecuente"}
FILAS_INSTANTE = [UNA, {**UNA, "antiguedad_meses": 3, "visitas_mes": 1, "ticket_promedio": 900, "reclamos": 3, "edad": 52,
                        "segmento_real": "ocasional"},
                  {**UNA, "antiguedad_meses": 18, "visitas_mes": 4, "ticket_promedio": 4200, "reclamos": 1, "edad": 41,
                   "segmento_real": "mayorista"}]


def esperar(run: str) -> dict:
    while True:
        c = pedir("GET", f"/api/ml/runs/{run}")
        if c["estado"] != "corriendo":
            return c
        time.sleep(3)


def datos_nuevos() -> None:
    """La mitad de clientes_senal con la población corrida: deriva fuerte en antigüedad y ticket."""
    import subprocess

    import numpy as np
    import pandas as pd
    df = pd.read_csv("/datos/clientes_senal.csv").sample(frac=0.5, random_state=3).reset_index(drop=True)
    rnd = np.random.default_rng(5)
    df["antiguedad_meses"] = (df["antiguedad_meses"] + rnd.integers(6, 18, len(df))).astype(int)
    df["ticket_promedio"] = (df["ticket_promedio"] * 1.25).round(0)
    df["visitas_mes"] = df["visitas_mes"].astype(object)
    df.loc[df.index % 250 == 0, "visitas_mes"] = "s/d"                  # llega como texto, con algunos valores raros
    df["sucursal"] = rnd.choice(["centro", "norte", "sur"], len(df))    # una columna que el modelo no usa
    df.drop(columns=["vuelve", "gasto_mes_siguiente"]).to_csv(NUEVOS_LOCAL, index=False)
    subprocess.run(["hdfs", "dfs", "-mkdir", "-p", NUEVOS_HDFS.rsplit("/", 1)[0]], check=True)
    subprocess.run(["hdfs", "dfs", "-put", "-f", NUEVOS_LOCAL, NUEVOS_HDFS], check=True)
    print(f"{len(df)} clientes nuevos en hdfs://{NUEVOS_HDFS}", flush=True)


def biblioteca() -> None:
    exps = {e.get("nombre"): e["id"] for e in pedir("GET", "/api/ml/experiments") if e.get("estado") == "listo"}
    modelos = {m["nombre"] for m in pedir("GET", "/api/ml/library")}

    def guardar(nombre, receta, nota, descripcion=None):
        print("biblioteca:", nombre, "<-", receta, flush=True)
        pedir("POST", "/api/ml/library", {"nombre": nombre, "experimento": exps[receta], "nota": nota,
                                           **({"descripcion": descripcion} if descripcion else {})})

    def estado(nombre, accion, version=None, nota=""):
        pedir("POST", f"/api/ml/library/{nombre}/state", {"accion": accion, "version": version, "nota": nota})

    if "churn" not in modelos:
        guardar("churn", "demo: logística (línea base)", "la línea base: una logística sin ajustar",
                "¿El cliente vuelve el mes que viene? (clientes_senal)")
        guardar("churn", "demo: bosque con grilla", "bosque con búsqueda en grilla: le gana a la línea base en F1")
        guardar("churn", "demo: logística en Spark (umbral por F1)",
                "la misma idea en Spark MLlib, con el umbral elegido en la validación")
        estado("churn", "promover", 1, "primera versión en producción")
        estado("churn", "promover", 2, "le gana a la línea base en la prueba")
        estado("churn", "promover", 3, "probamos la de Spark para predecir sobre HDFS")
        estado("churn", "volver", None, "la de Spark da menos que el bosque en la prueba: volvemos a la v2")
    if "gasto" not in modelos:
        guardar("gasto", "demo: boosting de histogramas (gasto)", "boosting de histogramas: el mejor R² en la prueba",
                "Cuánto va a gastar el cliente el mes que viene (clientes_senal)")
        guardar("gasto", "demo: GLM en Spark (gasto)", "GLM gaussiano en Spark: casi igual y entrena en YARN")
        estado("gasto", "promover", 1, "el mejor R² en la prueba")
    datos_nuevos()
    entrada = {"origen": "hdfs", "ruta": NUEVOS_HDFS, "formato": "csv"}
    pedidos = [("churn", 2, {"tipo": "hdfs", "ruta": "/user/root/ml/predicciones/churn-v2", "formato": "parquet"}),
               ("churn", 3, {"tipo": "hdfs", "ruta": "/user/root/ml/predicciones/churn-v3", "formato": "csv"}),
               ("gasto", 1, {"tipo": "hive", "tabla": "default.pred_gasto_v1"})]
    codigo, predicciones = {}, {}
    for nombre, version, salida in pedidos:
        pedido = {"version": version, "datos": entrada, "salida": salida,
                  "recursos": {"executors": 2, "memoria_executor_mb": 768}}
        codigo[f"{nombre}-v{version}"] = pedir("POST", f"/api/ml/library/{nombre}/code", pedido)
        print("lote:", nombre, f"v{version}", "->", salida.get("ruta") or salida.get("tabla"), flush=True)
        c = esperar(pedir("POST", f"/api/ml/library/{nombre}/batch", pedido)["run"])
        print("  ", c["estado"], c.get("mensaje"), flush=True)
    for nombre, version in (("churn", 2), ("churn", 3), ("gasto", 1)):
        r = pedir("POST", f"/api/ml/library/{nombre}/predict", {"filas": FILAS_INSTANTE, "version": version})
        predicciones[f"{nombre}-v{version}"] = {**{k: r[k] for k in ("filas", "columnas", "muestra")},
                                                "filas_pedidas": FILAS_INSTANTE}
    salida = {"modelos": [{k: v for k, v in pedir("GET", f"/api/ml/library/{m}").items() if k != "lotes"}
                          for m in ("churn", "gasto")],
              "lotes": pedir("GET", "/api/ml/library/batches"), "codigo": codigo, "predicciones": predicciones}
    DEST.mkdir(parents=True, exist_ok=True)
    (DEST / "biblioteca.json").write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")) + "\n",
                                          encoding="utf-8")
    print(f"{len(salida['modelos'])} modelos, {len(salida['lotes'])} lotes y {len(predicciones)} predicciones en {DEST}")


if __name__ == "__main__":
    datos() if "--datos" in sys.argv else biblioteca() if "--biblioteca" in sys.argv else main()
