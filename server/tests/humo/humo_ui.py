"""Humo de la interfaz con Playwright, contra la imagen full de verdad.

Lo corre el CI (.github/workflows/full.yml) después de humo_full.py, con el
cluster todavía prendido con todos los servicios (HUMO_DEJAR_PRENDIDO=1):

    pip install playwright && python3 -m playwright install --with-deps chromium
    python3 server/tests/humo/humo_ui.py

Recorre cada pantalla en un Chromium y anota los errores de la consola del
navegador (tienen que ser cero), corre desde la interfaz un paso del pipeline,
una consulta de Hive que va por Tez y un entrenamiento, y abre el DAG de Tez y el
de Spark. Después reinicia el cluster con solo HDFS y vuelve a pasar por las
pantallas: YARN, Datos y ML tienen que avisar que su servicio no está. Al final
apaga el cluster y recorre todo una vez más con la página abierta: apagado, la
interfaz no pide lo que contesta 409 (cluster_stopped), así que la consola queda
sin errores y la red sin ningún 409. Por último lo vuelve a iniciar con el botón
«Iniciar cluster» de la pantalla Cluster y lo apaga.

Deja las capturas en HUMO_SALIDAS/capturas/*.png y el resultado en
HUMO_SALIDAS/resumen-ui.md. Termina con código 1 si falló algún chequeo.

Cada pantalla nueva suma sus chequeos en un humo_ui_<algo>.py al lado de este: si
define todo(page, h), solo_hdfs(page, h) o apagado(page, h), se llama al final de
esa etapa. h es este módulo (Chequeo, ir, captura, pedir, errores_desde…).
"""
import importlib.util
import json
import os
import re
import sys
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from playwright.sync_api import Page, expect, sync_playwright

import humo_full as hf

URL = os.environ.get("SANDBOX_URL", "http://localhost:8080").rstrip("/")
SALIDAS = Path(os.environ.get("HUMO_SALIDAS", "humo-salidas"))
CAPTURAS = SALIDAS / "capturas"
# "ml/guiado" es la ML de clase (la de antes del estudio): sigue en la imagen del aula
PANTALLAS = ["inicio", "practicas", "cluster", "hdfs", "yarn", "pipeline", "datos", "ml", "ml/guiado", "consola", "config"]
SOLO_HDFS = hf.SOLO_HDFS

RESULTADOS: list[dict] = []
CONSOLA: list[dict] = []
RESPUESTAS_409: list[dict] = []   # cada 409 de la API que ve el navegador, con su etapa
ESPERADOS: list[dict] = []   # 503 de la API con solo HDFS: el servicio está apagado a propósito
ETAPA = {"nombre": "todo"}


class Chequeo:
    def __init__(self, nombre: str):
        self.nombre = nombre
        self.detalle = ""

    def __enter__(self):
        self.t0 = time.time()
        print(f"… {self.nombre}", flush=True)
        return self

    def __exit__(self, tipo, valor, tb):
        ok = tipo is None
        RESULTADOS.append({"nombre": self.nombre, "ok": ok, "segundos": round(time.time() - self.t0, 1),
                           "detalle": self.detalle, "error": "" if ok else "".join(
                               traceback.format_exception(tipo, valor, tb))[-1200:]})
        print(f"{'ok ' if ok else 'MAL'} {self.nombre} {self.detalle}", flush=True)
        return True


def pedir(metodo, ruta, cuerpo=None, timeout=30):
    datos = json.dumps(cuerpo).encode() if cuerpo is not None else None
    req = urllib.request.Request(URL + ruta, data=datos, method=metodo,
                                 headers={"Content-Type": "application/json"} if datos else {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            texto = r.read().decode()
            return r.status, json.loads(texto) if texto else None
    except urllib.error.HTTPError as e:
        texto = e.read().decode()
        try:
            return e.code, json.loads(texto)
        except ValueError:
            return e.code, texto


def esperar(cond, segundos, que, cada=2.0):
    fin = time.time() + segundos
    while time.time() < fin:
        try:
            v = cond()
            if v:
                return v
        except Exception:
            pass
        time.sleep(cada)
    raise TimeoutError(f"no pasó en {segundos} s: {que}")


def captura(page: Page, nombre: str) -> None:
    CAPTURAS.mkdir(parents=True, exist_ok=True)
    page.wait_for_timeout(600)          # que terminen las transiciones
    page.screenshot(path=str(CAPTURAS / f"{nombre}.png"), full_page=True)


def es_esperado(e: dict) -> bool:
    """Con solo HDFS, el navegador anota como error cada 503 de la API (YARN, Hive,
    Spark... apagados). Es la respuesta esperada (service_down): no cuenta, pero
    solo ese caso; un 503 de HDFS o de /api/status sí es un error."""
    ruta = urllib.parse.urlparse(e["recurso"]).path
    return (e["etapa"] == "solo-hdfs" and e["tipo"] == "console" and "status of 503" in e["texto"]
            and ruta.startswith("/api/") and not ruta.startswith(("/api/hdfs", "/api/status", "/api/cluster")))


def ir(page: Page, pantalla: str) -> None:
    page.goto(f"{URL}/#{pantalla}")
    expect(page.locator("#contenido [aria-busy=true]")).to_have_count(0, timeout=20_000)
    page.wait_for_timeout(2500)         # que lleguen las primeras respuestas de la API


def ir_guiado(page: Page) -> None:
    """La ML guiada (dataset de clase, Entrenar y el detalle de cada modelo), por su pestaña en Machine Learning"""
    ir(page, "ml")
    page.get_by_role("tab", name="Guiado").click()
    expect(page).to_have_url(re.compile(r"#ml/guiado$"))
    expect(page.locator("#contenido [aria-busy=true]")).to_have_count(0, timeout=20_000)
    page.wait_for_timeout(2500)


def extensiones() -> list:
    """Los humo_ui_*.py de esta carpeta, cargados como módulos (en orden alfabético)"""
    mods = []
    for f in sorted(Path(__file__).parent.glob("humo_ui_*.py")):
        spec = importlib.util.spec_from_file_location(f.stem, f)
        m = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(m)
        mods.append(m)
    return mods


EXTENSIONES: list = []


def extender(etapa: str, page: Page) -> None:
    """Llama a etapa(page, h) en cada extensión que la tenga; si una se rompe, queda anotado y sigue"""
    yo = sys.modules[__name__]
    for m in EXTENSIONES:
        f = getattr(m, etapa, None)
        if f:
            with Chequeo(f"{m.__name__}: etapa {etapa} completa"):
                f(page, yo)


def inicio_dice(page: Page, c: "Chequeo", *textos: str) -> None:
    """Inicio muestra el estado del cluster y las tarjetas de qué se puede hacer"""
    ir(page, "inicio")
    hero = page.locator(".hero").inner_text()
    c.detalle = hero[:160].replace("\n", " / ")
    for t in textos:
        assert t in hero, (t, hero)
    expect(page.locator(".capcard")).not_to_have_count(0)


def errores_desde(n: int) -> list[dict]:
    return CONSOLA[n:]


def recorrer(page: Page, sufijo: str) -> None:
    for p in PANTALLAS:
        with Chequeo(f"{sufijo}: pantalla {p} sin errores de consola") as c:
            n = len(CONSOLA)
            ir(page, p)
            captura(page, f"{sufijo}-{p.replace('/', '-')}")
            errs = errores_desde(n)
            c.detalle = f"{len(errs)} errores" + (f": {errs[:3]}" if errs else "")
            assert not errs, errs


def todo(page: Page) -> None:
    recorrer(page, "todo")
    with Chequeo("todo: Inicio dice que el cluster anda y tiene tarjetas listas") as c:
        inicio_dice(page, c, "andando")
        expect(page.locator('.capcard[data-k="ready"]')).not_to_have_count(0)

    with Chequeo("todo: pipeline, Ingesta con put desde la interfaz") as c:
        n = len(CONSOLA)
        _, antes = pedir("GET", "/api/pipeline/steps")
        ids = {s["id"] for s in antes or []}
        ir(page, "pipeline")
        page.get_by_role("button", name=re.compile(r"^1\. ")).click()
        page.get_by_role("radio", name=re.compile("put", re.I)).first.click()
        page.get_by_role("button", name=re.compile(r"^Correr ")).click()
        paso = esperar(lambda: next((s for s in pedir("GET", "/api/pipeline/steps")[1]
                                     if s["id"] not in ids and s["state"] != "running"), None), 600, "el paso")
        page.wait_for_timeout(1500)
        captura(page, "todo-pipeline-paso")
        c.detalle = f"{paso['stage']}:{paso['tool']} {paso['state']} {paso.get('message', '')}"[:300]
        assert paso["state"] == "done", paso.get("error")
        assert not errores_desde(n), errores_desde(n)

    with Chequeo("todo: Datos, consulta de Hive por Tez desde la interfaz") as c:
        n = len(CONSOLA)
        ir(page, "datos")
        page.get_by_role("radio", name="Hive").click()
        area = page.locator(".qe textarea")
        area.fill("SELECT producto, COUNT(*) AS n FROM ventas_limpias GROUP BY producto")
        t0 = time.time()
        correr = page.get_by_role("button", name="Correr", exact=True)
        correr.click()
        page.wait_for_timeout(4000)
        captura(page, "todo-datos-hive-corriendo")
        expect(correr).to_be_enabled(timeout=600_000)
        page.wait_for_timeout(1000)
        captura(page, "todo-datos-hive-tez")
        c.detalle = f"{round(time.time() - t0, 1)} s"
        assert page.locator(".callout[data-k=bad]").count() == 0, page.locator(".callout[data-k=bad]").first.inner_text()
        assert not errores_desde(n), errores_desde(n)

    with Chequeo("todo: ML, entrenar desde la interfaz") as c:
        n = len(CONSOLA)
        _, antes = pedir("GET", "/api/ml/models")
        ids = {m["id"] for m in antes or []}
        ir_guiado(page)
        boton = page.get_by_role("button", name="Entrenar", exact=True)
        expect(boton).to_be_enabled(timeout=30_000)
        boton.click()
        m = esperar(lambda: next((x for x in pedir("GET", "/api/ml/models")[1]
                                  if x["id"] not in ids and x["state"] != "running"), None), 900, "el modelo")
        page.wait_for_timeout(1500)
        captura(page, "todo-ml-entrenado")
        c.detalle = f"{m['engine']} {m['model']} {m['state']} {m.get('metrics')}"[:300]
        assert m["state"] == "done", m.get("error")
        assert not errores_desde(n), errores_desde(n)

    _, apps = pedir("GET", "/api/yarn/apps")
    for tipo, nombre in (("TEZ", "tez"), ("SPARK", "spark"), ("MAPREDUCE", "mapreduce")):
        with Chequeo(f"todo: YARN, DAG de {nombre}") as c:
            n = len(CONSOLA)
            app = max((a for a in apps or [] if a["type"] == tipo), key=lambda a: a["submittedAt"], default=None)
            assert app, f"no hay apps {tipo}: {[(a['id'], a['type']) for a in apps or []]}"
            ir(page, "yarn")
            corto = re.sub(r"^application_\d+_", "app_", app["id"])
            page.locator("table.yr-apps tr", has_text=corto).first.click()
            page.wait_for_timeout(3000)
            captura(page, f"todo-yarn-{nombre}")
            c.detalle = f"{app['id']} {app['name']}"
            assert not errores_desde(n), errores_desde(n)
    extender("todo", page)


def solo_hdfs(page: Page) -> None:
    # La página se va a about:blank mientras se apaga y se arranca: si no, sus pedidos de
    # fondo dan 409/503 y Playwright los entrega recién en la primera pantalla siguiente.
    page.goto("about:blank")
    # Los mismos chequeos de apagado y arranque que humo_full.py (sin procesos colgados)
    hf.apagar("todo, después de la interfaz")
    hf.arrancar(SOLO_HDFS, "solo HDFS para la interfaz")
    page.wait_for_timeout(500)
    ETAPA["nombre"] = "solo-hdfs"
    RESULTADOS.extend(hf.RESULTADOS)
    hf.RESULTADOS.clear()
    recorrer(page, "solo-hdfs")
    with Chequeo("solo HDFS: YARN avisa que el servicio no está") as c:
        ir(page, "yarn")
        texto = page.locator("#contenido").inner_text()
        c.detalle = texto[:200].replace("\n", " / ")
        codigo, r = pedir("GET", "/api/yarn/apps")
        assert codigo == 503 and r["code"] == "service_down", (codigo, r)
    with Chequeo("solo HDFS: en Inicio, Hive figura no disponible con su arreglo") as c:
        inicio_dice(page, c)
        hive = page.locator(".capcard", has=page.get_by_role("heading", name="Consultas en Hive"))
        expect(hive).to_have_attribute("data-k", "blocked")
        expect(hive.get_by_role("button")).not_to_have_text("Abrir")
    extender("solo_hdfs", page)


def apagado(page: Page) -> None:
    # Esta vez la página queda abierta (en Cluster, desde donde se apaga) mientras se
    # apaga: lo que pida de fondo con el cluster apagado tiene que contestar 200
    ir(page, "cluster")
    hf.apagar("solo HDFS, con la interfaz abierta")
    RESULTADOS.extend(hf.RESULTADOS)
    hf.RESULTADOS.clear()
    ETAPA["nombre"] = "apagado"
    n409 = len(RESPUESTAS_409)
    recorrer(page, "apagado")
    with Chequeo("apagado: en YARN, 10 s sin ningún 409 en la red ni en la consola") as c:
        n = len(CONSOLA)
        ir(page, "yarn")
        page.wait_for_timeout(10_000)   # el sondeo de fondo va cada 2 s
        nuevos = RESPUESTAS_409[n409:]
        c.detalle = f"{len(nuevos)} respuestas 409, {len(errores_desde(n))} errores de consola" + (
            f": {sorted({r['url'] for r in nuevos})}" if nuevos else "")
        assert not nuevos and not errores_desde(n), (nuevos[:5], errores_desde(n)[:3])
    with Chequeo("apagado: Inicio ofrece iniciar el cluster") as c:
        inicio_dice(page, c, "apagado")
        expect(page.locator(".hero").get_by_role("button", name="Iniciar cluster")).to_be_visible()
    extender("apagado", page)

    with Chequeo("apagado: Iniciar desde la interfaz, en Cluster") as c:
        n = len(CONSOLA)
        ir(page, "cluster")
        # La barra de arriba tiene los mismos botones: los de la cabecera de Cluster
        cabecera = page.locator(".page-head")
        boton = cabecera.get_by_role("button", name="Iniciar cluster", exact=True)
        expect(boton).to_be_enabled(timeout=10_000)
        boton.click()
        t0 = time.time()

        def listo():
            s = hf.estado()
            if s["phase"] == "stopped" and s.get("boot") and any(p["state"] == "failed" for p in s["boot"]["steps"]):
                raise SystemExit(f"el arranque falló: {[p['name'] for p in s['boot']['steps'] if p['state'] == 'failed']}")
            return s if s["phase"] == "running" else None
        try:   # SystemExit: hf.esperar no lo toma como "todavía no"
            s = hf.esperar(listo, hf.ARRANQUE, "running", 3)
        except SystemExit as e:
            raise AssertionError(str(e)) from None
        expect(cabecera.get_by_role("button", name="Detener", exact=True)).to_be_visible(timeout=20_000)
        captura(page, "apagado-iniciado-desde-la-interfaz")
        c.detalle = f"{round(time.time() - t0, 1)} s; servicios: {s['config']['services']}"
        assert all(p["state"] in ("done", "skipped") for p in s["boot"]["steps"])
        assert not errores_desde(n), errores_desde(n)
    page.goto("about:blank")
    hf.apagar("después de iniciar desde la interfaz")
    RESULTADOS.extend(hf.RESULTADOS)
    hf.RESULTADOS.clear()


def resumen() -> int:
    SALIDAS.mkdir(parents=True, exist_ok=True)
    (SALIDAS / "resumen-ui.json").write_text(json.dumps({"chequeos": RESULTADOS, "consola": CONSOLA,
                                                        "esperados": ESPERADOS,
                                                        "respuestas409": RESPUESTAS_409}, indent=2,
                                                        ensure_ascii=False) + "\n")
    malos = [r for r in RESULTADOS if not r["ok"]]
    L = [f"## Humo de la interfaz: {len(RESULTADOS) - len(malos)} de {len(RESULTADOS)} bien", "",
         "| | Chequeo | Segundos | Detalle |", "|---|---|---|---|"]
    for r in RESULTADOS:
        det = (r["detalle"] + (" — " + r["error"] if r["error"] else "")).replace("|", "/").replace("\n", " ")
        L.append(f"| {'✅' if r['ok'] else '❌'} | {r['nombre']} | {r['segundos']} | {det[:700]} |")
    L += ["", f"Errores de consola en total: {len(CONSOLA)}",
          f"503 esperados con solo HDFS (no cuentan): {len(ESPERADOS)} en "
          f"{sorted({e['recurso'] for e in ESPERADOS})}", ""]
    (SALIDAS / "resumen-ui.md").write_text("\n".join(L) + "\n")
    print("\n".join(L))
    return 1 if malos else 0


def main() -> int:
    esperar(lambda: pedir("GET", "/api/status")[0] == 200, 60, "el servidor")
    EXTENSIONES.extend(extensiones())
    try:
        with sync_playwright() as pw:
            # WebGL por software (SwiftShader): el runner no tiene GPU y la pantalla de ML dibuja en 3D
            nav = pw.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader",
                                           "--ignore-gpu-blocklist"])
            page = nav.new_page(viewport={"width": 1440, "height": 900}, locale="es-AR")

            def anotar(tipo, texto, donde="", recurso=""):
                e = {"etapa": ETAPA["nombre"], "tipo": tipo, "texto": texto[:500], "donde": donde, "recurso": recurso}
                (ESPERADOS if es_esperado(e) else CONSOLA).append(e)
            page.on("console", lambda m: m.type == "error" and anotar(
                "console", m.text, page.url, (m.location or {}).get("url", "")))
            page.on("pageerror", lambda e: anotar("pageerror", str(e), page.url))
            page.on("response", lambda r: r.status == 409 and RESPUESTAS_409.append(
                {"etapa": ETAPA["nombre"], "url": r.url}))
            todo(page)
            solo_hdfs(page)
            apagado(page)
            nav.close()
    except Exception:
        traceback.print_exc()
        RESULTADOS.append({"nombre": "el humo de la interfaz se cortó", "ok": False, "segundos": 0, "detalle": "",
                           "error": traceback.format_exc()[-1500:]})
    try:
        prendido = hf.estado()["phase"] != "stopped"
    except Exception:
        prendido = True
    if prendido:   # se cortó antes de apagar: que no queden procesos colgados
        hf.apagar("al final de la interfaz")
    RESULTADOS.extend(hf.RESULTADOS)
    return resumen()


if __name__ == "__main__":
    sys.exit(main())
