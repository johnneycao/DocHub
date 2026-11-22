/* Payload library: zip import and export, ER model inferred from JSON, comparison with the scenario matrix.
   Pure functions, no DOM. Loaded after check.js; adds to window.Core. */
(function (g) {
'use strict';
const C = g.Core;
const STOP = new Set('that this with from have must when then than into their there which would should could about after before every each only also been being does done other such same will your over under above below'.split(' '));
const toks = (s) => new Set((String(s).toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || []).filter((w) => !STOP.has(w)).map((w) => w.replace(/(ies)$/, 'y').replace(/s$/, '')));
const inter = (a, b) => [...a].filter((x) => b.has(x)).length;

/* ---------- import of a payload library zip ---------- */

/* ---------- payload formats: JSON, XML and CSV are all turned into the same JSON structure ---------- */
const PAYLOAD_EXT = /\.(json|xml|csv)$/i;
const scalar = (t) => { t = String(t).trim(); if (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(t)) return Number(t); if (t === 'true') return true; if (t === 'false') return false; return t; };
function xmlToJson(text) {
  const src = String(text).replace(/^﻿/, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/gi, '');
  const re = /<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
  const local = (n) => n.replace(/^.*:/, '');
  const root = { name: '#root', attrs: {}, kids: [], text: '' }, stack = [root]; let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) { top.text += m[1]; continue; }
    if (m[6] !== undefined) { top.text += unesc(m[6]); continue; }
    if (m[2]) { if (stack.length > 1) stack.pop(); continue; }
    const node = { name: local(m[3]), attrs: {}, kids: [], text: '' };
    String(m[4] || '').replace(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_, k, a, b) => { if (!/^xmlns(:|$)/.test(k)) node.attrs[local(k)] = unesc(a !== undefined ? a : b); return ''; });
    top.kids.push(node); if (!m[5]) stack.push(node);
  }
  const conv = (n) => {
    const keys = Object.keys(n.attrs);
    if (!keys.length && !n.kids.length) return n.text.trim() === '' ? null : scalar(n.text);
    const o = {}; keys.forEach((k) => { o[k] = scalar(n.attrs[k]); });
    const by = {}; n.kids.forEach((k) => { (by[k.name] = by[k.name] || []).push(conv(k)); });
    Object.entries(by).forEach(([k, v]) => { const key = k in o ? '@' + k : k; o[key] = v.length > 1 ? v : v[0]; });
    if (n.kids.length && n.text.trim()) o['#text'] = n.text.trim(); else if (!n.kids.length && n.text.trim()) o['#text'] = scalar(n.text);
    return o;
  };
  const el = root.kids[0]; if (!el) throw new Error('No XML element found');
  return { [el.name]: conv(el) };
}
function csvToJson(text) {
  const t = String(text).replace(/^﻿/, ''), first = t.split(/\r?\n/)[0] || '';
  const delim = [',', ';', '\t', '|'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = C.parseCsv(t, delim).filter((r) => r.some((x) => String(x).trim() !== ''));
  if (rows.length < 2) throw new Error('The CSV has no data rows');
  const head = rows[0].map((h, i) => String(h).trim() || 'column' + (i + 1));
  return rows.slice(1, 2001).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] === undefined || String(r[i]).trim() === '' ? null : scalar(r[i])])));
}
/* one file's text to JSON, by its extension */
function parsePayloadText(name, text) {
  if (/\.xml$/i.test(name)) return xmlToJson(text);
  if (/\.csv$/i.test(name)) return csvToJson(text);
  return JSON.parse(String(text).replace(/^﻿/, ''));
}

async function readPayloadZip(buf) {
  const z = await C.unzip(buf), out = [], skipped = [];
  for (const name of Object.keys(z.files)) {
    if (name.endsWith('/') || /(^|\/)(__MACOSX|\.)/.test(name) || /(^|\/)index\.json$/i.test(name)) continue;
    if (!PAYLOAD_EXT.test(name)) { skipped.push(name); continue; }
    if (out.length >= 5000) { skipped.push(name + ' (more than 5000 files)'); continue; }
    try { out.push({ path: name, json: parsePayloadText(name, await z.text(name)) }); } catch (e) { skipped.push(name + ' (could not be read as ' + name.split('.').pop().toUpperCase() + ')'); }
  }
  return { files: out, skipped };
}

/* ---------- entity inference ---------- */
const pascal = (s) => String(s).replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('') || 'Item';
const singular = (w) => /ies$/i.test(w) ? w.replace(/ies$/i, 'y') : /(ss|us)$/i.test(w) ? w : w.replace(/s$/i, '');
const tname = (v) => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'int' : 'decimal') : typeof v === 'boolean' ? 'bool' : typeof v === 'object' ? 'object' : 'string';
const safe = (s) => String(s).replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');

function erMermaid(ents, rels, noteFn) {
  const nm = (x) => safe(x).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
  return ['erDiagram', ...rels.map((r) => `  ${nm(r.a)} ${r.card === 'many' ? '||--o{' : r.card === 'one' ? '||--o|' : '}o--||'} ${nm(r.b)} : "${r.label}"`),
    ...ents.map((e) => `  ${nm(e.name)} {\n${e.fields.map((f) => { const n = (noteFn ? noteFn(e.name, f.name, f) : f.optional ? 'optional' : '').replace(/"/g, "'"); return `    ${f.type.split(' or ')[0] || 'null'} ${safe(f.name)}${f.key ? ' PK' : f.fk ? ' FK' : ''}${n ? ` "${n}"` : ''}`; }).join('\n') || '    string none'}\n  }`)].join('\n');
}
function buildErModel(docs) {
  const ents = new Map(), rels = new Map();
  const ent = (name) => { if (!ents.has(name)) ents.set(name, { name, fields: new Map(), seen: 0, files: new Set(), stub: false }); return ents.get(name); };
  const rel = (a, b, card, label) => { const k = a + '|' + b + '|' + label; if (!rels.has(k)) rels.set(k, { a, b, card, label, n: 0 }); rels.get(k).n++; };
  const newField = (extra) => ({ types: new Set(), n: 0, labels: new Set(), tl: {}, ...(extra || {}) });
  /* GraphQL-style wrappers are not entities: {data:{order:{...}}} is the order, {nodes:[...]} or {edges:[{node}]} is a list, and {shopMoney:{...}} is an amount */
  const conn = (o, key) => { if (!o || typeof o !== 'object' || Array.isArray(o)) return o; if (Array.isArray(o.nodes)) return o.nodes; if (Array.isArray(o.edges)) return o.edges.map((x) => x && x.node).filter(Boolean); const k = Object.keys(o); if (k.length === 1 && Array.isArray(o[k[0]]) && o[k[0]].some((x) => x && typeof x === 'object')) return o[k[0]]; if (k.length === 1 && key && o[k[0]] && typeof o[k[0]] === 'object' && singular(String(key)).toLowerCase() === k[0].toLowerCase()) return [o[k[0]]]; return o; };
  const isMoney = (o) => !!o && typeof o === 'object' && !Array.isArray(o) && (!!o.shopMoney || !!o.presentmentMoney || ('amount' in o && 'currencyCode' in o && Object.keys(o).length <= 3));
  const unwrapTop = (o) => { while (o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).length === 1 && o[Object.keys(o)[0]] && typeof o[Object.keys(o)[0]] === 'object' && !Array.isArray(o[Object.keys(o)[0]])) o = o[Object.keys(o)[0]]; return o; };
  /* the entity of a file comes from its folder (returns/ is a Return, refunds/ a Refund), never from the file name */
  const gs = buildGroups(docs), entOf = {}, mainNames = {}, folderNames = new Set();
  /* the payload header (the folder named by the payload ID, a file named by it, or a key holding it) is never an entity: the model is the structure that all payloads share */
  const isId = (n) => /\d{3,}/.test(String(n)) || gs.some((g) => normId(g.id) === normId(n));
  const nameOf = (raw) => { const r0 = String(raw).replace(/\.(json|xml|csv)$/i, ''), n = pascal(singular(r0.replace(/[-_ ]?\d+$/, ''))); return !n || isId(r0) || isId(n) ? '' : n; };
  gs.forEach((g) => g.files.forEach((f) => { const folder = f.entity !== '(main)'; entOf[f.path] = (folder ? f.entity.split('/').reverse().map(nameOf).find(Boolean) || nameOf(f.rel.split('/').pop()) : nameOf(f.rel)) || 'Document'; if (folder) folderNames.add(entOf[f.path]); else mainNames[entOf[f.path]] = (mainNames[entOf[f.path]] || 0) + 1; }));
  const visit = (val, name, file, parent, via) => {
    const e = ent(name); e.seen++; e.files.add(file);
    if (parent) rel(parent, name, via, via === 'many' ? 'has' : 'has one');
    Object.entries(val).forEach(([k, v0]) => {
      if (/\d{4,}/.test(k)) return; /* a key that is itself an identifier is data, not structure */
      const v = conn(v0, k), money = isMoney(v), t = money ? 'money' : tname(v), f = e.fields.get(k) || newField();
      f.n++; f.types.add(t); f.labels.add(file); (f.tl[t] = f.tl[t] || new Set()).add(file); e.fields.set(k, f);
      if (Array.isArray(v)) {
        const objs = v.filter((x) => x && typeof x === 'object' && !Array.isArray(x));
        if (objs.length) objs.forEach((o) => visit(o, pascal(singular(k)), file, name, 'many'));
        else f.list = true;
      } else if (v && typeof v === 'object' && !money) visit(v, pascal(k), file, name, 'one');
      else { const m = k.match(/^(.+?)(?:Id|_id)$/); if (m && m[1] && m[1].toLowerCase() !== 'tax') { const t2 = ent(pascal(m[1])); t2.stub = t2.stub || !t2.seen; t2.files.add(file); t2.fields.set('id', t2.fields.get('id') || newField({ types: new Set(['string']), key: true })); f.fk = t2.name; rel(name, t2.name, 'ref', 'references'); } }
    });
  };
  docs.forEach(({ path, json }) => {
    const file = labelOf({ path, json });
    const list = Array.isArray(json) ? json : [json];
    list.forEach((doc) => {
      if (!doc || typeof doc !== 'object') return;
      const ex = Array.isArray(doc.exchanges) ? doc.exchanges : (doc.request || doc.response) ? [doc] : null;
      if (ex) ex.forEach((x) => {
        const url = ((x.request || {}).url || '').split('?')[0], seg = url.split('/').filter(Boolean).pop() || 'Payload', base = pascal(singular(seg));
        if (x.request && x.request.body && typeof x.request.body === 'object') visit(x.request.body, base + 'Request', file);
        if (x.response && x.response.body && typeof x.response.body === 'object') visit(x.response.body, base + 'Response', file);
      });
      else visit(unwrapTop(doc), entOf[path] || 'Document', file);
    });
  });
  ents.forEach((e) => e.fields.forEach((f, k) => { if (k === 'id' || k.toLowerCase() === e.name.replace(/(Request|Response)$/, '').toLowerCase() + 'id') f.key = true; }));
  const entities = [...ents.values()].map((e) => ({ name: e.name, seen: e.seen, files: [...e.files], stub: e.stub, fields: [...e.fields.entries()].map(([k, f]) => ({ name: k, type: [...f.types].filter((t) => t !== 'null').join(' or ') || 'null', key: !!f.key, fk: f.fk || '', optional: f.n < e.seen, list: !!f.list, labels: [...f.labels], typeLabels: Object.fromEntries(Object.entries(f.tl).map(([t, s]) => [t, [...s]])), missing: [...e.files].filter((l) => !f.labels.has(l)) })) }));
  const mainName = Object.entries(mainNames).sort((x, y) => y[1] - x[1]).map((x) => x[0])[0];
  if (mainName && ents.has(mainName)) folderNames.forEach((fn) => { if (fn !== mainName && ents.has(fn)) rel(mainName, fn, 'many', 'has'); });
  const relations = [...rels.values()];
  return { entities, relations, root: mainName && ents.has(mainName) ? mainName : '', mermaid: erMermaid(entities, relations) };
}

/* ---------- inconsistencies in the data itself ---------- */
const ISO_DT = /^\d{4}-\d{2}-\d{2}T/, ISO_D = /^\d{4}-\d{2}-\d{2}$/, SLASH = /^\d{1,2}\/\d{1,2}\/\d{2,4}/;
const dateFmt = (s) => ISO_DT.test(s) ? 'ISO date-time' : ISO_D.test(s) ? 'ISO date' : SLASH.test(s) ? 'day/month/year' : 'other';
function bodyValues(doc) {
  const j = doc.json, ex = exchangesOf(doc), bodies = ex.length ? ex.flatMap((e) => [e.req.body, e.res.body]) : [j];
  return bodies.filter((b) => b && typeof b === 'object');
}
function payloadInconsistencies(docs, er) {
  const out = [], num = (t) => t === 'int' || t === 'decimal' ? 'number' : t, uniq = (a) => [...new Set(a)];
  er.entities.forEach((e) => {
    const norm = {}, nk = (n) => n.toLowerCase().replace(/[_\- ]/g, '');
    e.fields.forEach((f) => { (norm[nk(f.name)] = norm[nk(f.name)] || []).push(f); });
    e.fields.forEach((f) => {
      const tl = Object.entries(f.typeLabels).filter(([t]) => t !== 'null'), kinds = uniq(tl.map(([t]) => num(t)));
      if (kinds.length > 1) out.push({ kind: 'Type conflict', entity: e.name, fields: [f.name], text: tl.map(([t, l]) => `${t} in ${l.join(', ')}`).join('; '), labels: uniq(tl.flatMap(([, l]) => l)), note: 'type ' + tl.map(([t]) => t).join(' or ') });
      if (e.seen >= 2 && f.missing.length && f.labels.length && !f.key && norm[nk(f.name)].length === 1) out.push({ kind: 'Optional field', entity: e.name, fields: [f.name], text: `present in ${f.labels.join(', ')}; missing in ${f.missing.join(', ')}`, labels: f.missing, note: 'optional' });
    });
    Object.values(norm).filter((a) => a.length > 1).forEach((a) => out.push({ kind: 'Name variant', entity: e.name, fields: a.map((f) => f.name), text: a.map((f) => `${f.name} in ${f.labels.join(', ')}`).join('; '), labels: uniq(a.flatMap((f) => f.labels)), note: 'name variants ' + a.map((f) => f.name).join(' / ') }));
  });
  /* values and date formats by field name */
  const vals = {}, dates = {};
  docs.forEach((d) => { const label = labelOf(d); bodyValues(d).forEach((b) => (function walk(v) { if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => {
    if (typeof x === 'string' && x.trim()) {
      if (/date|time|(^|[a-z])At$|_at$/i.test(k)) { const f = dateFmt(x.trim()); ((dates[k] = dates[k] || {})[f] = (dates[k][f] || new Set())).add(label); }
      else if (x.length <= 40 && !/(^|[a-z])id$|_id$|^id$|url|email|sku|name/i.test(k)) { const n = x.trim().toLowerCase(); ((vals[k] = vals[k] || {})[n] = (vals[k][n] || {}))[x.trim()] = ((vals[k][n] || {})[x.trim()] || new Set()).add(label); }
    } else walk(x);
  }); })(b)); });
  Object.entries(vals).forEach(([k, g]) => { if (Object.keys(g).length > 20) return; Object.values(g).filter((vs) => Object.keys(vs).length > 1).forEach((vs) => out.push({ kind: 'Value variant', entity: '*', fields: [k], text: Object.entries(vs).map(([v, s]) => `"${v}" in ${[...s].join(', ')}`).join('; '), labels: uniq(Object.values(vs).flatMap((s) => [...s])), note: 'values differ by case: ' + Object.keys(vs).join(' / ') })); });
  Object.entries(dates).forEach(([k, g]) => { if (Object.keys(g).length > 1) out.push({ kind: 'Date format', entity: '*', fields: [k], text: Object.entries(g).map(([f, s]) => `${f} in ${[...s].join(', ')}`).join('; '), labels: uniq(Object.values(g).flatMap((s) => [...s])), note: 'date formats ' + Object.keys(g).join(' / ') }); });
  /* the folder says one reference, the body says another */
  docs.forEach((d) => {
    const parts = d.path.split('/'), folder = parts.length > 1 ? parts[parts.length - 2] : '', fk = (folder.match(/[A-Za-z]*-?\d{4,}/g) || []).map((x) => x.toUpperCase());
    if (!fk.length) return;
    const body = []; bodyValues(d).forEach((b) => (function walk(v) { if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { if ((typeof x === 'string' || typeof x === 'number') && SO_KEYS.test(k) && String(x).trim()) body.push(String(x).trim().toUpperCase()); else walk(x); }); })(b));
    if (body.length && !body.some((x) => fk.includes(x))) out.push({ kind: 'Folder and body disagree', entity: '*', fields: [], text: `folder ${folder} holds a body that names ${uniq(body).join(', ')}`, labels: [labelOf(d)], note: '' });
  });
  const ORD = ['Type conflict', 'Folder and body disagree', 'Name variant', 'Value variant', 'Date format', 'Optional field'];
  return out.sort((a, b) => ORD.indexOf(a.kind) - ORD.indexOf(b.kind));
}
const incNotes = (inc) => { const m = {}; inc.forEach((i) => { if (!i.note) return; i.fields.forEach((f) => { const k = `${i.entity}.${f}`; if (i.kind === 'Optional field' && m[k]) return; m[k] = i.kind === 'Optional field' ? 'optional' : 'inconsistent: ' + i.note; }); }); return m; };
const noteFnFor = (inc) => { const m = incNotes(inc); return (e, f, fld) => { const own = m[`${e}.${f}`], glob = m[`*.${f}`]; if (own && own.startsWith('inconsistent')) return own; if (glob) return glob; return own || (fld.optional ? 'optional' : ''); }; };

/* ---------- match payloads to scenarios and compare ---------- */
const flat = (v) => typeof v === 'object' && v ? Object.entries(v).map(([k, x]) => k + ' ' + flat(x)).join(' ') : String(v);
function exchangesOf(doc) {
  const j = doc.json;
  const ex = Array.isArray(j && j.exchanges) ? j.exchanges : (j && (j.request || j.response)) ? [j] : [];
  return ex.map((x) => ({ req: x.request || {}, res: x.response || {} }));
}
/* keys that carry the reference of the case, order, ticket or transaction a payload belongs to */
const SO_KEYS = /^(sales_?order(_?id|_?number)?|so_?(number|id)?|order_?(id|name|number)|parent_?order|customer_?reference|reference(_?id|_?number)?|ref(_?id|_?no|_?number)?|transaction_?(id|number)|case_?(id|number)|ticket_?(id|number)|record_?id)$/i;
function soSet(doc) {
  const set = new Set(), base = doc.path.split('/'), folder = base.length > 1 ? base[base.length - 2] : '';
  (folder.match(/[A-Za-z]*-?\d{4,}/g) || []).forEach((x) => set.add(x.toUpperCase()));
  (function walk(v) { if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { if (typeof x === 'string' || typeof x === 'number') { if (SO_KEYS.test(k) && String(x).trim()) set.add(String(x).trim().toUpperCase()); } else walk(x); }); })(doc.json);
  return [...set];
}
/* the label used for "references behind every count": the reference, else the folder, else the file */
function labelOf(doc) {
  const so = soSet(doc); if (so.length) return so[0];
  const p = doc.path.split('/'); return p.length > 1 ? p[p.length - 2] + '/' + p[p.length - 1] : p[0];
}
/* The Payload column of a scenario holds one or more payload names (file name, path, id or reference), separated by commas, semicolons or new lines. A payload can serve several scenarios and a scenario can use several payloads. */
const payTokens = (s) => String(s && s.so || '').split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
const normTok = (x) => String(x).trim().toLowerCase().replace(/\.(json|xml|csv)$/, '');
function payKeys(d) {
  const p = d.path, base = p.split('/').pop(), set = new Set([p, base].map(normTok)), j = d.json || {};
  if (j.id) set.add(normTok(j.id));
  soSet(d).forEach((x) => set.add(normTok(x)));
  return set;
}
function matchPayloads(docs, rows) {
  const byId = Object.fromEntries(rows.map((s) => [s.id, s])), out = [];
  docs.forEach((d) => {
    const j = d.json || {}, ids = new Set(); let how = '', strong = false;
    [].concat(j.scenario || j.scenarios || []).forEach((x) => { if (byId[x]) { ids.add(x); how = how || 'by scenario field'; strong = true; } });
    const sos = soSet(d), keys = payKeys(d);
    rows.forEach((s) => { if (payTokens(s).some((t) => keys.has(normTok(t)))) { ids.add(s.id); how = how || 'by Payload column'; strong = true; } });
    if (!ids.size) { (d.path.match(/\bS-\d{1,4}\b/gi) || []).forEach((x) => { if (byId[x.toUpperCase()]) { ids.add(x.toUpperCase()); how = 'by file name'; strong = true; } }); }
    if (!ids.size && exchangesOf(d).length) {
      const t = toks(exchangesOf(d).map((e) => (e.req.url || '') + ' ' + flat(e.req.body || {})).join(' ')); let best = null, sc = 0, tie = false;
      rows.forEach((s) => { const n = inter(t, toks(s.title)); if (n > sc) { sc = n; best = s; tie = false; } else if (n === sc && n) tie = true; });
      if (best && sc >= 3 && !tie) { ids.add(best.id); how = 'by wording (check it)'; }
    }
    out.push({ path: d.path, label: labelOf(d), sos, scenarios: [...ids], how: how || 'no match', strong, ex: exchangesOf(d) });
  });
  return out;
}

/* ---------- payload groups: one folder per payload ID, sub-folders for the related entities ---------- */
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* an ID such as UAT25283 is also found as UAT-25283 or inside free text such as "UAT26401 Nov 5 / UAT25766" */
const idRe = (id) => new RegExp('(^|[^A-Za-z0-9])' + escRe(id).replace(/([A-Za-z])(\d)/g, '$1-?$2') + '(?![A-Za-z0-9])', 'i');
const mentions = (text, id) => String(id).length >= 3 && idRe(id).test(String(text));
/* The payload level is the folder level whose folders are the payloads (for example uat/<SO>/...). Wrapper folders above it, and stray files next to the payload folders, are ignored. */
function payloadLevel(dirs) {
  let L = 0;
  for (;;) {
    const withDir = dirs.filter((d) => d.length > L), vals = new Set(withDir.map((d) => d[L]));
    if (vals.size > 1 || withDir.length < dirs.length || !withDir.length) {
      /* a single payload folder: its own files sit directly in the common folder and only a few entity folders lie below it */
      if (L > 0 && vals.size < 4 && withDir.length && withDir.length < dirs.length && new Set(withDir.map((d) => d.slice(0, L).join('/'))).size === 1) return { L: L - 1, vals };
      return { L, vals };
    }
    L++;
  }
}
function buildGroups(docs) {
  const map = new Map();
  const put = (id, d, rel) => { const entity = rel.length > 1 ? rel.slice(0, -1).join('/') : '(main)', key = normId(id); if (!map.has(key)) map.set(key, { id, files: [], counts: {} }); const g = map.get(key); g.files.push({ path: d.path, rel: rel.join('/'), entity, json: d.json }); g.counts[entity] = (g.counts[entity] || 0) + 1; };
  const place = (items) => {
    const dirs = items.map((x) => x.segs.slice(0, -1)), { L, vals } = payloadLevel(dirs);
    /* two or more wrapper folders (for example two imports) that each hold many payload folders */
    if (L === 0 && vals.size > 1 && vals.size <= 4) {
      const parts = {}; items.forEach((x) => { if (x.segs.length > 2) (parts[x.segs[0]] = parts[x.segs[0]] || []).push({ d: x.d, segs: x.segs.slice(1) }); });
      if (Object.keys(parts).length === vals.size && Object.values(parts).every((l) => new Set(l.map((x) => x.segs[0])).size >= 6)) { Object.values(parts).forEach(place); return; }
    }
    const anyDeep = dirs.some((d) => d.length > L);
    items.forEach((x) => {
      const dir = x.segs.slice(0, -1);
      if (dir.length > L) put(dir[L], x.d, x.segs.slice(L + 1));
      else if (!anyDeep) put(x.segs[x.segs.length - 1].replace(/\.(json|xml|csv)$/i, ''), x.d, [x.segs[x.segs.length - 1]]); /* flat files: one payload per file */
    });
  };
  place(docs.map((d) => ({ d, segs: String(d.path).split('/').filter(Boolean) })));
  return [...map.values()].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}
function flatten(v, out, path, depth) {
  out = out || {}; path = path || ''; depth = depth || 0;
  if (v === null || v === undefined) return out;
  if (Array.isArray(v) && !path && v.length && v[0] && typeof v[0] === 'object' && !Array.isArray(v[0])) { out['rows[]'] = v.length; return flatten(v[0], out, '', depth + 1); }
  if (Array.isArray(v)) { out[path + '[]'] = v.length; if (v.length && depth < 4 && v[0] && typeof v[0] === 'object') flatten(v[0], out, path + '[0]', depth + 1); return out; }
  if (typeof v === 'object') {
    const k = Object.keys(v);
    if (!path && k.length === 1 && v[k[0]] && typeof v[k[0]] === 'object' && !Array.isArray(v[k[0]])) return flatten(v[k[0]], out, '', depth); /* unwrap {data:{order:{...}}} */
    k.forEach((key) => { if (depth < 5) flatten(v[key], out, path ? path + '.' + key : key, depth + 1); }); return out;
  }
  out[path] = v; return out;
}
const mainFlat = (g) => g._flat || (g._flat = flatten((g.files.find((f) => f.entity === '(main)') || g.files[0]).json));
const shortPath = (p) => p.replace(/\[0\]/g, '').split('.').filter((x) => x && x !== 'shopMoney').map((x) => x.replace(/Set$/, '')).slice(-3).join('.');
const KEYRE = /status|state|type|kind|channel|source|currency|tax|total|amount|price|gateway|tender|reason|tag|entity|name|exempt|note|financial|fulfil|method/i;
const SKIPRE = /(^|\.)(id|gid)$|Id$|url|email|phone|address|cursor|token|createdAt|updatedAt|processedAt|cancelledAt|closedAt/i;
const show = (v) => v === undefined ? '' : String(v).length > 40 ? String(v).slice(0, 38) + '...' : String(v);
/* the key columns: the fields most useful to compare payloads, plus a count per related entity; cells that differ from the other payloads are flagged */
function groupTable(groups, scnByGroup) {
  const n = groups.length, stats = {};
  groups.forEach((g) => { const f = mainFlat(g); Object.keys(f).forEach((k) => { const s = stats[k] || (stats[k] = { path: k, count: 0, vals: new Map(), len: 0 }); s.count++; const v = String(f[k]); s.vals.set(v, (s.vals.get(v) || 0) + 1); s.len += v.length; }); });
  const cands = Object.values(stats).filter((s) => s.count / n >= 0.4 && !SKIPRE.test(s.path) && s.len / s.count <= 60).map((s) => {
    const distinct = s.vals.size, mode = [...s.vals.entries()].sort((a, b) => b[1] - a[1])[0], cov = s.count / n;
    const cat = distinct >= 2 && distinct <= 12, score = (KEYRE.test(s.path) ? 3 : 0) + cov * 2 + (cat ? 2 : distinct === 1 ? -2 : 0) + (s.path.split('.').length <= 3 ? 1 : 0) - (distinct / s.count > 0.9 && n > 8 && !/amount|price|total|value/i.test(s.path) ? 4 : 0);
    return { ...s, distinct, cat, mode: mode[0], modeShare: mode[1] / s.count, cov, score };
  }).sort((a, b) => b.score - a.score).slice(0, 8);
  const entNames = {}; groups.forEach((g) => Object.keys(g.counts).forEach((e) => { if (e !== '(main)') entNames[e] = (entNames[e] || 0) + 1; }));
  const entCols = Object.entries(entNames).filter(([, c]) => c / n >= 0.2).sort((a, b) => b[1] - a[1]).map(([e, c]) => ({ entity: e, share: c / n }));
  /* key fields from the entity sub-folders (for example the tender of a transaction or the status of a return), joined per payload when there are several files */
  const es = {};
  groups.forEach((g) => g.files.filter((f) => f.entity !== '(main)').forEach((f) => { const fl = flatten(f.json); Object.keys(fl).forEach((k) => { const v = fl[k]; if (typeof v === 'object' || SKIPRE.test(k) || !KEYRE.test(k) || String(v).length > 30 || typeof v === 'number') return; const key = f.entity + '::' + k, e = es[key] || (es[key] = { entity: f.entity, path: k, per: new Map() }); if (!e.per.has(g.id)) e.per.set(g.id, new Set()); e.per.get(g.id).add(String(v)); }); }));
  const entVals = Object.values(es).map((e) => {
    const strs = [...e.per.values()].map((s) => [...s].sort().join(' + ')), cnt = new Map(); strs.forEach((x) => cnt.set(x, (cnt.get(x) || 0) + 1));
    const all = new Set([...e.per.values()].flatMap((s) => [...s])), mode = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0], cov = e.per.size / n;
    return { ...e, distinct: all.size, mode: mode[0], modeShare: mode[1] / e.per.size, cov, score: 3 + cov * 2 + (all.size >= 2 && all.size <= 12 ? 2 : -3), label: e.entity.split('/').pop() + '.' + shortPath(e.path) };
  }).filter((e) => e.cov >= 0.3 && e.distinct >= 1 && e.distinct <= 12).sort((a, b) => b.score - a.score);
  const perEnt = {}, entFields = entVals.filter((e) => (perEnt[e.entity] = (perEnt[e.entity] || 0) + 1) <= 2).slice(0, 5);
  const rows = groups.map((g) => {
    const f = mainFlat(g), issues = [];
    const cells = cands.map((c) => {
      const raw = f[c.path], v = raw === undefined ? undefined : String(raw); let flag = '';
      if (v === undefined) { if (c.cov >= 0.6) { flag = 'missing'; issues.push(shortPath(c.path) + ' missing'); } }
      else if (c.cat && n >= 4 && c.modeShare >= 0.5 && v !== c.mode) { flag = 'diff'; issues.push(shortPath(c.path) + ' = ' + show(v)); }
      return { value: v, flag };
    });
    const entCells = entFields.map((e) => { const s = e.per.get(g.id), v = s ? [...s].sort().join(' + ') : undefined; let flag = ''; if (v === undefined) { if (e.cov >= 0.6) { flag = 'missing'; issues.push(e.label + ' missing'); } } else if (n >= 4 && e.modeShare >= 0.5 && v !== e.mode) { flag = 'diff'; issues.push(e.label + ' = ' + show(v)); } return { value: v, flag }; });
    const counts = entCols.map((e) => { const k = g.counts[e.entity] || 0; const flag = !k && e.share >= 0.6 ? 'missing' : ''; if (flag) issues.push('no ' + e.entity); return { value: k, flag }; });
    return { id: g.id, scenarios: (scnByGroup && scnByGroup[g.id]) || [], cells, entCells, counts, issues, files: g.files.length };
  });
  return { cols: cands.map((c) => ({ path: c.path, label: shortPath(c.path), mode: c.mode, cat: c.cat, distinct: c.distinct, cov: c.cov })), entCols, entFields: entFields.map((e) => ({ label: e.label, entity: e.entity, mode: e.mode, distinct: e.per.size ? new Set([...e.per.values()].map((s) => [...s].sort().join(' + '))).size : 0 })), rows };
}
/* the payload IDs a scenario names in its Payload column, or, when that is empty, anywhere in its own text */
function groupMatches(groups, rows) {
  const byGroup = {}, byScn = {}, how = {};
  groups.forEach((g) => {
    rows.forEach((s) => {
      const pay = String(s.so || '');
      if (pay && mentions(pay, g.id)) { (byGroup[g.id] = byGroup[g.id] || []).push(s.id); (byScn[s.id] = byScn[s.id] || []).push(g.id); how[g.id] = how[g.id] || 'by Payload column'; return; }
      const hit = g.files.some((f) => { const j = f.json || {}; return [].concat(j.scenario || j.scenarios || []).includes(s.id); });
      if (hit) { (byGroup[g.id] = byGroup[g.id] || []).push(s.id); (byScn[s.id] = byScn[s.id] || []).push(g.id); how[g.id] = how[g.id] || 'by scenario field'; }
    });
  });
  return { byGroup, byScn, how };
}
/* evidence checks: payload IDs named in the matrix that have no folder, folders no scenario names, and folders shaped differently from most */
function groupEvidence(groups, rows, gm) {
  const ids = new Set(groups.map((g) => g.id)), missing = [], idLike = /[A-Za-z]{2,}-?\d{3,}/g;
  rows.forEach((s) => { const seen = new Set(); (String(s.so || '').match(idLike) || []).forEach((t) => { const clean = t.replace('-', ''); if (!seen.has(clean) && ![...ids].some((i) => normId(i) === normId(clean))) { seen.add(clean); missing.push({ scenario: s.id, payload: clean }); } }); });
  const unreferenced = groups.filter((g) => !(gm.byGroup[g.id] || []).length).map((g) => g.id);
  const shapes = {}; groups.forEach((g) => { const k = Object.keys(g.counts).sort().join(' + '); (shapes[k] = shapes[k] || []).push(g.id); });
  return { missing, unreferenced, shapes: Object.entries(shapes).map(([shape, list]) => ({ shape, ids: list })).sort((a, b) => b.ids.length - a.ids.length) };
}
const normId = (x) => String(x).toUpperCase().replace(/[^A-Z0-9]/g, '');
/* a short digest of one payload group: its key fields and entity contents, for the AI */
function groupDigest(g, maxFields) {
  const pick = (flat, n) => Object.entries(flat).filter(([k]) => !SKIPRE.test(k) || /status|state/i.test(k)).sort((a, b) => (KEYRE.test(b[0]) ? 1 : 0) - (KEYRE.test(a[0]) ? 1 : 0)).slice(0, n).map(([k, v]) => `${shortPath(k)}=${show(v)}`);
  const ents = {};
  g.files.filter((f) => f.entity !== '(main)').forEach((f) => { const e = (ents[f.entity] = ents[f.entity] || { count: 0, samples: [] }); e.count++; if (e.samples.length < 3) e.samples.push(pick(flatten(f.json), 14).join('; ')); });
  return { id: g.id, main: pick(mainFlat(g), maxFields || 40).join('; '), entities: ents };
}


/* a readable ER diagram: only the entities most related to the requirements, with their key fields */
const words = (t) => (String(t).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z]{3,}/g) || []).map((w) => w.replace(/(ies)$/, 'y').replace(/s$/, ''));
function keyEr(er, reqs, maxEnt, maxF, designText) {
  maxEnt = maxEnt || 8; maxF = maxF || 6;
  const items = (reqs || []).map((r) => typeof r === 'string' ? { id: '', text: r } : r).map((r) => ({ id: r.id || '', w: new Set(words(r.text || '').filter((w) => !STOP.has(w))) }));
  const rt = new Set(items.flatMap((i) => [...i.w])), dt = new Set(words(designText || '').filter((w) => !STOP.has(w)));
  const GENERIC = new Set(['id', 'name', 'key', 'value', 'type', 'node', 'item', 'data']);
  const hit = (arr, set) => arr.filter((w) => set.has(w)).length;
  /* the root entity is the primary payload (for example the Order that holds all the others): it is always kept, together with the entities directly linked to it */
  const inc = {}, out = {}; er.relations.forEach((r) => { inc[r.b] = (inc[r.b] || 0) + 1; out[r.a] = (out[r.a] || 0) + 1; });
  const roots = er.entities.filter((e) => !inc[e.name] && out[e.name]).sort((a, b) => (out[b.name] - out[a.name]) || (b.seen - a.seen));
  const rootName = er.root && er.entities.some((e) => e.name === er.root) ? er.root : (roots[0] || er.entities.slice().sort((a, b) => b.seen - a.seen)[0] || {}).name;
  const near = new Set(er.relations.filter((r) => r.a === rootName).map((r) => r.b).concat(er.relations.filter((r) => r.b === rootName).map((r) => r.a)));
  const near2 = new Set(er.relations.filter((r) => near.has(r.a) && r.b !== rootName).map((r) => r.b).concat(er.relations.filter((r) => near.has(r.b) && r.a !== rootName).map((r) => r.a)));
  const scored = er.entities.map((e) => {
    const fieldScore = (f) => (f.key ? 5 : f.fk ? 4 : 0) + hit(words(f.name), rt) * 3 + hit(words(f.name), dt) + (KEYRE.test(f.name) ? 2 : 0) - (f.optional ? 0.5 : 0);
    const fields = e.fields.filter((f) => !/^(array|object)/.test(f.type)).sort((a, b) => fieldScore(b) - fieldScore(a)).slice(0, maxF);
    const own = [...new Set([...words(e.name), ...e.fields.flatMap((f) => words(f.name))])].filter((w) => !GENERIC.has(w));
    const impacts = items.filter((i) => i.id && own.some((w) => i.w.has(w))).map((i) => i.id);
    return { e: { ...e, fields, reqs: impacts }, score: hit(words(e.name), rt) * 3 + hit(words(e.name), dt) * 1.5 + e.fields.reduce((n, f) => n + hit(words(f.name), rt), 0) * 0.5 + (KEYRE.test(e.name) ? 1 : 0) + Math.log(e.seen + 1) * 0.6 - (e.stub ? 1 : 0) + (e.name === rootName ? 1000 : 0) + (near.has(e.name) ? 6 : near2.has(e.name) ? 3 : 0) };
  }).sort((a, b) => b.score - a.score).slice(0, maxEnt);
  const names = new Set(scored.map((x) => x.e.name));
  return { entities: scored.map((x) => x.e), relations: er.relations.filter((r) => names.has(r.a) && names.has(r.b)), total: er.entities.length };
}

function analyzePayloads(docs, rows, model) {
  const er = buildErModel(docs), inconsistencies = payloadInconsistencies(docs, er), matches = matchPayloads(docs, rows), pgroups = buildGroups(docs), gm = groupMatches(pgroups, rows), findings = [], add = (type, where, text) => findings.push({ type, where, text });
  const groupOf = {}; pgroups.forEach((g) => g.files.forEach((f) => { groupOf[f.path] = g.id; }));
  matches.forEach((m) => { const g = groupOf[m.path], ss = (g && gm.byGroup[g]) || []; if (ss.length) { ss.forEach((x) => { if (!m.scenarios.includes(x)) m.scenarios.push(x); }); m.strong = true; if (!/^by (scenario field|Payload column)/.test(m.how)) m.how = 'by payload folder ' + g; } m.group = g; });
  const byId = Object.fromEntries(rows.map((s) => [s.id, s])), reqById = Object.fromEntries(model.reqs.map((r) => [r.id, r]));
  const multiG = new Set(pgroups.filter((g) => g.files.length > 1 || Object.keys(g.counts).some((k) => k !== '(main)')).map((g) => g.id));
  pgroups.forEach((g) => { if (multiG.has(g.id) && !(gm.byGroup[g.id] || []).length) add('Unmatched', g.id, `Payload ${g.id} (${g.files.length} files) matches no scenario in the matrix.`); });
  matches.forEach((m) => {
    if (!m.scenarios.length && !multiG.has(m.group)) add('Unmatched', m.path, `${m.path} matches no scenario in the matrix.`);
    m.scenarios.forEach((sid) => {
      const s = byId[sid], last = m.ex[m.ex.length - 1]; if (!s || !last) return; /* the call checks need a request and a response */
      const status = last ? Number(last.res.status) : NaN, body = last ? last.res.body || {} : {};
      const w = `${sid} / ${m.path}`;
      if (!isNaN(status)) {
        if (s.kind === 'Happy' && status >= 400) add('Conflict', w, `${sid} is a happy-path scenario, but the payload ends with HTTP ${status}.`);
        if (s.kind === 'Negative' && status >= 200 && status < 300) add('Conflict', w, `${sid} is a negative scenario, but the payload ends with HTTP ${status}.`);
        if (/\b(reject|refus|block|declin|den(y|ied))/i.test(s.expect) && status < 400) add('Conflict', w, `${sid} expects "${s.expect}", but the payload ends with HTTP ${status}.`);
      }
      if (/\brefund/i.test(s.expect) && !/refund|amount|credit/i.test(flat(body))) add('Conflict', w, `${sid} expects a refund, but the response holds no refund or amount.`);
      const ch = (last && last.req.body && last.req.body.channel) || '';
      if (ch && /^(pos|store)$/i.test(s.ch) && /^(narvar|online|web)$/i.test(ch)) add('Conflict', w, `${sid} is a ${s.ch} scenario, but the request says channel "${ch}".`);
      if (ch && /^online$/i.test(s.ch) && /^(pos)$/i.test(ch)) add('Conflict', w, `${sid} is an online scenario, but the request says channel "${ch}".`);
      const needIdem = (s.reqs || []).some((r) => reqById[r] && /\b(twice|duplicate|once|idempoten|more than once)\b/i.test(reqById[r].text)) || /\b(twice|duplicate|idempoten)\b/i.test(s.title);
      if (needIdem && !m.ex.some((e) => Object.keys(e.req.headers || {}).some((h) => /idempot/i.test(h)))) add('Missing', w, `${sid} is about duplicate events, but the request carries no idempotency key.`);
      if (needIdem && m.ex.length < 2 && /\b(twice|duplicate)\b/i.test(s.title + ' ' + (s.reqs || []).map((r) => (reqById[r] || {}).text).join(' '))) add('Missing', w, `${sid} needs the same request sent twice, but ${m.path} holds one call.`);
      if ((s.reqs || []).some((r) => reqById[r] && /\btax\b/i.test(reqById[r].text)) && !/tax/i.test(flat(last ? last.req.body || {} : {}))) add('Missing', w, `${sid} covers a tax requirement, but the request body has no tax field.`);
    });
  });
  const covered = new Set(matches.flatMap((m) => m.scenarios));
  rows.forEach((s) => { if (!covered.has(s.id)) { const p = s.kind === 'Edge' ? 'P2' : 'P1'; findings.push({ type: 'Missing', where: s.id, priority: p, text: `${p}: ${s.id} has no payload: ${s.title}` }); } });
  const reqs = new Set(rows.filter((s) => covered.has(s.id)).flatMap((s) => s.reqs));
  model.reqs.forEach((r) => { if (rows.some((s) => s.reqs.includes(r.id)) && !reqs.has(r.id)) add('Missing', r.id, `${r.id} has scenarios, but none has a payload.`); });
  /* common patterns and exceptions, each with the references behind the count */
  const sig = (m) => { const l = m.ex[m.ex.length - 1]; if (!l) return 'no request or response'; const k = (o) => o && typeof o === 'object' ? Object.keys(o).sort().join(',') : ''; return `${l.req.method || ''} ${(l.req.url || '').split('/').filter(Boolean).pop() || ''} -> HTTP ${l.res.status || '?'} | request: ${k(l.req.body)} | response: ${k(l.res.body)}`; };
  const groups = {}; matches.forEach((m) => { (groups[sig(m)] = groups[sig(m)] || []).push(m.label); });
  const patterns = Object.entries(groups).map(([signature, keys]) => ({ signature, count: keys.length, keys })).sort((a, b) => b.count - a.count);
  const exceptions = [];
  matches.forEach((m) => { const l = m.ex[m.ex.length - 1], st = l ? Number(l.res.status) : NaN; if (!isNaN(st) && st >= 400) exceptions.push({ key: m.label, why: `HTTP ${st}` }); else if (l && /error/i.test(Object.keys(l.res.body || {}).join(' '))) exceptions.push({ key: m.label, why: 'response holds an error field' }); else if (matches.length >= 5 && groups[sig(m)].length === 1) exceptions.push({ key: m.label, why: 'only payload with this shape' }); });
  const valuesOf = (re) => { const out = {}; matches.forEach((m) => m.ex.forEach((e) => { (function walk(v) { if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => { if (x && typeof x === 'object') walk(x); else if (re.test(k) && x !== '' && x !== null) { (out[String(x)] = out[String(x)] || new Set()).add(m.label); } }); })({ ...e.req.body, ...e.res.body }); })); return Object.entries(out).map(([value, set]) => ({ value, count: set.size, keys: [...set] })).sort((a, b) => b.count - a.count); };
  const payments = valuesOf(/tender|payment|gateway|method/i), reasons = valuesOf(/reason/i);
  er.mermaid = erMermaid(er.entities, er.relations, noteFnFor(inconsistencies));
  const ORD = { Conflict: 0, Missing: 1, Unmatched: 2 };
  findings.sort((a, b) => ORD[a.type] - ORD[b.type]);
  const table = groupTable(pgroups, gm.byGroup), evidence = groupEvidence(pgroups, rows, gm);
  return { groups: pgroups, groupMatch: gm, table, evidence, groupOf, er, inconsistencies, incNotes: incNotes(inconsistencies), matches, findings, patterns, exceptions, payments, reasons, covered: covered.size, total: rows.length };
}

/* generic checks used as evidence for the architecture */
function payloadChecks(files) {
  const docs = files.map((f) => ({ path: f.path, json: f.json, ex: exchangesOf(f), label: labelOf(f) })).filter((d) => d.ex.length);
  const hasKey = (v, re) => v && typeof v === 'object' && Object.entries(v).some(([k, x]) => (re.test(k) && x !== '' && x !== null && typeof x !== 'object') || hasKey(x, re));
  const arrays = (v, out = []) => { if (v && typeof v === 'object') Object.values(v).forEach((x) => { if (Array.isArray(x) && x.some((o) => o && typeof o === 'object')) out.push(x.filter((o) => o && typeof o === 'object')); arrays(x, out); }); return out; };
  const mk = (name, applies, ok) => { const a = docs.filter(applies); return { name, m: a.filter(ok).map((d) => d.label), n: a.filter((d) => !ok(d)).map((d) => d.label) }; };
  const anyRef = docs.some((d) => d.ex.some((e) => hasKey(e.req.body, SO_KEYS)));
  return [
    mk('Original reference on every request', () => anyRef, (d) => d.ex.some((e) => hasKey(e.req.body, SO_KEYS))),
    mk('Command carries an idempotency key', () => true, (d) => d.ex.some((e) => Object.keys(e.req.headers || {}).some((k) => /idempot/i.test(k)) || hasKey(e.req.body, /idempot/i))),
    mk('Tax code on every line', (d) => d.ex.some((e) => arrays(e.req.body).some((a) => a.some((o) => Object.keys(o).some((k) => /tax/i.test(k))))), (d) => d.ex.every((e) => arrays(e.req.body).every((a) => a.every((o) => Object.keys(o).some((k) => /tax/i.test(k)))))),
    mk('One refund per return', (d) => d.ex.some((e) => Array.isArray((e.res.body || {}).refunds)), (d) => d.ex.reduce((n, e) => n + (Array.isArray((e.res.body || {}).refunds) ? e.res.body.refunds.length : 0), 0) <= 1)
  ];
}
/* ---------- summary report in Markdown ---------- */
const mdc = (s) => String(s).replace(/\|/g, '/').replace(/\n/g, ' ');

Object.assign(C, { payloadInconsistencies, payloadChecks, soSet, parsePayloadText, xmlToJson, csvToJson, PAYLOAD_EXT, erMermaid, noteFnFor, keyEr, payTokens, normTok, payKeys, buildGroups, payloadLevel, groupTable, groupMatches, groupEvidence, groupDigest, flatten, mentions, readPayloadZip, buildErModel, analyzePayloads });
})(typeof window !== 'undefined' ? window : globalThis);
