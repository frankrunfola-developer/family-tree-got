# LineAgeMap demo refresh

This package includes:

- a dynamic family tree page generated from JSON people + relationships
- raised parchment-style connectors
- shorter person cards with tighter portrait framing
- a login screen
- a logged-in workspace for adding people and relationships
- JSON persistence for user tree data in `data/user_families/<username>.json`

## Demo login

- username: `frank`
- password: `demo123`

## Run

```bash
pip install -r requirements.txt
python app.py
```

## Key files

- `app.py` - routes, JSON persistence, tree layout builder
- `templates/login.html` - login screen
- `templates/dashboard.html` - user workspace for adding nodes/relationships
- `templates/tree.html` - full dynamic tree page
- `templates/_tree_canvas.html` - reusable tree renderer
- `data/kennedy.json` - sample tree data
- `data/users.json` - demo login account
- `data/user_families/frank.json` - created on first login

## Notes

- Tree placement is generated from parent/child and spouse relationships in JSON.
- New people and new relationships added in the workspace are written back to JSON.
- Portraits use `object-fit: cover` so images sit cleanly in the card frame.
- Connector styling is purely CSS and uses the parchment texture already included in the project.
