"""Humo de HDFS y Trabajos desde la interfaz (lo carga humo_ui.py).

Con todo prendido: en una carpeta nueva sube el ejemplo de ventas, lo abre, lo baja
(y compara el tamaño con el de HDFS), lo renombra y le baja la réplica; después
lanza un wordcount desde «Nuevo trabajo» sobre ese archivo, espera que termine y
busca «Map input records» en la salida del comando. Con solo HDFS, Trabajos tiene
que mostrar qué falta y no ofrecer lanzar nada.
"""
import re

from playwright.sync_api import Page, expect

CARPETA = "/user/root/humo_ui"
ARCHIVO = CARPETA + "/ventas_grandes.csv"
MOVIDO = CARPETA + "/ventas_ui.csv"
SALIDA = "/user/root/resultados/humo_ui_wordcount"


def sin_errores(h, n: int) -> None:
    errs = h.errores_desde(n)
    assert not errs, errs[:3]


def todo(page: Page, h) -> None:
    with h.Chequeo("P2: HDFS, subir el ejemplo de ventas en una carpeta nueva") as c:
        n = len(h.CONSOLA)
        h.pedir("DELETE", "/api/hdfs/files?path=" + h.urllib.parse.quote(CARPETA) + "&recursive=1")
        codigo, r = h.pedir("POST", "/api/hdfs/mkdir", {"path": CARPETA})
        assert codigo == 200, (codigo, r)
        h.ir(page, "hdfs" + CARPETA)
        page.get_by_role("button", name="Subir ventas_grandes.csv de ejemplo").click()
        fila = page.locator("tr", has_text="ventas_grandes.csv")
        expect(fila).to_have_count(1, timeout=300_000)
        expect(page.locator(".hd-main .badge", has_text="escribiendo")).to_have_count(0, timeout=300_000)
        h.captura(page, "p2-hdfs-subido")
        c.detalle = fila.inner_text().replace("\n", " ")[:160]
        sin_errores(h, n)

    with h.Chequeo("P2: HDFS, ver el archivo") as c:
        n = len(h.CONSOLA)
        page.locator("tr", has_text="ventas_grandes.csv").first.click()
        detalle = page.locator(".hd-detail")
        expect(detalle).to_be_visible()
        detalle.get_by_role("button", name="Ver", exact=True).click()
        visor = page.locator(".hd-viewer")
        expect(visor.locator(".hd-cmd")).to_contain_text("hdfs dfs -cat", timeout=30_000)
        page.get_by_role("radio", name="Texto").click()
        expect(visor.locator("pre.hd-text")).to_contain_text(",", timeout=10_000)
        h.captura(page, "p2-hdfs-ver")
        c.detalle = visor.locator(".hd-foot").inner_text().replace("\n", " ")
        page.keyboard.press("Escape")
        expect(visor).to_have_count(0)
        sin_errores(h, n)

    with h.Chequeo("P2: HDFS, bajar el archivo (mismo tamaño que en HDFS)") as c:
        n = len(h.CONSOLA)
        _, cat = h.pedir("GET", "/api/hdfs/cat?length=1&path=" + h.urllib.parse.quote(ARCHIVO))
        total = cat["totalBytes"]
        with page.expect_download(timeout=120_000) as d:
            page.locator(".hd-detail").get_by_role("button", name="Bajar", exact=True).click()
        bajado = d.value
        ruta = bajado.path()
        tam = ruta.stat().st_size if ruta else -1
        c.detalle = f"{bajado.suggested_filename}: {tam} de {total} bytes"
        assert bajado.suggested_filename == "ventas_grandes.csv" and tam == total, c.detalle
        sin_errores(h, n)

    with h.Chequeo("P2: HDFS, renombrar") as c:
        n = len(h.CONSOLA)
        page.locator(".hd-detail").get_by_role("button", name="Mover").click()
        page.get_by_label("Nueva ruta").fill(MOVIDO)
        h.captura(page, "p2-hdfs-mover")
        page.get_by_role("button", name="Mover", exact=True).last.click()
        expect(page.locator(".hd-main tr", has_text="ventas_ui.csv")).to_have_count(1, timeout=30_000)
        expect(page.locator(".hd-main tr", has_text="ventas_grandes.csv")).to_have_count(0)
        _, ls = h.pedir("GET", "/api/hdfs/ls?path=" + h.urllib.parse.quote(CARPETA))
        c.detalle = str([e["name"] for e in ls["entries"]])
        assert [e["name"] for e in ls["entries"]] == ["ventas_ui.csv"], c.detalle
        sin_errores(h, n)

    with h.Chequeo("P2: HDFS, bajar la réplica a 1") as c:
        n = len(h.CONSOLA)
        detalle = page.locator(".hd-detail")
        if not detalle.count():
            page.locator(".hd-main tr", has_text="ventas_ui.csv").first.click()
        page.locator(".hd-detail").get_by_role("button", name="Réplica").click()
        menos = page.get_by_role("button", name="Menos copias")
        while menos.is_enabled():
            menos.click()
        page.get_by_role("button", name="Bajar la réplica").click()
        _, d = h.esperar(lambda: (lambda r: r if r[1].get("replication") == 1 else None)(
            h.pedir("GET", "/api/hdfs/file?path=" + h.urllib.parse.quote(MOVIDO))), 60, "réplica 1")
        c.detalle = f"réplica {d['replication']}"
        sin_errores(h, n)

    with h.Chequeo("P2: Trabajos, wordcount desde «Nuevo trabajo» con logs en vivo") as c:
        n = len(h.CONSOLA)
        h.ir(page, "yarn")
        page.get_by_role("button", name="Nuevo trabajo").first.click()
        page.get_by_role("radio", name=re.compile("^Contar palabras")).click()
        page.get_by_label("Entrada", exact=True).fill(MOVIDO)
        page.get_by_label("Salida", exact=True).fill(SALIDA)
        expect(page.get_by_label("Comando equivalente")).to_contain_text(f"wordcount {MOVIDO} {SALIDA}")
        h.captura(page, "p2-trabajos-nuevo")
        page.get_by_role("button", name="Lanzar").click()
        expect(page.locator(".nj")).to_have_count(0, timeout=60_000)
        expect(page.locator(".chip", has_text=re.compile("corriendo|en cola|terminó"))).not_to_have_count(0, timeout=60_000)
        page.wait_for_timeout(3000)
        h.captura(page, "p2-trabajos-corriendo")
        expect(page.locator(".chip", has_text=re.compile("terminó|falló|cancelado"))).not_to_have_count(0, timeout=600_000)
        estado = page.locator(".chip", has_text=re.compile("terminó|falló|cancelado")).first.inner_text()
        assert "terminó" in estado, estado
        page.get_by_role("button", name=re.compile("Salida del comando")).click()
        page.get_by_label("Buscar en el log").fill("Map input records")
        expect(page.locator(".lg mark", has_text="Map input records")).not_to_have_count(0, timeout=30_000)
        h.captura(page, "p2-trabajos-logs")
        app = page.url.rsplit("/", 1)[-1]
        c.detalle = f"{app} {estado}"
        _, ls = h.pedir("GET", "/api/hdfs/ls?path=" + h.urllib.parse.quote(SALIDA))
        assert any(e["name"].startswith("part-r-") for e in ls["entries"]), ls
        sin_errores(h, n)

    with h.Chequeo("P2: Trabajos, «Ver resultado» abre la salida en HDFS") as c:
        n = len(h.CONSOLA)
        page.get_by_role("button", name="Ver resultado").click()
        expect(page.locator(".hd-main tr", has_text="part-r-00000")).to_have_count(1, timeout=30_000)
        c.detalle = page.url
        sin_errores(h, n)


def solo_hdfs(page: Page, h) -> None:
    with h.Chequeo("P2: solo HDFS, Trabajos dice qué falta y no deja lanzar") as c:
        h.ir(page, "yarn")
        texto = page.locator("#contenido").inner_text()
        c.detalle = texto[:200].replace("\n", " / ")
        expect(page.get_by_role("heading", name="Trabajos").first).to_be_visible()
        expect(page.get_by_role("button", name="Lanzar")).to_have_count(0)
        assert "YARN" in texto, texto[:300]
