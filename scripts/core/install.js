(function () {
  let deferredPrompt = null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event;
    document.querySelectorAll("[data-install-app]").forEach((button) => button.removeAttribute("hidden"));
  });
  window.addEventListener("appinstalled", () => { deferredPrompt = null; document.querySelectorAll("[data-install-app]").forEach((button) => button.setAttribute("hidden", "")); });
  document.addEventListener("DOMContentLoaded", () => {
    let button = document.querySelector('[data-panel="settings"] [data-install-app]');
    if (!button) {
      const settings = document.querySelector('[data-panel="settings"] .panel-content');
      const anchor = settings?.querySelector('[data-open-panel="about"]') || settings?.lastElementChild;
      if (settings && anchor) {
        button = document.createElement("button");
        button.type = "button";
        button.className = "setting-action";
        button.dataset.installApp = "";
        button.textContent = "Install App";
        button.hidden = false;
        anchor.before(button);
      }
    }
    const buttons = [...document.querySelectorAll("[data-install-app]")];
    if (!buttons.length) return;
    buttons.forEach((button) => { button.hidden = false; button.addEventListener("click", async () => {
      if (!deferredPrompt) { alert("Buka aplikasi melalui Chrome HTTPS, lalu pilih menu Chrome > Tambahkan ke layar utama."); return; }
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      buttons.forEach((target) => { target.hidden = true; });
    }); });
  });
})();
