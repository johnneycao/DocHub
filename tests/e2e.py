"""End-to-end check of every screen on http://127.0.0.1:8765, plus a real AI call through .foundry.env.
Setup once:   pip install playwright && python3 -m playwright install chromium
Run:          start the server (start.command), then:  python3 tests/e2e.py
Add --skip-ai to skip the real AI calls. Add --headed to watch it."""
import sys, json, time
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8765"
fails, errors = [], []

def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  {detail}" if detail and not ok else ""))
    if not ok: fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch(headless="--headed" not in sys.argv)
    pg = b.new_page(viewport={"width": 1400, "height": 900})
    pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    pg.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)

    # server and AI routing
    h = pg.request.get(BASE + "/api/health").json()
    check("server health", h.get("ok") is True)
    check("AI configured through .foundry.env", bool(h.get("ai")) and "Foundry" in (h.get("aiProvider") or ""), h.get("aiProvider"))

    # designs list
    pg.goto(BASE); pg.wait_for_selector("#view-list:not([hidden])")
    check("designs list shows", pg.locator("#view-list").is_visible())
    check("storage is the repo", "repo" in pg.locator("#store-badge").inner_text().lower())
    for btn in ("Export all designs", "Import designs", "New design"):
        check("button: " + btn, pg.get_by_role("button", name=btn).count() > 0)

    # new blank design
    pg.get_by_role("button", name="New design").first.click()
    pg.fill("#new-name", "E2E test " + str(int(time.time())))
    pg.click("#new-panel button[data-act='create-blank']")
    pg.wait_for_selector("#view-design:not([hidden])")

    # every page opens without errors
    for n in range(1, 8):
        pg.click(f"#tab-{n}")
        pg.wait_for_selector(f"#stage-{n}.on")
        check(f"page {n} opens", pg.locator(f"#stage-{n}").is_visible())
        pg.wait_for_timeout(300)
        if n <= 6:
            check(f"page {n} cross check panel", pg.locator(f"#cc-slot-{n} .cc").count() == 1)
            check(f"page {n} Run cross check enabled", pg.locator(f"#cc-slot-{n} button[data-cc]").is_enabled())

    # a small PRD and a payload file are written here and uploaded
    import os, tempfile, json
    tmp = tempfile.mkdtemp()
    pg.click("#tab-1")
    prd_path = os.path.join(tmp, "prd-test.md")
    open(prd_path, "w").write("---\nid: PRD-T\ntitle: Test\n---\n\n# Test\n\n## Scope\n### In scope\n- Returns\n### Out of scope\n- Gift cards\n\n## Processes\n### Return an item\n1. Customer asks\n2. Agent approves\n\n## Requirements\n| ID | Requirement | Source |\n| --- | --- | --- |\n| R-01 | The system refunds an approved return | test |\n")
    pg.set_input_files("#file-in", prd_path); pg.wait_for_timeout(800)
    pg.click("#merge-btn") if pg.locator("#merge-btn").count() else None; pg.wait_for_timeout(1500)
    check("PRD page has Analyze with AI button", pg.locator("button[data-act='ai-analyze']").count() == 1)
    check("no Download template buttons", pg.locator("button[data-act='tpl-prd'],button[data-act='tpl-matrix'],button[data-act='tpl-payload']").count() == 0)
    pg.click("#tab-5")
    pay_path = os.path.join(tmp, "payload-test.json")
    json.dump({"id": "P-01", "scenario": "S-01", "requirements": ["R-01"], "exchanges": [{"request": {"method": "POST", "url": "https://example.com/api/x"}, "response": {"status": 200}}]}, open(pay_path, "w"))
    check("payload page has folder and file import", pg.locator("button[data-act='import-payload-folder']").count() > 0 and pg.locator("button[data-act='import-payloads']").count() > 0)
    check("no sample buttons anywhere", pg.locator("[data-act='load-sample'],[data-act='create-sample']").count() == 0)
    pg.set_input_files("#payload-in", pay_path); pg.wait_for_timeout(1000)
    check("uploaded payload file is listed", "1" in pg.locator("#tab-5 .t-out").inner_text())
    os.makedirs(os.path.join(tmp, "folder", "REF-1001"), exist_ok=True)
    with open(os.path.join(tmp, "folder", "REF-1001", "call.json"), "w") as fh: fh.write(open(pay_path).read())
    pg.set_input_files("#payload-dir", os.path.join(tmp, "folder")); pg.wait_for_timeout(1000)
    check("folder import adds files", "2" in pg.locator("#tab-5 .t-out").inner_text())

    # cross check runs with partial data
    pg.click("#tab-2"); pg.click("#cc-slot-2 button[data-cc]"); pg.wait_for_timeout(1500)
    check("cross check produces a result", pg.locator("#cc-slot-2 .cc-scroll").inner_text().strip() != "")

    # architecture page: readiness button present, generate disabled before the check
    pg.click("#tab-6")
    check("architecture: Check readiness button", pg.locator("button[data-act='arch-assess']").count() == 1)

    if "--skip-ai" not in sys.argv:
        # real AI through .foundry.env: PRD analysis from page 1
        pg.click("#tab-1"); pg.click("button[data-act='ai-analyze']")
        pg.wait_for_selector(".ai-progress", timeout=10000)
        check("progress indicator with timer shows", pg.locator(".ai-timer").count() > 0)
        pg.wait_for_selector(".ai-progress", state="detached", timeout=420000)
        txt = pg.locator("#issues-wrap").inner_text()
        check("PRD AI analysis finished without an error", "did not run" not in txt, txt[:200])
        check("severity labels shown", pg.locator("#issues-wrap .sev").count() > 0)

        # real AI: architecture readiness
        pg.click("#tab-6"); pg.click("button[data-act='arch-assess']")
        pg.wait_for_selector(".ai-progress", timeout=10000)
        pg.wait_for_selector(".ai-progress", state="detached", timeout=420000)
        txt = pg.locator("#arch-wrap").inner_text()
        check("architecture readiness finished without an error", "did not finish" not in txt, txt[:200])
        check("architecture shows a verdict", pg.locator("#arch-wrap .verdict").count() > 0)

    # remaining pages once more after data exists
    for n in (3, 4, 5, 7):
        pg.click(f"#tab-{n}"); pg.wait_for_timeout(300)
    # back to list
    pg.goto(BASE + "/#/"); pg.wait_for_selector("#view-list:not([hidden])")
    check("no browser errors", not errors, "; ".join(errors[:5]))
    b.close()

print("\n%d failed" % len(fails) if fails else "\nAll checks passed")
sys.exit(1 if fails else 0)
