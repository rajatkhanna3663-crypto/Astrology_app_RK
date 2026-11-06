import { RASHIS, NAKSHATRAS, PLANETS, ROT_BASES, computeChart, houseGrid, houseOf, describeRotation, stepTime, clampUtc, MIN } from './astro.js';
import { CITIES } from './cities.js';
import { chartSVG } from './chart.js';
import { toInputValue, fromInputValue, tzLabel } from './tz.js';

const $ = (id) => document.getElementById(id);
const UNITS = [['min', 'Min'], ['hour', 'Hour'], ['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['year', 'Year']];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const KEY = 'kundli-state';

let S = { utc: clampUtc(Date.now()), city: CITIES.findIndex((c) => c[1] === 'Mumbai'), unit: 'hour', n: 1, base: 'Lagna', house: 1 };
try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch { /* private mode */ }
if (!CITIES[S.city] || !(ROT_BASES.includes(S.base) || (S.base === 'Fixed' && Array.isArray(S.fix) && S.fix.length === 2)) || !(S.house >= 1 && S.house <= 12) || !UNITS.some((u) => u[0] === S.unit) || !Number.isFinite(S.utc)) S = { ...S, utc: clampUtc(Date.now()), city: 0, unit: 'hour', n: 1, base: 'Lagna', house: 1 };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* ignore */ } };
const place = () => { const c = CITIES[S.city]; return { name: `${c[1]}, ${c[0]}`, lat: c[2], lon: c[3], zone: c[4] }; };
const fmtDeg = (d) => `${Math.floor(d)}°${String(Math.floor((d % 1) * 60)).padStart(2, '0')}′`;

// ---- static controls
const placeSel = $('place');
for (const country of [...new Set(CITIES.map((c) => c[0]))]) {
  const g = document.createElement('optgroup'); g.label = country;
  CITIES.forEach((c, i) => { if (c[0] === country) g.append(new Option(c[1], i)); });
  placeSel.append(g);
}
$('amount').append(...[1, 2, 3, 5, 10, 15, 30].map((n) => new Option(`× ${n}`, n)));
const unitBtns = UNITS.map(([u, label]) => { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { S.unit = u; update(); }; $('units').append(b); return b; });

function step(sign) {
  const t = stepTime(S.utc, place().zone, S.unit, sign * S.n);
  if (t === S.utc) return false;
  S.utc = t; update(); return true;
}
let hold1, hold2;
const stopHold = () => { clearTimeout(hold1); clearInterval(hold2); };
for (const [id, sign] of [['back', -1], ['fwd', 1]]) {
  const b = $(id);
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); stopHold(); if (step(sign)) hold1 = setTimeout(() => { hold2 = setInterval(() => { if (!step(sign)) stopHold(); }, 130); }, 420); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, stopHold);
  b.addEventListener('click', (e) => { if (e.detail === 0) step(sign); }); // keyboard
  b.addEventListener('contextmenu', (e) => e.preventDefault());
}
$('now').onclick = () => { S.utc = clampUtc(Date.now()); update(); };
$('dt').onchange = (e) => { const t = fromInputValue(e.target.value, place().zone); if (Number.isFinite(t)) S.utc = clampUtc(t); update(); };
$('amount').onchange = (e) => { S.n = +e.target.value; update(); };
placeSel.onchange = (e) => { S.city = +e.target.value; update(); };

function update() {
  const pl = place(), ch = computeChart(S.utc, pl.lat, pl.lon), rot = { base: S.base, house: S.house, fix: S.fix };
  const inp = toInputValue(S.utc, pl.zone), [d, t] = inp.split('T'), [y, m, dd] = d.split('-').map(Number);
  $('when').textContent = `${String(dd).padStart(2, '0')} ${MONTHS[m - 1]} ${y} · ${t}`;
  const wd = new Date(Date.UTC(y, m - 1, dd)).getUTCDay();
  $('whenSub').textContent = `${DAYS[wd]} · ${tzLabel(S.utc, pl.zone)} · ${pl.name}`;
  $('dt').value = inp; $('amount').value = S.n; placeSel.value = S.city;
  unitBtns.forEach((b, i) => b.classList.toggle('on', UNITS[i][0] === S.unit));
  $('rotNote').textContent = describeRotation(rot);

  $('charts').innerHTML = ['D1', 'D9'].map((k) => {
    const { grid } = houseGrid(ch, k, rot), a = ch.asc;
    return `<section class="card"><h3>${k === 'D1' ? 'D1 · Rashi' : 'D9 · Navamsa'}<small>Lagna ${RASHIS[k === 'D1' ? a.rashi : a.d9]}${k === 'D1' ? ' ' + fmtDeg(a.deg) : ''}</small></h3>${chartSVG(grid, `${k} chart`)}</section>`;
  }).join('');

  const r1 = houseGrid(ch, 'D1', rot).ref, r9 = houseGrid(ch, 'D9', rot).ref; last.r1 = r1; last.r9 = r9;
  const row = (name, o, retro, lag) => `<tr><td${lag ? '' : ` class="lp" data-act="planet" data-planet="${name}"`}><b>${name}</b></td><td>${RASHIS[o.rashi]}</td><td>${fmtDeg(o.deg)}</td><td>${NAKSHATRAS[o.nak]} ${o.pada}</td><td${lag ? '' : ` class="lp" data-act="house" data-house="${houseOf(o.rashi, r1)}"`}>${houseOf(o.rashi, r1)}</td><td>${RASHIS[o.d9]}</td><td${lag ? '' : ` class="lp" data-act="house" data-house="${houseOf(o.d9, r9)}"`}>${houseOf(o.d9, r9)}</td><td>${retro ? 'R' : ''}</td></tr>`;
  $('table').innerHTML = `<thead><tr><th>Graha</th><th>Rashi</th><th>Deg</th><th>Nakshatra · pada</th><th>H</th><th>Navamsa</th><th>H</th><th></th></tr></thead><tbody>${row('Lagna', ch.asc, false, true)}${PLANETS.map((p) => row(p, ch.planets[p], ch.planets[p].retro)).join('')}</tbody>`;
  save();
}

// ---- long press on a house / graha -> rotate menu (by house or by planet)
const menu = $('menu'), last = { r1: 0, r9: 0 };
const closeMenu = () => { menu.hidden = true; };
function openMenu(el) {
  const planet = el.dataset.act === 'planet' ? el.dataset.planet : '', k = +el.dataset.house, opts = [];
  const set = (base, h) => () => { S.base = base; S.house = h; closeMenu(); update(); };
  const lock = () => { S.fix = [(last.r1 + k - 1) % 12, (last.r9 + k - 1) % 12]; S.base = 'Fixed'; S.house = 1; closeMenu(); update(); };
  if (planet) opts.push([`${planet} ko Lagna banao`, set(planet, 1)]);
  else opts.push([`House ${k} ko Lagna banao (time badalne par bhi wahi)`, lock]);
  opts.push(['Original chart (Reset)', set('Lagna', 1)]);
  menu.innerHTML = `<h4>${planet || 'House ' + k}</h4>`;
  for (const [label, fn] of opts) { const b = document.createElement('button'); b.textContent = label; b.onclick = fn; menu.append(b); }
  const c = document.createElement('button'); c.className = 'cancel'; c.textContent = 'Cancel'; c.onclick = closeMenu; menu.append(c);
  menu.hidden = false;
}
let lp = null;
const charts = $('table');
charts.addEventListener('pointerdown', (e) => {
  const t = e.target.closest('.lp'); if (!t) return;
  const x0 = e.clientX, y0 = e.clientY; clearTimeout(lp);
  lp = setTimeout(() => { lp = null; if (navigator.vibrate) navigator.vibrate(15); openMenu(t); }, 450);
  const cancel = (ev) => { if (ev.type === 'pointermove' && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 10) return; clearTimeout(lp); for (const n of ['pointermove', 'pointerup', 'pointercancel']) charts.removeEventListener(n, cancel); };
  for (const n of ['pointermove', 'pointerup', 'pointercancel']) charts.addEventListener(n, cancel);
});
charts.addEventListener('contextmenu', (e) => e.preventDefault());
$('reset').onclick = () => { S.base = 'Lagna'; S.house = 1; update(); };
document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target) && !e.target.closest('#table')) closeMenu(); });

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
update();
