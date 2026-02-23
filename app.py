from __future__ import annotations

"""
LineAgeMap — app.py (cleaned + hardened)

- Session-based auth (session["user_id"])
- Persistent storage under DATA_DIR (Render sets DATA_DIR)
- Built-in sample datasets (includes stark)
- Not-logged-in behavior:
    • Tree / Timeline / Map templates should use /api/sample/<demo>/tree
    • /api/tree/me fallback returns demo sample
    • Landing previews use demo sample
- Normalizes sample/user JSON into a stable schema:
    { "people": [...], "relationships": [...] }
  including relationship key normalization to parentId/childId.

NEW (Demo Sample Toggle + Shared Map Background)
- Demo sample selection is controlled by:
    1) query string ?sample=<id>
    2) session["demo_sample"]
    3) DEFAULT_SAMPLE_ID
- Exposes GET /api/samples to drive a dropdown
- Provides map_bg_url to templates so landing Migration card can match /map background
"""

import json
import os
import shutil
import sqlite3
import uuid
from datetime import datetime
from functools import wraps
from pathlib import Path
from typing import Any, Dict, Optional

from flask import Flask, abort, jsonify, redirect, render_template, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash

# -----------------------------
# PATHS / STORAGE (Render)
# -----------------------------
APP_DIR = Path(__file__).parent

# Render will set DATA_DIR to a persistent disk mount (e.g., /var/data)
DATA_DIR_ENV = os.environ.get("DATA_DIR", "data")
DATA_DIR = Path(DATA_DIR_ENV)
if not DATA_DIR.is_absolute():
    DATA_DIR = APP_DIR / DATA_DIR
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Session secret (set LINEAGEMAP_SECRET in production)
SECRET = os.environ.get("LINEAGEMAP_SECRET", "dev-secret-change-me")

# Default demo dataset when not logged in (previews + fallback)
DEFAULT_SAMPLE_ID = "stark"

# Map backgrounds (used by BOTH: landing migration preview + /map page)
# Put your real filenames in static/img/maps/
MAP_BG_BY_SAMPLE = {
    # Westeros demo samples → Westeros parchment map background
    "stark": "img/maps/westeros-parchment.jpg",
    "lannister": "img/maps/westeros-parchment.jpg",
}
DEFAULT_MAP_BG = "img/maps/world-parchment.jpg"

app = Flask(
    __name__,
    template_folder=str(APP_DIR / "templates"),
    static_folder=str(APP_DIR / "static"),
)
app.secret_key = SECRET


# -----------------------------
# SMALL HELPERS (type-safe)
# -----------------------------
def require_lastrowid(cur: sqlite3.Cursor) -> int:
    rid = cur.lastrowid
    if rid is None:
        raise RuntimeError("Insert failed: lastrowid is None")
    return int(rid)


def get_session_uid() -> int | None:
    raw = session.get("user_id")
    if isinstance(raw, int):
        return raw
    if isinstance(raw, str) and raw.isdigit():
        return int(raw)
    return None


# -----------------------------
# DB (Users)
# -----------------------------
def users_db_path() -> Path:
    return DATA_DIR / "users.db"


def db_connect() -> sqlite3.Connection:
    con = sqlite3.connect(users_db_path())
    con.row_factory = sqlite3.Row
    return con


def db_init() -> None:
    with db_connect() as con:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              email TEXT NOT NULL UNIQUE,
              password_hash TEXT NOT NULL,
              family_file TEXT NOT NULL DEFAULT '',
              public_slug TEXT NOT NULL DEFAULT '',
              is_public INTEGER NOT NULL DEFAULT 0,
              state_json TEXT NOT NULL DEFAULT '{}',
              created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
            """
        )

        # Lightweight migrations for existing DBs.
        cols = [r["name"] for r in con.execute("PRAGMA table_info(users)").fetchall()]
        if "family_file" not in cols:
            con.execute("ALTER TABLE users ADD COLUMN family_file TEXT NOT NULL DEFAULT ''")
        if "public_slug" not in cols:
            con.execute("ALTER TABLE users ADD COLUMN public_slug TEXT NOT NULL DEFAULT ''")
        if "is_public" not in cols:
            con.execute("ALTER TABLE users ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0")
        if "state_json" not in cols:
            con.execute("ALTER TABLE users ADD COLUMN state_json TEXT NOT NULL DEFAULT '{}'")

        con.commit()


db_init()


# -----------------------------
# FILES (Families)
# -----------------------------
def families_dir() -> Path:
    d = DATA_DIR / "families"
    d.mkdir(parents=True, exist_ok=True)
    return d


def user_family_file(uid: int) -> Path:
    d = families_dir() / str(uid)
    d.mkdir(parents=True, exist_ok=True)
    return d / "family.json"


def _safe_family_name(name: str) -> str:
    return "".join(c for c in (name or "").lower() if c.isalnum() or c in ("-", "_"))


def family_path(name: str) -> Path:
    """
    Preferred convention:
        DATA_DIR/family_<name>.json
    Also supports:
        DATA_DIR/<name>.json
    """
    safe = _safe_family_name(name)

    p1 = DATA_DIR / f"family_{safe}.json"
    if p1.exists():
        return p1

    p2 = DATA_DIR / f"{safe}.json"
    if p2.exists():
        return p2

    return p1


def _normalize_relationships(rels: Any) -> list[dict]:
    """
    Normalize relationship records into a consistent parentId/childId shape.

    Supports common variants:
      - {source, target}
      - {sourceId, targetId}
      - {parent, child}
      - {parentId, childId}
    """
    if not isinstance(rels, list):
        return []

    out: list[dict] = []
    for r in rels:
        if not isinstance(r, dict):
            continue

        parent = (
            r.get("parentId")
            or r.get("parent")
            or r.get("sourceId")
            or r.get("source")
        )
        child = (
            r.get("childId")
            or r.get("child")
            or r.get("targetId")
            or r.get("target")
        )

        if parent is None or child is None:
            continue

        nr = dict(r)
        nr["parentId"] = str(parent)
        nr["childId"] = str(child)
        out.append(nr)

    return out


def load_family_file(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {"people": [], "relationships": []}

    data = json.loads(path.read_text(encoding="utf-8"))

    # Normalize older/alternate schemas
    if "people" not in data and "nodes" in data:
        data["people"] = data.get("nodes") or []
    if "relationships" not in data and "links" in data:
        data["relationships"] = data.get("links") or []

    # Ensure correct types
    if not isinstance(data.get("people"), list):
        data["people"] = []
    data["relationships"] = _normalize_relationships(data.get("relationships"))

    return data


def load_user_family(uid: int) -> Dict[str, Any]:
    path = user_family_file(uid)
    if path.exists():
        return load_family_file(path)
    # If user family missing, fall back to default sample
    return load_sample_tree(DEFAULT_SAMPLE_ID)


# -----------------------------
# SAMPLES (built-in demo datasets)
# -----------------------------
def samples_disk_dir() -> Path:
    d = DATA_DIR / "samples"
    d.mkdir(parents=True, exist_ok=True)
    return d


def samples_repo_dir() -> Path:
    """
    Canonical "shipped" samples in repo.

    Your screenshot shows:
        ./data/samples/*.json

    So we treat APP_DIR/data/samples as the repo canonical location.
    """
    return APP_DIR / "data" / "samples"


def seed_samples_if_missing() -> None:
    """
    Render persistent disk starts empty.
    Keep canonical samples in repo ./data/samples/*.json
    Copy missing ones to DATA_DIR/samples on boot.
    """
    repo = samples_repo_dir()
    if not repo.exists():
        return

    target = samples_disk_dir()
    for src in repo.glob("*.json"):
        dst = target / src.name
        if not dst.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)


def _sample_paths(sample_id: str) -> list[Path]:
    fname = sample_id if sample_id.endswith(".json") else f"{sample_id}.json"
    # prefer persistent disk first
    return [
        samples_disk_dir() / fname,
        # dev/legacy fallbacks
        samples_repo_dir() / fname,
        APP_DIR / "samples" / fname,              # legacy repo location (if you had it before)
        APP_DIR / "static" / "samples" / fname,
        APP_DIR / "static" / "data" / fname,
        APP_DIR / "data" / "samples" / fname,
    ]


def _load_sample_json(sample_id: str) -> dict:
    for p in _sample_paths(sample_id):
        if p.exists():
            with p.open("r", encoding="utf-8") as f:
                return json.load(f)
    abort(
        404,
        description=(
            f"Sample '{sample_id}' not found. Looked in: "
            + ", ".join(str(p) for p in _sample_paths(sample_id))
        ),
    )


def _normalize_tree(payload: dict) -> dict:
    """
    Ensure output is exactly:
      { "people": [...], "relationships": [...] }
    Also supports common alternate keys.
    """
    people = payload.get("people") or payload.get("persons") or payload.get("nodes") or []
    rels = payload.get("relationships") or payload.get("edges") or payload.get("links") or []
    return {
        "people": people if isinstance(people, list) else [],
        "relationships": _normalize_relationships(rels),
    }


def load_sample_tree(sample_id: str) -> Dict[str, Any]:
    raw = _load_sample_json(sample_id)
    tree = _normalize_tree(raw)
    if not tree["people"]:
        abort(500, description=f"Sample '{sample_id}' loaded but produced 0 people. Check JSON schema/keys.")
    return tree


def list_sample_ids() -> list[str]:
    """
    Enumerate sample IDs from both persistent disk and repo (best effort).
    Returns unique, sorted list like: ['gupta','kennedy','lannister','stark']
    """
    ids: set[str] = set()

    # disk
    try:
        for p in samples_disk_dir().glob("*.json"):
            ids.add(p.stem.lower())
    except Exception:
        pass

    # repo
    repo = samples_repo_dir()
    if repo.exists():
        for p in repo.glob("*.json"):
            ids.add(p.stem.lower())

    # legacy repo location
    legacy = APP_DIR / "samples"
    if legacy.exists():
        for p in legacy.glob("*.json"):
            ids.add(p.stem.lower())

    out = sorted(ids)
    return out


def get_demo_sample_id() -> str:
    """
    Decide which demo sample to use for non-auth views.
    Priority:
      1) query string ?sample=
      2) session['demo_sample']
      3) DEFAULT_SAMPLE_ID if available
      4) first available sample
      5) DEFAULT_SAMPLE_ID (even if missing) as last resort
    """
    available = set(list_sample_ids())

    qs = (request.args.get("sample") or "").strip().lower()
    if qs and qs in available:
        session["demo_sample"] = qs
        return qs

    ss = (session.get("demo_sample") or "").strip().lower()
    if ss and ss in available:
        return ss

    if DEFAULT_SAMPLE_ID in available:
        session["demo_sample"] = DEFAULT_SAMPLE_ID
        return DEFAULT_SAMPLE_ID

    # pick something real if we can
    if available:
        pick = sorted(available)[0]
        session["demo_sample"] = pick
        return pick

    # last resort: keep old behavior
    session["demo_sample"] = DEFAULT_SAMPLE_ID
    return DEFAULT_SAMPLE_ID


def resolve_map_bg(sample_id: str) -> str:
    """
    Return static path for the background image used by /map AND the landing Migration card.
    """
    sid = (sample_id or "").strip().lower()
    return MAP_BG_BY_SAMPLE.get(sid, DEFAULT_MAP_BG)


# Seed samples once on import (safe + fast)
seed_samples_if_missing()


# -----------------------------
# PUBLIC SLUGS
# -----------------------------
def slugify(s: str) -> str:
    s = (s or "").strip().lower()
    out: list[str] = []
    for c in s:
        if c.isalnum():
            out.append(c)
        elif c in ("-", "_", "."):
            out.append("-")
        elif c.isspace():
            out.append("-")
    slug = "".join(out).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug[:64] or "family"


def unique_public_slug(con: sqlite3.Connection, base: str) -> str:
    base = slugify(base)
    slug = base
    i = 2
    while True:
        row = con.execute("SELECT 1 FROM users WHERE public_slug = ?", (slug,)).fetchone()
        if not row:
            return slug
        slug = f"{base}-{i}"
        i += 1


def load_public_family_by_slug(slug: str) -> Optional[Dict[str, Any]]:
    safe_slug = slugify(slug)
    with db_connect() as con:
        row = con.execute(
            "SELECT id, is_public FROM users WHERE public_slug = ?",
            (safe_slug,),
        ).fetchone()

    if not row:
        return None
    if int(row["is_public"]) != 1:
        return None
    return load_user_family(int(row["id"]))


# -----------------------------
# CURRENT USER
# -----------------------------
def get_current_user() -> Optional[dict]:
    uid = get_session_uid()
    if uid is None:
        return None

    with db_connect() as con:
        row = con.execute(
            "SELECT id, email, family_file, public_slug, is_public, state_json FROM users WHERE id = ?",
            (uid,),
        ).fetchone()

    if not row:
        session.pop("user_id", None)
        return None

    try:
        state = json.loads(row["state_json"] or "{}")
    except Exception:
        state = {}

    return {
        "id": int(row["id"]),
        "email": row["email"],
        "family_file": row["family_file"],
        "public_slug": row["public_slug"],
        "is_public": bool(row["is_public"]),
        "state": state,
    }


def set_user_state(uid: int, state: dict) -> None:
    with db_connect() as con:
        con.execute(
            "UPDATE users SET state_json = ? WHERE id = ?",
            (json.dumps(state, ensure_ascii=False), uid),
        )
        con.commit()


@app.context_processor
def inject_current_user() -> dict:
    return {"current_user": get_current_user()}


# -----------------------------
# STARTER DATASET FOR NEW USERS
# -----------------------------
def starter_family_payload() -> Dict[str, Any]:
    p1 = f"p_{uuid.uuid4().hex[:6]}"
    p2 = f"p_{uuid.uuid4().hex[:6]}"
    return {
        "meta": {
            "family_name": "My Family",
            "created_at": datetime.utcnow().isoformat() + "Z",
            "starter": True,
        },
        "people": [
            {
                "id": p1,
                "name": "",
                "born": "",
                "died": "",
                "photo": "",
                "location": {"city": "", "region": "", "country": ""},
                "events": [],
            },
            {
                "id": p2,
                "name": "",
                "born": "",
                "died": "",
                "photo": "",
                "location": {"city": "", "region": "", "country": ""},
                "events": [],
            },
        ],
        "relationships": [],
    }


# -----------------------------
# AUTH HELPERS
# -----------------------------
def authenticate_user(email: str, password: str) -> Optional[dict]:
    email = (email or "").strip().lower()
    if not email or not password:
        return None

    with db_connect() as con:
        row = con.execute(
            "SELECT id, email, password_hash FROM users WHERE email = ?",
            (email,),
        ).fetchone()

    if not row:
        return None
    if not check_password_hash(row["password_hash"], password):
        return None

    return {"id": int(row["id"]), "email": row["email"]}


def create_user(email: str, password: str) -> int:
    email = (email or "").strip().lower()
    password = password or ""

    if not email or "@" not in email or len(email) > 254:
        raise ValueError("Please enter a valid email.")
    if len(password) < 8:
        raise ValueError("Password must be at least 8 characters.")

    pw_hash = generate_password_hash(password)
    default_state = {"family_id": "me"}

    try:
        with db_connect() as con:
            base_slug = email.split("@", 1)[0]
            pub_slug = unique_public_slug(con, base_slug)

            cur = con.execute(
                "INSERT INTO users (email, password_hash, public_slug, state_json) VALUES (?, ?, ?, ?)",
                (email, pw_hash, pub_slug, json.dumps(default_state)),
            )
            uid = require_lastrowid(cur)

            dst = user_family_file(uid)
            if not dst.exists():
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_text(json.dumps(starter_family_payload(), indent=2), encoding="utf-8")

            con.execute("UPDATE users SET family_file = ? WHERE id = ?", (str(dst), uid))
            con.commit()

        return uid
    except sqlite3.IntegrityError:
        raise ValueError("That email is already registered.")


def login_required(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        if get_session_uid() is None:
            return redirect(url_for("login", next=request.path))
        return view(*args, **kwargs)

    return wrapped


# -----------------------------
# PAGES
# -----------------------------
@app.get("/")
def index():
    user = get_current_user()

    samples = list_sample_ids()
    demo_sample = get_demo_sample_id() if not user else None
    effective_sample = demo_sample or DEFAULT_SAMPLE_ID

    fam = load_sample_tree(effective_sample)

    people = fam.get("people") or []
    rels = fam.get("relationships") or []

    # roots = people with no incoming child links
    child_ids = set()
    for r in rels:
        child = r.get("childId")
        if child:
            child_ids.add(str(child))

    roots = [p for p in people if str(p.get("id")) not in child_ids]
    roots = roots[:2] if roots else people[:2]
    tree_preview = {"parents": roots, "children": []}

    timeline_people = [p for p in people if p.get("photo")]
    timeline_people.sort(key=lambda p: str(p.get("name", "")))
    timeline_preview = timeline_people[:5]

    # shared map background for landing migration card
    map_bg_url = url_for("static", filename=resolve_map_bg(effective_sample))

    return render_template(
        "index.html",
        tree_preview=tree_preview,
        timeline_preview=timeline_preview,
        samples=samples,
        demo_sample=demo_sample,
        map_bg_url=map_bg_url,
    )


@app.get("/f/<slug>")
def public_family(slug: str):
    fam = load_public_family_by_slug(slug)
    if fam is None:
        abort(404)

    people = fam.get("people") or []
    rels = fam.get("relationships") or []

    child_ids = set()
    for r in rels:
        child = r.get("childId")
        if child:
            child_ids.add(str(child))

    roots = [p for p in people if str(p.get("id")) not in child_ids]
    roots = roots[:2] if roots else people[:2]
    tree_preview = {"parents": roots, "children": []}

    timeline_people = [p for p in people if p.get("photo")]
    timeline_preview = timeline_people[:5]

    return render_template(
        "public_family.html",
        public_slug=slugify(slug),
        family_name=(fam.get("meta") or {}).get("family_name") or "Family",
        tree_preview=tree_preview,
        timeline_preview=timeline_preview,
    )


@app.get("/tree")
def tree_view():
    user = get_current_user()

    public_slug = request.args.get("public")
    sample_id = (request.args.get("sample") or "").strip().lower() or None

    samples = list_sample_ids()
    demo_sample = get_demo_sample_id() if not user else None

    # If user not logged in and a sample is selected, prefer the selection
    if not user:
        sample_id = sample_id or demo_sample

    return render_template(
        "tree.html",
        public_slug=slugify(public_slug) if public_slug else None,
        sample_id=sample_id,
        samples=samples,
        demo_sample=demo_sample,
        map_bg_url=url_for("static", filename=resolve_map_bg(sample_id or demo_sample or DEFAULT_SAMPLE_ID)),
    )


@app.get("/timeline")
def timeline_view():
    user = get_current_user()

    public_slug = request.args.get("public")
    sample_id = (request.args.get("sample") or "").strip().lower() or None

    samples = list_sample_ids()
    demo_sample = get_demo_sample_id() if not user else None

    if not user:
        sample_id = sample_id or demo_sample

    return render_template(
        "timeline.html",
        public_slug=slugify(public_slug) if public_slug else None,
        sample_id=sample_id,
        samples=samples,
        demo_sample=demo_sample,
        map_bg_url=url_for("static", filename=resolve_map_bg(sample_id or demo_sample or DEFAULT_SAMPLE_ID)),
    )


@app.get("/map")
def map_view():
    user = get_current_user()

    public_slug = request.args.get("public")
    sample_id = (request.args.get("sample") or "").strip().lower() or None

    samples = list_sample_ids()
    demo_sample = get_demo_sample_id() if not user else None

    if not user:
        sample_id = sample_id or demo_sample

    return render_template(
        "map.html",
        public_slug=slugify(public_slug) if public_slug else None,
        sample_id=sample_id,
        samples=samples,
        demo_sample=demo_sample,
        map_bg_url=url_for("static", filename=resolve_map_bg(sample_id or demo_sample or DEFAULT_SAMPLE_ID)),
    )


# -----------------------------
# AUTH PAGES
# -----------------------------
@app.get("/login")
def login():
    return render_template("login.html", error=None)


@app.post("/login")
def login_post():
    email = request.form.get("email", "").strip().lower()
    password = request.form.get("password", "")

    user = authenticate_user(email, password)
    if not user:
        return render_template("login.html", error="Invalid email or password.")

    session["user_id"] = user["id"]

    next_url = request.args.get("next") or request.form.get("next")
    return redirect(next_url or url_for("tree_view"))


@app.get("/register")
def register():
    return render_template("register.html", error=None)


@app.post("/register")
def register_post():
    email = request.form.get("email", "").strip().lower()
    password = request.form.get("password", "")

    try:
        uid = create_user(email, password)
    except ValueError as e:
        return render_template("register.html", error=str(e))

    session["user_id"] = uid
    return redirect(url_for("tree_view"))


@app.get("/logout")
def logout():
    session.pop("user_id", None)
    next_url = request.args.get("next")
    return redirect(next_url or url_for("index"))


# -----------------------------
# AUTH API
# -----------------------------
@app.post("/api/register")
def api_register():
    payload = request.get_json(silent=True) or {}
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", ""))

    if not email or "@" not in email or len(email) > 254:
        return jsonify({"ok": False, "error": "Please enter a valid email."}), 400
    if not password or len(password) < 8:
        return jsonify({"ok": False, "error": "Password must be at least 8 characters."}), 400

    try:
        uid = create_user(email, password)
    except ValueError as e:
        msg = str(e)
        code = 409 if "already registered" in msg.lower() else 400
        return jsonify({"ok": False, "error": msg}), code

    session["user_id"] = uid
    return jsonify({"ok": True, "email": email, "state": {"family_id": "me"}})


@app.post("/api/login")
def api_login():
    payload = request.get_json(silent=True) or {}
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", ""))

    if not email or not password:
        return jsonify({"ok": False, "error": "Email and password are required."}), 400

    with db_connect() as con:
        row = con.execute(
            "SELECT id, email, password_hash, state_json FROM users WHERE email = ?",
            (email,),
        ).fetchone()

    if not row or not check_password_hash(row["password_hash"], password):
        return jsonify({"ok": False, "error": "Invalid email or password."}), 401

    session["user_id"] = int(row["id"])
    try:
        state = json.loads(row["state_json"] or "{}")
    except Exception:
        state = {}

    return jsonify({"ok": True, "email": row["email"], "state": state})


@app.post("/api/logout")
def api_logout():
    session.pop("user_id", None)
    return jsonify({"ok": True})


@app.get("/api/me")
def api_me():
    user = get_current_user()
    if not user:
        return jsonify({"authenticated": False})
    return jsonify(
        {
            "authenticated": True,
            "email": user["email"],
            "state": user.get("state", {}),
            "public_slug": user.get("public_slug", ""),
            "is_public": bool(user.get("is_public")),
        }
    )


@app.post("/api/me/public")
def api_me_public_toggle():
    user = get_current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not authenticated."}), 401

    payload = request.get_json(silent=True) or {}
    is_public = 1 if bool(payload.get("is_public")) else 0

    with db_connect() as con:
        con.execute("UPDATE users SET is_public = ? WHERE id = ?", (is_public, int(user["id"])))
        con.commit()

    return jsonify({"ok": True, "is_public": bool(is_public), "public_slug": user.get("public_slug", "")})


@app.post("/api/me/state")
def api_me_state():
    user = get_current_user()
    if not user:
        return jsonify({"ok": False, "error": "Not authenticated."}), 401

    payload = request.get_json(silent=True) or {}
    state = dict(user.get("state", {}))

    fam = payload.get("family_id")
    if fam:
        state["family_id"] = str(fam)

    set_user_state(int(user["id"]), state)
    return jsonify({"ok": True, "state": state})


# -----------------------------
# DEMO SAMPLES API
# -----------------------------
@app.get("/api/samples")
def api_samples():
    """
    Used by the demo-family dropdown.
    """
    return jsonify({"samples": list_sample_ids(), "default": DEFAULT_SAMPLE_ID})


# -----------------------------
# TREE DATA API
# -----------------------------
@app.get("/api/tree/<name>")
def api_tree(name: str):
    path = family_path(name)
    if not path.exists():
        return jsonify({"error": "not found", "expected_file": str(path)}), 404
    return jsonify(load_family_file(path))


@app.get("/api/tree/me")
def api_tree_me():
    uid = get_session_uid()

    if uid is not None:
        path = user_family_file(uid)
        if path.exists():
            return jsonify(load_family_file(path))

    # Not logged in or missing file -> demo sample dataset (session/query controlled)
    demo = get_demo_sample_id()
    return jsonify(load_sample_tree(demo))


@app.get("/api/public/<slug>/tree")
def api_public_tree(slug: str):
    fam = load_public_family_by_slug(slug)
    if fam is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(fam)


@app.get("/api/sample/<sample_id>/tree")
def api_sample_tree(sample_id: str):
    sample_id = (sample_id or "").strip().lower()
    if sample_id not in set(list_sample_ids()):
        abort(404, description="Sample not found.")
    return jsonify(load_sample_tree(sample_id))


# -----------------------------
# LOCAL RUN
# -----------------------------
if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)