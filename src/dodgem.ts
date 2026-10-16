// Dodgem (Colin Vout, 1972) on an n×n board, solved by retrograde analysis.
//
// Cells are numbered i = r·n + c with r = 0 the top row and c = 0 the left
// column. Blue ("Left", moves first) starts with n−1 cars on the left edge
// above the bottom-left corner and drives right, up or down; a car on the
// right edge may drive off. Red ("Bottom") starts on the bottom edge right of
// the corner and drives up, left or right; a car on the top edge may drive
// off. You win by getting all your cars off, and you lose if your move leaves
// the opponent without a legal move — so a player who cannot move has won.
//
// A position is (Blue's cars, Red's cars, side to move). Every value is from
// the side to move's point of view: WIN, LOSS or DRAW (perfect play never
// ends), with the number of plies to the end for WIN and LOSS.

export const BLUE = 0;
export const RED = 1;
export const WIN = 1;
export const LOSS = 2;
export const DRAW = 3;
const TWIN = 4; // tentative: a win is known, the shortest one may still shrink
const TLOSS = 5; // tentative: every move loses, waiting for its depth bucket

export interface Layer {
  a: number; // Blue cars on the board
  b: number; // Red cars on the board
  cr: number; // C(N − a, b): red placements per blue placement
  size: number; // 2 · C(N, a) · C(N − a, b)
  val: Uint8Array;
  dep: Uint16Array;
}

export interface Solution {
  n: number;
  N: number;
  C: number[][];
  layers: Layer[][];
}

export function binomials(N: number): number[][] {
  const C: number[][] = [];
  for (let i = 0; i <= N; i++) {
    C.push(new Array(N + 2).fill(0));
    C[i][0] = 1;
    for (let j = 1; j <= i; j++) C[i][j] = C[i - 1][j - 1] + (j < i ? C[i - 1][j] : 0);
  }
  return C;
}

export function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24);
}

export function startPosition(n: number): { B: number; R: number } {
  let B = 0;
  let R = 0;
  for (let r = 0; r < n - 1; r++) B |= 1 << (r * n);
  for (let c = 1; c < n; c++) R |= 1 << ((n - 1) * n + c);
  return { B, R };
}

/** Legal moves of the side to move, written into oB / oR. Returns how many. */
export function genMoves(n: number, B: number, R: number, turn: number, oB: Int32Array, oR: Int32Array): number {
  const occ = B | R;
  let k = 0;
  if (turn === BLUE) {
    let m = B;
    while (m) {
      const low = m & -m;
      m ^= low;
      const i = 31 - Math.clz32(low);
      const r = (i / n) | 0;
      const c = i - r * n;
      const rest = B ^ low;
      if (c === n - 1) {
        oB[k] = rest; oR[k++] = R;
      } else if (!(occ & (low << 1))) {
        oB[k] = rest | (low << 1); oR[k++] = R;
      }
      if (r > 0 && !(occ & (low >>> n))) { oB[k] = rest | (low >>> n); oR[k++] = R; }
      if (r < n - 1 && !(occ & (low << n))) { oB[k] = rest | (low << n); oR[k++] = R; }
    }
  } else {
    let m = R;
    while (m) {
      const low = m & -m;
      m ^= low;
      const i = 31 - Math.clz32(low);
      const r = (i / n) | 0;
      const c = i - r * n;
      const rest = R ^ low;
      if (r === 0) {
        oB[k] = B; oR[k++] = rest;
      } else if (!(occ & (low >>> n))) {
        oB[k] = B; oR[k++] = rest | (low >>> n);
      }
      if (c > 0 && !(occ & (low >>> 1))) { oB[k] = B; oR[k++] = rest | (low >>> 1); }
      if (c < n - 1 && !(occ & (low << 1))) { oB[k] = B; oR[k++] = rest | (low << 1); }
    }
  }
  return k;
}

/**
 * Positions that reach (B, R) with one on-board move of `mover` (no car
 * entering from off the board). The predecessor has `mover` to move.
 */
function genUnmoves(n: number, B: number, R: number, mover: number, oB: Int32Array, oR: Int32Array): number {
  const occ = B | R;
  let k = 0;
  if (mover === BLUE) {
    let m = B;
    while (m) {
      const low = m & -m;
      m ^= low;
      const i = 31 - Math.clz32(low);
      const r = (i / n) | 0;
      const c = i - r * n;
      const rest = B ^ low;
      if (c > 0 && !(occ & (low >>> 1))) { oB[k] = rest | (low >>> 1); oR[k++] = R; } // drove right
      if (r < n - 1 && !(occ & (low << n))) { oB[k] = rest | (low << n); oR[k++] = R; } // drove up
      if (r > 0 && !(occ & (low >>> n))) { oB[k] = rest | (low >>> n); oR[k++] = R; } // drove down
    }
  } else {
    let m = R;
    while (m) {
      const low = m & -m;
      m ^= low;
      const i = 31 - Math.clz32(low);
      const r = (i / n) | 0;
      const c = i - r * n;
      const rest = R ^ low;
      if (r < n - 1 && !(occ & (low << n))) { oB[k] = B; oR[k++] = rest | (low << n); } // drove up
      if (c < n - 1 && !(occ & (low << 1))) { oB[k] = B; oR[k++] = rest | (low << 1); } // drove left
      if (c > 0 && !(occ & (low >>> 1))) { oB[k] = B; oR[k++] = rest | (low >>> 1); } // drove right
    }
  }
  return k;
}

/** Colex rank of the set bits of B among all popcount(B)-subsets. */
function rankBlue(C: number[][], B: number): number {
  let r = 0;
  let j = 1;
  let m = B;
  while (m) {
    const low = m & -m;
    m ^= low;
    r += C[31 - Math.clz32(low)][j++];
  }
  return r;
}

/** Colex rank of R among subsets of the cells not in B. */
function rankRed(C: number[][], B: number, R: number): number {
  let r = 0;
  let j = 1;
  let m = R;
  while (m) {
    const low = m & -m;
    m ^= low;
    const i = 31 - Math.clz32(low);
    r += C[i - popcount(B & (low - 1))][j++];
  }
  return r;
}

function unrankColex(C: number[][], rank: number, k: number, top: number): number {
  let mask = 0;
  let x = top;
  for (let j = k; j >= 1; j--) {
    while (C[x][j] > rank) x--;
    mask |= 1 << x;
    rank -= C[x][j];
    x--;
  }
  return mask;
}

/** Spread the low bits of `comp` over the cells not in B. */
function deposit(N: number, B: number, comp: number): number {
  let R = 0;
  let cell = 0;
  for (let i = 0; comp; i++) {
    while (B & (1 << cell)) cell++;
    if (comp & 1) R |= 1 << cell;
    comp >>>= 1;
    cell++;
  }
  void N;
  return R;
}

export function indexIn(sol: Solution, L: Layer, B: number, R: number, turn: number): number {
  return (rankBlue(sol.C, B) * L.cr + rankRed(sol.C, B, R)) * 2 + turn;
}

export function layerOf(sol: Solution, B: number, R: number): Layer {
  return sol.layers[popcount(B)][popcount(R)];
}

export function decode(sol: Solution, L: Layer, idx: number): { B: number; R: number; turn: number } {
  const turn = idx & 1;
  const pair = (idx - turn) / 2;
  const rR = pair % L.cr;
  const rB = (pair - rR) / L.cr;
  const B = unrankColex(sol.C, rB, L.a, sol.N - 1);
  const R = deposit(sol.N, B, unrankColex(sol.C, rR, L.b, sol.N - L.a - 1));
  return { B, R, turn };
}

export function lookup(sol: Solution, B: number, R: number, turn: number): { val: number; dep: number } {
  const L = layerOf(sol, B, R);
  const i = indexIn(sol, L, B, R, turn);
  return { val: L.val[i], dep: L.dep[i] };
}

function nextCombo(x: number): number {
  // Gosper's hack: the next larger integer with the same popcount.
  const c = x & -x;
  const r = x + c;
  return (((r ^ x) >>> 2) / c) | r;
}

class Bucket {
  arr = new Int32Array(1024);
  len = 0;
  push(v: number) {
    if (this.len === this.arr.length) {
      const g = new Int32Array(this.arr.length * 2);
      g.set(this.arr);
      this.arr = g;
    }
    this.arr[this.len++] = v;
  }
}

export interface SolveOptions {
  onLayer?: (L: Layer, ms: number) => void;
}

export function solve(n: number, opts: SolveOptions = {}): Solution {
  if (n < 2 || n > 5) throw new Error('board size must be 2..5');
  const N = n * n;
  const k = n - 1;
  const C = binomials(N);
  const layers: Layer[][] = [];
  for (let a = 0; a <= k; a++) {
    layers.push([]);
    for (let b = 0; b <= k; b++) {
      const cr = C[N - a][b];
      const size = 2 * C[N][a] * cr;
      layers[a].push({ a, b, cr, size, val: new Uint8Array(0), dep: new Uint16Array(0) });
    }
  }
  const sol: Solution = { n, N, C, layers };
  for (let s = 0; s <= 2 * k; s++) {
    for (let a = Math.max(0, s - k); a <= Math.min(k, s); a++) {
      const t0 = Date.now();
      solveLayer(sol, layers[a][s - a]);
      opts.onLayer?.(layers[a][s - a], Date.now() - t0);
    }
  }
  return sol;
}

function solveLayer(sol: Solution, L: Layer): void {
  const { n, N, C } = sol;
  const { a, b, cr, size } = L;
  const val = new Uint8Array(size);
  const dep = new Uint16Array(size);
  L.val = val;
  L.dep = dep;

  if (a === 0 || b === 0) {
    // Somebody has no cars left. The side whose cars are all gone has won;
    // with both gone (never reached in play) call it a loss for the mover.
    for (let idx = 0; idx < size; idx++) {
      const turn = idx & 1;
      const moverEmpty = turn === BLUE ? a === 0 : b === 0;
      const otherEmpty = turn === BLUE ? b === 0 : a === 0;
      val[idx] = otherEmpty || !moverEmpty ? LOSS : WIN;
    }
    return;
  }

  const cnt = new Uint8Array(size);
  const buckets: Bucket[] = [];
  const push = (d: number, idx: number) => {
    while (buckets.length <= d) buckets.push(new Bucket());
    buckets[d].push(idx);
  };
  const mB = new Int32Array(16);
  const mR = new Int32Array(16);
  const below = (B2: number, R2: number, turn: number): number => {
    const L2 = sol.layers[popcount(B2)][popcount(R2)];
    return (rankBlue(C, B2) * L2.cr + rankRed(C, B2, R2)) * 2 + turn;
  };

  // Seed: every position's moves out of the layer are already solved.
  const freeCells = N - a;
  let B = (1 << a) - 1;
  for (let rB = 0; B < 1 << N; rB++, B = nextCombo(B)) {
    let comp = (1 << b) - 1;
    for (let rR = 0; comp < 1 << freeCells; rR++, comp = nextCombo(comp)) {
      const R = deposit(N, B, comp);
      for (let turn = 0; turn < 2; turn++) {
        const idx = (rB * cr + rR) * 2 + turn;
        const nm = genMoves(n, B, R, turn, mB, mR);
        if (nm === 0) {
          // The opponent left us without a move: we have won, at once.
          val[idx] = TWIN;
          push(0, idx);
          continue;
        }
        let c = 0;
        let minL = 0x10000;
        let maxW = -1;
        for (let q = 0; q < nm; q++) {
          const B2 = mB[q];
          const R2 = mR[q];
          if (popcount(B2) === a && popcount(R2) === b) {
            c++;
            continue;
          }
          const L2 = sol.layers[popcount(B2)][popcount(R2)];
          const j = below(B2, R2, turn ^ 1);
          const v = L2.val[j];
          if (v === LOSS) minL = Math.min(minL, L2.dep[j]);
          else if (v === WIN) maxW = Math.max(maxW, L2.dep[j]);
          else c++; // a draw below: this position can never be lost
        }
        cnt[idx] = c;
        if (minL < 0x10000) {
          val[idx] = TWIN;
          dep[idx] = minL + 1;
          push(minL + 1, idx);
        } else if (c === 0) {
          val[idx] = TLOSS;
          dep[idx] = maxW + 1;
          push(maxW + 1, idx);
        }
      }
    }
  }

  // Retrograde sweep inside the layer, one depth at a time.
  const pB = new Int32Array(16);
  const pR = new Int32Array(16);
  const rankHere = (B2: number, R2: number, turn: number) => (rankBlue(C, B2) * cr + rankRed(C, B2, R2)) * 2 + turn;
  for (let d = 0; d < buckets.length; d++) {
    const bk = buckets[d];
    for (let t = 0; t < bk.len; t++) {
      const idx = bk.arr[t];
      const v = val[idx];
      if (v !== TWIN && v !== TLOSS) continue;
      if (dep[idx] !== d) continue;
      const won = v === TWIN;
      val[idx] = won ? WIN : LOSS;
      const s = decode(sol, L, idx);
      const prevMover = s.turn ^ 1;
      const np = genUnmoves(n, s.B, s.R, prevMover, pB, pR);
      for (let q = 0; q < np; q++) {
        const p = rankHere(pB[q], pR[q], prevMover);
        const pv = val[p];
        if (pv === WIN || pv === LOSS) continue;
        if (!won) {
          if (pv === TWIN && dep[p] <= d + 1) continue;
          val[p] = TWIN;
          dep[p] = d + 1;
          push(d + 1, p);
        } else {
          if (pv === TWIN) continue;
          if (--cnt[p] === 0) {
            // Every move from p loses; it lasts as long as the longest one.
            let maxW = d;
            const nm = genMoves(n, pB[q], pR[q], prevMover, mB, mR);
            for (let r = 0; r < nm; r++) {
              const B2 = mB[r];
              const R2 = mR[r];
              if (popcount(B2) === a && popcount(R2) === b) continue;
              const L2 = sol.layers[popcount(B2)][popcount(R2)];
              maxW = Math.max(maxW, L2.dep[below(B2, R2, prevMover ^ 1)]);
            }
            val[p] = TLOSS;
            dep[p] = maxW + 1;
            push(maxW + 1, p);
          }
        }
      }
    }
    buckets[d] = new Bucket();
  }
  for (let idx = 0; idx < size; idx++) if (val[idx] === 0) val[idx] = DRAW;
}

export interface Move {
  from: number; // cell
  to: number; // cell, or −1 for driving off the board
  B: number;
  R: number;
}

export function listMoves(n: number, B: number, R: number, turn: number): Move[] {
  const mB = new Int32Array(16);
  const mR = new Int32Array(16);
  const nm = genMoves(n, B, R, turn, mB, mR);
  const out: Move[] = [];
  for (let q = 0; q < nm; q++) {
    const before = turn === BLUE ? B : R;
    const after = turn === BLUE ? mB[q] : mR[q];
    const gone = before & ~after;
    const came = after & ~before;
    out.push({ from: 31 - Math.clz32(gone), to: came ? 31 - Math.clz32(came) : -1, B: mB[q], R: mR[q] });
  }
  return out;
}

/**
 * The game is over at (B, R) with `turn` to move when the player who just
 * moved has no cars left (they won) or the side to move has no move (the
 * opponent forfeited, so the side to move has won).
 */
export function gameOver(n: number, B: number, R: number, turn: number): 'blue' | 'red' | null {
  if (turn === RED && B === 0) return 'blue';
  if (turn === BLUE && R === 0) return 'red';
  if (listMoves(n, B, R, turn).length === 0) return turn === BLUE ? 'blue' : 'red';
  return null;
}

/** Perfect play: shortest win, longest loss, otherwise a drawing move. */
export function bestMoves(sol: Solution, B: number, R: number, turn: number): { move: Move; val: number; dep: number }[] {
  const scored = listMoves(sol.n, B, R, turn).map((move) => {
    const r = lookup(sol, move.B, move.R, turn ^ 1);
    // Our result is the opposite of the opponent's.
    const v = r.val === WIN ? LOSS : r.val === LOSS ? WIN : DRAW;
    return { move, val: v, dep: r.dep + 1 };
  });
  const score = (x: { val: number; dep: number }) =>
    x.val === WIN ? 100000 - x.dep : x.val === DRAW ? 0 : -100000 + x.dep;
  scored.sort((x, y) => score(y) - score(x));
  return scored;
}
