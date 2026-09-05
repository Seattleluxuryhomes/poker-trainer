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
const { diceWays, pPassExact, pDontPassExact, fieldEvPerUnit, oddsPayout, resolveRoll, placeRatio, placeEdgeExact } =
  vm.runInContext("({ diceWays, pPassExact, pDontPassExact, fieldEvPerUnit, oddsPayout, resolveRoll, placeRatio, placeEdgeExact })", sandbox);

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

console.log("verify_craps: place bets");
{
  const near = (a, b) => Math.abs(a - b) < 1e-12;
  check(placeRatio(6) === 7 / 6 && placeRatio(8) === 7 / 6, "place 6/8 pay 7:6");
  check(placeRatio(5) === 7 / 5 && placeRatio(9) === 7 / 5, "place 5/9 pay 7:5");
  check(placeRatio(4) === 9 / 5 && placeRatio(10) === 9 / 5, "place 4/10 pay 9:5");
  check(near(placeEdgeExact(6), (6 - 5 * (7 / 6)) / 11), "place 6 edge = (6 − 5·7/6)/11 exactly (≈1.52%)");
  check(near(placeEdgeExact(5), (6 - 4 * (7 / 5)) / 10), "place 5 edge = (6 − 4·7/5)/10 exactly (4.00%)");
  check(near(placeEdgeExact(4), (6 - 3 * (9 / 5)) / 9), "place 4 edge = (6 − 3·9/5)/9 exactly (≈6.67%)");
  check(placeEdgeExact(4) > placeEdgeExact(5) && placeEdgeExact(5) > placeEdgeExact(6) && placeEdgeExact(6) > 0,
    "the shave orders the edges: 4/10 worst, 6/8 best, all positive for the house");

  const st = (phase, point, place) => ({ phase, point, bets: { pass: 0, dontPass: 0, odds: 0, field: 0, place: { 4: 0, 5: 0, 6: 0, 8: 0, 9: 0, 10: 0, ...place } } });
  let out = resolveRoll(st("point", 4, { 6: 6 }), 3, 3);
  check(out.credit === 7 && out.state.bets.place[6] === 6, "$6 place-6 hit pays exactly $7 and stays working");
  out = resolveRoll(st("point", 4, { 6: 6, 9: 5 }), 3, 4);
  check(out.credit === 0 && out.state.bets.place[6] === 0 && out.state.bets.place[9] === 0, "SEVEN OUT takes every place bet");
  out = resolveRoll(st("comeout", null, { 8: 12 }), 3, 4);
  check(out.state.bets.place[8] === 12 && out.credit === 0, "places are OFF on the come-out — a natural 7 doesn't touch them");
  check(out.events.some((e) => /OFF on the come-out/.test(e)), "and the feed says why they survived");
  out = resolveRoll(st("point", 6, { 6: 6 }), 2, 4);
  check(out.events.some((e) => /Point 6 made/.test(e)) && out.credit === 7, "making the point pays the place on that number too");
  const frozen = st("point", 5, { 4: 5 });
  resolveRoll(frozen, 2, 2);
  check(frozen.bets.place[4] === 5, "resolveRoll stays pure with places aboard");
}

console.log(fail === 0 ? `✓ verify_craps: all ${ok} checks passed` : `✗ verify_craps: ${fail} of ${ok + fail} checks FAILED`);
process.exit(fail === 0 ? 0 : 1);
