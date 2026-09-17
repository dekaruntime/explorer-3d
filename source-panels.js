import * as THREE from 'three';
import { SOURCE_FONT, SOURCE_LINE as LINE, SOURCE_PAD as PAD, sourceLines } from './source-layout.js';

// Each rooftop has the dimensions of its complete source. Rasterize visible tiles,
// directly from text at each resolution (never magnify a lower-resolution tile).
const TILE = 512, GUTTER = 2;
const SIDE = TILE + GUTTER * 2;
const TILE_BYTES = Math.ceil(SIDE * SIDE * 4 * 4 / 3); // RGBA + mip chain
const MAX_BYTES = 128 * 1024 * 1024;
const MAX_TILES = Math.floor(MAX_BYTES / TILE_BYTES);
const scaleAt = level => 2 ** (level / 2); // half-octaves avoid 4x pixel jumps
const KW = /\b(pub|fn|let|mut|impl|struct|enum|trait|mod|use|match|if|else|return|for|while|const|static|type|import|from|export|as|async|await|self|crate|effect|signal|node)\b/;
const color = line => {
  const t = line.trim();
  if (t.startsWith('//') || t.startsWith('#')) return '#7c899e';
  if (KW.test(line)) return '#7ee0d2';
  if (/".*"/.test(line)) return '#e8b93d';
  return /\b\d+\b/.test(line) ? '#c5b7f1' : '#c1cbd9';
};

// Clip the actual leaned panel in homogeneous coordinates, preserving document
// coordinates. This also finds panels whose center is outside the viewport.
function clipPolygon(vertices) {
  for (const distance of [p => p.w + p.x, p => p.w - p.x,
    p => p.w + p.y, p => p.w - p.y, p => p.w + p.z, p => p.w - p.z]) {
    const next = [];
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i], b = vertices[(i + 1) % vertices.length];
      const da = distance(a), db = distance(b);
      if (da >= 0) next.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db), p = {};
        for (const k of ['x', 'y', 'z', 'w', 'u', 'v']) p[k] = a[k] + (b[k] - a[k]) * t;
        next.push(p);
      }
    }
    vertices = next;
    if (!vertices.length) break;
  }
  return vertices;
}

export class SourcePanels {
  constructor({ scene, camera, renderer, nodes, heightOf, world, base, onChange, colorOf = () => 0xf74c00, showBuilding = () => {}, sourceBase = 'demo-src' }) {
    Object.assign(this, { camera, renderer, onChange, colorOf, showBuilding, sourceBase });
    this.group = new THREE.Group();
    scene.add(this.group);
    this.overlay = new THREE.Scene();
    this.cache = new Map();
    this.sources = new Map();
    this.requests = [];
    this.inFlight = 0;
    this.clock = 0;
    this.paints = 0;
    this.focused = null;
    this.active = null;
    this.measurements = 0;
    this.pending = false;
    this.matrix = new THREE.Matrix4();
    this.viewProjection = new THREE.Matrix4();
    this.entries = nodes.map(n => {
      const [x, z, w, h] = n.rect;
      const width = w * world, height = h * world;
      const root = new THREE.Group();
      root.position.set((x + w / 2) * world, base + heightOf(n) + .15, (z + h) * world);
      root.visible = false;
      // Inactive files have no panel meshes in the scene graph. The overview
      // stays one instanced city, without hidden per-file matrix traversal.
      return { n, root, width, height, depth: heightOf(n),
        docWidth: n.source.width, docHeight: n.source.height, level: 0 };
    });
    this.byNode = new Map(this.entries.map(e => [e.n, e]));
  }

  focus(n) {
    if (this.focused === n) return;
    if (this.active) {
      this.active.root.visible = false;
      this.overlay.remove(this.active.root);
      this.showBuilding(this.active.n, true);
    }
    this.focused = n;
    this.active = this.byNode.get(n) || null;
    const e = this.active;
    if (e) {
      if (!e.background) {
        const geometry = new THREE.PlaneGeometry(e.width, e.height);
        geometry.translate(0, e.height / 2, 0);
        e.background = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x11141d }));
        e.background.userData.node = n;
        const rim = 8 * e.width / e.docWidth;
        e.backing = new THREE.Mesh(new THREE.BoxGeometry(e.width + 2 * rim, e.height + 2 * rim, e.depth),
          new THREE.MeshLambertMaterial({ color: this.colorOf(n) }));
        e.backing.position.set(0, e.height / 2, -e.depth / 2 - .05);
        e.backing.userData.node = n;
        e.root.add(e.backing, e.background);
      }
      this.overlay.add(e.root);
      this.showBuilding(n, false);
    }
    this.onChange();
  }

  // Fetch only visible source, with explicit loading/ready/error states. A late
  // response never invalidates tiles or inserts HTML error pages into a canvas.
  load(path, priority) {
    if (this.sources.has(path)) return;
    this.sources.set(path, { status: 'loading' });
    if (priority) this.requests.unshift(path); else this.requests.push(path);
    this.pump();
  }

  pump() {
    while (this.inFlight < 4 && this.requests.length) {
      const path = this.requests.shift();
      this.inFlight++;
      fetch(`${this.sourceBase}/${path.split('/').map(encodeURIComponent).join('/')}`)
        .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
        .then(text => this.sources.set(path, { status: 'ready', lines: sourceLines(text) }))
        .catch(() => this.sources.set(path, { status: 'error', lines: ['// Source unavailable. Reload to retry.'] }))
        .finally(() => { this.inFlight--; this.pump(); this.onChange(); });
    }
  }

  project(e, u, v) {
    const p = new THREE.Vector4((u / e.docWidth - .5) * e.width, (e.docHeight - v) * e.height / e.docHeight, 0, 1)
      .applyMatrix4(this.matrix);
    return { x: p.x, y: p.y, z: p.z, w: p.w, u, v };
  }

  measure(e, viewport) {
    this.measurements++;
    this.matrix.multiplyMatrices(this.viewProjection, e.root.matrixWorld);
    const polygon = clipPolygon([this.project(e, 0, 0), this.project(e, e.docWidth, 0),
      this.project(e, e.docWidth, e.docHeight), this.project(e, 0, e.docHeight)]);
    if (!polygon.length) return null;
    let density = 0, u0 = e.docWidth, v0 = e.docHeight, u1 = 0, v1 = 0;
    let sx0 = Infinity, sx1 = -Infinity, sy0 = Infinity, sy1 = -Infinity;
    for (const p of polygon) {
      u0 = Math.min(u0, p.u); u1 = Math.max(u1, p.u);
      v0 = Math.min(v0, p.v); v1 = Math.max(v1, p.v);
      const sx = p.x / p.w, sy = p.y / p.w;
      sx0 = Math.min(sx0, sx); sx1 = Math.max(sx1, sx);
      sy0 = Math.min(sy0, sy); sy1 = Math.max(sy1, sy);
      // Projective Jacobian in physical pixels per document unit. Evaluating
      // at the clipped vertices includes the closest (largest) visible edge.
      for (const [du, dv] of [[1, 0], [0, 1]]) {
        const q = this.project(e, p.u + du, p.v + dv);
        const dw = q.w - p.w;
        const dx = ((q.x - p.x) * p.w - p.x * dw) / (p.w * p.w);
        const dy = ((q.y - p.y) * p.w - p.y * dw) / (p.w * p.w);
        density = Math.max(density, Math.hypot(dx * viewport.x / 2, dy * viewport.y / 2));
      }
    }
    let area = 0;
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i], b = polygon[(i + 1) % polygon.length];
      area += (a.x * b.y - b.x * a.y) / (a.w * b.w);
    }
    return { u0, v0, u1, v1, density, pixels: (sx1 - sx0) * viewport.x / 2,
      area: Math.abs(area) / 2 };
  }

  update(lean, { moving = false, detail = true } = {}) {
    this.clock++;
    this.coveringViewport = false;
    this.reading = false;
    this.pending = false;
    const e = this.active;
    // No projection, source fetch, canvas paint or tile scheduling at map scale.
    if (!e) return 0;
    e.root.rotation.x = -Math.PI / 2 + lean;
    e.root.visible = true;
    e.root.updateMatrixWorld(true);
    if (!detail) {
      e.background.visible = false;
      for (const tile of this.cache.values()) if (tile.e === e && !tile.preview) tile.mesh.visible = false;
      return 0;
    }
    this.viewProjection.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    const viewport = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const m = this.measure(e, viewport);
    e.background.visible = !!m && m.pixels / this.renderer.getPixelRatio() >= 100;
    if (!e.background.visible) {
      for (const tile of this.cache.values()) if (tile.e === e && !tile.preview) tile.mesh.visible = false;
      return 0;
    }
    const scale = scaleAt(e.level);
    if (m.density * 1.15 > scale || m.density * 3 < scale)
      e.level = Math.max(0, Math.ceil(2 * Math.log2(Math.max(1, m.density * 1.15))));
    e.measure = m;
    this.coveringViewport = m.area > 3.9999;
    this.reading = true;
    const candidates = [e];
    const wanted = [];
    for (const e of candidates) {
      this.load(e.n.path, e.n === this.focused);
      // A tiny whole-panel preview fills gaps while detail tiles arrive.
      // It occupies a cache slot too, so it cannot escape the memory budget.
      wanted.push({ e, preview: true, key: `${e.n.path}:preview` });
      if (wanted.length === MAX_TILES) break;
      const m = e.measure, capacity = MAX_TILES - wanted.length;
      let span, x0, x1, y0, y1;
      // A neighboring panel may cross the near plane. Its projective density
      // can approach infinity: bound enumeration before creating any jobs.
      do {
        span = TILE / scaleAt(e.level);
        x0 = Math.max(0, Math.floor(m.u0 / span)); x1 = Math.ceil(Math.min(e.docWidth, m.u1) / span);
        y0 = Math.max(0, Math.floor(m.v0 / span)); y1 = Math.ceil(Math.min(e.docHeight, m.v1) / span);
        if ((x1 - x0) * (y1 - y0) <= capacity || e.level === 0) break;
        e.level--;
      } while (true);
      const tiles = [];
      for (let y = y0; y < y1 && tiles.length < MAX_TILES; y++) for (let x = x0; x < x1 && tiles.length < MAX_TILES; x++) {
        tiles.push({ e, x, y, level: e.level, key: `${e.n.path}:${e.level}:${x}:${y}`,
          rank: (x + .5 - (x0 + x1) / 2) ** 2 + (y + .5 - (y0 + y1) / 2) ** 2 });
      }
      tiles.sort((a, b) => a.rank - b.rank);
      wanted.push(...tiles.slice(0, MAX_TILES));
      if (wanted.length >= MAX_TILES) break;
    }
    const selected = wanted.slice(0, MAX_TILES), keys = new Set(selected.map(t => t.key));
    const complete = new Set(selected.map(t => t.e));
    for (const t of selected) {
      const tile = this.cache.get(t.key);
      if (tile) tile.used = this.clock;
      else complete.delete(t.e);
    }
    // Keep old tiles visible as a fallback during refinement. They are never
    // destroyed just because the desired resolution changes.
    for (const [key, tile] of this.cache) {
      if (!tile.preview) {
        tile.mesh.visible = keys.has(key) || (tile.e.root.visible && !complete.has(tile.e));
        tile.mesh.renderOrder = keys.has(key) ? 1000 : 10 + tile.level;
      }
    }
    let missing = false, painted = 0;
    const deadline = performance.now() + 3;
    for (const t of selected) {
      if (this.cache.has(t.key)) continue;
      const source = this.sources.get(t.e.n.path);
      if (source?.status === 'loading' || !source) continue;
      missing = true;
      if (painted && (painted >= (moving ? 1 : 4) || performance.now() >= deadline)) continue;
      if (this.cache.size >= MAX_TILES) {
        let oldest;
        for (const [key, tile] of this.cache) {
          if (!keys.has(key) && (!oldest || tile.used < oldest[1].used)) oldest = [key, tile];
        }
        if (!oldest) continue;
        this.drop(oldest[0]);
      }
      if (t.preview) this.paintPreview(t, source.lines); else this.paint(t, source.lines);
      painted++;
    }
    this.pending = missing;
    return painted;
  }

  paintPreview({ e, key }, lines) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#11141d'; ctx.fillRect(0, 0, 256, 256);
    ctx.scale(256 / e.docWidth, 256 / e.docHeight);
    ctx.font = `${SOURCE_FONT}px ui-monospace, Menlo, monospace`; ctx.textBaseline = 'top';
    for (let i = 0; i < lines.length; i += Math.max(1, Math.floor(lines.length / 256))) {
      ctx.fillStyle = color(lines[i]); ctx.fillText(lines[i], PAD, i * LINE + PAD, e.docWidth - 2 * PAD);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    e.background.material.map = texture;
    e.background.material.color.setHex(0xffffff);
    e.background.material.needsUpdate = true;
    this.cache.set(key, { e, preview: true, mesh: e.background, used: this.clock });
    this.paints++;
  }

  paint(t, lines) {
    const { e, x, y, level, key } = t, scale = scaleAt(level), span = TILE / scale;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIDE;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#11141d'; ctx.fillRect(0, 0, SIDE, SIDE);
    ctx.setTransform(scale, 0, 0, scale, GUTTER - x * TILE, GUTTER - y * TILE);
    ctx.font = `${SOURCE_FONT}px ui-monospace, Menlo, monospace`;
    ctx.textBaseline = 'top';
    const first = Math.max(0, Math.floor((y * span - GUTTER / scale - PAD) / LINE));
    const last = Math.min(lines.length, Math.ceil(((y + 1) * span + GUTTER / scale - PAD) / LINE));
    for (let i = first; i < last; i++) {
      ctx.fillStyle = color(lines[i]);
      ctx.fillText(lines[i], PAD, i * LINE + PAD, e.docWidth - 2 * PAD);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    const w = Math.min(span, e.docWidth - x * span), h = Math.min(span, e.docHeight - y * span);
    const units = e.width / e.docWidth;
    const geometry = new THREE.PlaneGeometry(w * units, h * units);
    geometry.translate((x * span + w / 2 - e.docWidth / 2) * units, (e.docHeight - y * span - h / 2) * units, 0);
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i,
      (GUTTER + uv.getX(i) * w * scale) / SIDE,
      1 - (GUTTER + (1 - uv.getY(i)) * h * scale) / SIDE);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map: texture,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    mesh.renderOrder = 1000;
    e.root.add(mesh);
    this.cache.set(key, { e, level, mesh, used: this.clock });
    this.paints++;
  }

  drop(key) {
    const tile = this.cache.get(key);
    tile.mesh.material.map.dispose();
    tile.mesh.material.map.image.width = tile.mesh.material.map.image.height = 1;
    if (tile.preview) {
      tile.mesh.material.map = null;
      tile.mesh.material.color.setHex(0x11141d);
      tile.mesh.material.needsUpdate = true;
    } else {
      tile.e.root.remove(tile.mesh);
      tile.mesh.material.dispose(); tile.mesh.geometry.dispose();
    }
    this.cache.delete(key);
  }

  render() {
    // A separate final pass makes focus deterministic across opaque and
    // transparent scene objects; renderOrder alone cannot do that.
    if (!this.active) return;
    this.renderer.clearDepth();
    this.renderer.render(this.overlay, this.camera);
  }

  get stats() {
    return { tiles: this.cache.size, maxTiles: MAX_TILES, bytes: this.cache.size * TILE_BYTES,
      maxBytes: MAX_BYTES, measurements: this.measurements, paints: this.paints, pending: this.pending, inFlight: this.inFlight };
  }
}
