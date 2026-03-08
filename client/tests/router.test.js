import { parseHash, navigate } from '../app.js';

describe('parseHash', () => {
  it('empty string → home', () => {
    expect(parseHash('')).toEqual({ view: 'home', params: {} });
  });

  it('"#" alone → home', () => {
    expect(parseHash('#')).toEqual({ view: 'home', params: {} });
  });

  it('"#home" → home', () => {
    expect(parseHash('#home')).toEqual({ view: 'home', params: {} });
  });

  it('"#tables" → tables', () => {
    expect(parseHash('#tables')).toEqual({ view: 'tables', params: {} });
  });

  it('"#query" → query', () => {
    expect(parseHash('#query')).toEqual({ view: 'query', params: {} });
  });

  it('"#table/users" → table with name=users', () => {
    expect(parseHash('#table/users')).toEqual({ view: 'table', params: { name: 'users' } });
  });

  it('decodes encoded table name', () => {
    const result = parseHash('#table/my%20table');
    expect(result).toEqual({ view: 'table', params: { name: 'my table' } });
  });

  it('parses page and page_size query params', () => {
    const result = parseHash('#table/users?page=3&page_size=25');
    expect(result.view).toBe('table');
    expect(result.params.name).toBe('users');
    expect(result.params.page).toBe('3');
    expect(result.params.page_size).toBe('25');
  });

  it('parses query params without a table sub-path', () => {
    const result = parseHash('#query?some=value');
    expect(result.view).toBe('query');
    expect(result.params.some).toBe('value');
  });

  it('"#backups" → backups view with empty params', () => {
    expect(parseHash('#backups')).toEqual({ view: 'backups', params: {} });
  });
});

describe('navigate', () => {
  it('sets location.hash to #home', () => {
    navigate('home');
    expect(window.location.hash).toBe('#home');
  });

  it('sets location.hash to #tables', () => {
    navigate('tables');
    expect(window.location.hash).toBe('#tables');
  });

  it('encodes table name in hash', () => {
    navigate('table', { name: 'my table' });
    expect(window.location.hash).toBe('#table/my%20table');
  });

  it('appends page and page_size as query params', () => {
    navigate('table', { name: 'users', page: 2, page_size: 25 });
    const hash = window.location.hash;
    expect(hash).toContain('#table/users');
    expect(hash).toContain('page=2');
    expect(hash).toContain('page_size=25');
  });
});
