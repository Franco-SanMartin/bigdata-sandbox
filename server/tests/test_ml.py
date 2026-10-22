"""Machine Learning: validación de train (target, features, params), el modelo
que queda, los eventos 'model' y, si hay scikit-learn, el job de verdad."""
import asyncio
import json
import random
import subprocess
import sys

import pytest

from sandbox_server import ml as M
from sandbox_server.errors import ApiError

ARBOL = {"dataset": "senal", "task": "clasificacion", "model": "arbol", "engine": "sklearn", "trainPct": 80}


async def esperar(ml, mid, segundos=20):
    for _ in range(int(segundos / 0.02)):
        r = next(x for x in ml.runs if x["id"] == mid)
        if r["state"] != "running":
            return r
        await asyncio.sleep(0.02)
    raise AssertionError(f"el modelo {mid} no terminó")


def ultima_llamada(mundo) -> list[str]:
    lines = (mundo.base / "cli.log").read_text().splitlines()
    return next(json.loads(l) for l in reversed(lines) if json.loads(l)[0] == "entrenar")


# ------------------------------------------------------------------ punto 1: target, features y params


def test_train_con_target_features_y_params(mundo):
    async def main():
        mid = await mundo.ml.train({**ARBOL, "target": "vuelve", "features": ["reclamos", "visitas_mes"],
                                    "params": {"max_depth": 5}})
        r = await esperar(mundo.ml, mid)
        assert r["state"] == "done"
        # Eco con los defaults aplicados; las columnas quedan en el orden del dataset
        assert (r["target"], r["features"], r["params"]) == ("vuelve", ["visitas_mes", "reclamos"], {"max_depth": 5})
        _, tarea, modelo, pct, params, feats = ultima_llamada(mundo)
        assert (tarea, modelo, pct, json.loads(params), feats) == ("clasificacion", "arbol", "80", {"max_depth": 5},
                                                                    "visitas_mes,reclamos")
        mid = await mundo.ml.train({**ARBOL, "model": "mlp", "params": {"hidden_layer_sizes": " 32, 16 "}})
        r = await esperar(mundo.ml, mid)
        assert r["params"] == {"hidden_layer_sizes": "32,16", "max_iter": 500}
        assert r["features"] == M.FEATURES and r["target"] == "vuelve"
    asyncio.run(main())


def test_defaults_de_cada_modelo(mundo):
    p = M.Ml.params
    assert p("arbol", None) == {"max_depth": 3}
    assert p("logistica", {}) == {"C": 1}
    assert p("mlp", None) == {"hidden_layer_sizes": "16,8", "max_iter": 500}
    assert p("kmeans", None) == {"n_clusters": 3, "n_init": 10}
    assert p("tonto", None) == {"strategy": "most_frequent"}
    assert p("lineal", None) == {}
    assert p("kmeans", {"n_clusters": 4.0}) == {"n_clusters": 4, "n_init": 10}


@pytest.mark.parametrize("cambio,parte", [
    ({"target": "gasto_mes_siguiente"}, "el objetivo es vuelve"),
    ({"task": "clustering", "model": "kmeans", "target": "vuelve"}, "Clustering no usa columna objetivo"),
    ({"features": []}, "al menos una columna"),
    ({"features": ["vuelve"]}, "vuelve no se puede usar como entrada"),
    ({"features": ["edad", "segmento_real"]}, "segmento_real no se puede usar"),
    ({"params": {"max_depth": 0}}, "max_depth = 0"),
    ({"params": {"C": 1}}, "C no es un parámetro"),
    ({"model": "mlp", "params": {"hidden_layer_sizes": [16, 8]}}, "hidden_layer_sizes"),
    ({"model": "mlp", "params": {"hidden_layer_sizes": "16,,8"}}, "hidden_layer_sizes"),
    ({"model": "tonto", "params": {"strategy": "siempre_si"}}, "strategy"),
    ({"params": "max_depth=3"}, "params tiene que ser un objeto"),
    ({"trainPct": 99}, "de 50 a 95"),
])
def test_train_invalid(mundo, cambio, parte):
    async def main():
        with pytest.raises(ApiError) as e:
            await mundo.ml.train({**ARBOL, **cambio})
        assert e.value.code == "invalid" and parte in str(e.value)
        assert mundo.ml.runs == []
    asyncio.run(main())


def test_train_otros_errores(mundo):
    async def main():
        for req, code in (({**ARBOL, "model": "kmeans"}, "unsupported"), ({**ARBOL, "engine": "mllib", "model": "tonto"},
                                                                          "unsupported"),
                          ({**ARBOL, "dataset": "otro"}, "not_found")):
            with pytest.raises(ApiError) as e:
                await mundo.ml.train(req)
            assert e.value.code == code
        mid = await mundo.ml.train(ARBOL)
        with pytest.raises(ApiError) as e:
            await mundo.ml.train(ARBOL)
        assert e.value.code == "busy"
        await esperar(mundo.ml, mid)
        mundo.cl.phase = "stopped"
        with pytest.raises(ApiError) as e:
            await mundo.ml.train(ARBOL)
        assert e.value.code == "cluster_stopped"
    asyncio.run(main())


# ------------------------------------------------------------------ punto 2 y punto 7


def test_modelo_medido_y_eventos_model(mundo):
    async def main():
        q = mundo.bus.subscribe()
        mid = await mundo.ml.train({**ARBOL, "engine": "mllib"})
        r = await esperar(mundo.ml, mid)
        assert r["state"] == "done" and r["reference"] is False
        assert r["appId"].startswith("application_") and r["trace"]["appIds"] == [r["appId"]]
        assert r["metrics"] == {"aciertos": 0.9093} and r["message"] == "aciertos = 0,9093"
        assert r["confusion"]["labels"] == ["no vuelve", "vuelve"]
        # MLlib lee de HDFS: el job subió clientes_senal.csv antes
        assert (mundo.fs / "user/root/ml/clientes_senal.csv").exists()
        runs = []
        while not q.empty():
            t, d = q.get_nowait()
            if t == "model":
                runs.append(d["run"])
        assert runs[0]["state"] == "running" and runs[-1]["state"] == "done"
        corriendo = [x for x in runs if x["state"] == "running"]
        assert any(x.get("appId") for x in corriendo)
        assert any(0 < x["progress"] < 1 and x["message"] for x in corriendo)
        assert all(x["id"] == mid for x in runs)
        assert mundo.ml.models()[0]["id"] == mid
    asyncio.run(main())


def test_entrenamiento_que_falla(mundo, monkeypatch):
    monkeypatch.setenv("FALSO_FALLA", "python3")

    async def main():
        r = await esperar(mundo.ml, await mundo.ml.train(ARBOL))
        assert r["state"] == "failed" and r["error"] == "ValueError: Input X contains NaN."
    asyncio.run(main())


def test_datasets_y_recomendacion(mundo):
    async def main():
        d = (await mundo.ml.datasets())[0]
        assert d["id"] == "senal" and d["rows"] == 100 and d["inHdfs"] is False
        assert d["sample"]["columns"] == M.COLS and d["sample"]["total"] == 100
        assert [t["task"] for t in d["targets"]] == ["regresion", "clasificacion", "clustering"]
    asyncio.run(main())
    r = mundo.ml.recommend("senal", "clasificacion")
    assert r["choices"][0] == {**r["choices"][0], "model": "arbol", "engine": "sklearn", "fit": "recomendado"}
    assert r["choices"][0]["expected"] == {"seconds": 0.051, "memoryMb": 1.2, "metric": "aciertos", "value": 0.909}
    with pytest.raises(ApiError):
        mundo.ml.recommend("senal", "adivinar")


# ------------------------------------------------------------------ puntos 3 y 4 con el job de verdad


def senal(path, filas=600):
    """Clientes con las reglas de generar_senal.py (sin el ruido), para el job de verdad."""
    rnd = random.Random(7)
    seg = {"ocasional": (1, 2000), "frecuente": (5, 4000), "mayorista": (3, 30000)}
    out = ["antiguedad_meses,visitas_mes,ticket_promedio,reclamos,edad,segmento_real,gasto_mes_siguiente,vuelve"]
    for _ in range(filas):
        s = rnd.choice(list(seg))
        v, t = seg[s]
        visitas, ticket = max(0, v + rnd.randint(-1, 1)), int(t * rnd.uniform(0.8, 1.2))
        ant, rec, edad = rnd.randint(1, 60), rnd.randint(0, 5), rnd.randint(18, 80)
        gasto = 5000 + 1500 * visitas + round(0.8 * ticket) - 1500 * rec + 50 * ant
        vuelve = int(ant >= 36 or (visitas >= 4 and rec <= 1))
        out.append(f"{ant},{visitas},{ticket},{rec},{edad},{s},{gasto},{vuelve}")
    path.write_text("\n".join(out) + "\n")


def job(tmp_path, *args):
    p = subprocess.run([sys.executable, str(M.JOBS / "entrenar_sklearn.py"), str(tmp_path / "senal.csv"), *args],
                       capture_output=True, text=True, timeout=120)
    assert p.returncode == 0, p.stderr
    line = next(l for l in p.stdout.splitlines() if l.startswith("@@resultado@@ "))
    return json.loads(line[len("@@resultado@@ "):])


def test_job_real_confusion_y_predicciones(tmp_path):
    pytest.importorskip("sklearn")
    pytest.importorskip("pandas")
    senal(tmp_path / "senal.csv")
    import pandas as pd
    from sklearn.metrics import confusion_matrix
    from sklearn.model_selection import train_test_split
    from sklearn.tree import DecisionTreeClassifier

    feats = ["antiguedad_meses", "visitas_mes", "reclamos"]
    res = job(tmp_path, "clasificacion", "arbol", "75", json.dumps({"max_depth": 3}), ",".join(feats))
    # Punto 3: la matriz es la de sklearn (filas = real, columnas = predicho), en el orden de labels
    df = pd.read_csv(tmp_path / "senal.csv")
    a, b, ya, yb = train_test_split(df[feats], df["vuelve"], test_size=0.25, random_state=42)
    pred = DecisionTreeClassifier(max_depth=3, random_state=42).fit(a, ya).predict(b)
    assert res["confusion"] == {"labels": ["no vuelve", "vuelve"],
                                "matrix": confusion_matrix(yb, pred, labels=[0, 1]).tolist()}
    assert sum(map(sum, res["confusion"]["matrix"])) == res["testRows"] == 150
    # Punto 4: real y predicho
    p = res["predictions"]
    assert p["columns"] == feats + ["real", "predicho"] and p["total"] == 150
    assert all(len(r) == len(p["columns"]) and r[-1] in (0, 1) for r in p["rows"])

    res = job(tmp_path, "regresion", "lineal", "80", "{}", "visitas_mes,ticket_promedio")
    p = res["predictions"]
    assert p["columns"] == ["visitas_mes", "ticket_promedio", "real", "predicho", "diferencia"]
    assert all(r[4] == r[3] - r[2] for r in p["rows"]) and res["metrics"]["r2"] > 0.5

    res = job(tmp_path, "clustering", "kmeans", "80", json.dumps({"n_clusters": 3, "n_init": 10}),
              "visitas_mes,ticket_promedio")
    p = res["predictions"]
    assert p["columns"] == ["visitas_mes", "ticket_promedio", "segmento_real", "grupo"]
    assert {r[2] for r in p["rows"]} <= {"ocasional", "frecuente", "mayorista"} and res["testRows"] == 0
