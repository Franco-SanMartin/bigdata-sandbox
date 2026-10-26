"""Lo de adentro de los modelos (jobs/viz.py y GET /api/ml/models/{id}/viz): topes, la
forma del JSON y, con el entrenamiento de verdad, que la misma cuenta que hace la
interfaz dé lo que predijo scikit-learn (con una tolerancia de 1e-6)."""
import asyncio
import json
import os
import subprocess
import sys

import pytest

from sandbox_server import ml as M

sys.path.insert(0, str(M.JOBS))
import viz as V  # noqa: E402

from test_ml import ARBOL, esperar, senal  # noqa: E402

TOL = 1e-6


# ------------------------------------------------------------------ ayudas y topes (sin numpy)


def test_epocas_elegidas_respeta_el_tope_y_guarda_primera_ultima_y_mejor():
    assert V.epocas_elegidas(10, 40) == list(range(10))
    e = V.epocas_elegidas(500, 40, mejor=123)
    assert len(e) <= 40 and e[0] == 0 and e[-1] == 499 and 123 in e and e == sorted(set(e))
    assert V.epocas_elegidas(0, 40) == []


def test_contar_pesos():
    assert V.contar_pesos([5, 16, 8, 1]) == 5 * 16 + 16 + 16 * 8 + 8 + 8 + 1


def test_arbol_a_lo_ancho_numera_y_corta_en_el_tope(monkeypatch):
    # árbol completo de profundidad 4 (31 nodos) como tuplas
    def armar(d):
        return ("hoja",) if d == 4 else ("nodo", armar(d + 1), armar(d + 1))

    def leer(n):
        return {"f": 0 if n[0] == "nodo" else -1}, (n[1], n[2]) if n[0] == "nodo" else None

    nodos, afuera = V.nodos_a_lo_ancho(armar(0), leer)
    assert len(nodos) == 31 and afuera == 0
    for i, n in enumerate(nodos):          # a lo ancho: los hijos de i son 2i+1 y 2i+2
        if n["f"] != -1:
            assert (n["l"], n["r"]) == (2 * i + 1, 2 * i + 2) and nodos[n["l"]]["d"] == n["d"] + 1
    monkeypatch.setattr(V, "TOPE_NODOS", 10)
    nodos, afuera = V.nodos_a_lo_ancho(armar(0), leer)
    assert len(nodos) <= 10 and afuera > 0
    assert any(n["cut"] for n in nodos)
    assert all(0 < n["l"] < len(nodos) for n in nodos if n["f"] != -1 and not n["cut"])
    # la pasada se para en un nodo cortado
    for n in nodos:
        n["t"], n["p"] = 0.5, [0.5, 0.5]
    camino, p = V.pasada_arbol({"nodes": nodos}, [1.0])
    assert nodos[camino[-1]]["cut"] or nodos[camino[-1]]["f"] == -1


def test_escribir_recorta_epocas_y_muestra_si_se_pasa(tmp_path, monkeypatch):
    ruta = tmp_path / "v.json"
    viz = {"kind": "mlp", "weights": [[[1.0]]], "epochs": {"frames": [{"epoch": i, "weights": [[[0.1] * 200]]}
                                                                      for i in range(40)]},
           "sample": {"rows": [[1.0, 2.0]] * 500, "real": [1] * 500, "pred": [1] * 500, "proba": [[0.5, 0.5]] * 500}}
    monkeypatch.setattr(V, "TOPE_BYTES", 8_000)
    V.escribir(viz, ruta)
    out = json.loads(ruta.read_text())
    assert ruta.stat().st_size <= 8_000 and out["v"] == V.VERSION
    assert out["epochs"]["frames"] == [] and out["sample"]["rows"] and len(out["sample"]["rows"]) < 500
    assert len(out["sample"]["rows"]) == len(out["sample"]["proba"]) == len(out["sample"]["real"])
    assert out.get("truncated")


# ------------------------------------------------------------------ servidor: archivo, hasViz, tope en memoria


def test_viz_del_job_queda_en_el_modelo(mundo):
    async def main():
        mid = await mundo.ml.train(ARBOL)
        r = await esperar(mundo.ml, mid)
        assert r["state"] == "done" and r["hasViz"] is True
        assert mundo.ml.get_viz(mid)["kind"] == "tree"
        assert not M.Ml.viz_path(mundo.ml, mid).exists()      # el archivo se borra al leerlo
        # el JSON no viaja en la lista de modelos ni en los eventos
        assert "nodes" not in json.dumps(mundo.ml.models())
    asyncio.run(main())


def test_viz_que_falla_no_rompe_el_entrenamiento(mundo, monkeypatch):
    monkeypatch.setenv("FALSO_FALLA", "viz")

    async def main():
        r = await esperar(mundo.ml, await mundo.ml.train(ARBOL))
        assert r["state"] == "done" and r["hasViz"] is False and r["vizError"] == "ValueError: sin dibujo"
        with pytest.raises(M.ApiError) as e:
            mundo.ml.get_viz(r["id"])
        assert e.value.code == "not_found"
    asyncio.run(main())


def test_solo_guarda_los_ultimos(mundo, monkeypatch):
    monkeypatch.setattr(M, "VIZ_KEEP", 2)

    async def main():
        ids = [(await esperar(mundo.ml, await mundo.ml.train(ARBOL)))["id"] for _ in range(3)]
        assert list(mundo.ml.viz) == ids[1:]
        assert [r["hasViz"] for r in mundo.ml.runs] == [True, True, False]
    asyncio.run(main())


# ------------------------------------------------------------------ el job de verdad: la cuenta da lo mismo


def job_viz(tmp_path, *args):
    salida = tmp_path / "viz.json"
    p = subprocess.run([sys.executable, str(M.JOBS / "entrenar_sklearn.py"), str(tmp_path / "senal.csv"), *args],
                       capture_output=True, text=True, timeout=300, env={**os.environ, "SANDBOX_VIZ": str(salida)})
    assert p.returncode == 0, p.stderr
    res = json.loads(next(l for l in p.stdout.splitlines() if l.startswith("@@resultado@@ "))[len("@@resultado@@ "):])
    assert res.get("viz") is True, res.get("vizError")
    v = json.loads(salida.read_text())
    assert v["v"] == V.VERSION and salida.stat().st_size <= V.TOPE_BYTES
    return v


@pytest.fixture
def datos(tmp_path):
    pytest.importorskip("sklearn")
    pytest.importorskip("pandas")
    senal(tmp_path / "senal.csv", filas=1200)
    return tmp_path


def proba_igual(v, pasada):
    s = v["sample"]
    assert s["rows"] and len(s["rows"]) == len(s["proba"]) == len(s["pred"]) == len(s["real"])
    for x, p, pred in zip(s["rows"], s["proba"], s["pred"]):
        q = pasada(v, x)
        assert max(abs(a - b) for a, b in zip(q, p)) < TOL, (x, q, p)
        assert int(q[1] > q[0]) == pred or abs(q[1] - q[0]) < TOL


def test_red_neuronal_pesos_epocas_y_pasada(datos):
    v = job_viz(datos, "clasificacion", "mlp", "80", json.dumps({"hidden_layer_sizes": "6,4", "max_iter": 60}),
                "antiguedad_meses,visitas_mes,reclamos")
    assert v["kind"] == "mlp" and v["layers"] == [3, 6, 4, 1] and v["hidden"] == "relu" and v["out"] == "logistic"
    assert [len(w) for w in v["weights"]] == [3, 6, 4] and [len(w[0]) for w in v["weights"]] == [6, 4, 1]
    assert len(v["sample"]["rows"]) <= V.TOPE_MUESTRA_RED
    ep = v["epochs"]
    assert 0 < len(ep["frames"]) <= V.TOPE_EPOCAS and len(ep["loss"]) >= len(ep["frames"])
    assert ep["frames"][0]["epoch"] == 0 and ep["frames"][-1]["epoch"] == len(ep["loss"]) - 1
    assert all(len(f["weights"]) == 3 for f in ep["frames"])
    proba_igual(v, V.pasada_red)


def test_red_grande_manda_solo_las_capas(datos):
    v = job_viz(datos, "clasificacion", "mlp", "80", json.dumps({"hidden_layer_sizes": "200,120", "max_iter": 3}))
    assert v["weights"] is None and v["layers"] == [5, 200, 120, 1] and "pesos" in v["truncated"]


def test_arbol_nodos_y_camino(datos):
    v = job_viz(datos, "clasificacion", "arbol", "80", json.dumps({"max_depth": 4}))
    assert v["kind"] == "tree" and v["impurity"] == "gini" and v["float32"] is True
    n = v["nodes"]
    assert n[0]["d"] == 0 and n[0]["n"] == 960 and max(x["d"] for x in n) <= 4
    hojas = [x for x in n if x["f"] == -1]
    assert sum(x["n"] for x in hojas) == n[0]["n"]
    proba_igual(v, lambda v, x: V.pasada_arbol(v, x)[1])


def test_logistica_tonto_y_lineal(datos):
    proba_igual(job_viz(datos, "clasificacion", "logistica", "80", "{}"), V.pasada_logistica)
    v = job_viz(datos, "clasificacion", "tonto", "80", json.dumps({"strategy": "most_frequent"}))
    assert v["kind"] == "dummy" and abs(sum(v["prior"]) - 1) < TOL
    v = job_viz(datos, "regresion", "lineal", "80", "{}")
    assert v["kind"] == "linear" and len(v["coef"]) == 5 and len(v["sample"]["rows"]) == 240
    for x, p in zip(v["sample"]["rows"], v["sample"]["pred"]):
        assert abs(V.pasada_lineal(v, x) - p) < TOL * max(1, abs(p))


def test_kmeans_recorrido_y_grupos(datos):
    v = job_viz(datos, "clustering", "kmeans", "80", json.dumps({"n_clusters": 3, "n_init": 10}),
                "visitas_mes,ticket_promedio,reclamos,edad")
    assert v["kind"] == "kmeans" and v["k"] == 3 and v["transform"]["log"] == [False, True, False, False]
    assert len(v["frames"]) >= 2 and all(len(f["centers"]) == 3 for f in v["frames"])
    assert v["pca"] and len(v["pca"]["comps"]) == 3 and len(v["sample"]["rows"]) == V.TOPE_MUESTRA
    for x, g in zip(v["sample"]["rows"], v["sample"]["pred"]):
        assert V.grupo_kmeans(v, x) == g
    # con 2 columnas no hace falta PCA
    assert job_viz(datos, "clustering", "kmeans", "80", "{}", "visitas_mes,ticket_promedio")["pca"] is None
