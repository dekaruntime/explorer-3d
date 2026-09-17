# deka explorer (POC)

Google-Maps-style 3D visualizer for a codebase: the repo is laid out as a city —
directories are blocks, files are buildings (height ∝ √lines, color = language),
and zooming in renders the actual source on every rooftop. Symbol-level fuzzy
search flies you to any function, struct, or file.

Inspired by [Rik Arends' viral code visualizer](https://news.lavx.hu/article/developer-builds-3d-source-code-visualizer-that-navigates-2-5-million-lines-at-120-fps),
scoped to deka/dsc-sized repos and built with three.js + a small static indexer.

## Run it

```sh
npm install
npm run gen     # write synthetic demo repo to demo-src/ (deterministic)
npm run index   # demo-src/ -> data.json (treemap rects, symbols, ref counts)
npx http-server .   # or any static server; open /index.html
```

Controls: drag to pan, scroll to zoom (to cursor), click a building to focus,
`/` to search, Enter to fly to the top result.

## How it works

- `tools/index.mjs` walks a source tree, extracts a symbol outline per file
  (fn/struct/enum/trait/…), counts textual references repo-wide for the search
  index, and computes a squarified treemap. Output: one static `data.json`.
- `app.js` (three.js, no build step) renders the treemap as instanced boxes.
  Zoom-dependent level of detail: labels fade in by zoom, rooftops get a
  canvas-rendered source texture past a screen-size threshold, symbols become
  colored boxes at close range. Camera tilt eases from horizon (far) to
  top-down (close) like Google Maps.
- Search is a subsequence-fuzzy match over the precomputed symbol table;
  picking a result flies the camera and highlights the building.

## Status: proof of concept

Demo data only (`tools/gen-demo.mjs` writes a synthetic deka-flavored repo so
the indexer reads real files from disk). Next steps before real repos:

- Index the real deka/dsc checkouts (indexer is repo-agnostic; per-repo
  `data/<repo>.json` + a project picker)
- For `.ds`/`.dsx` files, swap the regex outline for `dsc`-backed symbols
  (the compiler already has the full graph from the LSP work)
- Text-tile LOD pyramid (currently one fixed-resolution rooftop texture)
- Ship: static hosting under explorer.deka.gg

Verified headlessly with Playwright (`npm run verify` regenerates the
screenshots in `tools/shots/`, including a search→fly-to interaction).
