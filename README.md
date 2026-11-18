# CallMe — GitHub Pages (sumber & deploy)

Repo ini adalah **satu-satunya acuan** untuk frontend web CallMe dan dideploy ke GitHub Pages.

## Struktur
- `app/` — **sumber aplikasi** (`/callme/app/`): `index.html`, `scripts/` (core/features/media/p2p/storage/i18n), `assets/`, `manifest.webmanifest`, `service-worker.js`, `push-config.js`.
- `index.html` (root) — landing page (`/callme/`).
- `download/` — artefak distribusi (APK, shell Windows).
- `assets/` (root) — aset yang dipakai landing/root.
- `.nojekyll` — konfigurasi Pages.

## Alur kerja
- Edit langsung di `app/` (tidak ada folder sumber terpisah/sync). Commit dari repo ini saat siap; push ke `origin/main` untuk menerbitkan ke GitHub Pages.
- Pages harus memakai HTTPS agar kamera, mikrofon, WebRTC, dan notifikasi browser berfungsi.
- Simpan kunci privat Firebase hanya di Script Properties Apps Script; nilai konfigurasi Web dan VAPID publik berada di `app/push-config.js`.
- Deployment Apps Script (akun/FCM/relay) diperbarui terpisah dari GitHub Pages.
