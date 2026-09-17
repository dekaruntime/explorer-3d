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

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);
scene.fog = new THREE.Fog(0x0b0e14, 1400, 3200);

const camera = new THREE.PerspectiveCamera(42, 1, 1, 8000);

// --- camera rig: target on ground plane + distance ---------------------------
// tilt is from vertical, and INCREASES as you zoom in: far = map view looking
// down, close = low view so leaned-back code panels face the reader.
const rig = {
  tx: WORLD / 2, tz: WORLD / 2, dist: 1500,
  goalTx: WORLD / 2, goalTz: WORLD / 2, goalDist: 1500,
  min: 30, max: 2400,
};
function tiltAt(dist) {
  const k = Math.max(0, Math.min(1, (1000 - dist) / 970)); // 0 far → 1 at closest
  return 0.72 + 0.38 * k * k * (3 - 2 * k); // smoothstep: 41° → ~63° from vertical
}
function applyCamera() {
  rig.tx += (rig.goalTx - rig.tx) * 0.16;
  rig.tz += (rig.goalTz - rig.tz) * 0.16;
  rig.dist += (rig.goalDist - rig.dist) * 0.16;
  const t = tiltAt(rig.dist);
  const y = Math.cos(t) * rig.dist;
  const back = Math.sin(t) * rig.dist;
  camera.position.set(rig.tx, y, rig.tz + back);
  // as panels stand up, raise the gaze from the ground to panel height
  const gate = Math.max(0, Math.min(1, (900 - rig.dist) / 700));
  camera.lookAt(rig.tx, 130 * gate, rig.tz);
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
const sourceText = new Map(); // path -> file text
// prefetch all source up front: textures then always paint with text and the
// create→fetch→drop→recreate churn disappears
for (const f of data.filesTable) loadSource(f.path);
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
const texCache = new Map(); // node -> {tex, mesh, wpx, lastUsed}
const MAX_TEX = 80;
const MAX_ANISO = renderer.capabilities.getMaxAnisotropy();
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
    if (node && texCache.has(node)) dropTexture(node);
  });
}
function dropTexture(node) {
  const e = texCache.get(node);
  if (!e) return;
  textGroup.remove(e.mesh);
  e.mesh.material.map.dispose();
  e.mesh.material.dispose();
  e.mesh.geometry.dispose();
  texCache.delete(node);
}
// screen-space metrics for a file rect (pass wpp = worldPerPixel() for the frame)
function screenRect(n, wpp) {
  return {
    cx: (n.rect[0] + n.rect[2] / 2) * WORLD,
    cz: (n.rect[1] + n.rect[3] / 2) * WORLD,
    wpx: n.rect[2] * WORLD / wpp,
    hpx: n.rect[3] * WORLD / wpp,
  };
}
function ensureTexture(n, wantWpx) {
  let e = texCache.get(n);
  if (e) { e.lastUsed = frame; return e; }
  if (texCache.size >= MAX_TEX) {
    let oldest = null;
    for (const [k, v] of texCache) if (!oldest || v.lastUsed < oldest.lastUsed) oldest = { k, v };
    if (oldest) dropTexture(oldest.k);
  }
  const [x, y, w, h] = n.rect;
  // dynamic resolution: canvas ~1.35x the file's on-screen width, so text
  // stays sharp at any zoom; re-rendered at higher res as it grows
  const wpx = Math.max(480, Math.min(2200, Math.round(wantWpx * 1.35)));
  const hpx = Math.max(64, Math.min(4096, Math.round((h / w) * wpx)));
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
    ctx.fillText(lines[i].slice(0, 110), 6, i * lineH + 2);
  }
  if (lines.length > maxLines) {
    ctx.fillStyle = '#f74c00';
    ctx.fillRect(0, hpx - Math.max(3, lineH * 0.2), wpx * (maxLines / lines.length), Math.max(3, lineH * 0.2));
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = MAX_ANISO;
  // panel pivots at its near edge (max z) so it can lean back toward the
  // reader like a lectern: origin at bottom edge, extends toward -z when flat
  const geo = new THREE.PlaneGeometry(w * WORLD - 1, h * WORLD - 1);
  geo.translate(0, (h * WORLD - 1) / 2, 0);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }));
  const bh = boxHeight.get(n);
  mesh.position.set((x + w / 2) * WORLD, BASE + bh + 0.15, (y + h) * WORLD - 1);
  textGroup.add(mesh);
  e = { tex, mesh, wpx, lastUsed: frame };
  texCache.set(n, e);
  return e;
}
// lectern tilt: as you zoom in, panels rotate to face the camera — the lean
// angle tracks the camera tilt (panel normal aligns with the view direction),
// gated by distance so the far map stays flat.
const MAX_LEAN = 1.45; // ~83°
function panelLean() {
  const gate = Math.max(0, Math.min(1, (900 - rig.dist) / 700));
  return Math.min(MAX_LEAN, tiltAt(rig.dist)) * gate;
}
function updatePanelPoses() {
  const lean = panelLean();
  for (const [, e] of texCache) e.mesh.rotation.x = -Math.PI / 2 + lean;
}
let texBudget = 0;
const _candCenter = new THREE.Vector3();
const _candTarget = new THREE.Vector3();
function updateTextTops() {
  const wppT = worldPerPixel();
  const tdist = camera.position.distanceTo(_candTarget.set(rig.tx, 0, rig.tz));
  // collect candidates, corrected for each file's actual distance from camera
  const cands = [];
  for (const n of fileNodes) {
    const s = screenRect(n, wppT);
    if (s.wpx < 200) continue;
    _proj.set(s.cx, 0, s.cz).project(camera);
    if (Math.abs(_proj.x) > 1.25 || Math.abs(_proj.y) > 1.25) continue;
    const k = tdist / Math.max(1, camera.position.distanceTo(_candCenter.set(s.cx, 0, s.cz)));
    s.wpx *= k; s.hpx *= k;
    if (s.wpx < 200) continue;
    cands.push([n, s]);
  }
  // biggest on screen first — the focused file must never starve behind
  // off-center stragglers that happen to sit inside the frustum wedge
  cands.sort((a, b) => b[1].wpx - a[1].wpx);
  for (const [n, s] of cands) {
    const e = texCache.get(n);
    if (!e) {
      if (texBudget > 0) { texBudget--; ensureTexture(n, s.wpx); }
    } else if (s.wpx > e.wpx * 1.5 && texBudget > 0) {
      // screen outgrew the texture: repaint sharper
      texBudget--;
      dropTexture(n);
      ensureTexture(n, s.wpx);
    }
  }
}
const _proj = new THREE.Vector3();
const _wpp = new THREE.Vector3();
// world-units-per-screen-pixel AT THE CAMERA TARGET — must be measured at the
// lookAt point, not a far corner of the plane: at close zoom the grazing
// angle makes the far corner ~3x farther, which starves the LOD thresholds.
function worldPerPixel() {
  _wpp.set(rig.tx + 5, 0, rig.tz).project(camera);
  const ax = (_wpp.x * 0.5 + 0.5) * innerWidth;
  _wpp.set(rig.tx - 5, 0, rig.tz).project(camera);
  const bx = (_wpp.x * 0.5 + 0.5) * innerWidth;
  return 10 / Math.max(1e-6, Math.abs(ax - bx));
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
  flyTo((x + w / 2) * WORLD, (y + h / 2) * WORLD, Math.max(110, Math.max(w, h) * WORLD * 1.9));
  const bh = boxHeight.get(n);
  hl.scale.set(w * WORLD + 2, bh + 4, h * WORLD + 2);
  hl.position.set((x + w / 2) * WORLD, BASE + (bh + 2) / 2, (y + h / 2) * WORLD);
  hl.visible = true;
}

// --- search ----------------------------------------------------------------------
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
function loop() {
  frame++;
  texBudget = dragging ? 2 : 4; // fewer canvas paints mid-drag
  applyCamera();
  if (frame % 4 === 0) updateTextTops();
  updatePanelPoses();
  if (frame % 3 === 1) updateLabels();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();
window.__ready = true;
window.__scene = scene; window.__data = data; window.__dbg = { scene, camera, fileNodes, texCache, get boxHeight() { return boxHeight; } };
