/* Core logic for DocHub: PRD parsing, merging, generation and Excel export.
   Pure functions, no DOM. Loaded before app.js; exposed as window.Core. */
(function (g) {
'use strict';

const ID_RE = /^[A-Z]{1,5}(?:-[A-Z]{2,6})*-\d{1,4}$/;
const uniq = (a) => { const seen = new Set(); return a.filter((x) => { const k = x.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };
const clean = (t) => t.replace(/\*\*/g, '').replace(/`/g, '').trim();
const hashStr = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
const bullet = (l) => { const m = l.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/); return m ? m[1].trim() : null; };

/* ---------- parse a PRD (any reasonable Markdown layout) ---------- */
function classify(h) {
  h = h.replace(/^\d+(\.\d+)*\.?\s*/, '');
  if (/propos/i.test(h)) return 'proposed';
  if (/out[- ]of[- ]scope/i.test(h)) return 'scope-out';
  if (/in[- ]scope/i.test(h)) return 'scope-in';
  if (/scope/i.test(h)) return 'scope';
  if (/data requirements|integration and interface|non-?functional/i.test(h)) return 'other';
  if (/requirement/i.test(h)) return 'req';
  if (/process|flow|journey|procedure|workflow/i.test(h)) return 'process';
  if (/purpose|background|overview|summary|goal|objective/i.test(h)) return 'purpose';
  if (/open|question|risk|assumption/i.test(h)) return 'open';
  return 'other';
}
const stripNum = (h) => h.replace(/^\d+(\.\d+)*\.?\s*/, '').trim();
function reqFromText(t) {
  t = clean(t);
  const m = t.match(/^([A-Z]{1,5}(?:-[A-Z]{2,6})*-\d{1,4})\s*[:.–-]?\s*(.+)$/);
  return m ? { id: m[1], text: m[2].trim() } : { id: '', text: t };
}
/* A PRD may use # for its sections (one level up from the usual ##). When it has several # headings after the title,
   shift them down one level so the sections are found: # -> ##, ## -> ###, ### stays ###. */
function normalizeHeadings(body) {
  const lines = body.split('\n'); let fence = false, h1 = 0;
  lines.forEach((l) => { if (l.startsWith('```')) fence = !fence; else if (!fence && /^#\s+\S/.test(l)) h1++; });
  if (h1 < 4) return body;
  fence = false; let first = true;
  return lines.map((l) => {
    if (l.startsWith('```')) { fence = !fence; return l; }
    if (fence) return l;
    const m = l.match(/^(#{1,3})(\s+\S.*)$/); if (!m) return l;
    if (m[1] === '#') { if (first) { first = false; return l; } return '##' + m[2]; }
    return '###' + m[2];
  }).join('\n');
}
function parsePrd(md) {
  const doc = { fm: {}, title: '', purpose: [], inScope: [], outScope: [], processes: [], reqs: [], notes: [] };
  let body = md || '';
  const fm = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (fm) { body = body.slice(fm[0].length); fm[1].split('\n').forEach((l) => { const k = l.match(/^(\w+):\s*(.*)$/); if (k) doc.fm[k[1]] = k[2]; }); }
  body = normalizeHeadings(body);
  let sec = '', sub = '', proc = null, procAuto = false, fence = null, secTitle = '', note = null, curReq = null, skipProc = false, reqSkip = false, scopeParent = null;
  const bodyLines = body.split('\n');
  for (let li = 0; li < bodyLines.length; li++) {
    const raw = bodyLines[li], l = raw.replace(/\s+$/, '');
    if (fence) {
      if (l.startsWith('```')) { if (proc && fence.lang === 'mermaid') proc.mermaid = fence.buf.join('\n'); fence = null; } else fence.buf.push(l);
      continue;
    }
    if (l.startsWith('```')) { fence = { lang: l.slice(3).trim().toLowerCase(), buf: [] }; continue; }
    let h;
    if ((h = l.match(/^#\s+(.*)/))) { if (!doc.title) doc.title = clean(h[1]); continue; }
    if ((h = l.match(/^##\s+(.*)/))) {
      secTitle = stripNum(clean(h[1])); sec = classify(h[1]); sub = ''; proc = null; note = null; curReq = null; skipProc = false; reqSkip = false; scopeParent = null;
      if (sec === 'scope-in') { sec = 'scope'; sub = 'in'; } else if (sec === 'scope-out') { sec = 'scope'; sub = 'out'; }
      if (sec === 'process' && !/^(business )?(processes|flows|process flows)$/i.test(secTitle)) { proc = { name: secTitle, steps: [], mermaid: '' }; procAuto = true; doc.processes.push(proc); }
      if (sec === 'other' || sec === 'open') { note = { title: secTitle, lines: [] }; doc.notes.push(note); }
      continue;
    }
    if ((h = l.match(/^###\s+(.*)/))) {
      const t = stripNum(clean(h[1]));
      if (sec === 'scope') sub = /out/i.test(t) ? 'out' : 'in';
      else if (sec === 'process') {
        if (proc && procAuto && !proc.steps.length && !proc.mermaid) doc.processes.pop();
        if (/^(current[- ]state|future[- ]state|as[- ]is|to[- ]be|pain points|actors?)\b/i.test(t)) { proc = null; procAuto = false; skipProc = true; continue; }
        skipProc = false;
        proc = { name: t.replace(/^[A-Z]{2,5}-\d+\s*[\u2014\u2013:.-]\s*/, ''), steps: [], mermaid: '' }; procAuto = false; doc.processes.push(proc);
      } else if (sec === 'req') {
        reqSkip = /acceptance|criteria|business rules?|^rules?\b|glossary|appendix|data|integration|interface|non-?functional|assumption|risk|question|reference|dependenc/i.test(t) && !/^[A-Z]{1,5}(?:-[A-Z]{2,6})*-\d{1,4}/.test(t);
        const rm = t.match(/^([A-Z]{1,5}(?:-[A-Z]{2,6})*-\d{1,4})\s*[\u2014\u2013:.-]\s*(.+)$/);
        if (rm) { curReq = doc.reqs.find((x) => x.id === rm[1]); if (!curReq) { curReq = { id: rm[1], text: '', title: rm[2].trim(), src: '', proposed: false }; doc.reqs.push(curReq); } }
        else curReq = null;
      }
      continue;
    }
    if (!l.trim()) continue;
    let m;
    if ((m = l.match(/^\s*(?:[-*]\s*)?\**(in[- ]scope|out[- ]of[- ]scope)\**\s*:\s*(.+)$/i))) {
      const items = m[2].split(/[;,]/).map(clean).filter(Boolean);
      (/^in/i.test(m[1]) ? doc.inScope : doc.outScope).push(...items);
      continue;
    }
    if ((m = l.match(/^\s*\**purpose\**\s*:\s*(.+)$/i))) { doc.purpose.push(clean(m[1])); continue; }
    const b = bullet(l);
    if (sec === 'scope') {
      if (b) {
        const arr = sub === 'out' ? doc.outScope : doc.inScope, deep = (l.match(/^\s*/)[0] || '').replace(/\t/g, '    ').length >= 2;
        if (deep && scopeParent && scopeParent.arr === arr) { arr[scopeParent.idx] = arr[scopeParent.idx].replace(/:\s*$/, '').replace(/[.;]\s*$/, '') + (scopeParent.n++ ? '; ' : ': ') + clean(b); }
        else { arr.push(clean(b)); scopeParent = { arr, idx: arr.length - 1, n: 0 }; }
      }
    } else if (sec === 'purpose') {
      doc.purpose.push(clean(b || l));
    } else if (sec === 'process') {
      if (b && !skipProc) {
        if (!proc) { proc = { name: secTitle || 'Main process', steps: [], mermaid: '' }; procAuto = true; doc.processes.push(proc); }
        proc.steps.push(clean(b));
      }
    } else if (sec === 'req' || sec === 'proposed') {
      if (reqSkip) { /* acceptance criteria, rules, glossary and the like under a requirements heading are not requirements */ }
      else if (l.trim().startsWith('|')) {
        const c = l.trim().replace(/^\||\|$/g, '').split('|').map((x) => clean(x));
        if (ID_RE.test(c[0])) {
          const have = doc.reqs.find((x) => x.id === c[0]);
          if (have) { if (!have.text) have.text = c[1] || ''; if (!have.src) have.src = c[2] || ''; } else doc.reqs.push({ id: c[0], text: c[1] || '', src: c[2] || '', proposed: sec === 'proposed' });
        } else if (curReq && /^(requirement statement|main behavior)$/i.test(c[0]) && c[1]) {
          if (/statement/i.test(c[0]) || !curReq.text) curReq.text = c[1];
        }
      } else if (b) {
        const r = reqFromText(b); doc.reqs.push({ id: r.id, text: r.text, src: '', proposed: sec === 'proposed' });
      }
    } else if (sec === 'other' && /^\s*\d+[.)]\s+/.test(l)) {
      // a numbered list under an unrecognised heading is treated as a process
      if (!proc) { proc = { name: secTitle || 'Main process', steps: [], mermaid: '' }; procAuto = true; doc.processes.push(proc); }
      proc.steps.push(clean(b));
    } else if (note) {
      if (l.trim().startsWith('|')) {
        /* a table under an open-items style heading: skip the header row and the --- row, turn each data row into one line */
        const cells = l.trim().replace(/^\||\|$/g, '').split('|').map((x) => clean(x));
        const nextSep = /^\s*\|?\s*:?-{2,}/.test(bodyLines[li + 1] || '');
        if (cells.every((x) => /^:?-{2,}:?$/.test(x) || !x) || nextSep) continue;
        const idLike = ID_RE.test(cells[0] || '') || /^[A-Z]{1,6}-\d+$/.test(cells[0] || ''), rest = (idLike ? cells.slice(1) : cells).filter((x) => x && !/^(tbd|none|n\/a|-)$/i.test(x));
        if (rest.length) note.lines.push((idLike ? cells[0] + ': ' : '') + rest.join('; '));
      } else note.lines.push(clean(b || l));
    }
  }
  doc.reqs.forEach((r) => { if (!r.text && r.title) r.text = r.title; delete r.title; });
  doc.structured = !!(doc.reqs.length || doc.processes.length || doc.inScope.length || doc.outScope.length);
  return doc;
}

/* ---------- process steps to Mermaid flowchart ---------- */
const q = (t) => t.replace(/"/g, "'");
function genFlow(steps) {
  const L = ['flowchart LR', '  s(("Start"))'];
  let prev = 's', label = '', gates = 0;
  steps.forEach((t, i) => {
    const id = 'n' + (i + 1), isQ = /\?\s*$/.test(t);
    L.push(isQ ? `  ${id}{"${q(t)}"}` : `  ${id}["${q(t)}"]`);
    L.push(`  ${prev} -->${label} ${id}`);
    label = isQ ? '|Yes|' : ''; prev = id; if (isQ) gates++;
  });
  L.push('  e((("End")))', `  ${prev} -->${label} e`);
  if (gates) {
    let first = true;
    steps.forEach((t, i) => { if (/\?\s*$/.test(t)) { L.push(first ? `  n${i + 1} -->|No| x((("Stopped")))` : `  n${i + 1} -->|No| x`); first = false; } });
  }
  return L.join('\n');
}
const processFlow = (p) => p.mermaid || (p.steps.length ? genFlow(p.steps) : '');

/* ---------- merge converted sources into one standard PRD ---------- */
function mergeSources(sources, name, opts) {
  opts = opts || {};
  const docs = sources.filter((s) => s.md && s.md.trim()).map((s) => ({ src: s.name, d: parsePrd(s.md), md: s.md }));
  const m = { name: name || 'Untitled design', sources: docs.map((x) => x.src), purpose: [], inScope: [], outScope: [], processes: [], reqs: [], open: [], raw: [] };
  const seenProc = new Set(), byId = new Map();
  docs.forEach(({ src, d }) => {
    m.purpose.push(...d.purpose.slice(0, 2));
    m.inScope.push(...d.inScope); m.outScope.push(...d.outScope);
    d.processes.forEach((p) => { const k = p.name.toLowerCase(); if (!seenProc.has(k) && (p.steps.length || p.mermaid)) { seenProc.add(k); m.processes.push({ ...p, src }); } });
    d.reqs.forEach((r) => {
      if (r.id && byId.has(r.id)) { if (byId.get(r.id).text.toLowerCase() !== r.text.toLowerCase()) m.open.push(`${r.id} is worded differently in ${src} and ${byId.get(r.id).src}. Confirm which wording applies.`); return; }
      const rr = { id: r.id, text: r.text, src, proposed: r.proposed };
      m.reqs.push(rr); if (r.id) byId.set(r.id, rr);
    });
    d.notes.filter((n) => /open|question|risk|assumption/i.test(n.title)).forEach((n) => n.lines.forEach((x) => m.open.push(`${x} (${src})`)));
    if (!d.structured) m.raw.push({ src, md: md_trim(docs.find((x) => x.src === src).md) });
  });
  m.inScope = uniq(m.inScope); m.outScope = uniq(m.outScope); m.purpose = uniq(m.purpose);
  let max = 0; m.reqs.forEach((r) => { const n = r.id.match(/^R-(\d+)$/); if (n) max = Math.max(max, +n[1]); });
  m.reqs.forEach((r) => { if (!r.id) { r.id = 'R-' + String(++max).padStart(2, '0'); } });
  m.reqs.sort((a, b) => (a.proposed - b.proposed) || a.id.localeCompare(b.id, undefined, { numeric: true }));
  if (m.reqs.some((r) => r.proposed)) m.open.push('Owners approve the proposed requirements before they join the PRD.');
  return buildPrdMd(m);
}
const md_trim = (s) => s.trim().split('\n').slice(0, 60).join('\n');
function buildPrdMd(m) {
  const slug = m.name.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 6) || 'PRD';
  const L = ['---', `id: PRD-${slug}`, `title: ${m.name}`, 'owner: TBD', 'version: 0.1', 'status: Draft', `sources: [${m.sources.join(', ')}]`, '---', '', `# ${m.name}`, '', '## 1. Purpose', m.purpose.length ? m.purpose.join(' ') : 'TBD', '', '## 2. Scope', '### In scope'];
  L.push(...(m.inScope.length ? m.inScope.map((x) => '- ' + x) : ['- TBD']), '', '### Out of scope', ...(m.outScope.length ? m.outScope.map((x) => '- ' + x) : ['- TBD']), '', '## 3. Processes');
  if (!m.processes.length) L.push('TBD');
  m.processes.forEach((p, i) => {
    L.push(`### 3.${i + 1} ${p.name}`, ...p.steps.map((s, j) => `${j + 1}. ${s}`), '', '```mermaid', processFlow(p), '```', '');
  });
  const std = m.reqs.filter((r) => !r.proposed), prop = m.reqs.filter((r) => r.proposed);
  const table = (rs) => ['| ID | Requirement | Source |', '| --- | --- | --- |', ...rs.map((r) => `| ${r.id} | ${r.text.replace(/\|/g, '/')} | ${r.src || ''} |`)];
  L.push('## 4. Requirements', ...(std.length ? table(std) : ['TBD']), '');
  if (prop.length) L.push('## 5. Proposed requirements', ...table(prop), '');
  L.push(`## ${prop.length ? 6 : 5}. Open items`, ...(m.open.length ? m.open.map((x) => '- ' + x) : ['- None.']));
  if (m.raw.length) { L.push('', '## Source notes'); m.raw.forEach((r) => L.push(`### ${r.src}`, r.md, '')); }
  return L.join('\n') + '\n';
}

/* ---------- requirements model for the Requirements page ---------- */
function requirementsModel(prdMd) {
  const d = parsePrd(prdMd);
  return {
    title: d.fm.title || d.title || 'Untitled design',
    inScope: uniq(d.inScope), outScope: uniq(d.outScope),
    processes: d.processes.map((p) => ({ name: p.name, steps: p.steps, flow: processFlow(p), generated: !p.mermaid })),
    reqs: d.reqs.filter((r) => r.id)
  };
}

/* ---------- scenario matrix (template-based, simulated AI) ---------- */
const chanOf = (t) => /\b(pos|store|in-store|till|cashier)\b/i.test(t) ? 'POS' : /\b(online|web|narvar|portal|app|e-?commerce)\b/i.test(t) ? 'Online' : 'All';
const short = (t) => { t = t.replace(/\.$/, ''); return t.length > 80 ? t.slice(0, 77).trimEnd() + '...' : t; };
function genScenarios(reqs) {
  const rows = []; let n = 0; const nid = () => 'S-' + String(++n).padStart(2, '0');
  reqs.forEach((r) => {
    const ch = chanOf(r.text);
    rows.push({ id: nid(), ch, kind: 'Happy', title: 'Meets: ' + short(r.text), reqs: [r.id], expect: 'The requirement holds as written' });
    rows.push({ id: nid(), ch, kind: 'Negative', title: 'Breaks: ' + short(r.text), reqs: [r.id], expect: 'The system rejects or flags the case' });
    if (/\b(only|unless|when|if|more than|less than|over|above|below|under|older than|exceeds?|at least|at most|within|before|after)\b/i.test(r.text)) rows.push({ id: nid(), ch, kind: 'Edge', title: 'Boundary of: ' + short(r.text), reqs: [r.id], expect: 'Behaviour changes exactly at the stated limit' });
    if (r.proposed) rows.forEach((x) => { if (x.reqs[0] === r.id && x.kind === 'Happy') x.kind = 'Gap'; });
  });
  return rows;
}

/* ---------- minimal .xlsx writer (zip store, inline strings) ---------- */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  files.forEach((f) => {
    const name = enc.encode(f.name), data = enc.encode(f.text), crc = crc32(data), size = data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0x21, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 0x21, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + size;
  });
  const csize = central.reduce((a, p) => a + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0)); let o = 0; all.forEach((p) => { out.set(p, o); o += p.length; });
  return out;
}
const xe = (s) => String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i) => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
function sheetXml(rows, widths) {
  const cols = widths ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  const data = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => `<c r="${colName(ci)}${ri + 1}" t="inlineStr" s="${ri === 0 ? 1 : 2}"><is><t xml:space="preserve">${xe(v)}</t></is></c>`).join('')}</row>`).join('');
  const last = `${colName(Math.max(0, (rows[0] || []).length - 1))}${rows.length}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${data}</sheetData><autoFilter ref="A1:${last}"/></worksheet>`;
}
function xlsx(sheets) {
  const files = [
    { name: '[Content_Types].xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xe(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F5"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>' }
  ];
  sheets.forEach((s, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, text: sheetXml(s.rows, s.widths) }));
  return zip(files);
}
function matrixSheets(rows, reqs) {
  const extras = [...new Set(rows.flatMap((s) => Object.keys(s.extra || {})))];
  const reqText = Object.fromEntries(reqs.map((r) => [r.id, r.text]));
  const ids = [...new Set([...reqs.map((r) => r.id), ...rows.flatMap((s) => s.reqs)])];
  return [
    { name: 'Scenario matrix', widths: [9, 11, 30, 18, 11, 10, 16, ...extras.map(() => 22), 56, 18, 48], rows: [['Scenario ID', 'Channel', 'Name', 'Category', 'Type', 'Priority', 'Payload', ...extras, 'Scenario', 'Requirements', 'Expected outcome'], ...rows.map((s) => [s.id, s.ch, s.name || '', s.cat || '', s.kind, s.prio || '', s.so || '', ...extras.map((h) => (s.extra || {})[h] || ''), s.title, s.reqs.join(', '), s.expect])] },
    { name: 'Traceability', widths: [12, 70, 30], rows: [['Requirement ID', 'Requirement', 'Scenarios'], ...ids.map((id) => [id, reqText[id] || '', rows.filter((s) => s.reqs.includes(id)).map((s) => s.id).join(', ') || 'None'])] }
  ];
}

g.Core = { zip, parsePrd, genFlow, processFlow, mergeSources, buildPrdMd, requirementsModel, genScenarios, xlsx, matrixSheets, hashStr, chanOf };
})(typeof window !== 'undefined' ? window : globalThis);
