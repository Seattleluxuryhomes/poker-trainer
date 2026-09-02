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
else console.log("JWT_SECRET not set — accounts API disabled (503); static site unaffected");

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
  if (!file || (req.method !== "GET" && req.method !== "HEAD")) {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
    return;
  }
  try {
    const body = await readFile(join(ROOT, file));
    res.writeHead(200, {
      "content-type": TYPES[file.split(".").pop()] || "application/octet-stream",
      "cache-control": file.startsWith("vendor/") ? "public, max-age=86400" : "public, max-age=60",
      "content-length": body.length,
    });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" }).end("not found");
  }
});

server.listen(PORT, () => {
  console.log(`Poker Trainer listening on :${PORT}`);
});
