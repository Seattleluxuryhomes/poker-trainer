/* Accounts API — a port of maybe.love's auth/profile backend
 * (app repo: backend/server.py, auth at L991-2400), translated per the
 * founder's doctrine: same routes, same fields, same defaults, same rulings,
 * verbatim in behavior; only the runtime translated. Documented deviations:
 *   - bcrypt        -> node:crypto scrypt (zero-dependency rule)
 *   - PyJWT HS256   -> hand-rolled HS256 on node:crypto, algorithm pinned
 *   - Mongo         -> node:sqlite (db.mjs; the BidVoice precedent)
 *   - forgot/reset-password, email verification, Google sign-in: deferred
 *     until email infra exists (their flows need outbound mail).
 * Behaviors kept verbatim include: 7-day bearer token, no refresh token, no
 * logout endpoint; iat < password_changed_at kills every older session; the
 * 18+ age gate checked before any DB write; signup/signin rate-limit ledgers
 * with their exact thresholds; deleted accounts answering 410 with days left
 * ONLY after the password verifies (their enumeration-oracle hardening);
 * uuid ids; and the two-serializer invariant (ownerView for every
 * self-response; publicView built from an explicit allowlist).
 *
 * If JWT_SECRET is absent the accounts API answers 503 and the static site
 * still serves — playing never requires an account, and a half-configured
 * server must say so honestly rather than mint unverifiable tokens.
 */
import { createHmac, randomUUID, scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { get, all, run, purgeLedgers, logEvent } from "./db.mjs";

const ACCESS_HOURS = parseInt(process.env.ACCESS_TOKEN_EXPIRE_HOURS || "168", 10); // their default: 7 days
const DELETE_GRACE_DAYS = 30;
const JWT_SECRET = process.env.JWT_SECRET || "";
const CORS_ORIGINS = (process.env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
const AVATARS = ["🂠", "♠️", "♥️", "♦️", "♣️", "🎩", "🦊", "🦈", "🐺", "🃏", "🤠", "👑"];

export const accountsEnabled = () => JWT_SECRET.length > 0;
export function assertSecretStrength() {
  // Their startup guard: REQUIRE_STRONG_SECRETS rejects a short/placeholder secret.
  if (JWT_SECRET && JWT_SECRET.length < 32 && process.env.REQUIRE_STRONG_SECRETS === "true")
    throw new Error("JWT_SECRET is too short (<32 chars) with REQUIRE_STRONG_SECRETS=true");
}

/* ---- passwords: scrypt (bcrypt's role, zero-dep) ---- */
const hashPw = (pw) => {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$${salt}$${scryptSync(pw, salt, 64).toString("hex")}`;
};
const verifyPw = (pw, stored) => {
  try {
    const [algo, salt, hash] = String(stored).split("$");
    if (algo !== "scrypt") return false;
    return timingSafeEqual(scryptSync(pw, salt, 64), Buffer.from(hash, "hex"));
  } catch { return false; }
};

/* ---- tokens: HS256 JWT, algorithm pinned (their JWT_ALGO guard) ---- */
const b64u = (buf) => Buffer.from(buf).toString("base64url");
export function makeToken(userId, role, nowSec = Math.floor(Date.now() / 1000)) {
  const header = b64u(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64u(JSON.stringify({ sub: userId, role, iat: nowSec, exp: nowSec + ACCESS_HOURS * 3600 }));
  const sig = createHmac("sha256", JWT_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}
export function decodeToken(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  const expect = createHmac("sha256", JWT_SECRET).update(`${parts[0]}.${parts[1]}`).digest();
  const got = Buffer.from(parts[2], "base64url");
  if (expect.length !== got.length || !timingSafeEqual(expect, got)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[1], "base64url").toString()); } catch { return null; }
  if (typeof payload.exp !== "number" || payload.exp < Date.now() / 1000) return null;
  return payload;
}

/* ---- errors as FastAPI shapes them: {detail} with the status ---- */
class HttpError extends Error { constructor(status, detail) { super(detail); this.status = status; this.detail = detail; } }
const err = (status, detail) => { throw new HttpError(status, detail); };

/* ---- the two serializers (the invariant their codebase documents) ---- */
function ownerView(u) {
  // The ONE way a user row goes back to its owner. Never the hash, never internals.
  return {
    id: u.id, email: u.email, display_name: u.display_name, avatar: u.avatar,
    date_of_birth: u.date_of_birth, age: u.age, role: u.role,
    leaderboard_ok: !!u.leaderboard_ok, created_at: u.created_at,
  };
}
function ownerStats(s) {
  return {
    bankroll: s.bankroll, table_stack: s.table_stack, table_hands: s.table_hands,
    table_wins: s.table_wins, biggest_pot: s.biggest_pot,
    trainer_hands: s.trainer_hands, trainer_optimal: s.trainer_optimal, trainer_ev_lost: s.trainer_ev_lost,
  };
}
/* publicView is an ALLOWLIST: a field absent from this list cannot leak. */
const PROFILE_PUBLIC_FIELDS = ["display_name", "avatar", "table_stack", "table_hands", "table_wins", "biggest_pot"];
function publicView(row) {
  const out = {};
  for (const k of PROFILE_PUBLIC_FIELDS) out[k] = row[k];
  return out;
}

/* ---- auth dependency (their get_current_user, verbatim rules) ---- */
function currentUser(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) err(401, "Missing auth token");
  const payload = decodeToken(auth.slice(7));
  if (!payload) err(401, "Invalid or expired token");
  const user = get("SELECT * FROM users WHERE id = ?", payload.sub);
  if (!user || user.deleted) err(401, "User not found");
  if (user.suspended) err(403, "Account suspended");
  if (user.password_changed_at) {
    const pca = Date.parse(user.password_changed_at) / 1000;
    if ((payload.iat || 0) < pca) err(401, "Session expired, please sign in again");
  }
  return user;
}

const restoreDaysLeft = (user) => {
  // A deleted row with no deleted_at is treated as PAST the window (their ruling).
  if (!user.deleted_at) return null;
  const left = DELETE_GRACE_DAYS - Math.floor((Date.now() - Date.parse(user.deleted_at)) / 86400000);
  return left > 0 ? left : null;
};

const nowIso = () => new Date().toISOString();
const clientIp = (req) => (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "unknown";
const isEmail = (v) => typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254;

/* ---- handlers ---- */

function signup(req, body) {
  // Their throttle first: the only unauthenticated WRITE, and the 409 below
  // reveals registered addresses — so it is rate-limited before anything else.
  const ip = clientIp(req);
  purgeLedgers();
  const hourAgo = Date.now() - 3600 * 1000;
  const { n } = get("SELECT COUNT(*) AS n FROM signup_attempts WHERE ip = ? AND at >= ?", ip, hourAgo);
  if (n >= 10) err(429, "Too many sign-ups from this connection. Try again later.");
  run("INSERT INTO signup_attempts (ip, at) VALUES (?, ?)", ip, Date.now());

  if (!isEmail(body.email)) err(400, "Invalid email");
  if (typeof body.password !== "string" || body.password.length < 8) err(400, "Password must be at least 8 characters");
  const name = String(body.display_name || "").trim();
  if (name.length < 1 || name.length > 40) err(400, "Display name must be 1-40 characters");

  // The 18+ gate, verbatim: confirmed + parseable DOB + computed age, all BEFORE any user write.
  if (!body.age_confirmed) err(400, "Must confirm 18+");
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(body.date_of_birth || ""));
  const dob = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!dob || Number.isNaN(dob.getTime()) || dob.getUTCMonth() !== +m[2] - 1 || dob.getUTCDate() !== +m[3])
    err(400, "Invalid date_of_birth (YYYY-MM-DD)");
  const today = new Date();
  let age = today.getUTCFullYear() - dob.getUTCFullYear();
  if (today.getUTCMonth() < dob.getUTCMonth() ||
      (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() < dob.getUTCDate())) age -= 1;
  if (age < 18) err(400, "You must be 18 or older to use Poker Trainer");

  const email = String(body.email).toLowerCase();
  if (get("SELECT id FROM users WHERE email = ?", email)) err(409, "Email already registered");

  // SEC-001 (theirs, kept): never grant admin via signup.
  const uid = randomUUID();
  run(`INSERT INTO users (id, email, password_hash, display_name, date_of_birth, age, age_confirmed, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 'user', ?)`,
    uid, email, hashPw(body.password), name, body.date_of_birth, age, nowIso());
  run("INSERT INTO stats (user_id, updated_at) VALUES (?, ?)", uid, nowIso());
  logEvent(uid, "signup", {});
  const user = get("SELECT * FROM users WHERE id = ?", uid);
  return { token: makeToken(uid, "user"), user: ownerView(user), stats: ownerStats(get("SELECT * FROM stats WHERE user_id = ?", uid)) };
}

function signin(req, body) {
  const ip = clientIp(req);
  purgeLedgers();
  const windowStart = Date.now() - 15 * 60 * 1000;
  const email = String(body.email || "").toLowerCase();
  const ipFail = get("SELECT COUNT(*) AS n FROM signin_attempts WHERE ip = ? AND success = 0 AND at >= ?", ip, windowStart).n;
  if (ipFail >= 10) err(429, "Too many failed sign-in attempts. Try again in a few minutes.");
  const emailFail = get("SELECT COUNT(*) AS n FROM signin_attempts WHERE email = ? AND success = 0 AND at >= ?", email, windowStart).n;
  if (emailFail >= 5) err(429, "Too many failed sign-in attempts for this account. Try again shortly.");

  const fail = () => { run("INSERT INTO signin_attempts (ip, email, success, at) VALUES (?, ?, 0, ?)", ip, email, Date.now()); err(401, "Invalid credentials"); };
  const user = get("SELECT * FROM users WHERE email = ?", email);
  if (!user) fail();
  if (user.deleted) {
    // Their enumeration hardening kept verbatim: only a CORRECT password learns
    // that this address has a restorable account.
    const left = restoreDaysLeft(user);
    if (left !== null && user.password_hash && verifyPw(body.password, user.password_hash))
      err(410, `This account was deleted. You can restore it for ${left} more day(s).`);
    fail();
  }
  if (!verifyPw(body.password, user.password_hash)) fail();
  if (user.suspended) err(403, "Account suspended");
  run("INSERT INTO signin_attempts (ip, email, success, at) VALUES (?, ?, 1, ?)", ip, email, Date.now());
  return { token: makeToken(user.id, user.role), user: ownerView(user), stats: ownerStats(get("SELECT * FROM stats WHERE user_id = ?", user.id)) };
}

function restore(req, body) {
  // Their ruling, kept: NOT an emailed undo link — someone who changes their
  // mind returns the way they always return, by signing in with the password.
  const ip = clientIp(req);
  const windowStart = Date.now() - 15 * 60 * 1000;
  const email = String(body.email || "").toLowerCase();
  if (get("SELECT COUNT(*) AS n FROM signin_attempts WHERE ip = ? AND success = 0 AND at >= ?", ip, windowStart).n >= 10)
    err(429, "Too many failed attempts. Try again in a few minutes.");
  const user = get("SELECT * FROM users WHERE email = ?", email);
  const bad = () => err(401, "Invalid credentials");
  if (!user || !user.deleted || !user.password_hash) bad();
  if (!verifyPw(body.password, user.password_hash)) {
    run("INSERT INTO signin_attempts (ip, email, success, at) VALUES (?, ?, 0, ?)", ip, email, Date.now());
    bad();
  }
  if (restoreDaysLeft(user) === null) err(410, `That account is past the ${DELETE_GRACE_DAYS}-day window and cannot be restored.`);
  if (user.suspended) err(403, "Account suspended");
  run("UPDATE users SET deleted = 0, deleted_at = NULL WHERE id = ?", user.id);
  logEvent(user.id, "account_restored", {});
  const fresh = get("SELECT * FROM users WHERE id = ?", user.id);
  return { token: makeToken(user.id, user.role), user: ownerView(fresh), stats: ownerStats(get("SELECT * FROM stats WHERE user_id = ?", user.id)) };
}

function me(req) {
  const user = currentUser(req);
  return {
    user: ownerView(user),
    stats: ownerStats(get("SELECT * FROM stats WHERE user_id = ?", user.id)),
    trainer_history: all("SELECT day, hands, optimal, ev_lost FROM trainer_history WHERE user_id = ? ORDER BY day DESC LIMIT 30", user.id).reverse(),
  };
}

function deleteMe(req) {
  const user = currentUser(req);
  run("UPDATE users SET deleted = 1, deleted_at = ? WHERE id = ?", nowIso(), user.id);
  logEvent(user.id, "account_deleted", {});
  return { ok: true, note: `You can restore your account by signing in within ${DELETE_GRACE_DAYS} days. After that it stays gone.` };
}

function exportMe(req) {
  // One-tap export (trust rule): everything we hold, in one JSON.
  const user = currentUser(req);
  return {
    exported_at: nowIso(),
    user: ownerView(user),
    stats: ownerStats(get("SELECT * FROM stats WHERE user_id = ?", user.id)),
    trainer_history: all("SELECT day, hands, optimal, ev_lost FROM trainer_history WHERE user_id = ? ORDER BY day", user.id),
    events: all("SELECT name, payload, at FROM events WHERE user_id = ? ORDER BY at", user.id),
  };
}

function patchProfile(req, body) {
  // Their /profile/edit semantics: exclude-unset merge — an absent field is
  // untouched, so a partial form can never blank a value.
  const user = currentUser(req);
  const sets = [];
  const args = [];
  if (body.display_name !== undefined) {
    const name = String(body.display_name).trim();
    if (name.length < 1 || name.length > 40) err(400, "Display name must be 1-40 characters");
    sets.push("display_name = ?"); args.push(name);
  }
  if (body.avatar !== undefined) {
    if (!AVATARS.includes(body.avatar)) err(400, "Unknown avatar");
    sets.push("avatar = ?"); args.push(body.avatar);
  }
  if (body.leaderboard_ok !== undefined) {
    sets.push("leaderboard_ok = ?"); args.push(body.leaderboard_ok ? 1 : 0);
  }
  if (sets.length) {
    sets.push("profile_updated_at = ?"); args.push(nowIso());
    run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, ...args, user.id);
  }
  return { user: ownerView(get("SELECT * FROM users WHERE id = ?", user.id)) };
}

function putStats(req, body) {
  // Client-pushed, server-clamped. Practice chips: values bounded; the
  // counters are monotonic (max with stored) so a stale client can't erase play.
  const user = currentUser(req);
  const s = get("SELECT * FROM stats WHERE user_id = ?", user.id);
  const num = (v, lo, hi, dflt) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : dflt);
  const mono = (v, prev) => Math.max(prev, num(v, 0, 1e9, prev));
  const next = {
    bankroll: num(body.bankroll, 0, 1e9, s.bankroll),
    table_stack: num(body.table_stack, 0, 1e9, s.table_stack),
    table_hands: mono(body.table_hands, s.table_hands),
    table_wins: mono(body.table_wins, s.table_wins),
    biggest_pot: mono(body.biggest_pot, s.biggest_pot),
    trainer_hands: mono(body.trainer_hands, s.trainer_hands),
    trainer_optimal: mono(body.trainer_optimal, s.trainer_optimal),
    trainer_ev_lost: Math.max(s.trainer_ev_lost, Number.isFinite(Number(body.trainer_ev_lost)) ? Math.min(1e9, Math.max(0, Number(body.trainer_ev_lost))) : s.trainer_ev_lost),
  };
  run(`UPDATE stats SET bankroll=?, table_stack=?, table_hands=?, table_wins=?, biggest_pot=?,
       trainer_hands=?, trainer_optimal=?, trainer_ev_lost=?, updated_at=? WHERE user_id=?`,
    next.bankroll, next.table_stack, next.table_hands, next.table_wins, next.biggest_pot,
    next.trainer_hands, next.trainer_optimal, next.trainer_ev_lost, nowIso(), user.id);
  if (body.today && typeof body.today === "object") {
    const day = nowIso().slice(0, 10);
    const h = num(body.today.hands, 0, 1e6, 0), o = num(body.today.optimal, 0, 1e6, 0);
    const ev = Number.isFinite(Number(body.today.ev_lost)) ? Math.max(0, Number(body.today.ev_lost)) : 0;
    const row = get("SELECT * FROM trainer_history WHERE user_id = ? AND day = ?", user.id, day);
    if (row) run("UPDATE trainer_history SET hands = ?, optimal = ?, ev_lost = ? WHERE user_id = ? AND day = ?",
      Math.max(row.hands, h), Math.max(row.optimal, o), Math.max(row.ev_lost, ev), user.id, day);
    else if (h > 0) run("INSERT INTO trainer_history (user_id, day, hands, optimal, ev_lost) VALUES (?, ?, ?, ?, ?)", user.id, day, h, o, ev);
  }
  return { stats: ownerStats(get("SELECT * FROM stats WHERE user_id = ?", user.id)) };
}

function leaderboard() {
  // Public + PII-free, modeled on their GET /api/markets (the codebase's one
  // public stats endpoint): opted-in players only, allowlist serializer.
  const rows = all(`
    SELECT u.display_name, u.avatar, s.table_stack, s.table_hands, s.table_wins, s.biggest_pot
    FROM users u JOIN stats s ON s.user_id = u.id
    WHERE u.leaderboard_ok = 1 AND u.deleted = 0 AND u.suspended = 0
    ORDER BY s.table_stack DESC, s.biggest_pot DESC LIMIT 50`);
  return { generated_at: nowIso(), players: rows.map(publicView) };
}

/* ---- router ---- */

function corsHeaders(req) {
  const origin = req.headers.origin;
  if (!origin || !CORS_ORIGINS.includes(origin)) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization, content-type",
    "access-control-max-age": "86400",
  };
}

export async function handleApi(req, res, path) {
  const cors = corsHeaders(req);
  const send = (status, obj) => {
    const body = JSON.stringify(obj);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body), ...cors });
    res.end(body);
  };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }

  if (path === "/api/health" && req.method === "GET")
    return send(200, { ok: true, accounts: accountsEnabled(), time: nowIso() });

  if (!accountsEnabled())
    return send(503, { detail: "Accounts are not configured on this server. Guest play is unaffected." });

  let body = {};
  if (req.method === "POST" || req.method === "PUT" || req.method === "PATCH") {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 64 * 1024) return send(413, { detail: "Body too large" });
      chunks.push(chunk);
    }
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}; }
    catch { return send(400, { detail: "Invalid JSON" }); }
  }

  try {
    if (path === "/api/auth/signup" && req.method === "POST") return send(200, signup(req, body));
    if (path === "/api/auth/signin" && req.method === "POST") return send(200, signin(req, body));
    if (path === "/api/auth/restore" && req.method === "POST") return send(200, restore(req, body));
    if (path === "/api/auth/me" && req.method === "GET") return send(200, me(req));
    if (path === "/api/auth/me" && req.method === "DELETE") return send(200, deleteMe(req));
    if (path === "/api/auth/export" && req.method === "GET") return send(200, exportMe(req));
    if (path === "/api/profile" && req.method === "PATCH") return send(200, patchProfile(req, body));
    if (path === "/api/stats" && req.method === "PUT") return send(200, putStats(req, body));
    if (path === "/api/leaderboard" && req.method === "GET") return send(200, leaderboard());
    return send(404, { detail: "Not found" });
  } catch (e) {
    if (e && e.status) return send(e.status, { detail: e.detail });
    console.error("api error:", e);
    return send(500, { detail: "Internal server error" });
  }
}
