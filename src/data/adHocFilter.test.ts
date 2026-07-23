import { columnNameFromAdhocKey, tableAndColumnFromAdhocKey } from './adHocFilter';

describe('adhoc key parsing', () => {
  it('extracts column name from table.column keys', () => {
    expect(columnNameFromAdhocKey('syslog.message')).toBe('message');
    expect(columnNameFromAdhocKey('message')).toBe('message');
  });

  it('parses table and column from getTagKeys format', () => {
    expect(tableAndColumnFromAdhocKey('syslog.message')).toEqual({ table: 'syslog', col: 'message' });
    expect(tableAndColumnFromAdhocKey('message')).toBeUndefined();
    expect(tableAndColumnFromAdhocKey('syslog.undefined')).toBeUndefined();
  });
});
