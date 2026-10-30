// Postup hráče (diamanty, hadi) uložený na serveru pod tajným přenosovým kódem.
// Kód si hráč zobrazí na jednom zařízení a zadá na druhém – pak má na obou stejný postup.
// Klíč `pcode:<KÓD>`.

export interface Progress {
  diamanty: number;
  wardrobe: string[];
  equippedSkin: string;
  weekendWheelSpinDate: string | null;
}

interface Stored {
  name: string;
  progress: Progress;
}

// Bez znaků, které se pletou (0/O, 1/I/L).
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

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

function cleanCode(raw: unknown): string {
  return String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export async function handleProgressRequest(request: Request, storage: DurableObjectStorage): Promise<Response> {
  const url = new URL(request.url);
  const action = url.pathname.replace('/api/progress/', '');

  if (action === 'get' && request.method === 'GET') {
    const code = cleanCode(url.searchParams.get('code'));
    const stored = code.length === CODE_LENGTH ? await storage.get<Stored>(`pcode:${code}`) : undefined;
    if (!stored) return json({ error: 'Tenhle kód neexistuje.' }, 404);
    return json(stored);
  }

  if (request.method !== 'POST') return json({ error: 'Neznámá akce.' }, 404);
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Neplatná data.' }, 400);
  }

  if (action === 'create') {
    const name = String(body.name ?? '').trim().slice(0, 20);
    if (!name) return json({ error: 'Chybí jméno.' }, 400);
    let code = newCode();
    while (await storage.get(`pcode:${code}`)) code = newCode();
    const stored: Stored = { name, progress: cleanProgress(body.progress) };
    await storage.put(`pcode:${code}`, stored);
    return json({ code, ...stored });
  }

  if (action === 'save') {
    const code = cleanCode(body.code);
    const key = `pcode:${code}`;
    const stored = code.length === CODE_LENGTH ? await storage.get<Stored>(key) : undefined;
    if (!stored) return json({ error: 'Tenhle kód neexistuje.' }, 404);
    stored.progress = cleanProgress(body.progress);
    await storage.put(key, stored);
    return json(stored);
  }

  return json({ error: 'Neznámá akce.' }, 404);
}
