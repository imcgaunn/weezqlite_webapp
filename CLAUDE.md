# CLAUDE.md — weezqlite webapp

This file records development methodology, architectural decisions, and conventions
for the weezqlite sqlite3 database viewer webapp.

---

## Project Overview

A client-side single-page application for exploring a SQLite3 database file.
The database runs entirely in the browser via sql.js (WASM) — no server required.
Users upload a `.db` file (or load one from Azure Blob Storage), then browse
tables, inspect schemas, view paginated data, sort columns, and run custom SQL queries.

## Stack

| Component | Choice |
|---|---|
| Runtime | Browser (no server) |
| SQLite engine | sql.js 1.12 (WASM, CDN) |
| Styling | PicoCSS v2 (CDN) |
| Auth (Azure) | MSAL.js v3 (CDN) |
| Testing | Vitest + Playwright |
| Package manager | npm (client/ only) |

## Development Methodology: TDD

**This project strictly follows Test-Driven Development.**

The required sequence for every feature is:
1. Write a failing test that specifies the expected behavior
2. Write the minimum implementation code to make the test pass
3. Refactor only after tests are green

Do not write implementation code without a corresponding test first.

## Project Layout

```
client/              # SPA source and tests
  app.js             # all application logic (db helpers, router, renderers, bootstrap)
  config.js          # Azure config (not checked in — copy from config.example.js)
  index.html         # shell HTML + inline CSS
  tests/             # Vitest unit tests + Playwright e2e
docs/                # historical documentation (STACK.md, PLAN.md)
```

## Key Architectural Decisions

- **No server**: sql.js runs SQLite in WASM in the browser. No backend needed.
- **Hash router**: All navigation uses `window.location.hash`; the URL is shareable
  and bookmarkable within a session.
- **Read-only enforcement**: `executeQuery` rejects any non-SELECT SQL via
  `WRITE_PATTERN` regex before it reaches sql.js.
- **IndexedDB persistence**: The last-opened database is cached in IndexedDB so it
  survives page reloads.
- **Azure Blob Storage**: Optional MSAL-authenticated flow to browse and load nightly
  backup `.db` files from Azure.
- **Pagination default**: 50 rows per page; user-selectable (25/50/100/500).
- **Sortable columns**: ORDER BY is built server-side (in sql.js), column name
  validated against PRAGMA table_info before use.
- **PicoCSS for styling**: Semantic HTML + PicoCSS v2 (CDN). Custom CSS is minimal.

## Running the Project

```bash
cd client

# Install dev dependencies (Vitest, Playwright)
npm install

# Run unit tests
npm test

# Run e2e tests
npx playwright test

# Serve locally (any static file server, e.g.)
npx serve .
```

## Notes

- Historical Python/FastAPI implementation plan is in `docs/PLAN.md`.
- Stack choices from the original design are in `docs/STACK.md`.
