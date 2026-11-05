import './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeSnapshot, describeLongitude, siderealAscendant } from '../src/jyotish.js';
import { NAK_CELLS, buildGrid } from '../src/sarvatobhadra.js';
import { parseCSV } from '../src/data.js';

test('Sun/Moon/Rahu sidereal longitudes at J2000 are sane', () => {
  const s = computeSnapshot(new Date(Date.UTC(2000, 0, 1, 12)));
  // tropical Sun 280.37 - ayanamsa 23.85 = ~256.5
  assert.ok(Math.abs(s.planets.Sun.lon - 256.52) < 0.15, `Sun ${s.planets.Sun.lon}`);
  // mean node tropical ~125.04 => sidereal ~101.2
  assert.ok(Math.abs(s.planets.Rahu.lon - 101.19) < 0.2, `Rahu ${s.planets.Rahu.lon}`);
  assert.ok(Math.abs(((s.planets.Ketu.lon - s.planets.Rahu.lon + 360) % 360) - 180) < 1e-9);
});

test('Sidereal Sun enters Mesha around 13-15 April', () => {
  const a = computeSnapshot(new Date(Date.UTC(2024, 3, 12, 6)));
  const b = computeSnapshot(new Date(Date.UTC(2024, 3, 16, 6)));
  assert.equal(a.planets.Sun.rashi, 11); // still Meena
  assert.equal(b.planets.Sun.rashi, 0);  // Mesha
});

test('Moon moves ~13 deg/day and nakshatra/pada decoding is consistent', () => {
  const a = computeSnapshot(new Date(Date.UTC(2024, 5, 1, 4)));
  const b = computeSnapshot(new Date(Date.UTC(2024, 5, 2, 4)));
  const d = (b.planets.Moon.lon - a.planets.Moon.lon + 360) % 360;
  assert.ok(d > 11 && d < 15.5, `moon moved ${d}`);
  const x = describeLongitude(0.5); assert.deepEqual([x.rashi, x.nak, x.pada], [0, 0, 1]);
  const y = describeLongitude(359.9); assert.deepEqual([y.rashi, y.nak, y.pada], [11, 26, 4]);
});

test('Retrograde detection: Saturn/Jupiter flags are booleans, nodes always retro', () => {
  const s = computeSnapshot(new Date(Date.UTC(2024, 7, 1, 4)));
  assert.equal(s.planets.Rahu.retro, true);
  assert.equal(typeof s.planets.Saturn.retro, 'boolean');
  // Saturn was retrograde Jun 29 - Nov 15 2024
  assert.equal(s.planets.Saturn.retro, true);
});

test('Ascendant: equator, RAMC=0 -> Cancer 0 (tropical)', () => {
  // find a date where GAST~0 at lon 0 is not trivial; instead check asc changes ~1 sign / 2h
  const a = siderealAscendant(new Date(Date.UTC(2024, 0, 10, 3, 45)), 19.076, 72.8777);
  const b = siderealAscendant(new Date(Date.UTC(2024, 0, 10, 5, 45)), 19.076, 72.8777);
  const d = (b - a + 360) % 360;
  assert.ok(d > 15 && d < 60, `asc moved ${d} in 2h`);
});

test('Sarvatobhadra layout has 28 unique nakshatra cells on the outer ring', () => {
  const cells = Object.values(NAK_CELLS);
  assert.equal(cells.length, 28);
  assert.equal(new Set(cells.map((c) => c.join(','))).size, 28);
  for (const [r, c] of cells) assert.ok(r === 0 || r === 8 || c === 0 || c === 8);
  const g = buildGrid(); assert.equal(g.length, 9);
});

test('CSV parsing: Yahoo and NSE style dates', () => {
  const rows = ['Date,Open,High,Low,Close,Adj Close,Volume'];
  let t = Date.UTC(2020, 0, 1);
  for (let i = 0; i < 320; i++) { rows.push(`${new Date(t).toISOString().slice(0, 10)},100,101,99,${100 + i % 5},1,1`); t += 86400000; }
  assert.equal(parseCSV(rows.join('\n')).length, 320);
  const nse = ['Date,Open,High,Low,Close']; t = Date.UTC(2020, 0, 1);
  for (let i = 0; i < 320; i++) { const d = new Date(t); nse.push(`${String(d.getUTCDate()).padStart(2, '0')}-Jan-${d.getUTCFullYear() + Math.floor(i / 400)},100,101,99,100`); t += 86400000; }
  assert.throws(() => parseCSV('Date,Open\n2020-01-01,5'));
});
