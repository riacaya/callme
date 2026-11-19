(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const panel = document.querySelector('[data-panel="settings"]') || document.getElementById("main-menu");
    const menu = document.getElementById("main-menu");
    const iconTargets = [panel, menu].filter(Boolean);

    const icons = new Map([
      ["Edit Profil", "👤"], ["Bahasa", "🌐"],
      ["Senja", "🌅"], ["Natural", "🌿"], ["Dark", "🌙"],
      ["Ekspor Chat", "📦"], ["About", "ℹ️"], ["Log out", "↪️"],
    ]);
    iconTargets.forEach((root) => {
      root.querySelectorAll("button").forEach((button) => {
        // Tombol dengan <span class="setting-ico" data-ico="..."> memakai ikon
        // SVG sprite (CallMeIcons); sisanya fallback emoji.
        const existingIco = button.querySelector(".setting-icon, .setting-ico");
        if (existingIco) return;
        const label = button.textContent.trim();
        const icon = [...icons].find(([text]) => label.includes(text))?.[1];
        if (!icon || /^[\u{1F000}-\u{1FAFF}\u2600-\u27BF\u2B00-\u2BFF]/u.test(label)) return;
        const mark = document.createElement("span");
        mark.className = "setting-icon";
        mark.textContent = icon;
        mark.setAttribute("aria-hidden", "true");
        button.prepend(mark, document.createTextNode(" "));
      });

      // Render ikon SVG pada tombol ber-`data-ico`.
      root.querySelectorAll(".setting-ico[data-ico]").forEach((span) => {
        if (span.childElementCount) return;
        const name = span.getAttribute("data-ico");
        const iconFn = window.CallMeIcons && window.CallMeIcons[name];
        if (typeof iconFn !== "function") return;
        try {
          span.appendChild(iconFn());
        } catch (_) {}
      });
    });

    const markTheme = (active) => document.querySelectorAll("[data-theme]").forEach((button) => {
      let mark = button.querySelector(".theme-check");
      if (!mark) {
        mark = document.createElement("span");
        mark.className = "theme-check";
        mark.textContent = "✓";
        button.append(mark);
      }
      mark.hidden = button.dataset.theme !== active;
    });
    document.querySelectorAll("[data-theme]").forEach((button) => {
      button.addEventListener("click", () => {
        document.body.dataset.theme = button.dataset.theme;
        localStorage.setItem("callme-v2-theme", button.dataset.theme);
        markTheme(button.dataset.theme);
      });
    });

    const doLogout = () => {
      try { window.CallMeWebPush?.unregister(); } catch (_) {}
      window.CallMeP2P?.stop();
      sessionStorage.removeItem("callme-v2-session-user");
      sessionStorage.removeItem("callme-v2-session-token");
      localStorage.removeItem("callme-v2-session-token");
      localStorage.removeItem("callme-v2-persistent-session");
      localStorage.removeItem("callme-v2-user");
      window.dispatchEvent(new CustomEvent("callme:session-user", { detail: { user: "" } }));
      window.CallMeApp.show("login");
    };
    document.querySelectorAll("#main-menu [data-logout]").forEach((btn) => btn.addEventListener("click", doLogout));

    const theme = localStorage.getItem("callme-v2-theme");
    if (theme) {
      document.body.dataset.theme = theme;
      markTheme(theme);
    }

    // Suara & notifikasi
    const applySoundUi = () => {
      const s = window.CallMeSound?.settings?.() || { callRingtone: true, messageTone: true };
      const ring = document.getElementById("sound-call-ringtone");
      const msg = document.getElementById("sound-message-tone");
      if (ring) ring.checked = s.callRingtone !== false;
      if (msg) msg.checked = s.messageTone !== false;
    };
    applySoundUi();
    document.getElementById("sound-call-ringtone")?.addEventListener("change", (e) => {
      window.CallMeSound?.set?.({ callRingtone: !!e.target.checked });
    });
    document.getElementById("sound-message-tone")?.addEventListener("change", (e) => {
      window.CallMeSound?.set?.({ messageTone: !!e.target.checked });
      if (e.target.checked) {
        try { window.CallMeSound?.playMessageTone?.(); } catch (_) {}
      }
    });

    // Koneksi: TURN (relay) aktif/nonaktif, default aktif
    const turnEnabledInput = document.getElementById("setting-turn-enabled");
    const turnStatus = document.getElementById("setting-turn-status");
    const syncTurnUi = () => {
      const enabled = localStorage.getItem("callme-v2-no-turn") !== "1";
      if (turnEnabledInput) turnEnabledInput.checked = enabled;
      if (turnStatus) {
        turnStatus.textContent = enabled
          ? "Aktif (default): gunakan STUN + TURN saat koneksi langsung tidak memungkinkan. P2P akan dimulai ulang saat diubah."
          : "Nonaktif: gunakan STUN/direct saja (tanpa relay TURN). Jika direct tidak memungkinkan, koneksi bisa gagal. P2P akan dimulai ulang saat diubah.";
      }
    };
    syncTurnUi();
    turnEnabledInput?.addEventListener("change", () => {
      const enabled = !!turnEnabledInput.checked;
      localStorage.setItem("callme-v2-no-turn", enabled ? "0" : "1");
      syncTurnUi();
      const user = sessionStorage.getItem("callme-v2-session-user") || "";
      if (user && window.CallMeTransport) {
        try {
          window.CallMeTransport.stop();
          window.CallMeTransport.start(user);
          if (turnStatus) {
            turnStatus.textContent = enabled
              ? "TURN aktif. P2P dimulai ulang (STUN + TURN)."
              : "TURN nonaktif. P2P dimulai ulang (hanya STUN/direct).";
          }
        } catch (e) {
          if (turnStatus) turnStatus.textContent = "Gagal memulai ulang P2P: " + (e?.message || e);
        }
      }
    });
    window.addEventListener("callme:peer-server-status", (event) => {
      const status = event.detail?.status;
      document.getElementById("p2p-status")?.replaceChildren(
        document.createTextNode(
          status === "online" ? "P2P ready" : status === "conflict"
            ? "ID akun sedang dipakai di sesi lain" : "Menghubungi server...",
        ),
      );
    });
  });
})();
