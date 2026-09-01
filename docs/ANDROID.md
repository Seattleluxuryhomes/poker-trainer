# Android packaging (APK) — build, sign, publish

Wraps the web app in a tiny **offline WebView** Android app and ships it as a
signed APK for **Obtainium**. The layout and pipeline follow the reference
cribbage-trainer.

## What's here

```
android/                          self-contained Gradle/Android project
  app/build.gradle                applicationId dev.poker.trainer, versionCode/Name, syncWebAssets
  app/src/main/
    AndroidManifest.xml           no INTERNET permission — fully offline
    java/dev/poker/trainer/MainActivity.java   full-screen WebView -> file:///android_asset/index.html
    res/                          app name, theme, adaptive spade icon on green
    assets/                       (git-ignored) the web app, copied in at build time
  gradlew, gradle/wrapper/        Gradle 8.7 wrapper (AGP 8.5.2)
.github/workflows/android-release.yml    tag v* (or dispatch) -> build, sign, attach APK to a Release
.github/workflows/bootstrap-signing.yml  one-off: create the signing secrets in CI
```

The Gradle task `:app:syncWebAssets` copies the committed root pages
(`index/trainer/play/table.html` + `vendor/`) into assets before each build, so
the APK always ships the current site. If you change `src/*.jsx`, run
`./build.sh` and commit the regenerated pages *before* tagging.

## Cut a release

```bash
# 1. Set VERSION to the release number (e.g. 0.1.3 — drop any -dev suffix)
# 2. Bump android/app/build.gradle: versionName to match, versionCode +1
# 3. ./build.sh && run the four engine/verify_*.js && commit && push
git tag v0.1.3 && git push origin v0.1.3   # the tag triggers the signed-APK build
```

(No tag access? Run the "Android Release APK" workflow from the Actions tab —
it takes the tag as an input and creates it.)

## Signing

Updates only install in place if every release is signed with the **same** key.

- **With secrets** (`POKER_KEYSTORE_BASE64` / `POKER_KEYSTORE_PASSWORD` /
  `POKER_KEY_PASSWORD` / `POKER_KEY_ALIAS`): stable signature, seamless updates.
  Create them once, phone-friendly, with the **Bootstrap signing key** workflow:
  add a fine-grained PAT (this repo, "Secrets: Read and write" + Metadata) as
  the `BOOTSTRAP_PAT` secret, run the workflow from the Actions tab, then
  delete/revoke the PAT.
- **Without secrets**: the release workflow generates a ONE-OFF key so the APK
  is still installable, but the next release's signature won't match — Android
  will demand an uninstall/reinstall. The release notes state which mode was
  used. Never commit a keystore; `.gitignore` blocks `*.jks`/`*.keystore`.

## Install with Obtainium

Obtainium → **Add App** → paste this repo's URL. Public repo: no token needed;
releases are tracked and updates install automatically (subject to the signing
note above).

## Web demo (GitHub Pages)

`.github/workflows/pages.yml` publishes the same whitelisted pages to GitHub
Pages on every push to `main` — the no-install way to use the app (Add to Home
Screen on a phone gets the full-screen PWA feel; the APK is the fully-offline
option).
