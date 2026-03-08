import { saveDb, loadSavedDb, clearSavedDb } from '../app.js';

// Each test gets a fresh IDBFactory via tests/setup.js.

describe('loadSavedDb', () => {
  it('returns null when nothing has been saved', async () => {
    expect(await loadSavedDb()).toBeNull();
  });
});

describe('saveDb / loadSavedDb round-trip', () => {
  it('restores the correct filename', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    await saveDb('my.db', bytes);
    const saved = await loadSavedDb();
    expect(saved).not.toBeNull();
    expect(saved.filename).toBe('my.db');
  });

  it('restores the correct bytes', async () => {
    const bytes = new Uint8Array([10, 20, 30, 40]);
    await saveDb('data.sqlite', bytes);
    const saved = await loadSavedDb();
    expect(Array.from(saved.bytes)).toEqual([10, 20, 30, 40]);
  });

  it('stores a savedAt timestamp', async () => {
    const before = Date.now();
    await saveDb('t.db', new Uint8Array([0]));
    const saved = await loadSavedDb();
    expect(saved.savedAt).toBeGreaterThanOrEqual(before);
    expect(saved.savedAt).toBeLessThanOrEqual(Date.now());
  });

  it('second save overwrites the first (only last DB is kept)', async () => {
    await saveDb('first.db', new Uint8Array([1]));
    await saveDb('second.db', new Uint8Array([2]));
    const saved = await loadSavedDb();
    expect(saved.filename).toBe('second.db');
    expect(Array.from(saved.bytes)).toEqual([2]);
  });
});

describe('clearSavedDb', () => {
  it('removes a previously saved DB so loadSavedDb returns null', async () => {
    await saveDb('toRemove.db', new Uint8Array([9]));
    await clearSavedDb();
    expect(await loadSavedDb()).toBeNull();
  });

  it('is a no-op when nothing is stored', async () => {
    await expect(clearSavedDb()).resolves.not.toThrow();
    expect(await loadSavedDb()).toBeNull();
  });
});
