/* CallMe service worker: push notifications + versioned app-shell caching. */
const CACHE_VERSION = "callme-v4-2026-11-13";
const APP_CACHE = `app-${CACHE_VERSION}`;
const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/logo-192.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("app-") && k !== APP_CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isNav = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");
  if (isNav) {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(APP_CACHE);
        cache.put("./index.html", fresh.clone()).catch(() => {});
        return fresh;
      } catch (_) {
        const cached = await caches.match(req, { ignoreSearch: true }) || await caches.match("./index.html");
        if (cached) return cached;
        throw _;
      }
    })());
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.match(req);
    const fetchPromise = fetch(req).then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(APP_CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => null);
    return cached || (await fetchPromise) || Response.error();
  })());
});

self.addEventListener("push", function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (_) {}
  data = data.data || data;
  if (data.kind === "call-accepted" || data.kind === "call-declined") {
    event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clients) {
      clients.forEach(function (client) {
        client.postMessage({ type: "callme:call-response", detail: { kind: data.kind, peerId: data.sender || data.title || "", callId: data.id || "" } });
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
      recipient: String(data.recipient || "").replace(/^cm-/i, "").toLowerCase(),
      callId: String(data.id || ""),
      kind: kind,
      video: /video/i.test(body),
    },
  };
  if (kind === "call") {
    options.requireInteraction = true;
    options.actions = [
      { action: "answer", title: "Jawab", icon: new URL("assets/call-answer.svg", self.location.href).href },
      { action: "decline", title: "Tolak", icon: new URL("assets/call-decline.svg", self.location.href).href },
    ];
  }
  return self.registration.showNotification(title, options);
}

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var info = event.notification.data || {};
  if (event.action === "decline" && info.kind === "call") {
    var endpoint = "https://script.google.com/macros/s/AKfycbyYbl54n8yvy_z12mZuw3KHIuXCXrgZ6XV5JGSTiKlRLUDswhNa1ZEgeIMFK6xw2FDR5w/exec";
    event.waitUntil(fetch(endpoint, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "push-notify", to: info.sender, kind: "call-declined", title: info.recipient || "CallMe", body: "Panggilan ditolak", sender: info.recipient || "", id: info.callId || "" }),
    }));
    return;
  }
  var destinationUrl = new URL(info.url || "./", self.location.href);
  if (info.sender) destinationUrl.searchParams.set("cmOpenPeer", info.sender);
  if (info.kind) destinationUrl.searchParams.set("cmNotificationKind", info.kind);
  if (info.callId) destinationUrl.searchParams.set("cmCallId", info.callId);
  if (info.kind === "call") {
    destinationUrl.searchParams.set("cmAcceptCall", "1");
    destinationUrl.searchParams.set("cmCallMode", info.video ? "video" : "voice");
  }
  var destination = destinationUrl.href;
  var detail = { sender: info.sender || "", kind: info.kind || "message", video: Boolean(info.video), callId: info.callId || "", acceptCall: info.kind === "call" };
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
