import React, { useReducer, useState, useEffect } from "react";

/* ============================================================
   HOLD'EM TABLE (table.html) — the founder-supplied F# Fable/
   Feliz/Elmish component (dark neon casino theme), kept 1:1 in
   its Elmish shape and semantics:
     - initModel() -> the initial Model
     - update      -> a pure (model, msg) => model reducer
   The VIEW is redesigned mobile-first: seats anchored around
   the rail, board + pot owning the center, the user's seat and
   hole cards docked at the bottom, a styled raise slider. It is
   still a TABLE UI MOCK: fold / call / raise mutate the model,
   but there is no dealing, betting rounds, or showdown engine
   yet. Practice chips only — nothing real is wagered.
   ============================================================ */

/* --- DOMAIN (suits reuse the shared engine's s: 0 spade, 1 heart, 2 diamond, 3 club) --- */

const initModel = () => ({
  pot: 1250.5,
  communityCards: [
    { r: 1, s: 0 },   // A♠
    { r: 13, s: 1 },  // K♥
    { r: 10, s: 2 },  // 10♦
  ],
  userSeatId: 1,
  raiseSliderVal: 100,
  minRaise: 50,
  maxRaise: 2500,
  players: [
    { id: 1, name: "You", balance: 2450, currentBet: 50, cards: [{ r: 13, s: 0 }, { r: 12, s: 1 }], isTurn: true, status: "Active" },
    { id: 2, name: "CryptoWhale", balance: 8120, currentBet: 50, cards: [], isTurn: false, status: "Active" },
    { id: 3, name: "Satoshi_99", balance: 410, currentBet: 0, cards: [], isTurn: false, status: "Folded" },
    { id: 4, name: "Degenerate", balance: 1200, currentBet: 50, cards: [], isTurn: false, status: "Active" },
  ],
});

/* --- UPDATE LOOP (the Elmish update function, verbatim semantics) --- */
function update(model, msg) {
  const onUser = (fn) => model.players.map((p) => (p.id === model.userSeatId ? fn(p) : p));
  switch (msg.type) {
    case "FoldAction":
      return { ...model, players: onUser((p) => ({ ...p, status: "Folded", isTurn: false })) };
    case "CallAction":
      return { ...model, players: onUser((p) => ({ ...p, balance: p.balance - p.currentBet, isTurn: false })), pot: model.pot + 50 };
    case "RaiseAction":
      return { ...model, players: onUser((p) => ({ ...p, balance: p.balance - msg.amount, currentBet: msg.amount, isTurn: false })), pot: model.pot + msg.amount };
    case "UpdateRaiseVal":
      return { ...model, raiseSliderVal: msg.value };
    default:
      return model;
  }
}

const money = (v) => `$${v.toFixed(2)}`;
const chips = (v) => (Number.isInteger(v) ? `$${v.toLocaleString()}` : money(v));
const clampN = (lo, v, hi) => Math.max(lo, Math.min(v, hi));

/* Card sizes are computed from the live viewport width (numbers, not CSS clamp(),
   because TableCard derives its height and type scale from the width). */
function useViewportWidth() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 400);
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return w;
}

/* --- palette (as supplied) --- */
const N = {
  bg: "#0b0e11", panel: "#14171d", panelHi: "#1f2937", card: "#1a1d24",
  line: "#222630", line2: "#2c303c", felt: "#0f2018", feltHi: "#16301f", rail: "#1e2c24",
  green: "#00e676", red: "#ff4d4d", redSoft: "#ff5252", amber: "#ffb74d",
  text: "#ffffff", dim: "#8b93a3", faint: "#5b6272",
};
const sans = "Inter, 'Albert Sans', system-ui, -apple-system, sans-serif";

/* --- a board / hole card, dark neon face --- */
function TableCard({ card, w }) {
  const red = isRed(card.s);
  const col = red ? N.red : "#e8ebf2";
  return (
    <div style={{
      width: w, height: Math.round(w * 1.42), borderRadius: Math.max(8, w * 0.14),
      background: `linear-gradient(160deg, #21252e, ${N.card} 60%)`,
      border: `1px solid ${N.line2}`, boxShadow: "0 6px 14px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)",
      position: "relative", color: col, flex: "0 0 auto",
    }}>
      <div style={{ position: "absolute", top: w * 0.1, left: w * 0.14, lineHeight: 1, textAlign: "center" }}>
        <div style={{ fontSize: w * 0.34, fontWeight: 800, letterSpacing: "-0.02em" }}>{rankLabel(card.r)}</div>
        <div style={{ fontSize: w * 0.3, marginTop: w * 0.03 }}>{SUIT[card.s]}</div>
      </div>
      <div style={{
        position: "absolute", right: w * 0.1, bottom: w * 0.04, fontSize: w * 0.62,
        opacity: 0.9, lineHeight: 1,
      }}>{SUIT[card.s]}</div>
    </div>
  );
}

/* --- an empty slot where the turn / river will land --- */
function CardSlot({ w }) {
  return (
    <div style={{
      width: w, height: Math.round(w * 1.42), borderRadius: Math.max(8, w * 0.14),
      border: `1.5px dashed rgba(139,147,163,0.25)`, flex: "0 0 auto",
    }} />
  );
}

/* --- tiny face-down cards for live opponents --- */
function MiniBacks() {
  const back = (rot) => (
    <span style={{
      width: 17, height: 24, borderRadius: 4, display: "inline-block",
      background: `repeating-linear-gradient(45deg, #123322, #123322 3px, ${N.rail} 3px, ${N.rail} 6px)`,
      border: "1px solid rgba(0,230,118,0.25)", transform: `rotate(${rot}deg)`,
      boxShadow: "0 2px 5px rgba(0,0,0,0.5)",
    }} />
  );
  return <span style={{ display: "inline-flex", gap: 2, marginTop: 5 }}>{back(-8)}{back(8)}</span>;
}

/* --- the amount a seat has in front of it, floated toward the pot --- */
function BetPill({ amount }) {
  if (!(amount > 0)) return null;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 5, marginTop: 6,
      background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,183,77,0.35)",
      borderRadius: 999, padding: "2.5px 9px",
      fontSize: 11, fontWeight: 700, color: N.amber, whiteSpace: "nowrap",
    }}>
      <span style={{
        width: 9, height: 9, borderRadius: "50%", flex: "0 0 auto",
        background: `radial-gradient(circle at 35% 35%, #ffd54f, ${N.amber} 70%)`,
        boxShadow: "0 0 0 1.5px rgba(0,0,0,0.5) inset",
      }} />
      {chips(amount)}
    </div>
  );
}

/* --- an opponent seat, anchored on the rail --- */
function OppSeat({ player, spot }) {
  const folded = player.status === "Folded";
  return (
    <div style={{
      position: "absolute", left: `${spot.x}%`, top: `${spot.y}%`, transform: "translate(-50%, -50%)",
      display: "flex", flexDirection: "column", alignItems: "center",
      opacity: folded ? 0.45 : 1, zIndex: 3, width: "min(27vw, 122px)",
    }}>
      <div style={{
        width: 46, height: 46, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
        background: player.isTurn ? N.panelHi : "#111318",
        border: `2px solid ${player.isTurn ? N.green : N.line}`,
        boxShadow: player.isTurn ? "0 0 14px rgba(0,230,118,0.45)" : "0 4px 10px rgba(0,0,0,0.5)",
        fontSize: 18, fontWeight: 800, color: player.isTurn ? N.green : N.dim,
      }}>
        {player.name.charAt(0).toUpperCase()}
      </div>
      <div style={{
        marginTop: 5, background: "rgba(13,16,20,0.92)", border: `1px solid ${player.isTurn ? "rgba(0,230,118,0.45)" : N.line}`,
        borderRadius: 9, padding: "4px 9px", textAlign: "center", maxWidth: "100%",
        boxShadow: "0 4px 10px rgba(0,0,0,0.45)",
      }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: N.text, whiteSpace: "nowrap",
          overflow: "hidden", textOverflow: "ellipsis", maxWidth: "min(24vw, 106px)",
        }}>{player.name}</div>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: N.green, whiteSpace: "nowrap" }}>{chips(player.balance)}</div>
      </div>
      {folded
        ? <div style={{ marginTop: 5, fontSize: 9.5, fontWeight: 800, letterSpacing: "0.14em", color: N.dim }}>FOLDED</div>
        : <MiniBacks />}
      <BetPill amount={player.currentBet} />
    </div>
  );
}

/* --- MAIN TABLE VIEW --- */
export default function PokerTable() {
  const [model, dispatch] = useReducer(update, undefined, initModel);
  const you = model.players.find((p) => p.id === model.userSeatId);
  const opps = model.players.filter((p) => p.id !== model.userSeatId);
  const youFolded = you.status === "Folded";
  const youActed = !you.isTurn;

  // Rail anchor points for the opponents, clockwise from the user's left —
  // side seats sit high enough that their plates clear the board row below.
  const OPP_SPOTS = [{ x: 14, y: 26 }, { x: 50, y: 11 }, { x: 86, y: 26 }];

  const vw = useViewportWidth();
  const boardW = clampN(40, Math.round(vw * 0.125), 58);
  const holeW = clampN(56, Math.round(vw * 0.17), 78);

  const actBtn = (extra) => ({
    padding: "14px 10px", borderRadius: 12, fontFamily: sans, fontSize: 14.5, fontWeight: 800,
    letterSpacing: "0.04em", cursor: "pointer", border: "1px solid transparent",
    transition: "filter 120ms ease, transform 120ms ease", width: "100%",
    ...extra,
  });

  return (
    <div style={{
      background: `radial-gradient(130% 70% at 50% -10%, #10151b, ${N.bg} 60%)`,
      minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: sans,
      color: N.text, overflow: "hidden",
    }}>
      <style>{`
        html, body { background: ${N.bg}; }
        button:active { filter: brightness(1.15); transform: translateY(1px); }
        input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 6px;
          border-radius: 999px; background: linear-gradient(90deg, ${N.green} var(--fill, 0%), #2b2f3a var(--fill, 0%));
          outline: none; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none;
          width: 24px; height: 24px; border-radius: 50%; border: none;
          background: radial-gradient(circle at 35% 35%, #7dffb8, ${N.green} 65%);
          box-shadow: 0 0 12px rgba(0,230,118,0.55), 0 2px 6px rgba(0,0,0,0.6); }
        input[type=range]::-moz-range-thumb { width: 24px; height: 24px; border-radius: 50%; border: none;
          background: ${N.green}; box-shadow: 0 0 12px rgba(0,230,118,0.55); }
      `}</style>

      {/* top bar */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "12px 16px 8px", flex: "0 0 auto",
      }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.12em", color: N.dim }}>POKER ROOM #402</span>
          <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.06em", color: N.faint, marginLeft: 8 }}>PRACTICE CHIPS ONLY</span>
        </div>
        <a href="index.html" aria-label="Home" style={{
          color: N.dim, textDecoration: "none", fontSize: 17, lineHeight: 1,
          border: `1px solid ${N.line}`, borderRadius: 9, padding: "6px 10px", background: "rgba(255,255,255,0.02)",
        }}>⌂</a>
      </div>

      {/* the table */}
      <div style={{ flex: "1 1 auto", position: "relative", minHeight: 0 }}>
        {/* felt + rail */}
        <div style={{
          position: "absolute", inset: "6% 5% 4% 5%", borderRadius: "48% / 42%",
          background: `radial-gradient(75% 70% at 50% 32%, ${N.feltHi}, ${N.felt} 75%)`,
          border: `7px solid ${N.rail}`,
          boxShadow: "0 0 60px rgba(0,0,0,0.85), inset 0 0 46px rgba(0,0,0,0.55), inset 0 0 0 2px rgba(0,230,118,0.07)",
        }} />

        {opps.map((p, i) => <OppSeat key={p.id} player={p} spot={OPP_SPOTS[i] || OPP_SPOTS[1]} />)}

        {/* center: pot + board */}
        <div style={{
          position: "absolute", left: "50%", top: "48%", transform: "translate(-50%, -50%)",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 12, zIndex: 2, width: "100%",
        }}>
          <div style={{
            background: "rgba(0,0,0,0.6)", border: "1px solid rgba(0,230,118,0.3)", borderRadius: 999,
            padding: "5px 16px", fontSize: 13.5, fontWeight: 800, color: N.green, letterSpacing: "0.02em",
            boxShadow: "0 0 18px rgba(0,230,118,0.12)",
          }}>
            POT&nbsp;&nbsp;{money(model.pot)}
          </div>
          <div style={{ display: "flex", gap: "clamp(5px, 1.6vw, 9px)", justifyContent: "center" }}>
            {model.communityCards.map((c) => <TableCard key={cardId(c)} card={c} w={boardW} />)}
            <CardSlot w={boardW} />
            <CardSlot w={boardW} />
          </div>
        </div>

        {/* the user's seat, docked bottom-center of the felt */}
        <div style={{
          position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)",
          display: "flex", flexDirection: "column", alignItems: "center", zIndex: 4,
          opacity: youFolded ? 0.45 : 1,
        }}>
          {!youFolded && (
            <div style={{ display: "flex", marginBottom: -10 }}>
              {you.cards.map((c, i) => (
                <div key={cardId(c)} style={{
                  transform: `rotate(${i === 0 ? -6 : 6}deg) translateY(${i === 0 ? 2 : 0}px)`,
                  marginLeft: i === 0 ? 0 : -Math.round(holeW * 0.24), zIndex: i,
                }}>
                  <TableCard card={c} w={holeW} />
                </div>
              ))}
            </div>
          )}
          <div style={{
            display: "flex", alignItems: "center", gap: 12, position: "relative", zIndex: 6,
            background: youActed && !youFolded ? "rgba(13,16,20,0.97)" : "rgba(16,24,20,0.97)",
            border: `2px solid ${you.isTurn ? N.green : N.line}`,
            boxShadow: you.isTurn ? "0 0 18px rgba(0,230,118,0.4)" : "0 6px 16px rgba(0,0,0,0.55)",
            borderRadius: 14, padding: "8px 16px",
          }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800 }}>{you.name}{youFolded ? " · FOLDED" : ""}</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: N.green }}>{chips(you.balance)}</div>
            </div>
            <BetPill amount={you.currentBet} />
          </div>
        </div>
      </div>

      {/* action panel */}
      <div style={{
        flex: "0 0 auto", background: `linear-gradient(180deg, ${N.panel}, #101318)`,
        borderTop: `1px solid ${N.line}`, padding: "14px 16px calc(14px + env(safe-area-inset-bottom, 0px))",
        display: "flex", flexDirection: "column", gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: N.dim, flex: "0 0 auto" }}>{chips(model.minRaise)}</span>
          <input
            type="range" aria-label="Raise amount"
            min={model.minRaise} max={model.maxRaise} value={model.raiseSliderVal}
            style={{ "--fill": `${((model.raiseSliderVal - model.minRaise) / (model.maxRaise - model.minRaise)) * 100}%`, flex: 1 }}
            onChange={(e) => dispatch({ type: "UpdateRaiseVal", value: Number(e.target.value) })}
          />
          <span style={{ fontSize: 11, fontWeight: 700, color: N.dim, flex: "0 0 auto" }}>{chips(model.maxRaise)}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.5fr", gap: 10 }}>
          <button onClick={() => dispatch({ type: "FoldAction" })} style={actBtn({
            background: "#232733", color: N.redSoft, border: `1px solid rgba(255,82,82,0.25)`,
          })}>FOLD</button>
          <button onClick={() => dispatch({ type: "CallAction" })} style={actBtn({
            background: "#232733", color: N.text, border: `1px solid ${N.line2}`,
          })}>CALL $50</button>
          <button onClick={() => dispatch({ type: "RaiseAction", amount: model.raiseSliderVal })} style={actBtn({
            background: `linear-gradient(180deg, #2aff8f, ${N.green} 55%, #00b25a)`, color: "#00230f",
            boxShadow: "0 4px 16px rgba(0,230,118,0.35)",
          })}>RAISE {chips(model.raiseSliderVal)}</button>
        </div>
      </div>
    </div>
  );
}
