const EXAMPLE = [
  '#.#######', '#.......#', '#.#####.#', '#.#...#.#', '#.#.#.#.#',
  '#...#...#', '###.###.#', '#.......#', '#########',
];

// Returns { valid, cells } on success or { valid: false, error } on failure.
export function validateMaze(rows) {
  const fail = error => ({ valid: false, error });
  if (!Array.isArray(rows)) return fail('rows must be an array of strings');
  const size = rows.length, cells = (size - 1) / 2;
  if (!Number.isInteger(cells) || cells < 4 || cells > 13)
    return fail('Use 2N+1 rows, with N an integer between 4 and 13');
  if (rows.some(row => typeof row !== 'string' || row.length !== size || /[^#.]/.test(row)))
    return fail(`Every row must contain exactly ${size} characters, only # or .`);
  const gates = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if ((x === 0 || y === 0 || x === size - 1 || y === size - 1) && rows[y][x] === '.')
      gates.push([x, y]);
  }
  if (gates.length !== 1) return fail(`Expected exactly one border opening; found ${gates.length}`);
  const center = 2 * Math.floor(cells / 2) + 1;
  if (rows[center][center] !== '.') return fail(`Centre tile (${center},${center}) must be floor`);
  const queue = [gates[0]], seen = new Set([gates[0].join(',')]);
  for (let i = 0; i < queue.length; i++) {
    const [x, y] = queue[i];
    if (x === center && y === center) return { valid: true, cells };
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size || rows[ny][nx] !== '.' || seen.has(key)) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }
  return fail('Centre is unreachable from the border gate by four-direction movement');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Only POST is supported' });
  }
  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY is not configured' });
  let stats;
  try {
    stats = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    if (!stats || !Number.isInteger(stats.cells) || stats.cells < 4 || stats.cells > 13 ||
        !['escape', 'enter'].includes(stats.mode)) throw new Error();
    for (const key of ['level', 'seconds', 'peeks', 'wrongSteps', 'shortest', 'steps', 'studySeconds', 'braid'])
      if (typeof stats[key] !== 'number' || !Number.isFinite(stats[key]) || stats[key] < 0) throw new Error();
    stats = Object.fromEntries(['level', 'mode', 'cells', 'seconds', 'peeks', 'wrongSteps',
      'shortest', 'steps', 'studySeconds', 'braid'].map(key => [key, stats[key]]));
  } catch {
    return res.status(400).json({ error: 'Provide valid JSON level statistics, mode, and cells (4–13)' });
  }
  const efficiency = stats.shortest / Math.max(stats.steps, 1);
  const fast = stats.seconds <= Math.max(20, stats.shortest * 2);
  const struggled = stats.peeks >= 3 || efficiency < 0.6 || stats.wrongSteps > Math.max(3, stats.shortest / 2);
  const great = !struggled && stats.peeks === 0 && efficiency >= 0.9 && fast && stats.wrongSteps <= 1;
  const nextCells = Math.min(13, stats.cells + (struggled ? 0 : great ? 2 : 1));
  const prompt = `You are Guru Drona, a warm, concise memory coach for Chakravyuh, a first-person memory maze.
Design the NEXT playable level for this player using their completed-level statistics below.
Harder for few peeks, near-shortest paths and fast finishes; easier for struggles.
This player ${struggled ? 'struggled' : great ? 'did great' : 'did well enough to progress'}.
Use exactly N=${nextCells} cells per axis (cap 13): same N if struggling, +2 if great, otherwise +1.
Adapt route complexity, dead ends and loops (braid) as well as study time to their performance.
Return ONLY a JSON object: {"tip":"one memory coaching sentence, max 25 words; a Hindi word is welcome",
"name":"a short evocative name for THIS maze, chosen to fit its shape, from the vyuhas of the Mahabharata (e.g. Krauncha the heron, Makara the crocodile, Garuda the eagle, Shakata the cart, Sarpa the serpent, Ardhachandra the half-moon, Mandala the circle, Vajra the thunderbolt), picked at random, do not default to Padma or Chakra","studySeconds":10,"rows":["..."]}.
studySeconds must be an integer from 5 to 20; give struggling players more study time.
rows must have exactly 2N+1 strings, EACH exactly 2N+1 characters, using ONLY # wall and . floor.
Logical cells are at odd (x,y) tile coordinates; make all logical cells floor and connect corridors.
The outer border must be all # EXCEPT exactly ONE . gate, adjacent to an interior floor.
The centre tile has x=y=2*floor(N/2)+1 (zero-based); it MUST be . and reachable from the gate
by up/down/left/right floor steps. For escape the player starts at centre; for enter they start at gate.
Short valid N=4 example (9 rows, each 9 characters; use YOUR requested N=${nextCells}):
${JSON.stringify(EXAMPLE)}
Completed-level statistics: ${JSON.stringify(stats)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9500);
  const messages = [{ role: 'user', content: prompt }];
  let metadata = { tip: 'Remember a landmark at each turn before you move.', name: 'Chakravyuh', studySeconds: 10 };
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal: controller.signal,
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-5-5', max_tokens: 1500, thinking: { type: 'disabled' }, output_config: { effort: 'low' }, messages }),
      });
      if (!response.ok) throw new Error(`Anthropic API returned HTTP ${response.status}`);
      const data = await response.json();
      if (data.error || !Array.isArray(data.content)) throw new Error('Invalid Anthropic API response');
      const raw = data.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
      let result, check;
      try {
        result = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1));
        if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
        if (typeof result.tip === 'string' && result.tip.trim())
          metadata.tip = result.tip.trim().split(/\s+/).slice(0, 25).join(' ');
        if (typeof result.name === 'string' && result.name.trim()) metadata.name = result.name.trim().slice(0, 100);
        if (typeof result.studySeconds === 'number' && Number.isFinite(result.studySeconds))
          metadata.studySeconds = Math.max(5, Math.min(20, Math.round(result.studySeconds)));
        check = validateMaze(result.rows);
        if (check.valid && check.cells !== nextCells)
          check = { valid: false, error: `Expected N=${nextCells}, received N=${check.cells}` };
      } catch {
        check = { valid: false, error: 'Response must be one valid JSON object, without markdown' };
      }
      if (controller.signal.aborted) throw new Error('Timeout');
      if (check.valid) return res.status(200).json({ ...metadata, rows: result.rows, cells: check.cells, source: 'claude' });
      if (attempt === 0) messages.push({ role: 'assistant', content: raw || '{}' },
        { role: 'user', content: `Validation failed: ${check.error}. Fix it and return the complete JSON object only.` });
    }
    return res.status(200).json({ ...metadata, source: 'claude' });
  } catch (error) {
    return res.status(503).json({ error: controller.signal.aborted ? 'Guru request timed out after 8 seconds' : error.message });
  } finally {
    clearTimeout(timer);
  }
}
