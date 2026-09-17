// Headless verification: screenshot the explorer at several zoom states.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { createServer } from 'node:http';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
mkdirSync(join(here, 'shots'), { recursive: true });

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.rs': 'text/plain', '.ds': 'text/plain', '.dsx': 'text/plain', '.toml': 'text/plain', '.md': 'text/plain', '.json': 'application/json' };
const server = createServer((req, res) => {
  const p = join(root, decodeURIComponent(req.url.split('?')[0]));
  const file = existsSync(p) && readFileSync(p);
  if (!file) { res.writeHead(404); res.end('nope'); return; }
  res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' });
  res.end(file);
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const states = [
  ['overview', 'index.html'],
  ['midzoom', 'index.html?focus=crates/deka_lsp/src/state.rs&z=520'],
  ['closeup', 'index.html?focus=crates/deka_syntax/src/parser.rs'],
  ['dsx', 'index.html?focus=apps/myapp/components/Counter.dsx'],
];

const EXEC = process.env.HOME + '/Library/Caches/ms-playwright/chromium-1234/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const browser = await chromium.launch({ executablePath: EXEC, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE:', m.text()); });

for (const [name, url] of states) {
  await page.goto(`${base}/${url}`);
  await page.waitForFunction('window.__ready === true', { timeout: 15000 });
  // let textures/labels settle
  await page.waitForTimeout(1200);
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
await page.waitForTimeout(1600);
await page.screenshot({ path: join(here, 'shots', 'search-fly.png') });
console.log('shot search');
await browser.close();
server.close();
