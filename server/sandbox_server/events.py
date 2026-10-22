"""Eventos en vivo (GET /api/events, Server-Sent Events) y la actividad que
muestra la consola (GET /api/activity)."""
from __future__ import annotations

import asyncio
import itertools
import json
from collections import deque

from .boot import now_ms

MAX_ACTIVITY = 1000
QUEUE_MAX = 500


class EventBus:
    """Cada conexión SSE tiene su cola. Si un navegador no lee (pestaña
    congelada), se le descartan los eventos viejos en vez de llenar la memoria."""

    def __init__(self) -> None:
        self._subs: set[asyncio.Queue] = set()
        self.closed = False
        self._seq = itertools.count(1)
        self.activity: deque[dict] = deque(maxlen=MAX_ACTIVITY)

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAX)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subs.discard(q)

    @property
    def subscribers(self) -> int:
        return len(self._subs)

    def publish(self, type_: str, data: dict | None = None) -> None:
        if self.closed:
            return
        msg = (type_, data or {})
        for q in list(self._subs):
            if q.full():
                try:
                    q.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(msg)

    def close(self) -> None:
        """Al apagar el servidor: corta todas las conexiones SSE."""
        self.closed = True
        for q in list(self._subs):
            if q.full():
                q.get_nowait()
            q.put_nowait(None)

    def log(self, source: str, level: str, title: str, **extra: object) -> dict:
        """Agrega una línea a la actividad y la manda por SSE ('activity')."""
        entry = {"id": f"a{next(self._seq)}", "at": now_ms(), "source": source, "level": level, "title": title}
        entry.update({k: v for k, v in extra.items() if v is not None})
        self.activity.append(entry)
        self.publish("activity", {"entry": entry})
        return entry

    def recent(self, limit: int = 200) -> list[dict]:
        limit = max(1, min(limit, MAX_ACTIVITY))
        return list(self.activity)[-limit:]


def sse_format(type_: str, data: dict) -> bytes:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {type_}\ndata: {payload}\n\n".encode()


async def sse_stream(bus: EventBus, keepalive: float = 15.0):
    """Generador para StreamingResponse. Manda un comentario cada 15 s para que
    ningún proxy corte la conexión por inactividad."""
    q = bus.subscribe()
    try:
        yield b": conectado\n\n"
        yield sse_format("status", {})
        while not bus.closed:
            try:
                msg = await asyncio.wait_for(q.get(), timeout=keepalive)
            except asyncio.TimeoutError:
                yield b": sigo\n\n"
                continue
            if msg is None:
                break
            yield sse_format(*msg)
    finally:
        bus.unsubscribe(q)
