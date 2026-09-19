import React, { useState, useEffect } from "react";

/* ============================================================
   SPANISH 21 (sp21.html) — blackjack's wilder cousin, on a
   48-card Spanish deck: all four 10-spot cards removed (jacks,
   queens, kings stay). The removals help the house; the rules
   give it back to the player: YOUR 21 ALWAYS WINS, your
   blackjack always wins and pays 3:2, and 21s made of many
   cards pay bonuses — 5 cards 3:2, 6 cards 2:1, 7+ 3:1, and
   6-7-8 or 7-7-7 pays 3:2 mixed / 2:1 suited / 3:1 in spades.
   Same house law as blackjack: STAND / HIT / DOUBLE each print
   their EXACT expected value, recomputed live by recursion
   over the cards actually left in this deck. The count
   bonuses are IN that math exactly; the suited 6-7-8/7-7-7
   premiums are paid in play but priced at the mixed rate in
   the EV (suits multiply the state space) — the one ≈, and it
   says so. Doubling voids bonuses (the classic rule), and the
   math knows that too. Dealer stands on all 17s; double on
   any first two; split once (aces one card); single deck,
   reshuffled every hand. Practice chips only.
   Pure functions (sp21Counts … sp21Payout) are top-level for
   engine/verify_sp21.js.
   ============================================================ */

/* ---- the Spanish deck, by value: no tens, faces remain ---- */
function sp21Counts() {
  const c = new Array(11).fill(0);
  for (let v = 1; v <= 9; v++) c[v] = 4;
  c[10] = 12; // J, Q, K only
  return c;
}
const sp21CardsLeft = (c) => c.reduce((a, b) => a + b, 0);
const sp21Val = (card) => Math.min(10, card.r);

function sp21Total(vals) {
  let t = 0, aces = 0;
  for (const v of vals) { t += v; if (v === 1) aces++; }
  if (aces > 0 && t + 10 <= 21) return { total: t + 10, soft: true };
  return { total: t, soft: false };
}

/* The 21 bonus rate (per unit bet, on top of the stake) for an UNDOUBLED 21.
 * Count bonuses: 5 cards 3:2, 6 cards 2:1, 7+ 3:1. Three-card 6-7-8 and
 * 7-7-7 pay 3:2 here (the mixed rate; suits are handled at settlement). */
function sp21BonusRate(vals) {
  const { total } = sp21Total(vals);
  if (total !== 21) return 0;
  const n = vals.length;
  if (n >= 7) return 3;
  if (n === 6) return 2;
  if (n === 5) return 1.5;
  if (n === 3) {
    const s = vals.slice().sort((a, b) => a - b).join(",");
    if (s === "6,7,8" || s === "7,7,7") return 1.5;
  }
  return 1;
}

/* Dealer distribution, S17, conditioned on the peek — the blackjack engine's
 * pattern on the Spanish composition. */
function sp21DealerDist(counts, dealerVals, conditionNoBj) {
  const memo = new Map();
  const recurse = (cts, vals) => {
    const { total, soft } = sp21Total(vals);
    if (total > 21) return [0, 0, 0, 0, 0, 1];
    if (total >= 17) { const out = [0, 0, 0, 0, 0, 0]; out[total - 17] = 1; return out; }
    const key = total * 2 + (soft ? 1 : 0) + ":" + cts.join(",");
    const hit = memo.get(key);
    if (hit) return hit;
    const n = sp21CardsLeft(cts);
    const out = [0, 0, 0, 0, 0, 0];
    for (let v = 1; v <= 10; v++) {
      if (cts[v] === 0) continue;
      const p = cts[v] / n;
      cts[v]--;
      const sub = recurse(cts, vals.concat(v));
      cts[v]++;
      for (let i = 0; i < 6; i++) out[i] += p * sub[i];
    }
    memo.set(key, out);
    return out;
  };
  const cts = counts.slice();
  if (conditionNoBj && dealerVals.length === 1 && (dealerVals[0] === 1 || dealerVals[0] === 10)) {
    const up = dealerVals[0];
    const bjRank = up === 1 ? 10 : 1;
    const n = sp21CardsLeft(cts);
    const pNoBj = 1 - cts[bjRank] / n;
    const out = [0, 0, 0, 0, 0, 0];
    for (let v = 1; v <= 10; v++) {
      if (cts[v] === 0 || v === bjRank) continue;
      const p = cts[v] / n / pNoBj;
      cts[v]--;
      const sub = recurse(cts, [up, v]);
      cts[v]++;
      for (let i = 0; i < 6; i++) out[i] += p * sub[i];
    }
    return out;
  }
  return recurse(cts, dealerVals.slice());
}

/* Standing on less than 21 compares against the dealer; standing ON 21 is an
 * automatic win at the bonus rate — the rule that defines this game. */
function sp21EvStandVsDist(total, dist) {
  if (total > 21) return -1;
  let ev = dist[5];
  for (let d = 17; d <= 21; d++) {
    const p = dist[d - 17];
    if (total > d) ev += p; else if (total < d) ev -= p;
  }
  return ev;
}
function sp21EvStand(counts, playerVals, dealerUp) {
  const { total } = sp21Total(playerVals);
  if (total === 21) return sp21BonusRate(playerVals); // 21 always wins, bonus and all
  return sp21EvStandVsDist(total, sp21DealerDist(counts, [dealerUp], true));
}

/* Hit EV: play on optimally. Memoized only at 4+ cards, where the bonus
 * depends on nothing but the count — 3-card nodes stay exact for 6-7-8/7-7-7. */
function sp21EvHit(counts, playerVals, dealerUp) {
  const memo = new Map();
  const best = (cts, vals) => {
    const { total } = sp21Total(vals);
    if (total > 21) return -1;
    if (total === 21) return sp21BonusRate(vals);
    return Math.max(sp21EvStandVsDist(total, sp21DealerDist(cts, [dealerUp], true)), hit(cts, vals));
  };
  const hit = (cts, vals) => {
    const { total, soft } = sp21Total(vals);
    const nc = Math.min(vals.length, 7);
    const useMemo = vals.length >= 3; // children are 4+ cards: count-only bonuses
    const key = useMemo ? `${total}|${soft ? 1 : 0}|${nc}|${cts.join(",")}` : null;
    if (useMemo) { const got = memo.get(key); if (got !== undefined) return got; }
    const n = sp21CardsLeft(cts);
    let ev = 0;
    for (let v = 1; v <= 10; v++) {
      if (cts[v] === 0) continue;
      const p = cts[v] / n;
      cts[v]--;
      ev += p * best(cts, vals.concat(v));
      cts[v]++;
    }
    if (useMemo) memo.set(key, ev);
    return ev;
  };
  return hit(counts.slice(), playerVals.slice());
}

/* Doubling: one card, forced stand, twice the money — and bonuses VOID, so a
 * doubled 21 pays plain even money (still an automatic win). */
function sp21EvDouble(counts, playerVals, dealerUp) {
  const cts = counts.slice();
  const n = sp21CardsLeft(cts);
  let ev = 0;
  for (let v = 1; v <= 10; v++) {
    if (cts[v] === 0) continue;
    const p = cts[v] / n;
    cts[v]--;
    const { total } = sp21Total(playerVals.concat(v));
    ev += p * 2 * (total > 21 ? -1 : total === 21 ? 1 : sp21EvStandVsDist(total, sp21DealerDist(cts, [dealerUp], true)));
    cts[v]++;
  }
  return ev;
}

/* Split, same honest ≈ as blackjack: one split hand exact, doubled. */
function sp21EvSplit(counts, pairVal, dealerUp) {
  const cts = counts.slice();
  const n = sp21CardsLeft(cts);
  let ev = 0;
  for (let v = 1; v <= 10; v++) {
    if (cts[v] === 0) continue;
    const p = cts[v] / n;
    cts[v]--;
    const vals = [pairVal, v];
    if (pairVal === 1) {
      const { total } = sp21Total(vals);
      ev += p * (total === 21 ? 1 : sp21EvStandVsDist(total, sp21DealerDist(cts, [dealerUp], true)));
    } else {
      ev += p * Math.max(sp21EvStand(cts, vals, dealerUp), sp21EvHit(cts, vals, dealerUp), sp21EvDouble(cts, vals, dealerUp));
    }
    cts[v]++;
  }
  return 2 * ev;
}

function sp21Advise(counts, playerVals, dealerUp, canDouble, canSplit) {
  const evs = { stand: sp21EvStand(counts, playerVals, dealerUp), hit: sp21EvHit(counts, playerVals, dealerUp) };
  if (canDouble) evs.double = sp21EvDouble(counts, playerVals, dealerUp);
  if (canSplit) evs.split = sp21EvSplit(counts, playerVals[0], dealerUp);
  let best = "stand";
  for (const m of Object.keys(evs)) if (evs[m] > evs[best]) best = m;
  return { evs, best };
}

/* Settlement per finished hand — credits returned per original bet. Suits
 * matter only here: a suited 6-7-8/7-7-7 pays 2:1, in spades 3:1. */
function sp21Payout(cards, doubled, fromSplit, dealerTotal, dealerBj, bet) {
  const vals = cards.map(sp21Val);
  const { total } = sp21Total(vals);
  if (total > 21) return 0;
  const natural = !fromSplit && cards.length === 2 && total === 21;
  if (natural) return bet + Math.floor(bet * 1.5); // always wins, even vs dealer natural
  if (dealerBj) return 0;
  if (total === 21) {
    if (doubled) return bet * 2; // bonuses void when doubled; 21 still always wins
    let rate = sp21BonusRate(vals);
    if (cards.length === 3 && rate === 1.5) {
      const s = vals.slice().sort((a, b) => a - b).join(",");
      if (s === "6,7,8" || s === "7,7,7") {
        const suited = cards.every((c) => c.s === cards[0].s);
        if (suited) rate = cards[0].s === 0 ? 3 : 2; // spades pay triple
      }
    }
    return bet + Math.floor(bet * rate);
  }
  if (dealerTotal > 21) return bet * 2;
  if (total > dealerTotal) return bet * 2;
  if (total < dealerTotal) return 0;
  return bet;
}

/* ==================== VIEW (casino design kit) ==================== */

const SP21_GUIDE = [
  { h: "Blackjack, minus the tens", p: "The four 10-spot cards are gone from every deck (jacks, queens, kings stay). That alone would tilt the game to the house — so the rules hand it back, and then some." },
  { h: "Your 21 always wins", p: "Not 'usually' — ALWAYS. Dealer makes 21 too? You still win. Your blackjack beats the dealer's and pays 3:2, every time. There is no worse feeling in regular blackjack than a pushed 21; this game deleted it.", tag: "THE HOUSE RULE THAT GIVES BACK" },
  { h: "Long 21s pay bonuses", p: "A 21 made of 5 cards pays 3:2, 6 cards pays 2:1, 7 or more pays 3:1. And 6-7-8 or 7-7-7 pays 3:2 — 2:1 suited, 3:1 in spades. One catch, printed here honestly: doubling voids all bonuses." },
  { h: "The math knows the bonuses", p: "STAND / HIT / DOUBLE each show their exact EV, recomputed from the cards actually left — and the count bonuses are inside that math, exactly. The suited 6-7-8/7-7-7 premiums are the one ≈: paid in full at the table, priced at the mixed rate in the EV.", tag: "ENUMERATED, NOT ESTIMATED" },
  { h: "Follow the star, or don't", p: "The ★ marks the best move for this exact deck. Spanish 21 strategy is famously different from blackjack — you'll hit hands you'd never hit there, because the missing tens change everything. Watch the numbers move. Practice chips only.", tag: "PRACTICE CHIPS ONLY" },
];

const SP21_CHIPS = [5, 25, 100, 500, 1000];
const sp21Deck = () => fullDeck().filter((c) => c.r !== 10);

function SpCard({ card, w, faceDown, delay = 0 }) {
  const red = isRed(card.s);
  return (
    <div style={{
      width: w, height: Math.round(w * 1.42), borderRadius: Math.max(8, w * 0.13), flex: "0 0 auto",
      background: faceDown
        ? "repeating-linear-gradient(45deg, #1c2733, #1c2733 5px, #141b24 5px, #141b24 10px)"
        : "linear-gradient(160deg, #fdfcf7, #efece1 70%, #ddd8c8)",
      border: "1px solid rgba(0,0,0,0.35)", color: red ? "#c62828" : "#161a22",
      boxShadow: "0 5px 12px rgba(0,0,0,0.5)", position: "relative", fontFamily: casSans,
      animation: `casChipDrop 300ms ease ${delay}ms both`,
    }}>
      {!faceDown && (
        <>
          <span style={{ position: "absolute", top: w * 0.07, left: w * 0.1, fontSize: w * 0.3, fontWeight: 900, lineHeight: 1 }}>{rankLabel(card.r)}</span>
          <span style={{ position: "absolute", bottom: w * 0.06, right: w * 0.08, fontSize: w * 0.44, lineHeight: 1 }}>{SUIT[card.s]}</span>
        </>
      )}
    </div>
  );
}

const spMoveBtn = (hot) => ({
  padding: "11px 8px", borderRadius: 12, cursor: "pointer", fontFamily: casSans, fontWeight: 900,
  fontSize: 13, letterSpacing: "0.06em", flex: 1, minWidth: 0,
  border: `1px solid ${hot ? "rgba(245,197,66,0.7)" : CAS.line}`,
  background: hot ? "linear-gradient(180deg, rgba(245,197,66,0.25), rgba(245,197,66,0.1))" : "rgba(255,255,255,0.04)",
  color: hot ? CAS.goldHi : CAS.text,
});

export default function Spanish21() {
  const [guideOpen, setGuideOpen] = useState(() => guideUnseen("sp21"));
  const [bank, setBank] = useState(walletLoad);
  const [chip, setChip] = useState(25);
  const [phase, setPhase] = useState("bet"); // bet | play | reveal | done
  const [shoe, setShoe] = useState(null);
  const [hands, setHands] = useState([]);
  const [active, setActive] = useState(0);
  const [dealer, setDealer] = useState([]);
  const [holeUp, setHoleUp] = useState(false);
  const [result, setResult] = useState(null);
  const [winKey, setWinKey] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);

  useEffect(() => { walletSave(bank); }, [bank]);

  const counts = React.useMemo(() => {
    if (phase !== "play") return null;
    const c = sp21Counts();
    for (const h of hands) for (const card of h.cards) c[sp21Val(card)]--;
    if (dealer[0]) c[sp21Val(dealer[0])]--;
    return c;
  }, [phase, hands, dealer]);

  const hand = hands[active];
  const advice = React.useMemo(() => {
    if (phase !== "play" || !counts || !hand || hand.done) return null;
    const vals = hand.cards.map(sp21Val);
    const canDouble = hand.cards.length === 2 && bank >= hand.bet;
    const canSplit = hands.length === 1 && hand.cards.length === 2 && sp21Val(hand.cards[0]) === sp21Val(hand.cards[1]) && bank >= hand.bet;
    return { ...sp21Advise(counts, vals, sp21Val(dealer[0]), canDouble, canSplit), canDouble, canSplit };
  }, [phase, counts, hands, active, dealer, bank]);

  /* AUTO: deal, then watch — the ★-best move plays itself. Never auto-deals
   * a new hand or bet; that stays a deliberate tap. */
  useEffect(() => {
    if (!autoPlay || phase !== "play" || !advice || !hand || hand.done) return;
    const t = setTimeout(() => act(advice.best), 600);
    return () => clearTimeout(t);
  }, [autoPlay, phase, advice, hand]);

  const deal = () => {
    if (phase === "play" || phase === "reveal" || chip > bank) return;
    const d = sp21Deck();
    for (let i = d.length - 1; i > 0; i--) { const j = ((Math.random() * (i + 1)) | 0); [d[i], d[j]] = [d[j], d[i]]; }
    sfx.chip(); sfx.cards(4);
    setBank((b) => b - chip);
    const p = [d[0], d[2]], dl = [d[1], d[3]];
    setShoe(d.slice(4));
    setHands([{ cards: p, bet: chip, done: false, doubled: false, fromSplit: false }]);
    setActive(0); setDealer(dl); setHoleUp(false); setResult(null);
    const pBj = sp21Total(p.map(sp21Val)).total === 21;
    const dBj = sp21Total(dl.map(sp21Val)).total === 21;
    if (pBj || dBj) {
      setPhase("reveal");
      setTimeout(() => finish([{ cards: p, bet: chip, done: true, doubled: false, fromSplit: false }], dl, d.slice(4)), 650);
    } else setPhase("play");
  };

  const drawOne = (s) => [s[0], s.slice(1)];

  const act = (move) => {
    if (phase !== "play" || !hand || hand.done) return;
    let s = shoe, hs = hands.map((h) => ({ ...h, cards: h.cards.slice() }));
    const h = hs[active];
    if (move === "hit") {
      sfx.card();
      const [c, rest] = drawOne(s); s = rest;
      h.cards.push(c);
      const t = sp21Total(h.cards.map(sp21Val)).total;
      if (t >= 21) h.done = true; // a 21 auto-wins — no reason to keep acting
    } else if (move === "stand") { sfx.click(); h.done = true; }
    else if (move === "double") {
      if (!(h.cards.length === 2 && bank >= h.bet)) return;
      sfx.chips(3);
      setBank((b) => b - h.bet);
      const [c, rest] = drawOne(s); s = rest;
      h.cards.push(c); h.bet *= 2; h.doubled = true; h.done = true;
    } else if (move === "split") {
      if (!(hs.length === 1 && h.cards.length === 2 && sp21Val(h.cards[0]) === sp21Val(h.cards[1]) && bank >= h.bet)) return;
      sfx.chips(2); sfx.cards(2);
      setBank((b) => b - h.bet);
      const aces = sp21Val(h.cards[0]) === 1;
      const [c1, r1] = drawOne(s); const [c2, r2] = drawOne(r1); s = r2;
      hs = [
        { cards: [h.cards[0], c1], bet: h.bet, done: aces, doubled: false, fromSplit: true },
        { cards: [h.cards[1], c2], bet: h.bet, done: aces, doubled: false, fromSplit: true },
      ];
    }
    const next = hs.findIndex((x) => !x.done);
    setShoe(s); setHands(hs);
    if (next === -1) {
      // dealer only plays if a hand still needs beating (non-21, non-bust)
      const needsDealer = hs.some((x) => { const t = sp21Total(x.cards.map(sp21Val)).total; return t < 21; });
      setPhase("reveal");
      setTimeout(() => (needsDealer ? runDealer(hs, s) : finish(hs, dealer, s)), 500);
    } else setActive(next);
  };

  const runDealer = (hs, s) => {
    setHoleUp(true); sfx.card();
    const dl = dealer.slice();
    let rest = s;
    const step = () => {
      const { total } = sp21Total(dl.map(sp21Val));
      if (total >= 17) { finish(hs, dl, rest); return; }
      const [c, r2] = drawOne(rest); rest = r2;
      dl.push(c); sfx.card();
      setDealer(dl.slice());
      setTimeout(step, 620);
    };
    setTimeout(step, 620);
  };

  const finish = (hs, dl, s) => {
    setHoleUp(true);
    const dTot = sp21Total(dl.map(sp21Val)).total;
    const dBj = dl.length === 2 && dTot === 21;
    let credit = 0, staked = 0;
    const lines = [];
    hs.forEach((h, i) => {
      const c = sp21Payout(h.cards, h.doubled, h.fromSplit, dTot, dBj, h.bet);
      credit += c; staked += h.bet;
      const vals = h.cards.map(sp21Val);
      const t = sp21Total(vals).total;
      const name = hs.length > 1 ? `Hand ${i + 1}` : "You";
      if (t > 21) lines.push(`${name} bust (${t})`);
      else if (t === 21 && c > h.bet * 2) lines.push(`${name}: 21 with a BONUS — +$${c - h.bet}`);
      else if (t === 21 && c > h.bet) lines.push(`${name}: 21 always wins — +$${c - h.bet}`);
      else if (dBj) lines.push(`Dealer blackjack — ${name} loses`);
      else if (dTot > 21) lines.push(`Dealer busts (${dTot}) — ${name} +$${c - h.bet}`);
      else if (c > h.bet) lines.push(`${name} ${t} beats ${dTot} — +$${c - h.bet}`);
      else if (c === h.bet) lines.push(`${name} pushes ${t}`);
      else lines.push(`${name} ${t} loses to ${dTot}`);
    });
    const net = credit - staked;
    setBank((b) => b + credit);
    setResult({ net, lines });
    if (net > 0) setWinKey((k) => k + 1);
    setPhase("done");
    reportStats({ inc: { sp21_hands: hs.length } });
  };

  const dealerShown = holeUp ? dealer : dealer.length ? [dealer[0], { r: 1, s: 0, down: true }] : [];
  const w = Math.min(60, Math.round(((typeof window !== "undefined" ? window.innerWidth : 400) - 90) / 6));
  const fmtEv = (x) => (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(3).replace(/^0/, "");
  const MOVE_LABEL = { stand: "STAND", hit: "HIT", double: "DOUBLE", split: "SPLIT" };

  return (
    <div style={{ background: `radial-gradient(120% 60% at 50% -5%, ${CAS.room}, ${CAS.bg} 65%)`, minHeight: "var(--vh)", fontFamily: casSans, color: CAS.text, display: "flex", flexDirection: "column" }}>
      <style>{CAS_CSS}</style>
      <CasinoHeader onHelp={() => setGuideOpen(true)} title="SPANISH 21" sub="YOUR 21 ALWAYS WINS · PRACTICE CHIPS" bank={bank} />
      <Guide game="sp21" title="SPANISH 21" steps={SP21_GUIDE} open={guideOpen} onClose={() => setGuideOpen(false)} />

      <div style={{ flex: 1, maxWidth: 640, width: "100%", margin: "0 auto", padding: "16px 14px 26px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ ...feltPanel("18px 14px"), display: "flex", flexDirection: "column", alignItems: "center", gap: 12, overflow: "hidden" }}>
          <MarqueeLights />
          <BigWin amount={result && result.net > 0 ? result.net : 0} fireKey={winKey} />

          <div style={{ width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.2em", color: CAS.faint, marginBottom: 6 }}>
              DEALER{holeUp && dealer.length ? ` · ${sp21Total(dealer.map(sp21Val)).total}` : ""}
            </div>
            <div style={{ display: "flex", gap: 6, justifyContent: "center", minHeight: Math.round(w * 1.42) }}>
              {dealerShown.length ? dealerShown.map((c, i) => (
                c.down ? <SpCard key={i} card={c} faceDown w={w} /> : <SpCard key={i} card={c} w={w} delay={i * 70} />
              )) : <div style={{ fontFamily: casMono, fontSize: 12, color: CAS.faint, alignSelf: "center" }}>no tens in this deck — count them if you don't believe it</div>}
            </div>
          </div>

          <div style={{ width: "70%", height: 1, background: "rgba(245,197,66,0.18)" }} />

          <div style={{ width: "100%", display: "flex", justifyContent: "center", gap: 18, flexWrap: "wrap" }}>
            {hands.map((h, i) => {
              const t = sp21Total(h.cards.map(sp21Val));
              const isActive = phase === "play" && i === active && !h.done;
              return (
                <div key={i} style={{ textAlign: "center", padding: 6, borderRadius: 14, background: isActive ? "rgba(245,197,66,0.07)" : "transparent", border: `1px solid ${isActive ? CAS.goldLine : "transparent"}` }}>
                  <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
                    {h.cards.map((c, j) => <SpCard key={j} card={c} w={hands.length > 1 ? Math.round(w * 0.86) : w} delay={j * 70} />)}
                  </div>
                  <div style={{ fontFamily: casMono, fontSize: 11.5, marginTop: 6, color: t.total > 21 ? "#ff8a80" : isActive ? CAS.gold : CAS.dim, fontWeight: isActive ? 700 : 400 }}>
                    {t.total > 21 ? `bust · ${t.total}` : `${t.soft ? "soft " : ""}${t.total}`} · ${h.bet.toLocaleString()}{h.doubled ? " · doubled (bonuses void)" : ""}
                  </div>
                </div>
              );
            })}
            {!hands.length && (
              <div style={{ fontFamily: casMono, fontSize: 12, color: CAS.faint, padding: "20px 0" }}>
                place a bet — your 21 always wins here, and the long ones pay extra
              </div>
            )}
          </div>

          {result && (
            <div style={{ fontFamily: casMono, fontSize: 11.5, color: result.net > 0 ? CAS.green : result.net < 0 ? CAS.dim : CAS.text, textAlign: "center", lineHeight: 1.7 }}>
              {result.lines.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
        </div>

        {phase === "play" && advice && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              {["stand", "hit", "double", "split"].map((m) => {
                const ev = advice.evs[m];
                if (ev === undefined) return null;
                const hot = advice.best === m;
                return (
                  <button key={m} onClick={() => act(m)} style={spMoveBtn(hot)}>
                    <div>{hot ? "★ " : ""}{MOVE_LABEL[m]}</div>
                    <div style={{ fontFamily: casMono, fontSize: 10, fontWeight: 400, marginTop: 3, color: hot ? CAS.gold : CAS.faint }}>
                      {m === "split" ? "≈" : "EV"} {fmtEv(ev)}
                    </div>
                  </button>
                );
              })}
            </div>
            <button onClick={() => setAutoPlay((v) => !v)} style={{
              ...casGhost(), padding: "7px 12px", fontSize: 10.5, alignSelf: "center",
              color: autoPlay ? CAS.gold : CAS.dim, border: `1px solid ${autoPlay ? CAS.goldLine : CAS.line}`,
              background: autoPlay ? "rgba(245,197,66,0.1)" : "rgba(255,255,255,0.03)",
            }}>
              {autoPlay ? "⏸ AUTO ON — playing the ★ for you" : "▶ AUTO — play the ★ for me"}
            </button>
          </div>
        )}

        {(phase === "bet" || phase === "done") && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
              {SP21_CHIPS.map((v) => <CasinoChip key={v} value={v} selected={chip === v} onClick={() => setChip(v)} size={42} />)}
              <div style={{ marginLeft: "auto", fontFamily: casMono, fontSize: 12, color: CAS.dim }}>
                {chip > bank ? "not enough chips" : `$${chip.toLocaleString()} a hand`}
              </div>
            </div>
            <button onClick={deal} disabled={chip > bank} style={casCta(chip > bank, true)}>DEAL · ${chip.toLocaleString()}</button>
            {bank < 5 && (
              <button onClick={() => setBank(10000)} style={{ ...casGhost(), color: CAS.gold, border: `1px solid ${CAS.goldLine}` }}>
                Felted — restake $10,000 practice chips
              </button>
            )}
          </>
        )}

        <MathNote>
          48-card Spanish deck (no tens). Your 21 and your blackjack always win; naturals pay 3:2.
          Bonus 21s: 5 cards 3:2, 6 cards 2:1, 7+ 3:1; 6-7-8 and 7-7-7 pay 3:2 (2:1 suited, 3:1 in
          spades). Doubling voids bonuses. Dealer stands on all 17s; split once. Button EVs are
          enumerated with the count bonuses inside the math; suited premiums are the one ≈, priced
          at the mixed rate. Practice chips only.
        </MathNote>
      </div>
    </div>
  );
}
