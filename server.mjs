/* Zero-dependency static server for Railway (or any Node host): serves ONLY the
 * built app — the four pages, the icon/manifest, and the vendored React — never
 * src/, engine/, docs/, or the Android project. The deployment is public even
 * though the repo is private, so the whitelist is the security boundary.
 * Keeps the project's no-dependencies rule: platform Node, nothing else.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8080;

const FILES = new Map([
  ["/", "index.html"],
  ["/index.html", "index.html"],
  ["/trainer.html", "trainer.html"],
  ["/play.html", "play.html"],
  ["/table.html", "table.html"],
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
