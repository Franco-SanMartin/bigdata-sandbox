import json
import sys
from pathlib import Path

import pytest

SERVER = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SERVER))

FIX = Path(__file__).resolve().parent / "fixtures"
FALSO = FIX / "entrypoint_falso.sh"

BASE = {"datanodes": 2, "replication": 2, "blockSize": "1m", "namenodes": 1, "services": "todo",
        "mongodb": False, "jupyter": True, "pigHeapsize": 512}


def fixture_text(name: str) -> str:
    return (FIX / name).read_text()


def fixture_json(name: str) -> dict:
    return json.loads(fixture_text(name))


@pytest.fixture
def settings(tmp_path, monkeypatch):
    """Settings de un cluster que corre el entrypoint falso y no sondea nada real."""
    from sandbox_server.cluster import Settings
    vol = tmp_path / "hadoop"
    vol.mkdir()
    monkeypatch.setenv("FALSO_VOLUMEN", str(vol))
    monkeypatch.setenv("FALSO_TRAZA", str(tmp_path / "traza.txt"))
    monkeypatch.setenv("FALSO_PAUSA", "0.02")
    return Settings(entrypoint=["bash", str(FALSO)], hadoop_dir=vol, bin_dir=tmp_path / "bin",
                    proc_dir=tmp_path / "proc", probe=False, stop_timeout=5)
