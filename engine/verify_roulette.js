#!/usr/bin/env node
/* Verifies roulette by eval'ing the COMPILED page (the shipped math, not a
 * copy): the wheel's 38 pockets and 18/18/2 colors; that EVERY offered bet's
 * expected value is exactly -2/38 per unit (checked in integers: for a 1-unit
 * stake, ways*payout - (38-ways) must equal -2 — no floats, no tolerance);
 * membership spot-checks for the layout bets; and settleSpin's payout
 * arithmetic including the multi-bet case.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "roulette.html"), "utf8");
const body = html.split("\n<script>\n").pop().split("\n</script>")[0];

let ok = 0, fail = 0;
const check = (cond, msg) => { if (cond) { ok++; } else { fail++; console.error("  ✗ " + msg); } };

const sandbox = {
  React: { createElement: () => ({}), useState: (v) => [typeof v === "function" ? v() : v, () => {}], useMemo: (f) => f(), useCallback: (f) => f, useEffect: () => {}, useRef: (v) => ({ current: v }) },
  ReactDOM: { createRoot: () => ({ render() {} }) },
  document: { getElementById: () => ({}) },
  localStorage: { getItem: () => null, setItem: () => {} },
  window: undefined, Math, JSON, Set, Number,
};
vm.createContext(sandbox);
vm.runInContext(body, sandbox);
const { POCKETS, RED_SET, pocketColor, covers, betPayout, betMath, settleSpin } =
  vm.runInContext("({ POCKETS, RED_SET, pocketColor, covers, betPayout, betMath, settleSpin })", sandbox);

/* the wheel itself */
check(POCKETS.length === 38 && new Set(POCKETS).size === 38, "38 unique pockets");
check(RED_SET.size === 18, "18 reds");
check(POCKETS.filter((p) => pocketColor(p) === "black").length === 18, "18 blacks");
check(pocketColor("0") === "green" && pocketColor("00") === "green", "two green zeros");

/* every offered bet: EV exactly -2/38, in integers */
const OFFERED = ["red", "black", "odd", "even", "low", "high", "dozen1", "dozen2", "dozen3", "col1", "col2", "col3",
  ...POCKETS.map((p) => `n:${p}`)];
for (const id of OFFERED) {
  let ways = 0;
  for (const p of POCKETS) if (covers(id, p)) ways++;
  const integerEv = ways * betPayout(id) - (38 - ways);
  check(integerEv === -2, `bet ${id}: 1-unit EV over 38 spins is exactly -2 units (got ${integerEv})`);
  const m = betMath(id);
  check(m.ways === ways && Math.abs(m.evPerUnit - (-2 / 38)) < 1e-15, `betMath(${id}) agrees`);
}

/* membership spot-checks */
check(covers("col1", "1") && covers("col1", "34") && !covers("col1", "2"), "column 1 is 1,4,…,34");
check(covers("dozen2", "13") && covers("dozen2", "24") && !covers("dozen2", "25"), "second dozen is 13–24");
check(!covers("odd", "0") && !covers("even", "00") && !covers("low", "0"), "zeros lose every outside bet");
check(covers("red", "32") && !covers("red", "11"), "32 is red, 11 is black (wheel-true)");

/* settlement arithmetic */
check(settleSpin({ "n:17": 10 }, "17") === 360, "straight-up returns 36x the stake");
check(settleSpin({ "n:17": 10 }, "18") === 0, "losing straight returns nothing");
check(settleSpin({ red: 50, dozen1: 30, "n:5": 5 }, "5") === 100 + 90 + 180, "multi-bet spin sums each winner (5 is red, 1st dozen, straight)");
check(settleSpin({ black: 100 }, "0") === 0, "zero sweeps the outside");

console.log(fail === 0 ? `✓ verify_roulette: all ${ok} checks passed` : `✗ verify_roulette: ${fail} of ${ok + fail} checks FAILED`);
process.exit(fail === 0 ? 0 : 1);
