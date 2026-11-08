interface Env {
  GAME_SERVER: DurableObjectNamespace;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const path = new URL(context.request.url).pathname;
  const isApi = path.startsWith('/api/stats/') || path.startsWith('/api/progress/');
  if (isApi) {
    const id = context.env.GAME_SERVER.idFromName('global');
    return context.env.GAME_SERVER.get(id).fetch(context.request);
  }
  if (context.request.headers.get('Upgrade') === 'websocket') {
    // Hra pro více hráčů na testovací adrese má vlastní místnost (tam můžou být boti),
    // hráči z hlavního webu se s ní nikdy nepotkají.
    const testRoom = new URL(context.request.url).hostname.startsWith('test.');
    const id = context.env.GAME_SERVER.idFromName(testRoom ? 'test-room' : 'global');
    const request = new Request(context.request);
    request.headers.set('X-Snake-Room', testRoom ? 'test' : 'global');
    return context.env.GAME_SERVER.get(id).fetch(request);
  }
  return context.next();
};
