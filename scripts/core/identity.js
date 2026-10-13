(function (root) {
  "use strict";

  function normalize(value) {
    const raw = String(value || "")
      .trim()
      .replace(/^cm-/i, "")
      .replace(/[^0-9a-z_+]/gi, "");

    if (/^\+?62[0-9]+$/.test(raw)) return raw.replace(/^\+/, "");
    if (/^0[0-9]+$/.test(raw)) return `62${raw.slice(1)}`;

    return raw.toLowerCase();
  }

  function withoutPeerPrefix(value) {
    return normalize(value).replace(/^cm-/i, "");
  }

  function peerId(value) {
    return `cm-${withoutPeerPrefix(value)}`;
  }

  function roomId(a, b) {
    const ids = [withoutPeerPrefix(a), withoutPeerPrefix(b)].sort();

    if (!ids[0] || !ids[1] || ids[0] === ids[1])
      throw new TypeError("Dua identitas berbeda diperlukan");

    return `${ids[0]}::${ids[1]}`;
  }

  root.CallMeIdentity = Object.freeze({
    normalize,
    peerId,
    roomId,
    withoutPeerPrefix,
  });
})(window);
