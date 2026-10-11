/* Handle data-only FCM push events directly; no SDK import is needed here. */
self.addEventListener("push", function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  data = data.data || data;
  if (data.kind === "call-accepted" || data.kind === "call-declined") {
    event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clients) {
      clients.forEach(function (client) {
        client.postMessage({ type: "callme:call-response", detail: { kind: data.kind, peerId: data.sender || data.title || "" } });
      });
    }));
    return;
  }
  event.waitUntil(showCallMeNotification(data));
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
    data: {
      url: new URL("./", self.location.href).href,
      sender: String(data.sender || "").replace(/^cm-/i, "").toLowerCase(),
      kind: kind,
      video: /video/i.test(body),
    },
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
  var info = event.notification.data || {};
  var destinationUrl = new URL(info.url || "./", self.location.href);
  if (info.sender) destinationUrl.searchParams.set("cmOpenPeer", info.sender);
  if (info.kind) destinationUrl.searchParams.set("cmNotificationKind", info.kind);
  if (info.kind === "call") {
    destinationUrl.searchParams.set("cmAcceptCall", "1");
    destinationUrl.searchParams.set("cmCallMode", info.video ? "video" : "voice");
  }
  var destination = destinationUrl.href;
  var detail = { sender: info.sender || "", kind: info.kind || "message", video: Boolean(info.video), acceptCall: info.kind === "call" };
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clients) {
    for (var i = 0; i < clients.length; i++) {
      if ("focus" in clients[i] && clients[i].url.indexOf(self.location.origin) === 0) {
        var client = clients[i];
        client.postMessage({ type: "callme:notification-open", detail: detail });
        return client.focus();
      }
    }
    return self.clients.openWindow(destination);
  }));
});
