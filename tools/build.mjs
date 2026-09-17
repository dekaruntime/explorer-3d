// Build a self-contained static site for Cloudflare Pages or any file host.
import { mkdirSync, rmSync, copyFileSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = resolve(process.argv[2] || join(root, 'demo-src'));
const output = join(root, 'dist');
if (source === output || source.startsWith(output + '/')) throw new Error('Source must be outside the build output.');
rmSync(output, { recursive: true, force: true });
mkdirSync(join(output, 'vendor'), { recursive: true });
execFileSync(process.execPath, [join(root, 'tools/index.mjs'), source, join(output, 'data.json'), 'source'], { stdio: 'inherit' });
for (const name of ['index.html', 'app.js', 'source-panels.js', 'source-layout.js', 'vendor/three.module.js', 'LICENSE'])
  copyFileSync(join(root, name), join(output, name));
const data = JSON.parse(readFileSync(join(output, 'data.json'), 'utf8'));
for (const file of data.filesTable) {
  const target = join(output, 'source', file.path);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(source, file.path), target);
}
console.log(`Static site: ${output} (${data.files} complete source files)`);
