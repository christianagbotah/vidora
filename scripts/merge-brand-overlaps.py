from pathlib import Path


def replace_exact(text: str, old: str, new: str, *, expected: int = 1, label: str) -> str:
    count = text.count(old)
    if count != expected:
        raise SystemExit(f"{label}: expected {expected} exact match(es), found {count}")
    return text.replace(old, new)


# Hardened assistant keeps auth/quota/metering; only reconcile the brand text.
assistant_path = Path("src/app/api/assistant/chat/route.ts")
assistant = assistant_path.read_text(encoding="utf-8")
assistant = replace_exact(
    assistant,
    "You are Vidora AI Assistant, the friendly help bot for Vidora — a professional AI video creation studio.",
    "You are Vidora Studio Assistant, the friendly help bot for Vidora Studio — a professional AI video creation studio.",
    label="assistant brand line",
)
assistant_path.write_text(assistant, encoding="utf-8")

# Keep the hardened export implementation; reconcile only the title-card subtitle.
export_path = Path("src/app/api/export-video/route.ts")
export = export_path.read_text(encoding="utf-8")
export = replace_exact(
    export,
    "drawtext=text='Vidora AI'",
    "drawtext=text='Vidora Studio'",
    label="export title brand",
)
export_path.write_text(export, encoding="utf-8")

# Keep every P0 type/security edit in the large page. Apply exactly the two
# user-requested footer-dialog scroll fixes plus the footer brand text.
page_path = Path("src/app/page.tsx")
page = page_path.read_text(encoding="utf-8")
old_open = '<ScrollArea className="flex-1 pr-4 -mr-4">'
new_open = '<div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-4 -mr-4">'
if page.count(old_open) != 2:
    raise SystemExit(f"footer modal openings: expected 2, found {page.count(old_open)}")

# Replace each target opening and its corresponding first closing tag only.
for _ in range(2):
    start = page.find(old_open)
    if start < 0:
        raise SystemExit("footer modal opening disappeared during reconciliation")
    close = page.find("</ScrollArea>", start)
    if close < 0:
        raise SystemExit("footer modal closing ScrollArea not found")
    page = page[:start] + new_open + page[start + len(old_open):close] + "</div>" + page[close + len("</ScrollArea>"):]

page = replace_exact(
    page,
    "&copy; {new Date().getFullYear()} Vidora AI · A product of LightWorld Technologies.",
    "&copy; {new Date().getFullYear()} Vidora Studio · A product of LightWorld Technologies.",
    label="footer brand",
)
page_path.write_text(page, encoding="utf-8")

print("Reconciled Vidora Studio branding and footer modal scrolling onto hardened files.")
# Trigger marker: workflow existed before this revision.
