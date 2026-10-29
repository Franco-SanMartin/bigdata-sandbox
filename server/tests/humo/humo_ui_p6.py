"""Humo de la interfaz, parte 6: «Por dentro» de cada modelo (el dibujo 3D de la pantalla de ML).

Lo carga humo_ui.py (no se corre solo). Cada función recibe la página de Playwright y el
módulo humo_ui como `h`, con sus ayudas (Chequeo, ir, captura, esperar, pedir...).

- todo: para cada tipo de modelo que entrenó el humo (red de sklearn y de Spark MLlib, árbol,
  logística, lineal, tonto y KMeans) abre su detalle en la pantalla de ML y revisa que el canvas
  se dibuje de verdad (WebGL por SwiftShader: cuadros dibujados y píxeles que no son el fondo) y
  que la cuenta que hace la interfaz en el navegador dé lo mismo que predijo el servidor para esa
  fila (GET /api/ml/models/{id}/viz), con tolerancia 1e-6. En la red además elige otra fila, pasa
  paso a paso y mira el modo «cómo aprendió». Deja una captura del dibujo de cada uno.
"""
import json

from playwright.sync_api import expect

TOL = 1e-6
# (kind, motor) que se revisan: uno de cada uno, el más nuevo
CASOS = [("mlp", "sklearn"), ("mlp", "mllib"), ("tree", "sklearn"), ("tree", "mllib"), ("logistic", "sklearn"),
         ("linear", "sklearn"), ("dummy", "sklearn"), ("kmeans", "sklearn"), ("kmeans", "mllib")]
KIND = {"mlp": "mlp", "arbol": "tree", "logistica": "logistic", "lineal": "linear", "tonto": "dummy", "kmeans": "kmeans"}

PIXELES = """() => { const c = document.querySelector('.mv-canvas canvas'); if (!c) return -1;
  const o = document.createElement('canvas'); o.width = c.width; o.height = c.height; const x = o.getContext('2d');
  x.drawImage(c, 0, 0); const d = x.getImageData(0, 0, o.width, o.height).data; const r = d[0], g = d[1], b = d[2];
  let n = 0; for (let i = 0; i < d.length; i += 16) if (Math.abs(d[i]-r) + Math.abs(d[i+1]-g) + Math.abs(d[i+2]-b) > 24) n++;
  return n; }"""


def _comparar(mv, v: dict) -> str:
    """Lo que dice la interfaz para la fila elegida contra lo que predijo el servidor"""
    fila = mv.get_attribute("data-viz-row")
    out = json.loads(mv.get_attribute("data-viz-out") or "null")
    assert out is not None and fila not in ("", "manual"), (fila, out)
    i, s = int(fila), v["sample"]
    if "group" in out:
        assert out["group"] == int(s["pred"][i]), (i, out, s["pred"][i])
        return f"fila {i}: grupo {out['group']} igual"
    if "value" in out:
        d = abs(out["value"] - s["pred"][i]) / max(1.0, abs(s["pred"][i]))
    else:
        d = max(abs(a - b) for a, b in zip(out["proba"], s["proba"][i]))
    assert d <= TOL, f"fila {i}: la interfaz difiere {d:.2e} del servidor ({out} contra {s.get('proba', s['pred'])[i]})"
    return f"fila {i}: dif {d:.1e}"


def _abrir(page, h, m: dict):
    h.ir(page, "ml/guiado")
    page.locator(f'tr[data-key="{m["id"]}"]').click()
    # mientras trae /viz la sección es un esqueleto sin data-viz-mode: esperar a que cargue (o falle)
    mv = page.locator("section.mv")
    listo = page.locator("section.mv[data-viz-mode], section.mv .callout[data-k=bad]")
    expect(listo.first).to_be_visible(timeout=30_000)
    modo = mv.get_attribute("data-viz-mode")
    assert modo, f"no trajo el dibujo: {mv.inner_text()[:300]}"
    assert modo == "3d", page.locator(".mv-nogl").inner_text()[:300]
    page.wait_for_function("() => Number(document.querySelector('.mv-canvas')?.dataset.frames) > 0", timeout=30_000)
    mv.scroll_into_view_if_needed()
    page.wait_for_timeout(2500)      # que termine la primera pasada
    return mv


def _red(page, h, mv, v: dict) -> str:
    """Otra fila, paso a paso, y los pesos por época"""
    page.locator("[data-viz-select]").select_option(str(min(3, len(v["sample"]["rows"]) - 1)))
    page.wait_for_timeout(300)
    page.locator("[data-viz-step]").click()
    page.wait_for_timeout(1500)
    det = _comparar(mv, v)
    if v.get("epochs") and len(v["epochs"]["frames"]) > 1:
        page.get_by_text("cómo aprendió", exact=True).click()
        page.wait_for_timeout(300)
        page.locator("[data-viz-play]").click()
        vistas = set()
        for _ in range(40):          # las épocas tienen que ir pasando mientras se reproduce
            vistas.add(mv.get_attribute("data-viz-epoch"))
            page.wait_for_timeout(150)
        vistas.discard("")
        assert len(vistas) >= 2, f"las épocas no avanzan: {vistas}"
        det += f"; {len(vistas)} épocas vistas de {len(v['epochs']['frames'])}"
        page.get_by_text("red final", exact=True).click()
        page.wait_for_timeout(800)
    return det


def todo(page, h) -> None:
    modelos = [m for m in h.pedir("GET", "/api/ml/models")[1] or [] if m.get("state") == "done" and m.get("hasViz")]
    for kind, motor in CASOS:
        with h.Chequeo(f"p6 todo: por dentro del modelo {kind} de {motor}, dibujado y con la cuenta del servidor") as c:
            n = len(h.CONSOLA)
            m = max((x for x in modelos if KIND.get(x["model"]) == kind and x["engine"] == motor),
                    key=lambda x: x.get("startedAt") or 0, default=None)
            assert m, f"no hay un modelo {kind} de {motor} terminado y con viz"
            codigo, v = h.pedir("GET", f"/api/ml/models/{m['id']}/viz")
            assert codigo == 200, (codigo, str(v)[:300])
            mv = _abrir(page, h, m)
            cuadros = page.locator(".mv-canvas").get_attribute("data-frames")
            px = page.evaluate(PIXELES)
            assert px > 200, f"el canvas está vacío ({px} píxeles dibujados)"
            if kind == "dummy" and v.get("strategy") == "stratified":
                det = "tonto al azar: no se rehace"
            else:
                det = _comparar(mv, v)
            if kind == "mlp":
                det += "; " + _red(page, h, mv, v)
            mv.screenshot(path=str(h.CAPTURAS / f"p6-viz-{motor}-{kind}.png"))
            c.detalle = f"{m['id']}: {cuadros} cuadros, {px} px; {det}"[:500]
            assert not h.errores_desde(n), h.errores_desde(n)
