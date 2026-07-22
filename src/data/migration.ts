import { ColumnHint, Filter, QueryBuilderOptions, QueryType, SelectedColumn } from "types/queryBuilder";
import { GreptimeBuilderQuery, GreptimeQuery, GreptimeSqlQuery, EditorType } from "types/sql";
import { pluginVersion } from "utils/version";
import { mapGrafanaFormatToQueryType } from "./utils";

export type AnyGreptimeQuery = Partial<GreptimeQuery> & {[k: string]: any};
export type AnyQueryBuilderOptions = Partial<QueryBuilderOptions> & {[k: string]: any};

/**
 * Takes a GreptimeQuery and transforms it to the latest interface.
 */
export const migrateGreptimeQuery = (savedQuery: GreptimeQuery): GreptimeQuery => {
  const isGrafanaDefaultQuery = savedQuery.rawSql === undefined;
  if (isGrafanaDefaultQuery) {
    return savedQuery;
  }

  if (isV3GreptimeQuery(savedQuery)) {
    return migrateV3GreptimeQuery(savedQuery);
  }

  return savedQuery;
};

/**
 * Takes v3 GreptimeQuery and returns a version compatible with the latest editor.
 */
const migrateV3GreptimeQuery = (savedQuery: AnyGreptimeQuery): GreptimeQuery => {
  // Builder Query
  if (savedQuery['queryType'] === 'builder') {
    const builderQuery: GreptimeBuilderQuery = {
      ...savedQuery,
      pluginVersion,
      editorType: EditorType.Builder,
      builderOptions: migrateV3QueryBuilderOptions(savedQuery['builderOptions'] || {}),
      rawSql: savedQuery.rawSql || '',
      refId: savedQuery.refId || '',
      format: savedQuery.format,
    };

    if (savedQuery?.meta?.timezone) {
      builderQuery.meta = {
        timezone: savedQuery.meta.timezone
      };
    }

    // delete unwanted properties from v3
    delete (builderQuery as any)['queryType'];
    delete (builderQuery as any)['selectedFormat'];

    return builderQuery;
  }

  // Raw SQL Query
  const rawSqlQuery: GreptimeSqlQuery = {
    ...savedQuery,
    pluginVersion,
    editorType: EditorType.SQL,
    rawSql: savedQuery.rawSql || '',
    refId: savedQuery.refId || '',
    format: savedQuery.format,
    queryType: mapGrafanaFormatToQueryType(savedQuery.format),
    meta: {}
  };

  if (savedQuery.expand) {
    rawSqlQuery.expand = savedQuery.expand;
  }

  if (savedQuery.meta) {
    const meta = (savedQuery.meta as any);
    if (meta.timezone) {
      rawSqlQuery.meta!.timezone = meta.timezone;
    }

    if (meta.builderOptions) {
      // When changing from builder to raw editor, the builder options are saved and also require migration
      rawSqlQuery.meta!.builderOptions = migrateV3QueryBuilderOptions(meta.builderOptions);
    }
  }

  // delete unwanted properties from v3
  delete (rawSqlQuery as any)['builderOptions'];
  delete (rawSqlQuery as any)['selectedFormat'];

  return rawSqlQuery;
};

/**
 * Takes v3 options and returns a version compatible with the latest builder.
 */
const migrateV3QueryBuilderOptions = (savedOptions: AnyQueryBuilderOptions): QueryBuilderOptions => {
  const mapped: QueryBuilderOptions = {
    database: savedOptions.database || '',
    table: savedOptions.table || '',
    queryType: getV3QueryType(savedOptions),
    columns: []
  };

  if (savedOptions.mode) {
    mapped.mode = savedOptions.mode;
  }

  if (savedOptions['fields'] || Array.isArray(savedOptions['fields'])) {
    const oldColumns: string[] = savedOptions['fields'];
    mapped.columns = oldColumns.map((name: string) => ({ name }));
  }


  const timeField: string = savedOptions['timeField'];
  const timeFieldType: string = savedOptions['timeFieldType'];
  if (timeField) {
    const timeColumn: SelectedColumn = {
      name: timeField,
      type: timeFieldType,
      hint: ColumnHint.Time
    };

    mapped.columns!.push(timeColumn);
  }
  
  const logLevelField: string = savedOptions['logLevelField'];
  if (logLevelField) {
    const logLevelColumn: SelectedColumn = {
      name: logLevelField,
      hint: ColumnHint.LogLevel
    };

    mapped.columns!.push(logLevelColumn);
  }

  if (savedOptions['metrics'] || Array.isArray(savedOptions['metrics'])) {
    const oldAggregates: any[] = savedOptions['metrics'];
    mapped.aggregates = oldAggregates.map(agg => ({
      aggregateType: agg['aggregation'],
      column: agg['field'],
      alias: agg['alias']
    }));
  }

  if (savedOptions.filters || Array.isArray(savedOptions.filters)) {
    const oldFilters: Filter[] = savedOptions.filters;

    mapped.filters = oldFilters.map((filter: Filter) => {
      const result: Filter = {
        ...filter
      };

      if (filter.key === timeField) {
        result.hint = ColumnHint.Time;
      } else if (filter.key === logLevelField) {
        result.hint = ColumnHint.LogLevel;
      }

      return result;
    });
  }

  if (savedOptions.groupBy || Array.isArray(savedOptions.groupBy)) {
    mapped.groupBy = savedOptions.groupBy;
  }

  if (savedOptions.orderBy || Array.isArray(savedOptions.orderBy)) {
    mapped.orderBy = savedOptions.orderBy;
  }

  if (savedOptions.limit !== undefined && savedOptions.limit >= 0) {
    mapped.limit = savedOptions.limit;
  }

  return mapped;
};


/**
 * Checks if GreptimeQuery is from <= v3 options.
 * Upstream ClickHouse used pluginVersion < 4.0.0; this fork is still on 2.x,
 * so detect v3 by shape (top-level queryType sql|builder) instead of version.
 */
const isV3GreptimeQuery = (savedQuery: AnyGreptimeQuery): boolean => {
  const oldQueryType = savedQuery['queryType'] === 'sql' || savedQuery['queryType'] === 'builder';
  if (oldQueryType) {
    return true;
  }
  // Incomplete / pre-editorType queries still need migration when rawSql exists.
  return !savedQuery.editorType && Boolean(savedQuery.rawSql);
};

/**
 * Takes v3 options and returns the optimal QueryType. Defaults to QueryType.Table.
 */
const getV3QueryType = (savedOptions: AnyQueryBuilderOptions): QueryType => {
  if (savedOptions['timeField']) {
    return QueryType.TimeSeries;
  } else if (savedOptions['logLevelField']) {
    return QueryType.Logs;
  }

  return QueryType.Table;
};
