"""Checks both languages before a release: python scripts/check-i18n.py

Web UI (web/js): every t('…') text and every table label translated where it is shown has an English entry in
web/js/lang/en.js, no entry is unused, placeholders match, and no Turkish is left outside t().
Server (dubkanka): every tx("…") text, room log text and translated table entry has an English entry in
dubkanka/lang_en.py, no entry is unused, and placeholders match.
Exits 1 when anything is wrong. Needs node (to read en.js).
"""
import ast
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TR = re.compile(r'[çğıöşüÇĞİÖŞÜ]')
problems = []


def report(*a):
    problems.append(' '.join(str(x) for x in a))


def placeholders_match(key, values):
    want = set(re.findall(r'\{(\w+)\}', key))
    for v in values:
        if set(re.findall(r'\{(\w+)\}', v)) != want:
            report('PLACEHOLDERS', json.dumps(key, ensure_ascii=False))
        if TR.search(v):
            report('NOT ENGLISH ', json.dumps(key, ensure_ascii=False), '->', v)


# ---------------------------------------------------------------- web UI
WEB = ROOT / 'web' / 'js'
KEY = re.compile(r"""\bt\(\s*(['"])((?:\\.|(?!\1).)*?)\1""", re.S)
# tables whose labels are translated where they are shown, t(label)
TABLES = {
    'main.js': ['TABS'], 'views/settings.js': ['PAGES'], 'state.js': ['MOTION_LEVELS'], 'recorder.js': ['NOISE_ENGINES'],
    'views/export.js': ['SUB_CHOICES', 'FORMAT_NAMES', 'PRESET_TEXT', 'LUFS'], 'views/booth.js': ['NOISE_NOTE', 'STATUS'],
    'views/onboarding.js': ['EXTRAS'], 'views/mixer.js': ['TRACK_NAMES'],
}
IDS = {'speech', 'separate', 'room', 'cleanup', 'text', 'music', 'users', 'wave', 'busy', 'bad', 'ok', 'warn', 'mic', 'film', 'sliders',
       'share', 'layers', 'globe', 'folder', 'refresh', 'cpu', 'none', 'dub', 'orig', 'both', 'full', 'reduced', 'off', 'standard',
       'rnnoise', 'dpdfnet', 'tiktok', 'high', 'small', 'copy', 'general', 'features', 'translate', 'folders', 'updates', 'system',
       'prepare', 'script', 'record', 'mix', 'export', 'processing', 'error', 'bg', 'amb', 'vertical_blur', 'vertical_crop',
       'square', 'original', 'RNNoise', 'DPDFNet', '9:16', '1:1'}
TR_WORDS = {'ve', 'ile', 'bir', 'yok', 'var', 'satır', 'kayıt', 'sahne', 'ses', 'sesi', 'oda', 'aç', 'kapat', 'sil', 'ekle', 'seç', 'dene',
            'karakter', 'dosya', 'altyazı', 'kalite', 'hazır', 'tamam', 'orijinal', 'dublaj', 'mikrofon', 'iptal', 'kaydet'}


def unescape(s):
    return s if '\\' not in s else json.loads('"' + s.replace("\\'", "'").replace('"', '\\"').replace('\\\\"', '\\"') + '"')


files = [f for f in sorted(WEB.rglob('*.js')) if 'lang' not in f.relative_to(WEB).parts]
keys, skip = {}, {}
for f in files:
    src = f.read_text(encoding='utf-8')
    for m in KEY.finditer(src):
        keys.setdefault(unescape(m.group(2)), f'{f.relative_to(ROOT).as_posix()}:{src[:m.start()].count(chr(10)) + 1}')
for rel, names in TABLES.items():
    src = (WEB / rel).read_text(encoding='utf-8')
    for name in names:
        m = re.search(r'const ' + name + r' = ([\[{].*?[\]}]);[^\n]*\n', src, re.S)
        if not m:
            report('TABLE GONE', rel, name)
            continue
        first = src[:m.start()].count('\n') + 1
        skip.setdefault(rel, set()).update(range(first, first + m.group(0).count('\n') + 1))
        for s in re.findall(r"'([^']*)'", m.group(1)):
            if s not in IDS and not re.fullmatch(r'-?\d+', s):
                keys.setdefault(s, f'{rel}:{name}')

out = subprocess.run(['node', '-e', "import(require('url').pathToFileURL(process.argv[1])).then(m => console.log(JSON.stringify(m.EN)))",
                      str(WEB / 'lang' / 'en.js')], capture_output=True, text=True, encoding='utf-8')
if out.returncode:
    sys.exit('en.js could not be read: ' + out.stderr)
EN = json.loads(out.stdout)
for k, where in keys.items():
    if k not in EN:
        report('WEB MISSING', json.dumps(k, ensure_ascii=False), where)
for k, v in EN.items():
    if k not in keys:
        report('WEB UNUSED ', json.dumps(k, ensure_ascii=False))
    placeholders_match(k, v if isinstance(v, list) else [v])
for f in files:
    rel = f.relative_to(WEB).as_posix()
    for i, line in enumerate(f.read_text(encoding='utf-8').split('\n'), 1):
        if i in skip.get(rel, ()) or line.lstrip().startswith(('/*', '*', '//')):
            continue
        code = KEY.sub('', line.split(' // ')[0])
        for m in re.finditer(r"""(['"`])((?:\\.|(?!\1).)*?)\1""", code):
            if TR.search(m.group(2)) and m.group(2) != 'Türkçe':
                report('WEB TURKISH', f'{rel}:{i}', m.group(2)[:90])
        for m in re.finditer(r'>([^<>]*)<', code):
            txt = re.sub(r'\$\{[^}]*\}', '', m.group(1)).strip()
            if txt and '`' not in txt and (TR.search(txt) or set(re.findall(r'[a-zçğıöşü]+', txt.lower())) & TR_WORDS):
                report('WEB TEXT   ', f'{rel}:{i}', txt[:90])
web_count = (len(keys), len(EN))

# `t` is the translation function: a local `t` (a time, a take) hides it, and t('…') then throws at run time. In 1.4.0
# `const t = player.time` did exactly that in the booth's clock loop and froze every recording.
SHADOW = [
    re.compile(r'\b(?:const|let|var)\s+t\s*[=;,]'),
    re.compile(r'\bfor\s*\(\s*(?:const|let|var)\s+t\b'),
    re.compile(r'(?<![\w.$])t\s*=>'),
    re.compile(r'\((?:[^()]*,\s*)?t\s*(?:=[^,()]*)?(?:,[^()]*)?\)\s*=>'),
    re.compile(r'\bfunction\b[^(]*\((?:[^()]*,\s*)?t\s*(?:=[^,()]*)?(?:,[^()]*)?\)'),
    re.compile(r'^\s*(?:static\s+)?(?:async\s+)?(?!(?:if|for|while|switch|catch|function|return)\b)[\w$]+\s*'
               r'\((?:[^()]*,\s*)?t\s*(?:=[^,()]*)?(?:,[^()]*)?\)\s*\{'),  # a method: seek(t) {
    re.compile(r'\bcatch\s*\(\s*t\s*\)'),
    re.compile(r'\b(?:const|let|var)\s*\{[^}]*(?<![\w.$])t\s*[,}]'),
]
for f in files:
    for i, line in enumerate(f.read_text(encoding='utf-8').split('\n'), 1):
        code = re.sub(r"""(['"`])(?:\\.|(?!\1).)*?\1""", '""', line.split(' // ')[0])
        if not line.lstrip().startswith(('/*', '*', '//')) and any(r.search(code) for r in SHADOW):
            report('WEB SHADOW ', f'{f.relative_to(WEB).as_posix()}:{i}', line.strip()[:90])

# ---------------------------------------------------------------- server
PY_TABLES = {  # name: how to find its texts
    'FEATURES': ('keys', ('name', 'summary')), 'PRESETS': ('keys', ('label', 'summary')), 'PROVIDERS': ('keys', ('name', 'note')),
    'EFFECTS': ('values', None), 'FORMATS': ('values', None), 'SUBS': ('values', None), 'CONTAINERS': ('values', None),
    'AUDIO_CODECS': ('values', None), 'STYLES': ('values', None), 'TORCH_BUILDS': ('values', None),
    'TTS_VOICES': ('item', 1), 'ENCODERS': ('item', 2), 'PREP_STEPS': ('item', 1),
}
pykeys = {}
for f in sorted((ROOT / 'dubkanka').glob('*.py')):
    if f.name in ('lang_en.py', 'i18n.py'):
        continue
    for node in ast.walk(ast.parse(f.read_text(encoding='utf-8'))):
        # `tx` is the translation function: nothing may take its name
        if (isinstance(node, ast.Name) and node.id == 'tx' and isinstance(node.ctx, ast.Store)) or \
                (isinstance(node, ast.arg) and node.arg == 'tx'):
            report('PY SHADOW  ', f'{f.name}:{node.lineno}')
        if isinstance(node, ast.Call) and node.args:
            fn = node.func
            name = fn.id if isinstance(fn, ast.Name) else fn.attr if isinstance(fn, ast.Attribute) else None
            a = node.args[0]
            where = f'{f.name}:{node.lineno}'
            if name == 'tx' and isinstance(a, ast.Constant) and isinstance(a.value, str):
                pykeys.setdefault(a.value, where)
            elif name == 'tx' and isinstance(a, ast.Subscript) and isinstance(a.value, ast.Dict):
                for v in a.value.values:
                    pykeys.setdefault(v.value, where)
            elif name == 'log' and f.name in ('room.py', 'server.py', 'api_room.py') and isinstance(a, ast.Constant):
                pykeys.setdefault(a.value, where)
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) \
                and node.targets[0].id in PY_TABLES:
            kind, arg = PY_TABLES[node.targets[0].id]
            where = f'{f.name}:{node.targets[0].id}'
            if kind == 'values':
                for x in node.value.values:
                    if isinstance(x, ast.Constant):
                        pykeys.setdefault(x.value, where)
            elif kind == 'keys':
                for d in ast.walk(node.value):
                    if isinstance(d, ast.Dict):
                        for k, x in zip(d.keys, d.values):
                            if isinstance(k, ast.Constant) and k.value in arg and isinstance(x, ast.Constant):
                                pykeys.setdefault(x.value, where)
            else:
                for t in ast.walk(node.value):
                    if isinstance(t, ast.Tuple) and len(t.elts) > arg and isinstance(t.elts[arg], ast.Constant):
                        pykeys.setdefault(t.elts[arg].value, where)
src = (ROOT / 'dubkanka' / 'lang_en.py').read_text(encoding='utf-8')
PYEN = ast.literal_eval(src[src.index('{'):src.rindex('}') + 1])
for k, where in pykeys.items():
    if k not in PYEN and (TR.search(k) or '|' in k[:8]):
        report('PY MISSING ', json.dumps(k, ensure_ascii=False), where)
for k, v in PYEN.items():
    if k not in pykeys:
        report('PY UNUSED  ', json.dumps(k, ensure_ascii=False))
    placeholders_match(k, v if isinstance(v, tuple) else [v])

for p in problems:
    print(p)
print(f'web: {web_count[0]} texts, {web_count[1]} English entries · server: {len(pykeys)} texts, {len(PYEN)} English entries '
      f'· {len(problems)} problems')
sys.exit(1 if problems else 0)
