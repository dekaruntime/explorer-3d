import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('..', import.meta.url));
export async function startBrowser() {
  const executablePath = process.argv.find(a => a.startsWith('--browser='))?.slice(10);
  const appOverride = process.argv.find(a => a.startsWith('--app='))?.slice(6);
  const server = createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    try {
      let path = resolve(root, '.' + decodeURIComponent(pathname));
      if (!path.startsWith(resolve(root) + sep)) throw new Error('outside fixture');
      if (pathname === '/app.js' && appOverride) path = resolve(root, appOverride);
      if (!statSync(path).isFile()) throw new Error('not a file');
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
      res.writeHead(200, { 'content-type': mime[extname(path)] || 'text/plain' });
      res.end(readFileSync(path));
    } catch { res.writeHead(404); res.end('not found'); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const browser = await chromium.launch({ executablePath, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    return { browser, base: `http://127.0.0.1:${server.address().port}`,
      close: async () => { await browser.close(); await new Promise(r => server.close(r)); } };
  } catch (error) { server.close(); throw error; }
}

export async function settle(page) {
  await page.waitForFunction(() => {
    const d = window.__dbg;
    if (!window.__ready) return false;
    if (!d.sourcePanels) return d.texCache.size > 0;
    const s = d.sourcePanels.stats, r = d.rig;
    return s.paints > 0 && !s.pending && s.inFlight === 0 &&
      Math.abs(r.goalTx - r.tx) + Math.abs(r.goalTz - r.tz) + Math.abs(r.goalDist - r.dist) <= .001;
  }, null, { timeout: 60000 });
}
