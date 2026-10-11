(function () {
  const dictionaries = {
    en: window.CallMeLocaleEN || {},
    id: window.CallMeLocaleID || {},
  };
  const translatableSelector =
    ".setting-action,h1,h2,label,button,option,input[placeholder],textarea[placeholder]";

  function applyLanguage(language) {
    const dictionary = dictionaries[language] || {};
    document.querySelectorAll(translatableSelector).forEach((element) => {
      if (!element.dataset.i18nSource) {
        element.dataset.i18nSource = element.matches("input,textarea")
          ? element.placeholder
          : element.textContent;
      }
      const source = element.dataset.i18nSource;
      if (
        !source ||
        element.children.length ||
        (language !== "id" && !(source in dictionary))
      )
        return;
      const value = language === "id" ? source : dictionary[source];
      if (element.matches("input,textarea")) element.placeholder = value;
      else element.textContent = value;
    });
    document.documentElement.lang = language;
    localStorage.setItem("callme-language", language);
  }

  document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.getElementById("language-toggle");
    if (!toggle) return;
    const box = toggle.closest(".language-setting");
    if (box) {
      box.innerHTML = '<strong class="language-heading">Bahasa</strong><button type="button" class="language-option" data-language="id"><span><i class="language-flag flag-id" aria-hidden="true"></i>Indonesia</span><span class="language-check">✓</span></button><button type="button" class="language-option" data-language="en"><span><i class="language-flag flag-en" aria-hidden="true"></i>English</span><span class="language-check">✓</span></button>';
    }
    const initialLanguage = localStorage.getItem("callme-language") || "id";
    const updateLanguage = (language) => {
      document.querySelectorAll(".language-option").forEach((button) => { button.classList.toggle("is-active", button.dataset.language === language); });
      applyLanguage(language);
    };
    updateLanguage(initialLanguage);
    document.querySelectorAll(".language-option").forEach((button) => button.addEventListener("click", () => updateLanguage(button.dataset.language)));
  });
})();
