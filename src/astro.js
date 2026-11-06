// Vedic chart maths: sidereal positions (Lahiri), D1/D9 signs, chart rotation, time stepping.
// Positions come from the vendored astronomy-engine (global `Astronomy`); checked against Swiss Ephemeris.
import { offsetMs, localToUtc } from './tz.js';

export const RASHIS = ['Mesha', 'Vrishabha', 'Mithuna', 'Karka', 'Simha', 'Kanya', 'Tula', 'Vrischika', 'Dhanu', 'Makara', 'Kumbha', 'Meena'];
export const NAKSHATRAS = ['Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra', 'Punarvasu', 'Pushya', 'Ashlesha', 'Magha', 'Purva Phalguni', 'Uttara Phalguni', 'Hasta', 'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha', 'Mula', 'Purva Ashadha', 'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Shatabhisha', 'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati'];
export const PLANETS = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu'];
export const ABBR = { Sun: 'Su', Moon: 'Mo', Mars: 'Ma', Mercury: 'Me', Jupiter: 'Ju', Venus: 'Ve', Saturn: 'Sa', Rahu: 'Ra', Ketu: 'Ke' };
export const ROT_BASES = ['Lagna', ...PLANETS];

export const MIN = 60000;
export const MIN_UTC = Date.UTC(1800, 0, 1), MAX_UTC = Date.UTC(2200, 11, 31);
export const clampUtc = (ms) => Math.min(MAX_UTC, Math.max(MIN_UTC, Math.round(ms / MIN) * MIN));

export const norm360 = (x) => ((x % 360) + 360) % 360;
const RAD = Math.PI / 180;
// Lahiri (Chitrapaksha) mean ayanamsa at J2000.0 = 23°51'25.5" (same as Swiss Ephemeris).
const AYAN_J2000 = 23.857092;
const ayanamsa = (T) => AYAN_J2000 + (5028.796195 * T + 1.1054348 * T * T) / 3600;

export const rashiOf = (lon) => Math.floor(norm360(lon) / 30) % 12;
/** D9 sign: floor(lon / 3°20') mod 12 (movable: from itself, fixed: from 9th, dual: from 5th). */
export const navamsaSign = (lon) => Math.floor(norm360(lon) * 0.3 + 1e-9) % 12;

function sidereal(Ast, date) {
  const t = Ast.MakeTime(date), rot = Ast.Rotation_EQJ_ECL(), out = {};
  // NB: Ecliptic() is ecliptic-of-date; rotating to the fixed J2000 ecliptic keeps the ayanamsa maths exact.
  for (const p of ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn']) {
    const v = Ast.RotateVector(rot, Ast.GeoVector(p, t, true));
    out[p] = norm360(Math.atan2(v.y, v.x) / RAD - AYAN_J2000);
  }
  const T = t.tt / 36525; // mean node
  out.Rahu = norm360(125.04452 - 1934.136261 * T + 0.0020708 * T * T + (T * T * T) / 450000 - ayanamsa(T));
  out.Ketu = norm360(out.Rahu + 180);
  return { lons: out, T, t };
}

function ascendant(Ast, t, T, lat, lon) {
  const ramc = norm360(Ast.SiderealTime(t) * 15 + lon) * RAD, eps = (23.439291 - 0.0130042 * T) * RAD, phi = lat * RAD;
  const asc = Math.atan2(Math.cos(ramc), -(Math.sin(ramc) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps))) / RAD;
  return norm360(asc - ayanamsa(T));
}

function ast() { if (!globalThis.Astronomy) throw new Error('astronomy-engine not loaded'); return globalThis.Astronomy; }

/** Ascendant sign (0..11) at an instant; used for nothing but tests of the maths. */
export function lagnaLon(utc, lat, lon) { const Ast = ast(), s = sidereal(Ast, new Date(utc)); return ascendant(Ast, s.t, s.T, lat, lon); }

/** All data for one instant: lagna + 9 grahas with D1 and D9 signs. */
export function computeChart(utc, lat, lon) {
  const Ast = ast(), d = new Date(utc), s = sidereal(Ast, d), later = sidereal(Ast, new Date(utc + 6 * 3600000));
  const planets = {};
  for (const p of PLANETS) {
    const l = s.lons[p], nak = Math.floor(l / (360 / 27));
    const speed = ((later.lons[p] - l + 540) % 360) - 180;
    planets[p] = { lon: l, rashi: rashiOf(l), deg: l % 30, nak, pada: Math.floor((l - nak * (360 / 27)) / (360 / 108)) + 1, d9: navamsaSign(l), retro: p !== 'Rahu' && p !== 'Ketu' && p !== 'Sun' && p !== 'Moon' && speed < 0 };
  }
  const al = ascendant(Ast, s.t, s.T, lat, lon), nak = Math.floor(al / (360 / 27));
  return { utc, planets, asc: { lon: al, rashi: rashiOf(al), deg: al % 30, nak, pada: Math.floor((al - nak * (360 / 27)) / (360 / 108)) + 1, d9: navamsaSign(al) } };
}

// ---- rotation: "house N counted from base" becomes the ascendant of the drawn chart
export const houseOf = (rashi, ref) => ((rashi - ref + 12) % 12) + 1;
export function refRashi(chart, kind, rot) {
  const sign = (o) => (kind === 'D9' ? o.d9 : o.rashi);
  const base = rot.base === 'Lagna' ? sign(chart.asc) : sign(chart.planets[rot.base]);
  return (base + rot.house - 1) % 12;
}
export function houseGrid(chart, kind, rot) {
  const ref = refRashi(chart, kind, rot), sign = (o) => (kind === 'D9' ? o.d9 : o.rashi);
  const grid = Array.from({ length: 12 }, (_, i) => ({ house: i + 1, rashi: (ref + i) % 12, items: [] }));
  grid[houseOf(sign(chart.asc), ref) - 1].items.push({ abbr: 'As', cls: 'Asc', deg: kind === 'D9' ? (chart.asc.lon % (10 / 3)) * 9 : chart.asc.deg });
  for (const p of PLANETS) {
    const o = chart.planets[p];
    grid[houseOf(sign(o), ref) - 1].items.push({ abbr: ABBR[p], cls: p, retro: o.retro, deg: kind === 'D9' ? (o.lon % (10 / 3)) * 9 : o.deg });
  }
  return { ref, grid };
}
export function describeRotation(rot) {
  if (rot.base === 'Lagna') return rot.house === 1 ? 'Original chart (Lagna)' : `House ${rot.house} as Lagna`;
  return rot.house === 1 ? `${rot.base} as Lagna` : `House ${rot.house} from ${rot.base} as Lagna`;
}

// ---- time (wall-clock arithmetic in the chosen place's time zone, DST aware)
export function stepTime(utc, zone, unit, n) {
  if (unit === 'min') return clampUtc(utc + n * MIN);
  if (unit === 'hour') return clampUtc(utc + n * 3600000);
  const wall = new Date(utc + offsetMs(utc, zone));
  const y = wall.getUTCFullYear(), mo = wall.getUTCMonth(), d = wall.getUTCDate();
  const nw = new Date(0);
  if (unit === 'day' || unit === 'week') nw.setUTCFullYear(y, mo, d + n * (unit === 'week' ? 7 : 1));
  else {
    const m = mo + n * (unit === 'year' ? 12 : 1), ty = y + Math.floor(m / 12), tm = ((m % 12) + 12) % 12, last = new Date(0);
    last.setUTCFullYear(ty, tm + 1, 0); nw.setUTCFullYear(ty, tm, Math.min(d, last.getUTCDate()));
  }
  nw.setUTCHours(wall.getUTCHours(), wall.getUTCMinutes(), 0, 0);
  return clampUtc(localToUtc(nw.getTime(), zone));
}
