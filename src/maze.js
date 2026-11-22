// Maze generation + path helpers. Tile grid: 1 = wall, 0 = floor.
// A maze of n×n cells lives in a (2n+1)×(2n+1) tile grid; cells sit on odd tiles.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // N E S W

// braid: 0..1 share of dead ends opened into loops (more loops = harder to remember)
export function makeMaze(n, seed, braid = 0) {
  const rnd = mulberry32(seed);
  const size = 2 * n + 1;
  const g = Array.from({ length: size }, () => new Array(size).fill(1));
  const c = Math.floor(n / 2);
  const stack = [[c, c]];
  const seen = new Set([`${c},${c}`]);
  g[2 * c + 1][2 * c + 1] = 0;
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const opts = DIRS.map(([dx, dy]) => [cx + dx, cy + dy, dx, dy])
      .filter(([x, y]) => x >= 0 && y >= 0 && x < n && y < n && !seen.has(`${x},${y}`));
    if (!opts.length) { stack.pop(); continue; }
    const [x, y, dx, dy] = opts[Math.floor(rnd() * opts.length)];
    g[2 * cy + 1 + dy][2 * cx + 1 + dx] = 0;
    g[2 * y + 1][2 * x + 1] = 0;
    seen.add(`${x},${y}`);
    stack.push([x, y]);
  }
  if (braid > 0) {
    for (let y = 1; y < size - 1; y += 2) for (let x = 1; x < size - 1; x += 2) {
      const open = DIRS.filter(([dx, dy]) => g[y + dy][x + dx] === 0).length;
      if (open === 1 && rnd() < braid) {
        const walls = DIRS.filter(([dx, dy]) => {
          const wx = x + dx, wy = y + dy;
          return g[wy][wx] === 1 && wx > 0 && wy > 0 && wx < size - 1 && wy < size - 1;
        });
        if (walls.length) { const [dx, dy] = walls[Math.floor(rnd() * walls.length)]; g[y + dy][x + dx] = 0; }
      }
    }
  }
  const center = { x: 2 * c + 1, y: 2 * c + 1 };
  // exit = the edge opening farthest (by walking distance) from the centre
  const dist = bfs(g, center);
  let best = null;
  for (let i = 0; i < n; i++) {
    for (const [cell, gate] of [
      [{ x: 2 * i + 1, y: 1 }, { x: 2 * i + 1, y: 0 }],
      [{ x: 2 * i + 1, y: size - 2 }, { x: 2 * i + 1, y: size - 1 }],
      [{ x: 1, y: 2 * i + 1 }, { x: 0, y: 2 * i + 1 }],
      [{ x: size - 2, y: 2 * i + 1 }, { x: size - 1, y: 2 * i + 1 }],
    ]) {
      const d = dist[cell.y][cell.x] + rnd() * 2;
      if (!best || d > best.d) best = { d, gate };
    }
  }
  g[best.gate.y][best.gate.x] = 0;
  return { g, size, center, gate: best.gate };
}

export function bfs(g, from) {
  const size = g.length;
  const d = Array.from({ length: size }, () => new Array(size).fill(Infinity));
  d[from.y][from.x] = 0;
  const q = [from];
  while (q.length) {
    const { x, y } = q.shift();
    for (const [dx, dy] of DIRS) {
      const nx = x + dx, ny = y + dy;
      if (ny < 0 || nx < 0 || ny >= size || nx >= size) continue;
      if (g[ny][nx] === 1 || d[ny][nx] !== Infinity) continue;
      d[ny][nx] = d[y][x] + 1;
      q.push({ x: nx, y: ny });
    }
  }
  return d;
}
