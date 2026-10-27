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


def test_puertos_como_lib_sh():
    """Los mismos puertos que sandbox/lib.sh y que cluster.ts de la interfaz."""
    from conftest import BASE
    from sandbox_server.specs import process_specs
    uno = {s.id: s.ports for s in process_specs(BASE)}
    assert uno["nn1"] == [9870, 9000]
    ha = {s.id: s.ports for s in process_specs({**BASE, "namenodes": 3})}
    assert ha["nn2"] == [9871, 9001, 8020] and ha["jn3"] == [8487, 8482] and "snn" not in ha


def test_formulas_de_puertos_iguales_a_lib_sh():
    """specs.py repite las cuentas de sandbox/lib.sh (nn_rpc() { echo $((8999 + $1)); }):
    si alguien cambia un puerto en lib.sh, este test lo avisa."""
    import re
    from pathlib import Path
    from sandbox_server import specs
    lib = (Path(__file__).resolve().parents[2] / "sandbox" / "lib.sh").read_text()
    formulas = dict(re.findall(r"^(\w+)\(\)\s*\{\s*echo \$\(\(\s*(\d+) \+ \$1\s*\)\);", lib, re.M))
    nombres = {"nn_rpc": "nn_rpc", "nn_http": "nn_http", "dn_http": "dn_http", "dn_data": "dn_data",
               "jn_rpc": "jn_rpc", "jn_http": "jn_http", "zkfc_port": "zkfc_rpc"}
    for en_lib, en_py in nombres.items():
        assert en_lib in formulas, en_lib
        for n in (1, 2, 3):
            assert getattr(specs, en_py)(n) == int(formulas[en_lib]) + n, (en_lib, n)


def test_compose_publica_jupyter_aunque_este_apagado():
    # Si después se prende JupyterLab desde la interfaz, el puerto ya tiene que estar publicado
    y = cfg.compose_yaml(cfg.normalize({"jupyter": False}))
    assert '"127.0.0.1:8888:8888"             # JupyterLab (con JUPYTER: \"si\")' in y
    assert 'JUPYTER: "no"' in y


@pytest.mark.parametrize("nn,services", [(1, "todo"), (3, "hdfs")])
def test_compose_de_la_version_full(nn, services):
    y = cfg.compose_yaml(cfg.normalize({"namenodes": nn, "services": services, "datanodes": 3, "replication": 3}))
    assert "image: franki678/bigdata-sandbox:full" in y
    assert 'AUTOSTART: "1"' in y
    assert '"127.0.0.1:8080:8080"' in y
    assert "stop_grace_period: 20s" in y
    assert "./datos:/datos" in y and '"127.0.0.1:8888:8888"' in y
    if nn == 3:
        assert '"127.0.0.1:9871-9872:9871-9872"' in y and '"127.0.0.1:8480-8482:8480-8482"' in y
        assert "8088" not in y
    else:
        assert "9868:9868" in y and "8088:8088" in y
