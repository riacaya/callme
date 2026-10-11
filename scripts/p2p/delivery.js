(function (root) {
  "use strict";
  // The facade is the only public messaging API. Transport owns wire delivery;
  // file-transfer owns chunking and ACK behavior.
  root.CallMeMessages = Object.freeze({
    send(message, peerId) {
      return root.CallMeP2P.send(message, peerId);
    },
    sendFile(file, mode) {
      return root.CallMeFileTransfer.send(file, mode);
    },
    waitForAck(id, peerId) {
      return root.CallMeP2P.waitForAck(id, peerId);
    },
  });
})(window);
