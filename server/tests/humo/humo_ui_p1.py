"""Humo de la interfaz, parte 1: armazón, Inicio, Cluster, Configuración y Consola.

Lo carga humo_ui.py (no se corre solo). Cada función recibe la página de Playwright y el
módulo humo_ui como `h`, con sus ayudas (Chequeo, ir, captura, esperar, pedir, hf...).

- todo: Configuración sin campos encimados, Consola con detalle, Cluster coherente con Inicio.
- apagado: desde Inicio, Iniciar → arrancando → andando, con las tarjetas cambiando de
  estado; al final se apaga de nuevo para dejar todo como estaba.
"""
from playwright.sync_api import expect


def _se_pisan(a: dict, b: dict) -> bool:
    return not (a["x"] + a["width"] <= b["x"] or b["x"] + b["width"] <= a["x"]
                or a["y"] + a["height"] <= b["y"] or b["y"] + b["height"] <= a["y"])


def config_sin_encimar(page, h, etapa: str) -> None:
    with h.Chequeo(f"p1 {etapa}: en Configuración, Tamaño de bloque y NameNodes no se pisan") as c:
        h.ir(page, "config")
        campos = page.locator("#contenido .field")
        bs = campos.filter(has=page.locator("label[for=f-bs]")).first
        nn = campos.filter(has=page.locator("#f-nn")).first
        expect(bs).to_be_visible()
        expect(nn).to_be_visible()
        a, b = bs.bounding_box(), nn.bounding_box()
        c.detalle = f"tamaño {a}, namenodes {b}"
        assert not _se_pisan(a, b), (a, b)
        # Las tres opciones de NameNodes se ven enteras dentro de su campo
        opciones = nn.get_by_role("radio")
        expect(opciones).to_have_count(3)
        for i in range(3):
            o = opciones.nth(i).bounding_box()
            assert o["height"] > 20 and o["y"] >= b["y"] and o["y"] + o["height"] <= b["y"] + b["height"] + 1, (o, b)
        h.captura(page, f"p1-{etapa}-config")


def consola_con_detalle(page, h, etapa: str) -> None:
    with h.Chequeo(f"p1 {etapa}: la Consola muestra el detalle del evento elegido") as c:
        h.ir(page, "consola")
        filas = page.locator(".console-rows [role=option]")
        expect(filas.first).to_be_visible()
        n = filas.count()
        filas.nth(min(1, n - 1)).click()
        detalle = page.locator(".console-detail")
        expect(detalle.locator(".ev-t")).to_have_text(filas.nth(min(1, n - 1)).locator(".ttl").inner_text())
        expect(detalle.get_by_role("heading", name="Comando")).to_be_visible()
        c.detalle = f"{n} eventos; elegido: {detalle.locator('.ev-t').inner_text()[:80]}"


def todo(page, h) -> None:
    config_sin_encimar(page, h, "todo")
    consola_con_detalle(page, h, "todo")
    with h.Chequeo("p1 todo: Cluster e Inicio cuentan lo mismo sobre la salud del cluster") as c:
        # humo_full puede dejar algo caído a propósito: lo que importa es que las dos pantallas coincidan
        h.ir(page, "inicio")
        sano = "todo responde" in page.locator(".hero").inner_text()
        h.ir(page, "cluster")
        alertas = page.locator("section.alerts").count()
        c.detalle = (f"Inicio {'sano' if sano else 'con avisos'}, Cluster con {alertas} bloque de alertas; topbar: "
                     + page.locator("header.top").inner_text()[:120].replace("\n", " / "))
        assert (alertas == 0) == sano, c.detalle


def apagado(page, h) -> None:
    config_sin_encimar(page, h, "apagado")
    with h.Chequeo("p1 apagado: Iniciar desde Inicio pasa por arrancando y llega a andando") as c:
        h.ir(page, "inicio")
        hero = page.locator(".hero")
        tarjetas = page.locator(".capcard")
        expect(tarjetas).not_to_have_count(0)
        assert page.locator(".capcard[data-k=ready]").count() == 0, "con el cluster apagado no hay nada listo"
        hero.get_by_role("button", name="Iniciar cluster").click()
        # Iniciar lleva a Cluster para ver el arranque paso a paso; se vuelve a Inicio sin recargar
        expect(page.get_by_role("heading", name="Arranque")).to_be_visible(timeout=30_000)
        page.evaluate("location.hash = '#inicio'")
        expect(hero).to_contain_text("arrancando", timeout=30_000)
        expect(hero.get_by_role("button", name="Ver arranque")).to_be_visible()
        expect(page.locator(".hero-progress")).to_be_visible()
        expect(page.locator(".capcard[data-k=starting]").first).to_be_visible(timeout=30_000)
        h.captura(page, "p1-apagado-inicio-arrancando")
        expect(hero).to_contain_text("andando", timeout=420_000)
        expect(page.locator(".capcard[data-k=ready]").first).to_be_visible(timeout=60_000)
        hdfs = tarjetas.filter(has=page.get_by_role("heading", name="Subir y explorar HDFS"))
        if hdfs.count():
            expect(hdfs.first).to_have_attribute("data-k", "ready", timeout=60_000)
        listas = page.locator(".capcard[data-k=ready]").count()
        c.detalle = f"{listas} de {tarjetas.count()} tarjetas listas; " + hero.inner_text()[:120].replace("\n", " / ")
        h.captura(page, "p1-apagado-inicio-andando")
    # Se deja como estaba: apagado y sin procesos colgados
    page.goto("about:blank")
    h.hf.apagar("después del arranque desde Inicio")
