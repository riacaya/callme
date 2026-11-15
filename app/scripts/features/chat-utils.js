(function (root) {
  "use strict";

  const defaultAvatar =
    "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA0MiA0MiI+PGRlZnM+PGxpbmVhckdyYWRpZW50IGlkPSJnIiB4MT0iMCIgeTE9IjAiIHgyPSIxIiB5Mj0iMSI+PHN0b3Agc3RvcC1jb2xvcj0iI0I5OUJGRiIvPjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzc2NTZDNSIvPjwvbGluZWFyR3JhZGllbnQ+PC9kZWZzPjxjaXJjbGUgY3g9IjIxIiBjeT0iMjEiIHI9IjE5IiBmaWxsPSIjMjkyNDNEIiBzdHJva2U9IiNCOTlCRkYiLz48cGF0aCBkPSJNMTIgMTVjMC0yIDItNCA0LTRoMTBjMiAwIDQgMiA0IDR2N2MwIDItMiA0LTQgNGgtM2wtNSA0di00aC0yYy0yIDAtNC0yLTQtNHoiIGZpbGw9InVybCgjZykiLz48cGF0aCBkPSJNMTcgMThoOE0xNyAyMmg1IiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjEuOCIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+PGNpcmNsZSBjeD0iMzEiIGN5PSIxMSIgcj0iMi41IiBmaWxsPSIjRTc4QjY4Ii8+PC9zdmc+";

  const normalizePeer = (value) =>
    root.CallMeIdentity?.withoutPeerPrefix?.(value) ||
    root.CallMeApp?.normalize?.(value) ||
    String(value || "")
      .replace(/^cm-/i, "")
      .toLowerCase();

  const formatFileSize = (row) => {
    const source = String(row.source || row.audio || "");
    const comma = source.indexOf(",");
    const bytes =
      Number(row.size) ||
      (comma >= 0
        ? Math.max(0, Math.floor((source.length - comma - 1) * 0.75))
        : 0);
    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return bytes
      ? `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`
      : "";
  };

  const shortFileName = (name) => {
    const value = String(name || "file");
    return value.length > 28 ? `${value.slice(0, 24)}....` : value;
  };

  const roomKey = (peer) => {
    const self = normalizePeer(
      sessionStorage.getItem("callme-v2-session-user") ||
        localStorage.getItem("callme-v2-user") ||
        "",
    );
    return [self, normalizePeer(peer)].sort().join("::");
  };

  // Data URL dengan parameter berisi koma (video/webm;codecs=vp8,opus) membuat
  // koma pemisah header/payload terbaca terlalu awal. Akibatnya payload dibaca
  // sebagai teks "opus;base64,...", video gagal diputar (MEDIA_ERR 4) dan file
  // unduhan ikut rusak. Buang parameter codec, simpan tipe dasarnya saja.
  const normalizeDataUrl = (value) => {
    if (typeof value !== "string" || !value.startsWith("data:")) return value;
    const marker = ";base64,";
    const at = value.lastIndexOf(marker);
    if (at < 0) return value;
    const type = value.slice(5, at).split(";")[0].trim().toLowerCase();
    return `data:${type || "application/octet-stream"}${marker}${value.slice(at + marker.length)}`;
  };

  // ---- Klasifikasi paket: ISI vs KODE ----
  // "Isi" = baris yang boleh disimpan ke IndexedDB, dirender sebagai bubble,
  // dihitung unread, dan dinotifikasi. "Kode" = segala kendali (presence,
  // ack, file-chunk, call-hangup/call-declined).
  // WHITELIST, bukan blacklist: kode kendali baru otomatis dianggap bukan
  // pesan, sehingga tidak pernah lagi menjadi bubble chat kosong atau
  // notifikasi palsu. (Akar bug 46 bubble kosong di chatroom pemanggil:
  // paket kendali panggilan punya roomId lalu disimpan friends.js.)
  const CONTENT_KINDS = new Set(["text", "media", "audio", "file", "call-log"]);
  const isContentKind = (kind) => CONTENT_KINDS.has(String(kind || ""));

  root.CallMeChatUtils = Object.freeze({
    normalizePeer,
    formatFileSize,
    shortFileName,
    roomKey,
    normalizeDataUrl,
    isContentKind,
    defaultAvatar,
  });
})(window);
