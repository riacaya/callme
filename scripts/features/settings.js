(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const panel = document.querySelector('[data-panel="settings"]');
    if (!panel) return;

    const icons = new Map([
      ["Edit Profil", "👤"], ["Install APK", "📲"], ["Bahasa", "🌐"],
      ["Senja", "🌅"], ["Natural", "🌿"], ["Dark", "🌙"], ["Administrator", "🛠️"],
      ["About", "ℹ️"], ["Log out", "↪️"],
    ]);
    panel.querySelectorAll("button").forEach((button) => {
      const label = button.textContent.trim();
      const icon = [...icons].find(([text]) => label.includes(text))?.[1];
      if (!icon || button.querySelector(".setting-icon") || /^[\u{1F000}-\u{1FAFF}\u2600-\u27BF\u2B00-\u2BFF]/u.test(label)) return;
      const mark = document.createElement("span");
      mark.className = "setting-icon";
      mark.textContent = icon;
      mark.setAttribute("aria-hidden", "true");
      button.prepend(mark, document.createTextNode(" "));
    });

    const eventList = document.getElementById("event-log-list");
    const loadEventLog = async () => {
      if (!eventList) return;
      const activeUser = (window.CallMeApp?.normalize?.(sessionStorage.getItem("callme-v2-session-user") || "") || "").replace(/^cm-/i, "");
      const rows = (await window.CallMeStorage?.all?.("event-log") || [])
        .filter((row) => (window.CallMeApp?.normalize?.(row.user || "") || "").replace(/^cm-/i, "") === activeUser)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 200);
      eventList.replaceChildren(...rows.map((row) => {
        const item = document.createElement("p");
        item.className = "event-log-item";
        item.textContent = `${new Date(row.createdAt).toLocaleString("id-ID")} · ${row.type} · ${row.message}${row.detail ? ` · ${row.detail}` : ""}`;
        return item;
      }));
    };
    window.addEventListener("callme:panel-change", (event) => {
      if (event.detail?.panel === "event-log") void loadEventLog();
    });
    panel.parentElement?.querySelector("[data-clear-event-log]")?.addEventListener("click", async () => {
      if (!confirm("Hapus semua Event log lokal akun ini?")) return;
      const activeUser = (window.CallMeApp?.normalize?.(sessionStorage.getItem("callme-v2-session-user") || "") || "").replace(/^cm-/i, "");
      const rows = await window.CallMeStorage?.all?.("event-log") || [];
      await window.CallMeStorage?.replace?.("event-log", rows.filter((row) => (row.user || "").replace(/^cm-/i, "") !== activeUser));
      eventList?.replaceChildren();
    });
    const adminButton = panel.querySelector('[data-open-panel="admin"]');
    const isAdmin = (identity) => /^(riacaya|aurora)$/.test(
      (window.CallMeApp?.normalize?.(identity || "") || "").replace(/^cm-/i, ""),
    );
    const showAdmin = (identity) => {
      if (!adminButton) return;
      const visible = isAdmin(identity);
      adminButton.hidden = !visible;
      adminButton.style.display = visible ? "" : "none";
    };
    showAdmin(sessionStorage.getItem("callme-v2-session-user"));
    window.addEventListener("callme:session-user", (event) => showAdmin(event.detail?.user));

    const markTheme = (active) => panel.querySelectorAll("[data-theme]").forEach((button) => {
      let mark = button.querySelector(".theme-check");
      if (!mark) {
        mark = document.createElement("span");
        mark.className = "theme-check";
        mark.textContent = "✓";
        button.append(mark);
      }
      mark.hidden = button.dataset.theme !== active;
    });
    panel.querySelectorAll("[data-theme]").forEach((button) => {
      button.addEventListener("click", () => {
        document.body.dataset.theme = button.dataset.theme;
        localStorage.setItem("callme-v2-theme", button.dataset.theme);
        markTheme(button.dataset.theme);
      });
    });

    panel.querySelector("[data-logout]")?.addEventListener("click", () => {
      window.CallMeP2P?.stop();
      sessionStorage.removeItem("callme-v2-session-user");
      sessionStorage.removeItem("callme-v2-session-token");
      localStorage.removeItem("callme-v2-persistent-session");
      window.CallMeApp.show("login");
    });

    const theme = localStorage.getItem("callme-v2-theme");
    if (theme) {
      document.body.dataset.theme = theme;
      markTheme(theme);
    }
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
