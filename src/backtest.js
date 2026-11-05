// Turns layer scores into positions and measures performance. All scores come from walk-forward runs,
// so everything reported here is out-of-sample unless it says "in-sample".

const std = (a) => { const n = a.length; if (n < 2) return 0; let m = 0; for (const x of a) m += x; m /= n; let s = 0; for (const x of a) s += (x - m) ** 2; return Math.sqrt(s / (n - 1)); };

/** expanding-std normalisation of a score series (uses only past values) */
export function normaliseScores(S, minPast = 60) {
  const out = new Float64Array(S.length).fill(NaN);
  let n = 0, s = 0, s2 = 0;
  for (let t = 0; t < S.length; t++) {
    if (!Number.isFinite(S[t])) continue;
    if (n >= minPast) { const m = s / n, sd = Math.sqrt(Math.max(1e-12, s2 / n - m * m)); out[t] = (S[t] - m) / sd; }
    n++; s += S[t]; s2 += S[t] * S[t];
  }
  return out;
}

export function makePositions(x, strat) {
  const pos = new Float64Array(x.length);
  for (let t = 0; t < x.length; t++) {
    if (!Number.isFinite(x[t])) { pos[t] = NaN; continue; }
    let p = Math.abs(x[t]) < strat.thr ? 0 : Math.max(-1, Math.min(1, x[t] / strat.posScale));
    if (strat.longOnly) p = Math.max(0, p);
    pos[t] = p;
  }
  return pos;
}

/** combine layer scores into one normalised signal x */
export function combineSignal(Sfast, Sslow, strat) {
  const xf = Sfast ? normaliseScores(Sfast) : null;
  const xs = Sslow ? normaliseScores(Sslow) : null;
  const n = (xf || xs).length;
  const x = new Float64Array(n).fill(NaN);
  for (let t = 0; t < n; t++) {
    if (strat.mode === 'fast') x[t] = xf ? xf[t] : NaN;
    else if (strat.mode === 'slow') x[t] = xs ? xs[t] : NaN;
    else {
      const a = xf ? xf[t] : NaN, b = xs ? xs[t] : NaN;
      if (Number.isFinite(a) && Number.isFinite(b)) x[t] = a + strat.lambdaSlow * b;
      else if (Number.isFinite(a)) x[t] = a; else x[t] = b;
    }
  }
  return x;
}

export function pnlSeries(days, pos, strat) {
  const n = days.length, pnl = new Float64Array(n).fill(NaN);
  const cost = strat.costBps / 1e4;
  let prev = 0;
  for (let t = 0; t < n; t++) {
    if (!Number.isFinite(pos[t])) continue;
    const r = strat.mode === 'slow' ? days[t].rCC : days[t].rOC;
    pnl[t] = pos[t] * r - cost * Math.abs(pos[t] - prev);
    prev = pos[t];
  }
  return pnl;
}

function stats(pnl, pos, dates) {
  const idx = []; for (let t = 0; t < pnl.length; t++) if (Number.isFinite(pnl[t])) idx.push(t);
  if (!idx.length) return null;
  const r = idx.map((t) => pnl[t]);
  let eq = 1, peak = 1, mdd = 0; const curve = [];
  for (const t of idx) { eq *= 1 + pnl[t]; peak = Math.max(peak, eq); mdd = Math.min(mdd, eq / peak - 1); curve.push([dates[t], eq]); }
  const mean = r.reduce((a, b) => a + b, 0) / r.length, sd = std(r);
  const traded = idx.filter((t) => Math.abs(pos[t]) > 1e-9);
  const wins = traded.filter((t) => pnl[t] > 0).length;
  const years = r.length / 252;
  return {
    days: r.length, tradedDays: traded.length, exposure: traded.length / r.length,
    totalReturn: eq - 1, cagr: years > 0 ? Math.pow(eq, 1 / years) - 1 : 0,
    sharpe: sd > 0 ? (mean / sd) * Math.sqrt(252) : 0, maxDD: mdd,
    hitRate: traded.length ? wins / traded.length : 0,
    avgTrade: traded.length ? traded.reduce((a, t) => a + pnl[t], 0) / traded.length : 0,
    curve,
  };
}

function directional(x, days, mode) {
  let hit = 0, n = 0;
  for (let t = 0; t < x.length; t++) {
    if (!Number.isFinite(x[t]) || Math.abs(x[t]) < 1e-9) continue;
    const r = mode === 'slow' ? days[t].rCC : days[t].rOC;
    if (r === 0) continue;
    n++; if (Math.sign(x[t]) === Math.sign(r)) hit++;
  }
  return { n, acc: n ? hit / n : 0 };
}

/** circular-shift test: how often does the same position pattern, misaligned with returns, do as well? */
export function shiftPValue(days, pos, strat, trials = 200, seed = 12345) {
  const idx = []; for (let t = 0; t < pos.length; t++) if (Number.isFinite(pos[t])) idx.push(t);
  if (idx.length < 100) return null;
  const rets = idx.map((t) => (strat.mode === 'slow' ? days[t].rCC : days[t].rOC));
  const p = idx.map((t) => pos[t]);
  const sharpe = (shift) => {
    const pn = []; let prev = 0; const c = strat.costBps / 1e4;
    for (let i = 0; i < p.length; i++) { const pp = p[(i + shift) % p.length]; pn.push(pp * rets[i] - c * Math.abs(pp - prev)); prev = pp; }
    const sd = std(pn); return sd > 0 ? (pn.reduce((a, b) => a + b, 0) / pn.length) / sd * Math.sqrt(252) : 0;
  };
  const actual = sharpe(0);
  let s = seed >>> 0; const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  let ge = 0;
  for (let k = 0; k < trials; k++) { const sh = 20 + Math.floor(rnd() * (p.length - 40)); if (sharpe(sh) >= actual) ge++; }
  return { actual, p: (ge + 1) / (trials + 1) };
}

export function yearly(days, pnl) {
  const by = {};
  for (let t = 0; t < pnl.length; t++) {
    if (!Number.isFinite(pnl[t])) continue;
    const y = days[t].d.slice(0, 4);
    (by[y] ||= { eq: 1, n: 0 }); by[y].eq *= 1 + pnl[t]; by[y].n++;
  }
  return Object.entries(by).map(([y, v]) => ({ year: y, ret: v.eq - 1, n: v.n }));
}

export function runBacktest(days, Sfast, Sslow, strat, { shiftTrials = 200, from = '', to = '' } = {}) {
  const dates = days.map((d) => d.d);
  const x = combineSignal(Sfast, Sslow, strat); // normalised on ALL past scores (no look-ahead), then we only evaluate inside [from,to]
  const pos = makePositions(x, strat);
  for (let t = 0; t < pos.length; t++) if ((from && dates[t] < from) || (to && dates[t] > to)) pos[t] = NaN;
  const pnl = pnlSeries(days, pos, strat);
  const first = pos.findIndex((v) => Number.isFinite(v));
  // buy & hold over the same window
  const bh = new Float64Array(days.length).fill(NaN);
  for (let t = Math.max(0, first); t < days.length; t++) bh[t] = strat.mode === 'slow' ? days[t].rCC : days[t].rOC;
  const bhPos = new Float64Array(days.length).fill(NaN); for (let t = first; t < days.length; t++) bhPos[t] = 1;
  return {
    x, pos, pnl, dates,
    strategy: stats(pnl, pos, dates),
    buyHold: stats(bh, bhPos, dates),
    direction: directional(x, days, strat.mode),
    shift: shiftPValue(days, pos, strat, shiftTrials),
    yearly: yearly(days, pnl),
  };
}
