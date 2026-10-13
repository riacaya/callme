(function () {
  const API = "https://script.google.com/macros/s/AKfycby-8P8p94mCSoZGPRECwjKw7wPR2de6R1zPQRJoWDHBQ4FVBERV7RZdRtCv1Laps5LZ/exec";
  const TURN_SERVERS = [
    { urls: "turn:global.relay.metered.ca:80", username: "466494188ac3580fb1c6df34", credential: "f8Qc+SUXdyhuVIgB" },
    { urls: "turn:global.relay.metered.ca:80?transport=tcp", username: "466494188ac3580fb1c6df34", credential: "f8Qc+SUXdyhuVIgB" },
    { urls: "turn:global.relay.metered.ca:443", username: "466494188ac3580fb1c6df34", credential: "f8Qc+SUXdyhuVIgB" },
    { urls: "turns:global.relay.metered.ca:443?transport=tcp", username: "466494188ac3580fb1c6df34", credential: "f8Qc+SUXdyhuVIgB" },
  ];
  const TURN_TEST_PEERS = { riacaya: "cm-riacaya99", aurora: "cm-aurora99" };
  const TURN_TEST_TIMEOUT = 30000;
  const normalize = (value) => String(value || "").trim().replace(/^cm-/i, "").toLowerCase();
  const isAdmin = (value) => /^(aurora|riacaya)$/.test(normalize(value));
  const currentUser = () => sessionStorage.getItem("callme-v2-session-user") || "";
  const fallbackAvatar = () => window.CallMeChatUtils?.defaultAvatar || "assets/logo-192.png";

  document.addEventListener("DOMContentLoaded", () => {
    const adminButton = document.querySelector('[data-open-panel="admin"]');
    const adminPanel = document.querySelector('[data-panel="admin"]');
    const turnButton = document.getElementById("admin-turn-test");
    const turnStatus = document.getElementById("admin-turn-status");
    const turnProgressBar = document.getElementById("admin-turn-progress-bar");
    const turnProgress = turnProgressBar.closest(".admin-turn-progress");
    const turnProgressValue = document.getElementById("admin-turn-progress-value");
    const loadButton = document.getElementById("admin-load-users");
    const usersStatus = document.getElementById("admin-users-status");
    const usersList = document.getElementById("admin-users");
    if (!adminButton || !adminPanel || !turnButton || !turnProgressBar || !loadButton || !usersList) return;

    function updateAccess(user = currentUser()) {
      const allowed = isAdmin(user);
      adminButton.hidden = !allowed;
      adminButton.setAttribute("aria-hidden", String(!allowed));
      if (!allowed && !adminPanel.classList.contains("hidden")) window.CallMeApp?.show?.("friends");
    }
    updateAccess();
    window.addEventListener("callme:session-user", (event) => updateAccess(event.detail?.user));
    window.addEventListener("callme:panel-change", (event) => {
      updateAccess();
      if (event.detail?.panel === "admin" && !isAdmin(currentUser())) window.CallMeApp?.show?.("friends");
    });
    document.addEventListener("click", (event) => {
      const opener = event.target.closest?.('[data-open-panel="admin"]');
      if (opener && !isAdmin(currentUser())) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);

    async function callAdmin(action, extra = {}, onProgress = () => {}) {
      const admin = currentUser();
      const token = sessionStorage.getItem("callme-v2-session-token") || "";
      if (!isAdmin(admin) || !token) throw new Error("Sesi administrator tidak valid. Silakan masuk kembali.");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        onProgress(8);
        const response = await fetch(API, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: JSON.stringify({ action, admin, token, ...extra }),
          signal: controller.signal,
        });
        onProgress(55);
        const result = await response.json();
        onProgress(78);
        if (!result.ok) throw new Error(result.error || "Permintaan administrator gagal.");
        return result;
      } finally { clearTimeout(timer); }
    }

    function setAdminProgress(value, state = "is-running") {
      const percent = Math.max(0, Math.min(100, Math.round(value)));
      turnProgressBar.className = state;
      turnProgressBar.style.setProperty("--turn-progress", `${percent}%`);
      turnProgress.setAttribute("aria-valuenow", String(percent));
      turnProgressValue.textContent = `${percent}%`;
    }

    let turnTestPeer = null;
    let turnCleanupTimer = null;
    turnButton.addEventListener("click", async () => {
      if (!isAdmin(currentUser())) return;
      turnButton.disabled = true;
      setAdminProgress(0);
      const role = normalize(currentUser());
      const peerId = TURN_TEST_PEERS[role];
      const remoteId = TURN_TEST_PEERS[role === "riacaya" ? "aurora" : "riacaya"];
      let progressTimer;
      let outcomeTimer;
      let connectionTimer;
      let settled = false;
      const finish = (ok, message) => {
        if (settled) return;
        settled = true;
        clearInterval(progressTimer);
        clearTimeout(outcomeTimer);
        clearTimeout(connectionTimer);
        setAdminProgress(100, ok ? "is-success" : "is-error");
        turnStatus.textContent = message;
        turnCleanupTimer = setTimeout(() => {
          try { turnTestPeer?.destroy(); } catch {}
          turnTestPeer = null;
          turnButton.disabled = false;
        }, 3000);
      };
      turnStatus.textContent = role === "aurora"
        ? `Membuka peer ${peerId}; menunggu Riacaya (${remoteId})…`
        : `Membuka peer ${peerId}; mencari Aurora (${remoteId})…`;
      try {
        if (!window.Peer) throw new Error("Library PeerJS tidak tersedia.");
        turnTestPeer = new Peer(peerId, {
          debug: 1,
          config: { iceServers: TURN_SERVERS, iceTransportPolicy: "relay", iceCandidatePoolSize: 2, sdpSemantics: "unified-plan" },
        });
        const startedAt = Date.now();
        progressTimer = setInterval(() => {
          setAdminProgress(Math.min(80, Math.floor(((Date.now() - startedAt) / TURN_TEST_TIMEOUT) * 80)));
        }, 250);
        outcomeTimer = setTimeout(() => finish(false, `Gagal: belum terhubung ke ${remoteId} dalam 30 detik.`), TURN_TEST_TIMEOUT);
        turnTestPeer.on("open", () => {
          if (settled) return;
          setAdminProgress(10);
          if (role === "aurora") {
            turnStatus.textContent = `${peerId} siap. Menunggu perangkat Riacaya masuk…`;
            return;
          }
          turnStatus.textContent = `${peerId} siap. Menghubungkan ke ${remoteId} melalui TURN…`;
          connectionTimer = setTimeout(() => finish(false, `Gagal: ${remoteId} belum aktif atau tidak dapat dijangkau.`), 12000);
          const connection = turnTestPeer.connect(remoteId, { reliable: true, serialization: "json", metadata: { callmeTurnTest: true } });
          connection.on("open", async () => {
            if (settled) return;
            clearTimeout(connectionTimer);
            clearInterval(progressTimer);
            setAdminProgress(85);
            try {
              const stats = await connection.peerConnection.getStats();
              let selected;
              stats.forEach((item) => {
                if (item.type === "candidate-pair" && (item.selected || item.nominated) && item.state === "succeeded") selected = item;
              });
              const local = selected && stats.get(selected.localCandidateId);
              const remote = selected && stats.get(selected.remoteCandidateId);
              const viaTurn = local?.candidateType === "relay" || remote?.candidateType === "relay";
              if (!viaTurn) {
                finish(false, "Koneksi peer berhasil, tetapi route yang terpilih tidak memakai TURN.");
                return;
              }
              const protocol = local?.protocol || remote?.protocol || "relay";
              finish(true, `Berhasil: ${peerId} terhubung ke ${remoteId} melalui TURN (${protocol}).`);
            } catch {
              finish(false, "Koneksi terbuka, tetapi route TURN tidak dapat diverifikasi.");
            }
          });
          connection.on("error", (error) => finish(false, `Gagal menghubungkan ke ${remoteId}: ${error.message || "peer tidak tersedia."}`));
          connection.on("close", () => { if (!settled) finish(false, "Koneksi uji ditutup sebelum route TURN terverifikasi."); });
        });
        turnTestPeer.on("connection", (connection) => {
          if (role !== "aurora" || connection.peer !== remoteId || connection.metadata?.callmeTurnTest !== true) {
            connection.close();
            return;
          }
          connection.on("open", () => {
            clearTimeout(connectionTimer);
            clearInterval(progressTimer);
            setAdminProgress(85);
            turnStatus.textContent = `${remoteId} terhubung. Memverifikasi route TURN…`;
            connectionTimer = setTimeout(async () => {
              if (settled) return;
              try {
                const stats = await connection.peerConnection.getStats();
                let selected;
                stats.forEach((item) => {
                  if (item.type === "candidate-pair" && (item.selected || item.nominated) && item.state === "succeeded") selected = item;
                });
                const local = selected && stats.get(selected.localCandidateId);
                const remote = selected && stats.get(selected.remoteCandidateId);
                if (local?.candidateType !== "relay" && remote?.candidateType !== "relay") {
                  finish(false, "Peer terhubung, tetapi route yang terpilih tidak memakai TURN.");
                  return;
                }
                finish(true, `Berhasil: ${peerId} terhubung ke ${remoteId} melalui TURN.`);
              } catch { finish(false, "Peer terhubung, tetapi route TURN tidak dapat diverifikasi."); }
            }, 1200);
          });
          connection.on("error", (error) => finish(false, `Koneksi dari ${remoteId} gagal: ${error.message || "kesalahan peer."}`));
        });
        turnTestPeer.on("error", (error) => {
          if (role === "aurora" && error.type === "peer-unavailable") return;
          const message = error.type === "unavailable-id"
            ? `Gagal: ID ${peerId} sedang dipakai sesi uji lain.`
            : error.type === "peer-unavailable"
              ? `Gagal: ${remoteId} belum aktif. Jalankan perangkat Aurora lebih dahulu.`
              : `Gagal membuka koneksi uji: ${error.message || error.type || "kesalahan PeerJS."}`;
          finish(false, message);
        });
        turnTestPeer.on("disconnected", () => finish(false, "Koneksi ke server PeerJS terputus sebelum pengujian selesai."));
        turnTestPeer.on("close", () => { turnTestPeer = null; });
      } catch (error) {
        finish(false, `Gagal memulai uji: ${error.message || "koneksi relay gagal."}`);
      }
    });
    window.addEventListener("pagehide", () => {
      clearTimeout(turnCleanupTimer);
      try { turnTestPeer?.destroy(); } catch {}
      turnTestPeer = null;
    });

    function createUserRow(row) {
      const usernameValue = String(row.username || "");
      const item = document.createElement("div");
      item.className = "admin-user";
      const avatar = document.createElement("img");
      avatar.className = "admin-user-avatar";
      avatar.alt = usernameValue ? `Foto profil ${usernameValue}` : "Foto profil user";
      avatar.loading = "lazy";
      avatar.src = row.photo_url || fallbackAvatar();
      avatar.addEventListener("error", () => { avatar.src = fallbackAvatar(); }, { once: true });

      const info = document.createElement("div");
      info.className = "admin-user-name";
      const displayName = document.createElement("strong");
      displayName.textContent = row.display_name || usernameValue || "User";
      const username = document.createElement("small");
      username.textContent = usernameValue;
      info.append(displayName, username);

      const actions = document.createElement("div");
      actions.className = "admin-user-actions";
      const reset = document.createElement("button");
      reset.type = "button";
      reset.className = "admin-user-action admin-user-reset";
      reset.textContent = "🖊️";
      reset.title = `Reset sandi ${usernameValue} ke 0000`;
      reset.setAttribute("aria-label", reset.title);
      reset.addEventListener("click", async () => {
        if (!isAdmin(currentUser()) || !confirm(`Reset sandi ${usernameValue} ke 0000? User harus mengganti sandi saat masuk berikutnya.`)) return;
        reset.disabled = true;
        try {
          await callAdmin("admin-reset-password", { username: usernameValue });
          usersStatus.textContent = `Sandi ${usernameValue} di-reset ke 0000; user diminta mengganti sandi saat masuk.`;
        } catch (error) {
          usersStatus.textContent = error.name === "AbortError" ? "Server terlalu lama merespons." : error.message;
        } finally { reset.disabled = false; }
      });

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "admin-user-action admin-user-delete";
      remove.textContent = "×";
      remove.title = `Hapus user ${usernameValue}`;
      remove.setAttribute("aria-label", remove.title);
      remove.addEventListener("click", async () => {
        if (!isAdmin(currentUser()) || !confirm(`Hapus akun ${usernameValue} dari database CallMe dan pindahkan foto profilnya ke sampah Drive jika ada?`)) return;
        remove.disabled = true;
        reset.disabled = true;
        try {
          const result = await callAdmin("admin-delete", { username: usernameValue });
          item.remove();
          usersStatus.textContent = result.photoDeleted ? `User ${usernameValue} dan foto profilnya dihapus.` : `User ${usernameValue} dihapus; tidak ada foto profil Drive yang terhapus.`;
        } catch (error) {
          usersStatus.textContent = error.name === "AbortError" ? "Server terlalu lama merespons." : error.message;
          remove.disabled = false;
          reset.disabled = false;
        }
      });
      actions.append(reset, remove);
      item.append(avatar, info, actions);
      return item;
    }

    async function loadUsers() {
      if (!isAdmin(currentUser())) return;
      loadButton.disabled = true;
      setAdminProgress(0);
      usersStatus.textContent = "Mengambil nama dan foto profil dari server admin…";
      usersList.replaceChildren();
      try {
        const result = await callAdmin("admin-list", {}, setAdminProgress);
        const rows = Array.isArray(result.users) ? result.users : [];
        setAdminProgress(90);
        const userItems = rows.map(createUserRow);
        usersList.replaceChildren(...userItems);
        setAdminProgress(100, "is-success");
        usersStatus.textContent = `${rows.length} user ditemukan.`;
      } catch (error) {
        setAdminProgress(100, "is-error");
        usersStatus.textContent = error.name === "AbortError" ? "Server terlalu lama merespons." : error.message;
      } finally { loadButton.disabled = false; }
    }
    loadButton.addEventListener("click", () => void loadUsers());
  });
})();
