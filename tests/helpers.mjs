import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
// The vendored UMD build attaches itself to the global scope (package is "type": "module").
const loaded = require('../vendor/astronomy.browser.min.js');
if (!globalThis.Astronomy || !globalThis.Astronomy.MakeTime) globalThis.Astronomy = loaded;

// deterministic RNG
export function rng(seed = 1) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
export function randn(r) { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

/** SYNTHETIC bars for tests only. effect(dateStr) returns extra z added to the open->close move. */
export function synthBars(n, effect = () => 0, seed = 7) {
  const r = rng(seed); const bars = []; let px = 10000;
  let t = Date.UTC(2012, 0, 2);
  while (bars.length < n) {
    const dt = new Date(t); t += 86400000;
    if (dt.getUTCDay() === 0 || dt.getUTCDay() === 6) continue;
    const d = dt.toISOString().slice(0, 10);
    const o = px * (1 + 0.003 * randn(r));
    const c = o * (1 + 0.01 * (randn(r) + effect(d)));
    bars.push({ d, o, h: Math.max(o, c) * 1.002, l: Math.min(o, c) * 0.998, c });
    px = c;
  }
  return bars;
}
