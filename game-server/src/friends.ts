// Kamarádi: každý hráč má veřejný kamarádský kód (např. K-7P2QX), který řekne kamarádovi osobně.
// Kamarád ho zadá → přijde mu žádost → kamarádi jsou, až když oba souhlasí. Bez chatu – jen
// pozvánka do hry a pár předem daných reakcí. Kdo jsi, se ověřuje tajným přenosovým kódem
// (pcode:<KÓD>), takže za někoho jiného jednat nejde.

interface StoredProgress {
  name: string;
  progress: { diamanty: number };
}

interface FriendData {
  name: string;
  friends: string[]; // jména malými písmeny
  requests: { from: string; at: number }[];
  blocked: string[];
  invites: { from: string; at: number }[];
  reacts: { from: string; emoji: string; at: number }[];
  online: number;
}

interface Device {
  stats?: Record<string, { diamanty: number; at?: number }>;
}

const MAX_FRIENDS = 30;
const MAX_REQUESTS = 20;
const ONLINE_MS = 50 * 1000;
const INVITE_MS = 3 * 60 * 1000;
export const FRIEND_REACTIONS = ['👍', '😂', '🔥', 'GG', '😮', '❤️', '😎', '👋', '👏', '🎉', '😢', '🤯', '🐍', '💎', '🧟', '🏆'];
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const low = (n: string) => n.trim().toLowerCase();
const dataKey = (lower: string) => `friends:${lower}`;

function emptyData(name: string): FriendData {
  return { name, friends: [], requests: [], blocked: [], invites: [], reacts: [], online: 0 };
}

async function loadData(storage: DurableObjectStorage, name: string): Promise<FriendData> {
  const d = await storage.get<FriendData>(dataKey(low(name)));
  return d ? { ...emptyData(name), ...d } : emptyData(name);
}

async function saveData(storage: DurableObjectStorage, d: FriendData): Promise<void> {
  await storage.put(dataKey(low(d.name)), d);
}

function cleanFriendCode(raw: unknown): string {
  return String(raw ?? '').toUpperCase().replace(/^K-?/, '').replace(/[^A-Z0-9]/g, '').slice(0, 5);
}

async function friendCodeOf(storage: DurableObjectStorage, lower: string): Promise<string> {
  const existing = await storage.get<string>(`fcodeof:${lower}`);
  if (existing) return existing;
  let code = '';
  do {
    const bytes = crypto.getRandomValues(new Uint8Array(5));
    code = [...bytes].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
  } while (await storage.get(`fcode:${code}`));
  await storage.put(`fcode:${code}`, lower);
  await storage.put(`fcodeof:${lower}`, code);
  return code;
}

// Diamanty hráčů (jako žebříček: nejvíc ze všech zařízení).
async function diamondsByName(storage: DurableObjectStorage): Promise<Map<string, number>> {
  const best = new Map<string, number>();
  for (const d of (await storage.list<Device>({ prefix: 'seen:' })).values()) {
    for (const [n, s] of Object.entries(d.stats ?? {})) {
      const k = n.toLowerCase();
      best.set(k, Math.max(best.get(k) ?? 0, s.diamanty ?? 0));
    }
  }
  return best;
}

export async function handleFriendsRequest(action: string, request: Request, storage: DurableObjectStorage): Promise<Response> {
  if (request.method !== 'POST') return json({ error: 'Neznámá akce.' }, 404);
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Neplatná data.' }, 400);
  }
  // kdo jsem: tajný přenosový kód
  const pcode = String(body.code ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const stored = pcode.length === 6 ? await storage.get<StoredProgress>(`pcode:${pcode}`) : undefined;
  if (!stored) return json({ error: 'Nejdřív musíš být připojený k serveru.' }, 403);
  const meLower = low(stored.name);
  const me = await loadData(storage, stored.name);
  me.name = stored.name;
  const now = Date.now();

  // jméno kamaráda z požadavku (musí to být můj kamarád nebo žadatel)
  const target = low(String(body.name ?? '').slice(0, 20));

  if (action === 'me') {
    me.online = now;
    const friendCode = await friendCodeOf(storage, meLower);
    const dia = await diamondsByName(storage);
    const friends = [];
    for (const f of me.friends) {
      const fd = await loadData(storage, f);
      friends.push({ name: fd.name || f, online: now - fd.online < ONLINE_MS, diamanty: dia.get(f) ?? 0 });
    }
    const requests = [];
    for (const r of me.requests) requests.push({ name: (await loadData(storage, r.from)).name || r.from });
    // jen od těch, kdo jsou pořád moji kamarádi
    const invites = [];
    for (const i of me.invites.filter((x) => now - x.at < INVITE_MS && me.friends.includes(x.from))) {
      invites.push({ name: (await loadData(storage, i.from)).name || i.from });
    }
    const reacts = [];
    for (const r of me.reacts.filter((x) => me.friends.includes(x.from))) reacts.push({ name: (await loadData(storage, r.from)).name || r.from, emoji: r.emoji });
    // pozvánky a reakce se doručí jen jednou
    me.invites = [];
    me.reacts = [];
    await saveData(storage, me);
    return json({ friendCode: `K-${friendCode}`, me: { name: me.name, diamanty: dia.get(meLower) ?? 0 }, friends, requests, invites, reacts });
  }

  if (action === 'offline') {
    // hráč zavřel nebo schoval hru – hned offline (nečekat, až vyprší čas)
    me.online = 0;
    await saveData(storage, me);
    return json({ ok: true });
  }

  if (action === 'add') {
    const fc = cleanFriendCode(body.friendCode);
    const otherLower = fc.length === 5 ? await storage.get<string>(`fcode:${fc}`) : undefined;
    if (!otherLower) return json({ error: 'Tenhle kamarádský kód neexistuje.' }, 404);
    if (otherLower === meLower) return json({ error: 'To je tvůj vlastní kód 🙂' }, 400);
    // z profilu hráče: kód musí patřit tomu, na jehož profilu jsi
    const expect = low(String(body.expectName ?? '').slice(0, 20));
    if (expect && expect !== otherLower) return json({ error: 'Tenhle kód patří jinému hráči.' }, 400);
    if (me.friends.includes(otherLower)) return json({ ok: true, message: 'Už jste kamarádi.' });
    const other = await loadData(storage, otherLower);
    // on už mi žádost poslal → rovnou kamarádi
    if (me.requests.some((r) => r.from === otherLower)) {
      if (me.friends.length >= MAX_FRIENDS || other.friends.length >= MAX_FRIENDS) return json({ error: 'Moc kamarádů (nejvíc 30).' }, 400);
      me.requests = me.requests.filter((r) => r.from !== otherLower);
      me.friends.push(otherLower);
      if (!other.friends.includes(meLower)) other.friends.push(meLower);
      await saveData(storage, me);
      await saveData(storage, other);
      return json({ ok: true, message: `Ty a ${other.name} jste teď kamarádi!` });
    }
    if (me.friends.length >= MAX_FRIENDS) return json({ error: 'Moc kamarádů (nejvíc 30).' }, 400);
    // zablokovaný: tváří se, že žádost odešla (ať neví, že je zablokovaný)
    if (!other.blocked.includes(meLower) && !other.requests.some((r) => r.from === meLower)) {
      other.requests.push({ from: meLower, at: now });
      other.requests = other.requests.slice(-MAX_REQUESTS);
      await saveData(storage, other);
    }
    await saveData(storage, me);
    return json({ ok: true, message: `Žádost poslána hráči ${other.name}. Až ji přijme, budete kamarádi.` });
  }

  if (action === 'answer') {
    if (!me.requests.some((r) => r.from === target)) return json({ error: 'Žádost už neplatí.' }, 404);
    me.requests = me.requests.filter((r) => r.from !== target);
    if (body.accept === true) {
      const other = await loadData(storage, target);
      if (me.friends.length >= MAX_FRIENDS || other.friends.length >= MAX_FRIENDS) {
        await saveData(storage, me);
        return json({ error: 'Moc kamarádů (nejvíc 30).' }, 400);
      }
      if (!me.friends.includes(target)) me.friends.push(target);
      if (!other.friends.includes(meLower)) other.friends.push(meLower);
      other.requests = other.requests.filter((r) => r.from !== meLower);
      await saveData(storage, other);
    }
    await saveData(storage, me);
    return json({ ok: true });
  }

  if ((action === 'remove' || action === 'block') && !target) return json({ error: 'Chybí jméno.' }, 400);
  if (action === 'remove' || action === 'block') {
    const other = await loadData(storage, target);
    me.friends = me.friends.filter((f) => f !== target);
    me.requests = me.requests.filter((r) => r.from !== target);
    me.invites = me.invites.filter((r) => r.from !== target);
    other.friends = other.friends.filter((f) => f !== meLower);
    other.requests = other.requests.filter((r) => r.from !== meLower);
    if (action === 'block' && target && !me.blocked.includes(target)) me.blocked.push(target);
    await saveData(storage, me);
    await saveData(storage, other);
    return json({ ok: true });
  }

  if (action === 'invite' || action === 'react') {
    if (!me.friends.includes(target)) return json({ error: 'To není tvůj kamarád.' }, 400);
    const other = await loadData(storage, target);
    if (action === 'invite') {
      other.invites = other.invites.filter((i) => i.from !== meLower && now - i.at < INVITE_MS);
      other.invites.push({ from: meLower, at: now });
    } else {
      const emoji = String(body.emoji ?? '');
      if (!FRIEND_REACTIONS.includes(emoji)) return json({ error: 'Neznámá reakce.' }, 400);
      other.reacts = [...other.reacts, { from: meLower, emoji, at: now }].slice(-10);
    }
    await saveData(storage, other);
    return json({ ok: true });
  }

  return json({ error: 'Neznámá akce.' }, 404);
}
