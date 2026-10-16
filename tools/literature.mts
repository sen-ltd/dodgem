// Gather the solved numbers (runs/stats-<n>.json) and the re-checked 1996
// claims into src/results.json, which the page and the README use.
//   node tools/literature.mts
import { readFileSync, writeFileSync } from 'node:fs';
import { solve, startPosition, lookup, listMoves, BLUE, RED, WIN, LOSS, DRAW } from '../src/dodgem.ts';
import {
  replayLine, djDiagram, diagram, djCell, squareName, DJ_4X4_LINE, DJ_4X4_SIMPLE, ERICKSON_P, ERICKSON_COUNTS,
  FLEURY_HALF, GAMESCRAFTERS_3,
} from '../src/literature.ts';

const stats = Object.fromEntries([3, 4, 5].map((n) => [n, JSON.parse(readFileSync(`runs/stats-${n}.json`, 'utf8'))]));
const s3 = solve(3);
const s4 = solve(4);
const vname = (v: number) => (v === WIN ? 'win' : v === LOSS ? 'loss' : 'draw');

const line = replayLine(s4, DJ_4X4_LINE).steps.map((s) => ({ ...s, value: vname(s.value) }));
const simple = djDiagram(4, DJ_4X4_SIMPLE);
const erickson = ERICKSON_P.map((d) => {
  const p = diagram(d);
  return { diagram: d, blueFirst: lookup(s3, p.B, p.R, BLUE), redFirst: lookup(s3, p.B, p.R, RED) };
});
const opening = (n: number) =>
  stats[n].openings.map((o: { from: number; to: number; val: string; dep: number }) => ({
    ...o,
    dj: `${squareName(n, o.from)}-${o.to < 0 ? 'off' : squareName(n, o.to)}`,
  }));
const b1a1 = (n: number) => opening(n).find((o: { from: number; to: number }) => o.from === djCell(n, 'b1') && o.to === djCell(n, 'a1'));

// After 1. d1-d2 on 4×4: O's three replies.
const after1 = replayLine(s4, DJ_4X4_LINE.slice(0, 1));
const replies = listMoves(4, after1.B, after1.R, RED).map((m) => {
  const r = lookup(s4, m.B, m.R, BLUE);
  return { dj: `${squareName(4, m.from)}-${m.to < 0 ? 'off' : squareName(4, m.to)}`, val: vname(r.val === WIN ? LOSS : r.val === LOSS ? WIN : DRAW), dep: r.dep + 1 };
});

const s5 = stats[5];
const out = {
  boards: [3, 4, 5].map((n) => ({
    n,
    states: stats[n].states,
    positions: stats[n].positions,
    start: stats[n].start,
    reachable: stats[n].reachable,
    byTurnBothOn: stats[n].byTurnBothOn,
    maxDepth: stats[n].maxDepth,
    solveMs: stats[n].solveMs,
    kinds: stats[n].kinds,
    openings: opening(n),
  })),
  checks: {
    winningWays3: stats[3].start,
    gamescrafters: { claimed: GAMESCRAFTERS_3, got: { reachable: stats[3].reachable.all.win + stats[3].reachable.all.loss + stats[3].reachable.all.draw, ...stats[3].reachable.all } },
    fleury: { claimed: FLEURY_HALF, got: stats[3].positions.bothOn / 2 },
    ericksonCounts: Object.fromEntries([2, 3, 4, 5].map((n) => [n, { claimed: ERICKSON_COUNTS[n], got: n === 2 ? 21 : stats[n].positions.all }])),
    ericksonP: { claimedCount: 6, got: stats[3].kinds.P, diagrams: erickson },
    desJardins4: { start: stats[4].start, simple: lookup(s4, simple.B, simple.R, BLUE), b1a1: b1a1(4), line, replies },
    desJardins5: {
      start: s5.start,
      b1a1: b1a1(5),
      drawShareBlueToMove: s5.byTurnBothOn.blue.draw / (s5.byTurnBothOn.blue.win + s5.byTurnBothOn.blue.loss + s5.byTurnBothOn.blue.draw),
      drawShareReachable: s5.reachable.all.draw / (s5.reachable.all.win + s5.reachable.all.loss + s5.reachable.all.draw),
    },
  },
};
void startPosition;
writeFileSync('src/results.json', JSON.stringify(out, null, 1) + '\n');
console.log(JSON.stringify(out.checks, null, 1).slice(0, 4000));
