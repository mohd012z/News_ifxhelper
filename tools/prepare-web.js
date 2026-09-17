/* prepare-web.js - copy the app files into www/ so Capacitor can bundle them.
 * Run: node tools/prepare-web.js   (or npm run prepare-web)
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'www');

const FILES = [
  'index.html', 'trade-plan.html',
  'app.js', 'trade-plan.js', 'live.js',
  'xauusd-data.js', 'atr.js',
  'manifest.webmanifest', 'sw.js', 'pwa.js'
];
const DIRS = ['icons'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

let n = 0;
for (const f of FILES) {
  const src = path.join(root, f);
  if (!fs.existsSync(src)) { console.log('skip (missing): ' + f); continue; }
  fs.copyFileSync(src, path.join(out, f));
  n++;
}
for (const d of DIRS) {
  const src = path.join(root, d);
  if (!fs.existsSync(src)) continue;
  const dst = path.join(out, d);
  fs.mkdirSync(dst, { recursive: true });
  for (const f of fs.readdirSync(src)) { fs.copyFileSync(path.join(src, f), path.join(dst, f)); n++; }
}
console.log('www/ ready with ' + n + ' files -> ' + out);
console.log('Next: npx cap add android   then   npx cap sync android');
