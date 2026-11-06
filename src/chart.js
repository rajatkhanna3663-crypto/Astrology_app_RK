// North Indian kundli as SVG (houses fixed in place: 1 = top diamond, then anticlockwise; sign numbers rotate).
const NORTH = [
  { kind: 'dia', poly: '200,200 100,100 200,0 300,100', num: [200, 178], at: [200, 96] },
  { kind: 'h', poly: '0,0 200,0 100,100', num: [100, 86], at: [100, 26] },
  { kind: 'v', poly: '0,0 100,100 0,200', num: [84, 100], at: [34, 100] },
  { kind: 'dia', poly: '0,200 100,100 200,200 100,300', num: [176, 200], at: [92, 200] },
  { kind: 'v', poly: '0,200 100,300 0,400', num: [84, 300], at: [34, 300] },
  { kind: 'h', poly: '0,400 100,300 200,400', num: [100, 314], at: [100, 374] },
  { kind: 'dia', poly: '200,400 100,300 200,200 300,300', num: [200, 222], at: [200, 304] },
  { kind: 'h', poly: '200,400 300,300 400,400', num: [300, 314], at: [300, 374] },
  { kind: 'v', poly: '400,400 300,300 400,200', num: [316, 300], at: [366, 300] },
  { kind: 'dia', poly: '400,200 300,300 200,200 300,100', num: [224, 200], at: [306, 200] },
  { kind: 'v', poly: '400,200 300,100 400,0', num: [316, 100], at: [366, 100] },
  { kind: 'h', poly: '400,0 300,100 200,0', num: [300, 86], at: [300, 26] },
];
const LINES = 'M0 0H400V400H0Z M0 0L400 400 M400 0L0 400 M200 0L400 200L200 400L0 200Z';
const perRow = (kind, n) => (kind === 'dia' ? (n <= 3 ? 1 : n <= 6 ? 2 : 3) : kind === 'h' ? (n <= 1 ? 1 : n <= 4 ? 2 : 3) : n <= 6 ? 1 : 2);
const width = (it) => 42 + (it.retro ? 7 : 0);

function place(items, at, kind) {
  if (!items.length) return '';
  const pr = perRow(kind, items.length), rows = [];
  for (let i = 0; i < items.length; i += pr) rows.push(items.slice(i, i + pr));
  const y0 = at[1] - ((rows.length - 1) * 17) / 2;
  let out = '';
  rows.forEach((row, ri) => {
    const total = row.reduce((a, it) => a + width(it), 0);
    let x = Math.min(398 - total, Math.max(2, at[0] - total / 2));
    for (const it of row) {
      out += `<text class="pl pl-${it.cls}" x="${x.toFixed(1)}" y="${(y0 + ri * 17).toFixed(1)}" dy=".35em">${it.abbr}<tspan class="dg" dx="2">${Math.floor(it.deg)}°</tspan>${it.retro ? '<tspan class="fl" dx="1">R</tspan>' : ''}</text>`;
      x += width(it);
    }
  });
  return out;
}

export function chartSVG(grid, label) {
  let fill = '', nums = '', items = '';
  grid.forEach((g, i) => {
    const L = NORTH[i];
    fill += `<polygon class="hs${i === 0 ? ' h1' : ''}" points="${L.poly}"/>`;
    nums += `<text class="num${i === 0 ? ' n1' : ''}" x="${L.num[0]}" y="${L.num[1]}" dy=".35em" text-anchor="middle">${g.rashi + 1}</text>`;
    items += place(g.items, L.at, L.kind);
  });
  return `<svg class="kc" viewBox="0 0 400 400" role="img" aria-label="${label}">${fill}<path class="ln" d="${LINES}"/>${nums}${items}</svg>`;
}
