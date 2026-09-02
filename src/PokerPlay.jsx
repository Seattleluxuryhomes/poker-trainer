import React, { useState, useCallback, useEffect } from "react";

/* ============================================================
   PLAY — JACKS OR BETTER (play.html)
   A complete, playable 9/6 video-poker machine: bankroll, bet
   1–5 coins, deal → hold → draw → payout (royal pays 4000 at
   max bet), with the classic paytable panel highlighting your
   bet column and the winning row. The Hint button asks the SAME
   engine the trainer uses (bestHold = exact enumeration), so
   advice here and analysis there can never disagree.
   The bankroll lives in this browser's localStorage only.
   ============================================================ */

const BANK_KEY = "poker-trainer:bank";
const BANK_START = 200;
function loadBank() {
  // getItem's null would coerce to 0 — a fresh player must start at BANK_START, not broke.
  try {
    const raw = window.localStorage.getItem(BANK_KEY);
    if (raw == null) return BANK_START;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? v : BANK_START;
  } catch { return BANK_START; }
}
function saveBank(v) {
  try { window.localStorage.setItem(BANK_KEY, String(v)); } catch { /* private mode: no persistence */ }
}

/* ---- the classic paytable panel ---- */
function Paytable({ bet, wonCat }) {
  const rows = [];
  for (let c = CAT_COUNT - 1; c >= 1; c--) rows.push(c);
  return (
    <div style={{ background: "rgba(0,0,0,0.24)", border: `1px solid ${T.line}`, borderRadius: 10, padding: "10px 12px", overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontFamily: mono, fontSize: 11.5 }}>
        <tbody>
          {rows.map((c) => (
            <tr key={c} style={{ background: wonCat === c ? "rgba(217,164,65,0.28)" : "transparent" }}>
              <td style={{ padding: "3px 6px", color: wonCat === c ? T.gold : T.cream, whiteSpace: "nowrap", fontWeight: wonCat === c ? 700 : 400 }}>{catName(c)}</td>
              {[1, 2, 3, 4, 5].map((b) => (
                <td key={b} style={{
                  padding: "3px 8px", textAlign: "right", color: b === bet ? "#2A1B0E" : T.muted,
                  background: b === bet ? T.pegIvory : "transparent", fontWeight: b === bet ? 700 : 400,
                }}>{payoutFor(c, b)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function PokerPlay() {
  const [bank, setBank] = useState(loadBank);
  const [bet, setBet] = useState(5);
  const [phase, setPhase] = useState("bet"); // bet | hold | result
  const [hand, setHand] = useState(null);
  const [rest, setRest] = useState(null);
  const [held, setHeld] = useState([]);
  const [result, setResult] = useState(null); // { cat, win }
  const [hint, setHint] = useState(null);
  const [stats, setStats] = useState({ hands: 0, net: 0 });
  const [aboutOpen, setAboutOpen] = useState(false);

  useEffect(() => { saveBank(bank); }, [bank]);

  const broke = bank < bet && phase === "bet";

  const deal = useCallback(() => {
    if (bank < bet) return;
    const deck = shuffledDeck();
    setBank((b) => b - bet);
    setHand(deck.slice(0, 5)); setRest(deck.slice(5));
    setHeld([]); setHint(null); setResult(null); setPhase("hold");
  }, [bank, bet]);

  const draw = useCallback(() => {
    let p = 0;
    const final = hand.map((c, i) => (held.includes(i) ? c : rest[p++]));
    const cat = categorizeCards(final);
    const win = payoutFor(cat, bet);
    setHand(final);
    setBank((b) => b + win);
    setStats((s) => ({ hands: s.hands + 1, net: s.net + win - bet }));
    setResult({ cat, win }); setHint(null); setPhase("result");
    reportStats({ set: { bankroll: bank + win } }); // bank already had the bet deducted at deal
  }, [hand, held, rest, bet, bank]);

  const askHint = useCallback(() => { setHint(bestHold(hand)); }, [hand]);

  const toggleHold = useCallback((i) => {
    setHeld((h) => (h.includes(i) ? h.filter((x) => x !== i) : [...h, i]));
  }, []);

  const resetBank = useCallback(() => { setBank(BANK_START); setStats({ hands: 0, net: 0 }); reportStats({ set: { bankroll: BANK_START } }); }, []);

  const bigBtn = (bg, fg) => ({
    padding: "12px 34px", borderRadius: 10, cursor: "pointer", fontFamily: mono, fontSize: 15, fontWeight: 700,
    background: bg, color: fg, border: "1px solid rgba(0,0,0,0.3)", boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
  });

  return (
    <div style={{
      minHeight: "100%", background: `radial-gradient(120% 90% at 50% 0%, ${T.baizeHi}, ${T.baize})`,
      color: T.cream, fontFamily: serif, padding: "0 0 28px",
    }}>
      <style>{`
        @keyframes dealIn {from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        .dealwrap > * {animation:dealIn 260ms ease both}
        .dealwrap > *:nth-child(2){animation-delay:40ms}
        .dealwrap > *:nth-child(3){animation-delay:80ms}
        .dealwrap > *:nth-child(4){animation-delay:120ms}
        .dealwrap > *:nth-child(5){animation-delay:160ms}
        button{font-family:inherit}
        button:focus-visible{outline:2px solid ${T.pegIvory}}
        @media (prefers-reduced-motion: reduce){.dealwrap > *{animation:none}}
      `}</style>

      <header style={{
        background: `linear-gradient(180deg, ${T.woodL}, ${T.woodM} 55%, ${T.woodD})`,
        padding: "14px 18px 16px", boxShadow: "0 6px 18px rgba(0,0,0,0.4)", borderBottom: "2px solid rgba(0,0,0,0.3)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <a href="index.html" aria-label="Home" title="Home" style={{
              flex: "0 0 auto", width: 34, height: 34, borderRadius: 8, background: T.baize, color: T.ivory, textDecoration: "none",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, lineHeight: 1,
              boxShadow: "inset 0 1px 2px rgba(255,255,255,0.12), 0 2px 5px rgba(0,0,0,0.35)",
            }}>♠</a>
            <span style={{ fontFamily: mono, fontSize: 12, color: "rgba(42,27,14,0.8)", lineHeight: 1.3 }}>Play — 9/6 Jacks or Better</span>
            {IS_DEV_VERSION && <span style={{ fontFamily: mono, fontSize: 10, color: "rgba(42,27,14,0.55)", whiteSpace: "nowrap" }}>v{APP_VERSION}</span>}
          </div>
          <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
            <AccountArea />
            <button onClick={() => setAboutOpen(true)} aria-label="About" style={{
              width: 40, height: 40, borderRadius: 10, cursor: "pointer",
              border: "1px solid rgba(0,0,0,0.28)", background: "rgba(42,27,14,0.14)",
              color: "#2A1B0E", fontSize: 19, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
            }}>ⓘ</button>
          </div>
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 18, flexWrap: "wrap", fontFamily: mono, fontSize: 12, color: "#2A1B0E" }}>
          <span><b style={{ fontSize: 15 }}>{bank}</b> credits</span>
          <span><b style={{ fontSize: 15 }}>{stats.hands}</b> hands</span>
          <span><b style={{ fontSize: 15 }}>{stats.net >= 0 ? "+" : ""}{stats.net}</b> session</span>
        </div>
      </header>

      <main style={{ maxWidth: 560, margin: "0 auto", padding: "18px 16px 0" }}>
        {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}

        <Paytable bet={bet} wonCat={result && result.win > 0 ? result.cat : null} />

        {phase === "bet" && (
          <div style={{ margin: "14px 0 4px" }}>
            <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 6 }}>Bet (coins) — the royal pays 4000 only at 5</div>
            <div style={{ display: "flex", gap: 6 }}>
              {[1, 2, 3, 4, 5].map((b) => (
                <button key={b} onClick={() => setBet(b)} style={segStyle(bet === b)}>{b}</button>
              ))}
            </div>
          </div>
        )}

        {hand ? (
          <div className={phase === "hold" ? "dealwrap" : ""} style={{ display: "flex", gap: 8, justifyContent: "center", paddingTop: 30, paddingBottom: 24 }}>
            {hand.map((card, i) => (
              <CardFace key={cardId(card)} card={card} held={phase === "hold" && held.includes(i)}
                disabled={phase !== "hold"} onClick={() => toggleHold(i)}
                badge={phase === "hold" && hint && hint.includes(i) ? "BEST" : null} />
            ))}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 8, justifyContent: "center", paddingTop: 30, paddingBottom: 24 }}>
            {[0, 1, 2, 3, 4].map((i) => <CardFace key={i} card={{ r: 1, s: 0 }} faceDown disabled />)}
          </div>
        )}

        {phase === "result" && result && (
          <div style={{
            padding: "12px 14px", borderRadius: 10, marginBottom: 14, textAlign: "center",
            background: result.win > 0 ? "rgba(95,164,124,0.16)" : "rgba(0,0,0,0.2)",
            border: `1px solid ${result.win > 0 ? "rgba(95,164,124,0.5)" : T.line}`,
          }}>
            <div style={{ fontWeight: 700, fontSize: 16 }}>
              {result.win > 0 ? `${catName(result.cat)} — you win ${result.win}` : "No pair of jacks or better — no payout"}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          {phase === "hold" ? (
            <>
              <button onClick={draw} style={bigBtn(`linear-gradient(180deg, ${T.good}, ${T.goodDeep})`, "#0d2417")}>Draw</button>
              <button onClick={askHint} style={{
                padding: "12px 22px", borderRadius: 10, cursor: "pointer", fontFamily: mono, fontSize: 13,
                background: "rgba(0,0,0,0.22)", color: T.cream, border: `1px solid ${T.line}`,
              }}>Hint</button>
            </>
          ) : (
            <button onClick={deal} disabled={broke} style={{ ...bigBtn(`linear-gradient(180deg, ${T.good}, ${T.goodDeep})`, "#0d2417"), opacity: broke ? 0.5 : 1, cursor: broke ? "default" : "pointer" }}>
              Deal — bet {bet}
            </button>
          )}
        </div>

        {broke && (
          <div style={{ marginTop: 16, textAlign: "center", fontFamily: mono, fontSize: 12, color: T.muted }}>
            Out of credits.{" "}
            <button onClick={resetBank} style={{ background: "none", border: "none", color: T.pegIvory, textDecoration: "underline", cursor: "pointer", fontFamily: mono, fontSize: 12 }}>
              Reset bankroll to {BANK_START}
            </button>
          </div>
        )}

        <p style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, lineHeight: 1.6, marginTop: 22 }}>
          Practice credits only — nothing is wagered, bought, or sent anywhere. Hint uses the trainer's
          exact-enumeration engine. Want the full analysis? Take the hand to the <a href="trainer.html" style={{ color: T.pegIvory }}>Hold Trainer</a>.
        </p>
      </main>
    </div>
  );
}
