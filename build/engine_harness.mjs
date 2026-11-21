import fs from 'fs';
const src = fs.readFileSync('universal.js', 'utf8');
const start = src.indexOf('// ── 1. Universal preset registry');
const end = src.indexOf('// ── 4. Video engine patch');
const engine = src.slice(start, end);
const fn = new Function(`
  const document = { createElement: () => ({ getContext: () => null }), getElementById: () => null, addEventListener: () => {}, body: { classList: { add(){}, remove(){} } } };
  class ImageDataPoly { constructor(a, b, c) { if (typeof a === 'number') { this.data = new Uint8ClampedArray(a * b * 4); this.width = a; this.height = b; } else { this.data = a; this.width = b; this.height = c; } } }
  globalThis.ImageData = ImageDataPoly;
  ${engine}
  return { uniCleanGenericRegion, uniDetectGeneric, UNI_GEOM, uniBaseBox, uniResolveRect, uniClampBox, uniEstimateBackground };
`);
export const E = fn();
