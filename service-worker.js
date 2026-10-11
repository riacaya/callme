/* Firebase Cloud Messaging background handler. */
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");
importScripts("./push-config.js");

var messagingConfig = self.CALLME_WEB_PUSH || {
  apiKey: "AIzaSyB8xTjyVdeUjPHJSpxrNuXsW83onzhfcHY",
  authDomain: "callme-99.firebaseapp.com",
  projectId: "callme-99",
  messagingSenderId: "1063148635219",
  appId: "1:1063148635219:web:01df1f1b7c64c92c2632a6",
};
var messaging = null;
if (messagingConfig.apiKey && messagingConfig.projectId && messagingConfig.messagingSenderId && messagingConfig.appId) {
  firebase.initializeApp(messagingConfig);
  messaging = firebase.messaging();
  messaging.onBackgroundMessage(function (payload) {
    return showCallMeNotification(payload && payload.data || {});
  });
}

self.addEventListener("push", function (event) {
  if (messaging) return; // Firebase SDK processes FCM deliveries.
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  event.waitUntil(showCallMeNotification(data.data || data));
});

function showCallMeNotification(data) {
  data = data || {};
  var kind = String(data.kind || "message");
  var title = String(data.title || "CallMe");
  var body = String(data.body || "");
  var options = {
    body: body,
    icon: "./assets/logo-192.png",
    badge: "./assets/logo-192.png",
    tag: "callme-" + kind + "-" + String(data.id || data.sender || Date.now()),
    data: { url: new URL("./", self.location.href).href, sender: data.sender || "", kind: kind },
  };
  if (kind === "call") {
    options.requireInteraction = true;
    options.actions = [
      { action: "answer", title: "Buka untuk menjawab" },
      { action: "dismiss", title: "Tutup" },
    ];
  }
  return self.registration.showNotification(title, options);
}

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  if (event.action === "dismiss") return;
  var destination = event.notification.data && event.notification.data.url || new URL("./", self.location.href).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clients) {
    for (var i = 0; i < clients.length; i++) {
      if ("focus" in clients[i]) return clients[i].focus();
    }
    return self.clients.openWindow(destination);
  }));
});
