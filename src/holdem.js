/* Shared hold'em core — evaluator, equity, and the server-authoritative game
 * rules (deal, blinds, streets, side pots, showdown, runout, bot policy).
 * ONE implementation for two runtimes:
 *   - build.sh PREPENDS this file into the pages (after engine.js), so the
 *     solo table plays it locally;
 *   - rooms.mjs vm-loads THIS SAME FILE (with engine.js) on the server, so
 *     multiplayer rooms are governed by identical rules — no second copy,
 *     per the copy-it doctrine.
 * Plain top-level functions, no imports/exports (both loaders require it).
 * Depends on engine.js (fullDeck, cardId, mulberry32).
 */

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

const HHRANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const HHSUITS = ["\u2660", "\u2665", "\u2666", "\u2663"];
const cardTxt = (c) => HHRANKS[c.r] + HHSUITS[c.s];
/* The hand log: every action and street, so the table reads like a broadcast.
 * Lives in the shared state — solo and multiplayer render the same feed. */
function pushLog(s, line) {
  if (!s.log) s.log = []; // states built by tests/tools may predate the log
  s.log.push(line);
  if (s.log.length > 80) s.log.shift();
}

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
    log: [],
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
  if (!s.log) s.log = [];
  pushLog(s, `\u2014 Hand #${s.handNo} \u2014 ${s.players[s.btn].name} has the button`);
  post((s.btn + 1) % 4, SMALL_BLIND, `small blind $${SMALL_BLIND}`);
  post((s.btn + 2) % 4, BIG_BLIND, `big blind $${BIG_BLIND}`);
  pushLog(s, `${s.players[(s.btn + 1) % 4].name} posts small blind $${SMALL_BLIND}`);
  pushLog(s, `${s.players[(s.btn + 2) % 4].name} posts big blind $${BIG_BLIND}`);
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
    const streetName = ["", "Flop", "Turn", "River"][s.street];
    const cards = s.street === 1 ? s.board.slice(0, 3) : s.board.slice(-1);
    pushLog(s, `\u2014 ${streetName}: ${cards.map(cardTxt).join(" ")} (pot $${s.pot.toLocaleString()})`);
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
  const rStreet = ["", "Flop", "Turn", "River"][s.street];
  const rCards = s.street === 1 ? s.board.slice(0, 3) : s.board.slice(-1);
  pushLog(s, `\u2014 ${rStreet}: ${rCards.map(cardTxt).join(" ")}`);
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
    pushLog(s, `${p.name} folds`);
  } else if (action.type === "call") {
    const pay = la.toCall;
    p.stack -= pay; p.streetBet += pay; p.committed += pay; s.pot += pay;
    if (p.stack === 0 && pay > 0) p.allIn = true;
    p.lastAct = pay === 0 ? "checks" : `calls $${pay.toLocaleString()}`;
    pushLog(s, `${p.name} ${p.lastAct}`);
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
    pushLog(s, `${p.name} ${p.lastAct}`);
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
    pushLog(s, s.message);
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

