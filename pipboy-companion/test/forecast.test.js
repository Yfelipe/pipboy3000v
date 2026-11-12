// The wasteland forecast: the server's Open-Meteo lookups (server/forecast.js, with a stand-in
// for the service: tests never go online) and the report text (public/js/forecast.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server/app.js';
import { forecastUrl, geocodeUrl, summarise, places, coordinate } from '../server/forecast.js';
import { wasteland, wastelandReport, dayLabel, placeLabel } from '../public/js/forecast.js';
import { tempDir, quietLogger } from './support/tmp.js';

const REPLY = {
  timezone: 'Pacific/Auckland',
  current: { time: '2026-11-11T21:45', temperature_2m: 16.6, weather_code: 3, wind_speed_10m: 22.3 },
  daily: {
    time: ['2026-11-11', '2026-11-12', '2026-11-13'],
    weather_code: [3, 63, 95],
    temperature_2m_max: [19.2, 18.1, 21],
    temperature_2m_min: [13.9, 12.2, 14.4],
    precipitation_probability_max: [10, 80, 55],
  },
};

test('requests: the forecast and place-search addresses, and coordinates rounded to about a kilometre', () => {
  const u = new URL(forecastUrl(-36.85, 174.76));
  assert.equal(u.origin + u.pathname, 'https://api.open-meteo.com/v1/forecast');
  assert.deepEqual([u.searchParams.get('latitude'), u.searchParams.get('longitude'), u.searchParams.get('timezone'), u.searchParams.get('forecast_days')], ['-36.85', '174.76', 'auto', '3']);
  assert.match(u.searchParams.get('current'), /temperature_2m,weather_code,wind_speed_10m/);
  const g = new URL(geocodeUrl('Auckland & co'));
  assert.equal(g.origin + g.pathname, 'https://geocoding-api.open-meteo.com/v1/search');
  assert.equal(g.searchParams.get('name'), 'Auckland & co');
  assert.equal(coordinate('-36.84853', 90, 'lat'), -36.85);
  assert.equal(coordinate('174.7633', 180, 'lon'), 174.76);
  for (const bad of ['', null, 'x', '91', '-90.5']) assert.throws(() => coordinate(bad, 90, 'lat'), /between -90 and 90/);
});

test('replies: the numbers the dashboard needs, in both spellings the service has used', () => {
  assert.deepEqual(summarise(REPLY), {
    timezone: 'Pacific/Auckland',
    current: { temp: 16.6, code: 3, wind: 22.3 },
    days: [
      { date: '2026-11-11', code: 3, max: 19.2, min: 13.9, rain: 10 },
      { date: '2026-11-12', code: 63, max: 18.1, min: 12.2, rain: 80 },
      { date: '2026-11-13', code: 95, max: 21, min: 14.4, rain: 55 },
    ],
  });
  // the older field names
  const old = summarise({ current_weather: { temperature: 5, weathercode: 71, windspeed: 9 }, daily: { time: ['2026-01-01'], weathercode: [71], temperature_2m_max: [6], temperature_2m_min: [-1] } });
  assert.deepEqual(old.current, { temp: 5, code: 71, wind: 9 });
  assert.deepEqual(old.days, [{ date: '2026-01-01', code: 71, max: 6, min: -1, rain: null }]);
  assert.throws(() => summarise({}), /no weather/);
  assert.throws(() => summarise({ error: true, reason: 'bad' }), /no weather/);
  assert.deepEqual(places({ results: [{ name: 'Auckland', admin1: 'Auckland', country: 'New Zealand', latitude: -36.84853, longitude: 174.76349 }, { name: 'Nowhere' }, null] }), [
    { name: 'Auckland', region: 'Auckland', country: 'New Zealand', lat: -36.85, lon: 174.76 },
  ]);
  assert.deepEqual(places({}), []);
});

test('API: the server asks Open-Meteo once per place, keeps the answer, and says so when it is unreachable', async (t) => {
  const asked = [];
  let online = true;
  const fetchImpl = async (url) => {
    asked.push(url);
    if (!online) throw new Error('offline');
    if (url.startsWith('https://geocoding-api.open-meteo.com/')) return { ok: true, json: async () => ({ results: [{ name: 'Auckland', admin1: 'Auckland', country: 'New Zealand', latitude: -36.84853, longitude: 174.76349 }] }) };
    return { ok: true, json: async () => REPLY };
  };
  const app = await createApp({ dataDir: await tempDir(t), logger: quietLogger, fetchImpl });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  t.after(() => app.server.close());
  const get = (p) => fetch(`http://localhost:${app.server.address().port}${p}`).then(async (r) => ({ status: r.status, body: await r.json() }));

  const first = await get('/api/forecast?lat=-36.84853&lon=174.76349');
  assert.equal(first.status, 200);
  assert.deepEqual([first.body.lat, first.body.lon, first.body.source], [-36.85, 174.76, 'Open-Meteo']);
  assert.equal(first.body.current.temp, 16.6);
  assert.equal(first.body.days.length, 3);
  assert.match(asked[0], /latitude=-36\.85&longitude=174\.76/, 'only the rounded coordinates leave this computer');
  await get('/api/forecast?lat=-36.85&lon=174.76');
  assert.equal(asked.length, 1, 'the same place within 30 minutes is answered from memory');

  assert.deepEqual((await get('/api/places?name=Auckland')).body.places, [{ name: 'Auckland', region: 'Auckland', country: 'New Zealand', lat: -36.85, lon: 174.76 }]);
  assert.equal((await get('/api/places?name=A')).status, 400);
  assert.equal((await get('/api/forecast?lat=95&lon=0')).status, 400);
  assert.equal((await get('/api/forecast?lon=0')).status, 400);

  online = false;
  const down = await get('/api/forecast?lat=1&lon=2');
  assert.equal(down.status, 502);
  assert.match(down.body.error.message, /Open-Meteo.*didn’t answer.*online/);
});

test('report: weather in wasteland terms, as ASCII text for a Pip-Boy note', () => {
  assert.deepEqual(wasteland(0), ['CLEAR SKIES', 'GOOD SCAVENGING WEATHER.']);
  assert.equal(wasteland(63)[0], 'ACID RAIN');
  assert.equal(wasteland(81)[0], 'ACID RAIN');
  assert.equal(wasteland(73)[0], 'NUCLEAR WINTER FLURRIES');
  assert.equal(wasteland(96)[0], 'RAD STORM');
  assert.equal(wasteland(null)[0], 'CONDITIONS UNKNOWN');
  assert.equal(dayLabel('2026-11-12'), 'THU 12 NOV');
  assert.equal(dayLabel('junk'), 'JUNK');
  assert.equal(placeLabel({ name: 'Auckland', region: 'Auckland', country: 'New Zealand' }), 'Auckland, New Zealand');
  assert.equal(placeLabel({ name: 'Whangārei', region: 'Northland', country: null }), 'Whangārei, Northland');

  const text = wastelandReport(summarise(REPLY), 'Whangārei, New Zealand');
  assert.deepEqual(text.split('\n'), [
    'WASTELAND FORECAST',
    'WHANGAREI, NEW ZEALAND',
    '',
    'NOW: 17C. ASH CLOUD OVERHEAD.',
    'WIND 22 KM/H.',
    'NO SUN TODAY.',
    '',
    'WED 11 NOV: 14-19C.',
    'ASH CLOUD OVERHEAD.',
    'NO SUN TODAY.',
    '',
    'THU 12 NOV: 12-18C.',
    'ACID RAIN. RAIN 80%.',
    'STAY DRY. CHECK YOUR RAD-X.',
    '',
    'FRI 13 NOV: 14-21C.',
    'RAD STORM. RAIN 55%.',
    'SEEK SHELTER AT ONCE.',
    '',
    'VAULT-TEC: PREPARE FOR THE FUTURE.',
  ]);
  assert.match(text, /^[\x20-\x7e\n]+$/, 'ASCII only: the Pip-Boy\'s fonts have nothing else');
  // a gale, and a reply with no current weather
  assert.match(wastelandReport({ current: { temp: 9, code: 0, wind: 55 }, days: [] }), /WIND 55 KM\/H: DUST STORM RISK\./);
  assert.equal(wastelandReport({ current: { temp: null, code: null, wind: null }, days: [] }).split('\n')[2], 'VAULT-TEC: PREPARE FOR THE FUTURE.');
});
