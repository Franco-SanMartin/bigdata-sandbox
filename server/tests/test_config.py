"""Las reglas de configuración tienen que dar lo mismo que ui/src/lib/cluster.ts.

fixtures/ui_cluster.json salió de correr validate/estimateRam/composeYaml de la
interfaz con estos mismos casos."""
import pytest

from conftest import fixture_json
from sandbox_server import config as cfg

CASOS = fixture_json("ui_cluster.json")


@pytest.mark.parametrize("caso", CASOS, ids=[f"caso{i}" for i in range(len(CASOS))])
def test_igual_que_la_interfaz(caso):
    c = cfg.normalize(caso["config"])
    issues = cfg.validate(c, caso["volume"])
    # La interfaz no valida 'services' (el tipo ya lo restringe); el servidor sí
    assert [i for i in issues if i["field"] != "services"] == caso["validate"]
    if caso["estimate"] is not None:
        assert cfg.estimate_ram(c) == caso["estimate"]
        assert cfg.compose_yaml(c) == caso["compose"]


def test_services_invalido():
    issues = cfg.validate(cfg.normalize({"services": "x"}), None)
    assert {"field": "services", "level": "error", "message": "Tiene que ser hdfs, mapreduce o todo."} in issues


def test_tipos_raros_son_error():
    c = cfg.normalize({"datanodes": "2", "replication": True, "mongodb": "si", "jupyter": 1, "namenodes": 2.0})
    campos = {i["field"] for i in cfg.validate(c, None) if i["level"] == "error"}
    assert campos == {"datanodes", "replication", "mongodb", "jupyter", "namenodes"}


def test_namenodes_fijo_en_el_volumen():
    issues = cfg.validate(cfg.normalize({"namenodes": 3}), 1)
    assert issues[-1]["field"] == "namenodes" or any(
        i["field"] == "namenodes" and "volumen se creó con 1 NameNode." in i["message"] for i in issues)


def test_env_ida_y_vuelta():
    env = {"DATANODES": "3", "REPLICATION": "2", "BLOCK_SIZE": "32m", "NAMENODES": "2", "SERVICIOS": "mapreduce",
           "MONGODB": "si", "JUPYTER": "no", "PIG_HEAPSIZE": "1024"}
    c = cfg.from_env(env)
    assert c == {"datanodes": 3, "replication": 2, "blockSize": "32m", "namenodes": 2, "services": "mapreduce",
                 "mongodb": True, "jupyter": False, "pigHeapsize": 1024}
    assert cfg.to_env(c) == env


def test_env_vacio_da_los_de_fabrica():
    assert cfg.from_env({}) == cfg.IMAGE_DEFAULTS


def test_normalize_rechaza_lo_que_no_es_objeto():
    with pytest.raises(ValueError):
        cfg.normalize([1, 2])


def test_block_size():
    assert cfg.block_size_mb("128m") == 128
    assert cfg.block_size_mb("1G") == 1024
    assert cfg.block_size_mb("0m") is None
    assert cfg.block_size_mb("12") is None


def test_store_guarda_y_lee(tmp_path):
    store = cfg.ConfigStore(tmp_path / "x" / "interfaz.json", env={"DATANODES": "4"})
    assert store.load()["datanodes"] == 4
    store.save({**cfg.IMAGE_DEFAULTS, "datanodes": 7})
    assert store.load()["datanodes"] == 7
    assert not (tmp_path / "x" / "interfaz.tmp").exists()
