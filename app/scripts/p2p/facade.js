(function (root) {
  "use strict";
  const methods = [
    "start",
    "connect",
    "disconnect",
    "send",
    "sendCallControl",
    "call",
    "stop",
    "on",
    "getId",
    "isConnected",
    "probe",
    "hasConnection",
    "isPeerReady",
    "getStatus",
  ];
  const booleanMethods = new Set([
    "isConnected",
    "hasConnection",
    "isPeerReady",
  ]);
  const facade = {};

  function callTransport(name, args) {
    const transport = root.CallMeTransport;
    if (!transport || typeof transport[name] !== "function") {
      return booleanMethods.has(name) ? false : null;
    }
    return transport[name](...args);
  }

  for (const name of methods) {
    Object.defineProperty(facade, name, {
      enumerable: true,
      value: (...args) => callTransport(name, args),
    });
  }

  root.CallMeP2P = Object.freeze(facade);
})(window);
