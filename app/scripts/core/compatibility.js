(function () {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  // Beberapa Android System WebView menambahkan token Chrome ke UA. Token
  // `wv` atau `Version/4.0` lebih dapat diandalkan untuk memilih mode aman.
  const isAndroidWebView =
    /Android/i.test(navigator.userAgent) &&
    (/[;)]\s*wv\)/i.test(navigator.userAgent) ||
      /Version\/4\.0/i.test(navigator.userAgent));
  const chunkSize = isAndroidWebView ? 7000 : 24000;
  const chunkAckTimeout = isAndroidWebView ? 12000 : 8000;
  async function waitUntilVisible() {
    if (!isAndroidWebView) return;
    if (document.visibilityState !== "hidden") return;
    window.dispatchEvent(
      new CustomEvent("callme:file-transfer-paused", {
        detail: { reason: "page-hidden" },
      }),
    );
    await new Promise((resolve) => {
      const resume = () => {
        if (document.visibilityState === "hidden") return;
        document.removeEventListener("visibilitychange", resume);
        window.dispatchEvent(new CustomEvent("callme:file-transfer-resumed"));
        resolve();
      };
      document.addEventListener("visibilitychange", resume);
    });
  }
  const completedAcks = new Set();
  const peerKey = (value) =>
    window.CallMeApp?.normalize?.(String(value || "").replace(/^cm-/i, "")) ||
    String(value || "")
      .replace(/^cm-/i, "")
      .toLowerCase();
  window.addEventListener("callme:file-complete-ack", (event) => {
    if (event.detail?.id)
      completedAcks.add(`${peerKey(event.detail.peerId)}:${event.detail.id}`);
  });

  function inferMime(file) {
    const extension = String(file.name || "")
      .split(".")
      .pop()
      .toLowerCase();
    const byExtension = {
      pdf: "application/pdf",
      mp3: "audio/mpeg",
      wav: "audio/wav",
      m4a: "audio/mp4",
      aac: "audio/aac",
      ogg: "audio/ogg",
      opus: "audio/ogg",
      flac: "audio/flac",
      mp4: "video/mp4",
      m4v: "video/mp4",
      webm: "video/webm",
      mov: "video/quicktime",
      "3gp": "video/3gpp",
      "3gpp": "video/3gpp",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      heic: "image/heic",
    };
    return !file.type || file.type === "application/octet-stream"
      ? byExtension[extension] || file.type || "application/octet-stream"
      : file.type;
  }

  async function readDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        resolve(
          window.CallMeChatUtils?.normalizeDataUrl?.(reader.result) ||
            reader.result,
        );
      reader.onerror = () =>
        reject(reader.error || new Error("FileReader gagal"));
      reader.readAsDataURL(file);
    });
  }
  async function dataUrlToFile(source, name, mime) {
    const response = await fetch(source);
    return new File([await response.blob()], name || "file", {
      type: mime || "application/octet-stream",
    });
  }

  async function persist(row) {
    try {
      await window.CallMeStorage?.put?.("messages", row);
    } catch (error) {
      console.warn(
        "File tidak tersimpan lokal; pengiriman P2P tetap berjalan",
        error,
      );
      window.dispatchEvent(
        new CustomEvent("callme:local-storage-warning", {
          detail: { id: row.id, name: row.name },
        }),
      );
    }
  }

  async function sendOne(file, mode = "file", existingRow = null) {
    const peer = window.CallMeChat?.activePeer?.();
    const room = window.CallMeChat?.activeRoom?.();
    if (!peer || !room) {
      window.dispatchEvent(new CustomEvent("callme:p2p-send-wait"));
      return false;
    }
    if (!Number.isFinite(file?.size) || file.size <= 0)
      throw new Error("File kosong atau tidak dapat dibaca browser");
    if (existingRow?.id) {
      const saved = ((await window.CallMeStorage?.all?.("messages")) || [])
        .find((item) => item.id === existingRow.id);
      if (saved?.deliveryStatus === "delivered") return true;
    }

    const mime = inferMime(file);
    const audio = mime.startsWith("audio/");
    const row = existingRow || {
      id: window.CallMeApp?.uid?.() || `media-${Date.now()}`,
      kind: audio ? "audio" : "media",
      roomId: room,
      name: file.name || "lampiran",
      mime,
      source: existingRow?.source || "",
      audio: audio ? existingRow?.audio || existingRow?.source || "" : undefined,
      mine: true,
      deliveryStatus: "sending",
      createdAt: Date.now(),
    };
    // Isi file tetap melalui P2P; FCM hanya memberi tahu/membangunkan
    // penerima saat pemeriksaan presence menyatakan perangkat sedang tidur.
    const awake = window.CallMeP2P?.isConnected?.(peer) ||
      await window.CallMeP2P?.probe?.(peer, 2000);
    if (!awake) {
      const sender = sessionStorage.getItem("callme-v2-session-user") || "";
      const label = audio
        ? "pesan suara"
        : mime.startsWith("image/")
          ? "gambar"
          : mime.startsWith("video/")
            ? "video"
            : "file";
      window.CallMePush?.notify?.(
        peer,
        "media",
        sender || "CallMe",
        `${label} ${row.name} dari ${sender || "CallMe"}`,
        { id: row.id, roomId: room, createdAt: row.createdAt, sender },
      );
    }
    const source = await readDataUrl(file);
    row.source = source;
    if (audio) row.audio = source;
    if (!existingRow) {
      window.CallMeChat?.render?.(row);
      await persist(row);
    }

    // Semua file memakai jalur dan ukuran chunk yang sama. Mode hanya
    // dipertahankan untuk UI; jenis file ditentukan penerima dari MIME.
    // Gunakan koneksi READY yang sudah ada setelah sinkronisasi profil.
    // Jangan membuat DataConnection kedua hanya karena tombol lampiran diklik.
    let reconnectRequested = false;
    let reconnectAt = 0;
    if (
      !window.CallMeP2P?.isConnected?.(peer) &&
      !window.CallMeP2P?.hasConnection?.(peer)
    ) {
      window.dispatchEvent(
        new CustomEvent("callme:p2p-reconnecting", {
          detail: { peerId: peer, file: file.name },
        }),
      );
      window.CallMeP2P?.connect?.(peer);
      reconnectRequested = true;
      reconnectAt = Date.now();
    }
    const deadline = Date.now() + 30000;
    while (!window.CallMeP2P?.isConnected?.(peer) && Date.now() < deadline) {
      await wait(300);
      if (
        !window.CallMeP2P?.isConnected?.(peer) &&
        !window.CallMeP2P?.hasConnection?.(peer) &&
        (!reconnectRequested || Date.now() - reconnectAt >= 5000)
      ) {
        window.CallMeP2P?.connect?.(peer);
        reconnectRequested = true;
        reconnectAt = Date.now();
      }
    }
    if (!window.CallMeP2P?.isConnected?.(peer)) {
      window.dispatchEvent(new CustomEvent("callme:p2p-send-wait"));
      return false;
    }

    // Satu envelope file untuk voice, memory, foto dan video. Ukuran potongan
    // mengikuti sumber yang terbukti di Blogspot.
    // Pola update.txt yang terbukti lebih stabil di WebView Android.
    const total = Math.ceil(source.length / chunkSize);
    const waitForChunkAck = (index, timeout = chunkAckTimeout) =>
      new Promise((resolve) => {
        let timer;
        const onAck = (event) => {
          const detail = event.detail || {};
          if (
            detail.id !== row.id ||
            detail.index !== index ||
            peerKey(detail.peerId) !== peerKey(peer)
          )
            return;
          clearTimeout(timer);
          window.removeEventListener("callme:file-chunk-ack", onAck);
          resolve(true);
        };
        window.addEventListener("callme:file-chunk-ack", onAck);
        timer = setTimeout(() => {
          window.removeEventListener("callme:file-chunk-ack", onAck);
          resolve(false);
        }, timeout);
      });
    const waitForCompleteAck = (timeout = 20000) =>
      new Promise((resolve) => {
        const key = `${peerKey(peer)}:${row.id}`;
        if (completedAcks.delete(key)) {
          resolve(true);
          return;
        }
        let timer;
        const onAck = (event) => {
          const detail = event.detail || {};
          if (detail.id !== row.id || peerKey(detail.peerId) !== peerKey(peer))
            return;
          clearTimeout(timer);
          window.removeEventListener("callme:file-complete-ack", onAck);
          completedAcks.delete(key);
          resolve(true);
        };
        window.addEventListener("callme:file-complete-ack", onAck);
        timer = setTimeout(() => {
          window.removeEventListener("callme:file-complete-ack", onAck);
          resolve(false);
        }, timeout);
      });
    for (let index = 0; index < total; index++) {
      await waitUntilVisible();
      const packet = {
        type: "file",
        id: row.id,
        roomId: room,
        name: row.name,
        mime: row.mime,
        createdAt: row.createdAt,
        i: index,
        total,
        part: source.slice(index * chunkSize, (index + 1) * chunkSize),
      };
      let sent = false;
      for (let attempt = 0; attempt < 8 && !sent; attempt++) {
        if (!window.CallMeP2P?.isConnected?.(peer)) {
          await wait(250);
          continue;
        }
        const ack = waitForChunkAck(index);
        const queued = (await window.CallMeP2P.send(packet, peer)) === true;
        sent = queued && (await ack);
        if (!sent) {
          window.dispatchEvent(
            new CustomEvent("callme:p2p-reconnecting", {
              detail: { peerId: peer, file: row.name },
            }),
          );
          // Jangan langsung memutus koneksi pada timeout ACK. Chunk mungkin
          // sedang tiba; coba ulang pada koneksi yang sama terlebih dahulu.
          await wait(150);
        }
      }
      if (!sent) {
        try {
          await window.CallMeP2P?.send?.(
            { kind: "file-cancel", id: row.id },
            peer,
          );
        } catch {}
        window.dispatchEvent(
          new CustomEvent("callme:p2p-send-wait", {
            detail: { id: row.id, file: row.name, index },
          }),
        );
        return false;
      }
      if (index + 1 < total)
        window.dispatchEvent(
          new CustomEvent("callme:file-transfer-progress", {
            detail: { id: row.id, name: row.name, sent: index + 1, total },
          }),
        );
      await wait(30);
    }

    // Status selesai dan progres 100% hanya setelah penerima mengonfirmasi
    // seluruh file tersusun dan tersimpan.
    const completed = await waitForCompleteAck();
    if (!completed) {
      window.dispatchEvent(
        new CustomEvent("callme:file-transfer-error", {
          detail: {
            id: row.id,
            name: row.name,
            error: "complete-timeout",
            message: "Penerima belum mengonfirmasi file lengkap",
          },
        }),
      );
      return false;
    }
    row.deliveryStatus = "delivered";
    await persist(row);
    window.dispatchEvent(
      new CustomEvent("callme:file-transfer-progress", {
        detail: { id: row.id, name: row.name, sent: total, total },
      }),
    );
    window.dispatchEvent(
      new CustomEvent("callme:file-transfer-complete", {
        detail: { id: row.id, name: row.name, peerId: peer },
      }),
    );
    // Beri DataChannel waktu menyelesaikan paket/ACK terakhir sebelum job
    // berikutnya dimulai. Ini mencegah state file pertama terbawa ke file kedua.
    await wait(350);
    return true;
  }

  let queue = Promise.resolve();
  let activeTransfers = 0;
  function send(file, mode = "file", existingRow = null) {
    window.dispatchEvent(
      new CustomEvent("callme:file-queued", {
        detail: { name: file?.name || "file", mode },
      }),
    );
    const job = queue
      .catch(() => undefined)
      .then(() => wait(350))
      .then(() => {
        activeTransfers += 1;
        return sendOne(file, mode, existingRow);
      })
      .finally(() => {
        activeTransfers = Math.max(0, activeTransfers - 1);
      });
    queue = job.catch((error) => {
      window.dispatchEvent(
        new CustomEvent("callme:file-transfer-error", {
          detail: {
            name: file?.name || "file",
            error: error?.name || "TransferError",
            message: error?.message || String(error),
          },
        }),
      );
      return false;
    });
    return job;
  }
  async function retry(row) {
    if (!row?.source) return false;
    const file = await dataUrlToFile(row.source, row.name, row.mime);
    return send(
      file,
      row.kind === "media" && row.mime?.startsWith("video/")
        ? "video-capture"
        : "file",
      row,
    );
  }
  window.CallMeFileTransfer = Object.freeze({
    send,
    retry,
    isBusy: () => activeTransfers > 0,
  });
})();
