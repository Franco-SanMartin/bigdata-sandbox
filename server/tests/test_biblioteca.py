"""Biblioteca de modelos y predicción (etapa (d) del estudio de ML): la deriva (PSI), las versiones con sus
estados (promover, archivar, volver atrás), el linaje, comparar, el script de predicción por lotes y el paquete
exportado con su servicio mínimo, que se levanta de verdad y contesta predicciones.

Lo que necesita Spark (el lote corrido de punta a punta) está en test_biblioteca_spark.py, que corre en la imagen."""
import json
import os
import socket
import subprocess
import sys
import time
import urllib.request
import zipfile
from pathlib import Path

import pytest

from sandbox_ml import biblioteca as bib
from sandbox_ml import deriva
from sandbox_ml import exportar
from sandbox_ml import lote

pd = pytest.importorskip("pandas")
np = pytest.importorskip("numpy")


# ------------------------------------------------------------------ deriva


def clientes(n=2000, semilla=1, corrimiento=0.0, plan_nuevo=False):
    rnd = np.random.default_rng(semilla)
    planes = ["basico", "plus", "premium"] + (["empresa"] if plan_nuevo else [])
    return pd.DataFrame({
        "antiguedad": rnd.uniform(1, 60, n) + corrimiento,
        "ticket": rnd.normal(2000, 400, n) * (1 + corrimiento / 30),
        "plan": rnd.choice(planes, n, p=[0.5, 0.3, 0.2] if not plan_nuevo else [0.2, 0.2, 0.1, 0.5]),
    })


VARS = {"numerica": ["antiguedad", "ticket"], "categorica": ["plan"], "fecha": [], "texto": []}


def test_deriva_estable_con_los_mismos_datos():
    ref = deriva.referencia_pandas(clientes(), VARS)
    assert ref["filas"] == 2000 and set(ref["columnas"]) == {"antiguedad", "ticket", "plan"}
    a = ref["columnas"]["antiguedad"]
    assert len(a["cortes"]) == 9 and len(a["proporciones"]) == 11          # 10 tramos + nulos
    assert abs(sum(a["proporciones"]) - 1) < 1e-6
    assert ref["columnas"]["plan"]["categorias"][0] == "basico"
    # Otra muestra de la misma población: estable
    comp = deriva.comparar(ref, deriva.contar_pandas(clientes(semilla=2), ref))
    assert comp["nivel"] == "estable" and comp["psi_max"] < 0.1, comp


def test_deriva_fuerte_cuando_cambia_la_poblacion():
    ref = deriva.referencia_pandas(clientes(), VARS)
    comp = deriva.comparar(ref, deriva.contar_pandas(clientes(semilla=3, corrimiento=25, plan_nuevo=True), ref))
    por = {c["columna"]: c for c in comp["columnas"]}
    assert comp["nivel"] == "fuerte"
    assert por["antiguedad"]["nivel"] == "fuerte" and por["plan"]["nivel"] == "fuerte"
    # La categoría que no estaba en el entrenamiento cae en "(otras)"
    assert por["plan"]["etiquetas"][-2:] == ["(otras)", "(nulos)"] and por["plan"]["nuevo"][-2] > 0.4
    assert comp["columnas"][0]["psi"] >= comp["columnas"][-1]["psi"]       # de la que más cambió a la que menos


def test_deriva_con_nulos_y_columnas_que_faltan():
    ref = deriva.referencia_pandas(clientes(), VARS)
    nuevos = clientes(semilla=4).drop(columns=["ticket"])
    nuevos.loc[:600, "antiguedad"] = None
    comp = deriva.comparar(ref, deriva.contar_pandas(nuevos, ref))
    assert comp["columnas"][0]["columna"] == "ticket" and comp["columnas"][0]["psi"] is None   # falta: primero
    ant = next(c for c in comp["columnas"] if c["columna"] == "antiguedad")
    assert ant["etiquetas"][-1] == "(nulos)" and ant["nuevo"][-1] > 0.29 and ant["nivel"] == "fuerte"


def test_psi_y_niveles():
    assert deriva.psi([0.5, 0.5], [0.5, 0.5]) == 0
    assert deriva.nivel(0.05) == "estable" and deriva.nivel(0.2) == "moderada" and deriva.nivel(0.3) == "fuerte"
    assert deriva.nivel(None) is None
    assert deriva.psi([0.0, 1.0], [1.0, 0.0]) > 1                            # sin división por cero


def test_el_entrenamiento_deja_la_referencia_y_el_esquema(tmp_path):
    """El script de scikit-learn, de verdad: con clases de texto (PR AUC necesita saber cuál es la positiva), deja
    referencia.json (para la deriva) y el esquema de entrada en el experimento."""
    from sandbox_ml import codigo as gen
    from sandbox_ml import receta as rec
    df = clientes(500)
    df["clase"] = np.where((df["antiguedad"] > 30) | (df["plan"] == "premium"), "vuelve", "no_vuelve")
    df.to_csv(tmp_path / "c.csv", index=False)
    r = rec.validar({"datos": {"origen": "local", "ruta": str(tmp_path / "c.csv")}, "tarea": "clasificacion",
                     "objetivo": "clase", "columnas": {"antiguedad": "numerica", "ticket": "numerica", "plan": "categorica"},
                     "modelo": {"id": "logistica"}, "validacion": {"k": 3, "metrica": "pr_auc"}})
    (tmp_path / "entrenar.py").write_text(gen.generar(r, "exp", "hoy"), encoding="utf-8")
    dest = tmp_path / "exps" / "exp"
    dest.mkdir(parents=True)
    # El script corre en otro proceso: sandbox_ml tiene que estar en su PYTHONPATH (en la imagen ya está)
    ml = str(Path(gen.__file__).resolve().parents[1])
    env = {**os.environ, "SANDBOX_ML_EXPERIMENTOS": str(tmp_path / "exps"), "SANDBOX_ML_EXP": str(dest),
           "PYTHONPATH": os.pathsep.join(x for x in (ml, os.environ.get("PYTHONPATH")) if x)}
    out = subprocess.run([sys.executable, "entrenar.py"], cwd=tmp_path, env=env, capture_output=True, text=True, timeout=300)
    assert out.returncode == 0, out.stdout[-2000:] + out.stderr[-2000:]
    exp = json.loads((dest / "experimento.json").read_text())
    assert exp["metricas"]["pr_auc"]["prueba"] > 0.5
    assert exp["entrada"] == [{"columna": "antiguedad", "rol": "numerica", "tipo": "double"},
                              {"columna": "ticket", "rol": "numerica", "tipo": "double"},
                              {"columna": "plan", "rol": "categorica", "tipo": "string"}]
    ref = json.loads((dest / "referencia.json").read_text())
    assert set(ref["columnas"]) == {"antiguedad", "ticket", "plan"} and ref["filas"] < 500   # solo el entrenamiento


# ------------------------------------------------------------------ biblioteca


@pytest.fixture
def experimentos(tmp_path):
    """Tres experimentos de scikit-learn de verdad (chicos), registrados como los deja estudio.registrar."""
    from sklearn.compose import ColumnTransformer
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder, StandardScaler
    from sandbox_ml.estudio import entrada

    df = clientes(600)
    y = ((df["antiguedad"] > 30) | (df["plan"] == "premium")).astype(int).astype(str)
    salida = {}
    for i, (c, auc) in enumerate([(0.1, 0.81), (1.0, 0.86), (10.0, 0.84)]):
        pipe = Pipeline([("pre", ColumnTransformer([("num", StandardScaler(), ["antiguedad", "ticket"]),
                                                    ("cat", OneHotEncoder(handle_unknown="ignore"), ["plan"])])),
                         ("modelo", LogisticRegression(C=c))]).fit(df, y)
        d = tmp_path / "exps" / f"exp-20261110-12000{i}-00a{i}"
        d.mkdir(parents=True)
        import joblib
        joblib.dump(pipe, d / "modelo.joblib")
        receta = {"tarea": "clasificacion", "objetivo": "vuelve", "datos": {"origen": "local", "ruta": "/datos/c.csv"},
                  "columnas": {"antiguedad": "numerica", "ticket": "numerica", "plan": "categorica", "vuelve": "ignorar"},
                  "validacion": {"particion": "estratificada", "prueba": 0.2, "validacion": 0, "cv": "estratificada",
                                 "k": 5, "metrica": "roc_auc", "semilla": 42}}
        exp = {"id": d.name, "nombre": f"logística C={c}", "estado": "listo", "motor": "sklearn",
               "tarea": "clasificacion", "objetivo": "vuelve", "metrica": "roc_auc", "terminado": "2026-11-10T12:00:00",
               "receta": receta, "huella": f"h{i}", "variables": VARS, "clases": ["0", "1"],
               "modelo": {"id": "logistica", "etiqueta": "Regresión logística", "clase": "sklearn.linear_model.LogisticRegression",
                          "params": {"C": c, "max_iter": 100}},
               "metricas": {"roc_auc": {"prueba": auc, "cv": auc - 0.01}, "exactitud": {"prueba": 0.7 + i / 100}},
               "datos": {"origen": "local", "ruta": "/datos/c.csv", "filas": 600}, "filas": {"entrenamiento": 480, "prueba": 120},
               "entrada": entrada(receta, {"antiguedad": "double", "ticket": "double", "plan": "string"}),
               "entorno": {"python": "3.12.3", "sklearn": "1.9.1", "numpy": "1.26.4", "pandas": "2.3.3"},
               "yarn": {}, "modelo_bytes": (d / "modelo.joblib").stat().st_size}
        (d / "experimento.json").write_text(json.dumps(exp))
        (d / "codigo.py").write_text("# el script\n")
        (d / "referencia.json").write_text(json.dumps(deriva.referencia_pandas(df, VARS)))
        salida[i] = d
    return salida


def test_registrar_promover_archivar_y_volver_atras(experimentos, tmp_path):
    base = tmp_path / "bib"
    v1 = bib.registrar("churn", experimentos[0], nota="línea base", descripcion="quién vuelve", base=base)
    assert v1["version"] == 1 and v1["estado"] == "candidato" and v1["deriva"]
    assert (base / "churn" / "v1" / "modelo.joblib").is_file() and v1["artefacto"].endswith("v1/modelo.joblib")
    lin = v1["linaje"]
    assert lin["experimento"] == experimentos[0].name and lin["datos"]["ruta"] == "/datos/c.csv"
    assert lin["validacion"]["metrica"] == "roc_auc" and lin["entorno"]["sklearn"] == "1.9.1"
    assert [c["columna"] for c in v1["entrada"]] == ["antiguedad", "ticket", "plan"]
    bib.registrar("churn", experimentos[1], base=base)
    bib.registrar("churn", experimentos[2], base=base)
    # Sin producción: predecir pide elegir
    with pytest.raises(bib.ErrorBiblioteca, match="no tiene una versión en producción"):
        bib.elegir("churn", None, base)
    bib.promover("churn", 1, nota="primera", base=base)
    m = bib.promover("churn", 2, nota="le gana en la prueba", base=base)
    assert [x["estado"] for x in m["versiones"]] == ["archivado", "produccion", "candidato"]
    assert bib.elegir("churn", None, base)[1]["version"] == 2
    # Volver atrás: la 1, que estuvo antes en producción
    m = bib.volver_atras("churn", nota="la 2 anda mal con los datos nuevos", base=base)
    assert [x["estado"] for x in m["versiones"]] == ["produccion", "archivado", "candidato"]
    acciones = [(h["accion"], h["version"]) for h in m["historial"]]
    assert acciones[-2:] == [("archivar", 2), ("volver", 1)]
    # La lista resume cada modelo
    fila = bib.listar(base)[0]
    assert fila["nombre"] == "churn" and fila["produccion"] == 1 and fila["versiones"] == 3 and fila["candidatas"] == 1
    assert fila["valor"] == 0.81 and fila["descripcion"] == "quién vuelve"
    # Archivar la de producción deja al modelo sin versión en producción
    m = bib.archivar("churn", 1, base=base)
    assert bib.en_produccion(m) is None
    with pytest.raises(bib.ErrorBiblioteca, match="ya está archivada"):
        bib.archivar("churn", 1, base=base)
    # Promover la 3 y volver atrás: vuelve a la 1, a la que se había vuelto (eso también es estar en producción)
    bib.promover("churn", 3, base=base)
    m = bib.volver_atras("churn", base=base)
    assert bib.en_produccion(m)["version"] == 1


def test_registrar_valida(experimentos, tmp_path):
    base = tmp_path / "bib"
    for malo in ("Churn", "con espacio", "", "../x", "a" * 60):
        with pytest.raises(bib.ErrorBiblioteca, match="minúsculas"):
            bib.registrar(malo, experimentos[0], base=base)
    bib.registrar("churn", experimentos[0], base=base)
    with pytest.raises(bib.ErrorBiblioteca, match="ya es la versión 1"):
        bib.registrar("churn", experimentos[0], base=base)
    # Otro objetivo no entra en el mismo modelo
    e = json.loads((experimentos[1] / "experimento.json").read_text())
    e["objetivo"] = "otra"
    (experimentos[1] / "experimento.json").write_text(json.dumps(e))
    with pytest.raises(bib.ErrorBiblioteca, match="predice otra cosa"):
        bib.registrar("churn", experimentos[1], base=base)
    # Un experimento que falló no se guarda
    e.update(objetivo="vuelve", estado="falló")
    (experimentos[1] / "experimento.json").write_text(json.dumps(e))
    with pytest.raises(bib.ErrorBiblioteca, match="no terminó bien"):
        bib.registrar("churn", experimentos[1], base=base)
    with pytest.raises(bib.ErrorBiblioteca, match="no tiene la versión 7"):
        bib.promover("churn", 7, base=base)
    with pytest.raises(bib.ErrorBiblioteca, match="No hay una versión anterior"):
        bib.volver_atras("churn", base=base)


def test_comparar_versiones(experimentos, tmp_path):
    base = tmp_path / "bib"
    for i in range(3):
        bib.registrar("churn", experimentos[i], base=base)
    c = bib.comparar("churn", ["1", "2", "3"], base)
    principal = c["metricas"][0]
    assert principal["metrica"] == "roc_auc" and principal["principal"] and principal["mejor"] == [2]
    assert principal["valores"] == [0.81, 0.86, 0.84]
    params = {p["param"]: p for p in c["params"]}
    assert params["C"]["cambia"] and not params["max_iter"]["cambia"]
    assert [d["huella"] for d in c["datos"]] == ["h0", "h1", "h2"]


# ------------------------------------------------------------------ lotes


def test_script_del_lote(experimentos, tmp_path):
    base = tmp_path / "bib"
    x = bib.registrar("churn", experimentos[1], base=base)
    salida, errores = lote.normalizar_salida({}, "churn", 1)
    assert not errores and salida == {"tipo": "hdfs", "ruta": "/user/root/ml/predicciones/churn-v1", "formato": "parquet",
                                      "modo": "overwrite"}
    codigo = lote.generar(x, base / "churn" / "v1", {"origen": "hdfs", "ruta": "/user/root/nuevos", "formato": "parquet"},
                          salida, nombre="churn")
    compile(codigo, "lote.py", "exec")
    assert "mapInPandas(predecir" in codigo and "addFile(ARTEFACTO)" in codigo and "deriva.contar_spark" in codigo
    assert 'spark.read.parquet("/user/root/nuevos")' in codigo
    hive, errores = lote.normalizar_salida({"tipo": "hive", "modo": "append"}, "churn", 1)
    assert not errores and hive["tabla"] == "default.pred_churn_v1"
    codigo = lote.generar(x, base / "churn" / "v1", {"origen": "hive", "tabla": "ventas.nuevos"}, hive, nombre="churn")
    compile(codigo, "lote.py", "exec")
    assert "enableHiveSupport()" in codigo and "saveAsTable" in codigo
    for malo in ({"tipo": "s3"}, {"ruta": "relativa"}, {"ruta": "/a/../b"}, {"formato": "xls"}, {"modo": "borrar"},
                 {"tipo": "hive", "tabla": "a;drop"}):
        assert lote.normalizar_salida(malo, "churn", 1)[1], malo


# ------------------------------------------------------------------ exportar


def libre() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_exportar_y_servir(experimentos, tmp_path):
    """El .zip se descomprime en otra carpeta, se levanta servir.py y contesta como el modelo."""
    base = tmp_path / "bib"
    x = bib.registrar("churn", experimentos[1], base=base)
    z = exportar.armar("churn", x, base / "churn" / "v1", tmp_path / "churn.zip")
    with zipfile.ZipFile(z) as f:
        nombres = set(f.namelist())
        f.extractall(tmp_path / "afuera")
    for esperado in ("modelo.joblib", "servir.py", "modelo.json", "requirements.txt", "Dockerfile", "LEEME.md",
                     "sandbox_ml/transformadores.py", "entrenamiento.py"):
        assert f"churn-v1/{esperado}" in nombres, esperado
    raiz = tmp_path / "afuera" / "churn-v1"
    req = (raiz / "requirements.txt").read_text()
    assert "scikit-learn==1.9.1" in req and "pandas==2.3.3" in req
    assert "FROM python:3.12-slim" in (raiz / "Dockerfile").read_text()
    assert "| plan | categorica | string |" in (raiz / "LEEME.md").read_text()
    puerto = libre()
    # Sin el repo en el PYTHONPATH: tiene que andar solo, con lo que trae el .zip
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    env.update(PUERTO=str(puerto), HOST="127.0.0.1")
    p = subprocess.Popen([sys.executable, "servir.py"], cwd=raiz, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        url = f"http://127.0.0.1:{puerto}"
        for _ in range(100):
            try:
                with urllib.request.urlopen(url + "/salud", timeout=1) as r:
                    assert json.loads(r.read()) == {"ok": True}
                break
            except OSError:
                time.sleep(0.1)
        else:
            raise AssertionError(p.stdout.read().decode() if p.poll() is not None else "servir.py no arrancó")
        with urllib.request.urlopen(url + "/", timeout=5) as r:
            ficha = json.loads(r.read())
        assert ficha["modelo"] == "churn" and ficha["version"] == 1 and ficha["metrica"] == "roc_auc"
        filas = [{"antiguedad": 50, "ticket": 1800, "plan": "basico"}, {"antiguedad": 2, "ticket": 2500, "plan": "plus"}]
        req = urllib.request.Request(url + "/predecir", data=json.dumps({"filas": filas}).encode(),
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=10) as r:
            pred = json.loads(r.read())["predicciones"]
        assert [x["prediccion"] for x in pred] == ["1", "0"]
        assert set(pred[0]["probabilidades"]) == {"0", "1"} and pred[0]["probabilidades"]["1"] > 0.5
        # Una columna que falta: 400 con el nombre
        req = urllib.request.Request(url + "/predecir", data=json.dumps({"filas": [{"antiguedad": 1}]}).encode())
        with pytest.raises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(req, timeout=5)
        assert e.value.code == 400 and "ticket" in json.loads(e.value.read())["error"]
    finally:
        p.terminate()
        p.wait(10)


# ------------------------------------------------------------------ servidor


def test_rutas_de_la_biblioteca(mundo, experimentos, monkeypatch):
    """Registrar, cambiar el estado, comparar, predecir al instante y exportar por el servidor (scikit-learn)."""
    import asyncio
    import shutil

    from sandbox_server.errors import ApiError
    from sandbox_server.ml_biblioteca import Biblioteca
    from sandbox_server.ml_estudio import Estudio

    e = Estudio(mundo.cl, mundo.runner, mundo.bus, mundo.hdfs, mundo.datos)
    for d in experimentos.values():
        shutil.copytree(d, e.raiz / d.name)
    b = Biblioteca(e)
    monkeypatch.setattr(b, "_hdfs_arriba", lambda: False)

    async def main():
        ids = [d.name for d in experimentos.values()]
        m = await b.registrar({"nombre": "churn", "experimento": ids[0], "nota": "base"})
        assert len(m["versiones"]) == 1 and m["lotes"] == []
        await b.registrar({"nombre": "churn", "experimento": ids[1]})
        with pytest.raises(ApiError) as err:
            await b.registrar({"nombre": "Churn", "experimento": ids[2]})
        assert err.value.code == "invalid"
        with pytest.raises(ApiError) as err:
            b.modelo("nada")
        assert err.value.code == "not_found"
        m = b.estado("churn", {"accion": "promover", "version": 2, "nota": "mejor AUC"})
        assert bib.en_produccion(m)["version"] == 2
        with pytest.raises(ApiError):
            b.estado("churn", {"accion": "borrar"})
        assert b.comparar("churn", "1,2")["metricas"][0]["mejor"] == [2]
        assert b.listar()[0]["produccion"] == 2
        r = await b.predecir("churn", {"filas": [{"antiguedad": 50, "ticket": 1800, "plan": "basico"}]})
        assert r["version"] == 2 and r["estado"] == "produccion" and "prediccion" in r["columnas"]
        with pytest.raises(ApiError) as err:
            await b.predecir("churn", {"filas": [{"antiguedad": 50}]})
        assert "Faltan columnas" in str(err.value)
        cod = b.codigo_lote("churn", {"datos": {"origen": "hdfs", "ruta": "/user/root/nuevos", "formato": "csv"},
                                      "salida": {"tipo": "hdfs", "formato": "csv"}})
        compile(cod["codigo"], "lote.py", "exec")
        assert cod["comando"].startswith("spark-submit --master yarn")
        resp = await b.exportar("churn", None)
        with zipfile.ZipFile(__import__("io").BytesIO(resp.body)) as z:
            assert "churn-v2/servir.py" in z.namelist()
    asyncio.run(main())
