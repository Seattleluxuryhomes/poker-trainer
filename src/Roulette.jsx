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

const R = {
  bg: "#0b0e11", panel: "#14171d", line: "#222630", line2: "#2c303c",
  felt: "#0f2018", green: "#00e676", gold: "#ffd54f", dim: "#8b93a3", faint: "#5b6272",
  red: "#c0392b", redHi: "#e74c3c", black: "#1a1d24", zero: "#127a4a", text: "#fff",
};
const rSans = "Inter, 'Albert Sans', system-ui, sans-serif";

const ROU_BANK_KEY = "poker-trainer:rouletteBank";
function loadRouBank() {
  try {
    const raw = window.localStorage.getItem(ROU_BANK_KEY);
    if (raw == null) return 1000;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? v : 1000;
  } catch { return 1000; }
}

const CHIPS = [1, 5, 25, 100];
const chipColor = (v) => (v === 1 ? "#e8ebf2" : v === 5 ? "#e74c3c" : v === 25 ? "#27ae60" : "#2c3e50");

function Wheel({ spinningTo, size }) {
  // Segments rendered once; the whole disc rotates so `spinningTo` lands under the top pointer.
  const seg = 360 / 38;
  const targetIdx = spinningTo == null ? 0 : WHEEL_ORDER.indexOf(spinningTo);
  const turns = useRef(0);
  if (spinningTo != null) turns.current += 5; // fresh momentum each spin
  const angle = -(targetIdx * seg) - 360 * turns.current;
  const radius = size / 2;
  const labelR = radius * 0.82;
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "0 0 auto" }}>
      <div style={{
        position: "absolute", top: -4, left: "50%", transform: "translateX(-50%)", zIndex: 2,
        width: 0, height: 0, borderLeft: "8px solid transparent", borderRight: "8px solid transparent",
        borderTop: `14px solid ${R.gold}`, filter: "drop-shadow(0 2px 3px rgba(0,0,0,0.6))",
      }} />
      <svg viewBox="-100 -100 200 200" style={{
        width: "100%", height: "100%", transform: `rotate(${angle}deg)`,
        transition: spinningTo != null ? "transform 3.4s cubic-bezier(0.15, 0.9, 0.25, 1)" : "none",
      }}>
        {WHEEL_ORDER.map((p, i) => {
          const a0 = ((i - 0.5) * seg - 90) * (Math.PI / 180);
          const a1 = ((i + 0.5) * seg - 90) * (Math.PI / 180);
          const color = pocketColor(p);
          const fill = color === "green" ? R.zero : color === "red" ? R.red : "#15181f";
          return (
            <path key={p} d={`M0,0 L${Math.cos(a0) * 98},${Math.sin(a0) * 98} A98,98 0 0,1 ${Math.cos(a1) * 98},${Math.sin(a1) * 98} Z`}
              fill={fill} stroke="#0b0e11" strokeWidth="0.6" />
          );
        })}
        {/* labels drawn upright along the rim */}
        {WHEEL_ORDER.map((p, i) => {
          const la = (i * seg - 90) * (Math.PI / 180);
          return (
            <text key={`t${p}`} x={Math.cos(la) * labelR} y={Math.sin(la) * labelR}
              fontSize="7.5" fill="#e8ebf2" fontWeight="700" textAnchor="middle" dominantBaseline="middle"
              transform={`rotate(${i * seg + 90} ${Math.cos(la) * labelR} ${Math.sin(la) * labelR})`}
              style={{ fontFamily: rSans }}>{p}</text>
          );
        })}
        <circle r="58" fill="#101318" stroke={R.line2} strokeWidth="1.5" />
      </svg>
    </div>
  );
}

export default function Roulette() {
  const [bank, setBank] = useState(loadRouBank);
  const [chip, setChip] = useState(5);
  const [bets, setBets] = useState({});
  const [lastBets, setLastBets] = useState(null);
  const [phase, setPhase] = useState("bet"); // bet | spinning | done
  const [result, setResult] = useState(null);
  const [won, setWon] = useState(0);
  const [history, setHistory] = useState([]);
  const [info, setInfo] = useState(null); // betId whose math is shown

  useEffect(() => { try { window.localStorage.setItem(ROU_BANK_KEY, String(bank)); } catch { /* private */ } }, [bank]);

  const staked = Object.values(bets).reduce((a, b) => a + b, 0);

  const addBet = (id) => {
    if (phase === "spinning") return;
    if (phase === "done") { setPhase("bet"); setResult(null); }
    if (chip > bank) return;
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
    setPhase("spinning");
    setTimeout(() => {
      const back = settleSpin(bets, pocket);
      setBank((b) => b + back);
      setWon(back - staked);
      setLastBets(bets);
      setBets({});
      setHistory((h) => [pocket, ...h].slice(0, 14));
      setPhase("done");
    }, 3500);
  };

  const spot = (id, label, style = {}) => {
    const amt = bets[id] || 0;
    const color = id === "red" ? R.redHi : id === "black" ? "#2c303c" : undefined;
    return (
      <button key={id} onClick={() => addBet(id)} title="click to bet; ⓘ shows the true odds" style={{
        position: "relative", padding: "10px 4px", borderRadius: 7, cursor: "pointer",
        border: `1px solid ${amt ? R.gold : R.line2}`, background: color || "rgba(255,255,255,0.04)",
        color: "#e8ebf2", fontFamily: rSans, fontSize: 12, fontWeight: 800, minWidth: 0, ...style,
      }}>
        {label}
        {amt > 0 && (
          <span style={{
            position: "absolute", top: -8, right: -6, minWidth: 22, height: 22, borderRadius: "50%",
            background: chipColor(chip), color: "#14171d", fontSize: 10, fontWeight: 900,
            display: "flex", alignItems: "center", justifyContent: "center", padding: "0 3px",
            border: "2px dashed rgba(0,0,0,0.35)", boxShadow: "0 2px 5px rgba(0,0,0,0.5)",
          }}>{amt}</span>
        )}
      </button>
    );
  };

  const numCell = (n) => {
    const p = String(n);
    return spot(`n:${p}`, p, {
      background: pocketColor(p) === "red" ? R.red : "#15181f",
      padding: "8px 0", fontSize: 12,
    });
  };

  const m = info ? betMath(info) : null;
  const infoLabel = info ? (info.startsWith("n:") ? `Straight ${info.slice(2)}` : { red: "Red", black: "Black", odd: "Odd", even: "Even", low: "1–18", high: "19–36", dozen1: "1st dozen", dozen2: "2nd dozen", dozen3: "3rd dozen", col1: "Column 1", col2: "Column 2", col3: "Column 3" }[info]) : null;

  return (
    <div style={{ background: `radial-gradient(130% 70% at 50% -10%, #10151b, ${R.bg} 60%)`, minHeight: "100vh", fontFamily: rSans, color: "#e8ebf2", display: "flex", flexDirection: "column" }}>
      <style>{`html,body{background:${R.bg}} button:active{filter:brightness(1.15)} button:disabled{opacity:.4;cursor:default}`}</style>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", flexWrap: "wrap", gap: 8 }}>
        <div>
          <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: "0.12em", color: R.dim }}>ROULETTE · AMERICAN 00</span>
          <span style={{ fontSize: 10, fontWeight: 600, color: R.faint, marginLeft: 8 }}>PRACTICE CHIPS ONLY · EVERY EDGE PRINTED</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <AccountArea dark />
          <a href="index.html" aria-label="Home" style={{ color: R.dim, textDecoration: "none", fontSize: 16, border: `1px solid ${R.line}`, borderRadius: 9, padding: "5px 9px" }}>⌂</a>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 18, justifyContent: "center", alignItems: "flex-start", padding: "6px 14px 20px", maxWidth: 1040, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        {/* wheel + result + history */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <Wheel spinningTo={phase === "spinning" || phase === "done" ? result : null} size={Math.min(300, typeof window !== "undefined" ? window.innerWidth - 60 : 300)} />
          <div style={{ minHeight: 44, textAlign: "center" }}>
            {phase === "done" && result != null && (
              <>
                <span style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: "50%",
                  background: pocketColor(result) === "green" ? R.zero : pocketColor(result) === "red" ? R.red : "#15181f",
                  border: `2px solid ${R.gold}`, fontWeight: 900, fontSize: 16,
                }}>{result}</span>
                <span style={{ marginLeft: 10, fontWeight: 800, color: won > 0 ? R.green : won < 0 ? "#ff5252" : R.dim }}>
                  {won > 0 ? `+$${won.toLocaleString()}` : won < 0 ? `−$${(-won).toLocaleString()}` : "push"}
                </span>
              </>
            )}
            {phase === "spinning" && <span style={{ fontWeight: 800, color: R.gold, letterSpacing: "0.1em" }}>NO MORE BETS…</span>}
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "center", maxWidth: 300 }}>
            {history.map((p, i) => (
              <span key={i} style={{
                width: 24, height: 24, borderRadius: "50%", fontSize: 10.5, fontWeight: 800,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: pocketColor(p) === "green" ? R.zero : pocketColor(p) === "red" ? R.red : "#15181f",
                border: `1px solid ${R.line2}`, opacity: 1 - i * 0.05,
              }}>{p}</span>
            ))}
          </div>
        </div>

        {/* board + controls */}
        <div style={{ flex: "1 1 340px", maxWidth: 460, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
            {spot("n:0", "0", { background: R.zero })}
            {spot("n:00", "00", { background: R.zero })}
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
            {spot("dozen1", "1st 12 · 2:1")}{spot("dozen2", "2nd 12 · 2:1")}{spot("dozen3", "3rd 12 · 2:1")}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 5 }}>
            {spot("low", "1–18")}{spot("even", "EVEN")}{spot("red", "RED")}{spot("black", "BLACK")}{spot("odd", "ODD")}{spot("high", "19–36")}
          </div>

          {m && (
            <div style={{ background: "rgba(0,0,0,0.35)", border: `1px solid ${R.line}`, borderRadius: 9, padding: "8px 12px", fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace", color: R.dim }}>
              <b style={{ color: "#e8ebf2" }}>{infoLabel}</b> · covers {m.ways}/38 pockets = {(m.p * 100).toFixed(2)}% · pays {m.payout}:1 ·
              house edge <b style={{ color: R.gold }}>{(-m.evPerUnit * 100).toFixed(2)}%</b> (enumerated, not estimated)
            </div>
          )}

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: R.dim }}>CHIP</span>
            {CHIPS.map((v) => (
              <button key={v} onClick={() => setChip(v)} style={{
                width: 40, height: 40, borderRadius: "50%", cursor: "pointer", fontWeight: 900, fontSize: 12,
                background: chipColor(v), color: v === 1 ? "#14171d" : "#fff",
                border: chip === v ? `3px solid ${R.gold}` : "3px dashed rgba(0,0,0,0.35)",
              }}>{v}</button>
            ))}
            <span style={{ marginLeft: "auto", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13, fontWeight: 800, color: R.green }}>
              ${bank.toLocaleString()}
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
            <button onClick={spin} disabled={phase === "spinning" || staked === 0} style={{
              padding: "13px 8px", borderRadius: 11, cursor: "pointer", fontWeight: 900, fontSize: 14, letterSpacing: "0.05em",
              background: `linear-gradient(180deg, #2aff8f, ${R.green} 55%, #00b25a)`, color: "#00230f", border: "none",
              boxShadow: "0 4px 16px rgba(0,230,118,0.35)",
            }}>SPIN{staked > 0 ? ` · $${staked.toLocaleString()} on the felt` : ""}</button>
            <button onClick={clearBets} disabled={phase === "spinning" || staked === 0} style={{ padding: "13px 6px", borderRadius: 11, cursor: "pointer", fontWeight: 800, fontSize: 12, background: "#232733", color: "#e8ebf2", border: `1px solid ${R.line2}` }}>CLEAR</button>
            <button onClick={rebet} disabled={phase === "spinning" || !lastBets} style={{ padding: "13px 6px", borderRadius: 11, cursor: "pointer", fontWeight: 800, fontSize: 12, background: "#232733", color: "#e8ebf2", border: `1px solid ${R.line2}` }}>REBET</button>
          </div>
          {bank === 0 && staked === 0 && (
            <button onClick={() => setBank(1000)} style={{ padding: "10px", borderRadius: 10, cursor: "pointer", fontWeight: 800, fontSize: 12, background: "rgba(255,213,79,0.12)", color: R.gold, border: "1px solid rgba(255,213,79,0.4)" }}>
              Felted — restake $1,000 practice chips
            </button>
          )}
          <div style={{ fontSize: 10.5, color: R.faint, lineHeight: 1.6, fontFamily: "ui-monospace, Menlo, monospace" }}>
            Practice chips only. Tap a bet to see its enumerated truth: every wager here
            gives the house exactly 2/38 ≈ 5.26%. The five-number basket (7.89%) is not
            offered on principle. The math never sleeps; the wheel doesn't care.
          </div>
        </div>
      </div>
    </div>
  );
}
