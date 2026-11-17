/**
 * update-toast.js — notifikasi "versi baru tersedia" saat service worker baru
 * selesai diunduh (aplikasi terbuka). Tanpa ini pengguna bisa bertahan di
 * cache lama berhari-hari dan mengira bug versi baru adalah bug aplikasi.
 */
(function () {
  "use strict";
  if (!("serviceWorker" in navigator)) return;

  var announced = false;
  function toast() {
    if (announced) return;
    announced = true;
    try {
      var bar = document.createElement("div");
      bar.style.cssText =
        "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9999;display:flex;gap:10px;align-items:center;" +
        "padding:10px 14px;border-radius:12px;background:#082b49;color:#fff;font:14px Arial,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.35)";
      var text = document.createElement("span");
      text.textContent = "Versi baru CallMe tersedia";
      var btn = document.createElement("button");
      btn.textContent = "Muat ulang";
      btn.style.cssText =
        "padding:7px 14px;border:0;border-radius:8px;background:#1672df;color:#fff;font-weight:700;cursor:pointer";
      btn.addEventListener("click", function () { location.reload(); });
      bar.append(text, btn);
      document.body.append(bar);
    } catch (_) {}
  }

  function watch(reg) {
    if (!reg) return;
    if (reg.waiting && navigator.serviceWorker.controller) toast();
    reg.addEventListener("updatefound", function () {
      var worker = reg.installing;
      if (!worker) return;
      worker.addEventListener("statechange", function () {
        if (worker.state === "installed" && navigator.serviceWorker.controller) toast();
      });
    });
  }

  function boot() {
    try {
      navigator.serviceWorker.getRegistration("./").then(watch).catch(function () {});
    } catch (_) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
