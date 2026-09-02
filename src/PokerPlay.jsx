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
   Dressed by the casino design kit (v0.9.0) — same law as the
   whole floor: gold for money moments only, losses stay quiet.
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

/* ---- the classic paytable panel, in the house dark ---- */
function Paytable({ bet, wonCat }) {
  const rows = [];
  for (let c = CAT_COUNT - 1; c >= 1; c--) rows.push(c);
  return (
    <div style={{ background: CAS.panel, border: `1px solid ${CAS.line}`, borderRadius: 12, padding: "10px 12px", overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontFamily: casMono, fontSize: 11.5 }}>
        <tbody>
          {rows.map((c) => (
            <tr key={c} style={{ background: wonCat === c ? "rgba(245,197,66,0.16)" : "transparent" }}>
              <td style={{ padding: "3px 6px", color: wonCat === c ? CAS.gold : CAS.text, whiteSpace: "nowrap", fontWeight: wonCat === c ? 700 : 400 }}>{catName(c)}</td>
              {[1, 2, 3, 4, 5].map((b) => (
                <td key={b} style={{
                  padding: "3px 8px", textAlign: "right",
                  color: b === bet ? CAS.gold : CAS.faint,
                  background: b === bet ? "rgba(245,197,66,0.09)" : "transparent",
                  fontWeight: b === bet ? 700 : 400,
                }}>{payoutFor(c, b)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* A machine card: face, HELD flag riding on top, BEST-hold gold ring. */
function VpCard({ card, w, held, best, faceDown, onClick, delay = 0 }) {
  const red = isRed(card.s);
  return (
    <button onClick={onClick} disabled={!onClick} style={{
      width: w, height: Math.round(w * 1.42), borderRadius: Math.max(8, w * 0.13), padding: 0, flex: "0 0 auto",
      background: faceDown
        ? "repeating-linear-gradient(45deg, #1c2733, #1c2733 5px, #141b24 5px, #141b24 10px)"
        : "linear-gradient(160deg, #fdfcf7, #efece1 70%, #ddd8c8)",
      border: held ? `2.5px solid ${CAS.gold}` : best ? `2px dashed rgba(245,197,66,0.65)` : "1px solid rgba(0,0,0,0.35)",
      color: red ? "#c62828" : "#161a22", cursor: onClick ? "pointer" : "default",
      boxShadow: held ? `0 0 14px ${CAS.goldFaint}, 0 6px 12px rgba(0,0,0,0.5)` : "0 5px 12px rgba(0,0,0,0.5)",
      transform: held ? "translateY(-10px)" : "none", transition: "transform 140ms ease, box-shadow 140ms ease",
      position: "relative", fontFamily: casSans,
      animation: `casChipDrop 280ms ease ${delay}ms both`,
    }}>
      {!faceDown && (
        <>
          <span style={{ position: "absolute", top: w * 0.07, left: w * 0.1, fontSize: w * 0.3, fontWeight: 900, lineHeight: 1 }}>{rankLabel(card.r)}</span>
          <span style={{ position: "absolute", bottom: w * 0.06, right: w * 0.08, fontSize: w * 0.44, lineHeight: 1 }}>{SUIT[card.s]}</span>
          {held && (
            <span style={{
              position: "absolute", top: -11, left: "50%", transform: "translateX(-50%)",
              fontSize: 8.5, fontWeight: 900, letterSpacing: "0.12em", padding: "2px 7px", borderRadius: 999,
              background: CAS.gold, color: "#14171d", boxShadow: "0 2px 6px rgba(0,0,0,0.5)",
              animation: "casPop 180ms ease both", whiteSpace: "nowrap",
            }}>HELD</span>
          )}
        </>
      )}
    </button>
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
  const [winKey, setWinKey] = useState(0);

  useEffect(() => { saveBank(bank); }, [bank]);

  const broke = bank < bet && phase === "bet";

  const deal = useCallback(() => {
    if (bank < bet) return;
    const deck = shuffledDeck();
    sfx.chip();
    sfx.cards(5);
    setBank((b) => b - bet);
    setHand(deck.slice(0, 5)); setRest(deck.slice(5));
    setHeld([]); setHint(null); setResult(null); setPhase("hold");
  }, [bank, bet]);

  const draw = useCallback(() => {
    let p = 0;
    sfx.cards(5 - held.length);
    const final = hand.map((c, i) => (held.includes(i) ? c : rest[p++]));
    const cat = categorizeCards(final);
    const win = payoutFor(cat, bet);
    setHand(final);
    setBank((b) => b + win);
    setStats((s) => ({ hands: s.hands + 1, net: s.net + win - bet }));
    setResult({ cat, win }); setHint(null); setPhase("result");
    if (win > 0) { setWinKey((k) => k + 1); setTimeout(() => sfx.win(win >= 25), 320); }
    reportStats({ set: { bankroll: bank + win } }); // bank already had the bet deducted at deal
  }, [hand, held, rest, bet, bank]);

  const askHint = useCallback(() => { setHint(bestHold(hand)); }, [hand]);

  const toggleHold = useCallback((i) => {
    sfx.click();
    setHeld((h) => (h.includes(i) ? h.filter((x) => x !== i) : [...h, i]));
  }, []);

  const resetBank = useCallback(() => { setBank(BANK_START); setStats({ hands: 0, net: 0 }); reportStats({ set: { bankroll: BANK_START } }); }, []);

  const w = Math.min(74, Math.round(((typeof window !== "undefined" ? window.innerWidth : 400) - 80) / 5));

  return (
    <div style={{ background: `radial-gradient(120% 60% at 50% -5%, ${CAS.room}, ${CAS.bg} 65%)`, minHeight: "100vh", fontFamily: casSans, color: CAS.text, display: "flex", flexDirection: "column" }}>
      <style>{CAS_CSS}</style>
      <CasinoHeader title="VIDEO POKER" sub="9/6 JACKS OR BETTER · ROYAL PAYS 4000 AT MAX BET · PRACTICE CHIPS" bank={bank} />

      <div style={{ flex: 1, maxWidth: 620, width: "100%", margin: "0 auto", padding: "16px 14px 26px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12 }}>
        {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}

        <Paytable bet={bet} wonCat={result && result.win > 0 ? result.cat : null} />

        <div style={{ ...feltPanel("20px 14px"), display: "flex", flexDirection: "column", alignItems: "center", gap: 12, overflow: "hidden" }}>
          <MarqueeLights />
          <BigWin amount={result && result.win > 0 ? result.win : 0} fireKey={winKey} />

          <div style={{ display: "flex", gap: 7, justifyContent: "center", paddingTop: 8 }}>
            {hand
              ? hand.map((card, i) => (
                  <VpCard key={cardId(card)} card={card} w={w}
                    held={phase === "hold" && held.includes(i)}
                    best={phase === "hold" && hint && hint.includes(i)}
                    onClick={phase === "hold" ? () => toggleHold(i) : undefined}
                    delay={i * 55} />
                ))
              : [0, 1, 2, 3, 4].map((i) => <VpCard key={i} card={{ r: 1, s: 0 }} faceDown w={w} />)}
          </div>

          <div style={{ fontFamily: casMono, fontSize: 11.5, minHeight: 17, textAlign: "center", color: phase === "hold" ? CAS.gold : CAS.dim, fontWeight: phase === "hold" ? 700 : 400 }}>
            {phase === "hold"
              ? hint ? "dashed gold = the enumerated best hold" : "tap the cards to HOLD, then draw"
              : phase === "result" && result
                ? result.win > 0 ? `${catName(result.cat)} — you win ${result.win}` : "no pair of jacks or better"
                : "five cards, one draw — the machine that started this whole casino"}
          </div>
        </div>

        {phase !== "hold" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: casMono, fontSize: 11, color: CAS.faint }}>BET</span>
            {[1, 2, 3, 4, 5].map((b) => (
              <button key={b} onClick={() => { sfx.click(); setBet(b); }} style={{
                width: 38, height: 38, borderRadius: 10, cursor: "pointer", fontFamily: casSans, fontWeight: 900, fontSize: 14,
                border: `1px solid ${bet === b ? "rgba(245,197,66,0.7)" : CAS.line}`,
                background: bet === b ? "linear-gradient(180deg, rgba(245,197,66,0.25), rgba(245,197,66,0.1))" : "rgba(255,255,255,0.04)",
                color: bet === b ? CAS.goldHi : CAS.text,
              }}>{b}</button>
            ))}
            <div style={{ marginLeft: "auto", fontFamily: casMono, fontSize: 11.5, color: CAS.dim, textAlign: "right" }}>
              {stats.hands} hands · {stats.net >= 0 ? "+" : ""}{stats.net}
            </div>
          </div>
        )}

        {phase === "hold" ? (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={draw} style={{ ...casCta(false, true), flex: 2 }}>DRAW</button>
            <button onClick={askHint} style={{ ...casGhost(), flex: 1 }}>HINT</button>
          </div>
        ) : (
          <button onClick={deal} disabled={broke} style={casCta(broke, !broke)}>DEAL · {bet} {bet === 1 ? "COIN" : "COINS"}</button>
        )}

        {broke && (
          <div style={{ textAlign: "center", fontFamily: casMono, fontSize: 12, color: CAS.dim }}>
            Out of credits.{" "}
            <button onClick={resetBank} style={{ background: "none", border: "none", color: CAS.gold, textDecoration: "underline", cursor: "pointer", fontFamily: casMono, fontSize: 12 }}>
              Reset bankroll to {BANK_START}
            </button>
          </div>
        )}

        <div style={{ background: CAS.panel, border: `1px solid ${CAS.line}`, borderRadius: 12, padding: "12px 14px", fontFamily: casMono, fontSize: 11, lineHeight: 1.7, color: CAS.dim }}>
          Practice credits only — nothing is wagered, bought, or sent anywhere. Hint uses the trainer's
          exact-enumeration engine, so advice here and analysis there can never disagree. Want the full
          ranked list? Take the hand to the <a href="trainer.html" style={{ color: CAS.gold }}>Hold Trainer</a>.
          {" "}<button onClick={() => setAboutOpen(true)} style={{ background: "none", border: "none", color: CAS.gold, textDecoration: "underline", cursor: "pointer", fontFamily: casMono, fontSize: 11, padding: 0 }}>About</button>
        </div>
      </div>
    </div>
  );
}
