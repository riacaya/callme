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
})();
