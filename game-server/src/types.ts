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
  ws: WebSocket;
  name: string;
  snake: Point[];
  direction: Direction;
  nextDirection: Direction;
  score: number;
  tacos: number;
  alive: boolean;
  colorIndex: number;
  // nasazené doplňky (hlava, obličej, pusa, krk, stopa, jméno) – ostatní je vidí na hadovi
  acc: Record<string, string>;
  // nasazený had (barva/skin) – ostatní ho vidí ve hře
  skin: string;
}

export interface WsAttachment {
  playerId?: string;
  // Jméno a barva hráče – aby se lobby dalo obnovit, když Cloudflare server uspí (hibernace).
  name?: string;
  colorIndex?: number;
  acc?: Record<string, string>;
  skin?: string;
}
