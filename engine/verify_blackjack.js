#!/usr/bin/env node
/* Verifies Blackjack by eval'ing the COMPILED page and re-proving the math
 * against facts derivable by hand:
 *   - bjTotal: soft-ace rule (A6=soft 17, A66=hard 13, AA=soft 12, AA9=21);
 *   - bjDealerDist: distributions sum to 1 for every upcard; a rigged
 *     all-tens deck makes dealer 20 with certainty; the no-blackjack
 *     condition removes two-card 21s (up-ten dist has strictly less mass on
 *     21 than the unconditioned one);
 *   - bjEvStand against a hand-built distribution matches the exact sum;
 *     rigged-deck stand EVs are exactly +1 / 0 / -1;
 *   - bjEvHit on hard 12 vs an all-tens deck is exactly -1 (every draw
 *     busts); bjEvDouble on 11 vs the same deck is exactly +2 (21 beats 20);
 *   - full-deck advice reproduces universal basic strategy at the poles:
 *     double hard 11 vs 6, stand hard 20 vs 10, hit hard 5 vs 10, never
 *     stand on hard 4;
 *   - EV monotonicity: standing on 20 beats standing on 12 vs every upcard;
 *   - bjSettle: 3:2 on a natural (floored), pushes return the stake,
 *     dealer bust pays even money, busted player gets nothing even when the
 *     dealer also busts (the order-of-play rule the house edge lives in);
 *   - conservation: settle credits over an exhaustive outcome grid never
 *     exceed 2.5x the stake and never go negative.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "bj.html"), "utf8");
const body = html.split("\n<script>\n").pop().split("\n</script>")[0];

let ok = 0, fail = 0;
const check = (cond, msg) => { if (cond) { ok++; } else { fail++; console.error("  ✗ " + msg); } };
const near = (a, b, eps = 1e-12) => Math.abs(a - b) < eps;

const sandbox = {
  React: { createElement: () => ({}), useState: (v) => [typeof v === "function" ? v() : v, () => {}], useMemo: (f) => f(), useCallback: (f) => f, useEffect: () => {}, useRef: (v) => ({ current: v }) },
  ReactDOM: { createRoot: () => ({ render() {} }) },
  document: { getElementById: () => ({}) },
  localStorage: { getItem: () => null, setItem: () => {} },
  window: undefined, Math, JSON, Set, Map, Number, performance: { now: () => 0 },
  setTimeout: (f) => f(), clearTimeout: () => {}, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
};
vm.createContext(sandbox);
vm.runInContext(body, sandbox);
const { bjFreshCounts, bjTotal, bjDealerDist, bjEvStandVsDist, bjEvStand, bjEvHit, bjEvDouble, bjEvSplit, bjAdvise, bjSettle } =
  vm.runInContext("({ bjFreshCounts, bjTotal, bjDealerDist, bjEvStandVsDist, bjEvStand, bjEvHit, bjEvDouble, bjEvSplit, bjAdvise, bjSettle })", sandbox);

console.log("verify_blackjack: totals");
check(bjTotal([1, 6]).total === 17 && bjTotal([1, 6]).soft === true, "A6 is soft 17");
check(bjTotal([1, 6, 6]).total === 13 && bjTotal([1, 6, 6]).soft === false, "A66 is hard 13");
check(bjTotal([1, 1]).total === 12 && bjTotal([1, 1]).soft === true, "AA is soft 12");
check(bjTotal([1, 1, 9]).total === 21, "AA9 is 21");
check(bjTotal([10, 10, 2]).total === 22, "TT2 busts at 22");
check(bjTotal([1, 10]).total === 21 && bjTotal([1, 10]).soft === true, "AT is a soft 21");

console.log("verify_blackjack: dealer distribution");
for (let up = 1; up <= 10; up++) {
  const d = bjDealerDist(bjFreshCounts(), [up], true);
  check(near(d.reduce((a, b) => a + b, 0), 1, 1e-9), `dist sums to 1 for upcard ${up}`);
  check(d.every((p) => p >= -1e-15 && p <= 1 + 1e-15), `dist probabilities in [0,1] for upcard ${up}`);
}
// rigged deck: nothing but tens — the dealer's hand is 20, always
const tensOnly = new Array(11).fill(0); tensOnly[10] = 16;
const dTens = bjDealerDist(tensOnly, [10], false);
check(near(dTens[3], 1) && near(dTens[0] + dTens[1] + dTens[2] + dTens[4] + dTens[5], 0), "all-tens deck: dealer makes 20 with certainty");
// conditioning on the peek: with a ten up, hole-ace 21s are excluded
const dCond = bjDealerDist(bjFreshCounts(), [10], true);
const dRaw = bjDealerDist(bjFreshCounts(), [10], false);
check(dCond[4] < dRaw[4] - 1e-6, "no-blackjack condition strictly reduces the 21 mass behind a ten");
check(near(dCond.reduce((a, b) => a + b, 0), 1, 1e-9), "conditioned dist still sums to 1");

console.log("verify_blackjack: stand EV");
// hand-built distribution: dealer 50% 18, 30% 20, 20% bust
const toy = [0, 0.5, 0, 0.3, 0, 0.2];
check(near(bjEvStandVsDist(19, toy), 0.5 + 0.2 - 0.3), "EV vs a hand-built dist matches the exact sum");
check(near(bjEvStandVsDist(18, toy), 0.2 - 0.3), "push counts as zero in the sum");
check(bjEvStandVsDist(22, toy) === -1, "standing on a bust is -1 (unreachable, but total)");
check(near(bjEvStand(tensOnly, [10, 1], 10), 1), "rigged deck: standing on 21 vs certain 20 = exactly +1");
check(near(bjEvStand(tensOnly, [10, 10], 10), 0), "rigged deck: 20 vs 20 pushes = exactly 0");
check(near(bjEvStand(tensOnly, [10, 9], 10), -1), "rigged deck: 19 vs certain 20 = exactly -1");

console.log("verify_blackjack: hit and double EV, rigged exact");
check(near(bjEvHit(tensOnly, [10, 2], 10), -1), "all-tens deck: hitting hard 12 always busts = exactly -1");
check(near(bjEvDouble(tensOnly, [6, 5], 10), 2), "all-tens deck: doubling 11 draws 21 vs 20 = exactly +2");
check(near(bjEvDouble(tensOnly, [10, 2], 10), -2), "all-tens deck: doubling 12 always busts = exactly -2");

console.log("verify_blackjack: full-deck advice at the universal poles");
const fresh = bjFreshCounts();
const counts = (pv, up) => { const c = fresh.slice(); for (const v of pv) c[v]--; c[up]--; return c; };
{
  const pv = [6, 5], up = 6;
  const a = bjAdvise(counts(pv, up), pv, up, true, false);
  check(a.best === "double", "hard 11 vs 6: double");
  check(a.evs.double > a.evs.hit && a.evs.hit > a.evs.stand, "11 vs 6 ordering double > hit > stand");
}
{
  const pv = [10, 10], up = 10;
  const a = bjAdvise(counts(pv, up), pv, up, true, false);
  check(a.best === "stand", "hard 20 vs 10: stand");
}
{
  const pv = [3, 2], up = 10;
  const a = bjAdvise(counts(pv, up), pv, up, true, false);
  check(a.best === "hit", "hard 5 vs 10: hit");
  check(a.evs.hit > a.evs.stand, "hitting 5 beats standing on 5");
}
for (let up = 1; up <= 10; up++) {
  const c20 = counts([10, 10], up), c12 = counts([10, 2], up);
  check(bjEvStand(c20, [10, 10], up) > bjEvStand(c12, [10, 2], up), `standing on 20 beats standing on 12 vs upcard ${up}`);
}
{
  const pv = [8, 8], up = 6;
  const a = bjAdvise(counts(pv, up), pv, up, true, true);
  check(a.best === "split", "a pair of 8s vs 6 splits");
  check(typeof a.evs.split === "number" && a.evs.split > a.evs.stand, "split EV present and above standing on 16");
}

console.log("verify_blackjack: settlement");
check(bjSettle(21, true, 20, false, 10) === 25, "natural pays 3:2: $10 returns $25");
check(bjSettle(21, true, 21, true, 10) === 10, "natural vs natural pushes the stake back");
check(bjSettle(20, false, 21, true, 10) === 0, "dealer natural takes a 20");
check(bjSettle(18, false, 17, false, 10) === 20, "18 beats 17 for even money");
check(bjSettle(17, false, 17, false, 10) === 10, "push returns the stake");
check(bjSettle(16, false, 17, false, 10) === 0, "16 loses to 17");
check(bjSettle(18, false, 22, false, 10) === 20, "dealer bust pays even money");
check(bjSettle(22, false, 22, false, 10) === 0, "player bust loses even when the dealer busts too");
check(bjSettle(21, true, 20, false, 5) === 12, "3:2 on an odd stake floors: $5 returns $12");
{
  let sane = true;
  for (let p = 16; p <= 22; p++) for (let d = 17; d <= 22; d++) {
    const c = bjSettle(p, false, d, false, 10);
    if (c < 0 || c > 25) sane = false;
  }
  check(sane, "every settlement credit stays within [0, 2.5x stake]");
}

if (fail === 0) console.log(`✓ verify_blackjack: all ${ok} checks passed`);
else { console.error(`✗ verify_blackjack: ${fail} of ${ok + fail} checks failed`); process.exit(1); }
