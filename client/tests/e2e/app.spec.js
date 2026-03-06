import { test, expect } from '@playwright/test';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import initSqlJs from 'sql.js';

// ─── Fixture setup ────────────────────────────────────────────────────────────

let TEST_DB;       // path to a valid 2-table fixture database
let EMPTY_DB;      // path to a valid database with no tables

test.beforeAll(async () => {
  const SQL = await initSqlJs();

  // Valid fixture database: users + posts tables.
  const db = new SQL.Database();
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT);
    CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT);
    INSERT INTO users VALUES (1, 'Alice', 'alice@example.com');
    INSERT INTO users VALUES (2, 'Bob', NULL);
    INSERT INTO users VALUES (3, 'Carol', 'carol@example.com');
    INSERT INTO posts VALUES (1, 1, 'Hello World');
    INSERT INTO posts VALUES (2, 2, 'Goodbye');
  `);
  TEST_DB = join(tmpdir(), 'weezqlite_e2e_fixture.db');
  writeFileSync(TEST_DB, Buffer.from(db.export()));
  db.close();

  // Valid but empty database.
  // Force a write (PRAGMA) so export() returns a properly-initialised SQLite
  // file rather than an empty buffer.
  const emptyDb = new SQL.Database();
  emptyDb.exec('PRAGMA user_version = 0');
  EMPTY_DB = join(tmpdir(), 'weezqlite_e2e_empty.db');
  writeFileSync(EMPTY_DB, Buffer.from(emptyDb.export()));
  emptyDb.close();
});

// Helper: navigate by hash without triggering a full page reload.
async function hashNavigate(page, hash) {
  await page.evaluate(h => { window.location.hash = h; }, hash);
}

// Helper: load the test DB and wait for the tables view.
async function loadTestDb(page) {
  await page.locator('#db_file').setInputFiles(TEST_DB);
  await page.getByRole('button', { name: /open database/i }).click();
  await expect(page).toHaveURL(/#tables/);
}

// ─── Home page ────────────────────────────────────────────────────────────────

test('home page renders a file input', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#db_file')).toBeVisible();
  await expect(page.getByRole('button', { name: /open database/i })).toBeVisible();
});

test('home page has no error on first load', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[aria-label="Error"]')).not.toBeVisible();
});

// ─── Loading a valid database ─────────────────────────────────────────────────

test('loading a valid DB navigates to tables view', async ({ page }) => {
  await page.goto('/');
  await loadTestDb(page);
  await expect(page.locator('h1')).toContainText('Tables');
});

test('tables view lists all table names', async ({ page }) => {
  await page.goto('/');
  await loadTestDb(page);
  await expect(page.getByText('users')).toBeVisible();
  await expect(page.getByText('posts')).toBeVisible();
});

test('tables view shows row counts', async ({ page }) => {
  await page.goto('/');
  await loadTestDb(page);
  // Use exact cell locators to avoid ambiguity with other text on the page.
  await expect(page.getByRole('cell', { name: '3', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '2', exact: true })).toBeVisible();
});

test('nav shows Tables and Query links once a DB is loaded', async ({ page }) => {
  await page.goto('/');
  await loadTestDb(page);
  await expect(page.getByRole('link', { name: 'Tables' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Query' })).toBeVisible();
});

// ─── Table detail view ────────────────────────────────────────────────────────

test('Browse button opens the table detail view', async ({ page }) => {
  await page.goto('/');
  await loadTestDb(page);
  // Browse links use role="button" (PicoCSS button-styled anchors).
  await page.getByRole('button', { name: 'Browse' }).first().click();
  await expect(page).toHaveURL(/#table\//);
});

test('table detail view shows data rows', async ({ page }) => {
  await page.goto('/');
  await loadTestDb(page);
  // Use hash navigation (not page.goto) to avoid a full reload that loses DB state.
  await hashNavigate(page, '#table/users');
  await expect(page.getByRole('cell', { name: 'Alice', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Bob', exact: true })).toBeVisible();
});

test('table detail view shows schema section', async ({ page }) => {
  await page.goto('/');
  await loadTestDb(page);
  await page.getByRole('button', { name: 'Browse' }).first().click();

  // Open the <details> schema section.
  await page.getByText('Schema').click();
  await expect(page.locator('.badge-type').first()).toBeVisible();
});

test('pagination: Next link appears when rows exceed page size', async ({ page }) => {
  await page.goto('/');
  await loadTestDb(page);
  // Navigate to users with page_size=1 so 3 rows → 3 pages.
  await hashNavigate(page, '#table/users?page=1&page_size=1');
  // Active Next uses role="button" on an <a> element.
  await expect(page.locator('a[role="button"]', { hasText: /Next/ })).toBeVisible();
});

test('pagination: Previous link appears on page 2', async ({ page }) => {
  await page.goto('/');
  await loadTestDb(page);
  await hashNavigate(page, '#table/users?page=2&page_size=1');
  await expect(page.locator('a[role="button"]', { hasText: /Previous/ })).toBeVisible();
});

// ─── Query view ───────────────────────────────────────────────────────────────

test('Query link opens the query view', async ({ page }) => {
  await page.goto('/');
  await loadTestDb(page);
  await page.getByRole('link', { name: 'Query' }).click();
  await expect(page).toHaveURL(/#query/);
  await expect(page.locator('#sql')).toBeVisible();
});

test('a valid SELECT query returns results', async ({ page }) => {
  await page.goto('/');
  await loadTestDb(page);
  await page.getByRole('link', { name: 'Query' }).click();
  await expect(page).toHaveURL(/#query/);

  await page.locator('#sql').fill('SELECT name FROM users ORDER BY name');
  await page.getByRole('button', { name: /run query/i }).click();

  await expect(page.getByText('Alice')).toBeVisible();
  await expect(page.getByText(/rows returned/i)).toBeVisible();
});

test('an INSERT query shows the read-only error', async ({ page }) => {
  await page.goto('/');
  await loadTestDb(page);
  await page.getByRole('link', { name: 'Query' }).click();

  await page.locator('#sql').fill("INSERT INTO users VALUES (99,'X',null)");
  await page.getByRole('button', { name: /run query/i }).click();

  await expect(page.locator('[aria-label="Error"]')).toBeVisible();
  await expect(page.locator('[aria-label="Error"]')).toContainText(/read-only/i);
});

test('a DROP query shows the read-only error', async ({ page }) => {
  await page.goto('/');
  await loadTestDb(page);
  await page.getByRole('link', { name: 'Query' }).click();

  await page.locator('#sql').fill('DROP TABLE users');
  await page.getByRole('button', { name: /run query/i }).click();

  await expect(page.locator('[aria-label="Error"]')).toBeVisible();
});

// ─── Error cases ──────────────────────────────────────────────────────────────

test('loading an empty file shows an error', async ({ page }) => {
  const emptyPath = join(tmpdir(), 'empty.db');
  writeFileSync(emptyPath, Buffer.alloc(0));

  await page.goto('/');
  await page.locator('#db_file').setInputFiles(emptyPath);
  await page.getByRole('button', { name: /open database/i }).click();

  await expect(page.locator('[aria-label="Error"]')).toBeVisible();
});

test('loading a non-SQLite file shows an error', async ({ page }) => {
  const corruptPath = join(tmpdir(), 'weezqlite_e2e_corrupt.db');
  writeFileSync(corruptPath, Buffer.from('this is not a sqlite3 database'));

  await page.goto('/');
  await page.locator('#db_file').setInputFiles(corruptPath);
  await page.getByRole('button', { name: /open database/i }).click();

  await expect(page.locator('[aria-label="Error"]')).toBeVisible();
});

// ─── Persistence across reloads ───────────────────────────────────────────────

test('after reload the home page offers to restore the last DB', async ({ page }) => {
  await page.goto('/');
  await loadTestDb(page);

  // Full reload — JS state is lost but IndexedDB persists.
  await page.reload();
  await hashNavigate(page, '#home');
  await expect(page.locator('#btn-restore')).toBeVisible();
});

test('restoring the saved DB navigates back to tables', async ({ page }) => {
  await page.goto('/');
  await loadTestDb(page);

  await page.reload();
  await hashNavigate(page, '#home');
  await page.locator('#btn-restore').click();
  await expect(page).toHaveURL(/#tables/);
  await expect(page.getByText('users')).toBeVisible();
});

test('clearing the saved DB hides the restore section', async ({ page }) => {
  await page.goto('/');
  await loadTestDb(page);

  await page.reload();
  await hashNavigate(page, '#home');
  await expect(page.locator('#btn-restore')).toBeVisible();
  await page.locator('#btn-clear-saved').click();
  await expect(page.locator('#btn-restore')).not.toBeVisible();
});

// ─── Empty database edge case ─────────────────────────────────────────────────

test('a database with no tables shows the empty message', async ({ page }) => {
  await page.goto('/');
  await page.locator('#db_file').setInputFiles(EMPTY_DB);
  await page.getByRole('button', { name: /open database/i }).click();
  await expect(page).toHaveURL(/#tables/);
  await expect(page.getByText(/no tables/i)).toBeVisible();
});
