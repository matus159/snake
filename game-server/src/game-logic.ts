import type { Direction, Kostka, Player, Point } from './types';

export const COLS = 48;
export const ROWS = 36;
export const SPEED_MS = 120;
export const MAX_KOSTKY = 23;
export const KOSTKA_SPAWN_MS = 2000;
// Tacos event (musí sedět s TACOS_EVENT v index.html): část kostek je zlatá s tacos.
export const TACOS_EVENT = true;
export const TACO_CHANCE = 0.45;
export const TACO_SCORE = 2;
// Tacos event běží jen v určitý čas (český čas, Europe/Prague):
// po–pá 16:00–16:15, so–ne celý den. Musí sedět s index.html.
export const TACOS_TIME_ZONE = 'Europe/Prague';
const TACOS_WEEKDAY_WINDOW = [16 * 60, 16 * 60 + 15];
const TACOS_WEEKEND_WINDOW = [0, 24 * 60];
// Dny (RRRR-MM-DD, český čas), kdy tacos event běží celý den.
const TACOS_ALL_DAY_DATES: string[] = ['2026-10-23'];
// Mimořádné tacos eventy navíc: [začátek, konec] (UTC). Musí sedět s index.html.
const TACOS_EXTRA_WINDOWS: [string, string][] = [];

export function isTacosEventActive(now: Date = new Date()): boolean {
  if (!TACOS_EVENT) return false;
  if (TACOS_EXTRA_WINDOWS.some(([from, to]) => now >= new Date(from) && now < new Date(to))) return true;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TACOS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  if (TACOS_ALL_DAY_DATES.includes(`${get('year')}-${get('month')}-${get('day')}`)) return true;
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  const weekend = get('weekday') === 'Sat' || get('weekday') === 'Sun';
  const [from, to] = weekend ? TACOS_WEEKEND_WINDOW : TACOS_WEEKDAY_WINDOW;
  return minutes >= from && minutes < to;
}

export const SPAWN_SLOTS = [
  { x: 8, y: Math.floor(ROWS / 2), dir: { x: 1, y: 0 } },
  { x: COLS - 9, y: Math.floor(ROWS / 2), dir: { x: -1, y: 0 } },
  { x: Math.floor(COLS / 2), y: 8, dir: { x: 0, y: 1 } },
  { x: Math.floor(COLS / 2), y: ROWS - 9, dir: { x: 0, y: -1 } },
  { x: 12, y: 12, dir: { x: 1, y: 0 } },
  { x: COLS - 13, y: ROWS - 13, dir: { x: -1, y: 0 } },
  { x: 12, y: ROWS - 13, dir: { x: 1, y: 0 } },
  { x: COLS - 13, y: 12, dir: { x: -1, y: 0 } },
];

export function randInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min));
}

export function makeSnake(slot: { x: number; y: number; dir: Direction }): Point[] {
  const head = { x: slot.x, y: slot.y };
  const dir = slot.dir;
  return [
    head,
    { x: head.x - dir.x, y: head.y - dir.y },
    { x: head.x - dir.x * 2, y: head.y - dir.y * 2 },
  ];
}

export function occupiedCells(
  players: Map<string, Player>,
  kostky: Kostka[],
  excludeId: string | null = null,
): Set<string> {
  const set = new Set<string>();
  for (const p of players.values()) {
    if (p.id === excludeId || !p.alive) continue;
    p.snake.forEach((s) => set.add(`${s.x},${s.y}`));
  }
  kostky.forEach((k) => set.add(`${k.x},${k.y}`));
  return set;
}

export function spawnOneKostka(
  players: Map<string, Player>,
  kostky: Kostka[],
  hueCounter: number,
): number {
  if (kostky.length >= MAX_KOSTKY) return hueCounter;
  const blocked = occupiedCells(players, kostky);
  const free: Point[] = [];
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      if (!blocked.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  if (free.length === 0) return hueCounter;
  const cell = free[randInt(0, free.length)];
  const hue = (hueCounter * 360) / 24 % 360;
  const taco = isTacosEventActive() && Math.random() < TACO_CHANCE;
  kostky.push({ x: cell.x, y: cell.y, hue, taco });
  return hueCounter + 1;
}

export function spawnKostky(players: Map<string, Player>, kostky: Kostka[]): number {
  kostky.length = 0;
  let hueCounter = 0;
  hueCounter = spawnOneKostka(players, kostky, hueCounter);
  hueCounter = spawnOneKostka(players, kostky, hueCounter);
  return hueCounter;
}

export interface TickResult {
  ended: boolean;
  winnerId: string | null;
}

export function tickGame(players: Map<string, Player>, kostky: Kostka[]): TickResult {
  const active = [...players.values()].filter((p) => p.alive);
  if (active.length === 0) {
    return { ended: true, winnerId: null };
  }

  const bodyMap = new Map<string, string>();
  for (const p of active) {
    for (const seg of p.snake) {
      bodyMap.set(`${seg.x},${seg.y}`, p.id);
    }
  }

  const moves = active.map((p) => {
    p.direction = { ...p.nextDirection };
    const head = p.snake[0];
    return {
      player: p,
      newHead: { x: head.x + p.direction.x, y: head.y + p.direction.y },
    };
  });

  for (const m of moves) {
    const { player, newHead } = m;
    if (newHead.x < 0 || newHead.x >= COLS || newHead.y < 0 || newHead.y >= ROWS) {
      player.alive = false;
      continue;
    }
    const key = `${newHead.x},${newHead.y}`;
    if (bodyMap.has(key)) {
      player.alive = false;
    }
  }

  for (let i = 0; i < moves.length; i++) {
    for (let j = i + 1; j < moves.length; j++) {
      const a = moves[i];
      const b = moves[j];
      if (!a.player.alive || !b.player.alive) continue;
      if (a.newHead.x === b.newHead.x && a.newHead.y === b.newHead.y) {
        a.player.alive = false;
        b.player.alive = false;
      }
    }
  }

  for (const m of moves) {
    const { player, newHead } = m;
    if (!player.alive) continue;
    player.snake.unshift(newHead);
    const eatenIndex = kostky.findIndex((k) => k.x === newHead.x && k.y === newHead.y);
    if (eatenIndex !== -1) {
      const [eaten] = kostky.splice(eatenIndex, 1);
      if (eaten.taco) {
        player.score += TACO_SCORE;
        player.tacos += 1;
      } else {
        player.score += 1;
      }
    } else {
      player.snake.pop();
    }
  }

  const stillAlive = [...players.values()].filter((p) => p.alive);
  if (stillAlive.length === 0) {
    return { ended: true, winnerId: null };
  }
  if (stillAlive.length === 1 && active.length > 1) {
    return { ended: true, winnerId: stillAlive[0].id };
  }

  return { ended: false, winnerId: null };
}

// Bot: vybere směr ke kostce, vyhne se zdem a hadům a nevleze do slepé uličky.
export function botDirection(bot: Player, players: Map<string, Player>, kostky: Kostka[]): Direction {
  const head = bot.snake[0];
  const blocked = new Set<string>();
  for (const p of players.values()) {
    if (!p.alive) continue;
    p.snake.forEach((s) => blocked.add(`${s.x},${s.y}`));
  }
  const dirs: Direction[] = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ].filter((d) => !(d.x === -bot.direction.x && d.y === -bot.direction.y));
  const inside = (x: number, y: number) => x >= 0 && x < COLS && y >= 0 && y < ROWS;
  const space = (sx: number, sy: number, limit: number) => {
    const seen = new Set<string>([`${sx},${sy}`]);
    const queue = [[sx, sy]];
    while (queue.length && seen.size < limit) {
      const [x, y] = queue.shift()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        const key = `${nx},${ny}`;
        if (!inside(nx, ny) || blocked.has(key) || seen.has(key)) continue;
        seen.add(key);
        queue.push([nx, ny]);
      }
    }
    return seen.size;
  };
  let best: Direction | null = null;
  let bestScore = -Infinity;
  for (const d of dirs) {
    const nx = head.x + d.x;
    const ny = head.y + d.y;
    if (!inside(nx, ny) || blocked.has(`${nx},${ny}`)) continue;
    const room = space(nx, ny, 80);
    let nearest = COLS + ROWS;
    for (const k of kostky) nearest = Math.min(nearest, Math.abs(k.x - nx) + Math.abs(k.y - ny));
    let score = -nearest * 2;
    if (room < bot.snake.length + 6) score -= 1000 - room;
    // kousek náhody, ať se boti dají porazit
    score += Math.random() * 3;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best ?? bot.direction;
}
