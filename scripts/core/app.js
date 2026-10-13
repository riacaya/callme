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
      const identity = normalize(sessionStorage.getItem("callme-v2-session-user") || "").replace(/^cm-/i, "");
      if (!/^(riacaya|aurora)$/.test(identity)) name = "settings";
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

  window.CallMeApp = Object.freeze({
    register,
    show,
    current,
    normalize,
    isAllowedIdentity,
    uid,
    roomId: window.CallMeIdentity.roomId,
    peerId: window.CallMeIdentity.peerId,
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
      return;
    }

    sessionStorage.removeItem("callme-v2-session-user");
    sessionStorage.removeItem("callme-v2-session-token");
    show("login");
  });
})();
