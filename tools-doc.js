/* ─────────────────────────────────────────────────────────────────────────────
   MediaMaid v4 — PDF engines (pdf-lib, lazy-loaded) + canvas image toolbox.
   ────────────────────────────────────────────────────────────────────────── */
'use strict';

(() => {
  const MMT = window.MMT;

  // ── PDF: merge ────────────────────────────────────────────────────────────
  async function mergePdfs(files, onProgress) {
    const { PDFDocument } = await MMT.pdfLib();
    const out = await PDFDocument.create();
    for (let i = 0; i < files.length; i++) {
      const src = await PDFDocument.load(await files[i].arrayBuffer(), { ignoreEncryption: true });
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((p) => out.addPage(p));
      if (onProgress) onProgress((i + 1) / files.length * 0.8);
    }
    const bytes = await out.save();
    if (onProgress) onProgress(1);
    return new Blob([bytes], { type: 'application/pdf' });
  }

  // ── PDF: split → one file per page (ZIP) ──────────────────────────────────
  async function splitPdf(file, onProgress) {
    const { PDFDocument } = await MMT.pdfLib();
    const src = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
    const n = src.getPageCount();
    const outs = [];
    for (let i = 0; i < n; i++) {
      const doc = await PDFDocument.create();
      const [p] = await doc.copyPages(src, [i]);
      doc.addPage(p);
      const bytes = await doc.save();
      outs.push({ name: MMT.baseName(file.name) + `-p${i + 1}.pdf`, blob: new Blob([bytes], { type: 'application/pdf' }) });
      if (onProgress) onProgress((i + 1) / n * 0.9);
    }
    return outs;
  }

  // ── PDF: rotate pages ─────────────────────────────────────────────────────
  async function rotatePdf(file, angle, pages, onProgress) {
    const { degrees } = await MMT.pdfLib();
    const { PDFDocument } = await MMT.pdfLib();
    const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
    const sel = pages && pages.length ? pages : doc.getPageIndices();
    for (const i of sel) {
      const p = doc.getPage(i);
      p.setRotation(degrees((p.getRotation().angle + angle) % 360));
      if (onProgress) onProgress(0.5 * (i + 1) / sel.length);
    }
    const bytes = await doc.save();
    if (onProgress) onProgress(1);
    return new Blob([bytes], { type: 'application/pdf' });
  }

  // ── PDF: page numbers ─────────────────────────────────────────────────────
  async function numberPdf(file, opts, onProgress) {
    const { StandardFonts, degrees } = await MMT.pdfLib();
    const { PDFDocument, rgb } = await MMT.pdfLib();
    const { position = 'bottom-center', start = 1, size = 12, skipFirst = false } = opts || {};
    const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.HelveticaBold);
    const pages = doc.getPages();
    let num = start;
    for (let i = 0; i < pages.length; i++) {
      if (skipFirst && i === 0) { continue; }
      const p = pages[i];
      const { width, height } = p.getSize();
      const label = String(num++);
      const tw = font.widthOfTextAtSize(label, size);
      let x = (width - tw) / 2, y = 20;
      if (position === 'bottom-right') { x = width - tw - 30; }
      else if (position === 'bottom-left') { x = 30; }
      else if (position === 'top-right') { x = width - tw - 30; y = height - 30; }
      else if (position === 'top-left') { x = 30; y = height - 30; }
      p.drawText(label, { x, y, size, font, color: rgb(0.15, 0.15, 0.15) });
      if (onProgress) onProgress(0.3 + 0.6 * (i + 1) / pages.length);
    }
    const bytes = await doc.save();
    if (onProgress) onProgress(1);
    return new Blob([bytes], { type: 'application/pdf' });
  }

  // ── PDF: images → PDF ─────────────────────────────────────────────────────
  async function imagesToPdf(files, onProgress) {
    const { PDFDocument } = await MMT.pdfLib();
    const doc = await PDFDocument.create();
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const bytes = await f.arrayBuffer();
      let img;
      if (/\.jpe?g$/i.test(f.name) || f.type === 'image/jpeg') img = await doc.embedJpg(bytes);
      else img = await doc.embedPng(bytes);
      const page = doc.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
      if (onProgress) onProgress((i + 1) / files.length * 0.85);
    }
    const out = await doc.save();
    if (onProgress) onProgress(1);
    return new Blob([out], { type: 'application/pdf' });
  }

  // ── image: convert (png/jpeg/webp via canvas) ─────────────────────────────
  async function convertImage(file, opts, onProgress) {
    const { format = 'jpeg', quality = 0.9, maxDim = 0 } = opts || {};
    const img = await loadImg(file);
    let { width: w, height: h } = img;
    if (maxDim > 0 && Math.max(w, h) > maxDim) {
      const s = maxDim / Math.max(w, h);
      w = Math.round(w * s); h = Math.round(h * s);
    }
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (format === 'jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(img, 0, 0, w, h);
    const mime = format === 'png' ? 'image/png' : format === 'webp' ? 'image/webp' : 'image/jpeg';
    const blob = await new Promise((res) => c.toBlob(res, mime, quality));
    if (onProgress) onProgress(1);
    return { blob, width: w, height: h };
  }

  function loadImg(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('cannot decode image: ' + file.name));
      img.src = URL.createObjectURL(file);
    });
  }

  // ── image: resize (same engine, explicit tool) ────────────────────────────
  async function resizeImage(file, opts, onProgress) {
    return convertImage(file, { format: opts.format || 'jpeg', quality: opts.quality ?? 0.92, maxDim: opts.maxDim || 1920 }, onProgress);
  }

  MMT.docEngines = { mergePdfs, splitPdf, rotatePdf, numberPdf, imagesToPdf, convertImage, resizeImage, loadImg };
})();
