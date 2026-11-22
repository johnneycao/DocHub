# DocHub

From Requirements to Architecture Design

Turns source PRDs into one consolidated PRD, then into requirements, a scenario matrix, a test plan, a payload library and an architecture design, and keeps them consistent. Proof of concept and proof of value; the starting point for building the tool. Details: [DESIGN.md](./DESIGN.md). Requirements: [PRD.md](./PRD.md).

> AI should NOT define the requirements. AI can NOT make the decisions. AI will NOT own the responsibility.

## Run

| Step | Do |
| --- | --- |
| Start | **Mac:** double-click `start.command`. **Windows:** double-click `start.bat`. Or run `python3 src/server.py` (Windows: `py -3 src\server.py`) and open http://127.0.0.1:8765 |
| First time | `start.command` asks for the Microsoft Foundry resource, key and Claude deployment, saves them in `.foundry.env` (owner-only), offers to install MarkItDown, checks that Claude answers |
| Restart | Close the old server window first. A server that is out of date answers "helper service is out of date" |
| Quick look | Open `src/web/index.html` as a file: designs stay in the browser; AI and conversion are off |

- **AI:** needs `server.py` and either the `claude` CLI on the PATH (built in) or an OpenAI-compatible provider added on the Designs page (see AI models). `.foundry.env`, when present, alone decides the Claude provider; other Anthropic or login variables in the shell are ignored. Optional: `CLAUDE_BIN`, `CLAUDE_MODEL`.
- **Conversion:** only for Word, PDF, PowerPoint, Excel and similar files; Markdown files are used as they are. Press **Install MarkItDown** on the Source files panel (installs into `.pydeps`, no admin rights, Python 3.10+), or `start.command` offers it. Alternative: `uv` with `config/markitdown.mcp.json`.
- **Security:** listens on 127.0.0.1, no sign-in, and only answers pages opened from this computer. Do not expose it. Keep `.foundry.env`, `providers.json` and `~/.cg-archiq/connection-secrets.json` (keys and tokens, owner-only) out of git (examples are in `config/`) and shared folders; `.gitignore` already excludes them and `designs/`.
- **Folders:** designs are saved under `designs/` (or `--data-dir` / `DESIGN_DATA_DIR`). The designs list shows the path. Opened as a file, designs live in that browser address only; use **Export all designs** and **Import designs** to move them.

## Using it on another computer (Mac or Windows)

Every teammate runs their own copy of the tool and opens the same project folder through OneDrive; the experience is the same on Mac and Windows.

1. **Install:** Python 3.10 or newer and Claude Code, and get the tool folder (git clone or a copy).
2. **Get the team folder into OneDrive:** accept the share and choose **Add shortcut to My files**, or sync the library (see Document Repo). Wait until OneDrive has downloaded it.
3. **Start the tool:** Mac `start.command` (first time: `chmod +x start.command`), Windows `start.bat`. Each person enters their own Foundry details once (saved in `.foundry.env` on their computer).
4. **Add the repo:** Designs page, **Document Repo** (above the design list), **Add a repo**: give it a name, **Choose folder...**, pick the team folder (the path differs per computer, for example `~/Library/CloudStorage/OneDrive-YourOrg/DocHub` on a Mac and `C:\Users\you\OneDrive - YourOrg\DocHub` on Windows), **Add repo**, then select it in the **Use** column and enter your name. The projects appear. You can keep several repos (this computer and different OneDrive folders) and use one at a time: selecting another refreshes the design list, the shared connections and the templates from that folder. Switching never copies or deletes projects; **Remove** only forgets a repo. The earlier single data folder becomes the first repo automatically.

| Shared through OneDrive (same for everyone) | Stays on each computer |
| --- | --- |
| Projects: `design.json`, sources, PRD, matrix, tests, payloads, design, versions, activity log, lock. **Configuration** in the `_config` folder inside the data folder: reference connections (`_config/connections.json`) and document templates (`_config/templates/`, with the default per type) | **Data location**, your name and the export folder path (`~/.cg-archiq/settings.json`, browser); **AI models**, keys and the model per step (`providers.json`, `.foundry.env`); connection tokens and approved local programs (`~/.cg-archiq/connection-secrets.json`); the tool folder; browser settings |

- **Same behaviour on both systems:** folder names are made safe for Windows and macOS, the folder dialog, Show folder and the saves use each system's own mechanism, and a save retries for a moment if OneDrive or a virus scanner holds the file.
- **Windows path length:** Windows limits a full path to 260 characters by default. Keep design names short and the data folder close to the top of OneDrive; the tool uses long-path calls when it needs to, but OneDrive and Explorer may still refuse very long paths.
- **OneDrive conflict copies:** if two computers save at the same moment, OneDrive keeps an extra file such as `design-DESKTOP-ABC123.json`. The tool shows a banner naming it; the tool uses `design.json`, so compare and delete the copy you do not need.

## Pages

| # | Page | What it does |
| --- | --- | --- |
| 1 | PRD library | Source files (Markdown used as is, others converted), **Generate PRD** (AI, with a template), editor, known issues from **Analyze with AI** with fix options, update with a prompt (AI), versions, **Download .md** and **Download .pdf** in the header |
| 2 | Requirements and BPMN | A view of the PRD, always in step: scope, a BPMN diagram per process, every requirement. "Edit in PRD" opens the editor at that section. No separate document |
| 3 | Scenario matrix | Import, generate from the PRD, edit, filter, AI fields from payloads, matrix review |
| 4 | Test plan | One test case per scenario, coverage, Playwright skeletons. Nothing is run |
| 5 | Payload library | Folder or zip of JSON, XML or CSV; data schema; payload list and detail; AI analysis |
| 6 | Architecture | references (connections, project documents), AI readiness check, solutions with pros and cons, design generation, update with a prompt |
| 7 | Build plan | Modules, dependencies, tasks, guardrails, agent files (AI) |

Pages 1 to 6 have a **Cross check** at the top. Pages 1, 3, 4, 5 and 6 have a **Reset** (always restorable from **Reset history**). The **Designs page** holds the global AI models and reference connections; the design bar has **History** and, for a plain local data folder, **Export folder**.

## PRD library (page 1)

- **Source files:** a `.md` file is read at once and shows **Ready: original Markdown** (no Convert button). Other types show Not converted until **Convert** or **Convert all** (MarkItDown). Originals stay read-only. A Markdown source edited in the folder is re-read by **Sync from folder**.
- **Generate PRD (AI):** the AI reads all ready source files, merges duplicates and writes one PRD in the chosen template (default: Standard Agile PRD Structure) or, with no template, in the structure it judges best for the content. It always calls out **Scope** (in and out), the **business processes** with a BPMN-style diagram each (swimlanes by role, business steps only, no technical implementation) and a table of **all requirements** with their sources; IDs from the sources are kept, anything it adds itself goes under Proposed requirements, and unknown values are TBD. After writing, the page checks the result (scope found, processes with diagrams, requirement IDs from the sources missing) and shows what to fix with the update prompt. Asks before replacing an existing PRD; every replace saves a version. Needs AI: when it cannot run, nothing changes.
- **Known issues and pending decisions:** empty until you press **Analyze with AI**. A new PRD (generate, import, paste, folder sync) clears the AI issues and the dismissed items. Results show the built-in checks and the AI findings together, grouped, with fix options (see Fixing AI issues).
- **Preview:** the document's YAML header (id, owner, version, sources) is shown as a collapsed **Document properties** table above the text; the Markdown view still shows it.
- **Update with a prompt (AI):** write the change in your words or use fix options; you see a diff; nothing changes until you accept.

## Document templates

- **Designs page, "Document templates":** the structure the AI follows when it writes a document. Preset: **Standard Agile PRD Structure** (default for the PRD). Add your own by pasting or uploading a Markdown file, choose a document type, and set a default per type. Saved as Markdown files in `_config/templates/` inside the data folder, so **the whole team shares the same templates** and defaults; the first time, the templates that ship with the tool are copied there.
- **Three templates:** PRD (**Generate PRD**), Architecture design (**Generate design**) and Payload summary report (**Generate report**). For the report the app first builds the facts, then the AI reshapes that draft into the template without dropping any item; without a template the standard layout is kept. Page 2 (Requirements and BPMN) is a view of the PRD and has no document or template of its own.
- **Per design:** the **Template** list next to each document's button uses the default, another template, or **AI decides** (the AI chooses the best-fitting structure from the content).

## Scenario matrix (page 3)

- **Columns:** ID, Channel, Name, Category, Type, Priority, Payload, then the AI fields **Scenario**, **Requirements**, **Expected outcome** (read only). Other columns from your file are kept, exported and hidden unless "Show source columns" is on.
- **Import:** Excel, CSV or pasted cells. Only a key column is needed: **Name** (a plain "Scenario" or "Description" column is read as the Name) or **Scenario ID**. Type defaults to Happy, a missing ID is numbered. Changing a column in "Matrix source and columns" re-reads the file at once; generated AI fields are kept by ID. "Undo import" and "Refresh from the linked workbook" are available.
- **Category and Type:** two levels. Category is the group (for example Return); Type is happy, edge, negative or gap. Filter by Category, Type, Channel and Priority.
- **Payload column:** one or more payload IDs (separated by comma, semicolon or new line). It may hold free text such as `UAT26401 Nov 5 / UAT25766`; `UAT-25283` matches `UAT25283`. A payload can serve several scenarios and the reverse.
- **AI fields:** Scenario and Expected outcome are generated from the linked payloads (page 5). A workbook that has its own Name column next to Scenario (an export from this tool) keeps its values.
- **Linking scenarios to requirements, two ways:**
  1. **Generated:** a matrix generated by the AI from the requirements already carries the requirement IDs, and keeps them when you export it, edit it and import it again.
  2. **AI match (imported or typed matrix):** "Link requirements with AI" fills the Requirements of scenarios that have none. Requirement IDs already written in a row's columns are adopted as they are; for the rest the AI matches the scenario (name, category, type, priority, channel, other columns and, if there is one, its linked payload) to the requirement list. Several IDs or none are allowed; IDs outside the PRD are dropped. A failed batch is retried one scenario at a time, and "Retry the failed scenarios" redoes only those. It also runs in step 5 of the payload analysis.
- **Generate from the PRD:** the AI first groups the requirements into high-level categories (its own list, usually 5 to 12; a category with fewer than two requirements is folded into the closest one and at most 12 are kept), then designs scenarios per category as journeys and variations, not one per requirement: one scenario lists every requirement ID its steps prove, and variations that follow different rules stay separate. **Every P0 and P1 scenario is generated, with no limit**; P2 and P3 are kept to a minimum (together at most a quarter of the requirements in a call; P2 before P3, success paths first) and there is at most one Gap scenario per call. Every ID is checked, and one pass covers requirements left without a scenario. A failed batch stops the run and nothing is saved.
- **Requirement traceability:** a table of every requirement with its scenarios and, when payloads exist, the payloads linked through those scenarios, marked Scenario and payload, Scenario only or No scenario.
- **Matrix review (AI):** matrix quality issues and suggested missing scenarios (P1 key, P2 edge), each with "Add to matrix".
- **Priority:** P0 to P3 or Not required (left out of coverage and checks). The **Priority rules** panel on the page, also given to the AI, defines them. **P0 Critical:** core end-to-end scenarios the business needs to operate; failure blocks release or go-live (order creation, payment, fulfillment, refund or return, critical integrations, core regional flows); regression on every build and deployment. **P1 High:** primary happy-path scenarios and commonly used variations; significant impact, may have a workaround (full or partial shipment, common payment methods, standard cancellation or exchange, major market variations); full regression or major release. **P2 Medium:** valid but less frequent scenarios, secondary variations, acceptable workarounds (less common payment or shipping combinations, uncommon regional variations, secondary paths); planned regression. **P3 Low, edge or future:** rare edge cases, complex combinations, capabilities not required today (return on exchange, exchange on exchange, future capabilities, unsupported combinations); as needed or a future release. Quick test, in order: can we still operate or release if it fails? No is P0; a normal, high-volume customer journey is P1; supported but less common or has a workaround is P2; an edge case, exceptional combination or future capability is P3.

## Payload library (page 5)

**Import.** A folder, a zip or single files: JSON, XML or CSV, mixed is fine (up to 5,000 files). XML and CSV are converted to the same structure as JSON. Each import works like extracting a zip into a folder: the same path is overwritten, a new path is added, nothing else changes. The **Imported payloads** table keeps the history (files in it, new, overwrote older, still from this import) and can remove one import.

**Structure.** Each top-level folder is one **payload** (for example `UAT24375`). Its primary file (for example `order.json`) is the primary payload. Sub-folders (`returns/`, `refunds/`, `transactions/`) hold the related payloads. Wrapper folders (`uat/`, the zip's own folder) and stray files next to the payload folders are ignored. IDs compare without case and hyphens.

**Page order.**
1. **Imported payloads:** counts, import history, Export zip, Add files, Remove.
2. **Data schema:** an ER diagram of the structure all payloads share. Shows the entities that matter most to the requirements and design, and always the root entity (Order) with its links. The table lists, per entity, what is common to all payloads, what differs (fields only some payloads have) and what is inconsistent (types, spellings), and which requirement IDs it impacts. Payload headers (folder or file named by the ID) are never entities. "Draw with AI" redraws it from the structure, the requirements and the design; "Show all entities" shows everything found.
3. **Payloads:** the list on the left reads like a per-SO evidence table: payload, scenario, matrix columns, files per related folder, and the key facts from the JSON. Facts that are the same everywhere or unique to each payload are left out; differences are highlighted. The panel on the right (same height) shows the same row, a summary of the JSON, the scenario and AI findings, then the source: the primary JSON and every related JSON as collapsible code blocks.
4. **Analyse payloads with AI** (one button, greyed out until payloads and a matrix exist). Six steps with progress:
   1. Link payloads to the scenario matrix by ID (also searches the scenario's name and other columns).
   2. Match the remaining payloads to scenarios with AI (High and Medium confidence only).
   3. Generate scenario, expected outcome and requirements for linked scenarios. If a batch fails (for example an invalid answer), its scenarios are retried one at a time; the ones that still fail are reported and the others are kept.
   4. Compare the matrix with the payloads (Critical and Important mismatches) and review the matrix.
   5. Link scenarios to requirements (as above) and map payloads with scenarios and the requirement list (which requirements have a payload).
   6. Write the summary report.
   A failed step shows **Retry this step and continue**; step 3 also shows **Retry the N failed scenarios and continue**, which redoes only those scenarios. Finished steps before it are kept; the steps after it run again.
5. **Below:** coverage (scenario, test case, payload), summary report, checks, folder inventory, missing evidence, call patterns and payment or reason values (only for request and response payloads).

**Summary report** (`summary-report.md`): a TL;DR, key mismatches, fields that differ, matrix issues, suggested scenarios and the key data model. No file names or ID lists.

**Reset** removes the payloads, their analysis and report, and what they added to the matrix (the Payload column returns to the source file's values; AI-generated fields are blanked).

## Architecture (page 6)

Payloads and the test plan are optional. Steps:
0. **Baseline draft (optional, first step; replaces the former "bring an existing design" import):** import or paste a hand-written architecture design (.md, or Word/PDF converted). It is read-only (View, Replace, Remove) and, like the PRD sources, never edited. The AI uses it as the base document in steps 1 to 3 together with the PRD, matrix, tests and payloads.
0. **References:** tick the documentation connections this design may use and add project documents (see below). The AI reads both in every step.
1. **Check readiness (AI):** compares the requirements, scenarios, test plan, payloads and the baseline draft (and the current design, once there is one). Not strict: it lists only **Conflicts**, **Missing** information and important **Confirm** points. Each has suggested changes (for a conflict: which side wins). Select one or several, or write your own, then press **Mark resolved**: it is saved as a decision together with the solution options below. **Dismiss** ignores an item. Every item must be resolved or dismissed before the design is generated. There is no **Add my fix** and nothing goes into the update prompt at this stage.
2. **Find solutions (AI):** each real design fork with every realistic choice (3 or more), pros, cons, a recommendation and why. When the draft already chose one of the solutions, that choice is selected automatically (badge "In your draft") and counts as decided; choose another option to change it. You choose one for each, or enter your own approach (name, pros, cons); **Add a decision manually** adds a decision of your own. Runs on its own or after the check, also when a design already exists; then add the chosen decisions to the update prompt.
3. **Generate architecture design (AI):** follows your choices; unresolved issues become open items. About 100 lines, ending with a **Sources** table of the documentation pages used; links to connected sites are checked and dead ones are marked "link not found".

**Design review (AI):** once a design exists, **Analyze with AI** above the update prompt reads the design against the PRD, the requirements and the solutions you chose, and lists only critical and important problems: a chosen option the design does not follow, a requirement or flow it does not cover, a missing key element, a logic problem, an unsupported statement. It is not strict: no issues is a normal result and says so. Each issue has fix options like the PRD's and feeds the update prompt. It is stale-marked when the design or your decisions change.

The design is editable Markdown (copy, paste, import, export, undo replace). **Update with a prompt (AI):** write the change in your words; you see a diff and notes; nothing changes until you accept.

**Reset** (click twice to confirm) removes the design, the readiness check, the solution options and your decisions, and the design review. The baseline draft, project documents and connections are kept; remove the draft with its own Remove button.

## Cross check

- Runs at any time and compares every page that has data (PRD issues, requirements, matrix, test plan, payloads, architecture, build plan). Pages without data are listed as not compared. It only reports.
- Findings have a severity (Critical = conflict, Important = changed or missing, Minor = unmatched or quality), sorted most severe first, with filters for severity, type and area and a Dismiss per finding. Findings with one cause are grouped into one entry (for example "5 items (R-01, R-02, R-03 and 2 more). Each has no scenario"); Minor findings are hidden until **Show minor**.
- The result is the same on every page and is marked out of date when data changes.
- Page 6 adds a verdict, "Ready to build the design?": Blocked (no PRD or requirements), Ready with risks, Ready.

## AI behaviour

- Real AI through `server.py` with the model chosen for each step (Claude CLI or an OpenAI-compatible model): PRD analysis, scenario generation, payload linking, fill, analysis and data model, readiness check, solutions, design, PRD and design updates, test refinement, build plan.
- Rule-based: PRD parsing and built-in issue checks, matrix checks, cross check, test plan creation (one test case per scenario).
- Severity: AI issues are only **Critical** or **Important**, focused on key missing information, logic problems, conflicts and open decisions; related points are grouped (PRD at most 12 issues, readiness at most 10).
- Style: prompts ask for short bullets and tables, one short sentence per field, no repeated lists of IDs or names.
- **AI runs only on a button press:** opening a page, a design or the folder sync never calls the AI. As a safeguard every AI call is refused unless a button was pressed in the last 30 minutes (each call of a running job renews this, and opening a design clears it); a refused call shows "Blocked: ... was started without a button press" and names the call.
- No fake output: when AI is unavailable the step shows the reason (not signed in, server out of date, too much data) and changes nothing.

## Interface

- Pages use the full width. Every section collapses (chevron, "Collapse all sections"), also on the Designs page; long tables scroll inside a fixed-height box with a sticky header ("Full height" where offered). Section titles are on the left, buttons on the right. Lists with a detail (test plan, payloads) show the list and the detail at the same height.
- **Find in text:** every Markdown editor (PRD, design), preview and long code block has a search box above it: type to highlight all matches (the current one in orange), in previews and in the Markdown editors alike, with a count such as "3 of 11", Enter or the arrows for next and previous (Shift+Enter for previous), Esc to clear.
- **Model in use:** every AI progress box shows which model runs the step ("Model: ..."), the design bar shows the model of the running or last AI call, and results state the model that produced them (PRD analysis, readiness check, generated PRD, scenario matrix, build plan). The model follows the choice in AI models (step, then default).
- Five accent colours and a night mode (top right).
- Diagrams are drawn by a built-in renderer (flowchart and graph with swimlanes, and ER diagrams as entity cards), no internet needed. Every other Mermaid type is drawn by the official Mermaid library (see below). **ER diagrams** show each entity as a card with PK, FK and UK badges, field types and short notes (full text on hover), crow's-foot line ends for one, many, optional and required, elbow lines with labels, dashed lines for non-identifying relations, and `+ N more fields` after 14 fields; the **Mermaid** button shows the official layout and **Refined** goes back. Lines are elbows with rounded corners, arranged to cross as little as possible; a crossing that cannot be avoided is drawn as a small bridge. The reader accepts the usual Mermaid forms (`subgraph Name`, `subgraph id["Title"]`, `direction`, `A & B --> C`, `-- text -->`, dotted and thick arrows, more box shapes) and ignores styling lines.
- **Other diagram types:** sequence, class, state, Gantt and every other Mermaid type except flowchart, graph and ER are drawn by the official Mermaid library only (no swimlane drawing, no Mermaid/Swimlane toggle). The library is loaded when such a diagram is shown, from `mermaid.min.js` next to `server.py` or, after you confirm once, from the CDN; if you decline, the diagram shows its source with a **Draw with Mermaid** button. The controls below still apply. A saved HTML export shows the source of these diagrams as code.
- **Diagram controls (like Obsidian):** drag to move; Ctrl or Cmd with the scroll wheel or a pinch to zoom; buttons for zoom out, 100%, zoom in, Fit, Full screen (Esc closes), Copy the Mermaid source, download SVG or PNG, and **Mermaid** (shows the same diagram with the official Mermaid layout for comparison; the button then becomes **Swimlane**). The Mermaid library is loaded only when you press it: from `mermaid.min.js` next to `server.py`. If it is not there, the first press asks to download it once (about 3 MB, by the helper from jsDelivr) and keeps it there, so it works offline afterwards; if the helper cannot download it, the browser tries the CDN directly. A failure is shown as a message above the diagram; keys + - 0 and F after clicking a diagram. Markdown previews draw only `mermaid`, `svg` and `html` blocks (cleaned by an allowlist); other fenced blocks show as code.

## Fixing AI issues

- On the PRD page and the Architecture page, each AI issue shows **Fix options**: two or three suggested fixes (the AI's recommendation first), "Record as an open item", and a box for your own fix.
- **Resolved in line:** when you accept an update, every issue whose fix was in the prompt and was applied is marked **Resolved** in its row (with the fix, kept in the list, dimmed, not counted), on the PRD page and in the design review. The AI reports each fix line as done or not done, and only the done ones are marked; if it does not say, use **Mark resolved** on the row (also **Reopen**). A new analysis starts a fresh list.
- Clicking a fix adds a bullet to the update prompt below; clicking it again removes it. Fix as many issues as you like, then press **Propose the update**, review the diff and accept.
- The matrix review and payload findings (pages 3 and 5) have their own actions; fix options there are in the backlog.
- Older results show one fix (the earlier suggestion) and "Record as an open item" until you run the AI analysis again.

## AI models

- **Designs page, "AI models":** the Claude CLI is built in. Add OpenAI, DeepSeek, NVIDIA NIM, AMD/vLLM, Azure OpenAI, GitHub Models or Ollama from a preset (base URL, model, key or key environment variable). **Test** runs one real call that writes a short paragraph and shows the time, the tokens in and out, and the **tokens per second** (counted from the provider's own usage figures; estimated from the text when a provider gives none, and then marked as estimated); **List models** reads the provider's model list; keys can be saved or read from an environment variable.
- **Local Ollama and cloud models:** an Ollama provider (address with port 11434) is called through Ollama's own API: the context window is sized for each call (8K to `numCtx`, default 32768, set per provider in `providers.json`), JSON answers follow the step's schema, the model stays loaded 30 minutes (`keepAlive`), and `"think": false` switches reasoning off for models that have it. A prompt larger than `numCtx` is refused with a clear message instead of being cut silently. Cloud providers keep the OpenAI-style call, switch between `max_tokens` and `max_completion_tokens` by themselves, and wait for `Retry-After`. For every provider an answer cut off at the output or context limit is reported and nothing is changed, and reasoning text (`<think>`) is removed from answers.
- **AI step matrix (Designs page, AI models):** for each AI step, the estimated input sent and output of one call, the context window of the model chosen for it, a Fit status (Fits, Tight, Shortened, Smaller batches, Too big) and a suggestion. Sizes come from the open design, or typical sizes when none is open. Set the window per provider ("Context window"). On a local model with a small window, the readiness check, find solutions, design, design review and update shorten the background documents by themselves, and the payload steps use smaller batches; the progress box says so while the call runs (no popup).
- **Stop:** every AI step shows a Stop button in its progress box and in the AI bar. Stop cancels the model call on the helper (a local model stops generating, the Claude CLI process is killed, a cloud request is closed) and puts the design back to how it was before the action began. One action is one button press, however many model calls it makes (for example scenario generation in batches, or "Analyse all payloads"). Nothing is asked first; the AI bar says "Stopped. Nothing was changed."
- **Which model runs what:** a default plus one model per step (PRD analysis, scenarios, payloads, readiness, solutions, design, updates, build plan, test refinement, connection test). The choice is global (Designs page, AI models). Each AI result records the model used.
- **Documentation connections** work with any model that supports tool calls; the helper runs the tool loop. Keys are saved in `providers.json` (owner-only) and are not sent to the browser. Keep it out of git and shared folders.
- **Copilot:** GitHub Models works as a provider (GitHub token). Microsoft 365 Copilot (Graph) needs sign-in and is in the backlog.

## References and connections

- **Reference connections (shared with the team):** Designs page, "Reference connections", stored in `_config/connections.json` inside the data folder so everyone gets the same list. Tokens are never stored there: they stay in `~/.cg-archiq/connection-secrets.json` on each computer, and a local program from the shared file runs only after each person presses **Approve**. Two kinds: a **documentation website** (any official docs address, preset: shopify.dev/docs; the AI reads and searches it with web fetch limited to that site) and an **MCP server** (HTTPS, for example Microsoft Learn `https://learn.microsoft.com/api/mcp`; or a local program set in `connections.json`, which is also where tokens go). Use **Try connection**, then **Add connection**; an optional documentation link is shown with each. **Test** checks the address or lists the server's tools; **Test with AI** makes a real AI call limited to that source and checks the link it cites.
- **Output:** generated documents end with a Sources table of links; links to connected sites are checked and dead ones are marked "link not found".
- **Per design:** Architecture page, "References for this design": tick the connections to use, add project documents (text, Word, PDF, Office, or paste). The AI uses both for readiness, Find solutions, design generation and updates, and cites sources.
- Needs Node (`npx`) for shopify.dev; connections are used live, so AI runs take longer.

## Document Repo (OneDrive)

The application and the project data are separate. Projects live in a **folder inside your OneDrive**; the tool reads and writes that folder, and OneDrive (signed in as you) shares it with your team. No Microsoft app registration and no cloud service are needed, and all settings stay on this computer (`~/.cg-archiq/settings.json`, outside the tool folder; `--data-dir` overrides it).

- **Set it up:** Designs page, **Document Repo** (it sits above the design list). Under **Add a repo** give the repo a name, press **Choose folder...** to pick the folder in your system's own folder dialog (it starts in your OneDrive; the OneDrive folders found on this computer are listed as shortcuts; use the dialog's New Folder button to create, for example, `DocHub`), and press **Add repo**. Select it in the **Use** column to work in it. Keep as many repos as you need (this computer, different OneDrive folders) and use one at a time; the design list below shows the projects of the repo in use. Switching never copies or deletes projects. Enter your name, and optionally the web address of the repo in OneDrive for an **Open in OneDrive** link; **Show the folder on this computer** opens it.
- **Open a design:** click its name in the design list.
- **Getting the team folder into OneDrive (your choice):** a folder you own, shared with the team in OneDrive; a folder someone shared with you, added with **Add shortcut to My files**; or a Teams or SharePoint library, added with **Sync**. Each teammate does this on their own computer and enters the folder here.
- **Capturing changes:**
  - **Version history:** OneDrive keeps every saved version of each file with who saved it (OneDrive on the web, right-click a file, Version history). It is the safety net and the audit trail.
  - **Changes by others:** the tool checks the folder every 30 seconds and shows a banner when someone else saved the project (**Load their version** or **Keep mine**) or edited a file (**Sync now**).
  - **Lock:** the first person to open a project locks it; others see who and since when and can open it read-only (nothing saved, AI off) or **Take over**. A lock expires after 2.5 minutes without a heartbeat. A save is also refused if the file changed after you opened it (revision check), with **Load their version** or **Overwrite with mine**. OneDrive may take seconds to share a lock, so it is a soft lock.
  - **Activity:** the **History** button lists the project's activity log (opens, saves, AI runs with the model) and offers Open in OneDrive and Show the project folder.
- **Versions you can compare:** the PRD and the architecture design keep labelled versions (generate, accepted update, import, restore, saved by hand) with **Compare with current** and **Restore**, also written as files in `02-consolidated-prd/versions/` and `07-architecture/versions/`. Keep both: the tool's versions are labelled and exact for comparing; OneDrive's version history records who and when for every file and is the recovery safety net (the tool cannot read it, and OneDrive may merge quick saves into one version).
- **Damaged project file:** if `design.json` has stray characters after the data (two overlapping saves), it is repaired on opening and the damaged copy is kept as `design.json.damaged-<time>`; a file that cannot be repaired is listed as **Cannot be read** with the reason, so it is never hidden. Restore an earlier version from OneDrive version history.

## Export folder (local folder only)

When the data folder is inside OneDrive these three buttons are hidden, because OneDrive already saves and shares the project: **Export folder**, **Save all to folder** and **Sync from folder**. Changes made by others still arrive through the change banner (**Sync now**), and opening a project still reads edits to its files. The buttons appear when the data folder is a plain local folder, so you can still hand a copy to a folder.

- **Export folder** button in the design bar: path of a folder (for example inside your OneDrive) that receives the project as Markdown for people who only read.
- **Save all to folder:** every page as Markdown (matrix also as workbook) plus `README.md` (files, sources, references, AI used, how generated).
- **Sync from folder:** reads back edited `prd.md`, `scenario-matrix.xlsx`, `architecture.md` and `09-references/*.md`.

## Designs folder

`<data folder>/<design name>/` (the system of record; default `designs/` next to the tool). **The folder is named after the design** and design names are unique (case does not matter): creating or renaming a design to a name that exists is refused. Characters that OneDrive or Windows do not allow are replaced (`/` and `:` become ` - `, others `-`), names are at most 80 characters, and the folder name is shown in the message when it differs from what you typed. Renaming the design in the design bar renames the folder; folders that still had a generated id (`dmw...`) are renamed to the design name the first time the tool starts, and a second design with the same name gets ` (2)`. Rename a project only when teammates have it closed, because their OneDrive will see a renamed folder:

| Folder | Content |
| --- | --- |
| `design.json` | Design state |
| `01-sources/` | Uploaded source files |
| `02-consolidated-prd/` | `prd.md`, `versions/` |
| `04-scenario-matrix/` | `scenario-matrix.xlsx`, `.json`, `imported/` |
| `05-test-plan/` | `test-plan.md`, `.csv`, `tests/*.spec.ts` |
| `06-payload-library/` | `imported/` (parsed payloads), `summary-report.md` |
| `07-architecture/` | `architecture.md` |
| `08-build-plan/` | `tasks.csv`, `guardrails.md`, `CLAUDE.md`, `AGENTS.md` |

- "Sync from folder" reads edits back (`prd.md`, `scenario-matrix.xlsx`, new sources and changed Markdown sources). Last save wins; there is no locking.
- Team sharing: use the OneDrive Document Repo above. Direct sign-in is not built.

## Templates

No sample data ships and there are no downloadable import templates. The AI writes the documents from your sources, using the three document templates on the Designs page (PRD, Architecture design, Payload summary report).

## Testing

`tests/e2e.py` (Playwright) opens every screen and runs the AI steps. Setup: `pip install playwright`, `python3 -m playwright install chromium`; start the server; `python3 tests/e2e.py` (`--skip-ai`, `--headed`). It has not been run yet and does not cover providers, connections, references, fix options, Markdown sources or the project folder. Logic and the server were checked with stand-ins (a fake OpenAI-compatible model, a fake MCP server, local folders); no browser run, real-provider run or real-data run has been done.

## Limits

- AI output is not yet verified on real documents; review it.
- Payload grouping can misread a batch of 3 or fewer payload folders next to a stray file.
- Field selection and highlighting are generic, not tied to one system. XML and CSV support is basic.
- Single user, no sign-in. Keys sit in owner-only files in plain text. Stand-ins, unbuilt features, model comparison and Microsoft 365 Copilot are in the backlog: DESIGN.md section 17.


**Certificate error (`CERTIFICATE_VERIFY_FAILED`) on macOS:** `server.py` now trusts the default roots plus the macOS keychains (system, admin, login), certifi, the system bundle files and `SSL_CERT_FILE`, so a company proxy's root certificate that is installed on the Mac is accepted (the same bundle is passed to the `claude` CLI through `NODE_EXTRA_CA_CERTS`). If it still happens, run `/Applications/Python*/Install Certificates.command` once, or set `SSL_CERT_FILE` to your company's CA bundle, then restart.

Python 3.13 and newer reject CA certificates whose Basic Constraints are not marked critical (`Basic Constraints of CA cert not marked critical`), which many company proxy roots are; the tool turns that strict check off for its own https calls only (the certificate chain and the host name are still verified).

**AI models bar:** inside a design, a bar above the seven steps shows the default model; **Change** opens the default and per-step model choices (saved on this computer only). Providers and keys are added on the Designs page.

**Long AI calls:** every AI call runs as a background job that the page polls every 2 seconds, so a slow local model (for example Gemma on Ollama) is not cut off by the browser's waiting limit. An unexpected error inside the helper is now shown in the page (and printed in the `server.py` window) instead of dropping the connection.

**Model choice layout:** the per-step models (AI models bar and Designs page) are grouped by the seven pages, in the order the steps appear on each page; steps that work on any page (updates, templates, connection test) come last.

**Reload-safe AI runs:** the model runs on the helper (`server.py`), not in the browser. The page remembers each job (in this browser, for 6 hours). If you reload or close the page, the job keeps running; after a reload the bar says which step is still running or finished, and pressing the same button again joins that job and shows its result without a new run or new tokens. Two identical requests that run at the same time (a double click, two tabs) share one job. The result is stored in the design only when the page receives it, so press the button again after a reload to pick it up. A restart of `server.py` ends its jobs.

**Options from the draft:** a choice that matches your baseline draft is chosen automatically and marked "In your draft". Once every option is decided and every readiness item is resolved or dismissed, the design can be generated. After the design exists, changing an option or adding a fix adds its line to the update prompt.

**Readiness check versus design review:** before the design exists, readiness items and solution options are decisions that feed the generation (button **Mark resolved**). After the design exists the same items show **Add my fix** instead of Mark resolved: change the selection and press it to add the fix to the update prompt and save it as the decision; picking a different solution option adds its line to the prompt too. **Analyze with AI** (design review) finds problems in the finished design and offers fixes for the prompt; it runs automatically after every generation or regeneration. **Check again** and **Find solutions again** also read the current design. **Design version history** (Compare with current, Restore, Save a version) sits at the bottom once a design exists; Reset clears it.

**Markdown views:** every Markdown page (PRD, architecture design, source files, baseline draft, summary report) has Markdown and Preview buttons, and Preview is the default. Choose Markdown to edit the PRD or the design text.

**Reset and Reset history:** a reset never deletes anything. Before it clears page 1, 3, 4, 5 or 6 (or **Clear generated pages**), the tool saves the page's content **and your decisions** (dismissed and resolved issues, readiness answers, chosen solution options, scenario edits) as a record. Uploaded originals (page 1 source files, page 5 payload files) are moved to `_reset-archive/` in the project folder, not deleted. Each page then shows a **Reset history** panel (Show / Hide) with when, what was held and **Restore**. Restore first saves the current content as a new record, so a restore can be undone the same way. Records are never removed. PRD and architecture also keep their text version history (Restore there as before).
