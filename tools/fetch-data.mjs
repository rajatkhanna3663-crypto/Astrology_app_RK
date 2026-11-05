// Downloads daily OHLC from Yahoo Finance into data/<key>.csv  (runs in GitHub Actions or on your computer).
//   node tools/fetch-data.mjs            -> banknifty + nifty
// Exits 0 even when a download fails so the site still deploys with the last data it has.
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SYMBOLS = { banknifty: '^NSEBANK', nifty: '^NSEI' };
fs.mkdirSync(path.join(root, 'data'), { recursive: true });
for (const [key, sym] of Object.entries(SYMBOLS)) {
  try {
    const p1 = Math.floor(Date.UTC(2007, 8, 1) / 1000), p2 = Math.floor(Date.now() / 1000) + 86400;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d&events=history`;
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; astro-lab-data-fetch)' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json(); const res = j.chart.result[0], q = res.indicators.quote[0];
    const rows = [];
    res.timestamp.forEach((ts, i) => {
      if (q.open[i] == null || q.close[i] == null) return;
      const d = new Date((ts + 5.5 * 3600) * 1000).toISOString().slice(0, 10); // IST calendar date
      rows.push(`${d},${q.open[i].toFixed(2)},${q.high[i].toFixed(2)},${q.low[i].toFixed(2)},${q.close[i].toFixed(2)}`);
    });
    if (rows.length < 500) throw new Error(`only ${rows.length} rows`);
    fs.writeFileSync(path.join(root, 'data', `${key}.csv`), 'Date,Open,High,Low,Close\n' + rows.join('\n') + '\n');
    console.log(`${key}: ${rows.length} rows`);
  } catch (e) { console.warn(`${key}: fetch failed (${e.message}) — keeping existing file if any`); }
}
