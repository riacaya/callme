(function () {
  let peer = null,
    lastIdentity = "",
    registerTimer = null,
    // stop() harus mematikan semua event dari peer lama: reconnect yang terjadi
    // saat destroy membuka socket baru yang dipegang server sebagai "cm-<user>"
    // yatim — login berikutnya selalu kena unavailable-id sampai refresh.
    sessionStopping = false,
    // Berapa kali ID yang bentrok dicoba ulang. Bentrok umumnya berasal dari
    // socket yatim (proses lama mati mendadak saat HP tidur) yang akan ditutup
    // server setelah heartbeat habis; hitungan dibatasi agar sesi kedua yang
    // sungguhan tetap berhenti di status konflik, bukan mencoba selamanya.
    idConflictRetries = 0,
    peerOpenTimer = null,
    serverStatus = "idle";
  // Irama 1 detik memangkas jeda setelah server melepas socket yatim:
  // pendaftaran ulang menempel sedekat mungkin pada momen pelepasan, jadi
  // putar ulang pemanggil (1 dtk) menemukan kita di siklus berikutnya.
  // Jendela tetap 60 detik (60×1 dtk) — sama dengan versi lama 30×2 dtk,
  // jadi tidak ada percobaan yang terbuang, hanya jaraknya yang dirapatkan.
  const ID_CONFLICT_RETRY_DELAY = 1000;
  const ID_CONFLICT_RETRY_LIMIT = 60;
  const connections = new Map(),
    readyConnections = new Set(),
    pending = new Map(),
    mediaParts = new Map(),
    completedFiles = new Map(),
    ackWaiters = new Map(),
    presenceTimers = new Map(),
    routeByPeer = new Map(),
    listeners = new Set();
  const TURN_SERVERS = [
    { urls: "stun:stun.relay.metered.ca:80" },
    {
      urls: "turn:global.relay.metered.ca:80",
      username: "466494188ac3580fb1c6df34",
      credential: "f8Qc+SUXdyhuVIgB",
    },
    {
      urls: "turn:global.relay.metered.ca:80?transport=tcp",
      username: "466494188ac3580fb1c6df34",
      credential: "f8Qc+SUXdyhuVIgB",
    },
    {
      urls: "turn:global.relay.metered.ca:443",
      username: "466494188ac3580fb1c6df34",
      credential: "f8Qc+SUXdyhuVIgB",
    },
    {
      urls: "turns:global.relay.metered.ca:443?transport=tcp",
      username: "466494188ac3580fb1c6df34",
      credential: "f8Qc+SUXdyhuVIgB",
    },
  ];
  const normalizePeerIdentity = (value) =>
    window.CallMeIdentity?.withoutPeerPrefix?.(value) ||
    window.CallMeApp?.normalize?.(value) ||
    String(value || "")
      .replace(/^cm-/i, "")
      .toLowerCase();
  function publishPeerServerStatus(status, detail = {}) {
    serverStatus = status;
    window.dispatchEvent(
      new CustomEvent("callme:peer-server-status", {
        detail: { status, ...detail },
      }),
    );
  }
  const blocked = () =>
    JSON.parse(localStorage.getItem("callme-v2-blocked") || "[]").map(
      (value) => `cm-${normalizePeerIdentity(value)}`,
    );
  function start(userId) {
    if (!userId) {
      publishPeerServerStatus("unavailable", { reason: "missing-user" });
      return false;
    }
    if (typeof Peer !== "function") {
      publishPeerServerStatus("unavailable", { reason: "peerjs-unavailable" });
      return false;
    }
    const identity =
        window.CallMeApp?.normalize?.(userId) || String(userId).toLowerCase(),
      id = `cm-${identity}`;
    lastIdentity = identity;
    clearTimeout(registerTimer);
    if (peer && !peer.destroyed && peer.id === id) {
      publishPeerServerStatus(peer.open ? "online" : "connecting", { peerId: id });
      return true;
    }
    clearTimeout(peerOpenTimer);
    peerOpenTimer = null;
    if (peer)
      try {
        peer.__disposed = true;
        peer.destroy();
      } catch {}
    sessionStopping = false;
    publishPeerServerStatus("connecting", { peerId: id });
    let instance;
    try {
      instance = new Peer(id, {
        debug: 3,
        config: {
          iceServers: TURN_SERVERS,
          iceTransportPolicy: "all",
          sdpSemantics: "unified-plan",
        },
      });
    } catch (error) {
      publishPeerServerStatus("unavailable", { reason: "constructor-error", error });
      window.dispatchEvent(new CustomEvent("callme:p2p-error", { detail: error }));
      return false;
    }
    peer = instance;
    peerOpenTimer = setTimeout(() => {
      if (peer !== instance || instance.open || instance.destroyed || sessionStopping) return;
      publishPeerServerStatus("timeout", { peerId: id, reason: "registration-timeout" });
    }, 15000);
    // Event dari instance yang sudah diganti/dihancurkan/di-stop wajib
    // diabaikan: handler "disconnected" yang reconnect saat destroy justru
    // membuat socket yatim sehingga start() berikutnya selalu konflik.
    const isCurrent = () =>
      !sessionStopping &&
      peer === instance &&
      !instance.destroyed &&
      !instance.__disposed;
    instance.on("open", () => {
      if (!isCurrent()) return;
      // Terdaftar berhasil → bentrok sebelumnya sudah selesai.
      idConflictRetries = 0;
      clearTimeout(peerOpenTimer);
      peerOpenTimer = null;
      publishPeerServerStatus("online", { peerId: instance.id });
    });
    instance.on("connection", (next) => {
      if (!isCurrent()) return;
      next.__incoming = true;
      attach(next);
    });
    instance.on("call", (incoming) => {
      if (!isCurrent()) return;
      window.dispatchEvent(
        new CustomEvent("callme:incoming-call", { detail: incoming }),
      );
    });
    instance.on("error", (error) => {
      if (!isCurrent()) return;
      const idInUse =
        error?.type === "unavailable-id" ||
        /id .* is taken/i.test(error?.message || "");
      // PeerJS also emits peer-level errors for an individual outgoing link.
      // A missing/offline recipient must not destroy our own registered peer.
      if (error?.type === "peer-unavailable" || error?.type === "webrtc") {
        window.dispatchEvent(
          new CustomEvent("callme:p2p-error", {
            detail: { scope: "connection", error },
          }),
        );
        return;
      }
      clearTimeout(peerOpenTimer);
      peerOpenTimer = null;
      publishPeerServerStatus(idInUse ? "conflict" : "offline", {
        error,
        reason: error?.type || error?.message || "peer-error",
      });
      window.dispatchEvent(
        new CustomEvent("callme:p2p-error", { detail: error }),
      );
      instance.__disposed = true;
      try {
        instance.destroy();
      } catch {}
      // ID yang bentrok tidak selalu permanen: saat HP bangun dari tidur,
      // proses lama bisa mati mendadak dan meninggalkan socket yatim yang
      // masih dipegang server sampai heartbeat-nya habis. Tanpa percobaan
      // ulang, penerima tetap offline dan panggilan/putar ulang pemanggil
      // tidak pernah berdering (chatroom terbuka tanpa panel panggilan).
      // Ulangi dengan jeda sampai server melepas socket lama; bila sesi kedua
      // memang aktif, status konflik dipertahankan setelah batas percobaan.
      const conflictDelay = idInUse ? ID_CONFLICT_RETRY_DELAY : 1000;
      const canRetry = idInUse ? idConflictRetries < ID_CONFLICT_RETRY_LIMIT : true;
      if (lastIdentity && canRetry) {
        if (idInUse) idConflictRetries++;
        registerTimer = setTimeout(() => start(lastIdentity), conflictDelay);
      }
    });
    instance.on("disconnected", () => {
      if (!isCurrent()) return;
      clearTimeout(peerOpenTimer);
      peerOpenTimer = null;
      publishPeerServerStatus("offline", { reason: "disconnected" });
      try {
        instance.reconnect();
      } catch {
        if (lastIdentity)
          registerTimer = setTimeout(() => start(lastIdentity), 1000);
      }
    });
    return true;
  }
  function attach(next) {
    const existing = connections.get(next.peer);
    if (existing && existing !== next) {
      // Hanya sisi dengan ID lebih kecil yang membuat koneksi keluar.
      // Ini mencegah dua DataConnection bersamaan saat room dibuka serentak.
      const selfId = String(peer?.id || "").toLowerCase();
      const keepIncoming = selfId > String(next.peer || "").toLowerCase();
      // Koneksi lama yang tidak menjawab heartbeat dianggap stale. Ini
      // penting ketika HP membuat koneksi baru tetapi PC masih menyimpan
      // objek DataConnection lama sebagai open.
      const stale =
        !existing.__lastPresence || Date.now() - existing.__lastPresence > 2500;
      // Jika peer lawan datang membawa koneksi baru, jalur masuk itu harus
      // menggantikan jalur lama yang mungkin hanya tampak open di sisi ini.
      // Tanpa ini, pengirim dapat menunggu sampai refresh membuang jalur lama.
      const keep = next.__incoming
        ? next
        : stale && !existing.open
          ? next
          : keepIncoming
            ? next.__incoming
              ? next
              : existing
            : next.__incoming
              ? existing
              : next;
      if (keep === existing) {
        try {
          next.close();
        } catch {}
        return;
      }
      try {
        existing.close();
      } catch {}
      readyConnections.delete(existing);
    }
    connections.set(next.peer, next);
    const detectRoute = async () => {
      const pc = next.peerConnection;
      if (!pc?.getStats) return false;
      try {
        const stats = await pc.getStats();
        let selected = null;
        let selectedId = null;
        stats.forEach((item) => {
          if (item.type === "transport" && item.selectedCandidatePairId) selectedId = item.selectedCandidatePairId;
          if (item.type === "candidate-pair" && (item.selected || item.nominated) && item.state === "succeeded") selected = item;
        });
        if (!selected && selectedId) selected = stats.get(selectedId);
        if (!selected) return false;
        const local = stats.get(selected.localCandidateId);
        const remote = stats.get(selected.remoteCandidateId);
        const relay = local?.candidateType === "relay" || remote?.candidateType === "relay";
        const route = relay ? "TURN" : "Direct WebRTC";
        routeByPeer.set(next.peer, route);
        window.dispatchEvent(new CustomEvent("callme:p2p-route", { detail: { peerId: next.peer, route } }));
        return true;
      } catch { return false; }
    };
    const detectRouteUntilReady = () => {
      let attempts = 0;
      const retry = async () => {
        if (await detectRoute() || attempts++ >= 20 || !connections.has(next.peer)) return;
        setTimeout(retry, 300);
      };
      void retry();
    };
    next.on("open", () => {
      if (connections.get(next.peer) !== next) return;
      const self = normalizePeerIdentity(
        sessionStorage.getItem("callme-v2-session-user") ||
          localStorage.getItem("callme-v2-user") ||
          "",
      );
      const other = normalizePeerIdentity(next.peer);
      next.__callmeRoom = [self, other].sort().join("::");
      try {
        next.send({ type: "hello", user: self, room: next.__callmeRoom });
      } catch {}
      // Status online dikirim setelah hello/hello-ack, bukan saat DataChannel
      // baru terbuka.
      const queue = pending.get(next.peer) || [];
      while (queue.length && next.open) next.send(queue.shift());
      pending.delete(next.peer);
    });
    next.on("data", (data) => {
      if (connections.get(next.peer) !== next) return;
      if (data?.kind === "presence-ping") {
        const visible = document.visibilityState !== "hidden";
        next.send({
          kind: "presence-pong",
          awake: visible,
          // Hanya layar login berarti pengguna belum masuk. Tampilan friends
          // adalah kondisi normal saat aplikasi aktif dan siap menerima call.
          active: visible && (typeof window.CallMeApp?.current !== "function" || window.CallMeApp.current() !== "login"),
        });
        return;
      }
      if (data?.type === "hello" || data?.type === "hello-ack") {
        const self = normalizePeerIdentity(
          sessionStorage.getItem("callme-v2-session-user") ||
            localStorage.getItem("callme-v2-user") ||
            "",
        );
        const other = normalizePeerIdentity(data.user || next.peer);
        const room = [self, other].sort().join("::");
        if (!self || !other || data.room !== room || other === self) {
          try {
            next.close();
          } catch {}
          return;
        }
        next.__callmeRoom = room;
        readyConnections.add(next);
        next.__lastPresence = Date.now();
        if (data.type === "hello")
          try {
            next.send({ type: "hello-ack", user: self, room });
          } catch {}
        try { next.send({ kind: "presence-ping" }); } catch {}
        window.dispatchEvent(
          new CustomEvent("callme:p2p-status", {
            detail: { peerId: next.peer, status: "online" },
          }),
        );
        detectRouteUntilReady();
        return;
      }
      if (data?.kind === "presence-pong") {
        next.__lastPresence = Date.now();
        clearTimeout(presenceTimers.get(next.peer));
        presenceTimers.delete(next.peer);
        window.dispatchEvent(
          new CustomEvent("callme:presence-pong", {
            detail: { peerId: next.peer, awake: data.awake === true, active: data.active === true },
          }),
        );
        return;
      }
      if (data?.kind === "file-chunk-ack") {
        window.dispatchEvent(
          new CustomEvent("callme:file-chunk-ack", {
            detail: { id: data.id, index: data.index, peerId: next.peer },
          }),
        );
        return;
      }
      if (data?.kind === "file-complete-ack") {
        window.dispatchEvent(
          new CustomEvent("callme:file-complete-ack", {
            detail: { id: data.id, peerId: next.peer },
          }),
        );
        return;
      }
      if (data?.kind === "file-cancel") {
        const bucket = mediaParts.get(data.id);
        if (bucket?.timer) clearTimeout(bucket.timer);
        mediaParts.delete(data.id);
        completedFiles.delete(data.id);
        return;
      }
      if (blocked().includes(next.peer)) return;
      if (data?.kind === "delete-message") {
        document
          .querySelector(`[data-message-id="${CSS.escape(data.id)}"]`)
          ?.remove();
        return;
      }
      if (data?.kind === "message-ack") {
        const waiter = ackWaiters.get(data.id);
        if (waiter && waiter.peerId === next.peer) {
          clearTimeout(waiter.timer);
          ackWaiters.delete(data.id);
          waiter.resolve(true);
        }
        window.dispatchEvent(
          new CustomEvent("callme:message-ack", {
            detail: { id: data.id, peerId: next.peer },
          }),
        );
        return;
      }
      // Protokol kompatibel dengan Blogspot: {type:file, i, total, part}.
      if (data?.type === "file" && typeof data.part === "string") {
        const declaredTotal = Number(data.total),
          declaredIndex = Number(data.i),
          part = data.part;
        // Batasi envelope agar WebView tidak menerima paket yang dapat
        // menghabiskan memori atau membuat array chunk tidak terkontrol.
        if (
          typeof data.id !== "string" ||
          !data.id ||
          !Number.isSafeInteger(declaredTotal) ||
          declaredTotal < 1 ||
          declaredTotal > 100000 ||
          !Number.isSafeInteger(declaredIndex) ||
          declaredIndex < 0 ||
          declaredIndex >= declaredTotal ||
          part.length > 40000 ||
          (data.roomId && data.roomId !== next.__callmeRoom)
        )
          return;
        const completedAt = completedFiles.get(data.id);
        if (completedAt && Date.now() - completedAt < 300000) {
          try {
            next.send({ kind: "file-complete-ack", id: data.id });
          } catch {}
          return;
        }
        if (completedAt) completedFiles.delete(data.id);
        const index = Number(data.i),
          bucket = mediaParts.get(data.id) || {
            parts: [],
            received: 0,
            total: declaredTotal,
            originalKind: String(data.mime || "").startsWith("audio/")
              ? "audio"
              : "media",
          };
        if (
          bucket.total !== declaredTotal ||
          bucket.total !== Number(data.total) ||
          index !== declaredIndex
        )
          return;
        if (typeof bucket.parts[index] !== "string") {
          bucket.parts[index] = data.part;
          bucket.received++;
        }
        // Konfirmasi per chunk. DataChannel reliable tetap dapat kehilangan
        // state di WebView ketika antrean besar atau koneksi berganti; ACK ini
        // membuat pengirim hanya maju setelah chunk benar-benar diterima.
        try {
          next.send({
            kind: "file-chunk-ack",
            id: data.id,
            index,
            total: bucket.total,
          });
        } catch {}
        window.dispatchEvent(
          new CustomEvent("callme:file-chunk-ack", {
            detail: { id: data.id, index, peerId: next.peer },
          }),
        );
        mediaParts.set(data.id, bucket);
        window.dispatchEvent(
          new CustomEvent("callme:file-receive-progress", {
            detail: {
              id: data.id,
              name: data.name,
              received: bucket.received,
              total: bucket.total,
            },
          }),
        );
        clearTimeout(bucket.timer);
        bucket.timer = setTimeout(() => mediaParts.delete(data.id), 300000);
        if (bucket.received < bucket.total) return;
        clearTimeout(bucket.timer);
        mediaParts.delete(data.id);
        data = {
          ...data,
          kind: bucket.originalKind,
          source: bucket.parts.join(""),
        };
        delete data.type;
        delete data.i;
        delete data.total;
        delete data.part;
        const completedAtForCleanup = Date.now();
        completedFiles.set(data.id, completedAtForCleanup);
        setTimeout(() => {
          if (completedFiles.get(data.id) === completedAtForCleanup)
            completedFiles.delete(data.id);
        }, 300000);
        const row = { ...data, senderPeerId: next.peer, mine: false, createdAt: data.createdAt || Date.now() };
        const save = window.CallMeStorage?.put?.("messages", row);
        const acknowledge = () => {
          try { if (next.open) next.send({ kind: "file-complete-ack", id: data.id }); } catch {}
        };
        if (save && typeof save.then === "function") save.then(acknowledge, acknowledge);
        else acknowledge();
      }
      if (data?.kind === "media-chunk") {
        const bucket = mediaParts.get(data.id) || {
          parts: [],
          received: 0,
          total: data.total,
          originalKind: data.originalKind || "media",
        };
        if (
          bucket.total !== data.total ||
          data.index < 0 ||
          data.index >= data.total
        )
          return;
        if (typeof bucket.parts[data.index] !== "string") {
          bucket.parts[data.index] = data.part;
          bucket.received++;
        }
        mediaParts.set(data.id, bucket);
        window.dispatchEvent(
          new CustomEvent("callme:file-receive-progress", {
            detail: {
              id: data.id,
              name: data.name,
              received: bucket.received,
              total: bucket.total,
            },
          }),
        );
        clearTimeout(bucket.timer);
        bucket.timer = setTimeout(() => mediaParts.delete(data.id), 300000);
        if (bucket.received < bucket.total) return;
        clearTimeout(bucket.timer);
        mediaParts.delete(data.id);
        data = {
          ...data,
          kind: bucket.originalKind,
          source: bucket.parts.join(""),
        };
        delete data.index;
        delete data.total;
        delete data.part;
      }
      if (data?.id && data.kind !== "media" && data.kind !== "audio") {
        const ack = { kind: "message-ack", id: data.id };
        const sendAck = () => {
          try { if (next.open) next.send(ack); } catch {}
        };
        if (data.kind === "text" || data.kind === "call-log") {
          const row = { ...data, senderPeerId: next.peer, mine: false, createdAt: data.createdAt || Date.now() };
          const save = window.CallMeStorage?.put?.("messages", row);
          if (save && typeof save.then === "function") save.then(sendAck, sendAck);
          else sendAck();
        } else sendAck();
      }
      const message = { ...data, senderPeerId: next.peer };
      window.dispatchEvent(
        new CustomEvent("callme:p2p-message", { detail: message }),
      );
      listeners.forEach((listener) => listener(message));
    });
    next.on("close", () => {
      clearTimeout(presenceTimers.get(next.peer));
      presenceTimers.delete(next.peer);
      readyConnections.delete(next);
      // Event dari koneksi lama tidak boleh menimpa status koneksi pengganti.
      if (connections.get(next.peer) !== next) return;
      connections.delete(next.peer);
      routeByPeer.delete(next.peer);
      for (const [id, waiter] of ackWaiters) {
        if (waiter.peerId !== next.peer) continue;
        clearTimeout(waiter.timer);
        ackWaiters.delete(id);
        waiter.resolve(false);
      }
      window.dispatchEvent(
        new CustomEvent("callme:p2p-status", {
          detail: { peerId: next.peer, status: "offline" },
        }),
      );
    });
    // Satu paket yang gagal tidak berarti room terputus. PeerJS biasanya
    // mengirim event close bila DataConnection benar-benar berakhir; hanya
    // close yang boleh memicu pencarian ulang.
    next.on("error", (error) => {
      if (connections.get(next.peer) !== next) return;
      readyConnections.delete(next);
      window.dispatchEvent(
        new CustomEvent("callme:p2p-error", {
          detail: { peerId: next.peer, error },
        }),
      );
    });
  }
  function connect(peerId, allowStandby = false) {
    if (!allowStandby && window.CallMeApp?.current?.() === "friends") return null;
    if (!peer || !peerId) return null;
    const identity = normalizePeerIdentity(peerId);
    const id = `cm-${identity}`,
      existing = connections.get(id);
    if (existing?.open) {
      if (!readyConnections.has(existing)) return existing;
      try {
        existing.send({ kind: "presence-ping" });
      } catch {}
      clearTimeout(presenceTimers.get(id));
      presenceTimers.set(
        id,
        setTimeout(() => {
          if (connections.get(id) !== existing || !existing.open) return;
          try {
            existing.close();
          } catch {}
          readyConnections.delete(existing);
          if (connections.get(id) === existing) connections.delete(id);
          window.dispatchEvent(
            new CustomEvent("callme:p2p-status", {
              detail: {
                peerId: id,
                status: "offline",
                reason: "presence-timeout",
              },
            }),
          );
        }, 10000),
      );
      return existing;
    }
    if (
      existing &&
      !existing.open &&
      Date.now() - (existing.__createdAt || 0) < 8000
    )
      return existing;
    // Koneksi pending yang tidak pernah terbuka (mis. tujuan tidak ada di
    // server sehingga PeerJS hanya memancarkan EXPIRE tanpa menutup
    // koneksi) harus dibuang agar chatroom bisa mencoba ulang tanpa refresh.
    if (existing && !existing.open) {
      try {
        existing.close();
      } catch {}
      readyConnections.delete(existing);
      if (connections.get(id) === existing) connections.delete(id);
    }
    const next = peer.connect(id, { reliable: true });
    // PeerJS mengembalikan undefined saat peer sedang terputus dari server.
    if (!next) return null;
    next.__incoming = false;
    next.__createdAt = Date.now();
    attach(next);
    return next;
  }
  async function send(data, peerId) {
    const self =
        sessionStorage.getItem("callme-v2-session-user") ||
        localStorage.getItem("callme-v2-user") ||
        "",
      parts = String(data?.roomId || "").split("::"),
      rawTarget = String(
        peerId || data?.peerId || parts.find((id) => id && id !== self) || "",
      ),
      identity = normalizePeerIdentity(rawTarget);
    const target = `cm-${identity}`,
      next =
        connections.get(target)?.open &&
        readyConnections.has(connections.get(target))
          ? connections.get(target)
          : [...connections.values()].find(
              (item) =>
                item?.peer === target &&
                item?.open &&
                readyConnections.has(item),
            );
    if (!next) {
      window.dispatchEvent(
        new CustomEvent("callme:p2p-send-wait", {
          detail: { peerId: target, id: data?.id },
        }),
      );
      if (identity) connect(identity);
      return false;
    }
    try {
      // Biarkan PeerJS/WebRTC mengatur antrean internal seperti pada
      // callme-single.txt. Tidak ada timeout bufferedAmount buatan aplikasi.
      next.send(data);
      return true;
    } catch (error) {
      try {
        next.close();
      } catch {}
      readyConnections.delete(next);
      if (connections.get(target) === next) connections.delete(target);
      window.dispatchEvent(
        new CustomEvent("callme:p2p-error", { detail: error }),
      );
      return false;
    }
  }
  function sendCallControl(data, peerId) {
    const identity = normalizePeerIdentity(peerId), target = `cm-${identity}`;
    if (!identity) return false;
    const existing = connections.get(target);
    if (existing?.open && readyConnections.has(existing)) {
      try { existing.send(data); return true; } catch {}
    }
    // Hangup hanya berlaku untuk sesi yang masih berlangsung. Jangan antrekan
    // untuk kanal berikutnya, karena dapat menutup panggilan selanjutnya.
    if (data?.kind === "call-hangup") return false;
    const queue = pending.get(target) || [];
    queue.push(data);
    pending.set(target, queue);
    connect(identity, true);
    return false;
  }
  function disconnect(peerId) {
    const identity = normalizePeerIdentity(peerId);
    const id = `cm-${identity}`;
    const connection = connections.get(id);
    routeByPeer.delete(id);
    if (connection) connection.close();
    clearTimeout(presenceTimers.get(id));
    presenceTimers.delete(id);
    connections.delete(id);
  }
  function waitForAck(messageId, peerId) {
    cancelAck(messageId);
    const identity = normalizePeerIdentity(peerId);
    return new Promise((resolve) => {
      const waiter = {
        peerId: `cm-${identity}`,
        resolve,
        timer: null,
      };
      ackWaiters.set(messageId, waiter);
    });
  }
  function armAckTimeout(messageId, timeout = 300000) {
    const waiter = ackWaiters.get(messageId);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    waiter.timer = setTimeout(() => {
      ackWaiters.delete(messageId);
      waiter.resolve(false);
    }, timeout);
  }
  function cancelAck(messageId) {
    const waiter = ackWaiters.get(messageId);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    ackWaiters.delete(messageId);
    waiter.resolve(false);
  }
  function call(peerId, stream, metadata) {
    if (!peer || !peerId) return null;
    const raw = String(peerId).trim().replace(/^cm-/i, "");
    const identity = window.CallMeApp?.normalize?.(raw) || raw.toLowerCase();
    return peer.call(`cm-${identity}`, stream, { metadata: metadata || {} });
  }
  function stop() {
    clearTimeout(registerTimer);
    clearTimeout(peerOpenTimer);
    peerOpenTimer = null;
    registerTimer = null;
    idConflictRetries = 0;
    lastIdentity = "";
    connections.forEach((item) => item.close());
    for (const timer of presenceTimers.values()) clearTimeout(timer);
    presenceTimers.clear();
    connections.clear();
    routeByPeer.clear();
    sessionStopping = true;
    if (peer) peer.__disposed = true;
    peer?.destroy();
    peer = null;
    serverStatus = "idle";
    pending.clear();
    mediaParts.forEach((bucket) => clearTimeout(bucket.timer));
    mediaParts.clear();
    completedFiles.clear();
    for (const id of ackWaiters.keys()) cancelAck(id);
  }
  function isConnected(peerId) {
    const identity = normalizePeerIdentity(peerId);
    const connection = connections.get(`cm-${identity}`);
    return Boolean(connection?.open && readyConnections.has(connection));
  }
  function probe(peerId, timeout = 3000) {
    const identity = normalizePeerIdentity(peerId), target = `cm-${identity}`;
    if (!identity || target === peer?.id) return Promise.resolve(false);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (active) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        window.removeEventListener("callme:presence-pong", onPong);
        window.removeEventListener("callme:p2p-status", onStatus);
        // Tidak menyimpan DataConnection yang gagal menjawab presence:
        // kanal lama yang tampak open sering menghalangi panggilan berikutnya.
        if (!active && (isConnected(identity) || hasConnection(identity)))
          disconnect(identity);
        resolve(active);
      };
      const ping = () => {
        const connection = connections.get(target);
        if (!connection?.open || !readyConnections.has(connection)) return false;
        try {
          connection.send({ kind: "presence-ping" });
          return true;
        } catch {
          return false;
        }
      };
      const onPong = (event) => {
        if (event.detail?.peerId !== target) return;
        finish(event.detail.awake === true && event.detail.active === true);
      };
      const onStatus = (event) => {
        if (normalizePeerIdentity(event.detail?.peerId) !== identity) return;
        if (event.detail?.status === "online" && isConnected(identity)) ping();
        else if (event.detail?.status === "offline") finish(false);
      };
      const timer = setTimeout(() => finish(false), timeout);
      window.addEventListener("callme:presence-pong", onPong);
      window.addEventListener("callme:p2p-status", onStatus);
      if (isConnected(identity)) {
        if (!ping()) finish(false);
      } else if (!connect(identity, true)) {
        finish(false);
      }
    });
  }
  function hasConnection(peerId) {
    const identity = normalizePeerIdentity(peerId);
    const connection = connections.get(`cm-${identity}`);
    return Boolean(
      connection &&
        (connection.open ||
          connection.state === "connecting" ||
          connection.readyState === "connecting"),
    );
  }
  function isPeerReady() {
    return Boolean(peer && !peer.destroyed && peer.open && peer.id);
  }
  async function testTurn(target) {
    const self = normalizePeerIdentity(lastIdentity || sessionStorage.getItem("callme-v2-session-user"));
    const other = normalizePeerIdentity(target);
    if (!/^(aurora|riacaya)$/.test(self) || !/^(aurora|riacaya)$/.test(other) || self === other) throw new Error("Uji TURN hanya untuk Aurora dan Riacaya.");
    if (typeof Peer !== "function") throw new Error("PeerJS belum tersedia.");
    const testSelf = `cm-test-${self}`;
    const testOther = `cm-test-${other}`;
    const testPeer = new Peer(testSelf, { debug: 0, config: { iceServers: TURN_SERVERS, iceTransportPolicy: "relay", sdpSemantics: "unified-plan" } });
    const cleanup = () => { try { testPeer.destroy(); } catch {} };
    // Jendela 30 detik + percobaan ulang otomatis: uji harus berhasil dengan
    // urutan klik bebas (siapa pun yang menekan duluan) tanpa refresh.
    const WINDOW_MS = 30000;
    try {
      if (self === "aurora") {
        await new Promise((resolve, reject) => {
          let settled = false;
          const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
          const timer = setTimeout(() => finish(reject, new Error("Menunggu koneksi dari cm-test-riacaya timeout.")), WINDOW_MS);
          // Pasang SEMUA listener sebelum menunggu: mendaftarkan listener
          // "connection" setelah event "open" membuka celah koneksi hilang
          // bila sisi penghubung sudah menekan lebih dulu.
          testPeer.on("error", (error) => finish(reject, new Error(error?.type || error?.message || "Peer test gagal")));
          testPeer.on("connection", (connection) => {
            connection.on("data", (data) => {
              if (data?.kind !== "TURN_TEST") return;
              try { connection.send({ kind: "TURN_ACK", id: data.id }); } catch {}
              finish(resolve, true);
            });
          });
        });
      } else {
        await new Promise((resolve, reject) => {
          let settled = false, connection = null, timer = null;
          const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); fn(value); };
          const deadline = Date.now() + WINDOW_MS;
          const attempt = () => {
            clearTimeout(timer);
            if (settled) return;
            if (connection) { try { connection.close(); } catch {} }
            connection = testPeer.connect(testOther, { reliable: true });
            connection.on("open", () => { try { connection.send({ kind: "TURN_TEST", id: `turn-test-${Date.now()}` }); } catch {} });
            connection.on("data", (data) => { if (data?.kind === "TURN_ACK") finish(resolve, true); });
            // Tiap percobaan diberi waktu 4 detik; EXPIRE (lawan belum
            // mendaftar) tidak menutup koneksi PeerJS, jadi kita ulangi sendiri.
            timer = setTimeout(() => {
              if (settled) return;
              if (Date.now() >= deadline) { finish(reject, new Error("Koneksi test TURN timeout.")); return; }
              attempt();
            }, 4000);
          };
          testPeer.on("error", (error) => {
            // Lawan belum ada / WebRTC gagal adalah kondisi normal saat
            // percobaan ulang; jangan gagalkan seluruh uji.
            if (error?.type === "peer-unavailable" || error?.type === "webrtc") return;
            finish(reject, new Error(error?.type || error?.message || "Peer test gagal"));
          });
          attempt();
        });
      }
      return true;
    } finally { cleanup(); }
  }
  function getRoute(peerId) {
    return routeByPeer.get(`cm-${normalizePeerIdentity(peerId)}`) || "";
  }
  window.CallMeTransport = {
    start,
    connect,
    disconnect,
    send,
    sendCallControl,
    waitForAck,
    armAckTimeout,
    cancelAck,
    call,
    stop,
    on(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getId() {
      return peer?.id || null;
    },
    getStatus() {
      return serverStatus;
    },
    isConnected,
    probe,
    hasConnection,
    isPeerReady,
    getRoute,
    testTurn,
  };
})();
