import React, { useState, useEffect } from "react";

/* ============================================================
   PROFILE (profile.html) — your account, stats, trainer trend,
   and the opt-in leaderboard. Client half of the maybe.love
   port: everything here talks to the api.mjs backend through
   src/account.js. Guest-first: with no backend (Pages mirror
   without CORS, the offline APK, file://) this page says so
   plainly and gates nothing.
   ============================================================ */

const AVATAR_CHOICES = ["🂠", "♠️", "♥️", "♦️", "♣️", "🎩", "🦊", "🦈", "🐺", "🃏", "🤠", "👑"];

function StatTile({ label, value }) {
  return (
    <div style={{ background: "rgba(0,0,0,0.22)", border: `1px solid ${T.line}`, borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ fontFamily: mono, fontSize: 10, color: T.muted, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontFamily: mono, fontSize: 18, fontWeight: 700, color: T.cream, marginTop: 3 }}>{value}</div>
    </div>
  );
}

/* Trainer accuracy per day as an inline SVG sparkline — no dependencies. */
function TrendSpark({ history }) {
  const days = history.filter((d) => d.hands > 0);
  if (days.length < 2) return <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>Play the trainer on a couple of days and your accuracy trend appears here.</div>;
  const W = 320, H = 64, P = 4;
  const pts = days.map((d, i) => {
    const x = P + (i / (days.length - 1)) * (W - 2 * P);
    const y = H - P - (d.optimal / d.hands) * (H - 2 * P);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const last = days[days.length - 1];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 360, height: "auto", display: "block" }} role="img"
        aria-label={`Trainer accuracy over ${days.length} days`}>
        <polyline points={pts.join(" ")} fill="none" stroke={T.good} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={pts[pts.length - 1].split(",")[0]} cy={pts[pts.length - 1].split(",")[1]} r="3.5" fill={T.pegIvory} />
      </svg>
      <div style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, marginTop: 4 }}>
        {days.length} day{days.length > 1 ? "s" : ""} · latest {((last.optimal / last.hands) * 100).toFixed(0)}% optimal
      </div>
    </div>
  );
}

function Leaderboard({ meName }) {
  const [board, setBoard] = useState(null);
  useEffect(() => { acctLeaderboard().then(setBoard).catch(() => setBoard({ players: [] })); }, []);
  if (!board) return <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>Loading…</div>;
  if (!board.players.length) return <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>Nobody has opted in yet. Be the first.</div>;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: mono, fontSize: 12 }}>
      <tbody>
        {board.players.map((p, i) => (
          <tr key={i} style={{ background: p.display_name === meName ? "rgba(236,220,180,0.12)" : "transparent" }}>
            <td style={{ padding: "5px 6px", color: T.muted, width: 26 }}>{i + 1}</td>
            <td style={{ padding: "5px 4px", width: 26, fontSize: 15 }}>{p.avatar}</td>
            <td style={{ padding: "5px 6px", color: T.cream, fontWeight: p.display_name === meName ? 700 : 400, overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120, whiteSpace: "nowrap" }}>{p.display_name}</td>
            <td style={{ padding: "5px 6px", textAlign: "right", color: T.good, fontWeight: 700 }}>${(p.table_stack || 0).toLocaleString()}</td>
            <td style={{ padding: "5px 6px", textAlign: "right", color: T.muted }}>{p.table_hands} hands</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Profile() {
  const acct = useAccount();
  const [authOpen, setAuthOpen] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => { if (acct.user) setName(acct.user.display_name); }, [acct.user && acct.user.display_name]);

  const saveName = async () => {
    try { await acctPatchProfile({ display_name: name }); setNote("Saved."); setTimeout(() => setNote(null), 1500); }
    catch (e) { setNote(e.message); }
  };
  const pickAvatar = async (a) => { try { await acctPatchProfile({ avatar: a }); } catch (e) { setNote(e.message); } };
  const toggleBoard = async () => {
    // Optimistic: the checkbox answers the tap; the server confirms (or reverts on failure).
    const want = !acct.user.leaderboard_ok;
    ACCT.user = { ...ACCT.user, leaderboard_ok: want };
    acctNotify();
    try { await acctPatchProfile({ leaderboard_ok: want }); }
    catch (e) { ACCT.user = { ...ACCT.user, leaderboard_ok: !want }; acctNotify(); setNote(e.message); }
  };
  const doExport = async () => {
    try {
      const data = await acctExport();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "poker-trainer-export.json";
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) { setNote(e.message); }
  };
  const doDelete = async () => {
    try { const out = await acctDeleteMe(); setConfirmDelete(false); setNote(out.note); }
    catch (e) { setNote(e.message); }
  };

  const s = acct.stats;
  const secHead = { fontFamily: mono, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: T.muted, margin: "22px 0 10px" };

  return (
    <div style={{
      minHeight: "100%", background: `radial-gradient(120% 90% at 50% 0%, ${T.baizeHi}, ${T.baize})`,
      color: T.cream, fontFamily: serif, padding: "0 0 40px",
    }}>
      <style>{`button{font-family:inherit} button:focus-visible{outline:2px solid ${T.pegIvory}}`}</style>
      <header style={{
        background: `linear-gradient(180deg, ${T.woodL}, ${T.woodM} 55%, ${T.woodD})`,
        padding: "14px 18px 16px", boxShadow: "0 6px 18px rgba(0,0,0,0.4)", borderBottom: "2px solid rgba(0,0,0,0.3)",
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <a href="index.html" aria-label="Home" style={{
            width: 34, height: 34, borderRadius: 8, background: T.baize, color: T.ivory, textDecoration: "none",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19,
            boxShadow: "inset 0 1px 2px rgba(255,255,255,0.12), 0 2px 5px rgba(0,0,0,0.35)",
          }}>♠</a>
          <span style={{ fontFamily: mono, fontSize: 12, color: "#cfd6e2", letterSpacing: "0.06em", fontWeight: 700 }}>Your profile</span>
        </div>
        <AccountArea />
      </header>

      <main style={{ maxWidth: 560, margin: "0 auto", padding: "18px 16px 0" }}>
        {!acct.checked || (!acct.available && !acct.checked) ? null : !acct.available ? (
          <div style={{ background: "rgba(0,0,0,0.22)", border: `1px solid ${T.line}`, borderRadius: 10, padding: 16, fontSize: 14, lineHeight: 1.55 }}>
            Accounts aren't reachable from this copy of the app — you're in guest mode, and
            everything still works: stats and bankroll live in this browser only. The online
            version at the Railway site has profiles and the leaderboard.
          </div>
        ) : !acct.user ? (
          <div style={{ background: "rgba(0,0,0,0.22)", border: `1px solid ${T.line}`, borderRadius: 10, padding: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>Play as a guest, or bring your stats with you.</div>
            <div style={{ fontFamily: mono, fontSize: 11.5, color: T.muted, lineHeight: 1.6, marginBottom: 12 }}>
              An account syncs your practice chips, table results, and trainer accuracy across
              devices, and can join the leaderboard (opt-in). We store the minimum, you can
              export or delete it all any time, and playing never requires signing in.
            </div>
            <button onClick={() => setAuthOpen(true)} style={{ ...segStyle(true), width: "100%", padding: "11px 6px", fontSize: 13 }}>Sign in / create account</button>
            {authOpen && <AuthModal onClose={() => setAuthOpen(false)} />}
            <h2 style={secHead}>Leaderboard</h2>
            <Leaderboard meName={null} />
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 14, background: "rgba(0,0,0,0.22)", border: `1px solid ${T.line}`, borderRadius: 10, padding: 14 }}>
              <span style={{ fontSize: 40, lineHeight: 1 }}>{acct.user.avatar}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} style={{
                    flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: 8, border: `1px solid ${T.line}`,
                    background: "rgba(0,0,0,0.25)", color: T.cream, fontFamily: mono, fontSize: 13,
                  }} />
                  {name !== acct.user.display_name && <button onClick={saveName} style={segStyle(true)}>Save</button>}
                </div>
                <div style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, marginTop: 5 }}>{acct.user.email}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {AVATAR_CHOICES.map((a) => (
                <button key={a} onClick={() => pickAvatar(a)} aria-pressed={acct.user.avatar === a} style={{
                  width: 40, height: 40, fontSize: 19, borderRadius: 9, cursor: "pointer",
                  background: acct.user.avatar === a ? T.pegIvory : "rgba(0,0,0,0.22)",
                  border: `1px solid ${acct.user.avatar === a ? T.pegIvory : T.line}`,
                }}>{a}</button>
              ))}
            </div>
            {note && <div style={{ fontFamily: mono, fontSize: 11.5, color: T.good, marginTop: 8 }}>{note}</div>}

            {s && (
              <>
                <h2 style={secHead}>Your numbers</h2>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  <StatTile label="Table stack" value={`$${s.table_stack.toLocaleString()}`} />
                  <StatTile label="Machine credits" value={s.bankroll.toLocaleString()} />
                  <StatTile label="Biggest pot" value={`$${s.biggest_pot.toLocaleString()}`} />
                  <StatTile label="Table hands" value={s.table_hands.toLocaleString()} />
                  <StatTile label="Hands won" value={s.table_wins.toLocaleString()} />
                  <StatTile label="Trainer optimal" value={s.trainer_hands ? `${((s.trainer_optimal / s.trainer_hands) * 100).toFixed(0)}%` : "–"} />
                </div>
                <h2 style={secHead}>Trainer trend</h2>
                <TrendSpark history={acct.history} />
              </>
            )}

            <h2 style={secHead}>Leaderboard</h2>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontFamily: mono, fontSize: 11.5, marginBottom: 10, cursor: "pointer" }}>
              <input type="checkbox" checked={!!acct.user.leaderboard_ok} onChange={toggleBoard} />
              <span>Show me on the public leaderboard (display name, avatar, and table stats only — never your email)</span>
            </label>
            <Leaderboard meName={acct.user.display_name} />

            <h2 style={secHead}>Your data</h2>
            <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, lineHeight: 1.6, marginBottom: 10 }}>
              We hold: email, display name, date of birth, avatar, practice stats, and a
              metadata-only event log. No tracking, no analytics, practice chips only.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={doExport} style={segStyle(false)}>Export everything (JSON)</button>
              <button onClick={acctSignout} style={segStyle(false)}>Sign out</button>
              {confirmDelete ? (
                <button onClick={doDelete} style={{ ...segStyle(false), color: T.pegRed, borderColor: "rgba(200,65,43,0.5)" }}>
                  Really delete — 30-day undo, then gone
                </button>
              ) : (
                <button onClick={() => setConfirmDelete(true)} style={{ ...segStyle(false), color: T.pegRed }}>Delete account…</button>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
