import sqlite3
import pytest
import pytest_asyncio
from pathlib import Path
from httpx import AsyncClient, ASGITransport


@pytest.fixture
def tmp_db(tmp_path: Path) -> Path:
    """Create a temporary sqlite3 database with a couple of tables for testing."""
    db_path = tmp_path / "test.db"
    conn = sqlite3.connect(db_path)
    conn.executescript("""
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE,
            active INTEGER DEFAULT 1
        );
        CREATE TABLE posts (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            title TEXT NOT NULL,
            body TEXT
        );
        INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com');
        INSERT INTO users (name, email) VALUES ('Bob', 'bob@example.com');
        INSERT INTO posts (user_id, title, body) VALUES (1, 'Hello', 'World');
    """)
    conn.commit()
    conn.close()
    return db_path


@pytest.fixture
def empty_db(tmp_path: Path) -> Path:
    """Create a valid but empty sqlite3 database (no tables)."""
    db_path = tmp_path / "empty.db"
    conn = sqlite3.connect(db_path)
    conn.close()
    return db_path


@pytest.fixture
def nonexistent_db(tmp_path: Path) -> Path:
    """A path that does not point to an existing file."""
    return tmp_path / "does_not_exist.db"


@pytest.fixture
def not_a_db(tmp_path: Path) -> Path:
    """A file that exists but is not a sqlite3 database."""
    p = tmp_path / "not_a_db.txt"
    p.write_text("this is not a sqlite database")
    return p


@pytest_asyncio.fixture
async def app_client(tmp_db: Path):
    """Async HTTP test client for the FastAPI app, pre-configured with a test DB."""
    from weezqlite.main import create_app
    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client, tmp_db
