/**
 * about.js — isi panel About: versi aplikasi + baris diagnostik ringkas
 * (versi native, cache service worker, status peer, izin notifikasi,
 * stempel deployment relay push, jumlah error terekam).
 * Tujuannya memangkas diagnosis manual saat ada masalah di perangkat.
 */
(function () {
  "use strict";

  var RELAY_ENDPOINT =
    "https://script.google.com/macros/s/AKfycbyYbl54n8yvy_z12mZuw3KHIuXCXrgZ6XV5JGSTiKlRLUDswhNa1ZEgeIMFK6xw2FDR5w/exec";

  function text(value) { return String(value == null ? "-" : value); }

  function row(label, value) {
    var line = document.createElement("div");
    line.style.cssText = "display:flex;justify-content:space-between;gap:10px;padding:3px 0;font-size:.8rem;text-align:left";
    var l = document.createElement("span");
    l.textContent = label;
    var v = document.createElement("span");
    v.style.cssText = "font-weight:700;overflow-wrap:anywhere;text-align:right";
    v.textContent = text(value);
    line.append(l, v);
    return line;
  }

  function fillBox(box, refreshBtn) {
    var rows = document.createDocumentFragment();
    var ver = window.CallMeAppVersion || {};
    rows.append(row("Versi UI", (ver.VERSION || "-") + " (" + (ver.BUILT_AT || "-") + ")"));

    var native = ver.native ? ver.native() : null;
    if (native && native.kind === "apk") {
      rows.append(row("APK", native.name + " (code " + native.code + ")"));
      var outdatedApk = ver.outdated && ver.outdated();
      rows.append(row("Status APK", outdatedApk ? "PERLU PEMBARUAN" : "terkini"));
    } else if (native && native.kind === "shell") {
      rows.append(row("Shell Windows", native.name));
      var outdatedShell = ver.outdated && ver.outdated();
      rows.append(row("Status shell", outdatedShell ? "PERLU PEMBARUAN" : "terkini"));
    } else {
      rows.append(row("Native", "tidak ada (browser/PWA)"));
    }

    try {
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistration) {
        navigator.serviceWorker.getRegistration("./").then(function (reg) {
          if (!reg) return;
          Promise.all([reg.active, reg.waiting, reg.installing].filter(Boolean).map(function (w) { return caches.keys(); }))
            .catch(function () { return []; })
            .then(function () { return caches.keys(); })
            .then(function (keys) {
              box.append(row("Cache SW", (keys && keys.length ? keys.join(", ") : "belum ada")));
            }).catch(function () {});
        }).catch(function () {});
      }
    } catch (_) {}

    var peer = null;
    try { peer = window.CallMeP2P && typeof window.CallMeP2P.isPeerReady === "function" ? (window.CallMeP2P.isPeerReady() ? "siap" : "belum siap") : null; } catch (_) {}
    if (peer !== null) rows.append(row("Peer P2P", peer));

    try {
      var activePeer = window.CallMeChat && typeof window.CallMeChat.activePeer === "function" ? window.CallMeChat.activePeer() : null;
      var activeRoute = activePeer && window.CallMeTransport && typeof window.CallMeTransport.getRoute === "function" ? window.CallMeTransport.getRoute(activePeer) : "";
      rows.append(row("Rute P2P (chat aktif)", activePeer ? (activeRoute || "mendeteksi/belum ada") : "-"));
      if (window.CallMeStorage && typeof window.CallMeStorage.all === "function" && window.CallMeTransport && typeof window.CallMeTransport.getRoute === "function") {
        window.CallMeStorage.all("contacts").then(function (contacts) {
          var found = [];
          (contacts || []).forEach(function (c) {
            var id = c && (c.peerId || c.username || c.phone);
            if (!id) return;
            var r = window.CallMeTransport.getRoute(id);
            if (r) found.push(String(id).replace(/^cm-/i, "") + ": " + r);
          });
          if (found.length) box.append(row("Rute P2P (diketahui)", found.join(" | ")));
        }).catch(function () {});
      }
    } catch (_) {}

    try {
      if (typeof Notification !== "undefined") {
        rows.append(row("Izin notifikasi", Notification.permission));
      }
      if (window.CallMeAndroid) rows.append(row("Push", "token FCM native (APK)"));
    } catch (_) {}

    // Stempel deployment relay "push" — mendeteksi deployment GAS basi.
    try {
      fetch(RELAY_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ action: "push-status" }),
      }).then(function (res) { return res.json(); }).then(function (data) {
        if (data && data.stamp) box.append(row("Relai push (deploy)", data.stamp));
      }).catch(function () {});
    } catch (_) {}

    try {
      var errors = window.CallMeErrorReport ? window.CallMeErrorReport.all() : [];
      rows.append(row("Error terekam", errors.length ? errors.length + " (terakhir: " + errors[errors.length - 1].message.slice(0, 60) + ")" : "tidak ada"));
    } catch (_) {}

    var user = "";
    try { user = sessionStorage.getItem("callme-v2-session-user") || ""; } catch (_) {}
    rows.append(row("Login", user || "belum"));

    box.replaceChildren(refreshBtn, rows);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var box = document.getElementById("about-diagnostics");
    if (!box) return;

    var verLine = document.getElementById("about-ui-version");
    if (verLine && window.CallMeAppVersion) {
      verLine.textContent = (window.CallMeAppVersion.VERSION || "?") + " · build " + (window.CallMeAppVersion.BUILT_AT || "?");
    }

    var refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.textContent = "↻ Perbarui";
    refreshBtn.style.cssText =
      "display:block;margin:10px auto 6px;padding:7px 14px;border:0;border-radius:8px;background:var(--accent);color:#fff;font-weight:700;cursor:pointer";
    refreshBtn.addEventListener("click", function () { fillBox(box, refreshBtn); });

    fillBox(box, refreshBtn);
  });
})();
