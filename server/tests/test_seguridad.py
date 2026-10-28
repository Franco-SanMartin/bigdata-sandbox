"""La API solo atiende a la propia interfaz (seguridad.py): host confiable,
origen de los pedidos que cambian algo y cuerpos JSON con su Content-Type."""
import pytest
from starlette.testclient import TestClient

from sandbox_server.app import build_app
from sandbox_server.seguridad import hosts_permitidos, revisar

UI = "http://localhost:8080"


@pytest.fixture
def cliente(settings, tmp_path, monkeypatch):
    """Como la ve el navegador: http://localhost:8080, sin hosts extra."""
    monkeypatch.delenv("SANDBOX_HOSTS", raising=False)
    monkeypatch.delenv("TERMINAL_HOSTS", raising=False)
    ui = tmp_path / "ui"
    ui.mkdir()
    (ui / "index.html").write_text("<!doctype html><title>BigData Sandbox</title>")
    with TestClient(build_app(settings, ui_dir=ui), base_url=UI) as c:
        yield c


def test_hosts_permitidos():
    assert hosts_permitidos("") == ["localhost", "127.0.0.1", "::1"]
    assert hosts_permitidos(" profe-pc , LOCALHOST,*.algo,[::1]") == ["localhost", "127.0.0.1", "::1", "profe-pc"]


@pytest.mark.parametrize("host", ["localhost:8080", "127.0.0.1:8080", "[::1]:8080", "localhost"])
def test_host_local_pasa(cliente, host):
    r = cliente.get("/api/status", headers={"Host": host})
    assert r.status_code == 200, r.text


@pytest.mark.parametrize("host", ["evil.example.com", "evil.example.com:8080", "192.168.0.10:8080", "localhost.evil.com"])
def test_host_ajeno_no(cliente, host):
    """DNS rebinding: el dominio de otra página que apunta a 127.0.0.1 no entra (ni a la interfaz ni a la API)"""
    r = cliente.get("/api/status", headers={"Host": host})
    assert r.status_code == 403 and r.json()["code"] == "forbidden"
    assert cliente.get("/", headers={"Host": host}).status_code == 403


@pytest.mark.parametrize("var", ["SANDBOX_HOSTS", "TERMINAL_HOSTS"])
def test_hosts_extra_agregan(settings, tmp_path, monkeypatch, var):
    """La misma lista que la terminal (terminal.py): cualquiera de las dos variables suma"""
    monkeypatch.delenv("SANDBOX_HOSTS", raising=False)
    monkeypatch.setenv(var, "profe-pc")
    with TestClient(build_app(settings, ui_dir=tmp_path), base_url="http://profe-pc:8080") as c:
        assert c.get("/api/status").status_code == 200


def test_origen_propio_pasa(cliente):
    r = cliente.post("/api/config/validate", json={"config": {}}, headers={"Origin": UI})
    assert r.status_code == 200, r.text
    r = cliente.post("/api/config/validate", json={"config": {}}, headers={"Referer": UI + "/#config"})
    assert r.status_code == 200, r.text


@pytest.mark.parametrize("cabecera", [
    {"Origin": "https://evil.example.com"},
    {"Origin": "null"},
    {"Origin": "http://localhost:9999"},          # otro puerto es otra página
    {"Origin": "https://localhost:8080"},         # otro esquema también
    {"Referer": "https://evil.example.com/pagina"},
    {"Origin": "https://evil.example.com", "Referer": UI + "/"},   # manda el Origin
])
@pytest.mark.parametrize("metodo,ruta", [("POST", "/api/cluster/stop"), ("PUT", "/api/config"),
                                          ("PATCH", "/api/hdfs/files"), ("DELETE", "/api/hdfs/files?path=/x"),
                                          ("POST", "/api/ml/runs")])
def test_origen_ajeno_no(cliente, cabecera, metodo, ruta):
    r = cliente.request(metodo, ruta, headers={**cabecera, "Content-Type": "application/json"}, content=b"{}")
    assert r.status_code == 403, (metodo, ruta, r.status_code, r.text)
    assert r.json()["code"] == "forbidden"


def test_get_no_mira_el_origen(cliente):
    """Leer no cambia nada y el navegador no deja que otra página lea la respuesta (sin CORS)"""
    assert cliente.get("/api/status", headers={"Origin": "https://evil.example.com"}).status_code == 200


def test_sin_origen_pasa(cliente):
    """curl, scripts y el humo no mandan Origin ni Referer: no son un navegador engañado"""
    assert cliente.post("/api/config/validate", json={"config": {}}).status_code == 200


@pytest.mark.parametrize("tipo", ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x",
                                  None])
def test_cuerpo_tiene_que_ser_json(cliente, tipo):
    """Un formulario de otra página solo manda estos tipos sin preguntar (CORS): se rechazan aunque el origen pase"""
    h = {"Origin": UI}
    if tipo:
        h["Content-Type"] = tipo
    r = cliente.post("/api/config/validate", content=b'{"config": {}}', headers=h)
    assert r.status_code == 415, r.text
    assert r.json()["code"] == "invalid"
    r = cliente.post("/api/config/validate", content=b'{"config": {}}',
                     headers={**h, "Content-Type": "application/json; charset=utf-8"})
    assert r.status_code == 200, r.text


def test_post_sin_cuerpo_no_pide_tipo(cliente):
    r = cliente.post("/api/hdfs/datanodes", headers={"Origin": UI})
    assert r.status_code != 415


def test_subida_multipart_solo_en_upload(cliente):
    """La subida de archivos va como multipart (y pasa por el control de origen igual)"""
    r = cliente.post("/api/hdfs/upload", files={"file": ("a.csv", b"x,y\n1,2\n")}, data={"dest": "/user/root/a.csv"},
                     headers={"Origin": UI})
    assert r.status_code != 415
    r = cliente.post("/api/hdfs/upload", files={"file": ("a.csv", b"x,y\n1,2\n")}, data={"dest": "/user/root/a.csv"},
                     headers={"Origin": "https://evil.example.com"})
    assert r.status_code == 403


def test_revisar_sin_scope_http():
    local = [(b"host", b"localhost:8080")]
    assert revisar({"type": "http", "method": "GET", "headers": local}) is None
    assert revisar({"type": "http", "method": "OPTIONS", "headers": local}) is None
    assert revisar({"type": "http", "method": "GET", "headers": []})[0] == 403   # sin Host no hay a quién atender
