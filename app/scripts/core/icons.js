/**
 * icons.js — ikon SVG self-hosted (callme-icons.svg sprite) + helper.
 * Menggantikan <img src="https://api.iconify.design/..."> dan emoji dengan
 * satu sprite bersama (cacheable di SW, tanpa request jaringan per ikon, dan
 * `fill="currentColor"` sehingga ikon mengikuti warna tema).
 */
(function () {
  "use strict";

  function icon(name, cls) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 -960 960 960");
    svg.setAttribute("width", "1em");
    svg.setAttribute("height", "1em");
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");
    if (cls) svg.setAttribute("class", cls);
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "assets/callme-icons.svg#" + name);
    svg.append(use);
    return svg;
  }

  window.CallMeIcons = {
    icon: function (name, cls) { return icon(name, cls); },
    phone: function (cls) { return icon("phone", cls); },
    videocam: function (cls) { return icon("videocam", cls); },
    "call-end": function (cls) { return icon("call-end", cls); },
    mic: function (cls) { return icon("mic", cls); },
    "mic-off": function (cls) { return icon("mic-off", cls); },
    stop: function (cls) { return icon("stop", cls); },
    send: function (cls) { return icon("send", cls); },
    add: function (cls) { return icon("add", cls); },
    "attach-file": function (cls) { return icon("attach-file", cls); },
    image: function (cls) { return icon("image", cls); },
    "location-on": function (cls) { return icon("location-on", cls); },
    language: function (cls) { return icon("language", cls); },
    person: function (cls) { return icon("person", cls); },
    edit: function (cls) { return icon("edit", cls); },
    logout: function (cls) { return icon("logout", cls); },
    info: function (cls) { return icon("info", cls); },
    package: function (cls) { return icon("package", cls); },
    "install-mobile": function (cls) { return icon("install-mobile", cls); },
    "admin-panel-settings": function (cls) { return icon("admin-panel-settings", cls); },
    notifications: function (cls) { return icon("notifications", cls); },
    delete: function (cls) { return icon("delete", cls); },
    close: function (cls) { return icon("close", cls); },
    "arrow-back": function (cls) { return icon("arrow-back", cls); },
    "more-vert": function (cls) { return icon("more-vert", cls); },
    "person-add": function (cls) { return icon("person-add", cls); },
    chat: function (cls) { return icon("chat", cls); },
    download: function (cls) { return icon("download", cls); },
  };
})();
