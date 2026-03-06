"""Tests for the query route (SQL editor)."""
import pytest
from pathlib import Path
from urllib.parse import quote
from httpx import AsyncClient, ASGITransport


@pytest.fixture
async def client():
    from weezqlite.main import create_app
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


def db_param(db_path: Path) -> str:
    return f"db_path={quote(str(db_path))}"


async def test_query_form_returns_200(client: AsyncClient, tmp_db: Path):
    response = await client.get(f"/db/query?{db_param(tmp_db)}")
    assert response.status_code == 200


async def test_query_form_contains_textarea(client: AsyncClient, tmp_db: Path):
    response = await client.get(f"/db/query?{db_param(tmp_db)}")
    assert "<textarea" in response.text


async def test_query_execute_select_returns_results(client: AsyncClient, tmp_db: Path):
    response = await client.post(
        f"/db/query?{db_param(tmp_db)}",
        data={"sql": "SELECT id, name FROM users ORDER BY id"},
    )
    assert response.status_code == 200
    assert "Alice" in response.text
    assert "Bob" in response.text


async def test_query_execute_returns_column_headers(client: AsyncClient, tmp_db: Path):
    response = await client.post(
        f"/db/query?{db_param(tmp_db)}",
        data={"sql": "SELECT id, name FROM users ORDER BY id"},
    )
    assert "id" in response.text
    assert "name" in response.text


async def test_query_execute_write_statement_returns_400(client: AsyncClient, tmp_db: Path):
    response = await client.post(
        f"/db/query?{db_param(tmp_db)}",
        data={"sql": "INSERT INTO users (name) VALUES ('X')"},
    )
    assert response.status_code == 400


async def test_query_execute_malformed_sql_returns_400(client: AsyncClient, tmp_db: Path):
    response = await client.post(
        f"/db/query?{db_param(tmp_db)}",
        data={"sql": "SELECT * FORM users"},
    )
    assert response.status_code == 400


async def test_query_no_db_path_returns_400(client: AsyncClient):
    response = await client.get("/db/query")
    assert response.status_code == 400


async def test_query_empty_result_shows_no_rows(client: AsyncClient, tmp_db: Path):
    response = await client.post(
        f"/db/query?{db_param(tmp_db)}",
        data={"sql": "SELECT * FROM users WHERE 1=0"},
    )
    assert response.status_code == 200
    assert "0 rows" in response.text.lower() or "no results" in response.text.lower() or response.text.count("<tr") <= 2
