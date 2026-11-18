import re, json
base = 'D:/инструменты/бриф/six-brief/'
p = base + 'data/brief-editor.html'
s = open(p, encoding='utf-8').read()
css = open(base + 'style.css', encoding='utf-8').read()
css = re.sub(r"@font-face\{[^}]*\}\n?", "", css)
m = re.search(r'var LIVE_CSS = "(?:[^"\\]|\\.)*";', s)
assert m, 'LIVE_CSS not found'
s = s[:m.start()] + 'var LIVE_CSS = ' + json.dumps(css, ensure_ascii=False) + ';' + s[m.end():]
# убираем переопределение «только в артефакте»: теперь всё это в самом style.css
m2 = re.search(r"/\* ПРАВКИ ТОЛЬКО В АРТЕФАКТЕ.*?(?=\\n\*,\*:before,\*:after\{animation:none)", s, re.S)
if m2:
    s = s[:m2.start()] + s[m2.end():]
open(p, 'w', encoding='utf-8').write(s)
sc = re.findall(r'<script>(.*?)</script>', s, re.S)[-1]
open('C:/Users/yanam/AppData/Local/Temp/claude/c88340815acb30e6/ef0f6e27-f9b5-47fd-a538-4e6e4ffd099f/scratchpad/chk.js', 'w', encoding='utf-8').write(sc)
print('synced', len(css))
