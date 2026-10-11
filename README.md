# CallMe — GitHub Pages

Versi web statis CallMe. `index.html` adalah salinan `callme-modular.html`; folder `scripts/` dan `assets/` diperlukan oleh aplikasi.

## Menjalankan lokal

Jalankan server web statis dari folder ini, lalu buka alamat lokal yang ditampilkan server. Jangan membuka `index.html` langsung melalui `file://`, karena akses kamera, mikrofon, dan fitur browser memerlukan secure context. GitHub Pages menyediakan HTTPS.

## Deploy GitHub Pages

1. Buat repository GitHub dan unggah isi folder ini ke branch yang dipilih.
2. Di **Settings → Pages**, pilih deploy dari branch tersebut dan folder root `/`.
3. Buka URL HTTPS yang diberikan GitHub Pages.

Backend akun/profil dan relay push masih memakai Apps Script yang dikonfigurasi pada kode. Kredensial TURN pada versi ini sengaja berupa placeholder. Ganti dengan kredensial TURN sementara yang diberikan server sebelum menguji panggilan; jangan menaruh kredensial TURN permanen di JavaScript publik.

## Status notifikasi browser

Fondasi notifikasi browser sudah ditambahkan: service worker, tombol izin/pendaftaran push, dan pengiriman token browser ke relay. Saat push pesan/panggilan diterima, browser menampilkan notifikasi; klik panggilan membuka aplikasi supaya pengguna dapat menjawab. Browser tidak dapat otomatis menjawab panggilan ketika halaman tertutup.

Push browser belum aktif sampai konfigurasi Firebase Web dan backend dipasang. Firebase Web client values dan VAPID public key boleh berada di frontend; service account/private key wajib disimpan sebagai Script Properties server.

1. Buat aplikasi Web pada Firebase project yang sama, aktifkan Firebase Cloud Messaging API, dan buat Web Push certificate/VAPID key. Isi nilai Firebase Web dan VAPID public key di `push-config.js`.
2. Pada proyek Apps Script deployment push, perbarui `Push.gs` dan `PushApi.gs` dari folder `backend/`, lalu buat versi deployment baru. Simpan `FCM_PROJECT_ID` serta `FCM_SERVICE_ACCOUNT` pada Script Properties.
3. Deploy folder ini melalui GitHub Pages HTTPS. Salin `push-config.example.js` menjadi `push-config.js`, isi konfigurasi Firebase Web dan VAPID, lalu deploy. Login di browser, buka Pengaturan, lalu pilih **Aktifkan notifikasi browser**.
4. Untuk akun yang sudah terdaftar di Android, kirim notifikasi uji dari akun pengirim lain. Push dapat terkirim ke perangkat web dan APK akun penerima.

GitHub Pages membutuhkan berkas bernama `index.html`; file sumber `callme-modular.html` yang disalin menjadi `index.html`. Pesan yang dikirim melalui `pendingOnly` tetap ditandai untuk antrean Android; backend push browser perlu meninjau kebijakan payload tersebut bila penerima browser harus menyimpan pesan luring ke room saat dibuka.

## Informasi publikasi

Folder ini tidak memuat berkas rahasia Firebase atau Android. Jangan menambahkan `google-services.json`, service account Firebase, token, password, atau private key ke repository.
