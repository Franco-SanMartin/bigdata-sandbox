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
from starlette.requests import Request
from starlette.responses import HTMLResponse, JSONResponse, PlainTextResponse, Response, StreamingResponse
from starlette.routing import Mount, Route
from starlette.staticfiles import StaticFiles

from . import config as cfg
from . import probes
from .actions import ActionRunner
from .boot import now_ms
from .cluster import Cluster, Conflict, Invalid, Settings
from .events import EventBus, sse_stream


def _error(status: int, message: str, **extra: object) -> JSONResponse:
    return JSONResponse({"error": message, **extra}, status_code=status)


async def _config_from(request: Request) -> object:
    try:
        body = await request.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise Invalid("el cuerpo tiene que ser JSON") from None
    if not isinstance(body, dict) or "config" not in body:
        raise Invalid("falta { config }")
    return body["config"]


ACCEPTED = Response(status_code=202)


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
            return _error(404, "no existe esa acción")
        return JSONResponse(run.to_json())

    async def datanodes(_: Request) -> JSONResponse:
        running = {int(p["id"][2:]) for p in cluster.processes
                   if p["kind"] == "datanode" and p["state"] in ("up", "starting")}
        expected = max([cluster.config["datanodes"], *running])
        return JSONResponse(probes.datanodes_from_jmx(cluster.nn_jmx, now_ms(), expected, running))

    async def files(_: Request) -> JSONResponse:
        if cluster.phase != "running" or not cluster.hdfs["available"]:
            return JSONResponse([])
        proc = await asyncio.create_subprocess_exec(
            "hdfs", "fsck", "/", "-files", "-blocks", "-locations",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, stdin=asyncio.subprocess.DEVNULL)
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=30)
        except asyncio.TimeoutError:
            proc.kill()
            return _error(504, "hdfs fsck tardó demasiado")
        return JSONResponse(probes.parse_fsck(out.decode("utf-8", "replace"),
                                              cfg.block_size_mb(cluster.config["blockSize"])))

    async def api_not_found(request: Request) -> JSONResponse:
        return _error(404, f"todavía no hay {request.method} /api/{request.path_params['rest']}")

    async def on_invalid(_: Request, e: Exception) -> JSONResponse:
        assert isinstance(e, Invalid)
        return _error(400, str(e), issues=e.issues) if e.issues else _error(400, str(e))

    async def on_conflict(_: Request, e: Exception) -> JSONResponse:
        return _error(409, str(e))

    async def on_http(request: Request, e: Exception) -> Response:
        assert isinstance(e, HTTPException)
        if request.url.path.startswith("/api/"):
            return _error(e.status_code, e.detail)
        return PlainTextResponse(e.detail, status_code=e.status_code)

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
        Route("/api/hdfs/datanodes", datanodes),
        Route("/api/hdfs/files", files),
        Route("/api/{rest:path}", api_not_found, methods=["GET", "POST", "PUT", "PATCH", "DELETE"]),
    ]
    if ui.is_dir():
        api.append(Mount("/", StaticFiles(directory=ui, html=True), name="ui"))
    else:
        async def no_ui(_: Request) -> HTMLResponse:
            return HTMLResponse("<p>El servidor anda, pero no encuentra la interfaz en "
                                f"<code>{ui}</code>. La API está en <code>/api/status</code>.</p>")
        api.append(Route("/", no_ui))

    @contextlib.asynccontextmanager
    async def lifespan(app: Starlette):
        cluster.start_polling()
        yield
        bus.close()
        await cluster.shutdown()
        await runner.wait_all()

    app = Starlette(routes=api, lifespan=lifespan,
                    exception_handlers={Invalid: on_invalid, Conflict: on_conflict, HTTPException: on_http})
    app.state.cluster = cluster
    app.state.bus = bus
    app.state.runner = runner
    return app

