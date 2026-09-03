import React, { useState, useEffect, useRef } from "react";

/* The game rules live in src/holdem.js (shared verbatim with the multiplayer
 * server). This file is the VIEW: solo mode runs the core locally; room mode
 * (?room=CODE) renders the server's redacted state and posts actions. */

/* ============================================================
   HOLD'EM TABLE (table.html) — a real four-max no-limit game.
   Every hand deals from a freshly shuffled 52-card deck: blinds,
   hole cards, four betting streets, all-ins with proper layered
   side pots, and a genuine best-5-of-7 showdown. The three bot
   seats decide by MONTE CARLO EQUITY SIMULATION (rollouts of the
   unseen deck) weighed against pot odds — simulation, never
   strategy charts, per the project philosophy. The featured
   opponent, "Ace Meridian", is a FICTIONAL world #1 — an original
   character, deliberately not modeled on or named after any real
   player. Practice chips only — nothing real is wagered.
   The game core below is pure functions over plain state, so
   engine/verify_table.js can eval this compiled page and re-prove
   deck integrity, chip conservation, betting legality, side-pot
   math, and evaluator tiebreaks.
   ============================================================ */

const money = (v) => `$${v.toLocaleString()}`;

/* ==================== VIEW ==================== */

const N = {
  bg: "#0b0e11", panel: "#14171d", panelHi: "#1f2937", card: "#1a1d24",
  line: "#222630", line2: "#2c303c", felt: "#0f2018", feltHi: "#16301f", rail: "#1e2c24",
  green: "#00e676", red: "#ff4d4d", redSoft: "#ff5252", amber: "#ffb74d", gold: "#ffd54f",
  text: "#ffffff", dim: "#8b93a3", faint: "#5b6272",
};
const sans = "Inter, 'Albert Sans', system-ui, -apple-system, sans-serif";

const clampN = (lo, v, hi) => Math.max(lo, Math.min(v, hi));
function useViewportWidth() {
  const [w, setW] = useState(typeof window !== "undefined" ? window.innerWidth : 400);
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return w;
}

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
      <div style={{ position: "absolute", right: w * 0.1, bottom: w * 0.04, fontSize: w * 0.62, opacity: 0.9, lineHeight: 1 }}>{SUIT[card.s]}</div>
    </div>
  );
}

function CardBack({ w }) {
  return (
    <div style={{
      width: w, height: Math.round(w * 1.42), borderRadius: Math.max(6, w * 0.14), flex: "0 0 auto",
      background: `repeating-linear-gradient(45deg, #123322, #123322 ${w * 0.09}px, ${N.rail} ${w * 0.09}px, ${N.rail} ${w * 0.18}px)`,
      border: "1px solid rgba(0,230,118,0.25)", boxShadow: "0 3px 8px rgba(0,0,0,0.5)",
    }} />
  );
}

function CardSlot({ w }) {
  return <div style={{ width: w, height: Math.round(w * 1.42), borderRadius: Math.max(8, w * 0.14), border: "1.5px dashed rgba(139,147,163,0.25)", flex: "0 0 auto" }} />;
}

function BetPill({ amount }) {
  if (!(amount > 0)) return null;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 5, marginTop: 5,
      background: "rgba(0,0,0,0.55)", border: "1px solid rgba(255,183,77,0.35)",
      borderRadius: 999, padding: "2.5px 9px", fontSize: 11, fontWeight: 700, color: N.amber, whiteSpace: "nowrap",
    }}>
      <span style={{ width: 9, height: 9, borderRadius: "50%", flex: "0 0 auto", background: `radial-gradient(circle at 35% 35%, #ffd54f, ${N.amber} 70%)`, boxShadow: "0 0 0 1.5px rgba(0,0,0,0.5) inset" }} />
      {money(amount)}
    </div>
  );
}

/* Actions read at a glance: raises shout, folds mutter. */
function actStyle(lastAct) {
  if (!lastAct) return null;
  if (/^(raises|bets|all-in)/.test(lastAct)) return { color: "#0d2417", background: N.green, border: "1px solid transparent" };
  if (/^folds/.test(lastAct)) return { color: N.redSoft, background: "rgba(255,82,82,0.12)", border: "1px solid rgba(255,82,82,0.35)" };
  if (/^calls/.test(lastAct)) return { color: "#e8ebf2", background: "rgba(255,255,255,0.1)", border: `1px solid ${N.line2}` };
  if (/blind/.test(lastAct)) return { color: N.amber, background: "rgba(255,183,77,0.12)", border: "1px solid rgba(255,183,77,0.3)" };
  return { color: N.dim, background: "rgba(255,255,255,0.05)", border: `1px solid ${N.line}` }; // checks
}
function ActBadge({ lastAct }) {
  const st = actStyle(lastAct);
  if (!st) return null;
  return (
    <span style={{ marginTop: 3, fontFamily: sans, fontSize: 10, fontWeight: 800, letterSpacing: "0.03em", borderRadius: 999, padding: "1.5px 8px", whiteSpace: "nowrap", ...st }}>
      {lastAct.toUpperCase()}
    </span>
  );
}

/* The hand feed: last lines always visible, tap for the full broadcast log. */
function ActionTicker({ log }) {
  const [open, setOpen] = React.useState(false);
  const endRef = React.useRef(null);
  React.useEffect(() => { if (open && endRef.current) endRef.current.scrollIntoView({ block: "end" }); }, [open, log && log.length]);
  if (!log || !log.length) return null;
  return (
    <>
      <button onClick={() => setOpen(true)} title="Full hand log" style={{
        width: "100%", textAlign: "left", background: "rgba(0,0,0,0.35)", border: `1px solid ${N.line}`,
        borderRadius: 9, padding: "6px 10px", cursor: "pointer", fontFamily: "ui-monospace, Menlo, monospace",
        fontSize: 11, lineHeight: 1.5, color: N.dim, overflow: "hidden",
      }}>
        {log.slice(-2).map((l, i) => (
          <div key={i} style={{ whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden", color: i === log.slice(-2).length - 1 ? "#c9cfda" : N.faint }}>{l}</div>
        ))}
      </button>
      {open && (
        <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 280, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: N.panel, border: `1px solid ${N.line2}`, borderRadius: 14, width: "100%", maxWidth: 420, maxHeight: "70vh", display: "flex", flexDirection: "column", boxShadow: "0 18px 60px rgba(0,0,0,0.7)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 14px", borderBottom: `1px solid ${N.line}` }}>
              <span style={{ fontFamily: sans, fontSize: 13, fontWeight: 800, color: "#e8ebf2" }}>HAND LOG</span>
              <button onClick={() => setOpen(false)} style={{ background: "#232733", color: "#e8ebf2", border: "none", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontWeight: 800, fontSize: 12 }}>CLOSE</button>
            </div>
            <div style={{ overflowY: "auto", padding: "10px 14px", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, lineHeight: 1.7 }}>
              {log.map((l, i) => (
                <div key={i} style={{ color: l.startsWith("—") ? N.gold : "#c9cfda" }}>{l}</div>
              ))}
              <div ref={endRef} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function EquityBadge({ pct, lead }) {
  return (
    <div style={{
      marginTop: 4, fontFamily: sans, fontSize: 13, fontWeight: 900, letterSpacing: "0.02em",
      borderRadius: 999, padding: "2px 11px",
      background: lead ? N.gold : "rgba(0,0,0,0.7)", color: lead ? "#14171d" : "#e8ebf2",
      border: `1px solid ${lead ? N.gold : N.line2}`,
      boxShadow: lead ? "0 0 14px rgba(255,213,79,0.5)" : "none", transition: "all 300ms ease",
    }}>
      {(pct * 100).toFixed(pct > 0 && pct < 0.005 ? 1 : 0)}%
    </div>
  );
}

function OppSeat({ player, seat, spot, state, cardW, equity, lead }) {
  const isTurn = state.toAct === seat && state.phase === "betting";
  const isWinner = state.winners.includes(seat);
  const showCards = state.revealed && !player.folded;
  const border = isWinner ? N.gold : isTurn ? N.green : N.line;
  return (
    <div style={{
      position: "absolute", left: `${spot.x}%`, top: `${spot.y}%`, transform: "translate(-50%, -50%)",
      display: "flex", flexDirection: "column", alignItems: "center",
      opacity: player.folded && state.phase === "betting" ? 0.45 : 1, zIndex: 3, width: "min(30vw, 132px)",
    }}>
      {state.quip && state.quip.seat === seat && (
        <div style={{
          position: "absolute", bottom: "100%", marginBottom: 6, width: "max-content", maxWidth: "62vw",
          background: "#e8ebf2", color: "#14171d", fontSize: 11.5, fontWeight: 600, lineHeight: 1.35,
          borderRadius: 10, padding: "6px 10px", zIndex: 8, boxShadow: "0 6px 16px rgba(0,0,0,0.5)",
        }}>
          “{state.quip.text}”
        </div>
      )}
      <div style={{
        width: 44, height: 44, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
        background: isTurn ? N.panelHi : "#111318", border: `2px solid ${border}`,
        boxShadow: isTurn ? "0 0 14px rgba(0,230,118,0.45)" : isWinner ? "0 0 14px rgba(255,213,79,0.45)" : "0 4px 10px rgba(0,0,0,0.5)",
        fontSize: 17, fontWeight: 800, color: isTurn ? N.green : isWinner ? N.gold : N.dim,
      }}>
        {player.name.charAt(0)}
      </div>
      <div style={{
        marginTop: 4, background: "rgba(13,16,20,0.92)", border: `1px solid ${isWinner ? "rgba(255,213,79,0.5)" : isTurn ? "rgba(0,230,118,0.45)" : N.line}`,
        borderRadius: 9, padding: "3px 8px", textAlign: "center", maxWidth: "100%", boxShadow: "0 4px 10px rgba(0,0,0,0.45)",
      }}>
        <div style={{ fontSize: 11.5, fontWeight: 700, color: N.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "min(27vw, 118px)" }}>{player.name}</div>
        {player.tag && <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: "0.12em", color: seat === 1 ? N.gold : N.dim }}>{player.tag.toUpperCase()}</div>}
        <div style={{ fontSize: 11, fontWeight: 700, color: N.green, whiteSpace: "nowrap" }}>{money(player.stack)}</div>
      </div>
      <div style={{ marginTop: 4, display: "flex", gap: 3, minHeight: Math.round(cardW * 1.42) * 0.62 }}>
        {state.handNo === 0 ? null : player.folded ? (
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.14em", color: N.dim, alignSelf: "center" }}>FOLDED</span>
        ) : showCards ? (
          player.hole.map((c) => <TableCard key={cardId(c)} card={c} w={Math.round(cardW * 0.62)} />)
        ) : (
          <>
            <CardBack w={Math.round(cardW * 0.55)} />
            <CardBack w={Math.round(cardW * 0.55)} />
          </>
        )}
      </div>
      {equity != null && <EquityBadge pct={equity} lead={lead} />}
      {player.lastAct && <ActBadge lastAct={player.lastAct} />}
      <BetPill amount={player.streetBet} />
    </div>
  );
}

const STACK_KEY = "poker-trainer:tableStack";
function loadStack() {
  try {
    const raw = window.localStorage.getItem(STACK_KEY);
    if (raw == null) return START_STACK;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? v : START_STACK;
  } catch { return START_STACK; }
}

function SoloTable() {
  const [state, setState] = useState(() => makeTable(loadStack()));
  const [raiseTo, setRaiseTo] = useState(BIG_BLIND * 3);
  const [friendsOpen, setFriendsOpen] = useState(false);
  const rngRef = useRef(mulberry32((Math.random() * 2 ** 31) | 0));

  const you = state.players[USER_SEAT];
  const userTurn = state.phase === "betting" && state.toAct === USER_SEAT;
  const la = userTurn ? legalActions(state) : null;

  useEffect(() => {
    try { window.localStorage.setItem(STACK_KEY, String(you.stack)); } catch { /* private mode */ }
  }, [you.stack]);

  // Bots act on a human-feeling delay; the champion "thinks" a touch longer.
  useEffect(() => {
    if (state.phase !== "betting" || state.toAct < 0 || state.players[state.toAct].isUser) return;
    const wait = state.toAct === 1 ? 1000 : 650;
    const t = setTimeout(() => {
      setState((s) => {
        if (s.phase !== "betting" || s.toAct < 0 || s.players[s.toAct].isUser) return s;
        return applyAction(s, botDecide(s, rngRef.current));
      });
    }, wait);
    return () => clearTimeout(t);
  }, [state]);

  useEffect(() => {
    if (userTurn && la) setRaiseTo(clampN(la.minRaiseTo, state.pot, la.maxRaiseTo));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userTurn]);

  // The broadcast: one street every ~1.4s while phase is "runout"; tap to skip.
  useEffect(() => {
    if (state.phase !== "runout") return;
    const t = setTimeout(() => setState((s) => (s.phase === "runout" ? runoutStep(s) : s)), 1400);
    return () => clearTimeout(t);
  }, [state]);
  const skipRunout = () => setState((s) => { let x = s, g = 0; while (x.phase === "runout" && g++ < 6) x = runoutStep(x); return x; });

  // Desktop keyboard: F fold · C/Space check-call · R raise · ↑↓ size the raise · Enter next hand.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== "range") return;
      const k = e.key.toLowerCase();
      if (state.phase === "betting" && state.toAct === USER_SEAT) {
        const l = legalActions(state);
        if (k === "f") { e.preventDefault(); userAct({ type: "fold" }); }
        else if (k === "c" || k === " ") { e.preventDefault(); userAct({ type: "call" }); }
        else if (k === "r" && l.canRaise) { e.preventDefault(); userAct({ type: "raise", to: clampN(l.minRaiseTo, raiseTo, l.maxRaiseTo) }); }
        else if (e.key === "ArrowUp" && l.canRaise) { e.preventDefault(); setRaiseTo((v) => clampN(l.minRaiseTo, v + BIG_BLIND * 2, l.maxRaiseTo)); }
        else if (e.key === "ArrowDown" && l.canRaise) { e.preventDefault(); setRaiseTo((v) => clampN(l.minRaiseTo, v - BIG_BLIND * 2, l.maxRaiseTo)); }
      } else if ((state.phase === "over" || state.phase === "idle") && (e.key === "Enter" || k === "n")) {
        e.preventDefault(); deal();
      } else if (state.phase === "runout" && (e.key === "Enter" || k === " ")) {
        e.preventDefault(); skipRunout();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Live win % for every seat still in the hand (only during the broadcast).
  const equities = React.useMemo(() => {
    if (state.phase !== "runout") return null;
    const liveSeats = state.players.map((_, i) => i).filter((i) => inHand(state.players[i]));
    const pcts = equityMulti(liveSeats.map((i) => state.players[i].hole), state.board, rngRef.current);
    const out = {};
    liveSeats.forEach((i, k) => { out[i] = pcts[k]; });
    return out;
  }, [state]);
  const leadSeat = equities ? Number(Object.keys(equities).reduce((a, b) => (equities[a] >= equities[b] ? a : b))) : -1;

  // Report the finished hand to the account layer, once per hand.
  const reportedHand = useRef(0);
  useEffect(() => {
    if (state.phase !== "over" || state.handNo === 0 || reportedHand.current === state.handNo) return;
    reportedHand.current = state.handNo;
    const won = state.winners.includes(USER_SEAT);
    if (won) sfx.win(state.pot >= 1000);
    reportStats({
      set: { table_stack: state.players[USER_SEAT].stack },
      inc: { table_hands: 1, table_wins: won ? 1 : 0 },
      maxOf: won ? { biggest_pot: state.pot } : {},
    });
  }, [state]);

  // Only from idle/over: dealing mid-runout would vaporize a live pot.
  const deal = () => setState((s) => (s.phase === "betting" || s.phase === "runout" ? s : startHand(s, rngRef.current)));

  // Foley: cards on the deal and each street; the chord when you drag the pot.
  const sndHand = useRef(0);
  const sndBoard = useRef(0);
  useEffect(() => {
    if (state.handNo !== sndHand.current) { sndHand.current = state.handNo; sndBoard.current = 0; if (state.handNo > 0) sfx.cards(2); }
    if (state.board.length > sndBoard.current) { sfx.cards(state.board.length - sndBoard.current); sndBoard.current = state.board.length; }
  }, [state]);
  const userAct = (action) => {
    if (action.type === "raise") sfx.chips(3);
    else if (action.type === "fold") sfx.click();
    else { const l = state.phase === "betting" && state.toAct === USER_SEAT ? legalActions(state) : null; l && l.toCall > 0 ? sfx.chip() : sfx.click(); }
    setState((s) => (s.phase === "betting" && s.toAct === USER_SEAT ? applyAction(s, action) : s));
  };

  const OPP_SPOTS = [{ x: 14, y: 24 }, { x: 50, y: 9 }, { x: 86, y: 24 }];
  const vw = useViewportWidth();
  const boardW = clampN(38, Math.round(vw * 0.115), 54);
  const holeW = clampN(54, Math.round(vw * 0.16), 74);
  const streetNames = ["Pre-flop", "Flop", "Turn", "River"];

  const actBtn = (extra) => ({
    padding: "13px 8px", borderRadius: 12, fontFamily: sans, fontSize: 14, fontWeight: 800,
    letterSpacing: "0.04em", cursor: "pointer", border: "1px solid transparent", width: "100%", ...extra,
  });

  return (
    <div style={{
      background: `radial-gradient(130% 70% at 50% -10%, #10151b, ${N.bg} 60%)`,
      minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: sans, color: N.text, overflow: "hidden",
    }}>
      <style>{`
        html, body { background: ${N.bg}; }
        button:active { filter: brightness(1.15); transform: translateY(1px); }
        button:disabled { opacity: 0.4; cursor: default; }
        input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 6px;
          border-radius: 999px; background: linear-gradient(90deg, ${N.green} var(--fill, 0%), #2b2f3a var(--fill, 0%)); outline: none; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none;
          width: 24px; height: 24px; border-radius: 50%; border: none;
          background: radial-gradient(circle at 35% 35%, #7dffb8, ${N.green} 65%);
          box-shadow: 0 0 12px rgba(0,230,118,0.55), 0 2px 6px rgba(0,0,0,0.6); }
        input[type=range]::-moz-range-thumb { width: 24px; height: 24px; border-radius: 50%; border: none;
          background: ${N.green}; box-shadow: 0 0 12px rgba(0,230,118,0.55); }
        @keyframes cardIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
        .boardwrap > * { animation: cardIn 240ms ease both }
        .kbd { display: none }
        @media (min-width: 900px) {
          .kbd { display: inline-block; margin-left: 8px; padding: 0px 6px; border: 1px solid currentColor;
                 border-radius: 5px; font-size: 10px; opacity: 0.55; vertical-align: 1px }
        }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px 6px", flex: "0 0 auto" }}>
        <div>
          <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: "0.12em", color: N.dim }}>vs ACE MERIDIAN · WORLD #1</span>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", color: N.faint, marginLeft: 8 }}>PRACTICE CHIPS ONLY</span>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <SoundToggle dark />
          <button onClick={() => setFriendsOpen(true)} style={{
            height: 30, borderRadius: 9, cursor: "pointer", padding: "0 10px",
            border: "1px solid rgba(0,230,118,0.4)", background: "rgba(0,230,118,0.08)",
            color: N.green, fontFamily: sans, fontSize: 11, fontWeight: 800,
          }}>PLAY WITH FRIENDS</button>
          <AccountArea dark />
          <a href="index.html" aria-label="Home" style={{ color: N.dim, textDecoration: "none", fontSize: 16, lineHeight: 1, border: `1px solid ${N.line}`, borderRadius: 9, padding: "5px 9px", background: "rgba(255,255,255,0.02)" }}>⌂</a>
        </div>
      </div>
      {friendsOpen && <CreateRoomModal onClose={() => setFriendsOpen(false)} />}

      <div style={{ flex: "1 1 auto", position: "relative", minHeight: 0, cursor: state.phase === "runout" ? "pointer" : "default" }}
        onClick={state.phase === "runout" ? skipRunout : undefined}>
       {/* Centered stage capped at desktop width: a laptop gets a real table
           instead of a smeared oval; on phones min() ≈ full width, unchanged. */}
       <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, transform: "translateX(-50%)", width: "min(100vw, 900px)" }}>
        <div style={{
          position: "absolute", inset: "5% 5% 3% 5%", borderRadius: "48% / 42%",
          background: `radial-gradient(75% 70% at 50% 32%, ${N.feltHi}, ${N.felt} 75%)`,
          border: `7px solid ${N.rail}`,
          boxShadow: "0 0 60px rgba(0,0,0,0.85), inset 0 0 46px rgba(0,0,0,0.55), inset 0 0 0 2px rgba(0,230,118,0.07)",
        }} />

        {[1, 2, 3].map((seat, i) => (
          <OppSeat key={seat} player={state.players[seat]} seat={seat} spot={OPP_SPOTS[i]} state={state} cardW={boardW}
            equity={equities ? equities[seat] : null} lead={leadSeat === seat} />
        ))}

        {/* center: street, pot, board */}
        <div style={{
          position: "absolute", left: "50%", top: "47%", transform: "translate(-50%, -50%)",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 9, zIndex: 2, width: "100%",
        }}>
          {state.handNo > 0 && (
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.16em", color: N.faint }}>
              HAND #{state.handNo} · {state.phase === "over" ? "COMPLETE" : streetNames[state.street].toUpperCase()}
            </div>
          )}
          <div style={{
            background: "rgba(0,0,0,0.6)", border: "1px solid rgba(0,230,118,0.3)", borderRadius: 999,
            padding: "4px 15px", fontSize: 13, fontWeight: 800, color: N.green, boxShadow: "0 0 18px rgba(0,230,118,0.12)",
          }}>
            POT&nbsp;&nbsp;{money(state.pot)}
          </div>
          <div className="boardwrap" style={{ display: "flex", gap: "clamp(4px, 1.5vw, 8px)", justifyContent: "center" }}>
            {state.board.map((c) => <TableCard key={cardId(c)} card={c} w={boardW} />)}
            {Array.from({ length: 5 - state.board.length }, (_, i) => <CardSlot key={`s${i}`} w={boardW} />)}
          </div>
          {state.message && (
            <div style={{
              marginTop: 2, background: "rgba(255,213,79,0.12)", border: "1px solid rgba(255,213,79,0.4)",
              borderRadius: 10, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, color: N.gold, textAlign: "center", maxWidth: "88%",
            }}>
              {state.message}
            </div>
          )}
        </div>

        {/* your seat */}
        <div style={{
          position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)",
          display: "flex", flexDirection: "column", alignItems: "center", zIndex: 4,
          opacity: you.folded && state.phase === "betting" ? 0.5 : 1,
        }}>
          {you.hole.length > 0 && !you.folded && (
            <div style={{ display: "flex", marginBottom: -10 }}>
              {you.hole.map((c, i) => (
                <div key={cardId(c)} style={{ transform: `rotate(${i === 0 ? -6 : 6}deg) translateY(${i === 0 ? 2 : 0}px)`, marginLeft: i === 0 ? 0 : -Math.round(holeW * 0.24), zIndex: i }}>
                  <TableCard card={c} w={holeW} />
                </div>
              ))}
            </div>
          )}
          <div style={{
            display: "flex", alignItems: "center", gap: 10, position: "relative", zIndex: 6,
            background: "rgba(13,16,20,0.97)",
            border: `2px solid ${state.winners.includes(USER_SEAT) ? N.gold : userTurn ? N.green : N.line}`,
            boxShadow: userTurn ? "0 0 18px rgba(0,230,118,0.4)" : state.winners.includes(USER_SEAT) ? "0 0 18px rgba(255,213,79,0.4)" : "0 6px 16px rgba(0,0,0,0.55)",
            borderRadius: 13, padding: "7px 14px",
          }}>
            {state.btn === USER_SEAT && state.handNo > 0 && (
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#e8ebf2", color: "#14171d", fontSize: 10, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>D</span>
            )}
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 800 }}>You{you.folded && state.phase === "betting" ? " · FOLDED" : ""}</div>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: N.green }}>{money(you.stack)}</div>
            </div>
            {you.lastAct && <ActBadge lastAct={you.lastAct} />}
            {equities && equities[USER_SEAT] != null && <EquityBadge pct={equities[USER_SEAT]} lead={leadSeat === USER_SEAT} />}
            <BetPill amount={you.streetBet} />
          </div>
        </div>
       </div>
      </div>

      {/* action panel — contents centered and capped so desktop gets buttons,
          not ribbons */}
      <div style={{
        flex: "0 0 auto", background: `linear-gradient(180deg, ${N.panel}, #101318)`,
        borderTop: `1px solid ${N.line}`, padding: "12px 16px calc(12px + env(safe-area-inset-bottom, 0px))",
        display: "flex", flexDirection: "column", gap: 11, alignItems: "center",
      }}>
       <div style={{ width: "100%", maxWidth: 620, display: "flex", flexDirection: "column", gap: 11 }}>
        <ActionTicker log={state && state.log} />
        {state.phase === "betting" ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12, opacity: userTurn && la && la.canRaise ? 1 : 0.35 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: N.dim, flex: "0 0 auto" }}>{la ? money(la.minRaiseTo) : ""}</span>
              <input type="range" aria-label="Raise to" disabled={!userTurn || !la || !la.canRaise}
                min={la ? la.minRaiseTo : 0} max={la ? la.maxRaiseTo : 100} step={25}
                value={la ? clampN(la.minRaiseTo, raiseTo, la.maxRaiseTo) : 0}
                style={{ "--fill": la && la.maxRaiseTo > la.minRaiseTo ? `${((clampN(la.minRaiseTo, raiseTo, la.maxRaiseTo) - la.minRaiseTo) / (la.maxRaiseTo - la.minRaiseTo)) * 100}%` : "100%", flex: 1 }}
                onChange={(e) => setRaiseTo(Number(e.target.value))}
              />
              <span style={{ fontSize: 10.5, fontWeight: 700, color: N.dim, flex: "0 0 auto" }}>{la ? money(la.maxRaiseTo) : ""}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 1.5fr", gap: 9 }}>
              <button disabled={!userTurn} onClick={() => userAct({ type: "fold" })}
                style={actBtn({ background: "#232733", color: N.redSoft, border: "1px solid rgba(255,82,82,0.25)" })}>FOLD<span className="kbd">F</span></button>
              <button disabled={!userTurn} onClick={() => userAct({ type: "call" })}
                style={actBtn({ background: "#232733", color: N.text, border: `1px solid ${N.line2}` })}>
                {userTurn && la ? (la.canCheck ? "CHECK" : `CALL ${money(la.toCall)}`) : "CHECK"}<span className="kbd">C</span>
              </button>
              <button disabled={!userTurn || !la || !la.canRaise} onClick={() => userAct({ type: "raise", to: raiseTo })}
                style={actBtn({ background: `linear-gradient(180deg, #2aff8f, ${N.green} 55%, #00b25a)`, color: "#00230f", boxShadow: "0 4px 16px rgba(0,230,118,0.35)" })}>
                {la && clampN(la.minRaiseTo, raiseTo, la.maxRaiseTo) >= la.maxRaiseTo ? "ALL-IN" : `RAISE TO ${la ? money(clampN(la.minRaiseTo, raiseTo, la.maxRaiseTo)) : ""}`}<span className="kbd">R</span>
              </button>
            </div>
            {!userTurn && (
              <div style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: N.dim }}>
                {state.toAct >= 0 ? `${state.players[state.toAct].name} is thinking…` : "…"}
              </div>
            )}
          </>
        ) : state.phase === "runout" ? (
          <div style={{ textAlign: "center", fontFamily: sans, fontSize: 13, fontWeight: 800, letterSpacing: "0.08em", color: N.gold, padding: "13px 0" }}>
            ALL IN — running it out… <span style={{ color: N.dim, fontWeight: 600, letterSpacing: 0 }}>(tap the table to skip)</span>
          </div>
        ) : (
          <div style={{ display: "flex", gap: 10, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={deal}
              style={{ ...actBtn({ background: `linear-gradient(180deg, #2aff8f, ${N.green} 55%, #00b25a)`, color: "#00230f", boxShadow: "0 4px 16px rgba(0,230,118,0.35)" }), width: "auto", padding: "13px 42px" }}>
              {state.handNo === 0 ? "SIT DOWN & DEAL" : "NEXT HAND"}
            </button>
            {you.stack < BIG_BLIND && state.handNo > 0 && (
              <span style={{ fontSize: 11, color: N.dim, fontWeight: 700 }}>Felted — the next deal stakes you {money(START_STACK)} in practice chips.</span>
            )}
          </div>
        )}
       </div>
      </div>
    </div>
  );
}

/* ==================== MULTIPLAYER: ROOMS ====================
 * ?room=CODE turns this page into a renderer of the server's redacted state
 * (rooms.mjs): the deck and other players' hole cards never reach this
 * browser. Actions are POSTs; state arrives over SSE. The server runs the
 * bots, the turn timers, and the runout broadcast — same engine (src/holdem.js
 * is vm-loaded server-side), one set of rules. */

const roomIdentKey = (code) => `poker-room:${code}`;
const readIdent = (code) => {
  try { return JSON.parse(window.sessionStorage.getItem(roomIdentKey(code))); } catch { return null; }
};
const saveIdent = (code, ident) => {
  try { window.sessionStorage.setItem(roomIdentKey(code), JSON.stringify(ident)); } catch { /* private mode */ }
};

const darkField = {
  width: "100%", boxSizing: "border-box", padding: "11px 12px", borderRadius: 9,
  border: `1px solid ${N.line2}`, background: "#101318", color: "#e8ebf2",
  fontFamily: sans, fontSize: 14, marginBottom: 9, outline: "none",
};
const darkBtn = (primary) => ({
  width: "100%", padding: "12px 10px", borderRadius: 10, cursor: "pointer",
  fontFamily: sans, fontSize: 14, fontWeight: 800, border: "1px solid transparent",
  background: primary ? `linear-gradient(180deg, #2aff8f, ${N.green} 55%, #00b25a)` : "#232733",
  color: primary ? "#00230f" : "#e8ebf2",
});

function RoomCard({ children, title }) {
  return (
    <div style={{ minHeight: "100vh", background: N.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, fontFamily: sans, color: "#e8ebf2" }}>
      <div style={{ width: "100%", maxWidth: 400, background: N.panel, border: `1px solid ${N.line}`, borderRadius: 16, padding: 22, boxShadow: "0 18px 50px rgba(0,0,0,0.6)" }}>
        <div style={{ fontSize: 17, fontWeight: 800, marginBottom: 12 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

/* Host-side "play with friends" modal, opened from the solo table. */
function CreateRoomModal({ onClose }) {
  const acct = useAccount();
  const [name, setName] = React.useState((ACCT.user && ACCT.user.display_name) || "");
  const [charity, setCharity] = React.useState(false);
  const [pledge, setPledge] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState(null);
  const go = async () => {
    setBusy(true); setError(null);
    try {
      const out = await acctApi("/room", { method: "POST", body: JSON.stringify({ name, charity_night: charity, pledge: Number(pledge) || 0 }) });
      saveIdent(out.code, { seat: out.seat, key: out.key });
      window.location.search = `?room=${out.code}`;
    } catch (e) { setError(e.message); setBusy(false); }
  };
  return (
    <Modal onBackdrop={onClose}>
      <ModalHeader title="Play with friends" onClose={onClose} closeLabel="Close" />
      <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, lineHeight: 1.6, marginBottom: 10 }}>
        You get a room link to text your friends — they take the bot seats from
        anywhere. Cards are dealt on the server, so nobody's browser ever sees
        another player's hand. Practice chips only.
      </div>
      <input style={fieldStyle} placeholder="your name at the table" maxLength={24} value={name} onChange={(e) => setName(e.target.value)} />
      <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontFamily: mono, fontSize: 11.5, color: T.cream, margin: "2px 0 8px", cursor: "pointer" }}>
        <input type="checkbox" checked={charity} onChange={(e) => setCharity(e.target.checked)} style={{ marginTop: 2 }} />
        <span>Charity night — everyone pledges, the night's winner picks the charity, and everyone donates their own pledge directly on the charity's page. The app never touches money.</span>
      </label>
      {charity && <input style={fieldStyle} type="number" min="1" placeholder="your pledge (e.g. 50)" value={pledge} onChange={(e) => setPledge(e.target.value)} />}
      {error && <div style={{ fontFamily: mono, fontSize: 11.5, color: T.pegRed, marginBottom: 8 }}>{error}</div>}
      <button onClick={go} disabled={busy || !name.trim() || !acct.online} style={{ ...segStyle(true), width: "100%", padding: "11px 6px", fontSize: 13 }}>
        {busy ? "…" : "Create room"}
      </button>
    </Modal>
  );
}

/* One-line table talk: bubbles at your seat everywhere, logged in the feed. */
function ChatRow({ onSend }) {
  const [text, setText] = React.useState("");
  const send = () => { const t = text.trim(); if (!t) return; onSend(t); setText(""); };
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <input value={text} maxLength={200} placeholder="say something to the table…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } e.stopPropagation(); }}
        style={{ flex: 1, minWidth: 0, padding: "9px 12px", borderRadius: 9, border: `1px solid ${N.line2}`,
          background: "#101318", color: "#e8ebf2", fontFamily: sans, fontSize: 13, outline: "none" }} />
      <button onClick={send} disabled={!text.trim()} style={{ padding: "0 16px", borderRadius: 9, cursor: "pointer",
        border: `1px solid ${N.line2}`, background: "#232733", color: "#e8ebf2", fontFamily: sans, fontSize: 12, fontWeight: 800 }}>
        SEND
      </button>
    </div>
  );
}

function RoomTable({ code }) {
  const acct = useAccount();
  const [ident, setIdent] = React.useState(() => readIdent(code));
  const [info, setInfo] = React.useState(null);
  const [payload, setPayload] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [joinName, setJoinName] = React.useState("");
  const [joinPledge, setJoinPledge] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [raiseTo, setRaiseTo] = React.useState(BIG_BLIND * 3);
  const [charityName, setCharityName] = React.useState("");
  const [charityUrl, setCharityUrl] = React.useState("");
  const esRef = React.useRef(null);
  const [recState, setRecState] = React.useState("idle"); // idle | recording | sending
  const [playing, setPlaying] = React.useState(null);     // {url, name, mime, muted}
  const seenClips = React.useRef(new Set());
  const recRef = React.useRef(null);

  // pre-join info
  React.useEffect(() => {
    if (!acct.checked || !acct.online || ident) return;
    acctApi(`/room/${code}/info`).then((i) => { setInfo(i); setJoinName((ACCT.user && ACCT.user.display_name) || ""); })
      .catch((e) => setError(e.message));
  }, [acct.checked, acct.online, ident]);

  // the stream
  React.useEffect(() => {
    if (!acct.online || !ident) return;
    const es = new EventSource(`${ACCT.base}/api/room/${code}/events?seat=${ident.seat}&key=${encodeURIComponent(ident.key)}`);
    esRef.current = es;
    es.onmessage = (ev) => { try { setPayload(JSON.parse(ev.data)); } catch { /* ping */ } };
    es.onerror = () => { /* EventSource auto-reconnects */ };
    return () => es.close();
  }, [acct.online, ident]);

  /* ---- video taunts ---- */
  const videoUrl = (id) => `${ACCT.base}/api/room/${code}/video/${id}?seat=${ident.seat}&key=${encodeURIComponent(ident.key)}`;
  const openClip = async (clip, auto) => {
    try {
      const res = await fetch(videoUrl(clip.id));
      if (!res.ok) throw new Error("clip gone");
      const blob = await res.blob();
      const sender = state ? state.players[clip.seat].name : "someone";
      setPlaying({ url: URL.createObjectURL(blob), name: sender, muted: !!auto });
    } catch { setError("That clip has expired."); setTimeout(() => setError(null), 2000); }
  };
  // A fresh clip from ANYONE ELSE barges onto your screen — that's the feature.
  React.useEffect(() => {
    if (!payload || !payload.videos) return;
    const fresh = payload.videos.filter((v) => !seenClips.current.has(v.id));
    for (const v of payload.videos) seenClips.current.add(v.id);
    const last = fresh.filter((v) => v.seat !== mySeat).pop();
    if (last && !playing && !recState.startsWith("record")) openClip(last, true); // muted autoplay; tap for sound
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload && payload.videos && payload.videos.map((v) => v.id).join(",")]);

  const recordClip = async () => {
    if (recState !== "idle") { // second tap = stop early
      if (recRef.current && recRef.current.state === "recording") recRef.current.stop();
      return;
    }
    setError(null);
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 480 }, facingMode: "user" }, audio: true });
    } catch { setError("Camera blocked — allow camera access to send a taunt."); setTimeout(() => setError(null), 2500); return; }
    const mime = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m));
    if (!mime) { setError("This browser can't record video."); stream.getTracks().forEach((t) => t.stop()); return; }
    const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 900000 });
    recRef.current = mr;
    const chunks = [];
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = async () => {
      clearTimeout(mr._autoStop);
      stream.getTracks().forEach((t) => t.stop());
      setRecState("sending");
      try {
        const blob = new Blob(chunks, { type: mime.split(";")[0] });
        if (blob.size > 2.8 * 1024 * 1024) throw new Error("Clip too large — keep it under ~6 seconds.");
        const res = await fetch(`${ACCT.base}/api/room/${code}/video?seat=${ident.seat}&key=${encodeURIComponent(ident.key)}`,
          { method: "POST", headers: { "content-type": blob.type }, body: blob });
        if (!res.ok) throw new Error((await res.json()).detail || "Upload failed");
      } catch (e) { setError(e.message); setTimeout(() => setError(null), 3000); }
      setRecState("idle");
    };
    mr.start();
    setRecState("recording");
    mr._autoStop = setTimeout(() => { if (mr.state === "recording") mr.stop(); }, 6000);
  };

  const post = async (verb, body = {}) => {
    setError(null);
    if (verb === "act" && body.action) {
      if (body.action.type === "raise") sfx.chips(3);
      else if (body.action.type === "fold") sfx.click();
      else sfx.chip();
    }
    try { return await acctApi(`/room/${code}/${verb}`, { method: "POST", body: JSON.stringify({ seat: ident.seat, key: ident.key, ...body }) }); }
    catch (e) { setError(e.message); }
  };
  const join = async () => {
    setBusy(true); setError(null);
    try {
      const out = await acctApi(`/room/${code}/join`, { method: "POST", body: JSON.stringify({ name: joinName, pledge: Number(joinPledge) || 0 }) });
      saveIdent(code, { seat: out.seat, key: out.key });
      setIdent({ seat: out.seat, key: out.key });
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const state = payload && payload.state;
  const mySeat = payload ? payload.youSeat : -1;
  const isHost = mySeat === 0;
  const userTurn = state && state.phase === "betting" && state.toAct === mySeat;
  const la = userTurn ? legalActions(state) : null;
  React.useEffect(() => { if (userTurn && la) setRaiseTo(clampN(la.minRaiseTo, state.pot, la.maxRaiseTo)); /* eslint-disable-line */ }, [userTurn]);

  // Foley in rooms: cards on deal/streets; the chord when it's YOUR pot.
  const sndHand = React.useRef(0);
  const sndBoard = React.useRef(0);
  React.useEffect(() => {
    if (!state) return;
    if (state.handNo !== sndHand.current) { sndHand.current = state.handNo; sndBoard.current = 0; if (state.handNo > 0) sfx.cards(2); }
    if (state.board.length > sndBoard.current) { sfx.cards(state.board.length - sndBoard.current); sndBoard.current = state.board.length; }
  }, [state]);

  // my finished hands feed my account stats, same as solo
  const reportedHand = React.useRef(0);
  React.useEffect(() => {
    if (!state || state.phase !== "over" || state.handNo === 0 || reportedHand.current === state.handNo) return;
    reportedHand.current = state.handNo;
    const won = state.winners.includes(mySeat);
    if (won) sfx.win(state.pot >= 1000);
    reportStats({ set: { table_stack: state.players[mySeat].stack }, inc: { table_hands: 1, table_wins: won ? 1 : 0 }, maxOf: won ? { biggest_pot: state.pot } : {} });
  }, [state]);

  /* --- pre-table screens --- */
  if (!acct.checked) return <RoomCard title="Connecting…"><div style={{ color: N.dim, fontSize: 13 }}>Finding the poker server.</div></RoomCard>;
  if (!acct.online) return <RoomCard title="No table service here">
    <div style={{ color: N.dim, fontSize: 13, lineHeight: 1.6 }}>This copy of the app can't reach the poker server, so shared rooms aren't available. Open the online version to join room {code}.</div>
  </RoomCard>;
  if (!ident) {
    return (
      <RoomCard title={info ? `Join room ${code}` : error ? "Room unavailable" : "Looking up the room…"}>
        {info && (
          <>
            <div style={{ color: N.dim, fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
              At the table: {info.players.join(", ")} · {info.openSeats} open seat{info.openSeats === 1 ? "" : "s"}
              {info.charity_night ? " · CHARITY NIGHT" : ""}
            </div>
            <input style={darkField} placeholder="your name at the table" maxLength={24} value={joinName} onChange={(e) => setJoinName(e.target.value)} />
            {info.charity_night && <input style={darkField} type="number" min="1" placeholder="your pledge (donated by you, directly, later)" value={joinPledge} onChange={(e) => setJoinPledge(e.target.value)} />}
            <button style={darkBtn(true)} disabled={busy || !joinName.trim()} onClick={join}>{busy ? "…" : "Take a seat"}</button>
          </>
        )}
        {error && <div style={{ color: N.redSoft, fontSize: 12.5, marginTop: 8 }}>{error}</div>}
      </RoomCard>
    );
  }
  if (!state) return <RoomCard title={`Room ${code}`}><div style={{ color: N.dim, fontSize: 13 }}>Taking your seat…</div></RoomCard>;

  /* --- the table (server-driven) --- */
  const you = state.players[mySeat];
  const others = [1, 2, 3].map((k) => (mySeat + k) % 4);
  const OPP_SPOTS = [{ x: 14, y: 26 }, { x: 50, y: 11 }, { x: 86, y: 26 }];
  const equities = payload.equities;
  const leadSeat = equities ? Number(Object.keys(equities).reduce((a, b) => (equities[a] >= equities[b] ? a : b))) : -1;
  const vw2 = Math.min(typeof window !== "undefined" ? window.innerWidth : 400, 900);
  const boardW = clampN(38, Math.round(vw2 * 0.115), 54);
  const holeW = clampN(54, Math.round(vw2 * 0.16), 74);
  const streetNames = ["Pre-flop", "Flop", "Turn", "River"];
  const charity = payload.charity;
  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}${window.location.pathname}?room=${code}` : "";
  const actBtn = (extra) => ({
    padding: "13px 8px", borderRadius: 12, fontFamily: sans, fontSize: 14, fontWeight: 800,
    letterSpacing: "0.04em", cursor: "pointer", border: "1px solid transparent", width: "100%", ...extra,
  });

  return (
    <div style={{ background: `radial-gradient(130% 70% at 50% -10%, #10151b, ${N.bg} 60%)`, minHeight: "100vh", display: "flex", flexDirection: "column", fontFamily: sans, color: N.text, overflow: "hidden" }}>
      <style>{`
        html, body { background: ${N.bg}; }
        button:active { filter: brightness(1.15); transform: translateY(1px); }
        button:disabled { opacity: 0.4; cursor: default; }
        input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 6px;
          border-radius: 999px; background: linear-gradient(90deg, ${N.green} var(--fill, 0%), #2b2f3a var(--fill, 0%)); outline: none; }
        input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none;
          width: 24px; height: 24px; border-radius: 50%; border: none;
          background: radial-gradient(circle at 35% 35%, #7dffb8, ${N.green} 65%);
          box-shadow: 0 0 12px rgba(0,230,118,0.55), 0 2px 6px rgba(0,0,0,0.6); }
        input[type=range]::-moz-range-thumb { width: 24px; height: 24px; border-radius: 50%; border: none; background: ${N.green}; }
        @keyframes cardIn { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
        .boardwrap > * { animation: cardIn 240ms ease both }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px 6px", flex: "0 0 auto", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, letterSpacing: "0.12em", color: N.dim }}>ROOM {code}</span>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", color: N.faint, marginLeft: 8 }}>PRACTICE CHIPS ONLY</span>
          {charity.night && (
            <span style={{ fontSize: 10.5, fontWeight: 800, color: N.gold, marginLeft: 8 }}>
              CHARITY NIGHT · ${charity.total.toLocaleString()} pledged
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <SoundToggle dark />
          <button onClick={recordClip} title="Send a video to the table" style={{
            height: 30, borderRadius: 9, cursor: "pointer", padding: "0 10px",
            border: `1px solid ${recState === "recording" ? "rgba(255,82,82,0.7)" : N.line2}`,
            background: recState === "recording" ? "rgba(255,82,82,0.15)" : "rgba(255,255,255,0.04)",
            color: recState === "recording" ? N.redSoft : "#c9cfda", fontFamily: sans, fontSize: 11, fontWeight: 800,
          }}>
            {recState === "recording" ? "◉ REC — tap to send" : recState === "sending" ? "…" : "🎥 VIDEO"}
          </button>
          {payload.videos && payload.videos.length > 0 && (
            <button onClick={() => openClip(payload.videos[payload.videos.length - 1], false)} title="Replay the latest clip" style={{
              height: 30, borderRadius: 9, cursor: "pointer", padding: "0 10px",
              border: `1px solid ${N.line2}`, background: "rgba(255,255,255,0.04)",
              color: "#c9cfda", fontFamily: sans, fontSize: 11, fontWeight: 800,
            }}>▶ {state.players[payload.videos[payload.videos.length - 1].seat].name}</button>
          )}
          {payload.openSeats > 0 && (
            <button onClick={() => { try { navigator.clipboard.writeText(shareUrl); setError("Link copied — text it to a friend."); setTimeout(() => setError(null), 2000); } catch { setError(shareUrl); } }}
              style={{ height: 30, borderRadius: 9, cursor: "pointer", padding: "0 10px", border: `1px solid rgba(0,230,118,0.4)`, background: "rgba(0,230,118,0.08)", color: N.green, fontFamily: sans, fontSize: 11, fontWeight: 800 }}>
              INVITE · {payload.openSeats} seat{payload.openSeats === 1 ? "" : "s"} open
            </button>
          )}
          <AccountArea dark />
          <a href="index.html" aria-label="Home" style={{ color: N.dim, textDecoration: "none", fontSize: 16, lineHeight: 1, border: `1px solid ${N.line}`, borderRadius: 9, padding: "5px 9px", background: "rgba(255,255,255,0.02)" }}>⌂</a>
        </div>
      </div>
      {error && <div style={{ textAlign: "center", fontSize: 11.5, fontWeight: 700, color: N.gold, padding: "0 12px" }}>{error}</div>}

      {playing && (
        <div onClick={() => { URL.revokeObjectURL(playing.url); setPlaying(null); }} style={{
          position: "fixed", inset: 0, zIndex: 300, background: "rgba(0,0,0,0.75)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: N.panel, border: `1px solid ${N.line2}`, borderRadius: 16, padding: 12, maxWidth: 420, width: "100%", boxShadow: "0 18px 60px rgba(0,0,0,0.7)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 800 }}>🎥 {playing.name}</span>
              <button onClick={() => { URL.revokeObjectURL(playing.url); setPlaying(null); }} style={{ background: "#232733", color: "#e8ebf2", border: "none", borderRadius: 8, padding: "5px 12px", cursor: "pointer", fontWeight: 800, fontSize: 12 }}>CLOSE</button>
            </div>
            <video src={playing.url} autoPlay muted={playing.muted} controls playsInline style={{ width: "100%", borderRadius: 10, background: "#000" }} />
            {playing.muted && (
              <button onClick={() => setPlaying({ ...playing, muted: false })} style={{ width: "100%", marginTop: 8, padding: "9px 0", borderRadius: 9, border: "1px solid rgba(0,230,118,0.4)", background: "rgba(0,230,118,0.1)", color: N.green, fontWeight: 800, fontSize: 12, cursor: "pointer" }}>
                🔊 TAP FOR SOUND
              </button>
            )}
          </div>
        </div>
      )}

      <div style={{ flex: "1 1 auto", position: "relative", minHeight: 0 }}>
       <div style={{ position: "absolute", left: "50%", top: 0, bottom: 0, transform: "translateX(-50%)", width: "min(100vw, 900px)" }}>
        <div style={{
          position: "absolute", inset: "5% 5% 3% 5%", borderRadius: "48% / 42%",
          background: `radial-gradient(75% 70% at 50% 32%, ${N.feltHi}, ${N.felt} 75%)`,
          border: `7px solid ${N.rail}`,
          boxShadow: "0 0 60px rgba(0,0,0,0.85), inset 0 0 46px rgba(0,0,0,0.55), inset 0 0 0 2px rgba(0,230,118,0.07)",
        }} />

        {others.map((seat, i) => (
          <OppSeat key={seat} player={state.players[seat]} seat={seat} spot={OPP_SPOTS[i]} state={state} cardW={boardW}
            equity={equities ? equities[seat] : null} lead={leadSeat === seat} />
        ))}

        <div style={{ position: "absolute", left: "50%", top: "47%", transform: "translate(-50%, -50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 9, zIndex: 2, width: "100%" }}>
          {state.handNo > 0 && (
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.16em", color: N.faint }}>
              HAND #{state.handNo} · {state.phase === "over" ? "COMPLETE" : state.phase === "runout" ? "ALL IN" : streetNames[state.street].toUpperCase()}
            </div>
          )}
          <div style={{ background: "rgba(0,0,0,0.6)", border: "1px solid rgba(0,230,118,0.3)", borderRadius: 999, padding: "4px 15px", fontSize: 13, fontWeight: 800, color: N.green, boxShadow: "0 0 18px rgba(0,230,118,0.12)" }}>
            POT&nbsp;&nbsp;{money(state.pot)}
          </div>
          <div className="boardwrap" style={{ display: "flex", gap: "clamp(4px, 1.5vw, 8px)", justifyContent: "center" }}>
            {state.board.map((c) => <TableCard key={cardId(c)} card={c} w={boardW} />)}
            {Array.from({ length: 5 - state.board.length }, (_, i) => <CardSlot key={`s${i}`} w={boardW} />)}
          </div>
          {state.message && (
            <div style={{ marginTop: 2, background: "rgba(255,213,79,0.12)", border: "1px solid rgba(255,213,79,0.4)", borderRadius: 10, padding: "6px 14px", fontSize: 12.5, fontWeight: 700, color: N.gold, textAlign: "center", maxWidth: "88%" }}>
              {state.message}
            </div>
          )}
          {charity.picked && charity.picked.name && (() => {
            const pledgers = Object.keys(charity.pledges).map(Number).filter((s) => charity.pledges[s] > 0);
            const donatedCount = pledgers.filter((s) => charity.donated && charity.donated[s]).length;
            const allIn = pledgers.length > 0 && donatedCount === pledgers.length;
            const iPledged = charity.pledges[mySeat] > 0;
            const iDonated = charity.donated && charity.donated[mySeat];
            return (
              <div style={{ position: "relative", background: allIn ? "rgba(255,213,79,0.12)" : "rgba(0,230,118,0.1)", border: `1px solid ${allIn ? "rgba(255,213,79,0.55)" : "rgba(0,230,118,0.45)"}`, borderRadius: 12, padding: "10px 16px", textAlign: "center", maxWidth: "90%" }}>
                {allIn && <Burst fireKey={donatedCount} count={14} />}
                <div style={{ fontSize: 13.5, fontWeight: 800, color: allIn ? N.gold : N.green }}>
                  {allIn ? `THE WHOLE TABLE CAME THROUGH FOR ${charity.picked.name.toUpperCase()}` : `${state.players[charity.winnerSeat].name} picked ${charity.picked.name}`}
                </div>
                <div style={{ fontSize: 12, color: "#c9cfda", marginTop: 3 }}>
                  ${charity.total.toLocaleString()} pledged · everyone donates their own pledge, directly:
                </div>
                {charity.picked.url && (
                  <a href={charity.picked.url} target="_blank" rel="noreferrer" style={{ color: N.gold, fontWeight: 800, fontSize: 13 }}>
                    {charity.picked.url}
                  </a>
                )}
                <div style={{ fontSize: 11.5, fontFamily: mono, color: N.dim, marginTop: 6 }}>
                  {donatedCount} of {pledgers.length} donations made (on their honor)
                </div>
                {iPledged && !iDonated && (
                  <button onClick={() => { sfx.win(false); post("donated"); }} style={{
                    marginTop: 8, padding: "9px 20px", borderRadius: 10, cursor: "pointer",
                    fontFamily: sans, fontSize: 12.5, fontWeight: 900, letterSpacing: "0.04em",
                    border: "1px solid rgba(0,230,118,0.6)", background: "linear-gradient(180deg, rgba(0,230,118,0.25), rgba(0,230,118,0.1))",
                    color: N.green,
                  }}>✓ I MADE MY DONATION</button>
                )}
                {iPledged && iDonated && (
                  <div style={{ marginTop: 6, fontSize: 12, fontWeight: 800, color: N.gold }}>your ${charity.pledges[mySeat]} is in — thank you ✦</div>
                )}
              </div>
            );
          })()}
        </div>

        <div style={{ position: "absolute", left: "50%", bottom: 0, transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", zIndex: 4, opacity: you.folded && state.phase === "betting" ? 0.5 : 1 }}>
          {you.hole.length > 0 && !you.folded && (
            <div style={{ display: "flex", marginBottom: -10 }}>
              {you.hole.map((c, i) => (
                <div key={cardId(c)} style={{ transform: `rotate(${i === 0 ? -6 : 6}deg) translateY(${i === 0 ? 2 : 0}px)`, marginLeft: i === 0 ? 0 : -Math.round(holeW * 0.24), zIndex: i }}>
                  <TableCard card={c} w={holeW} />
                </div>
              ))}
            </div>
          )}
          <div style={{
            display: "flex", alignItems: "center", gap: 10, position: "relative", zIndex: 6,
            background: "rgba(13,16,20,0.97)",
            border: `2px solid ${state.winners.includes(mySeat) ? N.gold : userTurn ? N.green : N.line}`,
            boxShadow: userTurn ? "0 0 18px rgba(0,230,118,0.4)" : state.winners.includes(mySeat) ? "0 0 18px rgba(255,213,79,0.4)" : "0 6px 16px rgba(0,0,0,0.55)",
            borderRadius: 13, padding: "7px 14px",
          }}>
            {state.btn === mySeat && state.handNo > 0 && (
              <span style={{ width: 20, height: 20, borderRadius: "50%", background: "#e8ebf2", color: "#14171d", fontSize: 10, fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center" }}>D</span>
            )}
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 800 }}>{you.name}{you.folded && state.phase === "betting" ? " · FOLDED" : ""}</div>
              <div style={{ fontSize: 12.5, fontWeight: 800, color: N.green }}>{money(you.stack)}</div>
            </div>
            {you.lastAct && <ActBadge lastAct={you.lastAct} />}
            {equities && equities[mySeat] != null && <EquityBadge pct={equities[mySeat]} lead={leadSeat === mySeat} />}
            <BetPill amount={you.streetBet} />
          </div>
        </div>
       </div>
      </div>

      <div style={{ flex: "0 0 auto", background: `linear-gradient(180deg, ${N.panel}, #101318)`, borderTop: `1px solid ${N.line}`, padding: "12px 16px calc(12px + env(safe-area-inset-bottom, 0px))", display: "flex", flexDirection: "column", gap: 11, alignItems: "center" }}>
       <div style={{ width: "100%", maxWidth: 620, display: "flex", flexDirection: "column", gap: 11 }}>
        <ActionTicker log={state && state.log} />
        <ChatRow onSend={(text) => post("chat", { text })} />
        {state.phase === "betting" ? (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12, opacity: userTurn && la && la.canRaise ? 1 : 0.35 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: N.dim, flex: "0 0 auto" }}>{la ? money(la.minRaiseTo) : ""}</span>
              <input type="range" aria-label="Raise to" disabled={!userTurn || !la || !la.canRaise}
                min={la ? la.minRaiseTo : 0} max={la ? la.maxRaiseTo : 100} step={25}
                value={la ? clampN(la.minRaiseTo, raiseTo, la.maxRaiseTo) : 0}
                style={{ "--fill": la && la.maxRaiseTo > la.minRaiseTo ? `${((clampN(la.minRaiseTo, raiseTo, la.maxRaiseTo) - la.minRaiseTo) / (la.maxRaiseTo - la.minRaiseTo)) * 100}%` : "100%", flex: 1 }}
                onChange={(e) => setRaiseTo(Number(e.target.value))} />
              <span style={{ fontSize: 10.5, fontWeight: 700, color: N.dim, flex: "0 0 auto" }}>{la ? money(la.maxRaiseTo) : ""}</span>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 1.5fr", gap: 9 }}>
              <button disabled={!userTurn} onClick={() => post("act", { action: { type: "fold" } })}
                style={actBtn({ background: "#232733", color: N.redSoft, border: "1px solid rgba(255,82,82,0.25)" })}>FOLD</button>
              <button disabled={!userTurn} onClick={() => post("act", { action: { type: "call" } })}
                style={actBtn({ background: "#232733", color: N.text, border: `1px solid ${N.line2}` })}>
                {userTurn && la ? (la.canCheck ? "CHECK" : `CALL ${money(la.toCall)}`) : "CHECK"}
              </button>
              <button disabled={!userTurn || !la || !la.canRaise} onClick={() => post("act", { action: { type: "raise", to: raiseTo } })}
                style={actBtn({ background: `linear-gradient(180deg, #2aff8f, ${N.green} 55%, #00b25a)`, color: "#00230f", boxShadow: "0 4px 16px rgba(0,230,118,0.35)" })}>
                {la && clampN(la.minRaiseTo, raiseTo, la.maxRaiseTo) >= la.maxRaiseTo ? "ALL-IN" : `RAISE TO ${la ? money(clampN(la.minRaiseTo, raiseTo, la.maxRaiseTo)) : ""}`}
              </button>
            </div>
            {!userTurn && (
              <div style={{ textAlign: "center", fontSize: 11, fontWeight: 700, color: N.dim }}>
                {state.toAct >= 0 ? `${state.players[state.toAct].name} is thinking…` : "…"}
              </div>
            )}
          </>
        ) : state.phase === "runout" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center", padding: "4px 0" }}>
            <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: "0.08em", color: N.gold }}>ALL IN — running it out…</div>
            <button onClick={recordClip} style={{
              width: "100%", maxWidth: 380, padding: "13px 10px", borderRadius: 12, cursor: "pointer",
              fontFamily: sans, fontSize: 14, fontWeight: 900, letterSpacing: "0.04em",
              border: recState === "recording" ? "1px solid rgba(255,82,82,0.7)" : "1px solid rgba(255,213,79,0.5)",
              background: recState === "recording" ? "rgba(255,82,82,0.18)" : "linear-gradient(180deg, rgba(255,213,79,0.22), rgba(255,213,79,0.08))",
              color: recState === "recording" ? N.redSoft : N.gold,
            }}>
              {recState === "recording" ? "◉ RECORDING — TAP TO SEND" : recState === "sending" ? "SENDING…" : "🎥 SEND THEM A VIDEO"}
            </button>
          </div>
        ) : charity.night && charity.winnerSeat != null && !(charity.picked && charity.picked.name) ? (
          charity.winnerSeat === mySeat ? (
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 800, color: N.gold, marginBottom: 8 }}>You lead the night — pick where the table's ${charity.total.toLocaleString()} goes:</div>
              <input style={darkField} placeholder="charity name" maxLength={80} value={charityName} onChange={(e) => setCharityName(e.target.value)} />
              <input style={darkField} placeholder="donation link (https://…)" maxLength={300} value={charityUrl} onChange={(e) => setCharityUrl(e.target.value)} />
              <button style={darkBtn(true)} disabled={!charityName.trim()} onClick={() => post("charity", { name: charityName, url: charityUrl })}>SEND THE NIGHT TO {charityName.trim().toUpperCase() || "…"}</button>
            </div>
          ) : (
            <div style={{ textAlign: "center", fontSize: 12.5, fontWeight: 700, color: N.dim, padding: "10px 0" }}>
              {state.players[charity.winnerSeat].name} leads the night and is choosing the charity…
            </div>
          )
        ) : (
          <div style={{ display: "flex", gap: 10, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
            {isHost ? (
              <>
                {!(charity.picked && charity.picked.name) && (
                  <button onClick={() => post("deal")}
                    style={{ ...actBtn({ background: `linear-gradient(180deg, #2aff8f, ${N.green} 55%, #00b25a)`, color: "#00230f", boxShadow: "0 4px 16px rgba(0,230,118,0.35)" }), width: "auto", padding: "13px 42px" }}>
                    {state.handNo === 0 ? "DEAL THE FIRST HAND" : "NEXT HAND"}
                  </button>
                )}
                {charity.night && state.handNo > 0 && charity.winnerSeat == null && (
                  <button onClick={() => post("end-night")} style={{ ...actBtn({ background: "#232733", color: N.gold, border: "1px solid rgba(255,213,79,0.35)" }), width: "auto", padding: "13px 22px" }}>
                    END NIGHT
                  </button>
                )}
              </>
            ) : (
              <div style={{ textAlign: "center", fontSize: 12.5, fontWeight: 700, color: N.dim, padding: "10px 0" }}>
                {charity.picked && charity.picked.name ? "The night is complete — donate above, then brag." : `Waiting for ${state.players[0].name} to deal…`}
              </div>
            )}
          </div>
        )}
       </div>
      </div>
    </div>
  );
}

const roomCodeFromUrl = () => {
  try { return new URLSearchParams(window.location.search).get("room"); } catch { return null; }
};

export default function PokerTable() {
  const code = roomCodeFromUrl();
  return code ? <RoomTable code={code.toUpperCase()} /> : <SoloTable />;
}
