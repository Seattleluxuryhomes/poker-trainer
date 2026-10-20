// GET /api/kpi: the read-only answer the founder's console (Eden) reads. COUNTS ONLY.
// The contract every product shares (Cross Universal's lexos-platform/lib/kpi.mjs is the first):
//   { product, at, period:{from,to}, funnel:[{step,count,source,grade}], kpis:[{id,label,value,unit,source,grade,note}],
//     revenue: null, notes:[] }
// Who may ask: a machine holding KPI_READ_TOKEN (16 characters or more), as "Authorization: Bearer <token>". Unset is a
// 404 (the route does not exist); a wrong token is a 401, compared in constant time. Never an email, a name, a chip count
// of one player, or a charity night's players: counts across everyone only. The chips are play money; none is counted.
import { createHash, timingSafeEqual } from "node:crypto";

export const PRODUCT = "poker-trainer";
const MIN_TOKEN = 16, DAY = 86400000, D = /^\d{4}-\d{2}-\d{2}$/;
export const tokenConfigured = (env = process.env) => String(env.KPI_READ_TOKEN || "").trim().length >= MIN_TOKEN;
const sha = (s) => createHash("sha256").update(String(s)).digest();
export function tokenOk(header, env = process.env) {
  const want = String(env.KPI_READ_TOKEN || "").trim();
  if (want.length < MIN_TOKEN) return false;
  const m = /^Bearer[ ]+(\S+)$/i.exec(String(header || "").trim());
  const got = m ? m[1] : "";
  return timingSafeEqual(sha(got), sha(want)) && got.length > 0;
}
export function parsePeriod(q, now = Date.now()) {
  const one = (v, end) => { const s = String(v == null ? "" : v).trim(); if (!s) return null; const t = D.test(s) ? Date.parse(s + "T00:00:00Z") + (end ? DAY : 0) : Date.parse(s); return Number.isFinite(t) ? t : NaN; };
  const to0 = one(q.get("to"), true), from0 = one(q.get("from"), false);
  if (Number.isNaN(to0) || Number.isNaN(from0)) return { ok: false, why: "from and to are a day (2026-10-01) or a full time." };
  const to = to0 ?? now, from = from0 ?? to - 30 * DAY;
  if (from >= to) return { ok: false, why: "from must be before to." };
  return { ok: true, from, to };
}
export function buildKpi(get, { from, to, now = Date.now() }) {
  const iso = (t) => new Date(t).toISOString(), day = (t) => iso(t).slice(0, 10);
  const n = (sql, ...a) => { try { return Number(get(sql, ...a).n) || 0; } catch { return null; } };
  const f = (step, count, source) => (count == null ? null : { step, count, source, grade: "Known" });
  const k = (id, label, value, source) => (value == null ? null : { id, label, value, unit: "count", source, grade: "Known", note: "" });
  return {
    product: PRODUCT, at: iso(now), period: { from: iso(from), to: iso(to) },
    funnel: [
      f("signups", n("SELECT count(*) AS n FROM users WHERE created_at >= ? AND created_at < ? AND deleted = 0", iso(from), iso(to)), "accounts created in the period (users.created_at), deleted ones left out"),
      f("trained", n("SELECT count(DISTINCT user_id) AS n FROM trainer_history WHERE day >= ? AND day < ?", day(from), day(to)), "accounts that trained on at least one day in the period (trainer_history)"),
    ].filter(Boolean),
    kpis: [
      k("accounts_total", "Accounts", n("SELECT count(*) AS n FROM users WHERE deleted = 0"), "accounts now, deleted ones left out"),
      k("hands_trained", "Hands trained in the period", n("SELECT coalesce(sum(hands), 0) AS n FROM trainer_history WHERE day >= ? AND day < ?", day(from), day(to)), "hands summed over every account's training days in the period"),
      k("charity_nights", "Charity nights ended", n("SELECT count(*) AS n FROM nights WHERE ended_at >= ? AND ended_at < ?", iso(from), iso(to)), "charity nights that ended in the period (nights.ended_at)"),
    ].filter(Boolean),
    revenue: null,
    notes: ["Revenue: none. Poker Trainer charges nothing, and its chips are play money.", "No visit counter."],
  };
}
// Answers or returns false; the caller has already split the path.
export function kpiAnswer(req, res, url, get, env = process.env) {
  const send = (s, o) => { const b = JSON.stringify(o); res.writeHead(s, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "content-length": Buffer.byteLength(b) }); res.end(b); };
  if (!tokenConfigured(env)) return send(404, { detail: "Not found" });
  if (!tokenOk(req.headers.authorization, env)) return send(401, { detail: "Unauthorized" });
  const p = parsePeriod(url.searchParams);
  if (!p.ok) return send(400, { detail: p.why });
  try { return send(200, buildKpi(get, p)); } catch { return send(503, { detail: "The counts could not be read." }); }
}
