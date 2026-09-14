#!/usr/bin/env node
/* Verifies High Card Flush by eval'ing the COMPILED page:
 *   - flushEval finds the longest suit and orders it ace-high;
 *   - the comparator: LENGTH beats rank (four low hearts beat three aces'
 *     suit), equal length compares card by card, exact tie is zero;
 *   - qualification: 9-high 3-flush qualifies, 8-high doesn't, any 4-flush does;
 *   - raise caps: ≤4 cards 1x, five 2x, six/seven 3x;
 *   - settlement, branch by exact branch, with bounds over the grid;
 *   - the strategy line: T-8-6 raises, T-8-5 folds (the printed boundary);
 *   - the simulation: seeded-deterministic, house edge in a sane band.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "flush.html"), "utf8");
const body = html.split("\n<script>\n").pop().split("\n</script>")[0];

let ok = 0, fail = 0;
const check = (cond, msg) => { if (cond) { ok++; } else { fail++; console.error("  ✗ " + msg); } };

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
const { flushEval, flushCompare, hcfQualifies, hcfMaxRaise, hcfSettle, hcfShouldRaise, hcfSimulate, mulberry32 } =
  vm.runInContext("({ flushEval, flushCompare, hcfQualifies, hcfMaxRaise, hcfSettle, hcfShouldRaise, hcfSimulate, mulberry32 })", sandbox);

const c = (r, s) => ({ r, s });
const H = 1, S = 0, D = 2, C7 = 3;

console.log("verify_hcf: the evaluator and the comparator");
{
  const f = flushEval([c(1, H), c(9, H), c(4, H), c(13, S), c(12, S), c(2, D), c(7, C7)]);
  check(f.suit === H && f.ranks.join(",") === "14,9,4", "longest suit found, ordered ace-high");
  const fourLow = flushEval([c(2, H), c(3, H), c(4, H), c(5, H), c(1, S), c(13, S), c(12, S)]);
  const threeAces = flushEval([c(1, S), c(13, S), c(12, S), c(2, H), c(7, D), c(8, C7), c(9, D)]);
  check(flushCompare(fourLow, threeAces) > 0, "LENGTH beats rank: 5-4-3-2 of hearts beats A-K-Q of spades");
  const a = flushEval([c(1, H), c(9, H), c(4, H), c(2, S), c(3, D), c(5, C7), c(7, D)]);
  const b = flushEval([c(1, S), c(9, S), c(3, S), c(2, H), c(4, D), c(5, C7), c(7, D)]);
  check(flushCompare(a, b) > 0, "equal length compares card by card (A-9-4 beats A-9-3)");
  check(flushCompare(a, flushEval([c(1, D), c(9, D), c(4, D), c(2, S), c(3, S), c(5, C7), c(7, C7)])) === 0, "identical ranks tie exactly");
}

console.log("verify_hcf: qualification and raise caps");
check(hcfQualifies({ ranks: [9, 3, 2] }), "9-high three-flush qualifies");
check(!hcfQualifies({ ranks: [8, 7, 6] }), "8-high three-flush does not");
check(hcfQualifies({ ranks: [5, 4, 3, 2] }), "any four-flush qualifies");
check(!hcfQualifies({ ranks: [14, 13] }), "two cards never qualify");
check(hcfMaxRaise(2) === 1 && hcfMaxRaise(4) === 1, "up to four cards: raise 1x");
check(hcfMaxRaise(5) === 2, "five cards: raise 2x");
check(hcfMaxRaise(6) === 3 && hcfMaxRaise(7) === 3, "six or seven: raise 3x");

console.log("verify_hcf: settlement, branch by branch");
check(hcfSettle(true, true, 1, 10, 10) === 0, "a fold returns nothing");
check(hcfSettle(false, false, -1, 10, 30) === 50, "no qualify: ante pays even, raise pushes ($20+$30)");
check(hcfSettle(false, true, 1, 10, 30) === 80, "win vs a qualified dealer: even money on both");
check(hcfSettle(false, true, -1, 10, 30) === 0, "loss takes both");
check(hcfSettle(false, true, 0, 10, 30) === 40, "an exact tie pushes both");
{
  let sane = true;
  for (const q of [true, false]) for (const cmp of [-1, 0, 1]) {
    const pay = hcfSettle(false, q, cmp, 10, 30);
    if (pay < 0 || pay > 80) sane = false;
  }
  check(sane, "every payout within [0, 2x committed]");
}

console.log("verify_hcf: the printed strategy line");
check(hcfShouldRaise({ ranks: [10, 8, 6] }), "T-8-6 three-flush raises (the printed boundary)");
check(!hcfShouldRaise({ ranks: [10, 8, 5] }), "T-8-5 folds");
check(hcfShouldRaise({ ranks: [7, 4, 3, 2] }), "any four-flush raises");
check(!hcfShouldRaise({ ranks: [14, 13] }), "a two-flush folds");

console.log("verify_hcf: the simulation (labeled SIMULATED)");
{
  const e1 = hcfSimulate(20000, mulberry32(7));
  const e2 = hcfSimulate(20000, mulberry32(7));
  check(e1 === e2, "seeded simulation is deterministic");
  check(-e1 > 0 && -e1 < 0.12, `house edge in the sane band (got ${(-e1 * 100).toFixed(2)}% per ante)`);
}

console.log(fail === 0 ? `✓ verify_hcf: all ${ok} checks passed` : `✗ verify_hcf: ${fail} of ${ok + fail} checks FAILED`);
process.exit(fail === 0 ? 0 : 1);
