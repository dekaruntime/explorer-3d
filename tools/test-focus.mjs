import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startBrowser, settle, root } from './browser-test.mjs';

const session = await startBrowser();
const errors = [];
mkdirSync(join(root, 'tools/shots'), { recursive: true });
try {
  const page = await session.browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', e => errors.push(e.message));
  let sourceRequests = 0;
  page.on('request', r => { if (r.url().includes('/demo-src/')) sourceRequests++; });
  await page.goto(`${session.base}/index.html`);
  await page.waitForFunction(() => window.__ready);
  await page.evaluate(() => {
    const sp = window.__dbg.sourcePanels, measure = sp.measure.bind(sp);
    window.__measures = 0;
    sp.measure = (...args) => { window.__measures++; return measure(...args); };
  });
  await page.mouse.move(800, 500); await page.mouse.down();
  await page.mouse.move(850, 550, { steps: 12 }); await page.mouse.up();
  await settle(page);
  assert.equal(await page.evaluate(() => window.__measures), 0, 'distant navigation must not project or rasterize source panels');
  assert.equal(sourceRequests, 0, 'distant navigation must not fetch source');

  const pick = await page.evaluate(async () => {
    const T = await import('three'), d = window.__dbg;
    for (const n of d.fileNodes.filter(n => n.lang === 'rust')) {
      const [x, z, w, h] = n.rect;
      const p = new T.Vector3((x + w / 2) * 1000, 1.5 + d.boxHeight.get(n), (z + h / 2) * 1000).project(d.camera);
      const sx = (p.x + 1) * innerWidth / 2, sy = (1 - p.y) * innerHeight / 2;
      if (sx < 100 || sx > innerWidth - 100 || sy < 120 || sy > innerHeight - 100) continue;
      const hit = d.fileAt(sx, sy);
      if (hit?.lang === 'rust') return { x: sx, y: sy, path: hit.path };
    }
  });
  assert.ok(pick, 'a visible Rust building can be picked');
  await page.mouse.move(pick.x, pick.y); await page.mouse.wheel(0, -750);
  await settle(page);
  assert.equal(await page.evaluate(() => window.__dbg.sourcePanels.focused?.path), pick.path, 'wheel selects the file under the pointer');
  await page.mouse.move(1450, 850); await page.mouse.wheel(0, -450); await settle(page);
  assert.equal(await page.evaluate(() => window.__dbg.sourcePanels.focused?.path), pick.path, 'zoom locks selection instead of switching to neighbors');
  const state = await page.evaluate(async () => {
    const T = await import('three'), d = window.__dbg, sp = d.sourcePanels, e = sp.active;
    const m = new T.Matrix4(); d.fileMesh.getMatrixAt(d.fileNodes.indexOf(e.n), m);
    const backing = e.backing.getWorldQuaternion(new T.Quaternion()), source = e.background.getWorldQuaternion(new T.Quaternion());
    return { visible: sp.entries.filter(e => e.root.visible).length, fetched: [...sp.sources.keys()],
      backingMatches: backing.angleTo(source), raised: Math.abs(e.root.rotation.x + Math.PI / 2), hiddenOriginal: m.determinant() === 0,
      hasVolume: e.backing.geometry.parameters.depth > 0,
      unwantedDetail: [...sp.cache.values()].some(t => t.e !== e && t.mesh.visible && t.e.root.parent) };
  });
  assert.equal(state.visible, 1); assert.deepEqual(state.fetched, [pick.path]);
  assert.ok(state.backingMatches < 1e-6, 'backing and source have the same rotation');
  assert.ok(state.raised > .1 && state.hasVolume && state.hiddenOriginal);
  assert.equal(state.unwantedDetail, false);
  await page.screenshot({ path: join(root, 'tools/shots/auto-picked.png') });
  const beforePan = await page.evaluate(() => window.__dbg.rig.panY);
  await page.mouse.move(800, 600); await page.mouse.down(); await page.mouse.move(800, 450, { steps: 8 }); await page.mouse.up();
  await settle(page);
  assert.ok(Math.abs(await page.evaluate(() => window.__dbg.rig.panY) - beforePan) > 1, 'pan follows the raised document in height');
  await page.keyboard.press('Escape'); await settle(page);
  assert.equal(await page.evaluate(() => window.__dbg.sourcePanels.focused), null, 'overview releases selection');
  console.log('Distant pan: zero source work; automatic selection, single-file detail, solid backing, raised-plane pan and overview release passed');

  // Exercise the actual build artifact, including relative source URLs.
  await page.goto(`${session.base}/dist/index.html?focus=apps/myapp/components/Counter.dsx&z=110`);
  await settle(page);
  const built = await page.evaluate(() => {
    const sp = window.__dbg.sourcePanels;
    return { base: window.__data.sourceBase, lines: sp.sources.get(sp.focused.path).lines.join('\n') };
  });
  assert.equal(built.base, 'source'); assert.ok(built.lines.includes('</section>'));
  console.log('Static dist artifact loaded complete source without a backend');

  // A full-file tail and a long-line tail must reach the painter. The source
  // dimensions also make their geometry reachable; neither is preview-cropped.
  const data = JSON.parse(readFileSync(join(root, 'data.json'), 'utf8'));
  const file = data.filesTable.find(f => f.path === 'crates/deka_syntax/src/parser.rs');
  const original = readFileSync(join(root, 'demo-src', file.path), 'utf8');
  const full = original + '\n// ' + 'wide '.repeat(90) + 'LAST_COLUMN_MARKER\n' +
    Array.from({ length: 1200 }, (_, i) => `// line ${i}`).join('\n') + '\npub fn entire_file_tail() {}\n';
  const { sourceLines, sourceDimensions, layoutDocuments } = await import('../source-layout.js');
  const lines = sourceLines(full), dimensions = sourceDimensions(lines);
  const node = { type: 'file', name: 'parser.rs', path: file.path, lang: 'rust', lines: lines.length,
    source: dimensions, syms: [] };
  const tree = { type: 'dir', name: 'root', path: '', children: [node] };
  const layout = layoutDocuments(tree);
  const last = lines.findIndex(l => l.includes('entire_file_tail'));
  const fixture = { ...data, tree, layout, files: 1, totalLines: lines.length,
    filesTable: [node], symbolsTable: [{ name: 'entire_file_tail', path: file.path, line: last, kind: 'fn' }] };
  await page.route('**/data.json', route => route.fulfill({ json: fixture }));
  await page.route(`**/demo-src/${file.path}`, route => route.fulfill({ contentType: 'text/plain', body: full }));
  await page.addInitScript(() => {
    window.__painted = [];
    const paint = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...rest) {
      window.__painted.push(text); return paint.call(this, text, ...rest);
    };
  });
  await page.goto(`${session.base}/index.html`);
  await page.waitForFunction(() => window.__ready);
  await page.keyboard.press('/'); await page.keyboard.type('entire_file_tail'); await page.keyboard.press('Enter');
  await settle(page);
  assert.ok(await page.evaluate(() => window.__painted.some(s => s === 'pub fn entire_file_tail() {}')), 'last line beyond 1200 reaches the rasterizer');
  assert.ok(await page.evaluate(() => window.__dbg.sourcePanels.active.docHeight > 1200 * 17));
  // Center the long line using the same focus action used by search.
  const longLine = lines.findIndex(l => l.includes('LAST_COLUMN_MARKER'));
  await page.evaluate(line => window.__dbg.focusFile(window.__dbg.fileNodes[0], line), longLine);
  await settle(page);
  assert.ok(await page.evaluate(() => window.__painted.some(s => s.endsWith('LAST_COLUMN_MARKER') && s.length > 400)), 'long lines are not sliced at 110 characters');
  await page.screenshot({ path: join(root, 'tools/shots/full-source.png') });
  console.log('Whole-file tail beyond line 1200 and line wider than 400 characters passed');
  await page.close();
  assert.deepEqual(errors, []);
} finally { await session.close(); }
