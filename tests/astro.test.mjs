import './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeChart, navamsaSign, houseGrid, refRashi, stepTime, PLANETS, MIN } from '../src/astro.js';
import { offsetMs, toInputValue, fromInputValue } from '../src/tz.js';
import { CITIES } from '../src/cities.js';
import { chartSVG } from '../src/chart.js';

// Swiss Ephemeris (Lahiri, sidereal, mean node) reference values.
const SWE = [
  { utc: '1947-08-14T18:30:00Z', lat: 28.6139, lon: 77.209, asc: 37.732, Sun: 117.989, Moon: 93.984, Mars: 67.456, Mercury: 103.674, Jupiter: 205.878, Venus: 112.561, Saturn: 110.473, Rahu: 35.07 },
  { utc: '1973-04-24T10:50:00Z', lat: 19.076, lon: 72.8777, asc: 154.335, Sun: 10.627, Moon: 266.251, Mars: 296.801, Mercury: 346.933, Jupiter: 286.609, Venus: 14.429, Saturn: 54.274, Rahu: 257.756 },
  { utc: '2020-12-21T18:20:00Z', lat: 51.5074, lon: -0.1278, asc: 96.536, Sun: 246.207, Moon: 333.73, Mars: 359.067, Mercury: 247.124, Jupiter: 276.341, Venus: 223.456, Saturn: 276.341, Rahu: 55.255 },
  { utc: '2026-11-06T13:15:00Z', lat: 19.076, lon: 72.8777, asc: 32.468, Sun: 199.904, Moon: 167.991, Mars: 117.132, Mercury: 195.47, Jupiter: 120.727, Venus: 179.766, Saturn: 344.72, Rahu: 301.545 },
  { utc: '1905-07-04T09:00:00Z', lat: 28.6139, lon: 77.209, asc: 195.771, Sun: 79.153, Moon: 99.467, Mars: 197.643, Mercury: 90.639, Jupiter: 34.338, Venus: 33.537, Saturn: 310.015, Rahu: 130.162 },
];
const d360 = (a, b) => { let d = (a - b) % 360; if (d > 180) d -= 360; if (d < -180) d += 360; return d; };

test('positions match Swiss Ephemeris within 0.02 deg (1905-2026)', () => {
  for (const c of SWE) {
    const ch = computeChart(Date.parse(c.utc), c.lat, c.lon);
    assert.ok(Math.abs(d360(ch.asc.lon, c.asc)) < 0.02, `${c.utc} asc`);
    for (const p of ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu']) assert.ok(Math.abs(d360(ch.planets[p].lon, c[p])) < 0.02, `${c.utc} ${p}`);
  }
});

test('known chart: 15 Aug 1947 00:00 IST Delhi = Vrishabha lagna, Sun & Moon in Karka (Moon Pushya)', () => {
  const ch = computeChart(Date.parse('1947-08-14T18:30:00Z'), 28.6139, 77.209);
  assert.equal(ch.asc.rashi, 1); assert.equal(ch.planets.Sun.rashi, 3); assert.equal(ch.planets.Moon.rashi, 3);
  assert.equal(ch.planets.Moon.nak, 7); assert.equal(ch.planets.Moon.pada, 1);
});

test('navamsa matches the classical movable/fixed/dual rule', () => {
  const classical = (lon) => {
    const sign = Math.floor(lon / 30), idx = Math.floor((lon % 30) / (30 / 9));
    return ([0, 3, 6, 9].includes(sign) ? sign : [1, 4, 7, 10].includes(sign) ? sign + 8 : sign + 4) + idx;
  };
  for (let lon = 0.05; lon < 360; lon += 0.37) {
    const f = lon % (10 / 3); if (f < 1e-6 || 10 / 3 - f < 1e-6) continue;
    assert.equal(navamsaSign(lon), classical(lon) % 12, `lon ${lon}`);
  }
  assert.equal(navamsaSign(4), 1); assert.equal(navamsaSign(29), 8); assert.equal(navamsaSign(31), 9); assert.equal(navamsaSign(359.9), 11);
});

test('rotation by house and by graha', () => {
  const ch = computeChart(Date.parse('2026-11-06T13:15:00Z'), 19.076, 72.8777);
  const where = (g, id) => g.grid.find((h) => h.items.some((i) => i.cls === id)).house;
  for (const k of ['D1', 'D9']) {
    const base = houseGrid(ch, k, { base: 'Lagna', house: 1 }), r4 = houseGrid(ch, k, { base: 'Lagna', house: 4 }), moon = houseGrid(ch, k, { base: 'Moon', house: 1 });
    assert.equal(where(base, 'Asc'), 1); assert.equal(where(moon, 'Moon'), 1);
    for (const id of ['Asc', ...PLANETS]) assert.equal(where(r4, id), ((where(base, id) - 4 + 12) % 12) + 1);
    for (const g of [base, r4, moon]) assert.equal(g.grid.flatMap((h) => h.items).length, 10);
  }
  assert.equal(refRashi(ch, 'D1', { base: 'Lagna', house: 4 }), (ch.asc.rashi + 3) % 12);
});

test('locked house stays Lagna while time moves; planet Lagna follows the planet', () => {
  const t0 = Date.parse('2026-11-06T13:15:00Z'), t1 = stepTime(t0, 'UTC', 'day', 20);
  const a = computeChart(t0, 19.076, 72.8777), b = computeChart(t1, 19.076, 72.8777);
  const fix = [(a.asc.rashi + 3) % 12, (a.asc.d9 + 3) % 12], rot = { base: 'Fixed', fix, house: 1 };
  assert.equal(houseGrid(a, 'D1', rot).grid[0].rashi, fix[0]); assert.equal(houseGrid(b, 'D1', rot).grid[0].rashi, fix[0]);
  assert.equal(houseGrid(b, 'D9', rot).grid[0].rashi, fix[1]);
  assert.equal(houseGrid(b, 'D1', { base: 'Moon', house: 1 }).grid[0].rashi, b.planets.Moon.rashi);
});

test('time zones: DST-aware, historical, round trip; stepping is wall-clock', () => {
  assert.equal(offsetMs(Date.parse('2026-07-01T12:00:00Z'), 'America/New_York'), -4 * 3600000);
  assert.equal(offsetMs(Date.parse('2026-01-01T12:00:00Z'), 'America/New_York'), -5 * 3600000);
  assert.equal(offsetMs(Date.parse('2026-11-06T12:00:00Z'), 'Asia/Kolkata'), 5.5 * 3600000);
  for (const z of ['Asia/Kolkata', 'America/New_York', 'Europe/London', 'Australia/Sydney']) {
    const u = Date.parse('2026-11-06T13:15:00Z'); assert.equal(fromInputValue(toInputValue(u, z), z), u, z);
  }
  assert.equal(toInputValue(Date.parse('2026-11-06T13:15:00Z'), 'Asia/Kolkata'), '2026-11-06T18:45');
  const t = (s) => Date.parse(s);
  assert.equal(stepTime(t('2024-01-31T06:30:00Z'), 'UTC', 'month', 1), t('2024-02-29T06:30:00Z'));
  assert.equal(stepTime(t('2024-02-29T06:30:00Z'), 'UTC', 'year', 1), t('2025-02-28T06:30:00Z'));
  assert.equal(stepTime(t('2024-05-01T00:00:00Z'), 'UTC', 'day', -1), t('2024-04-30T00:00:00Z'));
  assert.equal(stepTime(t('2024-05-01T00:00:00Z'), 'UTC', 'week', 2), t('2024-05-15T00:00:00Z'));
  assert.equal(stepTime(t('2024-05-01T00:00:00Z'), 'UTC', 'min', 5), t('2024-05-01T00:05:00Z'));
  // a day across US DST start keeps the same wall-clock time (10:00 -> 10:00)
  const a = t('2026-03-07T15:00:00Z'); assert.equal(toInputValue(stepTime(a, 'America/New_York', 'day', 1), 'America/New_York'), '2026-03-08T10:00');
});

test('cities list is valid and charts render', () => {
  for (const [, , lat, lon, zone] of CITIES) { assert.ok(Math.abs(lat) <= 90 && Math.abs(lon) <= 180); assert.doesNotThrow(() => offsetMs(0, zone), zone); }
  const ch = computeChart(Date.parse('2026-11-06T13:15:00Z'), 19.076, 72.8777);
  for (const k of ['D1', 'D9']) {
    const svg = chartSVG(houseGrid(ch, k, { base: 'Lagna', house: 1 }).grid, k);
    assert.ok(!/NaN|undefined/.test(svg)); assert.equal((svg.match(/class="pl pl-/g) || []).length, 10);
  }
});
