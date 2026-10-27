"""Estudio de ML (ml_estudio.py y sandbox_ml): el catálogo contra las librerías
de verdad, la validación de recetas, que el código generado compile para todos
los modelos y que algunas corridas chicas anden de punta a punta (perfil,
revisar, código, entrenar, experimento, descargar, predecir, código editado y
cancelar)."""
import asyncio
import inspect
import json
import time

import pytest

from sandbox_ml import catalogo as cat
from sandbox_ml import codigo as gen
from sandbox_ml import receta as rec

COLS = {"antiguedad_meses": "numerica", "visitas_mes": "numerica", "ticket_promedio": "numerica", "reclamos": "numerica",
        "edad": "numerica", "segmento_real": "categorica", "gasto_mes_siguiente": "ignorar", "vuelve": "ignorar"}
DATOS = {"origen": "local", "ruta": "/datos/clientes_senal.csv"}


def receta(**kw):
    base = {"datos": DATOS, "tarea": "clasificacion", "objetivo": "vuelve", "columnas": dict(COLS),
            "modelo": {"id": "arbol_clf"}}
    base.update(kw)
    return base


def campos(errores):
    return {e["campo"] for e in errores}


# ------------------------------------------------------------------ catálogo


def test_catalogo_esquemas_bien_formados():
    for m in cat.MODELOS.values():
        assert m["tarea"] in cat.TAREAS and m["motor"] in ("sklearn", "spark"), m["id"]
        nombres = [p["nombre"] for p in m["params"]]
        assert len(nombres) == len(set(nombres)), (m["id"], nombres)
        for p in m["params"]:
            assert p["tipo"] in ("int", "float", "choice", "bool", "layers", "str"), (m["id"], p)
            assert {"que", "efecto", "rango"} <= set(p["ayuda"]) and all(p["ayuda"].values()), (m["id"], p["nombre"])
            # El valor por defecto tiene que pasar su propia validación
            assert rec.valor_param(p, p["defecto"], m["id"]) == p["defecto"] or p["tipo"] == "float", (m["id"], p["nombre"])
            if p["tipo"] in ("int", "float"):
                assert p["min"] < p["max"], (m["id"], p["nombre"])
            for otro in (p.get("si") or {}):
                assert otro in nombres, (m["id"], p["nombre"], otro)
            for v in p.get("buscar") or []:
                rec.valor_param(p, v, m["id"])
    assert set(cat.EQUIVALENTE) <= {m["id"] for m in cat.SKLEARN}
    assert set(cat.EQUIVALENTE.values()) <= {m["id"] for m in cat.SPARK}


def test_catalogo_cubre_lo_pedido():
    ids = set(cat.MODELOS)
    assert {"lineal", "ridge", "lasso", "elasticnet", "knn_reg", "svr", "arbol_reg", "bosque_reg", "extra_reg", "gb_reg",
            "hgb_reg", "mlp_reg"} <= ids
    assert {"logistica", "knn_clf", "svc", "naive_bayes", "arbol_clf", "bosque_clf", "extra_clf", "gb_clf", "hgb_clf",
            "adaboost", "mlp_clf"} <= ids
    assert {"kmeans", "minibatch_kmeans", "dbscan", "aglomerativo", "mezcla_gaussiana", "pca"} <= ids
    mlp = {p["nombre"] for p in cat.MODELOS["mlp_clf"]["params"]}
    assert {"solver", "activation", "learning_rate", "learning_rate_init", "alpha", "batch_size", "momentum",
            "early_stopping"} <= mlp
    assert [o["valor"] for o in cat.param(cat.MODELOS["mlp_clf"], "solver")["opciones"]] == ["adam", "sgd", "lbfgs"]


@pytest.mark.parametrize("mid", [m["id"] for m in cat.SKLEARN])
def test_parametros_existen_en_scikit_learn(mid):
    """Cada hiperparámetro del catálogo es un argumento real del estimador (con la versión de la imagen)"""
    import importlib
    m = cat.MODELOS[mid]
    mod, _, clase = m["clase"].rpartition(".")
    try:
        cls = getattr(importlib.import_module(mod), clase)
    except ImportError:
        pytest.skip(f"{mod} no está instalado")
    validos = set(cls().get_params()) | set(inspect.signature(cls).parameters)
    for p in m["params"]:
        assert p["nombre"] in validos, f"{mid}: {p['nombre']} no es un parámetro de {clase}"
    if m.get("semilla"):
        assert m["semilla"] in validos


@pytest.mark.parametrize("mid", [m["id"] for m in cat.SPARK])
def test_parametros_existen_en_spark(mid):
    pytest.importorskip("pyspark.ml")
    import importlib
    from pyspark.ml.param import Param
    m = cat.MODELOS[mid]
    mod, _, clase = m["clase"].rpartition(".")
    est = getattr(importlib.import_module(mod), clase)
    # Los Param de pyspark son atributos de la clase (crear el estimador pediría un SparkContext)
    for p in m["params"]:
        assert isinstance(getattr(est, p["nombre"], None), Param), f"{mid}: {p['nombre']} no es un parámetro de {clase}"
    if m.get("semilla"):
        assert isinstance(getattr(est, "seed", None), Param)


def test_catalogo_es_el_del_modo_demo():
    """La interfaz en modo demo (sin backend) usa una copia del catálogo: tiene que ser la misma"""
    from pathlib import Path
    copia = Path(__file__).resolve().parents[2] / "ui" / "src" / "api" / "demo" / "ml" / "catalogo.json"
    assert json.loads(copia.read_text(encoding="utf-8")) == json.loads(json.dumps(cat.como_json())), \
        "Regenerala: python3 ml/exportar_catalogo.py"


# ------------------------------------------------------------------ receta


def test_receta_completa_con_defectos():
    r = rec.validar(receta())
    assert r["motor"] == "sklearn" and r["validacion"]["particion"] == "estratificada"
    assert r["validacion"]["cv"] == "estratificada" and r["validacion"]["metrica"] == "f1_macro"
    assert r["modelo"]["params"]["criterion"] == "gini" and r["modelo"]["params"]["max_depth"] is None
    assert r["preproceso"]["escalar"] == "estandar"
    assert rec.huella(r) == rec.huella(rec.validar(receta(nombre="otro nombre")))
    assert rec.huella(r) != rec.huella(rec.validar(receta(modelo={"id": "arbol_clf", "params": {"max_depth": 4}})))


@pytest.mark.parametrize("params,campo", [
    ({"max_depth": 0}, "modelo.params.max_depth"),
    ({"max_depth": 2.5}, "modelo.params.max_depth"),
    ({"max_depth": True}, "modelo.params.max_depth"),
    ({"criterion": "otro"}, "modelo.params.criterion"),
    ({"no_existe": 1}, "modelo.params.no_existe"),
])
def test_parametros_invalidos(params, campo):
    _, errores, _ = rec.normalizar(receta(modelo={"id": "arbol_clf", "params": params}))
    assert campo in campos(errores)


def test_parametros_condicionales():
    """momentum solo existe con SGD; con lbfgs no aparece en el código"""
    sgd = rec.validar(receta(modelo={"id": "mlp_clf", "params": {"solver": "sgd", "momentum": 0.5}}))
    assert sgd["modelo"]["params"]["momentum"] == 0.5
    lbfgs = rec.validar(receta(modelo={"id": "mlp_clf", "params": {"solver": "lbfgs", "momentum": 0.5}}))
    assert "momentum" not in lbfgs["modelo"]["params"] and "batch_size" not in lbfgs["modelo"]["params"]
    assert "momentum=" not in gen.generar(lbfgs)
    capas = rec.validar(receta(modelo={"id": "mlp_clf", "params": {"hidden_layer_sizes": " 64 , 32 "}}))
    assert capas["modelo"]["params"]["hidden_layer_sizes"] == "64,32"
    assert "hidden_layer_sizes=(64, 32)," in gen.generar(capas)
    _, errores, _ = rec.normalizar(receta(modelo={"id": "mlp_clf", "params": {"hidden_layer_sizes": "64,,32"}}))
    assert "modelo.params.hidden_layer_sizes" in campos(errores)


def test_reglas_entre_partes():
    _, e, _ = rec.normalizar(receta(tarea="regresion", objetivo="gasto_mes_siguiente", modelo={"id": "lineal"},
                                    validacion={"particion": "estratificada"}))
    assert "validacion.particion" in campos(e)
    _, e, _ = rec.normalizar(receta(modelo={"id": "lineal"}))
    assert "modelo.id" in campos(e)          # un modelo de regresión para clasificar
    _, e, _ = rec.normalizar(receta(validacion={"particion": "temporal"}))
    assert "validacion.columna_tiempo" in campos(e)
    _, e, _ = rec.normalizar(receta(modelo={"id": "logistica", "params": {"l1_ratio": 1.0}}))
    assert "modelo.params.solver" in campos(e)
    _, e, _ = rec.normalizar(receta(columnas={c: "ignorar" for c in COLS}))
    assert "columnas" in campos(e)
    _, e, _ = rec.normalizar(receta(modelo={"id": "bosque_clf_spark"}, validacion={"metrica": "f1_macro"}))
    assert "validacion.metrica" in campos(e)   # Spark no tiene F1 macro
    _, e, _ = rec.normalizar(receta(modelo={"id": "bosque_clf_spark"}, validacion={"cv": "estratificada"}))
    assert "validacion.cv" in campos(e)


def test_busqueda_y_presupuesto():
    r = rec.validar(receta(busqueda={"tipo": "grid", "espacio": {"max_depth": [2, 4, None], "min_samples_leaf": [1, 5]}}))
    assert r["busqueda"]["candidatos"] == 6 and r["busqueda"]["ajustes"] == 30
    r = rec.validar(receta(modelo={"id": "hgb_clf"}, busqueda={"tipo": "random", "iteraciones": 7, "espacio": {
        "learning_rate": {"min": 0.01, "max": 0.3, "log": True}}}))
    assert r["busqueda"]["ajustes"] == 35 and "loguniform(0.01, 0.3)" in gen.generar(r)
    r = rec.validar(receta(busqueda={"tipo": "halving", "factor": 3, "espacio": {"max_depth": list(range(1, 10))}}))
    assert r["busqueda"]["ajustes"] == (9 + 3 + 1) * 5
    _, e, _ = rec.normalizar(receta(busqueda={"tipo": "grid", "espacio": {"max_depth": list(range(1, 30)),
                                                                           "min_samples_leaf": list(range(1, 30))}}))
    assert "busqueda.espacio" in campos(e)   # 841 combinaciones
    _, e, _ = rec.normalizar(receta(busqueda={"tipo": "grid", "espacio": {"max_depth": {"min": 1, "max": 9}}}))
    assert "busqueda.espacio.max_depth" in campos(e)   # un rango no es una grilla
    _, e, _ = rec.normalizar(receta(validacion={"cv": "ninguna"}, busqueda={"tipo": "grid", "espacio": {"max_depth": [2]}}))
    assert "busqueda.tipo" in campos(e)
    _, e, _ = rec.normalizar(receta(modelo={"id": "arbol_clf_spark"}, busqueda={"tipo": "grid", "espacio": {"maxDepth": [2]}}))
    assert "busqueda.tipo" in campos(e)    # en Spark es cv o tvs
    r = rec.validar(receta(modelo={"id": "arbol_clf_spark"}, busqueda={"tipo": "tvs", "espacio": {"maxDepth": [2, 4]}}))
    assert r["busqueda"]["ajustes"] == 2


def perfil_falso(**kw):
    cols = [{"nombre": c, "tipo": "int", "unicos": 50, "rol": "numerica"} for c in COLS]
    cols[5].update(tipo="str", unicos=3, rol="categorica")
    cols[7].update(unicos=2, balance=[{"clase": "1", "n": 950, "pct": 0.95}, {"clase": "0", "n": 50, "pct": 0.05}])
    for c in cols:
        c.update(kw.get(c["nombre"], {}))
    return {"filas": 1000, "columnas": cols}


def test_avisos_con_el_perfil():
    _, e, avisos = rec.normalizar(receta(), perfil_falso(edad={"asociacion": {"valor": 0.99}},
                                                         reclamos={"rol": "id"}))
    tipos = {a["tipo"] for a in avisos}
    assert {"fuga", "id", "desbalance"} <= tipos, avisos
    assert not e
    _, e, _ = rec.normalizar(receta(tarea="regresion", objetivo="segmento_real", modelo={"id": "lineal"}), perfil_falso())
    assert "objetivo" in campos(e)   # una categoría no se predice con regresión
    _, e, _ = rec.normalizar(receta(objetivo="vuelve", columnas={**COLS, "no_esta": "numerica"}), perfil_falso())
    assert "columnas.no_esta" in campos(e)
    p = perfil_falso()
    p["columnas"][7].update(unicos=3, balance=[{"clase": "a", "n": 1, "pct": 0.4}] * 3)
    _, e, _ = rec.normalizar(receta(modelo={"id": "gbt_clf_spark"}), p)
    assert "modelo.id" in campos(e)  # GBT de Spark es solo binaria


# ------------------------------------------------------------------ código


def recetas_de_todos():
    for m in cat.MODELOS.values():
        t = m["tarea"]
        kw = {"modelo": {"id": m["id"]}, "tarea": t}
        if t == "regresion":
            kw["objetivo"] = "gasto_mes_siguiente"
        elif t != "clasificacion":
            kw["objetivo"] = None
        if m["motor"] == "spark" and t in ("regresion", "clasificacion"):
            kw["validacion"] = {"particion": "aleatoria", "cv": "kfold"}
        yield m["id"], kw


@pytest.mark.parametrize("mid,kw", list(recetas_de_todos()))
def test_codigo_compila_para_todos_los_modelos(mid, kw):
    r = rec.validar(receta(**kw))
    codigo = gen.generar(r, "exp-20261027-120000-abcd", "2026-10-27 12:00")
    compile(codigo, f"{mid}.py", "exec")
    nb = gen.a_notebook(codigo)
    assert nb["nbformat"] == 4 and len(nb["cells"]) >= 6
    assert all(c["cell_type"] in ("code", "markdown") for c in nb["cells"])
    assert json.loads(codigo.split("RECETA = json.loads(r'''", 1)[1].split("''')", 1)[0]) == r


def test_codigo_es_deterministico_y_lleva_todo():
    r = rec.validar(receta(preproceso={"outliers": "recortar_iqr", "seleccion": "kbest", "k": 3, "pca": 2},
                           columnas={**COLS, "edad": "fecha"},
                           busqueda={"tipo": "grid", "espacio": {"max_depth": [2, 3]}}))
    a = gen.generar(r, "exp-x", "2026-10-27 12:00")
    assert a == gen.generar(r, "exp-x", "2026-10-27 12:00")
    for trozo in ("ColumnTransformer(", "RecortarExtremos(metodo=\"iqr\", factor=1.5)", "PartesDeFecha()",
                  "SelectKBest(f_classif, k=3)", "PCA(n_components=2", "GridSearchCV(", "StratifiedKFold(n_splits=5",
                  "train_test_split(X, y, test_size=PRUEBA, stratify=y", "random_state=SEMILLA", "joblib.dump(pipeline",
                  "estudio.registrar(", "class RecortarExtremos"):
        assert trozo in a, trozo


def test_codigo_spark():
    r = rec.validar(receta(modelo={"id": "bosque_clf_spark", "params": {"numTrees": 30}},
                           validacion={"particion": "aleatoria", "cv": "kfold", "k": 3, "metrica": "f1_ponderado"},
                           busqueda={"tipo": "cv", "espacio": {"maxDepth": [3, 5]}}))
    c = gen.generar(r, "exp-x", "2026-10-27 12:00")
    for trozo in ("SparkSession.builder", "hdfs\", \"dfs\", \"-put\"", "StringIndexer(inputCol=OBJETIVO", "OneHotEncoder(",
                  "VectorAssembler(", "RandomForestClassifier(", "numTrees=30", "CrossValidator(", "numFolds=3",
                  "addGrid(modelo.maxDepth, [3, 5])", "randomSplit(", "write().overwrite().save(MODELO)",
                  "estudio.registrar_spark("):
        assert trozo in c, trozo
    mlp = rec.validar(receta(modelo={"id": "mlp_spark", "params": {"layers": "8,4"}},
                             validacion={"particion": "aleatoria", "cv": "ninguna", "metrica": "exactitud"}))
    assert "layers=[n_entradas, 8, 4, n_salidas]" in gen.generar(mlp)


# ------------------------------------------------------------------ servidor, de punta a punta


def correr(coro):
    return asyncio.run(coro)


@pytest.fixture
def estudio(mundo, monkeypatch):
    from sandbox_server.ml_estudio import Estudio
    monkeypatch.setattr(Estudio, "every", 0.05)
    # Un dataset con algo de señal (el de conftest es chico y sin relación)
    filas = ["antiguedad_meses,visitas_mes,ticket_promedio,reclamos,edad,segmento_real,gasto_mes_siguiente,vuelve,fecha"]
    for i in range(400):
        vis, rec_, ant = 1 + i % 8, i % 4, 1 + (i * 7) % 60
        vuelve = int(ant >= 36 or (vis >= 4 and rec_ <= 1))
        seg = ("ocasional", "frecuente", "mayorista")[i % 3]
        filas.append(f"{ant},{vis},{1000 + 37 * (i % 50)},{rec_},{20 + i % 50},{seg},{5000 + 1500 * vis - 1500 * rec_ + 50 * ant},"
                     f"{vuelve},2026-{1 + i % 12:02d}-{1 + i % 28:02d}")
    (mundo.dir / "clientes_senal.csv").write_text("\n".join(filas) + "\n")
    e = Estudio(mundo.cl, mundo.runner, mundo.bus, mundo.hdfs, mundo.datos)
    return e


def receta_local(mundo, **kw):
    r = receta(**kw)
    r["datos"] = {"origen": "local", "ruta": str(mundo.dir / "clientes_senal.csv")}
    r["columnas"] = {**COLS, "fecha": "ignorar"}
    return r


def esperar(e, run_id, segundos=180):
    async def bucle():
        for _ in range(int(segundos / 0.05)):
            c = e.corridas[run_id]
            if c["estado"] != "corriendo":
                await e.wait_all()
                return c
            await asyncio.sleep(0.05)
        raise AssertionError(f"la corrida {run_id} no terminó: {e.corrida(run_id)}")
    return bucle()


def test_perfil_de_verdad(estudio, mundo):
    async def main():
        p = await estudio.perfil({"origen": "local", "ruta": str(mundo.dir / "clientes_senal.csv")}, "vuelve")
        assert p["filas"] == 400 and len(p["columnas"]) == 9
        cols = {c["nombre"]: c for c in p["columnas"]}
        assert cols["fecha"]["rol"] == "fecha" and cols["segmento_real"]["rol"] == "categorica"
        assert cols["edad"]["num"]["min"] == 20 and len(cols["edad"]["histograma"]["cuentas"]) > 1
        assert p["objetivo"]["tarea"] == "clasificacion" and {b["clase"] for b in cols["vuelve"]["balance"]} == {"0", "1"}
        assert cols["antiguedad_meses"]["asociacion"]["valor"] > cols["edad"]["asociacion"]["valor"]
        assert len(p["vista"]["filas"]) == 20
        # El segundo pedido sale de la caché
        assert await estudio.perfil({"origen": "local", "ruta": str(mundo.dir / "clientes_senal.csv")}, "vuelve") is p
    correr(main())


def test_perfil_solo_de_datos(estudio):
    from sandbox_server.errors import ApiError
    with pytest.raises(ApiError) as e:
        correr(estudio.perfil({"origen": "local", "ruta": "/etc/passwd"}))
    assert e.value.code == "invalid"
    with pytest.raises(ApiError):
        correr(estudio.perfil({"origen": "local", "ruta": "/datos/../etc/passwd"}))


def test_entrenar_de_punta_a_punta(estudio, mundo):
    async def main():
        r = receta_local(mundo, modelo={"id": "bosque_clf", "params": {"n_estimators": 20}},
                         validacion={"k": 3}, busqueda={"tipo": "grid", "espacio": {"max_depth": [2, 4]}},
                         informe={"curva_validacion": {"param": "max_depth", "valores": [1, 3]}})
        await estudio.perfil(r["datos"], "vuelve")
        rev = estudio.revisar(r)
        assert rev["conPerfil"] and not rev["errores"], rev["errores"]
        code = estudio.codigo(r)
        compile(code["codigo"], "x.py", "exec")
        lanzado = await estudio.entrenar(r)
        with pytest.raises(Exception) as ocupado:
            await estudio.entrenar(r)
        assert "en curso" in str(ocupado.value)
        c = await esperar(estudio, lanzado["run"])
        detalle = estudio.corrida(lanzado["run"])
        assert c["estado"] == "listo", "\n".join(l["texto"] for l in detalle["lineas"][-40:])
        assert c["ajustes"]["total"] == 6 and c["ajustes"]["hechos"] == 6
        assert any(l["texto"].startswith("[100%]") for l in detalle["lineas"])
        exp = estudio.experimento(lanzado["id"])
        assert exp["estado"] == "listo" and exp["origen"] == "estudio" and not exp["editado"]
        assert exp["metricas"]["f1_macro"]["cv"] > 0.6 and exp["metricas"]["f1_macro"]["cv_desvio"] >= 0
        assert exp["busqueda"]["candidatos"] == 2 and "max_depth" in exp["busqueda"]["mejores_params"]
        assert exp["modelo"]["params"]["max_depth"] == exp["busqueda"]["mejores_params"]["max_depth"]
        assert exp["datos"]["hash"] and exp["datos"]["filas"] == 400
        assert exp["modelo_bytes"] > 0 and exp["tiempos"]["total"] > 0
        inf = exp["informe"]
        for k in ("confusion", "roc", "pr", "umbrales", "calibracion", "curva_aprendizaje", "curva_validacion",
                  "permutacion", "importancia", "reporte"):
            assert k in inf, k
        assert {"codigo.py", "modelo.joblib", "informe.json", "experimento.json", "salida.log"} <= set(exp["artefactos"])
        fila = next(f for f in estudio.experimentos() if f["id"] == lanzado["id"])
        assert fila["valor"] == exp["metricas"]["f1_macro"]["cv"] and fila["modeloEtiqueta"] == "Bosque aleatorio"
        # Descargas
        py = estudio.descargar(lanzado["id"], "py").body.decode()
        assert py == (estudio.raiz / lanzado["id"] / "codigo.py").read_text(encoding="utf-8")
        nb = json.loads(estudio.descargar(lanzado["id"], "ipynb").body)
        assert nb["nbformat"] == 4
        j = estudio.a_jupyter(lanzado["id"])
        assert (mundo.dir / "experimentos" / f"{lanzado['id']}.ipynb").is_file() and j["url"].endswith(".ipynb")
        # Predecir filas nuevas y un archivo
        pred = await estudio.predecir(lanzado["id"], {"filas": [
            {"antiguedad_meses": 50, "visitas_mes": 1, "ticket_promedio": 2000, "reclamos": 3, "edad": 30,
             "segmento_real": "frecuente"},
            {"antiguedad_meses": 2, "visitas_mes": 1, "ticket_promedio": 2000, "reclamos": 3, "edad": 30,
             "segmento_real": "nueva"}]})
        assert pred["filas"] == 2 and "prediccion" in pred["columnas"] and "prob_1" in pred["columnas"]
        pred = await estudio.predecir(lanzado["id"], {"archivo": str(mundo.dir / "clientes_senal.csv")})
        assert pred["filas"] == 400 and (mundo.dir / "clientes_senal_predicciones.csv").is_file()
        estudio.borrar(lanzado["id"])
        assert not (estudio.raiz / lanzado["id"]).exists()
    correr(main())


@pytest.mark.parametrize("kw", [
    {"tarea": "regresion", "objetivo": "gasto_mes_siguiente", "modelo": {"id": "ridge"},
     "busqueda": {"tipo": "halving", "espacio": {"alpha": [0.1, 1, 10]}}, "validacion": {"k": 3}},
    {"tarea": "clustering", "objetivo": None, "referencia": "segmento_real", "modelo": {"id": "kmeans"}},
    {"tarea": "reduccion", "objetivo": None, "modelo": {"id": "pca"}},
    {"modelo": {"id": "mlp_clf", "params": {"hidden_layer_sizes": "8", "solver": "sgd", "max_iter": 30}},
     "validacion": {"cv": "repetida", "k": 2, "repeticiones": 2, "validacion": 0.1}, "informe": {"curva_aprendizaje": False}},
])
def test_otras_tareas(estudio, mundo, kw):
    async def main():
        r = receta_local(mundo, **kw)
        if kw.get("tarea") in ("clustering", "reduccion"):
            r["columnas"]["segmento_real"] = "ignorar"
        lanzado = await estudio.entrenar(r)
        c = await esperar(estudio, lanzado["run"])
        assert c["estado"] == "listo", "\n".join(l["texto"] for l in estudio.corrida(lanzado["run"])["lineas"][-40:])
        exp = estudio.experimento(lanzado["id"])
        assert exp["metricas"][exp["metrica"]]["prueba"] is not None
    correr(main())


def test_codigo_editado_y_cancelar(estudio, mundo):
    async def main():
        codigo = estudio.codigo(receta_local(mundo, modelo={"id": "arbol_clf", "params": {"max_depth": 3}}))["codigo"]
        editado = codigo.replace("max_depth=3,", "max_depth=2,")
        assert editado != codigo
        lanzado = await estudio.correr_codigo({"codigo": editado, "motor": "sklearn", "minutos": 5})
        c = await esperar(estudio, lanzado["run"])
        assert c["estado"] == "listo"
        exp = estudio.experimento(lanzado["id"])
        # Lo que quedó registrado es lo que corrió de verdad, no lo de la receta
        assert exp["editado"] and exp["origen"] == "código editado" and exp["modelo"]["params"]["max_depth"] == 2
        # Un código que no registra nada termina como "sin informe"
        lanzado = await estudio.correr_codigo({"codigo": "print('[ 50%] mitad')\nprint('hola')\n", "motor": "sklearn"})
        c = await esperar(estudio, lanzado["run"])
        assert c["estado"] == "listo" and estudio.experimento(lanzado["id"])["estado"] == "sin informe"
        # Uno que falla: el error queda en el experimento
        lanzado = await estudio.correr_codigo({"codigo": "raise SystemExit('se rompió a propósito')\n"})
        c = await esperar(estudio, lanzado["run"])
        assert c["estado"] == "falló" and "a propósito" in estudio.experimento(lanzado["id"])["error"]
        # Cancelar uno largo
        lanzado = await estudio.correr_codigo({"codigo": "import time\nfor i in range(600):\n    print(i, flush=True)\n"
                                                         "    time.sleep(0.1)\n"})
        await asyncio.sleep(0.5)
        desde = estudio.corrida(lanzado["run"])["total"]
        assert desde > 0
        assert all(l["n"] >= 2 for l in estudio.corrida(lanzado["run"], 2)["lineas"])
        estudio.cancelar(lanzado["run"])
        c = await esperar(estudio, lanzado["run"], 20)
        assert c["estado"] == "falló" and "cancelado" in c["error"]
    correr(main())


def test_limite_de_tiempo(estudio, monkeypatch):
    real = time.monotonic
    async def main():
        lanzado = await estudio.correr_codigo({"codigo": "import time\ntime.sleep(60)\n", "minutos": 1})
        await asyncio.sleep(0.3)   # que la corrida arranque y fije su límite
        # El reloj del estudio salta 2 minutos: la corrida se corta sola
        monkeypatch.setattr(estudio, "reloj", lambda: real() + 120)
        c = await esperar(estudio, lanzado["run"], 20)
        assert c["estado"] == "falló" and "límite de tiempo" in c["error"]
    correr(main())


def test_rutas_http(settings, tmp_path):
    from starlette.testclient import TestClient
    from sandbox_server.app import build_app
    with TestClient(build_app(settings, ui_dir=tmp_path)) as c:
        cat_ = c.get("/api/ml/catalog").json()
        assert len(cat_["modelos"]) == len(cat.MODELOS) and "metricas" in cat_
        r = c.post("/api/ml/check", json={"receta": receta(modelo={"id": "arbol_clf", "params": {"max_depth": 0}})}).json()
        assert "modelo.params.max_depth" in campos(r["errores"])
        r = c.post("/api/ml/code", json={"receta": receta()})
        assert r.status_code == 200 and "DecisionTreeClassifier(" in r.json()["codigo"]
        r = c.post("/api/ml/code", json={"receta": receta(modelo={"id": "no"})})
        assert r.status_code == 400 and r.json()["errors"]
        # Con el cluster apagado no se entrena
        r = c.post("/api/ml/runs", json={"codigo": "print(1)", "motor": "sklearn"})
        assert r.status_code == 409 and r.json()["code"] == "cluster_stopped"
        assert c.get("/api/ml/experiments").json() == []
        assert c.get("/api/ml/experiments/exp-20260101-000000-abcd").status_code == 404
        assert c.get("/api/ml/experiments/..%2F..%2Fetc").status_code == 404
