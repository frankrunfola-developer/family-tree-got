# LineAgeMap

This version moves authenticated user data off JSON files and onto SQLAlchemy models backed by PostgreSQL.

## Stack

- Flask
- Render Web Service
- Render Postgres
- SQLAlchemy
- Flask-Migrate

## Registration flow

- No baked-in starter user
- `/register` creates the account
- `User name` becomes the profile name
- The same `User name` is seeded as the first root node in the tree
- The root node also gets one default map location so it renders immediately

## Local setup

```bash
pip install -r requirements.txt
cp .env.example .env
```

## Run locally

```bash
python app.py
```

## Database migrations

```bash
export FLASK_APP=app.py
flask db init
flask db migrate -m "initial schema"
flask db upgrade
```

On Windows PowerShell:

```powershell
$env:FLASK_APP = "app.py"
flask db init
flask db migrate -m "initial schema"
flask db upgrade
```

## Render setup

Create these on Render:

- Web Service for the Flask app
- Postgres database

Set environment variables on the web service:

- `SECRET_KEY`
- `DATABASE_URL`
- `MAPBOX_TOKEN` if you use it

Start command:

```bash
gunicorn app:app
```

Build command:

```bash
pip install -r requirements.txt
```

After the database is attached, run migrations during deploy or from a Render shell:

```bash
flask db upgrade
```
