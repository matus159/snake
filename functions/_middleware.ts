interface Env {
  GAME_SERVER: DurableObjectNamespace;
  ASSETS: Fetcher;
}

// Logo hry: každý rok od 10. listopadu do konce Vánoc (26. prosince, český čas) je to had
// s Mikulášskou čepicí a bradou (soubory v /mikulas/), jindy obyčejný duhový had.
const ICONS = ['/icon.svg', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png', '/favicon-32.png', '/apple-touch-icon.png'];

function isChristmasSeason(now = new Date()): boolean {
  const [month, day] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague', month: '2-digit', day: '2-digit' })
    .format(now)
    .split('-')
    .map(Number);
  return (month === 11 && day >= 10) || (month === 12 && day <= 26);
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const path = url.pathname;
  const isApi = path.startsWith('/api/stats/') || path.startsWith('/api/progress/');
  if (isApi || context.request.headers.get('Upgrade') === 'websocket') {
    const id = context.env.GAME_SERVER.idFromName('global');
    return context.env.GAME_SERVER.get(id).fetch(context.request);
  }
  if (ICONS.includes(path)) {
    const res = isChristmasSeason()
      ? await context.env.ASSETS.fetch(new Request(new URL('/mikulas' + path, url), context.request))
      : await context.next();
    // krátké cachování, ať se logo po Vánocích (a 10. listopadu) samo přepne
    const out = new Response(res.body, res);
    out.headers.set('Cache-Control', 'public, max-age=3600');
    return out;
  }
  return context.next();
};
