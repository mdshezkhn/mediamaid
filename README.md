# MediaMaid — Watermark Remover & Video/Image Compressor

**Live:** https://mdshezkhn.github.io/mediamaid/

A 100% client-side media toolkit. Remove AI watermarks (Gemini, Veo, Sora, Kling, Grok, Hailuo, Luma, Runway, PixVerse — or any logo you can draw a box around) and compress video & images to any target size. **Nothing is ever uploaded** — all processing happens in your browser via WebCodecs + mediabunny.

## Tools

### 1. Watermark Remover (images)
- Exact alpha-map un-blending for Gemini / Nano Banana / Veo sparkles (mathematically reverses the blend — no blur, no AI guessing)
- Generic engine for any mark: per-channel alpha estimation, mark-aware background re-estimation, dual-polarity un-blend, diffusion inpaint
- Presets: Gemini (new/classic), Sora, Grok Imagine, TikTok/CapCut caption bar, Custom drag-box

### 2. Watermark Remover (videos)
- Frame-by-frame processing through WebCodecs, audio passed through untouched
- Presets: Veo/Flow (adaptive), Veo corner, standard sparkle, Sora, Kling, Grok, Hailuo, Luma, Runway, PixVerse, caption bar, Custom drag-box
- Auto-detect scans corners for the mark and shows a match badge

### 3. Video Compressor (v3)
- **By quality** (5 stops), **Target a file size** (% of original, with one automatic refinement pass), or **Set max bitrate**
- Advanced: H.264 / H.265 / VP9 / AV1 (probed — unsupported codecs are disabled), MP4/WebM, resolution cap (1080p–360p), frame-rate cap (30/24), remove-audio
- Batch queue with per-file progress, before/after sizes, % saved, per-file download + **Download all (.zip)**
- No file-size limits, no upload — unlike cloud compressors

### 4. Image Compressor (v3)
- **By quality** (1–10) or **Target a file size in KB** (binary search on quality)
- Format: JPEG / WebP; max-dimension downscale (4K → 720px)
- Batch queue + ZIP download

## Pro CLI (batch / big files)

`pro/remove_wm.py` — same engines outside the browser (watermark removal + video processing with audio preservation). Python 3.10+, optional OpenCV for TELEA inpainting.

## Honest limits

- Opaque overlays (fully-hidden content) get a clean soft fill — pixels under them are destroyed in the source; nothing can truly reconstruct them
- Video text removal floors around ~50% visibility due to codec ringing
- AV1 encoding is slow; H.264 is the compatibility default
- HEVC/AV1 outputs may not play in older browsers/players

## Privacy

No uploads, no analytics, no cookies. Everything runs locally; closing the tab erases everything.

## Credits & license

- Original Gemini watermark engine: [ishara-madu/gemini-watermark-remover](https://github.com/ishara-madu/gemini-watermark-remover) (MIT © Ishara Madushanka) — see `ORIGINAL-README.md`, `LICENSE`
- Video pipeline: [mediabunny](https://mediabunny.dev) v1.52.3 (MPL-2.0), vendored at `vendor/mediabunny.mjs` — see `THIRD-PARTY-NOTICES.md`
- v2 universal engine, v3 compressor & rebrand: Mohammed Shehzad
- Compressor UX is feature-equivalent to freeconvert.com/video-compressor (methods: quality / target size / max bitrate) — clean-room implementation, no code or assets copied
