/* ─────────────────────────────────────────────────────────────────────────────
   MediaMaid v4 — audio engines (WebAudio + lamejs + mediabunny AAC).
   trim (fades/gain) · converter (MP3/M4A/WAV) · joiner · voice recorder
   ────────────────────────────────────────────────────────────────────────── */
'use strict';

(() => {
  const MMT = window.MMT;

  // shared: decode → render(opts) → encode(format)
  async function processAudio(file, opts, onProgress) {
    const { t0 = 0, t1 = null, fadeIn = 0, fadeOut = 0, gain = 1, format = 'mp3', bitrate = 192 } = opts || {};
    const dec = await MMT.probeAudio(file);
    const buf = dec.buffer;
    const sr = buf.sampleRate;
    const startS = Math.max(0, t0), endS = (t1 == null || t1 > buf.duration) ? buf.duration : Math.max(startS + 0.05, t1);
    const n = Math.round((endS - startS) * sr);
    const AC = window.OfflineAudioContext;
    const out = new AC(buf.numberOfChannels, n, sr);
    for (let c = 0; c < buf.numberOfChannels; c++) out.getChannelData(c).set(buf.getChannelData(c).subarray(Math.round(startS * sr), Math.round(startS * sr) + n));
    const rendered = await out.startRendering();
    if (onProgress) onProgress(0.4);

    // fades + gain
    const fi = Math.min(n, Math.round(fadeIn * sr)), fo = Math.min(n - fi, Math.round(fadeOut * sr));
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      const d = rendered.getChannelData(c);
      for (let i = 0; i < fi; i++) d[i] *= i / fi;
      for (let i = 0; i < fo; i++) d[n - 1 - i] *= i / fo;
      if (gain !== 1) for (let i = 0; i < n; i++) d[i] = Math.max(-1, Math.min(1, d[i] * gain));
    }
    if (onProgress) onProgress(0.6);
    return { buffer: rendered, format, bitrate };
  }

  async function encodeToMp3(buffer, kbps, onProgress) {
    const lame = await MMT.lamejs();
    const enc = new lame.Mp3Encoder(buffer.numberOfChannels, buffer.sampleRate, kbps);
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
    const block = 1152, data = [];
    const l16 = new Int16Array(block), r16 = right ? new Int16Array(block) : null;
    for (let i = 0; i < buffer.length; i += block) {
      const end = Math.min(i + block, buffer.length), m = end - i;
      for (let j = 0; j < m; j++) {
        l16[j] = Math.max(-32768, Math.min(32767, Math.round(left[i + j] * 32767)));
        if (r16) r16[j] = Math.max(-32768, Math.min(32767, Math.round(right[i + j] * 32767)));
      }
      const chunk = right ? enc.encodeBuffer(l16.subarray(0, m), r16.subarray(0, m)) : enc.encodeBuffer(l16.subarray(0, m));
      if (chunk.length) data.push(new Uint8Array(chunk));
      if (onProgress && (i / block) % 64 === 0) onProgress(0.6 + 0.35 * (i / buffer.length));
    }
    const tail = enc.flush();
    if (tail.length) data.push(new Uint8Array(tail));
    return new Blob(data, { type: 'audio/mpeg' });
  }

  function encodeToWav(buffer) {
    const nCh = buffer.numberOfChannels, sr = buffer.sampleRate, n = buffer.length;
    const bytes = 44 + n * nCh * 2;
    const ab = new ArrayBuffer(bytes); const v = new DataView(ab);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); v.setUint32(4, bytes - 8, true); ws(8, 'WAVEfmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nCh, true);
    v.setUint32(24, sr, true); v.setUint32(28, sr * nCh * 2, true);
    v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true);
    ws(36, 'data'); v.setUint32(40, n * nCh * 2, true);
    let o = 44;
    const chans = []; for (let c = 0; c < nCh; c++) chans.push(buffer.getChannelData(c));
    for (let i = 0; i < n; i++) for (let c = 0; c < nCh; c++) {
      v.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(chans[c][i] * 32767))), true); o += 2;
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  async function encodeToM4a(buffer, kbps, onProgress) {
    const { Output, BufferTarget, Mp4OutputFormat, AudioBufferSource } = await MMT.mb();
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    const src = new AudioBufferSource();
    output.addAudioTrack(src);
    await output.start();
    await src.add(buffer);
    src.close();
    output.close();
    const { buffer: out } = await output.completion.caught();
    return new Blob([out], { type: 'audio/mp4' });
  }

  async function encodeAudio(buffer, format, kbps, onProgress) {
    if (format === 'mp3') return encodeToMp3(buffer, kbps || 192, onProgress);
    if (format === 'wav') return encodeToWav(buffer);
    if (format === 'm4a') return encodeToM4a(buffer, kbps, onProgress);
    throw new Error('Unsupported audio format: ' + format);
  }

  // ── joiner: sequential concat through WebAudio ────────────────────────────
  async function joinAudio(files, opts, onProgress) {
    const { format = 'mp3', bitrate = 192, gap = 0 } = opts || {};
    const first = await MMT.probeAudio(files[0]);
    const sr = first.sampleRate;
    const total = gap > 0 ? (files.length - 1) * gap : 0;
    let acc = 0;
    const lens = [];
    for (const f of files) { const d = await MMT.probeAudio(f); lens.push(d.buffer); acc += d.duration; }
    const AC = window.OfflineAudioContext;
    const nCh = Math.max(...lens.map(b => b.numberOfChannels));
    const out = new AC(nCh, Math.ceil((acc + total) * sr), sr);
    let cursor = 0;
    for (const b of lens) {
      for (let c = 0; c < nCh; c++) {
        const srcCh = b.getChannelData(Math.min(c, b.numberOfChannels - 1));
        out.getChannelData(c).set(srcCh, Math.round(cursor * sr));
      }
      cursor += b.duration + gap;
      if (onProgress) onProgress(0.5 * (cursor / (acc + total)));
    }
    const rendered = await out.startRendering();
    if (onProgress) onProgress(0.6);
    return { buffer: rendered, format, bitrate };
  }

  MMT.audioEngines = { processAudio, encodeAudio, joinAudio, encodeToMp3, encodeToWav, encodeToM4a };
})();
