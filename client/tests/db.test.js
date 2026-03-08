import initSqlJs from 'sql.js';
import {
  listTables,
  getTableSchema,
  getTableRows,
  executeQuery,
  WRITE_PATTERN,
} from '../app.js';

let SQL;
let db;

beforeAll(async () => {
  SQL = await initSqlJs();
});

beforeEach(() => {
  db = new SQL.Database();
  db.exec(`
    CREATE TABLE users (
      id    INTEGER PRIMARY KEY,
      name  TEXT    NOT NULL,
      email TEXT
    );
    CREATE TABLE posts (
      id      INTEGER PRIMARY KEY,
      user_id INTEGER,
      title   TEXT,
      body    TEXT
    );
    INSERT INTO users VALUES (1, 'Alice', 'alice@example.com');
    INSERT INTO users VALUES (2, 'Bob',   NULL);
    INSERT INTO posts VALUES (1, 1, 'Hello', 'World');
    INSERT INTO posts VALUES (2, 2, 'Bye',   NULL);
  `);
});

afterEach(() => {
  db.close();
});

// ─── listTables ──────────────────────────────────────────────────────────────

describe('listTables', () => {
  it('returns all table names sorted alphabetically', () => {
    expect(listTables(db)).toEqual(['posts', 'users']);
  });

  it('returns an empty array for a database with no tables', () => {
    const empty = new SQL.Database();
    expect(listTables(empty)).toEqual([]);
    empty.close();
  });
});

// ─── getTableSchema ───────────────────────────────────────────────────────────

describe('getTableSchema', () => {
  it('returns correct column metadata for users', () => {
    const schema = getTableSchema(db, 'users');
    expect(schema).toHaveLength(3);

    const id = schema.find(c => c.name === 'id');
    expect(id).toMatchObject({ name: 'id', pk: true, nullable: true });

    const name = schema.find(c => c.name === 'name');
    expect(name).toMatchObject({ name: 'name', nullable: false, pk: false });
    expect(name.type).toMatch(/TEXT/i);

    const email = schema.find(c => c.name === 'email');
    expect(email).toMatchObject({ name: 'email', nullable: true, pk: false });
  });

  it('returns type string for every column', () => {
    const schema = getTableSchema(db, 'users');
    for (const col of schema) {
      expect(typeof col.type).toBe('string');
    }
  });

  it('throws an error for a non-existent table', () => {
    expect(() => getTableSchema(db, 'no_such_table')).toThrow(/not found/i);
  });
});

// ─── getTableRows ─────────────────────────────────────────────────────────────

describe('getTableRows', () => {
  it('returns total row count', () => {
    const { total } = getTableRows(db, 'users', 0, 50);
    expect(total).toBe(2);
  });

  it('returns column names', () => {
    const { columns } = getTableRows(db, 'users', 0, 50);
    expect(columns).toEqual(['id', 'name', 'email']);
  });

  it('returns paginated rows', () => {
    const { rows } = getTableRows(db, 'users', 0, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe('Alice');
  });

  it('respects offset', () => {
    const { rows } = getTableRows(db, 'users', 1, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0][1]).toBe('Bob');
  });

  it('returns NULL values as null', () => {
    const { rows } = getTableRows(db, 'users', 0, 50);
    const bob = rows.find(r => r[1] === 'Bob');
    expect(bob[2]).toBeNull();
  });

  it('returns correct total and empty rows for limit=0 (count-only call)', () => {
    const { total, rows, columns } = getTableRows(db, 'users', 0, 0);
    expect(total).toBe(2);
    expect(rows).toHaveLength(0);
    expect(columns).toEqual(['id', 'name', 'email']);
  });

  it('returns columns even when the table has no rows', () => {
    db.exec('CREATE TABLE empty_tbl (x INTEGER, y TEXT)');
    const { total, rows, columns } = getTableRows(db, 'empty_tbl', 0, 50);
    expect(total).toBe(0);
    expect(rows).toHaveLength(0);
    expect(columns).toEqual(['x', 'y']);
  });

  it('throws for a non-existent table', () => {
    expect(() => getTableRows(db, 'ghost', 0, 50)).toThrow(/not found/i);
  });
});

// ─── executeQuery ─────────────────────────────────────────────────────────────

describe('executeQuery', () => {
  it('returns columns and rows for a valid SELECT', () => {
    const result = executeQuery(db, 'SELECT id, name FROM users ORDER BY id');
    expect(result.columns).toEqual(['id', 'name']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual([1, 'Alice']);
  });

  it('returns NULL values as null', () => {
    const result = executeQuery(db, 'SELECT email FROM users WHERE name = "Bob"');
    expect(result.rows[0][0]).toBeNull();
  });

  it('returns empty rows and columns for a no-result SELECT', () => {
    const result = executeQuery(db, "SELECT * FROM users WHERE 1=0");
    expect(result.columns).toEqual(['id', 'name', 'email']);
    expect(result.rows).toHaveLength(0);
  });

  it('throws with "read-only" message for INSERT', () => {
    expect(() => executeQuery(db, "INSERT INTO users VALUES (3,'X',null)")).toThrow(/read-only/i);
  });

  it('throws for UPDATE', () => {
    expect(() => executeQuery(db, "UPDATE users SET name='Z' WHERE id=1")).toThrow(/read-only/i);
  });

  it('throws for DELETE', () => {
    expect(() => executeQuery(db, "DELETE FROM users")).toThrow(/read-only/i);
  });

  it('throws for DROP', () => {
    expect(() => executeQuery(db, "DROP TABLE users")).toThrow(/read-only/i);
  });

  it('throws for CREATE', () => {
    expect(() => executeQuery(db, "CREATE TABLE foo (x INT)")).toThrow(/read-only/i);
  });

  it('throws for malformed SQL', () => {
    expect(() => executeQuery(db, "SELET *")).toThrow();
  });

  it('WRITE_PATTERN is case-insensitive', () => {
    expect(WRITE_PATTERN.test('insert into t values (1)')).toBe(true);
    expect(WRITE_PATTERN.test('  DELETE FROM t')).toBe(true);
    expect(WRITE_PATTERN.test('select * from t')).toBe(false);
  });
});
