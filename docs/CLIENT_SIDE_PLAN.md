# weezqlite — Client-Side Browser Version Plan

## Goal

Produce a version of weezqlite that runs entirely in the browser with no server
dependency. The user selects a local `.db` file, SQLite executes in the browser
via WebAssembly, and all rendering is done client-side. The result is a small set
of static assets that can be served from any HTTP server or deployed to a static
host (GitHub Pages, Netlify, etc.).

**The existing Python/FastAPI server version is left completely untouched.**

---

## Confirmed Decisions

| Question | Decision |
|---|---|
| Single file vs. two files | `index.html` + `app.js` (two files) |
| TDD | Yes — same discipline as server version |
| sql.js version | `1.12.0` (pinned) |
| Persistence across reloads | Yes — via IndexedDB (see section below) |
| Write restriction scope | Same as server: only the custom query view enforces SELECT-only |

---

## Isolation Strategy

All client-side code lives in a new top-level `client/` directory. Nothing under
`src/`, `tests/`, or the root `pyproject.toml` is touched. The two versions share
only the repository and the PicoCSS CDN URL.

```
weezqlite_webapp/
├── client/             ← NEW: entire client-side app lives here
│   ├── index.html
│   ├── app.js
│   ├── package.json
│   ├── vitest.config.js
│   ├── playwright.config.js
│   ├── tests/
│   │   ├── db.test.js         # unit tests for DB helper functions
│   │   ├── router.test.js     # unit tests for hash routing / parseHash
│   │   ├── persistence.test.js # unit tests for IndexedDB save/load
│   │   └── e2e/
│   │       └── app.spec.js    # Playwright end-to-end tests
│   └── README.md
├── src/weezqlite/      ← untouched
├── tests/              ← untouched
├── pyproject.toml      ← untouched
└── docs/
    ├── PLAN.md         ← untouched
    ├── STACK.md        ← untouched
    └── CLIENT_SIDE_PLAN.md  ← this file
```

---

## Technology Stack

| Concern | Choice | Rationale |
|---|---|---|
| SQLite engine | **sql.js 1.12.0** (CDN) | WASM port of SQLite; loads a DB from an `ArrayBuffer`; no special HTTP headers; CDN-available; well-tested |
| UI layer | **Vanilla JS** (no framework) | App is simple; avoids a build toolchain; all logic in one file |
| Styling | **PicoCSS v2** (same CDN as server version) | Consistent look with existing app |
| Routing | **Hash-based SPA** (`#home`, `#tables`, `#table/name`, `#query`) | No server required; browser back/forward work naturally |
| Persistence | **IndexedDB** (see below) | Stores raw DB bytes across page reloads without engine changes |
| Build tool | **None** | No bundler; static files served as-is |
| Unit tests | **Vitest** + **jsdom** | Runs in Node.js; ES module native; fast; jsdom lets us test DOM manipulation |
| E2E tests | **Playwright** | Drives a real browser against a local static server |

---

## Persistence Design: IndexedDB

### Why IndexedDB over OPFS

Two viable approaches exist for persistence:

**Option A — IndexedDB (recommended)**
- Store the raw `Uint8Array` database bytes in IndexedDB when the user loads a file
- On page load, check IndexedDB for a cached DB and offer to restore it
- Works directly with sql.js — no engine changes
- ~50 lines of straightforward async IndexedDB code
- Works in all modern browsers, no special HTTP headers

**Option B — Origin Private File System (OPFS)**
- SQLite opens a file directly in the browser's private filesystem via a VFS
- Requires switching from sql.js to `@sqlite.org/sqlite-wasm` (different API)
- The multi-threaded build requires `Cross-Origin-Embedder-Policy` +
  `Cross-Origin-Opener-Policy` headers; the single-threaded build avoids this but
  is less documented
- More complex initialization; harder to test
- Better for large databases (avoids full in-memory copy) but overkill for a
  read-only local viewer

**Decision: IndexedDB.** The app is read-only and intended for local exploration
of typically small-to-medium databases. Keeping sql.js as the engine preserves
the existing design and keeps the persistence layer simple and testable.

### IndexedDB UX

- After successfully loading a DB, silently save the bytes + filename to
  IndexedDB (store name: `weezqlite`, key: `lastDb`).
- On `DOMContentLoaded`, if `lastDb` exists in IndexedDB, show a "Restore last
  database: `<filename>`" prompt on the home screen alongside the file picker.
- A "Clear saved database" button lets the user remove the cached data.
- The cached bytes are held in an `IDBObjectStore` as:
  ```js
  { filename: string, bytes: Uint8Array, savedAt: number }
  ```

---

## Application Architecture

### `index.html`

- `<head>`: PicoCSS CDN, sql.js CDN script tag, minimal inline CSS
  (same badge / null-val / nav styles from `base.html`)
- `<body>`: nav bar (`<header>`), `<main id="app">` mount point
- `<script type="module" src="app.js">` at bottom of `<body>`

### `app.js` — logical sections

```
1.  Constants / CDN config
    - sql.js locateFile URL

2.  State
    - SQL: sql.js module instance (initialised once)
    - currentDb: Database | null
    - currentDbName: string | null

3.  Persistence helpers (IndexedDB)
    - openIdb() → IDBDatabase
    - saveDb(filename, bytes) → Promise<void>
    - loadSavedDb() → Promise<{filename, bytes} | null>
    - clearSavedDb() → Promise<void>

4.  DB helpers  ← unit-tested with Vitest
    - initSql() → Promise<void>            (loads sql.js WASM once)
    - openDatabase(bytes) → Database       (creates sql.js Database from Uint8Array)
    - listTables(db) → string[]
    - getTableSchema(db, table) → {name, type, pk, nullable}[]
    - getTableRows(db, table, offset, limit) → {columns, rows, total}
    - executeQuery(db, sql) → {columns, rows}
    - WRITE_PATTERN regex + enforcement

5.  Router
    - parseHash() → {view, params}         (unit-tested)
    - navigate(view, params)               (sets location.hash)
    - render() → Promise<void>             (dispatches to view renderers)

6.  View renderers  ← DOM tested with jsdom via Vitest
    - renderHome(savedDb)
    - renderTables()
    - renderTableDetail(tableName, page, pageSize)
    - renderQuery(sql?, result?, error?)

7.  Event handlers
    - file input → loadDatabase flow
    - restore button → loadSavedDb flow
    - nav click delegation
    - form submit delegation

8.  Bootstrap
    - DOMContentLoaded:
        1. await initSql()
        2. attach hashchange listener
        3. await render()
```

### Read-only enforcement (same as server)

```js
const WRITE_PATTERN = /^\s*(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|REPLACE|TRUNCATE|ATTACH|DETACH)\b/i;

function executeQuery(db, sql) {
    if (WRITE_PATTERN.test(sql)) {
        throw new Error("Only SELECT queries are allowed (read-only access enforced)");
    }
    const results = db.exec(sql);
    // ... normalise to {columns, rows}
}
```

Write-blocking applies only in `executeQuery` (the custom query view). Table
browsing uses internal SELECT queries that are never user-supplied.

### Pagination

Default 50 rows per page. `getTableRows` uses `SELECT COUNT(*)` then
`SELECT * FROM "t" LIMIT ? OFFSET ?` — the same pattern as the server's
`database.py`.

---

## TDD Methodology

Same discipline as the server version:

1. Write a failing test that specifies the expected behaviour
2. Write the minimum implementation to make the test pass
3. Refactor only after tests are green

### Test layers

| Layer | Tool | What's covered |
|---|---|---|
| Unit | Vitest + jsdom | DB helpers, router/hash parsing, persistence helpers, view renderers (DOM output) |
| E2E | Playwright | Full user flows in a real browser against a live static server |

### `package.json` dev dependencies

```json
{
  "devDependencies": {
    "vitest": "^2.x",
    "@vitest/coverage-v8": "^2.x",
    "jsdom": "^24.x",
    "sql.js": "^1.12.0",
    "playwright": "^1.x"
  }
}
```

`sql.js` is a dev dependency for unit tests (Node.js-compatible build); the
browser uses the CDN version.

### Test commands

```bash
# Install (from client/ directory)
npm install

# Unit tests (watch mode)
npx vitest

# Unit tests (CI / one-shot)
npx vitest run

# E2E tests (requires static server to be running)
npx playwright test
```

### Key test cases to write (before implementation)

**`tests/db.test.js`**
- `listTables` returns correct table names from a fixture DB
- `listTables` returns `[]` for an empty DB
- `getTableSchema` returns correct column metadata including PK flag
- `getTableSchema` throws for a non-existent table
- `getTableRows` returns correct rows and total
- `getTableRows` respects LIMIT/OFFSET
- `executeQuery` returns columns + rows for a valid SELECT
- `executeQuery` throws for INSERT / UPDATE / DROP / CREATE / etc.
- `executeQuery` throws for an empty / malformed query

**`tests/router.test.js`**
- `parseHash('')` → `{view: 'home', params: {}}`
- `parseHash('#home')` → `{view: 'home', params: {}}`
- `parseHash('#tables')` → `{view: 'tables', params: {}}`
- `parseHash('#table/users')` → `{view: 'table', params: {name: 'users'}}`
- `parseHash('#table/users?page=3&page_size=25')` → correct page/pageSize

**`tests/persistence.test.js`**
- `saveDb` / `loadSavedDb` round-trip returns same bytes and filename
- `loadSavedDb` returns `null` when nothing is stored
- `clearSavedDb` removes stored data so subsequent `loadSavedDb` returns `null`

**`tests/e2e/app.spec.js`** (Playwright)
- Home page renders file input and no error
- Loading a valid DB navigates to tables view and shows table names
- Loading an empty (zero-byte) file shows an error message
- Loading a non-SQLite file shows an error message
- Browsing a table shows schema and paginated rows
- Previous/Next pagination changes the displayed rows
- Custom SELECT query returns results
- Custom INSERT/DROP query shows the read-only error
- After reload, home page offers to restore the last DB
- Restoring the saved DB re-opens to the tables view

---

## Implementation Phases (TDD sequence)

### Phase 1 — Project scaffold

- Create `client/` directory
- Create `package.json` with dev dependencies
- Create `vitest.config.js` (jsdom environment, coverage)
- Create `playwright.config.js` (chromium, base URL on localhost:8080)
- Create `tests/` stubs
- Create `client/index.html` shell (CDN links, `<main id="app">`, script tag)
- Create `app.js` stub (state variables, empty exported functions for testability)

### Phase 2 — DB helpers (TDD)

1. Write `tests/db.test.js` (all cases failing)
2. Implement `openDatabase`, `listTables`, `getTableSchema`, `getTableRows`,
   `executeQuery` in `app.js`
3. Tests pass

### Phase 3 — Router (TDD)

1. Write `tests/router.test.js` (all cases failing)
2. Implement `parseHash` and `navigate` in `app.js`
3. Tests pass

### Phase 4 — Persistence helpers (TDD)

1. Write `tests/persistence.test.js` (all cases failing)
2. Implement `openIdb`, `saveDb`, `loadSavedDb`, `clearSavedDb` in `app.js`
3. Tests pass

### Phase 5 — View renderers (TDD)

1. Write Vitest DOM tests for each renderer (check key HTML elements are present)
2. Implement `renderHome`, `renderTables`, `renderTableDetail`, `renderQuery`
3. Tests pass

### Phase 6 — Bootstrap & event wiring

- Wire `DOMContentLoaded`, `hashchange`, file input, form submit, restore button
- Manual smoke test with a real `.db` file

### Phase 7 — E2E tests (TDD)

1. Write `tests/e2e/app.spec.js` (all cases failing without implementation)
2. Ensure all E2E cases pass against the running static server
3. Fix any gaps in implementation

### Phase 8 — Documentation

- Write `client/README.md`:
  - How to run: `python3 -m http.server --directory client 8080`
  - How to run tests: `npm install && npx vitest run && npx playwright test`
  - Why `file://` is not supported (WASM loading restriction)
  - Note that the DB file never leaves the browser
  - Persistence behaviour: IndexedDB stores the bytes for the most recent DB

---

## Feature Parity Table

| Server feature | Client-side equivalent |
|---|---|
| Upload via `<input type="file">` | Same — file never leaves the browser |
| Server stores file in `/tmp` | sql.js holds DB in memory; IndexedDB persists across reloads |
| `list_tables` via aiosqlite | `SELECT name FROM sqlite_master WHERE type='table'` via sql.js |
| `get_table_schema` via PRAGMA | `PRAGMA table_info(table)` via sql.js |
| `get_table_rows` paginated | `SELECT * FROM "t" LIMIT ? OFFSET ?` via sql.js |
| `execute_query` with SELECT-only guard | Same regex in JS before `db.exec()` |
| Jinja2 server-side rendering | JS DOM construction in view renderers |
| URL routing via FastAPI | Hash-based routing (`hashchange` event) |
| PicoCSS styling | Same CDN link, same badge / null-val CSS |

---

## How to Run Both Versions Side-by-Side

```bash
# Server version (existing, unchanged) — port 8000
uv run uvicorn weezqlite.main:create_app --factory --reload --port 8000

# Client-side version (new) — port 8080
python3 -m http.server --directory client 8080
# open http://localhost:8080
```

---

## What is NOT Changed

- `src/weezqlite/` — zero changes
- `tests/` — zero changes
- `pyproject.toml` / `uv.lock` — zero changes
- `CLAUDE.md` — zero changes
- `docs/PLAN.md` / `docs/STACK.md` — zero changes
