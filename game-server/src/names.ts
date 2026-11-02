// Kontrola sprostých slov ve jménech hráčů. Musí sedět s VULGAR_WORDS v index.html.

export const VULGAR_WORDS = [
  // česky
  'kurv', 'kurev', 'pica', 'pice', 'pico', 'picu', 'picus', 'kokot', 'zmrd', 'mrdat', 'mrdka', 'mrdk',
  'hovno', 'hovna', 'prdel', 'curak', 'kunda', 'sukat', 'jebat', 'jebe', 'jebn', 'jebl', 'vyjeb',
  'buzna', 'buzerant', 'teplous', 'negr', 'sracka', 'sracky', 'chcip', 'debil', 'kreten', 'retard',
  'blbec', 'idiot', 'prcat', 'penis', 'vagin', 'kozy',
  // anglicky
  'fuck', 'shit', 'bitch', 'cunt', 'dick', 'cock', 'pussy', 'asshole', 'bastard', 'whore', 'slut',
  'porn', 'nigga', 'nigger', 'nazi', 'hitler', 'sex',
];

// Malá písmena, bez háčků a čárek, čísla jako písmena (k0k0t → kokot), jen písmena.
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/0/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/7/g, 't')
    .replace(/[^a-z]/g, '');
}

export function isVulgarName(name: string): boolean {
  const n = normalizeName(name);
  return VULGAR_WORDS.some((w) => n.includes(w));
}
