// COLORS — Palette  ·  CANVAS build (full app)
// The whole grid is rendered into ONE viewport-sized <canvas>: each frame we
// draw only the cells in view at the current camera. No GPU texture ceiling, so
// scroll + zoom stay smooth on-device, and instant slider jumps redraw the
// destination in the same frame. The liquid-glass bar is a DOM overlay on top.
//
// Modes (all the same cells, different positions):
//   mixed / fabric / type — 8-col grid (camera scale 0.25), vertical scroll
//   colour MAP            — 8-col = 4 lanes of 2 (scale 0.25)
//   colour DETAIL         — continuous 2-col stream (scale 1), zoomed in
// Recluster = interpolate cell positions; colour zoom = animate the camera.

const COLS = 8, MAP_COLS = 8, DET_COLS = 2, LANES = MAP_COLS / DET_COLS, ROW_GAP = 8;
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a, b, t) => a + (b - a) * t;

function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function shuffle(arr, seed) { const rng = mulberry32(seed); const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const SAT_MIN = 0.13;
function colorRank(p) { if (p.s < SAT_MIN) return [1, -p.l, 0]; return [0, p.h, -p.l]; }
function byRank(rankFn) {
  return (list) => list.slice().sort((a, b) => {
    const ka = rankFn(a), kb = rankFn(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    const ca = colorRank(a), cb = colorRank(b);
    for (let i = 0; i < ca.length; i++) if (ca[i] !== cb[i]) return ca[i] - cb[i];
    return 0;
  });
}
const BUCKET_ORDER = ["white","ecru","beige","brown","khaki","green","yellow","red","pink","light_blue","blue","navy","grey","anthracite","black"];
const bIdx = (p) => { const i = BUCKET_ORDER.indexOf(p.bucket); return i < 0 ? 99 : i; };
function colorSorted(list) { return list.slice().sort((a, b) => (bIdx(a) - bIdx(b)) || (b.l - a.l)); }
const FABRIC_ORDER = ["Knit", "Fleece", "Jersey", "Woven", "Denim", "Other"];
function fabricOf(p) {
  const s = (p.title + " " + p.type).toLowerCase();
  if (/denim|raw/.test(s)) return "Denim";
  if (/knit|crochet|balaclava|knitwear/.test(s)) return "Knit";
  if (/fleece|sherpa|sweat|hoodie|jogger|crewneck|tracksuit|hood/.test(s)) return "Fleece";
  if (/tee|t-shirt|longsleeve|jersey|shirt|top|mask/.test(s)) return "Jersey";
  if (/ripstop|cargo|waxed|canvas|nylon|twill|poplin|shell|puffer|bomber|jacket|pants|short|skirt/.test(s)) return "Woven";
  return "Other";
}
const fabricSorted = byRank((p) => [FABRIC_ORDER.indexOf(fabricOf(p))]);
const typeSorted = byRank((p) => [(p.type || "zzz").toLowerCase()]);

function evenColorList(sorted) {
  const out = [], dropped = new Set(); let i = 0;
  while (i < sorted.length) {
    const b = sorted[i].bucket; let j = i; while (j < sorted.length && sorted[j].bucket === b) j++;
    let slice = sorted.slice(i, j);
    if (slice.length % 2 === 1) { dropped.add(slice[slice.length - 1].handle); slice = slice.slice(0, -1); }
    out.push(...slice); i = j;
  }
  const mod = DET_COLS * LANES; while (out.length % mod !== 0) dropped.add(out.pop().handle);
  return { list: out, dropped };
}
function buildBuckets(sorted) {
  const out = [];
  sorted.forEach((p, i) => { const last = out[out.length - 1]; if (last && last.key === p.bucket) { last.count++; last._r += p.rgb[0]; last._g += p.rgb[1]; last._b += p.rgb[2]; } else out.push({ key: p.bucket, start: i, count: 1, _r: p.rgb[0], _g: p.rgb[1], _b: p.rgb[2] }); });
  out.forEach((b) => { b.rgb = [Math.round(b._r / b.count), Math.round(b._g / b.count), Math.round(b._b / b.count)]; });
  return out;
}
function paintSpectrum(track, buckets) {
  const n = buckets.length;
  track.style.background = `linear-gradient(to right, ${buckets.map((b, i) => `rgb(${b.rgb[0]},${b.rgb[1]},${b.rgb[2]}) ${((i + 0.5) / n * 100).toFixed(2)}%`).join(", ")})`;
}

async function init() {
  const stage = document.getElementById("stage");
  const cv = document.getElementById("cv");
  const ctx = cv.getContext("2d");
  const selTrack = document.getElementById("selTrack"), selHandle = document.getElementById("selHandle"), selSwatch = document.getElementById("selSwatch"), pmIcon = document.getElementById("pmIcon");

  let products = [];
  try { products = await (await fetch("data/products.json")).json(); }
  catch (e) { stage.innerHTML = '<p style="padding:20px;font-size:12px">data/products.json missing.</p>'; return; }

  const mixedOrder = shuffle(products, 20260601).map((p) => p.handle);
  const fabricOrder = fabricSorted(products).map((p) => p.handle);
  const typeOrder = typeSorted(products).map((p) => p.handle);
  const sortedColor = colorSorted(products);
  const { list: evenList, dropped } = evenColorList(sortedColor);
  const buckets = buildBuckets(evenList);
  paintSpectrum(selTrack, buckets);
  const bucketIndexOf = new Map();
  buckets.forEach((b, bi) => { for (let k = 0; k < b.count; k++) bucketIndexOf.set(evenList[b.start + k].handle, bi); });
  const totalRows = Math.ceil(evenList.length / DET_COLS);

  const imgOf = new Map();
  products.forEach((p) => {
    const img = new Image(); img.decoding = "async"; img.src = p.thumb || p.img; img.onload = () => requestDraw();
    imgOf.set(p.handle, { img, hd: null, hq: p.thumbHq, hdReady: false });
  });
  function loadHD(o) { if (o.hd || !o.hq) return; const hd = new Image(); o.hd = hd; hd.src = o.hq; const ready = () => { o.hdReady = true; requestDraw(); }; if (hd.decode) hd.decode().then(ready).catch(ready); else hd.onload = ready; }

  // ---- geometry ----
  let W, H, dpr, TILE, STEP, MAP_S, detPlaneH, mapPlaneH, gridPlaneH;
  const TOPPAD = 54;
  const posMaps = {};          // mode -> Map(handle -> {x,y})  (browse space)
  let bucketInfo = [];
  // fold the colour stream into 4 equal lanes (safe folds; clean fields)
  const colorStartRows = buckets.map((b) => Math.floor(b.start / DET_COLS));
  const foldSafe = (f) => { if (f <= 0 || f >= totalRows) return false; for (const s of colorStartRows) if (s < f && f < s + 4) return false; return true; };
  const nearestSafeFold = (t0) => { const t = Math.round(t0); if (foldSafe(t)) return t; for (let d = 1; d < totalRows; d++) { if (foldSafe(t - d)) return t - d; if (foldSafe(t + d)) return t + d; } return t; };
  const folds = []; for (let l = 1; l < LANES; l++) folds.push(nearestSafeFold(totalRows * l / LANES)); folds.sort((a, b) => a - b);
  const foldStart = [0, ...folds], foldEnd = [...folds, totalRows];
  const laneOfRow = (r) => { for (let l = 0; l < LANES; l++) if (r < foldEnd[l]) return l; return LANES - 1; };

  function gridPosMap(order) { const m = new Map(); order.forEach((h, i) => m.set(h, { x: (i % COLS) * TILE, y: Math.floor(i / COLS) * STEP })); return m; }
  function buildLayouts() {
    TILE = W / DET_COLS; STEP = TILE + ROW_GAP; MAP_S = DET_COLS / MAP_COLS;
    posMaps.mixed = gridPosMap(mixedOrder); posMaps.fabric = gridPosMap(fabricOrder); posMaps.type = gridPosMap(typeOrder);
    const map = new Map(), det = new Map(); bucketInfo = [];
    evenList.forEach((p, i) => {
      const sRow = Math.floor(i / DET_COLS), sCol = i % DET_COLS;
      det.set(p.handle, { x: sCol * TILE, y: sRow * STEP });
      const l = laneOfRow(sRow);
      map.set(p.handle, { x: (l * DET_COLS + sCol) * TILE, y: (sRow - foldStart[l]) * STEP });
    });
    buckets.forEach((b, bi) => { const sRow = Math.floor(b.start / DET_COLS), l = laneOfRow(sRow); bucketInfo[bi] = { detailY: sRow * STEP, lane: l, mapX: l * DET_COLS * TILE, mapY: (sRow - foldStart[l]) * STEP }; });
    posMaps.map = map; posMaps.detail = det;
    detPlaneH = totalRows * STEP;
    mapPlaneH = Math.max.apply(null, foldEnd.map((e, l) => e - foldStart[l])) * STEP;
    gridPlaneH = Math.ceil(products.length / COLS) * STEP;
  }

  // ---- camera + render ----
  const cam = { x: 0, y: TOPPAD, s: 0.25 };
  let posMode = "mixed", scrollY = 0, curBucket = 0, zoomed = false, zooming = false;
  let recl = null;             // {a, b, t} during a recluster
  const is8col = () => posMode !== "detail";
  const modeScale = () => (posMode === "detail" ? 1 : MAP_S);
  const planeH = () => (posMode === "detail" ? detPlaneH : posMode === "map" ? mapPlaneH : gridPlaneH);
  const availH = () => H - TOPPAD;
  const contentMaxY = () => planeH() * modeScale();
  const clampScroll = (y) => clamp(y, 0, Math.max(0, contentMaxY() - availH()));
  const clampCamYMap = (y) => clamp(y, TOPPAD - Math.max(0, mapPlaneH * MAP_S - availH()), TOPPAD);

  function resize() {
    W = stage.clientWidth; H = stage.clientHeight; dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + "px"; cv.style.height = H + "px";
    buildLayouts();
    if (posMode === "map") frameMap(curBucket); else if (posMode === "detail") { cam.s = 1; cam.x = 0; cam.y = TOPPAD - clampScroll(scrollY); } else { cam.s = MAP_S; cam.x = 0; cam.y = TOPPAD - clampScroll(scrollY); }
    draw();
  }

  function drawContain(img, x, y, w, h) { const iw = img.naturalWidth, ih = img.naturalHeight; if (!iw || !ih) return; const sc = Math.min(w / iw, h / ih), dw = iw * sc, dh = ih * sc; ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); }
  function draw() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const tw = TILE * cam.s, baseMap = posMaps[posMode];
    const drawOne = (p, P, alpha) => {
      const sx = P.x * cam.s + cam.x, sy = P.y * cam.s + cam.y;
      if (sx + tw <= 0 || sx >= W || sy + tw <= 0 || sy >= H) return;
      const o = imgOf.get(p.handle);
      const hdOk = o.hd && o.hdReady && (posMode === "detail" || (zooming && bucketIndexOf.get(p.handle) === curBucket));
      const img = hdOk ? o.hd : (o.img.complete && o.img.naturalWidth ? o.img : null);
      if (!img) return;
      if (alpha < 1) { ctx.globalAlpha = alpha; drawContain(img, sx, sy, tw, tw); ctx.globalAlpha = 1; } else drawContain(img, sx, sy, tw, tw);
    };
    if (recl) {
      const t = recl.t;
      for (const p of products) {
        const a = recl.a.get(p.handle), b = recl.b.get(p.handle);
        if (a && b) drawOne(p, { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }, 1);
        else if (a) drawOne(p, a, 1 - t);                 // leaving the set -> fade out
        else if (b) drawOne(p, b, t);                     // entering the set -> fade in
      }
    } else {
      for (const p of products) { const P = baseMap.get(p.handle); if (P) drawOne(p, P, 1); }
    }
  }
  let dirty = false;
  function requestDraw() { if (dirty) return; dirty = true; requestAnimationFrame(() => { dirty = false; draw(); }); }

  const easeZoom = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  let camRaf = null;
  function animateCam(target, dur, onDone) {
    const from = { x: cam.x, y: cam.y, s: cam.s }, start = performance.now(); cancelAnimationFrame(camRaf);
    (function step(now) {
      const t = Math.min(1, (now - start) / dur), e = easeZoom(t);
      cam.x = lerp(from.x, target.x, e); cam.y = lerp(from.y, target.y, e); cam.s = lerp(from.s, target.s, e); draw();
      if (t < 1) camRaf = requestAnimationFrame(step); else { cam.x = target.x; cam.y = target.y; cam.s = target.s; draw(); if (onDone) onDone(); }
    })(performance.now());
  }

  // snapshot the current on-screen plane position of every cell (for recluster from-state)
  function snapshotScreen() { const m = new Map(); const base = posMaps[posMode]; const t = recl ? recl.t : 0; for (const p of products) { let P; if (recl) { const a = recl.a.get(p.handle), b = recl.b.get(p.handle); P = a && b ? { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) } : (a || b); } else P = base.get(p.handle); if (P) m.set(p.handle, { x: P.x * cam.s + cam.x, y: P.y * cam.s + cam.y }); } return m; }

  // recluster between two 8-col modes (mixed/fabric/type/map), animating positions
  let reclRaf = null;
  function reclusterTo(mode, dur = 820, onDone) {
    const fromScreen = snapshotScreen();
    posMode = mode; cam.s = MAP_S; cam.x = 0; scrollY = 0; cam.y = TOPPAD;
    const toMap = posMaps[mode];
    // express the from-positions in the NEW plane space so a single transform draws both
    const a = new Map(), b = new Map();
    for (const p of products) {
      const fs = fromScreen.get(p.handle), tb = toMap.get(p.handle);
      if (tb) b.set(p.handle, tb);
      if (fs) a.set(p.handle, { x: (fs.x - cam.x) / cam.s, y: (fs.y - cam.y) / cam.s });
    }
    recl = { a, b, t: 0 };
    const start = performance.now(); cancelAnimationFrame(reclRaf);
    (function step(now) {
      recl.t = easeZoom(Math.min(1, (now - start) / dur)); draw();
      if (recl.t < 1) reclRaf = requestAnimationFrame(step); else { recl = null; draw(); if (onDone) onDone(); }
    })(performance.now());
  }

  function frameMap(bi) { posMode = "map"; cam.s = MAP_S; cam.x = 0; scrollY = clampScroll(bucketInfo[bi].mapY * MAP_S); cam.y = TOPPAD - scrollY; requestDraw(); }

  function preDecodeColor(bi) { const b = buckets[bi], n = Math.min(b.count, 16); for (let k = 0; k < n; k++) loadHD(imgOf.get(evenList[b.start + k].handle)); }
  function zoomInTo(bi) {
    zoomed = true; zooming = true; curBucket = bi; preDecodeColor(bi);
    animateCam({ s: 1, x: -bucketInfo[bi].mapX, y: TOPPAD - bucketInfo[bi].mapY }, 820, () => {
      posMode = "detail"; zooming = false; scrollY = bucketInfo[bi].detailY; cam.s = 1; cam.x = 0; cam.y = TOPPAD - scrollY; draw(); loadHDVisible();
    });
    tweenTo(colorPillLayout(), null, 820, false); setIcon();
  }
  function zoomOutToMap() {
    zoomed = false; zooming = true;
    const topRow = clamp(Math.round((TOPPAD - cam.y) / STEP), 0, totalRows - 1);
    const h = evenList[clamp(topRow * DET_COLS, 0, evenList.length - 1)].handle;
    const bi = bucketIndexOf.get(h); curBucket = bi;
    const dp = posMaps.detail.get(h), mp = posMaps.map.get(h);
    const Px = dp.x * cam.s + cam.x, Py = dp.y * cam.s + cam.y;
    posMode = "map"; cam.s = 1; cam.x = Px - mp.x; cam.y = Py - mp.y;
    animateCam({ s: MAP_S, x: 0, y: clampCamYMap(Py - mp.y * MAP_S) }, 820, () => { zooming = false; scrollY = TOPPAD - cam.y; });
    tweenTo(layoutFor("sel", "color"), null, 820, true); setIcon();
    fToHandle((bi + 0.5) / buckets.length); paintHandle(buckets[bi]);
  }

  // ---- scroll (custom inertia) ----
  let drag = null, inertiaRaf = null, hdTimer = null;
  const scheduleHD = () => { clearTimeout(hdTimer); hdTimer = setTimeout(loadHDVisible, 90); };
  function currentBucketFromScroll() { const row = (TOPPAD - cam.y + availH() / 2) / STEP; let bi = 0; for (let i = 0; i < buckets.length; i++) { if (bucketInfo[i].detailY / STEP <= row) bi = i; else break; } return bi; }
  function setScroll(y) {
    scrollY = clampScroll(y); cam.y = TOPPAD - scrollY; requestDraw(); scheduleHD();
    if (zoomed) { const bi = currentBucketFromScroll(); if (bi !== curBucket) { curBucket = bi; lastBucket = bi; paintHandle(buckets[bi]); } }
  }
  function onDown(e) {
    if (e.target.closest && e.target.closest(".island")) return;
    if (recl || zooming) return;
    cancelAnimationFrame(inertiaRaf);
    drag = { y0: e.clientY, s0: scrollY, lastY: e.clientY, lastT: performance.now(), vy: 0 };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp); window.addEventListener("pointercancel", onUp);
  }
  function onMove(e) { if (!drag) return; setScroll(drag.s0 - (e.clientY - drag.y0)); const now = performance.now(), dt = now - drag.lastT; if (dt > 0) { drag.vy = (e.clientY - drag.lastY) / dt; drag.lastY = e.clientY; drag.lastT = now; } }
  function onUp() {
    window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); window.removeEventListener("pointercancel", onUp);
    if (!drag) return; let v = drag.vy * 16; drag = null;
    (function glide() { if (Math.abs(v) < 0.4) return; const b = scrollY; setScroll(scrollY - v); if (scrollY === b) return; v *= 0.92; inertiaRaf = requestAnimationFrame(glide); })();
  }
  cv.addEventListener("pointerdown", onDown);
  cv.addEventListener("wheel", (e) => { if (recl || zooming) return; e.preventDefault(); cancelAnimationFrame(inertiaRaf); setScroll(scrollY + e.deltaY); }, { passive: false });

  function loadHDVisible() {
    if (!zoomed) return;
    const tw = TILE * cam.s, M = availH() * 0.6, near = [];
    for (const p of evenList) { if (dropped.has(p.handle)) continue; const o = imgOf.get(p.handle); if (o.hd || !o.hq) continue; const P = posMaps.detail.get(p.handle), sy = P.y * cam.s + cam.y; if (sy + tw < -M || sy > H + M) continue; near.push({ o, d: Math.abs(sy + tw / 2 - H / 2) }); }
    near.sort((a, b) => a.d - b.d); near.slice(0, 14).forEach(({ o }) => loadHD(o));
  }

  // ================= glass bar (full menu) =================
  const lgGlass = document.getElementById("lgGlass");
  const labFilter = document.getElementById("labFilter"), labColor = document.getElementById("labColor"), labFabric = document.getElementById("labFabric"), labType = document.getElementById("labType");
  const selSpectrum = document.getElementById("selSpectrum");
  const dividers = Array.from(document.querySelectorAll(".divider"));
  const labEl = { filter: labFilter, color: labColor, fabric: labFabric, type: labType };
  const W_F = 88, W_C = 84, SPW = 150, SP_X = 92, SWX = 22, HR = 12;
  const divLeft = [88, 172, 256]; dividers.forEach((d, k) => (d.style.left = divLeft[k] + "px"));
  selHandle.style.opacity = "0";   // the swatch is the single morphing circle
  const meas = document.createElement("span");
  meas.style.cssText = "position:absolute;left:-9999px;top:-9999px;visibility:hidden;white-space:nowrap;font-family:'Cosmos Oracle',sans-serif;font-weight:700;font-size:12px;letter-spacing:0.02em;text-transform:uppercase;";
  document.body.appendChild(meas);
  const measure = (t) => { meas.textContent = t; return meas.getBoundingClientRect().width; };
  const wW = { fabric: measure("Fabric"), type: measure("Type") };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { wW.fabric = measure("Fabric"); wW.type = measure("Type"); });

  const fOf = (bi) => (bi + 0.5) / buckets.length;
  const swatchSelLeft = (f) => SP_X + HR + clamp01(f) * (SPW - 2 * HR);
  const spHidden = () => ({ left: SP_X, op: 0, w: 0 });
  const hide = (w, lw) => ({ left: (w - lw) / 2, op: 0 });
  const ICN = (w) => ({ left: w - 20, op: 1 });
  function colorPillLayout() { const w = 74; return { w, filter: hide(w, W_F), color: hide(w, W_C), fabric: hide(w, W_C), type: hide(w, W_C), spectrum: spHidden(), swatch: { left: SWX, op: 1, tap: true }, icon: { left: w - 22, op: 1 }, divOp: 0 }; }
  function layoutFor(st, cat) { const L = rawLayout(st, cat); if (!L.swatch) L.swatch = { left: SWX, op: 0, tap: false }; return L; }
  function rawLayout(st, cat) {
    if (st === "closed") { const w = 110; return { w, filter: { left: 2, op: 1 }, color: hide(w, W_C), fabric: hide(w, W_C), type: hide(w, W_C), spectrum: spHidden(), icon: ICN(w), divOp: 0 }; }
    if (st === "open") { const w = 380; return { w, filter: { left: 0, op: 1 }, color: { left: 88, op: 1 }, fabric: { left: 172, op: 1 }, type: { left: 256, op: 1 }, spectrum: spHidden(), icon: ICN(w), divOp: 0.5 }; }
    if (cat === "color") { const w = 288; return { w, color: { left: 8, op: 1 }, spectrum: { left: SP_X, op: 1, w: SPW }, filter: hide(w, W_F), fabric: hide(w, W_C), type: hide(w, W_C), swatch: { left: swatchSelLeft(fOf(curBucket)), op: 1, tap: false }, icon: ICN(w), divOp: 0 }; }
    const ww = wW[cat] || 50, w = ww + 64;
    const L = { w, filter: hide(w, W_F), color: hide(w, W_C), fabric: hide(w, W_C), type: hide(w, W_C), spectrum: spHidden(), icon: { left: ww + 44, op: 1 }, divOp: 0 };
    L[cat] = { left: ww / 2 - 20, op: 1 }; return L;
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
  let cur = clone(layoutFor("closed")), menuRaf = null;
  function tweenTo(target, onDone, dur = 560, bounce = true) {
    const from = clone(cur), start = performance.now(); cancelAnimationFrame(menuRaf);
    (function step(now) {
      const p = Math.min(1, (now - start) / dur), es = easeOutCubic(p), ew = bounce ? easeOutBack(p) : es;
      cur.w = lerp(from.w, target.w, ew);
      for (const k of ["filter", "color", "fabric", "type", "spectrum", "swatch", "icon"]) { cur[k].left = lerp(from[k].left, target[k].left, es); cur[k].op = lerp(from[k].op, target[k].op, es); }
      cur.spectrum.w = lerp(from.spectrum.w || 0, target.spectrum.w || 0, es); cur.divOp = lerp(from.divOp, target.divOp, es);
      if (target.color.op < from.color.op) cur.color.op = lerp(from.color.op, target.color.op, easeOutCubic(Math.min(1, p * 2.2)));
      applyLayout(cur, bounce ? 1 - 0.05 * Math.sin(Math.PI * p) : 1);
      if (p < 1) menuRaf = requestAnimationFrame(step); else { cur = clone(target); applyLayout(cur, 1); if (onDone) onDone(); }
    })(performance.now());
  }

  // ---- state machine ----
  let state = "closed", selCat = null, timers = [];
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  const later = (fn, ms) => { timers.push(setTimeout(fn, ms)); };
  const setBold = (cat) => { ["color", "fabric", "type"].forEach((c) => labEl[c].classList.toggle("selected", c === cat)); labFilter.classList.toggle("dimmed", !!cat); };
  function setIcon() { pmIcon.classList.toggle("x", state === "open" || (state === "sel" && zoomed)); }
  function morphTo(to, cat, onDone) { state = to; selCat = cat || null; setIcon(); tweenTo(layoutFor(to, cat), onDone); }
  const fToHandle = (f) => { cur.swatch.left = swatchSelLeft(f); selSwatch.style.left = cur.swatch.left + "px"; };

  function openMenu() { clearTimers(); morphTo("open"); }
  function closeMenu() {
    clearTimers(); setBold(null);
    if (posMode !== "mixed") { zoomed = false; morphTo("closed", null, () => reclusterTo("mixed")); }
    else morphTo("closed");
  }
  function backToCategories() { clearTimers(); setBold(null); if (selCat === "color") tweenTo(noSpectrumLayout("color"), () => morphTo("open"), 240, false); else morphTo("open"); }
  function selectCategory(cat) {
    clearTimers(); setBold(cat); state = "sel"; selCat = cat; setIcon();
    if (cat === "color") tweenTo(layoutFor("sel", "color"), () => { zoomed = false; lastBucket = 0; curBucket = 0; if (posMode === "map") frameMap(0); else reclusterTo("map"); }, 440, true);
    else tweenTo(layoutFor("sel", cat), () => { zoomed = false; reclusterTo(cat); }, 440, true);
  }
  function onCategory(cat) { if (state === "sel" && selCat === cat) { backToCategories(); return; } selectCategory(cat); }
  const bindTap = (el, fn) => el.addEventListener("pointerdown", (e) => { e.preventDefault(); fn(e); });
  bindTap(labFilter, () => { if (state === "closed") openMenu(); else closeMenu(); });
  bindTap(pmIcon, () => { if (state === "closed") openMenu(); else if (state === "open") closeMenu(); else if (state === "sel") { if (zoomed) zoomOutToMap(); else backToCategories(); } });
  bindTap(labColor, () => onCategory("color"));
  bindTap(labFabric, () => onCategory("fabric"));
  bindTap(labType, () => onCategory("type"));

  // ---- slider ----
  let dragging = false, lastF = 0, lastBucket = -1;
  const bucketAtF = (f) => Math.min(buckets.length - 1, Math.max(0, Math.floor(clamp01(f) * buckets.length)));
  const paintHandle = (b) => { const c = `rgb(${b.rgb[0]},${b.rgb[1]},${b.rgb[2]})`; selHandle.style.background = c; selSwatch.style.background = c; };
  function onSlide(clientX) {
    const r = selSpectrum.getBoundingClientRect(); lastF = clamp01((clientX - r.left) / r.width);
    fToHandle(lastF); const bi = bucketAtF(lastF); paintHandle(buckets[bi]);
    if (bi !== lastBucket) {
      lastBucket = bi; curBucket = bi;
      if (zoomed) { posMode = "detail"; scrollY = bucketInfo[bi].detailY; cam.s = 1; cam.x = 0; cam.y = TOPPAD - scrollY; draw(); scheduleHD(); }
      else frameMap(bi);
    }
  }
  function endSlide() { if (!dragging) return; dragging = false; const bi = bucketAtF(lastF); curBucket = bi; fToHandle(fOf(bi)); paintHandle(buckets[bi]); if (!zoomed) zoomInTo(bi); else tweenTo(colorPillLayout(), null, 420, false); }
  const onSpectrumMove = (e) => { if (dragging) onSlide(e.clientX); };
  function onSpectrumUp() { window.removeEventListener("pointermove", onSpectrumMove); window.removeEventListener("pointerup", onSpectrumUp); window.removeEventListener("pointercancel", onSpectrumUp); endSlide(); }
  selSpectrum.addEventListener("pointerdown", (e) => { if (state !== "sel" || selCat !== "color" || cur.spectrum.op < 0.6) return; dragging = true; onSlide(e.clientX); window.addEventListener("pointermove", onSpectrumMove); window.addEventListener("pointerup", onSpectrumUp); window.addEventListener("pointercancel", onSpectrumUp); e.preventDefault(); });
  bindTap(selSwatch, () => { if (state !== "sel" || selCat !== "color" || !zoomed) return; tweenTo(layoutFor("sel", "color"), null, 440, true); fToHandle(fOf(lastBucket >= 0 ? lastBucket : 0)); if (lastBucket >= 0) paintHandle(buckets[lastBucket]); });

  // ---- HD cache warm (download all, no decode) ----
  let warmed = false;
  function warmHDCache() {
    if (warmed) return; warmed = true;
    const order = evenList.filter((p) => !dropped.has(p.handle) && p.thumbHq);
    order.sort((a, b) => Math.abs(bucketIndexOf.get(a.handle) - curBucket) - Math.abs(bucketIndexOf.get(b.handle) - curBucket));
    let i = 0; const next = () => { if (i >= order.length) return; const u = order[i++].thumbHq; fetch(u, { cache: "force-cache" }).catch(() => {}).finally(next); };
    for (let k = 0; k < 6; k++) next();
  }

  // ---- start: the shop (mixed grid), bar closed ----
  window.addEventListener("resize", () => requestAnimationFrame(resize));
  resize();
  applyLayout(cur, 1); setIcon();
  setTimeout(warmHDCache, 600);
}

init();
