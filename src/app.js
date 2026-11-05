import { PLANETS, RASHIS, NAKSHATRAS } from './jyotish.js';
import { DEFAULT_SETTINGS, mergeSettings } from './settings.js';
import { parseCSV, toCSV, mergeBars, store, istToday, nextTradingDays } from './data.js';
import { buildDatasetAsync, walkForward, inSampleScores, featureTable, snapshotFor } from './model.js';
import { runBacktest, normaliseScores, combineSignal } from './backtest.js';
import { explain, chartDetails, scoreStats } from './live.js';
import { buildGrid } from './sarvatobhadra.js';
import { EXAMPLE_RULES, validateRule } from './rules.js';

const $ = (s, r = document) => r.querySelector(s);
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v; else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}
const pct = (x, d = 1) => (x * 100).toFixed(d) + '%';
const sgn = (x, d = 2) => (x >= 0 ? '+' : '') + x.toFixed(d);
const cls = (x) => (x > 0 ? 'good' : x < 0 ? 'bad' : '');
const GLYPH = { Sun: 'Su', Moon: 'Mo', Mars: 'Ma', Mercury: 'Me', Jupiter: 'Ju', Venus: 'Ve', Saturn: 'Sa', Rahu: 'Ra', Ketu: 'Ke' };
const INSTRUMENTS = { banknifty: 'Bank Nifty', nifty: 'Nifty 50' };

const app = {
  settings: mergeSettings(DEFAULT_SETTINGS, store.get('settings', {})),
  rules: store.get('rules', []),
  inst: store.get('inst', 'banknifty'),
  bars: [], tab: 'today', date: istToday(), models: null, busy: false, bt: null, sbcFocus: '', btRange: store.get('btRange', { from: '', to: '' }),
};

function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms); }
const setStatus = (s) => { $('#statusPill').textContent = s; };
const saveSettings = () => store.set('settings', app.settings);
const saveRules = () => store.set('rules', app.rules);

// ---------------------------------------------------------------- data
async function loadBars() {
  app.bars = [];
  const txt = store.getText(`bars:${app.inst}`);
  if (txt) { try { app.bars = parseCSV(txt); } catch { /* ignore corrupt */ } }
  try {
    const r = await fetch(`data/${app.inst}.csv`, { cache: 'no-store' });
    if (r.ok) {
      const fetched = parseCSV(await r.text());
      const lastOld = app.bars.length ? app.bars[app.bars.length - 1].d : '';
      if (fetched[fetched.length - 1].d >= lastOld) { app.bars = mergeBars(app.bars, fetched); store.setText(`bars:${app.inst}`, toCSV(app.bars)); }
    }
  } catch { /* offline or no bundled data: fine */ }
  $('#instLabel').textContent = INSTRUMENTS[app.inst] || app.inst;
  setStatus(app.bars.length ? `${app.bars.length} days · till ${app.bars[app.bars.length - 1].d}` : 'no data — open Data tab');
}

// ---------------------------------------------------------------- model pipeline
const chartKey = () => JSON.stringify([app.settings.ayanamsa, app.settings.lat, app.settings.lon, app.settings.snapshotHourIST, app.settings.houseFrom,
  app.settings.fixedLagna, app.settings.orbScale, app.settings.useAbhijit, app.settings.drishti, app.settings.families, app.settings.layers.slow.H,
  app.rules, app.bars.length, app.bars.length ? app.bars[app.bars.length - 1].d : '']);
const learnKey = () => JSON.stringify([chartKey(), app.settings.layers, app.settings.adaptive, app.settings.eta, app.settings.blockDays, app.settings.warmupDays]);

async function ensureModels(progress = () => {}) {
  if (app.bars.length < app.settings.warmupDays + 120) throw new Error(`Need at least ${app.settings.warmupDays + 120} trading days of data (have ${app.bars.length}). Import more history or lower warm-up days in Data → Settings.`);
  const ck = chartKey(), lk = learnKey();
  if (app.models && app.models.lk === lk) return app.models;
  let ds = app.models && app.models.ck === ck ? app.models.ds : null;
  if (!ds) ds = await buildDatasetAsync(app.bars, app.settings, app.rules, (p) => progress('Computing planetary positions', p * 0.7));
  progress('Learning fast layer', 0.72); await tick();
  const fast = walkForward(ds, app.settings, app.rules, 'fast');
  progress('Learning slow layer', 0.88); await tick();
  const slow = walkForward(ds, app.settings, app.rules, 'slow');
  progress('Done', 1);
  app.models = { ck, lk, ds, fast, slow, fastStats: scoreStats(fast.S), slowStats: scoreStats(slow.S) };
  app.bt = null;
  return app.models;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

function progressUI(host) {
  const bar = h('div', {}), wrap = h('div', { class: 'progress' }, bar), label = h('div', { class: 'note' }, '');
  host.append(label, wrap);
  return (msg, p) => { label.textContent = msg; bar.style.width = `${Math.round(p * 100)}%`; };
}

function liveSignal(models, dStr) {
  const s = app.settings, strat = s.strategy;
  const ef = explain(models.fast.state, dStr, s, app.rules), es = explain(models.slow.state, dStr, s, app.rules);
  const xf = (ef.score - models.fastStats.mean) / models.fastStats.sd, xs = (es.score - models.slowStats.mean) / models.slowStats.sd;
  const x = strat.mode === 'fast' ? xf : strat.mode === 'slow' ? xs : xf + strat.lambdaSlow * xs;
  return { ef, es, xf, xs, x };
}
const labelOf = (x, thr) => (x > thr ? ['Bullish', 'good'] : x < -thr ? ['Bearish', 'bad'] : ['Neutral', 'mute']);

// ---------------------------------------------------------------- views
const views = { today: viewToday, backtest: viewBacktest, weights: viewWeights, rules: viewRules, data: viewData };
function render() {
  const v = $('#view'), host = h('div', {}); v.replaceChildren(host); // fresh host so a slow async view can't leak into another tab
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === app.tab));
  views[app.tab](host);
  window.scrollTo(0, 0);
}

function needData(host) {
  host.append(h('div', { class: 'card' }, h('b', {}, 'Pehle data import karo'),
    h('p', { class: 'note' }, `${INSTRUMENTS[app.inst] || app.inst} ka daily OHLC CSV chahiye (Date, Open, High, Low, Close). Data tab me file/paste se import karo, ya GitHub Pages deploy se data/${app.inst}.csv auto-load hota hai.`),
    h('button', { class: 'btn', onclick: () => { app.tab = 'data'; render(); } }, 'Open Data tab')));
}

async function viewToday(host) {
  if (!app.bars.length) return needData(host);
  const top = h('div', { class: 'card' }); host.append(top);
  const picker = h('input', { type: 'date', value: app.date, onchange: (e) => { app.date = e.target.value || istToday(); render(); } });
  let models;
  const pr = progressUI(top);
  try { models = await ensureModels(pr); } catch (e) { top.innerHTML = ''; top.append(h('b', { class: 'bad' }, 'Model not ready'), h('p', { class: 'note' }, e.message)); return; }
  top.remove();
  const sig = liveSignal(models, app.date), strat = app.settings.strategy;
  // Is this a past trading day in the data? Then show what the model would have said back then (out-of-sample) + what really happened.
  const t = models.ds.days.findIndex((d) => d.d === app.date);
  const day = t >= 0 ? models.ds.days[t] : null;
  let show = { x: sig.x, xf: sig.xf, xs: sig.xs }, mode = 'live';
  if (day) {
    const xf = normaliseScores(models.fast.S)[t], xs = normaliseScores(models.slow.S)[t], x = combineSignal(models.fast.S, models.slow.S, strat)[t];
    if (Number.isFinite(x)) { show = { x, xf, xs }; mode = 'oos'; } else mode = 'warmup';
  }
  const [lab, lc] = labelOf(show.x, strat.thr);
  const snap = sig.ef.snap;
  const modeNote = { live: 'Latest model (trained on all data so far).', oos: 'Out-of-sample: yeh wahi signal hai jo model us din se PEHLE ke data se deta.', warmup: 'Warm-up period: model ne yeh din training me dekha hai (in-sample), isliye is signal par bharosa mat karo.' }[mode];

  host.append(h('div', { class: 'card' },
    h('div', { class: 'row' }, h('div', {}, h('div', { class: 'note' }, `Signal for ${app.date} (chart @ ${fmtHour(app.settings.snapshotHourIST)} IST)`), h('div', { class: `big ${lc}` }, lab)), h('div', { style: 'width:150px' }, picker)),
    h('div', { class: 'grid g3', style: 'margin-top:10px' },
      stat('Combined z', sgn(show.x), cls(show.x)), stat('Fast (day)', sgn(show.xf), cls(show.xf)), stat('Slow (trend)', sgn(show.xs), cls(show.xs))),
    h('p', { class: `note ${mode === 'warmup' ? 'warn' : ''}` }, modeNote),
    day ? outcomeBlock(day, show.x, strat) : '',
    h('p', { class: 'note' }, `Mode: ${strat.mode} · threshold ±${strat.thr}. Neeche ke "reasons" hamesha latest model ke weights se bante hain. Yeh research tool hai, financial advice nahi.`)));

  host.append(h('h2', {}, 'Kyun? Top contributors (fast layer)'));
  host.append(contribCard(sig.ef.contrib), groupBars(sig.ef.groups));
  host.append(h('h2', {}, 'Slow layer (Saturn / Jupiter trend)'), contribCard(sig.es.contrib.slice(0, 8)));

  host.append(h('h2', {}, 'Planet positions (sidereal)'), planetTable(snap));
  const det = chartDetails(snap, app.settings);
  host.append(h('h2', {}, 'Aspects'), aspectCard(det));
  host.append(h('h2', {}, 'Sarvatobhadra Chakra'), sbcCard(snap, det.sbc));
  host.append(h('h2', {}, 'Next 10 trading days'), outlook(models));
}

function outcomeBlock(day, x, strat) {
  const r = strat.mode === 'slow' ? day.rCC : day.rOC;
  const call = Math.abs(x) < strat.thr || !Number.isFinite(x) ? 0 : Math.sign(x);
  const verdict = call === 0 ? ['No call (neutral)', 'mute'] : Math.sign(r) === call ? ['Signal sahi nikla ✓', 'good'] : ['Signal galat nikla ✗', 'bad'];
  return h('div', { class: 'grid g3', style: 'margin-top:8px' }, stat('Open', day.o.toFixed(0)), stat('Close', day.c.toFixed(0)), stat('Open→Close', pct(day.rOC, 2), cls(day.rOC)),
    h('div', { style: 'grid-column:1/-1' }, h('b', { class: verdict[1] }, `Actual: ${verdict[0]}`), h('span', { class: 'note' }, ` · High ${day.h.toFixed(0)} · Low ${day.l.toFixed(0)}`)));
}

function fmtHour(hh) { const H = Math.floor(hh), M = Math.round((hh - H) * 60); return `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`; }
const stat = (l, v, c = '') => h('div', { class: 'stat' }, h('small', {}, l), h('b', { class: c }, v));

function contribCard(list) {
  const pos = list.filter((c) => c.v > 0).slice(0, 6), neg = list.filter((c) => c.v < 0).slice(0, 6);
  const line = (c) => h('div', { class: 'row', style: 'padding:3px 0' }, h('span', {}, c.label), h('b', { class: cls(c.v) }, sgn(c.v, 3)));
  return h('div', { class: 'card' }, !list.length ? h('p', { class: 'note' }, 'No learned factor is active on this date.') : '',
    pos.length ? h('div', {}, h('small', { class: 'good' }, '▲ Bullish factors'), pos.map(line)) : '',
    neg.length ? h('div', { style: 'margin-top:8px' }, h('small', { class: 'bad' }, '▼ Bearish factors'), neg.map(line)) : '');
}
function groupBars(groups) {
  const ent = Object.entries(groups).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8);
  const mx = Math.max(1e-9, ...ent.map(([, v]) => Math.abs(v)));
  return h('div', { class: 'card' }, h('small', { class: 'mute' }, 'Which planet group pushes the signal'),
    ent.map(([g, v]) => h('div', { style: 'margin-top:7px' }, h('div', { class: 'row' }, h('span', {}, g), h('b', { class: cls(v) }, sgn(v, 3))),
      h('div', { class: 'bar' }, h('span', { style: `background:var(--${v >= 0 ? 'good' : 'bad'});${v >= 0 ? 'left:50%' : 'right:50%'};width:${(Math.abs(v) / mx) * 50}%` })))));
}

function planetTable(snap) {
  const rows = PLANETS.map((p) => {
    const pl = snap.planets[p];
    const flags = [pl.retro && p !== 'Rahu' && p !== 'Ketu' ? 'R' : '', pl.combust ? 'C' : '', pl.dignity !== 'neutral' ? pl.dignity : '', pl.sandhi ? 'sandhi' : '', pl.gandanta ? 'gandanta' : ''].filter(Boolean).join(' ');
    const nk = pl.abhijit ? 'Abhijit*' : NAKSHATRAS[pl.nak];
    return h('tr', {}, h('td', {}, h('b', {}, p)), h('td', {}, RASHIS[pl.rashi]), h('td', {}, `${pl.degInSign.toFixed(2)}°`), h('td', {}, `${nk} ${pl.pada}`), h('td', {}, pl.nakLord), h('td', {}, String(pl.house)), h('td', { class: 'mute' }, flags));
  });
  return h('div', { class: 'card scroll' },
    h('div', { class: 'note' }, `Lagna (market-open ascendant): ${RASHIS[snap.asc.rashi]} ${snap.asc.degInSign.toFixed(1)}° · houses from ${app.settings.houseFrom} · tithi ${snap.tithi} (${snap.paksha})`),
    h('table', {}, h('thead', {}, h('tr', {}, ...['Planet', 'Rashi', 'Deg', 'Nakshatra·pada', 'Nak lord', 'H', 'Flags'].map((x) => h('th', {}, x)))), h('tbody', {}, rows)));
}

function aspectCard(det) {
  const ved = det.vedic.filter((a) => a.kind === 'aspect').map((a) => `${GLYPH[a.from]}→${GLYPH[a.to]} (${a.houseCount})`);
  const conj = det.vedic.filter((a) => a.kind === 'conj').map((a) => `${GLYPH[a.from]}+${GLYPH[a.to]}`);
  const sym = { conj: '☌', sext: '⚹', sq: '□', tri: '△', opp: '☍' };
  const west = det.western.sort((a, b) => a.orb - b.orb).map((a) => `${GLYPH[a.a]} ${sym[a.type]} ${GLYPH[a.b]} ${a.orb.toFixed(1)}°`);
  const chips = (l) => h('div', { class: 'chips' }, l.length ? l.map((x) => h('span', { class: 'chip' }, x)) : h('span', { class: 'note' }, '—'));
  return h('div', { class: 'card' }, h('small', { class: 'mute' }, 'Same rashi (vedic conjunction)'), chips(conj), h('small', { class: 'mute' }, 'Vedic drishti (graha → graha, house count)'), chips(ved), h('small', { class: 'mute' }, 'Western (orb)'), chips(west));
}

function sbcCard(snap, sbc) {
  const grid = buildGrid();
  const byNak = {}, byRashi = {};
  for (const p of PLANETS) { (byNak[sbc.cells[p].nakName] ||= []).push(p); (byRashi[snap.planets[p].rashi] ||= []).push(p); }
  const focus = app.sbcFocus;
  const src = focus ? sbc.cells[focus].nak : null;
  const inLine = (r, c) => src && (r === src[0] || c === src[1] || Math.abs(r - src[0]) === Math.abs(c - src[1]));
  const cells = [];
  for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
    const g = grid[r][c]; const here = g.kind === 'nak' ? byNak[g.id] : g.kind === 'rashi' ? byRashi[g.id] : null;
    const short = g.kind === 'nak' ? g.label.replace('Purva ', 'P.').replace('Uttara ', 'U.').slice(0, 7) : g.kind === 'rashi' ? RASHIS[g.id].slice(0, 4) : '';
    cells.push(h('div', { class: `${g.kind}${src && src[0] === r && src[1] === c ? ' src' : inLine(r, c) && g.kind !== 'other' ? ' hit' : ''}` }, short, here ? h('b', {}, here.map((p) => GLYPH[p]).join(' ')) : ''));
  }
  const sel = h('select', { onchange: (e) => { app.sbcFocus = e.target.value; render(); } }, h('option', { value: '' }, 'Highlight vedha of…'), PLANETS.map((p) => h('option', { value: p, selected: p === focus }, p)));
  const hits = sbc.vedha.filter((v) => v.via === 'nak').map((v) => `${GLYPH[v.from]}→${GLYPH[v.to]}`);
  return h('div', { class: 'card' }, h('div', { class: 'sbc' }, cells), h('div', { style: 'margin-top:8px' }, sel),
    h('p', { class: 'note' }, 'Blue = nakshatra ring (planets by nakshatra), orange = rashi cells. Red outline = cells struck by the selected planet’s row/column/diagonal vedha.'),
    h('small', { class: 'mute' }, 'Nakshatra vedha pairs today'), h('div', { class: 'chips' }, hits.length ? hits.map((x) => h('span', { class: 'chip' }, x)) : h('span', { class: 'note' }, '—')));
}

function outlook(models) {
  const strat = app.settings.strategy, days = nextTradingDays(app.date, 10);
  const rows = days.map((d) => {
    const s = liveSignal(models, d); const [lab, lc] = labelOf(s.x, strat.thr); const moon = s.ef.snap.planets.Moon;
    return h('tr', {}, h('td', {}, d.slice(5)), h('td', {}, `${NAKSHATRAS[moon.nak].slice(0, 9)} ${moon.pada}`), h('td', { class: cls(s.xf) }, sgn(s.xf)), h('td', { class: cls(s.xs) }, sgn(s.xs)), h('td', {}, h('b', { class: lc }, lab)));
  });
  return h('div', { class: 'card scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ...['Date', 'Moon', 'Fast', 'Slow', 'Signal'].map((x) => h('th', {}, x)))), h('tbody', {}, rows)),
    h('p', { class: 'note' }, 'Planetary positions are deterministic, so the forward calendar is exact; the learned weights are what is uncertain.'));
}

// ---------------------------------------------------------------- backtest
async function viewBacktest(host) {
  if (!app.bars.length) return needData(host);
  const s = app.settings, st = s.strategy;
  const set = (k, conv = (x) => x) => (e) => { st[k] = conv(e.target.type === 'checkbox' ? e.target.checked : e.target.value); saveSettings(); app.bt = null; };
  host.append(h('div', { class: 'card' },
    h('b', {}, 'Strategy'),
    h('div', { class: 'grid g2' },
      h('div', {}, h('label', {}, 'Signal mode'), h('select', { onchange: set('mode') }, ['combined', 'fast', 'slow'].map((m) => h('option', { value: m, selected: st.mode === m }, m)))),
      h('div', {}, h('label', {}, 'Threshold (z)'), h('input', { type: 'number', step: '0.05', value: st.thr, onchange: set('thr', parseFloat) })),
      h('div', {}, h('label', {}, 'Slow weight (λ)'), h('input', { type: 'number', step: '0.1', value: st.lambdaSlow, onchange: set('lambdaSlow', parseFloat) })),
      h('div', {}, h('label', {}, 'Cost (bps / unit turnover)'), h('input', { type: 'number', step: '0.5', value: st.costBps, onchange: set('costBps', parseFloat) })),
      h('div', {}, h('label', {}, 'Position scale (z for full size)'), h('input', { type: 'number', step: '0.1', value: st.posScale, onchange: set('posScale', parseFloat) })),
      h('div', {}, h('label', {}, 'Long only'), h('select', { onchange: set('longOnly', (v) => v === 'yes') }, h('option', { value: 'no', selected: !st.longOnly }, 'no (long & short)'), h('option', { value: 'yes', selected: st.longOnly }, 'yes')))),
    h('div', { class: 'grid g2', style: 'margin-top:6px' },
      h('div', {}, h('label', {}, 'Result from (date)'), h('input', { type: 'date', value: app.btRange.from, onchange: (e) => { app.btRange.from = e.target.value; store.set('btRange', app.btRange); app.bt = null; } })),
      h('div', {}, h('label', {}, 'Result to (date)'), h('input', { type: 'date', value: app.btRange.to, onchange: (e) => { app.btRange.to = e.target.value; store.set('btRange', app.btRange); app.bt = null; } }))),
    h('p', { class: 'note' }, 'Khali chhodo = poora out-of-sample period. Date range sirf yeh badalti hai ki kin dino ka result dikhe; model hamesha un dino se pehle ke data se hi seekhta hai.'),
    h('div', { style: 'margin-top:12px' }, h('button', { class: 'btn', id: 'runBt' }, 'Run walk-forward backtest')),
    h('p', { class: 'note' }, 'Har din ka signal sirf us din se pehle ke data par seekhe weights se banta hai (expanding window, har block pe re-estimate). Isliye result out-of-sample hai.')));
  const out = h('div', {}); host.append(out);
  const run = async () => {
    out.innerHTML = ''; const holder = h('div', { class: 'card' }); out.append(holder); const pr = progressUI(holder);
    try {
      const m = await ensureModels(pr); holder.remove();
      const bt = runBacktest(m.ds.days, m.fast.S, m.slow.S, st, { from: app.btRange.from, to: app.btRange.to });
      const inF = Float64Array.from(inSampleScores(m.fast.state)), inS = Float64Array.from(inSampleScores(m.slow.state));
      for (let t = 0; t < s.warmupDays; t++) { inF[t] = NaN; inS[t] = NaN; }
      const ins = runBacktest(m.ds.days, inF, inS, st, { shiftTrials: 0, from: app.btRange.from, to: app.btRange.to });
      app.bt = { bt, ins }; renderBt(out, m, bt, ins);
    } catch (e) { holder.innerHTML = ''; holder.append(h('b', { class: 'bad' }, 'Backtest failed'), h('p', { class: 'note' }, e.message)); }
  };
  $('#runBt', host).addEventListener('click', run);
  if (app.bt && app.models) renderBt(out, app.models, app.bt.bt, app.bt.ins);
}

function renderBt(out, m, bt, ins) {
  out.innerHTML = '';
  const a = bt.strategy, b = bt.buyHold, sh = bt.shift;
  if (!a) { out.append(h('div', { class: 'card' }, 'No signals generated — not enough history after warm-up.')); return; }
  const verdict = sh ? (sh.p < 0.05 ? ['Statistically unusual vs. misaligned-shift test', 'good'] : ['Not distinguishable from chance yet', 'warn']) : ['—', 'mute'];
  out.append(h('div', { class: 'card' },
    h('div', { class: 'note' }, `Out-of-sample: ${a.curve[0][0]} → ${a.curve[a.curve.length - 1][0]} (${a.days} days)`),
    h('div', { class: 'grid g3', style: 'margin-top:8px' },
      stat('Sharpe', a.sharpe.toFixed(2), cls(a.sharpe)), stat('CAGR', pct(a.cagr), cls(a.cagr)), stat('Max DD', pct(a.maxDD), 'bad'),
      stat('Total', pct(a.totalReturn, 0), cls(a.totalReturn)), stat('Hit rate', pct(a.hitRate), ''), stat('Exposure', pct(a.exposure, 0), '')),
    h('div', { class: 'grid g3', style: 'margin-top:10px' },
      stat('Buy&hold Sharpe', b ? b.sharpe.toFixed(2) : '—', ''), stat('Direction acc.', `${pct(bt.direction.acc)} (${bt.direction.n})`, ''), stat('Shift-test p', sh ? sh.p.toFixed(3) : '—', verdict[1])),
    h('p', { class: `note ${verdict[1]}` }, verdict[0] + '.'),
    ins && ins.strategy ? h('p', { class: 'note' }, `Overfit check — same pipeline scored with the final model on its own training data (in-sample): Sharpe ${ins.strategy.sharpe.toFixed(2)} vs out-of-sample ${a.sharpe.toFixed(2)}. Bada gap = model ratta maar raha hai.`) : ''));
  const cv = h('canvas', {}); out.append(h('div', { class: 'card' }, h('small', { class: 'mute' }, 'Equity curve (strategy vs buy&hold of same return series)'), cv));
  requestAnimationFrame(() => drawCurve(cv, a.curve, b ? b.curve : null));
  out.append(h('div', { class: 'card scroll' }, h('small', { class: 'mute' }, 'Year by year'), h('table', {}, h('thead', {}, h('tr', {}, ['Year', 'Return', 'Days'].map((x) => h('th', {}, x)))),
    h('tbody', {}, bt.yearly.map((y) => h('tr', {}, h('td', {}, y.year), h('td', { class: cls(y.ret) }, pct(y.ret)), h('td', {}, y.n)))))));
  out.append(dayLog(m, bt));
}

// Day-by-day table so every result can be checked by hand against a chart / your own kundali.
function dayLog(m, bt) {
  const st = app.settings.strategy, days = m.ds.days;
  const xf = normaliseScores(m.fast.S), xs = normaliseScores(m.slow.S);
  const idx = []; for (let t = 0; t < days.length; t++) if (Number.isFinite(bt.pos[t])) idx.push(t);
  const newest = idx.slice().reverse();
  let shown = 30;
  const body = h('tbody', {}), more = h('button', { class: 'btn ghost' }, 'Show 30 more');
  const rowFor = (t) => {
    const d = days[t], moon = snapshotFor(d.d, app.settings).planets.Moon, [lab, lc] = labelOf(bt.x[t], st.thr), p = bt.pos[t], pl = bt.pnl[t];
    return h('tr', {}, h('td', {}, d.d), h('td', {}, `${NAKSHATRAS[moon.nak].slice(0, 8)} ${moon.pada}`), h('td', { class: cls(xf[t]) }, sgn(xf[t] || 0)), h('td', { class: cls(xs[t]) }, sgn(xs[t] || 0)),
      h('td', {}, h('b', { class: lc }, lab)), h('td', {}, p.toFixed(2)), h('td', {}, d.o.toFixed(0)), h('td', {}, d.c.toFixed(0)), h('td', { class: cls(d.rOC) }, pct(d.rOC, 2)), h('td', { class: cls(pl) }, pct(pl, 2)));
  };
  const draw = () => { body.replaceChildren(...newest.slice(0, shown).map(rowFor)); more.hidden = shown >= newest.length; };
  more.addEventListener('click', () => { shown += 30; draw(); }); draw();

  const exportCsv = async () => {
    toast('Preparing CSV…', 30000);
    await tick();
    const head = ['date', 'weekday', 'open', 'high', 'low', 'close', 'open_to_close', 'fast_z', 'slow_z', 'signal_z', 'position', 'strategy_pnl']
      .concat(PLANETS.flatMap((p) => [`${p}_rashi`, `${p}_deg`, `${p}_nakshatra`, `${p}_pada`, `${p}_house`]));
    const lines = [head.join(',')];
    for (const t of idx) {
      const d = days[t], sn = snapshotFor(d.d, app.settings);
      const row = [d.d, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(d.d + 'T00:00:00Z').getUTCDay()], d.o, d.h, d.l, d.c, d.rOC.toFixed(5), (xf[t] || 0).toFixed(3), (xs[t] || 0).toFixed(3), bt.x[t].toFixed(3), bt.pos[t].toFixed(3), bt.pnl[t].toFixed(5)];
      for (const p of PLANETS) { const q = sn.planets[p]; row.push(RASHIS[q.rashi], q.degInSign.toFixed(2), NAKSHATRAS[q.nak], q.pada, q.house); }
      lines.push(row.join(','));
    }
    const text = lines.join('\n'), file = new File([text], `astro-backtest-${app.inst}.csv`, { type: 'text/csv' });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; }
    } catch { /* user cancelled or unsupported: fall through to download */ }
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.append(a); a.click(); a.remove();
  };
  const exportAndClear = async () => { try { await exportCsv(); } finally { $('#toast').hidden = true; } };
  return h('div', {}, h('h2', {}, 'Day-by-day log (naya din upar)'),
    h('div', { class: 'card scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['Date', 'Moon', 'Fast', 'Slow', 'Signal', 'Pos', 'Open', 'Close', 'O→C', 'P&L'].map((x) => h('th', {}, x)))), body),
      h('div', { class: 'row', style: 'margin-top:10px' }, more, h('button', { class: 'btn ghost', onclick: exportAndClear }, 'Export CSV (Excel/Sheets)')),
      h('p', { class: 'note' }, 'Kisi bhi row ki date Aaj tab ke date-picker me daalo — wahan us din ke saare planet positions, aspects aur Sarvatobhadra dikhenge. CSV me har din ke 9 grahon ke rashi/degree/nakshatra/pada/house bhi hain, taaki Excel me apne observations se match kar sako.')));
}

function drawCurve(cv, a, b) {
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const all = a.concat(b || []).map((p) => p[1]); const lo = Math.min(...all), hi = Math.max(...all);
  const y = (v) => H - 14 - ((Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo) || 1)) * (H - 28);
  g.strokeStyle = css.getPropertyValue('--line'); g.lineWidth = 1;
  for (let i = 0; i < 4; i++) { const yy = 14 + (i * (H - 28)) / 3; g.beginPath(); g.moveTo(0, yy); g.lineTo(W, yy); g.stroke(); }
  const line = (pts, color, w) => { g.strokeStyle = color; g.lineWidth = w; g.beginPath(); pts.forEach((p, i) => { const x = (i / (pts.length - 1)) * W; i ? g.lineTo(x, y(p[1])) : g.moveTo(x, y(p[1])); }); g.stroke(); };
  if (b) line(b, css.getPropertyValue('--mute').trim() || '#888', 1.2);
  line(a, css.getPropertyValue('--accent').trim() || '#4f46e5', 2);
  g.fillStyle = css.getPropertyValue('--mute'); g.font = '11px sans-serif';
  g.fillText(a[0][0], 4, H - 2); const lbl = a[a.length - 1][0]; g.fillText(lbl, W - g.measureText(lbl).width - 4, H - 2);
}

// ---------------------------------------------------------------- weights
async function viewWeights(host) {
  if (!app.bars.length) return needData(host);
  const box = h('div', { class: 'card' }); host.append(box);
  let m; try { m = await ensureModels(progressUI(box)); } catch (e) { box.innerHTML = ''; box.append(h('b', { class: 'bad' }, 'Model not ready'), h('p', { class: 'note' }, e.message)); return; }
  box.remove();
  for (const layer of ['fast', 'slow']) {
    const res = m[layer], cfg = app.settings.layers[layer];
    host.append(h('h2', {}, `${cfg.label} — planet group trust`));
    const rows = Object.keys(cfg.priors).map((g) => {
      const now = res.state.mult[g], pr = cfg.priors[g];
      return h('tr', {}, h('td', {}, g), h('td', {}, pr.toFixed(2)), h('td', {}, h('b', {}, now.toFixed(2))), h('td', { style: 'width:34%' }, h('div', { class: 'bar' }, h('span', { style: `background:var(--accent);left:0;width:${Math.min(100, (now / 3) * 100)}%` }))), h('td', { class: cls(now - pr) }, sgn(now - pr)));
    });
    host.append(h('div', { class: 'card scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['Group', 'Your prior', 'Learned', '', 'Δ'].map((x) => h('th', {}, x)))), h('tbody', {}, rows)),
      h('p', { class: 'note' }, 'Prior = tumhari belief (Data → Settings). Learned = out-of-sample IC ke hisab se walk-forward me adjust hua multiplier.')));
    const tab = featureTable(res.state, { minEpisodes: 6 }).filter((r) => r.family !== 'rule');
    const topPos = [...tab].sort((a, b) => b.eff * Math.sqrt(b.ne) - a.eff * Math.sqrt(a.ne)).slice(0, 12);
    const topNeg = [...tab].sort((a, b) => a.eff * Math.sqrt(a.ne) - b.eff * Math.sqrt(b.ne)).slice(0, 12);
    const ftable = (list) => h('table', {}, h('thead', {}, h('tr', {}, ['Factor', 'Weight', 't', 'Eps'].map((x) => h('th', {}, x)))),
      h('tbody', {}, list.map((r) => h('tr', {}, h('td', { style: 'white-space:normal;min-width:150px' }, r.label), h('td', { class: cls(r.eff) }, sgn(r.eff, 3)), h('td', {}, r.t.toFixed(1)), h('td', {}, String(r.ne))))));
    host.append(h('details', {}, h('summary', {}, `Strongest bullish factors (${layer})`), h('div', { class: 'card scroll' }, ftable(topPos))),
      h('details', {}, h('summary', {}, `Strongest bearish factors (${layer})`), h('div', { class: 'card scroll' }, ftable(topNeg))));
  }
  host.append(h('h2', {}, 'What changed? (last re-estimations, fast layer)'));
  const log = m.fast.log.slice(-6).reverse();
  host.append(...log.map((e) => h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', {}, `${e.start} → ${e.end}`), h('span', { class: 'tag' }, `block ${e.block}`)),
    e.multChanges.length ? h('div', { class: 'chips', style: 'margin-top:6px' }, e.multChanges.slice(0, 6).map((c) => h('span', { class: `chip ${c.to > c.from ? 'good' : 'bad'}` }, `${c.group} ${c.from.toFixed(2)}→${c.to.toFixed(2)} (IC ${c.ic.toFixed(2)})`))) : h('div', { class: 'note' }, 'no planet-group multiplier moved'),
    e.changes.length ? h('div', { style: 'margin-top:6px' }, h('small', { class: 'mute' }, 'Biggest factor weight shifts'), e.changes.slice(0, 4).map((c) => h('div', { class: 'row' }, h('span', { class: 'note' }, c.label), h('span', { class: cls(c.d) }, sgn(c.d, 3))))) : '')));
}

// ---------------------------------------------------------------- rules
const RULE_HELP = `Rule schema (JSON array):
[{
  "name": "Moon in Rohini + Venus kendra",
  "when": [
    {"planet":"Moon","nak":"Rohini"},
    {"planet":"Venus","house":[1,4,7,10]},
    {"aspect":"vedic","from":"Saturn","to":"Moon"},
    {"aspect":"western","a":"Moon","b":"Mars","type":"sq"},
    {"sbc":{"from":"Saturn","to":"Moon"}},
    {"tithi":[8,23]}, {"weekday":[1]},
    {"not":{"planet":"Mercury","combust":true}}
  ],
  "direction": 1,     // +1 bullish, -1 bearish, 0 = just track it
  "strength": 0.15,   // prior effect in daily-vol units (0.1–0.2 is big)
  "confidence": 10,   // pseudo-observations: higher = data needs more evidence to overrule you
  "lock": false,      // true = never learned, weight stays = your prior
  "layer": "fast"     // fast | slow | both
}]
Planet fields: rashi, nak, pada, house, nakLord, dignity, retro, combust, sandhi, gandanta, deg:[min,max]`;

async function viewRules(host) {
  const ta = h('textarea', { spellcheck: 'false' }, JSON.stringify(app.rules, null, 2));
  const msg = h('div', { class: 'note' }, '');
  const save = () => {
    let parsed; try { parsed = JSON.parse(ta.value || '[]'); } catch (e) { msg.className = 'note bad'; msg.textContent = 'Invalid JSON: ' + e.message; return; }
    if (!Array.isArray(parsed)) { msg.className = 'note bad'; msg.textContent = 'Top level must be an array of rules'; return; }
    const errs = parsed.flatMap((r) => validateRule(r).map((e) => `${r && r.name}: ${e}`));
    if (errs.length) { msg.className = 'note bad'; msg.textContent = errs.join('\n'); return; }
    app.rules = parsed; saveRules(); app.models = null; app.bt = null; msg.className = 'note good'; msg.textContent = `Saved ${parsed.length} rules. Model will retrain on next view.`; toast('Rules saved');
  };
  host.append(h('div', { class: 'card' }, h('b', {}, 'Tumhare astrology rules'),
    h('p', { class: 'note' }, 'Rules prior ki tarah kaam karte hain: data support kare to weight badhta hai, na kare to engine unhe shrink kar deta hai (jab tak lock na ho).'),
    ta, h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn', onclick: save }, 'Validate & save'),
      h('button', { class: 'btn ghost', onclick: () => { ta.value = JSON.stringify(EXAMPLE_RULES, null, 2); } }, 'Load examples')), msg,
    h('details', {}, h('summary', {}, 'Rule syntax'), h('pre', { class: 'note', style: 'white-space:pre-wrap' }, RULE_HELP))));
  if (!app.rules.length || !app.bars.length) return;
  const box = h('div', { class: 'card' }); host.append(box);
  let m; try { m = await ensureModels(progressUI(box)); } catch (e) { box.innerHTML = ''; box.append(h('p', { class: 'note bad' }, e.message)); return; }
  box.remove();
  for (const layer of ['fast', 'slow']) {
    const tab = featureTable(m[layer].state, { minEpisodes: 0 }).filter((r) => r.family === 'rule');
    if (!tab.length) continue;
    host.append(h('h2', {}, `Data ne tumhare rules ka kya kiya (${layer})`),
      h('div', { class: 'card scroll' }, h('table', {}, h('thead', {}, h('tr', {}, ['Rule', 'Prior', 'Final w', 't', 'Eps'].map((x) => h('th', {}, x)))),
        h('tbody', {}, tab.map((r) => { const rule = app.rules.find((x) => `R|${x.name}` === r.id); const pr = rule ? (rule.direction || 0) * (rule.strength ?? 0.1) : 0;
          return h('tr', {}, h('td', { style: 'white-space:normal' }, rule ? rule.name : r.id, r.lock ? h('span', { class: 'tag' }, ' locked') : ''), h('td', {}, sgn(pr, 3)), h('td', { class: cls(r.w) }, sgn(r.w, 3)), h('td', {}, r.lock ? '—' : r.t.toFixed(1)), h('td', {}, r.lock ? '—' : r.ne)); })))));
  }
}

// ---------------------------------------------------------------- data + settings
function viewData(host) {
  const s = app.settings;
  const info = app.bars.length ? `${app.bars.length} days, ${app.bars[0].d} → ${app.bars[app.bars.length - 1].d}` : 'no data loaded';
  const paste = h('textarea', { placeholder: 'Date,Open,High,Low,Close\n2024-01-01,48000,48400,47800,48250', style: 'min-height:110px' });
  const file = h('input', { type: 'file', accept: '.csv,text/csv,text/plain' });
  const importText = async (text) => {
    try { const bars = parseCSV(text); app.bars = mergeBars(app.bars, bars); const ok = store.setText(`bars:${app.inst}`, toCSV(app.bars)); app.models = null; app.bt = null; await loadBarsMeta(); toast(`Imported ${bars.length} rows${ok ? '' : ' (storage full — not saved offline)'}`); render(); }
    catch (e) { toast(e.message, 5000); }
  };
  file.addEventListener('change', async () => { if (file.files[0]) importText(await file.files[0].text()); });
  host.append(h('div', { class: 'card' }, h('b', {}, 'Index data'), h('div', { class: 'note' }, info),
    h('label', {}, 'Instrument'), h('select', { onchange: async (e) => { app.inst = e.target.value; store.set('inst', app.inst); app.models = null; app.bt = null; await loadBars(); render(); } },
      Object.entries(INSTRUMENTS).map(([k, v]) => h('option', { value: k, selected: k === app.inst }, v))),
    h('label', {}, 'Import CSV file (Files app se)'), file, h('label', {}, 'Ya CSV paste karo'), paste,
    h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn', onclick: () => paste.value.trim() && importText(paste.value) }, 'Import pasted'),
      h('button', { class: 'btn ghost', onclick: () => { if (confirm('Delete stored data for this instrument?')) { store.setText(`bars:${app.inst}`, ''); app.bars = []; app.models = null; loadBarsMeta(); render(); } } }, 'Clear')),
    h('p', { class: 'note' }, 'Yahoo Finance (^NSEBANK, ^NSEI) ya NSE se download kiya hua daily CSV chalega. 8+ saal ka data best hai (warm-up 3 saal + test).')));

  const inp = (label, get, set, type = 'number', step = 'any') => h('div', {}, h('label', {}, label), h('input', { type, step, value: get(), onchange: (e) => { set(type === 'number' ? parseFloat(e.target.value) : e.target.value); saveSettings(); app.models = null; app.bt = null; } }));
  const sel = (label, opts, get, set) => h('div', {}, h('label', {}, label), h('select', { onchange: (e) => { set(e.target.value); saveSettings(); app.models = null; app.bt = null; } }, opts.map(([v, t]) => h('option', { value: v, selected: String(get()) === String(v) }, t))));
  const chk = (label, get, set) => h('label', { style: 'display:flex;gap:8px;align-items:center;margin:4px 0' }, h('input', { type: 'checkbox', style: 'width:auto', checked: get(), onchange: (e) => { set(e.target.checked); saveSettings(); app.models = null; app.bt = null; } }), label);
  host.append(h('h2', {}, 'Chart settings'), h('div', { class: 'card' }, h('div', { class: 'grid g2' },
    sel('Ayanamsa', [['lahiri', 'Lahiri (Chitrapaksha)'], ['kp', 'KP'], ['raman', 'Raman'], ['fagan', 'Fagan-Bradley']], () => s.ayanamsa, (v) => (s.ayanamsa = v)),
    sel('Houses counted from', [['lagna', 'Market-open lagna'], ['moon', 'Moon (Chandra lagna)'], ['fixed', 'Fixed rashi']], () => s.houseFrom, (v) => (s.houseFrom = v)),
    sel('Fixed lagna rashi', RASHIS.map((r, i) => [i, r]), () => s.fixedLagna, (v) => (s.fixedLagna = +v)),
    inp('Chart time (IST hours, 9.25 = 09:15)', () => s.snapshotHourIST, (v) => (s.snapshotHourIST = v)),
    inp('Latitude', () => s.lat, (v) => (s.lat = v)), inp('Longitude', () => s.lon, (v) => (s.lon = v)),
    inp('Western orb scale', () => s.orbScale, (v) => (s.orbScale = v))),
    chk('Include Abhijit nakshatra in Sarvatobhadra', () => s.useAbhijit, (v) => (s.useAbhijit = v)),
    h('label', {}, 'Factor families'), h('div', {}, ...Object.keys(s.families).map((k) => chk(k, () => s.families[k], (v) => (s.families[k] = v))))));

  host.append(h('h2', {}, 'Learning settings'), h('div', { class: 'card' }, h('div', { class: 'grid g2' },
    inp('Warm-up days (no trading before)', () => s.warmupDays, (v) => (s.warmupDays = Math.max(120, v))),
    inp('Re-estimate every N days', () => s.blockDays, (v) => (s.blockDays = Math.max(10, v))),
    inp('Adaptation speed η', () => s.eta, (v) => (s.eta = v)),
    inp('Slow horizon (trading days)', () => s.layers.slow.H, (v) => (s.layers.slow.H = Math.max(2, Math.round(v)))),
    inp('Shrinkage k (fast)', () => s.layers.fast.k, (v) => (s.layers.fast.k = v)), inp('Shrinkage k (slow)', () => s.layers.slow.k, (v) => (s.layers.slow.k = v)),
    inp('Min episodes to learn (fast)', () => s.layers.fast.minEp, (v) => (s.layers.fast.minEp = Math.max(2, v))), inp('Min episodes to learn (slow)', () => s.layers.slow.minEp, (v) => (s.layers.slow.minEp = Math.max(2, v))),
    inp('Min |t| to trust (fast)', () => s.layers.fast.tMin, (v) => (s.layers.fast.tMin = v)), inp('Min |t| to trust (slow)', () => s.layers.slow.tMin, (v) => (s.layers.slow.tMin = v))),
    chk('Adaptive: engine re-weighs planet groups itself', () => s.adaptive, (v) => (s.adaptive = v))));

  for (const layer of ['fast', 'slow']) {
    host.append(h('h2', {}, `Planet influence prior — ${s.layers[layer].label}`), h('div', { class: 'card' },
      h('div', { class: 'grid g3' }, Object.keys(s.layers[layer].priors).map((g) => inp(g, () => s.layers[layer].priors[g], (v) => (s.layers[layer].priors[g] = Math.max(0, v))))),
      h('p', { class: 'note' }, layer === 'fast' ? 'Tumhara observation: Moon > Venus > Mars. Sun/Mercury/Rahu/Ketu pending hain, isliye low prior — data decide karega.' : 'Saturn & Jupiter ko slow trend ka driver mana gaya hai.')));
  }

  const io = h('textarea', { style: 'min-height:90px' });
  host.append(h('h2', {}, 'Backup'), h('div', { class: 'card' },
    h('div', { class: 'row' }, h('button', { class: 'btn ghost', onclick: () => { io.value = JSON.stringify({ settings: app.settings, rules: app.rules }, null, 1); toast('Copy this JSON to back up'); } }, 'Export settings+rules'),
      h('button', { class: 'btn ghost', onclick: () => { try { const o = JSON.parse(io.value); if (o.settings) app.settings = mergeSettings(DEFAULT_SETTINGS, o.settings); if (o.rules) app.rules = o.rules; saveSettings(); saveRules(); app.models = null; toast('Imported'); render(); } catch (e) { toast('Bad JSON: ' + e.message, 4000); } } }, 'Import')), io,
    h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn ghost', onclick: () => { if (confirm('Reset all settings to defaults?')) { app.settings = mergeSettings(DEFAULT_SETTINGS, {}); saveSettings(); app.models = null; render(); } } }, 'Reset settings'))));
}
async function loadBarsMeta() { $('#instLabel').textContent = INSTRUMENTS[app.inst] || app.inst; setStatus(app.bars.length ? `${app.bars.length} days · till ${app.bars[app.bars.length - 1].d}` : 'no data — open Data tab'); }

// ---------------------------------------------------------------- boot
document.getElementById('tabs').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { app.tab = b.dataset.tab; render(); } });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
window.__app = app; // handy for debugging in Safari Web Inspector
loadBars().then(render);
