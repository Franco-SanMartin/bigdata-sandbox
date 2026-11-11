"""Agente de apagado de las PCs del aula (empresa/aula/agente.py): sin Hadoop, con un `ejecutar` falso."""
from __future__ import annotations

import importlib.util
import subprocess
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import pytest

AGENTE = Path(__file__).resolve().parents[2] / "empresa" / "aula" / "agente.py"


def _modulo():
    spec = importlib.util.spec_from_file_location("agente_aula", AGENTE)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


ag = _modulo()


def esperar(cond, segundos: float = 5) -> bool:
    fin = time.monotonic() + segundos
    while time.monotonic() < fin:
        if cond():
            return True
        time.sleep(0.05)
    return False


class Shell:
    """Hace de bash: anota los scripts y dice qué procesos Java corren."""

    def __init__(self) -> None:
        self.scripts: list[str] = []
        self.vivos = {"datanode", "nodemanager"}
        self.rc = 0

    def __call__(self, script: str) -> tuple[int, str]:
        if script.startswith("pgrep -f '[-]Dproc_"):
            que = script.split("Dproc_")[1].split("'")[0]
            return (0 if que in self.vivos else 1), ""
        self.scripts.append(script)
        if self.rc:
            return self.rc, "algo\nERROR: no pude\n"
        if "pkill" in script or "stop" in script:
            self.vivos.clear()
        elif "start" in script:
            self.vivos = {"datanode", "nodemanager"}
        return 0, ""


def _agente(tmp_path, **env):
    sh = Shell()
    base = {"RED": "docker", "MAESTRO": "127.0.0.1", "CODIGO": "aula-7", "AULA_DIR": str(tmp_path), "NODO": "pc03"}
    return ag.Agente({**base, **env}, ejecutar=sh), sh


def test_apagar_golpe_y_prender(tmp_path):
    a, sh = _agente(tmp_path)
    codigo, r = a.atender("POST", "/apagar", "127.0.0.1", "codigo=AULA-7\n")
    assert codigo == 200 and r["accion"] == "golpe" and r["nodo"] == "pc03"
    assert r["datanode"] == "no" and r["nodemanager"] == "no"
    assert "pkill -9 -x java" in sh.scripts[-1]
    codigo, r = a.atender("POST", "/prender", "127.0.0.1", "codigo=aula-7\n")
    assert codigo == 200 and r["datanode"] == "si" and r["nodemanager"] == "si"
    assert "datanode_start 1" in sh.scripts[-1]


def test_apagar_golpe_mata_por_nombre_de_servicio(tmp_path):
    a, sh = _agente(tmp_path)
    a.atender("POST", "/apagar", "127.0.0.1", "codigo=aula-7\nmodo=golpe\n")
    assert "pkill -9 -f '[-]Dproc_(datanode|nodemanager)'" in sh.scripts[-1]


def test_apagar_no_dice_que_apago_si_el_datanode_sigue(tmp_path):
    # en el CI el DataNode sobrevivió al pkill y el agente igual contestó 200
    class Terco(Shell):
        def __call__(self, script: str) -> tuple[int, str]:
            if script.startswith("pgrep -f '[-]Dproc_"):
                return super().__call__(script)
            self.scripts.append(script)
            self.vivos = {"datanode"}
            return 0, ""

    sh = Terco()
    a = ag.Agente({"RED": "docker", "MAESTRO": "127.0.0.1", "CODIGO": "aula-7", "AULA_DIR": str(tmp_path),
                   "NODO": "pc03"}, ejecutar=sh)
    for modo in ("golpe", "ordenado"):
        codigo, r = a.atender("POST", "/apagar", "127.0.0.1", f"codigo=aula-7\nmodo={modo}\n")
        assert codigo == 500 and r["datanode"] == "si" and "datanode" in r["error"]


def test_estado_con_bash_de_verdad_no_se_encuentra_a_si_mismo(tmp_path):
    # en el CI estado() decía que el DataNode corría siempre: el bash que corre pgrep llevaba el patrón
    a = ag.Agente({"RED": "docker", "MAESTRO": "127.0.0.1", "CODIGO": "x", "AULA_DIR": str(tmp_path), "NODO": "pc03"})
    if subprocess.run(["pgrep", "-f", "[-]Dproc_(datanode|nodemanager)"], capture_output=True).returncode == 0:
        pytest.skip("hay un DataNode o un NodeManager de verdad en esta máquina")
    falso = subprocess.Popen(["bash", "-c", "exec -a 'java -Dproc_datanode' sleep 30"])
    try:
        assert esperar(lambda: a.corre("datanode"))
        assert not a.corre("nodemanager")
    finally:
        falso.kill()
        falso.wait()
    assert not a.corre("datanode")


def test_apagar_ordenado_usa_los_comandos_de_hadoop(tmp_path):
    a, sh = _agente(tmp_path)
    codigo, r = a.atender("POST", "/apagar", "127.0.0.1", "codigo=aula-7\nmodo=ordenado\n")
    assert codigo == 200 and r["accion"] == "ordenado"
    assert "yarn --daemon stop nodemanager" in sh.scripts[-1] and "datanode_stop 1" in sh.scripts[-1]
    assert "pkill" not in sh.scripts[-1]


def test_solo_atiende_al_maestro(tmp_path):
    a, sh = _agente(tmp_path)
    for metodo, ruta in (("POST", "/apagar"), ("GET", "/estado")):
        codigo, r = a.atender(metodo, ruta, "10.0.0.99", "codigo=aula-7\n")
        assert codigo == 403 and "maestro" in r["error"]
    assert sh.scripts == []


def test_codigo_malo_o_sin_codigo_no_apaga(tmp_path):
    a, sh = _agente(tmp_path)
    for cuerpo in ("codigo=otro\n", "", "modo=golpe\n"):
        codigo, r = a.atender("POST", "/apagar", "127.0.0.1", cuerpo)
        assert codigo == 403 and "código" in r["error"]
    # sin CODIGO configurado no hay código que valga, ni el vacío
    b, sh_b = _agente(tmp_path, CODIGO="")
    assert b.atender("POST", "/apagar", "127.0.0.1", "codigo=\n")[0] == 403
    assert sh.scripts == [] and sh_b.scripts == []


def test_modo_invalido_y_ruta_inexistente(tmp_path):
    a, sh = _agente(tmp_path)
    assert a.atender("POST", "/apagar", "127.0.0.1", "codigo=aula-7\nmodo=rm -rf\n")[0] == 400
    assert a.atender("POST", "/prender", "127.0.0.1", "codigo=aula-7\nmodo=golpe\n")[0] == 200  # modo no aplica
    assert a.atender("POST", "/otra", "127.0.0.1", "codigo=aula-7\n")[0] == 404
    assert a.atender("GET", "/apagar", "127.0.0.1")[0] == 404
    assert len(sh.scripts) == 1


def test_si_falla_el_comando_devuelve_500_con_la_ultima_linea(tmp_path):
    a, sh = _agente(tmp_path)
    sh.rc = 1
    codigo, r = a.atender("POST", "/apagar", "127.0.0.1", "codigo=aula-7\n")
    assert codigo == 500 and r["error"] == "ERROR: no pude"


def test_una_accion_por_vez(tmp_path):
    a, sh = _agente(tmp_path)
    assert ag._lock.acquire(blocking=False)
    try:
        assert a.atender("POST", "/apagar", "127.0.0.1", "codigo=aula-7\n")[0] == 409
    finally:
        ag._lock.release()
    assert sh.scripts == []


def test_wireguard_escucha_en_el_tunel_y_atiende_al_hub(tmp_path):
    (tmp_path / "nodo.env").write_text("NODO=pc04\nIP_TUNEL=10.13.0.14\n")
    a, _ = _agente(tmp_path, RED="wireguard", MAESTRO="maestro", NODO="")
    assert (a.nodo, a.escucha, a.maestro) == ("pc04", "10.13.0.14", "10.13.0.1")
    assert a.permitido("10.13.0.1") and not a.permitido("10.13.0.12")


def test_estado(tmp_path):
    a, sh = _agente(tmp_path)
    sh.vivos = {"datanode"}
    assert a.atender("GET", "/estado", "127.0.0.1") == (200, {"nodo": "pc03", "datanode": "si", "nodemanager": "no"})


def test_por_http(tmp_path):
    a, _ = _agente(tmp_path, ESCUCHA_AGENTE="127.0.0.1")
    srv = ag.servidor(a, 0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    url = f"http://127.0.0.1:{srv.server_address[1]}"
    try:
        r = urllib.request.urlopen(urllib.request.Request(f"{url}/apagar", data=b"codigo=aula-7\nmodo=ordenado\n"),
                                   timeout=5)
        assert ag.leer_kv(r.read().decode())["accion"] == "ordenado"
        with pytest.raises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(urllib.request.Request(f"{url}/apagar", data=b"codigo=mal\n"), timeout=5)
        assert e.value.code == 403
    finally:
        srv.shutdown()
        srv.server_close()


def test_main_no_arranca_sin_codigo_o_con_agente_no(monkeypatch, capsys):
    llamado = []
    monkeypatch.setattr(ag, "servidor", lambda *a, **k: llamado.append(1))
    monkeypatch.setenv("AGENTE", "no")
    monkeypatch.setenv("CODIGO", "X")
    ag.main()
    monkeypatch.setenv("AGENTE", "si")
    monkeypatch.setenv("CODIGO", "")
    monkeypatch.setenv("RED", "docker")
    ag.main()
    assert llamado == [] and "sin CODIGO" in capsys.readouterr().out
