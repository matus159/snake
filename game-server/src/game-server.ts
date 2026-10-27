import {
  KOSTKA_SPAWN_MS,
  SPAWN_SLOTS,
  SPEED_MS,
  makeSnake,
  randInt,
  spawnKostky,
  spawnOneKostka,
  tickGame,
} from './game-logic';
import { handleStatsRequest } from './stats';
import type { Env, Kostka, Player, WsAttachment } from './types';

function send(ws: WebSocket, msg: unknown) {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* closed */
  }
}

function getAttachment(ws: WebSocket): WsAttachment {
  return (ws.deserializeAttachment() as WsAttachment | null) || {};
}

function setAttachment(ws: WebSocket, attachment: WsAttachment) {
  ws.serializeAttachment(attachment);
}

export class GameServer implements DurableObject {
  private state: DurableObjectState;
  private players = new Map<string, Player>();
  private gameStatus: 'lobby' | 'playing' = 'lobby';
  private kostky: Kostka[] = [];
  private hueCounter = 0;
  private lastKostkaSpawn = 0;
  private shareUrl = '';

  constructor(state: DurableObjectState, _env: Env) {
    this.state = state;
    this.state.blockConcurrencyWhile(async () => {
      // Dárky už ve hře nejsou: smaže starou frontu nedoručených dárků.
      await this.state.storage.delete('giftQueue');
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname.startsWith('/api/stats/')) {
      return handleStatsRequest(request, this.state.storage);
    }
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('WebSocket required', { status: 426 });
    }

    this.shareUrl = new URL('/', request.url).origin;

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.state.acceptWebSocket(server);
    setAttachment(server, {});

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      send(ws, { type: 'error', message: 'Neplatná zpráva.' });
      return;
    }

    const type = msg.type as string;

    if (type === 'join') {
      await this.handleJoin(ws, msg);
      return;
    }

    const attachment = getAttachment(ws);
    const player = attachment.playerId ? this.players.get(attachment.playerId) : undefined;
    if (!player) {
      send(ws, { type: 'error', message: 'Nejdřív se připoj ke hře.' });
      return;
    }

    if (type === 'start') {
      if (this.gameStatus === 'playing') return;
      if (this.players.size < 1) {
        send(ws, { type: 'error', message: 'Na serveru není žádný hráč.' });
        return;
      }
      if (!(await this.startGame(player.id))) {
        send(ws, { type: 'error', message: 'Hru se nepodařilo spustit.' });
      }
      return;
    }

    if (type === 'input') {
      if (this.gameStatus !== 'playing' || !player.alive) return;
      const dir = msg.direction as { x?: number; y?: number } | undefined;
      if (!dir || typeof dir.x !== 'number' || typeof dir.y !== 'number') return;
      if (Math.abs(dir.x) + Math.abs(dir.y) !== 1) return;
      if (player.direction.x === -dir.x && player.direction.y === -dir.y) return;
      player.nextDirection = { x: dir.x, y: dir.y };
      return;
    }

    if (type === 'leaveLobby') {
      await this.removePlayer(attachment.playerId!);
      setAttachment(ws, {});
    }
  }

  async webSocketClose(ws: WebSocket) {
    const attachment = getAttachment(ws);
    if (attachment.playerId) {
      await this.removePlayer(attachment.playerId);
    }
  }

  private async handleJoin(ws: WebSocket, msg: Record<string, unknown>) {
    const name = String(msg.name || '').trim().slice(0, 20);
    if (!name) {
      send(ws, { type: 'error', message: 'Chybí jméno.' });
      return;
    }

    const duplicate = [...this.players.values()].some(
      (p) => p.ws !== ws && p.name.toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) {
      send(ws, { type: 'error', message: 'Toto jméno už je na serveru obsazené.' });
      return;
    }

    const attachment = getAttachment(ws);
    const existing = [...this.players.entries()].find(([, p]) => p.ws === ws);
    if (existing) {
      existing[1].name = name;
      setAttachment(ws, { ...attachment, playerId: existing[0] });
      this.sendWelcome(ws, existing[0]);
      this.broadcastLobby();
      return;
    }

    const id = `p_${Date.now()}_${randInt(1000, 9999)}`;
    this.players.set(id, {
      id,
      ws,
      name,
      snake: [],
      direction: { x: 1, y: 0 },
      nextDirection: { x: 1, y: 0 },
      score: 0,
      tacos: 0,
      alive: true,
      colorIndex: this.players.size % 8,
    });
    setAttachment(ws, { ...attachment, playerId: id });
    this.sendWelcome(ws, id);
    this.broadcastLobby();
  }

  private lobbySnapshot() {
    return {
      type: 'lobby',
      status: this.gameStatus,
      shareUrl: this.shareUrl,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        alive: p.alive,
        score: p.score,
      })),
    };
  }

  private sendWelcome(ws: WebSocket, id: string) {
    const snap = this.lobbySnapshot();
    send(ws, {
      type: 'welcome',
      id,
      status: snap.status,
      shareUrl: snap.shareUrl,
      players: snap.players,
    });
  }

  private broadcastLobby() {
    this.broadcast(this.lobbySnapshot());
  }

  private gameStatePayload() {
    return {
      type: 'state',
      kostky: this.kostky,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        snake: p.snake,
        score: p.score,
        tacos: p.tacos,
        alive: p.alive,
        colorIndex: p.colorIndex,
      })),
    };
  }

  private broadcastState() {
    this.broadcast(this.gameStatePayload());
  }

  private broadcast(msg: unknown) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) {
      try {
        p.ws.send(data);
      } catch {
        /* ignore */
      }
    }
  }

  private async startGame(requesterId: string): Promise<boolean> {
    if (this.gameStatus === 'playing') return false;
    if (this.players.size < 1) return false;

    this.gameStatus = 'playing';
    this.hueCounter = spawnKostky(this.players, this.kostky);
    this.lastKostkaSpawn = Date.now();

    let slotIndex = 0;
    for (const p of this.players.values()) {
      const slot = SPAWN_SLOTS[slotIndex % SPAWN_SLOTS.length];
      slotIndex += 1;
      p.alive = true;
      p.score = 0;
      p.tacos = 0;
      p.snake = makeSnake(slot);
      p.direction = { ...slot.dir };
      p.nextDirection = { ...slot.dir };
    }

    this.broadcast({ type: 'gameStart', startedBy: requesterId });
    this.broadcastState();
    await this.state.storage.setAlarm(Date.now() + SPEED_MS);
    return true;
  }

  async alarm() {
    if (this.gameStatus !== 'playing') return;

    const now = Date.now();
    if (now - this.lastKostkaSpawn >= KOSTKA_SPAWN_MS) {
      this.lastKostkaSpawn = now;
      this.hueCounter = spawnOneKostka(this.players, this.kostky, this.hueCounter);
    }

    const result = tickGame(this.players, this.kostky);
    if (result.ended) {
      await this.endMultiplayerGame(result.winnerId);
      return;
    }

    this.broadcastState();
    await this.state.storage.setAlarm(Date.now() + SPEED_MS);
  }

  private async endMultiplayerGame(winnerId: string | null = null) {
    await this.state.storage.deleteAlarm();
    this.gameStatus = 'lobby';
    this.broadcast({
      type: 'gameOver',
      winnerId,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        tacos: p.tacos,
        alive: p.alive,
      })),
    });
    for (const p of this.players.values()) {
      p.alive = true;
      p.score = 0;
      p.tacos = 0;
      p.snake = [];
    }
    this.kostky = [];
    this.broadcastLobby();
  }

  private async resetToLobby() {
    await this.state.storage.deleteAlarm();
    this.gameStatus = 'lobby';
    this.kostky = [];
    this.lastKostkaSpawn = 0;
    for (const p of this.players.values()) {
      p.alive = true;
      p.score = 0;
      p.tacos = 0;
      p.snake = [];
      p.direction = { x: 1, y: 0 };
      p.nextDirection = { x: 1, y: 0 };
    }
    this.broadcastLobby();
  }

  private async removePlayer(id: string) {
    if (!id || !this.players.has(id)) return;
    this.players.delete(id);
    if (this.gameStatus === 'playing' && this.players.size === 0) {
      await this.resetToLobby();
      return;
    }
    if (this.gameStatus === 'playing' && [...this.players.values()].filter((p) => p.alive).length <= 1) {
      const winner = [...this.players.values()].find((p) => p.alive);
      await this.endMultiplayerGame(winner ? winner.id : null);
    }
    this.broadcastLobby();
    if (this.gameStatus === 'playing') this.broadcastState();
  }
}
