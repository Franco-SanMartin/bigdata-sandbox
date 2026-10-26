"""Machine Learning: dataset, recomendación de modelos y entrenamiento (rutas /api/ml/... de ui/API.md).

El entrenamiento corre jobs/entrenar_sklearn.py (con el python3 de la imagen,
en una sola máquina) o jobs/entrenar_spark.py (con spark-submit, en YARN).
Hacen lo mismo que ejemplos/ml/modelos_sklearn.py y modelos_spark.py, pero
solo con el modelo pedido y con el porcentaje para entrenar elegido. Todo lo
que devuelve una corrida está medido en ese momento (reference: false).

Además, cada job deja lo de adentro del modelo (pesos de la red, nodos del árbol,
centros de KMeans, coeficientes: ver jobs/viz.py) en un archivo aparte, que se
lee al terminar y se sirve en GET /api/ml/models/{id}/viz para dibujarlo. El run
solo lleva hasViz: el JSON puede pesar cientos de KB y no viaja por los eventos.

La recomendación es una tabla fija: los tiempos y la memoria esperados son los
que dieron modelos_sklearn.py y modelos_spark.py en la imagen.
"""
from __future__ import annotations

import asyncio
import json
import re
import shlex
import tempfile
from collections import OrderedDict
from pathlib import Path
from typing import Callable

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from . import hdfs as hdfs_mod
from .actions import Action, Run
from .boot import now_ms
from .errors import ApiError
from .events import EventBus
from .yarn import APP_ID, RM

JOBS = Path(__file__).resolve().parent / "jobs"
SENAL_LOCAL = "clientes_senal.csv"
SENAL_HDFS = "/user/root/ml/clientes_senal.csv"
SENAL_ROWS = 20000
COLS = ["antiguedad_meses", "visitas_mes", "ticket_promedio", "reclamos", "edad", "segmento_real",
        "gasto_mes_siguiente", "vuelve"]
MODEL_LABEL = {"lineal": "Regresión lineal", "tonto": "Clasificador tonto (siempre la clase más común)",
               "arbol": "Árbol de decisión", "logistica": "Regresión logística", "mlp": "Red neuronal (MLP)",
               "kmeans": "KMeans"}
TASK_LABEL = {"regresion": "regresión", "clasificacion": "clasificación", "clustering": "agrupamiento (clustering)"}
METRIC = {"regresion": "r2", "clasificacion": "aciertos", "clustering": "rand_ajustado"}
PIPELINE_MODEL = {"regresion": "lineal", "clasificacion": "arbol", "clustering": "kmeans"}
TARGET = {"regresion": "gasto_mes_siguiente", "clasificacion": "vuelve", "clustering": None}
FEATURES = ["antiguedad_meses", "visitas_mes", "ticket_promedio", "reclamos", "edad"]
# KMeans de modelos_sklearn.py agrupa por visitas y ticket: con las cinco columnas
# (antigüedad, reclamos y edad son ruido para los segmentos) los grupos no se parecen.
CLUSTER_FEATURES = ["visitas_mes", "ticket_promedio"]
# Hiperparámetros de modelos_sklearn.py, con los nombres de scikit-learn
DEFAULT_PARAMS: dict[str, dict] = {
    "lineal": {}, "tonto": {"strategy": "most_frequent"}, "arbol": {"max_depth": 3}, "logistica": {"C": 1},
    "mlp": {"hidden_layer_sizes": "16,8", "max_iter": 500}, "kmeans": {"n_clusters": 3, "n_init": 10},
}
CAPAS = re.compile(r"^\s*\d{1,4}(\s*,\s*\d{1,4}){0,4}\s*$")

# Lo que dieron modelos_sklearn.py y modelos_spark.py en la imagen (16.000 filas
# para entrenar, 4.000 para probar). Solo para 'expected' de la recomendación.
SKLEARN = {
    "regresion:lineal": (0.017, 1.5, 0.983), "clasificacion:tonto": (0.002, 0.6, 0.573),
    "clasificacion:arbol": (0.051, 1.2, 0.909), "clasificacion:logistica": (0.044, 1.8, 0.817),
    "clasificacion:mlp": (8.135, 2.1, 0.906), "clustering:kmeans": (0.197, 2.2, 0.827),
}
MLLIB = {
    "regresion:lineal": (19, 3072, 0.983), "clasificacion:arbol": (23, 3072, 0.908),
    "clasificacion:logistica": (22, 3072, 0.816), "clasificacion:mlp": (41, 3072, 0.903),
    "clustering:kmeans": (24, 3072, 0.82),
}
COLUMNS = [
    {"name": "antiguedad_meses", "type": "int", "role": "entrada", "note": "de 1 a 60"},
    {"name": "visitas_mes", "type": "int", "role": "entrada", "note": "depende del segmento"},
    {"name": "ticket_promedio", "type": "int", "role": "entrada", "note": "depende del segmento, con ruido"},
    {"name": "reclamos", "type": "int", "role": "entrada", "note": "de 0 a 5"},
    {"name": "edad", "type": "int", "role": "entrada", "note": "no influye en nada: el modelo tendría que darse cuenta"},
    {"name": "segmento_real", "type": "string", "role": "respuesta",
     "note": "ocasional, frecuente o mayorista: para comparar los grupos de KMeans"},
    {"name": "gasto_mes_siguiente", "type": "int", "role": "objetivo",
     "note": "5000 + 1500·visitas + 0,8·ticket − 1500·reclamos + 50·antigüedad + ruido"},
    {"name": "vuelve", "type": "int", "role": "objetivo",
     "note": "1 si antigüedad ≥ 36, o visitas ≥ 4 y reclamos ≤ 1; 10 % dado vuelta"},
]
TARGETS = [
    {"column": "gasto_mes_siguiente", "task": "regresion", "label": "Cuánto va a gastar el mes que viene"},
    {"column": "vuelve", "task": "clasificacion", "label": "Si vuelve o no"},
    {"column": None, "task": "clustering", "label": "Qué grupos de clientes hay (sin decirle la respuesta)"},
]
STEP = re.compile(r"^== (.*)\|([0-9.]+)$")
RESULT = "@@resultado@@ "
VIZ_MAX_BYTES = 3_500_000    # el job ya recorta a 3 MB (viz.TOPE_BYTES); esto es por las dudas
VIZ_KEEP = 30                # cuántos modelos guardan su viz en memoria (los últimos)


def n(x: int | float) -> str:
    return f"{x:,}".replace(",", ".")


def dec(x: float) -> str:
    return str(x).replace(".", ",")


async def follow(run: Run, tick: Callable[[], None], every: float) -> None:
    """Llama a tick() mientras la acción corre y una vez más al terminar."""
    while run.state == "running":
        tick()
        await asyncio.sleep(every)
    tick()


class Ml:
    # Cada cuánto se mira la salida del job (los tests lo bajan)
    every = 0.3

    def __init__(self, cluster, runner, bus: EventBus, hdfs):
        self.c = cluster
        self.runner = runner
        self.bus = bus
        self.hdfs = hdfs
        self.runs: list[dict] = []
        self._seq = 0
        self._tasks: set[asyncio.Task] = set()
        self.viz: "OrderedDict[str, dict]" = OrderedDict()
        self._viz_dir: Path | None = None

    # ------------------------------------------------------------ util

    @property
    def local(self) -> Path:
        return self.c.s.datos_dir / SENAL_LOCAL

    async def in_hdfs(self) -> bool:
        if not self.c.hdfs.get("available"):
            return False
        try:
            st = await self.hdfs.status_of(SENAL_HDFS)
        except ApiError:
            return False
        return st is not None and st.get("type") == "FILE"

    def _rows(self) -> int:
        try:
            with self.local.open("rb") as fh:
                return max(sum(1 for _ in fh) - 1, 0)
        except OSError:
            return SENAL_ROWS

    # ------------------------------------------------------------ datasets

    async def datasets(self) -> list[dict]:
        in_hdfs = await self.in_hdfs()
        exists = self.local.exists()
        rows = self._rows() if exists else SENAL_ROWS
        sample = hdfs_mod.local_preview(self.local) if exists else None
        if sample:
            sample = {**sample, "total": rows, "format": "csv"}
            sample.pop("note", None)
        else:
            sample = {"columns": COLS, "rows": [], "total": SENAL_ROWS, "format": "csv",
                      "note": "Todavía no se generó: se genera con generar_senal.py al entrenar"}
        return [{"id": "senal", "label": "Clientes con señal (reglas conocidas)",
                 "path": SENAL_HDFS if in_hdfs else str(self.local), "rows": rows,
                 "script": "ejemplos/ml/generar_senal.py", "inHdfs": in_hdfs,
                 "columns": [dict(c) for c in COLUMNS], "targets": [dict(t) for t in TARGETS], "sample": sample}]

    # ------------------------------------------------------------ recomendación

    def recommend(self, dataset: object, task: object) -> dict:
        if dataset != "senal":
            raise ApiError(f"No existe el dataset {dataset}", "not_found")
        if task not in TASK_LABEL:
            raise ApiError("El problema es regresion, clasificacion o clustering", "invalid")

        def ex(engine: str, model: str) -> dict | None:
            r = (SKLEARN if engine == "sklearn" else MLLIB).get(f"{task}:{model}")
            if not r:
                return None
            return {"seconds": r[0], "memoryMb": r[1], "metric": METRIC[str(task)], "value": r[2]}

        def c(model: str, engine: str, fit: str, why: str) -> dict:
            d = {"model": model, "label": MODEL_LABEL[model], "engine": engine, "fit": fit, "why": why}
            e = ex(engine, model)
            if e:
                d["expected"] = e
            return d

        mllib = "Mismo resultado, pero arranca una sesión de Spark en YARN y pide 3 GB: con 20.000 filas es mucho más lento"
        if task == "regresion":
            choices = [c("lineal", "sklearn", "recomendado", "La regla real es una suma de columnas por números fijos: "
                                                             "una recta la encuentra casi exacta"),
                       c("lineal", "mllib", "sirve", mllib)]
            why = "Lo que querés predecir es un número (el gasto): es regresión"
        elif task == "clasificacion":
            choices = [
                c("arbol", "sklearn", "recomendado", "La regla real son umbrales (antigüedad ≥ 36, visitas ≥ 4): es justo "
                                                     "lo que aprende un árbol, y se puede leer"),
                c("mlp", "sklearn", "sirve", "Acierta casi lo mismo que el árbol, pero tarda segundos y no se puede leer qué aprendió"),
                c("logistica", "sklearn", "sirve", 'Separa con una sola recta: la regla real tiene un "o", por eso acierta menos'),
                c("tonto", "sklearn", "línea base", "Contesta siempre la clase más común: cualquier modelo que no le gane no sirve"),
                c("arbol", "mllib", "sirve", mllib),
                c("mlp", "mllib", "sirve", "La misma forma de red con MultilayerPerceptronClassifier (sigmoide en las ocultas); "
                                         "arranca una sesión de Spark en YARN y pide 3 GB"),
            ]
            why = "Lo que querés predecir es una categoría (vuelve o no vuelve): es clasificación"
        else:
            choices = [c("kmeans", "sklearn", "recomendado", "Busca grupos de puntos cercanos. Hay que escalar las columnas "
                                                             "antes: sin escalar, el ticket (miles) tapa todo lo demás"),
                       c("kmeans", "mllib", "sirve", mllib)]
            why = ("No hay una columna para predecir: querés encontrar grupos parecidos, es agrupamiento "
                   "(aprendizaje no supervisado)")
        return {"dataset": "senal", "task": task, "choices": choices, "why": why,
                "engineAdvice": "Con 20.000 filas (menos de 1 MB) todo entra en la memoria de una máquina: scikit-learn "
                                "tarda milisegundos. Spark MLlib conviene cuando los datos no entran en una sola máquina."}

    # ------------------------------------------------------------ entrenamiento

    def check(self, req: dict) -> tuple[str, str, str, int, dict, str | None, list[str]]:
        task, model, engine = req.get("task"), req.get("model"), req.get("engine")
        dataset = req.get("dataset") or "senal"
        if dataset != "senal":
            raise ApiError(f"No existe el dataset {dataset}", "not_found")
        if task not in TASK_LABEL or engine not in ("sklearn", "mllib"):
            raise ApiError("Faltan task (regresion, clasificacion, clustering) y engine (sklearn, mllib)", "invalid")
        table = SKLEARN if engine == "sklearn" else MLLIB
        if f"{task}:{model}" not in table:
            raise ApiError(f"{MODEL_LABEL.get(str(model), model)} no sirve para {TASK_LABEL[task]}"
                           f"{' en Spark MLlib' if engine == 'mllib' else ''}", "unsupported")
        pct = req.get("trainPct", 80)
        if isinstance(pct, bool) or not isinstance(pct, (int, float)) or not 50 <= pct <= 95:
            raise ApiError("El porcentaje para entrenar va de 50 a 95", "invalid")
        self.c.need_running()
        if self.c.config.get("services") != "todo":
            raise ApiError("Machine Learning necesita los servicios completos (Spark y Python)", "unsupported")
        if engine == "mllib":
            self.c.need_proc("rm", "YARN")
            self.c.need_hdfs()
        if any(r["state"] == "running" for r in self.runs):
            raise ApiError("Ya hay un entrenamiento corriendo", "busy")
        target = req["target"] if "target" in req else TARGET[task]
        if target != TARGET[task]:
            raise ApiError("Clustering no usa columna objetivo" if task == "clustering"
                           else f"Para {TASK_LABEL[task]} el objetivo es {TARGET[task]}", "invalid")
        features = req.get("features")
        if features is None:
            features = CLUSTER_FEATURES if task == "clustering" else FEATURES
        if not isinstance(features, list) or not features:
            raise ApiError("Elegí al menos una columna de entrada", "invalid")
        bad = next((f for f in features if f not in FEATURES), None)
        if bad is not None:
            raise ApiError(f"{bad} no se puede usar como entrada", "invalid")
        features = [f for f in FEATURES if f in features]
        params = self.params(str(model), req.get("params"))
        return str(task), str(model), str(engine), int(round(pct)), params, target, features

    @staticmethod
    def params(model: str, given: object) -> dict:
        """Los de modelos_sklearn.py pisados por los que vinieron; invalid si alguno no tiene sentido."""
        if given is None:
            given = {}
        if not isinstance(given, dict):
            raise ApiError("params tiene que ser un objeto", "invalid")
        out = dict(DEFAULT_PARAMS.get(model, {}))
        for k, v in given.items():
            if k not in out:
                raise ApiError(f"{k} no es un parámetro de {MODEL_LABEL.get(model, model)}", "invalid")
            if isinstance(v, bool):
                v = None
            if k == "strategy":
                ok = v in ("most_frequent", "prior", "stratified", "uniform")
            elif k == "hidden_layer_sizes":
                ok = isinstance(v, str) and bool(CAPAS.match(v))
                v = ",".join(x.strip() for x in v.split(",")) if ok else v
            elif k == "C":
                ok = isinstance(v, (int, float)) and 0 < v <= 1000
            else:
                lim = {"max_depth": (1, 30), "max_iter": (10, 5000), "n_clusters": (2, 10), "n_init": (1, 50)}[k]
                if isinstance(v, float) and v.is_integer():
                    v = int(v)
                ok = isinstance(v, int) and lim[0] <= v <= lim[1]
            if not ok:
                raise ApiError(f"{k} = {given[k]} no sirve para {MODEL_LABEL.get(model, model)}", "invalid")
            out[k] = v
        return out

    async def train(self, req: dict, on_end: Callable[[dict], None] | None = None,
                    on_change: Callable[[dict], None] | None = None) -> str:
        task, model, engine, pct, params, target, features = self.check(req)
        sk = engine == "sklearn"
        datos = self.c.s.datos_dir
        gen = None if self.local.exists() and self.local.stat().st_size > 0 else "python3 ejemplos/ml/generar_senal.py"
        rows = self._rows() if not gen else SENAL_ROWS
        train_rows = round(rows * pct / 100)
        if task == "clustering":
            train_rows = rows
        self._seq += 1
        mid = f"m{self._seq}"
        args = [task, model, str(pct), json.dumps(params, ensure_ascii=False), ",".join(features)]
        if sk:
            job = ["python3", str(JOBS / "entrenar_sklearn.py"), SENAL_LOCAL, *args]
            shown = f"python3 entrenar_sklearn.py clientes_senal.csv {shlex.join(args)}"
            steps = [shlex.join(job)]
        else:
            job = ["spark-submit", "--master", "yarn", str(JOBS / "entrenar_spark.py"), f"hdfs://{SENAL_HDFS}", *args]
            shown = f"spark-submit entrenar_spark.py hdfs://{SENAL_HDFS} {shlex.join(args)}"
            steps = []
            if not await self.in_hdfs():
                steps += ["echo '== MLlib lee de HDFS: subiendo clientes_senal.csv|0.02'",
                          "hdfs dfs -mkdir -p /user/root/ml", f"hdfs dfs -put -f {SENAL_LOCAL} /user/root/ml/"]
            steps.append(shlex.join(job))
        if gen:
            steps.insert(0, f"echo '== Generando clientes_senal.csv|0.01' && {gen}")
            shown = f"{gen} && {shown}"
        script = f"set -e\ncd {shlex.quote(str(datos))}\n" + "\n".join(steps)
        test_rows = rows - train_rows
        before = hdfs_mod.local_preview(self.local) if not gen else None
        trace = {
            "command": shown,
            "input": f"clientes_senal.csv · {n(rows)} filas · " + (
                f"{n(train_rows)} para entrenar y {n(test_rows)} para probar" if task != "clustering"
                else "todas para agrupar (no hay respuesta que probar)"),
            "action": f"{MODEL_LABEL[model]} ({TASK_LABEL[task]}) con " +
                      ("scikit-learn, en una sola máquina" if sk else "Spark MLlib, repartido en executors de YARN"),
            "output": "Todavía entrenando",
            "engine": "uno" if sk else "spark",
        }
        if before:
            trace["before"] = {**before, "total": rows, "format": "csv"}
        r: dict = {"id": mid, "task": task, "model": model, "engine": engine, "dataset": "senal", "state": "running",
                   "startedAt": now_ms(), "progress": 0,
                   "message": "Leyendo clientes_senal.csv" if sk else "Pidiendo contenedores a YARN",
                   "trainRows": train_rows, "testRows": test_rows, "metrics": {}, "reference": False,
                   "target": target, "features": list(features), "params": dict(params), "trace": trace}
        self.runs.insert(0, r)
        source = "scikit-learn" if sk else "Spark MLlib"
        run = self.runner.start(Action(
            f"Entrenando {MODEL_LABEL[model]} con {source}", script, display=shown, input=trace["input"],
            action=trace["action"], source="Vos", timeout=1800, env={"SANDBOX_VIZ": str(self.viz_path(mid))}))
        self.emit(r)
        state = {"seen": 0}

        def tick() -> None:
            changed = False
            lines = run.lines
            for line in lines[state["seen"]:]:
                t = line["text"]
                m = STEP.match(t.strip())
                if m:
                    r["message"] = m.group(1)
                    r["progress"] = min(0.95, float(m.group(2)))
                    changed = True
                a = APP_ID.search(t)
                if a and r.get("appId") != a.group(0):
                    r["appId"] = a.group(0)
                    r["trace"]["appIds"] = [r["appId"]]
                    self.bus.publish("yarn", {"appId": r["appId"]})
                    changed = True
            state["seen"] = len(lines)
            if changed and r["state"] == "running":
                self.emit(r)
                if on_change:
                    on_change(r)

        async def watch() -> None:
            await follow(run, tick, self.every)
            await self.finish(r, run, task, model, sk, source)
            if on_end:
                on_end(r)

        t = asyncio.get_running_loop().create_task(watch())
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)
        return mid

    async def finish(self, r: dict, run: Run, task: str, model: str, sk: bool, source: str) -> None:
        res = None
        for line in reversed(run.lines):
            if line["text"].startswith(RESULT):
                try:
                    res = json.loads(line["text"][len(RESULT):])
                except ValueError:
                    res = None
                break
        r["finishedAt"] = now_ms()
        if run.state != "done" or not isinstance(res, dict):
            why = run.error or next((l["text"] for l in reversed(run.lines) if l["stream"] == "err" and l["text"].strip()),
                                    None) or "Falló el entrenamiento"
            r.update(state="failed", error=why, message=why)
            r["trace"]["output"] = why
            self.bus.log(source, "error", f"{MODEL_LABEL[model]}: falló", tech=why, appId=r.get("appId"))
            self.emit(r)
            return
        metrics = {k: v for k, v in (res.get("metrics") or {}).items() if isinstance(v, (int, float))}
        r.update(state="done", progress=1, metrics=metrics)
        for k in ("trainRows", "testRows"):
            if isinstance(res.get(k), int):
                r[k] = res[k]
        if isinstance(res.get("seconds"), (int, float)):
            r["seconds"] = res["seconds"]
        mem = res.get("memoryMb")
        if mem is None and r.get("appId"):
            mem = await self.yarn_mb(r["appId"])
        if isinstance(mem, (int, float)):
            r["memoryMb"] = mem
        for k in ("learned", "confusion", "predictions"):
            if res.get(k):
                r[k] = res[k]
        self.keep_viz(r, res)
        key = METRIC[task]
        val = metrics.get(key)
        r["message"] = f"{key} = {dec(val)}" if val is not None else "Listo"
        out = r["message"]
        if "seconds" in r:
            out += f" · {dec(r['seconds'])} s"
        if "memoryMb" in r:
            out += f" · {n(r['memoryMb']) if float(r['memoryMb']).is_integer() else dec(r['memoryMb'])} MB"
        r["trace"]["output"] = out
        r["trace"]["after"] = {"columns": ["métrica", "valor"], "rows": [[k, v] for k, v in metrics.items()],
                               "note": f"Medido ahora con {n(r['trainRows'])} filas para entrenar y "
                                       f"{n(r['testRows'])} para probar" if task != "clustering"
                               else f"Medido ahora con las {n(r['trainRows'])} filas"}
        self.bus.log(source, "ok", f"{MODEL_LABEL[model]}: {r['message']}", output=out, appId=r.get("appId"))
        self.emit(r)

    def viz_path(self, mid: str) -> Path:
        if self._viz_dir is None:
            self._viz_dir = Path(tempfile.mkdtemp(prefix="sandbox-viz-"))
        return self._viz_dir / f"{mid}.json"

    def keep_viz(self, r: dict, res: dict) -> None:
        """Lee el archivo que dejó el job (si lo dejó) y lo guarda para GET /api/ml/models/{id}/viz."""
        path = self.viz_path(r["id"])
        viz = None
        try:
            if res.get("viz") and path.is_file() and path.stat().st_size <= VIZ_MAX_BYTES:
                viz = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            viz = None
        finally:
            path.unlink(missing_ok=True)
        if isinstance(viz, dict) and viz.get("kind"):
            self.viz[r["id"]] = viz
            while len(self.viz) > VIZ_KEEP:
                old, _ = self.viz.popitem(last=False)
                for x in self.runs:
                    if x["id"] == old:
                        x["hasViz"] = False
            r["hasViz"] = True
        else:
            r["hasViz"] = False
            if res.get("vizError"):
                r["vizError"] = str(res["vizError"])[:300]

    def get_viz(self, mid: str) -> dict:
        if mid not in self.viz:
            raise ApiError(f"El modelo {mid} no tiene nada para dibujar (no existe, falló o es de hace mucho)",
                           "not_found")
        return self.viz[mid]

    async def yarn_mb(self, app_id: str) -> float | None:
        """Memoria promedio que tuvo la aplicación en YARN (memorySeconds / duración)."""
        try:
            status, body = await asyncio.to_thread(self.hdfs.http, f"{RM}/ws/v1/cluster/apps/{app_id}")
            app = (json.loads(body or b"{}").get("app") or {}) if status == 200 else {}
        except (ValueError, AttributeError):
            return None
        ms, secs = app.get("elapsedTime"), app.get("memorySeconds")
        if isinstance(ms, int) and ms > 0 and isinstance(secs, int):
            return round(secs * 1000 / ms)
        return None

    def emit(self, r: dict) -> None:
        self.bus.publish("model", {"run": json.loads(json.dumps(r))})

    def models(self) -> list[dict]:
        return json.loads(json.dumps(self.runs))

    async def wait_all(self) -> None:
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)

    # ------------------------------------------------------------ rutas

    def routes(self) -> list[Route]:
        async def datasets(_: Request) -> JSONResponse:
            return JSONResponse(await self.datasets())

        async def recommend(request: Request) -> JSONResponse:
            b = await hdfs_mod._json(request)
            return JSONResponse(self.recommend(b.get("dataset"), b.get("task")))

        async def train(request: Request) -> JSONResponse:
            b = await hdfs_mod._json(request)
            return JSONResponse({"id": await self.train(b)}, status_code=202)

        async def models(_: Request) -> JSONResponse:
            return JSONResponse(self.models())

        async def viz(request: Request) -> JSONResponse:
            return JSONResponse(self.get_viz(request.path_params["id"]))

        return [
            Route("/api/ml/datasets", datasets, methods=["GET"]),
            Route("/api/ml/recommend", recommend, methods=["POST"]),
            Route("/api/ml/train", train, methods=["POST"]),
            Route("/api/ml/models", models, methods=["GET"]),
            Route("/api/ml/models/{id}/viz", viz, methods=["GET"]),
        ]
