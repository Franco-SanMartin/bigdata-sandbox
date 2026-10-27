"""Las rutas /api/... del contrato de la interfaz (ui/src/api/types.ts) y los
archivos de la interfaz en /."""
from __future__ import annotations

import asyncio
import contextlib
import json
import os
from pathlib import Path

from starlette.applications import Starlette
from starlette.exceptions import HTTPException
from starlette.middleware import Middleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, PlainTextResponse, Response, StreamingResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from . import config as cfg
from . import datos as datos_mod
from . import hdfs as hdfs_mod
from . import ml as ml_mod
from . import pipeline as pipeline_mod
from . import yarn as yarn_mod
from .actions import ActionRunner
from .cluster import Cluster, Conflict, Invalid, Settings
from .errors import ApiError, code_for_status
from .events import EventBus, sse_stream
from .seguridad import SoloLaInterfaz, hosts_permitidos


def _error(status: int, message: str, code: str, **extra: object) -> JSONResponse:
    return JSONResponse({"error": message, "code": code, **extra}, status_code=status)


async def _config_from(request: Request) -> object:
    try:
        body = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise Invalid("el cuerpo tiene que ser JSON") from None
    if not isinstance(body, dict) or "config" not in body:
        raise Invalid("falta { config }")
    return body["config"]


ACCEPTED = Response(status_code=202)


class SpaFiles(StaticFiles):
    """Los archivos de ui/dist. Una ruta que no es un archivo (un enlace a una
    pantalla, una recarga) devuelve index.html y la interfaz decide qué mostrar."""

    async def get_response(self, path: str, scope):
        try:
            return await super().get_response(path, scope)
        except HTTPException as e:
            if e.status_code != 404 or "." in path.rsplit("/", 1)[-1]:
                raise
            return await super().get_response("index.html", scope)


def build_app(settings: Settings | None = None, ui_dir: str | Path | None = None) -> Starlette:
    bus = EventBus()
    runner = ActionRunner(bus)
    cluster = Cluster(bus, runner, settings)
    ui = Path(ui_dir or os.environ.get("UI_DIR", "/opt/sandbox/ui"))

    async def status(_: Request) -> JSONResponse:
        return JSONResponse(cluster.status())

    async def activity(request: Request) -> JSONResponse:
        try:
            limit = int(request.query_params.get("limit", "200"))
        except ValueError:
            limit = 200
        return JSONResponse(bus.recent(limit))

    async def events(_: Request) -> StreamingResponse:
        return StreamingResponse(sse_stream(bus), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

    async def validate(request: Request) -> JSONResponse:
        c, issues = cluster.check(await _config_from(request))
        return JSONResponse(issues)

    async def estimate(request: Request) -> JSONResponse:
        c, _ = cluster.check(await _config_from(request))
        return JSONResponse(cfg.estimate_ram(c, cluster.mem_limit or cfg.DOCKER_LIMIT_MB))

    async def compose(request: Request) -> PlainTextResponse:
        c, _ = cluster.check(await _config_from(request))
        return PlainTextResponse(cfg.compose_yaml(c), media_type="text/yaml",
                                 headers={"Content-Disposition": 'inline; filename="docker-compose.yml"'})

    async def save(request: Request) -> Response:
        cluster.save_config(await _config_from(request))
        return Response(status_code=204)

    def background(coro) -> None:
        t = asyncio.get_running_loop().create_task(coro)
        tasks.add(t)
        t.add_done_callback(tasks.discard)

    tasks: set[asyncio.Task] = set()

    async def start(request: Request) -> Response:
        raw = await _config_from(request)
        c, issues = cluster.check(raw)
        if cfg.has_errors(issues):
            raise Invalid("la configuración tiene errores", issues)
        if cluster.phase != "stopped":
            raise Conflict(f"el cluster no está apagado (está {cluster.phase})")
        await cluster.start(c)
        return ACCEPTED

    async def stop(_: Request) -> Response:
        background(cluster.stop())
        return ACCEPTED

    async def apply(request: Request) -> Response:
        raw = await _config_from(request)
        c, issues = cluster.check(raw)
        if cfg.has_errors(issues):
            raise Invalid("la configuración tiene errores", issues)
        if cluster.phase == "stopping":
            raise Conflict("el cluster se está apagando")
        background(cluster.apply(c))
        return ACCEPTED

    async def reset(_: Request) -> Response:
        await cluster.reset()
        return ACCEPTED

    async def process_action(request: Request) -> JSONResponse:
        run_id = cluster.process_action(request.path_params["id"], request.path_params["action"])
        return JSONResponse({"id": run_id}, status_code=202)

    async def action_get(request: Request) -> JSONResponse:
        run = runner.get(request.path_params["id"])
        if run is None:
            raise ApiError("No existe esa acción", "not_found")
        return JSONResponse(run.to_json())

    async def api_not_found(request: Request) -> JSONResponse:
        raise ApiError(f"No hay {request.method} /api/{request.path_params['rest']}", "not_found")

    async def on_api_error(_: Request, e: Exception) -> JSONResponse:
        assert isinstance(e, ApiError)
        return JSONResponse(e.body(), status_code=e.status)

    async def on_http(request: Request, e: Exception) -> Response:
        assert isinstance(e, HTTPException)
        if request.url.path.startswith("/api/"):
            return _error(e.status_code, e.detail, code_for_status(e.status_code))
        return PlainTextResponse(e.detail, status_code=e.status_code)

    hdfs = hdfs_mod.Hdfs(cluster, runner, bus)
    yarn = yarn_mod.Yarn(cluster, runner, bus)
    yarn.hdfs = hdfs
    datos = datos_mod.Datos(cluster, runner, bus, hdfs)
    ml = ml_mod.Ml(cluster, runner, bus, hdfs)
    pipeline = pipeline_mod.Pipeline(cluster, runner, bus, hdfs, datos, ml)

    api = [
        Route("/api/status", status),
        Route("/api/activity", activity),
        Route("/api/events", events),
        Route("/api/config/validate", validate, methods=["POST"]),
        Route("/api/config/estimate", estimate, methods=["POST"]),
        Route("/api/config/compose", compose, methods=["POST"]),
        Route("/api/config", save, methods=["PUT"]),
        Route("/api/cluster/start", start, methods=["POST"]),
        Route("/api/cluster/stop", stop, methods=["POST"]),
        Route("/api/cluster/apply", apply, methods=["POST"]),
        Route("/api/cluster/reset", reset, methods=["POST"]),
        Route("/api/processes/{id}/{action:str}", process_action, methods=["POST"]),
        Route("/api/actions/{id}", action_get),
        *hdfs.routes(),
        *yarn.routes(),
        *pipeline.routes(),
        *datos.routes(),
        *ml.routes(),
        Route("/api/{rest:path}", api_not_found, methods=["GET", "POST", "PUT", "PATCH", "DELETE"]),
    ]
    if ui.is_dir():
        api.append(Mount("/", SpaFiles(directory=ui, html=True), name="ui"))
    else:
        async def no_ui(_: Request) -> HTMLResponse:
            return HTMLResponse("<p>El servidor anda, pero no encuentra la interfaz en "
                                f"<code>{ui}</code>. La API está en <code>/api/status</code>.</p>")
        api.append(Route("/", no_ui))

    async def autostart() -> None:
        """AUTOSTART=1: arranca solo con la configuración de las variables de
        entorno (la misma que leen :base y :ml), como si apretaran «Iniciar»."""
        c, issues = cluster.check(cfg.from_env())
        if cfg.has_errors(issues):
            bus.log("Cluster", "error", "AUTOSTART: las variables tienen errores, no arranca solo",
                    tech="; ".join(i["message"] for i in issues if i.get("level") == "error"))
            return
        bus.log("Cluster", "info", "AUTOSTART=1: arranca solo con las variables del contenedor")
        try:
            await cluster.start(c)
        except ApiError as e:
            bus.log("Cluster", "error", "AUTOSTART: no se pudo arrancar", tech=str(e))

    @contextlib.asynccontextmanager
    async def lifespan(app: Starlette):
        cluster.start_polling()
        if cluster.s.autostart:
            await autostart()
        yield
        bus.close()
        await cluster.shutdown()
        await runner.wait_all()
        await ml.wait_all()
        await pipeline.wait_all()

    # Solo la propia interfaz: host confiable, origen y cuerpos JSON (seguridad.py)
    app = Starlette(routes=api, lifespan=lifespan,
                    middleware=[Middleware(TrustedHostMiddleware, allowed_hosts=hosts_permitidos(), www_redirect=False),
                                Middleware(SoloLaInterfaz)],
                    exception_handlers={ApiError: on_api_error, HTTPException: on_http})
    app.state.cluster = cluster
    app.state.bus = bus
    app.state.runner = runner
    app.state.hdfs = hdfs
    app.state.yarn = yarn
    app.state.datos = datos
    app.state.ml = ml
    app.state.pipeline = pipeline
    return app

