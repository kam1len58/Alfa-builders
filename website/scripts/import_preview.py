"""Read the supplied preview files and create a browser data bundle; never modify inputs."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--profiles', default=ROOT / 'data/demo_profiles.json')
parser.add_argument('--feed', default=ROOT / 'data/feed_preview.xlsx')
args = parser.parse_args()
profiles_path, feed_path = Path(args.profiles), Path(args.feed)
profiles = json.loads(profiles_path.read_text(encoding='utf-8-sig'))
ids = [p['synthetic_u'] for p in profiles]
assert len(ids) == len(set(ids)), 'Duplicate profile identifiers'
scores = pd.read_excel(feed_path, sheet_name='Баллы', keep_default_na=False)
reasons = pd.read_excel(feed_path, sheet_name='Почему', keep_default_na=False)
column_map = {}
for column in scores.columns[1:]:
    match = re.search(r'U_\d+', str(column))
    assert match, f'Missing company ID in column {column}'
    column_map[match.group()] = column
assert set(column_map) == set(ids), 'Profile IDs differ from feed headers'
assert len(reasons) == len(scores) * len(ids), 'Incomplete company/news matrix'
rows = {}
for _, row in reasons.iterrows():
    key = (str(row['Новость']), str(row['Компания']))
    assert key not in rows, f'Duplicate explanation: {key}'
    rows[key] = row
news = []
for i, row in scores.iterrows():
    nid = f'N{i+1}'
    assignments = {}
    for uid in ids:
        source = rows[(nid, uid)]
        score = float(row[column_map[uid]])
        assert score == float(source['Балл']), f'Conflicting scores: {nid}/{uid}'
        assert 0 <= score <= 1, 'Score outside [0, 1]'
        placement = str(source['Куда в ленте']).strip()
        assert placement in ['В фокусе', 'Все события', 'скрыть'], placement
        assert (score == 0) == (placement == 'скрыть'), f'Inconsistent visibility: {nid}/{uid}'
        assignments[uid] = {
            'score': score,
            'placement': placement,
            'rules': [v.strip() for v in str(source['Сработавшие правила']).split(',') if v.strip()],
            'explanation': str(source['Объяснение']),
            'suggestedProducts': str(source['Продукты банка']),
            'sourceRow': int(source.name) + 2,
        }
    raw = str(row['Новость'])
    news.append({'id': nid, 'rawText': raw, 'isTruncated': not raw.rstrip().endswith(('.', '!', '?')),
                 'scoreRow': int(i)+2, 'assignments': assignments})

bundle = {
    'schemaVersion': 1,
    'meta': {'profilesSource': profiles_path.name, 'feedSource': feed_path.name,
             'profilesSha256': hashlib.sha256(profiles_path.read_bytes()).hexdigest(),
             'feedSha256': hashlib.sha256(feed_path.read_bytes()).hexdigest(),
             'newsTextPolicy': 'Source fragments preserved verbatim; no completion or fact verification.',
             'sourceLinksProvided': False, 'bankMaterialsProvided': False},
    'profiles': profiles, 'news': news,
}
out = ROOT/'dist/data/feed-preview.js'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text('window.ALFA_FEED = '+json.dumps(bundle, ensure_ascii=False, indent=2)+';\n', encoding='utf-8')
summary = {}
for uid in ids:
    summary[uid] = {
        'focus': sorted([n['id'] for n in news if n['assignments'][uid]['placement']=='В фокусе'], key=lambda nid: -news[int(nid[1:])-1]['assignments'][uid]['score']),
        'general': [n['id'] for n in news if n['assignments'][uid]['placement']=='Все события'],
        'hidden': [n['id'] for n in news if n['assignments'][uid]['placement']=='скрыть'],
    }
print(json.dumps({'profiles':len(profiles), 'news':len(news), 'assignments':len(rows), 'truncatedTexts':sum(n['isTruncated'] for n in news), 'feeds':summary},ensure_ascii=False,indent=2))
