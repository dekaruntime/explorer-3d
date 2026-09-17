// deka explorer POC frontend.
// World: treemap of files as buildings on a 1000x1000 plane, y-up.
// Files = instanced boxes (height ~ sqrt(lines)), dirs = outlined regions.
// Zoom LOD: file tops get live-rendered source textures; symbols become boxes.
import * as THREE from 'three';

const WORLD = 1000;
const LANG_COLOR = {
  rust: 0xf74c00, deka: 0x2dd4bf, js: 0xe8d44d, ts: 0x4f9cf5,
  toml: 0x9aa7b8, json: 0x9aa7b8, md: 0xb8a9e8, yaml: 0x6fbf73, other: 0x5a6a85,
};
const KIND_COLOR = { fn: 0x2dd4bf, struct: 0xf74c00, enum: 0xe8b93d, trait: 0xb8a9e8, impl: 0x6fbf73, const: 0x9aa7b8, static: 0x9aa7b8, type: 0x4f9cf5, mod: 0x748199, class: 0xf74c00, interface: 0x4f9cf5, let: 0x9aa7b8, var: 0x9aa7b8 };

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);
scene.fog = new THREE.Fog(0x0b0e14, 1400, 3200);

const camera = new THREE.PerspectiveCamera(42, 1, 1, 8000);

// --- camera rig: target on ground plane + distance, slight tilt ------------
const rig = {
  tx: WORLD / 2, tz: WORLD / 2, dist: 1500,
  goalTx: WORLD / 2, goalTz: WORLD / 2, goalDist: 1500,
  min: 30, max: 2400, tilt: 0.96, // rad from vertical; ~55°
};
function applyCamera() {
  rig.tx += (rig.goalTx - rig.tx) * 0.16;
  rig.tz += (rig.goalTz - rig.tz) * 0.16;
  rig.dist += (rig.goalDist - rig.dist) * 0.16;
  // google-maps style: far = horizon tilt, close = top-down so code reads
  const t = 0.35 + (rig.dist / rig.max) * 0.61;
  const y = Math.cos(t) * rig.dist;
  const back = Math.sin(t) * rig.dist;
  camera.position.set(rig.tx, y, rig.tz + back);
  camera.lookAt(rig.tx, 0, rig.tz);
}
function flyTo(tx, tz, dist) {
  rig.goalTx = tx; rig.goalTz = tz;
  rig.goalDist = Math.max(rig.min, Math.min(rig.max, dist));
}
function zoomAt(px, pz, factor) {
  // keep the world point under the cursor stationary
  rig.goalTx = px + (rig.goalTx - px) * factor;
  rig.goalTz = pz + (rig.goalTz - pz) * factor;
  rig.goalDist = Math.max(rig.min, Math.min(rig.max, rig.goalDist * factor));
}

// --- pan / zoom controls ----------------------------------------------------
let dragging = false, moved = 0, lx = 0, ly = 0;
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
function screenToGround(cx, cy, out) {
  ndc.set((cx / innerWidth) * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.ray.intersectPlane(groundPlane, out);
}
const hitA = new THREE.Vector3(), hitB = new THREE.Vector3();
canvas.addEventListener('pointerdown', e => { dragging = true; moved = 0; lx = e.clientX; ly = e.clientY; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => {
  if (!dragging) return;
  const dx = e.clientX - lx, dy = e.clientY - ly;
  moved += Math.abs(dx) + Math.abs(dy);
  lx = e.clientX; ly = e.clientY;
  if (screenToGround(e.clientX, e.clientY, hitA) && screenToGround(e.clientX - dx, e.clientY - dy, hitB)) {
    rig.goalTx -= hitA.x - hitB.x;
    rig.goalTz -= hitA.z - hitB.z;
    rig.tx -= hitA.x - hitB.x;
    rig.tz -= hitA.z - hitB.z;
  }
});
canvas.addEventListener('pointerup', e => {
  dragging = false;
  if (moved < 5) { // click: focus building under cursor
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects([fileMesh], false);
    if (hits.length) focusFile(fileNodes[hits[0].instanceId]);
  }
});
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const f = Math.pow(1.0011, e.deltaY);
  if (screenToGround(e.clientX, e.clientY, hitA)) zoomAt(hitA.x, hitA.z, f);
}, { passive: false });

// --- data -------------------------------------------------------------------
const resp = await fetch('data.json');
const data = await resp.json();
document.getElementById('stats').textContent =
  `${data.project} · ${data.files} files · ${data.totalLines.toLocaleString()} lines · ${data.symbols.toLocaleString()} symbols`;

const fileNodes = [];   // flat, parallel to fileMesh instances
const dirNodes = [];
(function collect(node, isRoot) {
  if (node.type === 'file') fileNodes.push(node);
  else if (!isRoot) dirNodes.push(node);
  for (const c of node.children || []) collect(c);
})(data.tree, true);

const heightOf = n => Math.max(6, Math.min(260, Math.sqrt(n.lines) * 9));
const BASE = 1.5; // dir slab height; buildings sit on top
const boxHeight = new Map(fileNodes.map(n => [n, heightOf(n)]));

// --- buildings: one InstancedMesh -------------------------------------------
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const boxMat = new THREE.MeshLambertMaterial();
const fileMesh = new THREE.InstancedMesh(boxGeo, boxMat, fileNodes.length);
{
  const m = new THREE.Matrix4(), col = new THREE.Color();
  fileNodes.forEach((n, i) => {
    const [x, y, w, h] = n.rect;
    const bh = boxHeight.get(n);
    m.makeScale(w * WORLD - 0.6, bh, h * WORLD - 0.6);
    m.setPosition((x + w / 2) * WORLD, BASE + bh / 2, (y + h / 2) * WORLD);
    fileMesh.setMatrixAt(i, m);
    fileMesh.setColorAt(i, col.setHex(LANG_COLOR[n.lang] ?? LANG_COLOR.other).multiplyScalar(0.85));
  });
}
fileMesh.instanceMatrix.needsUpdate = true;
scene.add(fileMesh);

// --- dir slabs + outlines ------------------------------------------------------
{
  // translucent slabs so directories read as city blocks
  const slabGeo = new THREE.BoxGeometry(1, 1, 1);
  const slabMat = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.28 });
  const slabs = new THREE.InstancedMesh(slabGeo, slabMat, dirNodes.length);
  const m = new THREE.Matrix4(), col = new THREE.Color();
  dirNodes.forEach((n, i) => {
    const [x, y, w, h] = n.rect;
    m.makeScale(w * WORLD, 1.4, h * WORLD);
    m.setPosition((x + w / 2) * WORLD, 0.7, (y + h / 2) * WORLD);
    slabs.setMatrixAt(i, m);
    slabs.setColorAt(i, col.setHex(0x22304a));
  });
  scene.add(slabs);

  const pts = [];
  for (const n of dirNodes) {
    const [x, y, w, h] = n.rect;
    const x0 = x * WORLD, z0 = y * WORLD, x1 = (x + w) * WORLD, z1 = (y + h) * WORLD;
    pts.push(x0, 1.6, z0, x1, 1.6, z0, x1, 1.6, z0, x1, 1.6, z1, x1, 1.6, z1, x0, 1.6, z1, x0, 1.6, z1, x0, 1.6, z0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x41598a, transparent: true, opacity: 0.85 })));
}

// --- lights ------------------------------------------------------------------
scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const sun = new THREE.DirectionalLight(0xfff2e0, 1.6);
sun.position.set(300, 900, 500);
scene.add(sun);

// --- source text tops (LOD textures) -----------------------------------------
const KW = /\b(pub|fn|let|mut|impl|struct|enum|trait|mod|use|match|if|else|return|for|while|const|static|type|import|from|export|as|async|await|self|crate|effect|signal|node)\b/;
const texCache = new Map(); // node -> {tex, mesh, lastUsed}
const MAX_TEX = 60;
const textGroup = new THREE.Group();
scene.add(textGroup);

function paintSource(ctx, n, wpx, hpx) {
  ctx.fillStyle = '#11141d';
  ctx.fillRect(0, 0, wpx, hpx);
  ctx.font = `${13 * (wpx / 560)}px ui-monospace, Menlo, monospace`;
  const lineH = 17 * (wpx / 560);
  ctx.textBaseline = 'top';
  return lineH;
}
function tokenColor(line) {
  const t = line.trim();
  if (t.startsWith('//') || t.startsWith('#')) return '#546178';
  if (KW.test(line)) return '#7ee0d2';
  if (/".*"/.test(line)) return '#e8b93d';
  if (/\b\d+\b/.test(line)) return '#b8a9e8';
  return '#aab6c8';
}
function loadSource(path) {
  if (sourceText.has(path)) return;
  sourceText.set(path, ''); // mark in-flight
  fetch(`demo-src/${path}`).then(r => r.text()).then(t => {
    sourceText.set(path, t);
    // repaint any texture created while text was in flight
    const node = fileNodes.find(n => n.path === path);
    const e = node && texCache.get(node);
    if (e) {
      textGroup.remove(e.mesh);
      e.mesh.material.map.dispose();
      e.mesh.material.dispose();
      texCache.delete(node);
    }
  });
}
function ensureTexture(n) {
  let e = texCache.get(n);
  if (e) { e.lastUsed = frame; return e; }
  if (texCache.size >= MAX_TEX) {
    let oldest = null;
    for (const [k, v] of texCache) if (!oldest || v.lastUsed < oldest.lastUsed) oldest = { k, v };
    if (oldest) { textGroup.remove(oldest.v.mesh); oldest.v.mesh.material.map.dispose(); oldest.v.mesh.material.dispose(); oldest.v.mesh.geometry.dispose(); texCache.delete(oldest.k); }
  }
  const [x, y, w, h] = n.rect;
  const wpx = 560, hpx = Math.max(64, Math.min(1024, Math.round((h / w) * wpx)));
  const cv = document.createElement('canvas');
  cv.width = wpx; cv.height = hpx;
  const ctx = cv.getContext('2d');
  const lineH = paintSource(ctx, n, wpx, hpx);
  const src = sourceText.get(n.path) || '';
  if (!src) loadSource(n.path); // paint bg now, repaint when text arrives
  const lines = src.split('\n');
  const maxLines = Math.floor(hpx / lineH);
  for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
    ctx.fillStyle = tokenColor(lines[i]);
    ctx.fillText(lines[i].slice(0, 90), 6, i * lineH + 2);
  }
  if (lines.length > maxLines) {
    ctx.fillStyle = '#f74c00';
    ctx.fillRect(0, hpx - 3, wpx * (maxLines / lines.length), 3);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const geo = new THREE.PlaneGeometry(w * WORLD - 1, h * WORLD - 1);
  const mat = new THREE.MeshBasicMaterial({ map: tex });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  const bh = boxHeight.get(n);
  mesh.position.set((x + w / 2) * WORLD, BASE + bh + 0.15, (y + h / 2) * WORLD);
  textGroup.add(mesh);
  e = { tex, mesh, lastUsed: frame };
  texCache.set(n, e);
  return e;
}
function updateTextTops() {
  // give a file a source texture when its on-screen width is large enough
  const v = new THREE.Vector3();
  for (const n of fileNodes) {
    v.set((n.rect[0] + n.rect[2] / 2) * WORLD, 0, (n.rect[1] + n.rect[3] / 2) * WORLD).project(camera);
    const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
    if (sx < -200 || sx > innerWidth + 200 || sy < -200 || sy > innerHeight + 200) continue;
    const wpx = n.rect[2] * WORLD / worldPerPixel();
    if (wpx > 190) ensureTexture(n);
  }
}
const _wpp = new THREE.Vector3();
function worldPerPixel() {
  _wpp.set((data.tree.rect[2]) * WORLD, 0, 0).project(camera);
  const ax = (_wpp.x * 0.5 + 0.5) * innerWidth;
  _wpp.set(data.tree.rect[2] * WORLD + 10, 0, 0).project(camera);
  return 10 / Math.abs(((_wpp.x * 0.5 + 0.5) * innerWidth) - ax);
}

// --- symbol boxes at close zoom ----------------------------------------------
const SYM_MAX = 4096;
const symGeo = new THREE.BoxGeometry(1, 1, 1);
const symMesh = new THREE.InstancedMesh(symGeo, new THREE.MeshBasicMaterial(), SYM_MAX);
symMesh.count = 0;
scene.add(symMesh);
function updateSymbols() {
  const close = rig.dist < 260;
  let count = 0;
  if (close) {
    const m = new THREE.Matrix4(), col = new THREE.Color();
    for (const n of fileNodes) {
      if (count >= SYM_MAX - 8) break;
      if (!texCache.has(n)) continue;
      const [x, y, w, h] = n.rect;
      const bh = boxHeight.get(n);
      const nSyms = n.syms.length;
      if (!nSyms) continue;
      const fh = h * WORLD - 2;
      for (const s of n.syms) {
        const y0 = (s.line / Math.max(n.lines, 1)) * fh;
        const y1 = (Math.max(s.endLine, s.line + 1) / Math.max(n.lines, 1)) * fh;
        const sh = Math.max(1.2, y1 - y0);
        m.makeScale(w * WORLD - 2, 1.1, sh);
        m.setPosition((x + w / 2) * WORLD, BASE + bh + 0.7, y * WORLD + 1 + y0 + sh / 2);
        symMesh.setMatrixAt(count, m);
        symMesh.setColorAt(count, col.setHex(KIND_COLOR[s.kind] ?? 0x9aa7b8));
        count++;
      }
    }
  }
  symMesh.count = count;
  symMesh.instanceMatrix.needsUpdate = true;
  if (symMesh.instanceColor) symMesh.instanceColor.needsUpdate = true;
}

// --- labels (HTML overlay) ----------------------------------------------------
const labelPool = [];
const labelsEl = document.getElementById('labels');
function labelFor() {
  let el = labelPool.find(l => !l.used);
  if (!el) {
    const div = document.createElement('div');
    div.className = 'lbl';
    labelsEl.appendChild(div);
    el = { div, used: false };
    labelPool.push(el);
  }
  el.used = true;
  el.div.style.display = 'block';
  return el;
}
const projV = new THREE.Vector3();
function updateLabels() {
  for (const l of labelPool) { l.used = false; l.div.style.display = 'none'; }
  const wpp = worldPerPixel();
  const labelDirs = wpp < 2.2;
  const labelFiles = wpp < 0.09;
  const placed = [];
  const tryPlace = (n, isDir) => {
    if (placed.length > 70) return;
    const [x, y, w, h] = n.rect;
    const pxw = w * WORLD / wpp;
    if (pxw < (isDir ? 60 : 46)) return;
    projV.set((x + w / 2) * WORLD, 0, (y + h / 2) * WORLD).project(camera);
    if (projV.z > 1) return;
    const sx = (projV.x * 0.5 + 0.5) * innerWidth, sy = (-projV.y * 0.5 + 0.5) * innerHeight;
    if (sx < 0 || sx > innerWidth || sy < 30 || sy > innerHeight) return;
    for (const p of placed) if (Math.abs(p[0] - sx) < 70 && Math.abs(p[1] - sy) < 16) return;
    placed.push([sx, sy]);
    const el = labelFor();
    el.div.textContent = isDir ? n.name : n.name;
    el.div.className = 'lbl' + (isDir ? ' dir' : '');
    el.div.style.left = sx + 'px';
    el.div.style.top = sy + 'px';
  };
  if (labelDirs) for (const n of dirNodes) tryPlace(n, true);
  if (labelFiles) for (const n of fileNodes) tryPlace(n, false);
}

// --- highlight ----------------------------------------------------------------
const hl = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
  new THREE.LineBasicMaterial({ color: 0xf74c00 }));
hl.visible = false;
scene.add(hl);
function focusFile(n) {
  const [x, y, w, h] = n.rect;
  flyTo((x + w / 2) * WORLD, (y + h / 2) * WORLD, Math.max(60, Math.max(w, h) * WORLD * 1.5));
  const bh = boxHeight.get(n);
  hl.scale.set(w * WORLD + 2, bh + 4, h * WORLD + 2);
  hl.position.set((x + w / 2) * WORLD, BASE + (bh + 2) / 2, (y + h / 2) * WORLD);
  hl.visible = true;
}

// --- search ----------------------------------------------------------------------
const sourceText = new Map();
const qEl = document.getElementById('q');
const resEl = document.getElementById('results');
let results = [], selIdx = -1;

function fuzzy(needle, hay) {
  needle = needle.toLowerCase(); hay = hay.toLowerCase();
  if (!needle) return -1;
  const idx = hay.indexOf(needle);
  if (idx >= 0) return 100 - idx - (hay.length - needle.length) * 0.1;
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length ? 10 : -1;
}
function runSearch() {
  const q = qEl.value.trim();
  selIdx = -1;
  if (q.length < 2) { resEl.classList.remove('open'); return; }
  results = [];
  for (const s of data.symbolsTable) {
    const sc = fuzzy(q, s.name);
    if (sc >= 0) results.push({ ...s, score: sc + 5, kind: s.kind });
  }
  for (const f of data.filesTable) {
    const sc = fuzzy(q, f.name);
    if (sc >= 0) results.push({ ...f, score: sc, kind: f.lang, line: 0 });
  }
  results.sort((a, b) => b.score - a.score);
  results = results.slice(0, 40);
  resEl.innerHTML = results.map((r, i) =>
    `<div class="res" data-i="${i}"><span class="kind">${r.kind}</span><span>${r.name}</span><span class="path">${r.path}${r.line ? ':' + (r.line + 1) : ''}</span>${r.refs ? `<span class="refs">${r.refs}×</span>` : ''}</div>`).join('');
  resEl.classList.add('open');
  resEl.querySelectorAll('.res').forEach(el => el.addEventListener('mousedown', () => pick(+el.dataset.i)));
}
function pick(i) {
  const r = results[i];
  if (!r) return;
  resEl.classList.remove('open');
  qEl.blur();
  const node = fileNodes.find(n => n.path === r.path);
  if (node) { loadSource(node.path); focusFile(node); }
}
qEl.addEventListener('input', runSearch);
qEl.addEventListener('keydown', e => {
  if (e.key === 'Escape') { resEl.classList.remove('open'); qEl.blur(); }
  if (e.key === 'ArrowDown') { selIdx = Math.min(results.length - 1, selIdx + 1); e.preventDefault(); }
  if (e.key === 'ArrowUp') { selIdx = Math.max(0, selIdx - 1); e.preventDefault(); }
  if (e.key === 'Enter') pick(selIdx >= 0 ? selIdx : 0);
});
addEventListener('keydown', e => {
  if (e.key === '/' && document.activeElement !== qEl) { e.preventDefault(); qEl.focus(); }
});

// --- deep-link params for headless screenshots --------------------------------
if (params.get('focus')) {
  const n = fileNodes.find(n => n.path === params.get('focus'));
  if (n) {
    focusFile(n);
    if (params.get('z')) rig.goalDist = rig.dist = +params.get('z');
    if (params.get('z')) { rig.tx = rig.goalTx; rig.tz = rig.goalTz; }
  }
}

// --- resize + loop ----------------------------------------------------------------
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

let frame = 0;
let lodTick = 0;
function loop() {
  frame++;
  applyCamera();
  if (frame % 6 === 0) updateTextTops();
  if (frame % 6 === 3) updateSymbols();
  if (frame % 3 === 1) updateLabels();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();
window.__ready = true;
window.__scene = scene; window.__data = data; window.__dbg = { scene, camera, fileNodes, texCache, get boxHeight() { return boxHeight; } };
