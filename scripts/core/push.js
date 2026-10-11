(function () {
  "use strict";
  // Relai push Apps Script — deployment "push" (integrations/google-apps-script/id.txt).
  // Push pesan dan undangan Jawab/Tolak panggilan untuk aplikasi yang tidur.
  // Panggilan media tetap memakai jalur P2P biasa setelah aplikasi bangun.
  var ENDPOINT =
    "https://script.google.com/macros/s/AKfycbyYbl54n8yvy_z12mZuw3KHIuXCXrgZ6XV5JGSTiKlRLUDswhNa1ZEgeIMFK6xw2FDR5w/exec";
  var WEB_PUSH_CONFIG = window.CALLME_WEB_PUSH || {};
  var tokenRefreshPromise = null;
  var foregroundMessaging = null;

  function watchForegroundMessages(messagingSdk, messaging) {
    if (foregroundMessaging || typeof messagingSdk.onMessage !== "function") return;
    foregroundMessaging = messagingSdk.onMessage(messaging, function (payload) {
      var data = payload?.data || {};
      if (data.kind === "call-accepted" || data.kind === "call-declined") {
        window.dispatchEvent(new CustomEvent("callme:fcm-" + data.kind, {
          detail: { peerId: data.sender || data.title || "" },
        }));
      } else if ((data.kind === "message" || data.kind === "call") && Notification.permission === "granted") {
        var title = data.title || "CallMe";
        var options = { body: data.body || "", icon: "./assets/logo-192.png", data: { url: new URL("./", window.location.href).href, sender: data.sender || "", kind: data.kind || "message", video: /video/i.test(data.body || "") } };
        void ensureWorker().then(function (worker) { return worker.showNotification(title, options); });
      }
    });
  }

  var me = function () {
    return (
      sessionStorage.getItem("callme-v2-session-user") ||
      localStorage.getItem("callme-v2-user") ||
      ""
    );
  };

  var myDisplayName = function () {
    var user = me();
    try {
      var profile = JSON.parse(localStorage.getItem("callme-profile-" + user) || "null");
      return String(profile?.display_name || user || "CallMe");
    } catch (error) {
      return user || "CallMe";
    }
  };

  var bare = function (peer) {
    return String(peer || "").replace(/^cm-/i, "").toLowerCase();
  };

  // Fire-and-forget: kegagalan relai tidak boleh mengganggu alur chat/panggilan.
  // Content-Type text/plain = permintaan sederhana tanpa preflight (pola API web).
  // meta (opsional) membawa id/roomId/sender/createdAt pesan supaya penerima
  // yang aplikasinya mati bisa menyimpannya ke chatroom saat dibangunkan (antrean
  // FCM hanya notifikasi; isi dikirim ulang melalui P2P.
  function notify(to, kind, title, body, meta) {
    var target = bare(to);
    if (!target) return;
    var payload = {
      action: "push-notify",
      to: target,
      kind: kind,
      title: String(title || "CallMe").slice(0, 120),
      body: String(body || "").slice(0, 300),
    };
    if (meta) {
      if (meta.id) payload.id = String(meta.id);
      if (meta.roomId) payload.roomId = String(meta.roomId);
      if (meta.createdAt) payload.createdAt = String(meta.createdAt);
      if (meta.sender) payload.sender = String(meta.sender);
      if (meta.pendingOnly) payload.pendingOnly = "true";
    }
    payload.sender = payload.sender || payload.title;
    try {
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(function () {});
    } catch (error) {}
  }

  function appBase() {
    var path = new URL(".", window.location.href).pathname;
    return path.endsWith("/") ? path : path + "/";
  }

  function ensureWorker() {
    if (!("serviceWorker" in navigator)) return Promise.reject(new Error("Browser ini tidak mendukung service worker."));
    return navigator.serviceWorker.register(appBase() + "service-worker.js", { scope: appBase() });
  }

  function decodeKey(value) {
    var normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    return Uint8Array.from(raw, function (char) { return char.charCodeAt(0); });
  }

  async function registerBrowserPush() {
    if (!window.isSecureContext) throw new Error("Notifikasi perlu HTTPS atau localhost.");
    if (!("Notification" in window) || !("PushManager" in window)) throw new Error("Browser ini tidak mendukung Web Push.");
    if (!WEB_PUSH_CONFIG.vapidPublicKey || !WEB_PUSH_CONFIG.projectId || !WEB_PUSH_CONFIG.messagingSenderId || !WEB_PUSH_CONFIG.appId || !WEB_PUSH_CONFIG.apiKey) throw new Error("Konfigurasi Firebase Web dan VAPID belum diisi.");
    var user = me();
    if (!user || !sessionStorage.getItem("callme-v2-session-token")) throw new Error("Masuk dahulu sebelum mengaktifkan notifikasi.");
    if (Notification.permission === "denied") throw new Error("Izin notifikasi diblokir. Izinkan CallMe dari pengaturan situs browser.");
    var permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Izin notifikasi tidak diberikan.");

    window.CALLME_FIREBASE_CONFIG = WEB_PUSH_CONFIG;
    var worker = await ensureWorker();
    var appSdk = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js");
    var messagingSdk = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js");
    var app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(WEB_PUSH_CONFIG);
    if (!messagingSdk.isSupported || !(await messagingSdk.isSupported())) throw new Error("FCM Web tidak didukung browser ini.");
    var messaging = messagingSdk.getMessaging(app);
    watchForegroundMessages(messagingSdk, messaging);
    var token = await messagingSdk.getToken(messaging, { vapidKey: WEB_PUSH_CONFIG.vapidPublicKey, serviceWorkerRegistration: worker });
    if (!token) throw new Error("Firebase tidak memberikan token untuk browser ini.");
    var response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "push-register", peerId: bare(user), webToken: token }),
    });
    var result = await response.json();
    if (!result || !result.ok) throw new Error(result && result.error || "Pendaftaran push browser gagal.");
    localStorage.setItem("callme-web-push-peer", bare(user));
    localStorage.setItem("callme-web-push-token", token);
    return token;
  }

  function refreshBrowserPush() {
    var user = me();
    if (!user || !sessionStorage.getItem("callme-v2-session-token") || !("Notification" in window) || Notification.permission !== "granted") return Promise.resolve(false);
    if (tokenRefreshPromise) return tokenRefreshPromise;
    tokenRefreshPromise = ensureWorker().then(async function (worker) {
      if (!WEB_PUSH_CONFIG.vapidPublicKey || !WEB_PUSH_CONFIG.projectId) return false;
      window.CALLME_FIREBASE_CONFIG = WEB_PUSH_CONFIG;
      var appSdk = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js");
      var messagingSdk = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js");
      var app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(WEB_PUSH_CONFIG);
      var messaging = messagingSdk.getMessaging(app);
      watchForegroundMessages(messagingSdk, messaging);
      var token = await messagingSdk.getToken(messaging, { vapidKey: WEB_PUSH_CONFIG.vapidPublicKey, serviceWorkerRegistration: worker });
      if (!token) return false;
      return fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ action: "push-register", peerId: bare(user), webToken: token }),
      }).then(function (response) { return response.json(); }).then(function (result) {
        if (result && result.ok) {
          localStorage.setItem("callme-web-push-peer", bare(user));
          localStorage.setItem("callme-web-push-token", token);
        }
        return Boolean(result && result.ok);
      });
    }).catch(function (error) {
      console.warn("Pembaruan push browser gagal", error);
      return false;
    }).finally(function () { tokenRefreshPromise = null; });
    return tokenRefreshPromise;
  }

  async function disableBrowserPush() {
    if (!("serviceWorker" in navigator)) return false;
    var worker = await ensureWorker();
    if (tokenRefreshPromise) await tokenRefreshPromise;
    var peerId = localStorage.getItem("callme-web-push-peer") || bare(me());
    var webToken = localStorage.getItem("callme-web-push-token") || "";
    var messagingSdk = null;
    var messaging = null;
    if (!peerId) return false;
    if (WEB_PUSH_CONFIG.vapidPublicKey && WEB_PUSH_CONFIG.projectId && WEB_PUSH_CONFIG.apiKey) {
      var appSdk = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js");
      messagingSdk = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging.js");
      var app = appSdk.getApps().length ? appSdk.getApp() : appSdk.initializeApp(WEB_PUSH_CONFIG);
      messaging = messagingSdk.getMessaging(app);
      if (!webToken) webToken = await messagingSdk.getToken(messaging, { vapidKey: WEB_PUSH_CONFIG.vapidPublicKey, serviceWorkerRegistration: worker });
    }
    if (!webToken) return false;
    var response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "push-unregister", peerId: peerId, webToken: webToken }),
    });
    var result = await response.json();
    if (!result || !result.ok) throw new Error(result && result.error || "Pendaftaran push browser gagal dicabut.");
    if (messagingSdk && messaging) {
      await messagingSdk.deleteToken(messaging);
    } else {
      var subscription = await worker.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
    }
    localStorage.removeItem("callme-web-push-peer");
    localStorage.removeItem("callme-web-push-token");
    return true;
  }

  window.addEventListener("callme:session-user", function () { void refreshBrowserPush(); });
  document.addEventListener("DOMContentLoaded", function () {
    var settings = document.querySelector('[data-panel="settings"] .panel-content');
    if (!settings || !("Notification" in window) || !("PushManager" in window)) return;
    var button = document.createElement("button");
    button.type = "button";
    button.className = "setting-action";
    button.textContent = Notification.permission === "granted" ? "Aktifkan ulang notifikasi browser" : "Aktifkan notifikasi browser";
    button.dataset.browserPush = "enable";
    settings.prepend(button);
    button.addEventListener("click", async function () {
      button.disabled = true;
      try {
        await registerBrowserPush();
        button.textContent = "Notifikasi browser aktif";
        button.title = "Push browser aktif untuk akun ini.";
      } catch (error) {
        alert(error.message || "Notifikasi browser gagal diaktifkan.");
      } finally { button.disabled = false; }
    });
    void refreshBrowserPush();
  });

  window.CallMePush = Object.freeze({
    notify: notify,
    registerBrowser: registerBrowserPush,
    disableBrowser: disableBrowserPush,
    refreshBrowser: refreshBrowserPush,
    message: function (to, text, meta) {
      notify(to, "message", me(), text, meta);
    },
    // Panggilan masuk membangunkan aplikasi tidur dengan pilihan Jawab/Tolak.
    call: function (to, video) {
      var user = me();
      var name = myDisplayName();
      notify(
        to,
        "call",
        name,
        (video ? "Panggilan video" : "Panggilan suara") + " dari " + name,
        { sender: user },
      );
    },
    answerCall: function (to, video) {
      var user = me();
      notify(to, "call-accepted", user, video ? "Panggilan video dijawab" : "Panggilan suara dijawab", { sender: user });
      // Jalur konfirmasi P2P melengkapi FCM bila tab pemanggil sedang aktif.
      window.CallMeP2P?.sendCallControl?.({ kind: "call-accepted" }, to);
    },
  });
})();

