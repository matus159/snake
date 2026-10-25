// Účty hráčů: jméno + heslo a uložený postup (diamanty, gems, hadi).
// Ukládá se do úložiště Durable Objectu pod klíčem `account:<jméno malými písmeny>`.
// Pozor: heslo je uložené tak, aby ho šlo ukázat v „Zapomněl jsem heslo“.

export interface AccountProfile {
  diamanty: number;
  gems: number;
  wardrobe: string[];
  equippedSkin: string;
  weekendWheelSpinDate: string | null;
}

interface Account {
  name: string;
  password: string;
  profile: AccountProfile;
  createdAt: number;
}

const NAME_MIN = 2;
const NAME_MAX = 20;
const PASSWORD_MIN = 3;
const PASSWORD_MAX = 40;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function emptyProfile(): AccountProfile {
  return { diamanty: 0, gems: 0, wardrobe: [], equippedSkin: 'default', weekendWheelSpinDate: null };
}

function cleanCount(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10_000_000) : 0;
}

function cleanProfile(raw: unknown): AccountProfile {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const wardrobe = Array.isArray(p.wardrobe)
    ? [...new Set(p.wardrobe.filter((s): s is string => typeof s === 'string' && s.length <= 20))].slice(0, 30)
    : [];
  return {
    diamanty: cleanCount(p.diamanty),
    gems: cleanCount(p.gems),
    wardrobe,
    equippedSkin: typeof p.equippedSkin === 'string' && p.equippedSkin.length <= 20 ? p.equippedSkin : 'default',
    weekendWheelSpinDate:
      typeof p.weekendWheelSpinDate === 'string' && p.weekendWheelSpinDate.length <= 30 ? p.weekendWheelSpinDate : null,
  };
}

function accountKey(name: string): string {
  return `account:${name.toLowerCase()}`;
}

export async function handleAccountRequest(request: Request, storage: DurableObjectStorage): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Použij POST.' }, 405);
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Neplatná data.' }, 400);
  }
  const action = new URL(request.url).pathname.replace('/api/account/', '');
  const name = String(body.name ?? '').trim();
  const password = String(body.password ?? '');

  if (name.length < NAME_MIN || name.length > NAME_MAX) {
    return json({ error: `Jméno musí mít ${NAME_MIN}–${NAME_MAX} znaků.` }, 400);
  }
  const key = accountKey(name);
  const account = await storage.get<Account>(key);

  if (action === 'forgot') {
    if (!account) return json({ error: 'Hráč s tímhle jménem neexistuje.' }, 404);
    return json({ name: account.name, password: account.password });
  }

  if (action === 'register') {
    if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      return json({ error: `Heslo musí mít ${PASSWORD_MIN}–${PASSWORD_MAX} znaků.` }, 400);
    }
    if (account) return json({ error: 'Tohle jméno už má jiný hráč. Vyber jiné nebo se přihlas.' }, 409);
    const created: Account = {
      name,
      password,
      // postup z tohohle prohlížeče (staré hraní bez účtu) se převede do nového účtu
      profile: body.profile ? cleanProfile(body.profile) : emptyProfile(),
      createdAt: Date.now(),
    };
    await storage.put(key, created);
    return json({ name: created.name, profile: created.profile });
  }

  if (!account || account.password !== password) {
    return json({ error: 'Špatné jméno nebo heslo.' }, 401);
  }

  if (action === 'login') {
    return json({ name: account.name, profile: account.profile });
  }

  if (action === 'save') {
    account.profile = cleanProfile(body.profile);
    await storage.put(key, account);
    return json({ ok: true });
  }

  return json({ error: 'Neznámá akce.' }, 404);
}
