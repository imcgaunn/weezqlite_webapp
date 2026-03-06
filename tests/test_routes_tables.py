"""Tests for the tables routes (list, schema, paginated data)."""
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


async def test_tables_list_returns_200(client: AsyncClient, tmp_db: Path):
    response = await client.get(f"/db/tables?{db_param(tmp_db)}")
    assert response.status_code == 200


async def test_tables_list_shows_table_names(client: AsyncClient, tmp_db: Path):
    response = await client.get(f"/db/tables?{db_param(tmp_db)}")
    assert "users" in response.text
    assert "posts" in response.text


async def test_tables_list_missing_db_returns_400(client: AsyncClient, nonexistent_db: Path):
    response = await client.get(f"/db/tables?{db_param(nonexistent_db)}")
    assert response.status_code == 400


async def test_tables_list_no_db_path_returns_400(client: AsyncClient):
    response = await client.get("/db/tables")
    assert response.status_code == 400


async def test_table_detail_returns_200(client: AsyncClient, tmp_db: Path):
    response = await client.get(f"/db/tables/users?{db_param(tmp_db)}")
    assert response.status_code == 200


async def test_table_detail_shows_column_names(client: AsyncClient, tmp_db: Path):
    response = await client.get(f"/db/tables/users?{db_param(tmp_db)}")
    assert "name" in response.text
    assert "email" in response.text


async def test_table_detail_shows_row_data(client: AsyncClient, tmp_db: Path):
    response = await client.get(f"/db/tables/users?{db_param(tmp_db)}")
    assert "Alice" in response.text
    assert "Bob" in response.text


async def test_table_detail_unknown_table_returns_404(client: AsyncClient, tmp_db: Path):
    response = await client.get(f"/db/tables/no_such_table?{db_param(tmp_db)}")
    assert response.status_code == 404


async def test_table_detail_pagination_page_param(client: AsyncClient, tmp_db: Path):
    response = await client.get(f"/db/tables/users?{db_param(tmp_db)}&page=1&page_size=1")
    assert response.status_code == 200
    # Only one of the two users should appear on a single-row page
    alice_present = "Alice" in response.text
    bob_present = "Bob" in response.text
    assert alice_present != bob_present  # exactly one


async def test_table_detail_shows_pagination_controls(client: AsyncClient, tmp_db: Path):
    response = await client.get(f"/db/tables/users?{db_param(tmp_db)}&page=1&page_size=1")
    # Should have next/prev navigation when multiple pages exist
    assert "page" in response.text.lower()
