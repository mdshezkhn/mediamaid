# THIRD-PARTY NOTICES

This project builds on the following third-party software:

## 1. gemini-watermark-remover (upstream)

- Source: https://github.com/ishara-madu/gemini-watermark-remover
- License: MIT © Ishara Madushanka (see `LICENSE` and `ORIGINAL-README.md`)
- The original site shell, styling, Gemini/Veo sparkle un-blend engine
  (`main.js`) and the pixel-identical clone structure originate from this
  project. The v2 universal engine is an additive layer (`universal.js`).

## 2. mediabunny (vendored)

- Source: https://github.com/Vanilagy/mediabunny
- Vendored file: `vendor/mediabunny.mjs` (v1.52.3, built from the npm
  tarball `mediabunny-1.52.3.tgz`, unmodified)
- License: Mozilla Public License 2.0 © Vanilagy and contributors
  (license header preserved inside the vendored file)
- Used for in-browser video demuxing/decoding/encoding (WebCodecs wrapper)
  and audio passthrough. Local vendoring removes the jsdelivr CDN runtime
  dependency (jsdelivr is unreliable in mainland China); the CDN remains as
  a fallback for `file://` usage.

## 3. Runtime CDN dependencies (not vendored)

- iconify-icon 1.0.7 (iconify.design) — UI icons
- Tailwind CSS classes referenced by the original markup are inlined in
  `style.css` (no runtime CDN needed for layout)

## 4. pro/ CLI dependencies (user-installed, not bundled)

- numpy, pillow — BSD/MIT
- opencv-python (optional, faster inpaint) — Apache-2.0
- imageio-ffmpeg (optional, ffmpeg binary) — BSD-2
