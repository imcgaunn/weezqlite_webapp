# CLAUDE.md — weezqlite webapp

This file records development methodology, architectural decisions, and conventions
for the weezqlite sqlite3 database viewer webapp.

---

## Project Overview

A simple web application for exploring a sqlite3 database file. Users provide a
database file path, then browse tables, inspect schemas, view paginated data, and
run custom SQL queries.

## Stack

| Component | Choice |
|---|---|
| Runtime | Python 3.13+ |
| Package manager | uv |
| Web framework | FastAPI |
| Database access | aiosqlite |
| Templating | Jinja2 |
| Logging | structlog |
| Testing | pytest + pytest-asyncio + httpx |

## Development Methodology: TDD

**This project strictly follows Test-Driven Development.**

The required sequence for every feature is:
1. Write a failing test that specifies the expected behavior
2. Write the minimum implementation code to make the test pass
3. Refactor only after tests are green

Do not write implementation code without a corresponding test first.

## Project Layout

```
src/weezqlite/       # application source (src layout)
tests/               # pytest tests
docs/                # documentation (STACK.md, PLAN.md)
```

Full structure is documented in `docs/PLAN.md`.

## Key Architectural Decisions

- **Async throughout**: All database operations use aiosqlite; all FastAPI route
  handlers are async.
- **No ORM**: Direct SQL via aiosqlite — simple and transparent.
- **Read-only query enforcement**: Custom query execution (`/db/query`) must reject
  any SQL that is not a SELECT statement. This is enforced in `database.py`, not
  just the route handler.
- **No authentication**: v1 is intended for local/trusted use only.
- **File path as primary input**: The user provides a server-accessible file path.
  File upload is a stretch goal.
- **Pagination default**: 50 rows per page for table data views.
- **src layout**: Source lives under `src/weezqlite/` to keep it separate from
  tests and config.
- **PicoCSS for styling**: Templates use PicoCSS v2 (CDN) for responsive design
  and semantic HTML styling. Custom CSS is kept to a minimum (badges, null value
  display, nav tweaks). No hand-rolled responsive layout.

## Implementation Order

Always follow this sequence (each step is test-first):

1. `pyproject.toml` — project and dependency setup
2. `tests/conftest.py` — shared fixtures
3. Database layer: `tests/test_database.py` then `src/weezqlite/database.py`
4. Home route: `tests/test_routes_home.py` then `src/weezqlite/routes/home.py`
5. Tables routes: `tests/test_routes_tables.py` then `src/weezqlite/routes/tables.py`
6. Query route: `tests/test_routes_query.py` then `src/weezqlite/routes/query.py`
7. App wiring: `src/weezqlite/main.py`
8. Templates: `src/weezqlite/templates/`
9. End-to-end smoke test

## Running the Project

```bash
# Install dependencies
uv sync

# Run tests
uv run pytest

# Start dev server
uv run uvicorn weezqlite.main:create_app --factory --reload
```

## Notes

- The full implementation plan is in `docs/PLAN.md`.
- Stack choices are documented in `docs/STACK.md`.
