// COLORS — Palette
// Mixed grid -> gooey "Filter" menu -> recluster (color / fabric / type).

const COLS = 8;        // dense overview grid
const ZOOM_COLS = 3;   // snapped-in colour-section view

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

// ---- sort keys ----
const SAT_MIN = 0.13;
function colorRank(p) {
  if (p.s < SAT_MIN) return [1, -p.l, 0];   // neutrals after chromatic, light->dark
  return [0, p.h, -p.l];                     // chromatic by hue, then light->dark
}
function byRank(rankFn) {
  return (list) =>
    list.slice().sort((a, b) => {
      const ka = rankFn(a), kb = rankFn(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      // tiebreak: color so groups stay tidy
      const ca = colorRank(a), cb = colorRank(b);
      for (let i = 0; i < ca.length; i++) if (ca[i] !== cb[i]) return ca[i] - cb[i];
      return 0;
    });
}

const colorSorted = byRank(colorRank);

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

// state
const cellMap = new Map();
const orders = {};          // mixed/color/fabric/type -> [handles]
let mode = "mixed";
let busy = false;

// ---- FLIP recluster ----
// Only on-screen cells get an animated transition; off-screen ones jump
// instantly (invisible anyway). Animating all 371 layers at once starved the
// glass-bar morph's frames and made it stutter — this keeps it buttery.
function flipTo(orderHandles, duration = 900) {
  const vh = window.innerHeight;
  const first = new Map();
  cellMap.forEach((c, h) => first.set(h, c.getBoundingClientRect()));

  orderHandles.forEach((h, i) => {
    const c = cellMap.get(h);
    if (c) c.style.order = i;
  });

  const anim = [];
  cellMap.forEach((c, h) => {
    const f = first.get(h);
    const l = c.getBoundingClientRect();
    const seen = (f.bottom > -40 && f.top < vh + 40) || (l.bottom > -40 && l.top < vh + 40);
    c.style.transition = "none";
    c.style.transitionDelay = "0ms";
    if (seen) {
      c.style.transform = `translate(${f.left - l.left}px, ${f.top - l.top}px)`;
      anim.push(c);
    } else {
      c.style.transform = "";   // snap off-screen cells with no animation
    }
  });

  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      anim.forEach((c) => {
        c.style.transition = `transform ${duration}ms cubic-bezier(0.22,0.61,0.36,1)`;
        c.style.transform = "";
      });
    })
  );
}

function paintSpectrum(track, sortedProducts) {
  const stops = [];
  const N = 26;
  for (let i = 0; i < N; i++) {
    const p = sortedProducts[Math.floor((i / (N - 1)) * (sortedProducts.length - 1))];
    const [r, g, b] = p.rgb;
    stops.push(`rgb(${r},${g},${b}) ${((i / (N - 1)) * 100).toFixed(1)}%`);
  }
  track.style.background = `linear-gradient(to right, ${stops.join(", ")})`;
}

async function init() {
  const grid = document.getElementById("grid");
  const stage = document.getElementById("stage");
  const countEl = document.getElementById("count");
  const island = document.getElementById("island");
  const selTrack = document.getElementById("selTrack");
  const selHandle = document.getElementById("selHandle");

  let products = [];
  try {
    products = await (await fetch("data/products.json")).json();
  } catch (e) {
    grid.innerHTML = '<p style="padding:20px;font-size:12px">data/products.json missing.</p>';
    return;
  }

  let cols = COLS;
  const setCols = (n) => { cols = n; document.documentElement.style.setProperty("--cols", n); };
  setCols(COLS);
  countEl.textContent = products.length + " pieces";

  const mixed = shuffle(products, 20260601);
  const sortedColor = colorSorted(products);
  orders.mixed = mixed.map((p) => p.handle);
  orders.color = sortedColor.map((p) => p.handle);
  orders.fabric = fabricSorted(products).map((p) => p.handle);
  orders.type = typeSorted(products).map((p) => p.handle);
  paintSpectrum(selTrack, sortedColor);

  // build grid (mixed)
  const ROW_STEP = 45;
  const frag = document.createDocumentFragment();
  const cells = [];
  const imgs = [];
  mixed.forEach((p, i) => {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.handle = p.handle;
    cell.style.order = i;
    cell.style.transitionDelay = Math.floor(i / COLS) * ROW_STEP + "ms";

    const img = document.createElement("img");
    img.loading = "eager";
    img.decoding = "async";
    img.alt = p.title;
    img.src = p.thumb || p.img;
    img.addEventListener("load", () => img.classList.add("loaded"));

    cell.appendChild(img);
    frag.appendChild(cell);
    cells.push(cell);
    imgs.push(img);
    cellMap.set(p.handle, cell);
  });
  grid.appendChild(frag);

  // preload gate, then row-by-row reveal
  const decoded = (img) =>
    img.complete && img.naturalWidth ? Promise.resolve() : img.decode().catch(() => {});
  await Promise.race([
    Promise.allSettled(imgs.map(decoded)),
    new Promise((res) => setTimeout(res, 2000)),
  ]);
  requestAnimationFrame(() =>
    requestAnimationFrame(() => cells.forEach((c) => c.classList.add("in")))
  );

  // ---- liquid-glass menu: ONE morphing glass button ----
  // States: closed ("Filter")  <->  open (Filter|Color|Fabric|Type)
  //         <->  sel (<category> + its embedded selector).
  // The same glass bar morphs between layouts; nothing fades-and-swaps.
  const lgGlass = document.getElementById("lgGlass");
  const labFilter = document.getElementById("labFilter");
  const labColor  = document.getElementById("labColor");
  const labFabric = document.getElementById("labFabric");
  const labType   = document.getElementById("labType");
  const selSpectrum = document.getElementById("selSpectrum");
  const dividers = Array.from(document.querySelectorAll(".divider"));
  const labEl = { filter: labFilter, color: labColor, fabric: labFabric, type: labType };

  const W_F = 88, W_C = 84, SPW = 150;     // fixed element widths (match CSS)
  const divLeft = [88, 172, 256];
  dividers.forEach((d, k) => (d.style.left = divLeft[k] + "px"));

  // a layout = target width + each element's {left, op}; spectrum also {w} (unfurl)
  const SP_X = 92;
  const spHidden = () => ({ left: SP_X, op: 0, w: 0 });
  function hide(w, lw) { return { left: (w - lw) / 2, op: 0 }; }
  function layoutFor(st, cat) {
    if (st === "closed") {
      const w = 88;
      return { w, filter: { left: 0, op: 1 },
        color: hide(w, W_C), fabric: hide(w, W_C), type: hide(w, W_C),
        spectrum: spHidden(), divOp: 0 };
    }
    if (st === "open") {
      const w = 340;
      return { w, filter: { left: 0, op: 1 },
        color: { left: 88, op: 1 }, fabric: { left: 172, op: 1 }, type: { left: 256, op: 1 },
        spectrum: spHidden(), divOp: 0.5 };
    }
    // sel
    if (cat === "color") {
      const w = 250;
      return { w, color: { left: 8, op: 1 }, spectrum: { left: SP_X, op: 1, w: SPW },
        filter: hide(w, W_F), fabric: hide(w, W_C), type: hide(w, W_C), divOp: 0 };
    }
    const w = 104;  // fabric / type (no selector yet) — just the label pill
    const L = { w, filter: hide(w, W_F), color: hide(w, W_C),
      fabric: hide(w, W_C), type: hide(w, W_C), spectrum: spHidden(), divOp: 0 };
    L[cat] = { left: (w - W_C) / 2, op: 1 };
    return L;
  }

  function applyLayout(L, squash) {
    lgGlass.style.width = L.w + "px";
    lgGlass.style.transform = `translate(-50%, -50%) scaleY(${squash})`;
    for (const k of ["filter", "color", "fabric", "type"]) {
      const el = labEl[k], it = L[k];
      el.style.left = it.left + "px";
      el.style.opacity = it.op;
      el.style.pointerEvents = it.op > 0.6 ? "auto" : "none";
    }
    selSpectrum.style.left = L.spectrum.left + "px";
    selSpectrum.style.width = (L.spectrum.w || 0) + "px";
    selSpectrum.style.opacity = L.spectrum.op;
    selSpectrum.style.pointerEvents = L.spectrum.op > 0.6 ? "auto" : "none";
    dividers.forEach((d) => (d.style.opacity = L.divOp));
  }

  function easeOutBack(x) { const c1 = 0.7, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
  function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }
  const clone = (L) => JSON.parse(JSON.stringify(L));
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

  let cur = clone(layoutFor("closed"));
  let menuRaf = null;
  function tweenTo(target) {
    const from = clone(cur);
    const dur = 560;
    const start = performance.now();
    cancelAnimationFrame(menuRaf);
    function step(now) {
      const p = Math.min(1, (now - start) / dur);
      const eb = easeOutBack(p);    // gentle elastic overshoot — glass width only
      const es = easeOutCubic(p);   // clean settle — labels, opacity, selector (no overshoot/snap)
      cur.w = lerp(from.w, target.w, eb);
      for (const k of ["filter", "color", "fabric", "type", "spectrum"]) {
        cur[k].left = lerp(from[k].left, target[k].left, es);
        cur[k].op = lerp(from[k].op, target[k].op, es);
      }
      cur.spectrum.w = lerp(from.spectrum.w || 0, target.spectrum.w || 0, es);
      cur.divOp = lerp(from.divOp, target.divOp, es);
      const squash = 1 - 0.05 * Math.sin(Math.PI * p);   // surface-tension pinch mid-morph
      applyLayout(cur, squash);
      if (p < 1) menuRaf = requestAnimationFrame(step);
      else { cur = clone(target); applyLayout(cur, 1); }
    }
    menuRaf = requestAnimationFrame(step);
  }

  // ---- state machine ----
  // Every interaction is fully interruptible: each handler cancels the pending
  // scheduled steps and re-targets the (interruptible) tween from wherever the
  // bar currently is. No "busy" lock -> rapid taps never desync or look buggy.
  let state = "closed", selCat = null, zoomed = false;
  let timers = [];
  const clearTimers = () => { timers.forEach(clearTimeout); timers = []; };
  const later = (fn, ms) => { timers.push(setTimeout(fn, ms)); };
  const setBold = (cat) =>
    ["color", "fabric", "type"].forEach((c) => labEl[c].classList.toggle("selected", c === cat));
  function morphTo(to, cat) { state = to; selCat = cat || null; tweenTo(layoutFor(to, cat)); }

  applyLayout(cur, 1); // initial closed state

  const MORPH = 600;   // bar-morph duration window
  const BOLD = 280;    // bold-in-place beat before the bar morphs on select

  // FILTER: closed -> open list; open/sel -> closed (and reset grid to mixed)
  labFilter.addEventListener("click", () => {
    clearTimers();
    if (state === "closed") { morphTo("open"); return; }
    setBold(null);
    morphTo("closed");
    if (mode !== "mixed" || zoomed) {
      mode = "mixed";
      later(() => unzoom(orders.mixed), Math.round(MORPH * 0.55));
    }
  });

  function selectCategory(cat) {
    clearTimers();
    setBold(cat);                                   // 1) bold in place immediately
    const wasZoomed = zoomed;
    mode = cat;
    later(() => morphTo("sel", cat), BOLD);         // 2) then the bar morphs
    later(() => {                                   // 3) then recluster the grid
      if (wasZoomed) { flipZoom(COLS, orders[cat]); zoomed = false; }
      else flipTo(orders[cat]);
    }, BOLD + 300);
  }

  function onCategory(cat) {
    if (state === "sel" && selCat === cat) {        // tap the active category -> back to list
      clearTimers();
      setBold(null);
      morphTo("open");
      later(() => unzoom(), Math.round(MORPH * 0.55));   // un-zoom but keep this clustering
      return;
    }
    selectCategory(cat);                            // from open, or switch category while selected
  }
  labColor.addEventListener("click", () => onCategory("color"));
  labFabric.addEventListener("click", () => onCategory("fabric"));
  labType.addEventListener("click", () => onCategory("type"));

  // ---- zoom + colour slider ----------------------------------------------
  // FLIP that also scales each cell, so a column-count change animates; can
  // simultaneously re-order. Viewport-limited so it stays cheap on the phone.
  function flipZoom(newCols, orderHandles, dur = 700) {
    const vh = window.innerHeight;
    const first = new Map();
    cellMap.forEach((c, h) => first.set(h, c.getBoundingClientRect()));
    if (orderHandles) orderHandles.forEach((h, i) => { const c = cellMap.get(h); if (c) c.style.order = i; });
    setCols(newCols);
    const anim = [];
    cellMap.forEach((c, h) => {
      const f = first.get(h), l = c.getBoundingClientRect();
      if (!l.width || !f.width) return;
      const seen = (f.bottom > -40 && f.top < vh + 40) || (l.bottom > -40 && l.top < vh + 40);
      c.style.transition = "none";
      c.style.transitionDelay = "0ms";
      c.style.transformOrigin = "top left";
      if (seen) {
        c.style.transform =
          `translate(${f.left - l.left}px, ${f.top - l.top}px) scale(${f.width / l.width}, ${f.height / l.height})`;
        anim.push(c);
      } else {
        c.style.transform = "";
      }
    });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        anim.forEach((c) => {
          c.style.transition = `transform ${dur}ms cubic-bezier(0.22,0.61,0.36,1)`;
          c.style.transform = "";
        });
      })
    );
    if (newCols === ZOOM_COLS) later(upgradeVisible, 80);   // pull in HD images for the zoom
  }

  function unzoom(orderHandles) {     // back to the overview grid; optional new order
    if (zoomed) { flipZoom(COLS, orderHandles); zoomed = false; }
    else if (orderHandles) flipTo(orderHandles);
  }

  // ---- on-demand HD images: only swap the cells you can actually see while
  //      zoomed in. Preload then swap src so there's no flash. ----
  const prodByHandle = new Map(products.map((p) => [p.handle, p]));
  let upgRaf = null;
  function upgradeVisible() {
    const vh = window.innerHeight;
    cellMap.forEach((c, h) => {
      const r = c.getBoundingClientRect();
      if (r.bottom < -120 || r.top > vh + 240) return;     // visible (+ small look-ahead)
      const img = c.firstElementChild;
      const p = prodByHandle.get(h);
      if (!img || img.dataset.hq || !p || !p.thumbHq) return;
      img.dataset.hq = "1";
      const hd = new Image();
      hd.onload = () => { img.src = p.thumbHq; };
      hd.src = p.thumbHq;
    });
  }
  stage.addEventListener("scroll", () => {
    if (!zoomed) return;
    cancelAnimationFrame(upgRaf);
    upgRaf = requestAnimationFrame(upgradeVisible);
  }, { passive: true });

  const ROW_GAP = 8;
  let dragging = false, lastF = 0;
  function scrollToIndex(idx, c, smooth) {
    const top = Math.floor(idx / c) * (grid.clientWidth / c + ROW_GAP);
    stage.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
  }
  function sectionStart(f) {
    const N = sortedColor.length;
    let i = Math.round(clamp01(f) * (N - 1));
    const fam = sortedColor[i].family;
    while (i > 0 && sortedColor[i - 1].family === fam) i--;   // back up to the colour block's start
    return i;
  }
  function fToHandle(f) { selHandle.style.left = (f * selSpectrum.clientWidth) + "px"; }

  function onSlide(clientX) {
    const r = selSpectrum.getBoundingClientRect();
    lastF = clamp01((clientX - r.left) / r.width);
    fToHandle(lastF);
    scrollToIndex(Math.round(lastF * (sortedColor.length - 1)), cols, false); // live preview
  }
  function endSlide() {
    if (!dragging) return;
    dragging = false;
    const start = sectionStart(lastF);
    fToHandle(start / (sortedColor.length - 1));
    if (!zoomed) {
      zoomed = true;
      flipZoom(ZOOM_COLS);
      later(() => scrollToIndex(start, ZOOM_COLS, true), 340); // zoom in place, then glide to section
      later(upgradeVisible, 720);
    } else {
      scrollToIndex(start, ZOOM_COLS, true);
      later(upgradeVisible, 360);
    }
  }
  selSpectrum.addEventListener("pointerdown", (e) => {
    if (state !== "sel" || selCat !== "color") return;
    dragging = true;
    try { selSpectrum.setPointerCapture(e.pointerId); } catch (_) {}
    onSlide(e.clientX);
    e.preventDefault();
  });
  selSpectrum.addEventListener("pointermove", (e) => { if (dragging) onSlide(e.clientX); });
  selSpectrum.addEventListener("pointerup", endSlide);
  selSpectrum.addEventListener("pointercancel", endSlide);
}

init();
