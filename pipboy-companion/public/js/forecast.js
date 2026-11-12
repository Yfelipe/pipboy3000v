// The wasteland forecast: real weather (from the server's /api/forecast) told the way a vault
// terminal would, as plain ASCII text for a note on the Pip-Boy. No DOM here, so tests can run it.

/** WMO weather codes (what Open-Meteo reports) in wasteland terms: [what it is, what to do]. */
export function wasteland(code) {
  if (code === 0) return ['CLEAR SKIES', 'GOOD SCAVENGING WEATHER.'];
  if (code === 1 || code === 2) return ['DUST HAZE', 'VISIBILITY FAIR.'];
  if (code === 3) return ['ASH CLOUD OVERHEAD', 'NO SUN TODAY.'];
  if (code === 45 || code === 48) return ['FOG BANK', 'FERALS HUNT IN FOG. STAY CLOSE.'];
  if (code >= 51 && code <= 57) return ['LIGHT FALLOUT DRIZZLE', 'KEEP YOUR HOOD UP.'];
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return ['ACID RAIN', 'STAY DRY. CHECK YOUR RAD-X.'];
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return ['NUCLEAR WINTER FLURRIES', 'WRAP UP WARM.'];
  if (code >= 95 && code <= 99) return ['RAD STORM', 'SEEK SHELTER AT ONCE.'];
  return ['CONDITIONS UNKNOWN', 'SENSORS NEED SERVICE.'];
}

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const deg = (n) => `${Math.round(n)}C`;

/** "2026-11-12" -> "THU 12 NOV" (the date as written, whatever the time zone). */
export function dayLabel(date) {
  const [y, m, d] = String(date).split('-').map(Number);
  if (!y || !m || !d) return String(date).toUpperCase();
  return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}

/**
 * The report as text. forecast: { current: { temp, code, wind }, days: [{ date, code, max, min,
 * rain }] } (nulls where the service had nothing). place: a label such as "Auckland, New Zealand".
 * Pip-Boy fonts are ASCII only: the place is folded to plain upper-case letters.
 */
export function wastelandReport(forecast, place = '') {
  const plain = String(place).normalize('NFKD').replace(/[^\x20-\x7e]/g, '').trim().toUpperCase();
  const lines = ['WASTELAND FORECAST'];
  if (plain) lines.push(plain);
  lines.push('');
  const c = forecast.current ?? {};
  if (c.temp !== null && c.temp !== undefined) {
    const [what, advice] = wasteland(c.code);
    lines.push(`NOW: ${deg(c.temp)}. ${what}.`);
    if (c.wind !== null && c.wind !== undefined) lines.push(c.wind >= 40 ? `WIND ${Math.round(c.wind)} KM/H: DUST STORM RISK.` : `WIND ${Math.round(c.wind)} KM/H.`);
    lines.push(advice, '');
  }
  for (const d of forecast.days ?? []) {
    const [what, advice] = wasteland(d.code);
    const temps = d.min !== null && d.max !== null ? ` ${Math.round(d.min)}-${deg(d.max)}.` : '';
    lines.push(`${dayLabel(d.date)}:${temps}`);
    lines.push(`${what}.${d.rain !== null && d.rain >= 30 ? ` RAIN ${Math.round(d.rain)}%.` : ''}`);
    lines.push(advice, '');
  }
  lines.push('VAULT-TEC: PREPARE FOR THE FUTURE.');
  return lines.join('\n');
}

/** "Auckland, Auckland, New Zealand" without saying the same thing twice. */
export function placeLabel(p) {
  return [p.name, p.region, p.country].filter((part, i, all) => part && all.indexOf(part) === i).join(', ');
}
