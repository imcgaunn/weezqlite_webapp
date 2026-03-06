"""
FastAPI application factory for weezqlite.

Import `templates` from this module to access the shared Jinja2Templates instance.
"""

from pathlib import Path

import structlog
from fastapi import FastAPI
from fastapi.templating import Jinja2Templates

log = structlog.get_logger(__name__)

_TEMPLATES_DIR = Path(__file__).parent / "templates"

# Module-level templates instance shared by route modules
templates = Jinja2Templates(directory=str(_TEMPLATES_DIR))


def create_app() -> FastAPI:
    from weezqlite.routes.home import router as home_router
    from weezqlite.routes.tables import router as tables_router
    from weezqlite.routes.query import router as query_router

    app = FastAPI(title="weezqlite", version="0.1.0")
    app.include_router(home_router)
    app.include_router(tables_router)
    app.include_router(query_router)

    log.info("weezqlite app created")
    return app


def run():
    import uvicorn
    app = create_app()
    uvicorn.run(app, host="127.0.0.1", port=8000)
