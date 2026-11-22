/* PRD issue analysis, scenario matrix checks, and Excel/CSV reading.
   Pure functions, no DOM. Loaded after core.js; adds to window.Core. */
(function (g) {
'use strict';
const C = g.Core;
const STOP = new Set('that this with from have must when then than into their there which would should could about after before every each only also been being does done other such same will your over under above below'.split(' '));
const toks = (s) => new Set((String(s).toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || []).filter((w) => !STOP.has(w)));
const inter = (a, b) => [...a].filter((x) => b.has(x)).length;
const nums = (s) => (String(s).replace(/\b[A-Z]{1,5}(?:-[A-Z]{2,6})*-\d{1,4}\b/g, ' ').match(/\b\d+(?:\.\d+)?\b/g) || []);
const unplural = (w) => w.replace(/(ies)$/, 'y').replace(/s$/, '');
const stem = (set) => new Set([...set].map(unplural));

/* ---------- known issues and pending decisions in a consolidated PRD ---------- */
const VAGUE = /\b(fast|quick(?:ly)?|easy|easily|appropriate(?:ly)?|as needed|etc\.?|user[- ]friendly|timely|reasonable|soon|efficient(?:ly)?|flexible|normal(?:ly)?|several|some)\b/i;
const ORDER = { 'Conflict': 0, 'Decision needed': 1, 'Gap': 2, 'Wording': 3 };
function analyzePrd(md) {
  const d = C.parsePrd(md), m = C.requirementsModel(md), out = [];
  const add = (type, where, text, prompt) => out.push({ key: C.hashStr(type + '|' + where + '|' + text), type, where, text, prompt: prompt || '' });
  if (!String(md || '').trim()) return out;
  /* placeholders left in the document */
  let sec = '', fence = false;
  String(md).split('\n').forEach((l) => {
    if (l.startsWith('```')) { fence = !fence; return; }
    if (fence) return;
    const h = l.match(/^#{1,3}\s+(.*)/); if (h) { sec = h[1].replace(/^\d+(\.\d+)*\.?\s*/, ''); return; }
    if (/\bTBD\b/.test(l)) {
      if (/^owner:/.test(l)) add('Decision needed', 'Document header', 'The owner of this PRD is not named.');
      else if (sec) add('Gap', sec, `"${sec}" is still TBD.`, /out of scope/i.test(sec) ? 'add <item> to out of scope' : /^in scope/i.test(sec) ? 'add <item> to in scope' : '');
    }
  });
  /* open items and questions carried from the sources */
  d.notes.filter((n) => /open|question|risk|assumption/i.test(n.title)).forEach((n) => n.lines.forEach((x) => {
    if (/^none\.?$/i.test(x) || /^owners approve the proposed/i.test(x)) return;
    if (/\b(resolved|closed|answered|decided|approved)\b/i.test(x)) return; /* an answered question is not open */
    if (x.length < 4 || /:$/.test(x) || /^[\s|:-]+$/.test(x)) return; /* a label, a table border or a table header is not an open item */
    add(/worded differently/i.test(x) ? 'Conflict' : 'Decision needed', n.title, x);
  }));
  /* proposed requirements that nobody approved */
  m.reqs.filter((r) => r.proposed).forEach((r) => add('Decision needed', r.id, `${r.id} was proposed by AI and is not approved: ${r.text}`, `remove ${r.id}`));
  /* requirements that touch something declared out of scope */
  m.outScope.forEach((item) => {
    const it = stem(toks(item));
    if (!it.size) return;
    m.reqs.forEach((r) => {
      const rt = stem(toks(r.text));
      if (inter(it, rt) === it.size && (it.size >= 2 || r.text.toLowerCase().includes(item.toLowerCase()))) add('Conflict', r.id, `${r.id} mentions "${item}", which the PRD lists as out of scope. Move one of them.`);
    });
    if (m.inScope.some((x) => x.toLowerCase() === item.toLowerCase())) add('Conflict', 'Scope', `"${item}" is listed as both in scope and out of scope.`);
  });
  /* duplicate IDs and near-duplicate requirements */
  const seen = {}; d.reqs.forEach((r) => { if (r.id) (seen[r.id] = seen[r.id] || []).push(r); });
  Object.entries(seen).forEach(([id, a]) => { if (a.length > 1) add('Conflict', id, `${id} appears ${a.length} times in the requirements.`); });
  for (let i = 0; i < m.reqs.length; i++) for (let j = i + 1; j < m.reqs.length; j++) {
    const a = stem(toks(m.reqs[i].text)), b = stem(toks(m.reqs[j].text)), u = new Set([...a, ...b]).size;
    if (u && a.size >= 4 && inter(a, b) / u >= 0.8) add('Conflict', `${m.reqs[i].id}, ${m.reqs[j].id}`, `${m.reqs[i].id} and ${m.reqs[j].id} say almost the same thing. Keep one.`, `remove ${m.reqs[j].id}`);
  }
  /* vague wording */
  m.reqs.forEach((r) => { const v = r.text.match(VAGUE); if (v) add('Wording', r.id, `${r.id} uses the vague word "${v[1]}". State a limit that can be tested.`, `change ${r.id} to <wording with a measurable limit>`); });
  /* decisions in a process with no requirement behind them */
  const all = m.reqs.map((r) => stem(toks(r.text)));
  m.processes.forEach((p) => p.steps.filter((x) => /\?\s*$/.test(x)).forEach((x) => {
    const t = stem(toks(x));
    if (t.size && !all.some((a) => inter(t, a) >= 1)) add('Gap', p.name, `The decision "${x}" in "${p.name}" has no requirement.`, `add a requirement that ${x.replace(/\?\s*$/, '').toLowerCase()} ...`);
  }));
  /* structure */
  if (!m.reqs.length) add('Gap', 'Requirements', 'The PRD has no requirements with an ID.', 'add a requirement that ...');
  if (!m.processes.length) add('Gap', 'Processes', 'The PRD has no process with steps, so no BPMN diagram can be drawn.', 'add process <name>: step one; step two');
  if (!m.outScope.length || m.outScope.every((x) => /^tbd$/i.test(x))) add('Gap', 'Scope', 'Nothing is listed as out of scope.', 'add <item> to out of scope');
  const raw = String(md).match(/^## Source notes[\s\S]*$/m);
  if (raw) (raw[0].match(/^### .*$/gm) || []).forEach((h) => add('Gap', 'Source notes', `${h.replace(/^###\s+/, '')} had no recognised structure. Its text is under "Source notes". Move the facts into the sections above.`));
  const seenKeys = new Set();
  return out.filter((x) => !seenKeys.has(x.key) && seenKeys.add(x.key)).sort((a, b) => ORDER[a.type] - ORDER[b.type]);
}

/* ---------- scenario matrix checks against the PRD ---------- */
const KINDS = ['Happy', 'Edge', 'Negative', 'Gap'];
const MORD = { 'Conflict': 0, 'Missing': 1, 'Quality': 2 };
function analyzeMatrix(allRows, model) {
  const rows = allRows.filter((s) => s.prio !== 'Not required');
  const out = [], reqs = model.reqs, byId = Object.fromEntries(reqs.map((r) => [r.id, r]));
  const add = (type, where, text) => out.push({ type, where, text });
  const idCount = {}; rows.forEach((s) => { if (s.id) idCount[s.id] = (idCount[s.id] || 0) + 1; });
  Object.entries(idCount).forEach(([id, n]) => { if (n > 1) add('Quality', id, `Scenario ID ${id} is used ${n} times.`); });
  rows.forEach((s, i) => {
    const w = s.id || `Row ${i + 1}`;
    if (!s.id) add('Quality', w, 'This row has no scenario ID.');
    if (s.name && !String(s.title || '').trim() && !String(s.expect || '').trim() && !s.reqs.length) { add('Missing', w, `"${s.name}" is waiting for a matched payload: Scenario, Expected outcome and Requirements are generated from payloads.`); return; }
    if (!String(s.title || '').trim()) add('Quality', w, 'This scenario has no description.');
    if (!String(s.expect || '').trim()) add('Quality', w, 'This scenario has no expected outcome.');
    if (!KINDS.includes(s.kind)) add('Quality', w, `Type "${s.kind || ''}" is not one of ${KINDS.join(', ')}.`);
    if (!s.reqs.length) { add('Missing', w, 'This scenario is not traced to any requirement.'); }
    s.reqs.forEach((r) => { if (!byId[r]) add('Conflict', w, `${w} cites ${r}, which is not in the PRD.`); });
    const cited = s.reqs.map((r) => byId[r]).filter(Boolean), text = `${s.title} ${s.expect}`;
    /* numbers that differ from the cited requirement */
    const rn = new Set(cited.flatMap((r) => nums(r.text)));
    if (rn.size) nums(text).forEach((n) => { if (!rn.has(n)) add('Conflict', w, `${w} says ${n}, but ${cited.filter((r) => nums(r.text).length).map((r) => r.id).join(', ')} says ${[...rn].join(', ')}.`); });
    /* approval contradicts the requirement */
    cited.forEach((r) => {
      if (/\b(needs?|requires?|must (?:have|get))\b[^.]*\bapproval\b/i.test(r.text) && /\b(without|no|not (?:need|require)\w*)\b[^.]*\bapproval\b|\bauto[- ]?approved?\b/i.test(s.expect)) add('Conflict', w, `${w} expects no approval, but ${r.id} requires approval.`);
    });
    /* channel differs from the requirement */
    cited.forEach((r) => {
      const rc = C.chanOf(r.text), sc = /^(pos|store)$/i.test(s.ch) ? 'POS' : /^online$/i.test(s.ch) ? 'Online' : 'All';
      if (rc !== 'All' && sc !== 'All' && rc !== sc) add('Conflict', w, `${w} is a ${s.ch} scenario, but ${r.id} is about ${rc === 'POS' ? 'POS or store' : 'online'} work.`);
    });
    /* touches something out of scope */
    model.outScope.forEach((item) => {
      const it = stem(toks(item)), st = stem(toks(text));
      if (it.size && inter(it, st) === it.size && (it.size >= 2 || text.toLowerCase().includes(item.toLowerCase()))) add('Conflict', w, `${w} covers "${item}", which the PRD lists as out of scope.`);
    });
  });
  reqs.forEach((r) => {
    const mine = rows.filter((s) => s.reqs.includes(r.id));
    if (!mine.length) add('Missing', r.id, `${r.id} has no scenario: ${r.text}`);
    else if (!mine.some((s) => s.kind === 'Negative')) add('Missing', r.id, `${r.id} has no negative scenario.`);
  });
  const seen = new Set();
  return out.filter((x) => { const k = x.type + x.where + x.text; return !seen.has(k) && seen.add(k); }).sort((a, b) => MORD[a.type] - MORD[b.type]);
}

/* ---------- CSV and Excel reading ---------- */
function parseCsv(text, delim = ',') {
  const rows = []; let row = [], cell = '', q = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}
const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
const colIdx = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
async function inflate(bytes) {
  const ds = new DecompressionStream('deflate-raw'), w = ds.writable.getWriter();
  w.write(bytes); w.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}
async function unzip(buf) {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf), v = new DataView(u.buffer, u.byteOffset, u.byteLength);
  let e = u.length - 22; while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('This is not an Excel (.xlsx) file.');
  const n = v.getUint16(e + 10, true); let p = v.getUint32(e + 16, true); const files = {}, dec = new TextDecoder();
  for (let i = 0; i < n; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('The Excel file is damaged.');
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), el = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), off = v.getUint32(p + 42, true);
    const name = dec.decode(u.subarray(p + 46, p + 46 + nl));
    const lnl = v.getUint16(off + 26, true), lel = v.getUint16(off + 28, true), start = off + 30 + lnl + lel, data = u.subarray(start, start + csize);
    files[name] = { method, data };
    p += 46 + nl + el + cl;
  }
  const text = async (name) => { const f = files[name]; if (!f) return null; return dec.decode(f.method === 0 ? f.data : await inflate(f.data)); };
  return { files, text };
}
async function readXlsx(buf) {
  const z = await unzip(buf), wb = await z.text('xl/workbook.xml');
  if (!wb) throw new Error('This is not an Excel (.xlsx) file.');
  const rels = (await z.text('xl/_rels/workbook.xml.rels')) || '', target = {};
  (rels.match(/<Relationship\b[^>]*>/g) || []).forEach((r) => { const id = (r.match(/\bId="([^"]*)"/) || [])[1], t = (r.match(/\bTarget="([^"]*)"/) || [])[1]; if (id && t) target[id] = t.replace(/^\//, '').replace(/^(?!xl\/)/, 'xl/'); });
  const ss = []; const sx = await z.text('xl/sharedStrings.xml');
  if (sx) (sx.match(/<si\b[\s\S]*?<\/si>/g) || []).forEach((si) => ss.push(unesc((si.match(/<t\b[^>]*>[\s\S]*?<\/t>/g) || []).map((t) => t.replace(/^<t\b[^>]*>|<\/t>$/g, '')).join(''))));
  const sheets = [];
  for (const sh of wb.match(/<sheet\b[^>]*>/g) || []) {
    const name = unesc((sh.match(/\bname="([^"]*)"/) || [])[1] || ''), rid = (sh.match(/\br:id="([^"]*)"/) || [])[1], xml = await z.text(target[rid] || '');
    if (!xml) continue;
    const rows = [];
    (xml.match(/<row\b[\s\S]*?<\/row>/g) || []).forEach((rw) => {
      const r = [];
      (rw.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || []).forEach((c) => {
        const ref = (c.match(/\br="([A-Z]+\d+)"/) || [])[1], t = (c.match(/\bt="([^"]*)"/) || [])[1];
        if (!ref) return;
        let val = '';
        if (t === 'inlineStr') val = unesc((c.match(/<t\b[^>]*>[\s\S]*?<\/t>/g) || []).map((x) => x.replace(/^<t\b[^>]*>|<\/t>$/g, '')).join(''));
        else { const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1]; if (v !== undefined) val = t === 's' ? (ss[+v] || '') : unesc(v); }
        r[colIdx(ref)] = val;
      });
      rows.push(Array.from(r, (x) => x === undefined ? '' : x));
    });
    sheets.push({ name, rows });
  }
  if (!sheets.length) throw new Error('The Excel file has no sheets.');
  return { sheets };
}
/* ---------- matrix reading: any column layout, with a mapping that can be saved and reapplied ---------- */
const PRIOS = ['P0', 'P1', 'P2', 'P3', 'Not required'];
function normPrio(v) {
  const s = String(v === undefined || v === null ? '' : v).trim().toLowerCase(); if (!s) return '';
  if (/^p\s*0$|^0$|critical|blocker|showstopper/.test(s)) return 'P0';
  if (/^p\s*1$|^1$|^high|^must|^key|primary/.test(s)) return 'P1';
  if (/^p\s*2$|^2$|^med|^should|secondary/.test(s)) return 'P2';
  if (/^p\s*3$|^3$|^low|^could|nice/.test(s)) return 'P3';
  if (/not req|n\/a|^nr$|^na$|out of scope|skip|drop|exclude|won.?t|^no$/.test(s)) return 'Not required';
  return '';
}
const defaultPrio = (kind) => kind === 'Edge' || kind === 'Gap' ? 'P2' : 'P1';
const FIELD_RE = { id: /^(scenario )?id$|^scenario id$|^s[- ]?id$/, name: /^(scenario |test |case )?name$/, ch: /channel/, title: /^scenario$|description|title|^scenario (name|description)$|^test (scenario|case)$/, reqs: /requirement|req\b|req id|reqs/, kind: /^type$|kind|scenario type|test type/, cat: /^categor(y|ies)$|^group$/, expect: /expected|outcome|result/, so: /^payloads?( files?| ids?| names?| refs?| reference)?$|^(sales )?orders?( no\.?| number| #)?$|^so$|sales order|^ref(erence)?( id| no\.?| number| #)?$|^(test )?(case|data|ticket|transaction) (id|ref(erence)?|no\.?|number)$/, prio: /priority|^prio$|^p$/ };
function readMatrixSheet(rows) {
  rows = rows.filter((r) => r.some((x) => String(x).trim() !== ''));
  if (!rows.length) throw new Error('The sheet is empty.');
  let hi = rows.findIndex((r) => r.some((x) => /scenario|description/i.test(String(x))) && r.some((x) => /requirement|type|expected|channel|priority/i.test(String(x))));
  if (hi < 0) hi = 0;
  const seen = {}, headers = rows[hi].map((x, i) => { let h = String(x).trim() || `Column ${i + 1}`; if (seen[h.toLowerCase()]) h += ' (' + (i + 1) + ')'; seen[h.toLowerCase()] = 1; return h; });
  const auto = {}, taken = new Set();
  const find = (re, cond) => headers.findIndex((h, k) => !taken.has(k) && re.test(h.toLowerCase()) && (!cond || cond(h.toLowerCase())));
  const claim = (f, i) => { if (i >= 0) { auto[f] = headers[i]; taken.add(i); } return i; };
  claim('id', find(FIELD_RE.id));
  /* Only the key columns are mapped: ID and Name. A plain "Scenario" or "Description" column is read as the Name. Scenario, Expected outcome and Requirements are generated by AI from the payloads, so they are not mapped, unless the file is in this tool's own layout (it has a Name column next to them). */
  let ni = find(FIELD_RE.name); const own = ni >= 0;
  if (ni < 0) ni = find(FIELD_RE.title, (h) => !/\bid\b/.test(h));
  claim('name', ni);
  if (own) ['title', 'reqs', 'expect'].forEach((f) => claim(f, find(FIELD_RE[f], (h) => !/\bid\b/.test(h))));
  ['cat', 'kind', 'prio', 'ch', 'so'].forEach((f) => claim(f, find(FIELD_RE[f])));
  return { headers, body: rows.slice(hi + 1), auto };
}
function applyMatrixMap(sheet, map) {
  const warnings = [], H = sheet.headers.map((h) => h.toLowerCase()), idx = {};
  Object.entries(map || {}).forEach(([f, name]) => { const i = name ? H.indexOf(String(name).toLowerCase()) : -1; if (i >= 0) idx[f] = i; });
  const mapped = new Set(Object.values(idx)), extraHeaders = sheet.headers.filter((_, i) => !mapped.has(i));
  const out = [], used = new Set(); let n = 0;
  sheet.body.forEach((r) => {
    const get = (f) => idx[f] !== undefined ? String(r[idx[f]] === undefined ? '' : r[idx[f]]).trim() : '';
    const extra = {}; sheet.headers.forEach((h, i) => { if (!mapped.has(i) && r[i] !== undefined && String(r[i]).trim() !== '') extra[h] = String(r[i]).trim(); });
    let kind = get('kind'); const k = KINDS.find((x) => x.toLowerCase() === kind.toLowerCase()); if (k) kind = k;
    if (!kind) kind = 'Happy';
    const rawPrio = get('prio'), prio = normPrio(rawPrio);
    if (rawPrio && !prio) warnings.push(`Priority "${rawPrio}" was not understood and was set from the type.`);
    const id = get('id'); if (id) used.add(id);
    const name = get('name'), title = get('title'), expect = get('expect'), reqs = (get('reqs').match(/[A-Z]{1,5}(?:-[A-Z]{2,6})*-\d{1,4}/g) || []);
    out.push({ id, ch: get('ch') || 'All', cat: get('cat'), kind, name, title, reqs, expect, so: get('so'), prio: prio || defaultPrio(kind), extra });
  });
  out.forEach((s) => { if (!s.id) { do { n++; } while (used.has('S-' + String(n).padStart(2, '0'))); s.id = 'S-' + String(n).padStart(2, '0'); used.add(s.id); warnings.push(`A row without an ID was numbered ${s.id}.`); } });
  if (idx.title === undefined && idx.expect === undefined && idx.reqs === undefined) warnings.push('Scenario, Expected outcome and Requirements are left blank. They are generated from the matched payloads once those are imported.');
  if (idx.kind === undefined) warnings.push('No Type column is mapped. Every scenario was set to Happy.');
  if (idx.prio === undefined) warnings.push('No Priority column is mapped. Priorities were set from the scenario type.');
  return { rows: out, warnings, extraHeaders };
}
function matrixFromRows(rows, map) {
  const sheet = readMatrixSheet(rows), m = map || sheet.auto;
  if (!m.name && !m.id) throw new Error('No Name or Scenario ID column found. Choose the key column.');
  return { ...applyMatrixMap(sheet, m), headers: sheet.headers, map: m, sheet };
}

Object.assign(C, { PRIOS, normPrio, defaultPrio, readMatrixSheet, applyMatrixMap, unzip, analyzePrd, analyzeMatrix, parseCsv, readXlsx, matrixFromRows, SCENARIO_KINDS: KINDS });
})(typeof window !== 'undefined' ? window : globalThis);
