#!/usr/bin/env python3
"""MediaMaid v4 shell builder.

Reads build/panel-*.html (extracted verbatim from the v3 page) and generates a
new index.html: teal liquid-glass shell, tool-grid home, workspace with legacy
panels + registry-driven #tool-root, compact how-it-works + FAQ, rebranded
footer/JSON-LD. Also rebrands the five subpages (creator names -> Mohammed).
Idempotent: regenerating produces the same output from the same inputs.
"""
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"


def panel(name):
    return (BUILD / f"panel-{name}.html").read_text(encoding="utf-8").rstrip()


SHELL_HEAD = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>MediaMaid — Free Media Toolbox: Watermark Remover, Compressor, Trimmer, Converter &amp; More</title>
  <meta name="description" content="MediaMaid is a free in-browser toolbox: remove AI watermarks (Gemini, Veo, Sora, Kling...), compress video &amp; images, trim, crop, rotate, mute, extract audio, convert, merge, record screen or voice, and edit PDFs — with zero uploads." />
  <meta name="keywords" content="watermark remover, ai watermark remover, gemini watermark remover, veo watermark remover, sora watermark remover, video compressor, video trimmer, video cropper, video rotator, mute video, extract audio, video converter, audio converter, mp3 converter, pdf merge, pdf split, pdf page numbers, image converter, screen recorder, voice recorder, mediamaid" />
  <link rel="canonical" href="https://mdshezkhn.github.io/mediamaid/" />
  <meta property="og:title" content="MediaMaid — Free Media Toolbox" />
  <meta property="og:description" content="25 free in-browser tools: watermark removal, compression, trimming, conversion, PDF editing and more. Zero uploads, zero limits." />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://mdshezkhn.github.io/mediamaid/" />
  <meta property="og:image" content="https://mdshezkhn.github.io/mediamaid/assets/web-app-manifest-512x512.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="icon" type="image/svg+xml" href="./assets/favicon.svg" />
  <link rel="icon" type="image/png" sizes="96x96" href="./assets/favicon-96x96.png" />
  <link rel="apple-touch-icon" href="./assets/apple-touch-icon.png" />
  <link rel="manifest" href="./assets/site.webmanifest" />
  <meta name="theme-color" content="#0d1f22" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
  <script src="https://code.iconify.design/iconify-icon/2.1.0/iconify-icon.min.js"></script>
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    "name": "MediaMaid",
    "url": "https://mdshezkhn.github.io/mediamaid/",
    "applicationCategory": "MultimediaApplication",
    "operatingSystem": "Any",
    "offers": { "@type": "Offer", "price": "0", "priceCurrency": "USD" },
    "creator": { "@type": "Person", "name": "Mohammed Shehzad" },
    "description": "Free in-browser media toolbox: AI watermark removal, video/image compression, trimming, cropping, conversion, screen & voice recording, and PDF tools. Everything runs locally — no uploads."
  }
  </script>
  <link rel="stylesheet" href="./style.css" />
  <link rel="stylesheet" href="./glass.css" />
</head>
<body>
  <header class="site-header glass-nav">
    <div class="header-inner">
      <a href="./index.html" class="brand" aria-label="MediaMaid home">
        <span class="brand-mark glass-chip" aria-hidden="true"><iconify-icon icon="ph:broom-bold"></iconify-icon></span>
        <span class="brand-name">Media<em>Maid</em></span>
      </a>
      <nav class="main-nav" aria-label="Primary">
        <a href="./index.html" class="nav-link">Tools</a>
        <a href="./index.html#how-it-works" class="nav-link">How it works</a>
        <a href="./index.html#faq" class="nav-link">FAQ</a>
        <a href="./about.html" class="nav-link">About</a>
        <a href="./contact.html" class="nav-link">Contact</a>
      </nav>
      <div class="header-cta">
        <a href="./index.html#workspace" class="btn-open glass-btn"><iconify-icon icon="ph:arrow-right-bold"></iconify-icon> Open a tool</a>
        <button class="mobile-menu-btn" id="mm-menu-btn" aria-label="Open menu" aria-expanded="false"><iconify-icon icon="ph:list-bold"></iconify-icon></button>
      </div>
    </div>
    <nav class="mobile-nav" id="mm-mobile-nav" aria-label="Mobile">
      <a href="./index.html">Tools</a>
      <a href="./index.html#how-it-works">How it works</a>
      <a href="./index.html#faq">FAQ</a>
      <a href="./about.html">About</a>
      <a href="./contact.html">Contact</a>
    </nav>
  </header>

  <main class="page-main">

  <section class="hero glass-hero" id="top">
    <div class="hero-inner">
      <p class="hero-kicker glass-chip"><iconify-icon icon="ph:sparkle-fill"></iconify-icon> 100% in your browser — nothing ever uploads</p>
      <h1 class="hero-title">Every media tool,<br /><span class="grad">one tidy studio.</span></h1>
      <p class="hero-sub">Remove AI watermarks, compress, trim, crop, convert, merge, record and edit PDFs — 26 tools, zero uploads, zero watermarks of our own.</p>
      <div class="hero-actions">
        <a href="#workspace" class="glass-btn big"><iconify-icon icon="ph:cursor-click"></iconify-icon> Pick a tool below</a>
      </div>
      <ul class="hero-badges">
        <li class="glass-chip"><iconify-icon icon="ph:shield-check"></iconify-icon> Private by design</li>
        <li class="glass-chip"><iconify-icon icon="ph:lightning"></iconify-icon> WebCodecs-fast</li>
        <li class="glass-chip"><iconify-icon icon="ph:gift"></iconify-icon> Free, no account</li>
      </ul>
    </div>
  </section>

  <section class="tools-home section-pad" id="tools-home-view">
    <div class="section-inner">
      <h2 class="section-title">Choose your tool</h2>
      <p class="section-sub">Everything runs on this page — your files never leave the device.</p>
      <div id="tools-grid" class="tools-grid" aria-live="polite"></div>
    </div>
  </section>

  <div id="workspace" class="workspace-anchor"></div>
  <section class="tool-stage section-pad" id="workspace-stage">
    <div class="section-inner">
      <div class="stage-head">
        <button class="glass-btn back" id="btn-back-home"><iconify-icon icon="ph:arrow-left-bold"></iconify-icon> All tools</button>
        <h2 class="stage-title" id="stage-title">Tool</h2>
      </div>
      <div id="tool-root"></div>
      <div id="legacy-panels" class="v4-hide">
"""

SHELL_TAIL = """
      </div>
    </div>
  </section>

  <section class="how-it-works-section section-pad" id="how-it-works">
    <div class="section-inner">
      <h2 class="section-title">How it works</h2>
      <div class="hiw-grid">
        <div class="hiw-step glass-card"><span class="hiw-num">1</span><h3>Pick a tool</h3><p>Twenty-five tools across video, audio, image and PDF — all on this one page.</p></div>
        <div class="hiw-step glass-card"><span class="hiw-num">2</span><h3>Drop your file</h3><p>Processing starts in your browser instantly. Nothing uploads, ever.</p></div>
        <div class="hiw-step glass-card"><span class="hiw-num">3</span><h3>Download the result</h3><p>Grab the output file or download everything as a ZIP. Original quality preserved.</p></div>
      </div>
    </div>
  </section>

  <section class="faq-section section-pad" id="faq">
    <div class="section-inner">
      <h2 class="section-title">FAQ</h2>
      <div class="faq-list">
        <details class="faq-item glass-card"><summary>Are my files uploaded anywhere?</summary><p>No. MediaMaid processes everything locally in your browser using WebCodecs and WebAssembly. Your files never leave the device.</p></details>
        <details class="faq-item glass-card"><summary>Which watermarks can it remove?</summary><p>The sparkle-style marks from Gemini, Veo/Flow, Sora, Kling, Grok, Hailuo, Luma, Runway and PixVerse — plus any logo or caption bar you can draw a box around.</p></details>
        <details class="faq-item glass-card"><summary>Is there a file-size limit?</summary><p>No hard limit. The only ceiling is your device's memory — typical phones handle hundreds of megabytes comfortably.</p></details>
        <details class="faq-item glass-card"><summary>Does it cost anything?</summary><p>No. MediaMaid is free, with no account and no watermark on outputs.</p></details>
      </div>
    </div>
  </section>

  </main>

  <footer class="site-footer glass-footer">
    <div class="footer-inner">
      <div class="footer-brand">
        <span class="brand-mark glass-chip" aria-hidden="true"><iconify-icon icon="ph:broom-bold"></iconify-icon></span>
        <div><p class="footer-name">Media<em>Maid</em></p><p class="footer-tag">A tidy toolbox for messy media.</p></div>
      </div>
      <nav class="footer-links" aria-label="Footer">
        <a href="./about.html">About</a>
        <a href="./contact.html">Contact</a>
        <a href="./privacy-policy.html">Privacy</a>
        <a href="./terms-of-service.html">Terms</a>
        <a href="./disclaimer.html">Disclaimer</a>
      </nav>
      <p class="footer-copy">© <span id="mm-year">2026</span> Mohammed Shehzad. Built with WebCodecs — no uploads, no accounts, no nonsense.</p>
    </div>
  </footer>

  <script>
  /* v4 watchdog: must run before main.js so asset failures still report. */
  (function () {
    function banner(msg) {
      var b = document.getElementById('mm-watchdog');
      if (!b) { b = document.createElement('div'); b.id = 'mm-watchdog';
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#7f1d1d;color:#fff;padding:10px 16px;font:14px system-ui;cursor:pointer;text-align:center;';
        b.addEventListener('click', function () { b.remove(); });
        (document.body || document.documentElement).appendChild(b); }
      b.textContent = msg;
    }
    window.__mmBanner = banner;
    window.addEventListener('error', function (e) {
      // only script/stylesheet load failures matter here — favicon/img 404s are noise
      var t = e.target && e.target.tagName;
      if (t === 'SCRIPT' || t === 'LINK') banner('MediaMaid failed to load: ' + (e.target.src || e.target.href || 'asset'));
      else if (!e.target && e.message) banner('MediaMaid hit an error: ' + e.message);
    }, true);
    window.addEventListener('unhandledrejection', function (e) { banner('MediaMaid task failed: ' + (e.reason && e.reason.message || e.reason || 'unknown')); });
    window.addEventListener('DOMContentLoaded', function () {
      if (typeof MediaMaid !== 'undefined' && MediaMaid.initDone) return;
      setTimeout(function () {
        var n = document.querySelectorAll('#tools-grid .tool-card').length;
        if (!n) banner('MediaMaid tools did not load. Hard-refresh (Ctrl+Shift+R); if this persists, your browser may block scripts.');
      }, 4500);
    });
  })();
  </script>
  <script src="./main.js"></script>
  <script src="./universal.js"></script>
  <script src="./compressor.js"></script>
  <script src="./tools-core.js"></script>
  <script src="./tools-video.js"></script>
  <script src="./tools-audio.js"></script>
  <script src="./tools-doc.js"></script>
  <script src="./tools-ui.js"></script>
</body>
</html>
"""

SUBPAGES = ["about.html", "contact.html", "privacy-policy.html",
            "terms-of-service.html", "disclaimer.html"]

CREATOR_RES = [
    (re.compile(r"Ishara Madusanka", re.I), "Mohammed Shehzad"),
    (re.compile(r"Ishara Madu\w*", re.I), "Mohammed Shehzad"),
    # short display form ("Ishara M.") and repair artifacts — AFTER the Madu forms
    (re.compile(r"Ishara M\.", re.I), "Mohammed Shehzad"),
    (re.compile(r"https://https://", re.I), "https://"),  # earlier rebrand left double protocol
    (re.compile(r"https://avatars\.githubusercontent\.com/u/104107127[^\"<\s]*", re.I), "./assets/logo.webp"),
    (re.compile(r"ishara-madu\.github\.io[^\s\"'<)]*", re.I), "https://mdshezkhn.github.io/mediamaid/"),
    (re.compile(r"(?<!/)github\.com/ishara-madu(?:/[a-z-]+)?", re.I), "https://github.com/mdshezkhn"),
    (re.compile(r"buymeacoffee\.com/[^\"'<)\s]+", re.I), "mdshezkhn.github.io/mediamaid"),
]


def main():
    # ── index.html ──
    body = (SHELL_HEAD
            + "\n" + panel("image") + "\n" + panel("video") + "\n"
            + panel("compress-video") + "\n" + panel("compress-image") + "\n"
            + SHELL_TAIL)
    out = ROOT / "index.html"
    if out.exists() and "tools-grid" in out.read_text(encoding="utf-8"):
        print("index.html: already v4 (regenerating anyway)")
    out.write_text(body, encoding="utf-8", newline="\n")
    print(f"index.html generated ({len(body)} chars, panels {sum(len(panel(n)) for n in ['image','video','compress-video','compress-image'])} chars)")

    # ── subpages: scrub creator references ──
    for sub in SUBPAGES:
        p = ROOT / sub
        if not p.exists():
            print(f"{sub}: missing, skipped")
            continue
        t = p.read_text(encoding="utf-8")
        orig = t
        for rx, repl in CREATOR_RES:
            t = rx.sub(repl, t)
        t = t.replace("<title>Gemini Watermark Remover", "<title>MediaMaid")
        if t != orig:
            p.write_text(t, encoding="utf-8", newline="\n")
            print(f"{sub}: rebranded")
        else:
            print(f"{sub}: unchanged")

    # ── vendored lib bundles from npmmirror tarballs ──
    import tarfile
    vd = ROOT / "vendor"
    for tgz, want, outp in (("pdf-lib.tgz", "package/dist/pdf-lib.min.js", "pdf-lib.min.js"),
                            ("lamejs.tgz", "package/lame.min.js", "lame.min.js")):
        arc = vd / tgz
        dst = vd / outp
        if arc.exists():
            with tarfile.open(arc) as tf:
                dst.write_bytes(tf.extractfile(want).read())
            print(f"vendor: wrote {outp} ({dst.stat().st_size} bytes)")
        elif dst.exists():
            print(f"vendor: {outp} kept ({dst.stat().st_size} bytes)")
        else:
            print(f"vendor: WARNING {tgz} missing and {outp} absent")


if __name__ == "__main__":
    main()
