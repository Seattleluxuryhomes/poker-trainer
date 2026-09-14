import React, { useState, useEffect } from "react";

/* ============================================================
   BACCARAT (bac.html) — punto banco from a fresh 8-deck shoe
   every hand, and the house philosophy at its purest: the
   drawing rules (the tableau) are FIXED, nobody makes a
   decision after the bets, so every probability is EXACTLY
   enumerable — and this page enumerates them, on your device,
   from the actual shoe composition: P(Player), P(Banker),
   P(Tie), and each bet's edge, printed on the felt. Banker
   wins pay 19:20 (the 5% commission, floored to the dollar and
   printed). Tie pays 8:1 — and its edge is printed too, which
   is why nobody who reads this felt ever bets it.
   Practice chips only; the wallet rides the whole floor.
   Pure functions (bacShoe … bacSettle) are top-level so
   engine/verify_baccarat.js can eval this page and re-prove
   every number.
   ============================================================ */

/* ---- the shoe, by card VALUE: v[0] = tens+faces, v[1..9] = pips ---- */
function bacShoe(decks = 8) {
  const v = new Array(10).fill(4 * decks);
  v[0] = 16 * decks; // 10, J, Q, K all count zero
  return v;
}
const bacVal = (r) => (r >= 10 ? 0 : r); // card rank 1..13 -> baccarat value

/* ---- the tableau, verbatim (the fixed drawing rules of punto banco) ---- */
const playerDraws = (pt) => pt <= 5;
function bankerDraws(bt, ptc) {
  // ptc: the player's THIRD card value, or null if the player stood
  if (ptc === null) return bt <= 5;
  if (bt <= 2) return true;
  if (bt === 3) return ptc !== 8;
  if (bt === 4) return ptc >= 2 && ptc <= 7;
  if (bt === 5) return ptc >= 4 && ptc <= 7;
  if (bt === 6) return ptc === 6 || ptc === 7;
  return false;
}

/* ---- EXACT enumeration over the shoe: every possible hand, weighted by
 * real drawing probabilities. At most six cards leave the shoe, so this is
 * a six-deep weighted walk — about a million paths, exact to the last one. */
function bacEnumerate(shoe) {
  let pPlayer = 0, pBanker = 0, pTie = 0;
  const v = shoe.slice();
  const total0 = v.reduce((a, b) => a + b, 0);

  // explicit nested walk (clearer than recursion here, and exact)
  for (let p1 = 0; p1 <= 9; p1++) {
    if (!v[p1]) continue;
    const w1 = v[p1] / total0; v[p1]--;
    for (let b1 = 0; b1 <= 9; b1++) {
      if (!v[b1]) continue;
      const w2 = w1 * v[b1] / (total0 - 1); v[b1]--;
      for (let p2 = 0; p2 <= 9; p2++) {
        if (!v[p2]) continue;
        const w3 = w2 * v[p2] / (total0 - 2); v[p2]--;
        for (let b2 = 0; b2 <= 9; b2++) {
          if (!v[b2]) continue;
          const w4 = w3 * v[b2] / (total0 - 3); v[b2]--;
          const pt0 = (p1 + p2) % 10, bt0 = (b1 + b2) % 10;
          if (pt0 >= 8 || bt0 >= 8) {
            // a natural freezes both hands
            if (pt0 > bt0) pPlayer += w4; else if (bt0 > pt0) pBanker += w4; else pTie += w4;
          } else if (!playerDraws(pt0)) {
            if (!bankerDraws(bt0, null)) {
              if (pt0 > bt0) pPlayer += w4; else if (bt0 > pt0) pBanker += w4; else pTie += w4;
            } else {
              for (let b3 = 0; b3 <= 9; b3++) {
                if (!v[b3]) continue;
                const w5 = w4 * v[b3] / (total0 - 4);
                const bt = (bt0 + b3) % 10;
                if (pt0 > bt) pPlayer += w5; else if (bt > pt0) pBanker += w5; else pTie += w5;
              }
            }
          } else {
            for (let p3 = 0; p3 <= 9; p3++) {
              if (!v[p3]) continue;
              const w5 = w4 * v[p3] / (total0 - 4); v[p3]--;
              const pt = (pt0 + p3) % 10;
              if (!bankerDraws(bt0, p3)) {
                if (pt > bt0) pPlayer += w5; else if (bt0 > pt) pBanker += w5; else pTie += w5;
              } else {
                for (let b3 = 0; b3 <= 9; b3++) {
                  if (!v[b3]) continue;
                  const w6 = w5 * v[b3] / (total0 - 5);
                  const bt = (bt0 + b3) % 10;
                  if (pt > bt) pPlayer += w6; else if (bt > pt) pBanker += w6; else pTie += w6;
                }
              }
              v[p3]++;
            }
          }
          v[b2]++;
        }
        v[p2]++;
      }
      v[b1]++;
    }
    v[p1]++;
  }
  return { pPlayer, pBanker, pTie };
}

/* Per-dollar EVs, straight from the enumerated probabilities. */
function bacEdges(probs) {
  const { pPlayer, pBanker, pTie } = probs;
  return {
    player: pPlayer - pBanker,                       // even money, tie pushes
    banker: 0.95 * pBanker - pPlayer,                // 19:20 after commission
    tie: 8 * pTie - (pPlayer + pBanker),             // 8:1
  };
}

/* Settlement: credits returned per outcome (stakes deducted when placed).
 * Banker commission floors to the dollar, and the felt says so. */
function bacSettle(outcome, bets) {
  let credit = 0;
  if (outcome === "player") credit += bets.player * 2;
  if (outcome === "banker") credit += bets.banker + Math.floor(bets.banker * 0.95);
  if (outcome === "tie") {
    credit += bets.tie * 9;
    credit += bets.player + bets.banker; // main bets push on a tie
  }
  return credit;
}

/* ==================== VIEW (casino design kit) ==================== */

const BAC_GUIDE = [
  { h: "Two hands, neither is yours", p: "PLAYER and BANKER are just labels — the casino deals both by fixed rules and you bet on which side gets closer to 9. Tens and faces count zero, aces count one, totals wrap past nine (7+8 = 15 = 5)." },
  { h: "Nobody decides anything", p: "After the bets, every draw is forced by the tableau — the fixed rule sheet printed on this page's feed as it happens. No skill, no choices, no tells. That's exactly why every probability here is EXACT.", tag: "FULLY ENUMERATED" },
  { h: "Why banker costs 5%", p: "The banker hand draws LAST, so the rules give it a small structural advantage — it wins about 45.9% of hands to the player's 44.6%. The house charges 5% commission on banker wins to claw that back. Both edges are printed on the spots." },
  { h: "The tie is a trap, and it says so", p: "TIE pays 8:1 but happens far less often than 1-in-9 — its edge is printed right on the spot, about ten times worse than the other two bets. This casino offers it because real ones do; the felt just refuses to hide what it costs.", tag: "READ THE EDGE BEFORE YOU TAP" },
  { h: "Fresh shoe, exact numbers", p: "Every hand deals from a fresh 8-deck shoe, and the probabilities on the spots are enumerated from that exact shoe on your device — about a million weighted paths through the tableau, no simulation. Practice chips only.", tag: "PRACTICE CHIPS ONLY" },
];

const BAC_CHIPS = [5, 25, 100, 500, 1000];

function BacCard({ card, w, delay = 0 }) {
  const red = isRed(card.s);
  return (
    <div style={{
      width: w, height: Math.round(w * 1.42), borderRadius: Math.max(8, w * 0.13), flex: "0 0 auto",
      background: "linear-gradient(160deg, #fdfcf7, #efece1 70%, #ddd8c8)",
      border: "1px solid rgba(0,0,0,0.35)", color: red ? "#c62828" : "#161a22",
      boxShadow: "0 5px 12px rgba(0,0,0,0.5)", position: "relative", fontFamily: casSans,
      animation: `casChipDrop 300ms ease ${delay}ms both`,
    }}>
      <span style={{ position: "absolute", top: w * 0.07, left: w * 0.1, fontSize: w * 0.3, fontWeight: 900, lineHeight: 1 }}>{rankLabel(card.r)}</span>
      <span style={{ position: "absolute", bottom: w * 0.06, right: w * 0.08, fontSize: w * 0.44, lineHeight: 1 }}>{SUIT[card.s]}</span>
    </div>
  );
}

export default function Baccarat() {
  const [guideOpen, setGuideOpen] = useState(() => guideUnseen("bac"));
  const [bank, setBank] = useState(walletLoad);
  const [chip, setChip] = useState(25);
  const [bets, setBets] = useState({ player: 0, banker: 0, tie: 0 });
  const [phase, setPhase] = useState("bet"); // bet | dealing | done
  const [pCards, setPCards] = useState([]);
  const [bCards, setBCards] = useState([]);
  const [outcome, setOutcome] = useState(null);
  const [feed, setFeed] = useState(["place your bets — the tableau does the rest"]);
  const [winKey, setWinKey] = useState(0);
  const [winAmt, setWinAmt] = useState(0);
  const [lastBets, setLastBets] = useState(null);

  useEffect(() => { walletSave(bank); }, [bank]);

  // the exact numbers for a fresh shoe, computed once per page load
  const probs = React.useMemo(() => bacEnumerate(bacShoe(8)), []);
  const edges = React.useMemo(() => bacEdges(probs), [probs]);
  const staked = bets.player + bets.banker + bets.tie;

  const put = (spot) => {
    if (phase === "dealing" || chip > bank) return;
    sfx.chip();
    setBank((b) => b - chip);
    setBets((x) => ({ ...x, [spot]: x[spot] + chip }));
  };
  const clearBets = () => {
    if (phase === "dealing" || staked === 0) return;
    sfx.chips(2);
    setBank((b) => b + staked);
    setBets({ player: 0, banker: 0, tie: 0 });
  };
  const say = (lines) => setFeed((f) => [...f, ...lines].slice(-40));

  const total = (cards) => cards.reduce((a, c) => a + bacVal(c.r), 0) % 10;

  const deal = () => {
    if (phase === "dealing" || staked === 0) { if (staked === 0) say(["Nothing on the felt yet."]); return; }
    setPhase("dealing"); setOutcome(null); setLastBets({ ...bets });
    const d = fullDeck().concat(fullDeck(), fullDeck(), fullDeck(), fullDeck(), fullDeck(), fullDeck(), fullDeck());
    for (let i = d.length - 1; i > 0; i--) { const j = ((Math.random() * (i + 1)) | 0); [d[i], d[j]] = [d[j], d[i]]; }
    const P = [d[0], d[2]], B = [d[1], d[3]];
    let next = 4;
    sfx.cards(4);
    setPCards(P.slice()); setBCards(B.slice());
    const lines = [`— Player ${total(P)}, Banker ${total(B)}`];

    const finish = (Pf, Bf, extra) => {
      const pt = total(Pf), bt = total(Bf);
      const out = pt > bt ? "player" : bt > pt ? "banker" : "tie";
      const credit = bacSettle(out, bets);
      const net = credit - staked;
      setTimeout(() => {
        setPCards(Pf); setBCards(Bf);
        setOutcome(out);
        if (credit > 0) setBank((b) => b + credit);
        say([...lines, ...extra, `${out === "tie" ? "TIE" : out.toUpperCase() + " wins"} ${pt}–${bt}` + (out === "banker" && bets.banker > 0 ? ` (commission floored: +$${Math.floor(bets.banker * 0.95)})` : "")]);
        if (net > 0) { setWinAmt(net); setWinKey((k) => k + 1); }
        setBets({ player: 0, banker: 0, tie: 0 });
        setPhase("done");
      }, 900);
    };

    const pt0 = total(P), bt0 = total(B);
    if (pt0 >= 8 || bt0 >= 8) { finish(P, B, [`NATURAL ${Math.max(pt0, bt0)} — both hands stand`]); return; }
    const extra = [];
    let Pf = P.slice(), Bf = B.slice(), ptc = null;
    if (playerDraws(pt0)) {
      const c = d[next++]; Pf.push(c); ptc = bacVal(c.r);
      extra.push(`Player draws on ${pt0}: ${rankLabel(c.r)}${SUIT[c.s]} → ${total(Pf)}`);
      setTimeout(() => { sfx.card(); setPCards(Pf.slice()); }, 350);
    } else extra.push(`Player stands on ${pt0}`);
    if (bankerDraws(bt0, ptc)) {
      const c = d[next++]; Bf.push(c);
      extra.push(`Banker draws on ${bt0}${ptc !== null ? ` vs third card ${ptc}` : ""}: ${rankLabel(c.r)}${SUIT[c.s]} → ${total(Bf)}`);
      setTimeout(() => { sfx.card(); setBCards(Bf.slice()); }, 650);
    } else extra.push(`Banker stands on ${bt0}${ptc !== null ? ` vs third card ${ptc}` : ""} — the tableau says stand`);
    finish(Pf, Bf, extra);
  };

  const rebet = () => {
    if (phase === "dealing" || !lastBets) return;
    const need = lastBets.player + lastBets.banker + lastBets.tie;
    if (need > bank + staked) return;
    sfx.chips(3);
    setBank((b) => b + staked - need);
    setBets({ ...lastBets });
  };

  const w = Math.min(58, Math.round(((typeof window !== "undefined" ? window.innerWidth : 400) - 140) / 6));
  const pct = (x) => (x * 100).toFixed(2) + "%";
  const spot = (key, title, pays, edge) => (
    <button onClick={() => put(key)} disabled={phase === "dealing"} style={{
      flex: 1, minWidth: 100, position: "relative", textAlign: "center", padding: "13px 8px 10px", borderRadius: 13, cursor: "pointer",
      border: `1.5px solid ${bets[key] > 0 ? CAS.gold : "rgba(245,197,66,0.18)"}`,
      background: bets[key] > 0 ? "linear-gradient(180deg, rgba(245,197,66,0.14), rgba(245,197,66,0.05))" : "rgba(255,255,255,0.045)",
      color: CAS.cream, fontFamily: casSans,
      boxShadow: bets[key] > 0 ? `0 0 14px ${CAS.goldFaint}` : "inset 0 -2px 0 rgba(0,0,0,0.25)",
      outline: outcome === key ? `2px solid ${CAS.gold}` : "none",
    }}>
      <div style={{ fontSize: 14.5, fontWeight: 900, letterSpacing: "0.08em" }}>{title}</div>
      <div style={{ fontSize: 10, fontFamily: casMono, color: CAS.dim, marginTop: 3 }}>
        pays {pays} · P {pct(key === "player" ? probs.pPlayer : key === "banker" ? probs.pBanker : probs.pTie)}
      </div>
      <div style={{ fontSize: 10, fontFamily: casMono, color: key === "tie" ? "#ff8a80" : CAS.goldDim, fontWeight: 700, marginTop: 2 }}>
        edge {pct(-edge)} · enumerated
      </div>
      {bets[key] > 0 && <div style={{ position: "absolute", top: -9, right: -4 }}><BetChip amount={bets[key]} /></div>}
    </button>
  );

  return (
    <div style={{ background: `radial-gradient(120% 60% at 50% -5%, ${CAS.room}, ${CAS.bg} 65%)`, minHeight: "var(--vh)", fontFamily: casSans, color: CAS.text, display: "flex", flexDirection: "column" }}>
      <style>{CAS_CSS}</style>
      <CasinoHeader onHelp={() => setGuideOpen(true)} title="BACCARAT" sub="PUNTO BANCO · PRACTICE CHIPS" bank={bank} />
      <Guide game="bac" title="BACCARAT" steps={BAC_GUIDE} open={guideOpen} onClose={() => setGuideOpen(false)} />

      <div style={{ flex: 1, maxWidth: 640, width: "100%", margin: "0 auto", padding: "16px 14px 26px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ ...feltPanel("18px 14px"), display: "flex", flexDirection: "column", alignItems: "center", gap: 12, overflow: "hidden" }}>
          <MarqueeLights />
          <BigWin amount={winAmt} fireKey={winKey} />

          {[["BANKER", bCards], ["PLAYER", pCards]].map(([label, cards]) => (
            <div key={label} style={{ width: "100%", textAlign: "center" }}>
              <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.2em", color: outcome === label.toLowerCase() ? CAS.gold : CAS.faint, marginBottom: 6 }}>
                {label}{cards.length ? ` · ${total(cards)}` : ""}{outcome === label.toLowerCase() ? " · WINS" : ""}
              </div>
              <div style={{ display: "flex", gap: 6, justifyContent: "center", minHeight: Math.round(w * 1.42) }}>
                {cards.length
                  ? cards.map((c, i) => <BacCard key={`${label}${i}`} card={c} w={w} delay={i * 80} />)
                  : <div style={{ fontFamily: casMono, fontSize: 11, color: CAS.faint, alignSelf: "center" }}>{label === "BANKER" ? "the shoe is ready" : " "}</div>}
              </div>
            </div>
          ))}
          {outcome === "tie" && (
            <div style={{ fontFamily: casMono, fontSize: 12, fontWeight: 700, color: CAS.gold }}>TIE — main bets push</div>
          )}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          {spot("player", "PLAYER", "1:1", edges.player)}
          {spot("banker", "BANKER", "19:20", edges.banker)}
          {spot("tie", "TIE", "8:1", edges.tie)}
        </div>

        <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
          {BAC_CHIPS.map((v) => <CasinoChip key={v} value={v} selected={chip === v} onClick={() => setChip(v)} size={42} />)}
          <span style={{ marginLeft: "auto", fontFamily: casMono, fontSize: 12, color: CAS.dim }}>
            {staked > 0 ? `$${staked.toLocaleString()} on the felt` : "place your bets"}
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
          <button onClick={deal} disabled={phase === "dealing" || staked === 0} style={casCta(phase === "dealing" || staked === 0, staked > 0)}>DEAL</button>
          <button onClick={clearBets} disabled={phase === "dealing" || staked === 0} style={casGhost()}>CLEAR</button>
          <button onClick={rebet} disabled={phase === "dealing" || !lastBets} style={casGhost()}>REBET</button>
        </div>
        {bank === 0 && staked === 0 && (
          <button onClick={() => setBank(10000)} style={{ ...casGhost(), color: CAS.gold, border: `1px solid ${CAS.goldLine}` }}>
            Felted — restake $10,000 practice chips
          </button>
        )}

        <div style={{ background: CAS.panel, border: `1px solid ${CAS.line}`, borderRadius: 12, padding: "10px 13px", fontFamily: casMono, fontSize: 11, lineHeight: 1.7, color: CAS.dim, maxHeight: 120, overflowY: "auto", display: "flex", flexDirection: "column-reverse" }}>
          <div>{feed.map((l, i) => <div key={i}>{l}</div>)}</div>
        </div>

        <MathNote>
          Every number above is enumerated, not estimated: all six-card paths through the tableau,
          weighted by the exact 8-deck shoe, computed on your device. Fresh shoe every hand. Banker
          commission is 5%, floored to the dollar. Practice chips only.
        </MathNote>
      </div>
    </div>
  );
}
