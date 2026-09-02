#!/usr/bin/env bash
# Regenerates the root pages from src/ using tsc (JSX -> React.createElement).
# No bundler/build deps beyond `tsc` (global, or resolvable via npx). Run: ./build.sh
#
#   index.html    <- src/landing.html      (static welcome page, version-stamped copy)
#   trainer.html  <- src/PokerTrainer.jsx  (the hold trainer)
#   play.html     <- src/PokerPlay.jsx     (the Jacks-or-Better machine)
#
# The mechanism is carried over from the cribbage-trainer this project is modeled on
# (public domain): prepend the shared engine + chrome, swap the ESM React import for the
# vendored browser globals, name-guard with tsc so a ReferenceError can't reach users as
# a blank page, transpile, wrap in the HTML shell, stamp the VERSION.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

# tsc: prefer a global install; fall back to npx fetching a pinned typescript.
if command -v tsc >/dev/null 2>&1; then TSC=(tsc)
else TSC=(npx --yes --package typescript@5.6.3 tsc); fi
# TypeScript 6+ hard-errors when a tsconfig.json exists up the tree (this app lives inside
# a larger repo) and deprecates module=none; both flags are TS6-only, so gate on the version.
case "$("${TSC[@]}" --version 2>/dev/null)" in
  *" 6."*|*" 7."*) TSC+=(--ignoreConfig --ignoreDeprecations 6.0);;
esac

# build_one <src.jsx> <out.html> <title> <ComponentName> <description>
# Transpiles a single self-contained React component into a standalone HTML page.
build_one() {
  local SRC="$1" OUT="$2" TITLE="$3" COMPONENT="$4" DESC="${5:-}"
  local TMP; TMP="$(mktemp -d)"

  # 1) Swap the ESM import/export for browser-global vendored React, and mount the app.
  #    The import sed captures whatever hooks the file imports, so it is component-agnostic.
  #    The shared engine (src/engine.js) and UI chrome (src/chrome.jsx) are PREPENDED so each
  #    built page ships one self-contained copy of the math + theme.
  cat "$ROOT/src/engine.js" "$ROOT/src/holdem.js" "$ROOT/src/account.js" "$ROOT/src/chrome.jsx" > "$TMP/app.tsx"
  sed -e 's#^import React, { \(.*\) } from "react";#const { \1 } = React;#' \
      -e "s#^export default function ${COMPONENT}(#function ${COMPONENT}(#" \
      "$ROOT/$SRC" >> "$TMP/app.tsx"
  printf '\nReactDOM.createRoot(document.getElementById("root")).render(React.createElement(%s));\n' "$COMPONENT" >> "$TMP/app.tsx"

  # 1.5) Guard against undefined identifiers left behind by a refactor. The engine/verify_*.js
  #      harnesses only exercise the pure functions, never the React render, so a bare
  #      ReferenceError inside JSX would otherwise reach users as a blank screen. tsc
  #      name-resolution catches exactly that. Run it on the original $SRC (which imports
  #      React/hooks as names) so React/ReactDOM globals don't register as false positives.
  local NAMEERR
  cat "$ROOT/src/engine.js" "$ROOT/src/holdem.js" "$ROOT/src/account.js" "$ROOT/src/chrome.jsx" "$ROOT/$SRC" > "$TMP/guard.tsx"
  NAMEERR="$("${TSC[@]}" "$TMP/guard.tsx" \
      --jsx react --target es2020 --module none --removeComments \
      --skipLibCheck --noEmit 2>&1 \
      | grep -i "cannot find name" || true)"
  if [ -n "$NAMEERR" ]; then
    echo "✗ build aborted — $SRC references undefined name(s):" >&2
    echo "$NAMEERR" >&2
    rm -rf "$TMP"; exit 1
  fi

  # 2) Transpile JSX -> plain JS (modern syntax, comments stripped). Type errors are
  #    expected (the source is untyped JS) and non-fatal; we only want the emit.
  "${TSC[@]}" "$TMP/app.tsx" \
      --jsx react --target es2020 --module none --removeComments \
      --skipLibCheck --outDir "$TMP/out" >/dev/null 2>&1 || true
  if [ ! -f "$TMP/out/app.js" ]; then
    echo "✗ build aborted — tsc produced no output for $SRC" >&2
    rm -rf "$TMP"; exit 1
  fi

  # 3) Wrap with the HTML shell (vendored React, no CDN — works fully offline).
  {
  cat <<HTML
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta http-equiv="Content-Security-Policy" content="object-src 'none'; base-uri 'self'; form-action 'self'" />
<meta name="theme-color" content="#0f2417" />
<meta name="description" content="${DESC}" />
<link rel="icon" href="favicon.svg" type="image/svg+xml" />
<link rel="manifest" href="manifest.webmanifest" />
<meta property="og:type" content="website" />
<meta property="og:title" content="${TITLE}" />
<meta property="og:description" content="${DESC}" />
<title>${TITLE}</title>
<style>html,body{margin:0;background:#0f2417;min-height:100%;-webkit-user-select:none;user-select:none}#root{min-height:100vh}input,textarea{-webkit-user-select:text;user-select:text}</style>
<script src="vendor/react.production.min.js"></script>
<script src="vendor/react-dom.production.min.js"></script>
</head>
<body>
<div id="root"></div>
<script>
HTML
  cat "$TMP/out/app.js"
  cat <<'HTML'

</script>
</body>
</html>
HTML
  } > "$ROOT/$OUT"

  rm -rf "$TMP"
  echo "built $OUT ($(wc -l < "$ROOT/$OUT") lines)"
}

# Landing page is plain static HTML, copied verbatim (version stamp applied below).
cp "$ROOT/src/landing.html" "$ROOT/index.html"
echo "built index.html (landing)"

build_one "src/PokerTrainer.jsx" "trainer.html" "Poker Hold Trainer"      "PokerTrainer" "Practice optimal video-poker holds: every possible hold ranked by exact expected value, fully explained. Free and open-source."
build_one "src/PokerPlay.jsx"    "play.html"    "Poker — Play"            "PokerPlay"    "Play 9/6 Jacks or Better with a practice bankroll; hints come from the trainer's exact-enumeration engine. Free, open-source, works offline."
build_one "src/PokerTable.jsx"   "table.html"   "Poker — Hold'em Table"   "PokerTable"   "A no-limit hold'em table UI with fold, call, and a raise slider. Practice chips only. Free and open-source."
build_one "src/Profile.jsx"       "profile.html"  "Poker — Profile"         "Profile"      "Your poker profile: synced practice stats, trainer accuracy trend, and the opt-in leaderboard. Free and open-source."

# Stamp the version (read from the VERSION file) into each page's __APP_VERSION__
# placeholder. VERSION is the single source of truth: "<x.y.z>-dev.<n>" during
# development, "<major.minor.patch>" on a release.
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION" 2>/dev/null)"
for f in index.html trainer.html play.html table.html profile.html; do
  sed -i "s/__APP_VERSION__/${VERSION}/g" "$ROOT/$f"
done
echo "stamped version v${VERSION}"
