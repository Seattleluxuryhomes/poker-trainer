# Portable tech — what to lift out of this repo, and how

> **Why this file exists.** Claude Code sessions do not share memory. A new
> chat starts blank and remembers nothing of the one that built this. The repo
> is the memory. This file is written so that a session with NO prior context —
> in this repo or in another one — can port these pieces correctly without
> anybody re-explaining them.
>
> Founder, 2026-09-28: "we would only be evolving... everything's going to be
> on its own server... I didn't realise that you guys can't communicate chat to
> chat." Correct. This is the fix: put the knowledge in the repo, not the chat.

Three things in this codebase are worth more outside a casino app than inside
one. They are listed in the order I would port them. Everything else here
(cards, dice, the casino design kit, the sound engine) is game-specific and
should be left behind.

---

## 1. Per-party redaction — the one to take first

**Where:** `rooms.mjs` `redactedView()` (L93–101) and `payloadFor()` (L113+).
**Proven by:** `engine/verify_rooms.js` L125–135.

### The idea

The server holds the whole truth. Each connected party is sent a view built
**for them**, server-side, with everything they are not entitled to see
removed before it goes on the wire. The client is never trusted to hide
anything, because a client that receives a secret has already leaked it.

```js
function redactedView(room, viewerSeat) {
  const s = JSON.parse(JSON.stringify(room.state));
  delete s.deck;                       // the deck NEVER leaves the server
  const show = s.revealed;             // after the reveal, live hands are public
  s.players.forEach((p, i) => {
    if (i !== viewerSeat && !(show && !p.folded)) p.hole = [];
  });
  return s;
}
```

Three properties make it work, and all three must survive a port:

1. **Deep copy first.** The view is built from a clone, so redaction can never
   mutate the authoritative state by accident.
2. **Deny by default, reveal by rule.** Hidden data is stripped for everyone
   except the viewer, and re-exposed only when an explicit condition says so.
   The condition is data on the server (`s.revealed`), never a client claim.
3. **Some things are never sent to anyone.** The deck is deleted
   unconditionally. There is no viewer for whom it is appropriate.

### The audit test is not optional

The test does not check that `redactedView` returns the right shape. It
captures **every payload a given client actually received over a whole game**
and asserts the forbidden keys are absent from all of them:

```js
let leaks = 0, deckLeaks = 0;
for (const p of marcus.payloads) {
  if (p.state.deck !== undefined) deckLeaks++;
  p.state.players.forEach((pl, i) => {
    if (i !== 1 && pl.hole.length > 0 && !p.state.revealed) leaks++;
  });
}
check(deckLeaks === 0, "the deck never appears in any client payload");
check(leaks === 0, `no opponent hole card ever reached Marcus pre-reveal (${marcus.payloads.length} payloads audited)`);
```

Port this shape of test, not just the function. A redaction function with no
payload audit is a comment, not a control. The audit catches the case the unit
test never will: a new code path that sends state through some other route.

### Mapping it to a transaction or legal app

| Poker | Your app |
|---|---|
| seat | party (buyer, seller, agent, escrow, counsel) |
| hole cards | seller financials, hardship, payoff figures, internal notes |
| the deck | anything with no legitimate viewer at all |
| `s.revealed` | a server-side stage or disclosure flag |
| payload audit | assert forbidden fields absent from every response, for every role |

This is the same rule BuilderBuyBox already states: permissions live in the
database and the API, never in the UI, and nothing buyer-visible ever contains
seller financials. This repo has a working, audited implementation of it.

---

## 2. Verification over trust — the testing method

**Where:** `engine/verify_*.js`, 15 suites, 819 checks. `build.sh` compiles
pages; each suite loads the **compiled** artifact in a Node `vm` and re-proves
its behaviour.

### The rule

A test must prove a number against something derivable **independently of the
code under test**. A test that asserts the code returns what the code computes
proves nothing.

Worked examples in this repo:

- The 2d6 distribution is checked against a brute-force enumeration of all 36
  ordered rolls, not against a hand-typed table.
- Blackjack expected values are checked on rigged all-tens decks where the
  answer is derivable on paper (exactly ±1, 0, ±2).
- Baccarat is cross-checked against the published 45.8597 / 44.6247 / 9.5156
  to within 1e-4.
- Money is checked for **conservation** after every action: the total across
  all players and the bank never changes except where a rule says it leaves.

### What it caught

This is the argument for the method, and it is worth repeating to anyone who
thinks it is overkill. Every one of these was found by a suite, not by a human
reading code:

- A settlement function returned the player's stake on a **plain loss**.
- A game phase handoff guarded on the phase *name* rather than the blocking
  state, so a resolved prompt sat in that phase forever. Zero of twelve
  simulated games finished before the fix; all twelve after.
- A headline statistic was measuring two different things at once: one square
  counted turns spent sitting still while all the others counted arrivals.
  Predicted 11.52%, observed 6.19%. Every other square was inside 0.3 points.

For a legal or financial app, point this at prorations, payoff figures,
commission splits and deadline calculations. Derive the expected answer from
the statute, the contract or a worked example, and assert against that.

---

## 3. The zero-dependency server and accounts

**Where:** `db.mjs` (108 lines), `api.mjs` (407), `server.mjs` (99),
`src/account.js` (215). Proven by `engine/verify_auth.js`, which boots the real
server on a temp DB and a random port and drives it over HTTP.

Routes: `POST /api/auth/signup`, `signin`, `restore`; `GET/DELETE /api/auth/me`;
`GET /api/auth/export`; `PATCH /api/profile`; `PUT /api/stats`;
`GET /api/leaderboard`; `GET /api/health`.

Worth taking:

- **The two-serializer invariant.** Every response about a user goes through
  `ownerView()` for the owner, or `publicView()` built from an explicit
  allowlist for everyone else. A field nobody added to the allowlist cannot
  leak. The test asserts forbidden keys are absent from *every* response.
- **Soft delete with a restore window**, one-tap export, rate-limit ledgers.
- **Zero npm dependencies.** `node:sqlite` and `node:crypto` only. Needs
  Node ≥ 22.5 and a durable disk mount, or the database resets on redeploy.
- **The static file whitelist in `server.mjs` is the security boundary.** It is
  an explicit `Map`. It must grow with every new page. A page that ships in the
  build but not in the whitelist 404s in production — that happened here, on a
  real phone, and `verify_auth` now proves every page answers 200 from the real
  server.

**Deferred and still missing:** password reset, email verification, and
third-party sign-in. All three need email infrastructure. Any serious app needs
them; budget for it.

---

## Smaller patterns worth carrying

- **The Coach pattern.** The explanation shown to the user is generated by the
  *same function* that makes the decision, not written as prose beside it. The
  reasoning therefore cannot drift from the behaviour, and a test asserts the
  advice equals what the system itself would do. For an app that recommends
  anything, this is the difference between an explanation and a claim.
- **Known / Estimated / Simulated are never rendered identically.** Where a
  number is exact it says so; where it is simulated it is labelled SIMULATED
  every single time. Never let an estimate wear the clothes of a fact.
- **No fake states.** Never show sent, saved, filed or received unless it
  actually happened.
- **Buildless + offline.** `build.sh` + `src/sw.js` produce an installable
  app with no bundler and no CDN that works with no signal. Useful anywhere the
  user is in a basement, a field, or a closing room with bad wifi.
- **Verify on a real phone viewport with real touch events, never forced
  clicks.** A forced click bypasses hit-testing and visibility. Two shipped
  bugs here were invisible-but-present controls that forced clicks happily
  "passed" on.

## What NOT to carry

The casino design kit, the sound engine, the card and dice math, and anything
in `src/*.jsx` that draws a table. Also: do not carry the game framing into a
product where money is real. Everything in this repo is practice chips by
design, and that constraint is load-bearing, not decorative.
