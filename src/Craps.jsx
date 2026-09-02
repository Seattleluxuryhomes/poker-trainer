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

/* ==================== VIEW (casino design kit) ==================== */

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

function Die({ v, rolling, delay = 0 }) {
  const pips = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }[v] || [];
  return (
    <div style={{
      width: 64, height: 64, borderRadius: 14,
      background: "linear-gradient(160deg, #fbf9f2, #e8e4d6 70%, #d5d0bf)",
      display: "grid", gridTemplateColumns: "repeat(3, 1fr)", padding: 10, gap: 2, boxSizing: "border-box",
      boxShadow: "0 10px 20px rgba(0,0,0,0.6), inset 0 -4px 0 rgba(0,0,0,0.14), inset 0 1px 0 rgba(255,255,255,0.8)",
      animation: rolling ? `crapsTumble 0.5s cubic-bezier(0.4, 0, 0.6, 1) ${delay}ms infinite` : "crapsLand 0.35s cubic-bezier(0.2, 1.6, 0.4, 1) both",
    }}>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} style={{
          borderRadius: "50%",
          background: pips.includes(i) ? "radial-gradient(circle at 35% 30%, #3a3f4c, #14171d 70%)" : "transparent",
          boxShadow: pips.includes(i) ? "inset 0 1px 2px rgba(0,0,0,0.7)" : "none",
        }} />
      ))}
    </div>
  );
}

function Puck({ on, point }) {
  return (
    <div style={{
      width: 46, height: 46, borderRadius: "50%", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", flex: "0 0 auto",
      background: on
        ? `radial-gradient(circle at 35% 30%, #fffdf5, #efe9d8 65%, #cfc7ac)`
        : "radial-gradient(circle at 35% 30%, #2a2f3a, #14171d 70%)",
      color: on ? "#14171d" : CAS.faint,
      border: `3px solid ${on ? CAS.gold : "#2a2f3a"}`,
      boxShadow: on ? `0 0 18px ${CAS.goldFaint}, 0 6px 12px rgba(0,0,0,0.5)` : "0 4px 10px rgba(0,0,0,0.5)",
      transition: "all 300ms ease", transform: on ? "rotateY(0deg)" : "rotateY(180deg)",
      fontFamily: casSans, fontWeight: 900,
    }}>
      <span style={{ fontSize: 9, letterSpacing: "0.18em" }}>{on ? "ON" : "OFF"}</span>
      {on && <span style={{ fontSize: 15, marginTop: -2 }}>{point}</span>}
    </div>
  );
}

export default function Craps() {
  const [bank, setBank] = React.useState(loadCrapsBank);
  const [chip, setChip] = React.useState(5);
  const [game, setGame] = React.useState({ phase: "comeout", point: null, bets: { pass: 0, dontPass: 0, odds: 0, field: 0 } });
  const [dice, setDice] = React.useState([3, 4]);
  const [rolling, setRolling] = React.useState(false);
  const [feed, setFeed] = React.useState(["Welcome to the rail. Pass line, then roll."]);
  const [logOpen, setLogOpen] = React.useState(false);
  const [winKey, setWinKey] = React.useState(0);
  const [winAmt, setWinAmt] = React.useState(0);
  const [flash, setFlash] = React.useState(null); // {text, tone, key}

  React.useEffect(() => { try { window.localStorage.setItem(CRAPS_BANK_KEY, String(bank)); } catch { /* private */ } }, [bank]);

  const b = game.bets;
  const staked = b.pass + b.dontPass + b.field + b.odds;
  const say = (lines) => setFeed((f) => [...f, ...lines].slice(-60));

  const place = (kind) => {
    if (rolling || chip > bank) return;
    if ((kind === "pass" || kind === "dontPass") && game.phase !== "comeout") return;
    if (kind === "pass" && b.dontPass > 0) return;
    if (kind === "dontPass" && b.pass > 0) return;
    if (kind === "odds" && (game.phase !== "point" || b.pass === 0)) return;
    if (kind === "odds" && b.odds + chip > b.pass * 3) { say(["Odds capped at 3× your pass line bet."]); return; }
    sfx.chip();
    setBank((v) => v - chip);
    setGame((g) => ({ ...g, bets: { ...g.bets, [kind]: g.bets[kind] + chip } }));
  };

  const roll = () => {
    if (rolling) return;
    if (staked === 0) { say(["Put something on the felt first."]); return; }
    setRolling(true);
    setFlash(null);
    sfx.dice(1050);
    const d1 = 1 + ((Math.random() * 6) | 0), d2 = 1 + ((Math.random() * 6) | 0);
    const shake = setInterval(() => setDice([1 + ((Math.random() * 6) | 0), 1 + ((Math.random() * 6) | 0)]), 85);
    setTimeout(() => {
      clearInterval(shake);
      setDice([d1, d2]);
      const out = resolveRoll(game, d1, d2);
      const stakedBefore = game.bets.pass + game.bets.dontPass + game.bets.odds + game.bets.field;
      const stakedAfter = out.state.bets.pass + out.state.bets.dontPass + out.state.bets.odds + out.state.bets.field;
      const resolvedStake = stakedBefore - stakedAfter;
      const net = out.credit - resolvedStake;
      setGame(out.state);
      if (out.credit > 0) setBank((v) => v + out.credit);
      say([`— rolled ${d1 + d2} (${d1}+${d2})`, ...out.events]);
      if (net > 0) { setWinAmt(net); setWinKey((k) => k + 1); }
      const evTxt = out.events.join(" ");
      if (/SEVEN OUT/.test(evTxt)) { setFlash({ text: "SEVEN OUT", tone: "red", key: Date.now() }); sfx.boom(); }
      else if (/Point .* made/i.test(evTxt)) setFlash({ text: `POINT ${d1 + d2} MADE`, tone: "gold", key: Date.now() });
      else if (/Natural/.test(evTxt) && out.credit > 0) setFlash({ text: `NATURAL ${d1 + d2}`, tone: "gold", key: Date.now() });
      setRolling(false);
    }, 1050);
  };

  const pp = pPassExact();
  const passEdge = (1 - 2 * pp) * 100;
  const dp = pDontPassExact();
  const dontEdge = ((1 - dp.win - dp.push) - dp.win) * 100;
  const fieldEdge = -fieldEvPerUnit() * 100;

  const betCard = (kind, title, sub, edge, enabled) => (
    <button onClick={() => place(kind)} disabled={!enabled || rolling} style={{
      flex: 1, minWidth: 140, textAlign: "left", padding: "11px 13px", borderRadius: 13, cursor: "pointer",
      position: "relative",
      border: `1.5px solid ${b[kind] > 0 ? CAS.gold : "rgba(245,197,66,0.18)"}`,
      background: b[kind] > 0
        ? `linear-gradient(180deg, rgba(245,197,66,0.14), rgba(245,197,66,0.05))`
        : "rgba(255,255,255,0.045)",
      color: CAS.cream, fontFamily: casSans,
      boxShadow: b[kind] > 0 ? `0 0 14px ${CAS.goldFaint}` : "inset 0 -2px 0 rgba(0,0,0,0.25)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13.5, fontWeight: 900, letterSpacing: "0.05em" }}>{title}</span>
        {b[kind] > 0 && <BetChip amount={b[kind]} />}
      </div>
      <div style={{ fontSize: 10, color: CAS.dim, marginTop: 3, lineHeight: 1.45 }}>{sub}</div>
      <div style={{ fontSize: 10, fontFamily: casMono, marginTop: 4, color: edge === 0 ? CAS.green : CAS.goldDim, fontWeight: 700 }}>
        {edge === 0 ? "edge 0.00% — the only fair bet in the casino" : `edge ${edge.toFixed(2)}% · enumerated`}
      </div>
    </button>
  );

  return (
    <div style={{ background: `radial-gradient(120% 60% at 50% -5%, ${CAS.room}, ${CAS.bg} 65%)`, minHeight: "100vh", fontFamily: casSans, color: CAS.text, display: "flex", flexDirection: "column" }}>
      <style>{CAS_CSS + `
        @keyframes crapsTumble {
          0% { transform: rotate(-14deg) translate(-8px, -10px) }
          25% { transform: rotate(10deg) translate(9px, -18px) }
          50% { transform: rotate(-8deg) translate(-6px, -4px) }
          75% { transform: rotate(14deg) translate(7px, -14px) }
          100% { transform: rotate(-14deg) translate(-8px, -10px) }
        }
        @keyframes crapsLand { 0% { transform: scale(1.25) rotate(6deg) } 60% { transform: scale(0.94) rotate(-2deg) } 100% { transform: none } }
      `}</style>
      <CasinoHeader title="CRAPS" sub="PASS · DON'T · FIELD · TRUE ODDS · PRACTICE CHIPS" bank={bank} />

      <div style={{ flex: 1, maxWidth: 700, width: "100%", margin: "0 auto", padding: "16px 14px 26px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12 }}>
        {/* the felt */}
        <div style={{ ...feltPanel("20px 16px"), display: "flex", flexDirection: "column", alignItems: "center", gap: 14, overflow: "hidden" }}>
          {flash && (
            <div key={flash.key} style={{
              position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
              background: flash.tone === "red" ? "rgba(140,20,15,0.5)" : "rgba(245,197,66,0.18)",
              animation: "casFlash 1.5s ease forwards", pointerEvents: "none", zIndex: 6, borderRadius: 14,
            }}>
              <span style={{
                fontSize: 34, fontWeight: 900, letterSpacing: "0.14em",
                color: flash.tone === "red" ? "#ffd7d2" : CAS.goldHi,
                textShadow: "0 2px 10px rgba(0,0,0,0.7)",
              }}>{flash.text}</span>
            </div>
          )}
          <BigWin amount={winAmt} fireKey={winKey} />
          <div style={{ display: "flex", gap: 7, alignItems: "center", justifyContent: "center", width: "100%" }}>
            <Puck on={game.phase === "point"} point={game.point} />
            {[4, 5, 6, 8, 9, 10].map((n) => (
              <span key={n} style={{
                width: 30, height: 30, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 900, fontSize: 12.5, fontFamily: casSans, flex: "0 0 auto",
                background: game.point === n ? "rgba(245,197,66,0.16)" : "rgba(0,0,0,0.3)",
                color: game.point === n ? CAS.gold : CAS.faint,
                border: `1.5px solid ${game.point === n ? CAS.gold : "rgba(255,255,255,0.1)"}`,
                transition: "all 250ms ease",
              }}>{n}</span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 18, padding: "6px 0 2px" }}>
            <Die v={dice[0]} rolling={rolling} />
            <Die v={dice[1]} rolling={rolling} delay={120} />
          </div>
          <div style={{ fontFamily: casMono, fontSize: 12.5, color: CAS.cream, minHeight: 20, textAlign: "center", maxWidth: "92%" }}>
            {feed[feed.length - 1]}
          </div>
        </div>

        {/* bets */}
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
          {betCard("pass", "PASS LINE", "7/11 wins the come-out; then make the point before the 7. Pays 1:1.", passEdge, game.phase === "comeout" && b.dontPass === 0)}
          {betCard("dontPass", "DON'T PASS", "The dark side: 2/3 win, 12 pushes; then the seven's your friend. Pays 1:1.", dontEdge, game.phase === "comeout" && b.pass === 0)}
        </div>
        <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
          {betCard("odds", `FREE ODDS${game.point ? ` · ${oddsPayout(game.point)}:1 TRUE` : ""}`, "Behind your pass bet once a point is set. Up to 3×.", 0, game.phase === "point" && b.pass > 0)}
          {betCard("field", "FIELD", "One roll: 2/3/4/9/10/11/12 win. 2 pays double, 12 pays TRIPLE.", fieldEdge, true)}
        </div>

        {/* rail */}
        <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
          {DCHIPS.map((v) => <CasinoChip key={v} value={v} selected={chip === v} onClick={() => setChip(v)} />)}
          <span style={{ marginLeft: "auto", fontFamily: casMono, fontSize: 12, color: CAS.dim }}>
            {staked > 0 ? `$${staked.toLocaleString()} working` : "the felt is empty"}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "2.4fr 1fr", gap: 8 }}>
          <button onClick={roll} disabled={rolling} style={casCta(rolling)}>{rolling ? "DICE ARE OUT…" : "ROLL"}</button>
          <button onClick={() => setLogOpen(true)} style={casGhost()}>FEED</button>
        </div>
        {bank === 0 && staked === 0 && (
          <button onClick={() => setBank(1000)} style={{ ...casGhost(), color: CAS.gold, border: `1px solid ${CAS.goldLine}` }}>
            Felted — restake $1,000 practice chips
          </button>
        )}
        <div style={{ fontSize: 10.5, color: CAS.faint, lineHeight: 1.65, fontFamily: casMono }}>
          Practice chips only. Pass line: {(pp * 100).toFixed(2)}% to win (244/495, enumerated).
          Load the free odds to 3× and your combined edge is the thinnest legally
          purchasable feeling of being alive.
        </div>
      </div>

      {logOpen && (
        <div onClick={() => setLogOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 280, background: "rgba(0,0,0,0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#12161d", border: `1px solid ${CAS.goldLine}`, borderRadius: 16, width: "100%", maxWidth: 420, maxHeight: "70vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 70px rgba(0,0,0,0.8)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 15px", borderBottom: `1px solid ${CAS.line}` }}>
              <span style={{ fontSize: 13, fontWeight: 900, letterSpacing: "0.14em" }}>ROLL FEED</span>
              <button onClick={() => setLogOpen(false)} style={{ ...casGhost(), padding: "6px 14px" }}>CLOSE</button>
            </div>
            <div style={{ overflowY: "auto", padding: "10px 15px", fontFamily: casMono, fontSize: 12, lineHeight: 1.7 }}>
              {feed.map((l, i) => <div key={i} style={{ color: l.startsWith("—") ? CAS.gold : "#c9cfda" }}>{l}</div>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
