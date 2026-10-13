(function () {
  const encoder = new TextEncoder();
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let bit = 0; bit < 8; bit += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function write16(view, offset, value) { view.setUint16(offset, value, true); }
  function write32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

  function zip(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = file.data instanceof Uint8Array ? file.data : encoder.encode(String(file.data));
      const crc = crc32(data);
      const local = new Uint8Array(30 + name.length);
      const lv = new DataView(local.buffer);
      write32(lv, 0, 0x04034b50); write16(lv, 4, 20); write16(lv, 6, 0x0800);
      write16(lv, 8, 0); write16(lv, 10, dosTime); write16(lv, 12, dosDate);
      write32(lv, 14, crc); write32(lv, 18, data.length); write32(lv, 22, data.length);
      write16(lv, 26, name.length); write16(lv, 28, 0); local.set(name, 30);
      localParts.push(local, data);

      const central = new Uint8Array(46 + name.length);
      const cv = new DataView(central.buffer);
      write32(cv, 0, 0x02014b50); write16(cv, 4, 20); write16(cv, 6, 20);
      write16(cv, 8, 0x0800); write16(cv, 10, 0); write16(cv, 12, dosTime); write16(cv, 14, dosDate);
      write32(cv, 16, crc); write32(cv, 20, data.length); write32(cv, 24, data.length);
      write16(cv, 28, name.length); write16(cv, 30, 0); write16(cv, 32, 0);
      write16(cv, 34, 0); write16(cv, 36, 0); write32(cv, 38, 0); write32(cv, 42, offset);
      central.set(name, 46); centralParts.push(central);
      offset += local.length + data.length;
    }

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    write32(ev, 0, 0x06054b50); write16(ev, 4, 0); write16(ev, 6, 0);
    write16(ev, 8, files.length); write16(ev, 10, files.length);
    write32(ev, 12, centralSize); write32(ev, 16, offset); write16(ev, 20, 0);
    return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
  }

  function safeName(value) {
    return String(value || "lampiran").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 120) || "lampiran";
  }

  async function sourceBytes(source) {
    if (typeof source !== "string" || !source) return null;
    try {
      const response = await fetch(source);
      return new Uint8Array(await response.arrayBuffer());
    } catch { return null; }
  }

  document.addEventListener("DOMContentLoaded", () => {
    const button = document.getElementById("export-chat-button");
    const status = document.getElementById("export-chat-status");
    if (!button || !status) return;
    button.addEventListener("click", async () => {
      button.disabled = true;
      status.textContent = "Menyiapkan arsip chat lokal…";
      try {
        const rows = (await window.CallMeStorage?.all?.("messages")) || [];
        const files = [];
        const exported = [];
        let mediaCount = 0;
        for (const row of rows) {
          const item = { ...row };
          const source = item.source || item.audio || "";
          delete item.source;
          delete item.audio;
          if (["media", "audio", "file"].includes(row.kind)) {
            const bytes = await sourceBytes(source);
            if (bytes) {
              const extension = safeName(row.name || "lampiran").match(/\.[a-z0-9]{1,8}$/i)?.[0] || "";
              const path = `media/${String(row.createdAt || 0)}-${safeName(row.id || mediaCount)}-${mediaCount}${extension}`;
              files.push({ name: path, data: bytes });
              item.exportedMedia = path;
              mediaCount += 1;
            } else item.exportedMedia = null;
          }
          exported.push(item);
        }
        files.unshift({
          name: "messages.json",
          data: JSON.stringify({ format: "CallMe chat export v1", exportedAt: new Date().toISOString(), messageCount: exported.length, mediaCount, messages: exported }, null, 2),
        });
        files.unshift({
          name: "README.txt",
          data: "Arsip ekspor chat CallMe. Pesan diambil dari penyimpanan lokal perangkat ini. Lampiran yang masih tersedia ikut disimpan di folder media/. Berkas tidak dikirim melalui P2P atau notifikasi saat ekspor.\r\n",
        });
        const blob = zip(files);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `CallMe-chat-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
        document.body.append(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        status.textContent = `${exported.length} pesan dan ${mediaCount} file media diekspor.`;
      } catch (error) {
        console.error("Ekspor chat gagal", error);
        status.textContent = "Ekspor gagal. Periksa ruang penyimpanan perangkat lalu coba lagi.";
      } finally {
        button.disabled = false;
      }
    });
  });
})();
