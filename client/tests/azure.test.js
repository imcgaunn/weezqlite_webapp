import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  state,
  signIn,
  signOut,
  getStorageToken,
  listBackups,
  downloadBackup,
  renderAzureBackups,
} from '../app.js';

// ─── Test config (overrides the setup.js stub when passed explicitly) ─────────

const TEST_CONFIG = {
  clientId: 'test-client-id',
  authority: 'https://login.microsoftonline.com/consumers',
  redirectUri: 'http://localhost:8080',
  storageAccount: 'testaccount',
  container: 'testcontainer',
  backupPrefix: 'artifacts/backup/',
};

// ─── Shared setup ─────────────────────────────────────────────────────────────

beforeEach(() => {
  document.body.innerHTML = `
    <header><nav><ul id="main-nav-links"></ul></nav></header>
    <main id="app"></main>
  `;
  state.azureAccount = null;
  state.msalApp = null;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ─── signIn ───────────────────────────────────────────────────────────────────

describe('signIn', () => {
  it('sets state.azureAccount on successful login', async () => {
    const mockAccount = { username: 'test@example.com', name: 'Test User' };
    state.msalApp = {
      loginPopup: vi.fn().mockResolvedValue({ account: mockAccount }),
    };

    const account = await signIn();

    expect(account).toBe(mockAccount);
    expect(state.azureAccount).toBe(mockAccount);
    expect(state.msalApp.loginPopup).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: expect.arrayContaining(['https://storage.azure.com/user_impersonation']),
      })
    );
  });

  it('does not set state.azureAccount when loginPopup rejects', async () => {
    state.msalApp = {
      loginPopup: vi.fn().mockRejectedValue(new Error('User cancelled')),
    };

    await expect(signIn()).rejects.toThrow('User cancelled');
    expect(state.azureAccount).toBeNull();
  });
});

// ─── signOut ──────────────────────────────────────────────────────────────────

describe('signOut', () => {
  it('clears state.azureAccount and calls logoutPopup with the current account', async () => {
    const mockAccount = { username: 'test@example.com' };
    state.azureAccount = mockAccount;
    state.msalApp = {
      logoutPopup: vi.fn().mockResolvedValue(undefined),
    };

    await signOut();

    expect(state.azureAccount).toBeNull();
    expect(state.msalApp.logoutPopup).toHaveBeenCalledWith(
      expect.objectContaining({ account: mockAccount })
    );
  });
});

// ─── getStorageToken ──────────────────────────────────────────────────────────

describe('getStorageToken', () => {
  const mockAccount = { username: 'test@example.com' };

  beforeEach(() => {
    state.azureAccount = mockAccount;
  });

  it('returns access token from the silent flow', async () => {
    state.msalApp = {
      acquireTokenSilent: vi.fn().mockResolvedValue({ accessToken: 'silent-token-xyz' }),
    };

    const token = await getStorageToken();

    expect(token).toBe('silent-token-xyz');
    expect(state.msalApp.acquireTokenSilent).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: expect.arrayContaining(['https://storage.azure.com/user_impersonation']),
        account: mockAccount,
      })
    );
  });

  it('falls back to popup when silent throws InteractionRequiredAuthError', async () => {
    const interactionError = new Error('interaction_required');
    interactionError.name = 'InteractionRequiredAuthError';
    state.msalApp = {
      acquireTokenSilent: vi.fn().mockRejectedValue(interactionError),
      acquireTokenPopup: vi.fn().mockResolvedValue({ accessToken: 'popup-token-abc' }),
    };

    const token = await getStorageToken();

    expect(token).toBe('popup-token-abc');
    expect(state.msalApp.acquireTokenPopup).toHaveBeenCalled();
  });

  it('propagates non-interaction errors without attempting popup', async () => {
    const networkError = new Error('Network failure');
    networkError.name = 'NetworkError';
    state.msalApp = {
      acquireTokenSilent: vi.fn().mockRejectedValue(networkError),
      acquireTokenPopup: vi.fn(),
    };

    await expect(getStorageToken()).rejects.toThrow('Network failure');
    expect(state.msalApp.acquireTokenPopup).not.toHaveBeenCalled();
  });
});

// ─── listBackups ──────────────────────────────────────────────────────────────

const SAMPLE_LIST_XML = `<?xml version="1.0" encoding="utf-8"?>
<EnumerationResults ServiceEndpoint="https://testaccount.blob.core.windows.net/">
  <Blobs>
    <Blob><Name>artifacts/backup/2026/03/08/meemawmode.db</Name></Blob>
    <Blob><Name>artifacts/backup/2026/03/07/meemawmode.db</Name></Blob>
    <Blob><Name>artifacts/backup/2026/02/28/meemawmode.db</Name></Blob>
    <Blob><Name>artifacts/backup/2026/03/01/some_other_file.db</Name></Blob>
  </Blobs>
</EnumerationResults>`;

const EMPTY_LIST_XML = `<?xml version="1.0" encoding="utf-8"?>
<EnumerationResults ServiceEndpoint="https://testaccount.blob.core.windows.net/">
  <Blobs/>
</EnumerationResults>`;

describe('listBackups', () => {
  it('parses XML and returns matching backups sorted newest-first', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => SAMPLE_LIST_XML,
    }));

    const backups = await listBackups('test-token', TEST_CONFIG);

    expect(backups).toHaveLength(3); // some_other_file.db excluded
    expect(backups[0]).toMatchObject({ year: '2026', month: '03', day: '08' });
    expect(backups[1]).toMatchObject({ year: '2026', month: '03', day: '07' });
    expect(backups[2]).toMatchObject({ year: '2026', month: '02', day: '28' });
  });

  it('only includes blobs ending with meemawmode.db', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => SAMPLE_LIST_XML,
    }));

    const backups = await listBackups('test-token', TEST_CONFIG);

    expect(backups.every(b => b.blobPath.endsWith('meemawmode.db'))).toBe(true);
  });

  it('each backup has the full blobPath set', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => SAMPLE_LIST_XML,
    }));

    const backups = await listBackups('test-token', TEST_CONFIG);

    expect(backups[0].blobPath).toBe('artifacts/backup/2026/03/08/meemawmode.db');
  });

  it('returns empty array when container has no matching blobs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      text: async () => EMPTY_LIST_XML,
    }));

    const backups = await listBackups('test-token', TEST_CONFIG);

    expect(backups).toEqual([]);
  });

  it('passes Authorization Bearer token in request headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, text: async () => EMPTY_LIST_XML });
    vi.stubGlobal('fetch', mockFetch);

    await listBackups('my-secret-token', TEST_CONFIG);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer my-secret-token');
  });

  it('throws a descriptive error on HTTP 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 403, statusText: 'Forbidden',
    }));

    await expect(listBackups('bad-token', TEST_CONFIG)).rejects.toThrow('403');
  });

  it('throws a descriptive error on HTTP 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 404, statusText: 'Not Found',
    }));

    await expect(listBackups('token', TEST_CONFIG)).rejects.toThrow('404');
  });
});

// ─── downloadBackup ───────────────────────────────────────────────────────────

const BLOB_PATH = 'artifacts/backup/2026/03/08/meemawmode.db';

describe('downloadBackup', () => {
  it('returns a Uint8Array of the blob bytes on success', async () => {
    const fakeBytes = new Uint8Array([83, 81, 76, 105, 116, 101]); // "SQLite"
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => fakeBytes.buffer,
    }));

    const result = await downloadBackup('test-token', BLOB_PATH, TEST_CONFIG);

    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(fakeBytes.length);
  });

  it('passes Authorization Bearer token in request headers', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
    });
    vi.stubGlobal('fetch', mockFetch);

    await downloadBackup('my-download-token', BLOB_PATH, TEST_CONFIG);

    const [, options] = mockFetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer my-download-token');
  });

  it('includes the blob path and storage account in the request URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(4),
    });
    vi.stubGlobal('fetch', mockFetch);

    await downloadBackup('token', BLOB_PATH, TEST_CONFIG);

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain(TEST_CONFIG.storageAccount);
    expect(url).toContain(BLOB_PATH);
  });

  it('throws a descriptive error on HTTP 403', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 403, statusText: 'Forbidden',
    }));

    await expect(downloadBackup('bad-token', BLOB_PATH, TEST_CONFIG)).rejects.toThrow('403');
  });

  it('throws a descriptive error on HTTP 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 404, statusText: 'Not Found',
    }));

    await expect(downloadBackup('token', BLOB_PATH, TEST_CONFIG)).rejects.toThrow('404');
  });
});

// ─── renderAzureBackups ───────────────────────────────────────────────────────

describe('renderAzureBackups', () => {
  it('renders a sign-in button when not signed in', () => {
    renderAzureBackups({ signedIn: false });
    expect(document.getElementById('btn-azure-signin')).not.toBeNull();
  });

  it('does not show a backup table when not signed in', () => {
    renderAzureBackups({ signedIn: false });
    expect(document.querySelector('table')).toBeNull();
  });

  it('renders a loading indicator when loading is true', () => {
    renderAzureBackups({ signedIn: true }, [], true, null);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('renders an error article when error string is provided', () => {
    renderAzureBackups({ signedIn: true }, [], false, 'Failed to list: 403 Forbidden');
    expect(document.getElementById('app').innerHTML).toContain('403 Forbidden');
  });

  it('escapes HTML in the error message', () => {
    renderAzureBackups({ signedIn: true }, [], false, '<script>evil()</script>');
    expect(document.getElementById('app').innerHTML).not.toContain('<script>');
  });

  it('shows "No backups found" when signed in but backup list is empty', () => {
    renderAzureBackups({ signedIn: true }, [], false, null);
    expect(document.getElementById('app').innerHTML).toMatch(/no backups found/i);
  });

  it('renders a table row for each backup', () => {
    const backups = [
      { year: '2026', month: '03', day: '08', blobPath: 'artifacts/backup/2026/03/08/meemawmode.db' },
      { year: '2026', month: '03', day: '07', blobPath: 'artifacts/backup/2026/03/07/meemawmode.db' },
    ];
    renderAzureBackups({ signedIn: true }, backups, false, null);
    expect(document.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('shows the formatted date in each backup row', () => {
    const backups = [
      { year: '2026', month: '03', day: '08', blobPath: 'artifacts/backup/2026/03/08/meemawmode.db' },
    ];
    renderAzureBackups({ signedIn: true }, backups, false, null);
    expect(document.getElementById('app').innerHTML).toContain('2026-03-08');
  });

  it('each row has a load button with the blobPath as a data attribute', () => {
    const backups = [
      { year: '2026', month: '03', day: '08', blobPath: 'artifacts/backup/2026/03/08/meemawmode.db' },
    ];
    renderAzureBackups({ signedIn: true }, backups, false, null);
    const btn = document.querySelector('.btn-load-backup');
    expect(btn).not.toBeNull();
    expect(btn.dataset.blobPath).toBe('artifacts/backup/2026/03/08/meemawmode.db');
  });

  it('renders a sign-out button when signed in', () => {
    renderAzureBackups({ signedIn: true }, [], false, null);
    expect(document.getElementById('btn-azure-signout')).not.toBeNull();
  });
});
