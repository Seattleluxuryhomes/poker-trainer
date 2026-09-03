import React, { useState, useEffect } from "react";

/* ============================================================
   BLACKJACK (bj.html) — single deck, dealer stands on all 17s,
   blackjack pays 3:2, double on any first two, split once
   (aces get one card each), no surrender. The house rule of
   this app made playable: EVERY decision's expected value is
   enumerated exactly — stand, hit, and double are computed by
   full recursion over the cards actually left in the deck and
   printed on the buttons while you decide. No strategy charts,
   no simulation, no memory: the math runs fresh for the exact
   composition in front of you. (Split is the one label marked
   "≈": it prices one split hand exactly and doubles it, which
   ignores the second hand's draw on the first's cards.)
   Practice chips only; bankroll lives in this browser.
   Pure functions (bjFreshCounts … bjSettle) are top-level so
   engine/verify_blackjack.js can eval this page and re-prove
   every number.
   ============================================================ */

/* ---- deck composition: counts[v] = cards remaining of value v (1=ace … 10=ten/J/Q/K) ---- */
function bjFreshCounts() {
  const c = new Array(11).fill(0);
  for (let v = 1; v <= 9; v++) c[v] = 4;
  c[10] = 16;
  return c;
}
const bjCardsLeft = (counts) => counts.reduce((a, b) => a + b, 0);

/* Hand total with the soft-ace rule: one ace counts 11 when it fits. */
function bjTotal(vals) {
  let t = 0, aces = 0;
  for (const v of vals) { t += v; if (v === 1) aces++; }
  if (aces > 0 && t + 10 <= 21) return { total: t + 10, soft: true };
  return { total: t, soft: false };
}

/* Dealer outcome distribution [17,18,19,20,21,bust] by exact recursion, S17.
 * When the dealer shows exactly one card (ace or ten) the play only continues
 * after the peek found no blackjack, so the first hole card is drawn
 * CONDITIONED on not completing a natural — the BJ-completing rank is skipped
 * and the remaining probabilities renormalized. */
function bjDealerDist(counts, dealerVals, conditionNoBj) {
  const memo = new Map();
  const recurse = (cts, vals) => {
    const { total, soft } = bjTotal(vals);
    if (total > 21) return [0, 0, 0, 0, 0, 1];
    if (total >= 17) {
      const out = [0, 0, 0, 0, 0, 0];
      out[total - 17] = 1;
      return out;
    }
    const key = total * 2 + (soft ? 1 : 0) + ":" + cts.join(",");
    const hit = memo.get(key);
    if (hit) return hit;
    const n = bjCardsLeft(cts);
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
    const bjRank = up === 1 ? 10 : 1; // the hole card that would have made a natural
    const n = bjCardsLeft(cts);
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

/* EV of standing on `total` against the dealer distribution: exact sum. */
function bjEvStandVsDist(total, dist) {
  if (total > 21) return -1;
  let ev = dist[5]; // dealer bust
  for (let d = 17; d <= 21; d++) {
    const p = dist[d - 17];
    if (total > d) ev += p;
    else if (total < d) ev -= p;
  }
  return ev;
}

function bjEvStand(counts, playerVals, dealerUp) {
  const { total } = bjTotal(playerVals);
  return bjEvStandVsDist(total, bjDealerDist(counts, [dealerUp], true));
}

/* EV of hitting, playing on optimally (max of stand/hit at every later node).
 * Full recursion over the remaining deck — this is the basic-strategy EV for
 * the exact composition, derived, not looked up. */
function bjEvHit(counts, playerVals, dealerUp) {
  const memo = new Map();
  const best = (cts, vals) => {
    const { total } = bjTotal(vals);
    if (total > 21) return -1;
    return Math.max(bjEvStandVsDist(total, bjDealerDist(cts, [dealerUp], true)), hit(cts, vals));
  };
  const hit = (cts, vals) => {
    const { total, soft } = bjTotal(vals);
    const key = total * 2 + (soft ? 1 : 0) + ":" + cts.join(",");
    const got = memo.get(key);
    if (got !== undefined) return got;
    const n = bjCardsLeft(cts);
    let ev = 0;
    for (let v = 1; v <= 10; v++) {
      if (cts[v] === 0) continue;
      const p = cts[v] / n;
      cts[v]--;
      ev += p * best(cts, vals.concat(v));
      cts[v]++;
    }
    memo.set(key, ev);
    return ev;
  };
  return hit(counts.slice(), playerVals.slice());
}

/* EV of doubling: one card, forced stand, twice the money. */
function bjEvDouble(counts, playerVals, dealerUp) {
  const cts = counts.slice();
  const n = bjCardsLeft(cts);
  let ev = 0;
  for (let v = 1; v <= 10; v++) {
    if (cts[v] === 0) continue;
    const p = cts[v] / n;
    cts[v]--;
    const { total } = bjTotal(playerVals.concat(v));
    ev += p * 2 * (total > 21 ? -1 : bjEvStandVsDist(total, bjDealerDist(cts, [dealerUp], true)));
    cts[v]++;
  }
  return ev;
}

/* Split, priced honestly-approximately: one post-split hand exactly
 * (draw the second card, then play optimally; split aces take one card and
 * stand), doubled. The second hand actually plays a deck the first has drawn
 * from — that interaction is what the ≈ on the label admits. */
function bjEvSplit(counts, pairVal, dealerUp) {
  const cts = counts.slice();
  const n = bjCardsLeft(cts);
  let ev = 0;
  for (let v = 1; v <= 10; v++) {
    if (cts[v] === 0) continue;
    const p = cts[v] / n;
    cts[v]--;
    const vals = [pairVal, v];
    if (pairVal === 1) {
      const { total } = bjTotal(vals);
      ev += p * bjEvStandVsDist(total, bjDealerDist(cts, [dealerUp], true));
    } else {
      ev += p * Math.max(bjEvStand(cts, vals, dealerUp), bjEvHit(cts, vals, dealerUp), bjEvDouble(cts, vals, dealerUp));
    }
    cts[v]++;
  }
  return 2 * ev;
}

/* Every legal move priced; the best one named. */
function bjAdvise(counts, playerVals, dealerUp, canDouble, canSplit) {
  const evs = {
    stand: bjEvStand(counts, playerVals, dealerUp),
    hit: bjEvHit(counts, playerVals, dealerUp),
  };
  if (canDouble) evs.double = bjEvDouble(counts, playerVals, dealerUp);
  if (canSplit) evs.split = bjEvSplit(counts, playerVals[0], dealerUp);
  let best = "stand";
  for (const m of Object.keys(evs)) if (evs[m] > evs[best]) best = m;
  return { evs, best };
}

/* Settlement for one finished hand, in credits returned per original bet:
 * stake was deducted when placed (doubles deducted their extra separately). */
function bjSettle(playerTotal, playerBj, dealerTotal, dealerBj, bet) {
  if (playerTotal > 21) return 0;                    // busted: stake already gone
  if (playerBj && dealerBj) return bet;              // both naturals: push
  if (playerBj) return bet + Math.floor(bet * 1.5);  // 3:2, the printed rule
  if (dealerBj) return 0;
  if (dealerTotal > 21) return bet * 2;
  if (playerTotal > dealerTotal) return bet * 2;
  if (playerTotal < dealerTotal) return 0;
  return bet;
}

/* ==================== VIEW (casino design kit) ==================== */

const BJ_BANK_KEY = "poker-trainer:bjBank";
function loadBjBank() {
  try {
    const raw = window.localStorage.getItem(BJ_BANK_KEY);
    if (raw == null) return 10000;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? v : 10000;
  } catch { return 10000; }
}
const BJ_CHIPS = [5, 25, 100, 500, 1000];
const bjVal = (c) => Math.min(10, c.r);

function BjCard({ card, w, faceDown, delay = 0 }) {
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

const bjMoveBtn = (hot) => ({
  padding: "11px 8px", borderRadius: 12, cursor: "pointer", fontFamily: casSans, fontWeight: 900,
  fontSize: 13, letterSpacing: "0.06em", flex: 1, minWidth: 0,
  border: `1px solid ${hot ? "rgba(245,197,66,0.7)" : CAS.line}`,
  background: hot ? "linear-gradient(180deg, rgba(245,197,66,0.25), rgba(245,197,66,0.1))" : "rgba(255,255,255,0.04)",
  color: hot ? CAS.goldHi : CAS.text,
  boxShadow: hot ? `0 0 18px ${CAS.goldFaint}` : "none",
});


const BJ_GUIDE = [
  { h: "Get closer to 21 than the dealer", p: "Cards count face value; face cards are 10; an ace is 11 unless that busts you, then it's 1. Go over 21 and you bust \u2014 lose instantly. The dealer plays by a fixed rule: draw to 16, stand on all 17s. No decisions on their side, ever." },
  { h: "Your four moves", p: "STAND keeps your total. HIT draws a card. DOUBLE doubles your bet, takes exactly one card, and stops. SPLIT (on a pair) plays two hands. A two-card 21 is BLACKJACK and pays 3:2 \u2014 the full, honest rate." },
  { h: "The numbers on the buttons", p: "That's this casino's whole philosophy on three buttons: each move shows its exact expected value per $1, computed live from the cards actually left in this deck. EV +.615 means that move earns 61.5 cents per dollar in the long run. The \u2605 marks the best one.", tag: "ENUMERATED, NOT ESTIMATED" },
  { h: "No charts, no memory", p: "Casinos sell \u201cbasic strategy\u201d cards. Here you don't need one: the math that MAKES those charts runs fresh for your exact hand, every decision. Split's label says \u2248 because it's the one honestly-approximate price \u2014 the page explains why." },
  { h: "Learn by feel", p: "Follow the \u2605 and you're playing perfectly. Ignore it when you're curious \u2014 the EVs show you exactly what a hunch costs. Toggle \u201chide the math\u201d to sweat like a civilian. Practice chips only.", tag: "PRACTICE CHIPS ONLY" },
];

export default function Blackjack() {
  const [guideOpen, setGuideOpen] = useState(() => guideUnseen("bj"));
  const [bank, setBank] = useState(loadBjBank);
  const [chip, setChip] = useState(25);
  const [phase, setPhase] = useState("bet"); // bet | play | reveal | done
  const [shoe, setShoe] = useState(null);
  const [hands, setHands] = useState([]);   // [{cards, bet, done, doubled, fromSplit}]
  const [active, setActive] = useState(0);
  const [dealer, setDealer] = useState([]);
  const [holeUp, setHoleUp] = useState(false);
  const [result, setResult] = useState(null); // {net, lines}
  const [winKey, setWinKey] = useState(0);
  const [showMath, setShowMath] = useState(true);

  useEffect(() => { try { window.localStorage.setItem(BJ_BANK_KEY, String(bank)); } catch { /* private */ } }, [bank]);

  /* what the math may know: the fresh deck minus every card FACE UP on the table */
  const counts = React.useMemo(() => {
    if (phase !== "play") return null;
    const c = bjFreshCounts();
    for (const h of hands) for (const card of h.cards) c[bjVal(card)]--;
    if (dealer[0]) c[bjVal(dealer[0])]--;
    return c;
  }, [phase, hands, dealer]);

  const hand = hands[active];
  const advice = React.useMemo(() => {
    if (phase !== "play" || !counts || !hand || hand.done) return null;
    const vals = hand.cards.map(bjVal);
    const canDouble = hand.cards.length === 2 && bank >= hand.bet;
    const canSplit = hands.length === 1 && hand.cards.length === 2 &&
      bjVal(hand.cards[0]) === bjVal(hand.cards[1]) && bank >= hand.bet;
    return { ...bjAdvise(counts, vals, bjVal(dealer[0]), canDouble, canSplit), canDouble, canSplit };
  }, [phase, counts, hands, active, dealer, bank]);

  const deal = () => {
    if (phase === "play" || phase === "reveal" || chip > bank) return;
    const d = fullDeck();
    for (let i = d.length - 1; i > 0; i--) { const j = ((Math.random() * (i + 1)) | 0); [d[i], d[j]] = [d[j], d[i]]; }
    sfx.chip();
    sfx.cards(4);
    setBank((b) => b - chip);
    const p = [d[0], d[2]], dl = [d[1], d[3]];
    setShoe(d.slice(4));
    setHands([{ cards: p, bet: chip, done: false, doubled: false, fromSplit: false }]);
    setActive(0); setDealer(dl); setHoleUp(false); setResult(null);
    const pBj = bjTotal(p.map(bjVal)).total === 21;
    const dBj = bjTotal(dl.map(bjVal)).total === 21;
    if (pBj || dBj) {
      // naturals settle immediately — the peek, made visible
      setPhase("reveal");
      setTimeout(() => finish([{ cards: p, bet: chip, done: true, doubled: false, fromSplit: false }], dl, d.slice(4), true), 650);
    } else {
      setPhase("play");
    }
  };

  const drawOne = (s) => { const c = s[0]; return [c, s.slice(1)]; };

  const act = (move) => {
    if (phase !== "play" || !hand || hand.done) return;
    let s = shoe, hs = hands.map((h) => ({ ...h, cards: h.cards.slice() }));
    const h = hs[active];
    if (move === "hit") {
      sfx.card();
      const [c, rest] = drawOne(s); s = rest;
      h.cards.push(c);
      if (bjTotal(h.cards.map(bjVal)).total > 21) h.done = true;
    } else if (move === "stand") {
      sfx.click();
      h.done = true;
    } else if (move === "double") {
      if (!(h.cards.length === 2 && bank >= h.bet)) return;
      sfx.chips(3);
      setBank((b) => b - h.bet);
      const [c, rest] = drawOne(s); s = rest;
      h.cards.push(c); h.bet *= 2; h.doubled = true; h.done = true;
    } else if (move === "split") {
      if (!(hs.length === 1 && h.cards.length === 2 && bjVal(h.cards[0]) === bjVal(h.cards[1]) && bank >= h.bet)) return;
      sfx.chips(2); sfx.cards(2);
      setBank((b) => b - h.bet);
      const aces = bjVal(h.cards[0]) === 1;
      const [c1, r1] = drawOne(s); const [c2, r2] = drawOne(r1); s = r2;
      hs = [
        { cards: [h.cards[0], c1], bet: h.bet, done: aces, doubled: false, fromSplit: true },
        { cards: [h.cards[1], c2], bet: h.bet, done: aces, doubled: false, fromSplit: true },
      ];
    }
    // advance to the next undecided hand, or to the dealer
    let next = hs.findIndex((x) => !x.done);
    setShoe(s); setHands(hs);
    if (next === -1) {
      const anyLive = hs.some((x) => bjTotal(x.cards.map(bjVal)).total <= 21);
      setPhase("reveal");
      setTimeout(() => (anyLive ? runDealer(hs, s) : finish(hs, dealer, s, false)), 500);
    } else {
      setActive(next);
    }
  };

  /* dealer draws to 17 (S17) with a card sound per draw, then settlement */
  const runDealer = (hs, s) => {
    setHoleUp(true);
    sfx.card();
    const dl = dealer.slice();
    let rest = s;
    const step = () => {
      const { total } = bjTotal(dl.map(bjVal));
      if (total >= 17) { finish(hs, dl, rest, false); return; }
      const [c, r2] = drawOne(rest); rest = r2;
      dl.push(c);
      sfx.card();
      setDealer(dl.slice());
      setTimeout(step, 620);
    };
    setTimeout(step, 620);
  };

  const finish = (hs, dl, s, naturals) => {
    setHoleUp(true);
    const dTot = bjTotal(dl.map(bjVal)).total;
    const dBj = dl.length === 2 && dTot === 21;
    let credit = 0;
    const lines = [];
    let staked = 0;
    hs.forEach((h, i) => {
      const vals = h.cards.map(bjVal);
      const t = bjTotal(vals).total;
      const hBj = !h.fromSplit && h.cards.length === 2 && t === 21;
      const c = bjSettle(t, hBj, dTot, dBj, h.bet);
      credit += c; staked += h.bet;
      const name = hs.length > 1 ? `Hand ${i + 1}` : "You";
      if (t > 21) lines.push(`${name} bust (${t})`);
      else if (hBj && dBj) lines.push(`Both blackjack — push`);
      else if (hBj) lines.push(`${name}: BLACKJACK — pays 3:2, +$${c - h.bet}`);
      else if (dBj) lines.push(`Dealer blackjack — ${name} loses`);
      else if (dTot > 21) lines.push(`Dealer busts (${dTot}) — ${name} +$${c - h.bet}`);
      else if (c > h.bet) lines.push(`${name} ${t} beats ${dTot} — +$${c - h.bet}`);
      else if (c === h.bet) lines.push(`${name} pushes ${t}`);
      else lines.push(`${name} ${t} loses to ${dTot}`);
    });
    const net = credit - staked;
    setBank((b) => b + credit);
    setResult({ net, lines });
    if (net > 0) { setWinKey((k) => k + 1); }
    setPhase("done");
    reportStats({ inc: { bj_hands: hs.length }, maxOf: net > 0 ? { bj_best: net } : {} });
  };

  const dealerShown = holeUp ? dealer : dealer.length ? [dealer[0], { r: 1, s: 0, down: true }] : [];
  const w = Math.min(64, Math.round(((typeof window !== "undefined" ? window.innerWidth : 400) - 90) / 6));
  const fmtEv = (x) => (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(3).replace(/^0/, "");
  const MOVE_LABEL = { stand: "STAND", hit: "HIT", double: "DOUBLE", split: "SPLIT" };

  return (
    <div style={{ background: `radial-gradient(120% 60% at 50% -5%, ${CAS.room}, ${CAS.bg} 65%)`, minHeight: "100vh", fontFamily: casSans, color: CAS.text, display: "flex", flexDirection: "column" }}>
      <style>{CAS_CSS}</style>
      <CasinoHeader onHelp={() => setGuideOpen(true)} title="BLACKJACK" sub="SINGLE DECK · DEALER STANDS ON 17 · BLACKJACK PAYS 3:2 · PRACTICE CHIPS" bank={bank} />
      <Guide game="bj" title="BLACKJACK" steps={BJ_GUIDE} open={guideOpen} onClose={() => setGuideOpen(false)} />

      <div style={{ flex: 1, maxWidth: 640, width: "100%", margin: "0 auto", padding: "16px 14px 26px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ ...feltPanel("18px 14px"), display: "flex", flexDirection: "column", alignItems: "center", gap: 12, overflow: "hidden" }}>
          <MarqueeLights />
          <BigWin amount={result && result.net > 0 ? result.net : 0} fireKey={winKey} />

          {/* dealer */}
          <div style={{ width: "100%", textAlign: "center" }}>
            <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.2em", color: CAS.faint, marginBottom: 6 }}>
              DEALER{holeUp && dealer.length ? ` · ${bjTotal(dealer.map(bjVal)).total}` : ""}
            </div>
            <div style={{ display: "flex", gap: 6, justifyContent: "center", minHeight: Math.round(w * 1.42) }}>
              {dealerShown.length ? dealerShown.map((c, i) => (
                <BjCard key={i} card={c} faceDown={!!c.down} w={w} delay={i * 70} />
              )) : (
                <div style={{ fontFamily: casMono, fontSize: 12, color: CAS.faint, alignSelf: "center" }}>the shoe is ready</div>
              )}
            </div>
          </div>

          <div style={{ width: "70%", height: 1, background: "rgba(245,197,66,0.18)" }} />

          {/* player hands */}
          <div style={{ width: "100%", display: "flex", justifyContent: "center", gap: 18, flexWrap: "wrap" }}>
            {hands.map((h, i) => {
              const t = bjTotal(h.cards.map(bjVal));
              const isActive = phase === "play" && i === active && !h.done;
              return (
                <div key={i} style={{ textAlign: "center", padding: 6, borderRadius: 14, background: isActive ? "rgba(245,197,66,0.07)" : "transparent", border: `1px solid ${isActive ? CAS.goldLine : "transparent"}` }}>
                  <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                    {h.cards.map((c, j) => <BjCard key={j} card={c} w={hands.length > 1 ? Math.round(w * 0.86) : w} delay={j * 70} />)}
                  </div>
                  <div style={{ fontFamily: casMono, fontSize: 11.5, marginTop: 6, color: t.total > 21 ? "#ff8a80" : isActive ? CAS.gold : CAS.dim, fontWeight: isActive ? 700 : 400 }}>
                    {t.total > 21 ? `bust · ${t.total}` : `${t.soft ? "soft " : ""}${t.total}`} · ${h.bet}{h.doubled ? " · doubled" : ""}
                  </div>
                </div>
              );
            })}
            {!hands.length && (
              <div style={{ fontFamily: casMono, fontSize: 12, color: CAS.faint, padding: "20px 0" }}>
                place a bet — every move you'll face is priced exactly, from the cards actually left
              </div>
            )}
          </div>

          {result && (
            <div style={{ fontFamily: casMono, fontSize: 11.5, color: result.net > 0 ? CAS.green : result.net < 0 ? CAS.dim : CAS.text, textAlign: "center", lineHeight: 1.7 }}>
              {result.lines.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          )}
        </div>

        {/* decisions, each wearing its exact price */}
        {phase === "play" && advice && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 8 }}>
              {["stand", "hit", "double", "split"].map((m) => {
                const ev = advice.evs[m];
                if (ev === undefined) return null;
                const hot = advice.best === m;
                return (
                  <button key={m} onClick={() => act(m)} style={bjMoveBtn(hot)}>
                    <div>{hot ? "★ " : ""}{MOVE_LABEL[m]}</div>
                    {showMath && (
                      <div style={{ fontFamily: casMono, fontSize: 10, fontWeight: 400, marginTop: 3, color: hot ? CAS.gold : CAS.faint }}>
                        {m === "split" ? "≈" : "EV"} {fmtEv(ev)}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <button onClick={() => setShowMath((v) => !v)} style={{ ...casGhost(), padding: "7px 10px", fontSize: 10.5, alignSelf: "center" }}>
              {showMath ? "hide the math" : "show the math"}
            </button>
          </div>
        )}

        {(phase === "bet" || phase === "done") && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {BJ_CHIPS.map((v) => <CasinoChip key={v} value={v} selected={chip === v} onClick={() => setChip(v)} />)}
              <div style={{ marginLeft: "auto", fontFamily: casMono, fontSize: 12, color: CAS.dim }}>
                {chip > bank ? "not enough chips" : `$${chip} a hand`}
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

        <div style={{ background: CAS.panel, border: `1px solid ${CAS.line}`, borderRadius: 12, padding: "12px 14px", fontFamily: casMono, fontSize: 11.5, lineHeight: 1.75, color: CAS.dim }}>
          The EV on every button is <b style={{ color: CAS.text }}>enumerated, not estimated</b>: a full
          recursion over the cards actually left in this deck, conditioned on the dealer's peek. Split
          is the one ≈ — it prices one split hand exactly and doubles it. Single deck, reshuffled every
          hand; dealer stands on all 17s; blackjack pays 3:2, printed. Practice chips only.
        </div>
      </div>
    </div>
  );
}
