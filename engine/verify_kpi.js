#!/usr/bin/env node
/* Verifies GET /api/kpi (kpi.mjs) by booting the REAL server on a temp database, the way verify_auth.js does:
 *   - no KPI_READ_TOKEN: the route does not exist (404); a wrong token 401; a bad period 400;
 *   - the right token: the shared shape, a new signup counted, every figure Known with a source, revenue null;
 *   - nothing personal: no email or display name anywhere in the answer. */
const { spawn } = require("node:child_process");
const path = require("node:path"), fs = require("node:fs"), os = require("node:os");
let ok = 0, fail = 0;
const check = (c, m) => { if (c) ok++; else { fail++; console.error("  ✗ " + m); } };
const TOKEN = "poker-kpi-token-for-the-check-1";
async function boot(port, extra) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "poker-kpi-"));
  const s = spawn(process.execPath, [path.join(__dirname, "..", "server.mjs")], { env: { ...process.env, PORT: String(port), DB_PATH: path.join(tmp, "t.db"), JWT_SECRET: "a".repeat(48), REQUIRE_STRONG_SECRETS: "true", ...extra }, stdio: "ignore" });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return s; } catch {} await new Promise((r) => setTimeout(r, 150)); }
  s.kill(); throw new Error("server did not start");
}
(async () => {
  const P1 = 5400 + Math.floor(Math.random() * 300), P2 = P1 + 1;
  const off = await boot(P1, { KPI_READ_TOKEN: "" }), on = await boot(P2, { KPI_READ_TOKEN: TOKEN });
  try {
    check((await fetch(`http://127.0.0.1:${P1}/api/kpi`, { headers: { authorization: `Bearer ${TOKEN}` } })).status === 404, "no key: 404");
    check((await fetch(`http://127.0.0.1:${P2}/api/kpi`, { headers: { authorization: "Bearer not-the-token-here-x" } })).status === 401, "wrong token: 401");
    check((await fetch(`http://127.0.0.1:${P2}/api/kpi?from=2026-10-20&to=2026-10-01`, { headers: { authorization: `Bearer ${TOKEN}` } })).status === 400, "bad period: 400");
    const su = await fetch(`http://127.0.0.1:${P2}/api/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "kpi-player@example.com", password: "kpi-player-pass-1", display_name: "Kpi Example", date_of_birth: "1990-01-01", age_confirmed: true }) });
    check(su.status === 200, `a player signed up (${su.status})`);
    const r = await fetch(`http://127.0.0.1:${P2}/api/kpi`, { headers: { authorization: `Bearer ${TOKEN}` } }), text = await r.text(), j = JSON.parse(text);
    check(r.status === 200 && j.product === "poker-trainer" && r.headers.get("cache-control") === "no-store", "the shared shape, never cached");
    check((j.funnel.find((f) => f.step === "signups") || {}).count === 1, "the signup is counted");
    check([...j.funnel, ...j.kpis].every((f) => f.grade === "Known" && f.source.length > 10), "every figure Known, with its source");
    check(j.revenue === null && !/@|Kpi Example|kpi-player/.test(text), "no revenue invented; no email or name leaves");
  } finally { off.kill(); on.kill(); }
  console.log(`verify_kpi: ${ok} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
