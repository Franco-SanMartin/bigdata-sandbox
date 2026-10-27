"""Copia el catálogo del estudio de ML para el modo demo de la interfaz (sin backend).

    python3 ml/exportar_catalogo.py      # escribe ui/src/api/demo/ml/catalogo.json

server/tests/test_estudio.py avisa si la copia quedó vieja.
"""
import json
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))
from sandbox_ml import catalogo  # noqa: E402

destino = AQUI.parent / "ui" / "src" / "api" / "demo" / "ml" / "catalogo.json"
destino.write_text(json.dumps(catalogo.como_json(), ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print(f"{destino} ({len(catalogo.MODELOS)} modelos)")
