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
  Camera tilt increases toward close zoom; rooftop panels lean toward the
  reader. The camera follows the selected panel's center without crossing
  below its target. The selected panel renders in a final pass above neighbors.
- `source-panels.js` renders source in 512-pixel tiles with 2-pixel gutters.
  LOD follows the projected panel in drawing-buffer pixels, including Retina
  scaling. Half-octave resolution levels and hysteresis avoid rapid repaints.
  A small preview remains behind detail tiles while they load. The LRU cache
  reserves at most 128 MiB for textures including mipmaps (CPU canvas copies
  and the framebuffer are additional). Raster work is limited to four small
  tiles and a 3 ms soft budget per frame; one paint may exceed that budget.
  Source fetches are lazy with four concurrent requests. The drawing buffer is
  capped at 8 million pixels, and rendering stops when the view settles.
- Search is a subsequence-fuzzy match over the precomputed symbol table;
  picking a result flies the camera and highlights the building.

## Status: proof of concept

Demo data only (`tools/gen-demo.mjs` writes a synthetic deka-flavored repo so
the indexer reads real files from disk). Next steps before real repos:

- Index the real deka/dsc checkouts (indexer is repo-agnostic; per-repo
  `data/<repo>.json` + a project picker)
- For `.ds`/`.dsx` files, swap the regex outline for `dsc`-backed symbols
  (the compiler already has the full graph from the LSP work)
- Measure real-repo performance and consider an atlas if tile draw calls
  become the bottleneck; the current cache prioritizes the focused file and
  lowers neighboring detail when its budget is full
- Ship: static hosting under explorer.deka.gg

`npx playwright install chromium` installs the test browser. `npm test` checks
texture stability, native-resolution coverage at DPR 1/2, close zoom, panning,
large-window resize, foreground occlusion, failed fetches and search.
`npm run verify` regenerates the screenshots in `tools/shots/`, including a
search→fly-to interaction. Both accept `-- --browser=/absolute/path/to/chromium`
to use an existing browser. Tests use software WebGL for reproducible images;
they do not establish an interactive hardware FPS target.
