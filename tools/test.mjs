import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
for (const script of ['test-layout', 'gen-demo', 'index', 'build', 'test-rendering', 'test-focus']) {
  const flags = script.startsWith('test-') ? process.argv.slice(2) : [];
  execFileSync(process.execPath, [`tools/${script}.mjs`, ...flags], { cwd: root, stdio: 'inherit' });
}
