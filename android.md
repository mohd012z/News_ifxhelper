# Turning XAU//DESK into an Android app (APK)

> **A debug APK has already been built and is sitting in the project root:**
> `XAU-Desk-debug.apk` (~3.95 MB, signed with the Android debug key).
> Install it on a phone with `adb install -r XAU-Desk-debug.apk`, or copy it across and open it
> (allow "install unknown apps"). Rebuild any time with `npm run apk:debug`.

There are three routes. Pick by what you actually need.

| Route | Result | Effort | Needs |
|---|---|---|---|
| **A. PWA install** | Icon on the Android home screen, full screen, works offline | 5 minutes | The folder hosted on **https** |
| **B. Capacitor** | A real **.apk / .aab** you can sideload or publish | 30–60 min | Node + JDK 17 + Android Studio |
| **C. TWA / Bubblewrap** | An APK that is a hosted PWA in a Play Store wrapper | 20 min | https hosting + a signing key |

You do **not** rewrite anything. The same HTML/CSS/JS ships in all three.

---

## Route A — install as a PWA (fastest, no APK)

The PWA pieces are already in the folder: `manifest.webmanifest`, `sw.js`, `pwa.js`, `icons/`.

1. Serve the folder over http/https. Local test:

   ```bash
   cd xauusd-dashboard
   node tools/serve.js        # or: npm run serve
   ```

   Open <http://localhost:5173/index.html>.

2. For a phone, put the folder on any **https** host (Netlify, Cloudflare Pages, Vercel, GitHub Pages —
   drag-and-drop the folder, no build step needed).

3. On Android Chrome, open the URL → **⋮ menu → Add to Home screen / Install app**.
   The dashboard then runs full screen with its own icon, and the app shell opens offline
   (live prices still need a connection).

**Why https matters:** service workers and the install prompt are disabled on `file://`.
Opening `index.html` directly from the filesystem still works as a normal page — you just don't get
install/offline.

---

## Route B — build a real APK with Capacitor

### Prerequisites

- **Node.js 18+**
- **JDK 17** (Android Gradle Plugin 8 requires 17)
- **Android Studio** with **Android SDK 34** and the platform-tools installed
- `ANDROID_HOME` / `ANDROID_SDK_ROOT` set (Android Studio sets these)

### Steps

```bash
cd xauusd-dashboard

# 1. install the wrapper (first time only)
npm install

# 2. copy the app files into www/  (Capacitor bundles this folder)
npm run prepare-web

# 3. create the native Android project (first time only)
npx cap add android

# 4. copy web assets in + sync native config
npm run cap:sync

# 5. open it in Android Studio and press Run ▶
npm run cap:open
```

### Build the APK from the command line instead

```bash
npm run apk:debug      # -> android/app/build/outputs/apk/debug/app-debug.apk
npm run apk:release    # signed release build (needs a keystore, see below)
```

Sideload the debug APK by copying it to the phone and allowing "install unknown apps",
or:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
```

### Release signing

```bash
keytool -genkey -v -keystore xaudesk.keystore -alias xaudesk \
        -keyalg RSA -keysize 2048 -validity 10000
```

Add to `android/app/build.gradle`:

```gradle
android {
  signingConfigs {
    release {
      storeFile file("../../xaudesk.keystore")
      storePassword "YOUR_STORE_PASSWORD"
      keyAlias "xaudesk"
      keyPassword "YOUR_KEY_PASSWORD"
    }
  }
  buildTypes { release { signingConfig signingConfigs.release } }
}
```

Then `npm run apk:release`. Build an **.aab** for Play with
`cd android && gradlew.bat bundleRelease`.

### Icons and splash

`npm run icons` regenerates `icons/*.png`. To feed Android:

```bash
npm i -D @capacitor/assets
npx capacitor-assets generate --android
```

It reads `icons/icon-512.png` (and `icon-maskable-512.png`) and writes every density.

### What the Android app needs

- **INTERNET permission** — Capacitor adds it by default (`android/app/src/main/AndroidManifest.xml`).
  Without it the live prices cannot load.
- **CORS** — the app runs from `https://localhost` inside the WebView. The Coinbase endpoint sends
  `Access-Control-Allow-Origin: *`, so it works. Yahoo/Binance do **not** send CORS headers, which is
  why ATR is precomputed by `build-atr.js` rather than fetched in the browser.
- **Cleartext** — not needed; everything is https.

---

## Route C — TWA (Play Store wrapper around the hosted PWA)

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://YOUR-DOMAIN/manifest.webmanifest
bubblewrap build
```

Bubblewrap needs the PWA live on https with a valid manifest, and it will ask for a signing key.
Play Store distribution also requires a **Digital Asset Links** file at
`https://YOUR-DOMAIN/.well-known/assetlinks.json` so the wrapper is not shown with a URL bar.

No-code alternative: <https://www.pwabuilder.com> — paste the URL, download the Android package.

---

## Keeping data fresh inside the APK

The Android build does **not** run your cron job. Two options:

1. **Self-updating**: `sw.js` caches the app shell, and the live prices come from the network on every
   open, so prices are always current. Only the news/speaker/ATR snapshot is baked in at build time.
2. **Refresh before each build**: run the cron job (or `node build-atr.js`), then
   `npm run cap:sync` so the newest `xauusd-data.js` and `atr.js` land inside the APK.

For a fully self-updating news feed inside the app you would point the app at a hosted JSON instead of a
bundled file — that is a small change to the loader in `index.html`.

---

## Quick reference

```bash
npm run icons         # regenerate icons
npm run atr           # refresh ATR(14) from real OHLC
npm run serve         # local http server for PWA testing
npm run prepare-web   # copy app files into www/
npm run cap:sync      # prepare-web + cap sync android
npm run cap:open      # open Android Studio
npm run apk:debug     # build a debug APK
```
