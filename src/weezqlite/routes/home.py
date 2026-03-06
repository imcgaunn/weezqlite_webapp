from urllib.parse import urlencode

from fastapi import APIRouter, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from weezqlite.database import DatabaseError, list_tables

router = APIRouter()


def _templates() -> Jinja2Templates:
    from weezqlite.main import templates
    return templates


@router.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return _templates().TemplateResponse(
        request, "index.html", {"db_path": None}
    )


@router.post("/db")
async def set_db(request: Request, db_path: str = Form(...)):
    # Validate by attempting to list tables — raises DatabaseError if invalid
    try:
        await list_tables(db_path)
    except DatabaseError as exc:
        return _templates().TemplateResponse(
            request,
            "index.html",
            {"db_path": db_path, "error": str(exc)},
            status_code=400,
        )

    location = "/db/tables?" + urlencode({"db_path": db_path})
    return RedirectResponse(url=location, status_code=302)
