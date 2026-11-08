export interface Env {
  GAME_SERVER: DurableObjectNamespace;
}

export interface Direction {
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Kostka {
  x: number;
  y: number;
  hue: number;
  taco?: boolean;
}

export interface Player {
  id: string;
  // boti (jen v testovací místnosti) nemají připojení
  ws: WebSocket | null;
  bot?: boolean;
  name: string;
  snake: Point[];
  direction: Direction;
  nextDirection: Direction;
  score: number;
  tacos: number;
  alive: boolean;
  colorIndex: number;
}

export interface WsAttachment {
  playerId?: string;
  // Jméno a barva hráče – aby se lobby dalo obnovit, když Cloudflare server uspí (hibernace).
  name?: string;
  colorIndex?: number;
  // hráč chce boty (adamini v testovací místnosti)
  bots?: boolean;
}
