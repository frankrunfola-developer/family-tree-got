from __future__ import annotations

import json
import os
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from flask import Flask, flash, redirect, render_template, request, session, url_for
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import or_
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename
from dotenv import load_dotenv
load_dotenv()

try:
    from config import MAPBOX_PUBLIC_TOKEN
except Exception:
    MAPBOX_PUBLIC_TOKEN = ''

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / 'data'
SAMPLES_DIR = DATA_DIR / 'samples'
DEFAULT_PROFILE_PHOTO = '/static/img/placeholder-avatar.png'
DEFAULT_SEED_LOCATION = {
    'label': 'New York, New York, USA',
    'lat': 40.7128,
    'lng': -74.0060,
}


def _database_uri() -> str:
    raw = os.getenv("DATABASE_URL", "").strip()
    if raw.startswith("postgres://"):
        raw = raw.replace("postgres://", "postgresql+psycopg2://", 1)
    elif raw.startswith("postgresql://"):
        raw = raw.replace("postgresql://", "postgresql+psycopg2://", 1)
    if not raw:
        raise RuntimeError("DATABASE_URL is not set")
    return raw

db_uri = _database_uri()

app = Flask(__name__)
app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'lineagemap-dev-secret')
app.config['SQLALCHEMY_DATABASE_URI'] = db_uri
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

if db_uri.startswith("postgresql"):
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
        "pool_pre_ping": True
    }
else:
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {}

instance_dir = BASE_DIR / 'instance'
instance_dir.mkdir(parents=True, exist_ok=True)

UPLOAD_ROOT = BASE_DIR / 'static' / 'uploads'
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

db = SQLAlchemy(app)
migrate = Migrate(app, db)


class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False, index=True)
    display_name = db.Column(db.String(120), nullable=False)
    password_hash = db.Column(db.String(255), nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    family_profile = db.relationship(
        'FamilyProfile',
        back_populates='user',
        uselist=False,
        cascade='all, delete-orphan',
    )


class FamilyProfile(db.Model):
    __tablename__ = 'family_profiles'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, unique=True)
    family_slug = db.Column(db.String(120), nullable=False, unique=True, index=True)
    family_name = db.Column(db.String(160), nullable=False)
    profile_name = db.Column(db.String(120), nullable=False)
    profile_photo = db.Column(db.String(255), nullable=False, default=DEFAULT_PROFILE_PHOTO)
    description = db.Column(db.Text, nullable=False, default='Your family archive starts with a single root person. Add relatives, relationships, and migration stops as your story grows.')
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    user = db.relationship('User', back_populates='family_profile')
    people = db.relationship(
        'Person',
        back_populates='family',
        cascade='all, delete-orphan',
        order_by='Person.id',
    )
    relationships = db.relationship(
        'FamilyRelationship',
        back_populates='family',
        cascade='all, delete-orphan',
        order_by='FamilyRelationship.id',
    )


class Person(db.Model):
    __tablename__ = 'people'

    id = db.Column(db.Integer, primary_key=True)
    family_id = db.Column(db.Integer, db.ForeignKey('family_profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    public_id = db.Column(db.String(120), nullable=False, unique=True, index=True)
    name = db.Column(db.String(160), nullable=False)
    born = db.Column(db.String(32), nullable=False, default='')
    died = db.Column(db.String(32), nullable=False, default='')
    photo = db.Column(db.String(255), nullable=False, default=DEFAULT_PROFILE_PHOTO)
    current_location_label = db.Column(db.String(255), nullable=False, default='')
    current_location_lat = db.Column(db.Float)
    current_location_lng = db.Column(db.Float)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    family = db.relationship('FamilyProfile', back_populates='people')
    migrations = db.relationship(
        'PersonMigration',
        back_populates='person',
        cascade='all, delete-orphan',
        order_by='PersonMigration.position',
    )


class PersonMigration(db.Model):
    __tablename__ = 'person_migrations'

    id = db.Column(db.Integer, primary_key=True)
    person_id = db.Column(db.Integer, db.ForeignKey('people.id', ondelete='CASCADE'), nullable=False, index=True)
    position = db.Column(db.Integer, nullable=False, default=0)
    label = db.Column(db.String(255), nullable=False)
    lat = db.Column(db.Float)
    lng = db.Column(db.Float)

    person = db.relationship('Person', back_populates='migrations')


class FamilyRelationship(db.Model):
    __tablename__ = 'family_relationships'

    id = db.Column(db.Integer, primary_key=True)
    family_id = db.Column(db.Integer, db.ForeignKey('family_profiles.id', ondelete='CASCADE'), nullable=False, index=True)
    relationship_type = db.Column(db.String(40), nullable=False, index=True)
    person_a_id = db.Column(db.Integer, db.ForeignKey('people.id', ondelete='CASCADE'), nullable=False)
    person_b_id = db.Column(db.Integer, db.ForeignKey('people.id', ondelete='CASCADE'), nullable=False)

    family = db.relationship('FamilyProfile', back_populates='relationships')
    person_a = db.relationship('Person', foreign_keys=[person_a_id])
    person_b = db.relationship('Person', foreign_keys=[person_b_id])


@app.before_request
def ensure_database_ready():
    if app.config.get('_db_bootstrapped'):
        return
    db.create_all()
    app.config['_db_bootstrapped'] = True


def load_json(path: Path, default=None):
    if not path.exists():
        return {} if default is None else default
    with path.open('r', encoding='utf-8') as f:
        return json.load(f)


def slugify(value: str) -> str:
    cleaned = re.sub(r'[^a-zA-Z0-9]+', '_', value.strip().lower())
    return cleaned.strip('_') or f'person_{uuid4().hex[:6]}'


def sample_family_ids() -> list[str]:
    ids: list[str] = []
    if not SAMPLES_DIR.exists():
        return ids
    for path in sorted(SAMPLES_DIR.glob('*.json')):
        payload = load_json(path, default={})
        if isinstance(payload, dict) and all(key in payload for key in ('people', 'relationships', 'events')):
            ids.append(path.stem)
    return ids


def selected_family_id() -> str:
    requested = (request.args.get('family') or '').strip().lower()
    options = sample_family_ids()
    fallback = 'johnson' if 'johnson' in options else (options[0] if options else 'kennedy')
    if requested and requested in options:
        session['selected_family'] = requested
        return requested
    stored = (session.get('selected_family') or '').strip().lower()
    if stored in options:
        return stored
    session['selected_family'] = fallback
    return fallback


def sample_family_label(sample_id: str) -> str:
    payload = load_json(SAMPLES_DIR / f'{sample_id}.json', default={})
    return payload.get('meta', {}).get('family_name') or sample_id.replace('_', ' ').title()


def load_sample_family(sample_id: str | None = None) -> dict:
    sid = sample_id or selected_family_id()
    return load_json(SAMPLES_DIR / f'{sid}.json', default={})


def _num(value, default=0.0):
    try:
        return float(value)
    except Exception:
        return float(default)


def _normalize_photo_path(raw: str | None, family_id: str | None = None) -> str:
    value = str(raw or '').strip()
    if not value:
        return DEFAULT_PROFILE_PHOTO
    if value.endswith('/you.jpg'):
        return DEFAULT_PROFILE_PHOTO
    if value.startswith('/static/uploads/'):
        return value
    if value.startswith('static/uploads/'):
        return '/' + value.lstrip('/')
    if value.startswith('/static/img/placeholder-avatar.png'):
        return value
    if value.startswith('static/img/placeholder-avatar.png'):
        return '/' + value.lstrip('/')
    if value.startswith('/static/img/'):
        basename = Path(value).name
        if family_id:
            candidate = BASE_DIR / 'static' / 'uploads' / family_id / basename
            if candidate.exists():
                return f'/static/uploads/{family_id}/{basename}'
        return DEFAULT_PROFILE_PHOTO
    if value.startswith('/uploads/'):
        return '/static' + value
    if value.startswith('uploads/'):
        return '/static/' + value
    basename = Path(value).name
    if family_id:
        candidate = BASE_DIR / 'static' / 'uploads' / family_id / basename
        if candidate.exists():
            return f'/static/uploads/{family_id}/{basename}'
    return DEFAULT_PROFILE_PHOTO


def format_place(location: dict | None) -> str:
    if not isinstance(location, dict):
        return ''
    parts = [location.get('city'), location.get('region'), location.get('country')]
    return ', '.join(part for part in parts if part)


def canonical_location(location: dict | None) -> dict | None:
    if not isinstance(location, dict):
        return None
    lng = location.get('lng', location.get('lon'))
    lat = location.get('lat')
    out = {
        'city': location.get('city', ''),
        'region': location.get('region', ''),
        'country': location.get('country', ''),
        'lat': lat,
        'lng': lng,
        'label': location.get('label') or format_place(location),
    }
    if out['lat'] in (None, '') or out['lng'] in (None, ''):
        return None
    return out


def current_user() -> User | None:
    username = session.get('username')
    if not username:
        return None
    return User.query.filter_by(username=username).first()


def get_user(username: str) -> User | None:
    return User.query.filter_by(username=username).first()


def _build_seed_person(user: User, family: FamilyProfile) -> Person:
    root_public_id = slugify(f'{user.username}_root')
    person = Person(
        family=family,
        public_id=root_public_id,
        name=family.profile_name,
        born='',
        died='',
        photo=DEFAULT_PROFILE_PHOTO,
        current_location_label=DEFAULT_SEED_LOCATION['label'],
        current_location_lat=DEFAULT_SEED_LOCATION['lat'],
        current_location_lng=DEFAULT_SEED_LOCATION['lng'],
    )
    person.migrations.append(
        PersonMigration(
            position=0,
            label=DEFAULT_SEED_LOCATION['label'],
            lat=DEFAULT_SEED_LOCATION['lat'],
            lng=DEFAULT_SEED_LOCATION['lng'],
        )
    )
    return person


def ensure_user_family(username: str) -> dict:
    user = get_user(username)
    if not user:
        return {}
    family = user.family_profile
    if family is None:
        family = FamilyProfile(
            user=user,
            family_slug=username,
            family_name=f'{user.display_name} Family',
            profile_name=user.display_name,
            profile_photo=DEFAULT_PROFILE_PHOTO,
        )
        db.session.add(family)
        db.session.flush()
        db.session.add(_build_seed_person(user, family))
        db.session.commit()
    elif not family.people:
        db.session.add(_build_seed_person(user, family))
        db.session.commit()
    return family_to_payload(family)



def unique_person_public_id(base_text: str) -> str:
    base_id = slugify(base_text) or 'person'
    person_id = base_id
    counter = 2
    while db.session.query(Person.id).filter_by(public_id=person_id).first() is not None:
        person_id = f'{base_id}_{counter}'
        counter += 1
    return person_id


def family_profile_for_user(username: str) -> FamilyProfile | None:
    user = get_user(username)
    if not user:
        return None
    if user.family_profile is None or not user.family_profile.people:
        ensure_user_family(username)
        db.session.expire_all()
        user = get_user(username)
    return user.family_profile if user else None


def person_location_payload(person: Person) -> dict:
    label = str(person.current_location_label or '').strip()
    if not label:
        return {}
    payload = {'label': label}
    if person.current_location_lat is not None:
        payload['lat'] = person.current_location_lat
    if person.current_location_lng is not None:
        payload['lng'] = person.current_location_lng
    return payload


def parse_migration_entries(raw_value) -> list[dict]:
    if isinstance(raw_value, list):
        lines = raw_value
    else:
        lines = str(raw_value or '').splitlines()

    entries: list[dict] = []
    for raw_line in lines:
        line = str(raw_line or '').strip()
        if not line:
            continue
        label_part, sep, coords_part = line.partition('|')
        label = label_part.strip() or line
        lat = None
        lng = None
        if sep and coords_part.strip():
            coords_text = coords_part.strip().replace(';', ',')
            if ',' in coords_text:
                maybe_lat, maybe_lng = [part.strip() for part in coords_text.split(',', 1)]
                try:
                    lat = float(maybe_lat)
                    lng = float(maybe_lng)
                except Exception:
                    lat = None
                    lng = None
        entry = {'label': label}
        if lat is not None:
            entry['lat'] = lat
        if lng is not None:
            entry['lng'] = lng
        entries.append(entry)
    return entries


def apply_person_migrations(person: Person, raw_value) -> None:
    entries = parse_migration_entries(raw_value)
    person.migrations.clear()
    for idx, entry in enumerate(entries):
        person.migrations.append(
            PersonMigration(
                position=idx,
                label=entry['label'],
                lat=entry.get('lat'),
                lng=entry.get('lng'),
            )
        )

    if entries:
        last_entry = entries[-1]
        person.current_location_label = last_entry.get('label', '')
        person.current_location_lat = last_entry.get('lat')
        person.current_location_lng = last_entry.get('lng')
    elif not str(person.current_location_label or '').strip():
        person.current_location_label = ''
        person.current_location_lat = None
        person.current_location_lng = None


def family_to_payload(family: FamilyProfile | None) -> dict:
    if family is None:
        return {'meta': {}, 'people': [], 'relationships': [], 'events': []}

    people_payload = []
    for person in family.people:
        migrations = []
        for migration in person.migrations:
            entry = {'label': migration.label}
            if migration.lat is not None:
                entry['lat'] = migration.lat
            if migration.lng is not None:
                entry['lng'] = migration.lng
            migrations.append(entry)
        current_location = person_location_payload(person)
        if current_location and not migrations:
            migrations.append(dict(current_location))
        people_payload.append({
            'id': person.public_id,
            'name': person.name,
            'born': person.born,
            'died': person.died,
            'photo': _normalize_photo_path(person.photo, family.family_slug),
            'current_location': current_location,
            'migrations': migrations,
        })

    spouse_map: dict[str, set[str]] = defaultdict(set)
    parent_links: list[tuple[str, str]] = []
    for rel in family.relationships:
        a = rel.person_a.public_id if rel.person_a else ''
        b = rel.person_b.public_id if rel.person_b else ''
        if not a or not b or a == b:
            continue
        if rel.relationship_type == 'spouse':
            spouse_map[a].add(b)
            spouse_map[b].add(a)
        else:
            parent_links.append((a, b))

    relationships_payload = []
    for person_a, spouses in spouse_map.items():
        for person_b in spouses:
            if person_a < person_b:
                relationships_payload.append({'type': 'spouse', 'a': person_a, 'b': person_b})

    parents_by_child: dict[str, list[str]] = defaultdict(list)
    for parent_id, child_id in parent_links:
        if parent_id not in parents_by_child[child_id]:
            parents_by_child[child_id].append(parent_id)

    for child_id, parents in parents_by_child.items():
        resolved_parents = list(parents)
        if len(resolved_parents) == 1:
            only_parent = resolved_parents[0]
            spouse_candidates = sorted(spouse_map.get(only_parent, set()))
            if len(spouse_candidates) == 1:
                resolved_parents.append(spouse_candidates[0])

        primary_parent = resolved_parents[0]
        record = {'parent': primary_parent, 'child': child_id, 'parentId': primary_parent, 'childId': child_id}
        if len(resolved_parents) > 1:
            record['otherParentId'] = resolved_parents[1]
        relationships_payload.append(record)

    return {
        'meta': {
            'family_name': family.family_name,
            'owner_username': family.user.username,
            'profile_name': family.profile_name,
            'profile_photo': _normalize_photo_path(family.profile_photo, family.family_slug),
            'description': family.description,
            'family_id': family.family_slug,
        },
        'people': people_payload,
        'relationships': relationships_payload,
        'events': [],
    }

def locked_root_person_ids(data: dict) -> list[str]:
    people = [dict(p) for p in data.get('people', []) if p.get('id')]
    relationships = list(data.get('relationships', []))
    if not people:
        return []

    people_by_id = {str(p['id']): p for p in people}
    parent_map: dict[str, set[str]] = defaultdict(set)

    for rel in relationships:
        if not isinstance(rel, dict):
            continue
        if rel.get('type') == 'spouse':
            continue
        parent = str(rel.get('parentId') or rel.get('parent') or '')
        child = str(rel.get('childId') or rel.get('child') or '')
        if parent in people_by_id and child in people_by_id and parent != child:
            parent_map[child].add(parent)

    def sort_key(pid: str):
        person = people_by_id.get(pid, {})
        raw = str(person.get('born') or person.get('birth') or '').strip()
        try:
            born = int(raw)
        except Exception:
            born = 999999
        return (born, str(person.get('name', '')), pid)

    roots = sorted([pid for pid in people_by_id if not parent_map.get(pid)], key=sort_key)
    if not roots:
        roots = sorted(people_by_id.keys(), key=sort_key)
    return [roots[0]] if roots else []


def _normalize_family_photo_paths(data: dict, family_id: str | None = None) -> dict:
    for person in data.get('people', []):
        person['photo'] = _normalize_photo_path(person.get('photo') or person.get('image'), family_id)
    meta = data.get('meta', {})
    meta['profile_photo'] = _normalize_photo_path(meta.get('profile_photo'), family_id)
    return data


def normalize_tree_payload(data: dict, family_id: str | None = None) -> dict:
    data = _normalize_family_photo_paths(json.loads(json.dumps(data or {})), family_id)
    people = []
    for raw in data.get('people', []):
        if not raw.get('id'):
            continue
        person = dict(raw)
        person['id'] = str(person.get('id'))
        person['photo'] = _normalize_photo_path(person.get('photo') or person.get('image'), family_id)
        person['image'] = person['photo']
        people.append(person)

    locked_ids = set(locked_root_person_ids(data))
    for person in people:
        person['locked'] = str(person.get('id')) in locked_ids
        person['editable'] = not person['locked']

    relationships = []
    for rel in data.get('relationships', []):
        if not isinstance(rel, dict):
            continue
        if rel.get('type') == 'spouse':
            a = rel.get('a') or rel.get('person1') or rel.get('source') or rel.get('sourceId')
            b = rel.get('b') or rel.get('person2') or rel.get('target') or rel.get('targetId')
            if a and b and str(a) != str(b):
                relationships.append({'type': 'spouse', 'a': str(a), 'b': str(b)})
            continue

        parent = rel.get('parentId') or rel.get('parent') or rel.get('sourceId') or rel.get('source')
        child = rel.get('childId') or rel.get('child') or rel.get('targetId') or rel.get('target')
        other = rel.get('otherParentId') or rel.get('other_parent_id')
        if parent and child and str(parent) != str(child):
            nr = {'parentId': str(parent), 'childId': str(child), 'parent': str(parent), 'child': str(child)}
            if other:
                nr['otherParentId'] = str(other)
            relationships.append(nr)

    return {'meta': data.get('meta', {}), 'people': people, 'relationships': relationships, 'events': data.get('events', []), 'locked_ids': list(locked_ids)}


# Tree/map helper functions preserved so the frontend payloads stay stable.
def lineage_subset_to_root(data: dict, max_generations: int = 4) -> dict:
    people = [dict(p) for p in data.get('people', []) if p.get('id')]
    relationships = list(data.get('relationships', []))
    people_by_id = {str(p['id']): p for p in people}
    parent_map: dict[str, set[str]] = defaultdict(set)
    child_map: dict[str, set[str]] = defaultdict(set)
    spouse_map: dict[str, set[str]] = defaultdict(set)

    for rel in relationships:
        if not isinstance(rel, dict):
            continue
        if rel.get('type') == 'spouse':
            a = rel.get('a')
            b = rel.get('b')
            if a in people_by_id and b in people_by_id and a != b:
                spouse_map[str(a)].add(str(b))
                spouse_map[str(b)].add(str(a))
            continue
        parent = rel.get('parentId') or rel.get('parent')
        child = rel.get('childId') or rel.get('child')
        if parent in people_by_id and child in people_by_id and parent != child:
            parent_map[str(child)].add(str(parent))
            child_map[str(parent)].add(str(child))

    def born_key(pid: str):
        raw = str(people_by_id.get(pid, {}).get('born') or people_by_id.get(pid, {}).get('birth') or '').strip()
        try:
            return int(raw)
        except Exception:
            return -999999

    leaves = [pid for pid in people_by_id if not child_map.get(pid)]
    if not leaves:
        leaves = list(people_by_id.keys())
    current = sorted(leaves, key=lambda pid: (born_key(pid), people_by_id[pid].get('name', '')))[-1]

    included: list[str] = []
    included_set: set[str] = set()

    def include(pid: str | None):
        if pid and pid in people_by_id and pid not in included_set:
            included.append(pid)
            included_set.add(pid)

    def lineage_depth(pid: str, memo: dict[str, int]) -> int:
        if pid in memo:
            return memo[pid]
        parents = list(parent_map.get(pid, []))
        if not parents:
            memo[pid] = 0
            return 0
        memo[pid] = 1 + max(lineage_depth(parent, memo) for parent in parents)
        return memo[pid]

    depth_memo: dict[str, int] = {}
    generations_used = 0
    while current and generations_used < max_generations:
        include(current)
        parents = sorted(parent_map.get(current, []), key=lambda pid: (born_key(pid), people_by_id[pid].get('name', '')))
        for pid in parents:
            include(pid)
        generations_used += 1
        if not parents:
            break
        ranked = sorted(parents, key=lambda pid: (lineage_depth(pid, depth_memo), -born_key(pid), people_by_id[pid].get('name', '')), reverse=True)
        next_current = None
        for pid in ranked:
            if parent_map.get(pid):
                next_current = pid
                break
        if not next_current:
            break
        current = next_current

    filtered_relationships = []
    for rel in relationships:
        if rel.get('type') == 'spouse':
            if rel.get('a') in included_set and rel.get('b') in included_set:
                filtered_relationships.append(dict(rel))
        else:
            parent = rel.get('parentId') or rel.get('parent')
            child = rel.get('childId') or rel.get('child')
            if parent in included_set and child in included_set:
                filtered_relationships.append(dict(rel))

    return {**data, 'people': [people_by_id[pid] for pid in included if pid in people_by_id], 'relationships': filtered_relationships}


def family_stats(data: dict) -> dict:
    people = data.get('people', [])
    relationships = data.get('relationships', [])
    spouses = [r for r in relationships if r.get('type') == 'spouse']
    parent_links = [r for r in relationships if r.get('child') and r.get('parent')]

    generations = 0
    by_parents = defaultdict(set)
    for rel in parent_links:
        by_parents[rel['child']].add(rel['parent'])

    memo: dict[str, int] = {}

    def generation(person_id: str) -> int:
        if person_id in memo:
            return memo[person_id]
        parents = list(by_parents.get(person_id, set()))
        if not parents:
            memo[person_id] = 0
            return 0
        memo[person_id] = max(generation(parent_id) for parent_id in parents) + 1
        return memo[person_id]

    for person in people:
        generations = max(generations, generation(person['id']))

    return {
        'members': len(people),
        'relationships': len(parent_links),
        'couples': len(spouses),
        'generations': generations + 1 if people else 0,
    }


def build_tree_layout(data: dict) -> dict:
    people = data.get('people', [])
    relationships = data.get('relationships', [])
    people_by_id = {person['id']: person for person in people if person.get('id')}

    spouse_of: dict[str, str] = {}
    spouse_pairs: list[tuple[str, str]] = []
    parent_map: dict[str, set[str]] = defaultdict(set)
    child_map: dict[str, set[str]] = defaultdict(set)

    for rel in relationships:
        if rel.get('type') == 'spouse':
            a = rel.get('a')
            b = rel.get('b')
            if a in people_by_id and b in people_by_id and a != b:
                spouse_of[a] = b
                spouse_of[b] = a
                pair = tuple(sorted((a, b), key=lambda pid: str(people_by_id[pid].get('born', '9999'))))
                if pair not in spouse_pairs:
                    spouse_pairs.append(pair)
        elif rel.get('child') and rel.get('parent'):
            child = rel['child']
            parent = rel['parent']
            if child in people_by_id and parent in people_by_id and child != parent:
                parent_map[child].add(parent)
                child_map[parent].add(child)

    def born_sort(pid: str):
        raw = str(people_by_id[pid].get('born', '')).strip()
        try:
            born = int(raw) if raw else 999999
        except Exception:
            born = 999999
        return (born, people_by_id[pid].get('name', ''), pid)

    gen_memo: dict[str, int] = {}

    def generation(pid: str) -> int:
        if pid in gen_memo:
            return gen_memo[pid]
        parents = [p for p in parent_map.get(pid, set()) if p in people_by_id]
        if not parents:
            gen_memo[pid] = 0
            return 0
        gen_memo[pid] = max(generation(parent) for parent in parents) + 1
        return gen_memo[pid]

    gens: dict[int, list[str]] = defaultdict(list)
    for pid in people_by_id:
        gens[generation(pid)].append(pid)

    CARD_W = 126
    CARD_H = 194
    SPOUSE_GAP = 30
    UNIT_GAP = 52
    GEN_GAP = 116
    SIDE_PAD = 52
    TOP_PAD = 26

    pair_set = {frozenset((a, b)) for a, b in spouse_pairs}

    def parent_anchor(pid: str, centers: dict[str, float]) -> float:
        parents = sorted([p for p in parent_map.get(pid, set()) if p in centers], key=born_sort)
        if not parents:
            return 0.0
        return sum(centers[p] for p in parents) / len(parents)

    centers: dict[str, float] = {}
    people_out: list[dict] = []
    connectors: list[dict] = []
    max_row_width = 0.0

    for gen in sorted(gens):
        members = sorted(gens[gen], key=born_sort)
        units = []
        consumed = set()
        for pid in members:
            if pid in consumed:
                continue
            spouse = spouse_of.get(pid)
            if spouse and spouse in gens[gen] and spouse not in consumed and frozenset((pid, spouse)) in pair_set:
                ordered = sorted((pid, spouse), key=born_sort)
                anchor = sum(parent_anchor(x, centers) for x in ordered) / 2 if gen > 0 else 0.0
                units.append({'kind': 'pair', 'members': ordered, 'width': CARD_W * 2 + SPOUSE_GAP, 'anchor': anchor, 'born': min(born_sort(x) for x in ordered)})
                consumed.update(ordered)
            else:
                anchor = parent_anchor(pid, centers) if gen > 0 else 0.0
                units.append({'kind': 'single', 'members': [pid], 'width': CARD_W, 'anchor': anchor, 'born': born_sort(pid)})
                consumed.add(pid)

        if gen == 0:
            units.sort(key=lambda item: item['born'])
        else:
            units.sort(key=lambda item: (item['anchor'], item['born']))

        row_width = sum(item['width'] for item in units) + UNIT_GAP * max(0, len(units) - 1)
        max_row_width = max(max_row_width, row_width)
        canvas_width = max(760, int(max_row_width + SIDE_PAD * 2))
        y = TOP_PAD + gen * (CARD_H + GEN_GAP)
        cursor = (canvas_width - row_width) / 2
        for item in units:
            if item['kind'] == 'pair':
                pid1, pid2 = item['members']
                x1 = cursor
                x2 = cursor + CARD_W + SPOUSE_GAP
                pair_mid_y = y + 76
                connectors.append({'x1': round(x1 + CARD_W / 2, 1), 'y1': round(pair_mid_y, 1), 'x2': round(x2 + CARD_W / 2, 1), 'y2': round(pair_mid_y, 1)})
                placements = [(pid1, x1), (pid2, x2)]
            else:
                placements = [(item['members'][0], cursor)]

            for pid, x in placements:
                centers[pid] = x + CARD_W / 2
                person = people_by_id[pid]
                years = f"{person.get('born', '')}-{person.get('died', '')}".strip('-')
                people_out.append({
                    'id': pid,
                    'name': person.get('name', 'Unknown'),
                    'years': years,
                    'photo': _normalize_photo_path(person.get('photo') or person.get('image'), data.get('meta', {}).get('family_id')),
                    'x': round(x, 1),
                    'y': round(y, 1),
                })
            cursor += item['width'] + UNIT_GAP

    canvas_width = max(760, int(max_row_width + SIDE_PAD * 2))

    def row_y(gen: int) -> float:
        return TOP_PAD + gen * (CARD_H + GEN_GAP)

    for child in sorted(parent_map.keys(), key=born_sort):
        if child not in centers:
            continue
        parents = sorted([p for p in parent_map.get(child, set()) if p in centers], key=born_sort)
        if not parents:
            continue
        child_gen = generation(child)
        parent_gen = min(generation(pid) for pid in parents)
        parent_center = sum(centers[pid] for pid in parents) / len(parents)
        parent_bottom = row_y(parent_gen) + CARD_H
        bus_y = parent_bottom + 34
        child_top = row_y(child_gen)

        connectors.append({'x1': round(parent_center, 1), 'y1': round(parent_bottom, 1), 'x2': round(parent_center, 1), 'y2': round(bus_y, 1)})
        connectors.append({'x1': round(parent_center, 1), 'y1': round(bus_y, 1), 'x2': round(centers[child], 1), 'y2': round(bus_y, 1)})
        connectors.append({'x1': round(centers[child], 1), 'y1': round(bus_y, 1), 'x2': round(centers[child], 1), 'y2': round(child_top, 1)})

    max_gen = max(gens.keys(), default=0)
    canvas_height = TOP_PAD + (max_gen + 1) * CARD_H + max_gen * GEN_GAP + TOP_PAD

    return {
        'family_name': data.get('meta', {}).get('family_name', 'Family Tree'),
        'profile_name': data.get('meta', {}).get('profile_name', ''),
        'profile_photo': data.get('meta', {}).get('profile_photo', DEFAULT_PROFILE_PHOTO),
        'canvas_width': int(max(640, _num(canvas_width, 760))),
        'canvas_height': int(max(280, _num(canvas_height, 420))),
        'people': sorted(people_out, key=lambda p: (p['y'], p['x'], p['name'])),
        'connectors': connectors,
        'links': connectors,
        'stats': family_stats(data),
    }


def enrich_family_data(payload: dict, family_id: str | None = None) -> dict:
    data = json.loads(json.dumps(payload or {}))
    data.setdefault('meta', {})
    if family_id:
        data['meta'].setdefault('family_id', family_id)
    data.setdefault('people', [])
    data.setdefault('relationships', [])
    data.setdefault('events', [])

    for person in data['people']:
        route: list[dict] = []
        seen = set()

        def add_location(loc: dict | None):
            item = canonical_location(loc)
            if not item:
                return
            key = (item.get('label'), item.get('lat'), item.get('lng'))
            if key in seen:
                return
            seen.add(key)
            route.append(item)

        for loc in person.get('migrations', []):
            add_location(loc)
        add_location(person.get('current_location'))

        person['migrations'] = route
        person['photo'] = _normalize_photo_path(person.get('photo') or person.get('image'), family_id)
        person.setdefault('location', route[0] if route else {})
        if route:
            person['current_location'] = route[-1]

    return data


def current_sample_family() -> dict:
    sid = selected_family_id()
    return enrich_family_data(load_sample_family(sid), sid)


def current_family_payload() -> dict:
    user = current_user()
    if user:
        family = family_profile_for_user(user.username)
        return enrich_family_data(family_to_payload(family), family.family_slug if family else user.username)
    return current_sample_family()


def family_ancestor(data: dict) -> dict | None:
    people = data.get('people', [])
    if not people:
        return None

    def born_key(person: dict):
        born = str(person.get('born', '')).strip()
        try:
            return int(born)
        except Exception:
            return 999999

    return sorted(people, key=lambda person: (born_key(person), person.get('name', '')))[0]


def landing_summary_from_family(data: dict) -> dict:
    family_name = data.get('meta', {}).get('family_name', 'Family Legacy')
    stats = family_stats(data)
    ancestor = family_ancestor(data)
    if ancestor:
        ancestor = dict(ancestor)
        ancestor['photo'] = _normalize_photo_path(ancestor.get('photo') or ancestor.get('image'), data.get('meta', {}).get('family_id'))
    people = data.get('people', [])
    migration_places = []
    seen_places = set()
    for person in people:
        for loc in person.get('migrations', []):
            label = loc.get('label') or format_place(loc)
            if label and label not in seen_places:
                seen_places.add(label)
                migration_places.append(label)
    start_year = min((int(str(p.get('born')).strip()) for p in people if str(p.get('born', '')).strip().isdigit()), default='')
    current_year = datetime.now().year
    years = str(max(0, current_year - start_year)) if start_year else ''
    migration_count = sum(max(0, len(person.get('migrations', [])) - 1) for person in people)
    map_payload = map_people_payload(data)

    return {
        'brand': 'LineAgeMap',
        'hero': {
            'subtitle': 'Trace your family through stories, movement, and generations.',
            'search_placeholder': 'Enter your family name',
            'cta': 'Begin to Build Your Archive',
        },
        'family': {
            'eyebrow': 'Family Time Capsule',
            'name': family_name.replace(' Family', ' Legacy'),
            'years': years,
            'locations': migration_places[:4],
            'tree_cta': 'View Full Legacy Archive',
            'stats': [
                {'value': stats['members'], 'label': 'Members'},
                {'value': stats['generations'], 'label': 'Generations'},
                {'value': years or '—', 'label': 'Years'},
                {'value': migration_count if migration_count > 0 else '—', 'label': 'Migrations'},
            ],
            'ancestor': ancestor,
        },
        'tree': {
            'api_url': '/api/current-family/tree'
        },
        'map': {
            'title': f'{family_name} Migration Map',
            'subtitle': '',
            'legend': [
                {'kind': 'origin', 'label': 'Origin'},
                {'kind': 'migration', 'label': 'Migration'},
                {'kind': 'settlement', 'label': 'Current / Latest'},
            ],
            'people': map_payload['people'],
            'places': map_payload['places'],
        },
    }


def map_people_payload(data: dict) -> dict:
    people_payload = []
    all_places = []
    seen_places = set()
    for person in data.get('people', []):
        migrations = person.get('migrations', [])
        coords_path = []
        for loc in migrations:
            if loc.get('lng') in (None, '') or loc.get('lat') in (None, ''):
                continue
            coords = [float(loc['lng']), float(loc['lat'])]
            coords_path.append(coords)
            place_key = (loc.get('label'), coords[0], coords[1])
            if place_key not in seen_places:
                seen_places.add(place_key)
                all_places.append({'name': loc.get('label') or format_place(loc), 'coords': coords, 'kind': 'migration'})
        if not coords_path:
            continue
        years = f"{person.get('born', '')}-{person.get('died', '')}".strip('-')
        people_payload.append({
            'id': person.get('id'),
            'name': person.get('name'),
            'years': years,
            'image': _normalize_photo_path(person.get('photo') or person.get('image'), data.get('meta', {}).get('family_id')),
            'label': format_place(person.get('current_location') or person.get('location')) or (person.get('current_location') or {}).get('label', ''),
            'placeLabels': [loc.get('label') or format_place(loc) for loc in migrations if (loc.get('label') or format_place(loc))],
            'path': coords_path,
            'route': coords_path,
        })
    return {'people': people_payload, 'places': all_places}


@app.context_processor
def inject_helpers():
    logged_in = current_user()
    family_options = [{'id': sid, 'label': sample_family_label(sid)} for sid in sample_family_ids()]
    return {
        'logged_in_user': logged_in,
        'family_options': family_options,
        'current_family_id': selected_family_id(),
        'show_family_switcher': bool(family_options) and not logged_in,
    }


@app.route('/')
def index():
    user = current_user()
    family = current_family_payload() if user else current_sample_family()
    data = landing_summary_from_family(family)
    return render_template('index.html', data=data, landing_family=family, user=user, mapbox_public_token=MAPBOX_PUBLIC_TOKEN, landing_tree_api_url='/api/current-family/tree?scope=lineage&generations=4')


@app.get('/select-family')
def select_family():
    family_id = (request.args.get('family') or '').strip().lower()
    if family_id in sample_family_ids():
        session['selected_family'] = family_id
    next_url = request.args.get('next') or request.referrer or url_for('index')
    return redirect(next_url)


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username', '').strip().lower()
        password = request.form.get('password', '').strip()
        user = get_user(username)
        if not user or not check_password_hash(user.password_hash, password):
            flash('Invalid username or password.')
            return redirect(url_for('login'))
        session['username'] = username
        ensure_user_family(username)
        return redirect(url_for('dashboard'))
    return render_template('login.html')


@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form.get('username', '').strip().lower()
        password = request.form.get('password', '').strip()
        profile_name = request.form.get('profile_name', '').strip()

        if not username or not password or not profile_name:
            flash('Username, password, and User name are required.')
            return redirect(url_for('register'))
        if get_user(username):
            flash('That username is already taken.')
            return redirect(url_for('register'))

        user = User(
            username=username,
            display_name=profile_name,
            password_hash=generate_password_hash(password),
        )
        db.session.add(user)
        db.session.flush()

        family = FamilyProfile(
            user=user,
            family_slug=username,
            family_name=f'{profile_name} Family',
            profile_name=profile_name,
            profile_photo=DEFAULT_PROFILE_PHOTO,
        )
        db.session.add(family)
        db.session.flush()
        db.session.add(_build_seed_person(user, family))
        db.session.commit()

        session['username'] = username
        flash('Account created.')
        return redirect(url_for('dashboard'))

    return render_template('register.html')


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))


@app.route('/dashboard')
def dashboard():
    user = current_user()
    if not user:
        return redirect(url_for('login'))
    family = current_family_payload()
    summary = landing_summary_from_family(family)
    return render_template('index.html', user=user, data=summary, landing_tree_api_url='/api/current-family/tree', mapbox_public_token=MAPBOX_PUBLIC_TOKEN)


@app.route('/tree')
def tree():
    owner = request.args.get('user')
    user = current_user()
    if owner:
        family_profile = family_profile_for_user(owner)
        family = enrich_family_data(family_to_payload(family_profile), owner) if family_profile else current_sample_family()
    elif user:
        family = current_family_payload()
    else:
        family_id = selected_family_id()
        family = enrich_family_data(load_sample_family(family_id), family_id)
    family_name = family.get('meta', {}).get('family_name', 'Family Tree')
    return render_template('tree.html', family_name=family_name, tree_api_url='/api/current-family/tree', tree_editor_enabled=bool(user), tree_branch_api_url=url_for('api_tree_add_branch'), tree_update_api_url=url_for('api_tree_update_node'), tree_delete_api_url=url_for('api_tree_delete_node'))


@app.get('/api/current-family/tree')
def api_current_family_tree():
    family = current_family_payload()
    scope = (request.args.get('scope') or '').strip().lower()
    generations = request.args.get('generations', type=int) or 4
    if scope == 'lineage':
        family = lineage_subset_to_root(family, max_generations=max(1, generations))
    family_id = family.get('meta', {}).get('family_id')
    return normalize_tree_payload(family, family_id)


@app.route('/map')
def map_view():
    return redirect(url_for('index', _anchor='journey'))


@app.get('/api/current-family/people')
def api_current_family_people():
    return map_people_payload(current_family_payload())


@app.get('/api/family/current/people')
def api_family_current_people_alias():
    return map_people_payload(current_family_payload())


@app.post('/profile/update')
def update_profile():
    user = current_user()
    if not user:
        return redirect(url_for('login'))

    family = family_profile_for_user(user.username)
    if not family:
        return redirect(url_for('dashboard'))

    family.profile_name = request.form.get('profile_name', '').strip() or user.display_name
    family.family_name = request.form.get('family_name', '').strip() or f'{family.profile_name} Family'
    profile_photo = request.form.get('profile_photo', '').strip()
    if profile_photo:
        family.profile_photo = _normalize_photo_path(profile_photo, family.family_slug)

    root_person = family.people[0] if family.people else None
    if root_person and root_person.name != family.profile_name:
        root_person.name = family.profile_name

    user.display_name = family.profile_name
    db.session.commit()
    flash('Profile updated.')
    return redirect(url_for('dashboard'))


@app.post('/people/add')
def add_person():
    user = current_user()
    if not user:
        return redirect(url_for('login'))

    family = family_profile_for_user(user.username)
    if not family:
        return redirect(url_for('dashboard'))

    name = request.form.get('name', '').strip()
    if not name:
        flash('Name is required.')
        return redirect(url_for('dashboard'))

    person_id = unique_person_public_id(request.form.get('person_id', '') or name)

    person = Person(
        family=family,
        public_id=person_id,
        name=name,
        born=request.form.get('born', '').strip(),
        died=request.form.get('died', '').strip(),
        photo=_normalize_photo_path(request.form.get('photo', '').strip(), family.family_slug),
    )
    db.session.add(person)
    db.session.commit()
    flash(f'{name} added.')
    return redirect(url_for('dashboard'))


@app.post('/relationships/add')
def add_relationship():
    user = current_user()
    if not user:
        return redirect(url_for('login'))

    family = family_profile_for_user(user.username)
    if not family:
        return redirect(url_for('dashboard'))

    rel_type = request.form.get('relationship_type', '').strip()
    first = request.form.get('first_person', '').strip()
    second = request.form.get('second_person', '').strip()
    if not rel_type or not first or not second or first == second:
        flash('Choose two different people and a relationship type.')
        return redirect(url_for('dashboard'))

    people_by_public_id = {person.public_id: person for person in family.people}
    person_a = people_by_public_id.get(first)
    person_b = people_by_public_id.get(second)
    if not person_a or not person_b:
        flash('One or more selected people no longer exist.')
        return redirect(url_for('dashboard'))

    if rel_type == 'spouse':
        relationship_type = 'spouse'
        flash('Spouse connection added.')
    elif rel_type == 'parent-child':
        relationship_type = 'parent'
        flash('Parent-child connection added.')
    else:
        flash('Unsupported relationship type.')
        return redirect(url_for('dashboard'))

    db.session.add(FamilyRelationship(family=family, relationship_type=relationship_type, person_a=person_a, person_b=person_b))
    db.session.commit()
    return redirect(url_for('dashboard'))


@app.post('/api/tree/upload-photo')
def api_tree_upload_photo():
    user = current_user()
    if not user:
        return {'ok': False, 'error': 'login_required'}, 401

    upload = request.files.get('photo')
    if not upload or not upload.filename:
        return {'ok': False, 'error': 'photo_required'}, 400

    family = family_profile_for_user(user.username)
    if not family:
        return {'ok': False, 'error': 'family_not_found'}, 404

    ext = Path(upload.filename).suffix.lower()
    if ext not in {'.jpg', '.jpeg', '.png', '.webp', '.gif'}:
        return {'ok': False, 'error': 'invalid_file_type'}, 400

    upload_dir = UPLOAD_ROOT / family.family_slug
    upload_dir.mkdir(parents=True, exist_ok=True)

    safe_name = secure_filename(Path(upload.filename).stem) or 'portrait'
    filename = f"{safe_name}_{uuid4().hex[:8]}{ext}"
    file_path = upload_dir / filename
    upload.save(file_path)

    return {'ok': True, 'photo': f'/static/uploads/{family.family_slug}/{filename}'}


@app.post('/api/tree/add-branch')
def api_tree_add_branch():
    user = current_user()
    if not user:
        return {'ok': False, 'error': 'login_required'}, 401

    payload = request.get_json(silent=True) or {}
    parent_id = str(payload.get('parent_id') or '').strip()
    relationship = str(payload.get('relationship') or 'child').strip().lower()
    name = str(payload.get('name') or '').strip()
    born = str(payload.get('born') or '').strip()
    died = str(payload.get('died') or '').strip()

    if relationship not in {'child', 'spouse', 'parent'}:
        relationship = 'child'
    if not parent_id or not name:
        return {'ok': False, 'error': 'missing_required_fields'}, 400

    family = family_profile_for_user(user.username)
    if not family:
        return {'ok': False, 'error': 'family_not_found'}, 404

    people_by_id = {person.public_id: person for person in family.people}
    anchor = people_by_id.get(parent_id)
    if not anchor:
        return {'ok': False, 'error': 'anchor_not_found'}, 404

    photo_value = _normalize_photo_path(str(payload.get('photo') or '').strip(), family.family_slug)
    new_person = Person(
        family=family,
        public_id=unique_person_public_id(name),
        name=name,
        born=born,
        died=died,
        photo=photo_value,
    )
    db.session.add(new_person)
    db.session.flush()
    apply_person_migrations(new_person, payload.get('migrations'))

    if relationship == 'spouse':
        db.session.add(FamilyRelationship(family=family, relationship_type='spouse', person_a=anchor, person_b=new_person))
    elif relationship == 'parent':
        db.session.add(FamilyRelationship(family=family, relationship_type='parent', person_a=new_person, person_b=anchor))
    else:
        db.session.add(FamilyRelationship(family=family, relationship_type='parent', person_a=anchor, person_b=new_person))
        spouse_links = [
            rel for rel in family.relationships
            if rel.relationship_type == 'spouse'
            and ((rel.person_a_id == anchor.id) or (rel.person_b_id == anchor.id))
        ]
        spouse_people = []
        for rel in spouse_links:
            spouse = rel.person_b if rel.person_a_id == anchor.id else rel.person_a
            if spouse and spouse.id != anchor.id:
                spouse_people.append(spouse)
        unique_spouses = []
        seen_spouse_ids = set()
        for spouse in spouse_people:
            if spouse.id in seen_spouse_ids:
                continue
            seen_spouse_ids.add(spouse.id)
            unique_spouses.append(spouse)
        if len(unique_spouses) == 1:
            db.session.add(FamilyRelationship(family=family, relationship_type='parent', person_a=unique_spouses[0], person_b=new_person))

    try:
        db.session.commit()
    except Exception as exc:
        db.session.rollback()
        app.logger.exception('Tree add branch failed')
        return {'ok': False, 'error': str(exc)}, 500
    return {'ok': True, 'added_person_id': new_person.public_id}


@app.post('/api/tree/update-node')
def api_tree_update_node():
    user = current_user()
    if not user:
        return {'ok': False, 'error': 'login_required'}, 401

    payload = request.get_json(silent=True) or {}
    person_id = str(payload.get('person_id') or '').strip()
    if not person_id:
        return {'ok': False, 'error': 'person_required'}, 400

    family = family_profile_for_user(user.username)
    if not family:
        return {'ok': False, 'error': 'family_not_found'}, 404

    person = next((item for item in family.people if item.public_id == person_id), None)
    if not person:
        return {'ok': False, 'error': 'person_not_found'}, 404

    name = str(payload.get('name') or '').strip()
    if name:
        person.name = name
    person.born = str(payload.get('born') or '').strip()
    person.died = str(payload.get('died') or '').strip()

    photo_value = str(payload.get('photo') or '').strip()
    person.photo = _normalize_photo_path(photo_value, family.family_slug) if photo_value else person.photo
    apply_person_migrations(person, payload.get('migrations'))

    db.session.commit()
    return {'ok': True}


@app.post('/api/tree/delete-node')
def api_tree_delete_node():
    user = current_user()
    if not user:
        return {'ok': False, 'error': 'login_required'}, 401

    payload = request.get_json(silent=True) or {}
    person_id = str(payload.get('person_id') or '').strip()
    if not person_id:
        return {'ok': False, 'error': 'person_required'}, 400

    family = family_profile_for_user(user.username)
    if not family:
        return {'ok': False, 'error': 'family_not_found'}, 404

    target = next((item for item in family.people if item.public_id == person_id), None)
    if not target:
        return {'ok': False, 'error': 'person_not_found'}, 404

    child_map: dict[str, set[str]] = defaultdict(set)
    people_by_id = {person.id: person for person in family.people}
    for rel in family.relationships:
        if rel.relationship_type != 'parent':
            continue
        if rel.person_a_id in people_by_id and rel.person_b_id in people_by_id:
            child_map[people_by_id[rel.person_a_id].public_id].add(people_by_id[rel.person_b_id].public_id)

    to_remove_public_ids = set()
    stack = [target.public_id]
    while stack:
        current = stack.pop()
        if current in to_remove_public_ids:
            continue
        to_remove_public_ids.add(current)
        stack.extend(child_map.get(current, set()))

    to_remove_people = [person for person in family.people if person.public_id in to_remove_public_ids]
    remove_db_ids = {person.id for person in to_remove_people}

    FamilyRelationship.query.filter(
        FamilyRelationship.family_id == family.id,
        or_(FamilyRelationship.person_a_id.in_(remove_db_ids), FamilyRelationship.person_b_id.in_(remove_db_ids)),
    ).delete(synchronize_session=False)

    for person in to_remove_people:
        db.session.delete(person)

    db.session.commit()
    return {'ok': True, 'removed_ids': sorted(to_remove_public_ids)}


if __name__ == '__main__':
    app.run(debug=True)
