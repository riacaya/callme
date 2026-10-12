(function () {
  const panels = new Map();
  const normalize = (value) => window.CallMeIdentity.normalize(value);
  const uid = () =>
    globalThis.crypto?.randomUUID?.() ||
    `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  if (globalThis.crypto && !globalThis.crypto.randomUUID) {
    try {
      globalThis.crypto.randomUUID = () =>
        `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    } catch {}
  }

  function register(name, element) {
    panels.set(name, element);
  }

  function show(name) {
    if (name === "admin") {
      const identity = normalize(
        sessionStorage.getItem("callme-v2-session-user") || "",
      ).replace(/^cm-/i, "");
      if (!/^(riacaya|aurora)$/.test(identity)) {
        name = "settings";
      }
    }
    panels.forEach((panel, key) => {
      panel.classList.toggle("hidden", key !== name);
    });
    window.dispatchEvent(
      new CustomEvent("callme:panel-change", { detail: { panel: name } }),
    );
  }

  function current() {
    return (
      [...panels].find(
        ([, panel]) => !panel.classList.contains("hidden"),
      )?.[0] || null
    );
  }

  function isAllowedIdentity(value) {
    const id = normalize(value);
    return /^(?:riacaya|aurora)$/.test(id) || /^62[0-9]{8,15}$/.test(id);
  }

  let notificationRoutePromise = null;
  const logNotificationRoute = (message, peer, detail = "") => {
    const target = String(peer || "").replace(/^cm-/i, "").toLowerCase();
    void window.CallMeEventLog?.log?.("Notifikasi", message, [target, detail].filter(Boolean).join(" · "));
  };
  async function routeNotification(detail) {
    if (notificationRoutePromise) return notificationRoutePromise;
    const peer = String(detail?.sender || "").replace(/^cm-/i, "").toLowerCase();
    if (!peer) {
      logNotificationRoute("Klik notifikasi tanpa ID pengirim");
      return false;
    }
    logNotificationRoute(detail.kind === "call" ? "Klik notifikasi panggilan" : "Klik notifikasi pesan", peer);
    notificationRoutePromise = (async () => {
      // Beri waktu sampai batas panggilan untuk masuk/login setelah membuka notifikasi.
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        const user = sessionStorage.getItem("callme-v2-session-user");
        const token = sessionStorage.getItem("callme-v2-session-token");
        const chat = window.CallMeChat;
        if (user && token && typeof chat?.open === "function" && window.CallMeStorage) {
          try {
            if (detail.kind === "call" && detail.acceptCall) {
              // Match APK: do not open a room or claim the call until this
              // browser's PeerJS identity is registered and can receive media.
              window.__callmeAutoAnswerPending = true;
              const readyDeadline = Date.now() + 60000;
              while (Date.now() < readyDeadline && !window.CallMeP2P?.isPeerReady?.())
                await new Promise((resolve) => setTimeout(resolve, 250));
              if (!window.CallMeP2P?.isPeerReady?.()) {
                window.__callmeAutoAnswerPending = false;
                logNotificationRoute("Jawaban tidak dikirim: PeerJS belum siap", peer);
                return false;
              }
              window.CallMePush?.answerCall?.(peer, Boolean(detail.video), detail.callId || "");
              logNotificationRoute("Jawaban otomatis dikirim; menunggu panggilan P2P", peer);
            } else {
              const contacts = (await window.CallMeStorage.all("contacts")) || [];
              const contact = contacts.find((row) => normalize(row.peerId) === normalize(peer)) || { peerId: peer, display_name: peer };
              await chat.open(contact);
            }
            const url = new URL(window.location.href);
            ["cmOpenPeer", "cmNotificationKind", "cmAcceptCall", "cmCallMode", "cmCallId"].forEach((key) => url.searchParams.delete(key));
            history.replaceState(null, "", url.pathname + url.search + url.hash);
            return true;
          } catch (error) {
            console.warn("Gagal membuka chat dari notifikasi", error);
            logNotificationRoute("Notifikasi gagal diproses", peer, error?.message || "error");
            return false;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      logNotificationRoute("Notifikasi tidak diproses: sesi atau penyimpanan belum siap", peer);
      return false;
    })().finally(() => { notificationRoutePromise = null; });
    return notificationRoutePromise;
  }

  window.CallMeApp = Object.freeze({
    register,
    show,
    current,
    normalize,
    isAllowedIdentity,
    uid,
    roomId: window.CallMeIdentity.roomId,
    peerId: window.CallMeIdentity.peerId,
    routeNotification,
  });

  navigator.serviceWorker?.addEventListener("message", (event) => {
    if (event.data?.type === "callme:notification-open")
      void routeNotification(event.data.detail || {});
    if (event.data?.type === "callme:call-response") {
      const detail = event.data.detail || {};
      if (detail.kind === "call-accepted" || detail.kind === "call-declined")
        window.dispatchEvent(new CustomEvent(`callme:fcm-${detail.kind}`, { detail: { peerId: detail.peerId || "" } }));
    }
  });
  window.addEventListener("callme:session-user", () => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("cmOpenPeer")) void routeNotification({
      sender: params.get("cmOpenPeer"),
      kind: params.get("cmNotificationKind") || "message",
      acceptCall: params.get("cmAcceptCall") === "1",
      video: params.get("cmCallMode") === "video",
      callId: params.get("cmCallId") || "",
    });
  });

  document.addEventListener("DOMContentLoaded", () => {
    document
      .querySelectorAll("[data-panel]")
      .forEach((panel) => register(panel.dataset.panel, panel));
    document
      .querySelectorAll("[data-back]")
      .forEach((button) =>
        button.addEventListener("click", () => show(button.dataset.back)),
      );
    document
      .querySelectorAll("[data-open-panel]")
      .forEach((button) =>
        button.addEventListener("click", () => show(button.dataset.openPanel)),
      );

    const remembered = localStorage.getItem("callme-v2-persistent-session");
    const sessionUser = sessionStorage.getItem("callme-v2-session-user");
    const sessionToken = sessionStorage.getItem("callme-v2-session-token");
    const user = sessionUser || remembered;
    const token = sessionToken || (remembered ? localStorage.getItem("callme-v2-session-token") || "" : "");

    // ---- Perbaikan data sekali jalan ----
    // Paket kendali pernah ikut tersimpan sebagai pesan (bubble kosong di
    // chatroom pemanggil: paket kendali panggilan membawa roomId lalu jatuh ke
    // blok penyimpanan friends.js). Baris ber-kind KODE kini dibuang sekali
    // lalu ditandai; baris tanpa kind (data lama) TIDAK disentuh.
    void (async () => {
      try {
        const isContent = window.CallMeChatUtils?.isContentKind;
        if (typeof isContent !== "function") return;
        if (localStorage.getItem("callme-v2-purged-control-rows")) return;
        const rows = (await window.CallMeStorage?.all?.("messages")) || [];
        const junk = rows.filter((row) => row.kind && !isContent(row.kind));
        if (junk.length) {
          for (const row of junk) {
            await window.CallMeStorage?.remove?.("messages", row.id);
          }
          console.warn(`Membuang ${junk.length} baris kendali bukan pesan`);
          window.CallMeFriends?.load?.();
        }
        localStorage.setItem("callme-v2-purged-control-rows", "1");
      } catch (error) {
        console.warn("Pembersihan baris kendali gagal", error);
      }
    })();

    if (user && token) {
      sessionStorage.setItem("callme-v2-session-user", user);
      sessionStorage.setItem("callme-v2-session-token", token);
      show("friends");
      window.CallMeP2P?.start(user);
      const params = new URLSearchParams(window.location.search);
      if (params.has("cmOpenPeer")) {
        void routeNotification({
          sender: params.get("cmOpenPeer"),
          kind: params.get("cmNotificationKind") || "message",
          acceptCall: params.get("cmAcceptCall") === "1",
          video: params.get("cmCallMode") === "video",
      callId: params.get("cmCallId") || "",
        });
      }
      return;
    }

    sessionStorage.removeItem("callme-v2-session-user");
    sessionStorage.removeItem("callme-v2-session-token");
    show("login");
  });
})();
