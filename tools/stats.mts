// Solve n×n Dodgem and write every number the article and the page use.
//   node tools/stats.mts <n>   →  runs/stats-<n>.json
import { writeFileSync, mkdirSync } from 'node:fs';
import {
  BLUE, RED, WIN, LOSS, DRAW, solve, startPosition, lookup, popcount, genMoves, decode, indexIn,
  type Solution, type Layer,
} from '../src/dodgem.ts';

const n = Number(process.argv[2] ?? 3);
const t0 = Date.now();
const layerTimes: { a: number; b: number; states: number; ms: number }[] = [];
const sol: Solution = solve(n, {
  onLayer: (L, ms) => {
    layerTimes.push({ a: L.a, b: L.b, states: L.size, ms });
    if (n >= 5) console.error(`layer (${L.a},${L.b}) ${L.size} states ${ms} ms`);
  },
});
const solveMs = Date.now() - t0;
const N = n * n;
const k = n - 1;
const name = (v: number) => (v === WIN ? 'win' : v === LOSS ? 'loss' : 'draw');

// --- whole state space -------------------------------------------------------
const flat: Layer[] = sol.layers.flat();
const tally = () => ({ win: 0, loss: 0, draw: 0 });
const byTurn = [tally(), tally()];
const byTurnBothOn = [tally(), tally()];
let maxDep = 0;
for (const L of flat) {
  for (let i = 0; i < L.size; i++) {
    const v = L.val[i];
    byTurn[i & 1][name(v)]++;
    if (L.a > 0 && L.b > 0) {
      byTurnBothOn[i & 1][name(v)]++;
      if (v !== DRAW) maxDep = Math.max(maxDep, L.dep[i]);
    }
  }
}

// Positions without a side to move: how many there are, and what kind of
// game each is (Winning Ways' table): Blue wins whoever starts (L), Red wins
// whoever starts (R), the player to move wins (N), the other one wins (P),
// or one of the two starts is a draw.
let positionsAll = 0;
let positionsBothOn = 0;
const kinds: Record<string, number> = {};
const pPositions: { B: number; R: number }[] = [];
for (const L of flat) {
  positionsAll += L.size / 2;
  if (L.a === 0 || L.b === 0) continue;
  positionsBothOn += L.size / 2;
  for (let i = 0; i < L.size; i += 2) {
    const vb = L.val[i]; // Blue to move
    const vr = L.val[i + 1]; // Red to move
    const blueFirst = vb === WIN ? 'B' : vb === LOSS ? 'R' : 'D';
    const redFirst = vr === WIN ? 'R' : vr === LOSS ? 'B' : 'D';
    let kind: string;
    if (blueFirst === 'D' || redFirst === 'D') kind = `draw(${blueFirst}${redFirst})`;
    else if (blueFirst === 'B' && redFirst === 'B') kind = 'L';
    else if (blueFirst === 'R' && redFirst === 'R') kind = 'R';
    else if (blueFirst === 'B' && redFirst === 'R') kind = 'N';
    else kind = 'P';
    kinds[kind] = (kinds[kind] ?? 0) + 1;
    if (kind === 'P' && pPositions.length < 64) {
      const s = decode(sol, L, i);
      pPositions.push({ B: s.B, R: s.R });
    }
  }
}

// --- reachable from the start, Blue first -----------------------------------
const offsets: number[] = [];
let total = 0;
for (const L of flat) {
  offsets.push(total);
  total += L.size;
}
const layerAt = (g: number) => {
  let lo = 0;
  let hi = flat.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= g) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};
const globalOf = (B: number, R: number, turn: number) => {
  const li = popcount(B) * (k + 1) + popcount(R);
  return offsets[li] + indexIn(sol, flat[li], B, R, turn);
};
const seen = new Uint32Array(Math.ceil(total / 32));
const mark = (g: number) => {
  if (seen[g >>> 5] & (1 << (g & 31))) return false;
  seen[g >>> 5] |= 1 << (g & 31);
  return true;
};
const mB = new Int32Array(16);
const mR = new Int32Array(16);
const reach = { all: tally(), live: tally(), over: tally(), plies: 0 };
const start = startPosition(n);
let frontier = [globalOf(start.B, start.R, BLUE)];
mark(frontier[0]);
while (frontier.length) {
  const next: number[] = [];
  for (const g of frontier) {
    const li = layerAt(g);
    const L = flat[li];
    const idx = g - offsets[li];
    const v = name(L.val[idx]);
    reach.all[v]++;
    const s = decode(sol, L, idx);
    const finished = (s.turn === RED && s.B === 0) || (s.turn === BLUE && s.R === 0);
    const nm = finished ? 0 : genMoves(n, s.B, s.R, s.turn, mB, mR);
    if (nm === 0) {
      reach.over[v]++;
      continue;
    }
    reach.live[v]++;
    for (let q = 0; q < nm; q++) {
      const h = globalOf(mB[q], mR[q], s.turn ^ 1);
      if (mark(h)) next.push(h);
    }
  }
  frontier = next;
  if (frontier.length) reach.plies++;
}

// --- the opening ------------------------------------------------------------
const startVal = lookup(sol, start.B, start.R, BLUE);
const openings: { from: number; to: number; val: string; dep: number }[] = [];
{
  const nm = genMoves(n, start.B, start.R, BLUE, mB, mR);
  for (let q = 0; q < nm; q++) {
    const r = lookup(sol, mB[q], mR[q], RED);
    const gone = start.B & ~mB[q];
    const came = mB[q] & ~start.B;
    openings.push({
      from: 31 - Math.clz32(gone),
      to: came ? 31 - Math.clz32(came) : -1,
      val: r.val === WIN ? 'loss' : r.val === LOSS ? 'win' : 'draw', // for Blue
      dep: r.dep + 1,
    });
  }
}

const out = {
  n,
  cars: k,
  solveMs,
  layerTimes,
  states: total,
  positions: { all: positionsAll, bothOn: positionsBothOn },
  byTurn: { blue: byTurn[BLUE], red: byTurn[RED] },
  byTurnBothOn: { blue: byTurnBothOn[BLUE], red: byTurnBothOn[RED] },
  maxDepth: maxDep,
  kinds,
  pPositions,
  reachable: reach,
  start: { val: name(startVal.val), dep: startVal.dep },
  openings,
};
mkdirSync('runs', { recursive: true });
writeFileSync(`runs/stats-${n}.json`, JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify({ n, solveMs, states: total, start: out.start, reachable: reach, kinds }, null, 0));
void N;
