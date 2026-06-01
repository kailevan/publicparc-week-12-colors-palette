// COLORS — Palette
// Mixed grid -> gooey "Filter" menu -> recluster (color / fabric / type).

const COLS = 10;

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
function flipTo(orderHandles, duration = 950) {
  const first = new Map();
  cellMap.forEach((c, h) => first.set(h, c.getBoundingClientRect()));

  orderHandles.forEach((h, i) => {
    const c = cellMap.get(h);
    if (c) c.style.order = i;
  });

  cellMap.forEach((c, h) => {
    const f = first.get(h);
    const l = c.getBoundingClientRect();
    c.style.transition = "none";
    c.style.transitionDelay = "0ms";
    c.style.transform = `translate(${f.left - l.left}px, ${f.top - l.top}px)`;
  });

  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      cellMap.forEach((c) => {
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
  const countEl = document.getElementById("count");
  const filterbar = document.getElementById("filterbar");
  const capMain = document.getElementById("capMain");
  const selector = document.getElementById("selector");
  const selLabel = document.getElementById("selLabel");
  const selBack = document.getElementById("selBack");
  const selTrack = document.getElementById("selTrack");

  let products = [];
  try {
    products = await (await fetch("data/products.json")).json();
  } catch (e) {
    grid.innerHTML = '<p style="padding:20px;font-size:12px">data/products.json missing.</p>';
    return;
  }

  document.documentElement.style.setProperty("--cols", COLS);
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

  // ---- menu open/close ----
  capMain.addEventListener("click", () => {
    if (busy) return;
    filterbar.classList.toggle("open");
  });

  // ---- choose a filter ----
  const LABELS = { color: "Colors", fabric: "Fabric", type: "Type" };
  document.querySelectorAll(".cap-opt").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (busy) return;
      const sort = btn.dataset.sort;
      busy = true;
      mode = sort;

      filterbar.classList.remove("open");
      flipTo(orders[sort]);

      // hand off filter pill -> selector
      setTimeout(() => filterbar.classList.add("hidden"), 120);
      setTimeout(() => {
        selLabel.textContent = LABELS[sort];
        selector.classList.toggle("no-spectrum", sort !== "color");
        selector.classList.add("show");
      }, 380);

      setTimeout(() => (busy = false), 1000);
    });
  });

  // ---- back to mixed ----
  selBack.addEventListener("click", () => {
    if (busy) return;
    busy = true;
    mode = "mixed";
    selector.classList.remove("show");
    flipTo(orders.mixed);
    setTimeout(() => filterbar.classList.remove("hidden"), 380);
    setTimeout(() => (busy = false), 1000);
  });
}

init();
