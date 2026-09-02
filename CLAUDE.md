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
