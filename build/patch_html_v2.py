#!/usr/bin/env python3
"""Idempotent patcher: wires universal.js into index.html + style.css (v2)."""
import re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
html_p = ROOT / "index.html"
css_p = ROOT / "style.css"

html = html_p.read_text(encoding="utf-8")
orig_html = html

def sub_once(pattern, repl, text, flags=0, tag=""):
    new, n = re.subn(pattern, repl, text, count=1, flags=flags)
    print(f"[{tag}] {'PATCHED' if n else 'SKIP (already patched / not found)'}")
    return new

# 1. title / meta / hero
html = sub_once(
    r"<title>.*?</title>",
    "<title>AI Watermark Remover — Gemini, Veo, Sora, Kling, Grok &amp; Any Logo | Free</title>",
    html, tag="title")
html = sub_once(
    r'(<meta name="description"\s*\n?\s*content=")[^"]*(")',
    r"\g<1>Free universal AI watermark remover. Remove Gemini, Veo, Sora, Kling, Grok, Hailuo, Luma, Runway, PixVerse and any custom watermark from images and videos — in your browser, zero upload, original quality.\g<2>",
    html, tag="meta-desc")
html = sub_once(
    r'(<meta name="keywords"\s*\n?\s*content=")[^"]*(")',
    r"\g<1>watermark remover, ai watermark remover, gemini watermark remover, veo watermark remover, sora watermark remover, kling watermark remover, grok imagine watermark remover, hailuo watermark remover, luma watermark remover, runway watermark remover, remove tiktok watermark, remove capcut watermark, logo remover, video watermark remover, image watermark remover\g<2>",
    html, tag="meta-keywords")
html = sub_once(
    r'<h1 class="hero-title">.*?</h1>',
    '<h1 class="hero-title">Universal AI Watermark Remover — Gemini, Veo, Sora &amp; Any Logo</h1>',
    html, tag="h1")

# 2. dropzone copy
html = sub_once(
    r'<p class="dropzone-title">Upload or drag your Gemini or Nano Banana Image</p>',
    '<p class="dropzone-title">Upload or drag any image</p>',
    html, tag="dz-img")
html = sub_once(
    r'<p class="dropzone-title">Upload or drag a Gemini Omni, Google Flow, or Veo video</p>',
    '<p class="dropzone-title">Upload or drag any video</p>',
    html, tag="dz-video")

IMG_BUTTONS = (
    '<button type="button" class="btn-preset active" data-preset="new" id="btn-preset-img-nano">\n'
    '              <iconify-icon icon="ph:sparkle-bold"></iconify-icon> Gemini / Nano Banana\n'
    '            </button>\n'
    '            <button type="button" class="btn-preset" data-preset="classic" id="btn-preset-img-classic">\n'
    '              <iconify-icon icon="ph:corners-out"></iconify-icon> Gemini (Classic)\n'
    '            </button>\n'
    '            <button type="button" class="btn-preset" data-preset="sora" id="btn-preset-img-sora">\n'
    '              <iconify-icon icon="ph:planet-bold"></iconify-icon> Sora\n'
    '            </button>\n'
    '            <button type="button" class="btn-preset" data-preset="grok" id="btn-preset-img-grok">\n'
    '              <iconify-icon icon="ph:rocket-bold"></iconify-icon> Grok Imagine\n'
    '            </button>\n'
    '            <button type="button" class="btn-preset" data-preset="caption" id="btn-preset-img-caption">\n'
    '              <iconify-icon icon="ph:subtitle-bold"></iconify-icon> TikTok / CapCut bar\n'
    '            </button>\n'
    '            <button type="button" class="btn-preset" data-preset="custom" id="btn-preset-img-custom">\n'
    '              <iconify-icon icon="ph:hand-grabbing-bold"></iconify-icon> Custom (drag a box)\n'
    '            </button>'
)

VID_BUTTONS = (
    '<button type="button" class="btn-preset active" data-preset="veo" id="btn-preset-vid-omni">\n'
    '              <iconify-icon icon="ph:video-camera-bold"></iconify-icon> Veo / Flow (Adaptive)\n'
    '            </button>\n'
    '            <button type="button" class="btn-preset" data-preset="corner" id="btn-preset-vid-veo">\n'
    '              <iconify-icon icon="ph:corners-out"></iconify-icon> Veo (Corner)\n'
    '            </button>\n'
    '            <button type="button" class="btn-preset" data-preset="sparkle" id="btn-preset-vid-sparkle">\n'
    '              <iconify-icon icon="ph:sparkle-bold"></iconify-icon> Standard Sparkle\n'
    '            </button>\n'
    '            <button type="button" class="btn-preset" data-preset="sora" id="btn-preset-vid-sora">\n'
    '              <iconify-icon icon="ph:planet-bold"></iconify-icon> Sora\n'
    '            </button>\n'
    '            <button type="button" class="btn-preset" data-preset="kling" id="btn-preset-vid-kling">\n'
    '              <iconify-icon icon="ph:video-bold"></iconify-icon> Kling AI\n'
    '            </button>\n'
    '            <button type="button" class="btn-preset" data-preset="grok" id="btn-preset-vid-grok">\n'
    '              <iconify-icon icon="ph:rocket-bold"></iconify-icon> Grok Imagine\n'
    '            </button>\n'
    '            <button type="button" class="btn-preset" data-preset="hailuo" id="btn-preset-vid-hailuo">\n'
    '              <iconify-icon icon="ph:waves-bold"></iconify-icon> Hailuo / MiniMax\n'
    '            </button>\n'
    '            <button type="button" class="btn-preset" data-preset="luma" id="btn-preset-vid-luma">\n'
    '              <iconify-icon icon="ph:moon-stars-bold"></iconify-icon> Luma\n'
    '            </button>\n'
    '            <button type="button" class="btn-preset" data-preset="runway" id="btn-preset-vid-runway">\n'
    '              <iconify-icon icon="ph:film-strip-bold"></iconify-icon> Runway\n'
    '            </button>\n'
    '            <button type="button" class="btn-preset" data-preset="pixverse" id="btn-preset-vid-pixverse">\n'
    '              <iconify-icon icon="ph:images-bold"></iconify-icon> PixVerse\n'
    '            </button>\n'
    '            <button type="button" class="btn-preset" data-preset="caption" id="btn-preset-vid-caption">\n'
    '              <iconify-icon icon="ph:subtitle-bold"></iconify-icon> TikTok / CapCut bar\n'
    '            </button>\n'
    '            <button type="button" class="btn-preset" data-preset="custom" id="btn-preset-vid-custom">\n'
    '              <iconify-icon icon="ph:hand-grabbing-bold"></iconify-icon> Custom (drag a box)\n'
    '            </button>'
)

def chips_repl(m, buttons):
    return m.group(1).rstrip() + "\n            " + buttons + "\n          " + m.group(2)

html = sub_once(
    r'(<[^>]*id="panel-image"[\s\S]*?<div class="tuner-preset-buttons">)[\s\S]*?(</div>)',
    lambda m: chips_repl(m, IMG_BUTTONS),
    html, tag="img-chips")

html = sub_once(
    r'(<[^>]*id="panel-video"[\s\S]*?<div class="tuner-preset-buttons">)[\s\S]*?(</div>\s*</div>\s*\n\s*<div class="tuner-sliders)',
    lambda m: chips_repl(m, VID_BUTTONS) + m.group(2),
    html, tag="vid-chips")

# 2b. localize favicon/manifest links (they point at the original GitHub Pages
#     and 403 when served standalone)
html = sub_once(
    r'(href=")https://ishara-madu\.github\.io/gemini-watermark-remover/(assets/(?:favicon[^"]*|apple-touch-icon[^"]*|site\.webmanifest))(")',
    r"\g<1>./\g<2>\g<3>",
    html, tag="favicons")
# localize ALL of them (sub_once handles only the first)
html = re.sub(
    r'(href=")https://ishara-madu\.github\.io/gemini-watermark-remover/(assets/(?:favicon[^"]*|apple-touch-icon[^"]*|site\.webmanifest))(")',
    r"\g<1>./\g<2>\g<3>",
    html)

# 3. drag hints under both preview canvases
HINT = '💡 Drag on the preview to box ANY watermark — works for every logo, text or caption.'
if "img-drag-hint" not in html:
    html = html.replace(
        '<canvas id="img-main-canvas"></canvas>',
        '<canvas id="img-main-canvas"></canvas>\n                <p class="drag-hint hidden" id="img-drag-hint">' + HINT + '</p>', 1)
    print("[hint-img]", "PATCHED" if "img-drag-hint" in html else "FAIL")
else:
    print("[hint-img] SKIP")
if "video-drag-hint" not in html:
    html = html.replace(
        '<canvas id="video-main-canvas"></canvas>',
        '<canvas id="video-main-canvas"></canvas>\n                <p class="drag-hint hidden" id="video-drag-hint">' + HINT + '</p>', 1)
    print("[hint-video]", "PATCHED" if "video-drag-hint" in html else "FAIL")
else:
    print("[hint-video] SKIP")

# 3b. fetch guard inline BEFORE main.js (its star-badge fetch fires at load,
#     before universal.js can patch window.fetch)
GUARD = """<!-- v2: offline-safe GitHub API guard (installed before main.js) -->
  <script>
  (function () {
    var _f = window.fetch && window.fetch.bind(window);
    if (!_f) return;
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('api.github.com') !== -1) {
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return _f(input, init);
    };
  })();
  </script>
"""
if "offline-safe GitHub API guard" not in html:
    html = html.replace('<script src="./main.js"></script>',
                        GUARD + '  <script src="./main.js"></script>', 1)
    print("[fetch-guard] PATCHED")
else:
    print("[fetch-guard] SKIP")

# 4. load universal.js right after main.js
if 'src="./universal.js"' not in html:
    html = html.replace('<script src="./main.js"></script>',
                        '<script src="./main.js"></script>\n  <script src="./universal.js"></script>', 1)
    print("[script] PATCHED")
else:
    print("[script] SKIP")

if html != orig_html:
    html_p.write_text(html, encoding="utf-8", newline="\n")
    print("index.html written")
else:
    print("index.html unchanged")

# ── style.css ──
css = css_p.read_text(encoding="utf-8")
ADD = (
    "\n/* ── v2 universal layer ── */\n"
    ".drag-hint {\n  font-size: 12px;\n  color: #6b7280;\n  margin: 6px 2px 0;\n  line-height: 1.4;\n}\n"
    "#img-main-canvas,\n#video-main-canvas {\n  cursor: crosshair;\n  touch-action: none;\n}\n"
    '.tuner-preset-buttons .btn-preset[data-preset="custom"] {\n  border-style: dashed;\n}\n'
)
if "v2 universal layer" not in css:
    css_p.write_text(css + ADD, encoding="utf-8", newline="\n")
    print("[css] PATCHED")
else:
    print("[css] SKIP")
print("done")
