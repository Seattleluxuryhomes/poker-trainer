/* Casino foley, synthesized — no audio files, no dependencies, the Web Audio
 * API only. Every sound is built from oscillators and filtered noise, tuned to
 * read as the real object: clay chips clack in two layers, cards swish and
 * snap, the wheel ticks and slows before the ball drops, dice rattle then
 * thump, wins arrive as a chord (a chord, not a slot machine). build.sh
 * prepends this before chrome/casino so every page can speak.
 *
 * Rules of the room:
 *  - Nothing plays before a user gesture (autoplay policy: the context is
 *    created/resumed on first pointerdown) and nothing THROWS anywhere —
 *    every call is safe in headless browsers and the verify scripts' vm.
 *  - One mute toggle, persisted; muted means silent AND no audio work.
 *  - Loud is for winning. Everything else sits low in the mix.
 */

const SND_KEY = "poker-trainer:sound";
const SND = { ctx: null, master: null, noiseBuf: null, muted: false, ready: false };
try { SND.muted = (typeof window !== "undefined") && window.localStorage.getItem(SND_KEY) === "off"; } catch { /* default on */ }

function sndSaveMuted() {
  try { window.localStorage.setItem(SND_KEY, SND.muted ? "off" : "on"); } catch { /* private mode */ }
}

function sndCtx() {
  if (SND.muted || typeof window === "undefined") return null;
  try {
    if (!SND.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      SND.ctx = new AC();
      SND.master = SND.ctx.createGain();
      SND.master.gain.value = 0.9;
      SND.master.connect(SND.ctx.destination);
      // one second of white noise, reused by every noise voice
      const buf = SND.ctx.createBuffer(1, SND.ctx.sampleRate, SND.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      SND.noiseBuf = buf;
    }
    if (SND.ctx.state === "suspended") SND.ctx.resume();
    return SND.ctx;
  } catch { return null; }
}

/* unlock on the first gesture so later scheduled sounds are allowed */
try {
  if (typeof document !== "undefined") {
    document.addEventListener("pointerdown", () => { sndCtx(); }, { capture: true });
  }
} catch { /* non-DOM host */ }

/* ---- voices ---- */
function sndTone({ freq, type = "sine", when = 0, dur = 0.1, gain = 0.2, endFreq }) {
  const ctx = sndCtx();
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(SND.master);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  } catch { /* voice dropped */ }
}

function sndNoise({ when = 0, dur = 0.06, gain = 0.2, freq = 2000, q = 1, type = "bandpass" }) {
  const ctx = sndCtx();
  if (!ctx) return;
  try {
    const t0 = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = SND.noiseBuf;
    src.loop = true;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(SND.master);
    src.start(t0, Math.random()); src.stop(t0 + dur + 0.02);
  } catch { /* voice dropped */ }
}

/* ---- the foley board ---- */
const sfx = {
  toggle() { SND.muted = !SND.muted; sndSaveMuted(); if (!SND.muted) { sndCtx(); sfx.chip(); } return SND.muted; },
  isMuted() { return SND.muted; },

  /* one clay chip set down: noise transient, two damped pings, a low body knock */
  chip(when = 0) {
    const d = 0.93 + Math.random() * 0.14;
    sndNoise({ when, dur: 0.018, gain: 0.22, freq: 3800, q: 0.8, type: "highpass" });
    sndTone({ when, freq: 2050 * d, type: "triangle", dur: 0.055, gain: 0.16 });
    sndTone({ when: when + 0.012, freq: 3300 * d, type: "sine", dur: 0.04, gain: 0.08 });
    sndTone({ when, freq: 640 * d, type: "sine", dur: 0.045, gain: 0.07 });
  },
  /* a payout sliding across the felt: a cascade sized to the win */
  chips(n = 4) {
    const count = Math.max(2, Math.min(10, n));
    for (let i = 0; i < count; i++) sfx.chip(i * (0.045 + Math.random() * 0.02));
  },
  /* card off the deck: swish then snap */
  card(when = 0) {
    sndNoise({ when, dur: 0.08, gain: 0.1, freq: 1100, q: 0.7 });
    sndNoise({ when: when + 0.07, dur: 0.015, gain: 0.14, freq: 2600, q: 1.2 });
  },
  cards(n = 5) { for (let i = 0; i < n; i++) sfx.card(i * 0.07); },
  /* soft UI tick */
  click() { sndNoise({ dur: 0.012, gain: 0.08, freq: 2200, q: 1 }); },

  /* dice: rattle in the hand, thrown, two thumps on the felt */
  dice(durMs = 900) {
    const rattleEnd = durMs / 1000 - 0.18;
    for (let t = 0; t < rattleEnd; t += 0.055 + Math.random() * 0.05) {
      sndTone({ when: t, freq: 1400 + Math.random() * 1600, type: "square", dur: 0.02, gain: 0.035 });
    }
    sndTone({ when: rattleEnd, freq: 190, endFreq: 80, type: "sine", dur: 0.13, gain: 0.3 });
    sndNoise({ when: rattleEnd, dur: 0.03, gain: 0.15, freq: 900, q: 1 });
    sndTone({ when: rattleEnd + 0.09, freq: 165, endFreq: 70, type: "sine", dur: 0.12, gain: 0.22 });
  },

  /* the wheel: ticks that stretch out as it slows; the ball drops late and bounces */
  spin(totalMs = 3400, dropMs = 2400) {
    let t = 0, gap = 0.03;
    const total = totalMs / 1000;
    while (t < total) {
      sndNoise({ when: t, dur: 0.012, gain: 0.055, freq: 4200, q: 2, type: "bandpass" });
      gap *= 1.045; // the slow-down
      t += gap;
    }
    const drop = dropMs / 1000;
    sndTone({ when: drop, freq: 2600, type: "triangle", dur: 0.04, gain: 0.16 });
    sndTone({ when: drop + 0.09, freq: 2100, type: "triangle", dur: 0.035, gain: 0.12 });
    sndTone({ when: drop + 0.16, freq: 1800, type: "triangle", dur: 0.03, gain: 0.09 });
  },

  /* glitter: a spray of tiny high pings, rising — the sound of sparkle */
  sparkle(n = 6, when = 0) {
    for (let i = 0; i < n; i++) {
      const t = when + i * (0.05 + Math.random() * 0.04);
      sndTone({ when: t, freq: 1800 + i * 260 + Math.random() * 500, type: "sine", dur: 0.16, gain: 0.05 });
    }
  },
  /* winning is an ascending arpeggio with glitter on top; big wins run the second octave */
  win(big = false) {
    const run = big
      ? [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568]
      : [523.25, 659.25, 783.99, 1046.5];
    run.forEach((f, i) => {
      sndTone({ when: i * 0.07, freq: f, type: "triangle", dur: 0.42, gain: 0.12 });
      sndTone({ when: i * 0.07, freq: f * 2, type: "sine", dur: 0.3, gain: 0.04 });
    });
    // resolve on the tonic chord so it lands, not just climbs
    const tail = run.length * 0.07 + 0.05;
    [523.25, 659.25, 783.99].forEach((f) => sndTone({ when: tail, freq: f, type: "triangle", dur: 0.65, gain: 0.09 }));
    sfx.sparkle(big ? 10 : 6, 0.12);
    sfx.chips(big ? 10 : 6);
  },
  /* the table turning against you: one low boom, no rubbing it in */
  boom() {
    sndTone({ freq: 130, endFreq: 55, type: "sine", dur: 0.5, gain: 0.35 });
    sndNoise({ dur: 0.12, gain: 0.1, freq: 300, q: 0.7, type: "lowpass" });
  },
};
