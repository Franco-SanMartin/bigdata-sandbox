"""HDFS: WebHDFS simulado con las fixtures y un 'hdfs' falso en el PATH que
anota los comandos (y para fsck devuelve la fixture)."""
import asyncio
import json
import urllib.parse

import pytest
from starlette.testclient import TestClient

from conftest import BASE, FIX, fixture_json, fixture_text
from sandbox_server import hdfs as H
from sandbox_server import probes
from sandbox_server.actions import ActionRunner
from sandbox_server.app import build_app
from sandbox_server.cluster import Cluster
from sandbox_server.errors import ApiError
from sandbox_server.events import EventBus

RUNNING = {"available": True, "safeMode": False, "liveDataNodes": 2, "staleDataNodes": 0, "deadDataNodes": 0,
           "files": 3, "blocks": 15, "replicas": 30, "underReplicated": 1, "missing": 0, "overReplicated": 0,
           "usedMb": 28}


class WebHdfs:
    """Responde como el NameNode: (ruta, op) -> fixture."""

    def __init__(self):
        self.calls: list[tuple[str, str]] = []
        self.status = {"/": "webhdfs_status_dir.json", "/user/root": "webhdfs_status_dir.json",
                       "/user/root/ventas": "webhdfs_status_dir.json",
                       "/user/root/numeros.txt": "webhdfs_status_archivo.json",
                       "/user/root/ventas/ventas_grandes.csv": "webhdfs_status_archivo.json"}
        self.ls = {"/": "webhdfs_ls_raiz.json", "/user/root": "webhdfs_ls_user_root.json"}
        self.content = b"fecha,producto,cantidad,precio\n2026-01-01,yerba,2,1500.5\n2026-01-02,mate,1,9000\n"

    def __call__(self, url, timeout=5.0, limit=None):
        u = urllib.parse.urlparse(url)
        path = urllib.parse.unquote(u.path.removeprefix("/webhdfs/v1")) or "/"
        op = urllib.parse.parse_qs(u.query)["op"][0]
        self.calls.append((path, op))
        if op == "GETFILESTATUS":
            name = self.status.get(path)
        elif op == "LISTSTATUS":
            name = self.ls.get(path, "webhdfs_ls_user_root.json" if path in self.status else None)
        elif op == "GETCONTENTSUMMARY":
            name = "webhdfs_contentsummary.json" if path in self.status else None
        elif op == "OPEN":
            return 200, self.content
        else:
            return 400, b"{}"
        if name is None:
            return 404, (FIX / "webhdfs_404.json").read_bytes()
        return 200, (FIX / name).read_bytes()


@pytest.fixture
def fake_hdfs(tmp_path, monkeypatch):
    """Un 'hdfs' en el PATH que anota lo que le piden; fsck imprime la fixture."""
    bin_dir = tmp_path / "fakebin"
    bin_dir.mkdir()
    log = tmp_path / "hdfs.log"
    fsck = tmp_path / "fsck.txt"
    fsck.write_text(fixture_text("fsck_escribiendo.txt"))
    script = bin_dir / "hdfs"
    script.write_text(f"""#!/bin/bash
echo "$*" >> {log}
if [ "$1" = fsck ]; then cat {fsck}; grep -q 'is CORRUPT' {fsck} && exit 1; exit 0; fi
exit 0
""")
    script.chmod(0o755)
    monkeypatch.setenv("PATH", f"{bin_dir}:{__import__('os').environ['PATH']}")
    return {"log": log, "fsck": fsck}


def make(settings, tmp_path):
    datos = tmp_path / "datos"
    (datos / "ejemplos").mkdir(parents=True)
    (datos / "numeros.txt").write_text("".join(f"{i}\n" for i in range(1, 2001)))
    (datos / "ejemplos" / "texto.txt").write_text("hola mundo\n")
    settings.datos_dir = datos
    bus = EventBus()
    runner = ActionRunner(bus)
    cl = Cluster(bus, runner, settings)
    cl.phase = "running"
    cl.config = {**cl.config, **BASE}
    cl.hdfs = dict(RUNNING)
    cl.nn_active_port = 9870
    cl.nn_jmx = fixture_json("nn_jmx.json")
    h = H.Hdfs(cl, runner, bus)
    h.http = WebHdfs()
    return cl, h, bus


# ------------------------------------------------------------------ formatos


def test_rutas_y_permisos():
    assert H.clean("user//root/") == "/user/root"
    assert H.clean("hdfs://localhost:9000/user/root") == "/user/root"
    assert H.clean("/a/../b") == "/b"
    with pytest.raises(ApiError):
        H.clean("")
    assert H.perm_str("1777", True) == "rwxrwxrwt"
    assert H.perm_str("644", False) == "rw-r--r--"
    assert H.parent_of("/") is None and H.parent_of("/user") == "/"


def test_fsck_con_archivo_escribiendose():
    files = probes.parse_fsck(fixture_text("fsck_escribiendo.txt"), 1)
    by = {f["path"]: f for f in files}
    assert by["/user/root/subida.csv._COPYING_"]["state"] == "writing"
    assert len(by["/user/root/subida.csv._COPYING_"]["blocks"]) == 2
    assert by["/user/root/numeros.txt"]["state"] == "ok" and len(by["/user/root/numeros.txt"]["blocks"]) == 7
    assert by["/user/root/ventas/ventas_grandes.csv"]["state"] == "under"


def test_resumen_de_fsck_solo_bloques_replicados():
    r = H.parse_fsck_report(fixture_text("fsck_escribiendo.txt"), "/")
    # Los números de 'Erasure Coded Block Groups' (todos 0) no pisan a los replicados
    assert r["healthy"] and r["files"] == 3 and r["blocks"] == 15 and r["dirs"] == 4
    assert r["underReplicated"] == 1 and r["liveDataNodes"] == 2 and r["avgReplication"] == 2.0
    assert r["problems"] == [{"file": "/user/root/ventas/ventas_grandes.csv", "block": "blk_1073741824_1000",
                              "issue": "under", "replicas": 2, "expected": 3}]
    r = H.parse_fsck_report(fixture_text("fsck.txt"), "/")
    assert not r["healthy"] and r["missing"] == 1 and r["totalSizeMb"] == 3.500977
    issues = {(p["file"], p["issue"]) for p in r["problems"]}
    assert ("/datos/sucias.csv", "missing") in issues and ("/datos/ventas.csv", "under") in issues


def test_vista_previa():
    s = H.preview_from("/x.csv", b"a,b\n1,2.5\nhola,3\n", 17)
    assert s == {"columns": ["a", "b"], "rows": [[1, 2.5], ["hola", 3]], "format": "csv", "total": 2}
    s = H.preview_from("/n.txt", b"1\n2\n3\n4", 100)
    assert s["columns"] == ["línea"] and s["rows"] == [[1], [2], [3]] and "note" in s
    assert H.preview_from("/a.parquet", b"PAR1xxxx", 8)["format"] == "parquet"


def test_quien_lo_escribio():
    assert H.written_by("/user/hive/warehouse/ventas/000000_0") == "Hive"
    assert H.written_by("/user/root/resultados/mr_por_producto/part-00000") == "MapReduce"
    assert H.written_by("/user/root/resultados/spark_por_producto/part-00000-ab12.csv") == "Spark"
    assert H.written_by("/user/root/ventas/ventas_grandes.csv") == "cliente HDFS"


# ------------------------------------------------------------------ consultas


def test_listado(settings, tmp_path, fake_hdfs):
    async def main():
        cl, h, _ = make(settings, tmp_path)
        raiz = await h.listing("/")
        assert raiz["parent"] is None
        tmp = next(e for e in raiz["entries"] if e["name"] == "tmp")
        assert tmp["permission"] == "rwxrwxrwt" and tmp["type"] == "dir"
        ls = await h.listing("/user/root/")
        assert ls["path"] == "/user/root" and ls["parent"] == "/user"
        assert [e["name"] for e in ls["entries"]] == ["resultados", "ventas", "numeros.txt", "subida.csv._COPYING_"]
        num = ls["entries"][2]
        assert num["sizeMb"] == 6.569763 and num["blocks"] == 7 and num["replication"] == 2
        assert num["blockSizeMb"] == 1 and num["permission"] == "rw-r--r--" and num["state"] == "ok"
        assert ls["entries"][3]["state"] == "writing"
        with pytest.raises(ApiError) as e:
            await h.listing("/user/root/numeros.txt")
        assert e.value.code == "invalid" and "es un archivo" in str(e.value)
        with pytest.raises(ApiError) as e:
            await h.listing("/nada")
        assert e.value.code == "not_found" and str(e.value) == "No existe /nada"
        cl.phase = "stopped"
        with pytest.raises(ApiError) as e:
            await h.listing("/")
        assert e.value.code == "cluster_stopped"
        cl.phase, cl.hdfs = "running", probes.empty_hdfs()
        with pytest.raises(ApiError) as e:
            await h.listing("/")
        assert e.value.code == "service_down"
    asyncio.run(main())


def test_archivos_y_detalle(settings, tmp_path, fake_hdfs):
    async def main():
        cl, h, _ = make(settings, tmp_path)
        files = await h.files()
        by = {f["path"]: f for f in files}
        assert by["/user/root/subida.csv._COPYING_"]["state"] == "writing"
        assert by["/user/root/numeros.txt"]["modifiedAt"] == 1792041290000
        assert by["/user/root/numeros.txt"]["writtenBy"] == "cliente HDFS"
        d = await h.detail("/user/root/numeros.txt")
        assert d["owner"] == "root" and d["permission"] == "rw-r--r--" and d["blockSizeMb"] == 1
        assert d["preview"]["columns"] == ["fecha", "producto", "cantidad", "precio"]
        assert d["preview"]["rows"][0] == ["2026-01-01", "yerba", 2, 1500.5]
        assert d["fsck"][0].startswith("Connecting to namenode")
        with pytest.raises(ApiError) as e:
            await h.detail("/user/root/nada.csv")
        assert e.value.code == "not_found" and str(e.value) == "No existe el archivo /user/root/nada.csv"
    asyncio.run(main())


def test_transferencias_entre_dos_fsck(settings, tmp_path, fake_hdfs):
    async def main():
        cl, h, bus = make(settings, tmp_path)
        q = bus.subscribe()
        before = probes.parse_fsck(fixture_text("fsck.txt"))
        assert h.observe(before) == []          # la primera vez solo toma nota
        after = [dict(f, blocks=[dict(b) for b in f["blocks"]]) for f in before]
        # ventas.csv pasa de 2 a 3 copias (re-replicación) y aparece un bloque nuevo
        after[1]["blocks"][0]["locations"] = [1, 2, 3]
        after.append({"path": "/datos/nuevo.csv", "sizeMb": 1, "replication": 2, "blockSizeMb": 1, "state": "ok",
                      "blocks": [{"id": 1073741900, "genStamp": 1100, "name": "blk_1073741900_1100", "index": 1,
                                  "sizeMb": 1, "locations": [2, 1], "stale": []}]})
        moved = h.observe(after)
        assert {"block": 1073741828, "from": 1, "to": 3} in moved
        assert {"block": 1073741900, "from": "client", "to": 2} in moved
        assert {"block": 1073741900, "from": 2, "to": 1} in moved
        events = []
        while not q.empty():
            events.append(q.get_nowait())
        assert [d for t, d in events if t == "transfer"][0] == {"transfer": moved[0]}
        assert sum(1 for t, _ in events if t == "transfer") == 3
        assert h.recent[0]["at"] > 0
        bus.unsubscribe(q)
    asyncio.run(main())


def test_replicacion(settings, tmp_path, fake_hdfs):
    async def main():
        cl, h, _ = make(settings, tmp_path)
        r = await h.replication()
        assert r["underReplicated"] == 1 and r["missing"] == 0
        # Con 2 DataNodes vivos no hay dónde poner la tercera copia: no se inventa una tarea
        assert r["tasks"] == []
        h._live_count = lambda: 3
        r = await h.replication()
        # ventas_grandes.csv pide 3 copias y tiene 2: una copia pendiente desde el primer DataNode que la tiene
        assert {"block": "blk_1073741824_1000", "file": "/user/root/ventas/ventas_grandes.csv", "kind": "copy",
                "from": 1, "state": "pending"} in r["tasks"]
        assert all(t["file"] != "/user/root/subida.csv._COPYING_" for t in r["tasks"])
    asyncio.run(main())


# ------------------------------------------------------------------ acciones


def comandos(fake):
    return fake["log"].read_text().splitlines() if fake["log"].exists() else []


def test_subir_ejemplo(settings, tmp_path, fake_hdfs):
    async def main():
        cl, h, _ = make(settings, tmp_path)
        r = await h.upload("/user/root/", example="numeros", replication="2", block_size="1m")
        assert r["state"] == "running" and r["id"].startswith("x")
        t = r["trace"]
        assert t["command"] == (f"hdfs dfs -D dfs.replication=2 -D dfs.blocksize=1m -put -f "
                                f"{tmp_path}/datos/numeros.txt /user/root/")
        assert "bloques de 1 MB" in t["action"] and "2 copias" in t["action"]
        assert t["output"].startswith("/user/root/numeros.txt: 1 bloque × 2 copias")
        assert t["after"]["rows"][0] == [1]
        with pytest.raises(ApiError) as e:
            await h.upload("/user/root", example="numeros")
        assert e.value.code == "busy" and "se está escribiendo" in str(e.value)
        await h.runner.wait_all()
        assert "/user/root/numeros.txt" not in h.uploads
        cmds = comandos(fake_hdfs)
        assert "dfs -mkdir -p /user/root" in cmds
        assert any(c.startswith("dfs -D dfs.replication=2 -D dfs.blocksize=1m -put -f ") for c in cmds)
        assert h.runner.get(r["id"]).state == "done"
    asyncio.run(main())


def test_subir_valida(settings, tmp_path, fake_hdfs):
    async def main():
        cl, h, _ = make(settings, tmp_path)
        casos = [
            ({"example": "numeros", "replication": 0}, "La replicación va de 1 a 9"),
            ({"example": "numeros", "block_size": "x"}, "Tamaño de bloque inválido: x (por ejemplo 128m o 2m)"),
            ({}, "Falta el archivo: example o file"),
            ({"example": "pepe"}, None),
        ]
        for kw, msg in casos:
            with pytest.raises(ApiError) as e:
                await h.upload("/user/root", **kw)
            assert e.value.code == "invalid"
            if msg:
                assert str(e.value) == msg
        with pytest.raises(ApiError) as e:
            await h.upload("/user/root/numeros.txt", example="numeros")
        assert e.value.code == "invalid" and "elegí una carpeta" in str(e.value)
        # El generador de sucias no está en esta imagen de prueba
        with pytest.raises(ApiError) as e:
            await h.upload("/user/root", example="sucias")
        assert e.value.code == "unsupported"
    asyncio.run(main())


def test_carpeta_y_borrar(settings, tmp_path, fake_hdfs):
    async def main():
        cl, h, _ = make(settings, tmp_path)
        r = await h.mkdir("/user/root/nueva")
        assert r["state"] == "done" and r["trace"]["command"] == "hdfs dfs -mkdir -p /user/root/nueva"
        assert "no toca ningún DataNode" in r["trace"]["action"]
        r = await h.mkdir("/user/root")
        assert r["trace"]["output"] == "Ya existía: no cambia nada"
        with pytest.raises(ApiError) as e:
            await h.mkdir("/user/root/numeros.txt")
        assert e.value.code == "invalid" and str(e.value) == "Ya hay un archivo en /user/root/numeros.txt"

        with pytest.raises(ApiError) as e:
            await h.delete("/", True)
        assert str(e.value) == "No se puede borrar la raíz"
        with pytest.raises(ApiError) as e:
            await h.delete("/user/root/ventas", False)
        assert str(e.value) == "/user/root/ventas no está vacía: hace falta borrar con -r"
        with pytest.raises(ApiError) as e:
            await h.delete("/nada", True)
        assert e.value.code == "not_found"
        r = await h.delete("/user/root/ventas", True)
        t = r["trace"]
        assert t["command"] == "hdfs dfs -rm -r -skipTrash /user/root/ventas"
        assert t["before"]["columns"] == ["ruta", "tamaño", "bloques"] and t["after"]["note"] == "Ya no está"
        assert t["output"].startswith("11,86 MB liberados")
        assert "dfs -rm -r -skipTrash /user/root/ventas" in comandos(fake_hdfs)
    asyncio.run(main())


def test_fsck_como_accion(settings, tmp_path, fake_hdfs):
    async def main():
        cl, h, _ = make(settings, tmp_path)
        r = await h.fsck("/")
        assert r["healthy"] and r["blocks"] == 15 and r["raw"][-1].endswith("is HEALTHY")
        assert r["trace"]["command"] == "hdfs fsck / -files -blocks -locations"
        assert "No lee los datos" in r["trace"]["action"]
        # fsck sale con 1 cuando hay bloques perdidos: no es que el comando falló
        fake_hdfs["fsck"].write_text(fixture_text("fsck.txt"))
        r = await h.fsck("/")
        assert not r["healthy"] and r["missing"] == 1 and r["trace"]["output"] == "1 bloque sin ninguna copia"
    asyncio.run(main())


def test_replicacion_de_un_archivo(settings, tmp_path, fake_hdfs):
    async def main():
        cl, h, _ = make(settings, tmp_path)
        with pytest.raises(ApiError) as e:
            await h.set_replication("/user/root/numeros.txt", 12)
        assert str(e.value) == "La replicación va de 1 a 9"
        run_id = await h.set_replication("/user/root/numeros.txt", 3)
        await h.runner.wait_all()
        run = h.runner.get(run_id)
        # Con 2 DataNodes vivos, -w no terminaría nunca: va sin esperar
        assert run.action.command == ["hdfs", "dfs", "-setrep", "3", "/user/root/numeros.txt"]
        assert "queda sub-replicado" in run.action.action
        run_id = await h.set_replication("/user/root/numeros.txt", 1)
        await h.runner.wait_all()
        assert h.runner.get(run_id).action.command[3] == "-w"
    asyncio.run(main())


# ------------------------------------------------------------------ rutas


def test_rutas_hdfs(settings, tmp_path, fake_hdfs):
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "index.html").write_text("<!doctype html>")
    datos = tmp_path / "datos"
    (datos / "ejemplos").mkdir(parents=True)
    settings.datos_dir = datos
    with TestClient(build_app(settings, ui_dir=ui)) as c:
        app = c.app
        cl, h = app.state.cluster, app.state.hdfs
        cl.phase, cl.hdfs, cl.nn_active_port = "running", dict(RUNNING), 9870
        cl.config = {**cl.config, **BASE}
        cl.nn_jmx = fixture_json("nn_jmx.json")
        h.http = WebHdfs()
        r = c.get("/api/hdfs/ls", params={"path": "/user/root"})
        assert r.status_code == 200 and r.json()["entries"][0]["name"] == "resultados"
        r = c.get("/api/hdfs/ls", params={"path": "/nada"})
        assert r.status_code == 404 and r.json() == {"error": "No existe /nada", "code": "not_found"}
        r = c.post("/api/hdfs/upload", files={"file": ("mis datos.csv", b"a,b\n1,2\n", "text/csv")},
                   data={"dest": "/user/root", "replication": "1", "blockSize": "2m"})
        assert r.status_code == 202, r.text
        body = r.json()
        assert body["state"] == "running" and body["trace"]["command"].endswith("/mis_datos.csv /user/root/")
        assert body["trace"]["after"]["columns"] == ["a", "b"]
        r = c.post("/api/hdfs/upload", files={"file": ("x.csv", b"1")}, data={"dest": "/user/root", "replication": "0"})
        assert r.status_code == 400 and r.json()["code"] == "invalid"
        r = c.post("/api/hdfs/upload", data={"dest": "/user/root"}, files={"otro": ("x", b"1")})
        assert r.status_code == 400 and r.json()["error"] == "Falta el archivo: example o file"
        r = c.patch("/api/hdfs/files", json={"path": "/user/root/numeros.txt", "replication": 2})
        assert r.status_code == 204
        r = c.request("DELETE", "/api/hdfs/files", params={"path": "/user/root/ventas", "recursive": "0"})
        assert r.status_code == 400 and r.json()["code"] == "invalid"
        r = c.post("/api/hdfs/put", json={"example": "texto"})
        assert r.status_code == 400
        r = c.get("/api/hdfs/datanodes")
        assert r.status_code == 200 and {d["id"] for d in r.json()} >= {1, 2}
        r = c.get("/api/hdfs/replication")
        assert r.status_code == 200 and set(r.json()) == {"underReplicated", "pending", "missing", "overReplicated",
                                                          "stale", "tasks", "recent"}
        # La copia temporal de la subida se borra cuando termina el -put
        fin = __import__("time").time() + 5
        while h.uploads and __import__("time").time() < fin:
            __import__("time").sleep(0.05)
        assert not any(h.tmp_root.glob("*/mis_datos.csv"))
