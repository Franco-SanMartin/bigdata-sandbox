"""Utilidades de subprocesos."""
from __future__ import annotations

import asyncio


async def exited(proc: asyncio.subprocess.Process, timeout: float | None = None) -> int | None:
    """Espera a que el proceso termine. No usa proc.wait(), que además espera a
    que se cierren sus pipes (así anda en Python 3.12): el 'tail -F' que el
    arranque deja en segundo plano los tiene abiertos."""
    loop = asyncio.get_running_loop()
    end = None if timeout is None else loop.time() + timeout
    while proc.returncode is None:
        if end is not None and loop.time() >= end:
            return None
        await asyncio.sleep(0.05)
    return proc.returncode
