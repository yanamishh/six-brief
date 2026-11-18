import json, glob, os, re, shutil
sp = 'C:/Users/yanam/AppData/Local/Temp/claude/c88340815acb30e6/ef0f6e27-f9b5-47fd-a538-4e6e4ffd099f/scratchpad/'
base = 'D:/инструменты/бриф/six-brief/'

def load(c):
    out = []
    for f in glob.glob(sp + 'db/' + c + '/concept__*.json') + glob.glob(sp + 'db/' + c + '/concept.json'):
        d = json.load(open(f, encoding='utf-8'))
        if 'data' in d and isinstance(d['data'], dict): d = d['data']
        out.append(d)
    return out

Q = sorted(load('questions'), key=lambda q: q['order'])
S = sorted(load('sections'), key=lambda s: s['order'])
M = json.load(open(sp + 'db/meta/concept.json', encoding='utf-8'))
if 'data' in M and isinstance(M['data'], dict): M = M['data']

# --- картинки: скачанные ассеты -> img/<id вопроса>/<номер>.jpg (с оптимизацией)
try:
    from PIL import Image
    have_pil = True
except Exception:
    have_pil = False
assets = {}
for f in glob.glob(sp + 'artifact-files/*/*.jpg'):
    assets[os.path.basename(f)[:-4]] = f
nimg = 0
def txt(s):
    return (s or '').strip()

out_q = []
for q in Q:
    o = {'sec': q['sec'], 'id': q['id'], 'type': q['type'], 'title': txt(q['title'])}
    for k in ('hint', 'ph', 'ac', 'accept', 'itemLabel', 'addLabel'):
        v = txt(q.get(k)) if isinstance(q.get(k), str) else q.get(k)
        if v: o[k] = v
    if q.get('max'): o['max'] = q['max']
    for k in ('req', 'trust', 'multi', 'other', 'swatch'):
        if q.get(k): o[k] = 1
    if q.get('optsFrom'): o['optsFrom'] = q['optsFrom']
    elif q.get('opts'):
        opts = []
        for i, op in enumerate(q['opts']):
            e = {'l': txt(op['l'])}
            if txt(op.get('d')): e['d'] = txt(op['d'])
            if op.get('img') and op['img'] in assets:
                d = base + 'img/' + q['id'] + '/'
                os.makedirs(d, exist_ok=True)
                dst = d + str(i + 1) + '.jpg'
                if have_pil:
                    im = Image.open(assets[op['img']]).convert('RGB')
                    im.thumbnail((1600, 1600)); im.save(dst, 'JPEG', quality=82, optimize=True)
                else:
                    shutil.copy(assets[op['img']], dst)
                e['img'] = 'img/' + q['id'] + '/' + str(i + 1) + '.jpg'
                if op.get('fit'): e['fit'] = op['fit']
                nimg += 1
            opts.append(e)
        o['opts'] = opts
    if q['type'] in ('rate', 'multitext', 'matrix'):
        if q.get('itemsFrom'): o['itemsFrom'] = q['itemsFrom']
        elif q.get('items'): o['items'] = q['items']
    if q.get('cols'): o['cols'] = q['cols']
    if q.get('rows'): o['rows'] = q['rows']
    if q.get('fields'): o['fields'] = q['fields']
    if q.get('show') and q['show'].get('rules'): o['showRules'] = q['show']
    out_q.append(o)

secs = [{'id': s['id'], 'title': txt(s['title']), 'intro': txt(s.get('intro'))} for s in S]
old = open(base + 'brief-concept.js', encoding='utf-8').read()
rooms_line = re.search(r"window\.SIX_ROOMS = .*?;\n", old).group(0)
meta = {'key': 'concept', 'title': M['title'], 'eyebrow': M['eyebrow'], 'time': M['time'], 'welcome': M['welcome'], 'sections': secs, 'questions': out_q}
if M.get('prefill'): meta['prefill'] = M['prefill']
js = '/* Бриф 1: концепція та простір. ЗГЕНЕРОВАНО з редактора брифа (артефакт) 19.11.2026. Правити питання в редакторі, потім казати «застосуй». */\nwindow.SIX_BRIEFS = window.SIX_BRIEFS || {};\n' + rooms_line + 'window.SIX_BRIEFS.concept = ' + json.dumps(meta, ensure_ascii=False, indent=1) + ';\n'
open(base + 'brief-concept.js', 'w', encoding='utf-8').write(js)
print('questions', len(out_q), 'sections', len(secs), 'images', nimg, 'pil', have_pil)
