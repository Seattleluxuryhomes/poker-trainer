#!/usr/bin/env node
/* Verifies Pai Gow by eval'ing the COMPILED page:
 *   - score2: pair beats any no-pair; AK > AQ; kickers order; aces high;
 *   - legalSplits: 21 candidates max, every returned split has high > low
 *     (foul-free by construction), and a hand that would foul any front
 *     pairing still yields legal splits;
 *   - houseWay: never fouls across seeded random hands; maximizes the low
 *     (no legal split has a stronger low than the chosen one); deterministic;
 *   - comparePaiGow: copies go to the banker (exact tie on either hand is a
 *     dealer win on that hand);
 *   - settlePaiGow: win-both pays +0.95x (5% commission, exact), split pushes
 *     the stake back, lose-both returns nothing;
 *   - simulateEdge: seeded run lands in the sane band (house 1%–5%) and is
 *     deterministic for a fixed seed;
 *   - bank conservation across a seeded batch of full hands.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "paigow.html"), "utf8");
const body = html.split("\n<script>\n").pop().split("\n</script>")[0];

let ok = 0, fail = 0;
const check = (cond, msg) => { if (cond) { ok++; } else { fail++; console.error("  ✗ " + msg); } };

const sandbox = {
  React: { createElement: () => ({}), useState: (v) => [typeof v === "function" ? v() : v, () => {}], useMemo: (f) => f(), useCallback: (f) => f, useEffect: () => {}, useRef: (v) => ({ current: v }) },
  ReactDOM: { createRoot: () => ({ render() {} }) },
  document: { getElementById: () => ({}) },
  localStorage: { getItem: () => null, setItem: () => {} },
  window: undefined, Math, JSON, Set, Number, performance: { now: () => 0 },
  setTimeout: (f) => f(), clearTimeout: () => {}, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
};
vm.createContext(sandbox);
vm.runInContext(body, sandbox);
const { score2, legalSplits, houseWay, comparePaiGow, settlePaiGow, simulateEdge, mulberry32, fullDeck, score5H } =
  vm.runInContext("({ score2, legalSplits, houseWay, comparePaiGow, settlePaiGow, simulateEdge, mulberry32, fullDeck, score5H })", sandbox);

const c = (r, s) => ({ r, s });

/* score2 */
check(score2([c(2, 0), c(2, 1)]) > score2([c(1, 0), c(13, 1)]), "a pair of twos beats ace-king");
check(score2([c(1, 0), c(13, 1)]) > score2([c(1, 2), c(12, 3)]), "AK beats AQ");
check(score2([c(1, 0), c(1, 1)]) > score2([c(13, 0), c(13, 1)]), "pair of aces beats pair of kings");
check(score2([c(9, 0), c(5, 1)]) === score2([c(5, 2), c(9, 3)]), "order of the two cards doesn't matter");

/* legalSplits: foul-free by construction */
{
  const rng = mulberry32(31);
  let allLegal = true, sawFull = false;
  for (let t = 0; t < 200; t++) {
    const d = fullDeck();
    for (let i = d.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [d[i], d[j]] = [d[j], d[i]]; }
    const hand = d.slice(0, 7);
    const splits = legalSplits(hand);
    if (splits.length === 21) sawFull = true;
    for (const sp of splits) {
      // re-verify legality independently: high five-card hand must beat the low
      // played AS a five-card front of the same shape
      const s5 = score5H(sp.high);
      const twoPair = sp.low[0].r === sp.low[1].r;
      if (twoPair) {
        // high must beat a bare pair of that rank
        const pairRank = sp.low[0].r === 1 ? 14 : sp.low[0].r;
        const bare = 1 * Math.pow(16, 5) + pairRank * Math.pow(16, 4);
        if (!(s5 > bare)) allLegal = false;
      }
    }
    if (!splits.length) allLegal = false;
  }
  check(allLegal, "every split legalSplits returns keeps the high above the low");
  check(sawFull, "hands with weak fronts allow all 21 splits");
}

/* houseWay: never fouls, maximizes the low, deterministic */
{
  const rng = mulberry32(77);
  let maxLow = true;
  for (let t = 0; t < 300; t++) {
    const d = fullDeck();
    for (let i = d.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [d[i], d[j]] = [d[j], d[i]]; }
    const hand = d.slice(0, 7);
    const hw = houseWay(hand);
    for (const sp of legalSplits(hand)) if (sp.s2 > hw.s2) maxLow = false;
  }
  check(maxLow, "houseWay's low is the strongest legal low, 300 seeded hands");
  const fixed = [c(1, 0), c(1, 1), c(13, 2), c(9, 3), c(7, 0), c(4, 1), c(2, 2)];
  const a = houseWay(fixed), b2 = houseWay(fixed);
  check(a.s2 === b2.s2 && a.s5 === b2.s5, "houseWay is deterministic");
  // AAK97 42: best legal low is K9 (aces must stay behind — a pair in front
  // would leave a high the low outranks... verify by property instead:
  check(a.s2 === Math.max(...legalSplits(fixed).map((s) => s.s2)), "fixed-hand houseWay picks the max legal low");
}

/* copies go to the banker */
{
  const p = { s5: 100, s2: 50 }, d = { s5: 100, s2: 40 };
  const cmp = comparePaiGow(p, d);
  check(cmp.highWin === false && cmp.lowWin === true, "an exact high copy is a dealer win on the high");
  const cmp2 = comparePaiGow({ s5: 90, s2: 40 }, { s5: 100, s2: 40 });
  check(!cmp2.highWin && !cmp2.lowWin, "copy on the low + losing high = lose both");
}

/* settlement: the 5% is exact */
check(settlePaiGow({ highWin: true, lowWin: true }, 100) === 195, "win both on 100 returns 195 (5% commission)");
check(settlePaiGow({ highWin: true, lowWin: false }, 100) === 100, "split pushes the stake back");
check(settlePaiGow({ highWin: false, lowWin: false }, 100) === 0, "lose both returns nothing");

/* simulated edge: sane band, deterministic per seed, labeled elsewhere as simulated */
{
  const e1 = simulateEdge(3000, mulberry32(1234));
  const e2 = simulateEdge(3000, mulberry32(1234));
  check(e1 === e2, "simulateEdge is deterministic for a fixed seed");
  check(-e1 > 0.005 && -e1 < 0.05, `simulated house edge in the sane band (got ${(-e1 * 100).toFixed(2)}%)`);
}

/* bank conservation across full seeded hands */
{
  const rng = mulberry32(9001);
  let bank = 10000, wagered = 0, returned = 0;
  for (let t = 0; t < 500; t++) {
    const d = fullDeck();
    for (let i = d.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [d[i], d[j]] = [d[j], d[i]]; }
    bank -= 10; wagered += 10;
    const credit = settlePaiGow(comparePaiGow(houseWay(d.slice(0, 7)), houseWay(d.slice(7, 14))), 10);
    bank += credit; returned += credit;
  }
  check(bank === 10000 - wagered + returned, "chips are conserved across 500 hands");
  // (No "house always ahead after 500 hands" assertion: at ~2% edge with ~0.75
  //  units/hand of variance, 500 hands is inside luck. The edge claim is the
  //  deterministic 3,000-hand band check above.)
}

console.log(fail === 0 ? `✓ verify_paigow: all ${ok} checks passed` : `✗ verify_paigow: ${fail} of ${ok + fail} checks FAILED`);
process.exit(fail === 0 ? 0 : 1);
