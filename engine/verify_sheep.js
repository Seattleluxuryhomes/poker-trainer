#!/usr/bin/env node
/* Verifies Sheep Rodeo by eval'ing the COMPILED page:
 *   - the dice: SR_WAYS is the exact 2d6 distribution (sums to 36) and the
 *     pips on every token are those ways;
 *   - the board: 19 hexes / 54 corners / 72 sides, the standard tile and
 *     token multisets, no 6 next to an 8, the dust bowl carries no token
 *     and starts with the rustler, 9 trading posts (4×3:1, one 2:1 per good);
 *   - the building law: the distance rule, trails must touch, an opponent's
 *     corral breaks a trail line, the second setup corral pays out once;
 *   - production: pips → cards, ranches pay double, the rustler blocks,
 *     the bank-shortage rule, the 7 (discard half, robbery), goods conserved
 *     against the bank on every action;
 *   - longest trail: a hand-built chain, and an opponent's building cutting it;
 *   - awards, points, and the win check; the deck composition;
 *   - trading: 4:1 default, 3:1 and 2:1 at posts; bots refuse to feed the leader;
 *   - the Coach recommends what the bots' own evaluation picks;
 *   - SEEDED FULL GAMES: four bots play many complete games to a winner,
 *     goods conserved every step, nobody exceeds piece limits.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "sheep.html"), "utf8");
const body = html.split("\n<script>\n").pop().split("\n</script>")[0];

let ok = 0, fail = 0;
const check = (cond, msg) => { if (cond) { ok++; } else { fail++; console.error("  ✗ " + msg); } };

const sandbox = {
  React: { createElement: () => ({}), useState: (v) => [typeof v === "function" ? v() : v, () => {}], useMemo: (f) => f(), useCallback: (f) => f, useEffect: () => {}, useRef: (v) => ({ current: v }) },
  ReactDOM: { createRoot: () => ({ render() {} }) },
  document: { getElementById: () => ({}) },
  localStorage: { getItem: () => null, setItem: () => {} },
  window: undefined, Math, JSON, Set, Map, Number, Array, Object, performance: { now: () => 0 },
  setTimeout: (f) => f(), clearTimeout: () => {}, requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
};
vm.createContext(sandbox);
vm.runInContext(body, sandbox);
const E = vm.runInContext(`({ SR_RES, SR_WAYS, SR_COST, SR_DECK, SR_DECK_MIX, SR_WIN, SR_MAX_TRAILS, SR_MAX_CORRALS, SR_MAX_RANCHES,
  SR_HAND_LIMIT, SR_BANK_EACH, SR_LONGEST_MIN, SR_POSSE_MIN, SR_TILES, SR_TOKENS, SR_PORTS, SR_CARD, SR_META,
  srBoard, srNew, srClone, srCount, srPips, srCornerYield, srExpected, srLegalCorrals, srLegalTrails, srLongestTrail,
  srPlaceCorral, srPlaceTrail, srRoll, srProduce, srDiscard, srMoveRustler, srPickVictim, srBuildTrail, srBuildCorral,
  srBuildRanch, srBuyCard, srPlayCard, srRatio, srBankTrade, srOfferTrade, srEndTurn, srVP, srUpdateAwards,
  srBestCorral, srBestRustlerHex, srBotStep, srCoach, srOwnerAt, srTrailOwner, mulberry32 })`, sandbox);

/* the total of goods in play never changes: bank + every hand = 5 × SR_BANK_EACH */
const totalGoods = (s) => E.SR_RES.reduce((n, r) => n + s.bank[r] + s.players.reduce((k, p) => k + p.res[r], 0), 0);
const conserved = (s) => totalGoods(s) === 5 * E.SR_BANK_EACH;

console.log("verify_sheep: the dice");
{
  let sum = 0; for (const k in E.SR_WAYS) sum += E.SR_WAYS[k];
  check(sum === 36, "SR_WAYS sums to 36 outcomes");
  check(E.SR_WAYS[7] === 6 && E.SR_WAYS[2] === 1 && E.SR_WAYS[12] === 1 && E.SR_WAYS[6] === 5 && E.SR_WAYS[8] === 5, "the classic 2d6 shape");
  let byEnum = {}; for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) byEnum[a + b] = (byEnum[a + b] || 0) + 1;
  check(Object.keys(byEnum).every((k) => byEnum[k] === E.SR_WAYS[k]), "SR_WAYS equals brute-force enumeration of 36 rolls");
  check(E.srPips(8) === 5 && E.srPips(0) === 0, "pips are the ways; the dust bowl has none");
}

console.log("verify_sheep: the board");
{
  let allGood = true, redsOk = true, deserts = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const b = E.srBoard(E.mulberry32(seed));
    if (b.hexes.length !== 19 || b.verts.length !== 54 || b.edges.length !== 72) allGood = false;
    const tiles = b.hexes.map((h) => h.res).sort().join(",");
    if (tiles !== "clay,clay,clay,desert,hay,hay,hay,hay,iron,iron,iron,lumber,lumber,lumber,lumber,wool,wool,wool,wool") allGood = false;
    if (tiles !== E.SR_TILES.slice().sort().join(",")) allGood = false;
    const nums = b.hexes.filter((h) => h.res !== "desert").map((h) => h.num).sort((x, y) => x - y).join(",");
    if (nums !== "2,3,3,4,4,5,5,6,6,8,8,9,9,10,10,11,11,12" || nums !== E.SR_TOKENS.slice().sort((x, y) => x - y).join(",")) allGood = false;
    if (!b.hexes.filter((h) => h.res === "desert").every((h) => h.num === 0)) allGood = false; deserts += b.hexes.filter((h) => h.res === "desert").length;
    // reds: 6/8 never share a side
    for (const e of b.edges) if (e.hexes.length === 2) {
      const [x, y] = e.hexes.map((i) => b.hexes[i].num);
      if ((x === 6 || x === 8) && (y === 6 || y === 8)) redsOk = false;
    }
    if (b.ports.length !== 9) allGood = false;
    const kinds = b.ports.map((p) => p.kind).sort().join(",");
    if (kinds !== "any,any,any,any,clay,hay,iron,lumber,wool" || kinds !== E.SR_PORTS.slice().sort().join(",")) allGood = false;
    if (!b.ports.every((p) => b.edges[p.edge].hexes.length === 1)) allGood = false;
    if (!b.verts.every((v) => v.hexes.length >= 1 && v.hexes.length <= 3 && v.adj.length >= 2 && v.adj.length <= 3)) allGood = false;
    if (!b.edges.every((e) => e.hexes.length >= 1 && e.hexes.length <= 2)) allGood = false;
  }
  check(allGood && deserts === 40, "40 seeds: 19 hexes / 54 corners / 72 sides, the standard tile+token multisets, 9 posts on the coast, sane degrees");
  check(redsOk, "40 seeds: a 6 and an 8 never share a side");
  const s = E.srNew(E.mulberry32(3));
  check(s.board.hexes[s.rustler].res === "desert", "the rustler starts on the dust bowl");
  check(s.deck.length === 25 && s.deck.filter((k) => k === "wrangler").length === 14 && s.deck.filter((k) => k === "ribbon").length === 5 && E.SR_DECK.length === 25, "deck: 25 cards, 14 wranglers, 5 ribbons");
  check(E.SR_RES.every((r) => s.bank[r] === 19) && E.SR_BANK_EACH === 19 && conserved(s), "bank starts 19 of each");
  check(E.SR_HAND_LIMIT === 7 && E.SR_LONGEST_MIN === 5 && E.SR_POSSE_MIN === 3 && E.SR_MAX_TRAILS === 15 && E.SR_MAX_CORRALS === 5 && E.SR_MAX_RANCHES === 4, "the standard limits: hand 7, longest trail 5, posse 3, 15/5/4 pieces");
  check(JSON.stringify(E.SR_COST.trail) === JSON.stringify({ lumber: 1, clay: 1 })
    && JSON.stringify(E.SR_COST.corral) === JSON.stringify({ lumber: 1, clay: 1, hay: 1, wool: 1 })
    && JSON.stringify(E.SR_COST.ranch) === JSON.stringify({ hay: 2, iron: 3 })
    && JSON.stringify(E.SR_COST.card) === JSON.stringify({ wool: 1, hay: 1, iron: 1 }), "the standard build costs, so what you learn transfers to a real table");
  // corner yield: pips equal the sum of ways on adjacent numbered hexes
  let yieldOk = true;
  for (const v of s.board.verts) {
    const y = E.srCornerYield(s, v.id);
    const expect = v.hexes.reduce((n, h) => n + E.srPips(s.board.hexes[h].num), 0);
    if (y.pips !== expect || y.ways > 36) yieldOk = false;
  }
  check(yieldOk, "corner pips = sum of adjacent tokens' ways");
}

/* helpers to script a game by hand */
function fresh(seed) { return E.srNew(E.mulberry32(seed)); }
function setupAll(s, rng) { let guard = 0; while (s.phase.startsWith("setup") && guard++ < 50) { if (s.players[s.turn].bot) E.srBotStep(s, rng); else { const b = E.srBestCorral(s, 0, true); E.srPlaceCorral(s, b.vid); const es = E.srLegalTrails(s, 0, s.setupFrom); E.srPlaceTrail(s, es[0]); } } return s; }

console.log("verify_sheep: the building law");
{
  const s = fresh(5);
  const legal0 = E.srLegalCorrals(s, 0, true);
  check(legal0.length === 54, "an empty board: every corner is legal for the first corral");
  const v = legal0[10];
  E.srPlaceCorral(s, v);
  check(s.players[0].corrals.includes(v) && s.phase === "setupTrail", "first corral placed → its trail is next");
  check(E.srCount(s.players[0].res) === 0, "the FIRST corral pays nothing");
  const legalT = E.srLegalTrails(s, 0, v);
  check(legalT.length === s.board.verts[v].edges.length && legalT.every((e) => s.board.edges[e].a === v || s.board.edges[e].b === v), "setup trail must touch the new corral");
  const before = s.setupIdx;
  E.srPlaceTrail(s, legalT[0]);
  check(s.setupIdx === before + 1 && s.turn === 1 && s.phase === "setupCorral", "trail placed → next rancher settles");
  const legal1 = E.srLegalCorrals(s, 1, true);
  check(!legal1.includes(v) && s.board.verts[v].adj.every((a) => !legal1.includes(a)), "the distance rule: the corner and its neighbours are off-limits");
  // illegal placements are refused
  const snap = JSON.stringify(s);
  E.srPlaceCorral(s, v);
  check(JSON.stringify(s) === snap, "placing on a taken corner is a no-op");
  // second-round corral pays out once
  const t = setupAll(fresh(7), E.mulberry32(99));
  check(t.phase === "roll" && t.turn === 0 && t.setupIdx === 8, "eight placements → roll phase, rancher 0 first");
  let payoutOk = true;
  for (const p of t.players) {
    const second = p.corrals[1];
    const expect = t.board.verts[second].hexes.filter((h) => t.board.hexes[h].res !== "desert").length;
    if (E.srCount(p.res) !== expect) payoutOk = false;
  }
  check(payoutOk && conserved(t), "the second corral pays one card per adjacent producing hex, from the bank");
  check(t.players.every((p) => p.corrals.length === 2 && p.trails.length === 2), "everyone has two corrals and two trails");
}

console.log("verify_sheep: production, the rustler, the 7");
{
  const s = setupAll(fresh(11), E.mulberry32(11));
  // give player 0 a ranch on a known corner, then roll that number
  const p0 = s.players[0];
  const vid = p0.corrals[0];
  const hex = s.board.verts[vid].hexes.map((h) => s.board.hexes[h]).find((h) => h.res !== "desert" && h.id !== s.rustler);
  p0.corrals = p0.corrals.filter((x) => x !== vid); p0.ranches.push(vid);
  for (const r of E.SR_RES) for (const p of s.players) { s.bank[r] += p.res[r]; p.res[r] = 0; }
  const got = E.srProduce(s, hex.num);
  check(got[0] && got[0][hex.res] >= 2, "a ranch collects two on its number");
  check(conserved(s), "production comes out of the bank");
  // the rustler blocks
  for (const r of E.SR_RES) for (const p of s.players) { s.bank[r] += p.res[r]; p.res[r] = 0; }
  s.rustler = hex.id;
  const got2 = E.srProduce(s, hex.num);
  const stillGot = got2[0] && got2[0][hex.res];
  const otherHexSame = s.board.verts.some((v) => v.id !== vid && E.srOwnerAt(s, v.id) && E.srOwnerAt(s, v.id).pid === 0 && v.hexes.some((h) => s.board.hexes[h].num === hex.num && s.board.hexes[h].res === hex.res && h !== hex.id));
  check(!stillGot || otherHexSame, "the rustler stops that hex from paying");
  // bank shortage: two ranchers want more than the bank has → nobody
  const t = setupAll(fresh(13), E.mulberry32(13));
  let shared = null;
  for (const h of t.board.hexes) {
    if (h.res === "desert") continue;
    const owners = new Set(h.verts.map((v) => E.srOwnerAt(t, v)).filter(Boolean).map((o) => o.pid));
    if (owners.size >= 2) { shared = h; break; }
  }
  if (shared) {
    t.bank[shared.res] = 1;
    const hands = t.players.map((p) => p.res[shared.res]);
    E.srProduce(t, shared.num);
    check(t.players.every((p, i) => p.res[shared.res] === hands[i]) && t.bank[shared.res] === 1, "bank short + two claimants → nobody collects");
  } else check(true, "(no shared hex on this seed — shortage case skipped)");
  // the 7: discard half above seven, then the rustler must move
  const u = setupAll(fresh(17), E.mulberry32(17));
  u.players[1].res = { wool: 3, lumber: 3, clay: 3, hay: 0, iron: 0 };     // 9 cards → drops 4
  u.players[0].res = { wool: 2, lumber: 2, clay: 2, hay: 2, iron: 1 };     // 9 cards → must pick 4
  u.players[2].res = { wool: 2, lumber: 2, clay: 2, hay: 1, iron: 0 };     // 7 cards → exactly the limit, keeps all
  for (const r of E.SR_RES) u.bank[r] = E.SR_BANK_EACH - u.players.reduce((k, p) => k + p.res[r], 0);
  const rng7 = (() => { const seq = [3 / 6, 3 / 6]; let i = 0; return () => (i < seq.length ? seq[i++] : 0.5); })();  // 4+4? no: floor(0.5*6)+1 = 4 → 4+4=8. use 3/6→4; need 7: 1/6*...
  // force a 7 with dice (3,4): rng values 2/6 and 3/6
  const rngSeven = (() => { const seq = [2 / 6, 3 / 6]; let i = 0; return () => (i < seq.length ? seq[i++] : 0.5); })();
  E.srRoll(u, rngSeven);
  check(u.dice[0] + u.dice[1] === 7, "scripted dice roll a 7");
  check(E.srCount(u.players[1].res) === 5, "a bot over the limit discards half (9 → 5)");
  check(E.srCount(u.players[2].res) === 7, "exactly seven cards is safe — the limit is over seven");
  check(u.phase === "discard" && u.discardNeed === 4, "the human over the limit is asked to discard 4");
  const snap = JSON.stringify(u);
  E.srDiscard(u, 0, { wool: 1 });
  check(JSON.stringify(u) === snap, "a short discard is refused");
  E.srDiscard(u, 0, { wool: 2, lumber: 2 });
  check(E.srCount(u.players[0].res) === 5 && u.phase === "rustler" && conserved(u), "the right discard goes to the bank and hands the turn to the rustler");
  const before = u.rustler;
  E.srMoveRustler(u, before, null, E.mulberry32(1));
  check(u.rustler === before && u.phase === "rustler", "the rustler must actually move");
  const h = E.srBestRustlerHex(u, 0);
  const victims = new Set();
  for (const v of u.board.hexes[h].verts) { const o = E.srOwnerAt(u, v); if (o && o.pid !== 0 && E.srCount(u.players[o.pid].res)) victims.add(o.pid); }
  const handsBefore = u.players.map((p) => E.srCount(p.res));
  E.srMoveRustler(u, h, null, E.mulberry32(2));
  if (victims.size > 1) {
    check(u.phase === "steal" && u.stealFrom.length === victims.size, "several ranchers on the hex → the human picks whom to rob");
    E.srPickVictim(u, u.stealFrom[0], E.mulberry32(3));
  } else check(true, "(single victim — auto-robbed)");
  const handsAfter = u.players.map((p) => E.srCount(p.res));
  check(u.rustler === h && u.phase === "main", "the rustler moved and play resumes");
  check(victims.size === 0 || (handsAfter[0] === handsBefore[0] + 1 && handsAfter.reduce((a, b) => a + b) === handsBefore.reduce((a, b) => a + b)), "robbery moves exactly one card, hand to hand");
  check(conserved(u), "goods conserved through the 7");
  void rng7;
}

console.log("verify_sheep: building, longest trail, awards, points");
{
  const s = setupAll(fresh(23), E.mulberry32(23));
  s.phase = "main"; s.turn = 0;
  const p = s.players[0];
  p.res = { wool: 0, lumber: 0, clay: 0, hay: 0, iron: 0 };
  for (const r of E.SR_RES) s.bank[r] = E.SR_BANK_EACH - s.players.reduce((k, q) => k + q.res[r], 0);
  const legal = E.srLegalTrails(s, 0);
  const snap = JSON.stringify(s);
  E.srBuildTrail(s, legal[0]);
  check(JSON.stringify(s) === snap, "no lumber+clay → no trail");
  p.res.lumber = 1; p.res.clay = 1; s.bank.lumber--; s.bank.clay--;
  E.srBuildTrail(s, legal[0]);
  check(p.trails.length === 3 && p.res.lumber === 0 && p.res.clay === 0 && conserved(s), "a trail costs exactly lumber + clay");
  // a corral needs a touching trail; the distance rule holds in play too
  p.res = { wool: 1, lumber: 1, clay: 1, hay: 1, iron: 0 };
  for (const r of E.SR_RES) s.bank[r] = E.SR_BANK_EACH - s.players.reduce((k, q) => k + q.res[r], 0);
  const lc = E.srLegalCorrals(s, 0, false);
  check(lc.every((v) => s.board.verts[v].edges.some((e) => E.srTrailOwner(s, e) === 0)) && lc.every((v) => !s.board.verts[v].adj.some((a) => E.srOwnerAt(s, a))), "in play a corral needs your trail and two sides of space");
  const far = s.board.verts.find((v) => !E.srOwnerAt(s, v.id) && !v.adj.some((a) => E.srOwnerAt(s, a)) && !v.edges.some((e) => E.srTrailOwner(s, e) === 0));
  const snap2 = JSON.stringify(s);
  E.srBuildCorral(s, far.id);
  check(JSON.stringify(s) === snap2, "a corral off your trail is refused");
  if (lc.length) { E.srBuildCorral(s, lc[0]); check(p.corrals.length === 3 && E.srCount(p.res) === 0 && conserved(s), "a corral costs wool+lumber+clay+hay"); }
  else check(true, "(no legal corral on this seed)");
  // a ranch upgrades a corral
  p.res = { wool: 0, lumber: 0, clay: 0, hay: 2, iron: 3 };
  for (const r of E.SR_RES) s.bank[r] = E.SR_BANK_EACH - s.players.reduce((k, q) => k + q.res[r], 0);
  const c0 = p.corrals[0];
  E.srBuildRanch(s, c0);
  check(p.ranches.includes(c0) && !p.corrals.includes(c0) && E.srCount(p.res) === 0, "a ranch replaces the corral for 2 hay + 3 iron");
  check(E.srVP(s, 0) === p.corrals.length + 2 * p.ranches.length, "points: corrals 1, ranches 2");
  // longest trail: build a straight chain on a clean board
  const t = fresh(29);
  const q = t.players[0];
  // walk a path of 6 sides from any corner
  let v = 0; const seen = new Set([0]), chain = [];
  for (let i = 0; i < 6; i++) {                                       // a simple path: never revisit a corner
    const e = t.board.verts[v].edges.find((x) => { const ed = t.board.edges[x]; return !seen.has(ed.a === v ? ed.b : ed.a); });
    chain.push(e);
    const ed = t.board.edges[e]; v = ed.a === v ? ed.b : ed.a; seen.add(v);
  }
  q.trails = chain.slice(0, 4);
  check(E.srLongestTrail(t, 0) === 4, "four connected sides → longest 4");
  t.turn = 0; E.srUpdateAwards(t);
  check(t.longest.pid == null, "four is not enough for the Longest Trail (it takes five)");
  q.trails = chain.slice();
  check(E.srLongestTrail(t, 0) === 6, "six connected sides → longest 6");
  E.srUpdateAwards(t);
  check(t.longest.pid === 0 && t.longest.len === 6 && E.srVP(t, 0) === 2, "Longest Trail awarded from 5, worth 2 points");
  // an opponent's corral in the middle cuts it
  const mid = t.board.edges[chain[2]]; const cut = (mid.a === t.board.edges[chain[3]].a || mid.a === t.board.edges[chain[3]].b) ? mid.a : mid.b;
  t.players[1].corrals.push(cut);
  check(E.srLongestTrail(t, 0) === 3, "an opponent's building splits a 6-chain into 3+3");
  E.srUpdateAwards(t);
  check(t.longest.pid == null, "…a 6-chain cut to 3+3 loses the Longest Trail (standard rule: below 5 it goes away)");
  // largest posse
  t.players[1].corrals = [];
  t.players[0].wranglers = 3; E.srUpdateAwards(t);
  check(t.posse.pid === 0 && E.srVP(t, 0) === 4, "three wranglers → Largest Posse, 2 points");
  t.turn = 1; t.players[1].wranglers = 3; E.srUpdateAwards(t);
  check(t.posse.pid === 0, "a tie does not take the posse");
  t.players[1].wranglers = 4; E.srUpdateAwards(t);
  check(t.posse.pid === 1 && E.srVP(t, 0) === 2, "four beats three: the posse moves");
  // the win
  t.turn = 0; t.players[0].ribbons = 8; t.phase = "main";
  t.players[0].res = { wool: 1, lumber: 1, clay: 1, hay: 1, iron: 0 };
  const spot = E.srLegalCorrals(t, 0, false)[0];
  E.srBuildCorral(t, spot);
  check(t.phase === "over" && t.winner === 0 && E.srVP(t, 0) >= 10, "reaching 10 on your own turn ends the game");
}

console.log("verify_sheep: cards and trading");
{
  const s = setupAll(fresh(31), E.mulberry32(31));
  s.phase = "main"; s.turn = 0;
  const p = s.players[0];
  p.res = { wool: 1, lumber: 0, clay: 0, hay: 1, iron: 1 };
  for (const r of E.SR_RES) s.bank[r] = E.SR_BANK_EACH - s.players.reduce((k, q) => k + q.res[r], 0);
  s.deck = ["wrangler"];
  E.srBuyCard(s);
  check(p.devNew.includes("wrangler") && E.srCount(p.res) === 0 && s.deck.length === 0, "a card costs wool+hay+iron and arrives face-down for this turn");
  const snap = JSON.stringify(s);
  E.srPlayCard(s, "wrangler");
  check(JSON.stringify(s) === snap, "a card bought this turn cannot be played");
  E.srEndTurn(s);
  check(s.turn === 1 && s.phase === "roll" && p.dev.includes("wrangler") && p.devNew.length === 0, "end turn: cards mature, next rancher rolls");
  s.turn = 0; s.phase = "main";
  E.srPlayCard(s, "wrangler");
  check(p.wranglers === 1 && s.phase === "rustler" && s.devPlayed, "a wrangler moves the rustler and counts toward the posse");
  s.phase = "main";
  p.dev.push("wrangler");
  E.srPlayCard(s, "wrangler");
  check(p.wranglers === 1, "one card per turn");
  s.devPlayed = false;
  p.dev = ["bumper"];
  E.srPlayCard(s, "bumper", ["iron", "iron"]);
  check(p.res.iron === 2 && conserved(s), "bumper crop: two goods from the bank");
  s.devPlayed = false; p.dev = ["roundup"];
  s.players[1].res.wool += 3; s.players[2].res.wool += 2; s.bank.wool -= 5;
  const myWool = p.res.wool, theirs = s.players.slice(1).reduce((k, q) => k + q.res.wool, 0);
  E.srPlayCard(s, "roundup", "wool");
  check(theirs >= 5 && p.res.wool === myWool + theirs && s.players.slice(1).every((q) => q.res.wool === 0) && conserved(s), "roundup takes every rancher's wool");
  s.devPlayed = false; p.dev = ["trails"];
  E.srPlayCard(s, "trails");
  check(s.trailsFree === 2, "trail blazing grants two free trails");
  const n0 = p.trails.length, lumber0 = p.res.lumber;
  E.srBuildTrail(s, E.srLegalTrails(s, 0)[0]);
  check(p.trails.length === n0 + 1 && p.res.lumber === lumber0 && s.trailsFree === 1, "a free trail costs nothing");
  // ratios
  const t = fresh(37);
  const q = t.players[0];
  check(E.srRatio(t, 0, "iron") === 4 && E.srRatio(t, 0, "wool") === 4, "no post: 4:1 on everything");
  const anyPort = t.board.ports.find((pt) => pt.kind === "any"), woolPort = t.board.ports.find((pt) => pt.kind === "wool");
  q.corrals = [t.board.edges[anyPort.edge].a];
  check(E.srRatio(t, 0, "wool") === 3 && E.srRatio(t, 0, "iron") === 3, "a 3:1 post applies to every good");
  q.corrals.push(t.board.edges[woolPort.edge].a);
  check(E.srRatio(t, 0, "wool") === 2 && E.srRatio(t, 0, "iron") === 3, "the wool post makes wool 2:1 and leaves the rest 3:1");
  t.phase = "main"; t.turn = 0; q.res = { wool: 2, lumber: 0, clay: 0, hay: 0, iron: 0 }; t.bank.wool -= 2;
  E.srBankTrade(t, "wool", "iron");
  check(q.res.wool === 0 && q.res.iron === 1 && conserved(t), "a 2:1 trade at the wool post");
  const snapT = JSON.stringify(t);
  E.srBankTrade(t, "wool", "iron");
  check(JSON.stringify(t) === snapT, "no wool left → no trade");
  // bots refuse to feed a rancher on the brink
  const u = setupAll(fresh(41), E.mulberry32(41));
  u.phase = "main"; u.turn = 0;
  u.players[0].ribbons = 8;
  for (const b of u.players.slice(1)) b.res = { wool: 5, lumber: 5, clay: 5, hay: 5, iron: 5 };
  u.players[0].res = { wool: 1, lumber: 0, clay: 0, hay: 0, iron: 0 };
  const before = JSON.stringify(u.players.map((p) => p.res));
  E.srOfferTrade(u, "wool", "clay");
  check(JSON.stringify(u.players.map((p) => p.res)) === before, "nobody trades with a rancher at 8 points");
  u.players[0].ribbons = 0;
  // a bot one clay short of a corral, holding spare wool? construct: bot needs wool, has spare clay
  const b1 = u.players[1];
  b1.res = { wool: 0, lumber: 1, clay: 3, hay: 1, iron: 0 };
  for (const b of u.players.slice(2)) b.res = { wool: 0, lumber: 0, clay: 0, hay: 0, iron: 0 };
  const canCorral = E.srLegalCorrals(u, 1, false).length > 0;
  E.srOfferTrade(u, "wool", "clay");
  if (canCorral) check(u.players[0].res.clay === 1 && b1.res.wool === 1 && b1.res.clay === 2, "a bot takes a 1:1 that completes its own corral out of a surplus");
  else check(true, "(bot has no corral spot on this seed — acceptance case skipped)");
}

console.log("verify_sheep: the Coach speaks the bots' mind");
{
  const s = fresh(43);
  const c = E.srCoach(s);
  const best = E.srBestCorral(s, 0, true);
  check(c.target && c.target.kind === "vert" && c.target.id === best.vid, "setup: the Coach's ring is srBestCorral's pick");
  check(/pips/.test(c.title) && /36 rolls/.test(c.why), "…and it explains in pips and ways-of-36");
  const y = E.srCornerYield(s, best.vid);
  check(c.title.includes(String(y.pips)) && c.why.includes(`${y.ways} of the 36`), "the numbers it quotes are the corner's actual pips and ways");
  const t = setupAll(fresh(47), E.mulberry32(47));
  t.phase = "rustler"; t.turn = 0;
  const c2 = E.srCoach(t);
  check(c2.target && c2.target.kind === "hex" && c2.target.id === E.srBestRustlerHex(t, 0), "rustler: the Coach points where the bots would park it");
  const h = t.board.hexes[c2.target.id];
  check(!h.verts.some((v) => { const o = E.srOwnerAt(t, v); return o && o.pid === 0; }) || t.board.hexes.every((x) => x.verts.some((v) => { const o = E.srOwnerAt(t, v); return o && o.pid === 0; })), "…and never on your own corner while another hex is available");
  t.phase = "main";
  t.players[0].res = { wool: 0, lumber: 0, clay: 0, hay: 2, iron: 3 };
  const c3 = E.srCoach(t);
  check(/ranch/i.test(c3.title) && c3.target && t.players[0].corrals.includes(c3.target.id), "with 2 hay + 3 iron the Coach says ranch, on one of your corrals");
  const ex = E.srExpected(t, 0);
  const manual = {}; for (const r of E.SR_RES) manual[r] = 0;
  for (const v of t.players[0].corrals) for (const hid of t.board.verts[v].hexes) { const hx = t.board.hexes[hid]; if (hx.res !== "desert" && hid !== t.rustler) manual[hx.res] += E.srPips(hx.num) / 36; }
  check(E.SR_RES.every((r) => Math.abs(ex[r] - manual[r]) < 1e-12), "expected pickup = Σ pips/36 over your corners");
}

console.log("verify_sheep: seeded full games");
{
  let games = 0, wins = [0, 0, 0, 0], maxRounds = 0, broke = null;
  for (let seed = 100; seed < 130; seed++) {
    const rng = E.mulberry32(seed);
    const s = E.srNew(rng);
    for (const p of s.players) p.bot = true;                          // four bots
    let steps = 0;
    while (s.phase !== "over" && steps++ < 20000) {
      E.srBotStep(s, rng);
      if (!conserved(s)) { broke = `seed ${seed}: goods not conserved at step ${steps}`; break; }
      if (s.players.some((p) => p.trails.length > E.SR_MAX_TRAILS || p.corrals.length > E.SR_MAX_CORRALS || p.ranches.length > E.SR_MAX_RANCHES)) { broke = `seed ${seed}: piece limit exceeded`; break; }
      if (s.players.some((p) => E.SR_RES.some((r) => p.res[r] < 0)) || E.SR_RES.some((r) => s.bank[r] < 0)) { broke = `seed ${seed}: negative goods`; break; }
      if (s.phase === "discard") { broke = `seed ${seed}: a bot game stuck in discard`; break; }
    }
    if (broke) break;
    if (s.phase !== "over") { broke = `seed ${seed}: no winner after ${steps} steps (round ${s.round})`; break; }
    games++; wins[s.winner]++; maxRounds = Math.max(maxRounds, s.round);
    if (E.srVP(s, s.winner) < 10) { broke = `seed ${seed}: winner has ${E.srVP(s, s.winner)} points`; break; }
    if (s.players.some((p, i) => i !== s.winner && E.srVP(s, i) >= 10)) { broke = `seed ${seed}: a non-winner also has 10+`; break; }
  }
  check(!broke, broke || "");
  check(games === 30, `30 seeded four-bot games all reach a winner (got ${games}, longest ${maxRounds} rounds)`);
  check(wins.filter((w) => w > 0).length >= 2, `more than one seat can win (wins by seat: ${wins.join("/")})`);
  // the same seed replays identically
  const a = E.srNew(E.mulberry32(777)), b = E.srNew(E.mulberry32(777));
  check(JSON.stringify(a) === JSON.stringify(b), "a seed reproduces the board and the deck");
}

console.log("verify_sheep: the teaching layer");
{
  const kinds = Object.keys(E.SR_CARD);
  check(kinds.length === 5 && kinds.every((k) => E.SR_CARD[k].name && E.SR_CARD[k].text && E.SR_CARD[k].icon), "every rodeo card has a name, an icon and plain-language text");
  check(E.SR_RES.every((r) => E.SR_META[r] && E.SR_META[r].name && E.SR_META[r].icon), "every good has a name and an icon");
  const s2 = fresh(51);
  const c = E.srCoach(s2);
  check(c.title && c.why && c.why.length > 40, "the Coach always gives a reason, not just a verdict");
  s2.turn = 1;
  const c2 = E.srCoach(s2);
  check(/is up/.test(c2.title) && /per roll/.test(c2.why), "on another rancher's turn the Coach still teaches (your rate per roll)");
}

console.log(fail === 0 ? `✓ verify_sheep: all ${ok} checks passed` : `✗ verify_sheep: ${fail} of ${ok + fail} checks FAILED`);
process.exit(fail === 0 ? 0 : 1);
