import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";

/* ============================================================
   SHEEP RODEO (sheep.html) — a settle-the-range board game with
   a coach in the box. Nineteen hexes of rangeland, five goods
   (wool, lumber, clay, hay, iron), two dice, three fictional
   ranchers across the table, and a Coach that prints WHY every
   spot is worth what it's worth: the pips on every number are
   the exact ways-out-of-36 that number rolls, and the Coach's
   advice is the very same evaluation the bots play by — shown to
   you with its reasoning, so a lesson never comes from a "trust
   me." Original rules text and art; the mechanics are the
   classic hex-and-dice settlement family.

   No wager anywhere: the casino wallet is deliberately NOT wired
   here — this is the study table for strategy, not a bet.

   The game is pure top-level functions (srBoard … srBotStep,
   srCoach) over a JSON-plain state so engine/verify_sheep.js can
   drive whole seeded games and re-prove the law. The React page
   at the bottom only renders and dispatches.
   ============================================================ */

/* ---- goods, costs, the dice, the deck ---- */
const SR_RES = ["wool", "lumber", "clay", "hay", "iron"];
const SR_META = {
  wool:   { name: "Wool",   icon: "🐑", fill: "#86c06a", ink: "#153015" },
  lumber: { name: "Lumber", icon: "🌲", fill: "#2f6b3a", ink: "#eaf5e6" },
  clay:   { name: "Clay",   icon: "🧱", fill: "#b45a3c", ink: "#fff1e8" },
  hay:    { name: "Hay",    icon: "🌾", fill: "#d9b44a", ink: "#3a2d08" },
  iron:   { name: "Iron",   icon: "⛏️", fill: "#6f7886", ink: "#f2f4f8" },
  desert: { name: "Dust Bowl", icon: "🌵", fill: "#c4ae83", ink: "#4a3d22" },
};
const SR_COST = {
  trail:  { lumber: 1, clay: 1 },
  corral: { lumber: 1, clay: 1, hay: 1, wool: 1 },
  ranch:  { hay: 2, iron: 3 },
  card:   { wool: 1, hay: 1, iron: 1 },
};
const SR_BUILD_NAME = { trail: "Trail", corral: "Corral", ranch: "Ranch", card: "Rodeo card" };
/* ways each total can roll on two dice — the whole distribution, 36 outcomes */
const SR_WAYS = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 7: 6, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
const SR_TOKENS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
const SR_TILES = ["wool", "wool", "wool", "wool", "lumber", "lumber", "lumber", "lumber",
  "hay", "hay", "hay", "hay", "clay", "clay", "clay", "iron", "iron", "iron", "desert"];
/* the rodeo deck: 14 wranglers, 5 blue ribbons, 2 trail-blazing, 2 bumper crop, 2 roundup */
const SR_DECK = [].concat(
  Array(14).fill("wrangler"), Array(5).fill("ribbon"),
  Array(2).fill("trails"), Array(2).fill("bumper"), Array(2).fill("roundup"));
const SR_CARD = {
  wrangler: { name: "Wrangler", icon: "🤠", text: "Move the rustler and take one card from a rancher there. Three played earns the Largest Posse (2 points)." },
  ribbon:   { name: "Blue Ribbon", icon: "🎀", text: "One victory point. Counts the moment you hold it." },
  trails:   { name: "Trail Blazing", icon: "🛤️", text: "Build two trails for free." },
  bumper:   { name: "Bumper Crop", icon: "🌱", text: "Take any two goods from the bank." },
  roundup:  { name: "Roundup", icon: "🪢", text: "Name one good; every other rancher hands you all of theirs." },
};
const SR_WIN = 10;
const SR_MAX_TRAILS = 15, SR_MAX_CORRALS = 5, SR_MAX_RANCHES = 4;
const SR_HAND_LIMIT = 7;
const SR_BANK_EACH = 19;
const SR_PLAYERS = [
  { name: "You",           color: "#f5c542", bot: false },
  { name: "Dusty Vale",    color: "#4fa3ff", bot: true },
  { name: "Marisol Quade", color: "#ff7a59", bot: true },
  { name: "Buck Tanner",   color: "#b18cff", bot: true },
];

function srShuffle(a, rng) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const srPips = (num) => (num ? SR_WAYS[num] : 0);
const srClone = (s) => JSON.parse(JSON.stringify(s));
const srCount = (res) => SR_RES.reduce((n, r) => n + (res[r] || 0), 0);

/* ---- the board: 19 hexes, 54 corners, 72 sides, 9 trading posts ----
 * Axial coords, pointy-top, radius 1. Corners are de-duplicated by rounded
 * position so neighbouring hexes share them; sides are corner pairs. */
const SR_S3 = Math.sqrt(3);
function srRedsTouch(coords, numOf) {
  const key = (q, r) => q + "," + r;
  const idx = new Map(coords.map(([q, r], i) => [key(q, r), i]));
  const D = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
  for (let i = 0; i < coords.length; i++) {
    if (numOf[i] !== 6 && numOf[i] !== 8) continue;
    for (const [dq, dr] of D) {
      const j = idx.get(key(coords[i][0] + dq, coords[i][1] + dr));
      if (j != null && (numOf[j] === 6 || numOf[j] === 8)) return true;
    }
  }
  return false;
}
function srBoard(rng) {
  const coords = [];
  for (let q = -2; q <= 2; q++) for (let r = -2; r <= 2; r++) if (Math.abs(q + r) <= 2) coords.push([q, r]);
  const tiles = srShuffle(SR_TILES.slice(), rng);
  let numOf = null;
  for (let attempt = 0; attempt < 2000; attempt++) {
    const nums = srShuffle(SR_TOKENS.slice(), rng);
    let k = 0;
    const cand = tiles.map((t) => (t === "desert" ? 0 : nums[k++]));
    if (!srRedsTouch(coords, cand)) { numOf = cand; break; }
    numOf = cand;
  }
  const hexes = [], verts = [], edges = [];
  const vKey = new Map(), eKey = new Map();
  const vertAt = (x, y) => {
    const key = Math.round(x * 100) + "," + Math.round(y * 100);
    if (!vKey.has(key)) { vKey.set(key, verts.length); verts.push({ id: verts.length, x, y, hexes: [], adj: [], edges: [], port: null }); }
    return vKey.get(key);
  };
  coords.forEach(([q, r], i) => {
    const cx = SR_S3 * (q + r / 2), cy = 1.5 * r;
    const h = { id: i, q, r, res: tiles[i], num: numOf[i], x: cx, y: cy, verts: [] };
    for (let k = 0; k < 6; k++) {
      const a = ((60 * k - 30) * Math.PI) / 180;
      h.verts.push(vertAt(cx + Math.cos(a), cy + Math.sin(a)));
    }
    for (let k = 0; k < 6; k++) {
      const a = h.verts[k], b = h.verts[(k + 1) % 6];
      const key = Math.min(a, b) + "-" + Math.max(a, b);
      if (!eKey.has(key)) {
        eKey.set(key, edges.length);
        edges.push({ id: edges.length, a: Math.min(a, b), b: Math.max(a, b), hexes: [] });
        verts[a].adj.push(b); verts[b].adj.push(a);
        verts[a].edges.push(eKey.get(key)); verts[b].edges.push(eKey.get(key));
      }
      edges[eKey.get(key)].hexes.push(i);
    }
    for (const v of h.verts) verts[v].hexes.push(i);
    hexes.push(h);
  });
  /* trading posts: nine coastal sides, evenly spaced around the rim */
  const coast = edges.filter((e) => e.hexes.length === 1)
    .map((e) => ({ e, ang: Math.atan2((verts[e.a].y + verts[e.b].y) / 2, (verts[e.a].x + verts[e.b].x) / 2) }))
    .sort((p, q) => p.ang - q.ang).map((p) => p.e);
  const kinds = srShuffle(["any", "any", "any", "any", "wool", "lumber", "clay", "hay", "iron"], rng);
  const ports = [];
  for (let i = 0; i < 9; i++) {
    const e = coast[Math.round((i * coast.length) / 9) % coast.length];
    const port = { edge: e.id, kind: kinds[i], ratio: kinds[i] === "any" ? 3 : 2 };
    ports.push(port);
    verts[e.a].port = port; verts[e.b].port = port;
  }
  return { hexes, verts, edges, ports };
}

/* ---- the state ---- */
function srNew(rng) {
  const board = srBoard(rng);
  const bank = {}; for (const r of SR_RES) bank[r] = SR_BANK_EACH;
  const players = SR_PLAYERS.map((p, id) => ({
    id, name: p.name, color: p.color, bot: p.bot,
    res: { wool: 0, lumber: 0, clay: 0, hay: 0, iron: 0 },
    trails: [], corrals: [], ranches: [], dev: [], devNew: [], wranglers: 0, ribbons: 0,
  }));
  const desert = board.hexes.find((h) => h.res === "desert");
  return {
    board, bank, players, deck: srShuffle(SR_DECK.slice(), rng),
    rustler: desert ? desert.id : 0,
    setupOrder: [0, 1, 2, 3, 3, 2, 1, 0], setupIdx: 0, setupFrom: null,
    turn: 0, phase: "setupCorral", dice: null, round: 1,
    devPlayed: false, trailsFree: 0, discardNeed: 0, stealFrom: null,
    longest: { pid: null, len: 0 }, posse: { pid: null, n: 0 },
    winner: null, log: ["A new range. Place your first corral."], fx: null, fxSeq: 0,
  };
}
/* "You build" / "Dusty Vale builds" — the log speaks to the human in the second person */
function srWho(p, verb) { return p.bot ? `${p.name} ${verb}` : `You ${verb === "is" ? "are" : verb.replace(/s$/, "")}`; }
function srLog(s, line) { s.log.push(line); if (s.log.length > 80) s.log.shift(); }
function srFx(s, fx) { s.fx = fx; s.fxSeq++; }

/* ---- lookups ---- */
function srOwnerAt(s, vid) {
  for (const p of s.players) {
    if (p.corrals.includes(vid)) return { pid: p.id, kind: "corral" };
    if (p.ranches.includes(vid)) return { pid: p.id, kind: "ranch" };
  }
  return null;
}
function srTrailOwner(s, eid) {
  for (const p of s.players) if (p.trails.includes(eid)) return p.id;
  return null;
}
function srCanAfford(p, cost) { return Object.keys(cost).every((r) => p.res[r] >= cost[r]); }
function srPay(s, p, cost) { for (const r in cost) { p.res[r] -= cost[r]; s.bank[r] += cost[r]; } }
function srGive(s, p, r, n) { const k = Math.min(n, s.bank[r]); p.res[r] += k; s.bank[r] -= k; return k; }

function srVP(s, pid) {
  const p = s.players[pid];
  return p.corrals.length + 2 * p.ranches.length + p.ribbons +
    (s.longest.pid === pid ? 2 : 0) + (s.posse.pid === pid ? 2 : 0);
}
/* a corner's worth: pips per good and the chance SOMETHING pays on a roll */
function srCornerYield(s, vid) {
  const v = s.board.verts[vid];
  const perRes = {}, nums = new Set();
  let pips = 0;
  for (const hid of v.hexes) {
    const h = s.board.hexes[hid];
    if (h.res === "desert") continue;
    perRes[h.res] = (perRes[h.res] || 0) + srPips(h.num);
    pips += srPips(h.num);
    nums.add(h.num);
  }
  let ways = 0; for (const n of nums) ways += SR_WAYS[n];
  return { pips, perRes, ways, port: v.port };
}
/* per-turn expected pickup for a player, by good (exact: pips/36 × buildings) */
function srExpected(s, pid) {
  const p = s.players[pid], ex = {};
  for (const r of SR_RES) ex[r] = 0;
  const add = (vid, mult) => {
    for (const hid of s.board.verts[vid].hexes) {
      const h = s.board.hexes[hid];
      if (h.res === "desert" || hid === s.rustler) continue;
      ex[h.res] += (mult * srPips(h.num)) / 36;
    }
  };
  for (const v of p.corrals) add(v, 1);
  for (const v of p.ranches) add(v, 2);
  return ex;
}

/* ---- the building law ---- */
function srLegalCorrals(s, pid, setup) {
  const out = [];
  for (const v of s.board.verts) {
    if (srOwnerAt(s, v.id)) continue;
    if (v.adj.some((a) => srOwnerAt(s, a))) continue;              // the distance rule
    if (!setup && !v.edges.some((e) => srTrailOwner(s, e) === pid)) continue;
    out.push(v.id);
  }
  return out;
}
function srLegalTrails(s, pid, fromVid) {
  const out = [];
  for (const e of s.board.edges) {
    if (srTrailOwner(s, e.id) != null) continue;
    if (fromVid != null) { if (e.a === fromVid || e.b === fromVid) out.push(e.id); continue; }
    let ok = false;
    for (const vid of [e.a, e.b]) {
      const o = srOwnerAt(s, vid);
      if (o && o.pid === pid) { ok = true; break; }
      if (o && o.pid !== pid) continue;                            // an opponent's building breaks the line
      if (s.board.verts[vid].edges.some((x) => x !== e.id && srTrailOwner(s, x) === pid)) { ok = true; break; }
    }
    if (ok) out.push(e.id);
  }
  return out;
}
/* longest trail: the longest walk over a rancher's own sides, no side twice,
 * never continuing THROUGH a corner another rancher has built on */
function srLongestTrail(s, pid) {
  const p = s.players[pid];
  const mine = new Set(p.trails);
  if (!mine.size) return 0;
  const blocked = (vid) => { const o = srOwnerAt(s, vid); return o && o.pid !== pid; };
  const used = new Set();
  const dfs = (vid) => {
    let best = 0;
    for (const eid of s.board.verts[vid].edges) {
      if (!mine.has(eid) || used.has(eid)) continue;
      const e = s.board.edges[eid], w = e.a === vid ? e.b : e.a;
      used.add(eid);
      best = Math.max(best, 1 + (blocked(w) ? 0 : dfs(w)));
      used.delete(eid);
    }
    return best;
  };
  let best = 0;
  const starts = new Set();
  for (const eid of mine) { starts.add(s.board.edges[eid].a); starts.add(s.board.edges[eid].b); }
  for (const v of starts) best = Math.max(best, dfs(v));
  return best;
}
function srUpdateAwards(s) {
  const lens = s.players.map((p) => srLongestTrail(s, p.id));
  const cur = s.longest;
  if (cur.pid != null && lens[cur.pid] >= 5) {
    cur.len = lens[cur.pid];
    lens.forEach((l, pid) => { if (pid !== cur.pid && l > cur.len) { s.longest = { pid, len: l }; srLog(s, `${srWho(s.players[pid], "takes")} the Longest Trail (${l}).`); } });
  } else {
    let bestPid = null, bestLen = 4, tie = false;
    lens.forEach((l, pid) => { if (l > bestLen) { bestLen = l; bestPid = pid; tie = false; } else if (l === bestLen && bestPid != null) tie = true; });
    if (bestPid != null && !tie) { s.longest = { pid: bestPid, len: bestLen }; if (cur.pid !== bestPid) srLog(s, `${srWho(s.players[bestPid], "holds")} the Longest Trail (${bestLen}).`); }
    else if (cur.pid != null) { s.longest = { pid: null, len: 0 }; }
  }
  const p = s.players[s.turn];
  if (p.wranglers >= 3 && p.wranglers > s.posse.n) {
    if (s.posse.pid !== p.id) srLog(s, `${srWho(p, "rides")} with the Largest Posse (${p.wranglers}).`);
    s.posse = { pid: p.id, n: p.wranglers };
  }
}
function srCheckWin(s) {
  const pid = s.turn;
  if (s.phase === "over") return;
  if (srVP(s, pid) >= SR_WIN) {
    s.phase = "over"; s.winner = pid;
    srLog(s, `${srWho(s.players[pid], "wins")} the Sheep Rodeo with ${srVP(s, pid)} points.`);
    srFx(s, pid === 0 ? "win" : "lose");
  }
}

/* ---- setup ---- */
function srPlaceCorral(s, vid) {
  const pid = s.turn, p = s.players[pid];
  if (s.phase !== "setupCorral" || !srLegalCorrals(s, pid, true).includes(vid)) return s;
  p.corrals.push(vid);
  if (s.setupIdx >= 4) {                                           // the second corral pays out once
    for (const hid of s.board.verts[vid].hexes) {
      const h = s.board.hexes[hid];
      if (h.res !== "desert") srGive(s, p, h.res, 1);
    }
  }
  s.setupFrom = vid; s.phase = "setupTrail";
  srLog(s, `${srWho(p, "builds")} a corral.`); srFx(s, "build");
  return s;
}
function srPlaceTrail(s, eid) {
  const pid = s.turn, p = s.players[pid];
  if (s.phase !== "setupTrail" || !srLegalTrails(s, pid, s.setupFrom).includes(eid)) return s;
  p.trails.push(eid);
  s.setupIdx++; s.setupFrom = null;
  if (s.setupIdx >= s.setupOrder.length) { s.turn = 0; s.phase = "roll"; srLog(s, "The range is settled. Roll the dice."); }
  else { s.turn = s.setupOrder[s.setupIdx]; s.phase = "setupCorral"; }
  return s;
}

/* ---- the roll ---- */
function srProduce(s, roll) {
  const demand = {};
  for (const h of s.board.hexes) {
    if (h.num !== roll || h.id === s.rustler || h.res === "desert") continue;
    for (const vid of h.verts) {
      const o = srOwnerAt(s, vid);
      if (!o) continue;
      demand[h.res] = demand[h.res] || {};
      demand[h.res][o.pid] = (demand[h.res][o.pid] || 0) + (o.kind === "ranch" ? 2 : 1);
    }
  }
  const got = {};
  for (const r in demand) {
    const pids = Object.keys(demand[r]).map(Number);
    const total = pids.reduce((n, pid) => n + demand[r][pid], 0);
    if (total <= s.bank[r]) { for (const pid of pids) { srGive(s, s.players[pid], r, demand[r][pid]); got[pid] = got[pid] || {}; got[pid][r] = demand[r][pid]; } }
    else if (pids.length === 1) { const k = srGive(s, s.players[pids[0]], r, demand[r][pids[0]]); if (k) { got[pids[0]] = got[pids[0]] || {}; got[pids[0]][r] = k; } }
    else srLog(s, `The bank is short of ${SR_META[r].name.toLowerCase()} — nobody collects it.`);
  }
  return got;
}
function srAutoDiscard(p, need) {
  const dropped = {};
  while (need > 0) {
    let top = null;
    for (const r of SR_RES) if (top == null || p.res[r] > p.res[top]) top = r;
    if (!p.res[top]) break;
    p.res[top]--; dropped[top] = (dropped[top] || 0) + 1; need--;
  }
  return dropped;
}
function srRoll(s, rng) {
  if (s.phase !== "roll") return s;
  const a = 1 + Math.floor(rng() * 6), b = 1 + Math.floor(rng() * 6);
  s.dice = [a, b];
  const roll = a + b, p = s.players[s.turn];
  srFx(s, "dice");
  if (roll === 7) {
    srLog(s, `${srWho(p, "rolls")} a 7 — the rustler rides.`);
    let userMust = 0;
    for (const q of s.players) {
      const n = srCount(q.res);
      if (n <= SR_HAND_LIMIT) continue;
      const need = Math.floor(n / 2);
      if (q.bot) { const d = srAutoDiscard(q, need); for (const r in d) s.bank[r] += d[r]; srLog(s, `${srWho(q, "discards")} ${need}.`); }
      else userMust = need;
    }
    if (userMust) { s.discardNeed = userMust; s.phase = "discard"; }
    else s.phase = "rustler";
    return s;
  }
  const got = srProduce(s, roll);
  const parts = [];
  for (const pid in got) {
    const q = s.players[pid];
    parts.push(`${q.name}: ` + Object.keys(got[pid]).map((r) => `${got[pid][r]} ${SR_META[r].icon}`).join(" "));
  }
  srLog(s, `${srWho(p, "rolls")} ${roll}.` + (parts.length ? " " + parts.join(" · ") : " Nothing pays."));
  s.phase = "main";
  return s;
}
/* the human's discard on a 7 */
function srDiscard(s, pid, pick) {
  if (s.phase !== "discard") return s;
  const p = s.players[pid];
  let n = 0;
  for (const r of SR_RES) { const k = Math.min(pick[r] || 0, p.res[r]); n += k; }
  if (n !== s.discardNeed) return s;
  for (const r of SR_RES) { const k = Math.min(pick[r] || 0, p.res[r]); p.res[r] -= k; s.bank[r] += k; }
  srLog(s, `${srWho(p, "discards")} ${n}.`);
  s.discardNeed = 0; s.phase = "rustler";
  return s;
}
/* the rustler: move it, then rob one rancher standing there */
function srVictims(s, hid, pid) {
  const seen = new Set();
  for (const vid of s.board.hexes[hid].verts) {
    const o = srOwnerAt(s, vid);
    if (o && o.pid !== pid && srCount(s.players[o.pid].res) > 0) seen.add(o.pid);
  }
  return [...seen];
}
function srSteal(s, from, to, rng) {
  const q = s.players[from], p = s.players[to];
  const pool = [];
  for (const r of SR_RES) for (let i = 0; i < q.res[r]; i++) pool.push(r);
  if (!pool.length) return null;
  const r = pool[Math.floor(rng() * pool.length)];
  q.res[r]--; p.res[r]++;
  return r;
}
function srMoveRustler(s, hid, victim, rng) {
  if (s.phase !== "rustler" || hid === s.rustler || !s.board.hexes[hid]) return s;
  const pid = s.turn, p = s.players[pid];
  s.rustler = hid;
  const victims = srVictims(s, hid, pid);
  const h = s.board.hexes[hid];
  const where = h.res === "desert" ? "the Dust Bowl" : `the ${h.num} ${SR_META[h.res].name.toLowerCase()}`;
  if (!victims.length) { srLog(s, `${srWho(p, "parks")} the rustler on ${where}. Nobody to rob.`); s.phase = "main"; srCheckWin(s); return s; }
  if (victim == null || !victims.includes(victim)) {
    if (victims.length > 1 && !p.bot) { s.stealFrom = victims; s.phase = "steal"; srLog(s, `${srWho(p, "moves")} the rustler to ${where}. Pick who to rob.`); return s; }
    victim = victims.length === 1 ? victims[0] : srBotPickVictim(s, victims);
  }
  const r = srSteal(s, victim, pid, rng);
  srLog(s, `${srWho(p, "moves")} the rustler to ${where} and ${p.bot ? "takes" : "take"} ${r ? "a card" : "nothing"} from ${s.players[victim].name}.`);
  srFx(s, "steal");
  s.stealFrom = null; s.phase = "main";
  return s;
}
function srPickVictim(s, victim, rng) {
  if (s.phase !== "steal" || !s.stealFrom || !s.stealFrom.includes(victim)) return s;
  const pid = s.turn;
  const r = srSteal(s, victim, pid, rng);
  srLog(s, `${srWho(s.players[pid], "takes")} ${r ? "a card" : "nothing"} from ${s.players[victim].name}.`);
  srFx(s, "steal");
  s.stealFrom = null; s.phase = "main";
  return s;
}

/* ---- building ---- */
function srBuildTrail(s, eid) {
  if (s.phase !== "main") return s;
  const p = s.players[s.turn];
  const free = s.trailsFree > 0;
  if (!free && !srCanAfford(p, SR_COST.trail)) return s;
  if (p.trails.length >= SR_MAX_TRAILS || !srLegalTrails(s, p.id).includes(eid)) return s;
  if (free) s.trailsFree--; else srPay(s, p, SR_COST.trail);
  p.trails.push(eid);
  srLog(s, `${srWho(p, "lays")} a trail${free ? " (free)" : ""}.`); srFx(s, "build");
  srUpdateAwards(s); srCheckWin(s);
  return s;
}
function srBuildCorral(s, vid) {
  if (s.phase !== "main") return s;
  const p = s.players[s.turn];
  if (!srCanAfford(p, SR_COST.corral) || p.corrals.length >= SR_MAX_CORRALS) return s;
  if (!srLegalCorrals(s, p.id, false).includes(vid)) return s;
  srPay(s, p, SR_COST.corral); p.corrals.push(vid);
  srLog(s, `${srWho(p, "builds")} a corral.`); srFx(s, "build");
  srUpdateAwards(s); srCheckWin(s);
  return s;
}
function srBuildRanch(s, vid) {
  if (s.phase !== "main") return s;
  const p = s.players[s.turn];
  if (!srCanAfford(p, SR_COST.ranch) || p.ranches.length >= SR_MAX_RANCHES || !p.corrals.includes(vid)) return s;
  srPay(s, p, SR_COST.ranch);
  p.corrals = p.corrals.filter((v) => v !== vid); p.ranches.push(vid);
  srLog(s, `${srWho(p, "raises")} a corral to a ranch.`); srFx(s, "build");
  srCheckWin(s);
  return s;
}
function srBuyCard(s) {
  if (s.phase !== "main") return s;
  const p = s.players[s.turn];
  if (!srCanAfford(p, SR_COST.card) || !s.deck.length) return s;
  srPay(s, p, SR_COST.card);
  const kind = s.deck.pop();
  if (kind === "ribbon") p.ribbons++; else p.devNew.push(kind);
  srLog(s, `${srWho(p, "buys")} a rodeo card.`); srFx(s, "card");
  srCheckWin(s);
  return s;
}
/* play a card held since a previous turn (ribbons never need playing) */
function srPlayCard(s, kind, arg) {
  if (s.phase !== "main" || s.devPlayed) return s;
  const p = s.players[s.turn];
  const i = p.dev.indexOf(kind);
  if (i < 0) return s;
  if (kind === "bumper") {
    const want = arg || [];
    if (want.length !== 2 || !want.every((r) => SR_RES.includes(r))) return s;
    p.dev.splice(i, 1); s.devPlayed = true;
    for (const r of want) srGive(s, p, r, 1);
    srLog(s, `${srWho(p, "plays")} Bumper Crop: ${want.map((r) => SR_META[r].icon).join(" ")}.`);
    return s;
  }
  if (kind === "roundup") {
    if (!SR_RES.includes(arg)) return s;
    p.dev.splice(i, 1); s.devPlayed = true;
    let n = 0;
    for (const q of s.players) if (q.id !== p.id) { n += q.res[arg]; p.res[arg] += q.res[arg]; q.res[arg] = 0; }
    srLog(s, `${srWho(p, "calls")} a Roundup on ${SR_META[arg].name.toLowerCase()} and collects ${n}.`);
    return s;
  }
  p.dev.splice(i, 1); s.devPlayed = true;
  if (kind === "trails") { s.trailsFree = Math.min(2, SR_MAX_TRAILS - p.trails.length); srLog(s, `${srWho(p, "plays")} Trail Blazing.`); return s; }
  if (kind === "wrangler") { p.wranglers++; srUpdateAwards(s); srCheckWin(s); if (s.phase !== "over") { s.phase = "rustler"; srLog(s, `${srWho(p, "sends")} a Wrangler after the rustler.`); } return s; }
  return s;
}

/* ---- trading ---- */
function srRatio(s, pid, give) {
  const p = s.players[pid];
  let ratio = 4;
  for (const vid of p.corrals.concat(p.ranches)) {
    const port = s.board.verts[vid].port;
    if (!port) continue;
    if (port.kind === give) ratio = Math.min(ratio, 2);
    else if (port.kind === "any") ratio = Math.min(ratio, 3);
  }
  return ratio;
}
function srBankTrade(s, give, get) {
  if (s.phase !== "main" || give === get || !SR_RES.includes(give) || !SR_RES.includes(get)) return s;
  const p = s.players[s.turn], ratio = srRatio(s, p.id, give);
  if (p.res[give] < ratio || s.bank[get] < 1) return s;
  p.res[give] -= ratio; s.bank[give] += ratio; srGive(s, p, get, 1);
  srLog(s, `${srWho(p, "trades")} ${ratio} ${SR_META[give].icon} for 1 ${SR_META[get].icon} at the bank.`); srFx(s, "trade");
  return s;
}
/* what a bot is building toward: the closest affordable-looking goal */
function srBotTarget(s, pid) {
  const p = s.players[pid];
  const opts = [];
  if (p.corrals.length && p.ranches.length < SR_MAX_RANCHES) opts.push("ranch");
  if (p.corrals.length < SR_MAX_CORRALS && srLegalCorrals(s, pid, false).length) opts.push("corral");
  if (p.trails.length < SR_MAX_TRAILS && srLegalTrails(s, pid).length) opts.push("trail");
  if (s.deck.length) opts.push("card");
  let best = null;
  for (const k of opts) {
    const cost = SR_COST[k];
    let missing = 0; for (const r in cost) missing += Math.max(0, cost[r] - p.res[r]);
    if (!best || missing < best.missing) best = { kind: k, missing, cost };
  }
  return best;
}
function srBotAccepts(s, pid, give, get) {
  /* the human GIVES `give` and GETS `get`; the bot is asked to do the reverse, 1:1 */
  const p = s.players[pid];
  if (p.res[get] < 1) return false;
  if (srVP(s, s.turn) >= SR_WIN - 2) return false;                 // never feed a rancher on the brink
  const t = srBotTarget(s, pid);
  if (!t) return false;
  const need = (r) => Math.max(0, (t.cost[r] || 0) - p.res[r]);
  const surplusAfter = p.res[get] - 1 - (t.cost[get] || 0);
  return need(give) > 0 && surplusAfter >= 0;
}
function srOfferTrade(s, give, get) {
  if (s.phase !== "main" || give === get || !SR_RES.includes(give) || !SR_RES.includes(get)) return s;
  const p = s.players[s.turn];
  if (p.res[give] < 1) return s;
  for (const q of s.players) {
    if (q.id === p.id || !q.bot) continue;
    if (srBotAccepts(s, q.id, give, get)) {
      p.res[give]--; q.res[give]++; q.res[get]--; p.res[get]++;
      srLog(s, `${q.name} takes the trade: your ${SR_META[give].icon} for their ${SR_META[get].icon}.`); srFx(s, "trade");
      return s;
    }
  }
  srLog(s, `Nobody at the table wants ${SR_META[give].icon} for ${SR_META[get].icon}.`);
  return s;
}
function srEndTurn(s) {
  if (s.phase !== "main") return s;
  const p = s.players[s.turn];
  p.dev = p.dev.concat(p.devNew); p.devNew = [];
  s.devPlayed = false; s.trailsFree = 0;
  s.turn = (s.turn + 1) % s.players.length;
  if (s.turn === 0) s.round++;
  s.phase = "roll";
  return s;
}

/* ---- the evaluation the bots play by (and the Coach shows) ---- */
function srScoreCorner(s, pid, vid, setup) {
  const y = srCornerYield(s, vid);
  const p = s.players[pid];
  const have = {};
  for (const v of p.corrals.concat(p.ranches)) for (const r in srCornerYield(s, v).perRes) have[r] = true;
  let score = y.pips;
  const kinds = Object.keys(y.perRes);
  score += 0.6 * kinds.length;                                       // variety keeps you building
  for (const r of kinds) if (!have[r]) score += setup ? 0.5 : 0.3;   // fill the goods you lack
  if (setup && s.setupIdx < 4) { if (y.perRes.lumber) score += 0.4; if (y.perRes.clay) score += 0.4; }
  if (y.port) score += y.port.kind === "any" ? 0.8 : (y.perRes[y.port.kind] ? 1.5 : 0.5);
  return score;
}
function srBestCorral(s, pid, setup) {
  const legal = srLegalCorrals(s, pid, setup);
  let best = null, bestScore = -1;
  for (const vid of legal) { const sc = srScoreCorner(s, pid, vid, setup); if (sc > bestScore) { bestScore = sc; best = vid; } }
  return best == null ? null : { vid: best, score: bestScore };
}
/* a trail's worth: the corner it opens, and the corners two steps out */
function srFutureSpot(s, vid) {
  const v = s.board.verts[vid];
  return !srOwnerAt(s, vid) && !v.adj.some((a) => srOwnerAt(s, a));
}
function srScoreTrail(s, pid, eid) {
  const e = s.board.edges[eid];
  let best = 0;
  for (const end of [e.a, e.b]) {
    const own = srOwnerAt(s, end);
    if (own && own.pid === pid) continue;                            // that end is already ours; look at the other
    if (own) continue;
    let sc = srFutureSpot(s, end) ? srScoreCorner(s, pid, end, false) + 3 : 0;
    for (const nb of s.board.verts[end].adj) if (srFutureSpot(s, nb)) sc = Math.max(sc, srScoreCorner(s, pid, nb, false) * 0.6);
    best = Math.max(best, sc);
  }
  const mine = new Set(s.players[pid].trails);
  if ((mine.has(e.a) || mine.has(e.b))) best += 0;                  // (trail chains scored below via longest)
  return best;
}
function srBestTrail(s, pid, fromVid) {
  const legal = srLegalTrails(s, pid, fromVid);
  let best = null, bestScore = -1;
  for (const eid of legal) {
    let sc = srScoreTrail(s, pid, eid);
    if (fromVid == null) {                                           // a side that lengthens the trail counts
      const p = s.players[pid];
      p.trails.push(eid); const len = srLongestTrail(s, pid); p.trails.pop();
      if (len >= 5 && (s.longest.pid !== pid) && len > s.longest.len) sc += 4;
      else sc += 0.2 * len;
    }
    if (sc > bestScore) { bestScore = sc; best = eid; }
  }
  return best == null ? null : { eid: best, score: bestScore };
}
function srBestRustlerHex(s, pid) {
  let best = null, bestScore = -1;
  for (const h of s.board.hexes) {
    if (h.id === s.rustler || h.res === "desert") continue;
    let sc = 0, mine = false;
    for (const vid of h.verts) {
      const o = srOwnerAt(s, vid);
      if (!o) continue;
      if (o.pid === pid) { mine = true; continue; }
      sc += srPips(h.num) * (o.kind === "ranch" ? 2 : 1) * (1 + 0.15 * srVP(s, o.pid));
    }
    if (mine) sc *= 0.15;
    if (sc > bestScore) { bestScore = sc; best = h.id; }
  }
  return best;
}
function srBotPickVictim(s, victims) {
  let best = victims[0];
  for (const v of victims) {
    const a = srVP(s, v) * 10 + srCount(s.players[v].res), b = srVP(s, best) * 10 + srCount(s.players[best].res);
    if (a > b) best = v;
  }
  return best;
}
function srBestRanch(s, pid) {
  const p = s.players[pid];
  let best = null, bestPips = -1;
  for (const vid of p.corrals) { const y = srCornerYield(s, vid); if (y.pips > bestPips) { bestPips = y.pips; best = vid; } }
  return best;
}
/* the single bank trade that gets a rancher one step closer to `target` */
function srTradePlan(s, pid, target) {
  if (!target) return null;
  const p = s.players[pid];
  const need = {}; for (const r in target.cost) if (p.res[r] < target.cost[r]) need[r] = target.cost[r] - p.res[r];
  const wanted = Object.keys(need);
  if (!wanted.length) return null;
  for (const get of wanted) {
    if (s.bank[get] < 1) continue;
    let bestGive = null, bestSpare = 0;
    for (const give of SR_RES) {
      if (give === get) continue;
      const spare = p.res[give] - (target.cost[give] || 0);
      const ratio = srRatio(s, pid, give);
      if (spare >= ratio && spare > bestSpare) { bestSpare = spare; bestGive = give; }
    }
    if (bestGive) return { give: bestGive, get, ratio: srRatio(s, pid, bestGive) };
  }
  return null;
}

/* ---- one bot action per call; the page paces them so you can watch ---- */
function srBotStep(s, rng) {
  const pid = s.turn, p = s.players[pid];
  if (!p.bot || s.phase === "over") return s;
  if (s.phase === "setupCorral") { const b = srBestCorral(s, pid, true); return b ? srPlaceCorral(s, b.vid) : s; }
  if (s.phase === "setupTrail") { const b = srBestTrail(s, pid, s.setupFrom); return b ? srPlaceTrail(s, b.eid) : s; }
  if (s.phase === "roll") return srRoll(s, rng);
  if (s.phase === "rustler") { const h = srBestRustlerHex(s, pid); return srMoveRustler(s, h == null ? (s.rustler + 1) % 19 : h, null, rng); }
  if (s.phase === "steal") return srPickVictim(s, s.stealFrom[0], rng);
  if (s.phase !== "main") return s;
  if (s.trailsFree > 0) {
    const b = srBestTrail(s, pid);
    if (b) return srBuildTrail(s, b.eid);
    s.trailsFree = 0;
  }
  const target = srBotTarget(s, pid);
  if (!s.devPlayed && p.dev.length) {
    const onMe = s.board.hexes[s.rustler].verts.some((v) => { const o = srOwnerAt(s, v); return o && o.pid === pid; });
    if (p.dev.includes("wrangler") && (onMe || p.wranglers >= 2)) return srPlayCard(s, "wrangler");
    if (p.dev.includes("trails") && p.trails.length <= SR_MAX_TRAILS - 2) return srPlayCard(s, "trails");
    if (p.dev.includes("bumper") && target && target.missing > 0) {
      const want = [];
      for (const r in target.cost) for (let k = p.res[r]; k < target.cost[r] && want.length < 2; k++) want.push(r);
      while (want.length < 2) want.push("hay");
      return srPlayCard(s, "bumper", want);
    }
    if (p.dev.includes("roundup") && target) {
      let bestR = null, bestN = 3;
      for (const r in target.cost) if (p.res[r] < target.cost[r]) { const n = s.players.reduce((k, q) => k + (q.id === pid ? 0 : q.res[r]), 0); if (n >= bestN) { bestN = n; bestR = r; } }
      if (bestR) return srPlayCard(s, "roundup", bestR);
    }
  }
  if (srCanAfford(p, SR_COST.ranch) && p.ranches.length < SR_MAX_RANCHES && p.corrals.length) return srBuildRanch(s, srBestRanch(s, pid));
  if (srCanAfford(p, SR_COST.corral) && p.corrals.length < SR_MAX_CORRALS) { const b = srBestCorral(s, pid, false); if (b) return srBuildCorral(s, b.vid); }
  if (target && target.missing > 0 && target.missing <= 2) { const t = srTradePlan(s, pid, target); if (t) return srBankTrade(s, t.give, t.get); }
  if (srCanAfford(p, SR_COST.card) && s.deck.length && rng() < 0.75) return srBuyCard(s);
  if (srCanAfford(p, SR_COST.trail) && p.trails.length < SR_MAX_TRAILS) {
    const noSpot = !srLegalCorrals(s, pid, false).length;
    const rich = srCount(p.res) >= 6;
    const b = srBestTrail(s, pid);
    if (b && (noSpot || rich || b.score >= 8)) return srBuildTrail(s, b.eid);
  }
  if (srCount(p.res) > SR_HAND_LIMIT) { const t = srTradePlan(s, pid, target || { cost: SR_COST.corral }); if (t) return srBankTrade(s, t.give, t.get); }
  return srEndTurn(s);
}

/* ---- THE COACH: the bots' evaluation, explained to the human ---- */
function srFmtYield(y) {
  return Object.keys(y.perRes).sort((a, b) => y.perRes[b] - y.perRes[a]).map((r) => `${SR_META[r].icon} ${y.perRes[r]}`).join(" · ");
}
function srCoach(s) {
  const pid = 0, p = s.players[pid];
  if (s.phase === "over") return { title: s.winner === 0 ? "You won the range." : `${s.players[s.winner].name} won.`, why: "Start a new game to run it back — the board and the numbers reshuffle every time.", target: null };
  if (s.turn !== pid && s.phase !== "discard") {
    const ex = srExpected(s, pid), tot = SR_RES.reduce((n, r) => n + ex[r], 0);
    return { title: `${s.players[s.turn].name} is up.`, why: `While you wait: your corrals pay an average of ${tot.toFixed(2)} cards per roll (${SR_RES.filter((r) => ex[r] > 0).map((r) => `${SR_META[r].icon} ${ex[r].toFixed(2)}`).join(" · ")}). Cards in hand: ${srCount(p.res)} — over 7 and a rolled 7 costs you half.`, target: null };
  }
  if (s.phase === "setupCorral") {
    const b = srBestCorral(s, pid, true);
    if (!b) return { title: "No legal corner left.", why: "", target: null };
    const y = srCornerYield(s, b.vid);
    const first = s.setupIdx < 4;
    return {
      title: `Best open corner: ${y.pips} pips.`,
      why: `${srFmtYield(y)} — it pays on ${y.ways} of the 36 rolls (${Math.round((100 * y.ways) / 36)}% each turn).${y.port ? ` It also touches a ${y.port.kind === "any" ? "3:1" : "2:1 " + SR_META[y.port.kind].icon} trading post.` : ""} ${first ? "Early on, lumber and clay build trails and corrals — the Coach weighs them up a little." : "Your second corral pays out at once, so it also fills the goods your first corner lacks."} Pips are the ways a number rolls: 6 and 8 roll 5 ways each, 2 and 12 roll once.`,
      target: { kind: "vert", id: b.vid },
    };
  }
  if (s.phase === "setupTrail") {
    const b = srBestTrail(s, pid, s.setupFrom);
    return { title: "Point the trail at your next corner.", why: "Corrals must sit two sides apart, so the trail you lay now decides where your third corral can go. The lit side leads toward the best open corner two steps out.", target: b ? { kind: "edge", id: b.eid } : null };
  }
  if (s.phase === "roll") {
    const ex = srExpected(s, pid), tot = SR_RES.reduce((n, r) => n + ex[r], 0);
    return { title: "Roll.", why: `Your expected pickup this roll: ${tot.toFixed(2)} cards (${SR_RES.filter((r) => ex[r] > 0).map((r) => `${SR_META[r].icon} ${ex[r].toFixed(2)}`).join(" · ") || "nothing yet"}). A 7 comes up 6 ways in 36 — one roll in six.`, target: null };
  }
  if (s.phase === "discard") return { title: `Discard ${s.discardNeed}.`, why: "Over seven cards when a 7 rolls costs half your hand (rounded down). Let go of the goods you hold most of and can rebuild fastest; keep what finishes your next build.", target: null };
  if (s.phase === "rustler") {
    const h = srBestRustlerHex(s, pid);
    if (h == null) return { title: "Move the rustler.", why: "Any hex but the one it is on.", target: null };
    const hex = s.board.hexes[h];
    return { title: `Park it on the ${hex.num} ${SR_META[hex.res].name.toLowerCase()}.`, why: `That hex pays ${srPips(hex.num)} ways in 36 to the ranchers on it, and it costs the leaders most. Never block your own corner — the rustler stops production for everyone touching the hex, you included.`, target: { kind: "hex", id: h } };
  }
  if (s.phase === "steal") return { title: "Rob the leader.", why: "Points first, then the fattest hand — the card you take is random from whoever you pick.", target: null };
  if (s.phase === "main") {
    if (s.trailsFree > 0) { const b = srBestTrail(s, pid); return { title: `${s.trailsFree} free trail${s.trailsFree > 1 ? "s" : ""} to lay.`, why: "Trail Blazing is paid for — tap the lit side to lay toward your next corner.", target: b ? { kind: "edge", id: b.eid } : null }; }
    const legalC = srLegalCorrals(s, pid, false);
    if (srCanAfford(p, SR_COST.ranch) && p.corrals.length && p.ranches.length < SR_MAX_RANCHES) {
      const v = srBestRanch(s, pid), y = srCornerYield(s, v);
      return { title: "Raise a ranch.", why: `Your ${y.pips}-pip corral (${srFmtYield(y)}) will pay double — two cards per hit — for 2 🌾 + 3 ⛏️, and a ranch is worth two points.`, target: { kind: "vert", id: v } };
    }
    if (srCanAfford(p, SR_COST.corral) && legalC.length && p.corrals.length < SR_MAX_CORRALS) {
      const b = srBestCorral(s, pid, false), y = srCornerYield(s, b.vid);
      return { title: "Build a corral.", why: `Best reachable corner: ${y.pips} pips (${srFmtYield(y) || "no production — but it's a point"}). A corral is a point and a new stream of cards.`, target: { kind: "vert", id: b.vid } };
    }
    const target = srBotTarget(s, pid);
    const plan = target && target.missing > 0 && target.missing <= 2 ? srTradePlan(s, pid, target) : null;
    if (plan) return { title: `Trade ${plan.ratio} ${SR_META[plan.give].icon} for 1 ${SR_META[plan.get].icon}.`, why: `You're ${target.missing} short of a ${SR_BUILD_NAME[target.kind].toLowerCase()} and holding spare ${SR_META[plan.give].name.toLowerCase()}. ${plan.ratio < 4 ? "Your trading post makes it " + plan.ratio + ":1." : "The bank takes 4:1; a trading post would make it cheaper."} Ask the table first — a 1:1 swap beats the bank every time someone bites.`, target: null, trade: plan };
    if (srCanAfford(p, SR_COST.card) && s.deck.length) return { title: "Buy a rodeo card.", why: `${s.deck.length} left in the deck. The deck started 14 wranglers, 5 blue ribbons, 2 trail blazing, 2 bumper crop, 2 roundup — so ${Math.round((100 * 14) / 25)}% wranglers at the start, and every ribbon is a point.`, target: null };
    if (srCanAfford(p, SR_COST.trail) && p.trails.length < SR_MAX_TRAILS) {
      const b = srBestTrail(s, pid);
      if (b && (!legalC.length || b.score >= 8)) return { title: "Lay a trail.", why: legalC.length ? "This side opens a strong corner or stretches your trail toward the Longest Trail bonus (2 points at five sides)." : "You have no legal corner right now — trails open new ones. The lit side leads to the best open corner.", target: { kind: "edge", id: b.eid } };
    }
    const n = srCount(p.res);
    return { title: "End your turn.", why: n > SR_HAND_LIMIT ? `You hold ${n} cards — a 7 would cost you ${Math.floor(n / 2)}. Trade down at the bank first if you can.` : `Nothing worth buying yet. You hold ${n} cards; ${target ? `the nearest build is a ${SR_BUILD_NAME[target.kind].toLowerCase()}, ${target.missing} card${target.missing === 1 ? "" : "s"} away.` : "keep collecting."}`, target: null };
  }
  return { title: "", why: "", target: null };
}

/* ============================================================
   THE PAGE
   ============================================================ */
const SR_SAVE = "poker-trainer:sheep";
function srLoadSaved() {
  try {
    const raw = window.localStorage.getItem(SR_SAVE);
    if (!raw) return null;
    const s = JSON.parse(raw);
    return s && s.board && s.players && s.players.length === 4 ? s : null;
  } catch { return null; }
}
function srSave(s) { try { window.localStorage.setItem(SR_SAVE, JSON.stringify(s)); } catch { /* private mode */ } }

const SR_GUIDE = [
  { h: "Settle the range", p: "Nineteen hexes, each with a good and a number. Corrals on a hex's corners collect that good whenever its number rolls. First to 10 points wins: corrals 1, ranches 2, Longest Trail and Largest Posse 2 each, blue ribbons 1." },
  { h: "Read the pips", p: "The dots under each number are its ways out of 36: a 6 or 8 rolls 5 ways (14%), a 2 or 12 rolls once (3%). Pick corners by adding pips, not by liking the number. A 7 rolls 6 ways — one turn in six the rustler rides.", tag: "EXACT: 36 OUTCOMES" },
  { h: "Build", p: "Trail = 🌲 + 🧱. Corral = 🌲 🧱 🌾 🐑, on a corner touching your trail and two sides from any building. Ranch = 2 🌾 + 3 ⛏️, upgrades a corral to pay double. Rodeo card = 🐑 🌾 ⛏️." },
  { h: "The rustler", p: "On a 7, anyone over seven cards discards half, then you move the rustler onto a hex — it stops paying — and take one random card from a rancher on it. Wrangler cards move it too; three played earns the Largest Posse." },
  { h: "Trade", p: "Bank trades are 4:1, or 3:1 and 2:1 at trading posts you've built on. Ask the table 1:1 first — the ranchers accept when it helps their own next build and never when you're two points from winning." },
  { h: "The Coach", p: "The gold ring is the Coach's pick, and the box says why in numbers. It's the exact same evaluation the three ranchers across the table play by — no secret book, no hidden edge. Beat the Coach's advice and you've learned the game.", tag: "SAME BRAIN AS THE BOTS", green: true },
];

function SrHeader({ vp, onHelp }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "12px 16px", flexWrap: "wrap", background: "linear-gradient(180deg, rgba(255,255,255,0.03), transparent)", borderBottom: `1px solid ${CAS.line}` }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: casSans, fontSize: 17, fontWeight: 900, letterSpacing: "0.22em", color: CAS.cream }}>SHEEP RODEO</div>
        <div style={{ fontFamily: casMono, fontSize: 9.5, letterSpacing: "0.08em", color: CAS.faint, marginTop: 2 }}>SETTLE THE RANGE · FIRST TO 10</div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 13px", borderRadius: 999, background: CAS.goldFaint, border: `1px solid ${CAS.goldLine}` }}>
          <span style={{ fontFamily: casMono, fontSize: 9.5, letterSpacing: "0.14em", color: CAS.goldDim }}>PTS</span>
          <span style={{ fontFamily: casSans, fontSize: 14, fontWeight: 900, color: CAS.gold, fontVariantNumeric: "tabular-nums" }}>{vp} / {SR_WIN}</span>
        </div>
        <button onClick={onHelp} aria-label="Open the table guide" style={{ height: 30, borderRadius: 9, cursor: "pointer", padding: "0 10px", border: `1px solid ${CAS.line}`, background: "rgba(255,255,255,0.03)", color: CAS.dim, fontSize: 13, fontWeight: 900, lineHeight: 1, fontFamily: casSans }}>?</button>
        <SoundToggle dark />
        <AccountArea dark />
        <a href="index.html" aria-label="Home" style={{ color: CAS.dim, textDecoration: "none", fontSize: 16, lineHeight: 1, border: `1px solid ${CAS.line}`, borderRadius: 9, padding: "6px 10px", background: "rgba(255,255,255,0.02)" }}>⌂</a>
      </div>
    </div>
  );
}

/* the range, drawn */
function SrBoard({ g, mode, coach, onVert, onEdge, onHex }) {
  const { hexes, verts, edges } = g.board;
  const legalV = useMemo(() => {
    if (mode === "setupCorral") return new Set(srLegalCorrals(g, 0, true));
    if (mode === "corral") return new Set(srLegalCorrals(g, 0, false));
    if (mode === "ranch") return new Set(g.players[0].corrals);
    return new Set();
  }, [g, mode]);
  const legalE = useMemo(() => {
    if (mode === "setupTrail") return new Set(srLegalTrails(g, 0, g.setupFrom));
    if (mode === "trail") return new Set(srLegalTrails(g, 0));
    return new Set();
  }, [g, mode]);
  const hexMode = mode === "rustler";
  const tgt = coach && coach.target;
  const owner = (vid) => srOwnerAt(g, vid);
  const house = (x, y, k, color, ranch) => {
    const s = ranch ? 0.3 : 0.22;
    const pts = [[-s, s * 0.9], [-s, -s * 0.2], [0, -s], [s, -s * 0.2], [s, s * 0.9]].map(([px, py]) => `${x + px},${y + py}`).join(" ");
    return (
      <g key={k} pointerEvents="none">
        <polygon points={pts} fill={color} stroke="#0a0c10" strokeWidth={0.06} />
        {ranch && <rect x={x - s * 0.55} y={y - s * 0.95} width={s * 0.4} height={s * 0.7} fill={color} stroke="#0a0c10" strokeWidth={0.05} />}
        {ranch && <rect x={x - s * 0.9} y={y + s * 0.95} width={s * 1.8} height={0.09} fill="#0a0c10" opacity={0.6} />}
      </g>
    );
  };
  return (
    <svg viewBox="-5 -4.75 10 9.5" style={{ width: "100%", maxWidth: 560, display: "block", margin: "0 auto", touchAction: "manipulation" }} role="img" aria-label="The range">
      <defs>
        <radialGradient id="srGlow" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="rgba(245,197,66,0.55)" /><stop offset="100%" stopColor="rgba(245,197,66,0)" /></radialGradient>
        <style>{`@keyframes srPulse{0%,100%{opacity:.45}50%{opacity:1}} .srPulse{animation:srPulse 1.1s ease-in-out infinite} @media (prefers-reduced-motion: reduce){.srPulse{animation:none;opacity:.85}}`}</style>
      </defs>
      <circle cx={0} cy={0} r={4.7} fill="rgba(6,33,20,0.9)" stroke="rgba(245,197,66,0.14)" strokeWidth={0.05} />
      {/* hexes */}
      {hexes.map((h) => {
        const pts = h.verts.map((v) => `${verts[v].x},${verts[v].y}`).join(" ");
        const m = SR_META[h.res];
        const isRust = g.rustler === h.id;
        const isTgt = tgt && tgt.kind === "hex" && tgt.id === h.id;
        return (
          <g key={h.id} onClick={hexMode && !isRust ? () => onHex(h.id) : undefined} style={{ cursor: hexMode && !isRust ? "pointer" : "default" }}>
            <polygon points={pts} fill={m.fill} stroke="#0a0c10" strokeWidth={0.07} strokeLinejoin="round" />
            <text x={h.x} y={h.y - 0.55} textAnchor="middle" fontSize={0.42} style={{ pointerEvents: "none" }}>{m.icon}</text>
            {h.num > 0 && (
              <g pointerEvents="none">
                <circle cx={h.x} cy={h.y + 0.12} r={0.37} fill={CAS.cream} stroke="rgba(0,0,0,0.35)" strokeWidth={0.03} opacity={isRust ? 0.45 : 1} />
                <text x={h.x} y={h.y + 0.2} textAnchor="middle" fontSize={h.num === 6 || h.num === 8 ? 0.4 : 0.34} fontWeight={900} fontFamily={casSans} fill={h.num === 6 || h.num === 8 ? "#c62828" : "#161a22"}>{h.num}</text>
                {Array.from({ length: srPips(h.num) }, (_, i) => (
                  <circle key={i} cx={h.x + (i - (srPips(h.num) - 1) / 2) * 0.09} cy={h.y + 0.34} r={0.028} fill={h.num === 6 || h.num === 8 ? "#c62828" : "#161a22"} />
                ))}
              </g>
            )}
            {isRust && <text x={h.x} y={h.y + (h.num ? 0.72 : 0.3)} textAnchor="middle" fontSize={0.55} style={{ pointerEvents: "none" }}>🐺</text>}
            {hexMode && !isRust && <polygon className={isTgt ? "srPulse" : undefined} points={pts} fill={isTgt ? "rgba(245,197,66,0.35)" : "rgba(245,197,66,0.08)"} stroke={isTgt ? CAS.gold : "rgba(245,197,66,0.5)"} strokeWidth={isTgt ? 0.1 : 0.04} strokeDasharray={isTgt ? undefined : "0.12 0.1"} />}
          </g>
        );
      })}
      {/* trading posts */}
      {g.board.ports.map((pt) => {
        const e = edges[pt.edge], a = verts[e.a], b = verts[e.b];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, len = Math.hypot(mx, my), ox = (mx / len) * 0.55, oy = (my / len) * 0.55;
        return (
          <g key={pt.edge} pointerEvents="none">
            <line x1={a.x} y1={a.y} x2={mx + ox} y2={my + oy} stroke="rgba(244,239,228,0.35)" strokeWidth={0.04} />
            <line x1={b.x} y1={b.y} x2={mx + ox} y2={my + oy} stroke="rgba(244,239,228,0.35)" strokeWidth={0.04} />
            <circle cx={mx + ox} cy={my + oy} r={0.3} fill="#1a2230" stroke="rgba(244,239,228,0.4)" strokeWidth={0.03} />
            <text x={mx + ox} y={my + oy + 0.02} textAnchor="middle" fontSize={0.2} fontWeight={900} fontFamily={casMono} fill={CAS.cream}>{pt.kind === "any" ? "3:1" : "2:1"}</text>
            <text x={mx + ox} y={my + oy + 0.24} textAnchor="middle" fontSize={0.2}>{pt.kind === "any" ? "?" : SR_META[pt.kind].icon}</text>
          </g>
        );
      })}
      {/* trails */}
      {edges.map((e) => {
        const o = srTrailOwner(g, e.id);
        if (o == null) return null;
        const a = verts[e.a], b = verts[e.b];
        return (
          <g key={e.id} pointerEvents="none">
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0a0c10" strokeWidth={0.22} strokeLinecap="round" />
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={g.players[o].color} strokeWidth={0.13} strokeLinecap="round" />
          </g>
        );
      })}
      {/* legal sides */}
      {[...legalE].map((eid) => {
        const e = edges[eid], a = verts[e.a], b = verts[e.b];
        const isTgt = tgt && tgt.kind === "edge" && tgt.id === eid;
        return (
          <g key={"le" + eid} onClick={() => onEdge(eid)} style={{ cursor: "pointer" }}>
            <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={0.5} strokeLinecap="round" />
            <line className={isTgt ? "srPulse" : undefined} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={isTgt ? CAS.gold : "rgba(245,197,66,0.55)"} strokeWidth={isTgt ? 0.2 : 0.13} strokeDasharray={isTgt ? undefined : "0.14 0.12"} strokeLinecap="round" />
          </g>
        );
      })}
      {/* buildings */}
      {verts.map((v) => { const o = owner(v.id); return o ? house(v.x, v.y, "b" + v.id, g.players[o.pid].color, o.kind === "ranch") : null; })}
      {/* legal corners */}
      {[...legalV].map((vid) => {
        const v = verts[vid];
        const isTgt = tgt && tgt.kind === "vert" && tgt.id === vid;
        return (
          <g key={"lv" + vid} onClick={() => onVert(vid)} style={{ cursor: "pointer" }}>
            {isTgt && <circle cx={v.x} cy={v.y} r={0.7} fill="url(#srGlow)" pointerEvents="none" />}
            <circle cx={v.x} cy={v.y} r={0.42} fill="transparent" />
            <circle className={isTgt ? "srPulse" : undefined} cx={v.x} cy={v.y} r={isTgt ? 0.3 : 0.24} fill={isTgt ? "rgba(245,197,66,0.4)" : "rgba(245,197,66,0.16)"} stroke={isTgt ? CAS.gold : "rgba(245,197,66,0.7)"} strokeWidth={isTgt ? 0.08 : 0.04} strokeDasharray={isTgt ? undefined : "0.1 0.08"} />
          </g>
        );
      })}
    </svg>
  );
}

function SrDie({ n }) {
  const dots = { 1: [[1, 1]], 2: [[0, 0], [2, 2]], 3: [[0, 0], [1, 1], [2, 2]], 4: [[0, 0], [0, 2], [2, 0], [2, 2]], 5: [[0, 0], [0, 2], [1, 1], [2, 0], [2, 2]], 6: [[0, 0], [0, 1], [0, 2], [2, 0], [2, 1], [2, 2]] }[n] || [];
  return (
    <div style={{ width: 34, height: 34, borderRadius: 8, background: CAS.cream, boxShadow: "0 3px 8px rgba(0,0,0,0.5), inset 0 -2px 0 rgba(0,0,0,0.15)", position: "relative", animation: "casChipDrop 320ms ease both" }}>
      {dots.map(([r, c], i) => <span key={i} style={{ position: "absolute", width: 6, height: 6, borderRadius: "50%", background: "#161a22", left: 5 + c * 9, top: 5 + r * 9 }} />)}
    </div>
  );
}

export default function SheepRodeo() {
  const rngRef = useRef(Math.random);
  const [g, setG] = useState(() => srLoadSaved() || srNew(Math.random));
  const [guideOpen, setGuideOpen] = useState(() => guideUnseen("sheep"));
  const [mode, setMode] = useState(null);           // trail | corral | ranch | trade | bumper | roundup | null
  const [pick, setPick] = useState({});             // discard / bumper picks
  const [trade, setTrade] = useState({ give: null, get: null });
  const [coachOpen, setCoachOpen] = useState(true);
  const [logOpen, setLogOpen] = useState(false);
  const [endDismissed, setEndDismissed] = useState(false);
  const [winKey, setWinKey] = useState(0);
  const lastFx = useRef(g.fxSeq);

  const me = g.players[0];
  const myTurn = g.turn === 0;
  const coach = useMemo(() => srCoach(g), [g]);
  const uiMode = g.phase === "setupCorral" && myTurn ? "setupCorral"
    : g.phase === "setupTrail" && myTurn ? "setupTrail"
    : g.phase === "rustler" && myTurn ? "rustler"
    : g.phase === "main" && myTurn ? (g.trailsFree > 0 ? "trail" : mode) : null;

  useEffect(() => { srSave(g); }, [g]);
  useEffect(() => {
    if (g.fxSeq === lastFx.current) return;
    lastFx.current = g.fxSeq;
    if (g.fx === "dice") sfx.dice(600);
    else if (g.fx === "build") sfx.chip();
    else if (g.fx === "card") sfx.card();
    else if (g.fx === "steal") sfx.boom();
    else if (g.fx === "trade") sfx.chips(3);
    else if (g.fx === "win") { setWinKey((k) => k + 1); setTimeout(() => sfx.win(true), 200); }
  }, [g.fxSeq, g.fx]);
  useEffect(() => { if (g.phase === "main" && g.trailsFree === 0 && mode === "trail" && me.trails.length && !srCanAfford(me, SR_COST.trail)) setMode(null); }, [g, mode, me]);
  useEffect(() => { if (g.phase !== "main") { setMode(null); setPick({}); } }, [g.phase]);
  useEffect(() => { if (g.phase === "over") setEndDismissed(false); }, [g.phase]);

  /* the ranchers across the table act one step at a time so you can watch */
  useEffect(() => {
    if (g.phase === "over" || g.phase === "discard") return;
    if (!g.players[g.turn].bot) return;
    const t = setTimeout(() => setG((prev) => {
      if (prev.phase === "over" || prev.phase === "discard" || !prev.players[prev.turn].bot) return prev;
      return srBotStep(srClone(prev), rngRef.current);
    }), g.phase === "roll" ? 750 : g.phase.startsWith("setup") ? 450 : 520);
    return () => clearTimeout(t);
  }, [g]);

  const act = useCallback((fn) => { setG((prev) => fn(srClone(prev))); }, []);
  const onVert = (vid) => {
    sfx.click();
    if (uiMode === "setupCorral") act((s) => srPlaceCorral(s, vid));
    else if (uiMode === "corral") { act((s) => srBuildCorral(s, vid)); setMode(null); }
    else if (uiMode === "ranch") { act((s) => srBuildRanch(s, vid)); setMode(null); }
  };
  const onEdge = (eid) => {
    sfx.click();
    if (uiMode === "setupTrail") act((s) => srPlaceTrail(s, eid));
    else if (uiMode === "trail") { act((s) => srBuildTrail(s, eid)); if (g.trailsFree <= 1) setMode(null); }
  };
  const onHex = (hid) => { sfx.click(); act((s) => srMoveRustler(s, hid, null, rngRef.current)); };
  const newGame = () => { sfx.click(); setMode(null); setPick({}); setG(srNew(Math.random)); };

  const can = {
    trail: myTurn && g.phase === "main" && (g.trailsFree > 0 || srCanAfford(me, SR_COST.trail)) && me.trails.length < SR_MAX_TRAILS && srLegalTrails(g, 0).length > 0,
    corral: myTurn && g.phase === "main" && srCanAfford(me, SR_COST.corral) && me.corrals.length < SR_MAX_CORRALS && srLegalCorrals(g, 0, false).length > 0,
    ranch: myTurn && g.phase === "main" && srCanAfford(me, SR_COST.ranch) && me.corrals.length > 0 && me.ranches.length < SR_MAX_RANCHES,
    card: myTurn && g.phase === "main" && srCanAfford(me, SR_COST.card) && g.deck.length > 0,
  };
  const pickCount = SR_RES.reduce((n, r) => n + (pick[r] || 0), 0);
  const tapRes = (r) => {
    if (g.phase === "discard") { setPick((p) => ({ ...p, [r]: ((p[r] || 0) + 1) % (me.res[r] + 1) })); sfx.click(); return; }
    if (mode === "bumper") { setPick((p) => ({ ...p, [r]: Math.min(2, (p[r] || 0) + 1) })); sfx.click(); return; }
    if (mode === "roundup") { sfx.click(); act((s) => srPlayCard(s, "roundup", r)); setMode(null); return; }
    if (mode === "trade") { setTrade((t) => ({ ...t, give: r })); sfx.click(); }
  };
  const playCard = (kind) => {
    if (!myTurn || g.phase !== "main" || g.devPlayed) return;
    sfx.click();
    if (kind === "bumper") { setMode("bumper"); setPick({}); return; }
    if (kind === "roundup") { setMode("roundup"); return; }
    act((s) => srPlayCard(s, kind));
  };
  const bumperPicks = SR_RES.flatMap((r) => Array(pick[r] || 0).fill(r));

  const btn = (label, on, onClick, opts = {}) => (
    <button key={label} onClick={onClick} disabled={!on} style={{ ...casGhost(), padding: "10px 6px", fontSize: 11, flex: 1, minWidth: 0, ...(opts.active ? { border: `1px solid ${CAS.gold}`, color: CAS.gold, background: CAS.goldFaint } : {}) }}>{label}</button>
  );
  const cost = (k) => Object.keys(SR_COST[k]).map((r) => (SR_COST[k][r] > 1 ? SR_COST[k][r] : "") + SR_META[r].icon).join(" ");
  /* a build button: the name on top, its price underneath, never wrapping */
  const buildBtn = (k, label, on, onClick) => (
    <button key={k} onClick={onClick} disabled={!on} style={{ ...casGhost(), padding: "8px 4px 7px", flex: 1, minWidth: 0, display: "grid", gap: 3, justifyItems: "center", border: on ? `1px solid ${CAS.goldLine}` : `1px solid ${CAS.line}` }}>
      <span style={{ fontSize: 11, letterSpacing: "0.08em", whiteSpace: "nowrap" }}>{label}</span>
      <span style={{ fontSize: 11.5, whiteSpace: "nowrap", opacity: 0.9 }}>{cost(k)}</span>
    </button>
  );

  let rail;
  if (g.phase === "over") rail = <button onClick={newGame} style={{ ...casCta(false, true), width: "100%" }}>NEW GAME</button>;
  else if (!myTurn && g.phase !== "discard") rail = <div style={{ textAlign: "center", fontFamily: casMono, fontSize: 11, color: CAS.dim, padding: 12 }}>{g.players[g.turn].name} is {g.phase.startsWith("setup") ? "settling in" : "on the move"}…</div>;
  else if (g.phase === "setupCorral") rail = <div style={{ textAlign: "center", fontFamily: casMono, fontSize: 11, color: CAS.gold, padding: 12 }}>TAP A LIT CORNER FOR YOUR {g.setupIdx < 4 ? "FIRST" : "SECOND"} CORRAL</div>;
  else if (g.phase === "setupTrail") rail = <div style={{ textAlign: "center", fontFamily: casMono, fontSize: 11, color: CAS.gold, padding: 12 }}>TAP A LIT SIDE FOR ITS TRAIL</div>;
  else if (g.phase === "roll") rail = <button onClick={() => { act((s) => srRoll(s, rngRef.current)); }} style={{ ...casCta(false, true), width: "100%" }}>🎲 ROLL</button>;
  else if (g.phase === "discard") rail = <button onClick={() => { sfx.click(); act((s) => srDiscard(s, 0, pick)); setPick({}); }} disabled={pickCount !== g.discardNeed} style={{ ...casCta(pickCount !== g.discardNeed), width: "100%" }}>DISCARD {pickCount} / {g.discardNeed} — TAP CARDS ABOVE</button>;
  else if (g.phase === "rustler") rail = <div style={{ textAlign: "center", fontFamily: casMono, fontSize: 11, color: CAS.gold, padding: 12 }}>TAP A HEX TO MOVE THE RUSTLER 🐺</div>;
  else if (g.phase === "steal") rail = (
    <div style={{ display: "flex", gap: 8 }}>
      {g.stealFrom.map((pid) => <button key={pid} onClick={() => { sfx.click(); act((s) => srPickVictim(s, pid, rngRef.current)); }} style={{ ...casCta(false), flex: 1, padding: "12px 6px", fontSize: 12 }}>ROB {g.players[pid].name.split(" ")[0].toUpperCase()} · {srCount(g.players[pid].res)} cards</button>)}
    </div>
  );
  else if (mode === "trade") rail = (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: casMono, fontSize: 11, color: CAS.dim, flexWrap: "wrap" }}>
        <span>GIVE {trade.give ? SR_META[trade.give].icon : "—"} (tap a card above) → GET</span>
        {SR_RES.map((r) => <button key={r} onClick={() => { sfx.click(); setTrade((t) => ({ ...t, get: r })); }} disabled={r === trade.give} style={{ width: 36, height: 32, borderRadius: 8, border: `1px solid ${trade.get === r ? CAS.gold : CAS.line}`, background: trade.get === r ? CAS.goldFaint : "rgba(255,255,255,0.04)", fontSize: 16, cursor: "pointer" }}>{SR_META[r].icon}</button>)}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {btn("CANCEL", true, () => { sfx.click(); setMode(null); })}
        {btn("ASK THE TABLE 1:1", !!trade.give && !!trade.get && trade.give !== trade.get && me.res[trade.give] >= 1, () => { act((s) => srOfferTrade(s, trade.give, trade.get)); })}
        {btn(`BANK ${trade.give ? srRatio(g, 0, trade.give) : 4}:1`, !!trade.give && !!trade.get && trade.give !== trade.get && me.res[trade.give] >= srRatio(g, 0, trade.give) && g.bank[trade.get] > 0, () => { act((s) => srBankTrade(s, trade.give, trade.get)); })}
      </div>
    </div>
  );
  else if (mode === "bumper") rail = (
    <div style={{ display: "flex", gap: 8 }}>
      {btn("CANCEL", true, () => { sfx.click(); setMode(null); setPick({}); })}
      <button onClick={() => { sfx.click(); act((s) => srPlayCard(s, "bumper", bumperPicks)); setMode(null); setPick({}); }} disabled={bumperPicks.length !== 2} style={{ ...casCta(bumperPicks.length !== 2), flex: 2, padding: "12px 6px", fontSize: 12 }}>TAKE {bumperPicks.map((r) => SR_META[r].icon).join(" ") || "TWO GOODS — TAP CARDS ABOVE"}</button>
    </div>
  );
  else if (mode === "roundup") rail = <div style={{ display: "flex", gap: 8 }}>{btn("CANCEL", true, () => { sfx.click(); setMode(null); })}<div style={{ flex: 2, textAlign: "center", fontFamily: casMono, fontSize: 11, color: CAS.gold, padding: 10 }}>TAP THE GOOD TO ROUND UP</div></div>;
  else if (mode === "trail" || mode === "corral" || mode === "ranch") rail = (
    <div style={{ display: "flex", gap: 8 }}>
      {btn("CANCEL", g.trailsFree === 0, () => { sfx.click(); setMode(null); })}
      <div style={{ flex: 2, textAlign: "center", fontFamily: casMono, fontSize: 11, color: CAS.gold, padding: 10 }}>{mode === "trail" ? `TAP A LIT SIDE${g.trailsFree ? ` · ${g.trailsFree} FREE` : ""}` : mode === "corral" ? "TAP A LIT CORNER" : "TAP ONE OF YOUR CORRALS"}</div>
    </div>
  );
  else rail = (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 6 }}>
        {buildBtn("trail", "TRAIL", can.trail, () => { sfx.click(); setMode("trail"); })}
        {buildBtn("corral", "CORRAL", can.corral, () => { sfx.click(); setMode("corral"); })}
        {buildBtn("ranch", "RANCH", can.ranch, () => { sfx.click(); setMode("ranch"); })}
        {buildBtn("card", "CARD", can.card, () => { sfx.click(); act((s) => srBuyCard(s)); })}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        {btn("TRADE", srCount(me.res) > 0, () => { sfx.click(); setTrade({ give: null, get: null }); setMode("trade"); })}
        <button onClick={() => { sfx.click(); act((s) => srEndTurn(s)); }} style={{ ...casCta(false, !can.trail && !can.corral && !can.ranch && !can.card), flex: 2, padding: "12px 8px", fontSize: 13 }}>END TURN</button>
      </div>
    </div>
  );

  const ended = g.phase === "over";
  return (
    <div style={{ minHeight: "var(--vh)", background: CAS.bg, color: CAS.text, fontFamily: casSans, position: "relative" }}>
      <style>{CAS_CSS}</style>
      <SrHeader vp={srVP(g, 0)} onHelp={() => { sfx.click(); setGuideOpen(true); }} />
      <Guide game="sheep" title="SHEEP RODEO" steps={SR_GUIDE} open={guideOpen} onClose={() => setGuideOpen(false)} />

      <div style={{ maxWidth: 600, margin: "0 auto", padding: "10px 10px 240px" }}>
        {/* the table */}
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          {g.players.map((p) => {
            const cur = g.turn === p.id;
            return (
              <div key={p.id} style={{ flex: 1, minWidth: 0, borderRadius: 10, padding: "6px 7px", background: cur ? "rgba(245,197,66,0.08)" : CAS.panel, border: `1px solid ${cur ? CAS.goldLine : CAS.line}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: p.color, flex: "0 0 auto" }} />
                  <span style={{ fontSize: 10.5, fontWeight: 800, color: cur ? CAS.cream : CAS.dim, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name.split(" ")[0]}</span>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 5, marginTop: 3 }}>
                  <span style={{ fontSize: 18, fontWeight: 900, color: p.id === 0 ? CAS.gold : CAS.text, fontVariantNumeric: "tabular-nums" }}>{srVP(g, p.id)}</span>
                  <span style={{ fontFamily: casMono, fontSize: 9.5, color: CAS.faint, whiteSpace: "nowrap" }}>{srCount(p.res)} cards</span>
                  {g.longest.pid === p.id && <span title="Longest Trail" style={{ fontSize: 10 }}>🛤️</span>}
                  {g.posse.pid === p.id && <span title="Largest Posse" style={{ fontSize: 10 }}>🤠</span>}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ ...feltPanel("8px 4px"), position: "relative" }}>
          <Burst fireKey={winKey} count={22} />
          <Sparkles fireKey={winKey} count={16} />
          <SrBoard g={g} mode={uiMode} coach={coach} onVert={onVert} onEdge={onEdge} onHex={onHex} />
          {g.dice && (
            <div key={g.dice.join("") + g.turn + g.round} style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 5, alignItems: "center" }}>
              <SrDie n={g.dice[0]} /><SrDie n={g.dice[1]} />
              <span style={{ fontFamily: casMono, fontSize: 9.5, color: CAS.cream, background: "rgba(0,0,0,0.5)", borderRadius: 6, padding: "3px 6px" }}>{SR_WAYS[g.dice[0] + g.dice[1]]}/36</span>
            </div>
          )}
        </div>

        {/* your hand */}
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          {SR_RES.map((r) => {
            const n = me.res[r], selected = pick[r] || 0;
            const tappable = g.phase === "discard" || mode === "bumper" || mode === "roundup" || mode === "trade";
            const isGive = mode === "trade" && trade.give === r;
            return (
              <button key={r} onClick={() => tapRes(r)} disabled={!tappable || (g.phase === "discard" && !n) || (mode === "trade" && !n)} style={{
                flex: 1, minWidth: 0, borderRadius: 12, padding: "8px 4px 6px", cursor: tappable ? "pointer" : "default",
                background: `linear-gradient(180deg, ${SR_META[r].fill}, ${SR_META[r].fill}cc)`, color: SR_META[r].ink,
                border: selected || isGive ? `2px solid ${CAS.gold}` : "1px solid rgba(0,0,0,0.4)", boxShadow: selected || isGive ? `0 0 14px ${CAS.goldFaint}` : "0 4px 10px rgba(0,0,0,0.45)",
                opacity: tappable || n ? 1 : 0.55, transform: selected || isGive ? "translateY(-4px)" : "none", transition: "transform 120ms ease", position: "relative",
              }}>
                <div style={{ fontSize: 20, lineHeight: 1 }}>{SR_META[r].icon}</div>
                <div style={{ fontSize: 17, fontWeight: 900, fontVariantNumeric: "tabular-nums", marginTop: 3 }}>{n}</div>
                <div style={{ fontFamily: casMono, fontSize: 8.5, letterSpacing: "0.1em", opacity: 0.85 }}>{SR_META[r].name.toUpperCase()}</div>
                {selected > 0 && <span style={{ position: "absolute", top: -8, right: -4, background: CAS.gold, color: "#14171d", borderRadius: 999, fontSize: 10, fontWeight: 900, padding: "1px 6px" }}>−{selected}</span>}
              </button>
            );
          })}
        </div>
        {(me.dev.length > 0 || me.devNew.length > 0 || me.ribbons > 0) && (
          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
            {me.dev.map((k, i) => (
              <button key={"d" + i} onClick={() => playCard(k)} disabled={!myTurn || g.phase !== "main" || g.devPlayed || (mode && mode !== "trade")} title={SR_CARD[k].text} style={{ ...casGhost(), padding: "7px 10px", fontSize: 11, border: `1px solid ${CAS.goldLine}` }}>{SR_CARD[k].icon} {SR_CARD[k].name.toUpperCase()}</button>
            ))}
            {me.devNew.map((k, i) => (
              <span key={"n" + i} title="Bought this turn — playable next turn" style={{ ...casGhost(), padding: "7px 10px", fontSize: 11, opacity: 0.5 }}>{SR_CARD[k].icon} {SR_CARD[k].name.toUpperCase()} · NEXT TURN</span>
            ))}
            {me.ribbons > 0 && <span style={{ ...casGhost(), padding: "7px 10px", fontSize: 11, color: CAS.gold, border: `1px solid ${CAS.goldLine}` }}>🎀 ×{me.ribbons} · +{me.ribbons} PT</span>}
          </div>
        )}

        {/* the coach */}
        <div style={{ marginTop: 10, borderRadius: 14, border: `1px solid ${CAS.goldLine}`, background: "linear-gradient(180deg, rgba(245,197,66,0.08), rgba(16,20,26,0.92))", overflow: "hidden" }}>
          <button onClick={() => { sfx.click(); setCoachOpen(!coachOpen); }} style={{ width: "100%", textAlign: "left", padding: "9px 14px", cursor: "pointer", background: "none", border: "none", color: CAS.gold, fontFamily: casMono, fontSize: 10.5, letterSpacing: "0.16em", fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
            ★ THE COACH <span style={{ marginLeft: "auto", transform: coachOpen ? "rotate(90deg)" : "none", transition: "transform 160ms ease" }}>›</span>
          </button>
          {coachOpen && (
            <div style={{ padding: "0 14px 12px" }}>
              <div style={{ fontSize: 15.5, fontWeight: 900, color: CAS.cream }}>{coach.title}</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.6, color: CAS.dim, marginTop: 4 }}>{coach.why}</div>
              {coach.trade && myTurn && g.phase === "main" && !mode && (
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  {btn(`ASK THE TABLE · ${SR_META[coach.trade.give].icon}→${SR_META[coach.trade.get].icon}`, true, () => { sfx.click(); act((s) => srOfferTrade(s, coach.trade.give, coach.trade.get)); })}
                  {btn(`BANK ${coach.trade.ratio}:1`, true, () => { sfx.click(); act((s) => srBankTrade(s, coach.trade.give, coach.trade.get)); })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* the log */}
        <button onClick={() => { sfx.click(); setLogOpen(!logOpen); }} style={{ width: "100%", textAlign: "left", marginTop: 10, padding: "9px 12px", borderRadius: 12, cursor: "pointer", background: CAS.panel, border: `1px solid ${CAS.line}`, color: CAS.dim, fontFamily: casMono, fontSize: 11, lineHeight: 1.55 }}>
          {(logOpen ? g.log.slice(-30) : g.log.slice(-3)).map((l, i) => <div key={i} style={{ opacity: logOpen || i === 2 || g.log.length < 3 ? 1 : 0.6 }}>{l}</div>)}
        </button>

        <div style={{ marginTop: 10 }}>
          <MathNote>
            <div><b style={{ color: CAS.cream }}>Two dice, 36 outcomes.</b> Ways to roll: 2→1, 3→2, 4→3, 5→4, 6→5, 7→6, 8→5, 9→4, 10→3, 11→2, 12→1. The dots under each number token are exactly these. P(7) = 6/36 = 16.7%; P(6 or 8) = 10/36 = 27.8%.</div>
            <div style={{ marginTop: 6 }}><b style={{ color: CAS.cream }}>A corner's value</b> = the sum of its hexes' pips; the Coach adds small bonuses for variety, for goods you lack, and for trading posts — and the three ranchers use the identical function. Expected cards per roll = Σ pips/36 (×2 for a ranch).</div>
            <div style={{ marginTop: 6 }}><b style={{ color: CAS.cream }}>The board</b>: 19 hexes (4 wool, 4 lumber, 4 hay, 3 clay, 3 iron, 1 dust bowl), tokens 2–12 without 7, 6 and 8 never adjacent, 9 trading posts (4 at 3:1, one 2:1 per good), a bank of 19 of each good — if a roll asks for more than the bank holds and two ranchers want it, nobody gets it. Deck: 14 wranglers, 5 ribbons, 2 trail blazing, 2 bumper crop, 2 roundup. Longest Trail from 5 sides; Largest Posse from 3 wranglers; 10 points wins, on your own turn.</div>
            <div style={{ marginTop: 6 }}>No wager, no wallet: this is the study table. The ranchers are fictional.</div>
          </MathNote>
        </div>
      </div>

      {/* the rail */}
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 40, padding: "22px 12px calc(10px + env(safe-area-inset-bottom))", background: "linear-gradient(180deg, rgba(10,12,16,0), rgba(10,12,16,0.97) 16px, #0a0c10 30px)" }}>
        <div style={{ maxWidth: 600, margin: "0 auto" }}>{rail}</div>
      </div>

      {/* the finish */}
      {ended && !endDismissed && (
        <div onClick={() => setEndDismissed(true)} style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(5,7,10,0.78)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 420, borderRadius: 20, background: "linear-gradient(180deg, #141922, #0e1218)", border: `1px solid ${CAS.goldLine}`, boxShadow: `0 20px 80px rgba(0,0,0,0.8), 0 0 40px ${CAS.goldFaint}`, padding: "22px 20px 18px", textAlign: "center", animation: "casPop 300ms cubic-bezier(0.2,1.2,0.4,1) both", position: "relative" }}>
            <button onClick={() => setEndDismissed(true)} aria-label="Close" style={{ position: "absolute", top: 10, right: 10, width: 28, height: 28, borderRadius: 8, border: `1px solid ${CAS.line}`, background: "rgba(255,255,255,0.03)", color: CAS.dim, cursor: "pointer" }}>×</button>
            <div style={{ fontSize: 40 }}>{g.winner === 0 ? "🏆" : "🐑"}</div>
            <div style={{ fontFamily: casMono, fontSize: 10, letterSpacing: "0.22em", color: g.winner === 0 ? CAS.gold : CAS.dim, marginTop: 6 }}>{g.winner === 0 ? "YOU WON THE RANGE" : "THE RANGE IS SETTLED"}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: CAS.cream, marginTop: 4 }}>{g.winner === 0 ? `${srVP(g, 0)} points` : `${g.players[g.winner].name} — ${srVP(g, g.winner)} points`}</div>
            <div style={{ fontSize: 12.5, color: CAS.dim, marginTop: 8, lineHeight: 1.6 }}>
              {g.players.map((p) => `${p.name.split(" ")[0]} ${srVP(g, p.id)}`).join(" · ")}
            </div>
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
