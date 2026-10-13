(function () {
  const name = "callme-v2";
  const eventLogDatabase = "callme-v2-event-log";
  const eventLogMigrationKey = "callme-v2-event-log-migrated";
  const stores = ["contacts", "messages", "media", "settings", "unread"];
  let eventLogMigration = null;

  function keyPathFor(store) {
    if (store === "contacts") return "peerId";
    if (store === "settings") return "key";
    if (store === "unread") return "peerId";
    return "id";
  }

  function open() {
    return new Promise((resolve, reject) => {
      // Open the existing database at its current version. Event Log must not
      // force a schema upgrade that can block calls in other open tabs.
      const request = indexedDB.open(name);
      request.onupgradeneeded = () => {
        const db = request.result;
        stores.forEach((store) => {
          if (!db.objectStoreNames.contains(store)) {
            db.createObjectStore(store, { keyPath: keyPathFor(store) });
          }
        });
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    });
  }

  function openEventLog() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(eventLogDatabase, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("event-log")) {
          db.createObjectStore("event-log", { keyPath: "id" });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    });
  }

  function directEventLogWrite(operation) {
    return openEventLog().then((db) => new Promise((resolve, reject) => {
      const transaction = db.transaction("event-log", "readwrite");
      operation(transaction.objectStore("event-log"));
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
      transaction.onabort = () => { db.close(); reject(transaction.error || new Error("Event Log transaction dibatalkan.")); };
    }));
  }

  function migrateLegacyEventLog() {
    try {
      if (localStorage.getItem(eventLogMigrationKey) === "true") return Promise.resolve();
    } catch {}
    if (eventLogMigration) return eventLogMigration;
    eventLogMigration = open().then((db) => {
      if (!db.objectStoreNames.contains("event-log")) {
        db.close();
        return [];
      }
      return new Promise((resolve, reject) => {
        const transaction = db.transaction("event-log", "readonly");
        const request = transaction.objectStore("event-log").getAll();
        request.onsuccess = () => { db.close(); resolve(request.result || []); };
        request.onerror = () => { db.close(); reject(request.error); };
      });
    }).then(async (rows) => {
      for (const row of rows) {
        await directEventLogWrite((store) => store.put(row));
      }
      try { localStorage.setItem(eventLogMigrationKey, "true"); } catch {}
    }).catch((error) => {
      eventLogMigration = null;
      throw error;
    });
    return eventLogMigration;
  }

  function read(store, operation) {
    return open().then((db) => new Promise((resolve, reject) => {
      const request = operation(db.transaction(store).objectStore(store));
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => { db.close(); reject(request.error); };
    }));
  }

  function write(store, operation, result) {
    return open().then((db) => new Promise((resolve, reject) => {
      const transaction = db.transaction(store, "readwrite");
      operation(transaction.objectStore(store));
      transaction.oncomplete = () => { db.close(); resolve(result); };
      transaction.onerror = () => { db.close(); reject(transaction.error); };
      transaction.onabort = () => { db.close(); reject(transaction.error || new Error("Database transaction dibatalkan.")); };
    }));
  }

  function all(store) {
    if (store === "event-log") return migrateLegacyEventLog().then(() => openEventLog()).then((db) => new Promise((resolve, reject) => {
      const request = db.transaction("event-log").objectStore("event-log").getAll();
      request.onsuccess = () => { db.close(); resolve(request.result || []); };
      request.onerror = () => { db.close(); reject(request.error); };
    }));
    return read(store, (objectStore) => objectStore.getAll()).then((rows) => rows || []);
  }

  function get(store, key) {
    if (store === "event-log") return migrateLegacyEventLog().then(() => openEventLog()).then((db) => new Promise((resolve, reject) => {
      const request = db.transaction("event-log").objectStore("event-log").get(key);
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => { db.close(); reject(request.error); };
    }));
    return read(store, (objectStore) => objectStore.get(key));
  }

  function replace(store, rows) {
    if (store === "event-log") return migrateLegacyEventLog().then(() => directEventLogWrite((objectStore) => {
      objectStore.clear();
      rows.forEach((row) => objectStore.put(row));
    })).then(() => rows);
    return write(store, (objectStore) => {
      objectStore.clear();
      rows.forEach((row) => objectStore.put(row));
    }, rows);
  }

  function put(store, value) {
    if (store === "event-log") return migrateLegacyEventLog().then(() => directEventLogWrite((objectStore) => objectStore.put(value))).then(() => value);
    return write(store, (objectStore) => objectStore.put(value), value);
  }

  function remove(store, key) {
    if (store === "event-log") return migrateLegacyEventLog().then(() => directEventLogWrite((objectStore) => objectStore.delete(key)));
    return write(store, (objectStore) => objectStore.delete(key));
  }

  window.CallMeStorage = Object.freeze({ open, all, get, replace, put, remove });
})();
