# Contributing to DocHub

Thank you for considering a contribution! DocHub is a community project: turns source requirements documents (team meeting notes, PRDs, specs) into one consolidated PRD, then requirements, scenarios, a test plan, payload analysis, an architecture design and a build plan.

## Ways to contribute

- **Report a bug** — open an issue with steps to reproduce and expected vs actual behavior.
- **Request a feature** — open an issue describing the use case.
- **Fix a bug or add a feature** — submit a pull request (see below).

## Opening a pull request

1. **Fork** the repo and create a branch off `main`.
2. Make your change. Keep it focused — one logical change per PR.
3. If you changed code, run the existing tests (`python3 -m pytest tests/e2e.py`) and add tests for new behavior where practical.
4. Open a PR against `main`. Describe what you changed and why, and how to test it.

## Review process

- `main` is **protected**: it accepts changes only through pull requests.
- **The repository owner (`johnneycao`) is the sole code owner and must approve every PR** before it can merge.
- Expect review feedback. Address it and push updates to the same branch.

## Ground rules

- Keep it simple — prefer the smallest change that satisfies the requirement.
- Don't introduce unnecessary dependencies or platform-specific behavior unless it's clearly scoped.
- Keep secrets out: never commit keys, tokens, or `providers.json`. See `.gitignore`.
- Preserve the design language — the UI follows documented tokens and patterns (see `doc/DESIGN.md`).

## Licensing

By contributing, you agree your contributions are licensed under the same **MIT** license as the project.