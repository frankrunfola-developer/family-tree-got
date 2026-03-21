from __future__ import annotations

import json
import math
import re
from collections import defaultdict, deque
from pathlib import Path
from uuid import uuid4

from flask import Flask, flash, redirect, render_template, request, session, url_for

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / 'data'
USERS_PATH = DATA_DIR / 'users.json'
DEMO_FAMILY_PATH = DATA_DIR / 'kennedy.json'
MARKETING_PATH = DATA_DIR / 'family.json'
USER_FAMILIES_DIR = DATA_DIR / 'user_families'
USER_FAMILIES_DIR.mkdir(exist_ok=True)

app = Flask(__name__)
app.secret_key = 'lineagemap-dev-secret'


def load_json(path: Path, default=None):
    if not path.exists():
        return {} if default is None else default
    with path.open('r', encoding='utf-8') as f:
        return json.load(f)


def save_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2)


def slugify(value: str) -> str:
    cleaned = re.sub(r'[^a-zA-Z0-9]+', '_', value.strip().lower())
    return cleaned.strip('_') or f'person_{uuid4().hex[:6]}'


def get_users() -> dict:
    return load_json(USERS_PATH, default={'users': []})


def get_user(username: str) -> dict | None:
    for user in get_users().get('users', []):
        if user.get('username') == username:
            return user
    return None


def current_user() -> dict | None:
    username = session.get('username')
    if not username:
        return None
    return get_user(username)


def user_family_path(username: str) -> Path:
    return USER_FAMILIES_DIR / f'{username}.json'


def load_marketing_data() -> dict:
    return load_json(MARKETING_PATH, default={})


def ensure_user_family(username: str) -> dict:
    path = user_family_path(username)
    if not path.exists():
        demo = load_json(DEMO_FAMILY_PATH, default={})
        seeded = {
            'meta': {
                'family_name': f"{username.title()} Family",
                'owner_username': username,
                'profile_name': username.title(),
                'profile_photo': '/static/img/you.jpg',
                'description': 'Start with the sample tree, then add your own relatives.'
            },
            'people': demo.get('people', []),
            'relationships': demo.get('relationships', []),
            'events': demo.get('events', []),
        }
        save_json(path, seeded)
    return load_json(path, default={})


def save_user_family(username: str, payload: dict) -> None:
    save_json(user_family_path(username), payload)


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
    people = {person['id']: person for person in data.get('people', [])}
    relationships = data.get('relationships', [])
    spouse_map: dict[str, str] = {}
    parent_to_children: dict[str, list[str]] = defaultdict(list)
    child_to_parents: dict[str, list[str]] = defaultdict(list)

    for rel in relationships:
        if rel.get('type') == 'spouse':
            a = rel.get('a')
            b = rel.get('b')
            if a in people and b in people:
                spouse_map[a] = b
                spouse_map[b] = a
        elif rel.get('child') and rel.get('parent'):
            child = rel['child']
            parent = rel['parent']
            if child in people and parent in people:
                parent_to_children[parent].append(child)
                child_to_parents[child].append(parent)

    generation_cache: dict[str, int] = {}

    def generation(person_id: str) -> int:
        if person_id in generation_cache:
            return generation_cache[person_id]
        parents = child_to_parents.get(person_id, [])
        if not parents:
            generation_cache[person_id] = 0
            return 0
        generation_cache[person_id] = max(generation(parent_id) for parent_id in parents) + 1
        return generation_cache[person_id]

    for person_id in people:
        generation(person_id)

    units_by_gen: dict[int, list[list[str]]] = defaultdict(list)
    seen: set[str] = set()

    def unit_sort_key(unit: list[str]):
        roots = [min(generation_cache.get(pid, 0), 99) for pid in unit]
        min_gen = min(roots) if roots else 0
        parent_ids = []
        for pid in unit:
            parent_ids.extend(child_to_parents.get(pid, []))
        parent_names = [people[p]['name'] for p in parent_ids if p in people]
        primary_name = people[unit[0]]['name']
        return (min_gen, min(parent_names) if parent_names else primary_name, primary_name)

    for person_id in sorted(people, key=lambda pid: (generation_cache[pid], people[pid]['name'])):
        if person_id in seen:
            continue
        spouse_id = spouse_map.get(person_id)
        person_gen = generation_cache[person_id]
        if spouse_id and spouse_id not in seen:
            unit = [person_id, spouse_id]
            unit.sort(key=lambda pid: people[pid]['name'])
            seen.update(unit)
            units_by_gen[person_gen].append(unit)
        else:
            seen.add(person_id)
            units_by_gen[person_gen].append([person_id])

    for gen, units in units_by_gen.items():
        units.sort(key=unit_sort_key)

    unit_index_by_person: dict[str, tuple[int, int]] = {}
    for gen, units in units_by_gen.items():
        for idx, unit in enumerate(units):
            for pid in unit:
                unit_index_by_person[pid] = (gen, idx)

    layout_people = []
    connectors = []

    unit_width = 192
    pair_gap = 12
    generation_gap = 206
    card_width = 82
    pair_card_width = 82
    card_height = 128
    row_padding_x = 48
    row_padding_y = 28

    max_units = max((len(units) for units in units_by_gen.values()), default=1)
    canvas_width = max(720, row_padding_x * 2 + max_units * unit_width)
    canvas_height = row_padding_y * 2 + (max(units_by_gen.keys(), default=0) + 1) * generation_gap + 140

    unit_centers: dict[tuple[int, int], float] = {}

    for gen in sorted(units_by_gen):
        units = units_by_gen[gen]
        row_width = len(units) * unit_width
        row_start_x = max(row_padding_x, (canvas_width - row_width) / 2)
        y = row_padding_y + gen * generation_gap

        for idx, unit in enumerate(units):
            unit_start_x = row_start_x + idx * unit_width
            if len(unit) == 2:
                first_x = unit_start_x + 10
                second_x = first_x + pair_card_width + pair_gap
                positions = [(unit[0], first_x), (unit[1], second_x)]
                couple_center = (first_x + pair_card_width / 2 + second_x + pair_card_width / 2) / 2
                connectors.append({
                    'type': 'spouse',
                    'x1': first_x + pair_card_width,
                    'y1': y + 58,
                    'x2': second_x,
                    'y2': y + 58,
                })
                unit_centers[(gen, idx)] = couple_center
            else:
                single_x = unit_start_x + (unit_width - card_width) / 2
                positions = [(unit[0], single_x)]
                unit_centers[(gen, idx)] = single_x + card_width / 2

            for pid, x in positions:
                person = people[pid]
                layout_people.append({
                    'id': pid,
                    'name': person['name'],
                    'years': f"{person.get('born', '')}-{person.get('died', '')}".strip('-'),
                    'photo': person.get('photo', '/static/img/you.jpg'),
                    'x': round(x, 1),
                    'y': round(y, 1),
                    'generation': gen,
                })

    sibling_connectors: dict[tuple[int, int], list[float]] = defaultdict(list)

    for child_id, parents in child_to_parents.items():
        parent_units = {unit_index_by_person[parent_id] for parent_id in parents if parent_id in unit_index_by_person}
        if not parent_units:
            continue
        parent_unit = sorted(parent_units)[0]
        child_unit = unit_index_by_person.get(child_id)
        if not child_unit:
            continue

        parent_center_x = unit_centers[parent_unit]
        child_center_x = unit_centers[child_unit]
        parent_y = row_padding_y + parent_unit[0] * generation_gap + 160
        child_y = row_padding_y + child_unit[0] * generation_gap
        bus_y = (parent_y + child_y) / 2

        sibling_connectors[parent_unit].append(child_center_x)
        connectors.append({'type': 'parent-drop', 'x1': parent_center_x, 'y1': parent_y, 'x2': parent_center_x, 'y2': bus_y})
        connectors.append({'type': 'child-drop', 'x1': child_center_x, 'y1': bus_y, 'x2': child_center_x, 'y2': child_y})

    for parent_unit, child_centers in sibling_connectors.items():
        if not child_centers:
            continue
        bus_y = (row_padding_y + parent_unit[0] * generation_gap + 160 + row_padding_y + (parent_unit[0] + 1) * generation_gap) / 2
        connectors.append({
            'type': 'sibling-bus',
            'x1': min(child_centers),
            'y1': bus_y,
            'x2': max(child_centers),
            'y2': bus_y,
        })

    return {
        'family_name': data.get('meta', {}).get('family_name', 'Family Tree'),
        'profile_name': data.get('meta', {}).get('profile_name', ''),
        'profile_photo': data.get('meta', {}).get('profile_photo', '/static/img/you.jpg'),
        'canvas_width': int(canvas_width),
        'canvas_height': int(canvas_height),
        'people': layout_people,
        'connectors': connectors,
        'stats': family_stats(data),
    }


@app.context_processor
def inject_helpers():
    return {'logged_in_user': current_user()}


@app.route('/')
def index():
    user = current_user()
    marketing = load_marketing_data()
    user_tree = None
    if user:
        user_family = ensure_user_family(user['username'])
        user_tree = build_tree_layout(user_family)
    return render_template('index.html', data=marketing, user_family=user_tree, user=user)


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username', '').strip().lower()
        password = request.form.get('password', '').strip()
        user = get_user(username)
        if not user or user.get('password') != password:
            flash('Invalid username or password.')
            return redirect(url_for('login'))
        session['username'] = username
        ensure_user_family(username)
        return redirect(url_for('dashboard'))
    return render_template('login.html')


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('index'))


@app.route('/dashboard')
def dashboard():
    user = current_user()
    if not user:
        return redirect(url_for('login'))
    family = ensure_user_family(user['username'])
    tree = build_tree_layout(family)
    return render_template('dashboard.html', user=user, family=family, tree=tree)


@app.route('/tree')
def tree():
    owner = request.args.get('user')
    if owner:
        family = ensure_user_family(owner)
    elif current_user():
        family = ensure_user_family(current_user()['username'])
    else:
        family = load_json(DEMO_FAMILY_PATH, default={})
    tree_data = build_tree_layout(family)
    return render_template('tree.html', tree_data=tree_data)


@app.post('/profile/update')
def update_profile():
    user = current_user()
    if not user:
        return redirect(url_for('login'))
    family = ensure_user_family(user['username'])
    family.setdefault('meta', {})['profile_name'] = request.form.get('profile_name', '').strip() or user['name']
    family['meta']['family_name'] = request.form.get('family_name', '').strip() or f"{user['name']} Family"
    profile_photo = request.form.get('profile_photo', '').strip()
    if profile_photo:
        family['meta']['profile_photo'] = profile_photo
    save_user_family(user['username'], family)
    flash('Profile updated.')
    return redirect(url_for('dashboard'))


@app.post('/people/add')
def add_person():
    user = current_user()
    if not user:
        return redirect(url_for('login'))

    family = ensure_user_family(user['username'])
    people = family.setdefault('people', [])

    name = request.form.get('name', '').strip()
    if not name:
        flash('Name is required.')
        return redirect(url_for('dashboard'))

    person_id = slugify(request.form.get('person_id', '') or name)
    existing_ids = {person['id'] for person in people}
    base_id = person_id
    counter = 2
    while person_id in existing_ids:
        person_id = f'{base_id}_{counter}'
        counter += 1

    people.append({
        'id': person_id,
        'name': name,
        'born': request.form.get('born', '').strip(),
        'died': request.form.get('died', '').strip(),
        'photo': request.form.get('photo', '').strip() or '/static/img/you.jpg',
    })
    save_user_family(user['username'], family)
    flash(f'{name} added.')
    return redirect(url_for('dashboard'))


@app.post('/relationships/add')
def add_relationship():
    user = current_user()
    if not user:
        return redirect(url_for('login'))
    family = ensure_user_family(user['username'])
    relationships = family.setdefault('relationships', [])

    rel_type = request.form.get('relationship_type', '').strip()
    first = request.form.get('first_person', '').strip()
    second = request.form.get('second_person', '').strip()
    if not rel_type or not first or not second or first == second:
        flash('Choose two different people and a relationship type.')
        return redirect(url_for('dashboard'))

    if rel_type == 'spouse':
        relationships.append({'type': 'spouse', 'a': first, 'b': second})
        flash('Spouse connection added.')
    elif rel_type == 'parent-child':
        relationships.append({'parent': first, 'child': second})
        flash('Parent-child connection added.')
    else:
        flash('Unsupported relationship type.')
        return redirect(url_for('dashboard'))

    save_user_family(user['username'], family)
    return redirect(url_for('dashboard'))


if __name__ == '__main__':
    app.run(debug=True)
