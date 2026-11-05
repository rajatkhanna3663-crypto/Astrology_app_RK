// OHLC data: CSV parsing (Yahoo / NSE / generic) and tiny persistence helpers.
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

export function parseDate(s) {
  s = String(s).trim().replace(/"/g, '');
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/ ]([A-Za-z]{3})[a-z]*[-/ ](\d{4})$/); if (m) return iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/); if (m) return iso(+m[3], +m[2], +m[1]); // DD-MM-YYYY (Indian)
  return null;
}
const iso = (y, m, d) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null);

/** Parse CSV text -> [{d,o,h,l,c}] ascending, de-duplicated. Throws with a readable message on failure. */
export function parseCSV(text) {
  const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error('CSV is empty');
  const sep = lines[0].includes(';') && !lines[0].includes(',') ? ';' : ',';
  const split = (l) => l.split(sep).map((x) => x.trim().replace(/^"|"$/g, ''));
  const head = split(lines[0]).map((h) => h.toLowerCase());
  const find = (...names) => head.findIndex((h) => names.some((n) => h === n || h.startsWith(n)));
  const iD = find('date', 'timestamp'), iO = find('open'), iH = find('high'), iL = find('low');
  let iC = head.findIndex((h) => h === 'close' || h === 'close*' || h.startsWith('close'));
  if (iD < 0 || iO < 0 || iC < 0) throw new Error('Need columns: Date, Open, (High, Low,) Close');
  const num = (v) => { const x = parseFloat(String(v).replace(/,/g, '')); return Number.isFinite(x) ? x : NaN; };
  const map = new Map();
  for (let i = 1; i < lines.length; i++) {
    const c = split(lines[i]);
    const d = parseDate(c[iD]); const o = num(c[iO]), cl = num(c[iC]);
    if (!d || !(o > 0) || !(cl > 0)) continue;
    const h = iH >= 0 ? num(c[iH]) : Math.max(o, cl), l = iL >= 0 ? num(c[iL]) : Math.min(o, cl);
    map.set(d, { d, o, h: Number.isFinite(h) ? h : Math.max(o, cl), l: Number.isFinite(l) ? l : Math.min(o, cl), c: cl });
  }
  const bars = [...map.values()].sort((a, b) => (a.d < b.d ? -1 : 1));
  if (bars.length < 300) throw new Error(`Only ${bars.length} valid rows found — need at least ~300 (more is better: 5+ years)`);
  return bars;
}

export const toCSV = (bars) => 'Date,Open,High,Low,Close\n' + bars.map((b) => `${b.d},${b.o},${b.h},${b.l},${b.c}`).join('\n');

export function mergeBars(a, b) {
  const m = new Map(); for (const x of a) m.set(x.d, x); for (const x of b) m.set(x.d, x);
  return [...m.values()].sort((p, q) => (p.d < q.d ? -1 : 1));
}

const mem = new Map();
export const store = {
  get(k, fallback = null) { try { const v = localStorage.getItem(k); return v === null ? (mem.has(k) ? mem.get(k) : fallback) : JSON.parse(v); } catch { return mem.has(k) ? mem.get(k) : fallback; } },
  set(k, v) { mem.set(k, v); try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  getText(k) { try { return localStorage.getItem(k); } catch { return mem.get(k) ?? null; } },
  setText(k, v) { mem.set(k, v); try { localStorage.setItem(k, v); return true; } catch { return false; } },
};

export function istToday() {
  const t = new Date(Date.now() + 5.5 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}
export function nextTradingDays(fromIso, count) {
  const out = []; const [y, m, d] = fromIso.split('-').map(Number);
  let t = Date.UTC(y, m - 1, d);
  while (out.length < count) { const wd = new Date(t).getUTCDay(); if (wd !== 0 && wd !== 6) out.push(new Date(t).toISOString().slice(0, 10)); t += 86400000; }
  return out;
}
