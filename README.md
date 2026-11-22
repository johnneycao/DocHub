# DocHub

From Requirements to Architecture Design

Turns source requirements documents — team meeting notes, PRDs, specs, and other Word, PDF, PowerPoint, Excel or Markdown files — into one consolidated PRD, then requirements and scenarios, a test plan, payload analysis, an architecture design and a build plan, with AI steps you can stop and roll back.

## Quick start

| Step | Do |
| --- | --- |
| Mac | Double-click `start.command` |
| Windows | Double-click `start.bat` |
| Any system | `python3 src/server.py`, then open http://127.0.0.1:8765 |

Needs Python 3.10+ and either the Claude CLI or an OpenAI-compatible model (cloud or local Ollama). The first start of `start.command` / `start.bat` asks for your details.

## Folders

| Path | Holds |
| --- | --- |
| `src/` | Code: `server.py` (helper service), `web/` (the page), `templates/` (document templates) |
| `doc/` | Documentation: [user guide](doc/README.md), [PRD](doc/PRD.md), [design](doc/DESIGN.md), plans |
| `config/` | Shipped config and examples: `providers.example.json`, `foundry.env.example`, `markitdown.mcp.json` |
| `scripts/` | `build_package.py` builds `dist/dochub-<version>.zip` |
| `tests/` | Playwright check of every screen |
| `start.command`, `start.bat` | One-step launchers |
| `VERSION` | Version used by the package build and shown by `/api/health` |

Local files that are never committed: `designs/` (your projects), `providers.json` and `.foundry.env` (keys), `.pydeps/` (MarkItDown), `dist/`. See `.gitignore`.

## Package

`python3 scripts/build_package.py` writes `dist/dochub-<version>.zip` with code, config examples and docs only.

## More

User guide, AI models, Document Repo (OneDrive), security and troubleshooting: [doc/README.md](doc/README.md).
