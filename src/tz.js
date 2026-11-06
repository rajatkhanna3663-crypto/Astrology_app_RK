// IANA time zone helpers via Intl (handles DST and historical offsets, e.g. India before 1947).
const cache = new Map();
function fmt(zone) {
  if (!cache.has(zone)) cache.set(zone, new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }));
  return cache.get(zone);
}
/** UTC offset in ms of `zone` at the instant `utc`. */
export function offsetMs(utc, zone) {
  const p = {}; for (const x of fmt(zone).formatToParts(new Date(Math.floor(utc / 1000) * 1000))) p[x.type] = +x.value;
  const d = new Date(0); d.setUTCFullYear(p.year, p.month - 1, p.day); d.setUTCHours(p.hour, p.minute, p.second, 0);
  return d.getTime() - Math.floor(utc / 1000) * 1000;
}
/** Wall-clock time (given as if it were UTC) in `zone` -> real UTC ms. */
export function localToUtc(wallMs, zone) {
  let u = wallMs - offsetMs(wallMs, zone);
  u = wallMs - offsetMs(u, zone);
  return u;
}
export function tzLabel(utc, zone) {
  const m = Math.round(offsetMs(utc, zone) / 60000), a = Math.abs(m);
  return `UTC${m < 0 ? '-' : '+'}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}
const p2 = (n) => String(n).padStart(2, '0');
export function toInputValue(utc, zone) {
  const d = new Date(utc + offsetMs(utc, zone));
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
}
export function fromInputValue(s, zone) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(s || '');
  if (!m) return NaN;
  const d = new Date(0); d.setUTCFullYear(+m[1], +m[2] - 1, +m[3]); d.setUTCHours(+m[4], +m[5], 0, 0);
  return localToUtc(d.getTime(), zone);
}
