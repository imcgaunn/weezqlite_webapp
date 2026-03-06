"""Tests for the home route (DB file upload)."""
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


async def test_home_contains_file_input(client: AsyncClient):
    response = await client.get("/")
    assert 'type="file"' in response.text


async def test_upload_valid_db_redirects_to_tables(client: AsyncClient, tmp_db: Path):
    with open(tmp_db, "rb") as f:
        response = await client.post(
            "/db",
            files={"db_file": ("mydb.db", f, "application/octet-stream")},
            follow_redirects=False,
        )
    assert response.status_code == 302
    assert "/db/tables" in response.headers["location"]


async def test_upload_redirect_includes_db_path(client: AsyncClient, tmp_db: Path):
    with open(tmp_db, "rb") as f:
        response = await client.post(
            "/db",
            files={"db_file": ("mydb.db", f, "application/octet-stream")},
            follow_redirects=False,
        )
    assert "db_path=" in response.headers["location"]


async def test_upload_non_sqlite_file_returns_400(client: AsyncClient, not_a_db: Path):
    with open(not_a_db, "rb") as f:
        response = await client.post(
            "/db",
            files={"db_file": ("not_a_db.txt", f, "text/plain")},
        )
    assert response.status_code == 400


async def test_upload_empty_file_returns_400(client: AsyncClient):
    response = await client.post(
        "/db",
        files={"db_file": ("empty.db", b"", "application/octet-stream")},
    )
    assert response.status_code == 400


async def test_upload_creates_temp_copy(client: AsyncClient, tmp_db: Path):
    """The redirect db_path should point to a copy, not the original file."""
    with open(tmp_db, "rb") as f:
        response = await client.post(
            "/db",
            files={"db_file": ("mydb.db", f, "application/octet-stream")},
            follow_redirects=False,
        )
    location = response.headers["location"]
    # Extract db_path from query string
    from urllib.parse import urlparse, parse_qs
    params = parse_qs(urlparse(location).query)
    temp_path = Path(params["db_path"][0])
    assert temp_path.exists()
    assert temp_path != tmp_db
