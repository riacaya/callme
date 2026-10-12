# CallMe — GitHub Pages

Frontend browser CallMe. Sumber utama UI dan perilaku berada di `../modular/`; salin modul yang berubah ke `scripts/`. `index.html`, service worker, dan `push-config.js` menghubungkan aplikasi ke notifikasi browser.

Pages harus memakai HTTPS agar kamera, mikrofon, WebRTC, dan notifikasi browser berfungsi. Simpan kunci privat Firebase hanya di Script Properties Apps Script; nilai konfigurasi Web dan VAPID publik berada di `push-config.js`.

Untuk menerbitkan pembaruan, unggah `index.html` dan modul bersama yang berubah dengan path folder tetap. Deployment Apps Script untuk akun dan FCM diperbarui terpisah dari GitHub Pages.
