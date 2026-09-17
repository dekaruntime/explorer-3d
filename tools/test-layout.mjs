import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
mkdirSync(join(root, '.tmp'), { recursive: true });
const fixture = mkdtempSync(join(root, '.tmp/layout-'));
const sources = join(fixture, 'source'); mkdirSync(sources);
writeFileSync(join(sources, 'short.rs'), Array(4).fill('fn item() {}').join('\n'));
writeFileSync(join(sources, 'long.rs'), Array(400).fill('fn item() {}').join('\n'));
writeFileSync(join(sources, 'wide.rs'), '\t// ' + 'x'.repeat(500) + ' LAST_COLUMN\r\nfn tail() {}');
const output = join(fixture, 'data.json');
execFileSync(process.execPath, [join(root, 'tools/index.mjs'), sources, output]);
const data = JSON.parse(readFileSync(output, 'utf8'));
const [long, short, wide] = ['long.rs', 'short.rs', 'wide.rs'].map(path => data.filesTable.find(f => f.path === path));
assert.equal(long.lines, 400);
assert.equal(short.lines, 4);
assert.ok(long.source.height >= 400 * 17, 'document includes the last line');
assert.ok(wide.source.width > 500 * 8, 'document includes long line tails and expanded tabs');
assert.equal(long.source.width, short.source.width);
assert.ok(long.rect[2] * long.rect[3] > short.rect[2] * short.rect[3] * 50, 'file footprint grows with line count');
for (const f of data.filesTable) {
  assert.ok(Math.abs(f.rect[2] / f.rect[3] - f.source.width / f.source.height) < 1e-9, 'no source aspect distortion');
  assert.ok(f.rect.every(Number.isFinite) && f.rect[0] >= 0 && f.rect[1] >= 0 && f.rect[0] + f.rect[2] <= 1 && f.rect[1] + f.rect[3] <= 1);
}
for (let i = 0; i < data.filesTable.length; i++) for (let j = i + 1; j < data.filesTable.length; j++) {
  const a = data.filesTable[i].rect, b = data.filesTable[j].rect;
  assert.ok(a[0] + a[2] <= b[0] || b[0] + b[2] <= a[0] || a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1], 'files have separate footprints');
}
const first = readFileSync(output, 'utf8');
execFileSync(process.execPath, [join(root, 'tools/index.mjs'), sources, output]);
assert.equal(readFileSync(output, 'utf8'), first, 'static layout is deterministic');
console.log('Complete-file dimensions, variable footprints, no overlap/distortion, deterministic index passed');
