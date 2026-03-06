# the stack for this project

1. python 3.13+ with uv for project management
2. pytest for testing
3. aiosqlite for interacting with sqlite3
4. fastapi for defining api routes / handlers
5. jinja2 for templating
6. structlog for structured logs including

# the goal

a simple web application that can be used to explore a sqlite3 database
file provided by the user.

## development practices

development for this project uses TDD. First, failing tests should be written
that define the expected behaviors. Then implementation should be constructed
to pass the tests.
