#!/usr/bin/env python3
"""
remove_wm.py — Universal Watermark Remover, Pro CLI (batch / big files).

Same engines as the web app:
  * sparkle : exact alpha un-blend for the Gemini / Veo sparkle logo
              (uses assets/bg_96.png / bg_48.png from this repo)
  * generic : local-median background -> alpha recovery -> un-blend +
              inpaint for ANY static watermark (Sora, Kling, Grok, Hailuo,
              Luma, Runway, PixVerse, TikTok/CapCut caption bars, custom box)

Examples
--------
  python pro/remove_wm.py img.png                      # auto-detect + remove
  python pro/remove_wm.py img.png --preset gemini      # exact sparkle un-blend
  python pro/remove_wm.py clip.mp4 --preset veo        # video, audio preserved
  python pro/remove_wm.py clip.mp4 --preset sora
  python pro/remove_wm.py clip.mp4 --box 1089,641,173,61
  python pro/remove_wm.py folder_of_images --out clean # batch images

Requires: numpy, pillow  (optional: opencv-python for faster inpaint)
Video additionally needs an ffmpeg binary (system ffmpeg, or the one that
ships with `pip install imageio-ffmpeg`).
"""
import argparse, math, os, shutil, subprocess, sys, tempfile
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SPARKLE = Image.open(ROOT / "assets" / "bg_96.png").convert("RGB")
SPARKLE48 = Image.open(ROOT / "assets" / "bg_48.png").convert("RGB")

try:
    import cv2
    HAS_CV2 = True
except ImportError:
    cv2 = None
    HAS_CV2 = False

# ── preset geometry (mirrors universal.js) ──────────────────────────────────
GEOM = {
    "gemini":   ("br", None, None, None),   # exact sparkle geometry (see below)
    "gemini_classic": ("br", None, None, None),
    "veo":      ("br", None, None, None),
    "sora":     ("br", 0.24, 0.085, 0.025),
    "kling":    ("br", 0.20, 0.075, 0.030),
    "grok":     ("bl", 0.20, 0.075, 0.030),
    "hailuo":   ("br", 0.22, 0.080, 0.025),
    "luma":     ("br", 0.24, 0.075, 0.025),
    "runway":   ("br", 0.20, 0.070, 0.030),
    "pixverse": ("br", 0.20, 0.075, 0.030),
    "caption":  ("bc", 0.94, 0.16, 0.015),
    "custom":   ("br", 0.22, 0.080, 0.030),
}

def gemini_box(w, h, classic=False):
    mind = min(w, h); ratio = mind / 1536.0
    size = max(16, round(96 * ratio)); margin = max(8, round(64 * ratio))
    bx, by = max(0, w - margin - size), max(0, h - margin - size)
    if classic:
        return [bx, by, size, size]
    off = round(-128 * ratio)
    return [max(0, bx + off), max(0, by + off), size, size]

def veo_box(w, h):
    base = min(w, h)
    size = max(24, min(round(base / 15), base)); margin = round(base / 10)
    bx, by = max(0, w - margin - size), max(0, h - margin - size)
    off = round(-24 * (base / 720))
    return [max(0, bx + off), max(0, by + off), size, size]

def preset_box(preset, w, h):
    if preset == "gemini":
        return gemini_box(w, h)
    if preset == "gemini_classic":
        return gemini_box(w, h, classic=True)
    if preset == "veo":
        return veo_box(w, h)
    anchor, wF, hF, mF = GEOM[preset]
    base = min(w, h)
    bw = max(24, round(base * wF)); bh = max(12, round(base * hF)); m = max(4, round(base * mF))
    if anchor == "br":
        x, y = w - m - bw, h - m - bh
    elif anchor == "bl":
        x, y = m, h - m - bh
    else:
        x, y = (w - bw) // 2, h - m - bh
    return [x, y, bw, bh]

def clamp_box(box, w, h):
    x = max(0, min(int(box[0]), w - 4)); y = max(0, min(int(box[1]), h - 4))
    bw = max(4, min(int(box[2]), w - x)); bh = max(4, min(int(box[3]), h - y))
    return [x, y, bw, bh]

# ── generic engine (numpy port of universal.js) ─────────────────────────────
def block_median_bg(L, cell):
    h, w = L.shape
    gh, gw = math.ceil(h / cell), math.ceil(w / cell)
    ph, pw = gh * cell, gw * cell
    P = np.full((ph, pw), np.median(L), dtype=np.float32)
    P[:h, :w] = L
    cells = P.reshape(gh, cell, gw, cell).transpose(0, 2, 1, 3).reshape(gh, gw, cell * cell)
    med = np.median(cells, axis=2).astype(np.float32)
    return np.asarray(Image.fromarray(np.clip(med, 0, 255).astype(np.uint8)).resize((w, h), Image.BILINEAR), dtype=np.float32)

def dilate(a, passes=2):
    for _ in range(passes):
        p = np.pad(a, 1, mode="edge")
        a = np.maximum.reduce([p[:-2, :-2], p[:-2, 1:-1], p[:-2, 2:],
                               p[1:-1, :-2], p[1:-1, 1:-1], p[1:-1, 2:],
                               p[2:, :-2], p[2:, 1:-1], p[2:, 2:]])
    return a

def inpaint_diffuse(roi, mask, B, iters=320):
    """Jacobi diffusion on masked pixels (per channel)."""
    out = roi.astype(np.float32).copy()
    for c in range(3):
        ch = out[..., c]
        ch[mask] = B[mask]
        for _ in range(iters):
            p = np.pad(ch, 1, mode="edge")
            nb = (p[:-2, 1:-1] + p[2:, 1:-1] + p[1:-1, :-2] + p[1:-1, 2:]) / 4.0
            delta = np.abs(nb - ch).max()
            ch[mask] = nb[mask]
            if delta < 0.35:
                break
        out[..., c] = ch
    return np.clip(out, 0, 255).astype(np.uint8)

def inpaint_edges(roi, mask, B):
    """O(n) row/col interpolation for big opaque regions."""
    out = roi.astype(np.float32).copy()
    h, w = mask.shape
    for y in range(h):
        x = 0
        row = mask[y]
        while x < w:
            if not row[x]:
                x += 1; continue
            x0 = x
            while x < w and row[x]:
                x += 1
            x1 = x - 1
            for c in range(3):
                lv = out[y, x0 - 1, c] if x0 > 0 else None
                rv = out[y, x1 + 1, c] if x1 < w - 1 else None
                for xx in range(x0, x1 + 1):
                    if lv is not None and rv is not None:
                        v = lv + (rv - lv) * ((xx - x0 + 1) / (x1 - x0 + 2))
                    elif lv is not None:
                        v = lv
                    elif rv is not None:
                        v = rv
                    else:
                        v = B[y, xx]
                    out[y, xx, c] = v
    for x in range(w):
        y = 0
        col = mask[:, x]
        while y < h:
            if not col[y]:
                y += 1; continue
            y0 = y
            while y < h and col[y]:
                y += 1
            y1 = y - 1
            for c in range(3):
                tv = out[y0 - 1, x, c] if y0 > 0 else None
                bv = out[y1 + 1, x, c] if y1 < h - 1 else None
                for yy in range(y0, y1 + 1):
                    if tv is not None and bv is not None:
                        v = tv + (bv - tv) * ((yy - y0 + 1) / (y1 - y0 + 2))
                    elif tv is not None:
                        v = tv
                    elif bv is not None:
                        v = bv
                    else:
                        v = out[yy, x, c]
                    out[yy, x, c] = (v + out[yy, x, c]) / 2.0
    return np.clip(out, 0, 255).astype(np.uint8)

def estimate_background(L, rw, rh, exclude=None):
    """Robust background: cell medians → 5×5 median filter → ring check →
    diffusion-fill invalid cells (mirrors uniEstimateBackground in JS).
    `exclude` (bool HxW): confident-mark pixels — excluded from cell medians
    so large semi-transparent overlays cannot contaminate the estimate."""
    g = 6
    gh, gw = max(2, math.ceil(rh / g)), max(2, math.ceil(rw / g))
    P = np.full((gh * g, gw * g), np.median(L), dtype=np.float32)
    P[:rh, :rw] = L
    if exclude is not None:
        E = np.full((gh * g, gw * g), False)
        E[:rh, :rw] = exclude
        Pm = np.where(E, np.nan, P).astype(np.float32)
    else:
        Pm = P
    cells = Pm.reshape(gh, g, gw, g).transpose(0, 2, 1, 3).reshape(gh, gw, g * g)
    with np.errstate(all="ignore"):
        v = np.nanmedian(cells, axis=2)
    invalid_cell = ~np.isfinite(v)

    k = 2
    v_fill = np.where(np.isfinite(v), v, np.nanmedian(v) if np.isfinite(np.nanmedian(v)) else 0.0)
    vp = np.pad(v_fill, k, mode="edge")
    win = np.stack([vp[dy:dy + gh, dx:dx + gw] for dy in range(2 * k + 1) for dx in range(2 * k + 1)])
    v_local = np.median(win, axis=0)

    ring = np.concatenate([v[0, :], v[-1, :], v[:, 0], v[:, -1]])
    ring = ring[np.isfinite(ring)]
    v_ring = float(np.median(ring)) if ring.size else float(np.nanmedian(v))

    ok = np.isfinite(v)
    valid = ok & (np.abs(np.where(ok, v, 0) - v_local) < 40) & (np.abs(np.where(ok, v, 0) - v_ring) < 80)
    n_valid = int(valid.sum())
    if n_valid < max(4, v.size * 0.15):
        Bg = np.where(np.isfinite(v), v, v_local)
    else:
        Bg = np.where(valid, v_local, 0.0)
        for _ in range(400):
            pp = np.pad(Bg, 1, mode="edge")
            nb = (pp[:-2, 1:-1] + pp[2:, 1:-1] + pp[1:-1, :-2] + pp[1:-1, 2:]) / 4.0
            todo = ~valid
            delta = np.abs(nb[todo] - Bg[todo]).max() if todo.any() else 0.0
            Bg[todo] = nb[todo]
            if delta < 0.3:
                break
        Bg = np.where(valid | True, Bg, Bg)  # all cells now filled
    return np.asarray(Image.fromarray(np.clip(Bg, 0, 255).astype(np.uint8)).resize((rw, rh), Image.BILINEAR), dtype=np.float32)

def median3x3(a):
    """3×3 median filter (2D float32) — coherence test for significance maps."""
    pads = np.pad(a, 1, mode="constant")
    stack = np.stack([pads[dy:dy + a.shape[0], dx:dx + a.shape[1]]
                      for dy in range(3) for dx in range(3)])
    return np.median(stack, axis=0)


def smooth_masked(out, mask, rounds=2):
    """3×3 mean over masked pixels only (inpaint polish, parity with JS)."""
    h, w = mask.shape
    for _ in range(rounds):
        src = out.copy()
        acc = np.zeros_like(out)
        cnt = np.zeros((h, w), dtype=np.float32)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                # source window shifted by (dy,dx), aligned to the valid core
                ys0, ys1 = max(0, dy), min(h, h + dy)
                xs0, xs1 = max(0, dx), min(w, w + dx)
                yd0, yd1 = max(0, -dy), min(h, h - dy)
                xd0, xd1 = max(0, -dx), min(w, w - dx)
                acc[yd0:yd1, xd0:xd1] += src[ys0:ys1, xs0:xs1]
                cnt[yd0:yd1, xd0:xd1] += 1
        mean = acc / np.maximum(cnt[..., None], 1)
        m = mask[..., None]
        out[:] = np.where(m, 0.5 * src + 0.5 * mean, out)
    return out


def clean_generic(img, box, strength=1.0, polarity="auto"):
    """img: HxWx3 uint8. Removes any static watermark inside box. Returns new array.

    Per-pixel dual polarity: px = B·(1−a) + logoValue·a, so
      white overlay (dev>0):  a = dev/(255−B),  orig = (px − 255a)/(1−a)
      dark  overlay (dev<0):  a = −dev/B,       orig = px/(1−a)
    Both formulas are exact for the sRGB blend model, so mixed marks
    (black text on a white caption bar) are handled pixel-by-pixel.
    """
    h, w = img.shape[:2]
    box = clamp_box(box, w, h)
    x, y, bw, bh = box
    pad = max(4, round(min(bw, bh) * 0.18))
    rx, ry = max(0, x - pad), max(0, y - pad)
    rw, rh = min(w - rx, bw + pad * 2), min(h - ry, bh + pad * 2)
    roi = img[ry:ry + rh, rx:rx + rw].astype(np.float32)
    L = 0.299 * roi[..., 0] + 0.587 * roi[..., 1] + 0.114 * roi[..., 2]

    Bch = [estimate_background(roi[..., c], rw, rh) for c in range(3)]
    B = 0.299 * Bch[0] + 0.587 * Bch[1] + 0.114 * Bch[2]
    out = roi.copy()

    def per_channel_alpha(src, Bch_l):
        """alpha from the median of the three per-channel estimates — robust
        on coloured backgrounds where luminance-only alpha drifts chroma."""
        est = []
        for c in range(3):
            Bc = Bch_l[c]
            pc = src[..., c]
            dev_c = pc - Bc
            dw = 255.0 - Bc
            awc = np.where((dev_c > 0) & (dw > 8), dev_c / np.maximum(dw, 1e-6), np.nan)
            adc = np.where((dev_c < 0) & (Bc > 8), (-dev_c) / np.maximum(Bc, 1e-6), np.nan)
            est.append(np.where(dev_c >= 0, awc, adc))
        stack = np.stack(est)
        with np.errstate(all="ignore"):
            a = np.nanmedian(stack, axis=0)
        a = np.where(np.isfinite(a), a, 0.0)
        dev_lum = (0.299 * src[..., 0] + 0.587 * src[..., 1] + 0.114 * src[..., 2]) \
            - (0.299 * Bch_l[0] + 0.587 * Bch_l[1] + 0.114 * Bch_l[2])
        return np.clip(a * strength, 0, 1), dev_lum

    # two passes: pass 2 re-estimates the background from the once-cleaned
    # ROI, removing the bias the watermark itself introduced into pass 1
    for pass_i in range(2):
        if pass_i == 1:
            Bch = [estimate_background(out[..., c], rw, rh) for c in range(3)]
            B = 0.299 * Bch[0] + 0.587 * Bch[1] + 0.114 * Bch[2]
        a, dev = per_channel_alpha(out, Bch)
        a[a < 0.05] = 0

        # mark-aware re-estimation (pass 0 only, BEFORE the single un-blend):
        # confident-mark pixels (alpha > 0.35) are excluded from the cell
        # medians so big semi-transparent overlays (caption bars) cannot
        # contaminate B. The stronger mark-aware alpha wins per pixel.
        if pass_i == 0:
            mark = a > 0.35
            frac = mark.mean()
            if 0.04 < frac < 0.92:
                Bch2 = [estimate_background(out[..., c], rw, rh, exclude=mark) for c in range(3)]
                a2, dev2 = per_channel_alpha(out, Bch2)
                a2[a2 < 0.05] = 0
                med2 = median3x3((a2 > 0.12).astype(np.float32))
                a2 = np.where(med2 >= 0.5, a2, 0.0)
                a = np.maximum(a, a2)
                dev = dev2
                Bch = Bch2
                B = 0.299 * Bch2[0] + 0.587 * Bch2[1] + 0.114 * Bch2[2]

        # morphological opening on the significant-alpha mask: keeps coherent
        # text/logo strokes, drops isolated texture-noise specks
        binm = (a > 0.15).astype(np.uint8)
        sig = int(binm.sum())
        if sig >= 60:
            er = binm[1:-1, 1:-1].astype(bool)
            for dy, dx in ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)):
                er &= binm[1 + dy:binm.shape[0] - 1 + dy, 1 + dx:binm.shape[1] - 1 + dx].astype(bool)
            opened = np.zeros_like(binm, dtype=bool)
            opened[1:-1, 1:-1] = er
            if int(opened.sum()) >= 40:
                gate = dilate(opened.astype(np.float32), 1) > 0
                a = np.where(gate, a, 0.0)
        # coherence gate (parity with JS): 3×3 median of the significance map
        med = median3x3((a > 0.12).astype(np.float32))
        a = np.where(med >= 0.5, a, 0.0)
        # NOTE: the un-blend below uses RAW alpha — dilating alpha would
        # over-correct anti-aliased edges (dark ghost halos).

        opaque = a >= 0.93
        partial = (a > 0) & ~opaque
        is_white = partial & (dev >= 0)
        is_dark = partial & (dev < 0)
        inv = 1.0 / (1.0 - a[is_white])
        for c in range(3):
            ch = out[..., c]
            ch[is_white] = np.clip((ch[is_white] - a[is_white] * 255) * inv, 0, 255)
        inv = 1.0 / (1.0 - a[is_dark])
        for c in range(3):
            ch = out[..., c]
            ch[is_dark] = np.clip(ch[is_dark] * inv, 0, 255)

    L2 = 0.299 * out[..., 0] + 0.587 * out[..., 1] + 0.114 * out[..., 2]
    residual = np.abs(L2 - B) > 30
    # grow the opaque mask by 1 px so the AA ring around opaque cores is
    # inpainted rather than un-blended with a bad alpha estimate
    mask = (dilate(opaque.astype(np.float32), 1) > 0) | residual
    if mask.any():
        cov = mask.mean()
        if HAS_CV2:
            res = cv2.inpaint(out.astype(np.uint8), (mask * 255).astype(np.uint8), 3, cv2.INPAINT_TELEA)
            out = res.astype(np.float32)
        elif cov > 0.12:
            out = inpaint_edges(out, mask, B).astype(np.float32)
        else:
            out = inpaint_diffuse(out, mask, B).astype(np.float32)
        out = smooth_masked(out, mask)

    img = img.copy()
    img[ry:ry + rh, rx:rx + rw] = np.clip(out, 0, 255).astype(np.uint8)
    return img

def clean_sparkle(img, box, gain=1.0):
    """Exact un-blend using the repo's sparkle logo alpha."""
    h, w = img.shape[:2]
    x, y, bw, bh = clamp_box(box, w, h)
    tmpl = SPARKLE.resize((bw, bh), Image.LANCZOS)
    a = np.asarray(tmpl, dtype=np.float32).max(axis=-1) / 255.0 * gain
    a = np.clip(a, 0, 0.99)
    roi = img[y:y + bh, x:x + bw].astype(np.float32)
    m = a > 0.002
    inv = 1.0 / (1.0 - a[m])
    for c in range(3):
        ch = roi[..., c]
        ch[m] = np.clip((ch[m] - a[m] * 255) * inv, 0, 255)
    img = img.copy()
    img[y:y + bh, x:x + bw] = roi.astype(np.uint8)
    return img

def detect_generic(img):
    """Corner scan → best watermark box, or None."""
    h, w = img.shape[:2]
    base = min(w, h)
    L = (0.299 * img[..., 0] + 0.587 * img[..., 1] + 0.114 * img[..., 2]).astype(np.float32)
    regions = [
        ("bottom-right",  [w - round(base*0.40), h - round(base*0.22), round(base*0.40), round(base*0.22)]),
        ("bottom-left",   [0, h - round(base*0.22), round(base*0.40), round(base*0.22)]),
        ("top-right",     [w - round(base*0.40), 0, round(base*0.40), round(base*0.18)]),
        ("top-left",      [0, 0, round(base*0.40), round(base*0.18)]),
        ("bottom-centre", [round(w*0.03), h - round(base*0.20), round(w*0.94), round(base*0.20)]),
    ]
    scored = []
    for name, (rx, ry, rw, rh) in regions:
        rw = max(8, min(rw, w - rx)); rh = max(8, min(rh, h - ry))
        roi = L[ry:ry + rh, rx:rx + rw]
        B = estimate_background(roi, rw, rh)
        dev = roi - B
        mx = img[ry:ry + rh, rx:rx + rw].max(axis=-1).astype(np.int16)
        mn = img[ry:ry + rh, rx:rx + rw].min(axis=-1).astype(np.int16)
        chroma = mx - mn
        bright = img[ry:ry + rh, rx:rx + rw].max(axis=-1)
        white = (dev > 16) & (chroma < 40) & (bright > 150)
        dark = (dev < -16) & (chroma < 40)
        mask = (white | dark).astype(np.uint8)
        # erode 3×3: kill isolated noise specks, keep 2px+ strokes
        m = mask
        e = m[1:-1, 1:-1].astype(bool)
        for dy, dx in ((-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)):
            e &= m[1 + dy:m.shape[0] - 1 + dy, 1 + dx:m.shape[1] - 1 + dx].astype(bool)
        solid = np.zeros_like(mask, dtype=bool)
        solid[1:-1, 1:-1] = e
        ys, xs = np.nonzero(solid)
        n = int(solid.sum())
        if n < 150:
            continue
        x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
        bwa, bha = x1 - x0 + 1, y1 - y0 + 1
        base = min(w, h)
        # a real mark has a meaningful footprint
        if bwa < max(24, round(base * 0.04)) or bha < 10:
            continue
        size_ratio = (bwa * bha) / (w * h)
        plausible = size_ratio < 0.08 or (bwa > w * 0.5 and size_ratio < 0.2)
        if not plausible:
            continue
        density = n / (bwa * bha)
        is_caption_region = (name == "bottom-centre")
        if is_caption_region and density < 0.12:
            continue  # bottom-centre only counts for solid caption bars
        # real watermark strokes are FLAT — measure self-consistency of the
        # stroke luminance; textured background patches spread widely
        stroke_lums = roi[solid]
        med_lum = float(np.median(stroke_lums))
        self_cons = float(np.mean(np.abs(stroke_lums - med_lum) < 12))
        coverage = n / (rw * rh)
        score = (0.35 * min(1, density * 1.6)
                 + 0.25 * min(1, n / 700)
                 + 0.25 * self_cons
                 + 0.15 * min(1, coverage * 15))
        scored.append({
            "score": score, "name": name,
            "box": clamp_box([rx + x0 - 4, ry + y0 - 4, bwa + 8, bha + 8], w, h),
        })
    if not scored:
        return None, None
    scored.sort(key=lambda s: -s["score"])
    best, rest = scored[0], scored[1:]
    if best["score"] < 0.30:
        return None, None
    if rest:
        med_other = sorted(r["score"] for r in rest)[len(rest) // 2]
        if best["score"] < med_other * 1.15:
            return None, None  # no region clearly wins → probably no mark
    return best["box"], best["name"]

# ── CLI plumbing ────────────────────────────────────────────────────────────
def find_ffmpeg():
    p = shutil.which("ffmpeg")
    if p:
        return p
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except ImportError:
        return None


def effective_gain(args):
    """App-matching default gains: the web app cleans gemini/veo at 0.6."""
    if args.strength is not None:
        return args.strength
    return 0.6 if getattr(args, "preset", None) in ("gemini", "veo") else 1.0

def process_image(path, args):
    img = np.asarray(Image.open(path).convert("RGB"), dtype=np.uint8)
    h, w = img.shape[:2]
    if args.box:
        box = clamp_box([int(v) for v in args.box.split(",")], w, h)
        mode = "generic"
    elif args.preset in ("gemini", "gemini_classic", "veo"):
        box = preset_box(args.preset, w, h)
        mode = "sparkle"
    elif args.preset and args.preset != "auto":
        box = preset_box(args.preset, w, h)
        mode = "generic"
    else:
        det, name = detect_generic(img)
        if det:
            box, mode = det, "generic"
            print(f"  detected mark at {name}: box={box}")
        else:
            print("  WARNING: no watermark detected — pass --preset or --box. Copying unchanged.")
            return np.asarray(Image.open(path).convert("RGB"), dtype=np.uint8), None, "none"
    out = clean_sparkle(img, box, gain=effective_gain(args)) if mode == "sparkle" \
        else clean_generic(img, box, strength=effective_gain(args)) if mode == "generic" else img
    return out, box, mode

def process_video(path, out_path, args):
    ff = find_ffmpeg()
    if not ff:
        sys.exit("ERROR: ffmpeg not found. Install ffmpeg or `pip install imageio-ffmpeg`.")
    probe = subprocess.run([ff, "-i", str(path)], capture_output=True, text=True)
    import re
    # anchor on the comma-delimited WxH in the video stream line — bare
    # (\d+)x(\d+) matches codec fourcc hex ("avc1 / 0x31637661") and banner junk
    m = re.search(r"Stream #\d+:\d+.*Video:.*?,\s*(\d{2,5})x(\d{2,5}),", probe.stderr)
    if not m:
        sys.exit("ERROR: could not read video dimensions.")
    vw, vh = int(m.group(1)), int(m.group(2))
    fps_m = re.search(r"Stream #\d+:\d+.*Video:.*?([\d.]+) fps", probe.stderr)
    fps = float(fps_m.group(1)) if fps_m else 30.0

    # decide box once from a frame near the middle
    tmp = Path(tempfile.mkdtemp(prefix="wmprobe_"))
    subprocess.run([ff, "-y", "-ss", "1", "-i", str(path), "-frames:v", "1",
                    str(tmp / "probe.png")], check=True, capture_output=True)
    probe_img = np.asarray(Image.open(tmp / "probe.png").convert("RGB"), dtype=np.uint8)
    if args.box:
        box = clamp_box([int(v) for v in args.box.split(",")], vw, vh); mode = "generic"
    elif args.preset in ("gemini", "gemini_classic", "veo"):
        box = preset_box(args.preset, vw, vh); mode = "sparkle"
    elif args.preset and args.preset != "auto":
        box = preset_box(args.preset, vw, vh); mode = "generic"
    else:
        det, name = detect_generic(probe_img)
        if det:
            box, mode = det, "generic"
            print(f"  detected mark at {name}: box={box}")
        else:
            sys.exit("WARNING: no watermark detected — pass --preset or --box (refusing to edit blindly).")
    shutil.rmtree(tmp, ignore_errors=True)

    cmd = [ff, "-y",
           "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{vw}x{vh}", "-r", str(fps), "-i", "-",
           "-i", str(path),
           "-map", "0:v", "-map", "1:a?",
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", str(args.crf), "-preset", "medium",
           "-c:a", "copy", "-movflags", "+faststart",
           str(out_path)]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
    read = subprocess.Popen(
        [ff, "-i", str(path), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    frame_bytes = vw * vh * 3
    n = 0
    while True:
        data = read.stdout.read(frame_bytes)
        if not data:
            break
        frame = np.frombuffer(data, dtype=np.uint8).reshape(vh, vw, 3)
        if mode == "sparkle":
            frame = clean_sparkle(frame, box, gain=effective_gain(args))
        else:
            frame = clean_generic(frame, box, strength=effective_gain(args))
        proc.stdin.write(frame.tobytes())
        n += 1
        if n % 48 == 0:
            print(f"  ... {n} frames")
    read.stdout.close(); read.wait()
    proc.stdin.close(); proc.wait()
    if proc.returncode != 0:
        sys.exit(f"ERROR: ffmpeg encode failed (code {proc.returncode})")
    print(f"  done — {n} frames -> {out_path}")

def main():
    ap = argparse.ArgumentParser(description="Universal Watermark Remover (pro CLI)")
    ap.add_argument("input", help="image/video file OR folder of images")
    ap.add_argument("--preset", default="auto",
                    choices=["auto", "gemini", "gemini_classic", "veo", "sora", "kling", "grok",
                             "hailuo", "luma", "runway", "pixverse", "caption", "custom"])
    ap.add_argument("--box", help="x,y,w,h override (generic engine)")
    ap.add_argument("--strength", type=float, default=None,
                    help="un-blend gain (default: the app preset default — 0.6 for gemini/veo, 1.0 otherwise)")
    ap.add_argument("--out", default=None, help="output file (or prefix for batch)")
    ap.add_argument("--crf", type=int, default=18, help="video x264 CRF (default 18)")
    args = ap.parse_args()

    src = Path(args.input)
    if not src.exists():
        sys.exit(f"ERROR: {src} not found")

    if src.is_dir():
        prefix = args.out or "clean_"
        exts = {".png", ".jpg", ".jpeg", ".webp", ".bmp"}
        files = [p for p in sorted(src.iterdir()) if p.suffix.lower() in exts]
        if not files:
            sys.exit("No images found in folder.")
        for f in files:
            out, box, mode = process_image(f, args)
            dst = f.with_name(prefix + f.name)
            Image.fromarray(out).save(dst)
            print(f"  {f.name} -> {dst.name}  ({mode}, box={box})")
        print(f"batch done: {len(files)} images")
        return

    is_video = src.suffix.lower() in {".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"}
    out_path = Path(args.out) if args.out else src.with_name(("clean_" if not src.name.startswith("clean_") else "") + src.name)
    if is_video:
        process_video(src, out_path, args)
    else:
        out, box, mode = process_image(src, args)
        Image.fromarray(out).save(out_path)
        print(f"  saved {out_path}  ({mode}, box={box})")

if __name__ == "__main__":
    main()
