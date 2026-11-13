(function () {
  "use strict";
  var host = window.chrome && window.chrome.webview;
  if (!host || typeof host.postMessage !== "function") return;

  function post(type, payload) {
    try { host.postMessage(JSON.stringify(Object.assign({ type: type }, payload || {}))); } catch (_) {}
  }

  function senderName(peerId) {
    var id = String(peerId || "").replace(/^cm-/i, "");
    return id || "CallMe";
  }

  window.addEventListener("callme:incoming-call", function (event) {
    var incoming = event && event.detail;
    if (!incoming) return;
    var peer = String(incoming.peer || incoming.peerId || "").replace(/^cm-/i, "");
    var video = incoming.metadata && (incoming.metadata.video === true || incoming.metadata.video === "true");
    post("incoming-call", {
      peerId: peer,
      callMode: video ? "video" : "voice",
      title: "Panggilan masuk",
      body: (video ? "Panggilan video" : "Panggilan suara") + " dari " + senderName(peer)
    });
  });

  window.addEventListener("callme:p2p-message", function (event) {
    var d = event && event.detail || {};
    var sender = String(d.senderPeerId || d.sender || "").replace(/^cm-/i, "");
    var kind = String(d.kind || d.type || "");
    // ignore control/presence/ack messages
    if (!sender) return;
    if (/^(presence|presence-ping|presence-pong|room-active|room-idle|hello|hello-ack|ack|file-chunk-ack|file-complete-ack|message-ack|call-log|typing)$/i.test(kind)) return;
    var text = "";
    if (kind === "text") text = String(d.text || d.body || "Pesan baru");
    else if (kind === "media" || kind === "image" || kind === "video") text = "Mengirim media";
    else if (kind === "audio") text = "Mengirim pesan suara";
    else if (kind === "file") text = "Mengirim file";
    else if (d.text) text = String(d.text);
    else text = "Pesan baru";
    post("incoming-message", {
      peerId: sender,
      title: senderName(sender),
      body: text.slice(0, 180)
    });
  });

  function tryClick(selector, attemptsLeft) {
    var el = document.querySelector(selector);
    if (el) { try { el.click(); } catch (_) {} return; }
    if (attemptsLeft <= 0) return;
    setTimeout(function () { tryClick(selector, attemptsLeft - 1); }, 150);
  }

  try {
    host.addEventListener("message", function (event) {
      var data = event && event.data;
      if (!data) return;
      if (typeof data === "string") { try { data = JSON.parse(data); } catch (_) { return; } }
      if (data.type !== "call-action") return;
      var action = String(data.action || "");
      if (action === "accept") {
        // retry until incoming call UI is ready
        tryClick('[data-call-accept]:not([hidden])', 40);
      } else if (action === "reject") {
        tryClick('[data-call-reject]', 40);
      }
    });
  } catch (_) {}
})();
