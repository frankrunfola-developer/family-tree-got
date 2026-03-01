# LineAgeMap (Flask)

A lightweight **Flask** app with a sepia/paper aesthetic that showcases:
- **Landing page** with **Login / Register** + demo previews
- **Family Tree** (SVG + pan/zoom)
- **Family Timeline**
- **Family Map** (world map pins + country/state/city accordion)
- **User accounts** with **saved state** (SQLite on a persistent disk)
- **Per-user family data** (each account owns its own `family.json`)
- Optional **public share link** (`/f/<public_slug>`) for growth/virality

---

## Run locally

### Windows (PowerShell)
```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python app.py
```

### macOS / Linux / WSL
```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
python app.py
```

Open: http://127.0.0.1:5000

---

## Data files

### Demo families (shared)

Family JSON demo files live in your data directory and follow this convention:

- `family_got.json`  → loads at `/api/tree/got`
- `family_gupta.json` → loads at `/api/tree/gupta`

### Real product mode (per-user)

When a user registers, the app creates a private file on the persistent disk:

`<DATA_DIR>/families/<user_id>/family.json`

This file is seeded by copying `family_got.json` (as a starter).

Authenticated pages load data from:

`GET /api/tree/me`

So "my account = my data" is deterministic.

---

## User accounts + saved state

User accounts are stored in SQLite at:

- `<DATA_DIR>/users.db`

Each user row includes:

- `family_file` → path to the owned file (e.g., `<DATA_DIR>/families/42/family.json`)
- `public_slug` → share slug (e.g., `frank`)
- `is_public` → 0/1 toggle
- `state_json` → small UI preferences (keep it lightweight)

### Key endpoints

- `POST /api/register` `{email, password}` → creates user + logs in
- `POST /api/login` `{email, password}` → logs in
- `POST /api/logout` → logs out
- `GET /api/me` → current auth + state
- `POST /api/me/state` `{family_id}` → saves preferred family

### Per-user family + public sharing

- `GET /api/tree/me` → loads the logged-in user's owned `family.json`
- `POST /api/me/public` `{is_public:true|false}` → enables/disables public sharing
- `GET /api/public/<slug>/tree` → public read-only family JSON (only when enabled)
- `GET /f/<slug>` → public landing page for that family

---

SQLite
1. Install package

```bash
sudo apt update
sudo apt install sqlite3
which sqlite3
sqlite3 --version

cd data
sqlite3 users.db
```

2. Query Data
```bash
.tables
SELECT * FROM users;
DELETE FROM users WHERE id=1;
DELETE FROM users;   -- wipe all rows
.quit
```
---

## How to link a specific login to a specific saved JSON family file

This build supports the **real product** model:

- Each user account owns a private file at: `<DATA_DIR>/families/<user_id>/family.json`
- Authenticated pages load that file via: `GET /api/tree/me`

That makes the link **deterministic**: *the login account is the data owner*.

### Seeding new users
On registration, the app seeds the user's private file by copying the demo GOT file:

- `data/family_got.json` → `<DATA_DIR>/families/<user_id>/family.json`

You can change the seed source in `app.py` if you want Gupta or an empty starter instead.

### Optional: keep "demo families" for marketing
Demo JSON files are still available for public/demo pages:

- `/api/tree/got`
- `/api/tree/gupta`

But authenticated pages should use `/api/tree/me` so user data is never shared.

### Public sharing (growth)
Users can optionally share a read-only public page:

- Toggle public: `POST /api/me/public` with `{ "is_public": true }`
- Public page: `/f/<public_slug>`
- Public JSON: `/api/public/<slug>/tree`

---

## Notes on the UI changes in this build

- **Navbar** is standardized across pages (icon + “LineAgeMap” centered).
- **Menu button** spacing is fixed (hamburger + “Menu” label).
- **Tree page** starts in a **condensed view** for readability, with a **“See more”** button to expand.
- Landing hero typography is slightly smaller and has more vertical breathing room (and scales on mobile).
- **Map page**:
  - Desktop shows a **World** overview with all pins + a readable list of people.
  - Country sections include a mobile-friendly grid of people (2+ per row).

---

## Render hosting (persistent disk)

`DATA_DIR` controls where JSON files and the SQLite DB live.

Example on Render:
- Mount a persistent disk
- Set `DATA_DIR=/var/data` (or whatever mount path you configure)

Local example (bash):
```bash
export DATA_DIR=/var/data
```

Local example (PowerShell):
```powershell
$env:DATA_DIR="C:\lineagemap-data"
```

---

## Project structure

```text
lineagemap/
├─ app.py
├─ requirements.txt
├─ README.md
├─ data/                      # default local data dir (if DATA_DIR not set)
│  ├─ family_got.json
│  └─ family_gupta.json
├─ templates/
│  ├─ index.html              # landing page (auth + previews)
│  ├─ tree.html
│  ├─ map.html
│  ├─ timeline.html
│  └─ _topbar.html            # shared navbar
└─ static/
   ├─ css/
   │  ├─ styles.css
   │  ├─ home-extra.css
   │  ├─ map-accordion.css
   │  └─ timeline.css
   ├─ js/
   │  ├─ nav.js
   │  ├─ tree.js
   │  ├─ timeline.js
   │  └─ map-accordion.js
   └─ img/
      ├─ favicon.ico
      ├─ world.png
      └─ placeholder-avatar.png
```


## Delete .Identiier files

```bash
find . -type f -name '*\.Identifier'
```