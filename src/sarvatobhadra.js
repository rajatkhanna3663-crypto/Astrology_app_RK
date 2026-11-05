// Sarvatobhadra Chakra (9x9) — nakshatra/rashi cells and vedha (cross-lines of influence).
//
// LAYOUT NOTE: this is a reconstruction of the classical chart that keeps the parts that matter for vedha:
//  * outer ring: the 28 nakshatras (incl. Abhijit), 7 per side, clockwise from the top-left, Krittika first;
//    the 4 corners are vowel cells (no nakshatra)
//  * second ring: the 12 rashis, 3 per side (Mesha..Meena clockwise from top-middle)
// If your chart differs, edit `NAK_CELLS` / `RASHI_CELLS` below (or override from the Rules tab -> "sbc layout"),
// everything else (vedha, features, backtest) follows automatically.
import { NAKSHATRAS, isAbhijit, PLANETS } from './jyotish.js';

export const ABHIJIT_NAME = 'Abhijit';
const NAK_ORDER_CLOCKWISE = [
  'Krittika', 'Rohini', 'Mrigashira', 'Ardra', 'Punarvasu', 'Pushya', 'Ashlesha',
  'Magha', 'Purva Phalguni', 'Uttara Phalguni', 'Hasta', 'Chitra', 'Swati', 'Vishakha',
  'Anuradha', 'Jyeshtha', 'Mula', 'Purva Ashadha', 'Uttara Ashadha', ABHIJIT_NAME, 'Shravana', 'Dhanishta',
  'Shatabhisha', 'Purva Bhadrapada', 'Uttara Bhadrapada', 'Revati', 'Ashwini', 'Bharani',
];

function ringCoords() {
  const cells = [];
  for (let c = 1; c <= 7; c++) cells.push([0, c]);          // top, left -> right
  for (let r = 1; r <= 7; r++) cells.push([r, 8]);          // right, top -> bottom
  for (let c = 7; c >= 1; c--) cells.push([8, c]);          // bottom, right -> left
  for (let r = 7; r >= 1; r--) cells.push([r, 0]);          // left, bottom -> top
  return cells;
}

export const NAK_CELLS = {};
ringCoords().forEach(([r, c], i) => { NAK_CELLS[NAK_ORDER_CLOCKWISE[i]] = [r, c]; });

const RASHI_COORDS = [
  [1, 3], [1, 4], [1, 5],
  [3, 7], [4, 7], [5, 7],
  [7, 5], [7, 4], [7, 3],
  [5, 1], [4, 1], [3, 1],
];
export const RASHI_CELLS = RASHI_COORDS; // index = rashi 0..11

/** grid[r][c] = {kind:'nak'|'rashi'|'other', label, id} */
export function buildGrid() {
  const g = Array.from({ length: 9 }, () => Array.from({ length: 9 }, () => ({ kind: 'other', label: '·' })));
  for (const [name, [r, c]] of Object.entries(NAK_CELLS)) g[r][c] = { kind: 'nak', label: name, id: name };
  RASHI_CELLS.forEach(([r, c], i) => { g[r][c] = { kind: 'rashi', label: String(i + 1), id: i }; });
  for (const [r, c] of [[0, 0], [0, 8], [8, 0], [8, 8]]) g[r][c] = { kind: 'other', label: 'अ' };
  return g;
}

export const nakNameOf = (planet) => (planet.abhijit ? ABHIJIT_NAME : NAKSHATRAS[planet.nak]);

const sameLine = ([r1, c1], [r2, c2]) =>
  r1 === r2 || c1 === c2 || Math.abs(r1 - r2) === Math.abs(c1 - c2);

/**
 * Vedha map. A planet standing on a cell strikes every cell sharing its row, column or diagonal.
 * Returns:
 *  cells:   { planet: {nak:[r,c], rashi:[r,c]} }
 *  vedha:   [{from, to, via:'nak'|'rashi'}]   (to is another planet whose nak cell is struck; same cell counts)
 */
export function sbcAnalysis(snapshot, { useAbhijit = true } = {}) {
  const cells = {};
  for (const p of PLANETS) {
    const pl = snapshot.planets[p];
    const nakName = useAbhijit ? nakNameOf(pl) : NAKSHATRAS[pl.nak];
    cells[p] = { nakName, nak: NAK_CELLS[nakName], rashi: RASHI_CELLS[pl.rashi] };
  }
  const vedha = [];
  for (const a of PLANETS) {
    for (const b of PLANETS) {
      if (a === b) continue;
      if (sameLine(cells[a].nak, cells[b].nak)) vedha.push({ from: a, to: b, via: 'nak' });
      if (sameLine(cells[a].rashi, cells[b].rashi)) vedha.push({ from: a, to: b, via: 'rashi' });
    }
  }
  return { cells, vedha };
}
