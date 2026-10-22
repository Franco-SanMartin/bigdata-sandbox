"""El supervisor con el entrypoint falso: arranque, apagado, errores y reset."""
import asyncio
import os
import subprocess

import pytest

from conftest import BASE, fixture_json
from sandbox_server.actions import ActionRunner
from sandbox_server.cluster import Cluster, Conflict, Invalid
from sandbox_server.events import EventBus
from sandbox_server.errors import ApiError


def nuevo(settings):
    bus = EventBus()
    return Cluster(bus, ActionRunner(bus), settings), bus


async def esperar(cond, timeout=10.0):
    for _ in range(int(timeout / 0.02)):
        if cond():
            return
        await asyncio.sleep(0.02)
    raise AssertionError("no pasó a tiempo")


def traza(settings):
    return open(os.environ["FALSO_TRAZA"]).read()


def sin_huerfanos():
    r = subprocess.run(["pgrep", "-f", "entrypoint_falso.sh"], capture_output=True, text=True)
    return r.stdout.strip() == ""


def test_arranca_y_apaga_en_orden(settings):
    async def main():
        cl, bus = nuevo(settings)
        q = bus.subscribe()
        await cl.start({**BASE, "datanodes": 3, "mongodb": True})
        assert cl.phase == "starting"
        await esperar(lambda: cl.phase == "running")
        st = cl.status()
        assert st["boot"]["kind"] == "first" and st["boot"]["finishedAt"]
        assert st["startedAt"] == st["boot"]["startedAt"]
        # Las variables llegaron al entrypoint como en docker run -e
        assert "DATANODES=3 REPLICATION=2 BLOCK_SIZE=1m NAMENODES=1 SERVICIOS=todo MONGODB=si" in traza(settings)
        # Sigue leyendo los logs después de LISTO
        await esperar(lambda: any("latido" in l for l in cl.logs))
        await cl.stop()
        assert cl.phase == "stopped"
        assert "apagado-en-orden" in traza(settings)   # corrió el trap 'apagar'
        assert cl.proc.returncode == 0
        tipos = set()
        while not q.empty():
            tipos.add(q.get_nowait()[0])
        assert tipos == {"status", "activity"}
        titulos = [a["title"] for a in bus.recent()]
        assert titulos[0] == "Arrancando el cluster" and titulos[-1] == "Cluster apagado"
        assert any(t.startswith("Cluster listo en") for t in titulos)
    asyncio.run(main())
    assert sin_huerfanos()


def test_config_guardada_en_el_volumen(settings):
    async def main():
        cl, _ = nuevo(settings)
        cl.save_config({**BASE, "datanodes": 5})
        assert cl.status()["config"]["datanodes"] == 5
        cl2, _ = nuevo(settings)
        assert cl2.saved["datanodes"] == 5
    asyncio.run(main())


def test_no_arranca_con_errores_ni_dos_veces(settings):
    async def main():
        cl, _ = nuevo(settings)
        with pytest.raises(Invalid) as e:
            await cl.start({**BASE, "datanodes": 0})
        assert e.value.issues[0]["field"] == "datanodes"
        await cl.start(BASE)
        with pytest.raises(Conflict):
            await cl.start(BASE)
        with pytest.raises(Conflict):
            await cl.reset()
        await cl.stop()
    asyncio.run(main())
    assert sin_huerfanos()


def test_error_de_parametros_vuelve_a_apagado(settings, monkeypatch):
    monkeypatch.setenv("FALSO_FALLA", "parametros")

    async def main():
        cl, bus = nuevo(settings)
        await cl.start(BASE)
        await esperar(lambda: cl.phase == "stopped")
        assert cl.tracker.failed.startswith("DATANODES=2")
        assert sum(a["title"] == "El arranque se cortó" for a in bus.recent()) == 1
    asyncio.run(main())


def test_hdfs_no_levanta(settings, monkeypatch):
    monkeypatch.setenv("FALSO_FALLA", "hdfs")

    async def main():
        cl, _ = nuevo(settings)
        await cl.start(BASE)
        await esperar(lambda: cl.phase == "stopped")
        steps = {s["id"]: s["state"] for s in cl.status()["boot"]["steps"]}
        assert steps["dn"] == "failed" and cl.tracker.failed == "el arranque terminó con código 1"
    asyncio.run(main())


def test_apagar_en_medio_del_arranque(settings, monkeypatch):
    monkeypatch.setenv("FALSO_PAUSA", "0.5")

    async def main():
        cl, _ = nuevo(settings)
        await cl.start(BASE)
        await esperar(lambda: cl.tracker.current is not None and cl.tracker.current.id == "nn")
        await cl.stop()
        assert cl.phase == "stopped"
        assert cl.tracker.failed == "apagado durante el arranque"
        assert {s.id: s.state for s in cl.tracker.steps}["nn"] == "failed"
    asyncio.run(main())
    assert sin_huerfanos()


def test_aplicar_reinicia_con_la_nueva(settings):
    async def main():
        cl, _ = nuevo(settings)
        await cl.start(BASE)
        await esperar(lambda: cl.phase == "running")
        await cl.apply({**BASE, "datanodes": 4})
        assert cl.config["datanodes"] == 4
        await esperar(lambda: cl.phase == "running")
        # El segundo arranque ya encuentra el volumen formateado
        assert cl.tracker.kind == "restart"
        assert "DATANODES=4" in traza(settings)
        await cl.shutdown()
        assert cl.phase == "stopped"
    asyncio.run(main())
    assert sin_huerfanos()


def test_reset_borra_el_volumen_pero_no_la_config(settings):
    async def main():
        cl, _ = nuevo(settings)
        cl.save_config({**BASE, "datanodes": 6})
        (settings.hadoop_dir / "dfs/name/current").mkdir(parents=True)
        (settings.hadoop_dir / "namenodes").write_text("1\n")
        assert cl.status()["volumeNameNodes"] == 1
        await cl.reset()
        assert [p.name for p in settings.hadoop_dir.iterdir()] == ["interfaz.json"]
        assert cl.status()["volumeNameNodes"] is None and cl.saved["datanodes"] == 6
    asyncio.run(main())


def test_estado_de_procesos(settings):
    """update() con lo sondeado: corriendo + puerto escuchando = up."""
    async def main():
        cl, bus = nuevo(settings)
        cl.config = {**BASE, "datanodes": 2}
        cl.phase = "running"
        running = {"nn1": {"pid": 10, "memMb": 900}, "snn": {"pid": 11, "memMb": 300},
                   "dn1": {"pid": 12, "memMb": 250}, "dn2": {"pid": 13, "memMb": 250},
                   "dn3": {"pid": 14, "memMb": 100}}
        ports = {9870, 9868, 9901}
        cl.update(running, ports, {"nn1": "active"}, fixture_json("nn_jmx.json"), fixture_json("rm_metrics.json"),
                  8192, 5000)
        by = {p["id"]: p for p in cl.processes}
        assert by["nn1"]["state"] == "up" and by["nn1"]["memMb"] == 900 and "role" not in by["nn1"]
        assert by["dn2"]["state"] == "starting"           # corre pero todavía no abrió el puerto
        assert by["dn3"]["kind"] == "datanode"             # agregado en caliente
        assert by["rm"]["state"] == "down"
        assert by["ui"]["state"] == "up"
        assert by["nn1"]["webUrl"] == "http://localhost:9870"
        st = cl.status()
        assert st["hdfs"]["liveDataNodes"] == 2 and st["yarn"]["totalMb"] == 4096
        assert st["memory"]["limitMb"] == 8192 and st["memory"]["history"][0]["usedMb"] == 5000
        # Se cae el DataNode 1: aviso en la consola
        cl.update({k: v for k, v in running.items() if k != "dn1"}, ports, {}, None, None, 8192, 5000)
        assert {p["id"]: p for p in cl.processes}["dn1"]["state"] == "down"
        assert bus.recent()[-1]["title"] == "DataNode 1 se apagó"
    asyncio.run(main())


def test_roles_en_alta_disponibilidad(settings):
    async def main():
        cl, _ = nuevo(settings)
        cl.config = {**BASE, "namenodes": 2}
        cl.phase = "running"
        cl.update({"nn1": {"pid": 1, "memMb": 1}, "nn2": {"pid": 2, "memMb": 1}}, {9870, 9871},
                  {"nn1": "standby", "nn2": "active"}, None, None, 0, 0)
        by = {p["id"]: p for p in cl.processes}
        assert by["nn1"]["role"] == "standby" and by["nn2"]["role"] == "active"
        assert {"zk", "jn1", "jn2", "jn3"} <= set(by) and "snn" not in by
    asyncio.run(main())


def test_acciones_sobre_procesos(settings):
    async def main():
        cl, _ = nuevo(settings)
        with pytest.raises(Conflict):
            cl.process_action_for("dn1", "stop")
        cl.phase = "running"
        a = cl.process_action_for("dn2", "stop")
        assert a.command == [f"{settings.bin_dir}/datanode", "stop", "2"]
        assert cl.process_action_for("dn7", "start").command[-1] == "7"
        assert cl.process_action_for("nn1", "stop").command[-2:] == ["stop", "1"]
        assert cl.process_action_for("mysql", "stop").display == "mysqladmin shutdown"
        with pytest.raises(Invalid):
            cl.process_action_for("rm", "stop")          # no se controla suelto
        with pytest.raises(ApiError) as e:
            cl.process_action_for("nada", "stop")
        assert e.value.code == "not_found" and e.value.status == 404
        with pytest.raises(Invalid):
            cl.process_action_for("dn1", "reiniciar")
    asyncio.run(main())
