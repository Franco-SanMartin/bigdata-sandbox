"""Ejecutor de acciones: corre un comando del cluster y deja registrado lo que
la interfaz muestra de cada acción:

    comando -> qué entra -> qué hace -> cómo quedan los datos (antes / después)

La salida del comando llega en vivo por SSE (evento 'action', línea por línea)
y al terminar queda como una entrada de la consola (Activity). Lo usan las
acciones sobre procesos y lo van a usar los pasos del Pipeline y de ML.
"""
from __future__ import annotations

import asyncio
import itertools
import os
import shlex
import signal
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Awaitable, Callable

from .boot import now_ms
from .events import EventBus
from .proc import exited

Snapshot = Callable[[], Awaitable[object]]
MAX_LINES = 2000
MAX_RUNS = 100


@dataclass
class Action:
    title: str
    # El comando: lista (exec directo) o texto (se corre con bash -c)
    command: list[str] | str
    # Qué entra (archivo, tabla, parámetros) y qué hace, en una línea cada uno
    input: str | None = None
    action: str | None = None
    source: str = "Vos"
    # Cómo están los datos antes y después (p. ej. bloques de un archivo, filas de una tabla)
    before: Snapshot | None = None
    after: Snapshot | None = None
    env: dict[str, str] | None = None
    cwd: str | None = None
    timeout: float = 600
    process_id: str | None = None
    app_id: str | None = None
    # Lo que se muestra como comando (si no, el comando mismo)
    display: str | None = None

    @property
    def shown(self) -> str:
        if self.display:
            return self.display
        return self.command if isinstance(self.command, str) else shlex.join(self.command)


@dataclass
class Run:
    id: str
    action: Action
    state: str = "running"
    startedAt: int = field(default_factory=now_ms)
    finishedAt: int | None = None
    exitCode: int | None = None
    before: object = None
    after: object = None
    lines: list[dict] = field(default_factory=list)
    error: str | None = None
    # Líneas que salieron en total (lines guarda las últimas MAX_LINES) y el proceso, para cancelarlo
    count: int = 0
    pid: int | None = None

    def to_json(self) -> dict:
        a = self.action
        d = {"id": self.id, "title": a.title, "command": a.shown, "input": a.input, "action": a.action,
             "source": a.source, "state": self.state, "startedAt": self.startedAt, "finishedAt": self.finishedAt,
             "exitCode": self.exitCode, "before": self.before, "after": self.after, "lines": list(self.lines)}
        if self.error:
            d["error"] = self.error
        return {k: v for k, v in d.items() if v is not None}


def _summary(v: object) -> str | None:
    if v is None:
        return None
    if isinstance(v, str):
        return v
    if isinstance(v, dict):
        return " · ".join(f"{k}: {x}" for k, x in v.items())
    return str(v)


class ActionRunner:
    def __init__(self, bus: EventBus, base_env: dict[str, str] | None = None):
        self.bus = bus
        self.base_env = base_env
        self.runs: "OrderedDict[str, Run]" = OrderedDict()
        self._seq = itertools.count(1)
        self._tasks: set[asyncio.Task] = set()

    def get(self, run_id: str) -> Run | None:
        return self.runs.get(run_id)

    def start(self, action: Action) -> Run:
        """Lanza la acción en segundo plano y devuelve su registro (para un 202)."""
        run = self._new(action)
        t = asyncio.get_running_loop().create_task(self._execute(run))
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)
        return run

    async def run(self, action: Action) -> Run:
        run = self._new(action)
        await self._execute(run)
        return run

    def _new(self, action: Action) -> Run:
        run = Run(id=f"x{next(self._seq)}", action=action)
        self.runs[run.id] = run
        while len(self.runs) > MAX_RUNS:
            self.runs.popitem(last=False)
        return run

    def _line(self, run: Run, stream: str, text: str) -> None:
        entry = {"t": now_ms(), "stream": stream, "text": text}
        run.lines.append(entry)
        run.count += 1
        if len(run.lines) > MAX_LINES:
            del run.lines[: len(run.lines) - MAX_LINES]
        self.bus.publish("action", {"id": run.id, **entry})

    async def _snap(self, fn: Snapshot | None) -> object:
        if fn is None:
            return None
        try:
            return await fn()
        except Exception as e:  # noqa: BLE001 (un snapshot roto no frena la acción)
            return f"(no se pudo leer: {e})"

    async def _execute(self, run: Run) -> None:
        a = run.action
        self.bus.log(a.source, "info", a.title, command=a.shown, input=a.input, action=a.action,
                     processId=a.process_id, appId=a.app_id)
        self.bus.publish("action", {"id": run.id, "state": "running", "title": a.title, "command": a.shown})
        run.before = await self._snap(a.before)
        env = dict(os.environ if self.base_env is None else self.base_env)
        env.update(a.env or {})
        argv = ["bash", "-c", a.command] if isinstance(a.command, str) else list(a.command)
        try:
            proc = await asyncio.create_subprocess_exec(
                *argv, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                stdin=asyncio.subprocess.DEVNULL, env=env, cwd=a.cwd, start_new_session=True)
        except OSError as e:
            run.error = str(e)
            await self._finish(run, None)
            return
        run.pid = proc.pid

        async def pump(stream: asyncio.StreamReader, name: str) -> None:
            while True:
                raw = await stream.readline()
                if not raw:
                    break
                self._line(run, name, raw.decode("utf-8", "replace").rstrip("\r\n"))

        pumps = asyncio.gather(pump(proc.stdout, "out"), pump(proc.stderr, "err"))
        if await exited(proc, a.timeout) is None:
            proc.kill()
            await exited(proc, 2)
            run.error = f"cortado: tardó más de {a.timeout:g} s"
        # Un daemon lanzado con '&' puede quedarse con la salida abierta: lo que
        # falte leer tiene un segundo
        try:
            await asyncio.wait_for(pumps, timeout=1)
        except asyncio.TimeoutError:
            pumps.cancel()
        await self._finish(run, proc.returncode)

    async def _finish(self, run: Run, code: int | None) -> None:
        a = run.action
        run.exitCode = code
        run.after = await self._snap(a.after)
        run.state = "done" if code == 0 and not run.error else "failed"
        run.finishedAt = now_ms()
        last_err = next((l["text"] for l in reversed(run.lines) if l["stream"] == "err" and l["text"].strip()), None)
        out = _summary(run.after)
        if out is None:
            out = next((l["text"] for l in reversed(run.lines) if l["stream"] == "out" and l["text"].strip()), None)
        before = _summary(run.before)
        if before and out:
            out = f"antes: {before} → después: {out}"
        self.bus.log(a.source, "ok" if run.state == "done" else "error",
                     a.title if run.state == "done" else f"{a.title}: falló",
                     command=a.shown, input=a.input, action=a.action, output=out,
                     tech=run.error or (last_err if run.state == "failed" else None),
                     processId=a.process_id, appId=a.app_id)
        self.bus.publish("action", {"id": run.id, "state": run.state, "exitCode": code})

    def cancel(self, run_id: str, why: str = "cancelado") -> bool:
        """Corta una acción en curso: SIGTERM a todo su grupo de procesos (y SIGKILL si en 3 s no salió)."""
        run = self.runs.get(run_id)
        if run is None or run.state != "running" or run.pid is None:
            return False
        run.error = why
        try:
            os.killpg(run.pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError, AttributeError):
            return False

        def matar() -> None:
            if run.state == "running":
                try:
                    os.killpg(run.pid, signal.SIGKILL)
                except (ProcessLookupError, PermissionError):
                    pass
        asyncio.get_running_loop().call_later(3, matar)
        return True

    async def wait_all(self) -> None:
        if self._tasks:
            await asyncio.gather(*self._tasks, return_exceptions=True)
