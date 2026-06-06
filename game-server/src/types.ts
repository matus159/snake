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
}

export interface Gift {
  from: string;
  type: string;
  value: string | number;
  at: number;
}

export interface Player {
  id: string;
  ws: WebSocket;
  name: string;
  snake: Point[];
  direction: Direction;
  nextDirection: Direction;
  score: number;
  alive: boolean;
  colorIndex: number;
}

export interface WsAttachment {
  playerId?: string;
  giftWatchName?: string | null;
}

export type GiftQueueData = Record<string, Gift[]>;
