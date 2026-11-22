# AI steps: review for local Ollama (cloud kept working)

Review only. No fixes applied for the items below. Sizes are estimates (3 characters per token; real use is about 3.5 to 4).
Window used for the check: Ollama default `numCtx` 32,768 tokens, about 100K characters of prompt plus answer.

## 1. Step by step

| # | Step | Input sent (one call) | Output | Local risk | Why |
|---|---|---|---|---|---|
| 1 | Generate PRD (`gen-prd`) | all source documents (up to 400K chars) + template | full PRD Markdown | **High** | Input alone can exceed the window; long answer; no batching or trimming |
| 2 | Apply a template (`compose-doc`) | whole draft + template | full document | **High** | Document is read once and written once: needs about 2x its size |
| 3 | PRD analysis (`analyze-prd`) | PRD | JSON, up to 12 issues | Low | Fits while the PRD is under about 60K chars |
| 4 | Scenario categories (`scenario-plan`) | PRD + requirement list | small JSON | Low | Same limit as 3 |
| 5 | Scenario generation (`gen-scenarios`) | PRD + a batch of requirements, repeated per batch | JSON scenarios, up to 12K tokens | Medium | Many calls, each re-reads the PRD; long JSON arrays; 2 tries then the whole run stops |
| 6a | Payload matching (`analyze-payloads` match) | 25 payload digests + up to 250 scenarios | JSON matches | Medium | Can pass 30K tokens |
| 6b | Requirement linking (`analyze-payloads` reqs) | up to 60K chars per batch + requirement list | JSON | Medium | Borderline |
| 6c | Scenario fill (`fill-scenarios`) | batches of up to 100K chars of payload data | JSON | **High** | Batch size is set for cloud: one batch is about 33K tokens, above 32K |
| 6d | Payload mismatch, review, ER (`analyze-payloads`) | whole analysis, matrix and digests | JSON / Mermaid | Medium to High | Not batched; grows with the payload library |
| 7 | Test refinement (`refine-test`) | one test case | JSON | Low | Small |
| 8 | Build plan (`build-plan`) | requirements + matrix | JSON modules and tasks | Medium to High | Long structured output |
| 9 | Readiness check (`arch-assess`) | PRD, requirements, matrix, tests, payload digest, baseline (40K), design (60K), references (80K) | JSON issues + options | **High** | Can reach about 75K tokens |
| 10 | Find solutions (`arch-options`) | same context | JSON options with pros and cons | **High** | Same input; long nested output (3+ choices each) |
| 11 | Architecture design (`gen-arch`) | same context + decisions + template | full design with 3 diagrams | **High** | Big input and a 10K+ token answer |
| 12 | Design review (`arch-review`) | context + whole design + decisions | JSON | **High** | Context plus the design |
| 13 | Update with a prompt (`update-doc`) | design + all background documents | full design back | **High** (failing now) | Design read once and written once, plus the background |
| 14 | Connection test with AI (`ask`) | question + tools | text | Medium | Needs tool calling |

## 2. Problems that cut across steps

| ID | Problem | Effect on local | Effect on cloud |
|---|---|---|---|
| P1 | Prompts are built for large windows; only steps 9 to 13 got any shortening, and that code is not tested yet | Refused (413) or cut; run fails | None |
| P2 | Batch sizes are fixed (100K chars, 60K chars, 25 payloads, 250 scenarios) | Same as P1 for steps 5, 6, 8 | None |
| P3 | Window is sized from the prompt only (input x 1.5 + 2K). A small input with a long answer (PRD, design) gets too small a window | Answer cut off at the window; reported as "stopped before it finished" | None |
| P4 | Window size changes between calls (8K, 16K, 32K) | Ollama reloads the model each time the size changes: slow | None |
| P5 | Fixed 600 s timeout per call | A 10K-token answer at 10 to 20 tokens per second takes 8 to 16 minutes: timeout | Rarely |
| P6 | No streaming | No progress; whole call lost on timeout | Same |
| P7 | Reasoning models (such as Qwen3) think by default; `think` is not set | Thinking uses time and window | Cost on some cloud models |
| P8 | Documentation connections use a tool loop (up to 20 turns, pages of 11K chars each) | Window fills after a few pages; some models (Gemma) may not support tools at all | Works |
| P9 | JSON from small models: schema forces valid syntax, not correct content; long arrays and nested options drift | Missing fields, empty lists, ignored IDs; step retries twice then fails | Rare |
| P10 | The design prompt asks for many things at once (decisions, 3 diagrams, SSoT table, template, traceability, Mermaid theme line) | Small models skip parts (diagram, SSoT table). The cross check and design review catch it afterwards | Fine |
| P11 | Token estimate is a guess (3 characters per token) | Some calls refused that would fit | None |
| P12 | Update step expects a marker format; small models often ignore it | Handled by the earlier fix (tolerant parser plus one retry) | None |
| P13 | Step choice is per step but the app has no "can this model handle this step" hint | User finds out by failure | None |

## 3. Proposed direction (for decision, nothing built yet)

| Order | Change | Fixes | Applies to |
|---|---|---|---|
| 1 | One model profile per provider: `numCtx`, `maxOutput`, `timeout`, `think`, `tools` supported; read real limits from Ollama (`/api/show`) | P3, P4, P5, P7, P11, P13 | Local; cloud uses its own values |
| 2 | One budget helper used by every step: shortens or batches by the profile, never cuts the document being edited | P1, P2 | Local and cloud |
| 3 | Smaller context for updates: design + instruction + requirement titles + decisions, not the full PRD, matrix and payloads | Step 13, 9 to 12 | Local and cloud (faster, cheaper) |
| 4 | Batch size from the profile for steps 5, 6, 8 (smaller batches on local) | P2 | Local |
| 5 | Streaming for long answers, timeout counts idle time, not total time | P5, P6 | Local |
| 6 | Tool use only when the model supports it; otherwise fetch documentation pages first and paste the excerpt | P8 | Local |
| 7 | Split the design into passes on small models: sections first, then each diagram, then the SSoT table | P10 | Local |
| 8 | Optional: return only changed sections for updates, then merge | Step 13 answer size | Local and cloud |
| 9 | Step test on the AI models page: run one small real call per step type and show pass or fail | P9, P13 | Both |

## 4. Edits already in `server.py`, not tested

- `fit_ctx`: shortens background documents for Ollama in steps 9 to 13.
- Update note when the background was shortened.
- `trimmed` flag returned by steps 9 to 12 (the page does not show it yet).

Decision needed: keep, rework under item 1 and 2 above, or revert.
