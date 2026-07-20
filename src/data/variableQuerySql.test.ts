import {
  filterEmptyScopedVars,
  interpolateDashboardVariables,
  prepareVariableQuerySql,
  resolveVariableSql,
} from './variableQuerySql';
import { CHVariableQuery } from './variableQuerySql';

const templateSrvMock = {
  replace: jest.fn((target: string) => target),
};
jest.mock('@grafana/runtime', () => ({
  ...(jest.requireActual('@grafana/runtime') as unknown as object),
  getTemplateSrv: () => templateSrvMock,
}));

const baseQuery = (overrides: Partial<CHVariableQuery> = {}): CHVariableQuery => ({
  refId: 'v',
  queryType: 'sql',
  ...overrides,
});

describe('filterEmptyScopedVars', () => {
  it('drops empty dependent variable entries so templateSrv can resolve them', () => {
    expect(
      filterEmptyScopedVars({
        table: { value: 'syslog', text: 'syslog' },
        column: { value: '', text: '' },
      })
    ).toEqual({
      table: { value: 'syslog', text: 'syslog' },
    });
  });

  it('returns undefined when every entry is empty', () => {
    expect(filterEmptyScopedVars({ column: { value: '', text: '' } })).toBeUndefined();
  });
});

describe('interpolateDashboardVariables', () => {
  it('uses filtered scopedVars so empty dependents fall back to templateSrv global state', () => {
    templateSrvMock.replace.mockImplementation((target: string, scopedVars?: unknown) => {
      expect(scopedVars).toBeUndefined();
      return target.replace(/"\$column"/g, '"service"').replace(/\$column\b/g, 'service');
    });
    const sql =
      'SELECT DISTINCT "$column" AS value FROM "public"."syslog" WHERE "$column" IS NOT NULL ORDER BY value LIMIT 1000';
    const result = interpolateDashboardVariables(sql, { column: { value: '', text: '' } });
    expect(result).toBe(
      'SELECT DISTINCT "service" AS value FROM "public"."syslog" WHERE "service" IS NOT NULL ORDER BY value LIMIT 1000'
    );
  });
});

describe('resolveVariableSql', () => {
  it('regenerates columnValues SQL from pickers instead of stale rawSql templates', () => {
    const sql = resolveVariableSql(
      baseQuery({
        queryType: 'columnValues',
        database: 'public',
        table: 'syslog',
        column: 'hostname',
        rawSql:
          'SELECT DISTINCT "$column" AS value FROM "public"."syslog" WHERE "$column" IS NOT NULL ORDER BY value LIMIT 1000',
      }),
      'public'
    );
    expect(sql).toBe(
      'SELECT DISTINCT "hostname" AS value FROM "public"."syslog" WHERE "hostname" IS NOT NULL ORDER BY value LIMIT 1000'
    );
  });
});

describe('prepareVariableQuerySql', () => {
  beforeEach(() => {
    templateSrvMock.replace.mockImplementation((target: string) =>
      target.replace(/"\$column"/g, '"service"').replace(/\$column\b/g, 'service')
    );
  });

  it('expands dashboard variables in custom SQL', () => {
    const sql = prepareVariableQuerySql(
      baseQuery({
        queryType: 'sql',
        rawSql:
          'SELECT DISTINCT "$column" AS value FROM "public"."syslog" WHERE "$column" IS NOT NULL ORDER BY value LIMIT 1000',
      }),
      'public',
      { column: { value: 'service', text: 'service' } }
    );
    expect(sql).toBe(
      'SELECT DISTINCT "service" AS value FROM "public"."syslog" WHERE "service" IS NOT NULL ORDER BY value LIMIT 1000'
    );
  });

  it('does not run templateSrv for guided columnValues queries', () => {
    templateSrvMock.replace.mockClear();
    const sql = prepareVariableQuerySql(
      baseQuery({
        queryType: 'columnValues',
        database: 'public',
        table: 'syslog',
        column: 'hostname',
      }),
      'public'
    );
    expect(templateSrvMock.replace).not.toHaveBeenCalled();
    expect(sql).toContain('"hostname"');
  });
});
