#!/usr/bin/env node
/* Verifies craps by eval'ing the COMPILED page: dice combinatorics; the pass
 * line's exact 244/495; don't pass's exact 27/1980 edge; the field's exact
 * -1/36 (triple 12 layout); free odds' EV of EXACTLY zero for every point;
 * and resolveRoll driven through scripted sequences — naturals, craps, bar-12
 * push, point-made with odds at true payouts, seven-out — with the chips
 * accounted for at every step.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "craps.html"), "utf8");
const body = html.split("\n<script>\n").pop().split("\n</script>")[0];

let ok = 0, fail = 0;
const check = (cond, msg) => { if (cond) { ok++; } else { fail++; console.error("  ✗ " + msg); } };
const close = (a, b) => Math.abs(a - b) < 1e-12;

const sandbox = {
  React: { createElement: () => ({}), useState: (v) => [typeof v === "function" ? v() : v, () => {}], useMemo: (f) => f(), useCallback: (f) => f, useEffect: () => {}, useRef: (v) => ({ current: v }) },
  ReactDOM: { createRoot: () => ({ render() {} }) },
  document: { getElementById: () => ({}) },
  localStorage: { getItem: () => null, setItem: () => {} },
  window: undefined, Math, JSON, Set, Number,
};
vm.createContext(sandbox);
vm.runInContext(body, sandbox);
const { diceWays, pPassExact, pDontPassExact, fieldEvPerUnit, oddsPayout, resolveRoll } =
  vm.runInContext("({ diceWays, pPassExact, pDontPassExact, fieldEvPerUnit, oddsPayout, resolveRoll })", sandbox);

/* dice truth */
check(diceWays(7) === 6 && diceWays(2) === 1 && diceWays(6) === 5 && diceWays(12) === 1, "dice combinatorics");
check([...Array(11)].reduce((a, _, i) => a + diceWays(i + 2), 0) === 36, "all 36 outcomes accounted");

/* the famous numbers, exactly */
check(close(pPassExact(), 244 / 495), `P(pass) is exactly 244/495 (got ${pPassExact()})`);
const dp = pDontPassExact();
check(close(dp.push, 1 / 36), "bar-12 pushes exactly 1/36");
check(close((1 - dp.win - dp.push) - dp.win, 27 / 1980), "don't pass edge is exactly 27/1980 ≈ 1.36%");
check(close(fieldEvPerUnit(), -1 / 36), "field (triple 12) EV is exactly -1/36");

/* free odds: EV exactly zero for every point */
for (const pt of [4, 5, 6, 8, 9, 10]) {
  const ev = diceWays(pt) * oddsPayout(pt) - diceWays(7) * 1;
  check(ev === 0, `odds behind the ${pt} pay true (${oddsPayout(pt)}:1) — EV exactly 0 (got ${ev})`);
}

/* scripted sequences through the pure state machine */
const mk = (bets, phase = "comeout", point = null) => ({ phase, point, bets: { pass: 0, dontPass: 0, odds: 0, field: 0, ...bets } });

let r = resolveRoll(mk({ pass: 100 }), 4, 3);
check(r.credit === 200 && r.state.phase === "comeout", "come-out 7: pass wins even money");
r = resolveRoll(mk({ pass: 100 }), 1, 1);
check(r.credit === 0, "come-out 2: pass loses");
r = resolveRoll(mk({ dontPass: 100 }), 6, 6);
check(r.credit === 100, "come-out 12: don't pass pushes (stake back, no winnings)");
r = resolveRoll(mk({ dontPass: 100 }), 2, 1);
check(r.credit === 200, "come-out 3: don't pass wins");
r = resolveRoll(mk({ pass: 100 }), 4, 4);
check(r.credit === 0 && r.state.phase === "point" && r.state.point === 8, "come-out 8 sets the point");
r = resolveRoll(mk({ pass: 100, odds: 300 }, "point", 8), 5, 3);
check(r.credit === 200 + 300 + 360, `point 8 made with 300 odds: 200 pass + 300 stake + 360 true-odds winnings (got ${r.credit})`);
r = resolveRoll(mk({ pass: 100, odds: 300, dontPass: 0 }, "point", 8), 4, 3);
check(r.credit === 0 && r.state.phase === "comeout" && r.state.point === null, "seven-out clears the rail");
r = resolveRoll(mk({ dontPass: 100 }, "point", 6), 3, 4);
check(r.credit === 200, "seven-out pays don't pass");
r = resolveRoll(mk({ field: 50 }, "point", 9), 6, 6);
check(r.credit === 200, "field 12 pays triple (stake + 150)");
r = resolveRoll(mk({ field: 50 }), 5, 4);
check(r.credit === 100 && r.state.phase === "point" && r.state.point === 9, "field wins on 9 while the point sets");
r = resolveRoll(mk({ field: 50, pass: 100 }), 3, 4);
check(r.credit === 200, "come-out 7: pass wins, field loses — one credit stream");
/* purity: input state untouched */
const before = mk({ pass: 100 });
resolveRoll(before, 4, 3);
check(before.bets.pass === 100 && before.phase === "comeout", "resolveRoll is pure");

console.log(fail === 0 ? `✓ verify_craps: all ${ok} checks passed` : `✗ verify_craps: ${fail} of ${ok + fail} checks FAILED`);
process.exit(fail === 0 ? 0 : 1);
