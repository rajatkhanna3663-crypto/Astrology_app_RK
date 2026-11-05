// Vedic (graha drishti, sign based) and western (longitude based) aspects.
import { PLANETS, angDiff } from './jyotish.js';

// Houses counted from the aspecting planet's sign (1 = same sign).
export const DEFAULT_DRISHTI = {
  Sun: [7], Moon: [7], Mercury: [7], Venus: [7],
  Mars: [4, 7, 8], Jupiter: [5, 7, 9], Saturn: [3, 7, 10],
  Rahu: [5, 7, 9], Ketu: [5, 7, 9],
};

/** Returns [{from,to,kind:'aspect'|'conj', houseCount}] */
export function vedicAspects(snapshot, drishti = DEFAULT_DRISHTI) {
  const out = [];
  for (const a of PLANETS) {
    for (const b of PLANETS) {
      if (a === b) continue;
      const pa = snapshot.planets[a], pb = snapshot.planets[b];
      const count = ((pb.rashi - pa.rashi + 12) % 12) + 1;
      if (count === 1) { if (a < b) out.push({ from: a, to: b, kind: 'conj', houseCount: 1 }); continue; }
      if ((drishti[a] || [7]).includes(count)) out.push({ from: a, to: b, kind: 'aspect', houseCount: count });
    }
  }
  return out;
}

export const WESTERN = [
  { name: 'conj', angle: 0, orb: 6 },
  { name: 'sext', angle: 60, orb: 3 },
  { name: 'sq', angle: 90, orb: 5 },
  { name: 'tri', angle: 120, orb: 5 },
  { name: 'opp', angle: 180, orb: 6 },
];

/** Returns [{a,b,type,orb,strength}] strength in (0,1] — 1 is exact. Pairs are unordered, ordered by PLANETS index. */
export function westernAspects(snapshot, orbScale = 1, defs = WESTERN) {
  const out = [];
  for (let i = 0; i < PLANETS.length; i++) {
    for (let j = i + 1; j < PLANETS.length; j++) {
      const a = PLANETS[i], b = PLANETS[j];
      if ((a === 'Rahu' && b === 'Ketu')) continue; // always exactly opposite
      const d = angDiff(snapshot.planets[a].lon, snapshot.planets[b].lon);
      for (const def of defs) {
        const orb = Math.abs(d - def.angle);
        const max = def.orb * orbScale;
        if (orb <= max) out.push({ a, b, type: def.name, orb, strength: 1 - orb / max });
      }
    }
  }
  return out;
}
