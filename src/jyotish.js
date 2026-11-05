// Core Jyotish constants + sidereal planetary positions.
// Positions come from the vendored `astronomy-engine` (global `Astronomy`).
// Zodiac: sidereal. Ayanamsa: Lahiri by default (offset configurable).

export const RASHIS = ['Mesha', 'Vrishabha', 'Mithuna', 'Karka', 'Simha', 'Kanya', 'Tula', 'Vrischika', 'Dhanu', 'Makara', 'Kumbha', 'Meena'];
export const RASHI_LORDS = ['Mars', 'Venus', 'Mercury', 'Moon', 'Sun', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Saturn', 'Jupiter'];

export const NAKSHATRAS = [
  'Ashwini', 'Bharani', 'Krittika', 'Rohini', 'Mrigashira', 'Ardra', 'Punarvasu', 'Pushya', 'Ashlesha',
  'Magha', 'Purva Phalguni', 'Uttara Phalguni', 'Hasta', 'Chitra', 'Swati', 'Vishakha', 'Anuradha', 'Jyeshtha',
  'Mula', 'Purva Ashadha', 'Uttara Ashadha', 'Shravana', 'Dhanishta', 'Shatabhisha', 'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati',
];
// Vimshottari order of lords repeating every 9 nakshatras
const NAK_LORD_SEQ = ['Ketu', 'Venus', 'Sun', 'Moon', 'Mars', 'Rahu', 'Jupiter', 'Saturn', 'Mercury'];
export const NAK_LORDS = NAKSHATRAS.map((_, i) => NAK_LORD_SEQ[i % 9]);

export const PLANETS = ['Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus', 'Saturn', 'Rahu', 'Ketu'];
export const MALEFICS = ['Sun', 'Mars', 'Saturn', 'Rahu', 'Ketu'];
export const BENEFICS = ['Moon', 'Mercury', 'Jupiter', 'Venus'];

export const NAK_SPAN = 360 / 27;       // 13°20'
export const PADA_SPAN = NAK_SPAN / 4;  // 3°20'

export const norm360 = (x) => ((x % 360) + 360) % 360;
export const angDiff = (a, b) => { const d = Math.abs(norm360(a) - norm360(b)) % 360; return d > 180 ? 360 - d : d; };

// Lahiri ayanamsa at J2000 (~23°51'11"). sidereal = (tropical longitude of date) - ayanamsa(date)
// = (J2000-ecliptic longitude) - AYANAMSA_J2000, because precession of the ecliptic longitude equals
// the ayanamsa drift, so the drift cancels exactly.
export const AYANAMSA_J2000 = 23.853;
export const AYANAMSA_PRESETS = { lahiri: 0, kp: -0.1, raman: -1.39, fagan: -0.88 };

export function ayanamsaOfDate(T /* julian centuries since J2000 */, offset = 0) {
  return AYANAMSA_J2000 + offset + (5028.796195 * T + 1.1054348 * T * T) / 3600;
}

export function describeLongitude(lon) {
  lon = norm360(lon);
  const rashi = Math.floor(lon / 30);
  const degInSign = lon - rashi * 30;
  const nak = Math.floor(lon / NAK_SPAN);
  const pada = Math.floor((lon - nak * NAK_SPAN) / PADA_SPAN) + 1;
  return { lon, rashi, degInSign, nak, pada, nakLord: NAK_LORDS[nak] };
}

// Abhijit occupies 276°40' – 280°53'20" sidereal (last quarter of U.Ashadha + first 1/15 of Shravana)
export const ABHIJIT_START = 276 + 40 / 60;
export const ABHIJIT_END = 280 + 53 / 60 + 20 / 3600;
export const isAbhijit = (lon) => norm360(lon) >= ABHIJIT_START && norm360(lon) < ABHIJIT_END;

const BODY = { Sun: 'Sun', Moon: 'Moon', Mars: 'Mars', Mercury: 'Mercury', Jupiter: 'Jupiter', Venus: 'Venus', Saturn: 'Saturn' };

function A() {
  const a = globalThis.Astronomy;
  if (!a) throw new Error('astronomy-engine not loaded (expected global Astronomy)');
  return a;
}

function siderealLongitudes(date, ayanOffset) {
  const Ast = A();
  const t = Ast.MakeTime(date);
  const out = {};
  for (const p of Object.keys(BODY)) {
    const v = Ast.GeoVector(BODY[p], t, true);
    out[p] = norm360(Ast.Ecliptic(v).elon - AYANAMSA_J2000 - ayanOffset);
  }
  // Mean lunar node (tropical of date) -> sidereal
  const T = t.tt / 36525; // t.tt = days since J2000 (TT)
  const omegaTrop = norm360(125.04452 - 1934.136261 * T + 0.0020708 * T * T + (T * T * T) / 450000);
  out.Rahu = norm360(omegaTrop - ayanamsaOfDate(T, ayanOffset));
  out.Ketu = norm360(out.Rahu + 180);
  return out;
}

/** Sidereal ascendant for a UTC Date at a geographic location. */
export function siderealAscendant(date, latDeg, lonEastDeg, ayanOffset = 0) {
  const Ast = A();
  const t = Ast.MakeTime(date);
  const T = t.tt / 36525;
  const gast = Ast.SiderealTime(t); // hours
  const ramc = norm360(gast * 15 + lonEastDeg) * Math.PI / 180;
  const eps = (23.439291 - 0.0130042 * T) * Math.PI / 180;
  const phi = latDeg * Math.PI / 180;
  const asc = Math.atan2(Math.cos(ramc), -(Math.sin(ramc) * Math.cos(eps) + Math.tan(phi) * Math.sin(eps))) * 180 / Math.PI;
  return norm360(norm360(asc) - ayanamsaOfDate(T, ayanOffset));
}

export const COMBUST_ORB = { Moon: 12, Mars: 17, Mercury: 14, Jupiter: 11, Venus: 10, Saturn: 15 };
export const EXALT = { Sun: 0, Moon: 1, Mars: 9, Mercury: 5, Jupiter: 3, Venus: 11, Saturn: 6 };
export const DEBIL = { Sun: 6, Moon: 7, Mars: 3, Mercury: 11, Jupiter: 9, Venus: 5, Saturn: 0 };
export const OWN = { Sun: [4], Moon: [3], Mars: [0, 7], Mercury: [2, 5], Jupiter: [8, 11], Venus: [1, 6], Saturn: [9, 10] };

export function dignity(planet, rashi) {
  if (EXALT[planet] === rashi) return 'exalted';
  if (DEBIL[planet] === rashi) return 'debilitated';
  if (OWN[planet] && OWN[planet].includes(rashi)) return 'own';
  return 'neutral';
}

/**
 * Full chart snapshot for a UTC Date.
 * opts: { ayanOffset, lat, lon, houseFrom: 'lagna'|'moon'|'fixed', fixedLagna: 0..11 }
 */
export function computeSnapshot(date, opts = {}) {
  const { ayanOffset = 0, lat = 19.076, lon = 72.8777, houseFrom = 'lagna', fixedLagna = 0 } = opts;
  const lons = siderealLongitudes(date, ayanOffset);
  const next = siderealLongitudes(new Date(date.getTime() + 6 * 3600 * 1000), ayanOffset); // for motion
  const ascLon = siderealAscendant(date, lat, lon, ayanOffset);
  const asc = describeLongitude(ascLon);

  let lagnaRashi;
  if (houseFrom === 'moon') lagnaRashi = describeLongitude(lons.Moon).rashi;
  else if (houseFrom === 'fixed') lagnaRashi = ((fixedLagna % 12) + 12) % 12;
  else lagnaRashi = asc.rashi;

  const sunLon = lons.Sun;
  const planets = {};
  for (const p of PLANETS) {
    const d = describeLongitude(lons[p]);
    let delta = norm360(next[p] - lons[p] + 180) - 180; // signed deg per 6h
    const speed = delta * 4; // deg/day
    const retro = p === 'Rahu' || p === 'Ketu' ? true : (p === 'Sun' || p === 'Moon' ? false : speed < 0);
    const house = ((d.rashi - lagnaRashi + 12) % 12) + 1;
    const sunDist = angDiff(lons[p], sunLon);
    const combust = COMBUST_ORB[p] !== undefined && p !== 'Moon' && sunDist < COMBUST_ORB[p] * (retro && (p === 'Mercury' || p === 'Venus') ? 0.85 : 1);
    planets[p] = {
      name: p, ...d, abhijit: isAbhijit(lons[p]), speed, retro, house,
      dignity: dignity(p, d.rashi), combust,
      sandhi: d.degInSign < 1 || d.degInSign >= 29,
      gandanta: false, // set below
    };
  }
  // Gandanta: last 3°20' of water signs (Karka, Vrischika, Meena) and first 3°20' of fire signs (Simha, Dhanu, Mesha)
  for (const p of PLANETS) {
    const pl = planets[p];
    const waterEnd = [3, 7, 11].includes(pl.rashi) && pl.degInSign >= 30 - PADA_SPAN;
    const fireStart = [4, 8, 0].includes(pl.rashi) && pl.degInSign < PADA_SPAN;
    pl.gandanta = waterEnd || fireStart;
  }

  // Tithi / weekday
  const elong = norm360(lons.Moon - lons.Sun);
  const tithi = Math.floor(elong / 12) + 1; // 1..30
  return { date, planets, asc, lagnaRashi, tithi, paksha: tithi <= 15 ? 'shukla' : 'krishna', elong };
}
