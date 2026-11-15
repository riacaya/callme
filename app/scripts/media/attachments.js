(function () {
  function reportTransferError(file, error) {
    console.error("Gagal membaca/mengirim lampiran", error);
    window.dispatchEvent(
      new CustomEvent("callme:file-transfer-error", {
        detail: {
          name: file.name,
          error: error?.name || "TransferError",
          message: error?.message || String(error),
        },
      }),
    );
  }

  document.addEventListener("DOMContentLoaded", () => {
    const button = document.getElementById("attach-button");
    const menu = document.getElementById("attachment-menu");
    const inputs = [
      [document.getElementById("file-input"), "file"],
      [document.getElementById("photo-input"), "capture"],
      [document.getElementById("video-input"), "video-capture"],
    ];
    if (!button || !menu || inputs.some(([input]) => !input)) return;

    button.onclick = () => {
      menu.hidden = !menu.hidden;
    };
    menu.querySelector('[data-pick="file"]').onclick = async () => {
      menu.hidden = true;
      // Chrome Android can open the document/memory picker directly through
      // File System Access. Keep the input fallback for browsers without it.
      if (typeof window.showOpenFilePicker === "function") {
        try {
          const handles = await window.showOpenFilePicker({
            multiple: false,
          });
          const file = await handles[0]?.getFile();
          if (file) await window.CallMeFileTransfer.send(file, "file");
          return;
        } catch (error) {
          if (error?.name === "AbortError") return;
        }
      }
      inputs[0][0].click();
    };

    const fallbackToInput = (index) => {
      menu.hidden = true;
      inputs[index][0].click();
    };
    const stamp = () =>
      new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const sendFile = (file, mode) => {
      const job = window.CallMeFileTransfer?.send?.(file, mode);
      if (job && typeof job.catch === "function")
        job.catch((error) => reportTransferError(file, error));
    };

    // Foto dan Video memakai kamera live (getUserMedia), bukan pemilih berkas:
    // atribut `capture` diabaikan sebagian peramban sehingga terbuka "memory".
    // Overlay dibuka lebih dulu agar keadaan (izin, error, rekaman) selalu
    // terlihat; input file tetap menjadi cadangan bila kamera gagal.
    const openLiveCamera = async (kind) => {
      menu.hidden = true;
      const inputIndex = kind === "photo" ? 1 : 2;
      if (
        !navigator.mediaDevices?.getUserMedia ||
        (kind === "video" && typeof MediaRecorder === "undefined")
      ) {
        fallbackToInput(inputIndex);
        return;
      }

      const previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      const overlay = document.createElement("div");
      overlay.setAttribute("role", "dialog");
      overlay.setAttribute(
        "aria-label",
        kind === "photo" ? "Kamera foto" : "Kamera video",
      );
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:40;background:#050407;display:flex;flex-direction:column";

      // Bingkai 9:16 (portrait) di layar sempit dan 16:9 (lanskap) di layar
      // lebar; lebarnya dihitung agar tidak pernah melewati lebar viewport
      // dan tingginya selalu muat (CSS .cam-stage/.cam-frame).
      const stage = document.createElement("div");
      stage.className = "cam-stage";
      const video = document.createElement("video");
      video.className = "cam-frame";
      video.autoplay = true;
      video.playsInline = true;
      video.muted = true;
      stage.append(video);
      overlay.append(stage);

      const label = document.createElement("p");
      label.style.cssText =
        "position:absolute;top:calc(12px + env(safe-area-inset-top));left:0;right:0;margin:0;text-align:center;color:#fff;text-shadow:0 1px 3px #000;font-size:15px;z-index:2";
      label.textContent = "Meminta izin kamera…";
      overlay.append(label);

      const bar = document.createElement("div");
      bar.className = "cam-bar";
      overlay.append(bar);

      // Lingkaran mengikuti panel video call (.call-control): 56px, jarak
      // 28px, sehingga tombol X dan tombol ambil gambar/rekam sama besar.
      const makeButton = (text, background, ariaLabel) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = "cam-btn";
        el.textContent = text;
        el.setAttribute("aria-label", ariaLabel);
        el.style.background = background;
        return el;
      };

      let recorder = null;
      let chunks = [];
      let timerId = null;
      let cancelled = false;
      let cameraStream = null;

      const closeOverlay = () => {
        clearInterval(timerId);
        timerId = null;
        if (recorder && recorder.state !== "inactive") {
          try {
            recorder.stop();
          } catch {}
        }
        (cameraStream || stream || [])
          .getTracks?.()
          .forEach((track) => track.stop());
        overlay.remove();
        document.body.style.overflow = previousOverflow;
      };

      const closeButton = makeButton("✕", "#3a3a42", "Tutup kamera");
      const actionButton = makeButton(
        kind === "photo" ? "●" : "⏺",
        kind === "photo" ? "#fff" : "#d92d3f",
        kind === "photo" ? "Ambil foto" : "Mulai merekam",
      );
      actionButton.disabled = true;
      actionButton.style.opacity = "0.45";
      if (kind === "photo") actionButton.style.color = "#20a85a";
      bar.append(closeButton, actionButton);

      // Tanpa tombol galeri: pilihan "File / Memory" sudah tersedia di
      // menu tombol (+), jadi bilah kamera cukup lingkaran X + shutter.
      closeButton.onclick = () => {
        cancelled = true;
        closeOverlay();
      };

      const deliver = (file, mode) => {
        if (cancelled || !file) return;
        sendFile(file, mode);
      };

      if (kind === "photo") {
        actionButton.onclick = () => {
          if (!video.videoWidth || !video.videoHeight) {
            label.textContent = "Kamera belum siap, tunggu sebentar.";
            return;
          }
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          canvas.getContext("2d").drawImage(video, 0, 0);
          closeOverlay();
          canvas.toBlob(
            (blob) => {
              if (!blob) return;
              deliver(
                new File([blob], `Foto-${stamp()}.jpg`, { type: "image/jpeg" }),
                "capture",
              );
            },
            "image/jpeg",
            0.92,
          );
        };
      } else {
        actionButton.onclick = () => {
          if (!recorder) {
            chunks = [];
            try {
              recorder = new MediaRecorder(cameraStream);
            } catch (error) {
              console.warn("MediaRecorder tidak tersedia", error?.name || error);
              label.textContent = "Perekam video tidak tersedia di peramban ini.";
              return;
            }
            recorder.ondataavailable = (event) =>
              event.data.size && chunks.push(event.data);
            recorder.onstop = () => {
              const mime = recorder.mimeType || "video/webm";
              const blob = new Blob(chunks, { type: mime });
              const wasCancelled = cancelled;
              closeOverlay();
              if (wasCancelled || !blob.size) return;
              const extension = mime.includes("mp4") ? "mp4" : "webm";
              deliver(
                new File([blob], `Video-${stamp()}.${extension}`, {
                  // Tanpa parameter codec: koma pada "codecs=vp8,opus" merusak
                  // header data URL yang dibuat FileReader saat dikirim.
                  type: String(mime).split(";")[0] || "video/webm",
                }),
                "video-capture",
              );
            };
            recorder.start(250);
            actionButton.textContent = "⏹";
            actionButton.setAttribute("aria-label", "Berhenti merekam");
            let seconds = 0;
            label.textContent = "Merekam 00:00";
            timerId = setInterval(() => {
              seconds += 1;
              const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
              const ss = String(seconds % 60).padStart(2, "0");
              label.textContent = `Merekam ${mm}:${ss}`;
            }, 1000);
          } else {
            clearInterval(timerId);
            timerId = null;
            try {
              recorder.stop();
            } catch {}
          }
        };
      }

      document.body.append(overlay);
      closeButton.focus?.();

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: kind === "video",
        });
      } catch (error) {
        if (cancelled) return;
        console.warn("Kamera live ditolak/tidak tersedia", error?.name || error);
        label.textContent = `Kamera tidak dapat dibuka (${error?.name || "error"}). Tutup lalu pilih foto dari menu (+).`;
        return;
      }
      cameraStream = stream;
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      video.srcObject = stream;
      video.play?.().catch(() => {});
      actionButton.disabled = false;
      actionButton.style.opacity = "1";
      label.textContent = kind === "photo" ? "Ambil foto" : "Rekam video";
    };

    menu.querySelector('[data-pick="photo"]').onclick = () => {
      void openLiveCamera("photo");
    };
    menu.querySelector('[data-pick="video"]').onclick = () => {
      void openLiveCamera("video");
    };

    inputs.forEach(([input, mode]) => {
      input.onchange = () => {
        const file = input.files?.[0];
        if (file) {
          window.CallMeFileTransfer.send(file, mode).catch((error) =>
            reportTransferError(file, error),
          );
        }
        input.value = "";
      };
    });
  });
})();
