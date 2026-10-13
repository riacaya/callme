(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const panel = document.querySelector('[data-panel="settings"]');
    if (!panel) return;

    const icons = new Map([
      ["Edit Profil", "👤"], ["Install APK", "📲"], ["Bahasa", "🌐"],
      ["Senja", "🌅"], ["Natural", "🌿"], ["Dark", "🌙"],
      ["Ekspor Chat", "📦"], ["About", "ℹ️"], ["Log out", "↪️"],
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
