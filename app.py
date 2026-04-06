
from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path
from uuid import uuid4

try:
    from config import MAPBOX_PUBLIC_TOKEN
except Exception:
    MAPBOX_PUBLIC_TOKEN = ''

from flask import Flask, flash, redirect, render_template, request, session, url_for

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / 'data'
USERS_PATH = DATA_DIR / 'users.json'
SAMPLES_DIR = DATA_DIR / 'samples'
DEMO_FAMILY_PATH = SAMPLES_DIR / 'johnson.json'
USER_FAMILIES_DIR = BASE_DIR / 'instance' / 'user_families'
USER_FAMILIES_DIR.mkdir(parents=True, exist_ok=True)

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


def ensure_user_family(username: str) -> dict:
    path = user_family_path(username)
    if not path.exists():
        demo = load_json(DEMO_FAMILY_PATH, default={})
        seeded = {
            'meta': {
                'family_name': f"{username.title()} Family",
                'owner_username': username,
                'profile_name': username.title(),
                'profile_photo': '/static/img/placeholder-avatar.png',
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


def _num(value, default=0.0):
    try:
        return float(value)
    except Exception:
        return float(default)



def _normalize_photo_path(raw: str | None, family_id: str | None = None) -> str:
    value = str(raw or '').strip()
    if not value:
        return '/static/img/placeholder-avatar.png'
    if value.endswith('/you.jpg'):
        return '/static/img/placeholder-avatar.png'
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
        return '/static/img/placeholder-avatar.png'
    if value.startswith('/uploads/'):
        return '/static' + value
    if value.startswith('uploads/'):
        return '/static/' + value
    if value.startswith('/'):
        basename = Path(value).name
    else:
        basename = Path(value).name
    if family_id:
        candidate = BASE_DIR / 'static' / 'uploads' / family_id / basename
        if candidate.exists():
            return f'/static/uploads/{family_id}/{basename}'
    return '/static/img/placeholder-avatar.png'


def _normalize_family_photo_paths(data: dict, family_id: str | None = None) -> dict:
    for person in data.get('people', []):
        person['photo'] = _normalize_photo_path(person.get('photo') or person.get('image'), family_id)
    meta = data.get('meta', {})
    meta['profile_photo'] = _normalize_photo_path(meta.get('profile_photo'), family_id)
    return data


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

    rows: dict[int, list[dict]] = {}
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
        rows[gen] = units

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

    safe_people = []
    for person in people_out:
        safe_people.append({
            'id': person.get('id', ''),
            'name': person.get('name', 'Unknown'),
            'years': person.get('years', ''),
            'photo': _normalize_photo_path(person.get('photo') or person.get('image'), data.get('meta', {}).get('family_id')),
            'x': round(_num(person.get('x')), 1),
            'y': round(_num(person.get('y')), 1),
        })

    safe_connectors = []
    for link in connectors:
        safe_connectors.append({
            'x1': round(_num(link.get('x1')), 1),
            'y1': round(_num(link.get('y1')), 1),
            'x2': round(_num(link.get('x2')), 1),
            'y2': round(_num(link.get('y2')), 1),
        })

    return {
        'family_name': data.get('meta', {}).get('family_name', 'Family Tree'),
        'profile_name': data.get('meta', {}).get('profile_name', ''),
        'profile_photo': data.get('meta', {}).get('profile_photo', '/static/img/placeholder-avatar.png'),
        'canvas_width': int(max(640, _num(canvas_width, 760))),
        'canvas_height': int(max(280, _num(canvas_height, 420))),
        'people': sorted(safe_people, key=lambda p: (p['y'], p['x'], p['name'])),
        'connectors': safe_connectors,
        'stats': family_stats(data),
    }


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
    family_name = payload.get('meta', {}).get('family_name') or sample_id.replace('_', ' ').title()
    return family_name


def load_sample_family(sample_id: str | None = None) -> dict:
    sid = sample_id or selected_family_id()
    return load_json(SAMPLES_DIR / f'{sid}.json', default={})


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


def enrich_family_data(payload: dict, family_id: str | None = None) -> dict:
    data = json.loads(json.dumps(payload or {}))
    data.setdefault('meta', {})
    if family_id:
        data['meta'].setdefault('family_id', family_id)
    data.setdefault('people', [])
    data.setdefault('relationships', [])
    data.setdefault('events', [])

    events_by_person: dict[str, list[dict]] = defaultdict(list)
    for event in data['events']:
        for pid in event.get('people', []):
            events_by_person[pid].append(event)

    for pid in list(events_by_person):
        events_by_person[pid].sort(key=lambda item: str(item.get('date', '')))

    for person in data['people']:
        route: list[dict] = []
        seen = set()

        def add_location(loc: dict | None):
            item = canonical_location(loc)
            if not item:
                return
            key = (item.get('city'), item.get('region'), item.get('country'), item.get('lat'), item.get('lng'))
            if key in seen:
                return
            seen.add(key)
            route.append(item)

        add_location(person.get('location'))
        for loc in person.get('migrations', []):
            add_location(loc)
        for loc in person.get('migrated_locations', []):
            add_location(loc)
        for event in events_by_person.get(person.get('id'), []):
            add_location(event.get('location'))
        add_location(person.get('current_location'))

        if not route and isinstance(person.get('location'), dict):
            add_location(person.get('location'))

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
        return enrich_family_data(ensure_user_family(user['username']), user['username'])
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


def landing_tree_family_subset(data: dict, max_generations: int = 4) -> dict:
    if max_generations < 1:
        return data

    people = list(data.get('people', []))
    relationships = list(data.get('relationships', []))
    if not people or not relationships:
        return data

    people_by_id = {str(person.get('id')): person for person in people if person.get('id')}
    spouse_of: dict[str, str] = {}
    children_of: dict[frozenset[str], list[str]] = {}

    def born_sort(pid: str) -> tuple[int, str]:
        person = people_by_id.get(pid, {})
        born = str(person.get('born', '')).strip()
        year = int(born) if born.isdigit() else 999999
        return (year, str(person.get('name', '')))

    for rel in relationships:
        if rel.get('type') == 'spouse' and rel.get('a') in people_by_id and rel.get('b') in people_by_id:
            spouse_of[str(rel['a'])] = str(rel['b'])
            spouse_of[str(rel['b'])] = str(rel['a'])

    parent_map: dict[str, set[str]] = {}
    for rel in relationships:
        child = rel.get('child')
        parent = rel.get('parent')
        if child in people_by_id and parent in people_by_id:
            parent_map.setdefault(str(child), set()).add(str(parent))

    for child, parents in parent_map.items():
        children_of.setdefault(frozenset(parents), []).append(child)

    root = family_ancestor(data) or {}
    root_id = str(root.get('id') or '')
    if not root_id or root_id not in people_by_id:
        ordered = sorted(people_by_id, key=born_sort)
        if not ordered:
            return data
        root_id = ordered[0]

    included: list[str] = []
    included_set: set[str] = set()

    def include(pid: str | None):
        if pid and pid in people_by_id and pid not in included_set:
            included.append(pid)
            included_set.add(pid)

    current_primary = root_id
    current_spouse = spouse_of.get(root_id)
    include(current_primary)
    include(current_spouse)

    for _ in range(1, max_generations):
        parent_key = frozenset(pid for pid in (current_primary, current_spouse) if pid)
        candidates = sorted(children_of.get(parent_key, []), key=born_sort)
        if not candidates and current_primary:
            candidates = sorted([child for child, parents in parent_map.items() if current_primary in parents], key=born_sort)
        if not candidates:
            break
        chosen_child = candidates[0]
        chosen_spouse = spouse_of.get(chosen_child)
        include(chosen_child)
        include(chosen_spouse)
        current_primary = chosen_child
        current_spouse = chosen_spouse

    filtered_relationships = []
    for rel in relationships:
        if rel.get('type') == 'spouse':
            if rel.get('a') in included_set and rel.get('b') in included_set:
                filtered_relationships.append(rel)
        elif rel.get('child') in included_set and rel.get('parent') in included_set:
            filtered_relationships.append(rel)

    return {
        **data,
        'people': [people_by_id[pid] for pid in included if pid in people_by_id],
        'relationships': filtered_relationships,
    }


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
    end_year = max((int(str(p.get('died') or p.get('born')).strip()) for p in people if str(p.get('died') or p.get('born') or '').strip().isdigit()), default='')
    years = f"{start_year}–{end_year}" if start_year and end_year else (str(start_year) if start_year else '')

    landing_tree_source = landing_tree_family_subset(data, max_generations=4)
    tree_layout = build_tree_layout(landing_tree_source)
    landing_tree = {
        'links': tree_layout.get('connectors', []),
        'people': [],
    }
    for idx, person in enumerate(tree_layout.get('people', [])):
        photo = _normalize_photo_path(person.get('photo'), data.get('meta', {}).get('family_id'))
        landing_tree['people'].append({
            'id': person.get('id', f'p{idx}'),
            'name': person.get('name', 'Unknown'),
            'years': person.get('years', ''),
            'image': photo,
            'photo': photo,
            'x': f"{person.get('x', 0)}px",
            'y': f"{person.get('y', 0)}px",
            'w': '116px',
            'featured': idx == 0,
        })

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
                {'value': max(1, stats['couples']), 'label': 'Branches'},
            ],
            'ancestor': ancestor,
        },
        'tree': landing_tree,
        'map': {
            'title': f'{family_name} Migration Map',
            'subtitle': '',
            'legend': [
                {'kind': 'origin', 'label': 'Origin'},
                {'kind': 'migration', 'label': 'Migration'},
                {'kind': 'settlement', 'label': 'Current / Latest'},
            ],
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
            'label': format_place(person.get('current_location') or person.get('location')),
            'placeLabels': [loc.get('label') or format_place(loc) for loc in migrations if (loc.get('label') or format_place(loc))],
            'path': coords_path,
        })
    return {'people': people_payload, 'places': all_places}


@app.context_processor
def inject_helpers():
    family_options = [{'id': sid, 'label': sample_family_label(sid)} for sid in sample_family_ids()]
    return {
        'logged_in_user': current_user(),
        'family_options': family_options,
        'current_family_id': selected_family_id(),
    }


@app.route('/')
def index():
    user = current_user()
    family = current_sample_family()
    data = landing_summary_from_family(family)
    return render_template('index.html', data=data, landing_family=family, user=user, mapbox_public_token=MAPBOX_PUBLIC_TOKEN)


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
    user = current_user()
    if owner:
        family = enrich_family_data(ensure_user_family(owner), owner)
    elif user:
        family = enrich_family_data(ensure_user_family(user['username']), user['username'])
    else:
        family = current_sample_family()
    tree_data = build_tree_layout(family)
    return render_template('tree.html', tree_data=tree_data)


@app.route('/map')
def map_view():
    family = current_family_payload()
    data = landing_summary_from_family(family)
    return render_template('map.html', data=data, mapbox_public_token=MAPBOX_PUBLIC_TOKEN)


@app.get('/api/current-family/people')
def api_current_family_people():
    return map_people_payload(current_family_payload())


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
        'photo': request.form.get('photo', '').strip() or '/static/img/placeholder-avatar.png',
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
