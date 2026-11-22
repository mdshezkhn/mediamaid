/* ─────────────────────────────────────────────────────────────────────────────
   MediaMaid v4 — tools core: shared namespace, mediabunny loader, helpers.
   Classic script; everything hangs off window.MMT. Loaded after compressor.js.
   ────────────────────────────────────────────────────────────────────────── */
'use strict';

window.MMT = (() => {

  const fmtBytes = (b) => {
    if (!Number.isFinite(b)) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(2) + ' MB';
  };
  const fmtTime = (s) => {
    if (!Number.isFinite(s)) return '—';
    s = Math.round(s);
    const m = Math.floor(s / 60), r = s % 60;
    return m + ':' + String(r).padStart(2, '0');
  };
  const fmtTs = (s) => {
    // HH:MM:SS.mmm for time inputs
    if (!Number.isFinite(s) || s < 0) s = 0;
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    const ms = Math.round((s - Math.floor(s)) * 1000);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' +
      String(sec).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
  };

  // ── vendored lazy loader (pdf-lib / lamejs UMD bundles) ───────────────────
  const _loaded = {};
  function loadScript(name, src, test) {
    if (!test) test = () => true;
    return new Promise((resolve, reject) => {
      if (_loaded[name]) return resolve(_loaded[name]);
      if (test()) { _loaded[name] = window[name === 'pdfLib' ? 'PDFLib' : 'lamejs']; return resolve(_loaded[name]); }
      const s = document.createElement('script');
      s.src = src; s.onload = () => { _loaded[name] = window[name === 'pdfLib' ? 'PDFLib' : 'lamejs']; resolve(_loaded[name]); };
      s.onerror = () => reject(new Error('failed to load ' + name));
      document.head.appendChild(s);
    });
  }
  const pdfLib = () => loadScript('pdfLib', './vendor/pdf-lib.min.js', () => !!window.PDFLib);
  const lamejs = () => loadScript('lamejs', './vendor/lame.min.js', () => !!window.lamejs);

  // ── mediabunny loader (vendored, China-safe) ──────────────────────────────
  let _mb = null;
  async function mb() {
    if (!_mb) {
      try { _mb = await import('./vendor/mediabunny.mjs'); }
      catch { _mb = await import('https://cdn.jsdelivr.net/npm/mediabunny@1.52.3/+esm'); }
    }
    return _mb;
  }

  // ── download / zip (same store() as compressor.js) ────────────────────────
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  }
  function crc32(u8) {
    let c, crc = -1;
    for (let i = 0; i < u8.length; i++) {
      c = (crc ^ u8[i]) & 0xff;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
      crc = (crc >>> 8) ^ c;
    }
    return (~crc) >>> 0;
  }
  async function zipStore(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = new Uint8Array(await f.blob.arrayBuffer());
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, 0, true); lh.setUint16(12, 0, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(8, files.length, true);
    eocd.setUint16(10, files.length, true); eocd.setUint32(12, cdSize, true);
    eocd.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(eocd.buffer)], { type: 'application/zip' });
  }

  // ── media probes ──────────────────────────────────────────────────────────
  async function probeVideo(file) {
    const lib = await mb();
    const { ALL_FORMATS, Input, BlobSource } = lib;
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const vTrack = await input.getPrimaryVideoTrack();
    const aTrack = await input.getPrimaryAudioTrack();
    let v = null, a = null;
    if (vTrack) {
      const stats = await vTrack.computePacketStats(80).catch(() => null);
      v = {
        track: vTrack,
        codec: await vTrack.getCodec(),
        w: vTrack.displayWidth, h: vTrack.displayHeight,
        rotation: vTrack.rotation || 0,
        fps: stats ? Math.round(stats.averagePacketRate) : 30,
        bitrate: stats ? Math.round(stats.averageBitrate) : 0,
      };
    }
    if (aTrack) {
      const stats = await aTrack.computePacketStats(80).catch(() => null);
      a = { track: aTrack, codec: await aTrack.getCodec(), bitrate: stats ? Math.round(stats.averageBitrate) : 0 };
    }
    const dur = await input.computeDuration().catch(() => 0);
    return { input, v, a, duration: dur, size: file.size };
  }

  async function probeAudio(file) {
    const ab = await file.arrayBuffer();
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    try {
      const buf = await ctx.decodeAudioData(ab);
      return { buffer: buf, duration: buf.duration, channels: buf.numberOfChannels, sampleRate: buf.sampleRate };
    } finally { ctx.close().catch(() => {}); }
  }

  function isVideoFile(f) { return /\.(mp4|webm|mov|mkv|m4v|avi)$/i.test(f.name) || (f.type || '').startsWith('video/'); }
  function isAudioFile(f) { return /\.(mp3|m4a|aac|wav|ogg|flac|opus)$/i.test(f.name) || (f.type || '').startsWith('audio/'); }
  function isImageFile(f) { return /\.(png|jpe?g|webp|bmp|gif)$/i.test(f.name) || (f.type || '').startsWith('image/'); }
  function isPdfFile(f) { return /\.pdf$/i.test(f.name) || f.type === 'application/pdf'; }

  const baseName = (n) => n.replace(/\.[^.]+$/, '');
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  return {
    fmtBytes, fmtTime, fmtTs, download, zipStore, mb,
    probeVideo, probeAudio,
    pdfLib, lamejs,
    isVideoFile, isAudioFile, isImageFile, isPdfFile,
    baseName, sleep,
  };
})();

if (window.MediaMaid) MediaMaid.toolsCoreLoaded = true;
