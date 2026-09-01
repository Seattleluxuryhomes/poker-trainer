#!/usr/bin/env node
/* Verifies the REAL hold'em game that ships in table.html — evaluator, dealing,
 * betting, side pots — by eval'ing the compiled page in a vm sandbox:
 *   - score5H/score7 tiebreak facts (kickers, wheel, boat ranks, split detection);
 *   - startHand: 52-card deck integrity (holes + remaining deck all unique),
 *     blinds posted, chip conservation, action starts under the gun;
 *   - betting: check-around advances the street and deals the right board size;
 *     min-raise legality is enforced; chip totals are conserved through play;
 *   - fold-out: last player standing takes the pot without a reveal;
 *   - showdown: a rigged deck pays the best hand; layered SIDE POTS pay each
 *     level to the best eligible hand (verified against hand-computed amounts);
 *   - equity sanity: pocket aces preflop vs one random hand ≈ 85% (simulated,
 *     seeded rng, wide tolerance);
 *   - botDecide returns only legal actions across seeded random hands.
 * The rng is injected (mulberry32), so every check is reproducible.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "table.html"), "utf8");
const body = html.split("\n<script>\n").pop().split("\n</script>")[0];

let ok = 0, fail = 0;
const check = (cond, msg) => { if (cond) { ok++; } else { fail++; console.error("  ✗ " + msg); } };

const sandbox = {
  React: { createElement: () => ({}), useState: (v) => [typeof v === "function" ? v() : v, () => {}], useMemo: (f) => f(), useCallback: (f) => f, useEffect: () => {}, useRef: (v) => ({ current: v }) },
  ReactDOM: { createRoot: () => ({ render() {} }) },
  document: { getElementById: () => ({}) },
  window: undefined,
  localStorage: { getItem: () => null, setItem: () => {} },
  Math, console, JSON, Set, Array, Object, Number,
};
vm.createContext(sandbox);
vm.runInContext(body, sandbox);
const api = vm.runInContext(
  "({ score5H, score7, equityVs, makeTable, startHand, legalActions, applyAction, botDecide, settleShowdown, mulberry32, cardId, SMALL_BLIND, BIG_BLIND, START_STACK })",
  sandbox,
);
const { score5H, score7, equityVs, makeTable, startHand, legalActions, applyAction, botDecide, settleShowdown, mulberry32, cardId, SMALL_BLIND, BIG_BLIND, START_STACK } = api;

const c = (r, s) => ({ r, s });
/* The pot value is kept for display after settlement, so conservation counts it
 * only while the hand is live (before awards land in stacks). */
const totalChips = (st) => st.players.reduce((a, p) => a + p.stack, 0) + (st.phase === "over" ? 0 : st.pot);

/* ---- evaluator tiebreaks ---- */
{
  const straightFlush = score5H([c(9, 0), c(10, 0), c(11, 0), c(12, 0), c(13, 0)]);
  const quads = score5H([c(1, 0), c(1, 1), c(1, 2), c(1, 3), c(13, 0)]);
  check(straightFlush > quads, "straight flush beats quad aces");
  check(score5H([c(1, 0), c(2, 1), c(3, 2), c(4, 3), c(5, 0)]) < score5H([c(2, 0), c(3, 1), c(4, 2), c(5, 3), c(6, 0)]), "wheel loses to six-high straight");
  check(score5H([c(1, 0), c(1, 1), c(13, 2), c(7, 3), c(2, 0)]) > score5H([c(1, 2), c(1, 3), c(12, 0), c(7, 1), c(2, 1)]), "AA-K kicker beats AA-Q kicker");
  check(score5H([c(3, 0), c(3, 1), c(3, 2), c(2, 3), c(2, 0)]) > score5H([c(2, 1), c(2, 2), c(2, 3), c(1, 0), c(1, 1)]), "threes full of twos beats twos full of aces");
  check(score5H([c(5, 0), c(9, 0), c(11, 0), c(2, 0), c(13, 0)]) > score5H([c(1, 1), c(1, 2), c(13, 3), c(12, 1), c(9, 2)]), "flush beats aces up... (pair)");
  check(score5H([c(8, 0), c(8, 1), c(4, 2), c(4, 3), c(13, 0)]) === score5H([c(8, 2), c(8, 3), c(4, 0), c(4, 1), c(13, 1)]), "identical two-pair hands tie exactly");
  // 7-card: pair of kings + board straight -> the straight plays
  const s7 = score7([c(13, 0), c(13, 1), c(9, 2), c(10, 3), c(11, 0), c(12, 1), c(4, 2)]);
  check(Math.floor(s7 / 16 ** 5) === 4, "score7 finds the board straight over the pair");
}

/* ---- dealing: deck integrity, blinds, conservation ---- */
{
  const rng = mulberry32(42);
  const st = startHand(makeTable(0), rng);
  const seen = [...st.deck, ...st.players.flatMap((p) => p.hole)].map(cardId);
  check(seen.length === 52 && new Set(seen).size === 52, "one full deck: holes + remaining deck are 52 unique cards");
  check(st.players.every((p) => p.hole.length === 2), "every seat dealt exactly two hole cards");
  const sb = st.players[(st.btn + 1) % 4], bb = st.players[(st.btn + 2) % 4];
  check(sb.committed === SMALL_BLIND && bb.committed === BIG_BLIND, "blinds posted");
  check(st.pot === SMALL_BLIND + BIG_BLIND, "pot equals the blinds");
  check(totalChips(st) === 4 * START_STACK, "chips conserved after the deal");
  check(st.toAct === (st.btn + 3) % 4, "pre-flop action starts under the gun");
}

/* ---- betting: calls around advance streets; conservation throughout ---- */
{
  const rng = mulberry32(7);
  let st = startHand(makeTable(0), rng);
  const start = totalChips(st);
  let guard = 0;
  while (st.phase === "betting" && guard++ < 64) {
    st = applyAction(st, { type: "call" });
    check(totalChips(st) === start, `chips conserved after action ${guard}`);
  }
  check(st.phase === "over", "calling every decision reaches a showdown");
  check(st.board.length === 5, "full board of five dealt through flop/turn/river");
  check(st.revealed === true, "showdown reveals the hands");
  check(st.pot === 4 * BIG_BLIND, "four players called the big blind: pot is 4 BB");
}

/* ---- min-raise legality ---- */
{
  const rng = mulberry32(9);
  let st = startHand(makeTable(0), rng);
  const la = legalActions(st);
  check(la.minRaiseTo === 2 * BIG_BLIND, "first pre-flop raise must be to at least 2 BB");
  const st2 = applyAction(st, { type: "raise", to: BIG_BLIND + 1 }); // illegal size -> clamped up
  check(st2.currentBet >= 2 * BIG_BLIND, `undersized raise is clamped to the legal minimum (got ${st2.currentBet})`);
  const st3 = applyAction(st, { type: "raise", to: 10 * START_STACK }); // oversized -> clamped to all-in
  const raiser = st3.players[st.toAct];
  check(raiser.allIn && raiser.stack === 0 && st3.currentBet <= START_STACK, "oversized raise becomes an all-in, not chip creation");
  check(totalChips(st3) === 4 * START_STACK, "chips conserved through the all-in");
}

/* ---- fold-out: uncontested pot, no reveal ---- */
{
  const rng = mulberry32(11);
  let st = startHand(makeTable(0), rng);
  let guard = 0;
  while (st.phase === "betting" && guard++ < 8) st = applyAction(st, { type: "fold" });
  check(st.phase === "over" && st.revealed === false, "everyone folding ships the pot without a reveal");
  check(st.winners.length === 1, "exactly one uncontested winner");
  check(totalChips(st) === 4 * START_STACK, "chips conserved after the fold-out");
  check(st.players[st.winners[0]].stack > START_STACK - BIG_BLIND, "the winner banked the blinds");
}

/* ---- rigged showdown + layered side pots ---- */
{
  // Hand-built state: board K♠ K♥ 7♦ 2♣ 3♠.
  //   seat0: A♠ A♦ (aces up: AAKK7) committed 1000  (short stack, all-in)
  //   seat1: K♦ Q♠ (trip kings)     committed 3000
  //   seat2: 7♣ 7♥ (sevens full)    committed 3000
  //   seat3: folded                 committed 500
  // Levels: 500 (×4 = 2000), 1000 (×3 -> +1500), 3000 (×2 -> +4000). Pot 7500.
  //   Layers 2000+1500 = 3500 -> best of seats 0,1,2 at that level... seat2's boat
  //   wins everything it's eligible for; seat0 only contests up to 1000.
  //   Main (level ≤1000): eligible 0,1,2 -> seat2 boat wins 3500.
  //   Side (1000→3000): eligible 1,2 -> seat2 wins 4000. Seat2 total 7500.
  const st = {
    handNo: 1, btn: 3, phase: "betting", street: 3,
    board: [c(13, 0), c(13, 1), c(7, 2), c(2, 3), c(3, 0)],
    deck: [], pot: 7500, currentBet: 0, minRaise: 50, toAct: -1, needs: [],
    message: "", quip: null, winners: [], revealed: false,
    players: [
      { name: "You", isUser: true, tight: 0, aggr: 0, stack: 0, hole: [c(1, 0), c(1, 2)], folded: false, allIn: true, streetBet: 0, committed: 1000, lastAct: "" },
      { name: "B", isUser: false, tight: 0, aggr: 0, stack: 2000, hole: [c(13, 2), c(12, 0)], folded: false, allIn: false, streetBet: 0, committed: 3000, lastAct: "" },
      { name: "C", isUser: false, tight: 0, aggr: 0, stack: 2000, hole: [c(7, 3), c(7, 1)], folded: false, allIn: false, streetBet: 0, committed: 3000, lastAct: "" },
      { name: "D", isUser: false, tight: 0, aggr: 0, stack: 4500, hole: [c(9, 0), c(4, 1)], folded: true, allIn: false, streetBet: 0, committed: 500, lastAct: "folds" },
    ],
  };
  const before = totalChips(st);
  const out = settleShowdown(JSON.parse(JSON.stringify(st)));
  check(out.players[2].stack === 2000 + 7500, `sevens full sweeps both pots (got ${out.players[2].stack})`);
  check(out.players[0].stack === 0 && out.players[1].stack === 2000, "aces and trip kings win nothing over the boat");
  check(out.players.reduce((a, p) => a + p.stack, 0) === before, "settle conserves chips");
  check(out.winners.includes(2) && out.revealed, "winner list and reveal set");

  // Swap the boat onto the SHORT stack: seat0 gets 7♣7♥ (sevens full), seat2
  // gets A♠A♦ (aces up). Seat0's boat wins only the layers it covered — the
  // main pot, 2000+1500 = 3500 — while the 1000→3000 side pot (4000) is
  // contested by seats 1 and 2 only: trip kings beat aces up, so seat1 takes it.
  const st2 = JSON.parse(JSON.stringify(st));
  st2.players[0].hole = [c(7, 3), c(7, 1)];
  st2.players[2].hole = [c(1, 0), c(1, 2)];
  const out2 = settleShowdown(st2);
  check(out2.players[0].stack === 3500, `short stack's boat wins only the main pot it covered (got ${out2.players[0].stack})`);
  check(out2.players[1].stack === 2000 + 4000, `side pot goes to the best eligible hand, trip kings (got ${out2.players[1].stack})`);
  check(out2.players[2].stack === 2000, "aces up win neither pot");
}

/* ---- equity sanity: aces are still aces ---- */
{
  const rng = mulberry32(1234);
  const eq = equityVs([c(1, 0), c(1, 1)], [], 1, 600, rng);
  check(eq > 0.78 && eq < 0.92, `AA vs one random hand ≈ 85% (simulated ${Math.round(eq * 100)}%)`);
  const eq72 = equityVs([c(7, 0), c(2, 1)], [], 3, 400, rng);
  check(eq72 < 0.35, `7-2 offsuit vs three hands is weak (simulated ${Math.round(eq72 * 100)}%)`);
}

/* ---- bots only take legal actions ---- */
{
  for (let seed = 1; seed <= 6; seed++) {
    const rng = mulberry32(seed * 101);
    let st = startHand(makeTable(0), rng);
    let guard = 0, legal = true;
    while (st.phase === "betting" && guard++ < 80) {
      const a = botDecide(st, rng);
      const la = legalActions(st);
      if (a.type === "raise" && !la.canRaise) legal = false;
      if (a.type === "fold" && la.canCheck) legal = false; // never fold when checking is free
      st = applyAction(st, a);
      if (totalChips(st) !== 4 * START_STACK) legal = false; // totalChips ignores the display pot once settled
    }
    check(legal && st.phase === "over", `seeded game ${seed}: bots legal, chips conserved, hand completes`);
  }
}

console.log(fail === 0 ? `✓ verify_table: all ${ok} checks passed` : `✗ verify_table: ${fail} of ${ok + fail} checks FAILED`);
process.exit(fail === 0 ? 0 : 1);
