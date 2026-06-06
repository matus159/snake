import type { Direction, Kostka, Player, Point } from './types';

export const COLS = 48;
export const ROWS = 36;
export const SPEED_MS = 120;
export const MAX_KOSTKY = 23;
export const KOSTKA_SPAWN_MS = 2000;

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
  kostky.push({ x: cell.x, y: cell.y, hue });
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
      kostky.splice(eatenIndex, 1);
      player.score += 1;
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
