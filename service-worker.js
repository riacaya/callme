/* Handle data-only FCM push events directly; no SDK import is needed here. */
self.addEventListener("push", function (event) {
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
