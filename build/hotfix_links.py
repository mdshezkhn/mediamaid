#!/usr/bin/env python3
"""MediaMaid hot-fix: remove every reference/link to the original author's
other properties (ishara-madu.github.io, her repo, her coffee page) and the
results promo banner. Idempotent — safe to run on v3 or v4 trees.

Replacements (user decision 2026-11-22): the subpage "Tools" dropdown now
promotes MediaMaid's OWN tools (video/image compressor tabs + home grid).
"""
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent


def patch(path: str, subs, label: str) -> None:
    p = ROOT / path
    if not p.exists():
        print(f"[{label}] missing — skipped")
        return
    t = p.read_text(encoding="utf-8")
    orig = t
    for old, new in subs:
        t = t.replace(old, new)
    if t != orig:
        p.write_text(t, encoding="utf-8", newline="\n")
        print(f"[{label}] patched")
    else:
        print(f"[{label}] already clean")


# ── 1. main.js: results promo banner → no-op; GitHub stars → no-op ──────────
MAINJS = (ROOT / "main.js").read_text(encoding="utf-8")
new_main = MAINJS

# 1a. promo card generator: return empty string (banner never renders)
promo_pat = re.compile(
    r"// ── Results Screen Promo Card Generator ──\nfunction getPromoCardHtml\(type = 'image'\) \{[\s\S]*?\n\}\n",
    re.M,
)
new_main = promo_pat.sub(
    "// ── Results Screen Promo Card Generator ──\n"
    "// (removed 2026-11-22: pointed at the original author's other site)\n"
    "function getPromoCardHtml(type = 'image') {\n"
    "  return '';\n"
    "}\n",
    new_main,
    count=1,
)

# 1b. GitHub star fetcher: no-op (was api.github.com/repos/ishara-madu/...)
stars_pat = re.compile(
    r"// ── GitHub Star Count Fetcher ──\nasync function fetchGitHubStars\(\) \{[\s\S]*?\n\}\n",
    re.M,
)
new_main = stars_pat.sub(
    "// ── GitHub Star Count Fetcher ──\n"
    "// (removed 2026-11-22: fetched the original author's repo stars)\n"
    "async function fetchGitHubStars() {\n"
    "  /* no-op */\n"
    "}\n",
    new_main,
    count=1,
)

if new_main != MAINJS:
    (ROOT / "main.js").write_text(new_main, encoding="utf-8", newline="\n")
    print("[main.js] promo banner + star fetch removed")
else:
    print("[main.js] already clean")

# ── 2. subpage Tools dropdown: her tool promo → MediaMaid's own tools ────────
PROMO_OLD = """            <a href="./index.html" target="_blank" rel="noopener noreferrer"
              class="dropdown-item promo-item"
              data-auto-favicon="./index.html">
              <div class="dropdown-item-icon promo-icon">
                <img src="./index.htmlfavicon.ico"
                  onerror="this.onerror=null; this.src='https://www.google.com/s2/favicons?domain=ishara-madu.github.io&amp;sz=64';"
                  alt="Online Image Converter Favicon" class="tool-favicon-img" width="22" height="22" loading="lazy" />
              </div>
              <div class="dropdown-item-content">
                <div class="dropdown-item-title-row">
                  <span class="dropdown-item-title">Online Image Converter</span>
                  <span class="badge-featured">Free &amp; Fast</span>
                </div>
                <p class="dropdown-item-desc">Convert WebP, PNG, JPG, AVIF, GIF with zero quality loss.</p>
              </div>
              <iconify-icon icon="ph:arrow-square-out-bold" width="16" class="dropdown-ext-icon"></iconify-icon>
            </a>
            <div class="dropdown-divider"></div>"""

PROMO_NEW = """            <a href="./index.html#compress-video" target="_blank" rel="noopener noreferrer"
              class="dropdown-item promo-item"
              data-auto-favicon="./index.html">
              <div class="dropdown-item-icon promo-icon">
                <img src="./assets/favicon-96x96.png"
                  alt="Video Compressor Favicon" class="tool-favicon-img" width="22" height="22" loading="lazy" />
              </div>
              <div class="dropdown-item-content">
                <div class="dropdown-item-title-row">
                  <span class="dropdown-item-title">Video Compressor</span>
                  <span class="badge-featured">Free &amp; Fast</span>
                </div>
                <p class="dropdown-item-desc">Shrink any video to a target size — no upload, no limits.</p>
              </div>
              <iconify-icon icon="ph:arrow-square-out-bold" width="16" class="dropdown-ext-icon"></iconify-icon>
            </a>
            <div class="dropdown-divider"></div>
            <a href="./index.html#compress-image" target="_blank" rel="noopener noreferrer"
              class="dropdown-item promo-item"
              data-auto-favicon="./index.html">
              <div class="dropdown-item-icon promo-icon">
                <img src="./assets/favicon-96x96.png"
                  alt="Image Compressor Favicon" class="tool-favicon-img" width="22" height="22" loading="lazy" />
              </div>
              <div class="dropdown-item-content">
                <div class="dropdown-item-title-row">
                  <span class="dropdown-item-title">Image Compressor</span>
                  <span class="badge-featured">Free &amp; Fast</span>
                </div>
                <p class="dropdown-item-desc">Hit an exact KB target or squeeze quality — JPEG &amp; WebP.</p>
              </div>
              <iconify-icon icon="ph:arrow-square-out-bold" width="16" class="dropdown-ext-icon"></iconify-icon>
            </a>
            <div class="dropdown-divider"></div>"""

for page in ["about.html", "contact.html", "disclaimer.html",
             "privacy-policy.html", "terms-of-service.html"]:
    patch(page, [(PROMO_OLD, PROMO_NEW)], page + " dropdown")

# ── 3. about.html author links: her GitHub/coffee → Mohammed's ───────────────
patch("about.html", [
    ('<a href="https://github.com/ishara-madu" target="_blank" rel="noopener noreferrer" class="contact-action-link">\n              <iconify-icon icon="ph:github-logo-bold" width="14"></iconify-icon> GitHub\n            </a>',
     '<a href="https://github.com/mdshezkhn" target="_blank" rel="noopener noreferrer" class="contact-action-link">\n              <iconify-icon icon="ph:github-logo-bold" width="14"></iconify-icon> GitHub\n            </a>'),
    ('<a href="https://buymeacoffee.com/ishara.madu" target="_blank" rel="noopener noreferrer" class="contact-action-link">\n              <iconify-icon icon="ph:coffee-bold" width="14"></iconify-icon> Support Work\n            </a>',
     '<a href="https://mediamaid.pages.dev/" target="_blank" rel="noopener noreferrer" class="contact-action-link">\n              <iconify-icon icon="ph:globe-bold" width="14"></iconify-icon> mediamaid.pages.dev\n            </a>'),
], "about.html author links")

# ── 4. contact.html portfolio card: her URL text → ours ──────────────────────
patch("contact.html", [
    ('class="contact-action-link">\n              ishara-madu.github.io <iconify-icon',
     'class="contact-action-link">\n              mediamaid.pages.dev <iconify-icon'),
], "contact.html portfolio link")

# coffee support card on contact page (if present) → remove her coffee link
COFFEE_PAT = re.compile(
    r'<div class="contact-card-item">\s*<div class="contact-icon-bubble">\s*<iconify-icon icon="ph:coffee-bold"></iconify-icon>\s*</div>\s*<div class="contact-info-content">[\s\S]*?buymeacoffee\.com/[\s\S]*?</div>\s*</div>',
    re.M,
)
for page in ["contact.html", "about.html"]:
    p = ROOT / page
    if not p.exists():
        continue
    t = p.read_text(encoding="utf-8")
    new = COFFEE_PAT.sub("", t)
    if new != t:
        p.write_text(new, encoding="utf-8", newline="\n")
        print(f"[{page}] coffee card removed")

# ── 5. sweep: any straggler references ───────────────────────────────────────
leftover = []
for f in ROOT.glob("*.html"):
    t = f.read_text(encoding="utf-8")
    for needle in ("ishara-madu", "buymeacoffee.com/ishara"):
        if needle in t:
            leftover.append(f"{f.name}: {needle}")
for f in ["main.js", "universal.js", "compressor.js", "style.css"]:
    p = ROOT / f
    if p.exists():
        t = p.read_text(encoding="utf-8")
        if "ishara-madu.github.io" in t and f == "main.js":
            leftover.append("main.js: still has ishara-madu.github.io")
if leftover:
    print("LEFTOVERS:")
    for l in leftover:
        print("  -", l)
else:
    print("sweep clean — no external-creator references remain")
