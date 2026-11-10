"""Exportar una versión de la biblioteca: un .zip para usar el modelo fuera del sandbox, con un servicio mínimo.

    modelo.joblib  o  modelo/   el Pipeline de scikit-learn o el PipelineModel de Spark (una carpeta)
    sandbox_ml/                 los pasos propios del sandbox que el modelo puede usar (Limpiar, RecortarExtremos...)
    servir.py                   un servicio HTTP chico (solo la librería estándar + la del modelo):
                                  GET  /         la ficha del modelo y el esquema de entrada
                                  GET  /salud    {"ok": true}
                                  POST /predecir {"filas": [{columna: valor}, ...]} → las predicciones
    modelo.json                 la ficha: versión, métricas, esquema de entrada, clases y linaje
    requirements.txt            las librerías con la versión con la que se entrenó
    Dockerfile                  para correrlo en un contenedor (puerto 8000)
    LEEME.md                    cómo usarlo

    from sandbox_ml import exportar
    exportar.armar(version, carpeta_version, "/tmp/churn-v3.zip", modelo_local=Path("/tmp/churn-v3/modelo"))
"""
from __future__ import annotations

import json
import zipfile
from pathlib import Path

PROPIOS = ("__init__.py", "transformadores.py", "transformadores_spark.py")


def ficha(nombre: str, x: dict, exp: dict) -> dict:
    return {
        "modelo": nombre, "version": x["version"], "estado": x["estado"], "motor": x.get("motor"), "tarea": x["tarea"],
        "objetivo": x.get("objetivo"), "algoritmo": (x.get("modelo") or {}).get("etiqueta"),
        "clase": (x.get("modelo") or {}).get("clase"), "params": (x.get("modelo") or {}).get("params"),
        "metrica": x.get("metrica"), "metricas": x.get("metricas"), "umbral": x.get("umbral"),
        "clases": x.get("clases"), "entrada": x.get("entrada"), "variables": exp.get("variables"),
        "linaje": x.get("linaje"),
    }


def requirements(x: dict) -> str:
    e = ((x.get("linaje") or {}).get("entorno")) or {}
    filas = []
    if x.get("motor") == "spark":
        filas.append(f"pyspark=={e['pyspark']}" if e.get("pyspark") else "pyspark")
    else:
        filas.append(f"scikit-learn=={e['sklearn']}" if e.get("sklearn") else "scikit-learn")
        filas.append("joblib")
        if (x.get("modelo") or {}).get("clase", "").startswith("xgboost"):
            filas.append(f"xgboost=={e['xgboost']}" if e.get("xgboost") else "xgboost")
    filas.append(f"numpy=={e['numpy']}" if e.get("numpy") else "numpy")
    filas.append(f"pandas=={e['pandas']}" if e.get("pandas") else "pandas")
    return "\n".join(filas) + "\n"


def dockerfile(x: dict) -> str:
    py = (((x.get("linaje") or {}).get("entorno")) or {}).get("python", "3.12")
    menor = ".".join(py.split(".")[:2])
    if x.get("motor") == "spark":
        return (
            "# Spark necesita Java: la imagen trae el JRE y PySpark corre en modo local (un solo proceso)\n"
            "FROM eclipse-temurin:17-jre-jammy\n"
            "RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip && "
            "rm -rf /var/lib/apt/lists/*\n"
            "WORKDIR /app\n"
            "COPY requirements.txt .\n"
            "RUN pip3 install --no-cache-dir -r requirements.txt\n"
            "COPY . .\n"
            "ENV HOST=0.0.0.0 PUERTO=8000\n"
            "EXPOSE 8000\n"
            'CMD ["python3", "servir.py"]\n')
    return (
        f"FROM python:{menor}-slim\n"
        "WORKDIR /app\n"
        "COPY requirements.txt .\n"
        "RUN pip install --no-cache-dir -r requirements.txt\n"
        "COPY . .\n"
        "ENV HOST=0.0.0.0 PUERTO=8000\n"
        "EXPOSE 8000\n"
        'CMD ["python", "servir.py"]\n')


def leeme(nombre: str, x: dict) -> str:
    ent = x.get("entrada") or []
    ejemplo = {c["columna"]: (0 if c.get("rol") == "numerica" else "valor") for c in ent[:6]}
    m = (x.get("metricas") or {}).get(x.get("metrica") or "", {})
    valor = m.get("prueba", m.get("cv"))
    return "\n".join([
        f"# {nombre} v{x['version']}",
        "",
        f"{(x.get('modelo') or {}).get('etiqueta')} ({'Spark MLlib' if x.get('motor') == 'spark' else 'scikit-learn'}), "
        f"exportado de la biblioteca de modelos de BigData Sandbox."
        + (f" {x.get('metrica')} en la prueba: {valor:.4f}." if isinstance(valor, (int, float)) else ""),
        "",
        "## Correrlo",
        "",
        "```bash",
        "pip install -r requirements.txt",
        "python servir.py            # escucha en 127.0.0.1:8000 (HOST y PUERTO lo cambian)",
        "```",
        "",
        "O en un contenedor:",
        "",
        "```bash",
        f"docker build -t {nombre}:v{x['version']} .",
        f"docker run --rm -p 127.0.0.1:8000:8000 {nombre}:v{x['version']}",
        "```",
        "",
        "## Pedir predicciones",
        "",
        "```bash",
        "curl -s localhost:8000/predecir -H 'Content-Type: application/json' \\",
        f"     -d '{json.dumps({'filas': [ejemplo]}, ensure_ascii=False)}'",
        "```",
        "",
        "`GET /` devuelve la ficha (métricas, columnas que espera y de dónde salió) y `GET /salud`, `{\"ok\": true}`.",
        "",
        "## Columnas que espera",
        "",
        "| columna | rol | tipo en el entrenamiento |",
        "|---|---|---|",
        *[f"| {c['columna']} | {c.get('rol')} | {c.get('tipo') or '—'} |" for c in ent],
        "",
        "La limpieza y el preprocesamiento van adentro del modelo: se mandan los datos crudos, como venían en el "
        "entrenamiento.",
        "",
    ])


SERVIR = r'''"""Servicio mínimo para el modelo exportado de BigData Sandbox (ver LEEME.md).

    python servir.py           HOST y PUERTO por variable de entorno (por defecto 127.0.0.1:8000)
"""
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)   # sandbox_ml/: los pasos propios que el modelo puede usar
with open(os.path.join(AQUI, "modelo.json"), encoding="utf-8") as f:
    FICHA = json.load(f)
TAREA, CLASES, VARIABLES = FICHA["tarea"], FICHA.get("clases"), FICHA.get("variables") or {}
ENTRADA = [c["columna"] for c in FICHA.get("entrada") or []]
MAX_FILAS = 10000

__MOTOR__


class Manejador(BaseHTTPRequestHandler):
    def _json(self, codigo, obj):
        cuerpo = json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def do_GET(self):
        if self.path == "/salud":
            return self._json(200, {"ok": True})
        if self.path == "/":
            return self._json(200, {k: FICHA.get(k) for k in ("modelo", "version", "motor", "tarea", "objetivo",
                                                              "algoritmo", "metrica", "metricas", "clases", "entrada", "linaje")})
        return self._json(404, {"error": "no existe; probá GET /, GET /salud o POST /predecir"})

    def do_POST(self):
        if self.path != "/predecir":
            return self._json(404, {"error": "no existe; las predicciones van a POST /predecir"})
        try:
            largo = int(self.headers.get("Content-Length") or 0)
            pedido = json.loads(self.rfile.read(largo) or b"{}")
            filas = pedido.get("filas") if isinstance(pedido, dict) else pedido
            if not isinstance(filas, list) or not filas or not all(isinstance(x, dict) for x in filas):
                raise ValueError('mandá {"filas": [{columna: valor}, ...]}')
            if len(filas) > MAX_FILAS:
                raise ValueError(f"a lo sumo {MAX_FILAS} filas por pedido")
            faltan = sorted({c for c in ENTRADA if any(c not in x for x in filas)})
            if faltan:
                raise ValueError("faltan columnas: " + ", ".join(faltan))
            return self._json(200, {"predicciones": predecir(filas)})
        except ValueError as e:
            return self._json(400, {"error": str(e)})
        except Exception as e:  # noqa: BLE001
            return self._json(500, {"error": f"{type(e).__name__}: {e}"})

    def log_message(self, formato, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), formato % args))


if __name__ == "__main__":
    host, puerto = os.environ.get("HOST", "127.0.0.1"), int(os.environ.get("PUERTO", "8000"))
    print(f"{FICHA['modelo']} v{FICHA['version']} en http://{host}:{puerto}  (POST /predecir)", flush=True)
    ThreadingHTTPServer((host, puerto), Manejador).serve_forever()
'''

MOTOR_SKLEARN = r'''import joblib
import numpy as np
import pandas as pd

MODELO = joblib.load(os.path.join(AQUI, "modelo.joblib"))
CODIFICADAS = (FICHA.get("clase") or "").startswith("xgboost") and TAREA == "clasificacion"
ORDEN = VARIABLES.get("numerica", []) + VARIABLES.get("categorica", []) + VARIABLES.get("fecha", []) + VARIABLES.get("texto", [])


def preparar(df):
    X = df[ORDEN].copy()
    for c in VARIABLES.get("categorica", []):
        X[c] = X[c].astype(str).where(X[c].notna())
    for c in VARIABLES.get("texto", []):
        X[c] = X[c].fillna("")
    for c in VARIABLES.get("numerica", []):
        X[c] = pd.to_numeric(X[c], errors="coerce")
    return X


def predecir(filas):
    X = preparar(pd.DataFrame(filas))
    if TAREA == "reduccion":
        comp = MODELO.transform(X)
        return [{f"componente_{i + 1}": round(float(v), 6) for i, v in enumerate(f)} for f in comp]
    p = MODELO.predict(X)
    out = [{"prediccion": (CLASES[int(v)] if CODIFICADAS else v.item() if hasattr(v, "item") else v)} for v in p]
    if TAREA == "clasificacion" and hasattr(MODELO, "predict_proba"):
        proba = MODELO.predict_proba(X)
        nombres = CLASES if CODIFICADAS else [str(c) for c in MODELO.classes_]
        for o, fila in zip(out, proba):
            o["probabilidades"] = {str(c): round(float(v), 4) for c, v in zip(nombres, fila)}
    return out
'''

MOTOR_SPARK = r'''from pyspark.ml import PipelineModel
from pyspark.ml.functions import vector_to_array
from pyspark.sql import SparkSession
from pyspark.sql import functions as F

try:
    from sandbox_ml.transformadores_spark import Limpiar  # noqa: F401  (el paso de limpieza, si el modelo lo usa)
except ImportError:
    pass

# Spark en modo local, una sola vez: cada pedido reusa la sesión y el modelo ya cargado
SPARK = (SparkSession.builder.master("local[1]").appName(f"servir {FICHA['modelo']}")
         .config("spark.ui.enabled", "false").getOrCreate())
SPARK.sparkContext.setLogLevel("ERROR")
MODELO = PipelineModel.load("file://" + os.path.join(AQUI, "modelo"))


def predecir(filas):
    df = SPARK.createDataFrame([{c: f.get(c) for c in ENTRADA} for f in filas])
    pred = MODELO.transform(df)
    cols = ["prediction"] + (["probability"] if "probability" in pred.columns else [])
    if "probability" in cols:
        pred = pred.withColumn("probability", vector_to_array("probability"))
    out = []
    for r in pred.select(*cols).collect():
        p = r["prediction"]
        o = {"prediccion": CLASES[int(p)] if TAREA == "clasificacion" and CLASES else
             (int(p) if TAREA == "clustering" else float(p))}
        if "probability" in cols and CLASES:
            o["probabilidades"] = {str(c): round(float(v), 4) for c, v in zip(CLASES, r["probability"])}
        out.append(o)
    return out
'''


def servir(x: dict) -> str:
    return SERVIR.replace("__MOTOR__", MOTOR_SPARK if x.get("motor") == "spark" else MOTOR_SKLEARN)


def armar(nombre: str, x: dict, carpeta: Path, destino: Path, *, modelo_local: Path | None = None) -> Path:
    """Arma el .zip. modelo_local: la carpeta del PipelineModel de Spark ya bajada de HDFS (hdfs dfs -get)."""
    carpeta = Path(carpeta)
    exp = json.loads((carpeta / "experimento.json").read_text(encoding="utf-8"))
    raiz = f"{nombre}-v{x['version']}"
    propios = Path(__file__).resolve().parent
    with zipfile.ZipFile(destino, "w", compression=zipfile.ZIP_DEFLATED) as z:
        if x.get("motor") == "spark":
            if not modelo_local or not Path(modelo_local).is_dir():
                raise ValueError("falta la carpeta del modelo de Spark (bajala de HDFS con hdfs dfs -get)")
            for f in sorted(Path(modelo_local).rglob("*")):
                if f.is_file() and not f.name.endswith(".crc"):
                    z.write(f, f"{raiz}/modelo/{f.relative_to(modelo_local).as_posix()}")
        else:
            z.write(carpeta / "modelo.joblib", f"{raiz}/modelo.joblib")
        for f in PROPIOS:
            if (propios / f).is_file():
                texto = (propios / f).read_text(encoding="utf-8")
                if f == "__init__.py":
                    texto = '"""Los pasos propios de BigData Sandbox que el modelo exportado puede usar."""\n'
                z.writestr(f"{raiz}/sandbox_ml/{f}", texto)
        z.writestr(f"{raiz}/modelo.json", json.dumps(ficha(nombre, x, exp), ensure_ascii=False, indent=1, default=str))
        z.writestr(f"{raiz}/servir.py", servir(x))
        z.writestr(f"{raiz}/requirements.txt", requirements(x))
        z.writestr(f"{raiz}/Dockerfile", dockerfile(x))
        z.writestr(f"{raiz}/LEEME.md", leeme(nombre, x))
        if (carpeta / "codigo.py").is_file():
            z.write(carpeta / "codigo.py", f"{raiz}/entrenamiento.py")
    return destino
