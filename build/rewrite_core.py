#!/usr/bin/env python3
"""Replace uniCleanGenericRegion in universal.js with the per-channel version."""
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
p = ROOT / "universal.js"
src = p.read_text(encoding="utf-8")
start = src.index("function uniCleanGenericRegion(")
end = src.index("// 3\u00d73 mean smoothing restricted to masked pixels (inpaint polish).")

NEW = r"""function uniCleanGenericRegion(imageData, fw, fh, absBox, opts = {}) {
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
            if (a2 < OPAQUE) {
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

"""

p.write_text(src[:start] + NEW + src[end:], encoding="utf-8", newline="\n")
print("uniCleanGenericRegion rewritten, total lines:", len((src[:start] + NEW + src[end:]).splitlines()))
