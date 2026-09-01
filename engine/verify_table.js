#!/usr/bin/env node
/* Verifies the Hold'em table's Elmish-style reducer (table.html) without a browser.
 * The page is a faithful React translation of the founder-supplied F# Fable/Elmish
 * component; `update(model, msg)` and `initModel()` are top-level in the compiled
 * <script>. We eval them in a vm sandbox and check the supplied semantics verbatim:
 *   - init: pot 1250.50, 3 community cards, 4 seats, user seat 1 on turn holding K♠ Q♥;
 *   - FoldAction: user -> Folded, turn over; nobody else touched;
 *   - CallAction: user balance -CurrentBet, pot +50;
 *   - RaiseAction(amount): user balance -amount, currentBet = amount, pot +amount;
 *   - UpdateRaiseVal: slider only, everything else untouched;
 *   - update is pure: the input model is never mutated.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "table.html"), "utf8");
const body = html.split("\n<script>\n").pop().split("\n</script>")[0];

let ok = 0, fail = 0;
const check = (cond, msg) => { if (cond) { ok++; } else { fail++; console.error("  ✗ " + msg); } };

const sandbox = {
  React: { createElement: () => ({}), useState: () => [0, () => {}], useMemo: (f) => f(), useCallback: (f) => f, useEffect: () => {}, useRef: () => ({ current: null }), useReducer: () => [null, () => {}] },
  ReactDOM: { createRoot: () => ({ render() {} }) },
  document: { getElementById: () => ({}) },
  localStorage: { getItem: () => null },
  Math, console,
};
vm.createContext(sandbox);
vm.runInContext(body, sandbox);
const { update, initModel } = vm.runInContext("({ update, initModel })", sandbox);

const user = (m) => m.players.find((p) => p.id === m.userSeatId);

/* ---- init state, as supplied ---- */
{
  const m = initModel();
  check(m.pot === 1250.5, `init pot 1250.50 (got ${m.pot})`);
  check(m.communityCards.length === 3, "init deals 3 community cards");
  check(m.players.length === 4, "init seats 4 players");
  check(user(m).isTurn === true && user(m).name === "You", "user seat 1 is on turn");
  check(user(m).cards.map((c) => `${c.r}.${c.s}`).join(" ") === "13.0 12.1", "user holds K♠ Q♥");
  check(m.players[2].status === "Folded", "Satoshi_99 starts folded");
  check(m.minRaise === 50 && m.maxRaise === 2500 && m.raiseSliderVal === 100, "raise slider bounds as supplied");
}

/* ---- FoldAction ---- */
{
  const m0 = initModel();
  const m1 = update(m0, { type: "FoldAction" });
  check(user(m1).status === "Folded" && user(m1).isTurn === false, "fold: user folded, turn over");
  check(m1.pot === m0.pot, "fold: pot untouched");
  check(m1.players[1].status === "Active", "fold: other seats untouched");
  check(user(m0).status === "Active", "update is pure (fold did not mutate the input model)");
}

/* ---- CallAction ---- */
{
  const m0 = initModel();
  const m1 = update(m0, { type: "CallAction" });
  check(user(m1).balance === 2450 - 50, `call: balance drops by the current bet (got ${user(m1).balance})`);
  check(m1.pot === 1250.5 + 50, `call: pot +50 (got ${m1.pot})`);
  check(user(m1).isTurn === false, "call: turn over");
}

/* ---- RaiseAction ---- */
{
  const m0 = initModel();
  const m1 = update(m0, { type: "RaiseAction", amount: 300 });
  check(user(m1).balance === 2450 - 300, `raise: balance -amount (got ${user(m1).balance})`);
  check(user(m1).currentBet === 300, "raise: current bet = amount");
  check(m1.pot === 1250.5 + 300, `raise: pot +amount (got ${m1.pot})`);
}

/* ---- UpdateRaiseVal ---- */
{
  const m0 = initModel();
  const m1 = update(m0, { type: "UpdateRaiseVal", value: 777 });
  check(m1.raiseSliderVal === 777, "slider: value updates");
  check(m1.pot === m0.pot && user(m1).balance === user(m0).balance, "slider: nothing else moves");
}

console.log(fail === 0 ? `✓ verify_table: all ${ok} checks passed` : `✗ verify_table: ${fail} of ${ok + fail} checks FAILED`);
process.exit(fail === 0 ? 0 : 1);
