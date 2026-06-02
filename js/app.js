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

// colour grid is GROUPED into clean colour blocks (one per bucket), in spectrum
// order; within a block, light -> dark. So every colour is one contiguous section.
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

// Build the contiguous colour blocks from the grouped order: each block knows
// where its section starts in the grid and its representative (average) colour.
function buildBuckets(sortedProducts) {
  const out = [];
  sortedProducts.forEach((p, i) => {
    const last = out[out.length - 1];
    if (last && last.key === p.bucket) {
      last.count++; last._r += p.rgb[0]; last._g += p.rgb[1]; last._b += p.rgb[2];
    } else {
      out.push({ key: p.bucket, start: i, count: 1, _r: p.rgb[0], _g: p.rgb[1], _b: p.rgb[2] });
    }
  });
  out.forEach((b) => { b.rgb = [Math.round(b._r / b.count), Math.round(b._g / b.count), Math.round(b._b / b.count)]; });
  return out;
}

// Equal-width segment per colour (NOT proportional to count), but each colour
// sits at its segment CENTRE and the gradient blends smoothly between them.
function paintSpectrum(track, buckets) {
  const n = buckets.length;
  const stops = buckets.map((b, i) =>
    `rgb(${b.rgb[0]},${b.rgb[1]},${b.rgb[2]}) ${((i + 0.5) / n * 100).toFixed(2)}%`);
  track.style.background = `linear-gradient(to right, ${stops.join(", ")})`;
}

async function init() {
  const grid = document.getElementById("grid");
  const stage = document.getElementById("stage");
  const island = document.getElementById("island");
  const selTrack = document.getElementById("selTrack");
  const selHandle = document.getElementById("selHandle");
  const pmIcon = document.getElementById("pmIcon");

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

  const mixed = shuffle(products, 20260601);
  const sortedColor = colorSorted(products);
  orders.mixed = mixed.map((p) => p.handle);
  orders.color = sortedColor.map((p) => p.handle);
  orders.fabric = fabricSorted(products).map((p) => p.handle);
  orders.type = typeSorted(products).map((p) => p.handle);
  const buckets = buildBuckets(sortedColor);   // contiguous colour blocks + section starts
  paintSpectrum(selTrack, buckets);

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
  const ICN = (w) => ({ left: w - 20, op: 1 });   // +/× icon rides the right edge of the bar
  function layoutFor(st, cat) {
    if (st === "closed") {
      const w = 110;
      return { w, filter: { left: 2, op: 1 },
        color: hide(w, W_C), fabric: hide(w, W_C), type: hide(w, W_C),
        spectrum: spHidden(), icon: ICN(w), divOp: 0 };
    }
    if (st === "open") {
      const w = 380;
      return { w, filter: { left: 0, op: 1 },
        color: { left: 88, op: 1 }, fabric: { left: 172, op: 1 }, type: { left: 256, op: 1 },
        spectrum: spHidden(), icon: ICN(w), divOp: 0.5 };
    }
    // sel
    if (cat === "color") {
      const w = 288;
      return { w, color: { left: 8, op: 1 }, spectrum: { left: SP_X, op: 1, w: SPW },
        filter: hide(w, W_F), fabric: hide(w, W_C), type: hide(w, W_C), icon: ICN(w), divOp: 0 };
    }
    const w = 132;  // fabric / type — label pill + icon
    const L = { w, filter: hide(w, W_F), color: hide(w, W_C),
      fabric: hide(w, W_C), type: hide(w, W_C), spectrum: spHidden(), icon: ICN(w), divOp: 0 };
    L[cat] = { left: (w - W_C) / 2 - 12, op: 1 };   // nudge left to leave room for the icon
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
    pmIcon.style.left = L.icon.left + "px";
    pmIcon.style.opacity = L.icon.op;
    dividers.forEach((d) => (d.style.opacity = L.divOp));
  }

  function easeOutBack(x) { const c1 = 0.7, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); }
  function easeOutCubic(x) { return 1 - Math.pow(1 - x, 3); }
  const clone = (L) => JSON.parse(JSON.stringify(L));
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

  let cur = clone(layoutFor("closed"));
  let menuRaf = null;
  // bounce=true gives the elastic width overshoot + surface-tension squash (one
  // satisfying bounce). Intermediate stages of a multi-step morph pass bounce=false
  // so the bar doesn't bounce on every leg of the sequence.
  function tweenTo(target, onDone, dur = 560, bounce = true) {
    const from = clone(cur);
    const start = performance.now();
    cancelAnimationFrame(menuRaf);
    function step(now) {
      const p = Math.min(1, (now - start) / dur);
      const es = easeOutCubic(p);
      const ew = bounce ? easeOutBack(p) : es;   // overshoot only when bounce is on
      cur.w = lerp(from.w, target.w, ew);
      for (const k of ["filter", "color", "fabric", "type", "spectrum", "icon"]) {
        cur[k].left = lerp(from[k].left, target[k].left, es);
        cur[k].op = lerp(from[k].op, target[k].op, es);
      }
      cur.spectrum.w = lerp(from.spectrum.w || 0, target.spectrum.w || 0, es);
      cur.divOp = lerp(from.divOp, target.divOp, es);
      const squash = bounce ? 1 - 0.05 * Math.sin(Math.PI * p) : 1;
      applyLayout(cur, squash);
      if (p < 1) menuRaf = requestAnimationFrame(step);
      else { cur = clone(target); applyLayout(cur, 1); if (onDone) onDone(); }
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
  const setBold = (cat) => {
    ["color", "fabric", "type"].forEach((c) => labEl[c].classList.toggle("selected", c === cat));
    labFilter.classList.toggle("dimmed", !!cat);   // Filter recedes to regular once a category is active
  };
  // +/× icon: + (collapsed/browsing levels) vs × (drilled-in: open list, or zoomed detail)
  function setIcon() {
    pmIcon.classList.toggle("x", state === "open" || (state === "sel" && zoomed));
  }
  function morphTo(to, cat, onDone) { state = to; selCat = cat || null; setIcon(); tweenTo(layoutFor(to, cat), onDone); }

  applyLayout(cur, 1); setIcon(); // initial closed state

  function noSpectrumLayout(cat) {                  // final selected layout, but spectrum still furled
    const L = clone(layoutFor("sel", cat));
    L.spectrum = { left: L.spectrum.left, op: 0, w: 0 };
    return L;
  }

  // ---- actions (shared by the labels and the +/× icon) ----
  function openMenu() { clearTimers(); morphTo("open"); }            // closed -> categories  (+ -> ×)
  function closeMenu() {                                             // open/sel -> closed    (× -> +)
    clearTimers(); setBold(null);
    if (mode !== "mixed" || zoomed) { mode = "mixed"; morphTo("closed", null, () => unzoom(orders.mixed)); }
    else morphTo("closed");
  }
  function backToCategories() {                                      // a selected category -> open list
    clearTimers();
    const cat = selCat; setBold(cat);
    const reopen = () => morphTo("open", null, () => unzoom());
    if (cat === "color") tweenTo(noSpectrumLayout(cat), reopen, 240, false);   // furl the picker first
    else reopen();
  }
  function unzoomInPlace() {                                         // detail × -> 8-col colour grid, anchored
    if (!zoomed) return;
    const b = buckets[lastBucket >= 0 ? lastBucket : 0];
    zoomed = false;
    flipZoom(COLS, rowTop(landIndex(b), COLS), undefined, 760);      // organic 3->8 in place (no scroll-to-top)
    setIcon();
  }

  function selectCategory(cat, staged) {
    clearTimers();
    setBold(cat);
    const wasZoomed = zoomed;
    mode = cat;
    const recluster = () => {
      if (wasZoomed) { zoomed = false; flipZoom(COLS, 0, orders[cat]); setIcon(); }
      else flipTo(orders[cat]);
    };
    if (!staged) { morphTo("sel", cat, recluster); return; }
    // one motion: others fade + chosen word slides left + bar resizes (one bounce);
    // recluster fires the instant the bar settles. For COLOR the picker then
    // unfurls on a SLIGHT delay (so it reads "after the word has moved left").
    state = "sel"; selCat = cat; setIcon();
    tweenTo(noSpectrumLayout(cat), () => {
      recluster();
      if (cat === "color") later(() => tweenTo(layoutFor("sel", cat), null, 300, false), 120);
    }, 400, true);
  }

  function onCategory(cat) {
    if (state === "sel" && selCat === cat) { backToCategories(); return; }   // tap active -> back to list
    selectCategory(cat, state === "open");
  }

  labFilter.addEventListener("click", () => { if (state === "closed") openMenu(); else closeMenu(); });
  pmIcon.addEventListener("click", () => {
    if (state === "closed") openMenu();
    else if (state === "open") closeMenu();
    else if (state === "sel") { if (zoomed) unzoomInPlace(); else backToCategories(); }
  });
  labColor.addEventListener("click", () => onCategory("color"));
  labFabric.addEventListener("click", () => onCategory("fabric"));
  labType.addEventListener("click", () => onCategory("type"));

  // ---- zoom + colour slider ----------------------------------------------
  const ROW_GAP = 8;
  function rowTop(idx, c) { return Math.floor(idx / c) * (grid.clientWidth / c + ROW_GAP); }

  // CONTINUOUS column-collapse zoom: a FLIP that ALSO scales each cell, so you
  // watch the columns morph (8 <-> 3) in one motion and the target tile travels
  // to the top-left and grows — never a jump or a separate scroll. We commit the
  // new column count + scroll instantly, then invert every cell back to where it
  // just was and let it animate to its new home.
  function flipZoom(toCols, targetScrollTop, orderHandles, dur = 640) {
    const vh = window.innerHeight;
    const first = new Map();
    cellMap.forEach((c, h) => first.set(h, c.getBoundingClientRect()));
    if (orderHandles) orderHandles.forEach((h, i) => { const c = cellMap.get(h); if (c) c.style.order = i; });
    setCols(toCols);
    stage.scrollTop = Math.max(0, targetScrollTop);
    const anim = [];
    cellMap.forEach((c, h) => {
      const f = first.get(h), l = c.getBoundingClientRect();
      if (!l.width || !f.width) return;
      const seen = (f.bottom > -60 && f.top < vh + 60) || (l.bottom > -60 && l.top < vh + 60);
      c.style.transition = "none"; c.style.transitionDelay = "0ms"; c.style.transformOrigin = "top left";
      if (seen) {
        c.style.transform =
          `translate(${f.left - l.left}px, ${f.top - l.top}px) scale(${f.width / l.width}, ${f.height / l.height})`;
        anim.push(c);
      } else { c.style.transform = ""; }
    });
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        anim.forEach((c) => {
          c.style.transition = `transform ${dur}ms cubic-bezier(0.62,0.02,0.2,1)`;  // ease-in-out: watch it move
          c.style.transform = "";
        });
      })
    );
    if (toCols === ZOOM_COLS) later(upgradeVisible, dur * 0.45);
  }

  // first column-0 index at/after a bucket's start, so the top row is ALL that
  // colour (the 1-2 items that'd sit in the previous row are scrolled just above).
  function landIndex(b) {
    const end = b.start + b.count - 1;
    let li = Math.ceil(b.start / ZOOM_COLS) * ZOOM_COLS;
    if (li + ZOOM_COLS - 1 > end) li = Math.floor(b.start / ZOOM_COLS) * ZOOM_COLS; // tiny-bucket guard
    return Math.min(Math.max(0, li), sortedColor.length - 1);
  }

  function unzoom(orderHandles) {     // back to the 8-col overview; optional new order
    if (zoomed) { zoomed = false; flipZoom(COLS, 0, orderHandles); setIcon(); }
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

  let dragging = false, lastF = 0, lastBucket = -1;
  function scrollToIndex(idx, c, smooth) {
    stage.scrollTo({ top: Math.max(0, rowTop(idx, c)), behavior: smooth ? "smooth" : "auto" });
  }
  const HR = 12;   // inset the handle travel by its radius so it isn't clipped at either end
  function fToHandle(f) {
    const w = selSpectrum.clientWidth;
    selHandle.style.left = (HR + clamp01(f) * (w - 2 * HR)) + "px";
  }
  // equal-width segments: fraction -> which colour block
  function bucketAtF(f) { return Math.min(buckets.length - 1, Math.max(0, Math.floor(clamp01(f) * buckets.length))); }
  function paintHandle(b) { selHandle.style.background = `rgb(${b.rgb[0]},${b.rgb[1]},${b.rgb[2]})`; }

  function onSlide(clientX) {
    const r = selSpectrum.getBoundingClientRect();
    lastF = clamp01((clientX - r.left) / r.width);
    fToHandle(lastF);                                 // handle rides the finger
    const bi = bucketAtF(lastF);
    paintHandle(buckets[bi]);                          // handle takes that colour's hue
    if (bi !== lastBucket) {                           // crossed into a new colour -> bring its clean row to top
      lastBucket = bi;
      scrollToIndex(landIndex(buckets[bi]), cols, false);
    }
  }
  function endSlide() {
    if (!dragging) return;
    dragging = false;
    const b = buckets[bucketAtF(lastF)];
    fToHandle((lastBucket + 0.5) / buckets.length);    // settle the handle to the segment centre
    paintHandle(b);
    const li = landIndex(b);
    if (!zoomed) {
      zoomed = true;
      flipZoom(ZOOM_COLS, rowTop(li, ZOOM_COLS), undefined, 900);  // slow, continuous 8->3 collapse + zoom-in
      setIcon();                                       // + -> ×
    } else {
      scrollToIndex(li, ZOOM_COLS, true);              // already zoomed: glide to the new colour section
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
