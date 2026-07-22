import { ScopedVars } from '@grafana/data';
import { getTemplateSrv } from '@grafana/runtime';

/**
 * Variable query types. Each one renders a different combination of pickers and
 * generates a default SQL query that the user can edit before saving.
 */
export type GreptimeVariableQueryType = 'sql' | 'databases' | 'tables' | 'columns' | 'columnValues';

/** Variable query model. Persisted as part of the dashboard JSON. */
export interface GreptimeVariableQuery {
  refId: string;
  queryType: GreptimeVariableQueryType;
  rawSql?: string;
  database?: string;
  table?: string;
  column?: string;
}

const VARIABLE_QUERY_TYPES = new Set<GreptimeVariableQueryType>([
  'sql',
  'databases',
  'tables',
  'columns',
  'columnValues',
]);

export function isGreptimeVariableQueryType(value: unknown): value is GreptimeVariableQueryType {
  return typeof value === 'string' && VARIABLE_QUERY_TYPES.has(value as GreptimeVariableQueryType);
}

/** Escape a Greptime/MySQL string literal for use inside single quotes. */
export function escapeGreptimeStringLiteral(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "''");
}

/** Quote a Greptime identifier with doubled internal quotes. */
export function escapeGreptimeIdentifier(id: string): string {
  return id ? `"${id.replace(/"/g, '""')}"` : '';
}

export function generateVariableSql(query: GreptimeVariableQuery, defaultDatabase: string): string {
  const db = query.database || defaultDatabase || '';
  switch (query.queryType) {
    case 'databases':
      return 'SHOW DATABASES';
    case 'tables':
      return db ? `SHOW TABLES FROM ${escapeGreptimeIdentifier(db)}` : 'SHOW TABLES';
    case 'columns':
      if (!db || !query.table) {
        return '';
      }
      return (
        `SELECT column_name FROM information_schema.columns ` +
        `WHERE table_schema = '${escapeGreptimeStringLiteral(db)}' ` +
        `AND table_name = '${escapeGreptimeStringLiteral(query.table)}' ` +
        `ORDER BY ordinal_position`
      );
    case 'columnValues': {
      if (!db || !query.table || !query.column) {
        return '';
      }
      const column = escapeGreptimeIdentifier(query.column);
      const tableRef = `${escapeGreptimeIdentifier(db)}.${escapeGreptimeIdentifier(query.table)}`;
      return (
        `SELECT DISTINCT ${column} AS value FROM ${tableRef} ` +
        `WHERE ${column} IS NOT NULL ORDER BY value LIMIT 1000`
      );
    }
    case 'sql':
    default:
      return query.rawSql || '';
  }
}

/**
 * Grafana may pass dependent variables in scopedVars with empty values while the
 * cascade is still loading. Empty entries override templateSrv global resolution,
 * so strip them before calling templateSrv.replace (matches pre-Go-backend behavior).
 */
export function filterEmptyScopedVars(scopedVars?: ScopedVars): ScopedVars | undefined {
  if (!scopedVars) {
    return undefined;
  }
  const filtered: ScopedVars = {};
  for (const [key, entry] of Object.entries(scopedVars)) {
    const value = entry?.value;
    if (value === null || value === undefined || value === '') {
      continue;
    }
    if (Array.isArray(value) && value.length === 0) {
      continue;
    }
    filtered[key] = entry;
  }
  return Object.keys(filtered).length > 0 ? filtered : undefined;
}

/** Expand dashboard template variables ($column, $table, …) in variable-query SQL. */
export function interpolateDashboardVariables(sql: string, scopedVars?: ScopedVars): string {
  if (!sql) {
    return sql;
  }
  const templateSrv = getTemplateSrv?.();
  if (!templateSrv?.replace) {
    return sql;
  }
  return templateSrv.replace(sql, filterEmptyScopedVars(scopedVars)) ?? sql;
}

/** Resolve SQL for a variable query. Guided types regenerate from pickers at runtime. */
export function resolveVariableSql(query: GreptimeVariableQuery, defaultDatabase: string): string {
  if (query.queryType !== 'sql') {
    const generated = generateVariableSql(query, defaultDatabase);
    if (generated) {
      return generated;
    }
  }
  return query.rawSql || '';
}

export function prepareVariableQuerySql(
  query: GreptimeVariableQuery,
  defaultDatabase: string,
  requestScopedVars?: ScopedVars
): string {
  const sql = resolveVariableSql(query, defaultDatabase);
  if (query.queryType !== 'sql') {
    return sql;
  }
  return interpolateDashboardVariables(sql, requestScopedVars);
}
