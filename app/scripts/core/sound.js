(function () {
  "use strict";
  const KEY = "callme-v2-sound";
  const defaults = { callRingtone: true, messageTone: true };
  let cache = null;
  let audioCtx = null;
  let ringTimer = null;
  let ringNodes = [];
  let ringActive = false;

  function load() {
    if (cache) return cache;
    try {
      const raw = localStorage.getItem(KEY);
      cache = { ...defaults, ...(raw ? JSON.parse(raw) : {}) };
    } catch (_) {
      cache = { ...defaults };
    }
    return cache;
  }
  function save(next) {
    cache = { ...defaults, ...load(), ...next };
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (_) {}
    return cache;
  }
  function getCtx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") {
      audioCtx.resume().catch(function () {});
    }
    return audioCtx;
  }
  function playBeep(freq, start, dur, gainVal, type) {
    const ctx = getCtx();
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type || "sine";
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(gainVal || 0.12, start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + dur + 0.02);
      ringNodes.push(osc, gain);
    } catch (_) {}
  }
  function ringBurst() {
    const ctx = getCtx();
    if (!ctx) return;
    const t = ctx.currentTime;
    // pola dering: dua nada berulang
    playBeep(880, t + 0.00, 0.18, 0.10, "sine");
    playBeep(660, t + 0.22, 0.18, 0.10, "sine");
    playBeep(880, t + 0.50, 0.18, 0.10, "sine");
    playBeep(660, t + 0.72, 0.18, 0.10, "sine");
  }
  function cleanupNodes() {
    ringNodes = [];
  }
  function startRingtone() {
    if (!load().callRingtone) return;
    if (ringActive) return;
    ringActive = true;
    cleanupNodes();
    try { ringBurst(); } catch (_) {}
    ringTimer = setInterval(function () {
      if (!ringActive) return;
      cleanupNodes();
      try { ringBurst(); } catch (_) {}
    }, 1400);
  }
  function stopRingtone() {
    ringActive = false;
    if (ringTimer) {
      clearInterval(ringTimer);
      ringTimer = null;
    }
    cleanupNodes();
  }
  function playMessageTone() {
    if (!load().messageTone) return;
    const ctx = getCtx();
    if (!ctx) return;
    try {
      const t = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(1320, t + 0.12);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.11, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    } catch (_) {}
  }

  window.CallMeSound = {
    settings: function () { return { ...load() }; },
    set: save,
    isCallRingtoneEnabled: function () { return !!load().callRingtone; },
    isMessageToneEnabled: function () { return !!load().messageTone; },
    startRingtone: startRingtone,
    stopRingtone: stopRingtone,
    playMessageTone: playMessageTone,
  };
})();