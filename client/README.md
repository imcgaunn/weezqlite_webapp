# weezqlite — client-side version

A fully browser-based SQLite3 viewer. No server required.
SQLite runs in the browser via [sql.js](https://github.com/sql-js/sql.js) (WebAssembly).
The database file never leaves your browser.

## Running

```bash
# From the client/ directory:
python3 -m http.server 8080
# then open http://localhost:8080
```

Or with Node.js:
```bash
npx serve .
```

> **Why not `file://`?**
> Browsers block cross-origin WASM loading when using the `file://` protocol.
> Always serve from a local HTTP server.

## Usage

1. Click **Open Database** and select a local `.db`, `.sqlite`, or `.sqlite3` file.
2. Browse tables, inspect schemas, and page through data.
3. Use the **Query** tab to run read-only `SELECT` statements.

The last-opened database is automatically saved in IndexedDB so you can restore it on the next visit without re-uploading the file.

## Testing

```bash
# Install dev dependencies
npm install

# Unit + DOM tests (Vitest)
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run coverage

# End-to-end tests (Playwright — Chromium)
# Requires a local static server on port 8080:
python3 -m http.server 8080 &
npm run test:e2e

# Install Playwright browsers on first run:
npx playwright install chromium
```

## Architecture

| File | Purpose |
|---|---|
| `index.html` | Shell: CDN links, nav skeleton, `<main id="app">` mount point |
| `app.js` | All application logic — DB helpers, router, persistence, view renderers, bootstrap |

### Key design decisions

- **sql.js 1.12.0**: Loads the entire `.db` file into memory as a `Uint8Array`. Read-only by design; writes are in-memory only.
- **Hash-based routing**: `#home`, `#tables`, `#table/<name>`, `#query`. Browser back/forward work naturally.
- **IndexedDB persistence**: Raw bytes of the last-opened DB are stored under the key `lastDb` in the `weezqlite` object store. Stored bytes allow re-opening the DB across page reloads without re-uploading.
- **Read-only enforcement**: `executeQuery` rejects any SQL matching `INSERT | UPDATE | DELETE | DROP | CREATE | ALTER | REPLACE | TRUNCATE | ATTACH | DETACH` before it reaches sql.js.
- **No build tool**: Plain ES modules, no bundler. Just serve the two files.

## Compatibility

Any modern browser with WebAssembly support (Chrome 57+, Firefox 53+, Safari 11+, Edge 16+).
