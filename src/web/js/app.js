/* DocHub - From Requirements to Architecture Design. See DESIGN.md. */
(() => {
'use strict';
/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms) => new Promise((r) => setTimeout(r, reduced ? 0 : ms));
const rnd = (n) => Math.round(n * 100) / 100;
const TAX = 0.13;
const ICON = {
  pass: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fail: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  wait: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  run: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l8 5-8 5z" fill="currentColor"/></svg>'
};
const TRASH = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><path d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6M5.5 6l.7 9.2A1.5 1.5 0 0 0 7.7 16.5h4.6a1.5 1.5 0 0 0 1.5-1.3L14.5 6M8.5 9v4.5M11.5 9v4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const trashBtn = (attr, val, label, confirming) => `<button class="icon-btn${confirming ? ' confirm' : ''}" ${attr}="${typeof val === 'string' ? ea(val) : val}" type="button" aria-label="${ea(confirming ? 'Confirm: ' + label : label)}" title="${ea(confirming ? 'Click again to confirm' : label)}">${TRASH}${confirming ? '<span>Confirm</span>' : ''}</button>`;
const status = (k, label) => `<span class="st ${k}">${ICON[k]}${label}</span>`;
let toastTimer;
const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2200); };
const copy = async (text, label) => { try { await navigator.clipboard.writeText(text); toast(label + ' copied'); } catch { toast('Copy is blocked in this view'); } };
const skeleton = (n = 6) => `<div class="skel" aria-busy="true" aria-label="Loading">${'<i></i>'.repeat(n)}</div>`;


/* ---------- small utilities ---------- */
const ea = (s) => esc(s).replace(/"/g, '&quot;');
const enc = encodeURIComponent;
const uid = () => 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const fmtDate = (t) => new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const slug = (s) => (s || 'design').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'design';
const fileKind = (n) => ({ docx: 'Word document', doc: 'Word document', pdf: 'PDF', pptx: 'PowerPoint', xlsx: 'Excel', xls: 'Excel', csv: 'CSV', md: 'Markdown', txt: 'Text', html: 'HTML', htm: 'HTML', json: 'JSON' }[(n.split('.').pop() || '').toLowerCase()] || 'File');
const fmtSize = (b) => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
const TEXTY = /\.(md|txt|csv|json|html?)$/i;

/* ---------- storage: helper service folder when it runs, otherwise this browser ---------- */
const LS = 'prd-demo-designs-v1';
let memStore = {};
const lsRead = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (e) { return memStore; } };
const lsWrite = (o) => { memStore = o; try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) { toast('This browser blocked saving. Designs stay until you close the page.'); } };
/* the project folder is named after the design; the helper service decides it, this copy is only used without the helper */
const folderFromName = (name) => { let n = String(name || '').replace(/\s*[\\/]\s*/g, ' - ').replace(/\s*:\s*/g, ' - ').replace(/[*?"<>|\x00-\x1f]/g, '-').replace(/\s+/g, ' ').replace(/^[ .]+|[ .]+$/g, '').replace(/^[~$]+/, '').slice(0, 80).replace(/^[ .]+|[ .]+$/g, ''); if (!n) n = 'Untitled design'; if (/^(con|prn|aux|nul|forms|com[1-9]|lpt[1-9])$/i.test(n)) n += ' design'; return n; };
const taken = (name, list, exceptId) => { const f = folderFromName(name).toLowerCase(); return list.some((d) => d.id !== exceptId && (d.id || '').toLowerCase() === f); };
const store = {
  mode: 'browser', markitdown: false, mdError: '', ai: false, aiModel: '',
  async init() {
    try {
      const c = new AbortController(); const t = setTimeout(() => c.abort(), 1500);
      const r = await fetch('/api/health', { cache: 'no-store', signal: c.signal }); clearTimeout(t);
      const j = r.ok ? await r.json() : null;
      if (j && j.ok) { this.mode = 'server'; this.markitdown = !!j.markitdown; this.engine = j.engine; this.ai = !!j.ai; this.aiModel = j.aiModel || ''; this.aiProvider = j.aiProvider || ''; this.dataDir = j.dataDir || ''; this.mdError = j.markitdownError || ''; }
    } catch (e) { /* no helper service: browser storage */ }
  },
  async list() { if (this.mode === 'server') { const r = await fetch('/api/designs', { cache: 'no-store' }); return r.json(); } return Object.values(lsRead()); },
  async get(id) { if (this.mode === 'server') { const r = await fetch('/api/designs/' + enc(id), { cache: 'no-store' }); return r.ok ? r.json() : null; } return lsRead()[id] || null; },
  async put(d) {
    if (this.mode === 'server') {
      /* one save at a time, so each save carries the revision the previous one produced */
      const run = () => this._put(d), p = (this._q || Promise.resolve()).then(run, run); this._q = p.catch(() => {}); return p;
    }
    const o = lsRead(); o[d.id] = d; lsWrite(o);
  },
  async _put(d) {
    if (this.mode === 'server') {
      const r = await fetch('/api/designs/' + enc(d.id), { method: 'PUT', body: JSON.stringify(d), headers: this.force ? { 'X-Force': '1' } : {} }), j = await r.json().catch(() => ({}));
      if (r.status === 409) { const e = new Error(j.error || 'Changed by someone else'); e.conflict = true; throw e; }
      if (!r.ok) throw new Error('Save failed');
      if (j.rev) { d.rev = j.rev; d.savedBy = j.savedBy; d.savedAt = j.savedAt; } return;
    }
    const o = lsRead(); o[d.id] = d; lsWrite(o);
  },
  async create(name) {
    if (this.mode === 'server') {
      const r = await fetch('/api/designs', { method: 'POST', body: JSON.stringify({ name }) }), j = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error(j.error || 'The design could not be created'); e.taken = r.status === 409; throw e; }
      return j;
    }
    const list = Object.values(lsRead()), id = folderFromName(name);
    if (taken(name, list)) { const e = new Error(`A design named "${id}" already exists. Design names must be different.`); e.taken = true; throw e; }
    return { id, name };
  },
  async del(id) { if (this.mode === 'server') { await fetch('/api/designs/' + enc(id), { method: 'DELETE' }); return; } const o = lsRead(); delete o[id]; lsWrite(o); }
};
const storeNote = () => store.mode === 'server' ? 'Saving to the repo' + (store.dataDir ? ': ' + store.dataDir : '') : 'Saving in this browser. Run server.py for folder storage and MarkItDown.';

/* ---------- design state ---------- */
let D = null, current = 1, saveTimer = null;
const files = {}, blobUrls = {};
const st = { busy: false, matrix: false, req: false, plan: false, run: false, arch: false, build: false, reqHash: '', matrixHash: '', buildHash: '', ch: 'All', tc: 'TC-01', pay: 'P-01', call: 0, result: {}, md: '', pview: 'doc', viewSrc: '', undo: null, confirmMerge: false, cmp: '', proposal: null, promptText: '', matrixDirty: false, matrixUndo: null, importNote: '', showDismissed: false };
const prdHash = () => Core.hashStr(D.prd || '');
let rmCache = { h: null, m: null };
const model = () => { const h = prdHash(); if (rmCache.h !== h) rmCache = { h, m: Core.requirementsModel(D.prd) }; return rmCache.m; };
const MX = () => D.matrix || derivedRows();
function loadSt() {
  const f = D.flags || {};
  Object.assign(st, { repView: 'doc', archView: 'doc', archUndo: null, archProposal: null, archPrompt: '', archDirty: false, refine: null, testUndo: null, refinePrompt: '', pr: 'All', tcIdx: 0, confirmTdel: -1, mapping: null, workbooks: [], workbooksFor: '', viewPf: '', testsDirty: false, busy: false, matrix: !!f.matrix, plan: !!f.plan, arch: !!f.arch || D.archMd != null, build: !!f.build, reqHash: f.reqHash || '', matrixHash: f.matrixHash || '', buildHash: f.buildHash || '', cmp: '', proposal: null, promptText: '', matrixDirty: false, matrixUndo: null, importNote: '', showDismissed: false, ch: 'All', tc: 'TC-01', pay: 'P-01', call: 0, pview: 'md', viewSrc: '', undo: null, confirmMerge: false, md: '' });
}
function flush() {
  if (st.readOnly) { const n = $('#save-note'); if (n) n.textContent = 'Read-only: not saved'; return Promise.resolve(); }
  D.updated = Date.now(); publishLive();
  return store.put(D).then(() => { const n = $('#save-note'); if (n) n.textContent = 'Saved ' + new Date().toLocaleTimeString(undefined, { timeStyle: 'short' }); bannerState().remote = ''; }).catch((e) => { if (e && e.conflict) { bannerState().conflict = e.message; drawBanner(); const n = $('#save-note'); if (n) n.textContent = 'Not saved: changed by someone else'; return; } toast('Saving failed'); });
}
function syncFlags() {
  if (!D) return;
  const f = { matrix: !!D.matrix, plan: tests().length > 0, pay: !!D.payloadImport, arch: st.arch, build: st.build, matrixHash: st.matrixHash, buildHash: st.buildHash };
  if (JSON.stringify(f) !== JSON.stringify(D.flags)) { D.flags = f; flush(); }
}
const saveSoon = () => { clearTimeout(saveTimer); const n = $('#save-note'); if (n) n.textContent = 'Saving...'; saveTimer = setTimeout(flush, 500); };

/* ---------- stages and tabs ---------- */
const reqReady = () => !!(D && D.prd.trim());
const STAGES = [
  { name: 'PRD library', from: 'Source documents', out: () => D.prd.trim() ? `${D.sources.length} files, PRD ready` : D.sources.length ? `${D.sources.length} files, no PRD` : 'Empty', done: () => !!D.prd.trim() },
  { name: 'Requirements and BPMN', from: 'Read from the PRD', out: () => reqReady() ? `${model().reqs.length} requirements, ${model().processes.length} processes` : 'Waiting for the PRD', done: reqReady },
  { name: 'Scenario matrix', from: 'From requirements', out: () => D.matrix ? `${D.matrix.length} scenarios` : 'Not run', done: () => !!D.matrix },
  { name: 'Test plan', from: 'From the matrix', out: () => tests().length ? `${tests().length} test cases` : 'Not run', done: () => tests().length > 0 },
  { name: 'Payload library', from: 'Imported payloads', out: () => D.payloadImport ? `${D.payloadImport.count} files imported` : 'Not imported', done: () => !!D.payloadImport },
  { name: 'Architecture', from: 'From the PRD, matrix and tests', out: () => D.archMd != null ? 'Design ready' : 'Not run', done: () => D.archMd != null },
  { name: 'Build plan', from: 'From the PRD and matrix', out: () => st.build ? `${buildPlan().modules.length} modules, ${buildPlan().hours} h` : 'Not run', done: () => st.build }
];
/* the header button of page 5 is greyed out until there are payloads (and a matrix to match them to) */
function syncPayBtn() {
  const b = $('#analyze-all-btn'); if (!b || !D) return;
  const why = !D.payloadImport ? 'Import payloads first' : !D.matrix ? 'Import or generate the scenario matrix first' : st.allBusy ? 'Analysis is running' : '';
  b.disabled = !!why; b.title = why; b.setAttribute('aria-disabled', String(!!why));
}
/* AI steps grouped by the seven pages, in the order they appear on each page */
const STEP_GROUPS = [['1. PRD library', ['gen-prd', 'analyze-prd']], ['2. Requirements and BPMN', []], ['3. Scenario matrix', ['scenario-plan', 'gen-scenarios', 'fill-scenarios']], ['4. Test plan', ['refine-test']], ['5. Payload library', ['analyze-payloads']], ['6. Architecture', ['arch-assess', 'arch-options', 'gen-arch', 'arch-review']], ['7. Build plan', ['build-plan']], ['Any page', ['update-doc', 'compose-doc', 'ask']]];
function stepGroups(labels) {
  const L = labels || {}, used = new Set(), out = STEP_GROUPS.map(([t, ks]) => [t, ks.filter((k) => L[k]).map((k) => { used.add(k); return [k, L[k]]; })]);
  const rest = Object.keys(L).filter((k) => !used.has(k)).map((k) => [k, L[k]]); if (rest.length) out[out.length - 1][1].push(...rest);
  return out;
}
/* the AI models bar above the 7 steps: the model each step uses, changed here (kept on this computer) */
function drawAiBar() {
  const el = $('#ai-bar'); if (!el) return;
  if (store.mode !== 'server') { el.innerHTML = ''; return; }
  if (!PROVS) { loadProvs().then(drawAiBar); return; }
  const P = PROVS, open = !!st.aiBarOpen, defId = (P.steps || {})['*'] || '', def = defId ? (provList().find((p) => p.id === defId) || {}) : null;
  const defName = def && def.name ? provLabel(def) : 'Claude CLI (built in)';
  const rows = stepGroups(P.stepLabels).map(([t, ks]) => `<div class="panel-body"><h4>${esc(t)}</h4>${ks.length ? `<div class="row-actions">${ks.map(([k, v]) => `<label class="field"><span>${esc(v)}</span><select data-stepsel="${ea(k)}" aria-label="Model for ${ea(v)}">${stepOptions((P.steps || {})[k] || '', 'Same as the default')}</select></label>`).join('')}</div>` : '<p class="note">No AI step on this page.</p>'}</div>`).join('');
  el.innerHTML = `<div class="panel"><div class="panel-head"><h3>AI models</h3><div class="row-actions"><span class="note">Default: ${esc(defName)}. Saved on this computer only.</span><button class="key small" data-act="aibar-toggle" type="button" aria-expanded="${open}">${open ? 'Hide' : 'Change'}</button></div></div>${open ? `<div class="panel-body"><div class="row-actions"><label class="field"><span><b>Default for all steps</b></span><select data-stepsel="*" aria-label="Default model">${stepOptions(defId, 'Claude CLI (built in)')}</select></label></div></div>${rows}<div class="panel-body"><p class="note">Add or edit providers and keys on the <a class="link" href="#/">Designs page</a>.</p></div>` : ''}</div>`;
}
function drawTabs() {
  drawAiBar();
  $('#tabs').innerHTML = STAGES.map((s, i) => `<li role="presentation"><button class="tab" role="tab" id="tab-${i + 1}" aria-selected="${current === i + 1}" aria-controls="stage-${i + 1}" data-stage="${i + 1}"><span class="t-in">${i + 1}. ${s.from}</span><span class="t-name">${s.name}</span><span class="t-out ${s.done() ? 'done' : ''}">${s.out()}</span></button></li>`).join('');
  syncFlags(); syncPayBtn();
  if (D) { const sig = ccNotCompared().join(','); if (sig !== st.ccSig) { st.ccSig = sig; refreshCC(); } }
}
const NEXT = { 1: 'Next: read the requirements and BPMN', 2: 'Next: generate the scenario matrix', 3: 'Next: build the test plan', 4: 'Next: open the payload library', 5: 'Next: generate the architecture design', 6: 'Next: generate the build plan' };
function drawFoot() {
  $('#footbar').hidden = current === 7;
  $('#next').textContent = NEXT[current] || '';
  $('#runrest').hidden = current >= 6;
}
function show(n, push = true) {
  current = n;
  $$('.stage').forEach((el, i) => el.classList.toggle('on', i + 1 === n));
  drawTabs(); drawFoot();
  if (push && D) history.replaceState(null, '', `#/design/${encodeURIComponent(D.id)}/${n}`);
  [null, r1, r2, r3, r4, r5, r6, r7][n]();
  drawResetHist(); setBusy();
}
const gate = (msg, goto, label) => `<div class="empty"><p>${msg}</p><button class="key primary" data-go="${goto}" type="button">${label}</button></div>`;
const stale = (h) => h && h !== prdHash() ? '<div class="callout">The PRD changed after this page was generated. Generate it again to refresh.</div>' : '';

/* ---------- stage 1: PRD library ---------- */
function openUrl(s) {
  if (s.url) return s.url;
  if (blobUrls[s.name]) return blobUrls[s.name];
  const plain = /\.(html?|svg|xhtml)$/i.test(s.name);
  let blob = null;
  if (files[s.name]) blob = new Blob([files[s.name]], { type: plain ? 'text/plain' : files[s.name].type || 'application/octet-stream' });
  else if (s.text != null) blob = new Blob([s.text], { type: 'text/plain' });
  return blob ? (blobUrls[s.name] = URL.createObjectURL(blob)) : '';
}
async function installMarkItDown() {
  if (st.mdInstalling) return;
  if (store.mode !== 'server') return toast('Start server.py first');
  st.mdInstalling = true; st.mdInstallMsg = ''; if (current === 1) r1();
  try {
    const r = await fetch('/api/markitdown/install', { method: 'POST', body: '{}' }), j = await r.json().catch(() => ({}));
    if (!r.ok) st.mdInstallMsg = 'The installation failed: ' + (j.error || r.status);
    else { await store.init(); st.mdInstallMsg = 'MarkItDown is installed. Press Convert on the files again.'; }
  } catch (e) { st.mdInstallMsg = 'The helper service could not be reached.'; }
  st.mdInstalling = false; toast(st.mdInstallMsg); if (current === 1) r1();
}
function engineNote() {
  if (store.mode === 'server' && store.markitdown) return `MarkItDown is ready (${store.engine === 'mcp' ? 'MCP server from markitdown.mcp.json' : 'Python package'}). Uploaded files are converted for real.`;
  if (store.mode === 'server') return 'The helper service is running but MarkItDown is not installed (pip install "markitdown[all]"). Conversion is simulated.';
  return 'Conversion is simulated because the helper service is not running. Word, PDF and Office files need MarkItDown: run server.py and open the site through it.';
}
const isMdName = (n) => /\.(md|markdown)$/i.test(n || '');
function srcRow(s) {
  const u = openUrl(s);
  const md = s.busy ? status('run', 'Converting') : s.error ? `${status('fail', 'Failed')}<div class="note">${esc(s.error)}</div>` : isMdName(s.name) && s.md ? `${status('pass', 'Ready: original Markdown')}<div class="note">${s.md.split('\n').length} lines, no conversion needed</div>` : s.md ? `${status('pass', 'Converted by ' + esc(s.engine))}<div class="note">${s.md.split('\n').length} lines</div>` : isMdName(s.name) ? status('wait', 'Reading') : status('wait', 'Not converted');
  return `<tr><td>${u ? `<a href="${ea(u)}" target="_blank" rel="noopener">${esc(s.name)}</a>` : esc(s.name)}<div class="note">${u ? 'Opens read-only' : 'Original is not stored in this browser'}</div></td><td>${esc(s.type)}</td><td class="num">${fmtSize(s.size || 0)}</td><td>${md}</td><td><div class="row-actions">${isMdName(s.name) ? '' : `<button class="key small" data-conv="${ea(s.name)}" type="button">${s.md ? 'Convert again' : 'Convert'}</button>`}${s.md ? `<button class="key small" data-viewsrc="${ea(s.name)}" type="button">${st.viewSrc === s.name ? 'Hide' : 'View'}</button>` : ''}${trashBtn('data-rmsrc', s.name, 'Remove ' + s.name)}</div></td></tr>`;
}
function r1() {
  ccSlot(1);
  const srcs = D.sources.length
    ? `<div class="table-wrap"><table><thead><tr><th>File</th><th>Type</th><th>Size</th><th>Markdown</th><th></th></tr></thead><tbody>${D.sources.map(srcRow).join('')}</tbody></table></div>`
    : `<div class="empty"><p>No source files yet. Add Word, PDF, PowerPoint, Excel or Markdown files.</p><button class="key primary" data-act="add-files" type="button">Add files</button></div>`;
  const viewing = D.sources.find((s) => s.name === st.viewSrc);
  const editor = st.pview === 'md'
    ? `<textarea id="prd-editor" class="editor" spellcheck="false" aria-label="Consolidated PRD in Markdown" placeholder="The merged PRD appears here. You can also type or paste Markdown.">${esc(D.prd)}</textarea>`
    : `<div class="doc">${D.prd.trim() ? renderMd(D.prd) : '<p class="note">Nothing to preview yet.</p>'}</div>`;
  $('#prd-body').innerHTML = `<div class="gap">
  <div class="panel">
    <div class="panel-head"><h3>Source files</h3><div class="row-actions"><span class="note">Read-only: originals are never edited.</span><button class="key small" data-act="add-files" type="button">Add files</button><button class="key small" data-act="conv-all" type="button">Convert all</button></div></div>
    ${srcs}
    <div class="coverage">${esc(engineNote())}${store.mode === 'server' && !store.markitdown ? ` <button class="key small" data-act="install-md" type="button"${st.mdInstalling ? ' disabled' : ''}>${st.mdInstalling ? 'Installing...' : 'Install MarkItDown'}</button>` : ''}${st.mdInstalling ? ' <span class="note">This takes one to two minutes. Do not close the window.</span>' : ''}${st.mdInstallMsg ? ` <span class="note">${esc(st.mdInstallMsg)}</span>` : ''}</div>
    ${viewing ? `<div class="panel${vmode('src') === 'md' ? ' dark' : ''}"><div class="panel-head"><span class="mono">${esc(viewing.name)}${isMdName(viewing.name) ? '' : '.md'}</span><div class="row-actions"><span class="note">${isMdName(viewing.name) ? 'Original Markdown' : 'Converted Markdown'}, read-only</span>${vmTabs('src', viewing.md, viewing.name, viewing.name)}</div></div>${vmBody('src', viewing.md)}</div>` : ''}
  </div>
  <div class="panel">
    <div class="panel-head"><h3>Consolidated PRD</h3><div class="row-actions">${tplSelectHtml('prd')}<button class="key small" id="merge-btn" data-act="merge" type="button">${st.confirmMerge ? 'Replace the PRD below?' : 'Generate PRD'}</button><div class="subtabs" id="prd-view" role="group" aria-label="View"><button type="button" data-pv="md" aria-pressed="${st.pview === 'md'}">Markdown</button><button type="button" class="key small" data-prd-full onclick="event.stopPropagation(); mdFull(getCurrentPRD(), 'Consolidated PRD'); return false;" aria-label="Open preview in full screen" title="Open preview in full screen">Preview</button></div></div></div>
    ${prdGenHtml()}
    <div class="panel-body"><div class="row-actions"><button class="key small" data-act="copy-prd" type="button">Copy</button><button class="key small" data-act="paste-prd" type="button">Paste from clipboard</button><button class="key small" data-act="undo-prd" type="button" ${st.undo === null ? 'disabled data-off="1"' : ''}>Undo replace</button><button class="key small" data-act="import-prd" type="button">Import .md</button><span class="note" id="save-note">${esc(storeNote())}</span></div></div>
    ${editor}
    <div class="coverage">Edit here, or export the Markdown, edit it in another tool and paste it back. The next pages are generated from this text.</div>
  </div>
  ${issuesPanel()}
  ${smartPanel()}
  ${versionsPanel()}
  </div>`;
  setBusy();
}
function textToMd(s) {
  const t = s.text || '';
  if (/\.csv$/i.test(s.name)) { const rows = t.trim().split(/\r?\n/).map((r) => r.split(',')); return rows.length ? ['| ' + rows[0].join(' | ') + ' |', '| ' + rows[0].map(() => '---').join(' | ') + ' |', ...rows.slice(1).map((r) => '| ' + r.join(' | ') + ' |')].join('\n') : ''; }
  if (/\.html?$/i.test(s.name)) return t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, x) => '\n' + '#'.repeat(+n) + ' ' + x.replace(/<[^>]+>/g, '') + '\n').replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
  if (/\.json$/i.test(s.name)) return '```json\n' + t + '\n```';
  return t;
}
/* a Markdown source is already Markdown: read its text, no conversion */
async function loadMdSource(s) {
  try {
    if (store.mode === 'server' && s.url) { const r = await fetch(s.url, { cache: 'no-store' }); if (!r.ok) throw new Error('could not read the file'); s.md = await r.text(); }
    else if (s.text != null) s.md = s.text;
    else return false;
    s.engine = 'Original Markdown'; s.error = ''; return true;
  } catch (e) { s.error = e.message || String(e); return false; }
}
async function convert(name) {
  const s = D.sources.find((x) => x.name === name); if (!s) return;
  if (isMdName(s.name)) { s.busy = true; if (current === 1) r1(); await loadMdSource(s); s.busy = false; flush(); if (current === 1) r1(); drawTabs(); return; }
  s.busy = true; s.error = ''; if (current === 1) r1();
  try {
    if (store.mode === 'server' && s.url) {
      const r = await fetch(`/api/designs/${enc(D.id)}/convert/${enc(s.name)}`, { method: 'POST' });
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Conversion failed');
      s.md = j.markdown; s.engine = j.engine || 'MarkItDown';
    } else if (s.text != null) { await sleep(300); s.md = textToMd(s); s.engine = 'simulation'; }
    else { s.md = `# ${s.name}\n\n> This file type needs MarkItDown. Run server.py with MarkItDown installed, or paste the document text here.\n`; s.engine = 'placeholder'; toast('This file type needs the MarkItDown helper service'); }
  } catch (e) { s.error = e.message || String(e); }
  s.busy = false; flush(); if (current === 1) r1(); drawTabs();
}
async function convertAll() {
  if (st.busy) return;
  const todo = D.sources.filter((s) => !s.md);
  if (!todo.length) return toast(D.sources.length ? 'Every source file is ready' : 'Add source files first');
  st.busy = true; setBusy(); for (const s of todo) await convert(s.name); st.busy = false; setBusy();
}
async function addFiles(list) {
  for (const f of list) {
    if (f.size > 50 * 1024 * 1024) { toast(f.name + ' is larger than 50 MB'); continue; }
    const s = { name: f.name, type: fileKind(f.name), size: f.size, md: '', engine: '' };
    if (isMdName(f.name)) { s.md = await f.text(); s.engine = 'Original Markdown'; }
    if (store.mode === 'server') {
      try { const r = await fetch(`/api/designs/${enc(D.id)}/sources/${enc(f.name)}`, { method: 'PUT', body: f }); const j = await r.json(); if (!r.ok) throw new Error(j.error); s.url = j.url; }
      catch (e) { toast('Upload failed: ' + f.name); continue; }
    } else {
      files[f.name] = f; delete blobUrls[f.name];
      if (TEXTY.test(f.name) && f.size <= 200 * 1024) s.text = await f.text();
    }
    const i = D.sources.findIndex((x) => x.name === f.name); if (i >= 0) D.sources[i] = s; else D.sources.push(s);
  }
  flush(); r1(); drawTabs();
}
/* a new PRD starts clean: the AI findings and the dismissed issues belonged to the old text. The user runs Analyze with AI again. */
function clearPrdIssues() { aiRun++; D.aiIssues = null; D.dismissed = []; if (D.resolved) D.resolved.prd = {}; st.aiBusy = false; st.aiError = ''; st.showDismissed = false; st.showMinor = false; }
function setPrd(text, msg, label) { snap('Before: ' + (label || 'replace')); st.undo = D.prd; D.prd = text; snap(label || msg || 'Replaced'); clearPrdIssues(); flush(); r1(); drawTabs(); if (msg) toast(msg + '. Press Analyze with AI to check it.'); }

/* ---------- real AI through the configured AI model (server.py) ---------- */
const AI_OFF = () => store.mode !== 'server' ? (location.protocol === 'file:' ? 'AI is unavailable: this page was opened as a file. Start the helper service with "python3 src/server.py" and open http://127.0.0.1:8765 instead.' : 'AI is unavailable: the helper service (server.py) did not answer. Check that "python3 src/server.py" is running, then reload this page.') : !store.ai ? 'No AI is available. Install Claude Code so that "claude" is on the PATH, or add an OpenAI-compatible provider on the Designs page, then restart server.py.' : '';
/* Tokens are spent only when the user presses a button: every AI call needs a recent button press (the window is renewed by each call of a running chain, and cleared when a design is opened). */
const AI_STEP_NAMES = { 'analyze-prd': 'PRD analysis', 'gen-prd': 'Generate PRD', 'gen-scenarios': 'Scenarios', 'scenario-plan': 'Scenario categories', 'fill-scenarios': 'Scenario fill', 'analyze-payloads': 'Payload analysis', 'refine-test': 'Test refinement', 'build-plan': 'Build plan', 'arch-assess': 'Readiness check', 'arch-review': 'Design review', 'arch-options': 'Find solutions', 'gen-arch': 'Architecture design', 'update-doc': 'Update with a prompt', 'compose-doc': 'Apply a template' };
const setAiNow = (t) => { st.aiNow = t; const e = $('#ai-now'); if (e) { e.textContent = t; e.hidden = !t; } const b = $('#ai-stop'); if (b) { b.hidden = !/^Running/.test(t || ''); if (!b.hidden) { b.disabled = false; b.textContent = 'Stop'; } } };
const AI_WINDOW = 30 * 60 * 1000;
const aiAllowed = () => st.userAi && Date.now() - st.userAi < AI_WINDOW;
const JOB_KEEP = 6 * 3600 * 1000, jobsKey = 'dochub-jobs';
const jobsGet = () => { try { const o = JSON.parse(localStorage.getItem(jobsKey) || '{}'); Object.keys(o).forEach((k) => { if (Date.now() - o[k].at > JOB_KEEP) delete o[k]; }); return o; } catch (e) { return {}; } };
const jobsSet = (o) => { try { localStorage.setItem(jobsKey, JSON.stringify(o)); } catch (e) { /* not saved */ } };
/* after a reload: tell the user about AI jobs of this design that kept running (or finished) on the helper */
async function checkPendingJobs() {
  if (store.mode !== 'server' || !D) return;
  const mine = Object.entries(jobsGet()).filter(([k]) => k.startsWith(D.id + '|')); if (!mine.length) return;
  const out = [];
  for (const [k, v] of mine) {
    try { const p = await fetch('/api/ai-job/' + v.jid, { cache: 'no-store' }); if (p.status === 404) { const o = jobsGet(); delete o[k]; jobsSet(o); continue; } const q = await p.json(); const nm = AI_STEP_NAMES[k.split('|')[1]] || k.split('|')[1]; out.push(q.done ? nm + ' finished on the helper' : nm + ' is still running on the helper'); } catch (e) { /* helper not reachable */ }
  }
  if (out.length) setAiNow(out.join('; ') + '. Press its button again to pick up the result without a new run.');
}
/* a note shown inside the progress box while a call runs (never a popup): set by the page (smaller batches) or by the helper (background shortened) */
function aiNotice(t) { st.aiNotice = t || ''; $$('.ai-notice').forEach((e) => { e.textContent = st.aiNotice; e.hidden = !st.aiNotice; }); }
/* ---------- Stop: every AI step can be stopped; the model call is cancelled on the helper and the action is rolled back to how it was before it began ---------- */
class AiStopped extends Error { constructor() { super('Stopped. Nothing was changed.'); this.stopped = true; } }
const stopErr = () => { if (st.aiTxn) st.aiTxn.stopped = true; return new AiStopped(); };
/* after Stop, every further call of the same action refuses at once, until the user presses a button again */
const aiStopped = () => !!st.aiStopAt && !(st.userAi > st.aiStopAt);
async function aiStop() {
  st.aiStopAt = Date.now(); if (st.aiTxn) st.aiTxn.stopped = true;
  setAiNow('Stopping...'); $$('.ai-stop').forEach((b) => { b.disabled = true; b.textContent = 'Stopping...'; });
  if (st.aiJob) { try { await fetch('/api/ai-job/' + st.aiJob + '/cancel', { method: 'POST', body: '{}' }); } catch (e) { /* the call ends with the page anyway */ } }
  if (st.aiWake) st.aiWake();
}
/* what a stopped action puts back: everything the AI steps write into the design */
const AI_TXN_KEYS = ['prd', 'dismissed', 'aiIssues', 'matrix', 'matrixSrc', 'matrixGen', 'tests', 'payAi', 'payReport', 'erAi', 'payMap', 'archMd', 'archAssess', 'archDec', 'archAnswers', 'archDismissed', 'archReview', 'archAi', 'buildAi', 'versions', 'archVersions', 'resolved', 'cc', 'ccDismissed'];
const aiSnap = () => { const o = {}; AI_TXN_KEYS.forEach((k) => { o[k] = D[k] === undefined ? undefined : JSON.stringify(D[k]); }); return o; };
async function aiRollback(snap) {
  Object.keys(snap).forEach((k) => { if (snap[k] === undefined) delete D[k]; else D[k] = JSON.parse(snap[k]); });
  payCache = { k: '', a: null }; rmCache = { h: null, m: null };
  Object.assign(st, { revBusy: false, lrBusy: false, paBusy: false, erBusy: false, allBusy: false, archBusy: '', archRevBusy: false, archPropBusy: false, aiBusy: false, prdGenBusy: false, proposalBusy: false, busy: false,
    revDone: null, revError: '', lrDone: null, lrError: '', paError: '', erError: '', allSteps: null, allDone: false, archError: '', archRevError: '', aiError: '', archProposal: null, matrix: !!D.matrix, arch: D.archMd != null, matrixDirty: !!D.matrix, archDirty: D.archMd != null, testsDirty: !!(D.tests && D.tests.length) });
  try { await flush(); } catch (e) { /* kept in memory */ }
  drawTabs(); show(current, false); setAiNow('Stopped. Nothing was changed.');
}
/* an action (one button press: it may call the model many times) is one unit: if the user stops it, the design is put back to how it was before it started */
const aiAction = (fn) => async function (...args) {
  if (st.aiTxn || !D) return fn.apply(this, args);  /* started inside another action: it is part of it */
  const txn = st.aiTxn = { snap: aiSnap(), stopped: false };
  try { return await fn.apply(this, args); }
  finally { st.aiTxn = null; if (txn.stopped) await aiRollback(txn.snap); }
};
async function aiPost(path, body, notice) {
  aiNotice(notice || '');
  try { return await aiPost2(path, body); } catch (e) { if (e && e.stopped && st.aiTxn) st.aiTxn.stopped = true; throw e; } finally { aiNotice(''); st.aiJob = ''; }
}
async function aiPost2(path, body) {
  if (aiStopped()) throw stopErr();
  if (!aiAllowed()) { const m = `Blocked: "${path}" was started without a button press. AI only runs when you press a button.`; console.warn(m); toast(m); throw new Error(m); }
  st.userAi = Date.now();
  if (st.readOnly) { const m = 'Read-only: someone else is editing this project, so AI is off here.'; toast(m); throw new Error(m); }
  const off = AI_OFF(); if (off) throw new Error(off);
  const stepName = String(path).split('/')[0]; setAiNow('Running: ' + (AI_STEP_NAMES[stepName] || stepName) + ' with ' + aiModelFor(stepName));
  /* the call runs on the helper as a background job and is polled. The job id is remembered, so a reloaded page (or a second press of the same button) joins the same job instead of starting another: the work does not depend on this browser tab */
  let r, j, fails = 0, jid = null;
  const jobs = jobsGet(), jk = (D ? D.id : '') + '|' + path, hh = Core.hashStr(JSON.stringify(body)), rec = jobs[jk], forget = () => { const o = jobsGet(); delete o[jk]; jobsSet(o); };
  if (rec && rec.h === hh && Date.now() - rec.at < JOB_KEEP) { jid = rec.jid; st.aiJob = jid; }
  const poll = async (first) => {
    for (;;) {
      if (!first) await Promise.race([new Promise((res) => setTimeout(res, 2000)), new Promise((res) => { st.aiWake = res; })]); first = false;
      try {
        const p = await fetch('/api/ai-job/' + jid, { cache: 'no-store' }); fails = 0;
        if (p.status === 404) return null;
        const q = await p.json().catch(() => ({}));
        if (q.notice && q.notice !== st.aiNotice) aiNotice(q.notice);
        if (q.done) { forget(); return { r: { ok: q.code < 400, status: q.code }, j: JSON.parse(q.body || '{}') }; }
      } catch (e) { if (++fails >= 5) throw new Error('The helper stopped answering while the model was working. Check that the server.py window is still open, then press the button again: a job that is still running on the helper is picked up again.'); }
    }
  };
  let got = jid ? await poll(true) : null;
  if (!got) {
    forget();
    try { r = await fetch('/api/ai-job/' + path, { method: 'POST', body: JSON.stringify(body) }); } catch (e) { throw new Error('The helper service could not be reached. Is server.py still running (its window may have been closed)?'); }
    if (r.status === 404) { try { r = await fetch('/api/ai/' + path, { method: 'POST', body: JSON.stringify(body) }); } catch (e) { throw new Error('The connection to the helper was cut before the model answered. Start server.py again from the latest files; a slow local model needs it.'); } j = await r.json().catch(() => ({})); }
    else {
      const first = (await r.json().catch(() => ({}))) || {}; jid = first.job; st.aiJob = jid || '';
      if (jid && aiStopped()) { try { await fetch('/api/ai-job/' + jid + '/cancel', { method: 'POST', body: '{}' }); } catch (e) { /* ignore */ } forget(); throw stopErr(); }  /* Stop was pressed while the call was being started */
      if (!r.ok || !jid) j = first; else { const o = jobsGet(); o[jk] = { jid, h: hh, at: Date.now() }; jobsSet(o); got = await poll(false); if (!got) throw new Error('The helper was restarted while the model was working. Press the button again.'); r = got.r; j = got.j; }
    }
  } else { r = got.r; j = got.j; }
  if (r.ok && j.model) store._lastModel = j.model;
  if (r.ok && D) logActivity('ai', (AI_STEP_NAMES[String(path).split('/')[0]] || path) + ' with ' + (j.model || ''));
  if (r.status === 499 || (j && j.stopped)) { setAiNow('Stopped. Nothing was changed.'); throw stopErr(); }
  if (r.ok) setAiNow('Last AI call: ' + (AI_STEP_NAMES[String(path).split('/')[0]] || path) + ' with ' + (j.model || aiModelFor(String(path).split('/')[0])));
  else setAiNow('');
  if (r.status === 404) throw new Error('The helper service is out of date and does not know this action. Close the old server.py window, start it again (double-click start.command), reload this page and try again.');
  if (!r.ok) throw new Error(j.error || 'The AI call failed (' + r.status + ')');
  return j;
}
/* progress indicator for every AI step: spinner, what is happening, and elapsed time */
/* which model runs a step: the design's choice, else the global step choice, else the global default, else the Claude CLI */
function aiModelFor(step) {
  const P = PROVS, steps = (P && P.steps) || {}, pick = '';
  const id = pick || steps[step] || steps['*'] || 'claude-cli', p = ((P && P.providers) || []).find((x) => x.id === id);
  if (!p) return id === 'claude-cli' ? 'Claude CLI' + (store.aiModel && store.aiModel !== 'Claude CLI default' ? ' / ' + store.aiModel : '') : id;
  return p.builtin ? 'Claude CLI' + (p.model && p.model !== 'Claude CLI default' ? ' / ' + p.model : '') : `${p.name}${p.model ? ' / ' + p.model : ''}`;
}
/* the provider that runs a step, and what one call may carry (characters of input). Only a local model with a small window is limited: cloud and Claude keep the normal batch size */
function aiProvFor(step) { const P = PROVS, steps = (P && P.steps) || {}, id = steps[step] || steps['*'] || 'claude-cli'; return ((P && P.providers) || []).find((x) => x.id === id) || { id, builtin: true, local: false, window: 200000 }; }
function aiBudget(step, cap, extra) {
  const p = aiProvFor(step); if (!p.local) return { chars: cap, note: '' };
  const chars = Math.max(6000, Math.min(cap, Math.floor((p.window || 32768) * 3 * 0.5) - (extra || 0) - 9000));
  return { chars, note: chars < cap ? `Local model with a ${Math.round((p.window || 32768) / 1024)}K-token window: this step runs in smaller batches (more calls, slower). Results are the same, only slower.` : '' };
}
const modelNote = (m) => m ? ` Model: ${m}.` : '';
const AI_STEP_RULES = [[/reading the matched payloads/, 'fill-scenarios'], [/Linking in progress/, 'analyze-payloads'], [/reading the PRD/, 'analyze-prd'], [/checking the documents/, 'arch-assess'], [/reviewing the design/, 'arch-review'], [/finding solutions/, 'arch-options'], [/writing the architecture/, 'gen-arch'], [/writing the PRD/, 'gen-prd'], [/planning the build/, 'build-plan'], [/editing the test case/, 'refine-test'], [/editing the (design|PRD)/, 'update-doc'], [/^Analysis in progress$/, 'analyze-payloads'], [/^Generation in progress/, 'gen-scenarios']];
const aiProgress = (what, hint, start = Date.now(), step = (AI_STEP_RULES.find(([re]) => re.test(what)) || [0, ''])[1]) => `<div class="ai-progress" role="status" aria-live="polite"><span class="spinner" aria-hidden="true"></span><div><b>${esc(what)}</b> <span class="ai-timer" data-start="${start}">0:00</span> elapsed <button class="link ai-stop" data-act="ai-stop" type="button" title="Cancel the model call and put everything back as it was before this step">Stop</button>${hint ? `<div class="note">${esc(hint)}</div>` : ''}${step ? `<div class="note">Model: <b>${esc(aiModelFor(step))}</b></div>` : ''}<div class="note ai-notice"${st.aiNotice ? '' : ' hidden'}>${esc(st.aiNotice || '')}</div></div></div>`;
setInterval(() => { const now = Date.now(); $$('.ai-timer[data-start]').forEach((e) => { const sec = Math.max(0, Math.round((now - +e.dataset.start) / 1000)); e.textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }); }, 1000);
/* AI edit of a document from a free-text instruction. Returns a proposal; nothing changes until the user accepts. */
async function aiUpdateDoc(kind, doc, instruction, context) {
  const j = await aiPost('update-doc', { kind, document: doc, instruction, context: context || '', connections: kind === 'arch' ? activeConns() : [] });
  let md = String(j.markdown || ''); if (/\n$/.test(doc) && !/\n$/.test(md)) md += '\n';
  const notes = (j.notes || []).map(String);
  const applied = md.trim() !== doc.trim();
  if (applied && md.length < doc.length * 0.5) notes.push('Warning: the update removes more than half of the document. Check the changes before you accept.');
  if (!applied && !notes.length) notes.push('The AI made no change.');
  return { md, notes, applied };
}
const AI_TYPES = ['Conflict', 'Decision needed', 'Gap', 'Wording'];
/* severity: AI issues carry Critical or Important. Rule-based PRD issues are mapped from their type. */
const SEV_ORDER = { Critical: 0, Important: 1, Minor: 2 };
const sevOf = (i) => i.severity || (i.type === 'Conflict' ? 'Critical' : i.type === 'Wording' ? 'Minor' : 'Important');
const sevChip = (i) => { const v = sevOf(i); return `<span class="chip sev sev-${v.toLowerCase()}">${v}</span>`; };
const bySev = (a, b) => SEV_ORDER[sevOf(a)] - SEV_ORDER[sevOf(b)];
let aiRun = 0;
async function analyzePrdAi() {
  if (!D || !D.prd.trim()) return;
  const mine = ++aiRun, hash = prdHash(); st.aiStart = Date.now(); st.aiBusy = true; st.aiError = ''; refreshIssues();
  try {
    const j = await aiPost('analyze-prd', { prd: D.prd });
    if (mine !== aiRun || !D) return;
    const seen = new Set();
    const issues = (j.issues || []).filter((x) => x && x.text).map((x) => ({ type: AI_TYPES.includes(x.type) ? x.type : 'Gap', severity: x.severity === 'Critical' ? 'Critical' : 'Important', where: String(x.where || 'Document'), text: String(x.text), prompt: String(x.prompt || ''), fixes: parseFixes(x.fixes), ai: true })).map((x) => ({ ...x, key: Core.hashStr('ai|' + x.type + '|' + x.where + '|' + x.text) })).filter((x) => !seen.has(x.key) && seen.add(x.key));
    D.aiIssues = { hash, at: Date.now(), model: j.model || '', issues }; resolvedMap('prd'); D.resolved.prd = {}; flush();
    toast(`AI analysis done: ${issues.length} issue${issues.length === 1 ? '' : 's'} found`);
  } catch (e) { if (mine === aiRun) st.aiError = e.message || String(e); }
  if (mine === aiRun) { st.aiBusy = false; if (current === 1) refreshIssues(); }
}
/* near-duplicate issues (same type, mostly the same words) become one entry with the combined places and fix options */
const issueTokens = (t) => new Set(String(t).toLowerCase().replace(/\b[a-z]{1,5}-?\d+\b/g, ' ').match(/[a-z]{4,}/g) || []);
function mergeSimilar(list) {
  const out = [];
  list.forEach((i) => {
    const tk = issueTokens(i.text), hit = out.find((o) => { if (o.type !== i.type) return false; const u = new Set([...o._tk, ...tk]); let n = 0; tk.forEach((w) => { if (o._tk.has(w)) n++; }); return u.size && n / u.size >= 0.55; });
    if (!hit) { out.push({ ...i, _tk: tk, _n: 1 }); return; }
    hit._n++; const wh = new Set(String(hit.where).split(/,\s*/)); String(i.where).split(/,\s*/).forEach((w) => wh.add(w)); hit.where = [...wh].slice(0, 4).join(', ') + (wh.size > 4 ? ` and ${wh.size - 4} more` : '');
    hit.text = hit._n === 2 ? `${hit.text} (Also found in ${i.where}.)` : hit.text.replace(/\(Also found in [^)]*\.\)$/, `(Also found in ${hit._n - 1} other places.)`);
    const have = new Set((hit.fixes || []).map((f) => f.label.toLowerCase())); hit.fixes = (hit.fixes || []).concat((i.fixes || []).filter((f) => !have.has(f.label.toLowerCase()))).slice(0, 4);
    if (i.severity === 'Critical') hit.severity = 'Critical';
  });
  return out.map(({ _tk, _n, ...r }) => r);
}
/* nothing is listed until Analyze with AI has run on this PRD; then the quick built-in checks and the AI findings appear together */
const prdIssuesAll = () => D.aiIssues && D.aiIssues.issues ? mergeSimilar(Core.analyzePrd(D.prd).concat(D.aiIssues.issues)) : [];
async function ensurePrd() {
  if (D.prd.trim()) return true;
  if (!D.sources.length) { show(1); toast('Add source files or write the PRD first'); return false; }
  show(1); st.busy = true; setBusy();
  for (const s of D.sources.slice()) { if (!s.md) await convert(s.name); }
  st.busy = false; await generatePrd(true);
  return !!D.prd.trim();
}

/* ---------- cross check: one result, the same on every page ---------- */
const CC_NOTE = 'Compares every page that has data. Run it any time. Same result on every page. Nothing is changed.';
const CC_AREAS = ['PRD', 'Requirements', 'Matrix', 'Test plan', 'Payloads', 'Architecture', 'Build plan'];
const ccKey = () => Core.hashStr([D.prd, JSON.stringify(D.matrix || null), JSON.stringify(D.tests || []), D.payloadImport ? D.payloadImport.at + ':' + D.payloadImport.count : '', D.archMd || '', st.build ? st.buildHash : ''].join('|'));
const promptFor = (f) => { const t = String(f.text).replace(/\s+/g, ' ').replace(/\|/g, '/'); return /^(Conflict|Changed)$/.test(f.type) ? `add decision: Resolve - ${t}` : `add open item: ${t}`; };
function readinessHtml(rd) {
  if (!rd) return '';
  const row = (kind, x, i) => `<tr><td>${esc(x.where)}</td><td>${esc(x.text)}</td><td><button class="key small" data-ccrd="${kind}:${i}" type="button">Use in prompt</button></td></tr>`;
  const tbl = (t, list, kind) => list.length ? `<div class="table-wrap"><table><thead><tr><th>${t}</th><th>Issue</th><th></th></tr></thead><tbody>${list.map((x, i) => row(kind, x, i)).join('')}</tbody></table></div>` : '';
  return `<div class="panel-head"><h3>Ready to build the design?</h3><span class="chip verdict ${rd.verdict === 'Blocked' ? 'bad' : rd.verdict === 'Ready' ? 'good' : 'warn'}">${esc(rd.verdict)}</span></div><div class="panel-body"><p>${esc(rd.summary)}</p></div>${tbl('Blockers', rd.blockers, 'b')}${tbl('Risks', rd.risks, 'r')}${rd.good.length ? `<div class="coverage"><b>In good shape:</b> ${rd.good.map(esc).join(' ')}</div>` : ''}`;
}
const fKey = (f) => Core.hashStr([f.type, f.where, f.text].join('|'));
const ccDis = () => D.ccDismissed || (D.ccDismissed = []);
const CC_SEV = { Conflict: 'Critical', Changed: 'Important', Missing: 'Important', Unmatched: 'Minor', Quality: 'Minor' };
const ccSev = (x) => CC_SEV[x.type] || 'Important';
const ccArea = (x) => { const m = CC_AREAS.find((a) => x.where.startsWith(a + ': ') || x.where === a); return m || 'Other'; };
const ccF = () => st.ccFilter || (st.ccFilter = { sev: 'All', type: 'All', area: 'All' });
function ccBody(r, arch) {
  const all = r.findings, dis = ccDis(), f = ccF();
  const live = all.map((x, i) => ({ x, i })).filter(({ x }) => !dis.includes(fKey(x))), nDis = all.length - live.length;
  const shown = live.filter(({ x }) => (f.sev === 'All' || ccSev(x) === f.sev) && (st.ccMinor || ccSev(x) !== 'Minor' || f.sev === 'Minor') && (f.type === 'All' || x.type === f.type) && (f.area === 'All' || ccArea(x) === f.area)).sort((p, q) => SEV_ORDER[ccSev(p.x)] - SEV_ORDER[ccSev(q.x)] || p.i - q.i);
  const cnt = (fn) => live.filter(({ x }) => fn(x)).length;
  const pill = (kind, val, label, n, cls) => `<button type="button" class="fpill ${cls || ''}" data-ccf="${kind}:${ea(val)}" aria-pressed="${f[kind] === val}">${esc(label)}${n === undefined ? '' : ' ' + n}</button>`;
  const sevs = ['Critical', 'Important', 'Minor'].filter((v) => cnt((x) => ccSev(x) === v));
  const types = ['Conflict', 'Changed', 'Missing', 'Unmatched', 'Quality'].filter((t) => cnt((x) => x.type === t));
  const areas = [...CC_AREAS, 'Other'].filter((a) => cnt((x) => ccArea(x) === a));
  const bar = live.length ? `<div class="ccfilters"><div class="frow"><span class="note">Severity</span>${pill('sev', 'All', 'All', live.length)}${sevs.map((v) => pill('sev', v, v, cnt((x) => ccSev(x) === v), 'sev-' + v.toLowerCase())).join('')}</div><div class="frow"><span class="note">Type</span>${pill('type', 'All', 'All')}${types.map((t) => pill('type', t, t, cnt((x) => x.type === t))).join('')}</div><div class="frow"><span class="note">Area</span>${pill('area', 'All', 'All')}${areas.map((a) => pill('area', a, a, cnt((x) => ccArea(x) === a))).join('')}</div></div>` : '';
  const nMinor = live.filter(({ x }) => ccSev(x) === 'Minor').length, extra = `${nMinor && f.sev !== 'Minor' ? `<button class="link" data-act="cc-minor" type="button">${st.ccMinor ? 'Hide minor' : `Show minor (${nMinor})`}</button>` : ''}${arch && live.length ? '<button class="key small" data-act="cc-to-prompt" type="button">Add all issues to the prompt</button>' : ''}${nDis ? `<span class="note">${nDis} dismissed.</span><button class="key small" data-ccrestore="1" type="button">Restore dismissed</button>` : ''}`;
  const head = `<div class="panel-body"><div class="chips">${sevs.length ? sevs.map((v) => `<span class="chip sev sev-${v.toLowerCase()}">${cnt((x) => ccSev(x) === v)} ${v.toLowerCase()}</span>`).join('') : '<span class="note">No differences found.</span>'}${live.length ? `<span class="note">Showing ${shown.length} of ${live.length}</span>` : ''}${extra}</div>${bar}</div>`;
  const rows = shown.map(({ x, i }) => `<tr class="row-${ccSev(x).toLowerCase()}"><td><span class="chip sev sev-${ccSev(x).toLowerCase()}">${ccSev(x)}</span></td><td>${x.type}</td><td class="mono">${esc(x.where)}</td><td>${esc(x.text)}</td><td><div class="row-actions">${arch ? `<button class="key small" data-ccuse="${i}" type="button">Use in prompt</button>` : ''}<button class="key small" data-ccdis="${i}" type="button" aria-label="Dismiss this finding">Dismiss</button></div></td></tr>`).join('');
  return head + (live.length ? (shown.length ? `<div class="table-wrap"><table><thead><tr><th>Severity</th><th>Type</th><th>Where</th><th>Finding</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="panel-body"><p class="note">No findings match these filters.</p></div>') : '');
}
const CC_LS = 'prd-demo-cc-collapsed';
const ccCollapsed = () => pcLoad().has('cross-check');
const CHEV = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" focusable="false"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function ccSummary(r) {
  const live = r.findings.filter((x) => !ccDis().includes(fKey(x)));
  const c = ['Critical', 'Important', 'Minor'].map((t) => [t, live.filter((x) => ccSev(x) === t).length]).filter((x) => x[1]);
  return (c.length ? c.map(([t, n]) => `${n} ${t.toLowerCase()}`).join(', ') : 'no differences') + `. Verdict: ${r.readiness.verdict}.`;
}
/* The cross check can run at any time. Pages that have no data yet are listed as not compared; nothing blocks the button. */
const ccNotCompared = () => [['PRD', !!(D && D.prd.trim())], ['Scenario matrix', !!(D && D.matrix)], ['Test plan', tests().length > 0], ['Payload library', !!(D && D.payloadImport)], ['Architecture design', !!(D && D.archMd != null)], ['Build plan', !!st.build]].filter((x) => !x[1]).map((x) => x[0]);
/* what the last run compared: the result is dropped when one of these is reset, removed or replaced (not just edited) */
const ccHad = () => ({ prd: !!(D && D.prd.trim()), reqs: Core.hashStr(model().reqs.map((q) => q.id).join(',')), matrix: D.matrix ? Core.hashStr(D.matrix.map((s) => s.id).join(',')) : '', tests: tests().length > 0, pay: !!D.payloadImport, arch: D.archMd != null && !!D.archMd.trim() });
function ccPrune() {
  const r = D && D.cc && D.cc.all; if (!r) return;
  const h = r.had, n = ccHad();
  /* old results without the record are kept until the data changes (shown as out of date) */
  if (h && (['prd', 'tests', 'pay', 'arch'].some((k) => h[k] && !n[k]) || (h.matrix && h.matrix !== n.matrix) || (h.reqs !== n.reqs))) { delete D.cc.all; D.ccDismissed = []; st.ccFilter = null; flush(); }
}
function crossPanel(page) {
  ccPrune();
  const r = (D.cc || {}).all, arch = page === 'arch', stale = r && r.key !== ccKey(), col = ccCollapsed();
  const skipped = ccNotCompared();
  const note = col && r ? `${esc(ccSummary(r))}${stale ? ' Out of date.' : ''}` : `${CC_NOTE}${r ? ' Last run ' + esc(fmtDate(r.at)) + '.' : ''}`;
  const body = `${r && r.scope ? `<div class="panel-body"><div class="note"><b>Compared:</b> ${r.scope.map(esc).join('. ')}.</div></div>` : ''}${skipped.length ?`<div class="panel-body"><div class="note">Not compared yet (no data): ${esc(skipped.join(', '))}.</div></div>` : ''}${stale ? '<div class="panel-body"><div class="callout">The data changed after this check. Run it again.</div></div>' : ''}${r ? ccBody(r, arch) : '<div class="empty"><p>Not run yet. It lists what is missing or does not match, so you decide what to fix.</p></div>'}${arch && r ? `<div class="rd" id="rd-box">${readinessHtml(r.readiness)}</div>` : ''}`;
  return `<div class="panel cc" id="cc-${page}"><div class="panel-head"><h3>Cross check</h3><span class="note cc-note">${note}</span><div class="row-actions"><button class="key primary small" data-cc="1" type="button">${arch ? 'Check consistency' : 'Run cross check'}</button></div></div><div class="cc-scroll" id="cc-body-${page}" tabindex="0" role="region" aria-label="Cross check results">${body}</div></div>`;
}
const ccSlot = (n) => { const s = $('#cc-slot-' + n); if (s) s.innerHTML = crossPanel(n === 6 ? 'arch' : 'all'); };
const refreshCC = () => { [1, 2, 3, 4, 5, 6].forEach(ccSlot); };
async function runCross() {
  const prd = Core.requirementsModel(D.prd), rows = D.matrix || [], tests = D.tests || [];
  let pay = null;
  if (D.payloadImport) { const files = await impFiles(); if (files) pay = Core.analyzePayloads(files, rows, model()); }
  const ctx = { prd, req: model(), matrix: rows, tests, pay, archMd: D.archMd || '', prdText: D.prd, hasMatrix: !!D.matrix, hasTests: tests.length > 0, hasPay: !!pay || !!D.payloadImport, build: st.build ? buildPlan() : null, buildStale: !!st.build && st.buildHash !== prdHash(), prdIssues: prdIssuesAll().filter((i) => !(D.dismissed || []).includes(i.key)) };
  const A = D.archAssess; ctx.archPending = A && D.archMd != null ? { checked: true, issues: (A.issues || []).filter((i) => !archDis().includes(i.key) && !ansHas(archAnswers()[i.key])).length, options: archUndecided().length } : null;
  const findings = Core.crossCheck('all', ctx), readiness = Core.readiness(ctx);
  (D.cc = D.cc || {}).all = { at: Date.now(), key: ccKey(), findings, readiness, scope: Core.ccScope(ctx), had: ccHad() };
  flush(); refreshCC();
  toast(findings.length ? `${findings.length} differences found. Verdict: ${readiness.verdict}` : `No differences found. Verdict: ${readiness.verdict}`);
}
function addToPrompt(lines) {
  const cur = (($('#arch-prompt') || {}).value || st.archPrompt || '').replace(/\s+$/, '');
  st.archPrompt = (cur ? cur + '\n' : '') + lines.join('\n');
  if (current === 6) { if (D.archMd == null) r6(); else drawArch(); }
}

/* ---------- stage 2: requirements and BPMN (read from the consolidated PRD every time) ---------- */
const DZ = '';
const DZ_UNUSED = '<button class="key small dz" data-dz="1" type="button" title="Switch between fitting the width and actual size">Actual size</button>';
const flowSvg = (src) => { try { return diagram(src); } catch (e) { return `<pre class="code">${esc(src)}</pre>`; } };
const list = (a) => a.length ? `<ul class="plain">${a.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="note">Nothing listed in the PRD.</p>';
const editBtn = (t) => `<button class="key small" data-editprd="${ea(t)}" type="button">Edit in PRD</button>`;
function reqPanels(m) {
  const out = [];
  out.push(`<div class="panel"><div class="panel-head"><h3>Scope</h3>${editBtn('scope')}</div><div class="scope"><div><h3>In scope (${m.inScope.length})</h3>${list(m.inScope)}</div><div><h3>Out of scope (${m.outScope.length})</h3>${list(m.outScope)}</div></div></div>`);
  if (!m.processes.length) out.push(`<div class="panel"><div class="panel-head"><h3>Processes</h3>${editBtn('processes')}</div><div class="empty"><p>No process found. Add a section with numbered steps or a mermaid diagram to the PRD.</p></div></div>`);
  m.processes.forEach((p, i) => out.push(`<div class="panel"><div class="panel-head"><h3>Process ${i + 1}: ${esc(p.name)}</h3><div class="row-actions"><span class="note">${p.steps.length} steps. ${p.generated ? 'Diagram drawn from the steps.' : 'Diagram taken from the PRD.'}</span><button class="key small" data-copyflow="${i}" type="button">Copy diagram source</button>${editBtn('p:' + p.name)}</div></div><div class="diagram" data-src="${ea(encodeURIComponent(p.flow))}" data-name="${ea(slug(p.name))}">${flowSvg(p.flow)}</div></div>`));
  const rows = m.reqs.map((r) => `<tr class="${r.proposed ? 'ai' : ''}"><td class="mono">${esc(r.id)}</td><td>${esc(r.text)}</td><td>${esc(r.src || 'PRD')}</td><td>${r.proposed ? 'Proposed by AI' : 'From the PRD'}</td></tr>`).join('');
  out.push(`<div class="panel"><div class="panel-head"><h3>Requirements (${m.reqs.length})</h3>${editBtn('requirements')}</div>${m.reqs.length ? `<div class="table-wrap"><table><thead><tr><th>ID</th><th>Requirement</th><th>Source</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div><div class="coverage">${m.reqs.map((r) => r.id).join(', ')}${m.reqs.some((r) => r.proposed) ? '. Proposed requirements need owner approval.' : '.'}</div>` : '<div class="empty"><p>No requirements found. List them in the PRD as a table with an ID column, or as bullets that start with an ID such as R-01.</p></div>'}</div>`);
  return out;
}
function r2() {
  ccSlot(2, 'req');
  const p = $('#req-body');
  if (!D.prd.trim()) { p.innerHTML = gate('There is no PRD yet. This page is read from the consolidated PRD.', 'go1', 'Open the PRD library'); return; }
  p.innerHTML = `<div class="gap"><div class="callout">This page is read from the consolidated PRD each time you open it, so it is always in step. To change anything, use "Edit in PRD".</div>${reqPanels(model()).join('')}</div>`;
}
function editPrd(target) {
  st.pview = 'md'; show(1);
  const ta = $('#prd-editor'); if (!ta) return;
  const esc2 = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = target === 'scope' ? /^#{1,2}\s+(\d+\.\s*)?scope/im : target === 'requirements' ? /^#{1,2}\s+(\d+\.\s*)?(functional\s+)?requirements/im : target === 'processes' ? /^#{1,2}\s+(\d+\.\s*)?(business\s+)?process/im : new RegExp('^###\\s+(\\d+\\.\\d+\\s+)?' + esc2(target.slice(2)), 'im');
  const m = re.exec(D.prd);
  ta.focus();
  if (m) { ta.setSelectionRange(m.index, m.index + m[0].length); const line = D.prd.slice(0, m.index).split('\n').length; ta.scrollTop = Math.max(0, (line - 3) * 20); }
  if (ta.scrollIntoView) ta.scrollIntoView({ block: 'center' });
}

/* ---------- stage 3: scenario matrix (any column layout, priorities, linked workbook) ---------- */
const keys = (a) => a.length > 3 ? `<details><summary>${esc(a.slice(0, 3).join(', '))} +${a.length - 3} more</summary>${esc(a.join(', '))}</details>` : esc(a.join(', ')) || 'None';
const plainRows = (rows) => rows.map((s) => ({ id: s.id, ch: s.ch, kind: s.kind, name: s.name != null ? s.name : s.title, cat: s.cat || '', title: s.title, reqs: [...s.reqs], expect: s.expect, so: s.so || '', prio: s.prio || Core.defaultPrio(s.kind), extra: s.extra ? { ...s.extra } : {} }));
const derivedRows = () => { const m = model(); return plainRows(Core.genScenarios(m.reqs)); };
const KINDS = ['Happy', 'Edge', 'Negative', 'Gap'];
const MAP_FIELDS = [['id', 'Scenario ID (key)'], ['name', 'Name (key)'], ['cat', 'Category'], ['kind', 'Type'], ['prio', 'Priority'], ['ch', 'Channel'], ['so', 'Payload']];
const extraHeaders = () => [...new Set((D.matrix || []).flatMap((s) => Object.keys(s.extra || {})))];
const mRow = (s) => `<tr class="rowin"><td class="mono">${esc(s.id)}</td><td>${esc(s.ch)}</td><td>${esc(s.title)}</td><td><span class="refs">${s.reqs.map((r) => `<span class="ref">${r}</span>`).join('')}</span></td><td>${esc(s.kind)}</td><td>${esc(s.prio)}</td><td>${esc(s.expect)}</td></tr>`;
const PRIO_RULES = [
  ['P0', 'Critical', 'Core end-to-end scenarios that must work for the business to operate. Failure blocks release or go-live.', 'Order creation, payment, fulfillment, refund or return, critical integrations, core regional flows', 'Every build and deployment', 'If this fails, can we still operate or release? No'],
  ['P1', 'High', 'Primary happy-path business scenarios and commonly used variations. Failure has significant business impact but may have a workaround.', 'Full or partial shipment, common payment methods, standard cancellation or exchange, major market variations', 'Full regression, major release', 'Is this a normal, high-volume customer journey? Yes'],
  ['P2', 'Medium', 'Valid but less frequently used scenarios, secondary variations, or cases with acceptable workarounds.', 'Less common payment or shipping combinations, uncommon regional variations, secondary process paths', 'Planned regression', 'Is it supported but less common, or does it have a workaround? Yes'],
  ['P3', 'Low, edge or future', 'Rare edge cases, complex combinations, or capabilities not required today or intended for future scope.', 'Return on exchange, exchange on exchange, future capabilities, unsupported or exploratory combinations', 'As needed, future release', 'Is it an edge case, an exceptional combination, or a future capability? Yes']];
const prioRulesPanel = () => `<div class="panel" id="prio-rules"><div class="panel-head"><h3>Priority rules</h3><span class="note">Apply the tests in order from P0; the first that fits sets the priority.</span></div><div class="table-wrap"><table><thead><tr><th>Priority</th><th>Definition</th><th>Typical scenarios</th><th>Regression</th><th>Quick test</th></tr></thead><tbody>${PRIO_RULES.map(([p, n, d, t, r, q]) => `<tr><td><b>${p}</b><div class="note">${esc(n)}</div></td><td>${esc(d)}</td><td>${esc(t)}</td><td>${esc(r)}</td><td>${esc(q)}</td></tr>`).join('')}</tbody></table></div></div>`;
const mHead = '<thead><tr><th>ID</th><th>Channel</th><th>Scenario</th><th>Requirements</th><th>Type</th><th>Priority</th><th>Expected outcome</th></tr></thead>';
function drawFilter() {
  const m = D && D.matrix ? D.matrix : [];
  const fill = (id, key, vals, dataAttr) => { const el = $(id); if (!el) return; const all = ['All', ...vals]; if (!all.includes(st[key])) st[key] = 'All'; el.innerHTML = all.map((c) => `<button type="button" ${dataAttr}="${ea(c)}" aria-pressed="${st[key] === c}">${esc(c)}</button>`).join(''); };
  const sel = (id, key, vals, get) => { const el = $(id); if (!el) return; const all = ['All', ...vals]; if (!all.includes(st[key])) st[key] = 'All'; el.innerHTML = all.map((c) => `<option value="${ea(c)}"${st[key] === c ? ' selected' : ''}>${esc(c)}${c === 'All' ? '' : ' (' + m.filter((s) => get(s) === c).length + ')'}</option>`).join(''); };
  sel('#ch-filter', 'ch', [...new Set(m.map((s) => s.ch))], (s) => s.ch);
  fill('#kind-filter', 'kt', [...new Set(m.map((s) => s.kind).filter(Boolean))], 'data-kt');
  const cats = [...new Set(m.map((s) => s.cat || '').filter(Boolean))], cf = $('#cat-filter'), cl = $('#cat-label');
  if (cf) { cf.hidden = !cats.length; if (cl) cl.hidden = !cats.length; if (cats.length) sel('#cat-filter', 'cat', cats, (s) => s.cat || ''); else st.cat = 'All'; }
}
function matrixCoverage(rows) {
  const act = rows.filter((s) => s.prio !== 'Not required'), ids = model().reqs.map((r) => r.id), cov = ids.filter((id) => act.some((s) => s.reqs.includes(id))), miss = ids.filter((id) => !cov.includes(id));
  return `<div class="coverage" id="matrix-cov">${act.length} active scenarios cover ${cov.length} of ${ids.length} requirements (${cov.join(', ')}).${miss.length ? ` No scenario yet for ${miss.join(', ')}.` : ''}</div>`;
}
function summaryHtml() {
  const rows = D.matrix, m = model(), f = Core.analyzeMatrix(rows, m);
  const byP = Core.PRIO_ORDER.map((p) => [p, rows.filter((s) => s.prio === p).map((s) => s.id)]).filter((x) => x[1].length);
  const cats = [...new Set(rows.map((s) => s.cat || '').filter(Boolean))].map((c) => [c, rows.filter((s) => s.cat === c).map((s) => s.id)]);
  const types = ['Happy', 'Edge', 'Negative', 'Gap'].map((k) => [k, rows.filter((s) => s.kind === k).map((s) => s.id)]).filter((x) => x[1].length);
  const unc = m.reqs.filter((r) => !rows.some((s) => s.prio !== 'Not required' && s.reqs.includes(r.id))).map((r) => r.id);
  const grp = ['Conflict', 'Missing', 'Quality'].map((t) => [t, f.filter((x) => x.type === t)]).filter((x) => x[1].length);
  const src = D.matrixSrc ? `Imported from ${esc(D.matrixSrc.name)} on ${esc(fmtDate(D.matrixSrc.at))}${D.matrixSrc.link ? ', linked to ' + esc(D.matrixSrc.link) : ''}` : D.matrixGen ? `Generated by the AI model from the PRD on ${esc(fmtDate(D.matrixGen.at))}` : 'Generated from the requirements';
  const tr = (a, b, c) => `<tr><td>${a}</td><td class="num">${b}</td><td>${c}</td></tr>`;
  return `<div class="panel-head"><h3>Summary</h3><span class="note">${src}</span></div><div class="table-wrap"><table><thead><tr><th>Measure</th><th>Count</th><th>Which</th></tr></thead><tbody>${tr('Scenarios', rows.length, keys(rows.map((s) => s.id)))}${byP.map(([p, ids]) => tr('Priority ' + p, ids.length, keys(ids))).join('')}${cats.map(([c, ids]) => tr('Category ' + esc(c), ids.length, keys(ids))).join('')}${types.map(([k, ids]) => tr('Type ' + k, ids.length, keys(ids))).join('')}${tr('Requirements with no active scenario', unc.length, keys(unc))}${grp.map(([t, a]) => tr(t + ' with the PRD', a.length, keys([...new Set(a.map((x) => x.where))]))).join('')}</tbody></table></div><div class="coverage">${grp.length || unc.length ? 'The details are in "Check against the PRD" below.' : 'No conflicts or gaps found against the PRD.'}</div>`;
}
const WAIT = 'Generated when matched payloads are imported', WAIT_REQ = 'Linked by AI';
const aiNote = (s) => s.aiInfo && (s.aiInfo.note || s.aiInfo.confidence === 'Low') ? `<div class="note ai-note">${s.aiInfo.confidence === 'Low' ? '<span class="chip sev sev-important">Low confidence</span> ' : ''}${esc(s.aiInfo.note || '')}</div>` : '';
const area = (i, f, v, label, ro, ph) => `<textarea class="cell grow${ro ? ' ai-ro' : ''}"${ro ? ' readonly tabindex="0" placeholder="' + ea(ph || '') + '"' : ''} rows="2" data-mi="${i}" data-mf="${ea(f)}" aria-label="${ea(label)}">${esc(v)}</textarea>`;
const fitCell = (t) => { t.style.height = 'auto'; t.style.height = t.scrollHeight + 2 + 'px'; };
/* auto-fit the matrix columns to their content: short columns get just enough width, Scenario and Expected outcome share the rest */
function fitColumns() {
  const t = $('table.mx'); if (!t) return;
  const cols = [...t.querySelectorAll('colgroup col')], ths = [...t.querySelectorAll('thead th')], rows = [...t.querySelectorAll('tbody tr')];
  const FLEX = new Set(ths.map((th, k) => th.dataset.flex ? k : -1).filter((k) => k >= 0)), MIN_FLEX = 240; let fixed = 0;
  ths.forEach((th, i) => {
    if (!cols[i]) return;
    if (i === ths.length - 1) { cols[i].style.width = '44px'; fixed += 44; return; }
    if (FLEX.has(i)) { cols[i].style.width = ''; return; }
    let len = th.textContent.trim().length;
    rows.forEach((tr) => { const c = tr.children[i]; if (!c) return; const el = c.querySelector('input,textarea,select'); const v = el ? (el.tagName === 'SELECT' ? el.options[el.selectedIndex].text : el.value) : c.textContent; len = Math.max(len, String(v || '').length); });
    const w = Math.min(260, Math.max(96, Math.round(len * 7.6) + 34)); cols[i].style.width = w + 'px'; fixed += w;
  });
  t.style.minWidth = fixed + MIN_FLEX * FLEX.size + 'px';
}
const fitCells = () => { fitColumns(); $$('textarea.grow').forEach(fitCell); };
let fitT = null; window.addEventListener('resize', () => { clearTimeout(fitT); fitT = setTimeout(fitCells, 120); });
const cell = (i, f, v, cls, label, ro, ph) => `<input class="cell ${cls || ''}${ro ? ' ai-ro' : ''}"${ro ? ' readonly placeholder="' + ea(ph || '') + '"' : ''} data-mi="${i}" data-mf="${ea(f)}" value="${ea(v)}" aria-label="${ea(label)}">`;
const eRow = (s, i, ex) => `<tr><td>${cell(i, 'id', s.id, 'mono', 'Scenario ID')}</td><td><input class="cell" list="chs" data-mi="${i}" data-mf="ch" value="${ea(s.ch)}" aria-label="Channel"></td><td>${area(i, 'name', s.name || '', 'Name from the source')}</td><td><input class="cell" list="cats" data-mi="${i}" data-mf="cat" value="${ea(s.cat || '')}" aria-label="Category"></td><td><select class="cell" data-mi="${i}" data-mf="kind" aria-label="Type">${(KINDS.includes(s.kind) ? KINDS : [...KINDS, s.kind]).map((k) => `<option ${k === s.kind ? 'selected' : ''}>${esc(k)}</option>`).join('')}</select></td><td><select class="cell" data-mi="${i}" data-mf="prio" aria-label="Priority">${Core.PRIOS.map((p) => `<option ${p === s.prio ? 'selected' : ''}>${p}</option>`).join('')}</select></td><td>${cell(i, 'so', s.so || '', 'mono', 'Payload (file or ID, several allowed)')}</td>${ex.map((h) => `<td>${cell(i, 'x:' + h, (s.extra || {})[h] || '', '', h)}</td>`).join('')}<td>${area(i, 'title', s.title, 'Scenario (generated by AI, read only)', true, WAIT)}${aiNote(s)}</td><td>${cell(i, 'reqs', s.reqs.join(', '), 'mono', 'Requirements (matched by AI, read only)', true, WAIT_REQ)}</td><td>${area(i, 'expect', s.expect, 'Expected outcome (generated by AI, read only)', true, WAIT)}</td><td>${trashBtn('data-mdel', i, 'Delete scenario ' + s.id)}</td></tr>`;
function checksHtml() {
  const f = Core.analyzeMatrix(D.matrix, model());
  const c = ['Conflict', 'Missing', 'Quality'].map((t) => [t, f.filter((x) => x.type === t).length]).filter((x) => x[1]);
  return `<div class="panel-head"><h3>Check against the PRD</h3><div class="chips">${c.length ? c.map(([t, n]) => `<span class="chip">${n} ${t.toLowerCase()}</span>`).join('') : '<span class="note">No conflicts or gaps found.</span>'}</div></div>${f.length ? `<div class="table-wrap"><table><thead><tr><th>Type</th><th>Where</th><th>Finding</th></tr></thead><tbody>${f.map((x) => `<tr><td>${x.type}</td><td class="mono">${esc(x.where)}</td><td>${esc(x.text)}</td></tr>`).join('')}</tbody></table></div>` : ''}<div class="coverage">This check runs by itself. Conflicts disagree with the PRD. Missing means the PRD has something the matrix does not cover. Quality is about the rows. Rows marked Not required are left out.</div>`;
}
const refreshChecks = () => { const s = $('#matrix-summary'); if (s) s.innerHTML = summaryHtml(); const c = $('#matrix-check'); if (c) c.innerHTML = checksHtml(); const v = $('#matrix-cov'); if (v) v.outerHTML = matrixCoverage(D.matrix); drawTabs(); };
function mapForm(headers, map, id) {
  return `<form id="${id}" class="mapgrid" onsubmit="return false">${MAP_FIELDS.map(([f, label]) => `<label class="field"><span>${label}</span><select class="cell" data-mapf="${f}"><option value="">(not in the file)</option>${headers.map((h) => `<option ${map[f] === h ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></label>`).join('')}</form>`;
}
function sourcePanel() {
  const s = D.matrixSrc, wb = (st.workbooks || []);
  const link = store.mode === 'server' ? `<div class="row-actions"><label class="field inline"><span class="note">Linked workbook in the folder</span><select class="cell" data-linksel><option value="">(none)</option>${wb.map((w) => `<option ${s && s.link === w ? 'selected' : ''}>${esc(w)}</option>`).join('')}</select></label><button class="key small" data-act="refresh-link" type="button">Refresh from the linked workbook</button></div>` : '<p class="note">Run server.py to link a workbook in the shared folder and refresh from it.</p>';
  return `<div class="panel"><div class="panel-head"><h3>Matrix source and columns</h3><div class="row-actions"><button class="key small" data-act="import-matrix" type="button">Import Excel or CSV</button><button class="key small" data-act="paste-matrix" type="button">Paste from Excel</button></div></div><div class="panel-body">${st.mapping ? `<div class="callout">The columns in ${esc(st.mapping.name)} were not recognised. Choose which column holds what, then import.</div>${mapForm(st.mapping.headers, st.mapping.map, 'map-form')}<div class="row-actions"><button class="key primary" data-act="apply-pending" type="button">Import with these columns</button><button class="link" data-act="cancel-pending" type="button">Cancel</button></div>` : s && s.raw ? `<p class="note">Columns of ${esc(s.name)}. Change the mapping to read it differently.</p>${mapForm(s.headers, s.map, 'map-form')}<div class="row-actions"><button class="key small" data-act="apply-map" type="button">Apply columns</button></div>` : '<p class="note">Any layout works: map the columns once. Without a file, the matrix is generated.</p>'}${link}<p class="note">SharePoint: sync the library with OneDrive, link the workbook here, press Refresh.</p></div></div>`;
}
function r3() {
  ccSlot(3, 'matrix');
  const p = $('#matrix-panel');
  if (!D.matrix) {
    p.innerHTML = (D.prd.trim() ? gate('No matrix yet. AI proposes scenarios that prove each requirement: happy, edge and negative cases. You can also import one from Excel or CSV, or paste it.', 'gen3', 'Generate scenario matrix') : gate('Write or merge the PRD first. The matrix is checked against it.', 'go1', 'Open the PRD library')) + (st.mapping ? sourcePanel() : '');
    loadWorkbooks(); return;
  }
  const allEx = extraHeaders(), ex = st.showExtra ? allEx : [], pr = ['All', ...Core.PRIOS.filter((x) => D.matrix.some((s) => s.prio === x))];
  if (!pr.includes(st.pr)) st.pr = 'All';
  const rows = D.matrix.map((s, i) => [s, i]).filter(([s]) => (st.ch === 'All' || s.ch === st.ch) && (!st.cat || st.cat === 'All' || (s.cat || '') === st.cat) && (!st.kt || st.kt === 'All' || s.kind === st.kt) && (st.pr === 'All' || s.prio === st.pr));
  p.innerHTML = `<div class="gap">${lrPanel()}${revisePanel()}${payAnalysisPanel('matrix')}${stale(st.matrixHash)}${st.importNote ? `<div class="callout">${esc(st.importNote)}</div>` : ''}
  <div class="panel" id="matrix-summary">${summaryHtml()}</div>
  ${prioRulesPanel()}
  <div class="panel"><div class="panel-head"><h3>Scenarios (${rows.length}${rows.length === D.matrix.length ? '' : ' of ' + D.matrix.length})</h3><div class="row-actions"><span class="note" id="cat-label">Category:</span><select id="cat-filter" data-fsel="cat" aria-label="Category filter"></select><span class="note">Type:</span><div class="subtabs" id="kind-filter" role="group" aria-label="Type filter"></div><span class="note">Channel:</span><select id="ch-filter" data-fsel="ch" aria-label="Channel filter"></select><span class="note">Priority:</span><div class="subtabs" role="group" aria-label="Priority filter">${pr.map((x) => `<button type="button" data-pr="${ea(x)}" aria-pressed="${st.pr === x}">${esc(x)}</button>`).join('')}</div></div></div><div class="table-wrap"><table class="edit mx"><colgroup><col class="c-id"><col class="c-ch"><col class="c-name"><col class="c-cat"><col class="c-kind"><col class="c-prio"><col class="c-so">${ex.map(() => '<col class="c-x">').join('')}<col class="c-wide"><col class="c-req"><col class="c-wide"><col class="c-del"></colgroup><thead><tr><th>ID</th><th>Channel</th><th>Name</th><th>Category</th><th>Type</th><th>Priority</th><th>Payload</th>${ex.map((h) => `<th>${esc(h)}</th>`).join('')}<th data-flex="1">Scenario <span class="chip ai-chip">AI</span></th><th>Requirements <span class="chip ai-chip">AI</span></th><th data-flex="1">Expected outcome <span class="chip ai-chip">AI</span></th><th></th></tr></thead><tbody>${rows.map(([s, i]) => eRow(s, i, ex)).join('')}</tbody></table></div><datalist id="cats">${[...new Set(D.matrix.map((s) => s.cat || '').filter(Boolean))].map((c) => `<option>${esc(c)}</option>`).join('')}</datalist><datalist id="chs">${[...new Set(['All', ...(D.matrix || []).map((s) => s.ch).filter(Boolean)])].map((c) => `<option>${esc(c)}</option>`).join('')}</datalist><div class="panel-body"><div class="row-actions"><button class="key small" data-act="add-scenario" type="button">Add scenario</button>${st.matrixUndo ? '<button class="key small" data-act="undo-import" type="button">Undo import</button>' : ''}<button class="key small" data-act="link-reqs" type="button"${st.lrBusy ? ' disabled' : ''} title="Link scenarios that have no requirement to the requirement IDs">Link requirements with AI</button><button class="key small" data-act="revise-payloads" type="button"${D.payloadImport ? '' : ' disabled title="Import payloads first"'}>Analyze payloads with AI</button>${allEx.length ? `<button class="key small" data-act="toggle-extra" type="button" aria-pressed="${!!st.showExtra}">${st.showExtra ? 'Hide' : 'Show'} source columns (${allEx.length})</button>` : ''}<span class="note">Cells are editable. Changes save by themselves.${allEx.length && !st.showExtra ? ' Other columns from your file are kept and exported, but hidden here.' : ''}</span></div></div>${matrixCoverage(D.matrix)}</div>
  ${reqMapPanel()}
  ${sourcePanel()}
  <div class="panel" id="matrix-check">${checksHtml()}</div>
  </div>`;
  drawFilter(); loadWorkbooks(); fitCells();
}
async function loadWorkbooks() {
  if (store.mode !== 'server' || !D || st.workbooksFor === D.id + ':' + (D.matrixSrc ? D.matrixSrc.name : '')) return;
  try { const t = await (await fetch(`/api/designs/${enc(D.id)}/tree`, { cache: 'no-store' })).json(); st.workbooks = t.filter((f) => /^04-scenario-matrix\/.+\.(xlsx|csv)$/i.test(f.path)).map((f) => f.path.slice(19)); st.workbooksFor = D.id + ':' + (D.matrixSrc ? D.matrixSrc.name : ''); if (current === 3 && D.matrix) { const sp = $('#matrix-panel'); r3(); } } catch (e) { /* no list */ }
}
async function genMatrix() {
  if (st.busy) return;
  if (!D.prd.trim()) { show(3); return; }
  const off = AI_OFF(), reqs = model().reqs;
  const fail = (msg) => { st.busy = false; setBusy(); show(3); const p = $('#matrix-panel'); if (p && !D.matrix) p.innerHTML = `<div class="empty"><p>${esc(msg)}</p><button class="key primary" data-go="gen3" type="button">Try again</button></div>`; else toast(msg); return false; };
  if (off) return fail(off);
  if (!reqs.length) return fail('No requirements were found in the PRD, so there is nothing to build scenarios from. List them as a table with an ID column, or as bullets that start with an ID such as R-01.');
  st.busy = true; setBusy(); st.ch = 'All'; show(3);
  const t0 = Date.now(), BATCH = 8; let batches = [], plan = { categories: [], channels: [] };
  const ids = new Set(reqs.map((r) => r.id)), out = [], seenT = new Set();
  const progress = (t) => { const p = $('#matrix-panel'); if (p) p.innerHTML = `<div class="panel"><div class="panel-body">${aiProgress('Generation in progress: ' + t, 'Grouping the requirements into a few categories, then designing a compact set of scenarios for each. ' + out.length + ' scenarios so far.', t0)}</div></div>${skeleton(5)}`; };
  const chanOf = (c) => { const v = String(c || '').trim(); if (!v || /^all$/i.test(v)) return 'All'; const l = plan.channels.find((x) => x.toLowerCase() === v.toLowerCase()) || plan.channels.find((x) => v.toLowerCase().includes(x.toLowerCase()) || x.toLowerCase().includes(v.toLowerCase())); return l || (plan.channels.length ? 'All' : v); };
  const add = (list, cat) => list.forEach((s) => {
    const rq = [...new Set((Array.isArray(s.reqs) ? s.reqs : []).map((x) => String(x).trim()).filter((x) => ids.has(x)))], title = String(s.title || '').trim(), key = title.toLowerCase() + '|' + rq.join(',');
    if (!title || !rq.length || seenT.has(key)) return; seenT.add(key);
    const kind = KINDS.includes(s.kind) ? s.kind : 'Edge', prio = ['P0', 'P1', 'P2', 'P3'].includes(s.prio) ? s.prio : Core.defaultPrio(kind);
    out.push({ id: 'S-' + String(out.length + 1).padStart(2, '0'), ch: chanOf(s.ch), kind, cat: cat || String(s.category || '').trim(), name: title, title, reqs: rq, expect: String(s.expect || '').trim() || 'To be decided', so: '', prio, extra: {} });
  });
  /* every P0 and P1 scenario is kept; P2 and P3 together are limited to a quarter of the requirements (P2 before P3, success paths first) */
  const lowCap = (n) => Math.max(1, Math.ceil(n * 0.25)), PO = { P0: 0, P1: 1, P2: 2, P3: 3 }, KO = { Happy: 0, Negative: 1, Edge: 2, Gap: 3 };
  const trimTo = (list, max) => { const low = list.filter((x) => x.prio === 'P2' || x.prio === 'P3'); if (low.length <= max) return list; const keep = new Set(low.slice().sort((x, y) => (PO[x.prio] ?? 4) - (PO[y.prio] ?? 4) || (KO[x.kind] ?? 4) - (KO[y.kind] ?? 4)).slice(0, max)); return list.filter((x) => !(x.prio === 'P2' || x.prio === 'P3') || keep.has(x)); };
  const ask = async (list, label, cat) => {
    const max = lowCap(list.length);
    for (let a = 0; ; a++) {
      try { return trimTo((await aiPost('gen-scenarios', { prd: D.prd, reqs: list.map((r) => ({ id: r.id, text: r.text })), known: out.slice(-40).map((s) => `${s.reqs.join('/')}: ${s.title}`).join('\n'), category: cat || '', channels: plan.channels, maxLow: max })).scenarios || [], max); }
      catch (e) { if (a >= 1) throw new Error(`${label} failed: ${e.message || e}`); }
    }
  };
  let model_ = '';
  try {
    progress('Grouping the requirements into categories');
    const pr = await aiPost('scenario-plan', { prd: D.prd, reqs: reqs.map((r) => ({ id: r.id, text: r.text })) });
    plan = { categories: (pr.categories || []).map((x) => String(x).trim()).filter(Boolean), channels: (pr.channels || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 8) };
    const catOf = {}; (pr.groups || []).forEach((g) => { const c = String(g.category || '').trim(); if (c) (g.reqs || []).forEach((id) => { if (ids.has(String(id)) && !catOf[id]) catOf[id] = c; }); });
    /* high-level categories: the AI's own list, without a fixed number; a category with fewer than two requirements is folded into the closest one, and no more than 12 are kept */
    const freq = {}; Object.values(catOf).forEach((c) => { freq[c] = (freq[c] || 0) + 1; });
    let main = [...new Set([...plan.categories, ...Object.keys(freq)])].filter((c) => (freq[c] || 0) >= 2).sort((x, y) => (freq[y] || 0) - (freq[x] || 0)).slice(0, 12);
    if (!main.length) main = Object.keys(freq).sort((x, y) => freq[y] - freq[x]).slice(0, 1); if (!main.length) main = ['General'];
    main = [...plan.categories, ...main].filter((c, k, all) => main.includes(c) && all.indexOf(c) === k);
    const words = (t) => new Set(String(t).toLowerCase().match(/[a-z]{4,}/g) || []);
    const mainWords = main.map((m) => words(m + ' ' + reqs.filter((x) => catOf[x.id] === m).map((x) => x.text).join(' ')));
    reqs.forEach((r) => { const c = catOf[r.id]; if (c && !main.includes(c)) { const rw = words(r.text + ' ' + c); let best = 0, top = -1; main.forEach((m, k) => { let n = 0; rw.forEach((w) => { if (mainWords[k].has(w)) n++; }); if (n > top) { top = n; best = k; } }); catOf[r.id] = main[best]; } });
    const names = main; plan.categories = names;
    const fallback = names[0] || 'General';
    reqs.forEach((r) => { if (!catOf[r.id]) catOf[r.id] = fallback; });
    const byCat = {}; reqs.forEach((r) => { (byCat[catOf[r.id]] = byCat[catOf[r.id]] || []).push(r); });
    Object.entries(byCat).forEach(([cat, list]) => { for (let i = 0; i < list.length; i += BATCH) batches.push({ cat, list: list.slice(i, i + BATCH) }); });
    for (let i = 0; i < batches.length; i++) { const b = batches[i]; progress(`${b.cat} (${i + 1} of ${batches.length}): ${b.list.map((r) => r.id).slice(0, 4).join(', ')}${b.list.length > 4 ? ', ...' : ''}`); add(await ask(b.list, `${b.cat}, batch ${i + 1} of ${batches.length}`, b.cat), b.cat); }
    const miss = reqs.filter((r) => !out.some((s) => s.reqs.includes(r.id)));
    if (miss.length) { const grp = {}; miss.forEach((r) => { (grp[catOf[r.id]] = grp[catOf[r.id]] || []).push(r); }); for (const [cat, list] of Object.entries(grp)) { progress(`Coverage pass for ${list.map((r) => r.id).join(', ')}`); add(await ask(list, 'The coverage pass', cat), cat); } }
  } catch (e) { return fail('Scenario generation stopped. Nothing was saved. ' + (e.message || e)); }
  if (!out.length) return fail('The AI returned no usable scenarios. Nothing was saved.');
  const still = reqs.filter((r) => !out.some((s) => s.reqs.includes(r.id))).map((r) => r.id);
  D.matrix = plainRows(out); D.matrixSrc = null; D.matrixGen = { at: Date.now(), model: store._lastModel || aiModelFor('gen-scenarios'), batches: batches.length, categories: plan.categories.length };
  st.matrixUndo = null; st.importNote = `Generated by ${store._lastModel || aiModelFor('gen-scenarios')} from the PRD: ${out.length} scenarios for ${reqs.length - still.length} of ${reqs.length} requirements.${still.length ? ' No scenario was produced for ' + still.join(', ') + '. Add them by hand or generate again.' : ''}`;
  st.matrix = true; st.matrixHash = prdHash(); st.matrixDirty = true; st.busy = false; linkPayloads(); setBusy(); drawTabs(); flush(); r3();
  return true;
}
function exportXlsx() {
  if (!D.matrix) return toast('Generate or import the scenario matrix first');
  download(slug(D.name) + '-scenario-matrix.xlsx', Core.xlsx(Core.matrixSheets(D.matrix, model().reqs)), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
function commitMatrix(rows, name, map, link) {
  const sheet = Core.readMatrixSheet(rows), r = Core.applyMatrixMap(sheet, map);
  if (!r.rows.length) throw new Error('The sheet has a header but no scenarios.');
  st.matrixUndo = { rows: D.matrix, had: st.matrix, src: D.matrixSrc };
  const prev = Object.fromEntries((D.matrix || []).map((x) => [x.id, x]));
  r.rows.forEach((x) => { const o = prev[x.id]; if (o && !x.title && !x.expect && !x.reqs.length) { x.title = o.title || ''; x.expect = o.expect || ''; x.reqs = [...(o.reqs || [])]; if (o.aiInfo) x.aiInfo = o.aiInfo; } });
  D.matrix = r.rows; D.matrixSrc = { name, at: Date.now(), headers: sheet.headers, map, raw: rows.length <= 2000 ? rows : null, link: link || (D.matrixSrc && D.matrixSrc.name === name ? D.matrixSrc.link : '') || '' };
  st.matrix = true; st.matrixHash = prdHash(); st.ch = 'All'; st.cat = 'All'; st.kt = 'All'; st.pr = 'All'; st.matrixDirty = true; st.mapping = null; linkPayloads();
  st.importNote = `Read ${r.rows.length} scenarios from ${name}.${r.warnings.length ? ' ' + [...new Set(r.warnings)].join(' ') : ''} The summary and the check below compare them with the PRD.`;
  return r;
}
async function importMatrixRows(rows, name, link) {
  if (!D.prd.trim()) return toast('Add a PRD first. The matrix is checked against it.');
  try {
    const sheet = Core.readMatrixSheet(rows), map = (D.matrixSrc && D.matrixSrc.name === name && D.matrixSrc.map && D.matrixSrc.map.name && D.matrixSrc.map) || sheet.auto;
    if (!map.name && !map.id) { st.mapping = { name, headers: sheet.headers, map: sheet.auto, rows, link }; r3(); return toast('No Name or Scenario ID column was recognised. Choose the key column below.'); }
    commitMatrix(rows, name, map, link);
    await flush(); show(3, false); toast('Matrix read and checked');
  } catch (e) { toast('Import failed: ' + (e.message || e)); }
}
async function importMatrix(file) {
  try {
    let rows;
    if (/\.csv$/i.test(file.name)) rows = Core.parseCsv(await file.text());
    else { const buf = await file.arrayBuffer(); const x = await Core.readXlsx(buf); rows = (x.sheets.find((s) => /scenario/i.test(s.name)) || x.sheets[0]).rows; if (store.mode === 'server') put('04-scenario-matrix/imported/' + file.name, new Uint8Array(buf)); }
    await importMatrixRows(rows, file.name, store.mode === 'server' && !/\.csv$/i.test(file.name) ? 'imported/' + file.name : '');
  } catch (e) { toast('Import failed: ' + (e.message || e)); }
}
async function pasteMatrix() {
  try { const t = await navigator.clipboard.readText(); if (!t.trim()) return toast('The clipboard is empty'); await importMatrixRows(Core.parseCsv(t, /\t/.test(t.split('\n')[0]) ? '\t' : ','), 'Pasted table', ''); }
  catch (e) { toast('Clipboard access is blocked in this view.'); }
}
const aiKeep = (m) => { const o = {}; ['title', 'expect', 'reqs'].forEach((k) => { if (m && m[k]) o[k] = m[k]; }); return o; };
async function applyMapping(manual) {
  if (!D.matrixSrc || !D.matrixSrc.raw) return;
  try {
    const m = { ...aiKeep(D.matrixSrc.map), ...readMap('map-form') };
    commitMatrix(D.matrixSrc.raw, D.matrixSrc.name, m, D.matrixSrc.link); await flush(); show(3, false);
    const withPay = D.matrix.filter((s) => (s.so || '').trim()).length;
    toast(`Columns applied: ${D.matrix.length} scenarios, ${withPay} with a Payload${m.so ? ` (from "${m.so}")` : ''}`);
  } catch (e) { toast(e.message || String(e)); }
}
function readMap(id) { const m = {}; $$(`#${id} [data-mapf]`).forEach((s) => { m[s.dataset.mapf] = s.value; }); return m; }
async function refreshLink() {
  const s = D.matrixSrc, link = s && s.link; if (!link) return toast('Choose a linked workbook first');
  try {
    const url = artUrl('04-scenario-matrix/' + link), isCsv = /\.csv$/i.test(link); let rows;
    if (isCsv) rows = Core.parseCsv(await (await fetch(url, { cache: 'no-store' })).text());
    else { const x = await Core.readXlsx(new Uint8Array(await (await fetch(url, { cache: 'no-store' })).arrayBuffer())); rows = (x.sheets.find((q) => /scenario/i.test(q.name)) || x.sheets[0]).rows; }
    commitMatrix(rows, link.split('/').pop(), s.map, link); await flush(); show(3, false); toast('Read again from ' + link);
  } catch (e) { toast('The linked workbook could not be read: ' + (e.message || e)); }
}
function addScenario() {
  if (!D.matrix) D.matrix = derivedRows();
  let n = D.matrix.length; const ids = new Set(D.matrix.map((s) => s.id)); do { n++; } while (ids.has('S-' + String(n).padStart(2, '0')));
  D.matrix.push({ id: 'S-' + String(n).padStart(2, '0'), ch: 'All', kind: 'Happy', cat: '', name: '', title: '', reqs: [], expect: '', so: '', prio: 'P1', extra: {} });
  st.matrix = true; st.matrixDirty = true; saveSoon(); r3();
}

/* ---------- diagram renderer (draws Mermaid flowchart source as SVG, no library needed) ---------- */
let flowN = 0;
function parseFlow(src) {
  const nodes = {}, edges = [], lanes = [], stack = []; let cur = null, laneN = 0;
  const clean = (t) => String(t).trim().replace(/^"|"$/g, '').replace(/<br\s*\/?>/gi, ' ').replace(/#quot;|&quot;/g, '"').replace(/\s+/g, ' ').trim();
  /* a node: id plus an optional shape. Groups: 2 ((( end ))), 3 ([ stadium ]), 4 (( event )), 5 [( db )], 6 [[ sub ]], 7 {{ hex }}, 8 { decision }, 9-10 [/ slanted /], 11 ( round ), 12 [ box ] */
  const nodeRe = /\s*([A-Za-z_][A-Za-z0-9_]*)(?:\(\(\((.*?)\)\)\)|\(\[(.*?)\]\)|\(\((.*?)\)\)|\[\((.*?)\)\]|\[\[(.*?)\]\]|\{\{(.*?)\}\}|\{(.*?)\}|\[\/(.*?)\/\]|\[\\(.*?)\\\]|\((.*?)\)|\[(.*?)\])?(?::::[A-Za-z0-9_]+)?/y;
  const labelledRe = /\s*(?:--|==|-\.)\s+([^>|&]*?)\s+(?:-->|==>|\.->|---|--x|--o)(?:\|[^|]*\|)?/y;
  const arrowRe = /\s*(?:<?--+>|<?-{3,}|-\.+->|-\.+-|==+>|={3,}|--[xo]|~~~)(?:\|([^|]*)\|)?/y;
  const ampRe = /\s*&/y;
  const SKIP = /^(flowchart|graph|classDef|class|style|linkStyle|click|direction|accTitle|accDescr|title|%%|---|config)\b|^%%/;
  for (let line of src.split('\n')) {
    line = line.trim().replace(/;$/, '').trim();
    if (!line || SKIP.test(line)) continue;
    let m;
    if ((m = line.match(/^subgraph\b\s*(.*)$/))) {
      let rest = m[1].trim(), id = '', title = '', t;
      if ((t = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\[\s*"?(.*?)"?\s*\]\s*$/))) { id = t[1]; title = t[2]; }
      else if ((t = rest.match(/^"(.*)"$/))) title = t[1];
      else if ((t = rest.match(/^([A-Za-z_][A-Za-z0-9_]*)$/))) { id = t[1]; title = t[1]; }
      else title = rest;
      cur = { id: id || 'lane' + (++laneN), title: clean(title) }; lanes.push(cur); stack.push(cur); continue;
    }
    if (line === 'end') { stack.pop(); cur = stack.length ? stack[stack.length - 1] : null; continue; }
    let pos = 0, prev = null, label = null;
    while (pos < line.length) {
      const group = [];
      for (;;) {
        nodeRe.lastIndex = pos; const nm = nodeRe.exec(line); if (!nm) break;
        pos = nodeRe.lastIndex;
        const id = nm[1]; let shape = null, text = null;
        if (nm[2] !== undefined) { shape = 'end'; text = nm[2]; } else if (nm[4] !== undefined) { shape = 'event'; text = nm[4]; } else if (nm[8] !== undefined) { shape = 'gate'; text = nm[8]; }
        else { const k = [3, 5, 6, 7, 9, 10, 11, 12].find((j) => nm[j] !== undefined); if (k) { shape = 'rect'; text = nm[k]; } }
        let n = nodes[id];
        if (!n) n = nodes[id] = { id, text: id, shape: 'rect', lane: null, order: Object.keys(nodes).length };
        if (text !== null) { n.text = clean(text); n.shape = shape; }
        if (cur && n.lane === null) n.lane = cur.id;
        group.push(id);
        ampRe.lastIndex = pos; if (ampRe.test(line)) { pos = ampRe.lastIndex; continue; }
        break;
      }
      if (!group.length) break;
      if (prev) prev.forEach((a) => group.forEach((b) => edges.push({ a, b, label })));
      prev = group; label = null;
      labelledRe.lastIndex = pos; let am = labelledRe.exec(line);
      if (am) { pos = labelledRe.lastIndex; label = clean(am[1]); continue; }
      arrowRe.lastIndex = pos; am = arrowRe.exec(line);
      if (am) { pos = arrowRe.lastIndex; label = am[1] ? clean(am[1]) : null; } else break;
    }
  }
  return { nodes, edges, lanes };
}
const wrapText = (t, max) => { const out = []; let l = ''; t.split(/\s+/).forEach((w) => { if ((l + ' ' + w).trim().length > max && l) { out.push(l); l = w; } else l = (l + ' ' + w).trim(); }); if (l) out.push(l); return out; };
const laneFill = (t) => /customer|store|agent|business/i.test(t) ? 'var(--lane-purple)' : /front|shopify|narvar|portal/i.test(t) ? 'var(--lane-green)' : /middleware|integration/i.test(t) ? 'var(--lane-blue)' : /warehouse|3pl/i.test(t) ? 'var(--lane-grey)' : /d365|erp/i.test(t) ? 'var(--lane-yellow)' : 'var(--color-paper-2)';
function renderFlow(src) {
  const g = parseFlow(src), ids = Object.keys(g.nodes);
  if (!ids.length) throw new Error('No nodes found in the diagram source');
  /* ranks, ignoring back edges */
  const adj = {}, indeg = {}; ids.forEach((i) => { adj[i] = []; indeg[i] = 0; });
  g.edges.forEach((e, i) => { adj[e.a].push([e.b, i]); indeg[e.b]++; });
  const state = {}, back = new Set(), post = [];
  const dfs = (u) => { state[u] = 1; adj[u].forEach(([v, i]) => { if (state[v] === 1) back.add(i); else if (!state[v]) dfs(v); }); state[u] = 2; post.push(u); };
  ids.filter((i) => !indeg[i]).concat(ids).forEach((i) => { if (!state[i]) dfs(i); });
  const rank = {}; ids.forEach((i) => { rank[i] = 0; });
  post.slice().reverse().forEach((u) => adj[u].forEach(([v, i]) => { if (!back.has(i)) rank[v] = Math.max(rank[v], rank[u] + 1); }));
  /* sizes */
  ids.forEach((i) => {
    const n = g.nodes[i];
    if (n.shape === 'event' || n.shape === 'end') { n.lines = wrapText(n.text, 16); n.sw = 38; n.sh = 38; n.w = Math.max(n.sw, Math.max(...n.lines.map((x) => x.length)) * 6.8 + 8); n.h = n.sh + n.lines.length * 15 + 8; }
    else if (n.shape === 'gate') { n.lines = wrapText(n.text, 12); n.sw = Math.max(150, Math.max(...n.lines.map((x) => x.length)) * 7.4 + 60); n.sh = n.lines.length * 16 + 46; n.w = n.sw; n.h = n.sh; }
    else { n.lines = wrapText(n.text, 20); n.sw = Math.max(124, Math.max(...n.lines.map((x) => x.length)) * 7.2 + 28); n.sh = n.lines.length * 17 + 22; n.w = n.sw; n.h = n.sh; }
  });
  /* lanes */
  const lanes = g.lanes.map((l) => ({ ...l }));
  if (ids.some((i) => g.nodes[i].lane === null)) { const hasTitles = lanes.length > 0; lanes.push({ id: '_', title: hasTitles ? 'Other' : '' }); ids.forEach((i) => { if (g.nodes[i].lane === null) g.nodes[i].lane = '_'; }); }
    /* order the boxes inside each lane and column so that fewer lines cross: barycenter sweeps forward and back */
  const laneIdx = {}; lanes.forEach((l, i) => { laneIdx[l.id] = i; });
  const preds = {}, succs = {}; ids.forEach((i) => { preds[i] = []; succs[i] = []; });
  g.edges.forEach((e, k) => { if (!back.has(k)) { preds[e.b].push(e.a); succs[e.a].push(e.b); } });
  const cell = (r, l) => ids.filter((i) => rank[i] === r && g.nodes[i].lane === l.id);
  for (let r = 0; r <= Math.max(...ids.map((i) => rank[i])); r++) lanes.forEach((l) => cell(r, l).sort((a, b) => g.nodes[a].order - g.nodes[b].order).forEach((i, idx) => { g.nodes[i].ord = idx * 40; }));
  const yOf = (i) => laneIdx[g.nodes[i].lane] * 1000 + g.nodes[i].ord;
  const sweep = (r, nb) => lanes.forEach((l) => {
    const c = cell(r, l); if (c.length < 2) return;
    const key = {}; c.forEach((i) => { key[i] = nb[i].length ? nb[i].reduce((s, j) => s + yOf(j), 0) / nb[i].length : yOf(i); });
    c.sort((a, b) => key[a] - key[b] || g.nodes[a].ord - g.nodes[b].ord).forEach((i, idx) => { g.nodes[i].ord = idx * 40; });
  });
  const topRank = Math.max(...ids.map((i) => rank[i]));
  for (let pass = 0; pass < 4; pass++) { for (let r = 1; r <= topRank; r++) sweep(r, preds); for (let r = topRank - 1; r >= 0; r--) sweep(r, succs); }
  const titled = lanes.some((l) => l.title);
  const maxRank = Math.max(...ids.map((i) => rank[i]));
  const colW = []; for (let r = 0; r <= maxRank; r++) colW[r] = Math.max(0, ...ids.filter((i) => rank[i] === r).map((i) => g.nodes[i].w));
  const GAP = 56, LB = titled ? 36 : 0, X0 = LB + 28;
  const colX = []; let x = X0; for (let r = 0; r <= maxRank; r++) { colX[r] = x + colW[r] / 2; x += colW[r] + GAP; }
  const W = x - GAP + 28;
  let y = 12; const laneBox = {};
  lanes.forEach((l) => {
    const mem = ids.filter((i) => g.nodes[i].lane === l.id);
    let need = 0;
    for (let r = 0; r <= maxRank; r++) { const c = mem.filter((i) => rank[i] === r); if (c.length) need = Math.max(need, c.reduce((a, i) => a + g.nodes[i].h, 0) + (c.length - 1) * 18); }
    const hasBack = g.edges.some((e, k) => back.has(k) && g.nodes[e.a].lane === l.id);
    const H = Math.max(96, need + 44 + (hasBack ? 30 : 0));
    laneBox[l.id] = { y, H, top: y }; 
    for (let r = 0; r <= maxRank; r++) {
      const c = mem.filter((i) => rank[i] === r).sort((a, b) => g.nodes[a].ord - g.nodes[b].ord);
      if (!c.length) continue;
      const tot = c.reduce((a, i) => a + g.nodes[i].h, 0) + (c.length - 1) * 18;
      let yy = y + (H - (hasBack ? 30 : 0) - tot) / 2;
      c.forEach((i) => { const n = g.nodes[i]; n.x = colX[r]; n.y = yy + n.sh / 2; yy += n.h + 18; });
    }
    y += H + (titled ? 8 : 0);
  });
  const Ht = y + 8;
  const id = 'fl' + (++flowN);
  const font = 'font-family:var(--font-body);font-size:13px';
  let s = `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Process diagram" width="${Math.ceil(W)}" height="${Math.ceil(Ht)}" viewBox="0 0 ${Math.ceil(W)} ${Math.ceil(Ht)}" style="max-width:none;${font}"><defs><marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" style="fill:var(--color-ink-2)"/></marker></defs>`;
  if (titled) lanes.forEach((l) => { const b = laneBox[l.id]; s += `<rect x="0.5" y="${b.y}" width="${W - 1}" height="${b.H}" rx="4" style="fill:${laneFill(l.title)};stroke:var(--color-rule-2)"/><rect x="0.5" y="${b.y}" width="${LB}" height="${b.H}" rx="4" style="fill:var(--color-paper-3);stroke:var(--color-rule-2)"/><text transform="translate(${LB / 2 + 5} ${b.y + b.H / 2}) rotate(-90)" text-anchor="middle" style="fill:var(--color-ink-2);font-weight:500">${esc(l.title)}</text>`; });
  /* elbow routing. Each line leaves its box horizontally, runs vertically in the gap before the target column and enters horizontally.
     Lines that enter the same column are given vertical tracks in the order that crosses the fewest other lines; a crossing that cannot be avoided is drawn as a bridge (a small hop) over the other line. */
  const roundPath = (pts, r, hops) => {
    const n = pts.length, rad = pts.map((p, i) => (i === 0 || i === n - 1) ? 0 : Math.min(r, Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) / 2, Math.hypot(pts[i + 1][0] - p[0], pts[i + 1][1] - p[1]) / 2));
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < n - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1], l = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / l, uy = (by - ay) / l;
      const sx = ax + ux * rad[i], ex = bx - ux * rad[i + 1], ey = by - uy * rad[i + 1];
      if (ay === by && hops && hops[i]) hops[i].filter((x) => x > Math.min(sx, ex) + 7 && x < Math.max(sx, ex) - 7).sort((p, q) => (ux > 0 ? p - q : q - p)).forEach((x) => { d += ` L${x - ux * 5} ${ay} A5 5 0 0 ${ux > 0 ? 1 : 0} ${x + ux * 5} ${ay}`; });
      d += ` L${ex} ${ey}`;
      if (i + 1 < n - 1) { const [cx, cy] = pts[i + 1], [nx, ny] = pts[i + 2], l2 = Math.hypot(nx - cx, ny - cy) || 1; d += ` Q${cx} ${cy} ${cx + (nx - cx) / l2 * rad[i + 1]} ${cy + (ny - cy) / l2 * rad[i + 1]}`; }
    }
    return d;
  };
  const segsOf = (pts) => pts.slice(1).map((p, i) => ({ x1: pts[i][0], y1: pts[i][1], x2: p[0], y2: p[1], i, h: Math.abs(p[1] - pts[i][1]) < 0.5 }));
  const crossAt = (h, v) => { const lo = Math.min(h.x1, h.x2), hi = Math.max(h.x1, h.x2), vlo = Math.min(v.y1, v.y2), vhi = Math.max(v.y1, v.y2); return !v.h && h.h && v.x1 > lo + 1 && v.x1 < hi - 1 && h.y1 > vlo + 1 && h.y1 < vhi - 1; };
  const shares = (e1, e2) => e1.a === e2.a || e1.b === e2.b || e1.a === e2.b || e1.b === e2.a;
  const countCross = (lines) => { let c = 0; for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) { if (shares(lines[i].e, lines[j].e)) continue; const A = segsOf(lines[i].pts), B = segsOf(lines[j].pts); A.forEach((x) => B.forEach((y) => { if (crossAt(x, y) || crossAt(y, x)) c++; })); } return c; };
  const permutations = (n) => { const out = []; const go = (cur, left) => { if (!left.length) { out.push(cur); return; } left.forEach((x, i) => go(cur.concat(x), left.filter((_, j) => j !== i))); }; go([], [...Array(n).keys()]); return out; };
  const hh = (n) => n.sh / 2, trackX = {};
  const fwdPts = (e, vx) => { const a = g.nodes[e.a], b = g.nodes[e.b], sx = a.x + a.sw / 2, sy = a.y, ex = b.x - b.sw / 2, ey = b.y; if (Math.abs(sy - ey) < 1) return [[sx, sy], [ex, ey]]; let x = vx; if (x < sx + 8 || x > ex - 8) x = (sx + ex) / 2; return [[sx, sy], [x, sy], [x, ey], [ex, ey]]; };
  const byTarget = {}; g.edges.forEach((e, k) => { if (!back.has(k)) (byTarget[rank[e.b]] = byTarget[rank[e.b]] || []).push(k); });
  Object.entries(byTarget).forEach(([r, ks]) => {
    const srcs = [...new Set(ks.map((k) => g.edges[k].a))].sort((p, q) => g.nodes[p].y - g.nodes[q].y), n = srcs.length;
    const base = colX[r] - colW[r] / 2 - GAP / 2, step = n > 1 ? Math.min(9, 30 / (n - 1)) : 0, slots = srcs.map((_, i) => (i - (n - 1) / 2) * step);
    let best = srcs.map((_, i) => i), bestC = Infinity;
    (n > 1 && n <= 6 ? permutations(n) : [best]).forEach((perm) => {
      const c = countCross(ks.map((k) => ({ e: g.edges[k], pts: fwdPts(g.edges[k], base + slots[perm[srcs.indexOf(g.edges[k].a)]]) })));
      if (c < bestC) { bestC = c; best = perm; }
    });
    ks.forEach((k) => { trackX[k] = base + slots[best[srcs.indexOf(g.edges[k].a)]]; });
  });
  const boxes = ids.map((i) => { const n = g.nodes[i]; return { id: i, x1: n.x - n.sw / 2 - 2, x2: n.x + n.sw / 2 + 2, y1: n.y - n.sh / 2 - 2, y2: n.y + n.sh / 2 + 2 }; });
  const segHits = (pts, e) => { let c = 0; segsOf(pts).forEach((sg) => boxes.forEach((b) => { if (b.id === e.a || b.id === e.b) return; const x1 = Math.min(sg.x1, sg.x2), x2 = Math.max(sg.x1, sg.x2), y1 = Math.min(sg.y1, sg.y2), y2 = Math.max(sg.y1, sg.y2); if (x2 > b.x1 && x1 < b.x2 && y2 > b.y1 && y1 < b.y2) c++; })); return c; };
  const early = {}; ids.forEach((i) => { g.edges.map((e, k) => k).filter((k) => !back.has(k) && g.edges[k].a === i).sort((p, q) => g.nodes[g.edges[p].b].y - g.nodes[g.edges[q].b].y).forEach((k, idx) => { early[k] = g.nodes[i].x + g.nodes[i].sw / 2 + 14 + idx * 7; }); });
  const routes = g.edges.map((e, k) => {
    const a = g.nodes[e.a], b = g.nodes[e.b];
    if (back.has(k)) { const yb = laneBox[a.lane].y + laneBox[a.lane].H - 14; return { e, back: true, pts: [[a.x, a.y + hh(a)], [a.x, yb], [b.x, yb], [b.x, b.y + hh(b)]] }; }
    let pts = fwdPts(e, trackX[k]);
    /* a line that would run through another box takes its vertical track next to its own box instead */
    if (pts.length > 2 && segHits(pts, e) > 0) { const alt = fwdPts(e, early[k]); if (segHits(alt, e) < segHits(pts, e)) pts = alt; }
    return { e, pts };
  });
  /* labels: the first free spot beside the line that touches no box and no other label */
  const placed = [];
  routes.forEach((R) => {
    if (!R.e.label) return;
    const w = R.e.label.length * 7 + 10, p = R.pts, c = [];
    if (R.back) c.push([(p[1][0] + p[2][0]) / 2, p[1][1]]);
    else if (p.length === 4) { const vx = p[1][0], sy = p[0][1], ex = p[3][0], ey = p[3][1], sg = Math.sign(ey - sy) || 1; c.push([vx, sy + sg * 20], [vx, ey - sg * 20], [(vx + ex) / 2, ey], [vx, (sy + ey) / 2], [(p[0][0] + vx) / 2, sy]); }
    else c.push([(p[0][0] + p[1][0]) / 2, p[0][1]]);
    const free = ([x, y]) => { const r = { x1: x - w / 2, x2: x + w / 2, y1: y - 9, y2: y + 9 }, hit = (q) => r.x2 > q.x1 && r.x1 < q.x2 && r.y2 > q.y1 && r.y1 < q.y2; return !placed.some(hit) && !boxes.some(hit); };
    const at = c.find(free) || c[0]; R.lx = at[0]; R.ly = at[1]; placed.push({ x1: at[0] - w / 2, x2: at[0] + w / 2, y1: at[1] - 9, y2: at[1] + 9 });
  });
  const hops = routes.map(() => ({}));
  routes.forEach((R1, i) => routes.forEach((R2, j) => { if (i === j || shares(R1.e, R2.e)) return; const A = segsOf(R1.pts), B = segsOf(R2.pts); A.forEach((x) => B.forEach((y) => { if (crossAt(x, y)) (hops[i][x.i] = hops[i][x.i] || []).push(y.x1); })); }));
  /* edges first, so nodes sit on top */
  routes.forEach((R, k) => {
    const e = R.e;
    s += `<path d="${roundPath(R.pts, 8, hops[k])}" fill="none" style="stroke:var(--color-ink-2)" stroke-width="1.5" marker-end="url(#${id})"/>`;
    if (e.label) { const w = e.label.length * 7 + 10; s += `<rect x="${R.lx - w / 2}" y="${R.ly - 9}" width="${w}" height="18" rx="3" style="fill:var(--color-paper);stroke:var(--color-rule-2)"/><text x="${R.lx}" y="${R.ly + 4}" text-anchor="middle" style="fill:var(--color-ink)">${esc(e.label)}</text>`; }
  });
  ids.forEach((i) => {
    const n = g.nodes[i]; const tl = (lines, cx, cy) => lines.map((t, j) => `<tspan x="${cx}" y="${cy + (j - (lines.length - 1) / 2) * 16 + 4}">${esc(t)}</tspan>`).join('');
    if (n.shape === 'event' || n.shape === 'end') {
      const sw = n.shape === 'end' ? 4 : 2;
      s += `<circle cx="${n.x}" cy="${n.y}" r="${n.sw / 2 - sw / 2}" style="fill:var(--color-paper);stroke:var(--color-ink)" stroke-width="${sw}"/><text text-anchor="middle" style="fill:var(--color-ink)">${n.lines.map((t, j) => `<tspan x="${n.x}" y="${n.y + n.sh / 2 + 16 + j * 15}">${esc(t)}</tspan>`).join('')}</text>`;
    } else if (n.shape === 'gate') {
      const hw = n.sw / 2, h2 = n.sh / 2;
      s += `<polygon points="${n.x},${n.y - h2} ${n.x + hw},${n.y} ${n.x},${n.y + h2} ${n.x - hw},${n.y}" style="fill:var(--color-paper);stroke:var(--color-accent-deep)" stroke-width="2"/><text text-anchor="middle" style="fill:var(--color-ink)">${tl(n.lines, n.x, n.y)}</text>`;
    } else {
      s += `<rect x="${n.x - n.sw / 2}" y="${n.y - n.sh / 2}" width="${n.sw}" height="${n.sh}" rx="6" style="fill:var(--color-accent-wash);stroke:var(--color-accent)" stroke-width="1.5"/><text text-anchor="middle" style="fill:var(--color-ink)">${tl(n.lines, n.x, n.y)}</text>`;
    }
  });
  return s + '</svg>';
}
/* ---------- diagram viewer: drag to pan, zoom (buttons, Ctrl or Cmd + scroll, keys + - 0), fit, full screen, copy source, download SVG and PNG.
   The swimlane drawing is unchanged; this only wraps the drawn SVG. ---------- */
const DV_MIN = 0.2, DV_MAX = 4;
const svgBox = (svg) => { const vb = (svg.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number); return vb.length === 4 && vb[2] ? { w: vb[2], h: vb[3] } : { w: +svg.getAttribute('width') || 600, h: +svg.getAttribute('height') || 300 }; };
function dvSet(box, k, keep) {
  const s = box._dv, view = box._view, old = s.k;
  k = Math.min(DV_MAX, Math.max(DV_MIN, k));
  let ox = 0, oy = 0;
  if (keep) { ox = (view.scrollLeft + keep.x) / old; oy = (view.scrollTop + keep.y) / old; }
  s.k = k; s.svg.style.width = s.w * k + 'px'; s.svg.style.height = s.h * k + 'px';
  if (!box.classList.contains('dv-full')) view.style.height = Math.round(Math.min(Math.max(s.h * k + 28, 180), window.innerHeight * 0.72)) + 'px';
  if (keep) { view.scrollLeft = ox * k - keep.x; view.scrollTop = oy * k - keep.y; }
  const pct = box.querySelector('.dv-pct'); if (pct) pct.textContent = Math.round(k * 100) + '%';
}
function dvFit(box) {
  const s = box._dv, view = box._view, full = box.classList.contains('dv-full');
  const kw = (view.clientWidth - 28) / s.w, kh = full ? (view.clientHeight - 28) / s.h : Infinity;
  dvSet(box, Math.min(full ? 1.5 : 1, kw, kh)); view.scrollLeft = 0; view.scrollTop = 0;
}
const dvCenter = (box) => ({ x: box._view.clientWidth / 2, y: box._view.clientHeight / 2 });
function dvSvgText(svg) {
  const c = svg.cloneNode(true), root = getComputedStyle(document.documentElement), { w, h } = svgBox(svg);
  const fix = (v) => String(v || '').replace(/var\((--[\w-]+)\)/g, (_, n) => root.getPropertyValue(n).trim() || '#000');
  c.querySelectorAll('[style]').forEach((e) => e.setAttribute('style', fix(e.getAttribute('style'))));
  c.setAttribute('style', fix(c.getAttribute('style')).replace(/width:[^;]*;?|height:[^;]*;?/g, ''));
  c.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); c.setAttribute('width', w); c.setAttribute('height', h);
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', root.getPropertyValue('--color-paper').trim() || '#fff');
  c.insertBefore(bg, c.firstChild);
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(c);
}
function dvDownload(box, kind) {
  const svg = box._dv.svg, name = (box.dataset.name || 'diagram').replace(/[^\w-]+/g, '-'), text = dvSvgText(svg);
  if (kind === 'svg') return download(name + '.svg', text, 'image/svg+xml');
  const { w, h } = svgBox(svg), img = new Image(), url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  img.onload = () => { const cv = document.createElement('canvas'); cv.width = w * 2; cv.height = h * 2; const x = cv.getContext('2d'); x.scale(2, 2); x.drawImage(img, 0, 0, w, h); URL.revokeObjectURL(url); cv.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name + '.png'; a.click(); }, 'image/png'); };
  img.onerror = () => { URL.revokeObjectURL(url); toast('The PNG could not be made. Use SVG.'); };
  img.src = url;
}
const DV_BAR = '<button type="button" class="key small" data-dv="out" aria-label="Zoom out" title="Zoom out (-)">&minus;</button><button type="button" class="dv-pct key small" data-dv="one" aria-label="Reset to 100 percent" title="Reset to 100% (0)">100%</button><button type="button" class="key small" data-dv="in" aria-label="Zoom in" title="Zoom in (+)">+</button><button type="button" class="key small" data-dv="fit" aria-label="Fit to the window" title="Fit (F)">Fit</button><button type="button" class="key small" data-dv="full" aria-label="Full screen" title="Full screen">Full screen</button><button type="button" class="key small" data-dv="copy" aria-label="Copy the Mermaid source" title="Copy the Mermaid source">Copy</button><button type="button" class="key small" data-dv="svg" aria-label="Download as SVG" title="Download SVG">SVG</button><button type="button" class="key small" data-dv="png" aria-label="Download as PNG" title="Download PNG">PNG</button><button type="button" class="key small" data-dv="mmd" aria-label="Show with the official Mermaid layout" title="Show with the official Mermaid layout (loads the Mermaid library)">Mermaid</button>';
function dvBuild(box, svg, full) {
  box.classList.add('dv'); box.classList.remove('fit'); if (full) box.classList.add('dv-full');
  const view = document.createElement('div'); view.className = 'dv-view'; view.tabIndex = 0; view.setAttribute('role', 'group'); view.setAttribute('aria-label', 'Diagram. Drag to move, Ctrl or Cmd with the scroll wheel to zoom, keys plus, minus, 0 and F.');
  const bar = document.createElement('div'); bar.className = 'dv-bar'; bar.innerHTML = DV_BAR + (full ? '<button type="button" class="key small" data-dv="close" aria-label="Close full screen" title="Close (Esc)">Close</button>' : '');
  if (!box.dataset.src) { bar.querySelector('[data-dv="copy"]').remove(); bar.querySelector('[data-dv="mmd"]').remove(); }
  else if (box.dataset.engine === 'mermaid') bar.querySelector('[data-dv="mmd"]').remove();
  view.appendChild(svg); box.textContent = ''; box.appendChild(bar); box.appendChild(view);
  const { w, h } = svgBox(svg); svg.style.maxWidth = 'none'; svg.removeAttribute('width'); svg.removeAttribute('height');
  box._dv = box.dataset.engine === 'mermaid' ? { svg, w, h, k: 1, swim: null, mmd: svg, mode: 'mmd' } : { svg, w, h, k: 1, swim: svg, mmd: null, mode: 'swim' }; box._view = view;
  /* drag to pan */
  let drag = null;
  view.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, sl: view.scrollLeft, st: view.scrollTop }; view.setPointerCapture(e.pointerId); view.classList.add('dv-grab'); });
  view.addEventListener('pointermove', (e) => { if (!drag) return; view.scrollLeft = drag.sl - (e.clientX - drag.x); view.scrollTop = drag.st - (e.clientY - drag.y); });
  const end = () => { drag = null; view.classList.remove('dv-grab'); };
  view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end);
  /* Ctrl or Cmd with the wheel (or a pinch) zooms around the pointer; a plain wheel scrolls */
  view.addEventListener('wheel', (e) => { if (!(e.ctrlKey || e.metaKey)) return; e.preventDefault(); const r = view.getBoundingClientRect(); dvSet(box, box._dv.k * Math.exp(-e.deltaY * 0.0025), { x: e.clientX - r.left, y: e.clientY - r.top }); }, { passive: false });
  view.addEventListener('keydown', (e) => {
    if (e.key === '+' || e.key === '=') { dvSet(box, box._dv.k * 1.2, dvCenter(box)); e.preventDefault(); }
    else if (e.key === '-' || e.key === '_') { dvSet(box, box._dv.k / 1.2, dvCenter(box)); e.preventDefault(); }
    else if (e.key === '0') { dvSet(box, 1); e.preventDefault(); } else if (e.key.toLowerCase() === 'f') { dvFit(box); e.preventDefault(); }
  });
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dv]'); if (!b) return; const a = b.dataset.dv;
    if (a === 'in') dvSet(box, box._dv.k * 1.25, dvCenter(box)); else if (a === 'out') dvSet(box, box._dv.k / 1.25, dvCenter(box));
    else if (a === 'one') dvSet(box, 1); else if (a === 'fit') dvFit(box); else if (a === 'full') dvFull(box);
    else if (a === 'mmd') dvMermaid(box); else if (a === 'close') dvClose(); else if (a === 'copy') { navigator.clipboard.writeText(decodeURIComponent(box.dataset.src)).then(() => toast('Mermaid source copied'), () => toast('The clipboard could not be used')); }
    else if (a === 'svg' || a === 'png') dvDownload(box, a);
  });
  dvFit(box);
}
/* ---- the official Mermaid layout, for comparison. The library is loaded only when the button is pressed: from mermaid.min.js in the tool folder if it is there, otherwise once from the CDN after a confirmation ---- */
const MMD_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.0/dist/mermaid.min.js';
let mmdLoading = null, dvN = 0;
function loadMermaid() {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  if (mmdLoading) return mmdLoading;
  const load = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = () => (window.mermaid ? res(window.mermaid) : rej(new Error('the library loaded but did not start'))); s.onerror = () => { s.remove(); rej(new Error('could not load ' + src)); }; document.head.appendChild(s); });
  /* 1) mermaid.min.js in the tool folder; 2) ask the helper to download it there once; 3) the CDN directly from the browser */
  mmdLoading = load('mermaid.min.js?v=' + Date.now()).catch(async () => {
    if (!confirm('The official Mermaid library is not in the tool folder yet.\n\nDownload it once (about 3 MB, from cdn.jsdelivr.net) and keep it next to server.py so it works offline?')) throw new Error('cancelled');
    let why = '';
    if (store.mode === 'server') { try { const r = await fetch('/api/mermaid/install', { method: 'POST', body: '{}' }), j = await r.json().catch(() => ({})); if (r.ok) return load('mermaid.min.js?v=' + Date.now()); why = j.error || ('status ' + r.status); } catch (e) { why = 'the helper service could not be reached'; } }
    try { return await load(MMD_CDN); } catch (e) { throw new Error('The Mermaid library could not be loaded' + (why ? ' (' + why + ')' : '') + '. Check that this computer can reach cdn.jsdelivr.net, or save mermaid.min.js next to server.py.'); }
  }).catch((e) => { mmdLoading = null; throw e; });
  return mmdLoading;
}
function dvLabel(box) { const b = box.querySelector('[data-dv="mmd"]'), er = /^\s*erDiagram/.test(decodeURIComponent(box.dataset.src || '')); if (b) { b.textContent = box._dv.mode === 'mmd' ? (er ? 'Refined' : 'Swimlane') : 'Mermaid'; b.title = box._dv.mode === 'mmd' ? (er ? 'Back to the refined ER layout' : 'Back to the swimlane layout') : 'Show with the official Mermaid layout (loads the Mermaid library)'; } }
function dvMount(box, svg, mode) {
  const s = box._dv, size = svgBox(svg);
  box._view.textContent = ''; box._view.appendChild(svg);
  svg.removeAttribute('width'); svg.removeAttribute('height'); svg.style.maxWidth = 'none';
  s.svg = svg; s.w = size.w; s.h = size.h; s.mode = mode; dvLabel(box); dvFit(box);
}
let mmdDeclined = false;
const mmdCache = new Map();
async function mmdRender(src) {
  const theme = 'default', key = theme + '|' + src;  /* diagrams always use the light Mermaid theme */
  if (mmdCache.has(key)) { const t = document.createElement('div'); t.innerHTML = mmdCache.get(key); return t.querySelector('svg'); }
  const svg = await mmdDraw(src); mmdCache.set(key, svg.outerHTML); if (mmdCache.size > 60) mmdCache.delete(mmdCache.keys().next().value);
  return svg;
}
async function mmdDraw(src) {
  const m = await loadMermaid(), id = 'mmd' + (++dvN);
  m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default', flowchart: { htmlLabels: false }, sequence: { useMaxWidth: false }, fontFamily: getComputedStyle(document.body).fontFamily });
  try { const out = await m.render(id, src), tmp = document.createElement('div'); tmp.innerHTML = out.svg; return tmp.querySelector('svg'); }
  finally { const junk = document.getElementById('d' + id); if (junk) junk.remove(); }
}
/* diagram types the swimlane drawing cannot do (sequence, class, state, gantt, ...) are drawn by the official Mermaid only */
async function dvMermaidOnly(box, ask) {
  const holder = box.querySelector('.dv-wait'); if (!holder) return;
  const enc = holder.dataset.mmd, src = decodeURIComponent(enc); box.dataset.src = enc; box.dataset.engine = 'mermaid'; box.dataset.mm = '1';
  const fail = (msg) => { box.innerHTML = `<div class="dv-wait"><p>${esc(msg)}</p><div class="row-actions"><button class="key small" type="button" data-mmdretry="1">Draw with Mermaid</button><button class="key small" type="button" data-mmdcopy="1">Copy source</button></div><pre class="code">${esc(src)}</pre></div>`; };
  if (mmdDeclined && !ask) return fail('This diagram type is drawn by the official Mermaid library, which is not loaded.');
  try { const svg = await mmdRender(src); box.textContent = ''; box.appendChild(svg); dvBuild(box, svg, false); }
  catch (e) { const m = String(e.message || e); if (m === 'cancelled') mmdDeclined = true; fail(m === 'cancelled' ? 'This diagram type is drawn by the official Mermaid library, which was not loaded.' : 'Mermaid could not draw this diagram: ' + m.split('\n')[0].slice(0, 160)); }
}
async function dvMermaid(box) {
  const s = box._dv, btn = box.querySelector('[data-dv="mmd"]');
  const old = box.querySelector('.dv-note'); if (old) old.remove();
  if (s.mode === 'mmd') return dvMount(box, s.swim, 'swim');
  if (btn) { btn.disabled = true; btn.textContent = 'Loading...'; }
  try {
    if (!s.mmd) s.mmd = await mmdRender(decodeURIComponent(box.dataset.src));
    dvMount(box, s.mmd, 'mmd');
  } catch (e) {
    const msg = String(e.message || e); let n = box.querySelector('.dv-note'); if (!n) { n = document.createElement('div'); n.className = 'dv-note'; n.setAttribute('role', 'alert'); box.insertBefore(n, box._view); }
    n.textContent = msg === 'cancelled' ? 'The official Mermaid layout was not loaded.' : 'The official Mermaid layout could not be shown: ' + msg.split('\n')[0].slice(0, 300); setTimeout(() => { if (n.parentNode) n.remove(); }, 12000);
  }
  if (btn) btn.disabled = false; dvLabel(box);
}
let dvModal = null;
function dvClose() { if (dvModal) { dvModal.remove(); dvModal = null; document.body.classList.remove('dv-lock'); } }
function dvFull(src) {
  dvClose();
  const m = document.createElement('div'); m.className = 'dv-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Diagram, full screen');
  const box = document.createElement('div'); box.className = 'diagram'; if (src.dataset.src) box.dataset.src = src.dataset.src; if (src.dataset.name) box.dataset.name = src.dataset.name;
  m.appendChild(box); document.body.appendChild(m); document.body.classList.add('dv-lock'); dvModal = m;
  dvBuild(box, src._dv.svg.cloneNode(true), true);
  Object.assign(box._dv, { swim: src._dv.swim ? src._dv.swim.cloneNode(true) : null, mmd: src._dv.mmd ? src._dv.mmd.cloneNode(true) : null, mode: src._dv.mode }); dvLabel(box); box._view.focus();
  m.addEventListener('click', (e) => { if (e.target === m) dvClose(); });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && dvModal) dvClose(); });

/* ---------- Markdown preview full-screen modal ---------- */
let mdModal = null;
function mdClose() { if (mdModal) { mdModal.remove(); mdModal = null; document.body.classList.remove('dv-lock'); } }
function mdFull(md, title) {
  mdClose();
  const m = document.createElement('div'); m.className = 'md-modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', 'Markdown preview');
  const preview = document.createElement('div'); preview.className = 'md-preview';
  preview.innerHTML = `<div class="md-preview-head"><h3>${esc(title || 'Preview')}</h3><button class="md-preview-close" type="button" aria-label="Close preview"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div><div class="md-preview-body"><div class="doc">${String(md).trim() ? renderMd(md) : '<p class="note">Nothing to preview.</p>'}</div></div>`;
  m.appendChild(preview); document.body.appendChild(m); document.body.classList.add('dv-lock'); mdModal = m;
  preview.querySelector('.md-preview-close').addEventListener('click', mdClose);
  m.addEventListener('click', (e) => { if (e.target === m) mdClose(); });
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && mdModal) mdClose(); });

// Expose globally for onclick handlers
window.mdFull = mdFull;
window.mdClose = mdClose;

// Global accessors for current design state
window.getCurrentPRD = () => (D && D.prd) || '';
window.getCurrentArchMd = () => (D && D.archMd) || '';
window.getCurrentSourceMd = (name) => {
  const s = D?.sources?.find((x) => x.name === name);
  return s?.md || '';
};
function enhanceDiagrams(root) {
  (root || document).querySelectorAll('.diagram:not(.dv)').forEach((box) => {
    if (box.querySelector('.dv-wait[data-mmd]') && !box.dataset.mm) { dvMermaidOnly(box, false); return; }
    const svg = box.querySelector('svg'); if (!svg) return;
    box.querySelectorAll('.dz').forEach((b) => b.remove());
    dvBuild(box, svg, false);
  });
}

function drawMermaid(host, src) {
  try { host.innerHTML = renderFlow(src); }
  catch (e) { host.innerHTML = `<div class="error"><p>The diagram could not be drawn.</p><p class="mono">${esc(e.message || e)}</p></div><pre class="code">${esc(src)}</pre>`; }
}

/* ---------- coverage: scenario, test case and payload side by side ---------- */
let payCache = { k: '', a: null };
function payAnalysis() {
  const pi = D.payloadImport, files = pi && (pi.files || impCache); if (!files) return null;
  const k = `${pi.at}|${files.length}|${Core.hashStr(JSON.stringify(D.matrix || []))}|${prdHash()}`;
  if (payCache.k !== k) payCache = { k, a: Core.analyzePayloads(files, D.matrix || [], model()) };
  return payCache.a;
}
const getCov = () => Core.coverage(D.matrix || [], D.tests || [], payAnalysis(), model());
const evidenceFor = (t) => { const a = payAnalysis(); return a ? a.matches.filter((m) => m.scenarios.includes(t.scenario)).map((m) => m.label) : []; };
const ST_ICON = { 'Covered': ['pass', 'Covered'], 'Test only': ['run', 'Test only'], 'Payload only': ['run', 'Payload only'], 'Gap': ['fail', 'Gap'], 'Not required': ['wait', 'Not required'] };
function covSummaryHtml(cov, withPayload) {
  const rows = Core.PRIO_ORDER.filter((p) => cov.sum[p].total).map((p) => { const s = cov.sum[p]; return `<tr><td>${p}</td><td class="num">${s.total}</td><td>${keys(s.ids)}</td>${p === 'Not required' ? '<td colspan="4" class="note">Left out of coverage</td>' : `<td>${s.covered.length ? s.covered.length + ': ' : ''}${keys(s.covered)}</td><td>${s.testOnly.length ? s.testOnly.length + ': ' : ''}${keys(s.testOnly)}</td>${withPayload ? `<td>${s.payloadOnly.length ? s.payloadOnly.length + ': ' : ''}${keys(s.payloadOnly)}</td>` : ''}<td>${s.gap.length ? s.gap.length + ': ' : ''}${keys(s.gap)}</td>`}</tr>`; }).join('');
  return `<div class="table-wrap"><table><thead><tr><th>Priority</th><th>Scenarios</th><th>Which</th><th>Test and payload</th><th>Test only</th>${withPayload ? '<th>Payload only</th>' : ''}<th>Neither</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

/* ---------- stage 4: test plan (plan only, nothing is run) ---------- */
const tests = () => D.tests || (D.tests = []);
const testSpecText = (t) => Core.specSkeleton(t, evidenceFor(t));
function testSummaryHtml() {
  const cov = getCov(), unt = (D.matrix || []).filter((s) => s.prio !== 'Not required' && !tests().some((t) => t.scenario === s.id && t.status !== 'Not required')).map((s) => s.id);
  const reqNo = cov.reqs.filter((r) => r.scenarios.length && !r.tests.length).map((r) => r.id);
  return `<div class="panel-head"><h3>Coverage</h3><span class="note">${tests().length} test cases. Nothing is run: this is the plan the Playwright tests will be written from.</span></div>${covSummaryHtml(cov, !!D.payloadImport)}<div class="coverage">${unt.length ? `Scenarios without a test case: ${unt.join(', ')}.` : 'Every active scenario has a test case.'} ${reqNo.length ? `Requirements with scenarios but no test case: ${reqNo.join(', ')}.` : ''}</div>`;
}
function testRow(t, i) {
  const c = (f, v, cls, label) => `<input class="cell ${cls || ''}" data-ti="${i}" data-tf="${f}" value="${ea(v)}" aria-label="${ea(label)}">`;
  return `<tr class="${i === st.tcIdx ? 'sel' : ''}" data-trow="${i}"><td>${c('id', t.id, 'mono', 'Test ID')}</td><td><input class="cell mono" list="scn-ids" data-ti="${i}" data-tf="scenario" value="${ea(t.scenario)}" aria-label="Scenario"></td><td><textarea class="cell title" rows="2" data-ti="${i}" data-tf="title" aria-label="Title">${esc(t.title)}</textarea></td><td><select class="cell" data-ti="${i}" data-tf="drives" aria-label="Drives">${['UI', 'API'].map((x) => `<option ${x === t.drives ? 'selected' : ''}>${x}</option>`).join('')}</select></td><td><select class="cell" data-ti="${i}" data-tf="prio" aria-label="Priority">${Core.PRIOS.map((x) => `<option ${x === t.prio ? 'selected' : ''}>${x}</option>`).join('')}</select></td><td><select class="cell" data-ti="${i}" data-tf="status" aria-label="Status">${Core.TEST_STATUS.map((x) => `<option ${x === t.status ? 'selected' : ''}>${x}</option>`).join('')}</select></td><td>${trashBtn('data-tdel', i, 'Delete test case ' + t.id, st.confirmTdel === i)}</td></tr>`;
}
function refinePanel() {
  const t = tests()[st.tcIdx]; if (!t) return '';
  const r = st.refine && st.refine.idx === st.tcIdx ? st.refine : null;
  let out = '';
  if (r) {
    const before = testSpecText(t), after = testSpecText(r.test), d = diffHtml(before, after);
    const f = ['title', 'drives', 'prio', 'status', 'expect', 'notes'].filter((k) => String(t[k] || '') !== String(r.test[k] || '')).map((k) => `<tr><td>${{ title: 'Title', drives: 'Drives', prio: 'Priority', status: 'Status', expect: 'Expected result', notes: 'Notes' }[k]}</td><td>${esc(t[k] || '') || '<span class="note">empty</span>'}</td><td>${esc(r.test[k] || '')}</td></tr>`).join('') + (t.reqs.join() !== r.test.reqs.join() ? `<tr><td>Requirements</td><td>${esc(t.reqs.join(', ')) || 'None'}</td><td>${esc(r.test.reqs.join(', ')) || 'None'}</td></tr>` : '');
    out = `<div class="panel-body"><div class="callout">${r.notes.map(esc).join('<br>')}</div></div>` + (r.applied ? `${f ? `<div class="table-wrap"><table><thead><tr><th>Field</th><th>Now</th><th>Proposed</th></tr></thead><tbody>${f}</tbody></table></div>` : ''}<div class="diff"><div class="note">Playwright skeleton: ${d.add} lines added, ${d.del} lines removed.</div>${d.html}</div><div class="panel-body"><div class="row-actions"><button class="key primary" data-act="refine-accept" type="button">Accept change</button><button class="key" data-act="refine-discard" type="button">Discard</button></div></div>` : '');
  }
  return `<div class="panel"><div class="panel-head"><h3>Refine ${esc(t.id)} with a prompt</h3><span class="note">The AI model proposes a change; nothing changes until you accept.</span></div><div class="panel-body"><label class="field wide"><span>What should change in this test case?</span><textarea id="refine-prompt" class="prompt" rows="4" placeholder="add step 2: scan the receipt&#10;change step 3 to ...&#10;set expected to ...&#10;set priority P0&#10;add negative check ...">${esc(st.refinePrompt || '')}</textarea></label><div class="row-actions"><button class="key primary" data-act="refine-propose" type="button"${st.refineBusy ? ' disabled' : ''}>Propose change</button>${st.testUndo && st.testUndo.id === t.id ? '<button class="key small" data-act="refine-undo" type="button">Undo last accepted change</button>' : ''}</div>${st.refineBusy ? aiProgress('Update in progress: editing the test case', 'Usually under a minute. Nothing is changed until you accept.', st.refineStart) : ''}<p class="note">Examples: add a negative check; change step 3; set priority P0.</p></div>${out}</div>`;
}
function testDetailHtml() {
  const t = tests()[st.tcIdx];
  if (!t) return '<div class="panel"><div class="empty"><p>Select a test case with Edit, or add one.</p></div></div>';
  const i = st.tcIdx, ta = (f, v, rows, label) => `<label class="field wide"><span>${label}</span><textarea class="prompt" rows="${rows}" data-ti="${i}" data-tf="${f}">${esc(v)}</textarea></label>`;
  return `<div class="panel"><div class="panel-head"><h3>${esc(t.id)} detail</h3><span class="note">Requirements: ${t.reqs.join(', ') || 'none'}</span></div><div class="panel-body">${ta('steps', (t.steps || []).join('\n'), Math.max(4, (t.steps || []).length + 1), 'Steps (one per line)')}${ta('expect', t.expect, 3, 'Expected result')}${ta('notes', t.notes || '', 2, 'Notes')}<label class="field"><span>Requirements (IDs)</span><input class="cell mono" data-ti="${i}" data-tf="reqs" value="${ea(t.reqs.join(', '))}"></label></div></div>${refinePanel()}<div class="panel dark"><div class="panel-head"><span class="mono" id="spec-path">${t.drives === 'UI' ? 'ui' : 'api'}/${esc(t.id.toLowerCase())}.spec.ts</span><button class="key small" data-act="copy-spec" type="button">Copy</button></div><pre class="code" id="spec-src">${esc(testSpecText(t))}</pre></div>`;
}
function r4() {
  ccSlot(4, 'tests');
  const p = $('#plan-body');
  if (!D.matrix) { p.innerHTML = `<div class="panel">${gate('The test plan is built from the scenario matrix. Generate or import the matrix first.', 'gen3', 'Open the scenario matrix')}</div>`; return; }
  if (!tests().length && !st.plan) { p.innerHTML = `<div class="panel">${gate('No test plan yet. One test case is planned for every scenario that is not marked Not required. You can edit, add and delete them afterwards.', 'gen4', 'Create test plan')}</div>`; return; }
  const scn = D.matrix.map((s) => `<option>${esc(s.id)}</option>`).join('');
  p.innerHTML = `<div class="gap"><div class="panel" id="test-summary">${testSummaryHtml()}</div>
  <div class="split tests"><div class="panel"><div class="panel-head"><h3>Test cases (${tests().length})</h3><div class="row-actions"><button class="key small" data-act="add-test" type="button">Add test case</button><button class="key small" data-act="gen-missing" type="button">Add for uncovered scenarios</button></div></div>${tests().length ? `<div class="table-wrap"><table class="edit"><thead><tr><th>Test code</th><th>Scenario</th><th>Title</th><th>Drives</th><th>Priority</th><th>Status</th><th></th></tr></thead><tbody id="test-rows">${tests().map(testRow).join('')}</tbody></table></div>` : '<div class="empty"><p>No test cases. Add one, or add them for the scenarios.</p></div>'}<datalist id="scn-ids">${scn}</datalist><div class="coverage">Click a row to open its detail on the right. UI tests drive a screen (POS). API tests call the integration. Status does not mean a result: nothing is run here.</div></div>
  <div class="gap" id="test-detail">${testDetailHtml()}</div></div>
  </div>`;
}
async function genPlan() {
  if (st.busy) return;
  if (!D.matrix) { show(4); return; }
  st.busy = true; setBusy(); show(4);
  const p = $('#plan-body'); const add = Core.genTests(D.matrix, tests()); add.forEach((t) => tests().push(t));
  st.plan = true; st.tcIdx = st.tcIdx < tests().length ? st.tcIdx : 0; st.testsDirty = true; st.busy = false; setBusy(); flush(); drawTabs(); r4();
  toast(add.length ? `${add.length} test cases planned` : 'Every active scenario already has a test case');
}
function selectTest(i) {
  if (!tests()[i] || st.tcIdx === i) return;
  st.tcIdx = i; st.confirmTdel = -1; st.refinePrompt = '';
  $$('#test-rows tr').forEach((r) => r.classList.toggle('sel', +r.dataset.trow === i));
  const d = $('#test-detail'); if (d) d.innerHTML = testDetailHtml();
}
async function proposeRefine() {
  const t = tests()[st.tcIdx], text = (($('#refine-prompt') || {}).value || st.refinePrompt || '').trim(), idx = st.tcIdx;
  if (!t) return; if (!text) return toast('Describe the change first');
  if (st.refineBusy) return;
  const redraw = () => { const d = $('#test-detail'); if (d && st.tcIdx === idx) d.innerHTML = testDetailHtml(); };
  st.refinePrompt = text; st.refine = null;
  const off = AI_OFF(); if (off) { st.refine = { idx, test: t, notes: [off], applied: false }; return redraw(); }
  st.refineBusy = true; st.refineStart = Date.now(); redraw();
  try {
    const row = (D.matrix || []).find((s) => s.id === t.scenario) || null, ids = model().reqs.map((r) => r.id);
    const j = await aiPost('refine-test', { instruction: text, input: { test: { title: t.title, drives: t.drives, prio: t.prio, status: t.status, steps: t.steps || [], expect: t.expect || '', notes: t.notes || '', reqs: t.reqs || [] }, scenario: row ? { id: row.id, name: row.name, title: row.title, expect: row.expect, channel: row.ch, kind: row.kind, payload: row.so } : null, linkedRequirements: model().reqs.filter((r) => (t.reqs || []).includes(r.id)).map((r) => ({ id: r.id, text: r.text })), validRequirementIds: ids } });
    const x = j.test || {}, n = JSON.parse(JSON.stringify(t));
    if (x.title != null) n.title = String(x.title); if (['UI', 'API'].includes(x.drives)) n.drives = x.drives;
    if (['P0', 'P1', 'P2', 'P3', 'Not required'].includes(x.prio)) n.prio = x.prio; if (Core.TEST_STATUS.includes(x.status)) n.status = x.status;
    if (Array.isArray(x.steps)) n.steps = x.steps.map(String).filter((s) => s.trim()); if (!n.steps.length) n.steps = [''];
    if (x.expect != null) n.expect = String(x.expect); if (x.notes != null) n.notes = String(x.notes);
    if (Array.isArray(x.reqs)) n.reqs = x.reqs.map(String).filter((r) => ids.includes(r));
    const applied = JSON.stringify(n) !== JSON.stringify(t), notes = (j.notes || []).map(String);
    if (!applied && !notes.length) notes.push('The AI made no change.');
    st.refine = { idx, test: n, notes, applied };
  } catch (e) { st.refine = { idx, test: t, notes: ['The change did not run: ' + (e.message || e) + ' Nothing was changed.'], applied: false }; }
  st.refineBusy = false; redraw();
}
function acceptRefine() {
  const r = st.refine; if (!r || !r.applied || !tests()[r.idx]) return;
  st.testUndo = { id: tests()[r.idx].id, test: tests()[r.idx] };
  tests()[r.idx] = r.test; st.refine = null; st.refinePrompt = ''; st.testsDirty = true; flush(); r4(); toast('Change applied. Undo is available.');
}
function undoRefine() {
  const u = st.testUndo; if (!u) return; const i = tests().findIndex((x) => x.id === u.id); if (i < 0) return;
  tests()[i] = u.test; st.testUndo = null; st.refine = null; st.testsDirty = true; flush(); st.tcIdx = i; r4(); toast('Change undone');
}
const refreshTests = () => { const s = $('#test-summary'); if (s) s.innerHTML = testSummaryHtml(); const d = $('#spec-src'); const t = tests()[st.tcIdx]; if (d && t) d.textContent = testSpecText(t); drawTabs(); };
function addTest() { const t = Core.blankTest(tests()); tests().push(t); st.plan = true; st.tcIdx = tests().length - 1; st.testsDirty = true; saveSoon(); r4(); }
const planFiles = () => ({ md: Core.planMd(tests(), getCov(), D.name), csv: '﻿' + Core.testsCsv(tests()) });

/* ---------- stage 5: payload library (import, then track what is covered) ---------- */
const hi = (o) => esc(JSON.stringify(o, null, 2)).replace(/^(\s*)("[^"]+")(:)/gm, '$1<span class="k">$2</span>$3');
function covTable(cov) {
  const chips = ['Covered', 'Test only', 'Payload only', 'Gap', 'Not required'].map((k) => [k, cov.items.filter((i) => i.status === k)]).filter((x) => x[1].length);
  const withPay = cov.items.filter((i) => i.payloads.length).length, withTest = cov.items.filter((i) => i.tests.length).length;
  return `<div class="panel-body"><div class="chips"><span class="chip good">${withPay} of ${cov.items.length} scenarios have a payload</span><span class="chip">${withTest} have a test case</span>${chips.map(([k, a]) => `<span class="chip">${a.length} ${k.toLowerCase()}</span>`).join('')}</div><p class="note">Covered means a test case and a payload. Payload only means a payload but no test case yet.</p></div>${covSummaryHtml(cov, true)}<div class="table-wrap"><table><thead><tr><th>Scenario</th><th>Priority</th><th>Test cases</th><th>Payloads (reference or file)</th><th>Status</th></tr></thead><tbody>${cov.items.map((i) => `<tr><td><span class="mono">${esc(i.id)}</span><div class="note">${esc(i.title)}</div></td><td>${i.prio}</td><td class="mono">${esc(i.tests.join(', ')) || 'None'}</td><td>${keys(i.payloads)}</td><td>${status(ST_ICON[i.status][0], ST_ICON[i.status][1])}</td></tr>`).join('')}</tbody></table></div><div class="coverage">Covered means a test case and a payload exist. Payloads are matched to scenarios by scenario field, sales order, file name or wording (see the table below).</div>`;
}
function r5() {
  ccSlot(5, 'pay'); syncPayBtn();
  const w = $('#payload-wrap');
  w.innerHTML = `<div class="gap"><div id="imp-body"></div></div>`;
  if (D.payloadImport) renderImported();
  else $('#imp-body').innerHTML = '<div class="panel"><div class="empty"><p>No payloads yet (optional). Import a folder, a .zip or JSON, XML or CSV files.</p><div class="row-actions"><button class="key primary" data-act="import-payload-folder" type="button">Import a folder</button><button class="key" data-act="import-payloads" type="button">Upload files</button></div></div></div>';
}
const repKey = () => Core.hashStr((D.payloadImport ? D.payloadImport.at + ':' + D.payloadImport.count : '') + JSON.stringify(D.matrix || []) + D.prd);
function reportPanel() {
  const r = D.payReport;
  if (!r) return `<div class="panel"><div class="panel-head"><h3>Summary report</h3><div class="row-actions"><span class="note">Payload issues, the data model as a diagram, and inconsistent data.</span><button class="key primary small" data-act="payload-report" type="button">Generate summary report</button></div></div></div>`;
  const body = st.repView === 'md' ? `<pre class="code">${esc(r.md)}</pre>` : `<div class="doc">${renderMd(r.md)}</div>`;
  return `<div class="panel" id="report-panel"><div class="panel-head"><h3>Summary report</h3><div class="row-actions"><span class="note">Generated ${esc(fmtDate(r.at))}</span>${tplSelectHtml('payload-report')}<div class="subtabs" role="group" aria-label="View"><button type="button" data-rv="doc" aria-pressed="${st.repView !== 'md'}">Preview</button><button type="button" data-rv="md" aria-pressed="${st.repView === 'md'}">Markdown</button></div><button class="key small" data-act="report-copy" type="button">Copy</button><button class="key small" data-act="report-download" type="button">Download .md</button><button class="key primary small" data-act="payload-report" type="button">Generate again</button></div></div>${!/## TL;DR/.test(r.md) ? '<div class="panel-body"><div class="callout">This report was made in an older, longer format. Generate it again for the short version.</div></div>' : ''}${r.key !== repKey() ? '<div class="panel-body"><div class="callout">The payloads, matrix or PRD changed after this report. Generate it again.</div></div>' : ''}${body}</div>`;
}
/* the summary report: a TL;DR first, then only the key tables. No file or ID lists. */
function conciseReportMd(a, files) {
  const P = D.payAi, rows = (D.matrix || []).filter((x) => x.prio !== 'Not required'), q = (t) => String(t || '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim(), cut = (t, n) => q(t).length > n ? q(t).slice(0, n - 1) + '...' : q(t);
  const T = a.table, E = a.evidence, ent = {}; a.groups.forEach((g) => Object.entries(g.counts).forEach(([k, n]) => { if (k !== '(main)') ent[k] = (ent[k] || 0) + n; }));
  const linkedS = new Set(Object.values(a.groupMatch.byGroup).flat()).size, linkedG = a.groups.filter((g) => (a.groupMatch.byGroup[g.id] || []).length).length;
  const fieldStats = [...T.cols.map((c, i) => ({ label: c.label, mode: c.mode, n: T.rows.filter((r) => r.cells[i] && r.cells[i].flag).length })), ...T.entFields.map((c, i) => ({ label: c.label, mode: c.mode, n: T.rows.filter((r) => r.entCells[i] && r.entCells[i].flag).length }))].filter((x) => x.n).sort((x, y) => y.n - x.n).slice(0, 8);
  const flagged = T.rows.filter((r) => r.issues.length).length, crit = P ? P.mismatches.filter((m) => m.severity === 'Critical').length : 0;
  const L = [`# Payload summary: ${D.name}`, '', '## TL;DR', ''];
  L.push(`- **${a.groups.length} payloads** imported.`);
  if (rows.length) L.push(`- **${linkedS} of ${rows.length} scenarios** have a payload; ${E.missing.length ? `${E.missing.length} payload${E.missing.length === 1 ? '' : 's'} named in the matrix ${E.missing.length === 1 ? 'has' : 'have'} no folder; ` : ''}${E.unreferenced.length} payload${E.unreferenced.length === 1 ? '' : 's'} no scenario uses.`);
  if (D.payMap) L.push(`- **${D.payMap.reqCovered} of ${D.payMap.reqTotal} requirements** are covered by at least one payload${D.payMap.uncovered.length ? ` (not covered: ${D.payMap.uncovered.slice(0, 5).join(', ')}${D.payMap.uncovered.length > 5 ? ' ...' : ''})` : ''}.`);
  if (flagged) L.push(`- **${flagged} payloads differ from the rest**${fieldStats.length ? `, mainly in ${fieldStats.slice(0, 3).map((x) => x.label).join(', ')}` : ''}.`);
  if (P) { L.push(`- **${P.mismatches.length} mismatches** between the matrix and the payloads${crit ? ` (${crit} critical)` : ''}${P.mismatches[0] ? `. Most serious: ${cut(P.mismatches.slice().sort((x, y) => (x.severity === 'Critical' ? 0 : 1) - (y.severity === 'Critical' ? 0 : 1))[0].evidence, 140)}` : ''}.`); if (P.matrixIssues.length || P.missingScenarios.length) { const mi = P.matrixIssues.length, ms = P.missingScenarios.length; L.push(`- **${mi} matrix issue${mi === 1 ? '' : 's'}** and **${ms} suggested scenario${ms === 1 ? '' : 's'}** (${P.missingScenarios.filter((m) => m.priority === 'P1').length} key).`); } }
  else L.push('- The AI analysis has not been run yet.');
  if (P && P.mismatches.length) { L.push('', '## Key mismatches', '', '| Severity | Scenario | Matrix expects | Payload shows |', '| --- | --- | --- | --- |'); P.mismatches.slice().sort((x, y) => (x.severity === 'Critical' ? 0 : 1) - (y.severity === 'Critical' ? 0 : 1)).slice(0, 12).forEach((m) => L.push(`| ${m.severity} | ${m.scenario} | ${cut(m.expected, 110)} | ${cut(m.evidence, 130)} |`)); if (P.mismatches.length > 12) L.push('', `${P.mismatches.length - 12} more are listed on the Payload library page.`); }
  if (fieldStats.length) { L.push('', '## Fields that differ from the other payloads', '', '| Field | Most common value | Payloads that differ |', '| --- | --- | --- |', ...fieldStats.slice(0, 6).map((x) => `| ${x.label} | ${cut(x.mode, 40)} | ${x.n} |`)); }
  if (P && P.matrixIssues.length) L.push('', '## Matrix issues', '', '| Severity | Issue |', '| --- | --- |', ...P.matrixIssues.slice(0, 8).map((m) => `| ${m.severity} | ${cut(m.text, 160)} |`));
  if (P && P.missingScenarios.length) L.push('', '## Suggested scenarios', '', '| Priority | Scenario | Why |', '| --- | --- | --- |', ...P.missingScenarios.slice(0, 8).map((m) => `| ${m.priority} | ${cut(m.title, 90)} | ${cut(m.why, 130)} |`));
  const ke = Core.keyEr(a.er, model().reqs.map((r) => r.text), 12, 6);
  if (D.erAi) L.push('', '## Key data model', '', '```mermaid', D.erAi.mermaid, '```'); else if (ke.entities.length) L.push('', '## Key data model', '', '```mermaid', Core.erMermaid(ke.entities, ke.relations, Core.noteFnFor(a.inconsistencies)), '```');
  return L.join('\n') + '\n';
}
async function generateReport(quiet) {
  const pi = D.payloadImport; if (!pi) return toast('Import payloads first');
  const files = await impFiles(); if (!files) return toast('The payload files are not available. Import them again.');
  const a = payAnalysis() || Core.analyzePayloads(files, D.matrix || [], model());
  let md = conciseReportMd(a, files);
  const rtpl = await templateFor('payload-report');
  if (rtpl) { try { md = await composeDoc('payload-report', md, rtpl); } catch (e) { toast('The template was not applied: ' + (e.message || e) + ' The standard report is kept.'); } }
  D.payReport = { md, at: Date.now(), key: repKey() };
  put('06-payload-library/summary-report.md', md); await flush(); if (!quiet) { r5(); toast('Summary report generated'); }
}
/* the key data model, drawn by the AI from the observed payload structure (entities, fields, value lists, relationships) */
function erInput(a) {
  const enums = {};
  a.groups.forEach((g) => g.files.forEach((f) => { const fl = Core.flatten(f.json); Object.keys(fl).forEach((k) => { const v = fl[k]; if (typeof v !== 'string' || v.length > 30) return; const leaf = k.split('.').pop().replace(/\[0\]|\[\]/g, ''); if (!/status|state|type|kind|gateway|reason|source|restock|financial|tender/i.test(leaf)) return; (enums[leaf] = enums[leaf] || new Set()); if (enums[leaf].size < 9) enums[leaf].add(v); }); }));
  const entCounts = {}; a.groups.forEach((g) => Object.entries(g.counts).forEach(([k, n]) => { entCounts[k] = (entCounts[k] || 0) + n; }));
  return { requirements: model().reqs.slice(0, 60).map((r) => ({ id: r.id, text: String(r.text).slice(0, 140) })), designExcerpt: (D.archMd || '').slice(0, 2500), payloadFolders: a.groups.length, entityFolders: entCounts,
    entities: a.er.entities.slice().sort((y, z) => z.seen - y.seen).slice(0, 45).map((e) => ({ name: e.name, seen: e.seen, fields: e.fields.slice(0, 16).map((f) => { const n = a.incNotes[`${e.name}.${f.name}`] || a.incNotes[`*.${f.name}`] || ''; return `${f.name}:${f.type}${f.key ? ' PK' : f.fk ? ' FK' : ''}${f.optional ? ' (differs: only some payloads)' : ' (common)'}${/^inconsistent/.test(n) ? ' (' + n.replace(/UAT\w+|[A-Z]{2,}\d{3,}/g, '').slice(0, 60) + ')' : ''}`; }) })),
    relations: a.er.relations.slice(0, 80).map((r) => `${r.a} -> ${r.b} (${r.card}, ${r.label})`), observedValues: Object.fromEntries(Object.entries(enums).map(([k, v]) => [k, [...v]])) };
}
async function generateErAi() {
  if (st.erBusy) return false;
  const a = D.payloadImport ? payAnalysis() : null; if (!a) { toast('Import payloads first'); return false; }
  const off = AI_OFF(); if (off) { st.erError = off; if (current === 5) renderImported(); return false; }
  st.erBusy = true; st.erError = ''; if (current === 5) renderImported();
  try {
    let r; for (let t = 0; ; t++) { try { r = await aiPost('analyze-payloads', { mode: 'er', input: erInput(a) }); break; } catch (e) { if (t >= 1) throw e; } }
    const src = String(r.mermaid || '').replace(/^\s*```(?:mermaid)?\s*|\s*```\s*$/g, '').trim(), m = Core_parseEr(src);
    if (!/^erDiagram/.test(src) || m.entities.length < 2) throw new Error('The AI did not return a usable diagram. Try again.');
    D.erAi = { mermaid: src, at: Date.now(), entities: m.entities.length }; await flush();
  } catch (e) { st.erError = e.message || String(e); }
  st.erBusy = false; if (current === 5) renderImported(); return !st.erError;
}
const Core_parseEr = (src) => { try { return parseEr(src); } catch (e) { return { entities: [], relations: [] }; } };
/* ONE button after the upload: link the payloads, map them to scenarios and requirements with AI, analyze them against the matrix, and write the summary report */
/* payloads that no scenario names: the AI proposes which scenario each one belongs to, and the payload ID is written into the Payload column */
async function matchUnlinkedWithAI() {
  const a = payAnalysis(); if (!a || !D.matrix) return { n: 0, left: 0 };
  const gs = a.groups.filter((g) => !(a.groupMatch.byGroup[g.id] || []).length); if (!gs.length) return { n: 0, left: 0 };
  const scn = D.matrix.filter((s) => s.prio !== 'Not required').slice(0, 250).map(rowFacts), byId = Object.fromEntries(D.matrix.map((s) => [s.id, s])), gById = Object.fromEntries(gs.map((g) => [g.id, g]));
  let n = 0; const BATCH = 25;
  for (let i = 0; i < gs.length; i += BATCH) {
    st.matchNote = `Matching payloads ${i + 1} to ${Math.min(i + BATCH, gs.length)} of ${gs.length}`; refreshPay();
    let r; for (let t = 0; ; t++) { try { r = await aiPost('analyze-payloads', { mode: 'match', input: { payloads: gs.slice(i, i + BATCH).map((g) => Core.groupDigest(g, 25)), scenarios: scn } }); break; } catch (e) { if (t >= 1) throw e; } }
    (r.matches || []).forEach((m) => { const s = byId[m.scenario], g = gById[m.payload]; if (!s || !g || m.confidence === 'Low' || Core.mentions(s.so, g.id)) return; s.so = Core.payTokens(s).concat(g.id).join(', '); n++; });
  }
  if (n) { st.matrixDirty = true; payCache = { k: '', a: null }; await flush(); }
  const b = payAnalysis(); return { n, left: b ? b.groups.filter((g) => !(b.groupMatch.byGroup[g.id] || []).length).length : 0 };
}
const ALL_STEPS = ['Link payloads to the scenario matrix by ID', 'Match the remaining payloads to scenarios with AI', 'Generate scenario, expected outcome and requirements from the payloads', 'Compare the matrix with the payloads and review it', 'Link scenarios to requirements and map the payloads', 'Write the summary report'];
/* opts.from: start at this step and keep the finished ones before it; opts.failedOnly: in the generate step, redo only the scenarios that failed */
async function analyzeAllPayloads(opts) {
  if (st.allBusy) return;
  if (!D.payloadImport) return toast('Import payloads first');
  if (!D.matrix) { toast('Import or generate the scenario matrix first. The payloads are matched to it.'); return show(3); }
  const off = AI_OFF(); if (off) { st.paError = off; return current === 5 ? r5() : show(5); }
  const from = opts && opts.from > 0 && st.allSteps ? opts.from : 0, failedOnly = !!(opts && opts.failedOnly && (st.revFailedIds || []).length);
  st.allDone = false; st.allBusy = true; st.allStart = Date.now(); st.paError = ''; st.revError = '';
  if (!from) { st.allSteps = ALL_STEPS.map((n) => ({ n, s: 'wait', note: '' })); st.revDone = null; st.revFailedIds = []; }
  else for (let k = from; k < ALL_STEPS.length; k++) st.allSteps[k] = { n: ALL_STEPS[k], s: 'wait', note: '' };
  const set = (i, state, note) => { st.allSteps[i] = { n: ALL_STEPS[i], s: state, note: note || '' }; refreshPay(); };
  const fail = (i, msg) => { set(i, 'fail', msg); throw new Error('stop'); };
  const steps = [
    async () => { set(0, 'run'); const lk = linkPayloads(); set(0, 'done', lk.note); },
    async () => {
      set(1, 'run'); let mt; try { mt = await matchUnlinkedWithAI(); } catch (e) { mt = null; set(1, 'fail', 'Skipped: ' + (e.message || e)); if (/out of date/.test(e.message || '')) throw new Error('stop'); }
      if (mt) set(1, 'done', mt.n ? `${mt.n} payload link${mt.n === 1 ? '' : 's'} added to the Payload column${mt.left ? `; ${mt.left} payload${mt.left === 1 ? '' : 's'} still not linked` : ''}` : mt.left ? `${mt.left} payload${mt.left === 1 ? '' : 's'} could not be matched to a scenario` : 'Every payload is linked');
      const a = payAnalysis(), linked = a ? new Set(a.matches.flatMap((m) => m.strong ? m.scenarios : [])).size : 0;
      if (!linked) fail(1, 'No scenario could be linked to a payload. Put the payload IDs in the Payload column of the matrix (or map a column to Payload) and run it again.');
    },
    async () => {
      set(2, 'run'); await fillFromPayloads(failedOnly ? { ids: st.revFailedIds } : { all: true }); if (st.revError) fail(2, st.revError);
      const d = st.revDone; if (d && d.failed) set(2, 'fail', `${d.n} of ${d.of} scenarios updated; ${d.failed} failed: ${d.err || 'no answer for them'}`); else set(2, 'done', d ? `${d.n} of ${d.of} scenarios updated in the matrix` : '');
    },
    async () => { set(3, 'run'); st.paError = ''; await runPayloadAnalysis(); if (st.paError) fail(3, st.paError); set(3, 'done', D.payAi ? `${D.payAi.mismatches.length} differences, ${D.payAi.matrixIssues.length} matrix issues, ${D.payAi.missingScenarios.length} suggested scenarios` : ''); },
    async () => { set(4, 'run'); const lr = await linkRequirementsWithAI({}); if (st.lrError) fail(4, st.lrError); D.payMap = buildPayMap(); await flush(); set(4, 'done', `${lr.adopted + lr.n} scenario${lr.adopted + lr.n === 1 ? '' : 's'} linked to requirements${lr.failed ? `, ${lr.failed} could not be linked` : ''}; ${D.payMap ? `${D.payMap.reqCovered} of ${D.payMap.reqTotal} requirements have a payload` : ''}`); },
    async () => { set(5, 'run'); await generateReport(true); set(5, 'done', 'summary-report.md'); }
  ];
  try {
    for (let k = from; k < steps.length; k++) await steps[k]();
    st.allDone = true; toast('Payloads analyzed. The scenario matrix and the summary report are updated.');
  } catch (e) { if (e.message !== 'stop') { const i = st.allSteps.findIndex((x) => x.s === 'run'); if (i >= 0) set(i, 'fail', e.message || String(e)); } }
  st.allBusy = false; drawTabs(); if (current === 5) r5(); else if (current === 3) r3();
}
function allPanel() {
  if (!D.payloadImport) return '';
  const steps = st.allSteps, run = st.allBusy;
  const icon = { wait: ['wait', 'Waiting'], run: ['run', 'Running'], done: ['pass', 'Done'], fail: ['fail', 'Failed'] };
  const list = steps ? `<ol class="allsteps">${steps.map((x, k) => `<li>${status(icon[x.s][0], icon[x.s][1])} <b>${esc(x.n)}</b>${x.note ? `<div class="note">${esc(x.note)}</div>` : ''}${x.s === 'fail' && !run ? `<div class="row-actions">${k === 2 && (st.revFailedIds || []).length ? `<button class="key small primary" data-retryfailed="1" type="button">Retry the ${st.revFailedIds.length} failed scenario${st.revFailedIds.length === 1 ? '' : 's'} and continue</button>` : ''}<button class="key small" data-retryfrom="${k}" type="button">Retry this step and continue</button></div>` : ''}</li>`).join('')}</ol>` : `<ol class="allsteps">${ALL_STEPS.map((n) => `<li><b>${esc(n)}</b></li>`).join('')}</ol>`;
  const done = st.allDone && !run ? `<div class="callout">Matrix updated from the payloads. <button class="key small" data-go="3" type="button">Open the scenario matrix</button></div>` : '';
  return `<div class="panel"><div class="panel-head"><h3>Analyze the payloads</h3><div class="row-actions"><span class="note">${esc(D.payloadImport.name)}: ${D.payloadImport.count} files</span><button class="key primary" data-act="analyze-all" type="button"${run || !D.matrix ? ' disabled' : ''}${D.matrix ? '' : ' title="Import or generate the scenario matrix first"'}>${steps && !run ? 'Analyze again' : 'Analyze all payloads with AI'}</button></div></div><div class="panel-body">${run ? aiProgress('Analysis in progress', (st.matchNote && st.allSteps && st.allSteps[1].s === 'run' ? st.matchNote + '. ' : '') + 'This can take several minutes for many payloads. Nothing is lost if a step fails: finished steps are kept.', st.allStart) : ''}${list}${done}</div></div>`;
}
let impCache = null;
async function impFiles() {
  const pi = D.payloadImport; if (!pi) return null;
  if (pi.files) return pi.files;
  if (impCache) return impCache;
  if (store.mode !== 'server') return null;
  const tree = await (await fetch(`/api/designs/${enc(D.id)}/tree`, { cache: 'no-store' })).json(), out = [];
  /* all files at once in groups of 24 requests, instead of one after the other */
  /* only the files of the recorded imports count; leftovers on disk (for example copies saved with a wrapper folder name) are ignored and removed */
  const known = new Set(((pi.sources || []).flatMap((x) => x.paths || [])).map((p) => p.replace(/\//g, '__'))), all = tree.filter((x) => x.path.startsWith('06-payload-library/imported/'));
  const list = known.size ? all.filter((x) => known.has(x.path.slice(28))) : all, stale = known.size ? all.filter((x) => !known.has(x.path.slice(28))) : [], got = new Array(list.length);
  if (stale.length) (async () => { for (const f of stale) { try { await fetch(artUrl(f.path), { method: 'DELETE' }); } catch (e) { break; } } })();
  for (let i = 0; i < list.length; i += 24) await Promise.all(list.slice(i, i + 24).map(async (f, k) => { try { got[i + k] = { path: f.path.slice(28).replace(/__/g, '/'), json: JSON.parse(await (await fetch(artUrl(f.path))).text()) }; } catch (e) { /* skip */ } }));
  out.push(...got.filter(Boolean));
  return (impCache = out);
}
async function setImport(name, files, skipped, sources) {
  const size = JSON.stringify(files).length;
  D.payloadImport = { name, at: Date.now(), count: files.length, skipped: skipped || [], size, files: size <= 1500000 ? files : null, sources: sources || [{ name, at: Date.now(), count: files.length, paths: files.map((f) => f.path) }] };
  impCache = files; payCache = { k: '', a: null };
  st.linkNote = linkPayloads().note;
  if (store.mode === 'server') { for (let i = 0; i < files.length; i += 25) await Promise.all(files.slice(i, i + 25).map((f) => put('06-payload-library/imported/' + f.path.replace(/\//g, '__').slice(-190), JSON.stringify(f.json, null, 2)))); }
  else if (!D.payloadImport.files) toast('Large import: it stays in memory until you close the page. Run server.py to keep it.');
  await flush(); drawTabs(); show(5, false);
}
/* Import payloads from a folder (folder picker) or from chosen files (.json, or .zip of JSON). New files are added to what is already there; a file with the same path replaces the old one. */
async function removeSource(i) {
  const pi = D.payloadImport, src = pi && (pi.sources || [])[i]; if (!src || !src.paths) return toast('This import cannot be removed on its own. Use Remove import.');
  const all = (await impFiles()) || [], drop = new Set(src.paths), rest = all.filter((f) => !drop.has(f.path));
  if (!rest.length) { D.payloadImport = null; impCache = null; await clearStep('06-payload-library'); await flush(); drawTabs(); return r5(); }
  await clearStep('06-payload-library');
  const sources = pi.sources.filter((_, k) => k !== i);
  await setImport(sources.length > 1 ? `${sources.length} imports` : sources[0].name, rest, pi.skipped, sources); toast(`Removed ${src.name}`);
}
async function importPayloadFiles(list, fromFolder) {
  const picked = [...list]; if (!picked.length) return;
  const files = [], skipped = [];
  const take = (path, json) => { if (files.length >= 5000) { skipped.push(path + ' (more than 5000 files)'); return; } files.push({ path, json }); };
  for (const f of picked) {
    const rel = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
    if (/(^|\/)(\.|__MACOSX)/.test(rel) || /(^|\/)index\.json$/i.test(rel)) continue;
    try {
      if (/\.zip$/i.test(f.name)) { const r = await Core.readPayloadZip(await f.arrayBuffer()); r.files.forEach((x) => take(x.path, x.json)); r.skipped.forEach((x) => skipped.push(x)); }
      else if (Core.PAYLOAD_EXT.test(f.name)) take(rel, Core.parsePayloadText(f.name, await f.text()));
      else skipped.push(rel + (fromFolder ? '' : ' (not a JSON, XML, CSV or zip file)'));
    } catch (e) { skipped.push(rel + ' (could not be read as ' + f.name.split('.').pop().toUpperCase() + ')'); }
  }
  if (!files.length) return toast('No JSON files were found' + (skipped.length ? ' (skipped: ' + skipped.slice(0, 3).join(', ') + ')' : '') + '.');
  /* wrapper folders above the payload folders (uat/, or the zip's own folder) are dropped, so two imports of the same structure line up; a stray file next to the payload folders keeps only its file name */
  const sg = files.map((f) => f.path.split('/').filter(Boolean)), { L: lvl } = Core.payloadLevel(sg.map((x) => x.slice(0, -1)));
  if (lvl) files.forEach((f, i) => { f.path = sg[i].length - 1 > lvl - 0 && sg[i].length > lvl + 1 ? sg[i].slice(lvl).join('/') : sg[i].slice(-1)[0]; });
  const label = fromFolder && picked[0].webkitRelativePath ? 'Folder ' + picked[0].webkitRelativePath.split('/')[0] : picked.length === 1 ? picked[0].name : `${picked.length} uploaded files`;
  /* like extracting a zip into a folder: a file with the same path is overwritten, a new path is added, nothing else is touched */
  let merged = files, replaced = 0, sources = [{ name: label, at: Date.now(), total: files.length, added: files.length, replaced: 0, count: files.length, paths: files.map((x) => x.path) }];
  if (D.payloadImport) {
    const old = await impFiles();
    if (!old || (D.payloadImport.count && !old.length)) return toast('The files imported earlier could not be loaded, so nothing was changed. Reload the page and try again.');
    const paths = new Set(files.map((x) => x.path));
    replaced = old.filter((x) => paths.has(x.path)).length; merged = old.filter((x) => !paths.has(x.path)).concat(files);
    sources[0].replaced = replaced; sources[0].added = files.length - replaced;
    const prevSrc = (D.payloadImport.sources || [{ name: D.payloadImport.name, at: D.payloadImport.at, total: old.length, added: old.length, replaced: 0, count: old.length, paths: old.map((x) => x.path) }]).map((x) => { const kept = x.paths ? x.paths.filter((q) => !paths.has(q)) : null; return { ...x, paths: kept, count: kept ? kept.length : x.count }; });
    sources = prevSrc.concat(sources);
  }
  const prev = D.payloadImport ? D.payloadImport.skipped || [] : [];
  await setImport(sources.length > 1 ? `${sources.length} imports` : label, merged, prev.concat(skipped), sources);
  toast(`${files.length - replaced} new and ${replaced} overwritten (same path); ${merged.length} files in the library${skipped.length ? `; ${skipped.length} skipped` : ''}. ${st.linkNote || ''}`);
}
/* ---------- link scenarios to requirement IDs ---------- */
/* Way 1: a matrix generated from the PRD already carries the requirement IDs (and keeps them through an export and re-import).
   Way 2: a matrix that was imported or typed by hand. IDs already written in its columns are adopted; for the rest the AI matches the scenario (name, category, type, columns and, when there is one, the linked payload) to the requirement list. */
async function linkRequirementsWithAI(opts) {
  const all = !!(opts && opts.all), only = opts && opts.ids ? new Set(opts.ids) : null;
  if (st.lrBusy || !D.matrix) return { adopted: 0, n: 0, failed: 0 };
  const reqs = model().reqs; if (!reqs.length) { toast('The PRD has no requirements to link to'); return { adopted: 0, n: 0, failed: 0 }; }
  const idset = new Set(reqs.map((r) => r.id)), active = D.matrix.filter((s) => s.prio !== 'Not required' && (only ? only.has(s.id) : (all || !(s.reqs || []).length)));
  st.lrBusy = true; st.lrStart = Date.now(); st.lrError = ''; st.lrDone = null; st.lrNote = ''; if (current === 3) r3(); else refreshPay();
  let adopted = 0, n = 0; const failedIds = [], adoptedSet = new Set();
  try {
    /* IDs that the file already holds in its own columns */
    active.forEach((s) => { const hay = [s.name, ...Object.values(s.extra || {})].join(' '), found = [...new Set((hay.match(/[A-Z]{1,5}(?:-[A-Z]{2,6})*-\d{1,4}/g) || []).filter((x) => idset.has(x)))]; if (found.length) { s.reqs = found; s.reqInfo = { via: 'source columns', confidence: 'High', reason: 'The requirement ID is written in this row.' }; adopted++; adoptedSet.add(s.id); } });
    const todo = active.filter((s) => !adoptedSet.has(s.id));
    if (todo.length) {
      const off = AI_OFF(); if (off) throw new Error(off);
      const a2 = D.payloadImport ? payAnalysis() : null, gById = a2 ? Object.fromEntries(a2.groups.map((g) => [g.id, g])) : {};
      const items = todo.map((s) => ({ ...rowFacts(s), payloads: a2 ? (a2.groupMatch.byScn[s.id] || []).slice(0, 2).map((id) => gById[id]).filter(Boolean).map((g) => Core.groupDigest(g, 20)) : [] }));
      const reqList = reqs.map((r) => ({ id: r.id, text: String(r.text).replace(/\s+/g, ' ').slice(0, 200) }));
      const batches = []; let cur = [], curLen = 0; const bud = aiBudget('analyze-payloads', 60000, JSON.stringify(reqList).length);
      items.forEach((it) => { const l = JSON.stringify(it).length; if (cur.length && (cur.length >= 12 || curLen + l > bud.chars)) { batches.push(cur); cur = []; curLen = 0; } cur.push(it); curLen += l; });
      if (cur.length) batches.push(cur);
      const byId = Object.fromEntries(D.matrix.map((s) => [s.id, s])); let firstErr = '', done = 0;
      const ask = async (batch) => { for (let t = 0; t < 2; t++) { try { return (await aiPost('analyze-payloads', { mode: 'reqs', input: { requirements: reqList, scenarios: batch } }, bud.note)).results || []; } catch (e) { firstErr = firstErr || (e.message || String(e)); if (/out of date|not signed in/.test(e.message || '')) throw e; } } return null; };
      const apply = (res, batch) => { const got = new Set(); (res || []).forEach((r) => { const s = r && byId[r.id]; if (!s) return; s.reqs = [...new Set((Array.isArray(r.reqs) ? r.reqs : []).map((x) => String(x).trim()).filter((x) => idset.has(x)))]; s.reqInfo = { via: 'AI', confidence: ['High', 'Medium', 'Low'].includes(r.confidence) ? r.confidence : 'Medium', reason: String(r.reason || '') }; got.add(r.id); if (s.reqs.length) n++; }); batch.forEach((it) => { if (!got.has(it.id)) failedIds.push(it.id); }); st.matrixDirty = true; flush(); };
      for (const batch of batches) {
        st.lrNote = `Linking scenarios ${done + 1} to ${done + batch.length} of ${items.length}`; done += batch.length; if (current === 3) r3(); else refreshPay();
        const r1 = await ask(batch);
        if (r1) { apply(r1, batch); continue; }
        if (batch.length > 1) { for (const it of batch) { const r2 = await ask([it]); if (r2) apply(r2, [it]); else failedIds.push(it.id); } } else failedIds.push(batch[0].id);
      }
      st.lrFailed = failedIds; if (failedIds.length && !n && !adopted) st.lrError = 'No scenario could be linked. ' + firstErr;
      st.lrErr = firstErr;
    } else st.lrFailed = [];
    if (adopted) { st.matrixDirty = true; await flush(); }
  } catch (e) { st.lrError = e.message || String(e); }
  st.lrDone = { adopted, n, failed: (st.lrFailed || []).length, err: st.lrErr || '' };
  st.lrBusy = false; D.payMap = D.payloadImport ? buildPayMap() : D.payMap; drawTabs(); if (current === 3) r3(); else if (current === 5) refreshPay();
  return st.lrDone;
}
function lrPanel() {
  const head = (x) => `<div class="panel-head"><h3>Link requirements</h3>${x || ''}</div>`;
  if (st.lrBusy) return `<div class="panel">${head()}<div class="panel-body">${aiProgress('Linking in progress', (st.lrNote || '') + '. Nothing is changed for scenarios that already have requirements.', st.lrStart)}</div></div>`;
  if (st.lrError) return `<div class="panel">${head('<button class="link" data-act="lr-close" type="button">Close</button>')}<div class="panel-body"><div class="callout" role="alert">${esc(st.lrError)}</div></div></div>`;
  const d = st.lrDone; if (!d) return '';
  return `<div class="panel">${head('<button class="link" data-act="lr-close" type="button">Close</button>')}<div class="panel-body"><div class="callout">${d.adopted ? `${d.adopted} scenario${d.adopted === 1 ? '' : 's'} linked from requirement IDs already in the file. ` : ''}${d.n} linked by AI.${d.failed ? ` ${d.failed} could not be linked: ${esc(d.err || 'no answer')}.` : ''} ${d.failed && (st.lrFailed || []).length ? '<button class="key small primary" data-act="lr-retry" type="button">Retry the failed scenarios</button>' : ''}</div></div></div>`;
}
/* requirement to scenarios to payloads: what proves each requirement */
function reqMapPanel() {
  const reqs = model().reqs; if (!reqs.length || !D.matrix) return '';
  const a = D.payloadImport ? payAnalysis() : null, act = D.matrix.filter((s) => s.prio !== 'Not required');
  const rows = reqs.map((r) => { const sc = act.filter((s) => (s.reqs || []).includes(r.id)), pays = [...new Set(sc.flatMap((s) => a ? (a.groupMatch.byScn[s.id] || []) : []))]; return { r, sc, pays }; });
  const withS = rows.filter((x) => x.sc.length).length, withP = rows.filter((x) => x.pays.length).length;
  const cap = (arr, n) => arr.slice(0, n).map((x) => `<span class="ref">${esc(x)}</span>`).join(' ') + (arr.length > n ? ` <span class="note">+${arr.length - n}</span>` : '');
  return `<div class="panel"><div class="panel-head"><h3>Requirement traceability</h3><span class="note">${withS} of ${reqs.length} requirements have a scenario${a ? `, ${withP} have a payload` : ''}</span></div><div class="table-wrap"><table><thead><tr><th>Requirement</th><th>Text</th><th>Scenarios</th>${a ? '<th>Payloads</th>' : ''}<th>Status</th></tr></thead><tbody>${rows.map(({ r, sc, pays }) => `<tr><td class="mono">${esc(r.id)}</td><td>${esc(clipV(String(r.text).replace(/\s+/g, ' '), 90))}</td><td>${sc.length ? cap(sc.map((s) => s.id), 6) : '<span class="note">none</span>'}</td>${a ? `<td>${pays.length ? cap(pays, 4) : '<span class="note">none</span>'}</td>` : ''}<td>${pays.length ? '<span class="chip good">Scenario and payload</span>' : sc.length ? '<span class="chip">Scenario only</span>' : '<span class="chip sev sev-important">No scenario</span>'}</td></tr>`).join('')}</tbody></table></div></div>`;
}
/* ---------- link payloads to scenarios, then revise the scenarios from what the payloads prove ---------- */
/* Strong matches (scenario field in the payload, the Payload column, or the file name) are written into the Payload column of each scenario. Wording matches are only suggestions. */
function linkPayloads() {
  const none = { links: 0, scen: 0, wording: 0, note: '' };
  if (!D || !D.matrix || !D.payloadImport) return none;
  const files = D.payloadImport.files || impCache; if (!files) return none;
  const a = payAnalysis(); if (!a) return none;
  const byPath = Object.fromEntries(files.map((f) => [f.path, f])), touched = new Set(); let links = 0, wording = 0;
  const addTok = (s, tok) => { s.so = Core.payTokens(s).concat(tok).join(', '); touched.add(s.id); links++; };
  /* a folder per payload ID: the folder name goes into the Payload column of the scenarios it belongs to */
  const multi = new Set(a.groups.filter((g) => g.files.length > 1 || Object.keys(g.counts).some((k) => k !== '(main)')).map((g) => g.id));
  a.groups.forEach((g) => {
    if (!multi.has(g.id)) return;
    (a.groupMatch.byGroup[g.id] || []).forEach((id) => { const s = D.matrix.find((x) => x.id === id); if (s && !Core.mentions(s.so, g.id)) addTok(s, g.id); });
    D.matrix.forEach((s) => { if (Core.mentions(s.so, g.id)) return; const hay = [s.name, ...Object.values(s.extra || {})].join(' | '); if (Core.mentions(hay, g.id)) addTok(s, g.id); });
  });
  a.matches.forEach((m) => {
    if (!m.scenarios.length || multi.has(m.group)) return;
    if (!m.strong) { wording++; return; }
    const keys = Core.payKeys(byPath[m.path] || { path: m.path, json: {} });
    m.scenarios.forEach((id) => {
      const s = D.matrix.find((x) => x.id === id); if (!s) return;
      if (Core.payTokens(s).some((t) => keys.has(Core.normTok(t)))) return;
      addTok(s, m.path);
    });
  });
  if (links) { st.matrixDirty = true; payCache = { k: '', a: null }; flush(); }
  const lk = payAnalysis(), linked = lk ? new Set(lk.matches.flatMap((m) => m.strong ? m.scenarios : [])).size : 0;
  return { links, scen: touched.size, wording, note: `${linked} of ${D.matrix.length} scenarios are linked to payloads${links ? ` (${links} new link${links === 1 ? '' : 's'} added to the Payload column)` : ''}${wording ? `; ${wording} payload${wording === 1 ? '' : 's'} could only be matched by wording and were not linked` : ''}.` };
}
const clip = (v, n) => { let t = ''; try { t = JSON.stringify(v); } catch (e) { t = String(v); } return t && t.length > n ? t.slice(0, n) + '...(cut)' : t; };
/* Scenario, Expected outcome and Requirements are read only. They start blank and are generated by AI from the payloads linked to each scenario, then matched to the requirements. */
const needsFill = (s) => s.prio !== 'Not required' && (!String(s.title || '').trim() || !String(s.expect || '').trim() || !(s.reqs || []).length);
async function fillFromPayloads(opts) {
  const all = !!(opts && opts.all), manual = !!(opts && opts.manual), only = opts && opts.ids ? new Set(opts.ids) : null;
  if (st.revBusy || !D || !D.matrix || !D.payloadImport) { if (manual && !D.payloadImport) toast('Import payloads first'); return; }
  linkPayloads();
  const a = payAnalysis(); if (!a) { if (manual) toast('The payload files are not available. Import them again.'); return; }
  const gById = Object.fromEntries(a.groups.map((g) => [g.id, g])), multiG = new Set(a.groups.filter((g) => g.files.length > 1 || Object.keys(g.counts).some((k) => k !== '(main)')).map((g) => g.id));
  const rawBy = Object.fromEntries((D.payloadImport.files || impCache || []).map((f) => [f.path, f.json]));
  const items = D.matrix.filter((s) => s.prio !== 'Not required' && (only ? only.has(s.id) : (all || needsFill(s)))).map((s) => ({
    id: s.id, originalName: s.name || '', channel: s.ch, type: s.kind,
    payloadFolders: (a.groupMatch.byScn[s.id] || []).map((gid) => gById[gid]).filter((g) => g && multiG.has(g.id)).slice(0, 3).map((g) => { const d = Core.groupDigest(g, 40); return { payloadId: d.id, keyFields: d.main, relatedEntities: d.entities }; }),
    payloads: a.matches.filter((m) => m.strong && m.scenarios.includes(s.id) && !multiG.has(m.group)).slice(0, 3).map((m) => ({ file: m.path, content: m.ex.length ? undefined : clip(rawBy[m.path], 3000), calls: m.ex.slice(0, 3).map((e) => ({ method: e.req.method, url: e.req.url, requestBody: clip(e.req.body, 1500), responseStatus: e.res.status, responseBody: clip(e.res.body, 1500) })) }))
  })).filter((i) => i.payloads.length || i.payloadFolders.length);
  if (!items.length) { if (manual) { st.revError = 'No scenario is linked to a payload yet. Put the payload file name in the Payload column of a scenario, or import payloads whose scenario field or file name matches.'; show(3); } return; }
  const off = AI_OFF(); if (off) { st.revError = off; if (current === 3 || current === 5) show(current, false); return; }
  const reqs = model().reqs.map((r) => ({ id: r.id, text: String(r.text).replace(/\s+/g, ' ').slice(0, 220) })), ids = new Set(reqs.map((r) => r.id)), byId = Object.fromEntries(D.matrix.map((s) => [s.id, s]));
  const prevDone = only ? st.revDone : null;
  st.revBusy = true; st.revStart = Date.now(); st.revError = ''; st.revDone = null; if (!only || !st.reviseUndo) st.reviseUndo = JSON.parse(JSON.stringify(D.matrix)); if (current === 3) r3(); else refreshPay();
  /* batches of up to 4 scenarios, split further so that one call never carries more than about 120,000 characters of payload data */
  const batches = []; let cur = [], curLen = 0; const bud = aiBudget('fill-scenarios', 100000, JSON.stringify(reqs).length);
  items.forEach((it) => { const l = JSON.stringify(it).length; if (cur.length && (cur.length >= 3 || curLen + l > bud.chars)) { batches.push(cur); cur = []; curLen = 0; } cur.push(it); curLen += l; });
  if (cur.length) batches.push(cur);
  let n = 0, done = 0, firstErr = ''; const failedIds = [], fatal = (m) => /out of date|not signed in/.test(m || '');
  const apply = (res, batch) => {
    const got = new Set();
    (res || []).forEach((r) => {
      const s = r && byId[r.id]; if (!s) return;
      const title = String(r.title || '').trim(), expect = String(r.expect || '').trim(); if (!title && !expect) return;
      s.title = title; s.expect = expect; s.reqs = [...new Set((Array.isArray(r.reqs) ? r.reqs : []).map((x) => String(x).trim()).filter((x) => ids.has(x)))];
      s.aiInfo = { confidence: ['High', 'Medium', 'Low'].includes(r.confidence) ? r.confidence : 'Medium', evidence: String(r.evidence || ''), note: String(r.note || ''), at: Date.now() }; n++; got.add(r.id);
    });
    batch.forEach((it) => { if (!got.has(it.id)) failedIds.push(it.id); }); /* a scenario the answer left out counts as failed */
    st.matrixDirty = true; flush();
  };
  const ask = async (batch) => { let res = null; for (let t = 0; t < 2 && !res; t++) { try { res = (await aiPost('fill-scenarios', { scenarios: batch, requirements: reqs }, bud.note)).results || []; } catch (e) { firstErr = firstErr || (e.message || String(e)); if (fatal(e.message)) return { res: null, stop: true }; } } return { res, stop: false }; };
  for (const batch of batches) {
    st.revNote = `Scenarios ${done + 1} to ${done + batch.length} of ${items.length}`; done += batch.length; if (current === 3) r3(); else refreshPay();
    const r1 = await ask(batch);
    if (r1.stop) { batch.forEach((it) => failedIds.push(it.id)); break; }
    if (r1.res) { apply(r1.res, batch); continue; }
    /* the batch failed twice (for example an invalid JSON answer): try its scenarios one at a time */
    if (batch.length > 1) { for (const it of batch) { const r2 = await ask([it]); if (r2.stop) { failedIds.push(it.id); continue; } if (r2.res) apply(r2.res, [it]); else failedIds.push(it.id); } }
    else failedIds.push(batch[0].id);
  }
  st.revFailedIds = failedIds;
  const totalN = n + (prevDone ? prevDone.n : 0), totalOf = prevDone ? prevDone.of : items.length;
  if (!n && failedIds.length && !prevDone) st.revError = 'No scenario could be generated. ' + firstErr;
  else st.revDone = { n: totalN, of: totalOf, failed: failedIds.length, failedIds, err: firstErr, noReq: items.filter((it) => !(byId[it.id].reqs || []).length).length };
  st.revBusy = false; drawTabs(); if (current === 3) r3(); else if (current === 5) r5();
}
function revisePanel() {
  const head = (extra) => `<div class="panel-head"><h3>Scenarios from payloads</h3>${extra || ''}</div>`;
  if (st.revBusy && st.allBusy) return '';
  if (st.revBusy) return `<div class="panel">${head()}<div class="panel-body">${aiProgress('Generation in progress: reading the matched payloads', (st.revNote || '') + '. Scenario, expected outcome and requirements are filled in automatically.', st.revStart)}</div></div>`;
  if (st.revError) return `<div class="panel">${head('<button class="link" data-act="rev-discard" type="button">Close</button>')}<div class="panel-body"><div class="callout" role="alert">${esc(st.revError)}</div>${D.payloadImport ? '<div class="row-actions"><button class="key small" data-act="revise-payloads" type="button">Try again</button></div>' : ''}</div></div>`;
  if (st.revDone) return `<div class="panel">${head('<button class="link" data-act="rev-discard" type="button">Close</button>')}<div class="panel-body"><div class="callout">Updated ${st.revDone.n} of ${st.revDone.of} scenarios from their payloads.${st.revDone.noReq ? ` ${st.revDone.noReq} have no requirement.` : ''} <button class="key small" data-act="rev-undo" type="button">Undo</button></div></div></div>`;
  const pend = D.matrix ? D.matrix.filter(needsFill).length : 0;
  if (pend && D.payloadImport) return `<div class="panel">${head()}<div class="panel-body"><p class="note">${pend} scenario${pend === 1 ? ' is' : 's are'} waiting for a matched payload.</p></div></div>`;
  return '';
}
function linkPanel() {
  if (!D.payloadImport || !D.matrix) return '';
  const a = payAnalysis(); if (!a) return '';
  const strong = a.matches.filter((m) => m.strong && m.scenarios.length), weak = a.matches.filter((m) => !m.strong && m.scenarios.length), none = a.matches.filter((m) => !m.scenarios.length);
  const linked = new Set(strong.flatMap((m) => m.scenarios)).size, total = D.matrix.length;
  return `<div class="panel"><div class="panel-head"><h3>Links to the scenario matrix</h3><div class="row-actions"><span class="note">Links are kept in the Payload column. Scenario, outcome and requirements are generated from them.</span></div></div><div class="panel-body"><div class="chips"><span class="chip good">${linked} of ${total} scenarios linked</span><span class="chip">${strong.length} payloads linked</span>${weak.length ? `<span class="chip warn">${weak.length} matched by wording only</span>` : ''}${none.length ? `<span class="chip sev sev-important">${none.length} not linked to any scenario</span>` : ''}</div>${none.length ? `<p class="note">Not linked: ${esc(none.slice(0, 8).map((m) => m.path).join(', '))}${none.length > 8 ? ' ...' : ''}. Add the file name to the Payload column of the scenario it proves.</p>` : ''}${weak.length ? `<p class="note">Wording matches (check them, then add the file name to the Payload column): ${esc(weak.slice(0, 6).map((m) => m.path + ' → ' + m.scenarios.join('/')).join('; '))}</p>` : ''}</div></div>`;
}
/* the payload library as an analysis report: summary, inventory, evidence gaps, and one row per payload ID with its key columns */
/* one section: what was imported, with the history of each import and the actions */
function importedPanel(pi, files, a) {
  const src = pi.sources || [{ name: pi.name, at: pi.at, total: files.length, added: files.length, replaced: 0, count: files.length, paths: null }];
  return `<div class="panel"><div class="panel-head"><h3>Imported payloads</h3><div class="row-actions"><span class="note">${files.length} files, ${a.groups.length} payload folders${pi.skipped && pi.skipped.length ? `, ${pi.skipped.length} skipped` : ''}. Same path = overwritten, new path = added.</span><button class="key small" data-act="export-payloads" type="button">Export zip</button><button class="key small" data-act="import-payloads" type="button">Add files</button><button class="key small" data-act="remove-import" type="button">Remove all</button></div></div><div class="table-wrap"><table><thead><tr><th>Imported</th><th>When</th><th>Files in it</th><th>New</th><th>Overwrote older</th><th>Still from this import</th><th></th></tr></thead><tbody>${src.map((x, i) => `<tr><td>${esc(x.name)}</td><td>${esc(fmtDate(x.at))}</td><td class="num">${x.total === undefined ? x.count : x.total}</td><td class="num">${x.added === undefined ? '' : x.added}</td><td class="num">${x.replaced === undefined ? '' : x.replaced}</td><td class="num">${x.count}</td><td>${x.paths && x.count ? `<button class="key small" data-rmsrcn="${i}" type="button">Remove</button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
}
/* inventory and evidence gaps (the counts live here once; nothing is repeated in a summary) */
function payInventoryPanels(a) {
  const E = a.evidence;
  const inv = `<div class="panel"><div class="panel-head"><h3>Payload inventory</h3><span class="note">Folder shapes: which entity sub-folders each payload ID has.</span></div><div class="table-wrap"><table><thead><tr><th>Folder shape</th><th>Payload IDs</th><th>Which</th></tr></thead><tbody>${E.shapes.map((x) => `<tr><td class="mono">${esc(x.shape)}</td><td class="num">${x.ids.length}</td><td>${keys(x.ids)}</td></tr>`).join('')}</tbody></table></div></div>`;
  const evid = (E.missing.length || E.unreferenced.length) ? `<div class="panel"><div class="panel-head"><h3>Missing or unreferenced evidence</h3></div><div class="table-wrap"><table><thead><tr><th>Payload ID</th><th>Where</th><th>What is missing</th></tr></thead><tbody>${E.missing.map((x) => `<tr><td class="mono">${esc(x.payload)}</td><td class="mono">${esc(x.scenario)}</td><td>The scenario names this payload, but there is no folder for it.</td></tr>`).join('')}${E.unreferenced.slice(0, 200).map((id) => `<tr><td class="mono">${esc(id)}</td><td>Folder</td><td>No scenario names this payload ID in its Payload column.</td></tr>`).join('')}</tbody></table></div></div>` : '';
  return inv + evid;
}
const clipV = (v, n) => { const t = String(v); return t.length > n ? t.slice(0, n - 2) + '...' : t; };
/* the list of payloads with the key properties of the data model; a cell that differs from most other payloads is highlighted */
function payListCols(a) {
  const T = a.table;
  return [...T.cols.map((c, i) => ({ label: c.label, mode: c.mode, cell: (r) => r.cells[i] })), ...T.entFields.map((e, i) => ({ label: e.label, mode: e.mode, cell: (r) => r.entCells[i] })), ...T.entCols.map((e, i) => ({ label: e.entity + ' (files)', mode: '', cell: (r) => r.counts[i] }))];
}
/* the payload list reads like the per-SO evidence table of the analysis report: payload, scenario, matrix columns, files per entity folder, and the facts found in the JSON */
function payFacts(a, r) {
  const T = a.table, n = T.rows.length, meta = [...T.cols.map((c) => ({ label: c.label, distinct: c.distinct })), ...T.entFields.map((e) => ({ label: e.label, distinct: e.distinct }))];
  /* the facts that tell payloads apart: leave out values that are the same everywhere and identifiers that are different everywhere (unless flagged) */
  return [...r.cells, ...r.entCells].map((c, i) => ({ c, label: meta[i].label, distinct: meta[i].distinct })).filter((x) => x.c && x.c.value !== undefined && x.c.value !== '' && (x.c.flag || (x.distinct > 1 && !(n > 8 && x.distinct / n > 0.9 && !/amount|price|total|value/i.test(x.label)))));
}
const scnOf = (a, id) => (a.groupMatch.byGroup[id] || []).map((x) => (D.matrix || []).find((s) => s.id === x)).filter(Boolean);
const matrixCols = (s) => s ? [s.cat, s.kind, s.ch, s.prio].filter(Boolean).join(' / ') : '';
function paySplitHtml(a, files) {
  const T = a.table;
  if (!st.viewPg || !a.groups.some((g) => g.id === st.viewPg)) st.viewPg = T.rows[0] ? T.rows[0].id : '';
  const entHead = T.entCols.map((e) => e.entity).join('/');
  const rows = T.rows.map((r) => {
    const sc = scnOf(a, r.id), first = sc[0], facts = payFacts(a, r);
    return `<tr class="${r.id === st.viewPg ? 'sel' : ''}${r.issues.length ? ' row-important' : ''}" data-pgsel="${ea(r.id)}" tabindex="0"><td class="mono">${esc(r.id)}</td><td>${first ? `<span class="ref">${esc(first.id)}</span> ${esc(clipV(first.name || first.title || '', 60))}${sc.length > 1 ? ` <span class="note">+${sc.length - 1}</span>` : ''}` : '<span class="note">no scenario</span>'}</td><td>${esc(matrixCols(first))}</td><td class="num" title="${ea(entHead)}">${r.counts.map((c) => c.value).join('/')}</td><td class="facts">${facts.map((x) => `<span class="fact${x.c.flag ? ' hl-' + x.c.flag : ''}" title="${ea(x.label)}">${esc(clipV(x.c.value, 26))}</span>`).join('<span class="sep">; </span>')}</td><td class="num">${r.issues.length || ''}</td></tr>`;
  }).join('');
  const list = `<div class="panel" id="pay-list"><div class="panel-head"><h3>Payloads (${T.rows.length})</h3><span class="note">One row per payload folder. <span class="hl-diff chip">differs</span> from most other payloads, <span class="hl-missing chip">missing</span> where most have it.</span></div><div class="table-wrap"><table class="pt"><thead><tr><th>Payload</th><th>Scenario</th><th>Matrix (category / type / channel / priority)</th><th title="${ea('Files per related folder: ' + entHead)}">Files ${entHead ? `(${esc(entHead)})` : ''}</th><th>Payload facts</th><th>Diff</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  return `<div class="split paysplit">${list}${payDetailHtml(a, files)}</div>`;
}
function payDetailHtml(a, files) {
  const g = a.groups.find((x) => x.id === st.viewPg);
  if (!g) return '<div class="panel paydetail"><div class="empty"><p>Select a payload on the left to see its content.</p></div></div>';
  const T = a.table, row = T.rows.find((r) => r.id === g.id), sc = scnOf(a, g.id), facts = payFacts(a, row), cols = payListCols(a);
  const props = cols.map((c) => ({ label: c.label, c: c.cell(row), mode: c.mode })).filter((x) => x.c && x.c.value !== undefined && x.c.value !== '');
  const mm = D.payAi ? D.payAi.mismatches.filter((m) => m.payload === g.id) : [];
  const hint = (x) => { const fl = Core.flatten(x.json), seenK = new Set(), k = Object.keys(fl).filter((p) => /status|kind|state|gateway|type|amount/i.test(p) && !/\[\]$/.test(p) && !seenK.has(p.split('.').pop()) && seenK.add(p.split('.').pop())).slice(0, 4); return k.map((p) => p.split('.').pop() + '=' + clipV(fl[p], 22)).join(', '); };
  const block = (x, open) => `<details class="pd-file"${open ? ' open' : ''}><summary><span class="mono">${esc(x.rel)}</span></summary><pre class="code pd-json">${hi(x.json)}</pre></details>`;
  const primary = g.files.filter((x) => x.entity === '(main)'), related = g.files.filter((x) => x.entity !== '(main)');
  const relBy = {}; related.forEach((x) => { (relBy[x.entity] = relBy[x.entity] || []).push(x); });
  /* 1. the row, as on the left */
  const head = `<div class="panel-body pd-row"><div class="chips">${sc.length ? sc.map((s) => `<span class="ref">${esc(s.id)}</span>`).join(' ') : '<span class="note">no scenario linked</span>'}<span class="note">${esc(matrixCols(sc[0]))}</span></div>${sc[0] ? `<div><b>${esc(sc[0].name || sc[0].title || '')}</b></div>` : ''}<div class="facts">${facts.map((x) => `<span class="fact${x.c.flag ? ' hl-' + x.c.flag : ''}" title="${ea(x.label)}">${esc(clipV(x.c.value, 40))}</span>`).join('<span class="sep">; </span>')}</div><div class="note">${row.counts.map((c, i) => `${esc(T.entCols[i].entity)} ${c.value}`).join(', ')}${row.issues.length ? `. Differs: ${esc(row.issues.slice(0, 4).join('; '))}` : ''}</div></div>`;
  /* 2. the summary of the JSON: key properties of the primary payload and one line per related payload */
  const summ = `<div class="panel-body"><h4>Summary of the payload</h4><div class="table-wrap"><table><tbody>${props.map((x) => `<tr class="${x.c.flag ? 'hl-' + x.c.flag : ''}"><td class="note">${esc(x.label)}</td><td>${esc(clipV(x.c.value, 60))}${x.c.flag === 'diff' && x.mode ? `<div class="note">most common: ${esc(clipV(x.mode, 40))}</div>` : ''}</td></tr>`).join('')}</tbody></table></div>${related.length ? `<div class="table-wrap"><table><thead><tr><th>Related payload</th><th>Key values</th></tr></thead><tbody>${related.map((x) => `<tr><td class="mono">${esc(x.rel)}</td><td>${esc(hint(x))}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>`;
  /* 3. what the matrix says and what the AI found */
  const matrix = sc.length ? `<div class="panel-body"><h4>Scenario</h4>${sc.map((s) => `<div class="pd-scn"><div><span class="ref">${esc(s.id)}</span> <b>${esc(s.name || '')}</b></div>${s.title || s.expect || (s.reqs || []).length ? `<div class="note">Scenario</div><div>${esc(s.title || '-')}</div><div class="note">Expected outcome</div><div>${esc(s.expect || '-')}</div><div class="note">Requirements</div><div>${(s.reqs || []).length ? s.reqs.map((r) => `<span class="ref">${esc(r)}</span>`).join(' ') : '-'}</div>${s.aiInfo && s.aiInfo.note ? `<div class="callout">${esc(s.aiInfo.note)}</div>` : ''}` : '<div class="note">Generated by "Analyze payloads with AI".</div>'}</div>`).join('')}${mm.map((m) => `<div class="pd-mm"><span class="chip sev sev-${m.severity.toLowerCase()}">${m.severity}</span> <span class="note">${esc(m.scenario)}</span><div>Matrix expects: ${esc(m.expected)}</div><div>Payload shows: ${esc(m.evidence)}</div></div>`).join('')}</div>` : '';
  /* 4. the source: the primary JSON, then every related JSON */
  const src = `<div class="panel-body"><div class="row-actions"><h4>Source</h4><button class="key small" data-pdall="1" type="button">Expand all</button><button class="key small" data-pdall="0" type="button">Collapse all</button></div>${primary.length ? `<div class="pd-group"><div class="note">Primary payload</div>${primary.map((x) => block(x, true)).join('')}</div>` : ''}${Object.entries(relBy).map(([e, list]) => `<div class="pd-group"><div class="note">${esc(e)} (${list.length})</div>${list.map((x) => block(x, false)).join('')}</div>`).join('')}</div>`;
  return `<div class="panel paydetail"><div class="panel-head"><h3>${esc(g.id)}</h3><span class="note">${g.files.length} files</span></div>${head}${summ}${matrix}${src}</div>`;
}
function refreshSplit() {
  const el = $('#pay-split'); if (!el || !D.payloadImport) return;
  const a = payAnalysis(), files = D.payloadImport.files || impCache; if (a && files) el.innerHTML = paySplitHtml(a, files);
}
/* ---------- AI analysis of the matrix against the payloads (the analysis report, inside the app) ---------- */
const rowFacts = (s) => ({ id: s.id, name: s.name || s.title || '', category: s.cat || '', type: s.kind, priority: s.prio, channel: s.ch, payloadColumn: String(s.so || '').slice(0, 120), otherColumns: Object.fromEntries(Object.entries(s.extra || {}).slice(0, 10).map(([k, v]) => [k, String(v).slice(0, 60)])) });
async function runPayloadAnalysis() {
  if (st.paBusy) return;
  if (!D.matrix) return toast('There is no scenario matrix yet');
  const off = AI_OFF(); if (off) { st.paError = off; return current === 5 ? r5() : r3(); }
  const a = D.payloadImport ? payAnalysis() : null;
  st.paBusy = true; st.paStart = Date.now(); st.paError = ''; st.paNote = 'Preparing'; if (current === 5) r5(); else if (current === 3) r3();
  const refresh = () => { if (current === 5) refreshPay(); else if (current === 3) r3(); };
  const out = { at: Date.now(), mismatches: [], matrixIssues: [], missingScenarios: [] };
  try {
    if (a) {
      const gById = Object.fromEntries(a.groups.map((g) => [g.id, g]));
      const items = D.matrix.filter((s) => s.prio !== 'Not required' && (a.groupMatch.byScn[s.id] || []).length).map((s) => ({ ...rowFacts(s), payloads: (a.groupMatch.byScn[s.id] || []).slice(0, 3).map((id) => gById[id]).filter(Boolean).map((g) => Core.groupDigest(g, 30)) }));
      const batches = []; let cur = [], curLen = 0;
      items.forEach((it) => { const l = JSON.stringify(it).length; if (cur.length && (cur.length >= 12 || curLen + l > 120000)) { batches.push(cur); cur = []; curLen = 0; } cur.push(it); curLen += l; });
      if (cur.length) batches.push(cur);
      let doneN = 0;
      for (const batch of batches) {
        st.paNote = `Comparing scenarios ${doneN + 1} to ${doneN + batch.length} of ${items.length} with their payloads`; doneN += batch.length; refresh();
        let r; for (let t = 0; ; t++) { try { r = await aiPost('analyze-payloads', { mode: 'mismatch', input: { scenarios: batch } }); break; } catch (e) { if (t >= 1) throw e; } }
        (r.mismatches || []).forEach((m) => out.mismatches.push({ scenario: String(m.scenario || ''), payload: String(m.payload || ''), severity: m.severity === 'Critical' ? 'Critical' : 'Important', expected: String(m.expected || ''), evidence: String(m.evidence || '') }));
      }
    }
    st.paNote = 'Reviewing the matrix and looking for missing scenarios'; refresh();
    const rows = D.matrix, cov = {}; rows.forEach((s) => { const k = `${s.cat || '(none)'} / ${s.kind} / ${s.prio}`; cov[k] = (cov[k] || 0) + 1; });
    const input = { requirements: model().reqs.slice(0, 80).map((r) => ({ id: r.id, text: r.text.slice(0, 160) })), scenarios: rows.slice(0, 200).map(rowFacts), coverageByCategoryTypePriority: cov,
      payloadLibrary: a ? { payloadIds: a.groups.length, shapes: a.evidence.shapes.map((x) => `${x.shape}: ${x.ids.length}`), namedInMatrixButNoFolder: a.evidence.missing.slice(0, 40), foldersNoScenarioNamesThem: a.evidence.unreferenced.slice(0, 60), payloadsWithDifferences: a.table.rows.filter((r) => r.issues.length).slice(0, 40).map((r) => ({ id: r.id, differences: r.issues.slice(0, 5) })) } : 'No payloads imported' };
    let r; for (let t = 0; ; t++) { try { r = await aiPost('analyze-payloads', { mode: 'review', input }); break; } catch (e) { if (t >= 1) throw e; } }
    out.matrixIssues = (r.matrixIssues || []).map((m) => ({ severity: m.severity === 'Critical' ? 'Critical' : 'Important', where: String(m.where || ''), text: String(m.text || '') }));
    out.missingScenarios = (r.missingScenarios || []).map((m) => ({ priority: m.priority === 'P1' ? 'P1' : 'P2', title: String(m.title || ''), why: String(m.why || ''), payloads: (m.payloads || []).map(String), added: false }));
    D.payAi = out; flush();
  } catch (e) { st.paError = 'The analysis stopped. ' + (e.message || e); }
  st.paBusy = false; refresh();
}
const sevRank = (v) => v === 'Critical' ? 0 : 1;
function payAnalysisPanel(scope) {
  const P = D.payAi, head = (act) => `<div class="panel-head"><h3>${scope === 'pay' ? 'Matrix expectation vs payload evidence (AI)' : 'Matrix review and suggested scenarios (AI)'}</h3><div class="row-actions">${act || ''}<button class="key primary small" data-act="run-pay-analysis" type="button"${st.paBusy ? ' disabled' : ''}>${P ? 'Run again' : 'Run AI analysis'}</button></div></div>`;
  if (st.paBusy && st.allBusy) return '';
  if (st.paBusy) return `<div class="panel">${head()}<div class="panel-body">${aiProgress('Analysis in progress', st.paNote || '', st.paStart)}</div></div>`;
  if (st.paError) return `<div class="panel">${head()}<div class="panel-body"><div class="callout" role="alert">${esc(st.paError)}</div></div></div>`;
  if (!P) return `<div class="panel">${head()}<div class="panel-body"><p class="note">${scope === 'pay' ? 'Compares what each scenario row expects (type, payment or refund action, channel, tender, fees) with what its payload shows, and lists the differences, like the mismatch table of the analysis report.' : 'Checks the matrix for data-quality problems and suggests missing scenarios from the requirements and the payloads.'}${D.payloadImport ? '' : ' Payloads are optional here: without them only the matrix review runs.'}</p></div></div>`;
  if (scope === 'pay') {
    const m = P.mismatches.slice().sort((x, y) => sevRank(x.severity) - sevRank(y.severity));
    return `<div class="panel">${head(`<span class="note">${m.length} difference${m.length === 1 ? '' : 's'} found ${esc(fmtDate(P.at))}</span>`)}${m.length ? `<div class="table-wrap"><table><thead><tr><th>Severity</th><th>Scenario</th><th>Payload</th><th>Matrix expects</th><th>Payload shows</th></tr></thead><tbody>${m.map((x) => `<tr class="row-${x.severity.toLowerCase()}"><td><span class="chip sev sev-${x.severity.toLowerCase()}">${x.severity}</span></td><td class="mono">${esc(x.scenario)}</td><td class="mono">${esc(x.payload)}</td><td>${esc(x.expected)}</td><td>${esc(x.evidence)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="panel-body"><p class="note">No differences between the matrix and the payloads.</p></div>'}</div>`;
  }
  const mi = P.matrixIssues.slice().sort((x, y) => sevRank(x.severity) - sevRank(y.severity));
  return `<div class="panel">${head(`<span class="note">${esc(fmtDate(P.at))}</span>`)}${mi.length ? `<div class="table-wrap"><table><thead><tr><th>Severity</th><th>Where</th><th>Matrix issue</th></tr></thead><tbody>${mi.map((x) => `<tr class="row-${x.severity.toLowerCase()}"><td><span class="chip sev sev-${x.severity.toLowerCase()}">${x.severity}</span></td><td class="mono">${esc(x.where)}</td><td>${esc(x.text)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="panel-body"><p class="note">No matrix quality issues found.</p></div>'}${P.missingScenarios.length ? `<div class="panel-head"><h3>Suggested missing scenarios</h3><span class="note">P1 = a key scenario that should be added. P2 = an edge case.</span></div><div class="table-wrap"><table><thead><tr><th>Priority</th><th>Suggested scenario</th><th>Why and evidence</th><th></th></tr></thead><tbody>${P.missingScenarios.map((x, i) => `<tr><td>${x.priority}</td><td>${esc(x.title)}</td><td>${esc(x.why)}${x.payloads.length ? `<div class="note">Payloads: ${esc(x.payloads.join(', '))}</div>` : ''}</td><td><button class="key small" data-addmiss="${i}" type="button"${x.added ? ' disabled' : ''}>${x.added ? 'Added' : 'Add to matrix'}</button></td></tr>`).join('')}</tbody></table></div>` : ''}</div>`;
}
function addMissing(i) {
  const m = D.payAi && D.payAi.missingScenarios[i]; if (!m || m.added || !D.matrix) return;
  let n = D.matrix.length + 1; while (D.matrix.some((s) => s.id === 'S-' + String(n).padStart(2, '0'))) n++;
  D.matrix.push({ id: 'S-' + String(n).padStart(2, '0'), ch: 'All', cat: '', kind: 'Happy', name: m.title, title: '', reqs: [], expect: '', so: m.payloads.join(', '), prio: m.priority, extra: {} });
  m.added = true; st.matrixDirty = true; flush(); r3();
}
/* the data schema of all payloads: the entity relation diagram, and for each entity what is common to every payload and what differs */
function schemaPanel(a) {
  const er = a.er, useAi = !!D.erAi && !st.fullEr;
  const ke = Core.keyEr(er, model().reqs, st.fullEr ? 60 : 12, 6, D.archMd || '');
  const mer = useAi ? D.erAi.mermaid : st.fullEr ? er.mermaid : Core.erMermaid(ke.entities, ke.relations, Core.noteFnFor(a.inconsistencies));
  const svg = (() => { try { return diagram(mer); } catch (e) { return `<pre class="code">${esc(mer)}</pre>`; } })();
  const note = (e, f) => a.incNotes[`${e}.${f}`] || a.incNotes[`*.${f}`] || '';
  const lst = (arr, n) => arr.length ? arr.slice(0, n).join(' ') + (arr.length > n ? ` <span class="note">+${arr.length - n}</span>` : '') : '<span class="note">none</span>';
  const rows = ke.entities.map((e) => {
    const full = er.entities.find((x) => x.name === e.name) || e, common = [], differ = [];
    full.fields.filter((f) => !/^(array|object)/.test(f.type)).forEach((f) => { const n = note(e.name, f.name), tag = `${esc(f.name)}${f.key ? ' PK' : f.fk ? ' FK' : ''}`; if (f.optional || /^inconsistent/.test(n)) differ.push(`<span class="mono ${/^inconsistent/.test(n) ? 'hl-missing' : 'hl-diff'}" title="${ea(n || 'present in some payloads only')}">${tag}${f.optional ? '?' : ''}</span>`); else common.push(`<span class="mono">${tag}</span>`); });
    return `<tr><td>${esc(e.name)}${e.stub ? ' <span class="note">(referenced only)</span>' : ''}</td><td class="num">${e.seen}</td><td>${lst(common, 8)}</td><td>${lst(differ, 8)}</td><td class="mono">${e.reqs && e.reqs.length ? esc(e.reqs.slice(0, 4).join(', ')) + (e.reqs.length > 4 ? ` +${e.reqs.length - 4}` : '') : '<span class="note">none found</span>'}</td></tr>`;
  }).join('');
  return `<div class="panel"><div class="panel-head"><h3>Data schema</h3><div class="row-actions"><span class="note">${st.erError ? esc(st.erError) : st.erBusy ? 'Drawing the data model...' : useAi ? `Drawn by the AI from the payloads: ${D.erAi.entities} entities.` : st.fullEr ? `All ${er.entities.length} entities found.` : `The ${ke.entities.length} of ${ke.total} entities that matter most to the requirements.`}</span><button class="key small" data-act="gen-er" type="button"${st.erBusy ? ' disabled' : ''}>${D.erAi ? 'Redraw with AI' : 'Draw with AI'}</button><button class="key small" data-act="toggle-er" type="button">${st.fullEr ? 'Key entities only' : 'Show all entities'}</button><button class="key small" data-act="copy-er" type="button">Copy diagram</button></div></div><div class="diagram" data-src="${ea(encodeURIComponent(mer))}" data-name="data-schema">${svg}</div>
    <div class="table-wrap"><table><thead><tr><th>Entity</th><th>Seen</th><th>Common to all payloads</th><th>Differs between payloads</th><th>Impacts requirements</th></tr></thead><tbody>${rows}</tbody></table></div><div class="coverage">A question mark marks a field that only some payloads have. Red is a field whose type or values are inconsistent.</div></div>`;
}
function coveragePanel() {
  if (!D.matrix) return '<div class="panel"><div class="panel-head"><h3>Coverage</h3></div><div class="empty"><p>Generate or import the scenario matrix to see what the payloads cover.</p></div></div>';
  return `<div class="panel"><div class="panel-head"><h3>Coverage: scenario, test case and payload</h3><span class="note">${(D.tests || []).length} test cases</span></div>${covTable(getCov())}</div>`;
}
/* payload to scenario to requirement */
function buildPayMap() {
  const a = payAnalysis(); if (!a || !D.matrix) return null;
  const byId = Object.fromEntries(D.matrix.map((x) => [x.id, x])), rows = a.groups.map((g) => { const sc = a.groupMatch.byGroup[g.id] || [], reqs = [...new Set(sc.flatMap((id) => (byId[id] && byId[id].reqs) || []))]; return { payload: g.id, scenarios: sc, reqs }; });
  const all = model().reqs.map((r) => r.id), covered = new Set(rows.flatMap((r) => r.reqs));
  return { at: Date.now(), rows, reqTotal: all.length, reqCovered: all.filter((id) => covered.has(id)).length, uncovered: all.filter((id) => !covered.has(id)) };
}
function mapPanel() {
  const M = D.payMap; if (!M) return '';
  return `<div class="panel"><div class="panel-head"><h3>Payload, scenario and requirement mapping</h3><span class="note">${M.reqCovered} of ${M.reqTotal} requirements have a payload${M.uncovered.length ? ` (${M.uncovered.length} without: ${esc(M.uncovered.slice(0, 5).join(', '))}${M.uncovered.length > 5 ? ' ...' : ''})` : ''}</span></div><div class="table-wrap"><table><thead><tr><th>Payload</th><th>Scenarios</th><th>Requirements</th></tr></thead><tbody>${M.rows.map((r) => `<tr><td class="mono">${esc(r.payload)}</td><td>${r.scenarios.map((x) => `<span class="ref">${esc(x)}</span>`).join(' ') || '<span class="note">none</span>'}</td><td>${r.reqs.length ? r.reqs.slice(0, 8).map((x) => `<span class="ref">${esc(x)}</span>`).join(' ') + (r.reqs.length > 8 ? ` <span class="note">+${r.reqs.length - 8}</span>` : '') : '<span class="note">none</span>'}</td></tr>`).join('')}</tbody></table></div></div>`;
}
const analysisHtml = () => allPanel() + revisePanel() + payAnalysisPanel('pay') + mapPanel();
function refreshPay() { if (current !== 5) return; const el = $('#analysis-wrap'); if (el) el.innerHTML = analysisHtml(); else r5(); }
async function renderImported() {
  const pi = D.payloadImport, host = $('#imp-body'); if (!pi || !host) return;
  host.innerHTML = skeleton(5);
  const files = await impFiles();
  if (!files) { host.innerHTML = `<div class="panel"><div class="empty"><p>${esc(pi.name)} was imported earlier but its files are not in this browser. Import it again.</p></div></div>`; return; }
  const a = payAnalysis() || Core.analyzePayloads(files, D.matrix || [], model());
  const cnt = ['Conflict', 'Missing', 'Unmatched'].map((t) => [t, a.findings.filter((x) => x.type === t).length]).filter((x) => x[1]);
  const hasCalls = a.matches.some((m) => m.ex.length);
  const kv = (l, h) => l.length ? `<div class="table-wrap"><table><thead><tr><th>${h}</th><th>Payloads</th><th>References or files</th></tr></thead><tbody>${l.map((x) => `<tr><td>${esc(x.value)}</td><td class="num">${x.count}</td><td>${keys(x.keys)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><p>No such field was found in the payloads.</p></div>';
  const calls = hasCalls ? `<div class="panel"><div class="panel-head"><h3>Common patterns</h3><span class="note">Payloads grouped by the shape of their last call.</span></div><div class="table-wrap"><table><thead><tr><th>Shape</th><th>Payloads</th><th>References or files</th></tr></thead><tbody>${a.patterns.map((p) => `<tr><td class="mono">${esc(p.signature)}</td><td class="num">${p.count}</td><td>${keys(p.keys)}</td></tr>`).join('')}</tbody></table></div></div>
  <div class="panel"><div class="panel-head"><h3>Exceptions</h3></div>${a.exceptions.length ? `<div class="table-wrap"><table><thead><tr><th>Reference or file</th><th>Why</th></tr></thead><tbody>${a.exceptions.map((x) => `<tr><td class="mono">${esc(x.key)}</td><td>${esc(x.why)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><p>No exceptions.</p></div>'}</div>
  ${a.payments.length ? `<div class="panel"><div class="panel-head"><h3>Payment methods</h3></div>${kv(a.payments, 'Value')}</div>` : ''}${a.reasons.length ? `<div class="panel"><div class="panel-head"><h3>Reasons</h3></div>${kv(a.reasons, 'Value')}</div>` : ''}` : '';
  host.innerHTML = `<div class="gap">
  ${importedPanel(pi, files, a)}
  ${schemaPanel(a)}
  <div id="pay-split">${paySplitHtml(a, files)}</div>
  <div id="analysis-wrap">${analysisHtml()}</div>
  ${coveragePanel()}
  ${reportPanel()}
  <div class="panel"><div class="panel-head"><h3>Checks against the scenario matrix</h3><div class="chips">${cnt.length ? cnt.map(([t, n]) => `<span class="chip">${n} ${t.toLowerCase()}</span>`).join('') : '<span class="note">No differences found.</span>'}</div></div>${a.findings.length ? `<div class="table-wrap"><table><thead><tr><th>Type</th><th>Where</th><th>Finding</th></tr></thead><tbody>${a.findings.map((x) => `<tr><td>${x.type}${x.priority ? ' ' + x.priority : ''}</td><td class="mono">${esc(x.where)}</td><td>${esc(x.text.replace(/^P\d: /, ''))}</td></tr>`).join('')}</tbody></table></div>` : ''}</div>
  ${payInventoryPanels(a)}
  ${calls}</div>`;
}

/* ---------- stage 6 ---------- */
/* ---------- stage 6: architecture, on the baseline design structure ---------- */
const range = (a) => a.length ? a.join(', ') : 'None';
const ids = (a) => a.length ? a.map((p) => `<button class="ref" type="button" data-pay-go="${ea(p)}">${esc(p)}</button>`).join(' ') : 'None';
function evidence() {
  const pi = D.payloadImport, files = pi && (pi.files || impCache); if (!files) return null;
  const a = payAnalysis() || Core.analyzePayloads(files, MX(), model());
  return { a, checks: Core.payloadChecks(files), imported: true, source: `${pi.name} (${files.length} files)`, files };
}
/* ---------- Markdown preview: headings, lists, tables, quotes, links, fenced code and Mermaid ---------- */
/* ---------- safe rendering of ```html and ```svg blocks: an allowlist, nothing else gets through ---------- */
let svgN = 0;
const decodeEnt = (s) => s.replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCodePoint(Math.min(parseInt(h, 16) || 32, 0x10FFFF))).replace(/&#(\d+);?/g, (_, d) => String.fromCodePoint(Math.min(+d || 32, 0x10FFFF))).replace(/&(colon|tab|newline|lpar|rpar);?/gi, (_, n) => ({ colon: ':', tab: ' ', newline: ' ', lpar: '(', rpar: ')' }[n.toLowerCase()])).replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&amp;/gi, '&');
const HT = new Set('a abbr article aside b blockquote br caption code col colgroup dd del details div dl dt em figcaption figure footer h1 h2 h3 h4 h5 h6 header hr i img ins kbd li main mark nav ol p pre q s section small span strong sub summary sup table tbody td tfoot th thead tr u ul'.split(' '));
const HVOID = new Set(['br', 'hr', 'img', 'col']);
const SVGT = Object.fromEntries('svg g defs path rect circle ellipse line polyline polygon text tspan title desc linearGradient radialGradient stop clipPath marker symbol use pattern'.split(' ').map((n) => [n.toLowerCase(), n]));
const SVGA = Object.fromEntries('viewBox preserveAspectRatio width height x y cx cy r rx ry x1 y1 x2 y2 d points fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-miterlimit stroke-opacity fill-opacity fill-rule clip-rule opacity transform font-family font-size font-weight font-style text-anchor dominant-baseline letter-spacing dx dy offset stop-color stop-opacity gradientUnits gradientTransform spreadMethod fx fy markerWidth markerHeight refX refY orient markerUnits clip-path patternUnits patternTransform href xlink:href id class'.split(' ').map((n) => [n.toLowerCase(), n]));
function sanitizeMarkup(src, kind) {
  const svg = kind === 'svg', pre = svg ? 'svg' + (++svgN) + '-' : '';
  let s = String(src).replace(/\u0000/g, '').replace(/<!--[\s\S]*?(-->|$)/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '').replace(/<\?[\s\S]*?\?>/g, '').replace(/<!DOCTYPE[^>]*>/gi, '');
  s = s.replace(/<(script|style|iframe|object|embed|noscript|template|foreignObject|form|textarea|select|button|audio|video|canvas|applet|frameset|frame|math|animate|animateTransform|animateMotion|set)\b[\s\S]*?(<\/\1\s*>|$)/gi, '');
  s = s.replace(/<\/?(link|meta|base|input|source|track|param|image|feImage|filter)\b[^>]*>/gi, '');
  const attrsOf = (raw, canon) => {
    let o = ''; const re = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g; let a;
    while ((a = re.exec(raw))) {
      const low = a[1].toLowerCase(); const val = decodeEnt(a[2] ?? a[3] ?? a[4] ?? ''), clean = val.replace(/[\u0000- \u007f-\u009f]+/g, '');
      let name = low, v = null;
      if (svg) {
        name = SVGA[low]; if (!name || /javascript|data:|expression|vbscript|@import|<|>/i.test(clean)) continue;
        if (name === 'href' || name === 'xlink:href') { if (!/^#[\w-]+$/.test(clean)) continue; v = '#' + pre + clean.slice(1); if (name === 'xlink:href') name = 'href'; }
        else if (name === 'id') { if (!/^[\w-]+$/.test(clean)) continue; v = pre + clean; }
        else if (name === 'class') { if (!/^[\w\- ]*$/.test(val)) continue; v = val; }
        else if (/url\(/i.test(clean)) { if (!/^url\(#[\w-]+\)$/i.test(clean)) continue; v = 'url(#' + pre + clean.slice(5, -1) + ')'; }
        else v = val.trim();
      } else if (low === 'class') { if (/^[\w\- ]*$/.test(val)) v = val; }
      else if (['title', 'alt', 'lang', 'dir', 'scope', 'align', 'valign'].includes(low)) { if (val.length <= 200 && !/[<>]/.test(val)) v = val; }
      else if (['width', 'height', 'colspan', 'rowspan'].includes(low)) { if (/^\d+%?$/.test(clean)) v = clean; }
      else if (low === 'open') v = '';
      else if (low === 'href' && canon === 'a') { if (/^(https?:\/\/|mailto:|#)/i.test(clean)) v = val.trim(); }
      else if (low === 'src' && canon === 'img') { if (/^(https?:\/\/|data:image\/(png|jpe?g|gif|webp);base64,)/i.test(clean)) v = val.trim(); }
      if (v === null) continue;
      o += v === '' && low === 'open' ? ' open' : ` ${name}="${ea(v)}"`;
    }
    if (canon === 'a') o += ' target="_blank" rel="noopener noreferrer"';
    return o;
  };
  const TAG = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
  const text = (t) => t.replace(/</g, '&lt;'); let out = '', last = 0, m; const stack = [];
  while ((m = TAG.exec(s))) {
    out += text(s.slice(last, m.index)); last = TAG.lastIndex;
    const low = m[2].toLowerCase(), canon = svg ? SVGT[low] : (HT.has(low) ? low : null);
    if (!canon) continue;
    if (m[1]) { const k = stack.lastIndexOf(canon); if (k >= 0) while (stack.length > k) out += `</${stack.pop()}>`; continue; }
    out += `<${canon}${attrsOf(m[3], canon)}`;
    if (!svg && HVOID.has(canon)) out += '>'; else if (svg && m[4]) out += '/>'; else { out += '>'; stack.push(canon); }
  }
  out += text(s.slice(last)); while (stack.length) out += `</${stack.pop()}>`;
  if (svg) { if (!/<svg[\s>]/.test(out)) return null; return out; }
  return out.replace(/<[^>]+>/g, '').trim() ? out : null;
}
/* YAML front matter at the top of a document (--- ... ---) is shown as a collapsed "Document properties" table, not as text */
function frontMatterHtml(text) {
  const rows = []; let last = null;
  text.split('\n').forEach((l) => {
    let m;
    if ((m = l.match(/^([A-Za-z_][\w .-]*):\s*(.*)$/))) { last = { k: m[1].replace(/[_-]/g, ' '), v: m[2].replace(/^["']|["']$/g, '').trim() }; rows.push(last); }
    else if (last && (m = l.match(/^\s*[-*]\s+(.*)$/))) last.v = (last.v ? last.v + '; ' : '') + m[1].replace(/^["']|["']$/g, '').trim();
    else if (last && /^\s+\S/.test(l)) last.v = (last.v ? last.v + ' ' : '') + l.trim();
  });
  if (!rows.length) return '';
  return `<details class="docprops"><summary>Document properties (${rows.length})</summary><div class="table-wrap"><table><tbody>${rows.map((r) => `<tr><th>${esc(r.k)}</th><td>${esc(r.v || 'TBD')}</td></tr>`).join('')}</tbody></table></div></details>`;
}
/* read-only Markdown viewers (source files, baseline draft): Markdown is the default, Preview opens full-screen */
const vmode = (k) => (st.vm && st.vm[k]) || 'md';
const vmTabs = (k, md, title, identifier) => `<div class="subtabs" role="group" aria-label="View"><button type="button" data-vm="${k}:md" aria-pressed="${vmode(k) === 'md'}">Markdown</button><button type="button" class="key small" data-md-full="${ea(identifier || title)}" onclick="event.stopPropagation(); mdFull('${esc(String(md || '').replace(/'/g, "\\'"))}', '${esc(String(title || '').replace(/'/g, "\\'"))}'); return false;" aria-label="Open preview in full screen" title="Open preview in full screen">Preview</button></div>`;
const vmBody = (k, md) => vmode(k) === 'md' ? `<pre class="code">${esc(md)}</pre>` : `<div class="doc">${String(md).trim() ? renderMd(md) : '<p class="note">Nothing to preview.</p>'}</div>`;
function renderMd(md) {
  let fmHtml = ''; md = String(md || '');
  const fm = md.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (fm) { fmHtml = frontMatterHtml(fm[1]); md = md.slice(fm[0].length); }
  return fmHtml + renderMdBody(md);
}
function renderMdBody(md) {
  const L = String(md || '').split('\n'); let h = '', i = 0, stack = [], para = [], quote = [];
  const inl = (t) => esc(t).split(/(`[^`]*`)/).map((s, k) => k % 2 ? `<code>${s.slice(1, -1)}</code>` : s
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![*\w])/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+|#[^)\s]*)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')).join('');
  const flushPara = () => { if (para.length) { h += `<p>${inl(para.join(' '))}</p>`; para = []; } };
  const flushQuote = () => { if (quote.length) { h += `<blockquote>${inl(quote.join(' '))}</blockquote>`; quote = []; } };
  /* lists nest by indentation: a deeper bullet opens a list inside the open item, a shallower one closes the inner lists */
  const closeList = () => { while (stack.length) h += '</li></' + stack.pop().type + '>'; };
  const ind = (s) => s.replace(/\t/g, '    ').length;
  const item = (type, indent, text) => {
    flushPara(); flushQuote();
    while (stack.length && indent < stack[stack.length - 1].indent) h += '</li></' + stack.pop().type + '>';
    const top = stack[stack.length - 1];
    if (!top || indent > top.indent) { h += `<${type}>`; stack.push({ type, indent }); }
    else { h += '</li>'; if (top.type !== type) { h += `</${top.type}><${type}>`; top.type = type; } }
    h += `<li>${inl(text)}`;
  };
  const flushAll = () => { flushPara(); flushQuote(); closeList(); };
  if (L[0] === '---') { const e = L.indexOf('---', 1); if (e > 0) i = e + 1; }
  while (i < L.length) {
    const l = L[i], t = l.trim();
    const fence = l.match(/^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)[^`]*$/);
    if (fence) {
      flushAll(); const mark = fence[1], lang = fence[2]; let src = ''; i++;
      while (i < L.length && !(new RegExp('^\\s{0,3}' + (mark[0] === '`' ? '`' : '~') + '{' + mark.length + ',}\\s*$').test(L[i]))) src += L[i++] + '\n';
      src = src.replace(/\n$/, '');
      if (lang.toLowerCase() === 'mermaid') { let svg; try { svg = diagram(src + '\n'); } catch (e) { svg = `<pre class="code">${esc(src)}</pre>`; } h += `<div class="diagram" data-src="${ea(encodeURIComponent(src))}" data-name="diagram">${svg}</div>`; }
      else {
        const lg = lang.toLowerCase(), safe = lg === 'svg' ? sanitizeMarkup(src, 'svg') : lg === 'html' ? sanitizeMarkup(src, 'html') : null;
        if (safe) h += lg === 'svg' ? `<div class="diagram fit">${DZ}${safe}</div>` : `<div class="htmlblock">${safe}</div>`;
        else h += `<pre class="code"><code>${esc(src)}</code></pre>`;
      }
      i++; continue;
    }
    let m;
    if (!t) { flushPara(); flushQuote(); let k = i + 1; while (k < L.length && !L[k].trim()) k++; if (!(stack.length && k < L.length && /^\s*([-*+]|\d+[.)])\s+/.test(L[k]))) closeList(); }
    else if ((m = t.match(/^(#{1,6})\s+(.*?)\s*#*$/))) { flushAll(); const n = Math.min(m[1].length, 4); h += `<h${n}>${inl(m[2])}</h${n}>`; }
    else if (/^([-*_])(\s*\1){2,}$/.test(t)) { flushAll(); h += '<hr>'; }
    else if (t.startsWith('>')) { flushPara(); closeList(); quote.push(t.replace(/^>\s?/, '')); }
    else if ((m = l.match(/^(\s*)[-*+]\s+(.*)$/))) item('ul', ind(m[1]), m[2]);
    else if ((m = l.match(/^(\s*)\d+[.)]\s+(.*)$/))) item('ol', ind(m[1]), m[2]);
    else if (t.startsWith('|')) {
      flushAll(); const rows = []; while (i < L.length && L[i].trim().startsWith('|')) rows.push(L[i++].trim()); i--;
      const cells = (r) => r.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const hasSep = rows[1] && /^\|?\s*:?-{2,}/.test(rows[1]);
      h += `<div class="table-wrap"><table><thead><tr>${cells(rows[0]).map((c) => `<th>${inl(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(hasSep ? 2 : 1).map((r) => `<tr>${cells(r).map((c) => `<td>${inl(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    else if (stack.length && /^\s{2,}\S/.test(l)) { h += ' ' + inl(t); }
    else { flushQuote(); closeList(); para.push(t); }
    i++;
  }
  flushAll(); return h;
}
const fRow = (f) => `<tr class="rowin"><td>${esc(f.name)}</td><td><div class="note">Meets (${f.m.length})</div>${ids(f.m)}</td><td><div class="note">Does not meet (${f.n.length})</div>${ids(f.n)}</td></tr>`;
const checkHead = (ev) => `<div class="panel-head"><h3>What the payloads show</h3><span class="note">Checks run on ${ev.files.length} payloads from the ${esc(ev.source)}</span></div><div class="table-wrap"><table><thead><tr><th>Check</th><th>Meets</th><th>Does not meet</th></tr></thead><tbody>`;
/* ---------- design review: the AI scans the finished design for critical and important issues, against the PRD and the chosen solutions ---------- */
const archReviewKey = () => Core.hashStr((D.archMd || '') + '|' + JSON.stringify(archDec()));
async function archReviewRun() {
  if (st.archRevBusy) return;
  if (!(D.archMd || '').trim()) return toast('There is no design to review yet');
  const A = D.archAssess, dec = A ? (A.options || []).filter((o) => archDec()[o.id] && archDec()[o.id].choice).map((o) => { const d = archDec()[o.id]; return `${o.id} ${o.topic}: ${o.question}\nChosen: ${chosenText(d)}${d.note ? '\nUser note: ' + d.note : ''}`; }).join('\n\n') : '';
  st.archRevBusy = true; st.archRevStart = Date.now(); st.archRevError = ''; if (current === 6) drawArch();
  try {
    const key = archReviewKey(), j = await aiPost('arch-review', { context: archContext(true), design: D.archMd, decisions: dec, connections: activeConns() }), r = j.review || {}, seen = new Set();
    let issues = (r.issues || []).filter((x) => x && x.text).map((x) => ({ type: ARCH_TYPES.includes(x.type) ? x.type : 'Risk', severity: x.severity === 'Critical' ? 'Critical' : 'Important', where: String(x.where || 'Design'), text: String(x.text), prompt: String(x.prompt || ''), fixes: parseFixes(x.fixes) })).map((x) => ({ ...x, key: Core.hashStr('rev|' + x.type + '|' + x.where + '|' + x.text) })).filter((x) => !seen.has(x.key) && seen.add(x.key));
    issues = mergeSimilar(issues);
    const old = D.archReview; if (old) old.issues.forEach((i) => { delete resolvedMap('arch')[i.key]; });
    D.archReview = { at: Date.now(), model: j.model || '', key, summary: String(r.summary || ''), issues }; noteArchAi(j); flush();
    toast(issues.length ? `Design review done: ${issues.length} issue${issues.length === 1 ? '' : 's'} found` : 'Design review done: no critical or important issues');
  } catch (e) { st.archRevError = e.message || String(e); }
  st.archRevBusy = false; if (current === 6) drawArch();
}
function archReviewPanel() {
  const R = D.archReview, off = AI_OFF(), busy = st.archRevBusy, stale = R && R.key !== archReviewKey();
  const [open, done] = R ? splitResolved('arch', R.issues.filter((i) => !archDis().includes(i.key))) : [[], []], shown = open.slice().sort(bySev).concat(done.slice().sort(bySev));
  const cnt = ['Critical', 'Important'].map((v) => [v, open.filter((i) => sevOf(i) === v).length]).filter((x) => x[1]);
  const head = `<div class="panel-head"><h3>Design review</h3><div class="row-actions"><span class="note">The AI checks the design against the PRD and your decisions. Only real problems are listed.</span><button class="key primary small" data-act="arch-review" type="button"${busy || off ? ' disabled' : ''}${off ? ` title="${ea(off)}"` : ''}>${R ? 'Analyze again' : 'Analyze with AI'}</button></div></div>`;
  let body = '';
  if (busy) body += `<div class="panel-body">${aiProgress('Analysis in progress: reviewing the design against the PRD and your decisions', 'Looking for contradictions with requirements and chosen solutions, uncovered requirements, missing key elements and logic problems. This usually takes one to three minutes.', st.archRevStart)}</div>`;
  if (st.archRevError) body += `<div class="panel-body"><div class="callout" role="alert">The review did not finish: ${esc(st.archRevError)} Nothing was changed.</div></div>`;
  if (!R && !busy) body += '<div class="panel-body"><p class="note">No review has run on this design yet. Press Analyze with AI.</p></div>';
  if (R) {
    body += `${stale ? '<div class="panel-body"><div class="callout">The design or your decisions changed after this review. Analyze again to refresh it.</div></div>' : ''}<div class="panel-body"><div class="chips">${cnt.map(([t, n]) => `<span class="chip sev sev-${t.toLowerCase()}">${n} ${t.toLowerCase()}</span>`).join('')}${done.length ? `<span class="chip good">${done.length} resolved</span>` : ''}${!shown.length ? '<span class="chip good">No critical or important issues</span>' : ''}<span class="note">Reviewed ${esc(fmtDate(R.at))}${R.model ? ' by ' + esc(R.model) : ''}</span></div>${R.summary ? `<p>${esc(R.summary)}</p>` : ''}</div>`;
    if (shown.length) body += `<div class="table-wrap"><table><thead><tr><th>Severity</th><th>Type</th><th>Where</th><th>Issue</th><th></th></tr></thead><tbody>${shown.map((i) => { const rs = resolvedOf('arch', i.key); return `<tr class="row-${sevOf(i).toLowerCase()}${rs ? ' resolved' : ''}"><td>${sevChip(i)}</td><td>${i.type}</td><td class="mono">${esc(i.where)}</td><td>${esc(i.text)}${rs ? resolvedBadge('arch', i) : fixesHtml(i, 'arch')}</td><td><div class="row-actions">${resolveBtn('arch', i)}<button class="link" data-archdis="${i.key}" type="button">Dismiss</button></div></td></tr>`; }).join('')}</tbody></table></div>`;
  }
  return `<div class="panel" id="arch-review-panel">${head}${body}</div>`;
}
function archPromptPanel() {
  const p = st.archProposal; let out = '';
  if (p) {
    const d = diffHtml(D.archMd || '', p.md);
    out = `<div class="panel-body"><div class="callout">${p.notes.map(esc).join('<br>')}</div></div>` + (p.applied ? `<div class="diff"><div class="note">${d.add} lines added, ${d.del} lines removed.</div>${d.html}</div><div class="panel-body"><div class="row-actions"><button class="key primary" data-act="arch-accept" type="button">Accept update</button><button class="key" data-act="arch-discard" type="button">Discard</button></div></div>` : '');
  }
  const none = D.archMd == null ? '<div class="panel-body"><div class="callout">There is no design to update yet. Generate one from the check and your choices, or start a blank one. You can write the prompt now.</div><div class="row-actions"><button class="key small" data-act="arch-blank" type="button">Start a blank design</button></div></div>' : '';
  return `<div class="panel" id="arch-prompt-panel"><div class="panel-head"><h3>Update the architecture design with a prompt</h3><span class="note">Describe a change, review the diff, then accept.</span></div>${none}<div class="panel-body"><label class="field wide"><span>What should change in the design?</span><textarea id="arch-prompt" class="prompt" rows="4" placeholder="Describe the change, for example:&#10;mark decision D2 as agreed&#10;add an open item about peak volumes">${esc(st.archPrompt || '')}</textarea></label><div class="row-actions"><button class="key primary" data-act="arch-propose" type="button"${st.archPropBusy ? ' disabled' : ''}>Propose update</button></div>${st.archPropBusy ? aiProgress('Update in progress: editing the design', 'Usually under three minutes. Nothing is changed until you accept.', st.archPropStart) : ''}</div>${out}</div>`;
}
function archToolbar() {
  const b = (a, t, off) => `<button class="key small" data-act="${a}" type="button"${off ? ' data-off="1" disabled' : ''}>${t}</button>`;
  return `<div class="row-actions">${b('arch-copy', 'Copy')}${b('arch-paste', 'Paste from clipboard')}${b('arch-undo', 'Undo replace', st.archUndo === null)}${b('arch-export', 'Export .md')}<span class="note" id="save-note">${esc(storeNote())}</span></div>`;
}
function drawArch() {
  const w = $('#arch-wrap'), ev = evidence(), md = D.archMd || '';
  const editor = st.archView === 'md' ? `<textarea id="arch-editor" class="editor" spellcheck="false" aria-label="Architecture design in Markdown">${esc(md)}</textarea>` : `<div class="doc">${md.trim() ? renderMd(md) : '<p class="note">Nothing to preview yet.</p>'}</div>`;
  w.innerHTML = `${archRefsPanel()}${archReadyPanel()}${ev ? `<div class="panel">${checkHead(ev)}${ev.checks.map(fRow).join('')}</tbody></table></div></div>` : ''}
  <div class="panel"><div class="panel-head"><h3>Architecture design</h3><div class="subtabs" role="group" aria-label="View"><button type="button" data-av="md" aria-pressed="${st.archView === 'md'}">Markdown</button><button type="button" class="key small" data-arch-full onclick="event.stopPropagation(); mdFull(getCurrentArchMd(), 'Architecture design'); return false;" aria-label="Open preview in full screen" title="Open preview in full screen">Preview</button></div></div><div class="panel-body">${archToolbar()}</div>${editor}<div class="coverage">Edit here, or export the Markdown, edit it in another tool and paste it back. Diagrams are drawn from the mermaid blocks.</div></div>
  ${archReviewPanel()}${archPromptPanel()}${archVersionsPanel()}`;
  $$('#arch-wrap .rowin').forEach((e) => e.classList.remove('rowin'));
  setBusy();
}
function r6() {
  ccSlot(6, 'arch');
  const w = $('#arch-wrap');
  if (D.archMd == null) {
    w.innerHTML = `${archRefsPanel()}${archReadyPanel()}${archPromptPanel()}${archVersionsPanel()}`;
    return;
  }
  drawArch();
}
function setArch(text, msg) {
  st.archUndo = D.archMd == null ? '' : D.archMd; D.archMd = text; st.arch = true; st.archDirty = true; st.archProposal = null;
  snapArch(msg ? msg.replace(/\.\s*Undo is available\.?/, '') : 'Replaced'); flush(); drawTabs(); if (current === 6) drawArch(); if (msg) toast(msg);
}
async function proposeArch() {
  const text = (($('#arch-prompt') || {}).value || st.archPrompt || '').trim();
  if (!text) return toast('Describe the change first'); if (!D.archMd) return toast('There is no design to update yet');
  if (st.archPropBusy) return;
  st.archPrompt = text;
  const off = AI_OFF(); if (off) { st.archProposal = { prompt: text, md: D.archMd, notes: [off], applied: false }; return drawArch(); }
  st.archProposal = null; st.archPropBusy = true; st.archPropStart = Date.now(); drawArch();
  try { const r = await aiUpdateDoc('arch', D.archMd, text, archContext(true)); st.archProposal = { prompt: text, md: r.md, notes: r.notes, applied: r.applied, base: D.archMd }; }
  catch (e) { st.archProposal = { prompt: text, md: D.archMd, notes: ['The update did not run: ' + (e.message || e) + ' Nothing was changed.'], applied: false }; }
  st.archPropBusy = false; if (current === 6) drawArch();
}
function acceptArch() {
  const p = st.archProposal; if (!p || !p.applied) return;
  if (p.base !== undefined && p.base !== D.archMd) { st.archProposal = null; drawArch(); return toast('The design changed while the update was running. Propose it again.'); }
  const nres = resolveFromProposal('arch', p); st.archUndo = D.archMd; D.archMd = p.md; st.archProposal = null; st.archPrompt = ''; st.archDirty = true; snapArch('Update: ' + String((p.prompt || '').split('\n')[0]).slice(0, 60)); flush(); drawArch(); toast('Update applied. Undo is available.' + (nres ? ` ${nres} issue${nres === 1 ? '' : 's'} marked resolved.` : ''));
}
/* ---------- architecture: AI readiness check, key options, then the design (all through the AI model) ---------- */
const ARCH_TYPES = ['Missing', 'Confirm', 'Conflict', 'Risk'];
function archContext(noDesign, noAnswers) {
  const m = model(), rows = D.matrix || [], tt = D.tests || [], a = payAnalysis(), L = [];
  if (!noDesign && D.archMd != null && D.archMd.trim()) L.push('## Current architecture design (the final document; check against it)', D.archMd.slice(0, 60000), '');
  if (D.archBase && D.archBase.md.trim()) L.push('## Baseline architecture draft (written manually by the architect, read-only; the base document and intended approach)', D.archBase.md.slice(0, 40000), '');
  L.push('## Consolidated requirement document (PRD)', D.prd, '', `## Requirements (${m.reqs.length})`, ...m.reqs.map((r) => `- ${r.id}${r.proposed ? ' (proposed, not approved)' : ''}: ${r.text}`), '');
  L.push(`## Scenario matrix (${rows.length})`);
  if (rows.length) rows.forEach((s) => L.push(`- ${s.id} | ${s.ch} | ${s.kind} | ${s.prio} | ${s.reqs.join('/')} | ${s.title} => ${s.expect}`)); else L.push('Not available: no scenario matrix has been created.');
  L.push('', `## Test cases (${tt.length}) (optional)`);
  if (tt.length) tt.forEach((t) => L.push(`- ${t.id} | ${t.scenario} | ${t.drives} | ${t.prio} | ${t.status} | ${t.title}`)); else L.push('Not available. Test cases are optional and were skipped.');
  L.push('', '## Payload library digest (optional)');
  if (!a) L.push('Not available. Payloads are optional and were skipped.');
  else {
    const top = (arr, n, f) => arr.slice(0, n).map(f);
    L.push(`${a.matches.length} payload files; ${a.covered} of ${a.total} scenarios have a payload.`, 'Entities and fields:');
    top(a.er.entities, 25, (e) => `- ${e.name}: ${top(e.fields, 20, (f) => f.name + (f.type ? ' (' + String(f.type).split(' or ')[0] + ')' : '')).join(', ')}`).forEach((x) => L.push(x));
    if (a.patterns.length) { L.push('Common call patterns:'); top(a.patterns, 10, (p) => `- ${p.count} x ${p.signature}`).forEach((x) => L.push(x)); }
    if (a.exceptions.length) { L.push('Exceptions:'); top(a.exceptions, 15, (x) => `- ${x.key}: ${x.why}`).forEach((x) => L.push(x)); }
    if (a.findings.length) { L.push('Findings against the matrix:'); top(a.findings, 25, (f) => `- ${f.type} ${f.where}: ${f.text}`).forEach((x) => L.push(x)); }
    if (a.inconsistencies.length) { L.push('Data inconsistencies:'); top(a.inconsistencies, 15, (i) => `- ${i.kind}: ${i.text}`).forEach((x) => L.push(x)); }
    if (a.payments.length) L.push('Payment values: ' + top(a.payments, 10, (p) => `${p.value} (${p.count})`).join(', '));
    if (a.reasons.length) L.push('Reason values: ' + top(a.reasons, 10, (p) => `${p.value} (${p.count})`).join(', '));
  }
  if (refDocs().length) { L.push('', '## Project reference documents (apply to this design only)'); let left = 80000; refDocs().forEach((r) => { const t = r.md.slice(0, Math.min(20000, left)); left -= t.length; if (t) L.push(`### ${r.name}`, t, ''); }); }
  if (activeConnNames().length) L.push('', '## Documentation connections available to you: ' + activeConnNames().join(', '));
  if (!noAnswers && archAnswersText()) L.push('', '## Answers and decisions given by the user (final; do not raise them again)', archAnswersText());
  const open = prdIssuesAll().filter((i) => !(D.dismissed || []).includes(i.key));
  if (open.length) L.push('', '## Open issues already known in the PRD', ...open.slice(0, 40).map((i) => `- ${i.type} ${i.where}: ${i.text}`));
  return L.join('\n');
}
const archKey = () => Core.hashStr(archContext(false, true));
/* the user's answers to the readiness check (which side of a conflict wins, the missing pieces) are kept as decisions, with the options, for the design */
const archAnswers = () => D.archAnswers || (D.archAnswers = {});
const ansDecision = (x) => x ? [...(x.picks || []).map((p) => p.decision || p.label), x.decision && !(x.picks || []).length ? x.decision : '', String(x.input || '').trim().replace(/\s*\n\s*/g, ' ')].filter(Boolean).join('; ') : '';
const ansHas = (x) => !!(x && x.resolved && ansDecision(x));
const archAnswersText = () => Object.values(D.archAnswers || {}).filter(ansHas).map((x) => `- [${x.type}] ${x.where}: ${x.text} => Decision: ${ansDecision(x)}`).join('\n');
const READY_TYPES = ['Conflict', 'Missing', 'Confirm'];
const readyFixes = (i) => (Array.isArray(i.fixes) ? i.fixes : []).map((f) => ({ label: oneLine((f && f.label) || '').slice(0, 80), decision: oneLine((f && (f.decision || f.prompt)) || '').slice(0, 400) })).filter((f) => f.label);
function saveAnswer(i, patch) { const o = archAnswers()[i.key] || {}, n = { ...o, ...patch, type: i.type, where: i.where, text: i.text, at: Date.now() }; if (!(n.picks || []).length && !String(n.input || '').trim() && !n.resolved) delete archAnswers()[i.key]; else archAnswers()[i.key] = n; }
const ansLine = (i, x) => `record decision: ${i.where} - ${i.text}: ${ansDecision(x)}; update the sections it affects`;
const optLine = (o, d) => `record decision ${o.id} ${o.topic}: ${chosenText(d)}${d.note ? ' (' + d.note + ')' : ''}; update the sections, diagrams and traceability it affects`;
/* after the design exists, changing a decision adds its line to the update prompt below (once) */
function promptOnce(line) { const cur = (($('#arch-prompt') || {}).value || st.archPrompt || ''); if (cur.split('\n').some((l) => l.trim() === line)) return; addToPrompt([line]); toast('Added to the update prompt'); }
function readyIssueHtml(i, dismissed) {
  const x = archAnswers()[i.key] || {}, done = ansHas(x), fx = readyFixes(i), has = D.archMd != null, picks = x.picks || [], can = !!(picks.length || String(x.input || '').trim());
  /* same table row as Known issues and pending decisions: Severity, Type, Where, Issue (with fix options), actions */
  const row = (cell, acts, cls) => `<tr class="row-${sevOf(i).toLowerCase()}${cls || ''}"><td>${sevChip(i)}</td><td>${esc(i.type)}</td><td class="mono">${esc(i.where)}</td><td>${cell}</td><td><div class="row-actions">${acts}</div></td></tr>`;
  if (dismissed) return row(esc(i.text), `<button class="link" data-archres="${i.key}" type="button">Restore</button>`);
  /* before the design: a resolved item is shown as a decision (Change reopens it) */
  if (done && !has) return row(`${esc(i.text)}<div class="resolved-note"><span class="chip good">Resolved</span> <span class="note">Decision: ${esc(ansDecision(x))}</span></div>`, `<button class="link" data-ansedit="${ea(i.key)}" type="button">Change</button><button class="link" data-archdis="${i.key}" type="button">Dismiss</button>`, ' resolved');
  const btn = has ? `<button class="key primary small" type="button" data-ansadd="${ea(i.key)}"${can ? '' : ' disabled'}>Add my fix</button>` : `<button class="key primary small" type="button" data-ansres="${ea(i.key)}"${can ? '' : ' disabled'}>Mark resolved</button>`;
  const note = has ? (done ? 'Saved as a decision and added to the update prompt. Change the selection and add it again to update.' : 'Adds the fix to the update prompt below and saves it as a decision.') : 'Select one or more suggested changes, or write your own, then mark it resolved: it is saved as a decision. Every item must be resolved or dismissed before the design is generated.';
  return row(`${esc(i.text)}${done ? ' <span class="chip good">Saved</span>' : ''}<div class="fixes"><span class="note">${i.type === 'Conflict' ? 'Which one wins?' : 'Fix options:'}</span>${fx.map((f, k) => { const on = picks.some((p) => p.label === f.label); return `<button class="key small fix${on ? ' primary' : ''}" type="button" data-ansfix="${ea(i.key)}|${k}" aria-pressed="${on}" title="${ea(f.decision)}">${on ? 'Selected: ' : ''}${esc(f.label)}</button>`; }).join('')}<span class="fixcustom"><input type="text" class="cell" data-ansin="${ea(i.key)}" value="${ea(x.input || '')}" placeholder="Or write your own fix" aria-label="Your own fix for this item">${btn}</span></div><p class="note">${note}</p>`, `<button class="link" data-archdis="${i.key}" type="button">Dismiss</button>`);
}
const archDec = () => D.archDec || (D.archDec = {});
const archDis = () => D.archDismissed || (D.archDismissed = []);
const archUndecided = () => ((D.archAssess || {}).options || []).filter((o) => { const d = archDec()[o.id]; return !(d && d.choice); });
const archMatched = () => ((D.archAssess || {}).options || []).filter((o) => (archDec()[o.id] || {}).fromBase);
function applyBaseline(options) { options.forEach((o) => { if (o.baseline && !(archDec()[o.id] && archDec()[o.id].choice)) archDec()[o.id] = { ...(archDec()[o.id] || {}), choice: o.baseline, fromBase: true }; }); }
const matchChoice = (rec, ch) => { const r = String(rec || '').trim().toLowerCase(), n = (c) => String(c.name || '').trim().toLowerCase(); if (!r) return ''; const c = ch.find((c) => n(c) === r) || ch.find((c) => n(c) && (r.includes(n(c)) || n(c).includes(r))); return c ? String(c.name) : String(rec); };
const parseArchOptions = (list) => (list || []).filter((o) => o && Array.isArray(o.choices) && o.choices.length > 1).map((o, i) => ({ id: String(o.id || 'OPT-' + (i + 1)), topic: String(o.topic || ''), question: String(o.question || ''), context: String(o.context || ''), recommended: matchChoice(o.recommended, o.choices), reason: String(o.reason || ''), baseline: (() => { const b = o.baselineChoice ? matchChoice(o.baselineChoice, o.choices) : ''; return o.choices.some((c) => String(c.name) === b) ? b : ''; })(), baselineNote: String(o.baselineNote || ''), choices: o.choices.map((c) => ({ name: String(c.name || ''), summary: String(c.summary || ''), pros: (c.pros || []).map(String), cons: (c.cons || []).map(String) })) }));
const manualOpts = () => (((D.archAssess || {}).options) || []).filter((o) => o.manual);
function keepDecisions(options) {
  /* a re-run gives new option IDs and slightly different choice names, so decisions (and confirmations) are carried over by ID, then by topic, and by a close choice name */
  const old = archDec(), prev = (D.archAssess || {}).options || [], keep = {};
  options.forEach((o) => {
    let d = old[o.id]; if (!d || !d.choice) { const p = prev.find((x) => x.topic && x.topic === o.topic && old[x.id] && old[x.id].choice); d = p ? old[p.id] : null; }
    if (!d || !d.choice) return;
    if (d.choice === 'Other') { keep[o.id] = d; return; }
    const w = String(d.choice).trim().toLowerCase(), m = o.choices.find((c) => c.name === d.choice) || o.choices.find((c) => { const n = String(c.name || '').trim().toLowerCase(); return n && w && (n.includes(w) || w.includes(n)); });
    if (m) keep[o.id] = { ...d, choice: m.name };
    else if (d.confirmedBase && o.baseline) keep[o.id] = { ...d, choice: o.baseline, fromBase: false };  /* the draft's choice, already confirmed for this topic, is still the draft's choice */
  });
  D.archDec = keep;
}
/* the decisions already written in an imported or generated design, so the AI does not list them again */
function archKnownDecisions() {
  const L = (D.archMd || '').split('\n'); let out = [], lvl = 0;
  for (const l of L) { const m = l.match(/^(#{1,6})\s+(.*)$/); if (m) { if (lvl && m[1].length <= lvl) lvl = 0; if (!lvl && /decision/i.test(m[2])) lvl = m[1].length; } if (lvl) out.push(l); }
  return out.join('\n').slice(0, 12000);
}
async function archSolutions() {
  if (st.archBusy) return;
  if (!D.prd.trim() || !model().reqs.length) { toast('The PRD has no requirements yet'); return; }
  st.archBusy = 'solutions'; st.archStart = Date.now(); st.archError = ''; st.archOpen = true; if (current === 6) r6orDraw();
  try {
    const key = archKey(), j = await aiPost('arch-options', { context: archContext(), decisions: archKnownDecisions(), connections: activeConns() }), options = parseArchOptions(j.options).concat(manualOpts());
    keepDecisions(options); applyBaseline(options);
    const A = D.archAssess || { at: Date.now(), model: '', key, verdict: '', summary: '', issues: [] };
    D.archAssess = { ...A, options, optAt: Date.now(), optKey: key, optModel: j.model || '' }; noteArchAi(j);
    flush(); toast(options.length ? `${options.length} design decisions with pros and cons` : 'No open design choices found');
  } catch (e) { st.archError = e.message || String(e); }
  st.archBusy = ''; if (current === 6) r6orDraw();
}
const chosenText = (d) => { if (d.choice !== 'Other') return d.choice; const m = d.manual || {}; return `${m.name || 'Own approach'} (user's own approach)${m.summary ? ': ' + m.summary : ''}${(m.pros || []).length ? '; pros: ' + m.pros.join(', ') : ''}${(m.cons || []).length ? '; cons: ' + m.cons.join(', ') : ''}`; };
function archAddDecision() {
  const A = D.archAssess || (D.archAssess = { at: Date.now(), model: '', key: archKey(), verdict: '', summary: '', issues: [], options: [] });
  const n = A.options.filter((o) => o.manual).length + 1;
  A.options.push({ id: 'MAN-' + n, topic: 'Your decision ' + n, question: 'Describe the decision in the note, then describe your approach.', context: '', recommended: '', reason: '', manual: true, choices: [] });
  A.optAt = A.optAt || Date.now(); flush(); r6orDraw();
}
function archUseDecisions() {
  const A = D.archAssess; if (!A) return;
  const lines = (A.options || []).filter((o) => archDec()[o.id] && archDec()[o.id].choice).map((o) => optLine(o, archDec()[o.id]));
  ((D.archAssess || {}).issues || []).forEach((i) => { const x = archAnswers()[i.key]; if (ansHas(x)) lines.push(ansLine(i, x)); });
  if (!lines.length) return toast('Answer or choose something first');
  addToPrompt(lines); toast('Decisions added to the prompt');
}
async function archAssess() {
  if (st.archBusy) return;
  if (!D.prd.trim() || !model().reqs.length) { toast('The PRD has no requirements yet'); return; }
  st.archBusy = 'assess'; st.archStart = Date.now(); st.archError = ''; if (current === 6) r6orDraw();
  try {
    const key = archKey(), j = await aiPost('arch-assess', { context: archContext(), connections: activeConns() }), r = j.assessment || {}, seen = new Set();
    const issues = (r.issues || []).filter((x) => x && x.text).map((x) => ({ type: READY_TYPES.includes(x.type) ? x.type : 'Confirm', where: String(x.where || 'Documents'), text: String(x.text), fixes: readyFixes(x) })).map((x) => ({ ...x, key: Core.hashStr('arch|' + x.type + '|' + x.where + '|' + x.text) })).filter((x) => !seen.has(x.key) && seen.add(x.key));
/* safety net: no document says anything about who owns the key data, and the AI did not raise it */
    if (!issues.some((x) => /ssot|source of truth|system of record/i.test(x.where + ' ' + x.text)) && !/\bssot\b|single source of truth|source of truth|system of record/i.test(archContext(true, true))) {
      const x = { type: 'Confirm', where: 'SSoT: key data entities', text: 'No document says which system is the single source of truth (SSoT) for the key data entities (for example order, customer, product, price, inventory, payment). Name the one system that owns each, and which systems only hold read-only copies.', fixes: [] };
      x.key = Core.hashStr('arch|' + x.type + '|' + x.where + '|' + x.text); issues.unshift(x);
    }
    const options = parseArchOptions(r.options).concat(manualOpts());
    keepDecisions(options); applyBaseline(options);
    D.archAssess = { at: Date.now(), model: j.model || '', key, verdict: ['Ready', 'Ready with open items', 'Not ready'].includes(r.verdict) ? r.verdict : 'Ready with open items', summary: String(r.summary || ''), issues, options, optAt: Date.now(), optKey: key }; noteArchAi(j);
    flush(); toast(`Readiness check done: ${issues.length} to confirm, ${options.length} decisions to make`);
  } catch (e) { st.archError = e.message || String(e); }
  st.archBusy = ''; if (current === 6) r6orDraw();
}
const r6orDraw = () => { st.archOpen = true; if (D.archMd == null) r6(); else drawArch(); };
const archInputs = () => [['Baseline architecture draft', !!(D.archBase && D.archBase.md.trim()), 'optional'], ['Requirement document', !!D.prd.trim(), 'required'], ['Scenario matrix', !!D.matrix, 'recommended'], ['Test plan', tests().length > 0, 'optional'], ['Payload library', !!D.payloadImport, 'optional']];
function archReadyPanel() {
  const A = D.archAssess, busy = st.archBusy, off = AI_OFF(), key = archKey(), hasCheck = !!(A && A.verdict), stale = hasCheck && A.key !== key, optStale = A && (A.optKey || A.key) !== key;
  const inv = archInputs().map(([n, ok, lvl]) => `<span class="chip ${ok ? 'good' : lvl === 'optional' ? '' : 'warn'}">${esc(n)}: ${ok ? 'used' : lvl === 'optional' ? 'not available, skipped (optional)' : 'not available (' + lvl + ')'}</span>`).join(' ');
  const canAi = D.prd.trim() && model().reqs.length && !off && !busy;
  const dis = archDis(), live = hasCheck ? A.issues.filter((i) => !dis.includes(i.key)) : [], nDis = hasCheck ? A.issues.length - live.length : 0, shown = st.archShowDis ? (hasCheck ? A.issues.filter((i) => dis.includes(i.key)) : []) : live, nAns = live.filter((i) => ansHas(archAnswers()[i.key])).length, unans = live.length - nAns;
  const offTitle = off ? ` title="${ea(off)}"` : '';
  const head = `<div class="panel-head"><h3>1. Is the design ready to be made? (AI check)</h3><div class="row-actions"><span class="note">The AI compares your documents. Pick a fix or write your own, then Mark resolved or Dismiss.</span><button class="key${A && A.options ? '' : ' primary'} small" data-act="arch-assess" type="button"${canAi ? '' : ' disabled'}${offTitle}>${hasCheck ? 'Check again' : 'Check readiness'}</button></div></div>`;
  let body = `<div class="panel-body"><div class="chips">${inv}</div></div>`;
  if (!D.prd.trim() || !model().reqs.length) body += '<div class="panel-body"><div class="callout">The PRD with requirements is needed first.</div></div>';
  if (off) body += `<div class="panel-body"><div class="callout" role="alert">${esc(off)}</div></div>`;
  if (busy === 'assess') body += `<div class="panel-body">${aiProgress('Analysis in progress: checking the documents for the architecture design', 'Looking for missing information, items to confirm, conflicts and design options. This usually takes one to three minutes.', st.archStart)}</div>`;
  if (st.archError) body += `<div class="panel-body"><div class="callout" role="alert">The AI step did not finish: ${esc(st.archError)}</div></div>`;
  if (hasCheck) {
    body += `${stale ? '<div class="panel-body"><div class="callout">The documents changed after this check. Check again so the result matches them.</div></div>' : ''}<div class="panel-body"><div class="chips"><span class="chip verdict ${A.verdict === 'Not ready' ? 'bad' : A.verdict === 'Ready' ? 'good' : 'warn'}">${esc(A.verdict)}</span>${['Critical', 'Important', 'Minor'].map((v) => [v, live.filter((i) => sevOf(i) === v && !ansHas(archAnswers()[i.key])).length]).filter((x) => x[1]).map(([t, n]) => `<span class="chip sev sev-${t.toLowerCase()}">${n} ${t.toLowerCase()}</span>`).join('')}${nAns ? `<span class="chip good">${nAns} resolved</span>` : ''}<span class="note">Checked ${esc(fmtDate(A.at))}${A.model ? ' by ' + esc(A.model) : ''}</span></div><p>${esc(A.summary)}</p>${nDis ? `<button class="link" data-act="arch-toggle-dis" type="button">${st.archShowDis ? 'Show open issues' : `Show dismissed (${nDis})`}</button>` : ''}</div>`;
    if (shown.length) body += `<div class="table-wrap"><table><thead><tr><th>Severity</th><th>Type</th><th>Where</th><th>Issue</th><th></th></tr></thead><tbody>${shown.sort(bySev).map((i) => readyIssueHtml(i, st.archShowDis)).join('')}</tbody></table></div>`;
    else if (!nDis) body += '<div class="panel-body"><p class="note">No conflicts or missing information found.</p></div>';
  }
  let out = `<div class="panel">${head}${body}</div>`;
  const opts = (A && A.options) || [], searched = !!(A && (A.optAt || A.verdict)), pend = archUndecided();
  if (D.prd.trim() && model().reqs.length) {
    const mt = archMatched().length, sol = `<button class="key${searched ? '' : ' primary'} small" data-act="arch-solutions" type="button"${canAi ? '' : ' disabled'}${offTitle}>${searched ? 'Find solutions again' : 'Find solutions'}</button>`;
    let note = 'The AI proposes the solutions for the open design choices, with pros, cons and a recommendation. You choose one for each.';
    if (searched) note = opts.length ? `${opts.length - pend.length} of ${opts.length} decided.${mt ? ' ' + mt + ' chosen automatically from your draft.' : ''} Choose an option for each so the design follows your approach.` : 'The AI found no open design choices that need a decision.';
    const prog = busy === 'solutions' ? `<div class="panel-body">${aiProgress('Analysis in progress: finding solutions and weighing pros and cons', 'Comparing the options against the requirements, scenarios and payloads. This usually takes one to three minutes.', st.archStart)}</div>` : '';
    out += `<div class="panel"><div class="panel-head"><h3>2. Solution options, pros and cons</h3><div class="row-actions"><span class="note">${note}</span><button class="key small" data-act="arch-add-decision" type="button">Add a decision manually</button>${sol}</div></div>${optStale && searched ? '<div class="panel-body"><div class="callout">The documents changed after the solutions were found. Find them again so they match.</div></div>' : ''}${prog}${opts.map((o) => optCard(o)).join('')}</div>`;
    const gen = D.archMd == null ? 'Generate architecture design' : 'Regenerate architecture design', decided = opts.length - pend.length;
    const use = D.archMd != null && (decided > 0 || Object.values(D.archAnswers || {}).some(ansHas)) ? '<button class="key small" data-act="arch-use-decisions" type="button">Add chosen decisions to the update prompt</button>' : '';
    const why = !A ? 'Run "Check readiness" or "Find solutions" first.' : (pend.length || unans) ? `${unans ? unans + ' readiness item' + (unans === 1 ? '' : 's') + ' to resolve or dismiss' : ''}${unans && pend.length ? ' and ' : ''}${pend.length ? pend.length + ' decision' + (pend.length === 1 ? '' : 's') + ' to make' : ''} before the design can be generated.` : busy === 'gen' ? '' : 'Uses your decisions: the options (including those taken from your draft) and the resolved readiness items.';
    out += `<div class="panel"><div class="panel-head"><h3>3. Architecture design</h3><div class="row-actions">${tplSelectHtml('architecture')}${use}<button class="key primary small" data-act="arch-generate" type="button"${!A || pend.length || unans || busy ? ' disabled' : ''}>${gen}</button></div></div><div class="panel-body">${busy === 'gen' ? aiProgress('Generation in progress: writing the architecture design', 'This usually takes two to five minutes. Nothing is changed until it finishes.', st.archStart) : ''}${why ? `<p class="note">${why}</p>` : ''}${D.archMd != null ? '<p class="note">Regenerating replaces the design (Undo is available).</p>' : ''}</div></div>`;
  }
  return out;
}
function optCard(o) {
  const d = archDec()[o.id] || {};
  const mn = d.manual || {}, val = (f) => esc(f === 'pros' || f === 'cons' ? (mn[f] || []).join('\n') : mn[f] || '');
  const mf = (f, label, rows) => `<label class="field"><span>${label}</span>${rows ? `<textarea class="cell" rows="${rows}" data-manf="${ea(o.id)}|${f}">${val(f)}</textarea>` : `<input class="cell" type="text" data-manf="${ea(o.id)}|${f}" value="${val(f)}">`}</label>`;
  /* your own approach: one line when closed (name and state); opened, one row with the four fields side by side */
  const hasOwn = d.choice === 'Other' || ['name', 'summary', 'pros', 'cons'].some((f) => String(Array.isArray(mn[f]) ? mn[f].join('') : mn[f] || '').trim());
  const manual = `<details class="own${d.choice === 'Other' ? ' sel' : ''}"${hasOwn ? ' open' : ''}><summary><b>Your own approach</b> <span class="chip">Manual</span>${d.choice === 'Other' ? ' <span class="chip good">Chosen</span>' : ''}${mn.name ? ` <span class="note">${esc(mn.name)}</span>` : ''}</summary><div class="own-grid">${mf('name', 'Name', 0)}${mf('summary', 'Summary', 2)}${mf('pros', 'Pros (one per line)', 2)}${mf('cons', 'Cons (one per line)', 2)}<button class="key small${d.choice === 'Other' ? ' primary' : ''}" data-optpick="${ea(o.id)}|other" aria-pressed="${d.choice === 'Other'}" type="button">${d.choice === 'Other' ? 'Chosen' : 'Choose this'}</button></div></details>`;
  const ch = o.choices.map((c, i) => `<div class="optc${d.choice === c.name ? ' sel' : ''}"><div class="row-actions"><b>${esc(c.name)}</b>${o.recommended === c.name ? '<span class="chip good">Recommended</span>' : ''}${o.baseline === c.name ? '<span class="chip">In your draft</span>' : ''}</div><p>${esc(c.summary)}</p><div class="pc"><div><b>Pros</b><ul class="plain">${c.pros.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div><div><b>Cons</b><ul class="plain">${c.cons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div></div><button class="key small${d.choice === c.name ? ' primary' : ''}" data-optpick="${ea(o.id)}|${i}" aria-pressed="${d.choice === c.name}" type="button">${d.choice === c.name ? 'Chosen' : 'Choose this'}</button></div>`).join('');
  return `<div class="panel-body opt">${o.manual ? `<div class="row-actions"><h4>${esc(o.id)}</h4><input class="cell" type="text" aria-label="Decision title" data-mant="${ea(o.id)}|topic" value="${ea(o.topic)}"><button class="link" data-optdel="${ea(o.id)}" type="button">Remove</button></div><input class="cell" type="text" aria-label="The decision to make" placeholder="The decision to make" data-mant="${ea(o.id)}|question" value="${ea(o.question === 'Describe the decision in the note, then describe your approach.' ? '' : o.question)}">` : `<h4>${esc(o.id)}: ${esc(o.topic)}</h4><p>${esc(o.question)}</p>`}${o.context ? `<p class="note">${esc(o.context)}</p>` : ''}${d.fromBase ? `<div class="callout">Chosen automatically from your draft: ${esc(d.choice)}.${o.baselineNote ? ' ' + esc(o.baselineNote) : ''} Choose another option to change it.</div>` : ''}${ch ? `<div class="opt-grid">${ch}</div>` : ''}${manual}${o.reason ? `<p class="note">Why ${esc(o.recommended)} is recommended: ${esc(o.reason)}</p>` : ''}<label class="field wide optnote"><span>Your note (optional)</span><input class="cell" type="text" data-optnote="${ea(o.id)}" value="${ea(d.note || '')}"></label></div>`;
}
async function genArch() {
  if (st.busy || st.archBusy) return false;
  const A = D.archAssess;
  if (!A) { show(6); toast('Run "Check readiness" first. It finds what is missing and what to decide.'); return false; }
  { const un = (A.issues || []).filter((i) => !archDis().includes(i.key) && !ansHas(archAnswers()[i.key])).length; if (un) { show(6); toast(`${un} readiness item(s) still need to be resolved or dismissed`); return false; } }
  if (archUndecided().length) { show(6); toast(`${archUndecided().length} key option(s) still need a decision`); return false; }
  const off = AI_OFF(); if (off) { show(6); toast(off); return false; }
  st.archBusy = 'gen'; st.archStart = Date.now(); st.archError = ''; st.archOpen = true; show(6);
  try {
    const dec = A.options.map((o) => { const d = archDec()[o.id] || {}; return `${o.id} ${o.topic}: ${o.question}\nChosen: ${chosenText(d)}${d.note ? '\nUser note: ' + d.note : ''}`; }).join('\n\n');
    const open = A.issues.filter((i) => !archDis().includes(i.key) && !ansHas(archAnswers()[i.key])).map((i) => `- [${i.type}] ${i.where}: ${i.text}`).join('\n');
    const j = await aiPost('gen-arch', { context: archContext(true), decisions: dec, open, connections: activeConns(), template: await templateFor('architecture') });
    if (D.archMd && D.archMd !== j.markdown) st.archUndo = D.archMd;
    if (j.links && j.links.notFound && j.links.notFound.length) toast(`${j.links.notFound.length} documentation link(s) did not exist and were marked "link not found"`);
    noteArchAi(j); D.archMd = j.markdown; snapArch('Generated with ' + (j.model || aiModelFor('gen-arch'))); st.archProposal = null; st.arch = true; st.archDirty = true; st.archBusy = ''; st.archOpen = false; flush(); drawTabs(); show(6);
    st.userAi = Date.now(); archReviewRun();  /* every generation is followed by the design review (Analyze with AI) */
    return true;
  } catch (e) { st.archError = 'Design generation stopped. Nothing was changed. ' + (e.message || e); st.archBusy = ''; show(6); return false; }
}

/* ---------- global connections (MCP servers, documentation sites) and project reference documents ---------- */
let CONNS = null, connLoading = false;
async function loadConns() {
  if (store.mode !== 'server') { CONNS = []; return CONNS; }
  try { const r = await fetch('/api/connections', { cache: 'no-store' }); const j = await r.json(); CONNS = j.connections || []; st.connFile = j.file || 'connections.json'; st.cfgDir = j.configDir || ''; } catch (e) { CONNS = CONNS || []; }
  return CONNS;
}
const connList = () => CONNS || [];
const activeConns = () => ((D && D.connUse) || []).filter((id) => connList().some((c) => c.id === id));
const activeConnNames = () => activeConns().map((id) => connList().find((c) => c.id === id).name);
async function saveConns(list) {
  const r = await fetch('/api/connections', { method: 'PUT', body: JSON.stringify({ connections: list }) }), j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'The connections could not be saved');
  CONNS = j.connections || [];
}
const connEditable = (c) => ({ id: c.id, name: c.name, description: c.description, url: c.url, docs: c.docs });
function connPanelHtml() {
  if (store.mode !== 'server') return '<div class="panel-head"><h3>Reference connections</h3></div><div class="panel-body"><p class="note">Connections need the helper service. Start <span class="mono">server.py</span> and reload this page.</p></div>';
  const rows = connList().map((c) => `<tr><td><b>${esc(c.name)}</b><div class="note">${esc(c.description)}</div>${c.docs ? `<div class="note"><a href="${ea(c.docs)}" target="_blank" rel="noopener noreferrer">${esc(c.docs.replace(/^https:\/\//, ""))}</a></div>` : ""}</td><td>${c.type === 'stdio' ? 'Local MCP server' : c.type === 'site' ? 'Documentation website' : 'MCP over HTTPS'}</td><td class="mono">${esc(c.type === 'stdio' ? c.command : c.url)}${c.auth ? ' <span class="chip">has credentials on this computer</span>' : ''}${c.blocked ? ' <span class="chip warn">Not approved on this computer</span>' : ''}</td><td><div class="note" id="conn-res-${ea(c.id)}">${esc((st.connTest || {})[c.id] || '')}</div></td><td><div class="row-actions">${c.blocked ? `<button class="key small primary" data-connapprove="${ea(c.id)}" type="button" title="This program comes from the shared file and runs code on this computer">Approve</button>` : `<button class="key small" data-conntest="${ea(c.id)}" type="button">Test</button>`}<button class="key small" data-connask="${ea(c.id)}" type="button" title="Asks the AI to use this source and cite a page">Test with AI</button><button class="link" data-conndel="${ea(c.id)}" type="button">Remove</button></div></td></tr>`).join('');
  return `<div class="panel-head"><h3>Reference connections</h3><span class="note">Stored in the <span class="mono">_config</span> folder of your data folder${st.cfgDir ? ' (' + esc(st.cfgDir) + ')' : ''}, so everyone who uses the folder gets the same connections. Official documentation the AI can read while it finds solutions and writes the design, so the generated document links to the real pages. Add a documentation website (any official docs address, for example shopify.dev/docs) or an MCP server (for example Microsoft Learn). Each design chooses which ones it uses on the Architecture page.</span></div>
  ${rows ? `<div class="table-wrap"><table><thead><tr><th>Connection</th><th>Type</th><th>Address</th><th>Test result</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="panel-body"><p class="note">No connections yet.</p></div>'}
  <div class="panel-body"><div class="row-actions"><label class="field"><span>Type</span><select id="conn-new-type"><option value="site">Documentation website</option><option value="http">MCP server</option></select></label><label class="field"><span>Name</span><input id="conn-new-name" type="text" maxlength="60" placeholder="Avalara docs"></label><label class="field"><span>Address (https)</span><input id="conn-new-url" type="url" placeholder="https://shopify.dev/docs"></label><label class="field"><span>What it covers (optional)</span><input id="conn-new-desc" type="text" maxlength="200"></label><label class="field"><span>Documentation link (optional)</span><input id="conn-new-docs" type="url" placeholder="https://learn.microsoft.com/docs"></label><button class="key small" data-act="conn-try" type="button">Try connection</button><button class="key primary small" data-act="conn-add" type="button">Add connection</button></div><div id="conn-try-res" class="callout" role="status" aria-live="polite"${st.connTry ? '' : ' hidden'}>${esc(st.connTry || '')}</div><p class="note">Examples: <b>Shopify developer docs</b>, type Documentation website, <span class="mono">https://shopify.dev/docs</span>; <b>Microsoft Learn</b>, type MCP server, <span class="mono">https://learn.microsoft.com/api/mcp</span> (described at learn.microsoft.com/en-us/training/support/mcp; no sign-in needed). <button class="link" data-act="conn-example" type="button">Fill in this example</button></p><p class="note">A connection that runs a program is added by editing the shared <span class="mono">${esc(st.connFile || '_config/connections.json')}</span>; each person must press <b>Approve</b> before it runs on their computer. Tokens never go into the shared file: put them in <span class="mono">~/.dochub/connection-secrets.json</span> on your own computer. Tokens never reach the browser.</p></div>`;
}
async function renderConns() { await loadConns(); const el = $('#conn-panel'); if (el) el.innerHTML = connPanelHtml(); }
async function tryConn() {
  const urlEl = $('#conn-new-url'), url = (urlEl || {}).value.trim(), typeEl = $('#conn-new-type'), btn = $('[data-act="conn-try"]');
  const show = (m, cls) => { st.connTry = m; const e = $('#conn-try-res'); if (e) { e.textContent = m; e.className = 'callout' + (cls ? ' ' + cls : ''); e.hidden = !m; } };
  if (!/^https:\/\//i.test(url)) { show('Enter an https:// address first.', 'warn'); return toast('Enter an https:// address first'); }
  /* an address that looks like an MCP endpoint is tried as an MCP server even when the type says website */
  if (typeEl && typeEl.value === 'site' && /\/mcp\/?$/i.test(url.split('?')[0])) typeEl.value = 'http';
  if (btn) { btn.disabled = true; btn.textContent = 'Trying...'; }
  show('Connecting to ' + url + ' ... this can take up to a minute.');
  let msg = '';
  try {
    const r = await fetch('/api/connections/test', { method: 'POST', body: JSON.stringify({ url, type: (typeEl || {}).value }) }), j = await r.json().catch(() => ({}));
    msg = r.status === 404 ? 'The helper service is out of date. Close the old server.py window, start it again (start.command), reload this page and try again.' : !r.ok ? 'Failed: ' + (j.error || ('status ' + r.status)) : j.site ? `Works: the site answered${j.site.title ? ' ("' + j.site.title + '")' : ''}. Press Add connection.` : `Works: MCP server with ${(j.tools || []).length} tools (${(j.tools || []).slice(0, 5).join(', ')}${(j.tools || []).length > 5 ? ', ...' : ''}). Press Add connection.`;
    show(msg, r.ok ? 'ok' : 'warn');
  } catch (e) { msg = 'The helper service could not be reached.'; show(msg, 'warn'); }
  if (btn) { btn.disabled = false; btn.textContent = 'Try connection'; }
  toast(msg.length > 110 ? msg.slice(0, 107) + '...' : msg);
}
async function addConn() {
  const name = ($('#conn-new-name') || {}).value.trim(), url = ($('#conn-new-url') || {}).value.trim(), desc = ($('#conn-new-desc') || {}).value.trim(), docs = (($('#conn-new-docs') || {}).value || '').trim();
  if (!name || !/^https:\/\//i.test(url)) return toast('Give the connection a name and an https:// MCP server URL');
  let id = slug(name).slice(0, 30); if (!/^[a-z0-9]/.test(id)) id = 'c-' + id; while (connList().some((c) => c.id === id)) id += '-2';
  if (connList().some((c) => c.url === url)) return toast('That address is already connected');
  try { await saveConns([...connList().map(connEditable), { id, name, url, description: desc, docs, type: ($('#conn-new-type') || {}).value || 'http' }]); } catch (e) { return toast(e.message || String(e)); }
  st.connTry = ''; await renderConns(); toast('Connection added. Testing it...'); testConn(id);
}
async function delConn(id) {
  try { await saveConns(connList().filter((c) => c.id !== id).map(connEditable)); } catch (e) { return toast(e.message || String(e)); }
  renderConns();
}
async function askConn(id) {
  st.connTest = st.connTest || {}; const el = $('#conn-res-' + CSS.escape(id)), btn = $(`[data-connask="${CSS.escape(id)}"]`), off = AI_OFF();
  if (off) { st.connTest[id] = off; if (el) el.textContent = off; return toast(off); }
  if (btn) btn.disabled = true; if (el) el.textContent = 'The AI is using this source (up to a few minutes)...';
  let msg = '';
  try {
    const r = await fetch(`/api/connections/${enc(id)}/ask`, { method: 'POST' }), j = await r.json().catch(() => ({}));
    if (!r.ok) msg = 'AI test failed: ' + (j.error || r.status);
    else { const m = j.meta || {}, l = j.links || {}, used = (m.denied || []).length ? ` Blocked tools: ${m.denied.join(', ')}.` : ''; msg = `AI answer: ${j.answer}${l.checked ? ` [${l.checked} link(s) checked${(l.notFound || []).length ? ', ' + l.notFound.length + ' not found' : ', all found'}]` : ' [no link to this source was cited]'}${used}`; }
  } catch (e) { msg = 'The helper service could not be reached.'; }
  st.connTest[id] = msg; if (btn) btn.disabled = false; const e2 = $('#conn-res-' + CSS.escape(id)); if (e2) e2.textContent = msg;
}
async function testConn(id) {
  st.connTest = st.connTest || {}; const el = $('#conn-res-' + CSS.escape(id)); if (el) el.textContent = 'Connecting...';
  try { const r = await fetch(`/api/connections/${enc(id)}/test`, { method: 'POST' }), j = await r.json().catch(() => ({})); st.connTest[id] = r.ok && j.site ? `Reachable: ${j.site.title || j.site.url}` : r.ok ? `Connected: ${(j.tools || []).length} tools (${(j.tools || []).slice(0, 4).join(', ')}${(j.tools || []).length > 4 ? ', ...' : ''})` : (j.error || 'Failed'); }
  catch (e) { st.connTest[id] = 'The helper service could not be reached.'; }
  if (el) el.textContent = st.connTest[id];
}
/* project reference documents: text the AI reads as part of this design only */
const refDocs = () => D.refDocs || (D.refDocs = []);
const REF_TEXT = /\.(md|markdown|txt|csv|json|html?|xml|ya?ml)$/i;
const safeFile = (n) => String(n).replace(/[\\/\x00:*?"<>|]/g, '-').replace(/^\.+/, '').slice(0, 150) || 'document';
function upsertRef(name, md, from) {
  name = safeFile(name); if (!/\.md$/i.test(name)) name = name.replace(/\.[^.]+$/, '') + '.md';
  const d = { name, md, size: md.length, at: Date.now(), from: from || '' }, i = refDocs().findIndex((x) => x.name === name);
  if (i >= 0) refDocs()[i] = d; else refDocs().push(d);
  return d;
}
async function addRefFiles(list) {
  let n = 0;
  for (const f of list) {
    if (f.size > 20 * 1024 * 1024) { toast(f.name + ' is larger than 20 MB'); continue; }
    let md = '';
    try {
      if (REF_TEXT.test(f.name)) md = await f.text();
      else if (store.mode === 'server') {
        const tmp = 'ref-' + uid() + '-' + safeFile(f.name);
        const up = await fetch(`/api/designs/${enc(D.id)}/sources/${enc(tmp)}`, { method: 'PUT', body: f }); if (!up.ok) throw new Error('upload failed');
        const r = await fetch(`/api/designs/${enc(D.id)}/convert/${enc(tmp)}`, { method: 'POST' }), j = await r.json().catch(() => ({}));
        fetch(`/api/designs/${enc(D.id)}/sources/${enc(tmp)}`, { method: 'DELETE' });
        if (!r.ok) throw new Error(j.error || 'conversion failed'); md = j.markdown || '';
      } else { toast(f.name + ' needs the helper service (MarkItDown) to be read'); continue; }
    } catch (e) { toast('Could not add ' + f.name + ': ' + (e.message || e)); continue; }
    if (!md.trim()) { toast(f.name + ' has no readable text'); continue; }
    upsertRef(f.name, md, f.name); n++;
  }
  if (n) { flush(); toast(`${n} reference document${n === 1 ? '' : 's'} added`); }
  if (current === 6) r6orDraw();
}
async function pasteRef() {
  let t = ''; try { t = await navigator.clipboard.readText(); } catch (e) { return toast('The clipboard could not be read'); }
  if (!t.trim()) return toast('The clipboard is empty');
  const first = (t.trim().split('\n')[0] || '').replace(/^#+\s*/, '').trim().slice(0, 60);
  upsertRef((first || 'Pasted reference ' + (refDocs().length + 1)) + '.md', t, 'pasted'); flush(); toast('Reference document added'); if (current === 6) r6orDraw();
}
const archBaseSet = (name, md, from) => { D.archBase = { name: safeFile(name), md, size: md.length, at: Date.now(), from: from || '' }; flush(); toast('Baseline draft added. Check readiness again so the AI uses it.'); if (current === 6) r6orDraw(); };
async function fileToMd(f) {
  if (f.size > 20 * 1024 * 1024) throw new Error(f.name + ' is larger than 20 MB');
  if (REF_TEXT.test(f.name)) return f.text();
  if (store.mode !== 'server') throw new Error(f.name + ' needs the helper service (MarkItDown) to be read');
  const tmp = 'ref-' + uid() + '-' + safeFile(f.name), up = await fetch(`/api/designs/${enc(D.id)}/sources/${enc(tmp)}`, { method: 'PUT', body: f }); if (!up.ok) throw new Error('upload failed');
  const r = await fetch(`/api/designs/${enc(D.id)}/convert/${enc(tmp)}`, { method: 'POST' }), j = await r.json().catch(() => ({}));
  fetch(`/api/designs/${enc(D.id)}/sources/${enc(tmp)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(j.error || 'conversion failed'); return j.markdown || '';
}
async function addBaseFile(f) {
  try { const md = await fileToMd(f); if (!md.trim()) return toast(f.name + ' has no readable text'); archBaseSet(f.name, md, f.name); } catch (e) { toast('Could not read ' + f.name + ': ' + (e.message || e)); }
}
async function pasteBase() {
  let t = ''; try { t = await navigator.clipboard.readText(); } catch (e) { return toast('The clipboard could not be read'); }
  if (!t.trim()) return toast('The clipboard is empty');
  archBaseSet(((t.trim().split('\n')[0] || '').replace(/^#+\s*/, '').trim().slice(0, 60) || 'Baseline architecture draft') + '.md', t, 'pasted');
}
function removeBase() {
  D.archBase = null; st.baseView = false;
  const dec = archDec(); Object.keys(dec).forEach((k) => { if (dec[k].fromBase) delete dec[k]; });
  flush(); toast('Baseline draft removed'); r6orDraw();
}
function archBasePanel() {
  const b = D.archBase;
  const act = b ? `<button class="key small" data-act="base-view" type="button">${st.baseView ? 'Hide' : 'View'}</button><button class="key small" data-act="base-remove" type="button">Remove</button>` : '';
  const body = b ? `<div class="table-wrap"><table><thead><tr><th>Draft</th><th>Size</th><th>Added</th></tr></thead><tbody><tr><td>${esc(b.name)}${b.from && b.from !== 'pasted' ? `<div class="note">from ${esc(b.from)}</div>` : ''}</td><td class="num">${Math.round(b.size / 1024) || 1} KB</td><td>${esc(fmtDate(b.at))}</td></tr></tbody></table></div>` : '<div class="panel-body"><p class="note">No draft (optional). The AI then uses the other documents.</p></div>';
  return `<div class="panel"><div class="panel-head"><h3>Baseline architecture draft (optional)</h3><div class="row-actions"><span class="note">Read-only. The AI uses it as the base for the check, solutions and design.</span>${act}<button class="key small" data-act="base-paste" type="button">Paste from clipboard</button><button class="key small" data-act="base-add" type="button">${b ? 'Replace draft' : 'Import draft'}</button></div></div>${body}${b && st.baseView ? `<div class="panel${vmode('base') === 'md' ? ' dark' : ''}"><div class="panel-head"><span class="mono">${esc(b.name)}</span><div class="row-actions"><span class="note">Read-only</span>${vmTabs('base', b.md, b.name, b.name)}</div></div>${vmBody('base', b.md)}</div>` : ''}</div>`;
}
function archRefsPanel() {
  if (CONNS === null && !connLoading) { connLoading = true; loadConns().then(() => { connLoading = false; if (current === 6 && D) r6orDraw(); }); }
  const use = new Set(D.connUse || []);
  const conns = connList().length ? connList().map((c) => `<label class="check"><input type="checkbox" data-connuse="${ea(c.id)}"${use.has(c.id) ? ' checked' : ''}${AI_OFF() ? ' disabled' : ''}> <b>${esc(c.name)}</b> <span class="note">${esc(c.description)}</span></label>`).join('') : `<p class="note">${store.mode === 'server' ? 'No connections yet. Add them on the Designs page.' : 'Connections need the helper service.'}</p>`;
  const docs = refDocs().length ? `<div class="table-wrap"><table><thead><tr><th>Document</th><th>Size</th><th>Added</th><th></th></tr></thead><tbody>${refDocs().map((r, i) => `<tr><td>${esc(r.name)}${r.from && r.from !== 'pasted' ? `<div class="note">from ${esc(r.from)}</div>` : ''}</td><td class="num">${Math.round(r.size / 1024) || 1} KB</td><td>${esc(fmtDate(r.at))}</td><td><button class="link" data-refdel="${i}" type="button">Remove</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="panel-body"><p class="note">No project documents yet.</p></div>';
  return archBasePanel() + `<div class="panel"><div class="panel-head"><h3>Documentation connections</h3><span class="note">Shared by all designs. The AI reads the ticked ones and links the pages it used.</span></div>
  <div class="panel-body"><div class="checks">${conns}</div><p class="note">${activeConns().length ? 'In use: ' + esc(activeConnNames().join(', ')) + '. The AI looks things up live and links the pages it used in a Sources section; links to those sites are checked afterwards. Runs take longer.' : 'None in use.'}</p></div></div>
  <div class="panel"><div class="panel-head"><h3>Project documents</h3><div class="row-actions"><span class="note">Apply to this design only.</span><button class="key small" data-act="ref-paste" type="button">Paste from clipboard</button><button class="key small" data-act="ref-add" type="button">Add document</button></div></div>${docs}<div class="coverage">Vendor manuals, API guides, standards or notes. Text files are read directly; Word, PDF, Excel and PowerPoint are converted with MarkItDown.</div></div>`;
}
const noteArchAi = (j) => { D.archAi = { at: Date.now(), model: (j && j.model) || store.aiModel || '', provider: store.aiProvider || '', conns: activeConnNames(), docs: refDocs().map((r) => r.name) }; };

/* ---------- export folder: a folder (for example inside OneDrive) that receives the project as Markdown files ---------- */
/* the export folder is a path on this computer, so it is kept in this browser, never in the project that teammates share */
const exportKey = () => 'dochub-export-' + (D ? D.id : '');
const exportCfg = () => { if (!D) return {}; let c = {}; try { c = JSON.parse(localStorage.getItem(exportKey()) || '{}'); } catch (e) { c = {}; } if (D.shareDir || D.shareHash || D.shareAt) { c = { dir: c.dir || D.shareDir || '', hash: c.hash || D.shareHash || {}, at: c.at || D.shareAt || 0 }; delete D.shareDir; delete D.shareHash; delete D.shareAt; exportSave(c); flush(); } return c; };
const exportSave = (c) => { try { localStorage.setItem(exportKey(), JSON.stringify(c)); } catch (e) { /* not saved */ } };
const shareDir = () => (exportCfg().dir || '').trim();
async function folderApi(op, body) {
  let r; try { r = await fetch('/api/folder/' + op, { method: 'POST', body: JSON.stringify(body) }); } catch (e) { throw new Error('The helper service could not be reached.'); }
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'The folder call failed (' + r.status + ')'); return j;
}
const b64 = (u) => { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));
const mdc = (v) => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
function matrixMd() {
  const rows = D.matrix || [];
  return `# Scenario matrix: ${D.name}\n\n${rows.length} scenarios. Edit the workbook \`scenario-matrix.xlsx\` next to this file; this table is a read-only copy.\n\n| ID | Channel | Name | Category | Type | Priority | Payload | Requirements | Scenario | Expected outcome |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |\n` + rows.map((s) => `| ${[s.id, s.ch, s.name, s.cat, s.kind, s.prio, s.so, (s.reqs || []).join(', '), s.title, s.expect].map(mdc).join(' | ')} |`).join('\n') + '\n';
}
function decisionsMd() {
  const A = D.archAssess; if (!A) return '';
  const L = [`# Readiness and design decisions: ${D.name}`, ''];
  if (A.verdict) { L.push(`**Readiness:** ${A.verdict}. ${A.summary || ''}`, ''); const live = (A.issues || []).filter((i) => !archDis().includes(i.key)); if (live.length) L.push('| Severity | Type | Where | Issue |', '| --- | --- | --- | --- |', ...live.map((i) => `| ${sevOf(i)} | ${i.type} | ${mdc(i.where)} | ${mdc(i.text)} |`), ''); }
  (A.options || []).forEach((o) => {
    const d = archDec()[o.id] || {};
    L.push(`## ${o.id}: ${o.topic}`, '', o.question, '');
    if (o.context) L.push(`*${o.context}*`, '');
    L.push('| Option | Pros | Cons |', '| --- | --- | --- |');
    o.choices.forEach((c) => L.push(`| **${mdc(c.name)}**${o.recommended === c.name ? ' (recommended)' : ''}${d.choice === c.name ? ' (chosen)' : ''}: ${mdc(c.summary)} | ${mdc(c.pros.join('; '))} | ${mdc(c.cons.join('; '))} |`));
    if (d.manual && d.manual.name) L.push(`| **${mdc(d.manual.name)}** (own approach)${d.choice === 'Other' ? ' (chosen)' : ''}: ${mdc(d.manual.summary)} | ${mdc((d.manual.pros || []).join('; '))} | ${mdc((d.manual.cons || []).join('; '))} |`);
    L.push('', `**Chosen:** ${d.choice ? chosenText(d) : 'not decided'}${d.note ? `. Note: ${d.note}` : ''}`);
    if (o.reason) L.push(`**Recommended:** ${o.recommended}. ${o.reason}`);
    L.push('');
  });
  return L.join('\n');
}
const FILE_DESC = [
  [/^README\.md$/, 'This file: what the set contains and how it was generated'],
  [/^01-sources\//, 'Source documents converted to Markdown with MarkItDown'],
  [/^02-consolidated-prd\//, 'Consolidated PRD (editable; read back)'],
  [/scenario-matrix\.xlsx$/, 'Scenario matrix workbook (editable; read back)'],
  [/scenario-matrix\.md$/, 'Scenario matrix as a table (read-only copy)'],
  [/^05-test-plan\//, 'Test plan, the baseline for the Playwright tests'],
  [/^06-payload-library\//, 'Payload analysis summary report'],
  [/architecture\.md$/, 'High-level architecture design (editable; read back)'],
  [/decisions-and-options\.md$/, 'Readiness issues, solution options with pros and cons, and the decisions made'],
  [/^08-build-plan\//, 'Build plan guardrails and agent files'],
  [/^09-references\//, 'Project reference documents used by the AI (editable; new files are picked up)'],
];
const descOf = (p) => (FILE_DESC.find(([re]) => re.test(p)) || [0, ''])[1];
function shareFiles() {
  const F = {}, T = (p, t) => { if (t && String(t).trim()) F[p] = { text: String(t) }; };
  D.sources.filter((s) => s.md).forEach((s) => T('01-sources/' + safeFile(s.name) + '.md', s.md));
  T('02-consolidated-prd/prd.md', D.prd);
  if (D.matrix) { T('04-scenario-matrix/scenario-matrix.md', matrixMd()); F['04-scenario-matrix/scenario-matrix.xlsx'] = { b64: b64(Core.xlsx(Core.matrixSheets(D.matrix, model().reqs))) }; }
  if (tests().length) T('05-test-plan/test-plan.md', planFiles().md);
  if (D.payReport) T('06-payload-library/summary-report.md', D.payReport.md);
  T('07-architecture/architecture.md', D.archMd);
  T('07-architecture/decisions-and-options.md', decisionsMd());
  if (st.build) { T('08-build-plan/guardrails.md', guardrails()); T('08-build-plan/CLAUDE.md', Core.agentFile('CLAUDE.md', model(), D.guardrails)); T('08-build-plan/AGENTS.md', Core.agentFile('AGENTS.md', model(), D.guardrails)); }
  refDocs().forEach((r) => T('09-references/' + safeFile(r.name), r.md));
  F['README.md'] = { text: shareReadme(Object.keys(F)) };
  return F;
}
function shareReadme(paths) {
  const ai = D.archAi, when = fmtDate(Date.now());
  const files = paths.slice().sort((a, b) => (a === 'README.md' ? -1 : b === 'README.md' ? 1 : a.localeCompare(b))).map((p) => `| [${p}](./${p.split('/').map(encodeURIComponent).join('/')}) | ${descOf(p)} |`).join('\n');
  const srcs = D.sources.length ? D.sources.map((s) => `| ${mdc(s.name)} | ${mdc(s.type || '')} | ${s.md ? mdc(s.engine || 'MarkItDown') : 'not converted'} |`).join('\n') : '| none | | |';
  const conns = ai && ai.conns && ai.conns.length ? ai.conns.join(', ') : (activeConnNames().join(', ') || 'none');
  const docs = refDocs().length ? refDocs().map((r) => r.name).join(', ') : 'none';
  return `# ${D.name} - design document set

Markdown copy of the design project, written by DocHub on ${when}. Saved with **Save all to folder**; edits are read back with **Sync from folder**.

## 1. Files

| File | Description |
| --- | --- |
${files}

## 2. Source files

| Source | Type | Converted by |
| --- | --- | --- |
${srcs}

## 3. References used by the AI

| Kind | Items |
| --- | --- |
| Documentation connections (MCP) | ${conns} |
| Project reference documents | ${docs} |

## 4. How the files were generated

| Step | Activity | Output |
| --- | --- | --- |
| 1 | **Convert** each source file to Markdown with MarkItDown and merge into one PRD | 01-sources, 02-consolidated-prd |
| 2 | **Read** scope, BPMN and requirements from the PRD (a view, no separate file) | 02-consolidated-prd |
| 3 | **Generate or import** the scenario matrix; link scenarios to requirements and payloads | 04-scenario-matrix |
| 4 | **Plan** one test case per scenario | 05-test-plan |
| 5 | **Analyze** payloads against the matrix and PRD | 06-payload-library |
| 6 | **Check readiness**, find solutions with pros and cons, decide, then generate the architecture | 07-architecture |
| 7 | **Plan the build** in modules and tasks | 08-build-plan |

| Item | Value |
| --- | --- |
| AI | ${store.aiProvider || 'Claude CLI'}${(ai && ai.model) || store.aiModel ? ', model ' + ((ai && ai.model) || store.aiModel) : ''} |
| Last architecture AI run | ${ai ? fmtDate(ai.at) : 'not run'} |
| People decide | AI proposes and checks; requirements, decisions and acceptance are made by people |

## 5. Editing and sync

| File | Read back on Sync from folder |
| --- | --- |
| 02-consolidated-prd/prd.md | Yes, replaces the PRD (undo available) |
| 04-scenario-matrix/scenario-matrix.xlsx | Yes, replaces the matrix |
| 07-architecture/architecture.md | Yes, replaces the design (undo available) |
| 09-references/*.md | Yes, new and changed files become reference documents |
| All other files | No. They are regenerated and overwritten on Save all to folder; edit them in the tool |

## 6. Generation rules

- **Style:** short bullets and tables, no long paragraphs, final result only.
- **Evidence:** every decision traces to requirements, scenarios or payloads; unverified items are marked "to confirm".
- **Diagrams:** Mermaid in fenced code blocks.
- **No simulation:** AI output is never faked; when AI cannot run, nothing is changed.
`;
}
async function saveToShare() {
  const dir = shareDir(); if (!dir) { openShare(); return toast('Enter the shared folder first'); }
  if (store.mode !== 'server') return toast('Run server.py to use a shared folder');
  st.shareNote = 'Saving...'; drawShare();
  try {
    const files = shareFiles(), j = await folderApi('write', { dir, files }), h = {};
    Object.entries(files).forEach(([p, v]) => { h[p] = Core.hashStr(v.text != null ? v.text : v.b64); });
    { const c = exportCfg(); c.hash = h; c.at = Date.now(); exportSave(c); } st.shareNote = `Saved ${Object.keys(files).length} files to the folder (${j.written.length} written, ${j.unchanged} unchanged).`; flush(); toast(st.shareNote);
  } catch (e) { st.shareNote = 'Not saved: ' + (e.message || e); toast(st.shareNote); }
  drawShare();
}
async function syncFromShare() {
  const dir = shareDir(); if (!dir) { openShare(); return toast('Enter the shared folder first'); }
  st.shareNote = 'Reading...'; drawShare();
  try {
    const j = await folderApi('read', { dir });
    if (!j.exists) { st.shareNote = 'The folder does not exist yet. Press Save all to folder to create it.'; drawShare(); return toast(st.shareNote); }
    const cfg = exportCfg(), H = cfg.hash = cfg.hash || {}, by = Object.fromEntries(j.files.map((f) => [f.path, f])), notes = [];
    const changed = (p, f) => { const h = Core.hashStr(f.text != null ? f.text : f.b64), c = h !== H[p]; H[p] = h; return c; };
    let f = by['02-consolidated-prd/prd.md'];
    if (f && f.text != null && changed('02-consolidated-prd/prd.md', f) && f.text !== D.prd) { snap('Before: read from shared folder'); st.undo = D.prd; D.prd = f.text; snap('Read from the shared folder'); lastPub.prd = f.text; clearPrdIssues(); notes.push('PRD'); }
    f = by['07-architecture/architecture.md'];
    if (f && f.text != null && changed('07-architecture/architecture.md', f) && f.text !== D.archMd) { st.archUndo = D.archMd == null ? '' : D.archMd; D.archMd = f.text; st.arch = true; st.archProposal = null; notes.push('architecture design'); }
    f = by['04-scenario-matrix/scenario-matrix.xlsx'];
    if (f && f.b64 && changed('04-scenario-matrix/scenario-matrix.xlsx', f)) {
      try { const x = await Core.readXlsx(unb64(f.b64)), sh = x.sheets.find((s) => /scenario/i.test(s.name)) || x.sheets[0], r = Core.matrixFromRows(sh.rows); st.matrixUndo = { rows: D.matrix, had: st.matrix }; D.matrix = r.rows; st.matrix = true; st.matrixHash = prdHash(); st.importNote = 'Read from the shared folder: ' + r.rows.length + ' scenarios.'; notes.push('scenario matrix'); } catch (e) { notes.push('scenario matrix (could not be read)'); }
    }
    j.files.filter((x) => x.path.startsWith('09-references/') && /\.md$/i.test(x.path) && x.text != null).forEach((x) => { const name = x.path.slice(14), cur = refDocs().find((r) => r.name === name); if (changed(x.path, x) && (!cur || cur.md !== x.text)) { upsertRef(name, x.text, 'shared folder'); notes.push('reference ' + name); } });
    st.shareNote = notes.length ? 'Updated from the folder: ' + notes.join(', ') + '.' : 'The folder has no newer edits.';
    if (notes.length) { rmCache = { h: null, m: null }; await flush(); drawTabs(); show(current, false); }
    toast(st.shareNote);
  } catch (e) { st.shareNote = 'Not read: ' + (e.message || e); toast(st.shareNote); }
  drawShare();
}
async function checkShare() {
  const dir = shareDir(); if (!dir) return toast('Enter the folder path first');
  try { const j = await folderApi('check', { dir }); st.shareNote = !j.exists ? 'The folder does not exist yet. It is created on the first Save all to folder.' : `The folder is ready: ${j.files.length} supported files${j.writable ? '' : ', but it is read-only'}.`; } catch (e) { st.shareNote = e.message || String(e); }
  drawShare();
}
function openShare() { const p = $('#share-panel'); if (p) { p.hidden = false; drawShare(); const i = $('#share-dir'); if (i) i.focus(); } }
function drawShare() {
  const p = $('#share-panel'); if (!p || !D) return;
  p.innerHTML = `<div class="wrap"><div class="panel"><div class="panel-head"><h3>Export folder (OneDrive)</h3><span class="note">Save the project as Markdown files in a folder, for readers.</span></div><div class="panel-body"><label class="field wide"><span>Folder path on this computer</span><input id="share-dir" type="text" value="${ea(exportCfg().dir || '')}" placeholder="/Users/you/Library/CloudStorage/OneDrive-YourOrg/Site - Library/${ea(D.name || 'Project')}"></label><div class="row-actions"><button class="key small" data-act="share-check" type="button">Check folder</button><button class="key primary small" data-act="save-all" type="button">Save all to folder</button><button class="key small" data-act="sync-folder" type="button">Sync from folder</button><button class="link" data-act="share-close" type="button">Close</button></div><p class="note">${esc(st.shareNote || (exportCfg().at ? 'Last saved ' + fmtDate(exportCfg().at) + '.' : 'Nothing saved to this folder yet.'))}</p><p class="note">Each page is saved as Markdown with a README. Edits are read back by Sync from folder.</p></div></div></div>`;
}

/* ---------- AI providers and models (global: a default and one model per step) ---------- */
let PROVS = null;
const EMPTY_PROVS = () => ({ providers: [], steps: {}, stepLabels: {}, presets: [] });
async function loadProvs() {
  if (store.mode !== 'server') { PROVS = EMPTY_PROVS(); return PROVS; }
  try { PROVS = await (await fetch('/api/providers', { cache: 'no-store' })).json(); } catch (e) { PROVS = PROVS || EMPTY_PROVS(); }
  return PROVS;
}
const provList = () => (PROVS && PROVS.providers) || [];
const provLabel = (p) => `${p.name}${p.model ? ' / ' + p.model : ''}`;
const provEditable = (p) => ({ id: p.id, name: p.name, baseUrl: p.baseUrl, model: p.model, tools: p.tools, json: p.json, maxTokens: p.maxTokens, tokenParam: p.tokenParam, authHeader: p.authHeader, apiKeyEnv: p.apiKeyEnv, temperature: p.temperature, numCtx: p.numCtx });
async function saveProvs(providers, steps) {
  const r = await fetch('/api/providers', { method: 'PUT', body: JSON.stringify({ providers, steps }) }), j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'The providers could not be saved');
  PROVS = j;
}
const stepOptions = (sel, first) => `<option value=""${sel ? '' : ' selected'}>${first}</option>` + provList().map((p) => `<option value="${ea(p.id)}"${sel === p.id ? ' selected' : ''}>${esc(provLabel(p))}</option>`).join('');
/* ---------- AI step matrix: what one call carries and returns, and whether the chosen model can take it ---------- */
/* [step, output tokens of one call (null = about the size of the document), best with, what happens when it does not fit: ctx = background shortened, batch = smaller batches, none = cannot be shortened] */
const AI_MATRIX = [
  ['gen-prd', 12000, 'Strong', 'none'], ['compose-doc', null, 'Medium', 'none'], ['analyze-prd', 3000, 'Medium', 'none'], ['scenario-plan', 800, 'Any', 'none'], ['gen-scenarios', 6000, 'Medium', 'none'],
  ['fill-scenarios', 3000, 'Medium', 'batch'], ['analyze-payloads', 3000, 'Medium', 'batch'], ['refine-test', 800, 'Any', 'none'], ['build-plan', 6000, 'Strong', 'none'],
  ['arch-assess', 4000, 'Strong', 'ctx'], ['arch-options', 6000, 'Strong', 'ctx'], ['gen-arch', 12000, 'Strong', 'ctx'], ['arch-review', 2000, 'Strong', 'ctx'], ['update-doc', null, 'Strong', 'ctx'], ['ask', 500, 'Medium', 'none'],
];
const kTok = (t) => t >= 10000 ? Math.round(t / 1000) + 'K' : t >= 1000 ? (t / 1000).toFixed(1) + 'K' : String(t);
function aiStepIn(step) {
  const T = 3, d = D && D.prd !== undefined ? D : null, prd = d ? d.prd.length : 40000, nreq = d ? model().reqs.length : 40, arch = d && d.archMd ? d.archMd.length : 0;
  let ctxLen = 0; try { ctxLen = d ? archContext(true, true).length : 150000; } catch (e) { ctxLen = 150000; }
  const doc = d ? Math.max(prd, arch) : 40000;
  const x = {
    'gen-prd': [(d && d.sources && d.sources.length ? d.sources.reduce((n, s) => n + (s.md || '').length, 0) : 120000) + 8000, 0],
    'compose-doc': [doc + 8000, 0], 'analyze-prd': [prd + 1500, 0], 'scenario-plan': [prd + nreq * 250 + 1500, 0], 'gen-scenarios': [prd + 8 * 250 + 4000, 0],
    'fill-scenarios': [100000 + nreq * 220, 0], 'analyze-payloads': [60000 + nreq * 220, 0], 'refine-test': [4000, 0], 'build-plan': [nreq * 250 + (d && d.matrix ? d.matrix.length : 60) * 300 + 3000, 0],
    'arch-assess': [ctxLen + arch + 5000, ctxLen], 'arch-options': [ctxLen + 5000, ctxLen], 'gen-arch': [ctxLen + 12000, ctxLen], 'arch-review': [ctxLen + arch + 6000, ctxLen], 'update-doc': [ctxLen + arch + 3000, ctxLen], 'ask': [3000, 0],
  }[step] || [10000, 0];
  return { chars: x[0], bg: x[1], tok: Math.ceil(x[0] / T), docTok: Math.ceil((step === 'compose-doc' ? doc : arch || 30000) / T), real: !!d };
}
function aiMatrixRows() {
  return AI_MATRIX.map(([step, outFix, best, how]) => {
    const p = aiProvFor(step), win = p.window || 128000, inp = aiStepIn(step), out = outFix == null ? Math.min(40000, inp.docTok + 300) : outFix, need = inp.tok + out;
    let fit, cls, tip, shownIn = inp.tok;
    if (need <= win * 0.75) { fit = 'Fits'; cls = 'good'; tip = best === 'Any' ? 'Any model is enough.' : best === 'Medium' ? 'A medium or strong model is enough.' : 'Best with a strong model (cloud or a large local model); weak models may skip parts.'; }
    else if (p.local && how === 'ctx' && (inp.chars - inp.bg) / 3 + out > win * 0.85) { fit = 'Too big'; cls = 'bad'; tip = 'The design itself, plus its rewrite, does not fit this window, so shortening the background cannot help. Use a cloud model or a local model with a larger context window.'; }
    else if (p.local && how === 'ctx') { const room = Math.max(0, Math.floor((win * 0.8 - out) * 3) - (inp.chars - inp.bg) - 3000), kept = inp.bg ? Math.max(0, Math.min(100, Math.round(100 * room / inp.bg))) : 0; shownIn = Math.ceil((inp.chars - inp.bg + Math.min(room, inp.bg)) / 3); fit = 'Shortened'; cls = 'warn'; tip = `Does not fit; the background is shortened automatically (about ${kept}% kept). The result may be less complete. A cloud model or a larger window gives the full result.`; }
    else if (p.local && how === 'batch') { const b = aiBudget(step, how === 'batch' ? (step === 'fill-scenarios' ? 100000 : 60000) : 0, 0); shownIn = Math.ceil(Math.min(inp.chars, b.chars + 6000) / 3); fit = 'Smaller batches'; cls = 'warn'; tip = 'Does not fit in one call; it runs in smaller batches (more calls, slower, same result).'; }
    else if (need <= win) { fit = 'Tight'; cls = 'warn'; tip = 'Close to the limit: a longer design or PRD may not fit. ' + (p.local ? 'Raise the context window if memory allows.' : ''); }
    else { fit = 'Too big'; cls = 'bad'; tip = p.local ? 'Will not fit this window and cannot be shortened. Use a cloud model, or a local model with a larger context window (set it in the provider).' : 'Will not fit this model. Use a model with a longer context.'; }
    return { step, p, inTok: shownIn, out, win, fit, cls, tip, real: inp.real };
  });
}
const AI_BEST = { Any: 'Any model; a local 7B+ is fine', Medium: 'Cloud, or local 8B+ with a 32K window', Strong: 'Cloud, or local 14B+ with a 64K window' };
/* one table: module, step, suggested model, size of one call, the model chosen (dropdown), whether it fits, and what to do */
function aiMatrixHtml() {
  const rows = aiMatrixRows(), by = Object.fromEntries(rows.map((r) => [r.step, r])), real = rows.some((r) => r.real), P = PROVS || EMPTY_PROVS();
  const best = Object.fromEntries(AI_MATRIX.map((m) => [m[0], m[2]]));
  const body = stepGroups(P.stepLabels).map(([t, ks]) => [t, ks.filter(([k]) => by[k])]).filter(([, ks]) => ks.length).map(([t, ks]) => `<tr><th colspan="8" class="grp">${esc(t)}</th></tr>` + ks.map(([k, v]) => { const r = by[k]; return `<tr><td>${esc(v)}</td><td class="note">${esc(AI_BEST[best[k]] || '')}</td><td>about ${kTok(r.inTok)}</td><td>about ${kTok(r.out)}</td><td>${kTok(r.win)}${r.p.local ? ' <span class="chip">local</span>' : ''}</td><td><select data-stepsel="${ea(k)}" aria-label="Model for ${ea(v)}">${stepOptions((P.steps || {})[k] || '', 'Same as the default')}</select></td><td><span class="chip ${r.cls}">${esc(r.fit)}</span></td><td>${esc(r.tip)}</td></tr>`; }).join('')).join('');
  return `<h4>Model for each step, and whether it fits</h4><p class="note">About 3 characters per token. ${real ? 'Sizes come from the open design.' : 'No design is open: typical sizes are used.'} Pick a model per step.</p>
  <div class="table-wrap"><table><thead><tr><th>Step</th><th>Suggested model</th><th>Input sent</th><th>Output</th><th>Window</th><th>Model</th><th>Fit</th><th>Suggestion</th></tr></thead><tbody><tr><td><b>Default for all steps</b></td><td></td><td></td><td></td><td></td><td><select data-stepsel="*" aria-label="Default model">${stepOptions((P.steps || {})['*'] || '', 'Claude CLI (built in)')}</select></td><td></td><td class="note">Used by every step set to "Same as the default".</td></tr>${body}</tbody></table></div>`;
}
const refreshAiMatrix = () => { const e = $('#ai-matrix'); if (e) e.innerHTML = aiMatrixHtml(); };
function provPanelHtml() {
  if (store.mode !== 'server') return '<div class="panel-head"><h3>AI models</h3></div><div class="panel-body"><p class="note">AI needs the helper service. Start <span class="mono">server.py</span> and reload this page.</p></div>';
  const P = PROVS || EMPTY_PROVS(), ed = st.provEdit && P.providers.find((p) => p.id === st.provEdit), f = ed || {};
  const rows = P.providers.map((p) => `<tr><td><b>${esc(p.name)}</b>${p.builtin ? ' <span class="chip">built in</span>' : ''}${p.builtin && p.available === false ? ' <span class="chip warn">Claude CLI not found</span>' : ''}</td><td class="mono">${esc(p.model)}</td><td class="mono">${esc(p.baseUrl)}</td><td>${p.builtin ? 'Claude CLI login or Foundry' : p.hasKey ? 'saved' : '<span class="note">none</span>'}</td><td>${p.tools ? 'Tools' : 'No tools'}${p.builtin ? '' : p.json ? ', JSON mode' : ''}</td><td><div class="note" id="prov-res-${ea(p.id)}">${esc((st.provRes || {})[p.id] || '')}</div></td><td><div class="row-actions"><button class="key small" data-provtest="${ea(p.id)}" type="button">Test</button>${p.builtin ? '' : `<button class="key small" data-provmodels="${ea(p.id)}" type="button">List models</button><button class="key small" data-provedit="${ea(p.id)}" type="button">Edit</button><button class="link" data-provdel="${ea(p.id)}" type="button">Remove</button>`}</div></td></tr>`).join('');
  const opt = (v, t, cur) => `<option value="${v}"${(cur || '') === v ? ' selected' : ''}>${t}</option>`;
  const chk = (id, t, on) => `<label class="check"><input type="checkbox" id="${id}"${on ? ' checked' : ''}> ${t}</label>`;
  const dl = (st.provModels || {})[st.provEdit || ''] || [];
  return `<div class="panel-head"><h3>AI models</h3><span class="note">Saved on this computer only. Add any OpenAI-compatible service or Ollama.</span></div>
  <div class="table-wrap"><table><thead><tr><th>Provider</th><th>Model</th><th>Address</th><th>API key</th><th>Capabilities</th><th>Test result</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
  <div class="panel-body" id="ai-matrix">${aiMatrixHtml()}</div>
  <div class="panel-body"><p class="note">Connections need a model that supports tool calls.</p></div>
  <div class="panel-body"><h4>${ed ? 'Edit provider: ' + esc(ed.name) : 'Add a provider'}</h4>
  <div class="row-actions"><label class="field"><span>Start from</span><select id="prov-preset"><option value="">Custom</option>${(P.presets || []).map((x) => `<option value="${ea(x.preset)}">${esc(x.name)}</option>`).join('')}</select></label><label class="field"><span>Name</span><input id="prov-name" type="text" maxlength="60" value="${ea(f.name || '')}"></label><label class="field"><span>Base URL</span><input id="prov-url" type="text" value="${ea(f.baseUrl || '')}" placeholder="https://api.openai.com/v1"></label><label class="field"><span>Model</span><input id="prov-model" type="text" list="prov-models" value="${ea(f.model || '')}"><datalist id="prov-models">${dl.map((m) => `<option value="${ea(m)}">`).join('')}</datalist></label><label class="field"><span>API key${ed && ed.hasKey ? ' (saved; leave empty to keep)' : ''}</span><input id="prov-key" type="password" autocomplete="off" placeholder="${ed && ed.hasKey ? '********' : 'sk-...'}"></label><label class="field"><span>or key from environment variable</span><input id="prov-keyenv" type="text" value="${ea(f.apiKeyEnv || '')}" placeholder="OPENAI_API_KEY"></label></div>
  <div class="row-actions">${chk('prov-tools', 'Supports tool calls (needed for documentation connections)', f.tools !== false)}${chk('prov-json', 'JSON mode', f.json !== false && (ed ? f.json : true))}<label class="field"><span>Max output tokens</span><input id="prov-max" type="number" min="256" max="200000" value="${ea(f.maxTokens || '')}" placeholder="provider default"></label><label class="field"><span>Context window (tokens)</span><input id="prov-ctx" type="number" min="2048" max="4000000" value="${ea(f.numCtx || '')}" placeholder="${/11434|ollama/i.test(f.baseUrl || f.name || '') ? '32768 (Ollama)' : 'default 128000'}" title="Tokens one call can hold. Ollama: higher needs more memory."></label><label class="field"><span>Token parameter</span><select id="prov-tokparam">${opt('max_tokens', 'max_tokens', f.tokenParam)}${opt('max_completion_tokens', 'max_completion_tokens', f.tokenParam)}</select></label><label class="field"><span>Key header</span><select id="prov-auth">${opt('Authorization', 'Authorization: Bearer', f.authHeader)}${opt('api-key', 'api-key (Azure)', f.authHeader)}</select></label><button class="key primary small" data-act="prov-save" type="button">${ed ? 'Save changes' : 'Add provider'}</button>${ed ? '<button class="link" data-act="prov-clear" type="button">Cancel</button>' : ''}</div>
  <p class="note">Keys are stored in <span class="mono">${esc(P.file || 'providers.json')}</span> next to <span class="mono">server.py</span> (owner-only file) and never sent back to the browser. Local servers such as Ollama need no key.</p></div>`;
}
async function renderProvs() { await loadProvs(); const el = $('#prov-panel'); if (el) el.innerHTML = provPanelHtml(); }
function fillPreset(id) {
  const x = ((PROVS || {}).presets || []).find((p) => p.preset === id); if (!x) return;
  const set = (k, v) => { const e = $('#' + k); if (e) e.value = v; }, chk = (k, v) => { const e = $('#' + k); if (e) e.checked = !!v; };
  set('prov-name', x.name); set('prov-url', x.baseUrl); set('prov-model', x.model); set('prov-tokparam', x.tokenParam); set('prov-auth', x.authHeader); chk('prov-tools', x.tools); chk('prov-json', x.json);
  const k = $('#prov-keyenv'); if (k && !k.value) k.value = ({ openai: 'OPENAI_API_KEY', deepseek: 'DEEPSEEK_API_KEY', nvidia: 'NVIDIA_API_KEY', azure: 'AZURE_OPENAI_API_KEY', 'github-models': 'GITHUB_TOKEN' })[id] || '';
}
async function saveProvider() {
  const v = (id) => (($('#' + id) || {}).value || '').trim(), name = v('prov-name'), url = v('prov-url').replace(/\/+$/, ''), model = v('prov-model');
  if (!name || !/^https?:\/\/\S+/i.test(url) || !model) return toast('Give the provider a name, a base URL (http:// or https://) and a model name');
  const P = PROVS || EMPTY_PROVS(); let id = st.provEdit;
  if (!id) { id = slug(name).slice(0, 30); if (!/^[a-z0-9]/.test(id)) id = 'p-' + id; while (id === 'claude-cli' || P.providers.some((p) => p.id === id)) id += '-2'; }
  const entry = { id, name, baseUrl: url, model, tools: $('#prov-tools').checked, json: $('#prov-json').checked, maxTokens: v('prov-max'), numCtx: v('prov-ctx'), tokenParam: v('prov-tokparam'), authHeader: v('prov-auth'), apiKeyEnv: v('prov-keyenv') };
  const key = ($('#prov-key') || {}).value || ''; if (key.trim()) entry.apiKey = key.trim();
  const list = P.providers.filter((p) => !p.builtin && p.id !== id).map(provEditable); list.push(entry);
  try { await saveProvs(list, P.steps || {}); } catch (e) { return toast(e.message || String(e)); }
  st.provEdit = ''; toast('Provider saved. Press Test to check it.'); renderProvs();
}
async function testProv(id) {
  st.provRes = st.provRes || {}; const el = $('#prov-res-' + CSS.escape(id)); if (el) el.textContent = 'Testing...';
  try { const r = await fetch(`/api/providers/${enc(id)}/test`, { method: 'POST', body: '{}' }), j = await r.json().catch(() => ({})); st.provRes[id] = r.ok ? `Works: ${(j.ms / 1000).toFixed(1)} s, ${j.outTokens} tokens out${j.inTokens ? ', ' + j.inTokens + ' in' : ''}, ${j.tps} tokens/s${j.estimated ? ' (tokens estimated from the text)' : ''}. ${j.model || ''}` : 'Failed: ' + (j.error || r.status); }
  catch (e) { st.provRes[id] = 'The helper service could not be reached.'; }
  const e2 = $('#prov-res-' + CSS.escape(id)); if (e2) e2.textContent = st.provRes[id];
}
async function listProvModels(id) {
  st.provRes = st.provRes || {}; st.provModels = st.provModels || {}; const el = $('#prov-res-' + CSS.escape(id)); if (el) el.textContent = 'Reading the model list...';
  try { const r = await fetch(`/api/providers/${enc(id)}/models`, { method: 'POST', body: '{}' }), j = await r.json().catch(() => ({})); if (r.ok) { st.provModels[id] = j.models || []; st.provRes[id] = `${(j.models || []).length} models: ${(j.models || []).slice(0, 8).join(', ')}${(j.models || []).length > 8 ? ', ...' : ''}`; } else st.provRes[id] = 'Failed: ' + (j.error || r.status); }
  catch (e) { st.provRes[id] = 'The helper service could not be reached.'; }
  const e2 = $('#prov-res-' + CSS.escape(id)); if (e2) e2.textContent = st.provRes[id];
}
async function delProv(id) {
  const P = PROVS; try { await saveProvs(P.providers.filter((p) => !p.builtin && p.id !== id).map(provEditable), P.steps || {}); } catch (e) { return toast(e.message || String(e)); }
  renderProvs();
}
async function setStepProv(step, id) {
  const P = PROVS; const steps = { ...(P.steps || {}) }; if (id) steps[step] = id; else delete steps[step];
  try { await saveProvs(P.providers.filter((p) => !p.builtin).map(provEditable), steps); toast('Saved'); drawAiBar(); setAiNow(st.aiNow || ''); refreshAiMatrix(); } catch (e) { toast(e.message || String(e)); }
}

/* ---------- fix options on AI issues: click one or write your own; each becomes a bullet in the prompt below ---------- */
/* an issue is resolved when the fix chosen for it was applied by an accepted update; the row stays in the list, marked */
const resolvedMap = (kind) => { D.resolved = D.resolved || {}; return D.resolved[kind] || (D.resolved[kind] = {}); };
const resolvedOf = (kind, key) => resolvedMap(kind)[key] || null;
const markResolved = (kind, key, fix, how) => { resolvedMap(kind)[key] = { at: Date.now(), fix: fix || '', how: how || 'update' }; };
const resolvedBadge = (kind, i) => { const r = resolvedOf(kind, i.key); return r ? `<div class="resolved-note"><span class="chip good">Resolved</span> <span class="note">${r.how === 'hand' ? 'Marked by you' : 'Fix applied'}${r.fix ? ': ' + esc(r.fix) : ''} (${esc(fmtDate(r.at))})</span></div>` : ''; };
const resolveBtn = (kind, i) => resolvedOf(kind, i.key) ? `<button class="link" data-reopen="${kind}|${ea(i.key)}" type="button">Reopen</button>` : `<button class="link" data-resolve="${kind}|${ea(i.key)}" type="button">Mark resolved</button>`;
const splitResolved = (kind, list) => [list.filter((i) => !resolvedOf(kind, i.key)), list.filter((i) => resolvedOf(kind, i.key))];
function resolveFromProposal(kind, p) {
  const bullets = String(p.prompt || '').split('\n').map((l) => l.trim()).filter((l) => /^- /.test(l));
  const flags = (p.notes || []).map(String).map((n) => n.trim()).filter((n) => /^[-\s]*(NOT DONE|DONE)\b/i.test(n)).map((n) => !/^[-\s]*NOT DONE/i.test(n));
  let ok = null;
  if (!flags.length) ok = bullets.map(() => true); else if (flags.length === bullets.length) ok = flags;
  if (!ok) { toast('The update was accepted, but the AI did not say which fixes it applied. Use Mark resolved on the issues.'); return 0; }
  let n = 0; st.fixMap = st.fixMap || {};
  bullets.forEach((b, k) => { const m = st.fixMap[b]; if (ok[k] && m && m.kind === kind && !resolvedOf(kind, m.key)) { markResolved(kind, m.key, m.label, 'update'); n++; } });
  return n;
}
const oneLine = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const parseFixes = (list) => (Array.isArray(list) ? list : []).slice(0, 4).map((f) => ({ label: oneLine(f && f.label).slice(0, 80), prompt: oneLine(f && f.prompt).slice(0, 400) })).filter((f) => f.label && f.prompt);
function fixesOf(i) {
  const f = (i.fixes || []).slice();
  if (!f.length && i.prompt) f.push({ label: 'Apply the suggested fix', prompt: oneLine(i.prompt) });
  if (!f.some((x) => /open item/i.test(x.prompt))) f.push({ label: 'Record as an open item', prompt: oneLine(`add open item: ${i.where} - ${i.text}`).slice(0, 400) });
  return f;
}
const promptEl = (kind) => $(kind === 'prd' ? '#update-prompt' : '#arch-prompt');
const promptVal = (kind) => { const e = promptEl(kind); return e ? e.value : ((kind === 'prd' ? st.promptText : st.archPrompt) || ''); };
function promptPut(kind, text) { const e = promptEl(kind); if (e) e.value = text; if (kind === 'prd') st.promptText = text; else st.archPrompt = text; }
const fixLine = (t) => '- ' + oneLine(t);
function fixesHtml(i, kind) {
  const cur = new Set(promptVal(kind).split('\n').map((l) => l.trim())), ds = kind === 'prd' ? 'data-fixkind="prd"' : 'data-fixkind="arch"';
  const chips = fixesOf(i).map((f) => { const line = fixLine(f.prompt), on = cur.has(line); return `<button class="key small fix${on ? ' primary' : ''}" type="button" data-fixline="${ea(line)}" data-fixlabel="${ea(f.label)}" data-fixkey="${ea(i.key)}" ${ds} aria-pressed="${on}" title="${ea(f.prompt)}">${on ? 'Added: ' : ''}${esc(f.label)}</button>`; }).join('');
  return `<div class="fixes"><span class="note">Fix options:</span>${chips}<span class="fixcustom"><input type="text" class="cell" data-fixin="${ea(i.key)}" placeholder="Or write your own fix" aria-label="Your own fix for this issue"><button class="key small" type="button" data-fixadd="${ea(i.key)}" data-fixwhere="${ea(oneLine(i.where))}" ${ds}>Add my fix</button></span></div>`;
}
function syncFixes() {
  const cur = { prd: new Set(promptVal('prd').split('\n').map((l) => l.trim())), arch: new Set(promptVal('arch').split('\n').map((l) => l.trim())) };
  $$('[data-fixline]').forEach((b) => { const on = cur[b.dataset.fixkind || 'prd'].has(b.dataset.fixline); b.classList.toggle('primary', on); b.setAttribute('aria-pressed', String(on)); b.textContent = (on ? 'Added: ' : '') + b.dataset.fixlabel; });
}
function toggleFix(kind, line, key, label) {
  if (key) { st.fixMap = st.fixMap || {}; st.fixMap[line] = { kind, key, label: label || '' }; }
  const lines = promptVal(kind).split('\n'), i = lines.findIndex((l) => l.trim() === line);
  if (i >= 0) lines.splice(i, 1); else { while (lines.length && !lines[lines.length - 1].trim()) lines.pop(); lines.push(line); }
  promptPut(kind, lines.join('\n')); syncFixes();
  const n = lines.filter((l) => /^- /.test(l.trim())).length, e = promptEl(kind);
  if (e) { e.classList.add('flash'); setTimeout(() => e.classList.remove('flash'), 900); }
  toast(i >= 0 ? 'Removed from the prompt' : `Added to the prompt below (${n} pending). Pick a fix for the other issues, then press Propose update.`);
}
function addCustomFix(btn) {
  const inp = btn.parentElement.querySelector('input'), text = oneLine(inp && inp.value); if (!text) return toast('Write your fix first');
  const where = btn.dataset.fixwhere; toggleFix(btn.dataset.fixkind || 'prd', fixLine(where ? `Regarding ${where}: ${text}` : text), btn.dataset.fixadd, text.slice(0, 80)); if (inp) inp.value = '';
}

/* ---------- document templates: a global library; each document type has a default, a design can pick another or let the AI decide ---------- */
let TPLS = null, tplLoading = false;
const tplText = {};
const EMPTY_TPLS = () => ({ templates: [], defaults: {}, types: {} });
async function loadTpls() {
  if (store.mode !== 'server') { TPLS = EMPTY_TPLS(); return TPLS; }
  try { TPLS = await (await fetch('/api/templates', { cache: 'no-store' })).json(); } catch (e) { TPLS = TPLS || EMPTY_TPLS(); }
  return TPLS;
}
async function tplBody(id) {
  if (tplText[id] != null) return tplText[id];
  try { const j = await (await fetch('/api/templates/' + enc(id), { cache: 'no-store' })).json(); tplText[id] = j.content || ''; } catch (e) { return ''; }
  return tplText[id];
}
const tplOfType = (type) => ((TPLS && TPLS.templates) || []).filter((t) => t.type === type);
function tplEffective(type) {
  const pick = ((D && D.tplPick) || {})[type]; if (pick === 'none') return null;
  const all = (TPLS && TPLS.templates) || [];
  return all.find((t) => t.id === pick && t.type === type) || all.find((t) => t.id === ((TPLS || {}).defaults || {})[type] && t.type === type) || null;
}
/* the template to send to the AI for a document type, or null (the AI then decides the structure from the content) */
async function templateFor(type) {
  if (!TPLS) await loadTpls();
  const t = tplEffective(type); if (!t) return null;
  const content = await tplBody(t.id); delete tplText[t.id];
  return content ? { id: t.id, name: t.name, content } : null;
}
function tplSelectHtml(type) {
  if (!TPLS && !tplLoading && store.mode === 'server') { tplLoading = true; loadTpls().then(() => { tplLoading = false; if (D) show(current, false); }); }
  const pick = ((D && D.tplPick) || {})[type] || '', defId = ((TPLS || {}).defaults || {})[type], def = ((TPLS && TPLS.templates) || []).find((t) => t.id === defId);
  return `<label class="tplsel"><span class="note">Template</span><select data-tplpick="${ea(type)}" aria-label="Template for this document"><option value=""${pick === '' || (pick === 'none' && !def) ? ' selected' : ''}>${def ? 'Default: ' + esc(def.name) : 'AI decides'}</option>${def ? `<option value="none"${pick === 'none' ? ' selected' : ''}>AI decides</option>` : ''}${tplOfType(type).map((t) => `<option value="${ea(t.id)}"${pick === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></label>`;
}
function tplPanelHtml() {
  if (store.mode !== 'server') return '<div class="panel-head"><h3>Document templates</h3></div><div class="panel-body"><p class="note">Templates need the helper service. Start <span class="mono">server.py</span> and reload this page.</p></div>';
  const T = TPLS || EMPTY_TPLS(), types = T.types || {}, ed = st.tplEdit ? T.templates.find((t) => t.id === st.tplEdit) : null;
  const rows = T.templates.map((t) => `<tr><td><b>${esc(t.name)}</b>${t.builtin ? ' <span class="chip">preset</span>' : ''}</td><td>${esc(types[t.type] || t.type)}</td><td>${(T.defaults || {})[t.type] === t.id ? '<span class="chip good">Default</span>' : ''}</td><td class="num">${Math.max(1, Math.round(t.size / 1024))} KB</td><td><div class="row-actions"><button class="key small" data-tpledit="${ea(t.id)}" type="button">Edit</button><button class="key small" data-tpldl="${ea(t.id)}" type="button">Download</button>${trashBtn('data-tpldel', t.id, 'Remove template ' + t.name, st.tplDel === t.id)}</div></td></tr>`).join('');
  const defs = Object.entries(types).map(([k, v]) => `<tr><td>${esc(v)}</td><td><select data-tpldef="${ea(k)}" aria-label="Default template for ${ea(v)}"><option value="">None: the AI decides from the content</option>${tplOfType(k).map((t) => `<option value="${ea(t.id)}"${(T.defaults || {})[k] === t.id ? ' selected' : ''}>${esc(t.name)}</option>`).join('')}</select></td></tr>`).join('');
  return `<div class="panel-head"><h3>Document templates</h3><span class="note">Stored in the <span class="mono">_config/templates</span> folder of your data folder, so everyone who uses the folder gets the same templates. The structure the AI follows when it writes a document. Without a template the AI chooses the best-fitting structure from the content.</span></div>
  <div class="table-wrap"><table><thead><tr><th>Template</th><th>For</th><th></th><th>Size</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5"><span class="note">No templates yet.</span></td></tr>'}</tbody></table></div>
  <div class="panel-body"><h4>Default for each document type</h4><div class="table-wrap"><table><thead><tr><th>Document</th><th>Default template</th></tr></thead><tbody>${defs}</tbody></table></div><p class="note">Pick another template, or let the AI decide, next to the document's button.</p></div>
  <div class="panel-body"><h4>${ed ? 'Edit template: ' + esc(ed.name) : 'Add a template'}</h4>
  <div class="row-actions"><label class="field"><span>Name</span><input id="tpl-name" type="text" maxlength="80" value="${ea(ed ? ed.name : '')}"></label><label class="field"><span>Document type</span><select id="tpl-type">${Object.entries(types).map(([k, v]) => `<option value="${ea(k)}"${ed && ed.type === k ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label><button class="key small" data-act="tpl-upload" type="button">Upload .md file</button></div>
  <label class="field wide"><span>Template (Markdown)</span><textarea id="tpl-body" class="editor short" spellcheck="false" placeholder="# Document title&#10;&#10;## 1. Summary&#10;...">${esc(st.tplBody || '')}</textarea></label>
  <div class="row-actions"><button class="key primary small" data-act="tpl-save" type="button">${ed ? 'Save changes' : 'Save template'}</button>${ed ? '<button class="link" data-act="tpl-cancel" type="button">Cancel</button>' : ''}</div>
  <p class="note">Templates are Markdown files in <span class="mono">${esc(((SET || {}).configDir || '_config') + '/templates')}</span>. The default for each type is shared too.</p></div>`;
}
async function renderTpls() { await loadTpls(); const el = $('#tpl-panel'); if (el) el.innerHTML = tplPanelHtml(); }
async function editTpl(id) {
  st.tplEdit = id; st.tplBody = await tplBody(id); delete tplText[id]; await renderTpls();
  const p = $('#tpl-panel'); if (p && p.scrollIntoView) p.scrollIntoView({ block: 'nearest' });
}
async function saveTpl() {
  const name = (($('#tpl-name') || {}).value || '').trim(), type = ($('#tpl-type') || {}).value, content = ($('#tpl-body') || {}).value || '';
  if (!name || !content.trim()) return toast('Give the template a name and its text');
  let id = st.tplEdit; if (!id) { id = slug(name).slice(0, 38); if (!/^[a-z0-9]/.test(id)) id = 't-' + id; while ((TPLS.templates || []).some((t) => t.id === id)) id += '-2'; }
  try {
    const r = await fetch('/api/templates/' + enc(id), { method: 'PUT', body: JSON.stringify({ name, type, content }) }), j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'The template could not be saved'); TPLS = j; delete tplText[id];
  } catch (e) { return toast(e.message || String(e)); }
  st.tplEdit = ''; st.tplBody = ''; toast('Template saved'); renderTpls();
}
async function delTpl(id) {
  if (st.tplDel !== id) { st.tplDel = id; setTimeout(() => { if (st.tplDel === id) { st.tplDel = ''; renderTpls(); } }, 4000); return renderTpls(); }
  st.tplDel = '';
  try { const r = await fetch('/api/templates/' + enc(id), { method: 'DELETE' }); TPLS = await r.json(); delete tplText[id]; } catch (e) { return toast('The template could not be removed'); }
  if (st.tplEdit === id) { st.tplEdit = ''; st.tplBody = ''; } renderTpls();
}
async function setTplDefault(type, id) {
  const defaults = { ...((TPLS || {}).defaults || {}) }; if (id) defaults[type] = id; else delete defaults[type];
  try { const r = await fetch('/api/templates/defaults', { method: 'PUT', body: JSON.stringify({ defaults }) }), j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Not saved'); TPLS = j; toast('Default saved'); } catch (e) { toast(e.message || String(e)); }
  renderTpls();
}
async function downloadTpl(id) { const t = await tplBody(id); delete tplText[id]; const m = ((TPLS || {}).templates || []).find((x) => x.id === id); download(slug(m ? m.name : id) + '.md', t, 'text/markdown'); }

/* ---------- Generate PRD: the AI reads all source files, merges them and writes one PRD in the template (or the best-fit structure) ---------- */
function prdGenHtml() {
  if (st.prdGenBusy) return `<div class="panel-body">${aiProgress('Generation in progress: reading the source files and writing the PRD', 'The AI merges the sources, writes the scope, the business process diagrams and every requirement. This usually takes two to six minutes.', st.prdGenStart)}</div>`;
  if (st.prdGenError) return `<div class="panel-body"><div class="callout" role="alert">The PRD was not generated: ${esc(st.prdGenError)} Nothing was changed.</div></div>`;
  if (st.prdGenNote) return `<div class="panel-body"><div class="callout${st.prdGenWarn ? ' warn' : ''}">${esc(st.prdGenNote)}</div></div>`;
  return '';
}
async function generatePrd(force) {
  if (st.prdGenBusy) return false;
  const ready = D.sources.filter((s) => s.md && s.md.trim());
  if (!ready.length) { toast(D.sources.length ? 'Convert the source files first (Convert all)' : 'Add at least one source file first'); return false; }
  if (D.prd.trim() && !force && !st.confirmMerge) { st.confirmMerge = true; r1(); setTimeout(() => { st.confirmMerge = false; if (current === 1) r1(); }, 4000); return false; }
  st.confirmMerge = false;
  const off = AI_OFF(); if (off) { st.prdGenError = off; toast(off); if (current === 1) r1(); return false; }
  st.prdGenBusy = true; st.prdGenStart = Date.now(); st.prdGenError = ''; st.prdGenNote = ''; st.prdGenWarn = false; if (current === 1) r1();
  let ok = false;
  try {
    const tpl = await templateFor('prd');
    const j = await aiPost('gen-prd', { name: D.name, sources: ready.map((s) => ({ name: s.name, md: s.md })), template: tpl });
    const md = String(j.markdown || '').replace(/^```(?:markdown|md)?\s*\n([\s\S]*)\n```\s*$/, '$1').trim() + '\n', got = Core.parsePrd(md);
    const want = new Set(ready.flatMap((s) => Core.parsePrd(s.md).reqs.map((r) => r.id).filter(Boolean))), have = new Set(got.reqs.map((r) => r.id)), missing = [...want].filter((i) => !have.has(i));
    const diagrams = got.processes.filter((p) => p.mermaid).length;
    const warn = [];
    if (!got.inScope.length && !got.outScope.length) warn.push('no scope lists were found');
    if (!got.processes.length) warn.push('no business processes were found'); else if (diagrams < got.processes.length) warn.push(`${got.processes.length - diagrams} process(es) have no diagram`);
    if (!got.reqs.length) warn.push('no requirements were found');
    if (missing.length) warn.push(`${missing.length} requirement ID(s) from the sources are not in the PRD: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', ...' : ''}`);
    setPrd(md, 'PRD generated from ' + ready.length + ' source file' + (ready.length === 1 ? '' : 's') + (tpl ? ' with the template ' + tpl.name : ''), 'Generated from ' + ready.length + ' source files');
    st.prdGenWarn = warn.length > 0;
    st.prdGenNote = `Generated by ${j.model || aiModelFor('gen-prd')}${tpl ? ' with the template "' + tpl.name + '"' : ' with a structure chosen by the AI'}: scope ${got.inScope.length} in and ${got.outScope.length} out; ${got.processes.length} business process${got.processes.length === 1 ? '' : 'es'} (${diagrams} with a diagram); ${got.reqs.length} requirements${got.reqs.some((r) => r.proposed) ? ' (some proposed)' : ''}.${warn.length ? ' Check: ' + warn.join('; ') + '. Use the update prompt to fix them.' : ' Every requirement ID from the sources is in the PRD.'}`;
    ok = true;
  } catch (e) { st.prdGenError = e.message || String(e); }
  st.prdGenBusy = false; if (current === 1) r1(); return ok;
}

/* ---------- the payload summary report is built from facts; a template reshapes it with the AI ---------- */
async function composeDoc(kind, draft, tpl) {
  const j = await aiPost('compose-doc', { kind, draft, template: tpl });
  return String(j.markdown || '').replace(/^```(?:markdown|md)?\s*\n([\s\S]*)\n```\s*$/, '$1').trim() + '\n';
}

/* ---------- data location, change capture, locking and history: the project data lives in a folder inside the user's OneDrive ---------- */
const SESSION = 's' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
let SET = null, lockTimer = null, watchTimer = null;
async function loadSet() { if (store.mode !== 'server') { SET = null; return null; } try { SET = await (await fetch('/api/settings', { cache: 'no-store' })).json(); } catch (e) { /* keep the old value */ } return SET; }
function dataPanelHtml() {
  if (store.mode !== 'server') return '<div class="panel-head"><h3>Document Repo</h3></div><div class="panel-body"><p class="note">The Document Repo needs the helper service. Start <span class="mono">server.py</span> and reload this page.</p></div>';
  const S = SET || {}, fixed = !!S.fixedByStart, rows = S.instances || [];
  const od = (x) => /^https:\/\//.test(x.webUrl || '') ? `<a class="key small linkkey" href="${ea(x.webUrl)}" target="_blank" rel="noopener noreferrer" title="Open this repo in OneDrive on the web">OneDrive</a>` : x.synced ? '<span class="chip good">OneDrive</span>' : '<span class="chip">Local folder</span>';
  const trs = rows.map((x) => `<tr class="${x.active ? 'inst-on' : ''}"><td><input type="radio" name="inst-pick" data-instsel="${ea(x.id)}" aria-label="Use ${ea(x.name)}"${x.active ? ' checked' : ''}${fixed || !x.exists ? ' disabled' : ''}></td><td>${x.builtin ? `<b>${esc(x.name)}</b>` : `<input class="cell" type="text" maxlength="60" data-instname="${ea(x.id)}" value="${ea(x.name)}" aria-label="Name of this repo">`}${x.active ? ' <span class="chip good">In use</span>' : ''}</td><td class="mono">${esc(x.path)}</td><td>${od(x)}${!x.exists ? ' <span class="chip warn">Folder not found (is OneDrive running?)</span>' : x.writable === false ? ' <span class="chip warn">Not writable</span>' : ''}</td><td>${x.projects}</td><td>${x.builtin ? '' : `<button class="link" data-instdel="${ea(x.id)}" type="button"${x.active ? ' disabled title="Select another repo first"' : ''}>Remove</button>`}</td></tr>`).join('');
  return `<div class="panel-head"><h3>Document Repo</h3><span class="note">Use one repo at a time. Switching never copies or deletes projects.</span></div>
  <div class="table-wrap"><table><thead><tr><th>Use</th><th>Name</th><th>Folder</th><th>Where</th><th>Projects</th><th></th></tr></thead><tbody>${trs}</tbody></table></div>
  <div class="panel-body">${fixed ? '<p class="note">The folder was set when the tool was started (--data-dir), so it cannot be changed here.</p>' : `<h4>Add a repo</h4><div class="row-actions"><label class="field"><span>Name</span><input id="inst-name" type="text" maxlength="60" placeholder="Team OneDrive"></label><label class="field wide"><span>Folder</span><input id="inst-dir" type="text" readonly placeholder="Choose a folder"></label><label class="field"><span>OneDrive web address (optional)</span><input id="inst-web" type="url" placeholder="https://..."></label><button class="key small" data-act="set-pick" type="button">Choose folder...</button><button class="key primary small" data-act="inst-add" type="button">Add repo</button></div>${(S.oneDrive || []).length ? `<p class="note">OneDrive folders found on this computer: ${(S.oneDrive || []).map((p) => `<button class="link" data-setstart="${ea(p)}" type="button" title="Start the folder dialog here">${esc(p.split(/[\\/]/).pop())}</button>`).join(' ')}</p>` : '<p class="note">No OneDrive folder found. Sign in to OneDrive or choose any folder.</p>'}`}
  <div class="row-actions"><label class="field"><span>Your name</span><input id="set-user" type="text" maxlength="80" value="${ea(S.userName || '')}" placeholder="${ea(S.osUser || '')}"></label><label class="field wide"><span>OneDrive web address (optional)</span><input id="set-web" type="url" value="${ea(S.webUrl || '')}" placeholder="https://yourorg-my.sharepoint.com/..."></label><button class="key small" data-act="set-save" type="button">Save</button><button class="key small" data-act="set-reveal" type="button">Show folder</button></div>
  <p class="note" id="set-note">${esc(st.setNote || '')}</p><p class="note">The application is in <span class="mono">${esc(S.appDir || '')}</span>.</p></div>
  <div class="panel-body"><h4>Sharing the folder with your team</h4><p class="note">Each teammate adds the folder to their own OneDrive, then adds it here as a repo.</p><div class="table-wrap"><table><thead><tr><th>Where the folder lives</th><th>What to do</th></tr></thead><tbody>
  <tr><td>A folder you own</td><td>Create it in OneDrive, then <b>Share</b> it with the team (edit rights for contributors, view for viewers).</td></tr>
  <tr><td>A folder someone shared with you</td><td>In OneDrive on the web open <b>Shared</b>, select the folder and choose <b>Add shortcut to My files</b>; it then syncs to your computer.</td></tr>
  <tr><td>A Teams or SharePoint library</td><td>Open the library and choose <b>Sync</b>; it appears in your OneDrive folder on this computer.</td></tr>
  </tbody></table></div></div>
  <div class="panel-body"><h4>How changes are captured</h4><div class="table-wrap"><table><thead><tr><th>Need</th><th>How</th></tr></thead><tbody>
  <tr><td><b>Who changed what, when</b></td><td>OneDrive keeps a <b>version history</b> for every file with the person who saved it (right-click a file in OneDrive on the web, <b>Version history</b>). The tool also writes an activity log in each project (opens, saves, AI runs with the model).</td></tr>
  <tr><td><b>Changes made by others</b></td><td>The tool checks the folder every 30 seconds and shows a banner when someone else saved the project (<b>Load their version</b> or <b>Keep mine</b>) or edited a file (<b>Sync now</b>).</td></tr>
  <tr><td><b>Editing together</b></td><td>A project is <b>locked</b> by the first person who opens it; others see who and since when and can open it read-only or <b>Take over</b>. A save is also refused if the file changed after you opened it. OneDrive can take seconds to share a lock, so this is a soft lock.</td></tr>
  <tr><td><b>Audit</b></td><td>The <b>History</b> button in a project shows its activity log; Microsoft's own audit log (Purview) records opens and deletes of OneDrive files for administrators.</td></tr>
  </tbody></table></div></div>`;
}
/* with the data folder inside OneDrive, OneDrive does the saving and sharing: the export, save-all and sync-from-folder buttons are only for the plain local folder */
function applyOdMode() {
  const od = !!(SET && SET.synced);
  $$('[data-localonly]').forEach((b) => { b.hidden = od; });
  if (od) { const p = $('#share-panel'); if (p) p.hidden = true; }
}
async function renderData() { await loadSet(); applyOdMode(); const el = $('#data-panel'); if (el) el.innerHTML = dataPanelHtml(); }
async function pickData(start) {
  const btn = $('[data-act="set-pick"]'); if (btn) { btn.disabled = true; btn.textContent = 'Waiting for the folder dialog...'; }
  st.setNote = 'A folder dialog opened on this computer. If you do not see it, look behind the browser window.'; const n = $('#set-note'); if (n) n.textContent = st.setNote;
  try {
    const r = await fetch('/api/pick-folder', { method: 'POST', body: JSON.stringify({ start: start || ((SET || {}).dataDir) || '' }) }), j = await r.json().catch(() => ({}));
    if (!r.ok) { if (r.status === 501) { const i = $('#inst-dir'); if (i) { i.readOnly = false; i.focus(); } } throw new Error(j.error || 'The folder dialog could not be opened'); }
    if (j.path) { const i = $('#inst-dir'), nm = $('#inst-name'); if (i) i.value = j.path; if (nm && !nm.value.trim()) nm.value = j.path.split(/[\\/]/).filter(Boolean).pop() || ''; st.setNote = 'Chosen: ' + j.path + '. Press Add repo to keep it in the list.'; } else st.setNote = 'No folder chosen.';
  } catch (e) { st.setNote = 'Not chosen: ' + (e.message || e); }
  if (btn) { btn.disabled = false; btn.textContent = 'Choose folder...'; } const n2 = $('#set-note'); if (n2) n2.textContent = st.setNote;
}
async function saveData() {
  const v = (id) => (($('#' + id) || {}).value || '').trim(), body = { userName: v('set-user'), webUrl: v('set-web') };
  try { const r = await fetch('/api/settings', { method: 'PUT', body: JSON.stringify(body) }), j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Not saved'); SET = j; st.setNote = 'Saved.'; }
  catch (e) { st.setNote = 'Not saved: ' + (e.message || e); }
  renderData();
}
/* document repos ("instances"): this computer and different OneDrive folders; exactly one is in use, and the design list shows its projects */
const instList = () => ((SET || {}).instances || []).filter((x) => !x.builtin).map((x) => ({ id: x.id, name: x.name, path: x.path, webUrl: x.webUrl || '' }));
const instActive = () => (((SET || {}).instances || []).find((x) => x.active) || { id: 'local' }).id;
async function putInstances(list, active, okNote) {
  try { const r = await fetch('/api/settings', { method: 'PUT', body: JSON.stringify({ instances: list, active }) }), j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Not saved'); SET = j; st.setNote = okNote; return true; }
  catch (e) { st.setNote = 'Not changed: ' + (e.message || e); return false; }
}
/* after the location changed: everything read from the folder is read again (designs, shared connections and templates) */
async function afterSwitch() { store.dataDir = (SET || {}).dataDir || store.dataDir; CONNS = null; TPLS = null; Object.keys(tplText).forEach((k) => delete tplText[k]); st.pickStart = ''; await renderList(); }
async function activateInstance(id) {
  const x = ((SET || {}).instances || []).find((y) => y.id === id); if (!x || x.active) return;
  const n = $('#set-note'); if (n) n.textContent = `Switching to "${x.name}"...`;
  if (await putInstances(instList(), id, `Using "${x.name}".`)) await afterSwitch(); else renderData();
}
async function addInstance() {
  const v = (id) => (($('#' + id) || {}).value || '').trim(), path = v('inst-dir'); if (!path) { st.setNote = 'Choose a folder first.'; return renderData(); }
  const name = v('inst-name') || path.split(/[\\/]/).filter(Boolean).pop() || 'Repo', list = instList(); list.push({ name, path, webUrl: v('inst-web') });
  await putInstances(list, instActive(), `Added "${name}". Select it in the Use column to switch to it.`); renderData();
}
async function renameInstance(id, name) { name = String(name || '').trim(); if (!name) return renderData(); await putInstances(instList().map((x) => x.id === id ? { ...x, name } : x), instActive(), 'Renamed.'); renderData(); }
async function removeInstance(id) {
  if (id === instActive()) { st.setNote = 'Select another repo first.'; return renderData(); }
  const x = instList().find((y) => y.id === id); await putInstances(instList().filter((y) => y.id !== id), instActive(), `Removed "${x ? x.name : ''}" from the list. Its folder and projects are untouched.`); renderData();
}
async function dataDefault() { return activateInstance('local'); }
const odFolderUrl = () => ((SET || {}).webUrl || '');

/* banners under the design bar: lock, changes by others, save conflict */
const bannerState = () => st.banner || (st.banner = {});
function drawBanner() {
  const el = $('#sync-banner'); if (!el) return; const b = bannerState(), L = [];
  if (st.readOnly) L.push(`<div class="callout warn" role="alert"><b>Read-only.</b> ${esc(b.lockBy || 'Someone')} is editing this project${b.lockSince ? ' (since ' + esc(fmtDate(b.lockSince * 1000)) + ')' : ''}. Nothing you change here is saved and AI is off. <button class="key small" data-act="lock-takeover" type="button">Take over editing</button><button class="key small" data-act="lock-retry" type="button">Try again</button></div>`);
  if (b.conflict) L.push(`<div class="callout warn" role="alert"><b>Save refused.</b> ${esc(b.conflict)} <button class="key small" data-act="conf-load" type="button">Load their version</button><button class="key small" data-act="conf-force" type="button">Overwrite with mine</button></div>`);
  else if (b.remote) L.push(`<div class="callout"><b>Changed by someone else.</b> ${esc(b.remote)} <button class="key small" data-act="conf-load" type="button">Load their version</button><button class="key small" data-act="remote-dismiss" type="button">Keep mine</button></div>`);
  if (b.copies && b.copies.length) L.push(`<div class="callout warn" role="alert"><b>OneDrive kept a conflicting copy.</b> Two computers saved at the same time: <span class="mono">${esc(b.copies.slice(0, 3).join(', '))}</span>. The tool uses <span class="mono">design.json</span>; delete the copy you do not need. <button class="key small" data-act="hist-reveal" type="button">Show folder</button></div>`);
  if (b.files && b.files.length) L.push(`<div class="callout">${b.files.length} file${b.files.length === 1 ? '' : 's'} changed in the folder: <span class="mono">${esc(b.files.slice(0, 4).join(', '))}${b.files.length > 4 ? ', ...' : ''}</span> <button class="key small" data-act="files-sync" type="button">Sync now</button><button class="key small" data-act="files-dismiss" type="button">Ignore</button></div>`);
  el.innerHTML = L.length ? `<div class="wrap">${L.join('')}</div>` : ''; el.hidden = !L.length;
}
async function lockCall(method, body) {
  if (store.mode !== 'server' || !D) return null;
  try { const r = await fetch(`/api/designs/${enc(D.id)}/lock`, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'X-Session': SESSION }, keepalive: method === 'DELETE' }); return { status: r.status, j: await r.json().catch(() => ({})) }; } catch (e) { return null; }
}
async function takeLock(take) {
  const r = await lockCall('PUT', { session: SESSION, takeOver: !!take }); if (!r) return;
  const b = bannerState();
  if (r.status === 409) { st.readOnly = true; b.lockBy = (r.j.lock || {}).user; b.lockSince = (r.j.lock || {}).since; }
  else { st.readOnly = false; b.lockBy = ''; if (take) toast('You are now editing this project'); }
  drawBanner();
}
function startWatch() {
  stopWatch(); st.treeSeen = null; st.mine = {};
  takeLock(false);
  lockTimer = setInterval(() => { if (D && !st.readOnly && !document.hidden) lockCall('PUT', { session: SESSION }); else if (D && st.readOnly && !document.hidden) takeLock(false); }, 60000);
  watchTimer = setInterval(watchOnce, 30000); setTimeout(watchOnce, 3000);
}
function stopWatch() { clearInterval(lockTimer); clearInterval(watchTimer); lockTimer = watchTimer = null; if (D && !st.readOnly) lockCall('DELETE'); st.readOnly = false; st.banner = {}; const el = $('#sync-banner'); if (el) { el.hidden = true; el.innerHTML = ''; } }
async function watchOnce() {
  if (!D || store.mode !== 'server' || document.hidden) return;
  try {
    const m = await (await fetch(`/api/designs/${enc(D.id)}/meta`, { cache: 'no-store' })).json(), b = bannerState();
    b.copies = (m && m.conflicts) || [];
    if (m && m.rev > (D.rev || 0) && !b.conflict) b.remote = `${m.savedBy || 'Someone'} saved this project at ${fmtDate(m.savedAt)}.`;
    const tree = await (await fetch(`/api/designs/${enc(D.id)}/tree`, { cache: 'no-store' })).json(), now = Object.fromEntries(tree.map((f) => [f.path, f.mtime]));
    if (!st.treeSeen) st.treeSeen = now;
    else { const ch = Object.keys(now).filter((p) => st.treeSeen[p] !== now[p] && st.mine[p] !== now[p] && /\.(md|xlsx|csv)$/i.test(p) && !/\/versions\//.test(p) && !p.startsWith('06-payload-library/')); b.files = [...new Set([...(b.files || []), ...ch])]; st.treeSeen = now; }
    drawBanner();
  } catch (e) { /* the helper may be restarting */ }
}
async function logActivity(event, detail) { if (store.mode === 'server' && D) { try { await fetch(`/api/designs/${enc(D.id)}/activity`, { method: 'POST', body: JSON.stringify({ event, detail }), keepalive: true }); } catch (e) { /* not critical */ } } }
async function historyPanel() {
  const p = $('#hist-panel'); if (!p) return; p.hidden = false; p.innerHTML = '<div class="wrap"><div class="panel"><div class="panel-body"><p class="note">Loading...</p></div></div></div>';
  await loadSet(); let ev = [], meta = null, lk = null;
  try { ev = (await (await fetch(`/api/designs/${enc(D.id)}/activity`, { cache: 'no-store' })).json()).events || []; meta = await (await fetch(`/api/designs/${enc(D.id)}/meta`, { cache: 'no-store' })).json(); lk = (await (await fetch(`/api/designs/${enc(D.id)}/lock`, { cache: 'no-store' })).json()).lock; } catch (e) { /* shown empty */ }
  const url = odFolderUrl(), rows = ev.map((e) => `<tr><td>${esc(fmtDate(e.t))}</td><td>${esc(e.user)}</td><td>${esc(e.event)}</td><td>${esc(e.detail)}</td></tr>`).join('');
  p.innerHTML = `<div class="wrap"><div class="panel"><div class="panel-head"><h3>History and activity</h3><div class="row-actions"><span class="note">${meta ? `Revision ${meta.rev}${meta.savedBy ? ', last saved by ' + esc(meta.savedBy) + ' ' + esc(fmtDate(meta.savedAt)) : ''}.` : ''} ${lk && !lk.stale ? 'Locked by ' + esc(lk.user) + '.' : 'Not locked.'}</span>${url ? `<a class="key small linkkey" href="${ea(url)}" target="_blank" rel="noopener noreferrer">Open in OneDrive</a>` : ''}<button class="key small" data-act="hist-reveal" type="button">Show folder</button><button class="link" data-act="hist-close" type="button">Close</button></div></div><div class="panel-body"><p class="note">In OneDrive on the web, right-click a file and choose <b>Version history</b>. ${url ? '' : 'Add the repo web address (Designs page) for an Open in OneDrive link.'}</p></div>${rows ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="panel-body"><p class="note">No activity yet.</p></div>'}</div></div>`;
}

/* ---------- export ---------- */
function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); }
function exportHtml(title, md) {
  const cs = getComputedStyle(document.documentElement);
  const tokens = ['paper', 'paper-2', 'paper-3', 'ink', 'ink-2', 'muted', 'rule', 'rule-2', 'accent', 'accent-wash', 'accent-deep', 'graphite', 'graphite-ink', 'graphite-muted', 'accent-2', 'glyph-2', 'glyph-3'].map((n) => `--color-${n}:${cs.getPropertyValue('--color-' + n).trim()}`).join(';');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>:root{${tokens};--font-body:system-ui,sans-serif}body{margin:0;background:var(--color-paper);color:var(--color-ink);font:16px/1.55 var(--font-body)}main{max-width:1200px;margin:0 auto;padding:32px 24px}h1,h2{line-height:1.15}h2{border-top:1px solid var(--color-rule);padding-top:16px;margin-top:32px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:8px 12px;border-bottom:1px solid var(--color-rule);vertical-align:top}th{background:var(--color-paper-2);color:var(--color-muted)}code{font-family:ui-monospace,monospace;font-size:13px}.diagram{overflow:auto;border:1px solid var(--color-rule);padding:16px;margin:12px 0}.diagram svg{display:block;max-width:100%!important;height:auto!important;margin:0 auto}td,th{overflow-wrap:anywhere}pre.code{margin:0;background:var(--color-graphite);color:var(--color-graphite-ink);padding:14px 16px;overflow:auto;font:13px/1.6 ui-monospace,monospace;border-radius:6px}pre.code{margin:12px 0}.htmlblock{border:1px solid var(--color-rule);padding:12px 16px;margin:12px 0;overflow:auto}.htmlblock img{max-width:100%;height:auto}blockquote{margin:12px 0;padding:6px 14px;background:var(--color-paper-2);border:1px solid var(--color-rule);color:var(--color-ink-2)}</style></head><body><main>${renderMd(md).replace(/<div class="dv-wait" data-mmd="([^"]*)">[^<]*<\/div>/g, (_, s) => '<pre class="code">' + esc(decodeURIComponent(s)) + '</pre>')}</main></body></html>`;
}


/* ---------- PRD library extras: versions, prompt update, exports ---------- */
const verFile = (folder, v) => `${folder}/versions/${new Date(v.t).toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${slug(v.label).slice(0, 40)}.md`;
function rewriteVersions(folder, list, text) { list.forEach((v) => put(verFile(folder, v), text(v))); }
function snap(label) {
  D.versions = D.versions || [];
  if (!D.prd.trim()) return;
  const last = D.versions[0];
  if (last && last.prd === D.prd) return;
  const v = { id: uid(), t: Date.now(), label, prd: D.prd }; D.versions.unshift(v);
  put(`02-consolidated-prd/versions/${new Date(v.t).toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${slug(label).slice(0, 40)}.md`, D.prd);
  if (D.versions.length > 500) D.versions.length = 500;
}
function diffHtml(a, b) {
  const ops = Core.diffLines(a, b), keep = new Array(ops.length).fill(false);
  ops.forEach((o, i) => { if (o.t !== ' ') for (let k = Math.max(0, i - 2); k <= Math.min(ops.length - 1, i + 2); k++) keep[k] = true; });
  let html = '', gap = false, add = 0, del = 0;
  ops.forEach((o, i) => {
    if (o.t === '+') add++; if (o.t === '-') del++;
    if (!keep[i]) { if (!gap) { html += '<div class="dgap">...</div>'; gap = true; } return; }
    gap = false;
    html += `<div class="dl ${o.t === '+' ? 'add' : o.t === '-' ? 'del' : ''}"><span class="dm">${o.t === ' ' ? '' : o.t}</span>${esc(o.s) || '&nbsp;'}</div>`;
  });
  return { html, add, del };
}
/* architecture design versions: every accepted, generated, imported or restored design, kept with its text so it can be compared with the current one */
function snapArch(label) {
  if (!D.archMd || !D.archMd.trim()) return;
  D.archVersions = D.archVersions || []; const last = D.archVersions[0];
  if (last && last.md === D.archMd) return;
  const v = { id: uid(), t: Date.now(), label, md: D.archMd }; D.archVersions.unshift(v);
  put(`07-architecture/versions/${new Date(v.t).toISOString().replace(/[-:T]/g, '').slice(0, 14)}-${slug(label).slice(0, 40)}.md`, D.archMd);
  if (D.archVersions.length > 500) D.archVersions.length = 500;
}
function archVersionsPanel() {
  const v = D.archVersions || [], unsaved = (D.archMd || '').trim() && (!v.length || v[0].md !== D.archMd);
  const rows = v.map((x) => `<tr><td>${esc(fmtDate(x.t))}</td><td>${esc(x.label)}</td><td class="num">${x.md.split('\n').length}</td><td><div class="row-actions"><button class="key small" data-avcmp="${x.id}" type="button">${st.acmp === x.id ? 'Hide changes' : 'Compare with current'}</button><button class="key small" data-avrestore="${x.id}" type="button">Restore</button></div></td></tr>`).join('');
  const c = v.find((x) => x.id === st.acmp); let d = '';
  if (c) { const r = diffHtml(c.md, D.archMd || ''); d = `<div class="diff"><div class="note">From this version to the current design: ${r.add} lines added, ${r.del} lines removed.</div>${r.html || '<div class="note">No differences.</div>'}</div>`; }
  return `<div class="panel"><div class="panel-head"><h3>Design version history (${v.length})</h3><div class="row-actions">${unsaved ? '<span class="note">The current design is not saved as a version.</span>' : ''}<button class="key small" data-act="arch-save-version" type="button">Save a version</button></div></div>${v.length ? `<div class="table-wrap"><table><thead><tr><th>Saved</th><th>What happened</th><th>Lines</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="panel-body"><p class="note">No versions yet. One is saved on generate, accepted update, import or restore.</p></div>'}${d}</div>`;
}
function versionsPanel() {
  const v = D.versions || [], unsaved = D.prd.trim() && (!v.length || v[0].prd !== D.prd);
  const rows = v.map((x) => `<tr><td>${esc(fmtDate(x.t))}</td><td>${esc(x.label)}</td><td class="num">${x.prd.split('\n').length}</td><td><div class="row-actions"><button class="key small" data-vcmp="${x.id}" type="button">${st.cmp === x.id ? 'Hide changes' : 'Compare with current'}</button><button class="key small" data-vrestore="${x.id}" type="button">Restore</button></div></td></tr>`).join('');
  const c = v.find((x) => x.id === st.cmp);
  let d = '';
  if (c) { const r = diffHtml(c.prd, D.prd); d = `<div class="diff"><div class="note">From this version to the current PRD: ${r.add} lines added, ${r.del} lines removed.</div>${r.html || '<div class="note">No differences.</div>'}</div>`; }
  return `<div class="panel"><div class="panel-head"><h3>Version history (${v.length})</h3><div class="row-actions">${unsaved ? '<span class="note">The current text is not saved as a version.</span>' : ''}<button class="key small" data-act="save-version" type="button">Save a version</button></div></div>${v.length ? `<div class="table-wrap"><table><thead><tr><th>Saved</th><th>What happened</th><th>Lines</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty"><p>No versions yet. One is saved when you merge, replace, import, accept an update, or save by hand.</p></div>'}${d}</div>`;
}
function smartPanel() {
  const p = st.proposal; let out = '';
  if (p) {
    const r = diffHtml(D.prd, p.prd);
    out = `<div class="panel-body"><div class="callout">${p.notes.map(esc).join('<br>')}</div></div>` + (p.applied ? `<div class="diff"><div class="note">${r.add} lines added, ${r.del} lines removed.</div>${r.html}</div><div class="panel-body"><div class="row-actions"><button class="key primary" data-act="accept-update" type="button">Accept update</button><button class="key" data-act="discard-update" type="button">Discard</button></div></div>` : '');
  }
  return `<div class="panel"><div class="panel-head"><h3>Update the PRD with a prompt</h3><span class="note">Describe a change, review it, then accept.</span></div><div class="panel-body"><label class="field wide"><span>What should change?</span><textarea id="update-prompt" class="prompt" rows="4" placeholder="Describe the change, for example:&#10;change R-03 so the window is 60 days&#10;remove R-05 and anything that cites it">${esc(st.promptText || '')}</textarea></label><div class="row-actions"><button class="key primary" data-act="propose" type="button"${st.proposalBusy ? ' disabled' : ''}>Propose update</button></div>${st.proposalBusy ? aiProgress('Update in progress: editing the PRD', 'Usually under two minutes. Nothing is changed until you accept.', st.proposalStart) : ''}</div>${out}</div>`;
}
function printPdf(html) {
  const w = window.open('', '_blank');
  if (!w) return toast('The pop-up was blocked. Allow pop-ups to print.');
  w.document.open(); w.document.write(html.replace('</body>', '<script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script></body>')); w.document.close();
}
function doExport(kind) {
  if (!D.prd.trim()) return toast('There is no PRD to export yet');
  const m = model(), base = slug(D.name);
  switch (kind) {
    case 'md': return download(base + '-prd.md', D.prd, 'text/markdown');
    case 'json': return download(base + '-prd.json', Core.toJson(m), 'application/json');
    case 'csv': return download(base + '-requirements.csv', '\ufeff' + Core.toCsv(m), 'text/csv');
    case 'claude': return download('CLAUDE.md', Core.agentFile('CLAUDE.md', m, D.guardrails), 'text/markdown');
    case 'agents': return download('AGENTS.md', Core.agentFile('AGENTS.md', m, D.guardrails), 'text/markdown');
    case 'pdf': return printPdf(exportHtml(D.name + ': PRD', D.prd));
  }
}
async function propose() {
  const text = ($('#update-prompt') || {}).value || st.promptText || '';
  if (!text.trim()) return toast('Describe the change first');
  if (!D.prd.trim()) return toast('There is no PRD to update yet');
  if (st.proposalBusy) return;
  const off = AI_OFF(); if (off) { st.proposal = { prompt: text, prd: D.prd, notes: [off], applied: false }; return r1(); }
  st.promptText = text; st.proposal = null; st.proposalBusy = true; st.proposalStart = Date.now(); r1();
  try { const r = await aiUpdateDoc('prd', D.prd, text); st.proposal = { prompt: text, prd: r.md, notes: r.notes, applied: r.applied, base: D.prd }; }
  catch (e) { st.proposal = { prompt: text, prd: D.prd, notes: ['The update did not run: ' + (e.message || e) + ' Nothing was changed.'], applied: false }; }
  st.proposalBusy = false; if (current === 1) r1();
}
function acceptUpdate() {
  const p = st.proposal; if (!p || !p.applied) return;
  if (p.base !== undefined && p.base !== D.prd) { st.proposal = null; r1(); return toast('The PRD changed while the update was running. Propose it again.'); }
  const nres = resolveFromProposal('prd', p); snap('Before update'); st.undo = D.prd; D.prd = p.prd; snap('Update: ' + p.prompt.split('\n')[0].slice(0, 60)); st.proposal = null; st.promptText = ''; flush(); r1(); drawTabs(); toast('Update applied. Undo is available.' + (nres ? ` ${nres} issue${nres === 1 ? '' : 's'} marked resolved.` : ''));
}
function restoreVersion(id) {
  const v = (D.versions || []).find((x) => x.id === id); if (!v) return;
  snap('Before restore'); st.undo = D.prd; D.prd = v.prd; snap('Restored the version from ' + fmtDate(v.t)); flush(); r1(); drawTabs(); toast('Version restored. Undo is available.');
}

/* ---------- stage 7: build plan ---------- */
const buildPlan = () => D.buildAi && D.buildAi.modules ? planFromAi(D.buildAi) : Core.planBuild(model(), MX());
function planFromAi(ai) {
  const reqs = Object.fromEntries(model().reqs.map((r) => [r.id, r])), sc = (id) => MX().filter((s) => (s.reqs || []).includes(id)).map((s) => s.id);
  const mods = ai.modules.map((m, i) => ({ id: 'M' + (i + 1), name: m.name, reqs: m.reqs.filter((r) => reqs[r]).map((r) => reqs[r]), depNames: m.dependsOn || [] })).filter((m) => m.reqs.length);
  const byName = Object.fromEntries(mods.map((m) => [m.name, m])); mods.forEach((m) => { m.dep = [...new Set(m.depNames.map((n) => byName[n] && byName[n].id).filter((id) => id && id !== m.id))]; });
  const wave = {}, visit = (m, path = []) => { if (wave[m.id]) return wave[m.id]; if (path.includes(m.id)) return 1; const ds = m.dep.map((d) => visit(mods.find((x) => x.id === d), [...path, m.id])); return (wave[m.id] = ds.length ? Math.max(...ds) + 1 : 1); };
  mods.forEach((m) => { m.wave = visit(m); });
  const tk = Object.fromEntries((ai.tasks || []).map((t) => [t.req, t])); let n = 0;
  mods.forEach((m) => {
    m.tasks = m.reqs.map((r) => { const t = tk[r.id] || {}, h = Math.min(24, Math.max(1, +t.hours || 3)), scn = sc(r.id), part = (f) => Math.round(h * f * 2) / 2 || 0.5; return { id: 'T-' + String(++n).padStart(2, '0'), req: r.id, title: t.title || `Implement ${r.id}`, text: r.text, hours: h, scenarios: scn, subtasks: [{ title: 'Build', hours: part(0.6) }, { title: 'Unit tests', hours: part(0.25) }, { title: scn.length ? `Verify scenarios ${scn.join(', ')}` : 'Verify (no scenario yet)', hours: part(0.15) }] }; });
    m.hours = m.tasks.reduce((x, t) => x + t.hours, 0);
  });
  const flow = ['flowchart LR', ...mods.map((m) => `  ${m.id.toLowerCase()}["${m.name.replace(/"/g, "'")} (${m.reqs.length})"]`), ...mods.flatMap((m) => m.dep.map((d) => `  ${d.toLowerCase()} --> ${m.id.toLowerCase()}`))].join('\n');
  return { modules: mods.map(({ depNames, ...r }) => r), flow, hours: mods.reduce((x, m) => x + m.hours, 0) };
}
const guardrails = () => D.guardrails != null ? D.guardrails : Core.DEFAULT_GUARDRAILS;
function buildPanels(plan) {
  const out = [], order = plan.modules.slice().sort((a, b) => a.wave - b.wave || a.id.localeCompare(b.id, undefined, { numeric: true }));
  out.push(`<div class="panel rowin"><div class="panel-head"><h3>Modules (${plan.modules.length})</h3><span class="note">Modules in the same wave can be built in parallel.</span></div>${plan.modules.length ? `<div class="table-wrap"><table><thead><tr><th>Module</th><th>Requirements</th><th>Depends on</th><th>Wave</th><th>Estimate</th></tr></thead><tbody>${plan.modules.map((m) => `<tr><td><span class="mono">${m.id}</span> ${esc(m.name)}</td><td><span class="refs">${m.reqs.map((r) => `<span class="ref">${r.id}</span>`).join('')}</span></td><td>${m.dep.length ? m.dep.map((d) => `<span class="ref">${d}</span>`).join(' ') : 'None'}</td><td class="num">${m.wave}</td><td class="num">${m.hours} h</td></tr>`).join('')}</tbody></table></div><div class="coverage">Build order: ${order.map((m) => m.id).join(', ')}. Hours are the AI's estimates, not measured effort.</div>` : '<div class="empty"><p>No requirements to group yet.</p></div>'}</div>`);
  out.push(`<div class="panel rowin"><div class="panel-head"><h3>Dependencies</h3><span class="note">An arrow means the left module is built first.</span></div><div class="diagram fit">${DZ}${flowSvg(plan.flow)}</div></div>`);
  const body = plan.modules.map((m) => `<tr class="grp"><td colspan="5"><b>Epic ${m.id}: ${esc(m.name)}</b> <span class="note">${m.tasks.length} tasks (${m.tasks.map((t) => t.id).join(', ')}), ${m.hours} h</span></td></tr>` + m.tasks.map((t) => `<tr><td class="mono">${t.id}</td><td>${esc(t.title)}<div class="note">${esc(t.text)}</div><ul class="plain sub">${t.subtasks.map((s) => `<li>${esc(s.title)} <span class="note">${s.hours} h</span></li>`).join('')}</ul></td><td class="mono">${t.req}</td><td class="num">${t.hours} h</td><td>${t.scenarios.length ? t.scenarios.join(', ') : 'None'}</td></tr>`).join('')).join('');
  out.push(`<div class="panel rowin"><div class="panel-head"><h3>Task breakdown</h3><span class="note">${plan.hours} h estimated in total</span></div><div class="table-wrap"><table><thead><tr><th>Task</th><th>What to do</th><th>Requirement</th><th>Estimate</th><th>Scenarios to verify</th></tr></thead><tbody>${body}</tbody></table></div></div>`);
  out.push(`<div class="panel rowin"><div class="panel-head"><h3>Implementation guardrails</h3><div class="row-actions"><span class="note">Written into CLAUDE.md and AGENTS.md.</span><button class="key small" data-act="reset-guardrails" type="button">Reset to default</button></div></div><textarea id="guardrails" class="editor short" spellcheck="false" aria-label="Implementation guardrails in Markdown">${esc(guardrails())}</textarea></div>`);
  return out;
}
function r7() {
  const p = $('#build-body');
  if (!st.matrix) { p.innerHTML = gate('The build plan uses the requirements and the scenario matrix. Generate those first.', 'gen3', 'Generate the scenario matrix'); return; }
  if (!st.build) { p.innerHTML = gate('Not generated yet. AI groups the requirements into modules, maps how they depend on each other, and breaks the work into tasks.', 'gen7', 'Generate build plan'); return; }
  p.innerHTML = `<div class="gap">${stale(st.buildHash)}${buildPanels(buildPlan()).join('')}</div>`;
  $$('#build-body .rowin').forEach((e) => e.classList.remove('rowin'));
}
async function genBuild() {
  if (st.busy) return;
  if (!st.matrix) { show(7); return; }
  const off = AI_OFF(); if (off) { toast(off); show(7); return false; }
  st.busy = true; setBusy(); show(7);
  const p = $('#build-body'); p.innerHTML = `<div class="panel"><div class="panel-body">${aiProgress('Generation in progress: planning the build', 'Grouping the requirements into modules, mapping dependencies and estimating tasks. This usually takes one to three minutes.', Date.now())}</div></div>`;
  try {
    const m = model(), j = await aiPost('build-plan', { input: { project: m.title, inScope: m.inScope, outScope: m.outScope, requirements: m.reqs.map((r) => ({ id: r.id, text: r.text, proposed: !!r.proposed, scenarios: MX().filter((s) => (s.reqs || []).includes(r.id)).map((s) => s.id).slice(0, 6) })) } });
    const ids = new Set(m.reqs.map((r) => r.id)), seen = new Set();
    let modules = (j.modules || []).filter((x) => x && x.name && Array.isArray(x.reqs)).map((x) => ({ name: String(x.name), reqs: x.reqs.map(String).filter((r) => ids.has(r) && !seen.has(r) && seen.add(r)), dependsOn: (x.dependsOn || []).map(String) }));
    const left = [...ids].filter((r) => !seen.has(r)); if (left.length) modules.push({ name: 'Other requirements', reqs: left, dependsOn: [] });
    if (!modules.some((x) => x.reqs.length)) throw new Error('The AI did not return any modules.');
    D.buildAi = { at: Date.now(), model: j.model || '', modules, tasks: (j.tasks || []).map((t) => ({ req: String(t.req), title: String(t.title || ''), hours: +t.hours || 3 })) };
    st.build = true; st.buildHash = prdHash(); st.busy = false; setBusy(); flush(); drawTabs(); r7(); publishBuild(); return true;
  } catch (e) { st.busy = false; setBusy(); st.buildError = e.message || String(e); p.innerHTML = `<div class="panel"><div class="panel-body"><div class="callout" role="alert">The build plan was not generated: ${esc(st.buildError)} Nothing was changed.</div><div class="row-actions"><button class="key primary" data-go="gen7" type="button">Try again</button></div></div></div>`; return false; }
}

/* ---------- shared folder: write each step's files, read edits back ---------- */
const hashBytes = (u) => { let h = 5381; for (let i = 0; i < u.length; i++) h = ((h << 5) + h + u[i]) | 0; return (h >>> 0).toString(36); };
const artUrl = (p) => `/api/designs/${enc(D.id)}/artifact/${p.split('/').map(enc).join('/')}`;
const lastPub = {};
async function put(path, data) {
  if (store.mode !== 'server' || st.readOnly) return false;
  try { const r = await fetch(artUrl(path), { method: 'PUT', body: data }); if (r.ok) { try { const j = await r.json(); if (j.mtime) { st.mine = st.mine || {}; st.mine[path] = j.mtime; } } catch (e) { /* no body */ } } return r.ok; } catch (e) { return false; }
}
const D_fileHash = () => (D.fileHash = D.fileHash || {});
function publishLive() {
  if (store.mode !== 'server' || !D) return;
  if (D.prd.trim() && lastPub.prd !== D.prd) { lastPub.prd = D.prd; D_fileHash().prd = Core.hashStr(D.prd); put('02-consolidated-prd/prd.md', D.prd); }
  if (st.matrixDirty && D.matrix) { st.matrixDirty = false; publishMatrix(); }
  if (st.testsDirty) { st.testsDirty = false; publishTests(); }
  if (st.archDirty) { st.archDirty = false; publishArch(); }
}
async function publishMatrix() {
  if (!D.matrix) return;
  const bytes = Core.xlsx(Core.matrixSheets(D.matrix, model().reqs));
  D_fileHash().matrix = hashBytes(bytes);
  await put('04-scenario-matrix/scenario-matrix.xlsx', bytes);
  await put('04-scenario-matrix/scenario-matrix.json', JSON.stringify(D.matrix, null, 2));
}
function publishTests() {
  const t = tests(); if (!t.length) return;
  const f = planFiles(); put('05-test-plan/test-plan.md', f.md); put('05-test-plan/test-plan.csv', f.csv);
  t.forEach((x) => put(`05-test-plan/tests/${x.id.toLowerCase()}.spec.ts`, testSpecText(x)));
}
function publishArch() { if (D.archMd) put('07-architecture/architecture.md', D.archMd); }
function publishBuild() {
  const p = buildPlan(), m = model();
  put('08-build-plan/tasks.csv', '\ufeff' + Core.tasksCsv(p)); put('08-build-plan/guardrails.md', guardrails());
  put('08-build-plan/CLAUDE.md', Core.agentFile('CLAUDE.md', m, D.guardrails)); put('08-build-plan/AGENTS.md', Core.agentFile('AGENTS.md', m, D.guardrails));
}
async function publishAll() {
  if (store.mode !== 'server') return toast('Run server.py to save into the folder');
  if (D.prd.trim()) { lastPub.prd = D.prd; D_fileHash().prd = Core.hashStr(D.prd); await put('02-consolidated-prd/prd.md', D.prd); }
  if (D.matrix) await publishMatrix();
  publishTests();
  publishArch();
  if (st.build) publishBuild();
  await flush(); toast('Saved to the designs folder');
}
async function syncFromFolder(silent) {
  if (store.mode !== 'server' || !D) { if (!silent) toast('Run server.py to use the shared folder'); return; }
  const notes = [];
  try {
    const tree = await (await fetch(`/api/designs/${enc(D.id)}/tree`, { cache: 'no-store' })).json();
    const known = new Set(D.sources.map((s) => s.name));
    tree.filter((f) => f.path.startsWith('01-sources/')).forEach((f) => { const n = f.path.slice(11); if (!known.has(n)) { D.sources.push({ name: n, type: fileKind(n), size: f.size, md: '', engine: '', mtime: f.mtime, url: `/files/${enc(D.id)}/${enc(n)}` }); notes.push('new source file ' + n); } });
    /* Markdown sources are never converted: read them when new or when the file changed */
    for (const f of tree.filter((x) => x.path.startsWith('01-sources/'))) {
      const s = D.sources.find((x) => x.name === f.path.slice(11)); if (!s || !isMdName(s.name)) continue;
      const changed = !!(s.md && s.mtime && s.mtime !== f.mtime);
      if (!s.md || changed) { const before = s.md; s.url = s.url || `/files/${enc(D.id)}/${enc(s.name)}`; if (await loadMdSource(s)) { s.size = f.size; if (before && before !== s.md) notes.push('updated source ' + s.name); else if (!before && !notes.some((x) => x.endsWith(s.name))) notes.push('read source ' + s.name); } }
      s.mtime = f.mtime;
    }
    if (tree.some((f) => f.path === '02-consolidated-prd/prd.md')) {
      const t = await (await fetch(artUrl('02-consolidated-prd/prd.md'), { cache: 'no-store' })).text(), h = Core.hashStr(t);
      if (h !== D_fileHash().prd && t !== D.prd) { snap('Before: read from folder'); st.undo = D.prd; D.prd = t; snap('Read from the folder'); notes.push('PRD'); }
      D_fileHash().prd = h; lastPub.prd = t;
    }
    if (tree.some((f) => f.path === '04-scenario-matrix/scenario-matrix.xlsx')) {
      const b = new Uint8Array(await (await fetch(artUrl('04-scenario-matrix/scenario-matrix.xlsx'), { cache: 'no-store' })).arrayBuffer()), h = hashBytes(b);
      if (h !== D_fileHash().matrix) {
        const x = await Core.readXlsx(b), sh = x.sheets.find((s) => /scenario/i.test(s.name)) || x.sheets[0], r = Core.matrixFromRows(sh.rows);
        st.matrixUndo = { rows: D.matrix, had: st.matrix }; D.matrix = r.rows; st.matrix = true; st.matrixHash = prdHash(); st.importNote = 'Read from the folder: ' + r.rows.length + ' scenarios.'; notes.push('scenario matrix');
        D_fileHash().matrix = h;
      }
    }
  } catch (e) { if (!silent) toast('The folder could not be read: ' + (e.message || e)); return; }
  if (notes.length) { rmCache = { h: null, m: null }; await flush(); show(current, false); toast('Updated from the folder: ' + notes.join(', ')); }
  else if (!silent) toast('The folder has no newer files');
}

/* ---------- PRD library: known issues and pending decisions ---------- */
const TYPE_NOTE = { 'Conflict': 'Two parts of the PRD disagree.', 'Decision needed': 'Someone has to decide.', 'Gap': 'Something is missing.', 'Wording': 'The text is too vague to test.' };
function issuesHtml() {
  if (!D.prd.trim()) return '<div class="empty"><p>The analysis starts when a PRD exists.</p></div>';
  const all = prdIssuesAll(), dis = new Set(D.dismissed || []), live = all.filter((i) => !dis.has(i.key)), [open, done] = splitResolved('prd', live), minor = open.filter((i) => sevOf(i) === 'Minor'), shown = st.showDismissed ? all.filter((i) => dis.has(i.key)).sort(bySev) : open.filter((i) => st.showMinor || sevOf(i) !== 'Minor').sort(bySev).concat(done.sort(bySev));
  const counts = ['Critical', 'Important', 'Minor'].map((v) => [v, open.filter((i) => sevOf(i) === v).length]).filter((x) => x[1]);
  const ai = D.aiIssues, aiStale = ai && ai.hash !== prdHash();
  const aiLine = st.aiBusy ? aiProgress('Analysis in progress: reading the PRD', 'Looking for missing content, unclear requirements, TBD items and logic problems. This usually takes one to three minutes.', st.aiStart)
    : st.aiError ? `<div class="callout" role="alert">AI analysis did not run: ${esc(st.aiError)} Nothing was changed.</div>`
    : !ai ? '<div class="callout">No analysis has run on this PRD yet. Press Analyze with AI to list the known issues and pending decisions.</div>'
    : aiStale ? '<div class="callout">The PRD changed after the AI analysis. Run it again to refresh the AI findings.</div>' : '';
  const head = `${aiLine ? `<div class="panel-body">${aiLine}</div>` : ''}<div class="panel-body"><div class="chips">${ai ? `<span class="note">AI analysis ${esc(fmtDate(ai.at))}${ai.model ? ' by ' + esc(ai.model) : ''}: ${ai.issues.length} found.</span>` : ''}${counts.length ? counts.map(([t, n]) => `<span class="chip sev sev-${t.toLowerCase()}">${n} ${t.toLowerCase()}</span>`).join('') : '<span class="note">No open issues.</span>'}${done.length ? `<span class="chip good">${done.length} resolved</span>` : ''}${minor.length ? `<button class="link" data-act="toggle-minor" type="button">${st.showMinor ? 'Hide minor' : `Show minor (${minor.length})`}</button>` : ''}${all.length - live.length ? `<button class="link" data-act="toggle-dismissed" type="button">${st.showDismissed ? 'Show open issues' : `Show dismissed (${all.length - live.length})`}</button>` : ''}</div></div>`;
  if (!ai && !st.aiBusy) return aiLine ? `<div class="panel-body">${aiLine}</div>` : '';
  if (!shown.length) return head;
  return head + `<div class="table-wrap"><table><thead><tr><th>Severity</th><th>Type</th><th>Where</th><th>Issue</th><th></th></tr></thead><tbody>${shown.map((i) => { const rs = !st.showDismissed && resolvedOf('prd', i.key); return `<tr class="row-${sevOf(i).toLowerCase()}${rs ? ' resolved' : ''}"><td>${sevChip(i)}</td><td>${i.type}${i.ai ? ' <span class="chip">AI</span>' : ''}</td><td class="mono">${esc(i.where)}</td><td>${esc(i.text)}${rs ? resolvedBadge('prd', i) : st.showDismissed ? '' : fixesHtml(i, 'prd')}</td><td><div class="row-actions">${st.showDismissed ? '' : resolveBtn('prd', i)}<button class="link" data-issue-${st.showDismissed ? 'restore' : 'dismiss'}="${i.key}" type="button">${st.showDismissed ? 'Restore' : 'Dismiss'}</button></div></td></tr>`; }).join('')}</tbody></table></div>`;
}
const issuesPanel = () => `<div class="panel"><div class="panel-head"><h3>Known issues and pending decisions</h3><div class="row-actions"><span class="note">Found by the AI and by checks. Resolve with the prompt below, or dismiss.</span><button class="key small" data-act="ai-analyze" type="button"${AI_OFF() ? ` disabled title="${ea(AI_OFF())}"` : ''}>Analyze with AI</button></div></div><div id="issues-wrap">${issuesHtml()}</div></div>`;
const refreshIssues = () => { const w = $('#issues-wrap'); if (w) w.innerHTML = issuesHtml(); };

/* ---------- ER diagram renderer (draws Mermaid erDiagram source as SVG) ---------- */
function parseEr(src) {
  const ents = {}, rels = []; let cur = null;
  const card = (s) => /[{}]/.test(s) ? (s.includes('o') ? '0..*' : '1..*') : s.includes('o') ? '0..1' : '1';
  src.split('\n').forEach((raw) => {
    const l = raw.trim(); let m;
    if (!l || /^erDiagram/.test(l)) return;
    if (cur) { if (l === '}') { cur = null; return; } if ((m = l.match(/^(\w+)\s+(\w+)(?:\s+(PK|FK|UK))?(?:\s+"([^"]*)")?/))) cur.fields.push({ type: m[1], name: m[2], key: m[3] || '', note: m[4] || '' }); return; }
    if ((m = l.match(/^(\w+)\s+([|}o{]{2}--[|{o}]{2})\s+(\w+)\s*(?::\s*"?([^"]*)"?)?/))) { ents[m[1]] = ents[m[1]] || { name: m[1], fields: [] }; ents[m[3]] = ents[m[3]] || { name: m[3], fields: [] }; rels.push({ a: m[1], b: m[3], ca: card(m[2].slice(0, 2)), cb: card(m[2].slice(-2)), label: (m[4] || '').trim() }); return; }
    if ((m = l.match(/^(\w+)\s*\{$/))) { ents[m[1]] = ents[m[1]] || { name: m[1], fields: [] }; cur = ents[m[1]]; }
  });
  return { entities: Object.values(ents), relations: rels };
}
function renderEr(model) {
  const E = model.entities; if (!E.length) throw new Error('No entities found');
  const MAXF = 16, CW = 7.3, RH = 19, HH = 30;
  E.forEach((e) => { e.bad = e.fields.slice(0, MAXF).map((f) => /^inconsistent/.test(f.note || '')); const rows = e.fields.slice(0, MAXF).map((f) => `${f.type}  ${f.name}${f.key ? '  ' + f.key : ''}${f.note ? '  (' + f.note + ')' : ''}`); if (e.fields.length > MAXF) rows.push(`+ ${e.fields.length - MAXF} more fields`); e.rows = rows; e.w = Math.max(150, e.name.length * 9 + 28, ...rows.map((r) => r.length * CW + 24)); e.h = HH + Math.max(1, rows.length) * RH + 8; });
  const byName = Object.fromEntries(E.map((e) => [e.name, e])), adj = {}; E.forEach((e) => { adj[e.name] = []; });
  model.relations.forEach((r, i) => adj[r.a].push([r.b, i]));
  const indeg = {}; E.forEach((e) => { indeg[e.name] = 0; }); model.relations.forEach((r) => { indeg[r.b]++; });
  const state = {}, back = new Set(), post = [];
  const dfs = (u) => { state[u] = 1; adj[u].forEach(([v, i]) => { if (state[v] === 1) back.add(i); else if (!state[v]) dfs(v); }); state[u] = 2; post.push(u); };
  E.filter((e) => !indeg[e.name]).concat(E).forEach((e) => { if (!state[e.name]) dfs(e.name); });
  const depth = {}; E.forEach((e) => { depth[e.name] = 0; });
  post.slice().reverse().forEach((u) => adj[u].forEach(([v, i]) => { if (!back.has(i)) depth[v] = Math.max(depth[v], depth[u] + 1); }));
  const maxD = Math.max(...E.map((e) => depth[e.name])), cols = []; for (let d = 0; d <= maxD; d++) cols[d] = E.filter((e) => depth[e.name] === d);
  const GX = 110, GY = 28, PAD = 20; let x = PAD, H = 0;
  cols.forEach((c) => { const w = Math.max(0, ...c.map((e) => e.w)); let y = PAD; c.forEach((e) => { e.x = x; e.y = y; e.cw = w; y += e.h + GY; }); H = Math.max(H, y); x += w + GX; });
  const W = x - GX + PAD, id = 'er' + (++flowN);
  let s = `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Entity relationship diagram" width="${Math.ceil(W)}" height="${Math.ceil(H)}" viewBox="0 0 ${Math.ceil(W)} ${Math.ceil(H)}" style="max-width:none;font-family:var(--font-body);font-size:12.5px">`;
  model.relations.forEach((r) => {
    const a = byName[r.a], b = byName[r.b]; let x1, y1, x2, y2, d;
    if (depth[r.a] < depth[r.b]) { x1 = a.x + a.w; y1 = a.y + a.h / 2; x2 = b.x; y2 = b.y + b.h / 2; const mx = (x1 + x2) / 2; d = `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`; }
    else if (depth[r.a] > depth[r.b]) { x1 = a.x; y1 = a.y + a.h / 2; x2 = b.x + b.w; y2 = b.y + b.h / 2; const mx = (x1 + x2) / 2; d = `M${x1} ${y1} C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`; }
    else { x1 = a.x + a.w / 2; y1 = a.y + (a.y < b.y ? a.h : 0); x2 = b.x + b.w / 2; y2 = b.y + (a.y < b.y ? 0 : b.h); d = `M${x1} ${y1} L${x2} ${y2}`; }
    const lx = (x1 + x2) / 2, ly = (y1 + y2) / 2, left = x2 >= x1;
    s += `<path d="${d}" fill="none" style="stroke:var(--color-ink-2)" stroke-width="1.4"/>`;
    s += `<text x="${x1 + (left ? 6 : -6)}" y="${y1 - 6}" text-anchor="${left ? 'start' : 'end'}" style="fill:var(--color-muted);font-size:11px">${esc(r.ca)}</text><text x="${x2 + (left ? -6 : 6)}" y="${y2 - 6}" text-anchor="${left ? 'end' : 'start'}" style="fill:var(--color-muted);font-size:11px">${esc(r.cb)}</text>`;
    if (r.label) { const w = r.label.length * 6.8 + 10; s += `<rect x="${lx - w / 2}" y="${ly - 9}" width="${w}" height="18" style="fill:var(--color-paper);stroke:var(--color-rule-2)"/><text x="${lx}" y="${ly + 4}" text-anchor="middle" style="fill:var(--color-ink)">${esc(r.label)}</text>`; }
  });
  E.forEach((e) => {
    s += `<rect x="${e.x}" y="${e.y}" width="${e.w}" height="${e.h}" rx="6" style="fill:var(--color-paper);stroke:var(--color-accent)" stroke-width="1.5"/><path d="M${e.x} ${e.y + HH} H${e.x + e.w} V${e.y + 6} a6 6 0 0 0 -6 -6 H${e.x + 6} a6 6 0 0 0 -6 6 Z" style="fill:var(--color-accent-wash);stroke:var(--color-accent)" stroke-width="1.5"/><text x="${e.x + e.w / 2}" y="${e.y + 20}" text-anchor="middle" style="fill:var(--color-ink);font-weight:600;font-size:14px">${esc(e.name)}</text>`;
    e.rows.forEach((r, i) => { s += `<text x="${e.x + 12}" y="${e.y + HH + 16 + i * RH}" style="fill:var(${e.bad && e.bad[i] ? '--color-error' : '--color-ink'});font-family:var(--font-outlier);font-size:11.5px" xml:space="preserve">${esc(r)}</text>`; });
  });
  return s + '</svg>';
}
/* ---------- refined ER diagram: entity cards with key badges, crow's-foot ends, elbow lines, readable layout ---------- */
function parseEr2(src) {
  const ents = {}, rels = []; let cur = null;
  const get = (n) => ents[n] || (ents[n] = { name: n, fields: [], order: Object.keys(ents).length });
  const card = (s) => { const left = s[0] === '}' || s[0] === '|' || s[0] === 'o', many = /[{}]/.test(s), zero = s.includes('o'); return { many, zero }; };
  String(src).split('\n').forEach((raw) => {
    const l = raw.replace(/%%.*$/, '').trim(); let m;
    if (!l || /^erDiagram/.test(l) || /^(direction|title|accTitle|accDescr)\b/.test(l)) return;
    if (cur) {
      if (l === '}') { cur = null; return; }
      if ((m = l.match(/^([\w\[\]().-]+)\s+(\w+)((?:\s+(?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*)?)(?:\s+"([^"]*)")?\s*$/))) cur.fields.push({ type: m[1], name: m[2], key: m[3].trim().replace(/\s+/g, ''), note: m[4] || '' });
      return;
    }
    if ((m = l.match(/^"?([\w ]+?)"?\s+([|}o{]{2})(--|\.\.)([|{o}]{2})\s+"?([\w ]+?)"?\s*(?::\s*"?([^"]*?)"?)?\s*$/))) {
      get(m[1]); get(m[5]); rels.push({ a: m[1], b: m[5], ca: card(m[2]), cb: card(m[4].split('').reverse().join('')), dashed: m[3] === '..', label: (m[6] || '').trim() }); return;
    }
    if ((m = l.match(/^"?([\w ]+?)"?\s*\{$/))) { cur = get(m[1]); return; }
    if ((m = l.match(/^"?([\w ]+?)"?$/))) get(m[1]);
  });
  return { entities: Object.values(ents), relations: rels };
}
function renderEr2(model) {
  const E = model.entities; if (!E.length) throw new Error('No entities found');
  const by = Object.fromEntries(E.map((e) => [e.name, e])), R = model.relations;
  const MAXF = 14, RH = 19, HH = 32, CH = 7, MAXC = 46;
  const cut = (t, n) => (t.length > n ? t.slice(0, n - 1) + '...' : t);
  /* box sizes: name column, type column, a badge for the key, and a short muted note */
  E.forEach((e) => {
    e.shown = e.fields.slice(0, MAXF); e.more = e.fields.length - e.shown.length;
    const nameW = Math.max(0, ...e.shown.map((f) => f.name.length)) * CH + 4, typeW = Math.max(0, ...e.shown.map((f) => f.type.length)) * (CH - 0.6), noteW = Math.max(0, ...e.shown.map((f) => (f.note ? cut(f.note, MAXC).length : 0))) * (CH - 1);
    e.cols = { key: e.shown.some((f) => f.key.length > 2) ? 42 : 30, name: nameW, type: typeW, note: noteW };
    e.w = Math.max(e.name.length * 8.4 + 32, 14 + e.cols.key + nameW + 12 + typeW + (noteW ? 14 + noteW : 0) + 12, 150);
    e.h = HH + (e.shown.length + (e.more > 0 ? 1 : 0)) * RH + (e.shown.length || e.more ? 10 : 0);
  });
  /* layers: the most connected entity is the root; the others sit by distance from it */
  const deg = {}; E.forEach((e) => { deg[e.name] = 0; }); R.forEach((r) => { deg[r.a]++; deg[r.b]++; });
  const nb = {}; E.forEach((e) => { nb[e.name] = new Set(); }); R.forEach((r) => { if (r.a !== r.b) { nb[r.a].add(r.b); nb[r.b].add(r.a); } });
  const layer = {}; const seen = new Set();
  E.slice().sort((x, y) => deg[y.name] - deg[x.name] || x.order - y.order).forEach((root) => {
    if (seen.has(root.name)) return; layer[root.name] = 0; seen.add(root.name); const q = [root.name];
    while (q.length) { const u = q.shift(); [...nb[u]].forEach((v) => { if (!seen.has(v)) { seen.add(v); layer[v] = layer[u] + 1; q.push(v); } }); }
  });
  /* parents (the many side) to the right of their one side where there is a clear direction: keep it simple, distance only */
  const maxL = Math.max(...E.map((e) => layer[e.name])), cols = []; for (let l = 0; l <= maxL; l++) cols[l] = E.filter((e) => layer[e.name] === l);
  /* order inside a layer by the average position of the neighbours in the previous layer, four sweeps */
  const pos = {}; cols.forEach((c) => c.forEach((e, i) => { pos[e.name] = i; }));
  for (let pass = 0; pass < 4; pass++) for (let l = 1; l <= maxL; l++) { const key = {}; cols[l].forEach((e) => { const p = [...nb[e.name]].filter((n) => layer[n] === l - 1).map((n) => pos[n]); key[e.name] = p.length ? p.reduce((a, b) => a + b, 0) / p.length : pos[e.name]; }); cols[l].sort((x, y) => key[x.name] - key[y.name] || x.order - y.order).forEach((e, i) => { pos[e.name] = i; }); }
  /* coordinates */
  const PAD = 24, GAP = 96, TOP = 22 + Math.min(R.filter((r) => Math.abs(layer[r.a] - layer[r.b]) > 1).length, 8) * 9;
  let x = PAD, Hmax = 0; const colX = [], colW = [];
  cols.forEach((c, l) => { const w = Math.max(0, ...c.map((e) => e.w)); colX[l] = x; colW[l] = w; let y = TOP; c.forEach((e) => { e.x = x; e.cw = w; e.y = y; y += e.h + 30; }); Hmax = Math.max(Hmax, y); x += w + GAP; });
  /* centre each column against the tallest one */
  cols.forEach((c) => { const h = c.length ? c[c.length - 1].y + c[c.length - 1].h - TOP : 0, off = Math.round((Hmax - 30 - TOP - h) / 2); c.forEach((e) => { e.y += Math.max(0, off); }); });
  const W = x - GAP + PAD, H = Hmax + 8 - 30 + PAD, id = 'er' + (++flowN);
  /* attach points: spread the lines on one side of a box so they do not start at the same spot */
  const slots = {}; const useSide = (n, side, k) => { const key = n + '|' + side; (slots[key] = slots[key] || []).push(k); };
  R.forEach((r, k) => { if (r.a === r.b) return; const la = layer[r.a], lb = layer[r.b]; if (la === lb) { useSide(r.a, 'R', k); useSide(r.b, 'R', k); } else { useSide(la < lb ? r.a : r.b, 'R', k); useSide(la < lb ? r.b : r.a, 'L', k); } });
  const att = (n, side, k) => { const e = by[n], a = slots[n + '|' + side] || [k], i = a.indexOf(k), span = Math.min(e.h - 24, Math.max(0, (a.length - 1) * 14)); return e.y + e.h / 2 - span / 2 + (a.length > 1 ? (i * span) / (a.length - 1) : 0); };
  const bus = {}; let busN = 0;
  /* crow's foot ends. (x,y) is the box edge, dir = +1 when the line leaves to the right, -1 to the left */
  const ink = 'style="stroke:var(--color-ink-2)" stroke-width="1.5" fill="none"', ends = (x, y, dir, c) => {
    let s = ''; const d = dir;
    if (c.many) s += `<path d="M${x + d * 14} ${y} L${x} ${y - 7} M${x + d * 14} ${y} L${x} ${y + 7} M${x + d * 14} ${y} L${x} ${y}" ${ink}/>`;
    else s += `<path d="M${x + d * 10} ${y - 7} V${y + 7}" ${ink}/>`;
    if (c.zero) s += `<circle cx="${x + d * (c.many ? 21 : 17)}" cy="${y}" r="4.2" style="fill:var(--color-paper);stroke:var(--color-ink-2)" stroke-width="1.5"/>`;
    else s += `<path d="M${x + d * (c.many ? 19 : 15)} ${y - 7} V${y + 7}" ${ink}/>`;
    return s;
  };
  const rr = (pts, r) => { let d = `M${pts[0][0]} ${pts[0][1]}`; for (let i = 1; i < pts.length - 1; i++) { const [px, py] = pts[i - 1], [cx, cy] = pts[i], [nx, ny] = pts[i + 1], l1 = Math.hypot(cx - px, cy - py), l2 = Math.hypot(nx - cx, ny - cy), q = Math.min(r, l1 / 2, l2 / 2); if (q < 1) { d += ` L${cx} ${cy}`; continue; } d += ` L${cx - (cx - px) / l1 * q} ${cy - (cy - py) / l1 * q} Q${cx} ${cy} ${cx + (nx - cx) / l2 * q} ${cy + (ny - cy) / l2 * q}`; } const e = pts[pts.length - 1]; return d + ` L${e[0]} ${e[1]}`; };
  const gapUse = {};
  let s = `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Entity relationship diagram" width="${Math.ceil(W)}" height="${Math.ceil(H)}" viewBox="0 0 ${Math.ceil(W)} ${Math.ceil(H)}" style="max-width:none;font-family:var(--font-body);font-size:12.5px">`;
  const labels = [];
  R.forEach((r, k) => {
    const a = by[r.a], b = by[r.b], la = layer[r.a], lb = layer[r.b], dash = r.dashed ? ' stroke-dasharray="5 4"' : ''; let pts, ea, eb, lab;
    if (r.a === r.b) { const y1 = att(r.a, 'R', k) - 8, x0 = a.x + a.cw; pts = [[x0, y1], [x0 + 34, y1], [x0 + 34, y1 + 22], [x0, y1 + 22]]; ea = { x: x0, y: y1, d: 1, c: r.ca }; eb = { x: x0, y: y1 + 22, d: 1, c: r.cb }; lab = [x0 + 38, y1 + 14, 'start']; }
    else if (la === lb) { const ya = att(r.a, 'R', k), yb2 = att(r.b, 'R', k), xr = Math.max(a.x + a.cw, b.x + b.cw) + 26 + (gapUse['s' + la] = (gapUse['s' + la] || 0) + 1) * 8; pts = [[a.x + a.cw, ya], [xr, ya], [xr, yb2], [b.x + b.cw, yb2]]; ea = { x: a.x + a.cw, y: ya, d: 1, c: r.ca }; eb = { x: b.x + b.cw, y: yb2, d: 1, c: r.cb }; lab = [xr + 4, (ya + yb2) / 2 + 4, 'start']; }
    else {
      const fwd = la < lb, from = fwd ? a : b, to = fwd ? b : a, fn = fwd ? r.a : r.b, tn = fwd ? r.b : r.a, cf = fwd ? r.ca : r.cb, ct = fwd ? r.cb : r.ca;
      const y1 = att(fn, 'R', k), y2 = att(tn, 'L', k), x1 = from.x + from.cw, x2 = to.x;
      const gl = Math.min(la, lb), span = Math.abs(la - lb);
      if (span === 1) { const g = (gapUse[gl] = gapUse[gl] || []); g.push(k); const vx = colX[gl] + colW[gl] + GAP / 2 + (g.length - 1 - 1) * 7; pts = [[x1, y1], [vx, y1], [vx, y2], [x2, y2]]; lab = [vx, (y1 + y2) / 2, 'middle']; }
      else { const by0 = 14 + (busN++ % 8) * 9, vx1 = x1 + 16 + (busN % 5) * 5, vx2 = x2 - 16 - (busN % 5) * 5; pts = [[x1, y1], [vx1, y1], [vx1, by0], [vx2, by0], [vx2, y2], [x2, y2]]; lab = [(vx1 + vx2) / 2, by0, 'middle']; }
      ea = { x: x1, y: y1, d: 1, c: cf }; eb = { x: x2, y: y2, d: -1, c: ct };
    }
    s += `<path d="${rr(pts, 9)}" style="stroke:var(--color-ink-2)" stroke-width="1.5" fill="none"${dash}/>` + ends(ea.x, ea.y, ea.d, ea.c) + ends(eb.x, eb.y, eb.d, eb.c);
    if (r.label) labels.push({ t: cut(r.label, 34), x: lab[0], y: lab[1], anchor: lab[2] });
  });
  /* labels on top of the lines, each on its own spot */
  const placed = [];
  labels.forEach((L) => { const w = L.t.length * 6.4 + 10; let y = L.y; for (let t = 0; t < 8 && placed.some((p) => Math.abs(p.x - L.x) < (p.w + w) / 2 && Math.abs(p.y - y) < 17); t++) y += 17; placed.push({ x: L.x, y, w }); const x0 = L.anchor === 'start' ? L.x : L.x - w / 2; s += `<rect x="${x0}" y="${y - 10}" width="${w}" height="17" rx="3" style="fill:var(--color-paper);stroke:var(--color-rule-2)"/><text x="${x0 + 5}" y="${y + 2.5}" style="fill:var(--color-ink-2);font-size:11.5px">${esc(L.t)}</text>`; });
  E.forEach((e) => {
    const root = layer[e.name] === 0;
    s += `<g><rect x="${e.x}" y="${e.y}" width="${e.cw}" height="${e.h}" rx="7" style="fill:var(--color-paper);stroke:var(--color-accent)" stroke-width="${root ? 2 : 1.4}"/>`;
    s += `<path d="M${e.x} ${e.y + HH} H${e.x + e.cw} V${e.y + 7} a7 7 0 0 0 -7 -7 H${e.x + 7} a7 7 0 0 0 -7 7 Z" style="fill:var(--color-accent-wash);stroke:var(--color-accent)" stroke-width="${root ? 2 : 1.4}"/>`;
    s += `<text x="${e.x + 14}" y="${e.y + 21}" style="fill:var(--color-ink);font-weight:600;font-size:14px">${esc(e.name)}</text>`;
    const ky = (i) => e.y + HH + 14 + i * RH, tx = e.x + 14 + e.cols.key, ty = tx + e.cols.name + 12, nx = ty + e.cols.type + 14;
    e.shown.forEach((f, i) => {
      const y = ky(i), pk = /PK/.test(f.key), fk = /FK/.test(f.key), uk = /UK/.test(f.key), bad = /^inconsistent/i.test(f.note || '');
      if (f.key) s += `<rect x="${e.x + 10}" y="${y - 11}" width="${f.key.length > 2 ? 32 : 22}" height="15" rx="3" style="fill:${pk ? 'var(--color-accent)' : 'var(--color-paper-3)'};stroke:var(--color-accent)" stroke-width="0.8"/><text x="${e.x + 10 + (f.key.length > 2 ? 16 : 11)}" y="${y - 0.5}" text-anchor="middle" style="fill:${pk ? 'var(--color-paper)' : 'var(--color-accent-deep)'};font-size:9.5px;font-weight:700">${esc(f.key.replace(',', ' '))}</text>`;
      s += `<text x="${tx}" y="${y}" style="fill:var(${bad ? '--color-error' : '--color-ink'});font-weight:${pk ? 600 : 400}">${esc(f.name)}</text><text x="${ty}" y="${y}" style="fill:var(--color-muted);font-size:11.5px">${esc(f.type)}</text>`;
      if (f.note) s += `<text x="${nx}" y="${y}" style="fill:var(${bad ? '--color-error' : '--color-muted'});font-size:11px"><title>${esc(f.note)}</title>${esc(cut(f.note, MAXC))}</text>`;
      if (i) s += `<path d="M${e.x + 8} ${y - 13} H${e.x + e.cw - 8}" style="stroke:var(--color-rule)" stroke-width="0.6"/>`;
    });
    if (e.more > 0) s += `<text x="${e.x + 14}" y="${ky(e.shown.length)}" style="fill:var(--color-muted);font-size:11px;font-style:italic">+ ${e.more} more field${e.more === 1 ? '' : 's'}</text>`;
    s += '</g>';
  });
  return s + '</svg>';
}

const mermaidKind = (src) => { const t = String(src).replace(/^\s*(?:%%[^\n]*\n|---[\s\S]*?---\s*\n)*/, '').trim().split(/\s+/)[0].toLowerCase(); return !t || /^(flowchart|graph)(-elk)?$/.test(t) ? 'flow' : t === 'erdiagram' ? 'er' : 'other'; };
const diagram = (src) => { const k = mermaidKind(src); return k === 'er' ? renderEr2(parseEr2(src)) : k === 'other' ? `<div class="dv-wait" data-mmd="${ea(encodeURIComponent(src))}">Drawing with Mermaid...</div>` : renderFlow(src); };

/* ---------- colour theme and night mode ---------- */
const THEME_LS = 'prd-demo-theme', ICON_MOON = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><path d="M16.5 11.6A6.8 6.8 0 0 1 8.4 3.5a6.8 6.8 0 1 0 8.1 8.1Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>', ICON_SUN = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="3.4" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const ACCENTS = ['cobalt', 'rust', 'forest', 'violet', 'teal'];
function themeState() { const d = document.documentElement; return { accent: d.getAttribute('data-accent') || 'cobalt', mode: d.getAttribute('data-mode') || 'light' }; }
function applyTheme(t, save) {
  const d = document.documentElement, accent = ACCENTS.includes(t.accent) ? t.accent : 'cobalt', mode = t.mode === 'dark' ? 'dark' : 'light';
  d.setAttribute('data-accent', accent); d.setAttribute('data-mode', mode);
  const mb = $('#mode-btn'); if (mb) { mb.innerHTML = mode === 'dark' ? ICON_SUN : ICON_MOON; mb.setAttribute('aria-pressed', String(mode === 'dark')); const l = mode === 'dark' ? 'Day theme' : 'Night theme'; mb.setAttribute('aria-label', l); mb.title = l; }
  $$('#accent-menu [data-accent]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.accent === accent)));
  if (save) { try { localStorage.setItem(THEME_LS, JSON.stringify({ accent, mode })); } catch (e) { /* not saved */ } }
  mmReadyRedraw();
}
function mmReadyRedraw() { /* diagrams use CSS variables, so they follow the theme without redrawing */ }
function closeAccentMenu() { const m = $('#accent-menu'), b = $('#accent-btn'); if (m && !m.hidden) { m.hidden = true; if (b) b.setAttribute('aria-expanded', 'false'); } }
function toggleAccentMenu() { const m = $('#accent-menu'), b = $('#accent-btn'); if (!m) return; const open = m.hidden; m.hidden = !open; if (b) b.setAttribute('aria-expanded', String(open)); if (open) { const c = m.querySelector('[aria-checked="true"]') || m.querySelector('button'); if (c && c.focus) c.focus(); } }

/* ---------- continue buttons ---------- */
async function nextAction() {
  if (st.busy) return;
  const c = current;
  if (c === 1) { if (!(await ensurePrd())) return; return show(2); }
  if (!STAGES[c - 1].done()) return toast(c === 5 ? 'Import payloads first' : 'Generate this page first');
  if (c === 2) return genMatrix();
  if (c === 3) return genPlan();
  if (c === 4) return show(5);
  if (c === 5) return genArch();
  if (c === 6) return genBuild();
}
async function runRest() {
  if (st.busy) return;
  const c = current;
  if (c === 1) { if (!(await ensurePrd())) return; } else if (!STAGES[c - 1].done()) return toast('Generate this page first');
  const steps = { 2: async () => { show(2); }, 3: genMatrix, 4: genPlan, 5: async () => { show(5); await sleep(600); } /* payloads are optional: without them the page is only shown */, 6: genArch, 7: genBuild };
  for (let n = c + 1; n <= 7; n++) { const r = await steps[n](); if (r === false) return; await sleep(300); }
  toast('Remaining pages generated');
}
const RESET_WHAT = { 1: 'the source files, the consolidated PRD and the issue decisions (the version history is kept and gets a "Before reset" version)', 3: 'the scenario matrix', 4: 'all test cases', 6: 'the architecture design, the readiness check, the solution options and your decisions, and the design review (the version history is kept and gets a "Before reset" version; the baseline draft, reference documents and connections are kept)', 5: 'the imported payloads, their analysis and report, and what they added to the matrix (payload links and generated scenario fields)' };
async function clearStep(folder) { if (store.mode !== 'server' || !D) return; try { await fetch(`/api/designs/${enc(D.id)}/step/${folder}`, { method: 'DELETE' }); } catch (e) { /* folder not reachable */ } }
/* Reset history: a reset never destroys anything. Before it clears a page, the page's whole state (the data AND the human decisions: dismissed and resolved issues,
   readiness answers, chosen solution options, scenario edits) is saved as a record in D.resets, and the uploaded originals are moved to _reset-archive/ on the helper.
   Restore puts a record back after first saving the current state as a new record, so a restore (or a mistaken restore) can itself be undone. Records are never removed. */
const RESET_FIELDS = {
  1: ['sources', 'prd', 'dismissed', 'aiIssues', 'resolved.prd', 'cc.all'],
  3: ['matrix', 'matrixSrc', 'matrixGen', 'payAi', 'cc.all'],
  4: ['tests', 'cc.all'],
  5: ['payloadImport', 'payReport', 'payAi', 'erAi', 'payMap', 'matrix', 'cc.all'],
  6: ['archMd', 'archAssess', 'archDec', 'archAnswers', 'archDismissed', 'archReview', 'archAi', 'resolved.arch', 'ccDismissed', 'cc.all'],
  all: ['matrix', 'matrixSrc', 'matrixGen', 'payAi', 'aiIssues', 'archAssess', 'archDec', 'archDismissed', 'tests', 'cc', 'ccDismissed', 'archMd']
};
const RESET_FOLDERS = { 1: ['01-sources'], 5: ['06-payload-library'] };  /* uploaded originals that cannot be rebuilt from the saved state; the other step folders are rewritten from it */
const RESET_LABEL = { sources: 'source files', prd: 'PRD', dismissed: 'dismissed PRD issues', aiIssues: 'AI findings', 'resolved.prd': 'resolved PRD issues', 'cc.all': 'cross-check result', matrix: 'scenarios', matrixSrc: 'matrix source file', matrixGen: 'matrix generation info', payAi: 'payload analysis', tests: 'test cases', payloadImport: 'payload imports', payReport: 'payload report', erAi: 'data model analysis', payMap: 'payload mapping', archMd: 'architecture design', archAssess: 'readiness check', archDec: 'solution decisions', archAnswers: 'readiness answers', archDismissed: 'dismissed readiness items', archReview: 'design review', archAi: 'design AI info', 'resolved.arch': 'resolved design issues', ccDismissed: 'dismissed cross-check findings', cc: 'cross-check results' };
const rGet = (path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), D);
function rSet(path, v) {
  const ks = path.split('.'), last = ks.pop(); let o = D;
  for (const k of ks) { if (o[k] == null || typeof o[k] !== 'object') { if (v === undefined) return; o[k] = {}; } o = o[k]; }
  if (v === undefined) delete o[last]; else o[last] = v;
}
const rSize = (v) => v == null || v === '' ? 0 : Array.isArray(v) ? v.length : typeof v === 'string' ? v.split('\n').length : typeof v === 'object' ? (v.count != null && v.files !== undefined ? v.count : Object.keys(v).length) : 1;
function captureReset(page, label) {
  const state = {}, parts = [];
  RESET_FIELDS[page].forEach((k) => {
    const v = rGet(k); if (v === undefined) return;
    state[k] = JSON.parse(JSON.stringify(v));
    const n = rSize(v); if (n) parts.push(k === 'prd' ? `PRD (${n} lines)` : k === 'archMd' ? `design (${n} lines)` : `${n} ${RESET_LABEL[k] || k}`);
  });
  if (!parts.length) return null;
  return { id: uid(), t: Date.now(), page, label, summary: parts.join(', '), state, folders: RESET_FOLDERS[page] || [], stash: { matrixHash: st.matrixHash || '' }, restored: [] };
}
async function folderCall(folder, action, tag) {
  if (store.mode !== 'server' || !D) return true;
  try { const r = await fetch(`/api/designs/${enc(D.id)}/step/${folder}/${action}`, { method: 'POST', body: JSON.stringify({ tag }) }); return r.ok; } catch (e) { return false; }
}
/* saves the record (in the design, and the originals on the helper) before anything is cleared; returns false when the originals could not be kept, so the reset is not done */
async function archiveBeforeReset(page, label) {
  const rec = captureReset(page, label); if (!rec) return true;
  for (const f of rec.folders) { if (!(await folderCall(f, 'archive', rec.id))) { toast('Reset cancelled: the original files could not be saved first. Nothing was changed.'); return false; } }
  (D.resets = D.resets || []).unshift(rec); return true;
}
async function restoreReset(id) {
  if (st.busy) return;
  const e = (D.resets || []).find((x) => x.id === id); if (!e) return;
  const cur = captureReset(e.page, 'Before restoring: ' + e.label);
  if (cur) { for (const f of cur.folders) await folderCall(f, 'archive', cur.id); D.resets.unshift(cur); }
  for (const f of e.folders || []) await folderCall(f, 'restore', e.id);
  const fh = D_fileHash(), pg = e.page;
  RESET_FIELDS[pg].forEach((k) => rSet(k, e.state[k] === undefined ? undefined : JSON.parse(JSON.stringify(e.state[k]))));
  (e.restored = e.restored || []).push(Date.now());
  Object.assign(st, { busy: false });
  if (pg === 1 || pg === 'all') { Object.keys(blobUrls).forEach((k) => { try { URL.revokeObjectURL(blobUrls[k]); } catch (x) { /* ignore */ } delete blobUrls[k]; }); Object.assign(st, { undo: null, proposal: null, promptText: '', cmp: '', showDismissed: false }); lastPub.prd = ''; delete fh.prd; rmCache = { h: null, m: null }; if (pg === 1) snap('Restored from reset history'); }
  if (pg === 3 || pg === 5 || pg === 'all') { st.matrix = !!D.matrix; st.matrixHash = (e.stash || {}).matrixHash || ''; st.matrixDirty = !!D.matrix; st.importNote = ''; st.mapping = null; st.workbooks = []; st.workbooksFor = ''; delete fh.matrix; }
  if (pg === 4 || pg === 'all') { st.plan = tests().length > 0; st.testsDirty = st.plan; st.tcIdx = 0; st.refine = null; st.testUndo = null; }
  if (pg === 5) { impCache = null; payCache = { k: '', a: null }; Object.assign(st, { viewPf: '', viewPg: '', revDone: null, reviseUndo: null, paError: '', paNote: '', linkNote: '' }); }
  if (pg === 6 || pg === 'all') { st.arch = D.archMd != null; st.archDirty = D.archMd != null; st.archProposal = null; st.archUndo = null; st.archPrompt = ''; st.archShowDis = false; if (pg === 6) snapArch('Restored from reset history'); }
  await flush(); drawTabs(); show(pg === 'all' ? current : pg, false);
  toast(`Restored: ${e.label}. What was there before is kept in Reset history.`);
}
function drawResetHist() {
  [1, 3, 4, 5, 6].forEach((n) => {
    const el = $('#rh-slot-' + n); if (!el) return;
    const list = D ? (D.resets || []).filter((x) => x.page === n || x.page === 'all') : [];
    if (!list.length) { el.innerHTML = ''; return; }
    const open = !!(st.rhOpen || {})[n];
    const rows = list.map((x) => `<tr><td>${esc(fmtDate(x.t))}</td><td>${esc(x.label)}</td><td>${esc(x.summary || '')}</td><td>${(x.restored || []).length ? 'Restored ' + (x.restored || []).map((t) => esc(fmtDate(t))).join('; ') : ''}</td><td><button class="key small" data-rhrestore="${ea(x.id)}" type="button">Restore</button></td></tr>`).join('');
    el.innerHTML = `<div class="panel"><div class="panel-head"><h3>Reset history (${list.length})</h3><div class="row-actions"><span class="note">Every reset is saved here with your decisions. Nothing is deleted.</span><button class="key small" data-rhtoggle="${n}" type="button" aria-expanded="${open}">${open ? 'Hide' : 'Show'}</button></div></div>${open ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>What happened</th><th>What it held</th><th>Restored</th><th></th></tr></thead><tbody>${rows}</tbody></table></div><div class="panel-body"><p class="note">Restore replaces this page's current content with the saved one. The current content is saved first as a new record, so a restore can be undone the same way.</p></div>` : ''}</div>`;
  });
}
async function resetPage(n) {
  if (st.busy) return;
  const fh = D_fileHash();
  if (!(await archiveBeforeReset(n, 'Reset of page ' + n))) return;
  if (n === 1) {
    Object.keys(blobUrls).forEach((k) => { try { URL.revokeObjectURL(blobUrls[k]); } catch (e) { /* ignore */ } delete blobUrls[k]; });
    Object.keys(files).forEach((k) => delete files[k]);
    snap('Before reset'); D.sources = []; D.prd = ''; D.dismissed = [];
    Object.assign(st, { undo: null, proposal: null, promptText: '', viewSrc: '', cmp: '', confirmMerge: false, showDismissed: false, pview: 'doc' });
    if (D.cc) delete D.cc.all; D.aiIssues = null; st.aiError = ''; delete fh.prd; lastPub.prd = ''; rmCache = { h: null, m: null };
    await Promise.all([clearStep('01-sources'), clearStep('02-consolidated-prd')]);
    rewriteVersions('02-consolidated-prd', D.versions || [], (v) => v.prd);  /* clearing the folder removed the version files; the history is kept */
  } else if (n === 3) {
    D.matrix = null; D.matrixSrc = null; D.matrixGen = null; D.payAi = null; if (D.cc) delete D.cc.all;
    Object.assign(st, { matrix: false, matrixHash: '', matrixUndo: null, importNote: '', mapping: null, ch: 'All', pr: 'All', matrixDirty: false, workbooks: [], workbooksFor: '' });
    delete fh.matrix; await clearStep('04-scenario-matrix');
  } else if (n === 4) {
    D.tests = []; if (D.cc) delete D.cc.all;
    Object.assign(st, { plan: false, tcIdx: 0, refine: null, testUndo: null, refinePrompt: '', confirmTdel: -1, testsDirty: false });
    await clearStep('05-test-plan');
  } else if (n === 5) {
    D.payloadImport = null; D.payReport = null; D.payAi = null; D.erAi = null; D.payMap = null; impCache = null; payCache = { k: '', a: null }; if (D.cc) delete D.cc.all;
    Object.assign(st, { viewPf: '', viewPg: '', allBusy: false, allSteps: null, revBusy: false, revError: '', revDone: null, reviseUndo: null, paBusy: false, paError: '', paNote: '', linkNote: '' });
    /* undo what the payloads wrote into the matrix: the Payload column goes back to what the source file had, and the fields generated from payloads are blanked */
    if (D.matrix) {
      let src = {}; try { if (D.matrixSrc && D.matrixSrc.raw) { const sh = Core.readMatrixSheet(D.matrixSrc.raw); Core.applyMatrixMap(sh, D.matrixSrc.map).rows.forEach((r) => { src[r.id] = r.so || ''; }); } } catch (e) { src = {}; }
      D.matrix.forEach((x) => { x.so = src[x.id] || ''; if (x.aiInfo) { x.title = ''; x.expect = ''; x.reqs = []; delete x.aiInfo; } });
      st.matrixDirty = true;
    }
    await clearStep('06-payload-library');
  }
  else if (n === 6) {
    snapArch('Before reset'); D.archMd = null; D.archAssess = null; D.archDec = {}; D.archAnswers = {}; D.archDismissed = []; D.archReview = null; D.archAi = null;
    if (D.resolved) D.resolved.arch = {};
    if (D.cc) delete D.cc.all; D.ccDismissed = [];
    Object.assign(st, { arch: false, archBusy: '', archError: '', archOpen: false, archPrompt: '', archProposal: null, archUndo: null, archDirty: false, archShowDis: false, archView: 'doc', archPropBusy: false, archRevBusy: false, archRevError: '' });
    await clearStep('07-architecture');
    rewriteVersions('07-architecture', D.archVersions || [], (v) => v.md);
  }
  await flush(); show(n, false); toast(`Page ${n} reset: removed ${RESET_WHAT[n]}. Other pages are unchanged. Everything removed is saved in Reset history and can be restored.`);
}
async function resetResults() {
  if (st.busy) return;
  if (!(await archiveBeforeReset('all', 'Clear generated pages'))) return;
  D.matrix = null; D.matrixSrc = null; D.matrixGen = null; D.payAi = null; D.aiIssues = null; D.archAssess = null; D.archDec = {}; D.archDismissed = []; D.tests = []; D.cc = {}; D.ccDismissed = []; D.archMd = null; Object.assign(st, { matrix: false, plan: false, arch: false, build: false, matrixHash: '', buildHash: '', md: '', ch: 'All', pr: 'All', matrixUndo: null, importNote: '', mapping: null });
  flush(); show(current); toast('Generated pages cleared. The PRD, sources and imported payloads are unchanged. The cleared content is saved in Reset history and can be restored.');
}

/* ---------- design list ---------- */
const progress = (d) => { const f = d.flags || {}; const hasPrd = !!(d.prd || '').trim(); return [hasPrd, hasPrd, f.matrix, f.plan, f.pay, f.arch, f.build].filter(Boolean).length; };
let confirmDel = '';
async function renderList() {
  $('#view-design').hidden = true; $('#view-list').hidden = false;
  $('#store-badge').textContent = store.mode === 'server' ? 'Storage: repo' : 'Storage: this browser';
  renderData(); renderConns(); renderProvs(); renderTpls(); stopWatch(); st.readOnly = false;
  const el = $('#design-list'); el.innerHTML = skeleton(4);
  let items = [];
  try { items = await store.list(); } catch (e) { el.innerHTML = '<div class="error"><p>The designs could not be read.</p></div>'; return; }
  items.sort((a, b) => (b.updated || 0) - (a.updated || 0));
  if (!items.length) { el.innerHTML = `<div class="empty"><p>No designs yet. Start a blank design.</p>${store.mode === 'server' ? `<div class="callout"><p>Saved in <span class="mono">${esc(store.dataDir || 'designs')}</span>. Designs made earlier from a file page are in that browser: use Export all designs there, then Import designs here.</p></div>` : ''}<button class="key primary" data-act="new-design" type="button">New design</button></div>`; return; }
  el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>Design</th><th>Source files</th><th>Pages done</th><th>Updated</th><th></th></tr></thead><tbody>${items.map((d) => `<tr><td>${d.damaged ? `<b>${esc(d.name)}</b> <span class="chip bad">Cannot be read</span><div class="note">${esc(d.error || '')} Restore an earlier version of <span class="mono">design.json</span> from OneDrive version history.</div>` : `<a href="#/design/${ea(encodeURIComponent(d.id))}/1"><b>${esc(d.name)}</b></a>${d.repaired ? ' <span class="chip warn" title="Extra characters after the data were removed; the damaged copy is kept as design.json.damaged-...">Repaired</span>' : ''}`}</td><td class="num">${(d.sources || []).length}</td><td class="num">${progress(d)} of 7</td><td>${esc(fmtDate(d.updated || d.created))}</td><td><div class="row-actions">${trashBtn('data-del', d.id, 'Delete design ' + d.name, confirmDel === d.id)}</div></td></tr>`).join('')}</tbody></table></div><div class="coverage">${esc(storeNote())}</div>`;
}
async function exportDesigns() {
  let items = []; try { items = await store.list(); } catch (e) { return toast('The designs could not be read'); }
  if (!items.length) return toast('There are no designs to export');
  download('designs-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ format: 'design-pipeline-backup', version: 1, exported: Date.now(), designs: items }, null, 1), 'application/json');
  toast(`Exported ${items.length} design${items.length === 1 ? '' : 's'}`);
}
async function importDesigns(file) {
  let doc; try { doc = JSON.parse(await file.text()); } catch (e) { return toast('That file is not valid JSON'); }
  const list = Array.isArray(doc) ? doc : doc && Array.isArray(doc.designs) ? doc.designs : doc && doc.id ? [doc] : [];
  const ok = list.filter((d) => d && typeof d === 'object' && (d.name || d.id));
  if (!ok.length) return toast('No designs were found in that file');
  let n = 0, copied = 0;
  for (const d of ok) {
    const base = String(d.name || d.id || 'Untitled design').trim(); let made = null;
    for (let k = 0; k < 50 && !made; k++) {
      const name = k === 0 ? base : (k === 1 ? base + ' (imported)' : `${base} (imported ${k})`);
      try { made = await store.create(name); if (k > 0) copied++; } catch (e) { if (!e.taken) break; }
    }
    if (!made) continue;
    d.id = made.id; d.name = made.name; delete d.rev; delete d.savedBy; delete d.savedAt; d.updated = d.updated || Date.now();
    (d.sources || []).forEach((s) => { if (s.url) s.url = `/files/${enc(d.id)}/${enc(s.name)}`; });
    try { await store.put(d); n++; } catch (e) { /* skip this one */ }
  }
  toast(`Imported ${n} of ${ok.length} design${ok.length === 1 ? '' : 's'}${copied ? `; ${copied} renamed because the name already existed` : ''}`);
  renderList();
}
async function createDesign() {
  const typed = $('#new-name').value.trim().replace(/\s+/g, ' '), note = $('#new-note'), blank = !typed;
  let made = null;
  for (let k = 1; k < 100 && !made; k++) {
    const name = blank ? (k === 1 ? 'Untitled design' : 'Untitled design ' + k) : typed;
    try { made = await store.create(name); } catch (e) { if (blank && e.taken) continue; if (note) note.textContent = e.message || String(e); return toast(e.message || 'The design could not be created'); }
  }
  const d = { id: made.id, name: made.name, created: Date.now(), updated: Date.now(), sources: [], prd: '', flags: {} };
  try { await store.put(d); } catch (e) { return toast('The design could not be saved'); }
  $('#new-name').value = ''; if (note) note.textContent = ''; $('#new-panel').hidden = true;
  location.hash = `#/design/${encodeURIComponent(d.id)}/1`;
}
/* rename: the project folder is renamed with it, and a name that another design already has is refused */
async function renameDesign(value) {
  const input = $('#design-name'), name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!D) return;
  if (!name) { input.value = D.name; return toast('Give the design a name'); }
  if (name === D.name) return;
  if (st.readOnly) { input.value = D.name; return toast('Read-only: someone else is editing this project.'); }
  try {
    if (store.mode === 'server') {
      await flush();
      const r = await fetch(`/api/designs/${enc(D.id)}/rename`, { method: 'POST', body: JSON.stringify({ name }) }), j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'The design could not be renamed');
      D.id = j.id; D.name = j.name; D.sources.forEach((s) => { if (s.url) s.url = `/files/${enc(D.id)}/${enc(s.name)}`; });
    } else {
      const list = Object.values(lsRead()); if (taken(name, list, D.id)) throw new Error(`A design named "${folderFromName(name)}" already exists. Design names must be different.`);
      const o = lsRead(); delete o[D.id]; D.id = folderFromName(name); D.name = name; o[D.id] = D; lsWrite(o);
    }
    route.watching = D.id; route.synced = D.id; input.value = D.name;
    history.replaceState(null, '', `#/design/${encodeURIComponent(D.id)}/${current}`);
    toast(D.id === D.name ? 'Design renamed' : `Design renamed. The project folder is "${D.id}".`);
  } catch (e) { input.value = D.name; toast(e.message || String(e)); }
}
async function route() {
  const m0 = location.hash.match(/^#\/design\/([^/]+)(?:\/(\d))?/), m = m0 && [m0[0], (() => { try { return decodeURIComponent(m0[1]); } catch (e) { return m0[1]; } })(), m0[2]];
  if (!m) { stopWatch(); route.watching = ''; D = null; return renderList(); }
  let d = null; try { d = await store.get(m[1]); } catch (e) { /* handled below */ }
  if (!d) { toast('That design was not found'); D = null; location.hash = '#/'; return; }
  if (!D || D.id !== d.id) { st.userAi = 0; D = d; D.sources = D.sources || []; D.prd = D.prd || ''; D.flags = D.flags || {}; D.versions = D.versions || []; D.dismissed = D.dismissed || []; D.tests = D.tests || []; D.cc = D.cc || {}; Object.keys(lastPub).forEach((k) => delete lastPub[k]); lastPub.prd = D.prd; impCache = null; loadSt(); }
  $('#view-list').hidden = true; $('#view-design').hidden = false;
  if (store.mode === 'server' && !SET) loadSet().then(applyOdMode); else applyOdMode();
  if (store.mode === 'server') D.sources.forEach((s) => { if (s.url) s.url = `/files/${enc(D.id)}/${enc(s.name)}`; });
  if (!route.watching || route.watching !== D.id) { route.watching = D.id; startWatch(); }
  $('#design-name').value = D.name; if (!PROVS) loadProvs().then(() => { if (current >= 1) setAiNow(st.aiNow || ''); });
  checkPendingJobs();
  show(Math.min(7, Math.max(1, +m[2] || 1)), false);
  if (!route.synced || route.synced !== D.id) { route.synced = D.id; syncFromFolder(true); }
}

/* ---------- wiring ---------- */
function setBusy() {
  $$('button.key').forEach((b) => { b.disabled = st.busy || b.dataset.off === '1'; });
}
async function act(a) {
  switch (a) {
    case 'add-files': return $('#file-in').click();
    case 'cc-minor': { st.ccMinor = !st.ccMinor; return refreshCC(); }
    case 'conv-all': return convertAll();
    case 'install-md': return installMarkItDown();
    case 'merge': return generatePrd();
    case 'tpl-save': return saveTpl();
    case 'tpl-cancel': { st.tplEdit = ''; st.tplBody = ''; return renderTpls(); }
    case 'tpl-upload': return $('#tpl-in').click();
    case 'copy-prd': return copy(D.prd, 'PRD');
    case 'paste-prd': return navigator.clipboard.readText().then((t) => { if (!t.trim()) toast('The clipboard is empty'); else setPrd(t, 'PRD replaced from the clipboard. Undo is available.', 'Pasted from the clipboard'); }).catch(() => toast('Clipboard access is blocked. Click in the editor and paste there.'));
    case 'undo-prd': { if (st.undo === null) return; const u = st.undo; st.undo = null; D.prd = u; flush(); r1(); drawTabs(); return; }
    case 'import-prd': return $('#prd-in').click();
    case 'export-prd': return download(slug(D.name) + '-prd.md', D.prd, 'text/markdown');
    case 'arch-save-version': { if (!(D.archMd || '').trim()) return toast('There is no design to save yet'); const last = (D.archVersions || [])[0]; if (last && last.md === D.archMd) return toast('The current design is already saved as a version'); snapArch('Saved by hand'); flush(); return drawArch(); }
    case 'save-version': { const v = D.versions[0]; if (!D.prd.trim()) return toast('There is no PRD to save yet'); if (v && v.prd === D.prd) return toast('This text is already saved as a version'); snap('Saved by hand'); flush(); return r1(); }
    case 'propose': return propose();
    case 'accept-update': return acceptUpdate();
    case 'discard-update': st.proposal = null; return r1();
    case 'export-md': return doExport('md');
    case 'export-json': return doExport('json');
    case 'export-csv': return doExport('csv');
    case 'export-pdf': return doExport('pdf');
    case 'export-claude': return doExport('claude');
    case 'export-agents': return doExport('agents');
    case 'reset-guardrails': D.guardrails = null; flush(); return r7();
    case 'add-scenario': return addScenario();
    case 'undo-import': { const u = st.matrixUndo; if (!u) return; st.matrixUndo = null; D.matrix = u.rows; D.matrixSrc = u.src || null; st.matrix = u.had; st.importNote = ''; st.matrixDirty = !!u.rows; flush(); return show(3, false); }
    case 'import-matrix': return $('#matrix-in').click();
    case 'import-payloads': return $('#payload-in').click();
    case 'import-payload-folder': return $('#payload-dir').click();
    case 'export-payloads': { const f = await impFiles(); if (!f) return toast('Import payloads first'); return download(slug(D.name) + '-payloads.zip', Core.zip(f.map((x) => ({ name: x.path, text: JSON.stringify(x.json, null, 2) + '\n' }))), 'application/zip'); }
    case 'payload-report': return generateReport();
    case 'report-copy': return copy((D.payReport || {}).md || '', 'Report');
    case 'report-download': { if (!D.payReport) return toast('Generate the report first'); return download(slug(D.name) + '-payload-summary-report.md', D.payReport.md, 'text/markdown'); }
    case 'paste-matrix': return pasteMatrix();
    case 'refresh-link': return refreshLink();
    case 'apply-map': return applyMapping(true);
    case 'apply-pending': { const p = st.mapping; if (!p) return; const m = { ...aiKeep(p.map), ...readMap('map-form') }; if (!m.name && !m.id) return toast('Choose the Name or Scenario ID column'); try { commitMatrix(p.rows, p.name, m, p.link); await flush(); show(3, false); toast('Matrix read and checked'); } catch (e) { toast(e.message || String(e)); } return; }
    case 'cancel-pending': st.mapping = null; return r3();
    case 'arch-blank': return setArch(Core.blankArch(model().title), 'Started a blank design. Use the prompt to build it up.');
    case 'cc-to-prompt': { const r = (D.cc || {}).all; if (!r) return; const lines = []; r.findings.filter((f) => f.type !== 'Quality' && !ccDis().includes(fKey(f))).slice(0, 30).forEach((f) => lines.push(promptFor(f))); r.readiness.risks.forEach((x) => lines.push(`add risk: ${x.where} - ${x.text}`)); addToPrompt([...new Set(lines)]); return toast('Issues added to the prompt. Review it, then propose the update.'); }
    case 'arch-copy': return copy(D.archMd || '', 'Architecture design');
    case 'arch-paste': return navigator.clipboard.readText().then((t) => { if (!t.trim()) toast('The clipboard is empty'); else setArch(t, 'Design replaced from the clipboard. Undo is available.'); }).catch(() => toast('Clipboard access is blocked. Click in the editor and paste there.'));
    case 'arch-undo': { if (st.archUndo === null) return; const u = st.archUndo; st.archUndo = null; D.archMd = u || null; st.arch = D.archMd != null; st.archDirty = true; flush(); drawTabs(); return r6(); }
    case 'export-designs': return exportDesigns();
    case 'import-designs': return $('#designs-in').click();
    case 'arch-export': return download(slug(D.name) + '-architecture.md', D.archMd || '', 'text/markdown');
    case 'arch-propose': return proposeArch();
    case 'arch-accept': return acceptArch();
    case 'arch-discard': st.archProposal = null; return drawArch();
    case 'add-test': return addTest();
    case 'refine-propose': return proposeRefine();
    case 'refine-accept': return acceptRefine();
    case 'refine-discard': st.refine = null; { const d = $('#test-detail'); if (d) d.innerHTML = testDetailHtml(); } return;
    case 'refine-undo': return undoRefine();
    case 'gen-missing': return genPlan();
    case 'export-plan-md': { if (!tests().length) return toast('Create the test plan first'); return download(slug(D.name) + '-test-plan.md', planFiles().md, 'text/markdown'); }
    case 'export-plan-csv': { if (!tests().length) return toast('Create the test plan first'); return download(slug(D.name) + '-test-plan.csv', planFiles().csv, 'text/csv'); }
    case 'export-specs': { if (!tests().length) return toast('Create the test plan first'); return download(slug(D.name) + '-playwright-plan.zip', Core.specsZip(tests(), (t) => evidenceFor(t)), 'application/zip'); }
    case 'copy-spec': { const t = tests()[st.tcIdx]; return copy(t ? testSpecText(t) : '', 'Spec'); }
    case 'remove-import': D.payloadImport = null; impCache = null; flush(); drawTabs(); return r5();
    case 'copy-er': { const h = $('#imp-body'); return copy(h && h._mer || '', 'Diagram source'); }
    case 'ai-analyze': return analyzePrdAi();
    case 'gen-er': return generateErAi();
    case 'toggle-er': st.fullEr = !st.fullEr; return renderImported();
    case 'run-pay-analysis': return analyzeAllPayloads();
    case 'analyze-all': return analyzeAllPayloads();
    case 'link-reqs': return linkRequirementsWithAI({});
    case 'lr-retry': return linkRequirementsWithAI({ ids: st.lrFailed || [] });
    case 'lr-close': st.lrDone = null; st.lrError = ''; return r3();
    case 'revise-payloads': return analyzeAllPayloads();
    case 'rev-discard': st.revError = ''; st.revDone = null; return current === 5 ? r5() : r3();
    case 'rev-undo': { if (st.reviseUndo) { D.matrix = st.reviseUndo; st.reviseUndo = null; st.matrixDirty = true; flush(); } st.revDone = null; return current === 5 ? r5() : r3(); }
    case 'toggle-extra': st.showExtra = !st.showExtra; return r3();
    case 'toggle-minor': st.showMinor = !st.showMinor; return refreshIssues();
    case 'arch-assess': return archAssess();
    case 'arch-review': return archReviewRun();
    case 'arch-solutions': return archSolutions();
    case 'arch-add-decision': return archAddDecision();
    case 'arch-use-decisions': return archUseDecisions();
    case 'arch-generate': return genArch();
    case 'arch-toggle-dis': st.archShowDis = !st.archShowDis; return r6orDraw();
    case 'toggle-dismissed': st.showDismissed = !st.showDismissed; return refreshIssues();
    case 'sync-folder': { await syncFromFolder(false); return shareDir() ? syncFromShare() : undefined; }
    case 'save-all': { await publishAll(); return shareDir() ? saveToShare() : toast('Saved to the designs folder. Press Export folder to also save the Markdown files.'); }
    case 'set-save': return saveData();
    case 'set-pick': return pickData(st.pickStart || '');
    case 'inst-add': return addInstance();
    case 'set-default': return dataDefault();
    case 'set-reveal': { try { await fetch('/api/designs/' + enc((D || {}).id || 'none') + '/reveal', { method: 'POST', body: '{}' }); } catch (e) { /* ignore */ } if (!D) toast('Open a project, then use History to show its folder'); return; }
    case 'hist-reveal': { try { const r = await fetch(`/api/designs/${enc(D.id)}/reveal`, { method: 'POST', body: '{}' }), j = await r.json().catch(() => ({})); if (!r.ok) toast(j.error || 'The folder could not be opened'); } catch (e) { toast('The helper service could not be reached.'); } return; }
    case 'hist-open': return historyPanel();
    case 'hist-close': { const p = $('#hist-panel'); if (p) p.hidden = true; return; }
    case 'lock-takeover': return takeLock(true);
    case 'lock-retry': return takeLock(false);
    case 'remote-dismiss': { const b = bannerState(); b.remote = ''; return drawBanner(); }
    case 'files-dismiss': { const b = bannerState(); b.files = []; return drawBanner(); }
    case 'files-sync': { const b = bannerState(); b.files = []; drawBanner(); await syncFromFolder(false); st.treeSeen = null; return watchOnce(); }
    case 'conf-load': { const id = D.id; stopWatch(); route.watching = ''; D = null; location.hash = '#/'; setTimeout(() => { location.hash = '#/design/' + encodeURIComponent(id) + '/' + current; }, 50); return; }
    case 'conf-force': { store.force = true; try { await store.put(D); bannerState().conflict = ''; bannerState().remote = ''; toast('Saved over the other version'); } catch (e) { toast('Not saved'); } store.force = false; return drawBanner(); }
    case 'share-open': return openShare();
    case 'share-close': { const p = $('#share-panel'); if (p) p.hidden = true; return; }
    case 'share-check': return checkShare();
    case 'conn-add': return addConn();
    case 'prov-save': return saveProvider();
    case 'prov-clear': { st.provEdit = ''; return renderProvs(); }
    case 'conn-try': return tryConn();
    case 'conn-example': { $('#conn-new-type').value = 'http'; $('#conn-new-name').value = 'Microsoft Learn'; $('#conn-new-url').value = 'https://learn.microsoft.com/api/mcp'; $('#conn-new-desc').value = 'Official Microsoft documentation: Dynamics 365, Azure, Power Platform, .NET'; $('#conn-new-docs').value = 'https://learn.microsoft.com/en-us/training/support/mcp'; return; }
    case 'ref-add': return $('#ref-in').click();
    case 'ref-paste': return pasteRef();
    case 'aibar-toggle': st.aiBarOpen = !st.aiBarOpen; return drawAiBar();
    case 'base-add': return $('#base-in').click();
    case 'base-paste': return pasteBase();
    case 'base-view': st.baseView = !st.baseView; return r6orDraw();
    case 'base-remove': return removeBase();
    case 'new-design': { $('#new-panel').hidden = false; return $('#new-name').focus(); }
    case 'create-blank': return createDesign(false);
    case 'cancel-new': $('#new-panel').hidden = true; return;
  }
}
document.addEventListener('click', async (e) => {
  const a = e.target.closest('a.linkkey'); if (a) return;
  if (!e.target.closest('.menu-wrap')) closeAccentMenu();
  const t = e.target.closest('button, tr[data-tc], tr[data-trow], tr[data-pgsel]'); if (!t) return;
  const d = t.dataset;
  if (d.act === 'ai-stop') return aiStop();  /* Stop never counts as a press that allows AI */
  if (t.tagName === 'BUTTON' && (d.act || d.go || d.connask || d.provtest || d.provmodels || d.conntest || d.fixadd !== undefined || /^(next|runrest|gen-)/.test(t.id || ''))) st.userAi = Date.now();
  if (d.stage) return show(+d.stage);
  if (d.mmdretry) { const box = t.closest('.diagram'); if (box) { const src = box.querySelector('pre.code'); const enc = box.dataset.src; box.innerHTML = `<div class="dv-wait" data-mmd="${ea(enc)}">Drawing with Mermaid...</div>`; box.dataset.mm = ''; mmdDeclined = false; dvMermaidOnly(box, true); } return; }
  if (d.mmdcopy) { const box = t.closest('.diagram'); if (box && box.dataset.src) navigator.clipboard.writeText(decodeURIComponent(box.dataset.src)).then(() => toast('Mermaid source copied'), () => toast('The clipboard could not be used')); return; }
  if (d.tpledit) return editTpl(d.tpledit);
  if (d.tpldl) return downloadTpl(d.tpldl);
  if (d.tpldel) return delTpl(d.tpldel);
  if (d.fixline !== undefined) return toggleFix(d.fixkind || 'prd', d.fixline, d.fixkey, d.fixlabel);
  if (d.resolve) { const [k, key] = d.resolve.split('|'); markResolved(k, key, '', 'hand'); flush(); return k === 'prd' ? refreshIssues() : r6orDraw(); }
  if (d.reopen) { const [k, key] = d.reopen.split('|'); delete resolvedMap(k)[key]; flush(); return k === 'prd' ? refreshIssues() : r6orDraw(); }
  if (d.fixadd !== undefined) return addCustomFix(t);
  if (d.provtest) return testProv(d.provtest);
  if (d.provmodels) return listProvModels(d.provmodels);
  if (d.provedit) { st.provEdit = d.provedit; return renderProvs(); }
  if (d.provdel) return delProv(d.provdel);
  if (d.setstart) return pickData(d.setstart);
  if (d.instdel) return removeInstance(d.instdel);
  if (d.connapprove) { try { await fetch(`/api/connections/${enc(d.connapprove)}/approve`, { method: 'POST', body: '{}' }); toast('Approved on this computer'); } catch (e) { toast('Not approved'); } return renderConns(); }
  if (d.conntest) return testConn(d.conntest);
  if (d.connask) return askConn(d.connask);
  if (d.conndel) return delConn(d.conndel);
  if (d.refdel !== undefined) { refDocs().splice(+d.refdel, 1); flush(); return r6orDraw(); }
  if (d.optdel) { const A = D.archAssess; if (A) { A.options = A.options.filter((o) => o.id !== d.optdel); delete archDec()[d.optdel]; flush(); } return r6orDraw(); }
  if (d.optpick) { const [id, i] = d.optpick.split('|'), o = ((D.archAssess || {}).options || []).find((x) => x.id === id); if (o && i === 'other') { const m = (archDec()[id] || {}).manual || {}; if (!String(m.name || '').trim()) return toast('Name your own approach first'); archDec()[id] = { ...(archDec()[id] || {}), choice: 'Other', fromBase: false }; flush(); if (D.archMd != null) promptOnce(optLine(o, archDec()[id])); return r6orDraw(); } if (o && o.choices[+i]) { archDec()[id] = { ...(archDec()[id] || {}), choice: o.choices[+i].name, confirmedBase: !!((archDec()[id] || {}).fromBase && archDec()[id].choice === o.choices[+i].name), fromBase: false }; flush(); if (D.archMd != null) promptOnce(optLine(o, archDec()[id])); return r6orDraw(); } return; }
  if (d.ansfix) { const [key, k] = d.ansfix.split('|'), i = ((D.archAssess || {}).issues || []).find((x) => x.key === key), f = i && readyFixes(i)[+k]; if (f) { const cur = (archAnswers()[key] || {}).picks || [], on = cur.some((p) => p.label === f.label); saveAnswer(i, { picks: on ? cur.filter((p) => p.label !== f.label) : [...cur, { label: f.label, decision: f.decision }] }); flush(); r6orDraw(); } return; }
  if (d.ansres || d.ansadd) { const key = d.ansres || d.ansadd, i = ((D.archAssess || {}).issues || []).find((x) => x.key === key), x = i && archAnswers()[i.key]; if (!i || !x || !((x.picks || []).length || String(x.input || '').trim())) return toast('Select a suggested change or write your own first'); saveAnswer(i, { resolved: true }); flush(); if (d.ansadd) promptOnce(ansLine(i, archAnswers()[i.key])); return r6orDraw(); }
  if (d.ansedit) { const i = ((D.archAssess || {}).issues || []).find((x) => x.key === d.ansedit); if (i) { saveAnswer(i, { resolved: false }); flush(); r6orDraw(); } return; }
  if (d.archdis) { archDis().push(d.archdis); flush(); return r6orDraw(); }
  if (d.archres) { D.archDismissed = archDis().filter((k) => k !== d.archres); flush(); return r6orDraw(); }
  if (d.archuse) { const i = ((D.archAssess || {}).issues || []).find((x) => x.key === d.archuse); if (i) { addToPrompt([i.prompt || `add open item: ${i.where} - ${i.text}`]); toast('Added to the prompt'); } return; }
  if (d.go) { const m = { gen3: genMatrix, gen4: genPlan, gen6: genArch, gen7: genBuild, go1: () => show(1), go3: () => show(3), go5: () => show(5) }; return m[d.go] ? m[d.go]() : show(+d.go); }
  if (d.act) return act(d.act);
  if (d.conv) return convert(d.conv);
  if (d.viewsrc) { st.viewSrc = st.viewSrc === d.viewsrc ? '' : d.viewsrc; return r1(); }
  if (d.rmsrc) { D.sources = D.sources.filter((s) => s.name !== d.rmsrc); if (store.mode === 'server') fetch(`/api/designs/${enc(D.id)}/sources/${enc(d.rmsrc)}`, { method: 'DELETE' }); flush(); r1(); return drawTabs(); }
  if (d.issueUse) { const i = prdIssuesAll().find((x) => x.key === d.issueUse); if (i) { st.promptText = (($('#update-prompt') || {}).value || st.promptText || ''); st.promptText = (st.promptText ? st.promptText.replace(/\s+$/, '') + '\n' : '') + i.prompt; r1(); toast('Added to the prompt. Edit it, then propose the update.'); } return; }
  if (d.issueDismiss) { (D.dismissed = D.dismissed || []).push(d.issueDismiss); flush(); return refreshIssues(); }
  if (d.issueRestore) { D.dismissed = (D.dismissed || []).filter((k) => k !== d.issueRestore); flush(); return refreshIssues(); }
  if (d.mdel !== undefined) { D.matrix.splice(+d.mdel, 1); st.matrixDirty = true; saveSoon(); return r3(); }
  if (d.av) { st.archView = d.av; return drawArch(); }
  if (d.rv) { st.repView = d.rv; return renderImported(); }
  if (d.pv) { st.pview = d.pv; return r1(); }
  if (d.vm) { const [k, m] = d.vm.split(':'); (st.vm = st.vm || {})[k] = m; return k === 'src' ? r1() : r6orDraw(); }
  if (d.mdFull) {
    const src = D.sources?.find((s) => s.name === d.mdFull);
    const base = D.archBase && D.archBase.name === d.mdFull ? D.archBase : null;
    const md = src?.md || base?.md || '';
    mdFull(md, d.mdFull); return;
  }
  if (d.archFull) { mdFull(D.archMd || '', 'Architecture design'); return; }
  if (d.prdFull) { mdFull(D.prd || '', 'Consolidated PRD'); return; }
  if (d.vcmp) { st.cmp = st.cmp === d.vcmp ? '' : d.vcmp; return r1(); }
  if (d.avcmp) { st.acmp = st.acmp === d.avcmp ? '' : d.avcmp; return drawArch(); }
  if (d.avrestore) { const v = (D.archVersions || []).find((x) => x.id === d.avrestore); if (v) { snapArch('Before restore'); st.archUndo = D.archMd == null ? '' : D.archMd; D.archMd = v.md; st.arch = true; st.archDirty = true; snapArch('Restored the version from ' + fmtDate(v.t)); flush(); drawTabs(); drawArch(); toast('Version restored. Undo is available.'); } return; }
  if (d.vrestore) return restoreVersion(d.vrestore);
  if (d.rhtoggle) { st.rhOpen = st.rhOpen || {}; st.rhOpen[d.rhtoggle] = !st.rhOpen[d.rhtoggle]; return drawResetHist(); }
  if (d.rhrestore) return restoreReset(d.rhrestore);
  if (d.copyflow !== undefined) return copy(model().processes[+d.copyflow].flow, 'Diagram source');
  if (d.del) { if (confirmDel !== d.del) { confirmDel = d.del; return renderList(); } confirmDel = ''; await store.del(d.del); toast('Design deleted'); return renderList(); }
  if (d.ch) { st.ch = d.ch; return r3(); }
  if (d.cat) { st.cat = d.cat; return r3(); }
  if (d.addmiss !== undefined) return addMissing(+d.addmiss);
  if (d.rmsrcn !== undefined) return removeSource(+d.rmsrcn);
  if (d.retryfailed) return analyzeAllPayloads({ from: 2, failedOnly: true });
  if (d.retryfrom !== undefined) return analyzeAllPayloads({ from: +d.retryfrom });
  if (d.pgsel !== undefined) { st.viewPg = d.pgsel; st.viewPf = ''; return refreshSplit(); }
  if (d.kt) { st.kt = d.kt; return r3(); }
  if (d.reset) {
    const n = +d.reset;
    if (st.confirmReset !== n) { st.confirmReset = n; const lab = t.textContent; t.textContent = 'Click again to confirm'; t.classList.add('armed'); t.title = 'This removes ' + RESET_WHAT[n] + ' on this page only'; setTimeout(() => { if (st.confirmReset === n) { st.confirmReset = 0; t.textContent = lab; t.classList.remove('armed'); } }, 4000); return; }
    st.confirmReset = 0; t.textContent = 'Reset'; t.classList.remove('armed'); return resetPage(n);
  }
  if (d.trow !== undefined) return selectTest(+d.trow);
  if (d.accentToggle) return toggleAccentMenu();
  if (d.accent) { applyTheme({ ...themeState(), accent: d.accent }, true); closeAccentMenu(); const b = $('#accent-btn'); if (b && b.focus) b.focus(); return; }
  if (d.modeToggle) return applyTheme({ ...themeState(), mode: themeState().mode === 'dark' ? 'light' : 'dark' }, true);
  if (d.ptoggle) return pcToggle(t);
  if (d.pfull) { const p = t.closest('.panel'); if (p) { p.classList.toggle('pfull'); t.textContent = p.classList.contains('pfull') ? 'Scroll box' : 'Full height'; } return; }
  if (d.pall !== undefined) return pcAll(d.pall === '1');
  if (d.ccf) { const [k, v] = d.ccf.split(/:(.+)/); ccF()[k] = v; return refreshCC(); }
  if (d.cc) return runCross();
  if (d.ccdis !== undefined) { const r = (D.cc || {}).all, f = r && r.findings[+d.ccdis]; if (f) { ccDis().push(fKey(f)); flush(); refreshCC(); toast('Dismissed. Use "Restore dismissed" to bring it back.'); } return; }
  if (d.ccrestore) { D.ccDismissed = []; flush(); return refreshCC(); }
  if (d.ccuse !== undefined) { const r = (D.cc || {}).all; if (r && r.findings[+d.ccuse]) { addToPrompt([promptFor(r.findings[+d.ccuse])]); toast('Added to the prompt'); } return; }
  if (d.ccrd) { const r = (D.cc || {}).all; const [k, i] = d.ccrd.split(':'); const x = r && (k === 'b' ? r.readiness.blockers : r.readiness.risks)[+i]; if (x) { addToPrompt([k === 'b' ? `add open item: Blocker - ${x.where}: ${x.text}` : `add risk: ${x.where} - ${x.text}`]); toast('Added to the prompt'); } return; }
  if (d.editprd) return editPrd(d.editprd);
  if (d.pr) { st.pr = d.pr; return r3(); }
  if (d.tsel !== undefined) { st.tcIdx = +d.tsel; st.confirmTdel = -1; return r4(); }
  if (d.tdel !== undefined) { const i = +d.tdel; if (st.confirmTdel !== i) { st.confirmTdel = i; return r4(); } const id = tests()[i].id; tests().splice(i, 1); st.confirmTdel = -1; st.tcIdx = Math.min(st.tcIdx, tests().length - 1); st.testsDirty = true; flush(); toast('Deleted ' + id); return r4(); }
  if (d.pf) { st.viewPf = d.pf; return refreshSplit(); }
  if (d.pdall !== undefined) { $$('.paydetail details.pd-file').forEach((x) => { x.open = d.pdall === '1'; }); return; }
  if (d.payGo) { st.pay = d.payGo; st.call = 0; return show(5); }
  switch (t.id) {
    case 'next': return nextAction();
    case 'runrest': return runRest();
    case 'gen-matrix': return genMatrix();
    case 'dl-xlsx': return exportXlsx();
    case 'gen-plan': return genPlan();
    case 'go-arch': return show(6);
    case 'gen-arch': return genArch();
    case 'gen-build': return genBuild();
    case 'dl-tasks': if (!st.build) return toast('Generate the build plan first'); return download(slug(D.name) + '-tasks.csv', '\ufeff' + Core.tasksCsv(buildPlan()), 'text/csv');
    case 'dl-claude': return doExport('claude');
    case 'dl-agents': return doExport('agents');
    case 'copy-spec': return copy($('#spec-src').textContent, 'Spec');
    case 'dl-arch': if (!D.archMd) return toast('There is no design yet'); return download(slug(D.name) + '-architecture.md', D.archMd, 'text/markdown');
    case 'dl-arch-pdf': if (!D.archMd) return toast('There is no design yet'); return printPdf(exportHtml('High-level architecture: ' + D.name, D.archMd));
    case 'dl-prd': return doExport('md');
    case 'dl-prd-pdf': return doExport('pdf');
    case 'reset': return resetResults();
  }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'prd-editor') { D.prd = e.target.value; saveSoon(); drawTabs(); }
  if (e.target.id === 'update-prompt') st.promptText = e.target.value;
  if (e.target.id === 'refine-prompt') st.refinePrompt = e.target.value;
  if (e.target.id === 'arch-prompt') st.archPrompt = e.target.value;
  if (e.target.id === 'tpl-body') st.tplBody = e.target.value;
  if (e.target.id === 'share-dir') { const c = exportCfg(); c.dir = e.target.value; exportSave(c); }
  if (e.target.id === 'arch-editor') { D.archMd = e.target.value; st.arch = true; st.archDirty = true; saveSoon(); drawTabs(); }
  const t = e.target;
  if (t.dataset && t.dataset.tf !== undefined && t.dataset.ti !== undefined && D.tests && D.tests[+t.dataset.ti]) { const x = D.tests[+t.dataset.ti], f = t.dataset.tf; x[f] = f === 'steps' ? t.value.split('\n') : f === 'reqs' ? (t.value.match(/[A-Z]{1,5}(?:-[A-Z]{2,6})*-\d{1,4}/g) || []) : t.value; st.testsDirty = true; saveSoon(); }
  if (t.dataset && t.dataset.mant !== undefined) { const [id, f] = t.dataset.mant.split('|'), o = ((D.archAssess || {}).options || []).find((x) => x.id === id); if (o) { o[f] = t.value; saveSoon(); } return; }
  if (t.dataset && t.dataset.manf !== undefined) { const [id, f] = t.dataset.manf.split('|'), d = archDec()[id] = { ...(archDec()[id] || {}) }, m = d.manual = { ...(d.manual || {}) }; m[f] = f === 'pros' || f === 'cons' ? t.value.split('\n').map((x) => x.trim()).filter(Boolean) : t.value; saveSoon(); return; }
  if (t.dataset && t.dataset.ansin !== undefined) { const key = t.dataset.ansin, i = ((D.archAssess || {}).issues || []).find((x) => x.key === key); if (i) { saveAnswer(i, { input: t.value }); saveSoon(); const ok = !!(t.value.trim() || ((archAnswers()[key] || {}).picks || []).length); $$('[data-ansres],[data-ansadd]').forEach((b) => { if ((b.dataset.ansres || b.dataset.ansadd) === key) b.disabled = !ok; }); } return; }
  if (t.dataset && t.dataset.optnote !== undefined) { archDec()[t.dataset.optnote] = { ...(archDec()[t.dataset.optnote] || {}), note: t.value }; saveSoon(); return; }
  if (t.classList && t.classList.contains('grow')) fitCell(t);
  if (t.dataset && t.dataset.mf !== undefined && t.dataset.mi !== undefined && D.matrix && D.matrix[+t.dataset.mi]) { const s = D.matrix[+t.dataset.mi], f = t.dataset.mf; if (f.startsWith('x:')) { s.extra = s.extra || {}; s.extra[f.slice(2)] = t.value; } else s[f] = f === 'reqs' ? (t.value.match(/[A-Z]{1,5}(?:-[A-Z]{2,6})*-\d{1,4}/g) || []) : t.value; st.matrixDirty = true; saveSoon(); }
  if (e.target.id === 'guardrails') { D.guardrails = e.target.value; saveSoon(); }
});
document.addEventListener('change', async (e) => {
  if (e.target.dataset && e.target.dataset.mapf !== undefined && !st.mapping && D && D.matrixSrc && D.matrixSrc.raw) { return applyMapping(false); }
  if (e.target.id === 'design-name') { renameDesign(e.target.value); return; }
  if (e.target.id === 'prd-editor') { snap('Edited by hand'); flush(); refreshIssues(); }
  if (e.target.dataset && e.target.dataset.mf !== undefined && D && D.matrix) { refreshChecks(); fitColumns(); }
  if (e.target.dataset && e.target.dataset.tf !== undefined && D && D.tests) { refreshTests(); if (e.target.dataset.tf === 'scenario' || e.target.dataset.tf === 'drives') r4(); }
  if (e.target.dataset && e.target.dataset.linksel !== undefined && D.matrixSrc) { D.matrixSrc.link = e.target.value; flush(); }
  if (e.target.id === 'designs-in') { const f = e.target.files[0]; e.target.value = ''; if (f) importDesigns(f); return; }
  if (e.target.dataset && e.target.dataset.connuse !== undefined) { const id = e.target.dataset.connuse, set = new Set(D.connUse || []); if (e.target.checked) set.add(id); else set.delete(id); D.connUse = [...set]; flush(); return r6orDraw(); }
  if (e.target.dataset && e.target.dataset.fsel !== undefined) { st[e.target.dataset.fsel] = e.target.value; return r3(); }
  if (e.target.id === 'tpl-in') { const f = e.target.files[0]; e.target.value = ''; if (f) { const t = await f.text(); st.tplBody = t; const b = $('#tpl-body'); if (b) b.value = t; const n = $('#tpl-name'); if (n && !n.value.trim()) n.value = f.name.replace(/\.[^.]+$/, ''); toast('File loaded. Choose the document type and press Save template.'); } return; }
  if (e.target.dataset && e.target.dataset.tpldef !== undefined) { setTplDefault(e.target.dataset.tpldef, e.target.value); return; }
  if (e.target.dataset && e.target.dataset.tplpick !== undefined) { const k = e.target.dataset.tplpick, P = (D.tplPick = D.tplPick || {}); if (e.target.value) P[k] = e.target.value; else delete P[k]; flush(); toast('Template choice saved for this design'); return; }
  if (e.target.dataset && e.target.dataset.instsel !== undefined) { activateInstance(e.target.dataset.instsel); return; }
  if (e.target.dataset && e.target.dataset.instname !== undefined) { renameInstance(e.target.dataset.instname, e.target.value); return; }
  if (e.target.id === 'prov-preset') { fillPreset(e.target.value); return; }
  if (e.target.dataset && e.target.dataset.stepsel !== undefined) { setStepProv(e.target.dataset.stepsel, e.target.value); return; }
  if (e.target.id === 'base-in') { const f = e.target.files[0]; e.target.value = ''; if (f) await addBaseFile(f); return; }
  if (e.target.id === 'ref-in') { const f = [...e.target.files]; e.target.value = ''; if (f.length) await addRefFiles(f); return; }
  if (e.target.id === 'matrix-in') { const f = e.target.files[0]; e.target.value = ''; if (f) await importMatrix(f); }
  if (e.target.id === 'payload-in' || e.target.id === 'payload-dir') { const l = [...e.target.files]; const dir = e.target.id === 'payload-dir'; e.target.value = ''; await importPayloadFiles(l, dir); }
  if (e.target.id === 'file-in') { const f = [...e.target.files]; e.target.value = ''; if (f.length) await addFiles(f); }
  if (e.target.id === 'prd-in') { const f = e.target.files[0]; e.target.value = ''; if (f) setPrd(await f.text(), 'Imported ' + f.name + '. Undo is available.', 'Imported ' + f.name); }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { const m = $('#accent-menu'); if (m && !m.hidden) { closeAccentMenu(); const b = $('#accent-btn'); if (b && b.focus) b.focus(); } }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-tc], tr[data-pgsel]')) { e.preventDefault(); e.target.click(); }
  if (e.key === 'Enter' && e.target.id === 'new-name') createDesign(false);
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.fixin !== undefined) { e.preventDefault(); const b = e.target.parentElement.querySelector('[data-fixadd]'); if (b) addCustomFix(b); }
});

/* ---------- collapsible panels: every panel with a heading can be folded, so long pages are easy to scroll ---------- */
const PC_LS = 'prd-demo-panels-collapsed';
let pcSet = null;
const pcLoad = () => { if (!pcSet) { try { pcSet = new Set(JSON.parse(localStorage.getItem(PC_LS) || '[]')); } catch (e) { pcSet = new Set(); } } return pcSet; };
const pcSave = () => { try { localStorage.setItem(PC_LS, JSON.stringify([...pcLoad()].slice(-300))); } catch (e) { /* not saved */ } };
const pcKey = (p) => { if (p.classList.contains('cc')) return 'cross-check'; const st_ = p.closest('.stage, #view-list, #share-panel'), h = p.querySelector(':scope > .panel-head h3'); return (st_ ? st_.id : '') + '|' + (h ? h.textContent.trim().replace(/\s*\(?\d+.*$/, '').slice(0, 60) : ''); };
const PCHEV = '<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" focusable="false"><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function pcApply(p, collapsed) {
  p.classList.toggle('pcollapsed', collapsed);
  const b = p.querySelector(':scope > .panel-head .ptoggle'); if (b) { b.setAttribute('aria-expanded', String(!collapsed)); b.title = collapsed ? 'Expand' : 'Collapse'; }
}
/* ---------- find in a Markdown block: editors, previews and code blocks get a small search bar ---------- */
function taReveal(ta, start, end, keep) {
  /* measure where the match is with a hidden copy of the text, scroll the box to it and select it */
  const cs = getComputedStyle(ta), m = document.createElement('div');
  ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderLeftWidth', 'borderRightWidth', 'borderTopWidth', 'borderBottomWidth', 'boxSizing', 'tabSize'].forEach((k) => { m.style[k] = cs[k]; });
  Object.assign(m.style, { position: 'absolute', visibility: 'hidden', left: '-9999px', top: '0', whiteSpace: 'pre-wrap', overflowWrap: 'break-word', width: ta.offsetWidth + 'px' });
  m.textContent = ta.value.slice(0, start); const s = document.createElement('span'); s.textContent = ta.value.slice(start, end) || '.'; m.appendChild(s); document.body.appendChild(m);
  const top = s.offsetTop; m.remove();
  ta.scrollTop = Math.max(0, top - ta.clientHeight / 2);
  ta.focus({ preventScroll: true }); ta.setSelectionRange(start, end); ta.scrollTop = Math.max(0, top - ta.clientHeight / 2);
  if (keep) keep.focus({ preventScroll: true });
}
function mdFindBuild(target) {
  const bar = document.createElement('div'); bar.className = 'mdfind';
  bar.innerHTML = '<input type="search" class="cell" placeholder="Find in this text" aria-label="Find in this text"><span class="note mdf-count" aria-live="polite"></span><button type="button" class="key small" data-mdf="prev" aria-label="Previous match" title="Previous (Shift+Enter)">&uarr;</button><button type="button" class="key small" data-mdf="next" aria-label="Next match" title="Next (Enter)">&darr;</button>';
  target.parentNode.insertBefore(bar, target);
  const input = bar.querySelector('input'), count = bar.querySelector('.mdf-count'), isTa = target.tagName === 'TEXTAREA';
  let hits = [], cur = -1, mirror = null;
  if (isTa) {
    /* a hidden copy of the text sits behind the transparent editor, so every match can be painted */
    const wrap = document.createElement('div'); wrap.className = 'mdwrap'; target.parentNode.insertBefore(wrap, target);
    mirror = document.createElement('div'); mirror.className = 'mdmirror'; mirror.setAttribute('aria-hidden', 'true'); wrap.appendChild(mirror); wrap.appendChild(target);
    target.addEventListener('scroll', () => { mirror.scrollTop = target.scrollTop; mirror.scrollLeft = target.scrollLeft; });
    if (window.ResizeObserver) new ResizeObserver(() => drawMirror()).observe(target);
  }
  const drawMirror = () => {
    if (!mirror) return;
    const cs = getComputedStyle(target);
    ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth', 'borderRightWidth', 'borderBottomWidth', 'tabSize'].forEach((k) => { mirror.style[k] = cs[k]; });
    mirror.style.width = (target.clientWidth + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth)) + 'px'; mirror.style.height = target.offsetHeight + 'px';
    const q = input.value; let h = '', last = 0; const v = target.value;
    if (q && hits.length) { hits.forEach((p, i) => { h += esc(v.slice(last, p)) + `<mark class="fh${i === cur ? ' cur' : ''}">` + esc(v.slice(p, p + q.length)) + '</mark>'; last = p + q.length; }); }
    mirror.innerHTML = h + esc(v.slice(last)) + '\n'; mirror.scrollTop = target.scrollTop; mirror.scrollLeft = target.scrollLeft;
  };
  const clear = () => { target.querySelectorAll('mark.fh').forEach((x) => { const p = x.parentNode; if (p) { p.replaceChild(document.createTextNode(x.textContent), x); p.normalize(); } }); };
  const paint = (jump) => {
    const q = input.value; count.textContent = !q ? '' : hits.length ? `${cur + 1} of ${hits.length}` : 'No matches';
    if (isTa) { drawMirror(); if (jump && cur >= 0) taReveal(target, hits[cur], hits[cur] + q.length, input); return; }
    hits.forEach((x, i) => x.classList.toggle('cur', i === cur));
    if (jump && hits[cur] && hits[cur].scrollIntoView) hits[cur].scrollIntoView({ block: 'center', inline: 'nearest' });
  };
  const run = (jump) => {
    const q = input.value, lq = q.toLowerCase(); if (!isTa) clear(); hits = []; cur = -1;
    if (q) {
      if (isTa) { const v = target.value.toLowerCase(); let i = v.indexOf(lq); while (i >= 0) { hits.push(i); i = v.indexOf(lq, i + lq.length); } }
      else {
        const w = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement && n.parentElement.closest('.diagram, .dv-bar, script, style, .mdfind') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) }), nodes = [];
        while (w.nextNode()) nodes.push(w.currentNode);
        nodes.forEach((n) => {
          const t = n.nodeValue, lt = t.toLowerCase(); let i = lt.indexOf(lq); if (i < 0) return;
          const f = document.createDocumentFragment(); let last = 0;
          while (i >= 0) { f.appendChild(document.createTextNode(t.slice(last, i))); const mk = document.createElement('mark'); mk.className = 'fh'; mk.textContent = t.slice(i, i + q.length); f.appendChild(mk); hits.push(mk); last = i + q.length; i = lt.indexOf(lq, last); }
          f.appendChild(document.createTextNode(t.slice(last))); n.parentNode.replaceChild(f, n);
        });
      }
      cur = hits.length ? 0 : -1;
    }
    paint(jump);
  };
  const step = (d) => { if (!hits.length) return; cur = (cur + d + hits.length) % hits.length; paint(true); };
  input.addEventListener('input', () => run(true));
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') { input.value = ''; run(false); } });
  bar.querySelector('[data-mdf="prev"]').addEventListener('click', () => step(-1));
  bar.querySelector('[data-mdf="next"]').addEventListener('click', () => step(1));
  if (isTa) target.addEventListener('input', () => { if (input.value) { const keepCur = cur; run(false); cur = Math.min(keepCur, hits.length - 1); paint(false); } });
}
function enhanceFinders() {
  $$('#main textarea#prd-editor, #main textarea#arch-editor, #main .doc, #main pre.code').forEach((t) => {
    if (t.previousElementSibling && t.previousElementSibling.classList.contains('mdfind')) return;
    if (t.closest('.mdfind, .dv, .dv-wait, .mdwrap')) return;
    if (t.tagName === 'PRE' && (t.textContent.match(/\n/g) || []).length < 12) return;
    mdFindBuild(t);
  });
}
function enhancePanels() {
  enhanceFinders();
  enhanceDiagrams();
  const main = $('#main'), lst = $('#view-list');
  if (lst) {
    if (!lst.querySelector(':scope > .collbar')) { const bar = document.createElement('div'); bar.className = 'collbar'; bar.innerHTML = '<button type="button" class="link" data-pall="1">Collapse all sections</button><button type="button" class="link" data-pall="0">Expand all</button>'; const sh = lst.querySelector(':scope > .stage-head'); if (sh) sh.insertAdjacentElement('afterend', bar); }
    lst.querySelectorAll('.panel:not(.newpanel)').forEach((p) => { const head = p.querySelector(':scope > .panel-head'); if (!head || head.querySelector('.ptoggle')) return; const b = document.createElement('button'); b.type = 'button'; b.className = 'key small ptoggle'; b.setAttribute('data-ptoggle', '1'); b.setAttribute('aria-label', 'Collapse or expand this section'); b.innerHTML = PCHEV; head.appendChild(b); pcApply(p, pcLoad().has(pcKey(p))); });
  }
  $$('#share-panel .panel').forEach((p) => { const head = p.querySelector(':scope > .panel-head'); if (!head || head.querySelector('.ptoggle')) return; const b = document.createElement('button'); b.type = 'button'; b.className = 'key small ptoggle'; b.setAttribute('data-ptoggle', '1'); b.setAttribute('aria-label', 'Collapse or expand this section'); b.innerHTML = PCHEV; (head.querySelector('.row-actions') || head).appendChild(b); pcApply(p, pcLoad().has(pcKey(p))); });
  if (!main) return;
  main.querySelectorAll('.stage .panel:not(.newpanel)').forEach((p) => {
    const head = p.querySelector(':scope > .panel-head'); if (!head || head.querySelector('.ptoggle')) return;
    const b = document.createElement('button'); b.type = 'button'; b.className = 'key small ptoggle'; b.setAttribute('data-ptoggle', '1'); b.setAttribute('aria-label', 'Collapse or expand this section'); b.innerHTML = PCHEV;
    const rows = p.querySelectorAll(':scope > .table-wrap tbody tr').length;
    if (rows > 10) { const f = document.createElement('button'); f.type = 'button'; f.className = 'key small pfull-btn'; f.setAttribute('data-pfull', '1'); f.textContent = 'Full height'; f.title = 'Show the whole list instead of a scroll box'; head.appendChild(f); }
    head.appendChild(b); pcApply(p, pcLoad().has(pcKey(p)));
  });
  main.querySelectorAll('.stage').forEach((sg) => {
    if (sg.querySelector(':scope > .collbar')) return;
    const bar = document.createElement('div'); bar.className = 'collbar';
    bar.innerHTML = '<button type="button" class="link" data-pall="1">Collapse all sections</button><button type="button" class="link" data-pall="0">Expand all</button>';
    const after = sg.querySelector(':scope > .cc-slot') || sg.querySelector(':scope > .stage-head'); if (after) after.insertAdjacentElement('afterend', bar);
  });
}
let pcTimer = null;
const pcObserver = new MutationObserver(() => { clearTimeout(pcTimer); pcTimer = setTimeout(enhancePanels, 60); });
function pcToggle(btn) {
  const p = btn.closest('.panel'); if (!p) return;
  const k = pcKey(p), now = !p.classList.contains('pcollapsed'); if (now) pcLoad().add(k); else pcLoad().delete(k); pcSave(); pcApply(p, now);
  if (p.classList.contains('cc')) refreshCC(); /* the cross check is shared: fold or unfold it on every page */
}
function pcAll(collapse) {
  const lv = $('#view-list'), sg = lv && !lv.hidden ? lv : $('.stage.on'); if (!sg) return;
  sg.querySelectorAll('.panel:not(.newpanel)').forEach((p) => { if (!p.querySelector(':scope > .panel-head .ptoggle')) return; const k = pcKey(p); if (collapse) pcLoad().add(k); else pcLoad().delete(k); pcApply(p, collapse); });
  pcSave();
}

/* the AI actions that call the model more than once or write results as they go: one stop puts the whole action back (see aiAction) */
genMatrix = aiAction(genMatrix); generatePrd = aiAction(generatePrd); analyzeAllPayloads = aiAction(analyzeAllPayloads); linkRequirementsWithAI = aiAction(linkRequirementsWithAI);
fillFromPayloads = aiAction(fillFromPayloads); runPayloadAnalysis = aiAction(runPayloadAnalysis); generateErAi = aiAction(generateErAi); genArch = aiAction(genArch); genBuild = aiAction(genBuild); matchUnlinkedWithAI = aiAction(matchUnlinkedWithAI);
window.addEventListener('pagehide', () => { if (D && !st.readOnly) lockCall('DELETE'); });
window.addEventListener('hashchange', route);
applyTheme(themeState(), false);
(async () => { await store.init(); route(); const mm = $('#main'); for (const sel of ['#main', '#view-list', '#share-panel']) { const el = $(sel); if (el) pcObserver.observe(el, { childList: true, subtree: true }); } enhancePanels(); })();
})();
