import * as THREE from 'three';

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function demonTexture() {
  const pixels = new Uint8Array(32 * 32 * 4);
  const rect = (x, y, w, h, color) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) {
      pixels.set([...color, 255], (j * 32 + i) * 4);
    }
  };
  rect(6, 9, 20, 17, [83, 12, 18]);
  rect(8, 8, 16, 18, [210, 34, 28]);
  rect(5, 2, 4, 11, [238, 121, 58]); rect(23, 2, 4, 11, [238, 121, 58]);
  rect(9, 14, 5, 4, [24, 8, 16]); rect(18, 14, 5, 4, [24, 8, 16]);
  rect(10, 15, 3, 2, [255, 222, 75]); rect(19, 15, 3, 2, [255, 222, 75]);
  rect(11, 21, 10, 3, [35, 5, 13]);
  rect(11, 21, 2, 4, [255, 232, 183]); rect(19, 21, 2, 4, [255, 232, 183]);
  let texture;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const data = ctx.createImageData(32, 32);
    data.data.set(pixels); ctx.putImageData(data, 0, 0);
    texture = new THREE.CanvasTexture(canvas);
  } else {
    texture = new THREE.DataTexture(pixels, 32, 32);
  }
  texture.magFilter = texture.minFilter = THREE.NearestFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

export class Monsters {
  constructor(scene, g, opts = {}) {
    this.scene = scene; this.monsters = []; this.time = 0;
    this.speed = Math.max(0, opts.speed ?? 1.1);
    const random = mulberry32(opts.seed ?? 1);
    const floor = [];
    g.forEach((row, y) => row.forEach((v, x) => { if (v === 0) floor.push({ x, y }); }));
    const neighbors = p => DIRS.map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy }))
      .filter(p => g[p.y]?.[p.x] === 0);
    const avoid = opts.avoid ?? floor[0] ?? { x: 0, y: 0 };
    const start = floor.reduce((best, p) => !best ||
      Math.hypot(p.x - avoid.x, p.y - avoid.y) < Math.hypot(best.x - avoid.x, best.y - avoid.y) ? p : best, null);
    const key = p => `${p.x},${p.y}`;
    const dist = new Map(), queue = start ? [start] : [];
    if (start) dist.set(key(start), 0);
    for (let i = 0; i < queue.length; i++) for (const p of neighbors(queue[i])) {
      if (!dist.has(key(p))) { dist.set(key(p), dist.get(key(queue[i])) + 1); queue.push(p); }
    }
    const candidates = floor.filter(p => dist.has(key(p)) && dist.get(key(p)) >= (opts.avoidRadius ?? 4));
    this.ownsTexture = !opts.texture;
    this.texture = opts.texture ?? demonTexture();
    this.material = new THREE.SpriteMaterial({ map: this.texture, transparent: true });
    const count = Math.min(4, Math.max(0, Math.floor(opts.count ?? 3)));
    for (let i = 0; i < count && candidates.length; i++) {
      const origin = candidates.splice(Math.floor(random() * candidates.length), 1)[0];
      const route = [origin], visited = new Set([key(origin)]), limit = 4 + Math.floor(random() * 5);
      let longest = route.slice();
      const extend = () => {
        const adjacent = neighbors(route[route.length - 1]);
        if (route.length > longest.length) longest = route.slice();
        if (route.length === limit || (route.length >= 4 && adjacent.length > 2)) return true;
        const next = adjacent.filter(p => !visited.has(key(p)));
        while (next.length) {
          const p = next.splice(Math.floor(random() * next.length), 1)[0];
          route.push(p); visited.add(key(p));
          if (extend()) return true;
          route.pop(); visited.delete(key(p));
        }
        return route.length >= 4;
      };
      if (!extend()) route.splice(0, route.length, ...longest);
      const sprite = new THREE.Sprite(this.material);
      sprite.geometry = sprite.geometry.clone();
      sprite.scale.set(0.8, 0.8, 1); sprite.position.set(origin.x, 0.45, origin.y);
      const light = new THREE.PointLight(0xff2a1a, 0.9, 2.2);
      light.position.copy(sprite.position);
      this.scene.add(sprite); this.scene.add(light);
      this.monsters.push({ route, sprite, light, x: origin.x, y: origin.y,
        travel: 0, cooldown: 0, phase: random() * Math.PI * 2 });
    }
  }

  update(dt, px, py) {
    dt = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.time += dt;
    let result = null;
    for (const m of this.monsters) {
      const activeDt = Math.max(0, dt - m.cooldown);
      m.cooldown = Math.max(0, m.cooldown - dt);
      const span = m.route.length - 1;
      if (span > 0) {
        m.travel = (m.travel + activeDt * this.speed) % (2 * span);
        const offset = m.travel <= span ? m.travel : 2 * span - m.travel;
        const index = Math.min(Math.floor(offset), span - 1), t = offset - index;
        const a = m.route[index], b = m.route[index + 1];
        m.x = a.x + (b.x - a.x) * t; m.y = a.y + (b.y - a.y) * t;
      }
      m.sprite.position.set(m.x, 0.45 + Math.sin(this.time * 5 + m.phase) * 0.035, m.y);
      m.light.position.copy(m.sprite.position);
      if (m.cooldown === 0 && Math.hypot(px - m.x, py - m.y) <= 0.42) {
        m.cooldown = 2; result = 'caught';
      }
      m.sprite.visible = m.light.visible = m.cooldown === 0;
    }
    return result;
  }

  drawOnMap(ctx, cellPx) {
    ctx.save(); ctx.lineWidth = Math.max(1, cellPx * 0.1);
    for (const m of this.monsters) {
      ctx.strokeStyle = 'rgba(255,42,26,0.25)'; ctx.beginPath();
      m.route.forEach((p, i) => ctx[i ? 'lineTo' : 'moveTo']((p.x + 0.5) * cellPx, (p.y + 0.5) * cellPx));
      ctx.stroke();
      if (m.cooldown > 0) continue;
      ctx.beginPath(); ctx.arc((m.x + 0.5) * cellPx, (m.y + 0.5) * cellPx, Math.max(2, cellPx * 0.22), 0, Math.PI * 2);
      ctx.fillStyle = '#ff2a1a'; ctx.fill(); ctx.strokeStyle = '#300b0b'; ctx.stroke();
    }
    ctx.restore();
  }

  nearest(px, py) {
    return this.monsters.reduce((d, m) => m.cooldown > 0 ? d : Math.min(d, Math.hypot(px - m.x, py - m.y)), Infinity);
  }

  dispose() {
    for (const m of this.monsters) {
      this.scene.remove(m.sprite); this.scene.remove(m.light);
      m.sprite.geometry.dispose(); m.light.dispose();
    }
    this.monsters.length = 0;
    this.material.dispose();
    if (this.ownsTexture) this.texture.dispose();
  }
}
