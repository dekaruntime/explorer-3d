import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startBrowser, settle, root } from './browser-test.mjs';

const session = await startBrowser();
const errors = [];
mkdirSync(join(root, 'tools/shots'), { recursive: true });
const focus = 'crates/deka_syntax/src/parser.rs';
const snapshot = page => page.evaluate(() => {
  const d = window.__dbg, sp = d.sourcePanels;
  return { ids: [...(sp?.cache || d.texCache).values()].map(t => (t.mesh?.material.map || t.tex).uuid).sort(),
    stats: sp?.stats, draws: d.draws };
});
async function stable(page) {
  await settle(page);
  const a = await snapshot(page);
  await page.waitForTimeout(700);
  const b = await snapshot(page);
  assert.deepEqual(b.ids, a.ids, 'stationary zoom must not recreate source textures');
  if (a.stats) {
    assert.equal(b.stats.paints, a.stats.paints, 'stationary zoom must stop painting');
    assert.equal(b.draws, a.draws, 'stationary view must stop rendering');
    assert.ok(b.stats.bytes <= b.stats.maxBytes, 'texture byte budget');
  }
  return b;
}
async function coverage(page) {
  return page.evaluate(async () => {
    const THREE = await import('three'), d = window.__dbg;
    const e = d.sourcePanels.entries.find(e => e.n === d.sourcePanels.focused);
    const ray = new THREE.Raycaster(), hits = [];
    const meshes = e.root.children.filter(m => m !== e.background && m !== e.backing && m.visible);
    for (const x of [-.75, -.25, .25, .75]) for (const y of [-.75, -.25, .25, .75]) {
      ray.setFromCamera(new THREE.Vector2(x, y), d.camera);
      if (!ray.intersectObject(e.background, false).length) continue;
      const hit = ray.intersectObjects(meshes, false).sort((a, b) => b.object.renderOrder - a.object.renderOrder)[0];
      if (!hit) { hits.push(0); continue; }
      ray.setFromCamera(new THREE.Vector2(x + 2 / innerWidth, y), d.camera);
      const next = ray.intersectObject(hit.object, false)[0];
      if (!next) continue; // sample exactly at a tile boundary
      const tex = hit.object.material.map;
      hits.push(Math.hypot((hit.uv.x - next.uv.x) * tex.image.width,
        (hit.uv.y - next.uv.y) * tex.image.height) / d.renderer.getPixelRatio());
    }
    return hits;
  });
}
try {
  for (const dpr of [1, 2]) {
    const page = await session.browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: dpr });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${session.base}/index.html?focus=${focus}&z=110`);
    const state = await stable(page); // Also runs against the old app for negative proof.
    const density = await coverage(page);
    assert.ok(density.length >= 4 && Math.min(...density) >= .98, `DPR ${dpr}: every sampled source pixel needs native-resolution detail; ${density}`);
    const posture = await page.evaluate(() => {
      const d = window.__dbg;
      return { above: d.camera.position.y > d.gaze.y, focused: d.sourcePanels.focused.path,
        labelCount: [...document.querySelectorAll('.lbl')].filter(e => e.style.display !== 'none').length };
    });
    assert.equal(posture.focused, focus); assert.ok(posture.above); assert.equal(posture.labelCount, 0);
    await page.screenshot({ path: join(root, `tools/shots/retina-${dpr}.png`) });
    console.log(`DPR ${dpr}: stable, ${state.stats.tiles} tiles, ${(state.stats.bytes / 1048576).toFixed(1)} MiB, min ${Math.min(...density).toFixed(2)} texels/pixel`);

    if (dpr === 2) {
      // A transparent world object with the highest renderOrder cannot cover
      // the selected file: inspect actual framebuffer bytes, not material flags.
      const occlusion = await page.evaluate(async () => {
        const T = await import('three'), d = window.__dbg, renderer = d.renderer;
        const blocker = new T.Mesh(new T.PlaneGeometry(10000, 10000), new T.MeshBasicMaterial({ color: 0x00ff00, transparent: true, depthTest: false }));
        blocker.position.copy(d.camera.position).addScaledVector(d.camera.getWorldDirection(new T.Vector3()), 5);
        blocker.quaternion.copy(d.camera.quaternion); blocker.renderOrder = 999999;
        d.scene.add(blocker);
        const size = renderer.getDrawingBufferSize(new T.Vector2()), gl = renderer.getContext();
        const sample = () => { const p = new Uint8Array(4); gl.readPixels(size.x / 2, size.y / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, p); return [...p]; };
        renderer.clear(); renderer.render(d.scene, d.camera);
        const before = sample(); d.sourcePanels.render(); const after = sample();
        d.scene.remove(blocker); blocker.geometry.dispose(); blocker.material.dispose();
        return { before, after };
      });
      assert.deepEqual(occlusion.before.slice(0, 3), [0, 255, 0]);
      assert.notDeepEqual(occlusion.after.slice(0, 3), [0, 255, 0]);

      await page.mouse.move(800, 500);
      for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -1000);
      await stable(page);
      const before = await page.evaluate(() => ({ ...window.__dbg.rig }));
      assert.equal(before.goalDist, before.min);
      await page.mouse.wheel(0, -1000); await page.waitForTimeout(100);
      const after = await page.evaluate(() => ({ ...window.__dbg.rig }));
      assert.equal(after.goalTx, before.goalTx); assert.equal(after.goalTz, before.goalTz);
      await page.screenshot({ path: join(root, 'tools/shots/closest.png') });
      for (let i = 0; i < 3; i++) {
        await page.mouse.wheel(0, 850); await page.waitForTimeout(150);
        await page.mouse.wheel(0, -850); await page.waitForTimeout(150);
      }
      await page.mouse.move(850, 650); await page.mouse.down();
      await page.mouse.move(650, 550, { steps: 10 }); await page.mouse.up();
      await stable(page);
      await page.setViewportSize({ width: 2560, height: 1440 });
      await stable(page);
      const large = await coverage(page);
      assert.ok(large.length >= 4 && Math.min(...large) >= .98, 'large-display detail covers the visible source');
      await page.screenshot({ path: join(root, 'tools/shots/large-display.png') });
      console.log('Close zoom, zoom limits, pan, occlusion and 2560×1440 DPR 2 passed');
    }
    await page.close();
  }
  const page = await session.browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.on('pageerror', e => errors.push(e.message));
  let requests = 0;
  await page.route(`**/demo-src/${focus}`, async route => {
    requests++;
    await new Promise(r => setTimeout(r, 250));
    await route.fulfill({ status: 404, contentType: 'text/html', body: '<h1>Not source</h1>' });
  });
  await page.goto(`${session.base}/index.html?focus=${focus}&z=200`);
  await stable(page);
  assert.equal(requests, 1);
  const failed = await page.evaluate(path => window.__dbg.sourcePanels.sources.get(path), focus);
  assert.equal(failed.status, 'error'); assert.ok(!failed.lines.join('').includes('<h1>'));
  await page.keyboard.press('/'); await page.keyboard.type('hydrate');
  await page.waitForSelector('#results.open .res');
  const target = await page.locator('#results .res .path').first().textContent();
  await page.keyboard.press('Enter'); await stable(page);
  assert.ok(target.startsWith(await page.evaluate(() => window.__dbg.sourcePanels.focused.path)));
  assert.equal(await page.locator('#results.open').count(), 0);
  console.log('Delayed/failed source and search → fly passed');
  await page.close();
  assert.deepEqual(errors, [], 'no browser runtime errors');
} finally { await session.close(); }
