import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { firstValueFrom } from 'rxjs';
import { DataQueryRequest, FieldType } from '@grafana/data';
import {
  CHVariableQuery,
  CHVariableQueryType,
  CHVariableSupport,
  VariableQueryEditor,
  escapeGreptimeIdentifier,
  escapeGreptimeStringLiteral,
  generateVariableSql,
  isCHVariableQueryType,
  normalizeVariableQuery,
  pickerLevelFor,
} from './CHVariableSupport';
import { Datasource } from './CHDatasource';
import { EditorType } from 'types/sql';
import { QueryType } from 'types/queryBuilder';

const baseQuery = (overrides: Partial<CHVariableQuery> = {}): CHVariableQuery => ({
  refId: 'v',
  queryType: 'sql',
  ...overrides,
});

describe('generateVariableSql', () => {
  it('lists databases via SHOW DATABASES', () => {
    expect(generateVariableSql(baseQuery({ queryType: 'databases' }), 'public')).toBe('SHOW DATABASES');
  });

  it('lists tables in a specific database when one is selected', () => {
    const sql = generateVariableSql(baseQuery({ queryType: 'tables', database: 'public' }), 'public');
    expect(sql).toBe('SHOW TABLES FROM "public"');
  });

  it('falls back to default database for tables when no database is selected', () => {
    const sql = generateVariableSql(baseQuery({ queryType: 'tables' }), 'public');
    expect(sql).toBe('SHOW TABLES FROM "public"');
  });

  it('returns empty SQL for columns when database or table are missing', () => {
    expect(generateVariableSql(baseQuery({ queryType: 'columns' }), '')).toBe('');
    expect(generateVariableSql(baseQuery({ queryType: 'columns', database: 'public' }), '')).toBe('');
  });

  it('lists columns for a fully-specified database and table', () => {
    const sql = generateVariableSql(
      baseQuery({ queryType: 'columns', database: 'public', table: 'go_goroutines' }),
      ''
    );
    expect(sql).toBe(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'go_goroutines' ORDER BY ordinal_position"
    );
  });

  it('returns empty SQL for column values when required fields are missing', () => {
    expect(generateVariableSql(baseQuery({ queryType: 'columnValues' }), '')).toBe('');
    expect(
      generateVariableSql(baseQuery({ queryType: 'columnValues', database: 'public', table: 't' }), '')
    ).toBe('');
  });

  it('reads distinct values from a column', () => {
    const sql = generateVariableSql(
      baseQuery({
        queryType: 'columnValues',
        database: 'public',
        table: 'go_goroutines',
        column: 'instance',
      }),
      ''
    );
    expect(sql).toBe(
      `SELECT DISTINCT "instance" AS value FROM "public"."go_goroutines" WHERE "instance" IS NOT NULL ORDER BY value LIMIT 1000`
    );
  });

  it('escapes string literals and identifiers', () => {
    expect(escapeGreptimeStringLiteral("o'; DROP TABLE x --")).toBe("o''; DROP TABLE x --");
    expect(escapeGreptimeIdentifier('Svc"Name')).toBe('"Svc""Name"');

    const sql = generateVariableSql(
      baseQuery({
        queryType: 'columns',
        database: "pub'lic",
        table: 'go_goroutines',
      }),
      ''
    );
    expect(sql).toContain("table_schema = 'pub''lic'");
  });

  it('preserves the existing rawSql when the type is Custom SQL', () => {
    expect(generateVariableSql(baseQuery({ queryType: 'sql', rawSql: 'SELECT 1' }), 'public')).toBe('SELECT 1');
  });
});

describe('pickerLevelFor', () => {
  const cases: Array<[CHVariableQueryType, ReturnType<typeof pickerLevelFor>]> = [
    ['sql', null],
    ['databases', null],
    ['tables', 'database'],
    ['columns', 'table'],
    ['columnValues', 'column'],
  ];
  cases.forEach(([type, expected]) => {
    it(`returns ${expected} for ${type}`, () => {
      expect(pickerLevelFor(type)).toBe(expected);
    });
  });
});

describe('normalizeVariableQuery', () => {
  it('treats a legacy plain string as Custom SQL rawSql', () => {
    expect(normalizeVariableQuery('SELECT 1')).toEqual({
      refId: 'var',
      queryType: 'sql',
      rawSql: 'SELECT 1',
    });
  });

  it('keeps guided variable queryType', () => {
    expect(normalizeVariableQuery(baseQuery({ queryType: 'databases', rawSql: 'SHOW DATABASES' }))).toMatchObject({
      queryType: 'databases',
      rawSql: 'SHOW DATABASES',
    });
  });

  it('does not treat panel QueryType values as variable queryType (#60 DataQuery)', () => {
    expect(isCHVariableQueryType(QueryType.Table)).toBe(false);
    const normalized = normalizeVariableQuery({
      refId: 'A',
      editorType: EditorType.SQL,
      pluginVersion: '',
      queryType: QueryType.Table,
      rawSql: 'SELECT DISTINCT instance FROM public.go_goroutines',
    } as any);
    expect(normalized.queryType).toBe('sql');
    expect(normalized.rawSql).toBe('SELECT DISTINCT instance FROM public.go_goroutines');
  });
});

const buildDatasource = (overrides: Partial<Datasource> = {}): Datasource => {
  const ds = {} as Datasource;
  ds.getDefaultDatabase = jest.fn(() => 'public');
  ds.fetchDatabases = jest.fn(() => Promise.resolve(['public', 'information_schema']));
  ds.fetchTables = jest.fn(() => Promise.resolve(['go_goroutines']));
  ds.fetchColumns = jest.fn(() =>
    Promise.resolve([
      { name: 'instance', type: 'String', picklistValues: [] },
      { name: 'job', type: 'String', picklistValues: [] },
    ])
  );
  ds.metricFindQuery = jest.fn(() => Promise.resolve([{ text: 'foo' }, { text: 'bar' }])) as unknown as Datasource['metricFindQuery'];
  return Object.assign(ds, overrides);
};

describe('VariableQueryEditor', () => {
  it('starts in Custom SQL mode and shows the SQL textarea', async () => {
    const datasource = buildDatasource();
    const onChange = jest.fn();
    const result = await waitFor(() =>
      render(
        <VariableQueryEditor
          datasource={datasource}
          query={baseQuery()}
          onChange={onChange}
          onRunQuery={() => {}}
        />
      )
    );
    expect(result.getByLabelText('Variable type')).toBeInTheDocument();
    expect(result.getByLabelText('SQL Query')).toBeInTheDocument();
  });

  it('emits regenerated SQL when the user picks List databases', async () => {
    const datasource = buildDatasource();
    const onChange = jest.fn();
    const result = await waitFor(() =>
      render(
        <VariableQueryEditor
          datasource={datasource}
          query={baseQuery()}
          onChange={onChange}
          onRunQuery={() => {}}
        />
      )
    );
    const typeCombobox = result.getByLabelText('Variable type');
    fireEvent.keyDown(typeCombobox, { key: 'ArrowDown' });
    fireEvent.keyDown(typeCombobox, { key: 'ArrowDown' });
    fireEvent.keyDown(typeCombobox, { key: 'Enter' });
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0] as CHVariableQuery;
    expect(next.queryType).toBe('databases');
    expect(next.rawSql).toBe('SHOW DATABASES');
  });

  it('persists user edits to the SQL field without regenerating', async () => {
    const datasource = buildDatasource();
    const onChange = jest.fn();
    const result = await waitFor(() =>
      render(
        <VariableQueryEditor
          datasource={datasource}
          query={baseQuery({ queryType: 'sql', rawSql: 'SELECT 1' })}
          onChange={onChange}
          onRunQuery={() => {}}
        />
      )
    );
    const sqlArea = result.getByLabelText('SQL Query');
    fireEvent.change(sqlArea, { target: { value: 'SHOW DATABASES' } });
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as CHVariableQuery;
    expect(next.queryType).toBe('sql');
    expect(next.rawSql).toBe('SHOW DATABASES');
  });
});

describe('CHVariableSupport.query', () => {
  it('returns an empty response when there is no rawSql', async () => {
    const ds = buildDatasource();
    const support = new CHVariableSupport(ds);
    const response = await firstValueFrom(
      support.query({
        targets: [baseQuery({ rawSql: '' })],
      } as DataQueryRequest<CHVariableQuery>)
    );
    expect(response.data).toEqual([]);
    expect(ds.metricFindQuery).not.toHaveBeenCalled();
  });

  it('runs metricFindQuery with rawSql and emits string text/value fields', async () => {
    const ds = buildDatasource();
    const support = new CHVariableSupport(ds);
    const response = await firstValueFrom(
      support.query({
        targets: [baseQuery({ rawSql: 'SHOW DATABASES' })],
        range: {} as any,
      } as DataQueryRequest<CHVariableQuery>)
    );
    expect(ds.metricFindQuery).toHaveBeenCalledWith('SHOW DATABASES', expect.any(Object));
    expect(response.data).toHaveLength(1);
    const frame = response.data[0];
    expect(frame.fields[0].name).toBe('text');
    expect(frame.fields[0].type).toBe(FieldType.string);
    expect(frame.fields[0].values.toArray?.() ?? frame.fields[0].values).toEqual(['foo', 'bar']);
    expect(frame.fields[1].name).toBe('value');
    expect(frame.fields[1].type).toBe(FieldType.string);
  });

  it('accepts a legacy plain-string target', async () => {
    const ds = buildDatasource();
    const support = new CHVariableSupport(ds);
    await firstValueFrom(
      support.query({
        targets: ['SELECT 1' as any],
        range: {} as any,
      } as DataQueryRequest<CHVariableQuery>)
    );
    expect(ds.metricFindQuery).toHaveBeenCalledWith('SELECT 1', expect.any(Object));
  });
});
