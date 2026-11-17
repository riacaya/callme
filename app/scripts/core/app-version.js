/**
 * app-version.js — versi aplikasi & banner pembaruan native.
 *
 * - VERSION/BUILT_AT: identitas build web (ditampilkan di panel About).
 * - MIN_APK/MIN_SHELL: versi minimal native yang masih didukung; bila
 *   perangkat lebih lama, halaman menampilkan banner ajakan memperbarui.
 * - Versi native diperoleh dari Bridge.appVersion() (APK) atau pesan
 *   "shell-version" dari shell Windows (lihat shell-bridge.js).
 */
(function () {
  "use strict";

  var VERSION = "1.6.0";
  var BUILT_AT = "2026-11-17";
  var MIN_APK = { code: 7, name: "1.6" };
  var MIN_SHELL = "1.3";
  var DOWNLOAD_APK = "https://riacaya.github.io/callme/download/CallMe.apk";
  var DOWNLOAD_SHELL = "https://riacaya.github.io/callme/download/CallMe-Windows-Shell.zip";

  function nativeInfo() {
    try {
      var bridge = window.CallMeAndroid;
      if (bridge && typeof bridge.appVersion === "function") {
        var raw = String(bridge.appVersion() || "");
        if (raw) {
          var parsed = JSON.parse(raw);
          return {
            kind: "apk",
            name: String(parsed.versionName || ""),
            code: Number(parsed.versionCode || 0),
          };
        }
      }
    } catch (_) {}
    if (window.CallMeShellVersion) {
      return { kind: "shell", name: String(window.CallMeShellVersion), code: 0 };
    }
    return null;
  }

  function nameToInt(name) {
    var parts = String(name || "").split(".");
    var value = 0;
    for (var i = 0; i < 3; i++) value = value * 100 + (Number(parts[i]) || 0);
    return value;
  }

  function isOutdated(info) {
    if (!info) return false;
    if (info.kind === "apk") {
      if (info.code && MIN_APK.code) return info.code < MIN_APK.code;
      return nameToInt(info.name) < nameToInt(MIN_APK.name);
    }
    if (info.kind === "shell") return nameToInt(info.name) < nameToInt(MIN_SHELL);
    return false;
  }

  var bannerShown = false;
  function showUpdateBanner(kind) {
    if (bannerShown) return;
    bannerShown = true;
    var url = kind === "shell" ? DOWNLOAD_SHELL : DOWNLOAD_APK;
    var label = kind === "shell" ? "Perbarui shell Windows" : "Perbarui APK";
    try {
      var bar = document.createElement("div");
      bar.style.cssText =
        "position:fixed;top:0;left:0;right:0;z-index:9999;display:flex;gap:10px;align-items:center;justify-content:center;" +
        "padding:9px 12px;background:#7a2e0e;color:#fff;font:13px Arial,sans-serif;text-align:center";
      var text = document.createElement("span");
      text.textContent = "Versi " + (kind === "shell" ? "shell Windows" : "APK") + " Anda sudah lama — segera perbarui agar panggilan & notifikasi tetap andal.";
      var link = document.createElement("a");
      link.href = url;
      link.textContent = label;
      link.style.cssText = "padding:6px 12px;border-radius:8px;background:#fff;color:#7a2e0e;font-weight:700;text-decoration:none;white-space:nowrap";
      bar.append(text, link);
      document.body.append(bar);
    } catch (_) {}
  }

  function check() {
    var info = nativeInfo();
    if (info && isOutdated(info)) showUpdateBanner(info.kind);
    return info;
  }

  window.CallMeAppVersion = {
    VERSION: VERSION,
    BUILT_AT: BUILT_AT,
    MIN_APK: MIN_APK,
    MIN_SHELL: MIN_SHELL,
    native: nativeInfo,
    outdated: function () {
      var info = nativeInfo();
      return info && isOutdated(info) ? info : null;
    },
    check: check,
  };

  document.addEventListener("DOMContentLoaded", function () {
    setTimeout(check, 1500);
    // Shell mengirim versi belakangan (setelah navigasi selesai) — cek lagi.
    setTimeout(check, 6000);
  });
})();
