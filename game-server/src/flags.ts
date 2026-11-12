// Wizox – hlídač hráčů: když se při běžném posílání dat (diamanty, dárky) objeví něco podezřelého,
// zapíše si to. Nic nehlídá pořád dokola, takže server nezpomaluje – jen jedno porovnání navíc.
// Owner si hlášení přečte v panelu ownera (/api/stats/bot).

export interface Flag {
  at: number;
  name: string;
  text: string;
}

const MAX_FLAGS = 100;

// Stejné hlášení o stejném hráči nejvýš jednou za hodinu (ať to nespamuje).
export async function addFlag(storage: DurableObjectStorage, kind: string, name: string, text: string): Promise<void> {
  const now = Date.now();
  const dedupeKey = `flagseen:${kind}:${name.toLowerCase()}`;
  const last = await storage.get<number>(dedupeKey);
  if (last && now - last < 60 * 60 * 1000) return;
  await storage.put(dedupeKey, now);
  await storage.put(`flag:${String(now).padStart(15, '0')}-${Math.random().toString(36).slice(2, 6)}`, { at: now, name, text } satisfies Flag);
}

export async function listFlags(storage: DurableObjectStorage): Promise<Flag[]> {
  const all = await storage.list<Flag>({ prefix: 'flag:' });
  const keys = [...all.keys()];
  // staré hlášení nad limit se smažou (jen při čtení, ne při hře)
  if (keys.length > MAX_FLAGS) await storage.delete(keys.slice(0, keys.length - MAX_FLAGS).slice(0, 128));
  return [...all.values()].slice(-MAX_FLAGS).reverse();
}
