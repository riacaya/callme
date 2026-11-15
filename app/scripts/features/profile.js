(function () {
  const apiBase = "https://script.google.com/macros/s/AKfycby-8P8p94mCSoZGPRECwjKw7wPR2de6R1zPQRJoWDHBQ4FVBERV7RZdRtCv1Laps5LZ/exec";

  document.addEventListener("DOMContentLoaded", () => {
    const headerLogo = document.querySelector(".app-header .app-logo");
    const panel = document.querySelector('[data-panel="profile"]');
    const form = document.getElementById("profile-form");
    const status = document.getElementById("profile-status");
    const photoInput = document.getElementById("profile-photo");
    if (!panel || !form || !status || !photoInput) return;

    const preview = document.createElement("img");
    preview.id = "profile-photo-preview";
    preview.alt = "Foto profil";
    preview.className = "profile-photo-preview";
    photoInput.before(preview);
    const changePhoto = document.createElement("button");
    changePhoto.type = "button";
    changePhoto.className = "change-photo-link";
    changePhoto.textContent = "Ganti foto";
    preview.after(changePhoto);
    changePhoto.addEventListener("click", () => photoInput.click());
    photoInput.hidden = true;

    let profilePhoto = "";
    let selectedPhotoFile = null;
    let previewObjectUrl = "";
    let profilePhotoMeta = {
      profile_photo_name: "profil.png",
      profile_photo_mime: "image/png",
      profile_photo_size: 0,
    };
    const showPhoto = (source) => {
      preview.src = source || window.CallMeChatUtils.defaultAvatar;
      if (headerLogo)
        headerLogo.src = source || window.CallMeChatUtils.defaultAvatar;
    };

    panel
      .querySelector("[data-back]")
      ?.addEventListener("click", () => window.CallMeApp.show("settings"));
    photoInput.addEventListener("change", async () => {
      const file = photoInput.files?.[0];
      if (!file) return;
      selectedPhotoFile = file;
      if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = URL.createObjectURL(file);
      showPhoto(previewObjectUrl);
      status.textContent = "Foto dipilih. Menyiapkan...";
      try {
        const optimized = await window.CallMeProfileImage.optimize(file);
        profilePhoto = optimized.dataUrl;
        profilePhotoMeta = {
          profile_photo_name: optimized.filename,
          profile_photo_mime: optimized.mime,
          profile_photo_size: optimized.size,
        };
        showPhoto(profilePhoto);
        status.textContent = "Foto siap disimpan.";
      } catch (error) {
        console.error("Foto profil gagal dibaca", error);
        status.textContent = "Foto tidak dapat dibaca. Pilih gambar lain.";
      }
    });

    async function load() {
      const user = sessionStorage.getItem("callme-v2-session-user");
      if (!user) return;
      try {
        let data = JSON.parse(
          localStorage.getItem(`callme-profile-${user}`) || "null",
        );
        const cachedRepository = window.CallMeProfileRepository?.read?.(user);
        if (cachedRepository) data = { ...data, ...cachedRepository };
        const localProfile = await window.CallMeStorage?.get?.(
          "settings",
          `profile:${user}`,
        );
        if (localProfile?.value) data = localProfile.value;
        const render = (value) => {
          profilePhoto = value.photo_url || value.profile_photo || "";
          showPhoto(profilePhoto);
          document.getElementById("profile-name").value = value.display_name || user;
          document.getElementById("profile-phone").value = value.phone || "";
          document.getElementById("profile-email").value = value.email || "";
          document.getElementById("profile-bio").value = value.bio || "";
        };
        if (data) render(data);
        const remote = await window.CallMeProfileRepository?.get?.(user, user, sessionStorage.getItem("callme-v2-session-token") || "");
        if (remote) {
          // Server/Drive adalah sumber terbaru. Cache lokal hanya fallback awal.
          data = { ...data, ...remote, profile_photo: remote.photo_url || remote.profile_photo || data?.profile_photo || "" };
          localStorage.setItem(`callme-profile-${user}`, JSON.stringify(data));
          await window.CallMeStorage?.put?.("settings", { key: `profile:${user}`, value: data, updatedAt: Date.now() });
          render(data);
          window.dispatchEvent(new CustomEvent("callme:profile-updated", { detail: { peerId: user, data } }));
        }
        if (!data) throw new Error("Profil belum tersedia");
      } catch {
        status.textContent = "Data profil belum dapat dimuat.";
      }
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const user = sessionStorage.getItem("callme-v2-session-user");
      if (!user) return;
      status.textContent = "Menyimpan profil...";

      try {
        const selected = selectedPhotoFile || photoInput.files?.[0];
        if (selected) {
          const optimized = await window.CallMeProfileImage.optimize(selected);
          profilePhoto = optimized.dataUrl;
          profilePhotoMeta = {
            profile_photo_name: optimized.filename,
            profile_photo_mime: optimized.mime,
            profile_photo_size: optimized.size,
          };
        }

        const payload = {
          display_name: document.getElementById("profile-name").value.trim(),
          phone: document.getElementById("profile-phone").value.trim(),
          email: document.getElementById("profile-email").value.trim(),
          bio: document.getElementById("profile-bio").value.trim(),
          profile_photo: profilePhoto,
          ...profilePhotoMeta,
          updatedAt: Date.now(),
        };
        localStorage.setItem(`callme-profile-${user}`, JSON.stringify(payload));
        await window.CallMeStorage?.put?.("settings", {
          key: `profile:${user}`,
          value: payload,
          updatedAt: Date.now(),
        });
        if (apiBase) {
          const response = await fetch(apiBase, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify({ action: "profile", username: user, token: sessionStorage.getItem("callme-v2-session-token") || "", display_name: payload.display_name, phone: payload.phone, email: payload.email, photoDataUrl: profilePhoto.startsWith("data:image/") ? profilePhoto : "" }) });
          const raw = await response.text();
          let result;
          try { result = JSON.parse(raw); } catch { throw new Error(`Apps Script tidak mengembalikan JSON (HTTP ${response.status}). Periksa akses deployment Web App.`); }
          if (!result.ok) throw new Error(result.error || "Profil gagal disimpan ke server");
          if (result.user?.photo_url) payload.profile_photo = result.user.photo_url;
          profilePhoto = payload.profile_photo || profilePhoto;
          localStorage.setItem(`callme-profile-${user}`, JSON.stringify(payload));
          await window.CallMeStorage?.put?.("settings", {
            key: `profile:${user}`,
            value: payload,
            updatedAt: Date.now(),
          });
          window.CallMeProfileRepository?.write?.(user, payload);
        }
        status.textContent = "Profil tersimpan.";
        showPhoto(profilePhoto);
        selectedPhotoFile = null;
        if (previewObjectUrl) {
          URL.revokeObjectURL(previewObjectUrl);
          previewObjectUrl = "";
        }
        window.dispatchEvent(
          new CustomEvent("callme:profile-updated", {
            detail: { peerId: user, data: payload },
          }),
        );
      } catch (error) {
        console.error("Profil gagal disimpan", error);
        status.textContent = `Gagal menyimpan profil: ${error.message || error}`;
      }
    });

    const observer = new MutationObserver(() => {
      if (!panel.classList.contains("hidden")) load();
    });
    observer.observe(panel, { attributes: true, attributeFilter: ["class"] });
    window.addEventListener("callme:session-user", () => {
      void load();
    });
    window.addEventListener("callme:local-profiles-synced", () => {
      void load();
    });
    load();
  });
})();
