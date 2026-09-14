import React, { useState, useEffect } from "react";

/* ============================================================
   HIGH CARD FLUSH (flush.html) — seven cards, one question:
   whose longest flush is longer? Ante, see your seven, then
   FOLD or RAISE (the raise cap grows with your flush: up to
   four cards 1x, five cards 2x, six or seven 3x). The dealer
   needs a nine-high three-card flush to qualify; short of it,
   your raise pushes and the ante pays even. Longer flush wins;
   equal length compares card by card, ace high.
   HONESTY RULE (Known vs Estimated): with C(52,7) deals on
   both sides of a fold decision, this game's edge is not
   enumerable on a phone — so it is SIMULATED on your device,
   with the strategy stated, and labeled exactly that. The
   comparator, qualification, and payouts are exact and proven.
   Practice chips only; the wallet rides the whole floor.
   Pure functions (flushEval … hcfSimulate) are top-level for
   engine/verify_hcf.js.
   ============================================================ */

/* ---- the flush evaluator: longest suit, ranks packed ace-high ---- */
function flushEval(cards) {
  const bySuit = [[], [], [], []];
  for (const c of cards) bySuit[c.s].push(hiRank(c.r));
  let best = null;
  for (let s = 0; s < 4; s++) {
    const ranks = bySuit[s].sort((a, b) => b - a);
    if (!best || ranks.length > best.ranks.length ||
        (ranks.length === best.ranks.length && cmpRanks(ranks, best.ranks) > 0)) {
      best = { suit: s, ranks };
    }
  }
  return best; // { suit, ranks: desc, length = ranks.length }
}
function cmpRanks(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}
/* longer flush wins; same length compares high-to-low; exact tie pushes */
function flushCompare(mine, theirs) {
  if (mine.ranks.length !== theirs.ranks.length) return mine.ranks.length - theirs.ranks.length;
  return cmpRanks(mine.ranks, theirs.ranks);
}

/* dealer qualifies with a 3-card 9-high flush or better */
function hcfQualifies(f) {
  if (f.ranks.length >= 4) return true;
  if (f.ranks.length === 3) return f.ranks[0] >= 9;
  return false;
}

/* raise cap by flush length: ≤4 → 1x ante, 5 → 2x, 6-7 → 3x */
const hcfMaxRaise = (len) => (len >= 6 ? 3 : len === 5 ? 2 : 1);

/* Settlement: credits returned (ante+raise deducted when committed).
 * fold: nothing back. no-qualify: raise pushes, ante pays 1:1.
 * qualify: winner takes even money on both; exact tie pushes both. */
function hcfSettle(folded, dealerQualifies, cmp, ante, raise) {
  if (folded) return 0;
  if (!dealerQualifies) return ante * 2 + raise;
  if (cmp > 0) return (ante + raise) * 2;
  if (cmp < 0) return 0;
  return ante + raise;
}

/* The stated table strategy (simple, honest, printed): raise the maximum
 * with 5+ cards; raise 1x with a 4-flush or a T-8-6-high 3-flush or better;
 * fold the rest. The simulated edge below uses exactly this. */
function hcfShouldRaise(f) {
  if (f.ranks.length >= 4) return true;
  if (f.ranks.length === 3) return cmpRanks(f.ranks, [10, 8, 6]) >= 0;
  return false;
}

/* Simulated edge per ante, seeded and deterministic — labeled SIMULATED. */
function hcfSimulate(hands, rng) {
  let net = 0;
  for (let h = 0; h < hands; h++) {
    const d = fullDeck();
    for (let i = d.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [d[i], d[j]] = [d[j], d[i]]; }
    const mine = flushEval(d.slice(0, 7));
    const dealer = flushEval(d.slice(7, 14));
    const ante = 1;
    if (!hcfShouldRaise(mine)) { net -= ante; continue; }
    const raise = ante * hcfMaxRaise(mine.ranks.length);
    const credit = hcfSettle(false, hcfQualifies(dealer), flushCompare(mine, dealer), ante, raise);
    net += credit - (ante + raise);
  }
  return net / hands;
}

/* ==================== VIEW (casino design kit) ==================== */

const HCF_GUIDE = [
  { h: "Seven cards, longest flush", p: "Post an ante and get seven cards. Your hand is your LONGEST flush — most cards of one suit. Pairs, straights, nothing else matters. Four hearts beats three aces of anything." },
  { h: "Fold or raise", p: "After seeing your seven: FOLD (lose the ante) or RAISE. The cap grows with your flush — up to four cards 1x the ante, five cards 2x, six or seven 3x. Big hands get to bet big; that's the game." },
  { h: "The dealer must qualify", p: "The dealer needs a three-card flush headed by a 9 or better. Short of that, your raise pushes back and the ante pays even money — you can't lose the raise to a dealer who never showed up." },
  { h: "The showdown", p: "Longer flush wins, even money on ante and raise. Same length compares card by card, ace high. An exact tie pushes everything." },
  { h: "The honest number", p: "This game's edge can't be enumerated on a phone — the fold decision sits on top of 133 million deals. So the felt SIMULATES it on your device with the printed strategy, and labels it exactly that. Practice chips only.", tag: "SIMULATED, AND IT SAYS SO" },
];

const HCF_CHIPS = [5, 25, 100, 500, 1000];

function FCard({ card, w, lit, dim, faceDown, delay = 0 }) {
  const red = isRed(card.s);
  return (
    <div style={{
      width: w, height: Math.round(w * 1.42), borderRadius: Math.max(7, w * 0.13), flex: "0 0 auto",
      background: faceDown
        ? "repeating-linear-gradient(45deg, #1c2733, #1c2733 5px, #141b24 5px, #141b24 10px)"
        : "linear-gradient(160deg, #fdfcf7, #efece1 70%, #ddd8c8)",
      border: lit ? "2.5px solid #f5c542" : "1px solid rgba(0,0,0,0.35)",
      boxShadow: lit ? "0 0 14px rgba(245,197,66,0.5), 0 5px 12px rgba(0,0,0,0.5)" : "0 5px 12px rgba(0,0,0,0.5)",
      opacity: dim ? 0.45 : 1, transition: "opacity 300ms ease",
      color: red ? "#c62828" : "#161a22", position: "relative", fontFamily: casSans,
      animation: `casChipDrop 280ms ease ${delay}ms both`,
    }}>
      {!faceDown && (
        <>
          <span style={{ position: "absolute", top: w * 0.07, left: w * 0.1, fontSize: w * 0.32, fontWeight: 900, lineHeight: 1 }}>{rankLabel(card.r)}</span>
          <span style={{ position: "absolute", bottom: w * 0.05, right: w * 0.08, fontSize: w * 0.44, lineHeight: 1 }}>{SUIT[card.s]}</span>
        </>
      )}
    </div>
  );
}

export default function HighCardFlush() {
  const [guideOpen, setGuideOpen] = useState(() => guideUnseen("flush"));
  const [bank, setBank] = useState(walletLoad);
  const [chip, setChip] = useState(25);
  const [phase, setPhase] = useState("bet"); // bet | decide | done
  const [mine, setMine] = useState([]);
  const [dealer, setDealer] = useState([]);
  const [ante, setAnte] = useState(0);
  const [outcome, setOutcome] = useState(null); // {text, net}
  const [winKey, setWinKey] = useState(0);
  const [edge, setEdge] = useState(null);
  const [simming, setSimming] = useState(false);

  useEffect(() => { walletSave(bank); }, [bank]);

  const myFlush = mine.length ? flushEval(mine) : null;
  const maxR = myFlush ? hcfMaxRaise(myFlush.ranks.length) : 1;

  const deal = () => {
    if (phase === "decide" || chip > bank) return;
    sfx.chip(); sfx.cards(7);
    setBank((b) => b - chip);
    setAnte(chip);
    const d = fullDeck();
    for (let i = d.length - 1; i > 0; i--) { const j = ((Math.random() * (i + 1)) | 0); [d[i], d[j]] = [d[j], d[i]]; }
    const sortBySuitRank = (cs) => cs.slice().sort((a, b) => a.s - b.s || hiRank(b.r) - hiRank(a.r));
    setMine(sortBySuitRank(d.slice(0, 7)));
    setDealer(d.slice(7, 14));
    setOutcome(null);
    setPhase("decide");
  };

  const resolve = (raiseMult) => {
    if (phase !== "decide") return;
    const folded = raiseMult === 0;
    const raise = ante * raiseMult;
    if (!folded && raise > bank) return;
    if (!folded) { sfx.chips(raiseMult + 1); setBank((b) => b - raise); } else sfx.click();
    const df = flushEval(dealer);
    const q = hcfQualifies(df);
    const cmp = flushCompare(myFlush, df);
    const credit = hcfSettle(folded, q, cmp, ante, raise);
    const net = credit - ante - raise;
    if (credit > 0) setBank((b) => b + credit);
    const text = folded ? "folded — ante to the house"
      : !q ? "dealer doesn't qualify — raise pushes, ante pays even"
      : cmp > 0 ? `your ${myFlush.ranks.length}-card flush wins`
      : cmp < 0 ? `dealer's ${df.ranks.length}-card flush wins`
      : "dead even — everything pushes";
    setOutcome({ text, net });
    if (net > 0) setWinKey((k) => k + 1);
    setPhase("done");
    reportStats({ inc: { flush_hands: 1 } });
  };

  const runSim = () => {
    if (simming) return;
    setSimming(true);
    setTimeout(() => {
      setEdge(hcfSimulate(20000, mulberry32((Math.random() * 2 ** 31) | 0)));
      setSimming(false);
    }, 30);
  };

  const w = Math.min(52, Math.round(((typeof window !== "undefined" ? window.innerWidth : 400) - 110) / 7));
  const litSuit = phase === "done" || phase === "decide" ? (myFlush ? myFlush.suit : null) : null;
  const dealerFlush = phase === "done" ? flushEval(dealer) : null;

  return (
    <div style={{ background: `radial-gradient(120% 60% at 50% -5%, ${CAS.room}, ${CAS.bg} 65%)`, minHeight: "var(--vh)", fontFamily: casSans, color: CAS.text, display: "flex", flexDirection: "column" }}>
      <style>{CAS_CSS}</style>
      <CasinoHeader onHelp={() => setGuideOpen(true)} title="HIGH CARD FLUSH" sub="LONGEST FLUSH WINS · PRACTICE CHIPS" bank={bank} />
      <Guide game="flush" title="HIGH CARD FLUSH" steps={HCF_GUIDE} open={guideOpen} onClose={() => setGuideOpen(false)} />

      <div style={{ flex: 1, maxWidth: 640, width: "100%", margin: "0 auto", padding: "16px 14px 26px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ ...feltPanel("18px 12px"), display: "flex", flexDirection: "column", alignItems: "center", gap: 12, overflow: "hidden" }}>
          <MarqueeLights />
          <BigWin amount={outcome && outcome.net > 0 ? outcome.net : 0} fireKey={winKey} />

          <div style={{ width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.2em", color: CAS.faint, marginBottom: 6 }}>
              DEALER{dealerFlush ? ` · ${dealerFlush.ranks.length}-CARD ${hcfQualifies(dealerFlush) ? "FLUSH" : "— NO QUALIFY"}` : " · QUALIFIES WITH 9-HIGH, 3 CARDS"}
            </div>
            <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
              {(phase === "done" ? dealer : mine.length ? new Array(7).fill(0) : []).length
                ? (phase === "done"
                    ? dealer.map((c, i) => <FCard key={i} card={c} w={Math.round(w * 0.86)} lit={dealerFlush && c.s === dealerFlush.suit && dealerFlush.ranks.includes(hiRank(c.r))} dim={dealerFlush && c.s !== dealerFlush.suit} delay={i * 60} />)
                    : new Array(7).fill(0).map((_, i) => <FCard key={i} card={{ r: 1, s: 0 }} faceDown w={Math.round(w * 0.86)} />))
                : <div style={{ fontFamily: casMono, fontSize: 11, color: CAS.faint, padding: "12px 0" }}>seven cards each — longest suit takes it</div>}
            </div>
          </div>

          <div style={{ width: "70%", height: 1, background: "rgba(245,197,66,0.18)" }} />

          <div style={{ width: "100%", textAlign: "center" }}>
            {mine.length > 0 && (
              <>
                <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                  {mine.map((c, i) => (
                    <FCard key={i} card={c} w={w}
                      lit={litSuit !== null && c.s === litSuit && myFlush.ranks.includes(hiRank(c.r))}
                      dim={litSuit !== null && c.s !== litSuit}
                      delay={i * 55} />
                  ))}
                </div>
                <div style={{ fontFamily: casMono, fontSize: 11.5, marginTop: 8, color: CAS.gold, fontWeight: 700 }}>
                  your best: {myFlush.ranks.length}-card flush, {rankLabel(myFlush.ranks[0] === 14 ? 1 : myFlush.ranks[0])} high
                </div>
              </>
            )}
            {outcome && (
              <div style={{ fontFamily: casMono, fontSize: 12, marginTop: 6, fontWeight: 700, color: outcome.net > 0 ? CAS.green : outcome.net < 0 ? CAS.dim : CAS.text }}>
                {outcome.text}{outcome.net !== 0 ? ` · ${outcome.net > 0 ? "+" : "−"}$${Math.abs(outcome.net).toLocaleString()}` : ""}
              </div>
            )}
          </div>
        </div>

        {phase === "decide" ? (
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => resolve(0)} style={{ ...casGhost(), flex: 1, color: "#ff8a80" }}>FOLD</button>
            {[1, 2, 3].filter((m) => m <= maxR).map((m) => (
              <button key={m} onClick={() => resolve(m)} disabled={ante * m > bank} style={{ ...casCta(ante * m > bank, m === maxR), flex: 1, padding: "13px 6px" }}>
                RAISE {m}× · ${(ante * m).toLocaleString()}
              </button>
            ))}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              {HCF_CHIPS.map((v) => <CasinoChip key={v} value={v} selected={chip === v} onClick={() => setChip(v)} size={42} />)}
              <div style={{ marginLeft: "auto", fontFamily: casMono, fontSize: 12, color: CAS.dim }}>
                {chip > bank ? "not enough chips" : `$${chip.toLocaleString()} ante`}
              </div>
            </div>
            <button onClick={deal} disabled={chip > bank} style={casCta(chip > bank, true)}>ANTE & DEAL · ${chip.toLocaleString()}</button>
            {bank < 5 && (
              <button onClick={() => setBank(10000)} style={{ ...casGhost(), color: CAS.gold, border: `1px solid ${CAS.goldLine}` }}>
                Felted — restake $10,000 practice chips
              </button>
            )}
          </>
        )}

        <MathNote>
          The comparator, the 9-high qualification, and every payout are exact and proven. The
          game's overall edge is NOT enumerable (the fold decision sits on 133 million deals), so
          it is simulated on your device with the printed strategy — raise max with 5+, raise with
          any 4-flush or a T-8-6 three-flush, fold worse — and labeled exactly that.{" "}
          <button onClick={runSim} disabled={simming} style={{ background: "none", border: "none", color: CAS.gold, textDecoration: "underline", cursor: "pointer", fontFamily: casMono, fontSize: 11, padding: 0 }}>
            {simming ? "simulating 20,000 hands…" : edge != null ? `house edge ≈ ${(-edge * 100).toFixed(2)}% per ante — SIMULATED · run again` : "simulate it on this device"}
          </button>
        </MathNote>
      </div>
    </div>
  );
}
