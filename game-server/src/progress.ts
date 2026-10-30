// Postup hráče (diamanty, hadi) uložený na serveru podle jména, aby byl stejný na všech zařízeních.
// Klíč `progress:<jméno malými písmeny>`. Jméno nemá heslo – kdo zadá stejné jméno, hraje za stejného hráče.

export interface Progress {
  diamanty: number;
  wardrobe: string[];
  equippedSkin: string;
  weekendWheelSpinDate: string | null;
}

interface StatsDevice {
  stats?: Record<string, { diamanty: number }>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function count(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100_000_000) : 0;
}

function cleanProgress(raw: unknown): Progress {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const wardrobe = Array.isArray(p.wardrobe)
    ? [...new Set(p.wardrobe.filter((s): s is string => typeof s === 'string' && s.length <= 20))].slice(0, 30)
    : [];
  return {
    diamanty: count(p.diamanty),
    wardrobe,
    equippedSkin: typeof p.equippedSkin === 'string' && p.equippedSkin.length <= 20 ? p.equippedSkin : 'default',
    weekendWheelSpinDate:
      typeof p.weekendWheelSpinDate === 'string' && p.weekendWheelSpinDate.length <= 30 ? p.weekendWheelSpinDate : null,
  };
}

// Nejvíc diamantů, které hráč s tímhle jménem nahlásil z jakéhokoli zařízení (z počítání hráčů).
async function statsMaxDiamanty(storage: DurableObjectStorage, key: string): Promise<number> {
  let max = 0;
  for (const d of (await storage.list<StatsDevice>({ prefix: 'seen:' })).values()) {
    for (const [n, s] of Object.entries(d.stats ?? {})) {
      if (n.toLowerCase() === key) max = Math.max(max, s.diamanty);
    }
  }
  return max;
}

export async function handleProgressRequest(request: Request, storage: DurableObjectStorage): Promise<Response> {
  const url = new URL(request.url);
  const action = url.pathname.replace('/api/progress/', '');

  if (action === 'get' && request.method === 'GET') {
    const name = (url.searchParams.get('name') ?? '').trim().toLowerCase().slice(0, 20);
    if (!name) return json({ error: 'Chybí jméno.' }, 400);
    return json({ progress: (await storage.get<Progress>(`progress:${name}`)) ?? null });
  }

  if (action === 'save' && request.method === 'POST') {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Neplatná data.' }, 400);
    }
    const name = String(body.name ?? '').trim().toLowerCase().slice(0, 20);
    if (!name) return json({ error: 'Chybí jméno.' }, 400);
    const key = `progress:${name}`;
    const incoming = cleanProgress(body.progress);
    const existing = await storage.get<Progress>(key);
    let saved: Progress;
    if (body.merge === true) {
      // První spojení zařízení: nic se neztratí – víc diamantů vyhraje a hadi se sečtou.
      const base = existing ?? { ...incoming, diamanty: await statsMaxDiamanty(storage, name) };
      saved = {
        diamanty: Math.max(base.diamanty, incoming.diamanty),
        wardrobe: [...new Set([...base.wardrobe, ...incoming.wardrobe])].slice(0, 30),
        equippedSkin: incoming.equippedSkin !== 'default' ? incoming.equippedSkin : base.equippedSkin,
        weekendWheelSpinDate:
          [base.weekendWheelSpinDate, incoming.weekendWheelSpinDate].filter(Boolean).sort().pop() ?? null,
      };
    } else {
      saved = incoming;
    }
    await storage.put(key, saved);
    return json({ progress: saved });
  }

  return json({ error: 'Neznámá akce.' }, 404);
}
