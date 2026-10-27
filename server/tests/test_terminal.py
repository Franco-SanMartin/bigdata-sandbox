"""La terminal de la interfaz (/api/terminal): bash de verdad por websocket, solo desde localhost."""
import json
import time

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from sandbox_server import terminal as T
from sandbox_server.app import build_app

LOCAL = "http://localhost:8080"


@pytest.fixture
def app(settings, tmp_path, monkeypatch):
    monkeypatch.delenv("TERMINAL", raising=False)
    monkeypatch.delenv("TERMINAL_HOSTS", raising=False)
    monkeypatch.setenv("TERMINAL_CWD", str(tmp_path))
    a = build_app(settings, ui_dir=tmp_path / "sin-ui")
    # Sin los .bashrc de la máquina que corre los tests: solo la marca del prompt
    rc = tmp_path / "rc"
    rc.write_text(T.RCFILE.read_text().replace('[ -f /etc/bash.bashrc ]', 'false').replace('[ -f "$HOME/.bashrc" ]', 'false'))
    a.state.terminal.shell = ["bash", "--rcfile", str(rc), "-i"]
    return a


def ws_url(base, path="/api/terminal"):
    return base.replace("http", "ws", 1) + path


def leer_hasta(ws, texto, timeout=10):
    """Junta la salida hasta que aparece el texto"""
    fin, todo = time.time() + timeout, ""
    while time.time() < fin:
        todo += ws.receive_text()
        if texto in todo:
            return todo
    raise AssertionError(f"no apareció {texto!r} en {todo!r}")


def test_corre_comandos_de_verdad(app, tmp_path):
    with TestClient(app, base_url=LOCAL) as c, c.websocket_connect(ws_url(LOCAL, "/api/terminal?cols=80&rows=24"), headers={"origin": LOCAL}) as ws:
        ws.send_text(json.dumps({"t": "i", "d": "echo $((6*7)) $SANDBOX_TERMINAL; echo dir=$PWD\r"}))
        leer_hasta(ws, f"42 1\r\ndir={tmp_path}")
        ws.send_text(json.dumps({"t": "r", "c": 132, "r": 40}))
        ws.send_text(json.dumps({"t": "i", "d": "stty size\r"}))
        assert "40 132" in leer_hasta(ws, "40 132")
        ws.send_text(json.dumps({"t": "i", "d": "exit 3\r"}))
        with pytest.raises(WebSocketDisconnect) as e:
            while True:
                ws.receive_text()
        assert e.value.code == 1000 and "código 3" in e.value.reason
    assert app.state.terminal.sessions == 0


def test_marca_el_prompt_con_el_codigo_de_salida(app):
    with TestClient(app, base_url=LOCAL) as c, c.websocket_connect(ws_url(LOCAL), headers={"origin": LOCAL}) as ws:
        leer_hasta(ws, "\x1b]777;bds;0\x07")
        ws.send_text(json.dumps({"t": "i", "d": "(exit 7)\r"}))
        leer_hasta(ws, "\x1b]777;bds;7\x07")


def test_mensajes_raros_no_la_rompen(app):
    with TestClient(app, base_url=LOCAL) as c, c.websocket_connect(ws_url(LOCAL), headers={"origin": LOCAL}) as ws:
        for m in ("no es json", "[1,2]", json.dumps({"t": "r", "c": "x"}), json.dumps({"t": "i", "d": 5})):
            ws.send_text(m)
        ws.send_text(json.dumps({"t": "i", "d": "echo sigue-$((1+1))\r"}))
        leer_hasta(ws, "sigue-2")


@pytest.mark.parametrize("base,origin,motivo", [
    ("http://localhost:8080", "http://malo.example", "este mismo contenedor"),
    ("http://localhost:8080", None, "Origin"),
    ("http://rebind.example:8080", "http://rebind.example:8080", "solo se abre desde esta compu"),
    ("http://10.0.0.5:8080", "http://10.0.0.5:8080", "solo se abre desde esta compu"),
])
def test_solo_desde_la_interfaz_local(app, base, origin, motivo):
    headers = {"origin": origin} if origin else {}
    with TestClient(app, base_url=base) as c, c.websocket_connect(ws_url(base), headers=headers) as ws:
        with pytest.raises(WebSocketDisconnect) as e:
            ws.receive_text()
    assert e.value.code == T.CLOSE_FORBIDDEN
    assert motivo in e.value.reason


def test_apagada_y_hosts_extra(app, monkeypatch):
    monkeypatch.setenv("TERMINAL", "0")
    with TestClient(app, base_url=LOCAL) as c, c.websocket_connect(ws_url(LOCAL), headers={"origin": LOCAL}) as ws:
        with pytest.raises(WebSocketDisconnect) as e:
            ws.receive_text()
    assert e.value.code == T.CLOSE_OFF
    monkeypatch.delenv("TERMINAL")
    monkeypatch.setenv("TERMINAL_HOSTS", "aula-pc1")
    base = "http://aula-pc1:8080"
    with TestClient(app, base_url=base) as c, c.websocket_connect(ws_url(base), headers={"origin": base}) as ws:
        ws.send_text(json.dumps({"t": "i", "d": "echo ok-$((2+2))\r"}))
        leer_hasta(ws, "ok-4")


@pytest.mark.parametrize("valor,host", [("localhost:8080", "localhost"), ("[::1]:8080", "::1"), ("127.0.0.1", "127.0.0.1"),
                                        ("LocalHost", "localhost"), ("::1", "::1")])
def test_host_sin_puerto(valor, host):
    assert T._host(valor) == host
