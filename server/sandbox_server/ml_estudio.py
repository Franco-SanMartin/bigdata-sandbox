"""El estudio de ML: las rutas /api/ml/... de la pantalla nueva (ui/src/pages/ml).

Todo lo de ML pasa por sandbox_ml (ml/sandbox_ml en el repo, /opt/sandbox/ml en
la imagen): el catálogo, la receta, el código y el registro de experimentos.
Este módulo solo pone el servidor en el medio:

    GET  /api/ml/catalog                 modelos con sus hiperparámetros, métricas, validaciones y búsquedas
    GET  /api/ml/sources                 archivos de /datos y de HDFS (Parquet, ORC, Avro, JSON, CSV, texto,
                                         comprimidos, carpetas particionadas) y tablas de Hive
    POST /api/ml/sources/example         {ejemplo: senal | sucias} → genera el dataset de ejemplo en /datos
    POST /api/ml/profile                 {datos, objetivo?, motor?: pandas | spark, modo?: muestra | completo, filas?}
                                         → perfil de columnas (sandbox_ml.perfil con pandas, o perfil_spark.py
                                         con spark-submit en YARN)
    POST /api/ml/cleaning/preview        {datos, limpieza, objetivo?, filas?} → la receta de limpieza sobre una
                                         muestra, en Spark local: filas afectadas y antes/después de cada paso
    GET  /api/ml/cleaning                las recetas de limpieza guardadas, con sus versiones
    GET  /api/ml/cleaning/{nombre}       una receta de limpieza con todas sus versiones
    POST /api/ml/cleaning                {nombre, limpieza, nota?} → la guarda como versión nueva
    POST /api/ml/check                   {receta} → receta completa, errores y avisos (fuga, id, desbalance)
    POST /api/ml/code                    {receta, parte?: entrenamiento | perfil | limpieza} → el script de PySpark
                                         (o scikit-learn) que reproduce ese paso
    POST /api/ml/experiments             {receta} → 202 {id, run}: corre ese script como trabajo
    POST /api/ml/runs                    {codigo, motor, receta?, minutos?, memoriaMb?} → 202: corre código editado
    GET  /api/ml/runs                    corridas recientes
    GET  /api/ml/runs/{id}?desde=N       estado, avance, ajustes de la búsqueda y las líneas de salida desde la N
    POST /api/ml/runs/{id}/cancel
    GET  /api/ml/experiments             tabla de posiciones
    GET  /api/ml/experiments/{id}        experimento + informe (lo que dibujan los gráficos)
    DELETE /api/ml/experiments/{id}
    GET  /api/ml/experiments/{id}/download?formato=py|ipynb|modelo|log
    POST /api/ml/experiments/{id}/jupyter   copia el notebook a /datos/experimentos para abrirlo en JupyterLab
    POST /api/ml/experiments/{id}/predict   {filas: [...]} o {archivo: "/datos/..."}

Cada corrida es el script generado (o el editado), corrido con python3
(scikit-learn, en una máquina) o con spark-submit en YARN (Spark MLlib), con
límite de tiempo y de memoria y una a la vez. El avance sale de las líneas
'[ 40%] mensaje' que imprime el script y, en las búsquedas, de las líneas
'[CV ...] END' de scikit-learn (cada entrenamiento de la búsqueda).
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import shlex
import shutil
import sys
import time
from collections import OrderedDict
from pathlib import Path

from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse, Response
from starlette.routing import Route

import sandbox_ml
from sandbox_ml import catalogo as cat
from sandbox_ml import codigo as gen
from sandbox_ml import fuentes
from sandbox_ml import limpieza as lz
from sandbox_ml import perfil_spark
from sandbox_ml import receta as rec
from sandbox_ml.estudio import nuevo_id

from . import hdfs as hdfs_mod
from .actions import Action
from .boot import now_ms
from .errors import ApiError
from .events import EventBus
from .yarn import APP_ID, RM

ML_PATH = Path(sandbox_ml.__file__).resolve().parent.parent
PASO = re.compile(r"^\[\s*(\d{1,3})%\] (.*)$")
AJUSTES = re.compile(r"Fitting (\d+) folds for each of (\d+) candidates, totalling (\d+) fits")
AJUSTE_HECHO = re.compile(r"^\[CV[^\]]*\] END ")
PERFIL = "@@perfil@@ "
LIMPIEZA = "@@limpieza@@ "
ERROR_SPARK = "@@error@@ "
PREDICCION = "@@prediccion@@ "
EXP_ID = re.compile(r"^exp-[0-9]{8}-[0-9]{6}-[0-9a-f]{4}$")
MAX_CODIGO = 400_000
MAX_CORRIDAS = 30
SUFIJOS = fuentes.SUFIJOS + tuple(e + c for e in fuentes.SUFIJOS for c in (".gz", ".bz2"))
# Cuánto puede tardar el perfil con Spark (la pasada completa de un dataset grande tarda)
PERFIL_SEGUNDOS = {"muestra": 900, "completo": 3600}
VERSIONES_MAX = 50
# Datasets de ejemplo que se pueden generar desde el estudio (los mismos generadores de ejemplos/ml)
EJEMPLOS = {"senal": ("clientes_senal.csv", "ejemplos/ml/generar_senal.py"),
            "sucias": ("ventas_sucias.csv", "ejemplos/ml/generar_sucios.py")}


def _ruta_local(raw: object, base: Path) -> Path:
    """Una ruta de /datos (no se sale de ahí ni con .. ni con enlaces)."""
    if not isinstance(raw, str) or not raw.startswith("/"):
        raise ApiError("La ruta tiene que ser absoluta, dentro de /datos", "invalid")
    p = Path(raw)
    try:
        real = p.resolve()
        real.relative_to(base.resolve())
    except (OSError, ValueError):
        raise ApiError(f"{raw} no está dentro de {base}", "invalid") from None
    return real


class Estudio:
    # Cada cuánto se mira la salida de la corrida (los tests lo bajan)
    every = 0.3
    python = sys.executable
    # El reloj del límite de tiempo (los tests lo adelantan)
    reloj = staticmethod(time.monotonic)

    def __init__(self, cluster, runner, bus: EventBus, hdfs, datos):
        self.c = cluster
        self.runner = runner
        self.bus = bus
        self.hdfs = hdfs
        self.datos = datos
        self.perfiles: "OrderedDict[str, dict]" = OrderedDict()
        self.corridas: "OrderedDict[str, dict]" = OrderedDict()
        self._tasks: set[asyncio.Task] = set()
        self._resumen: dict[str, tuple[float, dict]] = {}

    # ------------------------------------------------------------ rutas de disco

    @property
    def raiz(self) -> Path:
        return self.c.s.hadoop_dir / "ml" / "experimentos"

    def carpeta(self, exp_id: object) -> Path:
        if not isinstance(exp_id, str) or not EXP_ID.match(exp_id):
            raise ApiError("No existe ese experimento", "not_found")
        d = self.raiz / exp_id
        if not (d / "experimento.json").is_file():
            raise ApiError(f"No existe el experimento {exp_id}", "not_found")
        return d

    def env(self, exp_dir: Path | None = None, origen: str = "estudio") -> dict[str, str]:
        e = {"PYTHONPATH": os.pathsep.join([str(ML_PATH), os.environ.get("PYTHONPATH", "")]).rstrip(os.pathsep),
             "PYTHONUNBUFFERED": "1", "PYTHONIOENCODING": "utf-8", "SANDBOX_ML_EXPERIMENTOS": str(self.raiz),
             "SANDBOX_ML_ORIGEN": origen,
             # Una sola máquina compartida con el cluster: nada de usar todos los núcleos por las suyas
             "OMP_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2", "MKL_NUM_THREADS": "2"}
        if exp_dir is not None:
            e["SANDBOX_ML_EXP"] = str(exp_dir)
        return e

    def need_ml(self) -> None:
        self.c.need_running()
        if self.c.config.get("services") != "todo":
            raise ApiError("Machine Learning necesita los servicios completos (SERVICIOS=todo)", "unsupported")

    # ------------------------------------------------------------ catálogo y fuentes

    def catalogo(self) -> dict:
        return cat.como_json()

    async def fuentes(self) -> dict:
        base = self.c.s.datos_dir
        local = []
        if base.is_dir():
            for raiz, dirs, archivos in os.walk(base):
                prof = Path(raiz).relative_to(base).parts
                dirs[:] = sorted(d for d in dirs if not d.startswith(".") and d not in ("experimentos", "__pycache__"))
                if len(prof) >= 3:
                    dirs[:] = []
                for a in sorted(archivos):
                    if a.lower().endswith(SUFIJOS) and not a.startswith("."):
                        p = Path(raiz) / a
                        try:
                            tam = p.stat().st_size
                        except OSError:
                            continue
                        det = {k: v for k, v in fuentes.detectar(a).items() if v is not None}
                        local.append({"origen": "local", "ruta": str(p), "nombre": str(p.relative_to(base)), "bytes": tam,
                                      **det, "formato": det.get("formato") or "csv"})
                if len(local) > 300:
                    break
        out: dict = {"local": local, "hdfs": [], "hive": [], "avisos": []}
        if self.c.phase == "running" and self.c.hdfs.get("available"):
            try:
                archivos = [{"path": f["path"], "bytes": int(round(float(f.get("sizeMb") or 0) * 1024 * 1024))}
                            for f in await self.hdfs.files()]
                out["hdfs"] = fuentes.agrupar(archivos)
            except ApiError as e:
                out["avisos"].append(f"HDFS: {e}")
        else:
            out["avisos"].append("HDFS no responde: arrancá el cluster para ver sus archivos")
        if self.datos is not None and self.datos.up("hive"):
            try:
                tablas = await self.datos.hive_tables()
                for nombre, d in sorted(tablas.items()):
                    e = self.datos.hive_entry(nombre, d)
                    out["hive"].append({"origen": "hive", "tabla": nombre, "nombre": nombre, "filas": e.get("rows"),
                                        "columnas": [c["name"] for c in e["columns"]]})
            except ApiError as e:
                out["avisos"].append(f"Hive: {e}")
        else:
            out["avisos"].append("HiveServer2 no está arriba: sin tablas de Hive")
        return out

    async def ejemplo(self, nombre: object) -> dict:
        if nombre not in EJEMPLOS:
            raise ApiError(f"El ejemplo es {' o '.join(EJEMPLOS)}", "invalid")
        archivo, script = EJEMPLOS[nombre]
        base = self.c.s.datos_dir
        if not (base / script).is_file():
            raise ApiError(f"No está {script} en {base}: arrancá el cluster una vez (copia los ejemplos)", "not_found")
        run = await self.runner.run(Action(f"Generar {archivo}", [self.python, script], display=f"python3 {script}",
                                           action=f"Genera {archivo} en {base}", source="ML", timeout=300, cwd=str(base)))
        if run.state != "done":
            raise ApiError(run.error or f"No se pudo generar {archivo}", "failed")
        return {"origen": "local", "ruta": str(base / archivo), "formato": "csv"}

    # ------------------------------------------------------------ perfil

    def _datos_ok(self, d: object) -> dict:
        """Los datos de una receta o de un pedido de perfil, validados (y adentro de /datos si son locales)."""
        datos, err = fuentes.normalizar(d)
        if err:
            raise ApiError(err[0]["mensaje"], "invalid", field=err[0]["campo"])
        if datos["origen"] == "local":
            p = _ruta_local(datos["ruta"], self.c.s.datos_dir)
            if not p.exists():
                raise ApiError(f"No existe {datos['ruta']}", "not_found")
            datos["ruta"] = str(p)
        return datos

    def _clave(self, datos: dict, objetivo: str | None, motor: str = "pandas", modo: str = "muestra",
               filas: int = 0) -> str:
        sello = ""
        if datos["origen"] == "local":
            try:
                st = Path(datos["ruta"]).stat()
                sello = f"{st.st_size}:{st.st_mtime_ns}"
            except OSError:
                pass
        return json.dumps([datos, objetivo, sello, motor, modo, filas], sort_keys=True)

    def perfil_guardado(self, datos: dict) -> dict | None:
        """El último perfil de esos datos (con o sin objetivo, de pandas o de Spark), para validar la receta."""
        for k in reversed(self.perfiles):
            if json.loads(k)[0] == datos:
                return self.perfiles[k]
        return None

    def _necesita(self, datos: dict, spark: bool) -> None:
        if datos["origen"] == "hdfs":
            self.c.need_hdfs()
        elif datos["origen"] == "hive":
            self.c.need_proc("metastore", "El metastore de Hive")
        if spark and datos["origen"] != "local":
            self.c.need_proc("rm", "YARN (ResourceManager)")

    @staticmethod
    def _error_spark(run, que: str) -> ApiError:
        """El error de un trabajo de Spark, explicado: la línea @@error@@ que imprime el script, o lo que se
        pueda sacar de la salida de error (la excepción de Java o de Python)."""
        linea = next((l["text"] for l in reversed(run.lines) if l["text"].startswith(ERROR_SPARK)), None)
        if linea:
            e = json.loads(linea[len(ERROR_SPARK):])
        else:
            err = "\n".join(l["text"] for l in run.lines[-200:] if l["stream"] == "err")
            e = fuentes.explicar_error(err) if err.strip() else {"mensaje": run.error or "terminó sin resultado", "detalle": None}
            if run.error and "tardó" in run.error:
                e = {"mensaje": f"tardó más que el límite ({run.error})", "detalle": e.get("detalle")}
        return ApiError(f"No se pudo {que}: {e['mensaje']}", "failed", detalle=e.get("detalle"), motor="spark")

    async def perfil(self, d: object, objetivo: object = None, motor: object = None, modo: object = "muestra",
                     filas: object = None) -> dict:
        datos = self._datos_ok(d)
        if objetivo is not None and (not isinstance(objetivo, str) or len(objetivo) > 200):
            raise ApiError("objetivo es el nombre de una columna", "invalid")
        if motor is None:
            # pandas para lo chico de /datos (y con la asociación de cada columna con el objetivo); Spark para el resto
            motor = "pandas" if datos["origen"] == "local" and not fuentes.solo_spark(datos) else "spark"
        if motor not in ("pandas", "spark"):
            raise ApiError("motor es pandas (una máquina, hasta 200.000 filas) o spark (en YARN, a escala)", "invalid")
        if motor == "pandas" and fuentes.solo_spark(datos):
            raise ApiError(f"Con pandas no: {fuentes.solo_spark(datos)}. Perfilalo con Spark", "invalid", field="motor")
        if modo not in ("muestra", "completo"):
            raise ApiError("modo es muestra o completo", "invalid")
        n = hdfs_mod.bounded_int(filas, "filas", 1000, 5_000_000, cat.LIMITES["max_filas_perfil"])
        self._necesita(datos, motor == "spark")
        clave = self._clave(datos, objetivo, motor, modo if motor == "spark" else "muestra", n if motor == "spark" else 0)
        if clave in self.perfiles:
            self.perfiles.move_to_end(clave)
            return self.perfiles[clave]
        nombre = datos.get("ruta") or datos.get("tabla")
        cwd = str(self.c.s.datos_dir) if self.c.s.datos_dir.is_dir() else None
        if motor == "spark":
            master = "local[2]" if datos["origen"] == "local" else "yarn"
            script = str(Path(perfil_spark.__file__).resolve())
            que = f" sobre una muestra de hasta {n:,} filas".replace(",", ".") if modo == "muestra" else ", pasada completa"
            run = await self.runner.run(Action(
                "Perfil con Spark (estudio de ML)",
                ["spark-submit", "--master", master, "--name", "estudio-ml: perfil", "--conf",
                 "spark.ui.showConsoleProgress=false", script, json.dumps(datos, ensure_ascii=False), objetivo or "", modo,
                 str(n)],
                display=f"spark-submit --master {master} perfil_spark.py {shlex.quote(nombre)} ({modo})",
                input=nombre, source="ML", timeout=PERFIL_SEGUNDOS[modo], env=self.env(), cwd=cwd,
                action="Nulos, distintos, cuantiles, histogramas y categorías de cada columna con Spark" + que))
            linea = next((l["text"] for l in reversed(run.lines) if l["text"].startswith(PERFIL)), None)
            if run.state != "done" or linea is None:
                raise self._error_spark(run, "perfilar con Spark")
        else:
            run = await self.runner.run(Action(
                "Perfil de los datos (estudio de ML)",
                [self.python, "-m", "sandbox_ml.perfil", json.dumps(datos, ensure_ascii=False), objetivo or ""],
                display=f"python3 -m sandbox_ml.perfil {shlex.quote(nombre)}",
                input=nombre, action="Tipos, nulos, distintos y distribución de cada columna",
                source="ML", timeout=300, env=self.env(), cwd=cwd))
            linea = next((l["text"] for l in reversed(run.lines) if l["text"].startswith(PERFIL)), None)
            if run.state != "done" or linea is None:
                err = run.error or next((l["text"] for l in reversed(run.lines) if l["stream"] == "err" and l["text"].strip()),
                                        "no se pudo leer")
                raise ApiError(f"No se pudo perfilar: {err}", "failed")
        perfil = json.loads(linea[len(PERFIL):])
        perfil.setdefault("motor", motor)
        perfil["datos"] = datos
        self.perfiles[clave] = perfil
        while len(self.perfiles) > 20:
            self.perfiles.popitem(last=False)
        return perfil

    # ------------------------------------------------------------ receta de limpieza

    def _limpieza_ok(self, lim: object, objetivo: object, datos: dict) -> dict:
        perfil = self.perfil_guardado(datos)
        conocidas = [c["nombre"] for c in perfil["columnas"]] if perfil else None
        out, errores, _, _ = lz.normalizar(lim, objetivo if isinstance(objetivo, str) else None, conocidas)
        if errores:
            e = errores[0]
            raise ApiError(f"{e['campo']}: {e['mensaje']}", "invalid", errors=errores)
        return out

    async def vista_limpieza(self, b: dict) -> dict:
        datos = self._datos_ok(b.get("datos"))
        objetivo = b.get("objetivo") if isinstance(b.get("objetivo"), str) else None
        lim = self._limpieza_ok(b.get("limpieza"), objetivo, datos)
        filas = hdfs_mod.bounded_int(b.get("filas"), "filas", 100, 50_000, lz.VISTA_FILAS)
        self._necesita(datos, False)
        pedido = {"datos": datos, "limpieza": lim, "objetivo": objetivo, "filas": filas}
        run = await self.runner.run(Action(
            "Vista previa de la limpieza (estudio de ML)",
            [self.python, "-m", "sandbox_ml.limpieza", json.dumps(pedido, ensure_ascii=False)],
            display=f"python3 -m sandbox_ml.limpieza ({len(lim['pasos'])} pasos, {filas} filas)",
            input=datos.get("ruta") or datos.get("tabla"), source="ML", timeout=600, env=self.env(),
            action=f"Los {len(lim['pasos'])} pasos de la limpieza sobre una muestra de {filas} filas, en Spark local",
            cwd=str(self.c.s.datos_dir) if self.c.s.datos_dir.is_dir() else None))
        linea = next((l["text"] for l in reversed(run.lines) if l["text"].startswith(LIMPIEZA)), None)
        if run.state != "done" or linea is None:
            raise self._error_spark(run, "correr la vista previa")
        out = json.loads(linea[len(LIMPIEZA):])
        out["huella"] = rec.huella({"limpieza": {"pasos": lim["pasos"]}})
        return out

    @property
    def dir_limpiezas(self) -> Path:
        return self.c.s.hadoop_dir / "ml" / "limpiezas"

    def _archivo_limpieza(self, nombre: object) -> Path:
        if not isinstance(nombre, str) or not lz.NOMBRE_RECETA.match(nombre):
            raise ApiError("El nombre de la receta de limpieza: letras, números, espacios, punto y guiones (hasta 60)",
                           "invalid", field="nombre")
        return self.dir_limpiezas / (re.sub(r"[^A-Za-z0-9_.\-]+", "_", nombre) + ".json")

    def limpiezas(self) -> list[dict]:
        out = []
        if self.dir_limpiezas.is_dir():
            for a in sorted(self.dir_limpiezas.glob("*.json")):
                try:
                    doc = json.loads(a.read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    continue
                v = doc["versiones"][-1]
                out.append({"nombre": doc["nombre"], "versiones": len(doc["versiones"]), "version": v["version"],
                            "creado": v["creado"], "pasos": len(v["limpieza"]["pasos"]), "huella": v["huella"]})
        return sorted(out, key=lambda x: x["creado"], reverse=True)

    def limpieza_guardada(self, nombre: object) -> dict:
        a = self._archivo_limpieza(nombre)
        if not a.is_file():
            raise ApiError(f"No hay una receta de limpieza que se llame {nombre}", "not_found")
        return json.loads(a.read_text(encoding="utf-8"))

    def guardar_limpieza(self, b: dict) -> dict:
        nombre = b.get("nombre")
        a = self._archivo_limpieza(nombre)
        objetivo = b.get("objetivo") if isinstance(b.get("objetivo"), str) else None
        lim, errores, _, _ = lz.normalizar(b.get("limpieza"), objetivo)
        if errores:
            e = errores[0]
            raise ApiError(f"{e['campo']}: {e['mensaje']}", "invalid", errors=errores)
        if not lim["pasos"]:
            raise ApiError("La receta de limpieza no tiene pasos", "invalid")
        nota = b.get("nota")
        if nota is not None and (not isinstance(nota, str) or len(nota) > 300):
            raise ApiError("La nota es un texto de hasta 300 caracteres", "invalid", field="nota")
        doc = json.loads(a.read_text(encoding="utf-8")) if a.is_file() else {"nombre": nombre, "versiones": []}
        pasos = {"pasos": lim["pasos"]}
        huella = rec.huella({"limpieza": pasos})
        if doc["versiones"] and doc["versiones"][-1]["huella"] == huella:
            v = doc["versiones"][-1]
            return {"nombre": nombre, "version": v["version"], "huella": huella, "creado": v["creado"], "nueva": False}
        n = (doc["versiones"][-1]["version"] if doc["versiones"] else 0) + 1
        v = {"version": n, "creado": time.strftime("%Y-%m-%dT%H:%M:%S"), "huella": huella, "nota": nota or None,
             "limpieza": {"nombre": nombre, "version": n, **pasos}}
        doc["versiones"] = (doc["versiones"] + [v])[-VERSIONES_MAX:]
        a.parent.mkdir(parents=True, exist_ok=True)
        tmp = a.with_suffix(".tmp")
        tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(a)
        return {"nombre": nombre, "version": n, "huella": huella, "creado": v["creado"], "nueva": True}

    # ------------------------------------------------------------ receta y código

    def revisar(self, receta: object) -> dict:
        if not isinstance(receta, dict):
            raise ApiError("Falta la receta", "invalid")
        perfil = None
        try:
            perfil = self.perfil_guardado(self._datos_ok(receta.get("datos")))
        except ApiError:
            pass
        out, errores, avisos = rec.normalizar(receta, perfil)
        if not errores and out["datos"]["origen"] == "local":
            try:
                _ruta_local(out["datos"]["ruta"], self.c.s.datos_dir)
            except ApiError as e:
                errores.append({"campo": "datos.ruta", "mensaje": str(e)})
        return {"receta": out, "errores": errores, "avisos": avisos, "conPerfil": perfil is not None,
                "huella": rec.huella(out) if not errores else None}

    def receta_valida(self, receta: object) -> dict:
        r = self.revisar(receta)
        if r["errores"]:
            e = r["errores"][0]
            raise ApiError(f"{e['campo']}: {e['mensaje']}", "invalid", errors=r["errores"])
        return r["receta"]

    def codigo(self, receta: object, exp_id: str | None = None, parte: object = "entrenamiento",
               opciones: object = None) -> dict:
        if parte in ("perfil", "limpieza"):
            return self.codigo_parte(receta, parte, opciones)
        if parte not in (None, "entrenamiento"):
            raise ApiError("parte es entrenamiento, perfil o limpieza", "invalid")
        r = self.receta_valida(receta)
        return {"codigo": gen.generar(r, exp_id), "archivo": gen.nombre_archivo(r, exp_id), "motor": r["motor"],
                "huella": rec.huella(r), "comando": self.comando_texto(r["motor"], gen.nombre_archivo(r, exp_id))}

    def codigo_parte(self, receta: object, parte: str, opciones: object) -> dict:
        """El PySpark del perfil o de la limpieza: alcanza con los datos (y la limpieza), sin modelo elegido."""
        if not isinstance(receta, dict):
            raise ApiError("Falta la receta", "invalid")
        datos = self._datos_ok(receta.get("datos"))
        objetivo = receta.get("objetivo") if isinstance(receta.get("objetivo"), str) else None
        fecha = time.strftime("%Y-%m-%d %H:%M")
        nombre = (datos.get("ruta") or datos.get("tabla") or "datos").rstrip("/").rsplit("/", 1)[-1].split(".")[0]
        master = "local[2]" if datos["origen"] == "local" else "yarn"
        if parte == "perfil":
            o = opciones if isinstance(opciones, dict) else {}
            modo = o.get("modo") if o.get("modo") in ("muestra", "completo") else "muestra"
            n = hdfs_mod.bounded_int(o.get("filas"), "filas", 1000, 5_000_000, cat.LIMITES["max_filas_perfil"])
            codigo = perfil_spark.script(datos, objetivo, modo, n, fecha)
            archivo = f"perfil_{nombre}.py"
            huella = rec.huella({"datos": datos, "objetivo": objetivo, "modo": modo, "filas": n})
        else:
            lim = self._limpieza_ok(receta.get("limpieza"), objetivo, datos)
            if not lim["pasos"]:
                raise ApiError("La receta de limpieza no tiene pasos todavía", "invalid", field="limpieza")
            codigo = lz.script(datos, lim, objetivo, fecha)
            archivo = re.search(r"limpieza_[\w\-]+\.py", codigo).group(0)
            huella = rec.huella({"datos": datos, "objetivo": objetivo, "limpieza": lim})
        return {"codigo": codigo, "archivo": archivo, "motor": "spark", "parte": parte, "huella": huella,
                "comando": f"spark-submit --master {master} {archivo}"}

    @staticmethod
    def comando_texto(motor: str, archivo: str) -> str:
        return f"spark-submit --master yarn {archivo}" if motor == "spark" else f"python3 {archivo}"

    # ------------------------------------------------------------ corridas

    def ocupado(self) -> dict | None:
        return next((c for c in self.corridas.values() if c["estado"] == "corriendo"), None)

    async def entrenar(self, receta: object, origen: str = "estudio") -> dict:
        r = self.receta_valida(receta)
        exp_id = nuevo_id()
        codigo = gen.generar(r, exp_id)
        return await self.lanzar(codigo, r["motor"], r, origen, minutos=r["busqueda"]["max_minutos"],
                                 memoria_mb=4096, exp_id=exp_id, editado=False)

    async def correr_codigo(self, b: dict) -> dict:
        codigo, motor = b.get("codigo"), b.get("motor", "sklearn")
        if not isinstance(codigo, str) or not codigo.strip():
            raise ApiError("Falta el código", "invalid")
        if len(codigo) > MAX_CODIGO:
            raise ApiError("El código es demasiado largo (más de 400 KB)", "invalid")
        if motor not in ("sklearn", "spark"):
            raise ApiError("motor es sklearn (python3) o spark (spark-submit en YARN)", "invalid")
        minutos = hdfs_mod.bounded_int(b.get("minutos"), "minutos", 1, 120, 15)
        memoria = hdfs_mod.bounded_int(b.get("memoriaMb"), "memoriaMb", 512, 16384, 3072)
        r = None
        if b.get("receta") is not None:
            r, errores, _ = rec.normalizar(b["receta"])
            if errores:
                r = None
        return await self.lanzar(codigo, motor, r, "código editado", minutos=minutos, memoria_mb=memoria,
                                 exp_id=nuevo_id(), editado=True)

    async def lanzar(self, codigo: str, motor: str, r: dict | None, origen: str, *, minutos: int, memoria_mb: int,
                     exp_id: str, editado: bool) -> dict:
        self.need_ml()
        if motor == "spark":
            self.c.need_proc("rm", "YARN (ResourceManager)")
            self.c.need_hdfs()
        if self.ocupado():
            raise ApiError("Ya hay una corrida de ML en curso: esperá a que termine o cancelala", "busy")
        if r is not None and r["datos"]["origen"] == "hdfs":
            self.c.need_hdfs()
        d = self.raiz / exp_id
        d.mkdir(parents=True, exist_ok=True)
        (d / "codigo.py").write_text(codigo, encoding="utf-8")
        m = cat.MODELOS.get((r or {}).get("modelo", {}).get("id", ""))
        previo = {"id": exp_id, "estado": "corriendo", "origen": origen, "editado": editado, "motor": motor,
                  "creado": time.strftime("%Y-%m-%dT%H:%M:%S"), "receta": r, "huella": rec.huella(r) if r else None,
                  "tarea": (r or {}).get("tarea"), "metrica": (r or {}).get("validacion", {}).get("metrica"),
                  "nombre": (r or {}).get("nombre"),
                  "modelo": {"id": m["id"], "etiqueta": m["etiqueta"], "clase": m["clase"],
                             "params": r["modelo"]["params"]} if m else None,
                  "datos": (r or {}).get("datos"), "metricas": {}, "artefactos": ["codigo.py"]}
        (d / "experimento.json").write_text(json.dumps(previo, ensure_ascii=False, indent=1), encoding="utf-8")
        archivo = gen.nombre_archivo(r or {}, exp_id) if r else f"{exp_id}.py"
        if motor == "spark":
            argv = ["spark-submit", "--master", "yarn", "--name", f"estudio-ml: {exp_id}", "codigo.py"]
        else:
            argv = [self.python, "codigo.py"]
        titulo = f"{m['etiqueta'] if m else 'Código editado'} ({'Spark MLlib' if motor == 'spark' else 'scikit-learn'})"
        run = self.runner.start(Action(
            f"Estudio de ML: {titulo}", argv, display=self.comando_texto(motor, archivo),
            input=(r or {}).get("datos", {}).get("ruta") or (r or {}).get("datos", {}).get("tabla") or "código editado",
            action=f"{titulo}, con un límite de {minutos} min y {memoria_mb} MB", source="ML",
            timeout=minutos * 60 + 30, env=self.env(d, origen), cwd=str(d)))
        c = {"id": run.id, "experimento": exp_id, "estado": "corriendo", "progreso": 0.0, "mensaje": "Arrancando",
             "motor": motor, "titulo": titulo, "origen": origen, "inicio": now_ms(), "ajustes": None,
             "limites": {"minutos": minutos, "memoriaMb": memoria_mb}, "memoriaMb": None}
        self.corridas[run.id] = c
        while len(self.corridas) > MAX_CORRIDAS:
            self.corridas.popitem(last=False)
        self.emit(c)
        t = asyncio.get_running_loop().create_task(self._seguir(run, c, d, minutos, memoria_mb))
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)
        return {"id": exp_id, "run": run.id}

    def _leer(self, run, c: dict, estado: dict) -> bool:
        """Lee las líneas nuevas: avance, ajustes de la búsqueda y la app de YARN. True si algo cambió."""
        nuevas = run.count - estado["vistas"]
        if nuevas <= 0:
            return False
        lineas = run.lines[-min(nuevas, len(run.lines)):]
        estado["vistas"] = run.count
        cambio = False
        for l in lineas:
            t = l["text"]
            m = PASO.match(t.strip())
            if m:
                c["progreso"] = min(0.99, int(m.group(1)) / 100)
                c["mensaje"] = m.group(2)
                cambio = True
                continue
            m = AJUSTES.search(t)
            if m:
                aj = c["ajustes"] or {"hechos": 0, "total": 0, "mejor": None}
                aj["total"] += int(m.group(3))
                aj["particiones"], aj["candidatos"] = int(m.group(1)), int(m.group(2))
                c["ajustes"] = aj
                cambio = True
                continue
            if AJUSTE_HECHO.match(t) and c["ajustes"]:
                c["ajustes"]["hechos"] += 1
                s = re.search(r"score=(-?[0-9.]+)", t)
                if s:
                    v = float(s.group(1))
                    c["ajustes"]["ultimo"] = v
                # La búsqueda va del 15 % al 45 %
                aj = c["ajustes"]
                if aj["total"]:
                    c["progreso"] = max(c["progreso"], 0.15 + 0.3 * min(1.0, aj["hechos"] / aj["total"]))
                cambio = True
                continue
            a = APP_ID.search(t)
            if a and c.get("appId") != a.group(0):
                c["appId"] = a.group(0)
                self.bus.publish("yarn", {"appId": c["appId"]})
                cambio = True
        return cambio

    def _memoria(self, pid: int | None) -> float | None:
        """MB residentes de todo el grupo de procesos de la corrida (python, joblib, la JVM de spark-submit)."""
        if pid is None:
            return None
        proc = self.c.s.proc_dir
        total = 0
        try:
            entradas = list(proc.iterdir())
        except OSError:
            return None
        for e in entradas:
            if not e.name.isdigit():
                continue
            try:
                stat = (e / "stat").read_text()
                pgid = int(stat.rsplit(")", 1)[1].split()[2])
                if pgid != pid:
                    continue
                for linea in (e / "status").read_text().splitlines():
                    if linea.startswith("VmRSS:"):
                        total += int(linea.split()[1])
                        break
            except (OSError, ValueError, IndexError):
                continue
        return round(total / 1024, 1)

    async def _seguir(self, run, c: dict, d: Path, minutos: int, memoria_mb: int) -> None:
        estado = {"vistas": 0}
        limite = self.reloj() + minutos * 60
        vuelta = 0
        while run.state == "running":
            cambio = self._leer(run, c, estado)
            vuelta += 1
            # La memoria se mira cada ~1 s (recorre /proc entero)
            mem = self._memoria(run.pid) if vuelta % max(1, round(1 / self.every)) == 0 else None
            if mem is not None:
                c["memoriaMb"] = mem
                c["memoriaPicoMb"] = max(c.get("memoriaPicoMb") or 0, mem)
                if mem > memoria_mb:
                    self.runner.cancel(run.id, f"cortado: pasó el límite de memoria ({mem:.0f} de {memoria_mb} MB)")
            if self.reloj() > limite:
                self.runner.cancel(run.id, f"cortado: pasó el límite de tiempo ({minutos} min)")
            if cambio:
                self.emit(c)
            await asyncio.sleep(self.every)
        self._leer(run, c, estado)
        await self._terminar(run, c, d)

    async def _terminar(self, run, c: dict, d: Path) -> None:
        c["fin"] = now_ms()
        try:
            (d / "salida.log").write_text("\n".join(l["text"] for l in run.lines) + "\n", encoding="utf-8")
        except OSError:
            pass
        exp = self._leer_json(d / "experimento.json") or {}
        ok = run.state == "done"
        if ok and exp.get("estado") == "listo":
            c.update(estado="listo", progreso=1.0, mensaje="Listo")
        elif ok:
            # Terminó bien pero no registró nada (el código editado no llama a estudio.registrar)
            exp.update(estado="sin informe", terminado=time.strftime("%Y-%m-%dT%H:%M:%S"))
            c.update(estado="listo", progreso=1.0, mensaje="Terminó (sin registrar métricas: el código no llama a estudio.registrar)")
        else:
            err = run.error or next((l["text"] for l in reversed(run.lines) if l["stream"] == "err" and l["text"].strip()
                                     and not l["text"].startswith(("WARNING", "Warning", "  warnings.warn"))), None) \
                or f"terminó con código {run.exitCode}"
            exp.update(estado="falló", error=err[:500], terminado=time.strftime("%Y-%m-%dT%H:%M:%S"))
            c.update(estado="falló", error=err[:500], mensaje=err[:200])
        # El script mide su propio pico (getrusage); el servidor, el de todo el grupo de procesos (con la JVM
        # del driver en Spark y los procesos de joblib): queda el mayor
        if c.get("memoriaPicoMb"):
            exp["memoria_pico_mb"] = max(exp.get("memoria_pico_mb") or 0, c["memoriaPicoMb"])
        if c.get("appId"):
            exp.setdefault("yarn", {})["app_id"] = c["appId"]
            mb = await self.yarn_mb(c["appId"])
            if mb is not None:
                exp["yarn"]["memoria_mb"] = mb
        if exp:
            arts = set(exp.get("artefactos") or [])
            arts.update(p.name for p in d.iterdir() if p.is_file() and not p.name.endswith(".tmp"))
            exp["artefactos"] = sorted(arts)
            (d / "experimento.json").write_text(json.dumps(exp, ensure_ascii=False, indent=1), encoding="utf-8")
        self._resumen.pop(d.name, None)
        level = "ok" if c["estado"] == "listo" else "error"
        self.bus.log("ML", level, f"{c['titulo']}: {c['mensaje']}", appId=c.get("appId"))
        self.emit(c)

    async def yarn_mb(self, app_id: str) -> float | None:
        try:
            status, body = await asyncio.to_thread(self.hdfs.http, f"{RM}/ws/v1/cluster/apps/{app_id}")
            app = (json.loads(body or b"{}").get("app") or {}) if status == 200 else {}
        except (ValueError, AttributeError, OSError):
            return None
        ms, secs = app.get("elapsedTime"), app.get("memorySeconds")
        if isinstance(ms, int) and ms > 0 and isinstance(secs, int):
            return round(secs * 1000 / ms)
        return None

    def emit(self, c: dict) -> None:
        self.bus.publish("mlrun", {"run": dict(c)})

    def corrida(self, run_id: str, desde: object = None) -> dict:
        c = self.corridas.get(run_id)
        if c is None:
            raise ApiError("No existe esa corrida", "not_found")
        run = self.runner.get(run_id)
        out = dict(c)
        n = hdfs_mod.bounded_int(desde, "desde", 0, 10 ** 9, 0)
        if run is not None:
            primera = run.count - len(run.lines)
            desde_i = max(n, primera)
            out["lineas"] = [{"n": primera + i, "stream": l["stream"], "texto": l["text"]}
                             for i, l in enumerate(run.lines) if primera + i >= desde_i][:2000]
            out["total"] = run.count
            out["comando"] = run.action.shown
        return out

    def cancelar(self, run_id: str) -> dict:
        c = self.corridas.get(run_id)
        if c is None:
            raise ApiError("No existe esa corrida", "not_found")
        if c["estado"] != "corriendo":
            raise ApiError("La corrida ya terminó", "invalid")
        self.runner.cancel(run_id, "cancelado desde la interfaz")
        if c.get("appId"):
            t = asyncio.get_running_loop().create_task(self._matar_app(c["appId"]))
            self._tasks.add(t)
            t.add_done_callback(self._tasks.discard)
        return c

    async def _matar_app(self, app_id: str) -> None:
        try:
            proc = await asyncio.create_subprocess_exec("yarn", "application", "-kill", app_id,
                                                        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
            await asyncio.wait_for(proc.wait(), 60)
        except (OSError, asyncio.TimeoutError):
            pass

    # ------------------------------------------------------------ experimentos

    @staticmethod
    def _leer_json(p: Path) -> dict | None:
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def _fila(self, d: Path) -> dict | None:
        p = d / "experimento.json"
        try:
            mt = p.stat().st_mtime
        except OSError:
            return None
        guardado = self._resumen.get(d.name)
        if guardado and guardado[0] == mt:
            return guardado[1]
        e = self._leer_json(p)
        if not e:
            return None
        principal = e.get("metrica")
        m = (e.get("metricas") or {}).get(principal) or {}
        datos = e.get("datos") or {}
        fila = {"id": e.get("id", d.name), "nombre": e.get("nombre"), "creado": e.get("creado"),
                "terminado": e.get("terminado"), "estado": e.get("estado"), "origen": e.get("origen"),
                "editado": bool(e.get("editado")), "motor": e.get("motor"), "tarea": e.get("tarea"),
                "modelo": (e.get("modelo") or {}).get("id"), "modeloEtiqueta": (e.get("modelo") or {}).get("etiqueta"),
                "params": (e.get("modelo") or {}).get("params"), "metrica": principal,
                "valor": m.get("cv", m.get("prueba")), "desvio": m.get("cv_desvio"), "prueba": m.get("prueba"),
                "cv": m.get("cv"),
                "metricas": {k: {x: v.get(x) for x in ("prueba", "cv", "cv_desvio", "entrenamiento")}
                             for k, v in (e.get("metricas") or {}).items()},
                "segundos": (e.get("tiempos") or {}).get("total"), "memoriaMb": e.get("memoria_pico_mb"),
                "memoriaYarnMb": (e.get("yarn") or {}).get("memoria_mb"), "modeloBytes": e.get("modelo_bytes"),
                "fuente": datos.get("ruta") or datos.get("tabla"), "filas": datos.get("filas"),
                "hashDatos": datos.get("hash"), "huella": e.get("huella"), "objetivo": e.get("objetivo"),
                "busqueda": (e.get("busqueda") or {}).get("tipo"), "appId": (e.get("yarn") or {}).get("app_id"),
                "error": e.get("error")}
        self._resumen[d.name] = (mt, fila)
        return fila

    def experimentos(self) -> list[dict]:
        if not self.raiz.is_dir():
            return []
        out = []
        for d in sorted(self.raiz.iterdir(), reverse=True):
            if d.is_dir() and EXP_ID.match(d.name):
                f = self._fila(d)
                if f:
                    out.append(f)
        return out[:500]

    def experimento(self, exp_id: str) -> dict:
        d = self.carpeta(exp_id)
        e = self._leer_json(d / "experimento.json") or {}
        e["informe"] = self._leer_json(d / "informe.json")
        e["corriendo"] = next((c["id"] for c in self.corridas.values() if c["experimento"] == exp_id
                               and c["estado"] == "corriendo"), None)
        return e

    def borrar(self, exp_id: str) -> None:
        d = self.carpeta(exp_id)
        if any(c["experimento"] == exp_id and c["estado"] == "corriendo" for c in self.corridas.values()):
            raise ApiError("Ese experimento está corriendo: cancelalo primero", "busy")
        e = self._leer_json(d / "experimento.json") or {}
        shutil.rmtree(d, ignore_errors=True)
        self._resumen.pop(exp_id, None)
        if e.get("modelo_hdfs") and self.c.phase == "running":
            self.runner.start(Action(f"Borrar el modelo {exp_id} de HDFS", ["hdfs", "dfs", "-rm", "-r", "-f", e["modelo_hdfs"]],
                                     source="ML", timeout=120))
        self.bus.log("ML", "info", f"Experimento {exp_id} borrado")

    def descargar(self, exp_id: str, formato: str) -> Response:
        d = self.carpeta(exp_id)
        if formato == "py":
            return PlainTextResponse((d / "codigo.py").read_text(encoding="utf-8"), media_type="text/x-python",
                                     headers={"Content-Disposition": hdfs_mod.attachment(f"{exp_id}.py")})
        if formato == "ipynb":
            nb = gen.a_notebook((d / "codigo.py").read_text(encoding="utf-8"), exp_id)
            return Response(json.dumps(nb, ensure_ascii=False, indent=1), media_type="application/x-ipynb+json",
                            headers={"Content-Disposition": hdfs_mod.attachment(f"{exp_id}.ipynb")})
        if formato == "log":
            p = d / "salida.log"
            return PlainTextResponse(p.read_text(encoding="utf-8") if p.exists() else "", media_type="text/plain",
                                     headers={"Content-Disposition": hdfs_mod.attachment(f"{exp_id}.log")})
        if formato == "modelo":
            p = d / "modelo.joblib"
            if not p.is_file():
                raise ApiError("Este experimento no tiene modelo.joblib (los de Spark quedan en HDFS)", "not_found")
            return Response(p.read_bytes(), media_type="application/octet-stream",
                            headers={"Content-Disposition": hdfs_mod.attachment(f"{exp_id}.joblib")})
        raise ApiError("formato es py, ipynb, modelo o log", "invalid")

    def a_jupyter(self, exp_id: str) -> dict:
        d = self.carpeta(exp_id)
        dest = self.c.s.datos_dir / "experimentos"
        dest.mkdir(parents=True, exist_ok=True)
        nb = gen.a_notebook((d / "codigo.py").read_text(encoding="utf-8"), exp_id)
        (dest / f"{exp_id}.ipynb").write_text(json.dumps(nb, ensure_ascii=False, indent=1), encoding="utf-8")
        shutil.copyfile(d / "codigo.py", dest / f"{exp_id}.py")
        up = any(p["id"] == "jupyter" and p["state"] == "up" for p in self.c.processes)
        return {"ruta": str(dest / f"{exp_id}.ipynb"), "jupyter": up,
                "url": f"http://localhost:8888/lab/tree/experimentos/{exp_id}.ipynb"}

    async def predecir(self, exp_id: str, b: dict) -> dict:
        d = self.carpeta(exp_id)
        e = self._leer_json(d / "experimento.json") or {}
        if e.get("estado") != "listo":
            raise ApiError("Ese experimento no terminó bien: no tiene un modelo para predecir", "invalid")
        if e.get("motor") == "spark":
            self.c.need_hdfs()
        argv = [self.python, "-m", "sandbox_ml.predecir", str(d)]
        if b.get("filas") is not None:
            filas = b["filas"]
            if not isinstance(filas, list) or not filas or len(filas) > 1000 or not all(isinstance(f, dict) for f in filas):
                raise ApiError("filas es una lista de 1 a 1000 objetos {columna: valor}", "invalid")
            argv += ["--filas", json.dumps(filas, ensure_ascii=False)]
            entra = f"{len(filas)} fila{'s' if len(filas) != 1 else ''} escritas a mano"
        elif b.get("archivo") is not None:
            p = _ruta_local(b["archivo"], self.c.s.datos_dir)
            if not p.is_file():
                raise ApiError(f"No existe {b['archivo']}", "not_found")
            argv += ["--archivo", str(p), "--salida", str(p.with_name(p.stem + "_predicciones.csv"))]
            entra = str(p)
        else:
            raise ApiError("Mandá filas: [...] o archivo: /datos/...", "invalid")
        run = await self.runner.run(Action(
            f"Predecir con {exp_id}", argv, display=f"python3 -m sandbox_ml.predecir {exp_id}", input=entra,
            action=f"Predice con {(e.get('modelo') or {}).get('etiqueta', 'el modelo')} guardado", source="ML",
            timeout=600, env=self.env(), cwd=str(d)))
        linea = next((l["text"] for l in reversed(run.lines) if l["text"].startswith(PREDICCION)), None)
        if run.state != "done" or linea is None:
            err = run.error or next((l["text"] for l in reversed(run.lines) if l["stream"] == "err" and l["text"].strip()),
                                    "falló")
            raise ApiError(f"No se pudo predecir: {err}", "failed")
        return json.loads(linea[len(PREDICCION):])

    async def wait_all(self) -> None:
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)

    # ------------------------------------------------------------ rutas

    def routes(self) -> list[Route]:
        async def catalog(_: Request) -> JSONResponse:
            return JSONResponse(self.catalogo())

        async def sources(_: Request) -> JSONResponse:
            return JSONResponse(await self.fuentes())

        async def example(request: Request) -> JSONResponse:
            b = await hdfs_mod._json(request)
            return JSONResponse(await self.ejemplo(b.get("ejemplo")))

        async def profile(request: Request) -> JSONResponse:
            b = await hdfs_mod._json(request)
            return JSONResponse(await self.perfil(b.get("datos"), b.get("objetivo"), b.get("motor"), b.get("modo", "muestra"),
                                                  b.get("filas")))

        async def cleaning_preview(request: Request) -> JSONResponse:
            return JSONResponse(await self.vista_limpieza(await hdfs_mod._json(request)))

        async def cleaning_get(_: Request) -> JSONResponse:
            return JSONResponse(self.limpiezas())

        async def cleaning_one(request: Request) -> JSONResponse:
            return JSONResponse(self.limpieza_guardada(request.path_params["nombre"]))

        async def cleaning_post(request: Request) -> JSONResponse:
            return JSONResponse(self.guardar_limpieza(await hdfs_mod._json(request)), status_code=201)

        async def check(request: Request) -> JSONResponse:
            b = await hdfs_mod._json(request)
            return JSONResponse(self.revisar(b.get("receta")))

        async def code(request: Request) -> JSONResponse:
            b = await hdfs_mod._json(request)
            return JSONResponse(self.codigo(b.get("receta"), parte=b.get("parte", "entrenamiento"), opciones=b.get("opciones")))

        async def experiments_post(request: Request) -> JSONResponse:
            b = await hdfs_mod._json(request)
            return JSONResponse(await self.entrenar(b.get("receta")), status_code=202)

        async def experiments_get(_: Request) -> JSONResponse:
            return JSONResponse(self.experimentos())

        async def experiment_get(request: Request) -> JSONResponse:
            return JSONResponse(self.experimento(request.path_params["id"]))

        async def experiment_delete(request: Request) -> Response:
            self.borrar(request.path_params["id"])
            return Response(status_code=204)

        async def download(request: Request) -> Response:
            return self.descargar(request.path_params["id"], request.query_params.get("formato", "py"))

        async def jupyter(request: Request) -> JSONResponse:
            return JSONResponse(self.a_jupyter(request.path_params["id"]))

        async def predict(request: Request) -> JSONResponse:
            b = await hdfs_mod._json(request)
            return JSONResponse(await self.predecir(request.path_params["id"], b))

        async def runs_post(request: Request) -> JSONResponse:
            b = await hdfs_mod._json(request)
            return JSONResponse(await self.correr_codigo(b), status_code=202)

        async def runs_get(_: Request) -> JSONResponse:
            return JSONResponse(list(reversed([dict(c) for c in self.corridas.values()])))

        async def run_get(request: Request) -> JSONResponse:
            return JSONResponse(self.corrida(request.path_params["id"], request.query_params.get("desde")))

        async def run_cancel(request: Request) -> JSONResponse:
            return JSONResponse(self.cancelar(request.path_params["id"]), status_code=202)

        return [
            Route("/api/ml/catalog", catalog, methods=["GET"]),
            Route("/api/ml/sources", sources, methods=["GET"]),
            Route("/api/ml/sources/example", example, methods=["POST"]),
            Route("/api/ml/profile", profile, methods=["POST"]),
            Route("/api/ml/cleaning/preview", cleaning_preview, methods=["POST"]),
            Route("/api/ml/cleaning", cleaning_get, methods=["GET"]),
            Route("/api/ml/cleaning", cleaning_post, methods=["POST"]),
            Route("/api/ml/cleaning/{nombre}", cleaning_one, methods=["GET"]),
            Route("/api/ml/check", check, methods=["POST"]),
            Route("/api/ml/code", code, methods=["POST"]),
            Route("/api/ml/experiments", experiments_post, methods=["POST"]),
            Route("/api/ml/experiments", experiments_get, methods=["GET"]),
            Route("/api/ml/experiments/{id}", experiment_get, methods=["GET"]),
            Route("/api/ml/experiments/{id}", experiment_delete, methods=["DELETE"]),
            Route("/api/ml/experiments/{id}/download", download, methods=["GET"]),
            Route("/api/ml/experiments/{id}/jupyter", jupyter, methods=["POST"]),
            Route("/api/ml/experiments/{id}/predict", predict, methods=["POST"]),
            Route("/api/ml/runs", runs_post, methods=["POST"]),
            Route("/api/ml/runs", runs_get, methods=["GET"]),
            Route("/api/ml/runs/{id}", run_get, methods=["GET"]),
            Route("/api/ml/runs/{id}/cancel", run_cancel, methods=["POST"]),
        ]
