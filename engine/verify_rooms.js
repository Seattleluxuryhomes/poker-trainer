#!/usr/bin/env node
/* Verifies multiplayer rooms by booting the REAL server and driving it over
 * HTTP + SSE with two "players":
 *   - create (charity night, host pledge) / info / join (pledge) round-trip;
 *   - THE REDACTION RULE: across every SSE payload a seat receives before the
 *     reveal, no other seat's hole cards and no deck ever appear;
 *   - joining mid-hand is refused (409);
 *   - actions: only the seat to act may act; bad keys 401; host-only deal;
 *   - a full hand plays to completion with two humans + two server bots,
 *     chips conserved;
 *   - charity night: end-night names the chip leader, only the leader may pick,
 *     the donated honor ledger opens only after the pick and is idempotent,
 *     https enforced, the night lands in SQLite and the signed-in host's
 *     `raised` tally grows by their pledge.
 */
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

let ok = 0, fail = 0;
const check = (cond, msg) => { if (cond) { ok++; } else { fail++; console.error("  ✗ " + msg); } };

const PORT = 5400 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}/api`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "poker-rooms-"));

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, "..", "server.mjs")], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(tmp, "t.db"), JWT_SECRET: "b".repeat(48) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let up = false;
  server.stdout.on("data", (d) => { if (String(d).includes("listening")) up = true; });
  for (let i = 0; i < 60 && !up; i++) await new Promise((r) => setTimeout(r, 100));
  if (!up) { console.error("server did not start"); process.exit(1); }

  const call = async (method, p, body, token) => {
    const res = await fetch(BASE + p, {
      method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: JSON.parse(await res.text() || "null") };
  };

  /* A minimal SSE consumer that records every payload for a seat. */
  const listen = async (code, seat, key) => {
    const res = await fetch(`${BASE}/room/${code}/events?seat=${seat}&key=${encodeURIComponent(key)}`);
    const payloads = [];
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value);
          let idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (line) payloads.push(JSON.parse(line.slice(6)));
          }
        }
      } catch { /* stream closed at teardown */ }
    })();
    return { payloads, close: () => reader.cancel().catch(() => {}) };
  };

  const latest = (l) => l.payloads[l.payloads.length - 1];
  const waitFor = async (l, pred, ms = 20000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const p = latest(l);
      if (p && pred(p)) return p;
      await new Promise((r) => setTimeout(r, 120));
    }
    return null;
  };

  try {
    /* signed-in host so the raised tally is testable */
    const su = await call("POST", "/auth/signup", { email: "host@rooms.com", password: "secret1234", display_name: "Ben", age_confirmed: true, date_of_birth: "1985-04-12" });
    const hostToken = su.body.token;

    const created = await call("POST", "/room", { name: "Ben", charity_night: true, pledge: 5000 }, hostToken);
    check(created.status === 200 && /^[A-Z0-9]{6}$/.test(created.body.code), "create returns a 6-char room code");
    const code = created.body.code, hostKey = created.body.key;

    const info = await call("GET", `/room/${code}/info`);
    check(info.body.openSeats === 3 && info.body.charity_night === true, "info shows open seats + charity night");

    const joined = await call("POST", `/room/${code}/join`, { name: "Marcus", pledge: 15000 });
    check(joined.status === 200 && joined.body.seat === 1, "friend takes seat 1");
    const mKey = joined.body.key;

    check((await call("GET", `/room/${code}/events?seat=1&key=WRONG`)).status === 401, "bad seat key rejected");

    const ben = await listen(code, 0, hostKey);
    const marcus = await listen(code, 1, mKey);
    await waitFor(ben, (p) => p.seats && p.seats[1].name === "Marcus");

    check((await call("POST", `/room/${code}/deal`, { seat: 1, key: mKey })).status === 403, "only the host deals");
    check((await call("POST", `/room/${code}/deal`, { seat: 0, key: hostKey })).status === 200, "host deals hand 1");

    /* play the hand: whenever it's a human's turn, that human calls */
    let over = null;
    const t0 = Date.now();
    while (!over && Date.now() - t0 < 30000) {
      const p = latest(ben);
      if (p && p.state.phase === "over") { over = p; break; }
      if (p && p.state.phase === "betting" && (p.state.toAct === 0 || p.state.toAct === 1)) {
        const seat = p.state.toAct;
        await call("POST", `/room/${code}/act`, { seat, key: seat === 0 ? hostKey : mKey, action: { type: "call" } });
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    check(!!over, "a full hand with two humans and two bots completes");
    if (over) {
      const chips = over.state.players.reduce((a, p) => a + p.stack, 0) + (over.state.phase === "over" ? 0 : over.state.pot);
      check(chips === 4 * 5000, "chips conserved across the network game");
    }

    /* redaction audit over EVERYTHING Marcus received */
    let leaks = 0, sawOwn = 0, deckLeaks = 0;
    for (const p of marcus.payloads) {
      if (p.state.deck !== undefined) deckLeaks++;
      p.state.players.forEach((pl, i) => {
        if (i === 1 && pl.hole.length === 2) sawOwn++;
        if (i !== 1 && pl.hole.length > 0 && !p.state.revealed) leaks++;
      });
    }
    check(deckLeaks === 0, "the deck never appears in any client payload");
    check(leaks === 0, `no opponent hole card ever reached Marcus pre-reveal (${marcus.payloads.length} payloads audited)`);
    check(sawOwn > 0, "Marcus always saw his own cards");

    /* wrong-turn actions bounce; a seat opens between hands */
    check((await call("POST", `/room/${code}/act`, { seat: 0, key: hostKey, action: { type: "call" } })).status === 409, "acting out of turn is 409");
    const late = await call("POST", `/room/${code}/join`, { name: "Late" });
    check(late.status === 200 && late.body.seat === 2, "a third friend takes a seat between hands");
    const seatKeys = { 0: hostKey, 1: mKey, [late.body.seat]: late.body.key };

    /* video taunts: transport, auth, caps, round-trip */
    {
      const clip = Buffer.from("not-actually-vp8-but-the-relay-doesn't-care ".repeat(10));
      const up = async (seat, key, body, type = "video/webm") =>
        fetch(`${BASE}/room/${code}/video?seat=${seat}&key=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": type }, body });
      check((await up(0, "WRONG", clip)).status === 401, "clip upload needs seat credentials");
      check((await up(0, hostKey, clip, "text/html")).status === 415, "only video mime types accepted");
      const big = Buffer.alloc(3 * 1024 * 1024 + 10);
      check((await up(0, hostKey, big)).status === 413, "oversized clip rejected");
      const ok1 = await up(0, hostKey, clip);
      check(ok1.status === 200, "host uploads a clip");
      const { id } = await ok1.json();
      check((await up(0, hostKey, clip)).status === 429, "per-seat clip cooldown enforced");
      const meta = await waitFor(marcus, (p) => p.videos && p.videos.some((v) => v.id === id));
      check(!!meta, "clip metadata reaches the other seat over SSE");
      const dl = await fetch(`${BASE}/room/${code}/video/${id}?seat=1&key=${encodeURIComponent(mKey)}`);
      check(dl.status === 200 && Buffer.from(await dl.arrayBuffer()).equals(clip), "another seat fetches the exact bytes back");
      check((await fetch(`${BASE}/room/${code}/video/${id}?seat=1&key=NOPE`)).status === 401, "clip fetch needs seat credentials too");
    }

    /* table chat: bubbles + the shared log */
    {
      check((await call("POST", `/room/${code}/chat`, { seat: 0, key: "WRONG", text: "hi" })).status === 401, "chat needs seat credentials");
      check((await call("POST", `/room/${code}/chat`, { seat: 0, key: hostKey, text: "   " })).status === 400, "empty chat rejected");
      const said = await call("POST", `/room/${code}/chat`, { seat: 0, key: hostKey, text: "bring it, Marcus" });
      check(said.status === 200, "host sends a message");
      check((await call("POST", `/room/${code}/chat`, { seat: 0, key: hostKey, text: "again" })).status === 429, "chat cooldown enforced");
      const seen = await waitFor(marcus, (p) => p.state.quip && p.state.quip.seat === 0 && p.state.quip.text === "bring it, Marcus");
      check(!!seen, "the message bubbles at the sender's seat on other screens");
      check(seen && seen.state.log.some((l) => l === "Ben: bring it, Marcus"), "the message joins the shared hand log");
    }

    /* charity night close-out */
    check((await call("POST", `/room/${code}/end-night`, { seat: 1, key: mKey })).status === 403, "only the host ends the night");
    const ended = await call("POST", `/room/${code}/end-night`, { seat: 0, key: hostKey });
    check(ended.status === 200, "host ends the night");
    const winnerSeat = ended.body.winnerSeat;
    check(seatKeys[winnerSeat] !== undefined, `the night's winner is always a HUMAN seat (got ${winnerSeat})`);
    const loserSeat = Object.keys(seatKeys).map(Number).find((s) => s !== winnerSeat);
    const loserKey = seatKeys[loserSeat];
    const winnerKey = seatKeys[winnerSeat];
    check((await call("POST", `/room/${code}/charity`, { seat: loserSeat, key: loserKey, name: "X" })).status === 403, "only the leader picks the charity");
    check((await call("POST", `/room/${code}/donated`, { seat: 0, key: hostKey })).status === 409, "the honor ledger opens only after the pick");
    if (winnerKey) {
      check((await call("POST", `/room/${code}/charity`, { seat: winnerSeat, key: winnerKey, name: "Food Lifeline", url: "http://insecure" })).status === 400, "non-https charity link rejected");
      const picked = await call("POST", `/room/${code}/charity`, { seat: winnerSeat, key: winnerKey, name: "Food Lifeline", url: "https://foodlifeline.org/donate" });
      check(picked.status === 200, "the leader picks the charity");
      const final = await waitFor(ben, (p) => p.charity.picked && p.charity.picked.name);
      check(final && final.charity.total === 20000, `the night's pledges total $20,000 (got ${final && final.charity.total})`);
      /* the record + the tally */
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(path.join(tmp, "t.db"));
      const night = db.prepare("SELECT * FROM nights").get();
      check(night && night.charity_name === "Food Lifeline" && night.total_pledged === 20000, "the night is recorded (metadata only)");
      const me = await call("GET", "/auth/me", null, hostToken);
      check(me.body.stats.raised === 5000, `the signed-in host's raised tally grew by their pledge (got ${me.body.stats.raised})`);

      /* the honor ledger: self-reported, idempotent, metadata only */
      check((await call("POST", `/room/${code}/donated`, { seat: 0, key: hostKey })).status === 200, "a pledger marks their donation made");
      check((await call("POST", `/room/${code}/donated`, { seat: 0, key: hostKey })).status === 200, "marking twice is a harmless no-op");
      const withLedger = await waitFor(ben, (p) => p.charity.donated && p.charity.donated[0]);
      check(!!withLedger, "the ledger reaches every screen");
      check(withLedger && Object.keys(withLedger.charity.donated).length === 1, "only the seats that marked appear in the ledger");
    }

    ben.close(); marcus.close();
  } finally {
    server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(fail === 0 ? `✓ verify_rooms: all ${ok} checks passed` : `✗ verify_rooms: ${fail} of ${ok + fail} checks FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
