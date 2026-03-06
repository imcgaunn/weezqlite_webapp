// =============================================================================
// weezqlite — client-side app
// All state stays in the browser; SQLite runs via sql.js (WASM).
// =============================================================================

// =============================================================================
// 1.  Constants
// =============================================================================

const SQL_CDN_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.12.0/';
const PAGE_SIZE_DEFAULT = 50;
const IDB_NAME = 'weezqlite';
const IDB_STORE = 'databases';
const IDB_KEY = 'lastDb';
const IDB_VERSION = 1;

// =============================================================================
// 2.  Module state (browser session)
// =============================================================================

export const state = {
  SQL: null,        // sql.js module, initialised once in bootstrap()
  currentDb: null,  // sql.js Database instance
  currentDbName: null,
};

// =============================================================================
// 3.  Utility
// =============================================================================

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// =============================================================================
// 4.  DB helpers  (pure functions — take a sql.js Database as first argument)
// =============================================================================

export const WRITE_PATTERN =
  /^\s*(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|REPLACE|TRUNCATE|ATTACH|DETACH)\b/i;

export function listTables(db) {
  const results = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
  );
  if (!results.length) return [];
  return results[0].values.map(row => String(row[0]));
}

export function getTableSchema(db, table) {
  // Verify table exists via parameterised query.
  const check = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  );
  check.bind([table]);
  const exists = check.step();
  check.free();
  if (!exists) throw new Error(`Table not found: '${table}'`);

  const safeTable = table.replace(/"/g, '""');
  const results = db.exec(`PRAGMA table_info("${safeTable}")`);
  if (!results.length) return [];
  // PRAGMA columns: cid, name, type, notnull, dflt_value, pk
  return results[0].values.map(row => ({
    name: String(row[1]),
    type: String(row[2] ?? ''),
    nullable: !row[3],
    pk: !!row[5],
  }));
}

export function getTableRows(db, table, offset, limit) {
  // Verify table exists.
  const check = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
  );
  check.bind([table]);
  const exists = check.step();
  check.free();
  if (!exists) throw new Error(`Table not found: '${table}'`);

  const safeTable = table.replace(/"/g, '""');

  // Total row count.
  const countResult = db.exec(`SELECT COUNT(*) FROM "${safeTable}"`);
  const total = Number(countResult[0].values[0][0]);

  // Column names via PRAGMA — reliable even for empty tables or limit=0.
  const pragmaResult = db.exec(`PRAGMA table_info("${safeTable}")`);
  const columns = pragmaResult.length
    ? pragmaResult[0].values.map(r => String(r[1]))
    : [];

  if (limit === 0) return { columns, rows: [], total };

  // Paginated rows.
  const rowsResult = db.exec(
    `SELECT * FROM "${safeTable}" LIMIT ${Number(limit)} OFFSET ${Number(offset)}`
  );
  const rows = rowsResult.length
    ? rowsResult[0].values.map(r =>
        Array.from(r).map(v => (v === undefined ? null : v))
      )
    : [];

  return { columns, rows, total };
}

export function executeQuery(db, sql) {
  if (WRITE_PATTERN.test(sql)) {
    throw new Error('Only SELECT queries are allowed (read-only access enforced)');
  }

  // Use prepare() so we can call getColumnNames() even when no rows are returned.
  let stmt;
  try {
    stmt = db.prepare(sql);
  } catch (err) {
    throw new Error(err.message ?? String(err));
  }

  try {
    const columns = stmt.getColumnNames();
    const rows = [];
    while (stmt.step()) {
      rows.push(Array.from(stmt.get()).map(v => (v === undefined ? null : v)));
    }
    return { columns, rows };
  } finally {
    stmt.free();
  }
}

// =============================================================================
// 5.  Router
// =============================================================================

export function parseHash(hash) {
  const h = hash.replace(/^#/, '');
  if (!h || h === 'home') return { view: 'home', params: {} };

  const [path, qs] = h.split('?');
  const params = {};
  if (qs) {
    for (const pair of qs.split('&')) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx === -1) continue;
      const k = decodeURIComponent(pair.slice(0, eqIdx));
      const v = decodeURIComponent(pair.slice(eqIdx + 1));
      params[k] = v;
    }
  }

  const parts = path.split('/');
  const view = parts[0];
  if (view === 'table' && parts[1]) {
    params.name = decodeURIComponent(parts[1]);
  }

  return { view, params };
}

export function navigate(view, params = {}) {
  let hash = `#${view}`;

  if (view === 'table' && params.name != null) {
    hash += `/${encodeURIComponent(params.name)}`;
  }

  const qs = Object.entries(params)
    .filter(([k]) => k !== 'name')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  if (qs) hash += `?${qs}`;

  window.location.hash = hash;
}

// =============================================================================
// 6.  Persistence  (IndexedDB)
// =============================================================================

export function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror = e => reject(e.target.error);
  });
}

export async function saveDb(filename, bytes) {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put({ filename, bytes, savedAt: Date.now() }, IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

export async function loadSavedDb() {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY);
    req.onsuccess = e => resolve(e.target.result ?? null);
    req.onerror = e => reject(e.target.error);
  });
}

export async function clearSavedDb() {
  const idb = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(IDB_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = e => reject(e.target.error);
  });
}

// =============================================================================
// 7.  View helpers
// =============================================================================

function getApp() {
  return document.getElementById('app');
}

function errorArticle(message) {
  return `<article aria-label="Error" style="border-left:4px solid var(--pico-color-red-500);">
    <p>${escapeHtml(message)}</p>
  </article>`;
}

// =============================================================================
// 8.  Nav renderer
// =============================================================================

export function renderNav() {
  const nav = document.getElementById('main-nav-links');
  if (!nav) return;
  if (state.currentDb) {
    nav.innerHTML = `
      <li><a href="#tables">Tables</a></li>
      <li><a href="#query">Query</a></li>
      <li><span class="db-label">${escapeHtml(state.currentDbName ?? '')}</span></li>
      <li><a href="#home">Change DB</a></li>`;
  } else {
    nav.innerHTML = `<li><a href="#home">Open Database</a></li>`;
  }
}

// =============================================================================
// 9.  View renderers
// =============================================================================

export function renderHome(savedDb = null) {
  const restoreSection = savedDb
    ? `<article>
        <p>Restore last database: <strong>${escapeHtml(savedDb.filename)}</strong></p>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;">
          <button id="btn-restore">Restore</button>
          <button id="btn-clear-saved" class="outline secondary">Clear saved</button>
        </div>
      </article>`
    : '';

  getApp().innerHTML = `
    <hgroup>
      <h1>Open a SQLite3 Database</h1>
      <p>Upload a <code>.db</code> file from your computer to start browsing.</p>
    </hgroup>
    ${restoreSection}
    <article>
      <form id="form-open">
        <label for="db_file">SQLite3 database file</label>
        <input type="file" id="db_file" name="db_file" accept=".db,.sqlite,.sqlite3">
        <button type="submit">Open Database</button>
      </form>
    </article>`;
}

export function renderTables() {
  const db = state.currentDb;
  const names = listTables(db);

  const tableData = names.map(name => {
    try {
      const { total } = getTableRows(db, name, 0, 0);
      return { name, row_count: total };
    } catch {
      return { name, row_count: '?' };
    }
  });

  if (!tableData.length) {
    getApp().innerHTML = `
      <hgroup>
        <h1>Tables</h1>
        <p>0 tables in this database</p>
      </hgroup>
      <p>No tables found in this database.</p>`;
    return;
  }

  const rows = tableData
    .map(
      t => `<tr>
        <td><strong>${escapeHtml(t.name)}</strong></td>
        <td>${escapeHtml(String(t.row_count))}</td>
        <td>
          <a href="#table/${encodeURIComponent(t.name)}"
             role="button" class="outline"
             style="padding:0.3rem 0.75rem;font-size:0.85rem;">Browse</a>
        </td>
      </tr>`
    )
    .join('');

  getApp().innerHTML = `
    <hgroup>
      <h1>Tables</h1>
      <p>${tableData.length} table${tableData.length !== 1 ? 's' : ''} in this database</p>
    </hgroup>
    <figure>
      <table>
        <thead><tr><th>Name</th><th>Rows</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </figure>`;
}

export function renderTableDetail(tableName, page, pageSize) {
  const db = state.currentDb;

  let schema;
  try {
    schema = getTableSchema(db, tableName);
  } catch (err) {
    getApp().innerHTML = errorArticle(err.message);
    return;
  }

  const offset = (page - 1) * pageSize;
  let data;
  try {
    data = getTableRows(db, tableName, offset, pageSize);
  } catch (err) {
    getApp().innerHTML = errorArticle(err.message);
    return;
  }

  const { total, columns, rows } = data;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const schemaRows = schema
    .map(
      col => `<tr>
        <td>${escapeHtml(col.name)}</td>
        <td><span class="badge badge-type">${escapeHtml(col.type)}</span></td>
        <td>
          ${col.pk ? '<span class="badge badge-pk">PK</span>' : ''}
          ${!col.nullable ? '<small>NOT NULL</small>' : ''}
        </td>
      </tr>`
    )
    .join('');

  const dataRows = rows
    .map(
      row => `<tr>${row
        .map(
          cell =>
            `<td>${
              cell === null
                ? '<span class="null-val">NULL</span>'
                : escapeHtml(String(cell))
            }</td>`
        )
        .join('')}</tr>`
    )
    .join('');

  const prevBtn =
    page > 1
      ? `<a href="#table/${encodeURIComponent(tableName)}?page=${page - 1}&page_size=${pageSize}"
           role="button" class="outline secondary">← Previous</a>`
      : `<button disabled class="outline secondary">← Previous</button>`;

  const nextBtn =
    page < totalPages
      ? `<a href="#table/${encodeURIComponent(tableName)}?page=${page + 1}&page_size=${pageSize}"
           role="button" class="outline secondary">Next →</a>`
      : `<button disabled class="outline secondary">Next →</button>`;

  getApp().innerHTML = `
    <hgroup>
      <h1>${escapeHtml(tableName)}</h1>
      <p>${total} row${total !== 1 ? 's' : ''}</p>
    </hgroup>

    <details>
      <summary><strong>Schema</strong></summary>
      <figure>
        <table>
          <thead><tr><th>Column</th><th>Type</th><th>Attributes</th></tr></thead>
          <tbody>${schemaRows}</tbody>
        </table>
      </figure>
    </details>

    <h2>Data</h2>
    ${
      rows.length
        ? `<figure>
            <table>
              <thead><tr>${columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
              <tbody>${dataRows}</tbody>
            </table>
          </figure>`
        : '<p>No rows on this page.</p>'
    }

    <nav aria-label="Pagination"
         style="display:flex;gap:0.75rem;align-items:center;flex-wrap:wrap;">
      ${prevBtn}
      <span>Page ${page} of ${totalPages} &nbsp;·&nbsp; ${pageSize} rows/page</span>
      ${nextBtn}
    </nav>`;
}

export function renderQuery(sql = '', result = null, error = null) {
  const errHtml = error
    ? `<article aria-label="Error" style="border-left:4px solid var(--pico-color-red-500);">
        <p><strong>Error:</strong> ${escapeHtml(error)}</p>
      </article>`
    : '';

  let resultHtml = '';
  if (result !== null) {
    if (result.rows.length) {
      const header = result.columns.map(c => `<th>${escapeHtml(c)}</th>`).join('');
      const dataRows = result.rows
        .map(
          row => `<tr>${row
            .map(
              cell =>
                `<td>${
                  cell === null
                    ? '<span class="null-val">NULL</span>'
                    : escapeHtml(String(cell))
                }</td>`
            )
            .join('')}</tr>`
        )
        .join('');
      resultHtml = `
        <p><small>${result.rows.length} row${result.rows.length !== 1 ? 's' : ''} returned</small></p>
        <figure>
          <table>
            <thead><tr>${header}</tr></thead>
            <tbody>${dataRows}</tbody>
          </table>
        </figure>`;
    } else {
      resultHtml = '<p>0 rows returned.</p>';
    }
  }

  getApp().innerHTML = `
    <hgroup>
      <h1>SQL Query</h1>
      <p>Run a read-only <code>SELECT</code> query against the database.</p>
    </hgroup>
    ${errHtml}
    <article>
      <form id="form-query">
        <label for="sql">SQL</label>
        <textarea id="sql" name="sql" rows="6"
                  placeholder="SELECT * FROM …">${escapeHtml(sql)}</textarea>
        <button type="submit">Run Query</button>
      </form>
    </article>
    ${resultHtml}`;
}

// =============================================================================
// 10. sql.js initialisation (browser-only; tests inject DB directly via state)
// =============================================================================

export async function initSql(factory = null) {
  if (state.SQL) return;
  const initFn = factory ?? globalThis.initSqlJs;
  if (!initFn) throw new Error('sql.js not loaded — missing CDN script?');
  state.SQL = await initFn({ locateFile: f => `${SQL_CDN_BASE}${f}` });
}

export function openDatabase(bytes) {
  if (!state.SQL) throw new Error('sql.js not initialised');
  return new state.SQL.Database(bytes);
}

// =============================================================================
// 11. Event handlers
// =============================================================================

async function handleFileSelect(file) {
  if (!file) return;

  let bytes;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (err) {
    _showHomeError(`Could not read file: ${err.message}`);
    return;
  }

  if (!bytes.length) {
    _showHomeError('Uploaded file is empty.');
    return;
  }

  let db;
  try {
    db = openDatabase(bytes);
    db.exec("SELECT name FROM sqlite_master WHERE type='table'");
  } catch (err) {
    db?.close();
    _showHomeError(`Invalid SQLite3 database: ${err.message ?? String(err)}`);
    return;
  }

  if (state.currentDb) state.currentDb.close();
  state.currentDb = db;
  state.currentDbName = file.name;

  try { await saveDb(file.name, bytes); } catch { /* persistence failure is non-fatal */ }

  navigate('tables');
}

async function _showHomeError(message) {
  const savedDb = await loadSavedDb().catch(() => null);
  renderHome(savedDb);
  getApp().insertAdjacentHTML('afterbegin', errorArticle(message));
  renderNav();
}

// =============================================================================
// 12. Main render dispatcher
// =============================================================================

export async function render() {
  const { view, params } = parseHash(window.location.hash);

  try {
    if (['tables', 'table', 'query'].includes(view) && !state.currentDb) {
      const savedDb = await loadSavedDb().catch(() => null);
      renderHome(savedDb);
    } else {
      switch (view) {
        case 'tables':
          renderTables();
          break;
        case 'table': {
          const page = Math.max(1, parseInt(params.page ?? '1', 10));
          const pageSize = Math.min(
            1000,
            Math.max(1, parseInt(params.page_size ?? String(PAGE_SIZE_DEFAULT), 10))
          );
          renderTableDetail(params.name, page, pageSize);
          break;
        }
        case 'query':
          renderQuery();
          break;
        default: {
          const savedDb = await loadSavedDb().catch(() => null);
          renderHome(savedDb);
          break;
        }
      }
    }
  } catch (err) {
    getApp().innerHTML = errorArticle(err.message);
  }

  renderNav();
}

// =============================================================================
// 13. Bootstrap  (runs once in the browser; skipped in tests via import.meta.env)
// =============================================================================

export async function bootstrap() {
  await initSql();

  window.addEventListener('hashchange', render);

  // Delegated submit handler (form-open and form-query are rendered dynamically).
  document.addEventListener('submit', async e => {
    if (e.target.id === 'form-open') {
      e.preventDefault();
      const file = e.target.querySelector('#db_file')?.files?.[0];
      await handleFileSelect(file);
    } else if (e.target.id === 'form-query') {
      e.preventDefault();
      if (!state.currentDb) return;
      const sql = e.target.querySelector('#sql')?.value?.trim() ?? '';
      let result = null;
      let error = null;
      try {
        result = executeQuery(state.currentDb, sql);
      } catch (err) {
        error = err.message;
      }
      renderQuery(sql, result, error);
      renderNav();
    }
  });

  // Delegated click handler for restore / clear buttons.
  document.addEventListener('click', async e => {
    if (e.target.id === 'btn-restore') {
      const saved = await loadSavedDb().catch(() => null);
      if (!saved) return;
      try {
        const db = openDatabase(saved.bytes);
        if (state.currentDb) state.currentDb.close();
        state.currentDb = db;
        state.currentDbName = saved.filename;
        navigate('tables');
      } catch (err) {
        _showHomeError(`Could not restore database: ${err.message}`);
      }
    } else if (e.target.id === 'btn-clear-saved') {
      await clearSavedDb().catch(() => null);
      renderHome(null);
      renderNav();
    }
  });

  await render();
}

// Only auto-start in the browser (import.meta.env.MODE is 'test' under Vitest).
if (import.meta.env?.MODE !== 'test') {
  document.addEventListener('DOMContentLoaded', bootstrap);
}
