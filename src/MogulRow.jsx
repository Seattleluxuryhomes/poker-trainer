import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";

/* ============================================================
   MOGUL ROW (moguls.html) — a property-trading board game with
   the odds printed on every square. Forty spaces, two dice, a
   lockup, deeds, houses, rent, auctions, mortgages, trades and
   bankruptcy, against three fictional rivals.

   THE TEACHING HOOK: in a game like this the board is NOT
   uniform. The lockup pulls the token toward one corner, so the
   squares a short roll past it get landed on far more often than
   the ones just past PAYDAY. Everyone repeats that as folklore.
   Here it is COMPUTED: mrChain() builds the exact Markov chain
   over (square, consecutive doubles) plus the three lockup
   states, folds in the movement cards, and power-iterates to the
   stationary distribution. Every square wears its true landing
   frequency, and every deed prints expected rent per rival turn
   and payback time derived from it. No folklore, no "trust me".

   ORIGINAL WORK. The mechanics and the board topology are the
   unprotectable system — and they are what make the lessons
   transfer to any game of this family. Every piece of EXPRESSION
   is ours: the name, the street names, the card text, the rivals,
   the art, and our own price and rent tables (built from a stated
   formula, printed in the math note). Not affiliated with,
   endorsed by, or connected to any other game or publisher, and
   never to be described as one.

   No wager: practice money only, the casino wallet is not wired.
   Pure top-level functions (mrBoard … mrBotStep, mrCoach) so
   engine/verify_moguls.js can drive whole seeded games.
   ============================================================ */

/* ---- the groups ---- */
const MR_GROUPS = [
  { key: "outskirts", name: "The Outskirts",   color: "#9c7b5b", house: 50 },
  { key: "millworks", name: "Millworks",       color: "#6fc3e8", house: 50 },
  { key: "stockyards", name: "The Stockyards", color: "#e0629c", house: 100 },
  { key: "sunset",    name: "Sunset District", color: "#f08a3c", house: 100 },
  { key: "bankhouse", name: "Bankhouse Row",   color: "#e2453c", house: 150 },
  { key: "theatre",   name: "Theatre Quarter", color: "#f5d13c", house: 150 },
  { key: "highlands", name: "The Highlands",   color: "#3fb765", house: 200 },
  { key: "crown",     name: "Crown Point",     color: "#4f7dff", house: 200 },
];
/* OUR rent ladder, stated openly: base rent by deed, then the group
 * multipliers below. Printed in the math note so nothing is hidden. */
const MR_MULT = [1, 5, 15, 45, 62, 75];          // bare, 1–4 houses, hotel
const mrRentLadder = (base) => MR_MULT.map((m, i) => (i === 0 ? base : Math.round((base * m) / 5) * 5));

const P = (name, g, price, base) => ({ t: "prop", name, g, price, base, rents: mrRentLadder(base) });
const MR_BOARD = [
  { t: "go", name: "PAYDAY" },
  P("Dust Road", 0, 60, 4),
  { t: "card", deck: "strongbox", name: "Strongbox" },
  P("Kiln Street", 0, 60, 4),
  { t: "tax", name: "County Assessment", amount: 200 },
  { t: "station", name: "North Depot", price: 200 },
  P("Copper Lane", 1, 100, 6),
  { t: "card", deck: "wildcard", name: "Wildcard" },
  P("Foundry Way", 1, 100, 6),
  P("Anvil Street", 1, 120, 8),
  { t: "jail", name: "The Lockup" },
  P("Cattle Row", 2, 140, 10),
  { t: "utility", name: "The Power House", price: 150 },
  P("Saddle Street", 2, 140, 10),
  P("Brand Avenue", 2, 160, 12),
  { t: "station", name: "East Depot", price: 200 },
  P("Mesa Boulevard", 3, 180, 14),
  { t: "card", deck: "strongbox", name: "Strongbox" },
  P("Canyon Court", 3, 180, 14),
  P("Lantern Lane", 3, 200, 16),
  { t: "parking", name: "The Lookout" },
  P("Silver Street", 4, 220, 18),
  { t: "card", deck: "wildcard", name: "Wildcard" },
  P("Vault Avenue", 4, 220, 18),
  P("Ledger Lane", 4, 240, 20),
  { t: "station", name: "South Depot", price: 200 },
  P("Opera Place", 5, 260, 22),
  P("Gaslight Row", 5, 260, 22),
  { t: "utility", name: "The Reservoir", price: 150 },
  P("Marquee Drive", 5, 280, 24),
  { t: "gotojail", name: "Sheriff's Call" },
  P("Summit Street", 6, 300, 26),
  P("Cedar Heights", 6, 300, 26),
  { t: "card", deck: "strongbox", name: "Strongbox" },
  P("Observatory Way", 6, 320, 28),
  { t: "station", name: "West Depot", price: 200 },
  { t: "card", deck: "wildcard", name: "Wildcard" },
  P("Gold Coast", 7, 350, 35),
  { t: "tax", name: "Luxury Levy", amount: 100 },
  P("Empire Terrace", 7, 400, 50),
];
const MR_JAIL = 10, MR_GOTOJAIL = 30, MR_N = 40;
const MR_START_CASH = 1500, MR_SALARY = 200, MR_FINE = 50;
const MR_STATION_RENT = [0, 30, 60, 120, 240];
const MR_UTIL_MULT = [0, 5, 12];
const MR_MAX_HOUSES = 5;                          // 5 = a hotel
const MR_HOUSE_POOL = 32, MR_HOTEL_POOL = 12;

/* ---- the two decks. Original text; `to` drives the chain. ---- */
const MR_DECKS = {
  wildcard: [
    { text: "The road agent's map: advance to PAYDAY.", to: 0 },
    { text: "The sheriff has your name. Go to The Lockup.", to: "jail" },
    { text: "A telegram from Crown Point: advance to Empire Terrace.", to: 39 },
    { text: "Cattle are moving. Advance to Anvil Street.", to: 9 },
    { text: "Take the air at The Lookout. Advance there.", to: 20 },
    { text: "Board the next train: advance to the nearest depot and pay double rent.", to: "depot" },
    { text: "Board the next train: advance to the nearest depot and pay double rent.", to: "depot" },
    { text: "The meter reader calls: advance to the nearest utility, rent is ten times the dice.", to: "utility" },
    { text: "You took a wrong turn. Go back three spaces.", to: "back3" },
    { text: "A quiet word at the bank: advance to Silver Street.", to: 21 },
    { text: "Your ledger balances. Collect $150.", cash: 150 },
    { text: "Repairs on every house you own: pay $25 a house, $100 a hotel.", repair: [25, 100] },
    { text: "A freight claim goes your way. Collect $100.", cash: 100 },
    { text: "Legal fees on a disputed deed. Pay $150.", cash: -150 },
    { text: "You win the town raffle. Collect $50.", cash: 50 },
    { text: "Keep this card: it walks you out of The Lockup, once.", pardon: true },
  ],
  strongbox: [
    { text: "Back wages come through: advance to PAYDAY.", to: 0 },
    { text: "Caught rigging a bid. Go to The Lockup.", to: "jail" },
    { text: "A quarter's interest lands. Collect $200.", cash: 200 },
    { text: "The assayer pays out. Collect $100.", cash: 100 },
    { text: "Doctor's bill after the roundup. Pay $75.", cash: -75 },
    { text: "You underinsured the barn. Pay $100.", cash: -100 },
    { text: "An old debt is repaid. Collect $125.", cash: 125 },
    { text: "Property taxes come due. Pay $80.", cash: -80 },
    { text: "The co-op distributes a surplus. Collect $60.", cash: 60 },
    { text: "You bankroll the town band. Pay $50.", cash: -50 },
    { text: "Sale of a spare lot. Collect $150.", cash: 150 },
    { text: "Every rival owes you a favour. Collect $20 from each.", each: 20 },
    { text: "Stand the town a round. Pay each rival $20.", each: -20 },
    { text: "Inspection on every building: pay $30 a house, $90 a hotel.", repair: [30, 90] },
    { text: "A clerical error in your favour. Collect $40.", cash: 40 },
    { text: "Keep this card: it walks you out of The Lockup, once.", pardon: true },
  ],
};

const MR_RIVALS = [
  { name: "You",            color: "#f5c542", bot: false, token: "🤠" },
  { name: "Vera Ashcroft",  color: "#4fa3ff", bot: true,  token: "🎩" },
  { name: "Silas Roone",    color: "#ff7a59", bot: true,  token: "🚂" },
  { name: "Junie Calloway", color: "#b18cff", bot: true,  token: "🐎" },
];

/* ---- the dice, exactly ---- */
const MR_WAYS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
/* every (sum, isDouble) outcome with its count out of 36 */
function mrRolls() {
  const out = [];
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) out.push({ sum: a + b, dbl: a === b, a, b });
  return out;
}

/* ============================================================
   THE CHAIN — the exact landing frequency of every square.
   States: s*3 + d  for square s and consecutive doubles d (0..2),
   plus three lockup states (turn 1, 2, 3 inside). A turn is one
   transition. Card squares redirect with the deck's real odds.
   ============================================================ */
const MR_JS = MR_N * 3;                               // first lockup state index
function mrCardOutcomes(deck, from) {
  /* → [{p, to}] over the 16 cards: `to` is a square, or null to stay put */
  const cards = MR_DECKS[deck], p = 1 / cards.length, out = [];
  for (const c of cards) {
    let to = null;
    if (typeof c.to === "number") to = c.to;
    else if (c.to === "jail") to = "jail";
    else if (c.to === "back3") to = (from - 3 + MR_N) % MR_N;
    else if (c.to === "depot") { const st = [5, 15, 25, 35]; to = st.find((x) => x > from); if (to == null) to = 5; }
    else if (c.to === "utility") { const ut = [12, 28]; to = ut.find((x) => x > from); if (to == null) to = 12; }
    out.push({ p, to });
  }
  return out;
}
/* where does a token that arrives on `sq` actually end up? (cards, go-to-jail) */
function mrSettle(sq, add) {
  const cell = MR_BOARD[sq];
  if (sq === MR_GOTOJAIL) { add("jail", 1); return; }
  if (cell.t === "card") {
    for (const o of mrCardOutcomes(cell.deck, sq)) {
      if (o.to == null) add(sq, o.p);
      else if (o.to === "jail") add("jail", o.p);
      else if (MR_BOARD[o.to].t === "card") add(o.to, o.p);   // one hop only; the deck never chains far
      else if (o.to === MR_GOTOJAIL) add("jail", o.p);
      else add(o.to, o.p);
    }
    return;
  }
  add(sq, 1);
}
function mrChain(iters = 600) {
  const NS = MR_JS + 3;
  const rolls = mrRolls(), pr = 1 / 36;
  /* transition rows, built once */
  const T = Array.from({ length: NS }, () => new Map());
  const bump = (row, to, p) => row.set(to, (row.get(to) || 0) + p);
  const landOf = Array.from({ length: NS }, () => new Map());   // where this turn's token LANDS
  for (let s = 0; s < MR_N; s++) for (let d = 0; d < 3; d++) {
    const row = T[s * 3 + d], lrow = landOf[s * 3 + d];
    for (const r of rolls) {
      if (r.dbl && d === 2) { bump(row, MR_JS, pr); bump(lrow, "jail", pr); continue; }   // third double
      const raw = (s + r.sum) % MR_N;
      mrSettle(raw, (dest, q) => {
        const p = pr * q;
        if (dest === "jail") { bump(row, MR_JS, p); bump(lrow, "jail", p); return; }
        bump(row, dest * 3 + (r.dbl ? d + 1 : 0), p);
        bump(lrow, dest, p);
      });
    }
  }
  for (let k = 0; k < 3; k++) {                                 // in the lockup, turn k+1
    const row = T[MR_JS + k], lrow = landOf[MR_JS + k];
    for (const r of rolls) {
      if (r.dbl || k === 2) {                                   // doubles walk you out; so does the third turn (paying)
        const raw = (MR_JAIL + r.sum) % MR_N;
        mrSettle(raw, (dest, q) => {
          const p = pr * q;
          if (dest === "jail") { bump(row, MR_JS, p); bump(lrow, "jail", p); return; }
          bump(row, dest * 3, p); bump(lrow, dest, p);
        });
      } else { bump(row, MR_JS + k + 1, pr); bump(lrow, "jail", pr); }
    }
  }
  let v = new Array(NS).fill(0); v[0] = 1;
  for (let it = 0; it < iters; it++) {
    const nv = new Array(NS).fill(0);
    for (let i = 0; i < NS; i++) { const m = v[i]; if (!m) continue; for (const [j, p] of T[i]) nv[j] += m * p; }
    v = nv;
  }
  const land = new Array(MR_N).fill(0);
  let jail = 0;
  for (let i = 0; i < NS; i++) { const m = v[i]; if (!m) continue; for (const [dest, p] of landOf[i]) { if (dest === "jail") jail += m * p; else land[dest] += m * p; } }
  land[MR_JAIL] += jail;                                        // the lockup square collects both visits and stays
  const tot = land.reduce((a, b) => a + b, 0);
  return land.map((x) => x / tot);
}
let MR_LAND = null;
const mrLanding = () => (MR_LAND || (MR_LAND = mrChain()));

/* ---- money maths off the chain ---- */
function mrRentAt(s, sq, dice) {
  const cell = MR_BOARD[sq], own = s.owner[sq];
  if (own == null || s.mortgaged[sq]) return 0;
  if (cell.t === "prop") {
    const h = s.houses[sq] || 0;
    if (h > 0) return cell.rents[h];
    return mrHasGroup(s, own, cell.g) ? cell.base * 2 : cell.base;
  }
  if (cell.t === "station") return MR_STATION_RENT[mrCountKind(s, own, "station")];
  if (cell.t === "utility") return MR_UTIL_MULT[mrCountKind(s, own, "utility")] * (dice || 7);
  return 0;
}
const mrGroupSquares = (g) => MR_BOARD.map((c, i) => (c.t === "prop" && c.g === g ? i : -1)).filter((i) => i >= 0);
const mrHasGroup = (s, pid, g) => mrGroupSquares(g).every((i) => s.owner[i] === pid);
const mrCountKind = (s, pid, t) => MR_BOARD.reduce((n, c, i) => n + (c.t === t && s.owner[i] === pid && !s.mortgaged[i] ? 1 : 0), 0);
/* expected rent this deed pulls per rival turn, from the exact chain */
function mrExpectedRent(s, sq, houses) {
  const cell = MR_BOARD[sq], land = mrLanding()[sq];
  if (cell.t === "prop") {
    const h = houses == null ? (s.houses[sq] || 0) : houses;
    const r = h > 0 ? cell.rents[h] : (mrHasGroup(s, s.owner[sq], cell.g) ? cell.base * 2 : cell.base);
    return land * r;
  }
  if (cell.t === "station") return land * MR_STATION_RENT[Math.max(1, mrCountKind(s, s.owner[sq], "station"))];
  if (cell.t === "utility") return land * MR_UTIL_MULT[Math.max(1, mrCountKind(s, s.owner[sq], "utility"))] * 7;
  return 0;
}
const mrPrice = (sq) => MR_BOARD[sq].price || 0;
const mrMortgageValue = (sq) => Math.floor(mrPrice(sq) / 2);
const mrUnmortgageCost = (sq) => Math.ceil(mrMortgageValue(sq) * 1.1);

/* ---- state ---- */
function mrShuffle(a, rng) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const mrClone = (s) => JSON.parse(JSON.stringify(s));
function mrNew(rng) {
  return {
    players: MR_RIVALS.map((r, id) => ({ id, name: r.name, color: r.color, bot: r.bot, token: r.token, pos: 0, cash: MR_START_CASH, jail: 0, pardons: 0, out: false })),
    owner: new Array(MR_N).fill(null), houses: new Array(MR_N).fill(0), mortgaged: new Array(MR_N).fill(false),
    housesLeft: MR_HOUSE_POOL, hotelsLeft: MR_HOTEL_POOL,
    turn: 0, phase: "roll", dice: null, doubles: 0, pending: null, auction: null,
    log: ["A new town. Roll to leave PAYDAY."], fx: null, fxSeq: 0, winner: null, round: 1,
  };
}
function mrLog(s, line) { s.log.push(line); if (s.log.length > 90) s.log.shift(); }
function mrFx(s, fx) { s.fx = fx; s.fxSeq++; }
const mrWho = (p, verb) => (p.bot ? `${p.name} ${verb}` : `You ${verb.replace(/s$/, "")}`);
const mrAlive = (s) => s.players.filter((p) => !p.out);
const mrNetWorth = (s, pid) => {
  const p = s.players[pid];
  let n = p.cash;
  for (let i = 0; i < MR_N; i++) if (s.owner[i] === pid) {
    n += s.mortgaged[i] ? mrMortgageValue(i) : mrPrice(i);
    const h = s.houses[i] || 0;
    if (h) n += (h === MR_MAX_HOUSES ? 5 : h) * MR_GROUPS[MR_BOARD[i].g].house;
  }
  return n;
};

/* ---- money movement; everything funnels through here ---- */
function mrPay(s, from, to, amount) {
  const p = s.players[from];
  const owed = Math.min(amount, Math.max(0, amount));
  p.cash -= owed;
  if (to != null) s.players[to].cash += owed;
  return owed;
}
function mrRaiseCash(s, pid, need) {          // a bot digs itself out: sell houses, then mortgage
  const p = s.players[pid];
  let guard = 0;
  while (p.cash < need && guard++ < 200) {
    let did = false;
    for (let i = MR_N - 1; i >= 0; i--) if (s.owner[i] === pid && s.houses[i] > 0) { mrSellHouse(s, i); did = true; break; }
    if (!did) for (let i = 0; i < MR_N; i++) if (s.owner[i] === pid && !s.mortgaged[i] && s.houses[i] === 0) { mrMortgage(s, i); did = true; break; }
    if (!did) break;
  }
  return p.cash >= need;
}
function mrBankrupt(s, pid, creditor) {
  const p = s.players[pid];
  mrLog(s, `${mrWho(p, "goes")} bankrupt${creditor != null ? ` to ${s.players[creditor].name}` : ""}.`);
  for (let i = 0; i < MR_N; i++) if (s.owner[i] === pid) {
    if (creditor != null) { s.owner[i] = creditor; }
    else { s.owner[i] = null; s.mortgaged[i] = false; }
    if (s.houses[i]) { s.housesLeft += s.houses[i] === MR_MAX_HOUSES ? 0 : s.houses[i]; if (s.houses[i] === MR_MAX_HOUSES) s.hotelsLeft += 1; s.houses[i] = 0; }
  }
  if (creditor != null && p.cash > 0) s.players[creditor].cash += p.cash;
  p.cash = 0; p.out = true; p.pos = -1;
  mrFx(s, "bust");
  const left = mrAlive(s);
  if (left.length === 1) { s.winner = left[0].id; s.phase = "over"; mrLog(s, `${left[0].name} owns the row.`); mrFx(s, left[0].id === 0 ? "win" : "lose"); }
  return s;
}
function mrCharge(s, pid, amount, creditor) {
  const p = s.players[pid];
  if (p.cash < amount) {
    if (p.bot) mrRaiseCash(s, pid, amount);
    if (p.cash < amount) {
      if (!p.bot) { s.pending = { kind: "raise", need: amount, creditor }; s.phase = "raise"; return false; }
      mrBankrupt(s, pid, creditor); return false;
    }
  }
  mrPay(s, pid, creditor, amount);
  return true;
}

/* ---- building ---- */
function mrCanBuild(s, sq) {
  const cell = MR_BOARD[sq];
  if (cell.t !== "prop") return false;
  const pid = s.owner[sq];
  if (pid == null || !mrHasGroup(s, pid, cell.g)) return false;
  const grp = mrGroupSquares(cell.g);
  if (grp.some((i) => s.mortgaged[i])) return false;
  const h = s.houses[sq];
  if (h >= MR_MAX_HOUSES) return false;
  if (grp.some((i) => s.houses[i] < h)) return false;              // build evenly
  if (h === MR_MAX_HOUSES - 1) { if (s.hotelsLeft < 1) return false; } else if (s.housesLeft < 1) return false;
  return s.players[pid].cash >= MR_GROUPS[cell.g].house;
}
function mrBuild(s, sq) {
  if (!mrCanBuild(s, sq)) return s;
  const cell = MR_BOARD[sq], pid = s.owner[sq];
  s.players[pid].cash -= MR_GROUPS[cell.g].house;
  if (s.houses[sq] === MR_MAX_HOUSES - 1) { s.hotelsLeft--; s.housesLeft += MR_MAX_HOUSES - 1; s.houses[sq] = MR_MAX_HOUSES; }
  else { s.housesLeft--; s.houses[sq]++; }
  mrLog(s, `${mrWho(s.players[pid], "builds")} on ${cell.name} (${s.houses[sq] === MR_MAX_HOUSES ? "a hotel" : s.houses[sq] + " house" + (s.houses[sq] > 1 ? "s" : "")}).`);
  mrFx(s, "build");
  return s;
}
function mrCanSellHouse(s, sq) {
  const cell = MR_BOARD[sq];
  if (cell.t !== "prop" || !s.houses[sq]) return false;
  const grp = mrGroupSquares(cell.g), h = s.houses[sq];
  if (grp.some((i) => s.houses[i] > h)) return false;
  if (h === MR_MAX_HOUSES && s.housesLeft < MR_MAX_HOUSES - 1) return false;
  return true;
}
function mrSellHouse(s, sq) {
  if (!mrCanSellHouse(s, sq)) return s;
  const cell = MR_BOARD[sq], pid = s.owner[sq];
  if (s.houses[sq] === MR_MAX_HOUSES) { s.houses[sq] = MR_MAX_HOUSES - 1; s.hotelsLeft++; s.housesLeft -= MR_MAX_HOUSES - 1; }
  else { s.houses[sq]--; s.housesLeft++; }
  s.players[pid].cash += Math.floor(MR_GROUPS[cell.g].house / 2);
  mrLog(s, `${mrWho(s.players[pid], "sells")} a building on ${cell.name}.`);
  return s;
}
function mrMortgage(s, sq) {
  const pid = s.owner[sq];
  if (pid == null || s.mortgaged[sq] || s.houses[sq]) return s;
  s.mortgaged[sq] = true; s.players[pid].cash += mrMortgageValue(sq);
  mrLog(s, `${mrWho(s.players[pid], "mortgages")} ${MR_BOARD[sq].name} for $${mrMortgageValue(sq)}.`);
  return s;
}
function mrUnmortgage(s, sq) {
  const pid = s.owner[sq];
  if (pid == null || !s.mortgaged[sq] || s.players[pid].cash < mrUnmortgageCost(sq)) return s;
  s.players[pid].cash -= mrUnmortgageCost(sq); s.mortgaged[sq] = false;
  mrLog(s, `${mrWho(s.players[pid], "lifts")} the mortgage on ${MR_BOARD[sq].name}.`);
  return s;
}

/* ---- the turn ---- */
function mrLand(s, rng) {
  const p = s.players[s.turn], sq = p.pos, cell = MR_BOARD[sq];
  const dice = s.dice ? s.dice[0] + s.dice[1] : 7;
  if (cell.t === "gotojail") { mrGoToJail(s); return mrAfterLanding(s); }
  if (cell.t === "tax") { mrLog(s, `${mrWho(p, "pays")} the ${cell.name}: $${cell.amount}.`); if (!mrCharge(s, p.id, cell.amount, null)) return s; return mrAfterLanding(s); }
  if (cell.t === "card") { return mrDrawCard(s, cell.deck, rng); }
  if (cell.t === "prop" || cell.t === "station" || cell.t === "utility") {
    const own = s.owner[sq];
    if (own == null) {
      if (p.bot) { const want = mrBotWantsBuy(s, p.id, sq); if (want) return mrAfterLanding(mrBuy(s, sq)); return mrStartAuction(s, sq); }
      s.pending = { kind: "buy", sq }; s.phase = "buy"; return s;
    }
    if (own === p.id) { mrLog(s, `${mrWho(p, "lands")} on ${cell.name} — ${p.bot ? "their" : "your"} own.`); return mrAfterLanding(s); }
    if (s.mortgaged[sq]) { mrLog(s, `${cell.name} is mortgaged — no rent.`); return mrAfterLanding(s); }
    const rent = mrRentAt(s, sq, dice);
    mrLog(s, `${mrWho(p, "pays")} $${rent} rent on ${cell.name} to ${s.players[own].name}.`);
    mrFx(s, "rent");
    if (!mrCharge(s, p.id, rent, own)) return s;
    return mrAfterLanding(s);
  }
  if (cell.t === "parking") mrLog(s, `${mrWho(p, "rests")} at ${cell.name}.`);
  if (cell.t === "jail") mrLog(s, `${mrWho(p, "passes")} The Lockup — just visiting.`);
  if (cell.t === "go") mrLog(s, `${mrWho(p, "lands")} square on PAYDAY.`);
  return mrAfterLanding(s);
}
/* Hand the turn back to the player. Guard on the BLOCKING STATE, never on the
 * phase name: a buy prompt or an auction that has just resolved clears its own
 * pending/auction record, and if we checked the stale phase name here the game
 * would sit in that phase forever. (It did. The suite caught it.) */
function mrAfterLanding(s) {
  if (s.phase === "over") return s;
  if (s.pending || s.auction) return s;
  s.phase = "act";
  return s;
}
function mrGoToJail(s) {
  const p = s.players[s.turn];
  p.pos = MR_JAIL; p.jail = 1; s.doubles = 0;
  mrLog(s, `${mrWho(p, "is")} sent to The Lockup.`);
  mrFx(s, "jail");
}
function mrMoveTo(s, pos, pass = true) {
  const p = s.players[s.turn];
  if (pass && pos < p.pos) { p.cash += MR_SALARY; mrLog(s, `${mrWho(p, "passes")} PAYDAY: +$${MR_SALARY}.`); }
  p.pos = pos;
}
function mrDrawCard(s, deck, rng) {
  const cards = MR_DECKS[deck], c = cards[Math.floor(rng() * cards.length)];
  const p = s.players[s.turn];
  mrLog(s, `${deck === "wildcard" ? "Wildcard" : "Strongbox"}: ${c.text}`);
  mrFx(s, "card");
  if (c.pardon) { p.pardons++; return mrAfterLanding(s); }
  if (c.cash != null) { if (c.cash >= 0) p.cash += c.cash; else if (!mrCharge(s, p.id, -c.cash, null)) return s; return mrAfterLanding(s); }
  if (c.each != null) {
    for (const q of mrAlive(s)) {
      if (q.id === p.id) continue;
      if (c.each > 0) { if (!mrCharge(s, q.id, c.each, p.id)) return s; }
      else { if (!mrCharge(s, p.id, -c.each, q.id)) return s; }
    }
    return mrAfterLanding(s);
  }
  if (c.repair) {
    let owed = 0;
    for (let i = 0; i < MR_N; i++) if (s.owner[i] === p.id && s.houses[i]) owed += s.houses[i] === MR_MAX_HOUSES ? c.repair[1] : s.houses[i] * c.repair[0];
    if (owed && !mrCharge(s, p.id, owed, null)) return s;
    if (owed) mrLog(s, `Repairs come to $${owed}.`);
    return mrAfterLanding(s);
  }
  if (c.to === "jail") { mrGoToJail(s); return mrAfterLanding(s); }
  if (typeof c.to === "number") { mrMoveTo(s, c.to); return mrLand(s, rng); }
  if (c.to === "back3") { const np = (p.pos - 3 + MR_N) % MR_N; p.pos = np; return mrLand(s, rng); }
  if (c.to === "depot") { const st = [5, 15, 25, 35]; const t = st.find((x) => x > p.pos); mrMoveTo(s, t == null ? 5 : t); return mrLand(s, rng); }
  if (c.to === "utility") { const ut = [12, 28]; const t = ut.find((x) => x > p.pos); mrMoveTo(s, t == null ? 12 : t); return mrLand(s, rng); }
  return mrAfterLanding(s);
}
function mrRoll(s, rng) {
  if (s.phase !== "roll") return s;
  const p = s.players[s.turn];
  const a = 1 + Math.floor(rng() * 6), b = 1 + Math.floor(rng() * 6);
  s.dice = [a, b];
  mrFx(s, "dice");
  if (p.jail > 0) {
    if (a === b) { mrLog(s, `${mrWho(p, "rolls")} doubles and walks out of The Lockup.`); p.jail = 0; }
    else if (p.jail >= 3) {
      mrLog(s, `${mrWho(p, "pays")} the $${MR_FINE} fine and leaves The Lockup.`);
      if (!mrCharge(s, p.id, MR_FINE, null)) return s;
      p.jail = 0;
    } else { p.jail++; mrLog(s, `${mrWho(p, "stays")} in The Lockup (turn ${p.jail} of 3).`); s.phase = "act"; return s; }
  } else if (a === b) {
    s.doubles++;
    if (s.doubles >= 3) { mrLog(s, `${mrWho(p, "rolls")} a third double — straight to The Lockup.`); mrGoToJail(s); s.phase = "act"; return s; }
  } else s.doubles = 0;
  mrMoveTo(s, (p.pos + a + b) % MR_N);
  mrLog(s, `${mrWho(p, "rolls")} ${a}+${b} = ${a + b} to ${MR_BOARD[p.pos].name}.`);
  return mrLand(s, rng);
}
function mrBuy(s, sq) {
  const pid = s.turn, p = s.players[pid];
  if (s.owner[sq] != null || p.cash < mrPrice(sq)) return s;
  p.cash -= mrPrice(sq); s.owner[sq] = pid;
  mrLog(s, `${mrWho(p, "buys")} ${MR_BOARD[sq].name} for $${mrPrice(sq)}.`);
  mrFx(s, "buy");
  if (s.phase === "buy") { s.pending = null; return mrAfterLanding(s); }
  return s;
}
function mrDeclineBuy(s) {
  if (s.phase !== "buy" || !s.pending) return s;
  const sq = s.pending.sq; s.pending = null;
  return mrStartAuction(s, sq);
}
/* a plain ascending auction: each rival bids up to its own valuation */
function mrStartAuction(s, sq) {
  const bidders = mrAlive(s).map((p) => p.id);
  s.auction = { sq, bid: 0, high: null, live: bidders.slice(), idx: 0 };
  s.phase = "auction";
  mrLog(s, `${MR_BOARD[sq].name} goes to auction.`);
  return mrAuctionStep(s);
}
function mrAuctionStep(s) {
  const a = s.auction;
  if (!a) return s;
  let guard = 0;
  while (guard++ < 60) {
    if (a.live.length === 0) { return mrAuctionClose(s); }
    if (a.live.length === 1 && a.high === a.live[0]) return mrAuctionClose(s);
    const pid = a.live[a.idx % a.live.length];
    const p = s.players[pid];
    if (!p.bot) return s;                                        // wait for the human
    const value = mrBotValue(s, pid, a.sq);
    const next = a.bid + Math.max(10, Math.round(a.bid * 0.1 / 10) * 10);
    if (value >= next && p.cash >= next && a.high !== pid) { a.bid = next; a.high = pid; a.idx++; mrLog(s, `${p.name} bids $${next}.`); }
    else { a.live = a.live.filter((x) => x !== pid); if (a.live.length && a.idx >= a.live.length) a.idx = 0; }
  }
  return mrAuctionClose(s);
}
function mrAuctionBid(s, pid) {
  const a = s.auction;
  if (!a || s.phase !== "auction" || !a.live.includes(pid)) return s;
  const next = a.bid + Math.max(10, Math.round(a.bid * 0.1 / 10) * 10);
  if (s.players[pid].cash < next) return s;
  a.bid = next; a.high = pid; a.idx++;
  mrLog(s, `${mrWho(s.players[pid], "bids")} $${next}.`);
  return mrAuctionStep(s);
}
function mrAuctionPass(s, pid) {
  const a = s.auction;
  if (!a || s.phase !== "auction") return s;
  a.live = a.live.filter((x) => x !== pid);
  if (a.live.length && a.idx >= a.live.length) a.idx = 0;
  return mrAuctionStep(s);
}
function mrAuctionClose(s) {
  const a = s.auction;
  if (!a) return s;
  if (a.high != null && a.bid > 0) {
    s.players[a.high].cash -= a.bid; s.owner[a.sq] = a.high;
    mrLog(s, `${s.players[a.high].name} takes ${MR_BOARD[a.sq].name} at auction for $${a.bid}.`);
    mrFx(s, "buy");
  } else mrLog(s, `Nobody bids — ${MR_BOARD[a.sq].name} stays with the bank.`);
  s.auction = null;
  return mrAfterLanding(s);
}
function mrPayFine(s) {
  const p = s.players[s.turn];
  if (p.jail === 0) return s;
  if (p.pardons > 0) { p.pardons--; p.jail = 0; mrLog(s, `${mrWho(p, "uses")} a pardon and walks out.`); return s; }
  if (!mrCharge(s, p.id, MR_FINE, null)) return s;
  p.jail = 0; mrLog(s, `${mrWho(p, "pays")} the $${MR_FINE} fine.`);
  return s;
}
function mrEndTurn(s) {
  if (s.phase !== "act" || s.phase === "over") return s;
  const p = s.players[s.turn];
  if (s.dice && s.dice[0] === s.dice[1] && p.jail === 0 && s.doubles > 0 && s.doubles < 3) { s.phase = "roll"; mrLog(s, `${mrWho(p, "rolls")} again (doubles).`); return s; }
  s.doubles = 0;
  let guard = 0;
  do { s.turn = (s.turn + 1) % s.players.length; if (s.turn === 0) s.round++; } while (s.players[s.turn].out && guard++ < 10);
  s.phase = "roll"; s.dice = null;
  return s;
}
/* the human digging out of a shortfall */
function mrResolveRaise(s) {
  if (s.phase !== "raise" || !s.pending) return s;
  const { need, creditor } = s.pending, p = s.players[s.turn];
  if (p.cash >= need) {
    mrPay(s, p.id, creditor, need);
    s.pending = null;
    return mrAfterLanding(s);
  }
  return s;
}
function mrConcede(s) {
  if (s.phase !== "raise" || !s.pending) return s;
  const { creditor } = s.pending;
  s.pending = null;
  return mrBankrupt(s, s.turn, creditor);
}

/* ---- trades: you offer a deed plus cash, a rival answers by its own book ---- */
function mrTradeValue(s, pid, sq) { return mrBotValue(s, pid, sq); }
function mrOfferTrade(s, sq, cash, toPid) {
  if (s.phase !== "act" || s.owner[sq] !== s.turn || s.houses[sq]) return s;
  const me = s.players[s.turn], them = s.players[toPid];
  if (them.out || them.cash < cash) { mrLog(s, `${them.name} can't cover $${cash}.`); return s; }
  const worth = mrTradeValue(s, toPid, sq);
  if (worth >= cash) {
    them.cash -= cash; me.cash += cash; s.owner[sq] = toPid;
    mrLog(s, `${them.name} takes ${MR_BOARD[sq].name} for $${cash}.`);
    mrFx(s, "buy");
  } else mrLog(s, `${them.name} passes on ${MR_BOARD[sq].name} at $${cash}.`);
  return s;
}

/* ---- the rivals' book (and the Coach's, identically) ---- */
function mrBotValue(s, pid, sq) {
  const cell = MR_BOARD[sq];
  const land = mrLanding()[sq];
  let v = mrPrice(sq);
  if (cell.t === "prop") {
    const grp = mrGroupSquares(cell.g);
    const mine = grp.filter((i) => s.owner[i] === pid).length;
    const theirs = grp.filter((i) => s.owner[i] != null && s.owner[i] !== pid).length;
    if (mine === grp.length - 1) v *= 1.9;                       // completes the set
    else if (mine > 0) v *= 1.35;
    if (theirs === grp.length - 1) v *= 1.5;                     // blocks a rival's set
    else if (theirs > 0) v *= 0.8;
    v *= 1 + land * 6;                                           // the chain, weighted in
  } else if (cell.t === "station") v *= 1 + 0.25 * mrCountKind(s, pid, "station");
  else if (cell.t === "utility") v *= 0.85;
  const p = s.players[pid];
  if (p.cash < mrPrice(sq) + 150) v *= 0.7;                      // don't go cash-broke
  return Math.round(v);
}
function mrBotWantsBuy(s, pid, sq) {
  const p = s.players[pid];
  if (p.cash < mrPrice(sq)) return false;
  const keep = s.round < 4 ? 50 : 200;                            // early: grab land; later: keep a cushion
  if (p.cash - mrPrice(sq) < keep) return false;
  return mrBotValue(s, pid, sq) >= mrPrice(sq) * 0.95;
}
function mrBestBuild(s, pid) {
  let best = null, bestScore = -1;
  for (let i = 0; i < MR_N; i++) {
    if (s.owner[i] !== pid || !mrCanBuild(s, i)) continue;
    const cell = MR_BOARD[i], h = s.houses[i];
    const gain = (cell.rents[h + 1] - (h ? cell.rents[h] : cell.base * 2)) * mrLanding()[i];
    const score = gain / MR_GROUPS[cell.g].house;
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best == null ? null : { sq: best, score: bestScore };
}
function mrBotStep(s, rng) {
  const p = s.players[s.turn];
  if (s.phase === "over" || !p.bot) return s;
  if (s.phase === "auction") return mrAuctionStep(s);
  if (s.phase === "raise") { if (!mrRaiseCash(s, p.id, s.pending.need)) return mrConcede(s); return mrResolveRaise(s); }
  if (s.phase === "roll") {
    if (p.jail > 0 && (p.pardons > 0 || (p.cash > 400 && p.jail >= 2))) mrPayFine(s);
    return mrRoll(s, rng);
  }
  if (s.phase === "buy") { const sq = s.pending.sq; return mrBotWantsBuy(s, p.id, sq) ? mrAfterLanding(mrBuy(s, sq)) : mrDeclineBuy(s); }
  if (s.phase === "act") {
    const b = mrBestBuild(s, p.id);
    if (b && p.cash - MR_GROUPS[MR_BOARD[b.sq].g].house > 150) return mrBuild(s, b.sq);
    for (let i = 0; i < MR_N; i++) if (s.owner[i] === p.id && s.mortgaged[i] && p.cash > mrUnmortgageCost(i) + 400) return mrUnmortgage(s, i);
    return mrEndTurn(s);
  }
  return s;
}

/* ---- THE COACH ---- */
const mrPct = (x) => (100 * x).toFixed(2) + "%";
function mrPayback(s, sq) {
  const per = mrExpectedRent(s, sq, null) * 3;                     // three rivals rolling
  return per > 0 ? Math.round(mrPrice(sq) / per) : null;
}
function mrCoach(s) {
  const me = s.players[0], land = mrLanding();
  if (s.phase === "over") return { title: s.winner === 0 ? "You own the row." : `${s.players[s.winner].name} owns the row.`, why: "Every game reshuffles the cards and the dice. The board's odds never change — that's the part worth learning." };
  if (s.turn !== 0 && s.phase !== "auction") {
    return { title: `${s.players[s.turn].name} is up.`, why: `Your net worth is $${mrNetWorth(s, 0).toLocaleString()}. Cash on hand $${me.cash.toLocaleString()}. Rent your deeds expect to pull per rival turn: $${mrMyRentRate(s, 0).toFixed(2)}.` };
  }
  if (s.phase === "auction") {
    const a = s.auction, v = mrBotValue(s, 0, a.sq);
    return { title: `Your book says $${v} for ${MR_BOARD[a.sq].name}.`, why: `Bidding stands at $${a.bid}${a.high != null ? ` (${s.players[a.high].name})` : ""}. That valuation is list price adjusted for the set you'd complete or block, and for how often this square is landed on: ${mrPct(land[a.sq])} of all landings. Pay past your book only to deny a set.`, act: v > a.bid + 10 ? "bid" : "pass" };
  }
  if (s.phase === "raise") return { title: `You owe $${s.pending.need}.`, why: "Sell buildings back at half price, or mortgage a deed for half its list. Mortgage the ones that earn least first — the board tells you which. If you can't cover it, you're out." };
  if (s.phase === "buy") {
    const sq = s.pending.sq, cell = MR_BOARD[sq], v = mrBotValue(s, 0, sq), pay = mrPayback(s, sq);
    const good = v >= mrPrice(sq) && me.cash - mrPrice(sq) >= (s.round < 4 ? 50 : 200);
    return {
      title: good ? `Buy ${cell.name}.` : `Let ${cell.name} go to auction.`,
      why: `List $${mrPrice(sq)}; your book says $${v}. This square takes ${mrPct(land[sq])} of all landings${pay ? `, so bare it pays for itself in about ${pay} rival turns` : ""}. ${good ? "You keep enough cash to survive a rent hit." : `Buying leaves $${me.cash - mrPrice(sq)} — thin. At auction you may still get it cheaper.`}`,
      act: good ? "buy" : "decline",
    };
  }
  if (s.phase === "roll") {
    if (me.jail > 0) return { title: me.jail >= 3 ? "Pay the fine." : "Stay in and roll.", why: `Early on, The Lockup is the worst place to be — you're not collecting land. Late, with hotels up, it's shelter: you can't land on a rival's rent while you sit. It's round ${s.round}, so ${s.round < 6 ? "get out and buy." : "sitting is fine."} Doubles free you: 6 of 36 rolls.` };
    return { title: "Roll.", why: `The Lockup is the most landed-on square at ${mrPct(land[MR_JAIL])}, and that's what bends the whole board: the squares a natural roll past it get hit hardest. Your deeds pull $${mrMyRentRate(s, 0).toFixed(2)} per rival turn.` };
  }
  const b = mrBestBuild(s, 0);
  if (b) {
    const cell = MR_BOARD[b.sq], h = s.houses[b.sq];
    const now = h ? cell.rents[h] : cell.base * 2, next = cell.rents[h + 1];
    return { title: `Build on ${cell.name}.`, why: `$${MR_GROUPS[cell.g].house} takes rent from $${now} to $${next}. At ${mrPct(land[b.sq])} landings that's $${((next - now) * land[b.sq] * 3).toFixed(2)} more per round — back in about ${Math.round(MR_GROUPS[cell.g].house / ((next - now) * land[b.sq] * 3))} rounds. Third house is the steepest jump in the ladder; that's where games are won.`, act: "build", sq: b.sq };
  }
  const sets = MR_GROUPS.map((g, i) => i).filter((i) => mrHasGroup(s, 0, i));
  return { title: "End your turn.", why: sets.length ? `Nothing worth building right now — cash $${me.cash}. Keep a cushion: the biggest rent on this board is $${Math.max(...MR_BOARD.filter((c) => c.t === "prop").map((c) => c.rents[5]))}.` : `You hold no complete group yet, and only a complete group can be built on. Trade for the one you're closest to — that, not buying everything, is how this game is won.` };
}
function mrMyRentRate(s, pid) {
  let r = 0;
  for (let i = 0; i < MR_N; i++) if (s.owner[i] === pid && !s.mortgaged[i]) r += mrExpectedRent(s, i, null);
  return r;
}

/* ============================================================
   THE PAGE — the board is the control. Tap any square to read
   it: price, the whole rent ladder, its exact landing share, the
   rent it expects to pull, and how long it takes to pay for
   itself. Tap your own deed in BUILD mode to raise a house.
   Nothing is ever a dead tap.
   ============================================================ */
const MR_SAVE = "poker-trainer:moguls";
const MR_LESSONS_KEY = "poker-trainer:moguls:lessons";
function mrLoadSaved() {
  try { const s = JSON.parse(window.localStorage.getItem(MR_SAVE) || "null"); return s && s.players && s.players.length === 4 && s.owner && s.owner.length === MR_N ? s : null; } catch { return null; }
}
function mrSave(s) { try { window.localStorage.setItem(MR_SAVE, JSON.stringify(s)); } catch { /* private mode */ } }
function mrLessonsLoad() { try { return JSON.parse(window.localStorage.getItem(MR_LESSONS_KEY) || "[]"); } catch { return []; } }
function mrLessonsSave(a) { try { window.localStorage.setItem(MR_LESSONS_KEY, JSON.stringify(a)); } catch { /* private mode */ } }

/* the ring: 11×11, PAYDAY bottom-right, running anticlockwise */
function mrXY(i) {
  if (i <= 10) return { x: 10 - i, y: 10 };
  if (i <= 20) return { x: 0, y: 10 - (i - 10) };
  if (i <= 30) return { x: i - 20, y: 0 };
  return { x: 10, y: i - 30 };
}
const mrSide = (i) => (i <= 10 ? "bottom" : i <= 20 ? "left" : i <= 30 ? "top" : "right");

const MR_GUIDE = [
  { h: "Go round, buy the block", p: "Roll two dice, move that many squares, and do what the square says. Land on unowned land and you may buy it at list — or let it go to auction, where everyone bids. First one left standing when everybody else is broke owns the row." },
  { h: "Rent is the whole game", p: "Land on a rival's deed and you pay their rent. Hold every deed of one colour and that group's bare rent doubles — and only then may you build. Houses take rent from pennies to ruin: the third house is the steepest jump on the ladder." },
  { h: "The board is not fair", p: "The Lockup pulls tokens to one corner, so squares a natural roll past it get landed on far more than squares just past PAYDAY. Every square here prints its EXACT share of all landings, computed from the dice, the lockup rule and the cards.", tag: "EXACT: A MARKOV CHAIN" },
  { h: "The Lockup", p: "Three doubles in a row, the Sheriff's Call square, or a card sends you there. Roll doubles to leave, or pay $50 after three turns. Early it's a waste — you're not buying land. Late, with hotels up, it's shelter." },
  { h: "When money runs short", p: "Sell buildings back at half, or mortgage a deed for half its list (buy it back at list plus a tenth). Can't cover what you owe? You're out, and your deeds go to whoever you owed." },
  { h: "The names at a real table", p: "Deed = title deed. The Lockup = jail. PAYDAY = the go square. Depots = the railroads. Wildcard and Strongbox = the two card decks. Same system, same maths — the words are ours." },
  { h: "The Coach", p: "Every prompt gets a verdict and the numbers behind it: your book value for a deed, its landing share, its payback in rival turns, and which house is the best next dollar you can spend. It's the same book the three rivals bid and build by.", tag: "SAME BOOK AS THE RIVALS", green: true },
];
const MR_LESSONS = {
  first: { h: "Your first roll", p: "Two dice, move that many. Seven comes up more than any other total — 6 ways in 36 — so the square seven past you is the one you're most likely to hit. Tap any square on the board to read what it costs and how often it gets landed on.", table: "Tokens run anticlockwise from PAYDAY." },
  buy: { h: "Buy, or send it to auction", p: "At list price you either take it or everyone bids for it. Declining is not always weak: if the board says a square is rarely landed on, or the cash would leave you unable to pay a rent, let it go and try to win it cheap in the auction.", table: "At a real table this is the title deed." },
  rent: { h: "You just paid rent", p: "That's the whole engine. Rent goes up when one owner holds a full colour group, and multiplies again with every house. Which is why owning many scattered deeds loses to owning one complete group.", table: "" },
  group: { h: "You hold a full group", p: "Now you can build — and only now. Build evenly: no square may be more than one house ahead of its group. The Coach names the single best house you can buy next and what it earns back.", table: "" },
  jail: { h: "The Lockup", p: "Roll doubles to get out, or pay the $50 fine after three turns. It's the most-landed-on square on the board, and that's exactly why the squares a short roll past it are the most valuable land in the game.", table: "At a real table this is jail." },
  build: { h: "Houses change everything", p: "A bare deed earns pennies. The jump from two houses to three is the steepest on the ladder — that's where the game is decided. Keep enough cash to survive landing on someone else's hotel.", table: "" },
  auction: { h: "The auction", p: "Bidding opens at nothing and climbs. The rivals bid to their own book and stop. Your book is printed for you — pay past it only to stop someone completing a group.", table: "" },
  broke: { h: "Short of cash", p: "Sell buildings back at half price, or mortgage a deed for half its list. Mortgage what earns least first — the landing share tells you which. If you still can't pay, you're out and your deeds pass to whoever you owed.", table: "" },
};

function MrHeader({ cash, onHelp }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "12px 16px", flexWrap: "wrap", background: "linear-gradient(180deg, rgba(255,255,255,0.03), transparent)", borderBottom: `1px solid ${CAS.line}` }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: casSans, fontSize: 17, fontWeight: 900, letterSpacing: "0.22em", color: CAS.cream }}>MOGUL ROW</div>
        <div style={{ fontFamily: casMono, fontSize: 9.5, letterSpacing: "0.08em", color: CAS.faint, marginTop: 2 }}>BUY THE BLOCK · OWN THE ODDS</div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 13px", borderRadius: 999, background: CAS.goldFaint, border: `1px solid ${CAS.goldLine}` }}>
          <span style={{ fontFamily: casSans, fontSize: 14, fontWeight: 900, color: CAS.gold, fontVariantNumeric: "tabular-nums" }}>${cash.toLocaleString()}</span>
        </div>
        <button onClick={onHelp} aria-label="Open the table guide" style={{ height: 30, borderRadius: 9, cursor: "pointer", padding: "0 10px", border: `1px solid ${CAS.line}`, background: "rgba(255,255,255,0.03)", color: CAS.dim, fontSize: 13, fontWeight: 900, lineHeight: 1, fontFamily: casSans }}>?</button>
        <SoundToggle dark />
        <AccountArea dark />
        <a href="index.html" aria-label="Home" style={{ color: CAS.dim, textDecoration: "none", fontSize: 16, lineHeight: 1, border: `1px solid ${CAS.line}`, borderRadius: 9, padding: "6px 10px", background: "rgba(255,255,255,0.02)" }}>⌂</a>
      </div>
    </div>
  );
}

function MrBoard({ g, sel, buildable, onSquare, heat }) {
  const land = mrLanding();
  const maxLand = Math.max(...land.filter((_, i) => i !== MR_JAIL));
  return (
    <svg viewBox="-0.4 -0.4 11.8 11.8" style={{ width: "100%", maxWidth: 620, display: "block", margin: "0 auto", touchAction: "manipulation" }} role="img" aria-label="Mogul Row">
      <defs>
        <style>{`@keyframes mrPulse{0%,100%{opacity:.55}50%{opacity:1}} .mrPulse{animation:mrPulse 1.15s ease-in-out infinite} @media (prefers-reduced-motion: reduce){.mrPulse{animation:none;opacity:.95}}`}</style>
      </defs>
      <rect x={-0.4} y={-0.4} width={11.8} height={11.8} rx={0.5} fill="#0b2e1e" />
      <rect x={1.05} y={1.05} width={8.9} height={8.9} rx={0.3} fill="url(#srSea)" opacity={0.6} />
      <rect x={1.05} y={1.05} width={8.9} height={8.9} rx={0.3} fill="#082a1a" stroke="rgba(245,197,66,0.16)" strokeWidth={0.04} />
      {MR_BOARD.map((cell, i) => {
        const { x, y } = mrXY(i);
        const side = mrSide(i);
        const own = g.owner[i], grp = cell.t === "prop" ? MR_GROUPS[cell.g] : null;
        const isSel = sel === i, canB = buildable.has(i);
        const hs = g.houses[i] || 0;
        const hot = heat ? Math.min(1, land[i] / maxLand) : 0;
        return (
          <g key={i} onClick={() => onSquare(i)} style={{ cursor: "pointer" }}>
            <rect x={x} y={y} width={1} height={1} rx={0.07}
              fill={heat ? `rgba(245,197,66,${0.06 + 0.55 * hot})` : "#12181f"}
              stroke={isSel ? CAS.gold : canB ? CAS.goldDim : "rgba(255,255,255,0.14)"} strokeWidth={isSel ? 0.07 : canB ? 0.05 : 0.02} />
            {grp && (
              <rect x={side === "left" ? x + 0.78 : side === "right" ? x : x + 0.02} y={side === "top" ? y + 0.78 : side === "bottom" ? y : y + 0.02}
                width={side === "left" || side === "right" ? 0.22 : 0.96} height={side === "left" || side === "right" ? 0.96 : 0.22} fill={grp.color} rx={0.03} />
            )}
            {own != null && <rect x={x + 0.06} y={y + 0.06} width={0.88} height={0.88} rx={0.05} fill={g.players[own].color} opacity={g.mortgaged[i] ? 0.13 : 0.3} stroke={g.players[own].color} strokeWidth={0.035} />}
            <text x={x + 0.5} y={y + 0.42} textAnchor="middle" fontSize={0.2} pointerEvents="none">
              {cell.t === "go" ? "🏦" : cell.t === "jail" ? "🔒" : cell.t === "gotojail" ? "🚨" : cell.t === "parking" ? "⛰️" : cell.t === "station" ? "🚂" : cell.t === "utility" ? "💡" : cell.t === "tax" ? "🧾" : cell.t === "card" ? (cell.deck === "wildcard" ? "❓" : "🧰") : ""}
            </text>
            <text x={x + 0.5} y={y + (cell.t === "prop" ? 0.45 : 0.72)} textAnchor="middle" fontSize={0.145} fontWeight={800} fontFamily={casMono} fill={CAS.cream} pointerEvents="none">
              {cell.t === "prop" ? "$" + cell.price : cell.t === "station" || cell.t === "utility" ? "$" + cell.price : cell.t === "tax" ? "-$" + cell.amount : ""}
            </text>
            <text x={x + 0.5} y={y + 0.68} textAnchor="middle" fontSize={0.135} fontFamily={casMono} fill={heat ? "#fff" : CAS.goldDim} pointerEvents="none">{(100 * land[i]).toFixed(1)}%</text>
            {hs > 0 && (
              <g pointerEvents="none">
                {hs === MR_MAX_HOUSES
                  ? <rect x={x + 0.34} y={y + 0.76} width={0.32} height={0.15} fill="#e2453c" stroke="#0a0c10" strokeWidth={0.02} rx={0.02} />
                  : Array.from({ length: hs }, (_, k) => <rect key={k} x={x + 0.13 + k * 0.2} y={y + 0.78} width={0.14} height={0.12} fill="#3fb765" stroke="#0a0c10" strokeWidth={0.02} rx={0.02} />)}
              </g>
            )}
            {g.mortgaged[i] && <text x={x + 0.5} y={y + 0.93} textAnchor="middle" fontSize={0.12} fontFamily={casMono} fill="#e14b42" pointerEvents="none">MORT</text>}
            {canB && <rect className="mrPulse" x={x} y={y} width={1} height={1} rx={0.07} fill="rgba(245,197,66,0.2)" stroke={CAS.gold} strokeWidth={0.06} />}
          </g>
        );
      })}
      {/* tokens */}
      {g.players.map((p) => {
        if (p.out || p.pos < 0) return null;
        const { x, y } = mrXY(p.pos);
        const same = g.players.filter((q) => !q.out && q.pos === p.pos);
        const k = same.findIndex((q) => q.id === p.id);
        return (
          <g key={p.id} pointerEvents="none">
            <circle cx={x + 0.28 + (k % 2) * 0.44} cy={y + 0.27 + Math.floor(k / 2) * 0.44} r={0.17} fill="#0a0c10" stroke={p.color} strokeWidth={0.06} />
            <text x={x + 0.28 + (k % 2) * 0.44} y={y + 0.33 + Math.floor(k / 2) * 0.44} textAnchor="middle" fontSize={0.2}>{p.token}</text>
          </g>
        );
      })}
      <text x={5.5} y={4.6} textAnchor="middle" fontFamily={casSans} fontSize={0.62} fontWeight={900} fill={CAS.cream} opacity={0.22} letterSpacing="0.1">MOGUL ROW</text>
      <text x={5.5} y={5.5} textAnchor="middle" fontFamily={casMono} fontSize={0.26} fill={CAS.gold} opacity={0.55}>EVERY SQUARE WEARS ITS TRUE ODDS</text>
      <text x={5.5} y={6.2} textAnchor="middle" fontFamily={casMono} fontSize={0.22} fill={CAS.dim} opacity={0.6}>{heat ? "HEAT: BRIGHTER = LANDED ON MORE" : "TAP ANY SQUARE TO READ IT"}</text>
    </svg>
  );
}

function MrDie({ n }) {
  const dots = { 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [0, 2], [2, 0], [2, 2]], 5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]], 6: [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]] }[n] || [];
  return (
    <div style={{ width: 30, height: 30, borderRadius: 7, background: CAS.cream, boxShadow: "0 3px 8px rgba(0,0,0,0.5)", position: "relative", animation: "casChipDrop 320ms ease both" }}>
      {dots.map(([r, c], i) => <span key={i} style={{ position: "absolute", width: 5, height: 5, borderRadius: "50%", background: "#161a22", left: 4.5 + c * 8, top: 4.5 + r * 8 }} />)}
    </div>
  );
}

export default function MogulRow() {
  const rngRef = useRef(Math.random);
  const [g, setG] = useState(() => mrLoadSaved() || mrNew(Math.random));
  const [guideOpen, setGuideOpen] = useState(() => guideUnseen("moguls"));
  const [sel, setSel] = useState(null);
  const [mode, setMode] = useState(null);            // build | sell | mortgage | trade
  const [heat, setHeat] = useState(false);
  const [tradeTo, setTradeTo] = useState(1);
  const [tradeCash, setTradeCash] = useState(100);
  const [nudge, setNudge] = useState(null);
  const [lessonsSeen, setLessonsSeen] = useState(mrLessonsLoad);
  const [lesson, setLesson] = useState(null);
  const [coachOpen, setCoachOpen] = useState(true);
  const [logOpen, setLogOpen] = useState(false);
  const [endDismissed, setEndDismissed] = useState(false);
  const [winKey, setWinKey] = useState(0);
  const lastFx = useRef(g.fxSeq);

  const me = g.players[0];
  const myTurn = g.turn === 0 && !me.out;
  const ended = g.phase === "over";
  const coach = useMemo(() => mrCoach(g), [g]);
  const land = mrLanding();

  const buildable = useMemo(() => {
    const set = new Set();
    if (!myTurn || g.phase !== "act") return set;
    for (let i = 0; i < MR_N; i++) {
      if (g.owner[i] !== 0) continue;
      if (mode === "build" && mrCanBuild(g, i)) set.add(i);
      if (mode === "sell" && mrCanSellHouse(g, i)) set.add(i);
      if (mode === "mortgage" && ((!g.mortgaged[i] && !g.houses[i]) || (g.mortgaged[i] && me.cash >= mrUnmortgageCost(i)))) set.add(i);
      if (mode === "trade" && !g.houses[i]) set.add(i);
    }
    return set;
  }, [g, mode, myTurn, me.cash]);

  const say = useCallback((t) => setNudge({ t, key: Date.now() }), []);
  useEffect(() => { if (!nudge) return; const t = setTimeout(() => setNudge(null), 4600); return () => clearTimeout(t); }, [nudge]);
  useEffect(() => { mrSave(g); }, [g]);
  useEffect(() => {
    if (g.fxSeq === lastFx.current) return;
    lastFx.current = g.fxSeq;
    if (g.fx === "dice") sfx.dice(600);
    else if (g.fx === "buy" || g.fx === "build") sfx.chip();
    else if (g.fx === "rent") sfx.chips(4);
    else if (g.fx === "card") sfx.card();
    else if (g.fx === "jail" || g.fx === "bust") sfx.boom();
    else if (g.fx === "win") { setWinKey((k) => k + 1); setTimeout(() => sfx.win(true), 200); }
  }, [g.fxSeq, g.fx]);
  useEffect(() => { if (g.phase !== "act") setMode(null); }, [g.phase]);
  useEffect(() => { if (ended) setEndDismissed(false); }, [ended]);

  const teach = useCallback((k) => { if (lessonsSeen.includes(k) || (lesson && lesson.key === k)) return; setLesson({ key: k, ...MR_LESSONS[k] }); }, [lessonsSeen, lesson]);
  useEffect(() => {
    if (!myTurn && g.phase !== "auction") return;
    if (g.phase === "buy") teach("buy");
    else if (g.phase === "auction") teach("auction");
    else if (g.phase === "raise") teach("broke");
    else if (g.phase === "roll") { if (me.jail > 0) teach("jail"); else teach("first"); }
    else if (g.phase === "act") { if (MR_GROUPS.some((_, i) => mrHasGroup(g, 0, i))) teach("group"); if (g.houses.some((h, i) => h > 0 && g.owner[i] === 0)) teach("build"); }
  }, [g.phase, myTurn, me.jail, teach, g.houses, g.owner]);
  useEffect(() => { const last = g.log[g.log.length - 1] || ""; if (/^You pay \$\d+ rent/.test(last)) teach("rent"); }, [g.log, teach]);
  const closeLesson = () => { if (!lesson) return; const seen = lessonsSeen.concat(lesson.key); setLessonsSeen(seen); mrLessonsSave(seen); setLesson(null); };

  useEffect(() => {
    if (ended) return;
    const p = g.players[g.turn];
    const botActs = p.bot && !p.out;
    const botAuction = g.phase === "auction" && g.auction && !g.auction.live.includes(0);
    if (!botActs && !botAuction) return;
    const t = setTimeout(() => setG((prev) => {
      if (prev.phase === "over") return prev;
      const q = prev.players[prev.turn];
      if (prev.phase === "auction" && prev.auction && prev.auction.live.includes(0)) return prev;
      if (!q.bot && prev.phase !== "auction") return prev;
      return mrBotStep(mrClone(prev), rngRef.current);
    }), g.phase === "roll" ? 680 : 430);
    return () => clearTimeout(t);
  }, [g, ended]);

  const act = useCallback((fn) => { setG((prev) => fn(mrClone(prev))); }, []);
  const onSquare = (i) => {
    sfx.click();
    if (buildable.has(i)) {
      if (mode === "build") { act((s) => mrBuild(s, i)); return; }
      if (mode === "sell") { act((s) => mrSellHouse(s, i)); return; }
      if (mode === "mortgage") { act((s) => (g.mortgaged[i] ? mrUnmortgage(s, i) : mrMortgage(s, i))); return; }
      if (mode === "trade") { setSel(i); return; }
    }
    setSel(sel === i ? null : i);
  };

  const newGame = () => { sfx.click(); setSel(null); setMode(null); setG(mrNew(Math.random)); };
  const doCoach = () => {
    sfx.click();
    if (coach.act === "buy") act((s) => mrBuy(s, s.pending.sq));
    else if (coach.act === "decline") act((s) => mrDeclineBuy(s));
    else if (coach.act === "build") act((s) => mrBuild(s, coach.sq));
    else if (coach.act === "bid") act((s) => mrAuctionBid(s, 0));
    else if (coach.act === "pass") act((s) => mrAuctionPass(s, 0));
  };

  /* the detail card for a tapped square — the teaching surface */
  let detail = null;
  if (sel != null) {
    const cell = MR_BOARD[sel], own = g.owner[sel];
    const rows = [];
    if (cell.t === "prop") {
      const grp = MR_GROUPS[cell.g];
      rows.push(["Group", grp.name]);
      rows.push(["List price", "$" + cell.price]);
      rows.push(["Rent (bare / full group)", `$${cell.base} / $${cell.base * 2}`]);
      rows.push(["With 1–4 houses", cell.rents.slice(1, 5).map((r) => "$" + r).join(" · ")]);
      rows.push(["With a hotel", "$" + cell.rents[5]]);
      rows.push(["House cost", "$" + grp.house]);
    } else if (cell.t === "station") { rows.push(["List price", "$" + cell.price]); rows.push(["Rent by depots held", MR_STATION_RENT.slice(1).map((r) => "$" + r).join(" · ")]); }
    else if (cell.t === "utility") { rows.push(["List price", "$" + cell.price]); rows.push(["Rent", "5× the dice with one, 12× with both"]); }
    else if (cell.t === "tax") rows.push(["Cost", "$" + cell.amount]);
    rows.push(["Share of all landings", mrPct(land[sel])]);
    if (cell.price) {
      const per = mrExpectedRent(g, sel, null) * 3;
      rows.push(["Expected rent per round", per > 0 ? "$" + per.toFixed(2) : "—"]);
      const pb = mrPayback(g, sel);
      if (pb) rows.push(["Pays for itself in", pb + " rounds"]);
      rows.push(["Your book value", "$" + mrBotValue(g, 0, sel)]);
    }
    detail = { name: cell.name, own, rows, cell };
  }

  const ghost = (label, onClick, opts = {}) => (
    <button key={label} onClick={onClick} disabled={opts.off} style={{ ...casGhost(), padding: "11px 6px", fontSize: 11, flex: opts.flex || 1, minWidth: 0, whiteSpace: "nowrap", opacity: opts.off ? 0.45 : 1, ...(opts.on ? { border: `1px solid ${CAS.gold}`, color: CAS.gold, background: CAS.goldFaint } : {}) }}>{label}</button>
  );
  const starBtn = coach.act ? (
    <button key="star" onClick={doCoach} style={{ ...casGhost(), padding: "11px 8px", fontSize: 11.5, flex: 1.3, minWidth: 0, whiteSpace: "nowrap", border: `1px solid ${CAS.goldLine}`, color: CAS.gold, background: CAS.goldFaint }}>★ COACH'S PICK</button>
  ) : null;

  let rail;
  if (ended) rail = <button onClick={newGame} style={{ ...casCta(false, true), width: "100%" }}>NEW GAME</button>;
  else if (g.phase === "auction" && g.auction && g.auction.live.includes(0)) {
    const a = g.auction, next = a.bid + Math.max(10, Math.round(a.bid * 0.1 / 10) * 10);
    rail = (
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ textAlign: "center", fontFamily: casMono, fontSize: 11, color: CAS.gold }}>{MR_BOARD[a.sq].name.toUpperCase()} · BID ${a.bid}{a.high != null ? ` · ${g.players[a.high].name.split(" ")[0].toUpperCase()}` : ""}</div>
        <div style={{ display: "flex", gap: 8 }}>
          {ghost("PASS", () => { sfx.click(); act((s) => mrAuctionPass(s, 0)); })}
          {starBtn}
          <button onClick={() => { sfx.click(); act((s) => mrAuctionBid(s, 0)); }} disabled={me.cash < next} style={{ ...casCta(me.cash < next), flex: 1.6, padding: "12px 6px", fontSize: 12.5, whiteSpace: "nowrap" }}>BID ${next}</button>
        </div>
      </div>
    );
  }
  else if (!myTurn) rail = <div style={{ textAlign: "center", fontFamily: casMono, fontSize: 11, color: CAS.dim, padding: 13 }}>{g.players[g.turn].name} is playing…</div>;
  else if (g.phase === "roll") rail = (
    <div style={{ display: "flex", gap: 8 }}>
      {me.jail > 0 && ghost(me.pardons > 0 ? "USE PARDON" : `PAY $${MR_FINE}`, () => { sfx.click(); act((s) => mrPayFine(s)); }, { off: me.pardons === 0 && me.cash < MR_FINE })}
      <button onClick={() => { sfx.click(); act((s) => mrRoll(s, rngRef.current)); }} style={{ ...casCta(false, true), flex: 2, padding: "13px 8px", fontSize: 14 }}>🎲 ROLL</button>
    </div>
  );
  else if (g.phase === "buy") {
    const sq = g.pending.sq;
    rail = (
      <div style={{ display: "flex", gap: 8 }}>
        {ghost("AUCTION IT", () => { sfx.click(); act((s) => mrDeclineBuy(s)); })}
        {starBtn}
        <button onClick={() => { sfx.click(); act((s) => mrBuy(s, sq)); }} disabled={me.cash < mrPrice(sq)} style={{ ...casCta(me.cash < mrPrice(sq)), flex: 1.6, padding: "12px 6px", fontSize: 12.5, whiteSpace: "nowrap" }}>BUY ${mrPrice(sq)}</button>
      </div>
    );
  }
  else if (g.phase === "raise") rail = (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ textAlign: "center", fontFamily: casMono, fontSize: 11, color: "#ffb4ae" }}>YOU OWE ${g.pending.need} · CASH ${me.cash} · SELL OR MORTGAGE ON THE BOARD</div>
      <div style={{ display: "flex", gap: 8 }}>
        {ghost("SELL HOUSES", () => { sfx.click(); setMode(mode === "sell" ? null : "sell"); }, { on: mode === "sell" })}
        {ghost("MORTGAGE", () => { sfx.click(); setMode(mode === "mortgage" ? null : "mortgage"); }, { on: mode === "mortgage" })}
        {me.cash >= g.pending.need
          ? <button onClick={() => { sfx.click(); act((s) => mrResolveRaise(s)); }} style={{ ...casCta(false, true), flex: 1.4, padding: "12px 6px", fontSize: 12 }}>PAY ${g.pending.need}</button>
          : ghost("CONCEDE", () => { sfx.click(); act((s) => mrConcede(s)); })}
      </div>
    </div>
  );
  else if (mode === "trade" && sel != null && g.owner[sel] === 0) rail = (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", fontFamily: casMono, fontSize: 10.5, color: CAS.dim, flexWrap: "wrap" }}>
        <span>SELL {MR_BOARD[sel].name.toUpperCase()} TO</span>
        {g.players.slice(1).filter((p) => !p.out).map((p) => (
          <button key={p.id} onClick={() => { sfx.click(); setTradeTo(p.id); }} style={{ padding: "5px 9px", borderRadius: 8, fontSize: 10.5, cursor: "pointer", border: `1px solid ${tradeTo === p.id ? CAS.gold : CAS.line}`, background: tradeTo === p.id ? CAS.goldFaint : "rgba(255,255,255,0.04)", color: tradeTo === p.id ? CAS.gold : CAS.dim }}>{p.name.split(" ")[0]}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {ghost("−$50", () => { sfx.click(); setTradeCash(Math.max(0, tradeCash - 50)); })}
        <span style={{ fontFamily: casSans, fontSize: 16, fontWeight: 900, color: CAS.gold, minWidth: 70, textAlign: "center" }}>${tradeCash}</span>
        {ghost("+$50", () => { sfx.click(); setTradeCash(tradeCash + 50); })}
        <button onClick={() => { sfx.click(); act((s) => mrOfferTrade(s, sel, tradeCash, tradeTo)); setMode(null); }} style={{ ...casCta(false), flex: 1.5, padding: "12px 6px", fontSize: 12, whiteSpace: "nowrap" }}>OFFER</button>
      </div>
      {ghost("CANCEL", () => { sfx.click(); setMode(null); })}
    </div>
  );
  else rail = (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 6 }}>
        {ghost("BUILD", () => { sfx.click(); if (!MR_GROUPS.some((_, i) => mrHasGroup(g, 0, i))) { say("You can only build on a complete colour group. Trade for the group you're closest to."); return; } setMode(mode === "build" ? null : "build"); say("Tap one of your lit deeds to raise a house."); }, { on: mode === "build" })}
        {ghost("SELL", () => { sfx.click(); setMode(mode === "sell" ? null : "sell"); }, { on: mode === "sell" })}
        {ghost("MORTGAGE", () => { sfx.click(); setMode(mode === "mortgage" ? null : "mortgage"); }, { on: mode === "mortgage" })}
        {ghost("TRADE", () => { sfx.click(); setMode(mode === "trade" ? null : "trade"); say("Tap one of your deeds to offer it."); }, { on: mode === "trade" })}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {ghost(heat ? "HEAT ON" : "HEAT MAP", () => { sfx.click(); setHeat(!heat); }, { on: heat })}
        {starBtn}
        <button onClick={() => { sfx.click(); act((s) => mrEndTurn(s)); }} style={{ ...casCta(false, !coach.act), flex: 1.6, padding: "12px 8px", fontSize: 13, whiteSpace: "nowrap" }}>END TURN</button>
      </div>
    </div>
  );

  const banner = ended ? (g.winner === 0 ? "YOU OWN THE ROW" : `${g.players[g.winner].name.toUpperCase()} OWNS THE ROW`)
    : g.phase === "auction" ? `AUCTION · ${MR_BOARD[g.auction.sq].name.toUpperCase()}`
    : !myTurn ? `${g.players[g.turn].name.split(" ")[0].toUpperCase()} IS PLAYING…`
    : g.phase === "roll" ? (me.jail > 0 ? `IN THE LOCKUP · TURN ${me.jail} OF 3` : "YOUR TURN · ROLL")
    : g.phase === "buy" ? `BUY ${MR_BOARD[g.pending.sq].name.toUpperCase()}?`
    : g.phase === "raise" ? `YOU OWE $${g.pending.need}`
    : mode === "build" ? "TAP A LIT DEED TO BUILD"
    : mode === "sell" ? "TAP A DEED TO SELL A BUILDING"
    : mode === "mortgage" ? "TAP A DEED TO MORTGAGE OR LIFT"
    : mode === "trade" ? "TAP ONE OF YOUR DEEDS TO OFFER"
    : "YOUR TURN · BUILD, TRADE OR END";

  return (
    <div style={{ minHeight: "var(--vh)", background: CAS.bg, color: CAS.text, fontFamily: casSans, position: "relative" }}>
      <style>{CAS_CSS}</style>
      <MrHeader cash={me.cash} onHelp={() => { sfx.click(); setGuideOpen(true); }} />
      <Guide game="moguls" title="MOGUL ROW" steps={MR_GUIDE} open={guideOpen} onClose={() => setGuideOpen(false)} />

      <div style={{ maxWidth: 640, margin: "0 auto", padding: "10px 10px 250px" }}>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          {g.players.map((p) => {
            const cur = g.turn === p.id && !ended;
            return (
              <div key={p.id} style={{ flex: 1, minWidth: 0, borderRadius: 10, padding: "6px 7px", opacity: p.out ? 0.4 : 1, background: cur ? "rgba(245,197,66,0.1)" : CAS.panel, border: `1px solid ${cur ? CAS.gold : CAS.line}`, boxShadow: cur ? `0 0 14px ${CAS.goldFaint}` : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                  <span style={{ fontSize: 11 }}>{p.token}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: cur ? CAS.cream : CAS.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name.split(" ")[0]}</span>
                </div>
                <div style={{ fontSize: 14.5, fontWeight: 900, color: p.id === 0 ? CAS.gold : CAS.text, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{p.out ? "OUT" : "$" + p.cash.toLocaleString()}</div>
                <div style={{ fontFamily: casMono, fontSize: 9, color: CAS.faint }}>{p.out ? "" : `${g.owner.filter((o) => o === p.id).length} deeds${p.jail > 0 ? " · 🔒" : ""}`}</div>
              </div>
            );
          })}
        </div>

        <div style={{ ...feltPanel("30px 4px 6px"), position: "relative" }}>
          <Burst fireKey={winKey} count={22} />
          <Sparkles fireKey={winKey} count={16} />
          <div style={{ position: "absolute", top: 8, left: 10, right: g.dice ? 88 : 10, zIndex: 2, pointerEvents: "none" }}>
            <span key={banner} style={{ display: "inline-block", maxWidth: "100%", fontFamily: casMono, fontSize: 10, letterSpacing: "0.14em", fontWeight: 700, color: myTurn && !ended ? CAS.gold : CAS.dim, background: "rgba(5,7,10,0.72)", border: `1px solid ${myTurn && !ended ? CAS.goldLine : CAS.line}`, borderRadius: 999, padding: "5px 11px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", animation: "casPop 220ms ease both" }}>{banner}</span>
          </div>
          {g.dice && (
            <div key={g.dice.join("") + g.turn + g.round} style={{ position: "absolute", top: 6, right: 8, display: "flex", gap: 4, alignItems: "center", zIndex: 2 }}>
              <MrDie n={g.dice[0]} /><MrDie n={g.dice[1]} />
              <span style={{ fontFamily: casMono, fontSize: 9, color: CAS.cream, background: "rgba(0,0,0,0.5)", borderRadius: 6, padding: "3px 5px" }}>{MR_WAYS[g.dice[0] + g.dice[1]]}/36</span>
            </div>
          )}
          <MrBoard g={g} sel={sel} buildable={buildable} onSquare={onSquare} heat={heat} />
          {nudge && (
            <div key={nudge.key} style={{ position: "absolute", left: 10, right: 10, bottom: 8, zIndex: 3, pointerEvents: "none", display: "flex", justifyContent: "center" }}>
              <span style={{ fontFamily: casSans, fontSize: 12.5, fontWeight: 700, color: CAS.cream, background: "rgba(5,7,10,0.9)", border: `1px solid ${CAS.goldLine}`, borderRadius: 12, padding: "9px 13px", textAlign: "center", lineHeight: 1.45, animation: "casPop 200ms ease both" }}>{nudge.t}</span>
            </div>
          )}
        </div>

        {lesson && (
          <div style={{ marginTop: 10, borderRadius: 14, border: "1px solid rgba(0,230,118,0.35)", background: "linear-gradient(180deg, rgba(0,230,118,0.09), rgba(16,20,26,0.95))", padding: "11px 14px", animation: "casPop 220ms ease both" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontFamily: casMono, fontSize: 9.5, letterSpacing: "0.2em", color: CAS.green, fontWeight: 700 }}>LESSON</span>
              <span style={{ fontSize: 14.5, fontWeight: 900, color: CAS.cream }}>{lesson.h}</span>
              <button onClick={closeLesson} aria-label="Close lesson" style={{ marginLeft: "auto", width: 28, height: 28, borderRadius: 8, border: `1px solid ${CAS.line}`, background: "rgba(255,255,255,0.03)", color: CAS.dim, cursor: "pointer", fontSize: 14, lineHeight: 1 }}>×</button>
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.6, color: CAS.dim, marginTop: 5 }}>{lesson.p}</div>
            {lesson.table && <div style={{ fontFamily: casMono, fontSize: 10.5, color: CAS.faint, marginTop: 6 }}>{lesson.table}</div>}
            <button onClick={() => { sfx.click(); closeLesson(); }} style={{ ...casGhost(), marginTop: 9, padding: "9px 12px", fontSize: 11, border: "1px solid rgba(0,230,118,0.35)", color: CAS.green }}>GOT IT</button>
          </div>
        )}

        {detail && (
          <div style={{ marginTop: 10, borderRadius: 14, border: `1px solid ${CAS.gold}`, background: "linear-gradient(180deg, rgba(245,197,66,0.13), rgba(16,20,26,0.95))", padding: "11px 14px", animation: "casPop 200ms ease both" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {detail.cell.t === "prop" && <span style={{ width: 12, height: 12, borderRadius: 3, background: MR_GROUPS[detail.cell.g].color }} />}
              <span style={{ fontSize: 15.5, fontWeight: 900, color: CAS.cream }}>{detail.name}</span>
              {detail.own != null && <span style={{ fontFamily: casMono, fontSize: 10, color: g.players[detail.own].color }}>{detail.own === 0 ? "YOURS" : g.players[detail.own].name.toUpperCase()}</span>}
              <button onClick={() => { sfx.click(); setSel(null); }} aria-label="Close" style={{ marginLeft: "auto", width: 26, height: 26, borderRadius: 8, border: `1px solid ${CAS.line}`, background: "rgba(255,255,255,0.03)", color: CAS.dim, cursor: "pointer" }}>×</button>
            </div>
            <div style={{ marginTop: 7, display: "grid", gap: 3 }}>
              {detail.rows.map(([k, v]) => (
                <div key={k} style={{ display: "flex", gap: 8, fontSize: 12, lineHeight: 1.5 }}>
                  <span style={{ color: CAS.faint, fontFamily: casMono, fontSize: 10.5, flex: "1 1 auto" }}>{k}</span>
                  <span style={{ color: CAS.cream, fontWeight: 700, fontVariantNumeric: "tabular-nums", textAlign: "right", flex: "0 0 auto" }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={{ marginTop: 10, borderRadius: 14, border: `1px solid ${CAS.goldLine}`, background: "linear-gradient(180deg, rgba(245,197,66,0.08), rgba(16,20,26,0.92))", overflow: "hidden" }}>
          <button onClick={() => { sfx.click(); setCoachOpen(!coachOpen); }} style={{ width: "100%", textAlign: "left", padding: "9px 14px", cursor: "pointer", background: "none", border: "none", color: CAS.gold, fontFamily: casMono, fontSize: 10.5, letterSpacing: "0.16em", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            ★ THE COACH <span style={{ marginLeft: "auto", transform: coachOpen ? "rotate(90deg)" : "none", transition: "transform 160ms ease" }}>›</span>
          </button>
          {coachOpen && (
            <div style={{ padding: "0 14px 12px" }}>
              <div style={{ fontSize: 15.5, fontWeight: 900, color: CAS.cream }}>{coach.title}</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.6, color: CAS.dim, marginTop: 4 }}>{coach.why}</div>
            </div>
          )}
        </div>

        <button onClick={() => { sfx.click(); setLogOpen(!logOpen); }} style={{ width: "100%", textAlign: "left", marginTop: 10, padding: "9px 12px", borderRadius: 12, cursor: "pointer", background: CAS.panel, border: `1px solid ${CAS.line}`, color: CAS.dim, fontFamily: casMono, fontSize: 11, lineHeight: 1.55 }}>
          {(logOpen ? g.log.slice(-30) : g.log.slice(-3)).map((l, i) => <div key={i}>{l}</div>)}
        </button>

        <div style={{ marginTop: 10 }}>
          <MathNote>
            <div><b style={{ color: CAS.cream }}>The landing odds are exact, not folklore.</b> mrChain() builds the Markov chain over every state (square × consecutive doubles, plus the three lockup turns), folds in both card decks at their true frequencies, and power-iterates to the stationary distribution. The percentage on every square is its share of all landings. The Lockup leads at {mrPct(land[MR_JAIL])} — which is exactly why the squares a natural roll past it are the best land on the board.</div>
            <div style={{ marginTop: 6 }}><b style={{ color: CAS.cream }}>Two dice, 36 outcomes.</b> 2→1 way, 7→6 ways, 12→1 way. Doubles roll again; three in a row send you to The Lockup.</div>
            <div style={{ marginTop: 6 }}><b style={{ color: CAS.cream }}>Our rent ladder</b>, stated openly: each deed has a base rent; a full colour group doubles it bare; houses multiply it ×{MR_MULT.slice(1).join(", ×")} (rounded to $5). Depots pay ${MR_STATION_RENT.slice(1).join(" / $")} by how many you hold. Utilities pay 5× the dice with one, 12× with both. Houses cost ${MR_GROUPS.map((x) => x.house).filter((v, i, a) => a.indexOf(v) === i).join(" / $")} by group. Start $ {MR_START_CASH}, PAYDAY ${MR_SALARY}, fine ${MR_FINE}, {MR_HOUSE_POOL} houses and {MR_HOTEL_POOL} hotels in the bank.</div>
            <div style={{ marginTop: 6 }}><b style={{ color: CAS.cream }}>Expected rent per round</b> = landing share × rent × 3 rivals. <b style={{ color: CAS.cream }}>Payback</b> = list price ÷ that. Your book value is list price adjusted for the group you'd complete or block, weighted by the landing share — the same book the three rivals bid and build by.</div>
            <div style={{ marginTop: 6 }}>No wager, no wallet: practice money only. The rivals are fictional.</div>
            <div style={{ marginTop: 6, color: CAS.faint }}>Mogul Row is an original production — its own name, board, street names, card text, characters, prices and rent tables. It is not affiliated with, endorsed by, or connected to any other game or publisher.</div>
            <button onClick={() => { sfx.click(); setLessonsSeen([]); mrLessonsSave([]); setLesson(null); say("Lessons reset."); }} style={{ ...casGhost(), marginTop: 8, padding: "8px 12px", fontSize: 10.5 }}>SHOW THE LESSONS AGAIN</button>
          </MathNote>
        </div>
      </div>

      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 40, padding: "22px 12px calc(10px + env(safe-area-inset-bottom))", background: "linear-gradient(180deg, rgba(10,12,16,0), rgba(10,12,16,0.97) 16px, #0a0c10 30px)" }}>
        <div style={{ maxWidth: 640, margin: "0 auto" }}>{rail}</div>
      </div>

      {ended && !endDismissed && (
        <div onClick={() => setEndDismissed(true)} style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(5,7,10,0.78)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, borderRadius: 20, background: "linear-gradient(180deg, #141922, #0e1218)", border: `1px solid ${CAS.goldLine}`, boxShadow: `0 20px 80px rgba(0,0,0,0.8), 0 0 40px ${CAS.goldFaint}`, padding: "22px 20px 18px", textAlign: "center", animation: "casPop 300ms cubic-bezier(0.2,1.2,0.4,1) both", position: "relative" }}>
            <button onClick={() => setEndDismissed(true)} aria-label="Close" style={{ position: "absolute", top: 10, right: 10, width: 28, height: 28, borderRadius: 8, border: `1px solid ${CAS.line}`, background: "rgba(255,255,255,0.03)", color: CAS.dim, cursor: "pointer" }}>×</button>
            <div style={{ fontSize: 40 }}>{g.winner === 0 ? "🏆" : "🎩"}</div>
            <div style={{ fontFamily: casMono, fontSize: 10, letterSpacing: "0.22em", color: g.winner === 0 ? CAS.gold : CAS.dim, marginTop: 6 }}>{g.winner === 0 ? "YOU OWN THE ROW" : "THE ROW IS SETTLED"}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: CAS.cream, marginTop: 4 }}>{g.players[g.winner].name}</div>
            <div style={{ fontSize: 12.5, color: CAS.dim, marginTop: 8, lineHeight: 1.6 }}>{g.players.map((p) => `${p.name.split(" ")[0]} $${mrNetWorth(g, p.id).toLocaleString()}`).join(" · ")}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={() => setEndDismissed(true)} style={{ ...casGhost(), flex: 1 }}>SEE THE BOARD</button>
              <button onClick={newGame} style={{ ...casCta(false, true), flex: 2 }}>NEW GAME</button>
            </div>
          </div>
        </div>
      )}
      {ended && endDismissed && (
        <button onClick={() => setEndDismissed(false)} style={{ position: "fixed", right: 12, bottom: "calc(86px + env(safe-area-inset-bottom))", zIndex: 41, ...casGhost(), padding: "9px 12px", fontSize: 11, border: `1px solid ${CAS.goldLine}`, color: CAS.gold }}>↩ RESULT</button>
      )}
    </div>
  );
}
