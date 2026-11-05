import { synthBars } from './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDataset, walkForward, featureTable, snapshotFor } from '../src/model.js';
import { runBacktest } from '../src/backtest.js';
import { DEFAULT_SETTINGS, mergeSettings } from '../src/settings.js';
import { explain } from '../src/live.js';

const settings = mergeSettings(DEFAULT_SETTINGS, { warmupDays: 500, blockDays: 63 });
const N = 2200;

// Synthetic market where "Moon in Rohini" adds +0.6 vol and "Moon in Jyeshtha" subtracts 0.6 vol (ground truth)
const truth = (d) => {
  const n = snapshotFor(d, settings).planets.Moon.nak;
  return n === 3 ? 0.6 : n === 17 ? -0.6 : 0;
};

test('engine recovers a planted Moon-nakshatra effect, out-of-sample', { timeout: 300000 }, () => {
  const bars = synthBars(N, truth, 11);
  const ds = buildDataset(bars, settings, []);
  const fast = walkForward(ds, settings, [], 'fast');
  const tab = featureTable(fast.state).filter((r) => r.id.startsWith('P|Moon|nak|'));
  const rohini = tab.find((r) => r.id === 'P|Moon|nak|3'), jye = tab.find((r) => r.id === 'P|Moon|nak|17');
  assert.ok(rohini && rohini.w > 0.1, `Rohini weight ${rohini && rohini.w}`);
  assert.ok(jye && jye.w < -0.1, `Jyeshtha weight ${jye && jye.w}`);
  const bt = runBacktest(ds.days, fast.S, null, { ...settings.strategy, mode: 'fast' });
  assert.ok(bt.strategy.sharpe > 1, `OOS sharpe ${bt.strategy.sharpe}`);
  assert.ok(bt.shift.p < 0.05, `shift p ${bt.shift.p}`);
  // live explanation works and agrees in sign
  const rohiniDay = bars.map((b) => b.d).find((d) => snapshotFor(d, settings).planets.Moon.nak === 3);
  const ex = explain(fast.state, rohiniDay, settings, []);
  assert.ok(ex.score > 0, `score on a Rohini day ${ex.score}`);
});

test('engine finds nothing on pure noise (no significant OOS edge)', { timeout: 300000 }, () => {
  const bars = synthBars(N, () => 0, 99);
  const ds = buildDataset(bars, settings, []);
  const fast = walkForward(ds, settings, [], 'fast');
  const bt = runBacktest(ds.days, fast.S, null, { ...settings.strategy, mode: 'fast' });
  assert.ok(bt.shift.p > 0.02, `noise looked significant: p=${bt.shift.p} sharpe=${bt.strategy.sharpe}`);
  assert.ok(Math.abs(bt.strategy.sharpe) < 1.5);
});

test('user rule acts as a prior and a locked rule is not overruled', { timeout: 300000 }, () => {
  const bars = synthBars(1400, () => 0, 5);
  const rules = [
    { name: 'Moon Rohini bull', when: [{ planet: 'Moon', nak: 'Rohini' }], direction: 1, strength: 0.2, confidence: 10, layer: 'fast' },
    { name: 'Locked bear', when: [{ planet: 'Moon', nak: 'Jyeshtha' }], direction: -1, strength: 0.3, lock: true, layer: 'fast' },
  ];
  const ds = buildDataset(bars, settings, rules);
  const fast = walkForward(ds, settings, rules, 'fast');
  const tab = featureTable(fast.state, { minEpisodes: 0 });
  const locked = tab.find((r) => r.id === 'R|Locked bear');
  assert.ok(locked && Math.abs(locked.w + 0.3) < 1e-9, `locked weight ${locked && locked.w}`);
  const free = tab.find((r) => r.id === 'R|Moon Rohini bull');
  assert.ok(free, 'free rule present');
  assert.ok(free.w < 0.2, `data on noise should pull prior down, got ${free.w}`);
});

test('walk-forward uses no future data: changing the last year does not change earlier scores', { timeout: 300000 }, () => {
  const a = synthBars(1500, truth, 3);
  const b = a.map((x, i) => (i > 1300 ? { ...x, c: x.o * 1.05 } : x));
  const dsA = buildDataset(a, settings, []), dsB = buildDataset(b, settings, []);
  const A = walkForward(dsA, settings, [], 'fast').S, B = walkForward(dsB, settings, [], 'fast').S;
  for (let t = 0; t < 1290; t++) {
    if (Number.isFinite(A[t])) assert.ok(Math.abs(A[t] - B[t]) < 1e-9, `leak at ${t}`);
    else assert.ok(!Number.isFinite(B[t]));
  }
});

test('date range only changes which days are evaluated, not the signals', { timeout: 300000 }, () => {
  const bars = synthBars(1600, truth, 8);
  const ds = buildDataset(bars, settings, []);
  const fast = walkForward(ds, settings, [], 'fast');
  const strat = { ...settings.strategy, mode: 'fast' };
  const full = runBacktest(ds.days, fast.S, null, strat, { shiftTrials: 0 });
  const from = ds.days[900].d, to = ds.days[1200].d;
  const part = runBacktest(ds.days, fast.S, null, strat, { shiftTrials: 0, from, to });
  for (let t = 0; t < ds.days.length; t++) {
    const inRange = ds.days[t].d >= from && ds.days[t].d <= to;
    if (inRange) assert.equal(part.pos[t], full.pos[t]); else assert.ok(!Number.isFinite(part.pos[t]));
  }
  assert.equal(part.strategy.days, 301);
});
