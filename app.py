from __future__ import annotations

################################################################
# RENDER HOSTING
#   - Persistent disk directory (Render sets DATA_DIR)
#---------------------------------------------------------------
import os

DATA_DIR = os.environ.get("DATA_DIR", "data")
os.makedirs(DATA_DIR, exist_ok=True)
################################################################

import json
import sqlite3
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict

from flask import Flask, jsonify, render_template, request, session, abort, redirect, url_for
from werkzeug.security import check_password_hash, generate_password_hash

APP_DIR = Path(__file__).parent

# Convert DATA_DIR (string) to a Path and make it absolute relative to the app folder if needed
DATA_DIR = Path(DATA_DIR)
if not DATA_DIR.is_absolute():
    DATA_DIR = APP_DIR / DATA_DIR
DATA_DIR.mkdir(parents=True, exist_ok=True)

app = Flask(
    __name__,
    template_folder=str(APP_DIR / "templates"),
    static_folder=str(APP_DIR / "static"),
)

# Session secret (set LINEAGEMAP_SECRET in production)
app.secret_key = os.environ.get("LINEAGEMAP_SECRET", "dev-secret-change-me")


#####################
# AUTH + USER STATE
#####################


def users_db_path() -> Path:
    return Path(DATA_DIR) / "users.db"


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
        con.commit()


def families_dir() -> Path:
    d = Path(DATA_DIR) / "families"
    d.mkdir(parents=True, exist_ok=True)
    return d


def user_family_file(uid: int) -> Path:
    # Each user owns a deterministic file.
    # Stored under the persistent DATA_DIR so it survives deploys.
    d = families_dir() / str(uid)
    d.mkdir(parents=True, exist_ok=True)
    return d / "family.json"


def slugify(s: str) -> str:
    s = (s or "").strip().lower()
    out = []
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


def get_current_user() -> dict | None:
    uid = session.get("user_id")
    if not uid:
        return None
    with db_connect() as con:
        row = con.execute(
            "SELECT id, email, family_file, public_slug, is_public, state_json FROM users WHERE id = ?",
            (uid,),
        ).fetchone()
    if not row:
        session.pop("user_id", None)
        return None
    state = {}
    try:
        state = json.loads(row["state_json"] or "{}")
    except Exception:
        state = {}
    return {
        "id": row["id"],
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


def family_path(name: str) -> Path:
    safe = "".join(c for c in name.lower() if c.isalnum() or c in ("-", "_"))
    return Path(DATA_DIR) / f"family_{safe}.json"


def load_user_family(uid: int) -> Dict[str, Any]:
    # If the user's file doesn't exist yet, fall back to GOT.
    path = user_family_file(uid)
    if path.exists():
        return load_family_file(path)
    return load_family_file(family_path("got"))


def load_public_family_by_slug(slug: str) -> Dict[str, Any] | None:
    db_init()
    with db_connect() as con:
        row = con.execute(
            "SELECT id, is_public FROM users WHERE public_slug = ?",
            (slugify(slug),),
        ).fetchone()
    if not row:
        return None
    if int(row["is_public"]) != 1:
        return None
    return load_user_family(int(row["id"]))


def load_family_file(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {"people": [], "relationships": []}
    return json.loads(path.read_text(encoding="utf-8"))


def starter_family_payload() -> Dict[str, Any]:
    """Create a minimal starter dataset for brand-new accounts.

    Two placeholder people, no relationships, blank names/photos.
    Frontend should render blanks using fallbacks (e.g., "Unnamed", placeholder avatar).
    """
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


#####################
# AUTH HELPERS (GUI)
#####################


def authenticate_user(email: str, password: str) -> dict | None:
    db_init()
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
    db_init()
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
            uid = int(cur.lastrowid)

            dst = user_family_file(uid)
            if not dst.exists():
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_text(json.dumps(starter_family_payload(), indent=2), encoding="utf-8")

            con.execute("UPDATE users SET family_file = ? WHERE id = ?", (str(dst), uid))
            con.commit()

        return uid
    except sqlite3.IntegrityError:
        raise ValueError("That email is already registered.")


@app.get("/")
def index():
    # Home / Landing page
    db_init()

    # Landing previews use GOT as the demo data.
    got = load_family_file(family_path("got"))

    # Tree preview (Eddard + Catelyn and their children)
    people_by_id = {str(p.get("id")): p for p in (got.get("people") or [])}
    rels = got.get("relationships") or []
    parents = ["eddard", "catelyn"]

    parents_children: dict[str, set[str]] = {pid: set() for pid in parents}
    for r in rels:
        parent = r.get("parentId") or r.get("parent") or r.get("sourceId") or r.get("source")
        child = r.get("childId") or r.get("child") or r.get("targetId") or r.get("target")
        if not parent or not child:
            continue
        parent = str(parent)
        child = str(child)
        if parent in parents_children:
            parents_children[parent].add(child)

    common_children = sorted(list(parents_children.get("eddard", set()) & parents_children.get("catelyn", set())))
    # Keep preview tight
    common_children = common_children[:8]

    tree_preview = {
        "parents": [people_by_id.get(pid) for pid in parents if pid in people_by_id],
        "children": [people_by_id.get(cid) for cid in common_children if cid in people_by_id],
    }

    # Timeline preview (pick a handful of people with photos)
    timeline_people = [p for p in (got.get("people") or []) if p.get("photo")]

    # Prefer Starks first, then fall back.
    def is_stark(p: dict) -> int:
        return 0 if "stark" in str(p.get("name", "")).lower() else 1

    timeline_people.sort(key=lambda p: (is_stark(p), str(p.get("name", ""))))
    timeline_preview = timeline_people[:5]

    user = get_current_user()
    return render_template(
        "index.html",
        current_user=user,
        tree_preview=tree_preview,
        timeline_preview=timeline_preview,
    )


@app.get("/f/<slug>")
def public_family(slug: str):
    """Public, shareable family page.

    Keeps the same look/feel as the app, but loads data from the owner's
    per-user family.json via /api/public/<slug>/tree.
    """
    db_init()
    safe_slug = slugify(slug)
    fam = load_public_family_by_slug(safe_slug)
    if fam is None:
        abort(404)

    # Lightweight previews (reuse home visuals)
    people = fam.get("people") or []
    rels = fam.get("relationships") or []

    child_ids = set()
    for r in rels:
        child = r.get("childId") or r.get("child") or r.get("targetId") or r.get("target")
        if child:
            child_ids.add(str(child))
    roots = [p for p in people if str(p.get("id")) not in child_ids]
    roots = roots[:2] if roots else people[:2]
    tree_preview = {"parents": roots, "children": []}

    timeline_people = [p for p in people if p.get("photo")][:5]

    return render_template(
        "public_family.html",
        current_user=get_current_user(),
        public_slug=safe_slug,
        family_name=(fam.get("meta") or {}).get("family_name") or "Family",
        tree_preview=tree_preview,
        timeline_preview=timeline_people,
    )


@app.get("/tree")
def tree_view():
    public_slug = request.args.get("public")
    sample_id = request.args.get("sample")
    sample_id = (sample_id or "").strip().lower() or None
    return render_template(
        "tree.html",
        current_user=get_current_user(),
        public_slug=slugify(public_slug) if public_slug else None,
        sample_id=sample_id,
    )


@app.get("/timeline")
def timeline_view():
    public_slug = request.args.get("public")
    sample_id = request.args.get("sample")
    sample_id = (sample_id or "").strip().lower() or None
    return render_template(
        "timeline.html",
        current_user=get_current_user(),
        public_slug=slugify(public_slug) if public_slug else None,
        sample_id=sample_id,
    )


@app.get("/map")
def map_view():
    public_slug = request.args.get("public")
    sample_id = request.args.get("sample")
    sample_id = (sample_id or "").strip().lower() or None
    return render_template(
        "map.html",
        current_user=get_current_user(),
        public_slug=slugify(public_slug) if public_slug else None,
        sample_id=sample_id,
    )




#####################
# AUTH PAGES
#####################


@app.get("/login")
def login():
    return render_template("login.html", error=None, current_user=get_current_user())


@app.post("/login")
def login_post():
    email = request.form.get("email", "").strip().lower()
    password = request.form.get("password", "")

    user = authenticate_user(email, password)
    if not user:
        return render_template("login.html", error="Invalid email or password.", current_user=get_current_user())

    session["user_id"] = user["id"]
    return redirect(url_for("tree_view"))


@app.get("/register")
def register():
    return render_template("register.html", error=None, current_user=get_current_user())


@app.post("/register")
def register_post():
    email = request.form.get("email", "").strip().lower()
    password = request.form.get("password", "")
    try:
        uid = create_user(email, password)
    except ValueError as e:
        return render_template("register.html", error=str(e), current_user=get_current_user())

    session["user_id"] = uid
    return redirect(url_for("tree_view"))


@app.get("/logout")
def logout():
    session.pop("user_id", None)
    return redirect(url_for("index"))


#####################
# AUTH API
#####################


@app.post("/api/register")
def api_register():
    db_init()
    payload = request.get_json(silent=True) or {}
    email = str(payload.get("email", "")).strip().lower()
    password = str(payload.get("password", ""))

    if not email or "@" not in email or len(email) > 254:
        return jsonify({"ok": False, "error": "Please enter a valid email."}), 400
    if not password or len(password) < 8:
        return jsonify({"ok": False, "error": "Password must be at least 8 characters."}), 400

    pw_hash = generate_password_hash(password)
    # In "real" mode, logged-in views should load from the user's owned family.json
    default_state = {"family_id": "me"}

    try:
        with db_connect() as con:
            base_slug = email.split("@", 1)[0]
            pub_slug = unique_public_slug(con, base_slug)

            cur = con.execute(
                "INSERT INTO users (email, password_hash, public_slug, state_json) VALUES (?, ?, ?, ?)",
                (email, pw_hash, pub_slug, json.dumps(default_state)),
            )
            uid = int(cur.lastrowid)

            # Create per-user family.json with a minimal starter dataset (2 blank nodes).
            dst = user_family_file(uid)
            if not dst.exists():
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_text(json.dumps(starter_family_payload(), indent=2), encoding="utf-8")

            con.execute("UPDATE users SET family_file = ? WHERE id = ?", (str(dst), uid))
            con.commit()
    except sqlite3.IntegrityError:
        return jsonify({"ok": False, "error": "That email is already registered."}), 409

    session["user_id"] = uid
    return jsonify({"ok": True, "email": email, "state": default_state})


@app.post("/api/login")
def api_login():
    db_init()
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
    state = {}
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
    # For now we only persist the preferred family_id.
    fam = payload.get("family_id")
    if fam:
        state["family_id"] = str(fam)
    set_user_state(int(user["id"]), state)
    return jsonify({"ok": True, "state": state})


# Tree data endpoint (read-only)
@app.get("/api/tree/<name>")
def api_tree(name: str):
    path = family_path(name)
    if not path.exists():
        return jsonify({"error": "not found", "expected_file": str(path)}), 404
    return jsonify(load_family_file(path))


@app.get("/api/tree/me")
def api_tree_me():
    uid = session.get("user_id")
    if uid:
        path = user_family_file(uid)
        if path.exists():
            return jsonify(json.loads(path.read_text(encoding="utf-8")))
    # fallback if not logged in or missing file
    demo = family_path("got")
    return jsonify(json.loads(demo.read_text(encoding="utf-8")))

@app.get("/api/public/<slug>/tree")
def api_public_tree(slug: str):
    fam = load_public_family_by_slug(slug)
    if fam is None:
        return jsonify({"error": "not found"}), 404
    return jsonify(fam)


@app.get("/api/sample/<sample_id>/tree")
def api_sample_tree(sample_id: str):
    """Public: return a built-in sample dataset."""
    allowed = {"got", "gupta", "kennedy"}
    sid = (sample_id or "").strip().lower()
    if sid not in allowed:
        return jsonify({"ok": False, "error": "Unknown sample."}), 404
    path = family_path(sid)
    return jsonify(load_family_file(path))


#####################
# LOCAL RUN
#####################
if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=True)
