/**
 * Push.gs — TAMBAHAN tahap 2 (APK CallMe). File terpisah; Code.gs hanya
 * perlu 2 baris routing yang sudah ditambahkan (dispatch_):
 *     if (action === 'push-register') return pushRegister_(body);
 *     if (action === 'push-notify') return pushNotify_(body);
 *
 * Cara pasang:
 *  1. Editor Apps Script → + → Script file, beri nama "Push", tempel isi ini.
 *  2. Project Settings → Script properties, isi:
 *       FCM_PROJECT_ID        : id proyek Firebase Anda (mis. callme-xxxxx)
 *       FCM_SERVICE_ACCOUNT   : JSON lengkap service account (satu baris)
 *                               dengan role Firebase Cloud Messaging API Admin.
 *  3. Deploy → New deployment → Web app (Execute as: Me, Access: Anyone).
 *  4. Taruh google-services.json dari Firebase console di android-app/app/
 *     lalu build ulang APK.
 *
 * Semua aksi push diamankan: tanpa konfigurasi fungsi mengembalikan
 * { ok:false } tanpa melempar error sehingga aplikasi web tidak terpengaruh.
 */

const PUSH_ = Object.freeze({
  tokensKey: 'push_tokens',
  expiresIn: 3600,
});

/** Simpan/segarkan FCM token untuk sebuah peer (dipanggil APK saat login). */
function pushRegister_(body) {
  const peerId = String(body.peerId || '').trim();
  const token = String(body.token || '').trim();
  const webToken = String(body.webToken || '').trim();
  if (!peerId || (!token && !webToken)) return { ok: false, error: 'peerId/token kosong' };
  const props = PropertiesService.getScriptProperties();
  const tokens = safeParse_(props.getProperty(PUSH_.tokensKey)) || {};
  const entry = tokens[peerId] || {};
  if (token) entry.token = token;
  if (webToken) entry.webToken = webToken;
  entry.updatedAt = new Date().toISOString();
  tokens[peerId] = entry;
  props.setProperty(PUSH_.tokensKey, JSON.stringify(tokens));
  return { ok: true, peerId };
}

/** Hapus hanya token Web Push milik browser yang meminta logout. */
function pushUnregister_(body) {
  const peerId = String(body.peerId || '').trim();
  const webToken = String(body.webToken || '').trim();
  if (!peerId || !webToken) return { ok: false, error: 'peerId/webToken kosong' };
  const props = PropertiesService.getScriptProperties();
  const tokens = safeParse_(props.getProperty(PUSH_.tokensKey)) || {};
  const entry = tokens[peerId];
  if (!entry || entry.webToken !== webToken) return { ok: true, removed: false };
  delete entry.webToken;
  if (!entry.token) delete tokens[peerId];
  else tokens[peerId] = entry;
  props.setProperty(PUSH_.tokensKey, JSON.stringify(tokens));
  return { ok: true, removed: true };
}

/** Kirim push ke peer penerima (dipanggil dari pengirim: APK via injected.js). */
function pushNotify_(body) {
  const to = String(body.to || '').trim();
  const kind = String(body.kind || 'message');
  const title = String(body.title || 'CallMe').slice(0, 120);
  const text = String(body.body || '').slice(0, 300);
  if (!to) return { ok: false, error: 'penerima kosong' };

  const tokens = safeParse_(PropertiesService.getScriptProperties().getProperty(PUSH_.tokensKey)) || {};
  const entry = tokens[to];
  if (!entry || (!entry.token && !entry.webToken)) return { ok: true, sent: false, reason: 'peer tidak terdaftar push' };

  const projectId = PropertiesService.getScriptProperties().getProperty('FCM_PROJECT_ID');
  const accountRaw = PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT');
  if (!projectId || !accountRaw) return { ok: false, error: 'konfigurasi push belum diisi' };

  try {
    const data = { kind, title, body: text };
    // Meta pesan (antrean offline): diteruskan apa adanya ke payload FCM
    // data sehingga penerima yang aplikasinya mati bisa menyimpan pesan ke
    // chatroom saat dibangunkan (MyFirebaseMessagingService → drainQueue).
    const meta = {
      id: 64,
      roomId: 200,
      sender: 120,
      createdAt: 20,
      pendingOnly: 5,
    };
    Object.keys(meta).forEach(function (key) {
      const value = body[key];
      if (value !== undefined && value !== null && String(value) !== '') {
        data[key] = String(value).slice(0, meta[key]);
      }
    });
    let sent = false;
    const errors = [];
    [entry.token, entry.webToken].filter(Boolean).forEach(function (registeredToken) {
      try { sent = fcmSend_(projectId, accountRaw, registeredToken, data, registeredToken === entry.webToken) || sent; }
      catch (error) { errors.push(String(error && error.message ? error.message : error)); }
    });
    if (!sent && errors.length) throw new Error(errors.join('; '));
    return { ok: true, sent: sent, errors: errors };
  } catch (error) {
    // Token basi → buang supaya tidak dikirim ulang.
    if (String(error && error.message).indexOf('UNREGISTERED') >= 0) {
      delete tokens[to];
      PropertiesService.getScriptProperties().setProperty(PUSH_.tokensKey, JSON.stringify(tokens));
    }
    return { ok: false, error: String(error && error.message ? error.message : error) };
  }
}

/** Kirim pesan data via FCM HTTP v1 (OAuth2 service account, tanpa library). */
function fcmSend_(projectId, accountRaw, token, data, isWeb) {
  const account = JSON.parse(accountRaw);
  const now = Math.floor(Date.now() / 1000);
  const header = b64url_(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url_(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + PUSH_.expiresIn,
  }));
  const unsigned = header + '.' + claims;
  const signature = b64url_(Utilities.computeRsaSha256Signature(unsigned, account.private_key));
  const jwt = unsigned + '.' + signature;

  const tokenResponse = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(jwt),
    muteHttpExceptions: true,
  });
  const access = safeParse_(tokenResponse.getContentText());
  if (!access || !access.access_token) throw new Error('OAuth gagal: ' + tokenResponse.getContentText());

  const payload = {};
  Object.keys(data).forEach(function (key) { payload[key] = String(data[key]); });
  const message = { token: token, data: payload };
  if (isWeb) {
    message.webpush = { headers: { Urgency: 'high', TTL: '86400' }, data: payload };
  } else {
    message.android = { priority: 'high' };
  }
  const send = UrlFetchApp.fetch(
    'https://fcm.googleapis.com/v1/projects/' + encodeURIComponent(projectId) + '/messages:send',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + access.access_token },
      // priority high: pesan data sampai segera walau penerima Doze/
      // layar mati — inilah satu-satunya jalur notif saat aplikasi mati.
      payload: JSON.stringify({
        message: message,
      }),
      muteHttpExceptions: true,
    },
  );
  const code = send.getResponseCode();
  const bodyText = send.getContentText();
  if (code >= 400) throw new Error('FCM HTTP ' + code + ': ' + bodyText);
  return true;
}

function b64url_(text) {
  return Utilities.base64EncodeWebSafe(text).replace(/=+$/, '');
}

function safeParse_(text) {
  try { return JSON.parse(text); } catch (e) { return null; }
}
