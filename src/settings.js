import { DEFAULT_DRISHTI } from './aspects.js';

export const DEFAULT_SETTINGS = {
  // --- chart ---
  ayanamsa: 'lahiri',          // lahiri | kp | raman | fagan
  lat: 19.076, lon: 72.8777,   // Mumbai (NSE)
  snapshotHourIST: 9.25,       // 09:15 IST market open
  houseFrom: 'lagna',          // lagna (market-open ascendant) | moon | fixed
  fixedLagna: 0,               // used when houseFrom = fixed (0 = Mesha)
  orbScale: 1,
  useAbhijit: true,
  drishti: DEFAULT_DRISHTI,
  families: { position: true, vedic: true, western: true, sbc: true, calendar: true },

  // --- learning ---
  adaptive: true,              // let the engine re-weigh planet groups after every block
  eta: 0.35,                   // adaptation speed
  blockDays: 63,               // re-estimate every ~quarter
  warmupDays: 750,             // ~3 years of history before the first out-of-sample signal
  layers: {
    fast: {
      label: 'Fast (intraday / next-day)', H: 1, k: 6, tMin: 1.0, minEp: 5,
      priors: { Moon: 1, Venus: 0.8, Mars: 0.6, Sun: 0.3, Mercury: 0.3, Jupiter: 0.2, Saturn: 0.2, Rahu: 0.3, Ketu: 0.3, SBC: 0.5, Calendar: 0.4, Rules: 1 },
    },
    slow: {
      label: 'Slow (multi-week trend)', H: 20, k: 8, tMin: 1.0, minEp: 5,
      priors: { Saturn: 1, Jupiter: 1, Rahu: 0.5, Ketu: 0.5, Sun: 0.15, Moon: 0.1, Mars: 0.15, Mercury: 0.15, Venus: 0.15, SBC: 0.3, Calendar: 0.1, Rules: 1 },
    },
  },

  // --- strategy ---
  strategy: { mode: 'combined', thr: 0.3, posScale: 1.5, longOnly: false, costBps: 2, lambdaSlow: 0.5 },
};

export function mergeSettings(base, over) {
  if (Array.isArray(base) || base === null || typeof base !== 'object') return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = k in base ? mergeSettings(base[k], over[k]) : over[k];
  return out;
}
