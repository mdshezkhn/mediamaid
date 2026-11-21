
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
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
