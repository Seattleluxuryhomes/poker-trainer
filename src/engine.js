/* Shared poker engine — the pure hand-evaluation + expected-value math used by BOTH the
 * Play game (src/PokerPlay.jsx) and the Hold Trainer (src/PokerTrainer.jsx). `build.sh`
 * PREPENDS this file to each app before the name-guard + transpile, so every built page
 * still ships one self-contained copy (no bundler, no runtime module system).
 *
 * NOTE: engine/verify_rank.js deliberately re-implements the categorizer from scratch as
 * a second opinion, and engine/verify_trainer.js / verify_play.js eval the COMPILED pages
 * and re-prove the math against independently derivable facts (the published 5-card
 * frequency table; hand-worked EVs). Keep them green.
 *
 * Cards are { r: 1..13, s: 0..3 } (r: A=1 … K=13; s: spade/heart/diamond/club) — the same
 * shape as the cribbage engine this project is modeled on.
 *
 * THE VALUE MODEL (the whole point): the expected value of a hold is derived strictly by
 * ENUMERATION — every one of the C(47, 5-k) ways the draw can complete the hand, scored
 * against the paytable, averaged. No strategy charts, no heuristics, no weights. The
 * trainer therefore cannot disagree with the math; it IS the math.
 */

const cardId = (c) => (c.r - 1) * 4 + c.s;

function fullDeck() {
  const d = [];
  for (let r = 1; r <= 13; r++) for (let s = 0; s < 4; s++) d.push({ r, s });
  return d;
}
function deckExcluding(cards) {
  const used = new Set(cards.map(cardId));
  return fullDeck().filter((c) => !used.has(cardId(c)));
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Fisher–Yates over a fresh deck; rng defaults to Math.random (the trainer seeds
// mulberry32 for reproducible custom scenarios; play uses real randomness).
function shuffledDeck(rng) {
  const R = rng || Math.random;
  const d = fullDeck();
  for (let i = d.length - 1; i > 0; i--) {
    const j = (R() * (i + 1)) | 0;
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

/* ===== Hand categories (index = strength order) and the paytable ===== */
// 9/6 "full-pay" Jacks or Better, coins per coin bet. The royal jumps to 4000
// total at max bet (5 coins) — payoutFor handles that; PAY holds the per-coin line.
const CAT = { NOTHING: 0, JACKS: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4, FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8, ROYAL: 9 };
const CAT_COUNT = 10;
const PAY = [0, 1, 2, 3, 4, 6, 9, 25, 50, 800];
const MAX_BET = 5;
const ROYAL_MAX_BET_PAYOUT = 4000;
function payoutFor(cat, bet) {
  if (cat === CAT.ROYAL && bet === MAX_BET) return ROYAL_MAX_BET_PAYOUT;
  return PAY[cat] * bet;
}

/* ===== categorize: 5 cards -> category index =====
 * Hot path: called up to ~2.6 million times per full trainer analysis, so it works on
 * parallel rank/suit arrays with one reused counts buffer and no allocation. */
const _rc = new Array(14).fill(0);
function categorize(rs, ss) {
  for (let r = 1; r <= 13; r++) _rc[r] = 0;
  for (let i = 0; i < 5; i++) _rc[rs[i]]++;
  const flush = ss[0] === ss[1] && ss[0] === ss[2] && ss[0] === ss[3] && ss[0] === ss[4];
  let pairs = 0, trips = 0, quads = 0, highPair = false, distinct = 0, lo = 14, hi = 0;
  for (let r = 1; r <= 13; r++) {
    const n = _rc[r];
    if (!n) continue;
    distinct++;
    if (r < lo) lo = r;
    if (r > hi) hi = r;
    if (n === 2) { pairs++; if (r === 1 || r >= 11) highPair = true; }
    else if (n === 3) trips++;
    else if (n === 4) quads++;
  }
  // A straight is 5 distinct ranks spanning exactly 4 (with the ace low), or the
  // ace-high wheel-around A-10-J-Q-K (ace stored low makes it span 12 with a 10 floor).
  const straight = distinct === 5 && (hi - lo === 4 || (_rc[1] === 1 && _rc[10] === 1 && _rc[11] === 1 && _rc[12] === 1 && _rc[13] === 1));
  const aceHigh = _rc[1] === 1 && _rc[10] === 1 && _rc[13] === 1;
  if (flush && straight) return aceHigh ? CAT.ROYAL : CAT.STRAIGHT_FLUSH;
  if (quads) return CAT.QUADS;
  if (trips && pairs) return CAT.FULL_HOUSE;
  if (flush) return CAT.FLUSH;
  if (straight) return CAT.STRAIGHT;
  if (trips) return CAT.TRIPS;
  if (pairs === 2) return CAT.TWO_PAIR;
  if (pairs === 1 && highPair) return CAT.JACKS;
  return CAT.NOTHING;
}
// Convenience for callers holding card objects (the play page's showdown).
function categorizeCards(cards5) {
  return categorize(cards5.map((c) => c.r), cards5.map((c) => c.s));
}

/* ===== analyze: the trainer's core =====
 * analyze(hand5) enumerates all 32 hold masks. For each, it walks every completion of
 * the hand from the 47 unseen cards and accumulates the EXACT per-category counts.
 * Everything else — EV, sd, hit rate, guaranteed floor (min), ceiling (max), per-category
 * EV contribution — falls out of those counts. Options come back sorted by EV descending;
 * each carries { id, idxs, cards } like the cribbage trainer's discard options (id is the
 * sorted held-index set joined with "," — "" for the hold-nothing draw-five).
 */
function holdCombos() {
  const out = [];
  for (let m = 0; m < 32; m++) {
    const idxs = [];
    for (let i = 0; i < 5; i++) if (m & (1 << i)) idxs.push(i);
    out.push({ mask: m, idxs });
  }
  return out;
}

function analyze(hand5) {
  const pool = deckExcluding(hand5);
  const poolR = pool.map((c) => c.r), poolS = pool.map((c) => c.s);
  const n = pool.length; // 47
  const rs = new Array(5), ss = new Array(5);
  const opts = holdCombos().map(({ mask, idxs }) => {
    const cards = idxs.map((i) => hand5[i]);
    for (let i = 0; i < idxs.length; i++) { rs[i] = cards[i].r; ss[i] = cards[i].s; }
    const need = 5 - idxs.length;
    const catCounts = new Array(CAT_COUNT).fill(0);
    // need nested loops, unrolled by depth: each level places one drawn card. Recursion
    // is fine here — at most 5 deep — and keeps the walk allocation-free.
    let draws = 0;
    const walk = (start, slot) => {
      if (slot === 5) { catCounts[categorize(rs, ss)]++; draws++; return; }
      for (let i = start; i < n; i++) { rs[slot] = poolR[i]; ss[slot] = poolS[i]; walk(i + 1, slot + 1); }
    };
    if (need === 0) { catCounts[categorize(rs, ss)]++; draws = 1; }
    else walk(0, idxs.length);
    let total = 0, sq = 0, hits = 0, min = Infinity, max = 0;
    for (let c = 0; c < CAT_COUNT; c++) {
      const k = catCounts[c];
      if (!k) continue;
      const pay = PAY[c];
      total += k * pay; sq += k * pay * pay;
      if (pay > 0) hits += k;
      if (pay < min) min = pay;
      if (pay > max) max = pay;
    }
    const ev = total / draws;
    return {
      id: idxs.join(","), idxs: idxs.slice(), cards, mask,
      ev, sd: Math.sqrt(Math.max(0, sq / draws - ev * ev)),
      min: min === Infinity ? 0 : min, max,
      hitRate: hits / draws, draws,
      cats: catCounts.map((k) => k / draws), // exact P(final category)
    };
  });
  return opts.sort((a, b) => b.ev - a.ev || a.mask - b.mask);
}

// The play page's Hint: the EV-best hold's index set (ties resolved by analyze's sort).
function bestHold(hand5) {
  return analyze(hand5)[0].idxs;
}
