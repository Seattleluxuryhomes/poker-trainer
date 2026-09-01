/* Shared UI chrome — theme, format helpers, and the modal shell — used by BOTH the Play
 * game (src/PokerPlay.jsx) and the Hold Trainer (src/PokerTrainer.jsx). `build.sh`
 * PREPENDS this file (after src/engine.js) to each app before the name-guard + transpile,
 * so every built page ships one self-contained copy (no bundler). Hooks are called as
 * `React.*` so this file needs no React import of its own.
 *
 * The palette and shell are carried over from the cribbage-trainer this project is
 * modeled on (public domain, The Unlicense) — same baize-and-wood table aesthetic.
 */

/* ---- theme + format ---- */
const T = {
  baize: "#1F423A", baizeHi: "#28534A",
  woodD: "#5E3F26", woodM: "#8A5E37", woodL: "#B9824B",
  pegRed: "#C8412B", pegIvory: "#ECDCB4",
  ivory: "#F6EFDE", ink: "#241D14", suitRed: "#A8362A",
  cream: "#ECE0C6", muted: "#C9BC9A", line: "rgba(236,224,182,0.16)",
  good: "#5FA47C", goodDeep: "#3F7E5E", selBlue: "#5B95C2", gold: "#D9A441",
};
const SUIT = ["♠", "♥", "♦", "♣"];
const isRed = (s) => s === 1 || s === 2;
const rankLabel = (r) => (r === 1 ? "A" : r === 11 ? "J" : r === 12 ? "Q" : r === 13 ? "K" : String(r));
const tag = (c) => `${rankLabel(c.r)}${SUIT[c.s]}`;
const mono = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";
const serif = "'Hoefler Text', 'Iowan Old Style', Georgia, 'Times New Roman', serif";

// Display names in CAT index order (engine's strength order).
const CAT_NAMES = ["Nothing", "Jacks or Better", "Two Pair", "Three of a Kind", "Straight", "Flush", "Full House", "Four of a Kind", "Straight Flush", "Royal Flush"];
const catName = (i) => CAT_NAMES[i];

/* ---- version (build-stamped) ---- */
const APP_VERSION = "__APP_VERSION__";
const IS_DEV_VERSION = APP_VERSION.indexOf("-dev") !== -1;

/* ---- shared segmented-button style (selected vs not) ---- */
const segStyle = (on) => ({
  flex: 1, padding: "9px 6px", borderRadius: 8, cursor: "pointer", fontFamily: mono, fontSize: 11.5,
  background: on ? T.pegIvory : "rgba(0,0,0,0.2)", color: on ? "#2A1B0E" : T.cream,
  border: `1px solid ${on ? T.pegIvory : T.line}`, fontWeight: on ? 700 : 400,
});

/* ---- the modal shell ---- */
function Modal({ onBackdrop, maxWidth = 380, padding = "20px", scroll = false, zIndex = 220, children }) {
  return (
    <div onClick={onBackdrop} style={{ position: "fixed", inset: 0, zIndex, background: "rgba(0,0,0,0.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth, width: "100%", background: T.baize, border: `1px solid ${T.line}`, borderRadius: 14, padding, boxShadow: "0 14px 44px rgba(0,0,0,0.55)", ...(scroll ? { maxHeight: "86vh", overflowY: "auto" } : null) }}>
        {children}
      </div>
    </div>
  );
}
function ModalHeader({ title, onClose, closeLabel }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
      <span style={{ fontWeight: 700, fontSize: 17 }}>{title}</span>
      <button onClick={onClose} style={{ padding: "6px 14px", borderRadius: 8, cursor: "pointer", border: `1px solid ${T.line}`, background: "rgba(0,0,0,0.25)", color: T.cream, fontFamily: mono, fontSize: 11.5, fontWeight: 700 }}>{closeLabel || "Done"}</button>
    </div>
  );
}

/* ---- About popup: open-source note + repo link, reached from each page's header ---- */
function AboutModal({ onClose }) {
  return (
    <Modal onBackdrop={onClose}>
      <ModalHeader title="About" onClose={onClose} />
      <div style={{ fontSize: 13.5, lineHeight: 1.55, color: T.cream }}>
        <p style={{ marginTop: 0 }}>
          A five-card-draw poker trainer and a playable Jacks-or-Better game, modeled on the
          open-source <a href="https://github.com/ghug/cribbage-trainer" style={{ color: T.pegIvory }}>cribbage-trainer</a>:
          every number on screen comes from enumeration over the deck, never from a strategy chart.
        </p>
        <p>
          All client-side — no accounts, no tracking; practice stats and the play bankroll live
          only in this browser.
        </p>
        <p style={{ fontFamily: mono, fontSize: 10.5, color: T.muted, marginBottom: 0 }}>v{APP_VERSION}</p>
      </div>
    </Modal>
  );
}

/* ---- the header accuracy track: a chip rail that fills with your optimal-hold rate ---- */
function ChipTrack({ pct }) {
  const CHIPS = 20;
  const lit = Math.round((Math.max(0, Math.min(100, pct)) / 100) * CHIPS);
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }} aria-label={`Accuracy ${pct.toFixed(0)}%`}>
      {Array.from({ length: CHIPS }, (_, i) => (
        <span key={i} style={{
          width: 10, height: 10, borderRadius: "50%", flex: "0 0 auto",
          background: i < lit ? T.pegIvory : "rgba(0,0,0,0.28)",
          boxShadow: i < lit ? "0 0 0 2px rgba(236,220,180,0.45)" : "inset 0 1px 2px rgba(0,0,0,0.6)",
          transition: "all 200ms ease",
        }} />
      ))}
    </div>
  );
}

/* ---- a playing-card face, tappable; used by both pages ---- */
function CardFace({ card, held, faceDown, disabled, onClick, badge }) {
  return (
    <button onClick={onClick} disabled={disabled} aria-pressed={!!held}
      aria-label={faceDown ? "Face-down card" : `${rankLabel(card.r)} of ${["spades", "hearts", "diamonds", "clubs"][card.s]}${held ? ", held" : ""}`}
      style={{
        width: 64, height: 92, borderRadius: 9, padding: 0, position: "relative",
        background: faceDown ? `repeating-linear-gradient(45deg, ${T.baizeHi}, ${T.baizeHi} 4px, ${T.baize} 4px, ${T.baize} 8px)` : T.ivory,
        color: faceDown ? T.ivory : isRed(card.s) ? T.suitRed : T.ink,
        border: "1px solid rgba(0,0,0,0.3)", cursor: disabled ? "default" : "pointer",
        outline: held ? `3px solid ${T.pegIvory}` : "none", outlineOffset: 1,
        transform: held ? "translateY(-8px)" : "none", transition: "transform 140ms ease, outline 140ms ease",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        boxShadow: "0 3px 8px rgba(0,0,0,0.35)", fontFamily: serif,
      }}>
      {!faceDown && <span style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{rankLabel(card.r)}</span>}
      {!faceDown && <span style={{ fontSize: 26, lineHeight: 1.1 }}>{SUIT[card.s]}</span>}
      {held && <span style={{ position: "absolute", top: -22, left: 0, right: 0, textAlign: "center", fontFamily: mono, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", color: T.pegIvory }}>HELD</span>}
      {badge && <span style={{ position: "absolute", bottom: -19, left: 0, right: 0, textAlign: "center", fontFamily: mono, fontSize: 9.5, fontWeight: 700, color: T.gold }}>{badge}</span>}
    </button>
  );
}

/* ---- category bars inside the explain drawer: P(category) × payout = EV share ---- */
function CatBars({ cats, color }) {
  const rows = [];
  for (let c = CAT_COUNT - 1; c >= 1; c--) {
    if (cats[c] <= 0) continue;
    rows.push({ c, p: cats[c], evShare: cats[c] * PAY[c] });
  }
  if (!rows.length) return <div style={{ fontFamily: mono, fontSize: 11, color: T.muted }}>No paying draw exists for this hold.</div>;
  const maxShare = Math.max(...rows.map((r) => r.evShare));
  return (
    <div style={{ display: "grid", gap: 4 }}>
      {rows.map(({ c, p, evShare }) => (
        <div key={c} style={{ display: "grid", gridTemplateColumns: "118px 1fr 92px", gap: 8, alignItems: "center", fontFamily: mono, fontSize: 11 }}>
          <span style={{ color: T.cream }}>{catName(c)}</span>
          <span style={{ height: 8, borderRadius: 4, background: "rgba(0,0,0,0.3)", overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${maxShare > 0 ? (evShare / maxShare) * 100 : 0}%`, background: color, borderRadius: 4 }} />
          </span>
          <span style={{ color: T.muted, textAlign: "right" }}>{(p * 100).toFixed(p >= 0.01 ? 1 : 3)}% · {evShare.toFixed(3)}</span>
        </div>
      ))}
    </div>
  );
}
