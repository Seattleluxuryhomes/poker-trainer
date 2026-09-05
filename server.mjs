/* Zero-dependency server for Railway (or any Node host). Two halves:
 *   1. Static: serves ONLY the built app — the pages, icon/manifest, vendored
 *      React — never src/, engine/, docs/, or the Android project. The
 *      whitelist is the security boundary.
 *   2. /api/*: the accounts API (api.mjs), a port of maybe.love's auth/profile
 *      backend. If JWT_SECRET is unset the API answers 503 and the site still
 *      serves — playing never requires an account.
 * Keeps the project's no-dependencies rule: platform Node (≥22.5 for
 * node:sqlite), nothing else.
 */
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "./db.mjs";
import { handleApi, accountsEnabled, assertSecretStrength, corsHeaders, userIdFrom } from "./api.mjs";
import { handleRoom } from "./rooms.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;

assertSecretStrength();
if (accountsEnabled()) openDb();
else console.log("no JWT secret (env unset and disk unwritable) — accounts API disabled (503); static site unaffected");

const FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/trainer.html", "trainer.html"],
  ["/play.html", "play.html"],
  ["/table.html", "table.html"],
  ["/profile.html", "profile.html"],
  ["/roulette.html", "roulette.html"],
  ["/craps.html", "craps.html"],
  ["/paigow.html", "paigow.html"],
  ["/bj.html", "bj.html"],
  ["/favicon.svg", "favicon.svg"],
  ["/manifest.webmanifest", "manifest.webmanifest"],
  ["/vendor/react.production.min.js", "vendor/react.production.min.js"],
  ["/vendor/react-dom.production.min.js", "vendor/react-dom.production.min.js"],
]);

const TYPES = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  svg: "image/svg+xml",
  webmanifest: "application/manifest+json",
};

const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  if (path === "/api/room" || path.startsWith("/api/room/"))
    return handleRoom(req, res, path, { corsHeaders, userIdFrom }); // rooms work without accounts
  if (path.startsWith("/api/")) return handleApi(req, res, path);
  const file = FILES.get(path);
  if (!file || (req.method !== "GET" && req.method !== "HEAD")) return send404(req, res);
  try {
    let body = await readFile(join(ROOT, file));
    const type = TYPES[file.split(".").pop()] || "application/octet-stream";
    const headers = {
      "content-type": type,
      // HTML revalidates on every load so a deploy reaches phones on a normal
      // reload (no more "hard-refresh to see the new version"); the vendored
      // React never changes within a deploy and caches long.
      "cache-control": file.startsWith("vendor/") ? "public, max-age=604800, immutable" : "no-cache",
      "x-content-type-options": "nosniff",
    };
    if (compressible(type) && /\bgzip\b/.test(req.headers["accept-encoding"] || "") && body.length > 1024) {
      body = gzipSync(body);
      headers["content-encoding"] = "gzip";
      headers.vary = "accept-encoding";
    }
    headers["content-length"] = body.length;
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    send404(req, res);
  }
});

const compressible = (type) => /text|javascript|json|svg/.test(type);

/* A 404 that looks like the house, not like a stack trace. */
function send404(req, res) {
  const body = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not on the floor</title><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a0c10;color:#e8ebf2;font-family:Inter,system-ui,sans-serif;text-align:center"><div><div style="font-size:52px">&#127136;</div><div style="font-size:22px;font-weight:900;letter-spacing:0.06em;margin-top:10px;color:#f4efe4">NOT ON THE FLOOR</div><div style="font-size:13px;color:#96a0b0;margin-top:8px">That page isn't in this casino.</div><a href="/" style="display:inline-block;margin-top:20px;padding:13px 34px;border-radius:12px;text-decoration:none;font-weight:900;letter-spacing:0.08em;font-size:13px;color:#00230f;background:linear-gradient(180deg,#2aff8f,#00e676 55%,#00a854)">BACK TO THE ENTRANCE</a></div></body>`;
  res.writeHead(404, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
  res.end(req.method === "HEAD" ? undefined : body);
}

server.listen(PORT, () => {
  console.log(`Poker Trainer listening on :${PORT}`);
});
