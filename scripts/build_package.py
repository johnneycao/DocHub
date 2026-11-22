#!/usr/bin/env python3
"""Build the release package: dist/dochub-<version>.zip

Usage:  python3 scripts/build_package.py [--version X.Y.Z]

The package holds the code and the documents, never your data: no designs, keys, settings,
installed dependencies or downloaded libraries. Run it from anywhere; it works on the project folder.
A GitHub Actions workflow can call this same script on a version tag later."""
import argparse, sys, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INCLUDE = ["src", "config", "doc", "tests", "scripts", "README.md", "LICENSE", "VERSION", "start.command", "start.bat", ".gitattributes"]
SKIP_DIRS = {"__pycache__", ".pytest_cache", "node_modules"}
SKIP_NAMES = {"providers.json", ".foundry.env", "mermaid.min.js", ".DS_Store", "Thumbs.db", "connections.json"}
SKIP_SUFFIX = {".pyc", ".env"}
EXEC = {"start.command"}  # keeps the Mac launcher runnable after unzip


def files():
    for name in INCLUDE:
        p = ROOT / name
        if p.is_file():
            yield p
        elif p.is_dir():
            for f in sorted(p.rglob("*")):
                if f.is_file() and not (set(f.relative_to(ROOT).parts) & SKIP_DIRS) and f.name not in SKIP_NAMES and f.suffix not in SKIP_SUFFIX:
                    yield f


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default=(ROOT / "VERSION").read_text("utf-8").strip() if (ROOT / "VERSION").is_file() else "dev")
    a = ap.parse_args()
    out = ROOT / "dist"
    out.mkdir(exist_ok=True)
    target = out / f"dochub-{a.version}.zip"
    top = f"dochub-{a.version}"
    n = 0
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files():
            rel = f.relative_to(ROOT).as_posix()
            info = zipfile.ZipInfo(f"{top}/{rel}", date_time=(2020, 1, 1, 0, 0, 0))
            info.external_attr = ((0o755 if rel in EXEC else 0o644) << 16)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, f.read_bytes())
            n += 1
    print(f"{target.relative_to(ROOT)}: {n} files, {target.stat().st_size // 1024} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
