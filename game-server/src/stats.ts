// Dočasné počítání hráčů: hra pošle jméno a náhodné ID zařízení, server si to 24 hodin pamatuje.
// Po 24 hodinách od prvního záznamu se nové záznamy už neukládají.

const WINDOW_MS = 24 * 60 * 60 * 1000;

interface Device {
  names: string[];
  first: number;
  last: number;
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
    if (start && now > start + WINDOW_MS) return json({ ok: false, ended: true });
    if (!start) await storage.put('stats:start', now);
    const key = `seen:${device}`;
    const entry = (await storage.get<Device>(key)) ?? { names: [], first: now, last: now };
    if (!entry.names.includes(name) && entry.names.length < 20) entry.names.push(name);
    entry.last = now;
    await storage.put(key, entry);
    return json({ ok: true });
  }

  if (action === 'report' && request.method === 'GET') {
    const devices = [...(await storage.list<Device>({ prefix: 'seen:' })).values()];
    const names = new Map<string, number>();
    for (const d of devices) for (const n of d.names) names.set(n, (names.get(n) ?? 0) + 1);
    return json({
      start: start ? new Date(start).toISOString() : null,
      end: start ? new Date(start + WINDOW_MS).toISOString() : null,
      devices: devices.length,
      differentNames: names.size,
      devicesWithMoreNames: devices.filter((d) => d.names.length > 1).map((d) => d.names),
      names: Object.fromEntries([...names].sort((a, b) => b[1] - a[1])),
    });
  }

  return json({ error: 'Neznámá akce.' }, 404);
}
