const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const COLS = 48;
const ROWS = 36;
const SPEED_MS = 120;
const MAX_KOSTKY = 23;
const KOSTKA_SPAWN_MS = 2000;
const PLAYER_COLORS = [
  { r: 0, g: 217, b: 255 },
  { r: 255, g: 107, b: 107 },
  { r: 0, g: 255, b: 136 },
  { r: 255, g: 215, b: 0 },
  { r: 180, g: 100, b: 255 },
  { r: 255, g: 140, b: 50 },
  { r: 100, g: 200, b: 255 },
  { r: 255, g: 100, b: 180 },
];

const SPAWN_SLOTS = [
  { x: 8, y: Math.floor(ROWS / 2), dir: { x: 1, y: 0 } },
  { x: COLS - 9, y: Math.floor(ROWS / 2), dir: { x: -1, y: 0 } },
  { x: Math.floor(COLS / 2), y: 8, dir: { x: 0, y: 1 } },
  { x: Math.floor(COLS / 2), y: ROWS - 9, dir: { x: 0, y: -1 } },
  { x: 12, y: 12, dir: { x: 1, y: 0 } },
  { x: COLS - 13, y: ROWS - 13, dir: { x: -1, y: 0 } },
  { x: 12, y: ROWS - 13, dir: { x: 1, y: 0 } },
  { x: COLS - 13, y: 12, dir: { x: -1, y: 0 } },
];

const players = new Map();
let gameStatus = 'lobby';
let kostky = [];
let hueCounter = 0;
let lastKostkaSpawn = 0;
let gameLoopTimer = null;

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min));
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const p of players.values()) {
    if (p.ws.readyState === p.ws.OPEN) {
      p.ws.send(data);
    }
  }
}

function getLocalIp() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function getShareUrl() {
  const ip = getLocalIp();
  return `http://${ip}:${PORT}`;
}

function lobbySnapshot() {
  return {
    type: 'lobby',
    status: gameStatus,
    shareUrl: getShareUrl(),
    players: [...players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      alive: p.alive,
      score: p.score,
    })),
  };
}

function sendWelcome(ws, id) {
  const snap = lobbySnapshot();
  send(ws, {
    type: 'welcome',
    id,
    status: snap.status,
    shareUrl: snap.shareUrl,
    players: snap.players,
  });
}

function broadcastLobby() {
  broadcast(lobbySnapshot());
}

function makeSnake(slot) {
  const head = { x: slot.x, y: slot.y };
  const dir = slot.dir;
  return [
    head,
    { x: head.x - dir.x, y: head.y - dir.y },
    { x: head.x - dir.x * 2, y: head.y - dir.y * 2 },
  ];
}

function occupiedCells(excludeId = null) {
  const set = new Set();
  for (const p of players.values()) {
    if (p.id === excludeId || !p.alive) continue;
    p.snake.forEach((s) => set.add(`${s.x},${s.y}`));
  }
  kostky.forEach((k) => set.add(`${k.x},${k.y}`));
  return set;
}

function spawnOneKostka() {
  if (kostky.length >= MAX_KOSTKY) return;
  const blocked = occupiedCells();
  const free = [];
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      if (!blocked.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  if (free.length === 0) return;
  const cell = free[randInt(0, free.length)];
  const hue = (hueCounter++ * 360) / 24 % 360;
  kostky.push({ x: cell.x, y: cell.y, hue });
}

function spawnKostky() {
  kostky = [];
  hueCounter = 0;
  spawnOneKostka();
  spawnOneKostka();
}

function gameStatePayload() {
  return {
    type: 'state',
    kostky,
    players: [...players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      snake: p.snake,
      score: p.score,
      alive: p.alive,
      colorIndex: p.colorIndex,
    })),
  };
}

function broadcastState() {
  broadcast(gameStatePayload());
}

function stopGameLoop() {
  if (gameLoopTimer) {
    clearInterval(gameLoopTimer);
    gameLoopTimer = null;
  }
}

function resetToLobby() {
  stopGameLoop();
  gameStatus = 'lobby';
  kostky = [];
  lastKostkaSpawn = 0;
  for (const p of players.values()) {
    p.alive = true;
    p.score = 0;
    p.snake = [];
    p.direction = { x: 1, y: 0 };
    p.nextDirection = { x: 1, y: 0 };
  }
  broadcastLobby();
}

function endMultiplayerGame(winnerId = null) {
  stopGameLoop();
  gameStatus = 'lobby';
  broadcast({
    type: 'gameOver',
    winnerId,
    players: [...players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      alive: p.alive,
    })),
  });
  for (const p of players.values()) {
    p.alive = true;
    p.score = 0;
    p.snake = [];
  }
  kostky = [];
  broadcastLobby();
}

function tickGame() {
  if (gameStatus !== 'playing') return;

  const now = Date.now();
  if (now - lastKostkaSpawn >= KOSTKA_SPAWN_MS) {
    lastKostkaSpawn = now;
    spawnOneKostka();
  }

  const active = [...players.values()].filter((p) => p.alive);
  if (active.length === 0) {
    endMultiplayerGame();
    return;
  }

  const bodyMap = new Map();
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
    if (
      newHead.x < 0 ||
      newHead.x >= COLS ||
      newHead.y < 0 ||
      newHead.y >= ROWS
    ) {
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
    endMultiplayerGame();
    return;
  }
  if (stillAlive.length === 1 && active.length > 1) {
    endMultiplayerGame(stillAlive[0].id);
    return;
  }

  broadcastState();
}

function startGame(requesterId) {
  if (gameStatus === 'playing') return false;
  if (players.size < 1) return false;

  gameStatus = 'playing';
  kostky = [];
  hueCounter = 0;
  lastKostkaSpawn = Date.now();
  spawnKostky();

  let slotIndex = 0;
  for (const p of players.values()) {
    const slot = SPAWN_SLOTS[slotIndex % SPAWN_SLOTS.length];
    slotIndex += 1;
    p.alive = true;
    p.score = 0;
    p.snake = makeSnake(slot);
    p.direction = { ...slot.dir };
    p.nextDirection = { ...slot.dir };
  }

  broadcast({ type: 'gameStart', startedBy: requesterId });
  broadcastState();

  stopGameLoop();
  gameLoopTimer = setInterval(tickGame, SPEED_MS);
  return true;
}

function removePlayer(id) {
  if (!id || !players.has(id)) return;
  players.delete(id);
  if (gameStatus === 'playing' && players.size === 0) {
    resetToLobby();
    return;
  }
  if (gameStatus === 'playing' && [...players.values()].filter((p) => p.alive).length <= 1) {
    const winner = [...players.values()].find((p) => p.alive);
    endMultiplayerGame(winner ? winner.id : null);
  }
  broadcastLobby();
  if (gameStatus === 'playing') broadcastState();
}

function handleMessage(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    send(ws, { type: 'error', message: 'Neplatná zpráva.' });
    return;
  }

  if (msg.type === 'join') {
    const name = (msg.name || '').trim().slice(0, 20);
    if (!name) {
      send(ws, { type: 'error', message: 'Chybí jméno.' });
      return;
    }
    const duplicate = [...players.values()].some(
      (p) => p.ws !== ws && p.name.toLowerCase() === name.toLowerCase()
    );
    if (duplicate) {
      send(ws, { type: 'error', message: 'Toto jméno už je na serveru obsazené.' });
      return;
    }

    let existing = [...players.entries()].find(([, p]) => p.ws === ws);
    if (existing) {
      existing[1].name = name;
      sendWelcome(ws, existing[0]);
      broadcastLobby();
      return;
    }

    const id = `p_${Date.now()}_${randInt(1000, 9999)}`;
    players.set(id, {
      id,
      ws,
      name,
      snake: [],
      direction: { x: 1, y: 0 },
      nextDirection: { x: 1, y: 0 },
      score: 0,
      alive: true,
      colorIndex: players.size % PLAYER_COLORS.length,
    });
    ws.playerId = id;
    sendWelcome(ws, id);
    broadcastLobby();
    return;
  }

  const player = players.get(ws.playerId);
  if (!player) {
    send(ws, { type: 'error', message: 'Nejdřív se připoj ke hře.' });
    return;
  }

  if (msg.type === 'start') {
    if (gameStatus === 'playing') return;
    if (players.size < 1) {
      send(ws, { type: 'error', message: 'Na serveru není žádný hráč.' });
      return;
    }
    if (!startGame(player.id)) {
      send(ws, { type: 'error', message: 'Hru se nepodařilo spustit.' });
    }
    return;
  }

  if (msg.type === 'input') {
    if (gameStatus !== 'playing' || !player.alive) return;
    const dir = msg.direction;
    if (!dir || typeof dir.x !== 'number' || typeof dir.y !== 'number') return;
    if (Math.abs(dir.x) + Math.abs(dir.y) !== 1) return;
    if (player.direction.x === -dir.x && player.direction.y === -dir.y) return;
    player.nextDirection = { x: dir.x, y: dir.y };
    return;
  }

  if (msg.type === 'leaveLobby') {
    removePlayer(ws.playerId);
    ws.playerId = null;
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const relPath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const fullPath = path.normalize(path.join(__dirname, relPath));

  if (!fullPath.startsWith(__dirname)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  ws.on('message', (data) => handleMessage(ws, data.toString()));
  ws.on('close', () => removePlayer(ws.playerId));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Snake server běží na http://localhost:${PORT}`);
  console.log(`Pro kamarády v síti: ${getShareUrl()}`);
});
