"""Humo de la interfaz, parte 4: Prácticas guiadas.

Lo carga humo_ui.py (no se corre solo). Cada función recibe la página de Playwright y el
módulo humo_ui como `h`, con sus ayudas (Chequeo, ir, captura, esperar, pedir...).

- todo: hdfs-basico, hive, mongodb, pig y mapreduce se hacen desde la interfaz con el botón
  Ejecutar de cada paso, contra el cluster de verdad, y quedan completas. Un paso que la
  interfaz todavía no sabe correr contesta "unsupported": se marca con "Lo hice en la
  terminal" y queda anotado en el detalle del chequeo (no es una falla).
- solo_hdfs: hdfs-basico se puede hacer; Hive y MongoDB dicen por qué no y ofrecen el
  arreglo, y el detalle se sigue pudiendo leer.
- apagado: la lista y el detalle se recorren, Ejecutar está bloqueado con el motivo y la
  página no pide nada que conteste 409.
"""
import re
from urllib.parse import urlparse

from playwright.sync_api import expect

EJECUTAR = re.compile(r"^Ejecutar")


# Rutas que usan las prácticas y que un servidor más viejo que la interfaz puede no tener
RUTAS_NUEVAS = ("/api/hdfs/cat", "/api/hdfs/download", "/api/yarn/templates")


def _faltan(h) -> set[str]:
    """Las rutas de RUTAS_NUEVAS que este servidor no conoce (404 «No hay GET /api/…»)"""
    if not hasattr(h, "_p4_faltan"):
        h._p4_faltan = {r for r in RUTAS_NUEVAS
                        if (lambda st, cuerpo: st == 404 and "No hay" in str(cuerpo))(*h.pedir("GET", r))}
    return h._p4_faltan


def _errores(h, n: int) -> list[dict]:
    """Errores de consola desde n, sin los 404 de rutas que el servidor no tiene: ese paso
    contesta "unsupported" y se hace en la terminal (queda anotado en el detalle)"""
    faltan = _faltan(h)
    return [e for e in h.errores_desde(n)
            if not ("status of 404" in e["texto"] and urlparse(e.get("recurso", "")).path in faltan)]


def _abrir(page, h, practica: str) -> None:
    """Abre la práctica y, si tiene avance de antes, la empieza de nuevo desde la interfaz"""
    h.ir(page, f"practicas/{practica}")
    expect(page.locator(".pr-steps")).to_be_visible(timeout=20_000)
    if page.locator('.pr-step[data-done="true"]').count():
        page.locator(".ph-actions").get_by_role("button", name="Empezar de nuevo").click()
        page.get_by_role("alertdialog").get_by_role("button", name="Empezar de nuevo").click()
        expect(page.locator('.pr-step[data-done="true"]')).to_have_count(0)


def _paso(page, pid: str, segundos: int = 900) -> tuple[str, str]:
    """Corre un paso con Ejecutar y espera el resultado: (ok | info | bad | bloqueado, texto)"""
    li = page.locator(f"#paso-{pid}")
    if li.get_attribute("data-open") != "true":
        li.locator(".pr-step-h").click()
    boton = li.get_by_role("button", name=EJECUTAR).first
    if boton.get_attribute("data-gated") == "true":
        return "bloqueado", boton.get_attribute("aria-description") or ""
    boton.click()
    page.wait_for_timeout(600)
    expect(li.locator(".pr-out")).to_have_count(1, timeout=segundos * 1000)
    expect(li.locator(".pr-step-h .chip")).to_have_count(0, timeout=60_000)
    out = li.locator(".pr-out")
    return out.get_attribute("data-k") or "", out.inner_text()[:200].replace("\n", " | ")


def _practica(page, h, c, practica: str, pasos: list[str], segundos: int = 900) -> None:
    """Hace la práctica entera desde la interfaz y verifica que quede completa"""
    n = len(h.CONSOLA)
    _abrir(page, h, practica)
    terminal, malos = [], []
    for pid in pasos:
        k, texto = _paso(page, pid, segundos)
        print(f"   {practica}/{pid}: {k} · {texto[:120]}", flush=True)
        if k == "info":
            # la interfaz todavía no lo corre: lo hace la terminal y se marca a mano
            page.locator(f"#paso-{pid}").get_by_role("button", name="Lo hice en la terminal").click()
            terminal.append(pid)
        elif k != "ok":
            malos.append(f"{pid}: {k} {texto}")
    h.captura(page, f"p4-todo-{practica}")
    c.detalle = f"{len(pasos) - len(terminal)}/{len(pasos)} pasos desde la interfaz" + (
        f" · en la terminal: {', '.join(terminal)}" if terminal else "") + (
        f" · el servidor no tiene {', '.join(sorted(_faltan(h)))}" if _faltan(h) else "")
    assert not malos, malos
    # con un servidor al día, todo se corre desde la interfaz
    assert not terminal or _faltan(h), f"fueron a la terminal: {terminal}"
    for pid in pasos:
        expect(page.locator(f"#paso-{pid}")).to_have_attribute("data-done", "true")
    expect(page.locator(".pr-finished")).to_be_visible()
    assert not _errores(h, n), _errores(h, n)


def todo(page, h) -> None:
    with h.Chequeo("p4 todo: hdfs-basico completa desde la interfaz") as c:
        _practica(page, h, c, "hdfs-basico", ["mkdir", "put", "ls", "cat", "setrep", "fsck", "get"], 600)

    with h.Chequeo("p4 todo: hive completa desde la interfaz (tabla externa, Tez y EXPLAIN)") as c:
        _practica(page, h, c, "hive", ["datos", "create", "limit", "sucursal", "producto", "explain"])

    with h.Chequeo("p4 todo: mongodb completa desde la interfaz") as c:
        _practica(page, h, c, "mongodb", ["findone", "find", "contar", "aggregate", "indice"], 300)

    with h.Chequeo("p4 todo: pig completa desde la interfaz (LOAD, FILTER y GROUP)") as c:
        _practica(page, h, c, "pig", ["datos", "load", "filter", "group"])

    with h.Chequeo("p4 todo: mapreduce (wordcount) desde la interfaz") as c:
        n = len(h.CONSOLA)
        _abrir(page, h, "mapreduce")
        k, texto = _paso(page, "texto", 300)
        assert k == "ok", texto
        k, texto = _paso(page, "lanzar", 300)
        if k == "info" and _faltan(h):
            # un servidor sin plantillas de trabajos no lanza desde la interfaz: sin eso,
            # seguir y logs no tienen id. Queda anotado y se revisa lo que sí se puede.
            c.detalle = "lanzar todavía no se corre desde la interfaz: seguir, logs y resultado quedan para la terminal"
            h.captura(page, "p4-todo-mapreduce")
            assert not _errores(h, n), _errores(h, n)
        else:
            assert k == "ok", texto
            for pid in ["seguir", "logs", "resultado"]:
                k, texto = _paso(page, pid, 900)
                assert k == "ok", f"{pid}: {texto}"
            h.captura(page, "p4-todo-mapreduce")
            expect(page.locator(".pr-finished")).to_be_visible()
            c.detalle = "5/5 pasos desde la interfaz"
            assert not _errores(h, n), _errores(h, n)

    with h.Chequeo("p4 todo: la lista cuenta las completas") as c:
        h.ir(page, "practicas")
        chip = page.locator(".ph .chip").first.inner_text()
        c.detalle = chip
        assert re.search(r"\d+ de 9 completas", chip), chip
        h.captura(page, "p4-todo-lista")


def solo_hdfs(page, h) -> None:
    with h.Chequeo("p4 solo HDFS: Hive y MongoDB dicen por qué no y ofrecen el arreglo") as c:
        n = len(h.CONSOLA)
        # en la etapa todo Hive quedó completa, y una completa no se marca bloqueada: se empieza de nuevo
        _abrir(page, h, "hive")
        h.ir(page, "practicas")
        h.captura(page, "p4-solo-hdfs-lista")
        hive = page.locator(".pr-card", has=page.get_by_role("button", name="Hive: SQL sobre HDFS"))
        expect(hive).to_have_attribute("data-k", "blocked")
        expect(hive).to_contain_text("SERVICIOS")
        hdfs = page.locator(".pr-card", has=page.get_by_role("button", name="HDFS: subir, mirar y replicar"))
        expect(hdfs).to_have_attribute("data-k", "ready")
        h.ir(page, "practicas/hive")
        nota = page.locator(".pr-main .capnote")
        expect(nota).to_be_visible()
        boton = page.locator("#paso-limit").get_by_role("button", name=EJECUTAR)
        if page.locator("#paso-limit").get_attribute("data-open") != "true":
            page.locator("#paso-limit .pr-step-h").click()
        expect(boton).to_have_attribute("data-gated", "true")
        expect(page.locator("#paso-limit pre, #paso-limit code").first).to_be_visible()
        c.detalle = nota.inner_text()[:140].replace("\n", " ")
        h.captura(page, "p4-solo-hdfs-hive")
        assert not [e for e in h.errores_desde(n) if not h.es_esperado(e)], h.errores_desde(n)


def apagado(page, h) -> None:
    with h.Chequeo("p4 apagado: lista y detalle se recorren y Ejecutar dice que el cluster está apagado") as c:
        n, n409 = len(h.CONSOLA), len(h.RESPUESTAS_409)
        h.ir(page, "practicas")
        expect(page.locator(".pr-card")).to_have_count(9)
        h.ir(page, "practicas/hdfs-basico")
        expect(page.locator(".pr-main .capnote")).to_contain_text("apagado")
        li = page.locator("#paso-mkdir")
        if li.get_attribute("data-open") != "true":
            li.locator(".pr-step-h").click()
        expect(li.get_by_role("button", name=EJECUTAR)).to_have_attribute("data-gated", "true")
        h.captura(page, "p4-apagado-detalle")
        c.detalle = page.locator(".pr-main .capnote").inner_text()[:140].replace("\n", " ")
        assert not _errores(h, n), _errores(h, n)
        assert len(h.RESPUESTAS_409) == n409, h.RESPUESTAS_409[n409:]
