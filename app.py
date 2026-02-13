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


# Optional save endpoint if you want it
@app.post("/api/tree/<name>")
def api_tree_save(name: str):
    payload = request.get_json(force=True, silent=False)
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid JSON"}), 400
    if "people" not in payload or "relationships" not in payload:
        return jsonify({"error": "JSON must include people and relationships"}), 400

    path = family_path(name)
    save_family_file(path, payload)
    return jsonify({"ok": True})


# ✅ Backwards-compatible endpoints (still use gupta by default)
@app.get("/api/family")
def api_get_family():
    return jsonify(load_family_file(family_path("gupta")))


@app.post("/api/family")
def api_save_family():
    payload = request.get_json(force=True, silent=False)
    if not isinstance(payload, dict):
        return jsonify({"error": "Invalid JSON"}), 400
    if "people" not in payload or "relationships" not in payload:
        return jsonify({"error": "JSON must include people and relationships"}), 400

    save_family_file(family_path("gupta"), payload)
    return jsonify({"ok": True})


@app.post("/api/upload")
def api_upload():
    if "file" not in request.files:
        return jsonify({"error": "No file field"}), 400

    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "Empty filename"}), 400

    if not allowed_file(f.filename):
        return jsonify({"error": "Only png/jpg/jpeg/webp allowed"}), 400

    filename = secure_filename(f.filename)

    base = Path(filename).stem
    ext = Path(filename).suffix.lower()
    final = filename
    i = 1
    while (UPLOAD_DIR / final).exists():
        final = f"{base}_{i}{ext}"
        i += 1

    out_path = UPLOAD_DIR / final
    f.save(out_path)

    return jsonify({"url": f"/static/uploads/{final}"})

###################################
# RUNNING LOCALLY
###################################
#if __name__ == "__main__":
    #app.run(host="127.0.0.1", port=5000, debug=True)
