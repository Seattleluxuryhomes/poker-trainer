# Poker Trainer

A video-poker hold trainer and playable games behind a small landing page — all
client-side, no install, no accounts, no tracking. Modeled directly on the
open-source [cribbage-trainer](https://github.com/ghug/cribbage-trainer)
(public domain): same buildless architecture, same table aesthetic, same
philosophy — **every number is enumerated, never estimated**.

- **Hold Trainer** (`trainer.html`) — deal five cards, tap the ones to hold, and
  see all 32 possible holds ranked by exact expected value (9/6 Jacks or Better,
  coins per coin at max bet), each fully explained: the odds of every final hand,
  the guaranteed floor, the hit rate, the volatility. Tracks how often you find
  the best hold.
- **Play** (`play.html`) — a complete 9/6 Jacks or Better machine: practice
  bankroll, bet 1–5 coins, royal pays 4000 at max bet, classic paytable panel.
  The Hint button asks the trainer's engine, so advice and analysis can never
  disagree.
- **Hold'em Table** (`table.html`) — a no-limit hold'em table UI (pot, community
  cards, seats, fold / call / raise slider), translated 1:1 from a
  founder-supplied F# Fable/Elmish component. Today it is the table with working
  action state; the dealing/betting-round/showdown engine is the next build step.

## Run & build

Open `index.html` in any browser (or `trainer.html` / `play.html` /
`table.html` directly). The pages are pre-compiled to plain JS and React is
vendored in `vendor/` (no CDN), so everything runs fully offline.

Edit the sources in `src/` (`PokerTrainer.jsx`, `PokerPlay.jsx`,
`PokerTable.jsx`, `landing.html`, plus the shared `engine.js` / `chrome.jsx`),
then regenerate the root pages:

```bash
./build.sh      # needs tsc (global, or fetched via npx)
```

## Android (Obtainium)

`android/` wraps the app in a tiny offline WebView APK (no INTERNET permission,
no dependencies beyond the platform WebView). Pushing a `v*` tag makes CI
build, sign, and attach the APK to a GitHub Release, which Obtainium installs
and updates from. Setup, signing, and the details:
[docs/ANDROID.md](docs/ANDROID.md).

## Verify the engine

```bash
node engine/verify_rank.js      # all 2,598,960 hands vs the published frequency table
node engine/verify_trainer.js   # trainer.html: exact EVs vs hand-derived facts
node engine/verify_play.js      # play.html: paytable math + hint == analysis
node engine/verify_table.js     # table.html: the Elmish reducer's supplied semantics
```

The verify scripts eval the **compiled pages** in a Node vm — they test what
ships, not a parallel copy of it. `verify_rank.js` also carries an independent
re-implementation of the categorizer as a second opinion.

`CLAUDE.md` holds the full design notes — the EV model, the architecture, the
port's provenance, and known limitations.
