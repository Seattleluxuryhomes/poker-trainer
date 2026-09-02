import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";

/* ============================================================
   POKER HOLD TRAINER (trainer.html)
   Deal five cards, tap the ones to HOLD, press Draw — then see
   every one of the 32 possible holds ranked by EXACT expected
   value (enumerated over all completions from the 47 unseen
   cards, 9/6 Jacks or Better, EV in coins per coin at max bet),
   each fully explained: per-category odds, guaranteed floor,
   hit rate, volatility. The shared engine (src/engine.js) is
   prepended by build.sh; engine/verify_trainer.js re-proves the
   numbers against the compiled page.
   ============================================================ */

function randomHand() {
  return shuffledDeck().slice(0, 5);
}

/* ---- the per-hold explanation drawer ---- */
function Explain({ opt }) {
  const floor = opt.min > 0
    ? `Guaranteed at least ${opt.min} — the held cards already pay no matter the draw.`
    : "No guaranteed payout — this hold can finish with nothing.";
  return (
    <div style={{ padding: "12px 12px 14px", background: "rgba(0,0,0,0.26)", borderRadius: 9, marginTop: 6, lineHeight: 1.5 }}>
      <div style={{ fontFamily: mono, fontSize: 11, color: T.muted, marginBottom: 6 }}>
        EXACT — enumerated all {opt.draws.toLocaleString()} possible {opt.draws === 1 ? "outcome" : "draws"} of the {5 - opt.idxs.length} replacement card{5 - opt.idxs.length === 1 ? "" : "s"}
      </div>
      <div style={{ fontSize: 13.5, marginBottom: 8 }}>
        {floor} Some winning hand arrives {(opt.hitRate * 100).toFixed(1)}% of the time.
      </div>
      <CatBars cats={opt.cats} color={T.good} />
      <div style={{ height: 1, background: T.line, margin: "12px 0" }} />
      <div style={{ fontFamily: mono, fontSize: 11, color: T.cream, lineHeight: 1.7 }}>
        <div>EV <b>{opt.ev.toFixed(4)}</b> &nbsp; sd {opt.sd.toFixed(2)} &nbsp; floor {opt.min} &nbsp; ceiling {opt.max}</div>
        <div style={{ color: T.muted }}>Bars show each category's share of the EV (probability × payout).</div>
      </div>
    </div>
  );
}

/* ---- the top-level coaching note ---- */
function buildNote(best, chosen, delta) {
  const optimal = delta < 1e-6;
  const bestLabel = best.idxs.length === 0 ? "drawing five" : `holding ${best.cards.map(tag).join(" ")}`;
  if (optimal) {
    if (best.idxs.length === 5) return "Optimal — the made hand is worth more than any chase.";
    if (best.min > 0) return "Optimal — you kept the sure payout and the best upside.";
    return "Optimal — that's the highest-EV hold in the deal.";
  }
  if (chosen.min > 0 && best.min === 0)
    return `You kept the sure ${catName(PAY.indexOf(chosen.min))}, but ${bestLabel} is worth ${delta.toFixed(4)} more per coin — the chase pays better than the lock here.`;
  if (chosen.idxs.length > best.idxs.length)
    return `Too many keepers — ${bestLabel} frees better draws, worth ${delta.toFixed(4)} more per coin.`;
  return `Close, but ${bestLabel} is worth ${delta.toFixed(4)} more per coin.`;
}

/* ---- the trainer's own setup, inline on the main screen ---- */
function InlineSetup({ autoBest, onAutoBest }) {
  return (
    <div style={{ background: "rgba(0,0,0,0.22)", border: `1px solid ${T.line}`, borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 10 }}>Setup</div>
      <div style={{ marginBottom: 10, fontFamily: mono, fontSize: 11, color: T.muted, lineHeight: 1.6 }}>
        EV is coins per coin bet at max coins (royal = 800). On a new hand:
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={() => onAutoBest(false)} style={segStyle(!autoBest)}>I choose</button>
        <button onClick={() => onAutoBest(true)} style={segStyle(autoBest)}>Show me the best</button>
      </div>
    </div>
  );
}

export default function PokerTrainer() {
  const [hand, setHand] = useState(randomHand);
  const [held, setHeld] = useState([]);
  const [phase, setPhase] = useState("choose"); // choose | revealed
  const [chosenId, setChosenId] = useState(null);
  const [drawn, setDrawn] = useState(null);     // { final: Card[5], cat }
  const [expanded, setExpanded] = useState(null);
  const [stats, setStats] = useState({ hands: 0, optimal: 0, lost: 0 });
  const [autoBest, setAutoBest] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  const opts = useMemo(() => (phase === "revealed" ? analyze(hand) : null), [phase, hand]);

  const deal = useCallback(() => {
    setHand(randomHand()); setHeld([]); setChosenId(null); setDrawn(null); setExpanded(null); setPhase("choose");
  }, []);

  const pick = useCallback((idxs, counted) => {
    const id = idxs.slice().sort((a, b) => a - b).join(",");
    const res = analyze(hand);
    const best = res[0];
    const chosen = res.find((o) => o.id === id);
    const delta = best.ev - chosen.ev;
    // Complete the draw for real: replace the discards from the shuffled unseen deck.
    const pool = deckExcluding(hand);
    for (let i = pool.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [pool[i], pool[j]] = [pool[j], pool[i]]; }
    let p = 0;
    const final = hand.map((c, i) => (idxs.includes(i) ? c : pool[p++]));
    setDrawn({ final, cat: categorizeCards(final) });
    setChosenId(id); setExpanded(null); setPhase("revealed");
    if (counted) {
      setStats((s) => ({ hands: s.hands + 1, optimal: s.optimal + (delta < 1e-6 ? 1 : 0), lost: s.lost + delta }));
      reportStats({ inc: { trainer_hands: 1, trainer_optimal: delta < 1e-6 ? 1 : 0, trainer_ev_lost: delta } });
    }
  }, [hand]);

  const draw = useCallback(() => pick(held, true), [pick, held]);

  // Auto-pick the optimal hold once a hand is in the choose phase, when the setting is on.
  // Auto-picked hands don't count toward the header stats (you didn't choose).
  useEffect(() => {
    if (phase !== "choose" || !autoBest) return;
    pick(analyze(hand)[0].idxs, false);
  }, [autoBest, phase, hand, pick]);

  const toggleHold = useCallback((i) => {
    setHeld((h) => (h.includes(i) ? h.filter((x) => x !== i) : [...h, i]));
  }, []);

  const best = opts ? opts[0] : null;
  const chosen = opts ? opts.find((o) => o.id === chosenId) : null;
  const acc = stats.hands ? (stats.optimal / stats.hands) * 100 : 0;
  const avgLost = stats.hands ? stats.lost / stats.hands : 0;
  const maxEV = opts ? opts[0].ev : 1;
  const delta = best && chosen ? best.ev - chosen.ev : 0;

  return (
    <div style={{
      minHeight: "100%", background: `radial-gradient(120% 90% at 50% 0%, ${T.baizeHi}, ${T.baize})`,
      color: T.cream, fontFamily: serif, padding: "0 0 28px",
    }}>
      <style>{`
        @keyframes dealIn {from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        .dealwrap > * {animation:dealIn 260ms ease both}
        .dealwrap > *:nth-child(2){animation-delay:40ms}
        .dealwrap > *:nth-child(3){animation-delay:80ms}
        .dealwrap > *:nth-child(4){animation-delay:120ms}
        .dealwrap > *:nth-child(5){animation-delay:160ms}
        button{font-family:inherit}
        button:focus-visible{outline:2px solid ${T.pegIvory}}
        @media (prefers-reduced-motion: reduce){.dealwrap > *{animation:none}}
      `}</style>

      <header style={{
        background: `linear-gradient(180deg, ${T.woodL}, ${T.woodM} 55%, ${T.woodD})`,
        padding: "14px 18px 16px", boxShadow: "0 6px 18px rgba(0,0,0,0.4)", borderBottom: "2px solid rgba(0,0,0,0.3)",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <a href="index.html" aria-label="Home" title="Home" style={{
              flex: "0 0 auto", width: 34, height: 34, borderRadius: 8, background: T.baize, color: T.ivory, textDecoration: "none",
              display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, lineHeight: 1,
              boxShadow: "inset 0 1px 2px rgba(255,255,255,0.12), 0 2px 5px rgba(0,0,0,0.35)",
            }}>♠</a>
            <span style={{ fontFamily: mono, fontSize: 12, color: "rgba(42,27,14,0.8)", lineHeight: 1.3 }}>Hold Trainer — 9/6 Jacks or Better</span>
            {IS_DEV_VERSION && <span style={{ fontFamily: mono, fontSize: 10, color: "rgba(42,27,14,0.55)", whiteSpace: "nowrap" }}>v{APP_VERSION}</span>}
          </div>
          <div style={{ display: "flex", gap: 8, flex: "0 0 auto" }}>
            <AccountArea />
            <button onClick={() => setAboutOpen(true)} aria-label="About" style={{
              width: 40, height: 40, borderRadius: 10, cursor: "pointer",
              border: "1px solid rgba(0,0,0,0.28)", background: "rgba(42,27,14,0.14)",
              color: "#2A1B0E", fontSize: 19, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
            }}>ⓘ</button>
          </div>
        </div>
        <div style={{ marginTop: 12 }}><ChipTrack pct={acc} /></div>
        <div style={{ marginTop: 10, display: "flex", gap: 18, flexWrap: "wrap", fontFamily: mono, fontSize: 12, color: "#2A1B0E" }}>
          <span><b style={{ fontSize: 15 }}>{stats.hands}</b> hands</span>
          <span><b style={{ fontSize: 15 }}>{stats.hands ? acc.toFixed(0) : "–"}%</b> optimal</span>
          <span><b style={{ fontSize: 15 }}>{stats.hands ? avgLost.toFixed(4) : "–"}</b> avg EV lost</span>
        </div>
      </header>

      <main style={{ maxWidth: 560, margin: "0 auto", padding: "18px 16px 0" }}>
        {aboutOpen && <AboutModal onClose={() => setAboutOpen(false)} />}

        <p style={{ fontFamily: mono, fontSize: 12, color: T.muted, margin: "2px 2px 10px" }}>
          {phase === "choose"
            ? `Tap the cards to HOLD (${held.length} held), then Draw.`
            : "Every hold, ranked by exact expected value — tap a row for the full explanation."}
        </p>

        <div className={phase === "choose" ? "dealwrap" : ""} style={{ display: "flex", gap: 8, justifyContent: "center", paddingTop: 22, paddingBottom: phase === "choose" ? 4 : 20 }}>
          {hand.map((card, i) => (
            <CardFace key={cardId(card)} card={card} held={phase === "choose" ? held.includes(i) : chosen && chosen.idxs.includes(i)}
              disabled={phase !== "choose"} onClick={() => toggleHold(i)}
              badge={phase === "revealed" && best && best.idxs.includes(i) ? "BEST" : null} />
          ))}
        </div>

        {phase === "choose" && (
          <div style={{ display: "flex", gap: 10, justifyContent: "center", margin: "16px 0 18px" }}>
            <button onClick={draw} style={{
              padding: "12px 34px", borderRadius: 10, cursor: "pointer", fontFamily: mono, fontSize: 15, fontWeight: 700,
              background: `linear-gradient(180deg, ${T.good}, ${T.goodDeep})`, color: "#0d2417", border: "1px solid rgba(0,0,0,0.3)",
              boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
            }}>Draw</button>
            <button onClick={deal} style={{
              padding: "12px 22px", borderRadius: 10, cursor: "pointer", fontFamily: mono, fontSize: 13,
              background: "rgba(0,0,0,0.22)", color: T.cream, border: `1px solid ${T.line}`,
            }}>New hand</button>
          </div>
        )}

        {phase === "choose" && <InlineSetup autoBest={autoBest} onAutoBest={setAutoBest} />}

        {phase === "revealed" && opts && chosen && (
          <>
            <div style={{
              padding: "12px 14px", borderRadius: 10, marginBottom: 8,
              background: delta < 1e-6 ? "rgba(95,164,124,0.16)" : "rgba(200,65,43,0.14)",
              border: `1px solid ${delta < 1e-6 ? "rgba(95,164,124,0.5)" : "rgba(200,65,43,0.45)"}`,
            }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{buildNote(best, chosen, delta)}</div>
              {drawn && (
                <div style={{ fontFamily: mono, fontSize: 11.5, color: T.muted, marginTop: 5 }}>
                  Drew {drawn.final.map(tag).join(" ")} — {catName(drawn.cat)}{PAY[drawn.cat] > 0 ? ` (pays ${PAY[drawn.cat]}/coin)` : ""}
                </div>
              )}
            </div>

            <div style={{ display: "grid", gap: 5 }}>
              {opts.map((o, rank) => {
                const isChosen = o.id === chosenId;
                const isOpen = expanded === o.id;
                return (
                  <div key={o.id}>
                    <button onClick={() => setExpanded(isOpen ? null : o.id)} aria-expanded={isOpen} style={{
                      width: "100%", textAlign: "left", display: "grid", gridTemplateColumns: "22px 128px 1fr 64px 34px", gap: 8, alignItems: "center",
                      padding: "8px 10px", borderRadius: 8, cursor: "pointer",
                      background: isChosen ? "rgba(236,220,180,0.14)" : "rgba(0,0,0,0.18)",
                      border: `1px solid ${isChosen ? "rgba(236,220,180,0.5)" : T.line}`, color: T.cream,
                    }}>
                      <span style={{ fontFamily: mono, fontSize: 11, color: rank === 0 ? T.pegIvory : T.muted }}>{rank + 1}</span>
                      <span style={{ fontFamily: mono, fontSize: 12.5, fontWeight: rank === 0 || isChosen ? 700 : 400 }}>
                        {o.idxs.length === 0 ? "Draw 5" : o.cards.map(tag).join(" ")}
                      </span>
                      <span style={{ height: 9, borderRadius: 5, background: "rgba(0,0,0,0.3)", overflow: "hidden" }}>
                        <span style={{ display: "block", height: "100%", width: `${maxEV > 0 ? (o.ev / maxEV) * 100 : 0}%`, background: rank === 0 ? T.pegIvory : T.good, borderRadius: 5 }} />
                      </span>
                      <span style={{ fontFamily: mono, fontSize: 12, textAlign: "right" }}>{o.ev.toFixed(4)}</span>
                      <span style={{ fontFamily: mono, fontSize: 10, color: T.gold, textAlign: "right" }}>{isChosen ? "YOU" : ""}</span>
                    </button>
                    {isOpen && <Explain opt={o} />}
                  </div>
                );
              })}
            </div>

            <div style={{ display: "flex", justifyContent: "center", margin: "18px 0 6px" }}>
              <button onClick={deal} style={{
                padding: "12px 34px", borderRadius: 10, cursor: "pointer", fontFamily: mono, fontSize: 15, fontWeight: 700,
                background: `linear-gradient(180deg, ${T.good}, ${T.goodDeep})`, color: "#0d2417", border: "1px solid rgba(0,0,0,0.3)",
                boxShadow: "0 4px 12px rgba(0,0,0,0.35)",
              }}>Next hand</button>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
