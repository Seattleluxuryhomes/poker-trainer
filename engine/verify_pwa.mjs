#!/usr/bin/env node
/* pwa-check: the home-screen app is installable and says the truth. No server, no browser, no dependency.
   Founder, 2026-10-19: "All my apps should be able to be downloaded on my phone."
   Checks: the manifest parses and is complete (name, short_name, start_url, scope, display standalone, colours, icons incl.
   maskable); every icon it names exists and is really the size it says; the Apple touch icon is 180 and opaque; every page
   links the manifest and the Apple tags; the service worker exists and keeps no personal data (it must name its network-only
   routes or be shell-only); the offline page exists. Edit CONFIG for this repository; the rest is shared. */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = {
  name: "Poker Trainer",
  publicDir: ".",
  manifest: "manifest.webmanifest",
  manifestHref: "manifest.webmanifest",
  appleTouch: "apple-touch-icon.png",
  pages: ["index.html", "trainer.html", "bac.html", "bj.html", "craps.html", "flush.html", "moguls.html", "paigow.html", "play.html", "profile.html", "roulette.html", "sheep.html", "sp21.html", "table.html"],
  sw: "src/sw.js",
  offline: "offline.html",
  networkOnly: ["/api/"],
  registerIn: ["index.html", "trainer.html"],
  extra: [
    ["index.html", /src="install-card\.js"/, "the landing page draws the install card"],
    ["server.mjs", /"\/offline\.html"[\s\S]*"\/icon-192\.png"[\s\S]*"\/icon-512\.png"[\s\S]*"\/icon-maskable-512\.png"[\s\S]*"\/apple-touch-icon\.png"/, "the server's whitelist serves the offline page and every icon"],
    ["sw.js", /offline\.html/, "the built worker (sw.js) names the offline page"],
  ],
};


let fails = 0, passes = 0;
const ok = (c, m, extra) => { if (c) passes++; else { fails++; console.error("FAIL  " + m + (extra !== undefined ? "  " + JSON.stringify(extra) : "")); } };
const abs = (p) => path.join(ROOT, p);
const readIf = (p) => (fs.existsSync(abs(p)) ? fs.readFileSync(abs(p), "utf8") : null);
const png = (p) => { try { const b = fs.readFileSync(abs(p)); return b.subarray(1, 4).toString() === "PNG" ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colorType: b[25] } : null; } catch { return null; } };

/** true when a PNG has no see-through pixel (iOS paints see-through black; a maskable icon must reach its edge).
    Reads 8-bit RGB/RGBA/gray-alpha, not interlaced; anything else returns null (not decidable here). */
function opaque(p) {
  try {
    const b = fs.readFileSync(abs(p)); const w = b.readUInt32BE(16), h = b.readUInt32BE(20), depth = b[24], ct = b[25], inter = b[28];
    if (ct === 2 || ct === 0) return depth === 8 || depth === 16 ? true : null;
    if (depth !== 8 || inter !== 0 || (ct !== 6 && ct !== 4)) return null;
    const bpp = ct === 6 ? 4 : 2, stride = w * bpp; const chunks = []; let o = 8;
    while (o < b.length) { const len = b.readUInt32BE(o), type = b.subarray(o + 4, o + 8).toString(); if (type === "IDAT") chunks.push(b.subarray(o + 8, o + 8 + len)); o += 12 + len; }
    const raw = zlib.inflateSync(Buffer.concat(chunks)); let prev = Buffer.alloc(stride), pos = 0;
    for (let y = 0; y < h; y++) {
      const f = raw[pos++], line = Buffer.from(raw.subarray(pos, pos + stride)); pos += stride;
      for (let i = 0; i < stride; i++) { const a = i >= bpp ? line[i - bpp] : 0, up = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
        const add = f === 0 ? 0 : f === 1 ? a : f === 2 ? up : f === 3 ? (a + up) >> 1 : (() => { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); return pa <= pb && pa <= pc ? a : pb <= pc ? up : c; })();
        line[i] = (line[i] + add) & 255; }
      for (let x = 0; x < w; x++) if (line[x * bpp + bpp - 1] !== 255) return false;
      prev = line;
    }
    return true;
  } catch { return null; }
}
const served = (src) => path.posix.join(CONFIG.publicDir, src.replace(/^\//, ""));
const exists = (p) => fs.existsSync(abs(p));

/* ---- the manifest ---- */
const mtext = readIf(CONFIG.manifest);
ok(mtext !== null, "the manifest file exists: " + CONFIG.manifest);
let m = {};
try { m = JSON.parse(mtext || "{}"); } catch (e) { ok(false, "the manifest is valid JSON", String(e)); }
ok(typeof m.name === "string" && m.name.length > 0, "the manifest has a name");
ok(typeof m.short_name === "string" && m.short_name.length > 0 && m.short_name.length <= 12, "it has a short_name that fits under an icon (12 characters or fewer)", m.short_name);
ok(typeof m.start_url === "string" && m.start_url.length > 0, "it has a start_url");
ok(typeof m.scope === "string" && m.scope.length > 0, "it has a scope");
ok(m.display === "standalone", "it opens full screen (display standalone)", m.display);
ok(/^#[0-9a-fA-F]{3,8}$/.test(m.theme_color || ""), "it has a theme_color", m.theme_color);
ok(/^#[0-9a-fA-F]{3,8}$/.test(m.background_color || ""), "it has a background_color", m.background_color);
if (CONFIG.name) ok(m.name === CONFIG.name, "the name is the app's own name", m.name);
const icons = Array.isArray(m.icons) ? m.icons : [];
for (const [px, purpose] of [[192, "any"], [512, "any"], [512, "maskable"]]) {
  const i = icons.find((x) => x.sizes === `${px}x${px}` && String(x.purpose || "any").split(/\s+/).includes(purpose));
  ok(!!i, `the manifest lists a ${px}x${px} ${purpose} icon`);
  if (i) { const real = png(served(i.src)); ok(real && real.w === px && real.h === px, `${i.src} really is ${px} by ${px} pixels`, real); }
}
for (const i of icons) ok(exists(served(i.src)), `every icon the manifest names is a file: ${i.src}`);
const maskable = icons.find((x) => /maskable/.test(x.purpose || ""));
if (maskable) ok(opaque(served(maskable.src)) !== false, "the maskable icon has no see-through pixel (a square to the edge)");
const touch = png(path.posix.join(CONFIG.publicDir, CONFIG.appleTouch));
ok(touch && touch.w === 180 && touch.h === 180, "the Apple touch icon is 180 by 180", touch);
ok(opaque(path.posix.join(CONFIG.publicDir, CONFIG.appleTouch)) !== false, "the Apple touch icon has no see-through pixel (iOS would paint it black)");

/* ---- every page links it ---- */
for (const f of CONFIG.pages) {
  const html = readIf(f);
  if (html === null) { ok(false, "page exists: " + f); continue; }
  ok(/<link[^>]+rel=["']manifest["'][^>]*>/i.test(html) && html.includes(CONFIG.manifestHref), `${f}: links the manifest (${CONFIG.manifestHref})`);
  ok(/rel=["']apple-touch-icon["']/.test(html), `${f}: links the Apple touch icon`);
  ok(/name=["']theme-color["']/.test(html), `${f}: carries a theme-color`);
  ok(/name=["']apple-mobile-web-app-capable["'][^>]*content=["']yes["']|content=["']yes["'][^>]*name=["']apple-mobile-web-app-capable["']/.test(html) || /name=["']mobile-web-app-capable["']/.test(html), `${f}: carries the full-screen app tag`);
  ok(/name=["']apple-mobile-web-app-title["']/.test(html), `${f}: carries the Apple app title`);
}
/* the manifest's colour is the page's theme colour */
if (CONFIG.pages[0] && readIf(CONFIG.pages[0])) {
  const mt = /name=["']theme-color["'][^>]*content=["'](#[0-9a-fA-F]+)["']|content=["'](#[0-9a-fA-F]+)["'][^>]*name=["']theme-color["']/.exec(readIf(CONFIG.pages[0]));
  if (CONFIG.themeMustMatch !== false && mt) ok((mt[1] || mt[2]).toLowerCase() === (m.theme_color || "").toLowerCase(), "the page's theme-color matches the manifest's", [mt[1] || mt[2], m.theme_color]);
}

/* ---- the service worker ---- */
if (CONFIG.sw) {
  const sw = readIf(CONFIG.sw);
  ok(sw !== null, "the service worker exists: " + CONFIG.sw);
  if (sw) {
    ok(/addEventListener\(\s*["']fetch["']/.test(sw) && /addEventListener\(\s*["']install["']/.test(sw), "the worker handles install and fetch");
    ok(/req(uest)?\.method\s*!==?\s*["']GET["']/.test(sw), "the worker never touches anything that is not a plain GET");
    ok(!/importScripts|https?:\/\/(?!www\.w3\.org)/.test(sw.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), "the worker loads no outside script and names no outside address");
    for (const p of CONFIG.networkOnly || []) ok(sw.includes(p), `the worker names ${p} as network-only (never kept on the phone)`);
    if (CONFIG.offline) ok(sw.includes(path.posix.basename(CONFIG.offline)), "the worker answers a page that cannot load with the offline page");
  }
  const registrars = (CONFIG.registerIn || []).map((f) => [f, readIf(f)]);
  for (const [f, t] of registrars) ok(t !== null && /serviceWorker\s*\.\s*register\(/.test(t), `${f}: registers the service worker`);
}
if (CONFIG.offline) {
  const off = readIf(CONFIG.offline);
  ok(off !== null && /offline/i.test(off), "the offline page exists and says so: " + CONFIG.offline);
  ok(off !== null && !/<script/i.test(off), "the offline page has no script");
}
for (const [f, re, why] of CONFIG.extra || []) { const t = readIf(f); ok(t !== null && re.test(t), why); }

console.log(`pwa-check: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
