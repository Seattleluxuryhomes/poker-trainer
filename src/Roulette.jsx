import React, { useState, useEffect, useRef } from "react";

/* ============================================================
   ROULETTE (roulette.html) — American double-zero wheel.
   Project philosophy applied to a house game: every probability
   is ENUMERATED over the 38 pockets and printed on the felt —
   each bet shows its true chance, payout, and exact house edge
   (−2/38 ≈ −5.26% on every bet offered here; the five-number
   basket, the one worse bet, is deliberately not offered).
   Practice chips only; the bankroll lives in this browser.
   Pure functions (POCKETS/covers/settleSpin) are top-level so
   engine/verify_roulette.js can eval this page and re-prove the
   math on every offered bet.
   ============================================================ */

/* ---- the wheel, exactly ---- */
/* American wheel sequence, clockwise from 0. Pockets are strings ("0","00","1".."36"). */
const WHEEL_ORDER = ["0", "28", "9", "26", "30", "11", "7", "20", "32", "17", "5", "22", "34", "15", "3", "24", "36", "13", "1", "00", "27", "10", "25", "29", "12", "8", "19", "31", "18", "6", "21", "33", "16", "4", "23", "35", "14", "2"];
const POCKETS = WHEEL_ORDER.slice(); // 38 pockets
const RED_SET = new Set(["1", "3", "5", "7", "9", "12", "14", "16", "18", "19", "21", "23", "25", "27", "30", "32", "34", "36"]);
const pocketColor = (p) => (p === "0" || p === "00" ? "green" : RED_SET.has(p) ? "red" : "black");
const pocketNum = (p) => (p === "0" || p === "00" ? 0 : Number(p));

/* ---- the offered bets: selector + payout (to 1) ---- */
function covers(betId, pocket) {
  const n = pocketNum(pocket);
  const isZero = pocket === "0" || pocket === "00";
  switch (betId) {
    case "red": return pocketColor(pocket) === "red";
    case "black": return pocketColor(pocket) === "black";
    case "odd": return !isZero && n % 2 === 1;
    case "even": return !isZero && n % 2 === 0;
    case "low": return !isZero && n >= 1 && n <= 18;
    case "high": return !isZero && n >= 19 && n <= 36;
    case "dozen1": return n >= 1 && n <= 12;
    case "dozen2": return n >= 13 && n <= 24;
    case "dozen3": return n >= 25 && n <= 36;
    case "col1": return !isZero && n % 3 === 1;
    case "col2": return !isZero && n % 3 === 2;
    case "col3": return !isZero && n % 3 === 0;
    default:
      return betId.startsWith("n:") && betId.slice(2) === pocket; // straight up
  }
}
function betPayout(betId) {
  if (betId.startsWith("n:")) return 35;
  if (betId.startsWith("dozen") || betId.startsWith("col")) return 2;
  return 1; // the even-money outsides
}
/* Enumerated truth for the info drawer: {ways, p, payout, evPerUnit}. */
function betMath(betId) {
  let ways = 0;
  for (const p of POCKETS) if (covers(betId, p)) ways++;
  const payout = betPayout(betId);
  return { ways, p: ways / 38, payout, evPerUnit: (ways * payout - (38 - ways)) / 38 };
}
/* Settle a spin: returns the total returned to the player (stake + winnings on
 * winning bets; losing stakes are already gone — they were deducted at placement). */
function settleSpin(bets, pocket) {
  let back = 0;
  for (const id of Object.keys(bets)) {
    if (covers(id, pocket)) back += bets[id] * (betPayout(id) + 1);
  }
  return back;
}

/* ==================== VIEW (casino design kit) ==================== */

const ROU_BANK_KEY = "poker-trainer:rouletteBank";
function loadRouBank() {
  try {
    const raw = window.localStorage.getItem(ROU_BANK_KEY);
    if (raw == null) return 1000;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? v : 1000;
  } catch { return 1000; }
}

const SEG = 360 / 38;
const CHIPS = [1, 5, 25, 100];

/* The wheel: gold rim, mahogany cone, radial numbers, an orbiting ball that
 * settles into the winning pocket. Numbers sit in per-segment rotated groups,
 * so they read like a real wheel. */
function Wheel({ spinKey, resultIdx, size }) {
  const turns = React.useRef(0);
  const [ballIn, setBallIn] = React.useState(false);
  React.useEffect(() => {
    if (!spinKey) return;
    setBallIn(false);
    const t = setTimeout(() => setBallIn(true), 2400); // the ball drops late, like it should
    return () => clearTimeout(t);
  }, [spinKey]);
  if (spinKey) turns.current += 6;
  const angle = spinKey ? -(resultIdx * SEG) - 360 * turns.current : 0;
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "0 0 auto", filter: "drop-shadow(0 16px 30px rgba(0,0,0,0.6))" }}>
      {/* pointer */}
      <div style={{
        position: "absolute", top: -3, left: "50%", transform: "translateX(-50%)", zIndex: 4,
        width: 0, height: 0, borderLeft: "9px solid transparent", borderRight: "9px solid transparent",
        borderTop: `16px solid ${CAS.gold}`, filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.7))",
      }} />
      {/* static gold rim */}
      <div style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: `conic-gradient(${CAS.goldHi}, #b8860b, ${CAS.gold}, #8a6508, ${CAS.goldHi})`,
        boxShadow: "inset 0 0 8px rgba(0,0,0,0.6)",
      }} />
      <svg viewBox="-100 -100 200 200" style={{
        position: "absolute", inset: "3.5%", width: "93%", height: "93%",
        transform: `rotate(${angle}deg)`,
        transition: spinKey ? "transform 3.4s cubic-bezier(0.12, 0.82, 0.2, 1)" : "none",
      }}>
        {WHEEL_ORDER.map((p, i) => {
          const a0 = -SEG / 2, a1 = SEG / 2;
          const color = pocketColor(p);
          const fill = color === "green" ? "#0e6e3e" : color === "red" ? "#b3271e" : "#14161c";
          return (
            <g key={p} transform={`rotate(${i * SEG})`}>
              <path d={`M0,0 L${Math.sin(a0 * Math.PI / 180) * 99},${-Math.cos(a0 * Math.PI / 180) * 99} A99,99 0 0,1 ${Math.sin(a1 * Math.PI / 180) * 99},${-Math.cos(a1 * Math.PI / 180) * 99} Z`}
                fill={fill} stroke="#06070a" strokeWidth="0.7" />
              <text x="0" y="-86" fontSize="8.6" fill={CAS.cream} fontWeight="800" textAnchor="middle"
                dominantBaseline="middle" style={{ fontFamily: casSans }}>{p}</text>
            </g>
          );
        })}
        {/* separators ring + cone */}
        <circle r="72" fill="none" stroke="rgba(245,197,66,0.35)" strokeWidth="1" />
        <circle r="58" fill="#241408" stroke="#3a2a18" strokeWidth="3" />
        <circle r="46" fill="#1a0f06" />
        {/* cross handles */}
        {[0, 90].map((r) => (
          <rect key={r} x="-52" y="-3.4" width="104" height="6.8" rx="3.4" transform={`rotate(${r + 45})`}
            fill={`url(#casGoldBar)`} />
        ))}
        <defs>
          <linearGradient id="casGoldBar" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#8a6508" /><stop offset="0.5" stopColor={CAS.goldHi} /><stop offset="1" stopColor="#8a6508" />
          </linearGradient>
        </defs>
        <circle r="10" fill={`url(#casGoldBar)`} stroke="#5a4226" strokeWidth="1.5" />
        {/* the ball, seated in the winning pocket once it drops (top of wheel = pointer) */}
        {ballIn && resultIdx != null && (
          <circle cx={Math.sin(resultIdx * SEG * Math.PI / 180) * 78} cy={-Math.cos(resultIdx * SEG * Math.PI / 180) * 78}
            r="4.6" fill="#f4f2ea" style={{ filter: "drop-shadow(0 1px 1.5px rgba(0,0,0,0.8))" }} />
        )}
      </svg>
      {/* the ball orbiting against the spin before it drops */}
      {spinKey && !ballIn && (
        <div style={{ position: "absolute", inset: "6%", borderRadius: "50%", animation: "rouBallOrbit 0.5s linear infinite", zIndex: 3 }}>
          <span style={{ position: "absolute", top: "4%", left: "50%", width: 10, height: 10, marginLeft: -5, borderRadius: "50%", background: "#f4f2ea", boxShadow: "0 1px 3px rgba(0,0,0,0.8)" }} />
        </div>
      )}
    </div>
  );
}

export default function Roulette() {
  const [bank, setBank] = React.useState(loadRouBank);
  const [chip, setChip] = React.useState(5);
  const [bets, setBets] = React.useState({});
  const [lastBets, setLastBets] = React.useState(null);
  const [phase, setPhase] = React.useState("bet"); // bet | spinning | done
  const [result, setResult] = React.useState(null);
  const [spinKey, setSpinKey] = React.useState(0);
  const [won, setWon] = React.useState(0);
  const [winKey, setWinKey] = React.useState(0);
  const [history, setHistory] = React.useState([]);
  const [info, setInfo] = React.useState(null);

  React.useEffect(() => { try { window.localStorage.setItem(ROU_BANK_KEY, String(bank)); } catch { /* private */ } }, [bank]);

  const staked = Object.values(bets).reduce((a, b) => a + b, 0);

  const addBet = (id) => {
    if (phase === "spinning") return;
    if (phase === "done") { setPhase("bet"); setResult(null); }
    if (chip > bank) return;
    sfx.chip();
    setBank((b) => b - chip);
    setBets((m) => ({ ...m, [id]: (m[id] || 0) + chip }));
    setInfo(id);
  };
  const clearBets = () => {
    if (phase === "spinning") return;
    setBank((b) => b + staked);
    setBets({});
  };
  const rebet = () => {
    if (phase === "spinning" || !lastBets) return;
    const total = Object.values(lastBets).reduce((a, b) => a + b, 0);
    if (total > bank) return;
    setBank((b) => b - total);
    setBets((m) => {
      const next = { ...m };
      for (const k of Object.keys(lastBets)) next[k] = (next[k] || 0) + lastBets[k];
      return next;
    });
    setPhase("bet"); setResult(null);
  };
  const spin = () => {
    if (phase === "spinning" || staked === 0) return;
    const pocket = POCKETS[(Math.random() * 38) | 0];
    setResult(pocket);
    setSpinKey((k) => k + 1);
    sfx.spin(3400, 2400);
    setPhase("spinning");
    setTimeout(() => {
      const back = settleSpin(bets, pocket);
      setBank((b) => b + back);
      const net = back - staked;
      setWon(net);
      if (net > 0) setWinKey((k) => k + 1);
      setLastBets(bets);
      setBets({});
      setHistory((h) => [pocket, ...h].slice(0, 14));
      setPhase("done");
    }, 3600);
  };

  const spot = (id, label, style = {}) => {
    const amt = bets[id] || 0;
    return (
      <button key={id} onClick={() => addBet(id)} style={{
        position: "relative", padding: "11px 4px", borderRadius: 8, cursor: "pointer",
        border: `1px solid ${amt ? CAS.gold : "rgba(255,255,255,0.14)"}`,
        background: "rgba(255,255,255,0.05)", color: CAS.cream,
        fontFamily: casSans, fontSize: 12, fontWeight: 800, letterSpacing: "0.04em", minWidth: 0,
        boxShadow: amt ? `0 0 12px ${CAS.goldFaint}` : "inset 0 -2px 0 rgba(0,0,0,0.25)",
        ...style,
      }}>
        {label}
        {amt > 0 && <BetChip amount={amt} />}
      </button>
    );
  };
  const numCell = (n) => {
    const p = String(n);
    const red = pocketColor(p) === "red";
    return spot(`n:${p}`, p, {
      background: red
        ? `linear-gradient(180deg, ${CAS.red}, ${CAS.redDeep})`
        : `linear-gradient(180deg, #232834, ${CAS.black})`,
      padding: "9px 0", fontSize: 12.5,
      border: `1px solid ${bets[`n:${p}`] ? CAS.gold : "rgba(255,255,255,0.12)"}`,
    });
  };

  const m = info ? betMath(info) : null;
  const infoLabel = info ? (info.startsWith("n:") ? `Straight ${info.slice(2)}` : { red: "Red", black: "Black", odd: "Odd", even: "Even", low: "1–18", high: "19–36", dozen1: "1st dozen", dozen2: "2nd dozen", dozen3: "3rd dozen", col1: "Column 1", col2: "Column 2", col3: "Column 3" }[info]) : null;
  const resultIdx = result != null ? WHEEL_ORDER.indexOf(result) : null;

  return (
    <div style={{ background: `radial-gradient(120% 60% at 50% -5%, ${CAS.room}, ${CAS.bg} 65%)`, minHeight: "100vh", fontFamily: casSans, color: CAS.text, display: "flex", flexDirection: "column" }}>
      <style>{CAS_CSS + `
        @keyframes rouBallOrbit { from { transform: rotate(0deg) } to { transform: rotate(-360deg) } }
      `}</style>
      <CasinoHeader title="ROULETTE" sub="AMERICAN 00 · EVERY EDGE PRINTED · PRACTICE CHIPS" bank={bank} />

      <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 20, justifyContent: "center", alignItems: "flex-start", padding: "16px 14px 26px", maxWidth: 1060, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        {/* the wheel side */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, position: "relative" }}>
          <Wheel spinKey={spinKey} resultIdx={resultIdx} size={Math.min(320, typeof window !== "undefined" ? window.innerWidth - 56 : 320)} />
          <MarqueeLights />
          <BigWin amount={won} fireKey={phase === "done" && won > 0 ? winKey : 0} />
          <div style={{ minHeight: 48, textAlign: "center" }}>
            {phase === "spinning" && (
              <span style={{ fontWeight: 900, color: CAS.gold, letterSpacing: "0.22em", fontSize: 13, animation: "casPulseGold 1.2s ease infinite", borderRadius: 999, padding: "7px 16px", display: "inline-block", border: `1px solid ${CAS.goldLine}` }}>
                NO MORE BETS
              </span>
            )}
            {phase === "done" && result != null && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 10, animation: "casPop 300ms ease both" }}>
                <span style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 46, height: 46, borderRadius: "50%",
                  background: pocketColor(result) === "green" ? "#0e6e3e" : pocketColor(result) === "red" ? CAS.red : CAS.black,
                  border: `2.5px solid ${CAS.gold}`, fontWeight: 900, fontSize: 17, boxShadow: `0 0 20px ${CAS.goldFaint}`,
                }}>{result}</span>
                <span style={{ fontWeight: 900, fontSize: 17, color: won > 0 ? CAS.green : won < 0 ? CAS.dim : CAS.dim }}>
                  {won > 0 ? `you win $${won.toLocaleString()}` : won < 0 ? `the house takes $${(-won).toLocaleString()}` : "push"}
                </span>
              </div>
            )}
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "center", maxWidth: 320 }}>
            {history.map((p, i) => (
              <span key={i} style={{
                width: 26, height: 26, borderRadius: "50%", fontSize: 11, fontWeight: 800,
                display: "flex", alignItems: "center", justifyContent: "center", color: CAS.cream,
                background: pocketColor(p) === "green" ? "#0e6e3e" : pocketColor(p) === "red" ? CAS.red : CAS.black,
                border: `1px solid ${i === 0 ? CAS.gold : "rgba(255,255,255,0.15)"}`, opacity: 1 - i * 0.055,
              }}>{p}</span>
            ))}
          </div>
        </div>

        {/* the felt board */}
        <div style={{ flex: "1 1 340px", maxWidth: 470, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ ...feltPanel("14px 12px"), display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {spot("n:0", "0", { background: "linear-gradient(180deg, #128a4e, #0a5c33)", padding: "10px 0", fontSize: 14 })}
              {spot("n:00", "00", { background: "linear-gradient(180deg, #128a4e, #0a5c33)", padding: "10px 0", fontSize: 14 })}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 4 }}>
              {[3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36].map(numCell)}
              {[2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35].map(numCell)}
              {[1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34].map(numCell)}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 5 }}>
              {spot("col3", "COL 3 · 2:1")}{spot("col2", "COL 2 · 2:1")}{spot("col1", "COL 1 · 2:1")}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 5 }}>
              {spot("dozen1", "1st 12")}{spot("dozen2", "2nd 12")}{spot("dozen3", "3rd 12")}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 5 }}>
              {spot("low", "1–18")}{spot("even", "EVEN")}
              {spot("red", "◆", { background: `linear-gradient(180deg, ${CAS.red}, ${CAS.redDeep})`, fontSize: 15 })}
              {spot("black", "◆", { background: `linear-gradient(180deg, #232834, ${CAS.black})`, fontSize: 15 })}
              {spot("odd", "ODD")}{spot("high", "19–36")}
            </div>
          </div>

          <div style={{
            background: CAS.panel, border: `1px solid ${info ? CAS.goldLine : CAS.line}`, borderRadius: 10,
            padding: "9px 13px", fontSize: 12, fontFamily: casMono, color: CAS.dim, minHeight: 20,
          }}>
            {m ? (
              <>
                <b style={{ color: CAS.cream }}>{infoLabel}</b> · {m.ways}/38 = {(m.p * 100).toFixed(2)}% · pays {m.payout}:1 ·
                edge <b style={{ color: CAS.gold }}>{(-m.evPerUnit * 100).toFixed(2)}%</b> — enumerated, not estimated
              </>
            ) : "tap any bet to see its true odds"}
          </div>

          <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
            {CHIPS.map((v) => <CasinoChip key={v} value={v} selected={chip === v} onClick={() => setChip(v)} />)}
            <span style={{ marginLeft: "auto", fontFamily: casMono, fontSize: 12, color: CAS.dim }}>
              {staked > 0 ? `$${staked.toLocaleString()} on the felt` : "place your bets"}
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
            <button onClick={spin} disabled={phase === "spinning" || staked === 0} style={casCta(phase === "spinning" || staked === 0, staked > 0)}>SPIN</button>
            <button onClick={clearBets} disabled={phase === "spinning" || staked === 0} style={casGhost()}>CLEAR</button>
            <button onClick={rebet} disabled={phase === "spinning" || !lastBets} style={casGhost()}>REBET</button>
          </div>
          {bank === 0 && staked === 0 && (
            <button onClick={() => setBank(1000)} style={{ ...casGhost(), color: CAS.gold, border: `1px solid ${CAS.goldLine}` }}>
              Felted — restake $1,000 practice chips
            </button>
          )}
          <div style={{ fontSize: 10.5, color: CAS.faint, lineHeight: 1.65, fontFamily: casMono }}>
            Practice chips only. Every wager here gives the house exactly 2/38 ≈ 5.26% —
            the five-number basket (7.89%) is not offered on principle. The math never
            sleeps; the wheel doesn't care.
          </div>
        </div>
      </div>
    </div>
  );
}
