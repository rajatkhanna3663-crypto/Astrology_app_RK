// Walk-forward learning engine.
//
// For every layer (fast / slow) the engine:
//   1. turns each past day into a z-scored target (return / trailing vol)
//   2. estimates, for every astro feature, the mean excess z when it is active, shrunk by the number of
//      INDEPENDENT episodes (not days) -> a Bayesian-style weight; user rules act as priors
//   3. every `blockDays` trading days re-estimates all weights using only data that was already known
//      (with an embargo of H days for overlapping targets) -> no look-ahead
//   4. after each block it measures how well every planet group predicted that block (information
//      coefficient) and scales the group multipliers up/down ("what changed -> what to trust").
import { computeSnapshot, AYANAMSA_PRESETS, PLANETS } from './jyotish.js';
import { extractFeatures, featureMeta } from './features.js';
import { ruleGroups } from './rules.js';

export class FeatureIndex {
  constructor() { this.ids = []; this.map = new Map(); }
  intern(id) { let i = this.map.get(id); if (i === undefined) { i = this.ids.length; this.ids.push(id); this.map.set(id, i); } return i; }
  get(id) { const i = this.map.get(id); return i === undefined ? -1 : i; }
}

const dateParts = (d) => d.split('-').map(Number);
export function snapshotDate(dStr, settings) {
  const [y, m, d] = dateParts(dStr);
  return new Date(Date.UTC(y, m - 1, d) + (settings.snapshotHourIST - 5.5) * 3600 * 1000);
}
export const snapOpts = (s) => ({
  ayanOffset: AYANAMSA_PRESETS[s.ayanamsa] ?? 0, lat: s.lat, lon: s.lon, houseFrom: s.houseFrom, fixedLagna: s.fixedLagna,
});
export const featCtx = (s, rules, dStr) => ({
  weekday: new Date(Date.UTC(...(([y, m, d]) => [y, m - 1, d])(dateParts(dStr)))).getUTCDay(),
  orbScale: s.orbScale, drishti: s.drishti, useAbhijit: s.useAbhijit, rules, enabled: s.families,
});

export function snapshotFor(dStr, settings) { return computeSnapshot(snapshotDate(dStr, settings), snapOpts(settings)); }

function* buildGen(bars, settings, rules) {
  const index = new FeatureIndex();
  const n = bars.length;
  const days = new Array(n);
  for (let t = 0; t < n; t++) {
    const b = bars[t];
    const snap = snapshotFor(b.d, settings);
    const f = extractFeatures(snap, featCtx(settings, rules, b.d));
    const fi = new Int32Array(f.length), fa = new Float32Array(f.length);
    f.forEach(([id, a], j) => { fi[j] = index.intern(id); fa[j] = a; });
    days[t] = { ...b, fi, fa };
    if (t % 100 === 0) yield t / n;
  }
  attachTargets(days, settings);
  return { days, index, rulesSig: JSON.stringify(rules), n };
}

/** bars: [{d:'YYYY-MM-DD', o,h,l,c}] ascending. Returns dataset with interned sparse features and z-targets. */
export function buildDataset(bars, settings, rules = [], onProgress) {
  const g = buildGen(bars, settings, rules);
  for (;;) { const r = g.next(); if (r.done) return r.value; onProgress && onProgress(r.value); }
}
/** Same, but yields to the event loop so the UI stays responsive on phones. */
export async function buildDatasetAsync(bars, settings, rules = [], onProgress) {
  const g = buildGen(bars, settings, rules);
  for (;;) {
    const r = g.next(); if (r.done) return r.value;
    onProgress && onProgress(r.value);
    await new Promise((res) => setTimeout(res, 0));
  }
}

/** return series + z targets (vol uses only PAST data) */
export function attachTargets(days, settings) {
  const n = days.length;
  const rOC = new Float64Array(n), rCC = new Float64Array(n);
  for (let t = 0; t < n; t++) {
    rOC[t] = Math.log(days[t].c / days[t].o);
    rCC[t] = t > 0 ? Math.log(days[t].c / days[t - 1].c) : NaN;
  }
  const trailingVol = (r, t, w = 60) => {
    let s = 0, s2 = 0, k = 0;
    for (let i = Math.max(0, t - w); i < t; i++) { if (!Number.isFinite(r[i])) continue; s += r[i]; s2 += r[i] * r[i]; k++; }
    if (k < 20) return NaN;
    const m = s / k;
    return Math.sqrt(Math.max(1e-12, s2 / k - m * m));
  };
  const H = settings.layers.slow.H;
  for (let t = 0; t < n; t++) {
    const vOC = trailingVol(rOC, t), vCC = trailingVol(rCC, t);
    const d = days[t];
    d.rOC = Math.expm1(rOC[t]);
    d.rCC = Number.isFinite(rCC[t]) ? Math.expm1(rCC[t]) : 0;
    d.zFast = Number.isFinite(vOC) ? clamp(rOC[t] / vOC, -4, 4) : NaN;
    if (t + H - 1 < n && Number.isFinite(vCC) && t > 0) {
      let s = 0; for (let k = 0; k < H; k++) s += rCC[t + k];
      d.zSlow = clamp(s / (vCC * Math.sqrt(H)), -4, 4);
    } else d.zSlow = NaN;
  }
}
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

function ruleRegistry(rules, layer) {
  const reg = new Map();
  for (const r of rules) {
    if (r.enabled === false) continue;
    const L = r.layer || 'both';
    reg.set(`R|${r.name}`, {
      active: L === 'both' || L === layer,
      mean0: (r.direction || 0) * (r.strength ?? 0.1),
      n0: r.confidence ?? 8,
      lock: Boolean(r.lock),
      groups: ruleGroups(r),
      direction: r.direction || 0,
    });
  }
  return reg;
}

class LayerState {
  constructor(layerName, cfg, dataset, rules, settings) {
    this.name = layerName; this.cfg = cfg; this.ds = dataset; this.settings = settings;
    this.reg = ruleRegistry(rules, layerName);
    const F = dataset.index.ids.length;
    this.n = new Float64Array(F); this.s1 = new Float64Array(F); this.s2 = new Float64Array(F);
    this.eps = new Float64Array(F); this.last = new Int32Array(F).fill(-10);
    this.N = 0; this.sumZ = 0; this.sumZ2 = 0;
    this.nextTrain = 0; // next day index to add to the accumulators
    this.mult = { ...cfg.priors };
    this.w = new Float64Array(F); // base weights (z per activation), before group multipliers
    this.info = new Array(F); // per feature: {groups, label, family, ne, t, m}
    this.fm = new Float64Array(F); // effective weight = w * geomean(group multipliers)
    this.groupsOf = null;
  }
  zOf(t) { const d = this.ds.days[t]; return this.name === 'fast' ? d.zFast : d.zSlow; }

  /** Add training samples with index < upto (and whose target window ended). */
  trainUpTo(upto) {
    const days = this.ds.days;
    for (; this.nextTrain < upto; this.nextTrain++) {
      const t = this.nextTrain, z = this.zOf(t);
      if (!Number.isFinite(z)) continue;
      this.N++; this.sumZ += z; this.sumZ2 += z * z;
      const d = days[t];
      for (let j = 0; j < d.fi.length; j++) {
        const f = d.fi[j], a = d.fa[j];
        this.n[f] += a; this.s1[f] += a * z; this.s2[f] += a * z * z;
        if (this.last[f] !== t - 1) this.eps[f] += 1;
        this.last[f] = t;
      }
    }
  }

  groupsFor(f) {
    if (!this.groupsOf) this.groupsOf = new Array(this.ds.index.ids.length);
    let g = this.groupsOf[f];
    if (!g) {
      const id = this.ds.index.ids[f];
      const rule = this.reg.get(id);
      const meta = featureMeta(id);
      g = (rule && rule.groups.length ? rule.groups : meta.groups.length ? meta.groups : ['Rules']);
      if (id.startsWith('R|') && !g.length) g = ['Rules'];
      this.groupsOf[f] = g;
    }
    return g;
  }

  /** recompute base weights from the accumulators */
  computeWeights() {
    const { cfg } = this;
    const F = this.ds.index.ids.length;
    const mu = this.N ? this.sumZ / this.N : 0;
    const varZ = this.N > 1 ? Math.max(1e-6, this.sumZ2 / this.N - mu * mu) : 1;
    const sd = Math.sqrt(varZ);
    for (let f = 0; f < F; f++) {
      const id = this.ds.index.ids[f];
      const rule = this.reg.get(id);
      if (rule && !rule.active) { this.w[f] = 0; this.info[f] = null; continue; }
      const mean0 = rule ? rule.mean0 : 0, n0 = rule ? rule.n0 : 0;
      if (rule && rule.lock) { this.w[f] = mean0; this.info[f] = { m: 0, ne: 0, t: 0, n: this.n[f], lock: true }; continue; }
      const nDays = this.n[f];
      let m = 0, t = 0;
      const ne = Math.max(0, this.eps[f]);
      if (nDays >= 3 && ne >= (cfg.minEp ?? 5)) {
        m = this.s1[f] / nDays - mu;
        t = m / (sd / Math.sqrt(ne));
      }
      const learned = Math.abs(t) >= cfg.tMin ? m : 0;
      const beta = (n0 * mean0 + ne * learned) / (n0 + ne + cfg.k);
      this.w[f] = beta;
      this.info[f] = { m, ne, t, n: nDays };
    }
    this.refreshEffective();
  }

  refreshEffective() {
    const F = this.ds.index.ids.length;
    for (let f = 0; f < F; f++) {
      const g = this.groupsFor(f);
      let lg = 0;
      for (const x of g) lg += Math.log(Math.max(1e-6, this.mult[x] ?? 0.5));
      this.fm[f] = this.w[f] * Math.exp(lg / g.length);
    }
  }

  scoreDay(t) { return this.scoreSparse(this.ds.days[t].fi, this.ds.days[t].fa); }
  scoreSparse(fi, fa) { let s = 0; for (let j = 0; j < fi.length; j++) { const f = fi[j]; if (f >= 0 && f < this.fm.length) s += fa[j] * this.fm[f]; } return s; }

  /** per-group contribution of one day */
  groupContrib(fi, fa) {
    const out = {};
    for (let j = 0; j < fi.length; j++) {
      const f = fi[j]; if (f < 0 || f >= this.fm.length) continue;
      const v = fa[j] * this.fm[f]; if (!v) continue;
      const g = this.groupsFor(f);
      for (const x of g) out[x] = (out[x] || 0) + v / g.length;
    }
    return out;
  }
}

function corr(xs, ys) {
  const n = xs.length; if (n < 8) return 0;
  let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

/**
 * Walk-forward run for one layer. Returns { S: Float64Array (NaN before warm-up), log, final, state }.
 */
export function walkForward(dataset, settings, rules, layerName, onProgress) {
  const cfg = settings.layers[layerName];
  const st = new LayerState(layerName, cfg, dataset, rules, settings);
  const n = dataset.n;
  const S = new Float64Array(n).fill(NaN);
  const log = [];
  const B = settings.blockDays, W = settings.warmupDays, H = cfg.H;
  let prevEff = null;
  const groupNames = Object.keys(cfg.priors);

  for (let b = W; b < n; b += B) {
    const e = Math.min(n, b + B);
    st.trainUpTo(Math.max(0, b - H + 1)); // embargo: only samples whose target window closed before b
    st.computeWeights();
    const entry = { block: log.length, start: dataset.days[b].d, end: dataset.days[e - 1].d, mult: { ...st.mult }, changes: [], multChanges: [] };
    if (prevEff) {
      const deltas = [];
      for (let f = 0; f < st.fm.length; f++) {
        const d = st.fm[f] - (prevEff[f] || 0);
        if (Math.abs(d) > 1e-4) deltas.push({ id: dataset.index.ids[f], d, now: st.fm[f] });
      }
      deltas.sort((a, b2) => Math.abs(b2.d) - Math.abs(a.d));
      entry.changes = deltas.slice(0, 6).map((x) => ({ ...x, label: featureMeta(x.id).label }));
    }
    prevEff = Float64Array.from(st.fm);

    // score the block with frozen weights
    const contribs = {}; groupNames.forEach((g) => { contribs[g] = []; });
    const zs = [];
    for (let t = b; t < e; t++) {
      S[t] = st.scoreDay(t);
      const z = st.zOf(t);
      // only days whose target window is complete by block end are used for adapting
      if (Number.isFinite(z) && t + H - 1 < e) {
        zs.push(z);
        const gc = st.groupContrib(dataset.days[t].fi, dataset.days[t].fa);
        groupNames.forEach((g) => contribs[g].push(gc[g] || 0));
      }
    }
    if (settings.adaptive && zs.length >= 20) {
      const neff = zs.length / H;
      for (const g of groupNames) {
        if (!contribs[g].some((v) => v !== 0)) continue;
        const ic = corr(contribs[g], zs);
        const score = clamp(ic * Math.sqrt(neff) * 1.0, -3, 3);
        const before = st.mult[g];
        let m = before * Math.exp(settings.eta * score / 3);
        m = Math.exp(0.9 * Math.log(m) + 0.1 * Math.log(Math.max(1e-6, cfg.priors[g])));
        m = clamp(m, 0.05, 3);
        st.mult[g] = m;
        if (Math.abs(m - before) > 0.02) entry.multChanges.push({ group: g, from: before, to: m, ic });
      }
      entry.multChanges.sort((a, b2) => Math.abs(b2.to - b2.from) - Math.abs(a.to - a.from));
    }
    log.push(entry);
    onProgress && onProgress((e) / n);
  }

  // final model trained on everything that has a complete target (for live use / in-sample comparison)
  st.trainUpTo(Math.max(0, n - H + 1));
  st.computeWeights();
  return { S, log, state: st };
}

/** In-sample score of the final model (for overfit comparison). */
export function inSampleScores(state) {
  const n = state.ds.n; const S = new Float64Array(n);
  for (let t = 0; t < n; t++) S[t] = state.scoreDay(t);
  return S;
}

/** Ranked feature table of a trained state. */
export function featureTable(state, { minEpisodes = 3 } = {}) {
  const rows = [];
  for (let f = 0; f < state.w.length; f++) {
    const inf = state.info[f]; if (!inf || (!inf.lock && inf.ne < minEpisodes)) continue;
    if (state.w[f] === 0) continue;
    const id = state.ds.index.ids[f];
    const meta = featureMeta(id);
    rows.push({ id, label: meta.label, family: meta.family, groups: state.groupsFor(f), w: state.w[f], eff: state.fm[f], t: inf.t, ne: inf.ne, days: inf.n, lock: inf.lock });
  }
  return rows;
}

export { PLANETS };
