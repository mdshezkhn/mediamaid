#!/usr/bin/env python3
"""Generate synthetic watermarked test assets + ground truth for QA.
Run from repo root:  C:/Python314/python.exe build/make_test_assets.py
Outputs -> qa/assets/
"""
import sys, struct, math, random
from pathlib import Path
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "qa" / "assets"
OUT.mkdir(parents=True, exist_ok=True)

rng = np.random.default_rng(42)

def value_noise(w, h, octaves=5, seed=7):
    """Smooth multi-octave noise background that looks photo-ish."""
    r = np.random.default_rng(seed)
    acc = np.zeros((h, w), dtype=np.float32)
    amp = 1.0
    for o in range(octaves):
        if o < 1:
            amp *= 0.35  # suppress the finest octave (white-noise look)
            continue
        gw, gh = max(2, w >> o), max(2, h >> o)
        small = r.random((gh, gw)).astype(np.float32)
        img = Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        acc += np.asarray(img, dtype=np.float32) / 255.0 * amp
        amp *= 0.6
    acc -= acc.min()
    acc /= max(1e-6, acc.max())
    return acc

def make_photo(w, h, seed, hue_shift=0.0):
    """Real-photo background: repo webp photo bases (deterministic pick by
    seed), upscaled/cropped to the requested size. Realistic local statistics
    are what the engine must survive in production."""
    bases = ["assets/bg1.webp", "assets/bg2.webp", "assets/after.webp"]
    src = Image.open(bases[seed % len(bases)]).convert("RGB")
    sw, sh = src.size
    scale = max(w / sw, h / sh)
    src = src.resize((max(w, round(sw * scale)), max(h, round(sh * scale))), Image.LANCZOS)
    sw2, sh2 = src.size
    ox = min(sw2 - w, (seed * 37) % max(1, sw2 - w)) if sw2 > w else 0
    oy = min(sh2 - h, (seed * 53) % max(1, sh2 - h)) if sh2 > h else 0
    return np.asarray(src.crop((ox, oy, ox + w, oy + h)), dtype=np.uint8)

def blend_white(bg, wm_rgba, x, y, alpha_scale=1.0):
    """px = bg*(1-a) + 255*a  — same model the app's un-blend inverts.
    Alpha comes from the watermark RGB brightness (logo on black), exactly like
    main.js calculateAlphaMap (PNG alpha channel ignored)."""
    h, w = wm_rgba.shape[:2]
    rgb = wm_rgba[:, :, :3].astype(np.float32)
    a = rgb.max(axis=-1, keepdims=True) / 255.0 * alpha_scale
    roi = bg[y:y + h, x:x + w].astype(np.float32)
    out = roi * (1 - a) + 255.0 * a
    bg[y:y + h, x:x + w] = np.clip(out, 0, 255).astype(np.uint8)
    return bg

def draw_text_wm(img, text, box, alpha=0.78, fill=(255, 255, 255), size=None, anchor_at="center"):
    """Semi-transparent monochrome text watermark inside box on an RGBA overlay."""
    x, y, w, h = box
    overlay = Image.new("RGBA", img.shape[1], (0, 0, 0, 0)) if False else Image.new("RGBA", (img.shape[1], img.shape[0]), (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    fs = size or int(h * 0.62)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/arialbd.ttf", fs)
    except Exception:
        font = ImageFont.load_default()
    cx, cy = x + w // 2, y + h // 2
    d.text((cx, cy), text, font=font, fill=(*fill, int(255 * alpha)), anchor="mm")
    base = Image.fromarray(img).convert("RGBA")
    out = Image.alpha_composite(base, overlay).convert("RGB")
    return np.asarray(out, dtype=np.uint8)

# ── geometry helpers mirroring the JS ──
def gemini_new_box(w, h):
    mind = min(w, h); ratio = mind / 1536
    size = max(16, round(96 * ratio)); margin = max(8, round(64 * ratio))
    base_x = max(0, w - margin - size); base_y = max(0, h - margin - size)
    off = round(-128 * ratio)
    return (max(0, base_x + off), max(0, base_y + off), size, size)

def uni_box(preset, w, h):
    g = {
        "sora":    ("br", 0.24, 0.085, 0.025),
        "kling":   ("br", 0.20, 0.075, 0.030),
        "grok":    ("bl", 0.20, 0.075, 0.030),
        "hailuo":  ("br", 0.22, 0.080, 0.025),
        "luma":    ("br", 0.24, 0.075, 0.025),
        "runway":  ("br", 0.20, 0.070, 0.030),
        "pixverse":("br", 0.20, 0.075, 0.030),
        "caption": ("bc", 0.94, 0.16, 0.015),
        "custom":  ("br", 0.22, 0.080, 0.030),
    }[preset]
    anchor, wF, hF, mF = g
    base = min(w, h)
    bw = max(24, round(base * wF)); bh = max(12, round(base * hF)); m = max(4, round(base * mF))
    if anchor == "br":   x, y = w - m - bw, h - m - bh
    elif anchor == "bl": x, y = m, h - m - bh
    elif anchor == "bc": x, y = (w - bw) // 2, h - m - bh
    return (x, y, bw, bh)

def veo_box(w, h):
    base = min(w, h)
    size = max(24, min(round(base / 15), base)); margin = round(base / 10)
    bx, by = max(0, w - margin - size), max(0, h - margin - size)
    off = round(-24 * (base / 720))
    return (max(0, bx + off), max(0, by + off), size, size)

sparkle = np.asarray(Image.open(ROOT / "assets" / "bg_96.png").convert("RGBA"), dtype=np.uint8)

# ── 1. Gemini sparkle image (1536², 'new' adaptive position) ──
W = H = 1536
base_img = np.array(make_photo(W, H, seed=11), copy=True)
Image.fromarray(base_img).save(OUT / "truth_1536.png")
gx, gy, gw, gh = gemini_new_box(W, H)
wm_img = base_img.copy()
wm_img = blend_white(wm_img, sparkle, gx, gy, alpha_scale=0.6)  # = app 'new' preset gain
Image.fromarray(wm_img).save(OUT / "test_gemini.png")
print("gemini box:", (gx, gy, gw, gh))

# ── 2. Sora image 1280×720 ──
W2, H2 = 1280, 720
base2 = np.array(make_photo(W2, H2, seed=22, hue_shift=1.2), copy=True)
Image.fromarray(base2).save(OUT / "truth_1280.png")
sx, sy, sw, sh = uni_box("sora", W2, H2)
sora_img = draw_text_wm(base2, "SORA", (sx, sy, sw, sh), alpha=0.8)
Image.fromarray(sora_img).save(OUT / "test_sora.png")
print("sora box:", (sx, sy, sw, sh))

# ── 3. Grok image (bottom-LEFT) ──
bx, by, bw, bh = uni_box("grok", W2, H2)
grok_img = draw_text_wm(base2, "GROK", (bx, by, bw, bh), alpha=0.8)
Image.fromarray(grok_img).save(OUT / "test_grok.png")
print("grok box:", (bx, by, bw, bh))

# ── 4. Caption bar (opaque white + black text → inpaint path) ──
cx, cy, cw, ch = uni_box("caption", W2, H2)
cap = base2.copy().astype(np.float32)
cap[cy:cy + ch, cx:cx + cw] = 0.92 * 255  # near-white bar
cap = np.clip(cap, 0, 255).astype(np.uint8)
cap = draw_text_wm(cap, "Made with CapCut", (cx + cw // 6, cy + ch // 4, cw * 2 // 3, ch // 2),
                   alpha=0.85, fill=(20, 20, 20))
Image.fromarray(cap).save(OUT / "test_caption.png")
print("caption box:", (cx, cy, cw, ch))

# ── 5. Veo video frames (3s, 24fps, moving bg + sparkle + SORA text) ──
import subprocess, imageio_ffmpeg
FPS, DUR = 24, 3
vw, vh = 1280, 720
vx, vy, vws, vhs = veo_box(vw, vh)
# the engine cleans a vws×vhs box — the drawn sparkle must match that size
sparkle_v = np.asarray(
    Image.fromarray(sparkle).resize((vws, vhs), Image.LANCZOS).convert("RGBA"),
    dtype=np.uint8)
sxv, syv, swv, shv = uni_box("sora", vw, vh)
tmpdir = ROOT / "build" / "frames"
tmpdir.mkdir(parents=True, exist_ok=True)
for f in range(FPS * DUR):
    t = f / FPS
    frame = np.array(make_photo(vw, vh, seed=33 + (f % 6), hue_shift=t * 1.5), copy=True)  # changing content
    frame = blend_white(frame, sparkle_v, vx, vy, alpha_scale=0.6)  # = app video gain
    frame = draw_text_wm(frame, "SORA", (sxv, syv, swv, shv), alpha=0.8)
    Image.fromarray(frame).save(tmpdir / f"f_{f:03d}.png")

ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
# audio: 3s 440Hz sine
cmd = [ffmpeg, "-y", "-framerate", str(FPS), "-i", str(tmpdir / "f_%03d.png"),
       "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
       "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20",
       "-c:a", "aac", "-b:a", "96k", "-shortest", "-movflags", "+faststart",
       str(OUT / "test_veo.mp4")]
subprocess.run(cmd, check=True, capture_output=True)
print("video written:", (OUT / "test_veo.mp4").stat().st_size, "bytes")
print("veo sparkle box:", (vx, vy, vws, vhs), " sora box:", (sxv, syv, swv, shv))

# ground-truth video frame boxes for measurement (same coords)
import json
meta = {
    "gemini": {"box": [int(gx), int(gy), int(gw), int(gh)], "dims": [W, H]},
    "sora": {"box": [int(sx), int(sy), int(sw), int(sh)], "dims": [W2, H2]},
    "grok": {"box": [int(bx), int(by), int(bw), int(bh)], "dims": [W2, H2]},
    "caption": {"box": [int(cx), int(cy), int(cw), int(ch)], "dims": [W2, H2]},
    "video": {"dims": [vw, vh], "veo_box": [int(vx), int(vy), int(vws), int(vhs)],
              "sora_box": [int(sxv), int(syv), int(swv), int(shv)], "fps": FPS, "dur": DUR},
}
(OUT / "meta.json").write_text(json.dumps(meta, indent=1))
print("meta.json written")
print("DONE")
