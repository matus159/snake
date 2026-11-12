import { addFlag } from './flags';
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

  if (action === 'name' && request.method === 'GET') {
    // Má už tohle jméno někdo jiný (nějaký přenosový kód)?
    const name = (url.searchParams.get('name') ?? '').trim().toLowerCase().slice(0, 20);
    if (!name) return json({ taken: false });
    for (const stored of (await storage.list<Stored>({ prefix: 'pcode:' })).values()) {
      if (stored.name.toLowerCase() === name) return json({ taken: true });
    }
    return json({ taken: false });
  }

  if (action === 'suggest' && request.method === 'GET') {
    // Dárek: při psaní jména nabídnout nejbližší jméno hráče (jako našeptávač ve vyhledávání).
    const q = (url.searchParams.get('q') ?? '').trim().slice(0, 20);
    const from = (url.searchParams.get('from') ?? '').trim().toLowerCase();
    if (!q) return json({ suggestion: null });
    const names = (await allPlayerNames(storage)).filter((n) => n.toLowerCase() !== from);
    return json({ suggestion: suggestName(q, names) });
  }

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

  if (action === 'gift') {
    // Dárek: hráč pošle jinému hráči diamanty. Uloží se tu a příjemce si je vyzvedne, až se připojí.
    const from = String(body.from ?? '').trim().slice(0, 20);
    const to = String(body.to ?? '').trim().slice(0, 20);
    const amount = count(body.amount);
    if (!from || !to) return json({ error: 'Chybí jméno.' }, 400);
    if (amount < 1) return json({ error: 'Zadej počet diamantů.' }, 400);
    if (from.toLowerCase() === to.toLowerCase()) return json({ error: 'Sám sobě dárek poslat nemůžeš.' }, 400);
    const names = await allPlayerNames(storage);
    if (!names.some((n) => n.toLowerCase() === to.toLowerCase())) {
      // Překlep? Doporučit nejbližší existující jméno.
      const suggestion = closestName(to, names.filter((n) => n.toLowerCase() !== from.toLowerCase()));
      return json({ error: 'Hráč s tímhle jménem neexistuje.', suggestion }, 404);
    }
    const id = `${Date.now()}-${newCode()}`;
    await storage.put(`${giftPrefix(to)}${id}`, { from, amount, at: Date.now() } satisfies Gift);
    // Hlídač: velký dárek si zapíše
    if (amount >= 500 && !from.toLowerCase().includes('owner')) {
      await addFlag(storage, `gift-${to.toLowerCase()}`, from, `Poslal velký dárek: ${amount} diamantů hráči ${to}.`);
    }
    return json({ ok: true });
  }

  if (action === 'claim') {
    // Příjemce si vyzvedne čekající dárky. Nová hra (v: 2) dárek nesmaže hned – jen ho označí jako
    // přičtený a smaže ho až po „seen“, když hráč zprávu opravdu viděl. Když zprávu nestihne vidět,
    // ukáže se mu znovu (diamanty už se ale znovu nepřičtou). Stará hra (bez v) dárky rovnou maže.
    const name = String(body.name ?? '').trim().slice(0, 20);
    if (!name) return json({ gifts: [] });
    const twoStep = body.v === 2;
    const pending = await storage.list<Gift>({ prefix: giftPrefix(name), limit: 100 });
    if (pending.size === 0) return json({ gifts: [] });
    const gifts: { id: string; from: string; amount: number; alreadyAdded: boolean }[] = [];
    let total = 0;
    for (const [key, g] of pending) {
      gifts.push({ id: key.slice(giftPrefix(name).length), from: g.from, amount: g.amount, alreadyAdded: !!g.claimed });
      if (!g.claimed) total += g.amount;
    }
    if (twoStep) {
      const fresh: Record<string, Gift> = {};
      for (const [key, g] of pending) if (!g.claimed) fresh[key] = { ...g, claimed: true };
      if (Object.keys(fresh).length) await storage.put(fresh);
    } else {
      await storage.delete([...pending.keys()]);
    }
    // Diamanty rovnou přičíst i do postupu na serveru (přenosový kód), ať se neztratí.
    if (total > 0) {
      for (const [key, stored] of await storage.list<Stored>({ prefix: 'pcode:' })) {
        if (stored.name.toLowerCase() !== name.toLowerCase()) continue;
        stored.progress.diamanty = count(stored.progress.diamanty + total);
        await storage.put(key, stored);
      }
    }
    if (!twoStep) return json({ gifts: gifts.filter((g) => !g.alreadyAdded).map(({ from, amount }) => ({ from, amount })) });
    return json({ gifts });
  }

  if (action === 'seen') {
    // Hráč zprávu o dárku viděl – teď se dárek smaže.
    const name = String(body.name ?? '').trim().slice(0, 20);
    const ids = Array.isArray(body.ids) ? body.ids.filter((i): i is string => typeof i === 'string' && i.length <= 40).slice(0, 100) : [];
    if (!name || !ids.length) return json({ ok: true });
    const keys = ids.map((i) => `${giftPrefix(name)}${i}`);
    const found = await storage.get<Gift>(keys);
    const done = [...found].filter(([, g]) => g.claimed).map(([k]) => k);
    if (done.length) await storage.delete(done);
    return json({ ok: true });
  }

  return json({ error: 'Neznámá akce.' }, 404);
}

interface Gift {
  from: string;
  amount: number;
  at: number;
  // už přičtený příjemci, čeká se jen, až uvidí zprávu
  claimed?: boolean;
}

function giftPrefix(name: string): string {
  return `gift:${encodeURIComponent(name.toLowerCase())}:`;
}

// Všichni hráči: mají přenosový kód nebo už někdy zapnuli hru (počítání hráčů).
async function allPlayerNames(storage: DurableObjectStorage): Promise<string[]> {
  const names = new Map<string, string>();
  for (const stored of (await storage.list<Stored>({ prefix: 'pcode:' })).values()) {
    names.set(stored.name.toLowerCase(), stored.name);
  }
  for (const device of (await storage.list<{ names?: string[] }>({ prefix: 'seen:' })).values()) {
    for (const n of device.names ?? []) if (!names.has(n.toLowerCase())) names.set(n.toLowerCase(), n);
  }
  return [...names.values()];
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

// Při psaní: nejdřív jméno, které tak začíná (nejkratší), jinak nejpodobnější.
function suggestName(typed: string, names: string[]): string | null {
  const t = normName(typed);
  const starts = names.filter((n) => normName(n).startsWith(t)).sort((a, b) => a.length - b.length || a.localeCompare(b));
  return starts[0] ?? closestName(typed, names);
}

function normName(n: string): string {
  return n.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Nejpodobnější jméno (bez ohledu na velká písmena a háčky); moc odlišná jména se nedoporučí.
function closestName(typed: string, names: string[]): string | null {
  const norm = normName;
  const t = norm(typed);
  let best: string | null = null;
  let bestScore = Infinity;
  for (const name of names) {
    const n = norm(name);
    let d = editDistance(t, n);
    // začátek jména sedí (napsal jen kus) – taky dobrý tip
    if (t.length >= 3 && n.startsWith(t)) d = Math.min(d, 1);
    if (d < bestScore) {
      bestScore = d;
      best = name;
    }
  }
  const limit = Math.max(2, Math.ceil(t.length / 2));
  return best !== null && bestScore <= limit ? best : null;
}
