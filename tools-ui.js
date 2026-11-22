/* ─────────────────────────────────────────────────────────────────────────────
   MediaMaid v4 — tool registry, grid, router (circle-reveal), generic runner.
   One registry entry per tool; the runner UI (dropzone → options → run →
   download) is generated from each entry's field spec. Legacy tools (watermark
   removal, compressors) route to their existing panels via the hidden tabs.
   ────────────────────────────────────────────────────────────────────────── */
'use strict';

(() => {
  const MMT = window.MMT;
  const V = MMT.videoEngines, A = MMT.audioEngines, D = MMT.docEngines;

  // ═══════════════════════════════════════════════════════════════════════
  // TOOL REGISTRY — 25 tools
  // ═══════════════════════════════════════════════════════════════════════
  const CATS = [
    { id: 'video', label: 'Video' },
    { id: 'audio', label: 'Audio' },
    { id: 'image', label: 'Image' },
    { id: 'pdf', label: 'PDF' },
    { id: 'record', label: 'Record' },
  ];

  const TOOLS = [
    // ── legacy (existing panels, full power) ────────────────────────────────
    { id: 'remove-watermark-image', name: 'Watermark Remover — Image', desc: 'Exact alpha un-blend for Gemini, Sora, Grok & any mark.', cat: 'image', icon: 'ph-eraser', legacy: 'image' },
    { id: 'remove-watermark-video', name: 'Watermark Remover — Video', desc: 'Frame-accurate removal for Veo, Sora, Kling, Hailuo…', cat: 'video', icon: 'ph-eraser', legacy: 'video' },
    { id: 'compress-video', name: 'Video Compressor', desc: 'Target size, quality or bitrate — batch, no limits.', cat: 'video', icon: 'ph-arrows-in', legacy: 'compress-video' },
    { id: 'compress-image', name: 'Image Compressor', desc: 'Hit an exact KB target. JPEG/WebP. Batch.', cat: 'image', icon: 'ph-arrows-in', legacy: 'compress-image' },

    // ── video ────────────────────────────────────────────────────────────────
    {
      id: 'trim-video', name: 'Trim Video', desc: 'Cut any segment. Keyframe-accurate, original quality.', cat: 'video', icon: 'ph-scissors',
      accept: '.mp4,.webm,.mov,.mkv,.m4v', kind: 'video', multi: false,
      fields: [
        { k: 't0', type: 'range', label: 'Start', min: 0, max: 'dur', step: 0.05, unit: 's', value: 0 },
        { k: 't1', type: 'range', label: 'End', min: 0, max: 'dur', step: 0.05, unit: 's', value: 'dur' },
      ],
      run: (files, o, p) => V.remux({ files, t0: o.t0, t1: o.t1, onProgress: p }),
      outName: (f) => `${MMT.baseName(f.name)}-trimmed.mp4`,
    },
    {
      id: 'mute-video', name: 'Mute Video', desc: 'Remove the audio track. Video stays original.', cat: 'video', icon: 'ph-speaker-slash',
      accept: '.mp4,.webm,.mov,.mkv,.m4v', kind: 'video', multi: true,
      fields: [],
      run: (files, o, p) => zipOrSingle(files, (f, pp) => V.remux({ files: [f], keepAudio: false }), p),
      outName: (f) => `${MMT.baseName(f.name)}-muted.mp4`,
    },
    {
      id: 'loop-video', name: 'Loop Video', desc: 'Repeat a video N times into one file.', cat: 'video', icon: 'ph-arrows-clockwise',
      accept: '.mp4,.webm,.mov,.mkv,.m4v', kind: 'video', multi: false,
      fields: [{ k: 'loops', type: 'number', label: 'Loops', min: 2, max: 20, step: 1, value: 2 }],
      run: (files, o, p) => V.remux({ files, loops: Math.max(2, o.loops | 0), onProgress: p }),
      outName: (f) => `${MMT.baseName(f.name)}-looped.mp4`,
    },
    {
      id: 'merge-videos', name: 'Merge Videos', desc: 'Concatenate clips end-to-end.', cat: 'video', icon: 'ph-stack',
      accept: '.mp4,.webm,.mov,.mkv,.m4v', kind: 'video', multi: true, minFiles: 2,
      fields: [{ k: 'orderNote', type: 'note', label: 'Clips are merged in the order shown below.' }],
      run: (files, o, p) => V.remux({ files, onProgress: p }),
      outName: (f) => 'merged.mp4',
    },
    {
      id: 'crop-video', name: 'Crop Video', desc: 'Keep a region of the frame.', cat: 'video', icon: 'ph-crop',
      accept: '.mp4,.webm,.mov,.mkv,.m4v', kind: 'video', multi: false,
      fields: [
        { k: 'x', type: 'number', label: 'X', min: 0, step: 1, value: 0, unit: 'px' },
        { k: 'y', type: 'number', label: 'Y', min: 0, step: 1, value: 0, unit: 'px' },
        { k: 'w', type: 'number', label: 'Width', min: 16, step: 1, value: 0, unit: 'px', ph: 'source width' },
        { k: 'h', type: 'number', label: 'Height', min: 16, step: 1, value: 0, unit: 'px', ph: 'source height' },
      ],
      run: (files, o, p) => {
        const info = o.__probe;
        const w = o.w > 0 ? o.w : info.v.w - o.x, h = o.h > 0 ? o.h : info.v.h - o.y;
        return V.transformVideo(files[0], { crop: { x: o.x, y: o.y, w, h } }, p);
      },
      outName: (f) => `${MMT.baseName(f.name)}-cropped.mp4`,
    },
    {
      id: 'rotate-video', name: 'Rotate Video', desc: 'Turn 90/180/270°, re-encode crisp.', cat: 'video', icon: 'ph-arrows-clockwise',
      accept: '.mp4,.webm,.mov,.mkv,.m4v', kind: 'video', multi: true,
      fields: [{ k: 'rotate', type: 'select', label: 'Angle', value: 90, options: [[90, '90° clockwise'], [180, '180°'], [270, '90° counter-clockwise']] }],
      run: (files, o, p) => zipOrSingle(files, (f, pp) => V.transformVideo(f, { rotate: o.rotate | 0 }, pp), p),
      outName: (f) => `${MMT.baseName(f.name)}-rotated.mp4`,
    },
    {
      id: 'resize-video', name: 'Resize Video', desc: 'Scale down to a max width (HD, 4K…).', cat: 'video', icon: 'ph-frame-corners',
      accept: '.mp4,.webm,.mov,.mkv,.m4v', kind: 'video', multi: true,
      fields: [{ k: 'maxW', type: 'select', label: 'Max width', value: 1280, options: [[1920, '1920px (Full HD)'], [1280, '1280px (HD)'], [854, '854px (SD)'], [640, '640px']] }],
      run: (files, o, p) => zipOrSingle(files, (f, pp) => V.transformVideo(f, { maxW: o.maxW | 0 }, pp), p),
      outName: (f, o) => `${MMT.baseName(f.name)}-${o.maxW}px.mp4`,
    },
    {
      id: 'speed-video', name: 'Change Speed', desc: '0.5× slow-mo to 2× fast.', cat: 'video', icon: 'ph-gauge',
      accept: '.mp4,.webm,.mov,.mkv,.m4v', kind: 'video', multi: false,
      fields: [{ k: 'speed', type: 'range', label: 'Speed', min: 0.5, max: 2, step: 0.05, value: 1, unit: '×' }],
      run: (files, o, p) => V.transformVideo(files[0], { speed: o.speed }, p),
      outName: (f, o) => `${MMT.baseName(f.name)}-${o.speed}x.mp4`,
    },
    {
      id: 'extract-audio', name: 'Extract Audio', desc: 'Pull the sound out of any video (M4A).', cat: 'audio', icon: 'ph-music-notes',
      accept: '.mp4,.webm,.mov,.mkv,.m4v', kind: 'video', multi: true,
      fields: [],
      run: (files, o, p) => zipOrSingle(files, (f, pp) => V.extractAudio(f, pp), p),
      outName: (f) => `${MMT.baseName(f.name)}.m4a`,
    },

    // ── audio ────────────────────────────────────────────────────────────────
    {
      id: 'trim-audio', name: 'Trim Audio', desc: 'Cut with fades and volume boost.', cat: 'audio', icon: 'ph-scissors',
      accept: '.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus', kind: 'audio', multi: false,
      fields: [
        { k: 't0', type: 'range', label: 'Start', min: 0, max: 'dur', step: 0.1, unit: 's', value: 0 },
        { k: 't1', type: 'range', label: 'End', min: 0, max: 'dur', step: 0.1, unit: 's', value: 'dur' },
        { k: 'fadeIn', type: 'number', label: 'Fade in', min: 0, max: 10, step: 0.1, value: 0, unit: 's' },
        { k: 'fadeOut', type: 'number', label: 'Fade out', min: 0, max: 10, step: 0.1, value: 0, unit: 's' },
        { k: 'gain', type: 'range', label: 'Volume', min: 0.5, max: 2, step: 0.05, value: 1, unit: '×' },
      ],
      run: (files, o, p) => A.processAudio(files[0], o, p).then((r) => A.encodeAudio(r.buffer, 'mp3', 192, p)),
      outName: (f) => `${MMT.baseName(f.name)}-trimmed.mp3`,
    },
    {
      id: 'convert-audio', name: 'Audio Converter', desc: 'MP3 · M4A · WAV, any input.', cat: 'audio', icon: 'ph-repeat',
      accept: '.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus,.webm', kind: 'audio', multi: true,
      fields: [
        { k: 'format', type: 'select', label: 'Format', value: 'mp3', options: [['mp3', 'MP3'], ['m4a', 'M4A (AAC)'], ['wav', 'WAV (lossless)']] },
        { k: 'bitrate', type: 'select', label: 'Bitrate', value: 192, options: [[128, '128 kbps'], [192, '192 kbps'], [256, '256 kbps'], [320, '320 kbps']] },
      ],
      run: (files, o, p) => zipOrSingle(files, async (f, pp) => {
        const r = await A.processAudio(f, { format: o.format, bitrate: o.bitrate }, pp);
        return A.encodeAudio(r.buffer, o.format, o.bitrate | 0, pp);
      }, p),
      outName: (f, o) => `${MMT.baseName(f.name)}.${EXT(o.format)}`,
    },
    {
      id: 'join-audio', name: 'Merge Audio', desc: 'Concatenate tracks with optional gap.', cat: 'audio', icon: 'ph-stack',
      accept: '.mp3,.m4a,.aac,.wav,.ogg,.flac,.opus', kind: 'audio', multi: true, minFiles: 2,
      fields: [
        { k: 'gap', type: 'number', label: 'Gap', min: 0, max: 10, step: 0.5, value: 0, unit: 's' },
        { k: 'format', type: 'select', label: 'Format', value: 'mp3', options: [['mp3', 'MP3'], ['m4a', 'M4A'], ['wav', 'WAV']] },
      ],
      run: (files, o, p) => A.joinAudio(files, o, p).then((r) => A.encodeAudio(r.buffer, o.format, 192, p)),
      outName: () => 'merged.mp3',
    },

    // ── image ────────────────────────────────────────────────────────────────
    {
      id: 'convert-image', name: 'Image Converter', desc: 'PNG ⇄ JPG ⇄ WebP, quality & resize.', cat: 'image', icon: 'ph-repeat',
      accept: '.png,.jpg,.jpeg,.webp,.bmp,.gif', kind: 'image', multi: true,
      fields: [
        { k: 'format', type: 'select', label: 'Format', value: 'jpeg', options: [['jpeg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP']] },
        { k: 'quality', type: 'range', label: 'Quality', min: 0.3, max: 1, step: 0.05, value: 0.9 },
        { k: 'maxDim', type: 'select', label: 'Max size', value: 0, options: [[0, 'Original'], [4096, '4096px'], [1920, '1920px'], [1280, '1280px'], [800, '800px'], [400, '400px']] },
      ],
      run: (files, o, p) => zipOrSingle(files, (f, pp) => D.convertImage(f, o, pp), p),
      outName: (f, o) => `${MMT.baseName(f.name)}.${EXT(o.format)}`,
    },
    {
      id: 'resize-image', name: 'Resize Image', desc: 'Scale to a max dimension.', cat: 'image', icon: 'ph-frame-corners',
      accept: '.png,.jpg,.jpeg,.webp,.bmp,.gif', kind: 'image', multi: true,
      fields: [
        { k: 'maxDim', type: 'select', label: 'Max dimension', value: 1280, options: [[3840, '3840px'], [1920, '1920px'], [1280, '1280px'], [800, '800px'], [400, '400px'], [100, '100px (thumbnail)']] },
        { k: 'format', type: 'select', label: 'Format', value: 'jpeg', options: [['jpeg', 'JPG'], ['png', 'PNG'], ['webp', 'WebP']] },
      ],
      run: (files, o, p) => zipOrSingle(files, (f, pp) => D.resizeImage(f, o, pp), p),
      outName: (f, o) => `${MMT.baseName(f.name)}-${o.maxDim}px.${EXT(o.format)}`,
    },

    // ── pdf ──────────────────────────────────────────────────────────────────
    {
      id: 'merge-pdf', name: 'Merge PDF', desc: 'Combine PDFs in order.', cat: 'pdf', icon: 'ph-stack-plus',
      accept: '.pdf', kind: 'pdf', multi: true, minFiles: 2,
      fields: [{ k: 'orderNote', type: 'note', label: 'Files merge in the order shown below.' }],
      run: (files, o, p) => D.mergePdfs(files, p),
      outName: () => 'merged.pdf',
    },
    {
      id: 'split-pdf', name: 'Split PDF', desc: 'One file per page (ZIP).', cat: 'pdf', icon: 'ph-split-horizontal',
      accept: '.pdf', kind: 'pdf', multi: false,
      fields: [],
      run: async (files, o, p) => {
        const parts = await D.splitPdf(files[0], p);
        return MMT.zipStore(parts);
      },
      outName: (f) => `${MMT.baseName(f.name)}-pages.zip`, zip: true,
    },
    {
      id: 'rotate-pdf', name: 'Rotate PDF', desc: 'Turn all or selected pages.', cat: 'pdf', icon: 'ph-arrows-clockwise',
      accept: '.pdf', kind: 'pdf', multi: false,
      fields: [
        { k: 'angle', type: 'select', label: 'Angle', value: 90, options: [[90, '90° clockwise'], [180, '180°'], [270, '90° counter-clockwise']] },
        { k: 'pages', type: 'text', label: 'Pages', ph: 'blank = all, e.g. 0,2,4' },
      ],
      run: (files, o, p) => {
        const pages = String(o.pages || '').split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
        return D.rotatePdf(files[0], o.angle | 0, pages, p);
      },
      outName: (f) => `${MMT.baseName(f.name)}-rotated.pdf`,
    },
    {
      id: 'number-pdf', name: 'Add Page Numbers', desc: 'Stamp 1,2,3… anywhere.', cat: 'pdf', icon: 'ph-list-numbers',
      accept: '.pdf', kind: 'pdf', multi: false,
      fields: [
        { k: 'position', type: 'select', label: 'Position', value: 'bottom-center', options: [['bottom-center', 'Bottom centre'], ['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'], ['top-right', 'Top right'], ['top-left', 'Top left']] },
        { k: 'start', type: 'number', label: 'Start at', min: 1, step: 1, value: 1 },
        { k: 'size', type: 'number', label: 'Font size', min: 8, max: 36, step: 1, value: 12 },
        { k: 'skipFirst', type: 'checkbox', label: 'Skip first page', value: false },
      ],
      run: (files, o, p) => D.numberPdf(files[0], o, p),
      outName: (f) => `${MMT.baseName(f.name)}-numbered.pdf`,
    },
    {
      id: 'images-to-pdf', name: 'Images to PDF', desc: 'JPG/PNG pages into one PDF.', cat: 'pdf', icon: 'ph-file-pdf',
      accept: '.png,.jpg,.jpeg', kind: 'image', multi: true, minFiles: 1,
      fields: [{ k: 'orderNote', type: 'note', label: 'Each image becomes one page, in order.' }],
      run: (files, o, p) => D.imagesToPdf(files, p),
      outName: () => 'images.pdf',
    },

    // ── record ───────────────────────────────────────────────────────────────
    {
      id: 'record-screen', name: 'Screen Recorder', desc: 'Tab, window or full screen (WebM).', cat: 'record', icon: 'ph-monitor-arrow-up', kind: 'record',
      fields: [
        { k: 'withAudio', type: 'checkbox', label: 'Include system audio', value: false },
        { k: 'maxSeconds', type: 'number', label: 'Auto-stop after', min: 0, max: 3600, step: 30, value: 0, unit: 's (0 = manual)' },
      ],
      record: true,
    },
    {
      id: 'record-voice', name: 'Voice Recorder', desc: 'Microphone → downloadable file.', cat: 'record', icon: 'ph-microphone', kind: 'record',
      fields: [],
      record: true,
    },
    {
      id: 'record-webcam', name: 'Webcam Recorder', desc: 'Camera preview → WebM.', cat: 'record', icon: 'ph-webcam', kind: 'record',
      fields: [
        { k: 'maxSeconds', type: 'number', label: 'Auto-stop after', min: 0, max: 3600, step: 30, value: 0, unit: 's (0 = manual)' },
      ],
      record: true,
    },
  ];

  // output suffix per format
  const EXT = (fmt) => fmt === 'jpeg' ? 'jpg' : fmt;

  // helper: run per-file then zip if multiple (names via current tool+opts)
  let _curToolObj = null, _curOpts = null;
  const unwrap = (r) => (r && r.blob instanceof Blob) ? r.blob : r;
  async function zipOrSingle(files, fn, onProgress) {
    if (files.length === 1) return { blob: unwrap(await fn(files[0], onProgress)), name: null };
    const parts = [];
    for (let i = 0; i < files.length; i++) {
      const blob = unwrap(await fn(files[i], (x) => onProgress((i + x) / files.length)));
      let nm = 'file-' + (i + 1);
      if (_curToolObj && _curToolObj.outName) {
        try { nm = _curToolObj.outName(files[i], _curOpts || {}); } catch { }
      }
      parts.push({ name: nm, blob });
    }
    return { blob: await MMT.zipStore(parts), name: 'batch.zip', zip: true };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GRID + ROUTER + RUNNER
  // ═══════════════════════════════════════════════════════════════════════
  const gridEl = document.getElementById('tools-grid');
  const homeView = document.getElementById('tools-home-view');
  const stageEl = document.getElementById('workspace-stage');
  const toolRoot = document.getElementById('tool-root');
  const legacyPanels = document.getElementById('legacy-panels');
  const stageTitle = document.getElementById('stage-title');
  const backBtn = document.getElementById('btn-back-home');

  let activeCat = 'all';
  let curToolId = null;

  function renderGrid() {
    gridEl.innerHTML = '';
    for (const t of TOOLS) {
      if (activeCat !== 'all' && t.cat !== activeCat) continue;
      const b = document.createElement('button');
      b.className = 'tool-card glass-card';
      b.dataset.tool = t.id;
      b.innerHTML = `
        <span class="tc-cat">${(CATS.find(c => c.id === t.cat) || {}).label || ''}</span>
        <span class="tc-icon"><iconify-icon icon="${t.icon}"></iconify-icon></span>
        <h3>${t.name}</h3>
        <p>${t.desc}</p>`;
      b.addEventListener('click', () => openTool(t.id));
      gridEl.appendChild(b);
    }
  }

  function renderCatBar() {
    const bar = document.createElement('div');
    bar.className = 'cat-bar';
    bar.id = 'cat-bar';
    const mk = (id, label) => {
      const p = document.createElement('button');
      p.className = 'cat-pill' + (id === activeCat ? ' active' : '');
      p.textContent = label;
      p.addEventListener('click', () => { activeCat = id; bar.querySelectorAll('.cat-pill').forEach(x => x.classList.remove('active')); p.classList.add('active'); renderGrid(); });
      return p;
    };
    bar.appendChild(mk('all', 'All tools'));
    CATS.forEach(c => bar.appendChild(mk(c.id, c.label)));
    gridEl.parentElement.insertBefore(bar, gridEl);
  }

  // ── circle reveal ─────────────────────────────────────────────────────────
  function circleReveal() {
    const r = document.createElement('div');
    r.className = 'page-reveal';
    r.innerHTML = '<div class="pr-disc"></div>';
    document.body.appendChild(r);
    setTimeout(() => r.remove(), 700);
  }

  function showStage() {
    circleReveal();
    if (homeView) { homeView.classList.add('view-leave'); setTimeout(() => homeView.classList.add('v4-hide'), 300); }
    stageEl.classList.remove('v4-hide', 'hidden');
    stageEl.classList.add('view-enter');
    document.getElementById('workspace').scrollIntoView({ behavior: 'auto', block: 'start' });
    setTimeout(() => stageEl.classList.remove('view-enter'), 900);
  }

  function showHome() {
    circleReveal();
    curToolId = null;
    stageEl.classList.add('v4-hide');
    if (homeView) { homeView.classList.remove('v4-hide'); homeView.classList.remove('view-leave'); }
    history.replaceState(null, '', location.pathname + '#tools-home-view');
    document.getElementById('tools-home-view').scrollIntoView({ behavior: 'auto', block: 'start' });
  }

  // ── open a tool ───────────────────────────────────────────────────────────
  function openTool(id) {
    const t = TOOLS.find(x => x.id === id);
    if (!t) return;
    curToolId = id;
    if (t.legacy) return openLegacy(t);
    location.hash = 't=' + t.id;
    showStage();
    stageTitle.textContent = t.name;
    toolRoot.innerHTML = '';
    legacyPanels.classList.add('v4-hide');
    if (t.record) buildRecorder(t); else buildRunner(t);
  }

  function openLegacy(t) {
    location.hash = 't=' + t.id;
    showStage();
    stageTitle.textContent = t.name;
    toolRoot.innerHTML = '';
    legacyPanels.classList.remove('v4-hide');
    // route through the original tab wiring so its init code runs
    const tabBtn = document.getElementById('tab-' + t.legacy);
    if (tabBtn) { tabBtn.click(); return; }
    const panel = document.getElementById('panel-' + t.legacy);
    legacyPanels.querySelectorAll('.card').forEach(p => p.classList.add('hidden'));
    if (panel) panel.classList.remove('hidden');
  }

  // ── generic runner UI ─────────────────────────────────────────────────────
  function buildRunner(t) {
    const root = document.createElement('div');
    root.className = 'mmt-run';
    root.innerHTML = `
      <div class="mmt-drop glass-card" tabindex="0" role="button" aria-label="Choose file">
        <iconify-icon class="md-icon" icon="ph:upload-simple-bold"></iconify-icon>
        <p class="md-title">Choose ${t.kind} file${t.multi ? 's' : ''} or drop ${t.multi ? 'them' : 'it'} here</p>
        <p class="md-sub">${t.accept.replace(/\./g, '').toUpperCase()} — processed locally, never uploaded</p>
        <input type="file" accept="${t.accept}" ${t.multi ? 'multiple' : ''} class="mm-file-input" style="display:none">
      </div>
      <div class="mmt-files"></div>
      <div class="mmt-opts v4-hide"></div>
      <div class="mmt-actions v4-hide">
        <button class="btn-run">Run</button>
        <span class="opt-note">Runs entirely in your browser.</span>
      </div>
      <div class="mmt-progress v4-hide"><div class="mmt-progress-bar"></div></div>
      <div class="mmt-status"></div>
      <div class="mmt-result"></div>`;
    toolRoot.appendChild(root);

    const drop = root.querySelector('.mmt-drop');
    const input = root.querySelector('.mm-file-input');
    const filesEl = root.querySelector('.mmt-files');
    const optsEl = root.querySelector('.mmt-opts');
    const acts = root.querySelector('.mmt-actions');
    const prog = root.querySelector('.mmt-progress');
    const bar = root.querySelector('.mmt-progress-bar');
    const status = root.querySelector('.mmt-status');
    const result = root.querySelector('.mmt-result');
    root.querySelector('.btn-run').addEventListener('click', runNow);
    let files = [];
    let probe = null;

    const openPicker = () => input.click();
    drop.addEventListener('click', openPicker);
    drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } });
    ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('dragover'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('dragover'); }));
    drop.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) takeFiles([...e.dataTransfer.files]); });
    input.addEventListener('change', () => { if (input.files.length) takeFiles([...input.files]); });

    async function takeFiles(list) {
      files = list;
      filesEl.innerHTML = list.map(f => `<span class="glass-chip" style="font-size:12.5px"><iconify-icon icon="ph:file"></iconify-icon> ${f.name} · ${MMT.fmtBytes(f.size)}</span>`).join(' ');
      if (t.minFiles && files.length < t.minFiles) {
        status.textContent = `Pick at least ${t.minFiles} files for this tool.`;
        status.classList.add('err');
        return;
      }
      status.textContent = ''; status.classList.remove('err');
      // probe first file for duration-scaled sliders / crop defaults
      if (t.kind === 'video' && files[0]) {
        try {
          probe = await MMT.probeVideo(files[0]);
          if (probe.v) {
            const c = t.fields.find(f => f.k === 'w');
            if (c && !c.value) c.ph = `source ${probe.v.w}×${probe.v.h}`;
          }
        } catch { }
      }
      if (t.kind === 'audio' && files[0]) {
        try { probe = await MMT.probeAudio(files[0]); } catch { }
      }
      buildOpts();
      // tools whose options all have safe defaults run immediately; the rest
      // wait for the Run button so the user can adjust first
      const needsSetup = t.fields.some(f => f.type !== 'note');
      if (needsSetup) {
        optsEl.classList.remove('v4-hide');
        acts.classList.remove('v4-hide');
      } else {
        optsEl.classList.add('v4-hide');
        acts.classList.add('v4-hide');
        autoRun();
      }
    }

    function buildOpts() {
      optsEl.innerHTML = '';
      for (const f of t.fields) {
        const row = document.createElement('div');
        row.className = 'opt-row';
        const lab = document.createElement('label');
        lab.textContent = f.label;
        row.appendChild(lab);
        let el;
        const val = (f.value === 'dur') ? (probe ? probe.duration : 10) : f.value;
        if (f.type === 'select') {
          el = document.createElement('select');
          for (const [v, l] of f.options) { const op = document.createElement('option'); op.value = v; op.textContent = l; if (String(v) === String(val)) op.selected = true; el.appendChild(op); }
        } else if (f.type === 'checkbox') {
          el = document.createElement('input'); el.type = 'checkbox'; el.checked = !!val;
        } else if (f.type === 'range') {
          el = document.createElement('input'); el.type = 'range';
          el.min = f.min; el.max = (f.max === 'dur') ? (probe ? probe.duration.toFixed(2) : 10) : f.max;
          el.step = f.step || 0.1; el.value = val;
          const out = document.createElement('span'); out.className = 'opt-note'; out.textContent = fmtField(f, val);
          el.addEventListener('input', () => { out.textContent = fmtField(f, el.value); });
          row.appendChild(el); row.appendChild(out);
        } else if (f.type === 'number') {
          el = document.createElement('input'); el.type = 'number';
          if (f.min != null) el.min = f.min; if (f.max != null) el.max = f.max;
          el.step = f.step || 1; el.value = val; if (f.ph) el.placeholder = f.ph;
        } else if (f.type === 'text') {
          el = document.createElement('input'); el.type = 'text'; if (f.ph) el.placeholder = f.ph;
        } else if (f.type === 'note') {
          const n = document.createElement('span'); n.className = 'opt-note'; n.textContent = f.label;
          row.innerHTML = ''; row.appendChild(n); optsEl.appendChild(row); continue;
        }
        if (f.type !== 'range') row.appendChild(el);
        el.dataset.k = f.k;
        optsEl.appendChild(row);
      }
    }
    const fmtField = (f, v) => f.unit ? `${(+v).toFixed(f.step < 0.1 ? 2 : 0)}${f.unit}` : String(v);

    function readOpts() {
      const o = {};
      for (const el of optsEl.querySelectorAll('[data-k]')) {
        const k = el.dataset.k;
        o[k] = el.type === 'checkbox' ? el.checked : (el.type === 'range' || el.type === 'number' ? parseFloat(el.value) : el.value);
      }
      o.__probe = probe;
      return o;
    }

    async function autoRun() { if (t.record) return; runNow(); }

    async function runNow() {
      const o = readOpts();
      _curToolObj = t; _curOpts = o;
      prog.classList.remove('v4-hide');
      bar.style.width = '2%';
      status.textContent = 'Working…'; status.classList.remove('err');
      result.innerHTML = '';
      const t0 = performance.now();
      try {
        const outp = await t.run(files, o, (x) => { bar.style.width = Math.round(x * 100) + '%'; });
        const dt = (performance.now() - t0) / 1000;
        bar.style.width = '100%';
        let blob = outp && outp.blob ? outp.blob : outp;
        let name = (outp && outp.name) || (t.outName ? t.outName(files[0], o) : 'output');
        const size = blob.size;
        const inSize = files.reduce((s, f) => s + f.size, 0);
        showResult(blob, name, { inSize, size, dt });
        status.textContent = `Done in ${dt.toFixed(1)}s`;
      } catch (e) {
        console.error(e);
        status.textContent = 'Failed: ' + (e && e.message || e);
        status.classList.add('err');
        if (window.__mmBanner) window.__mmBanner('MediaMaid tool error: ' + (e && e.message || e));
      }
    }

    function showResult(blob, name, stats) {
      const saved = stats.inSize > 0 ? Math.max(0, Math.round((1 - stats.size / stats.inSize) * 100)) : 0;
      result.innerHTML = `
        <div class="glass-card" style="padding:18px 20px;display:flex;gap:14px;align-items:center;flex-wrap:wrap">
          <iconify-icon icon="ph:check-circle" style="font-size:28px;color:#7de8dd"></iconify-icon>
          <div style="flex:1;min-width:180px">
            <strong>${name}</strong><br>
            <span class="opt-note">${MMT.fmtBytes(stats.inSize)} → ${MMT.fmtBytes(stats.size)}${saved > 0 ? ` · ${saved}% smaller` : ''}</span>
          </div>
          <button class="btn-secondary dl"><iconify-icon icon="ph:download-simple-bold"></iconify-icon> Download</button>
        </div>`;
      result.querySelector('.dl').addEventListener('click', () => MMT.download(blob, name));
    }

    return { runNow };
  }

  // ── recorders (screen / voice / webcam) ───────────────────────────────────
  function buildRecorder(t) {
    const root = document.createElement('div');
    root.className = 'mmt-run';
    const isScreen = t.id === 'record-screen', isVoice = t.id === 'record-voice';
    root.innerHTML = `
      <div class="glass-card" style="padding:30px;text-align:center">
        <iconify-icon icon="${t.icon.replace('ph-', 'ph:')}" style="font-size:52px;color:#7de8dd"></iconify-icon>
        <p class="md-title" style="font-size:18px;font-weight:700;margin:10px 0 4px">${t.name}</p>
        <p class="opt-note" style="margin-bottom:18px">${t.desc}</p>
        <div class="mmt-opts"></div>
        <div class="mmt-actions" style="justify-content:center">
          <button class="btn-run rec-start">Start recording</button>
          <button class="btn-secondary rec-stop v4-hide"><iconify-icon icon="ph:stop-bold"></iconify-icon> Stop</button>
        </div>
        <div class="rec-timer opt-note" style="margin-top:12px;font-size:20px;font-weight:800"></div>
        ${isVoice ? '<div class="rec-preview" style="margin-top:14px"></div>' : '<video class="rec-preview mmt-preview v4-hide" controls style="margin-top:14px"></video>'}
      </div>`;
    toolRoot.appendChild(root);
    const optsEl = root.querySelector('.mmt-opts');
    for (const f of t.fields) {
      const row = document.createElement('div'); row.className = 'opt-row';
      row.innerHTML = `<label>${f.label}</label>`;
      let el;
      if (f.type === 'checkbox') { el = document.createElement('input'); el.type = 'checkbox'; el.checked = f.value; }
      else { el = document.createElement('input'); el.type = 'number'; el.min = f.min; el.max = f.max; el.step = f.step; el.value = f.value; }
      el.dataset.k = f.k; row.appendChild(el); optsEl.appendChild(row);
    }
    const startBtn = root.querySelector('.rec-start');
    const stopBtn = root.querySelector('.rec-stop');
    const timer = root.querySelector('.rec-timer');
    const prev = root.querySelector('.rec-preview');
    let handle = null, t0 = 0, tick = null;

    startBtn.addEventListener('click', async () => {
      const o = {};
      optsEl.querySelectorAll('[data-k]').forEach(el => { o[el.dataset.k] = el.type === 'checkbox' ? el.checked : parseFloat(el.value); });
      try {
        if (isScreen) {
          const h = await V.screenRecorder(o, (s) => { timer.textContent = MMfmtT(s); });
          handle = h; h.done.then((blob) => finish(blob, 'screen-recording.webm'));
        } else if (isVoice) {
          const h = await V.micRecorder();
          handle = { stop: h.stop };
          t0 = Date.now(); tick = setInterval(() => { timer.textContent = MMfmtT((Date.now() - t0) / 1000); }, 300);
          h.start();
          handle.done = new Promise((res) => { handle.stop = async () => { const b = await h.stop(); res(b); }; });
          handle.done.then((blob) => finish(blob, 'voice-recording.webm'));
        } else {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          const chunks = [];
          const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm' });
          rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
          const doneP = new Promise(res => { rec.onstop = () => res(new Blob(chunks, { type: 'video/webm' })); });
          rec.start(500);
          prev.srcObject = stream; prev.classList.remove('v4-hide');
          handle = {
            stop: () => { rec.stop(); stream.getTracks().forEach(x => x.stop()); prev.srcObject = null; },
            done: doneP,
          };
          t0 = Date.now(); tick = setInterval(() => { timer.textContent = MMfmtT((Date.now() - t0) / 1000); }, 300);
          if (o.maxSeconds > 0) setTimeout(() => stopBtn.click(), o.maxSeconds * 1000);
          handle.done.then((blob) => finish(blob, 'webcam-recording.webm'));
        }
        startBtn.classList.add('v4-hide');
        stopBtn.classList.remove('v4-hide');
        timer.textContent = '0:00';
        t0 = Date.now();
        if (!tick) tick = setInterval(() => { timer.textContent = MMfmtT((Date.now() - t0) / 1000); }, 300);
      } catch (e) {
        timer.textContent = 'Could not start: ' + (e && e.message || e);
      }
    });
    stopBtn.addEventListener('click', async () => {
      if (!handle) return;
      clearInterval(tick); tick = null;
      stopBtn.classList.add('v4-hide');
      timer.textContent = 'Finishing…';
      await handle.stop();
    });
    function finish(blob, name) {
      clearInterval(tick); tick = null;
      timer.textContent = 'Done — ' + MMT.fmtBytes(blob.size);
      startBtn.classList.remove('v4-hide');
      stopBtn.classList.add('v4-hide');
      const url = URL.createObjectURL(blob);
      const host = root.querySelector('.rec-preview');
      const wrap = document.createElement('div');
      wrap.style.cssText = 'margin-top:14px;display:flex;flex-direction:column;gap:10px;align-items:center';
      if (isVoice) {
        wrap.innerHTML = `<audio controls src="${url}" style="width:100%"></audio>`;
      } else {
        const v = root.querySelector('video.rec-preview');
        v.src = url; v.classList.remove('v4-hide');
      }
      const dl = document.createElement('button');
      dl.className = 'btn-secondary';
      dl.innerHTML = '<iconify-icon icon="ph:download-simple-bold"></iconify-icon> Download';
      dl.addEventListener('click', () => MMT.download(blob, name));
      wrap.appendChild(dl);
      host.parentElement.appendChild(wrap);
    }
    return {};
  }
  const MMfmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  // ── router: hash + back button ────────────────────────────────────────────
  backBtn.addEventListener('click', showHome);
  window.addEventListener('hashchange', () => {
    const m = location.hash.match(/t=([\w-]+)/);
    if (!m) return;
    const t = TOOLS.find(x => x.id === m[1]);
    if (!t || m[1] === curToolId) return;
    openTool(m[1]);
  });

  // boot
  if (gridEl && !gridEl.childElementCount) {
    renderCatBar();
    renderGrid();
  }
  if (window.MediaMaid) MediaMaid.toolsUiLoaded = true;
  // auto-open from deep link
  const m0 = location.hash.match(/t=([\w-]+)/);
  if (m0 && TOOLS.find(t => t.id === m0[1]) && !TOOLS.find(t => t.id === m0[1]).legacy) {
    setTimeout(() => openTool(m0[1]), 350);
  }
})();
