#!/usr/bin/env node
/* Verifies the hand categorizer that ships inside the COMPILED trainer page — not a copy
 * of it — two independent ways:
 *   1. A from-scratch re-implementation here (different style on purpose) must agree with
 *      the page's categorize() on every one of the C(52,5) = 2,598,960 five-card hands.
 *   2. The category counts over that full enumeration must equal the published 5-card
 *      poker frequency table (with one pair split at jacks: 4/13 of 1,098,240 = 337,920
 *      pay, the rest join "nothing").
 * Any dropped straight case, a mis-ranked wheel, a royal counted as a straight flush —
 * anything — shows up as a count that is off by an exact integer.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "trainer.html"), "utf8");
const body = html.split("\n<script>\n").pop().split("\n</script>")[0];

let ok = 0, fail = 0;
const check = (cond, msg) => { if (cond) { ok++; } else { fail++; console.error("  ✗ " + msg); } };

const sandbox = {
  React: { createElement: () => ({}), useState: () => [0, () => {}], useMemo: (f) => f(), useCallback: (f) => f, useEffect: () => {}, useRef: () => ({ current: null }) },
  ReactDOM: { createRoot: () => ({ render() {} }) },
  document: { getElementById: () => ({}) },
  localStorage: { getItem: () => null },
  Math, console,
};
vm.createContext(sandbox);
vm.runInContext(body, sandbox);
// Top-level `const`s (CAT, PAY) live in the context's lexical scope, not on the sandbox
// object, so read the API out with a second eval in the same context.
const { categorize, CAT } = vm.runInContext("({ categorize, CAT })", sandbox);

/* ---- the independent second opinion: a sort-and-compare categorizer ---- */
function refCategorize(cards) {
  const rs = cards.map((c) => c.r).sort((a, b) => a - b);
  const flush = cards.every((c) => c.s === cards[0].s);
  const counts = {};
  for (const r of rs) counts[r] = (counts[r] || 0) + 1;
  const groups = Object.values(counts).sort((a, b) => b - a);
  const uniq = [...new Set(rs)];
  const straight =
    uniq.length === 5 &&
    (uniq[4] - uniq[0] === 4 || String(uniq) === "1,10,11,12,13");
  const royal = straight && flush && String(uniq) === "1,10,11,12,13";
  if (royal) return CAT.ROYAL;
  if (straight && flush) return CAT.STRAIGHT_FLUSH;
  if (groups[0] === 4) return CAT.QUADS;
  if (groups[0] === 3 && groups[1] === 2) return CAT.FULL_HOUSE;
  if (flush) return CAT.FLUSH;
  if (straight) return CAT.STRAIGHT;
  if (groups[0] === 3) return CAT.TRIPS;
  if (groups[0] === 2 && groups[1] === 2) return CAT.TWO_PAIR;
  if (groups[0] === 2) {
    const pairRank = Number(Object.keys(counts).find((r) => counts[r] === 2));
    if (pairRank === 1 || pairRank >= 11) return CAT.JACKS;
  }
  return CAT.NOTHING;
}

/* ---- full enumeration ---- */
const deck = [];
for (let r = 1; r <= 13; r++) for (let s = 0; s < 4; s++) deck.push({ r, s });

const engineCounts = new Array(10).fill(0);
let disagreements = 0;
const rs = new Array(5), ss = new Array(5), hand = new Array(5);
for (let a = 0; a < 48; a++)
  for (let b = a + 1; b < 49; b++)
    for (let c = b + 1; c < 50; c++)
      for (let d = c + 1; d < 51; d++)
        for (let e = d + 1; e < 52; e++) {
          hand[0] = deck[a]; hand[1] = deck[b]; hand[2] = deck[c]; hand[3] = deck[d]; hand[4] = deck[e];
          for (let i = 0; i < 5; i++) { rs[i] = hand[i].r; ss[i] = hand[i].s; }
          const got = categorize(rs, ss);
          engineCounts[got]++;
          if (got !== refCategorize(hand)) disagreements++;
        }

console.log("verify_rank: all C(52,5) = 2,598,960 hands enumerated");
check(disagreements === 0, `page categorize vs independent re-implementation: ${disagreements} disagreements`);

/* The published table (one pair split at jacks-or-better). */
const EXPECTED = {
  [CAT.ROYAL]: 4,
  [CAT.STRAIGHT_FLUSH]: 36,
  [CAT.QUADS]: 624,
  [CAT.FULL_HOUSE]: 3744,
  [CAT.FLUSH]: 5108,
  [CAT.STRAIGHT]: 10200,
  [CAT.TRIPS]: 54912,
  [CAT.TWO_PAIR]: 123552,
  [CAT.JACKS]: 337920,
  [CAT.NOTHING]: 1302540 + 760320, // high card + pairs below jacks
};
for (const [cat, want] of Object.entries(EXPECTED))
  check(engineCounts[cat] === want, `category ${cat}: got ${engineCounts[cat]}, published table says ${want}`);
check(engineCounts.reduce((a, b) => a + b, 0) === 2598960, "counts sum to C(52,5)");

console.log(fail === 0 ? `✓ verify_rank: all ${ok} checks passed` : `✗ verify_rank: ${fail} of ${ok + fail} checks FAILED`);
process.exit(fail === 0 ? 0 : 1);
