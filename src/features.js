// Turns a chart snapshot into sparse feature activations: [[featureId, activation 0..1], ...]
// Feature id format:  KIND|part|part...    (see featureMeta for decoding)
import { PLANETS, RASHIS, NAKSHATRAS, MALEFICS, BENEFICS } from './jyotish.js';
import { vedicAspects, westernAspects, DEFAULT_DRISHTI } from './aspects.js';
import { sbcAnalysis, nakNameOf } from './sarvatobhadra.js';
import { evaluateRules } from './rules.js';

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function extractFeatures(snap, ctx = {}) {
  const {
    weekday = snap.date.getUTCDay(), orbScale = 1, drishti = DEFAULT_DRISHTI,
    useAbhijit = true, rules = [], enabled = { position: true, vedic: true, western: true, sbc: true, calendar: true },
  } = ctx;
  const f = [];
  const push = (id, a = 1) => { f.push([id, a]); };

  if (enabled.position !== false) {
    for (const p of PLANETS) {
      const pl = snap.planets[p];
      push(`P|${p}|rashi|${pl.rashi}`);
      push(`P|${p}|nak|${pl.nak}`);
      push(`P|${p}|pada|${pl.pada}`);
      push(`P|${p}|nakpada|${pl.nak}.${pl.pada}`);
      push(`P|${p}|house|${pl.house}`);
      push(`P|${p}|deg|${Math.min(5, Math.floor(pl.degInSign / 5))}`);
      push(`P|${p}|nakLord|${pl.nakLord}`);
      if (pl.retro && p !== 'Rahu' && p !== 'Ketu') push(`P|${p}|flag|retro`);
      if (pl.combust) push(`P|${p}|flag|combust`);
      if (pl.sandhi) push(`P|${p}|flag|sandhi`);
      if (pl.gandanta) push(`P|${p}|flag|gandanta`);
      if (pl.dignity !== 'neutral') push(`P|${p}|dig|${pl.dignity}`);
    }
  }

  if (enabled.vedic !== false) {
    for (const a of vedicAspects(snap, drishti)) {
      push(a.kind === 'conj' ? `V|${a.from}~${a.to}` : `V|${a.from}>${a.to}`);
    }
  }

  if (enabled.western !== false) {
    for (const a of westernAspects(snap, orbScale)) push(`W|${a.a}-${a.b}|${a.type}`, a.strength);
  }

  let sbc = null;
  if (enabled.sbc !== false) {
    sbc = sbcAnalysis(snap, { useAbhijit });
    const malCount = {}, benCount = {};
    for (const v of sbc.vedha) {
      if (v.via === 'nak') push(`S|${v.from}>${v.to}`);
      if (MALEFICS.includes(v.from)) malCount[v.to] = (malCount[v.to] || 0) + 1;
      if (BENEFICS.includes(v.from)) benCount[v.to] = (benCount[v.to] || 0) + 1;
    }
    for (const p of PLANETS) {
      if (malCount[p]) push(`Sm|${p}`, Math.min(1, malCount[p] / 3));
      if (benCount[p]) push(`Sb|${p}`, Math.min(1, benCount[p] / 3));
    }
  }

  if (enabled.calendar !== false) {
    push(`T|tithi|${snap.tithi}`);
    push(`T|paksha|${snap.paksha}`);
    push(`T|wd|${weekday}`);
  }

  if (rules.length) {
    const ctx2 = { snap, weekday, orbScale, drishti, sbc: sbc || sbcAnalysis(snap, { useAbhijit }) };
    for (const r of evaluateRules(rules, ctx2)) push(`R|${r.name}`, r.strength ?? 1);
  }
  return f;
}

const RASHI_SHORT = RASHIS;
/** Decode an id into { groups: [planetsOrCalendar], label } */
export function featureMeta(id) {
  const parts = id.split('|');
  const k = parts[0];
  if (k === 'P') {
    const [, p, what, val, val2] = parts;
    let label;
    if (what === 'rashi') label = `${p} in ${RASHI_SHORT[+val]}`;
    else if (what === 'nak') label = `${p} in ${NAKSHATRAS[+val]}`;
    else if (what === 'pada') label = `${p} in pada ${val}`;
    else if (what === 'nakpada') { const [n, pd] = val.split('.'); label = `${p} in ${NAKSHATRAS[+n]} pada ${pd}`; }
    else if (what === 'house') label = `${p} in house ${val}`;
    else if (what === 'deg') label = `${p} at ${val * 5}°–${val * 5 + 5}° of sign`;
    else if (what === 'nakLord') label = `${p} in nakshatra ruled by ${val}`;
    else if (what === 'flag') label = `${p} ${val}`;
    else if (what === 'dig') label = `${p} ${val}`;
    else label = id;
    return { groups: [p], label, family: 'position' };
  }
  if (k === 'V') {
    const m = parts[1].match(/^(\w+)([>~])(\w+)$/);
    return { groups: [m[1], m[3]], label: m[2] === '>' ? `${m[1]} aspects ${m[3]} (vedic)` : `${m[1]}+${m[3]} same rashi`, family: 'vedic' };
  }
  if (k === 'W') {
    const [a, b] = parts[1].split('-');
    return { groups: [a, b], label: `${a} ${parts[2]} ${b} (western)`, family: 'western' };
  }
  if (k === 'S') {
    const m = parts[1].match(/^(\w+)>(\w+)$/);
    return { groups: [m[1], m[2], 'SBC'], label: `SBC: ${m[1]} vedha on ${m[2]}`, family: 'sbc' };
  }
  if (k === 'Sm' || k === 'Sb') {
    return { groups: [parts[1], 'SBC'], label: `SBC: ${k === 'Sm' ? 'malefic' : 'benefic'} vedha on ${parts[1]}`, family: 'sbc' };
  }
  if (k === 'T') {
    if (parts[1] === 'tithi') return { groups: ['Calendar'], label: `Tithi ${parts[2]}`, family: 'calendar' };
    if (parts[1] === 'paksha') return { groups: ['Calendar'], label: `${parts[2]} paksha`, family: 'calendar' };
    return { groups: ['Calendar'], label: `Weekday ${WEEKDAYS[+parts[2]]}`, family: 'calendar' };
  }
  if (k === 'R') return { groups: ['Rules'], label: `Rule: ${parts[1]}`, family: 'rule' };
  return { groups: [], label: id, family: 'other' };
}

export { nakNameOf };
