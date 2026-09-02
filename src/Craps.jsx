import React, { useState, useEffect } from "react";

/* ============================================================
   CRAPS (craps.html) — the come-out/point cycle with pass,
   don't pass (bar 12), field (12 pays triple), and FREE ODDS at
   true payouts — the one bet in any casino with a house edge of
   exactly zero, computed here from dice enumeration and labeled
   as such. Everything on this felt shows its enumerated edge.
   Practice chips only; bankroll lives in this browser.
   Pure functions (diceWays, pPassExact, fieldEvPerUnit,
   oddsPayout, resolveRoll) are top-level so
   engine/verify_craps.js can eval this page and re-prove every
   number.
   ============================================================ */

/* ---- dice truth, by enumeration ---- */
function diceWays(total) {
  let n = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b === total) n++;
  return n;
}
/* P(pass line wins), enumerated: come-out naturals, plus each point's race vs the seven. */
function pPassExact() {
  let p = 0;
  for (let t = 2; t <= 12; t++) {
    const w = diceWays(t) / 36;
    if (t === 7 || t === 11) p += w;
    else if (t === 2 || t === 3 || t === 12) p += 0;
    else p += w * (diceWays(t) / (diceWays(t) + diceWays(7)));
  }
  return p; // = 244/495
}
/* Don't pass (bar 12): come-out 2/3 win, 12 pushes, 7/11 lose; then the seven races the point. */
function pDontPassExact() {
  let win = 0, push = 0;
  for (let t = 2; t <= 12; t++) {
    const w = diceWays(t) / 36;
    if (t === 2 || t === 3) win += w;
    else if (t === 12) push += w;
    else if (t === 7 || t === 11) win += 0;
    else win += w * (diceWays(7) / (diceWays(t) + diceWays(7)));
  }
  return { win, push };
}
/* Field: one-roll, 2 pays 2:1, 12 pays 3:1, 3/4/9/10/11 pay 1:1. Enumerated EV. */
function fieldEvPerUnit() {
  let ev = 0;
  for (let t = 2; t <= 12; t++) {
    const w = diceWays(t) / 36;
    if (t === 2) ev += w * 2;
    else if (t === 12) ev += w * 3;
    else if ([3, 4, 9, 10, 11].includes(t)) ev += w * 1;
    else ev -= w;
  }
  return ev; // = -1/36 with the triple-12 layout
}
/* Free odds behind the pass line pay TRUE odds — EV exactly zero, by construction. */
function oddsPayout(point) {
  return { 4: 2, 10: 2, 5: 1.5, 9: 1.5, 6: 1.2, 8: 1.2 }[point];
}

/* ---- the pure state machine: one roll in, settlements out ----
 * state: { phase: "comeout"|"point", point, bets: {pass, dontPass, odds, field} }
 * returns { state, credit, events: [text] } — credit is chips returned to the
 * player this roll (stakes were deducted when placed). */
function resolveRoll(state, d1, d2) {
  const t = d1 + d2;
  const s = { phase: state.phase, point: state.point, bets: { ...state.bets } };
  let credit = 0;
  const events = [];
  const b = s.bets;

  // field resolves every roll
  if (b.field > 0) {
    if (t === 2) { credit += b.field * 3; events.push(`Field pays double on ${t}: +$${b.field * 2}`); }
    else if (t === 12) { credit += b.field * 4; events.push(`Field pays TRIPLE on 12: +$${b.field * 3}`); }
    else if ([3, 4, 9, 10, 11].includes(t)) { credit += b.field * 2; events.push(`Field wins on ${t}: +$${b.field}`); }
    else events.push(`Field loses on ${t}`);
    b.field = 0;
  }

  if (s.phase === "comeout") {
    if (t === 7 || t === 11) {
      if (b.pass > 0) { credit += b.pass * 2; events.push(`Natural ${t} — pass line wins +$${b.pass}`); b.pass = 0; }
      if (b.dontPass > 0) { events.push(`Natural ${t} — don't pass loses`); b.dontPass = 0; }
    } else if (t === 2 || t === 3 || t === 12) {
      if (b.pass > 0) { events.push(`Craps ${t} — pass line loses`); b.pass = 0; }
      if (b.dontPass > 0) {
        if (t === 12) { credit += b.dontPass; events.push("Twelve — don't pass PUSHES (bar 12)"); }
        else { credit += b.dontPass * 2; events.push(`Craps ${t} — don't pass wins +$${b.dontPass}`); }
        b.dontPass = 0;
      }
      if (!(b.pass > 0) && !(b.dontPass > 0)) events.push(`Craps ${t}`);
    } else {
      s.phase = "point";
      s.point = t;
      events.push(`Point is ${t} — the ${t} races the seven`);
    }
  } else {
    if (t === s.point) {
      events.push(`Point ${t} made!`);
      if (b.pass > 0) { credit += b.pass * 2; events.push(`Pass line wins +$${b.pass}`); b.pass = 0; }
      if (b.odds > 0) {
        const pay = oddsPayout(s.point);
        const winnings = Math.round(b.odds * pay);
        credit += b.odds + winnings;
        events.push(`Odds pay TRUE ${pay}:1 — +$${winnings} (zero-edge bet)`);
        b.odds = 0;
      }
      if (b.dontPass > 0) { events.push("Don't pass loses"); b.dontPass = 0; }
      s.phase = "comeout"; s.point = null;
    } else if (t === 7) {
      events.push("SEVEN OUT");
      if (b.pass > 0) { events.push("Pass line loses"); b.pass = 0; }
      if (b.odds > 0) { events.push("Odds lose"); b.odds = 0; }
      if (b.dontPass > 0) { credit += b.dontPass * 2; events.push(`Don't pass wins +$${b.dontPass}`); b.dontPass = 0; }
      s.phase = "comeout"; s.point = null;
    } else {
      events.push(`${t} — still chasing the ${s.point}`);
    }
  }
  return { state: s, credit, events };
}

const C = {
  bg: "#0b0e11", line: "#222630", line2: "#2c303c", green: "#00e676", gold: "#ffd54f",
  dim: "#8b93a3", faint: "#5b6272", red: "#ff5252", felt: "#0f2018", feltHi: "#16301f", rail: "#1e2c24",
};
const cSans = "Inter, 'Albert Sans', system-ui, sans-serif";
const CRAPS_BANK_KEY = "poker-trainer:crapsBank";
function loadCrapsBank() {
  try {
    const raw = window.localStorage.getItem(CRAPS_BANK_KEY);
    if (raw == null) return 1000;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? v : 1000;
  } catch { return 1000; }
}
const DCHIPS = [5, 25, 100];
const dChipColor = (v) => (v === 5 ? "#e74c3c" : v === 25 ? "#27ae60" : "#2c3e50");

function Die({ v, rolling }) {
  const pips = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }[v] || [];
  return (
    <div style={{
      width: 58, height: 58, borderRadius: 12, background: "#f2f0e9",
      display: "grid", gridTemplateColumns: "repeat(3, 1fr)", padding: 8, gap: 2, boxSizing: "border-box",
      boxShadow: "0 6px 14px rgba(0,0,0,0.55), inset 0 -3px 0 rgba(0,0,0,0.15)",
      animation: rolling ? "diceShake 0.45s ease infinite" : "none",
    }}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} style={{ borderRadius: "50%", background: pips.includes(i) ? "#14171d" : "transparent" }} />
      ))}
    </div>
  );
}

export default function Craps() {
  const [bank, setBank] = useState(loadCrapsBank);
  const [chip, setChip] = useState(5);
  const [game, setGame] = useState({ phase: "comeout", point: null, bets: { pass: 0, dontPass: 0, odds: 0, field: 0 } });
  const [dice, setDice] = useState([3, 4]);
  const [rolling, setRolling] = useState(false);
  const [feed, setFeed] = useState(["Welcome to the rail. Pass line, then roll."]);
  const [logOpen, setLogOpen] = useState(false);

  useEffect(() => { try { window.localStorage.setItem(CRAPS_BANK_KEY, String(bank)); } catch { /* private */ } }, [bank]);

  const b = game.bets;
  const say = (lines) => setFeed((f) => [...f, ...lines].slice(-60));

  const place = (kind) => {
    if (rolling || chip > bank) return;
    if ((kind === "pass" || kind === "dontPass") && game.phase !== "comeout") return; // contract bets go down before a point
    if (kind === "pass" && b.dontPass > 0) return;      // pick a side
    if (kind === "dontPass" && b.pass > 0) return;
    if (kind === "odds" && (game.phase !== "point" || b.pass === 0)) return;
    if (kind === "odds" && b.odds + chip > b.pass * 3) { say(["Odds capped at 3× your pass line bet."]); return; }
    setBank((v) => v - chip);
    setGame((g) => ({ ...g, bets: { ...g.bets, [kind]: g.bets[kind] + chip } }));
  };

  const roll = () => {
    if (rolling) return;
    if (b.pass + b.dontPass + b.field + b.odds === 0) { say(["Put something on the felt first."]); return; }
    setRolling(true);
    const d1 = 1 + ((Math.random() * 6) | 0), d2 = 1 + ((Math.random() * 6) | 0);
    const shake = setInterval(() => setDice([1 + ((Math.random() * 6) | 0), 1 + ((Math.random() * 6) | 0)]), 90);
    setTimeout(() => {
      clearInterval(shake);
      setDice([d1, d2]);
      const out = resolveRoll(game, d1, d2);
      setGame(out.state);
      if (out.credit > 0) setBank((v) => v + out.credit);
      say([`— rolled ${d1 + d2} (${d1}+${d2})`, ...out.events]);
      setRolling(false);
    }, 900);
  };

  const pp = pPassExact();
  const passEdge = (1 - 2 * pp) * 100;                       // lose prob − win prob, as %
  const dp = pDontPassExact();
  const dontEdge = ((1 - dp.win - dp.push) - dp.win) * 100;
  const fieldEdge = -fieldEvPerUnit() * 100;

  const betCard = (kind, title, sub, edge, enabled) => (
    <button onClick={() => place(kind)} disabled={!enabled || rolling} style={{
      flex: 1, minWidth: 130, textAlign: "left", padding: "10px 12px", borderRadius: 11, cursor: "pointer",
      border: `1px solid ${b[kind] > 0 ? C.gold : C.line2}`,
      background: b[kind] > 0 ? "rgba(255,213,79,0.08)" : "rgba(255,255,255,0.04)", color: "#e8ebf2",
      fontFamily: cSans,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 800 }}>{title}</span>
        {b[kind] > 0 && <span style={{ fontSize: 12, fontWeight: 900, color: C.gold }}>${b[kind]}</span>}
      </div>
      <div style={{ fontSize: 10, color: C.dim, marginTop: 2 }}>{sub}</div>
      <div style={{ fontSize: 10, fontFamily: "ui-monospace, Menlo, monospace", marginTop: 3, color: edge === 0 ? C.green : C.gold, fontWeight: 700 }}>
        {edge === 0 ? "house edge 0.00% — the only fair bet in the casino" : `house edge ${edge.toFixed(2)}% (enumerated)`}
      </div>
    </button>
  );

  return (
    <div style={{ background: `radial-gradient(130% 70% at 50% -10%, #10151b, ${C.bg} 60%)`, minHeight: "100vh", fontFamily: cSans, color: "#e8ebf2", display: "flex", flexDirection: "column" }}>
      <style>{`html,body{background:${C.bg}} button:active{filter:brightness(1.15)} button:disabled{opacity:.4;cursor:default}
        @keyframes diceShake { 0%,100%{transform:rotate(-7deg) translateY(0)} 50%{transform:rotate(7deg) translateY(-6px)} }`}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", flexWrap: "wrap", gap: 8 }}>
        <div>
          <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: "0.12em", color: C.dim }}>CRAPS</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: C.faint, marginLeft: 8 }}>PRACTICE CHIPS ONLY · EVERY EDGE PRINTED</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <AccountArea dark />
          <a href="index.html" aria-label="Home" style={{ color: C.dim, textDecoration: "none", fontSize: 16, border: `1px solid ${C.line}`, borderRadius: 9, padding: "5px 9px" }}>⌂</a>
        </div>
      </div>

      <div style={{ flex: 1, maxWidth: 680, width: "100%", margin: "0 auto", padding: "4px 14px 24px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12 }}>
        {/* the rail: point puck + dice */}
        <div style={{
          borderRadius: 18, border: `6px solid ${C.rail}`, padding: "18px 16px",
          background: `radial-gradient(80% 90% at 50% 20%, ${C.feltHi}, ${C.felt} 80%)`,
          boxShadow: "inset 0 0 36px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column", alignItems: "center", gap: 14,
        }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {[4, 5, 6, 8, 9, 10].map((n) => (
              <span key={n} style={{
                width: 34, height: 34, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 900, fontSize: 13,
                background: game.point === n ? "#f2f0e9" : "rgba(0,0,0,0.3)",
                color: game.point === n ? "#14171d" : C.faint,
                border: `2px solid ${game.point === n ? C.gold : C.line2}`,
              }}>{n}</span>
            ))}
          </div>
          <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", color: game.phase === "point" ? C.gold : C.dim }}>
            {game.phase === "point" ? `POINT IS ${game.point} — ON` : "COME-OUT ROLL — OFF"}
          </div>
          <div style={{ display: "flex", gap: 14 }}>
            <Die v={dice[0]} rolling={rolling} />
            <Die v={dice[1]} rolling={rolling} />
          </div>
          <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, color: "#c9cfda", minHeight: 18, textAlign: "center" }}>
            {feed[feed.length - 1]}
          </div>
        </div>

        {/* bets */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {betCard("pass", "PASS LINE", "7/11 wins the come-out; then make the point before the 7. Pays 1:1.", passEdge, game.phase === "comeout" && b.dontPass === 0)}
          {betCard("dontPass", "DON'T PASS", "The dark side: 2/3 win, 12 pushes; then the seven's your friend. Pays 1:1.", dontEdge, game.phase === "comeout" && b.pass === 0)}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {betCard("odds", `FREE ODDS ${game.point ? `(pays ${oddsPayout(game.point)}:1 true)` : ""}`, "Behind your pass bet once a point is set. Up to 3×. True odds — zero edge.", 0, game.phase === "point" && b.pass > 0)}
          {betCard("field", "FIELD", "One roll: 2/3/4/9/10/11/12 win. 2 pays double, 12 pays TRIPLE.", fieldEdge, true)}
        </div>

        {/* controls */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: C.dim }}>CHIP</span>
          {DCHIPS.map((v) => (
            <button key={v} onClick={() => setChip(v)} style={{
              width: 40, height: 40, borderRadius: "50%", cursor: "pointer", fontWeight: 900, fontSize: 12,
              background: dChipColor(v), color: "#fff",
              border: chip === v ? `3px solid ${C.gold}` : "3px dashed rgba(0,0,0,0.35)",
            }}>{v}</button>
          ))}
          <span style={{ marginLeft: "auto", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13, fontWeight: 800, color: C.green }}>${bank.toLocaleString()}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "2.2fr 1fr", gap: 8 }}>
          <button onClick={roll} disabled={rolling} style={{
            padding: "14px 8px", borderRadius: 11, cursor: "pointer", fontWeight: 900, fontSize: 15, letterSpacing: "0.06em",
            background: `linear-gradient(180deg, #2aff8f, ${C.green} 55%, #00b25a)`, color: "#00230f", border: "none",
            boxShadow: "0 4px 16px rgba(0,230,118,0.35)",
          }}>{rolling ? "DICE ARE OUT…" : "ROLL"}</button>
          <button onClick={() => setLogOpen(true)} style={{ padding: "14px 6px", borderRadius: 11, cursor: "pointer", fontWeight: 800, fontSize: 12, background: "#232733", color: "#e8ebf2", border: `1px solid ${C.line2}` }}>FEED</button>
        </div>
        {bank === 0 && b.pass + b.dontPass + b.field + b.odds === 0 && (
          <button onClick={() => setBank(1000)} style={{ padding: "10px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 12, background: "rgba(255,213,79,0.12)", color: C.gold, border: "1px solid rgba(255,213,79,0.4)" }}>
            Felted — restake $1,000 practice chips
          </button>
        )}
        <div style={{ fontSize: 10.5, color: C.faint, lineHeight: 1.6, fontFamily: "ui-monospace, Menlo, monospace" }}>
          Practice chips only. Pass line: {(pp * 100).toFixed(2)}% to win (244/495, enumerated).
          Load the free odds to 3× and your combined edge is the thinnest legally
          purchasable feeling of being alive.
        </div>
      </div>

      {logOpen && (
        <div onClick={() => setLogOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 280, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#14171d", border: `1px solid ${C.line2}`, borderRadius: 14, width: "100%", maxWidth: 420, maxHeight: "70vh", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: `1px solid ${C.line}` }}>
              <span style={{ fontSize: 13, fontWeight: 800 }}>ROLL FEED</span>
              <button onClick={() => setLogOpen(false)} style={{ background: "#232733", color: "#e8ebf2", border: "none", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontWeight: 800, fontSize: 12 }}>CLOSE</button>
            </div>
            <div style={{ overflowY: "auto", padding: "10px 14px", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, lineHeight: 1.7 }}>
              {feed.map((l, i) => <div key={i} style={{ color: l.startsWith("—") ? C.gold : "#c9cfda" }}>{l}</div>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
