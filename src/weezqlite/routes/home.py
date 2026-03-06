import shutil
import tempfile
from pathlib import Path
from urllib.parse import urlencode

import structlog
from fastapi import APIRouter, Request, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from weezqlite.database import DatabaseError, list_tables

router = APIRouter()
log = structlog.get_logger(__name__)

# Temp directory for uploaded databases; persists for the process lifetime.
_UPLOAD_DIR = Path(tempfile.gettempdir()) / "weezqlite_uploads"
_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


def _templates() -> Jinja2Templates:
    from weezqlite.main import templates
    return templates


@router.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return _templates().TemplateResponse(
        request, "index.html", {"db_path": None}
    )


@router.post("/db")
async def set_db(request: Request, db_file: UploadFile):
    # Reject empty uploads immediately
    contents = await db_file.read()
    if not contents:
        return _templates().TemplateResponse(
            request, "index.html",
            {"db_path": None, "error": "Uploaded file is empty."},
            status_code=400,
        )

    # Save to a uniquely-named temp file preserving the original filename
    safe_name = Path(db_file.filename or "upload.db").name
    import uuid
    dest = _UPLOAD_DIR / f"{uuid.uuid4().hex}_{safe_name}"
    dest.write_bytes(contents)

    log.info("db uploaded", filename=safe_name, dest=str(dest))

    # Validate by attempting to open as sqlite3
    try:
        await list_tables(dest)
    except DatabaseError as exc:
        dest.unlink(missing_ok=True)
        return _templates().TemplateResponse(
            request, "index.html",
            {"db_path": None, "error": f"Invalid SQLite3 database: {exc}"},
            status_code=400,
        )

    location = "/db/tables?" + urlencode({"db_path": str(dest)})
    return RedirectResponse(url=location, status_code=302)
