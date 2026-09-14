#!/usr/bin/env node
/* Verifies Baccarat by eval'ing the COMPILED page:
 *   - the tableau, rule by rule, against the published drawing table;
 *   - bacEnumerate is EXACT: probabilities sum to 1 to machine precision;
 *     rigged shoes give hand-derivable certainties (all-9s = natural 9-9
 *     tie always; all-zeros = 0-0 with both drawing zeros, tie always;
 *     all-aces: P 1+1+1=3 vs B 1+1+1=3, tie always);
 *   - the fresh 8-deck numbers agree with the independently published
 *     figures (Banker 45.8597%, Player 44.6247%, Tie 9.5156%) to 1e-4 —
 *     an external cross-check on a number we computed ourselves;
 *   - edges follow from the probabilities by arithmetic (banker ≈ 1.06%,
 *     player ≈ 1.24%, tie ≈ 14.36%) and order banker < player << tie;
 *   - bacSettle: player 1:1, banker 19:20 floored, tie 8:1 with main-bet
 *     pushes; conservation over the full outcome × bet grid.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "bac.html"), "utf8");
const body = html.split("\n<script>\n").pop().split("\n</script>")[0];

let ok = 0, fail = 0;
const check = (cond, msg) => { if (cond) { ok++; } else { fail++; console.error("  ✗ " + msg); } };
const near = (a, b, eps) => Math.abs(a - b) < eps;

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
const { bacShoe, bacVal, playerDraws, bankerDraws, bacEnumerate, bacEdges, bacSettle } =
  vm.runInContext("({ bacShoe, bacVal, playerDraws, bankerDraws, bacEnumerate, bacEdges, bacSettle })", sandbox);

console.log("verify_baccarat: the tableau, rule by rule");
check(bacVal(10) === 0 && bacVal(13) === 0 && bacVal(1) === 1 && bacVal(9) === 9, "tens and faces are zero, ace is one");
for (let t = 0; t <= 5; t++) check(playerDraws(t), `player draws on ${t}`);
for (let t = 6; t <= 7; t++) check(!playerDraws(t), `player stands on ${t}`);
check(bankerDraws(0, null) && bankerDraws(5, null) && !bankerDraws(6, null), "banker vs a standing player: draw 0-5, stand 6+");
check(bankerDraws(2, 8) && bankerDraws(1, 0), "banker 0-2 always draws");
check(bankerDraws(3, 7) && !bankerDraws(3, 8), "banker 3 draws unless the third card is 8");
check(bankerDraws(4, 2) && bankerDraws(4, 7) && !bankerDraws(4, 1) && !bankerDraws(4, 8), "banker 4 draws vs 2-7 only");
check(bankerDraws(5, 4) && bankerDraws(5, 7) && !bankerDraws(5, 3) && !bankerDraws(5, 8), "banker 5 draws vs 4-7 only");
check(bankerDraws(6, 6) && bankerDraws(6, 7) && !bankerDraws(6, 5), "banker 6 draws vs 6-7 only");
check(!bankerDraws(7, 6) && !bankerDraws(7, 0), "banker 7 always stands");

console.log("verify_baccarat: exact enumeration");
{
  const p = bacEnumerate(bacShoe(8));
  check(near(p.pPlayer + p.pBanker + p.pTie, 1, 1e-9), "probabilities sum to 1 (exact walk, no paths lost)");
  check(near(p.pBanker, 0.458597, 1e-4), `banker ${p.pBanker.toFixed(6)} matches the published 0.458597`);
  check(near(p.pPlayer, 0.446247, 1e-4), `player ${p.pPlayer.toFixed(6)} matches the published 0.446247`);
  check(near(p.pTie, 0.095156, 1e-4), `tie ${p.pTie.toFixed(6)} matches the published 0.095156`);
  const e = bacEdges(p);
  check(near(-e.banker, 0.0106, 5e-4), `banker edge ${(-e.banker * 100).toFixed(3)}% ≈ 1.06%`);
  check(near(-e.player, 0.0124, 5e-4), `player edge ${(-e.player * 100).toFixed(3)}% ≈ 1.24%`);
  check(near(-e.tie, 0.1436, 2e-3), `tie edge ${(-e.tie * 100).toFixed(2)}% ≈ 14.36%`);
  check(-e.banker < -e.player && -e.player < -e.tie / 5, "edges order: banker < player << tie");
}
{
  // rigged shoes: certainties derivable by hand
  const nines = new Array(10).fill(0); nines[9] = 32;
  const p9 = bacEnumerate(nines);
  check(near(p9.pTie, 1, 1e-12), "all-9s shoe: natural 9 vs natural 9, tie with certainty");
  const zeros = new Array(10).fill(0); zeros[0] = 128;
  const p0 = bacEnumerate(zeros);
  check(near(p0.pTie, 1, 1e-12), "all-faces shoe: 0-0, both draw zeros, tie with certainty");
  const aces = new Array(10).fill(0); aces[1] = 32;
  const p1 = bacEnumerate(aces);
  check(near(p1.pTie, 1, 1e-12), "all-aces shoe: 3 vs 3 after forced draws, tie with certainty");
}

console.log("verify_baccarat: settlement");
check(bacSettle("player", { player: 100, banker: 0, tie: 0 }) === 200, "player win pays 1:1");
check(bacSettle("banker", { player: 0, banker: 100, tie: 0 }) === 195, "banker win pays 19:20 ($100 returns $195)");
check(bacSettle("banker", { player: 0, banker: 5, tie: 0 }) === 9, "commission floors: $5 banker returns $9, not $9.75");
check(bacSettle("tie", { player: 50, banker: 50, tie: 10 }) === 190, "tie: 8:1 on the tie bet, mains push ($90+$100)");
check(bacSettle("player", { player: 0, banker: 100, tie: 10 }) === 0, "losing spots return nothing");
{
  let sane = true;
  for (const out of ["player", "banker", "tie"])
    for (const bets of [{ player: 10, banker: 0, tie: 0 }, { player: 0, banker: 10, tie: 0 }, { player: 0, banker: 0, tie: 10 }, { player: 10, banker: 10, tie: 10 }]) {
      const c = bacSettle(out, bets);
      const staked = bets.player + bets.banker + bets.tie;
      if (c < 0 || c > staked * 9) sane = false;
    }
  check(sane, "every settlement stays within [0, 9x stake]");
}

console.log(fail === 0 ? `✓ verify_baccarat: all ${ok} checks passed` : `✗ verify_baccarat: ${fail} of ${ok + fail} checks FAILED`);
process.exit(fail === 0 ? 0 : 1);
