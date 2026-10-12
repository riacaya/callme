(function () {
  document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("chat-compose"),
      input = document.getElementById("chat-text"),
      submit = document.getElementById("chat-submit"),
      messages = document.getElementById("chat-messages"),
      title = document.getElementById("chat-title");
    if (!form || !input || !submit || !messages || !title) return;
    messages.style.paddingInline = "2px";
    const chatUtils = window.CallMeChatUtils;
    const normalizePeer = chatUtils.normalizePeer;
    const formatFileSize = chatUtils.formatFileSize;
    const roomKey = chatUtils.roomKey;
    const findTransferMeta = (id) =>
      id
        ? messages.querySelector(`[data-transfer-meta="${CSS.escape(id)}"]`)
        : null;
    const updateTransferProgress = (detail, label, amountKey) => {
      if (!detail?.total) return;
      const meta = findTransferMeta(detail.id) ||
        messages.querySelector(`[data-message-id="${CSS.escape(String(detail.id || ""))}"] .chat-meta`);
      if (!meta) return;
      const amount = Number(detail[amountKey]);
      if (!Number.isFinite(amount)) return;
      const percent = Math.max(0, Math.min(100, Math.round((amount / Number(detail.total)) * 100)));
      meta.replaceChildren(
        document.createTextNode(
          `${label} ${percent}% · ${meta.dataset.time || ""}`,
        ),
      );
    };
    let activeFriend = null,
      serverReady = false,
      recorder = null,
      recorded = [],
      connectionTimer = null,
      activeRoute = "";
    const avatar = document.createElement("img");
    avatar.id = "chat-avatar";
    avatar.className = "chat-avatar";
    avatar.src = window.CallMeChatUtils.defaultAvatar;
    avatar.alt = "";
    title.before(avatar);
    const updateAvatar = () => {
      if (activeFriend)
        avatar.src =
          activeFriend.profile_photo || window.CallMeChatUtils.defaultAvatar;
    };
    const shortFileName = chatUtils.shortFileName;
    window.addEventListener("callme:profile-updated", (event) => {
      const id = normalizePeer(event.detail?.peerId);
      if (activeFriend && normalizePeer(activeFriend.peerId) === id) {
        activeFriend = {
          ...activeFriend,
          ...event.detail.data,
          profile_photo:
            event.detail.data?.photo_url ||
            event.detail.data?.profile_photo ||
            activeFriend.profile_photo,
        };
        updateAvatar();
        title.textContent =
          activeFriend.display_name ||
          activeFriend.phone ||
          activeFriend.peerId ||
          "Chatroom";
      }
    });
    window.addEventListener("callme:file-transfer-error", (event) => {
      const detail = event.detail || {};
      if (detail.id) {
        void window.CallMeStorage?.all?.("messages").then(async (rows) => {
          const row = (rows || []).find((item) => item.id === detail.id);
          if (!row) return;
          row.deliveryStatus = "failed";
          await window.CallMeStorage?.put?.("messages", row);
          if (activeFriend?.peerId && row.roomId === roomKey(activeFriend.peerId)) {
            messages.querySelector(`[data-message-id="${CSS.escape(row.id)}"]`)?.remove();
            render(row);
          }
        });
      }
      document
        .getElementById("chat-activity-status")
        ?.replaceChildren(
          document.createTextNode(
            `Gagal mengirim ${shortFileName(detail.name)}: ${detail.error || "error"}${detail.message ? ` (${detail.message})` : ""}`,
          ),
        );
    });
    window.addEventListener("callme:file-receive-progress", (event) => {
      updateTransferProgress(event.detail, "Menerima", "received");
    });
    window.addEventListener("callme:file-transfer-progress", (event) => {
      updateTransferProgress(event.detail, "Mengirim", "sent");
    });
    window.addEventListener("callme:file-queued", (event) => {
      const name = event.detail?.name || "file";
      const mode = event.detail?.mode;
      const text =
        mode === "video-capture"
          ? "Menyiapkan video..."
          : `Menunggu antrean: ${shortFileName(name)}`;
      document
        .getElementById("chat-activity-status")
        ?.replaceChildren(document.createTextNode(text));
    });
    window.addEventListener("callme:file-transfer-paused", () => {
      document
        .getElementById("chat-activity-status")
        ?.replaceChildren(
          document.createTextNode(
            "Transfer dijeda sementara; menunggu aplikasi aktif...",
          ),
        );
    });
    window.addEventListener("callme:file-transfer-resumed", () => {
      document
        .getElementById("chat-activity-status")
        ?.replaceChildren(document.createTextNode("Transfer dilanjutkan..."));
    });
    window.addEventListener("callme:file-transfer-complete", (event) => {
      const transferId = event.detail?.id;
      const transferMeta = findTransferMeta(transferId);
      if (transferMeta) {
        transferMeta.classList.add("transfer-delivered");
        transferMeta.replaceChildren(
          document.createTextNode(`${transferMeta.dataset.time || ""}  ✓✓`),
        );
      }
      const peer = normalizePeer(event.detail?.peerId);
      const active = normalizePeer(activeFriend?.peerId);
      if (!peer || peer !== active) return;
      if (window.CallMeP2P?.isConnected?.(activeFriend.peerId)) {
        cancelConnectionRetry();
        const label = activeFriend.display_name || activeFriend.phone || active;
        setConnectionStatus(connectionStatus(label));
      } else {
        setConnectionStatus("Koneksi teman terputus, membangun ulang...");
        if (serverReady && isRoomActive()) maintainConnection();
      }
    });
    window.addEventListener("callme:p2p-reconnecting", () => {
      if (
        activeFriend?.peerId &&
        (window.CallMeP2P?.isConnected?.(activeFriend.peerId) ||
          window.CallMeP2P?.hasConnection?.(activeFriend.peerId))
      )
        return;
      setConnectionStatus("Membangun koneksi baru...");
    });
    window.addEventListener("callme:p2p-message", (event) => {
      if (!activeFriend?.peerId) return;
      const sender = normalizePeer(
        event.detail?.senderPeerId || event.detail?.peerId,
      );
      const friend = normalizePeer(activeFriend.peerId);
      if (sender && sender === friend) {
        const label = activeFriend.display_name || activeFriend.phone || friend;
        setConnectionStatus(connectionStatus(label));
      }
    });
    window.addEventListener("callme:p2p-route", (event) => {
      if (!activeFriend?.peerId || normalizePeer(event.detail?.peerId) !== normalizePeer(activeFriend.peerId)) return;
      const label = activeFriend.display_name || activeFriend.phone || normalizePeer(activeFriend.peerId);
      activeRoute = event.detail.route || "";
      setConnectionStatus(connectionStatus(label));
    });
    function closeRoom() {
      clearTimeout(connectionTimer);
      connectionTimer = null;
      activeRoute = "";
      if (activeFriend?.peerId) {
        window.CallMeP2P?.send?.(
          { kind: "room-idle", roomId: roomKey(activeFriend.peerId) },
          activeFriend.peerId,
        );
        activeRoute = "";
      }
    }
    window.addEventListener("callme:panel-change", (event) => {
      if (event.detail?.panel === "friends") closeRoom();
    });
    // Pesan teks dengan URL dibuat klik-able; klik membuka browser default
    // (pola window.open yang sama dengan lampiran media).
    const findFirstUrl = (text) => {
      const match = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/i.exec(text || "");
      if (!match) return "";
      return match[0].replace(/[.,;:!?\])}'"]+$/, "");
    };
    // Pratinjau lanskap URL pertama (thum.io, tanpa API key — bentuk URL
    // mengikuti contoh kerja frame.html). Gagal muat / gambar error thum.io
    // ("Image not authorized") → kotak preview berisi alamat domain utama,
    // sehingga pesan tetap punya kotak preview walau screenshot gagal.
    const makeLinkPreview = (url) => {
      const target = /^https?:/i.test(url) ? url : `https://${url}`;
      let host = url;
      try {
        host = new URL(target).hostname.replace(/^www\./i, "") +
          (new URL(target).port ? `:${new URL(target).port}` : "");
      } catch {}
      const fallbackBox = () => {
        const box = document.createElement("div");
        box.className = "chat-preview chat-preview-fallback";
        box.textContent = host;
        box.title = target;
        return box;
      };
      // Lokasi privat/lokal tidak bisa dijangkau server thum.io → langsung
      // kotak domain, tidak perlu menunggu percobaan gagal.
      if (/^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.)/i.test(host))
        return fallbackBox();
      const img = document.createElement("img");
      img.className = "chat-preview";
      img.loading = "lazy";
      img.alt = "Pratinjau tautan";
      // Harus sebelum src supaya canvas bisa membaca piksel (thum.io
      // mengirim header CORS) untuk mendeteksi gambar error.
      img.crossOrigin = "anonymous";
      let attempt = 0;
      const looksLikeErrorImage = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 32;
          canvas.height = 32;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, 32, 32);
          const data = ctx.getImageData(0, 0, 32, 32).data;
          const seen = new Set();
          for (let i = 0; i < data.length; i += 4)
            seen.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
          // Screenshot asli punya puluhan warna; gambar error thum.io
          // nyaris satu warna rata.
          return seen.size <= 6;
        } catch {
          return false;
        }
      };
      const showFallback = () => img.replaceWith(fallbackBox());
      const retryOrFail = () => {
        if (++attempt >= 3) {
          showFallback();
          return;
        }
        setTimeout(load, 3000);
      };
      const load = () => {
        const bust = attempt
          ? `${target.includes("?") ? "&" : "?"}retry=${Date.now()}`
          : "";
        img.src = `https://image.thum.io/get/width/1200/${target}${bust}`;
      };
      img.addEventListener("load", () => {
        if (looksLikeErrorImage()) retryOrFail();
      });
      img.addEventListener("error", retryOrFail);
      load();
      return img;
    };
    const appendLinkified = (parent, text) => {
      const re = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;
      let last = 0;
      let match;
      while ((match = re.exec(text))) {
        if (match.index > last)
          parent.append(document.createTextNode(text.slice(last, match.index)));
        const url = match[0].replace(/[.,;:!?\])}'"]+$/, "");
        const href = /^https?:/i.test(url) ? url : `https://${url}`;
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.rel = "noopener";
        anchor.textContent = url;
        anchor.addEventListener("click", (event) => {
          event.preventDefault();
          window.open(href, "_blank", "noopener");
        });
        parent.append(anchor);
        last = match.index + url.length;
      }
      if (last < text.length)
        parent.append(document.createTextNode(text.slice(last)));
    };
    // Nada ketukan pendek di chatroom: terkirim (lebih tinggi) & diterima
    // (lebih rendah). WebAudio tanpa berkas aset — satu ketukan ±0,12 detik;
    // senyap bila konteks audio diblokir sistem (tanpa gestur), pesan tetap
    // tampil normal.
    let toneCtx = null;
    function tone(mine) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        if (!toneCtx) toneCtx = new AC();
        if (toneCtx.state === "suspended") void toneCtx.resume();
        const at = toneCtx.currentTime;
        const osc = toneCtx.createOscillator();
        const gain = toneCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(mine ? 988 : 660, at);
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.12, at + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.12);
        osc.connect(gain);
        gain.connect(toneCtx.destination);
        osc.start(at);
        osc.stop(at + 0.13);
      } catch (error) {}
    }
    function render(row) {
      // Satu pesan hanya boleh punya satu bubble. Kirim ganda (ketukan/Enter
      // beruntun) atau pemuatan room yang beriringan tidak boleh menggandakan
      // baris yang sama — semua jalur render melewati pemeriksaan ini.
      if (
        row?.id &&
        messages.querySelector(`[data-message-id="${CSS.escape(row.id)}"]`)
      )
        return;
      const item = document.createElement("div");
      item.dataset.messageId = row.id;
      item.dataset.createdAt = String(row.createdAt || Date.now());
      item.className = `chat-item ${row.mine ? "chat-item-mine" : ""}`;
      if (row.kind === "call-log") {
        item.classList.add("chat-item-media", "call-log-item");
        item.style.width = "60%";
        item.style.maxWidth = "60%";
        item.style.minWidth = "0";
        if (!document.getElementById("call-log-style")) {
          const style = document.createElement("style");
          style.id = "call-log-style";
          style.textContent = ".call-log-bubble::after{color:#fff!important;text-shadow:0 1px 3px #000}";
          document.head.append(style);
        }
        const bubble = document.createElement("div");
        bubble.className = `chat-bubble call-log-bubble call-log-${row.status || "started"}`;
        bubble.style.display = "flex";
        bubble.style.alignItems = "center";
        bubble.style.gap = "10px";
        bubble.style.background = "var(--head)";
        bubble.style.color = "#fff";
        const statusText = row.status === "accepted" ? " diterima" : row.status === "rejected" ? " ditolak" : row.status === "missed" ? " tak terjawab" : "";
        const iconCircle = document.createElement("span");
        iconCircle.style.cssText = "display:grid;place-items:center;flex:0 0 40px;width:40px;height:40px;border-radius:50%;background:#fff";
        const icon = document.createElement("span");
        icon.setAttribute("aria-hidden", "true");
        icon.style.cssText = "display:grid;place-items:center;width:22px;height:22px;color:#64748b;font-size:22px;line-height:1";
        icon.textContent = row.callType === "video" ? "▣" : "☎";
        iconCircle.append(icon);
        const label = document.createElement("span");
        label.style.cssText = "display:flex;flex-direction:column;line-height:1.25;min-width:0";
        const direction = document.createElement("strong");
        direction.textContent = row.mine ? "Keluar" : "Masuk";
        direction.style.fontSize = "13px";
        const status = document.createElement("small");
        status.textContent = statusText.trim() || "Memanggil";
        status.style.cssText = "font-size:11px;opacity:.85";
        label.append(direction, status);
        bubble.append(iconCircle, label);
        item.append(bubble);
      } else if (row.kind === "audio" || row.kind === "media" || row.kind === "file") {
        item.classList.add("chat-item-media");
        const isAudio = row.mime?.startsWith("audio/") || row.kind === "audio";
        const title = document.createElement("div");
        title.className = "chat-media-title";
        title.textContent = isAudio ? "Pesan suara" : row.name || "File";
        const fileInfo = document.createElement("small");
        fileInfo.className = "chat-file-info";
        const sizeText = formatFileSize(row);
        const typeText = row.mime
          ? row.mime.split("/").pop().toUpperCase()
          : "FILE";
        fileInfo.textContent = [sizeText, typeText].filter(Boolean).join(" ");
        item.append(title);
        if (
          !isAudio &&
          !row.mime?.startsWith("image/") &&
          !row.mime?.startsWith("video/")
        )
          item.append(fileInfo);
        const media = isAudio
          ? document.createElement("audio")
          : document.createElement(
              row.mime?.startsWith("video/")
                ? "video"
                : row.mime?.startsWith("image/")
                  ? "img"
                  : "a",
            );
        media.className = "chat-media";
        // Gunakan DataURL langsung seperti Blogspot. Mengubah video besar
        // menjadi binary string + Uint8Array + Blob membuat WebView boros RAM.
        const mediaSource = row.source || row.audio,
          mediaUrl =
            mediaSource instanceof Blob
              ? URL.createObjectURL(mediaSource)
              : window.CallMeChatUtils?.normalizeDataUrl?.(mediaSource) ||
                mediaSource;
        media.src = mediaUrl;
        if (media.tagName === "IMG" || media.tagName === "VIDEO") {
          media.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            item.classList.toggle("media-expanded");
          });
        }
        if (!row.mine && mediaUrl && media.tagName === "A") {
          media.addEventListener("click", (event) => {
            event.preventDefault();
            window.open(mediaUrl, "_blank", "noopener");
          });
        }
        media.addEventListener(
          "error",
          () => {
            if (media.tagName !== "IMG" && media.tagName !== "VIDEO") return;
            const link = document.createElement("a");
            const fallbackSource = row.source || row.audio || "#";
            link.href =
              fallbackSource instanceof Blob
                ? URL.createObjectURL(fallbackSource)
                : window.CallMeChatUtils?.normalizeDataUrl?.(
                      fallbackSource,
                    ) || fallbackSource;
            link.download = row.name || "media";
            link.textContent = `Media diterima, tetapi format tidak dapat diputar. Unduh ${row.name || "file"}`;
            media.replaceWith(link);
          },
          { once: true },
        );
        if (media.tagName === "A") {
          media.href = media.src;
          media.download = row.name || "File";
          media.textContent = (
            row.name?.split(".").pop() || "FILE"
          ).toUpperCase();
        } else if (media.tagName === "VIDEO" || media.tagName === "AUDIO")
          media.controls = true;
        item.append(media);
        const more = document.createElement("button");
        more.className = "chat-item-more";
        more.textContent = "⋮";
        more.type = "button";
        if (row.kind === "call-log") {
          more.style.color = "#fff";
          more.style.textShadow = "0 1px 3px #000";
        }
        more.onclick = (event) => {
          event.stopPropagation();
          item.querySelector(".chat-item-menu").hidden =
            !item.querySelector(".chat-item-menu").hidden;
        };
        const menu = document.createElement("div");
        menu.className = "chat-item-menu";
        menu.hidden = true;
        menu.innerHTML =
          '<button type="button" data-action="save">Save to memory</button><button type="button" data-action="delete">Hapus</button><button type="button" data-action="delete-all">Hapus dari semua</button>';
        menu.onclick = async (event) => {
          const action = event.target.dataset.action;
          if (!action) return;
          if (action === "save") {
            const link = document.createElement("a");
            link.href = media.src;
            link.download = row.name || "callme-file";
            link.rel = "noopener";
            link.click();
          } else {
            await window.CallMeStorage?.remove?.("messages", row.id);
            item.remove();
            if (action === "delete-all")
              window.CallMeP2P?.send({
                kind: "delete-message",
                id: row.id,
                roomId: row.roomId,
              });
          }
        };
        item.append(more, menu);
      } else {
        const bubble = document.createElement("div");
        bubble.className = "chat-bubble";
        // Preview URL pertama tampil di atas teks (gaya kartu),
        // sisa URL tetap tautan kecil di badan pesan.
        const firstUrl = findFirstUrl(row.text);
        if (firstUrl) bubble.append(makeLinkPreview(firstUrl));
        appendLinkified(bubble, row.text || "");
        item.append(bubble);
      }
      const meta = document.createElement("small");
      meta.className = "chat-meta";
      meta.dataset.transferMeta = row.id;
      meta.dataset.time = new Date(
        row.createdAt || Date.now(),
      ).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
      meta.textContent = new Date(
        row.createdAt || Date.now(),
      ).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
      if (row.mine) {
        const check = document.createElement("span");
        check.className = "delivery-checks-blue";
        check.textContent = row.deliveryStatus === "sending" ? "  ⏳" : row.deliveryStatus === "failed" ? "  ⚠" : "  ✓✓";
        meta.append(check);
      }
      const time = new Date(row.createdAt || Date.now()).toLocaleTimeString(
        "id-ID",
        { hour: "2-digit", minute: "2-digit" },
      );
      if (row.mine && row.deliveryStatus === "sending")
        meta.textContent = `Mengirim 0% · ${time}`;
      if (row.mine && row.deliveryStatus === "failed") {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.className = "transfer-retry";
        retry.textContent = "Kirim ulang";
        retry.onclick = async (event) => {
          event.stopPropagation();
          retry.disabled = true;
          meta.replaceChildren(document.createTextNode("Mengirim ulang..."));
          if (row.source) {
            await window.CallMeFileTransfer?.retry?.(row);
          } else if (activeFriend?.peerId) {
            row.deliveryStatus = "sending";
            await window.CallMeStorage?.put?.("messages", row);
            window.CallMeP2P?.send?.(row, activeFriend.peerId);
            messages.querySelector(`[data-message-id="${CSS.escape(row.id)}"]`)?.remove();
            render(row);
          }
        };
        meta.append("  ", retry);
      }
      if (row.kind === "text") {
        const bubble = item.querySelector(".chat-bubble");
        bubble.append(meta);
      } else item.append(meta);
      const createdAt = Number(item.dataset.createdAt) || 0;
      const next = [...messages.children].find((child) =>
        (Number(child.dataset.createdAt) || 0) > createdAt,
      );
      if (next) messages.insertBefore(item, next);
      else messages.append(item);
      messages.scrollTop = messages.scrollHeight;
    }
    window.addEventListener("callme:call-log", (event) => {
      const row = event.detail;
      if (!row || !activeFriend || row.roomId !== roomKey(activeFriend.peerId)) return;
      messages.querySelector(`[data-message-id="${CSS.escape(row.id)}"]`)?.remove();
      render(row);
    });
    window.addEventListener("callme:message-ack", async (event) => {
      const id = event.detail?.id;
      if (!id) return;
      const meta = messages.querySelector(
        `[data-message-id="${CSS.escape(id)}"] .chat-meta`,
      );
      if (meta)
        meta.textContent = `${meta.textContent.replace(/\s*(⏳|⚠|✓✓)$/, "")}  ✓✓`;
      try {
        const rows = (await window.CallMeStorage?.all?.("messages")) || [];
        const row = rows.find((item) => item.id === id);
        if (row?.mine) {
          row.deliveryStatus = "delivered";
          await window.CallMeStorage?.put?.("messages", row);
        }
      } catch (error) {
        console.warn("Status ACK tidak tersimpan lokal", error);
      }
    });
    window.addEventListener("callme:p2p-send-wait", async (event) => {
      const id = event.detail?.id;
      if (!id) {
        setConnectionStatus("Koneksi teman terputus, membangun ulang...");
        if (serverReady && isRoomActive()) maintainConnection();
        return;
      }
      if (!id) return;
      const meta = messages.querySelector(
        `[data-message-id="${CSS.escape(id)}"] .chat-meta`,
      );
      if (meta)
        meta.textContent = `${meta.textContent.replace(/\s*(⏳|⚠|✓✓)$/, "")}  ⚠`;
      try {
        const rows = (await window.CallMeStorage?.all?.("messages")) || [];
        const row = rows.find((item) => item.id === id);
        if (row?.mine) {
          row.deliveryStatus = "failed";
          await window.CallMeStorage?.put?.("messages", row);
        }
      } catch (error) {
        console.warn("Status transfer gagal tidak tersimpan lokal", error);
      }
    });
    async function load() {
      const peer = activeFriend?.peerId,
        room = peer ? roomKey(peer) : "";
      if (!room) return;
      const rows = (await window.CallMeStorage?.all?.("messages")) || [];
      rows
        .filter((row) => row.roomId === room)
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
        .forEach(render);
    }
    const setConnectionStatus = (text) => {
      document
        .getElementById("chat-activity-status")
        ?.replaceChildren(document.createTextNode(text));
    };
    const connectionStatus = (label) => {
      if (!activeRoute && activeFriend?.peerId)
        activeRoute = window.CallMeTransport?.getRoute?.(activeFriend.peerId) || "";
      return `Terhubung dengan ${label}${activeRoute ? ` · ${activeRoute}` : ""}`;
    };
    const refreshConnectionRoute = (peerId) => {
      let tries = 0;
      const check = () => {
        if (!isRoomActive() || normalizePeer(activeFriend?.peerId) !== normalizePeer(peerId)) return;
        activeRoute = window.CallMeTransport?.getRoute?.(peerId) || activeRoute;
        if (activeRoute) {
          const label = activeFriend.display_name || activeFriend.phone || normalizePeer(peerId);
          setConnectionStatus(connectionStatus(label));
          return;
        }
        if (tries++ < 20) setTimeout(check, 300);
      };
      check();
    };
    const cancelConnectionRetry = () => {
      clearTimeout(connectionTimer);
      connectionTimer = null;
    };
    const isRoomActive = () =>
      Boolean(activeFriend?.peerId) &&
      window.CallMeApp?.current() !== "friends";
    window.addEventListener("callme:peer-server-status", (event) => {
      serverReady = event.detail?.status === "online";
      if (event.detail?.status === "conflict") {
        cancelConnectionRetry();
        if (isRoomActive())
          setConnectionStatus("ID akun sedang dipakai di perangkat/sesi lain");
        return;
      }
      if (!serverReady) {
        cancelConnectionRetry();
        if (isRoomActive()) setConnectionStatus("Menghubungi server...");
        return;
      }
      if (!isRoomActive()) return;
      if (window.CallMeP2P?.isConnected?.(activeFriend.peerId)) {
        cancelConnectionRetry();
        const friendLabel =
          activeFriend.display_name ||
          activeFriend.phone ||
          activeFriend.peerId;
        setConnectionStatus(connectionStatus(friendLabel));
      } else {
        setConnectionStatus("P2P ready");
        // PeerJS sudah siap; baru setelah status ini pencarian teman dimulai.
        maintainConnection();
      }
    });
    window.addEventListener("callme:p2p-status", (event) => {
      if (!activeFriend?.peerId) return;
      const id = event.detail?.peerId || "";
      const eventPeer = normalizePeer(id);
      const activePeer = normalizePeer(activeFriend.peerId);
      if (!eventPeer || eventPeer !== activePeer) return;
      if (event.detail.status === "online") {
        void flushPendingMessages(eventPeer);
        void flushPendingFiles(eventPeer);
        cancelConnectionRetry();
        window.CallMeP2P?.send?.(
          { kind: "room-active", roomId: roomKey(activeFriend.peerId) },
          activeFriend.peerId,
        );
        setConnectionStatus(
          connectionStatus(activeFriend.display_name || activeFriend.phone || activePeer),
        );
        refreshConnectionRoute(activePeer);
      } else {
        setConnectionStatus(`Terputus dari ${String(id).replace(/^cm-/i, "")}`);
        if (serverReady && isRoomActive()) maintainConnection(1500);
      }
    });
    const maintainConnection = (initialDelay = 0) => {
      cancelConnectionRetry();
      if (!activeFriend?.peerId) return;
      // Panel chatroom dapat dibuka setelah event peer "open" terlewat.
      // Ambil status aktual dari transport agar tidak menunggu refresh.
      if (window.CallMeTransport?.isPeerReady?.()) {
        serverReady = true;
        if (isRoomActive() && !window.CallMeP2P?.isConnected?.(activeFriend.peerId))
          setConnectionStatus("P2P ready");
      }
      const peerId = activeFriend.peerId;
      const find = () => {
        if (!isRoomActive() || activeFriend?.peerId !== peerId) {
          connectionTimer = null;
          return;
        }
        if (!serverReady) {
          setConnectionStatus("Menghubungi server...");
          connectionTimer = null;
          return;
        }
        if (window.CallMeP2P?.isConnected?.(peerId)) {
          connectionTimer = null;
          setConnectionStatus(
            connectionStatus(activeFriend.display_name || activeFriend.phone || window.CallMeApp.normalize(peerId)),
          );
          return;
        }
        if (window.CallMeP2P?.hasConnection?.(peerId)) {
          // Jangan berhenti saat masih "connecting": koneksi pending bisa
          // mati tanpa event (EXPIRE), sehingga loop pemantauan harus tetap
          // berjalan sampai benar-benar terbuka — transport membuang
          // koneksi pending yang menua (>8 detik) dan mencoba ulang.
          setConnectionStatus("Menghubungkan teman...");
        } else {
          setConnectionStatus("Mencari teman...");
          window.CallMeP2P?.connect(peerId);
        }
        connectionTimer = setTimeout(find, 1500);
      };
      if (initialDelay) {
        setConnectionStatus("Koneksi terputus. Menunggu 1,5 detik...");
        connectionTimer = setTimeout(find, initialDelay);
      } else {
        find();
      }
    };
    window.CallMeChat = {
      async open(friend) {
        activeFriend = friend || null;
        activeRoute = "";
        // Panel panggilan sedang tampil → room ini hanya dibuka sebagai panel
        // LATAR (activateCallRoom dipanggil saat terima/tolak). show("chatroom")
        // akan menutup panel panggilan, lalu handler terima membukanya kembali —
        // panel terlihat muncul dua kali tepat saat panggilan tersambung.
        const callPanelUp =
          window.CallMeApp.current?.() === "voice-call" ||
          window.CallMeApp.current?.() === "video-call";
        if (activeFriend?.peerId) {
          void (async () => {
          try {
            const target = window.CallMeApp?.normalize?.(String(activeFriend.peerId).replace(/^cm-/i, "")) || activeFriend.peerId;
            const profile = await window.CallMeProfileRepository?.syncContact?.(target, sessionStorage.getItem("callme-v2-session-user") || "", sessionStorage.getItem("callme-v2-session-token") || "");
            if (profile) {
              activeFriend = { ...activeFriend, ...profile, peerId: activeFriend.peerId, display_name: profile.display_name || activeFriend.display_name, phone: profile.phone || activeFriend.phone, email: profile.email || activeFriend.email, profile_photo: profile.photo_url || profile.profile_photo || activeFriend.profile_photo || "" };
              await window.CallMeStorage?.put?.("contacts", activeFriend);
              updateAvatar();
              title.textContent = activeFriend.display_name || activeFriend.phone || activeFriend.peerId || "Chatroom";
              window.dispatchEvent(new CustomEvent("callme:profile-updated", { detail: { peerId: activeFriend.peerId, data: activeFriend } }));
            }
          } catch (error) { console.warn("Profil teman gagal diperbarui dari server", error); }
          })();
        }
        updateAvatar();
        title.textContent =
          activeFriend?.display_name || activeFriend?.phone || activeFriend?.peerId || "Chatroom";
        messages.replaceChildren();
        if (!callPanelUp) window.CallMeApp.show("chatroom");
        if (friend?.peerId)
          await window.CallMeStorage?.remove?.("unread", friend.peerId);
        maintainConnection();
        if (activeFriend?.peerId) {
          window.dispatchEvent(
            new CustomEvent("callme:room-open", {
              detail: { peerId: activeFriend.peerId },
            }),
          );
        }
        load();
      },
      activeRoom() {
        return activeFriend?.peerId ? roomKey(activeFriend.peerId) : null;
      },
      activePeer() {
        return activeFriend?.peerId || null;
      },
      activeFriend() {
        return activeFriend;
      },
      render,
      sendText,
    };
    window.CallMeP2P?.on((data) => {
      if (["room-active", "room-idle"].includes(data?.kind)) return;
      const senderPeerId = normalizePeer(data?.senderPeerId || data?.peerId);
      if (!data?.roomId || !senderPeerId || data.roomId !== roomKey(senderPeerId)) return;
      const row = {
        ...data,
        senderPeerId,
        mine: false,
        id: data.id || window.CallMeApp.uid(),
        createdAt: data.createdAt || Date.now(),
      };
      const isCurrentRoom = Boolean(
        activeFriend?.peerId &&
        normalizePeer(activeFriend.peerId) === normalizePeer(senderPeerId) &&
        row.roomId === roomKey(activeFriend.peerId)
      );
      if (!isCurrentRoom) {
        if (row.kind !== "media" && row.kind !== "audio")
          void window.CallMeStorage?.put?.("messages", row).catch?.((error) => console.warn("Pesan latar gagal disimpan", error));
        return;
      }
      const existingItem = messages.querySelector(`[data-message-id="${CSS.escape(row.id)}"]`);
      if (!existingItem) {
        render(row);
        if (row.kind !== "call-log") tone(false);
      }
      void (async () => {
        try {
          const existing = row.id ? await window.CallMeStorage?.get?.("messages", row.id) : null;
          if (existing && row.kind === "call-log") {
            const updated = { ...existing, ...row, mine: existing.mine };
            await window.CallMeStorage?.put?.("messages", updated);
            messages.querySelector(`[data-message-id="${CSS.escape(row.id)}"]`)?.remove();
            render(updated);
          } else if (!existing && row.kind !== "media" && row.kind !== "audio") {
            await window.CallMeStorage?.put?.("messages", row);
          }
        } catch (error) {
          console.warn("Pesan diterima tetapi gagal disimpan lokal", error);
          window.dispatchEvent(new CustomEvent("callme:local-storage-warning", { detail: { id: row.id, name: row.name } }));
        }
        if (row.id && row.kind !== "media" && row.kind !== "audio") {
        }
      })();
      void (async () => {
        const contacts = (await window.CallMeStorage?.all?.("contacts")) || [];
        if (!contacts.some((contact) => normalizePeer(contact.peerId) === normalizePeer(senderPeerId))) {
          await window.CallMeStorage?.put?.("contacts", {
            peerId: normalizePeer(senderPeerId), phone: normalizePeer(senderPeerId),
            display_name: data.senderName || data.display_name || normalizePeer(senderPeerId),
            profile_photo: data.profile_photo || "", email: "", savedAt: Date.now(),
          });
          window.dispatchEvent(new CustomEvent("callme:contacts-updated"));
        }
      })().catch((error) => console.warn("Kontak pengirim gagal disimpan", error));
    });    function updateSubmit() {
      const text = Boolean(input.value.trim());
      submit.type = text ? "submit" : "button";
      submit.setAttribute(
        "aria-label",
        text ? "Kirim" : recorder ? "Berhenti merekam" : "Rekam audio",
      );
      const icon = submit.querySelector("img");
      if (!icon) return;
      icon.src = text
        ? "https://api.iconify.design/material-symbols/send.svg?color=%23fff"
        : recorder
          ? "https://api.iconify.design/material-symbols/stop.svg?color=%23fff"
          : "https://api.iconify.design/material-symbols/mic.svg?color=%23fff";
    }
    input.addEventListener("input", updateSubmit);
    updateSubmit();
    const chatMenu = document.getElementById("chat-menu"),
      blockAction = chatMenu?.querySelector('[data-chat-action="block"]'),
      blockLabel = blockAction?.querySelector("span");
    const syncBlockLabel = () => {
      const blocked = JSON.parse(
        localStorage.getItem("callme-v2-blocked") || "[]",
      );
      const isBlocked = Boolean(
        activeFriend && blocked.includes(activeFriend.peerId),
      );
      if (blockLabel)
        blockLabel.textContent = isBlocked ? "Unblokir" : "Blokir";
      if (blockAction)
        blockAction.dataset.blocked = isBlocked ? "true" : "false";
    };
    document
      .querySelector("[data-chat-menu]")
      ?.addEventListener("click", () => {
        syncBlockLabel();
        if (chatMenu) chatMenu.hidden = !chatMenu.hidden;
      });
    chatMenu?.querySelectorAll("[data-chat-action]").forEach((action) =>
      action.addEventListener("click", async () => {
        if (!activeFriend) return;
        chatMenu.hidden = true;
        const type = action.dataset.chatAction;
        if (type === "clear") {
          if (!confirm("Hapus semua pesan di chat ini?")) return;
          const room = roomKey(activeFriend.peerId);
          const rows = (await window.CallMeStorage?.all?.("messages")) || [];
          await Promise.all(
            rows
              .filter((row) => row.roomId === room)
              .map((row) => window.CallMeStorage?.remove?.("messages", row.id)),
          );
          messages.replaceChildren();
          return;
        }
        if (type === "remove") {
          if (!confirm("Hapus teman ini?")) return;
          await window.CallMeStorage?.remove?.("contacts", activeFriend.peerId);
          window.CallMeApp.show("friends");
          window.CallMeFriends?.load?.();
          return;
        }
        if (type === "block") {
          const blocked = JSON.parse(
            localStorage.getItem("callme-v2-blocked") || "[]",
          );
          const index = blocked.indexOf(activeFriend.peerId);
          const label = index < 0 ? "Blokir" : "Unblokir";
          if (!confirm(`${label} teman ini?`)) return;
          if (index < 0) blocked.push(activeFriend.peerId);
          else blocked.splice(index, 1);
          localStorage.setItem("callme-v2-blocked", JSON.stringify(blocked));
          syncBlockLabel();
        }
      }),
    );
    // Satu jalur kirim pesan teks untuk kotak chat.
    // Guard sending menutup jendela di mana teks masih ada di kotak sementara
    // IndexedDB belum selesai — tanpa ini, ketukan/Enter beruntun menghasilkan
    // dua pesan berbeda id yang sama isinya.
    let sending = false;
    // Menunggu ACK P2P dari penerima (transport memancarkan
    // callme:message-ack ketika baris dengan id itu benar-benar sampai).
    // Dipakai sebagai penentu apakah push isi masih perlu dikirim cadangan.
    const waitForAck = (id, timeout = 6000) =>
      new Promise((resolve) => {
        const onAck = (event) => {
          if (event.detail?.id !== id) return;
          clearTimeout(timer);
          window.removeEventListener("callme:message-ack", onAck);
          resolve(true);
        };
        const timer = setTimeout(() => {
          window.removeEventListener("callme:message-ack", onAck);
          resolve(false);
        }, timeout);
        window.addEventListener("callme:message-ack", onAck);
      });
    async function sendText(value) {
      if (!value || !activeFriend || sending) return false;
      sending = true;
      try {
        const row = {
          id: crypto.randomUUID(),
          kind: "text",
          roomId: roomKey(activeFriend.peerId),
          text: value,
          mine: true,
          deliveryStatus: "sending",
          createdAt: Date.now(),
        };
        // Bubble tampil sebelum menulis penyimpanan agar tidak ada jeda yang
        // membuat pengguna menekan kirim dua kali.
        render(row);
        tone(true);
        // Simpan dahulu agar event P2P yang muncul saat probe tidak
        // melewatkan antrean pesan ini.
        try {
          await window.CallMeStorage?.put?.("messages", row);
        } catch (error) {
          console.warn("Pesan tidak tersimpan lokal", error);
          window.dispatchEvent(
            new CustomEvent("callme:local-storage-warning", {
              detail: { id: row.id, name: "pesan" },
            }),
          );
        }
        sendingMessageIds.add(row.id);
        let p2pReady = Boolean(window.CallMeP2P?.isConnected?.(activeFriend.peerId));
        let acked = false;
        try {
          // Kanal ready sudah menyelesaikan HELLO; kirim langsung agar setiap
          // pesan tidak menunggu round-trip presence hingga 3 detik.
          if (!p2pReady)
            p2pReady = Boolean(await window.CallMeP2P?.probe?.(activeFriend.peerId, 2000));
          if (p2pReady) {
            const ackPromise = waitForAck(row.id, 2500);
            const sent = await window.CallMeP2P?.send?.(row, activeFriend.peerId);
            acked = sent && await ackPromise;
          }
        } finally {
          sendingMessageIds.delete(row.id);
        }
        if (acked) {
          row.deliveryStatus = "delivered";
          await window.CallMeStorage?.put?.("messages", row);
        } else {
          // ACK tidak tiba: biarkan pesan antre untuk retry P2P dengan ID
          // yang sama. Pemberitahuan hanya membangunkan penerima; isinya
          // tidak dikirim ulang lewat push.
          row.deliveryStatus = "sending";
          await window.CallMeStorage?.put?.("messages", row);
          if (!p2pReady) {
          // Pemberitahuan ber-ID membangunkan penerima; isi tetap antre
          // di pengirim dan dikirim lewat P2P saat koneksi kembali siap.
            window.CallMePush?.notify?.(
              activeFriend.peerId, "message",
              activeFriend.display_name || activeFriend.phone || activeFriend.peerId,
              value,
              { id: row.id, roomId: row.roomId, createdAt: row.createdAt, pendingOnly: true, sender: sessionStorage.getItem("callme-v2-session-user") || "" },
            );
          } else {
            await flushPendingMessages(activeFriend.peerId);
          }
        }
        return true;
      } finally {
        sending = false;
      }
    }
    const flushingPending = new Set();
    const flushingPendingFiles = new Set();
    const sendingMessageIds = new Set();
    async function flushPendingFiles(peerId) {
      const target = normalizePeer(peerId);
      if (!target || flushingPendingFiles.has(target) || !window.CallMeFileTransfer?.retry) return;
      flushingPendingFiles.add(target);
      try {
        const rows = (await window.CallMeStorage?.all?.("messages")) || [];
        for (const row of rows.filter((item) => item?.mine && item.roomId === roomKey(target) && (item.kind === "media" || item.kind === "audio") && item.deliveryStatus !== "delivered")) {
          const sent = await window.CallMeFileTransfer.retry(row);
          if (sent) {
            row.deliveryStatus = "delivered";
            await window.CallMeStorage?.put?.("messages", row);
          }
        }
      } finally { flushingPendingFiles.delete(target); }
    }
    async function flushPendingMessages(peerId) {
      const target = normalizePeer(peerId);
      if (!target || flushingPending.has(target) || !window.CallMeP2P?.isConnected?.(target)) return;
      flushingPending.add(target);
      try {
        const rows = (await window.CallMeStorage?.all?.("messages")) || [];
        const pendingRows = rows
          .filter((row) => row?.mine && row.roomId === roomKey(target) && row.kind === "text" && row.deliveryStatus !== "delivered")
          .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
        for (const row of pendingRows) {
          if (!window.CallMeP2P?.isConnected?.(target)) break;
          if (sendingMessageIds.has(row.id)) continue;
          const latest = ((await window.CallMeStorage?.all?.("messages")) || [])
            .find((item) => item.id === row.id);
          if (!latest || latest.deliveryStatus === "delivered") continue;
          const ackPromise = waitForAck(row.id);
          const sent = await window.CallMeP2P.send(latest, target);
          if (!sent) break;
          const acked = await ackPromise;
          if (!acked) break;
          latest.deliveryStatus = "delivered";
          await window.CallMeStorage?.put?.("messages", latest);
        }
      } finally {
        flushingPending.delete(target);
      }
    }
    // Papan ketik (Enter / tombol kirim IME) dapat memicu submit formulir
    // tanpa melalui klik tombol. Tanpa pengait ini, submit bawaan memuat ulang
    // halaman dan pesan tidak pernah terkirim; dengan guard di sendText,
    // klik + submit pada satu ketukan tetap menghasilkan satu pesan.
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = input.value.trim();
      if (!value) return;
      void sendText(value).then((ok) => {
        if (ok) {
          input.value = "";
          updateSubmit();
        }
      });
    });
    submit.addEventListener("click", async (event) => {
      if (input.value.trim()) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const value = input.value.trim();
        if (await sendText(value)) {
          input.value = "";
          updateSubmit();
        }
        return;
      }
      if (recorder) {
        event.preventDefault();
        recorder.stop();
        return;
      }
      const micStatus = (text) => {
        document
          .getElementById("chat-activity-status")
          ?.replaceChildren(document.createTextNode(text));
      };
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      ) {
        micStatus("Perekam suara tidak tersedia di peramban ini.");
        return;
      }
      micStatus("Meminta izin mikrofon…");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        recorder = new MediaRecorder(stream);
        recorded = [];
        recorder.ondataavailable = (e) => e.data.size && recorded.push(e.data);
        recorder.onstop = async () => {
          const mime = recorder.mimeType || "audio/webm";
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(recorded, { type: mime });
          const file = new File([blob], "Pesan suara.webm", { type: mime });
          if (window.CallMeFileTransfer?.send)
            await window.CallMeFileTransfer.send(file, "voice");
          recorder = null;
          updateSubmit();
        };
        recorder.start(250);
        micStatus("Merekam pesan suara… tekan ⏹ untuk kirim.");
        updateSubmit();
      } catch (error) {
        recorder = null;
        micStatus(
          `Mikrofon tidak bisa dipakai (${error?.name || "error"}). Izinkan akses mikrofon, lalu coba lagi.`,
        );
        updateSubmit();
      }
    });
    messages.addEventListener("click", async (event) => {
      const bubble = event.target.closest(".chat-bubble");
      if (!bubble) return;
      const existing = bubble
        .closest(".chat-item")
        ?.querySelector(".chat-item-menu");
      if (existing) {
        existing.hidden = !existing.hidden;
        return;
      }
      const item = bubble.closest(".chat-item"),
        id = item?.dataset.messageId;
      if (!id) return;
      const menu = document.createElement("div");
      menu.className = "chat-item-menu";
      menu.innerHTML =
        '<button type="button" data-action="download">Download</button><button type="button" data-action="delete">Hapus</button><button type="button" data-action="delete-all">Hapus dari semua</button>';
      menu.onclick = async (actionEvent) => {
        const action = actionEvent.target.dataset.action;
        if (!action) return;
        const rows = (await window.CallMeStorage?.all?.("messages")) || [],
          row = rows.find((saved) => saved.id === id);
        if (action === "download") {
          const link = document.createElement("a");
          link.href = URL.createObjectURL(
            new Blob([row?.text || ""], { type: "text/plain" }),
          );
          link.download = "pesan.txt";
          link.click();
          URL.revokeObjectURL(link.href);
        } else {
          await window.CallMeStorage?.remove?.("messages", id);
          item.remove();
          if (action === "delete-all")
            window.CallMeP2P?.send({
              kind: "delete-message",
              id,
              roomId: row?.roomId,
            });
        }
        menu.remove();
      };
      item.append(menu);
    });
  });
})();
