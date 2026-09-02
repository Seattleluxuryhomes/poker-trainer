# CLAUDE.md — Poker Trainer

> Read this first. It is the full context for this app. It began life on a
> branch of the founder's builderbuybox repo and was moved to this standalone
> repository (2026-09-01); it shares no code, data model, or runtime with any
> other project.

## Provenance (read before changing anything)

This app is a deliberate port of **ghug/cribbage-trainer** (public domain, The
Unlicense) at the founder's request: "make a poker app based on
cribbage-trainer." The port keeps that project's architecture verbatim:

- **Buildless React.** No bundler, no npm project. React/React-DOM are vendored
  in `vendor/` (copied from the reference repo; MIT). `build.sh` prepends the
  shared `src/engine.js` + `src/chrome.jsx` to each page component, swaps the
  ESM React import for the browser globals, name-guards with tsc (an undefined
  identifier aborts the build instead of shipping a blank page), transpiles
  JSX, and wraps the result in a self-contained HTML shell. The compiled root
  pages ARE committed — `index.html`, `trainer.html`, `play.html`,
  `table.html` — and must be rebuilt and committed together with any `src/`
  change.
- **Verification over trust.** `engine/verify_*.js` eval the COMPILED pages in
  a Node vm (the reference's pattern) and re-prove the math against facts that
  can be derived independently: the published C(52,5) frequency table, the
  919/47 flush-break EV, payout linearity, the supplied Elmish reducer
  semantics. Run all four after any engine or page change; they are the CI.
- **The value model is the law.** Expected values come strictly from
  enumeration over the unseen deck — never strategy charts, never heuristics,
  never weights (the reference's "Project Philosophy", inherited whole).
  `analyze(hand5)` enumerates all 32 holds × every C(47, 5-k) completion and
  derives EV, sd, floor, ceiling, hit rate, and per-category probabilities
  from the exact counts.

## The three pages

1. **Hold Trainer** (`src/PokerTrainer.jsx`) — the cribbage discard-trainer
   loop mapped to video poker: deal → choose → reveal a ranked, fully-explained
   option list, with header stats (hands / % optimal / avg EV lost) and an
   expandable per-option Explain drawer. EV is coins per coin at max bet
   (royal = 800). Optimal means EV-tied with the top option (< 1e-6).
2. **Play** (`src/PokerPlay.jsx`) — 9/6 Jacks or Better with a localStorage
   practice bankroll (`poker-trainer:bank`, start 200). `payoutFor(cat, bet)`
   is per-coin linear except the royal's 4000 at exactly 5 coins. Hint =
   `bestHold` = `analyze()[0]` — one engine, so the game can never contradict
   the trainer.
3. **Hold'em Table** (`src/PokerTable.jsx`) — a REAL four-max no-limit game
   (grew out of the founder-supplied F# Elmish mock; the dark neon theme is
   theirs). Every hand: fresh shuffled 52-card deck, SB/BB 25/50, four betting
   streets with ordered action queues and min-raise rules, all-ins with layered
   side pots, best-5-of-7 showdown (`score5H`/`score7`, packed comparable
   integers with full kicker tiebreaks). Bots decide by Monte Carlo equity
   (`equityVs`, rollouts of the unseen deck) against pot odds, shaded by
   persona (tight/aggr) — simulation, never strategy charts. The featured
   opponent "Ace Meridian, World #1" is a FICTIONAL character by design: never
   name, imitate, or style the bots after real players. Short all-ins reopen
   betting (a simplification vs. casino rules — documented, revisit if it
   matters). The game core is pure top-level functions so verify_table can
   drive it deterministically with an injected mulberry32 rng.

## Cards

`{ r: 1..13, s: 0..3 }` (A=1 … K=13; spade/heart/diamond/club) — the reference
engine's shape, kept so ports stay literal. The ace is stored low; `categorize`
special-cases the ace-high straight (A-10-J-Q-K) and the royal.

## Honesty rules (inherited from both parents; amended 2026-09-02 for accounts)

- Practice chips only, everywhere, always. No real wagering, no purchases, no
  "buy credits" — if a change adds monetary value flow, stop and ask the founder.
- No fake states: never show a win, a payout, or a saved bankroll unless it
  actually happened.
- GUEST data stays in this browser (localStorage); playing never requires an
  account, on any surface, ever. ACCOUNT data (deliberate amendment, founder
  ruling "trust is the most important") syncs to the poker backend and is:
  minimal (email, display name, DOB, avatar, practice stats, metadata-only
  events), one-tap exportable, one-tap deletable (30-day restore window, then
  gone), never analyzed, never sold, no tracking. The leaderboard is OPT-IN
  (default off) and its endpoint serializes through an explicit allowlist —
  a field not on the list cannot leak.

## The accounts backend (a maybe.love port)

`db.mjs` + `api.mjs` + the /api half of `server.mjs` are a port of the
founder's maybe.love auth/profile backend (`app` repo, backend/server.py
L991–2400, frontend/src/api.ts + auth.tsx), per the "copy it, don't rebuild
it" doctrine: same routes, same fields, same defaults, same rulings —
7-day HS256 bearer JWT, no refresh/logout endpoints, iat vs
password_changed_at global logout, the 18+ gate before any DB write, their
exact rate-limit ledger thresholds, the deleted→410-with-days-left offer
gated on a correct password, uuid ids, and the two-serializer invariant
(ownerView for every self-response; publicView from PROFILE_PUBLIC_FIELDS).
Documented translations: bcrypt→node:crypto scrypt, PyJWT→hand-rolled
pinned HS256, Mongo→node:sqlite (the BidVoice precedent). Deferred until
email infra exists: forgot/reset-password, email verification, Google.
Porting gotchas carried from their recorded bugs: ownerView EVERYWHERE a
user goes back to its owner; the public allowlist; never leak a DB id.
`engine/verify_auth.js` boots the real server and re-proves all of it.
Env: JWT_SECRET (required for accounts; absent = API answers 503 and the
site stays guest-only), DB_PATH (Railway volume at /data), CORS_ORIGINS,
ACCESS_TOKEN_EXPIRE_HOURS, REQUIRE_STRONG_SECRETS. Node ≥22.5 (node:sqlite).

## Known limitations / next steps (in order)

1. Accounts phase 2: forgot/reset-password + email verification (needs Resend
   or similar), Google sign-in — all mapped in the maybe.love source.
2. Short all-ins reopen betting (casino rules say they shouldn't) — tighten
   when it matters.
3. The trainer's "Deal custom" card picker (the reference has one; not ported yet).
4. i18n: the reference ships a full locale system; this port is English-only.
5. PWA service worker for offline (manifest exists; no SW yet).
6. Multi-paytable support (8/5, 7/5) — PAY is already the single source of truth.
7. httpOnly cookie session for the web token (their parked fix, inherited).

## Android

`android/` is the reference's offline WebView wrapper, ported (applicationId
`dev.poker.trainer`, spade icon). `:app:syncWebAssets` copies the committed
root pages into assets at build time — never commit the assets copies. Releases:
push a `v*` tag; `.github/workflows/android-release.yml` builds,
signs (repo secrets `POKER_KEYSTORE_*`, or a one-off key with a warning), and
attaches the APK to a GitHub Release for Obtainium. Bump `versionCode` by 1 and
sync `versionName` with `VERSION` on every release. Details: `docs/ANDROID.md`.

## Working rules

- Run `./build.sh && node engine/verify_rank.js && node engine/verify_trainer.js
  && node engine/verify_play.js && node engine/verify_table.js` before declaring
  anything done; commit `src/` and the rebuilt root pages together.
- Bump `VERSION` (dev suffix) with each meaningful change; `build.sh` stamps it.
- Keep new dependencies at zero. The vendored React is the dependency budget.

## Multiplayer rooms & Charity Night (v0.3.0)

`rooms.mjs` hosts server-authoritative tables: it vm-loads the SAME
src/engine.js + src/holdem.js the pages ship (one rules engine, no copy), keeps
the deck and hole cards only in server memory, and pushes per-seat REDACTED
views over SSE — a client never receives another player's cards pre-reveal, and
never the deck (engine/verify_rooms.js audits every payload for exactly this).
The server runs bots for unclaimed seats, a 45s no-show auto-check/fold, and
the runout broadcast (equities computed server-side, shipped as bare
percentages). Rooms need no account and work with JWT_SECRET unset.
Client: ?room=CODE on table.html; host creates via PLAY WITH FRIENDS; joiners
take seats between hands; host paces the deal.

CHARITY NIGHT — the legal shape is the feature, keep it exactly: pledges are
NUMBERS the app displays; the app NEVER holds, collects, or routes money; no
player can ever receive anything of value; the night's chip leader wins ONLY
the right to name the charity (https link enforced); everyone donates their own
pledge directly on the charity's page. Nights are recorded metadata-only;
signed-in players' `raised` tally grows by their pledge. Any change that gives
a player value back, or has the app touch funds, is a refuse-and-stop — that's
the line between this feature and an unlicensed gambling operation.

## Video taunts & the hand log (v0.4.0)

Clips: MediaRecorder in the room client (6s auto-stop, webm/mp4, ~3MB cap),
relayed through room MEMORY only — never disk, never a bucket, gone with the
room. Seat-authed upload and fetch, per-seat 15s cooldown, newest 6 kept.
A new clip auto-opens on every OTHER seat muted (autoplay policy; TAP FOR
SOUND is the gesture). During an all-in runout the panel becomes the
"SAY IT TO THEIR FACE" record button. Private rooms only, by invite link —
if clips ever persist or go public, moderation becomes a real design problem;
don't drift there casually.
The hand log lives in the SHARED game state (holdem.js pushLog): blinds,
every action, each street with cards and pot — solo and rooms render the same
feed (2-line ticker above the action panel; tap for the full log). Seat
actions render as color-coded ActBadges (raise green, fold red, call cream).

## The casino floor: roulette & craps (v0.5.0)

Client-only house games, practice chips, with the project philosophy as the
product: EVERY probability is enumerated and PRINTED on the felt. Roulette
(src/Roulette.jsx): American 00 wheel, offered bets all cost exactly 2/38 —
the five-number basket is deliberately not offered; the info drawer shows each
bet's ways/38, payout, and edge. Craps (src/Craps.jsx): pass (244/495,
enumerated in-page), don't pass (bar 12, 27/1980), field with triple 12
(-1/36), and FREE ODDS at true payouts — edge exactly 0, labeled "the only
fair bet in the casino"; resolveRoll is a pure state machine.
verify_roulette.js checks every offered bet's EV in INTEGERS (ways*payout −
losses === −2, no floats); verify_craps.js re-proves the famous fractions and
drives scripted roll sequences. Local bankrolls ($1,000, restake when felted);
account sync for these games is a next step, not wired yet.

## Pai Gow Poker (v0.6.0)

The founder asked for "Pai Gow" twice (speech-to-text rendered it "pack out"
then "Paco" — decode charitably). src/PaiGow.jsx: 52 cards no joker (stated on
the felt), set five high / two low, dealer sets by a DOCUMENTED house way
(maximize the low among all 21 legal splits, tiebreak stronger high — pure,
deterministic, verified), copies to the banker, 5% commission printed and
exact. HONESTY RULE (Known vs Estimated): Pai Gow's edge is computationally
infeasible to enumerate, so it is SIMULATED on the player's device on demand
and always labeled SIMULATED — never presented like the enumerated edges on
the other tables. verify_paigow.js (17 checks) proves the comparator, the
foul-free splits, the house-way max-low property, copies-to-banker, the exact
commission, seeded-deterministic simulation in the sane band, and chip
conservation. Uses score5H/hiRank from the shared engine; casino design kit.

## Sound (v0.7.0)

src/sound.js is a synthesized foley engine — Web Audio only, zero assets, zero
dependencies. Every sound is built from oscillators and filtered noise: clay
chip clacks (two-layer, detuned per strike), chip cascades sized to the win,
card swish+snap, dice rattle with landing thumps, the wheel's slowing ticks
with a late ball drop and bounce, a win ARPEGGIO that resolves on the tonic chord (never a slot-machine jingle), glitter pings under the sparkle visuals,
a single low boom for SEVEN OUT. Rules: nothing before a user gesture
(pointerdown unlocks the context), nothing ever throws (safe in headless and
the verify vms), one persisted mute (SoundToggle, in every header), and LOUD
IS FOR WINNING — everything else sits low. The trainer stays silent on
purpose: it's the study room. Wired: casino kit (chips, BigWin), roulette,
craps, pai gow, both hold'em tables, the video poker machine.

## Juice (v0.8.0)

The endorphin layer, all in src/casino.jsx: Sparkles (twinkling stars over a
win), MarqueeLights (chasing bulbs on the felt rail), casCta's attract mode
(the primary button breathes when it's waiting for you), and a gold flash on
the bankroll pill when it grows. Same law as the gold: celebration fires on
WINS ONLY — losses stay dark and quiet. All animation respects
prefers-reduced-motion.

Mobile input rule (v0.8.0, learned from a real device): every page's shell
sets touch-action: manipulation on html/body/button/a — without it, two quick
taps on adjacent controls (picking two Pai Gow cards) read as a double-tap
zoom gesture and Chrome swallows BOTH clicks. Never remove it. Guarded
primary buttons (Pai Gow SET HANDS) use aria-disabled + a guidance nudge
instead of disabled, so an early tap teaches instead of doing nothing.

## Blackjack (v0.9.0)

src/Blackjack.jsx (bj.html) is the philosophy made playable: single deck,
S17, 3:2, double any two, split once (aces one card). STAND / HIT / DOUBLE
each print their EXACT expected value, recomputed live by full recursion over
the cards actually face up on the table, conditioned on the dealer's peek
(bjDealerDist skips the natural-completing hole card and renormalizes). No
strategy charts anywhere - the enumeration IS the advice (the ★). SPLIT is
the one label marked "≈": it prices one split hand exactly and doubles it,
ignoring the second hand's draw on the first's cards - the page says so.
engine/verify_blackjack.js (65 checks) re-proves it with hand-derivable
facts: rigged all-tens decks give exact ±1/0/±2 EVs, distributions sum to 1,
settlement conservation, and the universal basic-strategy poles (11v6 double,
20v10 stand, 5v10 hit, 88v6 split) must fall out of our own enumeration.
The suite caught a real bug on first run: bjSettle returned the stake on a
plain loss. Also v0.9.0: play.html (video poker) moved onto the casino design
kit - same engine, same paytable law, new room.
