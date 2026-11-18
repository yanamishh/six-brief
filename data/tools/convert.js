global.window = {};
const fs = require('fs');
const base = 'D:/инструменты/бриф/six-brief/';
for (const f of ['config.js', 'brief-concept.js', 'brief-tech.js']) eval(fs.readFileSync(base + f, 'utf8'));
const ROOMS = window.SIX_ROOMS;

const rule = (q, op, v) => (v === undefined ? { q, op } : { q, op, v });
const manual = {
  keepWhat: { mode: 'all', rules: [rule('keep', 'is', 'Так, є меблі або предмети')] },
  keepPhotos: { mode: 'all', rules: [rule('keep', 'is', 'Так, є меблі або предмети')] },
  kids: { mode: 'all', rules: [rule('hasKids', 'is', 'Так, є діти')] },
  homework: { mode: 'all', rules: [rule('hasKids', 'is', 'Так, є діти')] },
  play: { mode: 'any', rules: [rule('hasKids', 'is', 'Так, є діти'), rule('hasKids', 'is', 'Планується')] },
  petsInfo: { mode: 'any', rules: [rule('pets', 'is', 'Собака'), rule('pets', 'is', 'Кіт'), rule('pets', 'is', '_other')] },
  expBad: { mode: 'all', rules: [rule('exp', 'is', 'Так, дещо пішло не так, хочу цього уникнути')] },
  acRooms: { mode: 'all', rules: [rule('rooms', 'filled')] },
  warmType: { mode: 'all', rules: [rule('warm', 'filled'), rule('warm', 'isNot', 'Не потрібна')] },
  kisl: { mode: 'all', rules: [rule('rooms', 'is', 'Кухня / їдальня'), rule('kfurn', 'is', 'Острів')] }
};

const data = { meta: {}, sections: [], questions: [] };
for (const bk of ['concept', 'tech']) {
  const b = window.SIX_BRIEFS[bk];
  data.meta[bk] = { title: b.title, eyebrow: b.eyebrow, time: b.time, welcome: b.welcome, prefill: b.prefill || [] };
  b.sections.forEach((s, i) => data.sections.push({ brief: bk, id: s.id, order: (i + 1) * 10, title: s.title, intro: s.intro }));
  b.questions.forEach((q, i) => {
    const o = { brief: bk, sec: q.sec, id: q.id, order: (i + 1) * 10, type: q.type, title: q.title };
    ['hint', 'ph', 'ac', 'accept', 'itemLabel', 'addLabel', 'max'].forEach(k => { if (q[k] !== undefined) o[k] = q[k]; });
    ['req', 'trust', 'multi', 'other', 'swatch'].forEach(k => { if (q[k]) o[k] = true; });
    // варианты ответа
    if (typeof q.opts === 'function') { if (q.id === 'acRooms') o.optsFrom = 'rooms'; else throw new Error('opts fn ' + q.id); }
    else if (q.opts) o.opts = q.opts.map(x => typeof x === 'string' ? { l: x } : (({ l, d, img }) => Object.assign({ l }, d ? { d } : {}, img ? { img } : {}))(x));
    // элементы (rate / multitext / matrix)
    if (typeof q.items === 'function') { if (['prio', 'roomWish'].includes(q.id)) o.itemsFrom = 'rooms'; else throw new Error('items fn ' + q.id); }
    else if (q.items) o.items = q.items.map(x => typeof x === 'string' ? { id: x, l: x } : x);
    if (q.type === 'matrix') {
      if (typeof q.cols === 'function') o.colsFrom = { q: 'rooms', map: { 'Головна ванна кімната': 'Головний', 'Гостьовий санвузол': 'Гостьовий' } };
      else o.cols = q.cols;
    }
    if (q.rows) o.rows = q.rows;
    if (q.fields) o.fields = q.fields;
    // условие показа
    if (q.show) {
      if (manual[q.id]) o.show = manual[q.id];
      else {
        const hit = ROOMS.filter(r => { try { return !!q.show({ rooms: [r] }); } catch (e) { return false; } });
        if (!hit.length) throw new Error('show probe empty ' + q.id);
        o.show = { mode: hit.length > 1 ? 'any' : 'all', rules: hit.map(r => rule('rooms', 'is', r)) };
      }
    }
    data.questions.push(o);
  });
}
fs.mkdirSync(base + 'data', { recursive: true });
fs.writeFileSync(base + 'data/briefs.json', JSON.stringify(data, null, 1), 'utf8');
console.log('questions', data.questions.length, 'sections', data.sections.length, 'bytes', fs.statSync(base + 'data/briefs.json').size);

// ---------- проверка: новое правило даёт то же, что старая функция ----------
const has = (v, x) => Array.isArray(v) ? v.indexOf(x) > -1 : v === x;
const filled = v => v != null && (typeof v === 'string' ? v.trim() !== '' : Array.isArray(v) ? v.length > 0 : true);
function evalShow(show, a) {
  if (!show) return true;
  const r = show.rules.map(x => {
    const v = a[x.q];
    if (x.op === 'is') return has(v, x.v);
    if (x.op === 'isNot') return !has(v, x.v);
    if (x.op === 'filled') return filled(v);
    if (x.op === 'empty') return !filled(v);
  });
  return show.mode === 'any' ? r.some(Boolean) : r.every(Boolean);
}
let bad = 0, checks = 0;
const rnd = (arr, n) => arr.filter(() => Math.random() < n);
for (let t = 0; t < 3000; t++) {
  const a = {
    rooms: rnd(ROOMS, Math.random()),
    keep: Math.random() < .5 ? 'Так, є меблі або предмети' : 'Ні, усе нове',
    hasKids: ['Так, є діти', 'Планується', 'Ні'][Math.floor(Math.random() * 3)],
    pets: rnd(['Немає', 'Собака', 'Кіт', '_other'], .4),
    exp: Math.random() < .5 ? 'Так, дещо пішло не так, хочу цього уникнути' : 'Ні, це вперше',
    warm: rnd(['Вхідна зона', 'Коридор', 'Санвузли', 'Не потрібна'], .4),
    kfurn: rnd(['Острів', 'Бар', 'Відкриті полиці'], .5)
  };
  for (const q of window.SIX_BRIEFS.concept.questions.concat(window.SIX_BRIEFS.tech.questions)) {
    if (!q.show) continue;
    const bk = window.SIX_BRIEFS.concept.questions.includes(q) ? 'concept' : 'tech';
    const j = data.questions.find(x => x.brief === bk && x.id === q.id);
    const oldV = !!q.show(a), newV = evalShow(j.show, a);
    checks++;
    if (oldV !== newV) { bad++; if (bad < 6) console.log('MISMATCH', bk, q.id, JSON.stringify(a), oldV, newV); }
  }
}
console.log('проверок:', checks, 'расхождений:', bad);
