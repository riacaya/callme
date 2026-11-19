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

  let lastMainPanel = "friends";

  // Drawer pengaturan (#main-menu) bukan panel terdaftar; pastikan selalu
  // tertutup saat berpindah panel agar tidak menumpuk di atas konten.
  function settingsDrawer() {
    return {
      menu: document.getElementById("main-menu"),
      backdrop: document.getElementById("main-menu-backdrop"),
      btn: document.getElementById("main-menu-btn"),
    };
  }
  function closeSettingsDrawer() {
    document.querySelector(".friend-profile-col")?.classList.remove("mobile-open", "overlay-open");
    const { menu, backdrop, btn } = settingsDrawer();
    const rail = document.getElementById("app-rail");
    if (rail?.classList.contains("mobile-open")) {
      rail.classList.remove("mobile-open");
      backdrop?.classList.remove("open");
      btn?.setAttribute("aria-expanded", "false");
      return;
    }
    if (!menu?.classList.contains("open")) return;
    menu.classList.remove("open");
    backdrop?.classList.remove("open");
    menu.setAttribute("aria-hidden", "true");
    btn?.setAttribute("aria-expanded", "false");
  }

  const OVERLAY_PANELS = new Set(["profile", "admin", "language", "theme", "sound", "about", "location"]);
  const FULLSCREEN_PANELS = new Set(["login", "voice-call", "video-call"]);
  const isDesktopSplit = () => window.matchMedia("(min-width:900px)").matches;

  function closeDesktopOverlays() {
    // Tutup overlay data-panel (desktop)
    panels.forEach((panel, key) => {
      if (OVERLAY_PANELS.has(key)) {
        panel.classList.remove("overlay-open");
        panel.classList.add("hidden");
      }
    });
    // Tutup overlay profil teman (desktop)
    const fp = document.querySelector(".friend-profile-col");
    if (fp) fp.classList.remove("overlay-open", "mobile-open");
  }

  function show(name, opts) {
    closeSettingsDrawer();
    if (!panels.has(name)) name = panels.has("friends") ? "friends" : [...panels.keys()][0];
    if (name === "friends" || name === "chatroom") lastMainPanel = name;
    const desktop = isDesktopSplit();
    const options = opts || {};

    if (desktop && !FULLSCREEN_PANELS.has(name)) {
      // Desktop: halaman utama tetap (rail + daftar teman + chatroom).
      // Panel tertentu dibuka sebagai overlay mengambang.
      if (OVERLAY_PANELS.has(name)) {
        // Buka satu overlay; tutup overlay lain, halaman utama tidak berubah.
        panels.forEach((panel, key) => {
          if (FULLSCREEN_PANELS.has(key)) { panel.classList.add("hidden"); return; }
          if (OVERLAY_PANELS.has(key)) {
            const on = key === name;
            panel.classList.toggle("hidden", !on);
            panel.classList.toggle("overlay-open", on);
            return;
          }
          // halaman utama (friends/chatroom) tidak diubah
        });
        // pastikan overlay profil teman tertutup saat buka overlay lain
        document.querySelector(".friend-profile-col")?.classList.remove("overlay-open", "mobile-open");
      } else if (name === "friends") {
        // Kolom 2 (daftar teman) selalu ada; opsional tutup chatroom.
        panels.forEach((panel, key) => {
          if (key === "friends") {
            panel.classList.remove("hidden");
          } else if (key === "chatroom") {
            if (options.closeChatroom) panel.classList.add("hidden");
          } else if (FULLSCREEN_PANELS.has(key)) {
            panel.classList.add("hidden");
          } else if (OVERLAY_PANELS.has(key)) {
            if (options.closeChatroom) { panel.classList.add("hidden"); panel.classList.remove("overlay-open"); }
          }
        });
        if (options.closeChatroom) document.querySelector(".friend-profile-col")?.classList.remove("overlay-open", "mobile-open");
      } else if (name === "chatroom") {
        panels.forEach((panel, key) => {
          if (key === "chatroom") {
            panel.classList.remove("hidden");
          } else if (key === "friends") {
            panel.classList.remove("hidden");
          } else if (FULLSCREEN_PANELS.has(key)) {
            panel.classList.add("hidden");
          }
          // overlay tidak diubah
        });
      } else {
        panels.forEach((panel, key) => {
          panel.classList.toggle("hidden", key !== name);
        });
      }
    } else {
      // Mobile / panel fullscreen: satu panel aktif. Tutup overlay desktop jika ada.
      if (!desktop) closeDesktopOverlays();
      panels.forEach((panel, key) => {
        if (desktop && FULLSCREEN_PANELS.has(name)) {
          // fullscreen di desktop: sembunyikan semua termasuk overlay
          panel.classList.toggle("hidden", key !== name);
          if (OVERLAY_PANELS.has(key)) panel.classList.remove("overlay-open");
        } else {
          panel.classList.toggle("hidden", key !== name);
        }
      });
      if (desktop && FULLSCREEN_PANELS.has(name)) {
        document.querySelector(".friend-profile-col")?.classList.remove("overlay-open", "mobile-open");
      }
    }

    window.dispatchEvent(
      new CustomEvent("callme:panel-change", { detail: { panel: name } }),
    );
  }

  function current() {
    // Desktop split dapat menampilkan kolom 2 + chatroom sekaligus.
    // Prioritaskan panel fullscreen/call, lalu chatroom, lalu lainnya.
    const priority = ["voice-call", "video-call", "login", "chatroom"];
    for (const name of priority) {
      const p = panels.get(name);
      if (p && !p.classList.contains("hidden")) return name;
    }
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
      if (detail.kind === "call-accepted" || detail.kind === "call-declined") {
        window.dispatchEvent(new CustomEvent(`callme:fcm-${detail.kind}`, { detail: { peerId: detail.peerId || "" } }));
      } else if (/^(call-cancel|call-hangup|call-end|call-missed|missed)/.test(String(detail.kind || ""))) {
        window.dispatchEvent(new CustomEvent("callme:fcm-call-cancelled", { detail: { peerId: detail.peerId || "", callId: detail.callId || "" } }));
      }
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
    const rail = document.getElementById("app-rail");
    if (rail) {
      // Rail desktop ala Messenger: ikon saja, ☰ di atas untuk memperluas
      // label. Aksi (bahasa/tema/ekspor/keluar) memakai ulang kontrol yang
      // sudah ada di drawer menu (drawer tetap dipakai untuk layar HP).
      const railDefs = [
        { id: "rail-toggle", iconName: "menu", label: "Menu", action: "toggle" },
        { id: "rail-chat", iconName: "chat", panel: "friends", label: "Chat" },
        { id: "rail-profile", iconName: "person", panel: "profile", label: "Profil" },
        { id: "rail-admin", iconName: "admin-panel-settings", panel: "admin", label: "Administrator", adminOnly: true },
        { id: "rail-settings", iconName: "settings", panel: "settings", label: "Pengaturan" },
        { id: "rail-export", iconName: "package", action: "export", label: "Ekspor Chat" },
        { id: "rail-about", iconName: "info", panel: "about", label: "About" },
        { sep: true, bottom: true },
        { id: "rail-logout", iconName: "logout", action: "logout", label: "Log out", bottom: true },
      ];
      for (const def of railDefs) {
        if (def.sep) {
          const sep = document.createElement("div");
          sep.className = def.bottom ? "rail-sep rail-bottom" : "rail-sep";
          rail.append(sep);
          continue;
        }
        const btn = document.createElement("button");
        btn.id = def.id;
        btn.type = "button";
        btn.setAttribute("aria-label", def.label);
        if (def.panel) btn.setAttribute("data-rail-panel", def.panel);
        if (def.adminOnly) {
          btn.hidden = true;
          btn.setAttribute("aria-hidden", "true");
        }
        const icon = window.CallMeIcons?.icon?.(def.iconName);
        if (icon) btn.append(icon);
        const text = document.createElement("span");
        text.className = "rail-label";
        text.textContent = def.label;
        btn.append(text);
        if (def.bottom) btn.classList.add("rail-bottom");
        if (def.action === "toggle") {
          btn.setAttribute("aria-expanded", "false");
          btn.addEventListener("click", () => {
            // HP: ☰ di dalam rail menutup menu overlay.
            if (window.matchMedia("(max-width:899px)").matches) {
              closeSettingsDrawer();
              return;
            }
            const expanded = rail.classList.toggle("rail-expanded");
            btn.setAttribute("aria-expanded", String(expanded));
            try { localStorage.setItem("callme-v2-rail-expanded", expanded ? "1" : "0"); } catch { /* abaikan */ }
          });
        } else if (def.action === "export") {
          btn.addEventListener("click", () => document.getElementById("export-chat-button")?.click());
        } else if (def.action === "logout") {
          btn.addEventListener("click", () => document.querySelector("#main-menu [data-logout]")?.click());
        }
        if (def.action === "toggle") {
          // ☰ dibungkus blok header gelap setinggi header kolom lain (56px).
          const head = document.createElement("div");
          head.className = "rail-head";
          head.append(btn);
          rail.append(head);
        } else {
          rail.append(btn);
        }
      }
      try {
        if (localStorage.getItem("callme-v2-rail-expanded") === "1") {
          rail.classList.add("rail-expanded");
          document.getElementById("rail-toggle")?.setAttribute("aria-expanded", "true");
        }
      } catch { /* abaikan */ }
    }
    document.addEventListener("click", (event) => {
      const railBtn = event.target.closest("[data-rail-panel]");
      if (railBtn && rail && rail.contains(railBtn)) {
        event.preventDefault();
        const panel = String(railBtn.getAttribute("data-rail-panel") || "friends");
        if (typeof window.CallMeApp?.show === "function") window.CallMeApp.show(panel);
        return;
      }
      // Tutup overlay (desktop)
      const overlayClose = event.target.closest("[data-overlay-close]");
      if (overlayClose) {
        event.preventDefault();
        closeDesktopOverlays();
        return;
      }
      // Tutup overlay profil teman
      const fpClose = event.target.closest("[data-fp-close]");
      if (fpClose) {
        event.preventDefault();
        const fp = document.querySelector(".friend-profile-col");
        if (fp) fp.classList.remove("overlay-open", "mobile-open");
        return;
      }
      const back = event.target.closest("[data-back]");
      if (back) {
        event.preventDefault();
        const fromPanel = back.closest("[data-panel]")?.dataset.panel;
        const target = back.dataset.back;
        if (target === "friends" && fromPanel === "chatroom") {
          // Kembali dari chatroom: tutup chatroom, halaman utama tetap.
          show("friends", { closeChatroom: true });
        } else if (OVERLAY_PANELS.has(fromPanel || "") && isDesktopSplit()) {
          // Kembali dari panel overlay (desktop): tutup overlay, halaman utama tidak berubah.
          closeDesktopOverlays();
        } else if (target === "friends" && ["profile", "admin", "about", "location", "language", "theme"].includes(fromPanel || "")) {
          // Mobile: kembali dari panel ke daftar teman.
          show("friends");
        } else if (target === "chatroom") {
          show("chatroom");
        } else {
          show(target);
        }
        return;
      }
      const open = event.target.closest("[data-open-panel]");
      if (!open) return;
      const target = open.dataset.openPanel;
      if (target === "settings") {
        const menu = document.getElementById("main-menu");
        const backdrop = document.getElementById("main-menu-backdrop");
        const btn = document.getElementById("main-menu-btn");
        if (menu && backdrop) {
          event.preventDefault();
          menu.classList.add("open");
          backdrop.classList.add("open");
          menu.setAttribute("aria-hidden", "false");
          btn && btn.setAttribute("aria-expanded", "true");
        }
        return;
      }
      event.preventDefault();
      show(target);
    });

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
      show("friends", { closeChatroom: true });
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
