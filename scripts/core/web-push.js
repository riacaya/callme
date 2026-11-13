(function () {
  "use strict";

  var ENDPOINT =
    "https://script.google.com/macros/s/AKfycbyYbl54n8yvy_z12mZuw3KHIuXCXrgZ6XV5JGSTiKlRLUDswhNa1ZEgeIMFK6xw2FDR5w/exec";

  function bare(peer) {
    return String(peer || "").replace(/^cm-/i, "").trim().toLowerCase();
  }

  function currentUser() {
    return bare(
      sessionStorage.getItem("callme-v2-session-user") ||
        localStorage.getItem("callme-v2-user") ||
        ""
    );
  }

  function post(action, payload) {
    try {
      return fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(Object.assign({ action: action }, payload || {})),
        keepalive: true,
      })
        .then(function (r) { return r.json().catch(function () { return {}; }); })
        .catch(function () { return null; });
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  var LAST_KEY = "callme-v2-web-push-last";

  function readLast() {
    try { return JSON.parse(localStorage.getItem(LAST_KEY) || "null"); } catch (_) { return null; }
  }
  function writeLast(peerId, token) {
    try {
      if (peerId && token) localStorage.setItem(LAST_KEY, JSON.stringify({ peerId: peerId, token: token }));
      else localStorage.removeItem(LAST_KEY);
    } catch (_) {}
  }

  var state = {
    initPromise: null,
    messaging: null,
    token: "",
    user: "",
  };

  function getConfig() {
    var cfg = (typeof self !== "undefined" && self.CALLME_WEB_PUSH) || window.CALLME_WEB_PUSH || null;
    if (!cfg || !cfg.apiKey || !cfg.projectId || !cfg.messagingSenderId || !cfg.appId || !cfg.vapidPublicKey) return null;
    return cfg;
  }

  function ensureSwRegistration() {
    if (!("serviceWorker" in navigator)) return Promise.resolve(null);
    return navigator.serviceWorker
      .getRegistration("./")
      .then(function (reg) {
        if (reg) return reg;
        return navigator.serviceWorker.register("./service-worker.js", { scope: "./" }).catch(function () { return null; });
      })
      .catch(function () { return navigator.serviceWorker.ready.catch(function () { return null; }); });
  }

  function ensureMessaging() {
    if (state.initPromise) return state.initPromise;
    state.initPromise = Promise.resolve().then(function () {
      var cfg = getConfig();
      if (!cfg) return null;
      if (!window.firebase || typeof firebase.initializeApp !== "function") return null;
      var app;
      try {
        app = firebase.app("callme-web-push");
      } catch (_) {
        try { app = firebase.initializeApp(cfg, "callme-web-push"); }
        catch (e2) { try { app = firebase.initializeApp(cfg); } catch (e3) { app = null; } }
      }
      if (!app || typeof firebase.messaging !== "function") return null;
      try { state.messaging = firebase.messaging(app); } catch (_) { state.messaging = null; }
      return state.messaging;
    });
    return state.initPromise;
  }

  function requestPermissionIfNeeded() {
    if (typeof Notification === "undefined") return Promise.resolve("unsupported");
    if (Notification.permission === "granted") return Promise.resolve("granted");
    if (Notification.permission === "denied") return Promise.resolve("denied");
    try { return Notification.requestPermission().catch(function () { return Notification.permission; }); }
    catch (_) { return Promise.resolve(Notification.permission); }
  }

  function register(force) {
    var user = currentUser();
    if (!user) return Promise.resolve(null);
    if (window.CallMeAndroid) return Promise.resolve(null); // APK native handles its own token
    return ensureMessaging().then(function (messaging) {
      if (!messaging) return null;
      return requestPermissionIfNeeded().then(function (perm) {
        if (perm !== "granted") return null;
        return ensureSwRegistration().then(function (reg) {
          if (!reg) return null;
          var cfg = getConfig();
          var opts = { vapidKey: cfg.vapidPublicKey, serviceWorkerRegistration: reg };
          return messaging.getToken(opts).then(function (token) {
            if (!token) return null;
            var last = readLast() || {};
            // Lepas token ini dari akun lain agar notif hanya untuk akun login saat ini.
            var movePromise = Promise.resolve(null);
            if (last.token === token && last.peerId && last.peerId !== user) {
              movePromise = post("push-unregister", { peerId: last.peerId, webToken: token }).catch(function () { return null; });
            }
            return movePromise.then(function () {
              if (!force && state.token === token && state.user === user && last.peerId === user && last.token === token) return token;
              state.token = token;
              state.user = user;
              return post("push-register", { peerId: user, webToken: token }).then(function () {
                writeLast(user, token);
                return token;
              });
            });
          }).catch(function () { return null; });
        });
      });
    });
  }

  function unregister() {
    var last = readLast() || {};
    var user = state.user || currentUser() || last.peerId || "";
    var token = state.token || last.token || "";
    if (state.messaging && token) {
      try { state.messaging.deleteToken(token).catch(function () {}); } catch (_) {}
    }
    state.token = "";
    if (!user || !token) {
      writeLast("", "");
      return Promise.resolve(null);
    }
    return post("push-unregister", { peerId: user, webToken: token }).then(function (res) {
      state.user = "";
      if (last.token === token) writeLast("", "");
      return res;
    });
  }

  function ensure() {
    return register(false);
  }

  // Re-register when session becomes active/changes.
  window.addEventListener("callme:session-user", function () { void register(true); });
  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(function () { void register(false); }, 1200);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) void register(false);
    });
  });

  window.CallMeWebPush = Object.freeze({
    register: register,
    unregister: unregister,
    ensure: ensure,
  });
})();
