import './style.css';
import {
  BLUE, RED, WIN, LOSS, DRAW, solve, startPosition, lookup, listMoves, gameOver, bestMoves,
  type Solution, type Move,
} from './dodgem.ts';
import results from './results.json';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const svg = $('board') as unknown as SVGSVGElement;
const sizeSel = $<HTMLSelectElement>('sizeSel');
const youSel = $<HTMLSelectElement>('youSel');
const hints = $<HTMLInputElement>('hints');
const statusEl = $('status');
const movesEl = $('moves');
const NS = 'http://www.w3.org/2000/svg';
const CELL = 84;
const PAD = 46;

const solutions = new Map<number, Solution>();
interface State { B: number; R: number; turn: number }
let n = 3;
let sol: Solution;
let you = BLUE;
let history: State[] = [];
let cur: State;
let selected = -1;
let lastMove: Move | null = null;
let thinking = 0;

function fmt(x: number): string {
  return x.toLocaleString('en-US');
}

function el(tag: string, attrs: Record<string, string | number>, parent: Element): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

function getSolution(size: number): Solution {
  let s = solutions.get(size);
  if (!s) {
    s = solve(size);
    solutions.set(size, s);
  }
  return s;
}

function newGame() {
  n = Number(sizeSel.value);
  you = Number(youSel.value);
  statusEl.textContent = n === 4 ? 'Solving all 555,986 positions…' : '';
  window.clearTimeout(thinking);
  setTimeout(() => {
    sol = getSolution(n);
    const { B, R } = startPosition(n);
    cur = { B, R, turn: BLUE };
    history = [];
    selected = -1;
    lastMove = null;
    render();
    maybeComputer();
  }, 20);
}

const xy = (cell: number) => ({ x: PAD + (cell % n) * CELL, y: PAD + Math.floor(cell / n) * CELL });

/** Where a move's marker goes: the target square, or the exit lane just past the edge. */
function targetXY(m: Move, turn: number): { x: number; y: number } {
  if (m.to >= 0) return xy(m.to);
  const p = xy(m.from);
  return turn === BLUE ? { x: p.x + CELL, y: p.y } : { x: p.x, y: p.y - CELL };
}

function outcomeOf(m: Move, turn: number): { cls: string; text: string } {
  const r = lookup(sol, m.B, m.R, turn ^ 1);
  const plies = r.dep + 1;
  if (r.val === LOSS) return { cls: 'win', text: `W${plies}` };
  if (r.val === WIN) return { cls: 'loss', text: `L${plies}` };
  return { cls: 'draw', text: '=' };
}

function render() {
  const W = PAD * 2 + CELL * n;
  svg.setAttribute('viewBox', `0 0 ${W} ${W}`);
  svg.replaceChildren();
  // exit lanes
  el('rect', { x: PAD, y: 6, width: CELL * n, height: PAD - 12, rx: 6, class: 'exit' }, svg);
  el('rect', { x: PAD + CELL * n + 6, y: PAD, width: PAD - 12, height: CELL * n, rx: 6, class: 'exit' }, svg);
  const t1 = el('text', { x: PAD + (CELL * n) / 2, y: PAD / 2 + 4, 'text-anchor': 'middle', class: 'exitlbl' }, svg);
  t1.textContent = 'Red exits ↑';
  const t2 = el('text', {
    x: PAD + CELL * n + PAD / 2, y: PAD + (CELL * n) / 2, 'text-anchor': 'middle', class: 'exitlbl',
    transform: `rotate(90 ${PAD + CELL * n + PAD / 2} ${PAD + (CELL * n) / 2})`,
  }, svg);
  t2.textContent = 'Blue exits ↑'; // drawn turned 90°, so the arrow points right
  for (let i = 0; i < n * n; i++) {
    const p = xy(i);
    el('rect', { x: p.x + 2, y: p.y + 2, width: CELL - 4, height: CELL - 4, rx: 8, class: 'cell' }, svg);
  }
  const over = gameOver(n, cur.B, cur.R, cur.turn);
  const myTurn = !over && cur.turn === you;
  for (let i = 0; i < n * n; i++) {
    const isB = (cur.B >> i) & 1;
    const isR = (cur.R >> i) & 1;
    if (!isB && !isR) continue;
    const p = xy(i);
    const mine = myTurn && ((you === BLUE && isB) || (you === RED && isR));
    const cls = ['car', isB ? 'blue' : 'red'];
    if (mine) cls.push('mine');
    if (i === selected) cls.push('sel');
    if (lastMove && lastMove.to === i) cls.push('last');
    const g = el('g', {}, svg);
    if (isB) el('rect', { x: p.x + 10, y: p.y + 20, width: CELL - 20, height: CELL - 40, rx: 10, class: cls.join(' ') }, g);
    else el('rect', { x: p.x + 20, y: p.y + 10, width: CELL - 40, height: CELL - 20, rx: 10, class: cls.join(' ') }, g);
    const cx = p.x + CELL / 2;
    const cy = p.y + CELL / 2;
    const arrow = isB ? `${cx - 8},${cy - 9} ${cx + 10},${cy} ${cx - 8},${cy + 9}` : `${cx - 9},${cy + 8} ${cx},${cy - 10} ${cx + 9},${cy + 8}`;
    el('polygon', { points: arrow, class: 'arrow' }, g);
    if (mine) {
      g.addEventListener('click', () => {
        selected = selected === i ? -1 : i;
        render();
      });
    }
  }
  if (myTurn) {
    const moves = listMoves(n, cur.B, cur.R, cur.turn);
    for (const m of moves) {
      if (selected !== m.from && !(hints.checked && selected < 0)) continue;
      const p = targetXY(m, cur.turn);
      const o = outcomeOf(m, cur.turn);
      const cls = hints.checked ? o.cls : 'plain';
      const off = m.to < 0;
      const size = off ? 30 : 34;
      const cx = off ? (cur.turn === BLUE ? PAD + CELL * n + PAD / 2 : p.x + CELL / 2) : p.x + CELL / 2;
      const cy = off ? (cur.turn === BLUE ? p.y + CELL / 2 : PAD / 2) : p.y + CELL / 2;
      if (selected !== m.from) {
        // overview: a small dot per move, from car to target
        const from = xy(m.from);
        const fx = from.x + CELL / 2;
        const fy = from.y + CELL / 2;
        const dx = (cx - fx) * 0.42;
        const dy = (cy - fy) * 0.42;
        const d = el('circle', { cx: fx + dx, cy: fy + dy, r: 9, class: `tgt ${cls}` }, svg);
        d.addEventListener('click', () => play(m));
        continue;
      }
      const r = el('rect', { x: cx - size / 2, y: cy - size / 2, width: size, height: size, rx: 8, class: `tgt ${cls}` }, svg);
      r.addEventListener('click', () => play(m));
      if (hints.checked) {
        const t = el('text', { x: cx, y: cy + 5, 'text-anchor': 'middle', class: `tgtlbl ${o.cls}` }, svg);
        t.textContent = o.text;
      }
    }
  }
  renderStatus(over);
}

function sideName(t: number) {
  return t === BLUE ? 'Blue' : 'Red';
}

function renderStatus(over: 'blue' | 'red' | null) {
  statusEl.className = '';
  if (over) {
    const winner = over === 'blue' ? BLUE : RED;
    statusEl.textContent = `${sideName(winner)} wins${winner === you ? ' — well played.' : '.'}`;
    statusEl.className = winner === you ? 'good' : 'bad';
  } else {
    const r = lookup(sol, cur.B, cur.R, cur.turn);
    const whose = cur.turn === you ? 'Your move' : 'Computer thinking';
    let verdict: string;
    const youMove = cur.turn === you;
    if (r.val === DRAW) verdict = 'perfect play draws from here (the cars can shuffle forever)';
    else {
      const youWin = (r.val === WIN) === youMove;
      verdict = youWin ? `you can force a win in ${r.dep} plies` : `the computer can force a win in ${r.dep} plies`;
    }
    statusEl.textContent = `${whose} (${sideName(cur.turn)}). ${hints.checked ? verdict[0].toUpperCase() + verdict.slice(1) + '.' : ''}`;
    if (hints.checked && r.val !== DRAW) statusEl.className = (r.val === WIN) === youMove ? 'good' : 'bad';
    const repeats = history.filter((h) => h.B === cur.B && h.R === cur.R && h.turn === cur.turn).length;
    if (repeats >= 2 && r.val === DRAW) statusEl.textContent += ' This position has come up three times.';
  }
  const tip = selected >= 0 ? 'Click a marked square to drive there.' : 'Click one of your cars to see its moves.';
  movesEl.textContent = over ? '' : cur.turn === you ? `${tip} W = win, L = loss in that many plies, = draw.` : '';
}

function play(m: Move) {
  history.push(cur);
  cur = { B: m.B, R: m.R, turn: cur.turn ^ 1 };
  lastMove = m;
  selected = -1;
  render();
  maybeComputer();
}

function maybeComputer() {
  if (gameOver(n, cur.B, cur.R, cur.turn) || cur.turn === you) return;
  thinking = window.setTimeout(() => {
    const best = bestMoves(sol, cur.B, cur.R, cur.turn);
    // Fastest win, slowest loss; among drawing moves pick one at random.
    const top = best.filter((x) => x.val === best[0].val && (x.val === DRAW || x.dep === best[0].dep));
    play(top[Math.floor(Math.random() * top.length)].move);
  }, 420);
}

$('newgame').addEventListener('click', newGame);
sizeSel.addEventListener('change', newGame);
youSel.addEventListener('change', newGame);
hints.addEventListener('change', render);
$('undo').addEventListener('click', () => {
  window.clearTimeout(thinking);
  // Undo back to the last position where it was your move.
  while (history.length) {
    cur = history.pop()!;
    if (cur.turn === you) break;
  }
  selected = -1;
  lastMove = null;
  render();
  maybeComputer();
});

// ---------------------------------------------------------------- side panels
function renderPanels() {
  const rows = results.boards
    .map((b) => {
      const reach = b.reachable.all;
      const total = reach.win + reach.loss + reach.draw;
      return `<tr><td>${b.n}×${b.n}</td><td>${fmt(b.states)}</td><td>${fmt(total)}</td><td>${fmt(reach.draw)}</td><td class="${b.start.val === 'win' ? 'ok' : 'ng'}">${b.start.val === 'win' ? `Blue wins (${b.start.dep})` : 'draw'}</td></tr>`;
    })
    .join('');
  $('boards').innerHTML = `<table class="t"><tr><th>board</th><th>positions</th><th>reachable</th><th>of them draws</th><th>start</th></tr>${rows}</table>
    <p class="fine">Positions count the side to move. "Reachable" is everything the start can lead to with Blue moving first; numbers in brackets are plies to the end with perfect play.</p>`;

  const c = results.checks;
  const mark = (ok: boolean) => (ok ? '<span class="ok">✓</span>' : '<span class="ng">✗</span>');
  const gc = c.gamescrafters;
  const e5 = c.ericksonCounts;
  const p3 = c.ericksonP.diagrams[2];
  const dj4 = c.desJardins4;
  const bad = dj4.replies.find((r) => r.dj === 'a4-b4')!;
  const items = [
    `${mark(c.winningWays3.val === 'win')} <em>Winning Ways</em>: 3×3 is a first-player win — in ${c.winningWays3.dep} plies.`,
    `${mark(gc.got.reachable === gc.claimed.reachable && gc.got.win === gc.claimed.win)} GamesCrafters: ${fmt(gc.claimed.reachable)} reachable 3×3 positions, ${fmt(gc.claimed.win)} won and ${fmt(gc.claimed.loss)} lost for the mover — got ${fmt(gc.got.reachable)} / ${fmt(gc.got.win)} / ${fmt(gc.got.loss)}.`,
    `${mark(c.fleury.got === c.fleury.claimed)} Fleury: ${c.fleury.claimed} positions after halving by symmetry — the ${fmt(c.fleury.got * 2)} with both colours on the board.`,
    `${mark(c.ericksonP.got === c.ericksonP.claimedCount)} Erickson: six 3×3 positions are second-player wins. ${mark(false)} His third diagram, as printed, is won by whoever moves (${p3.blueFirst.dep} plies); the third pair is <code>&gt; &gt; . / ^ ^ .</code>.`,
    `${mark(false)} Erickson's position counts ${Object.entries(e5).map(([k, v]) => `${k}×${k}: ${fmt(v.claimed)}`).join(', ')} — one cell per car and no overlap gives ${Object.entries(e5).map(([, v]) => fmt(v.got)).join(', ')}. Only 2×2 agrees.`,
    `${mark(dj4.start.val === 'draw')} desJardins: 4×4 is a draw, and so is his "simplest" drawn position.`,
    `${mark(dj4.b1a1.val === 'loss')} desJardins: 1. b1-a1 loses on 4×4 (in ${dj4.b1a1.dep} plies).`,
    `${mark(dj4.line.filter((s) => s.only).every((s) => s.drawing === 1))} desJardins' drawing line: each of his three "!" moves is the only drawing move.`,
    `${mark(false)} …but 1… a4-b4 in the same line loses in ${bad.dep} plies; 2. c1-c2 would have won. 12. d3-off is a slip for c4-off.`,
    `${mark(c.desJardins5.start.val === 'draw')} desJardins: 5×5 is a draw, and ${mark(c.desJardins5.b1a1.val === 'draw')} even 1. b1-a1 draws there.`,
    `<span class="draw-t">≈</span> "I think about 40% of 5×5 positions are draws": ${(c.desJardins5.drawShareBlueToMove * 100).toFixed(1)}% of the positions with both colours on the board (either side to move), ${(c.desJardins5.drawShareReachable * 100).toFixed(1)}% of those reachable from the start.`,
  ];
  $('checks').innerHTML = `<ul class="checks">${items.map((x) => `<li>${x}</li>`).join('')}</ul>`;
  $('mismatch').innerHTML =
    `Three things. Jeff Erickson's third diagram of a second-player win is, as printed, a win for whoever moves; the real third pair has Red's two cars side by side in the middle row. His position counts (1,495 for 3×3, 303,433 for 4×4, 197,841,801 for 5×5) are larger than the number of ways to place the cars at all, so they must count something else; the post does not say what. And in David desJardins' 4×4 drawing line, O's very first reply a4-b4 is a loss in ${bad.dep} plies — X's 2. c1-c2 wins — and X's 2. d2-d3 hands the draw back. Every "!" in the line checks out.`;
}

renderPanels();
newGame();
