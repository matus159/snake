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
}

export interface WsAttachment {
  playerId?: string;
}
