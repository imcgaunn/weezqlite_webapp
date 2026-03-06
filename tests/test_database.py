import pytest
from pathlib import Path
from weezqlite.database import (
    list_tables,
    get_table_schema,
    get_table_rows,
    execute_query,
    DatabaseError,
)


# ---------------------------------------------------------------------------
# list_tables
# ---------------------------------------------------------------------------

async def test_list_tables_returns_table_names(tmp_db: Path):
    tables = await list_tables(tmp_db)
    assert set(tables) == {"users", "posts"}


async def test_list_tables_empty_db_returns_empty(empty_db: Path):
    tables = await list_tables(empty_db)
    assert tables == []


async def test_list_tables_missing_file_raises(nonexistent_db: Path):
    with pytest.raises(DatabaseError):
        await list_tables(nonexistent_db)


async def test_list_tables_not_a_db_raises(not_a_db: Path):
    with pytest.raises(DatabaseError):
        await list_tables(not_a_db)


# ---------------------------------------------------------------------------
# get_table_schema
# ---------------------------------------------------------------------------

async def test_get_table_schema_returns_columns(tmp_db: Path):
    schema = await get_table_schema(tmp_db, "users")
    col_names = [c["name"] for c in schema]
    assert col_names == ["id", "name", "email", "active"]


async def test_get_table_schema_includes_type(tmp_db: Path):
    schema = await get_table_schema(tmp_db, "users")
    by_name = {c["name"]: c for c in schema}
    assert by_name["id"]["type"].upper() == "INTEGER"
    assert by_name["name"]["type"].upper() == "TEXT"


async def test_get_table_schema_marks_primary_key(tmp_db: Path):
    schema = await get_table_schema(tmp_db, "users")
    by_name = {c["name"]: c for c in schema}
    assert by_name["id"]["pk"] is True
    assert by_name["name"]["pk"] is False


async def test_get_table_schema_unknown_table_raises(tmp_db: Path):
    with pytest.raises(DatabaseError):
        await get_table_schema(tmp_db, "nonexistent_table")


async def test_get_table_schema_missing_file_raises(nonexistent_db: Path):
    with pytest.raises(DatabaseError):
        await get_table_schema(nonexistent_db, "users")


# ---------------------------------------------------------------------------
# get_table_rows
# ---------------------------------------------------------------------------

async def test_get_table_rows_returns_rows(tmp_db: Path):
    result = await get_table_rows(tmp_db, "users", offset=0, limit=50)
    assert result["total"] == 2
    assert len(result["rows"]) == 2


async def test_get_table_rows_returns_column_names(tmp_db: Path):
    result = await get_table_rows(tmp_db, "users", offset=0, limit=50)
    assert result["columns"] == ["id", "name", "email", "active"]


async def test_get_table_rows_pagination_limit(tmp_db: Path):
    result = await get_table_rows(tmp_db, "users", offset=0, limit=1)
    assert len(result["rows"]) == 1
    assert result["total"] == 2


async def test_get_table_rows_pagination_offset(tmp_db: Path):
    result_all = await get_table_rows(tmp_db, "users", offset=0, limit=50)
    result_page2 = await get_table_rows(tmp_db, "users", offset=1, limit=50)
    assert len(result_page2["rows"]) == 1
    assert result_page2["rows"][0] == result_all["rows"][1]


async def test_get_table_rows_empty_page_beyond_end(tmp_db: Path):
    result = await get_table_rows(tmp_db, "users", offset=100, limit=50)
    assert result["rows"] == []
    assert result["total"] == 2


async def test_get_table_rows_unknown_table_raises(tmp_db: Path):
    with pytest.raises(DatabaseError):
        await get_table_rows(tmp_db, "nonexistent_table", offset=0, limit=50)


async def test_get_table_rows_missing_file_raises(nonexistent_db: Path):
    with pytest.raises(DatabaseError):
        await get_table_rows(nonexistent_db, "users", offset=0, limit=50)


# ---------------------------------------------------------------------------
# execute_query
# ---------------------------------------------------------------------------

async def test_execute_query_select_returns_rows(tmp_db: Path):
    result = await execute_query(tmp_db, "SELECT id, name FROM users ORDER BY id")
    assert result["columns"] == ["id", "name"]
    assert len(result["rows"]) == 2
    assert result["rows"][0][1] == "Alice"


async def test_execute_query_returns_empty_rows_for_no_match(tmp_db: Path):
    result = await execute_query(tmp_db, "SELECT * FROM users WHERE 1=0")
    assert result["rows"] == []
    assert result["columns"] == ["id", "name", "email", "active"]


async def test_execute_query_rejects_insert(tmp_db: Path):
    with pytest.raises(DatabaseError, match="read-only"):
        await execute_query(tmp_db, "INSERT INTO users (name) VALUES ('X')")


async def test_execute_query_rejects_update(tmp_db: Path):
    with pytest.raises(DatabaseError, match="read-only"):
        await execute_query(tmp_db, "UPDATE users SET name='Y' WHERE id=1")


async def test_execute_query_rejects_delete(tmp_db: Path):
    with pytest.raises(DatabaseError, match="read-only"):
        await execute_query(tmp_db, "DELETE FROM users WHERE id=1")


async def test_execute_query_rejects_drop(tmp_db: Path):
    with pytest.raises(DatabaseError, match="read-only"):
        await execute_query(tmp_db, "DROP TABLE users")


async def test_execute_query_malformed_sql_raises(tmp_db: Path):
    with pytest.raises(DatabaseError):
        await execute_query(tmp_db, "SELECT * FORM users")


async def test_execute_query_missing_file_raises(nonexistent_db: Path):
    with pytest.raises(DatabaseError):
        await execute_query(nonexistent_db, "SELECT 1")
