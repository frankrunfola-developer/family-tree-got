from __future__ import annotations

################################################################
# RENDER HOSTING
#   - Update App to Use Persistent Disk
#---------------------------------------------------------------
import os

DATA_DIR = os.environ.get("DATA_DIR", "data")

os.makedirs(DATA_DIR, exist_ok=True)
################################################################

import json
from pathlib import Path
from typing import Any, Dict

from flask import Flask, jsonify, render_template, request

APP_DIR = Path(__file__).parent

# Convert DATA_DIR (string) to a Path and make it absolute relative to the app folder if needed
DATA_DIR = Path(DATA_DIR)
if not DATA_DIR.is_absolute():
    DATA_DIR = APP_DIR / DATA_DIR
DATA_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(__name__)


def family_path(name: str) -> Path:
    safe = "".join(c for c in name.lower() if c.isalnum() or c in ("-", "_"))
    return DATA_DIR / f"family_{safe}.json"


def load_family_file(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {"people": [], "relationships": []}
    return json.loads(path.read_text(encoding="utf-8"))


@app.get("/")
def index():
    return render_template("index.html")


# Tree data endpoint (read-only)
@app.get("/api/tree/<name>")
def api_tree(name: str):
    path = family_path(name)
    if not path.exists():
        return jsonify({"error": "not found", "expected_file": str(path)}), 404
    return jsonify(load_family_file(path))

#####################
# LOCAL RUN
#####################
#if __name__ == "__main__":
    #app.run(host="127.0.0.1", port=5000, debug=True)
