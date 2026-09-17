# deka explorer (POC)

Google-Maps-style 3D visualizer for a codebase: the repo is laid out as a city —
directories are blocks, files are buildings (height ∝ √lines, color = language),
and zooming in picks a file and raises its complete source with its colored
building. Symbol-level fuzzy
search flies you to any function, struct, or file.

Inspired by [Rik Arends' viral code visualizer](https://news.lavx.hu/article/developer-builds-3d-source-code-visualizer-that-navigates-2-5-million-lines-at-120-fps),
scoped to deka/dsc-sized repos and built with three.js + a small static indexer.

## Run it

```sh
npm install
npm run gen     # write synthetic demo repo to demo-src/ (deterministic)
npm run index   # demo-src/ -> data.json (document rectangles, symbols, ref counts)
npx http-server .   # or any static server; open /index.html
```

Controls: drag to pan, scroll toward a building to select it automatically,
or click it to focus. Selection stays locked while zooming; zoom back out or
press Esc to return to the overview. `/` opens search; Enter flies to the
matching file and line. Panning follows the raised page so its full length
and width remain reachable.

## Build a static site

```sh
npm run build                         # self-contained demo site in dist/
node tools/build.mjs /path/to/source  # or build an actual source checkout
```

Serve `dist/` with any static file server. It contains the index, viewer,
vendored three.js and the complete indexed source files. Cloudflare Pages can
use `npm run build` as its build command and `dist` as its output directory.
No runtime server or external asset service is required. Building replaces
`dist/`; keep input sources outside that generated folder.

## How it works

- `tools/index.mjs` walks a source tree, extracts a symbol outline per file
  (fn/struct/enum/trait/…), counts textual references repo-wide for the search
  index, and packs full-document rectangles into directory blocks. Line count
  controls length, and the longest line controls width. Shared dimensions in
  `source-layout.js` keep indexing and painting consistent. Output: one static
  `data.json`. Regenerate it when source changes; old treemap indexes need rebuilding.
- `app.js` (three.js) renders the city as instanced boxes.
  Camera tilt increases toward close zoom; rooftop panels lean toward the
  reader. The camera follows the selected panel's center without crossing
  below its target. Only the selected file has a source panel and raised solid
  backing; it renders in a final pass above quieter neighbors. Distant movement
  does no source projection, fetching or rasterization.
- `source-panels.js` renders source in 512-pixel tiles with 2-pixel gutters.
  LOD follows the projected panel in drawing-buffer pixels, including Retina
  scaling. Half-octave resolution levels and hysteresis avoid rapid repaints.
  A small preview remains behind detail tiles while they load. The LRU cache
  reserves at most 128 MiB for textures including mipmaps (CPU canvas copies
  and the framebuffer are additional). Raster work is limited to four small
  tiles and a 3 ms soft budget per frame (one tile while moving); one paint may
  exceed that budget. Tiles cover the entire file, without line or column crops.
  Source fetches are lazy with four concurrent requests. The drawing buffer is
  capped at 8 million pixels, and rendering stops when the view settles.
- Search is a subsequence-fuzzy match over the precomputed symbol table;
  picking a result flies the camera to that line and raises the building.

## Status: proof of concept

Demo data only (`tools/gen-demo.mjs` writes a synthetic deka-flavored repo so
the indexer reads real files from disk). Next steps before real repos:

- Index the real deka/dsc checkouts (indexer is repo-agnostic; per-repo
  `data/<repo>.json` + a project picker)
- For `.ds`/`.dsx` files, swap the regex outline for `dsc`-backed symbols
  (the compiler already has the full graph from the LSP work)
- Measure real-repo performance and consider an atlas if tile draw calls
  become the bottleneck; the current cache renders detail for one selected file
- Ship: static hosting under explorer.deka.gg

The indexer retains its POC input filters: hidden/build directories and files
at least 512 KiB are skipped; outlines and reference counts are regex based.
Every included document retains its complete content in the viewer and build.

`npx playwright install chromium` installs the test browser. `npm test` builds
the demo and checks full-document layout, texture stability, native-resolution
coverage at DPR 1/2, close zoom, panning, large-window resize, foreground
occlusion, failed fetches, search, automatic selection, raised backing,
zero distant source work, long files/lines and the static build's source URLs.
`npm run verify` regenerates the screenshots in `tools/shots/`, including a
search→fly-to interaction. Both accept `-- --browser=/absolute/path/to/chromium`
to use an existing browser. Tests use software WebGL for reproducible images;
they do not establish an interactive hardware FPS target.
