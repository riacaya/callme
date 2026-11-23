(function () {
  "use strict";
  var host = window.chrome && window.chrome.webview;
  if (!host || typeof host.postMessage !== "function") return;

  function post(type, payload) {
    try { host.postMessage(JSON.stringify(Object.assign({ type: type }, payload || {}))); } catch (_) {}
  }

  // Expose speaker bridge for web app (calls.js looks for CallMeAndroid.setSpeakerphone)
  try {
    var bridge = window.CallMeAndroid || {};
    if (typeof bridge.setSpeakerphone !== "function") {
      bridge.setSpeakerphone = function (enabled) { post("set-speaker", { enabled: !!enabled }); };
    }
    if (typeof bridge.setSpeaker !== "function") {
      bridge.setSpeaker = function (enabled) { post("set-speaker", { enabled: !!enabled }); };
    }
    if (typeof bridge.toggleSpeaker !== "function") {
      bridge.toggleSpeaker = function (enabled) { post("set-speaker", { enabled: !!enabled }); };
    }
    bridge.__shell = true;
    window.CallMeAndroid = bridge;
  } catch (_) {}

  function senderName(peerId) {
    var id = String(peerId || "").replace(/^cm-/i, "");
    return id || "CallMe";
  }

  function shrinkPhoto(src, max, cb) {
    try {
      if (!src || typeof src !== "string") return cb("");
      if (src.indexOf("data:image") !== 0) return cb(src.length > 300000 ? "" : src);
      if (src.length < 120000) return cb(src);
      var img = new Image();
      img.onload = function () {
        try {
          var w = img.width || max, h = img.height || max;
          var scale = Math.min(1, max / Math.max(w, h));
          var cw = Math.max(1, Math.round(w * scale));
          var ch = Math.max(1, Math.round(h * scale));
          var c = document.createElement("canvas");
          c.width = cw; c.height = ch;
          var ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0, cw, ch);
          cb(c.toDataURL("image/jpeg", 0.72));
        } catch (_) { cb(""); }
      };
      img.onerror = function () { cb(""); };
      img.src = src;
      setTimeout(function () { cb(src.length < 300000 ? src : ""); }, 800);
    } catch (_) { cb(""); }
  }

  window.addEventListener("callme:incoming-call", function (event) {
    var incoming = event && event.detail;
    if (!incoming) return;
    var peer = String(incoming.peer || incoming.peerId || "").replace(/^cm-/i, "");
    var video = incoming.metadata && (incoming.metadata.video === true || incoming.metadata.video === "true");
    var photo = "";
    var name = senderName(peer);
    try {
      var prof = window.CallMeProfileRepository && window.CallMeProfileRepository.read && window.CallMeProfileRepository.read(peer);
      photo = String((prof && (prof.profile_photo || prof.photo_url)) || "");
      var dn = String((prof && (prof.display_name || prof.name)) || "").trim();
      if (dn) name = dn;
    } catch (_) {}
    shrinkPhoto(photo, 128, function (smallPhoto) {
      post("incoming-call", {
        peerId: peer,
        callMode: video ? "video" : "voice",
        title: "Panggilan masuk",
        body: (video ? "Panggilan video" : "Panggilan suara") + " dari " + name,
        name: name,
        photo: smallPhoto || ""
      });
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
      if (data.type === "shell-version") {
        // Versi shell Windows (dikirim setelah navigasi selesai).
        window.CallMeShellVersion = String(data.version || "");
        try { window.CallMeAppVersion && window.CallMeAppVersion.check(); } catch (_) {}
        return;
      }
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
