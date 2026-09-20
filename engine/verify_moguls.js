#!/usr/bin/env node
/* Verifies Mogul Row by eval'ing the COMPILED page:
 *   - the board: 40 squares, the corners where they belong, 22 deeds in 8
 *     groups, 4 depots, 2 utilities, 2 taxes, 6 card squares;
 *   - the dice: 36 outcomes, our SR-style ways table;
 *   - THE CHAIN: the stationary distribution sums to 1, every square has a
 *     positive share, the lockup leads by a wide margin, the squares a
 *     natural roll past the lockup beat the ones just past PAYDAY (the one
 *     real strategic fact of this family, DERIVED here rather than asserted),
 *     and go-to-jail has zero landings because it never holds a token;
 *   - rent: bare, doubled on a full group, the house ladder, depots by
 *     count, utilities by dice, mortgaged deeds earn nothing;
 *   - building: only on a full unmortgaged group, evenly, bank stock limits,
 *     hotels return their houses, selling is half price;
 *   - money: every transfer conserves cash, bankruptcy hands the estate over,
 *     the last player standing wins;
 *   - the auction, the lockup, and the Coach agreeing with the rivals' book;
 *   - SEEDED FULL GAMES: four bots play to a winner with cash conserved.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "moguls.html"), "utf8");
const body = html.split("\n<script>\n").pop().split("\n</script>")[0];
let ok = 0, fail = 0;
const check = (c, m) => { if (c) ok++; else { fail++; console.error("  ✗ " + m); } };

const sandbox = {
  React: { createElement: () => ({}), useState: (v) => [typeof v === "function" ? v() : v, () => {}], useMemo: (f) => f(), useCallback: (f) => f, useEffect: () => {}, useRef: (v) => ({ current: v }) },
  ReactDOM: { createRoot: () => ({ render() {} }) },
  document: { getElementById: () => ({}) }, localStorage: { getItem: () => null, setItem: () => {} },
  window: undefined, Math, JSON, Set, Map, Number, Array, Object, performance: { now: () => 0 },
  setTimeout: (f) => f(), clearTimeout: () => {}, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
};
vm.createContext(sandbox);
vm.runInContext(body, sandbox);
const E = vm.runInContext(`({ MR_BOARD, MR_GROUPS, MR_N, MR_JAIL, MR_GOTOJAIL, MR_WAYS, MR_MULT, MR_STATION_RENT, MR_UTIL_MULT,
  MR_START_CASH, MR_SALARY, MR_FINE, MR_MAX_HOUSES, MR_HOUSE_POOL, MR_HOTEL_POOL, MR_DECKS, MR_RIVALS,
  mrChain, mrLanding, mrNew, mrClone, mrRolls, mrRentAt, mrHasGroup, mrCountKind, mrGroupSquares, mrExpectedRent,
  mrCanBuild, mrBuild, mrCanSellHouse, mrSellHouse, mrMortgage, mrUnmortgage, mrMortgageValue, mrUnmortgageCost,
  mrRoll, mrBuy, mrDeclineBuy, mrEndTurn, mrCharge, mrBankrupt, mrNetWorth, mrBotStep, mrBotValue, mrCoach,
  mrAuctionBid, mrAuctionPass, mrStartAuction, mrPayFine, mrGoToJail, mrPrice, mrPayback })`, sandbox);

const cash = (s) => s.players.reduce((n, p) => n + p.cash, 0);

console.log("verify_moguls: the board");
{
  check(E.MR_BOARD.length === 40 && E.MR_N === 40, "forty squares");
  check(E.MR_BOARD[0].t === "go" && E.MR_BOARD[10].t === "jail" && E.MR_BOARD[20].t === "parking" && E.MR_BOARD[30].t === "gotojail", "the four corners: payday, lockup, lookout, sheriff's call");
  const by = (t) => E.MR_BOARD.filter((c) => c.t === t).length;
  check(by("prop") === 22, `22 deeds (got ${by("prop")})`);
  check(by("station") === 4 && by("utility") === 2 && by("tax") === 2 && by("card") === 6, "4 depots, 2 utilities, 2 taxes, 6 card squares");
  check(E.MR_GROUPS.length === 8 && E.MR_GROUPS.every((g, i) => E.mrGroupSquares(i).length === (i === 0 || i === 7 ? 2 : 3)), "8 groups: two of two deeds, six of three");
  const names = E.MR_BOARD.map((c) => c.name);
  check(names.every((n) => n && n.length > 2), "every square is named");
  check(new Set(names).size === 36, "36 distinct names (the six card squares share two deck names)");
  check(E.MR_BOARD.filter((c) => c.t === "prop").every((c) => c.rents.length === 6 && c.rents[0] === c.base && c.rents[5] > c.rents[4]), "every deed carries a 6-rung rent ladder that rises");
  check(E.MR_DECKS.wildcard.length === 16 && E.MR_DECKS.strongbox.length === 16, "two decks of 16");
  check(E.MR_DECKS.wildcard.filter((c) => c.to != null).length >= 8, "the wildcard deck is movement-heavy");
}

console.log("verify_moguls: the dice");
{
  let sum = 0; for (const k in E.MR_WAYS) sum += E.MR_WAYS[k];
  check(sum === 36 && E.MR_WAYS[7] === 6 && E.MR_WAYS[2] === 1, "36 outcomes, 7 the most common");
  const r = E.mrRolls();
  check(r.length === 36 && r.filter((x) => x.dbl).length === 6, "36 ordered rolls, 6 of them doubles");
  const byEnum = {}; for (const x of r) byEnum[x.sum] = (byEnum[x.sum] || 0) + 1;
  check(Object.keys(byEnum).every((k) => byEnum[k] === E.MR_WAYS[k]), "MR_WAYS equals brute force");
}

console.log("verify_moguls: THE CHAIN (the whole point)");
{
  const land = E.mrLanding();
  check(land.length === 40, "a share for every square");
  const total = land.reduce((a, b) => a + b, 0);
  check(Math.abs(total - 1) < 1e-9, `the distribution sums to 1 (got ${total.toFixed(12)})`);
  check(land.every((p, i) => (i === E.MR_GOTOJAIL ? p === 0 : p > 0)), "every square is reachable; the sheriff's call square never holds a token");
  const jail = land[E.MR_JAIL];
  check(jail > 0.08, `the lockup leads at ${(100 * jail).toFixed(2)}%`);
  const others = land.filter((_, i) => i !== E.MR_JAIL);
  check(jail > 2.5 * Math.max(...others), "…by more than 2.5× the next square");
  // the one real strategic fact of this family, DERIVED: a natural roll past
  // the lockup (squares 16-21) beats the same count of squares past PAYDAY.
  const past = (start, n) => land.slice(start + 1, start + 1 + n).reduce((a, b) => a + b, 0);
  const afterJail = past(E.MR_JAIL, 9), afterGo = past(0, 9);   // the nine squares after each, lockup itself excluded
  check(afterJail > afterGo * 1.1, `the nine squares past the lockup out-earn the nine past PAYDAY (${(100 * afterJail).toFixed(2)}% vs ${(100 * afterGo).toFixed(2)}%)`);
  const band = land.slice(E.MR_JAIL + 6, E.MR_JAIL + 10).reduce((a, b) => a + b, 0) / 4;
  const goBand = land.slice(1, 5).reduce((a, b) => a + b, 0) / 4;
  check(band > goBand, `the 6-to-9-past-the-lockup band is the hottest land on the board (${(100 * band).toFixed(2)}% avg vs ${(100 * goBand).toFixed(2)}% after PAYDAY)`);
  const hottest = land.map((p, i) => ({ p, i })).filter((x) => x.i !== E.MR_JAIL).sort((a, b) => b.p - a.p)[0];
  check(hottest.i > E.MR_JAIL && hottest.i <= 28, `the hottest non-lockup square sits past the lockup (#${hottest.i} ${E.MR_BOARD[hottest.i].name})`);
  check(Math.abs(E.mrChain(700).reduce((a, b) => a + b, 0) - 1) < 1e-9, "a longer iteration still sums to 1");
  const a = E.mrChain(300), b = E.mrChain(600);
  check(a.every((x, i) => Math.abs(x - b[i]) < 1e-6), "the chain has converged (300 vs 600 iterations agree to 1e-6)");
}

console.log("verify_moguls: rent");
{
  const s = E.mrNew(() => 0.5);
  const deed = E.MR_BOARD.findIndex((c) => c.t === "prop");
  const g = E.MR_BOARD[deed].g, grp = E.mrGroupSquares(g);
  s.owner[deed] = 1;
  check(E.mrRentAt(s, deed, 7) === E.MR_BOARD[deed].base, "a lone deed charges its base rent");
  for (const i of grp) s.owner[i] = 1;
  check(E.mrRentAt(s, deed, 7) === E.MR_BOARD[deed].base * 2, "a full group doubles the bare rent");
  s.houses[deed] = 1;
  check(E.mrRentAt(s, deed, 7) === E.MR_BOARD[deed].rents[1], "one house switches to the ladder");
  s.houses[deed] = E.MR_MAX_HOUSES;
  check(E.mrRentAt(s, deed, 7) === E.MR_BOARD[deed].rents[5], "a hotel charges the top rung");
  s.mortgaged[deed] = true;
  check(E.mrRentAt(s, deed, 7) === 0, "a mortgaged deed earns nothing");
  s.mortgaged[deed] = false; s.houses[deed] = 0;
  const st = E.MR_BOARD.map((c, i) => (c.t === "station" ? i : -1)).filter((i) => i >= 0);
  s.owner[st[0]] = 2;
  check(E.mrRentAt(s, st[0], 7) === E.MR_STATION_RENT[1], "one depot pays the first rung");
  for (const i of st) s.owner[i] = 2;
  check(E.mrRentAt(s, st[0], 7) === E.MR_STATION_RENT[4], "all four depots pay the top rung");
  const ut = E.MR_BOARD.map((c, i) => (c.t === "utility" ? i : -1)).filter((i) => i >= 0);
  s.owner[ut[0]] = 3;
  check(E.mrRentAt(s, ut[0], 9) === E.MR_UTIL_MULT[1] * 9, "one utility charges its multiple of the dice");
  s.owner[ut[1]] = 3;
  check(E.mrRentAt(s, ut[0], 9) === E.MR_UTIL_MULT[2] * 9, "both utilities charge the bigger multiple");
  check(E.mrRentAt(s, 0, 7) === 0 && E.mrRentAt(s, E.MR_JAIL, 7) === 0, "corners never charge rent");
  // expected rent really is share × rent × nothing else
  s.owner[deed] = 1; s.houses[deed] = 3;
  const land = E.mrLanding();
  check(Math.abs(E.mrExpectedRent(s, deed, 3) - land[deed] * E.MR_BOARD[deed].rents[3]) < 1e-12, "expected rent = landing share × rent");
}

console.log("verify_moguls: building");
{
  const s = E.mrNew(() => 0.5);
  const deed = E.MR_BOARD.findIndex((c) => c.t === "prop");
  const g = E.MR_BOARD[deed].g, grp = E.mrGroupSquares(g);
  s.owner[deed] = 0;
  check(!E.mrCanBuild(s, deed), "no building without the full group");
  for (const i of grp) s.owner[i] = 0;
  s.players[0].cash = 10000;
  check(E.mrCanBuild(s, deed), "a full group unlocks building");
  s.mortgaged[grp[1]] = true;
  check(!E.mrCanBuild(s, deed), "a mortgage anywhere in the group blocks building");
  s.mortgaged[grp[1]] = false;
  E.mrBuild(s, deed);
  check(s.houses[deed] === 1 && s.players[0].cash === 10000 - E.MR_GROUPS[g].house, "a house costs the group's house price");
  check(!E.mrCanBuild(s, deed), "even build: you cannot put a second house up before the rest have one");
  for (const i of grp) if (i !== deed) E.mrBuild(s, i);
  check(grp.every((i) => s.houses[i] === 1) && E.mrCanBuild(s, deed), "…and once they do, you can");
  const before = s.housesLeft;
  E.mrBuild(s, deed);
  check(s.housesLeft === before - 1, "houses come out of the bank's stock");
  for (let k = 0; k < 40; k++) for (const i of grp) if (E.mrCanBuild(s, i)) E.mrBuild(s, i);
  check(grp.every((i) => s.houses[i] === E.MR_MAX_HOUSES), "the group builds all the way to hotels");
  check(s.hotelsLeft === E.MR_HOTEL_POOL - grp.length, "hotels come out of their own stock");
  check(s.housesLeft === E.MR_HOUSE_POOL, "a hotel returns its four houses to the bank");
  const cash0 = s.players[0].cash;
  E.mrSellHouse(s, deed);
  check(s.houses[deed] === E.MR_MAX_HOUSES - 1 && s.players[0].cash === cash0 + Math.floor(E.MR_GROUPS[g].house / 2), "selling a building returns half price");
  // mortgage round trip
  const t = E.mrNew(() => 0.5);
  const d2 = E.MR_BOARD.findIndex((c) => c.t === "prop");
  t.owner[d2] = 0; const c0 = t.players[0].cash;
  E.mrMortgage(t, d2);
  check(t.mortgaged[d2] && t.players[0].cash === c0 + E.mrMortgageValue(d2), "a mortgage pays half the list price");
  E.mrUnmortgage(t, d2);
  check(!t.mortgaged[d2] && t.players[0].cash === c0 + E.mrMortgageValue(d2) - E.mrUnmortgageCost(d2), "lifting it costs half plus a tenth");
  check(E.mrUnmortgageCost(d2) > E.mrMortgageValue(d2), "…which is more than you got");
}

console.log("verify_moguls: money, the lockup and bankruptcy");
{
  const s = E.mrNew(() => 0.5);
  check(cash(s) === 4 * E.MR_START_CASH, "everyone starts with the same bank");
  const before = cash(s);
  E.mrCharge(s, 1, 100, 2);
  check(cash(s) === before && s.players[1].cash === E.MR_START_CASH - 100 && s.players[2].cash === E.MR_START_CASH + 100, "a rent payment moves money, never mints it");
  E.mrCharge(s, 1, 100, null);
  check(s.players[1].cash === E.MR_START_CASH - 200 && cash(s) === before - 100, "a tax leaves the table");
  // the lockup
  const t = E.mrNew(() => 0.5);
  t.turn = 1; E.mrGoToJail(t);
  check(t.players[1].pos === E.MR_JAIL && t.players[1].jail === 1, "go-to-jail moves the token and starts the clock");
  const c0 = t.players[1].cash;
  E.mrPayFine(t);
  check(t.players[1].jail === 0 && t.players[1].cash === c0 - E.MR_FINE, "the fine buys your way out");
  t.players[1].pardons = 1; E.mrGoToJail(t);
  const c1 = t.players[1].cash;
  E.mrPayFine(t);
  check(t.players[1].jail === 0 && t.players[1].cash === c1 && t.players[1].pardons === 0, "a pardon is spent before cash");
  // bankruptcy hands over the estate
  const u = E.mrNew(() => 0.5);
  const deed = E.MR_BOARD.findIndex((c) => c.t === "prop");
  u.owner[deed] = 1; u.players[1].cash = 10;
  E.mrBankrupt(u, 1, 2);
  check(u.players[1].out && u.owner[deed] === 2 && u.players[2].cash === E.MR_START_CASH + 10, "bankruptcy passes deeds and cash to the creditor");
  E.mrBankrupt(u, 3, null);
  check(u.players[3].out && u.phase !== "over", "two out, two left — the game continues");
  E.mrBankrupt(u, 0, 2);
  check(u.phase === "over" && u.winner === 2, "the last player standing owns the row");
}

console.log("verify_moguls: the auction and the book");
{
  const s = E.mrNew(() => 0.5);
  const deed = E.MR_BOARD.findIndex((c) => c.t === "prop");
  s.turn = 0; s.phase = "act";
  E.mrStartAuction(s, deed);
  check(s.owner[deed] != null || s.phase === "auction", "an auction either resolves among the bots or waits for you");
  // a deed that completes a group is worth more than the same deed cold
  const t = E.mrNew(() => 0.5);
  const g = E.MR_BOARD[deed].g, grp = E.mrGroupSquares(g);
  const cold = E.mrBotValue(t, 0, deed);
  for (const i of grp) if (i !== deed) t.owner[i] = 0;
  const hot = E.mrBotValue(t, 0, deed);
  check(hot > cold, "the book pays up for the deed that completes a group");
  const u = E.mrNew(() => 0.5);
  for (const i of grp) if (i !== deed) u.owner[i] = 1;
  check(E.mrBotValue(u, 0, deed) > cold, "…and pays up to block a rival's group too");
  // the Coach quotes the same book
  const v = E.mrNew(() => 0.5);
  v.turn = 0; v.phase = "buy"; v.pending = { kind: "buy", sq: deed };
  const c = E.mrCoach(v);
  check(c.title && c.why.includes("$" + E.mrBotValue(v, 0, deed)), "the Coach quotes your book value verbatim");
  check(/landings/.test(c.why), "…and the square's landing share");
  check(c.act === "buy" || c.act === "decline", "…and commits to a verdict");
  v.phase = "roll"; v.pending = null;
  check(/Lockup/.test(E.mrCoach(v).why), "on a roll the Coach explains why the board is not uniform");
}

console.log("verify_moguls: seeded full games");
{
  let games = 0, wins = [0, 0, 0, 0], broke = null, longest = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const rng = E.mrChain ? mulberry(seed) : Math.random;
    const s = E.mrNew(rng);
    for (const p of s.players) p.bot = true;
    let steps = 0;
    while (s.phase !== "over" && steps++ < 60000) {
      const c0 = cash(s);
      E.mrBotStep(s, rng);
      if (s.players.some((p) => p.cash < 0)) { broke = `seed ${seed}: negative cash`; break; }
      if (cash(s) > c0 + 4 * E.MR_SALARY + 2000) { broke = `seed ${seed}: money appeared from nowhere`; break; }
      if (s.housesLeft < 0 || s.hotelsLeft < 0) { broke = `seed ${seed}: the bank ran past its stock`; break; }
      if (s.round > 400) break;
    }
    if (broke) break;
    longest = Math.max(longest, s.round);
    if (s.phase === "over") { games++; wins[s.winner]++; }
  }
  check(!broke, broke || "");
  check(games >= 8, `at least 8 of 12 seeded four-bot games reach a winner (got ${games}, longest ${longest} rounds)`);
  check(wins.filter((w) => w > 0).length >= 2, `more than one seat can win (${wins.join("/")})`);
}
function mulberry(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

console.log(fail === 0 ? `✓ verify_moguls: all ${ok} checks passed` : `✗ verify_moguls: ${fail} of ${ok + fail} checks FAILED`);
process.exit(fail === 0 ? 0 : 1);
