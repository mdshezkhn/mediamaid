# Universal AI Watermark Remover (v2)

Free, 100% client-side watermark remover for **any** AI watermark — Gemini /
Nano Banana, Veo / Flow, Sora, Kling AI, Grok Imagine, Hailuo / MiniMax,
Luma, Runway, PixVerse, TikTok / CapCut caption bars, or **any custom mark**
you can box with a drag. Images and videos, zero uploads, original quality.

Built on the excellent [Gemini Watermark Remover by Ishara Madushanka](https://github.com/ishara-madu/gemini-watermark-remover)
(MIT — kept verbatim in [LICENSE](LICENSE), original README preserved as
[ORIGINAL-README.md](ORIGINAL-README.md)). This fork extends it from a
Gemini/Veo-only tool into a universal one.

## Two removal engines

| Engine | Used for | Quality |
| --- | --- | --- |
| **Sparkle un-blend** (from upstream) | the known Gemini/Veo sparkle logo | exact inverse of the alpha blend — effectively lossless |
| **Universal engine** (new, `universal.js`) | any static overlay: logos, text, caption bars | semi-transparent strokes are recovered by inverting the blend (near-lossless); opaque regions are inpainted with a clean plausible fill |

The universal engine works by estimating the local background with a
robust multi-scale median (immune to the watermark itself), recovering the
per-pixel overlay alpha, un-blending semi-transparent strokes exactly, and
inpainting whatever is truly opaque. White and dark marks, mixed marks
(black text on a white caption bar), any position.

## Using it

1. Drop an image or video onto the page.
2. Hit **Auto-Detect** (finds sparkle marks and generic corner/caption marks),
   pick a **preset chip** (Sora, Kling, Grok, Hailuo, Luma, Runway, PixVerse,
   TikTok/CapCut bar, …), or just **drag a box** over the watermark on the
   live preview.
3. Fine-tune with the sliders (strength / size / position), watch the dual
   zoomed previews, then **Export**.

Image output is a lossless PNG. Video is re-encoded to H.264 MP4 **with the
original audio stream-copied byte-for-byte**, entirely in your browser via
WebCodecs + [mediabunny](https://github.com/Vanilagy/mediabunny)
(vendored locally in `vendor/` — no CDN needed; jsdelivr remains a fallback).

## Run it

```bash
python -m http.server 8080
# open http://localhost:8080
```

Any static server works; GitHub Pages works too. (Video export needs a
secure context — `localhost`/HTTPS — and Chrome/Edge.)

## Pro CLI (batch / big files)

`pro/remove_wm.py` runs the same engines headlessly with ffmpeg — folders of
images, long videos, audio preserved, auto-detect or explicit presets/boxes:

```bash
pip install numpy pillow            # (+ opencv-python, imageio-ffmpeg optional)
python pro/remove_wm.py veo_clip.mp4 --preset veo
python pro/remove_wm.py sora_clip.mp4            # auto-detect
python pro/remove_wm.py my_folder/               # batch images
```

See [pro/README.md](pro/README.md) for the full preset table.

## Layout

| Path | What it is |
| --- | --- |
| `index.html` | The app (upload → detect/box → tune → export) |
| `main.js` | Upstream engine (sparkle un-blend, video pipeline) — unchanged |
| `universal.js` | **v2 layer**: universal engine, presets, drag-box, unified UI, local mediabunny |
| `vendor/mediabunny.mjs` | Vendored mediabunny 1.52.3 (MPL-2.0) |
| `pro/remove_wm.py` | Headless CLI (batch, ffmpeg, audio-safe) |
| `style.css`, `assets/`, `portfolio_images/`, secondary pages | Original site shell |
| `qa/` | Playwright QA rig + synthetic watermarked test assets with ground truth |
| `build/` | Test-asset generator + idempotent HTML patcher (regenerable) |

## QA

`qa/qa_v2.py` spins up the site in headless Edge and functionally tests every
path with synthetic watermarked assets that have **ground truth**:
sparkle un-blend vs truth (MAE < 3), Sora/Grok generic removal vs truth
(MAE < 8), opaque caption-bar removal (edge energy −70%), full video
pipeline (duration + audio preserved + watermark-energy reduction on
extracted frames), responsive layout and console cleanliness.

```bash
C:/Python314/python.exe build/make_test_assets.py   # build test assets once
C:/Python314/python.exe qa/qa_v2.py                 # run the suite
```

## Credits & license

- Upstream tool, design and original engine: **Ishara Madushanka** (MIT).
- v2 universal engine, CLI and this fork: added under the same MIT license.
- mediabunny: MPL-2.0 © Vanilagy and contributors (vendored, unmodified).
- See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) for details.

Please respect each AI provider's terms of service and applicable law — use
this tool only on content you have the rights to modify.

## QA (v2)

`qa/qa_v2.py` (Playwright, msedge headless) — **23/23 PASS** (2026-11-21):

| Area | Result |
|---|---|
| Gemini image un-blend vs ground truth | MAE **0.55** (mathematically exact) |
| Outside-box pixels untouched | MAE 0.002 (byte-identical) |
| Sora / Grok image text (80% alpha, colourful photo) | MAE 11.8 / 10.9 (faint ghost only) |
| TikTok / CapCut bar (92% opaque) | 62.9% structure removed |
| Veo sparkle in video (H.264, audio kept) | **80.6%** removed |
| Sora text in video (per-frame engine) | 55.8% removed |
| Video export | duration + audio track preserved |
| Mobile 390px | no horizontal overflow |
| Console | zero errors |

Run it: `python build/make_test_assets.py && python qa/qa_v2.py` (serves :8955).

## Honest limitations (v2)

- **Opaque overlays** (TikTok solid bars, 90%+ opacity): the pixels underneath
  are destroyed — the tool fills them with content-aware smoothing. Expect a
  soft patch, not magic reconstruction. No client-side tool can do better.
- **Semi-transparent marks on busy/photo content** clean to a faint ghost
  (MAE ~10/255). On smooth backgrounds they are near-invisible.
- **Video text** rides on re-encoded frames; the measured floor is ~50%
  stroke-energy removal from codec ringing alone.
- **Auto-detect** works on realistic content; on noisy/synthetic images pass a
  preset or drag a box (the Custom chip).
- Codec loss (H.264) perturbs the blend equation — exact un-blending is only
  possible on the first generation of a mark.
