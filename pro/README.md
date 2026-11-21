# Pro CLI — remove_wm.py

Batch / heavy-lifting companion to the web app. Same engines, runs on your
machine, no browser needed. Great for folders of images and long videos
(the web app processes in-browser and is fastest for short clips).

## Setup

```bash
pip install numpy pillow            # required
pip install opencv-python           # optional: much faster inpainting
pip install imageio-ffmpeg          # optional: ffmpeg binary for video
```

Video needs **any ffmpeg** on PATH (or the imageio-ffmpeg wheel).

## Usage

```bash
# auto-detect any corner/caption watermark and remove it (images)
python pro/remove_wm.py photo.png

# exact Gemini / Nano Banana sparkle un-blend (lossless-quality)
python pro/remove_wm.py img.png --preset gemini
python pro/remove_wm.py img.png --preset gemini_classic

# videos — audio is preserved byte-for-byte
python pro/remove_wm.py veo_clip.mp4 --preset veo
python pro/remove_wm.py sora_clip.mp4 --preset sora
python pro/remove_wm.py kling_clip.mp4 --box 1089,641,173,61

# batch a folder of images (writes clean_<name> next to each file)
python pro/remove_wm.py my_folder/

# custom output path + quality
python pro/remove_wm.py clip.mp4 --preset grok --out clean.mp4 --crf 16
```

## Presets

| preset | mark | typical position |
|---|---|---|
| `auto` | corner/caption auto-detect (default) | scans 4 corners + bottom-centre |
| `gemini` | Gemini / Nano Banana sparkle (exact un-blend) | bottom-right, 192px inset |
| `gemini_classic` | Gemini sparkle, classic corner | bottom-right, 64px inset |
| `veo` | Veo / Flow sparkle (exact un-blend) | bottom-right corner |
| `sora` | Sora logo+text | bottom-right |
| `kling` | Kling AI logo | bottom-right |
| `grok` | Grok Imagine mark | bottom-left |
| `hailuo` | Hailuo / MiniMax mark | bottom-right |
| `luma` | Luma Dream Machine mark | bottom-right |
| `runway` | Runway mark | bottom-right |
| `pixverse` | PixVerse mark | bottom-right |
| `caption` | TikTok / CapCut caption bar | bottom-centre |
| `custom` | generic default box (use `--box` for precision) | bottom-right |

Every preset box is a starting point — the generic engine re-detects the
actual strokes inside the box, so being roughly right is enough. For
precision use `--box x,y,w,h` (pixel coordinates).

## Notes

- In `auto` mode the CLI refuses to edit a video when nothing is detected
  (pass `--preset` or `--box` explicitly). Images are likewise copied
  unchanged with a warning.
- Semi-transparent marks are recovered by inverting the alpha blend
  (near-lossless). Opaque regions (solid bars, opaque cores) are inpainted —
  quality there is "clean plausible fill", not pixel-exact.
- Vertical videos, odd dimensions and HEVC sources work; the output is
  H.264 MP4 with the original audio track stream-copied.
