'use strict';
/* CONTRACT: voice on/off routing in app.js.
 * Root cause locked in: Android WebView exposes window.speechSynthesis but its
 * TTS is a silent no-op — so on native platforms speak() MUST route to the
 * XauTts Capacitor plugin (OS engine), and in browsers it MUST use Web Speech.
 * Disabled voice never speaks. humanizeForSpeech produces natural speech.
 *
 * app.js runs against a permissive stub DOM (no real browser in CI). */
const fs = require('fs'), assert = require('assert'), path = require('path');

function makeEl() {
  return {
    style: { setProperty: function () {}, removeProperty: function () {} },
    classList: { add: function () {}, remove: function () {}, toggle: function () {}, contains: function () { return false; } },
    addEventListener: function () {}, removeEventListener: function () {},
    setAttribute: function () {}, getAttribute: function () { return null; },
    appendChild: function () {}, insertAdjacentHTML: function () {}, insertAdjacentElement: function () { return null; },
    querySelector: function () { return makeEl(); }, querySelectorAll: function () { return []; },
    getElementsByTagName: function () { return []; }, getContext: function () { return null; },
    focus: function () {}, blur: function () {}, click: function () {}, remove: function () {},
    textContent: '', innerHTML: '', value: '', disabled: false, title: '', options: [], checked: false, dataset: {},
    offsetWidth: 100, offsetHeight: 100, getBoundingClientRect: function () { return { top: 0, left: 0, width: 100, height: 100 }; }
  };
}
const window = {
  addEventListener: function () {}, removeEventListener: function () {},
  setInterval: function () { return 0; }, setTimeout: function () { return 0; },
  clearTimeout: function () {}, clearTimers: function () {},
  requestAnimationFrame: function () { return 0; },
  document: null,
  navigator: { onLine: true, language: 'en-MY', clipboard: undefined },
  location: { href: 'http://localhost/', origin: 'http://localhost', hash: '', search: '' },
  history: { pushState: function () {}, replaceState: function () {} },
  CustomEvent: function (type, opts) { this.type = type; this.detail = (opts && opts.detail) || null; },
  fetch: function () { return Promise.reject(new Error('no network in voice test')); },
  Image: function () { return makeEl(); },
  ResizeObserver: function () { return { observe: function () {}, unobserve: function () {} }; },
  IntersectionObserver: function () { return { observe: function () {}, unobserve: function () {}, disconnect: function () {} }; },
  getComputedStyle: function () { return { getPropertyValue: function () { return ''; } }; },
  matchMedia: function () { return { matches: false, addListener: function () {}, removeListener: function () {}, addEventListener: function () {}, removeEventListener: function () {} }; },
  innerWidth: 1280, innerHeight: 800, pageXOffset: 0, pageYOffset: 0,
  scrollTo: function () {},
  speechSynthesis: {
    spoken: [],
    getVoices: function () { return [{ name: 'Google US English', lang: 'en-US', voiceURI: 'gus' }]; },
    speak: function (u) { window.speechSynthesis.spoken.push(u); },
    cancel: function () {}
  },
  localStorage: {
    _s: {},
    getItem: function (k) { return this._s[k] !== undefined ? this._s[k] : null; },
    setItem: function (k, v) { this._s[k] = String(v); },
    removeItem: function (k) { delete this._s[k]; }
  }
};
const doc = {
  readyState: 'complete',
  getElementById: function () { return makeEl(); },
  querySelector: function () { return makeEl(); },
  querySelectorAll: function () { return []; },
  createElement: function () { return makeEl(); },
  createTextNode: function () { return {}; },
  head: makeEl(), body: makeEl(), documentElement: makeEl(),
  addEventListener: function () {}, removeEventListener: function () {},
  dispatchEvent: function () { return true; },
  hidden: false
};
window.document = doc;

globalThis.window = window;
globalThis.document = doc;
globalThis.speechSynthesis = window.speechSynthesis;
globalThis.SpeechSynthesisUtterance = function (t) { this.text = t; this.rate = 1; this.pitch = 1; this.voice = null; };
globalThis.CustomEvent = window.CustomEvent;

/* Load sibling scripts in index.html order. UMD files must take the browser
 * branch, so shadow module/exports inside the eval scope. */
function loadScript(file) {
  const code = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  /* Bind `this` to window so UMD files (root = self||this) attach to window,
   * and shadow module/exports so they take the browser branch. */
  const fn = new Function('window', 'document', 'speechSynthesis', 'CustomEvent', 'module', 'exports', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', code);
  fn.call(window, window, doc, window.speechSynthesis, window.CustomEvent, undefined, undefined,
    function () { return 0; }, function () { return 0; }, function () {}, function () {});
}
loadScript('xauusd-data.js');
loadScript('shared-market-logic.js');
loadScript('live.js');
loadScript('app.js');

const V = window.__XAU_VOICE_TEST;
assert.ok(V, 'voice test seam must be registered by app.js');
assert.strictEqual(typeof V.speak, 'function');
assert.strictEqual(typeof V.nativeSpeak, 'function');

/* 1) BROWSER (no Capacitor): nativeSpeak refuses, Web Speech is used,
 *    utterance carries humanized text. */
assert.strictEqual(V.isNative(), false, 'no Capacitor -> not native');
window.speechSynthesis.spoken = [];
V.setEnabled(true);
V.speak('EUR/USD M15 re-entry watch, 4156.20 MYT');
assert.strictEqual(window.speechSynthesis.spoken.length, 1, 'browser path must queue exactly one Web Speech utterance');
assert.strictEqual(V.nativeSpeak('x'), false, 'nativeSpeak must refuse in browser mode');
const spokenText = String(window.speechSynthesis.spoken[0].text);
assert.ok(/the Euro versus the US Dollar/.test(spokenText), 'pair must be spoken naturally, got: ' + spokenText);
assert.ok(/the fifteen minute chart/.test(spokenText), 'M15 must be spoken naturally, got: ' + spokenText);

/* 2) NATIVE (Capacitor android + XauTts): speak() routes to the plugin and
 *    Web Speech must NOT also fire (no double-voice). */
let nativeCalls = [];
window.Capacitor = {
  getPlatform: function () { return 'android'; },
  isNativePlatform: function () { return true; },
  Plugins: {
    XauTts: {
      isReady: function () { return Promise.resolve({ ready: true }); },
      speak: function (opts) { nativeCalls.push(opts); return Promise.resolve({ id: 'xau-1' }); }
    }
  }
};
assert.strictEqual(V.isNative(), true, 'Capacitor android -> native');
window.speechSynthesis.spoken = [];
nativeCalls = [];
V.speak('XAU/USD momentum down on H1');
assert.strictEqual(nativeCalls.length, 1, 'native engine must receive the line');
assert.ok(/Gold versus the US Dollar/.test(String(nativeCalls[0].text)), 'native text must be humanized too: ' + nativeCalls[0].text);
assert.strictEqual(window.speechSynthesis.spoken.length, 0, 'Web Speech must NOT also speak (no double-voice)');

/* 3) NATIVE but plugin missing (old APK): no crash, nothing spoken. */
window.Capacitor = { getPlatform: function () { return 'android'; }, isNativePlatform: function () { return true; }, Plugins: {} };
window.speechSynthesis.spoken = [];
nativeCalls = [];
assert.doesNotThrow(function () { V.speak('still no crash'); }, 'missing plugin must not throw');
assert.strictEqual(nativeCalls.length, 0, 'no plugin -> nothing native called');

/* 4) DISABLED: never speaks, native or web. */
window.Capacitor = {
  getPlatform: function () { return 'android'; }, isNativePlatform: function () { return true; },
  Plugins: { XauTts: { speak: function (o) { nativeCalls.push(o); return Promise.resolve({}); } } }
};
nativeCalls = [];
V.setEnabled(false);
window.speechSynthesis.spoken = [];
V.speak('must be silent');
assert.strictEqual(nativeCalls.length, 0, 'disabled voice must not speak natively');
assert.strictEqual(window.speechSynthesis.spoken.length, 0, 'disabled voice must not speak via Web Speech');

/* 5) humanize sanity — traders must not hear "E U R slash U S D". */
assert.strictEqual(V.humanize('FOMC at 02:00 MYT, DXY +12bps'), 'the Fed at 02:00 Malaysia time, the dollar index +12 basis points');

console.log('bbma voice routing contract passed');
process.exit(0);
