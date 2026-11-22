#!/usr/bin/env python3
"""Helper service for DocHub.

- Serves the site from src/web (index.html, css/, js/, assets/). Nothing outside src/web is ever served.
- Stores each design as a folder under the data folder (default ./designs, or --data-dir / DESIGN_DATA_DIR,
  for example a shared or synced folder). Layout per design:
    design.json                     design state (DELETE /api/designs/<id>/step/<folder> clears one step folder)
    01-sources/                     uploaded source files (read-only to the app)
    02-consolidated-prd/            prd.md and versions/
    03-requirements/                requirements.md, requirements.json
    04-scenario-matrix/             scenario-matrix.xlsx, scenario-matrix.json
    05-test-plan/                   test-plan.csv and tests/*.spec.ts
    06-payload-library/             P-xx.json
    07-architecture/                architecture.md
    08-build-plan/                  tasks.csv, guardrails.md, CLAUDE.md, AGENTS.md
  Files in these folders can be edited by other tools; the app reads them back with "Sync from folder".
- Serves uploaded source files read-only at /files/<id>/<name>.
- Converts source files to Markdown with MarkItDown. Preferred: the MCP server named "markitdown" in
  config/markitdown.mcp.json (for example `uvx markitdown-mcp`), called over stdio. Fallback: the Python package
  (pip install "markitdown[all]"). Other servers listed in the file are never started.

Run:  python3 src/server.py [--port 8765]
Open: http://127.0.0.1:8765
Listens on 127.0.0.1 only. No authentication: do not expose it to a network.
"""
import argparse
import os
import subprocess
import threading
import base64
import json
import mimetypes
import re
import shutil
import sys
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlparse


def setup_ca_certs():
    """Make https calls trust what this computer trusts. Python from python.org on macOS has no root certificates, and behind a company
    proxy that re-signs HTTPS traffic the proxy's own root (installed in the keychain or the Windows store) is what makes a site 'valid'.
    So the default roots are extended with the macOS keychains (system, admin and login), certifi, SSL_CERT_FILE, and the usual bundle files.
    The same file is given to the programs started from here (the claude CLI and MCP servers use Node: NODE_EXTRA_CA_CERTS)."""
    import ssl
    extra = []
    if os.environ.get("SSL_CERT_FILE"):
        extra.append(os.environ["SSL_CERT_FILE"])
    try:
        import certifi
        extra.append(certifi.where())
    except Exception:
        pass
    extra += ["/etc/ssl/cert.pem", "/private/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt"]
    parts = []
    if sys.platform == "darwin":
        for args in (["/System/Library/Keychains/SystemRootCertificates.keychain", "/Library/Keychains/System.keychain"], []):  # [] = the user's search list, which holds login-keychain roots
            try:
                out = subprocess.run(["security", "find-certificate", "-a", "-p"] + args, capture_output=True, text=True, timeout=30).stdout
                if "BEGIN CERTIFICATE" in out:
                    parts.append(out)
            except Exception:
                pass
    for c in extra:
        try:
            if c and os.path.isfile(c):
                parts.append(Path(c).read_text("utf-8", "ignore"))
        except Exception:
            pass
    pem = ""
    if parts:
        try:
            f = Path(tempfile.gettempdir()) / "dochub-ca.pem"
            f.write_text("\n".join(parts), "utf-8"); pem = str(f)
        except Exception:
            pem = ""
    def ctx():
        c = ssl.create_default_context()
        try:  # Python 3.13+ is strict about CA certificates; many company proxy roots lack the critical Basic Constraints flag
            c.verify_flags &= ~ssl.VERIFY_X509_STRICT
        except Exception:
            pass
        if pem:
            try:
                c.load_verify_locations(cafile=pem)
            except Exception:
                pass
        return c
    ssl._create_default_https_context = ctx
    if pem:
        os.environ["SSL_CERT_FILE"] = pem
        os.environ.setdefault("NODE_EXTRA_CA_CERTS", pem)
    return pem or "default"


APP = Path(__file__).resolve().parent  # src/
ROOT = APP.parent  # the project folder: runtime files (designs/, providers.json, .foundry.env, .pydeps/) live here, outside the code
WEB = APP / "web"
DATA = ROOT / "designs"
DATA_FROM_CLI = False
SRC = "01-sources"
STEP_DIRS = {SRC, "02-consolidated-prd", "03-requirements", "04-scenario-matrix", "05-test-plan", "06-payload-library", "07-architecture", "08-build-plan"}
STATIC = {".html", ".css", ".js", ".svg", ".ico", ".png", ".json"}
MAX_UPLOAD = 50 * 1024 * 1024
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
NAME_RE = re.compile(r"^[^/\\\x00]{1,200}$")

PYDEPS = ROOT / ".pydeps"  # MarkItDown is installed here by the page or start.command, so no system Python change is needed
if PYDEPS.is_dir() and str(PYDEPS) not in sys.path:
    sys.path.insert(0, str(PYDEPS))
_MD = None
_MD_ERROR = ""


def load_markitdown():
    global _MD, _MD_ERROR
    try:
        import importlib
        importlib.invalidate_caches()
        from markitdown import MarkItDown  # type: ignore
        _MD = MarkItDown()
        _MD_ERROR = ""
    except Exception as exc:  # not installed, or a missing optional dependency
        _MD = None
        _MD_ERROR = str(exc)
    return _MD is not None


def install_markitdown(timeout=900):
    """pip install MarkItDown with the Office and PDF readers into ./.pydeps, then load it. Returns (ok, log tail)."""
    if sys.version_info < (3, 10):
        return False, "MarkItDown needs Python 3.10 or newer; this is Python %d.%d." % sys.version_info[:2]
    PYDEPS.mkdir(exist_ok=True)
    cmd = [sys.executable, "-m", "pip", "install", "--upgrade", "--target", str(PYDEPS), "markitdown[docx,pdf,pptx,xlsx,xls]"]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return False, "The installation took longer than %d minutes." % (timeout // 60)
    except Exception as exc:
        return False, "pip could not be started: %s" % exc
    log = ((p.stdout or "") + (p.stderr or "")).strip()[-1200:]
    if p.returncode != 0:
        return False, log or "pip failed"
    if str(PYDEPS) not in sys.path:
        sys.path.insert(0, str(PYDEPS))
    return (True, log) if load_markitdown() else (False, "Installed, but it could not be loaded: %s" % _MD_ERROR)


load_markitdown()


MCP_CONFIG = ROOT / "config" / "markitdown.mcp.json"
try:
    VERSION = (ROOT / "VERSION").read_text("utf-8").strip() or "dev"
except Exception:
    VERSION = "dev"

# ---------- AI: the Claude CLI installed on this computer (claude -p). No API key is handled here. ----------
def _load_foundry_env():
    """Read .foundry.env (written by start.command) so the server works however it is started.
    Variables already set in the environment win. Returns the resource name when Foundry is configured."""
    f = ROOT / ".foundry.env"
    if not f.is_file():
        return None
    import shlex
    global FOUNDRY_VARS
    FOUNDRY_VARS = {}
    for line in f.read_text("utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        try:
            v = (shlex.split(v) or [""])[0]
        except ValueError:
            continue
        if k.strip() and v:
            FOUNDRY_VARS[k.strip()] = v
    if FOUNDRY_VARS.get("ANTHROPIC_FOUNDRY_RESOURCE") or FOUNDRY_VARS.get("ANTHROPIC_FOUNDRY_BASE_URL"):
        FOUNDRY_VARS["CLAUDE_CODE_USE_FOUNDRY"] = "1"
        m = FOUNDRY_VARS.get("ANTHROPIC_DEFAULT_SONNET_MODEL")
        if m:
            FOUNDRY_VARS.setdefault("ANTHROPIC_DEFAULT_OPUS_MODEL", m)
            FOUNDRY_VARS.setdefault("ANTHROPIC_DEFAULT_HAIKU_MODEL", m)
        return FOUNDRY_VARS.get("ANTHROPIC_FOUNDRY_RESOURCE") or FOUNDRY_VARS.get("ANTHROPIC_FOUNDRY_BASE_URL")
    return None


FOUNDRY_VARS = {}
# variables that would make the CLI use another provider or login; they are removed for every AI call
_OTHER_AUTH = ("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "ANTHROPIC_BASE_URL", "ANTHROPIC_MODEL")


def ai_env():
    """The one environment used by every AI feature. If .foundry.env exists it decides the provider."""
    env = dict(os.environ)
    if FOUNDRY_VARS:
        for k in _OTHER_AUTH:
            env.pop(k, None)
        env.update(FOUNDRY_VARS)
    return env


FOUNDRY = _load_foundry_env()
AI_BIN = os.environ.get("CLAUDE_BIN") or shutil.which("claude")
AI_MODEL = os.environ.get("CLAUDE_MODEL", "")  # empty = the CLI's own default model
AI_TIMEOUT = 600
PRD_MAX_CHARS = 400000

CONCISE = (
    " Style: short, clean and concise. Use bullets and tables, never long paragraphs. Every sentence field is one short sentence (at most 25 words). "
    "No filler and no repetition. Never repeat long lists of IDs or names: cite at most 3 and say how many more."
)
ARCH_CONCISE = (
    " Keep the document short, about 100 lines at most: each section is a table or at most 5 short bullets, and no paragraph is longer than 2 lines."
)


FOCUSRULE = ' FOCUS: report only what matters for the build, the tests or the design: key information that is missing, logic problems and conflicts, decisions that are really open. Skip anything a competent team would reasonably assume or settle in passing, anything that would not change what gets built or tested, and all wording, style and formatting points. Fewer, higher-value issues are better than a long list. GROUP: if several points share one cause, one theme or one fix (for example the same missing rule in many requirements, or the same unit or number stated inconsistently), report them as ONE issue, name the affected IDs in "where" (at most 3 and say how many more) and give one set of fixes that covers all of them. Never report the same point twice in different words. LIMIT: at most %d issues; if more qualify, keep the most important and fold the rest into a grouped issue.'

FIXRULE = ' For EVERY issue also give 2 or 3 "fixes": different, concrete ways to resolve it (for example choose a value, pick an owner, change the wording, add the missing rule, or record it as an open item for a named person), the most recommended first. Each fix has a short button label and a one-sentence instruction for the document editor that names the section or ID. Never write placeholders such as TBD or <value>; if the answer is not in the documents, offer the realistic alternatives from the documents or standard practice and say they need confirmation.'


ISSUE_TOOL = {
    "name": "report_issues",
    "description": "Report every issue found in the requirement document.",
    "input_schema": {"type": "object", "required": ["issues"], "properties": {"issues": {"type": "array", "items": {
        "type": "object", "required": ["severity", "type", "where", "text"], "properties": {
            "severity": {"type": "string", "enum": ["Critical", "Important"], "description": "Critical = would cause a wrong build, wrong test or a blocked design if left as is. Important = likely rework or a significant ambiguity. Do not report anything less."},
            "type": {"type": "string", "enum": ["Conflict", "Decision needed", "Gap", "Wording"],
                     "description": "Conflict = logic error or two parts disagree. Decision needed = TBD, open question or unconfirmed item. Gap = missing content. Wording = unclear, vague or untestable."},
            "where": {"type": "string", "description": "Section heading or requirement ID the issue is in."},
            "text": {"type": "string", "description": "One or two sentences: what is wrong and why it matters. Quote the document where useful."},
            "prompt": {"type": "string", "description": "Optional instruction to fix it, such as 'add decision: ...' or 'add open item: ...'."},
            "fixes": {"type": "array", "description": "Two or three ways to fix this issue, the most recommended first. The user clicks one, or writes their own.", "items": {"type": "object", "required": ["label", "prompt"], "properties": {
                "label": {"type": "string", "description": "The fix in at most 8 words, for a button."},
                "prompt": {"type": "string", "description": "The exact instruction for the document editor, one sentence, naming the section or ID, for example 'change R-05 to say ...', 'add decision: ...', 'add open item: ...'. Concrete values, no placeholders."}}}},
            }}}}},
}
SCENARIO_TOOL = {
    "name": "report_scenarios",
    "description": "Report the test scenarios for the requested requirements.",
    "input_schema": {"type": "object", "required": ["scenarios"], "properties": {"scenarios": {"type": "array", "items": {
        "type": "object", "required": ["title", "reqs", "kind", "prio", "expect"], "properties": {
            "title": {"type": "string", "description": "What is tested, as one short sentence."},
            "category": {"type": "string", "description": "A short higher-level group the scenario belongs to, such as a process or feature area from the document. The scenario type (happy, edge, negative, gap) is separate."},
            "ch": {"type": "string", "description": "Channel, system, module or area the scenario belongs to, or All. Use the document's own terms, never invent one."},
            "reqs": {"type": "array", "items": {"type": "string"}, "description": "Requirement IDs this scenario proves. Only IDs from the requested list."},
            "kind": {"type": "string", "enum": ["Happy", "Edge", "Negative", "Gap"], "description": "Gap = the document is silent or unclear, so the expected result needs a decision."},
            "prio": {"type": "string", "enum": ["P0", "P1", "P2", "P3"]},
            "expect": {"type": "string", "description": "The observable expected outcome, with the concrete values, states, amounts or messages from the document."}}}}}},
}


ASSESS_TOOL = {
    "name": "report_architecture_readiness",
    "description": "Report whether the documents are good enough to produce an architecture design.",
    "input_schema": {"type": "object", "required": ["verdict", "summary", "issues", "options"], "properties": {
        "verdict": {"type": "string", "enum": ["Ready", "Ready with open items", "Not ready"]},
        "summary": {"type": "string", "description": "Two or three sentences: can the design be produced now, and what weakens it."},
        "issues": {"type": "array", "items": {"type": "object", "required": ["severity", "type", "where", "text"], "properties": {
            "type": {"type": "string", "enum": ["Missing", "Confirm", "Conflict", "Risk"],
                     "description": "Missing = information the design needs that no document gives. Confirm = something stated or implied that a person must confirm before it is designed. Conflict = documents disagree. Risk = weakens the design but can be accepted."},
            "where": {"type": "string", "description": "Document and section, requirement ID, scenario ID or test ID."},
            "text": {"type": "string", "description": "What is missing or unclear and why the architecture needs it."},
            "severity": {"type": "string", "enum": ["Critical", "Important"], "description": "Critical = the design would be wrong or empty without it. Important = it weakens a significant part of the design. Do not report anything less."},
            "prompt": {"type": "string", "description": "Optional instruction to record the answer, for example 'add decision: ...' or 'add open item: ...'."},
            "fixes": {"type": "array", "description": "Two or three ways to fix this issue, the most recommended first. The user clicks one, or writes their own.", "items": {"type": "object", "required": ["label", "prompt"], "properties": {
                "label": {"type": "string", "description": "The fix in at most 8 words, for a button."},
                "prompt": {"type": "string", "description": "The exact instruction for the document editor, one sentence, naming the section or ID, for example 'change R-05 to say ...', 'add decision: ...', 'add open item: ...'. Concrete values, no placeholders."}}}},
            }}},
        "options": {"type": "array", "items": {"type": "object", "required": ["id", "topic", "question", "choices", "recommended", "reason"], "properties": {
            "id": {"type": "string", "description": "Short stable ID such as OPT-1."},
            "topic": {"type": "string"},
            "question": {"type": "string", "description": "The decision the user must make."},
            "context": {"type": "string", "description": "Why this is a real decision, citing the requirement or scenario IDs."},
            "recommended": {"type": "string", "description": "Exact name of the recommended choice, copied from the choices."},
            "reason": {"type": "string", "description": "Why it is recommended over the other choices, one or two sentences."},
            "baselineChoice": {"type": "string", "description": "Only when a baseline architecture draft is given and it clearly selects one of the choices: the exact name of that choice, copied from choices. Otherwise an empty string."},
            "baselineNote": {"type": "string", "description": "One short sentence saying where and how the baseline draft decides this (section or decision ID). Empty when baselineChoice is empty."},
            "choices": {"type": "array", "minItems": 3, "description": "Every realistic solution, normally 3 to 6; fewer than 3 only when no more exist.", "items": {"type": "object", "required": ["name", "summary", "pros", "cons"], "properties": {
                "name": {"type": "string"}, "summary": {"type": "string"},
                "pros": {"type": "array", "items": {"type": "string"}}, "cons": {"type": "array", "items": {"type": "string"}}}}}}}}}},
}
BASEDRAFT_RULE = (
    " The documents may include a 'Baseline architecture draft': an architecture design written manually by the architect, read only. Treat it as the base document and the starting intent, next to the PRD, scenarios, tests and payloads. "
    "Do not repeat what it already settles unless the PRD, a scenario or a payload contradicts it (report that as a Conflict). "
)
DESIGN_RULE = (
    " The documents may also include a 'Current architecture design': the final design document already generated. When it is given, also check against it: report where it conflicts with the other documents, or leaves something the design needs missing, and do not report what it already covers. "
)
BASEDRAFT_OPTIONS = (
    " When a baseline draft is given: for every option, if the draft already chooses one of the solutions, make sure that solution is among the choices (add it, with pros and cons, when you would not have listed it) and set baselineChoice to its exact name and baselineNote to where the draft decides it; the recommendation stays your own honest view. Leave baselineChoice empty when the draft does not decide it. "
)


REVIEW_ISSUES = ASSESS_TOOL["input_schema"]["properties"]["issues"]  # the design review keeps issues with severity and fixes
ASSESS_TOOL["input_schema"]["properties"]["issues"] = {"type": "array", "description": "Conflicts and missing information only. Empty when there are none.", "items": {"type": "object", "required": ["type", "where", "text", "fixes"], "properties": {
    "type": {"type": "string", "enum": ["Conflict", "Missing", "Confirm"],
             "description": "Conflict = two documents disagree and the user must say which one wins. Missing = information the design needs that no document gives. Confirm = an important assumption or TBD the user must confirm or correct."},
    "where": {"type": "string", "description": "The documents and IDs involved, for example 'PRD R-05 and scenario S-12'."},
    "text": {"type": "string", "description": "What conflicts or what is missing, in one short sentence."},
    "fixes": {"type": "array", "minItems": 2, "maxItems": 4, "description": "The ways to resolve it, the most recommended first. Conflict: one per side (which one wins). Missing or Confirm: the plausible answers. The user clicks one, or writes their own.", "items": {"type": "object", "required": ["label", "decision"], "properties": {
        "label": {"type": "string", "description": "The option in at most 8 words, for a button."},
        "decision": {"type": "string", "description": "One sentence stating the decision that is recorded if the user picks it, with concrete values, no placeholders."}}}}}}}
READY_RULE = (
    " READINESS CHECK RULES. This check is NOT a review and NOT strict. Look across ALL the documents given (PRD, requirements, scenario matrix, test cases, payload digest, baseline architecture draft, and the current design if there is one) and report ONLY: "
    "(1) Conflict: two documents disagree on something the design depends on; the options are the sides, so the user picks which one wins. "
    "(2) Missing: information the architecture really needs that no document gives; the options are the plausible answers. "
    "(3) Confirm: only an important TBD or assumption that would change the design. "
    "Every issue has 2 to 4 options; each is a DECISION that will be recorded together with the solution options and used to write the design. They are not edits to a document: never write editing instructions or prompts. "
    "Skip anything minor or that a competent team would settle while building. At most 8 issues; an empty list is fine. "
    "Answers the user already gave (section 'Answers and decisions given by the user') are final: do not raise them again. "
    "SSoT (single source of truth) IS NEVER MINOR: for each key data entity the processes use (for example order, customer, product, price, inventory, payment, return), the design must name ONE system that owns it. "
    "When the documents (PRD, baseline draft, current design, payload digest) do not say which system is the SSoT of an entity, are unsure about it (TBD, 'or', 'to confirm'), or give two owners, raise a Confirm issue (a Conflict when two documents name different owners). "
    "Put 'SSoT: <entity>' in 'where'. The text says what is unclear and which systems could own it. The options are the candidate systems taken from the documents (2 to 4), each worded as a decision like '<System> is the SSoT for <entity>, the others hold read-only copies'. "
    "Group entities with the same unclear owner into one issue. SSoT issues are kept even when the list is full, and are not raised for an entity whose owner is clearly stated or already answered. "
)


ASSESS_SYSTEM = (
    "You are a principal solution architect. You receive the project documents: the consolidated requirement document (PRD), the requirements, the scenario matrix, and, only if they exist, the test cases, a digest of the payload library (real request and response samples), a baseline architecture draft and the current design. "
    "Check whether they are consistent and complete enough to produce a high-level architecture design. Give a verdict (Ready, Ready with open items, Not ready) and a two or three sentence summary. "
    "Test cases, payloads and the baseline draft are optional. If they are absent, do NOT report that as an issue; mention only in the summary that the design has less evidence. "
    "Then list the key design options. A key option is a real fork in the architecture that the documents leave open or that has material trade-offs, for example synchronous versus asynchronous integration, where the logic lives, build versus buy, one pipeline versus one per channel, storage choice. "
    "For each option list EVERY realistic solution the documents and the platform allow, exhaustively: at least 3 choices whenever 3 exist, up to 6. The tool adds a separate manual choice for the user, so never add an 'other', 'custom' or 'your own' choice yourself, and do not stop at two because a manual choice exists (include a hybrid or phased approach and the do-nothing or status-quo choice when they are real alternatives), each with a short summary, concrete pros and concrete cons, a recommended choice and why. Only list decisions the documents support; do not invent technology that has nothing to do with the project. "
    "Never invent facts. Cite IDs from the documents. Do not repeat the same point twice."
    + READY_RULE + BASEDRAFT_RULE + BASEDRAFT_OPTIONS + DESIGN_RULE
    + CONCISE
)


ARCH_REVIEW_TOOL = {
    "name": "report_design_review",
    "description": "Report the critical and important issues found in the architecture design, if there are any.",
    "input_schema": {"type": "object", "required": ["summary", "issues"], "properties": {
        "summary": {"type": "string", "description": "One short sentence. When nothing critical or important was found, say so."},
        "issues": dict(REVIEW_ISSUES, description="Critical and important issues only. An empty list is normal and fine."),
    }},
}
ARCH_REVIEW_SYSTEM = (
    "You are a principal solution architect reviewing a finished architecture design. You get the project documents (the consolidated PRD, the requirements, the scenario matrix and any tests and payload digest), the design document, and the decisions the user selected for the key options. "
    "Check the design against them and report only what is a real CRITICAL or IMPORTANT problem: "
    "(1) the design contradicts a requirement, a scenario or a decision the user selected (a chosen option that the design does not follow or changes); "
    "(2) a requirement or a key flow of the PRD is not covered by the design, or a diagram and a table disagree; "
    "(3) a key architecture element the solution clearly needs is missing (for example a missing high-level architecture diagram, key-entity ER diagram, SSoT owner for an entity, or swimlane activity diagram for a process; ownership of data, error handling and recovery, security, volumes, an integration that a flow depends on); "
    "(4) a logic problem, for example an impossible sequence, a component with no owner, or a number that differs between sections; "
    "(5) a statement the documents do not support that the design presents as fact. "
    "BE LENIENT: do not be strict and do not look for faults to fill a list. Skip style, wording, formatting, level of detail, and anything a competent team would settle while building. If the design is sound, return an EMPTY issues list and say so in the summary: that is a good and normal result. "
    "Use only the documents given and never invent facts. Cite requirement, decision or section IDs in 'where'. Do not repeat a point; group related points into one issue."
    + FIXRULE
    + (FOCUSRULE % 10)
    + CONCISE
)

OPTIONS_TOOL = {
    "name": "report_solution_options",
    "description": "Report the key architecture options with pros and cons.",
    "input_schema": {"type": "object", "required": ["options"], "properties": {"options": ASSESS_TOOL["input_schema"]["properties"]["options"]}},
}
OPTIONS_SYSTEM = (
    "You are a principal solution architect. You receive the project documents: the consolidated requirement document (PRD), the requirements, the scenario matrix, and, only if they exist, the test cases, a digest of the payload library (real request and response samples) and the decisions already written in an existing design. "
    "Find the possible solutions for the architecture and compare them. List the key design options: each is a real fork in the architecture that the documents leave open or that has material trade-offs, for example synchronous versus asynchronous integration, where the logic lives, build versus buy, one pipeline versus one per channel, document model, storage or tax and payment handling. "
    "For each option list EVERY realistic solution the documents and the platform allow, exhaustively: at least 3 choices whenever 3 exist, up to 6. The tool adds a separate manual choice for the user, so never add an 'other', 'custom' or 'your own' choice yourself, and do not stop at two because a manual choice exists (include a hybrid or phased approach and the do-nothing or status-quo choice when they are real alternatives), each with a short summary, concrete pros and concrete cons grounded in the payloads, scenarios and requirements, a recommended choice and why. Cite requirement or scenario IDs in the context. "
    "Do not list a decision that the documents or the existing design already settle. Do not invent technology that has nothing to do with the project. Never invent facts. Do not repeat the same point twice. "
    "Give at most 8 options, the most important first."
    + BASEDRAFT_RULE + BASEDRAFT_OPTIONS + DESIGN_RULE
    + CONCISE
)


REFINE_TOOL = {
    "name": "report_refined_test",
    "description": "Report the test case after the requested change.",
    "input_schema": {"type": "object", "required": ["test", "notes"], "properties": {
        "test": {"type": "object", "required": ["title", "drives", "prio", "status", "steps", "expect", "notes", "reqs"], "properties": {
            "title": {"type": "string"}, "drives": {"type": "string", "enum": ["UI", "API"]},
            "prio": {"type": "string", "enum": ["P0", "P1", "P2", "P3", "Not required"]},
            "status": {"type": "string", "enum": ["Planned", "Draft", "Blocked", "Not required"]},
            "steps": {"type": "array", "items": {"type": "string"}}, "expect": {"type": "string"}, "notes": {"type": "string"},
            "reqs": {"type": "array", "items": {"type": "string"}, "description": "Requirement IDs, only from the list given."}}},
        "notes": {"type": "array", "items": {"type": "string"}, "description": "One short line per change made, or per problem."}}},
}
REFINE_SYSTEM = (
    "You are a senior test analyst editing one planned Playwright test case on the user's instruction. You get the test case, its scenario row, the requirements it is linked to and the list of valid requirement IDs. "
    "Apply exactly the change asked and nothing else: every field the instruction does not touch is returned exactly as given. Steps are short Arrange, Act, Assert lines. "
    "If the instruction is unclear or cannot be applied, return the test unchanged and explain why in the notes. Never invent requirement IDs, and never invent facts about the system."
    + CONCISE
)
BUILD_TOOL = {
    "name": "report_build_plan",
    "description": "Report the build plan: modules, their dependencies and one task per requirement.",
    "input_schema": {"type": "object", "required": ["modules", "tasks"], "properties": {
        "modules": {"type": "array", "items": {"type": "object", "required": ["name", "reqs", "dependsOn"], "properties": {
            "name": {"type": "string", "description": "Short module name from the project's own terms."},
            "reqs": {"type": "array", "items": {"type": "string"}, "description": "Requirement IDs built in this module. Every requirement is in exactly one module."},
            "dependsOn": {"type": "array", "items": {"type": "string"}, "description": "Names of modules that must be built first. No cycles."}}}},
        "tasks": {"type": "array", "items": {"type": "object", "required": ["req", "title", "hours"], "properties": {
            "req": {"type": "string", "description": "Requirement ID."},
            "title": {"type": "string", "description": "What to build, as one short imperative sentence."},
            "hours": {"type": "number", "description": "Estimate in hours for one developer, between 1 and 24."}}}}}},
}
BUILD_SYSTEM = (
    "You are a principal engineer planning the build of a system from its requirements. You get every requirement (ID and text) with the scenario IDs that verify it, and the project scope. "
    "Group ALL requirements into 3 to 10 cohesive modules by capability or process, never by requirement number. Put each requirement in exactly one module. "
    "Set dependsOn to the modules that must exist first (shared data and services come first); keep the graph acyclic and sparse. "
    "Give one task per requirement with a concrete title and a realistic estimate in hours. Requirements marked proposed are included but are not approved. Do not invent requirements."
    + CONCISE
)


# ---------- document templates: a global library, chosen per document type ----------
TPL_SEED = APP / "templates"  # the templates that ship with the tool; copied into the shared config folder the first time
TPL_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
TPL_TYPES = {"prd": "PRD", "architecture": "Architecture design", "payload-report": "Payload summary report"}
TPL_MAX = 200000


def tpl_index():
    ensure_config()
    try:
        d = json.loads((tpl_dir() / "index.json").read_text("utf-8"))
        if isinstance(d, dict):
            return {"templates": [t for t in d.get("templates", []) if isinstance(t, dict) and TPL_ID_RE.match(str(t.get("id", ""))) and t.get("type") in TPL_TYPES],
                    "defaults": {k: v for k, v in (d.get("defaults") or {}).items() if k in TPL_TYPES}}
    except Exception:
        pass
    return {"templates": [], "defaults": {}}


def tpl_save_index(d):
    tpl_dir().mkdir(parents=True, exist_ok=True)
    atomic_write(tpl_dir() / "index.json", json.dumps(d, indent=2))


def tpl_view():
    d = tpl_index()
    out = []
    for t in d["templates"]:
        f = tpl_dir() / (t["id"] + ".md")
        out.append({"id": t["id"], "name": str(t.get("name") or t["id"]), "type": t["type"], "builtin": bool(t.get("builtin")), "size": f.stat().st_size if f.is_file() else 0})
    d["defaults"] = {k: v for k, v in d["defaults"].items() if any(t["id"] == v for t in out)}
    return {"templates": out, "defaults": d["defaults"], "types": TPL_TYPES}


def tpl_read(tid):
    if not TPL_ID_RE.match(tid or ""):
        return None
    f = tpl_dir() / (tid + ".md")
    return f.read_text("utf-8") if f.is_file() else None


def tpl_put(tid, name, ttype, content):
    if not TPL_ID_RE.match(tid) or ttype not in TPL_TYPES or not str(content).strip() or len(content) > TPL_MAX:
        raise ValueError("A template needs a name, a type and text (up to 200,000 characters)")
    tpl_dir().mkdir(parents=True, exist_ok=True)
    atomic_write(tpl_dir() / (tid + ".md"), content)
    d = tpl_index()
    cur = next((t for t in d["templates"] if t["id"] == tid), None)
    if cur:
        cur.update({"name": name[:80], "type": ttype})
    else:
        d["templates"].append({"id": tid, "name": name[:80] or tid, "type": ttype})
    tpl_save_index(d)


def tpl_delete(tid):
    d = tpl_index()
    d["templates"] = [t for t in d["templates"] if t["id"] != tid]
    d["defaults"] = {k: v for k, v in d["defaults"].items() if v != tid}
    tpl_save_index(d)
    f = tpl_dir() / (tid + ".md")
    if TPL_ID_RE.match(tid) and f.is_file():
        f.unlink()


def tpl_block(tpl, kind):
    """The <document_template> block for a prompt, or '' when the user set none (the AI then decides from the content)."""
    if not isinstance(tpl, dict) or not str(tpl.get("content") or "").strip():
        return ""
    return "\n\n<document_template name=\"%s\">\n%s\n</document_template>" % (str(tpl.get("name") or "")[:80].replace('"', "'"), str(tpl["content"])[:60000])


MERMAID_RULES = (
    "Mermaid rules: use only 'flowchart LR' or 'flowchart TD' with nodes like id[\"label\"] (decisions id{\"label?\"}) and arrows -->, optional |label| on arrows, and subgraph blocks; or 'erDiagram'. "
    "No styling, no classDef, no click, no other diagram types. Put each diagram in a ```mermaid code block."
)
GEN_PRD_SYSTEM = (
    "You are a senior business analyst. From several source documents you write ONE consolidated Product Requirements Document (PRD) in Markdown. "
    "READ every source completely, then MERGE them: combine duplicates (the same requirement, rule, process or scope item worded differently) into one entry, keep every distinct requirement, rule, process, scope item, assumption and open question, and say which sources it came from. "
    "Never resolve a contradiction silently: record both versions with their source names as an open question. "
    "BUSINESS VIEW ONLY: scope, processes, rules and requirements describe business needs, actors, outcomes and rules. Do not describe technical implementation (systems design, products, protocols, APIs, tables, code) unless a source states it as a real constraint or interface need; then record it as a constraint or interface requirement, not as a design. "
    "THE PRD MUST CALL OUT, whatever the structure: "
    "(1) Document control as YAML front matter at the very top (id, title, owner, version, status, sources) with values from the sources, TBD when unknown. "
    "(2) SCOPE: a section whose heading contains the word Scope, with In scope and Out of scope as separate bulleted lists. "
    "(3) BUSINESS PROCESSES (BPMN view): a section whose heading contains the word Process, with one ### sub-heading per business process, a numbered list of business steps, and a BPMN-style Mermaid flowchart per process: flowchart LR, one subgraph per actor or role as a swimlane, a Start and an End node, decision diamonds with Yes and No labels, exception and rejection paths. "
    "(4) REQUIREMENTS: a section whose heading contains the word Requirements, starting with ONE table of ALL requirements with the columns ID, Requirement, Source (source file names), Priority (Must, Should, Could or TBD). Do not drop any requirement from the sources. If the template wants a detailed record per requirement, add it after the table. "
    "(5) Open questions, assumptions and risks, including every TBD item and every contradiction between sources. "
    "HEADINGS: one # heading for the document title only, then ## for every section and ### for sub-sections and for each process or requirement record; never use # for sections. Start the document with the YAML front matter, then the title. "
    "IDs: keep the IDs used in the sources exactly and never renumber or reuse one. A requirement without an ID gets the next free ID with the prefix the template or the sources use (REQ- when neither does). Requirements that you derive yourself because the sources imply them go in a separate 'Proposed requirements' section, marked as proposed, never mixed into the main list. "
    "Never invent facts, numbers, owners, dates or targets; write TBD. "
    "TEMPLATE: if a <document_template> is given, follow its sections, their order, field names and tables; leave out its guidance text (purpose lines, 'use' notes, writing rules, examples, footnotes); a section without source content keeps its heading and says Not applicable or TBD according to the template's own rules. "
    "If there is no template, choose the best fitting structure for this content, for example Purpose, Scope, Business processes, Requirements, Business rules, Proposed requirements, Open items. "
    + MERMAID_RULES + " Output the Markdown document only, with no preamble."
    + CONCISE
)
COMPOSE_SYSTEM = (
    "You are a senior business analyst. You receive a DRAFT document that already holds all the facts, and a <document_template>. Rewrite the draft into the template: use its sections, order, field names and tables. "
    "Keep every fact, ID, number, link and diagram from the draft; never invent content, never drop a requirement, finding or row. Code blocks (including mermaid) stay exactly as they are. "
    "Leave out the template's guidance text; a template section with no content in the draft keeps its heading and says Not applicable or TBD. Content of the draft that fits no template section goes under 'Additional information'. "
    "Output the Markdown document only, with no preamble."
    + CONCISE
)

ARCH_DIAGRAMS = (
    "REQUIRED DIAGRAMS AND SOURCE OF TRUTH. Whatever the structure or the template, the design always contains these three, each in the section where it fits best (the template's own section when it has one; add a sub-section when it has none): "
    "(A) HIGH-LEVEL ARCHITECTURE DIAGRAM, in the context, solution overview or component section: a default Mermaid 'flowchart LR' of the systems, components, channels and integrations, with a subgraph per layer or domain and a labelled arrow for each main interface (what flows, which direction). "
    "(B) ER DIAGRAM OF THE KEY DATA ENTITIES, in the data section: an 'erDiagram' with only the entities that matter, their PK and FK keys, their main fields and the relationships with cardinality, built from the documents and the payload digest (never invent fields). "
    "On the PK attribute of every entity put the system of record as the attribute comment, for example: string order_id PK \"SSoT: Shopify\". "
    "Directly after the diagram add the SSoT table with the columns: Entity, SSoT (the one system that owns creating and changing it), Systems holding copies (read-only), Sync direction and trigger, Notes. Every entity of the diagram has exactly one SSoT and one row. "
    "Use the owner named in the decisions, the user's answers or the baseline draft; when the documents do not say, propose one, mark it 'Proposed, to confirm' and list it under the open items. If two systems both appear to own an entity, record it as a conflict under the open items. "
    "(C) DETAILED ACTIVITY DIAGRAM PER PROCESS, in the process or key flows section: one ### sub-heading for EACH business process in the requirements (none skipped), a short numbered step list, then a 'flowchart LR' in swimlane form: one subgraph per actor, role or system, a Start and an End node, decision diamonds with Yes and No labels, and the exception and rejection paths. A step that reads or changes an entity names its SSoT system. "
    "LIGHT THEME: start every mermaid block with the line %%{init: {'theme':'default'}}%% (the light colour theme) and add no other styling. "
    "Add the diagrams to the traceability: the design table that lists components and decisions must match the diagrams. "
)
GEN_ARCH_SYSTEM = (
    "You are a principal solution architect writing the high-level architecture design document in Markdown. "
    "Use only the project documents given. The user's decisions on the key options are binding: design exactly the chosen option, and record it. The section 'Answers and decisions given by the user' in the documents is binding as well: record each answer under the decisions and design accordingly. If a 'Baseline architecture draft' is given, use it as the base: keep its structure, naming and content wherever the decisions, the PRD, the scenarios and the payloads do not contradict it, and improve it where they do. "
    "Items the user has not confirmed must not be presented as fact: put them under 'Open items and assumptions'. "
    "Structure: '# High-level architecture: <title>', then numbered sections: 1 Context and scope; 2 Decisions (table: ID, decision, chosen option, rationale, requirements); 3 High-level architecture (the diagram of required diagram A); 4 Data and interfaces (the ER diagram of required diagram B with the SSoT table, the interfaces between systems, and the payload evidence when a payload digest is given); 5 Key flows (the swimlane activity diagram per process, required diagram C); 6 Non-functional design (availability, performance, security, error handling and recovery, monitoring) based on the documents; 7 Requirement traceability (table: requirement ID, component or decision that satisfies it; mark any requirement the design does not cover); 8 Open items and assumptions; 9 Risks. "
    + ARCH_DIAGRAMS +
    "Mermaid rules: use only 'flowchart LR' or 'flowchart TD' with nodes like id[\"label\"] (decisions id{\"label?\"}) and arrows -->, optional |label| on arrows, and subgraph blocks; or 'erDiagram'. No styling, no classDef, no click, no other diagram types; the only extra line allowed is the %%{init: {'theme':'default'}}%% theme line. Put each diagram in a ```mermaid code block. "
    "Be specific to this project: use the system, channel and entity names from the documents. Keep it concise. Output the Markdown document only, with no preamble."
    + CONCISE + ARCH_CONCISE
)



UPDATE_SYSTEM = (
    "You are editing a project document written in Markdown, on the user's instruction. "
    "Rules: apply exactly the change requested and nothing else. Every line the instruction does not touch must stay exactly as it is: wording, order, tables, IDs, numbering and diagrams. "
    "When you add a requirement, decision, scenario or section, follow the document's own ID pattern and use the next free ID; never renumber or reuse IDs. Keep tables well-formed. "
    "When the instruction removes or changes something, also fix the places inside the same document that refer to it (for example a requirement cited in a process or a decision table), and say so in the notes. "
    "Do not invent facts the user did not give. If the instruction needs information you do not have, add it as a TBD or open item in the right section and say so in the notes. "
    "If the instruction is unclear, contradicts the document, or cannot be applied, return the document unchanged and explain why in the notes. "
    "When the instruction has several lines that start with '- ', write ONE note for each of them, in the same order, as the first notes: '- DONE: <what you changed>' if you applied it, or '- NOT DONE: <why>' if you did not or could not. Other notes follow after these. "
    "Output format, exactly: a line ===NOTES===, then one short line per change or problem starting with '- ', then a line ===DOCUMENT===, then the full updated document in Markdown with no code fence around it and nothing after it."
    + CONCISE
)

UPDATE_SYSTEM_PLAIN = (
    "You are editing a project document written in Markdown, on the user's instruction. Apply exactly the change requested and nothing else: every line the instruction does not touch stays exactly as it is (wording, order, tables, IDs, numbering, diagrams). "
    "Follow the document's own ID pattern and use the next free ID for anything new; also fix the places inside the document that refer to something you changed or removed. Do not invent facts: use TBD or an open item instead. "
    "OUTPUT: the COMPLETE updated document in Markdown, from its first line to its last, and nothing else: no notes, no explanation, no code fence around it, no markers."
    + CONCISE
)
# a marker line has ===, ** or __ around the word, so a heading such as "## Document" in the design is never mistaken for it
DOC_MARK = re.compile(r"^[ \t]*(?:={2,}|\*\*|__|#{1,3}[ \t]*={2,})[ \t]*DOCUMENT[ \t]*(?:={2,}|\*\*|__)?[ \t:]*$", re.I | re.M)
NOTE_MARK = re.compile(r"^[ \t]*(?:={2,}|\*\*|__|#{1,3}[ \t]*={2,})[ \t]*NOTES?[ \t]*(?:={2,}|\*\*|__)?[ \t:]*$", re.I | re.M)


def _unfence(body):
    body = body.strip("\n")
    m = re.match(r"^```(?:markdown|md)?\s*\n(.*)\n```\s*$", body.strip(), re.S)
    return m.group(1) if m else body


def parse_update_answer(out, original, plain=False):
    """(notes, document) from a model answer, or None. Accepts marker variants, and a bare document when it clearly is one."""
    out = (out or "").strip()
    if not out:
        return None
    m = DOC_MARK.search(out)
    if m:
        head, body = out[:m.start()], out[m.end():]
        notes = [re.sub(r"^[-*]\s*", "", l).strip() for l in NOTE_MARK.sub("", head).splitlines() if l.strip()]
        body = _unfence(body)
        return (notes, body) if body.strip() else None
    # no marker: accept it when it is a whole document (about as long as the original, starts like a document), never just notes
    body = _unfence(NOTE_MARK.sub("", out)) if not out.lstrip().startswith("- ") else ""
    first = body.lstrip().split("\n", 1)[0] if body.strip() else ""
    if body.strip() and len(body) >= 0.5 * len(original.strip()) and (first.startswith("#") or first.startswith("---") or first == original.lstrip().split("\n", 1)[0]):
        return (["The model did not report which changes it applied. Review the differences before accepting."], body)
    return None


UPDATE_KIND = {
    "prd": "The document is the consolidated requirement document (PRD). Keep requirement IDs stable. A requirement the user asks for is a normal requirement unless they say it is proposed.",
    "arch": "The document is the architecture design. Keep decision IDs stable. Mermaid diagrams may use only 'flowchart LR' or 'flowchart TD' with nodes like id[\"label\"], arrows -->, optional |label| and subgraph, or 'erDiagram', each starting with the line %%{init: {'theme':'default'}}%% (light theme) and no other styling. The design keeps its three required diagrams: the high-level architecture flowchart, the ER diagram of the key data entities with the SSoT table (one SSoT system per entity, also as the \"SSoT: <system>\" comment on the PK attribute), and a swimlane activity flowchart per business process. When a decision, component, entity owner or process changes, update the diagrams, the SSoT table and the traceability table to match. The project documents are given only as background: change the architecture document, never them.",
}


FILL_TOOL = {
    "name": "report_scenarios_from_payloads",
    "description": "Report the scenario description, expected outcome and requirement links proven by each scenario's payloads.",
    "input_schema": {"type": "object", "required": ["results"], "properties": {"results": {"type": "array", "items": {
        "type": "object", "required": ["id", "title", "expect", "reqs", "confidence", "evidence"], "properties": {
            "id": {"type": "string", "description": "Scenario ID exactly as given."},
            "title": {"type": "string", "description": "Scenario: one short sentence stating what is tested, using the real entities and values seen in the payloads. It must agree with the original name."},
            "expect": {"type": "string", "description": "Expected outcome: the observable result proven by the payload response, with concrete values (HTTP status, state, amounts, identifiers, error codes or messages)."},
            "reqs": {"type": "array", "items": {"type": "string"}, "description": "IDs of the requirements this scenario proves. Only IDs from the requirement list; an empty list if none fits."},
            "confidence": {"type": "string", "enum": ["High", "Medium", "Low"], "description": "High = the payload directly shows it. Medium = inferred. Low = weak or partial evidence."},
            "evidence": {"type": "string", "description": "Which payload file and which fields or values support this."},
            "note": {"type": "string", "description": "A conflict between the name, the payload or the requirements, or something a person must check. Empty if none."}}}}}},
}
FILL_SYSTEM = (
    "You are a senior test analyst. Each scenario has an original name from the source matrix, its channel and type, and the real payloads (request and response samples) that were matched to it. You also get the list of requirements. "
    "A payload can be a folder named by its payload ID: you then get its key fields ('payloadFolders') and the related entities inside it (returns, refunds, transactions, and so on); treat them together as the evidence. "
    "For every scenario write (1) the scenario description, (2) the expected outcome and (3) the requirements it proves. "
    "Rules: use only facts visible in the payloads or in the requirement list; never invent values or requirement IDs. The description must agree with the original name and the scenario type. "
    "The expected outcome states the observable result with the concrete values from the response (status, state, amounts, identifiers, error codes or messages). "
    "Link a requirement only when the scenario really exercises what the requirement says; several requirements are allowed, none is allowed. "
    "If the payload contradicts the name or the type, for example a happy path that ends in an error, describe what the payload shows and explain the conflict in 'note', with lower confidence. "
    "Return one result for every scenario given."
    + CONCISE
)



ANALYSIS_TOOL = {
    "name": "report_payload_analysis",
    "description": "Report where the payload evidence disagrees with the scenario matrix.",
    "input_schema": {"type": "object", "required": ["mismatches"], "properties": {"mismatches": {"type": "array", "items": {
        "type": "object", "required": ["scenario", "payload", "severity", "expected", "evidence"], "properties": {
            "scenario": {"type": "string", "description": "Scenario ID."},
            "payload": {"type": "string", "description": "Payload ID (folder) that shows it."},
            "severity": {"type": "string", "enum": ["Critical", "Important"], "description": "Critical = the scenario cannot be proven or the money or data outcome is the opposite. Important = a real difference to fix in the matrix or the payload."},
            "expected": {"type": "string", "description": "What the matrix row says should happen, in its own columns."},
            "evidence": {"type": "string", "description": "What the payload shows instead, with the concrete values."}}}}}},
}
ANALYSIS_SYSTEM = (
    "You are a senior test analyst. For each scenario you get the matrix row (name, category, type, priority and all its other columns, such as the expected payment or refund method, channel, entity and notes) and the key facts of the payload folders linked to it (key fields and related entities). "
    "Find where the payload evidence deviates from what the matrix row expects: the type of flow, payment or refund action, fees, channel, entity, tender or payment method, status or outcome. Only report real, specific deviations visible in the data, never guesses. "
    "Also report a scenario whose intent is not reproduced by its payload, or a payload that has no completed return or refund although the row says it is done. Report ONLY Critical and Important deviations and cite concrete values. Report nothing for scenarios that agree."
    + CONCISE
)

REVIEW_TOOL = {
    "name": "report_matrix_review",
    "description": "Review the scenario matrix against the requirements and the payload library.",
    "input_schema": {"type": "object", "required": ["matrixIssues", "missingScenarios"], "properties": {
        "matrixIssues": {"type": "array", "items": {"type": "object", "required": ["severity", "where", "text"], "properties": {
            "severity": {"type": "string", "enum": ["Critical", "Important"]},
            "where": {"type": "string", "description": "Scenario ID, column or payload ID."},
            "text": {"type": "string", "description": "A data-quality problem in the matrix itself: missing or free-text payload references, empty columns, values that are not from the reference lists, duplicate or shared payloads, mislabelled rows."}}}},
        "missingScenarios": {"type": "array", "items": {"type": "object", "required": ["priority", "title", "why"], "properties": {
            "priority": {"type": "string", "enum": ["P1", "P2"], "description": "P1 = a key scenario that should be added (a common flow, or it changes money, tax, tender or the documents created). P2 = an edge case."},
            "title": {"type": "string"},
            "why": {"type": "string", "description": "Why it is missing and which requirement or payload shows the behaviour."},
            "payloads": {"type": "array", "items": {"type": "string"}, "description": "Payload IDs that already show the behaviour, if any."}}}}}},
}
REVIEW_SYSTEM = (
    "You are a senior test analyst reviewing a scenario matrix. You get the requirements, every scenario row (all its columns), the coverage by category, type and priority, and a summary of the payload library. "
    "Report (1) matrix quality issues: rows with no payload reference or free text instead of IDs, payloads shared by several rows, columns empty for every row, values that look inconsistent across rows, rows whose label contradicts their own text. "
    "(2) Missing scenarios: combinations of category, type, channel, tender, flow or edge case that the requirements or the payloads show but no row covers. Do not repeat existing scenarios. "
    "Report only what the data supports, with concrete IDs and values. Report ONLY Critical and Important issues; at most 12 missing scenarios."
    + CONCISE
)



MATCH_TOOL = {
    "name": "report_payload_matches",
    "description": "Report which scenario each payload belongs to.",
    "input_schema": {"type": "object", "required": ["matches"], "properties": {"matches": {"type": "array", "items": {
        "type": "object", "required": ["payload", "scenario", "confidence", "reason"], "properties": {
            "payload": {"type": "string", "description": "Payload ID exactly as given."},
            "scenario": {"type": "string", "description": "Scenario ID exactly as given."},
            "confidence": {"type": "string", "enum": ["High", "Medium", "Low"], "description": "High = the payload clearly shows this scenario. Medium = fits, with some doubt. Low = a guess."},
            "reason": {"type": "string", "description": "The values in the payload and in the scenario row that match."}}}}}},
}
MATCH_SYSTEM = (
    "You are a senior test analyst. You get payloads (key fields and related entities of each payload folder) that no scenario names yet, and the scenario matrix rows (name, category, type, priority, channel and their other columns). "
    "Decide which scenario each payload was recorded for. Compare the channel, the flow (return, exchange, refund, collection), the tender or payment method, fees, tax, status and any identifier or text in the row that also appears in the payload. "
    "A payload can belong to several scenarios and a scenario can have several payloads. Give a match only when the data supports it; leave a payload out when nothing fits. Never invent IDs."
    + CONCISE
)



ER_TOOL = {
    "name": "report_data_model",
    "description": "Report the key data model as a Mermaid erDiagram.",
    "input_schema": {"type": "object", "required": ["mermaid"], "properties": {
        "mermaid": {"type": "string", "description": "Only the Mermaid source, starting with the line erDiagram. No code fence."}}},
}
ER_SYSTEM = (
    "You are a senior solution architect. The payloads (JSON, XML or CSV, already converted to one structure) show the real data of the solution. From the observed structure of the payload library (entities, their fields and types, how often they were seen, the entity folders, observed value lists and the relationships found), the requirements and the design, draw the KEY data model as a Mermaid erDiagram. "
    "Focus ONLY on the entities and fields that impact the requirements or the design: the root business document, its lines, the documents that settle or reverse it, the payments, fees, taxes and locations, and the links between them, and the fields that carry the rules, amounts, status, tender, reason or identifiers the requirements talk about. Leave out technical detail, wrappers and anything no requirement or design decision depends on. About 10 to 20 entities. "
    "Rules: entity names in UPPER_SNAKE_CASE and singular. Write the relationships first, one per line like `ORDER ||--o{ REFUND : \"has refunds\"`, using only the cardinalities ||--||, ||--o{, ||--|{, }o--||, }o--o|, |o--o{ and a short verb label in double quotes (add a short note such as (often null) where the data shows it). "
    "Then one block per entity: `ENTITY {` then lines `type name`, optionally followed by PK or FK and a short note in double quotes, then `}`. Types: string, int, boolean, money, array, date. At most 8 fields per entity: the keys, the fields that carry the business meaning, and the status or type fields. "
    "In the note of a status, type, kind, gateway or reason field list the observed values separated by ' | ' (at most 6). Where a field supports a requirement, end the note with its requirement ID such as R-04. Note fields that are always empty or often null when the data shows it. "
    "The payloads all have the same structure. Analyse the content across all payloads: what is common to every payload, what differs between payloads (optional fields, values that vary) and what is inconsistent (a field with different types or spellings). Show the common structure, and mark the differing or inconsistent fields in the notes. "
    "Never use a payload header as an entity, field or note: no payload folder name or payload ID (such as UAT24447 or a sales order number) and no file name. "
    "Use only entities and fields that exist in the data; never invent fields. Use only erDiagram syntax: no styling, no comments, no other diagram types."
)


REQ_TOOL = {
    "name": "report_requirement_links",
    "description": "Report which requirements each scenario exercises.",
    "input_schema": {"type": "object", "required": ["results"], "properties": {"results": {"type": "array", "items": {
        "type": "object", "required": ["id", "reqs", "confidence", "reason"], "properties": {
            "id": {"type": "string", "description": "Scenario ID exactly as given."},
            "reqs": {"type": "array", "items": {"type": "string"}, "description": "IDs of the requirements this scenario exercises. Only IDs from the requirement list; empty when none fits."},
            "confidence": {"type": "string", "enum": ["High", "Medium", "Low"]},
            "reason": {"type": "string", "description": "The words, values or payload facts that tie the scenario to the requirements."}}}}}},
}
REQ_SYSTEM = (
    "You are a senior test analyst. Link each scenario to the requirements it exercises. You get the requirement list (ID and text) and the scenarios: name, category, type, priority, channel, their other columns and, when there is one, the key facts of the linked payload (real data). "
    "A scenario exercises a requirement when the behaviour, rule, channel, flow or data it tests is what the requirement states. Use the scenario's own words and columns and the payload facts. Several requirements are allowed; none is allowed. "
    "Never invent IDs and never link on a single common word. Use High only when the scenario clearly tests the requirement, Medium when it fits with some doubt, Low for a guess. Return one result for every scenario given."
    + CONCISE
)
class AIError(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code, self.msg = code, msg


def ai_ready():
    return bool(AI_BIN)


def _extract_json(text):
    text = (text or "").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text)
    try:
        return json.loads(text)
    except Exception:
        pass
    i, j = text.find("{"), text.rfind("}")
    if i >= 0 and j > i:
        try:
            return json.loads(text[i:j + 1])
        except Exception:
            pass
    return None


SOURCES_RULE = (
    "\n\nDOCUMENTATION SOURCES: you may use the connected documentation tools and websites listed below to check platform behaviour, limits, API names and limits that the answer depends on, and you prefer what they return over memory. "
    "Cite what you used as a Markdown link to the exact page you read, for example [Page title](https://...). Never write a URL that you did not get from a tool result or read yourself, and never guess a page path. "
    "When you write a document, end it with a section 'Sources' that is a table of page title, link and what it supported. If nothing useful was found, say 'not confirmed in the documentation' instead of guessing."
)


_LAST = threading.local()


def _run_claude(prompt, conns=None):
    if not AI_BIN:
        raise AIError(503, "The local Claude CLI was not found. Install Claude Code so that `claude` is on the PATH (or set CLAUDE_BIN), then restart server.py.")
    servers = conn_mcp_config(conns) if conns else {}
    sites = conn_sites(conns) if conns else []
    cmd = [AI_BIN, "-p", "--output-format", "json", "--max-turns", "25" if (servers or sites) else "1"]
    if AI_MODEL:
        cmd += ["--model", AI_MODEL]
    try:
        with tempfile.TemporaryDirectory() as cwd:
            allow = []
            if servers:
                cfg = os.path.join(cwd, "mcp.json")
                with open(cfg, "w", encoding="utf-8") as fh:
                    json.dump({"mcpServers": servers}, fh)
                cmd += ["--mcp-config", cfg, "--strict-mcp-config"]
                allow += ["mcp__%s" % k for k in servers]
            if sites:
                allow += ["WebFetch(domain:%s)" % h for h in sorted({h for _, _, h in sites})] + ["WebSearch"]
            if allow:
                cmd += ["--allowedTools", ",".join(allow)]
                prompt += SOURCES_RULE
                if sites:
                    prompt += "\nOfficial documentation websites (read pages with WebFetch; find pages with WebSearch using 'site:<host> <query>'):\n" + "\n".join("- %s: %s (host %s)" % x for x in sites)  # empty folder so no project files or CLAUDE.md are picked up
            check_cancel()
            proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", cwd=cwd, env=ai_env(), start_new_session=(os.name != "nt"))

            def _kill(pr=proc):
                try:
                    if os.name != "nt":
                        import signal
                        os.killpg(os.getpgid(pr.pid), signal.SIGKILL)  # the CLI and anything it started
                    else:
                        pr.kill()
                except Exception:
                    try:
                        pr.kill()
                    except Exception:
                        pass
            job_closer(_kill)
            try:
                so, se = proc.communicate(prompt, timeout=AI_TIMEOUT)
            except subprocess.TimeoutExpired:
                _kill()
                proc.communicate()
                raise
            p = subprocess.CompletedProcess(cmd, proc.returncode, so, se)
            check_cancel()
    except AIError:
        raise
    except subprocess.TimeoutExpired:
        raise AIError(504, "The AI model took too long (over %d s). Try again or use a smaller document." % AI_TIMEOUT)
    except Exception as exc:
        raise AIError(502, "The AI model could not be started: %s" % exc)
    out = None
    try:
        out = json.loads(p.stdout)
    except Exception:
        pass
    if p.returncode != 0 or not isinstance(out, dict) or out.get("is_error"):
        detail = (out.get("result") if isinstance(out, dict) else "") or p.stderr.strip() or p.stdout.strip()
        msg = str(detail)[:400]
        if re.search(r"not logged in|/login|authenticat|unauthori[sz]ed|invalid api key", msg, re.I):
            raise AIError(401, "The Claude CLI on this computer is not signed in. Open Terminal, run `claude`, type /login and sign in, then try again. (Details: %s)" % msg)
        raise AIError(502, "The AI model failed: %s" % msg)
    _LAST.meta = {"usage": out.get("usage") or {}, "turns": out.get("num_turns"), "denied": [d.get("tool_name") for d in (out.get("permission_denials") or []) if isinstance(d, dict)],
                  "webFetch": ((out.get("usage") or {}).get("server_tool_use") or {}).get("web_fetch_requests"), "webSearch": ((out.get("usage") or {}).get("server_tool_use") or {}).get("web_search_requests")}
    return out.get("result") or ""


# ---------- AI providers: Claude CLI (built in) and any OpenAI-compatible endpoint (OpenAI, DeepSeek, NVIDIA NIM, AMD/vLLM, Azure OpenAI, GitHub Models, Ollama) ----------
PROV_FILE = ROOT / "providers.json"
STEPS = {
    "analyze-prd": "PRD analysis", "gen-scenarios": "Scenario generation", "scenario-plan": "Scenario categories and channels", "fill-scenarios": "Scenario fill from payloads", "analyze-payloads": "Payload analysis",
    "refine-test": "Test refinement", "build-plan": "Build plan", "arch-assess": "Readiness check", "arch-options": "Find solutions", "gen-arch": "Architecture design",
    "update-doc": "Update with a prompt", "arch-review": "Design review", "ask": "Connection test with AI", "gen-prd": "Generate PRD", "compose-doc": "Apply a template to a document",
}
PRESETS = [
    {"preset": "openai", "name": "OpenAI", "baseUrl": "https://api.openai.com/v1", "model": "gpt-4.1", "tools": True, "json": True, "tokenParam": "max_completion_tokens", "authHeader": "Authorization"},
    {"preset": "deepseek", "name": "DeepSeek", "baseUrl": "https://api.deepseek.com", "model": "deepseek-chat", "tools": True, "json": True, "tokenParam": "max_tokens", "authHeader": "Authorization"},
    {"preset": "nvidia", "name": "NVIDIA NIM", "baseUrl": "https://integrate.api.nvidia.com/v1", "model": "meta/llama-3.3-70b-instruct", "tools": True, "json": False, "tokenParam": "max_tokens", "authHeader": "Authorization"},
    {"preset": "azure", "name": "Azure OpenAI", "baseUrl": "https://YOUR-RESOURCE.openai.azure.com/openai/v1", "model": "YOUR-DEPLOYMENT", "tools": True, "json": True, "tokenParam": "max_completion_tokens", "authHeader": "api-key"},
    {"preset": "github-models", "name": "GitHub Models", "baseUrl": "https://models.github.ai/inference", "model": "openai/gpt-4.1", "tools": True, "json": True, "tokenParam": "max_tokens", "authHeader": "Authorization"},
    {"preset": "ollama", "name": "Ollama (local)", "baseUrl": "http://127.0.0.1:11434/v1", "model": "llama3.1", "tools": True, "json": True, "tokenParam": "max_tokens", "authHeader": "Authorization"},
    {"preset": "vllm", "name": "AMD / vLLM server", "baseUrl": "http://YOUR-HOST:8000/v1", "model": "YOUR-MODEL", "tools": True, "json": False, "tokenParam": "max_tokens", "authHeader": "Authorization"},
]
CLAUDE_PROVIDER = {"id": "claude-cli", "name": "Claude CLI", "kind": "claude-cli"}
_CTX = threading.local()


def _prov_file():
    try:
        d = json.loads(PROV_FILE.read_text("utf-8"))
        if isinstance(d, dict):
            return d
    except Exception:
        pass
    return {"providers": [], "steps": {}}


def load_providers():
    d = _prov_file()
    provs = [p for p in d.get("providers", []) if isinstance(p, dict) and CONN_ID_RE.match(str(p.get("id", ""))) and p.get("kind") == "openai"]
    return provs, {k: v for k, v in (d.get("steps") or {}).items() if k == "*" or k in STEPS}


def prov_public(p):
    return {"id": p["id"], "name": str(p.get("name") or p["id"]), "kind": p.get("kind", "openai"), "baseUrl": str(p.get("baseUrl", "")), "model": str(p.get("model", "")),
            "tools": bool(p.get("tools")), "json": bool(p.get("json")), "maxTokens": p.get("maxTokens") or 0, "tokenParam": p.get("tokenParam") or "max_tokens",
            "authHeader": p.get("authHeader") or "Authorization", "apiKeyEnv": str(p.get("apiKeyEnv") or ""), "hasKey": bool(p.get("apiKey") or (p.get("apiKeyEnv") and os.environ.get(p.get("apiKeyEnv", "")))),
            "temperature": p.get("temperature"), "numCtx": p.get("numCtx") or 0, "local": is_ollama(p), "window": prov_window(p)}


def prov_window(p):
    """Context window in tokens: what the user set, else 32K for Ollama (its safe default here), else 128K for a cloud model, 200K for the Claude CLI."""
    try:
        n = int(p.get("numCtx") or 0)
    except Exception:
        n = 0
    if n >= 2048:
        return n
    if p.get("kind") == "claude-cli":
        return 200000
    return 32768 if is_ollama(p) else 128000


def claude_model_name():
    return AI_MODEL or (FOUNDRY_VARS or {}).get("ANTHROPIC_DEFAULT_SONNET_MODEL") or "Claude CLI default"


def providers_view():
    provs, steps = load_providers()
    claude = dict(CLAUDE_PROVIDER, model=claude_model_name(), baseUrl=("Microsoft Foundry: " + FOUNDRY) if FOUNDRY else "Claude CLI login", hasKey=True, tools=True, json=True, available=ai_ready(), builtin=True, local=False, window=200000, numCtx=0)
    return {"providers": [claude] + [prov_public(p) for p in provs], "steps": steps, "stepLabels": STEPS, "presets": PRESETS, "file": PROV_FILE.name}


def save_providers(doc):
    old = {p["id"]: p for p in load_providers()[0]}
    out, seen = [], set()
    for p in doc.get("providers") or []:
        if not isinstance(p, dict) or not CONN_ID_RE.match(str(p.get("id", ""))) or p["id"] in seen or p["id"] == "claude-cli":
            continue
        base = str(p.get("baseUrl") or "").strip().rstrip("/")
        if not re.match(r"^https?://[^\s/]+", base):
            continue
        seen.add(p["id"])
        cur = dict(old.get(p["id"]) or {})
        cur.update({"id": p["id"], "kind": "openai", "name": str(p.get("name") or p["id"])[:60], "baseUrl": base, "model": str(p.get("model") or "").strip()[:120],
                    "tools": bool(p.get("tools")), "json": bool(p.get("json")), "apiKeyEnv": re.sub(r"[^A-Za-z0-9_]", "", str(p.get("apiKeyEnv") or ""))[:60],
                    "tokenParam": "max_completion_tokens" if p.get("tokenParam") == "max_completion_tokens" else "max_tokens",
                    "authHeader": "api-key" if p.get("authHeader") == "api-key" else "Authorization"})
        try:
            mt = int(p.get("maxTokens") or 0)
            cur["maxTokens"] = mt if 256 <= mt <= 200000 else 0
        except Exception:
            cur["maxTokens"] = 0
        try:
            nc = int(p.get("numCtx") or 0)
            if 2048 <= nc <= 4000000:
                cur["numCtx"] = nc
            else:
                cur.pop("numCtx", None)
        except Exception:
            cur.pop("numCtx", None)
        try:
            cur["temperature"] = float(p["temperature"]) if p.get("temperature") not in (None, "") else None
        except Exception:
            cur["temperature"] = None
        key = str(p.get("apiKey") or "")
        if p.get("clearKey"):
            cur.pop("apiKey", None)
        elif key.strip():
            cur["apiKey"] = key.strip()
        out.append(cur)
    steps = {k: v for k, v in (doc.get("steps") or {}).items() if (k == "*" or k in STEPS) and (v == "claude-cli" or v in seen)}
    fd = os.open(str(PROV_FILE), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump({"providers": out, "steps": steps}, fh, indent=2)
    try:
        os.chmod(str(PROV_FILE), 0o600)
    except Exception:
        pass


def any_provider_ready():
    return ai_ready() or any(prov_public(p)["hasKey"] or p["baseUrl"].startswith("http://") for p in load_providers()[0])


def resolve_provider():
    provs, steps = load_providers()
    byid = {p["id"]: p for p in provs}
    pid = getattr(_CTX, "provider", "") or steps.get(getattr(_CTX, "step", "")) or steps.get("*") or "claude-cli"
    if pid != "claude-cli" and pid not in byid:
        pid = steps.get("*") if steps.get("*") in byid else "claude-cli"
    return CLAUDE_PROVIDER if pid == "claude-cli" else byid[pid]


def model_label():
    return getattr(_LAST, "label", "") or (AI_MODEL or "default")


# ---- OpenAI-compatible chat completions ----
def _prov_key(p):
    return p.get("apiKey") or (os.environ.get(p.get("apiKeyEnv", "")) if p.get("apiKeyEnv") else "") or ""


def strip_think(text):
    """Reasoning models (DeepSeek-R1, Qwen3, Gemma thinking builds) may put their reasoning in the answer: remove it."""
    t = re.sub(r"<think>.*?</think>", "", text or "", flags=re.S | re.I)
    t = re.sub(r"<think>.*\Z", "", t, flags=re.S | re.I)  # a reasoning block that never closed (the answer was cut off)
    return t.strip() if t != (text or "") else (text or "")


def is_ollama(p):
    return bool(re.search(r":11434(/|$)", str(p.get("baseUrl", "")))) or "ollama" in str(p.get("name", "")).lower() or p.get("ollama") is True


def _ctx_bucket(est_in, ceiling):
    """Context window for one local call: the prompt plus room for the answer, in a few fixed sizes so Ollama does not reload the model for every call."""
    need = int(est_in * 1.5) + 2048
    for size in (8192, 16384, 32768, 65536, 131072, 262144):
        if size >= need or size >= ceiling:
            return min(size, ceiling)
    return ceiling


def ollama_chat(p, messages, tools=None, json_mode=False, schema=None):
    """Ollama's own /api/chat. The OpenAI-style /v1 endpoint cannot set the context size, so Ollama silently cuts a long prompt (the instructions are the first part lost) at its default context.
    Here the context is sized for each call, the answer can be forced to follow the JSON schema, and the model stays loaded between steps. Returns (message, usage) in the OpenAI shape, or None when the server has no /api/chat."""
    import urllib.request, urllib.error, time
    root = re.sub(r"/v1$", "", p["baseUrl"].rstrip("/"))
    chars = sum(len(str(m.get("content") or "")) for m in messages) + (len(json.dumps(tools)) if tools else 0) + (len(json.dumps(schema)) if schema else 0)
    est_in = chars // 3  # about 3 characters per token for Markdown, tables and JSON: on the safe side
    try:
        ceiling = max(4096, int(p.get("numCtx") or 32768))
    except Exception:
        ceiling = 32768
    if est_in > ceiling * 0.9:
        raise AIError(413, "The documents (about %d tokens) do not fit the context window set for '%s' (%d tokens). Raise \"numCtx\" for this provider in providers.json (and check that the model supports it and the memory allows it), choose a model with a longer context, or send fewer documents." % (est_in, p.get("name"), ceiling))
    num_ctx = _ctx_bucket(est_in, ceiling)
    names = {}
    msgs = []
    for m in messages:
        m = dict(m)
        if m.get("role") == "assistant" and m.get("tool_calls"):
            calls = []
            for c in m["tool_calls"]:
                fn = c.get("function") or {}
                names[c.get("id")] = fn.get("name")
                try:
                    args = json.loads(fn.get("arguments") or "{}") if isinstance(fn.get("arguments"), str) else (fn.get("arguments") or {})
                except ValueError:
                    args = {}
                calls.append({"function": {"name": fn.get("name"), "arguments": args}})
            m["tool_calls"] = calls
        if m.get("role") == "tool":
            m = {"role": "tool", "tool_name": names.get(m.get("tool_call_id")) or "", "content": m.get("content") or ""}
        msgs.append(m)
    opts = {"num_ctx": num_ctx}
    if p.get("maxTokens"):
        opts["num_predict"] = int(p["maxTokens"])
    if p.get("temperature") is not None:
        opts["temperature"] = p["temperature"]
    elif json_mode:
        opts["temperature"] = 0.2  # steadier structure for JSON answers on small models
    body = {"model": p["model"], "messages": msgs, "stream": False, "options": opts, "keep_alive": str(p.get("keepAlive") or "30m")}
    if p.get("think") is not None:
        body["think"] = bool(p["think"])
    if tools:
        body["tools"] = tools
    elif json_mode:
        body["format"] = schema if isinstance(schema, dict) else "json"
    hdr = {"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "dochub/1.0"}
    key = _prov_key(p)
    if key:
        hdr["Authorization"] = "Bearer " + key
    last = None
    for attempt, wait in enumerate((0, 3, 8)):
        check_cancel()
        if wait:
            time.sleep(wait)
        try:
            req = urllib.request.Request(root + "/api/chat", data=json.dumps(body).encode(), headers=hdr, method="POST")
            with job_open(req, AI_TIMEOUT) as r:
                data = json.loads(r.read().decode("utf-8", "replace"))
            check_cancel()
            msg = data.get("message") or {}
            calls = [{"id": "call_%d" % i, "type": "function", "function": {"name": (c.get("function") or {}).get("name"), "arguments": json.dumps((c.get("function") or {}).get("arguments") or {})}} for i, c in enumerate(msg.get("tool_calls") or [])]
            out = {"content": msg.get("content") or "", "_finish": "length" if data.get("done_reason") == "length" else "stop"}
            if calls:
                out["tool_calls"] = calls
            usage = {"prompt_tokens": data.get("prompt_eval_count"), "completion_tokens": data.get("eval_count"), "num_ctx": num_ctx}
            if data.get("prompt_eval_count") and data["prompt_eval_count"] >= num_ctx - 8:
                out["_finish"] = "length"  # the prompt filled the whole window: nothing was left for the answer
            return out, usage
        except AIError:
            raise
        except urllib.error.HTTPError as exc:
            if job_cancelled():
                raise AIError(499, STOPPED)
            detail = exc.read().decode("utf-8", "replace")[:400]
            if exc.code == 404 and "model" not in detail.lower():
                return None  # not an Ollama server: use the OpenAI-style endpoint
            if exc.code == 404:
                raise AIError(502, "Ollama does not have the model '%s'. Run: ollama pull %s" % (p["model"], p["model"]))
            if "format" in body and isinstance(body["format"], dict) and exc.code in (400, 500):
                body["format"] = "json"  # the schema was not accepted: plain JSON mode
                continue
            if "think" in body and exc.code == 400 and "think" in detail.lower():
                body.pop("think")  # this model has no thinking switch
                continue
            if exc.code in (429, 500, 502, 503, 504) and attempt < 2:
                last = "HTTP %d" % exc.code
                continue
            raise AIError(502, "Ollama answered HTTP %d: %s" % (exc.code, detail))
        except Exception as exc:
            if job_cancelled():
                raise AIError(499, STOPPED)
            last = str(exc)
            if attempt < 2 and not isinstance(exc, ValueError):
                continue
            raise AIError(502, "Ollama could not be reached at %s: %s. Start it (ollama serve) and check the address." % (root, str(exc)[:160]))
    raise AIError(502, "Ollama failed: %s" % last)


def openai_chat(p, messages, tools=None, json_mode=False, schema=None):
    import urllib.request, urllib.error, time
    if not p.get("model") or "YOUR-" in p.get("model", "") or "YOUR-" in p.get("baseUrl", ""):
        raise AIError(400, "Provider '%s' is not set up yet: fill in the address and the model name." % p.get("name"))
    if is_ollama(p):
        r = ollama_chat(p, messages, tools, json_mode, schema)
        if r is not None:
            return r
    body = {"model": p["model"], "messages": messages}
    if p.get("maxTokens"):
        body[p.get("tokenParam") or "max_tokens"] = int(p["maxTokens"])
    if p.get("temperature") is not None:
        body["temperature"] = p["temperature"]
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"
    elif json_mode and p.get("json"):
        body["response_format"] = {"type": "json_object"}
    hdr = {"Content-Type": "application/json", "Accept": "application/json", "User-Agent": "dochub/1.0"}
    key = _prov_key(p)
    if key:
        hdr["api-key" if p.get("authHeader") == "api-key" else "Authorization"] = key if p.get("authHeader") == "api-key" else "Bearer " + key
    url = p["baseUrl"].rstrip("/") + "/chat/completions"
    last = None
    for attempt, wait in enumerate((0, 3, 8)):
        check_cancel()
        if wait:
            time.sleep(wait)
        try:
            req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=hdr, method="POST")
            with job_open(req, AI_TIMEOUT) as r:
                data = json.loads(r.read().decode("utf-8", "replace"))
            check_cancel()
            ch = (data.get("choices") or [{}])[0]
            return dict(ch.get("message") or {}, _finish=ch.get("finish_reason") or ""), data.get("usage") or {}
        except AIError:
            raise
        except urllib.error.HTTPError as exc:
            if job_cancelled():
                raise AIError(499, STOPPED)
            detail = exc.read().decode("utf-8", "replace")[:400]
            if exc.code == 400 and "max_completion_tokens" in detail and "max_tokens" in body:
                body["max_completion_tokens"] = body.pop("max_tokens")  # newer models want this name
                continue
            if exc.code == 400 and "max_tokens" in detail and "max_completion_tokens" in body:
                body["max_tokens"] = body.pop("max_completion_tokens")  # older servers want this name
                continue
            if exc.code in (429, 500, 502, 503, 504) and attempt < 2:
                last = "HTTP %d" % exc.code
                ra = (exc.headers.get("Retry-After") or "") if exc.headers else ""
                if ra.isdigit() and 0 < int(ra) <= 60:
                    time.sleep(int(ra))  # the server says when to come back
                continue
            if exc.code in (401, 403):
                raise AIError(401, "%s refused the key (HTTP %d). Check the API key for this provider. %s" % (p.get("name"), exc.code, detail[:160]))
            if exc.code == 400 and json_mode and "response_format" in detail:
                raise AIError(400, "%s does not accept JSON mode. Untick 'JSON mode' for this provider. %s" % (p.get("name"), detail[:160]))
            raise AIError(502, "%s answered HTTP %d: %s" % (p.get("name"), exc.code, detail))
        except Exception as exc:
            if job_cancelled():
                raise AIError(499, STOPPED)
            last = str(exc)
            if attempt < 2 and not isinstance(exc, ValueError):
                continue
            raise AIError(502, "%s could not be reached: %s" % (p.get("name"), str(exc)[:200]))
    raise AIError(502, "%s failed: %s" % (p.get("name"), last))


# ---- tools for documentation connections when the model is not Claude: MCP client and a documentation page reader ----
from html.parser import HTMLParser


class _Text(HTMLParser):
    def __init__(self, base):
        super().__init__()
        self.base, self.out, self.links, self.skip = base, [], [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript", "svg", "nav", "footer"):
            self.skip += 1
        if tag in ("p", "br", "li", "tr", "div", "h1", "h2", "h3", "h4", "pre"):
            self.out.append("\n")
        if tag == "a" and not self.skip:
            from urllib.parse import urljoin
            h = dict(attrs).get("href")
            if h and not h.startswith(("#", "mailto:", "javascript:")):
                self.links.append(urljoin(self.base, h).split("#")[0])

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript", "svg", "nav", "footer") and self.skip:
            self.skip -= 1

    def handle_data(self, d):
        if not self.skip and d.strip():
            self.out.append(d.strip() + " ")


def html_to_text(html, base):
    t = _Text(base)
    try:
        t.feed(html)
    except Exception:
        pass
    text = re.sub(r"\n\s*\n+", "\n", "".join(t.out)).strip()
    return text, list(dict.fromkeys(t.links))


class McpClient:
    def __init__(self, c):
        if c.get("blocked"):
            raise RuntimeError("this local program is not approved on this computer yet; press Approve")
        self.c, self.sid, self.p, self.n = c, None, None, 0
        if c.get("type") == "stdio":
            env = dict(os.environ)
            env.update({str(k): str(v) for k, v in (c.get("env") or {}).items()})
            self.p = subprocess.Popen([str(c.get("command", ""))] + [str(a) for a in c.get("args", [])], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
            self.timer = threading.Timer(AI_TIMEOUT, self.p.kill)
            self.timer.start()
        self.rpc("initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "dochub", "version": "1.0"}})
        self.note("notifications/initialized")

    def _send(self, obj):
        if self.p:
            self.p.stdin.write((json.dumps(obj) + "\n").encode())
            self.p.stdin.flush()
            return None
        import urllib.request
        h = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", **{str(k): str(v) for k, v in (self.c.get("headers") or {}).items()}}
        if self.sid:
            h["Mcp-Session-Id"] = self.sid
        with urllib.request.urlopen(urllib.request.Request(self.c["url"], data=json.dumps(obj).encode(), headers=h, method="POST"), timeout=60) as r:
            self.sid = r.headers.get("Mcp-Session-Id") or self.sid
            return r.read().decode("utf-8", "replace")

    def note(self, method):
        try:
            self._send({"jsonrpc": "2.0", "method": method})
        except Exception:
            pass

    def rpc(self, method, params=None):
        self.n += 1
        rid = self.n
        raw = self._send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params or {}})
        if self.p:
            while True:
                line = self.p.stdout.readline()
                if not line:
                    raise RuntimeError("the MCP server closed (is '%s' installed?)" % self.c.get("command"))
                try:
                    m = json.loads(line)
                except ValueError:
                    continue
                if m.get("id") == rid:
                    break
        else:
            m = None
            for line in raw.splitlines():
                line = line.strip()
                if line.startswith("data:"):
                    line = line[5:].strip()
                if line.startswith("{"):
                    try:
                        x = json.loads(line)
                    except ValueError:
                        continue
                    if x.get("id") == rid and ("result" in x or "error" in x):
                        m = x
                        break
            if m is None:
                raise RuntimeError("no answer from the MCP server")
        if "error" in m:
            raise RuntimeError(m["error"].get("message", "MCP error"))
        return m.get("result") or {}

    def tools(self):
        return self.rpc("tools/list").get("tools", [])

    def call(self, name, args):
        res = self.rpc("tools/call", {"name": name, "arguments": args or {}})
        text = "\n".join(x.get("text", "") for x in res.get("content", []) if x.get("type") == "text")
        return ("Error: " if res.get("isError") else "") + text

    def close(self):
        if self.p:
            try:
                self.timer.cancel()
                self.p.stdin.close()
            except Exception:
                pass
            self.p.kill()


class ToolBox:
    """The function-calling tools a non-Claude model gets: every tool of the chosen MCP connections and a page reader for the chosen documentation websites."""
    def __init__(self, conns):
        from urllib.parse import urlparse as _up
        self.clients, self.map, self.defs, self.hosts, self.pages = [], {}, [], set(), []
        for c in load_conns():
            if c["id"] not in set(conns or []):
                continue
            if c.get("type") == "site":
                h = _up(str(c.get("url", ""))).hostname
                if h:
                    self.hosts.add(h)
                continue
            try:
                cl = McpClient(c)
                self.clients.append(cl)
                for t in cl.tools():
                    fn = re.sub(r"[^A-Za-z0-9_-]", "_", "%s__%s" % (c["id"], t.get("name", "")))[:64]
                    self.map[fn] = (cl, t.get("name"))
                    self.defs.append({"type": "function", "function": {"name": fn, "description": ("[%s] %s" % (c.get("name"), t.get("description", "")))[:900], "parameters": t.get("inputSchema") or {"type": "object", "properties": {}}}})
            except Exception as exc:
                raise AIError(502, "Connection '%s' could not be used: %s" % (c.get("name") or c["id"], str(exc)[:200]))
        if self.hosts:
            self.defs.append({"type": "function", "function": {"name": "fetch_doc_page", "description": "Read one page of an official documentation website and list its links. Allowed sites: %s. Use the links to move to other pages. Only call it with URLs from the allowed sites." % ", ".join(sorted(self.hosts)),
                              "parameters": {"type": "object", "properties": {"url": {"type": "string", "description": "Full https URL of the page"}}, "required": ["url"]}}})

    def run(self, name, args):
        from urllib.parse import urlparse as _up
        try:
            if name == "fetch_doc_page":
                url = str((args or {}).get("url") or "")
                if _up(url).hostname not in self.hosts or not public_https(url):
                    return "Error: only https pages on these sites can be read: " + ", ".join(sorted(self.hosts))
                status, final, text = fetch_page(url, 15, 600000)
                if _up(final).hostname not in self.hosts:
                    return "Error: the page redirected outside the allowed sites"
                if status >= 400:
                    return "Error: the page answered HTTP %d" % status
                body, links = html_to_text(text, final)
                self.pages.append(final)
                return ("URL: %s\n\n%s\n\nLinks:\n%s" % (final, body[:11000], "\n".join(l for l in links if _up(l).hostname in self.hosts)[:3500]))
            cl, tname = self.map[name]
            out = cl.call(tname, args or {})
            self.pages.extend(re.findall(r"https://[^\s)\"'<>]+", out)[:5])
            return out
        except KeyError:
            return "Error: unknown tool " + name
        except Exception as exc:
            return "Error: %s" % str(exc)[:300]

    def close(self):
        for c in self.clients:
            c.close()


def run_openai(p, prompt, conns, want_json, schema=None, system=None):
    # the instructions go in a system message (small local models follow them better there); the task stays last
    messages = ([{"role": "system", "content": system}] if system else []) + [{"role": "user", "content": prompt}]
    wants_tools = bool(conns) and any(c["id"] in set(conns) for c in load_conns())
    if wants_tools and not p.get("tools"):
        raise AIError(400, "'%s' is set as not supporting tool calls, so documentation connections cannot be used with it. Untick the connections for this design, tick 'Supports tool calls' if the model does, or pick another model." % p.get("name"))
    _LAST.label = "%s / %s" % (p.get("name"), p.get("model"))
    _LAST.truncated = False
    if not wants_tools:
        msg, usage = openai_chat(p, messages, None, want_json, schema)
        _LAST.meta = {"usage": usage, "turns": 1}
        _LAST.truncated = msg.get("_finish") == "length"
        return strip_think(msg.get("content") or "")
    messages[-1]["content"] += SOURCES_RULE
    sites = conn_sites(conns)
    if sites:
        messages[-1]["content"] += "\nOfficial documentation websites (read pages with the fetch_doc_page tool):\n" + "\n".join("- %s: %s" % (n, u) for n, u, _ in sites)
    tb = ToolBox(conns)
    try:
        turns = 0
        for _ in range(20):
            check_cancel()
            turns += 1
            msg, usage = openai_chat(p, messages, tb.defs)
            calls = msg.get("tool_calls") or []
            messages.append({"role": "assistant", "content": msg.get("content") or "", **({"tool_calls": calls} if calls else {})})
            if not calls:
                _LAST.meta = {"usage": usage, "turns": turns, "pages": tb.pages[:20], "toolCalls": turns - 1}
                _LAST.truncated = msg.get("_finish") == "length"
                return strip_think(msg.get("content") or "")
            for c in calls:
                try:
                    args = json.loads(c["function"].get("arguments") or "{}")
                except ValueError:
                    args = {}
                messages.append({"role": "tool", "tool_call_id": c.get("id"), "content": tb.run(c["function"]["name"], args)[:15000]})
        messages.append({"role": "user", "content": "Stop searching now and give the final answer with what you have."})
        msg, usage = openai_chat(p, messages, None, want_json, schema)
        _LAST.meta = {"usage": usage, "turns": turns + 1, "pages": tb.pages[:20]}
        _LAST.truncated = msg.get("_finish") == "length"
        return strip_think(msg.get("content") or "")
    finally:
        tb.close()


def run_model(prompt, conns=None, want_json=False, schema=None, system=None):
    p = resolve_provider()
    _LAST.truncated = False
    if p["kind"] == "claude-cli":
        _LAST.label = "Claude CLI" + (" / " + claude_model_name() if claude_model_name() != "Claude CLI default" else "")
        return _run_claude(("%s\n\n%s" % (system, prompt)) if system else prompt, conns)
    return run_openai(p, prompt, conns, want_json, schema, system)


def fit_ctx(ctx, other_chars, out_tokens=0):
    """Background documents are shortened for a local Ollama model so the call fits its context window (the document being edited and the instruction are never cut).
    Cloud and Claude models have large windows and get everything. Returns (ctx, trimmed)."""
    p = resolve_provider()
    if p.get("kind") == "claude-cli" or not is_ollama(p):
        return ctx, False
    try:
        ceiling = max(4096, int(p.get("numCtx") or 32768))
    except Exception:
        ceiling = 32768
    room = int((ceiling * 0.8 - out_tokens) * 3) - other_chars - 3000  # 3 characters per token, 20% kept free
    if len(ctx) <= room:
        return ctx, False
    kept = 0 if room < 4000 else min(room, len(ctx))
    job_notice("Local model with a %dK-token window: the background documents were shortened (%d%% of them used) so the call fits. The result may be less complete. Use a cloud model or a larger context window for the full background." % (ceiling // 1024, int(100 * kept / max(1, len(ctx)))))
    if kept == 0:
        return "", True
    cut = ctx[:kept]
    nl = cut.rfind("\n")
    if nl > kept * 0.8:
        cut = cut[:nl]
    return cut + "\n\n[... the rest of the background documents was left out to fit the local model's context window ...]", True


STOPPED = "Stopped. Nothing was changed."


def job_cancelled():
    jid = getattr(_CTX, "job", "")
    if not jid:
        return False
    with _JOBS_LOCK:
        return bool((_JOBS.get(jid) or {}).get("cancel"))


def check_cancel():
    if job_cancelled():
        raise AIError(499, STOPPED)


def job_closer(fn):
    """Remember how to abort the call that is running for this job (close the connection, kill the process)."""
    jid = getattr(_CTX, "job", "")
    if not jid:
        return
    with _JOBS_LOCK:
        j = _JOBS.get(jid)
        if j is not None:
            j.setdefault("closers", []).append(fn)
            gone = bool(j.get("cancel"))
        else:
            gone = False
    if gone:
        fn()


def job_open(req, timeout):
    """urlopen that the Stop button can abort: the connection is registered with the job, so closing it ends the call at once (a local model stops generating when its connection closes)."""
    import urllib.request, socket
    if not getattr(_CTX, "job", ""):
        return urllib.request.urlopen(req, timeout=timeout)

    def closer(c):
        def f():
            try:
                if c.sock:
                    c.sock.shutdown(socket.SHUT_RDWR)
            except Exception:
                pass
            try:
                c.close()
            except Exception:
                pass
        return f

    def wrap(base):
        class H(base):
            def do_open(self, http_class, req, **kw):
                def factory(*a, **k):
                    c = http_class(*a, **k)
                    job_closer(closer(c))
                    return c
                return super().do_open(factory, req, **kw)
        return H
    opener = urllib.request.build_opener(wrap(urllib.request.HTTPHandler), wrap(urllib.request.HTTPSHandler))
    return opener.open(req, timeout=timeout)


def cancel_ai_job(jid):
    """Stop a running AI job: abort its model call and finish it at once, so the page is not kept waiting."""
    import time as _t
    with _JOBS_LOCK:
        j = _JOBS.get(jid)
        if not j:
            return False
        was_running = not j.get("done")
        j["cancel"] = True
        closers = list(j.get("closers") or [])
        if was_running:
            j.update({"done": True, "code": 499, "body": json.dumps({"error": STOPPED, "stopped": True}), "at": _t.time()})
    for f in closers:
        try:
            f()
        except Exception:
            pass
    return was_running


def job_notice(text):
    """A short message the page shows while the call is running (never a popup)."""
    jid = getattr(_CTX, "job", "")
    if jid:
        with _JOBS_LOCK:
            if jid in _JOBS:
                _JOBS[jid]["notice"] = text


def _cut_off():
    return AIError(502, "The AI model stopped before it finished: it reached its output limit or the context window. Nothing was changed. Raise 'Max output tokens' for this provider (cloud), or \"numCtx\" in providers.json (local Ollama), use a model with a longer context, or send fewer documents.")


def provider_test(pid):
    """One real call that writes a short paragraph, so that speed can be measured: time, tokens in and out, tokens per second."""
    import time
    _CTX.provider, _CTX.step = pid, ""
    t0 = time.time()
    text = run_model("Write one plain-text paragraph of about 120 words that explains how a retail return and refund process works. No headings and no lists.", None, False)
    secs = max(time.time() - t0, 0.001)
    u = (getattr(_LAST, "meta", {}) or {}).get("usage") or {}
    out_t = u.get("completion_tokens") or u.get("output_tokens")
    in_t = u.get("prompt_tokens") or u.get("input_tokens")
    estimated = not out_t
    if estimated:
        out_t = max(1, len(text) // 4)
    return {"ok": True, "answer": text.strip()[:300], "ms": int(secs * 1000), "model": model_label(), "inTokens": in_t, "outTokens": int(out_t),
            "tps": round(int(out_t) / secs, 1), "estimated": estimated}


def provider_models(pid):
    import urllib.request
    p = next((x for x in load_providers()[0] if x["id"] == pid), None)
    if not p:
        raise AIError(404, "Provider not found")
    hdr = {"Accept": "application/json", "User-Agent": "dochub/1.0"}
    key = _prov_key(p)
    if key:
        hdr["api-key" if p.get("authHeader") == "api-key" else "Authorization"] = key if p.get("authHeader") == "api-key" else "Bearer " + key
    try:
        with urllib.request.urlopen(urllib.request.Request(p["baseUrl"].rstrip("/") + "/models", headers=hdr), timeout=30) as r:
            data = json.loads(r.read().decode("utf-8", "replace"))
    except Exception as exc:
        raise AIError(502, "The model list could not be read: %s" % str(exc)[:200])
    items = data.get("data") if isinstance(data, dict) else data
    return sorted({str(m.get("id") or m.get("name") or "") for m in (items or []) if isinstance(m, dict)} - {""})[:300]



def ai_call(system, user, tool, max_tokens=0, conns=None):
    sch = tool["input_schema"]
    schema = json.dumps(sch)
    # the schema sits right after the task; the model also gets it as a response format where the server supports that (Ollama)
    prompt = ("%s\n\nAnswer with ONE JSON object only, no prose and no code fence, that follows this JSON schema:\n%s" % (user, schema))
    text = run_model(prompt, conns, True, sch, system)
    cut = getattr(_LAST, "truncated", False)
    data = _extract_json(text)
    if not isinstance(data, dict):  # one more try with a stricter instruction
        if cut:
            raise _cut_off()
        text = run_model(prompt + "\n\nYour previous answer was not valid JSON. Answer again with ONE valid JSON object only: escape every double quote inside strings, no trailing commas, no text before or after.", conns, True, sch, system)
        cut = getattr(_LAST, "truncated", False)
        data = _extract_json(text)
    if not isinstance(data, dict):
        raise _cut_off() if cut else AIError(502, "The AI model did not return a valid JSON answer. Try again, or choose a more capable model for this step in AI models.")
    return data


def ai_text(system, user, conns=None):
    text = run_model(user, conns, False, None, system).strip()
    if getattr(_LAST, "truncated", False):
        raise _cut_off()
    m = re.match(r"^```(?:markdown|md)?\s*\n(.*)\n```$", text, re.S)
    return (m.group(1) if m else text).strip()


ANALYZE_SYSTEM = (
    "You are a senior business analyst and solution architect reviewing a consolidated requirement document before design starts. "
    "Find every issue that would cause a wrong build, a wrong test or a rework later. Look for: "
    "(1) missing content: flows, channels, error handling, data fields, owners, acceptance criteria, non-functional needs that the document implies but never states; "
    "(2) requirements that are unclear, vague, ambiguous or cannot be tested; "
    "(3) TBD, TBC, open questions, placeholders and decisions not confirmed, including statements like 'to be agreed'; "
    "(4) logic problems: contradictions between sections or requirements, impossible sequences, different numbers or rules for the same thing, steps with no owner or no outcome, requirements that do not trace to a process step or the reverse. "
    "Rules: report only what is supported by the document text, never invent facts. Be specific: name the section or requirement ID in 'where' and say exactly what is wrong. "
    "Tables are structure: column headers, the --- separator row and table titles are never issues; judge the rows. Do not report the same issue twice. Do not pad with style comments. If the document has no issues of a kind, report none of that kind. "
    "Report ONLY Critical and Important issues and set 'severity' on each. Critical: contradictions, missing or TBD items that block design or testing, rules with no defined outcome, anything that would make the build or the tests wrong. Important: ambiguity or gaps that would likely cause rework, unclear ownership, unconfirmed decisions with real impact. Leave out minor wording, style and nice-to-have points entirely."
    + FIXRULE
    + (FOCUSRULE % 12)
    + CONCISE
)

PLAN_TOOL = {
    "name": "report_scenario_plan",
    "description": "Group the requirements into a few high-level scenario categories and name the channels.",
    "input_schema": {"type": "object", "required": ["categories", "channels", "groups"], "properties": {
        "categories": {"type": "array", "items": {"type": "string"}, "description": "The high-level scenario categories, named after business capabilities or journeys; usually 5 to 12."},
        "channels": {"type": "array", "items": {"type": "string"}, "description": "The 3 to 8 real channels or systems the scenarios run in, in the document's own words."},
        "groups": {"type": "array", "items": {"type": "object", "required": ["category", "reqs"], "properties": {
            "category": {"type": "string", "description": "One of the categories."},
            "reqs": {"type": "array", "items": {"type": "string"}, "description": "Requirement IDs in this category. Every requirement is in exactly one group."}}}}}},
}
PLAN_SYSTEM = (
    "You are a senior test analyst planning a scenario matrix. You get the requirement document and the list of requirements (ID and text). "
    "Group ALL the requirements into HIGH-LEVEL scenario categories (usually 5 to 12, as many as the business really has) named after business capabilities or customer journeys (for example 'Account and customer', 'Consent capture', 'Preferences and unsubscribe', 'Marketing eligibility'). "
    "A category is never a single channel, a single requirement, a rule ID or a one-off topic: merge small topics into the closest category; a category should hold at least two requirements. Every requirement is in exactly one category. "
    "Also list the 3 to 8 real channels or systems in which the scenarios will run, using the document's own words and merging synonyms and sub-variants (for example one 'Shopify' rather than five Shopify page names). "
    "Use only IDs from the list. Never invent requirements."
    + CONCISE
)
SCEN_SYSTEM = (
    "You are a senior test analyst. From the requirement document, design the scenario matrix for the requested requirements. "
    "Think in business journeys and variations, not one scenario per requirement: a scenario covers a journey or variation and lists ALL the requirement IDs that its steps prove. Every requested requirement ID must appear in at least one scenario. "
    "Do not merge distinct variations that the document treats as separate behaviour (for example different payment methods, markets, regions or channels that follow different rules). Do not split a variation that follows the same steps and rules. "
    "COVER EVERY P0 AND P1 SCENARIO COMPLETELY: there is no limit on how many P0 and P1 scenarios you return, and you must not drop or merge away a business-critical journey or a common variation. "
    "KEEP P2 AND P3 TO A MINIMUM: only the few secondary or rare scenarios that really matter, and never more P2 and P3 scenarios together than the limit stated in the request. "
    "Always include the main success path (Happy) of every journey. Add Negative or Edge scenarios for risks that matter (money, legal, consent, data loss, a rule that rejects, a failure that blocks the flow); do not repeat one behaviour for every value. At most ONE Gap scenario per request, only where the document is silent on something that needs a decision; say what must be decided. "
    "Every scenario must trace to at least one requested requirement ID and use only those IDs. Expected outcomes must use the real values, states, amounts, systems and messages in the document; never write generic text such as 'works as expected'. "
    "If a fixed category is given, use exactly that category for every scenario. If a list of channels is given, set the channel of each scenario to one entry of that list, or All when it applies to every channel; never invent other channel names. Otherwise use the document's own channel names. "
    "Do not invent behaviour the document does not support: if you must assume, make it a Gap scenario. "
    "PRIORITY (decide in this order, the first that fits wins). "
    "P0 Critical: core end-to-end scenarios that must work for the business to operate; failure blocks release or go-live (for example order creation, payment, fulfillment, refund or return, critical integrations, core regional flows). Regression: every build and deployment. Test: if this fails, can we still operate or release? No. "
    "P1 High: primary happy-path business scenarios and commonly used variations; failure has significant business impact but may have a workaround (for example full or partial shipment, common payment methods, standard cancellation or exchange, major market variations). Regression: full or major release. Test: is it a normal, high-volume customer journey? Yes. "
    "P2 Medium: valid but less frequently used scenarios, secondary variations, or cases with acceptable workarounds (for example less common payment or shipping combinations, uncommon regional variations, secondary process paths). Regression: planned. Test: is it supported but less common, or does it have a workaround? Yes. "
    "P3 Low, edge or future: rare edge cases, complex combinations, or capabilities not required today or meant for future scope (for example return on exchange, exchange on exchange, future capabilities, unsupported or exploratory combinations). Regression: as needed or future release. Test: is it an edge case, an exceptional combination or a future capability? Yes."
    + CONCISE
)



def mcp_spec():
    """Return (command list, env) for the 'markitdown' server in markitdown.mcp.json, or None."""
    try:
        cfg = json.loads(MCP_CONFIG.read_text("utf-8"))
        srv = cfg["mcpServers"]["markitdown"]
        cmd = [srv["command"], *[str(a) for a in srv.get("args", [])]]
        if not shutil.which(cmd[0]):
            return None
        env = {**os.environ, **{str(k): str(v) for k, v in (srv.get("env") or {}).items()}}
        return cmd, env
    except Exception:
        return None


def mcp_convert(path: Path, timeout=180):
    """Call the MarkItDown MCP server's convert_to_markdown tool over stdio (newline-delimited JSON-RPC)."""
    spec = mcp_spec()
    if not spec:
        raise RuntimeError("config/markitdown.mcp.json has no 'markitdown' server")
    cmd, env = spec
    p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
    timer = threading.Timer(timeout, p.kill)
    timer.start()

    def send(obj):
        p.stdin.write((json.dumps(obj) + "\n").encode())
        p.stdin.flush()

    def wait_for(rid):
        while True:
            line = p.stdout.readline()
            if not line:
                raise RuntimeError("MCP server closed or timed out (is '%s' installed?)" % cmd[0])
            try:
                msg = json.loads(line)
            except ValueError:
                continue
            if msg.get("id") == rid:
                if "error" in msg:
                    raise RuntimeError(msg["error"].get("message", "MCP error"))
                return msg["result"]

    try:
        send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "dochub", "version": "1.0"}}})
        wait_for(1)
        send({"jsonrpc": "2.0", "method": "notifications/initialized"})
        send({"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "convert_to_markdown", "arguments": {"uri": path.resolve().as_uri()}}})
        res = wait_for(2)
        text = "\n".join(c.get("text", "") for c in res.get("content", []) if c.get("type") == "text")
        if res.get("isError"):
            raise RuntimeError(text or "conversion failed")
        return text
    finally:
        timer.cancel()
        try:
            p.stdin.close()
        except Exception:
            pass
        p.kill()


def engine():
    if mcp_spec():
        return "mcp"
    return "python" if _MD is not None else None



# ---------- shared configuration: one folder inside the data folder holds what the whole team uses (reference connections, document templates) ----------
CONFIG_NAME = "_config"


def secrets_file():
    return SETTINGS_DIR / "connection-secrets.json"  # this computer only: connection tokens and the approved local programs


def config_dir():
    return DATA / CONFIG_NAME


def tpl_dir():
    return config_dir() / "templates"


def conn_file():
    return config_dir() / "connections.json"


def local_secrets():
    try:
        d = json.loads(secrets_file().read_text("utf-8"))
        if isinstance(d, dict):
            d.setdefault("secrets", {}); d.setdefault("approved", [])
            return d
    except Exception:
        pass
    return {"secrets": {}, "approved": []}


def save_local_secrets(d):
    SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    secrets_file().write_text(json.dumps(d, indent=2), "utf-8")
    try:
        os.chmod(str(secrets_file()), 0o600)
    except Exception:
        pass


def stdio_hash(c):
    import hashlib
    return "%s:%s" % (c.get("id"), hashlib.sha256(json.dumps([c.get("command", ""), c.get("args", [])]).encode()).hexdigest()[:12])


def ensure_config():
    """Make sure the shared config folder exists in the data folder: templates (copied from the ones shipped with the tool),
    and connections (moved from the old local connections.json, whose tokens go to this computer only)."""
    try:
        cd = config_dir(); cd.mkdir(parents=True, exist_ok=True)
        td = tpl_dir(); td.mkdir(parents=True, exist_ok=True)
        if not (td / "index.json").is_file() and TPL_SEED.is_dir():
            for f in TPL_SEED.iterdir():
                if f.is_file() and not (td / f.name).exists():
                    shutil.copy2(str(f), str(td / f.name))
        cf = conn_file()
        if not cf.is_file():
            old = ROOT / "connections.json"; items = None
            if old.is_file():
                try:
                    items = json.loads(old.read_text("utf-8")).get("connections")
                except Exception:
                    items = None
            if not isinstance(items, list):
                items = list(DEFAULT_CONNS)
            sec = local_secrets(); shared = []
            for c in items:
                if not isinstance(c, dict) or not CONN_ID_RE.match(str(c.get("id", ""))):
                    continue
                c = dict(c)
                keep = {k: c.pop(k) for k in ("headers", "env") if k in c}
                if keep:
                    sec["secrets"][c["id"]] = keep
                if c.get("type") == "stdio" and old.is_file():
                    h = stdio_hash(c)
                    if h not in sec["approved"]:
                        sec["approved"].append(h)  # the user wrote it on this computer
                shared.append(c)
            save_local_secrets(sec)
            atomic_write(cf, json.dumps({"connections": shared}, indent=2))
            if old.is_file():
                try:
                    old.rename(ROOT / "connections.json.moved")
                except Exception:
                    pass
    except Exception:
        pass


# ---------- reference connections (MCP servers and documentation sites), shared with the team through the config folder ----------
CONN_ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]{0,31}$")
DEFAULT_CONNS = [
    {"id": "shopify-docs", "name": "Shopify developer docs", "type": "site", "url": "https://shopify.dev/docs",
     "description": "shopify.dev: Admin GraphQL API, webhooks, POS, Functions"},
]
CONN_UI_FIELDS = ("name", "description")


def clean_docs(v):
    v = str(v or "").strip()
    return v if v.startswith("https://") and len(v) < 300 else ""


def load_conns_raw():
    ensure_config()
    try:
        items = json.loads(conn_file().read_text("utf-8")).get("connections")
        if isinstance(items, list):
            return [c for c in items if isinstance(c, dict) and CONN_ID_RE.match(str(c.get("id", "")))]
    except Exception:
        pass
    return []


def load_conns():
    """The shared definitions plus this computer's secrets. A local program (stdio) from the shared file is blocked until it is
    approved on this computer, because it would run code here."""
    sec = local_secrets(); out = []
    for c in load_conns_raw():
        c = dict(c)
        for k, v in (sec["secrets"].get(c["id"]) or {}).items():
            c.setdefault(k, v)
        if c.get("type") == "stdio" and stdio_hash(c) not in sec["approved"]:
            c["blocked"] = True
        out.append(c)
    return out


def conn_public(c):
    """What the browser may see: never headers, env or tokens."""
    return {"id": c["id"], "name": str(c.get("name") or c["id"]), "type": c.get("type") if c.get("type") in ("stdio", "site") else "http",
            "url": str(c.get("url") or ""), "command": (" ".join([str(c.get("command", ""))] + [str(a) for a in c.get("args", [])]) if c.get("type") == "stdio" else ""),
            "description": str(c.get("description") or ""), "docs": clean_docs(c.get("docs")), "auth": bool(c.get("headers") or c.get("env")), "blocked": bool(c.get("blocked"))}


def save_conns(incoming):
    """Browser edits: names, descriptions and https URLs; new connections are https only. Commands and arguments can only be written by
    hand in the shared connections.json (they run code), and tokens only in this computer's connection-secrets.json."""
    old = {c["id"]: c for c in load_conns_raw()}
    out, seen = [], set()
    for c in incoming if isinstance(incoming, list) else []:
        if not isinstance(c, dict) or not CONN_ID_RE.match(str(c.get("id", ""))) or c["id"] in seen:
            continue
        seen.add(c["id"])
        cur = dict(old.get(c["id"]) or {})
        if not cur:
            url = str(c.get("url") or "").strip()
            if not url.startswith("https://"):
                continue
            cur = {"id": c["id"], "type": "site" if c.get("type") == "site" else "http", "url": url}
        elif cur.get("type") != "stdio" and str(c.get("url") or "").startswith("https://"):
            cur["url"] = str(c["url"]).strip()
        for k in CONN_UI_FIELDS:
            if k in c:
                cur[k] = str(c[k])[:300]
        if "docs" in c:
            cur["docs"] = clean_docs(c["docs"])
        out.append(cur)
    ensure_config()
    atomic_write(conn_file(), json.dumps({"connections": out}, indent=2))
    return out


def conn_mcp_config(ids):
    """The --mcp-config JSON for the chosen connection ids, and the names of the servers."""
    chosen = [c for c in load_conns() if c["id"] in set(ids or [])]
    servers = {}
    for c in chosen:
        if c.get("type") == "site" or c.get("blocked"):
            continue
        if c.get("type") == "stdio":
            servers[c["id"]] = {"command": c.get("command", ""), "args": c.get("args", []), **({"env": c["env"]} if c.get("env") else {})}
        else:
            servers[c["id"]] = {"type": "http", "url": c.get("url", ""), **({"headers": c["headers"]} if c.get("headers") else {})}
    return servers


def public_https(url):
    """True for an https URL whose host resolves only to public addresses (the helper must not be used to reach the local network)."""
    import ipaddress, socket
    from urllib.parse import urlparse as _up
    u = _up(str(url))
    if u.scheme != "https" or not u.hostname:
        return False
    try:
        for fam, _, _, _, addr in socket.getaddrinfo(u.hostname, u.port or 443, proto=socket.IPPROTO_TCP):
            ip = ipaddress.ip_address(addr[0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return False
    except Exception:
        return False
    return True


def conn_sites(ids):
    """The documentation websites among the chosen connections: [(name, url, host)]."""
    from urllib.parse import urlparse as _up
    out = []
    for c in load_conns():
        if c["id"] in set(ids or []) and c.get("type") == "site":
            h = _up(str(c.get("url", ""))).hostname
            if h:
                out.append((str(c.get("name") or c["id"]), str(c["url"]), h))
    return out


def conn_hosts(ids):
    from urllib.parse import urlparse as _up
    hosts = {h for _, _, h in conn_sites(ids)}
    for c in load_conns():
        if c["id"] in set(ids or []) and c.get("type") not in ("stdio", "site") and c.get("url"):
            h = _up(str(c["url"])).hostname
            if h:
                hosts.add(h)
    return hosts


def fetch_page(url, timeout=12, limit=200000):
    """GET one public https page. Returns (status, final_url, text)."""
    import urllib.request, urllib.error
    req = urllib.request.Request(url, headers={"User-Agent": "dochub/1.0", "Accept": "text/html,*/*"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.geturl(), r.read(limit).decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, url, ""


def site_probe(url):
    if not public_https(url):
        raise RuntimeError("use an https:// address that is reachable on the internet")
    status, final, text = fetch_page(url)
    if status >= 400:
        raise RuntimeError("the site answered %d" % status)
    m = re.search(r"<title[^>]*>(.*?)</title>", text, re.I | re.S)
    return {"status": status, "title": re.sub(r"\s+", " ", m.group(1)).strip()[:120] if m else "", "url": final}


def verify_links(md, hosts):
    """Check the links in a generated document that point at the connected documentation hosts.
    A link answered with 404 or 410 is turned into plain text marked as not found. Returns (markdown, checked, dead)."""
    from urllib.parse import urlparse as _up
    if not hosts:
        return md, 0, []
    seen, dead, checked = {}, [], 0
    for m in re.finditer(r"\]\((https://[^)\s]+)\)|(?<![(\[])(https://[^\s)>\]]+)", md):
        url = (m.group(1) or m.group(2)).rstrip(".,;")
        h = _up(url).hostname
        if h in hosts and url not in seen and len(seen) < 40 and public_https(url):
            try:
                seen[url] = fetch_page(url, 8, 1000)[0]
            except Exception:
                seen[url] = 0
            checked += 1
    for url, code in seen.items():
        if code in (404, 410):
            dead.append(url)
            md = re.sub(r"\[([^\]]+)\]\(" + re.escape(url) + r"\)", r"\1 (link not found)", md)
            md = re.sub(r"(?<![(\w/])" + re.escape(url) + r"(?![\w/#?&=%\-]|\.\w)(?! \(link not found\))", url + " (link not found)", md)
    return md, checked, dead


def mcp_probe(c, timeout=45):
    """Connect to one connection and list its tools. Returns the tool names."""
    if c.get("blocked"):
        raise RuntimeError("this local program is not approved on this computer yet; press Approve")
    if c.get("type") == "stdio":
        cmd = [str(c.get("command", ""))] + [str(a) for a in c.get("args", [])]
        env = dict(os.environ); env.update({str(k): str(v) for k, v in (c.get("env") or {}).items()})
        p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
        timer = threading.Timer(timeout, p.kill); timer.start()
        try:
            def send(o):
                p.stdin.write((json.dumps(o) + "\n").encode()); p.stdin.flush()
            def wait_for(rid):
                while True:
                    line = p.stdout.readline()
                    if not line:
                        raise RuntimeError("the server closed or timed out (is '%s' installed?)" % cmd[0])
                    try:
                        m = json.loads(line)
                    except ValueError:
                        continue
                    if m.get("id") == rid:
                        if "error" in m:
                            raise RuntimeError(m["error"].get("message", "MCP error"))
                        return m["result"]
            send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "dochub", "version": "1.0"}}})
            wait_for(1)
            send({"jsonrpc": "2.0", "method": "notifications/initialized"})
            send({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
            return [t.get("name", "") for t in wait_for(2).get("tools", [])]
        finally:
            timer.cancel(); p.kill()
    import urllib.request
    hdr = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", **{str(k): str(v) for k, v in (c.get("headers") or {}).items()}}

    def post(obj, sid=None):
        h = dict(hdr)
        if sid:
            h["Mcp-Session-Id"] = sid
        req = urllib.request.Request(c["url"], data=json.dumps(obj).encode(), headers=h, method="POST")
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read().decode("utf-8", "replace")
            return r.headers.get("Mcp-Session-Id"), raw

    def parse(raw):
        for line in raw.splitlines():
            line = line.strip()
            if line.startswith("data:"):
                line = line[5:].strip()
            if line.startswith("{"):
                try:
                    m = json.loads(line)
                except ValueError:
                    continue
                if "result" in m or "error" in m:
                    if "error" in m:
                        raise RuntimeError(m["error"].get("message", "MCP error"))
                    return m["result"]
        raise RuntimeError("no answer from the server")
    sid, raw = post({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "dochub", "version": "1.0"}}})
    parse(raw)
    try:
        post({"jsonrpc": "2.0", "method": "notifications/initialized"}, sid)
    except Exception:
        pass
    _, raw = post({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}, sid)
    return [t.get("name", "") for t in parse(raw).get("tools", [])]


# ---------- export folder (for example a folder inside OneDrive) ----------
FOLDER_EXT = {".md", ".xlsx", ".csv", ".json", ".ts", ".txt"}
FOLDER_MAX_FILES = 400


def folder_ok(dir_text):
    """An absolute folder inside the user's home (or DESIGN_EXPORT_ROOTS), never inside the app folder."""
    try:
        d = Path(str(dir_text or "").strip()).expanduser()
        if not d.is_absolute():
            return None
        d = d.resolve()
        roots = [Path.home().resolve()] + [Path(x).resolve() for x in os.environ.get("DESIGN_EXPORT_ROOTS", "").split(os.pathsep) if x.strip()]
        if not any(r == d or r in d.parents for r in roots):
            return None
        if ROOT == d or ROOT in d.parents:
            return None
        return d
    except Exception:
        return None


def folder_rel(rel):
    segs = [x for x in str(rel).split("/") if x]
    if not segs or len(segs) > 5 or any(x in (".", "..") or x.startswith(".") or not NAME_RE.match(x) for x in segs):
        return None
    return segs if Path(segs[-1]).suffix.lower() in FOLDER_EXT else None




# ---------- data location: the project data lives in a folder inside the user's OneDrive (a personal folder, a shared folder added as a shortcut, or a synced team library); OneDrive signs in as the user ----------
SETTINGS_DIR = Path.home() / ".dochub"
SETTINGS_FILE = SETTINGS_DIR / "settings.json"
SYNC_HINT = re.compile(r"onedrive|cloudstorage", re.I)
LOCK_NAME = ".archiq-lock.json"
LOCK_FRESH = 150  # seconds without a heartbeat before a lock counts as stale
ACT_NAME = "_activity.jsonl"
_REV = {}  # design id -> (mtime_ns, rev) of the file as this process last wrote or read it
_OS_USER = None


def load_settings():
    try:
        d = json.loads(SETTINGS_FILE.read_text("utf-8"))
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def save_settings(d):
    SETTINGS_DIR.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(d, indent=2), "utf-8")
    try:
        os.chmod(str(SETTINGS_FILE), 0o600)
    except Exception:
        pass


def os_user():
    global _OS_USER
    if _OS_USER is None:
        try:
            import getpass
            _OS_USER = getpass.getuser()
        except Exception:
            _OS_USER = "user"
    return _OS_USER


def who():
    return str(load_settings().get("userName") or "").strip() or os_user()


def data_dir_ok(text):
    """An absolute folder inside the home folder (or DESIGN_EXPORT_ROOTS) and outside the tool's own folder."""
    d = folder_ok(text)
    return d


def onedrive_roots():
    """OneDrive folders found in the home folder (personal and work accounts, macOS CloudStorage and Windows)."""
    import glob
    h = str(Path.home()); found = []
    for k in ("OneDriveCommercial", "OneDrive", "OneDriveConsumer"):  # set by the OneDrive client on Windows
        p = os.environ.get(k)
        if p and os.path.isdir(p) and p not in found:
            found.append(p)
    for pat in (h + "/Library/CloudStorage/OneDrive*", h + "/OneDrive*"):
        for p in sorted(glob.glob(pat)):
            if os.path.isdir(p) and p not in found:
                found.append(p)
    return found


def pick_folder(start=""):
    """Open the operating system's own folder dialog on this computer and return the chosen path ('' when cancelled)."""
    start = start if start and os.path.isdir(start) else (onedrive_roots() or [str(Path.home())])[0]
    prompt = "Choose the folder for the project data (inside your OneDrive)"
    if sys.platform == "darwin":
        script = ['tell application "System Events" to activate', 'set f to choose folder with prompt "%s" default location (POSIX file "%s")' % (prompt, start.replace('"', "")), "return POSIX path of f"]
        cmd = ["osascript"]
        for l in script:
            cmd += ["-e", l]
    elif sys.platform.startswith("win"):
        ps = "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = '%s'; $d.SelectedPath = '%s'; $d.ShowNewFolderButton = $true; if ($d.ShowDialog() -eq 'OK') { Write-Output $d.SelectedPath }" % (prompt, start.replace("'", "''"))
        cmd = ["powershell", "-NoProfile", "-STA", "-Command", ps]
    elif shutil.which("zenity"):
        cmd = ["zenity", "--file-selection", "--directory", "--title", prompt, "--filename", start.rstrip("/") + "/"]
    elif shutil.which("kdialog"):
        cmd = ["kdialog", "--getexistingdirectory", start]
    else:
        raise RuntimeError("No folder dialog is available on this system. Type the path instead.")
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    except subprocess.TimeoutExpired:
        raise RuntimeError("The folder dialog was left open for too long.")
    out = (p.stdout or "").strip()
    if p.returncode != 0 and not out:
        return ""  # cancelled
    return out.rstrip("/\\") if len(out) > 1 else out


LOCAL_ID = "local"


def default_data_dir():
    return (ROOT / "designs").resolve()


def data_fixed():
    return bool(os.environ.get("DESIGN_DATA_DIR")) or DATA_FROM_CLI


def _same_path(a, b):
    try:
        return os.path.normcase(str(Path(a).expanduser().resolve())) == os.path.normcase(str(Path(b).expanduser().resolve()))
    except Exception:
        return False


def clean_instances(items):
    """The user's data locations ('instances'): a name and a folder each. The local default is always there and is not stored."""
    import uuid
    out, ids = [], set()
    for x in items or []:
        if not isinstance(x, dict):
            continue
        name = re.sub(r"\s+", " ", str(x.get("name") or "").strip())[:60]
        path = str(x.get("path") or "").strip()
        if not name or not path or _same_path(path, default_data_dir()) or any(_same_path(path, o["path"]) for o in out):
            continue
        iid = str(x.get("id") or "")
        if not re.match(r"^[A-Za-z0-9_-]{1,24}$", iid) or iid in (LOCAL_ID, "start") or iid in ids:
            iid = "i-" + uuid.uuid4().hex[:6]
        ids.add(iid)
        web = str(x.get("webUrl") or "").strip()[:400]
        out.append({"id": iid, "name": name, "path": path, "webUrl": web if web.startswith("https://") else ""})  # only https links are kept (they become a link on the page)
    return out


def stored_instances(st):
    if "instances" not in st and st.get("dataDir"):  # the earlier single data folder becomes the first instance
        p = str(st["dataDir"])
        return clean_instances([{"id": "i-main", "name": (Path(p).name or p), "path": p, "webUrl": st.get("webUrl") or st.get("siteUrl") or ""}])
    return clean_instances(st.get("instances"))


def active_instance_id(st, items):
    if data_fixed():
        return "start"
    a = str(st.get("active") or "")
    if not a and "instances" not in st and st.get("dataDir"):
        a = "i-main"
    return a if a == LOCAL_ID or any(x["id"] == a for x in items) else LOCAL_ID


def instance_rows(st):
    """Every data location with what the page shows: is it there, writable, inside OneDrive, how many projects."""
    if data_fixed():
        items = [{"id": "start", "name": "Set when the tool was started", "path": str(DATA), "webUrl": str(st.get("webUrl") or ""), "builtin": True, "fixed": True}]
        act = "start"
    else:
        stored = stored_instances(st)
        items = [{"id": LOCAL_ID, "name": "Local (this computer)", "path": str(default_data_dir()), "webUrl": "", "builtin": True}] + stored
        act = active_instance_id(st, stored)
    rows = []
    for x in items:
        p = Path(x["path"]).expanduser()
        ok = p.is_dir()
        try:
            n = sum(1 for y in p.iterdir() if (y / "design.json").is_file()) if ok else 0
        except Exception:
            n = 0
        rows.append(dict(x, active=x["id"] == act, exists=ok, projects=n, synced=bool(SYNC_HINT.search(str(p))), writable=ok and os.access(str(p), os.W_OK)))
    return rows, act


def use_instance(path):
    """Make a folder the data folder now: create it, check it is writable, and load its shared configuration."""
    global DATA
    d = Path(path).expanduser().resolve()
    if not d.exists() and not d.parent.is_dir():  # only the last folder is created: a missing OneDrive folder means OneDrive is not running
        raise ValueError("The folder was not found: %s (is OneDrive running and signed in?)" % d)
    d.mkdir(exist_ok=True)
    probe = d / ".archiq-write-test"
    try:
        probe.write_text("ok", "utf-8"); probe.unlink()
    except Exception:
        raise ValueError("That folder is not writable: %s" % d)
    DATA = d
    _REV.clear()
    migrate_design_folders(); ensure_config()


def settings_view():
    st = load_settings()
    rows, act = instance_rows(st)
    cur = next((r for r in rows if r["active"]), rows[0])
    return {"dataDir": str(DATA), "defaultDir": str(default_data_dir()), "usingDefault": DATA.resolve() == default_data_dir(), "appDir": str(ROOT), "userName": str(st.get("userName") or ""), "osUser": os_user(),
            "webUrl": str(cur.get("webUrl") or ""), "oneDrive": onedrive_roots(), "configDir": str(config_dir()), "synced": bool(SYNC_HINT.search(str(DATA))), "projects": cur["projects"],
            "writable": DATA.is_dir() and os.access(str(DATA), os.W_OK), "fixedByStart": data_fixed(), "file": str(SETTINGS_FILE), "instances": rows, "active": act}


def apply_settings(doc):
    """Save the settings. The data location is one of the user's instances (local, or a folder in a OneDrive): switching is immediate and never copies or deletes projects."""
    st = load_settings()
    if "userName" in doc:
        st["userName"] = str(doc.get("userName") or "").strip()[:80]
    web = str(doc.get("webUrl") or "").strip() if "webUrl" in doc else None
    if web and not web.startswith("https://"):
        raise ValueError("The web address must start with https://")
    for k in ("siteUrl", "library", "libPath"):
        st.pop(k, None)
    if data_fixed():
        if web is not None:
            st["webUrl"] = web[:400]
        if ("instances" in doc and str(doc.get("active") or "start") != "start") or (doc.get("dataDir") and not _same_path(str(doc["dataDir"]), DATA)):
            raise ValueError("The data folder was set when the tool was started (--data-dir or DESIGN_DATA_DIR). Remove that and restart to change it here.")
        save_settings(st)
        return settings_view()
    items = stored_instances(st)
    active = active_instance_id(st, items)
    if "instances" in doc:
        items = clean_instances(doc.get("instances"))
        active = str(doc.get("active") or active)
    elif "dataDir" in doc:  # older callers: one folder
        want = str(doc.get("dataDir") or "").strip()
        if not want:
            active = LOCAL_ID
        else:
            hit = next((x for x in items if _same_path(x["path"], want)), None)
            if not hit and not _same_path(want, default_data_dir()):
                hit = clean_instances([{"name": Path(want).name or want, "path": want}])[0]
                items.append(hit)
            active = hit["id"] if hit else LOCAL_ID
    for x in items:
        if not data_dir_ok(x["path"]):
            raise ValueError("'%s': the folder must be an absolute path inside your home folder and outside the tool's own folder" % x["name"])
    if active != LOCAL_ID and not any(x["id"] == active for x in items):
        raise ValueError("The chosen repo is not in the list")
    if web is not None:
        for x in items:
            if x["id"] == active:
                x["webUrl"] = web[:400]
    target = default_data_dir() if active == LOCAL_ID else Path(next(x["path"] for x in items if x["id"] == active))
    use_instance(target)  # raises before anything is saved when the folder cannot be used
    st["instances"], st["active"] = items, active
    st.pop("dataDir", None); st.pop("webUrl", None)
    save_settings(st)
    return settings_view()


def atomic_write(f, text):
    """Write text to f through a temporary file and a replace. On Windows the replace can fail for a moment while OneDrive or a
    scanner holds the file, so it is retried; the last resort is a direct write."""
    import time as _t
    f = Path(f); tmp = f.with_name(f.name + ".tmp")
    tmp.write_text(text, "utf-8")
    for i in range(8):
        try:
            os.replace(str(tmp), str(f))
            return
        except PermissionError:
            _t.sleep(0.15 * (i + 1))
    f.write_text(text, "utf-8")
    try:
        tmp.unlink()
    except Exception:
        pass


def long_path(p):
    """On Windows a path over 240 characters needs the long-path prefix (backslash backslash question mark backslash) for file calls; the default limit is 260."""
    p = Path(p)
    if os.name == "nt" and len(str(p)) > 240 and not str(p).startswith("\\\\?\\"):
        return Path("\\\\?\\" + str(p.resolve()))
    return p


def design_conflicts(did):
    """Copies of design.json that OneDrive made when two computers saved at the same time (design-<computer>.json and similar)."""
    d = DATA / did
    try:
        names = [x.name for x in d.iterdir() if x.is_file()]
    except Exception:
        return []
    return sorted(n for n in names if n != "design.json" and re.match(r"^design[ _-].*\.json$|^design\.json.*(conflict|copy)", n, re.I) and not n.endswith(".tmp") and ".damaged-" not in n)


def read_design_file(f):
    """Read design.json. A file with stray characters after the JSON (left by two overlapping writes) is repaired: the
    damaged copy is kept next to it and the valid part is written back. Returns (object, repaired, error)."""
    try:
        raw = f.read_text("utf-8")
    except Exception as exc:
        return None, False, str(exc)
    try:
        return json.loads(raw), False, ""
    except ValueError as first:
        try:
            obj, end = json.JSONDecoder().raw_decode(raw.lstrip())
        except ValueError:
            return None, False, str(first)
        if not isinstance(obj, dict) or not obj.get("id"):
            return None, False, str(first)
        import time as _t
        try:
            f.with_name("design.json.damaged-%s" % _t.strftime("%Y%m%d-%H%M%S")).write_text(raw, "utf-8")
            atomic_write(f, json.dumps(obj, indent=2))
        except Exception:
            pass
        return obj, True, ""



# ---------- the project folder is named after the design: one unique, file-system-safe name per design ----------
_RESERVED = {"con", "prn", "aux", "nul", "forms", "desktop.ini", "thumbs.db", "_config"} | {"com%d" % i for i in range(1, 10)} | {"lpt%d" % i for i in range(1, 10)}


def folder_from_name(name):
    """The folder name for a design name: characters that OneDrive, Windows or macOS refuse are replaced, spaces are tidied,
    at most 80 characters. The same input always gives the same output, and the output maps to itself."""
    n = str(name or "")
    n = re.sub(r"\s*[\\/]\s*", " - ", n)
    n = re.sub(r"\s*:\s*", " - ", n)
    n = re.sub(r'[*?"<>|\x00-\x1f]', "-", n)
    n = re.sub(r"\s+", " ", n).strip(" .")
    n = n.lstrip("~$").strip(" .")
    n = n[:80].strip(" .")
    if not n:
        n = "Untitled design"
    if n.lower() in _RESERVED:
        n += " design"
    return n


def design_folders():
    try:
        return [x for x in DATA.iterdir() if x.is_dir() and not x.name.startswith(".") and x.name != CONFIG_NAME]
    except Exception:
        return []


def name_taken(folder, except_name=""):
    low = folder.lower()
    return any(x.name.lower() == low and x.name != except_name for x in design_folders())


def unique_folder(base, except_name=""):
    f = folder_from_name(base)
    if not name_taken(f, except_name):
        return f
    k = 2
    while True:
        cand = folder_from_name("%s (%d)" % (f[:70], k))
        if not name_taken(cand, except_name):
            return cand
        k += 1


def fix_design_ids(d, old, new, name=None):
    """After a folder was renamed: write the new id (and name) into design.json and repoint the source links."""
    f = d / "design.json"
    obj = read_design_file(f)[0]
    if not obj:
        return
    obj["id"] = new
    if name is not None:
        obj["name"] = name
    from urllib.parse import quote as _q
    for sdoc in obj.get("sources") or []:
        if isinstance(sdoc, dict) and str(sdoc.get("url", "")).startswith("/files/"):
            sdoc["url"] = "/files/%s/%s" % (_q(new), _q(sdoc.get("name", "")))
    atomic_write(f, json.dumps(obj, indent=2))
    _REV.pop(old, None)
    _REV.pop(new, None)


def migrate_design_folders():
    """Rename project folders that still carry a generated id to the design name; duplicates get a number. Returns how many were renamed."""
    n = 0
    try:
        dirs = sorted(design_folders(), key=lambda x: x.name.lower())
    except Exception:
        return 0
    for d in dirs:
        f = d / "design.json"
        if not f.is_file():
            continue
        obj = read_design_file(f)[0]
        if not obj:
            continue
        want = folder_from_name(obj.get("name") or d.name)
        if want == d.name or (want.lower() == d.name.lower() and obj.get("id") == d.name):
            if obj.get("id") != d.name:
                fix_design_ids(d, str(obj.get("id")), d.name)
            continue
        target = want if not name_taken(want, d.name) else unique_folder(want, d.name)
        try:
            os.rename(str(d), str(d.parent / target))
        except Exception:
            continue
        fix_design_ids(d.parent / target, d.name, target, name=(target if target != want else obj.get("name")))
        n += 1
    return n


def design_meta(did):
    f = DATA / did / "design.json"
    if not f.is_file():
        return None
    mt = f.stat().st_mtime_ns; c = _REV.get(did)
    if c and c[0] == mt:
        return {"rev": c[1], "savedBy": c[2], "savedAt": c[3], "mtime": mt // 1000000}
    j = read_design_file(f)[0] or {}
    rev = int(j.get("rev") or 0); _REV[did] = (mt, rev, str(j.get("savedBy") or ""), int(j.get("savedAt") or 0))
    return {"rev": rev, "savedBy": str(j.get("savedBy") or ""), "savedAt": int(j.get("savedAt") or 0), "mtime": mt // 1000000}


def log_activity(did, event, detail=""):
    try:
        d = DATA / did
        if not d.is_dir():
            return
        import time as _t
        line = json.dumps({"t": int(_t.time() * 1000), "user": who(), "event": str(event)[:40], "detail": str(detail)[:300]}, ensure_ascii=False)
        with open(d / ACT_NAME, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except Exception:
        pass


def read_activity(did, n=200):
    f = DATA / did / ACT_NAME
    if not f.is_file():
        return []
    out = []
    for l in f.read_text("utf-8", "replace").splitlines()[-n:]:
        try:
            out.append(json.loads(l))
        except Exception:
            pass
    return out[::-1]


def lock_read(did):
    import time as _t
    f = DATA / did / LOCK_NAME
    try:
        j = json.loads(f.read_text("utf-8"))
    except Exception:
        return None
    j["stale"] = (_t.time() - float(j.get("beat") or 0)) > LOCK_FRESH
    return j


def lock_put(did, session, take):
    import time as _t
    cur = lock_read(did)
    if cur and cur.get("session") != session and not cur.get("stale") and not take:
        return False, cur
    now = _t.time()
    j = {"session": session, "user": who(), "since": (cur or {}).get("since") if cur and cur.get("session") == session else now, "beat": now}
    (DATA / did / LOCK_NAME).write_text(json.dumps(j), "utf-8")
    if not cur or cur.get("session") != session:
        log_activity(did, "lock-taken-over" if cur and not cur.get("stale") else "opened-for-editing", "")
    return True, j


def safe_name(name: str):
    name = unquote(name)
    if not NAME_RE.match(name) or name in (".", "..") or name.startswith("."):
        return None
    return name


class Handler(BaseHTTPRequestHandler):
    server_version = "DesignPipelinePOC/1.0"

    # ---------- helpers ----------
    def _send(self, code, body=b"", ctype="application/json", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _err(self, code, msg):
        self._send(code, {"error": msg})

    def _body(self):
        if hasattr(self, "_raw"):
            return self._raw
        n = int(self.headers.get("Content-Length") or 0)
        self._raw = None if n > MAX_UPLOAD else self.rfile.read(n)
        return self._raw

    def _guard(self):
        """Only pages opened from this computer may call the helper (blocks other web sites and DNS rebinding)."""
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
        origin = self.headers.get("Origin")
        if host not in ("127.0.0.1", "localhost", "::1") or (origin and (urlparse(origin).hostname or "") not in ("127.0.0.1", "localhost", "::1")):
            self._err(403, "Forbidden: the helper only answers pages opened from this computer")
            return False
        return True

    def _split(self, path):
        parts = [p for p in path.split("/") if p]
        if len(parts) > 2 and parts[:2] == ["api", "designs"]:
            parts[2] = unquote(parts[2])
        elif len(parts) > 1 and parts[0] == "files":
            parts[1] = unquote(parts[1])
        return parts

    def _design_dir(self, did):
        if not did or folder_from_name(did) != did:
            return None
        return DATA / did

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.command, self.path))

    # ---------- routing ----------
    def do_GET(self):
        if not self._guard():
            return
        path = urlparse(self.path).path
        parts = self._split(path)
        if path == "/api/health":
            return self._send(200, {"ok": True, "markitdown": engine() is not None, "engine": engine(), "mcpConfig": MCP_CONFIG.name if mcp_spec() else None, "markitdownError": _MD_ERROR, "version": VERSION, "dataDir": str(DATA), "ai": any_provider_ready(), "claude": ai_ready(), "aiProvider": ("Microsoft Foundry (" + FOUNDRY + ")") if FOUNDRY else "Claude CLI login", "aiModel": AI_MODEL or "Claude CLI default"})
        if len(parts) == 3 and parts[:2] == ["api", "ai-job"]:
            with _JOBS_LOCK:
                j = dict(_JOBS.get(parts[2]) or {})
            if not j:
                return self._err(404, "Unknown AI job (the helper was restarted?)")
            if not j.get("done"):
                return self._send(200, {"done": False, "step": j.get("step", ""), "notice": j.get("notice", "")})
            return self._send(200, {"done": True, "code": j["code"], "body": j["body"]})
        if path == "/api/settings":
            return self._send(200, settings_view())
        if len(parts) == 4 and parts[:2] == ["api", "designs"] and parts[3] in ("meta", "lock", "activity"):
            d = self._design_dir(parts[2])
            if not d or not (d / "design.json").is_file():
                return self._err(404, "Design not found")
            if parts[3] == "meta":
                m = dict(design_meta(parts[2]) or {}); m["conflicts"] = design_conflicts(parts[2])
                return self._send(200, m)
            if parts[3] == "lock":
                return self._send(200, {"lock": lock_read(parts[2]), "user": who()})
            return self._send(200, {"events": read_activity(parts[2])})
        if path == "/api/providers":
            return self._send(200, providers_view())
        if path == "/api/templates":
            return self._send(200, tpl_view())
        if len(parts) == 3 and parts[:2] == ["api", "templates"]:
            t = tpl_read(parts[2])
            return self._send(200, {"id": parts[2], "content": t}) if t is not None else self._err(404, "Template not found")
        if path == "/api/connections":
            return self._send(200, {"connections": [conn_public(c) for c in load_conns()], "file": str(conn_file()), "configDir": str(config_dir())})
        if path == "/api/designs":
            out = []
            if DATA.exists():
                for d in sorted(DATA.iterdir()):
                    f = d / "design.json"
                    if f.is_file():
                        obj, fixed, err = read_design_file(f)
                        if obj is not None:
                            if fixed:
                                obj["repaired"] = True
                            obj["id"] = d.name
                            if folder_from_name(obj.get("name") or "") != d.name:
                                obj["name"] = d.name  # the folder was renamed outside the tool
                            out.append(obj)
                        else:
                            out.append({"id": d.name, "name": d.name, "damaged": True, "error": err, "sources": [], "updated": int(f.stat().st_mtime * 1000)})
            return self._send(200, out)
        if len(parts) == 3 and parts[:2] == ["api", "designs"]:
            d = self._design_dir(parts[2])
            f = d / "design.json" if d else None
            if not f or not f.is_file():
                return self._err(404, "Design not found")
            obj, fixed, err = read_design_file(f)
            if obj is None:
                return self._err(422, "design.json cannot be read: %s. Keep a copy of the file and restore an earlier version from OneDrive version history." % err)
            obj["id"] = d.name
            if folder_from_name(obj.get("name") or "") != d.name:
                obj["name"] = d.name
            return self._send(200, obj)
        if len(parts) >= 5 and parts[:2] == ["api", "designs"] and parts[3] == "artifact":
            return self._artifact_get(parts[2], parts[4:])
        if len(parts) == 4 and parts[:2] == ["api", "designs"] and parts[3] == "tree":
            return self._tree(parts[2])
        if len(parts) == 3 and parts[0] == "files":
            return self._file(parts[1], parts[2])
        return self._static(path)

    def do_PUT(self):
        if not self._guard():
            return
        parts = self._split(urlparse(self.path).path)
        if parts == ["api", "settings"]:
            try:
                return self._send(200, apply_settings(json.loads(self._body() or b"")))
            except ValueError as exc:
                return self._err(400, str(exc))
            except Exception as exc:
                return self._err(400, "Could not save the settings: %s" % str(exc)[:200])
        if len(parts) == 4 and parts[:2] == ["api", "designs"] and parts[3] == "lock":
            d = self._design_dir(parts[2])
            if not d or not (d / "design.json").is_file():
                return self._err(404, "Design not found")
            try:
                doc = json.loads(self._body() or b"{}")
            except Exception:
                return self._err(400, "Invalid JSON")
            sess = str(doc.get("session") or "")[:60]
            if not sess:
                return self._err(400, "No session")
            ok, j = lock_put(parts[2], sess, bool(doc.get("takeOver")))
            return self._send(200 if ok else 409, {"lock": j, "user": who(), "ok": ok})
        if parts == ["api", "templates", "defaults"]:
            try:
                dd = json.loads(self._body() or b"").get("defaults") or {}
                d = tpl_index()
                ids = {t["id"]: t["type"] for t in d["templates"]}
                d["defaults"] = {k: v for k, v in dd.items() if k in TPL_TYPES and ids.get(v) == k}
                tpl_save_index(d)
            except Exception as exc:
                return self._err(400, "Invalid defaults: %s" % str(exc)[:200])
            return self._send(200, tpl_view())
        if len(parts) == 3 and parts[:2] == ["api", "templates"]:
            try:
                doc = json.loads(self._body() or b"")
                tpl_put(parts[2], str(doc.get("name") or parts[2]).strip(), str(doc.get("type") or ""), str(doc.get("content") or ""))
            except Exception as exc:
                return self._err(400, str(exc)[:200])
            return self._send(200, tpl_view())
        if parts == ["api", "providers"]:
            try:
                save_providers(json.loads(self._body() or b""))
            except Exception as exc:
                return self._err(400, "Invalid providers: %s" % str(exc)[:200])
            return self._send(200, providers_view())
        if parts == ["api", "connections"]:
            try:
                doc = json.loads(self._body() or b"")
            except Exception:
                return self._err(400, "Invalid JSON")
            return self._send(200, {"connections": [conn_public(c) for c in save_conns(doc.get("connections"))]})
        if len(parts) == 3 and parts[:2] == ["api", "designs"]:
            d = self._design_dir(parts[2])
            raw = self._body()
            if not d or raw is None:
                return self._err(400, "Bad request")
            try:
                doc = json.loads(raw)
                if doc.get("id") != parts[2]:
                    return self._err(400, "Design id mismatch")
            except Exception:
                return self._err(400, "Invalid JSON")
            if not d.is_dir():
                return self._err(404, "This design does not exist yet. Create it first.")
            import time as _t
            cur = design_meta(parts[2]); base = int(doc.get("rev") or 0)
            if cur and cur["rev"] != base and self.headers.get("X-Force") != "1":
                return self._send(409, {"error": "This design was saved by %s at %s after you opened it." % (cur["savedBy"] or "someone else", _t.strftime("%Y-%m-%d %H:%M", _t.localtime((cur["savedAt"] or 0) / 1000))), "current": cur})
            doc["rev"] = (cur["rev"] if cur else 0) + 1; doc["savedBy"] = who(); doc["savedAt"] = int(_t.time() * 1000)
            f = d / "design.json"
            atomic_write(f, json.dumps(doc, indent=2))
            _REV[parts[2]] = (f.stat().st_mtime_ns, doc["rev"], doc["savedBy"], doc["savedAt"])
            if not cur or (doc["savedAt"] - (cur["savedAt"] or 0)) > 300000 or cur["savedBy"] != doc["savedBy"]:
                log_activity(parts[2], "saved", "revision %d" % doc["rev"])
            return self._send(200, {"ok": True, "rev": doc["rev"], "savedBy": doc["savedBy"], "savedAt": doc["savedAt"]})
        if len(parts) >= 5 and parts[:2] == ["api", "designs"] and parts[3] == "artifact":
            f, raw, dd = self._artifact_path(parts[2], parts[4:]), self._body(), self._design_dir(parts[2])
            if not f or raw is None or not dd or not dd.is_dir():
                return self._err(400, "Bad request, unknown step folder, or file too large")
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(raw)
            return self._send(200, {"ok": True, "size": len(raw), "mtime": int(f.stat().st_mtime * 1000)})
        if len(parts) == 5 and parts[:2] == ["api", "designs"] and parts[3] == "sources":
            d, name, raw = self._design_dir(parts[2]), safe_name(parts[4]), self._body()
            if not d or not name or raw is None:
                return self._err(400, "Bad request or file too large")
            (d / SRC).mkdir(parents=True, exist_ok=True)
            (d / SRC / name).write_bytes(raw)
            return self._send(200, {"ok": True, "size": len(raw), "url": "/files/%s/%s" % (quote(parts[2]), parts[4])})
        return self._err(404, "Not found")

    def _step_archive(self, did, folder, action):
        """Reset safety: a reset moves a step folder into _reset-archive/<tag>/ instead of deleting it; a restore copies it back.
        Nothing in _reset-archive is ever removed by the app."""
        d = self._design_dir(did)
        try:
            tag = str((json.loads(self._body() or b"{}") or {}).get("tag") or "")
        except Exception:
            tag = ""
        if not d or not d.is_dir() or folder not in STEP_DIRS or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,79}", tag):
            return self._err(400, "Bad request")
        base, arch = d / folder, d / "_reset-archive" / tag / folder
        if action == "archive":
            if base.is_dir() and base.resolve().parent == d.resolve():
                if arch.exists():
                    return self._err(409, "This reset is already archived")
                arch.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(base), str(arch))
                log_activity(did, "reset-archived", "%s as %s" % (folder, tag))
            return self._send(200, {"ok": True})
        if not arch.is_dir():
            return self._send(200, {"ok": True, "restored": False})
        if base.is_dir():  # what is there now is kept too, never overwritten
            aside = d / "_reset-archive" / (tag + "-replaced-%d" % int(__import__("time").time())) / folder
            aside.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(base), str(aside))
        shutil.copytree(str(arch), str(base))
        log_activity(did, "reset-restored", "%s from %s" % (folder, tag))
        return self._send(200, {"ok": True, "restored": True})

    def _artifact_path(self, did, segs):
        d = self._design_dir(did)
        segs = [safe_name(x) for x in segs]
        if not d or not segs or None in segs or segs[0] not in STEP_DIRS or len(segs) < 2 or len(segs) > 4:
            return None
        f = d.joinpath(*segs).resolve()
        return long_path(f) if d.resolve() in f.parents else None

    def _artifact_get(self, did, segs):
        f = self._artifact_path(did, segs)
        if not f or not f.is_file():
            return self._err(404, "File not found")
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        if ctype in ("text/html", "image/svg+xml"):
            ctype = "text/plain; charset=utf-8"
        self._send(200, f.read_bytes(), ctype, {"Content-Security-Policy": "sandbox"})

    def _tree(self, did):
        d = self._design_dir(did)
        if not d or not d.is_dir():
            return self._err(404, "Design not found")
        out = []
        for step in sorted(STEP_DIRS):
            base = d / step
            if base.is_dir():
                for f in sorted(base.rglob("*")):
                    if f.is_file() and not any(p.startswith(".") for p in f.relative_to(d).parts):
                        st = f.stat()
                        out.append({"path": f.relative_to(d).as_posix(), "size": st.st_size, "mtime": int(st.st_mtime * 1000)})
        self._send(200, out)

    def do_POST(self):
        if not self._guard():
            return
        parts = self._split(urlparse(self.path).path)
        if len(parts) == 4 and parts[:2] == ["api", "ai-job"] and parts[3] == "cancel":
            return self._send(200, {"ok": True, "stopped": cancel_ai_job(parts[2])})
        if parts[:2] == ["api", "ai-job"] and len(parts) > 2:
            raw = self._body()
            if raw is None:
                return self._err(413, "Too much data for one AI call")
            return self._send(200, {"job": start_ai_job("/api/ai/" + "/".join(parts[2:]), raw)})
        if len(parts) == 6 and parts[:2] == ["api", "designs"] and parts[3] == "step" and parts[5] in ("archive", "restore"):
            return self._step_archive(parts[2], parts[4], parts[5])
        _CTX.provider, _CTX.step = "", ""
        if parts[:2] == ["api", "ai"] and len(parts) > 2:
            _CTX.step = parts[2]
            try:
                _CTX.provider = str((json.loads(self._body() or b"{}") or {}).get("provider") or "")
            except Exception:
                _CTX.provider = ""
        if len(parts) == 4 and parts[:2] == ["api", "connections"] and parts[3] == "ask":
            _CTX.step = "ask"
        if len(parts) == 4 and parts[:2] == ["api", "providers"] and parts[3] in ("test", "models"):
            try:
                return self._send(200, provider_test(parts[2]) if parts[3] == "test" else {"models": provider_models(parts[2])})
            except AIError as exc:
                return self._err(exc.code, exc.msg)
        if parts == ["api", "mermaid", "install"]:
            import urllib.request
            url = "https://cdn.jsdelivr.net/npm/mermaid@11.4.0/dist/mermaid.min.js"
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "dochub/1.0"})
                with urllib.request.urlopen(req, timeout=90) as r:
                    data = r.read(8 * 1024 * 1024)
            except Exception as exc:
                return self._err(502, "The Mermaid library could not be downloaded by the helper: %s" % str(exc)[:200])
            if len(data) < 300000 or b"mermaid" not in data[:200000].lower():
                return self._err(502, "The download did not look like the Mermaid library (%d bytes)." % len(data))
            (WEB / "mermaid.min.js").write_bytes(data)
            return self._send(200, {"ok": True, "bytes": len(data)})
        if parts == ["api", "pick-folder"]:
            try:
                doc = json.loads(self._body() or b"{}")
                path = pick_folder(str(doc.get("start") or ""))
            except RuntimeError as exc:
                return self._err(501, str(exc))
            except Exception as exc:
                return self._err(500, "The folder dialog failed: %s" % str(exc)[:160])
            return self._send(200, {"path": path})
        if parts == ["api", "designs"]:
            try:
                doc = json.loads(self._body() or b"{}")
            except Exception:
                return self._err(400, "Invalid JSON")
            name = re.sub(r"\s+", " ", str(doc.get("name") or "").strip())[:120] or "Untitled design"
            folder = folder_from_name(name)
            if name_taken(folder):
                return self._err(409, 'A design named "%s" already exists. Design names must be different.' % folder)
            DATA.mkdir(parents=True, exist_ok=True)
            try:
                (DATA / folder).mkdir()
            except FileExistsError:
                return self._err(409, 'A design named "%s" already exists. Design names must be different.' % folder)
            return self._send(200, {"id": folder, "name": name if folder_from_name(name) == folder else folder})
        if len(parts) == 4 and parts[:2] == ["api", "designs"] and parts[3] == "rename":
            d = self._design_dir(parts[2])
            if not d or not (d / "design.json").is_file():
                return self._err(404, "Design not found")
            try:
                doc = json.loads(self._body() or b"{}")
            except Exception:
                return self._err(400, "Invalid JSON")
            name = re.sub(r"\s+", " ", str(doc.get("name") or "").strip())[:120]
            if not name:
                return self._err(400, "Give the design a name")
            folder = folder_from_name(name)
            if folder != d.name and name_taken(folder, d.name):
                return self._err(409, 'A design named "%s" already exists. Design names must be different.' % folder)
            if folder != d.name:
                try:
                    os.rename(str(d), str(DATA / folder))
                except Exception as exc:
                    return self._err(500, "The folder could not be renamed: %s" % str(exc)[:160])
            fix_design_ids(DATA / folder, d.name, folder, name=name)
            if folder != d.name:
                log_activity(folder, "renamed", "from %s" % d.name)
            return self._send(200, {"id": folder, "name": name})
        if len(parts) == 4 and parts[:2] == ["api", "designs"] and parts[3] == "reveal":
            d = self._design_dir(parts[2])
            if not d or not d.is_dir():
                return self._err(404, "Design not found")
            try:
                if sys.platform == "darwin":
                    subprocess.Popen(["open", str(d)])
                elif sys.platform.startswith("win"):
                    subprocess.Popen(["explorer", str(d)])
                else:
                    subprocess.Popen(["xdg-open", str(d)])
            except Exception as exc:
                return self._err(500, "The folder could not be opened: %s" % str(exc)[:160])
            return self._send(200, {"ok": True, "path": str(d)})
        if len(parts) == 4 and parts[:2] == ["api", "designs"] and parts[3] == "activity":
            try:
                doc = json.loads(self._body() or b"{}")
            except Exception:
                return self._err(400, "Invalid JSON")
            log_activity(parts[2], doc.get("event") or "event", doc.get("detail") or "")
            return self._send(200, {"ok": True})
        if parts == ["api", "markitdown", "install"]:
            ok, log = install_markitdown()
            return self._send(200 if ok else 500, {"ok": ok, "engine": engine(), "log": log} if ok else {"ok": False, "error": log or "The installation failed"})
        if parts == ["api", "connections", "test"]:
            try:
                doc = json.loads(self._body() or b"")
            except Exception:
                return self._err(400, "Invalid JSON")
            url = str(doc.get("url") or "").strip()
            if not public_https(url):
                return self._err(400, "Use an https:// address that is reachable on the internet")
            try:
                if doc.get("type") == "site":
                    return self._send(200, {"ok": True, "site": site_probe(url)})
                return self._send(200, {"ok": True, "tools": mcp_probe({"type": "http", "url": url})})
            except Exception as exc:
                return self._err(502, "Could not connect: %s" % str(exc)[:300])
        if len(parts) == 4 and parts[:2] == ["api", "connections"] and parts[3] == "ask":
            c = next((x for x in load_conns() if x["id"] == parts[2]), None)
            if not c:
                return self._err(404, "Connection not found")
            kind = "documentation website" if c.get("type") == "site" else "MCP documentation server"
            q = ("This is a test of access to one documentation source: the %s '%s' (%s). Use it, do not answer from memory. "
                 "Find the official page that best introduces what this documentation covers and answer in at most two short sentences, then give the exact link of the page you read as a Markdown link. "
                 "If you cannot reach the source, say exactly what failed.") % (kind, c.get("name") or c["id"], c.get("url") or c.get("command") or "")
            try:
                text = ai_text("You are checking that a documentation connection works.", q, [c["id"]])
                text, checked, dead = verify_links(text, conn_hosts([c["id"]]))
                return self._send(200, {"ok": True, "answer": text[:1500], "links": {"checked": checked, "notFound": dead}, "meta": getattr(_LAST, "meta", {})})
            except AIError as exc:
                return self._err(exc.code, exc.msg)
        if len(parts) == 4 and parts[:2] == ["api", "connections"] and parts[3] == "approve":
            c = next((x for x in load_conns() if x["id"] == parts[2]), None)
            if not c or c.get("type") != "stdio":
                return self._err(404, "Local program not found")
            sec = local_secrets(); h = stdio_hash(c)
            if h not in sec["approved"]:
                sec["approved"].append(h); save_local_secrets(sec)
            return self._send(200, {"ok": True})
        if len(parts) == 4 and parts[:2] == ["api", "connections"] and parts[3] == "test":
            c = next((x for x in load_conns() if x["id"] == parts[2]), None)
            if not c:
                return self._err(404, "Connection not found")
            try:
                if c.get("type") == "site":
                    return self._send(200, {"ok": True, "site": site_probe(str(c.get("url", "")))})
                return self._send(200, {"ok": True, "tools": mcp_probe(c)})
            except Exception as exc:
                return self._err(502, "Could not connect: %s" % str(exc)[:300])
        if parts in (["api", "folder", "check"], ["api", "folder", "write"], ["api", "folder", "read"]):
            try:
                doc = json.loads(self._body() or b"")
            except Exception:
                return self._err(400, "Invalid JSON")
            d = folder_ok(doc.get("dir"))
            if not d:
                return self._err(400, "The folder must be an absolute path inside your home folder, and not inside the tool's own folder")
            op = parts[2]
            if op == "write":
                files = doc.get("files")
                if not isinstance(files, dict) or not files or len(files) > FOLDER_MAX_FILES:
                    return self._err(400, "No files to write, or too many")
                for rel in files:
                    if not folder_rel(rel):
                        return self._err(400, "Bad file path: %s" % str(rel)[:80])
                d.mkdir(parents=True, exist_ok=True)
                wrote, same = [], 0
                for rel, val in files.items():
                    segs = folder_rel(rel)
                    if not segs or not isinstance(val, dict):
                        return self._err(400, "Bad file path: %s" % str(rel)[:80])
                    f = d.joinpath(*segs).resolve()
                    if d not in f.parents:
                        return self._err(400, "Bad file path")
                    try:
                        raw = base64.b64decode(val["b64"]) if "b64" in val else str(val.get("text", "")).encode("utf-8")
                    except Exception:
                        return self._err(400, "Bad file content: %s" % rel)
                    if f.is_file() and f.read_bytes() == raw:
                        same += 1
                        continue
                    f.parent.mkdir(parents=True, exist_ok=True)
                    f.write_bytes(raw)
                    wrote.append(rel)
                return self._send(200, {"ok": True, "written": wrote, "unchanged": same})
            if not d.is_dir():
                return self._send(200, {"ok": True, "exists": False, "files": []})
            out = []
            for f in sorted(d.rglob("*")):
                rel = f.relative_to(d).parts
                if not f.is_file() or len(rel) > 5 or any(x.startswith(".") for x in rel) or f.suffix.lower() not in FOLDER_EXT:
                    continue
                if len(out) >= FOLDER_MAX_FILES:
                    break
                st = f.stat()
                item = {"path": "/".join(rel), "size": st.st_size, "mtime": int(st.st_mtime * 1000)}
                if op == "read" and st.st_size <= 8 * 1024 * 1024:
                    raw = f.read_bytes()
                    if f.suffix.lower() == ".xlsx":
                        item["b64"] = base64.b64encode(raw).decode()
                    else:
                        item["text"] = raw.decode("utf-8", "replace")
                out.append(item)
            return self._send(200, {"ok": True, "exists": True, "writable": os.access(d, os.W_OK), "files": out})
        if len(parts) == 5 and parts[:2] == ["api", "designs"] and parts[3] == "convert":
            d, name = self._design_dir(parts[2]), safe_name(parts[4])
            f = d / SRC / name if d and name else None
            if not f or not f.is_file():
                return self._err(404, "Source file not found")
            errors = []
            if mcp_spec():
                try:
                    return self._send(200, {"markdown": mcp_convert(f), "engine": "MarkItDown MCP"})
                except Exception as exc:
                    errors.append("MCP: %s" % exc)
            if _MD is not None:
                try:
                    return self._send(200, {"markdown": _MD.convert(str(f)).text_content, "engine": "MarkItDown (Python)"})
                except Exception as exc:
                    errors.append("Python: %s" % exc)
            else:
                errors.append('MarkItDown is not installed. Press "Install MarkItDown" on the Source files panel (one time, no admin rights needed)')
            return self._err(422 if mcp_spec() or _MD is not None else 501, "MarkItDown could not convert this file. " + "; ".join(errors))
        if parts == ["api", "ai", "analyze-payloads"]:
            try:
                doc = json.loads(self._body() or b"")
            except Exception:
                return self._err(400, "Invalid JSON")
            mode = doc.get("mode")
            if mode not in ("mismatch", "review", "match", "er", "reqs"):
                return self._err(400, "Unknown mode")
            body = json.dumps(doc.get("input") or {}, indent=1)
            if len(body) > PRD_MAX_CHARS:
                return self._err(413, "Too much data for one AI call. Try fewer scenarios.")
            try:
                if mode == "reqs":
                    res = ai_call(REQ_SYSTEM, "<input>\n%s\n</input>" % body, REQ_TOOL)
                    return self._send(200, {"results": res.get("results", [])})
                if mode == "er":
                    res = ai_call(ER_SYSTEM, "<input>\n%s\n</input>" % body, ER_TOOL)
                    m = str(res.get("mermaid") or "").strip()
                    m = re.sub(r"^```(?:mermaid)?\s*|\s*```$", "", m).strip()
                    return self._send(200, {"mermaid": m})
                if mode == "match":
                    res = ai_call(MATCH_SYSTEM, "<input>\n%s\n</input>" % body, MATCH_TOOL)
                    return self._send(200, {"matches": res.get("matches", [])})
                if mode == "mismatch":
                    res = ai_call(ANALYSIS_SYSTEM, "<input>\n%s\n</input>" % body, ANALYSIS_TOOL)
                    return self._send(200, {"mismatches": res.get("mismatches", [])})
                res = ai_call(REVIEW_SYSTEM, "<input>\n%s\n</input>" % body, REVIEW_TOOL)
                return self._send(200, {"matrixIssues": res.get("matrixIssues", []), "missingScenarios": res.get("missingScenarios", [])})
            except AIError as exc:
                return self._err(exc.code, exc.msg)
        if parts == ["api", "ai", "gen-prd"] or parts == ["api", "ai", "compose-doc"]:
            try:
                doc = json.loads(self._body() or b"")
            except Exception:
                return self._err(400, "Invalid JSON")
            try:
                if parts[2] == "gen-prd":
                    srcs = [x for x in (doc.get("sources") or []) if isinstance(x, dict) and str(x.get("md") or "").strip()]
                    if not srcs:
                        return self._err(400, "There are no source documents to read")
                    body = "\n\n".join("<source_document name=\"%s\">\n%s\n</source_document>" % (str(x.get("name") or "")[:120].replace('"', "'"), str(x["md"])) for x in srcs)
                    if len(body) > PRD_MAX_CHARS:
                        return self._err(413, "The source documents are too long for one AI call (%d characters)" % len(body))
                    user = "Project: %s\n\n%s%s" % (str(doc.get("name") or "")[:120], body, tpl_block(doc.get("template"), "prd"))
                    md = ai_text(GEN_PRD_SYSTEM, user)
                    if len(md) < 200:
                        return self._err(502, "The AI returned no PRD. Try again.")
                    return self._send(200, {"markdown": md, "model": model_label(), "template": (doc.get("template") or {}).get("name") if isinstance(doc.get("template"), dict) else ""})
                draft = str(doc.get("draft") or "")
                tb = tpl_block(doc.get("template"), str(doc.get("kind") or ""))
                if not draft.strip() or not tb:
                    return self._err(400, "A draft and a template are both needed")
                if len(draft) + len(tb) > PRD_MAX_CHARS:
                    return self._err(413, "The document is too long for one AI call")
                md = ai_text(COMPOSE_SYSTEM, "<draft_document>\n%s\n</draft_document>%s" % (draft, tb))
                if len(md) < 100:
                    return self._err(502, "The AI returned no document. Try again.")
                return self._send(200, {"markdown": md, "model": model_label()})
            except AIError as exc:
                return self._err(exc.code, exc.msg)
        if parts == ["api", "ai", "refine-test"] or parts == ["api", "ai", "build-plan"]:
            try:
                doc = json.loads(self._body() or b"")
            except Exception:
                return self._err(400, "Invalid JSON")
            body = json.dumps(doc.get("input") or {}, indent=1)
            if len(body) > PRD_MAX_CHARS:
                return self._err(413, "Too much data for one AI call")
            try:
                if parts[2] == "refine-test":
                    ins = str(doc.get("instruction") or "").strip()
                    if not ins:
                        return self._err(400, "Describe the change first")
                    res = ai_call(REFINE_SYSTEM, "<input>\n%s\n</input>\n\n<instruction>\n%s\n</instruction>" % (body, ins), REFINE_TOOL)
                    return self._send(200, {"test": res.get("test") or {}, "notes": res.get("notes") or [], "model": model_label()})
                res = ai_call(BUILD_SYSTEM, "<input>\n%s\n</input>" % body, BUILD_TOOL)
                return self._send(200, {"modules": res.get("modules") or [], "tasks": res.get("tasks") or [], "model": model_label()})
            except AIError as exc:
                return self._err(exc.code, exc.msg)
        if parts == ["api", "ai", "fill-scenarios"]:
            try:
                doc = json.loads(self._body() or b"")
            except Exception:
                return self._err(400, "Invalid JSON")
            scn, reqs = doc.get("scenarios"), doc.get("requirements") or []
            if not isinstance(scn, list) or not scn:
                return self._err(400, "No scenarios were given")
            body = json.dumps({"requirements": reqs, "scenarios": scn}, indent=1)
            if len(body) > PRD_MAX_CHARS:
                return self._err(413, "Too much data for one AI call (%d characters). Try again; if it keeps failing, import fewer payloads." % len(body))
            try:
                res = ai_call(FILL_SYSTEM, "<input>\n%s\n</input>" % body, FILL_TOOL)
                return self._send(200, {"results": res.get("results", []), "model": model_label()})
            except AIError as exc:
                return self._err(exc.code, exc.msg)
        if parts == ["api", "ai", "update-doc"]:
            try:
                doc = json.loads(self._body() or b"")
            except Exception:
                return self._err(400, "Invalid JSON")
            kind, text, ins, ctx = doc.get("kind"), str(doc.get("document") or ""), str(doc.get("instruction") or "").strip(), str(doc.get("context") or "")
            conns = [str(x) for x in (doc.get("connections") or []) if isinstance(x, str)][:8]
            if kind not in UPDATE_KIND:
                return self._err(400, "Unknown document kind")
            if not text.strip() or not ins:
                return self._err(400, "The document and the instruction are both needed")
            if len(text) + len(ctx) > PRD_MAX_CHARS:
                return self._err(413, "The documents are too long for one AI call")
            try:
                ctx, trimmed = fit_ctx(ctx, len(text) * 2 + len(ins) + len(UPDATE_SYSTEM) + len(UPDATE_KIND[kind]) + 600)  # the document is read once and written once
                user = "%s\n\n<document>\n%s\n</document>" % (UPDATE_KIND[kind], text)
                if ctx:
                    user += "\n\n<background_documents>\n%s\n</background_documents>" % ctx
                user += "\n\n<instruction>\n%s\n</instruction>" % ins
                out = ai_text(UPDATE_SYSTEM, user + "\n\nReply with a line ===NOTES===, one '- ' line per change, a line ===DOCUMENT===, then the COMPLETE updated document (every section, not only the changed part).", conns)
                parsed = parse_update_answer(out, text)
                if not parsed:
                    # smaller models often ignore the marker format: ask once more for the document alone
                    out2 = ai_text(UPDATE_SYSTEM_PLAIN, user, conns)
                    parsed = parse_update_answer(out2, text, plain=True)
                if not parsed:
                    return self._err(502, "The AI model did not return the updated document in the expected format (it may have stopped early or answered with notes only). Nothing was changed. Try again, or pick a more capable model for 'Update with a prompt' in AI models.")
                notes, body = parsed
                if not body.strip():
                    return self._err(502, "The AI model returned an empty document. Nothing was changed.")
                return self._send(200, {"markdown": body, "notes": notes, "model": model_label()})
            except AIError as exc:
                return self._err(exc.code, exc.msg)
        if parts == ["api", "ai", "arch-assess"] or parts == ["api", "ai", "gen-arch"] or parts == ["api", "ai", "arch-options"] or parts == ["api", "ai", "arch-review"]:
            try:
                doc = json.loads(self._body() or b"")
            except Exception:
                return self._err(400, "Invalid JSON")
            ctx = str(doc.get("context") or "")
            conns = [str(x) for x in (doc.get("connections") or []) if isinstance(x, str)][:8]
            if not ctx.strip():
                return self._err(400, "No project documents were given")
            if len(ctx) > PRD_MAX_CHARS:
                return self._err(413, "The project documents are too long for one AI call (%d characters)" % len(ctx))
            try:
                tpl = doc.get("template") if isinstance(doc.get("template"), dict) else {}
                other = 6000 + len(str(doc.get("design") or "")) + len(str(doc.get("decisions") or "")[:20000]) + len(str(doc.get("open") or "")) + len(str(tpl.get("content") or "")[:60000])
                ctx, trimmed = fit_ctx(ctx, other, 14000 if parts[2] == "gen-arch" else 6000)  # local models: shorten the background so the whole call fits
                if parts[2] == "arch-assess":
                    res = ai_call(ASSESS_SYSTEM, "<project_documents>\n%s\n</project_documents>" % ctx, ASSESS_TOOL, 0, conns)
                    return self._send(200, {"assessment": res, "model": model_label(), "trimmed": trimmed})
                if parts[2] == "arch-review":
                    design = str(doc.get("design") or "")
                    if not design.strip():
                        return self._err(400, "There is no design to review")
                    if len(ctx) + len(design) > PRD_MAX_CHARS:
                        return self._err(413, "The project documents and the design are too long for one AI call")
                    user = "<project_documents>\n%s\n</project_documents>\n\n<design_document>\n%s\n</design_document>" % (ctx, design)
                    if str(doc.get("decisions") or "").strip():
                        user += "\n\n<decisions_made_by_the_user>\n%s\n</decisions_made_by_the_user>" % str(doc["decisions"])[:20000]
                    res = ai_call(ARCH_REVIEW_SYSTEM, user, ARCH_REVIEW_TOOL, 0, conns)
                    return self._send(200, {"review": res, "model": model_label(), "trimmed": trimmed})
                if parts[2] == "arch-options":
                    known = str(doc.get("decisions") or "")[:12000]
                    user = "<project_documents>\n%s\n</project_documents>" % ctx
                    if known.strip():
                        user += "\n\n<decisions_already_in_the_design>\n%s\n</decisions_already_in_the_design>" % known
                    res = ai_call(OPTIONS_SYSTEM, user, OPTIONS_TOOL, 0, conns)
                    return self._send(200, {"options": res.get("options", []), "model": model_label(), "trimmed": trimmed})
                extra = ""
                if doc.get("decisions"):
                    extra += "\n\n<decisions_made_by_the_user>\n%s\n</decisions_made_by_the_user>" % str(doc["decisions"])
                if doc.get("open"):
                    extra += "\n\n<items_not_yet_confirmed>\n%s\n</items_not_yet_confirmed>" % str(doc["open"])
                tb = tpl_block(doc.get("template"), "architecture")
                if tb:
                    extra += tb + "\n\nTEMPLATE: use this template's sections, order, field names and tables instead of the numbered section list above. Keep every other rule (decisions are binding, unconfirmed items under open items, Mermaid rules, Sources table, concise style). Leave out the template's guidance text. The three required diagrams (high-level architecture, ER diagram with the SSoT table, swimlane activity diagram per process, all with the light theme line) are mandatory too: place each in the template section where it fits best."
                md = ai_text(GEN_ARCH_SYSTEM, "<project_documents>\n%s\n</project_documents>%s" % (ctx, extra), conns)
                if len(md) < 200:
                    return self._err(502, "The AI model returned no design document. Try again.")
                md, checked, dead = verify_links(md, conn_hosts(conns))
                return self._send(200, {"markdown": md, "model": model_label(), "links": {"checked": checked, "notFound": dead}, "trimmed": trimmed})
            except AIError as exc:
                return self._err(exc.code, exc.msg)
        if parts == ["api", "ai", "analyze-prd"] or parts == ["api", "ai", "gen-scenarios"] or parts == ["api", "ai", "scenario-plan"]:
            raw = self._body()
            try:
                doc = json.loads(raw or b"")
            except Exception:
                return self._err(400, "Invalid JSON")
            prd = str(doc.get("prd") or "")
            if not prd.strip():
                return self._err(400, "The requirement document is empty")
            if len(prd) > PRD_MAX_CHARS:
                return self._err(413, "The requirement document is too long for one AI call (%d characters)" % len(prd))
            try:
                if parts[2] == "analyze-prd":
                    res = ai_call(ANALYZE_SYSTEM, "Review this requirement document.\n\n<document>\n%s\n</document>" % prd, ISSUE_TOOL, 8000)
                    return self._send(200, {"issues": res.get("issues", []), "model": model_label()})
                reqs = [r for r in (doc.get("reqs") or []) if isinstance(r, dict) and r.get("id")]
                if not reqs:
                    return self._err(400, "No requirements were given")
                if parts[2] == "scenario-plan":
                    lst = "\n".join("- %s: %s" % (r["id"], str(r.get("text", "")).replace("\n", " ")[:300]) for r in reqs)
                    res = ai_call(PLAN_SYSTEM, "<document>\n%s\n</document>\n\nRequirements:\n%s" % (prd, lst), PLAN_TOOL, 8000)
                    return self._send(200, {"categories": res.get("categories", []), "channels": res.get("channels", []), "groups": res.get("groups", []), "model": model_label()})
                listing = "\n".join("- %s: %s" % (r["id"], str(r.get("text", "")).replace("\n", " ")) for r in reqs)
                known = str(doc.get("known") or "")
                fixed = str(doc.get("category") or "").strip()
                chans = [str(c).strip() for c in (doc.get("channels") or []) if str(c).strip()][:12]
                extra = ("\nFixed category for every scenario: %s" % fixed if fixed else "") + ("\nAllowed channels: %s, All" % ", ".join(chans) if chans else "")
                try:
                    low = max(1, min(40, int(doc.get("maxLow") or 0)))
                except Exception:
                    low = max(1, (len(reqs) + 3) // 4)
                extra += "\nNo limit on P0 and P1 scenarios. P2 and P3 scenarios together: at most %d." % low
                msg = "<document>\n%s\n</document>\n\nDesign scenarios for these requirements only:\n%s\n%s%s" % (prd, listing, ("\nScenarios already designed (do not repeat them):\n" + known) if known else "", extra)
                res = ai_call(SCEN_SYSTEM, msg, SCENARIO_TOOL, 12000)
                return self._send(200, {"scenarios": res.get("scenarios", []), "model": model_label()})
            except AIError as exc:
                return self._err(exc.code, exc.msg)
        return self._err(404, "Not found")

    def do_DELETE(self):
        if not self._guard():
            return
        parts = self._split(urlparse(self.path).path)
        if len(parts) == 3 and parts[:2] == ["api", "templates"]:
            if TPL_ID_RE.match(parts[2]):
                tpl_delete(parts[2])
            return self._send(200, tpl_view())
        if len(parts) == 4 and parts[:2] == ["api", "designs"] and parts[3] == "lock":
            d = self._design_dir(parts[2])
            cur = lock_read(parts[2]) if d else None
            sess = (self.headers.get("X-Session") or "")[:60]
            if cur and cur.get("session") == sess:
                try:
                    (d / LOCK_NAME).unlink()
                    log_activity(parts[2], "closed", "")
                except Exception:
                    pass
            return self._send(200, {"ok": True})
        if len(parts) == 3 and parts[:2] == ["api", "designs"]:
            d = self._design_dir(parts[2])
            if d and d.is_dir() and d.resolve().parent == DATA.resolve():
                shutil.rmtree(d)
            return self._send(200, {"ok": True})
        if len(parts) == 5 and parts[:2] == ["api", "designs"] and parts[3] == "sources":
            d, name = self._design_dir(parts[2]), safe_name(parts[4])
            f = d / SRC / name if d and name else None
            if f and f.is_file():
                f.unlink()
            return self._send(200, {"ok": True})
        if len(parts) == 7 and parts[:2] == ["api", "designs"] and parts[3] == "artifact" and parts[4:6] == ["06-payload-library", "imported"]:
            f = self._artifact_path(parts[2], parts[4:])
            if f and f.is_file():
                f.unlink()
            return self._send(200, {"ok": True})
        if len(parts) == 5 and parts[:2] == ["api", "designs"] and parts[3] == "step":
            d = self._design_dir(parts[2])
            if not d or parts[4] not in STEP_DIRS:
                return self._err(400, "Unknown step folder")
            base = d / parts[4]
            if base.is_dir() and base.resolve().parent == d.resolve():
                shutil.rmtree(base)
            return self._send(200, {"ok": True})
        return self._err(404, "Not found")

    # ---------- files ----------
    def _file(self, did, name):
        d, name = self._design_dir(did), safe_name(name)
        f = d / SRC / name if d and name else None
        if not f or not f.is_file():
            return self._err(404, "File not found")
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        # Read-only viewing: HTML and SVG are shown as plain text so uploaded files cannot run scripts.
        if ctype in ("text/html", "image/svg+xml", "application/xhtml+xml"):
            ctype = "text/plain; charset=utf-8"
        self._send(200, f.read_bytes(), ctype, {"Content-Disposition": 'inline; filename="%s"' % f.name.replace('"', ""), "Content-Security-Policy": "sandbox"})

    def _static(self, path):
        rel = "index.html" if path in ("/", "") else path.lstrip("/")
        f = (WEB / rel).resolve()
        if WEB.resolve() not in f.parents or not f.is_file() or f.suffix.lower() not in STATIC or f.name == "design.json":
            return self._err(404, "Not found")
        if DATA.resolve() in f.parents:
            return self._err(404, "Not found")
        ctype = mimetypes.guess_type(f.name)[0] or "application/octet-stream"
        if f.suffix in (".html", ".css", ".js"):
            ctype += "; charset=utf-8"
        self._send(200, f.read_bytes(), ctype)


# ---------- AI calls run as background jobs: a slow local model can take longer than a browser waits for one answer ----------
_JOBS = {}
_JOBS_LOCK = threading.Lock()


class _JobShim(Handler):
    """Runs a normal POST handler in a thread and keeps its answer instead of writing it to a socket."""
    def _guard(self):
        return True

    def _send(self, code, body=b"", ctype="application/json", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        self.result = (code, body.decode("utf-8", "replace") if isinstance(body, bytes) else str(body))


def start_ai_job(path, raw):
    import time as _t, uuid, traceback
    import hashlib
    same = hashlib.sha1(path.encode() + b"\0" + raw).hexdigest()
    jid = uuid.uuid4().hex[:12]
    with _JOBS_LOCK:
        for k in [k for k, v in _JOBS.items() if v.get("done") and _t.time() - v["at"] > 6 * 3600]:
            _JOBS.pop(k, None)
        for k, v in _JOBS.items():  # the same request is already running (a double click, a reloaded page, another browser): join it, never pay for it twice
            if not v.get("done") and v.get("same") == same:
                return k
        _JOBS[jid] = {"done": False, "at": _t.time(), "same": same}

    def run():
        _CTX.job = jid
        sh = object.__new__(_JobShim)
        sh.path = path; sh._raw = raw; sh.headers = {}; sh.result = None
        try:
            sh.do_POST()
            code, body = sh.result or (500, json.dumps({"error": "The AI step returned nothing."}))
        except Exception as exc:  # a defect in the helper: show it instead of dropping the connection
            traceback.print_exc()
            code, body = 500, json.dumps({"error": "Unexpected error in the helper (%s: %s). See the server.py window for details." % (type(exc).__name__, str(exc)[:200])})
        with _JOBS_LOCK:
            if not (_JOBS[jid].get("done") and _JOBS[jid].get("cancel")):  # a stopped job keeps its "stopped" answer
                _JOBS[jid].update({"done": True, "code": code, "body": body, "at": _t.time()})
    threading.Thread(target=run, daemon=True).start()
    return jid




def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--data-dir", default=os.environ.get("DESIGN_DATA_DIR"), help="shared folder for designs (default ./designs)")
    args = ap.parse_args()
    global DATA, DATA_FROM_CLI
    if args.data_dir:
        DATA = Path(args.data_dir).expanduser().resolve(); DATA_FROM_CLI = True
    else:
        st0 = load_settings(); items0 = stored_instances(st0); aid0 = active_instance_id(st0, items0)
        inst0 = next((x for x in items0 if x["id"] == aid0), None)
        if inst0:
            if Path(inst0["path"]).expanduser().is_dir():
                DATA = Path(inst0["path"]).expanduser().resolve()
            else:
                print("The Document Repo '%s' (%s) was not found (is OneDrive running?). Using the local folder; choose another repo on the home page." % (inst0["name"], inst0["path"]))
    DATA.mkdir(parents=True, exist_ok=True)
    CA = setup_ca_certs()
    ensure_config()
    renamed = migrate_design_folders()
    if renamed:
        print("Renamed %d project folder%s to the design name." % (renamed, "" if renamed == 1 else "s"))
    for d in DATA.iterdir():  # migrate the earlier layout
        if (d / "sources").is_dir() and not (d / SRC).exists():
            (d / "sources").rename(d / SRC)
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    except OSError:
        print("Port %d is already in use, probably by an older copy of this server that is still running." % args.port)
        print("Close the other Terminal window running server.py (or run: pkill -f server.py), then start again.")
        sys.exit(1)
    print("DocHub: http://127.0.0.1:%d" % args.port)
    print("Designs folder:", DATA)
    print("AI:", (("local Claude CLI at " + AI_BIN) + ((", Microsoft Foundry resource " + FOUNDRY) if FOUNDRY else ", no Foundry settings found (.foundry.env)")) if ai_ready() else "not found (install Claude Code so `claude` is on the PATH)")
    print("MarkItDown:",{"mcp": "MCP server from config/markitdown.mcp.json", "python": "Python package"}.get(engine(), "not available"))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
