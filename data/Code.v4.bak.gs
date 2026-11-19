/**
 * SIX Бриф: серверна частина (Google Apps Script).
 * Що робить:
 *  - приймає відповіді клієнта (збереження чернетки, фінальна відправка, файли);
 *  - веде таблицю «SIX Бриф — відповіді» (один рядок на клієнта і бриф);
 *  - зберігає повні чернетки у папці Диска «SIX Бриф», щоб клієнт міг продовжити з іншого пристрою;
 *  - шле листи на пошту студії: «клієнт почав», «бриф надіслано», «клієнт зупинився, ось що встиг».
 * Інструкція з розгортання: README.md у папці six-brief.
 */
var OWNER_EMAIL = 'six.studio.st@gmail.com';
var IDLE_MINUTES = 60;          // через скільки хвилин без змін шлемо лист «клієнт зупинився»
var SEND_CLIENT_COPY = false;   // true: клієнту теж піде лист-підтвердження з його відповідями

var BASE_URL = 'https://yanamishh.github.io/six-brief/';   // адреса сторінки анкети
var CLIENTS_SHEET = 'Клієнти';  // вкладка, де студія заводить клієнтів і бере особисті посилання
var MAX_NEW_PER_HOUR = 60;     // скільки НОВИХ клієнтів приймаємо за годину (захист від спаму)
var MAIL_CAP_NOTIFY = 40;      // ліміт службових листів «клієнт почав/зупинився» на добу
var MAIL_CAP_TOTAL = 80;       // загальний ліміт листів на добу (бриф «надіслано» має запас)
var MAX_FILES_PER_CLIENT = 15;
var MAX_FILE_B64 = 11200000;   // ≈ 8 МБ у base64

var HEAD = ['Оновлено', 'Код клієнта', 'Бриф', 'Ім’я', 'Email', 'Телефон', 'Заповнено, %', 'Статус', 'Лист надіслано', 'Файл чернетки'];

/* ---------- точки входу ---------- */
function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var raw = e.postData.contents;
    if (raw.length > 14000000) return out({ ok: false, error: 'too large' });
    var d = JSON.parse(raw);
    if (!validId_(d.client) || BRIEFS.indexOf(d.brief) < 0) return out({ ok: false, error: 'bad request' });
    if (!clientRow_(d.client)) return out({ ok: false, error: 'unknown client' });   // лише клієнти, яких завела студія
    if (d.action === 'upload') return out(upload_(d));
    if ((d.action === 'save' || d.action === 'submit') && raw.length < 400000) return out(save_(d));
    return out({ ok: false, error: 'bad request' });
  } catch (err) {
    return out({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.action === 'load' && validId_(p.client) && BRIEFS.indexOf(String(p.brief)) > -1) {
    var cr = clientRow_(String(p.client));
    if (!cr) return out({ ok: true, valid: false });
    var cname = String(clientsSheet_().getRange(cr, 1).getValue() || '');
    var row = findRow_(String(p.client), String(p.brief));
    if (!row) return out({ ok: true, valid: true, name: cname, data: null });
    var fileId = sheet_().getRange(row, 10).getValue();
    try { return out({ ok: true, valid: true, name: cname, data: JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString()) }); }
    catch (err) { return out({ ok: true, valid: true, name: cname, data: null }); }
  }
  return out({ ok: true, service: 'SIX Бриф' });
}

function out(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------- збереження ---------- */
function save_(d) {
  var sh = sheet_();
  var row = findRow_(d.client, d.brief);
  var now = new Date();
  d.name = String(d.name || '').slice(0, 120);
  d.email = String(d.email || '').slice(0, 120);
  d.phone = String(d.phone || '').slice(0, 40);
  d.briefTitle = String(d.briefTitle || '').slice(0, 80);
  d.progress = Math.max(0, Math.min(100, +d.progress || 0));
  if (!row && newRowsLastHour_(sh) >= MAX_NEW_PER_HOUR) return { ok: false, error: 'busy' };
  var status = d.done ? 'Надіслано' : 'У процесі';
  var isNew = !row;

  var fileId = row ? sh.getRange(row, 10).getValue() : '';
  var json = JSON.stringify({ answers: d.answers, readable: d.readable, updatedAt: d.updatedAt, done: !!d.done, name: d.name, email: d.email, phone: d.phone, briefTitle: d.briefTitle });
  if (fileId) { try { DriveApp.getFileById(fileId).setContent(json); } catch (e) { fileId = ''; } }
  if (!fileId) fileId = folder_().createFile(d.client + '_' + d.brief + '.json', json, 'application/json').getId();

  var vals = [now, d.client, d.brief, d.name || '', d.email || '', d.phone || '', d.progress || 0, status, row ? sh.getRange(row, 9).getValue() : '', fileId];
  if (isNew) { sh.appendRow(vals); row = sh.getLastRow(); }
  else sh.getRange(row, 1, 1, vals.length).setValues([vals]);
  sh.getRange(row, 1).setNumberFormat('dd.mm.yyyy HH:mm');

  if (d.action === 'submit') {
    // швидка відповідь клієнту: лист із PDF формується у фоні (тригер), а не під час натискання «Надіслати»
    var queued = false;
    try {
      PropertiesService.getScriptProperties().setProperty('mq_' + d.client + '_' + d.brief, JSON.stringify({ client: d.client, brief: d.brief, progress: d.progress, page: d.page || '', tries: 0 }));
      ScriptApp.newTrigger('sendQueued_').timeBased().after(1000).create();
      queued = true;
    } catch (qe) { queued = false; }
    if (!queued) mail_(d, 'Бриф надіслано', true);
    sh.getRange(row, 9).setValue(now);
    if (!queued && SEND_CLIENT_COPY && d.email) { try { clientCopy_(d); } catch (e) {} }
  } else if (isNew && d.name && (validEmail_(d.email) || d.phone.replace(/\D/g, '').length >= 9)) {
    mail_({ client: d.client, brief: d.brief, briefTitle: d.briefTitle, name: d.name, email: d.email, phone: d.phone, readable: [], progress: d.progress }, 'Клієнт розпочав бриф', false);
    sh.getRange(row, 9).setValue(now);
  }
  return { ok: true };
}

// Фонова відправка листа студії з PDF (запускається тригером після «Надіслати»)
function sendQueued_() {
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  try { lock.waitLock(25000); } catch (e) { return; }
  try {
    var all = props.getProperties();
    Object.keys(all).forEach(function (k) {
      if (k.indexOf('mq_') !== 0) return;
      var m;
      try { m = JSON.parse(all[k]); } catch (e) { props.deleteProperty(k); return; }
      props.deleteProperty(k);                       // спершу видаляємо, щоб не було дубля листа
      try {
        var sh = sheet_(), row = findRow_(m.client, m.brief);
        var fileId = row ? sh.getRange(row, 10).getValue() : '';
        var j = JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString());
        var d = { client: m.client, brief: m.brief, briefTitle: j.briefTitle, name: j.name, email: j.email, phone: j.phone, readable: j.readable, progress: m.progress, page: m.page, answers: j.answers, done: true };
        mail_(d, 'Бриф надіслано', true);
        if (SEND_CLIENT_COPY && d.email) { try { clientCopy_(d); } catch (e2) {} }
      } catch (err) {
        m.tries = (m.tries || 0) + 1;
        if (m.tries < 3) props.setProperty(k, JSON.stringify(m));   // повторимо пізніше
      }
    });
  } finally { lock.releaseLock(); }
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'sendQueued_') { try { ScriptApp.deleteTrigger(t); } catch (e) {} } });
  var left = Object.keys(props.getProperties()).some(function (k) { return k.indexOf('mq_') === 0; });
  if (left) { try { ScriptApp.newTrigger('sendQueued_').timeBased().after(60000).create(); } catch (e) {} }
}

/* ---------- файли клієнта ---------- */
function upload_(d) {
  var f = d.file;
  if (!f || !f.data) return { ok: false, error: 'no file' };
  if (!findRow_(d.client, d.brief)) return { ok: false, error: 'no draft' };      // файли лише від клієнтів із чернеткою
  if (String(f.data).length > MAX_FILE_B64) return { ok: false, error: 'too large' };
  var mime = String(f.mime || 'application/octet-stream');
  if (!/^(image\/|application\/(pdf|zip|x-zip-compressed|octet-stream|acad|x-acad|dwg))/.test(mime)) return { ok: false, error: 'type' };
  var sub = subfolder_(String(d.client));
  var n = 0, it = sub.getFiles(); while (it.hasNext()) { it.next(); n++; }
  if (n >= MAX_FILES_PER_CLIENT) return { ok: false, error: 'limit' };
  var name = String(f.name || 'file').replace(/[^\w.\- а-яіїєґА-ЯІЇЄҐ]/g, '_').slice(0, 120);
  var file = sub.createFile(Utilities.newBlob(Utilities.base64Decode(f.data), mime, name));
  return { ok: true, url: file.getUrl() };   // файл приватний: відкриваєш лише ти
}

/* ---------- листи ---------- */
function mail_(d, kind, full) {
  if (!canMail_(full && kind === 'Бриф надіслано' ? MAIL_CAP_TOTAL : MAIL_CAP_NOTIFY)) return;
  var who = d.name || 'Без імені';
  var subject = 'SIX Бриф · ' + who + ' · ' + (d.briefTitle || d.brief) + ' — ' + kind;
  var pdf = null;
  if (full && d.readable && d.readable.length) {
    try { pdf = makePdf_(d, kind); } catch (err) { pdf = null; }
  }
  var html = '<div style="font-family:Arial,sans-serif;color:#1d1c1a;max-width:680px">' +
    '<h2 style="font-weight:400;margin:0 0 4px">' + esc_(kind) + '</h2>' +
    '<p style="color:#78746a;margin:0 0 18px">' + esc_(d.briefTitle || d.brief) + ' · заповнено ' + (d.progress || 0) + '%</p>' +
    '<table style="border-collapse:collapse;margin-bottom:22px">' +
    row_('Ім’я', d.name) + row_('Телефон', d.phone) + row_('Email', d.email) + row_('Код клієнта', d.client) +
    row_('Посилання клієнта', (d.page || BASE_URL) + '?b=' + d.brief + '&c=' + d.client) + '</table>';
  if (pdf) {
    html += '<p style="margin:0 0 6px">Усі відповіді у вкладеному PDF-файлі.</p>';
  } else {
    (d.readable || []).forEach(function (s) {
      html += '<h3 style="font-weight:500;border-bottom:1px solid #e1ded6;padding-bottom:6px;margin:24px 0 10px;color:#6b5f46">' + esc_(s.section) + '</h3>';
      s.items.forEach(function (it) {
        html += '<p style="margin:0 0 12px"><span style="color:#78746a;font-size:13px">' + esc_(it.q) + '</span><br>' + esc_(it.a).replace(/\n/g, '<br>') + '</p>';
      });
    });
  }
  html += '<p style="color:#78746a;font-size:13px;margin-top:28px">Таблиця з усіма відповідями: ' + SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID')).getUrl() + '</p></div>';
  var opt = { to: OWNER_EMAIL, subject: subject, htmlBody: html, name: 'SIX Бриф' };
  if (pdf) opt.attachments = [pdf];
  if (d.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) opt.replyTo = d.email;
  MailApp.sendEmail(opt);
}
function clientCopy_(d) {
  var html = '<div style="font-family:Arial,sans-serif;color:#1d1c1a;max-width:640px"><h2 style="font-weight:400">Дякуємо, ' + esc_(d.name || '') + '!</h2><p>Ми отримали ваш бриф і вивчимо відповіді перед зустріччю.</p></div>';
  MailApp.sendEmail({ to: d.email, subject: 'SIX Studio: ми отримали ваш бриф', htmlBody: html, name: 'SIX Studio', replyTo: OWNER_EMAIL });
}
function row_(k, v) { return '<tr><td style="padding:3px 18px 3px 0;color:#78746a">' + esc_(k) + '</td><td>' + esc_(v || '—') + '</td></tr>'; }
function esc_(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

/* ---------- «клієнт зупинився»: запускається за таймером ---------- */
function checkIdle() {
  var sh = sheet_(), n = sh.getLastRow();
  if (n < 2) return;
  var rows = sh.getRange(2, 1, n - 1, HEAD.length).getValues();
  var limit = IDLE_MINUTES * 60000, now = Date.now();
  rows.forEach(function (r, i) {
    var upd = new Date(r[0]).getTime(), mailed = r[8] ? new Date(r[8]).getTime() : 0;
    if (r[7] !== 'У процесі' || !r[9]) return;
    if (now - upd < limit || mailed >= upd) return;      // ще пише, або вже писали про цю версію
    if ((r[6] || 0) < 5) return;                          // майже порожньо, не турбуємо
    try {
      var data = JSON.parse(DriveApp.getFileById(r[9]).getBlob().getDataAsString());
      mail_({ client: r[1], brief: r[2], briefTitle: data.briefTitle, name: r[3], email: r[4], phone: r[5], readable: data.readable, progress: r[6], page: '' }, 'Клієнт зупинився: ось що встиг заповнити', true);
      sh.getRange(i + 2, 9).setValue(new Date());
    } catch (e) {}
  });
}

/* ---------- налаштування (запустити один раз) ---------- */
function setup() {
  sheet_(); folder_(); clientsSheet_();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'onClientsEdit') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('onClientsEdit').forSpreadsheet(SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'))).onEdit().create();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'checkIdle') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('checkIdle').timeBased().everyMinutes(15).create();
  Logger.log('Готово. Таблиця: ' + SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID')).getUrl());
}

/* ---------- службове ---------- */
function sheet_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('SHEET_ID'), ss;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('SIX Бриф — відповіді'); props.setProperty('SHEET_ID', ss.getId());
    var s = ss.getSheets()[0]; s.setName('Відповіді'); s.appendRow(HEAD); s.setFrozenRows(1);
    s.getRange(1, 1, 1, HEAD.length).setFontWeight('bold'); s.setColumnWidth(1, 130); s.setColumnWidth(4, 180); s.setColumnWidth(5, 200);
  }
  return ss.getSheetByName('Відповіді') || ss.getSheets()[0];
}
function folder_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = DriveApp.createFolder('SIX Бриф'); props.setProperty('FOLDER_ID', f.getId()); return f;
}
function subfolder_(name) {
  var root = folder_(), it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}
function findRow_(client, brief) {
  var sh = sheet_(), n = sh.getLastRow();
  if (n < 2) return 0;
  var v = sh.getRange(2, 2, n - 1, 2).getValues();
  for (var i = 0; i < v.length; i++) if (v[i][0] === client && v[i][1] === brief) return i + 2;
  return 0;
}

/* ---------- захист ---------- */
var BRIEFS = ['concept', 'tech'];
function validId_(v) { return /^[a-z0-9]{6,20}$/.test(String(v || '')); }
function validEmail_(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '')); }
function canMail_(limit) {
  var p = PropertiesService.getScriptProperties();
  var k = 'MAIL_' + kyivFmt_('yyyyMMdd');
  var n = +(p.getProperty(k) || 0);
  if (n >= limit) return false;
  p.setProperty(k, String(n + 1));
  return true;
}
function newRowsLastHour_(sh) {
  var n = sh.getLastRow();
  if (n < 2) return 0;
  var from = Math.max(2, n - 200), v = sh.getRange(from, 1, n - from + 1, 1).getValues(), c = 0, lim = Date.now() - 3600000;
  for (var i = 0; i < v.length; i++) if (new Date(v[i][0]).getTime() > lim) c++;
  return c;
}

/* ---------- клієнти й особисті посилання ---------- */
// Студія вписує ім'я клієнта в колонку A вкладки «Клієнти», скрипт сам створює код і два посилання.
function clientsSheet_() {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
  var sh = ss.getSheetByName(CLIENTS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CLIENTS_SHEET, 0);
    sh.appendRow(['Ім’я клієнта (впишіть тут)', 'Код', 'Посилання: бриф 1', 'Посилання: технічний бриф', 'Створено']);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, 5).setFontWeight('bold');
    sh.setColumnWidth(1, 230); sh.setColumnWidth(2, 110); sh.setColumnWidth(3, 420); sh.setColumnWidth(4, 420); sh.setColumnWidth(5, 130);
  }
  return sh;
}
function clientRow_(code) {
  if (!validId_(code)) return 0;
  var sh = clientsSheet_(), n = sh.getLastRow();
  if (n < 2) return 0;
  var v = sh.getRange(2, 2, n - 1, 1).getValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][0]).trim() === code) return i + 2;
  return 0;
}
function onClientsEdit(e) {
  var sh = e.range.getSheet();
  if (sh.getName() !== CLIENTS_SHEET) return;
  var r1 = e.range.getRow(), r2 = r1 + e.range.getNumRows() - 1;
  for (var r = Math.max(2, r1); r <= r2; r++) fillClient_(sh, r);
}
function fillClient_(sh, r) {
  var name = String(sh.getRange(r, 1).getValue()).trim(), code = String(sh.getRange(r, 2).getValue()).trim();
  if (!name || code) return;
  code = uniqueCode_(sh);
  sh.getRange(r, 2).setValue(code);
  sh.getRange(r, 3).setValue(BASE_URL + '?b=concept&c=' + code);
  sh.getRange(r, 4).setValue(BASE_URL + '?b=tech&c=' + code);
  sh.getRange(r, 5).setValue(new Date()).setNumberFormat('dd.mm.yyyy HH:mm');
}
function uniqueCode_(sh) {
  var al = 'abcdefghjkmnpqrstuvwxyz23456789', n = sh.getLastRow();
  var used = n > 1 ? sh.getRange(2, 2, n - 1, 1).getValues().map(function (r) { return String(r[0]); }) : [];
  for (var t = 0; t < 50; t++) {
    var c = ''; for (var i = 0; i < 8; i++) c += al.charAt(Math.floor(Math.random() * al.length));
    if (used.indexOf(c) < 0) return c;
  }
  throw new Error('code');
}

/* ---------- PDF у стилі сайту (збирається через Google Документ: шрифти Jost і Manrope) ---------- */
var LOGO_B64 = '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';
var PDF_C = { ink: '#1D1C1A', mut: '#78746A', acc: '#85775A', accD: '#6B5F46', line: '#E1DED6', soft: '#EEEADF' };
var PF_D = 'Jost', PF_B = 'Manrope';

function spaced_(t) { return String(t).split('').join('\u200A'); }

// Заповнює комірку таблиці рядками {t, s, f, c, a, b}: текст, розмір, шрифт, колір, відступ після/перед.
function fillCell_(cell, lines) {
  lines.forEach(function (o, i) {
    var p; if (i === 0) { p = cell.getChild(0).asParagraph(); p.setText(o.t); } else { p = cell.appendParagraph(o.t); }
    p.setFontFamily(o.f || PF_B).setFontSize(o.s || 11).setForegroundColor(o.c || PDF_C.ink).setBold(false).setItalic(false)
      .setSpacingBefore(o.b || 0).setSpacingAfter(o.a || 0).setLineSpacing(o.l || 1.2).setAlignment(o.al || DocumentApp.HorizontalAlignment.LEFT);
  });
}
function bodyPara_(body, text, o) {
  var p = body.appendParagraph(text);
  p.setFontFamily(o.f || PF_B).setFontSize(o.s || 11).setForegroundColor(o.c || PDF_C.ink).setBold(false).setItalic(false)
    .setSpacingBefore(o.b || 0).setSpacingAfter(o.a || 0).setLineSpacing(o.l || 1.3).setAlignment(DocumentApp.HorizontalAlignment.LEFT);
  return p;
}

function makePdf_(d, kind) {
  var doc = DocumentApp.create('tmp ' + d.client + ' ' + Date.now());
  try { return buildPdf_(doc, d, kind); }
  finally { try { DriveApp.getFileById(doc.getId()).setTrashed(true); } catch (e) {} }   // тимчасовий документ видаляємо завжди
}
function buildPdf_(doc, d, kind) {
  var C = PDF_C;
  var when = kyivFmt_('dd.MM.yyyy HH:mm');
  var body = doc.getBody();
  body.setMarginTop(44).setMarginBottom(44).setMarginLeft(54).setMarginRight(54);

  // шапка: логотип · SIX STUDIO · дата
  var ht = body.appendTable([['', '', '']]);
  ht.setBorderWidth(0);
  var logoBlob = Utilities.newBlob(Utilities.base64Decode(LOGO_B64), 'image/png', 'logo.png');
  var c0 = ht.getCell(0, 0), c1 = ht.getCell(0, 1), c2 = ht.getCell(0, 2);
  c0.getChild(0).asParagraph().appendInlineImage(logoBlob).setWidth(32).setHeight(32);
  c0.setWidth(46); c1.setWidth(300);
  fillCell_(c1, [{ t: spaced_('SIX STUDIO'), f: PF_D, s: 13 }]);
  fillCell_(c2, [{ t: when, s: 9, c: C.mut, al: DocumentApp.HorizontalAlignment.RIGHT }]);
  [c0, c1, c2].forEach(function (c) { c.setVerticalAlignment(DocumentApp.VerticalAlignment.CENTER).setPaddingLeft(0).setPaddingRight(0); });

  // заголовок
  bodyPara_(body, spaced_(String(kind || '').toUpperCase()), { f: PF_D, s: 8.5, c: C.accD, b: 26, a: 2 });
  bodyPara_(body, d.briefTitle || 'Бриф', { f: PF_D, s: 30, a: 14, l: 1.05 });

  // картка клієнта
  function lab(t) { return { t: String(t).toUpperCase(), s: 7, c: C.mut }; }
  function val(t) { return { t: t || '—', s: 11, b: 1 }; }
  var card = body.appendTable([['', '', ''], ['', '', '']]);
  card.setBorderWidth(0);
  var items = [['Клієнт', d.name], ['Телефон', d.phone], ['Email', d.email], ['Бриф', d.briefTitle], ['Заповнено', (d.progress || 0) + '%'], ['Код клієнта', d.client]];
  items.forEach(function (it, i) {
    var cell = card.getCell(Math.floor(i / 3), i % 3);
    fillCell_(cell, [lab(it[0]), val(it[1])]);
    cell.setBackgroundColor(C.soft).setPaddingTop(9).setPaddingBottom(9).setPaddingLeft(12).setPaddingRight(8);
  });

  // розділи
  (d.readable || []).forEach(function (sec, si) {
    var num = ('0' + (si + 1)).slice(-2);
    var hp = bodyPara_(body, num + '    ' + sec.section, { f: PF_D, s: 19, b: 26, a: 3, keep: true });
    var tx = hp.editAsText();
    tx.setFontSize(0, 1, 11).setForegroundColor(0, 1, C.acc);
    body.appendHorizontalRule();
    sec.items.forEach(function (it) {
      bodyPara_(body, it.q, { s: 8.5, c: C.mut, b: 9, a: 1, keep: true, l: 1.2 });
      bodyPara_(body, it.a, { s: 11, a: 2, l: 1.35 });
      if (it.imgs && it.imgs.length) addPicked_(body, it.imgs);
    });
  });

  // прибираємо порожній перший абзац (щоб шапка була на самому верху)
  try { var first = body.getChild(0); if (first.getType() === DocumentApp.ElementType.PARAGRAPH && !first.asParagraph().getText()) first.removeFromParent(); } catch (e) {}

  var foot = doc.addFooter();
  fillCellLike_(foot, 'SIX Studio · сформовано автоматично з відповідей клієнта · ' + when);

  doc.saveAndClose();
  var file = DriveApp.getFileById(doc.getId());
  var stamp = kyivFmt_('dd.MM.yyyy');
  var fname = 'SIX Бриф — ' + (d.name || d.client) + ' — ' + (d.brief === 'tech' ? 'технічний' : 'концепція') + ' — ' + stamp + '.pdf';
  var pdf = file.getAs('application/pdf').setName(fname);
  try { subfolder_('PDF').createFile(pdf); } catch (e) {}     // копія в архіві на Диску
  file.setTrashed(true);                                       // тимчасовий документ видаляємо одразу
  return pdf;
}

// Картинки, які вибрав клієнт: мініатюри з підписами, по 4 у ряд (фото беруться зі сторінки анкети на GitHub Pages)
function addPicked_(body, imgs) {
  var PER = 4, W = 104;
  for (var s = 0; s < imgs.length; s += PER) {
    var chunk = imgs.slice(s, s + PER), row = [];
    for (var k = 0; k < PER; k++) row.push('');
    var t = body.appendTable([row]);
    t.setBorderWidth(0);
    chunk.forEach(function (im, k) {
      var cell = t.getCell(0, k);
      cell.setPaddingLeft(0).setPaddingRight(8).setPaddingTop(2).setPaddingBottom(6);
      var p = cell.getChild(0).asParagraph();
      try {
        var blob = UrlFetchApp.fetch(im.u, { muteHttpExceptions: false }).getBlob();
        var pic = p.appendInlineImage(blob);
        var w0 = pic.getWidth() || W, h0 = pic.getHeight() || W;
        pic.setWidth(W).setHeight(Math.round(W * h0 / w0));
      } catch (err) { p.appendText('[фото недоступне]').setFontSize(8).setForegroundColor(PDF_C.mut); }
      var c = cell.appendParagraph(im.l || '');
      c.setFontFamily(PF_B).setFontSize(8).setForegroundColor(PDF_C.mut).setSpacingBefore(2).setSpacingAfter(0);
    });
  }
  bodyPara_(body, '', { s: 4, a: 2 });
}
function fillCellLike_(footer, text) {
  var p = footer.getChild(0).asParagraph(); p.setText(text);
  p.setFontFamily(PF_B).setFontSize(8).setForegroundColor(PDF_C.mut).setAlignment(DocumentApp.HorizontalAlignment.LEFT);
}

// Пробний запуск з редактора: кладе приклад PDF у папку «PDF» на Диску.
function testPdf() {
  var d = { client: 'sample', brief: 'concept', briefTitle: 'Бриф на дизайн-проєкт', name: 'Олена Коваль', phone: '+380 50 000 00 00', email: 'olena@example.com', progress: 64,
    readable: [
      { section: 'Знайомство', items: [{ q: 'Як вас звати?', a: 'Олена Коваль', imgs: [{ l: 'Приклад 1', u: BASE_URL + 'img/style/1.jpg' }, { l: 'Приклад 2', u: BASE_URL + 'img/style/2.jpg' }, { l: 'Приклад 3', u: BASE_URL + 'img/style/8.jpg' }] }, { q: 'Як вам зручніше спілкуватися?', a: 'Telegram; Viber' }, { q: 'Хто приймає остаточні рішення щодо проєкту?', a: 'Ми з партнером разом' }] },
      { section: 'Люди та спосіб життя', items: [{ q: 'Хто житиме в цьому просторі?', a: '1) Ім’я: Олена, Вік: 34, Чим займається: дизайнер, Характер: енергійна | 2) Ім’я: Максим, Вік: 36' }, { q: 'Ваш ідеальний день у новому домі', a: 'Прокидатися від світла в спальні, кава на кухні з видом на двір, ввечері кіно у вітальні з усією родиною.\nВихідні проводити вдома, інколи приймати друзів.' }] },
      { section: 'Концепція та атмосфера', items: [{ q: 'Які стилі вам близькі?', a: 'Мінімалізм; Сучасна класика; Скандинавський' }, { q: 'Які кольори вам подобаються?', a: 'Бежевий, пісочний, теракота; Білий, молочний; Зелений (відтінки)' }, { q: 'Чого точно не має бути в інтер’єрі?', a: 'Темних тонів; Глянцю; Інше: золота' }] }
    ] };
  var pdf = makePdf_(d, 'Тестовий PDF');
  Logger.log('PDF: ' + subfolder_('PDF').getFilesByName(pdf.getName()).next().getUrl());
}

/* ---------- київський час (літній/зимовий) без залежності від налаштувань проєкту ---------- */
function kyivFmt_(fmt) {
  var now = new Date(), y = now.getUTCFullYear();
  function lastSunday(m) { var d = new Date(Date.UTC(y, m + 1, 0, 1)); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d; }
  var summer = now >= lastSunday(2) && now < lastSunday(9);
  return Utilities.formatDate(new Date(now.getTime() + (summer ? 3 : 2) * 3600000), 'GMT', fmt);
}
