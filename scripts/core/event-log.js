(function () {
  const log = async (type, message, detail = "") => {
    try { await window.CallMeStorage?.put?.("event-log", { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, createdAt: Date.now(), type, message, detail, user: sessionStorage.getItem("callme-v2-session-user") || "" }); } catch {}
  };
  window.CallMeEventLog = Object.freeze({ log });
  window.addEventListener("callme:local-profiles-synced", (event) => { const detail = event.detail || {}; void log("GS", "Sinkronisasi selesai", `profil sendiri + ${detail.contacts?.length || 0} teman`); });
  window.addEventListener("callme:p2p-route", (event) => { const detail = event.detail || {}; const peer = String(detail.peerId || "").replace(/^cm-/i, "") || "tidak diketahui"; void log("P2P", "Sambungan aktif", `${peer} via ${detail.route || "jalur tidak diketahui"}`); });
  window.addEventListener("callme:p2p-message", (event) => { const detail = event.detail || {}; if (!window.CallMeChatUtils?.isContentKind?.(detail.kind)) return; const peer = String(detail.senderPeerId || detail.peerId || "").replace(/^cm-/i, "") || "teman"; void log("Chatroom", "Terima data", `${detail.kind || "pesan"} dari ${peer}`); });
  window.addEventListener("callme:message-ack", (event) => void log("Chatroom", "Pesan terkirim", `id ${event.detail?.id || "tidak diketahui"}`));
  window.addEventListener("callme:p2p-send-wait", (event) => void log("Chatroom", "Pesan masuk antrean", `ke ${String(event.detail?.peerId || "teman").replace(/^cm-/i, "")}`));
  window.addEventListener("callme:call-log", (event) => { const row = event.detail || {}; void log("Chatroom", "Aktivitas panggilan", `${row.direction || ""} ${row.callType || "voice"} · ${row.status || "started"}`); });
})();
