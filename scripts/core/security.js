(function () {
  const apiBase = "https://script.google.com/macros/s/AKfycby-8P8p94mCSoZGPRECwjKw7wPR2de6R1zPQRJoWDHBQ4FVBERV7RZdRtCv1Laps5LZ/exec";
  async function digest(value) {
    const bytes = new TextEncoder().encode(value);
    if (window.crypto?.subtle) {
      const hash = await window.crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(hash)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    }
    return btoa(unescape(encodeURIComponent(value)));
  }
  async function apiRequest(body, timeoutMs = null) {
    const controller = new AbortController();
    const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetch(apiBase, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      let result;
      try { result = await response.json(); } catch { result = { ok: false, error: "Respons server tidak valid." }; }
      return { response, result };
    } finally { if (timer) clearTimeout(timer); }
  }

  // Sesi yang ditolak server (mis. setelah SESSION_SECRET diganti atau proyek
  // Apps Script berpindah) harus membawa pengguna ke layar login dengan pesan
  // jelas, bukan diam-diam memakai cache lokal yang mulai basi.
  let sessionExpired = false;
  const isSessionRejected = (error) => /^Session .*tidak valid$/.test(String(error || ""));
  function forceLogout(message) {
    if (sessionExpired) return;
    const user = sessionStorage.getItem("callme-v2-session-user");
    const token = sessionStorage.getItem("callme-v2-session-token");
    // Akun perangkat (local-device-session) memang tidak punya sesi server;
    // mereka tetap bekerja dari cache tanpa harus keluar.
    if (!user || token === "local-device-session") return;
    sessionExpired = true;
    window.CallMeP2P?.stop();
    sessionStorage.removeItem("callme-v2-session-user");
    sessionStorage.removeItem("callme-v2-session-token");
    localStorage.removeItem("callme-v2-persistent-session");
    localStorage.removeItem("callme-v2-session-token");
    window.CallMeApp?.show("login");
    document.getElementById("login-status")?.replaceChildren(document.createTextNode(message));
  }
  function installSessionGuard() {
    const original = window.fetch;
    if (typeof original !== "function" || original.__callmeSessionGuard) return;
    const guarded = function (input, init) {
      const pending = original.call(this, input, init);
      // Klone dibaca lebih dulu dari konsumen lain sehingga body tetap utuh.
      pending.then((response) => {
        response.clone().json()
          .then((result) => {
            if (result && result.ok === false && isSessionRejected(result.error))
              forceLogout("Sesi tidak valid. Silakan masuk kembali.");
          })
          .catch(() => {});
      }).catch(() => {});
      return pending;
    };
    guarded.__callmeSessionGuard = true;
    window.fetch = guarded;
  }
  installSessionGuard();

  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("login-form");
    const user = document.getElementById("login-user");
    const password = document.getElementById("login-password");
    const status = document.getElementById("login-status");
    const toggle = document.getElementById("toggle-password");
    if (!form || !user || !password || !status) return;

    const setStatus = (message) => {
      status.textContent = message;
    };
    const getIdentity = () =>
      window.CallMeApp?.normalize?.(user.value) ||
      user.value.trim().toLowerCase();

    toggle?.addEventListener("click", () => {
      const visible = password.type === "text";
      password.type = visible ? "password" : "text";
      toggle.textContent = visible ? "👁️" : "🙈";
      toggle.setAttribute(
        "aria-label",
        visible ? "Tampilkan sandi" : "Sembunyikan sandi",
      );
      toggle.setAttribute("aria-pressed", String(!visible));
    });

    const cached = localStorage.getItem("callme-v2-user");
    if (cached) user.value = cached;
    const registerButton = document.getElementById("register-submit");
    const loginButton = document.getElementById("login-submit");
    registerButton?.addEventListener("click", () => { form.dataset.mode = "register"; });
    loginButton?.addEventListener("click", () => { form.dataset.mode = "login"; });

    const openLocalSession = (identity) => {
      const localUser = localStorage.getItem("callme-v2-persistent-session");
      const localToken = localStorage.getItem("callme-v2-session-token");
      if (!localUser || !localToken || window.CallMeApp?.normalize?.(localUser) !== identity) return false;
      sessionStorage.setItem("callme-v2-session-user", localUser);
      sessionStorage.setItem("callme-v2-session-token", localToken);
      sessionStorage.setItem("callme-v2-role", /^(riacaya|aurora)$/.test(identity) ? "admin" : "user");
      window.CallMeP2P?.start(localUser);
      window.CallMeApp.show("friends");
      return true;
    };
    const openLocalAccount = async (identity, secret) => {
      const stored = localStorage.getItem(`callme-local-account-${identity}`);
      if (!stored || stored !== await digest(secret)) return false;
      sessionStorage.setItem("callme-v2-session-user", identity);
      sessionStorage.setItem("callme-v2-session-token", "local-device-session");
      sessionStorage.setItem("callme-v2-role", /^(riacaya|aurora)$/.test(identity) ? "admin" : "user");
      localStorage.setItem("callme-v2-persistent-session", identity);
      localStorage.setItem("callme-v2-session-token", "local-device-session");
      localStorage.setItem("callme-v2-user", identity);
      window.CallMeP2P?.start(identity);
      window.CallMeApp.show("friends");
      return true;
    };
    const refreshServerSession = async (identity, secret) => {
      try {
        const { result } = await apiRequest({ action: "login", username: identity, password: secret });
        if (!result?.ok || !result.token) return;
        sessionStorage.setItem("callme-v2-session-user", result.username || identity);
        sessionStorage.setItem("callme-v2-session-token", result.token);
        sessionStorage.setItem("callme-v2-role", result.role || "user");
        localStorage.setItem("callme-v2-persistent-session", result.username || identity);
        localStorage.setItem("callme-v2-session-token", result.token);
        sessionExpired = false;
      } catch {}
    };

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const signup = form.dataset.mode === "register" || event.submitter?.id === "register-submit";
      const identity = getIdentity();
      const secret = password.value;
      if (!identity || secret.length < 4) {
        setStatus("User dan sandi minimal harus diisi.");
        return;
      }

      const isAdministrator = /^(riacaya|aurora)$/.test(identity);
      if (!signup && !isAdministrator && openLocalSession(identity)) {
        password.value = "";
        setStatus("Membuka dari sesi lokal...");
        void refreshServerSession(identity, secret);
        return;
      }
      if (!signup && !isAdministrator && await openLocalAccount(identity, secret)) {
        password.value = "";
        setStatus("Membuka dari database lokal...");
        void refreshServerSession(identity, secret);
        return;
      }

      setStatus(
        signup ? "Menyimpan akun..." : "Memeriksa akun...",
      );
      try {
        if (apiBase) {
          let request;
          try {
            request = await apiRequest({
              action: signup ? "register" : "login",
              username: identity,
              password: secret,
            }, signup ? 30000 : null);
          } catch (error) {
            if (!signup && openLocalSession(identity)) {
              password.value = "";
              setStatus("Membuka dari sesi lokal...");
              return;
            }
            throw error;
          }
          const { response, result } = request;
          if (!response.ok || !result.ok) {
            setStatus(result.error || "User atau sandi salah.");
            return;
          }
          sessionStorage.setItem("callme-v2-session-user", result.username || identity);
          sessionStorage.setItem("callme-v2-session-token", result.token || "");
          sessionStorage.setItem("callme-v2-role", result.role || "user");
          localStorage.setItem("callme-v2-persistent-session", result.username || identity);
          localStorage.setItem("callme-v2-session-token", result.token || "");
          localStorage.setItem("callme-v2-user", result.username || identity);
          sessionExpired = false;
          // Cache lokal untuk login cepat berikutnya; hanya hash, bukan sandi mentah.
          if (!isAdministrator) localStorage.setItem(`callme-local-account-${identity}`, await digest(secret));
          void window.CallMeProfileRepository?.syncAll?.(result.username || identity, result.token || "");
          window.dispatchEvent(new CustomEvent("callme:session-user", { detail: { user: result.username || identity, role: result.role || "user" } }));
          window.CallMeP2P?.start(result.username || identity);
          password.value = "";
          setStatus("Membuka aplikasi...");
          window.CallMeApp.show("friends");
          return;
        }
        const key = `callme-local-account-${identity}`;
        const stored = localStorage.getItem(key);
        const hash = await digest(secret);
        if (signup) {
          if (stored) {
            setStatus("User sudah terdaftar di perangkat ini.");
            return;
          }
          localStorage.setItem(key, hash);
        } else if (!stored || stored !== hash) {
          setStatus("User atau sandi salah di perangkat ini.");
          return;
        }

        sessionStorage.setItem("callme-v2-session-user", identity);
        sessionStorage.setItem(
          "callme-v2-session-token",
          "local-device-session",
        );
        localStorage.setItem("callme-v2-persistent-session", identity);
        localStorage.setItem("callme-v2-user", identity);
        window.dispatchEvent(
          new CustomEvent("callme:session-user", {
            detail: { user: identity },
          }),
        );
        window.CallMeP2P?.start(identity);
        password.value = "";
        setStatus("Membuka aplikasi...");
        window.CallMeApp.show("friends");
      } catch (error) {
        console.error(error);
        setStatus(error.name === "AbortError" ? "Server terlalu lama merespons. Coba lagi." : "Koneksi ke server gagal.");
      }
    });
  });
})();
