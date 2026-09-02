import React, { useState } from "react";

/* ============================================================
   PAI GOW POKER (paigow.html) — seven cards set into a five-card
   HIGH and a two-card LOW (the high must outrank the low). Beat
   the dealer's both to win (5% commission, printed); split is a
   push; copies — exact ties — go to the banker, as they do in
   every casino on earth. 52 cards, no joker (stated plainly).
   The dealer sets by a DOCUMENTED house way: among all 21 legal
   splits, maximize the two-card hand; break ties by the stronger
   five-card hand. It's pure and verifiable, and the HOUSE WAY
   button gives you the exact same set.
   HONESTY NOTE (Known vs Estimated): full Pai Gow enumeration is
   computationally infeasible, so the edge shown here is
   SIMULATED on your device and labeled as such — never dressed
   up as enumerated. Practice chips only.
   Pure functions (score2, legalSplits, houseWay, comparePaiGow,
   settlePaiGow, simulateEdge) are top-level so
   engine/verify_paigow.js can eval this page and re-prove them.
   Uses score5H/hiRank/fullDeck/cardId from the shared engine.
   ============================================================ */

/* Two-card hand: a pair beats any no-pair; then high card, then kicker. */
function score2(cards2) {
  const a = hiRank(cards2[0].r), b = hiRank(cards2[1].r);
  if (a === b) return 1000000 + a;
  return Math.max(a, b) * 15 + Math.min(a, b);
}

/* All C(7,2)=21 ways to send two cards to the low, keeping the split LEGAL
 * (five-card high must outrank... the low can never beat the high; a pair in
 * front with nothing behind is a foul). Returns [{low, high, s2, s5}]. */
function legalSplits(cards7) {
  const out = [];
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 7; j++) {
    const low = [cards7[i], cards7[j]];
    const high = cards7.filter((_, k) => k !== i && k !== j);
    const s5 = score5H(high);
    const s2 = score2(low);
    // Foul test: the five-card hand must be at least a pair of the low's pair
    // rank, or simply outrank the low as poker hands. Compare on a common
    // scale: a two-card pair of rank r == a five-card "pair of r" front.
    const lowAsFive = s2 >= 1000000
      ? 1 * Math.pow(16, 5) + (s2 - 1000000) * Math.pow(16, 4)  // pair, no kickers
      : 0 * Math.pow(16, 5) + Math.max(hiRank(low[0].r), hiRank(low[1].r)) * Math.pow(16, 4) + Math.min(hiRank(low[0].r), hiRank(low[1].r)) * Math.pow(16, 3);
    if (s5 > lowAsFive) out.push({ low, high, s2, s5 });
  }
  return out;
}

/* The house way, documented: maximize the LOW among legal splits; break ties
 * with the stronger HIGH. Simple, strong, and — unlike casino rule sheets —
 * checkable by a script. */
function houseWay(cards7) {
  const splits = legalSplits(cards7);
  let best = splits[0];
  for (const s of splits) {
    if (s.s2 > best.s2 || (s.s2 === best.s2 && s.s5 > best.s5)) best = s;
  }
  return best;
}

/* Player vs dealer, casino rules: copies (exact ties) go to the banker. */
function comparePaiGow(player, dealer) {
  const highWin = player.s5 > dealer.s5;   // tie -> banker
  const lowWin = player.s2 > dealer.s2;    // tie -> banker
  return { highWin, lowWin };
}

/* Settlement on a 1-unit bet: win both -> +0.95 (the 5% commission, printed);
 * split -> push (0); lose both or any copy-caused loss -> -1.
 * Returns the amount CREDITED back for a given stake (stake was deducted). */
function settlePaiGow(cmp, stake) {
  if (cmp.highWin && cmp.lowWin) return stake + Math.round(stake * 0.95 * 100) / 100; // stake + winnings less 5%
  if (!cmp.highWin && !cmp.lowWin) return 0;
  return stake; // one each — push
}

/* The edge, SIMULATED (labeled as such wherever shown): both sides set by the
 * house way, n random deals, returns mean net per unit. */
function simulateEdge(n, rng) {
  let net = 0;
  for (let t = 0; t < n; t++) {
    const d = fullDeck();
    for (let i = d.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; [d[i], d[j]] = [d[j], d[i]]; }
    const cmp = comparePaiGow(houseWay(d.slice(0, 7)), houseWay(d.slice(7, 14)));
    net += settlePaiGow(cmp, 1) - 1;
  }
  return net / n;
}

/* ==================== VIEW (casino design kit) ==================== */

const PG_BANK_KEY = "poker-trainer:paigowBank";
function loadPgBank() {
  try {
    const raw = window.localStorage.getItem(PG_BANK_KEY);
    if (raw == null) return 1000;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? v : 1000;
  } catch { return 1000; }
}
const PG_CHIPS = [5, 25, 100];

function PgCard({ card, w, picked, dim, onClick, faceDown }) {
  const red = isRed(card.s);
  return (
    <button onClick={onClick} disabled={!onClick} style={{
      width: w, height: Math.round(w * 1.42), borderRadius: Math.max(8, w * 0.13), padding: 0,
      background: faceDown
        ? "repeating-linear-gradient(45deg, #1c2733, #1c2733 5px, #141b24 5px, #141b24 10px)"
        : "linear-gradient(160deg, #fdfcf7, #efece1 70%, #ddd8c8)",
      border: picked ? `2.5px solid ${CAS.gold}` : "1px solid rgba(0,0,0,0.35)",
      color: red ? "#c62828" : "#161a22", cursor: onClick ? "pointer" : "default",
      boxShadow: picked ? `0 0 14px ${CAS.goldFaint}, 0 6px 12px rgba(0,0,0,0.5)` : "0 5px 12px rgba(0,0,0,0.5)",
      transform: picked ? "translateY(-10px)" : "none", transition: "transform 140ms ease, box-shadow 140ms ease",
      position: "relative", fontFamily: casSans, opacity: dim ? 0.55 : 1, flex: "0 0 auto",
    }}>
      {!faceDown && (
        <>
          <span style={{ position: "absolute", top: w * 0.07, left: w * 0.1, fontSize: w * 0.3, fontWeight: 900, lineHeight: 1 }}>{rankLabel(card.r)}</span>
          <span style={{ position: "absolute", bottom: w * 0.06, right: w * 0.08, fontSize: w * 0.44, lineHeight: 1 }}>{SUIT[card.s]}</span>
        </>
      )}
    </button>
  );
}

const pgHandName = (s5) => HOLDEM_CATS[Math.floor(s5 / Math.pow(16, 5))];
const pgLowName = (cards2) => {
  const s = score2(cards2);
  return s >= 1000000 ? `pair of ${rankLabel(cards2[0].r)}s` : `${rankLabel(cards2[0].r)}-${rankLabel(cards2[1].r)} high`;
};

export default function PaiGow() {
  const [bank, setBank] = React.useState(loadPgBank);
  const [chip, setChip] = React.useState(25);
  const [bet, setBet] = React.useState(0);
  const [phase, setPhase] = React.useState("bet"); // bet | set | done
  const [hand, setHand] = React.useState(null);      // my 7
  const [dealerSet, setDealerSet] = React.useState(null);
  const [picked, setPicked] = React.useState([]);    // indexes chosen for the low
  const [outcome, setOutcome] = React.useState(null); // {cmp, credit, mySplit}
  const [winKey, setWinKey] = React.useState(0);
  const [edge, setEdge] = React.useState(null);
  const [simming, setSimming] = React.useState(false);

  React.useEffect(() => { try { window.localStorage.setItem(PG_BANK_KEY, String(bank)); } catch { /* private */ } }, [bank]);

  const deal = () => {
    // One chip per deal, exactly as the rail copy says.
    if (phase === "set" || chip > bank) return;
    setOutcome(null);
    setBank((b) => b - chip);
    setBet(chip);
    const d = fullDeck();
    for (let i = d.length - 1; i > 0; i--) { const j = ((Math.random() * (i + 1)) | 0); [d[i], d[j]] = [d[j], d[i]]; }
    setHand(d.slice(0, 7).sort((a, b) => hiRank(b.r) - hiRank(a.r) || a.s - b.s));
    setDealerSet(houseWay(d.slice(7, 14)));
    setPicked([]);
    setPhase("set");
  };

  const togglePick = (i) => {
    if (phase !== "set") return;
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : p.length < 2 ? [...p, i] : p));
  };

  const currentSplit = () => {
    if (picked.length !== 2) return null;
    const low = picked.map((i) => hand[i]);
    const high = hand.filter((_, i) => !picked.includes(i));
    const s5 = score5H(high), s2 = score2(low);
    const legal = legalSplits(hand).some((sp) => score2(sp.low) === s2 && sp.s5 === s5 &&
      sp.low.every((c) => low.some((l) => cardId(l) === cardId(c))));
    return { low, high, s2, s5, legal };
  };

  const useHouseWay = () => {
    if (phase !== "set") return;
    const hw = houseWay(hand);
    setPicked(hand.map((c, i) => (hw.low.some((l) => cardId(l) === cardId(c)) ? i : -1)).filter((i) => i >= 0));
  };

  const confirm = () => {
    const mine = currentSplit();
    if (!mine || !mine.legal) return;
    const cmp = comparePaiGow(mine, dealerSet);
    const credit = settlePaiGow(cmp, bet);
    setBank((b) => b + credit);
    if (credit > bet) setWinKey((k) => k + 1);
    setOutcome({ cmp, credit, mySplit: mine });
    setPhase("done");
  };

  const runSim = () => {
    if (simming) return;
    setSimming(true);
    setTimeout(() => {
      const e = simulateEdge(4000, mulberry32((Math.random() * 2 ** 31) | 0));
      setEdge(e);
      setSimming(false);
    }, 30);
  };

  const mine = phase === "set" ? currentSplit() : outcome ? outcome.mySplit : null;
  const net = outcome ? outcome.credit - bet : 0;
  const w = Math.min(62, Math.round(((typeof window !== "undefined" ? window.innerWidth : 400) - 112) / 7));

  return (
    <div style={{ background: `radial-gradient(120% 60% at 50% -5%, ${CAS.room}, ${CAS.bg} 65%)`, minHeight: "100vh", fontFamily: casSans, color: CAS.text, display: "flex", flexDirection: "column" }}>
      <style>{CAS_CSS}</style>
      <CasinoHeader title="PAI GOW POKER" sub="SET FIVE HIGH · TWO LOW · 5% COMMISSION, PRINTED · PRACTICE CHIPS" bank={bank} />

      <div style={{ flex: 1, maxWidth: 640, width: "100%", margin: "0 auto", padding: "16px 14px 26px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ ...feltPanel("18px 14px"), display: "flex", flexDirection: "column", alignItems: "center", gap: 12, overflow: "hidden" }}>
          <BigWin amount={net > 0 ? net : 0} fireKey={winKey} />

          {/* dealer */}
          <div style={{ width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.2em", color: CAS.faint, marginBottom: 6 }}>DEALER · SETS BY THE HOUSE WAY</div>
            <div style={{ display: "flex", gap: 5, justifyContent: "center" }}>
              {phase === "done" && dealerSet ? (
                <>
                  {dealerSet.low.map((c) => <PgCard key={cardId(c)} card={c} w={Math.round(w * 0.82)} />)}
                  <span style={{ width: 10 }} />
                  {dealerSet.high.map((c) => <PgCard key={cardId(c)} card={c} w={Math.round(w * 0.82)} />)}
                </>
              ) : (
                Array.from({ length: 7 }, (_, i) => <PgCard key={i} card={{ r: 1, s: 0 }} faceDown w={Math.round(w * 0.82)} />)
              )}
            </div>
            {phase === "done" && dealerSet && (
              <div style={{ fontFamily: casMono, fontSize: 10.5, color: CAS.dim, marginTop: 5 }}>
                low: {pgLowName(dealerSet.low)} · high: {pgHandName(dealerSet.s5)}
              </div>
            )}
          </div>

          <div style={{ width: "70%", height: 1, background: "rgba(245,197,66,0.18)" }} />

          {/* me */}
          <div style={{ width: "100%", textAlign: "center" }}>
            {hand ? (
              <>
                <div style={{ display: "flex", gap: 5, justifyContent: "center", paddingTop: 10 }}>
                  {hand.map((c, i) => (
                    <PgCard key={cardId(c)} card={c} w={w} picked={picked.includes(i)}
                      onClick={phase === "set" ? () => togglePick(i) : undefined} />
                  ))}
                </div>
                <div style={{ fontFamily: casMono, fontSize: 11, color: mine && !mine.legal ? "#ff8a80" : CAS.dim, marginTop: 8, minHeight: 16 }}>
                  {phase === "set"
                    ? picked.length < 2
                      ? `tap ${2 - picked.length} card${picked.length === 1 ? "" : "s"} for your LOW hand`
                      : mine && mine.legal
                        ? `low: ${pgLowName(mine.low)} · high: ${pgHandName(mine.s5)} — set it`
                        : "FOUL — your low would beat your high. Pick again."
                    : mine
                      ? `low: ${pgLowName(mine.low)} · high: ${pgHandName(mine.s5)}`
                      : ""}
                </div>
              </>
            ) : (
              <div style={{ fontFamily: casMono, fontSize: 12, color: CAS.faint, padding: "22px 0" }}>
                place a bet and deal — seven cards, two hands, one decision
              </div>
            )}
          </div>

          {phase === "done" && outcome && (
            <div style={{
              animation: "casPop 300ms ease both", textAlign: "center", borderRadius: 12, padding: "8px 18px",
              background: net > 0 ? "rgba(0,230,118,0.1)" : net === 0 ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.3)",
              border: `1px solid ${net > 0 ? "rgba(0,230,118,0.4)" : CAS.line}`,
            }}>
              <div style={{ fontWeight: 900, fontSize: 15, color: net > 0 ? CAS.green : net === 0 ? CAS.dim : CAS.dim }}>
                {net > 0 ? `WIN BOTH — +$${net.toLocaleString()} after the 5%` : net === 0 ? "SPLIT — push" : "dealer takes it"}
              </div>
              <div style={{ fontFamily: casMono, fontSize: 10.5, color: CAS.faint, marginTop: 3 }}>
                high {outcome.cmp.highWin ? "won" : "lost (copies go to the banker)"} · low {outcome.cmp.lowWin ? "won" : "lost"}
              </div>
            </div>
          )}
        </div>

        {/* controls */}
        <div style={{ display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
          {PG_CHIPS.map((v) => <CasinoChip key={v} value={v} selected={chip === v} onClick={() => setChip(v)} />)}
          <span style={{ marginLeft: "auto", fontFamily: casMono, fontSize: 12, color: CAS.dim }}>
            {phase === "set" ? `$${bet.toLocaleString()} riding` : "bet = one chip per deal"}
          </span>
        </div>
        {phase === "set" ? (
          <div style={{ display: "grid", gridTemplateColumns: "1.6fr 1.4fr", gap: 8 }}>
            <button onClick={confirm} disabled={!mine || !mine.legal} style={casCta(!mine || !mine.legal)}>SET HANDS</button>
            <button onClick={useHouseWay} style={casGhost()}>HOUSE WAY</button>
          </div>
        ) : (
          <button onClick={deal} disabled={chip > bank} style={casCta(chip > bank)}>DEAL · ${chip}</button>
        )}
        {bank === 0 && phase !== "set" && (
          <button onClick={() => setBank(1000)} style={{ ...casGhost(), color: CAS.gold, border: `1px solid ${CAS.goldLine}` }}>
            Felted — restake $1,000 practice chips
          </button>
        )}
        <div style={{
          background: CAS.panel, border: `1px solid ${CAS.line}`, borderRadius: 10,
          padding: "9px 13px", fontSize: 11, fontFamily: casMono, color: CAS.dim, lineHeight: 1.6,
        }}>
          {edge != null
            ? <>house edge ≈ <b style={{ color: CAS.gold }}>{(-edge * 100).toFixed(2)}%</b> — <b>SIMULATED</b> (4,000 hands on this device, both sides house-way). Not enumerated: full Pai Gow enumeration is infeasible, and we don't dress estimates as facts.</>
            : <>Pai Gow's edge can't be enumerated like the other tables — <button onClick={runSim} disabled={simming} style={{ background: "none", border: "none", color: CAS.gold, textDecoration: "underline", cursor: "pointer", fontFamily: casMono, fontSize: 11, padding: 0 }}>{simming ? "simulating…" : "simulate it on your device"}</button> and it will be labeled as exactly that.</>}
          {" "}52 cards, no joker — stated plainly. Practice chips only.
        </div>
      </div>
    </div>
  );
}
