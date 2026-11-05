// User-defined astrology rules. A rule is a JSON object:
// {
//   "name": "Moon in Rohini + Venus strong",
//   "when": [                                   // all clauses must hold (AND)
//     { "planet": "Moon", "nak": "Rohini" },
//     { "planet": "Venus", "house": [1, 4, 7, 10], "retro": false },
//     { "aspect": "vedic", "from": "Saturn", "to": "Moon" },
//     { "aspect": "western", "a": "Moon", "b": "Mars", "type": "sq" },
//     { "sbc": { "from": "Saturn", "to": "Moon" } },
//     { "tithi": [8, 23] }, { "weekday": [1] },
//     { "not": { "planet": "Mercury", "combust": true } }
//   ],
//   "direction": 1,        // prior belief: +1 bullish, -1 bearish, 0 = "interesting, no view"
//   "strength": 0.15,      // prior effect in units of 1 daily-vol (z). 0.1~0.2 is already large
//   "confidence": 10,      // prior weight in "independent observations"; higher = data needs more evidence to overrule
//   "lock": false,         // true => weight pinned to the prior, never learned
//   "layer": "both"        // "fast" | "slow" | "both"
// }
// Planet clause fields: rashi, nak, pada, house, nakLord, dignity (exalted|debilitated|own|neutral),
// retro, combust, sandhi, gandanta (booleans), deg: [min,max] degrees within sign.
import { RASHIS, NAKSHATRAS, PLANETS } from './jyotish.js';
import { vedicAspects, westernAspects } from './aspects.js';

const lc = (s) => String(s).trim().toLowerCase();
const RES = {
  rashi: (v) => (typeof v === 'number' ? v - 1 : RASHIS.findIndex((r) => lc(r) === lc(v))), // numbers are 1..12 for rashi
  nak: (v) => (typeof v === 'number' ? v - 1 : NAKSHATRAS.findIndex((r) => lc(r) === lc(v))), // 1..27
};

function asList(spec) {
  if (spec && typeof spec === 'object' && !Array.isArray(spec) && spec.in) return spec.in;
  return Array.isArray(spec) ? spec : [spec];
}

function planetClause(c, snap) {
  const pl = snap.planets[c.planet];
  if (!pl) return false;
  for (const [k, spec] of Object.entries(c)) {
    if (k === 'planet') continue;
    if (k === 'rashi') { if (!asList(spec).some((v) => RES.rashi(v) === pl.rashi)) return false; }
    else if (k === 'nak') {
      if (!asList(spec).some((v) => RES.nak(v) === pl.nak || (lc(v) === 'abhijit' && pl.abhijit))) return false;
    } else if (k === 'pada') { if (!asList(spec).includes(pl.pada)) return false; }
    else if (k === 'house') { if (!asList(spec).includes(pl.house)) return false; }
    else if (k === 'nakLord') { if (!asList(spec).map(lc).includes(lc(pl.nakLord))) return false; }
    else if (k === 'dignity') { if (!asList(spec).map(lc).includes(pl.dignity)) return false; }
    else if (['retro', 'combust', 'sandhi', 'gandanta'].includes(k)) { if (Boolean(pl[k]) !== Boolean(spec)) return false; }
    else if (k === 'deg') { if (pl.degInSign < spec[0] || pl.degInSign >= spec[1]) return false; }
    else return false; // unknown key => never fires (safer than silently ignoring)
  }
  return true;
}

function clauseHolds(c, ctx) {
  const { snap, weekday } = ctx;
  if (c.not) return !clauseHolds(c.not, ctx);
  if (c.planet) return planetClause(c, snap);
  if (c.aspect === 'vedic') {
    return vedicAspects(snap, ctx.drishti).some((a) => a.kind === 'aspect' && a.from === c.from && a.to === c.to);
  }
  if (c.aspect === 'western') {
    const strength = westernAspects(snap, ctx.orbScale).find(
      (a) => ((a.a === c.a && a.b === c.b) || (a.a === c.b && a.b === c.a)) && (!c.type || a.type === c.type));
    return Boolean(strength);
  }
  if (c.sbc) return ctx.sbc.vedha.some((v) => v.via === 'nak' && v.from === c.sbc.from && v.to === c.sbc.to);
  if (c.tithi) return asList(c.tithi).includes(snap.tithi);
  if (c.weekday !== undefined) return asList(c.weekday).includes(weekday);
  return false;
}

export function ruleHolds(rule, ctx) {
  const clauses = rule.when || [];
  return clauses.length > 0 && clauses.every((c) => clauseHolds(c, ctx));
}

export function evaluateRules(rules, ctx) {
  const out = [];
  for (const r of rules) if (r.enabled !== false && ruleHolds(r, ctx)) out.push({ name: r.name, strength: 1 });
  return out;
}

/** Planets referenced by a rule -> used for attributing its weight to planet groups. */
export function ruleGroups(rule) {
  const s = new Set();
  const walk = (c) => {
    if (!c) return;
    if (c.not) return walk(c.not);
    if (c.planet) s.add(c.planet);
    if (c.from) s.add(c.from);
    if (c.to) s.add(c.to);
    if (c.a) s.add(c.a);
    if (c.b) s.add(c.b);
    if (c.sbc) { s.add(c.sbc.from); s.add(c.sbc.to); s.add('SBC'); }
    if (c.tithi !== undefined || c.weekday !== undefined) s.add('Calendar');
  };
  (rule.when || []).forEach(walk);
  return [...s].filter((x) => PLANETS.includes(x) || x === 'SBC' || x === 'Calendar');
}

export function validateRule(r) {
  const errs = [];
  if (!r || typeof r !== 'object') return ['rule must be an object'];
  if (!r.name || typeof r.name !== 'string') errs.push('name missing');
  if (!Array.isArray(r.when) || !r.when.length) errs.push('"when" needs at least one clause');
  for (const c of r.when || []) {
    if (c.planet && !PLANETS.includes(c.planet)) errs.push(`unknown planet ${c.planet}`);
    if (c.planet && c.rashi !== undefined && asList(c.rashi).some((v) => RES.rashi(v) < 0)) errs.push(`unknown rashi in ${r.name}`);
    if (c.planet && c.nak !== undefined && asList(c.nak).some((v) => RES.nak(v) < 0 && lc(v) !== 'abhijit')) errs.push(`unknown nakshatra in ${r.name}`);
  }
  if (r.direction !== undefined && ![-1, 0, 1].includes(r.direction)) errs.push('direction must be -1, 0 or 1');
  return errs;
}

export const EXAMPLE_RULES = [
  {
    name: 'Moon in Rohini',
    when: [{ planet: 'Moon', nak: 'Rohini' }],
    direction: 1, strength: 0.12, confidence: 8, layer: 'fast',
  },
  {
    name: 'Saturn aspects Moon (vedic)',
    when: [{ aspect: 'vedic', from: 'Saturn', to: 'Moon' }],
    direction: -1, strength: 0.1, confidence: 8, layer: 'fast',
  },
];
