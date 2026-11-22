/* ─────────────────────────────────────────────────────────────────────────────
   MediaMaid v4 — video engines. All client-side via mediabunny (WebCodecs).
   trim / mute / loop / merge = packet-copy (fast, original quality)
   crop / rotate / resize / speed = re-encode through a canvas transform
   extract-audio = audio-track remux to M4A
   ────────────────────────────────────────────────────────────────────────── */
'use strict';

(() => {
  const MMT = window.MMT;

  // ── packet-copy remux core (trim / mute / loop / merge) ───────────────────
  async function remux({ files, t0 = 0, t1 = Infinity, loops = 1, keepVideo = true, keepAudio = true, onProgress }) {
    const { Input, BlobSource, Output, Mp4OutputFormat, BufferTarget,
            EncodedVideoPacketSource, EncodedAudioPacketSource, EncodedPacketSink } = await MMT.mb();

    const probes = [];
    for (const f of files) {
      const p = await MMT.probeVideo(f);
      if (!p.v && !p.a) throw new Error(f.name + ': no video/audio track found');
      probes.push(p);
    }
    const first = probes[0];
    if (first.v && keepVideo && !first.v.codec) throw new Error('Unsupported video codec for direct copy.');
    if (first.a && keepAudio && !first.a.codec) throw new Error('Unsupported audio codec for direct copy.');

    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
    let vSource = null, aSource = null;
    if (first.v && keepVideo) { vSource = new EncodedVideoPacketSource(first.v.codec); output.addVideoTrack(vSource); }
    if (first.a && keepAudio) { aSource = new EncodedAudioPacketSource(first.a.codec); output.addAudioTrack(aSource); }
    await output.start();

    const totalSingle = probes.reduce((s, p) => s + (p.duration || 0), 0);
    const totalOut = Math.min(t1, t0 + totalSingle * loops) - t0;
    let done = 0, firstV = true, firstA = true;

    const copyRange = async (track, source, isFirst, isVideo, offset) => {
      const cfg = await track.getDecoderConfig().catch(() => null);
      const sink = new EncodedPacketSink(track);
      // start at the key packet at/before t0 when video (packet-copy safety)
      let startPacket = null;
      if (isVideo) {
        try { startPacket = await sink.getKeyPacket(t0); } catch { startPacket = null; }
      }
      let lastTs = -1, first = isFirst;
      const iter = startPacket ? sink.packets(startPacket) : sink.packets();
      for await (const packet of iter) {
        const srcTs = packet.timestamp - offset;
        if (srcTs < t0 - (isVideo ? 0.05 : 0)) continue;
        if (srcTs > t1) break;
        let newTs = srcTs - t0;
        if (newTs < 0) newTs = 0;
        if (newTs <= lastTs) newTs = lastTs + 0.001;
        lastTs = newTs;
        const out = packet.clone({ timestamp: newTs });
        const opt = first && cfg ? { decoderConfig: cfg } : undefined;
        if (isVideo) await source.add(out, opt); else await source.add(out, opt);
        first = false;
        done += 1;
        if (onProgress && (done & 31) === 0 && totalOut > 0) {
          const p = Math.min(0.95, (lastTs + t0) / totalOut);
          onProgress(p);
        }
      }
    };

    for (let li = 0; li < loops; li++) {
      let prefix = 0;
      for (const probe of probes) {
        const offset = li * totalSingle + prefix;
        prefix += probe.duration || 0;
        if (vSource && probe.v) await copyRange(probe.v.track, vSource, firstV, true, offset);
        firstV = false;
        if (aSource && probe.a) await copyRange(probe.a.track, aSource, firstA, false, offset);
        firstA = false;
        if (onProgress) onProgress(Math.min(0.95, ((li + 1) * prefix) / (totalSingle * loops) || 0.9));
      }
    }

    output.close();
    const { buffer } = await output.completion.caught();
    if (onProgress) onProgress(1);
    return new Blob([buffer], { type: 'video/mp4' });
  }

  // ── transform core (crop / rotate / resize / speed) — canvas re-encode ────
  async function transformVideo(file, opts, onProgress) {
    const {
      crop = null,        // {x,y,w,h} in source pixels
      rotate = 0,         // 0 | 90 | 180 | 270
      maxW = 0, maxH = 0, // downscale cap (after crop+rotate)
      speed = 1,          // 0.5x … 2x
      fpsCap = 0, keepAudio = true, mimeType = 'video/mp4', bitrateFactor = 0.9,
    } = opts;

    const { Input, BlobSource, Output, BufferTarget, WebMOutputFormat, Mp4OutputFormat,
            VideoSampleSource, AudioBufferSource, VideoSampleSink, VideoSample,
            EncodedAudioPacketSource, EncodedPacketSink, AudioBufferSink } = await MMT.mb();
    const info = await MMT.probeVideo(file);
    if (!info.v) throw new Error('No video track found.');

    const rot = (info.v.rotation + rotate) % 360;
    const srcW = info.v.w, srcH = info.v.h;
    let cw = srcW, ch = srcH, sx = 0, sy = 0;
    if (crop) { sx = Math.round(crop.x); sy = Math.round(crop.y); cw = Math.round(crop.w); ch = Math.round(crop.h); }
    let ow = cw, oh = ch;
    if (rot === 90 || rot === 270) { [ow, oh] = [oh, ow]; }
    if (maxW > 0 && ow > maxW) { oh = Math.round(oh * (maxW / ow)); ow = maxW; }
    if (maxH > 0 && oh > maxH) { ow = Math.round(ow * (maxH / oh)); oh = maxH; }
    ow -= ow % 2; oh -= oh % 2;

    const work = document.createElement('canvas');
    work.width = cw; work.height = ch;
    const wctx = work.getContext('2d', { alpha: false });
    const out = document.createElement('canvas');
    out.width = ow; out.height = oh;
    const octx = out.getContext('2d', { alpha: false });

    const container = mimeType === 'video/webm' ? new WebMOutputFormat() : new Mp4OutputFormat({ fastStart: 'in-memory' });
    const output = new Output({ format: container, target: new BufferTarget() });
    const vSource = new VideoSampleSource({ bitrate: Math.max(300_000, Math.round(info.v.bitrate * bitrateFactor) || 2_500_000) });
    output.addVideoTrack(vSource, { frameRate: fpsCap > 0 ? fpsCap : undefined });

    let aSource = null, audioBuffer = null, audioCfg = null;
    if (keepAudio && info.a) {
      if (speed === 1) {
        audioCfg = await info.a.track.getDecoderConfig().catch(() => null);
        if (audioCfg) { aSource = new EncodedAudioPacketSource(info.a.codec); output.addAudioTrack(aSource); }
      }
      if (!aSource) {
        // speed≠1 (or packet copy unavailable): decode + stretch audio
        const sink = new AudioBufferSink(info.a.track);
        audioBuffer = new AudioBufferSource();
        output.addAudioTrack(audioBuffer);
        (async () => {
          for await (const { buffer, timestamp } of sink.buffers()) {
            const outBuf = speed === 1 ? buffer : await stretchBuffer(buffer, speed);
            if (outBuf) await audioBuffer.add(outBuf);
          }
          audioBuffer.close();
        })().catch(() => { try { audioBuffer.close(); } catch { } });
      }
    }

    await output.start();

    const stride = (fpsCap > 0 && info.v.fps > fpsCap + 2) ? Math.max(2, Math.round(info.v.fps / fpsCap)) : 1;
    const sink = new VideoSampleSink(info.v.track);
    let firstTs = null, lastTs = -1, idx = 0, lastReported = -1;
    for await (const sample of sink.samples()) {
      if (firstTs === null) firstTs = sample.timestamp;
      let timestamp = (sample.timestamp - firstTs) / speed;
      if (idx % stride === 0) {
        wctx.drawImage(sample.toCanvasImageSource(), 0, 0, cw, ch);
        const d = sample.duration ? sample.duration / speed : (1 / info.v.fps) / speed;
        octx.save();
        octx.translate(ow / 2, oh / 2);
        octx.rotate(rot * Math.PI / 180);
        const sc = (rot === 90 || rot === 270) ? oh / cw : ow / cw;
        octx.scale(sc, sc);
        octx.drawImage(work, -cw / 2, -ch / 2);
        octx.restore();
        if (lastTs >= 0 && timestamp <= lastTs) timestamp = lastTs + 0.001;
        lastTs = timestamp;
        await vSource.add(new VideoSample(out, { timestamp, duration: d }));
      }
      idx += 1;
      sample.close();
      const prog = (sample.timestamp / (info.duration || 1));
      if (onProgress && Math.floor(prog * 100) !== lastReported) { lastReported = Math.floor(prog * 100); onProgress(prog * 0.94); }
    }

    if (aSource && audioCfg) {
      try {
        const sinkA = new EncodedPacketSink(info.a.track);
        let first = true, lastTsA = -1;
        for await (const packet of sinkA.packets()) {
          let ts = (packet.timestamp - firstTs) / speed;
          if (ts < 0) continue;
          if (ts <= lastTsA) ts = lastTsA + 0.001;
          lastTsA = ts;
          await aSource.add(packet.clone({ timestamp: ts }), first ? { decoderConfig: audioCfg } : undefined);
          first = false;
        }
      } catch (e) { console.warn('audio copy failed', e); }
    }

    vSource.close();
    output.close();
    const { buffer } = await output.completion.caught();
    if (onProgress) onProgress(1);
    return { blob: new Blob([buffer], { type: mimeType }), width: ow, height: oh };
  }

  async function stretchBuffer(buffer, speed) {
    // naive resample by linear interpolation of channels (pitch shifts, fine for mute/speed tooling)
    const n = Math.max(1, Math.round(buffer.length / speed));
    const AC = window.OfflineAudioContext;
    const out = new AC(buffer.numberOfChannels, n, buffer.sampleRate);
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const src = buffer.getChannelData(c), dst = out.getChannelData(c);
      for (let i = 0; i < n; i++) {
        const t = i * speed, i0 = Math.floor(t), fr = t - i0;
        const a = src[Math.min(i0, src.length - 1)], b = src[Math.min(i0 + 1, src.length - 1)];
        dst[i] = a + (b - a) * fr;
      }
    }
    return out.startRendering();
  }

  // ── extract audio to M4A (packet copy) ────────────────────────────────────
  async function extractAudio(file, onProgress) {
    const { Input, BlobSource, Output, BufferTarget, Mp4OutputFormat, EncodedAudioPacketSource, EncodedPacketSink } = await MMT.mb();
    const info = await MMT.probeVideo(file);
    if (!info.a) throw new Error('This file has no audio track.');
    const cfg = await info.a.track.getDecoderConfig().catch(() => null);
    if (!cfg) throw new Error('Audio codec not supported for direct copy: ' + info.a.codec);
    const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });
    const src = new EncodedAudioPacketSource(info.a.codec);
    output.addAudioTrack(src);
    await output.start();
    const sink = new EncodedPacketSink(info.a.track);
    let first = true, n = 0;
    for await (const packet of sink.packets()) {
      await src.add(packet, first ? { decoderConfig: cfg } : undefined);
      first = false; n += 1;
      if (onProgress && (n & 63) === 0 && info.duration) onProgress(Math.min(0.95, packet.timestamp / info.duration));
    }
    output.close();
    const { buffer } = await output.completion.caught();
    if (onProgress) onProgress(1);
    return new Blob([buffer], { type: 'audio/mp4' });
  }

  // ── screen recorder (getDisplayMedia → webm) ──────────────────────────────
  async function screenRecorder(opts, onTick) {
    const { withAudio = false, maxSeconds = 0 } = opts || {};
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 }, audio: withAudio,
    });
    const chunks = [];
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9'
      : MediaRecorder.isTypeSupported('video/webm;codecs=vp8') ? 'video/webm;codecs=vp8' : 'video/webm';
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((res) => { rec.onstop = res; });
    rec.start(1000);
    const t0 = Date.now();
    const timer = setInterval(() => { if (onTick) onTick((Date.now() - t0) / 1000); }, 500);
    let hardStop = null;
    if (maxSeconds > 0) hardStop = setTimeout(() => stop(), maxSeconds * 1000);
    function stop() {
      if (rec.state !== 'inactive') rec.stop();
      stream.getTracks().forEach((t) => t.stop());
      clearInterval(timer); if (hardStop) clearTimeout(hardStop);
    }
    stream.getVideoTracks()[0].addEventListener('ended', stop);
    return { stop, done: done.then(() => new Blob(chunks, { type: 'video/webm' })) };
  }

  // ── webcam / voice recorder shared helpers ────────────────────────────────
  async function micRecorder() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const rec = new MediaRecorder(stream, { mimeType: mime });
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise((res) => { rec.onstop = res; });
    return {
      rec,
      start: () => rec.start(500),
      stop: () => { rec.stop(); stream.getTracks().forEach((t) => t.stop()); return done.then(() => new Blob(chunks, { type: 'audio/webm' })); },
    };
  }

  MMT.videoEngines = { remux, transformVideo, extractAudio, screenRecorder, micRecorder, stretchBuffer };
})();
