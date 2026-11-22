import * as THREE from 'three';
import { makeMaze, bfs, DIRS } from './maze.js';

const $ = (id) => document.getElementById(id);
const DIR_NAMES = ['N', 'E', 'S', 'W'];
const PEEK_COST = 150, BUMP_COST = 20, SEC_COST = 5;

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

// ---------- level state ----------
const WALL_H = 1.25, EYE = 0.55, RADIUS = 0.2, SPEED = 2.1, TURN = 2.3, PEEK_SECS = 5;
let world = null, maze = null, distToGoal = null, goalMarker;
const S = {
  level: 1, mode: 'escape', start: null, goal: null, cfg: null, name: '',
  px: 0, py: 0, yaw: 0, pitch: 0, tile: null, t0: 0, time: 0, running: false,
  steps: 0, wrong: 0, peeks: 0, bumps: 0, opt: 0, next: null,
};
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

function levelConfig(L, over) {
  const base = { cells: Math.min(3 + L, 13), study: Math.min(6 + 2 * L, 20), braid: Math.min(0.35, (L - 1) * 0.08), fog: Math.max(3.5, 7 - L * 0.4) };
  const o = over || {};
  return { ...base, ...(o.cells ? { cells: o.cells } : {}), ...(o.studySeconds ? { study: o.studySeconds } : {}) };
}

function parseRows(rows) {
  const g = rows.map((r) => [...r].map((ch) => (ch === '#' ? 1 : 0)));
  const size = g.length, c = 2 * Math.floor((size - 1) / 2 / 2) + 1;
  let gate = null;
  for (let i = 0; i < size; i++) for (const [x, y] of [[i, 0], [i, size - 1], [0, i], [size - 1, i]]) if (g[y][x] === 0) gate = { x, y };
  return { g, size, center: { x: c, y: c }, gate };
}

function buildLevel() {
  const cfg = levelConfig(S.level, S.next);
  S.cfg = cfg;
  S.mode = S.level % 2 === 1 ? 'escape' : 'enter';
  S.name = S.next?.name || '';
  maze = null;
  if (S.next?.rows) { try { maze = parseRows(S.next.rows); if (!maze.gate) maze = null; } catch { maze = null; } }
  S.aiMaze = !!maze;
  if (!maze) maze = makeMaze(cfg.cells, (Date.now() ^ (S.level * 9973)) >>> 0, cfg.braid);
  if (S.mode === 'escape') { S.start = maze.center; S.goal = maze.gate; }
  else { S.start = maze.gate; S.goal = maze.center; }
  distToGoal = bfs(maze.g, S.goal);
  S.opt = distToGoal[S.start.y][S.start.x];
  S.px = S.start.x; S.py = S.start.y; S.pitch = 0;
  const d0 = DIRS.findIndex(([dx, dy]) => maze.g[S.start.y + dy]?.[S.start.x + dx] === 0);
  S.yaw = -Math.max(0, d0) * Math.PI / 2;
  S.tile = { ...S.start };
  S.steps = S.wrong = S.peeks = S.bumps = 0; S.time = 0;
  scene.fog.far = cfg.fog;

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
  placeCamera();
  updateHud();
}

function placeCamera() {
  camera.position.set(S.px, EYE, S.py);
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
let lastBump = 0;
function step(dt, now) {
  const fwd = input.fwd(), turn = input.turn();
  S.yaw -= turn * TURN * dt;
  if (Math.abs(fwd) > 0.02) {
    const sp = fwd * SPEED * dt;
    const dx = -Math.sin(S.yaw) * sp, dy = -Math.cos(S.yaw) * sp;
    let hit = false;
    if (!blocked(S.px + dx, S.py)) S.px += dx; else hit = true;
    if (!blocked(S.px, S.py + dy)) S.py += dy; else hit = true;
    if (hit && now - lastBump > 600) {
      lastBump = now; S.bumps++; navigator.vibrate?.(20);
      const f = $('flash'); f.style.opacity = .18; setTimeout(() => (f.style.opacity = 0), 90);
    }
  }
  const tx = Math.round(S.px), ty = Math.round(S.py);
  if (tx !== S.tile.x || ty !== S.tile.y) {
    if (distToGoal[ty]?.[tx] > distToGoal[S.tile.y][S.tile.x]) S.wrong++;
    S.steps++; S.tile = { x: tx, y: ty };
    if (tx === S.goal.x && ty === S.goal.y) win();
  }
  placeCamera();
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
stickEl.addEventListener('pointerdown', (e) => { e.preventDefault(); stick.id = e.pointerId; stickEl.setPointerCapture(e.pointerId); setStick(e); });
stickEl.addEventListener('pointermove', (e) => { if (e.pointerId === stick.id) setStick(e); });
const release = (e) => { if (e.pointerId !== stick.id) return; stick.id = null; stick.x = stick.y = 0; knob.style.transform = ''; };
stickEl.addEventListener('pointerup', release); stickEl.addEventListener('pointercancel', release);

const view = $('view'); let look = null;
view.addEventListener('pointerdown', (e) => { look = { id: e.pointerId, x: e.clientX, y: e.clientY }; view.setPointerCapture(e.pointerId); });
view.addEventListener('pointermove', (e) => {
  if (!look || e.pointerId !== look.id || !S.running) return;
  S.yaw -= (e.clientX - look.x) * 0.006;
  S.pitch = Math.max(-0.5, Math.min(0.5, S.pitch - (e.clientY - look.y) * 0.004));
  look.x = e.clientX; look.y = e.clientY;
});
const endLook = () => { look = null; };
view.addEventListener('pointerup', endLook); view.addEventListener('pointercancel', endLook);

const KEYS = { ArrowUp: 'fwd', w: 'fwd', ArrowDown: 'back', s: 'back', ArrowLeft: 'left', a: 'left', ArrowRight: 'right', d: 'right' };
window.addEventListener('keydown', (e) => {
  const k = KEYS[e.key] || KEYS[e.key.toLowerCase?.()];
  if (k) { e.preventDefault(); keys.add(k); }
  if (e.key === 'm' || e.key === 'M') peek();
});
window.addEventListener('keyup', (e) => { const k = KEYS[e.key] || KEYS[e.key.toLowerCase?.()]; if (k) keys.delete(k); });
document.querySelector('[data-act="peek"]').addEventListener('pointerdown', (e) => { e.preventDefault(); peek(); });

// ---------- timing / HUD ----------
const elapsed = () => (S.running ? (performance.now() - S.t0) / 1000 : S.time);
const finalTime = (t = elapsed()) => t + S.peeks * PEEK_SECS;
const bestKey = () => `chakravyuh-best-${S.level}`;
function facing() {
  const a = ((-S.yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(a / (Math.PI / 4)) % 8];
}
function updateHud() {
  $('h-level').textContent = S.level;
  $('h-time').textContent = finalTime().toFixed(1);
  const b = store.get(bestKey());
  $('h-best').textContent = b ? b.toFixed(1) : '–';
  $('h-dir').textContent = facing();
  $('h-goal').textContent = S.mode === 'escape' ? 'out' : 'to the centre';
}

// ---------- map drawing ----------
function drawMap(cv, showYou) {
  const { g, size } = maze;
  const px = Math.floor(Math.min(560, window.innerWidth * 2) / size);
  cv.width = cv.height = px * size;
  const x = cv.getContext('2d');
  x.fillStyle = '#1b130e'; x.fillRect(0, 0, cv.width, cv.height);
  for (let yy = 0; yy < size; yy++) for (let xx = 0; xx < size; xx++) {
    x.fillStyle = g[yy][xx] === 1 ? '#7a4326' : '#e9d9bd';
    x.fillRect(xx * px, yy * px, px, px);
  }
  const dot = (p, c) => { x.fillStyle = c; x.beginPath(); x.arc((p.x + .5) * px, (p.y + .5) * px, px * .38, 0, 7); x.fill(); };
  dot(S.goal, '#ff9a1f');
  if (showYou) {
    const cx = (S.px + .5) * px, cy = (S.py + .5) * px, r = px * .45;
    const a = Math.atan2(-Math.cos(S.yaw), -Math.sin(S.yaw));
    x.fillStyle = '#2fa864'; x.beginPath();
    x.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    x.lineTo(cx + Math.cos(a + 2.4) * r, cy + Math.sin(a + 2.4) * r);
    x.lineTo(cx + Math.cos(a - 2.4) * r, cy + Math.sin(a - 2.4) * r);
    x.fill();
  } else dot(S.start, '#2fa864');
}

// ---------- flow ----------
function show(id, on = true) { $(id).classList.toggle('show', on); }
let studyTimer;
function startStudy() {
  buildLevel();
  const label = S.mode === 'escape' ? 'Escape the Chakravyuh' : 'Reach the centre';
  $('s-title').textContent = `Level ${S.level} · ${S.name ? S.name : label}${S.aiMaze ? ' · designed by AI' : ''}`;
  drawMap($('map'), false);
  show('study');
  let n = S.cfg.study;
  $('s-count').textContent = n;
  clearInterval(studyTimer);
  studyTimer = setInterval(() => { n--; $('s-count').textContent = n; if (n <= 0) beginWalk(); }, 1000);
}
function beginWalk() {
  clearInterval(studyTimer);
  show('study', false);
  S.running = true; S.t0 = performance.now();
  toast(S.mode === 'escape' ? 'Find the way out' : 'Find the centre');
}
let peekTimer;
function peek() {
  if (!S.running || $('peek').classList.contains('show')) return;
  S.peeks++; updateHud();
  drawMap($('peekmap'), true);
  show('peek');
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => show('peek', false), 2000);
}
function win() {
  S.running = false; S.time = (performance.now() - S.t0) / 1000;
  const ft = finalTime(S.time);
  const prev = store.get(bestKey());
  const isBest = !prev || ft < prev;
  if (isBest) store.set(bestKey(), ft);
  $('d-title').textContent = `Level ${S.level} cleared${isBest ? ' · new best' : ''}`;
  $('d-score').textContent = `${ft.toFixed(1)}s`;
  $('d-time').textContent = `${S.time.toFixed(1)}s`;
  $('d-peeks').textContent = `${S.peeks} (+${S.peeks * PEEK_SECS}s)`;
  $('d-best').textContent = `${Math.min(ft, prev || ft).toFixed(1)}s`;
  $('d-steps').textContent = S.steps;
  $('d-opt').textContent = S.opt;
  $('d-wrong').textContent = S.wrong;
  $('d-tip').textContent = 'The Guru is reading your path and designing your next maze…';
  $('next').disabled = true;
  show('done');
  updateHud();
  askGuru().then((j) => {
    $('d-tip').textContent = j.tip;
    S.next = j;
    $('next').disabled = false;
  });
}

// ---------- AI Guru ----------
function runStats() {
  return {
    level: S.level, mode: S.mode, cells: S.cfg.cells, seconds: +S.time.toFixed(1),
    steps: S.steps, shortest: S.opt, wrongSteps: S.wrong, peeks: S.peeks, bumps: S.bumps,
    studySeconds: S.cfg.study, braid: S.cfg.braid,
  };
}
function localGuru(st) {
  const eff = st.shortest / Math.max(st.steps, 1);
  let tip;
  if (st.peeks === 0 && eff > 0.9) tip = 'Perfect recall. Next time, say the turns out loud while you study: "left, right, right".';
  else if (st.peeks > 2) tip = 'You leaned on the map. While studying, trace the path with your finger and count the turns.';
  else if (st.bumps > 4) tip = 'Many walls hit. Glance at FACING before each turn so it matches the map in your head.';
  else if (eff < 0.6) tip = 'Long detours. Memorise landmarks: "first dead end on the left, then straight past two openings".';
  else tip = 'Good run. Chunk the route into three parts and remember only the turns in each.';
  const great = eff > 0.85 && st.peeks === 0;
  return { tip, cells: Math.min(st.cells + (great ? 2 : 1), 13), studySeconds: Math.max(6, Math.min(20, st.studySeconds + (st.peeks > 1 ? 4 : 1))), source: 'local' };
}
async function askGuru() {
  const st = runStats();
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 12000);
    const r = await fetch('/api/guru', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(st), signal: ctl.signal });
    clearTimeout(to);
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    if (!j.tip) throw new Error('no tip');
    return j;
  } catch { return localGuru(st); }
}

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 1600);
}

$('start').addEventListener('click', () => { show('intro', false); startStudy(); });
$('ready').addEventListener('click', beginWalk);
$('next').addEventListener('click', () => { show('done', false); S.level++; startStudy(); });

// ---------- loop ----------
let last = performance.now(), hudT = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (S.running) step(dt, now);
  if (goalMarker) { goalMarker.rotation.y = now / 600; goalMarker.position.y = 0.6 + Math.sin(now / 400) * 0.04; }
  torch.intensity = 2.1 + Math.sin(now / 90) * 0.12 + Math.sin(now / 37) * 0.08;
  if (S.running && now - hudT > 100) { hudT = now; updateHud(); }
  renderer.render(scene, camera);
}
resize();
buildLevel();
requestAnimationFrame(loop);
// debug hook for automated checks
window.__ck = { S, get maze() { return maze; } };
