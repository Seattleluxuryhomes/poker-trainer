#!/usr/bin/env node
/* Verifies the Hold Trainer's analysis (trainer.html) without a browser. `analyze(hand5)`
 * is a top-level function in the compiled <script>; we eval it in a vm sandbox and check
 * it against independently derivable 9/6 Jacks-or-Better facts:
 *   - 32 options, draw counts exactly C(47, 5-k) per hold size, probabilities sum to 1.
 *   - a dealt royal is held pat at EV 800.
 *   - dealt a made flush that is four to a royal (T-J-Q-K-8 suited), breaking the flush
 *     is correct: hold T-J-Q-K = (800 + 50 + 6·6 + 4·6 + 1·9) / 47 = 919/47 ≈ 19.55,
 *     against 6.0 for standing pat. (Each term hand-derivable: royal on the suited ace,
 *     straight flush on the suited nine, six flushes, six off-suit straights, nine
 *     high-pair pairs.)
 *   - a low pair out-ranks a lone high card (2-2-7-9-K rainbow holds the twos).
 *   - EV is per-coin linear: analyze knows nothing about bet size (that's payoutFor's
 *     job, checked in verify_play.js).
 * analyze is exact enumeration, so every comparison below is exact, not noisy.
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "trainer.html"), "utf8");
const body = html.split("\n<script>\n").pop().split("\n</script>")[0];

let ok = 0, fail = 0;
const check = (cond, msg) => { if (cond) { ok++; } else { fail++; console.error("  ✗ " + msg); } };
const close = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

const sandbox = {
  React: { createElement: () => ({}), useState: () => [0, () => {}], useMemo: (f) => f(), useCallback: (f) => f, useEffect: () => {}, useRef: () => ({ current: null }) },
  ReactDOM: { createRoot: () => ({ render() {} }) },
  document: { getElementById: () => ({}) },
  localStorage: { getItem: () => null },
  Math, console,
};
vm.createContext(sandbox);
vm.runInContext(body, sandbox);
// Top-level `const`s live in the context's lexical scope, not on the sandbox object.
const { analyze, CAT } = vm.runInContext("({ analyze, CAT })", sandbox);

const C = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1); return r; };

/* ---- structure: 32 options, exact draw counts, probabilities sum to 1 ---- */
{
  const opts = analyze([{ r: 2, s: 0 }, { r: 5, s: 1 }, { r: 8, s: 2 }, { r: 11, s: 3 }, { r: 13, s: 1 }]);
  check(opts.length === 32, `analyze ranks 32 holds (got ${opts.length})`);
  for (const o of opts) {
    check(o.draws === C(47, 5 - o.idxs.length), `hold of ${o.idxs.length} enumerates C(47,${5 - o.idxs.length}) draws (got ${o.draws})`);
    check(close(o.cats.reduce((a, b) => a + b, 0), 1), `hold [${o.id}] probabilities sum to 1`);
  }
  check(opts.every((o, i) => i === 0 || opts[i - 1].ev >= o.ev), "options sorted by EV descending");
}

/* ---- a dealt royal is held pat at exactly 800 ---- */
{
  const opts = analyze([{ r: 1, s: 1 }, { r: 10, s: 1 }, { r: 11, s: 1 }, { r: 12, s: 1 }, { r: 13, s: 1 }]);
  check(opts[0].id === "0,1,2,3,4", `pat royal: best hold is all five (got [${opts[0].id}])`);
  check(opts[0].ev === 800, `pat royal EV is exactly 800 (got ${opts[0].ev})`);
  check(opts[0].min === 800 && opts[0].max === 800 && opts[0].sd === 0, "pat royal is riskless");
}

/* ---- break a made flush for four to a royal: EV exactly 919/47 ---- */
{
  const opts = analyze([{ r: 10, s: 2 }, { r: 11, s: 2 }, { r: 12, s: 2 }, { r: 13, s: 2 }, { r: 8, s: 2 }]);
  check(opts[0].id === "0,1,2,3", `flush + 4-to-royal: best hold is T-J-Q-K (got [${opts[0].id}])`);
  check(close(opts[0].ev, 919 / 47), `T-J-Q-K EV is exactly 919/47 (got ${opts[0].ev})`);
  const pat = opts.find((o) => o.id === "0,1,2,3,4");
  check(pat.ev === 6 && pat.min === 6, "standing pat on the flush is a riskless 6");
  check(close(opts[0].cats[CAT.ROYAL], 1 / 47), "royal probability is exactly 1/47");
  check(close(opts[0].cats[CAT.STRAIGHT_FLUSH], 1 / 47), "straight-flush probability is exactly 1/47");
}

/* ---- a low pair beats a lone high card ---- */
{
  const opts = analyze([{ r: 2, s: 0 }, { r: 2, s: 1 }, { r: 7, s: 2 }, { r: 9, s: 3 }, { r: 13, s: 1 }]);
  check(opts[0].id === "0,1", `low pair over lone king (got [${opts[0].id}])`);
}

/* ---- a pat paying hand has that payout as its floor ---- */
{
  const opts = analyze([{ r: 11, s: 0 }, { r: 11, s: 1 }, { r: 4, s: 2 }, { r: 7, s: 3 }, { r: 9, s: 1 }]);
  const jacks = opts.find((o) => o.id === "0,1");
  check(jacks.min === 1, `holding the jacks guarantees at least 1 (floor ${jacks.min})`);
  check(jacks.id === opts[0].id, "holding the pair of jacks alone is optimal");
}

console.log(fail === 0 ? `✓ verify_trainer: all ${ok} checks passed` : `✗ verify_trainer: ${fail} of ${ok + fail} checks FAILED`);
process.exit(fail === 0 ? 0 : 1);
