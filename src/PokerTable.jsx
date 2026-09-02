import React, { useState, useEffect, useRef } from "react";

/* ============================================================
   HOLD'EM TABLE (table.html) — a real four-max no-limit game.
   Every hand deals from a freshly shuffled 52-card deck: blinds,
   hole cards, four betting streets, all-ins with proper layered
   side pots, and a genuine best-5-of-7 showdown. The three bot
   seats decide by MONTE CARLO EQUITY SIMULATION (rollouts of the
   unseen deck) weighed against pot odds — simulation, never
   strategy charts, per the project philosophy. The featured
   opponent, "Ace Meridian", is a FICTIONAL world #1 — an original
   character, deliberately not modeled on or named after any real
   player. Practice chips only — nothing real is wagered.
   The game core below is pure functions over plain state, so
   engine/verify_table.js can eval this compiled page and re-prove
   deck integrity, chip conservation, betting legality, side-pot
   math, and evaluator tiebreaks.
   ============================================================ */

/* ==================== 7-CARD SHOWDOWN EVALUATION ====================
 * score5H packs a 5-card hand into one comparable integer:
 *   category * 16^5 + t1*16^4 + t2*16^3 + t3*16^2 + t4*16 + t5
 * where t1..t5 are the category's tiebreak ranks (ace high = 14,
 * except as the wheel's low end). Bigger number = better hand.
 * score7 takes the best of the 21 five-card choices. */

const HOLDEM_CATS = ["High Card", "Pair", "Two Pair", "Three of a Kind", "Straight", "Flush", "Full House", "Four of a Kind", "Straight Flush"];
const hiRank = (r) => (r === 1 ? 14 : r);
const P16 = [1, 16, 256, 4096, 65536, 1048576]; // 16^0..16^5

function packScore(cat, t) {
  let s = cat * P16[5];
  for (let i = 0; i < 5; i++) s += (t[i] || 0) * P16[4 - i];
  return s;
}

function score5H(cards) {
  const rs = cards.map((c) => hiRank(c.r)).sort((a, b) => b - a);
  const flush = cards.every((c) => c.s === cards[0].s);
  const counts = {};
  for (const r of rs) counts[r] = (counts[r] || 0) + 1;
  // groups: [count, rank] by count desc, then rank desc
  const groups = Object.keys(counts)
    .map((r) => [counts[r], Number(r)])
    .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const uniq = groups.map((g) => g[1]).sort((a, b) => b - a);
  let straightTop = 0;
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightTop = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightTop = 5; // the wheel
  }
  if (flush && straightTop) return packScore(8, [straightTop]);
  if (groups[0][0] === 4) return packScore(7, [groups[0][1], groups[1][1]]);
  if (groups[0][0] === 3 && groups[1][0] === 2) return packScore(6, [groups[0][1], groups[1][1]]);
  if (flush) return packScore(5, rs);
  if (straightTop) return packScore(4, [straightTop]);
  if (groups[0][0] === 3) return packScore(3, [groups[0][1], groups[1][1], groups[2][1]]);
  if (groups[0][0] === 2 && groups[1][0] === 2) return packScore(2, [groups[0][1], groups[1][1], groups[2][1]]);
  if (groups[0][0] === 2) return packScore(1, [groups[0][1], groups[1][1], groups[2][1], groups[3][1]]);
  return packScore(0, rs);
}

function score7(cards) {
  // best of the 21 five-card subsets (drop two of seven)
  let best = 0;
  const pick = new Array(5);
  for (let a = 0; a < 6; a++)
    for (let b = a + 1; b < 7; b++) {
      let k = 0;
      for (let i = 0; i < 7; i++) if (i !== a && i !== b) pick[k++] = cards[i];
      const s = score5H(pick);
      if (s > best) best = s;
    }
  return best;
}

const scoreCatName = (s) => HOLDEM_CATS[Math.floor(s / P16[5])];

/* ==================== MONTE CARLO EQUITY ====================
 * Rollouts of the unseen deck: deal each opponent a random hole,
 * complete the board, count wins (ties count fractionally). This
 * is the bots' only source of hand strength. */
function equityVs(hole, board, nOpps, trials, rng) {
  const seen = new Set([...hole, ...board].map(cardId));
  const pool = fullDeck().filter((c) => !seen.has(cardId(c)));
  let won = 0;
  const deckBuf = pool.slice();
  for (let t = 0; t < trials; t++) {
    // partial Fisher–Yates: we only need nOpps*2 + boardNeed cards
    const need = nOpps * 2 + (5 - board.length);
    for (let i = 0; i < need; i++) {
      const j = i + ((rng() * (deckBuf.length - i)) | 0);
      [deckBuf[i], deckBuf[j]] = [deckBuf[j], deckBuf[i]];
    }
    let d = 0;
    const fullBoard = board.slice();
    const oppHoles = [];
    for (let o = 0; o < nOpps; o++) oppHoles.push([deckBuf[d++], deckBuf[d++]]);
    while (fullBoard.length < 5) fullBoard.push(deckBuf[d++]);
    const mine = score7([...hole, ...fullBoard]);
    let beat = true, ties = 0;
    for (const oh of oppHoles) {
      const os = score7([...oh, ...fullBoard]);
      if (os > mine) { beat = false; break; }
      if (os === mine) ties++;
    }
    if (beat) won += ties ? 1 / (ties + 1) : 1;
  }
  return won / trials;
}

/* Broadcast equity: per-player win % when every live hole is known. EXACT
 * enumeration when one or two board cards remain (the project's
 * enumeration-first rule); Monte Carlo only preflop/on the flop. Ties count
 * fractionally. Returns win probabilities in `holes` order. */
function equityMulti(holes, board, rng) {
  const seen = new Set([...holes.flat(), ...board].map(cardId));
  const pool = fullDeck().filter((c) => !seen.has(cardId(c)));
  const need = 5 - board.length;
  const wins = new Array(holes.length).fill(0);
  let total = 0;
  const scoreOut = (fullBoard) => {
    const scores = holes.map((h) => score7([...h, ...fullBoard]));
    const best = Math.max(...scores);
    const winners = scores.reduce((n, s) => n + (s === best ? 1 : 0), 0);
    for (let i = 0; i < scores.length; i++) if (scores[i] === best) wins[i] += 1 / winners;
    total++;
  };
  if (need === 0) scoreOut(board);
  else if (need <= 2) {
    for (let i = 0; i < pool.length; i++) {
      if (need === 1) scoreOut([...board, pool[i]]);
      else for (let j = i + 1; j < pool.length; j++) scoreOut([...board, pool[i], pool[j]]);
    }
  } else {
    const buf = pool.slice();
    for (let t = 0; t < 400; t++) {
      for (let i = 0; i < need; i++) {
        const j = i + ((rng() * (buf.length - i)) | 0);
        [buf[i], buf[j]] = [buf[j], buf[i]];
      }
      scoreOut([...board, ...buf.slice(0, need)]);
    }
  }
  return wins.map((w) => w / total);
}

/* ==================== TABLE CORE (pure functions) ==================== */

const SMALL_BLIND = 25;
const BIG_BLIND = 50;
const START_STACK = 5000;
const USER_SEAT = 0;

/* Fictional characters by design — no real player's name, image, or persona. */
const PERSONAS = [
  { name: "You", tag: "", tight: 0, aggr: 0, quips: [] },
  {
    name: "Ace Meridian", tag: "WORLD #1", tight: 0.06, aggr: 0.75,
    quips: [
      "Your bet tells a story. It's fiction.",
      "Pressure is free. I give it away all night.",
      "I've folded better hands than the one you're proud of.",
      "The pot was mine before the flop. You're just finding out.",
      "Chips flow toward patience.",
      "I don't need cards. I need you to blink.",
    ],
  },
  {
    name: "Nova Tran", tag: "loose cannon", tight: -0.08, aggr: 0.9,
    quips: ["Any two, baby.", "Math is for banks.", "Raise now, count later."],
  },
  {
    name: "Granite Ford", tag: "the rock", tight: 0.12, aggr: 0.2,
    quips: ["Hm.", "I'll wait.", "Patience pays the rent."],
  },
];

function shuffledFrom(rng) {
  const d = fullDeck();
  for (let i = d.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function makeTable(userStack) {
  return {
    handNo: 0,
    btn: 3, // first startHand advances to 0
    phase: "idle", // idle | betting | over
    street: 0, board: [], deck: [],
    pot: 0, currentBet: 0, minRaise: BIG_BLIND,
    toAct: -1, needs: [],
    message: "", quip: null, winners: [], revealed: false,
    players: PERSONAS.map((p, i) => ({
      name: p.name, tag: p.tag, isUser: i === USER_SEAT,
      tight: p.tight, aggr: p.aggr,
      stack: i === USER_SEAT && userStack > 0 ? userStack : START_STACK,
      hole: [], folded: true, allIn: false,
      streetBet: 0, committed: 0, lastAct: "",
    })),
  };
}

const seatsFrom = (start, pred, players) => {
  const out = [];
  for (let k = 0; k < players.length; k++) {
    const i = (start + k) % players.length;
    if (pred(players[i], i)) out.push(i);
  }
  return out;
};
const inHand = (p) => !p.folded;
const canStillAct = (p) => !p.folded && !p.allIn;

function startHand(state, rng) {
  const s = JSON.parse(JSON.stringify(state)); // state is plain JSON; oldest WebViews lack structuredClone
  s.handNo += 1;
  s.btn = (s.btn + 1) % 4;
  s.deck = shuffledFrom(rng);
  s.board = []; s.street = 0; s.pot = 0;
  s.currentBet = 0; s.minRaise = BIG_BLIND;
  s.message = ""; s.quip = null; s.winners = []; s.revealed = false;
  s.phase = "betting";
  for (const p of s.players) {
    if (p.stack < BIG_BLIND) { p.stack = START_STACK; p.rebuyNote = true; } else p.rebuyNote = false;
    p.hole = []; p.folded = false; p.allIn = false;
    p.streetBet = 0; p.committed = 0; p.lastAct = "";
  }
  // two cards each, dealt from the top of the one shuffled deck
  for (let round = 0; round < 2; round++)
    for (let k = 1; k <= 4; k++) s.players[(s.btn + k) % 4].hole.push(s.deck.pop());
  // blinds
  const post = (seat, amt, label) => {
    const p = s.players[seat];
    const pay = Math.min(amt, p.stack);
    p.stack -= pay; p.streetBet += pay; p.committed += pay; s.pot += pay;
    if (p.stack === 0) p.allIn = true;
    p.lastAct = label;
  };
  post((s.btn + 1) % 4, SMALL_BLIND, `small blind $${SMALL_BLIND}`);
  post((s.btn + 2) % 4, BIG_BLIND, `big blind $${BIG_BLIND}`);
  s.currentBet = BIG_BLIND;
  // preflop action starts under the gun; the big blind acts last (option kept)
  s.needs = seatsFrom((s.btn + 3) % 4, canStillAct, s.players);
  s.toAct = s.needs.length ? s.needs[0] : -1;
  return s;
}

function legalActions(state) {
  const p = state.players[state.toAct];
  const toCall = Math.min(state.currentBet - p.streetBet, p.stack);
  const maxTo = p.streetBet + p.stack; // all-in "raise to"
  const minTo = Math.min(state.currentBet + state.minRaise, maxTo);
  return {
    toCall,
    canCheck: toCall === 0,
    canRaise: maxTo > state.currentBet,
    minRaiseTo: minTo,
    maxRaiseTo: maxTo,
  };
}

/* Layered side pots from per-player committed totals. Each layer pays the best
 * unfolded hand among players committed at that level (split on exact ties,
 * odd chip to the earliest winner left of the button). */
function settleShowdown(s) {
  const levels = [...new Set(s.players.filter((p) => p.committed > 0).map((p) => p.committed))].sort((a, b) => a - b);
  const scores = s.players.map((p) => (inHand(p) ? score7([...p.hole, ...s.board]) : -1));
  const awards = new Array(4).fill(0);
  let prev = 0;
  for (const level of levels) {
    const contributors = s.players.filter((p) => p.committed >= level).length;
    const layer = (level - prev) * contributors;
    prev = level;
    const eligible = s.players.map((p, i) => i).filter((i) => inHand(s.players[i]) && s.players[i].committed >= level);
    const best = Math.max(...eligible.map((i) => scores[i]));
    const winners = seatsFrom((s.btn + 1) % 4, (_, i) => eligible.includes(i) && scores[i] === best, s.players);
    const share = Math.floor(layer / winners.length);
    let rem = layer - share * winners.length;
    for (const w of winners) { awards[w] += share + (rem > 0 ? 1 : 0); rem = Math.max(0, rem - 1); }
  }
  for (let i = 0; i < 4; i++) s.players[i].stack += awards[i];
  const overallBest = Math.max(...scores);
  s.winners = s.players.map((_, i) => i).filter((i) => scores[i] === overallBest && awards[i] > 0);
  s.revealed = true;
  s.phase = "over";
  const names = s.winners.map((i) => s.players[i].name).join(" & ");
  const plural = s.winners.length > 1 || s.winners.includes(USER_SEAT);
  s.message = `${names} win${plural ? "" : "s"} with ${scoreCatName(overallBest)} · pot $${s.pot.toLocaleString()}`;
  s.toAct = -1; s.needs = [];
  return s;
}

function endStreetOrShowdown(s) {
  for (const p of s.players) p.streetBet = 0;
  s.currentBet = 0; s.minRaise = BIG_BLIND;
  const live = s.players.filter(inHand);
  const actors = s.players.filter(canStillAct);
  const dealNext = () => {
    s.street += 1;
    s.board.push(s.deck.pop());
    if (s.street === 1) { s.board.push(s.deck.pop()); s.board.push(s.deck.pop()); } // flop is three
  };
  if (actors.length < 2) {
    // Everyone left is all-in (or only one can act): the broadcast moment.
    // Hands flip up and the view steps the board out street by street with
    // live win percentages (runoutStep below); nothing settles until the river.
    if (s.street >= 3) return settleShowdown(s);
    s.phase = "runout";
    s.revealed = true;
    s.toAct = -1; s.needs = [];
    s.message = "ALL IN — running it out";
    return s;
  }
  if (s.street === 3) return settleShowdown(s);
  dealNext();
  s.needs = seatsFrom((s.btn + 1) % 4, canStillAct, s.players);
  s.toAct = s.needs[0];
  if (live.length < 2) return settleShowdown(s); // defensive; folds are handled in applyAction
  return s;
}

/* One broadcast tick: deal the next street; after the river, settle. Pure. */
function runoutStep(state) {
  const s = JSON.parse(JSON.stringify(state));
  if (s.phase !== "runout") return s;
  if (s.street >= 3) return settleShowdown(s);
  s.street += 1;
  s.board.push(s.deck.pop());
  if (s.street === 1) { s.board.push(s.deck.pop()); s.board.push(s.deck.pop()); }
  return s;
}

/* action: {type:'fold'} | {type:'call'} | {type:'raise', to} (+optional quipIndex) */
function applyAction(state, action) {
  const s = JSON.parse(JSON.stringify(state)); // state is plain JSON; oldest WebViews lack structuredClone
  if (s.phase !== "betting" || s.toAct < 0) return s;
  const seat = s.toAct;
  const p = s.players[seat];
  const la = legalActions(s);
  s.quip = null;
  if (action.type === "fold") {
    p.folded = true;
    p.lastAct = "folds";
  } else if (action.type === "call") {
    const pay = la.toCall;
    p.stack -= pay; p.streetBet += pay; p.committed += pay; s.pot += pay;
    if (p.stack === 0 && pay > 0) p.allIn = true;
    p.lastAct = pay === 0 ? "checks" : `calls $${pay.toLocaleString()}`;
  } else if (action.type === "raise") {
    let to = Math.round(action.to);
    if (!la.canRaise) return s;
    to = Math.max(la.minRaiseTo, Math.min(to, la.maxRaiseTo));
    const pay = to - p.streetBet;
    p.stack -= pay; p.streetBet = to; p.committed += pay; s.pot += pay;
    if (p.stack === 0) p.allIn = true;
    s.minRaise = Math.max(s.minRaise, to - s.currentBet);
    const wasBet = s.currentBet === 0;
    s.currentBet = to;
    p.lastAct = `${p.allIn ? "all-in" : wasBet ? "bets" : "raises to"} $${to.toLocaleString()}`;
    s.needs = seatsFrom((seat + 1) % 4, (q, i) => i !== seat && canStillAct(q) && q.streetBet < to, s.players);
    if (typeof action.quipIndex === "number" && PERSONAS[seat].quips.length)
      s.quip = { seat, text: PERSONAS[seat].quips[action.quipIndex % PERSONAS[seat].quips.length] };
    s.toAct = s.needs.length ? s.needs[0] : -1;
    if (!s.needs.length) return endStreetOrShowdown(s);
    return s;
  }
  s.needs = s.needs.filter((i) => i !== seat);
  const live = s.players.filter(inHand);
  if (live.length === 1) {
    // everyone else folded: pot ships without a showdown, cards stay hidden
    const w = s.players.findIndex(inHand);
    s.players[w].stack += s.pot;
    s.winners = [w]; s.revealed = false; s.phase = "over";
    s.message = `${s.players[w].name} takes $${s.pot.toLocaleString()} uncontested`;
    s.toAct = -1; s.needs = [];
    return s;
  }
  if (!s.needs.length) return endStreetOrShowdown(s);
  s.toAct = s.needs[0];
  return s;
}

/* Bot policy: Monte Carlo equity vs pot odds, shaded by persona. Simulation is
 * the only card knowledge; tight shifts the calling bar, aggr sets bet frequency
 * and sizing. Returns an action for state.toAct. */
function botDecide(state, rng) {
  const seat = state.toAct;
  const p = state.players[seat];
  const la = legalActions(state);
  const opps = state.players.filter((q, i) => i !== seat && inHand(q)).length;
  const trials = 140 + state.street * 40;
  const eq = equityVs(p.hole, state.board, opps, trials, rng);
  const potAfterCall = state.pot + la.toCall;
  const potOdds = la.toCall > 0 ? la.toCall / potAfterCall : 0;
  const raiseTo = () => {
    const size = Math.round((state.pot * (0.55 + p.aggr * 0.6 * rng())) / 25) * 25;
    return Math.max(la.minRaiseTo, Math.min(p.streetBet + la.toCall + size, la.maxRaiseTo));
  };
  const quip = () => (rng() < (seat === 1 ? 0.45 : 0.2) ? { quipIndex: (rng() * 6) | 0 } : {});
  if (la.canCheck) {
    if (la.canRaise && (eq > 0.5 + p.tight + (1 - p.aggr) * 0.15 || rng() < p.aggr * 0.12))
      return { type: "raise", to: raiseTo(), ...quip() };
    return { type: "call" }; // check
  }
  if (eq < potOdds + p.tight * 0.6 && !(rng() < p.aggr * 0.05 && la.canRaise))
    return la.toCall >= p.stack && eq > 0.32 ? { type: "call" } : { type: "fold" };
  if (la.canRaise && eq > Math.max(0.62 + p.tight, potOdds * 2.2))
    return { type: "raise", to: raiseTo(), ...quip() };
  return { type: "call" };
}

const money = (v) => `$${v.toLocaleString()}`;

/* ==================== VIEW ==================== */

const N = {
  bg: "#0b0e11", panel: "#14171d", panelHi: "#1f2937", card: "#1a1d24",
  line: "#222630", line2: "#2c303c", felt: "#0f2018", feltHi: "#16301f", rail: "#1e2c24",
  green: "#00e676", red: "#ff4d4d", redSoft: "#ff5252", amber: "#ffb74d", gold: "#ffd54f",
  text: "#ffffff", dim: "#8b93a3", faint: "#5b6272",
};
const sans = "Inter, 'Albert Sans', system-ui, -apple-system, sans-serif";

const clampN = (lo, v, hi) => Math.max(lo, Math.min(v, hi));
function useViewportWidth() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 400);
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return w;
}

function TableCard({ card, w }) {
  const red = isRed(card.s);
  const col = red ? N.red : "#e8ebf2";
  return (
    <div style={{
      width: w, height: Math.round(w * 1.42), borderRadius: Math.max(8, w * 0.14),
      background: `linear-gradient(160deg, #21252e, ${N.card} 60%)`,
      border: `1px solid ${N.line2}`, boxShadow: "0 6px 14px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)",
      position: "relative", color: col, flex: "0 0 auto",
    }}>
      <div style={{ position: "absolute", top: w * 0.1, left: w * 0.14, lineHeight: 1, textAlign: "center" }}>
        <div style={{ fontSize: w * 0.34, fontWeight: 800, letterSpacing: "-0.02em" }}>{rankLabel(card.r)}</div>
        <div style={{ fontSize: w * 0.3, marginTop: w * 0.03 }}>{SUIT[card.s]}</div>
      </div>
      <div style={{ position: "absolute", right: w * 0.1, bottom: w * 0.04, fontSize: w * 0.62, opacity: 0.9, lineHeight: 1 }}>{SUIT[card.s]}</div>
    </div>
  );
}

function CardBack({ w }) {
  return (
    <div style={{
      width: w, height: Math.round(w * 1.42), borderRadius: Math.max(6, w * 0.14), flex: "0 0 auto",
      background: `repeating-linear-gradient(45deg, #123322, #123322 ${w * 0.09}px, ${N.rail} ${w * 0.09}px, ${N.rail} ${w * 0.18}px)`,
      border: "1px solid rgba(0,230,118,0.25)", boxShadow: "0 3px 8px rgba(0,0,0,0.5)",
    }} />
  );
}

function CardSlot({ w }) {
  return <div style={{ width: w, height: Math.round(w * 1.42), borderRadius: Math.max(8, w * 0.14), border: "1.5px dashed rgba(139,147,163,0.25)", flex: "0 0 auto" }} />;
}

function BetPill({ amount }) {
  if (!(amount > 0)) return null;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 5, marginTop: 5,
      background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,183,77,0.35)",
      borderRadius: 999, padding: "2.5px 9px", fontSize: 11, fontWeight: 700, color: N.amber, whiteSpace: "nowrap",
    }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", flex: "0 0 auto", background: `radial-gradient(circle at 35% 35%, #ffd54f, ${N.amber} 70%)`, boxShadow: "0 0 0 1.5px rgba(0,0,0,0.5) inset" }} />
      {money(amount)}
    </div>
  );
}

function EquityBadge({ pct, lead }) {
  return (
    <div style={{
      marginTop: 4, fontFamily: sans, fontSize: 13, fontWeight: 900, letterSpacing: "0.02em",
      borderRadius: 999, padding: "2px 11px",
      background: lead ? N.gold : "rgba(0,0,0,0.7)", color: lead ? "#14171d" : "#e8ebf2",
      border: `1px solid ${lead ? N.gold : N.line2}`,
      boxShadow: lead ? "0 0 14px rgba(255,213,79,0.5)" : "none", transition: "all 300ms ease",
    }}>
      {(pct * 100).toFixed(pct > 0 && pct < 0.005 ? 1 : 0)}%
    </div>
  );
}

function OppSeat({ player, seat, spot, state, cardW, equity, lead }) {
  const isTurn = state.toAct === seat && state.phase === "betting";
  const isWinner = state.winners.includes(seat);
  const showCards = state.revealed && !player.folded;
  const border = isWinner ? N.gold : isTurn ? N.green : N.line;
  return (
    <div style={{
      position: "absolute", left: `${spot.x}%`, top: `${spot.y}%`, transform: "translate(-50%, -50%)",
      display: "flex", flexDirection: "column", alignItems: "center",
      opacity: player.folded && state.phase === "betting" ? 0.45 : 1, zIndex: 3, width: "min(30vw, 132px)",
    }}>
      {state.quip && state.quip.seat === seat && (
        <div style={{
          position: "absolute", bottom: "100%", marginBottom: 6, width: "max-content", maxWidth: "62vw",
          background: "#e8ebf2", color: "#14171d", fontSize: 11.5, fontWeight: 600, lineHeight: 1.35,
          borderRadius: 10, padding: "6px 10px", zIndex: 8, boxShadow: "0 6px 16px rgba(0,0,0,0.5)",
        }}>
          “{state.quip.text}”
        </div>
      )}
      <div style={{
        width: 44, height: 44, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
        background: isTurn ? N.panelHi : "#111318", border: `2px solid ${border}`,
        boxShadow: isTurn ? "0 0 14px rgba(0,230,118,0.45)" : isWinner ? "0 0 14px rgba(255,213,79,0.45)" : "0 4px 10px rgba(0,0,0,0.5)",
        fontSize: 17, fontWeight: 800, color: isTurn ? N.green : isWinner ? N.gold : N.dim,
      }}>
        {player.name.charAt(0)}
      </div>
      <div style={{
        marginTop: 4, background: "rgba(13,16,20,0.92)", border: `1px solid ${isWinner ? "rgba(255,213,79,0.5)" : isTurn ? "rgba(0,230,118,0.45)" : N.line}`,
        borderRadius: 9, padding: "3px 8px", textAlign: "center", maxWidth: "100%", boxShadow: "0 4px 10px rgba(0,0,0,0.45)",
      }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: N.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "min(27vw, 118px)" }}>{player.name}</div>
        {player.tag && <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.12em", color: seat === 1 ? N.gold : N.dim }}>{player.tag.toUpperCase()}</div>}
        <div style={{ fontSize: 11, fontWeight: 700, color: N.green, whiteSpace: "nowrap" }}>{money(player.stack)}</div>
      </div>
      <div style={{ marginTop: 4, display: "flex", gap: 3, minHeight: Math.round(cardW * 1.42) * 0.62 }}>
        {state.handNo === 0 ? null : player.folded ? (
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", color: N.dim, alignSelf: "center" }}>FOLDED</span>
        ) : showCards ? (
          player.hole.map((c) => <TableCard key={cardId(c)} card={c} w={Math.round(cardW * 0.62)} />)
        ) : (
          <>
            <CardBack w={Math.round(cardW * 0.55)} />
            <CardBack w={Math.round(cardW * 0.55)} />
          </>
        )}
      </div>
      {equity != null && <EquityBadge pct={equity} lead={lead} />}
      {player.lastAct && <div style={{ marginTop: 3, fontSize: 9.5, fontWeight: 700, color: N.dim, whiteSpace: "nowrap" }}>{player.lastAct}</div>}
      <BetPill amount={player.streetBet} />
    </div>
  );
}

const STACK_KEY = "poker-trainer:tableStack";
function loadStack() {
  try {
    const raw = window.localStorage.getItem(STACK_KEY);
    if (raw == null) return START_STACK;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? v : START_STACK;
  } catch { return START_STACK; }
}

export default function PokerTable() {
  const [state, setState] = useState(() => makeTable(loadStack()));
  const [raiseTo, setRaiseTo] = useState(BIG_BLIND * 3);
  const rngRef = useRef(mulberry32((Math.random() * 2 ** 31) | 0));

  const you = state.players[USER_SEAT];
  const userTurn = state.phase === "betting" && state.toAct === USER_SEAT;
  const la = userTurn ? legalActions(state) : null;

  useEffect(() => {
    try { window.localStorage.setItem(STACK_KEY, String(you.stack)); } catch { /* private mode */ }
  }, [you.stack]);

  // Bots act on a human-feeling delay; the champion "thinks" a touch longer.
  useEffect(() => {
    if (state.phase !== "betting" || state.toAct < 0 || state.players[state.toAct].isUser) return;
    const wait = state.toAct === 1 ? 1000 : 650;
    const t = setTimeout(() => {
      setState((s) => {
        if (s.phase !== "betting" || s.toAct < 0 || s.players[s.toAct].isUser) return s;
        return applyAction(s, botDecide(s, rngRef.current));
      });
    }, wait);
    return () => clearTimeout(t);
  }, [state]);

  useEffect(() => {
    if (userTurn && la) setRaiseTo(clampN(la.minRaiseTo, state.pot, la.maxRaiseTo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userTurn]);

  // The broadcast: one street every ~1.4s while phase is "runout"; tap to skip.
  useEffect(() => {
    if (state.phase !== "runout") return;
    const t = setTimeout(() => setState((s) => (s.phase === "runout" ? runoutStep(s) : s)), 1400);
    return () => clearTimeout(t);
  }, [state]);
  const skipRunout = () => setState((s) => { let x = s, g = 0; while (x.phase === "runout" && g++ < 6) x = runoutStep(x); return x; });

  // Desktop keyboard: F fold · C/Space check-call · R raise · ↑↓ size the raise · Enter next hand.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== "range") return;
      const k = e.key.toLowerCase();
      if (state.phase === "betting" && state.toAct === USER_SEAT) {
        const l = legalActions(state);
        if (k === "f") { e.preventDefault(); userAct({ type: "fold" }); }
        else if (k === "c" || k === " ") { e.preventDefault(); userAct({ type: "call" }); }
        else if (k === "r" && l.canRaise) { e.preventDefault(); userAct({ type: "raise", to: clampN(l.minRaiseTo, raiseTo, l.maxRaiseTo) }); }
        else if (e.key === "ArrowUp" && l.canRaise) { e.preventDefault(); setRaiseTo((v) => clampN(l.minRaiseTo, v + BIG_BLIND * 2, l.maxRaiseTo)); }
        else if (e.key === "ArrowDown" && l.canRaise) { e.preventDefault(); setRaiseTo((v) => clampN(l.minRaiseTo, v - BIG_BLIND * 2, l.maxRaiseTo)); }
      } else if ((state.phase === "over" || state.phase === "idle") && (e.key === "Enter" || k === "n")) {
        e.preventDefault(); deal();
      } else if (state.phase === "runout" && (e.key === "Enter" || k === " ")) {
        e.preventDefault(); skipRunout();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Live win % for every seat still in the hand (only during the broadcast).
  const equities = React.useMemo(() => {
    if (state.phase !== "runout") return null;
    const liveSeats = state.players.map((_, i) => i).filter((i) => inHand(state.players[i]));
    const pcts = equityMulti(liveSeats.map((i) => state.players[i].hole), state.board, rngRef.current);
    const out = {};
    liveSeats.forEach((i, k) => { out[i] = pcts[k]; });
    return out;
  }, [state]);
  const leadSeat = equities ? Number(Object.keys(equities).reduce((a, b) => (equities[a] >= equities[b] ? a : b))) : -1;

  // Report the finished hand to the account layer, once per hand.
  const reportedHand = useRef(0);
  useEffect(() => {
    if (state.phase !== "over" || state.handNo === 0 || reportedHand.current === state.handNo) return;
    reportedHand.current = state.handNo;
    const won = state.winners.includes(USER_SEAT);
    reportStats({
      set: { table_stack: state.players[USER_SEAT].stack },
      inc: { table_hands: 1, table_wins: won ? 1 : 0 },
      maxOf: won ? { biggest_pot: state.pot } : {},
    });
  }, [state]);

  // Only from idle/over: dealing mid-runout would vaporize a live pot.
  const deal = () => setState((s) => (s.phase === "betting" || s.phase === "runout" ? s : startHand(s, rngRef.current)));
  const userAct = (action) => setState((s) => (s.phase === "betting" && s.toAct === USER_SEAT ? applyAction(s, action) : s));

  const OPP_SPOTS = [{ x: 14, y: 24 }, { x: 50, y: 9 }, { x: 86, y: 24 }];
  const vw = useViewportWidth();
  const boardW = clampN(38, Math.round(vw * 0.115), 54);
  const holeW = clampN(54, Math.round(vw * 0.16), 74);
  const streetNames = ["Pre-flop", "Flop", "Turn", "River"];

  const actBtn = (extra) => ({
    padding: "13px 8px", borderRadius: 12, fontFamily: sans, fontSize: 14, fontWeight: 800,
    letterSpacing: "0.04em", cursor: "pointer", border: "1px solid transparent", width: "100%", ...extra,
  });

  return (
    <div style={{
      background: `radial-gradient(130% 70% at 50% -10%, #10151b, ${N.bg} 60%)`,
      minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: sans, color: N.text, overflow: "hidden",
    }}>
      <style>{`
        html, body { background: ${N.bg}; }
        button:active { filter: brightness(1.15); transform: translateY(1px); }
        button:disabled { opacity: 0.4; cursor: default; }
        input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 6px;
          border-radius: 999px; background: linear-gradient(90deg, ${N.green} var(--fill, 0%), #2b2f3a var(--fill, 0%)); outline: none; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none;
          width: 24px; height: 24px; border-radius: 50%; border: none;
          background: radial-gradient(circle at 35% 35%, #7dffb8, ${N.green} 65%);
          box-shadow: 0 0 12px rgba(0,230,118,0.55), 0 2px 6px rgba(0,0,0,0.6); }
        input[type=range]::-moz-range-thumb { width: 24px; height: 24px; border-radius: 50%; border: none;
          background: ${N.green}; box-shadow: 0 0 12px rgba(0,230,118,0.55); }
        @keyframes cardIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
        .boardwrap > * { animation: cardIn 240ms ease both }
        .kbd { display: none }
        @media (min-width: 900px) {
          .kbd { display: inline-block; margin-left: 8px; padding: 0px 6px; border: 1px solid currentColor;
                 border-radius: 5px; font-size: 10px; opacity: 0.55; vertical-align: 1px }
        }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px 6px", flex: "0 0 auto" }}>
        <div>
          <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: "0.12em", color: N.dim }}>vs ACE MERIDIAN · WORLD #1</span>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", color: N.faint, marginLeft: 8 }}>PRACTICE CHIPS ONLY</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <AccountArea dark />
          <a href="index.html" aria-label="Home" style={{ color: N.dim, textDecoration: "none", fontSize: 16, lineHeight: 1, border: `1px solid ${N.line}`, borderRadius: 9, padding: "5px 9px", background: "rgba(255,255,255,0.02)" }}>⌂</a>
        </div>
      </div>

      <div style={{ flex: "1 1 auto", position: "relative", minHeight: 0, cursor: state.phase === "runout" ? "pointer" : "default" }}
        onClick={state.phase === "runout" ? skipRunout : undefined}>
       {/* Centered stage capped at desktop width: a laptop gets a real table
           instead of a smeared oval; on phones min() ≈ full width, unchanged. */}
       <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, transform: "translateX(-50%)", width: "min(100vw, 900px)" }}>
        <div style={{
          position: "absolute", inset: "5% 5% 3% 5%", borderRadius: "48% / 42%",
          background: `radial-gradient(75% 70% at 50% 32%, ${N.feltHi}, ${N.felt} 75%)`,
          border: `7px solid ${N.rail}`,
          boxShadow: "0 0 60px rgba(0,0,0,0.85), inset 0 0 46px rgba(0,0,0,0.55), inset 0 0 0 2px rgba(0,230,118,0.07)",
        }} />

        {[1, 2, 3].map((seat, i) => (
          <OppSeat key={seat} player={state.players[seat]} seat={seat} spot={OPP_SPOTS[i]} state={state} cardW={boardW}
            equity={equities ? equities[seat] : null} lead={leadSeat === seat} />
        ))}

        {/* center: street, pot, board */}
        <div style={{
          position: "absolute", left: "50%", top: "47%", transform: "translate(-50%, -50%)",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 9, zIndex: 2, width: "100%",
        }}>
          {state.handNo > 0 && (
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.16em", color: N.faint }}>
              HAND #{state.handNo} · {state.phase === "over" ? "COMPLETE" : streetNames[state.street].toUpperCase()}
            </div>
          )}
          <div style={{
            background: "rgba(0,0,0,0.6)", border: "1px solid rgba(0,230,118,0.3)", borderRadius: 999,
            padding: "4px 15px", fontSize: 13, fontWeight: 800, color: N.green, boxShadow: "0 0 18px rgba(0,230,118,0.12)",
          }}>
            POT&nbsp;&nbsp;{money(state.pot)}
          </div>
          <div className="boardwrap" style={{ display: "flex", gap: "clamp(4px, 1.5vw, 8px)", justifyContent: "center" }}>
            {state.board.map((c) => <TableCard key={cardId(c)} card={c} w={boardW} />)}
            {Array.from({ length: 5 - state.board.length }, (_, i) => <CardSlot key={`s${i}`} w={boardW} />)}
          </div>
          {state.message && (
            <div style={{
              marginTop: 2, background: "rgba(255,213,79,0.12)", border: "1px solid rgba(255,213,79,0.4)",
              borderRadius: 10, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, color: N.gold, textAlign: "center", maxWidth: "88%",
            }}>
              {state.message}
            </div>
          )}
        </div>

        {/* your seat */}
        <div style={{
          position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)",
          display: "flex", flexDirection: "column", alignItems: "center", zIndex: 4,
          opacity: you.folded && state.phase === "betting" ? 0.5 : 1,
        }}>
          {you.hole.length > 0 && !you.folded && (
            <div style={{ display: "flex", marginBottom: -10 }}>
              {you.hole.map((c, i) => (
                <div key={cardId(c)} style={{ transform: `rotate(${i === 0 ? -6 : 6}deg) translateY(${i === 0 ? 2 : 0}px)`, marginLeft: i === 0 ? 0 : -Math.round(holeW * 0.24), zIndex: i }}>
                  <TableCard card={c} w={holeW} />
                </div>
              ))}
            </div>
          )}
          <div style={{
            display: "flex", alignItems: "center", gap: 10, position: "relative", zIndex: 6,
            background: "rgba(13,16,20,0.97)",
            border: `2px solid ${state.winners.includes(USER_SEAT) ? N.gold : userTurn ? N.green : N.line}`,
            boxShadow: userTurn ? "0 0 18px rgba(0,230,118,0.4)" : state.winners.includes(USER_SEAT) ? "0 0 18px rgba(255,213,79,0.4)" : "0 6px 16px rgba(0,0,0,0.55)",
            borderRadius: 13, padding: "7px 14px",
          }}>
            {state.btn === USER_SEAT && state.handNo > 0 && (
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#e8ebf2", color: "#14171d", fontSize: 10, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>D</span>
            )}
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 800 }}>You{you.folded && state.phase === "betting" ? " · FOLDED" : ""}</div>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: N.green }}>{money(you.stack)}</div>
            </div>
            {you.lastAct && <span style={{ fontSize: 10, fontWeight: 700, color: N.dim }}>{you.lastAct}</span>}
            {equities && equities[USER_SEAT] != null && <EquityBadge pct={equities[USER_SEAT]} lead={leadSeat === USER_SEAT} />}
            <BetPill amount={you.streetBet} />
          </div>
        </div>
       </div>
      </div>

      {/* action panel — contents centered and capped so desktop gets buttons,
          not ribbons */}
      <div style={{
        flex: "0 0 auto", background: `linear-gradient(180deg, ${N.panel}, #101318)`,
        borderTop: `1px solid ${N.line}`, padding: "12px 16px calc(12px + env(safe-area-inset-bottom, 0px))",
        display: "flex", flexDirection: "column", gap: 11, alignItems: "center",
      }}>
       <div style={{ width: "100%", maxWidth: 620, display: "flex", flexDirection: "column", gap: 11 }}>
        {state.phase === "betting" ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12, opacity: userTurn && la && la.canRaise ? 1 : 0.35 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: N.dim, flex: "0 0 auto" }}>{la ? money(la.minRaiseTo) : ""}</span>
              <input type="range" aria-label="Raise to" disabled={!userTurn || !la || !la.canRaise}
                min={la ? la.minRaiseTo : 0} max={la ? la.maxRaiseTo : 100} step={25}
                value={la ? clampN(la.minRaiseTo, raiseTo, la.maxRaiseTo) : 0}
                style={{ "--fill": la && la.maxRaiseTo > la.minRaiseTo ? `${((clampN(la.minRaiseTo, raiseTo, la.maxRaiseTo) - la.minRaiseTo) / (la.maxRaiseTo - la.minRaiseTo)) * 100}%` : "100%", flex: 1 }}
                onChange={(e) => setRaiseTo(Number(e.target.value))}
              />
              <span style={{ fontSize: 10.5, fontWeight: 700, color: N.dim, flex: "0 0 auto" }}>{la ? money(la.maxRaiseTo) : ""}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 1.5fr", gap: 9 }}>
              <button disabled={!userTurn} onClick={() => userAct({ type: "fold" })}
                style={actBtn({ background: "#232733", color: N.redSoft, border: "1px solid rgba(255,82,82,0.25)" })}>FOLD<span className="kbd">F</span></button>
              <button disabled={!userTurn} onClick={() => userAct({ type: "call" })}
                style={actBtn({ background: "#232733", color: N.text, border: `1px solid ${N.line2}` })}>
                {userTurn && la ? (la.canCheck ? "CHECK" : `CALL ${money(la.toCall)}`) : "CHECK"}<span className="kbd">C</span>
              </button>
              <button disabled={!userTurn || !la || !la.canRaise} onClick={() => userAct({ type: "raise", to: raiseTo })}
                style={actBtn({ background: `linear-gradient(180deg, #2aff8f, ${N.green} 55%, #00b25a)`, color: "#00230f", boxShadow: "0 4px 16px rgba(0,230,118,0.35)" })}>
                {la && clampN(la.minRaiseTo, raiseTo, la.maxRaiseTo) >= la.maxRaiseTo ? "ALL-IN" : `RAISE TO ${la ? money(clampN(la.minRaiseTo, raiseTo, la.maxRaiseTo)) : ""}`}<span className="kbd">R</span>
              </button>
            </div>
            {!userTurn && (
              <div style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: N.dim }}>
                {state.toAct >= 0 ? `${state.players[state.toAct].name} is thinking…` : "…"}
              </div>
            )}
          </>
        ) : state.phase === "runout" ? (
          <div style={{ textAlign: "center", fontFamily: sans, fontSize: 13, fontWeight: 800, letterSpacing: "0.08em", color: N.gold, padding: "13px 0" }}>
            ALL IN — running it out… <span style={{ color: N.dim, fontWeight: 600, letterSpacing: 0 }}>(tap the table to skip)</span>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={deal}
              style={{ ...actBtn({ background: `linear-gradient(180deg, #2aff8f, ${N.green} 55%, #00b25a)`, color: "#00230f", boxShadow: "0 4px 16px rgba(0,230,118,0.35)" }), width: "auto", padding: "13px 42px" }}>
              {state.handNo === 0 ? "SIT DOWN & DEAL" : "NEXT HAND"}
            </button>
            {you.stack < BIG_BLIND && state.handNo > 0 && (
              <span style={{ fontSize: 11, color: N.dim, fontWeight: 700 }}>Felted — the next deal stakes you {money(START_STACK)} in practice chips.</span>
            )}
          </div>
        )}
       </div>
      </div>
    </div>
  );
}
