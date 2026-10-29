// Počítání hráčů: hra pošle jméno, náhodné ID zařízení, diamanty a nejlepší skóre a server si to pamatuje
// natrvalo (původně jen 24 hodin, pak 48 hodin; teď bez konce).

// Hráči, u kterých si server pamatuje, kdy naposledy zapnuli hru.
// adamini owner pak vedle hrací plochy uvidí, že si hráč zapnul hru.
const WATCHED_NAMES = ['robine'];

interface NameStats {
  diamanty: number;
  bestScore: number;
}

interface Device {
  names: string[];
  first: number;
  last: number;
  stats?: Record<string, NameStats>;
}

function count(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100_000_000) : 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function handleStatsRequest(request: Request, storage: DurableObjectStorage): Promise<Response> {
  const action = new URL(request.url).pathname.replace('/api/stats/', '');
  const start = await storage.get<number>('stats:start');

  if (action === 'seen' && request.method === 'POST') {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Neplatná data.' }, 400);
    }
    const name = String(body.name ?? '').trim().slice(0, 20);
    const device = String(body.device ?? '').slice(0, 40);
    if (!name || !/^[a-z0-9-]{8,40}$/i.test(device)) return json({ ok: false }, 400);
    const now = Date.now();
    if (body.open === true && WATCHED_NAMES.includes(name.toLowerCase())) {
      await storage.put(`opened:${name.toLowerCase()}`, now);
    }
    if (!start) await storage.put('stats:start', now);
    const key = `seen:${device}`;
    const entry = (await storage.get<Device>(key)) ?? { names: [], first: now, last: now };
    if (!entry.names.includes(name) && entry.names.length < 20) entry.names.push(name);
    entry.last = now;
    if (entry.names.includes(name)) {
      entry.stats ??= {};
      const prev = entry.stats[name];
      entry.stats[name] = {
        diamanty: count(body.diamanty),
        bestScore: Math.max(prev?.bestScore ?? 0, count(body.bestScore)),
      };
    }
    await storage.put(key, entry);
    return json({ ok: true });
  }

  if (action === 'opened' && request.method === 'GET') {
    const name = (new URL(request.url).searchParams.get('name') ?? '').toLowerCase();
    if (!WATCHED_NAMES.includes(name)) return json({ at: null });
    return json({ at: (await storage.get<number>(`opened:${name}`)) ?? null });
  }

  if (action === 'leaderboard' && request.method === 'GET') {
    // Žebříček podle diamantů: všichni hráči kromě ownerů a kromě těch, u kterých server diamanty nezná.
    const best = new Map<string, number>();
    for (const d of (await storage.list<Device>({ prefix: 'seen:' })).values()) {
      for (const [n, s] of Object.entries(d.stats ?? {})) {
        if (n.toLowerCase().includes('owner')) continue;
        best.set(n, Math.max(best.get(n) ?? 0, s.diamanty));
      }
    }
    const players = [...best]
      .sort((a, b) => b[1] - a[1])
      .map(([name, diamanty]) => ({ name, diamanty }));
    return json({ players });
  }

  if (action === 'report' && request.method === 'GET') {
    const devices = [...(await storage.list<Device>({ prefix: 'seen:' })).values()];
    const names = new Map<string, { devices: number; diamanty: number | null; bestScore: number | null }>();
    for (const d of devices) {
      for (const n of d.names) {
        const row = names.get(n) ?? { devices: 0, diamanty: null, bestScore: null };
        row.devices += 1;
        const s = d.stats?.[n];
        if (s) {
          row.diamanty = Math.max(row.diamanty ?? 0, s.diamanty);
          row.bestScore = Math.max(row.bestScore ?? 0, s.bestScore);
        }
        names.set(n, row);
      }
    }
    return json({
      start: start ? new Date(start).toISOString() : null,
      devices: devices.length,
      differentNames: names.size,
      devicesWithMoreNames: devices.filter((d) => d.names.length > 1).map((d) => d.names),
      names: Object.fromEntries([...names].sort((a, b) => (b[1].diamanty ?? -1) - (a[1].diamanty ?? -1))),
    });
  }

  return json({ error: 'Neznámá akce.' }, 404);
}
