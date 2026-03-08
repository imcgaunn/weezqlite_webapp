# weezqlite — Azure Backup Browser Plan

## Goal

Extend the client-side browser version of weezqlite to browse and open the nightly
SQLite backups of `meemawmode` stored in Azure Blob Storage. The user authenticates
via their personal Microsoft account (MSAL.js / OAuth2 PKCE), sees a list of
available backup dates, and clicks one to load it directly into the existing
browser-side SQLite viewer.

**The existing local file-upload flow is left completely untouched. Azure backup
browsing is purely additive.**

---

## Storage Layout

| Parameter | Value |
|---|---|
| Storage account | `mcgaunnweb` |
| Container | `artifacts` |
| Blob path pattern | `artifacts/backup/{YYYY}/{MM}/{DD}/meemawmode.db` |
| Example blob | `artifacts/backup/2026/03/08/meemawmode.db` |

---

## Architecture Overview

| Concern | Approach |
|---|---|
| Authentication | MSAL.js (browser-side OAuth2 PKCE) — no backend proxy needed |
| Token scope | `https://storage.azure.com/user_impersonation` |
| Storage access | Azure Blob Storage REST API called directly from the browser with a Bearer token |
| CORS | Must be configured on `mcgaunnweb` to allow browser requests |
| Backup listing | Azure List Blobs API with prefix `artifacts/backup/` |
| Backup download | `fetch()` blob → `ArrayBuffer` → `Uint8Array` → existing `openDatabase()` |
| Audience | Single user, personal Microsoft account only |

No backend changes. No new server process. Everything runs in the browser.

---

## Prerequisites

### Step 1 — Create an Azure AD App Registration

1. Sign in to [portal.azure.com](https://portal.azure.com) with your personal
   Microsoft account.
2. Search for **"App registrations"** and click **New registration**.
3. Fill in:
   - **Name**: `weezqlite-client` (or any name you prefer)
   - **Supported account types**: **"Personal Microsoft accounts only"**
   - **Redirect URI**:
     - Platform: **Single-page application (SPA)** ← important; this enables PKCE
     - URI: `http://localhost:8080`
     - Add additional URIs later if/when the app is hosted elsewhere
4. Click **Register**.
5. On the **Overview** page, copy and save:
   - **Application (client) ID** — goes into `client/config.js`
6. Go to **API permissions** → **Add a permission**:
   - Choose **Azure Storage**
   - Select **Delegated permissions**
   - Check `user_impersonation`
   - Click **Add permissions**
7. No admin consent grant is needed for personal account delegated scopes.

> **Why SPA (not Web)?** SPA app registrations use the PKCE extension for OAuth2,
> which is designed for public clients (browser apps) that cannot safely hold a
> client secret. There is no client secret involved anywhere.

---

### Step 2 — Assign RBAC Role on the Storage Account

The signed-in user needs permission to list and read blobs:

1. Go to the `mcgaunnweb` storage account in the Azure portal.
2. Click **Access Control (IAM)** → **Add role assignment**.
3. Role: **Storage Blob Data Reader**
4. Assign access to: **User, group, or service principal**
5. Select: your personal Microsoft account (search by email address).
6. Save.

> Alternatively, assign the role at the `artifacts` container level for narrower
> scope: go to the container → **Access Control (IAM)** and repeat the steps above.

---

### Step 3 — Configure CORS on the Storage Account

CORS must be enabled so the browser can make authenticated cross-origin requests
directly to Azure Blob Storage.

**Via Azure portal:**

1. Go to the `mcgaunnweb` storage account → **Resource sharing (CORS)**
   (under the Settings section in the left panel).
2. Select the **Blob service** tab.
3. Add a CORS rule:

| Setting | Value |
|---|---|
| Allowed origins | `http://localhost:8080` (add production origin when known) |
| Allowed methods | `GET, HEAD, OPTIONS` |
| Allowed headers | `Authorization, Content-Type, x-ms-date, x-ms-version, x-ms-client-request-id` |
| Exposed headers | `Content-Length, Content-Type, ETag, Last-Modified` |
| Max age (seconds) | `3600` |

4. Save.

**Via Azure CLI (alternative):**

```bash
az storage cors add \
  --account-name mcgaunnweb \
  --services b \
  --methods GET HEAD OPTIONS \
  --origins "http://localhost:8080" \
  --allowed-headers "Authorization,Content-Type,x-ms-date,x-ms-version,x-ms-client-request-id" \
  --exposed-headers "Content-Length,Content-Type,ETag,Last-Modified" \
  --max-age 3600
```

> When the app is deployed to a production host, add that origin to the CORS rule
> (or use `*` for development convenience, then tighten for production).

---

## New Code Structure

```
client/
├── index.html              ← add MSAL.js CDN script tag
├── app.js                  ← add auth, listing, download functions + new view + new route
├── config.js               ← NEW (git-ignored): tenant/client ID, storage coords
├── config.example.js       ← NEW (committed): placeholder values with comments
├── package.json            ← add msw (for mocking fetch in tests)
└── tests/
    ├── azure.test.js       ← NEW: auth helpers, listBackups, downloadBackup, renderAzureBackups
    ├── db.test.js          ← unchanged
    ├── router.test.js      ← add #backups route cases
    ├── persistence.test.js ← unchanged
    └── views.test.js       ← unchanged
```

---

## `config.js` / `config.example.js`

`client/config.js` is added to `.gitignore`. A committed `config.example.js`
documents the shape:

```js
// client/config.example.js — copy to config.js and fill in values
export const AZURE_CONFIG = {
  // Application (client) ID from the Azure AD app registration
  clientId: 'YOUR_CLIENT_ID_HERE',

  // For personal Microsoft accounts only
  authority: 'https://login.microsoftonline.com/consumers',

  // Must exactly match one of the Redirect URIs in the app registration
  redirectUri: 'http://localhost:8080',

  // Azure Blob Storage coordinates
  storageAccount: 'mcgaunnweb',
  container: 'artifacts',
  backupPrefix: 'artifacts/backup/',
};
```

`app.js` imports `AZURE_CONFIG` from `./config.js`. If `config.js` is absent
(fresh clone), the Azure Backups feature shows a configuration-error message
instead of crashing the rest of the app.

---

## New Functions in `app.js`

### Auth helpers

```
initMsal(config)         Creates a msal.PublicClientApplication; stores on state.msalApp.
                         Called once in bootstrap() alongside initSql().

signIn()                 msalApp.loginPopup({ scopes: [STORAGE_SCOPE] })
                         Stores the returned account on state.azureAccount.

signOut()                msalApp.logoutPopup()
                         Clears state.azureAccount.

getStorageToken()        acquireTokenSilent first; falls back to acquireTokenPopup.
                         Returns the raw access token string.
                         Throws if auth fails.
```

### Backup listing

```
listBackups(token)       GET https://<account>.blob.core.windows.net/<container>
                           ?restype=container&comp=list
                           &prefix=artifacts/backup/
                           &delimiter=/
                         Authorization: Bearer <token>
                         x-ms-version: 2020-10-02

                         Parses the XML response (DOMParser).
                         Extracts blob paths matching the full date pattern.
                         Returns: [{ year, month, day, blobPath }, ...]
                           sorted newest-first.
                         Throws a descriptive Error on non-2xx HTTP status.
```

### Backup download

```
downloadBackup(token, blobPath)
                         GET https://<account>.blob.core.windows.net/<container>/<blobPath>
                         Authorization: Bearer <token>
                         x-ms-version: 2020-10-02

                         Returns a Uint8Array of the raw SQLite file bytes.
                         Throws on non-2xx HTTP status.
                         Caller passes the bytes to the existing openDatabase().
```

### New view renderer

```
renderAzureBackups(authState, backups, loading, error)

  authState.signedIn === false  → renders "Sign in with Microsoft" button
  loading === true              → renders spinner / "Loading backups…" message
  error !== null                → renders error article (reuses existing errorArticle())
  backups.length === 0          → renders "No backups found" message
  backups.length > 0            → renders table of dated backup links sorted newest-first
```

---

## New Hash Route

`#backups` is added to:
- `parseHash()`: returns `{ view: 'backups', params: {} }`
- `render()` switch: calls `renderAzureBackups(...)`
- Nav bar: always-visible "Azure Backups" link (not gated on `state.currentDb`)

---

## Full Data Flow

```
User clicks "Azure Backups" in nav
  → navigate('#backups')
  → render() → renderAzureBackups({ signedIn: false }, [], false, null)

User clicks "Sign in with Microsoft"
  → signIn()  [MSAL popup opens; user authenticates]
  → state.azureAccount = account
  → getStorageToken()  [acquires token for https://storage.azure.com/user_impersonation]
  → listBackups(token)
      GET https://mcgaunnweb.blob.core.windows.net/artifacts
          ?restype=container&comp=list&prefix=artifacts/backup/&delimiter=/
      → parses XML → [{ year:'2026', month:'03', day:'08', blobPath:'...' }, ...]
  → renderAzureBackups({ signedIn: true }, backups, false, null)

User clicks a backup date
  → downloadBackup(token, 'artifacts/backup/2026/03/08/meemawmode.db')
      GET https://mcgaunnweb.blob.core.windows.net/artifacts/artifacts/backup/2026/03/08/meemawmode.db
      → Uint8Array(bytes)
  → openDatabase(bytes)
  → state.currentDb = db
  → state.currentDbName = 'meemawmode-2026-03-08.db'
  → navigate('#tables')   [existing tables view renders as normal]
```

---

## Azure Blob Storage REST API Reference

### List blobs

```
GET https://mcgaunnweb.blob.core.windows.net/artifacts
    ?restype=container
    &comp=list
    &prefix=artifacts/backup/
    &delimiter=/
Authorization: Bearer <token>
x-ms-version: 2020-10-02
x-ms-date: <RFC1123 UTC date>
```

Response is XML. Each `<Blob>` element contains a `<Name>` child with the full
blob path. We filter for paths that match the pattern
`artifacts/backup/YYYY/MM/DD/meemawmode.db` using a regex and extract the date
components.

### Download blob

```
GET https://mcgaunnweb.blob.core.windows.net/artifacts/artifacts/backup/2026/03/08/meemawmode.db
Authorization: Bearer <token>
x-ms-version: 2020-10-02
```

Response body is the raw bytes of the SQLite file. Read as `arrayBuffer()`, then
`new Uint8Array(buf)`.

---

## TDD Test Plan

### New test file: `tests/azure.test.js`

All tests are written (failing) before the corresponding implementation.

**Auth helpers — mock `msal.PublicClientApplication`:**
- `getStorageToken` returns the token from `acquireTokenSilent` when successful
- `getStorageToken` falls back to `acquireTokenPopup` when silent throws
  `InteractionRequiredAuthError`
- `getStorageToken` propagates errors from popup flow
- `signIn` sets `state.azureAccount` on success
- `signOut` clears `state.azureAccount`

**`listBackups` — mock `fetch`:**
- Parses a sample XML list-blobs response and returns correct
  `[{ year, month, day, blobPath }]` array
- Sorts results newest-first
- Returns `[]` for an XML response with no matching blobs
- Throws a descriptive error string when HTTP status is 403
- Throws a descriptive error string when HTTP status is 404
- Passes `Authorization: Bearer <token>` header in the request

**`downloadBackup` — mock `fetch`:**
- Returns a `Uint8Array` of the correct byte length on success
- Throws on HTTP 403
- Throws on HTTP 404
- Passes `Authorization: Bearer <token>` header in the request

**`renderAzureBackups` — jsdom DOM tests:**
- Renders a "Sign in" button when `authState.signedIn === false`
- Renders a loading indicator when `loading === true`
- Renders an error article when `error` is a non-empty string
- Renders "No backups found" when backups array is `[]` and signed in
- Renders a table row for each backup when array is non-empty
- Each row contains the formatted date and a clickable element

**Router additions:**
- `parseHash('#backups')` → `{ view: 'backups', params: {} }`

### Updates to existing test files

**`tests/router.test.js`:** add `#backups` cases (see above).

---

## Implementation Phases

Each phase follows the TDD sequence: write failing tests → implement → green.

### Phase 1 — Config scaffold

- Create `client/config.example.js` with placeholder values and comments
- Add `client/config.js` to `client/.gitignore`
- Add MSAL.js CDN script tag to `index.html`
  (`https://alcdn.msauth.net/browser/3.x.x/js/msal-browser.min.js`, pin version)
- Add `#backups` to `parseHash` and the `render()` switch (stub renderer)
- Add "Azure Backups" nav link

### Phase 2 — Auth (TDD)

1. Write failing tests for `initMsal`, `signIn`, `signOut`, `getStorageToken`
2. Implement auth helpers in `app.js` using `msal.PublicClientApplication`
3. Tests pass

### Phase 3 — Backup listing (TDD)

1. Write failing tests for `listBackups` (XML parsing + HTTP error cases)
2. Implement `listBackups` (fetch + `DOMParser` for XML)
3. Tests pass

### Phase 4 — Backup download (TDD)

1. Write failing tests for `downloadBackup`
2. Implement `downloadBackup` (fetch → `arrayBuffer()` → `Uint8Array`)
3. Tests pass

### Phase 5 — View renderer (TDD)

1. Write failing DOM tests for `renderAzureBackups`
2. Implement `renderAzureBackups` in `app.js`
3. Tests pass

### Phase 6 — Wiring and integration

- Wire sign-in button, backup list click, sign-out in the delegated event
  handlers in `bootstrap()`
- Integrate token acquisition + `listBackups` call on the `#backups` route
- Integrate `downloadBackup` → `openDatabase` → `navigate('#tables')` on backup click
- Manual smoke test: sign in, list backups, open one, browse tables

### Phase 7 — E2E tests (Playwright)

Add cases to `tests/e2e/app.spec.js`:
- `#backups` unauthenticated: "Sign in" button is visible
- After sign-in: list of backup dates renders
- Clicking a backup: navigates to `#tables` and shows table names
- Sign-out clears state and returns to sign-in prompt

> Note: E2E auth tests against a real Azure AD tenant require additional
> Playwright setup (stored auth state or a test account). It is acceptable to
> mock the MSAL layer for automated E2E and reserve real-credential smoke testing
> for manual verification.

---

## What is NOT Changed

- `src/weezqlite/` — zero changes
- `tests/` (Python) — zero changes
- `pyproject.toml` / `uv.lock` — zero changes
- `CLAUDE.md` — zero changes
- `docs/PLAN.md` / `docs/STACK.md` / `docs/CLIENT_SIDE_PLAN.md` — zero changes
- Local file upload flow — fully preserved; Azure backups are an additive feature
