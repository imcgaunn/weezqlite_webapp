from fastapi import APIRouter, Form, Query, Request
from fastapi.responses import HTMLResponse

from weezqlite.database import DatabaseError, execute_query

router = APIRouter()


def _templates():
    from weezqlite.main import templates
    return templates


def _require_db_path(db_path: str | None, request: Request):
    if not db_path:
        return _templates().TemplateResponse(
            request, "index.html",
            {"db_path": None, "error": "No database selected. Please open a database first."},
            status_code=400,
        )
    return None


@router.get("/db/query", response_class=HTMLResponse)
async def query_form(
    request: Request,
    db_path: str = Query(default=None),
):
    if err := _require_db_path(db_path, request):
        return err

    return _templates().TemplateResponse(
        request, "query.html", {"db_path": db_path, "sql": None, "result": None, "error": None}
    )


@router.post("/db/query", response_class=HTMLResponse)
async def query_execute(
    request: Request,
    db_path: str = Query(default=None),
    sql: str = Form(...),
):
    if err := _require_db_path(db_path, request):
        return err

    try:
        result = await execute_query(db_path, sql)
    except DatabaseError as exc:
        return _templates().TemplateResponse(
            request, "query.html",
            {"db_path": db_path, "sql": sql, "result": None, "error": str(exc)},
            status_code=400,
        )

    return _templates().TemplateResponse(
        request, "query.html",
        {"db_path": db_path, "sql": sql, "result": result, "error": None}
    )
