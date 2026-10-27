"""La terminal de la interfaz: un bash de verdad adentro del contenedor, por websocket en
/api/terminal (el mismo puerto 8080 de la interfaz, sin abrir otro).

Es lo mismo que `docker exec -it bigdata-full bash`: root, en /datos, con las mismas variables.
Por eso solo atiende a la interfaz servida en la misma compu:
- el Host tiene que ser localhost / 127.0.0.1 / ::1 (corta el DNS rebinding: una página de
  afuera que haga apuntar su dominio a 127.0.0.1 llega con su propio Host);
- el Origin tiene que ser el mismo sitio (un websocket no tiene CORS: sin esto, cualquier
  página abierta en el navegador podría conectarse a localhost:8080).
TERMINAL=0 la apaga; TERMINAL_HOSTS="aula-pc1,10.0.0.5" suma nombres permitidos (ej. el
servidor de `empresa` visto desde otra PC: ahí cualquiera que llegue a ese nombre tiene root).

Protocolo: el servidor manda la salida como texto; el navegador manda JSON:
{"t": "i", "d": "ls\\r"} lo que se tipea, {"t": "r", "c": 120, "r": 30} el tamaño.
"""
from __future__ import annotations

import asyncio
import codecs
import contextlib
import fcntl
import json
import os
import signal
import struct
import termios
from pathlib import Path
from urllib.parse import urlsplit

from starlette.routing import WebSocketRoute
from starlette.websockets import WebSocket, WebSocketDisconnect

RCFILE = Path(__file__).with_name("terminal.bashrc")
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
MAX_SESSIONS = 4
# Close codes propios (4000-4999): la interfaz muestra el motivo
CLOSE_FORBIDDEN = 4403
CLOSE_OFF = 4404
CLOSE_BUSY = 4429


def _host(value: str) -> str:
    """'localhost:8080' → 'localhost'; '[::1]:8080' → '::1'"""
    value = value.strip().lower()
    if value.startswith("["):
        return value[1:value.find("]")] if "]" in value else value
    return value.rsplit(":", 1)[0] if value.count(":") == 1 else value


def allowed_hosts() -> set[str]:
    extra = {h.strip().lower() for h in os.environ.get("TERMINAL_HOSTS", "").split(",") if h.strip()}
    return LOCAL_HOSTS | extra


def check(headers) -> str | None:
    """Por qué no se puede abrir (o None si se puede)"""
    if os.environ.get("TERMINAL", "1").strip().lower() in ("0", "no", "false"):
        return "La terminal está apagada en este contenedor (TERMINAL=0)"
    host = headers.get("host", "")
    if _host(host) not in allowed_hosts():
        return f"La terminal solo se abre desde esta compu (localhost), no desde {_host(host) or 'otro nombre'}"
    origin = headers.get("origin")
    if not origin:
        return "Falta el Origin: la terminal se abre desde la interfaz"
    o = urlsplit(origin)
    if o.scheme not in ("http", "https") or o.netloc.lower() != host.strip().lower():
        return "La terminal solo acepta a la interfaz de este mismo contenedor"
    return None


def _shell_env() -> dict[str, str]:
    env = dict(os.environ)
    for k in ("UI_DIR", "AUTOSTART", "PORT", "HOST", "LOG_LEVEL", "TERMINAL", "TERMINAL_HOSTS"):
        env.pop(k, None)
    env.update(TERM="xterm-256color", COLORTERM="truecolor", HOME=os.environ.get("HOME", "/root"),
               SANDBOX_TERMINAL="1")
    return env


def _cwd() -> str:
    for d in (os.environ.get("TERMINAL_CWD", ""), "/datos", os.environ.get("HOME", ""), "/"):
        if d and os.path.isdir(d):
            return d
    return "/"


def _set_size(fd: int, cols: int, rows: int) -> None:
    cols = max(10, min(int(cols), 1000))
    rows = max(2, min(int(rows), 500))
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def _ctty() -> None:  # pragma: no cover - corre en el hijo, después del fork
    # start_new_session ya hizo setsid: la pty (fd 0) pasa a ser su terminal de control,
    # así bash tiene control de trabajos (Ctrl+C, Ctrl+Z, fg)
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)


class Terminal:
    def __init__(self, shell: list[str] | None = None):
        # --rcfile: los mismos archivos que `docker exec ... bash` más la marca del prompt
        self.shell = shell or ["bash", "--rcfile", str(RCFILE), "-i"]
        self.sessions = 0

    def routes(self) -> list:
        return [WebSocketRoute("/api/terminal", self.ws)]

    async def ws(self, ws: WebSocket) -> None:
        why = check(ws.headers)
        if why:
            # Se acepta para poder mandar el motivo (un rechazo en el handshake llega como error sin texto)
            await ws.accept()
            code = CLOSE_OFF if "TERMINAL=0" in why else CLOSE_FORBIDDEN
            await ws.close(code=code, reason=why)
            return
        if self.sessions >= MAX_SESSIONS:
            await ws.accept()
            await ws.close(code=CLOSE_BUSY, reason=f"Ya hay {MAX_SESSIONS} terminales abiertas: cerrá alguna")
            return
        await ws.accept()
        self.sessions += 1
        try:
            await self._run(ws)
        finally:
            self.sessions -= 1

    async def _run(self, ws: WebSocket) -> None:
        loop = asyncio.get_running_loop()
        master, slave = os.openpty()
        try:
            cols, rows = int(ws.query_params.get("cols", 100)), int(ws.query_params.get("rows", 30))
        except ValueError:
            cols, rows = 100, 30
        _set_size(master, cols, rows)
        try:
            proc = await asyncio.create_subprocess_exec(
                *self.shell, stdin=slave, stdout=slave, stderr=slave, cwd=_cwd(), env=_shell_env(),
                start_new_session=True, preexec_fn=_ctty)
        except OSError as e:
            os.close(master)
            os.close(slave)
            await ws.close(code=1011, reason=f"No se pudo abrir bash: {e}")
            return
        os.close(slave)
        os.set_blocking(master, False)
        out: asyncio.Queue[bytes | None] = asyncio.Queue()

        def readable() -> None:
            try:
                data = os.read(master, 65536)
            except BlockingIOError:
                return
            except OSError:
                data = b""
            if not data:
                loop.remove_reader(master)
                out.put_nowait(None)
            else:
                out.put_nowait(data)

        loop.add_reader(master, readable)

        async def pump_out() -> None:
            dec = codecs.getincrementaldecoder("utf-8")(errors="replace")
            while True:
                data = await out.get()
                if data is None:
                    break
                # Junta lo que ya llegó: menos mensajes cuando un comando escupe mucho
                while not out.empty() and len(data) < 1 << 20:
                    nxt = out.get_nowait()
                    if nxt is None:
                        out.put_nowait(None)
                        break
                    data += nxt
                text = dec.decode(data)
                if text:
                    await ws.send_text(text)

        async def pump_in() -> None:
            while True:
                msg = await ws.receive_text()
                try:
                    m = json.loads(msg)
                except json.JSONDecodeError:
                    continue
                if not isinstance(m, dict):
                    continue
                if m.get("t") == "i" and isinstance(m.get("d"), str):
                    data = m["d"].encode()
                    while data:
                        try:
                            n = os.write(master, data)
                            data = data[n:]
                        except BlockingIOError:
                            await asyncio.sleep(0.01)
                elif m.get("t") == "r":
                    with contextlib.suppress(TypeError, ValueError, OSError):
                        _set_size(master, m.get("c"), m.get("r"))

        reader = asyncio.create_task(pump_out())
        writer = asyncio.create_task(pump_in())
        try:
            done, _ = await asyncio.wait({reader, writer}, return_when=asyncio.FIRST_COMPLETED)
            if reader in done:
                # bash terminó (exit): avisar y cerrar
                code = await proc.wait()
                with contextlib.suppress(Exception):
                    await ws.close(code=1000, reason=f"bash terminó (código {code})")
        except WebSocketDisconnect:
            pass
        finally:
            for t in (reader, writer):
                t.cancel()
            for t in (reader, writer):
                with contextlib.suppress(asyncio.CancelledError, WebSocketDisconnect, Exception):
                    await t
            with contextlib.suppress(Exception):
                loop.remove_reader(master)
            with contextlib.suppress(OSError):
                os.close(master)
            if proc.returncode is None:
                # Se cerró la pestaña o el panel: cortar bash y lo que haya lanzado
                with contextlib.suppress(ProcessLookupError, PermissionError):
                    os.killpg(proc.pid, signal.SIGHUP)
                try:
                    await asyncio.wait_for(proc.wait(), 3)
                except asyncio.TimeoutError:
                    with contextlib.suppress(ProcessLookupError, PermissionError):
                        os.killpg(proc.pid, signal.SIGKILL)
                    await proc.wait()
