/**
 * PushApi.gs — titik entry web app untuk deployment "push" yang TERPISAH
 * dari API utama (id.txt baris "push").
 *
 * Kenapa file ini ada: deployment push yang diuji 2026-10-08 mengembalikan
 * "Fungsi skrip tidak ditemukan: doPost" — proyek push hanya berisi Push.gs
 * tanpa fungsi entry, sehingga push-register / push-notify tidak bisa dipanggil.
 *
 * Cara pasang (proyek Apps Script deployment "push"):
 *  1. + → Script file, beri nama "PushApi", tempel isi ini.
 *  2. Pastikan Push.gs juga ada di proyek yang sama.
 *  3. Deploy → New deployment → Web app (Execute as: Me, Access: Anyone).
 *  4. Script properties (Project Settings): FCM_PROJECT_ID + FCM_SERVICE_ACCOUNT
 *     (lihat komentar di Push.gs).
 */

function doGet() {
  return pushJson_({ ok: true, service: "callme-push" });
}

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (error) {
    body = {};
  }
  var action = String(body.action || "");
  var result;
  if (action === "push-register") result = pushRegister_(body);
  else if (action === "push-unregister") result = pushUnregister_(body);
  else if (action === "push-notify") result = pushNotify_(body);
  else result = { ok: false, error: "Action tidak dikenal" };
  return pushJson_(result);
}

function pushJson_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON,
  );
}
