import { vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

// Provide a safe stub for config.js so tests run without a real config file.
vi.mock('../config.js', () => ({
  AZURE_CONFIG: {
    clientId: 'test-client-id',
    authority: 'https://login.microsoftonline.com/consumers',
    redirectUri: 'http://localhost:8080',
    storageAccount: 'testaccount',
    container: 'testcontainer',
    backupPrefix: 'artifacts/backup/',
  },
}));

// Give every test a fresh, empty IndexedDB instance so state never leaks.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});
