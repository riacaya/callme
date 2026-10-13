(function () {
  const API = "https://script.google.com/macros/s/AKfycby-8P8p94mCSoZGPRECwjKw7wPR2de6R1zPQRJoWDHBQ4FVBERV7RZdRtCv1Laps5LZ/exec";
  const key = (id) => String(id || "").replace(/^cm-/i, "").toLowerCase();
  const cacheKey = (id) => `callme-profile-cache:${key(id)}`;
  // Profil tidak berubah tiap detik. Cache 5 menit mencegah panel friends dan
  // pencarian menyalakan request Apps Script (±2 detik) berulang kali.
  const PROFILE_TTL_MS = 5 * 60 * 1000;
  const read = (id) => { try { return JSON.parse(localStorage.getItem(cacheKey(id)) || "null"); } catch { return null; } };
  const write = (id, data) => { if (data) localStorage.setItem(cacheKey(id), JSON.stringify({ ...data, cachedAt: Date.now() })); return data; };
  async function get(username, requester, token) {
    const target = window.CallMeApp?.normalize?.(key(username)) || key(username);
    const cached = read(target);
    if (cached && Date.now() - (cached.cachedAt || 0) < PROFILE_TTL_MS) return cached;
    try {
      const response = await Promise.race([fetch(API, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "profile-get", username: target, requester: requester || target, token: token || "" }) }), new Promise((_, reject) => setTimeout(() => reject(new Error("profile timeout")), 30000))]);
      const result = await response.json();
      if (result.ok && result.user) return write(target, result.user);
    } catch (error) { console.warn("Profile refresh gagal", target, error); }
    return cached;
  }
  // Gabung hasil server ke database lokal tanpa request. Dipakai syncContact
  // (satu profil) dan jalur contacts-list (banyak profil sekaligus).
  async function merge(peerId, user) {
    const identity = key(peerId);
    const contacts = (await window.CallMeStorage?.all?.("contacts")) || [];
    const current = contacts.find((row) => key(row.peerId) === identity) || { peerId: identity };
    if (!user) return current;
    const updated = {
      ...current,
      ...user,
      peerId: current.peerId || identity,
      display_name: user.display_name || current.display_name || identity,
      phone: user.phone || current.phone || identity,
      profile_photo: user.photo_url || user.profile_photo || current.profile_photo || "",
    };
    await window.CallMeStorage?.put?.("contacts", updated);
    return updated;
  }
  async function syncContact(peerId, requester, token) {
    const user = await get(key(peerId), requester, token);
    return merge(peerId, user);
  }
  async function syncAll(requester, token) {
    const user = key(requester);
    const own = await get(user, requester, token);
    if (own) {
      localStorage.setItem(`callme-profile-${user}`, JSON.stringify(own));
      await window.CallMeStorage?.put?.("settings", {
        key: `profile:${user}`,
        value: own,
        updatedAt: Date.now(),
      });
    }
    const contacts = (await window.CallMeStorage?.all?.("contacts")) || [];
    const known = new Map(contacts.map((contact) => [key(contact.peerId), contact]));
    // Database lokal hanya berisi teman yang ditambahkan user. Jangan mengisi
    // cache dengan seluruh user Spreadsheet; hanya sinkronkan kontak yang dipilih.
    const results = await Promise.all([...known.values()].map((contact) => syncContact(contact.peerId, requester, token)));
    window.dispatchEvent(new CustomEvent("callme:local-profiles-synced", {
      detail: { username: user, own, contacts: results.filter(Boolean) },
    }));
    return { own, contacts: results };
  }
  window.CallMeProfileRepository = Object.freeze({ get, syncContact, syncAll, merge, read, write, key });
})();
