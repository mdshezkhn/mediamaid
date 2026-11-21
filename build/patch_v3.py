#!/usr/bin/env python3
"""MediaMaid v3 patcher — adds compressor tabs/panels, rebrands the site.
Idempotent: safe to run repeatedly."""
import re, sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
html_p = ROOT / "index.html"
css_p = ROOT / "style.css"
html = html_p.read_text(encoding="utf-8")
orig = html

def sub_once(pat, repl, text, tag="", flags=0):
    new, n = re.subn(pat, repl, text, count=1, flags=flags)
    print(f"[{tag}] {'PATCHED' if n else 'SKIP'}")
    return new

# ── 1. title + meta + hero + brand (rebrand) ─────────────────────────────────
html = sub_once(r"<title>.*?</title>",
    "<title>MediaMaid — Watermark Remover &amp; Video/Image Compressor | Free &amp; Private</title>",
    html, "title")
html = sub_once(r'(<meta name="description"\s*\n?\s*content=")[^"]*(")',
    r"\g<1>MediaMaid: remove AI watermarks (Gemini, Veo, Sora, Kling, Grok, any logo) AND compress video & images — 100% in your browser. No upload, no sign-up, no file-size limits, original quality.\g<2>",
    html, "meta-desc")
html = sub_once(r'(<meta name="keywords"\s*\n?\s*content=")[^"]*(")',
    r"\g<1>watermark remover, video compressor, image compressor, compress mp4, compress video online free, reduce video size, ai watermark remover, gemini watermark remover, veo watermark remover, sora watermark remover, kling watermark remover, grok imagine watermark remover, logo remover, no upload\g<2>",
    html, "meta-keywords")
for prop in ["og:description", "twitter:description"]:
    html = sub_once(rf'(<meta property="{prop}"\s*\n?\s*content=")[^"]*(")',
        r"\g<1>Remove AI watermarks and compress video & images — 100% in your browser. Free, private, no limits.\g<2>",
        html, prop)
for prop in ["og:image", "twitter:image"]:
    html = sub_once(rf'(<meta property="{prop}"\s*\n?\s*content=")[^"]*(")',
        r"\g<1>https://mdshezkhn.github.io/mediamaid/assets/logo.webp\g<2>",
        html, prop)
html = sub_once(r'(<h1 class="hero-title">).*?(</h1>)',
    r"\g<1>MediaMaid — Remove Watermarks, Shrink Video &amp; Images\g<2>",
    html, "hero-h1", flags=re.S)

# brand block in nav
html = sub_once(r'<a href="\./" class="brand" title="[^"]*">',
    '<a href="./" class="brand" title="MediaMaid — watermark remover & compressor">',
    html, "brand-a")
html = sub_once(r'<img src="\./assets/logo\.webp" alt="[^"]*"',
    '<img src="./assets/logo.webp" alt="MediaMaid logo"',
    html, "brand-img")
html = sub_once(r'<span class="brand-title">[^<]*</span>',
    '<span class="brand-title">MediaMaid</span>',
    html, "brand-title")

# og:url / canonical-ish absolute URLs pointing at the old name
html = html.replace("https://ishara-madu.github.io/gemini-watermark-remover/",
                    "https://mdshezkhn.github.io/mediamaid/")

# ── 2. tabs ─────────────────────────────────────────────────────────────────
TABS = '''
      <button id="tab-compress-video" class="tab-btn">
        <iconify-icon icon="ph:arrows-in-bold" width="18"></iconify-icon>
        <span>Video Compressor</span>
      </button>
      <button id="tab-compress-image" class="tab-btn">
        <iconify-icon icon="ph:image-bold" width="18"></iconify-icon>
        <span>Image Compressor</span>
      </button>'''
if 'tab-compress-video' not in html:
    html = sub_once(r'(</button>\s*\n)(\s*</div>\s*\n\s*<!-- Image Removal Panel -->)',
        lambda m: m.group(1) + TABS + "\n" + m.group(2),
        html, "tabs")
else:
    print("[tabs] SKIP")

# ── 3. panels (inserted between panel-video's </section> and how-it-works) ──
PANELS = r'''
    <!-- MediaMaid v3: Video Compressor -->
    <section id="panel-compress-video" class="card hidden">
      <div id="mmv-dropzone" class="dropzone">
        <div class="dropzone-icon"><iconify-icon icon="ph:arrows-in-bold"></iconify-icon></div>
        <p class="dropzone-title">Upload or drag videos to compress</p>
        <p class="dropzone-sub">Batch supported · MP4, WebM, MOV · no size limit — files never leave your device</p>
        <input type="file" id="mmv-input" accept="video/*" multiple hidden />
      </div>

      <div class="mm-settings">
        <p class="mm-label">Compression method</p>
        <div class="mm-radios" role="radiogroup">
          <label class="mm-radio"><input type="radio" name="mmv-method" value="quality" checked />
            <span>By quality</span></label>
          <label class="mm-radio"><input type="radio" name="mmv-method" value="target" />
            <span>Target a file size (% of original)</span></label>
          <label class="mm-radio"><input type="radio" name="mmv-method" value="bitrate" />
            <span>Set max bitrate</span></label>
        </div>

        <div data-mmshow="v" data-mmmethod="quality" class="mm-sub">
          <div class="mm-slider-row">
            <input type="range" id="mmv-quality" min="1" max="5" step="1" value="3" />
            <span class="mm-chip" id="mmv-quality-label">Balanced</span>
          </div>
          <p class="mm-hint">Balanced typically cuts file size by 50–70% with little visible change.</p>
        </div>
        <div data-mmshow="v" data-mmmethod="target" class="mm-sub hidden">
          <div class="mm-slider-row">
            <input type="number" id="mmv-target" min="1" max="99" step="1" value="50" /> <span class="mm-chip">% of original</span>
          </div>
          <p class="mm-hint" id="mmv-target-hint"></p>
        </div>
        <div data-mmshow="v" data-mmmethod="bitrate" class="mm-sub hidden">
          <div class="mm-slider-row">
            <input type="number" id="mmv-bitrate" min="30" max="50000" step="10" value="1500" /> <span class="mm-chip">kbps video</span>
          </div>
          <p class="mm-hint">Good streaming targets: 1080p ≈ 3000–5000, 720p ≈ 1500–2500, 480p ≈ 700–1200.</p>
        </div>

        <details class="mm-advanced">
          <summary>Advanced settings (optional)</summary>
          <div class="mm-grid">
            <label>Output format
              <select id="mmv-format">
                <option value="auto" selected>Auto (recommended)</option>
                <option value="mp4">MP4</option>
                <option value="webm">WebM</option>
              </select>
            </label>
            <label>Video codec
              <select id="mmv-codec">
                <option value="auto" selected>Auto (H.264 — works on old devices)</option>
                <option value="avc" data-codec="avc">H.264 — most compatible</option>
                <option value="hevc" data-codec="hevc">H.265 / HEVC — smaller</option>
                <option value="vp9" data-codec="vp9">VP9 — WebM</option>
                <option value="av1" data-codec="av1">AV1 — smallest (slow)</option>
              </select>
            </label>
            <label>Resolution cap
              <select id="mmv-res">
                <option value="0" selected>Keep original</option>
                <option value="1080">1080p</option>
                <option value="720">720p</option>
                <option value="480">480p</option>
                <option value="360">360p</option>
              </select>
            </label>
            <label>Frame-rate cap
              <select id="mmv-fps">
                <option value="0" selected>Keep original</option>
                <option value="30">30 fps</option>
                <option value="24">24 fps</option>
              </select>
            </label>
          </div>
          <p class="mm-hint" id="mmv-codec-note">Audio is kept as-is (never re-encoded). All processing happens on your device.</p>
          <label class="mm-check"><input type="checkbox" id="mmv-mute" /> Remove audio (mutes the output)</label>
        </details>
      </div>

      <div class="mm-summary" id="mmv-summary"></div>
      <div class="mm-queue" id="mmv-queue"></div>
      <div class="mm-actionsrow">
        <button type="button" class="btn btn-primary" id="mmv-go" disabled>Compress Now</button>
        <button type="button" class="btn" id="mmv-zip" disabled>Download all (.zip)</button>
        <button type="button" class="btn mm-ghost" id="mmv-clear">Clear list</button>
      </div>
    </section>

    <!-- MediaMaid v3: Image Compressor -->
    <section id="panel-compress-image" class="card hidden">
      <div id="mmi-dropzone" class="dropzone">
        <div class="dropzone-icon"><iconify-icon icon="ph:image-bold"></iconify-icon></div>
        <p class="dropzone-title">Upload or drag images to compress</p>
        <p class="dropzone-sub">Batch supported · PNG, JPG, WebP · files never leave your device</p>
        <input type="file" id="mmi-input" accept="image/*" multiple hidden />
      </div>

      <div class="mm-settings">
        <p class="mm-label">Compression method</p>
        <div class="mm-radios" role="radiogroup">
          <label class="mm-radio"><input type="radio" name="mmi-method" value="quality" checked />
            <span>By quality</span></label>
          <label class="mm-radio"><input type="radio" name="mmi-method" value="target" />
            <span>Target a file size (KB)</span></label>
        </div>

        <div data-mmshow="i" data-mmmethod="quality" class="mm-sub">
          <div class="mm-slider-row">
            <input type="range" id="mmi-quality" min="1" max="10" step="1" value="7" />
            <span class="mm-chip" id="mmi-quality-label">7</span>
          </div>
          <p class="mm-hint">7 keeps photos crisp; 4–5 is fine for the web.</p>
        </div>
        <div data-mmshow="i" data-mmmethod="target" class="mm-sub hidden">
          <div class="mm-slider-row">
            <input type="number" id="mmi-targetkb" min="5" max="100000" step="5" value="200" /> <span class="mm-chip">KB</span>
          </div>
          <p class="mm-hint">Finds the quality that lands closest to your target (binary search).</p>
        </div>

        <details class="mm-advanced">
          <summary>Advanced settings (optional)</summary>
          <div class="mm-grid">
            <label>Output format
              <select id="mmi-format">
                <option value="auto" selected>Auto (JPEG/WebP)</option>
                <option value="jpeg">JPEG</option>
                <option value="webp">WebP</option>
              </select>
            </label>
            <label>Max dimension
              <select id="mmi-maxdim">
                <option value="0" selected>Keep original</option>
                <option value="3840">4K (3840px)</option>
                <option value="1920">1920px</option>
                <option value="1280">1280px</option>
                <option value="720">720px</option>
              </select>
            </label>
          </div>
          <p class="mm-hint">Transparent PNGs get a white background when converted to JPEG.</p>
        </details>
      </div>

      <div class="mm-summary" id="mmi-summary"></div>
      <div class="mm-queue" id="mmi-queue"></div>
      <div class="mm-actionsrow">
        <button type="button" class="btn btn-primary" id="mmi-go" disabled>Compress Now</button>
        <button type="button" class="btn" id="mmi-zip" disabled>Download all (.zip)</button>
        <button type="button" class="btn mm-ghost" id="mmi-clear">Clear list</button>
      </div>
    </section>
'''
if 'panel-compress-video' not in html:
    m = re.search(r'\n(    <!-- How It Works Step-by-Step Section -->)', html)
    if m:
        html = html[:m.start()] + "\n" + PANELS + "\n" + html[m.start(1):]
        print("[panels] PATCHED")
    else:
        print("[panels] ANCHOR NOT FOUND")
else:
    print("[panels] SKIP")

# ── 4. script tag ───────────────────────────────────────────────────────────
if 'src="./compressor.js"' not in html:
    html = html.replace('<script src="./universal.js"></script>',
                        '<script src="./universal.js"></script>\n  <script src="./compressor.js"></script>', 1)
    print("[script] PATCHED")
else:
    print("[script] SKIP")

if html != orig:
    html_p.write_text(html, encoding="utf-8", newline="\n")
    print("index.html written,", len(html), "bytes")
else:
    print("index.html unchanged")

# ── 5. CSS ──────────────────────────────────────────────────────────────────
css = css_p.read_text(encoding="utf-8")
CSS_ADD = """
/* ── MediaMaid v3: compressor ── */
.mm-settings { margin-top: 16px; }
.mm-label { font-size: 13px; font-weight: 600; margin: 14px 0 8px; color: var(--fg, #111); }
.mm-radios { display: flex; flex-wrap: wrap; gap: 8px 16px; }
.mm-radio { display: inline-flex; align-items: center; gap: 6px; font-size: 14px; cursor: pointer; }
.mm-sub { margin-top: 10px; }
.mm-slider-row { display: flex; align-items: center; gap: 12px; }
.mm-slider-row input[type="range"] { flex: 1; }
.mm-slider-row input[type="number"] { width: 90px; padding: 6px 8px; border: 1px solid var(--border, #d1d5db); border-radius: 8px; background: var(--bg, #fff); color: inherit; font-size: 14px; }
.mm-chip { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; background: var(--chip, #e5e7eb); white-space: nowrap; }
.mm-hint { font-size: 12px; color: #6b7280; margin: 6px 0 0; line-height: 1.45; }
.mm-advanced { margin-top: 14px; border: 1px solid var(--border, #e5e7eb); border-radius: 10px; padding: 10px 14px; }
.mm-advanced summary { cursor: pointer; font-size: 14px; font-weight: 600; }
.mm-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin-top: 12px; }
.mm-grid label { display: flex; flex-direction: column; gap: 5px; font-size: 13px; font-weight: 500; }
.mm-grid select { padding: 7px 9px; border: 1px solid var(--border, #d1d5db); border-radius: 8px; background: var(--bg, #fff); color: inherit; font-size: 14px; }
.mm-check { display: flex; align-items: center; gap: 8px; font-size: 13px; margin-top: 12px; cursor: pointer; }
.mm-summary { font-size: 13px; color: #6b7280; margin-top: 16px; min-height: 18px; }
.mm-queue { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
.mm-file { border: 1px solid var(--border, #e5e7eb); border-radius: 10px; padding: 10px 12px; background: var(--card, rgba(255,255,255,.6)); }
.mm-file.mm-err { border-color: #dc2626; }
.mm-row1 { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13.5px; }
.mm-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mm-badge { font-size: 12px; font-weight: 700; border-radius: 999px; padding: 2px 9px; white-space: nowrap; }
.mm-badge.mm-good { background: #d1fae5; color: #065f46; }
.mm-badge.mm-bad { background: #fee2e2; color: #991b1b; }
.mm-bar { height: 5px; border-radius: 999px; background: var(--border, #e5e7eb); margin: 8px 0 6px; overflow: hidden; }
.mm-bar-fill { height: 100%; width: 0; border-radius: 999px; background: linear-gradient(90deg, #6366f1, #22c55e); transition: width .25s; }
.mm-row2 { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 12.5px; color: #6b7280; }
.mm-actions { display: flex; gap: 8px; }
.mm-dl { font-size: 12.5px; font-weight: 600; padding: 4px 12px; border-radius: 8px; border: 1px solid #4f46e5; background: #4f46e5; color: #fff; cursor: pointer; }
.mm-dl:hover { background: #4338ca; }
.mm-rm { font-size: 12.5px; padding: 4px 8px; border-radius: 8px; border: 1px solid var(--border, #d1d5db); background: transparent; color: #6b7280; cursor: pointer; }
.mm-rm:hover { color: #dc2626; border-color: #dc2626; }
.mm-actionsrow { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
.mm-actionsrow .btn { padding: 10px 18px; border-radius: 10px; font-weight: 600; font-size: 14px; cursor: pointer; border: 1px solid transparent; }
.mm-actionsrow .btn-primary { background: #4f46e5; color: #fff; }
.mm-actionsrow .btn-primary:hover:not(:disabled) { background: #4338ca; }
.mm-actionsrow .btn:disabled { opacity: .5; cursor: not-allowed; }
.mm-actionsrow .btn:not(.btn-primary) { background: transparent; border-color: var(--border, #d1d5db); color: inherit; }
.mm-ghost { color: #6b7280; }
.tab-container { flex-wrap: wrap; }
@media (max-width: 560px) { .tab-container { gap: 6px; } .tab-btn { font-size: 12.5px; padding: 8px 10px; } }
"""
if "MediaMaid v3: compressor" not in css:
    css_p.write_text(css + CSS_ADD, encoding="utf-8", newline="\n")
    print("[css] PATCHED")
else:
    print("[css] SKIP")

# ── 6. error watchdog (inline, BEFORE nothing — catches everything at runtime)
# Makes any failure visible instead of silent: load failure, init failure,
# runtime exceptions, unhandled rejections, missing WebCodecs.
WATCHDOG = """
<script>
/* MediaMaid watchdog — surfaces every failure so nothing dies silently */
(function () {
  var seen = 0;
  function banner(msg, kind) {
    var b = document.getElementById('mm-watchdog');
    if (!b) {
      b = document.createElement('div');
      b.id = 'mm-watchdog';
      b.style.cssText = 'position:fixed;z-index:99999;left:12px;right:12px;top:12px;max-width:720px;margin:auto;'
        + 'padding:12px 16px;border-radius:12px;font:13px/1.5 system-ui,sans-serif;color:#fff;'
        + 'box-shadow:0 8px 30px rgba(0,0,0,.35);cursor:pointer';
      document.body ? document.body.appendChild(b) : document.addEventListener('DOMContentLoaded', function () { document.body.appendChild(b); });
      b.onclick = function () { b.remove(); };
    }
    b.style.background = kind === 'warn' ? '#b45309' : '#b91c1c';
    b.textContent = msg;
    seen++;
  }
  window.__mmBanner = banner;
  window.addEventListener('error', function (e) {
    var src = (e.target && e.target.src) || e.filename || '';
    if (src && src.indexOf('extension') > -1) return;
    if (e.target && e.target.tagName === 'IMG' && !e.filename) return; // broken img: benign
    if (e.target && (e.target.tagName === 'SCRIPT' || e.target.tagName === 'LINK') && src) {
      banner('MediaMaid: failed to load ' + src.split('/').pop() + ' — hard-refresh (Ctrl+Shift+R). If it persists, please report this message.');
      return;
    }
    banner('MediaMaid error: ' + (e.message || 'unknown') + (src ? ' @ ' + src.split('/').pop() : ''));
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var m = (e.reason && (e.reason.message || String(e.reason))) || 'unknown';
    banner('MediaMaid: ' + m);
  });
  window.addEventListener('load', function () {
    setTimeout(function () {
      if (!window.MediaMaidInitDone) {
        banner('MediaMaid compressor did not start — hard-refresh (Ctrl+Shift+R). If it persists, open the Console (F12) and report the red message.', 'warn');
      }
      if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
        var t = document.getElementById('mmv-panel-note');
        if (t) t.hidden = false;
      }
    }, 2500);
  });
})();
</script>
"""
if "mm-watchdog" not in html:
    html = html.replace('<script src="./compressor.js"></script>',
                        '<script src="./compressor.js"></script>\n  ' + WATCHDOG.strip(), 1)
    html_p.write_text(html, encoding="utf-8", newline="\n")
    print("[watchdog] PATCHED")
else:
    print("[watchdog] SKIP")

# browser-support note inside the video-compressor panel
NOTE = '<p class="mm-note" id="mmv-panel-note" hidden>⚠ This browser has no WebCodecs support — video compression needs Chrome or Edge. Removing watermarks still works.</p>'
if 'id="mmv-panel-note"' not in html:
    html = html.replace('<div id="mmv-dropzone" class="dropzone">', NOTE + '\n      <div id="mmv-dropzone" class="dropzone">', 1)
    html_p.write_text(html, encoding="utf-8", newline="\n")
    print("[support-note] PATCHED")
else:
    print("[support-note] SKIP")

CSS_NOTE = """
.mm-note { font-size: 12.5px; color: #b45309; background: #fffbeb; border: 1px solid #fde68a;
  padding: 10px 14px; border-radius: 10px; margin: 10px 0 0; line-height: 1.5; }
"""
css2 = css_p.read_text(encoding="utf-8")
if "mm-note" not in css2:
    css_p.write_text(css2 + CSS_NOTE, encoding="utf-8", newline="\n")
    print("[note-css] PATCHED")
else:
    print("[note-css] SKIP")
print("done")
