(function () {
  const stores = ["contacts", "messages", "media", "settings", "unread"];
  const backupFormat = "callme-local-backup";
  const backupVersion = 2;

  function readBlob(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve({ __blob: true, type: blob.type, data: reader.result });
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function pack(value) {
    if (value instanceof Blob) return readBlob(value);
    if (Array.isArray(value)) return Promise.all(value.map(pack));
    if (!value || typeof value !== "object") return value;

    const output = {};
    for (const [key, item] of Object.entries(value))
      output[key] = await pack(item);
    return output;
  }

  async function unpack(value) {
    if (Array.isArray(value)) return Promise.all(value.map(unpack));
    if (value?.__blob) {
      const response = await fetch(value.data);
      const blob = await response.blob();
      return new Blob([blob], { type: value.type || blob.type });
    }
    if (!value || typeof value !== "object") return value;

    const entries = await Promise.all(
      Object.entries(value).map(async ([key, item]) => [
        key,
        await unpack(item),
      ]),
    );
    return Object.fromEntries(entries);
  }

  function readLocalStorage() {
    const values = {};
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (
        key?.startsWith("callme-profile-") ||
        key?.startsWith("callme-profile-cache:") ||
        key === "callme-v2-theme"
      ) {
        values[key] = localStorage.getItem(key);
      }
    }
    return values;
  }

  function createBackupFile(json) {
    const filename = `callme-backup-${new Date().toISOString().slice(0, 10)}.json`;
    const blob = new Blob([json], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  async function exportBackup() {
    const data = {
      format: backupFormat,
      version: backupVersion,
      createdAt: new Date().toISOString(),
      stores: {},
      localStorage: readLocalStorage(),
    };

    for (const store of stores) {
      data.stores[store] = await pack(await window.CallMeStorage.all(store));
    }

    const json = JSON.stringify(data);
    const filename = `callme-backup-${new Date().toISOString().slice(0, 10)}.json`;
    if (window.CallMeNative?.saveBackup) {
      if (!window.CallMeNative.saveBackup(filename, json)) {
        throw new Error("Gagal menyimpan ke Download/CallMe");
      }
      alert("Backup tersimpan di Download/CallMe/");
      return;
    }
    createBackupFile(json);
  }

  async function importBackup(file) {
    const data = JSON.parse(await file.text());
    if (
      data?.format !== backupFormat ||
      !data.stores ||
      ![1, backupVersion].includes(Number(data.version || 1))
    ) {
      throw new Error("Format backup CallMe tidak valid");
    }

    for (const store of stores) {
      const rows = await unpack(data.stores[store] || []);
      await window.CallMeStorage.replace(store, rows);
    }
    for (const [key, value] of Object.entries(data.localStorage || {})) {
      localStorage.setItem(key, value);
    }
    alert("Backup berhasil diimpor. Aplikasi akan dimuat ulang.");
    location.reload();
  }

  function mountBackupActions() {
    const panel = document.querySelector('[data-panel="settings"]');
    if (!panel) return;

    const box = document.createElement("div");
    box.className = "backup-actions";
    box.innerHTML =
      '<h2 class="backup-title">Backup Lokal</h2>' +
      '<button type="button" class="setting-action" data-export-backup>⬇️ Export Database</button>' +
      '<button type="button" class="setting-action" data-import-backup>⬆️ Import Database</button>' +
      '<input type="file" accept="application/json,.json" hidden data-import-file>';

    const themes = panel.querySelectorAll("[data-theme]");
    (themes[themes.length - 1] || panel.querySelector(".panel-content"))?.after(
      box,
    );

    const exportButton = box.querySelector("[data-export-backup]");
    const importButton = box.querySelector("[data-import-backup]");
    const fileInput = box.querySelector("[data-import-file]");
    exportButton.onclick = () =>
      exportBackup().catch((error) => alert(`Export gagal: ${error.message}`));
    importButton.onclick = () => fileInput.click();
    fileInput.onchange = () => {
      const file = fileInput.files[0];
      if (file) {
        importBackup(file).catch((error) =>
          alert(`Import gagal: ${error.message}`),
        );
      }
    };
  }

  document.addEventListener("DOMContentLoaded", mountBackupActions);
})();
