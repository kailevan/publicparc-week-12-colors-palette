# COLORS — Palette

**PUBLIC parc · Week 12 · Studio Parc**

A webshop reimagined as a single dense product grid. The whole COLORS catalog (371 pieces) lives on one canvas. A center liquid-glass **Filter** island lets you recluster the entire grid live — by **Color** (into a 2D color map, warm → cool → neutral), **Fabric**, or **Type**. Pieces physically fly into place with a FLIP animation, forming the brand's palette in real time.

> Concept lineage: the viral Shang Xia "items zoom" grid — but here the bar does *semantic* work (filter/sort), not just magnification.

## Run
Zero build. Serve the folder and open on a phone:
```bash
python3 -m http.server 8099 --bind 0.0.0.0
# desktop: http://localhost:8099   |   phone (same wifi): http://<mac-LAN-ip>:8099
```

## Structure
- `index.html` — phone shell, gooey filter menu, liquid-glass selector, SVG goo filter
- `css/styles.css` — brand font, 10-col grid, gooey menu, glass selector
- `js/app.js` — data load, FLIP recluster, 3 sort modes, preload gate + row cascade
- `data/products.json` — 371 products with extracted dominant color (sort key)
- `assets/thumbs/` — 160px webp grid thumbnails (what the grid renders)
- `assets/products/` — 600px full-res cutouts (reserved for the zoom feature)
- `assets/fonts/`, `assets/logo.webp`

## Status (2026-06-01)
**Done:** full catalog scrape (COLORS Shopify Storefront API), accurate per-garment color extraction, dense mixed grid with row-by-row reveal, gooey Filter→Color/Fabric/Type menu, FLIP recluster into color map, liquid-glass spectrum selector.

**Next:** drag-to-scrub the spectrum → snap-zoom onto a color section; free pinch-zoom/pan; final caption; 9:16 video.

*The deliverable is a 9:16 screen-recording for socials.*
