/* PWA glue: registers the service worker and wires an "Install app" button.
 * Safe to load from file:// - it simply does nothing there (service workers need http/https).
 */
(function () {
  "use strict";
  var btn = null;
  function ready(fn) { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn); else fn(); }

  ready(function () {
    btn = document.getElementById("install-btn");
    var secure = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";

    if ("serviceWorker" in navigator && secure) {
      var reloadedForV6 = false;
      try { reloadedForV6 = sessionStorage.getItem("xau-sw-v6-reloaded") === "1"; } catch (e) {}
      navigator.serviceWorker.addEventListener("controllerchange", function () {
        if (reloadedForV6) return;
        reloadedForV6 = true;
        try { sessionStorage.setItem("xau-sw-v6-reloaded", "1"); } catch (e) {}
        location.reload();
      });
      navigator.serviceWorker.register("./sw.js?v=6", { updateViaCache: "none" }).then(function (reg) {
        reg.update().catch(function () {});
        setInterval(function () { reg.update().catch(function () {}); }, 5 * 60 * 1000);
      }).catch(function () { /* offline mode unavailable */ });
    } else if (btn) {
      btn.hidden = true;
      btn.title = "Install needs https hosting or the Android build";
    }

    var deferred = null;
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferred = e;
      if (btn) btn.hidden = false;
    });
    if (btn) {
      btn.addEventListener("click", function () {
        if (!deferred) return;
        deferred.prompt();
        deferred.userChoice.then(function () { deferred = null; btn.hidden = true; });
      });
    }
    window.addEventListener("appinstalled", function () { if (btn) btn.hidden = true; });
  });
})();
