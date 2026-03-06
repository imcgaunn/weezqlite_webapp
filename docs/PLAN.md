# weezqlite webapp - Implementation Plan

## Goal

A simple web application that allows a user to explore a sqlite3 database file.
Users can upload or specify a database file, then browse tables, inspect schemas,
view paginated table data, and run custom SQL queries.

## Stack

- Python 3.13+ with uv for project management
- pytest for testing (TDD methodology)
- aiosqlite for async sqlite3 interaction
- FastAPI for API routes and request handling
- Jinja2 for server-side HTML templating
- structlog for structured logging

## Development Methodology

This project uses Test-Driven Development (TDD):
1. Write a failing test that defines the expected behavior
2. Write the minimum implementation to make the test pass
3. Refactor if needed, keeping tests green

All features must have tests written before implementation code.

---

## Project Structure

```
weezqlite_webapp/
├── pyproject.toml
├── CLAUDE.md
├── src/
│   └── weezqlite/
│       ├── __init__.py
│       ├── main.py            # FastAPI app factory and startup
│       ├── config.py          # App configuration (upload dir, etc.)
│       ├── database.py        # aiosqlite-based database operations
│       ├── logging.py         # structlog configuration
│       ├── routes/
│       │   ├── __init__.py
│       │   ├── home.py        # File upload / DB selection UI
│       │   ├── tables.py      # Table listing, schema, paginated data
│       │   └── query.py       # Custom SQL query execution
│       └── templates/
│           ├── base.html      # Base layout with nav
│           ├── index.html     # Home page: file upload/path input
│           ├── tables.html    # List of all tables in the DB
│           ├── table.html     # Single table: schema + paginated rows
│           └── query.html     # SQL query editor + results
├── tests/
│   ├── conftest.py            # Shared fixtures (test DB, async client)
│   ├── test_database.py       # Unit tests for database.py operations
│   ├── test_routes_home.py    # Tests for upload/file-selection flow
│   ├── test_routes_tables.py  # Tests for table listing and data routes
│   └── test_routes_query.py   # Tests for query execution route
└── docs/
    ├── STACK.md
    └── PLAN.md
```

---

## Features

### Phase 1 - Project Setup
- Initialize uv project (`uv init`)
- Add dependencies: fastapi, aiosqlite, jinja2, structlog, uvicorn
- Add dev dependencies: pytest, pytest-asyncio, httpx (for async test client)
- Configure pyproject.toml with test settings and src layout

### Phase 2 - Database Layer (TDD)

`src/weezqlite/database.py` — all functions are async, use aiosqlite:

| Function | Description |
|---|---|
| `list_tables(db_path)` | Returns list of table names in the DB |
| `get_table_schema(db_path, table)` | Returns column info (name, type, pk, nullable) |
| `get_table_rows(db_path, table, offset, limit)` | Returns paginated rows + total row count |
| `execute_query(db_path, sql)` | Executes a read-only SQL query, returns columns + rows |

Tests cover: valid DB, missing file, empty DB, tables with various types,
pagination edge cases, malformed SQL, and write-statement rejection.

### Phase 3 - API Routes (TDD)

#### `GET /` — Home
- Renders `index.html` with a form to provide a sqlite3 file path or upload a file
- Session or query param carries the active DB path through the app

#### `POST /db` — Set active database
- Accepts a file upload or a file path string
- Validates the file is a valid sqlite3 database
- Stores the path in a server-side session or redirects with a path param
- Returns 400 with an error message if the file is invalid

#### `GET /db/tables` — Table list
- Lists all tables in the active database
- Renders `tables.html` with links to each table

#### `GET /db/tables/{table_name}` — Table detail
- Shows table schema (columns, types, constraints)
- Shows paginated rows (query params: `page`, `page_size`, default 50)
- Renders `table.html`

#### `GET /db/query` — Query form
- Renders `query.html` with a SQL editor textarea

#### `POST /db/query` — Execute query
- Accepts a SQL string
- Rejects non-SELECT statements (returns 400)
- Returns results rendered in `query.html`

### Phase 4 - Templates

Minimal, functional HTML using Jinja2:
- `base.html`: nav bar with links to Tables and Query pages; shows active DB name
- `index.html`: file path input + file upload form
- `tables.html`: table list with row counts
- `table.html`: schema section + paginated data table with prev/next controls
- `query.html`: textarea for SQL + results table (columns + rows)

No external CSS framework required initially; inline or minimal CSS only.

### Phase 5 - Logging

Configure structlog in `logging.py`:
- JSON output in production, human-readable console output in development
- Log each request (route, db_path, duration)
- Log database errors with context (db_path, sql if applicable)

---

## Implementation Order (per TDD)

1. `pyproject.toml` — project + dependency setup
2. `tests/conftest.py` — shared fixtures (tmp sqlite DB, async test client)
3. `tests/test_database.py` + `src/weezqlite/database.py`
4. `tests/test_routes_home.py` + `src/weezqlite/routes/home.py`
5. `tests/test_routes_tables.py` + `src/weezqlite/routes/tables.py`
6. `tests/test_routes_query.py` + `src/weezqlite/routes/query.py`
7. `src/weezqlite/main.py` — wire together app, routers, templates, logging
8. `src/weezqlite/templates/` — implement all templates
9. End-to-end smoke test with a real sqlite3 file

---

## Key Decisions

- **Async throughout**: aiosqlite + FastAPI async handlers keep the server non-blocking.
- **No ORM**: Direct SQL via aiosqlite keeps things simple and transparent.
- **Read-only query enforcement**: `execute_query` rejects any SQL that isn't a SELECT to prevent accidental writes.
- **No auth**: Out of scope for v1; the app is intended for local/trusted use.
- **File path over upload for v1**: Accept a server-accessible file path as the primary method; file upload is a stretch goal.
- **Pagination default 50 rows**: Prevents rendering huge tables in the browser.
- **src layout**: Keeps source separate from tests and config, consistent with modern Python packaging.
