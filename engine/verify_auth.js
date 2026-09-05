#!/usr/bin/env node
/* Verifies the accounts API by booting the REAL server (server.mjs) on a temp
 * database and driving it over HTTP — the same way maybe.love's backend tests
 * exercise their FastAPI app. Checks the ported behavior contracts:
 *   - signup: happy path returns {token, user, stats}; underage 400 BEFORE any
 *     write; duplicate email 409; short password 400;
 *   - signin: wrong password 401; case-insensitive email; suspended untested
 *     (no admin surface yet) but deleted -> 410 with days left ONLY on the
 *     correct password (their enumeration hardening);
 *   - /auth/me round-trip; garbage/forged tokens 401;
 *   - PATCH /profile: exclude-unset merge never blanks; avatar allowlist;
 *   - PUT /stats: server clamps (counters monotonic, values bounded);
 *   - leaderboard: only opted-in players, allowlist fields only;
 *   - soft delete -> signin 410 -> restore returns a working session;
 *   - the no-leak rule (their test_no_mongo_id_leaks, ported): NO response
 *     anywhere contains password_hash, and the public leaderboard never
 *     contains an email;
 *   - signin rate ledger: 5 failed for one email -> 429.
 */
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

let ok = 0, fail = 0;
const check = (cond, msg) => { if (cond) { ok++; } else { fail++; console.error("  ✗ " + msg); } };

const PORT = 4900 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}/api`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "poker-auth-"));

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, "..", "server.mjs")], {
    env: { ...process.env, PORT: String(PORT), DB_PATH: path.join(tmp, "test.db"), JWT_SECRET: "a".repeat(48), REQUIRE_STRONG_SECRETS: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let up = false;
  server.stdout.on("data", (d) => { if (String(d).includes("listening")) up = true; });
  const errs = [];
  server.stderr.on("data", (d) => { const s = String(d); if (!s.includes("Experimental")) errs.push(s); });
  for (let i = 0; i < 60 && !up; i++) await new Promise((r) => setTimeout(r, 100));
  if (!up) { console.error("server did not start", errs.join("")); process.exit(1); }

  const responses = [];
  const call = async (method, p, body, token) => {
    const res = await fetch(BASE + p, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    responses.push(text);
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  try {
    /* production front door: every page the build ships must actually be served.
     * (v0.13.0 lesson: bj.html shipped in the build but not in the whitelist —
     * the founder's phone found the 404 before we did. Never again.) */
    const ORIGIN = BASE.replace(/\/api$/, "");
    for (const page of ["/", "/index.html", "/trainer.html", "/play.html", "/table.html", "/profile.html", "/roulette.html", "/craps.html", "/paigow.html", "/bj.html"]) {
      const r = await fetch(ORIGIN + page);
      const ct = r.headers.get("content-type") || "";
      check(r.status === 200 && ct.includes("text/html"), `served: ${page} (got ${r.status})`);
    }
    for (const asset of ["/favicon.svg", "/manifest.webmanifest", "/vendor/react.production.min.js", "/vendor/react-dom.production.min.js"]) {
      const r = await fetch(ORIGIN + asset);
      check(r.status === 200, `served: ${asset} (got ${r.status})`);
    }
    {
      const r = await fetch(ORIGIN + "/does-not-exist.html");
      const text404 = await r.text();
      check(r.status === 404, "the whitelist still refuses everything else");
      check(/NOT ON THE FLOOR/.test(text404) && /BACK TO THE ENTRANCE/.test(text404), "the 404 is a page of the house, with a way home");
      const rHtml = await fetch(ORIGIN + "/index.html");
      check((rHtml.headers.get("cache-control") || "") === "no-cache", "HTML revalidates on every load (deploys reach phones)");
      const rVendor = await fetch(ORIGIN + "/vendor/react.production.min.js");
      check(/immutable/.test(rVendor.headers.get("cache-control") || ""), "vendor React caches long");
      const rGz = await fetch(ORIGIN + "/index.html", { headers: { "accept-encoding": "gzip" } });
      check(rGz.status === 200 && (await rGz.text()).includes("<!doctype html"), "gzip-negotiated HTML still decodes to the page");
    }

    /* signup contracts */
    const su = await call("POST", "/auth/signup", { email: "Ben@Test.com", password: "secret1234", display_name: "Ben", age_confirmed: true, date_of_birth: "1985-04-12" });
    check(su.status === 200 && su.body.token && su.body.user.email === "ben@test.com", "signup returns a session, email lowercased");
    check(su.body.user.id && !("password_hash" in su.body.user), "owner view has an id and no hash");
    check(su.body.stats.bankroll === 200 && su.body.stats.table_stack === 5000, "fresh stats carry the app defaults");
    const dup = await call("POST", "/auth/signup", { email: "ben@test.com", password: "secret1234", display_name: "Ben2", age_confirmed: true, date_of_birth: "1985-04-12" });
    check(dup.status === 409, `duplicate email is 409 (got ${dup.status})`);
    const young = await call("POST", "/auth/signup", { email: "kid@test.com", password: "secret1234", display_name: "Kid", age_confirmed: true, date_of_birth: new Date().getFullYear() - 17 + "-01-01" });
    check(young.status === 400, "17-year-old rejected");
    const unconfirmed = await call("POST", "/auth/signup", { email: "x@test.com", password: "secret1234", display_name: "X", age_confirmed: false, date_of_birth: "1985-04-12" });
    check(unconfirmed.status === 400 && /18\+/.test(unconfirmed.body.detail), "age_confirmed is required");
    const shortpw = await call("POST", "/auth/signup", { email: "y@test.com", password: "short", display_name: "Y", age_confirmed: true, date_of_birth: "1985-04-12" });
    check(shortpw.status === 400, "short password rejected");

    /* signin + token contracts */
    const si = await call("POST", "/auth/signin", { email: "BEN@TEST.COM", password: "secret1234" });
    check(si.status === 200, "signin is email-case-insensitive");
    const tok = si.body.token;
    const wrong = await call("POST", "/auth/signin", { email: "ben@test.com", password: "nope-nope-nope" });
    check(wrong.status === 401 && wrong.body.detail === "Invalid credentials", "wrong password says only 'Invalid credentials'");
    const me = await call("GET", "/auth/me", null, tok);
    check(me.status === 200 && me.body.user.display_name === "Ben" && Array.isArray(me.body.trainer_history), "auth/me round-trips with history");
    const forged = tok.slice(0, -3) + "xxx";
    check((await call("GET", "/auth/me", null, forged)).status === 401, "tampered token is 401");
    check((await call("GET", "/auth/me", null, "not.a.jwt")).status === 401, "garbage token is 401");

    /* profile merge semantics */
    const p1 = await call("PATCH", "/profile", { avatar: "🦈" }, tok);
    check(p1.status === 200 && p1.body.user.avatar === "🦈" && p1.body.user.display_name === "Ben", "PATCH with only avatar never blanks the name (exclude-unset)");
    check((await call("PATCH", "/profile", { avatar: "💣" }, tok)).status === 400, "avatar outside the allowlist rejected");
    await call("PATCH", "/profile", { leaderboard_ok: true }, tok);

    /* stats clamps */
    const st = await call("PUT", "/stats", { table_stack: 9000, table_hands: 5, biggest_pot: 7000, trainer_hands: 10, trainer_optimal: 8, trainer_ev_lost: 1.25, today: { hands: 10, optimal: 8, ev_lost: 1.25 } }, tok);
    check(st.status === 200 && st.body.stats.table_hands === 5, "stats accepted");
    const stale = await call("PUT", "/stats", { table_hands: 2, biggest_pot: 100, table_stack: 8000 }, tok);
    check(stale.body.stats.table_hands === 5 && stale.body.stats.biggest_pot === 7000, "counters are monotonic — a stale client can't erase play");
    check(stale.body.stats.table_stack === 8000, "current-value fields do move");
    const evil = await call("PUT", "/stats", { table_stack: 1e18 }, tok);
    check(evil.body.stats.table_stack === 1e9, "values are clamped to sane bounds");

    /* leaderboard: opted-in only + allowlist */
    const su2 = await call("POST", "/auth/signup", { email: "quiet@test.com", password: "secret1234", display_name: "Quiet", age_confirmed: true, date_of_birth: "1990-01-01" });
    const lb = await call("GET", "/leaderboard");
    check(lb.status === 200 && lb.body.players.length === 1 && lb.body.players[0].display_name === "Ben", "leaderboard lists ONLY opted-in players");
    const lbKeys = Object.keys(lb.body.players[0]).sort().join(",");
    check(lbKeys === "avatar,biggest_pot,display_name,raised,table_hands,table_stack,table_wins", `leaderboard fields are exactly the allowlist (got ${lbKeys})`);

    /* export */
    const ex = await call("GET", "/auth/export", null, tok);
    check(ex.status === 200 && ex.body.user && ex.body.stats && Array.isArray(ex.body.events), "export returns everything held");

    /* soft delete -> 410 (password-gated) -> restore */
    const del = await call("DELETE", "/auth/me", null, su2.body.token);
    check(del.status === 200, "delete succeeds");
    const goneWrong = await call("POST", "/auth/signin", { email: "quiet@test.com", password: "wrongwrong1" });
    check(goneWrong.status === 401, "deleted + WRONG password reveals nothing (401, not 410)");
    const gone = await call("POST", "/auth/signin", { email: "quiet@test.com", password: "secret1234" });
    check(gone.status === 410 && /restore/.test(gone.body.detail), "deleted + correct password gets the 410 restore offer");
    const rest = await call("POST", "/auth/restore", { email: "quiet@test.com", password: "secret1234" });
    check(rest.status === 200 && rest.body.token, "restore returns a working session");
    check((await call("GET", "/auth/me", null, rest.body.token)).status === 200, "restored session works");

    /* signin ledger: 5 fails for one email -> 429 */
    for (let i = 0; i < 5; i++) await call("POST", "/auth/signin", { email: "quiet@test.com", password: "badbadbad" + i });
    const limited = await call("POST", "/auth/signin", { email: "quiet@test.com", password: "secret1234" });
    check(limited.status === 429, `6th attempt for one email is rate-limited (got ${limited.status})`);

    /* the no-leak rule, over EVERY response this suite saw */
    const blob = responses.join("\n");
    check(!blob.includes("password_hash") && !blob.includes("scrypt$"), "no response anywhere contains a password hash");
    check(!JSON.stringify(lb.body).includes("@"), "the public leaderboard never contains an email");
  } finally {
    server.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  /* ---- zero-config mode: no JWT_SECRET anywhere ----
   * The server must provision its own secret, persist it beside the DB, and a
   * RESTART on the same disk must honor tokens minted before it. This is the
   * founder's "I don't think I need to install variables" made a contract. */
  {
    const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "poker-auth-zc-"));
    const PORT2 = PORT + 1;
    const env2 = { ...process.env, PORT: String(PORT2), DB_PATH: path.join(tmp2, "zc.db") };
    delete env2.JWT_SECRET;
    delete env2.REQUIRE_STRONG_SECRETS;
    const boot = () => {
      const p = spawn(process.execPath, [path.join(__dirname, "..", "server.mjs")], { env: env2 });
      return p;
    };
    const waitUp = async () => {
      for (let i = 0; i < 60; i++) {
        try { const r = await fetch(`http://127.0.0.1:${PORT2}/api/health`); if (r.ok) return r.json(); } catch { /* booting */ }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error("zero-config server did not start");
    };
    let p2 = boot();
    try {
      const health = await waitUp();
      check(health.accounts === true, "no env vars at all: accounts are still ON (self-provisioned secret)");
      const secretOnDisk = fs.readFileSync(path.join(tmp2, "jwt-secret"), "utf8").trim();
      check(secretOnDisk.length === 64, "the provisioned secret is 64 hex chars beside the DB");
      const su = await (await fetch(`http://127.0.0.1:${PORT2}/api/auth/signup`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "zc@test.com", password: "secret1234", display_name: "ZC", age_confirmed: true, date_of_birth: "1985-04-12" }),
      })).json();
      check(!!su.token, "signup works with zero configuration");
      p2.kill();
      await new Promise((r) => setTimeout(r, 300));
      p2 = boot();
      await waitUp();
      const me = await fetch(`http://127.0.0.1:${PORT2}/api/auth/me`, { headers: { authorization: `Bearer ${su.token}` } });
      check(me.status === 200, "after a restart on the same disk, the old token still works (secret persisted)");
    } finally {
      p2.kill();
      fs.rmSync(tmp2, { recursive: true, force: true });
    }
  }

  console.log(fail === 0 ? `✓ verify_auth: all ${ok} checks passed` : `✗ verify_auth: ${fail} of ${ok + fail} checks FAILED`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
