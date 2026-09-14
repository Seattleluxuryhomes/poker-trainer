#!/usr/bin/env node
/* Verifies Spanish 21 by eval'ing the COMPILED page:
 *   - the deck: 48 cards by construction (no tens, twelve faces);
 *   - sp21BonusRate from the printed rules: 5-card 3:2, 6-card 2:1, 7+ 3:1,
 *     6-7-8 and 7-7-7 at 3:2 mixed, plain 3/4-card 21s at even money;
 *   - THE rule: standing on 21 is an exact automatic win at the bonus rate,
 *     whatever the dealer shows (evStand(21) === its bonus, exactly);
 *   - rigged all-faces deck: dealer 20 certain, stand-20 pushes exactly 0,
 *     hitting hard 12 is exactly -1, doubling 11 is exactly +2 (doubled 21
 *     pays even, no bonus — and still beats the certain 20);
 *   - full-deck advice poles that survive the missing tens: double 11 vs 6,
 *     stand hard 20 vs face, hit hard 5 vs face — from our own enumeration;
 *   - the famous divergence from blackjack: hard 12 vs 6 HITS here (fewer
 *     tens = busting is rarer and the dealer's 6 is less fragile);
 *   - sp21Payout: naturals 3:2 and unbeatable, suited/spaded 6-7-8 premiums,
 *     doubled-21 bonus void, bounds over the outcome grid.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "sp21.html"), "utf8");
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
const { sp21Counts, sp21Val, sp21Total, sp21BonusRate, sp21DealerDist, sp21EvStand, sp21EvHit, sp21EvDouble, sp21Advise, sp21Payout, sp21Deck } =
  vm.runInContext("({ sp21Counts, sp21Val, sp21Total, sp21BonusRate, sp21DealerDist, sp21EvStand, sp21EvHit, sp21EvDouble, sp21Advise, sp21Payout, sp21Deck })", sandbox);

console.log("verify_sp21: the Spanish deck");
check(sp21Counts().reduce((a, b) => a + b, 0) === 48, "48 cards by value");
check(sp21Counts()[10] === 12, "twelve faces, zero tens");
const deck = sp21Deck();
check(deck.length === 48 && !deck.some((c) => c.r === 10), "the dealt deck has no 10-spots");

console.log("verify_sp21: bonus rates from the printed rules");
check(sp21BonusRate([10, 4, 7]) === 1, "a plain 3-card 21 pays even");
check(sp21BonusRate([6, 7, 8]) === 1.5 && sp21BonusRate([7, 7, 7]) === 1.5, "6-7-8 and 7-7-7 pay 3:2 (mixed)");
check(sp21BonusRate([5, 5, 5, 3, 3]) === 1.5, "a 5-card 21 pays 3:2");
check(sp21BonusRate([2, 2, 3, 4, 5, 5]) === 2, "a 6-card 21 pays 2:1");
check(sp21BonusRate([1, 2, 2, 3, 4, 4, 5]) === 3, "a 7-card 21 pays 3:1");
check(sp21BonusRate([10, 5, 5]) === 0, "20 is not 21");

console.log("verify_sp21: 21 always wins, exactly");
{
  const fresh = sp21Counts();
  for (const up of [1, 6, 10]) {
    check(near(sp21EvStand(fresh, [10, 4, 7], up), 1), `standing on a plain 21 vs upcard ${up} is EXACTLY +1`);
  }
  check(near(sp21EvStand(fresh, [5, 5, 5, 3, 3], 10), 1.5), "standing on a 5-card 21 is EXACTLY +1.5");
  check(near(sp21EvStand(fresh, [6, 7, 8], 10), 1.5), "standing on 6-7-8 is EXACTLY +1.5 (mixed rate)");
}

console.log("verify_sp21: rigged all-faces deck, exact values");
{
  const faces = new Array(11).fill(0); faces[10] = 12;
  const d = sp21DealerDist(faces, [10], false);
  check(near(d[3], 1), "all-faces deck: dealer makes 20 with certainty");
  check(near(sp21EvStand(faces, [10, 10], 10), 0), "standing on 20 vs certain 20 pushes: exactly 0");
  check(near(sp21EvHit(faces, [10, 2], 10), -1), "hitting hard 12 always busts: exactly -1");
  check(near(sp21EvDouble(faces, [6, 5], 10), 2), "doubling 11 draws a doubled 21 (bonus void, still an auto-win): exactly +2");
}

console.log("verify_sp21: advice poles from our own enumeration");
{
  const fresh = sp21Counts();
  const counts = (pv, up) => { const c = fresh.slice(); for (const v of pv) c[v]--; c[up]--; return c; };
  let a = sp21Advise(counts([6, 5], 6), [6, 5], 6, true, false);
  check(a.best === "double", "hard 11 vs 6: double, even in Spanish");
  a = sp21Advise(counts([10, 10], 10), [10, 10], 10, true, false);
  check(a.best === "stand", "hard 20 vs a face: stand");
  a = sp21Advise(counts([3, 2], 10), [3, 2], 10, true, false);
  check(a.best === "hit", "hard 5 vs a face: hit");
  a = sp21Advise(counts([10, 2], 6), [10, 2], 6, true, false);
  check(a.best === "hit", "the famous divergence: hard 12 vs 6 HITS in Spanish 21 (it stands in blackjack)");
}

console.log("verify_sp21: settlement");
const c = (r, s) => ({ r, s });
check(sp21Payout([c(1, 1), c(13, 2)], false, false, 20, false, 10) === 25, "natural pays 3:2");
check(sp21Payout([c(1, 1), c(13, 2)], false, false, 21, true, 10) === 25, "natural beats even a dealer natural — always wins");
check(sp21Payout([c(6, 1), c(7, 2), c(8, 3)], false, false, 20, false, 10) === 25, "mixed 6-7-8 pays 3:2");
check(sp21Payout([c(6, 1), c(7, 1), c(8, 1)], false, false, 20, false, 10) === 30, "suited 6-7-8 pays 2:1");
check(sp21Payout([c(6, 0), c(7, 0), c(8, 0)], false, false, 20, false, 10) === 40, "spaded 6-7-8 pays 3:1");
check(sp21Payout([c(7, 0), c(7, 1), c(7, 2)], false, false, 20, false, 10) === 25, "mixed 7-7-7 pays 3:2");
check(sp21Payout([c(5, 0), c(5, 1), c(5, 2), c(3, 0), c(3, 1)], false, false, 17, false, 10) === 25, "5-card 21 pays 3:2");
check(sp21Payout([c(6, 1), c(5, 2), c(13, 3)], true, false, 20, false, 20) === 40, "a DOUBLED 21 pays even money — bonuses void");
check(sp21Payout([c(13, 1), c(9, 2)], false, false, 21, false, 10) === 0, "19 loses to a dealer 21 (only YOUR 21 always wins)");
check(sp21Payout([c(13, 1), c(9, 2)], false, false, 22, false, 10) === 20, "dealer bust pays even");
check(sp21Payout([c(13, 1), c(9, 2)], false, false, 19, false, 10) === 10, "push returns the stake");
check(sp21Payout([c(13, 1), c(9, 2), c(8, 0)], false, false, 17, false, 10) === 0, "a bust returns nothing");
{
  let sane = true;
  for (let d = 17; d <= 22; d++) {
    const pay = sp21Payout([c(13, 1), c(8, 2)], false, false, d, false, 10);
    if (pay < 0 || pay > 40) sane = false;
  }
  check(sane, "payouts bounded on the outcome grid");
}

console.log(fail === 0 ? `✓ verify_sp21: all ${ok} checks passed` : `✗ verify_sp21: ${fail} of ${ok + fail} checks FAILED`);
process.exit(fail === 0 ? 0 : 1);
