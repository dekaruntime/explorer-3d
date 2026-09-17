// Headless verification: screenshot the explorer at several zoom states.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { startBrowser, settle, root } from './browser-test.mjs';
const here = join(root, 'tools');
mkdirSync(join(here, 'shots'), { recursive: true });
const { browser, base, close } = await startBrowser();
const errors = [];
try {
  const states = [
    ['overview', 'index.html'],
    ['midzoom', 'index.html?focus=crates/deka_lsp/src/state.rs&z=520'],
    ['closeup', 'index.html?focus=crates/deka_syntax/src/parser.rs'],
    ['dsx', 'index.html?focus=apps/myapp/components/Counter.dsx'],
  ];

  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

  for (const [name, url] of states) {
    await page.goto(`${base}/${url}`);
    await page.waitForFunction('window.__ready === true', { timeout: 15000 });
    if (name !== 'overview') await settle(page);
    else await page.waitForTimeout(300);
    await page.screenshot({ path: join(here, 'shots', `${name}.png`) });
    console.log('shot', name);
  }

  // search interaction: type "hydrate", pick first result, let the camera fly
  await page.goto(`${base}/index.html`);
  await page.waitForFunction('window.__ready === true', { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.keyboard.press('/');
  await page.keyboard.type('hydrate');
  await page.waitForTimeout(300);
  const first = await page.textContent('#results .res .path');
  await page.screenshot({ path: join(here, 'shots', 'search-open.png') });
  console.log('first result for "hydrate":', first);
  await page.keyboard.press('Enter');
  await settle(page);
  await page.screenshot({ path: join(here, 'shots', 'search-fly.png') });
  console.log('shot search');
  if (errors.length) throw new Error(errors.join('\n'));
} finally { await close(); }
