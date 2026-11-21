// ─────────────────────────────────────────────────────────────────────────────
// universal.js — v2 "Universal Watermark Remover" layer
// Loaded right after main.js. Extends the app from Gemini/Veo-only to ANY
// static watermark (Sora, Kling, Grok, Hailuo, Luma, Runway, PixVerse,
// TikTok/CapCut caption bars, custom dragged boxes …).
//
// How it works (two engines):
//   1. SPARKLE  — the original exact alpha-unblend for the known Gemini/Veo
//                 sparkle logo (lossless-quality, unchanged from main.js).
//   2. GENERIC  — new: local-median background estimation → per-pixel alpha
//                 recovery → exact un-blend for semi-transparent strokes +
//                 diffusion/edge-interpolation inpaint for opaque pixels.
//                 Works for any static overlay, white or dark, any position.
//
// This file overrides the two panel controllers (initImageRemover /
// initVideoRemover) and patches VideoWatermarkEngine.process. If this file
// fails to load, the original Gemini/Veo behaviour of main.js is untouched.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

// ── 0. Neutralise the original author's ad hooks (this is our own build) ──
function handleAutoDetectAd() { /* removed: third-party ad */ }
function handleDownloadAd() { /* removed: third-party ad */ }
function handleExportAd() { /* removed: third-party ad */ }
function loadMonetagPopunder() { /* removed: third-party ad */ }
function getPromoCardHtml() { return ''; }

// ── Neutralise the original author's GitHub stars API call (403s when
//    offline / rate-limited; purely cosmetic badge) ──
(function () {
  const _fetch = window.fetch?.bind(window);
  if (!_fetch) return;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.includes('api.github.com')) {
      return Promise.resolve(new Response('', { status: 204, statusText: 'offline' }));
    }
    return _fetch(input, init);
  };
})();

// ── 1. Universal preset registry ────────────────────────────────────────────
// geometry fractions are of min(width, height); every box stays fully
// adjustable via the sliders and by dragging on the preview canvas.
const UNI_GEOM = {
  sora:     { label: 'Sora',              anchor: 'br', wF: 0.24, hF: 0.085, mF: 0.025 },
  kling:    { label: 'Kling AI',          anchor: 'br', wF: 0.20, hF: 0.075, mF: 0.030 },
  grok:     { label: 'Grok Imagine',      anchor: 'bl', wF: 0.20, hF: 0.075, mF: 0.030 },
  hailuo:   { label: 'Hailuo / MiniMax',  anchor: 'br', wF: 0.22, hF: 0.080, mF: 0.025 },
  luma:     { label: 'Luma Dream Machine',anchor: 'br', wF: 0.24, hF: 0.075, mF: 0.025 },
  runway:   { label: 'Runway',            anchor: 'br', wF: 0.20, hF: 0.070, mF: 0.030 },
  pixverse: { label: 'PixVerse',          anchor: 'br', wF: 0.20, hF: 0.075, mF: 0.030 },
  caption:  { label: 'TikTok / CapCut bar', anchor: 'bc', wF: 0.94, hF: 0.16, mF: 0.015 },
  custom:   { label: 'Custom box',        anchor: 'br', wF: 0.22, hF: 0.080, mF: 0.030 },
};

const UNI_PRESETS = {
  image: [
    { key: 'new',     label: 'Gemini / Nano Banana', icon: 'ph:sparkle-bold',   mode: 'sparkle', sparkle: 'new' },
    { key: 'classic', label: 'Gemini (Classic)',     icon: 'ph:corners-out',   mode: 'sparkle', sparkle: 'classic' },
    { key: 'sora',    label: 'Sora',                 icon: 'ph:planet-bold',   mode: 'generic' },
    { key: 'grok',    label: 'Grok Imagine',         icon: 'ph:rocket-bold',   mode: 'generic' },
    { key: 'caption', label: 'TikTok / CapCut bar',  icon: 'ph:subtitle-bold', mode: 'generic' },
    { key: 'custom',  label: 'Drag custom box',      icon: 'ph:hand-grabbing-bold', mode: 'generic', custom: true },
  ],
  video: [
    { key: 'veo',     label: 'Veo / Flow (Adaptive)', icon: 'ph:sparkle-bold',  mode: 'sparkle', sparkle: 'veo' },
    { key: 'corner',  label: 'Veo (Corner)',          icon: 'ph:corners-out',  mode: 'sparkle', sparkle: 'corner' },
    { key: 'sparkle', label: 'Sparkle (Standard)',    icon: 'ph:star-four-bold', mode: 'sparkle', sparkle: 'sparkle' },
    { key: 'sora',    label: 'Sora',                  icon: 'ph:planet-bold',  mode: 'generic' },
    { key: 'kling',   label: 'Kling AI',              icon: 'ph:video-bold',   mode: 'generic' },
    { key: 'grok',    label: 'Grok Imagine',          icon: 'ph:rocket-bold',  mode: 'generic' },
    { key: 'hailuo',  label: 'Hailuo / MiniMax',      icon: 'ph:waves-bold',   mode: 'generic' },
    { key: 'luma',    label: 'Luma',                  icon: 'ph:moon-stars-bold', mode: 'generic' },
    { key: 'runway',  label: 'Runway',                icon: 'ph:film-strip-bold', mode: 'generic' },
    { key: 'pixverse',label: 'PixVerse',              icon: 'ph:images-bold',  mode: 'generic' },
    { key: 'caption', label: 'TikTok / CapCut bar',   icon: 'ph:subtitle-bold', mode: 'generic' },
    { key: 'custom',  label: 'Drag custom box',       icon: 'ph:hand-grabbing-bold', mode: 'generic', custom: true },
  ],
};

function uniBaseBox(presetKey, width, height) {
  const g = UNI_GEOM[presetKey] || UNI_GEOM.custom;
  const base = Math.min(width, height);
  const w = Math.max(24, Math.round(base * g.wF));
  const h = Math.max(12, Math.round(base * g.hF));
  const m = Math.max(4, Math.round(base * g.mF));
  let x = 0, y = 0;
  switch (g.anchor) {
    case 'br': x = width - m - w;  y = height - m - h; break;
    case 'bl': x = m;              y = height - m - h; break;
    case 'bc': x = (width - w) >> 1; y = height - m - h; break;
    case 'tr': x = width - m - w;  y = m; break;
    case 'tl': x = m;              y = m; break;
  }
  return {
    x: Math.max(0, x), y: Math.max(0, y),
    width: Math.min(w, width), height: Math.min(h, height),
    size: Math.max(w, h),
  };
}

function uniResolveRect(base, width, height, opts = {}) {
  const sizeScale = opts.sizeScale || 1;
  const w = Math.max(8, Math.min(Math.round(base.width * sizeScale), width));
  const h = Math.max(8, Math.min(Math.round(base.height * sizeScale), height));
  // keep the anchor corner pinned while scaling (feels natural for corners)
  const growX = Math.round((w - base.width) / 2);
  const growY = Math.round((h - base.height) / 2);
  const x = Math.max(0, Math.min(base.x - growX + Math.round(opts.offsetX || 0), width - w));
  const y = Math.max(0, Math.min(base.y - growY + Math.round(opts.offsetY || 0), height - h));
  return { x, y, width: w, height: h };
}

function uniClampBox(box, width, height) {
  const x = Math.max(0, Math.min(Math.round(box.x), width - 4));
  const y = Math.max(0, Math.min(Math.round(box.y), height - 4));
  const w = Math.max(4, Math.min(Math.round(box.width), width - x));
  const h = Math.max(4, Math.min(Math.round(box.height), height - y));
  return { x, y, width: w, height: h };
}

// ── 2. Generic removal engine ───────────────────────────────────────────────
// Any static watermark: estimate the local background with a block-median,
// recover per-pixel overlay alpha, un-blend semi-transparent strokes exactly,
// and inpaint (diffusion for thin marks / edge-interpolation for big bars)
// whatever is opaque.

const _uniCanvas = document.createElement('canvas');

function uniBlockMedian(L, rw, rh, cell) {
  const gw = Math.max(2, Math.ceil(rw / cell));
  const gh = Math.max(2, Math.ceil(rh / cell));
  const grid = new Float32Array(gw * gh);
  const buf = new Float32Array(cell * cell);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const x0 = gx * cell, y0 = gy * cell;
      const x1 = Math.min(rw, x0 + cell), y1 = Math.min(rh, y0 + cell);
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        const row = yy * rw;
        for (let xx = x0; xx < x1; xx++) buf[n++] = L[row + xx];
      }
      // partial sort for median (TypedArray default sort = numeric ascending)
      const arr = buf.subarray(0, n);
      arr.sort();
      grid[gy * gw + gx] = arr[n >> 1];
    }
  }
  return { grid, gw, gh };
}

function uniUpsampleGrid(grid, gw, gh, rw, rh) {
  // bilinear upsample through a tiny canvas (fast, no big loops)
  const c = _uniCanvas;
  const src = new ImageData(gw, gh);
  for (let i = 0; i < gw * gh; i++) {
    const v = Math.max(0, Math.min(255, grid[i]));
    src.data[i * 4] = v; src.data[i * 4 + 1] = v; src.data[i * 4 + 2] = v; src.data[i * 4 + 3] = 255;
  }
  c.width = gw; c.height = gh;
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.putImageData(src, 0, 0);

  const c2 = document.createElement('canvas');
  c2.width = rw; c2.height = rh;
  const c2x = c2.getContext('2d', { willReadFrequently: true });
  c2x.imageSmoothingEnabled = true;
  c2x.imageSmoothingQuality = 'high';
  c2x.drawImage(c, 0, 0, rw, rh);
  const out = new Float32Array(rw * rh);
  const data = c2x.getImageData(0, 0, rw, rh).data;
  for (let i = 0; i < out.length; i++) out[i] = data[i * 4];
  return out;
}

function uniDilate3x3(arr, rw, rh, passes) {
  let src = arr;
  for (let p = 0; p < passes; p++) {
    const dst = new Float32Array(src.length);
    for (let y = 0; y < rh; y++) {
      const yUp = y > 0 ? y - 1 : 0, yDn = y < rh - 1 ? y + 1 : rh - 1;
      for (let x = 0; x < rw; x++) {
        const xL = x > 0 ? x - 1 : 0, xR = x < rw - 1 ? x + 1 : rw - 1;
        let m = src[y * rw + xL];
        if (src[y * rw + x] > m) m = src[y * rw + x];
        if (src[y * rw + xR] > m) m = src[y * rw + xR];
        if (src[yUp * rw + xL] > m) m = src[yUp * rw + xL];
        if (src[yUp * rw + x] > m) m = src[yUp * rw + x];
        if (src[yUp * rw + xR] > m) m = src[yUp * rw + xR];
        if (src[yDn * rw + xL] > m) m = src[yDn * rw + xL];
        if (src[yDn * rw + x] > m) m = src[yDn * rw + x];
        if (src[yDn * rw + xR] > m) m = src[yDn * rw + xR];
        dst[y * rw + x] = m;
      }
    }
    src = dst;
  }
  return src;
}

// Erode (3×3 min): removes isolated single-pixel noise specks while keeping
// 2px+ text/logo strokes — used by the generic auto-detector.
function uniErodeMask(mask, rw, rh) {
  const dst = new Uint8Array(mask.length);
  for (let y = 0; y < rh; y++) {
    const yUp = y > 0 ? y - 1 : 0, yDn = y < rh - 1 ? y + 1 : rh - 1;
    for (let x = 0; x < rw; x++) {
      const xL = x > 0 ? x - 1 : 0, xR = x < rw - 1 ? x + 1 : rw - 1;
      const v = mask[y * rw + x] && mask[y * rw + xL] && mask[y * rw + xR]
        && mask[yUp * rw + xL] && mask[yUp * rw + x] && mask[yUp * rw + xR]
        && mask[yDn * rw + xL] && mask[yDn * rw + x] && mask[yDn * rw + xR];
      dst[y * rw + x] = v ? 1 : 0;
    }
  }
  return dst;
}

// 3×3 median filter (Float32Array) — the coherence test for alpha maps.
function uniMedian3x3(src, rw, rh) {
  const dst = new Float32Array(rw * rh);
  const buf = new Float32Array(9);
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          buf[k++] = yy < 0 || yy >= rh || xx < 0 || xx >= rw ? 0 : src[yy * rw + xx];
        }
      }
      buf.sort();
      dst[y * rw + x] = buf[4];
    }
  }
  return dst;
}

// Robust background estimate for a ROI: fine cell medians → 5×5 median
// filter (strokes occupy <50% of that window → removed) → cells that still
// disagree with the local median or the ROI-ring median are marked invalid
// and diffusion-filled from clean neighbours. Handles thick strokes and big
// opaque overlays (caption bars) without letting the mark contaminate B.
function uniEstimateBackground(L, rw, rh, exclude) {
  const g = 6;
  const gw = Math.max(2, Math.ceil(rw / g)), gh = Math.max(2, Math.ceil(rh / g));
  const v = new Float32Array(gw * gh);
  const bad = new Uint8Array(gw * gh);      // cell unusable (mostly excluded px)
  const buf = new Float32Array(g * g);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let n = 0, kept = 0, tot = 0;
      const x0 = gx * g, y0 = gy * g;
      for (let yy = y0; yy < Math.min(rh, y0 + g); yy++) {
        for (let xx = x0; xx < Math.min(rw, x0 + g); xx++) {
          tot++;
          if (exclude && exclude[yy * rw + xx]) continue;
          buf[n++] = L[yy * rw + xx]; kept++;
        }
      }
      const i = gy * gw + gx;
      if (kept < Math.max(4, tot * 0.25)) { v[i] = NaN; bad[i] = 1; continue; }
      const arr = buf.subarray(0, n);
      arr.sort();
      v[i] = arr[n >> 1];
    }
  }

  // local = 5×5 median filter over the cell grid
  const k = 2, W = 2 * k + 1;
  const tmp = new Float32Array(W * W);
  const vLocal = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      let n = 0;
      for (let dy = -k; dy <= k; dy++) {
        for (let dx = -k; dx <= k; dx++) {
          const yy = Math.min(gh - 1, Math.max(0, gy + dy));
          const xx = Math.min(gw - 1, Math.max(0, gx + dx));
          tmp[n++] = v[yy * gw + xx];
        }
      }
      const arr = tmp.slice(0, n);
      arr.sort();
      vLocal[gy * gw + gx] = arr[n >> 1];
    }
  }

  // ring median (border cells — usually clean because of the ROI padding)
  const ring = [];
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const val = v[gy * gw + gx];
      if ((gy === 0 || gy === gh - 1 || gx === 0 || gx === gw - 1) && !bad[gy * gw + gx]) ring.push(val);
    }
  }
  ring.sort((a, b) => a - b);
  const vRing = ring.length ? ring[ring.length >> 1] : 0;

  const Bg = new Float32Array(gw * gh);
  const valid = new Uint8Array(gw * gh);
  let nValid = 0;
  for (let i = 0; i < gw * gh; i++) {
    if (bad[i]) { valid[i] = 0; continue; }
    valid[i] = (Math.abs(v[i] - vLocal[i]) < 40 && Math.abs(v[i] - vRing) < 80) ? 1 : 0;
    if (valid[i]) { nValid++; Bg[i] = vLocal[i]; }
  }
  if (nValid < Math.max(4, gw * gh * 0.15)) {
    // degenerate: nearly the whole ROI is the mark — fall back to raw medians
    for (let i = 0; i < gw * gh; i++) Bg[i] = bad[i] ? vRing : v[i];
  } else {
    // diffusion-fill invalid cells from valid neighbours
    for (let it = 0; it < 300; it++) {
      let maxDelta = 0;
      for (let gy = 0; gy < gh; gy++) {
        for (let gx = 0; gx < gw; gx++) {
          const i = gy * gw + gx;
          if (valid[i]) continue;
          let sum = 0, cnt = 0;
          if (gy > 0) { sum += Bg[(gy - 1) * gw + gx]; cnt++; }
          if (gy < gh - 1) { sum += Bg[(gy + 1) * gw + gx]; cnt++; }
          if (gx > 0) { sum += Bg[gy * gw + gx - 1]; cnt++; }
          if (gx < gw - 1) { sum += Bg[gy * gw + gx + 1]; cnt++; }
          if (!cnt) continue;
          const nv = sum / cnt;
          const d = Math.abs(nv - Bg[i]);
          if (d > maxDelta) maxDelta = d;
          Bg[i] = nv;
        }
      }
      if (maxDelta < 0.3) break;
    }
  }
  return uniUpsampleGrid(Bg, gw, gh, rw, rh);
}

// Core: clean one absolute box region inside imageData (dims: fw × fh).
// opts: { strength = 1, polarity = 'auto' | 'white' | 'dark' }
function uniCleanGenericRegion(imageData, fw, fh, absBox, opts = {}) {
  const strength = Number.isFinite(opts.strength) && opts.strength > 0 ? opts.strength : 1;
  const box = uniClampBox(absBox, fw, fh);
  const pad = Math.max(4, Math.round(Math.min(box.width, box.height) * 0.18));
  const rx = Math.max(0, box.x - pad), ry = Math.max(0, box.y - pad);
  const rw = Math.min(fw - rx, box.width + pad * 2);
  const rh = Math.min(fh - ry, box.height + pad * 2);
  if (rw < 4 || rh < 4) return box;

  const n = rw * rh;
  const data = imageData.data;
  const A_MIN = 0.05;
  const OPAQUE = 0.93;
  const alpha = new Float32Array(n);
  const isWhiteMark = new Uint8Array(n);
  const Bl = new Float32Array(n);          // background luminance
  const opaqueMask = new Uint8Array(n);
  const mask = new Uint8Array(n);          // 1 = needs inpaint
  const est3 = new Float32Array(n * 3);

  const chanArr = (c) => {
    const a = new Float32Array(n);
    for (let y = 0; y < rh; y++) {
      const rowIn = ((ry + y) * fw + rx) * 4;
      for (let x = 0; x < rw; x++) a[y * rw + x] = data[rowIn + x * 4 + c];
    }
    return a;
  };
  const lumOf = (r, g, b) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = 0.299 * r[i] + 0.587 * g[i] + 0.114 * b[i];
    return out;
  };

  const medAlphaAt = (i, B0, B1, B2, c0, c1, c2) => {
    est3[i * 3] = NaN; est3[i * 3 + 1] = NaN; est3[i * 3 + 2] = NaN;
    const Bs = [B0, B1, B2], cs = [c0, c1, c2];
    for (let c = 0; c < 3; c++) {
      const dev = cs[c] - Bs[c];
      let a;
      if (dev > 0) {
        const denom = 255 - Bs[c];
        a = denom > 8 ? (dev / denom) * strength : NaN;
      } else {
        a = Bs[c] > 8 ? ((-dev / Bs[c]) * strength) : NaN;
      }
      est3[i * 3 + c] = a;
    }
    const arr = [est3[i * 3], est3[i * 3 + 1], est3[i * 3 + 2]]
      .filter(Number.isFinite).sort((x, y) => x - y);
    return arr.length ? Math.min(1, arr[arr.length >> 1]) : 0;
  };

  // two passes: pass 2 re-estimates the background from the once-cleaned ROI
  for (let pass = 0; pass < 2; pass++) {
    const chans = [chanArr(0), chanArr(1), chanArr(2)];
    const Bch = [
      uniEstimateBackground(chans[0], rw, rh),
      uniEstimateBackground(chans[1], rw, rh),
      uniEstimateBackground(chans[2], rw, rh),
    ];
    for (let i = 0; i < n; i++) {
      Bl[i] = 0.299 * Bch[0][i] + 0.587 * Bch[1][i] + 0.114 * Bch[2][i];
    }

    // per-channel alpha (median of the 3 channel estimates) + polarity
    alpha.fill(0);
    isWhiteMark.fill(0);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const i = y * rw + x;
        const o = ((ry + y) * fw + rx + x) * 4;
        alpha[i] = medAlphaAt(i, Bch[0][i], Bch[1][i], Bch[2][i],
          data[o], data[o + 1], data[o + 2]);
        if (alpha[i] <= A_MIN) alpha[i] = 0;
        const devL = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2] - Bl[i];
        isWhiteMark[i] = devL >= 0 ? 1 : 0;
      }
    }

    // morphological opening on the significant-alpha mask
    {
      const binm = new Uint8Array(n);
      let sig = 0;
      for (let i = 0; i < n; i++) { binm[i] = alpha[i] > 0.15 ? 1 : 0; if (binm[i]) sig++; }
      if (sig >= 60) {
        const opened = uniErodeMask(binm, rw, rh);
        let openCount = 0;
        for (let i = 0; i < n; i++) openCount += opened[i];
        if (openCount >= 40) {
          const gate = uniDilate3x3(Float32Array.from(opened), rw, rh, 1);
          for (let i = 0; i < n; i++) if (gate[i] < 0.5) alpha[i] = 0;
        }
      }
    }

    // coherence gate: 3×3 median of the significance map
    {
      const binm = new Float32Array(n);
      for (let i = 0; i < n; i++) binm[i] = alpha[i] > 0.12 ? 1 : 0;
      const medA = uniMedian3x3(binm, rw, rh);
      for (let i = 0; i < n; i++) if (medA[i] < 0.5) alpha[i] = 0;
    }

    // dilate ONE pass — only to grow the inpaint mask over the AA ring
    const dil = uniDilate3x3(alpha, rw, rh, 1);

    // un-blend where alpha is partial AND coherent, flag where opaque
    opaqueMask.fill(0);
    mask.fill(0);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const i = y * rw + x;
        const a = alpha[i];
        if (a <= A_MIN) continue;
        const o = ((ry + y) * fw + rx + x) * 4;
        if (a < OPAQUE && dil[i] < OPAQUE) {
          const inv = 1 / (1 - a);
          if (isWhiteMark[i]) {
            for (let c = 0; c < 3; c++) {
              const v = (data[o + c] - a * 255) * inv;
              data[o + c] = v < 0 ? 0 : v > 255 ? 255 : v;
            }
          } else {
            for (let c = 0; c < 3; c++) {
              const v = data[o + c] * inv;
              data[o + c] = v < 0 ? 0 : v > 255 ? 255 : v;
            }
          }
          const lumAfter = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
          if (Math.abs(lumAfter - Bl[i]) > 30) mask[i] = 1;
        } else {
          opaqueMask[i] = 1;
          mask[i] = 1;
        }
      }
    }

    // mark-aware re-estimation (pass 0 only): confident-mark pixels are
    // excluded from the background cell medians so big semi-transparent
    // overlays (caption bars) cannot contaminate B
    if (pass === 0) {
      let markCount = 0;
      const markMask = new Uint8Array(n);
      for (let i = 0; i < n; i++) { if (alpha[i] > 0.35) { markMask[i] = 1; markCount++; } }
      const frac = markCount / n;
      if (frac > 0.04 && frac < 0.92) {
        const chans2 = [chanArr(0), chanArr(1), chanArr(2)];
        const Bch2 = [
          uniEstimateBackground(chans2[0], rw, rh, markMask),
          uniEstimateBackground(chans2[1], rw, rh, markMask),
          uniEstimateBackground(chans2[2], rw, rh, markMask),
        ];
        const Bl2 = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          Bl2[i] = 0.299 * Bch2[0][i] + 0.587 * Bch2[1][i] + 0.114 * Bch2[2][i];
        }
        // stronger-alpha second opinion from the mark-aware background
        const alpha2 = new Float32Array(n);
        for (let y = 0; y < rh; y++) {
          for (let x = 0; x < rw; x++) {
            const i = y * rw + x;
            const o = ((ry + y) * fw + rx + x) * 4;
            alpha2[i] = medAlphaAt(i, Bch2[0][i], Bch2[1][i], Bch2[2][i],
              data[o], data[o + 1], data[o + 2]);
            if (alpha2[i] <= A_MIN) alpha2[i] = 0;
          }
        }
        {
          const binm2 = new Float32Array(n);
          for (let i = 0; i < n; i++) binm2[i] = alpha2[i] > 0.12 ? 1 : 0;
          const med2 = uniMedian3x3(binm2, rw, rh);
          for (let i = 0; i < n; i++) if (med2[i] < 0.5) alpha2[i] = 0;
        }
        for (let y = 0; y < rh; y++) {
          for (let x = 0; x < rw; x++) {
            const i = y * rw + x;
            if (alpha2[i] <= alpha[i]) continue;
            const a2 = alpha2[i];
            const o = ((ry + y) * fw + rx + x) * 4;
            if (a2 >= OPAQUE) {
              // near-opaque overlay (caption bar): conservative partial
              // un-blend, then hand the pixel to the inpaint pass — dividing
              // by (1 - 0.95+) amplifies codec noise into garbage
              const aEff = 0.92;
              const inv = 1 / (1 - aEff);
              if (isWhiteMark[i]) {
                for (let c = 0; c < 3; c++) {
                  const v = (data[o + c] - aEff * 255) * inv;
                  data[o + c] = v < 0 ? 0 : v > 255 ? 255 : v;
                }
              } else {
                for (let c = 0; c < 3; c++) {
                  const v = data[o + c] * inv;
                  data[o + c] = v < 0 ? 0 : v > 255 ? 255 : v;
                }
              }
              opaqueMask[i] = 1;
              mask[i] = 1;
            } else {
              const inv = 1 / (1 - a2);
              if (isWhiteMark[i]) {
                for (let c = 0; c < 3; c++) {
                  const v = (data[o + c] - a2 * 255) * inv;
                  data[o + c] = v < 0 ? 0 : v > 255 ? 255 : v;
                }
              } else {
                for (let c = 0; c < 3; c++) {
                  const v = data[o + c] * inv;
                  data[o + c] = v < 0 ? 0 : v > 255 ? 255 : v;
                }
              }
            }
          }
        }
      }
    }
  }

  // grow opaque mask by 1 px (AA ring) and inpaint flagged pixels
  {
    const grown = uniDilate3x3(Float32Array.from(opaqueMask), rw, rh, 1);
    for (let i = 0; i < n; i++) if (grown[i] >= 0.5) mask[i] = 1;
  }
  let maskedCount = 0;
  for (let i = 0; i < n; i++) maskedCount += mask[i];
  if (maskedCount > 0) {
    if (maskedCount > n * 0.12) uniInpaintEdges(imageData, fw, fh, rx, ry, rw, rh, mask, Bl);
    else uniInpaintDiffuse(imageData, fw, fh, rx, ry, rw, rh, mask, Bl);
    uniSmoothMasked(imageData, fw, fh, rx, ry, rw, rh, mask, 2);
  }

  return box;
}

// 3×3 mean smoothing restricted to masked pixels (inpaint polish).
function uniSmoothMasked(imageData, fw, fh, rx, ry, rw, rh, mask, rounds) {
  const data = imageData.data;
  for (let r = 0; r < rounds; r++) {
    const srcChans = [new Float32Array(rw * rh), new Float32Array(rw * rh), new Float32Array(rw * rh)];
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const i = y * rw + x;
        const o = ((ry + y) * fw + rx + x) * 4;
        srcChans[0][i] = data[o]; srcChans[1][i] = data[o + 1]; srcChans[2][i] = data[o + 2];
      }
    }
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const i = y * rw + x;
        if (!mask[i]) continue;
        const o = ((ry + y) * fw + rx + x) * 4;
        for (let c = 0; c < 3; c++) {
          let sum = 0, cnt = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const yy = y + dy; if (yy < 0 || yy >= rh) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx; if (xx < 0 || xx >= rw) continue;
              sum += srcChans[c][yy * rw + xx]; cnt++;
            }
          }
          const v = 0.5 * srcChans[c][i] + 0.5 * (sum / cnt);
          data[o + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
        }
      }
    }
  }
}

// Diffusion inpaint (Jacobi) — great for thin strokes / small regions.
function uniInpaintDiffuse(imageData, fw, fh, rx, ry, rw, rh, mask, B) {
  const data = imageData.data;
  const chans = [new Float32Array(rw * rh), new Float32Array(rw * rh), new Float32Array(rw * rh)];
  const idxs = [];
  for (let y = 0; y < rh; y++) {
    for (let x = 0; x < rw; x++) {
      const i = y * rw + x;
      if (!mask[i]) continue;
      const o = ((ry + y) * fw + rx + x) * 4;
      for (let c = 0; c < 3; c++) chans[c][i] = B[i]; // start from background estimate
      idxs.push(i);
    }
  }
  const m = idxs.length;
  if (!m) return;
  const neighbor = (i, dx, dy) => {
    const x = i % rw, y = (i / rw) | 0;
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= rw || ny >= rh) return -1;
    return ny * rw + nx;
  };
  for (let iter = 0; iter < 320; iter++) {
    let maxDelta = 0;
    for (let k = 0; k < m; k++) {
      const i = idxs[k];
      for (let c = 0; c < 3; c++) {
        let sum = 0, cnt = 0;
        for (let d = 0; d < 4; d++) {
          const j = neighbor(i, d === 0 ? -1 : d === 1 ? 1 : 0, d === 2 ? -1 : d === 3 ? 1 : 0);
          if (j < 0) continue;
          sum += chans[c][j] > -1 ? chans[c][j] : 0;
          // unmasked neighbours hold the real pixel values already in chans
          cnt++;
        }
        if (!cnt) continue;
        const nv = sum / cnt;
        const delta = Math.abs(nv - chans[c][i]);
        if (delta > maxDelta) maxDelta = delta;
        chans[c][i] = nv;
      }
    }
    if (maxDelta < 0.35) break;
  }
  // write back
  for (let k = 0; k < m; k++) {
    const i = idxs[k];
    const x = i % rw, y = (i / rw) | 0;
    const o = ((ry + y) * fw + rx + x) * 4;
    for (let c = 0; c < 3; c++) {
      const v = chans[c][i];
      data[o + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
}

// Edge interpolation inpaint — O(n), for large opaque regions (caption bars).
function uniInpaintEdges(imageData, fw, fh, rx, ry, rw, rh, mask, B) {
  const data = imageData.data;
  const px = (x, y, c) => data[((ry + y) * fw + rx + x) * 4 + c];
  const setPx = (x, y, c, v) => { data[((ry + y) * fw + rx + x) * 4 + c] = v; };

  for (let y = 0; y < rh; y++) {
    let x = 0;
    while (x < rw) {
      if (!mask[y * rw + x]) { x++; continue; }
      let x0 = x;
      while (x < rw && mask[y * rw + x]) x++;
      const x1 = x - 1; // run [x0..x1]
      for (let c = 0; c < 3; c++) {
        const lv = x0 > 0 ? px(x0 - 1, y, c) : null;
        const rv = x1 < rw - 1 ? px(x1 + 1, y, c) : null;
        for (let xx = x0; xx <= x1; xx++) {
          let v;
          if (lv != null && rv != null) v = lv + (rv - lv) * ((xx - x0 + 1) / (x1 - x0 + 2));
          else if (lv != null) v = lv;
          else if (rv != null) v = rv;
          else v = B[y * rw + xx];
          setPx(xx, y, c, v);
        }
      }
    }
  }
  // vertical pass blended on top
  for (let x = 0; x < rw; x++) {
    let y = 0;
    while (y < rh) {
      if (!mask[y * rw + x]) { y++; continue; }
      let y0 = y;
      while (y < rh && mask[y * rw + x]) y++;
      const y1 = y - 1;
      for (let c = 0; c < 3; c++) {
        const tv = y0 > 0 ? px(x, y0 - 1, c) : null;
        const bv = y1 < rh - 1 ? px(x, y1 + 1, c) : null;
        for (let yy = y0; yy <= y1; yy++) {
          let v;
          if (tv != null && bv != null) v = tv + (bv - tv) * ((yy - y0 + 1) / (y1 - y0 + 2));
          else if (tv != null) v = tv;
          else if (bv != null) v = bv;
          else v = px(x, yy, c);
          setPx(x, yy, c, Math.round((v + px(x, yy, c)) / 2));
        }
      }
    }
  }
}

// ── 3. Generic corner auto-detection ────────────────────────────────────────
// Scans the four corners + bottom-centre for concentrated near-monochrome
// thin strokes that sit on top of the local median background.
function uniDetectGeneric(imageData, width, height) {
  const base = Math.min(width, height);
  const regions = [
    { name: 'bottom-right',  x: width - Math.round(base * 0.40), y: height - Math.round(base * 0.22), w: Math.round(base * 0.40), h: Math.round(base * 0.22) },
    { name: 'bottom-left',   x: 0,                               y: height - Math.round(base * 0.22), w: Math.round(base * 0.40), h: Math.round(base * 0.22) },
    { name: 'top-right',     x: width - Math.round(base * 0.40), y: 0,                               w: Math.round(base * 0.40), h: Math.round(base * 0.18) },
    { name: 'top-left',      x: 0,                               y: 0,                               w: Math.round(base * 0.40), h: Math.round(base * 0.18) },
    { name: 'bottom-centre', x: Math.round(width * 0.03),        y: height - Math.round(base * 0.20), w: Math.round(width * 0.94), h: Math.round(base * 0.20) },
  ];

  const scored = [];
  for (const reg of regions) {
    const rw = Math.max(8, Math.min(reg.w, width - reg.x));
    const rh = Math.max(8, Math.min(reg.h, height - reg.y));
    const n = rw * rh;

    const L = new Float32Array(n);
    const data = imageData.data;
    let posE = 0, negE = 0;
    for (let y = 0; y < rh; y++) {
      const rowIn = ((reg.y + y) * width + reg.x) * 4;
      for (let x = 0; x < rw; x++) {
        const o = rowIn + x * 4;
        const r = data[o], g = data[o + 1], b = data[o + 2];
        L[y * rw + x] = 0.299 * r + 0.587 * g + 0.114 * b;
      }
    }
    const cell = Math.max(6, Math.round(Math.max(rw, rh) / 12));
    const { grid, gw, gh } = uniBlockMedian(L, rw, rh, cell);
    const B = uniUpsampleGrid(grid, gw, gh, rw, rh);

    const strokes = new Uint8Array(n);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        const i = y * rw + x;
        const d = L[i] - B[i];
        if (Math.abs(d) < 16) continue;
        const o = ((reg.y + y) * width + reg.x + x) * 4;
        const mx = Math.max(data[o], data[o + 1], data[o + 2]);
        const mn = Math.min(data[o], data[o + 1], data[o + 2]);
        const chroma = mx - mn;
        const whiteStroke = d > 0 && chroma < 40 && (data[o] > 150 || data[o + 1] > 150 || data[o + 2] > 150);
        const darkStroke = d < 0 && chroma < 40;
        if (!whiteStroke && !darkStroke) continue;
        if (whiteStroke) posE += d; else negE += -d;
        strokes[i] = 1;
      }
    }
    // kill isolated noise specks; text/logo strokes survive a 3×3 erosion
    const solid = uniErodeMask(strokes, rw, rh);
    let minX = rw, minY = rh, maxX = -1, maxY = -1, count = 0;
    const strokeLums = [];
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) {
        if (!solid[y * rw + x]) continue;
        count++;
        strokeLums.push(L[y * rw + x]);
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (count < 150 || maxX < 0) continue;

    const coverage = count / n;
    const bboxW = maxX - minX + 1, bboxH = maxY - minY + 1;
    const density = count / (bboxW * bboxH);          // stroke density inside bbox
    const polarity = negE > posE * 1.6 ? 'dark' : 'white';
    const baseDim = Math.min(width, height);
    // a real mark has a meaningful footprint
    if (bboxW < Math.max(24, Math.round(baseDim * 0.04)) || bboxH < 10) continue;
    // corner marks are small & dense; caption bars are wide & moderately dense
    const sizeRatio = (bboxW * bboxH) / (width * height);
    const plausible = sizeRatio < 0.08 || (bboxW > width * 0.5 && sizeRatio < 0.2);
    if (!plausible) continue;
    if (reg.name === 'bottom-centre' && density < 0.12) continue; // only solid bars count there

    // real watermark strokes are FLAT — textured background patches spread
    strokeLums.sort((a, b) => a - b);
    const medLum = strokeLums[strokeLums.length >> 1];
    let flat = 0;
    for (const lv of strokeLums) if (Math.abs(lv - medLum) < 12) flat++;
    const selfCons = flat / strokeLums.length;

    const score = (0.35 * Math.min(1, density * 1.6)
      + 0.25 * Math.min(1, count / 700)
      + 0.25 * selfCons
      + 0.15 * Math.min(1, coverage * 15));
    scored.push({
      score, polarity, coverage, name: reg.name,
      box: uniClampBox({
        x: reg.x + minX - 4, y: reg.y + minY - 4,
        width: bboxW + 8, height: bboxH + 8,
      }, width, height),
    });
  }
  if (!scored.length) return { matchFound: false, score: 0, mode: 'generic' };
  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const rest = scored.slice(1);
  if (best.score < 0.30) {
    return { matchFound: false, score: best.score, mode: 'generic' };
  }
  if (rest.length) {
    const medOther = rest.map(r => r.score).sort((a, b) => a - b)[rest.length >> 1];
    if (best.score < medOther * 1.15) {
      return { matchFound: false, score: best.score, mode: 'generic' }; // no clear winner
    }
  }
  best.matchFound = true;
  best.mode = 'generic';
  best.name = `Detected mark — ${best.name}`;
  return best;
}

// ── 4. Video engine patch: generic mode + local mediabunny ──────────────────
VideoWatermarkEngine.prototype._lib = async function () {
  if (!this._mb) {
    try {
      this._mb = await import('./vendor/mediabunny.mjs');
    } catch (e) {
      this._mb = await import('https://cdn.jsdelivr.net/npm/mediabunny@1.52.3/+esm');
    }
  }
  return this._mb;
};

VideoWatermarkEngine.prototype.process = async function (file, opts = {}) {
  const onProgress = opts.onProgress || (() => { });
  const isGeneric = opts.mode === 'generic';
  const gain = opts.gain ?? VIDEO_DEFAULTS.gain;

  const mb = await this._lib();
  const {
    ALL_FORMATS, BlobSource, BufferTarget, CanvasSource,
    EncodedAudioPacketSource, EncodedPacketSink, Input,
    Mp4OutputFormat, Output, QUALITY_HIGH, VideoSampleSink, canEncodeVideo,
  } = mb;

  if (canEncodeVideo && !(await canEncodeVideo('avc'))) {
    throw new Error('Your browser cannot encode H.264 video locally. Please try Chrome or Edge desktop.');
  }

  const originalUrl = URL.createObjectURL(file);
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });

  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) {
    input.dispose?.();
    URL.revokeObjectURL(originalUrl);
    throw new Error('No decodable video track found.');
  }

  const width = videoTrack.displayWidth ?? videoTrack.codedWidth;
  const height = videoTrack.displayHeight ?? videoTrack.codedHeight;
  const duration = await input.computeDuration().catch(() => 0);

  let frameRate = 30;
  try {
    const stats = await videoTrack.computePacketStats(120);
    if (stats?.averagePacketRate) frameRate = Math.round(stats.averagePacketRate);
  } catch { }

  let wm, roi, alpha = null, region;
  if (isGeneric) {
    const baseBox = opts.box
      ? uniClampBox(opts.box, width, height)
      : uniResolveRect(uniBaseBox(opts.preset || 'custom', width, height), width, height, opts);
    wm = baseBox;
    const pad = Math.max(6, Math.round(Math.min(wm.width, wm.height) * 0.18));
    roi = {
      x: Math.max(0, wm.x - pad), y: Math.max(0, wm.y - pad),
      width: Math.min(width - Math.max(0, wm.x - pad), wm.width + pad * 2),
      height: Math.min(height - Math.max(0, wm.y - pad), wm.height + pad * 2),
    };
    region = { x: wm.x - roi.x, y: wm.y - roi.y, width: wm.width, height: wm.height };
  } else {
    const base = opts.mode === 'gemini' ? getWatermarkInfo(width, height) : this.getVeoWatermark(width, height);
    wm = resolveBox(base, width, height, opts);
    roi = getRoi(width, height, wm);
    alpha = buildAlpha(this.engine.bg96, roi, wm, gain);
    region = { x: 0, y: 0, width: roi.width, height: roi.height };
  }

  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat(), target });
  const videoSource = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: QUALITY_HIGH,
    keyFrameInterval: 2,
    sizeChangeBehavior: 'passThrough',
  });
  output.addVideoTrack(videoSource, { frameRate });

  let audioSource = null;
  let audioTrack = null;
  let audioDecoderConfig = null;
  try {
    audioTrack = await input.getPrimaryAudioTrack();
    if (audioTrack) {
      const audioCodec = await audioTrack.getCodec();
      audioDecoderConfig = await audioTrack.getDecoderConfig().catch(() => null);
      if (audioCodec && audioDecoderConfig) {
        audioSource = new EncodedAudioPacketSource(audioCodec);
        output.addAudioTrack(audioSource);
      }
    }
  } catch {
    audioSource = null;
  }

  await output.start();

  const fallbackDur = frameRate > 0 ? 1 / frameRate : 1 / 30;
  const sink = new VideoSampleSink(videoTrack);
  let firstTimestamp = null;
  let lastTimestamp = -1;
  for await (const sample of sink.samples()) {
    if (firstTimestamp === null) firstTimestamp = sample.timestamp;
    let timestamp = sample.timestamp - firstTimestamp;
    if (!(timestamp >= 0)) timestamp = 0;
    if (timestamp <= lastTimestamp) timestamp = lastTimestamp + fallbackDur;
    const dur = Number.isFinite(sample.duration) && sample.duration > 0 ? sample.duration : fallbackDur;
    lastTimestamp = timestamp;

    sample.draw(ctx, 0, 0, width, height);
    sample.close();

    const px = ctx.getImageData(roi.x, roi.y, roi.width, roi.height);
    if (isGeneric) {
      uniCleanGenericRegion(px, roi.width, roi.height, region, { strength: opts.gain ?? 1 });
    } else {
      removeWatermark(px, alpha, region);
    }

    // Force GPU texture sync for WebCodecs by using ImageBitmap
    const bmp = await createImageBitmap(px);
    ctx.drawImage(bmp, roi.x, roi.y);
    bmp.close();

    await videoSource.add(timestamp, dur);
    if (duration) onProgress({ progress: Math.min(0.99, timestamp / duration) });
  }
  videoSource.close();

  if (audioSource) {
    try {
      const offset = firstTimestamp ?? 0;
      const aSink = new EncodedPacketSink(audioTrack);
      let isFirstAudio = true;
      let lastAudioTs = -1;
      for await (const packet of aSink.packets()) {
        let newTs = packet.timestamp - offset;
        if (newTs < 0) continue;
        if (newTs <= lastAudioTs) newTs = lastAudioTs + 1e-6;
        lastAudioTs = newTs;
        let outPacket = packet;
        if (newTs !== packet.timestamp && typeof packet.clone === 'function') {
          outPacket = packet.clone({ timestamp: newTs });
        }
        await audioSource.add(
          outPacket,
          isFirstAudio && audioDecoderConfig ? { decoderConfig: audioDecoderConfig } : undefined
        );
        isFirstAudio = false;
      }
    } catch (e) {
      console.warn('Audio passthrough failed.', e);
    } finally {
      audioSource.close();
    }
  }

  await output.finalize();
  input.dispose?.();

  if (!target.buffer) {
    URL.revokeObjectURL(originalUrl);
    throw new Error('Video export produced no output.');
  }

  const blob = new Blob([target.buffer], { type: 'video/mp4' });
  onProgress({ progress: 1 });

  return {
    blob,
    url: URL.createObjectURL(blob),
    originalUrl,
    ext: 'mp4',
    mime: 'video/mp4',
    width,
    height,
  };
};

// ── 5. Unified panel controller (replaces both init functions in main.js) ──

function uniGrabImageFrame(file) {
  return (async () => {
    if (typeof createImageBitmap === 'function') {
      try {
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const width = bmp.width, height = bmp.height;
        const c = document.createElement('canvas');
        c.width = width; c.height = height;
        const cx = c.getContext('2d', { willReadFrequently: true });
        cx.drawImage(bmp, 0, 0, width, height);
        const imageData = cx.getImageData(0, 0, width, height);
        bmp.close();
        return { width, height, imageData };
      } catch { /* fall through */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.drawImage(img, 0, 0, w, h);
      return { width: w, height: h, imageData: cx.getImageData(0, 0, w, h) };
    } finally {
      URL.revokeObjectURL(url);
    }
  })();
}

function uniIsFrameMeaningful(imageData) {
  const data = imageData.data;
  let sum = 0, sumSq = 0, samples = 0;
  const step = Math.max(4, Math.floor(data.length / 2000) * 4);
  for (let i = 0; i < data.length; i += step) {
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += lum; sumSq += lum * lum; samples++;
  }
  if (!samples) return false;
  const mean = sum / samples;
  const variance = (sumSq / samples) - mean * mean;
  return mean > 12 && mean < 245 && variance > 10;
}

function uniGrabPreviewFrame(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.preload = 'auto';
    v.muted = true;
    v.playsInline = true;
    v.src = url;

    let cleanedUp = false;
    const cleanup = () => {
      if (!cleanedUp) {
        cleanedUp = true;
        URL.revokeObjectURL(url);
        v.removeAttribute('src');
        v.load();
      }
    };

    const globalTimeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for video frame extraction.'));
    }, 10000);

    v.onerror = () => {
      clearTimeout(globalTimeout);
      cleanup();
      reject(new Error('Could not read this video file.'));
    };

    const onReady = async () => {
      v.onloadedmetadata = null;
      v.onloadeddata = null;

      const duration = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 1;
      const ratios = [0.35, 0.50, 0.20, 0.65, 0.10];
      const timestamps = ratios.map(r => Math.min(Math.max(duration * r, 0.05), Math.max(0.05, duration - 0.05)));

      let bestFrame = null;
      let highestVariance = -1;

      const w = v.videoWidth || 720;
      const h = v.videoHeight || 1280;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const cx = c.getContext('2d', { willReadFrequently: true });

      const seekAndCapture = (time) => new Promise((res) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(seekTimer);
          v.removeEventListener('seeked', onSeeked);
          try {
            cx.drawImage(v, 0, 0, w, h);
            res(cx.getImageData(0, 0, w, h));
          } catch { res(null); }
        };
        const onSeeked = () => { setTimeout(finish, 20); };
        const seekTimer = setTimeout(finish, 1200);
        v.addEventListener('seeked', onSeeked, { once: true });
        try {
          if (Math.abs(v.currentTime - time) < 0.01) finish();
          else v.currentTime = time;
        } catch { finish(); }
      });

      for (const t of timestamps) {
        const imageData = await seekAndCapture(t);
        if (!imageData) continue;
        if (uniIsFrameMeaningful(imageData)) {
          clearTimeout(globalTimeout);
          cleanup();
          resolve({ width: w, height: h, imageData });
          return;
        }
        const data = imageData.data;
        let sum = 0, sumSq = 0, samples = 0;
        const step = Math.max(4, Math.floor(data.length / 1000) * 4);
        for (let i = 0; i < data.length; i += step) {
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          sum += lum; sumSq += lum * lum; samples++;
        }
        const mean = sum / (samples || 1);
        const variance = (sumSq / (samples || 1)) - mean * mean;
        if (variance > highestVariance) { highestVariance = variance; bestFrame = imageData; }
      }

      clearTimeout(globalTimeout);
      cleanup();
      if (bestFrame) resolve({ width: w, height: h, imageData: bestFrame });
      else reject(new Error('Could not extract a readable frame from this video.'));
    };

    if (v.readyState >= 1) onReady();
    else { v.onloadedmetadata = onReady; v.onloadeddata = onReady; }
  });
}

function uniInitRemoverPanel(kind) {
  const P = kind === 'video' ? 'video' : 'img';
  const dropzone = document.getElementById(`${P}-dropzone`);
  const fileInput = document.getElementById(`${P}-input`);
  const resultsArea = document.getElementById(`${P}-results`);
  const statusContainer = document.getElementById(`${kind === 'video' ? 'video-status' : 'img-results'}`);

  const stagingCard = document.getElementById(`${P}-staging-card`);
  const stagingPreview = document.getElementById(`${P}-staging-preview`);
  const stagingFilename = document.getElementById(`${P}-staging-filename`);
  const stagingDims = document.getElementById(`${P}-staging-dims`);
  const btnAutoDetect = document.getElementById(`btn-${P}-auto-detect`);
  const btnChangeFile = document.getElementById(`btn-${P}-change-file`);

  const tunerContainer = document.getElementById(`${P}-tuner-container`);
  const mainCanvas = document.getElementById(`${P}-main-canvas`);
  const zoomCanvas = document.getElementById(`${P}-zoom-canvas`);
  const zoomCleanedCanvas = document.getElementById(`${P}-zoom-cleaned-canvas`);

  const sliderGain = document.getElementById(`slider-${P}-gain`);
  const sliderScale = document.getElementById(`slider-${P}-scale`);
  const sliderOffsetX = document.getElementById(`slider-${P}-offset-x`);
  const sliderOffsetY = document.getElementById(`slider-${P}-offset-y`);

  const lblGain = document.getElementById(`lbl-${P}-gain`);
  const lblScale = document.getElementById(`lbl-${P}-scale`);
  const lblOffsetX = document.getElementById(`lbl-${P}-offset-x`);
  const lblOffsetY = document.getElementById(`lbl-${P}-offset-y`);

  const btnResetSliders = document.getElementById(`btn-${P}-reset-sliders`);
  const btnExport = document.getElementById(`btn-${P}-export`);
  const badgeEl = document.getElementById(`${P}-detect-badge`);
  const dragHint = document.getElementById(`${P}-drag-hint`);

  if (!dropzone || !fileInput) return;

  let currentFile = null;
  let currentPreviewFrame = null;
  let currentOriginalBitmap = null;
  let isProcessing = false;

  // panel state (v2)
  let currentPreset = kind === 'video' ? 'veo' : 'new';
  let currentMode = 'sparkle';
  let currentBase = null;          // geometry box the sliders modify
  let customBox = null;            // absolute box from dragging / generic detect
  let detectedInfo = null;         // last auto-detect result (for the badge)
  let dragRect = null;             // in-progress rubber band (image px)

  const currentSettings = kind === 'video'
    ? { gain: 0.6, offsetX: -24, offsetY: -24, sizeScale: 1 }
    : { gain: 0.6, offsetX: -128, offsetY: -128, sizeScale: 1 };

  const presetList = UNI_PRESETS[kind === 'video' ? 'video' : 'image'];
  const getPresetDef = (key) => presetList.find(p => p.key === key) || presetList[0];

  function setDropzoneLoading(loading, message) {
    isProcessing = loading;
    if (loading) {
      dropzone.classList.add('loading');
      dropzone.innerHTML = `
        <div class="dropzone-loader">
          <div class="dropzone-spinner"></div>
          <p class="dropzone-title text-indigo-600">${message}</p>
          <p class="dropzone-sub">Please wait, analyzing watermark...</p>
        </div>`;
    } else {
      dropzone.classList.remove('loading');
      dropzone.innerHTML = kind === 'video' ? `
        <div class="dropzone-icon"><iconify-icon icon="ph:video-bold"></iconify-icon></div>
        <p class="dropzone-title">Upload or drag a video</p>
        <p class="dropzone-sub">Gemini · Veo · Sora · Kling · Grok · Hailuo · Luma · Runway · any mark — MP4, WebM, MOV</p>` : `
        <div class="dropzone-icon"><iconify-icon icon="ph:upload-simple-bold"></iconify-icon></div>
        <p class="dropzone-title">Upload or drag your image</p>
        <p class="dropzone-sub">Gemini · Nano Banana · Sora · Grok · caption bars · any mark — PNG, JPG, WebP</p>`;
      // innerHTML replacement destroys the file <input> (it lives inside the
      // dropzone) — re-attach the SAME node so it stays bound and clickable
      if (fileInput && !fileInput.isConnected) {
        dropzone.appendChild(fileInput);
      }
    }
  }

  function updateSliderLabels() {
    if (lblGain) lblGain.textContent = `${currentSettings.gain.toFixed(2)}x`;
    if (lblScale) lblScale.textContent = `${currentSettings.sizeScale.toFixed(2)}x`;
    if (lblOffsetX) lblOffsetX.textContent = `${currentSettings.offsetX}px`;
    if (lblOffsetY) lblOffsetY.textContent = `${currentSettings.offsetY}px`;
  }

  function updateDetectBadge() {
    if (!badgeEl) return;
    if (detectedInfo && detectedInfo.matchFound) {
      badgeEl.className = 'detect-badge';
      badgeEl.innerHTML = `<iconify-icon icon="ph:scan" width="16" style="color: #6366f1;"></iconify-icon> <span>Auto-Detected: <strong>${detectedInfo.name || detectedInfo.presetKey || 'watermark'}</strong>${Number.isFinite(detectedInfo.score) ? ` (${Math.round(detectedInfo.score * 100)}% match)` : ''}</span>`;
      badgeEl.classList.remove('hidden');
    } else if (currentMode === 'generic') {
      badgeEl.className = 'detect-badge';
      badgeEl.innerHTML = `<iconify-icon icon="ph:magic-wand" width="16" style="color: #0d9488;"></iconify-icon> <span>Universal engine — ${getPresetDef(currentPreset).label}</span>`;
      badgeEl.classList.remove('hidden');
    } else if (detectedInfo) {
      badgeEl.className = 'detect-badge warning';
      badgeEl.innerHTML = `<iconify-icon icon="ph:info" width="16" style="color: #d97706;"></iconify-icon> <span>Standard Preset Applied (${detectedInfo.name || getPresetDef(currentPreset).label})</span>`;
      badgeEl.classList.remove('hidden');
    } else {
      badgeEl.classList.add('hidden');
    }
  }

  function frameDims() {
    return currentPreviewFrame
      ? { w: currentPreviewFrame.width, h: currentPreviewFrame.height }
      : (kind === 'video' ? { w: 720, h: 720 } : { w: 1536, h: 1536 });
  }

  function activatePreset(key, keepSettings = false) {
    const def = getPresetDef(key);
    currentPreset = key;
    if (def.custom) {
      // custom: keep whatever box we have (or a sane default), sliders keep values
      currentMode = 'generic';
      if (!customBox) {
        const { w, h } = frameDims();
        const b = uniBaseBox('custom', w, h);
        customBox = { x: b.x, y: b.y, width: b.width, height: b.height };
        currentBase = b;
      }
      if (!keepSettings) Object.assign(currentSettings, { gain: 1, offsetX: 0, offsetY: 0, sizeScale: 1 });
    } else if (def.mode === 'generic') {
      currentMode = 'generic';
      customBox = null; // preset geometry drives the box
      const { w, h } = frameDims();
      currentBase = uniBaseBox(def.key, w, h);
      if (!keepSettings) Object.assign(currentSettings, { gain: 1, offsetX: 0, offsetY: 0, sizeScale: 1 });
    } else {
      currentMode = 'sparkle';
      customBox = null;
      const { w, h } = frameDims();
      const p = kind === 'video'
        ? getAdaptiveVideoPreset(def.sparkle, w, h)
        : getAdaptiveImagePreset(def.sparkle, w, h);
      currentBase = kind === 'video'
        ? videoEngine.getVeoWatermark(w, h)
        : watermarkEngine.getWatermarkInfo(w, h);
      if (!keepSettings) Object.assign(currentSettings, p);
    }
    if (sliderOffsetX) { sliderOffsetX.value = currentSettings.offsetX; }
    if (sliderOffsetY) { sliderOffsetY.value = currentSettings.offsetY; }
    if (sliderGain) sliderGain.value = currentSettings.gain;
    if (sliderScale) sliderScale.value = currentSettings.sizeScale;
    document.querySelectorAll(`#panel-${kind === 'video' ? 'video' : 'image'} .btn-preset`).forEach(b => {
      b.classList.toggle('active', b.dataset.preset === key);
    });
    updateSliderLabels();
    updateDetectBadge();
    renderTuner();
  }

  function activeBox() {
    const { w, h } = frameDims();
    if (currentMode === 'generic') {
      if (currentPreset === 'custom' && customBox) {
        return uniClampBox(uniResolveRect(customBox, w, h, currentSettings), w, h);
      }
      return uniResolveRect(currentBase || uniBaseBox('custom', w, h), w, h, currentSettings);
    }
    return resolveBox(currentBase, w, h, currentSettings);
  }

  function applyAutoSettings() {
    const { w, h } = frameDims();
    if (sliderOffsetX) {
      sliderOffsetX.min = -Math.round(w * 0.45);
      sliderOffsetX.max = Math.round(w * 0.2);
    }
    if (sliderOffsetY) {
      sliderOffsetY.min = -Math.round(h * 0.45);
      sliderOffsetY.max = Math.round(h * 0.2);
    }
    if (detectedInfo && detectedInfo.matchFound) {
      if (detectedInfo.mode === 'generic' && detectedInfo.box) {
        activatePreset('custom');
        customBox = uniClampBox(detectedInfo.box, w, h);
        Object.assign(currentSettings, { gain: 1, offsetX: 0, offsetY: 0, sizeScale: 1 });
      } else {
        Object.assign(currentSettings, {
          gain: detectedInfo.gain ?? currentSettings.gain,
          offsetX: detectedInfo.offsetX ?? 0,
          offsetY: detectedInfo.offsetY ?? 0,
          sizeScale: detectedInfo.sizeScale ?? 1,
        });
        currentMode = 'sparkle';
      }
    }
    if (sliderOffsetX) sliderOffsetX.value = currentSettings.offsetX;
    if (sliderOffsetY) sliderOffsetY.value = currentSettings.offsetY;
    if (sliderGain) sliderGain.value = currentSettings.gain;
    if (sliderScale) sliderScale.value = currentSettings.sizeScale;
    document.querySelectorAll(`#panel-${kind === 'video' ? 'video' : 'image'} .btn-preset`).forEach(b => {
      b.classList.toggle('active', b.dataset.preset === currentPreset);
    });
    updateSliderLabels();
    updateDetectBadge();
    renderTuner();
  }

  const presetButtons = document.querySelectorAll(`#panel-${kind === 'video' ? 'video' : 'image'} .btn-preset`);
  presetButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      detectedInfo = null;
      activatePreset(btn.dataset.preset);
    });
  });

  function bindSlider(element, prop, isFloat = false) {
    if (!element) return;
    element.addEventListener('input', (e) => {
      currentSettings[prop] = isFloat ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
      updateSliderLabels();
      renderTuner();
    });
  }
  bindSlider(sliderGain, 'gain', true);
  bindSlider(sliderScale, 'sizeScale', true);
  bindSlider(sliderOffsetX, 'offsetX', false);
  bindSlider(sliderOffsetY, 'offsetY', false);

  btnResetSliders?.addEventListener('click', () => {
    detectedInfo = null;
    activatePreset(currentPreset);
  });

  dropzone.onclick = () => { if (!isProcessing) fileInput.click(); };
  dropzone.ondragover = (e) => { e.preventDefault(); if (!isProcessing) dropzone.classList.add('drag-over'); };
  dropzone.ondragleave = () => dropzone.classList.remove('drag-over');
  dropzone.ondrop = (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
    if (isProcessing) return;
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  };
  fileInput.onchange = (e) => {
    if (isProcessing) return;
    if (e.target.files.length) handleFile(e.target.files[0]);
    fileInput.value = '';
  };

  // ── manual box dragging on the preview canvas ──
  let dragStart = null;
  function canvasToImage(ev) {
    const r = mainCanvas.getBoundingClientRect();
    const sx = (ev.clientX - r.left) / r.width;
    const sy = (ev.clientY - r.top) / r.height;
    const { imageData, width, height } = currentPreviewFrame;
    return { x: sx * width, y: sy * height };
  }
  if (mainCanvas) {
    mainCanvas.style.cursor = 'crosshair';
    mainCanvas.addEventListener('pointerdown', (ev) => {
      if (!currentPreviewFrame) return;
      ev.preventDefault();
      mainCanvas.setPointerCapture(ev.pointerId);
      dragStart = canvasToImage(ev);
      dragRect = null;
    });
    mainCanvas.addEventListener('pointermove', (ev) => {
      if (!dragStart || !currentPreviewFrame) return;
      const p = canvasToImage(ev);
      dragRect = {
        x: Math.min(dragStart.x, p.x), y: Math.min(dragStart.y, p.y),
        width: Math.abs(p.x - dragStart.x), height: Math.abs(p.y - dragStart.y),
      };
      renderTuner();
    });
    const endDrag = (ev) => {
      if (!dragStart) return;
      const p = ev ? canvasToImage(ev) : null;
      if (p) {
        dragRect = {
          x: Math.min(dragStart.x, p.x), y: Math.min(dragStart.y, p.y),
          width: Math.abs(p.x - dragStart.x), height: Math.abs(p.y - dragStart.y),
        };
      }
      dragStart = null;
      if (dragRect && dragRect.width >= 8 && dragRect.height >= 8) {
        const { w, h } = frameDims();
        customBox = uniClampBox(dragRect, w, h);
        detectedInfo = {
          matchFound: true, mode: 'generic', score: 1,
          name: 'Custom box (dragged)',
        };
        currentPreset = 'custom';
        currentMode = 'generic';
        Object.assign(currentSettings, { gain: 1, offsetX: 0, offsetY: 0, sizeScale: 1 });
        document.querySelectorAll(`#panel-${kind === 'video' ? 'video' : 'image'} .btn-preset`).forEach(b => {
          b.classList.toggle('active', b.dataset.preset === 'custom');
        });
      }
      dragRect = null;
      updateDetectBadge();
      renderTuner();
    };
    mainCanvas.addEventListener('pointerup', endDrag);
    mainCanvas.addEventListener('pointercancel', () => { dragStart = null; dragRect = null; renderTuner(); });
  }

  function renderTuner() {
    if (!currentPreviewFrame || !mainCanvas) return;
    const { width, height, imageData } = currentPreviewFrame;
    const engineImg = kind === 'video'
      ? (videoEngine ? videoEngine.sparkleImage : null)
      : (watermarkEngine ? watermarkEngine.bg96 : null);
    if (kind === 'video' && !videoEngine) return;
    if (kind !== 'video' && !watermarkEngine) return;

    const offscreen = document.createElement('canvas');
    offscreen.width = width;
    offscreen.height = height;

    const copy = new ImageData(new Uint8ClampedArray(imageData.data), width, height);
    let box, roi;
    if (currentMode === 'generic') {
      box = activeBox();
      uniCleanGenericRegion(copy, width, height, box, { strength: currentSettings.gain });
      const pad = Math.max(6, Math.round(Math.min(box.width, box.height) * 0.25));
      roi = {
        x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad),
        width: Math.min(width - Math.max(0, box.x - pad), box.width + pad * 2),
        height: Math.min(height - Math.max(0, box.y - pad), box.height + pad * 2),
      };
    } else if (engineImg) {
      const r = cleanFrame(engineImg, copy, width, height, currentBase, currentSettings);
      box = r.wm; roi = r.roi;
    } else {
      return;
    }

    offscreen.getContext('2d').putImageData(copy, 0, 0);

    const maxW = 360;
    const scale = Math.min(1, maxW / width);
    mainCanvas.width = Math.round(width * scale);
    mainCanvas.height = Math.round(height * scale);
    const mctx = mainCanvas.getContext('2d');
    mctx.drawImage(offscreen, 0, 0, mainCanvas.width, mainCanvas.height);
    mctx.strokeStyle = currentMode === 'generic' ? '#0d9488' : '#6366f1';
    mctx.lineWidth = 2;
    mctx.setLineDash(currentMode === 'generic' ? [6, 4] : []);
    mctx.strokeRect(box.x * scale, box.y * scale, box.width * scale, box.height * scale);
    mctx.setLineDash([]);
    if (dragRect && (dragRect.width > 2 && dragRect.height > 2)) {
      mctx.strokeStyle = '#16a34a';
      mctx.setLineDash([4, 3]);
      mctx.strokeRect(dragRect.x * scale, dragRect.y * scale, dragRect.width * scale, dragRect.height * scale);
      mctx.setLineDash([]);
    }

    if (zoomCanvas && currentOriginalBitmap) {
      const zctx = zoomCanvas.getContext('2d');
      zctx.imageSmoothingEnabled = false;
      zctx.clearRect(0, 0, zoomCanvas.width, zoomCanvas.height);
      zctx.drawImage(currentOriginalBitmap, roi.x, roi.y, roi.width, roi.height, 0, 0, zoomCanvas.width, zoomCanvas.height);
      const sx = zoomCanvas.width / roi.width;
      const sy = zoomCanvas.height / roi.height;
      zctx.strokeStyle = '#2563eb';
      zctx.lineWidth = 2;
      zctx.strokeRect((box.x - roi.x) * sx, (box.y - roi.y) * sy, box.width * sx, box.height * sy);
    }

    if (zoomCleanedCanvas) {
      const zctx = zoomCleanedCanvas.getContext('2d');
      zctx.imageSmoothingEnabled = false;
      zctx.clearRect(0, 0, zoomCleanedCanvas.width, zoomCleanedCanvas.height);
      zctx.drawImage(offscreen, roi.x, roi.y, roi.width, roi.height, 0, 0, zoomCleanedCanvas.width, zoomCleanedCanvas.height);
      const sx = zoomCleanedCanvas.width / roi.width;
      const sy = zoomCleanedCanvas.height / roi.height;
      zctx.strokeStyle = '#16a34a';
      zctx.lineWidth = 2;
      zctx.strokeRect((box.x - roi.x) * sx, (box.y - roi.y) * sy, box.width * sx, box.height * sy);
    }
  }

  async function handleFile(file) {
    const typeOk = kind === 'video' ? file.type.startsWith('video/') : file.type.startsWith('image/');
    if (!typeOk || isProcessing) return;

    setDropzoneLoading(true, kind === 'video' ? 'Extracting best preview frame...' : 'Loading image preview...');
    currentFile = file;
    customBox = null;
    detectedInfo = null;

    resultsArea.classList.add('hidden');
    if (kind === 'video') statusContainer.classList.add('hidden');
    tunerContainer.classList.add('hidden');

    try {
      if (kind === 'video') {
        if (!videoEngine) videoEngine = await VideoWatermarkEngine.create();
        currentPreviewFrame = await uniGrabPreviewFrame(file);
        if (stagingPreview) {
          const c = document.createElement('canvas');
          c.width = currentPreviewFrame.width;
          c.height = currentPreviewFrame.height;
          c.getContext('2d').putImageData(currentPreviewFrame.imageData, 0, 0);
          stagingPreview.src = c.toDataURL('image/jpeg', 0.85);
        }
      } else {
        if (!watermarkEngine) watermarkEngine = await WatermarkEngine.create();
        currentPreviewFrame = await uniGrabImageFrame(file);
        if (stagingPreview) stagingPreview.src = URL.createObjectURL(file);
      }

      if (stagingFilename) stagingFilename.textContent = file.name;
      if (stagingDims) stagingDims.textContent = `${currentPreviewFrame.width} × ${currentPreviewFrame.height} px`;

      dropzone.classList.add('hidden');
      if (stagingCard) {
        stagingCard.classList.remove('hidden');
        smoothScrollTo(stagingCard);
      }
    } catch (err) {
      console.error(err);
      alert(`Error loading ${kind}: ` + (err.message || err));
    } finally {
      setDropzoneLoading(false);
    }
  }

  btnAutoDetect?.addEventListener('click', async () => {
    if (!currentFile || !currentPreviewFrame) return;
    if (kind === 'video' && !videoEngine) return;
    if (kind !== 'video' && !watermarkEngine) return;

    if (stagingCard) stagingCard.classList.add('hidden');

    try {
      const { width, height, imageData } = currentPreviewFrame;
      if (currentOriginalBitmap) currentOriginalBitmap.close();
      currentOriginalBitmap = await createImageBitmap(imageData);

      const sparkleImg = kind === 'video' ? videoEngine.sparkleImage : watermarkEngine.bg96;
      const sparkle = kind === 'video'
        ? detectVideoWatermarkCandidate(imageData, width, height, sparkleImg)
        : detectWatermarkCandidate(imageData, width, height, sparkleImg);
      const generic = uniDetectGeneric(imageData, width, height);

      const sparkleWins = sparkle.matchFound && sparkle.score >= 0.10 && (!generic.matchFound || sparkle.score >= generic.score);
      const genericWins = generic.matchFound && (!sparkleWins);

      if (sparkleWins) {
        detectedInfo = sparkle;
        currentPreset = (sparkle.presetKey && getPresetDef(sparkle.presetKey)) ? sparkle.presetKey : (kind === 'video' ? 'veo' : 'new');
        currentMode = 'sparkle';
        customBox = null;
        currentBase = kind === 'video'
          ? videoEngine.getVeoWatermark(width, height)
          : watermarkEngine.getWatermarkInfo(width, height);
      } else if (genericWins) {
        detectedInfo = generic;
        currentPreset = 'custom';
        currentMode = 'generic';
        customBox = uniClampBox(generic.box, width, height);
        currentBase = { ...customBox };
      } else {
        detectedInfo = sparkle.matchFound ? sparkle : null;
        activatePreset(kind === 'video' ? 'veo' : 'new', true);
        detectedInfo = detectedInfo || { matchFound: false, name: getPresetDef(currentPreset).label };
      }

      tunerContainer.classList.remove('hidden');
      if (dragHint) dragHint.classList.remove('hidden');
      applyAutoSettings();
      smoothScrollTo(tunerContainer);
    } catch (err) {
      console.error('Error running auto detection:', err);
      tunerContainer.classList.remove('hidden');
    }
  });

  function resetUploader() {
    if (stagingCard) stagingCard.classList.add('hidden');
    tunerContainer.classList.add('hidden');
    if (kind === 'video') statusContainer.classList.add('hidden');
    resultsArea.classList.add('hidden');
    dropzone.classList.remove('hidden');
    fileInput.value = '';
    currentFile = null;
    currentPreviewFrame = null;
    customBox = null;
    detectedInfo = null;
    if (currentOriginalBitmap) { currentOriginalBitmap.close(); currentOriginalBitmap = null; }
    smoothScrollTo(dropzone);
  }

  btnChangeFile?.addEventListener('click', resetUploader);
  document.getElementById(`btn-${P}-change-file-tuner`)?.addEventListener('click', resetUploader);

  btnExport?.addEventListener('click', async () => {
    if (!currentFile || !currentPreviewFrame) return;
    if (kind === 'video' && !videoEngine) return;
    if (kind !== 'video' && !watermarkEngine) return;

    tunerContainer.classList.add('hidden');
    resultsArea.classList.add('hidden');

    try {
      if (kind === 'image') {
        const { width, height, imageData } = currentPreviewFrame;
        const copy = new ImageData(new Uint8ClampedArray(imageData.data), width, height);
        if (currentMode === 'generic') {
          uniCleanGenericRegion(copy, width, height, activeBox(), { strength: currentSettings.gain });
        } else {
          cleanFrame(watermarkEngine.bg96, copy, width, height, currentBase, currentSettings);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').putImageData(copy, 0, 0);

        const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
        const originalUrl = URL.createObjectURL(currentFile);
        const url = URL.createObjectURL(blob);

        resultsArea.classList.remove('hidden');
        resultsArea.innerHTML = `
          <div class="card">
            <h3 class="font-bold text-center mb-4">Image Watermark Cleaned Successfully!</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p class="text-xs mb-2">Original (${width}x${height}px)</p>
                <div class="checker p-2 text-center">
                  <img src="${originalUrl}" alt="Original image with watermark" style="max-height: 250px; margin: 0 auto; object-fit: contain; width: 100%;" />
                </div>
              </div>
              <div>
                <p class="text-xs mb-2 text-green-600">Cleaned Result</p>
                <div class="checker p-2 text-center">
                  <img src="${url}" alt="Cleaned result image without watermark" style="max-height: 250px; margin: 0 auto; object-fit: contain; width: 100%;" />
                </div>
              </div>
            </div>
            <div class="mt-4 text-center flex items-center justify-center gap-3">
              <a href="${url}" download="clean_${currentFile.name}" class="btn btn-primary" id="btn-img-download">
                <iconify-icon icon="ph:download-simple-bold" width="16"></iconify-icon>
                Download Cleaned PNG
              </a>
              <button type="button" class="btn btn-secondary text-xs" id="btn-img-clean-another">
                <iconify-icon icon="ph:arrows-clockwise" width="16"></iconify-icon>
                Clean Another
              </button>
            </div>
          </div>`;
        document.getElementById('btn-img-clean-another')?.addEventListener('click', resetUploader);
        smoothScrollTo(resultsArea);
      } else {
        const progressBar = document.getElementById('video-progress-bar');
        const progressText = document.getElementById('video-progress-text');
        statusContainer.classList.remove('hidden');
        if (progressBar) progressBar.style.width = '0%';
        if (progressText) progressText.textContent = '0%';
        smoothScrollTo(statusContainer);

        const processOpts = {
          ...currentSettings,
          onProgress: ({ progress }) => {
            const pct = Math.round(progress * 100);
            if (progressBar) progressBar.style.width = `${pct}%`;
            if (progressText) progressText.textContent = `${pct}% — keep tab open`;
          },
        };
        if (currentMode === 'generic') {
          processOpts.mode = 'generic';
          processOpts.preset = currentPreset;
          processOpts.box = activeBox();
        }

        const res = await videoEngine.process(currentFile, processOpts);

        statusContainer.classList.add('hidden');
        resultsArea.classList.remove('hidden');
        resultsArea.innerHTML = `
          <div class="card">
            <h3 class="font-bold text-center mb-4">Video Watermark Cleaned Successfully!</h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p class="text-xs mb-2">Original Video</p>
                <video src="${res.originalUrl}" controls playsinline style="width:100%; max-height:280px;"></video>
              </div>
              <div>
                <p class="text-xs mb-2 text-green-600">Cleaned Video</p>
                <video src="${res.url}" controls playsinline style="width:100%; max-height:280px;"></video>
              </div>
            </div>
            <div class="mt-4 text-center flex items-center justify-center gap-3">
              <a href="${res.url}" download="clean_${currentFile.name}" class="btn btn-primary" id="btn-video-download">
                <iconify-icon icon="ph:download-simple-bold" width="16"></iconify-icon>
                Download Cleaned Video MP4
              </a>
              <button type="button" class="btn btn-secondary text-xs" id="btn-video-clean-another">
                <iconify-icon icon="ph:arrows-clockwise" width="16"></iconify-icon>
                Clean Another Video
              </button>
            </div>
          </div>`;
        document.getElementById('btn-video-clean-another')?.addEventListener('click', resetUploader);
        smoothScrollTo(resultsArea);
      }
    } catch (err) {
      console.error(err);
      if (kind === 'video') {
        statusContainer.classList.add('hidden');
        tunerContainer.classList.remove('hidden');
        alert(`Video processing failed: ${err.message || err}`);
      } else {
        alert('Error exporting image: ' + err.message);
      }
    }
  });

  // reset dropzone copy on load (in case HTML still has the old Gemini-only text)
  setDropzoneLoading(false);
}

function initImageRemover() { uniInitRemoverPanel('image'); }
function initVideoRemover() { uniInitRemoverPanel('video'); }

// Point the GitHub star badge at this fork/build's repo
async function fetchGitHubStars() {
  const starCountEl = document.getElementById('star-count-num');
  if (!starCountEl) return;
  try {
    const res = await fetch('https://api.github.com/repos/mdshezkhn/gemini-watermark-remover');
    if (res.ok) {
      const data = await res.json();
      if (typeof data.stargazers_count === 'number') starCountEl.textContent = data.stargazers_count;
    }
  } catch (e) { /* offline is fine */ }
}
