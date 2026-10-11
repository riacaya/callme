(function () {
  document.addEventListener("DOMContentLoaded", () => {
    let stream = null,
      currentCall = null,
      pendingIncoming = null,
      callEnded = true,
      callSession = null,
      // Sisi penerima sudah mengirim stream (maka putar ulang harus berhenti).
      remoteReceived = false;
    const panel = (mode) =>
      document.querySelector(`[data-panel="${mode}-call"]`);
    const setChatCallButtonsHidden = (hidden) => {
      document.querySelectorAll('[data-panel="chatroom"] [data-call]')
        .forEach((button) => { button.hidden = hidden; });
    };
    const setMediaSource = (element, mediaStream) => {
      element.srcObject = mediaStream;
      element.autoplay = true;
      element.playsInline = true;
      element.play?.().catch(() => {});
    };
    const roomIdForPeer = (peerId) => {
      const localId = sessionStorage.getItem("callme-v2-session-user") ||
        localStorage.getItem("callme-v2-user") || "";
      try { return window.CallMeIdentity.roomId(localId, peerId); } catch { return ""; }
    };
    const createCallLog = async (peerId, callType, direction) => {
      const roomId = roomIdForPeer(peerId);
      if (!roomId) return null;
      if (direction === "outgoing" && callEnded) return null;
      const row = { id: window.CallMeApp.uid(), kind: "call-log", callType, direction, status: "started", roomId, mine: true, createdAt: Date.now() };
      await window.CallMeStorage?.put?.("messages", row);
      window.dispatchEvent(new CustomEvent("callme:call-log", { detail: row }));
      return row;
    };
    const saveIncomingCallLog = async (peerId, callType, logId, status = "started") => {
      const roomId = roomIdForPeer(peerId);
      if (!roomId) return null;
      const identity = window.CallMeIdentity?.withoutPeerPrefix?.(peerId) || String(peerId || "").replace(/^cm-/i, "").toLowerCase();
      const contacts = (await window.CallMeStorage?.all?.("contacts")) || [];
      if (!contacts.some((contact) => (window.CallMeIdentity?.withoutPeerPrefix?.(contact.peerId) || String(contact.peerId || "").replace(/^cm-/i, "").toLowerCase()) === identity)) {
        await window.CallMeStorage?.put?.("contacts", { peerId: identity, phone: identity, display_name: identity, profile_photo: "", email: "", savedAt: Date.now() });
        await window.CallMeStorage?.remove?.("settings", `deleted-contact:${identity}`);
        window.dispatchEvent(new CustomEvent("callme:contacts-updated"));
      }
      const row = { id: logId || window.CallMeApp.uid(), kind: "call-log", callType, direction: "incoming", status, roomId, mine: false, createdAt: Date.now() };
      await window.CallMeStorage?.put?.("messages", row);
      window.dispatchEvent(new CustomEvent("callme:call-log", { detail: row }));
      return row;
    };
    window.addEventListener("callme:fcm-call-declined-local", async (event) => {
      const detail = event.detail || {};
      if (!detail.peer) return;
      window.__callmeDeclinedCall = null;
      const mode = detail.video ? "video" : "voice";
      await saveIncomingCallLog(detail.peer, mode, detail.callLogId || "", "rejected");
      window.__callmeAutoAnswerPeer = "";
    });
    if (window.__callmeDeclinedCall) {
      const detail = window.__callmeDeclinedCall;
      window.__callmeDeclinedCall = null;
      if (detail.peer)
        void saveIncomingCallLog(detail.peer, detail.video ? "video" : "voice", detail.callLogId || "", "rejected");
    }
    const updateCallLog = async (id, peerId, status) => {
      if (!id) return;
      const rows = (await window.CallMeStorage?.all?.("messages")) || [];
      const current = rows.find((row) => row.id === id);
      if (current) {
        const updated = { ...current, status };
        await window.CallMeStorage?.put?.("messages", updated);
        window.dispatchEvent(new CustomEvent("callme:call-log", { detail: updated }));
      }
      window.CallMeP2P?.send?.({ kind: "call-log", id, status, roomId: roomIdForPeer(peerId) }, peerId);
    };
    const captureLocalStream = async (mode, status) => {
      try {
        return await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: mode === "video",
        });
      } catch (error) {
        if (mode !== "video") throw error;
        const audioOnly = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        status.textContent = "Menghubungkan video lawan...";
        return audioOnly;
      }
    };
    const bindRemoteStream = (element, mediaStream, status) => {
      setMediaSource(element, mediaStream);
      element.closest(".video-call-stage")?.querySelector("#video-call-name")?.toggleAttribute("hidden", true);
      element.closest(".video-call-stage")?.querySelector(".video-call-avatar")?.setAttribute("hidden", "");
      element.muted = false;
      status.textContent = "Tersambung";
    };
    const setCallNameVisible = (view, visible) => {
      view?.querySelector('[id$="-call-name"]')?.toggleAttribute("hidden", !visible);
    };
    const findContactForPeer = async (peerId) => {
      const identity = window.CallMeIdentity?.withoutPeerPrefix?.(peerId) ||
        String(peerId || "").replace(/^cm-/i, "").toLowerCase();
      const contacts = (await window.CallMeStorage?.all?.("contacts")) || [];
      return contacts.find((row) => {
        const rowId = window.CallMeIdentity?.withoutPeerPrefix?.(row.peerId) ||
          String(row.peerId || "").replace(/^cm-/i, "").toLowerCase();
        return rowId === identity;
      });
    };
    const refreshContactProfile = async (peerId) => {
      const identity = window.CallMeIdentity?.withoutPeerPrefix?.(peerId) ||
        String(peerId || "").replace(/^cm-/i, "").toLowerCase();
      const cached = await findContactForPeer(identity);
      const refresh = async () => {
        try {
          const row = await window.CallMeProfileRepository?.syncContact?.(
            identity,
            sessionStorage.getItem("callme-v2-session-user") || identity,
            sessionStorage.getItem("callme-v2-session-token") || "",
          );
          if (row) window.dispatchEvent(new CustomEvent("callme:profile-updated", { detail: { peerId: identity, data: row } }));
          return row;
        } catch (error) {
          console.warn("Profil panggilan gagal disinkronkan", identity, error);
          return cached;
        }
      };
      // Cache lokal dipakai langsung. Server hanya menyegarkan background.
      if (cached) {
        void refresh();
        return cached;
      }
      return refresh();
    };
    const displayNameForPeer = async (peerId) => {
      const contact = await refreshContactProfile(peerId);
      return contact?.display_name || contact?.name ||
        window.CallMeIdentity?.withoutPeerPrefix?.(peerId) ||
        String(peerId || "").replace(/^cm-/i, "").toLowerCase() ||
        "Panggilan masuk";
    };
    const setVoiceAvatar = async (peerId) => {
      const avatar = document.getElementById("voice-avatar");
      if (!avatar) return;
      const contact = await refreshContactProfile(peerId);
      const image = document.createElement("img");
      image.src = contact?.profile_photo || window.CallMeChatUtils?.defaultAvatar || "";
      image.alt = contact?.display_name || contact?.phone || String(peerId || "");
      image.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%";
      avatar.replaceChildren(image);
    };
    const setVideoAvatar = async (peerId, view) => {
      if (!view) return;
      const name = view.querySelector("#video-call-name");
      if (name) name.style.cssText = "position:absolute;z-index:3;top:calc(50% + 78px);left:12px;right:12px;text-align:center;color:#fff;text-shadow:0 1px 3px #000;font-size:18px";
      let avatar = view.querySelector(".video-call-avatar");
      if (!avatar) {
        avatar = document.createElement("div");
        avatar.className = "video-call-avatar";
        avatar.style.cssText = "position:absolute;z-index:2;top:50%;left:50%;transform:translate(-50%,-50%);width:132px;height:132px;border-radius:50%;overflow:hidden;background:#fff";
        view.querySelector(".video-call-stage")?.append(avatar);
      }
      const contact = await refreshContactProfile(peerId);
      const image = document.createElement("img");
      image.src = contact?.profile_photo || window.CallMeChatUtils?.defaultAvatar || "";
      image.alt = contact?.display_name || contact?.phone || String(peerId || "");
      image.style.cssText = "width:100%;height:100%;object-fit:cover";
      avatar.replaceChildren(image);
      avatar.hidden = false;
    };
    const activateCallRoom = async (peerId) => {
      if (!peerId) return false;
      for (let attempt = 0; attempt < 20; attempt++) {
        if (typeof window.CallMeChat?.open === "function") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (typeof window.CallMeChat?.open !== "function") return false;
      const contact = await refreshContactProfile(peerId);
      const friend = contact || {
        peerId: String(peerId || "").replace(/^cm-/i, ""),
        display_name: "",
      };
      await window.CallMeChat?.open?.(friend);
      return true;
    };
    const finish = (notify = true) => {
      if (callEnded) return;
      const session = callSession,
        callWasProcessed =
          session?.kind === "outgoing" ||
          (session?.kind === "incoming" && session.accepted),
        returnPanel = session?.returnPanel || "friends";
      callEnded = true;
      if (session?.answerTimer) clearTimeout(session.answerTimer);
      remoteReceived = false;
      const
        call = currentCall || pendingIncoming?.incoming,
        target = call?.peer || window.CallMeChat?.activePeer?.();
      if (!call && !currentCall && !pendingIncoming) {
        setChatCallButtonsHidden(false);
        callSession = null;
        window.CallMeApp.show(returnPanel);
        return;
      }
      if (notify && target)
        window.CallMeP2P?.sendCallControl?.({ kind: "call-hangup" }, target);
      if (session?.kind === "incoming" && !session.accepted && !session.rejected && session.logId && target)
        updateCallLog(session.logId, target, "missed");
      currentCall = null;
      pendingIncoming = null;
      try {
        call?.close();
      } catch {}
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
      setChatCallButtonsHidden(false);
      const hasActiveRoom = Boolean(window.CallMeChat?.activePeer?.());
      if (callWasProcessed && hasActiveRoom)
        window.CallMeApp.show("chatroom");
      else window.CallMeApp.show(returnPanel);
      callSession = null;
    };
    const setIncomingControls = (view, incoming) => {
      view?.querySelector("[data-call-accept]")?.toggleAttribute("hidden", !incoming);
    };
    // P2P media dimulai setelah status penerima aktif atau setelah Jawab FCM.
    const startOutgoingP2P = async (mode, target) => {
      if (callEnded || callSession?.kind !== "outgoing" || callSession.peerId !== target) return;
      const view = panel(mode),
        local = mode === "video" ? view?.querySelector("#video-local") : view?.querySelector("audio"),
        remote = mode === "video" ? view?.querySelector("#video-remote") : local,
        status = view?.querySelector('[id$="-call-status"]');
      if (!view || !local || !status) return;
      try {
        stream = await captureLocalStream(mode, status);
        if (callEnded || callSession?.peerId !== target) return;
        setMediaSource(local, stream);
        if (local !== remote) local.muted = true;
        status.textContent = "Menghubungkan...";
        const attempt = window.CallMeP2P?.call(target, stream, {
          video: mode === "video",
          callLogId: callSession?.logId,
        });
        if (!attempt) {
          status.textContent = "Panggilan gagal dimulai";
          return;
        }
        currentCall = attempt;
        attempt.on("stream", (incoming) => {
          remoteReceived = true;
          bindRemoteStream(remote, incoming, status);
        });
        attempt.on("close", () => {
          if (currentCall === attempt) finish(false);
        });
        attempt.on("error", () => { status.textContent = "Panggilan gagal"; });
      } catch (error) {
        status.textContent = "Media gagal: " + (error?.name || "error");
      }
    };
    async function open(mode) {
      const view = panel(mode),
        local =
          mode === "video"
            ? view?.querySelector("#video-local")
            : view?.querySelector("audio"),
        remote =
          mode === "video" ? view?.querySelector("#video-remote") : local,
        target = window.CallMeChat?.activePeer?.();
      if (!view || !local || !target) return;
      callEnded = false;
      remoteReceived = false;
      callSession = { kind: "outgoing", peerId: target, mode, returnPanel: "chatroom", accepted: true, logId: null };
      setChatCallButtonsHidden(true);
      window.CallMeApp.show(`${mode}-call`);
      const status = view.querySelector('[id$="-call-status"]'),
        name = view.querySelector(`#${mode}-call-name`);
      setIncomingControls(view, false);
      setCallNameVisible(view, true);
      if (name)
        name.textContent =
          document.getElementById("chat-title")?.textContent ||
          window.CallMeIdentity?.withoutPeerPrefix?.(target) || target;
      // Sumber nama harus sama dengan jalur masuk: profil contact lebih dulu,
      // lalu fallback Peer ID. Jangan menimpa setelah sesi diganti/berakhir.
      void displayNameForPeer(target).then((label) => {
        if (callSession?.kind === "outgoing" && callSession?.peerId === target && name)
          name.textContent = label;
      });
      if (mode === "voice") void setVoiceAvatar(target);
      // Ikon besar + nama panggilan video kini juga tampil di sisi pemanggil,
      // sama seperti sisi penerima.
      if (mode === "video") void setVideoAvatar(target, view);
      // Buat ID log sebelum media/FCM dimulai supaya status Jawab/Tolak
      // selalu memperbarui baris yang sama di kedua sisi.
      const log = await createCallLog(target, mode, "outgoing");
      if (callSession?.kind !== "outgoing" || callSession.peerId !== target) return;
      callSession.logId = log?.id || null;
      // Satu-satunya deteksi sebelum panggilan: koneksi data PeerJS aktif.
      // Jika aktif, langsung satu P2P. Jika tidak, jangan mulai P2P;
      // kirim FCM dan tunggu Jawab/Tolak.
      if (window.CallMeP2P?.isConnected?.(target)) {
        void startOutgoingP2P(mode, target);
      } else {
        callSession.waitingForAnswer = true;
        status.textContent = "Menunggu jawaban...";
        window.CallMePush?.call?.(target, mode === "video");
        callSession.answerTimer = setTimeout(() => {
          if (callSession?.kind !== "outgoing" || !callSession.waitingForAnswer) return;
          callSession.waitingForAnswer = false;
          if (callSession.logId) void updateCallLog(callSession.logId, target, "missed");
          finish(false);
        }, 60000);
      }
    }
    document
      .querySelectorAll("[data-call]")
      .forEach((button) =>
        button.addEventListener("click", () => open(button.dataset.call)),
      );
    document
      .querySelectorAll("[data-call-reject]")
      .forEach((button) =>      button.addEventListener("click", async () => {
        const incoming = pendingIncoming?.incoming;
        if (incoming) await activateCallRoom(incoming.peer || incoming.peerId);
        if (incoming && pendingIncoming?.incoming !== incoming) return;
        if (incoming) {
          if (callSession?.logId)
            updateCallLog(callSession.logId, incoming.peer, "rejected");
          if (callSession) callSession.rejected = true;
        }
        window.CallMeAndroid?.cancelCall?.();
        finish();
      }));
    document.querySelectorAll("[data-call-accept]").forEach((button) => {
      button.innerHTML = '<img src="https://api.iconify.design/material-symbols/call.svg?color=%23fff" alt="">';
      button.querySelector("img").style.cssText = "width:28px;height:28px;display:block";
    });
    document.querySelectorAll("[data-call-accept]").forEach((button) =>
      button.addEventListener("click", async () => {
        if (!pendingIncoming || button.dataset.callAccept !== pendingIncoming.mode)
          return;
        const { incoming, mode } = pendingIncoming;
        if (callSession) callSession.accepted = true;
        await activateCallRoom(incoming.peer || incoming.peerId);
        if (pendingIncoming?.incoming !== incoming) return;
        pendingIncoming = null;
        if (callSession) callSession.accepted = true;
        // Panggilan diterima → status log naik dari "started" ke "accepted"
        // (label "berhasil"). Tanpa ini status tetap "started" sehingga log
        // selamanya menampilkan fallback "Memanggil". Kiriman P2P memakai logId
        // yang sama, jadi baris pemanggil ikut terbarui — sama seperti jalur
        // "rejected" yang sudah menyentuh kedua sisi.
        if (callSession?.logId)
          void updateCallLog(callSession.logId, incoming.peer || incoming.peerId, "accepted");
        const view = panel(mode),
          local = mode === "video" ? view?.querySelector("#video-local") : view?.querySelector("audio"),
          remote = mode === "video" ? view?.querySelector("#video-remote") : local,
          status = view?.querySelector('[id$="-call-status"]');
        if (!view || !local || !status) return;
        // Setelah diterima, hanya tombol tutup merah yang tersisa dan tetap terpusat.
        setIncomingControls(view, false);
        window.CallMeApp.show(`${mode}-call`);
        setChatCallButtonsHidden(true);
        try {
          stream = await captureLocalStream(mode, status);
          setMediaSource(local, stream);
          if (local !== remote) local.muted = true;
          currentCall = incoming;
          incoming.on("stream", (received) => bindRemoteStream(remote, received, status));
          incoming.answer(stream);
          window.CallMeAndroid?.answeredCall?.();
          status.textContent = "Menghubungkan...";
          incoming.on("close", () => finish(false));
          incoming.on("error", () => { status.textContent = "Panggilan gagal"; });
        } catch (error) {
          status.textContent = "Panggilan gagal: " + (error?.name || "error");
          try { incoming.close(); } catch {}
        }
      }),
    );
    window.addEventListener("callme:p2p-message", (event) => {
      const detail = event.detail || {};
      if (detail.kind === "call-hangup") {
        finish(false);
        return;
      }
      if (detail.kind === "call-accepted" || detail.kind === "call-declined") {
        window.dispatchEvent(new CustomEvent(`callme:fcm-${detail.kind}`, {
          detail: { peerId: detail.senderPeerId || detail.peerId || "" },
        }));
      }
    });
    window.addEventListener("callme:fcm-call-accepted", (event) => {
      const peerId = event.detail?.peerId || "";
      if (callSession?.kind !== "outgoing" || !callSession.waitingForAnswer ||
          String(peerId).replace(/^cm-/i, "").toLowerCase() !==
          String(callSession.peerId).replace(/^cm-/i, "").toLowerCase()) return;
      callSession.waitingForAnswer = false;
      if (callSession.logId) void updateCallLog(callSession.logId, peerId, "accepted");
      void startOutgoingP2P(callSession.mode, callSession.peerId);
    });
    window.addEventListener("callme:fcm-call-declined", (event) => {
      const peerId = event.detail?.peerId || "";
      if (callSession?.kind !== "outgoing" || !callSession.waitingForAnswer ||
          String(peerId).replace(/^cm-/i, "").toLowerCase() !==
          String(callSession.peerId).replace(/^cm-/i, "").toLowerCase()) return;
      callSession.waitingForAnswer = false;
      if (callSession.answerTimer) clearTimeout(callSession.answerTimer);
      if (callSession.logId) void updateCallLog(callSession.logId, peerId, "rejected");
      window.CallMeAndroid?.declinedCall?.();
      finish(false);
    });
    window.addEventListener("callme:incoming-call", async (event) => {
      const incoming = event.detail;
      if (!incoming) return;
      // Simpan panel asal sebelum lookup nama atau operasi async lainnya.
      const incomingPeer = incoming.peer || incoming.peerId;
      if (!incomingPeer) return;
      const videoRequested =
        incoming.metadata?.video === true ||
        incoming.metadata?.video === "true" ||
        incoming.metadata?.metadata?.video === true;
      const mode = videoRequested ? "video" : "voice";
      callEnded = false;
      const originPanel = window.CallMeApp.current?.() === "chatroom" && window.CallMeChat?.activePeer?.() ? "chatroom" : "friends";
      callSession = {
        kind: "incoming",
        peerId: incomingPeer,
        returnPanel: originPanel,
        logId: incoming.metadata?.callLogId || "",
        accepted: false,
      };
      void saveIncomingCallLog(incomingPeer, mode, callSession.logId).then((localLog) => {
        if (callSession?.peerId === incomingPeer)
          callSession.logId = localLog?.id || callSession.logId;
      });
      pendingIncoming = { incoming, mode };
      incoming.on("close", () => {
        if (pendingIncoming?.incoming === incoming) finish(false);
      });
      const view = panel(mode),
        local =
          mode === "video"
            ? view?.querySelector("#video-local")
            : view?.querySelector("audio"),
        remote =
          mode === "video" ? view?.querySelector("#video-remote") : local;
      if (!view || !local) return;
      const status = view.querySelector('[id$="-call-status"]'),
        name = view.querySelector(`#${mode}-call-name`);
      setCallNameVisible(view, true);
      if (name) name.textContent = window.CallMeIdentity?.withoutPeerPrefix?.(incomingPeer) || String(incomingPeer).replace(/^cm-/i, "");
      void displayNameForPeer(incomingPeer).then((label) => {
        if (pendingIncoming?.incoming === incoming && name) name.textContent = label;
      });
      // Aktifkan panel segera dari cache. Refresh Spreadsheet/Drive berjalan
      // di background agar panggilan tidak tertahan oleh sinkronisasi profil.
      if (mode === "voice") void setVoiceAvatar(incomingPeer);
      if (mode === "video") void setVideoAvatar(incomingPeer, view);
      // Panggilan bisa ditutup selama lookup nama berlangsung. Jangan biarkan
      // handler lama menghidupkan panel panggilan kembali setelah finish().
      if (pendingIncoming?.incoming !== incoming) return;
      window.CallMeApp.show(`${mode}-call`);
      setIncomingControls(view, true);
      status.textContent = mode === "video" ? "Panggilan video masuk" : "Panggilan suara masuk";
      if (window.__callmeAutoAnswerPending) {
        window.__callmeAutoAnswerPending = false;
        view.querySelector(`[data-call-accept="${mode}"]`)?.click();
      }
      incoming.on("error", () => {
        if (pendingIncoming?.incoming === incoming) status.textContent = "Panggilan gagal";
      });
    });
  });
})();
