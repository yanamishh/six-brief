/* SIX Бриф — рушій анкети. Дані питань у brief-concept.js та brief-tech.js */
(function () {
  'use strict';
  var CFG = Object.assign({ endpoint: '', contactUrl: '' }, window.SIX_CONFIG || {});
  var qs = new URLSearchParams(location.search);
  var BK = qs.get('b') === 'tech' ? 'tech' : 'concept';
  var B = window.SIX_BRIEFS[BK];
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var ls = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  function gid() {
    var a = new Uint8Array(8), al = 'abcdefghjkmnpqrstuvwxyz23456789', s = '';
    (window.crypto || window.msCrypto).getRandomValues(a);
    for (var i = 0; i < a.length; i++) s += al[a[i] % al.length];
    return s;
  }
  var okId = function (v) { return /^[a-z0-9]{6,20}$/.test(v || '') ? v : ''; };
  var client = okId(qs.get('c')) || okId(ls.get('six:client')) || (CFG.endpoint ? '' : gid());
  if (client) ls.set('six:client', client);
  var locked = false;
  var KEY = function (b) { return 'six:' + (b || BK) + ':' + client; };

  var S = { a: {}, cur: 'welcome', t: 0, done: false };

  /* ---------- стан ---------- */
  function loadLocal() {
    try { var d = JSON.parse(ls.get(KEY()) || 'null'); if (d) S = Object.assign(S, d); } catch (e) {}
    if (B.prefill) {
      var other = BK === 'tech' ? 'concept' : 'tech', od = null;
      try { od = JSON.parse(ls.get(KEY(other)) || 'null'); } catch (e) {}
      if (od && od.a) B.prefill.forEach(function (k) { if (!nonEmpty(S.a[k]) && nonEmpty(od.a[k])) S.a[k] = od.a[k]; });
    }
  }
  function nonEmpty(v) {
    if (v == null) return false;
    if (typeof v === 'string') return v.trim() !== '';
    if (Array.isArray(v)) return v.some(function (x) { return typeof x === 'object' ? nonEmpty(x) : nonEmpty(x); });
    if (typeof v === 'object') return Object.keys(v).some(function (k) { return nonEmpty(v[k]); });
    return true;
  }
  function ruleOk(r) {
    var v = S.a[r.q], is = function (x) { return Array.isArray(v) ? v.indexOf(x) > -1 : v === x; };
    if (r.op === 'is') return is(r.v);
    if (r.op === 'isNot') return !is(r.v);
    if (r.op === 'filled') return nonEmpty(v);
    if (r.op === 'empty') return !nonEmpty(v);
    return true;
  }
  function showOk(q) {
    var sr = q.showRules;
    if (sr && sr.rules && sr.rules.length) return sr.mode === 'any' ? sr.rules.some(ruleOk) : sr.rules.every(ruleOk);
    return !q.show || q.show(S.a);
  }
  var FROM_TYPES = ['rate', 'multitext', 'matrix'];
  var vis = function (q) {
    if (!showOk(q)) return false;
    if (q.itemsFrom && FROM_TYPES.indexOf(q.type) > -1 && !(Array.isArray(S.a[q.itemsFrom]) && S.a[q.itemsFrom].length)) return false;
    return !q.items || typeof q.items !== 'function' || q.items(S.a).length > 0;
  };
  function pages() {
    var P = [{ k: 'welcome' }];
    B.sections.forEach(function (s, si) {
      var list = B.questions.filter(function (q) { return q.sec === s.id && vis(q); });
      if (!list.length) return;
      P.push({ k: 's:' + s.id, sec: s, n: list.length, no: si + 1 });
      list.forEach(function (q) { P.push({ k: 'q:' + q.id, q: q, sec: s }); });
    });
    P.push({ k: 'review' });
    return P;
  }
  function stats() {
    var all = B.questions.filter(vis), done = all.filter(function (q) { return nonEmpty(S.a[q.id]); });
    return { total: all.length, done: done.length };
  }

  /* ---------- збереження ---------- */
  var saveTimer = null, saveEl = $('#save');
  function status(t, cls) { saveEl.textContent = t; saveEl.className = 'save ' + (cls || ''); }
  function persist() {
    S.t = Date.now();
    var ok = ls.set(KEY(), JSON.stringify({ a: S.a, cur: S.cur, t: S.t, done: S.done }));
    if (CFG.endpoint) { status('Зберігаємо…', 'busy'); clearTimeout(saveTimer); saveTimer = setTimeout(function () { remote('save').then(function (r) { status(r && r.ok ? 'Збережено' : 'Збережено на цьому пристрої', r && r.ok ? 'ok' : ''); }, function () { status('Збережено на цьому пристрої', ''); }); }, 1400); }
    else status(ok ? 'Збережено в браузері' : 'Не вдалося зберегти', ok ? 'ok' : 'off');
  }
  function payload(action) {
    var st = stats();
    return {
      action: action, client: client, brief: BK, briefTitle: B.title,
      answers: S.a, readable: readable(), progress: st.total ? Math.round(st.done / st.total * 100) : 0,
      name: S.a.name || '', email: S.a.email || '', phone: S.a.phone || '', done: !!S.done, updatedAt: S.t || Date.now(), page: location.origin + location.pathname
    };
  }
  function remote(action, extra) {
    if (!CFG.endpoint) return Promise.resolve(null);
    var body = JSON.stringify(Object.assign(payload(action), extra || {}));
    return fetch(CFG.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body }).then(function (r) { return r.json(); });
  }
  window.addEventListener('pagehide', function () {
    if (CFG.endpoint && navigator.sendBeacon && S.t && !S.done) { try { navigator.sendBeacon(CFG.endpoint, new Blob([JSON.stringify(payload('save'))], { type: 'text/plain;charset=utf-8' })); } catch (e) {} }
  });
  function pullRemote() {
    if (!CFG.endpoint) return Promise.resolve(null);
    var ctl = new AbortController(), to = setTimeout(function () { ctl.abort(); }, 4500);
    return fetch(CFG.endpoint + '?action=load&client=' + encodeURIComponent(client) + '&brief=' + BK, { signal: ctl.signal })
      .then(function (r) { return r.json(); })
      .then(function (r) {
        clearTimeout(to);
        if (r && r.ok && r.valid === false) return false;
        if (r && r.ok && r.valid && r.name && !nonEmpty(S.a.name) && BK === 'concept') S.a.name = r.name;
        if (r && r.ok && r.data && r.data.answers && (r.data.updatedAt || 0) > (S.t || 0)) { S.a = r.data.answers; S.t = r.data.updatedAt; S.done = !!r.data.done; if (r.data.page && !S.cur) S.cur = r.data.page; }
        return r && r.ok ? true : null;
      }).catch(function () { clearTimeout(to); return null; });
  }

  /* ---------- допоміжні ---------- */
  function optsOf(q) {
    var raw = q.optsFrom ? (Array.isArray(S.a[q.optsFrom]) ? S.a[q.optsFrom] : []) : (typeof q.opts === 'function' ? q.opts(S.a) : (q.opts || []));
    return raw.map(function (o, i) { return typeof o === 'string' ? { v: o, l: o, i: i } : { v: o.v || o.l, l: o.l, d: o.d, i: i, img: o.img, fit: o.fit }; });
  }
  function itemsOf(q) { var r = (q.itemsFrom && FROM_TYPES.indexOf(q.type) > -1) ? (Array.isArray(S.a[q.itemsFrom]) ? S.a[q.itemsFrom] : []) : (typeof q.items === 'function' ? q.items(S.a) : (q.items || [])); return r.map(function (o) { return typeof o === 'string' ? { id: o, l: o } : o; }); }
  var TRUST = '_trust', OTHER = '_other';
  function labelOf(q, v) {
    if (v === TRUST) return 'Не знаю / довіряю дизайнеру';
    if (v === OTHER) return 'Інше';
    var o = optsOf(q).filter(function (x) { return x.v === v; })[0]; return o ? o.l : v;
  }
  function fmt(q, v) {
    var t = q.type;
    if (v === TRUST) return 'Не знаю / довіряю дизайнеру';
    if (t === 'single' || t === 'cards') {
      if (q.multi) { return (v || []).map(function (x) { return x === OTHER ? 'Інше: ' + (S.a[q.id + '__o'] || '') : labelOf(q, x); }).join('; '); }
      return v === OTHER ? 'Інше: ' + (S.a[q.id + '__o'] || '') : labelOf(q, v);
    }
    if (t === 'rate') return itemsOf(q).map(function (it) { return v && v[it.id] ? it.l + ': ' + v[it.id] + '/5' : null; }).filter(Boolean).join('; ');
    if (t === 'grid') return (q.rows || []).map(function (r) { return v && v[r.id] ? r.l + ': ' + v[r.id] : null; }).filter(Boolean).join('; ');
    if (t === 'repeat') return (v || []).filter(nonEmpty).map(function (p, i) { return (i + 1) + ') ' + q.fields.map(function (f) { return p[f.id] ? f.l + ': ' + p[f.id] : null; }).filter(Boolean).join(', '); }).join(' | ');
    if (t === 'files') return (v || []).map(function (f) { return f.name + (f.url ? ' (' + f.url + ')' : ''); }).join('; ');
    if (t === 'multitext') return itemsOf(q).map(function (it) { return v && v[it.id] ? it.l + ': ' + v[it.id] : null; }).filter(Boolean).join(' | ');
    if (t === 'matrix') return itemsOf(q).map(function (it) { var c = v && v[it.id]; return c && c.length ? it.l + ' → ' + c.join(', ') : null; }).filter(Boolean).join(' | ');
    if (t === 'date' && v) { var d = new Date(v); return isNaN(d) ? v : d.toLocaleDateString('uk-UA'); }
    return String(v);
  }
  /* вибрані картинки (для PDF студії): абсолютні посилання на фото обраних карток */
  function picked(q) {
    if (q.type !== 'cards') return undefined;
    var v = S.a[q.id], sel = Array.isArray(v) ? v : [v], out = [];
    optsOf(q).forEach(function (o) {
      if (o.v === OTHER || sel.indexOf(o.v) < 0) return;
      try { out.push({ l: o.l, u: new URL(imgSrc(q, o), location.href).href }); } catch (e) {}
    });
    return out.length ? out : undefined;
  }
  function readable() {
    return B.sections.map(function (s) {
      return { section: s.title, items: B.questions.filter(function (q) { return q.sec === s.id && vis(q) && nonEmpty(S.a[q.id]); }).map(function (q) { return { q: q.title, a: fmt(q, S.a[q.id]), imgs: picked(q) }; }) };
    }).filter(function (s) { return s.items.length; });
  }

  /* ---------- розмітка ---------- */
  var ICON = '<svg viewBox="0 0 24 24"><path d="M3 17l5-5 4 4 3-3 6 6M3 5h18v14H3z"/></svg>';
  var CHECK = '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" stroke-dasharray="24" stroke-dashoffset="0"/></svg>';
  function fitAttr(f) { if (!f) return ''; var x = f.x == null ? 50 : f.x, y = f.y == null ? 50 : f.y, z = f.z || 1; return ' style="object-position:' + x + '% ' + y + '%;transform-origin:' + x + '% ' + y + '%;transform:scale(' + z + ')"'; }
  function imgSrc(q, o) { return o.img || ('img/' + q.id + '/' + (o.i + 1) + '.jpg'); }
  function words(t) { return esc(t).split(' ').map(function (w, i) { return '<span class="w" style="--i:' + i + '">' + w + '</span>'; }).join(' '); }

  var stage = $('#stage'), nav = $('#nav'), bar = $('#bar');

  /* ---- без прокрутки на компьютере: если страница не помещается, она равномерно уменьшается ---- */
  var fitRaf = 0;
  function fitPage() {
    if (!matchMedia('(min-width:821px)').matches) return;
    var root = document.documentElement, app = $('.app');
    root.style.setProperty('--fit', '1');
    if (!app) return;
    var S0 = app.scrollHeight, H = window.innerHeight;
    if (S0 > H + 1) root.style.setProperty('--fit', Math.max(0.55, Math.min(1, H / S0)).toFixed(4));
  }
  function fitSoon() { cancelAnimationFrame(fitRaf); fitRaf = requestAnimationFrame(function () { fitRaf = requestAnimationFrame(fitPage); }); }
  new MutationObserver(fitSoon).observe(stage, { childList: true, subtree: true });
  window.addEventListener('resize', fitSoon);
  document.addEventListener('input', fitSoon);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitSoon);
  window.addEventListener('load', fitSoon);

  var curQ = null;

  function go(key, back) { if (locked) return;
    S.cur = key; persist(); render(back);
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  }
  function idx() { if (S.cur === 'done') return { P: [{ k: 'done' }], i: 0 }; var P = pages(), i = P.findIndex(function (p) { return p.k === S.cur; }); if (i < 0) { i = 0; S.cur = 'welcome'; } return { P: P, i: i }; }
  function next() { var x = idx(); if (curQ && !validate(curQ)) return; var n = x.P[x.i + 1]; if (n) go(n.k); }
  function prev() { var x = idx(); var p = x.P[x.i - 1]; if (p) go(p.k, true); }

  function validate(q) {
    var v = S.a[q.id], err = $('#err');
    var bad = null;
    if (q.req && !nonEmpty(v)) bad = 'Це поле потрібне, щоб ми могли з вами зв’язатися.';
    else if (q.type === 'email' && nonEmpty(v) && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim())) bad = 'Схоже, в адресі помилка. Перевірте, будь ласка.';
    else if (q.type === 'tel' && nonEmpty(v) && v.replace(/\D/g, '').length < 9) bad = 'Вкажіть номер повністю, разом із кодом.';
    if (bad) { if (err) err.textContent = bad; var c = $('.ctl'); if (c) { c.classList.remove('shake'); void c.offsetWidth; c.classList.add('shake'); } return false; }
    return true;
  }

  function render(back) {
    var x = idx(), p = x.P[x.i];
    curQ = p.q || null;
    stage.className = 'stage' + (back ? ' back' : '');
    var st = stats();
    bar.style.width = (p.k === 'welcome' ? 0 : (p.k === 'done' ? 100 : Math.round(x.i / (x.P.length - 1) * 100))) + '%';
    var html = '', navHtml = '';
    if (p.k === 'welcome') html = welcomeHtml();
    else if (p.k === 'review') html = reviewHtml();
    else if (p.k === 'done') html = doneHtml();
    else if (p.sec && p.k[0] === 's') html = sectionHtml(p);
    else html = questionHtml(p.q, p.sec);
    stage.innerHTML = html;
    stage.dataset.k = p.k;
    // навігація
    if (p.k === 'welcome' || p.k === 'done') { nav.hidden = true; }
    else {
      nav.hidden = false;
      var isQ = !!p.q;
      var skip = '';
      if (isQ && !p.q.req) {
        skip = '<button class="btn ghost" id="skip" type="button">' + (p.q.trust ? 'Не знаю, довіряю дизайнеру' : 'Пропустити') + '</button>';
      }
      var last = x.P[x.i + 1] && x.P[x.i + 1].k === 'review';
      navHtml = '<div class="l"><button class="btn ghost" id="back" type="button">← Назад</button></div>' +
        '<div class="r">' + skip + '<button class="btn main" id="next" type="button">' + (p.k === 'review' ? 'Надіслати бриф' : (p.k[0] === 's' ? 'Почнемо' : (last ? 'До підсумку' : 'Далі'))) + '<span class="kbd">Enter ↵</span></button></div>';
      nav.innerHTML = navHtml;
      if (p.k === 'review') { $('#next').onclick = submit; }
      else { $('#next').onclick = next; }
      $('#back').onclick = prev;
      var sk = $('#skip'); if (sk) sk.onclick = function () { if (p.q.trust) { S.a[p.q.id] = TRUST; persist(); } next(); };
    }
    if (p.q) bindQuestion(p.q);
    if (p.k === 'welcome') bindWelcome();
    if (p.k === 'review') bindReview();
    var f = $('.inp,.ta', stage); if (f && p.q && !matchMedia('(pointer:coarse)').matches) setTimeout(function () { f.focus({ preventScroll: true }); }, 60);
    var m = Math.max(0, st.total - st.done);
    document.title = (p.q ? p.sec.title + ' · ' : '') + 'SIX Бриф';
  }

  function welcomeHtml() {
    var st = stats(), started = st.done > 0 && !S.done;
    var link = location.origin && location.origin !== 'null' ? location.origin + location.pathname + '?b=' + BK + '&c=' + client : location.href;
    var res = '';
    if (started) res = '<div class="resume"><b>З поверненням!</b> Ви вже відповіли на ' + st.done + ' з ' + st.total + ' питань. Продовжимо з того місця, де зупинилися.<div class="link"><input readonly value="' + esc(link) + '" id="lnk" aria-label="Особисте посилання"><button type="button" id="cp">Копіювати</button></div></div>';
    else if (S.done) res = '<div class="resume"><b>Бриф уже надіслано.</b> Ви можете переглянути й змінити відповіді та надіслати ще раз.</div>';
    var main = started ? 'Продовжити' : (S.done ? 'Переглянути відповіді' : 'Почати');
    return '<div class="hero"><div><p class="eyebrow">' + esc(B.eyebrow) + '</p><h1>' + words(B.title) + '</h1><p class="hint">' + B.welcome + '</p>' +
      '<div class="meta"><span>' + esc(B.time) + '</span><span>Відповіді зберігаються автоматично</span><span>Можна пропускати питання</span></div>' + res +
      '<div style="display:flex;gap:12px;flex-wrap:wrap"><button class="btn main" id="start" type="button">' + main + '</button>' + (started ? '<button class="btn ghost" id="reset" type="button">Почати спочатку</button>' : '') + '</div><p class="consent">Натискаючи «' + main + '», ви погоджуєтеся, що ваші відповіді буде використано лише для підготовки дизайн-проєкту. Їх бачить тільки команда SIX Studio, ми нікому їх не передаємо.</p></div>' +
      '</div>';
  }
  function bindWelcome() {
    $('#start').onclick = function () {
      var P = pages();
      if (S.done) return go('review');
      var st = stats();
      if (st.done > 0 && S.cur && S.cur !== 'welcome' && P.some(function (p) { return p.k === S.cur; })) return go(S.cur);
      go(P[1].k);
    };
    var r = $('#reset'); if (r) r.onclick = function () { if (r.dataset.s) { S.a = {}; S.done = false; S.cur = 'welcome'; persist(); render(); } else { r.dataset.s = 1; r.textContent = 'Точно? Відповіді зникнуть'; } };
    var c = $('#cp'); if (c) c.onclick = function () { var i = $('#lnk'); i.select(); (navigator.clipboard ? navigator.clipboard.writeText(i.value) : Promise.reject()).catch(function () { document.execCommand('copy'); }); c.textContent = 'Скопійовано'; };
    var u = location.origin && location.origin !== 'null' ? location.pathname + '?b=' + BK + '&c=' + client : null;
    if (u) try { history.replaceState(null, '', u); } catch (e) {}
  }

  function sectionHtml(p) {
    var s = p.sec;
    return '<div class="sec"><div><div class="no">' + String(p.no).padStart(2, '0') + '</div><p class="eyebrow">' + esc(B.title) + '</p><h1>' + words(s.title) + '</h1><p class="hint">' + s.intro + '</p>' +
      '<div class="meta"><span>' + p.n + ' ' + plural(p.n) + '</span><span>≈ ' + Math.max(1, Math.round(p.n * 0.35)) + ' хв</span></div></div>' +
      '</div>';
  }
  function plural(n) { var m = n % 10, h = n % 100; return (m === 1 && h !== 11) ? 'питання' : ((m >= 2 && m <= 4 && (h < 12 || h > 14)) ? 'питання' : 'питань'); }

  function questionHtml(q, sec) {
    var x = idx(), n = 0, tot = 0;
    B.questions.filter(function (z) { return z.sec === sec.id && vis(z); }).forEach(function (z, i) { tot++; if (z.id === q.id) n = i + 1; });
    var h = '<p class="eyebrow">' + esc(sec.title) + ' · ' + n + '/' + tot + '</p><h1>' + words(q.title) + (q.req ? ' <span class="req">*</span>' : '') + '</h1>' + (q.hint ? '<p class="hint">' + q.hint + '</p>' : ((q.type === 'single' || q.type === 'cards') && q.multi ? '<p class="hint">Можна обрати декілька варіантів.</p>' : ''));
    h += '<div class="ctl">' + control(q) + '</div><div class="err" id="err" role="alert"></div>';
    var secNo = String(B.sections.indexOf(sec) + 1).padStart(2, '0');
    return '<div class="qv' + (q.type === 'cards' ? ' wide' : '') + '"><div class="big" aria-hidden="true"><div class="bn">' + secNo + '</div><p class="bt">' + esc(sec.title) + '</p></div>' + h + '</div>';
  }

  function control(q) {
    var v = S.a[q.id], t = q.type, o, h = '';
    if (t === 'date') return '<div class="dt"><input class="inp" id="f" type="text" inputmode="numeric" maxlength="10" autocomplete="off" placeholder="ДД.ММ.РРРР" value="' + esc(dateShow(v === TRUST ? '' : v || '')) + '"><button class="dtb" type="button" aria-label="Календар"><svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg></button><div class="cal"></div></div>';
    if (t === 'text' || t === 'email' || t === 'tel' || t === 'number')
      return '<input class="inp" id="f" type="' + (t === 'text' ? 'text' : t) + '"' + (t === 'tel' ? ' inputmode="tel"' : '') + (t === 'number' ? ' inputmode="decimal"' : '') + ' autocomplete="' + (q.ac || 'off') + '" placeholder="' + esc(q.ph || '') + '" value="' + esc(v === TRUST ? '' : v || '') + '">';
    if (t === 'long') return '<textarea class="ta" id="f" placeholder="' + esc(q.ph || 'Напишіть своїми словами…') + '">' + esc(v === TRUST ? '' : v || '') + '</textarea>';
    if (t === 'single' || (t === 'cards')) {
      var multi = !!q.multi, sel = multi ? (Array.isArray(v) ? v : []) : [v];
      var os = optsOf(q);
      if (q.other) os.push({ v: OTHER, l: 'Інше', i: os.length });
      if (t === 'cards') {
        var cn = os.length, cc = cn <= 4 ? cn : (cn <= 6 ? 3 : (cn <= 8 ? 4 : (cn <= 10 ? 5 : 6)));
        h = '<div class="cards' + (q.swatch ? ' sw' : '') + '" data-multi="' + (multi ? 1 : 0) + '" style="--cols:' + cc + ';--rows:' + Math.ceil(cn / cc) + '">';
        os.forEach(function (o, i) {
          h += '<button type="button" class="card' + (sel.indexOf(o.v) > -1 ? ' on' : '') + '" data-v="' + esc(o.v) + '" style="--i:' + i + '"><div class="ph">' + (o.v === OTHER ? ICON : ICON + '<img src="' + esc(imgSrc(q, o)) + '" alt="" loading="lazy"' + fitAttr(o.fit) + ' onerror="this.remove()">') + '</div><div class="tx"><b>' + esc(o.l) + '</b>' + (o.d ? '<small>' + esc(o.d) + '</small>' : '') + '</div><span class="ck">' + CHECK + '</span></button>';
        });
        h += '</div>';
      } else {
        h = '<div class="opts ' + (multi ? 'multi' : 'single') + (os.length > 6 ? ' many' : '') + '" data-multi="' + (multi ? 1 : 0) + '" style="--n:' + os.length + ';--r:' + Math.ceil(os.length / 2) + '">';
        os.forEach(function (o, i) {
          h += '<button type="button" class="opt' + (sel.indexOf(o.v) > -1 ? ' on' : '') + '" data-v="' + esc(o.v) + '" style="--i:' + i + '"><i>' + (i + 1) + '</i><span>' + esc(o.l) + (o.d ? '<small>' + esc(o.d) + '</small>' : '') + '</span></button>';
        });
        h += '</div>';
      }
      if (q.other) h += '<div class="other-in" id="oth"' + (sel.indexOf(OTHER) > -1 ? '' : ' hidden') + '><input class="inp" id="o" placeholder="Напишіть, що саме" value="' + esc(S.a[q.id + '__o'] || '') + '"></div>';
      return h;
    }
    if (t === 'rate') {
      h = '<div class="scale-lbl"><span>1 — найважливіше</span><span>5 — не так важливо</span></div><div class="rows">';
      itemsOf(q).forEach(function (it) {
        h += '<div class="row" data-id="' + esc(it.id) + '"><b>' + esc(it.l) + '</b><div class="pills">' + [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" class="pill' + (v && v[it.id] == n ? ' on' : '') + '" data-n="' + n + '">' + n + '</button>'; }).join('') + '</div></div>';
      });
      return h + '</div>';
    }
    if (t === 'grid') {
      h = '<div class="rows">';
      q.rows.forEach(function (r) {
        h += '<div class="row col" data-id="' + esc(r.id) + '"><b>' + esc(r.l) + '</b><div class="pills">' + r.opts.map(function (o) { return '<button type="button" class="pill' + (v && v[r.id] === o ? ' on' : '') + '" data-v="' + esc(o) + '">' + esc(o) + '</button>'; }).join('') + '</div></div>';
      });
      return h + '</div>';
    }
    if (t === 'repeat') {
      var arr = Array.isArray(v) && v.length ? v : [{}];
      h = '<div id="reps">';
      arr.forEach(function (p, i) { h += repHtml(q, p, i, arr.length); });
      h += '</div><button type="button" class="add" id="addrep">+ ' + esc(q.addLabel || 'Додати') + '</button>';
      return h;
    }
    if (t === 'files') {
      var fl = Array.isArray(v) ? v : [];
      h = '<label class="drop" id="drop"><input type="file" id="fi" multiple hidden accept="' + (q.accept || 'image/*,.pdf,.dwg,.zip') + '"><b>Додати файли</b><br><span>або перетягніть сюди · до 8 МБ кожен</span></label><div class="files" id="fl">';
      fl.forEach(function (f, i) { h += fileRow(f, i); });
      return h + '</div>' + (CFG.endpoint ? '' : '<p class="hint" style="margin-top:12px;font-size:14px">Завантаження файлів запрацює після підключення пошти студії.</p>');
    }
    if (t === 'multitext') {
      h = '<div class="rows">';
      itemsOf(q).forEach(function (it) { h += '<div><label style="font-weight:500;display:block;margin-bottom:6px">' + esc(it.l) + '</label><textarea class="ta sm" data-id="' + esc(it.id) + '" placeholder="' + esc(q.ph || '') + '">' + esc(v && v[it.id] || '') + '</textarea></div>'; });
      return h + '</div>';
    }
    if (t === 'matrix') {
      var cols = typeof q.cols === 'function' ? q.cols(S.a) : q.cols;
      h = '<div class="mx"><table><thead><tr><th></th>' + cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('') + '</tr></thead><tbody>';
      itemsOf(q).forEach(function (it) {
        h += '<tr><td>' + esc(it.l) + '</td>' + cols.map(function (c) { return '<td><input type="checkbox" data-id="' + esc(it.id) + '" data-c="' + esc(c) + '" aria-label="' + esc(it.l + ' — ' + c) + '"' + (v && v[it.id] && v[it.id].indexOf(c) > -1 ? ' checked' : '') + '></td>'; }).join('') + '</tr>';
      });
      return h + '</tbody></table></div>';
    }
    return '';
  }
  function repHtml(q, p, i, n) {
    var h = '<div class="rep" data-i="' + i + '"><h3>' + esc(q.itemLabel || 'Особа') + ' ' + (i + 1) + '</h3>' + (n > 1 ? '<button type="button" class="rm" data-i="' + i + '">Видалити</button>' : '');
    q.fields.forEach(function (f) { h += '<label>' + esc(f.l) + '</label><input class="inp" data-f="' + f.id + '" value="' + esc(p[f.id] || '') + '" placeholder="' + esc(f.ph || '') + '">'; });
    return h + '</div>';
  }
  function fileRow(f, i) { return '<div class="file"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0">' + esc(f.name) + ' · завантажено</span><button type="button" data-i="' + i + '" aria-label="Видалити">✕</button></div>'; }

  /* ---------- події питань ---------- */

  /* ---- поле даты: вписать (маска ДД.ММ.РРРР) или выбрать в календаре ---- */
  var MN = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень', 'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'], WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function dateShow(v) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ''); return m ? m[3] + '.' + m[2] + '.' + m[1] : (v || ''); }
  function dateParse(v) { var m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(v || ''); if (!m) return null; var d = new Date(+m[3], +m[2] - 1, +m[1]); return d.getMonth() === +m[2] - 1 ? d : null; }
  function dateFmt(d) { return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear(); }
  function dateMask(s) { var d = s.replace(/\D/g, '').slice(0, 8); return d.length > 4 ? d.slice(0, 2) + '.' + d.slice(2, 4) + '.' + d.slice(4) : d.length > 2 ? d.slice(0, 2) + '.' + d.slice(2) : d; }
  function bindDate(f, q) {
    var w = f.closest('.dt'), cal = $('.cal', w), btn = $('.dtb', w);
    function save() { S.a[q.id] = f.value; persist(); }
    function draw(y, m) {
      var sel = dateParse(f.value), now = new Date(), off = (new Date(y, m, 1).getDay() + 6) % 7, days = new Date(y, m + 1, 0).getDate(), h = '', i;
      for (i = 0; i < 7; i++) h += '<i>' + WD[i] + '</i>';
      for (i = 0; i < off; i++) h += '<span></span>';
      for (i = 1; i <= days; i++) {
        var c = '';
        if (sel && sel.getFullYear() === y && sel.getMonth() === m && sel.getDate() === i) c += ' on';
        if (now.getFullYear() === y && now.getMonth() === m && now.getDate() === i) c += ' td';
        h += '<button type="button" class="' + c.trim() + '" data-d="' + i + '">' + i + '</button>';
      }
      cal.innerHTML = '<div class="ch"><button type="button" data-n="-1">&#8592;</button><b>' + MN[m] + ' ' + y + '</b><button type="button" data-n="1">&#8594;</button></div><div class="g">' + h + '</div>';
      w.dataset.y = y; w.dataset.m = m;
    }
    f.addEventListener('input', function () { f.value = dateMask(f.value); save(); });
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var o = w.classList.toggle('open');
      if (o) { var s = dateParse(f.value) || new Date(); draw(s.getFullYear(), s.getMonth()); }
    });
    cal.addEventListener('click', function (e) {
      e.stopPropagation();
      var n = e.target.closest('[data-n]'), d = e.target.closest('[data-d]');
      if (n) { var y = +w.dataset.y, m = +w.dataset.m + +n.dataset.n; if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; } draw(y, m); }
      if (d) { f.value = dateFmt(new Date(+w.dataset.y, +w.dataset.m, +d.dataset.d)); w.classList.remove('open'); save(); }
    });
    document.addEventListener('click', function (e) { if (!w.contains(e.target)) w.classList.remove('open'); });
  }

  document.addEventListener('touchmove', function (e) { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (ev) { document.addEventListener(ev, function (e) { e.preventDefault(); }); });

  function bindQuestion(q) {
    var t = q.type;
    var f = $('#f');
    if (f && (t === 'text' || t === 'email' || t === 'tel' || t === 'number' || t === 'date' || t === 'long')) {
      f.addEventListener('input', function () { S.a[q.id] = f.value; persist(); });
      if (t === 'date') bindDate(f, q);
    }
    if (t === 'single' || t === 'cards') {
      var box = $(t === 'cards' ? '.cards' : '.opts'), multi = box.dataset.multi === '1';
      var oth = $('#oth'), oi = $('#o');
      if (oi) oi.addEventListener('input', function () { S.a[q.id + '__o'] = oi.value; persist(); });
      box.addEventListener('click', function (e) {
        var b = e.target.closest('[data-v]'); if (!b) return; pick(q, b.dataset.v, multi, box, oth);
      });
    }
    if (t === 'rate') $('.rows').addEventListener('click', function (e) {
      var b = e.target.closest('.pill'); if (!b) return; var row = b.closest('.row'), id = row.dataset.id;
      S.a[q.id] = S.a[q.id] && typeof S.a[q.id] === 'object' ? S.a[q.id] : {};
      var n = +b.dataset.n; if (S.a[q.id][id] === n) delete S.a[q.id][id]; else S.a[q.id][id] = n;
      row.querySelectorAll('.pill').forEach(function (p) { p.classList.toggle('on', +p.dataset.n === S.a[q.id][id]); }); persist();
    });
    if (t === 'grid') $('.rows').addEventListener('click', function (e) {
      var b = e.target.closest('.pill'); if (!b) return; var row = b.closest('.row'), id = row.dataset.id;
      S.a[q.id] = S.a[q.id] && typeof S.a[q.id] === 'object' ? S.a[q.id] : {};
      S.a[q.id][id] = S.a[q.id][id] === b.dataset.v ? undefined : b.dataset.v;
      row.querySelectorAll('.pill').forEach(function (p) { p.classList.toggle('on', p.dataset.v === S.a[q.id][id]); }); persist();
    });
    if (t === 'repeat') {
      var reps = $('#reps');
      var readReps = function () { var out = []; reps.querySelectorAll('.rep').forEach(function (r) { var o = {}; r.querySelectorAll('[data-f]').forEach(function (i) { o[i.dataset.f] = i.value; }); out.push(o); }); S.a[q.id] = out; persist(); };
      reps.addEventListener('input', readReps);
      reps.addEventListener('click', function (e) { var b = e.target.closest('.rm'); if (!b) return; readReps(); S.a[q.id].splice(+b.dataset.i, 1); persist(); reRender(); });
      $('#addrep').onclick = function () { readReps(); if ((S.a[q.id] || []).length >= (q.max || 8)) return; S.a[q.id].push({}); persist(); reRender(); var l = reps.querySelectorAll('.rep'); var ii = l[l.length - 1] && l[l.length - 1].querySelector('input'); if (ii) ii.focus(); };
    }
    if (t === 'multitext') $('.rows').addEventListener('input', function (e) { var a = e.target.closest('textarea'); if (!a) return; S.a[q.id] = S.a[q.id] || {}; S.a[q.id][a.dataset.id] = a.value; persist(); });
    if (t === 'matrix') $('.mx').addEventListener('change', function (e) {
      var c = e.target; if (!c.dataset.id) return; var cur = (S.a[q.id] = S.a[q.id] || {}); var arr = cur[c.dataset.id] || [];
      arr = c.checked ? arr.concat(c.dataset.c) : arr.filter(function (z) { return z !== c.dataset.c; }); cur[c.dataset.id] = arr; persist();
    });
    if (t === 'files') bindFiles(q);
  }
  function reRender() { var y = window.scrollY; render(); window.scrollTo(0, y); }
  function pick(q, v, multi, box, oth) {
    if (multi) {
      var arr = Array.isArray(S.a[q.id]) ? S.a[q.id].slice() : [], i = arr.indexOf(v);
      if (i > -1) arr.splice(i, 1); else arr.push(v);
      S.a[q.id] = arr;
      box.querySelectorAll('[data-v]').forEach(function (b) { b.classList.toggle('on', arr.indexOf(b.dataset.v) > -1); });
      if (oth) oth.hidden = arr.indexOf(OTHER) < 0;
      persist();
      var needRe = B.questions.some(function (z) { return z.show || typeof z.items === 'function'; });
      if (needRe && (q.id === 'rooms' || q.dyn)) { var P = pages(); /* лише оновлюємо лічильники */ }
    } else {
      S.a[q.id] = v;
      box.querySelectorAll('[data-v]').forEach(function (b) { b.classList.toggle('on', b.dataset.v === v); });
      if (oth) oth.hidden = v !== OTHER;
      persist();
      if (v !== OTHER) setTimeout(function () { if (stage.dataset.k === 'q:' + q.id) next(); }, 800);
      else { var oi = $('#o'); if (oi) oi.focus(); }
    }
  }
  function bindFiles(q) {
    var fi = $('#fi'), drop = $('#drop'), fl = $('#fl');
    var add = function (list) {
      Array.prototype.forEach.call(list, function (file) {
        if (file.size > 8 * 1024 * 1024) { $('#err').textContent = 'Файл «' + file.name + '» більший за 8 МБ.'; return; }
        if (!CFG.endpoint) { $('#err').textContent = 'Завантаження файлів запрацює після підключення пошти студії.'; return; }
        $('#err').textContent = '';
        var row = document.createElement('div'); row.className = 'file'; row.textContent = 'Завантажуємо: ' + file.name + '…'; fl.appendChild(row);
        var fr = new FileReader();
        fr.onload = function () {
          remote('upload', { file: { name: file.name, mime: file.type, data: String(fr.result).split(',')[1] } }).then(function (r) {
            if (r && r.ok) { S.a[q.id] = (S.a[q.id] || []).concat([{ name: file.name, url: r.url }]); persist(); reRender(); }
            else { row.textContent = 'Не вдалося завантажити «' + file.name + '». Спробуйте ще раз.'; }
          }, function () { row.textContent = 'Не вдалося завантажити «' + file.name + '». Перевірте інтернет.'; });
        };
        fr.readAsDataURL(file);
      });
    };
    fi.addEventListener('change', function () { add(fi.files); });
    ['dragenter', 'dragover'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (n) { drop.addEventListener(n, function (e) { e.preventDefault(); drop.classList.remove('over'); if (n === 'drop') add(e.dataTransfer.files); }); });
    fl.addEventListener('click', function (e) { var b = e.target.closest('button[data-i]'); if (!b) return; S.a[q.id].splice(+b.dataset.i, 1); persist(); reRender(); });
  }

  /* ---------- підсумок та відправка ---------- */
  function reviewHtml() {
    var h = '<p class="eyebrow">Підсумок</p><h1>' + words('Перевірте й надішліть') + '</h1><p class="hint">Усе, що ви вказали, збережено. Перед відправкою можна повернутися до будь-якого розділу.</p><div class="rv">';
    B.sections.forEach(function (s) {
      var list = B.questions.filter(function (q) { return q.sec === s.id && vis(q); });
      if (!list.length) return;
      var d = list.filter(function (q) { return nonEmpty(S.a[q.id]); }).length;
      h += '<div class="it"><div><b>' + esc(s.title) + '</b><small>' + d + ' з ' + list.length + ' питань</small></div><button type="button" data-go="s:' + s.id + '">Змінити</button></div>';
    });
    var miss = B.questions.filter(function (q) { return q.req && vis(q) && !nonEmpty(S.a[q.id]); });
    h += '</div><div class="err" id="err" role="alert">' + (miss.length ? 'Заповніть обов’язкові поля: ' + miss.map(function (q) { return '«' + esc(q.title) + '»'; }).join(', ') : '') + '</div>';
    return h;
  }
  function bindReview() { stage.addEventListener('click', function h(e) { var b = e.target.closest('[data-go]'); if (b) { stage.removeEventListener('click', h); go(b.dataset.go); } }); }
  function submit() {
    var miss = B.questions.filter(function (q) { return q.req && vis(q) && !nonEmpty(S.a[q.id]); });
    if (miss.length) { go('q:' + miss[0].id); setTimeout(function () { validate(miss[0]); }, 50); return; }
    var btn = $('#next'); btn.disabled = true; btn.textContent = 'Надсилаємо…';
    S.done = true; persist();
    var p = CFG.endpoint ? remote('submit') : Promise.resolve({ ok: true, local: true });
    p.then(function (r) {
      if (r && r.ok) { S.cur = 'done'; ls.set(KEY(), JSON.stringify({ a: S.a, cur: 'review', t: S.t, done: true })); render(); status(r.local ? 'Збережено в браузері' : 'Надіслано', 'ok'); }
      else throw new Error('fail');
    }).catch(function () { S.done = false; persist(); btn.disabled = false; btn.textContent = 'Надіслати бриф'; $('#err').textContent = 'Не вдалося надіслати. Відповіді збережені, спробуйте ще раз за хвилину.'; });
  }
  function doneHtml() {
    var other = '<p class="hint">Дякуємо! Ми вивчимо відповіді й підготуємося до зустрічі.</p>';   // посилання на технічний бриф прибрано (19.11.2026), щоб повернути: див. data/app.v4.bak.js
    if (!CFG.endpoint) other = '<div class="resume"><b>Тестовий режим.</b> Пошту студії ще не підключено, тому відповіді збережено лише в цьому браузері й нікуди не надіслано.</div>' + other;
    return '<div class="done-mark"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div><p class="eyebrow">Надіслано</p><h1>' + words('Дякуємо, відповіді вже у нас') + '</h1><p class="hint">Ми прочитаємо кожну відповідь і зв’яжемося з вами у зручний для вас спосіб.</p>' + other;
  }

  /* ---------- меню розділів ---------- */
  var dr = $('#drawer');
  function openMenu() {
    if (locked) return;
    var x = idx(), h = '<h2>Розділи</h2>';
    h += '<button class="it' + (S.cur === 'welcome' ? ' cur' : '') + '" data-k="welcome"><span>Початок</span></button>';
    x.P.filter(function (p) { return p.k[0] === 's' && p.sec; }).forEach(function (p) {
      var list = B.questions.filter(function (q) { return q.sec === p.sec.id && vis(q); }), d = list.filter(function (q) { return nonEmpty(S.a[q.id]); }).length;
      var cur = S.cur === p.k || (S.cur.indexOf('q:') === 0 && (B.questions.filter(function (q) { return 'q:' + q.id === S.cur; })[0] || {}).sec === p.sec.id);
      h += '<button class="it' + (cur ? ' cur' : '') + '" data-k="' + p.k + '"><span>' + esc(p.sec.title) + '</span><small>' + d + '/' + list.length + '</small></button>';
    });
    h += '<button class="it" data-k="review"><span>Підсумок і відправка</span></button>';
    $('#drawerPn').innerHTML = h; dr.classList.add('open');
  }
  $('#menuBtn').onclick = openMenu;
  $('#drawerBg').onclick = function () { dr.classList.remove('open'); };
  $('#drawerPn').onclick = function (e) { var b = e.target.closest('[data-k]'); if (b) { dr.classList.remove('open'); go(b.dataset.k); } };

  /* ---------- клавіатура ---------- */
  document.addEventListener('keydown', function (e) {
    if (locked) return;
    if (dr.classList.contains('open')) { if (e.key === 'Escape') dr.classList.remove('open'); return; }
    var tag = (e.target.tagName || '').toLowerCase();
    var k = stage.dataset.k || '';
    if (e.key === 'Enter' && tag !== 'button') {
      if (tag === 'textarea' && !(e.ctrlKey || e.metaKey)) return;
      if (k === 'welcome') { var s = $('#start'); if (s) s.click(); return; }
      if (k === 'review') return;
      e.preventDefault(); next();
    } else if (/^[1-9]$/.test(e.key) && tag !== 'input' && tag !== 'textarea' && curQ && (curQ.type === 'single' || curQ.type === 'cards')) {
      var b = stage.querySelectorAll('[data-v]')[+e.key - 1]; if (b) b.click();
    } else if (e.key === 'ArrowLeft' && tag !== 'input' && tag !== 'textarea' && k !== 'welcome') prev();
  });

  /* ---------- старт ---------- */
  function lock(kind) {
    locked = true; $('#menuBtn').hidden = true; nav.hidden = true; bar.style.width = '0'; status('', '');
    stage.className = 'stage'; stage.dataset.k = 'lock';
    stage.innerHTML = '<p class="eyebrow">SIX Studio</p><h1>' + words(kind === 'bad' ? 'Це посилання недійсне' : 'Потрібне особисте посилання') + '</h1><p class="hint">' +
      (kind === 'bad' ? 'Посилання застаріло або в ньому помилка. Напишіть нам, і ми надішлемо нове.' : 'Бриф відкривається лише за особистим посиланням, яке студія надсилає кожному клієнтові. Якщо ви його ще не отримали, напишіть нам.') + '</p>';
    document.title = 'SIX Бриф';
  }
  if (!client) { lock('none'); return; }
  loadLocal();
  $('.logo').addEventListener('click', function (e) { e.preventDefault(); if (!locked) go('welcome'); });
  status(CFG.endpoint ? '' : '', '');
  pullRemote().then(function (valid) { if (valid === false) return lock('bad');  if (S.t) ls.set(KEY(), JSON.stringify({ a: S.a, cur: S.cur, t: S.t, done: S.done })); render(); if (S.t) status(CFG.endpoint ? 'Збережено' : 'Збережено в браузері', 'ok'); });
})();
