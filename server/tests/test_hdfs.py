"""HDFS: WebHDFS simulado con las fixtures y un 'hdfs' falso en el PATH que
anota los comandos (y para fsck devuelve la fixture)."""
import asyncio
import json
import urllib.parse

import pytest
from starlette.testclient import TestClient

from conftest import BASE, FIX, fixture_json, fixture_text, fsck_con_bloque_perdido
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
                       "/user/root/humo": "webhdfs_status_dir.json",
                       "/user/root/humo/humo.csv": "webhdfs_status_archivo.json"}
        self.ls = {"/": "webhdfs_ls_raiz.json", "/user/root": "webhdfs_ls_user_root.json",
                   "/user/root/humo": "webhdfs_ls_humo_escribiendo.json"}
        self.content = b"fecha,producto,cantidad,precio\n2026-01-01,yerba,2,1500.5\n2026-01-02,mate,1,9000\n"

    def __call__(self, url, timeout=5.0, limit=None):
        u = urllib.parse.urlparse(url)
        path = urllib.parse.unquote(u.path.removeprefix("/webhdfs/v1")) or "/"
        op = urllib.parse.parse_qs(u.query)["op"][0]
        self.calls.append((path, op))
        if op == "GETFILESTATUS":
            name = self.status.get(path)
        elif op == "LISTSTATUS":
            if path in self.status and self.status[path] == "webhdfs_status_archivo.json":
                name = None
                doc = json.loads((FIX / "webhdfs_status_archivo.json").read_bytes())
                return 200, json.dumps({"FileStatuses": {"FileStatus": [doc["FileStatus"]]}}).encode()
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
if [ "$1" = fsck ]; then echo "Connecting to namenode via http://localhost:9870/fsck?ugi=root&path=$2" >&2; cat {fsck}; grep -q 'is CORRUPT' {fsck} && exit 1; exit 0; fi
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
    # Real: el -put escribe <nombre>._COPYING_; fsck dice 0 bytes y un "Under
    # Construction Block" con Expected_repl en vez de Live_repl
    escribiendo = by["/user/root/humo/grande.bin._COPYING_"]
    assert escribiendo["state"] == "writing" and escribiendo["sizeMb"] == 0
    assert [b["locations"] for b in escribiendo["blocks"]] == [[1, 2]]
    assert by["/user/root/humo/humo.csv"]["state"] == "ok" and len(by["/user/root/humo/humo.csv"]["blocks"]) == 2


def test_resumen_de_fsck_solo_bloques_replicados():
    r = H.parse_fsck_report(fixture_text("fsck_escribiendo.txt"), "/")
    # Los números de 'Erasure Coded Block Groups' (todos 0) no pisan a los replicados.
    # El bloque en construcción cuenta en 'blocks' pero no en el promedio de copias.
    assert r["healthy"] and r["files"] == 2 and r["blocks"] == 3 and r["dirs"] == 11
    assert r["underReplicated"] == 0 and r["liveDataNodes"] == 2 and r["avgReplication"] == 1.3333334
    assert r["problems"] == []
    r = H.parse_fsck_report(fixture_text("fsck_dn_muerto.txt"), "/")
    assert r["healthy"] and r["liveDataNodes"] == 1 and r["underReplicated"] == 2 and r["totalSizeMb"] == 301.019393
    assert r["problems"] == [{"file": "/user/root/humo/humo.csv", "block": f"blk_{b}", "issue": "under",
                              "replicas": 1, "expected": 2} for b in ("1073741825_1001", "1073741826_1002")]


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
        assert [e["name"] for e in ls["entries"]] == ["humo"] and ls["entries"][0]["type"] == "dir"
        ls = await h.listing("/user/root/humo")
        assert [e["name"] for e in ls["entries"]] == ["grande.bin._COPYING_", "humo.csv"]
        escr, humo = ls["entries"]
        assert humo["sizeMb"] == 1.019393 and humo["blocks"] == 2 and humo["replication"] == 2
        assert humo["blockSizeMb"] == 1 and humo["permission"] == "rw-r--r--" and humo["state"] == "ok"
        # WebHDFS ya cuenta los bloques completos del archivo que se está escribiendo
        assert escr["state"] == "writing" and escr["sizeMb"] == 22.0
        with pytest.raises(ApiError) as e:
            await h.listing("/user/root/humo/humo.csv")
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
        assert by["/user/root/humo/grande.bin._COPYING_"]["state"] == "writing"
        assert by["/user/root/humo/humo.csv"]["writtenBy"] == "cliente HDFS"
        d = await h.detail("/user/root/humo/humo.csv")
        assert d["owner"] == "root" and d["permission"] == "rw-r--r--" and d["blockSizeMb"] == 1
        assert d["modifiedAt"] == 1792695253868 and len(d["blocks"]) == 2
        assert d["preview"]["columns"] == ["fecha", "producto", "cantidad", "precio"]
        assert d["preview"]["rows"][0] == ["2026-01-01", "yerba", 2, 1500.5]
        # Real: "Connecting to namenode" sale por stderr; stdout arranca con FSCK started
        assert d["fsck"][0].startswith("FSCK started by root")
        with pytest.raises(ApiError) as e:
            await h.detail("/user/root/nada.csv")
        assert e.value.code == "not_found" and str(e.value) == "No existe el archivo /user/root/nada.csv"
    asyncio.run(main())


def test_archivos_con_el_cluster_apagandose(settings, tmp_path, fake_hdfs):
    """Si el cluster se apaga mientras corre el fsck, la lista vuelve vacía (no 500)."""
    async def main():
        cl, h, _ = make(settings, tmp_path)
        apagar = [True]

        async def apagando(*_a, **_k):
            if apagar[0]:
                cl.phase = "stopping"
            return 1, "", "Connection refused"
        h.exec = apagando
        assert await h.files() == []
        # Con el cluster en marcha, la misma falla sí es un error
        cl.phase, apagar[0] = "running", False
        with pytest.raises(ApiError) as e:
            await h.files()
        assert e.value.code == "failed"
    asyncio.run(main())


def test_transferencias_entre_dos_fsck(settings, tmp_path, fake_hdfs, monkeypatch):
    async def main():
        cl, h, bus = make(settings, tmp_path)
        monkeypatch.setattr(h, "datanodes", lambda: [{"id": i, "state": "live"} for i in (1, 2, 3)])
        q = bus.subscribe()
        before = probes.parse_fsck(fixture_text("fsck.txt"))
        assert h.observe(before) == []          # la primera vez solo toma nota
        after = [dict(f, blocks=[dict(b) for b in f["blocks"]]) for f in before]
        # humo.csv pasa de 2 a 3 copias (re-replicación) y aparece un bloque nuevo
        after[0]["blocks"][0]["locations"] = [1, 2, 3]
        after.append({"path": "/datos/nuevo.csv", "sizeMb": 1, "replication": 2, "blockSizeMb": 1, "state": "ok",
                      "blocks": [{"id": 1073741900, "genStamp": 1100, "name": "blk_1073741900_1100", "index": 1,
                                  "sizeMb": 1, "locations": [2, 1], "stale": []}]})
        moved = h.observe(after)
        assert {"block": 1073741825, "from": 1, "to": 3} in moved
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
        # Real: fsck con humo.csv sub-replicado (una sola copia, en dn2)
        fake_hdfs["fsck"].write_text(fixture_text("fsck_dn_muerto.txt"))
        h._live_count = lambda: 1
        r = await h.replication()
        assert r["missing"] == 0
        # Con 1 DataNode vivo no hay dónde poner la segunda copia: no se inventa una tarea
        assert r["tasks"] == []
        h._live_count = lambda: 2
        r = await h.replication()
        # Una copia pendiente desde el DataNode que la tiene
        assert {"block": "blk_1073741825_1001", "file": "/user/root/humo/humo.csv", "kind": "copy",
                "from": 2, "state": "pending"} in r["tasks"]
        assert all(t["file"] != "/user/root/humo/grande.bin" for t in r["tasks"])
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
            await h.upload("/user/root/humo/humo.csv", example="numeros")
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
            await h.mkdir("/user/root/humo/humo.csv")
        assert e.value.code == "invalid" and str(e.value) == "Ya hay un archivo en /user/root/humo/humo.csv"

        with pytest.raises(ApiError) as e:
            await h.delete("/", True)
        assert str(e.value) == "No se puede borrar la raíz"
        with pytest.raises(ApiError) as e:
            await h.delete("/user/root/humo", False)
        assert str(e.value) == "/user/root/humo no está vacía: hace falta borrar con -r"
        with pytest.raises(ApiError) as e:
            await h.delete("/nada", True)
        assert e.value.code == "not_found"
        r = await h.delete("/user/root/humo", True)
        t = r["trace"]
        assert t["command"] == "hdfs dfs -rm -r -skipTrash /user/root/humo"
        assert t["before"]["columns"] == ["ruta", "tamaño", "bloques"] and t["after"]["note"] == "Ya no está"
        assert t["output"].startswith("2,04 MB liberados")
        assert "dfs -rm -r -skipTrash /user/root/humo" in comandos(fake_hdfs)
    asyncio.run(main())


def test_fsck_como_accion(settings, tmp_path, fake_hdfs):
    async def main():
        cl, h, _ = make(settings, tmp_path)
        r = await h.fsck("/")
        assert r["healthy"] and r["blocks"] == 3 and r["raw"][-1].endswith("is HEALTHY")
        assert r["trace"]["command"] == "hdfs fsck / -files -blocks -locations"
        assert "No lee los datos" in r["trace"]["action"]
        # fsck sale con 1 cuando hay bloques perdidos: no es que el comando falló
        fake_hdfs["fsck"].write_text(fsck_con_bloque_perdido())
        r = await h.fsck("/")
        assert not r["healthy"] and r["missing"] == 1 and r["trace"]["output"] == "1 bloque sin ninguna copia"
    asyncio.run(main())


def test_replicacion_de_un_archivo(settings, tmp_path, fake_hdfs):
    async def main():
        cl, h, _ = make(settings, tmp_path)
        with pytest.raises(ApiError) as e:
            await h.set_replication("/user/root/humo/humo.csv", 12)
        assert str(e.value) == "La replicación va de 1 a 9"
        run_id = await h.set_replication("/user/root/humo/humo.csv", 3)
        await h.runner.wait_all()
        run = h.runner.get(run_id)
        # Con 2 DataNodes vivos, -w no terminaría nunca: va sin esperar
        assert run.action.command == ["hdfs", "dfs", "-setrep", "3", "/user/root/humo/humo.csv"]
        assert "queda sub-replicado" in run.action.action
        run_id = await h.set_replication("/user/root/humo/humo.csv", 1)
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
        assert r.status_code == 200 and r.json()["entries"][0]["name"] == "humo"
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
        r = c.patch("/api/hdfs/files", json={"path": "/user/root/humo/humo.csv", "replication": 2})
        assert r.status_code == 204
        r = c.request("DELETE", "/api/hdfs/files", params={"path": "/user/root/humo", "recursive": "0"})
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


def test_copias_en_datanode_caido(settings, tmp_path, fake_hdfs, monkeypatch):
    """blocks[].stale: los DataNodes muertos que tenían copia del bloque. El fsck
    real deja de listarlos cuando el NameNode los da por muertos; el servidor se
    acuerda de dónde estaban."""
    async def main():
        cl, h, _ = make(settings, tmp_path)
        await h.files()                       # dn1 y dn2 vivos: toma nota de las ubicaciones
        sin_dn2 = "\n".join(
            l.replace(", DatanodeInfoWithStorage[127.0.0.1:9912,DS-8afe0183-3a3d-4fce-9603-8a792e32a693,DISK]", "")
             .replace("DatanodeInfoWithStorage[127.0.0.1:9912,DS-8afe0183-3a3d-4fce-9603-8a792e32a693,DISK], ", "")
             .replace("Live_repl=2", "Live_repl=1")
            for l in fixture_text("fsck_escribiendo.txt").splitlines())
        fake_hdfs["fsck"].write_text(sin_dn2)
        vivos = h.datanodes()
        monkeypatch.setattr(h, "datanodes", lambda: [dict(d, state="dead") if d["id"] == 2 else d for d in vivos])
        d = await h.detail("/user/root/humo/humo.csv")
        assert [b["locations"] for b in d["blocks"]] == [[1]] * 2
        assert [b["stale"] for b in d["blocks"]] == [[2]] * 2
        h._fsck = None                        # sin la caché corta del fsck
        files = {f["path"]: f for f in await h.files()}
        assert files["/user/root/humo/humo.csv"]["blocks"][0]["stale"] == [2]
    asyncio.run(main())


def test_fsck_que_todavia_lista_al_datanode_muerto(settings, tmp_path, fake_hdfs, monkeypatch):
    """Con Hadoop 3.3.6, apenas el NameNode da por muerto a dn2 el fsck lo sigue
    listando como ubicación: esa copia va a stale y no a locations."""
    async def main():
        cl, h, _ = make(settings, tmp_path)
        vivos = h.datanodes()
        monkeypatch.setattr(h, "datanodes", lambda: [dict(d, state="dead") if d["id"] == 2 else d for d in vivos])
        d = await h.detail("/user/root/humo/humo.csv")
        assert [b["locations"] for b in d["blocks"]] == [[1]] * 2
        assert [b["stale"] for b in d["blocks"]] == [[2]] * 2
        files = {f["path"]: f for f in await h.files()}
        assert files["/user/root/humo/humo.csv"]["blocks"][0]["locations"] == [1]
        assert files["/user/root/humo/humo.csv"]["blocks"][0]["stale"] == [2]
    asyncio.run(main())


# ------------------------------------------------------- ver, bajar y mover


class Rango(WebHdfs):
    """OPEN respetando offset y length, como el DataNode."""

    def __init__(self, content: bytes):
        super().__init__()
        self.content = content
        self.urls: list[str] = []

    def __call__(self, url, timeout=5.0, limit=None):
        u = urllib.parse.urlparse(url)
        q = urllib.parse.parse_qs(u.query)
        if q["op"][0] == "GETFILESTATUS" and u.path.endswith("humo.csv"):
            doc = json.loads((FIX / "webhdfs_status_archivo.json").read_bytes())
            doc["FileStatus"]["length"] = len(self.content)
            return 200, json.dumps(doc).encode()
        if q["op"][0] == "OPEN":
            self.urls.append(url)
            off = int(q.get("offset", ["0"])[0])
            n = int(q.get("length", [str(len(self.content))])[0])
            return 200, self.content[off:off + n]
        return super().__call__(url, timeout, limit)


def test_cat_por_tramos(settings, tmp_path):
    async def main():
        cl, h, bus = make(settings, tmp_path)
        lineas = b"".join(f"{i},fila {i}\n".encode() for i in range(1000))
        h.http = Rango(lineas)
        r = await h.cat("/user/root/humo/humo.csv", None, "100")
        # Corta en el último salto de línea: el tramo siguiente arranca en una línea entera
        assert r["truncated"] and r["text"].endswith("\n") and r["length"] <= 100 and not r["binary"]
        assert r["totalBytes"] == len(lineas) and r["offset"] == 0
        assert r["command"] == "hdfs dfs -cat /user/root/humo/humo.csv | head -c " + str(r["length"])
        r2 = await h.cat("/user/root/humo/humo.csv", r["length"], 1 << 20)
        assert r["text"] + r2["text"] == lineas.decode() and not r2["truncated"]
        assert "tail -c +" in r2["command"] and "offset=" in h.http.urls[-1]
        # Binario: no se manda texto
        h.http = Rango(b"PAR1\0\0\x01\x02")
        r = await h.cat("/user/root/humo/humo.csv")
        assert r["binary"] and r["text"] == ""
    asyncio.run(main())


@pytest.mark.parametrize("off,length", [("-1", None), (None, "0"), (None, str(2 << 20)), ("abc", None),
                                        (None, "1;rm -rf /"), ("99999999", None)])
def test_cat_valida_numeros(settings, tmp_path, off, length):
    async def main():
        cl, h, bus = make(settings, tmp_path)
        with pytest.raises(ApiError) as e:
            await h.cat("/user/root/humo/humo.csv", off, length)
        assert e.value.code == "invalid"
    asyncio.run(main())


def test_cat_errores(settings, tmp_path):
    async def main():
        cl, h, bus = make(settings, tmp_path)
        with pytest.raises(ApiError) as e:
            await h.cat("/user/root/humo")
        assert e.value.code == "invalid"
        with pytest.raises(ApiError) as e:
            await h.cat("/nada.txt")
        assert e.value.code == "not_found"
        for bad in ("/x\n", "/x\0", "hdfs://otro:9000/../../etc/passwd", "", None, 5):
            with pytest.raises(ApiError):
                await h.cat(bad)
        cl.phase = "stopped"
        with pytest.raises(ApiError) as e:
            await h.cat("/user/root/humo/humo.csv")
        assert e.value.code == "cluster_stopped"
    asyncio.run(main())


def test_mover(settings, tmp_path, fake_hdfs):
    async def main():
        cl, h, bus = make(settings, tmp_path)
        # A una ruta nueva en la misma carpeta: renombrar
        r = await h.move("/user/root/humo/humo.csv", "/user/root/humo/ventas.csv")
        assert r["state"] == "done" and r["trace"]["command"] == \
            "hdfs dfs -mv /user/root/humo/humo.csv /user/root/humo/ventas.csv"
        assert "Renombrado" in r["trace"]["output"]
        assert comandos(fake_hdfs)[-1] == "dfs -mv /user/root/humo/humo.csv /user/root/humo/ventas.csv"
        # A una carpeta que existe: va adentro (y el nombre final no puede existir)
        r = await h.move("/user/root/humo/humo.csv", "/user/root")
        assert "/user/root/humo.csv" in r["trace"]["output"]
        # Un nombre con ; o $( ) es un argumento más (sin shell): no se ejecuta nada
        r = await h.move("/user/root/humo/humo.csv", "/user/root/humo/a;touch pwned$(id).csv")
        assert comandos(fake_hdfs)[-1] == "dfs -mv /user/root/humo/humo.csv /user/root/humo/a;touch pwned$(id).csv"
        assert not (tmp_path / "pwned").exists()
    asyncio.run(main())


@pytest.mark.parametrize("src,dst,code", [
    ("/", "/x", "invalid"), ("/tmp", "/user/root/t", "invalid"), ("/user/hive/warehouse", "/user/root/w", "invalid"),
    ("/user/root", "/user/r2", "invalid"), ("/user/root/humo", "/user/root/humo/adentro", "invalid"),
    ("/user/root/humo", "/user/root/humo", "invalid"), ("/user/root/humo/humo.csv", "/user/root/humo/humo.csv", "invalid"),
    ("/user/root/nada", "/user/root/x", "not_found"),
    ("/user/root/humo/humo.csv", "/no/existe/x.csv", "invalid"),
    ("/user/root/humo", "/user/root/humo/humo.csv", "invalid"),
    ("/user/root/humo/../../../tmp", "/user/root/x", "invalid"),
])
def test_mover_rechaza(settings, tmp_path, fake_hdfs, src, dst, code):
    async def main():
        cl, h, bus = make(settings, tmp_path)
        with pytest.raises(ApiError) as e:
            await h.move(src, dst)
        assert e.value.code == code
        assert not any(c.startswith("dfs -mv") for c in comandos(fake_hdfs))
    asyncio.run(main())


def test_mover_con_subida_en_curso(settings, tmp_path, fake_hdfs):
    async def main():
        cl, h, bus = make(settings, tmp_path)
        h.uploads["/user/root/humo/grande.bin"] = {}
        with pytest.raises(ApiError) as e:
            await h.move("/user/root/humo", "/user/root/otra")
        assert e.value.code == "busy"
    asyncio.run(main())


def test_rutas_ver_bajar_mover(settings, tmp_path, fake_hdfs):
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
        contenido = "fecha,producto\n2026-01-01,ñandú\n".encode() * 3
        h.http = Rango(contenido)
        h.stream = lambda url: iter([contenido[:10], contenido[10:]])
        r = c.get("/api/hdfs/cat", params={"path": "/user/root/humo/humo.csv"})
        assert r.status_code == 200 and r.json()["text"] == contenido.decode()
        r = c.get("/api/hdfs/cat", params={"path": "/user/root/humo/humo.csv", "length": "9999999"})
        assert r.status_code == 400 and r.json()["code"] == "invalid"
        r = c.get("/api/hdfs/download", params={"path": "/user/root/humo/humo.csv"})
        assert r.status_code == 200 and r.content == contenido
        assert r.headers["content-length"] == str(len(contenido))
        assert r.headers["content-disposition"].startswith('attachment; filename="humo.csv"')
        r = c.get("/api/hdfs/download", params={"path": "/user/root/humo"})
        assert r.status_code == 400
        r = c.get("/api/hdfs/download", params={"path": "/nada"})
        assert r.status_code == 404
        r = c.post("/api/hdfs/move", json={"from": "/user/root/humo/humo.csv", "to": "/user/root/humo/b.csv"})
        assert r.status_code == 200 and r.json()["state"] == "done"
        r = c.post("/api/hdfs/move", json={"from": "/", "to": "/x"})
        assert r.status_code == 400


def test_nombre_para_bajar():
    assert H.attachment("ñandú \"x\".csv") == \
        "attachment; filename=\"_and_x_.csv\"; filename*=UTF-8''%C3%B1and%C3%BA%20%22x%22.csv"
