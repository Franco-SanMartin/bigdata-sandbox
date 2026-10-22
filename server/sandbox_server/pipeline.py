"""Pipeline: ventas_sucias.csv de punta a punta (rutas /api/pipeline/... de ui/API.md).

Seis etapas (ingesta, ETL, almacenamiento, análisis, ML y resultados) y en cada
una elegís la herramienta. Cada paso corre de verdad con las CLIs de la imagen
(hdfs, sqoop, python3, spark-submit, spark-sql, beeline, mysql) como una acción
del ActionRunner: lo que imprime queda en la acción y el paso publica eventos
'step' con su avance. Los textos y las validaciones son los del modo demo
(ui/src/api/demo/pipeline.ts); los números salen de lo que corrió.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import shlex
from pathlib import Path
from typing import Awaitable, Callable

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import hdfs as hdfs_mod
from .actions import Action, Run
from .boot import now_ms
from .errors import ApiError
from .events import EventBus
from .ml import MODEL_LABEL, PIPELINE_MODEL, follow
from .yarn import APP_ID, parse_tez_progress

# Los scripts que corren con pandas (jobs/; los tests los cambian por unos falsos)
JOBS = Path(__file__).resolve().parent / "jobs"
SUCIAS = "/user/root/ml/ventas_sucias.csv"
LIMPIAS = "/user/root/ml/ventas_limpias"
RESULTADOS = "/user/root/resultados"
TIENDA_VENTAS = "/user/root/tienda/ventas"
ORDER = ["ingesta", "etl", "almacen", "analisis", "ml", "resultados"]
LABEL = {"ingesta": "Ingesta", "etl": "ETL", "almacen": "Almacenamiento", "analisis": "Análisis",
         "ml": "Machine Learning", "resultados": "Resultados"}
HINT = {"ingesta": "", "etl": "Necesita ventas_sucias.csv en HDFS", "almacen": "Necesita ventas_limpias (lo deja el ETL)",
        "analisis": "Necesita la tabla de Hive o el Parquet", "ml": "Entrena con clientes_senal.csv",
        "resultados": "Necesita un resumen en /user/root/resultados"}
POR = {
    "sucursal": {"label": "Por sucursal", "columns": ["sucursal", "filas", "facturado"]},
    "producto": {"label": "Por producto", "columns": ["producto", "unidades", "facturado"]},
    "mes": {"label": "Por mes", "columns": ["mes", "facturado"]},
    "pago": {"label": "Por medio de pago", "columns": ["medio_pago", "filas", "facturado"]},
}
COL = {"sucursal": "sucursal", "producto": "producto", "mes": "month(fecha)", "pago": "medio_pago"}
SUCIAS_COLS = ["ticket", "fecha", "sucursal", "producto", "cantidad", "precio", "medio_pago"]
LIMPIAS_COLS = ["ticket", "fecha", "sucursal", "producto", "cantidad", "precio", "importe", "medio_pago"]
VENTAS_COLS = ["id", "fecha", "sucursal", "producto", "cantidad", "precio"]
# Tipos de la tabla de Hive según quién escribió el Parquet: pandas (etl_pandas.py)
# o Spark (etl_spark.py). Hive lee el Parquet por nombre de columna y el tipo
# tiene que coincidir con el que quedó en el archivo.
HIVE_TYPES = {
    "pandas": ["BIGINT", "TIMESTAMP", "STRING", "STRING", "BIGINT", "BIGINT", "BIGINT", "STRING"],
    "spark": ["BIGINT", "DATE", "STRING", "STRING", "INT", "BIGINT", "BIGINT", "STRING"],
}
# Claves del resumen que imprimen etl_pandas.py y etl_spark.py -> como se muestran
RESUMEN = {
    "filas leidas": "Filas leídas", "duplicados eliminados": "Duplicados eliminados",
    "fechas en formato dia/mes/año": "Fechas dd/mm/aaaa convertidas",
    "fechas en formato todo junto": 'Fechas "todo junto" convertidas',
}
STEP = re.compile(r"^== (.*)\|([0-9.]+)$")
MR = re.compile(r"\bmap (\d+)% reduce (\d+)%")
SPARK_STATE = re.compile(r"\(state: (ACCEPTED|RUNNING)\)")
SPARK_TASK = re.compile(r"Finished task \S+ in stage (\d+)\.\d+ .*\((\d+)/(\d+)\)")
RETRIEVED = re.compile(r"Retrieved (\d+) records")
EXPORTED = re.compile(r"Exported (\d+) records")
ERR = re.compile(r"ERROR|Error|Exception|FAILED|Traceback|No such file|not found", re.I)
MESES = ["", "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre",
         "noviembre", "diciembre"]


def n(x: int | float) -> str:
    return f"{x:,}".replace(",", ".")


def sql(por: str) -> str:
    k = COL[por]
    agg = "SUM(cantidad) AS unidades" if por == "producto" else "" if por == "mes" else "COUNT(*) AS filas"
    return f"SELECT {k}{', ' + agg if agg else ''}, SUM(importe) AS facturado FROM ventas_limpias GROUP BY {k} ORDER BY facturado DESC"


def por_opt() -> dict:
    return {"id": "por", "label": "Agrupar por", "kind": "select", "default": "producto",
            "choices": [{"value": k, "label": v["label"]} for k, v in POR.items()]}


def parse_resumen(lines: list[str]) -> list[list[str]]:
    """Las líneas entre '=== RESUMEN DEL ETL ===' y '=== POR SUCURSAL ===' como [paso, número]."""
    out: list[list[str]] = []
    inside = False
    for t in lines:
        if t.startswith("=== RESUMEN DEL ETL"):
            inside, out = True, []
            continue
        if t.startswith("=== "):
            inside = False
            continue
        if not inside:
            continue
        m = re.match(r"^\s+(.+?)\s{2,}(-?\d+)\s*$", t)
        if not m:
            continue
        key, val = m.group(1).strip(), int(m.group(2))
        if key == "facturado total":
            out.append(["Facturado total", f"$ {n(val)}"])
            continue
        label = RESUMEN.get(key) or key[0].upper() + key[1:]
        label = label.replace("->", "→").replace("/100", "÷100")
        out.append([label, n(val)])
    return out


def resumen_rows(summary: list[list[str]], key: str) -> int | None:
    for k, v in summary:
        if k == key:
            try:
                return int(v.replace(".", ""))
            except ValueError:
                return None
    return None


def marked(run: Run, mark: str) -> list[str]:
    """Las líneas de salida que vienen después de '@@mark@@' (hasta la próxima marca)."""
    out: list[str] = []
    inside = False
    for line in run.lines:
        if line["stream"] != "out":
            continue
        t = line["text"]
        if t.startswith("@@") and t.rstrip().endswith("@@"):
            inside = t.strip() == f"@@{mark}@@"
            continue
        if inside:
            out.append(t)
    return out


def why_failed(run: Run) -> str:
    err = [l["text"].strip() for l in run.lines if l["stream"] == "err" and l["text"].strip()]
    pick = next((t for t in reversed(err) if ERR.search(t)), None) or (err[-1] if err else None)
    return run.error or pick or f"Terminó con código {run.exitCode}"


def csv_rows(lines: list[str], por: str) -> list[list]:
    rows = []
    for t in lines:
        t = t.strip()
        if not t:
            continue
        cells = [hdfs_mod._cell(c) for c in t.split(",")]
        if len(cells) != len(POR[por]["columns"]):
            continue
        if por == "mes" and isinstance(cells[0], int) and 0 < cells[0] < 13:
            cells[0] = MESES[cells[0]]
        rows.append(cells)
    rows.sort(key=lambda r: -(r[-1] if isinstance(r[-1], (int, float)) else 0))
    return rows


class Pipeline:
    # Cada cuánto se mira la salida del paso (los tests lo bajan)
    every = 0.3

    def __init__(self, cluster, runner, bus: EventBus, hdfs, datos=None, ml=None):
        self.c = cluster
        self.runner = runner
        self.bus = bus
        self.hdfs = hdfs
        self.datos = datos
        self.ml = ml
        self.runs: list[dict] = []
        self._seq = 0
        self._tasks: set[asyncio.Task] = set()

    # ------------------------------------------------------------ util

    @property
    def dir(self):
        return self.c.s.datos_dir

    def proc_up(self, pid: str) -> bool:
        return any(p["id"] == pid and p["state"] == "up" for p in self.c.processes)

    @staticmethod
    def sqoop_env() -> dict[str, str]:
        """Usuario de MySQL para Sqoop (el que crea el entrypoint de la imagen; se cambia por variable)."""
        return {"SQOOP_USER": os.environ.get("SANDBOX_SQOOP_USER", "alumno"),
                "SQOOP_PASS": os.environ.get("SANDBOX_SQOOP_PASS", "alumno")}

    async def listing(self, path: str) -> list[dict]:
        try:
            st = await self.hdfs.webhdfs(path, "LISTSTATUS")
        except ApiError:
            return []
        return ((st or {}).get("FileStatuses") or {}).get("FileStatus") or []

    async def ready(self, path: str) -> bool:
        """Está en HDFS y terminó de escribirse (si es carpeta: tiene algún archivo con datos)."""
        if not self.c.hdfs.get("available"):
            return False
        try:
            st = await self.hdfs.status_of(path)
        except ApiError:
            return False
        if st is None:
            return False
        if st.get("type") == "FILE":
            return True
        return any(f.get("type") == "FILE" and not f["pathSuffix"].startswith(("_", "."))
                   and not f["pathSuffix"].endswith(hdfs_mod.COPYING) for f in await self.listing(path))

    async def size_mb(self, path: str) -> float | None:
        try:
            cs = await self.hdfs.webhdfs(path, "GETCONTENTSUMMARY")
        except ApiError:
            return None
        length = ((cs or {}).get("ContentSummary") or {}).get("length")
        return round(length / hdfs_mod.MB, 2) if isinstance(length, int) else None

    async def hive_table(self) -> bool:
        if self.datos is None:
            return False
        try:
            rc, out, _ = await self.datos.exec(self.datos.beeline("SHOW TABLES IN default LIKE 'ventas_limpias'"))
        except ApiError:
            return False
        return rc == 0 and any(l.strip() == "ventas_limpias" for l in out.splitlines())

    def local_rows(self, name: str) -> int | None:
        try:
            with (self.dir / name).open("rb") as fh:
                return max(sum(1 for _ in fh) - 1, 0)
        except OSError:
            return None

    # ------------------------------------------------------------ catálogo

    def catalog(self) -> list[dict]:
        run = self.c.phase == "running"
        todo = self.c.config.get("services") == "todo"
        off = "" if run else "El cluster está apagado"
        need_todo = off or ("" if todo else "Necesita los servicios completos (Spark, Hive y Python)")
        need_yarn = off or ("" if self.proc_up("rm") else "YARN está apagado")
        mysql = "" if self.proc_up("mysql") else "MySQL está apagado"
        hs2 = "" if self.proc_up("hiveserver2") else "HiveServer2 está apagado"
        hdfs_down = "" if self.c.hdfs.get("available") else "HDFS no responde"
        q = sql("producto")

        def t(why: str, options: list | None = None, **x) -> dict:
            d = {**x, "options": options or []}
            d["available"] = not why
            if why:
                d["unavailableReason"] = why
            return d

        senal_task = [{"value": "regresion", "label": "Regresión: cuánto gasta"},
                      {"value": "clasificacion", "label": "Clasificación: si vuelve"},
                      {"value": "clustering", "label": "Agrupamiento: qué grupos hay"}]
        mllib_task = [{"value": "regresion", "label": "Regresión"}, {"value": "clasificacion", "label": "Clasificación"},
                      {"value": "clustering", "label": "Agrupamiento"}]
        return [
            {"stage": "ingesta", "label": LABEL["ingesta"], "description": "Traer los datos crudos a HDFS",
             "needs": "Nada: es el principio", "input": "ventas_sucias.csv en la carpeta local",
             "output": f"{SUCIAS} en HDFS", "tools": [
                t(off or hdfs_down, id="put", label="hdfs dfs -put", engine="hdfs", recommended=True,
                  command="hdfs dfs -put -f /datos/ventas_sucias.csv /user/root/ml/",
                  whenToUse="El dato ya es un archivo (un CSV que te pasaron): se copia tal cual, cortado en bloques",
                  whenNot="Si el dato vive en una base: ahí conviene Sqoop"),
                t(need_yarn or mysql, [{"id": "mappers", "label": "Mappers (-m)", "kind": "number", "default": 4,
                                        "min": 1, "max": 8, "help": "Cuántas partes de la tabla se leen a la vez"}],
                  id="sqoop", label="Sqoop import (MySQL → HDFS)", engine="mr", script="ejemplos/sqoop.sh",
                  command="sqoop import --connect jdbc:mysql://localhost/tienda --table ventas -m 4 "
                          "--target-dir /user/root/tienda/ventas",
                  whenToUse="El dato está en una base relacional: Sqoop lanza un MapReduce con 4 mappers que leen "
                            "la tabla en paralelo",
                  whenNot="Para este pipeline: la tabla ventas de MySQL ya está limpia, no pasa por el ETL. Sirve "
                          "para consultarla con Hive en Datos"),
            ]},
            {"stage": "etl", "label": LABEL["etl"],
             "description": "Limpiar: fechas en tres formatos, precios con coma, duplicados, faltantes",
             "needs": "ventas_sucias.csv (lo deja la ingesta)", "input": "ventas_sucias.csv · csv",
             "output": f"{LIMPIAS} · Parquet", "tools": [
                t(need_todo, id="pandas", label="pandas", engine="uno", recommended=True,
                  script="ejemplos/ml/etl_pandas.py",
                  command="python3 ejemplos/ml/etl_pandas.py && hdfs dfs -put -f ventas_limpias.parquet "
                          "/user/root/ml/ventas_limpias/",
                  whenToUse="4,5 MB entran de sobra en la memoria de una máquina: pandas lo limpia en un par de "
                            "segundos y sin YARN",
                  whenNot="Cuando el archivo no entra en la memoria de una máquina (decenas de GB)"),
                t(need_todo or need_yarn, id="pyspark", label="PySpark", engine="spark",
                  script="ejemplos/ml/etl_spark.py", command="spark-submit ejemplos/ml/etl_spark.py",
                  whenToUse="Los mismos pasos que pandas, repartidos en executors de YARN: es lo que escala a "
                            "datos grandes",
                  whenNot="Con 4,5 MB tarda mucho más que pandas: la sesión de Spark sola lleva 15 segundos"),
                t("No hay un script de ETL para ventas_sucias en la imagen", id="pig", label="Pig", engine="mr",
                  command="pig -x mapreduce etl.pig",
                  whenToUse="Pipelines de transformación escritos en Pig Latin, sobre MapReduce",
                  whenNot="Hoy casi no se usa: Spark lo reemplazó"),
                t("No hay un script de ETL para ventas_sucias en la imagen", id="hive", label="Hive (INSERT … SELECT)",
                  engine="tez", command="beeline -f etl.hql", whenToUse="Limpiezas que se escriben bien en SQL",
                  whenNot="Las fechas en tres formatos y los precios con coma piden lógica que en SQL queda ilegible"),
            ]},
            {"stage": "almacen", "label": LABEL["almacen"],
             "description": "Dejar el dato limpio en un formato que se pueda consultar",
             "needs": "ventas_limpias en HDFS (lo deja el ETL)", "input": f"{LIMPIAS} · Parquet",
             "output": "tabla default.ventas_limpias o los Parquet", "tools": [
                t(need_todo or hs2, id="hivetab", label="Tabla externa de Hive", engine="uno", recommended=True,
                  command=f"beeline -e \"CREATE EXTERNAL TABLE ventas_limpias (…) STORED AS PARQUET LOCATION '{LIMPIAS}'\"",
                  whenToUse="Para consultarlo con SQL: Hive anota en el Metastore dónde están los archivos y qué "
                            "columnas tienen, sin moverlos",
                  whenNot="Si solo lo vas a leer desde Spark o pandas: alcanza con los archivos"),
                t(off, id="parquet", label="Archivos Parquet en HDFS", engine="hdfs", command=f"hdfs dfs -ls {LIMPIAS}",
                  whenToUse="Parquet guarda por columna y comprimido: Spark y pandas leen solo las columnas que usan",
                  whenNot="Si querés SQL desde Hive: le falta la tabla"),
            ]},
            {"stage": "analisis", "label": LABEL["analisis"],
             "description": "Resumir: facturado por sucursal, producto, mes o medio de pago",
             "needs": "ventas_limpias como tabla de Hive (Hive) o como Parquet (Spark SQL, pandas)",
             "input": "ventas_limpias · tabla o Parquet", "output": "/user/root/resultados/por_<campo>", "tools": [
                t(need_todo or need_yarn or hs2, [por_opt()], id="hive", label="Hive", engine="tez", recommended=True,
                  command=f'beeline -e "{q}"',
                  whenToUse="SQL de siempre sobre archivos de HDFS: HiveServer2 lo convierte en un trabajo Tez",
                  whenNot="Para algo interactivo y chico: arrancar el trabajo Tez lleva unos segundos"),
                t(need_todo or need_yarn, [por_opt()], id="sparksql", label="Spark SQL", engine="spark",
                  command=f'spark-sql -e "{q}"',
                  whenToUse="El mismo SQL, en executors de Spark: conviene si después seguís con Spark (ML, más "
                            "transformaciones)",
                  whenNot="Para una sola consulta chica: la sesión de Spark tarda más que la consulta"),
                t(need_todo, [por_opt()], id="pandas", label="pandas", engine="uno", script="ejemplos/ml/etl_pandas.py",
                  command="python3 -c \"import pandas as pd; pd.read_parquet('ventas_limpias.parquet')"
                          ".groupby('producto').importe.sum()\"",
                  whenToUse="97.200 filas entran en memoria: groupby tarda milisegundos",
                  whenNot="Cuando los datos no entran en una máquina"),
            ]},
            {"stage": "ml", "label": LABEL["ml"],
             "description": "Entrenar un modelo. Usa clientes_senal.csv: en las ventas no hay nada que predecir con señal",
             "needs": "Los servicios completos (Python y Spark)", "input": "clientes_senal.csv (rama aparte del pipeline)",
             "output": "un modelo con sus métricas", "tools": [
                t(need_todo, [{"id": "task", "label": "Problema", "kind": "select", "default": "regresion",
                               "choices": senal_task}],
                  id="sklearn", label="scikit-learn", engine="uno", recommended=True,
                  script="ejemplos/ml/modelos_sklearn.py", command="python3 ejemplos/ml/modelos_sklearn.py",
                  whenToUse="20.000 filas: entrena en milisegundos en una máquina",
                  whenNot="Cuando los datos no entran en memoria"),
                t(need_todo or need_yarn, [{"id": "task", "label": "Problema", "kind": "select", "default": "regresion",
                                            "choices": mllib_task}],
                  id="mllib", label="Spark MLlib", engine="spark", script="ejemplos/ml/modelos_spark.py",
                  command="spark-submit ejemplos/ml/modelos_spark.py",
                  whenToUse="Los mismos modelos, repartidos en executors: para datos que no entran en una máquina",
                  whenNot="Con 20.000 filas: pide 3 GB a YARN y tarda mucho más"),
            ]},
            {"stage": "resultados", "label": LABEL["resultados"],
             "description": "Llevar el resumen a donde se usa: un CSV o una tabla de MySQL",
             "needs": "Un resumen en /user/root/resultados (lo deja el análisis)",
             "input": "/user/root/resultados/por_<campo>", "output": "un CSV local o tienda.resumen_<campo>", "tools": [
                t(off, [por_opt()], id="getmerge", label="hdfs dfs -getmerge", engine="hdfs", recommended=True,
                  command="hdfs dfs -getmerge /user/root/resultados/por_producto por_producto.csv",
                  whenToUse="Junta las partes del resultado en un solo CSV local, para abrirlo en una planilla",
                  whenNot="Si el resultado lo tiene que leer otra aplicación desde una base"),
                t(need_yarn or mysql, [por_opt()], id="mysql", label="Sqoop export (HDFS → MySQL)", engine="mr",
                  script="ejemplos/sqoop.sh",
                  command="sqoop export --connect jdbc:mysql://localhost/tienda --table resumen_producto "
                          "--export-dir /user/root/resultados/por_producto -m 1",
                  whenToUse="El resumen lo consume una aplicación que lee MySQL",
                  whenNot="Para mirarlo una vez: getmerge es inmediato"),
            ]},
        ]

    # ------------------------------------------------------------ estado

    def last(self, stage: str) -> dict | None:
        return next((r for r in self.runs if r["stage"] == stage), None)

    def state(self) -> dict:
        stages = []
        for stage in ORDER:
            r = self.last(stage)
            s = {"stage": stage, "label": LABEL[stage], "state": r["state"] if r else "pending"}
            if r:
                s.update(stepId=r["id"], tool=r["tool"], engine=r["engine"])
            stages.append(s)
        running = next((r for r in self.runs if r["state"] == "running"), None)
        first_pending = next((s for s in stages if s["state"] != "done"), None)
        current = running["stage"] if running else first_pending["stage"] if first_pending else "resultados"
        i = ORDER.index(current)
        nxt = ORDER[i + 1] if (running or first_pending) and i + 1 < len(ORDER) else None
        last_out = next((r for r in self.runs if r["state"] == "done" and r.get("output") and r["stage"] != "ml"), None)
        dataset = None
        if last_out:
            o = last_out["output"]
            path = o["path"]
            fmt = ("parquet" if re.search(r"parquet|limpias", path) else
                   "tabla MySQL" if re.search(r"resumen_|tienda\.", path) else "csv")
            dataset = {"path": path, "format": fmt}
            for k in ("rows", "sizeMb"):
                if o.get(k) is not None:
                    dataset[k] = o[k]
        return {
            "stages": stages, "current": current,
            "next": {"stage": nxt, "hint": HINT[nxt]} if nxt else None,
            "working": {"engine": running["engine"], "stepId": running["id"], "message": running["message"]}
            if running else None,
            "dataset": dataset,
        }

    def steps(self) -> list[dict]:
        return json.loads(json.dumps(self.runs))

    def reset(self) -> None:
        if any(r["state"] == "running" for r in self.runs):
            raise ApiError("Hay un paso corriendo: esperá a que termine", "busy")
        self.runs = []
        self.bus.log("Vos", "info", "Pipeline reiniciado", action="Vuelve a la primera etapa",
                     output="Lo que hay en HDFS queda como estaba")
        self.bus.publish("step", {})

    def emit(self, r: dict) -> None:
        self.bus.publish("step", {"step": json.loads(json.dumps(r))})

    # ------------------------------------------------------------ correr un paso

    async def run(self, req: dict) -> str:
        stage, tool_id = req.get("stage"), req.get("tool")
        info = next((s for s in self.catalog() if s["stage"] == stage), None)
        tool = next((t for t in info["tools"] if t["id"] == tool_id), None) if info else None
        if not info or not tool:
            raise ApiError(f"No existe la herramienta {tool_id} en {stage}", "not_found")
        self.c.need_running()
        if not tool["available"]:
            raise ApiError(tool.get("unavailableReason") or "No se puede usar ahora", "unsupported")
        if any(r["state"] == "running" for r in self.runs):
            raise ApiError("Ya hay un paso corriendo", "busy")
        given = req.get("options") or {}
        if not isinstance(given, dict):
            raise ApiError("options tiene que ser un objeto", "invalid")
        o = {x["id"]: x["default"] for x in tool["options"]}
        o.update(given)
        for x in tool["options"]:
            if x["kind"] != "number":
                continue
            v = o[x["id"]]
            lo, hi = x.get("min", 0), x.get("max", 9999)
            if isinstance(v, bool) or not isinstance(v, (int, float)) or v != int(v) or not lo <= v <= hi:
                raise ApiError(f"{x['label']} tiene que ser un número de {lo} a {hi}", "invalid")
            o[x["id"]] = int(v)
        por = str(o.get("por") or "producto")
        if any(x["id"] == "por" for x in tool["options"]) and por not in POR:
            raise ApiError(f"No se puede agrupar por {por}", "invalid")
        key = f"{stage}:{tool_id}"
        # Lo que tiene que existir antes
        if key == "etl:pyspark" and not await self.ready(SUCIAS):
            raise ApiError("PySpark lee de HDFS: primero subí ventas_sucias.csv (Ingesta → hdfs dfs -put)", "invalid")
        if stage == "almacen" and not await self.ready(LIMPIAS):
            raise ApiError("Primero limpiá los datos (ETL): no hay nada en /user/root/ml/ventas_limpias", "invalid")
        if key == "analisis:hive" and not await self.hive_table():
            raise ApiError("Hive necesita la tabla: Almacenamiento → tabla externa de Hive", "invalid")
        if stage == "analisis" and tool_id != "hive" and not await self.ready(LIMPIAS):
            raise ApiError("Primero limpiá los datos (ETL)", "invalid")
        if stage == "resultados" and not await self.ready(f"{RESULTADOS}/por_{por}"):
            raise ApiError(f"No hay un resumen por {por}: corré Análisis agrupando por {por}", "invalid")
        if stage in ("ingesta", "resultados") or tool_id == "parquet":
            self.c.need_hdfs()
        if stage == "ml":
            task = str(o.get("task") or "regresion")
            if task not in PIPELINE_MODEL:
                raise ApiError(f"No existe el problema {task}", "invalid")

        self._seq += 1
        r: dict = {"id": f"p{self._seq}", "stage": stage, "tool": tool_id, "engine": tool["engine"], "state": "running",
                   "startedAt": now_ms(), "progress": 0, "message": "Arrancando", "appIds": []}
        r["trace"] = {"command": tool["command"], "input": "—", "action": tool["label"], "output": "Todavía corriendo",
                      "engine": tool["engine"]}
        go = getattr(self, "_" + key.replace(":", "_"), None)
        if go is None:
            raise ApiError(f"{tool['label']} no se puede correr", "unsupported")
        await go(r, info, tool, o, por)
        self.runs.insert(0, r)
        self.emit(r)
        return r["id"]

    def launch(self, r: dict, info: dict, tool: dict, script: str, display: str,
               done: Callable[[Run], Awaitable[tuple[dict, str, dict | None]]],
               env: dict[str, str] | None = None, timeout: float = 1800) -> None:
        """Corre el script (bash) como acción y sigue su salida hasta que termina."""
        r["trace"]["command"] = display
        run = self.runner.start(Action(
            f"Pipeline · {info['label']}: {tool['label']}", "set -eo pipefail\n" + script, display=display,
            input=r["trace"]["input"], action=r["trace"]["action"], source="Vos", env=env, cwd=str(self.dir),
            timeout=timeout))
        seen = {"n": 0}

        def tick() -> None:
            if r["state"] != "running":
                return
            changed = False
            lines = run.lines
            for line in lines[seen["n"]:]:
                t = line["text"]
                m = STEP.match(t.strip())
                if m:
                    r["message"], r["progress"] = m.group(1), max(r["progress"], min(0.95, float(m.group(2))))
                    changed = True
                    continue
                a = APP_ID.search(t)
                if a and a.group(0) not in r["appIds"]:
                    r["appIds"].append(a.group(0))
                    r["message"] = "Esperando contenedores de YARN"
                    self.bus.publish("yarn", {"appId": a.group(0)})
                    changed = True
                p = None
                mr = MR.search(t)
                if mr:
                    p = int(mr.group(1)) / 100 if int(mr.group(2)) == 0 else (int(mr.group(1)) + int(mr.group(2))) / 200
                tez = parse_tez_progress([t])
                if tez:
                    total = sum(v["total"] for v in tez)
                    p = sum(v["done"] for v in tez) / total if total else 0
                ss = SPARK_STATE.search(t)
                if ss and r["appIds"]:
                    if ss.group(1) == "ACCEPTED":
                        r["message"] = "Arrancando el ApplicationMaster"
                    elif not r["message"].startswith("Corriendo en YARN"):
                        r["message"] = "Corriendo en YARN"
                    changed = True
                st = SPARK_TASK.search(t)
                if st and r["appIds"]:
                    r["message"] = f"Corriendo en YARN (stage {st.group(1)}: {st.group(2)}/{st.group(3)} tareas)"
                    changed = True
                if p is not None and r["appIds"]:
                    r["progress"] = max(r["progress"], min(0.95, 0.1 + 0.85 * p))
                    r["message"] = "Arrancando el ApplicationMaster" if p < 0.05 else f"Corriendo en YARN ({round(p * 100)} %)"
                    changed = True
            seen["n"] = len(lines)
            if changed:
                self.emit(r)

        async def watch() -> None:
            await follow(run, tick, self.every)
            if r["state"] != "running":
                return
            if run.state != "done":
                self.fail(r, info, tool, why_failed(run))
                return
            try:
                out, msg, after = await done(run)
            except ApiError as e:
                self.fail(r, info, tool, str(e))
                return
            except Exception as e:  # noqa: BLE001 - lo que no se pudo leer de la salida queda como error del paso
                self.fail(r, info, tool, f"No se pudo leer lo que dejó: {e}")
                return
            self.finish(r, info, tool, out, msg, after)

        self.spawn(watch())

    def spawn(self, coro) -> None:
        t = asyncio.get_running_loop().create_task(coro)
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)

    def finish(self, r: dict, info: dict, tool: dict, out: dict, msg: str, after: dict | None) -> None:
        if r["state"] != "running":
            return
        r.update(state="done", progress=1, finishedAt=now_ms(), output=out, message=msg)
        r["trace"]["output"] = msg
        if after is not None:
            r["trace"]["after"] = after
        if r["appIds"]:
            r["trace"]["appIds"] = list(r["appIds"])
        self.bus.log(tool["label"], "ok", f"{info['label']}: {msg}", output=out.get("path"))
        self.emit(r)

    def fail(self, r: dict, info: dict, tool: dict, why: str) -> None:
        if r["state"] != "running":
            return
        r.update(state="failed", error=why, message=why, finishedAt=now_ms())
        r["trace"]["output"] = why
        if r["appIds"]:
            r["trace"]["appIds"] = list(r["appIds"])
        self.bus.log(tool["label"], "error", f"{info['label']}: {why}")
        self.emit(r)

    def hdfs_changed(self, path: str) -> None:
        self.bus.publish("hdfs", {"path": path})

    # ------------------------------------------------------------ ingesta

    async def _ingesta_put(self, r, info, tool, o, por) -> None:
        ex = hdfs_mod.EXAMPLES["sucias"]
        local = self.dir / ex["local"]
        rows = self.local_rows(ex["local"]) if local.exists() else None
        r["trace"]["input"] = (f"{local} · {n(rows)} filas · {hdfs_mod.fmt_mb(hdfs_mod.mb(local.stat().st_size))}"
                               if rows is not None else f"{local} · se genera con {ex['script']}")
        r["trace"]["action"] = "Lo corta en bloques y cada bloque viaja por la tubería de DataNodes"
        script = (f"[ -s {ex['local']} ] || {{ echo '== Generando {ex['local']}|0.05'; {ex['gen']}; }}\n"
                  f"echo '== Subiendo {ex['local']} a HDFS|0.3'\n"
                  "hdfs dfs -mkdir -p /user/root/ml\n"
                  f"hdfs dfs -put -f {ex['local']} /user/root/ml/\n")

        async def done(run: Run):
            total = self.local_rows(ex["local"]) or 0
            size = hdfs_mod.mb(local.stat().st_size)
            self.hdfs_changed(SUCIAS)
            sample = hdfs_mod.local_preview(local) or {"columns": SUCIAS_COLS, "rows": []}
            after = {**sample, "total": total, "format": "csv"}
            after.pop("note", None)
            return {"path": SUCIAS, "rows": total, "sizeMb": size}, f"{n(total)} filas en {SUCIAS}", after

        self.launch(r, info, tool, script, f"hdfs dfs -put -f {local} /user/root/ml/", done)

    async def _ingesta_sqoop(self, r, info, tool, o, por) -> None:
        m = o["mappers"]  # run() ya lo validó contra min y max
        r["trace"]["input"] = "MySQL tienda.ventas"
        r["trace"]["action"] = f"MapReduce sin reduce: {m} mappers leen la tabla por rangos de id y escriben en HDFS"
        cmd = (f'sqoop import --connect jdbc:mysql://localhost/tienda --username "$SQOOP_USER" --password "$SQOOP_PASS" '
               f"--table ventas -m {m} --target-dir {TIENDA_VENTAS} --delete-target-dir")
        script = (f"echo '== sqoop import: tienda.ventas con {m} mappers|0.05'\n{cmd}\n"
                  "echo @@muestra@@\n"
                  f"{{ hdfs dfs -cat {TIENDA_VENTAS}/part-m-00000 | head -n 5; }} || true\n")

        async def done(run: Run):
            got = [int(x.group(1)) for l in run.lines for x in [RETRIEVED.search(l["text"])] if x]
            rows = got[-1] if got else 0
            parts = [f for f in await self.listing(TIENDA_VENTAS) if f["pathSuffix"].startswith("part-m-")]
            size = await self.size_mb(TIENDA_VENTAS)
            self.hdfs_changed(TIENDA_VENTAS)
            sample = [[hdfs_mod._cell(c) for c in l.split(",")] for l in marked(run, "muestra") if l.strip()]
            out = {"path": TIENDA_VENTAS, "rows": rows}
            if size is not None:
                out["sizeMb"] = size
            return (out, f"{n(rows)} filas en {len(parts) or m} archivos part-m",
                    {"columns": VENTAS_COLS, "rows": sample, "total": rows,
                     "note": "Ya vienen limpias de MySQL: consultalas con Hive en Datos (tienda_ventas)"})

        self.launch(r, info, tool, script, cmd, done, env=self.sqoop_env())

    # ------------------------------------------------------------ ETL

    def _etl_after(self, run: Run, total: int | None) -> dict:
        lines = marked(run, "muestra")
        try:
            d = json.loads(lines[0]) if lines else {}
        except ValueError:
            d = {}
        s = {"columns": d.get("columns") or LIMPIAS_COLS, "rows": d.get("data") or [], "format": "parquet"}
        if total is not None:
            s["total"] = total
        if not s["rows"]:
            s["note"] = "Parquet es binario y columnar: miralo con Hive en Datos"
        return s

    async def _etl_pandas(self, r, info, tool, o, por) -> None:
        ex = hdfs_mod.EXAMPLES["sucias"]
        rows = self.local_rows(ex["local"])
        r["trace"]["input"] = (f"{self.dir / ex['local']} · {n(rows)} filas (lo lee de la carpeta local, no de HDFS)"
                               if rows is not None else f"{self.dir / ex['local']} · se genera con {ex['script']}")
        r["trace"]["action"] = ("Saca duplicados, unifica fechas y precios, descarta cantidades imposibles y completa "
                                "faltantes")
        before = hdfs_mod.local_preview(self.dir / ex["local"])
        if before:
            r["trace"]["before"] = {**before, "total": rows, "format": "csv"}
            r["trace"]["before"].pop("note", None)
        script = (f"[ -s {ex['local']} ] || {{ echo '== Generando {ex['local']}|0.05'; {ex['gen']}; }}\n"
                  "echo '== Limpiando con pandas: fechas, precios, duplicados y faltantes|0.15'\n"
                  "python3 ejemplos/ml/etl_pandas.py\n"
                  "echo '== Guardando ventas_limpias.parquet|0.8'\n"
                  f"python3 {shlex.quote(str(JOBS / 'parquet_para_hive.py'))} ventas_limpias.parquet\n"
                  "echo '== hdfs dfs -put ventas_limpias.parquet|0.9'\n"
                  f"hdfs dfs -rm -r -f -skipTrash {LIMPIAS} >/dev/null\n"
                  f"hdfs dfs -mkdir -p {LIMPIAS}\n"
                  f"hdfs dfs -put -f ventas_limpias.parquet {LIMPIAS}/\n")

        async def done(run: Run):
            summary = parse_resumen([l["text"] for l in run.lines if l["stream"] == "out"])
            total = resumen_rows(summary, "Filas limpias")
            size = await self.size_mb(LIMPIAS)
            if size is None:
                size = hdfs_mod.mb((self.dir / "ventas_limpias.parquet").stat().st_size)
            read = resumen_rows(summary, "Filas leídas")
            self.hdfs_changed(LIMPIAS)
            out = {"path": LIMPIAS, "rows": total, "sizeMb": size, "summary": summary}
            msg = (f"{n(read)} → {n(total)} filas, en Parquet" if read is not None and total is not None
                   else "Listo, en Parquet")
            return {k: v for k, v in out.items() if v is not None}, msg, self._etl_after(run, total)

        self.launch(r, info, tool, script, tool["command"], done)

    async def _etl_pyspark(self, r, info, tool, o, por) -> None:
        r["trace"]["input"] = SUCIAS
        r["trace"]["action"] = "Los mismos arreglos que pandas, en executors de Spark; escribe Parquet en HDFS"
        r["trace"]["before"] = {"columns": SUCIAS_COLS, "rows": [], "format": "csv",
                                "note": "Fechas en tres formatos, productos en mayúsculas, precios con coma y medios "
                                        "de pago escritos de varias formas"}
        script = ("echo '== spark-submit etl_spark.py: pidiendo contenedores a YARN|0.05'\n"
                  "spark-submit --master yarn ejemplos/ml/etl_spark.py\n")

        async def done(run: Run):
            summary = parse_resumen([l["text"] for l in run.lines if l["stream"] == "out"])
            total = resumen_rows(summary, "Filas limpias")
            read = resumen_rows(summary, "Filas leídas")
            parts = [f for f in await self.listing(LIMPIAS) if f["pathSuffix"].endswith(".parquet")]
            size = await self.size_mb(LIMPIAS)
            self.hdfs_changed(LIMPIAS)
            out = {"path": LIMPIAS, "rows": total, "sizeMb": size, "summary": summary}
            k = len(parts)
            msg = (f"{n(read)} → {n(total)} filas, en {k} archivo{'s' if k != 1 else ''} Parquet"
                   if read is not None and total is not None else "Listo, en Parquet")
            return {k2: v for k2, v in out.items() if v is not None}, msg, self._etl_after(run, total)

        self.launch(r, info, tool, script, tool["command"], done)

    # ------------------------------------------------------------ almacenamiento

    async def writer(self) -> str:
        """Quién escribió el Parquet: pandas deja ventas_limpias.parquet, Spark deja part-*.parquet."""
        names = [f["pathSuffix"] for f in await self.listing(LIMPIAS)]
        return "pandas" if "ventas_limpias.parquet" in names else "spark"

    async def _almacen_hivetab(self, r, info, tool, o, por) -> None:
        who = await self.writer()
        cols = ", ".join(f"{c} {t}" for c, t in zip(LIMPIAS_COLS, HIVE_TYPES[who]))
        ddl = (f"DROP TABLE IF EXISTS default.ventas_limpias; CREATE EXTERNAL TABLE default.ventas_limpias ({cols}) "
               f"STORED AS PARQUET LOCATION '{LIMPIAS}'")
        r["trace"]["input"] = f"{LIMPIAS} (Parquet, escrito por {'pandas' if who == 'pandas' else 'Spark'})"
        r["trace"]["action"] = "Hive anota la tabla en el Metastore: columnas, formato y carpeta. No mueve ni copia nada"
        url = shlex.quote(self.datos_url())
        script = ("echo '== CREATE EXTERNAL TABLE ventas_limpias|0.3'\n"
                  f"beeline -u {url} --silent=true -e {shlex.quote(ddl + ';')}\n"
                  "echo '== Contando filas|0.7'\n"
                  "echo @@muestra@@\n"
                  f"beeline -u {url} --silent=true --outputformat=tsv2 -e "
                  f"{shlex.quote('SELECT * FROM default.ventas_limpias LIMIT 5;')}\n"
                  "echo @@filas@@\n"
                  f"beeline -u {url} --silent=true --outputformat=tsv2 -e "
                  f"{shlex.quote('SELECT COUNT(*) FROM default.ventas_limpias;')}\n")

        async def done(run: Run):
            if self.datos is not None:
                self.datos.invalidate("hive")
            lines = [l for l in marked(run, "muestra") if l.strip()]
            cols = [c.split(".", 1)[-1] for c in lines[0].split("\t")] if lines else LIMPIAS_COLS
            rows = [[None if c == "NULL" else hdfs_mod._cell(c) for c in l.split("\t")] for l in lines[1:]]
            cnt = [l.strip() for l in marked(run, "filas") if l.strip() and l.strip().isdigit()]
            total = int(cnt[-1]) if cnt else None
            size = await self.size_mb(LIMPIAS)
            out = {"path": "default.ventas_limpias", "rows": total, "sizeMb": size}
            after = {"columns": cols, "rows": rows, "format": "parquet"}
            if total is not None:
                after["total"] = total
            return ({k: v for k, v in out.items() if v is not None}, "Tabla default.ventas_limpias lista para consultar",
                    after)

        self.launch(r, info, tool, script, f'beeline -e "{ddl}"', done)

    def datos_url(self) -> str:
        from .datos import HIVE_URL
        return HIVE_URL

    async def _almacen_parquet(self, r, info, tool, o, por) -> None:
        r["trace"]["input"] = LIMPIAS
        r["trace"]["action"] = "Nada que hacer: el ETL ya dejó Parquet, que guarda por columna y comprimido"
        script = f"hdfs dfs -ls {LIMPIAS}\n"

        async def done(run: Run):
            files = [f for f in await self.listing(LIMPIAS)
                     if f.get("type") == "FILE" and not f["pathSuffix"].startswith(("_", "."))]
            size = round(sum(f.get("length", 0) for f in files) / hdfs_mod.MB, 2)
            k = len(files)
            limpia = next((x for x in self.runs if x["stage"] == "etl" and x["state"] == "done"), None)
            rows = ((limpia or {}).get("output") or {}).get("rows")
            out = {"path": LIMPIAS, "sizeMb": size}
            if rows is not None:
                out["rows"] = rows
            after = {"columns": ["archivo", "MB"],
                     "rows": [[f["pathSuffix"], round(f.get("length", 0) / hdfs_mod.MB, 2)] for f in files],
                     "total": k}
            return out, f"{k} archivo{'s' if k != 1 else ''} Parquet, {hdfs_mod.fmt_mb(size)}", after

        self.launch(r, info, tool, script, tool["command"], done)

    # ------------------------------------------------------------ análisis

    async def _analisis(self, r, info, tool, por, script: str, display: str) -> None:
        out_dir = f"{RESULTADOS}/por_{por}"
        r["trace"]["input"] = "ventas_limpias"
        r["trace"]["action"] = f"{POR[por]['label']}: agrupa y suma el importe"
        r["trace"]["before"] = {"columns": LIMPIAS_COLS, "rows": [], "format": "parquet",
                                "note": "La tabla limpia que dejó el ETL"}
        script += f"echo @@resultado@@\nhdfs dfs -cat '{out_dir}/*'\n"

        async def done(run: Run):
            rows = csv_rows(marked(run, "resultado"), por)
            size = await self.size_mb(out_dir)
            self.hdfs_changed(out_dir)
            out = {"path": out_dir, "rows": len(rows), "sizeMb": size if size is not None else 0}
            after = {"columns": POR[por]["columns"], "rows": rows, "total": len(rows), "format": "csv"}
            return out, f"{n(len(rows))} filas en {out_dir}", after

        self.launch(r, info, tool, script, display, done)

    async def _analisis_hive(self, r, info, tool, o, por) -> None:
        q = sql(por)
        out_dir = f"{RESULTADOS}/por_{por}"
        ins = (f"INSERT OVERWRITE DIRECTORY '{out_dir}' ROW FORMAT DELIMITED FIELDS TERMINATED BY ',' "
               f"{q.replace('FROM ventas_limpias', 'FROM default.ventas_limpias')}")
        script = ("echo '== HiveServer2 compila la consulta y lanza un trabajo Tez|0.05'\n"
                  f"beeline -u {shlex.quote(self.datos_url())} -e {shlex.quote(ins + ';')}\n")
        await self._analisis(r, info, tool, por, script, f'beeline -e "{ins}"')

    async def _analisis_sparksql(self, r, info, tool, o, por) -> None:
        q = sql(por).replace("FROM ventas_limpias", f"FROM parquet.`{LIMPIAS}`")
        out_dir = f"{RESULTADOS}/por_{por}"
        ins = f"INSERT OVERWRITE DIRECTORY '{out_dir}' USING csv {q}"
        script = ("echo '== spark-sql: pidiendo contenedores a YARN|0.05'\n"
                  f"spark-sql --master yarn -e {shlex.quote(ins)}\n")
        await self._analisis(r, info, tool, por, script, f'spark-sql -e "{ins}"')

    async def _analisis_pandas(self, r, info, tool, o, por) -> None:
        out_dir = f"{RESULTADOS}/por_{por}"
        k = {"pago": "medio_pago"}.get(por, por)
        tmp = "/tmp/pipeline_limpias"
        script = ("echo '== hdfs dfs -get ventas_limpias|0.2'\n"
                  f"rm -rf {tmp} && mkdir -p {tmp}\n"
                  f"hdfs dfs -get '{LIMPIAS}/*.parquet' {tmp}/\n"
                  "echo '== groupby + sum|0.6'\n"
                  f"python3 {shlex.quote(str(JOBS / 'resumen_pandas.py'))} {tmp} {por} {tmp}/por_{por}.csv\n"
                  f"echo '== hdfs dfs -put por_{por}.csv|0.85'\n"
                  f"hdfs dfs -rm -r -f -skipTrash {out_dir} >/dev/null\n"
                  f"hdfs dfs -mkdir -p {out_dir}\n"
                  f"hdfs dfs -put -f {tmp}/por_{por}.csv {out_dir}/\n"
                  f"rm -rf {tmp}\n")
        display = (f"python3 -c \"import pandas as pd; pd.read_parquet('ventas_limpias.parquet')"
                   f".groupby('{k}').importe.sum()\"")
        await self._analisis(r, info, tool, por, script, display)

    # ------------------------------------------------------------ ML

    async def _ml(self, r, info, tool, o, por) -> None:
        if self.ml is None:
            raise ApiError("Machine Learning no está disponible", "unsupported")
        task = str(o.get("task") or "regresion")
        model = PIPELINE_MODEL[task]
        engine = tool["id"]

        def on_change(m: dict) -> None:
            if r["state"] != "running":
                return
            r["progress"], r["message"] = m.get("progress", r["progress"]), m.get("message", r["message"])
            if m.get("appId") and m["appId"] not in r["appIds"]:
                r["appIds"].append(m["appId"])
            self.emit(r)

        def on_end(m: dict) -> None:
            if m.get("appId") and m["appId"] not in r["appIds"]:
                r["appIds"].append(m["appId"])
            if m["state"] == "done":
                self.finish(r, info, tool, {"path": "clientes_senal.csv", "rows": m.get("testRows")},
                            f"{MODEL_LABEL[model]}: {m['message']}", (m.get("trace") or {}).get("after"))
            else:
                self.fail(r, info, tool, m.get("error") or "Falló el entrenamiento")

        mid = await self.ml.train({"task": task, "model": model, "engine": engine, "trainPct": 80, "dataset": "senal"},
                                  on_end=on_end, on_change=on_change)
        m = next((x for x in self.ml.runs if x["id"] == mid), {})
        r["modelId"] = mid
        r["trace"] = {**r["trace"], "command": (m.get("trace") or {}).get("command", tool["command"]),
                      "input": (m.get("trace") or {}).get("input", "clientes_senal.csv"),
                      "action": f"{MODEL_LABEL[model]} con {'scikit-learn' if engine == 'sklearn' else 'Spark MLlib'}"}
        if (m.get("trace") or {}).get("before"):
            r["trace"]["before"] = m["trace"]["before"]

    _ml_sklearn = _ml
    _ml_mllib = _ml

    # ------------------------------------------------------------ resultados

    async def _resultados_getmerge(self, r, info, tool, o, por) -> None:
        src = f"{RESULTADOS}/por_{por}"
        local = f"por_{por}.csv"
        r["trace"]["input"] = src
        r["trace"]["action"] = "Junta las partes en un solo archivo local"
        script = f"rm -f {local} .{local}.crc\nhdfs dfs -getmerge {src} {local}\n"

        async def done(run: Run):
            try:
                text = (self.dir / local).read_text("utf-8", "replace")
            except OSError as e:
                raise ApiError(f"No quedó {local}: {e}", "failed") from None
            rows = csv_rows(text.splitlines(), por)
            return ({"path": local, "rows": len(rows)}, f"{local} con {n(len(rows))} filas, en la carpeta local",
                    {"columns": POR[por]["columns"], "rows": rows, "total": len(rows), "format": "csv"})

        self.launch(r, info, tool, script, f"hdfs dfs -getmerge {src} {local}", done)

    async def _resultados_mysql(self, r, info, tool, o, por) -> None:
        src = f"{RESULTADOS}/por_{por}"
        table = f"resumen_{por}"
        cols = POR[por]["columns"]
        key_type = "INT" if por == "mes" else "VARCHAR(20)"
        ddl = (f"CREATE TABLE IF NOT EXISTS {table} ({cols[0]} {key_type} PRIMARY KEY, "
               + ", ".join(f"{c} BIGINT NOT NULL" for c in cols[1:]) + f"); TRUNCATE TABLE {table};")
        r["trace"]["input"] = src
        r["trace"]["action"] = f"MapReduce sin reduce: un mapper lee el archivo y hace INSERT en tienda.{table}"
        cmd = (f'sqoop export --connect jdbc:mysql://localhost/tienda --username "$SQOOP_USER" --password "$SQOOP_PASS" '
               f"--table {table} --export-dir {src} --input-fields-terminated-by ',' -m 1")
        script = (f"echo '== Creando tienda.{table} (si no está) y vaciándola|0.05'\n"
                  f"mysql tienda -e {shlex.quote(ddl)}\n"
                  "echo '== sqoop export: pidiendo contenedores a YARN|0.1'\n"
                  f"{cmd}\n"
                  "echo @@resultado@@\n"
                  f"mysql --batch tienda -e {shlex.quote(f'SELECT * FROM {table} ORDER BY facturado DESC')}\n")

        async def done(run: Run):
            if self.datos is not None:
                self.datos.invalidate("mysql")
            lines = [l for l in marked(run, "resultado") if l.strip()]
            got = [[hdfs_mod._cell(c) for c in l.split("\t")] for l in lines[1:]]
            if por == "mes":
                got = [[MESES[x[0]] if isinstance(x[0], int) and 0 < x[0] < 13 else x[0], *x[1:]] for x in got]
            exp = [int(x.group(1)) for l in run.lines for x in [EXPORTED.search(l["text"])] if x]
            rows = exp[-1] if exp else len(got)
            return ({"path": f"tienda.{table}", "rows": rows}, f"{n(rows)} filas en tienda.{table}",
                    {"columns": cols, "rows": got, "total": len(got)})

        self.launch(r, info, tool, script, cmd, done, env=self.sqoop_env())

    # ------------------------------------------------------------ fin

    async def wait_all(self) -> None:
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)

    def routes(self) -> list[Route]:
        async def catalog(_: Request) -> JSONResponse:
            return JSONResponse(self.catalog())

        async def state(_: Request) -> JSONResponse:
            return JSONResponse(self.state())

        async def run_step(request: Request) -> JSONResponse:
            b = await hdfs_mod._json(request)
            return JSONResponse({"id": await self.run(b)})

        async def steps(_: Request) -> JSONResponse:
            return JSONResponse(self.steps())

        async def reset(_: Request) -> Response:
            self.reset()
            return Response(status_code=204)

        return [
            Route("/api/pipeline/catalog", catalog, methods=["GET"]),
            Route("/api/pipeline", state, methods=["GET"]),
            Route("/api/pipeline/steps", run_step, methods=["POST"]),
            Route("/api/pipeline/steps", steps, methods=["GET"]),
            # Alias en singular (así lo nombra el pedido del contrato)
            Route("/api/pipeline/step", run_step, methods=["POST"]),
            Route("/api/pipeline/reset", reset, methods=["POST"]),
        ]
