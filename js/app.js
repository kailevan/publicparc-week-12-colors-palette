// COLORS — Palette
// Shop (8-col mixed) -> "Filter" menu -> COLOUR becomes a zoomable map.
//
// The colour catalogue lives in ONE set of cells with TWO layouts:
//   MAP    — 8 cols = 4 lanes of 2; every colour is a clean 2-col field
//            (counts forced even). Dense, full-bleed, the zoomed-out "map".
//   DETAIL — one continuous 2-col stream of every colour in spectrum order.
//
// A single transform on the grid is the camera. Each colour's field is 2-col
// in BOTH layouts, so we zoom into a field cleanly (no reflow on screen), then
// swap MAP<->DETAIL at the zoom apex while the field fills the viewport — the
// rest of the catalogue rearranges OFF-SCREEN, invisibly. Zoom out snaps to the
// colour you scrolled to and rearranges the map around it before pulling back.

const COLS = 8;        // shop / fabric / type grid
const MAP_COLS = 8;    // map overview columns
const DET_COLS = 2;    // detail + field columns
const LANES = MAP_COLS / DET_COLS;   // 4

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, seed) {
  const rng = mulberry32(seed);
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const SAT_MIN = 0.13;
function colorRank(p) {
  if (p.s < SAT_MIN) return [1, -p.l, 0];
  return [0, p.h, -p.l];
}
function byRank(rankFn) {
  return (list) =>
    list.slice().sort((a, b) => {
      const ka = rankFn(a), kb = rankFn(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      const ca = colorRank(a), cb = colorRank(b);
      for (let i = 0; i < ca.length; i++) if (ca[i] !== cb[i]) return ca[i] - cb[i];
      return 0;
    });
}

const BUCKET_ORDER = ["white","ecru","beige","brown","khaki","green","yellow",
                      "red","pink","light_blue","blue","navy","grey","anthracite","black"];
const bIdx = (p) => { const i = BUCKET_ORDER.indexOf(p.bucket); return i < 0 ? 99 : i; };
function colorSorted(list) {
  return list.slice().sort((a, b) => (bIdx(a) - bIdx(b)) || (b.l - a.l));
}

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
function typeKey(p) { return (p.type || "zzz").toLowerCase(); }
const typeSorted = byRank((p) => [typeKey(p)]);

const cellMap = new Map();
const orders = {};
let mode = "mixed";
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

// ---- GRID-mode FLIP recluster (shop / fabric / type) ----
function flipTo(orderHandles, duration = 900) {
  const vh = window.innerHeight;
  const first = new Map();
  cellMap.forEach((c, h) => first.set(h, c.getBoundingClientRect()));
  orderHandles.forEach((h, i) => { const c = cellMap.get(h); if (c) c.style.order = i; });
  const anim = [];
  cellMap.forEach((c, h) => {
    const f = first.get(h), l = c.getBoundingClientRect();
    const seen = (f.bottom > -40 && f.top < vh + 40) || (l.bottom > -40 && l.top < vh + 40);
    c.style.transition = "none"; c.style.transitionDelay = "0ms";
    if (seen) { c.style.transform = `translate(${f.left - l.left}px, ${f.top - l.top}px)`; anim.push(c); }
    else c.style.transform = "";
  });
  requestAnimationFrame(() => requestAnimationFrame(() => {
    anim.forEach((c) => { c.style.transition = `transform ${duration}ms cubic-bezier(0.22,0.61,0.36,1)`; c.style.transform = ""; });
  }));
}

function buildBuckets(sortedProducts) {
  const out = [];
  sortedProducts.forEach((p, i) => {
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

// force each colour to an EVEN count (drop the last item if odd) so every
// colour is a clean 2-col rectangle that starts at column 0; then trim the tail
// (darkest blacks) so the total divides into LANES exactly equal-height lanes
// (zero white space) — and the equal fold lines land on clean colour starts.
function evenColorList(sorted) {
  const out = [], dropped = new Set();
  let i = 0;
  while (i < sorted.length) {
    const b = sorted[i].bucket; let j = i;
    while (j < sorted.length && sorted[j].bucket === b) j++;
    let slice = sorted.slice(i, j);
    if (slice.length % 2 === 1) { dropped.add(slice[slice.length - 1].handle); slice = slice.slice(0, -1); }
    out.push(...slice);
    i = j;
  }
  const mod = DET_COLS * LANES;                 // 8 -> rows divisible by 4 lanes
  while (out.length % mod !== 0) dropped.add(out.pop().handle);
  return { list: out, dropped };
}

async function init() {
  const grid = document.getElementById("grid");
  const stage = document.getElementById("stage");
  const selTrack = document.getElementById("selTrack");
  const selHandle = document.getElementById("selHandle");
  const selSwatch = document.getElementById("selSwatch");
  const pmIcon = document.getElementById("pmIcon");

  let products = [];
  try { products = await (await fetch("data/products.json")).json(); }
  catch (e) { grid.innerHTML = '<p style="padding:20px;font-size:12px">data/products.json missing.</p>'; return; }

  const setCols = (n) => document.documentElement.style.setProperty("--cols", n);
  setCols(COLS);

  const mixed = shuffle(products, 20260601);
  const sortedColor = colorSorted(products);
  const { list: evenList, dropped } = evenColorList(sortedColor);
  orders.mixed = mixed.map((p) => p.handle);
  orders.fabric = fabricSorted(products).map((p) => p.handle);
  orders.type = typeSorted(products).map((p) => p.handle);

  const buckets = buildBuckets(evenList);          // contiguous, all even counts
  paintSpectrum(selTrack, buckets);
  const TOPPAD = parseFloat(getComputedStyle(grid).paddingTop) || 54;

  // build cells (mixed order)
  const ROW_STEP = 45, ROW_GAP = 8;
  const frag = document.createDocumentFragment();
  const cells = [], imgs = [];
  mixed.forEach((p, i) => {
    const cell = document.createElement("div");
    cell.className = "cell"; cell.dataset.handle = p.handle;
    cell.style.order = i; cell.style.transitionDelay = Math.floor(i / COLS) * ROW_STEP + "ms";
    const img = document.createElement("img");
    img.loading = "eager"; img.decoding = "async"; img.alt = p.title;
    img.src = p.thumb || p.img;
    img.addEventListener("load", () => img.classList.add("loaded"));
    cell.appendChild(img); frag.appendChild(cell);
    cells.push(cell); imgs.push(img); cellMap.set(p.handle, cell);
  });
  grid.appendChild(frag);

  // ===================================================================
  //  LAYOUT ENGINE  (map + detail positions, in browse space, tile = VW/2)
  // ===================================================================
  let VW, TILE, MAP_S, detPos = new Map(), mapPos = new Map();
  let bucketInfo = [];     // per bucket: {detailY, mapX, mapY, lane}
  let detPlaneH, mapPlaneH, mapPlaneW;
  const totalRows = Math.ceil(evenList.length / DET_COLS);
  const bucketIndexOf = new Map();
  buckets.forEach((b, bi) => { for (let k = 0; k < b.count; k++) bucketIndexOf.set(evenList[b.start + k].handle, bi); });

  // MAP = the continuous detail stream FOLDED into 4 lanes of (near) equal
  // height, so the grid is a full rectangle with no white space. Fold lines are
  // snapped to "safe" rows: either a colour boundary, or >=4 rows deep into a
  // colour — so no colour's first 4 rows (its zoom-anchor screenful) ever
  // straddles a fold. A big colour may wrap across a lane like newspaper text,
  // which is fine: we only ever zoom on its clean top-of-field.
  const colorStartRows = buckets.map((b) => Math.floor(b.start / DET_COLS));
  function foldSafe(f) {
    if (f <= 0 || f >= totalRows) return false;
    for (const s of colorStartRows) if (s < f && f < s + 4) return false;
    return true;
  }
  function nearestSafeFold(target) {
    const t = Math.round(target);
    if (foldSafe(t)) return t;
    for (let d = 1; d < totalRows; d++) { if (foldSafe(t - d)) return t - d; if (foldSafe(t + d)) return t + d; }
    return t;
  }
  const folds = [];
  for (let l = 1; l < LANES; l++) folds.push(nearestSafeFold(totalRows * l / LANES));
  folds.sort((a, b) => a - b);
  const foldStart = [0, ...folds], foldEnd = [...folds, totalRows];
  const laneOfRow = (r) => { for (let l = 0; l < LANES; l++) if (r < foldEnd[l]) return l; return LANES - 1; };

  function buildLayouts() {
    VW = stage.clientWidth || 430;
    TILE = VW / DET_COLS;
    MAP_S = DET_COLS / MAP_COLS;          // 0.25
    const STEP = TILE + ROW_GAP;
    detPos = new Map(); mapPos = new Map(); bucketInfo = [];

    evenList.forEach((p, i) => {
      const sRow = Math.floor(i / DET_COLS), sCol = i % DET_COLS;
      detPos.set(p.handle, { x: sCol * TILE, y: sRow * STEP });
      const l = laneOfRow(sRow), rowInLane = sRow - foldStart[l];
      mapPos.set(p.handle, { x: (l * DET_COLS + sCol) * TILE, y: rowInLane * STEP });
    });
    buckets.forEach((b, bi) => {
      const sRow = Math.floor(b.start / DET_COLS), l = laneOfRow(sRow);
      bucketInfo[bi] = { detailY: sRow * STEP, lane: l, mapX: l * DET_COLS * TILE, mapY: (sRow - foldStart[l]) * STEP };
    });
    detPlaneH = totalRows * STEP;
    mapPlaneH = Math.max.apply(null, foldEnd.map((e, l) => e - foldStart[l])) * STEP;
    mapPlaneW = MAP_COLS * TILE;
  }
  buildLayouts();

  // ---- plane mode + cell positioning ----
  let planeOn = false, layout = "map";
  function applyPositions(which) {
    const pos = which === "map" ? mapPos : detPos;
    cellMap.forEach((c, h) => {
      if (dropped.has(h)) { c.style.display = "none"; return; }
      c.style.display = "";
      const p = pos.get(h);
      c.style.left = p.x + "px"; c.style.top = p.y + "px";
      c.style.width = TILE + "px"; c.style.height = TILE + "px";
    });
    grid.style.width = (which === "map" ? mapPlaneW : VW) + "px";
    grid.style.height = (which === "map" ? mapPlaneH : detPlaneH) + "px";
  }
  function enablePlaneMode(which) {
    planeOn = true; layout = which; document.body.dataset.plane = "1";
    cellMap.forEach((c) => (c.style.order = ""));
    applyPositions(which);
  }
  function disablePlaneMode() {
    planeOn = false; delete document.body.dataset.plane;
    grid.style.transform = ""; grid.style.transition = "";
    grid.style.width = ""; grid.style.height = "";
    cellMap.forEach((c) => {
      c.style.left = ""; c.style.top = ""; c.style.width = ""; c.style.height = "";
      c.style.display = ""; c.style.transform = ""; c.style.transition = "";
    });
  }

  // ---- the camera ----
  const ZOOM_EASE = "cubic-bezier(0.62,0.02,0.2,1)";
  const cam = { x: 0, y: 0, s: 0.25 };
  let scrollY = 0;
  function applyCam(animate, dur = 820, ease = ZOOM_EASE) {
    grid.style.transition = animate ? `transform ${dur}ms ${ease}` : "none";
    grid.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.s})`;
  }
  function availH() { return stage.clientHeight - TOPPAD; }
  function contentMaxY() { return layout === "map" ? mapPlaneH * MAP_S : detPlaneH; }
  function clampScroll(y) { return clamp(y, 0, Math.max(0, contentMaxY() - availH())); }
  function clampCamY(y) { return clamp(y, TOPPAD - Math.max(0, contentMaxY() - availH()), TOPPAD); }

  // map framing for a colour: lanes fill the width (camX 0), scroll to the field
  function camMap(bi, animate, dur) {
    cam.s = MAP_S; cam.x = 0;
    scrollY = clampScroll(bucketInfo[bi].mapY * MAP_S);
    cam.y = TOPPAD - scrollY;
    applyCam(animate, dur);
  }

  // ---- scroll (custom, light inertia) — works in whichever layout ----
  // The HD-image swap walks all 356 cells (getBoundingClientRect), so it must
  // NOT run per scroll frame — debounce it to fire only once scrolling pauses.
  let drag = null, inertiaRaf = null, upgTimer = null;
  function scheduleUpgrade() { clearTimeout(upgTimer); upgTimer = setTimeout(upgradeVisible, 140); }
  function setScroll(y) {
    scrollY = clampScroll(y);
    cam.y = TOPPAD - scrollY; applyCam(false);
    scheduleUpgrade();
  }
  function onDown(e) {
    if (!planeOn) return;
    if (e.target.closest && e.target.closest(".island")) return;
    cancelAnimationFrame(inertiaRaf);
    drag = { y0: e.clientY, s0: scrollY, lastY: e.clientY, lastT: performance.now(), vy: 0 };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }
  function onMove(e) {
    if (!drag) return;
    setScroll(drag.s0 - (e.clientY - drag.y0));
    const now = performance.now(), dt = now - drag.lastT;
    if (dt > 0) { drag.vy = (e.clientY - drag.lastY) / dt; drag.lastY = e.clientY; drag.lastT = now; }
  }
  function onUp() {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    if (!drag) return;
    let v = drag.vy * 16; drag = null;
    (function glide() {
      if (Math.abs(v) < 0.4) return;
      const before = scrollY; setScroll(scrollY - v);
      if (scrollY === before) return;
      v *= 0.92; inertiaRaf = requestAnimationFrame(glide);
    })();
  }
  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("wheel", (e) => {
    if (!planeOn) return;
    e.preventDefault(); cancelAnimationFrame(inertiaRaf); setScroll(scrollY + e.deltaY);
  }, { passive: false });

  function currentDetailBucket() {
    const STEP = TILE + ROW_GAP;
    const row = Math.max(0, (TOPPAD - cam.y) / STEP) + 0.5;
    let bi = 0;
    for (let i = 0; i < buckets.length; i++) {
      if (bucketInfo[i].detailY / STEP <= row) bi = i; else break;
    }
    return bi;
  }

  // ---- enter / leave the plane (constant-tile FLIP from the shop grid) ----
  function flipShopToMap(bi) {
    const vh = window.innerHeight;
    const first = new Map();
    cellMap.forEach((c, h) => first.set(h, c.getBoundingClientRect()));
    enablePlaneMode("map");
    camMap(bi, false);
    const anim = [];
    cellMap.forEach((c, h) => {
      if (dropped.has(h)) return;
      const f = first.get(h), l = c.getBoundingClientRect();
      const seen = (f.bottom > -80 && f.top < vh + 80) || (l.bottom > -80 && l.top < vh + 80);
      c.style.transition = "none";
      if (seen) { c.style.transform = `translate(${(f.left - l.left) / cam.s}px, ${(f.top - l.top) / cam.s}px)`; anim.push(c); }
      else c.style.transform = "";
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      anim.forEach((c) => { c.style.transition = "transform 820ms cubic-bezier(0.22,0.61,0.36,1)"; c.style.transform = ""; });
    }));
    later(upgradeVisible, 200);
  }
  function flipMapToShop(orderHandles) {
    const vh = window.innerHeight;
    const first = new Map();
    cellMap.forEach((c, h) => first.set(h, c.getBoundingClientRect()));
    if (orderHandles) orderHandles.forEach((h, i) => { const c = cellMap.get(h); if (c) c.style.order = i; });
    disablePlaneMode(); setCols(COLS); stage.scrollTop = 0;
    const anim = [];
    cellMap.forEach((c, h) => {
      const f = first.get(h), l = c.getBoundingClientRect();
      if (!l.width || !f.width) { c.style.transform = ""; return; }
      const seen = (f.bottom > -80 && f.top < vh + 80) || (l.bottom > -80 && l.top < vh + 80);
      c.style.transition = "none"; c.style.transitionDelay = "0ms";
      if (seen) { c.style.transformOrigin = "top left"; c.style.transform = `translate(${f.left - l.left}px, ${f.top - l.top}px) scale(${f.width / l.width})`; anim.push(c); }
      else c.style.transform = "";
    });
    requestAnimationFrame(() => requestAnimationFrame(() => {
      anim.forEach((c) => { c.style.transition = "transform 760ms cubic-bezier(0.22,0.61,0.36,1)"; c.style.transform = ""; });
    }));
  }

  // ---- the map zoom: in (map->detail) and out (detail->map) ----
  let curBucket = 0;
  function zoomInTo(bi) {
    curBucket = bi; zoomed = true;
    // phase 1 — pure camera zoom on the MAP layout into bi's (already 2-col) field
    cam.s = 1; cam.x = -bucketInfo[bi].mapX; cam.y = TOPPAD - bucketInfo[bi].mapY;
    applyCam(true, 860, ZOOM_EASE);
    tweenTo(colorPillLayout(), null, 860, false); setIcon();
    // phase 2 — at the apex, swap to DETAIL with bi's field held in place;
    // the rest of the catalogue snaps to the stream OFF-SCREEN.
    later(() => {
      applyPositions("detail"); layout = "detail";
      scrollY = bucketInfo[bi].detailY;
      cam.s = 1; cam.x = 0; cam.y = TOPPAD - scrollY; applyCam(false);
      later(upgradeVisible, 40);
    }, 870);
  }
  function zoomOutToMap() {
    zoomed = false;
    const STEP = TILE + ROW_GAP;
    // anchor on the item at the TOP-LEFT of the current viewport — we zoom out
    // organically from exactly where you are, not from the colour's top.
    const topRow = clamp(Math.round((TOPPAD - cam.y) / STEP), 0, totalRows - 1);
    const h = evenList[clamp(topRow * DET_COLS, 0, evenList.length - 1)].handle;
    const bi = bucketIndexOf.get(h); curBucket = bi;
    const dp = detPos.get(h), mp = mapPos.get(h);
    const Px = dp.x * cam.s + cam.x, Py = dp.y * cam.s + cam.y;   // its current screen point
    // swap to MAP layout holding that exact item fixed (within a colour the 2-col
    // arrangement is identical in both layouts -> invisible), still scale 1.
    applyPositions("map"); layout = "map";
    cam.s = 1; cam.x = Px - mp.x; cam.y = Py - mp.y; applyCam(false);
    // next frames: zoom out ABOUT that item — it shrinks and slides into its lane.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      cam.s = MAP_S; cam.x = 0; cam.y = clampCamY(Py - mp.y * MAP_S);
      scrollY = TOPPAD - cam.y;
      applyCam(true, 860, ZOOM_EASE);
    }));
    tweenTo(layoutFor("sel", "color"), null, 860, true); setIcon();
    fToHandle((bi + 0.5) / buckets.length); paintHandle(buckets[bi]);
    later(upgradeVisible, 900);
  }

  // preload gate, then reveal
  const decoded = (img) => img.complete && img.naturalWidth ? Promise.resolve() : img.decode().catch(() => {});
  await Promise.race([Promise.allSettled(imgs.map(decoded)), new Promise((res) => setTimeout(res, 2000))]);
  requestAnimationFrame(() => requestAnimationFrame(() => cells.forEach((c) => c.classList.add("in"))));

  // ---- liquid-glass menu (unchanged) ----
  const lgGlass = document.getElementById("lgGlass");
  const labFilter = document.getElementById("labFilter");
  const labColor = document.getElementById("labColor");
  const labFabric = document.getElementById("labFabric");
  const labType = document.getElementById("labType");
  const selSpectrum = document.getElementById("selSpectrum");
  const dividers = Array.from(document.querySelectorAll(".divider"));
  const labEl = { filter: labFilter, color: labColor, fabric: labFabric, type: labType };

  const W_F = 88, W_C = 84, SPW = 150;
  const divLeft = [88, 172, 256];
  dividers.forEach((d, k) => (d.style.left = divLeft[k] + "px"));
  const meas = document.createElement("span");
  meas.style.cssText = "position:absolute;left:-9999px;top:-9999px;visibility:hidden;white-space:nowrap;" +
    "font-family:'Cosmos Oracle',sans-serif;font-weight:700;font-size:12px;letter-spacing:0.02em;text-transform:uppercase;";
  document.body.appendChild(meas);
  const measure = (t) => { meas.textContent = t; return meas.getBoundingClientRect().width; };
  const wW = { fabric: measure("Fabric"), type: measure("Type") };
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { wW.fabric = measure("Fabric"); wW.type = measure("Type"); });

  const SP_X = 92;
  const spHidden = () => ({ left: SP_X, op: 0, w: 0 });
  function hide(w, lw) { return { left: (w - lw) / 2, op: 0 }; }
  const ICN = (w) => ({ left: w - 20, op: 1 });
  const SWX = 22;
  function colorPillLayout() {
    const w = 74;
    return { w, filter: hide(w, W_F), color: hide(w, W_C), fabric: hide(w, W_C), type: hide(w, W_C),
      spectrum: spHidden(), swatch: { left: SWX, op: 1 }, icon: { left: w - 22, op: 1 }, divOp: 0 };
  }
  function layoutFor(st, cat) { const L = rawLayout(st, cat); if (!L.swatch) L.swatch = { left: SWX, op: 0 }; return L; }
  function rawLayout(st, cat) {
    if (st === "closed") { const w = 110; return { w, filter: { left: 2, op: 1 }, color: hide(w, W_C), fabric: hide(w, W_C), type: hide(w, W_C), spectrum: spHidden(), icon: ICN(w), divOp: 0 }; }
    if (st === "open") { const w = 380; return { w, filter: { left: 0, op: 1 }, color: { left: 88, op: 1 }, fabric: { left: 172, op: 1 }, type: { left: 256, op: 1 }, spectrum: spHidden(), icon: ICN(w), divOp: 0.5 }; }
    if (cat === "color") { const w = 288; return { w, color: { left: 8, op: 1 }, spectrum: { left: SP_X, op: 1, w: SPW }, filter: hide(w, W_F), fabric: hide(w, W_C), type: hide(w, W_C), icon: ICN(w), divOp: 0 }; }
    const ww = wW[cat] || 50; const w = ww + 64;
    const L = { w, filter: hide(w, W_F), color: hide(w, W_C), fabric: hide(w, W_C), type: hide(w, W_C), spectrum: spHidden(), icon: { left: ww + 44, op: 1 }, divOp: 0 };
    L[cat] = { left: ww / 2 - 20, op: 1 }; return L;
  }
  function applyLayout(L, squash) {
    lgGlass.style.width = L.w + "px";
    lgGlass.style.transform = `translate(-50%, -50%) scaleY(${squash})`;
    for (const k of ["filter", "color", "fabric", "type"]) {
      const el = labEl[k], it = L[k];
      el.style.left = it.left + "px"; el.style.opacity = it.op; el.style.pointerEvents = it.op > 0.6 ? "auto" : "none";
    }
    selSpectrum.style.left = L.spectrum.left + "px"; selSpectrum.style.width = (L.spectrum.w || 0) + "px";
    selSpectrum.style.opacity = L.spectrum.op; selSpectrum.style.pointerEvents = L.spectrum.op > 0.6 ? "auto" : "none";
    selSwatch.style.left = L.swatch.left + "px"; selSwatch.style.opacity = L.swatch.op; selSwatch.style.pointerEvents = L.swatch.op > 0.6 ? "auto" : "none";
    pmIcon.style.left = L.icon.left + "px"; pmIcon.style.opacity = L.icon.op;
    dividers.forEach((d) => (d.style.opacity = L.divOp));
  }
  function easeOutBack(x) { const c1 = 0.7, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
  function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }
  const clone = (L) => JSON.parse(JSON.stringify(L));
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  let cur = clone(layoutFor("closed")), menuRaf = null;
  function tweenTo(target, onDone, dur = 560, bounce = true) {
    const from = clone(cur), start = performance.now();
    cancelAnimationFrame(menuRaf);
    function step(now) {
      const p = Math.min(1, (now - start) / dur), es = easeOutCubic(p), ew = bounce ? easeOutBack(p) : es;
      cur.w = lerp(from.w, target.w, ew);
      for (const k of ["filter", "color", "fabric", "type", "spectrum", "swatch", "icon"]) {
        cur[k].left = lerp(from[k].left, target[k].left, es); cur[k].op = lerp(from[k].op, target[k].op, es);
      }
      cur.spectrum.w = lerp(from.spectrum.w || 0, target.spectrum.w || 0, es);
      cur.divOp = lerp(from.divOp, target.divOp, es);
      applyLayout(cur, bounce ? 1 - 0.05 * Math.sin(Math.PI * p) : 1);
      if (p < 1) menuRaf = requestAnimationFrame(step);
      else { cur = clone(target); applyLayout(cur, 1); if (onDone) onDone(); }
    }
    menuRaf = requestAnimationFrame(step);
  }

  // ---- state machine ----
  let state = "closed", selCat = null, zoomed = false;
  let timers = [];
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  const later = (fn, ms) => { timers.push(setTimeout(fn, ms)); };
  const setBold = (cat) => { ["color", "fabric", "type"].forEach((c) => labEl[c].classList.toggle("selected", c === cat)); labFilter.classList.toggle("dimmed", !!cat); };
  function setIcon() { pmIcon.classList.toggle("x", state === "open" || (state === "sel" && zoomed)); }
  function morphTo(to, cat, onDone) { state = to; selCat = cat || null; setIcon(); tweenTo(layoutFor(to, cat), onDone); }
  applyLayout(cur, 1); setIcon();
  function noSpectrumLayout(cat) { const L = clone(layoutFor("sel", cat)); L.spectrum = { left: L.spectrum.left, op: 0, w: 0 }; return L; }

  function openMenu() { clearTimers(); morphTo("open"); }
  function closeMenu() {
    clearTimers(); setBold(null);
    if (planeOn) { mode = "mixed"; zoomed = false; morphTo("closed", null, () => flipMapToShop(orders.mixed)); }
    else if (mode !== "mixed") { mode = "mixed"; morphTo("closed", null, () => flipTo(orders.mixed)); }
    else morphTo("closed");
  }
  function backToCategories() {                 // reopen the category list — DON'T recluster
    clearTimers(); setBold(null);
    if (selCat === "color") tweenTo(noSpectrumLayout("color"), () => morphTo("open"), 240, false);
    else morphTo("open");
  }

  function selectCategory(cat) {
    clearTimers(); setBold(cat);
    const wasPlane = planeOn; mode = cat; state = "sel"; selCat = cat; setIcon();
    if (cat === "color") {
      tweenTo(layoutFor("sel", "color"), () => {
        zoomed = false; lastBucket = 0; curBucket = 0;
        if (wasPlane) { applyPositions("map"); layout = "map"; camMap(0, true, 700); }
        else flipShopToMap(0);
        setIcon();
      }, 440, true);
    } else {
      tweenTo(layoutFor("sel", cat), () => { zoomed = false; if (wasPlane) flipMapToShop(orders[cat]); else flipTo(orders[cat]); setIcon(); }, 440, true);
    }
  }
  function onCategory(cat) { if (state === "sel" && selCat === cat) { backToCategories(); return; } selectCategory(cat); }

  function bindTap(el, fn) { el.addEventListener("pointerdown", (e) => { e.preventDefault(); fn(e); }); }
  bindTap(labFilter, () => { if (state === "closed") openMenu(); else closeMenu(); });
  bindTap(pmIcon, () => {
    if (state === "closed") openMenu();
    else if (state === "open") closeMenu();
    else if (state === "sel") { if (zoomed) zoomOutToMap(); else backToCategories(); }
  });
  bindTap(labColor, () => onCategory("color"));
  bindTap(labFabric, () => onCategory("fabric"));
  bindTap(labType, () => onCategory("type"));

  // ---- colour slider ----
  let dragging = false, lastF = 0, lastBucket = -1;
  const HR = 12;
  function fToHandle(f) { const w = selSpectrum.clientWidth || SPW; selHandle.style.left = (HR + clamp01(f) * (w - 2 * HR)) + "px"; }
  function bucketAtF(f) { return Math.min(buckets.length - 1, Math.max(0, Math.floor(clamp01(f) * buckets.length))); }
  function paintHandle(b) { const c = `rgb(${b.rgb[0]},${b.rgb[1]},${b.rgb[2]})`; selHandle.style.background = c; selSwatch.style.background = c; }

  function onSlide(clientX) {
    const r = selSpectrum.getBoundingClientRect();
    lastF = clamp01((clientX - r.left) / r.width);
    fToHandle(lastF);
    const bi = bucketAtF(lastF); paintHandle(buckets[bi]);
    if (bi !== lastBucket) {                 // crossed into a new colour -> INSTANT jump
      lastBucket = bi; curBucket = bi;
      if (zoomed) {                          // detail: jump the stream (full-screen swap)
        scrollY = bucketInfo[bi].detailY; cam.y = TOPPAD - scrollY; cam.x = 0; cam.s = 1; applyCam(false);
        scheduleUpgrade();
      } else camMap(bi, false);              // map: frame the colour's field
    }
  }
  function endSlide() {
    if (!dragging) return; dragging = false;
    const bi = bucketAtF(lastF);
    fToHandle((bi + 0.5) / buckets.length); paintHandle(buckets[bi]);
    if (!zoomed) { zoomInTo(bi); }                          // map selector -> dive in
    else { tweenTo(colorPillLayout(), null, 420, false); later(upgradeVisible, 200); }  // detail re-scrub -> re-collapse pill
  }
  function onSpectrumMove(e) { if (dragging) onSlide(e.clientX); }
  function onSpectrumUp() {
    window.removeEventListener("pointermove", onSpectrumMove);
    window.removeEventListener("pointerup", onSpectrumUp);
    window.removeEventListener("pointercancel", onSpectrumUp);
    endSlide();
  }
  selSpectrum.addEventListener("pointerdown", (e) => {
    if (state !== "sel" || selCat !== "color") return;
    if (cur.spectrum.op < 0.6) return;
    dragging = true; onSlide(e.clientX);
    window.addEventListener("pointermove", onSpectrumMove);
    window.addEventListener("pointerup", onSpectrumUp);
    window.addEventListener("pointercancel", onSpectrumUp);
    e.preventDefault();
  });
  bindTap(selSwatch, () => {
    if (state !== "sel" || selCat !== "color" || !zoomed) return;
    tweenTo(layoutFor("sel", "color"), null, 440, true);
    fToHandle((lastBucket >= 0 ? lastBucket + 0.5 : 0.5) / buckets.length);
    if (lastBucket >= 0) paintHandle(buckets[lastBucket]);
  });

  // ---- HD images: a BACKGROUND prefetch queue, decoupled from scrolling ----
  // Scrolling never decodes images itself; instead, on every scroll-pause/zoom
  // we enqueue the cells within ~1 screen of the viewport (nearest-first) and a
  // pump decodes a few at a time off-thread, swapping src once ready. So scroll
  // stays smooth AND HD streams in fast, ahead of where you're heading.
  const prodByHandle = new Map(products.map((p) => [p.handle, p]));
  const hqDone = new Set();
  let upgQueue = [], pumping = false;
  function enqueueVisible() {
    // HD only matters in the 2-col detail view; the 8-col map stays on the light
    // thumbs (plenty at that size) so it loads less and scrolls lighter.
    if (!zoomed) { upgQueue = []; return; }
    const vh = window.innerHeight, vw = window.innerWidth, M = vh * 0.6;   // viewport + a bit above/below
    const near = [];
    cellMap.forEach((c, h) => {
      if (hqDone.has(h) || dropped.has(h)) return;
      const p = prodByHandle.get(h);
      if (!p || !p.thumbHq) return;
      const r = c.getBoundingClientRect();
      if (r.bottom < -M || r.top > vh + M || r.right < -60 || r.left > vw + 60) return;
      near.push({ h, d: Math.abs((r.top + r.bottom) / 2 - vh / 2) });
    });
    near.sort((a, b) => a.d - b.d);
    upgQueue = near.map((n) => n.h);
    pump();
  }
  function pump() {
    if (pumping) return;
    pumping = true;
    (function step() {
      const batch = upgQueue.splice(0, 3);
      if (!batch.length) { pumping = false; return; }
      batch.forEach((h) => {
        if (hqDone.has(h)) return;
        hqDone.add(h);
        const c = cellMap.get(h), p = prodByHandle.get(h), img = c && c.firstElementChild;
        if (!img || !p || !p.thumbHq) return;
        const hd = new Image();
        hd.onload = () => { img.src = p.thumbHq; };
        hd.src = p.thumbHq;
      });
      setTimeout(step, 70);
    })();
  }
  const upgradeVisible = enqueueVisible;   // alias kept for existing call sites

  let rzRaf = null;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(rzRaf);
    rzRaf = requestAnimationFrame(() => {
      const wasDetail = planeOn && zoomed;
      buildLayouts();
      if (planeOn) { applyPositions(layout); if (wasDetail) { cam.s = 1; cam.x = 0; cam.y = TOPPAD - clampScroll(scrollY); applyCam(false); } else camMap(Math.max(0, lastBucket), false); }
    });
  });
}

init();
