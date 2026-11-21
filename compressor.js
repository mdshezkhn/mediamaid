/* ─────────────────────────────────────────────────────────────────────────────
   MediaMaid — Compressor (v3)
   Video + image compression, 100% client-side. Feature-equivalent to
   freeconvert.com/video-compressor (compression methods, advanced settings,
   batch queue) — original code, no upload, no size limits.
   Loaded after main.js + universal.js; does not touch the watermark engines.
   ────────────────────────────────────────────────────────────────────────── */

'use strict';

const MM = (() => {

  // ── small utils ──────────────────────────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const fmtBytes = (b) => {
    if (!Number.isFinite(b)) return '—';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(2) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
  };
  const fmtDur = (s) => {
    if (!Number.isFinite(s) || s <= 0) return '—';
    const m = Math.floor(s / 60), r = Math.floor(s % 60);
    return m > 0 ? `${m}:${String(r).padStart(2, '0')}` : `${r}s`;
  };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));

  // ── STORE-only ZIP writer (media is already compressed; no deflate needed) ─
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function dosTime(d) {
    const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF;
    const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
    return { time, date };
  }
  function buildZip(files) { // files: [{name, data:Uint8Array}]
    const parts = [];
    const central = [];
    let offset = 0;
    const { time, date } = dosTime(new Date());
    const enc = new TextEncoder();
    for (const f of files) {
      const nameU8 = enc.encode(f.name);
      const crc = crc32(f.data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true);
      lh.setUint16(4, 20, true);          // version needed
      lh.setUint16(6, 0x0800, true);      // UTF-8 names
      lh.setUint16(8, 0, true);           // method STORE
      lh.setUint16(10, time, true);
      lh.setUint16(12, date, true);
      lh.setUint32(14, crc, true);
      lh.setUint32(18, f.data.length, true);
      lh.setUint32(22, f.data.length, true);
      lh.setUint16(26, nameU8.length, true);
      lh.setUint16(28, 0, true);
      parts.push(new Uint8Array(lh.buffer), nameU8, f.data);
      central.push({ nameU8, crc, size: f.data.length, offset });
      offset += 30 + nameU8.length + f.data.length;
    }
    const cdStart = offset;
    for (const e of central) {
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true);
      ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, time, true); ch.setUint16(14, date, true);
      ch.setUint32(16, e.crc, true);
      ch.setUint32(20, e.size, true); ch.setUint32(24, e.size, true);
      ch.setUint16(28, e.nameU8.length, true);
      ch.setUint32(42, e.offset, true);
      parts.push(new Uint8Array(ch.buffer), e.nameU8);
      offset += 46 + e.nameU8.length;
    }
    const eocd = new DataView(new ArrayBuffer(22));
    eocd.setUint32(0, 0x06054b50, true);
    eocd.setUint16(8, central.length, true);
    eocd.setUint16(10, central.length, true);
    eocd.setUint32(12, offset - cdStart, true);
    eocd.setUint32(16, cdStart, true);
    parts.push(new Uint8Array(eocd.buffer));
    return new Blob(parts, { type: 'application/zip' });
  }

  // ── mediabunny loader (vendored, China-safe) ──────────────────────────────
  let _mb = null;
  async function mb() {
    if (!_mb) {
      try { _mb = await import('./vendor/mediabunny.mjs'); }
      catch { _mb = await import('https://cdn.jsdelivr.net/npm/mediabunny@1.52.3/+esm'); }
    }
    return _mb;
  }

  // codec support probe → { avc, hevc, vp9, av1 }
  const codecSupport = {};
  async function probeCodecs() {
    const { canEncodeVideo } = await mb();
    for (const c of ['avc', 'hevc', 'vp9', 'av1']) {
      try { codecSupport[c] = await canEncodeVideo(c); }
      catch { codecSupport[c] = false; }
    }
    return codecSupport;
  }

  const CODEC_LABEL = { avc: 'H.264', hevc: 'H.265 (HEVC)', vp9: 'VP9', av1: 'AV1' };
  const CODEC_FORMAT = { avc: 'mp4', hevc: 'mp4', vp9: 'webm', av1: 'mp4' };

  // ── video analysis ────────────────────────────────────────────────────────
  async function analyzeVideo(file) {
    const { ALL_FORMATS, BlobSource, Input } = await mb();
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) throw new Error('No decodable video track found.');
      const width = videoTrack.displayWidth ?? videoTrack.codedWidth;
      const height = videoTrack.displayHeight ?? videoTrack.codedHeight;
      const duration = await input.computeDuration().catch(() => 0);
      let frameRate = 30, srcVBitrate = 0;
      try {
        const stats = await videoTrack.computePacketStats(150);
        if (stats?.averagePacketRate) frameRate = Math.round(stats.averagePacketRate);
        if (stats?.averageBitrate) srcVBitrate = stats.averageBitrate;
      } catch { }
      let audioBitrate = 0, hasAudio = false;
      try {
        const at = await input.getPrimaryAudioTrack();
        if (at) {
          hasAudio = true;
          const s = await at.computePacketStats(150).catch(() => null);
          if (s?.averageBitrate) audioBitrate = s.averageBitrate;
        }
      } catch { }
      if (!srcVBitrate && duration > 0) {
        // estimate: (file size − audio) / duration
        srcVBitrate = Math.max(0, (file.size * 8) / duration - (hasAudio ? (audioBitrate || 96000) : 0));
      }
      return { width, height, duration, frameRate, srcVBitrate, hasAudio, audioBitrate };
    } finally {
      input.dispose?.();
    }
  }

  // map quality stop (1=Best…5=Smallest) → bitrate factor of the source
  const QUALITY_FACTOR = [0.78, 0.55, 0.38, 0.24, 0.13];

  /**
   * Compress one video. opts:
   *  mode: 'quality' | 'target' | 'bitrate'
   *  quality: 1..5 (quality mode)
   *  targetPct: 1..100 (target mode — % of original file size)
   *  bitrateKbps: number (bitrate mode)
   *  codec: 'auto'|'avc'|'hevc'|'vp9'|'av1'  · format: 'auto'|'mp4'|'webm'
   *  maxH: 0 (original) | 1080 | 720 | 480 | 360 (caps the LONGER side)
   *  fpsCap: 0 (original) | 30 | 24 · keepAudio: bool
   *  onProgress(p 0..1, stage)  · refine: allow one refinement pass (target mode)
   */
  async function compressVideo(file, opts, onProgress) {
    const {
      ALL_FORMATS, BlobSource, BufferTarget, CanvasSource,
      EncodedAudioPacketSource, EncodedPacketSink, Input,
      Mp4OutputFormat, WebMOutputFormat, Output, VideoSampleSink,
    } = await mb();

    const info = await analyzeVideo(file);
    onProgress?.(0.02, 'analyzing');

    // ── resolve codec + container ──
    let codec = opts.codec === 'auto' ? 'avc' : opts.codec;
    if (opts.codec === 'auto' && !codecSupport.avc && codecSupport.vp9) codec = 'vp9';
    if (codecSupport[codec] === false) throw new Error(`${CODEC_LABEL[codec]} is not supported by this browser.`);
    let container = opts.format === 'auto' ? CODEC_FORMAT[codec] : opts.format;
    if (container === 'mp4' && codec === 'vp9') codec = 'avc';        // vp9 → webm
    if (container === 'webm' && codec !== 'vp9') { codec = 'vp9'; container = 'webm'; }
    if (codecSupport[codec] === false) throw new Error(`${CODEC_LABEL[codec]} is not supported by this browser.`);

    // ── target bitrate (bps) ──
    let targetBytes = 0;
    const computeBitrate = () => {
      if (opts.mode === 'bitrate') return Math.max(50000, opts.bitrateKbps * 1000);
      if (opts.mode === 'target') {
        targetBytes = (file.size * opts.targetPct) / 100;
        const totalBps = (targetBytes * 8) / Math.max(0.5, info.duration);
        const audioBps = (opts.keepAudio && info.hasAudio) ? Math.min(info.audioBitrate || 96000, 128000) : 0;
        return Math.max(40000, totalBps - audioBps);
      }
      // quality mode
      const est = info.srcVBitrate > 0
        ? info.srcVBitrate * QUALITY_FACTOR[opts.quality - 1]
        : info.width * info.height * info.frameRate * QUALITY_FACTOR[opts.quality - 1] * 0.07;
      return Math.max(50000, Math.min(est, 40000000));
    };

    const runOnce = async (bitrate) => {
      const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
      try {
        const videoTrack = await input.getPrimaryVideoTrack();
        // ── output size ──
        let tw = info.width, th = info.height;
        if (opts.maxH > 0) {
          const long = Math.max(tw, th);
          if (long > opts.maxH) {
            const k = opts.maxH / long;
            tw = Math.max(2, Math.round((tw * k) / 2) * 2);
            th = Math.max(2, Math.round((th * k) / 2) * 2);
          }
        }
        const canvas = Object.assign(document.createElement('canvas'), { width: tw, height: th });
        const ctx = canvas.getContext('2d', { willReadFrequently: false });

        const target = new BufferTarget();
        const fmt = container === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat();
        const output = new Output({ format: fmt, target });
        const videoSource = new CanvasSource(canvas, {
          codec,
          bitrate: Math.round(bitrate),
          keyFrameInterval: 2,
          sizeChangeBehavior: 'passThrough',
        });
        output.addVideoTrack(videoSource, { frameRate: info.frameRate });

        let audioSource = null, audioTrack = null, audioDecoderConfig = null;
        if (opts.keepAudio) {
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
          } catch { audioSource = null; }
        }

        await output.start();

        const stride = (opts.fpsCap > 0 && info.frameRate > opts.fpsCap + 2)
          ? Math.max(2, Math.round(info.frameRate / opts.fpsCap)) : 1;
        const fallbackDur = 1 / (info.frameRate || 30);
        const sink = new VideoSampleSink(videoTrack);
        let firstTimestamp = null, lastTimestamp = -1, idx = 0, added = 0;
        for await (const sample of sink.samples()) {
          if (firstTimestamp === null) firstTimestamp = sample.timestamp;
          let timestamp = sample.timestamp - firstTimestamp;
          if (!(timestamp >= 0)) timestamp = 0;
          if (timestamp <= lastTimestamp) timestamp = lastTimestamp + fallbackDur;
          const dur = Number.isFinite(sample.duration) && sample.duration > 0 ? sample.duration : fallbackDur;
          lastTimestamp = timestamp;

          if (idx % stride === 0) {
            sample.draw(ctx, 0, 0, tw, th);
            await videoSource.add(timestamp, dur);
            added++;
          }
          sample.close();
          idx++;
          if (info.duration) onProgress?.(Math.min(0.97, timestamp / info.duration), 'encoding');
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
            console.warn('MediaMaid: audio passthrough failed.', e);
          } finally {
            audioSource.close();
          }
        }

        await output.finalize();
        const buffer = target.buffer;
        return buffer ? new Blob([buffer], { type: container === 'webm' ? 'video/webm' : 'video/mp4' }) : null;
      } finally {
        input.dispose?.();
      }
    };

    let outBlob = await runOnce(computeBitrate());
    if (!outBlob) throw new Error('Encoding produced no output.');

    // ── one refinement pass for target mode (freeconvert-style accuracy) ──
    if (opts.mode === 'target' && opts.refine !== false) {
      const off = Math.abs(outBlob.size - targetBytes) / targetBytes;
      if (off > 0.12 && outBlob.size > 0) {
        const cur = computeBitrate();
        const scaled = Math.max(40000, Math.min(40000000, cur * (targetBytes / outBlob.size)));
        if (Math.abs(scaled - cur) / cur > 0.05) {
          const retry = await runOnce(scaled);
          if (retry && Math.abs(retry.size - targetBytes) < Math.abs(outBlob.size - targetBytes)) {
            outBlob = retry;
          }
        }
      }
    }
    onProgress?.(1, 'done');
    return { blob: outBlob, info, codec, container };
  }

  // ── image compression ─────────────────────────────────────────────────────
  function encodeCanvas(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => {
        if (!b) return reject(new Error('Encoding failed.'));
        // browser silently falls back to png for unsupported types
        if (mime !== 'image/png' && b.type !== mime) return resolve(null);
        resolve(b);
      }, mime, quality);
    });
  }
  async function decodeImage(file) {
    const bmp = await createImageBitmap(file);
    return bmp;
  }
  /**
   * opts: mode 'quality'|'target'
   *  quality: 1..10 · targetKB: number
   *  format: 'auto'|'jpeg'|'webp'  · maxDim: 0 | 3840 | 1920 | 1280 | 720
   */
  async function compressImage(file, opts, onProgress) {
    onProgress?.(0.1, 'decoding');
    const bmp = await decodeImage(file);
    let w = bmp.width, h = bmp.height;
    if (opts.maxDim > 0) {
      const long = Math.max(w, h);
      if (long > opts.maxDim) {
        const k = opts.maxDim / long;
        w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
      }
    }
    const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    onProgress?.(0.35, 'encoding');

    const isPng = file.type === 'image/png';
    let mime;
    if (opts.format === 'jpeg') mime = 'image/jpeg';
    else if (opts.format === 'webp') mime = 'image/webp';
    else mime = (file.type === 'image/webp') ? 'image/webp' : 'image/jpeg'; // auto

    if (mime === 'image/jpeg') { // opaque white underlay for transparent sources
      const flat = Object.assign(document.createElement('canvas'), { width: w, height: h });
      const fctx = flat.getContext('2d');
      fctx.fillStyle = '#ffffff';
      fctx.fillRect(0, 0, w, h);
      fctx.drawImage(canvas, 0, 0);
      canvas.width = w; // keep original untouched
      var work = flat;
    } else var work = canvas;

    let quality = opts.mode === 'quality' ? 0.30 + (opts.quality - 1) * (0.68 / 9) : 0.82;
    let out = await encodeCanvas(work, mime, quality);
    if (out === null) { // webp unsupported → jpeg fallback
      mime = 'image/jpeg';
      const flat = Object.assign(document.createElement('canvas'), { width: w, height: h });
      const fctx = flat.getContext('2d');
      fctx.fillStyle = '#ffffff'; fctx.fillRect(0, 0, w, h); fctx.drawImage(work, 0, 0);
      work = flat;
      out = await encodeCanvas(work, mime, quality);
    }

    // target-KB mode: binary search on quality (0.30…0.95)
    if (opts.mode === 'target' && opts.targetKB > 0) {
      const targetBytes = opts.targetKB * 1024;
      if (out && Math.abs(out.size - targetBytes) / targetBytes > 0.07) {
        let lo = 0.28, hi = 0.96, best = out, bestOff = Math.abs(out.size - targetBytes);
        for (let i = 0; i < 7; i++) {
          const q = (lo + hi) / 2;
          const b = await encodeCanvas(work, mime, q);
          if (!b) break;
          const off = Math.abs(b.size - targetBytes);
          if (off < bestOff) { best = b; bestOff = off; }
          if (b.size > targetBytes) hi = q; else lo = q;
          onProgress?.(0.35 + 0.08 * i, 'refining');
        }
        out = best;
      }
    }
    onProgress?.(1, 'done');
    return { blob: out, width: w, height: h, mime };
  }

  return {
    fmtBytes, fmtDur, esc, buildZip, mb, probeCodecs, codecSupport,
    CODEC_LABEL, analyzeVideo, compressVideo, compressImage, $,
  };
})();

window.MediaMaid = MM;

/* ─────────────────────────────────────────────────────────────────────────────
   UI wiring — tabs, queues, settings, downloads (v3)
   ────────────────────────────────────────────────────────────────────────── */

(() => {
  if (!window.MediaMaid) return;
  const { $, fmtBytes, fmtDur, esc } = window.MediaMaid;

  const state = {
    vQueue: [],   // {file, status, prog, stage, info, out, err}
    iQueue: [],
    vRunning: false,
    iRunning: false,
  };

  // ── tab plumbing (coexists with main.js's two tabs) ──────────────────────
  function deactivateOthers() {
    for (const id of ['tab-image', 'tab-video']) $(id)?.classList.remove('active');
    for (const id of ['panel-image', 'panel-video']) $(id)?.classList.add('hidden');
  }
  function hideMine() {
    for (const id of ['tab-compress-video', 'tab-compress-image']) $(id)?.classList.remove('active');
    for (const id of ['panel-compress-video', 'panel-compress-image']) $(id)?.classList.add('hidden');
  }
  function openTab(which) { // 'video' | 'image' (compressor ones)
    deactivateOthers();
    hideMine();
    $(which === 'video' ? 'tab-compress-video' : 'tab-compress-image')?.classList.add('active');
    $(which === 'video' ? 'panel-compress-video' : 'panel-compress-image')?.classList.remove('hidden');
  }

  function wireTabs() {
    $('tab-compress-video')?.addEventListener('click', () => { openTab('video'); history.replaceState(null, '', '#compress-video'); });
    $('tab-compress-image')?.addEventListener('click', () => { openTab('image'); history.replaceState(null, '', '#compress-image'); });
    // hide my panels when the original tabs open
    for (const id of ['tab-image', 'tab-video']) {
      $(id)?.addEventListener('click', hideMine);
    }
    document.querySelectorAll('a[href="#panel-video"], a[href="#panel-image"], a[href="#video"], a[href="#image"]')
      .forEach((a) => a.addEventListener('click', hideMine));
    const h = location.hash;
    if (h === '#compress-video') openTab('video');
    else if (h === '#compress-image') openTab('image');
  }

  // ── dropzones ────────────────────────────────────────────────────────────
  function wireDropzone(zoneId, inputId, kind) {
    const zone = $(zoneId), input = $(inputId);
    if (!zone || !input) return;
    zone.addEventListener('click', (e) => {
      if (e.target === input) return;
      input.click();
    });
    input.addEventListener('change', () => {
      if (input.files?.length) addFiles(kind, [...input.files]);
      input.value = '';
    });
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('dragover'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
      if (e.dataTransfer?.files?.length) addFiles(kind, [...e.dataTransfer.files]);
    });
  }

  // ── queue rendering ──────────────────────────────────────────────────────
  const QUALITY_NAMES = ['Best', 'High', 'Balanced', 'Small', 'Smallest'];
  function cardHtml(item, i, kind) {
    const pct = item.status === 'done' && item.out && item.file.size
      ? Math.round((1 - item.out.size / item.file.size) * 100) : null;
    const badge = pct !== null
      ? `<span class="mm-badge ${pct >= 0 ? 'mm-good' : 'mm-bad'}">${pct >= 0 ? '−' : '+'}${Math.abs(pct)}%</span>` : '';
    let meta = esc(item.file.name) + ' · ' + fmtBytes(item.file.size);
    if (item.info) meta += ` · ${item.info.width}×${item.info.height} · ${fmtDur(item.info.duration)}`;
    if (item.out) meta += ` → <b>${fmtBytes(item.out.size)}</b>`;
    const status =
      item.status === 'queued' ? 'Waiting…' :
      item.status === 'working' ? `${item.stage === 'refining' ? 'Refining' : 'Compressing'} ${Math.round(item.prog * 100)}%` :
      item.status === 'done' ? 'Done' :
      item.status === 'error' ? 'Failed' : '';
    const bar = item.status === 'done' ? 100 : Math.round((item.prog || 0) * 100);
    return `<div class="mm-file ${item.status === 'error' ? 'mm-err' : ''}" data-i="${i}" data-kind="${kind}">
      <div class="mm-row1"><span class="mm-name" title="${esc(item.file.name)}">${meta}</span>${badge}</div>
      <div class="mm-bar"><div class="mm-bar-fill" style="width:${bar}%"></div></div>
      <div class="mm-row2"><span class="mm-status">${esc(status)}${item.err ? ' — ' + esc(item.err) : ''}</span>
        <span class="mm-actions">
          ${item.status === 'done' && item.out ? `<button class="mm-dl" data-dl="${i}" data-kind="${kind}">Download</button>` : ''}
          ${item.status !== 'working' ? `<button class="mm-rm" data-rm="${i}" data-kind="${kind}" title="Remove">✕</button>` : ''}
        </span></div>
    </div>`;
  }

  function renderQueue(kind) {
    const list = kind === 'video' ? state.vQueue : state.iQueue;
    const box = $(kind === 'video' ? 'mmv-queue' : 'mmi-queue');
    if (!box) return;
    if (!list.length) { box.innerHTML = ''; updateSummary(kind); return; }
    box.innerHTML = list.map((it, i) => cardHtml(it, i, kind)).join('');
    updateSummary(kind);
  }

  function updateSummary(kind) {
    const list = kind === 'video' ? state.vQueue : state.iQueue;
    const el = $(kind === 'video' ? 'mmv-summary' : 'mmi-summary');
    if (!el) return;
    const done = list.filter((x) => x.status === 'done' && x.out);
    const inB = list.reduce((a, x) => a + x.file.size, 0);
    const outB = done.reduce((a, x) => a + x.out.size, 0);
    const doneIn = done.reduce((a, x) => a + x.file.size, 0);
    el.innerHTML = list.length
      ? `${list.length} file${list.length > 1 ? 's' : ''} · ${fmtBytes(inB)}${done.length ? ` → <b>${fmtBytes(outB)}</b> (${done.length} done${doneIn ? `, −${Math.max(0, Math.round((1 - outB / doneIn) * 100))}%` : ''})` : ''}`
      : '';
    const zipBtn = $(kind === 'video' ? 'mmv-zip' : 'mmi-zip');
    if (zipBtn) zipBtn.disabled = done.length < 1;
    const goBtn = $(kind === 'video' ? 'mmv-go' : 'mmi-go');
    if (goBtn) {
      const running = kind === 'video' ? state.vRunning : state.iRunning;
      goBtn.disabled = running || !list.some((x) => x.status === 'queued' || x.status === 'error');
      goBtn.textContent = running ? 'Compressing…' : 'Compress Now';
    }
  }

  function addFiles(kind, files) {
    const list = kind === 'video' ? state.vQueue : state.iQueue;
    const accept = kind === 'video' ? /^video\// : /^image\//;
    for (const f of files) {
      if (!accept.test(f.type) && !/\.(mp4|webm|mov|m4v|mkv|avi|png|jpe?g|webp|gif|bmp)$/i.test(f.name)) continue;
      list.push({ file: f, status: 'queued', prog: 0, stage: '', out: null, err: '' });
    }
    renderQueue(kind);
    if (kind === 'video') targetHint();
  }

  // ── settings readers ─────────────────────────────────────────────────────
  function videoOpts() {
    const mode = document.querySelector('input[name="mmv-method"]:checked')?.value || 'quality';
    return {
      mode,
      quality: parseInt($('mmv-quality')?.value || '3', 10),
      targetPct: Math.min(99, Math.max(1, parseFloat($('mmv-target')?.value || '50'))),
      bitrateKbps: Math.max(30, parseInt($('mmv-bitrate')?.value || '1500', 10)),
      codec: $('mmv-codec')?.value || 'auto',
      format: $('mmv-format')?.value || 'auto',
      maxH: parseInt($('mmv-res')?.value || '0', 10),
      fpsCap: parseInt($('mmv-fps')?.value || '0', 10),
      keepAudio: !$('mmv-mute')?.checked,
    };
  }
  function imageOpts() {
    const mode = document.querySelector('input[name="mmi-method"]:checked')?.value || 'quality';
    return {
      mode,
      quality: parseInt($('mmi-quality')?.value || '7', 10),
      targetKB: Math.max(5, parseInt($('mmi-targetkb')?.value || '200', 10)),
      format: $('mmi-format')?.value || 'auto',
      maxDim: parseInt($('mmi-maxdim')?.value || '0', 10),
    };
  }

  // ── runners ──────────────────────────────────────────────────────────────
  async function runQueue(kind) {
    const runningKey = kind === 'video' ? 'vRunning' : 'iRunning';
    if (state[runningKey]) return;
    state[runningKey] = true;
    updateSummary(kind);
    const list = kind === 'video' ? state.vQueue : state.iQueue;
    try {
      for (let i = 0; i < list.length; i++) {
        const item = list[i];
        if (item.status !== 'queued' && item.status !== 'error') continue;
        item.status = 'working'; item.prog = 0; item.stage = ''; item.err = '';
        renderQueue(kind);
        try {
          const onProg = (p, stage) => {
            item.prog = Math.max(item.prog, p); item.stage = stage || item.stage;
            const card = document.querySelector(`.mm-file[data-i="${i}"][data-kind="${kind}"]`);
            if (card) {
              card.querySelector('.mm-bar-fill').style.width = Math.round(item.prog * 100) + '%';
              card.querySelector('.mm-status').textContent =
                `${item.stage === 'refining' ? 'Refining' : 'Compressing'} ${Math.round(item.prog * 100)}%`;
            }
          };
          if (kind === 'video') {
            const r = await window.MediaMaid.compressVideo(item.file, videoOpts(), onProg);
            item.out = r.blob; item.info = r.info;
          } else {
            const r = await window.MediaMaid.compressImage(item.file, imageOpts(), onProg);
            item.out = r.blob;
          }
          item.status = 'done';
        } catch (e) {
          item.status = 'error';
          item.err = (e && e.message) ? e.message : String(e);
        }
        renderQueue(kind);
        await new Promise((r) => setTimeout(r, 30)); // let the UI breathe
      }
    } finally {
      state[runningKey] = false;
      updateSummary(kind);
    }
  }

  // ── downloads ────────────────────────────────────────────────────────────
  function outName(fileName, newExt) {
    const m = fileName.match(/^(.*?)(\.[^.]+)?$/);
    const base = (m[1] || 'file').slice(0, 80);
    return `${base}-mediamaid.${newExt || (m[2] || '').replace('.', '') || 'bin'}`;
  }
  function triggerDownload(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
  async function zipAll(kind) {
    const list = kind === 'video' ? state.vQueue : state.iQueue;
    const done = list.filter((x) => x.status === 'done' && x.out);
    if (!done.length) return;
    const btn = $(kind === 'video' ? 'mmv-zip' : 'mmi-zip');
    if (btn) { btn.disabled = true; btn.textContent = 'Zipping…'; }
    try {
      const files = [];
      const used = new Set();
      for (const x of done) {
        const ext = x.out.type.includes('webm') ? 'webm' : x.out.type.includes('mp4') ? 'mp4'
          : x.out.type.includes('webp') ? 'webp' : x.out.type.includes('png') ? 'png' : 'jpg';
        let name = outName(x.file.name, ext);
        let n = 2;
        while (used.has(name)) name = outName(x.file.name, ext).replace(/(\.[^.]+)$/, `-${n++}$1`);
        used.add(name);
        files.push({ name, data: new Uint8Array(await x.out.arrayBuffer()) });
      }
      triggerDownload(window.MediaMaid.buildZip(files), `mediamaid-${kind}-compressed.zip`);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Download all (.zip)'; }
    }
  }

  // ── events ───────────────────────────────────────────────────────────────
  let targetHint = () => {
    const el = $('mmv-target-hint');
    if (!el) return;
    const pct = parseFloat($('mmv-target')?.value || '50');
    const f = state.vQueue[0]?.file;
    el.textContent = f ? `≈ ${fmtBytes((f.size * pct) / 100)} for the first file` : '';
  };

  function wireEvents() {
    document.addEventListener('click', (e) => {
      const dl = e.target.closest('[data-dl]');
      if (dl) {
        const kind = dl.dataset.kind, i = parseInt(dl.dataset.dl, 10);
        const list = kind === 'video' ? state.vQueue : state.iQueue;
        const item = list[i];
        if (item?.out) {
          const ext = item.out.type.includes('webm') ? 'webm' : item.out.type.includes('mp4') ? 'mp4'
            : item.out.type.includes('webp') ? 'webp' : item.out.type.includes('png') ? 'png' : 'jpg';
          triggerDownload(item.out, outName(item.file.name, ext));
        }
        return;
      }
      const rm = e.target.closest('[data-rm]');
      if (rm) {
        const kind = rm.dataset.kind, i = parseInt(rm.dataset.rm, 10);
        const list = kind === 'video' ? state.vQueue : state.iQueue;
        if (list[i] && list[i].status !== 'working') { list.splice(i, 1); renderQueue(kind); }
      }
    });
    $('mmv-go')?.addEventListener('click', () => runQueue('video'));
    $('mmi-go')?.addEventListener('click', () => runQueue('image'));
    $('mmv-zip')?.addEventListener('click', () => zipAll('video'));
    $('mmi-zip')?.addEventListener('click', () => zipAll('image'));
    $('mmv-clear')?.addEventListener('click', () => { if (!state.vRunning) { state.vQueue = []; renderQueue('video'); targetHint(); } });
    $('mmi-clear')?.addEventListener('click', () => { if (!state.iRunning) { state.iQueue = []; renderQueue('image'); } });

    // method radios → show the right sub-control
    const syncMethod = (k) => {
      const sel = document.querySelector(`input[name="mm${k}-method"]:checked`)?.value || 'quality';
      document.querySelectorAll(`[data-mmshow="${k}"]`).forEach((el) => {
        el.classList.toggle('hidden', el.dataset.mmmethod !== sel);
      });
    };
    document.querySelectorAll('input[name="mmv-method"]').forEach((r) => r.addEventListener('change', () => { syncMethod('v'); targetHint(); }));
    document.querySelectorAll('input[name="mmi-method"]').forEach((r) => r.addEventListener('change', () => syncMethod('i')));
    syncMethod('v'); syncMethod('i');

    // quality slider labels
    const qs = $('mmv-quality');
    qs?.addEventListener('input', () => { const l = $('mmv-quality-label'); if (l) l.textContent = QUALITY_NAMES[qs.value - 1] || ''; });
    const is2 = $('mmi-quality');
    is2?.addEventListener('input', () => { const l = $('mmi-quality-label'); if (l) l.textContent = is2.value; });

    $('mmv-target')?.addEventListener('input', targetHint);

    // codec availability
    const codecSel = $('mmv-codec');
    if (codecSel) {
      window.MediaMaid.probeCodecs().then((sup) => {
        codecSel.querySelectorAll('option[data-codec]').forEach((o) => {
          const c = o.dataset.codec;
          if (sup[c] === false) { o.disabled = true; o.textContent += ' (unsupported)'; }
        });
        const note = $('mmv-codec-note');
        if (note && !sup.avc && !sup.vp9) note.textContent = 'This browser cannot encode video locally — try Chrome or Edge desktop.';
        else if (note && !sup.avc) note.textContent = 'H.264 unavailable here — outputs will use VP9/WebM.';
      }).catch(() => { });
    }
  }

  // ── init ─────────────────────────────────────────────────────────────────
  function init() {
    wireTabs();
    wireDropzone('mmv-dropzone', 'mmv-input', 'video');
    wireDropzone('mmi-dropzone', 'mmi-input', 'image');
    wireEvents();
    updateSummary('video'); updateSummary('image');
    window.MediaMaidInitDone = true;  // watchdog: proves init ran to completion
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
