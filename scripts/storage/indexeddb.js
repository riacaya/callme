(function () {
  const name = "callme-v2";
  const version = 4;
  const stores = ["contacts", "messages", "media", "settings", "unread"];

  function keyPathFor(store) {
    if (store === "contacts") return "peerId";
    if (store === "settings") return "key";
    if (store === "unread") return "peerId";
    return "id";
  }

  function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, version);

      request.onupgradeneeded = () => {
        const db = request.result;
          const version = 5;
          db.deleteObjectStore("event-log");
        stores.forEach((store) => {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store, { keyPath: keyPathFor(store) });
          }
        });
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function read(store, operation) {
    return open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const request = operation(db.transaction(store).objectStore(store));

          request.onsuccess = () => {
            db.close();
            resolve(request.result);
          };
          request.onerror = () => {
            db.close();
            reject(request.error);
          };
        }),
    );
  }

  function write(store, operation, result) {
    return open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const transaction = db.transaction(store, "readwrite");

          operation(transaction.objectStore(store));
          transaction.oncomplete = () => {
            db.close();
            resolve(result);
          };
          transaction.onerror = () => {
            db.close();
            reject(transaction.error);
          };
        }),
    );
  }

  function all(store) {
    return read(store, (objectStore) => objectStore.getAll()).then(
      (rows) => rows || [],
    );
  }

  function get(store, key) {
    return read(store, (objectStore) => objectStore.get(key));
  }

  function replace(store, rows) {
    return write(
      store,
      (objectStore) => {
        objectStore.clear();
        rows.forEach((row) => objectStore.put(row));
      },
      rows,
    );
  }

  function put(store, value) {
    return write(store, (objectStore) => objectStore.put(value), value);
  }

  function remove(store, key) {
    return write(store, (objectStore) => objectStore.delete(key));
  }

  window.CallMeStorage = Object.freeze({
    open,
    all,
    get,
    replace,
    put,
    remove,
  });
})();
