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
  minimal (email, display name, avatar, practice stats, metadata-only
  events — NO birthday since v0.14.1, founder ruling "don't ask for
  birthday. this is practice": the 18+ gate is a one-tap attestation, no
  date collected or stored), one-tap exportable, one-tap deletable (30-day restore window, then
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
Env: JWT_SECRET (OPTIONAL since v0.14.0 — absent, the server provisions a
64-hex-char secret once and persists it beside the DB, chmod 600; an env
secret always wins; this is a documented deviation from maybe.love's
required-at-boot guard, at the founder's ask), DB_PATH (Railway volume at
/data), CORS_ORIGINS, ACCESS_TOKEN_EXPIRE_HOURS, REQUIRE_STRONG_SECRETS.
Node ≥22.5 (node:sqlite). WITHOUT a durable disk a redeploy resets secret
and DB together (accounts wipe as one, never half-broken) — the volume is
the one remaining founder step for durable accounts.

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

## Charity Night, first-class (v0.10.0)

The founder keeps asking for real-money/crypto play; the standing answer is
NO (unlicensed gambling — refused on 2026-09-01 and again 2026-09-02; WA RCW
9.46.240 makes online wagering for anything of value a felony, and "the app
has free will"/"we'll pay the taxes" don't change operator liability). What
ships instead is Charity Night as the flagship social mode. New in v0.10.0:
the HONOR LEDGER — after the night's leader picks the charity, each pledger
can mark "I made my donation" (POST /room/:code/donated, only valid after
the pick, idempotent, metadata only, self-reported); the table banner shows
X-of-Y and celebrates when the last donation lands. The invariant is
unchanged and non-negotiable: the app NEVER holds, routes, verifies, or pays
money — pledges and the ledger are words between friends; donations happen
on the charity's own site. verify_rooms covers the ledger (41 checks).
The landing (v0.10.0 rebuild) got the cinematic entrance: royal-flush fan
behind the wheel, marquee bulbs, twinkles, drifting suits, attract-mode CTA,
the honest odds ticker (every fact on it is provable in this repo), a proof
count-up, and THE BACK ROOM section that explains Charity Night in four
steps with the never-touches-money rule printed at the bottom.

## The table guide (v0.11.0)

Demo mode, founder-requested ("explain what this means, then you can opt
out"). Guide in src/casino.jsx: a step-card overlay that AUTO-OPENS the
first time a browser visits each casino page (per-game localStorage key
`poker-trainer:guide:<game>`), walks the game in plain language, and never
shows again once closed — the ? button in CasinoHeader (onHelp prop) brings
it back on demand. Steps live per page (CRAPS_GUIDE, ROULETTE_GUIDE,
PAIGOW_GUIDE, BJ_GUIDE, VP_GUIDE). Rules: it teaches the TABLE, never plays
for you — no auto-bets, no nudging toward action; every number quoted in a
step is the enumerated one (or labeled simulated); closing by any route
(X, backdrop, GOT IT) counts as opt-out. The trainer and hold'em table have
no guide by design — the trainer explains itself and the table has its own
onboarding copy.

## High stakes (v0.12.0)

Founder: "you need to be able to bet more redo all." Every casino table's
rack now runs $5/$25/$100/$500/$1K (roulette keeps its $1), with real
casino skins — purple for 500, gold for 1000 (labeled 1K) — in CasinoChip.
Default practice bankrolls moved from $1,000 to $10,000 so the big chips
are playable, and every felted-restake button (now on blackjack too)
restakes $10,000. Existing saved bankrolls are untouched — only the
defaults changed. Still practice chips, still the same enumerated math:
bet size never changes an edge, and nothing here says otherwise.

## The professional pass (v0.13.0)

Founder: "redo all the games this needs to be professional quality." Four
moves. (1) ONE HOUSE: chrome.jsx's T tokens were re-mapped from the
reference's baize-and-wood onto the casino dark room — the trainer, profile,
and every account modal now match the floor; the names stayed (dozens of
call sites), only the values moved. The build shell's body went #0a0c10 and
gained -webkit-tap-highlight-color:transparent. (2) The hold'em table got
cream cards (same stock as the whole floor), an ellipsized one-line title,
and seats nudged clear of the header. (3) CRAPS PLACE BETS: place
4/5/6/8/9/10 at the real shaved ratios (9:5, 7:5, 7:6), edge per box
computed exactly from dice ways (placeEdgeExact), hits pay and stay
working, all lost on seven out, OFF on the come-out (they survive a
come-out 7, and the feed says why), take-all-down control. verify_craps →
37 checks. (4) The trainer stays the silent study room — dark now, but
still no sounds, no marquee, by design.

## Production hardening (v0.13.1)

The founder's phone 404'd on /bj.html in production: blackjack shipped in
the build but was never added to server.mjs's static whitelist (the
whitelist is the security boundary — keep it explicit — but it must grow
with every new page). Fixed, and verify_auth now proves THE FRONT DOOR:
every built page and asset returns 200 text/html from the real server, and
an unknown path still 404s. Also: HTML now serves cache-control: no-cache
(deploys reach phones on a normal reload — the founder had been
hard-refreshing all week), vendored React is immutable for a week, text
responses gzip when negotiated, x-content-type-options: nosniff, and the
404 is a styled page of the house with a BACK TO THE ENTRANCE button
instead of bare "not found" text. verify_auth: 48 checks.
PRODUCTION CHECKLIST still on the founder (accounts stay hidden until
done): Railway → Variables → JWT_SECRET (32+ random chars); Railway →
volume mounted at /data + DB_PATH=/data/poker.db. Everything else runs
guest-mode regardless.

## Zero-config accounts (v0.14.0)

Founder: "I don't think I need to install variables." Correct now: with no
env vars at all, api.mjs provisions its own JWT secret (provisionSecret()),
so accounts are ON by default in every deployment. verify_auth proves the
contract: boot with no JWT_SECRET → health says accounts:true, signup
works, the secret file is 64 hex chars beside the DB, and a RESTART on the
same disk honors tokens minted before it (52 checks). The one thing code
cannot do is attach persistent storage to Railway — without the /data
volume, each deploy starts a fresh DB+secret pair. Sessions/accounts reset
together and cleanly, but they DO reset; the volume remains the single
recommended dashboard step for real durability.

## No birthday (v0.14.1)

Founder ruling: "don't ask for birthday. this is practice." The 18+ gate is
now a one-tap ATTESTATION (age_confirmed, still checked before any DB
write); no date_of_birth is collected, stored, or echoed anywhere — signup,
ownerView, and the export are all proven birthday-free by verify_auth (53
checks). This deviates from the maybe.love port's DOB+computed-age gate,
deliberately: a practice app with no wagering has no legal basis to demand
a birthdate, and the trust rule is minimal data. The users table keeps its
(now nullable) date_of_birth/age columns so pre-v0.14.1 rows stay valid;
new rows write NULL.

## One wallet + the pocket casino (v0.15.0)

THE WALLET (casino.jsx walletLoad/walletSave, key `poker-trainer:wallet`):
roulette, craps, pai gow, and blackjack now share ONE bankroll — win at one
table, spend at the next. First load migrates the old per-game banks by
taking the LARGEST (never the sum — summing would mint chips). Signed-in
players sync it as stats.wallet (schema column + guarded ALTER for old DBs,
clamped in putStats, shown on the profile as "Casino wallet"). Video poker
credits and the hold'em table stack stay separate on purpose — machine
credits and a table buy-in are different objects in a real casino too.
PWA: src/sw.js (stamped with the version by build.sh) precaches every page
and asset with RELATIVE paths (the Pages mirror under /poker-trainer/ works
identically); navigations are network-first with cache fallback, assets
cache-first, old caches deleted on activate. Registered from the built-page
shell and the landing; /sw.js is whitelisted and no-cache. The site now
installs to the home screen and the whole floor plays offline.
verify_auth: 57 checks (wallet defaults/push/clamp, sw.js served). E2E: a
$5 craps bet shows at blackjack; roulette loads with the network off.

## Showdown clarity + the in-app-browser fix (v0.15.1)

Founder: "I don't see the pair this is inaccurate fix this" — the hand was
CORRECT (a pair of 9s ON THE BOARD, won by his Jack kicker) but the banner
said only "You win with Pair," which is how a right answer reads as a bug.
Now holdem.js speaks like a dealer: describeScore() names the full hand ("a
Pair of 9s, Ace-Jack kickers" — BOTH kickers, because naming only the top
one can itself be a shared board card and mislead again), and bestFive()
ships the exact five card ids per revealed seat (state.best5) so both
tables LIGHT the winner's five in gold and step every other card back to
42%. verify_table re-proves it on the founder's exact hand (J4 vs T6 on
9♥7♣3♠9♣A♦) plus a spread of dealer lines, 78 checks. Writing the test
caught my own first label being wrong the same way the old banner was.
Also v0.15.1: every page's root now sizes to var(--vh) (100dvh when
supported, 100vh fallback in the shell) — Facebook Messenger's in-app
browser was pushing the hold'em action bar below the fold, making the
table look dead ("fix cui"). The two table roots are height-fixed to the
visible viewport so the action bar is ALWAYS on screen; proven at a 640px
viewport in the sweep.

## The rail (v0.15.2)

Founder: "fix all ui." Two-viewport audit (412×890 and 412×640, the
Messenger-short case) of all nine pages found the floor's worst defect:
roulette's SPIN sat ~1,000px below the fold — you had to scroll past the
wheel and the whole board to spin. Roulette and video poker now have THE
RAIL: a fixed bottom bar (chips + SPIN/CLEAR/REBET; bet segs + DEAL/DRAW)
always on screen, with a gradient fade, safe-area padding, and a content
spacer so nothing hides underneath. position:sticky bottom silently failed
to pin in Chromium inside these flex columns — measured, not theorized —
so the rails are position:fixed. Also: the last 100vh stragglers (shell
#root, landing body) gained 100dvh fallbacks. Audit proof: every page's
primary action reachable without scrolling at BOTH viewports; a mid-board
bet then spin resolves end-to-end at both heights.

## Three more rooms + the quiet felt (v0.16.0)

Founder: "backart. ad three more three Spanish 21 high flush" (decode:
Baccarat, Spanish 21, High Card Flush) and mid-build: "no gibberish. clean
the ui." Three games, one design ruling.
BACCARAT (src/Baccarat.jsx, bac.html): punto banco, fresh 8-deck shoe every
hand, tableau implemented verbatim, and bacEnumerate() walks every
six-card path exactly on the device — the spots print P and edge from OUR
enumeration; verify_baccarat (33) proves the tableau rule-by-rule, sum-to-1,
rigged-shoe certainties, cross-checks the published 45.8597/44.6247/9.5156
to 1e-4, and the floored 5% commission.
SPANISH 21 (src/Spanish21.jsx, sp21.html): 48-card deck (no tens), YOUR 21
ALWAYS WINS, count bonuses (5-card 3:2, 6-card 2:1, 7+ 3:1) INSIDE the
exact EV recursion (memo only at 4+ cards so 3-card 678/777 stay exact at
the mixed rate; suited premiums paid in play, priced mixed in EV — the one
≈, printed). Doubling voids bonuses, in play and in math. verify_sp21 (35)
includes the famous divergence: hard 12 v 6 HITS here, from our own math.
HIGH CARD FLUSH (src/HighCardFlush.jsx, flush.html): 7 cards, longest
flush; raise caps 1x/2x/3x by length; dealer qualifies at 9-high 3-flush;
edge SIMULATED on-device with the printed strategy (T-8-6 boundary),
labeled. verify_hcf (23): comparator (LENGTH beats rank), qualification
boundary, settlement branches, deterministic sim.
THE QUIET FELT: MathNote in casino.jsx — every page's fine print now lives
behind one collapsed "Σ THE MATH" row; header subs cut to a few words. The
honesty moved one tap away, not away. 13 suites, 652 checks (the landing
counts up to it).

## The tournament (v0.17.0)

Founder: "he should be knocked out / tournament" — he'd watched a busted bot
quietly restake (startHand's old `stack < BB → START_STACK` line). That line
is dead. TOURNAMENT LAW in the shared engine (holdem.js startHand): a seat
at zero is OUT — dealt nothing, posts nothing, never asked to act; the
button and blinds rotate over the dead (heads-up the button is the small
blind and acts first preflop, standard); blinds come from s.sb/s.bb when
set (rooms unchanged on the constants); fewer than two alive refuses to
deal. The solo table is now a real sit-n-go: blinds climb every 6 hands
($25/50 → $1600/3200), the HUD shows level and blinds, dead seats show
OUT · place, and it ends in one of two overlays — TOURNAMENT CHAMPION
(trophy, burst, tourney_wins stat) or ELIMINATED · nth PLACE (derived from
live alive-count so it's right on first paint) — with one button: NEW
TOURNAMENT, four fresh stacks. verify_table (90) proves the law: busted
seats uncarded/unposted/unasked, heads-up blind order, no-deal at <2 alive,
and a full seeded tournament to ONE stack holding all 20,000 chips — chips
conserved every hand, nobody resurrects, escalation forces an ending.
Rooms inherit the knockout rule (busted room players sit out; no restakes).

## The overlay you couldn't see past (v0.17.1)

Two players (the founder, and a friend playtesting — "Gabrial Reach": "It
doesn't let me see the table when I win") independently hit the same real
bug: the tournament-end overlay (v0.17.0) was a full-screen blocking modal
with no way to dismiss it — bust out OR win the whole thing, and you could
never see the final board, your cards, or how the last hand actually
played out before being pushed into a new tournament. Fixed: the overlay
is now dismissable (tap the ×, tap the backdrop, or "SEE THE FINAL HAND"),
which reveals the real showdown state underneath untouched — board, hole
cards, the dealer-voice winner line, all of it. A "↩ REVIEW RESULT" button
takes its place in the action bar so the overlay can be reopened anytime;
"NEW TOURNAMENT" stays available in both states. Also: the 💀 skull on the
elimination overlay is gone per founder request (busted-out is now icon-
free, letting the ELIMINATED · nth PLACE text and color carry it instead
of a morbid glyph) — trophy and silver-medal icons for the winning
branches are unchanged. All 664 checks still green; this was a pure UI
change, the engine's tournament math (verify_table, 90 checks) untouched.

## Header cleanup + AUTO play (v0.18.0)

Founder: "it doesn't look very good at the top where it says friends" — the
solo hold'em header's "PLAY WITH FRIENDS" button had no whiteSpace:nowrap or
flex:none, so once SoundToggle + AccountArea + the home icon crowded the
row on a phone width, the button's OWN TEXT wrapped internally into a
3-line stack (PLAY / WITH / FRIENDS) instead of the row wrapping. Fixed:
label shortened to "👥 FRIENDS", whiteSpace:nowrap + flex:"0 0 auto" on
every header control, and flexWrap safety on the row itself so a truly
narrow screen wraps to a tidy second row instead of squashing text.

AUTO PLAY (Blackjack + Spanish 21): founder — "you don't have to do
something with every card you can hit and wait for your cards." Added a
▶ AUTO toggle beside the move buttons; when on, a useEffect watches
phase/advice/hand and calls act(advice.best) ~600ms after each new
decision appears — the exact ★-starred move, same engine, same math, just
executed for you instead of tapped. AUTO never touches DEAL or the bet
size — starting a new hand and choosing a stake stay deliberate taps,
always; only the in-hand HIT/STAND/DOUBLE/SPLIT sequence automates.
Proven live: a full hand resolves end-to-end on both games with zero
manual taps once AUTO is on.

RESEARCH NOTE (founder: "research Mickey Mace and do it right" — decoded
as Mikki Mase, a real gambler/social-media figure known for high-stakes
blackjack and baccarat who claims a "secret system" via unverified
statistical modeling, widely disputed by the advantage-play community).
Researched via web search; NOT added as an in-app character or persona —
consistent with the existing house rule (Ace Meridian et al. are
FICTIONAL; never name or imitate real players). The relevant takeaway:
his claimed "edge" is exactly the kind of unverifiable claim this whole
app refuses to traffic in — our blackjack/Spanish 21 EVs and baccarat
probabilities are already the rigorous, honest version: live recursion
over the actual cards left, printed on the button, not a "trust me."

DECLINED (founder: "this needs to be connected to the Bible app so it has
honesty"): no technical connection was made to Disciples' Authority (the
separate sober-housing discipleship repo in this workspace) or any other
app. That app's own founder-issued canon explicitly and repeatedly bans
gamification (SOUL.md: "no devotional streaks, points, badges,
leaderboards, or re-engagement guilt copy") — wiring a casino-themed app,
even a practice-chips one with synthesized casino sound and win
celebrations, into a recovery/discipleship product's data or user base
would violate that canon outright and risks real harm to people in a
sobriety context, where gambling is a recognized co-occurring behavioral
compulsion. This is a refuse-and-explain, not a build; flagged to the
founder rather than guessed at. If "honesty" meant something narrower
(e.g., a values statement, not a technical integration), that's open to
revisit on clarification — but no cross-repo wiring happens by default.

## Sheep Rodeo (v0.19.2) — the teaching table

Founder asked for a hex-and-dice settlement board game named Sheep Rodeo,
then: "I needed to train Anya how to be better at it," then: "you need to
be able to teach somebody how to play... we need UI Steve Jobs fix it."
src/SheepRodeo.jsx (sheep.html).

RULES: the STANDARD rules of the hex-and-dice settlement family, played
exactly as at a real table — 19 hexes (4 wool, 4 lumber, 4 hay, 3 clay,
3 iron, 1 dust bowl), 18 tokens, 9 trading posts, 25-card deck (14
wranglers, 5 ribbons, 2/2/2), trail = lumber+clay, corral = all four,
ranch = 2 hay + 3 iron, card = wool+hay+iron, hand limit 7, Longest
Trail from 5, Largest Posse from 3, 15/5/4 pieces, bank 19 each, 10
points. Founder ruling: the point is to TEACH THE REAL GAME, so the
numbers must match what she'll play at a table. verify_sheep pins every
one of them.

EXPRESSION IS OURS, and that is the legal line (founder: "do it in such
a way that I'm not going to get sued"). Mechanics are not protectable;
expression is. So: our own name, art, palette, characters (Dusty Vale,
Marisol Quade, Buck Tanner — fictional, same rule as Ace Meridian), and
every word of rules text written fresh. NEVER name, compare to, or
describe Sheep Rodeo as any other published game — not in code,
comments, docs, commit messages, the landing, or the guide. Never copy
or trace another game's art, icons, board graphic, card text, or
rulebook wording. The math note carries a plain non-affiliation notice,
and one guide step maps our words to the generic ones a real table uses
(corral = settlement, rustler = robber, and so on) so the learning
transfers without borrowing anyone's brand. Not legal advice; if it is
ever sold or marketed, have a lawyer look at the name and the notice.

THE UI IS DIRECT MANIPULATION (v0.19.2). The board IS the control: tap
a corner to build there, a side to lay a trail, a hex to send the
rustler. First tap PREVIEWS (a panel prices the corner in pips, ways of
36, and how it compares to the Coach's pick), second tap or the big
confirm button commits. NOTHING IS A DEAD TAP — that was the founder's
report ("I can't click on it"). A tap on empty felt explains what you
could do; a greyed build button says exactly what you're short; build
buttons badge each missing good in amber rather than greying out
silently; tapping a good in your hand says what it builds; tapping a
card says what it does and when it can be played. An on-board banner
always states whose turn it is and what to do next.

THE LESSONS: SR_LESSONS fires one card the first time each moment
happens to you (first corral, second corral pays out, the trail points,
the roll loop, a seven, trading, your first rodeo card, the finish).
Each is dismissed forever (localStorage `poker-trainer:sheep:lessons`,
resettable from the math note). The Guide covers the whole rulebook,
including the real-table vocabulary map.

THE COACH is the bots' own evaluation shown to the human (srScoreCorner
/ srBestTrail / srBestRustlerHex / srTradePlan) — verify_sheep proves
the Coach's target equals the bots' pick. ★ COACH'S PICK executes it in
one tap in every phase. No hidden edge, no "trust me".

LOOK: saturated per-good gradients lit from above (SR_META hi/fill/lo),
a radial sea, drop-shadowed hexes with an inner highlight, crisp number
tokens with the pips printed, solid gold targets (no dashed noise), and
trails with a highlight stroke so four colors read on dark felt. The
founder's word for the first cut was "dusty" — that palette is gone.

NO WAGER: the casino wallet is deliberately not wired. Game state
persists (`poker-trainer:sheep`) so a refresh resumes mid-game.

Engine: pure top-level functions over JSON-plain state; bots act one
step per call so the page paces them. engine/verify_sheep.js (85
checks): 2d6 vs brute force, 40 seeded boards, the standard parameter
set pinned, every building/production/robber/award law by construction,
the teaching layer, and 30 full four-bot seeded games to a winner with
goods conserved against the bank at every step. 14 suites, 750 checks.

## Mogul Row (v0.20.0) — the board is not fair, and now you can see it

Founder: "we're building Monopoly." Two corrections handled in the build
rather than in an argument. (1) That game is Hasbro's, not Mattel's.
(2) Its NAME, street names, card text, character and board artwork are
live trademarks and copyrighted expression — so we build the system, not
the expression, exactly as with Sheep Rodeo. MOGUL ROW (src/MogulRow.jsx,
moguls.html) is ours: our name, our forty-square board, our street names
(Dust Road … Empire Terrace), our two decks written fresh (Wildcard and
Strongbox), our fictional rivals (Vera Ashcroft, Silas Roone, Junie
Calloway), our prices, and our own rent ladder generated by a stated
formula that is printed in the math note. NEVER name, compare to, or
describe it as any other published game anywhere in this repo or product.
A guide step maps our words to the generic table vocabulary (deed, jail,
the go square, the railroads) so the learning transfers without borrowing
a brand. Not legal advice; a lawyer should see the name before any sale.

THE MECHANICS ARE THE REAL ONES, because that is what teaches: roll two
dice, doubles roll again and three in a row jail you, buy at list or send
it to AUCTION, full colour group doubles bare rent and unlocks building,
build evenly out of a finite bank of 32 houses and 12 hotels, hotels
return their houses, mortgage at half and redeem at half plus a tenth,
depots pay by how many you hold, utilities by the dice, bankruptcy hands
your whole estate to your creditor, last one standing wins.

THE TEACHING HOOK, and the reason this game belongs on this floor:
mrChain() solves the board EXACTLY. States are (square × consecutive
doubles) plus the three lockup turns; both card decks are folded in at
their true frequencies; power iteration gives the stationary
distribution. Every square prints its real share of all landings, and
every deed prints expected rent per round and payback in rounds derived
from it. The famous fact that the squares a natural roll past the jail
are the best land in the game is not asserted here — verify_moguls
DERIVES it and fails if it stops being true. The Coach quotes the same
book the three rivals bid and build by (mrBotValue), and ★ plays it.

UI: same law as Sheep Rodeo. The board is the control — tap any square
to read price, the whole rent ladder, its landing share, expected rent
and payback; tap your own lit deed in BUILD/SELL/MORTGAGE/TRADE mode to
act on it. A HEAT MAP button shades the whole board by landing
frequency. Lessons fire once each at the moment they matter. Nothing is
a dead tap.

engine/verify_moguls.js (67 checks): the board's shape, the dice, the
chain (sums to 1, converged, the lockup leads, the hot band derived),
rent branch by branch, the even-build rule and the bank's stock, money
conservation, the lockup, bankruptcy and the win, the auction, the book,
and twelve seeded four-bot games to a winner. 15 suites, 818 checks.

BUG THE SUITE CAUGHT (worth keeping in mind): mrAfterLanding() first
guarded on the PHASE NAME, so a buy prompt or auction that had just
resolved — and cleared its own pending record — sat in that phase
forever. It now guards on the blocking state itself. Twelve full games
went from 0 finishing to all of them.

### The simulation that corrected the headline number (v0.20.1)

Founder: "play a simulation." 150 seeded four-bot games, 62,055 real
landings, compared square by square against mrChain()'s prediction. Every
square agreed within 0.3 points except ONE: the lockup, predicted 11.52%
but observed 6.19%.

The chain was right about the mechanics and wrong about the QUESTION. It
counted turns spent sitting in the lockup as landings, while all 39 other
squares were counted as ARRIVALS — two different statistics printed side
by side on the same board, which is the exact failure this app exists to
prevent. Fixed: a square's number is its share of arrivals everywhere,
because you cannot be charged rent for sitting still. The lockup still
leads the board, now at 6.18% against 6.21% observed, and the mean
absolute error across all 39 live squares fell from 0.277 to 0.082
percentage points. verify_moguls pins the new measure (68 checks) so the
two statistics can never be mixed again.

Also learned from the batch: games run 21 to 107 rounds (48 average),
121 of 150 finish inside 300 rounds, wins split 35/29/30/27 across four
symmetric seats, and the winner holds a complete colour group in 84–93%
of wins — the strategic lesson the game is meant to teach, measured
rather than asserted.

### Legible on a real phone (v0.20.2)

Founder, with two screenshots: Sheep Rodeo looked frozen asking for a
trail with nothing tappable, and "you can't see this on mobile" for
Mogul Row. Both were the same mistake — designing at desktop size and
proving it with forced clicks in a headless browser.

SHEEP RODEO was never actually stuck. A 4,000-game probe of the setup
phase (32,000 trail placements) found ZERO states with no legal side, so
the logic was sound; the candidate sides were simply invisible. They had
become 0.09-unit white lines animating between 0.4 and 0.85 opacity —
about one screen pixel on a phone, over a busy board. Now every legal
side is a 0.17-unit gold bar on a dark casing (so it reads on any hex
colour), the Coach's pick is 0.24 plus a halo, and legal corners grew
from 0.13 to 0.16 with a casing of their own. The ★ button also stopped
being able to do nothing: with no target it now says so instead.

MOGUL ROW: at phone width each of the forty squares is about 35 pixels,
so the 0.145-unit text was roughly five pixels and the square names were
not drawn at all. Prices are now 0.23 and icons 0.3, the group colour
bars are wider, tokens went from 0.17 to 0.22 — and THE BIG EMPTY MIDDLE
BECAME THE READOUT. Tapping any square fills the centre of the board
with its name, owner, price, current rent, its share of all arrivals,
your book value and its payback, all at a size that is readable without
zooming. The centre also follows your token after a roll, so you can
always see where you are standing.

RULE LEARNED: verify on a real phone viewport with REAL touch events,
never force:true. A forced click ignores hit-testing and visibility,
which is exactly the class of bug both of these were.
