(function () {
  const API = "https://script.google.com/macros/s/AKfycby-8P8p94mCSoZGPRECwjKw7wPR2de6R1zPQRJoWDHBQ4FVBERV7RZdRtCv1Laps5LZ/exec";
  document.addEventListener("DOMContentLoaded", () => {
    const panel = document.querySelector('[data-panel="admin"]'), list = document.getElementById("admin-users"), syncLabel = document.getElementById("admin-sync-label"), status = syncLabel, syncPercent = document.getElementById("admin-sync-percent"), syncBar = document.getElementById("admin-sync-bar"), turnTest = document.getElementById("admin-turn-test"), syncButton = document.getElementById("admin-sync-database"); if (!panel || !list) return;
    turnTest?.addEventListener("click", async () => {
      const self = String(sessionStorage.getItem("callme-v2-session-user") || "").replace(/^cm-/i, "").toLowerCase();
      const target = self === "aurora" ? "riacaya" : "aurora";
      turnTest.disabled = true;
      status.textContent = `Menguji TURN ke ${target}…`;
      try {
        const testTurn = window.CallMeTransport?.testTurn;
        if (typeof testTurn !== "function") throw new Error("Fitur uji TURN belum dimuat.");
        await testTurn(target);
        status.textContent = `TURN berhasil ke ${target}. Pesan uji dan balasan diterima.`;
        window.CallMeEventLog?.log?.("P2P", "Uji TURN berhasil", `${self} ↔ ${target}`);
      } catch (error) {
        status.textContent = `TURN gagal: ${error.message}`;
        window.CallMeEventLog?.log?.("P2P", "Uji TURN gagal", error.message);
      } finally { turnTest.disabled = false; }
    });
    const progress = (percent, label, running = true) => { if (syncPercent) syncPercent.textContent = `${percent}%`; if (syncLabel) syncLabel.textContent = label; if (syncBar) { syncBar.style.width = `${percent}%`; syncBar.classList.toggle("is-running", running && percent < 100); } };
    const call = async (action, extra = {}) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const response = await fetch(API, { method:"POST", headers:{"Content-Type":"text/plain;charset=utf-8"}, body:JSON.stringify({ action, admin:sessionStorage.getItem("callme-v2-session-user") || "", token:sessionStorage.getItem("callme-v2-session-token") || "", ...extra }), signal: controller.signal });
        try { return await response.json(); } catch { return { ok:false, error:"Respons server tidak valid." }; }
      } catch (error) { return { ok:false, error:error.name === "AbortError" ? "Spreadsheet terlalu lama merespons." : "Koneksi Spreadsheet gagal." }; }
      finally { clearTimeout(timer); }
    };
    let loading = false;
    syncButton?.addEventListener("click", () => void load());
    async function load() {
      if (loading) return;
      loading = true;
      if (syncButton) syncButton.disabled = true;
      progress(10, "Menghubungkan ke server…"); status.textContent = "Menyegarkan Spreadsheet…";
      try {
        progress(35, "Membaca database Admin…");
        const result = await call("admin-list");
        if (!result.ok) { progress(100, "Sinkronisasi gagal", false); status.textContent = result.error || "Gagal membaca Spreadsheet."; return; }
        progress(75, "Memuat daftar user…");
        list.replaceChildren(...(result.users || []).map(row => {
          const item = document.createElement("div"); item.className = "admin-contact";
          const img = document.createElement("img"); img.className = "admin-contact-avatar"; img.src = row.photo_url || window.CallMeChatUtils.defaultAvatar;
          const info = document.createElement("div"); info.className = "admin-contact-info";
          const name = document.createElement("strong"); name.textContent = row.display_name || row.username;
          const id = document.createElement("small"); id.textContent = row.username;
          const email = document.createElement("small"); email.textContent = row.email || "Email belum ada"; info.append(name, id, email);
          const actions = document.createElement("div"); actions.className = "admin-contact-actions";
          const reset = document.createElement("button"); reset.textContent = "reset"; reset.title = "Reset password ke 0000";
          reset.onclick = async () => { const r = await call("admin-reset-password", { username: row.username }); status.textContent = r.ok ? `Password ${row.username} di-reset ke 0000.` : r.error; };
          const del = document.createElement("button"); del.className = "admin-delete"; del.textContent = "✕";
          del.onclick = async () => { if (!confirm("Hapus user ini dari Spreadsheet?")) return; const r = await call("admin-delete", { username: row.username }); status.textContent = r.ok ? "User dihapus." : r.error; if (r.ok) load(); };
          actions.append(reset, del); item.append(img, info, actions); return item;
        }));
        status.textContent = `Spreadsheet · ${(result.users || []).length} user`;
        progress(100, "Sinkronisasi selesai", false);
      } finally { loading = false; if (syncButton) syncButton.disabled = false; }
    }
    panel.querySelectorAll("[data-back]").forEach(b => b.onclick = () => window.CallMeApp.show(b.dataset.back));
    window.addEventListener("callme:panel-change", event => { if (event.detail?.panel === "admin") { list.replaceChildren(); progress(0, "Siap menyinkronkan", false); status.textContent = "Tekan Sinkronkan Database untuk membaca Spreadsheet."; } });
  });
})();
