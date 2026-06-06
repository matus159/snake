import { GameServer } from './game-server';
import type { Env } from './types';

export { GameServer };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const id = env.GAME_SERVER.idFromName('global');
    return env.GAME_SERVER.get(id).fetch(request);
  },
};
