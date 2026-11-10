"""La biblioteca de modelos y la predicción: las rutas /api/ml/library/... (etapa (d) del estudio de ML).

    GET  /api/ml/library                         los modelos: versión en producción, su métrica y las candidatas
    POST /api/ml/library                         {nombre, experimento, nota?, descripcion?} → versión nueva (candidato).
                                                 Con Spark copia el PipelineModel a hdfs:///user/root/ml/biblioteca/<nombre>/v<N>
    GET  /api/ml/library/batches                 los lotes de predicción corridos, del más nuevo al más viejo
    GET  /api/ml/library/{nombre}                el modelo con sus versiones, el linaje y el historial
    POST /api/ml/library/{nombre}/state          {accion: promover | archivar | volver, version?, nota?}
    POST /api/ml/library/{nombre}/describe       {descripcion}
    GET  /api/ml/library/{nombre}/compare?versiones=1,2
    POST /api/ml/library/{nombre}/predict        {filas: [...] | archivo: /datos/..., version?} → al instante
    POST /api/ml/library/{nombre}/code           {version?, datos, salida} → el PySpark de la predicción por lotes
    POST /api/ml/library/{nombre}/batch          {version?, datos, salida, recursos?, minutos?} → 202 {id, run}
    GET  /api/ml/library/{nombre}/export?version=N   un .zip con el modelo, su ficha y un servicio mínimo

Los archivos los maneja sandbox_ml.biblioteca (en el volumen, /hadoop/ml/biblioteca); acá solo lo que necesita
el cluster: copiar el modelo de Spark en HDFS, correr el lote con spark-submit en YARN (el mismo lanzador de
las corridas del estudio, con su límite de tiempo y memoria) y bajar el modelo para exportarlo.
"""
from __future__ import annotations

import asyncio
import json
import secrets
import shutil
import tempfile
import time
from pathlib import Path

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from sandbox_ml import biblioteca as bib
from sandbox_ml import exportar as exp_mod
from sandbox_ml import lote as lote_mod
from sandbox_ml import receta as rec

from . import hdfs as hdfs_mod
from .actions import Action
from .errors import ApiError
from .ml_estudio import Estudio, _ruta_local

MAX_LOTES = 100


def _nuevo_lote() -> str:
    return time.strftime("lote-%Y%m%d-%H%M%S-") + secrets.token_hex(2)


def _bib(f, *a, **kw):
    """Las funciones de sandbox_ml.biblioteca, con sus errores como ApiError (no existe → 404)."""
    try:
        return f(*a, **kw)
    except bib.ErrorBiblioteca as e:
        msg = str(e)
        raise ApiError(msg, "not_found" if msg.startswith(("No hay un modelo", "No existe")) or "no tiene la versión" in msg
                       else "invalid") from None


class Biblioteca:
    def __init__(self, estudio: Estudio):
        self.e = estudio
        self._lock = asyncio.Lock()

    @property
    def raiz(self) -> Path:
        return self.e.c.s.hadoop_dir / "ml" / "biblioteca"

    @property
    def dir_lotes(self) -> Path:
        return self.e.c.s.hadoop_dir / "ml" / "lotes"

    def _hdfs_arriba(self) -> bool:
        try:
            self.e.c.need_hdfs()
            return True
        except ApiError:
            return False

    async def _hdfs(self, titulo: str, *args: str, timeout: int = 300) -> None:
        run = await self.e.runner.run(Action(titulo, ["hdfs", "dfs", *args], source="ML", timeout=timeout))
        if run.state != "done":
            err = run.error or next((l["text"] for l in reversed(run.lines) if l["text"].strip()), "falló")
            raise ApiError(f"{titulo}: {err}", "failed")

    # ------------------------------------------------------------ modelos

    def listar(self) -> list[dict]:
        return bib.listar(self.raiz) if self.raiz.is_dir() else []

    def modelo(self, nombre: str) -> dict:
        m = _bib(bib.leer, nombre, self.raiz)
        m["lotes"] = [l for l in self.lotes() if l.get("modelo") == nombre][:20]
        return m

    async def registrar(self, b: dict) -> dict:
        nombre = _bib(bib.nombre_ok, b.get("nombre"))
        d = self.e.carpeta(b.get("experimento"))
        exp = self.e._leer_json(d / "experimento.json") or {}
        if exp.get("estado") != "listo":
            raise ApiError("Ese experimento no terminó bien: solo se guardan los que están listos", "invalid")
        nota = b.get("nota") or ""
        if not isinstance(nota, str) or len(nota) > 500:
            raise ApiError("La nota es un texto de hasta 500 letras", "invalid")
        async with self._lock:
            try:
                m = bib.leer(nombre, self.raiz)
                n = max((x["version"] for x in m["versiones"]), default=0) + 1
            except bib.ErrorBiblioteca:
                n = 1
            destino = None
            if exp.get("motor") == "spark":
                # El modelo del experimento se copia: borrar el experimento no rompe la biblioteca
                self.e.c.need_hdfs()
                destino = bib.ruta_hdfs(nombre, n)
                await self._hdfs(f"Biblioteca: crear la carpeta de {nombre}", "-mkdir", "-p", destino.rsplit("/", 1)[0])
                await self._hdfs(f"Biblioteca: copiar el modelo de {exp['id']} a {destino}", "-cp", "-f",
                                 exp["modelo_hdfs"], destino, timeout=900)
            x = _bib(bib.registrar, nombre, d, nota=nota, descripcion=b.get("descripcion"), base=self.raiz,
                     modelo_hdfs=destino)
            if exp.get("motor") != "spark" and self._hdfs_arriba():
                # Una copia del joblib también en HDFS, al lado de los de Spark (si HDFS no está, queda en el volumen)
                try:
                    dst = bib.ruta_hdfs(nombre, x["version"])
                    await self._hdfs(f"Biblioteca: crear {dst}", "-mkdir", "-p", dst)
                    await self._hdfs(f"Biblioteca: subir el modelo de {exp['id']}", "-put", "-f",
                                     str(bib.carpeta_version(nombre, x["version"], self.raiz) / "modelo.joblib"), dst)
                    m = bib.leer(nombre, self.raiz)
                    bib.version(m, x["version"])["copia_hdfs"] = f"{dst}/modelo.joblib"
                    bib._guardar(m, self.raiz)
                except ApiError:
                    pass
        self.e.bus.log("ML", "ok", f"Biblioteca: {nombre} v{x['version']} desde {exp['id']}")
        return self.modelo(nombre)

    def estado(self, nombre: str, b: dict) -> dict:
        accion, nota = b.get("accion"), b.get("nota") or ""
        if not isinstance(nota, str) or len(nota) > 500:
            raise ApiError("La nota es un texto de hasta 500 letras", "invalid")
        if accion == "promover":
            _bib(bib.promover, nombre, b.get("version"), nota=nota, base=self.raiz)
        elif accion == "archivar":
            _bib(bib.archivar, nombre, b.get("version"), nota=nota, base=self.raiz)
        elif accion == "volver":
            _bib(bib.volver_atras, nombre, nota=nota, base=self.raiz)
        else:
            raise ApiError("accion es promover, archivar o volver", "invalid")
        self.e.bus.log("ML", "info", f"Biblioteca: {nombre}, {accion}" + (f" v{b.get('version')}" if b.get("version") else ""))
        return self.modelo(nombre)

    def describir(self, nombre: str, b: dict) -> dict:
        d = b.get("descripcion")
        if not isinstance(d, str) or len(d) > 500:
            raise ApiError("La descripción es un texto de hasta 500 letras", "invalid")
        _bib(bib.describir, nombre, d, self.raiz)
        return self.modelo(nombre)

    def comparar(self, nombre: str, versiones: str | None) -> dict:
        vs = [v for v in (versiones or "").split(",") if v.strip()] or None
        return _bib(bib.comparar, nombre, vs, self.raiz)

    # ------------------------------------------------------------ predecir

    def _version(self, nombre: str, v: object) -> tuple[dict, dict, Path]:
        m, x = _bib(bib.elegir, nombre, v, self.raiz)
        return m, x, bib.carpeta_version(nombre, x["version"], self.raiz)

    async def predecir(self, nombre: str, b: dict) -> dict:
        m, x, dv = self._version(nombre, b.get("version"))
        e = self.e._leer_json(dv / "experimento.json") or {}
        out = await self.e.predecir_en(dv, e, b, f"{nombre} v{x['version']}")
        out["version"] = x["version"]
        out["estado"] = x["estado"]
        return out

    def _pedido_lote(self, nombre: str, b: dict) -> tuple[dict, dict, Path, dict, dict]:
        m, x, dv = self._version(nombre, b.get("version"))
        if x.get("tarea") == "recomendacion" and x.get("motor") != "spark":
            raise ApiError("La recomendación solo predice con Spark", "invalid")
        datos = self.e._datos_ok(b.get("datos"))
        if datos["origen"] == "local":
            _ruta_local(datos["ruta"], self.e.c.s.datos_dir)
        salida, errores = lote_mod.normalizar_salida(b.get("salida"), nombre, x["version"])
        if errores:
            raise ApiError(errores[0]["mensaje"], "invalid", field=errores[0]["campo"])
        return m, x, dv, datos, salida

    def codigo_lote(self, nombre: str, b: dict) -> dict:
        _, x, dv, datos, salida = self._pedido_lote(nombre, b)
        codigo = lote_mod.generar(x, dv, datos, salida, nombre=nombre, fecha=time.strftime("%Y-%m-%d"))
        recursos, _ = rec.recursos(b.get("recursos"))
        return {"codigo": codigo, "comando": self.e.comando_texto("spark", f"predecir_{nombre}_v{x['version']}.py", recursos)}

    async def lote(self, nombre: str, b: dict) -> dict:
        _, x, dv, datos, salida = self._pedido_lote(nombre, b)
        recursos, errores = rec.recursos(b.get("recursos"))
        if errores:
            raise ApiError(f"{errores[0]['campo']}: {errores[0]['mensaje']}", "invalid", field=errores[0]["campo"])
        minutos = hdfs_mod.bounded_int(b.get("minutos"), "minutos", 1, 240, 30)
        if datos["origen"] != "local" or salida["tipo"] == "hdfs":
            self.e.c.need_hdfs()
        lote_id = _nuevo_lote()
        codigo = lote_mod.generar(x, dv, datos, salida, nombre=nombre, fecha=time.strftime("%Y-%m-%d"))
        entrada = datos.get("ruta") or datos.get("tabla")
        info = {"carpeta": str(self.dir_lotes / lote_id), "titulo": f"{nombre} v{x['version']} sobre {entrada}",
                "modelo": nombre, "version": x["version"], "estado_version": x["estado"], "motor_modelo": x.get("motor"),
                "datos": datos, "salida": salida, "entrada": entrada}
        return await self.e.lanzar(codigo, "spark", None, "lote", minutos=minutos,
                                   memoria_mb=self.e._memoria_driver(recursos), exp_id=lote_id, editado=False,
                                   recursos=recursos, lote=info)

    def lotes(self) -> list[dict]:
        if not self.dir_lotes.is_dir():
            return []
        out = []
        for d in sorted(self.dir_lotes.glob("lote-*"), reverse=True)[:MAX_LOTES]:
            l = self.e._leer_json(d / "lote.json")
            if l:
                out.append(l)
        return out

    # ------------------------------------------------------------ exportar

    async def exportar(self, nombre: str, v: object) -> Response:
        if v not in (None, ""):
            _, x, dv = self._version(nombre, v)
        else:
            _, x, dv = self._version_cualquiera(nombre)
        tmp = Path(tempfile.mkdtemp(prefix="exportar-"))
        try:
            local = None
            if x.get("motor") == "spark":
                self.e.c.need_hdfs()
                local = tmp / "modelo"
                await self._hdfs(f"Exportar {nombre} v{x['version']}: bajar el modelo de HDFS", "-get", x["artefacto"],
                                 str(local), timeout=900)
            zip_ = tmp / f"{nombre}-v{x['version']}.zip"
            await asyncio.to_thread(exp_mod.armar, nombre, x, dv, zip_, modelo_local=local)
            datos = zip_.read_bytes()
        except ValueError as e:
            raise ApiError(f"No se pudo exportar: {e}", "failed") from None
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        return Response(datos, media_type="application/zip",
                        headers={"Content-Disposition": hdfs_mod.attachment(f"{nombre}-v{x['version']}.zip")})

    def _version_cualquiera(self, nombre: str) -> tuple[dict, dict, Path]:
        """La versión en producción o, si no hay, la última."""
        m = _bib(bib.leer, nombre, self.raiz)
        x = bib.en_produccion(m) or (m["versiones"][-1] if m["versiones"] else None)
        if not x:
            raise ApiError(f"{nombre} no tiene versiones", "invalid")
        return m, x, bib.carpeta_version(nombre, x["version"], self.raiz)

    # ------------------------------------------------------------ rutas

    def routes(self) -> list[Route]:
        cuerpo = hdfs_mod._json

        async def lista(_: Request) -> JSONResponse:
            return JSONResponse(self.listar())

        async def registrar(request: Request) -> JSONResponse:
            return JSONResponse(await self.registrar(await cuerpo(request)), status_code=201)

        async def lotes(_: Request) -> JSONResponse:
            return JSONResponse(self.lotes())

        async def uno(request: Request) -> JSONResponse:
            return JSONResponse(self.modelo(request.path_params["nombre"]))

        async def estado(request: Request) -> JSONResponse:
            return JSONResponse(self.estado(request.path_params["nombre"], await cuerpo(request)))

        async def describir(request: Request) -> JSONResponse:
            return JSONResponse(self.describir(request.path_params["nombre"], await cuerpo(request)))

        async def comparar(request: Request) -> JSONResponse:
            return JSONResponse(self.comparar(request.path_params["nombre"], request.query_params.get("versiones")))

        async def predecir(request: Request) -> JSONResponse:
            return JSONResponse(await self.predecir(request.path_params["nombre"], await cuerpo(request)))

        async def codigo(request: Request) -> JSONResponse:
            return JSONResponse(self.codigo_lote(request.path_params["nombre"], await cuerpo(request)))

        async def lote(request: Request) -> JSONResponse:
            return JSONResponse(await self.lote(request.path_params["nombre"], await cuerpo(request)), status_code=202)

        async def exportar(request: Request) -> Response:
            return await self.exportar(request.path_params["nombre"], request.query_params.get("version"))

        return [
            Route("/api/ml/library", lista, methods=["GET"]),
            Route("/api/ml/library", registrar, methods=["POST"]),
            Route("/api/ml/library/batches", lotes, methods=["GET"]),
            Route("/api/ml/library/{nombre}", uno, methods=["GET"]),
            Route("/api/ml/library/{nombre}/state", estado, methods=["POST"]),
            Route("/api/ml/library/{nombre}/describe", describir, methods=["POST"]),
            Route("/api/ml/library/{nombre}/compare", comparar, methods=["GET"]),
            Route("/api/ml/library/{nombre}/predict", predecir, methods=["POST"]),
            Route("/api/ml/library/{nombre}/code", codigo, methods=["POST"]),
            Route("/api/ml/library/{nombre}/batch", lote, methods=["POST"]),
            Route("/api/ml/library/{nombre}/export", exportar, methods=["GET"]),
        ]
