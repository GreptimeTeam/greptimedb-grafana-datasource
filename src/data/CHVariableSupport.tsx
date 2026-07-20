import React, { useCallback, useMemo } from 'react';
import {
  CustomVariableSupport,
  DataQueryRequest,
  DataQueryResponse,
  FieldType,
  MetricFindValue,
  QueryEditorProps,
  toDataFrame,
} from '@grafana/data';
import { InlineField, InlineFormLabel, Select, TextArea } from '@grafana/ui';
import { Observable, from, of } from 'rxjs';
import { DatabaseSelect, TableSelect } from 'components/queryBuilder/DatabaseTableSelect';
import useColumns from 'hooks/useColumns';
import { styles } from 'styles';
import { CHConfig } from 'types/config';
import { CHQuery } from 'types/sql';
import { Datasource } from './CHDatasource';
import {
  CHVariableQuery,
  CHVariableQueryType,
  generateVariableSql,
  isCHVariableQueryType,
  resolveVariableSql,
} from './variableQuerySql';

export type { CHVariableQuery, CHVariableQueryType };
export {
  escapeGreptimeIdentifier,
  escapeGreptimeStringLiteral,
  filterEmptyScopedVars,
  generateVariableSql,
  interpolateDashboardVariables,
  isCHVariableQueryType,
  prepareVariableQuerySql,
  resolveVariableSql,
} from './variableQuerySql';

/**
 * Variable query types. Each one renders a different combination of pickers and
 * generates a default SQL query that the user can edit before saving.
 */

const VARIABLE_TYPE_OPTIONS: Array<{ label: string; value: CHVariableQueryType; description?: string }> = [
  { label: 'Custom SQL', value: 'sql', description: 'Write any SQL query, same as before' },
  { label: 'List databases', value: 'databases', description: 'All databases on the server' },
  { label: 'List tables', value: 'tables', description: 'Tables inside a database' },
  { label: 'List columns', value: 'columns', description: 'Columns inside a table' },
  { label: 'Column values', value: 'columnValues', description: 'Distinct values of a column' },
];

/** Returns which pickers a query type needs. */
export type VariablePickerLevel = 'database' | 'table' | 'column' | null;

export function pickerLevelFor(queryType: CHVariableQueryType): VariablePickerLevel {
  switch (queryType) {
    case 'tables':
      return 'database';
    case 'columns':
      return 'table';
    case 'columnValues':
      return 'column';
    default:
      return null;
  }
}

export function normalizeVariableQuery(query: CHVariableQuery | CHQuery | string | undefined): CHVariableQuery {
  if (typeof query === 'string') {
    return { refId: 'var', queryType: 'sql', rawSql: query };
  }

  const rawSql =
    typeof (query as CHVariableQuery | undefined)?.rawSql === 'string'
      ? (query as CHVariableQuery).rawSql
      : undefined;
  const queryType = isCHVariableQueryType((query as CHVariableQuery | undefined)?.queryType)
    ? ((query as CHVariableQuery).queryType as CHVariableQueryType)
    : 'sql';

  return {
    refId: query?.refId || 'var',
    queryType,
    rawSql,
    database: (query as CHVariableQuery | undefined)?.database,
    table: (query as CHVariableQuery | undefined)?.table,
    column: (query as CHVariableQuery | undefined)?.column,
  };
}

type EditorProps = QueryEditorProps<Datasource, CHQuery, CHConfig, CHVariableQuery>;

export const VariableQueryEditor = (props: EditorProps) => {
  const { query, onChange, datasource } = props;
  const safeQuery = useMemo(() => normalizeVariableQuery(query), [query]);

  const defaultDatabase = datasource.getDefaultDatabase() || '';
  const pickerLevel = pickerLevelFor(safeQuery.queryType);
  const columns = useColumns(datasource, safeQuery.database || '', safeQuery.table || '');
  const columnOptions = useMemo(
    () => columns.map((c) => ({ label: c.label || c.name, value: c.name })),
    [columns]
  );

  const onTypeChange = useCallback(
    (queryType: CHVariableQueryType) => {
      const next: CHVariableQuery = { ...safeQuery, queryType };
      next.rawSql = generateVariableSql(next, defaultDatabase);
      onChange(next);
    },
    [defaultDatabase, onChange, safeQuery]
  );

  const onDatabaseChange = useCallback(
    (database: string) => {
      const next: CHVariableQuery = { ...safeQuery, database, table: '', column: '' };
      next.rawSql = generateVariableSql(next, defaultDatabase);
      onChange(next);
    },
    [defaultDatabase, onChange, safeQuery]
  );

  const onTableChange = useCallback(
    (table: string) => {
      const next: CHVariableQuery = { ...safeQuery, table, column: '' };
      next.rawSql = generateVariableSql(next, defaultDatabase);
      onChange(next);
    },
    [defaultDatabase, onChange, safeQuery]
  );

  const onColumnChange = useCallback(
    (column: string) => {
      const next: CHVariableQuery = { ...safeQuery, column };
      next.rawSql = generateVariableSql(next, defaultDatabase);
      onChange(next);
    },
    [defaultDatabase, onChange, safeQuery]
  );

  const onSqlChange = useCallback(
    (rawSql: string) => {
      onChange({ ...safeQuery, rawSql });
    },
    [onChange, safeQuery]
  );

  return (
    <div>
      <InlineField
        label={
          <InlineFormLabel
            width={10}
            className="query-keyword"
            tooltip="Pick a guided variable type, or keep Custom SQL to write your own query."
          >
            Variable type
          </InlineFormLabel>
        }
      >
        <Select
          width={40}
          options={VARIABLE_TYPE_OPTIONS}
          value={safeQuery.queryType}
          onChange={(v) => onTypeChange((v.value as CHVariableQueryType) || 'sql')}
          aria-label="Variable type"
        />
      </InlineField>

      {pickerLevel && (
        <div className="gf-form">
          {(pickerLevel === 'database' || pickerLevel === 'table' || pickerLevel === 'column') && (
            <DatabaseSelect
              datasource={datasource}
              database={safeQuery.database || ''}
              onDatabaseChange={onDatabaseChange}
            />
          )}
          {(pickerLevel === 'table' || pickerLevel === 'column') && (
            <TableSelect
              datasource={datasource}
              database={safeQuery.database || ''}
              table={safeQuery.table || ''}
              onTableChange={onTableChange}
            />
          )}
        </div>
      )}

      {pickerLevel === 'column' && (
        <div className="gf-form">
          <InlineFormLabel width={8} className="query-keyword" tooltip="Column to list distinct values from">
            Column
          </InlineFormLabel>
          <Select
            className={`width-15 ${styles.Common.inlineSelect}`}
            options={columnOptions}
            value={safeQuery.column || null}
            onChange={(v) => onColumnChange(v.value || '')}
            placeholder="Select column"
            menuPlacement="bottom"
            allowCustomValue
            aria-label="Column"
          />
        </div>
      )}

      <InlineField
        label={
          <InlineFormLabel
            width={10}
            className="query-keyword"
            tooltip="Generated SQL. You can edit it; the runtime variable resolver uses this exact query."
          >
            SQL Query
          </InlineFormLabel>
        }
        grow
        shrink
      >
        <TextArea
          rows={3}
          value={safeQuery.rawSql || ''}
          onChange={(e) => onSqlChange(e.currentTarget.value)}
          placeholder="SELECT DISTINCT column FROM database.table"
          aria-label="SQL Query"
        />
      </InlineField>
    </div>
  );
};

/**
 * Coerce a metric-find value into a string for a template variable option,
 * preserving null/undefined as null (not the literal string "null").
 */
function toVariableString(value: unknown): string | null {
  return value == null ? null : String(value);
}

/**
 * CustomVariableSupport binding. Registers the guided editor and runs the
 * resolved `rawSql` through the existing `metricFindQuery` path so all the
 * macro expansion (template variables, time filter, ad-hoc filters) stays in
 * one place.
 */
export class CHVariableSupport extends CustomVariableSupport<Datasource, CHVariableQuery> {
  constructor(private readonly datasource: Datasource) {
    super();
  }

  editor = VariableQueryEditor;

  query(request: DataQueryRequest<CHVariableQuery>): Observable<DataQueryResponse> {
    const target = request.targets[0];
    const normalized = normalizeVariableQuery(target as CHVariableQuery | string | undefined);
    const defaultDatabase = this.datasource.getDefaultDatabase() || '';
    if (!resolveVariableSql(normalized, defaultDatabase)) {
      return of({ data: [] });
    }
    const promise = this.datasource
      .metricFindQuery('', {
        range: request.range,
        scopedVars: request.scopedVars,
        skipAdHocFilters: true,
        variableQuery: normalized,
      })
      .then((values: MetricFindValue[]) => ({
        // Emit text and value separately so a `SELECT value, label` query
        // substitutes the value while displaying the label. Force string typing:
        // an untyped toDataFrame would guess FieldType.number for numeric-looking
        // values, which makes Grafana's toMetricFindValues fail.
        data: [
          toDataFrame({
            fields: [
              { name: 'text', type: FieldType.string, values: values.map((v) => toVariableString(v.text)) },
              { name: 'value', type: FieldType.string, values: values.map((v) => toVariableString(v.value ?? v.text)) },
            ],
          }),
        ],
      }));
    return from(promise);
  }
}
