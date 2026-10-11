(function () {
  // Panel Lokasi — mengikuti pola auroramaps (Leaflet + tile street OSM,
  // watchPosition enableHighAccuracy, lingkaran akurasi + penanda berdenyut,
  // klik "lokasi saya" = peta melompat ke posisi tempat kita berdiri).
  document.addEventListener("DOMContentLoaded", () => {
    const panel = document.querySelector('[data-panel="location"]');
    const mapEl = document.getElementById("location-map");
    const statusEl = document.getElementById("location-status");
    const timeEl = document.getElementById("location-time");
    const accuracyEl = document.getElementById("location-accuracy");
    const distanceEl = document.getElementById("location-distance");
    const coordsEl = document.getElementById("location-coords");
    const sendBtn = document.getElementById("location-send");
    const menu = document.getElementById("attachment-menu");
    if (!panel || !mapEl || !sendBtn) return;

    menu?.querySelector('[data-pick="location"]')?.addEventListener("click", () => {
      if (menu) menu.hidden = true;
      window.CallMeApp?.show?.("location");
    });

    let map = null;
    let markerLayer = null;
    let watchId = null;
    let tickId = null;
    let startedAt = 0;
    let firstFix = null;
    let lastFix = null;
    let hasCentered = false;

    const haversineMeters = (a, b) => {
      const rad = (x) => (x * Math.PI) / 180;
      const dLat = rad(b.latitude - a.latitude);
      const dLng = rad(b.longitude - a.longitude);
      const s =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(rad(a.latitude)) *
          Math.cos(rad(b.latitude)) *
          Math.sin(dLng / 2) ** 2;
      return 2 * 6371000 * Math.asin(Math.sqrt(s));
    };
    const formatDistance = (meters) =>
      meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;

    const setStatus = (text) => {
      if (!statusEl) return;
      statusEl.textContent = text;
      statusEl.hidden = !text;
    };

    const ensureMap = () => {
      if (map) return;
      if (typeof L === "undefined") {
        setStatus("Peta belum siap (internet?). Lokasi tetap bisa dikirim.");
        return;
      }
      map = L.map(mapEl).setView([-2.5, 118], 5); // Indonesia, sampai GPS pertama
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        maxNativeZoom: 17,
        attribution: "© OpenStreetMap contributors",
      }).addTo(map);
      markerLayer = L.layerGroup().addTo(map);
      // Panel baru saja tampil; Leaflet butuh ukuran container yang valid.
      setTimeout(() => map?.invalidateSize(), 60);
    };

    const drawMarker = (fix) => {
      if (!markerLayer || typeof L === "undefined") return;
      markerLayer.clearLayers();
      L.circle([fix.latitude, fix.longitude], {
        radius: Math.max(fix.accuracy, 5),
        color: "#3b82f6",
        weight: 2,
        fillColor: "#3b82f6",
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(markerLayer);
      L.marker([fix.latitude, fix.longitude], {
        interactive: false,
        icon: L.divIcon({
          className: "",
          html: '<div class="location-marker-pulse"></div>',
          iconSize: [16, 16],
          iconAnchor: [8, 8],
        }),
      }).addTo(markerLayer);
    };

    const onPosition = (position) => {
      const fix = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: Math.round(Number(position.coords.accuracy) || 0),
      };
      lastFix = fix;
      if (!firstFix) {
        firstFix = { latitude: fix.latitude, longitude: fix.longitude };
        setStatus("");
        sendBtn.disabled = false;
      }
      // Terapkan "lokasi saya" otomatis (pola auroramaps): fix pertama
      // melompat ke posisi kita, fix berikutnya peta mengikuti pergerakan.
      if (map) {
        const view = [fix.latitude, fix.longitude];
        if (!hasCentered) {
          map.setView(view, Math.max(map.getZoom(), 16), { animate: true });
          hasCentered = true;
        } else {
          map.panTo(view, { animate: true, duration: 0.35 });
        }
      }
      drawMarker(fix);
      coordsEl.textContent = `${fix.latitude.toFixed(6)}, ${fix.longitude.toFixed(6)}`;
      accuracyEl.textContent = `Akurasi ±${fix.accuracy} m`;
      distanceEl.textContent = `Jarak ${formatDistance(
        haversineMeters(firstFix, fix),
      )}`;
    };

    const onGeoError = (error) => {
      const messages = {
        1: "Akses lokasi ditolak. Izinkan lokasi di browser untuk menggunakannya.",
        2: "Lokasi tidak tersedia saat ini.",
        3: "Permintaan lokasi habis waktu. Coba lagi.",
      };
      setStatus(messages[error?.code] || "Gagal mendapatkan lokasi perangkat");
    };

    const startTicker = () => {
      startedAt = Date.now();
      clearInterval(tickId);
      timeEl.textContent = "⏱ 0 detik";
      tickId = setInterval(() => {
        const seconds = Math.floor((Date.now() - startedAt) / 1000);
        timeEl.textContent = `⏱ ${seconds} detik`;
      }, 1000);
    };

    const start = () => {
      ensureMap();
      hasCentered = false; // panel dibuka lagi = lompat lagi ke posisi terkini
      startTicker();
      if (!navigator.geolocation) {
        setStatus("Browser ini tidak mendukung akses lokasi");
        return;
      }
      if (watchId === null) {
        if (!firstFix) setStatus("Mencari lokasi…");
        watchId = navigator.geolocation.watchPosition(
          onPosition,
          onGeoError,
          { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
        );
      }
    };

    const stop = () => {
      if (watchId !== null && navigator.geolocation)
        navigator.geolocation.clearWatch(watchId);
      watchId = null;
      clearInterval(tickId);
      tickId = null;
    };

    // Alamat dari koordinat (Nominatim, layaknya pencarian di auroramaps).
    const reverseAddress = async (latitude, longitude) => {
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&accept-language=id&lat=${latitude}&lon=${longitude}`,
          { headers: { "Accept-Language": "id,en" } },
        );
        if (!response.ok) return "";
        const data = await response.json();
        return String(data?.display_name || "");
      } catch {
        return "";
      }
    };

    sendBtn.addEventListener("click", async () => {
      if (!lastFix || sendBtn.disabled) return;
      sendBtn.disabled = true;
      const originalLabel = sendBtn.textContent;
      sendBtn.textContent = "Mengirim…";
      const lat = lastFix.latitude.toFixed(6);
      const lng = lastFix.longitude.toFixed(6);
      try {
        // Pratinjau peta untuk URL ini dibuat otomatis oleh render chat
        // (thum.io, gambar lanskap di atas teks) — sama seperti semua
        // pesan ber-URL lain, jadi panel cukup mengirim teksnya saja.
        const address = await reverseAddress(
          lastFix.latitude,
          lastFix.longitude,
        );
        const sent = await window.CallMeChat?.sendText?.(
          [
            `📍 ${address || "Lokasi saya"}`,
            `${lat}, ${lng} (±${lastFix.accuracy} m)`,
            `https://www.google.com/maps?q=${lat},${lng}`,
          ].join("\n"),
        );
        if (sent) window.CallMeApp?.show?.("chatroom");
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = originalLabel;
      }
    });

    window.addEventListener("callme:panel-change", (event) => {
      if (event.detail?.panel === "location") start();
      else stop();
    });
  });
})();
