import fs from 'fs';
import { E } from './engine_harness.mjs';
const { rw, rh, rgba } = JSON.parse(fs.readFileSync('qa/out/cmp_in.json', 'utf8'));
const data = new Uint8ClampedArray(rgba.flat().map(v => Math.round(v)));
class ImageDataPoly {
  constructor(data, w, h) { this.data = data; this.width = w; this.height = h; }
}
const id = new ImageDataPoly(data, rw, rh);
E.uniCleanGenericRegion(id, rw, rh, { x: 14, y: 14, width: rw-28, height: rh-28 }, { strength: 1 });
fs.writeFileSync('qa/out/cmp_js.json', JSON.stringify({ out: Array.from(id.data) }));
console.log('js done');
