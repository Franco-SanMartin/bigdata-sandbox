"""Humo de la interfaz, parte 5: Pipeline entero y Machine Learning contra el cluster de verdad.

Lo carga humo_ui.py (no se corre solo). Cada función recibe la página de Playwright y el
módulo humo_ui como `h`, con sus ayudas (Chequeo, ir, captura, esperar, pedir...).

- todo: el pipeline se empieza de nuevo y se corren las 6 etapas desde el riel, eligiendo la
  herramienta con un clic (con Spark donde se puede: PySpark, Spark SQL y Spark MLlib para la
  regresión). En la pantalla de ML se entrena una regresión con scikit-learn y con Spark MLlib,
  un árbol con Spark MLlib y KMeans, cambiando problema, modelo y motor como lo haría alguien.
  Cada modelo tiene que quedar con la métrica en un rango razonable (los mismos rangos y
  coeficientes que revisa humo_full.py), no solo "terminó".
"""
import re

from playwright.sync_api import expect

# Las 6 etapas en orden, con la herramienta que se elige (la etiqueta que muestra el riel)
ETAPAS = [("ingesta", "hdfs dfs -put"), ("etl", "PySpark"), ("almacen", "Tabla externa de Hive"),
          ("analisis", "Spark SQL"), ("ml", "Spark MLlib"), ("resultados", "Sqoop export (HDFS → MySQL)")]


def _modelos_nuevos(h, ids: set) -> list[dict]:
    return [m for m in h.pedir("GET", "/api/ml/models")[1] or [] if m["id"] not in ids]


def _empezar_de_nuevo(page, h) -> None:
    boton = page.locator(".ph").get_by_role("button", name="Empezar de nuevo")
    expect(boton).to_be_visible(timeout=20_000)
    if boton.get_attribute("data-gated") == "true":
        return      # todavía no se corrió nada
    boton.click()
    page.get_by_role("alertdialog").get_by_role("button", name="Empezar de nuevo").click()
    h.esperar(lambda: not (h.pedir("GET", "/api/pipeline/steps")[1] or []), 30, "el pipeline vacío")
    page.wait_for_timeout(1000)


def _etapa(page, h, i: int, stage: str, herramienta: str) -> dict:
    """Elige la etapa en el riel y la herramienta, corre y espera que termine la corrida"""
    _, antes = h.pedir("GET", "/api/pipeline/steps")
    ids = {r["id"] for r in antes or []}
    page.locator(".pl-rail").get_by_role("button", name=re.compile(rf"^{i}\. ")).click()
    panel = page.locator("section.panel", has=page.get_by_role("radiogroup", name="Herramienta"))
    panel.locator(".pl-tool", has=page.locator(".t", has_text=re.compile(rf"^{re.escape(herramienta)}$"))).click()
    correr = page.get_by_role("button", name=f"Correr {herramienta}")
    expect(correr).to_be_visible()
    assert correr.get_attribute("data-gated") != "true", correr.get_attribute("aria-description")
    correr.click()
    r = h.esperar(lambda: next((x for x in h.pedir("GET", "/api/pipeline/steps")[1] or []
                                if x["id"] not in ids and x["state"] != "running"), None), 1800, f"la etapa {stage}")
    assert r["stage"] == stage, r
    assert r["state"] == "done", r.get("error") or r.get("message")
    return r


def _entrenar(page, h, ids: set, tarea: str, modelo: str | None, motor: str) -> dict:
    """Entrena desde el formulario de la pantalla de ML y devuelve el modelo terminado"""
    page.locator(f'[aria-label="Tipo de problema"] [aria-label="{tarea}"]').click()
    page.wait_for_timeout(1500)         # la recomendación del problema nuevo elige el modelo
    if modelo:
        page.locator(".ml-form select").select_option(modelo)
    item = page.locator(f'[aria-label="Motor"] [aria-label="{motor}"]')
    if item.get_attribute("data-state") != "on":
        item.click()
    expect(item).to_have_attribute("data-state", "on")
    boton = page.get_by_role("button", name="Entrenar", exact=True)
    expect(boton).to_be_enabled(timeout=60_000)
    expect(boton).not_to_have_attribute("data-gated", "true", timeout=60_000)
    boton.click()
    m = h.esperar(lambda: next((x for x in _modelos_nuevos(h, ids) if x["state"] != "running"), None),
                  1800, f"el modelo {tarea} {motor}")
    ids.add(m["id"])
    page.wait_for_timeout(1500)
    return m


def todo(page, h) -> None:
    with h.Chequeo("p5 todo: pipeline entero desde el riel (put, PySpark, Hive, Spark SQL, MLlib, Sqoop)") as c:
        n = len(h.CONSOLA)
        h.ir(page, "pipeline")
        _empezar_de_nuevo(page, h)
        corridas = [_etapa(page, h, i, stage, herr) for i, (stage, herr) in enumerate(ETAPAS, 1)]
        _, st = h.pedir("GET", "/api/pipeline")
        assert all(s["state"] == "done" for s in st["stages"]), [(s["stage"], s["state"]) for s in st["stages"]]
        expect(page.get_by_text("Pipeline completo", exact=True)).to_be_visible(timeout=20_000)
        h.captura(page, "p5-todo-pipeline")
        ml = next(r for r in corridas if r["stage"] == "ml")
        m = next(x for x in h.pedir("GET", "/api/ml/models")[1] if x["id"] == ml["modelId"])
        assert (m["task"], m["model"], m["engine"]) == ("regresion", "lineal", "mllib"), m
        c.detalle = (" · ".join(f"{r['stage']} {r['tool']} {round((r['finishedAt'] - r['startedAt']) / 1000)} s"
                                for r in corridas) + f"; modelo del pipeline: {h.hf.revisar_modelo(m)}")[:600]
        assert not h.errores_desde(n), h.errores_desde(n)

    _, antes = h.pedir("GET", "/api/ml/models")
    ids = {m["id"] for m in antes or []}
    for tarea, modelo, motor in (("regresión", None, "scikit-learn"), ("regresión", None, "Spark MLlib"),
                                 ("clasificación", "arbol", "Spark MLlib"), ("agrupamiento", None, "scikit-learn")):
        with h.Chequeo(f"p5 todo: ML desde la interfaz, {tarea} con {motor}") as c:
            n = len(h.CONSOLA)
            h.ir(page, "ml")
            m = _entrenar(page, h, ids, tarea, modelo, motor)
            h.captura(page, f"p5-todo-ml-{m['engine']}-{m['task']}-{m['model']}")
            c.detalle = f"{m['engine']} {m['model']} {m.get('seconds')} s: {h.hf.revisar_modelo(m)}"[:500]
            assert m["engine"] == ("mllib" if motor == "Spark MLlib" else "sklearn"), m["engine"]
            # lo que muestra el detalle es lo que midió el servidor
            expect(page.locator(".md-h .badge").first).to_have_text("listo")
            assert not h.errores_desde(n), h.errores_desde(n)
