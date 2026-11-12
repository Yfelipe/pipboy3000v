// The character sheet: your level and S.P.E.C.I.A.L. for the apps' STAT pages. It goes on the
// SD card as USER/CHAR.json: { level, special: [S, P, E, C, I, A, L] }. Mojave UI, Capital UI
// and PIP-OS X read it when they start (apps/shared/pipos133.js charSheet). No DOM here.
export const SHEET_PATH = 'USER/CHAR.json';
export const SPECIAL = Object.freeze(['Strength', 'Perception', 'Endurance', 'Charisma', 'Intelligence', 'Agility', 'Luck']);
export const SHEET_DEFAULT = Object.freeze({ level: 1, special: Object.freeze([5, 5, 5, 5, 5, 5, 5]) });

/** Any value in, a valid sheet out: level 1..99, seven attributes 1..10. */
export function normaliseSheet(data) {
  const num = (v, lo, hi, fallback) => {
    const n = Math.round(Number(v));
    return v === null || v === '' || !Number.isFinite(n) ? fallback : Math.min(hi, Math.max(lo, n));
  };
  const special = Array.isArray(data?.special) ? data.special : [];
  return { level: num(data?.level, 1, 99, 1), special: SPECIAL.map((_, i) => num(special[i], 1, 10, 5)) };
}
