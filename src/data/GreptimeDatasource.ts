import {
  DataFrame,
  DataFrameView,
  DataQueryRequest,
  DataQueryResponse,
  DataSourceInstanceSettings,
  DataSourceWithLogsContextSupport,
  DataSourceWithSupplementaryQueriesSupport,
  getTimeZone,
  getTimeZoneInfo,
  LogRowContextOptions,
  LogRowContextQueryDirection,
  LogRowModel,
  MetricFindValue,
  MutableDataFrame,
  QueryFixAction,
  ScopedVars,
  SupplementaryQueryOptions,
  SupplementaryQueryType,
  TypedVariableModel,
} from '@grafana/data';
import {  BackendSrvRequest, DataSourceWithBackend, FetchResponse, getBackendSrv, getTemplateSrv } from '@grafana/runtime';
import { Observable, map, firstValueFrom, catchError, of } from 'rxjs';
import { GreptimeConfig } from 'types/config';
import { EditorType, GreptimeQuery, GreptimeSqlQuery } from 'types/sql';
import {
  QueryType,
  AggregateColumn,
  AggregateType,
  BuilderMode,
  Filter,
  FilterOperator,
  TableColumn,
  OrderByDirection,
  QueryBuilderOptions,
  ColumnHint,
  TimeUnit,
  SelectedColumn,
} from 'types/queryBuilder';
import { AdHocVariableFilter, columnNameFromAdhocKey, tableAndColumnFromAdhocKey } from './adHocFilter';
import { GreptimeVariableSupport } from './GreptimeVariableSupport';
import { cloneDeep, isEmpty, isString } from 'lodash';
import {
  DEFAULT_LOGS_ALIAS,
  getIntervalInfo,
  getTimeFieldRoundingClause,
  LOG_LEVEL_TO_IN_CLAUSE,
  queryLogsVolume,
  TIME_FIELD_ALIAS,
} from './logs';
import { generateSql, getColumnByHint, logAliasToColumnHints } from './sqlGenerator';
import otel from 'otel';
import { createElement as createReactElement, ReactNode } from 'react';
import { dataFrameHasLogLabelWithName, transformQueryResponseWithTraceAndLogLinks } from './utils';
import { replacePreservingBackendMacros } from './macroTemplate';
import { prepareVariableQuerySql, interpolateDashboardVariables, filterEmptyScopedVars } from './variableQuerySql';
import { pluginVersion } from 'utils/version';
import LogsContextPanel from 'components/LogsContextPanel';

/** Prefer Greptime/Grafana fetch error bodies over an empty Error.message ("Unknown error"). */
function formatQueryError(error: any): string {
  if (!error) {
    return 'Unknown error';
  }
  const data = error.data ?? error;
  const fromBody =
    (typeof data === 'string' && data) ||
    data?.error ||
    data?.message ||
    data?.error_info?.message ||
    (typeof data?.error_code !== 'undefined' ? `error_code=${data.error_code}` : undefined);
  if (fromBody) {
    return String(fromBody);
  }
  if (error.message) {
    return String(error.message);
  }
  if (error.status) {
    return `HTTP ${error.status}`;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return 'Unknown error';
  }
}

function createMultiSearchAnyEquivalent(llfColumn: string, searchTermsString: string, alias: string): { aggregateType: AggregateType; column: string; alias: string } {
  const searchTerms = searchTermsString.split(','); // Split the comma-separated string into an array of terms
  const orConditions = searchTerms.map(term => `INSTR(${llfColumn}, ${term.trim()}) > 0`).join(' OR ');
  const greptimeEquivalent = `CAST(${orConditions} AS INTEGER)`;

  return {
    aggregateType: AggregateType.Sum,
    column: greptimeEquivalent,
    alias: alias,
  };
}

export class Datasource
  extends DataSourceWithBackend<GreptimeQuery, GreptimeConfig>
  implements DataSourceWithSupplementaryQueriesSupport<GreptimeQuery>,
  DataSourceWithLogsContextSupport<GreptimeQuery>
{
  // This enables default annotation support for 7.2+
  annotations = {};
  settings: DataSourceInstanceSettings<GreptimeConfig>;
  skipAdHocFilter = false; // don't apply adhoc filters to the query
  adHocFiltersStatus = AdHocFilterStatus.none;
  lastTimeRange?: { from: string; to: string };

  constructor(instanceSettings: DataSourceInstanceSettings<GreptimeConfig>) {
    super(instanceSettings);
    this.settings = instanceSettings;
    this.variables = new GreptimeVariableSupport(this);
  }
  
  private buildFiltersFromAdhoc(adHocFilters: AdHocVariableFilter[], targetTable: string): Filter[] {
    const result: Filter[] = [];

    for (const f of adHocFilters) {
      if (!f || !f.key || !f.operator || f.value === undefined || f.value === null) {
        continue;
      }

      const tc = tableAndColumnFromAdhocKey(f.key);
      if (tc && targetTable && tc.table !== targetTable) {
        continue;
      }

      const key = columnNameFromAdhocKey(f.key);
      if (!key) {
        continue;
      }
      const condition: 'AND' | 'OR' = (f.condition as any) || 'AND';
      const isNullLiteral = typeof f.value === 'string' && f.value.trim().toLowerCase() === 'null';

      if (f.operator === '=' || f.operator === '!=') {
        if (isNullLiteral) {
          // Treat "null" specially and use IS NULL / IS NOT NULL instead of comparing to string 'null'
          const op = f.operator === '=' ? FilterOperator.IsNull : FilterOperator.IsNotNull;
          result.push({
            filterType: 'custom',
            key,
            type: 'string',
            condition,
            operator: op,
          } as Filter);
        } else {
          const op = f.operator === '=' ? FilterOperator.Equals : FilterOperator.NotEquals;
          result.push({
            filterType: 'custom',
            key,
            type: 'string',
            condition,
            operator: op,
            value: f.value,
          } as Filter);
        }
        continue;
      }

      if (f.operator === '=~' || f.operator === '!~') {
        const op = f.operator === '=~' ? FilterOperator.Like : FilterOperator.NotLike;
        result.push({
          filterType: 'custom',
          key,
          type: 'string',
          condition,
          operator: op,
          value: f.value,
        } as Filter);
        continue;
      }

      if (f.operator === '>' || f.operator === '<') {
        const opMap: Record<string, FilterOperator> = {
          '>': FilterOperator.GreaterThan,
          '<': FilterOperator.LessThan,
        };
        const isNumeric = !isNaN(Number(f.value)) && f.value.trim() !== '';
        result.push({
          filterType: 'custom',
          key,
          type: isNumeric ? 'number' : 'string',
          condition,
          operator: opMap[f.operator],
          value: isNumeric ? Number(f.value) : f.value,
        } as Filter);
        continue;
      }

      if (f.operator === 'IN') {
        const cleaned = f.value.trim().replace(/^\(|\)$/g, '');
        const parts = cleaned
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        if (parts.length === 0) {
          continue;
        }
        result.push({
          filterType: 'custom',
          key,
          type: 'string',
          condition,
          operator: FilterOperator.In,
          value: parts,
        } as Filter);
        continue;
      }
    }

    return result;
  }
  
  _request<T = unknown>(
    url: string,
    data: Record<string, string> | null,
    overrides: Partial<BackendSrvRequest> = {}
  ): Observable<FetchResponse<T>> {
    return getBackendSrv().fetch({
      url: `api/datasources/proxy/uid/${this.uid}/greptime/v1/sql`,
      method: 'POST',
      data: {
        ...data
      },
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'x-greptime-db-name': this.settings.jsonData.defaultDatabase || 'public'
      }
    });
  }

  getDataProvider(
    type: SupplementaryQueryType,
    request: DataQueryRequest<GreptimeQuery>
  ): Observable<DataQueryResponse> | undefined {
    if (!this.getSupportedSupplementaryQueryTypes().includes(type)) {
      return undefined;
    }
    switch (type) {
      case SupplementaryQueryType.LogsVolume:
        const logsVolumeRequest = cloneDeep(request);

        const intervalInfo = getIntervalInfo(logsVolumeRequest.scopedVars);
        logsVolumeRequest.interval = intervalInfo.interval;
        logsVolumeRequest.scopedVars.__interval = { value: intervalInfo.interval, text: intervalInfo.interval };
        logsVolumeRequest.hideFromInspector = true;
        if (intervalInfo.intervalMs !== undefined) {
          logsVolumeRequest.intervalMs = intervalInfo.intervalMs;
          logsVolumeRequest.scopedVars.__interval_ms = {
            value: intervalInfo.intervalMs,
            text: intervalInfo.intervalMs,
          };
        }

        const targets: GreptimeQuery[] = [];
        logsVolumeRequest.targets.forEach((target) => {
          const supplementaryQuery = this.getSupplementaryLogsVolumeQuery(logsVolumeRequest, target);
          if (supplementaryQuery !== undefined) {
            targets.push(supplementaryQuery);
          }
        });

        if (!targets.length) {
          return undefined;
        }

        return queryLogsVolume(
          this,
          { ...logsVolumeRequest, targets },
          {
            range: logsVolumeRequest.range,
            targets: logsVolumeRequest.targets,
          }
        );
      default:
        return undefined;
    }
  }

  getSupportedSupplementaryQueryTypes(): SupplementaryQueryType[] {
    return [SupplementaryQueryType.LogsVolume];
  }

  getSupplementaryLogsVolumeQuery(logsVolumeRequest: DataQueryRequest<GreptimeQuery>, query: GreptimeQuery): GreptimeQuery | undefined {
    if (
      query.editorType !== EditorType.Builder ||
      query.builderOptions.queryType !== QueryType.Logs ||
      query.builderOptions.mode !== BuilderMode.List ||
      query.builderOptions.database === '' ||
      query.builderOptions.table === ''
    ) {
      return undefined;
    }

    

    const timeColumn = getColumnByHint(query.builderOptions, ColumnHint.Time);
    if (timeColumn === undefined || !timeColumn.name?.trim()) {
      return undefined;
    }

    const columns: SelectedColumn[] = [];
    const aggregates: AggregateColumn[] = [];
    columns.push({
      name: getTimeFieldRoundingClause(logsVolumeRequest.scopedVars, timeColumn.name),
      alias: TIME_FIELD_ALIAS,
      hint: ColumnHint.Time,
      columnName: timeColumn.name
    });

    const logLevelColumn = getColumnByHint(query.builderOptions, ColumnHint.LogLevel);
    if (logLevelColumn) {
      // Generates aggregates like
      // sum(toString("log_level") IN ('dbug', 'debug', 'DBUG', 'DEBUG', 'Dbug', 'Debug')) AS debug
      const llf = `("${logLevelColumn.name}")`;
      let level: keyof typeof LOG_LEVEL_TO_IN_CLAUSE;
      
      for (level in LOG_LEVEL_TO_IN_CLAUSE) {
        aggregates.push(createMultiSearchAnyEquivalent(llf, LOG_LEVEL_TO_IN_CLAUSE[level], level));
      }
    } else {
      // Count all logs if level column isn't selected
      aggregates.push({
        aggregateType: AggregateType.Count,
        column: '*',
        alias: DEFAULT_LOGS_ALIAS,
      });
    }

    const filters = (query.builderOptions.filters?.slice() || []).map(f => {
      // In order for a hinted filter to work, the hinted column must be SELECTed OR provide "key"
      // For this histogram query the "level" column isn't selected, so we must find the original column name
      if (f.hint && !f.key) {
        const originalColumn = getColumnByHint(query.builderOptions, f.hint);
        f.key = originalColumn?.alias || originalColumn?.name || '';
      }

      return f;
    });

    const logVolumeSqlBuilderOptions: QueryBuilderOptions = {
      database: query.builderOptions.database,
      table: query.builderOptions.table,
      queryType: QueryType.TimeSeries,
      filters,
      columns,
      aggregates,
      orderBy: [{ name: '', hint: ColumnHint.Time, dir: OrderByDirection.ASC }],
    };

    const logVolumeSupplementaryQuery = generateSql(logVolumeSqlBuilderOptions);
    return {
      pluginVersion,
      editorType: EditorType.Builder,
      builderOptions: logVolumeSqlBuilderOptions,
      rawSql: logVolumeSupplementaryQuery,
      refId: '',
    };
  }

  getSupplementaryQuery(options: SupplementaryQueryOptions, originalQuery: GreptimeQuery): GreptimeQuery | undefined {
    return undefined;
  }

  async metricFindQuery(query: GreptimeQuery | string, options: any = {}) {
    if (this.adHocFiltersStatus === AdHocFilterStatus.none) {
      this.adHocFiltersStatus = await this.canUseAdhocFilters();
    }

    const sql = options?.variableQuery
      ? prepareVariableQuerySql(options.variableQuery, this.getDefaultDatabase(), options.scopedVars)
      : interpolateDashboardVariables(isString(query) ? query : query.rawSql || '', options?.scopedVars);
    const rawSql = sql;

    if (!rawSql) {
      return [];
    }

    const greptimeQuery: GreptimeSqlQuery = {
      rawSql,
      editorType: EditorType.SQL,
      refId: 'metricFind',
      pluginVersion,
      meta: {
        skipAdHocFilters: options?.skipAdHocFilters ?? true,
      },
    };

    const frame = await this.runQuery(greptimeQuery, {
      ...options,
      // Variable SQL is fully interpolated above. Do not pass scopedVars into
      // super.query() — empty dependent entries override templateSrv global state
      // (regression vs pre-Go-backend runQuery which never forwarded scopedVars).
      scopedVars: undefined,
    });
    if (frame.fields?.length === 0) {
      return [];
    }
    if (frame?.fields?.length === 1) {
      return frame?.fields[0]?.values.map((text) => ({ text, value: text }));
    }
    // convention - assume the first field is an id field
    const ids = frame?.fields[0]?.values;
    return frame?.fields[1]?.values.map((text, i) => ({ text, value: ids.get(i) }));
  }

  applyTemplateVariables(query: GreptimeQuery, scoped: ScopedVars): GreptimeQuery {
    let rawQuery = query.rawSql || '';
    rawQuery = this.applyConditionalAll(rawQuery, getTemplateSrv().getVariables());
    return {
      ...query,
      rawSql: this.replace(rawQuery, scoped) || '',
    };
  }

  applyConditionalAll(rawQuery: string, templateVars: TypedVariableModel[]): string {
    if (!rawQuery) {
      return rawQuery;
    }
    const macro = '$__conditionalAll(';
    let macroIndex = rawQuery.lastIndexOf(macro);

    while (macroIndex !== -1) {
      const params = this.getMacroArgs(rawQuery, macroIndex + macro.length - 1);
      if (params.length !== 2) {
        return rawQuery;
      }
      const templateVarParam = params[1].trim();
      const varRegex = new RegExp(/(?<=\$\{)[\w\d]+(?=\})|(?<=\$)[\w\d]+/);
      const templateVar = varRegex.exec(templateVarParam);
      let phrase = params[0];
      if (templateVar) {
        const key = templateVars.find((x) => x.name === templateVar[0]) as any;
        let value = key?.current.value.toString();
        if (value === '' || value === '$__all') {
          phrase = '1=1';
        }
      }
      rawQuery = rawQuery.replace(`${macro}${params[0]},${params[1]})`, phrase);
      macroIndex = rawQuery.lastIndexOf(macro);
    }
    return rawQuery;
  }

  // Support filtering by field value in Explore
  modifyQuery(query: GreptimeQuery, action: QueryFixAction): GreptimeQuery {
    if (query.editorType !== EditorType.Builder || !action.options || !action.options.key || !action.options.value) {
      return query;
    }

    const columnName = action.options.key;
    const actionFrame: DataFrame | undefined = (action as any).frame;
    const actionValue = action.options.value;

    // Find selected column by alias/name
    const lookupByAlias = query.builderOptions.columns?.find(c => c.alias === columnName); // Check all aliases first,
    const lookupByName = query.builderOptions.columns?.find(c => c.name === columnName);   // then try matching column name
    const lookupByLogsAlias = logAliasToColumnHints.has(columnName) ? getColumnByHint(query.builderOptions, logAliasToColumnHints.get(columnName)!) : undefined;
    const lookupByLogLabels = dataFrameHasLogLabelWithName(actionFrame, columnName) && getColumnByHint(query.builderOptions, ColumnHint.LogLabels);
    const column = lookupByAlias || lookupByName || lookupByLogsAlias || lookupByLogLabels;
    
    let nextFilters: Filter[] = (query.builderOptions.filters?.slice() || []);
    if (action.type === 'ADD_FILTER') {
      // we need to remove *any other EQ or NE* for the same field,
      // because we don't want to end up with two filters like `level=info` AND `level=error`
      nextFilters = nextFilters.filter(f =>
        !(
          f.type === 'string' &&
          ((column && column.hint && f.hint) ? f.hint === column.hint : f.key === columnName) &&
          (f.operator === FilterOperator.IsAnything || f.operator === FilterOperator.Equals || f.operator === FilterOperator.NotEquals)
        ) &&
        !(
          f.type.toLowerCase().startsWith('map') &&
          (column && lookupByLogLabels && f.mapKey === columnName) &&
          (f.operator === FilterOperator.IsAnything || f.operator === FilterOperator.Equals || f.operator === FilterOperator.NotEquals)
        )
      );

      nextFilters.push({
        condition: 'AND',
        key: (column && column.hint) ? '' : columnName,
        hint: (column && column.hint) ? column.hint : undefined,
        mapKey: lookupByLogLabels ? columnName : undefined,
        type: lookupByLogLabels ? 'Map(String, String)' : 'string',
        filterType: 'custom',
        operator: FilterOperator.Equals,
        value: actionValue,
      });
    } else if (action.type === 'ADD_FILTER_OUT') {
      // with this we might want to add multiple values as NE filters
      // for example, `level != info` AND `level != debug`
      // thus, here we remove only exactly matching NE filters or an existing EQ filter for this field
      nextFilters = nextFilters.filter(f =>
        !(
          (f.type === 'string' &&
            ((column && column.hint && f.hint) ? f.hint === column.hint : f.key === columnName) &&
            'value' in f && f.value === actionValue &&
            (f.operator === FilterOperator.IsAnything || f.operator === FilterOperator.NotEquals)
          ) ||
          (
            f.type === 'string' &&
            ((column && column.hint && f.hint) ? f.hint === column.hint : f.key === columnName) &&
            (f.operator === FilterOperator.IsAnything || f.operator === FilterOperator.Equals)
          ) ||
          (
            f.type.toLowerCase().startsWith('map') &&
            (column && lookupByLogLabels && f.mapKey === columnName) &&
            (f.operator === FilterOperator.IsAnything || f.operator === FilterOperator.Equals)
          )
        )
      );

      nextFilters.push({
        condition: 'AND',
        key: (column && column.hint) ? '' : columnName,
        hint: (column && column.hint) ? column.hint : undefined,
        mapKey: lookupByLogLabels ? columnName : undefined,
        type: lookupByLogLabels ? 'Map(String, String)' : 'string',
        filterType: 'custom',
        operator: FilterOperator.NotEquals,
        value: actionValue,
      });
    }

    // the query is updated to trigger the URL update and propagation to the panels
    const nextOptions = { ...query.builderOptions, filters: nextFilters };
    return {
      ...query,
      rawSql: generateSql(nextOptions),
      builderOptions: nextOptions,
    };
  }

  private getMacroArgs(query: string, argsIndex: number): string[] {
    const args = [] as string[];
    const re = /\(|\)|,/g;
    let bracketCount = 0;
    let lastArgEndIndex = 1;
    let regExpArray: RegExpExecArray | null;
    const argsSubstr = query.substring(argsIndex, query.length);
    while ((regExpArray = re.exec(argsSubstr)) !== null) {
      const foundNode = regExpArray[0];
      if (foundNode === '(') {
        bracketCount++;
      } else if (foundNode === ')') {
        bracketCount--;
      }
      if (foundNode === ',' && bracketCount === 1) {
        args.push(argsSubstr.substring(lastArgEndIndex, re.lastIndex - 1));
        lastArgEndIndex = re.lastIndex;
      }
      if (bracketCount === 0) {
        args.push(argsSubstr.substring(lastArgEndIndex, re.lastIndex - 1));
        return args;
      }
    }
    return [];
  }

  private replace(value?: string, scopedVars?: ScopedVars) {
    if (value === undefined) {
      return value;
    }
    const effectiveScopedVars = filterEmptyScopedVars(scopedVars);
    return replacePreservingBackendMacros(value, (sql) =>
      getTemplateSrv().replace(sql, effectiveScopedVars, this.format)
    );
  }

  private format(value: any) {
    if (Array.isArray(value)) {
      return `'${value.join("','")}'`;
    }
    return value;
  }

  getDefaultDatabase(): string {
    return this.settings.jsonData.defaultDatabase || 'public';
  }

  getDefaultTable(): string | undefined {
    return this.settings.jsonData.defaultTable;
  }

  getDefaultLogsDatabase(): string | undefined {
    return this.settings.jsonData.logs?.defaultDatabase;
  }

  getDefaultLogsTable(): string | undefined {
    return this.settings.jsonData.logs?.defaultTable;
  }

  getDefaultLogsColumns(): Map<ColumnHint, string> {
    const result = new Map<ColumnHint, string>();
    const logsConfig = this.settings.jsonData.logs;
    if (!logsConfig) {
      return result;
    }

    const otelEnabled = logsConfig.otelEnabled;
    const otelVersion = logsConfig.otelVersion;

    const otelConfig = otel.getVersion(otelVersion);
    if (otelEnabled && otelConfig) {
      return otelConfig.logColumnMap;
    }

    logsConfig.timeColumn && result.set(ColumnHint.Time, logsConfig.timeColumn);
    logsConfig.levelColumn && result.set(ColumnHint.LogLevel, logsConfig.levelColumn);
    logsConfig.messageColumn && result.set(ColumnHint.LogMessage, logsConfig.messageColumn);
    result.set(ColumnHint.TraceId, logsConfig.traceIdColumn || 'trace_id');

    return result;
  }

  getLogsTraceIdColumn(): string {
    return this.getDefaultLogsColumns().get(ColumnHint.TraceId) || this.settings.jsonData.logs?.traceIdColumn || 'trace_id';
  }

  shouldSelectLogContextColumns(): boolean {
    return this.settings.jsonData.logs?.selectContextColumns || false;
  }

  getLogContextColumnNames(): string[] {
    return this.settings.jsonData.logs?.contextColumns || [];
  }

  /**
   * Get configured OTEL version for logs. Returns undefined when versioning is disabled/unset.
   */
  getLogsOtelVersion(): string | undefined {
    const logConfig = this.settings.jsonData.logs;
    return logConfig?.otelEnabled ? (logConfig.otelVersion || undefined) : undefined;
  }

  getDefaultTraceDatabase(): string | undefined {
    return this.settings.jsonData.traces?.defaultDatabase;
  }

  getDefaultTraceTable(): string | undefined {
    return this.settings.jsonData.traces?.defaultTable;
  }

  getDefaultTraceColumns(): Map<ColumnHint, string> {
    const result = new Map<ColumnHint, string>();
    const traceConfig = this.settings.jsonData.traces;
    if (!traceConfig) {
      return result;
    }

    const otelEnabled = traceConfig.otelEnabled;
    const otelVersion = traceConfig.otelVersion;

    const otelConfig = otel.getVersion(otelVersion);
    if (otelEnabled && otelConfig) {
      return otelConfig.traceColumnMap;
    }

    traceConfig.traceIdColumn && result.set(ColumnHint.TraceId, traceConfig.traceIdColumn);
    traceConfig.spanIdColumn && result.set(ColumnHint.TraceSpanId, traceConfig.spanIdColumn);
    traceConfig.operationNameColumn && result.set(ColumnHint.TraceOperationName, traceConfig.operationNameColumn);
    traceConfig.parentSpanIdColumn && result.set(ColumnHint.TraceParentSpanId, traceConfig.parentSpanIdColumn);
    traceConfig.serviceNameColumn && result.set(ColumnHint.TraceServiceName, traceConfig.serviceNameColumn);
    traceConfig.durationColumn && result.set(ColumnHint.TraceDurationTime, traceConfig.durationColumn);
    traceConfig.startTimeColumn && result.set(ColumnHint.Time, traceConfig.startTimeColumn);
    traceConfig.tagsColumn && result.set(ColumnHint.TraceTags, traceConfig.tagsColumn);
    traceConfig.serviceTagsColumn && result.set(ColumnHint.TraceServiceTags, traceConfig.serviceTagsColumn);
    traceConfig.eventsColumnPrefix && result.set(ColumnHint.TraceEventsPrefix, traceConfig.eventsColumnPrefix);

    return result;
  }

  /**
   * Get configured OTEL version for traces. Returns undefined when versioning is disabled/unset.
   */
  getTraceOtelVersion(): string | undefined {
    const traceConfig = this.settings.jsonData.traces;
    return traceConfig?.otelEnabled ? (traceConfig.otelVersion || undefined) : undefined;
  }

  getDefaultTraceDurationUnit(): TimeUnit {
    return this.settings.jsonData.traces?.durationUnit as TimeUnit || TimeUnit.Nanoseconds;
  }

  async fetchDatabases(): Promise<string[]> {
    return this.fetchData('SHOW DATABASES');
  }

  async fetchTables(db?: string): Promise<string[]> {
    const rawSql = db ? `SHOW TABLES FROM "${db}"` : 'SHOW TABLES';
    return this.fetchData(rawSql);
  }

  /**
   * Used to populate suggestions in the filter editor for Map columns.
   * 
   * Samples rows to get a unique set of keys for the map.
   * May not include ALL keys for a given dataset.
   * 
   * TODO: This query can be slow/expensive
   */
  async fetchUniqueMapKeys(mapColumn: string, db: string, table: string): Promise<string[]> {
    const rawSql = `SELECT DISTINCT arrayJoin(${mapColumn}.keys) as keys FROM "${db}"."${table}" LIMIT 1000`;
    return this.fetchData(rawSql);
  }

  async fetchEntities() {
    return this.fetchTables();
  }

  async fetchFields(database: string, table: string): Promise<string[]> {
    return this.fetchData(`DESC TABLE "${database}"."${table}"`);
  }

  /**
   * Fetches JSON column suggestions for each specified JSON column.
   */
  async fetchPathsForJSONColumns(database: string | undefined, table: string, jsonColumnName: string): Promise<TableColumn[]> {
    const prefix = Boolean(database) ? `"${database}".` : '';
    const rawSql = `SELECT arrayJoin(distinctJSONPathsAndTypes(${jsonColumnName})) FROM ${prefix}"${table}" SETTINGS max_execution_time=10`;
    const frame = await this.runQuery({ rawSql });
    if (frame.fields?.length === 0) {
      return [];
    }

    const view = new DataFrameView(frame);
    const jsonPathsAndTypes: Array<[string, string]> = [];
    for (let x of view) {
      if (!x || !x[0]) {
        continue;
      }

      const kv = JSON.parse(x[0]);
      if (!kv.keys || !kv.values) {
        continue;
      }

      jsonPathsAndTypes.push([kv.keys, kv.values]);
    }

    const columns: TableColumn[] = [];
    for (let pathAndTypes of jsonPathsAndTypes) {
      const path = pathAndTypes[0];
      const types = pathAndTypes[1];
      if (!path || !types || types.length === 0) {
        continue;
      }

      columns.push({
        name: `${jsonColumnName}.${path}`,
        label: `${jsonColumnName}.${path}`,
        type: types[0],
        picklistValues: [],
      })
    }

    return columns;
  }
  
  /**
   * Fetches column suggestions from the table schema.
   */
  async fetchColumnsFromTable(database: string | undefined, table: string): Promise<TableColumn[]> {
    const prefix = Boolean(database) ? `"${database}".` : '';
    const rawSql = `DESC TABLE ${prefix}"${table}"`;
    const frame = await this.runQuery({ rawSql });
    if (frame.fields?.length === 0) {
      return [];
    }
    const view = new DataFrameView(frame);
    const columns: TableColumn[] = view.map(item => ({
      name: item[0],
      type: item[1],
      label: item[0],
      picklistValues: [],
    }));

    const results = await Promise.all(
      columns
        .filter(c => c.type.startsWith("JSON"))
        .map(c => this.fetchPathsForJSONColumns(database, table, c.name))
    );

    return [...columns, ...results.flat()];
  }

  /**
   * Fetches column suggestions from an alias definition table.
   */
  async fetchColumnsFromAliasTable(fullTableName: string): Promise<TableColumn[]> {
    const rawSql = `SELECT alias, select, "type" FROM ${fullTableName}`;
    const frame = await this.runQuery({ rawSql });
    if (frame.fields?.length === 0) {
      return [];
    }
    const view = new DataFrameView(frame);
    return view.map(item => ({
      name: item[1],
      type: item[2],
      label: item[0],
      picklistValues: [],
    }));
  }

  getAliasTable(targetDatabase: string | undefined, targetTable: string): string | null {
    const aliasEntries = this.settings?.jsonData?.aliasTables || [];
    const matchedEntry = aliasEntries.find(e => {
      const matchDatabase = !e.targetDatabase || (e.targetDatabase === targetDatabase);
      const matchTable = e.targetTable === targetTable;
      return matchDatabase && matchTable;
    }) || null;

    if (matchedEntry === null) {
      return null;
    }

    const aliasDatabase = matchedEntry.aliasDatabase || targetDatabase || null;
    const aliasTable = matchedEntry.aliasTable;
    const prefix = Boolean(aliasDatabase) ? `"${aliasDatabase}".` : '';
    return `${prefix}"${aliasTable}"`;
  }

  async fetchColumns(database: string | undefined, table: string): Promise<TableColumn[]> {
    const fullAliasTableName = this.getAliasTable(database, table);
    if (fullAliasTableName !== null) {
      return this.fetchColumnsFromAliasTable(fullAliasTableName);
    }

    return this.fetchColumnsFromTable(database, table);
  }

  private async fetchData(rawSql: string) {
    const frame = await this.runQuery({ rawSql });
    return this.values(frame);
  }

  private getTimezone(request: DataQueryRequest<GreptimeQuery>): string | undefined {
    // timezone specified in the time picker
    if (request.timezone && request.timezone !== 'browser') {
      return request.timezone;
    }
    // fall back to the local timezone
    const localTimezoneInfo = getTimeZoneInfo(getTimeZone(), Date.now());
    return localTimezoneInfo?.ianaName;
  }

  query(request: DataQueryRequest<GreptimeQuery>): Observable<DataQueryResponse> {
    this.lastTimeRange = request.range
      ? { from: request.range.from.valueOf().toString(), to: request.range.to.valueOf().toString() }
      : undefined;

    const templateSrv = getTemplateSrv() as any;
    // Grafana stores adhoc filters scoped by datasource identity.
    // Using uid is more stable than name (name can be empty/changed).
    const adHocFilters: AdHocVariableFilter[] = (() => {
      if (!templateSrv.getAdhocFilters) {
        return [];
      }

      // Different Grafana versions / call-sites key adhoc filters differently.
      // Try the most stable identifiers first.
      const keys: Array<string | undefined> = [
        this.settings?.uid,
        this.uid,
        this.settings?.name,
        (this as any).name,
        this.settings?.id ? String(this.settings.id) : undefined,
      ];

      for (const key of keys) {
        if (!key) {
          continue;
        }
        const filters = templateSrv.getAdhocFilters(key);
        if (filters && filters.length) {
          return filters;
        }
      }

      return [];
    })();

    const targets = request.targets
      // filters out queries disabled in UI
      .filter((t) => t.hide !== true)
      // attach timezone information and merge ad-hoc filters for builder queries
      .map((t) => {
        let next: GreptimeQuery = {
          ...t,
          meta: {
            ...t?.meta,
            timezone: this.getTimezone(request),
          },
        };

        const skipAdHocForTarget = Boolean((next as any)?.meta?.skipAdHocFilters);
        if (
          adHocFilters.length &&
          !this.skipAdHocFilter &&
          !skipAdHocForTarget &&
          next.editorType === EditorType.Builder &&
          next.builderOptions
        ) {
          const extraFilters = this.buildFiltersFromAdhoc(adHocFilters, next.builderOptions.table);
          if (extraFilters.length) {
            const mergedFilters = [
              ...(next.builderOptions.filters || []),
              ...extraFilters,
            ];
            const nextBuilderOptions: QueryBuilderOptions = {
              ...next.builderOptions,
              filters: mergedFilters,
            };
            next = {
              ...next,
              builderOptions: nextBuilderOptions,
              rawSql: generateSql(nextBuilderOptions),
            };
          }
        }

        return next;
      })
      .filter((t) => t.rawSql);

    return super
      .query({
        ...request,
        // adhoc merged above; dashboard vars via applyTemplateVariables inside super.query();
        // time macros ($__timeFilter, $__interval, …) expand in Go.
        targets,
      })
      .pipe(
        map((response) => this.postProcessBackendQueryResponse(response, request, targets)),
        catchError((error) => {
          console.error('Error executing backend query:', error);
          const errorFrame = new MutableDataFrame({
            fields: [{ name: 'Error', values: [`Failed to execute query: ${formatQueryError(error)}`] }],
            meta: { preferredVisualisationType: 'table' },
          });
          return of({ data: [errorFrame] });
        })
      );
  }

  private postProcessBackendQueryResponse(
    response: DataQueryResponse,
    request: DataQueryRequest<GreptimeQuery>,
    _targets: GreptimeQuery[]
  ): DataQueryResponse {
    // Multi-frame / logs / traces frames are shaped in Go (pkg/greptime.FormatFrames).
    // Frontend only attaches Explore data links between logs and traces.
    return transformQueryResponseWithTraceAndLogLinks(this, request, response);
  }

  private runQuery(request: Partial<GreptimeQuery>, options?: any): Promise<DataFrame> {
    return new Promise((resolve) => {
      // VariableSupport often passes `{ range: undefined }`. Do not treat a present
      // but empty options object as having a valid range — fall back to dashboard time.
      const range = options?.range ?? (getTemplateSrv() as any).timeRange;
      const scopedVars = options?.scopedVars;
      const req = {
        targets: [{ ...request, refId: String(Math.random()) }],
        range,
        scopedVars,
      } as DataQueryRequest<GreptimeQuery>;
      this.query(req).subscribe((res: DataQueryResponse) => {
        resolve(res.data[0] || { fields: [] });
      });
    });
  }

  private values(frame: DataFrame) {
    if (frame.fields?.length === 0) {
      return [];
    }
    return frame?.fields[0]?.values.map((text) => text);
  }

  async getTagKeys(): Promise<MetricFindValue[]> {
    if (this.adHocFiltersStatus === AdHocFilterStatus.disabled || this.adHocFiltersStatus === AdHocFilterStatus.none) {
      this.adHocFiltersStatus = await this.canUseAdhocFilters();
      if (this.adHocFiltersStatus === AdHocFilterStatus.disabled) {
        return {} as MetricFindValue[];
      }
    }
    const { type, frame } = await this.fetchTags();
    if (type === TagType.query) {
      return frame.fields.map((f) => ({ text: f.name }));
    }
    const view = new DataFrameView(frame);
    return view.map((item) => ({
      text: `${item[2]}.${item[0]}`,
    }));
  }

  async getTagValues({ key }: any): Promise<MetricFindValue[]> {
    const { type } = this.getTagSource();
    if (type === TagType.query) {
      return this.fetchTagValuesFromQuery(key);
    }
    return this.fetchTagValuesFromSchema(key);
  }

  private async fetchTagValuesFromSchema(key: string): Promise<MetricFindValue[]> {
    const parsed = tableAndColumnFromAdhocKey(key);
    if (!parsed) {
      return [];
    }
    const { table, col } = parsed;
    const { from } = this.getTagSource();
    let source: string;
    let db: string | undefined;
    if (from?.includes('.')) {
      [db] = from.split('.');
      source = `"${db}"."${table}"`;
    } else if (from) {
      db = from;
      source = `"${from}"."${table}"`;
    } else {
      db = this.getDefaultDatabase() || this.getDefaultLogsDatabase();
      source = db ? `"${db}"."${table}"` : `"${table}"`;
    }

    let rawSql: string;
    if (this.lastTimeRange && db) {
      const timeColName = await this.fetchTimeColumn(db, table);
      if (timeColName) {
        const fromISO = new Date(Number(this.lastTimeRange.from)).toISOString();
        const toISO = new Date(Number(this.lastTimeRange.to)).toISOString();
        rawSql = `SELECT DISTINCT "${col}" FROM ${source} WHERE "${timeColName}" >= '${fromISO}' AND "${timeColName}" <= '${toISO}' LIMIT 1000`;
      } else {
        rawSql = `SELECT DISTINCT "${col}" FROM ${source} LIMIT 1000`;
      }
    } else {
      rawSql = `SELECT DISTINCT "${col}" FROM ${source} LIMIT 1000`;
    }

    const frame = await this.runQuery({ rawSql, meta: { skipAdHocFilters: true } } as any);
    if (frame.fields?.length === 0) {
      return [];
    }
    const field = frame.fields[0];
    // Convert to string to avoid https://github.com/grafana/grafana/issues/12209
    return field.values
      .filter((value) => value !== null)
      .map((value) => {
        return { text: String(value) };
      });
  }

  private async fetchTimeColumn(db: string, table: string): Promise<string | undefined> {
    const sql = `SELECT column_name FROM INFORMATION_SCHEMA.COLUMNS WHERE table_schema = '${db}' AND table_name = '${table}' AND column_key = 'TIME INDEX' LIMIT 1`;
    try {
      const frame = await this.runQuery({ rawSql: sql, meta: { skipAdHocFilters: true } } as any);
      if (frame.fields?.length && frame.fields[0].values.length) {
        return String(frame.fields[0].values[0]);
      }
    } catch {
      // ignore errors
    }
    return undefined;
  }

  private async fetchTagValuesFromQuery(key: string): Promise<MetricFindValue[]> {
    const { frame } = await this.fetchTags();
    const field = frame.fields.find((f) => f.name === key);
    if (field) {
      // Convert to string to avoid https://github.com/grafana/grafana/issues/12209
      return field.values
        .filter((value) => value !== null)
        .map((value) => {
          return { text: String(value) };
        });
    }
    return [];
  }

  private async fetchTags(): Promise<Tags> {
    const tagSource = this.getTagSource();
    const adHocQueryMeta = { skipAdHocFilters: true };

    if (tagSource.source === undefined) {
      const rawSql =
        'SELECT column_name AS name, greptime_data_type AS type, table_name AS table FROM INFORMATION_SCHEMA.COLUMNS';
      const results = await this.runQuery({ rawSql, meta: adHocQueryMeta } as any);
      return { type: TagType.schema, frame: results };
    }

    const results = await this.runQuery({ rawSql: tagSource.source, meta: adHocQueryMeta } as any);
    return { type: tagSource.type, frame: results };
  }

  private getTagSource() {
    // @todo https://github.com/grafana/grafana/issues/13109
    // Prefer Greptime name; keep ClickHouse legacy variable for existing dashboards.
    const ADHOC_VARS = ['$greptime_adhoc_query', '$clickhouse_adhoc_query'];
    const unresolvedNames = new Set(ADHOC_VARS);
    const defaultDatabase = this.getDefaultDatabase();
    let source = '';
    let unresolved = true;
    for (const name of ADHOC_VARS) {
      const replaced = getTemplateSrv().replace(name);
      if (!unresolvedNames.has(replaced)) {
        source = replaced;
        unresolved = false;
        break;
      }
    }
    if (unresolved && isEmpty(defaultDatabase)) {
      return { type: TagType.schema, source: undefined };
    }
    if (unresolved) {
      source = defaultDatabase!;
    }
    if (source.toLowerCase().startsWith('select')) {
      return { type: TagType.query, source };
    }
    if (!source.includes('.')) {
      const sql = `SELECT column_name AS name, greptime_data_type AS type, table_name AS table FROM INFORMATION_SCHEMA.COLUMNS WHERE table_schema IN ('${source}')`;
      return { type: TagType.schema, source: sql, from: source };
    }
    const [db, table] = source.split('.');
    const sql = `SELECT column_name AS name, greptime_data_type AS type, table_name AS table FROM INFORMATION_SCHEMA.COLUMNS WHERE table_schema IN ('${db}') AND table_name = '${table}'`;
    return { type: TagType.schema, source: sql, from: source };
  }

  // Ad-hoc filters are always enabled for GreptimeDB.
  private async canUseAdhocFilters(): Promise<AdHocFilterStatus> {
    this.skipAdHocFilter = false;
    return Promise.resolve(AdHocFilterStatus.enabled);
  }

  // interface DataSourceWithLogsContextSupport
  getLogContextColumnsFromLogRow(row: LogRowModel): LogContextColumn[] {
    const contextColumnNames = this.getLogContextColumnNames();
    const contextColumns: LogContextColumn[] = [];

    for (let columnName of contextColumnNames) {
      const isMapKey = columnName.includes('[\'') && columnName.includes('\']');
      let mapName = '';
      let keyName = '';
      if (isMapKey) {
        mapName = columnName.substring(0, columnName.indexOf('['));
        keyName = columnName.substring(columnName.indexOf('[\'') + 2, columnName.lastIndexOf('\']'));
      }

      const field = row.dataFrame.fields.find(f => (
        // exact column name match
        f.name === columnName ||
        (isMapKey && (
          // entire map was selected
          f.name === mapName ||
           // single key was selected from map
          f.name === `arrayElement(${mapName}, '${keyName}')`
        ))
      ));

      let value: unknown;
      if (field) {
        value = field.values[row.rowIndex];
        if (value && field.type === 'other' && isMapKey) {
          value = (value as Record<string, unknown>)[keyName];
        }
      } else if (isMapKey) {
        continue;
       } else {
        // LogLines: Grafana dataplane only uses `labels` for extra metadata in the logs UI;
        // context columns may only exist on each row's labels object.
        const labelsField = row.dataFrame.fields.find(f => f.name === 'labels');
        if (labelsField) {
          const labelsRow = labelsField.values[row.rowIndex] as Record<string, unknown> | undefined;
          value = labelsRow?.[columnName];
        }
      }
      if (!field && (value === undefined || value === null)) {
        continue;
      }

      let contextColumnName: string;
      if (isMapKey) {
        contextColumnName = `${mapName}['${keyName}']`;
      } else {
        contextColumnName = columnName;
      }

      const normalizedValue =
        value === null || value === undefined ? null : String(value);
      contextColumns.push({
        name: contextColumnName,
        value: normalizedValue,
      });
    }

    return contextColumns;
  }


  /**
   * Runs a query based on a single log row and a direction (forward/backward)
   * 
   * Will remove all filters and ORDER BYs, and will re-add them based on the configured context columns.
   * Context columns are used to narrow down to a single logging unit as defined by your logging infrastructure.
   * Typically this will be a single service, or container/pod in docker/k8s.
   * 
   * If no context columns can be matched from the selected data frame, then the query is not run.
   */
  async getLogRowContext(row: LogRowModel, options?: LogRowContextOptions, query?: GreptimeQuery | undefined, cacheFilters?: boolean): Promise<DataQueryResponse> {
    if (!query) {
      throw new Error('Missing query for log context');
    } else if (!options || !options.direction || options.limit === undefined) {
      throw new Error('Missing log context options for query');
    } else if (query.editorType === EditorType.SQL || !query.builderOptions) {
      throw new Error('Log context feature only works for builder queries');
    }

    const contextQuery = cloneDeep(query);
    contextQuery.refId = '';
    contextQuery.meta = {
      ...(contextQuery.meta || {}),
      skipAdHocFilters: true,
    } as any;
    const builderOptions = contextQuery.builderOptions;
    builderOptions.limit = options.limit;
    builderOptions.meta = {
      ...(builderOptions.meta || {}),
      logMessageLike: '',
    };
    const range = (getTemplateSrv() as any).timeRange;
    const toTimeISO = range?.to.toISOString();
    const fromTimeISO = range?.from.toISOString();    

    if (!getColumnByHint(builderOptions, ColumnHint.Time)) {
      throw new Error('Missing time column for log context');
    }

    builderOptions.orderBy = [];
    builderOptions.orderBy.push({
      name: '',
      hint: ColumnHint.Time,
      dir: options.direction === LogRowContextQueryDirection.Forward ? OrderByDirection.ASC : OrderByDirection.DESC
    });

    builderOptions.filters = [];
    builderOptions.filters.push({
      operator: options.direction === LogRowContextQueryDirection.Forward ? FilterOperator.GreaterThanOrEqual : FilterOperator.LessThanOrEqual,
      filterType: 'custom',
      hint: ColumnHint.Time,
      key: '',
      value: new Date(Number(row.timeEpochNs) / 1000000).toISOString(),
      type: 'datetime',
      condition: 'AND'
    });

    if (fromTimeISO && toTimeISO) {
      builderOptions.filters.push({
        operator: options.direction === LogRowContextQueryDirection.Forward 
          ? FilterOperator.LessThanOrEqual   // Lower bound of newer logs ：time <= $__to
          : FilterOperator.GreaterThanOrEqual, // Upper bound of older logs ：time >= $__from
        filterType: 'custom',
        hint: ColumnHint.Time,
        key: '',
        value: options.direction === LogRowContextQueryDirection.Forward ? toTimeISO : fromTimeISO,
        type: 'datetime',
        condition: 'AND'
      });
    }

    const contextColumns = this.getLogContextColumnsFromLogRow(row);
    if (contextColumns.length < 1) {
      throw new Error('Unable to match any log context columns');
    }

    const contextColumnFilters: Filter[] = contextColumns
      .filter(c => c.value !== null && c.value !== undefined)
      .map(c => ({
        operator: FilterOperator.Equals,
        filterType: 'custom',
        key: c.name,
        value: c.value as string,
        type: 'string',
        condition: 'AND'
      }));
    builderOptions.filters.push(...contextColumnFilters);

    contextQuery.rawSql = generateSql(builderOptions);
    const req = {
      targets: [contextQuery],
      range,
    } as DataQueryRequest<GreptimeQuery>;

    // Do NOT toggle this.skipAdHocFilter here: concurrent dashboard/log queries on the same
    // datasource instance would skip ad hoc filters. Per-target meta.skipAdHocFilters is enough.
    return await firstValueFrom(this.query(req));
  }

  /**
   * Unused + deprecated but required by interface, log context button is always visible now
   * https://github.com/grafana/grafana/issues/66819
   */
  showContextToggle(row?: LogRowModel): boolean {
    return true;
  }
  
  /**
   * Returns a React component that is displayed in the top portion of the log context panel
   */
  getLogRowContextUi(row: LogRowModel, runContextQuery?: (() => void) | undefined, query?: GreptimeQuery | undefined): ReactNode {
    const contextColumns = this.getLogContextColumnsFromLogRow(row);
    return createReactElement(LogsContextPanel, { columns: contextColumns, datasourceUid: this.uid });
  }
}

enum TagType {
  query,
  schema,
}

enum AdHocFilterStatus {
  none = 0,
  enabled,
  disabled,
}

interface Tags {
  type?: TagType;
  frame: DataFrame;
}

export interface LogContextColumn {
  name: string;
  value: string | null;
}
