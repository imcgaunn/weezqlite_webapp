import { IDBFactory } from 'fake-indexeddb';

// Give every test a fresh, empty IndexedDB instance so state never leaks.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
