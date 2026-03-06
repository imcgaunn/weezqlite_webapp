"""
Async database operations using aiosqlite.

All public functions accept a db_path (Path or str) and raise DatabaseError
on any failure — missing file, invalid database, bad table name, etc.

execute_query enforces read-only access: only SELECT statements are allowed.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import aiosqlite
import structlog

log = structlog.get_logger(__name__)

_WRITE_PATTERN = re.compile(
    r"^\s*(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|REPLACE|TRUNCATE|ATTACH|DETACH)\b",
    re.IGNORECASE,
)


class DatabaseError(Exception):
    """Raised for any database-related error in this module."""


def _db_path(db_path: Path | str) -> Path:
    p = Path(db_path)
    if not p.exists():
        raise DatabaseError(f"Database file not found: {p}")
    return p


async def list_tables(db_path: Path | str) -> list[str]:
    """Return the names of all user tables in the database."""
    p = _db_path(db_path)
    try:
        async with aiosqlite.connect(p) as db:
            cursor = await db.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
            rows = await cursor.fetchall()
            return [row[0] for row in rows]
    except DatabaseError:
        raise
    except Exception as exc:
        log.error("list_tables failed", db_path=str(p), error=str(exc))
        raise DatabaseError(str(exc)) from exc


async def get_table_schema(
    db_path: Path | str, table: str
) -> list[dict[str, Any]]:
    """
    Return column metadata for `table`.

    Each entry is a dict with keys: name, type, pk (bool), nullable (bool).
    Raises DatabaseError if the table does not exist.
    """
    p = _db_path(db_path)
    try:
        async with aiosqlite.connect(p) as db:
            # PRAGMA table_info raises no error for unknown tables — it just
            # returns no rows, so we need to check explicitly.
            cursor = await db.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                (table,),
            )
            if await cursor.fetchone() is None:
                raise DatabaseError(f"Table not found: {table!r}")

            cursor = await db.execute(f"PRAGMA table_info({table})")  # noqa: S608
            rows = await cursor.fetchall()
            # PRAGMA table_info columns: cid, name, type, notnull, dflt_value, pk
            return [
                {
                    "name": row[1],
                    "type": row[2],
                    "nullable": not bool(row[3]),
                    "pk": bool(row[5]),
                }
                for row in rows
            ]
    except DatabaseError:
        raise
    except Exception as exc:
        log.error("get_table_schema failed", db_path=str(p), table=table, error=str(exc))
        raise DatabaseError(str(exc)) from exc


async def get_table_rows(
    db_path: Path | str,
    table: str,
    offset: int,
    limit: int,
) -> dict[str, Any]:
    """
    Return paginated rows from `table`.

    Returns a dict with keys:
      - columns: list of column names
      - rows: list of row tuples
      - total: total row count (ignoring pagination)
    """
    p = _db_path(db_path)
    try:
        async with aiosqlite.connect(p) as db:
            # Validate table exists
            cursor = await db.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                (table,),
            )
            if await cursor.fetchone() is None:
                raise DatabaseError(f"Table not found: {table!r}")

            # Total count
            cursor = await db.execute(f"SELECT COUNT(*) FROM \"{table}\"")  # noqa: S608
            (total,) = await cursor.fetchone()

            # Paginated rows with column names
            cursor = await db.execute(
                f"SELECT * FROM \"{table}\" LIMIT ? OFFSET ?",  # noqa: S608
                (limit, offset),
            )
            columns = [desc[0] for desc in cursor.description]
            rows = await cursor.fetchall()

            return {"columns": columns, "rows": [list(r) for r in rows], "total": total}
    except DatabaseError:
        raise
    except Exception as exc:
        log.error("get_table_rows failed", db_path=str(p), table=table, error=str(exc))
        raise DatabaseError(str(exc)) from exc


async def execute_query(
    db_path: Path | str, sql: str
) -> dict[str, Any]:
    """
    Execute a read-only SQL query and return results.

    Only SELECT statements are allowed. Raises DatabaseError with "read-only"
    in the message for any other statement type.

    Returns a dict with keys:
      - columns: list of column names
      - rows: list of row lists
    """
    p = _db_path(db_path)

    if _WRITE_PATTERN.match(sql):
        raise DatabaseError(
            "Only SELECT queries are allowed (read-only access enforced)"
        )

    try:
        async with aiosqlite.connect(p) as db:
            cursor = await db.execute(sql)
            columns = [desc[0] for desc in cursor.description] if cursor.description else []
            rows = await cursor.fetchall()
            return {"columns": columns, "rows": [list(r) for r in rows]}
    except DatabaseError:
        raise
    except Exception as exc:
        log.error("execute_query failed", db_path=str(p), sql=sql, error=str(exc))
        raise DatabaseError(str(exc)) from exc
