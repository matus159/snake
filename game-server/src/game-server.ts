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
import { isVulgarName } from './names';
import { handleProgressRequest } from './progress';
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

const ACC_SLOTS = ['hlava', 'oblicej', 'pusa', 'krk', 'stopa', 'jmeno'];

// Doplňky z klienta: jen známá místa a krátká id (co id znamená, ví hra u ostatních hráčů).
function cleanAcc(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      ([slot, id]) => ACC_SLOTS.includes(slot) && typeof id === 'string' && /^[a-z0-9]{1,20}$/.test(id),
    ),
  ) as Record<string, string>;
}

// Had (skin) z klienta: jen krátké id, jinak obyčejný had.
function cleanSkin(raw: unknown): string {
  return typeof raw === 'string' && /^[a-z0-9]{1,20}$/.test(raw) ? raw : 'default';
}

function newPlayer(id: string, ws: WebSocket, name: string, colorIndex: number, acc: Record<string, string> = {}, skin = 'default'): Player {
  return {
    acc,
    skin,
    id,
    ws,
    name,
    snake: [],
    direction: { x: 1, y: 0 },
    nextDirection: { x: 1, y: 0 },
    score: 0,
    tacos: 0,
    alive: true,
    colorIndex,
  };
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
    // Cloudflare server po chvíli bez zpráv uspí a zapomene, co měl v paměti. Připojení hráčů
    // (websockety) ale zůstanou – z nich se lobby obnoví. Bez toho se při delším čekání v lobby
    // (třeba než se sejdou tři a více hráčů) hráči „ztratili“ a hra nešla spustit.
    for (const ws of this.state.getWebSockets()) {
      const att = getAttachment(ws);
      if (!att.playerId || !att.name || this.players.has(att.playerId)) continue;
      this.players.set(att.playerId, newPlayer(att.playerId, ws, att.name, att.colorIndex ?? this.players.size % 8, cleanAcc(att.acc), cleanSkin(att.skin)));
    }
    this.state.blockConcurrencyWhile(async () => {
      // Dárky už ve hře nejsou: smaže starou frontu nedoručených dárků.
      await this.state.storage.delete('giftQueue');
      // Jednorázová úprava od majitele hry: hráč Majda má mít 500 💎 (místo 11079).
      if (!(await this.state.storage.get('fix:majda500'))) {
        const codes = await this.state.storage.list<{ name: string; progress: { diamanty: number } }>({ prefix: 'pcode:' });
        for (const [key, stored] of codes) {
          if (stored.name.trim().toLowerCase() !== 'majda') continue;
          stored.progress.diamanty = 500;
          await this.state.storage.put(key, stored);
        }
        await this.state.storage.put('fix:majda500', true);
      }
      // Žebříček a profil berou diamanty ze záznamů zařízení (seen:) – i tam 500.
      // Majda má mít jen základního hada (ostatní hady jí to vezme).
      if (!(await this.state.storage.get('fix:majda500b'))) {
        const codes = await this.state.storage.list<{ name: string; progress: { diamanty: number; wardrobe: string[]; equippedSkin: string } }>({ prefix: 'pcode:' });
        for (const [key, stored] of codes) {
          if (stored.name.trim().toLowerCase() !== 'majda') continue;
          stored.progress.diamanty = 500;
          stored.progress.wardrobe = [];
          stored.progress.equippedSkin = 'default';
          await this.state.storage.put(key, stored);
        }
        const devices = await this.state.storage.list<{ stats?: Record<string, { diamanty: number }> }>({ prefix: 'seen:' });
        for (const [key, d] of devices) {
          let changed = false;
          for (const [n, st] of Object.entries(d.stats ?? {})) {
            if (n.trim().toLowerCase() !== 'majda') continue;
            st.diamanty = 500;
            changed = true;
          }
          if (changed) await this.state.storage.put(key, d);
        }
        await this.state.storage.put('fix:majda500b', true);
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname.startsWith('/api/stats/')) {
      return handleStatsRequest(request, this.state.storage);
    }
    if (new URL(request.url).pathname.startsWith('/api/progress/')) {
      return handleProgressRequest(request, this.state.storage);
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
      if (this.gameStatus === 'playing') {
        send(ws, { type: 'error', message: 'Hra už běží – počkej, až skončí kolo.' });
        return;
      }
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

  async webSocketError(ws: WebSocket) {
    await this.webSocketClose(ws);
  }

  async webSocketClose(ws: WebSocket) {
    const attachment = getAttachment(ws);
    if (attachment.playerId) {
      await this.removePlayer(attachment.playerId);
    }
  }

  private async handleJoin(ws: WebSocket, msg: Record<string, unknown>) {
    const name = String(msg.name || '').trim().slice(0, 20);
    const acc = cleanAcc(msg.acc);
    const skin = cleanSkin(msg.skin);
    if (!name) {
      send(ws, { type: 'error', message: 'Chybí jméno.' });
      return;
    }
    if (isVulgarName(name)) {
      send(ws, { type: 'error', message: 'Tohle jméno obsahuje sprosté slovo. Vyber si jiné.' });
      return;
    }

    // Stejné jméno už na serveru je? Nejspíš je to ten samý hráč, kterému spadlo spojení
    // (zavřel hru, vypadl internet) a server si toho nevšiml – starý „duch“ se odpojí
    // a pustí se nové připojení.
    const ghosts = [...this.players.values()].filter(
      (p) => p.ws !== ws && p.name.toLowerCase() === name.toLowerCase(),
    );
    for (const ghost of ghosts) {
      try {
        setAttachment(ghost.ws, {});
        ghost.ws.close(4000, 'Připojil ses odjinud');
      } catch {
        // spojení už je stejně mrtvé
      }
      await this.removePlayer(ghost.id);
    }

    const existing = [...this.players.entries()].find(([, p]) => p.ws === ws);
    if (existing) {
      existing[1].name = name;
      existing[1].acc = acc;
      existing[1].skin = skin;
      setAttachment(ws, { playerId: existing[0], name, colorIndex: existing[1].colorIndex, acc, skin });
      this.sendWelcome(ws, existing[0]);
      this.broadcastLobby();
      return;
    }

    const id = `p_${Date.now()}_${randInt(1000, 9999)}`;
    const colorIndex = this.players.size % 8;
    const player = newPlayer(id, ws, name, colorIndex, acc, skin);
    // Kdo přijde, když kolo běží, počká na další kolo (dřív to shodilo celou hru).
    if (this.gameStatus === 'playing') player.alive = false;
    this.players.set(id, player);
    setAttachment(ws, { playerId: id, name, colorIndex, acc, skin });
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
        acc: p.acc,
        skin: p.skin,
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
    if (this.gameStatus === 'playing' && [...this.players.values()].filter((p) => p.alive && p.snake.length > 0).length <= 1) {
      const winner = [...this.players.values()].find((p) => p.alive && p.snake.length > 0);
      await this.endMultiplayerGame(winner ? winner.id : null);
    }
    this.broadcastLobby();
    if (this.gameStatus === 'playing') this.broadcastState();
  }
}
