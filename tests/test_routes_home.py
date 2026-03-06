"""Tests for the home route (DB file selection)."""
import pytest
from pathlib import Path
from httpx import AsyncClient, ASGITransport


@pytest.fixture
async def client():
    from weezqlite.main import create_app
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def test_home_returns_200(client: AsyncClient):
    response = await client.get("/")
    assert response.status_code == 200


async def test_home_contains_form(client: AsyncClient):
    response = await client.get("/")
    assert "<form" in response.text


async def test_set_db_valid_path_redirects_to_tables(client: AsyncClient, tmp_db: Path):
    response = await client.post("/db", data={"db_path": str(tmp_db)}, follow_redirects=False)
    assert response.status_code == 302
    assert "/db/tables" in response.headers["location"]


async def test_set_db_missing_path_returns_400(client: AsyncClient, nonexistent_db: Path):
    response = await client.post("/db", data={"db_path": str(nonexistent_db)})
    assert response.status_code == 400


async def test_set_db_not_a_sqlite_file_returns_400(client: AsyncClient, not_a_db: Path):
    response = await client.post("/db", data={"db_path": str(not_a_db)})
    assert response.status_code == 400


async def test_set_db_includes_db_path_in_redirect(client: AsyncClient, tmp_db: Path):
    response = await client.post("/db", data={"db_path": str(tmp_db)}, follow_redirects=False)
    assert "db_path=" in response.headers["location"]
