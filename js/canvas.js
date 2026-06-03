// COLORS — Palette  ·  CANVAS prototype (Option B)
// Same colour-map concept, but the grid is rendered into ONE viewport-sized
// <canvas> instead of 344 transformed DOM nodes. Each frame we draw only the
// cells in view at the current camera. Result: the composited layer is just the
// screen (no GPU texture limit -> smooth scroll + zoom on-device), and instant
// slider jumps redraw the destination in the SAME frame (zero pop-in).
//
// Scope of this prototype: starts directly in the colour map so you can test the
// feel — scroll, zoom in/out, and the instant slider jumps. The glass bar + slider
// are the real ones (DOM overlay on top of the canvas).

const MAP_COLS = 8, DET_COLS = 2, LANES = MAP_COLS / DET_COLS, ROW_GAP = 8;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;

const SAT_MIN = 0.13;
const BUCKET_ORDER = ["white","ecru","beige","brown","khaki","green","yellow",
                      "red","pink","light_blue","blue","navy","grey","anthracite","black"];
const bIdx = (p) => { const i = BUCKET_ORDER.indexOf(p.bucket); return i < 0 ? 99 : i; };
function colorSorted(list) { return list.slice().sort((a, b) => (bIdx(a) - bIdx(b)) || (b.l - a.l)); }

function evenColorList(sorted) {
  const out = [], dropped = new Set();
  let i = 0;
  while (i < sorted.length) {
    const b = sorted[i].bucket; let j = i;
    while (j < sorted.length && sorted[j].bucket === b) j++;
    let slice = sorted.slice(i, j);
    if (slice.length % 2 === 1) { dropped.add(slice[slice.length - 1].handle); slice = slice.slice(0, -1); }
    out.push(...slice); i = j;
  }
  const mod = DET_COLS * LANES;
  while (out.length % mod !== 0) dropped.add(out.pop().handle);
  return { list: out, dropped };
}
function buildBuckets(sorted) {
  const out = [];
  sorted.forEach((p, i) => {
    const last = out[out.length - 1];
    if (last && last.key === p.bucket) { last.count++; last._r += p.rgb[0]; last._g += p.rgb[1]; last._b += p.rgb[2]; }
    else out.push({ key: p.bucket, start: i, count: 1, _r: p.rgb[0], _g: p.rgb[1], _b: p.rgb[2] });
  });
  out.forEach((b) => { b.rgb = [Math.round(b._r / b.count), Math.round(b._g / b.count), Math.round(b._b / b.count)]; });
  return out;
}
function paintSpectrum(track, buckets) {
  const n = buckets.length;
  const stops = buckets.map((b, i) => `rgb(${b.rgb[0]},${b.rgb[1]},${b.rgb[2]}) ${((i + 0.5) / n * 100).toFixed(2)}%`);
  track.style.background = `linear-gradient(to right, ${stops.join(", ")})`;
}

async function init() {
  const stage = document.getElementById("stage");
  const cv = document.getElementById("cv");
  const ctx = cv.getContext("2d");
  const selTrack = document.getElementById("selTrack");
  const selHandle = document.getElementById("selHandle");
  const selSwatch = document.getElementById("selSwatch");
  const pmIcon = document.getElementById("pmIcon");

  let products = [];
  try { products = await (await fetch("data/products.json")).json(); }
  catch (e) { stage.innerHTML = '<p style="padding:20px;font-size:12px">data/products.json missing.</p>'; return; }

  const sortedColor = colorSorted(products);
  const { list: evenList, dropped } = evenColorList(sortedColor);
  const buckets = buildBuckets(evenList);
  paintSpectrum(selTrack, buckets);
  const bucketIndexOf = new Map();
  buckets.forEach((b, bi) => { for (let k = 0; k < b.count; k++) bucketIndexOf.set(evenList[b.start + k].handle, bi); });

  // images: thumb now, hd on demand (detail only)
  const imgOf = new Map();
  products.forEach((p) => {
    const img = new Image(); img.decoding = "async"; img.src = p.thumb || p.img;
    img.onload = () => requestDraw();
    imgOf.set(p.handle, { img, hd: null, hq: p.thumbHq, hdReady: false });
  });
  // load + DECODE an HD image off the main thread; only flag it drawable once
  // fully decoded, so swapping it in never blocks a frame (no zoom stutter).
  function loadHD(o) {
    if (o.hd || !o.hq) return;
    const hd = new Image(); o.hd = hd; hd.src = o.hq;
    const ready = () => { o.hdReady = true; requestDraw(); };
    if (hd.decode) hd.decode().then(ready).catch(ready); else hd.onload = ready;
  }

  // ---- layout (fold the stream into 4 equal lanes; clean 2-col fields) ----
  let W, H, dpr, TILE, STEP, MAP_S, detPlaneH, mapPlaneH;
  const detPos = new Map(), mapPos = new Map();
  let bucketInfo = [];
  const totalRows = Math.ceil(evenList.length / DET_COLS);
  const colorStartRows = buckets.map((b) => Math.floor(b.start / DET_COLS));
  const foldSafe = (f) => { if (f <= 0 || f >= totalRows) return false; for (const s of colorStartRows) if (s < f && f < s + 4) return false; return true; };
  const nearestSafeFold = (target) => { const t = Math.round(target); if (foldSafe(t)) return t; for (let d = 1; d < totalRows; d++) { if (foldSafe(t - d)) return t - d; if (foldSafe(t + d)) return t + d; } return t; };
  const folds = []; for (let l = 1; l < LANES; l++) folds.push(nearestSafeFold(totalRows * l / LANES));
  folds.sort((a, b) => a - b);
  const foldStart = [0, ...folds], foldEnd = [...folds, totalRows];
  const laneOfRow = (r) => { for (let l = 0; l < LANES; l++) if (r < foldEnd[l]) return l; return LANES - 1; };

  function buildLayouts() {
    TILE = W / DET_COLS; STEP = TILE + ROW_GAP; MAP_S = DET_COLS / MAP_COLS;
    detPos.clear(); mapPos.clear(); bucketInfo = [];
    evenList.forEach((p, i) => {
      const sRow = Math.floor(i / DET_COLS), sCol = i % DET_COLS;
      detPos.set(p.handle, { x: sCol * TILE, y: sRow * STEP });
      const l = laneOfRow(sRow);
      mapPos.set(p.handle, { x: (l * DET_COLS + sCol) * TILE, y: (sRow - foldStart[l]) * STEP });
    });
    buckets.forEach((b, bi) => {
      const sRow = Math.floor(b.start / DET_COLS), l = laneOfRow(sRow);
      bucketInfo[bi] = { detailY: sRow * STEP, lane: l, mapX: l * DET_COLS * TILE, mapY: (sRow - foldStart[l]) * STEP };
    });
    detPlaneH = totalRows * STEP;
    mapPlaneH = Math.max.apply(null, foldEnd.map((e, l) => e - foldStart[l])) * STEP;
  }

  // ---- camera + render ----
  const TOPPAD = 54;
  const cam = { x: 0, y: TOPPAD, s: 0.25 };
  let posMode = "map", scrollY = 0, curBucket = 0, zoomed = false;
  const availH = () => H - TOPPAD;
  const contentMaxY = () => (posMode === "map" ? mapPlaneH * MAP_S : detPlaneH);
  const clampScroll = (y) => clamp(y, 0, Math.max(0, contentMaxY() - availH()));

  function resize() {
    W = stage.clientWidth; H = stage.clientHeight; dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    cv.style.width = W + "px"; cv.style.height = H + "px";
    buildLayouts();
    if (posMode === "map") camMap(curBucket, true); else { scrollY = clampScroll(scrollY); cam.y = TOPPAD - scrollY; }
    draw();
  }

  function drawContain(img, x, y, w, h) {
    const iw = img.naturalWidth, ih = img.naturalHeight; if (!iw || !ih) return;
    const sc = Math.min(w / iw, h / ih), dw = iw * sc, dh = ih * sc;
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const pos = posMode === "map" ? mapPos : detPos, tw = TILE * cam.s;
    for (const p of evenList) {
      if (dropped.has(p.handle)) continue;
      const P = pos.get(p.handle); if (!P) continue;
      const sx = P.x * cam.s + cam.x, sy = P.y * cam.s + cam.y;
      if (sx + tw <= 0 || sx >= W || sy + tw <= 0 || sy >= H) continue;     // cull off-screen
      const o = imgOf.get(p.handle);
      const img = (cam.s > 0.55 && o.hd && o.hdReady) ? o.hd
                : (o.img.complete && o.img.naturalWidth ? o.img : null);
      if (img) drawContain(img, sx, sy, tw, tw);
    }
  }
  let dirty = false;
  function requestDraw() { if (dirty) return; dirty = true; requestAnimationFrame(() => { dirty = false; draw(); }); }

  function camMap(bi, immediate) {
    posMode = "map"; cam.s = MAP_S; cam.x = 0;
    scrollY = clampScroll(bucketInfo[bi].mapY * MAP_S);
    cam.y = TOPPAD - scrollY;
    requestDraw();
  }

  // ---- camera animation (zoom) ----
  const easeZoom = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);   // in-out cubic
  let camRaf = null;
  function animateCam(target, dur, onDone) {
    const from = { x: cam.x, y: cam.y, s: cam.s }, start = performance.now();
    cancelAnimationFrame(camRaf);
    (function step(now) {
      const t = Math.min(1, (now - start) / dur), e = easeZoom(t);
      cam.x = lerp(from.x, target.x, e); cam.y = lerp(from.y, target.y, e); cam.s = lerp(from.s, target.s, e);
      draw();
      if (t < 1) camRaf = requestAnimationFrame(step);
      else { cam.x = target.x; cam.y = target.y; cam.s = target.s; draw(); if (onDone) onDone(); }
    })(performance.now());
  }
  function clampCamYMap(y) { return clamp(y, TOPPAD - Math.max(0, mapPlaneH * MAP_S - availH()), TOPPAD); }

  function zoomInTo(bi) {
    zoomed = true; curBucket = bi;
    preDecodeColor(bi);     // decode this colour's HD DURING the zoom, off-thread
    // phase 1: pure camera zoom on the MAP layout into bi's already-2-col field
    animateCam({ s: 1, x: -bucketInfo[bi].mapX, y: TOPPAD - bucketInfo[bi].mapY }, 820, () => {
      // apex: switch to the detail stream, field held in place -> invisible
      posMode = "detail"; scrollY = bucketInfo[bi].detailY;
      cam.s = 1; cam.x = 0; cam.y = TOPPAD - scrollY; draw();
      loadHDVisible();
    });
    tweenTo(colorPillLayout(), null, 820, false); setIcon();
  }
  function zoomOutToMap() {
    zoomed = false;
    const topRow = clamp(Math.round((TOPPAD - cam.y) / STEP), 0, totalRows - 1);
    const h = evenList[clamp(topRow * DET_COLS, 0, evenList.length - 1)].handle;
    const bi = bucketIndexOf.get(h); curBucket = bi;
    const dp = detPos.get(h), mp = mapPos.get(h);
    const Px = dp.x * cam.s + cam.x, Py = dp.y * cam.s + cam.y;
    posMode = "map"; cam.s = 1; cam.x = Px - mp.x; cam.y = Py - mp.y;     // hold item fixed
    animateCam({ s: MAP_S, x: 0, y: clampCamYMap(Py - mp.y * MAP_S) }, 820, () => { scrollY = TOPPAD - cam.y; });
    tweenTo(layoutFor("sel", "color"), null, 820, true); setIcon();
    fToHandle((bi + 0.5) / buckets.length); paintHandle(buckets[bi]);
  }

  // ---- scroll (custom, light inertia) ----
  let drag = null, inertiaRaf = null, hdTimer = null;
  const scheduleHD = () => { clearTimeout(hdTimer); hdTimer = setTimeout(loadHDVisible, 90); };
  function currentBucketFromScroll() {
    const row = (TOPPAD - cam.y + availH() / 2) / STEP;   // colour at viewport centre
    let bi = 0; for (let i = 0; i < buckets.length; i++) { if (bucketInfo[i].detailY / STEP <= row) bi = i; else break; }
    return bi;
  }
  function setScroll(y) {
    scrollY = clampScroll(y); cam.y = TOPPAD - scrollY; requestDraw(); scheduleHD();
    if (zoomed) { const bi = currentBucketFromScroll(); if (bi !== curBucket) { curBucket = bi; lastBucket = bi; paintHandle(buckets[bi]); } }  // swatch tracks the colour you scroll into
  }
  function onDown(e) {
    if (e.target.closest && e.target.closest(".island")) return;
    cancelAnimationFrame(inertiaRaf);
    drag = { y0: e.clientY, s0: scrollY, lastY: e.clientY, lastT: performance.now(), vy: 0 };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp); window.addEventListener("pointercancel", onUp);
  }
  function onMove(e) {
    if (!drag) return;
    setScroll(drag.s0 - (e.clientY - drag.y0));
    const now = performance.now(), dt = now - drag.lastT;
    if (dt > 0) { drag.vy = (e.clientY - drag.lastY) / dt; drag.lastY = e.clientY; drag.lastT = now; }
  }
  function onUp() {
    window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onUp);
    if (!drag) return; let v = drag.vy * 16; drag = null;
    (function glide() { if (Math.abs(v) < 0.4) return; const b = scrollY; setScroll(scrollY - v); if (scrollY === b) return; v *= 0.92; inertiaRaf = requestAnimationFrame(glide); })();
  }
  cv.addEventListener("pointerdown", onDown);
  cv.addEventListener("wheel", (e) => { e.preventDefault(); cancelAnimationFrame(inertiaRaf); setScroll(scrollY + e.deltaY); }, { passive: false });

  // ---- HD: detail viewport + a bit above/below, off-thread, redraw on load ----
  function loadHDVisible() {
    if (!zoomed) return;
    const tw = TILE * cam.s, M = availH() * 0.6, near = [];
    for (const p of evenList) {
      if (dropped.has(p.handle)) continue;
      const o = imgOf.get(p.handle); if (o.hd || !o.hq) continue;
      const P = detPos.get(p.handle), sy = P.y * cam.s + cam.y;
      if (sy + tw < -M || sy > H + M) continue;
      near.push({ o, d: Math.abs(sy + tw / 2 - H / 2) });
    }
    near.sort((a, b) => a.d - b.d);
    near.slice(0, 14).forEach(({ o }) => loadHD(o));
  }
  // start decoding a colour's first screenful the instant a zoom-in BEGINS, so
  // the HD is decoded (off-thread) by the time the zoom lands — no apex burst.
  function preDecodeColor(bi) {
    const b = buckets[bi], n = Math.min(b.count, 12);
    for (let k = 0; k < n; k++) loadHD(imgOf.get(evenList[b.start + k].handle));
  }

  // ================= glass bar (colour states only) =================
  const lgGlass = document.getElementById("lgGlass");
  const labFilter = document.getElementById("labFilter"), labColor = document.getElementById("labColor");
  const labFabric = document.getElementById("labFabric"), labType = document.getElementById("labType");
  const selSpectrum = document.getElementById("selSpectrum");
  const dividers = Array.from(document.querySelectorAll(".divider"));
  const labEl = { filter: labFilter, color: labColor, fabric: labFabric, type: labType };
  const W_F = 88, W_C = 84, SPW = 150, SP_X = 92, SWX = 22, HR = 12;
  // ONE circle (the swatch) for both states: it rides the slider track at the
  // selected colour in spectrum mode, and slides to the pill spot when zoomed —
  // so it's literally the same element morphing, never a crossfade.
  const fOf = (bi) => (bi + 0.5) / buckets.length;
  const swatchSelLeft = (f) => SP_X + HR + clamp01(f) * (SPW - 2 * HR);
  const spHidden = () => ({ left: SP_X, op: 0, w: 0 });
  const hide = (w, lw) => ({ left: (w - lw) / 2, op: 0 });
  const ICN = (w) => ({ left: w - 20, op: 1 });
  function colorPillLayout() { const w = 74; return { w, filter: hide(w, W_F), color: hide(w, W_C), fabric: hide(w, W_C), type: hide(w, W_C), spectrum: spHidden(), swatch: { left: SWX, op: 1, tap: true }, icon: { left: w - 22, op: 1 }, divOp: 0 }; }
  function layoutFor(st, cat) { const L = rawLayout(st, cat); if (!L.swatch) L.swatch = { left: SWX, op: 0 }; return L; }
  function rawLayout(st, cat) {
    const w = 288;
    return { w, color: { left: 8, op: 1 }, spectrum: { left: SP_X, op: 1, w: SPW }, filter: hide(w, W_F), fabric: hide(w, W_C), type: hide(w, W_C), swatch: { left: swatchSelLeft(fOf(curBucket)), op: 1, tap: false }, icon: ICN(w), divOp: 0 };
  }
  function noSpectrumLayout(cat) { const L = JSON.parse(JSON.stringify(layoutFor("sel", cat))); L.spectrum = { left: L.spectrum.left, op: 0, w: 0 }; return L; }
  function applyLayout(L, squash) {
    lgGlass.style.width = L.w + "px"; lgGlass.style.transform = `translate(-50%, -50%) scaleY(${squash})`;
    for (const k of ["filter", "color", "fabric", "type"]) { const el = labEl[k], it = L[k]; el.style.left = it.left + "px"; el.style.opacity = it.op; el.style.pointerEvents = it.op > 0.6 ? "auto" : "none"; }
    selSpectrum.style.left = L.spectrum.left + "px"; selSpectrum.style.width = (L.spectrum.w || 0) + "px"; selSpectrum.style.opacity = L.spectrum.op; selSpectrum.style.pointerEvents = L.spectrum.op > 0.6 ? "auto" : "none";
    selSwatch.style.left = L.swatch.left + "px"; selSwatch.style.opacity = L.swatch.op; selSwatch.style.pointerEvents = L.swatch.tap ? "auto" : "none";
    pmIcon.style.left = L.icon.left + "px"; pmIcon.style.opacity = L.icon.op;
    dividers.forEach((d) => (d.style.opacity = L.divOp));
  }
  const easeOutBack = (x) => { const c1 = 0.7, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);
  const clone = (L) => JSON.parse(JSON.stringify(L));
  let cur = clone(layoutFor("sel", "color")), menuRaf = null;
  function tweenTo(target, onDone, dur = 560, bounce = true) {
    const from = clone(cur), start = performance.now(); cancelAnimationFrame(menuRaf);
    (function step(now) {
      const p = Math.min(1, (now - start) / dur), es = easeOutCubic(p), ew = bounce ? easeOutBack(p) : es;
      cur.w = lerp(from.w, target.w, ew);
      for (const k of ["filter", "color", "fabric", "type", "spectrum", "swatch", "icon"]) { cur[k].left = lerp(from[k].left, target[k].left, es); cur[k].op = lerp(from[k].op, target[k].op, es); }
      cur.spectrum.w = lerp(from.spectrum.w || 0, target.spectrum.w || 0, es); cur.divOp = lerp(from.divOp, target.divOp, es);
      applyLayout(cur, bounce ? 1 - 0.05 * Math.sin(Math.PI * p) : 1);
      if (p < 1) menuRaf = requestAnimationFrame(step); else { cur = clone(target); applyLayout(cur, 1); if (onDone) onDone(); }
    })(performance.now());
  }
  function setIcon() { pmIcon.classList.toggle("x", zoomed); }
  const bindTap = (el, fn) => el.addEventListener("pointerdown", (e) => { e.preventDefault(); fn(e); });

  // ---- slider ----
  let dragging = false, lastF = 0, lastBucket = -1;
  selHandle.style.opacity = "0";   // retired: the swatch is the single morphing circle now
  const fToHandle = (f) => { cur.swatch.left = swatchSelLeft(f); selSwatch.style.left = cur.swatch.left + "px"; };
  const bucketAtF = (f) => Math.min(buckets.length - 1, Math.max(0, Math.floor(clamp01(f) * buckets.length)));
  const paintHandle = (b) => { const c = `rgb(${b.rgb[0]},${b.rgb[1]},${b.rgb[2]})`; selHandle.style.background = c; selSwatch.style.background = c; };
  function onSlide(clientX) {
    const r = selSpectrum.getBoundingClientRect();
    lastF = clamp01((clientX - r.left) / r.width); fToHandle(lastF);
    const bi = bucketAtF(lastF); paintHandle(buckets[bi]);
    if (bi !== lastBucket) {                       // instant jump — redraw destination THIS frame
      lastBucket = bi; curBucket = bi;
      if (zoomed) { posMode = "detail"; scrollY = bucketInfo[bi].detailY; cam.s = 1; cam.x = 0; cam.y = TOPPAD - scrollY; draw(); scheduleHD(); }
      else { camMap(bi); }
    }
  }
  function endSlide() {
    if (!dragging) return; dragging = false;
    const bi = bucketAtF(lastF); curBucket = bi; fToHandle(fOf(bi)); paintHandle(buckets[bi]);
    if (!zoomed) zoomInTo(bi); else { tweenTo(colorPillLayout(), null, 420, false); }
  }
  const onSpectrumMove = (e) => { if (dragging) onSlide(e.clientX); };
  function onSpectrumUp() { window.removeEventListener("pointermove", onSpectrumMove); window.removeEventListener("pointerup", onSpectrumUp); window.removeEventListener("pointercancel", onSpectrumUp); endSlide(); }
  selSpectrum.addEventListener("pointerdown", (e) => {
    if (cur.spectrum.op < 0.6) return;
    dragging = true; onSlide(e.clientX);
    window.addEventListener("pointermove", onSpectrumMove); window.addEventListener("pointerup", onSpectrumUp); window.addEventListener("pointercancel", onSpectrumUp);
    e.preventDefault();
  });
  bindTap(pmIcon, () => { if (zoomed) zoomOutToMap(); });
  bindTap(selSwatch, () => { if (!zoomed) return; tweenTo(layoutFor("sel", "color"), null, 440, true); fToHandle((lastBucket >= 0 ? lastBucket + 0.5 : 0.5) / buckets.length); if (lastBucket >= 0) paintHandle(buckets[lastBucket]); });

  // ---- background: warm the HTTP cache for EVERY HD image (download only, no
  //      decode/memory) so detail is sharp with no blur-then-load delay. 7.3MB
  //      total. Ordered outward from whatever colour you're on. ----
  let warmed = false;
  function warmHDCache() {
    if (warmed) return; warmed = true;
    const order = evenList.filter((p) => !dropped.has(p.handle) && p.thumbHq);
    // nearest-colour-first from the current bucket
    order.sort((a, b) => Math.abs(bucketIndexOf.get(a.handle) - curBucket) - Math.abs(bucketIndexOf.get(b.handle) - curBucket));
    let i = 0; const CONC = 6;
    const next = () => { if (i >= order.length) return; const u = order[i++].thumbHq; fetch(u, { cache: "force-cache" }).catch(() => {}).finally(next); };
    for (let k = 0; k < CONC; k++) next();
  }

  // ---- start: colour map ----
  window.addEventListener("resize", () => requestAnimationFrame(resize));
  resize();
  applyLayout(cur, 1); setIcon();
  fToHandle(0.5 / buckets.length); paintHandle(buckets[0]);
  camMap(0, true);
  setTimeout(warmHDCache, 400);     // start prefetch once the map is up
}

init();
