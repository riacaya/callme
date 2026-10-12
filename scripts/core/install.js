(function () {
  const apkUrl = "https://drive.google.com/file/d/1qUZhDVDepBRUFkziuC_hUXYaQm_Ca1r7/view?usp=sharing";
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
        button.textContent = "Install APK";
        button.hidden = false;
        anchor.before(button);
      }
    }
    const buttons = [...document.querySelectorAll("[data-install-app]")];
    if (!buttons.length) return;
    buttons.forEach((button) => {
      button.hidden = false;
      button.textContent = "Install APK";
      button.onclick = () => window.open(apkUrl, "_blank", "noopener");
    });
  });
})();
