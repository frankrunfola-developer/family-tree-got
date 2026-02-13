# LineAgeMap (Flask + SVG Family Tree Demo)

A lightweight **Flask** app that renders a **clean, map-like family tree** (zoom + pan) using an SVG renderer.

This build is intentionally simple:
- **No upload UI**
- **No in-browser JSON editor**
- Read-only tree data served from disk via **`/api/tree/<name>`**

---

## Quickstart

### Windows (PowerShell)
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python app.py
```

### Bash / Git Bash / WSL / macOS / Linux
```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
python app.py
```

Open: http://127.0.0.1:5000

---

## Data files (what loads the tree)

Tree JSON lives in `data/` and follows this naming convention:

- `data/family_gupta.json`  → loads at `/api/tree/gupta`
- `data/family_got.json`    → loads at `/api/tree/got`

The default demo tree name is set in `static/js/tree.js`:

```js
initTree("gupta");
```

---

## Render hosting (persistent disk)

`app.py` reads `DATA_DIR` from the environment:

- If `DATA_DIR` is set (recommended on Render with a mounted disk), data is read from there.
- If not set, it defaults to a local `data/` folder.

Example (bash):
```bash
export DATA_DIR=/var/data
```

Example (PowerShell):
```powershell
$env:DATA_DIR="C:\lineagemap-data"
```

---

## File structure (with comments)

```text
lineagemap/
├─ app.py                    # Flask server (serves index + /api/tree/<name>)
├─ requirements.txt          # Python deps
├─ README.md                 # This file
│
├─ data/
│  ├─ family_gupta.json      # Demo tree (Gupta)
│  └─ family_got.json        # Demo tree (Game of Thrones)
│
├─ templates/
│  └─ index.html             # Clean landing page + SVG canvas
│
└─ static/
   ├─ css/
   │  └─ styles.css          # Nostalgic, clean theme
   ├─ js/
   │  ├─ tree.js             # Loads JSON + layout + pan/zoom
   │  ├─ familyTree.js       # SVG renderer (cards, links, labels)
   │  └─ treeConfig.js       # Shared config constants
   └─ uploads/
      ├─ gupta/              # Example images (optional; referenced by photoUrl)
      │  ├─ Indrajit.png      # example
      │  ├─ adalina.png       # example
      │  └─ atreyee.png       # example
      ├─ lannister/
      │  ├─ cersei.png        # example
      │  ├─ jaime.png         # example
      │  └─ joffrey.png       # example
      └─ stark/
         ├─ arya.png          # example
         ├─ bran.png          # example
         └─ eddard.png        # example
```

Notes:
- Image files are optional. If a person node has `photoUrl`, the renderer shows it.
- If no `photoUrl` is present, the node shows a subtle placeholder circle.

---

## API

- `GET /` → landing page
- `GET /api/tree/<name>` → returns `DATA_DIR/family_<name>.json`

