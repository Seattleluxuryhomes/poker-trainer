/* Casino design kit — the shared premium look and the JUICE for the floor
 * games (roulette, craps): tokens, the header with a counting bankroll, gold
 * particle bursts, the BigWin moment, count-up numbers, shared keyframes.
 * build.sh prepends this after chrome.jsx. Hooks are called as React.*.
 * Design intent: near-black room, emerald felt under warm light, gold for
 * money moments and ONLY money moments; losses stay quiet. Numbers never
 * jump — they count. Nothing here touches game math.
 */

const CAS = {
  bg: "#0a0c10", room: "#10151b",
  felt: "#0a3320", feltDeep: "#062114", feltEdge: "#0e4429",
  rail: "#3a2a18", railHi: "#5a4226",
  gold: "#f5c542", goldHi: "#ffe08a", goldDim: "rgba(245,197,66,0.55)",
  goldLine: "rgba(245,197,66,0.28)", goldFaint: "rgba(245,197,66,0.12)",
  ink: "#101318", cream: "#f4efe4", text: "#e8ebf2", dim: "#96a0b0", faint: "#5b6472",
  green: "#00e676", red: "#e14b42", redDeep: "#8e2b24", black: "#181c24",
  line: "#232833", panel: "rgba(16,20,26,0.92)",
};
const casSans = "Inter, 'Albert Sans', system-ui, -apple-system, sans-serif";
const casMono = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

const CAS_CSS = `
  html, body { background: ${CAS.bg}; }
  button { font-family: inherit }
  button:active { filter: brightness(1.18); transform: translateY(1px) }
  button:disabled { opacity: .38; cursor: default }
  @keyframes casPop { 0% { transform: scale(0.6); opacity: 0 } 55% { transform: scale(1.12) } 100% { transform: scale(1); opacity: 1 } }
  @keyframes casPulseGold { 0%,100% { box-shadow: 0 0 18px rgba(245,197,66,0.25) } 50% { box-shadow: 0 0 34px rgba(245,197,66,0.6) } }
  @keyframes casFlash { 0% { opacity: 0 } 12% { opacity: 1 } 100% { opacity: 0 } }
  @keyframes casParticle {
    0% { transform: translate(0,0) scale(1) rotate(0deg); opacity: 1 }
    100% { transform: translate(var(--px), var(--py)) scale(0.4) rotate(var(--pr)); opacity: 0 }
  }
  @keyframes casChipDrop { 0% { transform: translateY(-14px) scale(1.25); opacity: 0 } 60% { transform: translateY(2px) scale(0.96); opacity: 1 } 100% { transform: none; opacity: 1 } }
  @keyframes casShimmer { 0% { background-position: -200% 0 } 100% { background-position: 200% 0 } }
  @media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important } }
`;

/* A number that COUNTS to its value instead of jumping. */
function useCountUp(value, ms = 700) {
  const [shown, setShown] = React.useState(value);
  const fromRef = React.useRef(value);
  React.useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    const t0 = performance.now();
    let raf;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(Math.round(from + (value - from) * eased));
      if (k < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return shown;
}

/* Gold chip-shard burst. Re-fires whenever `fireKey` changes to a truthy value. */
function Burst({ fireKey, count = 16 }) {
  if (!fireKey) return null;
  return (
    <div key={fireKey} style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "visible", zIndex: 30 }}>
      {Array.from({ length: count }, (_, i) => {
        const a = (i / count) * Math.PI * 2 + (i % 3) * 0.3;
        const d = 60 + (i % 5) * 26;
        return (
          <span key={i} style={{
            position: "absolute", left: "50%", top: "50%", width: i % 3 ? 8 : 12, height: i % 3 ? 8 : 12,
            borderRadius: i % 2 ? "50%" : 3,
            background: i % 4 === 0 ? CAS.goldHi : i % 4 === 1 ? CAS.gold : i % 4 === 2 ? CAS.green : CAS.cream,
            "--px": `${Math.cos(a) * d}px`, "--py": `${Math.sin(a) * d - 30}px`, "--pr": `${(i % 2 ? 1 : -1) * 260}deg`,
            animation: `casParticle ${0.7 + (i % 4) * 0.12}s cubic-bezier(0.1, 0.8, 0.3, 1) forwards`,
          }} />
        );
      })}
    </div>
  );
}

/* The money moment: floats up from the action, counts, bursts, fades on its own. */
function BigWin({ amount, fireKey }) {
  const shown = useCountUp(fireKey ? amount : 0, 900);
  if (!fireKey || amount <= 0) return null;
  return (
    <div key={fireKey} style={{
      position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
      pointerEvents: "none", zIndex: 40, textAlign: "center",
      animation: "casPop 320ms cubic-bezier(0.2, 1.4, 0.4, 1) both",
    }}>
      <Burst fireKey={fireKey} />
      <div style={{
        fontFamily: casSans, fontWeight: 900, fontSize: 44, letterSpacing: "-0.02em",
        color: CAS.gold, textShadow: `0 0 24px ${CAS.goldDim}, 0 2px 0 rgba(0,0,0,0.6)`,
      }}>
        +${shown.toLocaleString()}
      </div>
    </div>
  );
}

/* One header for the whole floor: game name under the house style, live bankroll. */
function CasinoHeader({ title, sub, bank }) {
  const shownBank = useCountUp(bank, 700);
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10,
      padding: "12px 16px", flexWrap: "wrap",
      background: "linear-gradient(180deg, rgba(255,255,255,0.03), transparent)",
      borderBottom: `1px solid ${CAS.line}`,
    }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: casSans, fontSize: 17, fontWeight: 900, letterSpacing: "0.22em", color: CAS.cream }}>
          {title}
        </div>
        <div style={{ fontFamily: casMono, fontSize: 9.5, letterSpacing: "0.08em", color: CAS.faint, marginTop: 2 }}>{sub}</div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 7, padding: "6px 13px", borderRadius: 999,
          background: CAS.goldFaint, border: `1px solid ${CAS.goldLine}`,
        }}>
          <span style={{
            width: 14, height: 14, borderRadius: "50%", flex: "0 0 auto",
            background: `radial-gradient(circle at 35% 30%, ${CAS.goldHi}, ${CAS.gold} 60%, #b8860b)`,
            boxShadow: "inset 0 0 0 2px rgba(0,0,0,0.25)",
          }} />
          <span style={{ fontFamily: casSans, fontSize: 14, fontWeight: 900, color: CAS.gold, fontVariantNumeric: "tabular-nums" }}>
            ${shownBank.toLocaleString()}
          </span>
        </div>
        <AccountArea dark />
        <a href="index.html" aria-label="Home" style={{
          color: CAS.dim, textDecoration: "none", fontSize: 16, lineHeight: 1,
          border: `1px solid ${CAS.line}`, borderRadius: 9, padding: "6px 10px", background: "rgba(255,255,255,0.02)",
        }}>⌂</a>
      </div>
    </div>
  );
}

/* A physical chip. */
function CasinoChip({ value, selected, onClick, size = 46 }) {
  const skin = value === 1 ? { bg: "#e9e6dc", fg: "#14171d", ring: "#b9b4a4" }
    : value === 5 ? { bg: "#c62f2f", fg: "#fff", ring: "#7d1d1d" }
    : value === 25 ? { bg: "#1f9d55", fg: "#fff", ring: "#116137" }
    : { bg: "#2e3d52", fg: "#fff", ring: "#1a2433" };
  return (
    <button onClick={onClick} aria-pressed={!!selected} style={{
      width: size, height: size, borderRadius: "50%", cursor: "pointer", position: "relative",
      fontFamily: casSans, fontWeight: 900, fontSize: size * 0.3, color: skin.fg,
      background: `radial-gradient(circle at 35% 30%, ${skin.bg}, ${skin.bg} 55%, ${skin.ring})`,
      border: "none",
      boxShadow: selected
        ? `0 0 0 3px ${CAS.gold}, 0 6px 14px rgba(0,0,0,0.55)`
        : "0 4px 10px rgba(0,0,0,0.5), inset 0 0 0 2px rgba(255,255,255,0.18)",
      outline: "none",
    }}>
      <span style={{
        position: "absolute", inset: 5, borderRadius: "50%",
        border: `2px dashed rgba(255,255,255,${value === 1 ? 0.5 : 0.55})`, pointerEvents: "none",
      }} />
      {value}
    </button>
  );
}

/* The little stack that sits on a bet spot. */
function BetChip({ amount }) {
  return (
    <span style={{
      position: "absolute", top: -10, right: -8, minWidth: 26, height: 26, borderRadius: "50%",
      background: `radial-gradient(circle at 35% 30%, ${CAS.goldHi}, ${CAS.gold} 60%, #b8860b)`,
      color: "#231a05", fontSize: 11, fontWeight: 900, fontFamily: casSans,
      display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px",
      boxShadow: "0 3px 7px rgba(0,0,0,0.6), inset 0 0 0 2px rgba(0,0,0,0.2)",
      animation: "casChipDrop 260ms cubic-bezier(0.2, 1.2, 0.4, 1) both", zIndex: 2,
    }}>{amount}</span>
  );
}

/* The felt: emerald under a warm key light, wooden rail. */
const feltPanel = (pad = "18px 16px") => ({
  borderRadius: 20, padding: pad, position: "relative",
  border: `7px solid transparent`,
  background: `
    radial-gradient(90% 80% at 50% 12%, ${CAS.feltEdge}, ${CAS.felt} 55%, ${CAS.feltDeep} 100%) padding-box,
    linear-gradient(180deg, ${CAS.railHi}, ${CAS.rail}) border-box`,
  boxShadow: "0 18px 50px rgba(0,0,0,0.6), inset 0 0 42px rgba(0,0,0,0.45), inset 0 0 0 1px rgba(245,197,66,0.1)",
});

const casCta = (disabled) => ({
  padding: "15px 10px", borderRadius: 13, cursor: disabled ? "default" : "pointer",
  fontFamily: casSans, fontWeight: 900, fontSize: 15, letterSpacing: "0.09em", border: "none",
  background: `linear-gradient(180deg, #2aff8f, ${CAS.green} 55%, #00a854)`, color: "#00230f",
  boxShadow: "0 6px 20px rgba(0,230,118,0.35), inset 0 1px 0 rgba(255,255,255,0.35)",
});
const casGhost = () => ({
  padding: "15px 8px", borderRadius: 13, cursor: "pointer", fontFamily: casSans,
  fontWeight: 800, fontSize: 12, letterSpacing: "0.06em",
  background: "rgba(255,255,255,0.05)", color: CAS.text, border: `1px solid ${CAS.line}`,
});
