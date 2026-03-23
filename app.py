
from __future__ import annotations

import json
import re
from collections import defaultdict
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
    people_by_id = {person['id']: person for person in data.get('people', [])}
    relationships = data.get('relationships', [])

    spouse_of: dict[str, str] = {}
    child_to_parents: dict[str, set[str]] = defaultdict(set)
    parent_to_children: dict[str, list[str]] = defaultdict(list)

    for rel in relationships:
        if rel.get('type') == 'spouse':
            a = rel.get('a')
            b = rel.get('b')
            if a in people_by_id and b in people_by_id:
                spouse_of[a] = b
                spouse_of[b] = a
        elif rel.get('child') and rel.get('parent'):
            child = rel['child']
            parent = rel['parent']
            if child in people_by_id and parent in people_by_id:
                child_to_parents[child].add(parent)
                if child not in parent_to_children[parent]:
                    parent_to_children[parent].append(child)

    people_order = {pid: idx for idx, pid in enumerate(people_by_id.keys())}

    def person_sort_key(person_id: str):
        person = people_by_id[person_id]
        born = str(person.get('born', '')).strip()
        try:
            born_key = int(born) if born else 999999
        except ValueError:
            born_key = 999999
        return (born_key, person.get('name', ''), people_order.get(person_id, 0))

    family_defs: dict[str, dict] = {}

    def family_id_for(parents: list[str]) -> str:
        if not parents:
            return ''
        return 'fam__' + '__'.join(sorted(parents))

    def ensure_family(parents: list[str]) -> dict:
        parent_ids = sorted(dict.fromkeys([pid for pid in parents if pid in people_by_id]), key=person_sort_key)
        fid = family_id_for(parent_ids)
        if fid not in family_defs:
            family_defs[fid] = {
                'id': fid,
                'parent_ids': parent_ids,
                'child_ids': [],
                'sort_key': min((person_sort_key(pid) for pid in parent_ids), default=(999999, '', 0)),
            }
        return family_defs[fid]

    # Create family units for spouse pairs first so couples always stay together.
    seen_spouse_pairs = set()
    for a, b in spouse_of.items():
        pair = tuple(sorted((a, b), key=person_sort_key))
        if pair in seen_spouse_pairs:
            continue
        seen_spouse_pairs.add(pair)
        ensure_family(list(pair))

    # Group children by exact parent set, then attach to the matching family unit.
    for child_id, parent_ids in child_to_parents.items():
        if not parent_ids:
            continue
        parent_ids = sorted(parent_ids, key=person_sort_key)
        family = ensure_family(parent_ids)
        family['child_ids'].append(child_id)

    # Single people with no spouse and no grouped family still need a visible unit.
    people_in_parent_units = {pid for fam in family_defs.values() for pid in fam['parent_ids']}
    for person_id in people_by_id:
        if person_id not in people_in_parent_units and person_id not in spouse_of:
            ensure_family([person_id])

    for fam in family_defs.values():
        fam['child_ids'] = sorted(dict.fromkeys(fam['child_ids']), key=person_sort_key)

    family_ids_by_parent: dict[str, list[str]] = defaultdict(list)
    for fam in family_defs.values():
        for pid in fam['parent_ids']:
            family_ids_by_parent[pid].append(fam['id'])

    def family_priority(fid: str) -> tuple[int, int, tuple]:
        fam = family_defs[fid]
        return (len(fam['child_ids']), len(fam['parent_ids']), tuple(person_sort_key(pid) for pid in fam['parent_ids']))

    home_family_for_person: dict[str, str] = {}
    for pid in people_by_id:
        fam_ids = family_ids_by_parent.get(pid, [])
        if fam_ids:
            fam_ids = sorted(fam_ids, key=family_priority, reverse=True)
            home_family_for_person[pid] = fam_ids[0]

    # Build child family relationships using each child's home family.
    for fam in family_defs.values():
        fam['child_units'] = []
        fam['leaf_children'] = []

    attached_family_ids = set()
    for fam in family_defs.values():
        for child_id in fam['child_ids']:
            child_home = home_family_for_person.get(child_id)
            if child_home and child_home != fam['id'] and child_home in family_defs:
                family_defs[fam['id']]['child_units'].append(child_home)
                attached_family_ids.add(child_home)
            else:
                family_defs[fam['id']]['leaf_children'].append(child_id)

    for fam in family_defs.values():
        seen = set()
        ordered_units = []
        for unit_id in fam['child_units']:
            if unit_id not in seen:
                seen.add(unit_id)
                ordered_units.append(unit_id)
        fam['child_units'] = sorted(ordered_units, key=lambda fid: family_defs[fid]['sort_key'])
        fam['leaf_children'] = sorted(dict.fromkeys(fam['leaf_children']), key=person_sort_key)

    root_family_ids = [
        fam['id'] for fam in sorted(family_defs.values(), key=lambda fam: fam['sort_key'])
        if fam['id'] not in attached_family_ids
    ]
    if not root_family_ids:
        root_family_ids = [fam['id'] for fam in sorted(family_defs.values(), key=lambda fam: fam['sort_key'])]

    CARD_W = 90
    PHOTO_H = 84
    NAME_H = 34
    CARD_H = PHOTO_H + NAME_H + 12
    PARENT_GAP = 10
    SIBLING_GAP = 16
    FAMILY_GAP = 34
    LEVEL_GAP = max(24, CARD_H // 4)
    SIDE_PAD = 28
    TOP_PAD = 20

    size_cache: dict[str, float] = {}

    def family_row_width(count: int) -> float:
        if count <= 0:
            return CARD_W
        return count * CARD_W + max(0, count - 1) * PARENT_GAP

    def subtree_width(fid: str) -> float:
        if fid in size_cache:
            return size_cache[fid]
        fam = family_defs[fid]
        parent_width = family_row_width(len(fam['parent_ids']))
        child_parts = []
        for child_family_id in fam['child_units']:
            child_parts.append(subtree_width(child_family_id))
        for _ in fam['leaf_children']:
            child_parts.append(CARD_W)
        children_width = 0.0
        if child_parts:
            children_width = sum(child_parts) + SIBLING_GAP * (len(child_parts) - 1)
        total = max(parent_width, children_width, CARD_W)
        size_cache[fid] = total
        return total

    layout_people = []
    connectors = []
    placed_people = set()
    max_x = 0.0
    max_y = 0.0

    def add_person(person_id: str, center_x: float, top_y: float) -> None:
        nonlocal max_x, max_y
        if person_id in placed_people:
            return
        placed_people.add(person_id)
        person = people_by_id[person_id]
        years = f"{person.get('born', '')}-{person.get('died', '')}".strip('-')
        layout_people.append({
            'id': person_id,
            'name': person.get('name', 'Unknown'),
            'years': years,
            'photo': person.get('photo', '/static/img/placeholder-avatar.png'),
            'x': round(center_x - CARD_W / 2, 1),
            'y': round(top_y, 1),
            'generation': 0,
        })
        max_x = max(max_x, center_x + CARD_W / 2)
        max_y = max(max_y, top_y + CARD_H)

    def layout_family(fid: str, center_x: float, top_y: float) -> None:
        nonlocal max_x, max_y
        fam = family_defs[fid]
        parent_count = max(1, len(fam['parent_ids']))
        parent_row_width = family_row_width(parent_count)
        parent_left = center_x - parent_row_width / 2
        parent_centers = []
        for idx, pid in enumerate(fam['parent_ids']):
            px = parent_left + idx * (CARD_W + PARENT_GAP) + CARD_W / 2
            parent_centers.append(px)
            add_person(pid, px, top_y)

        if len(parent_centers) >= 2:
            connectors.append({
                'x1': round(parent_centers[0], 1),
                'y1': round(top_y + PHOTO_H / 2, 1),
                'x2': round(parent_centers[-1], 1),
                'y2': round(top_y + PHOTO_H / 2, 1),
            })

        child_parts = []
        for child_family_id in fam['child_units']:
            child_parts.append(('family', child_family_id, subtree_width(child_family_id)))
        for child_id in fam['leaf_children']:
            child_parts.append(('leaf', child_id, CARD_W))

        if not child_parts:
            max_y = max(max_y, top_y + CARD_H)
            return

        child_y = top_y + CARD_H + LEVEL_GAP
        total_children_width = sum(width for _, _, width in child_parts) + SIBLING_GAP * (len(child_parts) - 1)
        child_cursor = center_x - total_children_width / 2
        child_centers = []
        child_bus_y = top_y + CARD_H + max(10, LEVEL_GAP * 0.45)
        parent_anchor_x = sum(parent_centers) / len(parent_centers) if parent_centers else center_x

        connectors.append({
            'x1': round(parent_anchor_x, 1),
            'y1': round(top_y + CARD_H, 1),
            'x2': round(parent_anchor_x, 1),
            'y2': round(child_bus_y, 1),
        })

        for kind, ref, width in child_parts:
            child_center_x = child_cursor + width / 2
            child_centers.append(child_center_x)
            if kind == 'family':
                layout_family(ref, child_center_x, child_y)
            else:
                add_person(ref, child_center_x, child_y)
            connectors.append({
                'x1': round(child_center_x, 1),
                'y1': round(child_bus_y, 1),
                'x2': round(child_center_x, 1),
                'y2': round(child_y, 1),
            })
            child_cursor += width + SIBLING_GAP

        if child_centers:
            connectors.append({
                'x1': round(min(child_centers), 1),
                'y1': round(child_bus_y, 1),
                'x2': round(max(child_centers), 1),
                'y2': round(child_bus_y, 1),
            })

        max_y = max(max_y, child_y + CARD_H)

    forest_width = sum(subtree_width(fid) for fid in root_family_ids) + FAMILY_GAP * max(0, len(root_family_ids) - 1)
    canvas_width = max(720, int(forest_width + SIDE_PAD * 2))
    cursor_x = (canvas_width - forest_width) / 2

    for family_id in root_family_ids:
        width = subtree_width(family_id)
        center_x = cursor_x + width / 2
        layout_family(family_id, center_x, TOP_PAD)
        cursor_x += width + FAMILY_GAP

    canvas_height = int(max_y + TOP_PAD + 18)

    return {
        'family_name': data.get('meta', {}).get('family_name', 'Family Tree'),
        'profile_name': data.get('meta', {}).get('profile_name', ''),
        'profile_photo': data.get('meta', {}).get('profile_photo', '/static/img/you.jpg'),
        'canvas_width': int(canvas_width),
        'canvas_height': int(canvas_height),
        'people': sorted(layout_people, key=lambda p: (p['y'], p['x'], p['name'])),
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
