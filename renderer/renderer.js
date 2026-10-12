(() => {
  'use strict';

  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d'); // alpha canvas; white page shows through via CSS
  const stage = document.getElementById('stage');
  const cursorEl = document.getElementById('cursor');
  const statusEl = document.getElementById('status');
  const penBadge = document.getElementById('penBadge');
  const undoBtn = document.getElementById('undo');
  const redoBtn = document.getElementById('redo');
  const flipBtn = document.getElementById('flip');

  const state = {
    tool: 'brush',
    color: '#ffffff',
    size: 12,
    opacity: 1,
    flipped: false, // false = landscape 1600x1000, true = portrait 1000x1600
    penDetected: false
  };

  let tempEraser = false; // right-click temporary erase
  let drawing = false;
  let last = null;
  let lastPressure = 0.5;
  let lastPointerId = null;

  /* ================= status ================= */

  function updateStatus() {
    const bits = [
      state.tool,
      `size ${state.size}`,
      `opacity ${Math.round(state.opacity * 100)}%`
    ];
    if (state.penDetected) bits.push('pen ✓');
    statusEl.textContent = bits.join('  ·  ');
    penBadge.classList.toggle('hidden', !state.penDetected);
  }

  function flashStatus(msg) {
    const prev = statusEl.textContent;
    statusEl.textContent = msg;
    setTimeout(() => updateStatus(), 2500);
  }

  /* ================= undo / redo ================= */

  const undoStack = [];
  const redoStack = [];
  const MAX_SNAPSHOTS = 30;

  function snapshot() {
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    if (undoStack.length > MAX_SNAPSHOTS) undoStack.shift();
    redoStack.length = 0;
    updateHistoryButtons();
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    const img = undoStack.pop();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.putImageData(img, 0, 0);
    updateHistoryButtons();
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
    const img = redoStack.pop();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.putImageData(img, 0, 0);
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    undoBtn.disabled = !undoStack.length;
    redoBtn.disabled = !redoStack.length;
  }

  /* ================= flip orientation =================
     Rotates the whole canvas 90° clockwise so a landscape drawing keeps
     making sense in portrait. Undo history is dropped (snapshots are
     dimension-bound); the drawing itself is carried over. */
  function flipCanvas() {
    const src = document.createElement('canvas');
    src.width = canvas.width;
    src.height = canvas.height;
    src.getContext('2d').drawImage(canvas, 0, 0);

    const w = canvas.width, h = canvas.height;
    canvas.width = h;
    canvas.height = w;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(src, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    undoStack.length = 0;
    redoStack.length = 0;
    state.flipped = !state.flipped;
    flipBtn.classList.toggle('flipped', state.flipped);
    updateHistoryButtons();
    saveSettings();
    flashStatus('Orientation: ' + (state.flipped ? 'portrait' : 'landscape'));
  }
  flipBtn.addEventListener('click', flipCanvas);

  /* ================= frameless window controls =================
     - top bar drag: JS-driven (CSS -webkit-app-region is a no-op on
       transparent Windows windows, so mousedown -> win:drag-move IPC)
     - minimize / close: buttons in the top bar -> IPC
     - resize: bottom-right grip -> IPC setSize
     screenX/screenY are device pixels; BrowserWindow coords are DIPs,
     so divide deltas by devicePixelRatio (handles 125%/150% scaling). */
  const topbarEl = document.getElementById('topbar');
  const winMinBtn = document.getElementById('winMin');
  const winCloseBtn = document.getElementById('winClose');
  const resizeHandle = document.getElementById('resize-handle');

  if (winMinBtn) winMinBtn.addEventListener('click', () => window.bridge?.winMinimize());
  if (winCloseBtn) winCloseBtn.addEventListener('click', () => window.bridge?.winClose());

  // Pointer events + setPointerCapture: pointerup/pointercancel are delivered
  // to the element even when the release happens outside the window, so the
  // drag/resize can never get "stuck" to the cursor. The ev.buttons === 0
  // check is a second safety net if an event is still lost.
  if (topbarEl) {
    let dStart = null;
    const endDrag = (id) => { if (dStart && (id === undefined || dStart.id === id)) dStart = null; };
    topbarEl.addEventListener('pointerdown', async (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('input, button, .swatch, .lbl, .win-controls')) return;
      const b = await window.bridge?.winGetBounds();
      if (!b) return;
      dStart = { mx: e.screenX, my: e.screenY, x: b.x, y: b.y, scale: window.devicePixelRatio || 1, id: e.pointerId };
      try { topbarEl.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    });
    topbarEl.addEventListener('pointermove', (ev) => {
      if (!dStart || ev.pointerId !== dStart.id) return;
      if (ev.buttons === 0) { endDrag(); return; }
      window.bridge?.winDragMove(
        dStart.x + (ev.screenX - dStart.mx) / dStart.scale,
        dStart.y + (ev.screenY - dStart.my) / dStart.scale
      );
    });
    topbarEl.addEventListener('pointerup', (ev) => endDrag(ev.pointerId));
    topbarEl.addEventListener('pointercancel', (ev) => endDrag(ev.pointerId));
    window.addEventListener('blur', () => endDrag());
  }

  if (resizeHandle) {
    let rStart = null;
    const endResize = (id) => { if (rStart && (id === undefined || rStart.id === id)) rStart = null; };
    resizeHandle.addEventListener('pointerdown', async (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const b = await window.bridge?.winGetBounds();
      if (!b) return;
      rStart = { mx: e.screenX, my: e.screenY, w: b.width, h: b.height, scale: window.devicePixelRatio || 1, id: e.pointerId };
      try { resizeHandle.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    });
    resizeHandle.addEventListener('pointermove', (ev) => {
      if (!rStart || ev.pointerId !== rStart.id) return;
      if (ev.buttons === 0) { endResize(); return; }
      window.bridge?.winResize(
        rStart.w + (ev.screenX - rStart.mx) / rStart.scale,
        rStart.h + (ev.screenY - rStart.my) / rStart.scale
      );
    });
    resizeHandle.addEventListener('pointerup', (ev) => endResize(ev.pointerId));
    resizeHandle.addEventListener('pointercancel', (ev) => endResize(ev.pointerId));
    window.addEventListener('blur', () => endResize());
  }

  /* ================= geometry helpers ================= */

  function toCanvas(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (canvas.width / r.width),
      y: (e.clientY - r.top) * (canvas.height / r.height)
    };
  }

  function pressureOf(e) {
    if (e.pointerType === 'pen') return e.pressure > 0 ? e.pressure : 0.4;
    return 0.5; // mouse / touch: constant pressure
  }

  function jitter(w) {
    return (Math.random() - 0.5) * w * 0.6;
  }

  function strokeSeg(a, b, w) {
    ctx.lineWidth = Math.max(0.4, w);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x + 0.01, b.y + 0.01); // avoid zero-length path quirks
    ctx.stroke();
  }

  /* ================= tools ================= */

  function brushWidth(p) { return state.size * (0.25 + 0.75 * p); }
  function pencilWidth(p) { return state.size * 0.45 * (0.4 + 0.6 * p); }
  function markerWidth(p) { return state.size * 1.4 * (0.85 + 0.15 * p); }
  function eraserWidth(p) { return state.size * 2 * (0.5 + 0.5 * p); }
  function airbrushRadius(p) { return state.size * 1.6 * (0.4 + 0.6 * p); }

  function drawSegment(a, b, p) {
    const tool = tempEraser ? 'eraser' : state.tool;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (tool) {
      case 'brush': {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = state.opacity;
        ctx.strokeStyle = state.color;
        strokeSeg(a, b, brushWidth(p));
        break;
      }
      case 'pencil': {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = state.opacity * 0.55;
        ctx.strokeStyle = state.color;
        const w = pencilWidth(p);
        for (let i = 0; i < 2; i++) {
          const ja = { x: a.x + jitter(w), y: a.y + jitter(w) };
          const jb = { x: b.x + jitter(w), y: b.y + jitter(w) };
          strokeSeg(ja, jb, w * (0.7 + Math.random() * 0.6));
        }
        break;
      }
      case 'marker': {
        ctx.globalCompositeOperation = 'multiply'; // ink blends where it overlaps
        ctx.globalAlpha = state.opacity * 0.35;
        ctx.strokeStyle = state.color;
        ctx.lineCap = 'butt';
        strokeSeg(a, b, markerWidth(p));
        ctx.lineCap = 'round';
        break;
      }
      case 'airbrush': {
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = state.opacity * 0.05;
        ctx.fillStyle = state.color;
        const r = airbrushRadius(p);
        const n = 26;
        for (let i = 0; i < n; i++) {
          const ang = Math.random() * Math.PI * 2;
          const rad = Math.sqrt(Math.random()) * r;
          ctx.beginPath();
          ctx.arc(b.x + Math.cos(ang) * rad, b.y + Math.sin(ang) * rad, 0.5 + Math.random() * 1.5, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'eraser': {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        strokeSeg(a, b, eraserWidth(p));
        break;
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ================= pointer handling ================= */

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'pen') {
      state.penDetected = true;
      updateStatus();
    }
    // right mouse button = temporary eraser
    if (e.pointerType === 'mouse' && e.button === 2) tempEraser = true;
    if (e.button !== 0 && e.pointerType !== 'mouse') return;

    canvas.setPointerCapture(e.pointerId);
    lastPointerId = e.pointerId;
    drawing = true;
    snapshot();

    const p = pressureOf(e);
    last = toCanvas(e);
    lastPressure = p;
    drawSegment(last, last, p); // single dot on tap
  });

  canvas.addEventListener('pointermove', (e) => {
    updateCursor(e);
    if (!drawing || e.pointerId !== lastPointerId) return;

    const p = pressureOf(e);
    const pt = toCanvas(e);
    const dist = Math.hypot(pt.x - last.x, pt.y - last.y);
    const step = Math.max(1, state.size * 0.12 + 1);
    const steps = Math.max(1, Math.min(32, Math.floor(dist / step)));

    let prev = last;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const cur = {
        x: last.x + (pt.x - last.x) * t,
        y: last.y + (pt.y - last.y) * t
      };
      drawSegment(prev, cur, lastPressure + (p - lastPressure) * t);
      prev = cur;
    }
    last = pt;
    lastPressure = p;
  });

  function endStroke(e) {
    if (!drawing || e.pointerId !== lastPointerId) return;
    drawing = false;
    tempEraser = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
  canvas.addEventListener('lostpointercapture', endStroke);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerleave', () => cursorEl.classList.add('hidden'));

  /* ================= custom cursor ================= */

  function updateCursor(e) {
    const r = canvas.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      cursorEl.classList.add('hidden');
      return;
    }
    cursorEl.classList.remove('hidden');
    const p = pressureOf(e);
    const tool = tempEraser ? 'eraser' : state.tool;
    let w;
    switch (tool) {
      case 'brush': w = brushWidth(p); break;
      case 'pencil': w = pencilWidth(p); break;
      case 'marker': w = markerWidth(p); break;
      case 'airbrush': w = airbrushRadius(p) * 2; break;
      case 'eraser': w = eraserWidth(p); break;
    }
    const displayScale = r.width / canvas.width;
    const d = Math.max(3, w * displayScale);
    cursorEl.style.width = d + 'px';
    cursorEl.style.height = d + 'px';
    cursorEl.style.left = e.clientX + 'px';
    cursorEl.style.top = e.clientY + 'px';
  }

  /* ================= UI wiring ================= */

  // tools
  document.querySelectorAll('.tool').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.tool = btn.dataset.tool;
      document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b === btn));
      saveSettings();
      updateStatus();
    });
  });

  // color
  const colorInput = document.getElementById('color');
  colorInput.addEventListener('input', () => {
    state.color = colorInput.value;
    setActiveSwatch();
    saveSettings();
    updateStatus();
  });

  // swatches
  const SWATCHES = ['#111111', '#ffffff', '#e5484d', '#f76b15', '#ffd60a', '#46a758', '#0091ff', '#8e4ec6'];
  const swatchWrap = document.getElementById('swatches');
  SWATCHES.forEach((c) => {
    const s = document.createElement('button');
    s.className = 'swatch' + (c === state.color ? ' active' : '');
    s.style.background = c;
    s.title = c;
    s.addEventListener('click', () => {
      state.color = c;
      colorInput.value = c;
      setActiveSwatch();
      saveSettings();
      updateStatus();
    });
    swatchWrap.appendChild(s);
  });

  function setActiveSwatch() {
    document.querySelectorAll('.swatch').forEach((s) =>
      s.classList.toggle('active', s.title.toLowerCase() === state.color.toLowerCase())
    );
  }

  // size
  const sizeInput = document.getElementById('size');
  const sizeVal = document.getElementById('sizeVal');
  sizeInput.addEventListener('input', () => {
    state.size = parseInt(sizeInput.value, 10);
    sizeVal.textContent = state.size;
    saveSettings();
    updateStatus();
  });

  // opacity
  const opacityInput = document.getElementById('opacity');
  const opacityVal = document.getElementById('opacityVal');
  opacityInput.addEventListener('input', () => {
    state.opacity = parseInt(opacityInput.value, 10) / 100;
    opacityVal.textContent = opacityInput.value + '%';
    saveSettings();
    updateStatus();
  });

  // history buttons
  undoBtn.addEventListener('click', undo);
  redoBtn.addEventListener('click', redo);

  // clear
  document.getElementById('clear').addEventListener('click', () => {
    if (!window.confirm('Clear the whole canvas?')) return;
    snapshot();
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  });

  // save / load
  async function saveImage(ext) {
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const octx = out.getContext('2d');
    octx.fillStyle = '#000000';
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(canvas, 0, 0);
    const mime = ext === 'jpg' ? 'image/jpeg' : 'image/png';
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    const res = await window.bridge.saveImage({
      dataUrl: out.toDataURL(mime, 0.95),
      defaultName: `sketch-${stamp}.${ext}`
    });
    if (res && res.saved) flashStatus('Saved ' + res.path);
  }
  document.getElementById('savePng').addEventListener('click', () => saveImage('png'));
  document.getElementById('saveJpg').addEventListener('click', () => saveImage('jpg'));

  async function loadImage() {
    const res = await window.bridge.openImage();
    if (!res) return;
    const img = new Image();
    img.onload = () => {
      snapshot();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
      flashStatus('Loaded ' + res.name);
    };
    img.src = res.dataUrl;
  }
  document.getElementById('load').addEventListener('click', loadImage);

  // keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    } else if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveImage('png');
    } else if (e.key === 'b') selectTool('brush');
    else if (e.key === 'p') selectTool('pencil');
    else if (e.key === 'm') selectTool('marker');
    else if (e.key === 'a') selectTool('airbrush');
    else if (e.key === 'e') selectTool('eraser');
    else if (e.key === '[') setSize(Math.max(1, state.size - 2));
    else if (e.key === ']') setSize(Math.min(120, state.size + 2));
    else if (e.key === 'f') flipCanvas();
  });

  function selectTool(tool) {
    state.tool = tool;
    document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('active', b.dataset.tool === tool));
    saveSettings();
    updateStatus();
  }

  function setSize(v) {
    state.size = v;
    sizeInput.value = v;
    sizeVal.textContent = v;
    saveSettings();
    updateStatus();
  }

  /* ================= settings persistence =================
     Remembers tool/color/size/opacity and canvas orientation across app
     relaunches (Electron localStorage). */

  const SETTINGS_KEY = 'sketchpad-settings-v1';

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        flipped: state.flipped,
        tool: state.tool,
        color: state.color,
        size: state.size,
        opacity: state.opacity
      }));
    } catch (_) { /* storage unavailable — non-fatal */ }
  }

  function restoreSettings() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'); } catch (_) { /* ignore */ }
    if (!saved) return;
    if (saved.flipped) {
      // swap canvas dimensions before anything else touches them
      const w = canvas.width, h = canvas.height;
      canvas.width = h;
      canvas.height = w;
      state.flipped = true;
      flipBtn.classList.add('flipped');
    }
    if (saved.tool) selectTool(saved.tool);
    if (saved.color) {
      state.color = saved.color;
      colorInput.value = saved.color;
      setActiveSwatch();
    }
    if (saved.size != null) setSize(Math.max(1, Math.min(120, saved.size)));
    if (saved.opacity != null) {
      state.opacity = Math.max(0.01, Math.min(1, saved.opacity));
      opacityInput.value = Math.round(state.opacity * 100);
      opacityVal.textContent = opacityInput.value + '%';
    }
    updateStatus();
  }

  /* ================= MCP / programmatic control ================= */

  // Draw a stroke from a list of {x, y, p?} points in canvas coordinates.
  function drawStroke(points, overrides) {
    if (!Array.isArray(points) || !points.length) return { ok: false, error: 'points required' };
    const prev = { tool: state.tool, color: state.color, size: state.size, opacity: state.opacity };
    if (overrides) {
      if (overrides.tool) state.tool = overrides.tool;
      if (overrides.color) state.color = overrides.color;
      if (overrides.size != null) state.size = overrides.size;
      if (overrides.opacity != null) state.opacity = overrides.opacity;
    }
    tempEraser = false;
    drawing = true; // so updateCursor etc. treat it as active (not strictly required)
    snapshot();

    let a = { x: points[0].x, y: points[0].y };
    let pA = points[0].p != null ? points[0].p : 0.5;
    drawSegment(a, a, pA); // tap dot
    for (let i = 1; i < points.length; i++) {
      const b = { x: points[i].x, y: points[i].y };
      const pB = points[i].p != null ? points[i].p : pA;
      const dist = Math.hypot(b.x - a.x, b.y - a.y);
      const step = Math.max(1, state.size * 0.12 + 1);
      const steps = Math.max(1, Math.min(64, Math.floor(dist / step)));
      let last = a;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const cur = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        drawSegment(last, cur, pA + (pB - pA) * t);
        last = cur;
      }
      a = b;
      pA = pB;
    }
    drawing = false;
    state.tool = prev.tool; state.color = prev.color; state.size = prev.size; state.opacity = prev.opacity;
    return { ok: true, points: points.length };
  }

  function compositedDataUrl(format) {
    const out = document.createElement('canvas');
    out.width = canvas.width;
    out.height = canvas.height;
    const octx = out.getContext('2d');
    octx.fillStyle = '#000000';
    octx.fillRect(0, 0, out.width, out.height);
    octx.drawImage(canvas, 0, 0);
    return out.toDataURL(format === 'jpg' ? 'image/jpeg' : 'image/png', 0.95);
  }

  async function handleCommand({ id, action, payload }) {
    let result;
    try {
      switch (action) {
        case 'state':
          result = { ok: true, tool: state.tool, color: state.color, size: state.size, opacity: state.opacity, penDetected: state.penDetected, orientation: state.flipped ? 'portrait' : 'landscape', canvas: { width: canvas.width, height: canvas.height } };
          break;
        case 'set_tool':
          selectTool(payload.tool);
          result = { ok: true, tool: state.tool };
          break;
        case 'set_color': {
          state.color = payload.color;
          colorInput.value = payload.color;
          setActiveSwatch();
          updateStatus();
          result = { ok: true, color: state.color };
          break;
        }
        case 'set_size':
          setSize(payload.size);
          result = { ok: true, size: state.size };
          break;
        case 'set_opacity': {
          state.opacity = payload.opacity;
          opacityInput.value = Math.round(payload.opacity * 100);
          opacityVal.textContent = opacityInput.value + '%';
          updateStatus();
          result = { ok: true, opacity: state.opacity };
          break;
        }
        case 'draw':
          result = drawStroke(payload.points, payload);
          break;
        case 'flip':
          flipCanvas();
          result = { ok: true, orientation: state.flipped ? 'portrait' : 'landscape', canvas: { width: canvas.width, height: canvas.height } };
          break;
        case 'undo':
          undo(); result = { ok: true };
          break;
        case 'redo':
          redo(); result = { ok: true };
          break;
        case 'clear':
          snapshot();
          ctx.globalCompositeOperation = 'source-over';
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          result = { ok: true };
          break;
        case 'screenshot': {
          const maxW = payload.maxWidth ? Math.max(32, Math.min(1600, payload.maxWidth)) : 800;
          const scale = Math.min(1, maxW / canvas.width);
          const w = Math.round(canvas.width * scale), h = Math.round(canvas.height * scale);
          const out = document.createElement('canvas');
          out.width = w; out.height = h;
          const octx = out.getContext('2d');
          octx.fillStyle = '#000000';
          octx.fillRect(0, 0, w, h);
          octx.drawImage(canvas, 0, 0, w, h);
          result = { ok: true, width: w, height: h, dataUrl: out.toDataURL('image/png') };
          break;
        }
        case 'save': {
          const format = payload.format === 'jpg' ? 'jpg' : 'png';
          const dataUrl = compositedDataUrl(format);
          if (payload.path) {
            result = await window.bridge.saveToPath({ dataUrl, filePath: payload.path });
          } else {
            const d = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
            result = await window.bridge.saveToPath({ dataUrl, filePath: `sketchpad-out/sketch-${stamp}.${format === 'jpg' ? 'jpg' : 'png' }` });
          }
          break;
        }
        case 'load': {
          if (!payload.path) { result = { ok: false, error: 'path required' }; break; }
          const res = await window.bridge.openFromPath({ filePath: payload.path });
          if (!res) { result = { ok: false, error: 'could not read file' }; break; }
          const img = new Image();
          await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = res.dataUrl; });
          snapshot();
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1;
          const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
          const w = img.width * scale, h = img.height * scale;
          ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
          result = { ok: true, name: res.name };
          break;
        }
        default:
          result = { ok: false, error: `unknown action: ${action}` };
      }
    } catch (err) {
      result = { ok: false, error: String(err && err.message || err) };
    }
    window.bridge.respondCommand({ id, result });
  }

  window.bridge.onCommand(handleCommand);

  /* ================= init ================= */
  restoreSettings();
  updateHistoryButtons();
  updateStatus();
})();
