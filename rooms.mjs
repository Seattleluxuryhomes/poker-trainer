/* Multiplayer rooms — server-authoritative hold'em over SSE, zero dependencies.
 *
 * The game rules are NOT reimplemented here: this module vm-loads the very same
 * src/engine.js + src/holdem.js the pages ship, so solo and multiplayer are
 * governed by one engine (the copy-it doctrine, applied to ourselves).
 *
 * Server-authoritative matters because opponents are real people: the deck and
 * every hidden hole card live only in server memory, and each seat receives a
 * REDACTED view (deck stripped, other holes hidden until the reveal). During a
 * runout the server computes the broadcast equities itself and ships bare
 * percentages, so a client never needs — and never gets — another's cards.
 *
 * CHARITY NIGHT (the founder's "$20k and then we go to a donation" flow, kept
 * legal by structure): pledges are numbers on screen, the app never holds or
 * routes money, no player can ever receive anything of value — the night's
 * leader wins only the right to pick the charity, and everyone donates their
 * own pledge directly on that charity's page. Nights are recorded (metadata
 * only) and signed-in players' "raised" tallies grow on their profiles.
 *
 * Rooms are in-memory (a night is ephemeral); records go to SQLite. Rooms work
 * with accounts disabled — playing never requires signing in.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import * as vm from "node:vm";
import { getDb, get, run, logEvent } from "./db.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));

/* ---- the one game engine, loaded from the shipped sources ---- */
const ctx = vm.createContext({ Math, JSON, console, Set, Array, Object, Number, Date });
vm.runInContext(readFileSync(join(ROOT, "src/engine.js"), "utf8"), ctx, { filename: "engine.js" });
vm.runInContext(readFileSync(join(ROOT, "src/holdem.js"), "utf8"), ctx, { filename: "holdem.js" });
const H = vm.runInContext(
  "({ makeTable, startHand, applyAction, legalActions, botDecide, runoutStep, equityMulti, mulberry32, SMALL_BLIND, BIG_BLIND, START_STACK })",
  ctx,
);

const rooms = new Map(); // code -> room
const ROOM_TTL_MS = 2 * 3600 * 1000;
const HUMAN_TIMEOUT_MS = 45 * 1000;
const BOT_DELAY_MS = 900;
const RUNOUT_STEP_MS = 1400;

const nowIso = () => new Date().toISOString();
const newCode = () => randomBytes(4).toString("hex").slice(0, 6).toUpperCase();
const newKey = () => randomBytes(18).toString("base64url");

function makeRoom({ hostName, charityNight, pledge, userId }) {
  let code = newCode();
  while (rooms.has(code)) code = newCode();
  const rng = H.mulberry32((Math.random() * 2 ** 31) | 0);
  const state = H.makeTable(0);
  state.players[0].name = hostName;
  state.players[0].tag = "host";
  const room = {
    code, createdAt: Date.now(), lastActive: Date.now(),
    rng,
    state,
    seats: [
      { human: true, name: hostName, key: newKey(), userId: userId || null, connected: 0 },
      null, null, null, // null = bot persona keeps the seat
    ],
    charityNight: !!charityNight,
    pledges: charityNight && pledge > 0 ? { 0: pledge } : {},
    charity: null,          // {winnerSeat, name, url, endedAt} once the night ends
    timer: null,
    subs: new Set(),        // {seat, res}
  };
  rooms.set(code, room);
  return room;
}

const roomOf = (code) => rooms.get(String(code || "").toUpperCase());
const isHuman = (room, seat) => !!room.seats[seat];
const authSeat = (room, seat, key) => {
  const s = room.seats[seat];
  return s && key && s.key === key;
};

/* ---- per-seat redaction: the security boundary of multiplayer ---- */
function redactedView(room, viewerSeat) {
  const s = JSON.parse(JSON.stringify(room.state));
  delete s.deck; // the deck NEVER leaves the server
  const show = s.revealed; // showdown / runout: live hands are public table-wide
  s.players.forEach((p, i) => {
    if (i !== viewerSeat && !(show && !p.folded)) p.hole = [];
  });
  return s;
}

function equitiesFor(room) {
  const st = room.state;
  if (st.phase !== "runout") return null;
  const live = st.players.map((_, i) => i).filter((i) => !st.players[i].folded);
  const pcts = H.equityMulti(live.map((i) => st.players[i].hole), st.board, room.rng);
  const out = {};
  live.forEach((i, k) => { out[i] = pcts[k]; });
  return out;
}

function payloadFor(room, viewerSeat) {
  const total = Object.values(room.pledges).reduce((a, b) => a + b, 0);
  return {
    type: "state",
    youSeat: viewerSeat,
    hostSeat: 0,
    state: redactedView(room, viewerSeat),
    equities: equitiesFor(room),
    seats: room.seats.map((s, i) => (s ? { human: true, name: s.name, connected: s.connected > 0 } : { human: false, name: room.state.players[i].name })),
    openSeats: room.seats.filter((s) => !s).length,
    charity: room.charityNight
      ? { night: true, total, pledges: room.pledges, picked: room.charity, winnerSeat: room.charity ? room.charity.winnerSeat : null }
      : { night: false },
  };
}

function broadcast(room) {
  room.lastActive = Date.now();
  for (const sub of room.subs) {
    try {
      sub.res.write(`data: ${JSON.stringify(payloadFor(room, sub.seat))}\n\n`);
    } catch { room.subs.delete(sub); }
  }
}

/* ---- the pump: after every state change, schedule whatever moves next ---- */
function pump(room) {
  clearTimeout(room.timer);
  const st = room.state;
  if (st.phase === "runout") {
    room.timer = setTimeout(() => {
      room.state = H.runoutStep(room.state);
      broadcast(room);
      pump(room);
    }, RUNOUT_STEP_MS);
    return;
  }
  if (st.phase !== "betting" || st.toAct < 0) return;
  const seat = st.toAct;
  if (!isHuman(room, seat)) {
    room.timer = setTimeout(() => {
      if (room.state.phase !== "betting" || room.state.toAct !== seat) return;
      room.state = H.applyAction(room.state, H.botDecide(room.state, room.rng));
      broadcast(room);
      pump(room);
    }, BOT_DELAY_MS);
  } else {
    // A vanished human never hangs the table: check when free, else fold.
    room.timer = setTimeout(() => {
      if (room.state.phase !== "betting" || room.state.toAct !== seat) return;
      const la = H.legalActions(room.state);
      room.state = H.applyAction(room.state, la.canCheck ? { type: "call" } : { type: "fold" });
      broadcast(room);
      pump(room);
    }, HUMAN_TIMEOUT_MS);
  }
}

/* ---- night record (metadata only, their log_event discipline) ---- */
function recordNight(room) {
  const total = Object.values(room.pledges).reduce((a, b) => a + b, 0);
  const winner = room.state.players[room.charity.winnerSeat];
  if (getDb()) {
    run(`INSERT INTO nights (code, ended_at, charity_name, charity_url, winner_name, total_pledged, players)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      room.code, nowIso(), room.charity.name, room.charity.url, winner.name, total,
      JSON.stringify(room.seats.map((s, i) => (s ? s.name : room.state.players[i].name))));
    for (let i = 0; i < 4; i++) {
      const s = room.seats[i];
      const pledge = room.pledges[i] || 0;
      if (s && s.userId && pledge > 0) {
        run("UPDATE stats SET raised = raised + ? WHERE user_id = ?", pledge, s.userId);
        logEvent(s.userId, "charity_night", { pledged: pledge });
      }
    }
  }
}

/* ---- HTTP surface ---- */
class HttpError extends Error { constructor(status, detail) { super(detail); this.status = status; this.detail = detail; } }
const err = (status, detail) => { throw new HttpError(status, detail); };

const cleanName = (v) => {
  const s = String(v || "").trim().slice(0, 24);
  if (!s) err(400, "A name is required");
  return s;
};
const cleanPledge = (v) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, 1000000) : 0;
};

export async function handleRoom(req, res, path, { corsHeaders, userIdFrom }) {
  const cors = corsHeaders(req);
  const send = (status, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), ...cors });
    res.end(body);
  };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }

  let body = {};
  if (req.method === "POST") {
    const chunks = [];
    let size = 0;
    for await (const c of req) { size += c.length; if (size > 16 * 1024) return send(413, { detail: "Body too large" }); chunks.push(c); }
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}; } catch { return send(400, { detail: "Invalid JSON" }); }
  }

  const m = /^\/api\/room(?:\/([A-Za-z0-9]{4,10}))?(?:\/([a-z-]+))?$/.exec(path);
  if (!m) return send(404, { detail: "Not found" });
  const [, codeRaw, verb] = m;

  try {
    /* create */
    if (!codeRaw && req.method === "POST") {
      const room = makeRoom({
        hostName: cleanName(body.name),
        charityNight: !!body.charity_night,
        pledge: cleanPledge(body.pledge),
        userId: userIdFrom(req),
      });
      logEvent(null, "room_created", { charity: room.charityNight });
      return send(200, { code: room.code, seat: 0, key: room.seats[0].key });
    }
    const room = roomOf(codeRaw);
    if (!room) err(404, "That room doesn't exist (or its night is over).");

    /* info (pre-join) */
    if (verb === "info" && req.method === "GET") {
      return send(200, {
        code: room.code, openSeats: room.seats.filter((s) => !s).length,
        charity_night: room.charityNight,
        players: room.seats.map((s, i) => (s ? s.name : room.state.players[i].name)),
      });
    }

    /* join */
    if (verb === "join" && req.method === "POST") {
      if (room.state.phase === "betting" || room.state.phase === "runout")
        err(409, "A hand is being played — seats open between hands. Try again in a moment.");
      const seat = room.seats.findIndex((s) => !s);
      if (seat < 0) err(409, "The table is full.");
      const name = cleanName(body.name);
      room.seats[seat] = { human: true, name, key: newKey(), userId: userIdFrom(req), connected: 0 };
      room.state.players[seat].name = name;
      room.state.players[seat].tag = "";
      const pledge = cleanPledge(body.pledge);
      if (room.charityNight && pledge > 0) room.pledges[seat] = pledge;
      broadcast(room);
      return send(200, { code: room.code, seat, key: room.seats[seat].key });
    }

    /* SSE stream */
    if (verb === "events" && req.method === "GET") {
      const q = new URL(req.url, "http://x").searchParams;
      const seat = Number(q.get("seat"));
      if (!authSeat(room, seat, q.get("key"))) err(401, "Bad seat credentials");
      res.writeHead(200, {
        "content-type": "text/event-stream", "cache-control": "no-cache",
        connection: "keep-alive", "x-accel-buffering": "no", ...cors,
      });
      const sub = { seat, res };
      room.subs.add(sub);
      room.seats[seat].connected++;
      res.write(`data: ${JSON.stringify(payloadFor(room, seat))}\n\n`);
      broadcast(room); // others see the connect dot
      const ping = setInterval(() => { try { res.write(":ping\n\n"); } catch { /* closed */ } }, 25000);
      req.on("close", () => {
        clearInterval(ping);
        room.subs.delete(sub);
        if (room.seats[seat]) room.seats[seat].connected--;
        broadcast(room);
      });
      return;
    }

    /* everything below requires seat credentials in the body */
    const seat = Number(body.seat);
    if (!authSeat(room, seat, body.key)) err(401, "Bad seat credentials");

    if (verb === "deal" && req.method === "POST") {
      if (seat !== 0) err(403, "Only the host deals the next hand.");
      if (room.state.phase === "betting" || room.state.phase === "runout") err(409, "A hand is in progress.");
      if (room.charity) err(409, "The night has ended.");
      room.state = H.startHand(room.state, room.rng);
      broadcast(room);
      pump(room);
      return send(200, { ok: true });
    }

    if (verb === "act" && req.method === "POST") {
      if (room.state.phase !== "betting" || room.state.toAct !== seat) err(409, "Not your turn.");
      const a = body.action || {};
      if (!["fold", "call", "raise"].includes(a.type)) err(400, "Unknown action");
      room.state = H.applyAction(room.state, a.type === "raise" ? { type: "raise", to: Number(a.to) || 0 } : { type: a.type });
      broadcast(room);
      pump(room);
      return send(200, { ok: true });
    }

    if (verb === "end-night" && req.method === "POST") {
      if (seat !== 0) err(403, "Only the host ends the night.");
      if (!room.charityNight) err(400, "Not a charity night.");
      if (room.state.phase === "betting" || room.state.phase === "runout") err(409, "Finish the hand first.");
      if (room.charity) err(409, "Already ended.");
      const stacks = room.state.players.map((p) => p.stack);
      const winnerSeat = stacks.indexOf(Math.max(...stacks));
      room.charity = { winnerSeat, name: null, url: null, endedAt: nowIso() };
      broadcast(room);
      return send(200, { ok: true, winnerSeat });
    }

    if (verb === "charity" && req.method === "POST") {
      if (!room.charity) err(409, "The night hasn't ended.");
      if (seat !== room.charity.winnerSeat) err(403, "The night's leader picks the charity.");
      if (room.charity.name) err(409, "Already picked.");
      const name = String(body.name || "").trim().slice(0, 80);
      const url = String(body.url || "").trim().slice(0, 300);
      if (!name) err(400, "Charity name required");
      if (url && !/^https:\/\//.test(url)) err(400, "Charity link must be https://");
      room.charity.name = name;
      room.charity.url = url || null;
      recordNight(room);
      broadcast(room);
      return send(200, { ok: true });
    }

    return send(404, { detail: "Not found" });
  } catch (e) {
    if (e && e.status) return send(e.status, { detail: e.detail });
    console.error("room error:", e);
    return send(500, { detail: "Internal server error" });
  }
}

/* idle-room GC */
setInterval(() => {
  const cutoff = Date.now() - ROOM_TTL_MS;
  for (const [code, room] of rooms) {
    if (room.lastActive < cutoff) {
      clearTimeout(room.timer);
      for (const sub of room.subs) { try { sub.res.end(); } catch { /* gone */ } }
      rooms.delete(code);
    }
  }
}, 10 * 60 * 1000).unref();
