interface Env {
  GAME_SERVER: DurableObjectNamespace;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const path = new URL(context.request.url).pathname;
  const isApi = path.startsWith('/api/stats/') || path.startsWith('/api/progress/');
  if (isApi || context.request.headers.get('Upgrade') === 'websocket') {
    const id = context.env.GAME_SERVER.idFromName('global');
    return context.env.GAME_SERVER.get(id).fetch(context.request);
  }
  return context.next();
};
