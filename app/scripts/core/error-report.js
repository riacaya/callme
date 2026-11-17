/**
 * error-report.js — jaring pengaman error global.
 * Error tak tertangani (script, promise) dicatat ke ring buffer dan
 * ditampilkan sebagai bar kecil dengan tombol "Salin detail" sehingga
 * laporan pengguna bisa ditindaklanjuti, bukan hilang begitu saja.
 */
(function () {
  "use strict";

  var history = [];
  var lastShownAt = 0;
  var bar = null;

  function record(kind, message, detail) {
    var entry = {
      at: new Date().toISOString(),
      kind: kind,
      message: String(message || "").slice(0, 300),
      detail: String(detail || "").slice(0, 800),
      url: String(location.href).slice(0, 200),
      user: (function () {
        try { return sessionStorage.getItem("callme-v2-session-user") || ""; } catch (_) { return ""; }
      })(),
    };
    history.push(entry);
    if (history.length > 20) history.shift();
    return entry;
  }

  function render(entry) {
    try {
      if (!document.body) return;
      if (bar) bar.remove();
      bar = document.createElement("div");
      bar.style.cssText =
        "position:fixed;left:12px;bottom:12px;z-index:9998;max-width:min(420px,90vw);display:flex;gap:8px;align-items:center;" +
        "padding:9px 12px;border-radius:10px;background:#5c1a1a;color:#fff;font:12px Arial,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.4)";
      var text = document.createElement("span");
      text.style.cssText = "flex:1;overflow-wrap:anywhere";
      text.textContent = "Terjadi kesalahan: " + entry.message;
      var copy = document.createElement("button");
      copy.textContent = "Salin detail";
      copy.style.cssText = "padding:5px 10px;border:0;border-radius:7px;background:#fff;color:#5c1a1a;font-weight:700;cursor:pointer;white-space:nowrap";
      copy.addEventListener("click", function () {
        try {
          var detail = JSON.stringify(history, null, 2);
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(detail);
          } else {
            var ta = document.createElement("textarea");
            ta.value = detail;
            document.body.append(ta);
            ta.select();
            document.execCommand("copy");
            ta.remove();
          }
          copy.textContent = "Tersalin";
        } catch (_) {}
      });
      var close = document.createElement("button");
      close.textContent = "✕";
      close.setAttribute("aria-label", "Tutup");
      close.style.cssText = "padding:5px 8px;border:0;border-radius:7px;background:transparent;color:#fff;cursor:pointer";
      close.addEventListener("click", function () { if (bar) { bar.remove(); bar = null; } });
      bar.append(text, copy, close);
      document.body.append(bar);
    } catch (_) {}
  }

  function showThrottled(entry) {
    var now = Date.now();
    if (now - lastShownAt < 8000) return;
    lastShownAt = now;
    render(entry);
  }

  window.addEventListener("error", function (event) {
    var entry = record("error", event && (event.message || event.error), (event && event.filename ? event.filename + ":" + (event.lineno || "") : ""));
    showThrottled(entry);
  });
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event && event.reason;
    var entry = record("promise", (reason && (reason.message || reason)) || "unhandled rejection", reason && reason.stack ? String(reason.stack) : "");
    showThrottled(entry);
  });

  window.CallMeErrorReport = {
    all: function () { return history.slice(); },
  };
})();
