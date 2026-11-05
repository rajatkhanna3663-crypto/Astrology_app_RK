// Live view: today's chart, current signal with explanation, and forward outlook (planets are deterministic).
import { snapshotFor, featCtx } from './model.js';
import { extractFeatures, featureMeta } from './features.js';
import { vedicAspects, westernAspects } from './aspects.js';
import { sbcAnalysis } from './sarvatobhadra.js';
import { normaliseScores } from './backtest.js';

function sparseFor(dStr, settings, rules, index) {
  const snap = snapshotFor(dStr, settings);
  const feats = extractFeatures(snap, featCtx(settings, rules, dStr));
  const fi = [], fa = [], unseen = [];
  for (const [id, a] of feats) { const i = index.get(id); if (i >= 0) { fi.push(i); fa.push(a); } else unseen.push(id); }
  return { snap, fi: Int32Array.from(fi), fa: Float32Array.from(fa), unseen };
}

/** score a date with one trained layer state; returns score + top contributors */
export function explain(state, dStr, settings, rules) {
  const { snap, fi, fa } = sparseFor(dStr, settings, rules, state.ds.index);
  const score = state.scoreSparse(fi, fa);
  const contrib = [];
  for (let j = 0; j < fi.length; j++) {
    const v = fa[j] * state.fm[fi[j]];
    if (v) { const id = state.ds.index.ids[fi[j]]; contrib.push({ id, label: featureMeta(id).label, v, groups: state.groupsFor(fi[j]) }); }
  }
  contrib.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  return { snap, score, contrib, groups: state.groupContrib(fi, fa) };
}

export function chartDetails(snap, settings) {
  return {
    vedic: vedicAspects(snap, settings.drishti),
    western: westernAspects(snap, settings.orbScale),
    sbc: sbcAnalysis(snap, { useAbhijit: settings.useAbhijit }),
  };
}

/** Normalise a raw score by the std of the layer's historical out-of-sample scores */
export function scoreStats(S) {
  const v = []; for (const x of S) if (Number.isFinite(x)) v.push(x);
  if (v.length < 30) return { mean: 0, sd: 1 };
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) || 1;
  return { mean: m, sd };
}
export { normaliseScores };
