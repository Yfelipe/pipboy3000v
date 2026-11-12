// The wasteland forecast's weather, from Open-Meteo (https://open-meteo.com): free, no account
// and no key. The server asks on the dashboard's behalf (the page itself only talks to this
// server), and only when the person presses a button: nothing is fetched in the background.
// Two hosts are contacted: api.open-meteo.com (the forecast) and geocoding-api.open-meteo.com
// (finding a place by name). Coordinates are rounded to two decimals (about a kilometre) first.
import { AppError } from './errors.js';

const FORECAST = 'https://api.open-meteo.com/v1/forecast';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const KEEP_MS = 30 * 60_000;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** "12.345" -> 12.35 within [-limit, limit], or a 400. */
export function coordinate(value, limit, name) {
  const n = Number(value);
  if (value === null || value === '' || !Number.isFinite(n) || Math.abs(n) > limit) {
    throw new AppError(400, 'validation', `${name} must be a number between -${limit} and ${limit}`);
  }
  return Math.round(n * 100) / 100;
}

export function forecastUrl(lat, lon) {
  const q = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '3',
  });
  return `${FORECAST}?${q}`;
}

export function geocodeUrl(name) {
  return `${GEOCODE}?${new URLSearchParams({ name, count: '5', language: 'en', format: 'json' })}`;
}

/** Open-Meteo's forecast reply as the few numbers the dashboard needs. Throws if it has none. */
export function summarise(data) {
  const c = data?.current ?? data?.current_weather ?? {};
  const d = data?.daily ?? {};
  const days = (Array.isArray(d.time) ? d.time : []).slice(0, 3).map((date, i) => ({
    date: String(date),
    code: num((d.weather_code ?? d.weathercode)?.[i]),
    max: num(d.temperature_2m_max?.[i]),
    min: num(d.temperature_2m_min?.[i]),
    rain: num(d.precipitation_probability_max?.[i]),
  }));
  const current = { temp: num(c.temperature_2m ?? c.temperature), code: num(c.weather_code ?? c.weathercode), wind: num(c.wind_speed_10m ?? c.windspeed) };
  if (current.temp === null && !days.length) throw new Error('no weather in the reply');
  return { current, days, timezone: typeof data.timezone === 'string' ? data.timezone : null };
}

/** Open-Meteo's place search reply as [{ name, region, country, lat, lon }]. */
export function places(data) {
  return (Array.isArray(data?.results) ? data.results : [])
    .filter((r) => r && typeof r.name === 'string' && num(r.latitude) !== null && num(r.longitude) !== null)
    .slice(0, 5)
    .map((r) => ({
      name: r.name,
      region: typeof r.admin1 === 'string' ? r.admin1 : null,
      country: typeof r.country === 'string' ? r.country : null,
      lat: Math.round(r.latitude * 100) / 100,
      lon: Math.round(r.longitude * 100) / 100,
    }));
}

/** The two lookups, with a small cache so pressing the button again doesn't ask again. */
export function createForecast({ fetchImpl }) {
  const cache = new Map(); // url -> { at, value }
  async function ask(url, read) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at < KEEP_MS) return hit.value;
    let value;
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`status ${res.status}`);
      value = read(await res.json());
    } catch (e) {
      throw new AppError(502, 'weather_unavailable', `The weather service (Open-Meteo) didn’t answer: ${e.message}. Check this computer is online and try again.`);
    }
    cache.set(url, { at: Date.now(), value });
    if (cache.size > 30) cache.delete(cache.keys().next().value);
    return value;
  }
  return {
    forecast: (lat, lon) => ask(forecastUrl(lat, lon), summarise),
    search: (name) => ask(geocodeUrl(name), places),
  };
}
