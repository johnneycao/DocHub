/* Version diff, prompt-based PRD update, extra exports, and the build plan (modules, dependencies, tasks).
   Pure functions, no DOM. Loaded after core.js; adds to window.Core. */
(function (g) {
'use strict';
const C = g.Core;

/* ---------- line diff (LCS) ---------- */
function diffLines(a, b) {
  const A = (a || '').split('\n'), B = (b || '').split('\n'), n = A.length, m = B.length;
  if (n * m > 4000000) { const sa = new Set(A), sb = new Set(B); return [...A.filter((x) => !sb.has(x)).map((s) => ({ t: '-', s })), ...B.filter((x) => !sa.has(x)).map((s) => ({ t: '+', s }))]; }
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = []; let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ t: ' ', s: A[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: '-', s: A[i++] });
    else out.push({ t: '+', s: B[j++] });
  }
  while (i < n) out.push({ t: '-', s: A[i++] });
  while (j < m) out.push({ t: '+', s: B[j++] });
  return out;
}

/* ---------- prompt-based PRD update (rule-based simulation) ---------- */
const nextReqId = (md) => { let max = 0; (md.match(/\bR-(\d+)\b/g) || []).forEach((x) => { max = Math.max(max, +x.slice(2)); }); return 'R-' + String(max + 1).padStart(2, '0'); };
const idxOf = (L, re) => L.findIndex((l) => re.test(l));
function blockEnd(L, start) { let i = start + 1; while (i < L.length && !/^#{1,3}\s/.test(L[i])) i++; return i; }
function addRequirement(L, id, text, src) {
  const h = idxOf(L, /^##\s+(\d+\.\s*)?requirements\b/i);
  const row = `| ${id} | ${text.replace(/\|/g, '/')} | ${src} |`;
  if (h < 0) { L.push('', '## Requirements', '| ID | Requirement | Source |', '| --- | --- | --- |', row); return; }
  const end = blockEnd(L, h); let last = -1;
  for (let i = h + 1; i < end; i++) if (L[i].trim().startsWith('|')) last = i;
  if (last >= 0) { L.splice(last + 1, 0, row); return; }
  let lb = -1; for (let i = h + 1; i < end; i++) if (/^\s*[-*]\s/.test(L[i])) lb = i;
  if (lb >= 0) L.splice(lb + 1, 0, `- **${id}** ${text}`); else L.splice(h + 1, 0, '| ID | Requirement | Source |', '| --- | --- | --- |', row);
}
function addScope(L, kind, items) {
  const re = kind === 'out' ? /^###\s+out[- ]of[- ]scope/i : /^###\s+in[- ]scope/i;
  let h = idxOf(L, re);
  if (h < 0) {
    const s = idxOf(L, /^##\s+(\d+\.\s*)?scope/i);
    if (s < 0) { L.push('', '## Scope', kind === 'out' ? '### Out of scope' : '### In scope', ...items.map((x) => '- ' + x)); return; }
    const e = blockEnd(L, s); L.splice(e, 0, kind === 'out' ? '### Out of scope' : '### In scope', ...items.map((x) => '- ' + x), ''); return;
  }
  const end = blockEnd(L, h); let last = h;
  for (let i = h + 1; i < end; i++) { if (/^\s*[-*]\s*TBD\s*$/i.test(L[i])) { L.splice(i, 1); i--; continue; } if (/^\s*[-*]\s/.test(L[i])) last = i; }
  L.splice(last + 1, 0, ...items.map((x) => '- ' + x));
}
function proposeUpdate(prd, prompt) {
  const L = (prd || '').split('\n'), notes = []; let applied = 0;
  const lines = (prompt || '').split(/\n|;\s*(?=(?:add|remove|delete|change|update|replace)\b)/i).map((x) => x.trim()).filter(Boolean);
  lines.forEach((ins) => {
    let m;
    if ((m = ins.match(/^(?:remove|delete|drop)\s+(?:requirement\s+)?([A-Z]{1,4}-\d+)\b/i))) {
      const id = m[1].toUpperCase(), i = L.findIndex((l) => new RegExp('^\\s*(\\||[-*]\\s*\\**)\\s*' + id + '\\b').test(l));
      if (i < 0) return notes.push(`${id} was not found, nothing removed.`);
      L.splice(i, 1); applied++; return notes.push(`Removed ${id}.`);
    }
    if ((m = ins.match(/^(?:change|update|replace|reword)\s+(?:requirement\s+)?([A-Z]{1,4}-\d+)\s*(?:to|:|as|so that|with)\s+(.+)$/i))) {
      const id = m[1].toUpperCase(), text = m[2].replace(/\.$/, '') + '.', i = L.findIndex((l) => new RegExp('^\\s*(\\||[-*]\\s*\\**)\\s*' + id + '\\b').test(l));
      if (i < 0) return notes.push(`${id} was not found, nothing changed.`);
      if (L[i].trim().startsWith('|')) { const c = L[i].trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim()); c[1] = text; L[i] = '| ' + c.join(' | ') + ' |'; } else L[i] = `- **${id}** ${text}`;
      applied++; return notes.push(`Reworded ${id}.`);
    }
    if ((m = ins.match(/^(?:add\s+)?(.+?)\s+(?:to|as)\s+(in|out of)[ -]scope\.?$/i)) || (m = ins.match(/^(in|out of)[ -]scope\s*:\s*(.+)$/i) && [null, m2(ins)[2], m2(ins)[1]])) {
      const items = (m[1]).split(/\s*(?:,| and )\s*/).map((x) => x.trim()).filter(Boolean), kind = /out/i.test(m[2]) ? 'out' : 'in';
      addScope(L, kind, items); applied++; return notes.push(`Added to ${kind === 'out' ? 'out of scope' : 'in scope'}: ${items.join(', ')}.`);
    }
    if ((m = ins.match(/^add\s+(?:a\s+)?(?:new\s+)?process\s+(.+?)\s*:\s*(.+)$/i))) {
      const steps = m[2].split(/\s*(?:;|->|→|\bthen\b)\s*/i).map((x) => x.trim()).filter(Boolean);
      const n = L.filter((l) => /^###\s+3\.\d+/.test(l)).length + 1, at = idxOf(L, /^##\s+(\d+\.\s*)?requirements\b/i);
      const block = [`### 3.${n} ${m[1]}`, ...steps.map((s, i) => `${i + 1}. ${s}`), '', '```mermaid', C.genFlow(steps), '```', ''];
      if (at < 0) L.push('', '## Processes', ...block); else L.splice(at, 0, ...block);
      applied++; return notes.push(`Added process "${m[1]}" with ${steps.length} steps and a diagram.`);
    }
    if ((m = ins.match(/^add\s+(?:a\s+)?(?:new\s+)?(?:requirement\s*[:\-]?\s*)?(.+)$/i))) {
      const id = nextReqId(L.join('\n')), text = m[1].replace(/^(that|for)\s+/i, '').replace(/\.$/, '');
      addRequirement(L, id, text.charAt(0).toUpperCase() + text.slice(1) + '.', 'Smart update'); applied++; return notes.push(`Added ${id}.`);
    }
    notes.push(`Not understood: "${ins}". Try "add <requirement>", "change R-03 to <text>", "remove R-05", "add <item> to out of scope" or "add process <name>: step; step".`);
  });
  return { prd: L.join('\n'), notes, applied };
}
const m2 = (s) => s.match(/^(in|out of)[ -]scope\s*:\s*(.+)$/i);

/* ---------- exports ---------- */
const csvCell = (v) => '"' + String(v).replace(/"/g, '""') + '"';
function toJson(model, extra) {
  return JSON.stringify({ title: model.title, scope: { in: model.inScope, out: model.outScope }, processes: model.processes.map((p) => ({ name: p.name, steps: p.steps, mermaid: p.flow })), requirements: model.reqs.map((r) => ({ id: r.id, text: r.text, source: r.src || 'PRD', status: r.proposed ? 'proposed' : 'from PRD' })), ...(extra || {}) }, null, 2) + '\n';
}
const toCsv = (model) => ['ID,Requirement,Source,Status', ...model.reqs.map((r) => [r.id, r.text, r.src || 'PRD', r.proposed ? 'Proposed by AI' : 'From the PRD'].map(csvCell).join(','))].join('\r\n') + '\r\n';
const DEFAULT_GUARDRAILS = `## Security
- Never log or store card numbers, tokens or personal data in plain text.
- Validate every input at the service boundary. Reject unknown fields.
- Use the idempotency key on every command that moves money or stock.

## Coding standards
- Every change names the requirement ID it implements (for example R-04).
- Add or update a test for every requirement ID you touch.
- Keep functions small. No new dependency without a note in the pull request.

## Architecture constraints
- One service owns the return lifecycle. Channels call it; they do not duplicate its rules.
- Tax is copied from the original sale. It is never recalculated.
- Integration failures are retried, then queued for a person. Never dropped.
`;
function agentFile(kind, model, guardrails) {
  const L = [`# ${kind}`, '', kind === 'CLAUDE.md' ? 'Read this file before changing code in this project. Work from the requirement IDs below.' : 'Instructions for coding agents working in this project. Work from the requirement IDs below.', '', `## Project: ${model.title}`, '', '## Scope', '### In scope', ...(model.inScope.length ? model.inScope.map((x) => '- ' + x) : ['- Not listed.']), '', '### Out of scope', ...(model.outScope.length ? model.outScope.map((x) => '- ' + x) : ['- Not listed.']), '', '## Requirements', ...model.reqs.map((r) => `- [ ] ${r.id}: ${r.text}${r.proposed ? ' (proposed, not yet approved)' : ''}`), '', '## Processes'];
  model.processes.forEach((p) => { L.push(`### ${p.name}`, ...p.steps.map((s, i) => `${i + 1}. ${s}`), ''); });
  L.push('## Guardrails', (guardrails || DEFAULT_GUARDRAILS).trim(), '', '## How to work', '- Pick the next task from the build plan. Finish one requirement at a time.', '- Run the tests for the scenarios that cover the requirement before you stop.', '- If a requirement is unclear, ask. Do not guess.');
  return L.join('\n') + '\n';
}

/* ---------- build plan: modules, dependencies, tasks ---------- */
const STOP = new Set('that this with from have must when then than into their there which would should could about after before every each only also been being does done other such same will your over under above below'.split(' '));
const toks = (s) => new Set((s.toLowerCase().match(/[a-z][a-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w)));
const inter = (a, b) => [...a].filter((x) => b.has(x)).length;
function planBuild(model, rows) {
  const reqs = model.reqs.filter((r) => r.id);
  let mods = model.processes.map((p, i) => ({ id: 'M' + (i + 1), name: p.name, tk: toks(p.name + ' ' + p.steps.join(' ')), reqs: [] }));
  const byChannel = !mods.length;
  if (byChannel) { const seen = [...new Set(reqs.map((r) => C.chanOf(r.text)))]; mods = seen.map((c, i) => ({ id: 'M' + (i + 1), name: c === 'All' ? 'General' : c + ' channel', tk: new Set(), ch: c, reqs: [] })); }
  let general = null;
  reqs.forEach((r) => {
    if (byChannel) { mods.find((m) => m.ch === C.chanOf(r.text)).reqs.push(r); return; }
    const t = toks(r.text); let best = null, score = 0;
    mods.forEach((m) => { const s = inter(t, m.tk); if (s > score) { score = s; best = m; } });
    if (!best) { if (!general) { general = { id: 'M0', name: 'General', tk: new Set(), reqs: [] }; } general.reqs.push(r); } else best.reqs.push(r);
  });
  if (general) mods.unshift(general);
  mods = mods.filter((m) => m.reqs.length);
  mods.forEach((m, i) => { m.id = 'M' + (i + 1); m.tk = toks(m.reqs.map((r) => r.text).join(' ') + ' ' + m.name); m.dep = []; });
  /* dependency: a later module depends on an earlier one when they share three or more content words; General comes first and everyone relies on it */
  mods.forEach((b, j) => {
    mods.slice(0, j).forEach((a) => { if ((a.name === 'General' && !byChannel) || inter(a.tk, b.tk) >= 3) b.dep.push(a.id); });
  });
  /* transitive reduction so the diagram stays readable */
  const reach = (id, seen = new Set()) => { const m = mods.find((x) => x.id === id); m.dep.forEach((d) => { if (!seen.has(d)) { seen.add(d); reach(d, seen); } }); return seen; };
  mods.forEach((m) => { m.dep = m.dep.filter((d) => !m.dep.some((o) => o !== d && reach(o).has(d))); });
  const wave = {}; mods.forEach((m) => { wave[m.id] = m.dep.length ? Math.max(...m.dep.map((d) => wave[d])) + 1 : 1; m.wave = wave[m.id]; });
  const sc = (id) => rows.filter((s) => s.reqs.includes(id)).map((s) => s.id);
  let n = 0;
  mods.forEach((m) => {
    m.tasks = m.reqs.map((r) => {
      const w = r.text.split(/\s+/).length, h = w < 12 ? 2 : w < 20 ? 3 : 5, scn = sc(r.id);
      const part = (f) => Math.round(h * f * 2) / 2 || 0.5;
      return { id: 'T-' + String(++n).padStart(2, '0'), req: r.id, title: `Implement ${r.id}`, text: r.text, hours: h, scenarios: scn, subtasks: [{ title: 'Build', hours: part(0.6) }, { title: 'Unit tests', hours: part(0.25) }, { title: scn.length ? `Verify scenarios ${scn.join(', ')}` : 'Verify (no scenario yet)', hours: part(0.15) }] };
    });
    m.hours = m.tasks.reduce((a, t) => a + t.hours, 0);
  });
  const flow = ['flowchart LR', ...mods.map((m) => `  ${m.id.toLowerCase()}["${m.name.replace(/"/g, "'")} (${m.reqs.length})"]`), ...mods.flatMap((m) => m.dep.map((d) => `  ${d.toLowerCase()} --> ${m.id.toLowerCase()}`))].join('\n');
  return { modules: mods.map(({ tk, ch, ...rest }) => rest), flow, hours: mods.reduce((a, m) => a + m.hours, 0) };
}
const tasksCsv = (plan) => ['Module,Task ID,Task,Requirement,Estimate (hours),Subtask,Subtask hours', ...plan.modules.flatMap((m) => m.tasks.flatMap((t) => t.subtasks.map((s) => [m.name, t.id, t.title + ': ' + t.text, t.req, t.hours, s.title, s.hours].map(csvCell).join(','))))].join('\r\n') + '\r\n';

Object.assign(C, { diffLines, proposeUpdate, toJson, toCsv, agentFile, DEFAULT_GUARDRAILS, planBuild, tasksCsv });
})(typeof window !== 'undefined' ? window : globalThis);
