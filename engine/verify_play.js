#!/usr/bin/env node
/* Verifies the Play page's money math and hint (play.html) without a browser, by eval'ing
 * the compiled <script> in a vm sandbox:
 *   - payoutFor: per-coin linearity at bets 1-4 for every category; the royal's 4000-coin
 *     jackpot at max bet (and ONLY at max bet — at 4 coins it is 4·800 = 3200);
 *   - categorizeCards agrees with categorize on card objects;
 *   - bestHold (the Hint) is exactly analyze()[0].idxs — the same engine, so the game's
 *     advice can never disagree with the trainer's analysis.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "play.html"), "utf8");
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
// Top-level `const`s live in the context's lexical scope, not on the sandbox object.
const { payoutFor, PAY, CAT, categorize, categorizeCards, bestHold, analyze } =
  vm.runInContext("({ payoutFor, PAY, CAT, categorize, categorizeCards, bestHold, analyze })", sandbox);

/* ---- paytable linearity + the max-bet royal jackpot ---- */
for (let cat = 0; cat < 10; cat++)
  for (let bet = 1; bet <= 4; bet++)
    check(payoutFor(cat, bet) === PAY[cat] * bet, `payoutFor(${cat}, ${bet}) is per-coin linear`);
check(payoutFor(CAT.ROYAL, 5) === 4000, `royal at max bet pays 4000 (got ${payoutFor(CAT.ROYAL, 5)})`);
check(payoutFor(CAT.ROYAL, 4) === 3200, "royal at 4 coins pays only 3200");
for (let cat = 0; cat < 9; cat++)
  check(payoutFor(cat, 5) === PAY[cat] * 5, `non-royal category ${cat} stays linear at max bet`);

/* ---- categorizeCards agrees with categorize ---- */
{
  const hands = [
    [{ r: 1, s: 3 }, { r: 10, s: 3 }, { r: 11, s: 3 }, { r: 12, s: 3 }, { r: 13, s: 3 }],
    [{ r: 1, s: 0 }, { r: 2, s: 1 }, { r: 3, s: 2 }, { r: 4, s: 3 }, { r: 5, s: 0 }],
    [{ r: 9, s: 0 }, { r: 9, s: 1 }, { r: 9, s: 2 }, { r: 13, s: 3 }, { r: 13, s: 0 }],
    [{ r: 10, s: 0 }, { r: 10, s: 1 }, { r: 3, s: 2 }, { r: 7, s: 3 }, { r: 13, s: 0 }],
  ];
  const want = [CAT.ROYAL, CAT.STRAIGHT, CAT.FULL_HOUSE, CAT.NOTHING];
  hands.forEach((h, i) => {
    check(categorizeCards(h) === want[i], `categorizeCards hand ${i}: got ${categorizeCards(h)}, want ${want[i]}`);
    check(categorizeCards(h) === categorize(h.map((c) => c.r), h.map((c) => c.s)), `categorizeCards agrees with categorize on hand ${i}`);
  });
}

/* ---- the Hint is the trainer's own top-ranked hold ---- */
{
  const hands = [
    [{ r: 10, s: 2 }, { r: 11, s: 2 }, { r: 12, s: 2 }, { r: 13, s: 2 }, { r: 8, s: 2 }],
    [{ r: 2, s: 0 }, { r: 2, s: 1 }, { r: 7, s: 2 }, { r: 9, s: 3 }, { r: 13, s: 1 }],
    [{ r: 3, s: 0 }, { r: 6, s: 1 }, { r: 8, s: 2 }, { r: 11, s: 3 }, { r: 1, s: 1 }],
  ];
  for (const h of hands)
    check(bestHold(h).join(",") === analyze(h)[0].idxs.join(","), `bestHold == analyze[0] for ${JSON.stringify(h.map((c) => c.r))}`);
}

console.log(fail === 0 ? `✓ verify_play: all ${ok} checks passed` : `✗ verify_play: ${fail} of ${ok + fail} checks FAILED`);
process.exit(fail === 0 ? 0 : 1);
