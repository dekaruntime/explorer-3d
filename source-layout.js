// Shared by the static indexer and the canvas painter. Dimensions describe the
// whole document, not a preview crop or a fixed-size rooftop.
export const SOURCE_FONT = 13;
export const SOURCE_LINE = 17;
export const SOURCE_PAD = 12;
export function sourceLines(text) {
  return text.replace(/\r\n?/g, '\n').split('\n').map(line => {
    let column = 0;
    return line.replace(/[^\t]|\t/g, ch => {
      const n = ch === '\t' ? 4 - column % 4 : 1;
      column += n;
      return ch === '\t' ? ' '.repeat(n) : ch;
    });
  });
}
export function sourceDimensions(lines) {
  let columns = 0;
  for (const line of lines) columns = Math.max(columns, line.length);
  // Eight pixels per UTF-16 code unit is conservative for the 13px monospace
  // font. fillText's maxWidth also keeps wider fallback glyphs inside the page.
  return { width: Math.max(288, columns * 8 + SOURCE_PAD * 2),
    height: Math.max(1, lines.length) * SOURCE_LINE + SOURCE_PAD * 2 };
}

// Pack full-size documents without changing their aspect ratios. Directories
// remain blocks, with streets between files and padding between directories.
// One uniform scale normalizes the entire city after packing.
export function layoutDocuments(tree) {
  const GAP = 48, PAD = 64;
  function size(node) {
    if (node.type === 'file') return { node, w: node.source.width, h: node.source.height };
    const items = node.children.map(size).sort((a, b) => b.h - a.h || b.w - a.w || a.node.path.localeCompare(b.node.path));
    const total = items.reduce((sum, it) => sum + (it.w + GAP) * (it.h + GAP), 0);
    const target = Math.max(288, ...items.map(it => it.w), Math.sqrt(total) * 1.15);
    let x = PAD, y = PAD, rowHeight = 0, width = 0;
    for (const it of items) {
      if (x > PAD && x + it.w > target + PAD) { x = PAD; y += rowHeight + GAP; rowHeight = 0; }
      it.node.rect = [x, y, it.w, it.h];
      x += it.w + GAP;
      rowHeight = Math.max(rowHeight, it.h);
      width = Math.max(width, x - GAP + PAD);
    }
    return { node, w: Math.max(PAD * 2, width), h: y + rowHeight + PAD };
  }
  const bounds = size(tree), scale = 1 / Math.max(bounds.w, bounds.h);
  tree.rect = [0, 0, bounds.w, bounds.h];
  function place(node, x, y) {
    const [dx, dy, w, h] = node.rect;
    node.rect = [(x + dx) * scale, (y + dy) * scale, w * scale, h * scale];
    for (const child of node.children || []) place(child, x + dx, y + dy);
  }
  place(tree, (1 / scale - bounds.w) / 2, (1 / scale - bounds.h) / 2);
  return { type: 'source-documents', unitsPerPixel: scale };
}
