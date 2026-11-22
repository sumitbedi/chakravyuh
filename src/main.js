import * as THREE from 'three';
import { makeMaze, bfs, DIRS } from './maze.js';
import { sfx, ambient, setMuted, isMuted } from './audio.js';
import { Monsters } from './monsters.js';

const $ = (id) => document.getElementById(id);

// ---------- three.js setup ----------
const canvas = $('three');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(1);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050302);
scene.fog = new THREE.Fog(0x050302, 0.5, 6.5);
const camera = new THREE.PerspectiveCamera(72, 1, 0.05, 40);
scene.add(new THREE.AmbientLight(0xffe2c0, 0.35));
const torch = new THREE.PointLight(0xffb060, 2.2, 7, 1.4);
scene.add(torch);

function resize() {
  const v = $('view');
  const w = v.clientWidth, h = v.clientHeight;
  const scale = Math.max(1, w / 300); // ~300px wide internal buffer → chunky pixels
  renderer.setSize(Math.round(w / scale), Math.round(h / scale), false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ---------- textures (AI art if present, procedural fallback) ----------
function procTex(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const rnd = (a, b) => a + Math.random() * (b - a);
  if (kind === 'wall') {
    x.fillStyle = '#6b3a22'; x.fillRect(0, 0, 64, 64);
    for (let row = 0; row < 8; row++) for (let col = -1; col < 4; col++) {
      const off = row % 2 ? 8 : 0;
      x.fillStyle = `hsl(${rnd(14, 24)},${rnd(40, 55)}%,${rnd(30, 40)}%)`;
      x.fillRect(col * 16 + off + 1, row * 8 + 1, 15, 7);
    }
    for (let i = 0; i < 500; i++) { x.fillStyle = `rgba(0,0,0,${rnd(0, .25)})`; x.fillRect(rnd(0, 64) | 0, rnd(0, 64) | 0, 1, 1); }
  } else if (kind === 'floor') {
    x.fillStyle = '#3a2e25'; x.fillRect(0, 0, 64, 64);
    for (let r = 0; r < 4; r++) for (let cc = 0; cc < 4; cc++) {
      x.fillStyle = `hsl(28,${rnd(12, 20)}%,${rnd(20, 28)}%)`;
      x.fillRect(cc * 16 + 1, r * 16 + 1, 15, 15);
    }
    for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(0,0,0,${rnd(0, .3)})`; x.fillRect(rnd(0, 64) | 0, rnd(0, 64) | 0, 1, 1); }
  } else {
    x.fillStyle = '#2a2420'; x.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 60; i++) { x.fillStyle = `hsl(20,8%,${rnd(10, 22)}%)`; x.beginPath(); x.arc(rnd(0, 64), rnd(0, 64), rnd(3, 8), 0, 7); x.fill(); }
  }
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const mats = {
  wall: new THREE.MeshLambertMaterial({ map: procTex('wall') }),
  floor: new THREE.MeshLambertMaterial({ map: procTex('floor') }),
  ceil: new THREE.MeshLambertMaterial({ map: procTex('ceil') }),
};
const loader = new THREE.TextureLoader();
for (const [k, file] of [['wall', 'wall.png'], ['floor', 'floor.png'], ['ceil', 'ceiling.png']]) {
  loader.load(`/textures/${file}`, (t) => {
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    if (k !== 'wall') t.repeat.copy(mats[k].map.repeat);
    mats[k].map = t; mats[k].needsUpdate = true;
  }, undefined, () => {});
}

// ---------- run state ----------
const WALL_H = 1.25, EYE = 0.55, RADIUS = 0.2, SPEED = 2.1, TURN = 2.3;
const START_CLOCK = 40, PEEK_COST = 3, CAUGHT_COST = 8, MAX_MULT = 5;
let world = null, maze = null, distToGoal = null, goalMarker, monsters = null;
const S = {
  phase: 'intro', // intro | study | walk | over
  ring: 1, mode: 'escape', start: null, goal: null, name: '', aiMaze: false,
  px: 0, py: 0, yaw: 0, pitch: 0, startYaw: 0, tile: null,
  clock: START_CLOCK, score: 0, streak: 0, bestStreak: 0, peeks: 0, ringPeeks: 0,
  ringT0: 0, steps: 0, wrong: 0, bumps: 0, opt: 0, caught: 0,
  pending: null, lastTip: '', ringStats: null,
};
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const ringCells = (n) => Math.min(3 + n, 12);
const ringStudy = (n) => Math.min(4 + n, 10);
const ringMonsters = (n) => (n < 2 ? 0 : n < 4 ? 1 : n < 7 ? 2 : 3);

function parseRows(rows) {
  const g = rows.map((r) => [...r].map((ch) => (ch === '#' ? 1 : 0)));
  const size = g.length, c = 2 * Math.floor((size - 1) / 4) + 1;
  let gate = null;
  for (let i = 0; i < size; i++) for (const [x, y] of [[i, 0], [i, size - 1], [0, i], [size - 1, i]]) if (g[y][x] === 0) gate = { x, y };
  return { g, size, center: { x: c, y: c }, gate };
}

let spriteTex = null;
function paintingFallback() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 48;
  const x = c.getContext('2d');
  x.fillStyle = '#c9971c'; x.fillRect(0, 0, 64, 48);
  x.fillStyle = '#7a1a10'; x.fillRect(5, 5, 54, 38);
  x.strokeStyle = '#ffcc4d'; x.lineWidth = 2;
  for (let r = 4; r < 17; r += 4) { x.beginPath(); x.arc(32, 24, r, 0, 7); x.stroke(); }
  const t = new THREE.CanvasTexture(c); t.magFilter = t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t;
}
const paintMat = new THREE.MeshLambertMaterial({ map: paintingFallback() });
new THREE.TextureLoader().load('/sprites/painting.png', (t) => {
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  paintMat.map = t; paintMat.needsUpdate = true;
}, undefined, () => {});
// secret passages: walls whose removal saves the most walking
function findSecrets(g, dist, count) {
  const size = g.length, out = [];
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    if (g[y][x] !== 1) continue;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const a = { x: x - dx, y: y - dy }, b = { x: x + dx, y: y + dy };
      if (g[a.y][a.x] !== 0 || g[b.y][b.x] !== 0) continue;
      const da = dist[a.y][a.x], db = dist[b.y][b.x];
      if (!Number.isFinite(da) || !Number.isFinite(db)) continue;
      const gain = Math.abs(da - db) - 2;
      if (gain >= 6) out.push({ x, y, from: da > db ? a : b, gain, open: false });
    }
  }
  out.sort((p, q) => q.gain - p.gain || Math.random() - 0.5);
  const pick = [];
  for (const c of out) { if (pick.length >= count) break; if (pick.every((p) => Math.abs(p.x - c.x) + Math.abs(p.y - c.y) > 3)) pick.push(c); }
  return pick;
}
new THREE.TextureLoader().load('/sprites/rakshasa.png', (t) => {
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; spriteTex = t;
}, undefined, () => {});

function buildRing() {
  const n = S.ring;
  S.mode = n % 2 === 1 ? 'escape' : 'enter';
  const ai = S.pending && S.pending.ring === n ? S.pending : null;
  maze = null;
  if (ai?.rows) { try { maze = parseRows(ai.rows); if (!maze.gate) maze = null; } catch { maze = null; } }
  S.aiMaze = !!maze;
  S.name = ai?.name || '';
  S.aiStudy = S.aiMaze && Number.isFinite(ai?.studySeconds) ? Math.max(4, Math.min(20, ai.studySeconds)) : 0;
  if (ai?.tip) S.lastTip = ai.tip;
  if (!maze) maze = makeMaze(ringCells(n), (Date.now() ^ (n * 9973)) >>> 0, Math.min(0.3, (n - 1) * 0.06));
  if (S.mode === 'escape') { S.start = maze.center; S.goal = maze.gate; }
  else { S.start = maze.gate; S.goal = maze.center; }
  distToGoal = bfs(maze.g, S.goal);
  S.opt = distToGoal[S.start.y][S.start.x];
  // face the first open corridor
  const d0 = DIRS.findIndex(([dx, dy]) => maze.g[S.start.y + dy]?.[S.start.x + dx] === 0);
  S.startYaw = -Math.max(0, d0) * Math.PI / 2;
  resetToStart();
  S.steps = S.wrong = S.bumps = S.ringPeeks = 0;
  scene.fog.far = Math.max(3.5, 7 - n * 0.3);

  if (monsters) { monsters.dispose(); monsters = null; }
  if (world) { scene.remove(world); world.traverse((o) => o.geometry?.dispose()); }
  world = new THREE.Group();
  const { g, size } = maze;
  const walls = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (g[y][x] === 1) walls.push([x, y]);
  const box = new THREE.BoxGeometry(1, WALL_H, 1);
  const uv = box.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * WALL_H);
  const inst = new THREE.InstancedMesh(box, mats.wall, walls.length);
  const m = new THREE.Matrix4();
  walls.forEach(([x, y], i) => { m.makeTranslation(x, WALL_H / 2, y); inst.setMatrixAt(i, m); });
  world.add(inst);
  S.wallMesh = inst; S.wallIndex = new Map(walls.map(([x, y], i) => [y * size + x, i]));
  S.secrets = findSecrets(g, bfs(g, S.goal), n < 3 ? 1 : 2);
  for (const sec of S.secrets) {
    const dx = sec.from.x - sec.x, dy = sec.from.y - sec.y;
    const pm = new THREE.Mesh(new THREE.PlaneGeometry(0.56, 0.42), paintMat);
    pm.position.set(sec.x + dx * 0.505, 0.68, sec.y + dy * 0.505);
    pm.rotation.y = Math.atan2(dx, dy);
    sec.mesh = pm; world.add(pm);
  }
  S.canOpen = null; S.sliding = null;
  const span = size + 6;
  mats.floor.map.repeat.set(span, span); mats.ceil.map.repeat.set(span, span);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(span, span), mats.floor);
  floor.rotation.x = -Math.PI / 2; floor.position.set(size / 2 - 0.5, 0, size / 2 - 0.5);
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(span, span), mats.ceil);
  ceil.rotation.x = Math.PI / 2; ceil.position.set(size / 2 - 0.5, WALL_H, size / 2 - 0.5);
  world.add(floor, ceil);
  goalMarker = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.04, 6, 24), new THREE.MeshBasicMaterial({ color: 0xff9a1f }));
  const spokes = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 0.02), new THREE.MeshBasicMaterial({ color: 0xffc46b }));
    sp.rotation.z = (i * Math.PI) / 8; spokes.add(sp);
  }
  goalMarker.add(ring, spokes, new THREE.PointLight(0xff9a1f, 1.6, 3.5));
  goalMarker.position.set(S.goal.x, 0.6, S.goal.y);
  world.add(goalMarker);
  scene.add(world);
  const count = ringMonsters(n);
  if (count) {
    try {
      monsters = new Monsters(scene, maze.g, { count, speed: Math.min(1.6, 0.9 + n * 0.06), avoid: S.start, avoidRadius: 4, seed: (Date.now() ^ n) >>> 0, texture: spriteTex });
    } catch (e) { console.warn('monsters off', e); monsters = null; }
  }
  placeCamera();
  updateHud();
}

function resetToStart() {
  S.px = S.start.x; S.py = S.start.y; S.yaw = S.startYaw; S.pitch = 0;
  S.tile = { ...S.start };
  S.trail = [{ ...S.start }];
}

let bobT = 0, bobPhase = 0, shakeUntil = 0;
function placeCamera(now = 0) {
  const shake = now < shakeUntil ? (Math.random() - 0.5) * 0.05 : 0;
  camera.position.set(S.px + shake, EYE + Math.sin(bobPhase) * 0.022, S.py + shake);
  camera.rotation.set(S.pitch, S.yaw, 0, 'YXZ');
  torch.position.set(S.px, EYE + 0.1, S.py);
}

// ---------- free movement with grid collision ----------
const isWall = (x, y) => { const r = maze.g[y]; return !r || r[x] !== 0; };
function blocked(x, y) {
  for (let ty = Math.round(y - RADIUS - 0.5); ty <= Math.round(y + RADIUS + 0.5); ty++)
    for (let tx = Math.round(x - RADIUS - 0.5); tx <= Math.round(x + RADIUS + 0.5); tx++) {
      if (!isWall(tx, ty)) continue;
      const cx = Math.max(tx - 0.5, Math.min(x, tx + 0.5)), cy = Math.max(ty - 0.5, Math.min(y, ty + 0.5));
      if ((x - cx) ** 2 + (y - cy) ** 2 < RADIUS * RADIUS) return true;
    }
  return false;
}
let lastBump = 0, lastStepSound = 0;
function step(dt, now) {
  const fwd = input.fwd(), turn = input.turn();
  S.yaw -= turn * TURN * dt;
  if (Math.abs(fwd) > 0.02) {
    if ($('coach').classList.contains('show') && fwd > 0.3) { $('coach').classList.remove('show'); store.set('chakravyuh-coached', true); }
    const sp = fwd * SPEED * dt;
    const dx = -Math.sin(S.yaw) * sp, dy = -Math.cos(S.yaw) * sp;
    let hit = false;
    const ox = S.px, oy = S.py;
    if (!blocked(S.px + dx, S.py)) S.px += dx; else hit = true;
    if (!blocked(S.px, S.py + dy)) S.py += dy; else hit = true;
    const moved = Math.hypot(S.px - ox, S.py - oy);
    if (moved > 0.0005) {
      bobPhase += moved * 9;
      if (now - lastStepSound > 330) { lastStepSound = now; sfx.step(); }
    }
    if (hit && moved < Math.abs(sp) * 0.3 && now - lastBump > 600) {
      lastBump = now; S.bumps++; navigator.vibrate?.(20); sfx.bump();
      const f = $('flash'); f.style.opacity = .15; setTimeout(() => (f.style.opacity = 0), 90);
    }
  }
  const tx = Math.round(S.px), ty = Math.round(S.py);
  if (tx !== S.tile.x || ty !== S.tile.y) {
    if (distToGoal[ty]?.[tx] > distToGoal[S.tile.y][S.tile.x]) S.wrong++;
    S.steps++; S.tile = { x: tx, y: ty }; S.trail.push({ x: tx, y: ty });
    if (tx === S.goal.x && ty === S.goal.y) return clearRing();
  }
  S.canOpen = null;
  for (const sec of S.secrets || []) {
    if (sec.open) continue;
    const ddx = sec.x - S.px, ddy = sec.y - S.py, d = Math.hypot(ddx, ddy);
    if (d < 1.25 && Math.hypot(sec.from.x - S.px, sec.from.y - S.py) < 0.7 && (-Math.sin(S.yaw) * ddx - Math.cos(S.yaw) * ddy) / d > 0.55) S.canOpen = sec;
  }
  $('open').classList.toggle('show', !!S.canOpen);
  if (monsters) {
    if (monsters.update(dt, S.px, S.py) === 'caught') return caught(now);
    const near = monsters.nearest(S.px, S.py);
    $('vignette').style.opacity = near < 3 ? Math.min(0.55, (3 - near) / 4) * (0.75 + 0.25 * Math.sin(now / 120)) : 0;
  }
  // clock
  S.clock -= dt;
  if (S.clock <= 5 && Math.ceil(S.clock) !== Math.ceil(S.clock + dt)) sfx.tick();
  if (S.clock <= 0) { S.clock = 0; return gameOver(); }
  placeCamera(now);
}

// ---------- input: joystick, drag-to-look, keyboard ----------
const keys = new Set();
const stick = { x: 0, y: 0, id: null };
const input = {
  fwd: () => Math.max(-1, Math.min(1, -stick.y + (keys.has('fwd') ? 1 : 0) - (keys.has('back') ? 1 : 0))),
  turn: () => Math.max(-1, Math.min(1, stick.x * Math.abs(stick.x) + (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0))),
};
const stickEl = $('stick'), knob = $('knob');
function setStick(e) {
  const r = stickEl.getBoundingClientRect();
  const max = r.width / 2 - 22;
  let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
  const len = Math.hypot(dx, dy);
  if (len > max) { dx *= max / len; dy *= max / len; }
  knob.style.transform = `translate(${dx}px, ${dy}px)`;
  stick.x = dx / max; stick.y = dy / max;
  if (Math.abs(stick.x) < 0.12) stick.x = 0;
  if (Math.abs(stick.y) < 0.12) stick.y = 0;
}
stickEl.addEventListener('pointerdown', (e) => { e.preventDefault(); sfx.unlock(); stick.id = e.pointerId; stickEl.setPointerCapture(e.pointerId); setStick(e); });
stickEl.addEventListener('pointermove', (e) => { if (e.pointerId === stick.id) setStick(e); });
const release = (e) => { if (e.pointerId !== stick.id) return; stick.id = null; stick.x = stick.y = 0; knob.style.transform = ''; };
stickEl.addEventListener('pointerup', release); stickEl.addEventListener('pointercancel', release);

const view = $('view'); let look = null;
view.addEventListener('pointerdown', (e) => { if (e.target.closest('#mute')) return; look = { id: e.pointerId, x: e.clientX, y: e.clientY }; view.setPointerCapture(e.pointerId); });
view.addEventListener('pointermove', (e) => {
  if (!look || e.pointerId !== look.id || S.phase !== 'walk') return;
  S.yaw -= (e.clientX - look.x) * 0.006;
  S.pitch = Math.max(-0.5, Math.min(0.5, S.pitch - (e.clientY - look.y) * 0.004));
  look.x = e.clientX; look.y = e.clientY;
});
const endLook = () => { look = null; };
view.addEventListener('pointerup', endLook); view.addEventListener('pointercancel', endLook);

const KEYS = { arrowup: 'fwd', w: 'fwd', arrowdown: 'back', s: 'back', arrowleft: 'left', a: 'left', arrowright: 'right', d: 'right' };
window.addEventListener('keydown', (e) => {
  sfx.unlock();
  const k = KEYS[e.key.toLowerCase()];
  if (k) { e.preventDefault(); keys.add(k); }
  if (e.key === 'm' || e.key === 'M') peek();
  if ((e.key === ' ' || e.key === 'e' || e.key === 'E' || e.key === 'Enter') && S.phase === 'walk' && S.canOpen) { e.preventDefault(); openSecret(); return; }
  if (e.key === 'Enter' || e.key === ' ') {
    if (S.phase === 'study') beginWalk();
    else if (S.phase === 'intro' || S.phase === 'over') newRun();
  }
});
window.addEventListener('keyup', (e) => { const k = KEYS[e.key.toLowerCase()]; if (k) keys.delete(k); });
document.querySelector('[data-act="peek"]').addEventListener('pointerdown', (e) => { e.preventDefault(); peek(); });
$('open').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); openSecret(); });
function openSecret() {
  const sec = S.canOpen; if (!sec || sec.open || S.phase !== 'walk') return;
  sec.open = true; S.canOpen = null; $('open').classList.remove('show');
  maze.g[sec.y][sec.x] = 0;
  distToGoal = bfs(maze.g, S.goal);
  world.remove(sec.mesh); sec.mesh.geometry.dispose();
  S.sliding = { idx: S.wallIndex.get(sec.y * maze.size + sec.x), x: sec.x, y: sec.y, t0: performance.now() };
  sfx.bump(); setTimeout(() => sfx.streak(4), 150); navigator.vibrate?.([30, 30, 30]);
  shakeUntil = performance.now() + 450;
  floatText('Secret passage!', '#ffd34d');
  S.secretsOpened = (S.secretsOpened || 0) + 1;
}
const muteBtn = $('mute');
setMuted(!!store.get('chakravyuh-muted')); muteBtn.classList.toggle('off', isMuted());
muteBtn.addEventListener('click', () => { sfx.unlock(); setMuted(!isMuted()); store.set('chakravyuh-muted', isMuted()); muteBtn.classList.toggle('off', isMuted()); });

// ---------- HUD ----------
function facing() {
  const a = ((-S.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(a / (Math.PI / 4)) % 8];
}
const mult = () => Math.min(MAX_MULT, 1 + S.streak);
function updateHud() {
  $('h-ring').textContent = S.ring;
  $('h-score').textContent = S.score;
  $('h-clock').textContent = Math.ceil(S.clock);
  $('h-clock').parentElement.classList.toggle('low', S.clock <= 10 && S.phase === 'walk');
  $('h-dir').textContent = facing();
  $('h-goal').textContent = S.mode === 'escape' ? 'out' : 'to the centre';
  const st = $('streak');
  st.textContent = `SMRITI ×${mult()}`;
  st.classList.toggle('show', S.streak > 0 && S.phase === 'walk');
}
function floatText(text, color) {
  const el = document.createElement('div');
  el.className = 'float'; el.textContent = text; el.style.color = color;
  $('view').appendChild(el); setTimeout(() => el.remove(), 1000);
}

// ---------- map drawing ----------
function drawArrow(x, cx, cy, yaw, r, color) {
  const a = Math.atan2(-Math.cos(yaw), -Math.sin(yaw));
  x.fillStyle = color; x.strokeStyle = '#0b0806'; x.lineWidth = Math.max(1, r * 0.18); x.beginPath();
  x.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  x.lineTo(cx + Math.cos(a + 2.5) * r, cy + Math.sin(a + 2.5) * r);
  x.lineTo(cx + Math.cos(a + Math.PI) * r * 0.35, cy + Math.sin(a + Math.PI) * r * 0.35);
  x.lineTo(cx + Math.cos(a - 2.5) * r, cy + Math.sin(a - 2.5) * r);
  x.closePath(); x.fill(); x.stroke();
}
function drawMap(cv, live) {
  const { g, size } = maze;
  const px = Math.floor(Math.min(560, window.innerWidth * 2) / size);
  cv.width = cv.height = px * size;
  const x = cv.getContext('2d');
  x.fillStyle = '#1b130e'; x.fillRect(0, 0, cv.width, cv.height);
  for (let yy = 0; yy < size; yy++) for (let xx = 0; xx < size; xx++) {
    x.fillStyle = g[yy][xx] === 1 ? '#7a4326' : '#e9d9bd';
    x.fillRect(xx * px, yy * px, px, px);
  }
  // goal: saffron ring
  const gx = (S.goal.x + .5) * px, gy = (S.goal.y + .5) * px;
  x.fillStyle = '#ff9a1f'; x.beginPath(); x.arc(gx, gy, px * .42, 0, 7); x.fill();
  x.fillStyle = '#e9d9bd'; x.beginPath(); x.arc(gx, gy, px * .16, 0, 7); x.fill();
  for (const sec of S.secrets || []) {
    if (sec.open) continue;
    const dx = sec.from.x - sec.x, dy = sec.from.y - sec.y;
    const cx = (sec.x + .5 + dx * .32) * px, cy = (sec.y + .5 + dy * .32) * px;
    const w = dx ? px * .26 : px * .8, h = dx ? px * .8 : px * .26;
    x.fillStyle = '#ffd34d'; x.strokeStyle = '#0b0806'; x.lineWidth = Math.max(1, px * .08);
    x.fillRect(cx - w / 2, cy - h / 2, w, h); x.strokeRect(cx - w / 2, cy - h / 2, w, h);
  }
  if (monsters) monsters.drawOnMap(x, px);
  if (live) drawArrow(x, (S.px + .5) * px, (S.py + .5) * px, S.yaw, px * .48, '#2fa864');
  else drawArrow(x, (S.start.x + .5) * px, (S.start.y + .5) * px, S.startYaw, px * .48, '#2fa864');
}

// ---------- flow ----------
function show(id, on = true) { $(id).classList.toggle('show', on); }
let studyTimer, studyLeft = 0;
function newRun() {
  sfx.unlock(); ambient(true);
  try { speechSynthesis?.cancel(); } catch {}
  show('intro', false); show('done', false);
  Object.assign(S, { secretsOpened: 0, prefetch: null, ring: 1, clock: START_CLOCK, score: 0, streak: 0, bestStreak: 0, peeks: 0, caught: 0, pending: null, lastTip: '', ringStats: [] });
  startStudy();
}
function startStudy() {
  S.phase = 'study';
  $('open').classList.remove('show');
  buildRing();
  const label = S.mode === 'escape' ? 'Escape' : 'Reach the centre';
  $('s-title').textContent = `Ring ${S.ring} · ${S.name || label}${S.aiMaze ? ' · designed by AI' : ''}`;
  $('s-goal').textContent = S.mode === 'escape' ? 'Way out' : 'The centre';
  $('s-mon').style.display = monsters ? '' : 'none';
  $('s-guru').innerHTML = S.lastTip ? `<b>Guru:</b> ${S.lastTip.replace(/</g, '&lt;')}` : '';
  drawMap($('map'), false);
  show('study');
  studyLeft = S.aiStudy || ringStudy(S.ring);
  $('s-count').textContent = studyLeft;
  clearInterval(studyTimer);
  studyTimer = setInterval(() => { studyLeft--; $('s-count').textContent = studyLeft; if (studyLeft <= 0) beginWalk(); }, 1000);
}
function beginWalk() {
  if (S.phase !== 'study') return;
  clearInterval(studyTimer);
  show('study', false);
  S.phase = 'walk';
  S.ringT0 = performance.now();
  if (studyLeft > 0) { S.clock += studyLeft; floatText(`+${studyLeft}s early`, '#5fd38a'); }
  toast(S.mode === 'escape' ? 'Find the way out' : 'Find the centre');
  if (S.ring === 1 && !store.get('chakravyuh-coached')) $('coach').classList.add('show');
  prefetchNext();
  updateHud();
}
let peekTimer;
function peek() {
  if (S.phase !== 'walk' || $('peek').classList.contains('show')) return;
  S.peeks++; S.ringPeeks++; S.clock = Math.max(0.1, S.clock - PEEK_COST);
  sfx.peek(); floatText(`−${PEEK_COST}s`, '#ff5a4a');
  if (S.streak) { S.streak = 0; toast('Streak broken'); }
  drawMap($('peekmap'), true);
  show('peek');
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => show('peek', false), 1800);
  updateHud();
}
function caught(now) {
  S.caught++; S.clock = Math.max(0.1, S.clock - CAUGHT_COST);
  sfx.caught(); navigator.vibrate?.([60, 40, 90]);
  shakeUntil = now + 350; $('view').classList.remove('shake'); void $('view').offsetWidth; $('view').classList.add('shake');
  const f = $('flash'); f.style.opacity = .5; setTimeout(() => (f.style.opacity = 0), 200);
  floatText(`Caught! −${CAUGHT_COST}s`, '#ff5a4a');
  resetToStart();
  if (S.streak) S.streak = 0;
  updateHud();
}
function clearRing() {
  const secs = (performance.now() - S.ringT0) / 1000;
  const clean = S.ringPeeks === 0;
  if (clean) S.streak++; S.bestStreak = Math.max(S.bestStreak, S.streak);
  const pts = 100 * S.ring * mult();
  S.score += pts;
  S.ringStats.push({ ring: S.ring, cells: (maze.size - 1) / 2, seconds: +secs.toFixed(1), steps: S.steps, shortest: S.opt, wrongSteps: S.wrong, peeks: S.ringPeeks, bumps: S.bumps });
  sfx.clear(); if (clean && S.streak > 1) sfx.streak(S.streak);
  navigator.vibrate?.(40);
  const prevRing = S.ring;
  S.ring++;
  S.phase = 'transition';
  // time bonus sized to the next ring
  const bonus = Math.round(6 + ringCells(S.ring) * 2.2);
  S.clock += bonus;
  floatText(`+${pts}  +${bonus}s`, '#ff9a1f');
  if (clean && S.streak > 1) setTimeout(() => floatText(`Smriti ×${mult()}`, '#5fd38a'), 300);
  if (S.clock - bonus < 3) setTimeout(() => toast('Narrow escape!'), 250);
  $('vignette').style.opacity = 0;
  const waitAI = S.prefetch ? Promise.race([S.prefetch, new Promise((r) => setTimeout(r, 6000))]) : null;
  setTimeout(async () => {
    if (waitAI && !(S.pending && S.pending.ring === S.ring)) { $('designing').classList.add('show'); await waitAI; $('designing').classList.remove('show'); }
    if (S.phase === 'transition' && S.ring === prevRing + 1) startStudy();
  }, 650);
  updateHud();
}
function gameOver() {
  S.phase = 'over';
  $('open').classList.remove('show');
  clearInterval(studyTimer);
  sfx.gameOver(); ambient(false);
  $('vignette').style.opacity = 0;
  const best = store.get('chakravyuh-best-run') || 0;
  const isBest = S.score > best;
  if (isBest) store.set('chakravyuh-best-run', S.score);
  $('d-title').textContent = S.ring > 1 ? `Abhimanyu fell in ring ${S.ring}` : 'Abhimanyu fell in the first ring';
  $('d-score').textContent = S.score;
  $('d-best').textContent = isBest ? 'New best!' : `Best ${best}`;
  $('d-rings').textContent = S.ring - 1;
  $('d-streak').textContent = S.bestStreak;
  $('d-peeks').textContent = S.peeks;
  $('d-tip').textContent = S.lastTip || 'Chunk the route into three parts and remember only the turns in each.';
  drawReplay($('d-map'));
  show('done');
  speakTip($('d-tip').textContent);
  updateHud();
}
function speakTip(text) {
  try {
    if (isMuted() || !window.speechSynthesis) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = speechSynthesis.getVoices().find((x) => /en[-_]IN/i.test(x.lang)) || speechSynthesis.getVoices().find((x) => /^en/i.test(x.lang));
    if (v) u.voice = v;
    u.rate = 0.95; u.pitch = 0.85;
    setTimeout(() => speechSynthesis.speak(u), 900);
  } catch {}
}
function drawReplay(cv) {
  const { g, size } = maze;
  const px = Math.floor(420 / size);
  cv.width = cv.height = px * size;
  const x = cv.getContext('2d');
  for (let yy = 0; yy < size; yy++) for (let xx = 0; xx < size; xx++) { x.fillStyle = g[yy][xx] === 1 ? '#5a3220' : '#d9c8aa'; x.fillRect(xx * px, yy * px, px, px); }
  const line = (pts, color, w, dash) => { x.strokeStyle = color; x.lineWidth = w; x.lineJoin = x.lineCap = 'round'; x.setLineDash(dash); x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo : x.moveTo).call(x, (p.x + .5) * px, (p.y + .5) * px)); x.stroke(); };
  // shortest path: walk downhill on distToGoal from the start
  const opt = [{ ...S.start }]; let c = { ...S.start };
  while (distToGoal[c.y][c.x] > 0) { const nx = DIRS.map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy })).find((p) => distToGoal[p.y]?.[p.x] === distToGoal[c.y][c.x] - 1); if (!nx) break; opt.push(nx); c = nx; }
  line(opt, '#ff9a1f', px * .28, [px * .3, px * .25]);
  line(S.trail || [], '#2fa864', px * .3, []);
  x.setLineDash([]);
  x.fillStyle = '#ff9a1f'; x.beginPath(); x.arc((S.goal.x + .5) * px, (S.goal.y + .5) * px, px * .4, 0, 7); x.fill();
  x.fillStyle = '#ff3b2a'; x.beginPath(); x.arc((S.px + .5) * px, (S.py + .5) * px, px * .35, 0, 7); x.fill();
}

// ---------- AI Guru: designs the next ring while you walk this one ----------
function localTip(st) {
  const eff = st.shortest / Math.max(st.steps, 1);
  if (st.peeks === 0 && eff > 0.9) return 'Perfect recall. Say the turns out loud while you study: "left, right, right".';
  if (st.peeks > 1) return 'You leaned on the map. Trace the path with your finger and count the turns.';
  if (eff < 0.6) return 'Long detours. Memorise landmarks: "first dead end on the left, then straight past two openings".';
  return 'Chunk the route into three parts and remember only the turns in each.';
}
async function prefetchNext() {
  const ring = S.ring + 1;
  const last = S.ringStats?.[S.ringStats.length - 1];
  if (!last) return; // first ring: nothing to learn from yet
  const cells = ringCells(ring);
  const body = {
    level: ring, mode: ring % 2 === 1 ? 'escape' : 'enter', cells: Math.max(4, Math.min(13, last.cells || cells - 1)),
    seconds: last.seconds, steps: last.steps, shortest: last.shortest, wrongSteps: last.wrongSteps,
    peeks: last.peeks, bumps: last.bumps, studySeconds: ringStudy(ring), braid: 0.1,
  };
  S.lastTip = localTip(last);
  S.prefetch = (async () => { try {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 12000);
    const r = await fetch('/api/guru', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
    clearTimeout(to);
    if (!r.ok) return;
    const j = await r.json();
    if (S.ring !== ring - 1 && S.ring !== ring) return; // run moved on
    S.pending = { ...j, ring };
    if (j.tip) S.lastTip = j.tip;
  } catch {} })();
  return S.prefetch;
}

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1600);
}

$('start').addEventListener('click', newRun);
$('ready').addEventListener('click', beginWalk);
$('again').addEventListener('click', newRun);
$('share').addEventListener('click', async () => {
  const text = `I escaped ${S.ring - 1} ring${S.ring === 2 ? '' : 's'} of the Chakravyuh and scored ${S.score}. Abhimanyu couldn't. Can you?`;
  const url = location.origin;
  try { if (navigator.share) { await navigator.share({ title: 'Chakravyuh', text, url }); return; } } catch { return; }
  try { await navigator.clipboard.writeText(`${text} ${url}`); toast('Copied, paste it to a friend'); } catch { toast(url); }
});
const best0 = store.get('chakravyuh-best-run');
if (best0) $('i-best').textContent = `Your best: ${best0}`;

// ---------- loop ----------
let last = performance.now(), hudT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (S.phase === 'walk') step(dt, now);
  if (S.sliding && S.wallMesh) {
    const k = Math.min(1, (now - S.sliding.t0) / 550), mm = new THREE.Matrix4();
    if (k < 1) mm.makeTranslation(S.sliding.x, WALL_H / 2 - k * WALL_H * 1.02, S.sliding.y); else mm.makeScale(0, 0, 0);
    S.wallMesh.setMatrixAt(S.sliding.idx, mm); S.wallMesh.instanceMatrix.needsUpdate = true;
    if (k >= 1) S.sliding = null;
  }
  if (goalMarker) { goalMarker.rotation.y = now / 600; goalMarker.position.y = 0.6 + Math.sin(now / 400) * 0.04; }
  torch.intensity = 2.1 + Math.sin(now / 90) * 0.12 + Math.sin(now / 37) * 0.08;
  if (S.phase === 'walk' && now - hudT > 100) { hudT = now; updateHud(); }
  renderer.render(scene, camera);
}
resize();
buildRing();
requestAnimationFrame(loop);
// debug hook for automated checks
window.__ck = { S, get maze() { return maze; }, get monsters() { return monsters; } };