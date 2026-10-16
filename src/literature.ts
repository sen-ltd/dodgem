// Claims from the 1996 rec.games.abstract thread "'Dodgem' . . . any info?"
// (archived by David Eppstein, https://www.ics.uci.edu/~eppstein/cgt/dodgem.html)
// and the GamesCrafters analysis, written down so they can be re-checked.
import { BLUE, RED, DRAW, listMoves, lookup, type Solution } from './dodgem.ts';

/**
 * desJardins writes positions with X moving up from the bottom edge and O
 * moving right from the left edge, X to move first; squares are a1 (bottom
 * left) … d4. Our Blue drives right and moves first, so his board is ours
 * reflected in the anti-diagonal: his (row r from the top, column c) is our
 * (n − 1 − c, n − 1 − r), X is Blue and O is Red.
 */
export function djCell(n: number, square: string): number {
  const c = square.charCodeAt(0) - 97;
  const r = n - Number(square.slice(1));
  return (n - 1 - c) * n + (n - 1 - r);
}

/** Parse a diagram in desJardins' orientation (top row first). */
export function djDiagram(n: number, rows: string[]): { B: number; R: number } {
  let B = 0;
  let R = 0;
  rows.forEach((row, r) => {
    row.split(/\s+/).forEach((ch, c) => {
      const cell = (n - 1 - c) * n + (n - 1 - r);
      if (ch === 'X') B |= 1 << cell;
      else if (ch === 'O') R |= 1 << cell;
    });
  });
  return { B, R };
}

/** Parse a diagram in our orientation: '>' Blue, '^' Red, top row first. */
export function diagram(rows: string[]): { B: number; R: number } {
  const n = rows.length;
  let B = 0;
  let R = 0;
  rows.forEach((row, r) =>
    row.split(/\s+/).forEach((ch, c) => {
      if (ch === '>') B |= 1 << (r * n + c);
      else if (ch === '^') R |= 1 << (r * n + c);
    }),
  );
  return { B, R };
}

/** desJardins, 19 Mar 1996: a drawing line from the 4×4 start ('!' = the only drawing move). */
export const DJ_4X4_LINE = [
  'd1-d2', 'a4-b4', 'd2-d3', 'b4-c4', 'd3-d4', 'a3-b3', 'c1-c2', 'c4-c3!', 'b1-b2', 'a2-a3!',
  'c2-d2', 'c3-c2', 'd2-d3', 'a3-a2', 'd3-c3', 'a2-a3!', 'b2-a2', 'b3-b2', 'c3-c4', 'c2-c1',
  'd4-off', 'c1-c2', 'd3-off', 'b2-b3',
];
/** The diagram he prints after move 12, before "Draw agreed?". */
export const DJ_4X4_FINAL = ['. . . .', 'O O . .', 'X . O .', '. . . .'];
/** desJardins, 18 Mar 1996: "Perhaps the simplest" drawn 4×4 position, X to move. */
export const DJ_4X4_SIMPLE = ['. . . X', '. . O X', '. . . X', '. . . .'];
/** Erickson, 4 Mar 1996: the three 3×3 positions the second player wins. */
export const ERICKSON_P = [
  ['. > >', '. . ^', '. . .'],
  ['> . .', '^ . .', '. . .'],
  ['> > .', '. . ^', '. . ^'],
];
/** Erickson, 11 Mar 1996: "legal Dodgem positions on an n×n board". */
export const ERICKSON_COUNTS: Record<number, number> = { 2: 21, 3: 1495, 4: 303433, 5: 197841801 };
/** Fleury, 4 Mar 1996: 3×3 legal positions "after dividing by two for symmetry". */
export const FLEURY_HALF = 666;
/** GamesCrafters (via Wikipedia): 3×3 reachable positions and their values. */
export const GAMESCRAFTERS_3 = { reachable: 1963, win: 1123, loss: 840, draw: 0 };

export interface LineStep {
  ply: number;
  text: string;
  played: string; // the move actually made (after fixing an impossible one)
  legal: boolean;
  drawing: number; // drawing moves in the position before this ply
  value: number; // value of the position before this ply, for the side to move
  only: boolean; // the move was marked '!'
}

/**
 * Replay desJardins' line. A move that is not legal as written is replaced by
 * the only legal move that drives a car off, and reported.
 */
export function replayLine(sol: Solution, line: string[]): { steps: LineStep[]; B: number; R: number } {
  const n = sol.n;
  let { B, R } = djDiagram(n, ['O . . .', 'O . . .', 'O . . .', '. X X X']);
  const steps: LineStep[] = [];
  line.forEach((text, ply) => {
    const turn = ply % 2 === 0 ? BLUE : RED;
    const [fromSq, toSq] = text.replace('!', '').split('-');
    const from = djCell(n, fromSq);
    const to = toSq === 'off' ? -1 : djCell(n, toSq);
    const moves = listMoves(n, B, R, turn);
    const value = lookup(sol, B, R, turn).val;
    const drawing = moves.filter((m) => lookup(sol, m.B, m.R, turn ^ 1).val === DRAW).length;
    let mv = moves.find((m) => m.from === from && m.to === to);
    let played = text;
    const legal = !!mv;
    if (!mv) {
      const offs = moves.filter((m) => m.to === -1);
      if (offs.length !== 1) throw new Error(`cannot repair ${text}`);
      mv = offs[0];
      played = `${squareName(n, mv.from)}-off`;
    }
    steps.push({ ply: ply + 1, text, played, legal, drawing, value, only: text.endsWith('!') });
    B = mv.B;
    R = mv.R;
  });
  return { steps, B, R };
}

/** Our cell back to desJardins' square name. */
export function squareName(n: number, cell: number): string {
  const rr = Math.floor(cell / n);
  const cc = cell % n;
  const c = n - 1 - rr;
  const r = n - 1 - cc;
  return String.fromCharCode(97 + c) + String(n - r);
}
