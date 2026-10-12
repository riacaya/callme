(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const list = document.getElementById("friend-list"),
      form = document.getElementById("friend-search"),
      query = document.getElementById("friend-query"),
      label = document.getElementById("active-user-label");
    if (!list || !form || !query) return;
    const updateUserLabel = () => {
      if (label)
        label.textContent =
          sessionStorage.getItem("callme-v2-session-user") || "";
    };
    updateUserLabel();
    window.addEventListener("callme:session-user", () => {
      updateUserLabel();
      void load(query.value.trim());
    });
    window.addEventListener("callme:peer-server-status", (event) => {
      const status = document.getElementById("p2p-status");
      if (status) status.textContent = event.detail?.status === "online" ? "P2P ready" : "Mencari...";
    });
    window.addEventListener("callme:profile-updated", () =>
      load(query.value.trim()),
    );
    window.addEventListener("callme:contacts-updated", () =>
      load(query.value.trim()),
    );
    window.addEventListener("callme:local-profiles-synced", () =>
      load(query.value.trim()),
    );
    let previousPanel = "";
    window.addEventListener("callme:panel-change", (event) => {
      if (event.detail?.panel === "friends") {
        if (previousPanel === "chatroom") scanFinished = false;
        updateUserLabel();
        void load(query.value.trim());
      }
      previousPanel = event.detail?.panel || previousPanel;
    });
    let scanning = false;
    let scanFinished = false;
    let loadSequence = 0;
    // Sinkronisasi server daftar teman cukup sekali per menit; sisanya pakai
    // cache lokal agar kembali dari chatroom tidak menyalakan request baru.
    const SERVER_SYNC_TTL_MS = 60000;
    let lastServerSync = 0;
    const roomPeers = new Set();
    const presenceSnapshot = new Map();
    const normalizePeer = (value) =>
      window.CallMeIdentity?.withoutPeerPrefix?.(value) ||
      window.CallMeApp?.normalize?.(value) ||
      String(value || "")
        .replace(/^cm-/i, "")
        .toLowerCase();
    const findFriendItem = (peer) =>
      [...list.children].find((node) => node.dataset.peerId === peer);
    const setPresence = (peer, text) => {
      if (peer) presenceSnapshot.set(normalizePeer(peer), text);
      const item = findFriendItem(peer);
      const status = item?.querySelector(".friend-status");
      if (status) {
        status.textContent = text;
        status.classList.toggle("is-online", /^Online\b/i.test(text));
      }
    };
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    async function pingFriend(row) {
      const peer = row.peerId;
      const active = window.CallMeChat?.activePeer?.();
      if (
        !peer ||
        (active &&
          window.CallMeApp?.normalize?.(active) ===
            window.CallMeApp?.normalize?.(peer))
      )
        return false;
      const item = findFriendItem(peer);
      const status = item?.querySelector(".friend-status");
      if (status) {
        status.textContent = "Memeriksa...";
        status.classList.remove("is-online");
      }
      const readyUntil = Date.now() + 8000;
      while (!window.CallMeP2P?.isPeerReady?.() && Date.now() < readyUntil)
        await wait(250);
      if (!window.CallMeP2P?.isPeerReady?.()) {
        if (status) {
          status.textContent = "Offline";
          status.classList.remove("is-online");
        }
        return false;
      }
      const identity = normalizePeer(peer);
      const result = await new Promise((resolve) => {
        let done = false;
        const finish = (online) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          window.removeEventListener("callme:p2p-status", onStatus);
          resolve(online);
        };
        const onStatus = (event) => {
          const id = normalizePeer(event.detail?.peerId);
          if (id !== identity) return;
          if (event.detail?.status === "online") finish(true);
          if (event.detail?.status === "offline") finish(false);
        };
        const timer = setTimeout(() => finish(false), 6000);
        window.addEventListener("callme:p2p-status", onStatus);
        // Mode standby tetap membuka koneksi presence agar status online
        // terdeteksi dan perangkat siap menerima pesan atau panggilan.
        window.CallMeP2P?.connect?.(peer, true);
      });
      if (status) {
        status.textContent = result
          ? `Online · terakhir dicek ${new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`
          : "Offline";
        status.classList.toggle("is-online", result);
      }
      if (result) {
        presenceSnapshot.set(normalizePeer(peer), status?.textContent || "Online");
      } else {
        presenceSnapshot.delete(normalizePeer(peer));
      }
      // Scan hanya mengambil snapshot. Koneksi outbound ditutup kembali agar
      // standby tetap ringan; pembukaan chatroom akan membuat koneksi baru.
      if (!active && result) window.CallMeP2P?.disconnect?.(peer);
      await wait(1000);
      return result;
    }
    async function scanPresence() {
      if (scanning || scanFinished || window.CallMeApp?.current?.() !== "friends") return;
      scanning = true;
      try {
        const rows = (await window.CallMeStorage?.all?.("contacts")) || [];
        for (const row of rows) {
          if (window.CallMeApp?.current?.() !== "friends") break;
          await pingFriend(row);
        }
      } finally {
        scanning = false;
        scanFinished = true;
      }
    }
    async function load(filter = "", cacheOnly = false, nested = false) {
      const sequence = nested ? loadSequence : ++loadSequence;
      const contacts = (await window.CallMeStorage?.all?.("contacts")) || [];
      const deleted = new Set((await window.CallMeStorage?.all?.("settings") || [])
        .filter((row) => String(row.key || "").startsWith("deleted-contact:"))
        .map((row) => normalizePeer(String(row.key).slice("deleted-contact:".length))));
      let rows = contacts.filter((row) => !deleted.has(normalizePeer(row.peerId)));
      if (!cacheOnly) {
        // Render dari cache lebih dulu supaya daftar tampil seketika.
        await load(filter, true, true);
        // Satu request contacts-list untuk semua teman (dulu: satu request per
        // teman), dan jangan ulangi bila baru saja disinkronkan.
        if (Date.now() - lastServerSync >= SERVER_SYNC_TTL_MS) {
          // Klaim jendela sinkronisasi SEBELUM fetch: load() bisa dipanggil
          // bersamaan (init + perubahan panel) dan tidak boleh mengulang request.
          lastServerSync = Date.now();
          const api = "https://script.google.com/macros/s/AKfycby-8P8p94mCSoZGPRECwjKw7wPR2de6R1zPQRJoWDHBQ4FVBERV7RZdRtCv1Laps5LZ/exec";
          const requester = sessionStorage.getItem("callme-v2-session-user") || "";
          const token = sessionStorage.getItem("callme-v2-session-token") || "";
          let fresh = rows;
          try {
            const response = await fetch(api, {
              method: "POST",
              headers: { "Content-Type": "text/plain;charset=utf-8" },
              body: JSON.stringify({ action: "contacts-list", requester, token }),
            });
            const result = await response.json();
            if (!result.ok || !Array.isArray(result.users))
              throw new Error(result.error || "contacts-list gagal");
            const byId = new Map(
              result.users.map((user) => [normalizePeer(user.username), user]),
            );
            fresh = await Promise.all(
              rows.map(
                (row) =>
                  window.CallMeProfileRepository?.merge?.(
                    row.peerId,
                    byId.get(normalizePeer(row.peerId)),
                  ) || row,
              ),
            );
          } catch (error) {
            // Fallback: sinkron per teman bila contacts-list tidak tersedia.
            console.warn("Sinkronisasi daftar teman dari server gagal", error);
            fresh = await Promise.all(rows.map(async (row) => {
              try {
                const target = window.CallMeApp?.normalize?.(String(row.peerId).replace(/^cm-/i, "")) || row.peerId;
                return await window.CallMeProfileRepository?.syncContact?.(target, requester, token) || row;
              } catch (err) { console.warn("Profil teman gagal disinkronkan", row.peerId, err); return row; }
            }));
          }
          rows = fresh;
        }
      }
      if (!nested && sequence !== loadSequence) return;
      const unreadRows = (await window.CallMeStorage?.all?.("unread")) || [],
        unread = Object.fromEntries(
          unreadRows.map((row) => [row.peerId, row.count]),
        ),
        q = filter.toLowerCase();
      list.replaceChildren(
        ...rows
          .filter((r) =>
            `${r.display_name || ""} ${r.phone || ""} ${r.peerId || ""}`
              .toLowerCase()
              .includes(q),
          )
          .map((r) => {
            const item = document.createElement("div");
            item.className = "friend-item";
            item.dataset.peerId = r.peerId;
            const img = document.createElement("img");
            img.className = "friend-avatar";
            img.src = r.profile_photo || window.CallMeChatUtils.defaultAvatar;
            const info = document.createElement("div");
            info.className = "friend-info";
            const name = document.createElement("button");
            name.type = "button";
            name.textContent = r.display_name || r.phone || r.peerId;
            name.onclick = () => {
              window.CallMeChat?.open(r);
            };
            const st = document.createElement("small");
            st.className = "friend-status";
            st.textContent = presenceSnapshot.get(normalizePeer(r.peerId)) || "Offline";
            st.classList.toggle("is-online", /^Online\b/i.test(st.textContent));
            info.append(name, st);
            const badge = document.createElement("b");
            badge.className = "friend-unread";
            badge.textContent =
              unread[r.peerId] ||
              unread[
                window.CallMeApp?.normalize?.(
                  String(r.peerId).replace(/^cm-/, ""),
                )
              ] ||
              "";
            const del = document.createElement("button");
            del.className = "friend-remove";
            del.hidden = false;
            del.style.display = "grid";
            del.style.placeItems = "center";
            del.style.gridColumn = "4";
            del.style.gridRow = "1";
            item.style.gridTemplateColumns = "42px minmax(0, 1fr) auto auto";
            del.textContent = "✕";
            del.onclick = async () => {
              if (!confirm(`Hapus ${r.display_name || r.phone || r.peerId} dari daftar teman?`)) return;
              const target = normalizePeer(r.peerId);
              const contacts = (await window.CallMeStorage?.all?.("contacts")) || [];
              await window.CallMeStorage?.put?.("settings", { key: `deleted-contact:${target}`, value: true, updatedAt: Date.now() });
              await Promise.all(contacts.filter((contact) => normalizePeer(contact.peerId) === target).map((contact) => window.CallMeStorage.remove("contacts", contact.peerId)));
              localStorage.removeItem(`callme-profile-cache:${target}`);
              roomPeers.delete(target);
              window.CallMeP2P?.disconnect?.(r.peerId);
              await load(query.value.trim(), true);
            };
            item.append(img, info, badge, del);
            return item;
          }),
      );
      if (!filter) scanPresence();
    }
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const value = query.value.trim();
      const rows = (await window.CallMeStorage?.all?.("contacts")) || [];
      const needle = (window.CallMeApp?.normalize?.(value) || value)
        .replace(/^cm-/i, "")
        .toLowerCase();
      const found = rows.some((row) =>
        `${row.display_name || ""} ${row.phone || ""} ${row.peerId || ""}`
          .toLowerCase()
          .includes(value.toLowerCase()),
      );
      if (!found && needle && window.CallMeApp?.isAllowedIdentity?.(needle)) {
        await window.CallMeStorage.put("contacts", {
          peerId: needle,
          phone: needle,
          display_name: needle,
          profile_photo: "",
          email: "",
          savedAt: Date.now(),
        });
        await window.CallMeStorage.remove("settings", `deleted-contact:${needle}`);
        scanFinished = false;
        query.value = "";
        await load("");
        return;
      }
      load(value);
    });
    query.addEventListener("input", () => load(query.value.trim(), true));
    window.addEventListener("callme:p2p-message", async (event) => {
      const d = event.detail || {};
      if (d.kind === "room-active" && d.senderPeerId) {
        const peer = normalizePeer(d.senderPeerId);
        roomPeers.add(peer);
        setPresence(peer, "Online");
        return;
      }
      if (d.kind === "room-idle" && d.senderPeerId) {
        const peer = normalizePeer(d.senderPeerId);
        roomPeers.delete(peer);
        setPresence(peer, "Online");
        return;
      }
      // Deteksi isi vs kode (whitelist CallMeChatUtils.isContentKind): kode
      // kendali (presence/ack/file) dan kode rangkaian panggilan (call-hangup,
      // call-declined) bukan
      // pesan — tanpa penyaringan ini semuanya jatuh ke blok `d.roomId` di
      // bawah dan menjadi bubble chat kosong + unread palsu di daftar teman.
      if (!window.CallMeChatUtils?.isContentKind?.(d.kind)) return;
      if (!d.senderPeerId || window.CallMeApp?.current?.() === "chatroom")
        return;
      const key =
        window.CallMeApp?.normalize?.(
          String(d.senderPeerId).replace(/^cm-/, ""),
        ) || String(d.senderPeerId).replace(/^cm-/, "");
      // Pesan pertama dari peer yang belum pernah disimpan harus membuat
      // kontak lokal agar room baru langsung tampil saat standby.
      if (d.roomId) {
        const peerId = normalizePeer(d.senderPeerId);
        const contacts = (await window.CallMeStorage?.all?.("contacts")) || [];
        const known = contacts.some((contact) => normalizePeer(contact.peerId) === peerId);
        if (!known) {
          await window.CallMeStorage?.put?.("contacts", {
            peerId,
            phone: peerId,
            display_name: d.senderName || d.display_name || peerId,
            profile_photo: d.profile_photo || "",
            email: d.email || "",
            savedAt: Date.now(),
          });
          await window.CallMeStorage?.remove?.("settings", `deleted-contact:${peerId}`);
        }
      }
      if (d.roomId) {
        const row = {
          ...d,
          id: d.id || window.CallMeApp.uid(),
          mine: false,
          createdAt: d.createdAt || Date.now(),
        };
        const saved = (await window.CallMeStorage?.all?.("messages")) || [];
        const existing = saved.find((item) => item.id === row.id);
        if (existing && d.kind === "call-log") {
          // Incoming call handler can save the call log before this event
          // reaches the standby/friends listener. Update the existing row,
          // but count the first arrival once so unread is not lost.
          const countUnread = !existing.unreadCounted;
          await window.CallMeStorage?.put?.("messages", {
            ...existing,
            ...row,
            mine: existing.mine,
            unreadCounted: true,
          });
          load(query.value.trim());
          if (!countUnread) return;
        }
        if (existing && d.kind !== "call-log") return;
        if (!existing) {
          row.unreadCounted = true;
          await window.CallMeStorage?.put?.("messages", row);
        }
      }
      const unreadRows = (await window.CallMeStorage?.all?.("unread")) || [],
        unread = Object.fromEntries(
          unreadRows.map((row) => [row.peerId, row.count]),
        );
      unread[key] = (Number(unread[key]) || 0) + 1;
      window.CallMeStorage?.put?.("unread", {
        peerId: key,
        count: unread[key],
        updatedAt: Date.now(),
      });
      load(query.value.trim());
      setTimeout(() => {
        if (
          window.CallMeApp?.current?.() === "friends" &&
          !roomPeers.has(String(key).toLowerCase())
        )
          window.CallMeP2P?.disconnect?.(key);
      }, 3000);
    });
    load();
    window.CallMeFriends = { load };
  });
})();
