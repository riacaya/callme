(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const panel = document.querySelector('[data-panel="settings"]');
    if (!panel) return;
    const eventList = document.getElementById("event-log-list");
    const loadEventLog = async () => {
      if (!eventList) return;
      const rows = (await window.CallMeStorage?.all?.("event-log") || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 200);
      eventList.replaceChildren(...rows.map((row) => { const item = document.createElement("p"); item.className = "event-log-item"; item.textContent = `${new Date(row.createdAt).toLocaleString("id-ID")} · ${row.type} · ${row.message}${row.detail ? ` · ${row.detail}` : ""}`; return item; }));
    };
    window.addEventListener("callme:panel-change", (event) => { if (event.detail?.panel === "event-log") void loadEventLog(); });
    panel.parentElement?.querySelector("[data-clear-event-log]")?.addEventListener("click", async () => {
      if (!confirm("Hapus semua Event log lokal?")) return;
      await window.CallMeStorage?.replace?.("event-log", []);
      eventList?.replaceChildren();
    });
    const settingIcons = new Map([
      ["Edit Profil", "👤"],
      ["Install App", "📲"],
      ["Bahasa", "🌐"],
      ["Senja", "🌅"],
      ["Natural", "🌿"],
      ["Dark", "🌙"],
      ["Administrator", "🛠️"],
      ["About", "ℹ️"],
      ["Log out", "↪️"],
      ["Backup Lokal", "💾"],
      ["Export Database", "⬇️"],
      ["Import Database", "⬆️"],
    ]);
    panel.querySelectorAll("button").forEach((button) => {
      const label = button.textContent.trim();
      const icon = [...settingIcons].find(([text]) => label.includes(text))?.[1];
      if (!icon || button.querySelector(".setting-icon") || /^[\u{1F000}-\u{1FAFF}\u2600-\u27BF\u2B00-\u2BFF]/u.test(label)) return;
      const mark = document.createElement("span");
      mark.className = "setting-icon";
      mark.textContent = icon;
      mark.setAttribute("aria-hidden", "true");
      button.prepend(mark, document.createTextNode(" "));
    });
    const adminButton = panel.querySelector('[data-open-panel="admin"]');
    const isAdmin = (identity) => {
      const id = (window.CallMeApp?.normalize?.(identity || "") || "").replace(/^cm-/i, "");
      return /^(riacaya|aurora)$/.test(id);
    };
    const showAdmin = (identity) => {
      if (adminButton) {
        const visible = isAdmin(identity);
        adminButton.hidden = !visible;
        // .setting-action memiliki display:flex, sehingga atribut hidden
        // perlu diperkuat agar tidak dikalahkan oleh CSS.
        adminButton.style.display = visible ? "" : "none";
      }
    };
    showAdmin(sessionStorage.getItem("callme-v2-session-user"));
    window.addEventListener("callme:session-user", (event) => showAdmin(event.detail?.user));
    document
      .querySelectorAll('[data-open-panel="settings"]')
      .forEach((b) => (b.onclick = () => window.CallMeApp.show("settings")));
    panel
      .querySelectorAll("[data-back]")
      .forEach(
        (b) => (b.onclick = () => window.CallMeApp.show(b.dataset.back)),
      );
    panel
      .querySelectorAll("[data-open-panel]")
      .forEach(
        (b) => (b.onclick = () => {
          if (b.dataset.openPanel === "admin" && !isAdmin(sessionStorage.getItem("callme-v2-session-user"))) return;
          window.CallMeApp.show(b.dataset.openPanel);
        }),
      );
    panel.querySelectorAll("[data-theme]").forEach(
      (b) =>
        (b.onclick = () => {
          document.body.dataset.theme = b.dataset.theme;
          localStorage.setItem("callme-v2-theme", b.dataset.theme);
          markTheme(b.dataset.theme);
        }),
    );
    const markTheme = (active) => panel.querySelectorAll("[data-theme]").forEach((button) => {
      let mark = button.querySelector(".theme-check");
      if (!mark) { mark = document.createElement("span"); mark.className = "theme-check"; mark.textContent = "✓"; button.append(mark); }
      mark.hidden = button.dataset.theme !== active;
    });
    panel.querySelector("[data-logout]")?.addEventListener("click", () => {
      window.CallMeP2P?.stop();
      // Cabut token push browser dari relay sebelum sesi lokal dihapus.
      // Kegagalan jaringan dicatat; akun tetap logout.
      void window.CallMePush?.disableBrowser?.().catch((error) => {
        console.warn("Pencabutan notifikasi browser gagal saat logout", error);
      });
      sessionStorage.removeItem("callme-v2-session-user");
      sessionStorage.removeItem("callme-v2-session-token");
      localStorage.removeItem("callme-v2-persistent-session");
      window.CallMeApp.show("login");
    });
    const theme = localStorage.getItem("callme-v2-theme");
    if (theme) { document.body.dataset.theme = theme; markTheme(theme); }
    window.addEventListener("callme:peer-server-status", (e) => {
      const status = e.detail?.status;
      document
        .getElementById("p2p-status")
        ?.replaceChildren(
          document.createTextNode(
            status === "online"
              ? "P2P ready"
              : status === "conflict"
                ? "ID akun sedang dipakai di sesi lain"
                : "Menghubungi server...",
          ),
        );
    });
  });
})();
document.addEventListener("DOMContentLoaded", function () {
  var h = document.querySelector(
    '[data-panel="settings"] h2:not(.backup-title)',
  );
  if (h && !h.parentElement.querySelector('[data-theme="lavender"]')) {
    var b = document.createElement("button");
    b.className = "setting-action";
    b.dataset.theme = "lavender";
    b.textContent = "💜 Lavender";
    b.onclick = function () {
      document.body.dataset.theme = "lavender";
      localStorage.setItem("callme-v2-theme", "lavender");
    };
    h.after(b);
  }
  if (!localStorage.getItem("callme-v2-theme"))
    document.body.dataset.theme = "lavender";
});
