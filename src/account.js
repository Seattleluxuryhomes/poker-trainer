/* Account layer — the client half of the maybe.love port (frontend/src/api.ts +
 * auth.tsx patterns, translated to this buildless app). build.sh PREPENDS this
 * file to each page (after engine.js, before chrome.jsx).
 *
 * Behaviors carried over from their api.ts/auth.tsx:
 *   - one fetch wrapper attaching `Authorization: Bearer`; non-2xx throws the
 *     server's `detail`; a request that never completed says so in its own words
 *     (never the browser's "Failed to fetch");
 *   - refresh() = GET /auth/me, and ANY failure wipes the token (the de-facto
 *     401 handler — there is no interceptor);
 *   - a re-fetch on visibilitychange when the cached user is older than
 *     STALE_AFTER_MS = 20 minutes;
 *   - the token lives in localStorage. Their code's own note applies here too:
 *     an injected script can read localStorage; the structural fix is an
 *     httpOnly cookie session, parked until the auth surface is next open.
 *
 * Guest-first: if no backend answers /api/health (the Pages mirror without CORS,
 * the offline APK, a file:// open), `ACCT.available` stays false and every auth
 * surface hides. Playing never requires an account.
 */

/* Where the API lives: same-origin when served by server.mjs; the public
 * Railway URL otherwise (public by design — auth is the bearer token, not the URL). */
const PUBLIC_API_URL = "https://poker-trainer-production-52ff.up.railway.app";
const ACCT_TOKEN_KEY = "poker_token_v1";
const ACCT_MIRROR_KEY = "poker-trainer:statsMirror.v1";
const STALE_AFTER_MS = 20 * 60 * 1000;

const ACCT = {
  base: null,          // "" (same-origin) or PUBLIC_API_URL
  online: false,       // a poker server answered /api/health at all
  available: false,    // …and it has accounts enabled
  rooms: false,        // …and it hosts multiplayer rooms
  checked: false,
  user: null,
  stats: null,
  history: [],
  fetchedAt: 0,
  listeners: [],
};

let _acctToken;
function acctGetToken() {
  if (_acctToken !== undefined) return _acctToken;
  try { _acctToken = window.localStorage.getItem(ACCT_TOKEN_KEY); } catch { _acctToken = null; }
  return _acctToken;
}
function acctSetToken(t) {
  _acctToken = t;
  try { t ? window.localStorage.setItem(ACCT_TOKEN_KEY, t) : window.localStorage.removeItem(ACCT_TOKEN_KEY); } catch { /* private mode */ }
}

function acctNotify() { for (const fn of ACCT.listeners) { try { fn(); } catch { /* listener errors stay local */ } } }
function acctSubscribe(fn) { ACCT.listeners.push(fn); return () => { ACCT.listeners = ACCT.listeners.filter((f) => f !== fn); }; }

/* Their api() wrapper, verbatim in behavior. */
async function acctApi(path, opts = {}) {
  const token = acctGetToken();
  const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${ACCT.base}/api${path}`, { ...opts, headers });
  } catch {
    throw new Error("couldn't reach the poker server. check your connection and try again.");
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const ours = res.status >= 500;
    const msg = (!ours && (data && (data.detail || data.message)))
      || (ours ? "something broke on our end. try that again in a moment."
               : `Request failed (${res.status})`);
    const e = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    e.status = res.status;
    throw e;
  }
  return data;
}

async function acctProbe(base) {
  try {
    const res = await fetch(`${base}/api/health`, { cache: "no-store" });
    if (!res.ok) return null;
    const j = await res.json();
    return j && j.ok ? { accounts: !!j.accounts, rooms: !!j.rooms } : null;
  } catch { return null; }
}

function acctAdopt(payload) {
  if (payload.user) ACCT.user = payload.user;
  if (payload.stats) ACCT.stats = payload.stats;
  if (payload.trainer_history) ACCT.history = payload.trainer_history;
  ACCT.fetchedAt = Date.now();
  acctNotify();
}

/* refresh(): any failure wipes the token — their rule, kept. On success, flush
 * the stats mirror: play reported before the user finished loading (a fast
 * first hand racing /auth/me) would otherwise sit local until the next hand. */
async function acctRefresh() {
  if (!ACCT.available || !acctGetToken()) return;
  try { acctAdopt(await acctApi("/auth/me")); acctPushMirror(); }
  catch { acctSetToken(null); ACCT.user = null; ACCT.stats = null; ACCT.history = []; acctNotify(); }
}

async function acctInit() {
  if (ACCT.checked || typeof window === "undefined") return;
  ACCT.checked = true;
  let h = await acctProbe("");
  if (h) ACCT.base = "";
  else { h = await acctProbe(PUBLIC_API_URL); if (h) ACCT.base = PUBLIC_API_URL; }
  if (h) { ACCT.online = true; ACCT.available = h.accounts; ACCT.rooms = h.rooms; }
  acctNotify();
  if (ACCT.available && acctGetToken()) await acctRefresh();
  try {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && ACCT.user && Date.now() - ACCT.fetchedAt > STALE_AFTER_MS) acctRefresh();
      // Leaving the page: don't let a debounced push die with the tab.
      if (document.visibilityState === "hidden") acctFlushNow();
    });
    window.addEventListener("pagehide", acctFlushNow);
  } catch { /* non-DOM host */ }
}

/* Immediate, keepalive flush of the mirror — survives navigation/tab close. */
function acctFlushNow() {
  if (!ACCT.available || !ACCT.user) return;
  clearTimeout(_pushTimer);
  const m = acctMirror();
  const today = new Date().toISOString().slice(0, 10);
  try {
    fetch(`${ACCT.base}/api/stats`, {
      method: "PUT", keepalive: true,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${acctGetToken()}` },
      body: JSON.stringify({ ...m, today: m.todayDay === today ? { hands: m.todayHands, optimal: m.todayOptimal, ev_lost: m.todayEvLost } : undefined }),
    });
  } catch { /* best effort */ }
}

async function acctSignin(email, password) {
  const out = await acctApi("/auth/signin", { method: "POST", body: JSON.stringify({ email, password }) });
  acctSetToken(out.token); acctAdopt(out);
  acctPushMirror();       // one-time carry of guest progress; server clamps keep it honest
  return out;
}
async function acctSignup(fields) {
  const out = await acctApi("/auth/signup", { method: "POST", body: JSON.stringify(fields) });
  acctSetToken(out.token); acctAdopt(out);
  acctPushMirror();
  return out;
}
async function acctRestore(email, password) {
  const out = await acctApi("/auth/restore", { method: "POST", body: JSON.stringify({ email, password }) });
  acctSetToken(out.token); acctAdopt(out);
  return out;
}
function acctSignout() {
  // No logout endpoint, like the original: the client discards the token.
  acctSetToken(null); ACCT.user = null; ACCT.stats = null; ACCT.history = []; acctNotify();
}
async function acctPatchProfile(patch) {
  const out = await acctApi("/profile", { method: "PATCH", body: JSON.stringify(patch) });
  acctAdopt(out);
  return out;
}
async function acctDeleteMe() {
  const out = await acctApi("/auth/me", { method: "DELETE" });
  acctSignout();
  return out;
}
const acctExport = () => acctApi("/auth/export");
const acctLeaderboard = () => acctApi("/leaderboard");

/* ---- stats mirror + sync ----
 * Every page reports play through here. Guests: the mirror just accumulates in
 * localStorage. Signed in: a debounced PUT pushes it; the server's monotonic
 * clamps make replays and stale tabs harmless. */
function acctMirror() {
  try { return JSON.parse(window.localStorage.getItem(ACCT_MIRROR_KEY)) || {}; } catch { return {}; }
}
function acctSaveMirror(m) {
  try { window.localStorage.setItem(ACCT_MIRROR_KEY, JSON.stringify(m)); } catch { /* private mode */ }
}
let _pushTimer = null;
function acctPushMirror() {
  if (!ACCT.available || !ACCT.user) return;
  clearTimeout(_pushTimer);
  _pushTimer = setTimeout(async () => {
    const m = acctMirror();
    const today = new Date().toISOString().slice(0, 10);
    try {
      const out = await acctApi("/stats", {
        method: "PUT",
        body: JSON.stringify({ ...m, today: m.todayDay === today ? { hands: m.todayHands, optimal: m.todayOptimal, ev_lost: m.todayEvLost } : undefined }),
      });
      if (out.stats) { ACCT.stats = out.stats; acctNotify(); }
    } catch { /* offline push retries on the next report */ }
  }, 1200);
}
/* reportStats({set:{}, inc:{}, maxOf:{}}) — counters survive as localStorage sums. */
function reportStats({ set = {}, inc = {}, maxOf = {} } = {}) {
  const m = acctMirror();
  for (const k of Object.keys(set)) m[k] = set[k];
  for (const k of Object.keys(inc)) m[k] = (m[k] || 0) + inc[k];
  for (const k of Object.keys(maxOf)) m[k] = Math.max(m[k] || 0, maxOf[k]);
  const today = new Date().toISOString().slice(0, 10);
  if (m.todayDay !== today) { m.todayDay = today; m.todayHands = 0; m.todayOptimal = 0; m.todayEvLost = 0; }
  if (inc.trainer_hands) m.todayHands += inc.trainer_hands;
  if (inc.trainer_optimal) m.todayOptimal += inc.trainer_optimal;
  if (inc.trainer_ev_lost) m.todayEvLost += inc.trainer_ev_lost;
  acctSaveMirror(m);
  acctPushMirror();
}
