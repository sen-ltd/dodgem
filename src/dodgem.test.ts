import { describe, expect, it } from 'vitest';
import {
  BLUE, RED, WIN, LOSS, DRAW, solve, startPosition, lookup, listMoves, gameOver, bestMoves, decode,
  indexIn, type Solution,
} from './dodgem.ts';
import {
  djCell, djDiagram, diagram, replayLine, squareName, DJ_4X4_LINE, DJ_4X4_FINAL, DJ_4X4_SIMPLE,
  ERICKSON_P, FLEURY_HALF, GAMESCRAFTERS_3,
} from './literature.ts';

const s3 = solve(3);
const s4 = solve(4);

/** Reflect in the anti-diagonal: Blue's cars become Red's and vice versa. */
function reflect(n: number, B: number, R: number): { B: number; R: number } {
  const map = (m: number) => {
    let out = 0;
    for (let i = 0; i < n * n; i++) {
      if (m & (1 << i)) {
        const r = Math.floor(i / n);
        const c = i % n;
        out |= 1 << ((n - 1 - c) * n + (n - 1 - r));
      }
    }
    return out;
  };
  return { B: map(R), R: map(B) };
}

/**
 * An independent solver: no layers, no ranking, no un-moves. Jacobi value
 * iteration over a Map of every position; a position decided in sweep t has
 * depth t, which is exactly the depth the retrograde solver should report.
 */
function naiveSolve(n: number): Map<number, { val: number; dep: number }> {
  const N = n * n;
  const k = n - 1;
  const keys: number[] = [];
  const subsets = (avail: number[], size: number, from: number, acc: number, out: number[]) => {
    if (size === 0) return void out.push(acc);
    for (let i = from; i < avail.length; i++) subsets(avail, size - 1, i + 1, acc | (1 << avail[i]), out);
  };
  const all = [...Array(N).keys()];
  for (let a = 0; a <= k; a++) {
    const bs: number[] = [];
    subsets(all, a, 0, 0, bs);
    for (const B of bs) {
      const free = all.filter((i) => !(B & (1 << i)));
      for (let b = 0; b <= k; b++) {
        const rs: number[] = [];
        subsets(free, b, 0, 0, rs);
        for (const R of rs) for (let t = 0; t < 2; t++) keys.push((B * 2 ** N + R) * 2 + t);
      }
    }
  }
  const res = new Map<number, { val: number; dep: number }>();
  const unpack = (key: number) => {
    const t = key % 2;
    const pr = (key - t) / 2;
    return { B: Math.floor(pr / 2 ** N), R: pr % 2 ** N, t };
  };
  const key = (B: number, R: number, t: number) => (B * 2 ** N + R) * 2 + t;
  for (const kk of keys) {
    const { B, R, t } = unpack(kk);
    const mover = t === BLUE ? B : R;
    const other = t === BLUE ? R : B;
    if (other === 0) res.set(kk, { val: LOSS, dep: 0 });
    else if (mover === 0) res.set(kk, { val: WIN, dep: 0 });
    else if (listMoves(n, B, R, t).length === 0) res.set(kk, { val: WIN, dep: 0 });
  }
  for (let sweep = 1; ; sweep++) {
    const found: [number, number][] = [];
    for (const kk of keys) {
      if (res.has(kk)) continue;
      const { B, R, t } = unpack(kk);
      let anyLoss = false;
      let allWin = true;
      for (const m of listMoves(n, B, R, t)) {
        const r = res.get(key(m.B, m.R, t ^ 1));
        if (r && r.val === LOSS) anyLoss = true;
        if (!r || r.val !== WIN) allWin = false;
      }
      if (anyLoss) found.push([kk, WIN]);
      else if (allWin) found.push([kk, LOSS]);
    }
    if (found.length === 0) break;
    for (const [kk, v] of found) res.set(kk, { val: v, dep: sweep });
  }
  for (const kk of keys) if (!res.has(kk)) res.set(kk, { val: DRAW, dep: 0 });
  return res;
}

function everyState(sol: Solution, f: (B: number, R: number, t: number, val: number, dep: number) => void) {
  for (const row of sol.layers) {
    for (const L of row) {
      for (let i = 0; i < L.size; i++) {
        const s = decode(sol, L, i);
        f(s.B, s.R, s.turn, L.val[i], L.dep[i]);
      }
    }
  }
}

describe('state indexing', () => {
  it('decode and indexIn are inverse on every layer of the 4×4 board', () => {
    for (const row of s4.layers) {
      for (const L of row) {
        for (let i = 0; i < L.size; i++) {
          const s = decode(s4, L, i);
          expect(s.B & s.R).toBe(0);
          if (indexIn(s4, L, s.B, s.R, s.turn) !== i) throw new Error(`index ${i} of (${L.a},${L.b})`);
        }
      }
    }
  });
});

describe('retrograde solver', () => {
  for (const [n, sol] of [[3, s3], [4, s4]] as const) {
    it(`matches an independent value-iteration solver on every ${n}×${n} position (value and depth)`, () => {
      const naive = naiveSolve(n);
      let checked = 0;
      everyState(sol, (B, R, t, val, dep) => {
        const r = naive.get((B * 2 ** (n * n) + R) * 2 + t)!;
        if (r.val !== val || (val !== DRAW && r.dep !== dep)) {
          throw new Error(`B=${B} R=${R} t=${t}: ${val}/${dep} vs ${r.val}/${r.dep}`);
        }
        checked++;
      });
      expect(checked).toBe(naive.size);
    });
  }

  it('is symmetric under the anti-diagonal reflection that swaps the players', () => {
    for (const sol of [s3, s4]) {
      everyState(sol, (B, R, t, val, dep) => {
        const m = reflect(sol.n, B, R);
        const r = lookup(sol, m.B, m.R, t ^ 1);
        if (r.val !== val || r.dep !== dep) throw new Error(`asymmetric at ${B},${R},${t}`);
      });
    }
  });

  it('values agree with the moves: a win has a losing reply, a loss has none', () => {
    everyState(s4, (B, R, t, val, dep) => {
      if (gameOver(4, B, R, t) || B === 0 || R === 0) return;
      const replies = listMoves(4, B, R, t).map((m) => lookup(s4, m.B, m.R, t ^ 1));
      if (val === WIN) expect(replies.some((r) => r.val === LOSS && r.dep === dep - 1)).toBe(true);
      if (val === LOSS) expect(replies.every((r) => r.val === WIN)).toBe(true);
      if (val === DRAW) expect(replies.some((r) => r.val === DRAW) && !replies.some((r) => r.val === LOSS)).toBe(true);
    });
  });
});

describe('rules', () => {
  it('a player who cannot move has won, and the last car off wins', () => {
    // Red in the corner with Blue above it and to its right: Red cannot move.
    const boxed = diagram(['. . .', '> . .', '^ > .']);
    expect(gameOver(3, boxed.B, boxed.R, RED)).toBe('red');
    expect(gameOver(3, boxed.B, boxed.R, BLUE)).toBe(null);
    // Blue made the move that boxed Red in, so that move loses for Blue.
    const before = diagram(['. . .', '> > .', '^ . .']);
    const m = listMoves(3, before.B, before.R, BLUE).find((x) => x.B === boxed.B)!;
    expect(lookup(s3, m.B, m.R, RED).val).toBe(WIN);
    // Blue's last car drives off: Blue has won, whatever Red has left.
    const last = diagram(['. . >', '. . .', '^ ^ .']);
    const off = listMoves(3, last.B, last.R, BLUE).find((x) => x.to === -1)!;
    expect(off.B).toBe(0);
    expect(gameOver(3, off.B, off.R, RED)).toBe('blue');
    expect(lookup(s3, last.B, last.R, BLUE)).toEqual({ val: WIN, dep: 1 });
  });

  it('the starting position has n−1 cars each and the corner empty', () => {
    const { B, R } = startPosition(4);
    expect(B).toBe((1 << 0) | (1 << 4) | (1 << 8));
    expect(R).toBe((1 << 13) | (1 << 14) | (1 << 15));
  });
});

describe('literature', () => {
  it('3×3 is a first-player win (Winning Ways)', () => {
    const { B, R } = startPosition(3);
    expect(lookup(s3, B, R, BLUE).val).toBe(WIN);
    expect(lookup(s3, B, R, BLUE).dep).toBe(19);
  });

  it('GamesCrafters: 1,963 reachable 3×3 positions, 1,123 won and 840 lost for the mover', () => {
    const { B, R } = startPosition(3);
    const seen = new Set<number>();
    const tally = { win: 0, loss: 0, draw: 0 };
    const stack = [[B, R, BLUE]];
    seen.add((B * 512 + R) * 2);
    while (stack.length) {
      const [b, r, t] = stack.pop()!;
      const v = lookup(s3, b, r, t).val;
      tally[v === WIN ? 'win' : v === LOSS ? 'loss' : 'draw']++;
      if (gameOver(3, b, r, t)) continue;
      for (const m of listMoves(3, b, r, t)) {
        const key = (m.B * 512 + m.R) * 2 + (t ^ 1);
        if (!seen.has(key)) {
          seen.add(key);
          stack.push([m.B, m.R, t ^ 1]);
        }
      }
    }
    expect(seen.size).toBe(GAMESCRAFTERS_3.reachable);
    expect(tally).toEqual({ win: GAMESCRAFTERS_3.win, loss: GAMESCRAFTERS_3.loss, draw: 0 });
  });

  it('Fleury: 666 = half the 3×3 positions with both players on the board', () => {
    let both = 0;
    for (const row of s3.layers) for (const L of row) if (L.a > 0 && L.b > 0) both += L.size / 2;
    expect(both / 2).toBe(FLEURY_HALF);
  });

  it('Erickson: six 3×3 positions are second-player wins; two of his three diagrams are among them', () => {
    const P: string[] = [];
    for (const row of s3.layers) {
      for (const L of row) {
        if (L.a === 0 || L.b === 0) continue;
        for (let i = 0; i < L.size; i += 2) if (L.val[i] === LOSS && L.val[i + 1] === LOSS) P.push(`${decode(s3, L, i).B}/${decode(s3, L, i).R}`);
      }
    }
    expect(P.length).toBe(6);
    const [d1, d2, d3] = ERICKSON_P.map(diagram);
    expect(P).toContain(`${d1.B}/${d1.R}`);
    expect(P).toContain(`${d2.B}/${d2.R}`);
    // The third, as printed, is won by whoever moves, in 13 plies.
    expect(lookup(s3, d3.B, d3.R, BLUE)).toEqual({ val: WIN, dep: 13 });
    expect(lookup(s3, d3.B, d3.R, RED)).toEqual({ val: WIN, dep: 13 });
    const fix = diagram(['> > .', '^ ^ .', '. . .']);
    expect(P).toContain(`${fix.B}/${fix.R}`);
  });

  it('desJardins: the 4×4 start and his "simplest" drawn position are draws', () => {
    const { B, R } = startPosition(4);
    expect(lookup(s4, B, R, BLUE).val).toBe(DRAW);
    const p = djDiagram(4, DJ_4X4_SIMPLE);
    expect(lookup(s4, p.B, p.R, BLUE).val).toBe(DRAW);
  });

  it('desJardins: 1. b1-a1 loses on 4×4', () => {
    const { B, R } = startPosition(4);
    const m = listMoves(4, B, R, BLUE).find((x) => x.from === djCell(4, 'b1') && x.to === djCell(4, 'a1'))!;
    expect(lookup(s4, m.B, m.R, RED).val).toBe(WIN);
  });

  it('desJardins: his 4×4 drawing line — every "!" is the only drawing move, but 1… a4-b4 loses', () => {
    const { steps, B, R } = replayLine(s4, DJ_4X4_LINE);
    for (const st of steps.filter((x) => x.only)) expect(st.drawing).toBe(1);
    // Only one move is not legal as written: 12. d3-off (no car on d3); c4-off is meant.
    expect(steps.filter((x) => !x.legal).map((x) => [x.ply, x.text, x.played])).toEqual([[23, 'd3-off', 'c4-off']]);
    // Before 2. d2-d3 X is winning: O's first reply threw the draw away, X's second move gave it back.
    expect(steps.map((x) => x.value)).toEqual(steps.map((x) => (x.ply === 3 ? WIN : DRAW)));
    const fin = djDiagram(4, DJ_4X4_FINAL);
    expect([B, R]).toEqual([fin.B, fin.R]);
    expect(lookup(s4, B, R, BLUE).val).toBe(DRAW);
  });

  it('squareName inverts djCell', () => {
    for (const sq of ['a1', 'b1', 'd4', 'c3']) expect(squareName(4, djCell(4, sq))).toBe(sq);
  });
});

describe('perfect play', () => {
  it('the computer wins 3×3 from the start against every defence', () => {
    // Blue plays bestMoves[0]; Red tries every move. Blue must always win.
    const { B, R } = startPosition(3);
    const go = (b: number, r: number, t: number, plies: number): void => {
      const over = gameOver(3, b, r, t);
      if (over) return void expect(over).toBe('blue');
      expect(plies).toBeLessThan(40);
      if (t === BLUE) {
        const m = bestMoves(s3, b, r, BLUE)[0];
        expect(m.val).toBe(WIN);
        go(m.move.B, m.move.R, RED, plies + 1);
      } else {
        for (const m of listMoves(3, b, r, RED)) go(m.B, m.R, BLUE, plies + 1);
      }
    };
    go(B, R, BLUE, 0);
  });
});
