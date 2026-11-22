/* Test plan (Playwright baseline), coverage tracking, and cross checks between pages.
   Pure functions, no DOM. Loaded after payload.js; adds to window.Core.
   A cross check only reports differences. It never changes any page's data. */
(function (g) {
'use strict';
const C = g.Core;
const active = (rows) => rows.filter((s) => s.prio !== 'Not required');
const PRIO_ORDER = ['P0', 'P1', 'P2', 'P3', 'Not required'];
const TEST_STATUS = ['Planned', 'Draft', 'Blocked', 'Not required'];
const range = (a) => a.length ? a.join(', ') : 'None';

/* ---------- test cases from the scenario matrix (never overwrite existing ones) ---------- */
const drivesOf = (s) => /^(pos|store|ui|browser|mobile|desktop|front-?end)$/i.test(s.ch) ? 'UI' : 'API';
function nextTestId(tests) { let n = 0; tests.forEach((t) => { const m = String(t.id).match(/^TC-(\d+)$/); if (m) n = Math.max(n, +m[1]); }); return 'TC-' + String(n + 1).padStart(2, '0'); }
function genTests(rows, tests) {
  const have = new Set(tests.map((t) => t.scenario)), out = []; const all = tests.slice();
  active(rows).forEach((s) => {
    if (have.has(s.id)) return;
    const t = { id: nextTestId(all), scenario: s.id, title: s.title || s.name || s.id, drives: drivesOf(s), prio: s.prio || C.defaultPrio(s.kind), reqs: [...s.reqs], status: 'Planned',
      steps: [`Arrange: prepare the data for "${s.title || s.name || s.id}"${s.so ? ` (payload ${s.so})` : ''}.`, 'Act: perform the action under test' + (s.ch && s.ch !== 'All' ? ` in the ${s.ch} channel.` : '.'), `Assert: ${s.expect || 'the expected outcome is stated in the scenario'}.`],
      expect: s.expect || '', notes: '' };
    out.push(t); all.push(t);
  });
  return out;
}
const blankTest = (tests) => ({ id: nextTestId(tests), scenario: '', title: '', drives: 'API', prio: 'P1', reqs: [], status: 'Draft', steps: [''], expect: '', notes: '' });

/* ---------- Playwright skeleton: the baseline for real tests later ---------- */
const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
function specSkeleton(t, evidence) {
  const tags = [t.scenario && '@' + t.scenario, ...t.reqs.map((r) => '@' + r), t.prio && '@' + t.prio.replace(/\s+/g, '')].filter(Boolean);
  const fix = (t.steps || []).filter((x) => x.trim());
  return `import { test, expect } from '@playwright/test';

// ${t.id} for scenario ${t.scenario || '(not linked)'}. Plan only: not implemented yet.
test.describe('${q(t.scenario || 'Unlinked')}', () => {
  test('${q(t.id + ' ' + t.title)}', { tag: [${tags.map((x) => "'" + q(x) + "'").join(', ')}] }, async ({ ${t.drives === 'UI' ? 'page' : 'request'} }) => {
    test.fixme(true, 'Planned test. Implement when the integration exists.');
${fix.map((s, i) => `    // Step ${i + 1}: ${s.replace(/\n/g, ' ')}`).join('\n') || '    // No steps written yet.'}
${t.expect ? `    // Expected: ${t.expect.replace(/\n/g, ' ')}\n` : ''}${evidence && evidence.length ? `    // Payload evidence: ${evidence.join(', ')}\n` : '    // Payload evidence: none imported yet.\n'}    ${t.drives === 'UI' ? "// await page.goto('<app url>');" : "// const res = await request.post('<endpoint>', { data: {} });"}
    ${t.drives === 'UI' ? "// await expect(page.getByRole('...')).toBeVisible();" : '// expect(res.status()).toBe(201);'}
  });
});
`;
}
const csvCell = (v) => '"' + String(v).replace(/"/g, '""') + '"';
function testsCsv(tests) {
  return ['Test,Scenario,Title,Drives,Priority,Requirements,Status,Steps,Expected,Notes', ...tests.map((t) => [t.id, t.scenario, t.title, t.drives, t.prio, t.reqs.join(' '), t.status, (t.steps || []).filter((x) => x.trim()).join(' | '), t.expect, t.notes].map(csvCell).join(','))].join('\r\n') + '\r\n';
}

/* ---------- coverage: scenario, test case and payload, side by side ---------- */
function coverage(rows, tests, pay, model) {
  const byScn = {}; (pay ? pay.matches : []).forEach((m) => m.scenarios.forEach((s) => { const l = m.group || m.label; (byScn[s] = byScn[s] || []); if (!byScn[s].includes(l)) byScn[s].push(l); }));
  const tcBy = {}; tests.filter((t) => t.status !== 'Not required').forEach((t) => { (tcBy[t.scenario] = tcBy[t.scenario] || []).push(t.id); });
  const items = rows.map((s) => {
    const t = tcBy[s.id] || [], p = byScn[s.id] || [];
    const status = s.prio === 'Not required' ? 'Not required' : t.length && p.length ? 'Covered' : t.length ? 'Test only' : p.length ? 'Payload only' : 'Gap';
    return { id: s.id, prio: s.prio, title: s.title || s.name || '', reqs: s.reqs, tests: t, payloads: p, status };
  });
  const sum = {}; PRIO_ORDER.forEach((pr) => { const r = items.filter((i) => i.prio === pr); sum[pr] = { total: r.length, ids: r.map((i) => i.id), covered: r.filter((i) => i.status === 'Covered').map((i) => i.id), testOnly: r.filter((i) => i.status === 'Test only').map((i) => i.id), payloadOnly: r.filter((i) => i.status === 'Payload only').map((i) => i.id), gap: r.filter((i) => i.status === 'Gap').map((i) => i.id) }; });
  const reqs = model.reqs.map((r) => { const sc = items.filter((i) => i.reqs.includes(r.id) && i.status !== 'Not required'); return { id: r.id, scenarios: sc.map((i) => i.id), tests: [...new Set(sc.flatMap((i) => i.tests))], payloads: [...new Set(sc.flatMap((i) => i.payloads))] }; });
  return { items, sum, reqs };
}

/* ---------- many findings with the same cause become one entry ---------- */
const ID_RX = /\b[A-Z]{1,5}(?:-[A-Z]{2,6})*-\d{1,4}\b|\bUAT\d{3,6}\b/g;
function groupFindings(list) {
  const groups = new Map();
  list.forEach((f) => {
    const ids = (f.text.match(ID_RX) || []).concat((f.where.match(ID_RX) || []));
    const norm = f.text.replace(ID_RX, '#').replace(/\s+/g, ' ').trim(), area = f.where.includes(': ') ? f.where.split(': ')[0] : '';
    const key = ids.length ? f.type + '|' + area + '|' + norm : null;
    if (!key) { groups.set(Symbol('single'), { f, ids: [], n: 1 }); return; }
    const g = groups.get(key); if (g) { g.n++; ids.forEach((i) => { if (!g.ids.includes(i)) g.ids.push(i); }); } else groups.set(key, { f, ids: [...new Set(ids)], n: 1, norm, area });
  });
  return [...groups.values()].map((g) => {
    if (g.n < 2) return g.f;
    const shown = g.ids.slice(0, 3).join(', '), more = g.ids.length - 3;
    const lead = /^#/.test(g.norm), rest = g.norm.replace(/^#\s*/, '').replace(/#/g, 'it');
    return { type: g.f.type, where: (g.area ? g.area + ': ' : '') + g.ids[0] + ' and ' + (g.n - 1) + ' more', text: `${g.n} items (${shown}${more > 0 ? ' and ' + more + ' more' : ''}). ${lead ? 'Each ' : 'In each: '}${rest}`, count: g.n };
  });
}

/* ---------- cross checks: one result for every page ---------- */
function crossCheck(page, ctx) {
  if (page === 'arch') page = 'all';
  const out = [], add = (type, where, text) => out.push({ type, where, text });
  const { prd, req, matrix, tests, pay, hasMatrix, hasTests, hasPay } = ctx;
  const act = active(matrix), reqIds = new Set(req.reqs.map((r) => r.id)), scnIds = new Set(matrix.map((s) => s.id));
  const tcByScn = {}; tests.filter((t) => t.status !== 'Not required').forEach((t) => { (tcByScn[t.scenario] = tcByScn[t.scenario] || []).push(t); });
  const payScn = new Set(pay ? pay.matches.flatMap((m) => m.scenarios) : []);
  const reqVsPrd = () => {
    const pm = Object.fromEntries(prd.reqs.map((r) => [r.id, r])), rm = Object.fromEntries(req.reqs.map((r) => [r.id, r]));
    req.reqs.forEach((r) => { if (!pm[r.id]) add('Changed', r.id, `${r.id} is on the requirements page but not in the PRD.`); else if (pm[r.id].text.trim().toLowerCase() !== r.text.trim().toLowerCase()) add('Changed', r.id, `${r.id} is worded differently from the PRD. PRD: "${pm[r.id].text}"`); });
    prd.reqs.forEach((r) => { if (!rm[r.id]) add('Changed', r.id, `${r.id} is in the PRD but was removed from the requirements page.`); });
    const sd = (a, b, label) => { const sb = new Set(b.map((x) => x.toLowerCase())); a.forEach((x) => { if (!sb.has(x.toLowerCase())) add('Changed', 'Scope', `"${x}" is ${label}.`); }); };
    sd(req.inScope, prd.inScope, 'in scope on the requirements page but not in the PRD'); sd(prd.inScope, req.inScope, 'in scope in the PRD but not on the requirements page');
    sd(req.outScope, prd.outScope, 'out of scope on the requirements page but not in the PRD'); sd(prd.outScope, req.outScope, 'out of scope in the PRD but not on the requirements page');
    const pp = Object.fromEntries(prd.processes.map((p) => [p.name.toLowerCase(), p])), rp = Object.fromEntries(req.processes.map((p) => [p.name.toLowerCase(), p]));
    req.processes.forEach((p) => { const o = pp[p.name.toLowerCase()]; if (!o) add('Changed', p.name, `Process "${p.name}" is not in the PRD.`); else if (o.steps.join('|').toLowerCase() !== p.steps.join('|').toLowerCase()) add('Changed', p.name, `The steps of "${p.name}" differ from the PRD (${o.steps.length} steps in the PRD, ${p.steps.length} here).`); });
    prd.processes.forEach((p) => { if (!rp[p.name.toLowerCase()]) add('Changed', p.name, `Process "${p.name}" is in the PRD but was removed from the requirements page.`); });
  };
  const ownMatrix = () => { C.analyzeMatrix(matrix, req).forEach((f) => out.push(f)); };
  if (page === 'req') {
    reqVsPrd();
    if (hasMatrix) req.reqs.forEach((r) => { if (!act.some((s) => s.reqs.includes(r.id))) add('Missing', r.id, `${r.id} has no scenario in the matrix.`); });
    if (hasMatrix) act.forEach((s) => s.reqs.forEach((r) => { if (!reqIds.has(r)) add('Conflict', s.id, `${s.id} cites ${r}, which is not on the requirements page.`); }));
    if (hasTests) req.reqs.forEach((r) => { if (act.some((s) => s.reqs.includes(r.id)) && !act.some((s) => s.reqs.includes(r.id) && tcByScn[s.id])) add('Missing', r.id, `${r.id} has scenarios, but none has a test case.`); });
    if (hasPay) req.reqs.forEach((r) => { const sc = act.filter((s) => s.reqs.includes(r.id)); if (sc.length && !sc.some((s) => payScn.has(s.id))) add('Missing', r.id, `${r.id} has scenarios, but none has a payload.`); });
  }
  if (page === 'matrix') {
    ownMatrix();
    if (hasTests) {
      act.forEach((s) => { const t = tcByScn[s.id]; if (!t) add('Missing', s.id, `${s.id} has no test case.`); else t.forEach((x) => { if (x.prio && s.prio && x.prio !== s.prio) add('Changed', s.id, `${s.id} is ${s.prio} in the matrix, but ${x.id} is ${x.prio}.`); }); });
      tests.forEach((t) => { if (t.scenario && !scnIds.has(t.scenario)) add('Conflict', t.id, `${t.id} is linked to ${t.scenario}, which is not in the matrix.`); });
    }
    if (hasPay && pay) { pay.findings.forEach((f) => { if (f.type === 'Conflict' || f.type === 'Missing') out.push({ type: f.type, where: f.where, text: f.text.replace(/^P\d: /, '') }); }); }
  }
  if (page === 'tests') {
    const seen = {}; tests.forEach((t) => { seen[t.id] = (seen[t.id] || 0) + 1; });
    Object.entries(seen).forEach(([id, n]) => { if (n > 1) add('Quality', id, `Test ID ${id} is used ${n} times.`); });
    tests.forEach((t) => {
      if (!t.title.trim()) add('Quality', t.id, `${t.id} has no title.`);
      if (!(t.steps || []).some((x) => x.trim())) add('Quality', t.id, `${t.id} has no steps.`);
      if (!String(t.expect || '').trim()) add('Quality', t.id, `${t.id} has no expected result.`);
      if (!t.scenario) add('Missing', t.id, `${t.id} is not linked to a scenario.`);
      else if (!scnIds.has(t.scenario)) add('Conflict', t.id, `${t.id} is linked to ${t.scenario}, which is not in the matrix.`);
      else { const s = matrix.find((x) => x.id === t.scenario); if (s.prio === 'Not required' && t.status !== 'Not required') add('Conflict', t.id, `${t.id} tests ${s.id}, which is marked Not required.`); else if (t.prio && s.prio && t.prio !== s.prio && s.prio !== 'Not required') add('Changed', t.id, `${t.id} is ${t.prio}, but ${s.id} is ${s.prio} in the matrix.`); }
      t.reqs.forEach((r) => { if (!reqIds.has(r)) add('Conflict', t.id, `${t.id} cites ${r}, which is not on the requirements page.`); });
    });
    act.forEach((s) => { if (!tcByScn[s.id]) add('Missing', s.id, `${s.id} (${s.prio}) has no test case.`); });
    req.reqs.forEach((r) => { if (act.some((s) => s.reqs.includes(r.id)) && !act.some((s) => s.reqs.includes(r.id) && tcByScn[s.id])) add('Missing', r.id, `${r.id} is not covered by any test case.`); });
    if (hasPay) tests.forEach((t) => { if (t.scenario && scnIds.has(t.scenario) && t.status !== 'Not required' && !payScn.has(t.scenario)) add('Missing', t.id, `${t.id} has no payload evidence yet (${t.scenario}).`); });
  }
  if (page === 'pay') {
    if (!pay) add('Missing', 'Payloads', 'No payloads are imported.');
    else {
      pay.findings.forEach((f) => out.push({ type: f.type, where: f.where, text: f.text.replace(/^P\d: /, f.priority ? f.priority + ': ' : '') }));
      if (hasTests) {
        pay.matches.forEach((m) => m.scenarios.forEach((s) => { if (!tcByScn[s]) add('Missing', m.group || m.label, `${m.group || m.label} is a payload for ${s}, but ${s} has no test case.`); }));
        tests.forEach((t) => { if (t.scenario && t.status !== 'Not required' && scnIds.has(t.scenario) && !payScn.has(t.scenario)) add('Missing', t.id, `${t.id} (${t.scenario}) has no payload.`); });
      }
    }
  }
  if (page === 'all') {
    /* every area in one pass; only the key issues (conflicts, changes, gaps) are kept */
    const tagged = [], seenT = new Set();
    /* page 1: the issues found in the PRD (rule-based and AI), as the user left them */
    (ctx.prdIssues || []).forEach((i) => tagged.push({ type: i.type === 'Conflict' ? 'Conflict' : i.type === 'Wording' ? 'Quality' : 'Missing', where: 'PRD: ' + i.where, text: i.text }));
    [['Requirements', 'req'], ['Matrix', 'matrix'], ['Test plan', 'tests'], ['Payloads', 'pay']].filter(([area]) => !(area === 'Matrix' && !hasMatrix) && !(area === 'Test plan' && !hasTests) && !(area === 'Payloads' && !hasPay)).forEach(([area, p]) => crossCheck(p, ctx).forEach((f) => {
      const k = f.type + '|' + f.text; if (seenT.has(k)) return; seenT.add(k); tagged.push({ type: f.type, where: area + ': ' + f.where, text: f.text });
    }));
    tagged.forEach((f) => out.push(f));
    /* page 7: the build plan against the requirements and the matrix */
    if (ctx.build) {
      if (ctx.buildStale) out.push({ type: 'Changed', where: 'Build plan', text: 'The PRD changed after the build plan was generated. Generate it again.' });
      ctx.build.modules.forEach((m) => m.tasks.forEach((t) => { if (!reqIds.has(t.req)) out.push({ type: 'Conflict', where: 'Build plan: ' + t.id, text: `${t.id} implements ${t.req}, which is not on the requirements page.` }); else if (hasMatrix && !t.scenarios.length) out.push({ type: 'Missing', where: 'Build plan: ' + t.id, text: `${t.id} (${t.req}) has no scenario to verify it.` }); }));
      const planned = new Set(ctx.build.modules.flatMap((m) => m.tasks.map((t) => t.req)));
      req.reqs.forEach((r) => { if (!planned.has(r.id)) out.push({ type: 'Missing', where: 'Build plan: ' + r.id, text: `${r.id} has no task in the build plan.` }); });
    }
    const doc = String(ctx.archMd || '');
    if (doc.trim()) {
      const rq = new Set(req.reqs.map((r) => r.id)), sc = new Set(matrix.map((s) => s.id));
      const pre = [...new Set(req.reqs.map((r) => String(r.id).split('-')[0]).filter(Boolean))], rxr = pre.length ? new RegExp('\\b(?:' + pre.join('|') + ')-\\d{1,4}\\b', 'g') : null;
      (rxr ? [...new Set(doc.match(rxr) || [])] : []).forEach((r) => { if (!rq.has(r)) add('Conflict', 'Architecture: ' + r, `The design cites ${r}, which is not in the requirements.`); });
      const spre = [...new Set(matrix.map((s) => String(s.id).replace(/\d+$/, '')).filter((p) => /^[A-Za-z]+-$/.test(p)))], rxs = hasMatrix && spre.length ? new RegExp('\\b(?:' + spre.join('|') + ')\\d{1,4}\\b', 'g') : null;
      (rxs ? [...new Set(doc.match(rxs) || [])] : []).forEach((s) => { if (!sc.has(s)) add('Conflict', 'Architecture: ' + s, `The design cites ${s}, which is not in the scenario matrix.`); });
      /* the other direction: what the design leaves out */
      const cites = (id) => { const e = String(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return new RegExp('(^|[^A-Za-z0-9-])' + e + '(?![A-Za-z0-9-])').test(doc); };
      req.reqs.forEach((r) => { if (!cites(r.id)) add('Missing', 'Architecture: ' + r.id, `${r.id} is not addressed in the design (not cited anywhere).`); });
      if (hasMatrix) {
        const citedScn = act.filter((s) => cites(s.id));
        if (!citedScn.length && act.length) add('Missing', 'Architecture: Scenarios', `The design does not cite any scenario of the matrix (${act.length} active), so decisions cannot be traced to scenarios.`);
        else act.filter((s) => (s.prio === 'P0' || s.prio === 'P1') && !cites(s.id)).forEach((s) => add('Missing', 'Architecture: ' + s.id, `${s.id} (${s.prio}) is not covered by the design (not cited anywhere).`));
        matrix.filter((s) => s.prio === 'Not required' && cites(s.id)).forEach((s) => add('Changed', 'Architecture: ' + s.id, `The design cites ${s.id}, which is marked Not required in the matrix.`));
      }
      if (hasTests) {
        const tid = new Set(tests.map((t) => t.id));
        [...new Set(doc.match(/\bTC-\d{1,4}\b/g) || [])].forEach((t) => { if (!tid.has(t)) add('Conflict', 'Architecture: ' + t, `The design cites ${t}, which is not in the test plan.`); });
      }
      /* the three required diagrams: high-level architecture, key-entity ER with the SSoT, a swimlane per process */
      const blocks = (doc.match(/```mermaid[\s\S]*?```/g) || []).map((b) => b.replace(/```mermaid|```/g, '').replace(/^\s*(?:%%[^\n]*\n)*/, '').trim());
      const flows = blocks.filter((b) => /^(flowchart|graph)\b/i.test(b)), lanes = flows.filter((b) => /^\s*subgraph\b/m.test(b)), ers = blocks.filter((b) => /^erDiagram\b/i.test(b));
      if (!flows.length) add('Missing', 'Architecture: High-level diagram', 'The design has no high-level architecture diagram (Mermaid flowchart).');
      if (!ers.length) add('Missing', 'Architecture: ER diagram', 'The design has no ER diagram of the key data entities.');
      else if (!/\bSSoT\b|single source of truth|system of record/i.test(doc)) add('Missing', 'Architecture: SSoT', 'The design does not say which system is the single source of truth (SSoT) for each key entity.');
      const procs = (prd.processes || []).length;
      if (procs && lanes.length < procs) add('Missing', 'Architecture: Process diagrams', `The PRD has ${procs} processes, but the design has ${lanes.length} swimlane activity diagram(s) (flowchart with one subgraph per actor).`);
      if (blocks.length && blocks.some((b, i) => !/%%\{\s*init[^}]*theme/i.test((doc.match(/```mermaid[\s\S]*?```/g) || [])[i] || ''))) add('Quality', 'Architecture: Diagrams', 'Some diagrams do not start with the light theme line %%{init: {\'theme\':\'default\'}}%%.');
      const ap = ctx.archPending;
      if (ap && ap.checked && (ap.issues || ap.options)) add('Missing', 'Architecture: Decisions', `The readiness check still has ${ap.issues} item(s) to resolve and ${ap.options} design decision(s) to make.`);
    }
  }
  const ORD = { Conflict: 0, Changed: 1, Missing: 2, Unmatched: 3, Quality: 4 }, seen = new Set();
  const uniq = out.filter((x) => { const k = x.type + x.where + x.text; return !seen.has(k) && seen.add(k); });
  return groupFindings(uniq).sort((a, b) => (ORD[a.type] ?? 9) - (ORD[b.type] ?? 9));
}

/* ---------- refine one test case with a prompt (rule-based simulation; shows a proposal, never applies it) ---------- */
const HELP = 'Try: add step: <text> | add step 2: <text> | change step 2 to <text> | remove step 3 | set expected to <text> | rename to <text> | set priority P0 | set status Blocked | switch to UI | add requirement R-05 | add negative check <text> | add assertion <text> | add note <text>';
function refineTest(test, prompt) {
  const t = JSON.parse(JSON.stringify(test)), notes = []; let applied = 0;
  t.steps = (t.steps || []).filter((x) => x.trim());
  String(prompt || '').split(/\n|;\s*(?=(?:add|remove|delete|change|update|replace|set|rename|switch)\b)/i).map((x) => x.trim()).filter(Boolean).forEach((ins) => {
    let m; const ok = (msg) => { applied++; notes.push(msg); };
    if ((m = ins.match(/^(?:remove|delete|drop)\s+step\s+(\d+)/i))) { const i = +m[1] - 1; if (i < 0 || i >= t.steps.length) return notes.push(`Step ${m[1]} does not exist.`); t.steps.splice(i, 1); return ok(`Removed step ${m[1]}.`); }
    if ((m = ins.match(/^(?:change|update|replace|reword)\s+step\s+(\d+)\s*(?:to|with|as|:)\s*(.+)$/i))) { const i = +m[1] - 1; if (i < 0 || i >= t.steps.length) return notes.push(`Step ${m[1]} does not exist.`); t.steps[i] = m[2].trim(); return ok(`Reworded step ${m[1]}.`); }
    if ((m = ins.match(/^add\s+(?:a\s+)?(?:negative|edge|boundary)\s+check\s*[:\-]?\s*(.+)$/i))) { t.steps.push('Assert (negative case): ' + m[1].trim()); return ok('Added a negative check.'); }
    if ((m = ins.match(/^add\s+(?:an?\s+)?assert(?:ion)?\s*[:\-]?\s*(.+)$/i))) { t.steps.push('Assert: ' + m[1].trim()); return ok('Added an assertion.'); }
    if ((m = ins.match(/^add\s+(?:a\s+)?step(?:\s+(\d+))?\s*[:\-]?\s*(.+)$/i))) { const at = m[1] ? Math.min(Math.max(+m[1] - 1, 0), t.steps.length) : t.steps.length; t.steps.splice(at, 0, m[2].trim()); return ok(`Added a step at position ${at + 1}.`); }
    if ((m = ins.match(/^(?:set|change|update)\s+(?:the\s+)?(?:expected(?:\s+result)?|expectation)\s*(?:to|:)\s*(.+)$/i))) { t.expect = m[1].trim().replace(/\.$/, ''); return ok('Changed the expected result.'); }
    if ((m = ins.match(/^(?:rename|retitle)(?:\s+(?:it|the test))?\s*(?:to|:)\s*(.+)$/i)) || (m = ins.match(/^(?:set|change)\s+(?:the\s+)?title\s*(?:to|:)\s*(.+)$/i))) { t.title = m[1].trim(); return ok('Changed the title.'); }
    if ((m = ins.match(/^(?:set|change)?\s*priority\s*(?:to|:)?\s*(p\s*[0-3]|not required)/i))) { const p = C.normPrio(m[1]); if (!p) return notes.push('Priority was not understood.'); t.prio = p; return ok(`Priority is now ${p}.`); }
    if ((m = ins.match(/^(?:set|change)\s+status\s*(?:to|:)?\s*(planned|draft|blocked|not required)/i))) { t.status = TEST_STATUS.find((x) => x.toLowerCase() === m[1].toLowerCase()); return ok(`Status is now ${t.status}.`); }
    if ((m = ins.match(/^(?:switch|change|set)\s+(?:to\s+|drives?\s+)?(ui|api)\b/i))) { t.drives = m[1].toUpperCase(); return ok(`The test now drives ${t.drives}.`); }
    if ((m = ins.match(/^add\s+requirement\s+([A-Z]{1,4}-\d+)/i))) { const r = m[1].toUpperCase(); if (!t.reqs.includes(r)) t.reqs.push(r); return ok(`Linked ${r}.`); }
    if ((m = ins.match(/^(?:remove|unlink)\s+requirement\s+([A-Z]{1,4}-\d+)/i))) { const r = m[1].toUpperCase(); t.reqs = t.reqs.filter((x) => x !== r); return ok(`Unlinked ${r}.`); }
    if ((m = ins.match(/^add\s+note\s*[:\-]?\s*(.+)$/i))) { t.notes = (t.notes ? t.notes + '\n' : '') + m[1].trim(); return ok('Added a note.'); }
    notes.push(`Not understood: "${ins}". ${HELP}`);
  });
  if (!t.steps.length) t.steps = [''];
  return { test: t, notes, applied };
}

/* ---------- architecture document: update with a prompt (rule-based simulation; proposes, never applies) ---------- */
const ARCH_HELP = 'Try: add decision: <text> | change D3 to <text> | remove D4 | set status of D2 to Agreed | add open item: <text> | add to <section>: <text> | add section <Title>: <text> | rename section <old> to <new> | add risk: <text> | add assumption: <text>';
function secRange(L, re) { const s = L.findIndex((l) => /^##\s/.test(l) && re.test(l)); if (s < 0) return null; let e = s + 1; let fence = false; while (e < L.length && (fence || !/^##\s/.test(L[e]))) { if (L[e].startsWith('```')) fence = !fence; e++; } return { s, e }; }
function proposeArchUpdate(md, prompt) {
  const L = String(md || '').split('\n'), notes = []; let applied = 0;
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim());
  const decRow = (id) => L.findIndex((l) => new RegExp('^\\|\\s*' + id + '\\s*\\|', 'i').test(l));
  const nextD = () => { let n = 0; L.forEach((l) => { const m = l.match(/^\|\s*D(\d+)\s*\|/); if (m) n = Math.max(n, +m[1]); }); return 'D' + (n + 1); };
  const bullet = (re, text, create) => {
    let r = secRange(L, re);
    if (!r) { if (!create) return false; while (L.length && !L[L.length - 1].trim()) L.pop(); L.push('', '## ' + create); r = secRange(L, re); }
    let at = r.e; while (at - 1 > r.s && !L[at - 1].trim()) at--;
    const prev = L[at - 1] || ''; const ins = []; if (prev.startsWith('|') || prev.startsWith('```')) ins.push('');
    ins.push('- ' + text); L.splice(at, 0, ...ins); return true;
  };
  const esc2 = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  String(prompt || '').split(/\n|;\s*(?=(?:add|remove|delete|change|update|set|rename|mark)\b)/i).map((x) => x.trim()).filter(Boolean).forEach((ins) => {
    let m; const ok = (msg) => { applied++; notes.push(msg); };
    if ((m = ins.match(/^add\s+decision\s*[:\-]?\s*(.+)$/i))) {
      const r = secRange(L, /decisions/i); let last = -1; if (r) for (let i = r.s + 1; i < r.e; i++) if (/^\|\s*D\d+\s*\|/.test(L[i])) last = i;
      if (last < 0) return notes.push('The document has no decisions table to add to.');
      const id = nextD(); L.splice(last + 1, 0, `| ${id} | ${m[1].trim().replace(/\|/g, '/')} | To confirm | | Proposed |`); return ok(`Added ${id}.`);
    }
    if ((m = ins.match(/^(?:change|update|reword)\s+(D\d+)\s*(?:to|:|as)\s*(.+)$/i))) { const i = decRow(m[1]); if (i < 0) return notes.push(`${m[1]} was not found.`); const c = cells(L[i]); c[1] = m[2].trim().replace(/\|/g, '/'); L[i] = '| ' + c.join(' | ') + ' |'; return ok(`Reworded ${m[1].toUpperCase()}.`); }
    if ((m = ins.match(/^(?:remove|delete|drop)\s+(D\d+)\b/i))) { const i = decRow(m[1]); if (i < 0) return notes.push(`${m[1]} was not found.`); L.splice(i, 1); return ok(`Removed ${m[1].toUpperCase()}.`); }
    if ((m = ins.match(/^(?:set\s+status\s+of|mark)\s+(D\d+)\s*(?:to|as)\s*(agreed|proposed|to confirm|rejected)/i))) { const i = decRow(m[1]); if (i < 0) return notes.push(`${m[1]} was not found.`); const c = cells(L[i]); while (c.length < 5) c.push(''); c[4] = m[2][0].toUpperCase() + m[2].slice(1).toLowerCase(); L[i] = '| ' + c.join(' | ') + ' |'; return ok(`${m[1].toUpperCase()} is now ${c[4]}.`); }
    if ((m = ins.match(/^add\s+open\s+item\s*[:\-]?\s*(.+)$/i))) { bullet(/open items/i, m[1].trim(), 'Open items'); return ok('Added an open item.'); }
    if ((m = ins.match(/^add\s+(risk|assumption|note)\s*[:\-]?\s*(.+)$/i))) { const k = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(); bullet(/^##\s+(\d+\.\s*)?(risks|notes|risks and assumptions)/i, `${k}: ${m[2].trim()}`, 'Risks and assumptions'); return ok(`Added a ${m[1].toLowerCase()}.`); }
    if ((m = ins.match(/^add\s+section\s+(.+?)\s*[:\-]\s*(.+)$/i))) { while (L.length && !L[L.length - 1].trim()) L.pop(); L.push('', '## ' + m[1].trim(), '- ' + m[2].trim()); return ok(`Added the section "${m[1].trim()}".`); }
    if ((m = ins.match(/^rename\s+section\s+(.+?)\s+to\s+(.+)$/i))) { const i = L.findIndex((l) => /^##\s/.test(l) && new RegExp(esc2(m[1].trim()), 'i').test(l)); if (i < 0) return notes.push(`The section "${m[1]}" was not found.`); const num = (L[i].match(/^##\s+(\d+\.\s*)?/) || [])[1] || ''; L[i] = '## ' + num + m[2].trim(); return ok('Renamed the section.'); }
    if ((m = ins.match(/^add\s+to\s+(.+?)\s*[:\-]\s*(.+)$/i))) { if (!bullet(new RegExp('^##\\s+(\\d+\\.\\s*)?.*' + esc2(m[1].trim()), 'i'), m[2].trim(), '')) return notes.push(`The section "${m[1]}" was not found.`); return ok(`Added to "${m[1].trim()}".`); }
    notes.push(`Not understood: "${ins}". ${ARCH_HELP}`);
  });
  return { md: L.join('\n'), notes, applied };
}

/* ---------- readiness: is the data good enough to build the architecture design? ---------- */
function readiness(ctx) {
  const { req, matrix, tests, pay, hasMatrix, hasTests, hasPay, prdText, prdIssues } = ctx;
  const blockers = [], risks = [], good = [], act = active(matrix);
  const ids = (a) => a.length > 8 ? a.slice(0, 8).join(', ') + ` and ${a.length - 8} more` : a.join(', ');
  if (!String(prdText || '').trim()) blockers.push({ where: 'PRD', text: 'There is no PRD, so there is nothing to design from.' });
  else if (!req.reqs.length) blockers.push({ where: 'Requirements', text: 'The PRD has no requirements with an ID.' });
  else good.push(`${req.reqs.length} requirements are in the PRD (${ids(req.reqs.map((r) => r.id))}).`);
  if (hasPay) good.push(`${pay ? pay.matches.length : 0} payload files are imported.`); /* payloads are optional */
  if (!hasMatrix) risks.push({ where: 'Matrix', text: 'There is no scenario matrix, so decisions cannot be traced to scenarios.' });
  else {
    const unc = req.reqs.filter((r) => !act.some((s) => s.reqs.includes(r.id))).map((r) => r.id);
    if (unc.length) risks.push({ where: 'Matrix', text: `${unc.length} requirements have no active scenario: ${ids(unc)}.` }); else if (req.reqs.length) good.push('Every requirement has an active scenario.');
  }
  if (hasMatrix && hasPay && pay) {
    const miss = act.filter((s) => (s.prio === 'P0' || s.prio === 'P1') && !pay.matches.some((m) => m.scenarios.includes(s.id))).map((s) => s.id);
    if (pay.covered === 0) risks.push({ where: 'Payloads', text: 'No scenario has a matching payload, so none of the design is backed by evidence.' });
    else if (miss.length) risks.push({ where: 'Payloads', text: `${miss.length} P0 or P1 scenarios have no payload: ${ids(miss)}.` }); else good.push('Every P0 and P1 scenario has a payload.');
    const conf = pay.findings.filter((f) => f.type === 'Conflict');
    if (conf.length) risks.push({ where: 'Payloads', text: `${conf.length} payloads disagree with the matrix: ${ids(conf.map((f) => f.where))}.` });
  }
  if (hasMatrix) {
    const mc = C.analyzeMatrix(matrix, req).filter((f) => f.type === 'Conflict');
    if (mc.length) risks.push({ where: 'Matrix', text: `${mc.length} scenarios conflict with the PRD: ${ids([...new Set(mc.map((f) => f.where))])}.` });
  }
  if (!/\bssot\b|single source of truth|source of truth|system of record/i.test(String(prdText || '') + '\n' + String(ctx.archMd || ''))) risks.push({ where: 'Data', text: 'No document says which system is the single source of truth (SSoT) for the key data entities. Confirm one owner per entity before the design.' });
  const prop = req.reqs.filter((r) => r.proposed).map((r) => r.id);
  if (prop.length) risks.push({ where: 'Requirements', text: `${prop.length} proposed requirements are not approved: ${ids(prop)}.` });
  const dec = (prdIssues || []).filter((i) => i.type === 'Decision needed' || i.type === 'Conflict');
  if (dec.length) risks.push({ where: 'PRD', text: `${dec.length} PRD decisions or conflicts are still open: ${ids([...new Set(dec.map((i) => i.where))])}.` });
  const verdict = blockers.length ? 'Blocked' : risks.length ? 'Ready with risks' : 'Ready';
  const summary = verdict === 'Blocked' ? 'The design cannot be generated until the blockers are resolved.' : verdict === 'Ready with risks' ? 'The design can be generated. The risks below will weaken parts of it: resolve them, or accept them and note them in the design.' : 'The data is consistent enough to generate the design.';
  return { verdict, summary, blockers, risks, good };
}
const blankArch = (title) => `# High-level architecture: ${title || 'Untitled'}

## 1. Context
- Inputs: to be filled in.

## 2. Decisions
| ID | Decision | Evidence | Requirements | Status |
| --- | --- | --- | --- | --- |
| D1 | To be decided | To confirm | | Proposed |

## 12. Open items
- None yet.
`;

function planMd(tests, cov, title) {
  const L = [`# Test plan: ${title}`, '', '## Coverage by priority', '| Priority | Scenarios | Covered | Test only | Payload only | Gap |', '| --- | --- | --- | --- | --- | --- |', ...PRIO_ORDER.filter((p) => cov.sum[p].total).map((p) => { const s = cov.sum[p]; return `| ${p} | ${s.total} (${range(s.ids)}) | ${s.covered.length} (${range(s.covered)}) | ${s.testOnly.length} (${range(s.testOnly)}) | ${s.payloadOnly.length} (${range(s.payloadOnly)}) | ${s.gap.length} (${range(s.gap)}) |`; }), '', '## Test cases', '| Test | Scenario | Title | Drives | Priority | Status |', '| --- | --- | --- | --- | --- | --- |', ...tests.map((t) => `| ${t.id} | ${t.scenario || ''} | ${t.title.replace(/\|/g, '/')} | ${t.drives} | ${t.prio} | ${t.status} |`), ''];
  tests.forEach((t) => { L.push(`### ${t.id} ${t.title}`, `- Scenario: ${t.scenario || 'not linked'}. Requirements: ${t.reqs.join(', ') || 'none'}.`, ...(t.steps || []).filter((x) => x.trim()).map((s, i) => `${i + 1}. ${s}`), `- Expected: ${t.expect || 'not written'}`, ...(t.notes ? [`- Notes: ${t.notes}`] : []), ''); });
  return L.join('\n');
}
function specsZip(tests, evidenceOf) {
  return C.zip(tests.filter((t) => t.status !== 'Not required').map((t) => ({ name: `tests/${(t.drives === 'UI' ? 'ui' : 'api')}/${t.id.toLowerCase()}.spec.ts`, text: specSkeleton(t, evidenceOf ? evidenceOf(t) : []) })));
}

/* what a cross check looked at: shown with the result so it is clear which pairs were compared */
function ccScope(ctx) {
  const { req, matrix, tests, pay, hasMatrix, hasTests, hasPay } = ctx, doc = String(ctx.archMd || ''), act = active(matrix), L = [];
  const cites = (id) => doc.includes(id);
  L.push(`Requirements: ${req.reqs.length} checked against the PRD`);
  L.push(hasMatrix ? `Scenario matrix: ${matrix.length} scenarios (${act.length} active) against the requirements` : 'Scenario matrix: skipped (none)');
  L.push(hasTests ? `Test plan: ${tests.length} test cases against scenarios and requirements` : 'Test plan: skipped (optional, none)');
  L.push(hasPay ? `Payloads: ${pay ? pay.matches.length : 0} files against scenarios and test cases` : 'Payloads: skipped (optional, none)');
  L.push(doc.trim() ? `Architecture design: cites ${req.reqs.filter((r) => cites(r.id)).length} of ${req.reqs.length} requirements${hasMatrix ? ' and ' + act.filter((s) => cites(s.id)).length + ' of ' + act.length + ' active scenarios' : ''}` : 'Architecture design: skipped (none)');
  return L;
}
Object.assign(C, { ccScope, groupFindings, readiness, blankArch, proposeArchUpdate, ARCH_HELP, refineTest, REFINE_HELP: HELP, TEST_STATUS, PRIO_ORDER, genTests, blankTest, specSkeleton, testsCsv, coverage, crossCheck, planMd, specsZip });
})(typeof window !== 'undefined' ? window : globalThis);
