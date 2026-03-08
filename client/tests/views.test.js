import initSqlJs from 'sql.js';
import {
  state,
  renderHome,
  renderNav,
  renderTables,
  renderTableDetail,
  renderQuery,
} from '../app.js';

// ─── Shared setup ─────────────────────────────────────────────────────────────

let SQL;
let db;

beforeAll(async () => {
  SQL = await initSqlJs();
});

beforeEach(() => {
  // Reset DOM to match the index.html skeleton that renderers expect.
  document.body.innerHTML = `
    <header><nav><ul id="main-nav-links"></ul></nav></header>
    <main id="app"></main>
  `;

  // Build a fresh test database.
  db = new SQL.Database();
  db.exec(`
    CREATE TABLE users (
      id    INTEGER PRIMARY KEY,
      name  TEXT NOT NULL,
      email TEXT
    );
    CREATE TABLE posts (
      id      INTEGER PRIMARY KEY,
      title   TEXT
    );
    INSERT INTO users VALUES (1, 'Alice', 'alice@example.com');
    INSERT INTO users VALUES (2, 'Bob',   NULL);
    INSERT INTO posts VALUES (1, 'Hello World');
  `);

  state.currentDb = db;
  state.currentDbName = 'test.db';
});

afterEach(() => {
  db.close();
  state.currentDb = null;
  state.currentDbName = null;
});

// ─── renderNav ────────────────────────────────────────────────────────────────

describe('renderNav', () => {
  it('shows Tables and Query links when a DB is loaded', () => {
    renderNav();
    const nav = document.getElementById('main-nav-links');
    expect(nav.innerHTML).toContain('#tables');
    expect(nav.innerHTML).toContain('#query');
  });

  it('shows the DB filename when a DB is loaded', () => {
    renderNav();
    expect(document.getElementById('main-nav-links').innerHTML).toContain('test.db');
  });

  it('shows only Open Database link when no DB is loaded', () => {
    state.currentDb = null;
    state.currentDbName = null;
    renderNav();
    const nav = document.getElementById('main-nav-links');
    expect(nav.innerHTML).not.toContain('#tables');
    expect(nav.innerHTML).not.toContain('#query');
    expect(nav.innerHTML).toContain('#home');
  });

  it('always shows Azure Backups link regardless of DB state', () => {
    renderNav();
    expect(document.getElementById('main-nav-links').innerHTML).toContain('#backups');
    state.currentDb = null;
    state.currentDbName = null;
    renderNav();
    expect(document.getElementById('main-nav-links').innerHTML).toContain('#backups');
  });
});

// ─── renderHome ───────────────────────────────────────────────────────────────

describe('renderHome', () => {
  it('renders a file input', () => {
    renderHome();
    expect(document.getElementById('db_file')).not.toBeNull();
  });

  it('renders the Open Database submit button', () => {
    renderHome();
    const btn = document.querySelector('#form-open button[type=submit]');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toMatch(/open database/i);
  });

  it('shows the restore section when savedDb is provided', () => {
    const savedDb = { filename: 'mydb.sqlite', bytes: new Uint8Array([1]), savedAt: Date.now() };
    renderHome(savedDb);
    expect(document.getElementById('btn-restore')).not.toBeNull();
    expect(document.getElementById('btn-clear-saved')).not.toBeNull();
    expect(document.getElementById('app').innerHTML).toContain('mydb.sqlite');
  });

  it('does not show restore section when savedDb is null', () => {
    renderHome(null);
    expect(document.getElementById('btn-restore')).toBeNull();
  });

  it('escapes HTML in the saved filename', () => {
    const savedDb = { filename: '<script>bad</script>.db', bytes: new Uint8Array(), savedAt: 0 };
    renderHome(savedDb);
    expect(document.getElementById('app').innerHTML).not.toContain('<script>');
  });
});

// ─── renderTables ─────────────────────────────────────────────────────────────

describe('renderTables', () => {
  it('renders a row for each table', () => {
    renderTables();
    const rows = document.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
  });

  it('shows table names', () => {
    renderTables();
    const html = document.getElementById('app').innerHTML;
    expect(html).toContain('users');
    expect(html).toContain('posts');
  });

  it('shows row counts', () => {
    renderTables();
    const html = document.getElementById('app').innerHTML;
    // users has 2 rows, posts has 1 row
    expect(html).toContain('2');
    expect(html).toContain('1');
  });

  it('includes Browse links pointing at #table/<name>', () => {
    renderTables();
    const links = [...document.querySelectorAll('a[href]')];
    const hrefs = links.map(a => a.getAttribute('href'));
    expect(hrefs.some(h => h.includes('#table/users'))).toBe(true);
    expect(hrefs.some(h => h.includes('#table/posts'))).toBe(true);
  });

  it('shows "No tables found" message for a database with no tables', () => {
    db.exec('DROP TABLE users; DROP TABLE posts;');
    renderTables();
    expect(document.getElementById('app').innerHTML).toMatch(/no tables/i);
  });
});

// ─── renderTableDetail ────────────────────────────────────────────────────────

describe('renderTableDetail', () => {
  it('renders the table name as a heading', () => {
    renderTableDetail('users', 1, 50);
    expect(document.querySelector('h1').textContent).toBe('users');
  });

  it('shows column names in the data table header', () => {
    renderTableDetail('users', 1, 50);
    const ths = [...document.querySelectorAll('table thead th')].map(th => th.textContent.trim());
    // data table (the last one) has the column headers
    expect(ths.some(t => t === 'id')).toBe(true);
    expect(ths.some(t => t === 'name')).toBe(true);
    expect(ths.some(t => t === 'email')).toBe(true);
  });

  it('renders the correct number of data rows', () => {
    renderTableDetail('users', 1, 50);
    // Find the data table (the second <table> — first is schema)
    const tables = document.querySelectorAll('table');
    const dataTable = tables[tables.length - 1];
    const rows = dataTable.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
  });

  it('renders NULL cells with the null-val class', () => {
    renderTableDetail('users', 1, 50);
    const nullSpan = document.querySelector('.null-val');
    expect(nullSpan).not.toBeNull();
    expect(nullSpan.textContent).toMatch(/null/i);
  });

  it('shows schema column names and types', () => {
    renderTableDetail('users', 1, 50);
    const schemaTable = document.querySelector('table');
    expect(schemaTable.innerHTML).toContain('id');
    expect(schemaTable.innerHTML).toContain('INTEGER');
  });

  it('shows the PK badge for primary key columns', () => {
    renderTableDetail('users', 1, 50);
    expect(document.querySelector('.badge-pk')).not.toBeNull();
  });

  it('disables Previous button on first page', () => {
    renderTableDetail('users', 1, 50);
    const prev = [...document.querySelectorAll('button, a')].find(
      el => el.textContent.includes('Previous')
    );
    expect(prev.tagName).toBe('BUTTON');
    expect(prev.disabled).toBe(true);
  });

  it('disables Next button on last page', () => {
    renderTableDetail('users', 1, 50); // only 2 rows, fits on page 1
    const next = [...document.querySelectorAll('button, a')].find(
      el => el.textContent.includes('Next')
    );
    expect(next.tagName).toBe('BUTTON');
    expect(next.disabled).toBe(true);
  });

  it('renders Next as a link when there are more pages', () => {
    renderTableDetail('users', 1, 1); // 2 rows, page size 1 → 2 pages
    const next = [...document.querySelectorAll('a')].find(
      el => el.textContent.includes('Next')
    );
    expect(next).not.toBeNull();
    expect(next.getAttribute('href')).toContain('page=2');
  });

  it('escapes HTML in table name heading', () => {
    db.exec('CREATE TABLE "<xss>" (id INTEGER)');
    renderTableDetail('<xss>', 1, 50);
    expect(document.querySelector('h1').innerHTML).not.toContain('<xss>');
  });
});

// ─── renderQuery ──────────────────────────────────────────────────────────────

describe('renderQuery', () => {
  it('renders a SQL textarea', () => {
    renderQuery();
    expect(document.getElementById('sql')).not.toBeNull();
  });

  it('pre-fills the textarea with provided SQL', () => {
    renderQuery('SELECT * FROM users');
    expect(document.getElementById('sql').textContent).toContain('SELECT * FROM users');
  });

  it('renders a Run Query submit button', () => {
    renderQuery();
    const btn = document.querySelector('#form-query button[type=submit]');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toMatch(/run query/i);
  });

  it('shows no results section when result is null', () => {
    renderQuery('', null, null);
    expect(document.querySelector('table')).toBeNull();
    expect(document.getElementById('app').innerHTML).not.toMatch(/rows returned/i);
  });

  it('shows a results table when result has rows', () => {
    const result = { columns: ['id', 'name'], rows: [[1, 'Alice'], [2, 'Bob']] };
    renderQuery('SELECT id, name FROM users', result, null);
    const table = document.querySelector('table');
    expect(table).not.toBeNull();
    expect(table.innerHTML).toContain('Alice');
  });

  it('shows row count when result has rows', () => {
    const result = { columns: ['id'], rows: [[1], [2]] };
    renderQuery('SELECT id FROM users', result, null);
    expect(document.getElementById('app').innerHTML).toMatch(/2 rows returned/i);
  });

  it('shows "0 rows returned" for an empty result set', () => {
    renderQuery('SELECT * FROM users WHERE 1=0', { columns: ['id'], rows: [] }, null);
    expect(document.getElementById('app').innerHTML).toMatch(/0 rows returned/i);
  });

  it('shows an error message when error is provided', () => {
    renderQuery('BAD SQL', null, 'Only SELECT queries are allowed');
    expect(document.getElementById('app').innerHTML).toMatch(/only select queries/i);
  });

  it('escapes HTML in error message', () => {
    renderQuery('', null, '<script>evil()</script>');
    expect(document.getElementById('app').innerHTML).not.toContain('<script>');
  });
});
