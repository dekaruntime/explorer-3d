// Indexes a source tree into data.json for the explorer frontend:
//   - nested tree with per-file lines/lang/symbols
//   - full-document rectangles packed into directory blocks (normalized 0..1)
//   - flat symbol table with textual reference counts (search index)
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { join, dirname, extname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceLines, sourceDimensions, layoutDocuments } from '../source-layout.js';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = process.argv[2] || join(here, '..', 'demo-src');
const OUT = process.argv[3] || join(here, '..', 'data.json');

const SKIP = new Set(['.git', 'node_modules', 'target', '.target', '.tmp', 'dist']);
const LANG = { '.rs': 'rust', '.ds': 'deka', '.dsx': 'deka', '.phpx': 'deka', '.js': 'js', '.ts': 'ts', '.mjs': 'js', '.toml': 'toml', '.json': 'json', '.md': 'md', '.yml': 'yaml', '.yaml': 'yaml', '.css': 'css', '.html': 'html' };

const allText = new Map();

const SYM_RE = /^([ \t]*)((?:(?:pub(?:\([^)]*\))?|export|async)\s+)*)?(fn|struct|enum|trait|impl|mod|const|static|type|class|interface|let|var)\s+([A-Za-z_$][\w$]*)/;

function walk(dir, base) {
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter(e => !SKIP.has(e.name) && !e.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name));
  const node = { name: 'root', path: relative(SRC, dir) || '', type: 'dir', children: [] };
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      const sub = walk(p);
      sub.name = e.name;
      node.children.push(sub);
    } else if (e.isFile() && statSync(p).size < 512 * 1024) {
      const text = readFileSync(p, 'utf8');
      const lines = sourceLines(text);
      allText.set(relative(SRC, p), text);
      const lang = LANG[extname(e.name)] || 'other';
      const syms = [];
      const lineStarts = [];
      lines.forEach((l, i) => {
        const m = SYM_RE.exec(l);
        if (!m) return;
        const [, indent, , kind, name] = m;
        if ((kind === 'let' || kind === 'var') && indent !== '') return;
        syms.push({ name, kind, line: i });
        lineStarts.push(i);
      });
      // symbol ranges: from decl line to the next decl line (crude but fine for viz)
      for (let i = 0; i < syms.length; i++) syms[i].endLine = (i + 1 < syms.length ? syms[i + 1].line : lines.length - 1);
      node.children.push({ name: e.name, path: relative(SRC, p), type: 'file', lines: lines.length, lang, syms, source: sourceDimensions(lines) });
    }
  }
  return node;
}

function langOf(node) {
  if (node.type === 'file') return node.lang;
  const counts = {};
  for (const c of node.children || []) { const l = langOf(c); if (l) counts[l] = (counts[l] || 0) + 1; }
  node.dominantLang = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
  return node.dominantLang;
}

function weight(node) {
  if (node.type === 'file') return Math.max(node.lines, 4);
  node.lines = (node.children || []).reduce((a, c) => a + (c.lines || weight(c)), 0);
  return Math.max(node.lines, 4);
}

const tree = walk(SRC, true);
weight(tree);
langOf(tree);
const layout = layoutDocuments(tree);

// flat search table: every symbol and every file, with textual ref counts
const symbolRows = [];
const fileRows = [];
(function collect(node) {
  if (node.type === 'file') {
    fileRows.push({ name: node.name, path: node.path, lines: node.lines, lang: node.lang, rect: node.rect, source: node.source });
    for (const s of node.syms) symbolRows.push({ name: s.name, kind: s.kind, path: node.path, line: s.line, endLine: s.endLine, lang: node.lang, rect: node.rect });
  }
  for (const c of node.children || []) collect(c);
})(tree);

const counts = new Map();
for (const s of symbolRows) {
  if (counts.has(s.name)) continue;
  let n = 0;
  const re = new RegExp(`\\b${s.name.replace(/[$]/g, '\\$')}\\b`, 'g');
  for (const text of allText.values()) {
    n += (text.match(re) || []).length;
  }
  counts.set(s.name, n);
}
for (const s of symbolRows) s.refs = counts.get(s.name) || 1;

const out = {
  project: SRC.split(/[\\/]/).filter(Boolean).at(-1),
  sourceBase: process.argv[4] || 'demo-src',
  layout,
  files: fileRows.length,
  symbols: symbolRows.length,
  totalLines: tree.lines,
  tree, symbolsTable: symbolRows, filesTable: fileRows,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
console.log(`indexed ${out.files} files, ${out.symbols} symbols, ${out.totalLines} lines → ${OUT}`);
