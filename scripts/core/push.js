(function () {
  "use strict";
  // Relai push Apps Script — deployment "push" (integrations/google-apps-script/id.txt).
  // Push pesan dan undangan Jawab/Tolak panggilan untuk aplikasi yang tidur.
  // Panggilan media tetap memakai jalur P2P biasa setelah aplikasi bangun.
  var ENDPOINT =
    "https://script.google.com/macros/s/AKfycbyYbl54n8yvy_z12mZuw3KHIuXCXrgZ6XV5JGSTiKlRLUDswhNa1ZEgeIMFK6xw2FDR5w/exec";

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

  window.CallMePush = Object.freeze({
    notify: notify,
    message: function (to, text, meta) {
      notify(to, "message", me(), text, meta);
    },
    // Panggilan masuk membangunkan aplikasi tidur dengan pilihan Jawab/Tolak.
    call: function (to, video, callId) {
      var user = me();
      var name = myDisplayName();
      notify(
        to,
        "call",
        name,
        (video ? "Panggilan video" : "Panggilan suara") + " dari " + name,
        { sender: user, id: callId || "" },
      );
    },
  });
})();

