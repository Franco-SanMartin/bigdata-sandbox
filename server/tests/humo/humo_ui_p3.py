"""Humo de la interfaz, parte 3: Lenguajes (Hive y Pig; antes Consultas).

Lo carga humo_ui.py (no se corre solo). Cada función recibe la página de Playwright y el
módulo humo_ui como `h`, con sus ayudas (Chequeo, ir, captura, esperar, pedir...).

- todo: un script de Pig LOAD/GROUP/DUMP sobre /user/root/ventas da filas en la tabla; Hive
  CREATE EXTERNAL TABLE + SELECT desde el editor; el CSV del resultado se baja; un script con
  sh queda bloqueado con su motivo.
- solo_hdfs: Pig y Hive dicen por qué no están y el editor sigue escribible.
- apagado: el editor se puede usar, Correr explica que el cluster está apagado y el catálogo
  ofrece iniciarlo (sin pedir nada que conteste 409).
"""
from playwright.sync_api import expect

PIG = """ventas = LOAD '/user/root/ventas' USING PigStorage(',')
         AS (fecha:chararray, sucursal:chararray, producto:chararray, cantidad:int, precio:int);
filas = FILTER ventas BY fecha != 'fecha';
por_sucursal = GROUP filas BY sucursal;
resumen = FOREACH por_sucursal GENERATE group AS sucursal, COUNT(filas) AS tickets;
DUMP resumen;"""

TABLA = "humo_p3_ventas"
CREATE = f"""CREATE EXTERNAL TABLE IF NOT EXISTS {TABLA} (
  fecha STRING, sucursal STRING, producto STRING, cantidad INT, precio INT
)
ROW FORMAT DELIMITED FIELDS TERMINATED BY ','
STORED AS TEXTFILE
LOCATION '/user/root/ventas'
TBLPROPERTIES ('skip.header.line.count' = '1');"""


def _ventas_en_hdfs(h) -> None:
    """Deja ventas_grandes.csv en /user/root/ventas si no está (lo usan Pig y la tabla de Hive)"""
    def hay():
        codigo, r = h.pedir("GET", "/api/hdfs/ls?path=/user/root/ventas")
        return codigo == 200 and any(e["type"] == "file" and not e["name"].endswith("._COPYING_")
                                     for e in r.get("entries", []))
    if hay():
        return
    codigo, r = h.pedir("POST", "/api/hdfs/put", {"example": "ventas"})
    assert codigo in (200, 202), (codigo, r)
    h.esperar(hay, 300, "ventas en /user/root/ventas")


def _nueva(page, motor: str, texto: str) -> None:
    page.get_by_role("button", name="Consulta nueva").click()
    page.get_by_role("radio", name=motor).click()
    page.locator(".qe textarea").fill(texto)


def _correr(page, segundos: int = 900):
    correr = page.get_by_role("button", name="Correr", exact=True)
    correr.click()
    page.wait_for_timeout(1500)
    expect(correr).to_be_enabled(timeout=segundos * 1000)
    page.wait_for_timeout(800)


def _sin_error(page) -> None:
    malo = page.locator(".qx-res .callout[data-k=bad]")
    assert malo.count() == 0, malo.first.inner_text()


def todo(page, h) -> None:
    with h.Chequeo("p3 todo: Pig LOAD/GROUP/DUMP sobre ventas da filas en la tabla") as c:
        n = len(h.CONSOLA)
        _ventas_en_hdfs(h)
        h.ir(page, "lenguajes")
        _nueva(page, "Pig", PIG)
        h.captura(page, "p3-todo-pig-editor")
        _correr(page)
        h.captura(page, "p3-todo-pig-dump")
        _sin_error(page)
        tabla = page.locator(".qx-res table")
        expect(tabla.locator("thead th")).to_contain_text(["#", "sucursal", "tickets"])
        filas = tabla.locator("tbody tr").count()
        c.detalle = f"{filas} filas · {page.locator('.qx-res-meta').inner_text()[:120]}"
        assert filas >= 1, filas
        assert "MapReduce" in page.locator(".qx-res-meta").inner_text()
        assert not h.errores_desde(n), h.errores_desde(n)

    with h.Chequeo("p3 todo: el CSV del resultado se baja con su encabezado") as c:
        with page.expect_download(timeout=20_000) as bajada:
            page.locator(".qx-res .rt-bar").get_by_role("button", name="CSV").click()
        d = bajada.value
        texto = open(d.path(), encoding="utf-8-sig").read()  # el CSV trae BOM para Excel
        c.detalle = f"{d.suggested_filename} · {len(texto)} bytes"
        assert d.suggested_filename.endswith(".csv"), d.suggested_filename
        assert texto.splitlines()[0] == "sucursal,tickets", texto[:200]
        assert len(texto.splitlines()) >= 2, texto[:200]

    with h.Chequeo("p3 todo: Hive CREATE EXTERNAL TABLE + SELECT desde el editor") as c:
        n = len(h.CONSOLA)
        h.ir(page, "lenguajes")
        _nueva(page, "Hive", CREATE)
        _correr(page, 300)
        _sin_error(page)
        page.locator(".qe textarea").fill(f"SELECT sucursal, producto, cantidad FROM {TABLA} LIMIT 5;")
        _correr(page, 300)
        h.captura(page, "p3-todo-hive-select")
        _sin_error(page)
        filas = page.locator(".qx-res table tbody tr").count()
        c.detalle = f"{filas} filas"
        assert filas == 5, filas
        # La tabla es externa: borrarla no toca los archivos de /user/root/ventas
        page.locator(".qe textarea").fill(f"DROP TABLE IF EXISTS {TABLA};")
        _correr(page, 120)
        _sin_error(page)
        assert not h.errores_desde(n), h.errores_desde(n)

    with h.Chequeo("p3 todo: Pig con sh queda bloqueado, con el motivo") as c:
        _nueva(page, "Pig", "sh ls /\nventas = LOAD '/user/root/ventas';\nDUMP ventas;")
        _correr(page, 60)
        malo = page.locator(".qx-res .callout[data-k=bad]")
        expect(malo).to_have_count(1)
        c.detalle = malo.inner_text()[:200].replace("\n", " / ")
        assert "sh" in c.detalle and "terminal" in c.detalle, c.detalle
        h.captura(page, "p3-todo-pig-bloqueado")


def solo_hdfs(page, h) -> None:
    with h.Chequeo("p3 solo HDFS: Pig y Hive dicen por qué no están; el editor sigue escribible") as c:
        h.ir(page, "lenguajes")
        for motor in ("Pig", "Hive"):
            page.get_by_role("radio", name=motor).click()
            nota = page.locator(".qx-editor .capnote")
            expect(nota).to_be_visible()
            expect(page.locator(".qe textarea")).to_be_editable()
            page.locator(".qe textarea").fill("SELECT 1;" if motor == "Hive" else "DUMP x;")
            expect(page.get_by_role("button", name="Correr", exact=True)).to_have_attribute("aria-disabled", "true")
            c.detalle += f"{motor}: {nota.inner_text()[:90]} · ".replace("\n", " ")
        h.captura(page, "p3-solo-hdfs-consultas")


def apagado(page, h) -> None:
    with h.Chequeo("p3 apagado: editor usable, Correr explica y el catálogo ofrece iniciar") as c:
        n409 = len(h.RESPUESTAS_409)
        h.ir(page, "lenguajes")
        expect(page.locator(".qe textarea")).to_be_editable()
        expect(page.get_by_role("button", name="Correr", exact=True)).to_have_attribute("aria-disabled", "true")
        expect(page.locator(".qx-side").get_by_role("button", name="Iniciar cluster")).to_be_visible()
        page.get_by_role("radio", name="Pig").click()
        page.get_by_role("tab", name="Historial").click()
        page.wait_for_timeout(3000)
        h.captura(page, "p3-apagado-consultas")
        nuevos = h.RESPUESTAS_409[n409:]
        c.detalle = f"{len(nuevos)} respuestas 409"
        assert not nuevos, nuevos[:5]
