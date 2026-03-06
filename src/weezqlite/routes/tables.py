import math

from fastapi import APIRouter, Query, Request
from fastapi.responses import HTMLResponse

from weezqlite.database import DatabaseError, get_table_rows, get_table_schema, list_tables

router = APIRouter()

_DEFAULT_PAGE_SIZE = 50


def _templates():
    from weezqlite.main import templates
    return templates


def _require_db_path(db_path: str | None, request: Request):
    """Return a 400 response if db_path is missing, else None."""
    if not db_path:
        return _templates().TemplateResponse(
            request, "index.html",
            {"db_path": None, "error": "No database selected. Please open a database first."},
            status_code=400,
        )
    return None


@router.get("/db/tables", response_class=HTMLResponse)
async def table_list(
    request: Request,
    db_path: str = Query(default=None),
):
    if err := _require_db_path(db_path, request):
        return err

    try:
        table_names = await list_tables(db_path)
    except DatabaseError as exc:
        return _templates().TemplateResponse(
            request, "index.html",
            {"db_path": db_path, "error": str(exc)},
            status_code=400,
        )

    # Fetch row counts for each table
    tables = []
    for name in table_names:
        try:
            result = await get_table_rows(db_path, name, offset=0, limit=0)
            tables.append({"name": name, "row_count": result["total"]})
        except DatabaseError:
            tables.append({"name": name, "row_count": "?"})

    return _templates().TemplateResponse(
        request, "tables.html", {"db_path": db_path, "tables": tables}
    )


@router.get("/db/tables/{table_name}", response_class=HTMLResponse)
async def table_detail(
    request: Request,
    table_name: str,
    db_path: str = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=_DEFAULT_PAGE_SIZE, ge=1, le=1000),
):
    if err := _require_db_path(db_path, request):
        return err

    try:
        schema = await get_table_schema(db_path, table_name)
    except DatabaseError as exc:
        msg = str(exc)
        if "not found" in msg.lower():
            return _templates().TemplateResponse(
                request, "index.html",
                {"db_path": db_path, "error": msg},
                status_code=404,
            )
        return _templates().TemplateResponse(
            request, "index.html",
            {"db_path": db_path, "error": msg},
            status_code=400,
        )

    offset = (page - 1) * page_size
    try:
        data = await get_table_rows(db_path, table_name, offset=offset, limit=page_size)
    except DatabaseError as exc:
        return _templates().TemplateResponse(
            request, "index.html",
            {"db_path": db_path, "error": str(exc)},
            status_code=400,
        )

    total = data["total"]
    total_pages = max(1, math.ceil(total / page_size))

    return _templates().TemplateResponse(
        request, "table.html", {
            "db_path": db_path,
            "table_name": table_name,
            "schema": schema,
            "columns": data["columns"],
            "rows": data["rows"],
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
        }
    )
