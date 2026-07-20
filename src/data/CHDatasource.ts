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
import { CHConfig } from 'types/config';
import { EditorType, CHQuery } from 'types/sql';
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
import { AdHocFilter, AdHocVariableFilter } from './adHocFilter';
import { CHVariableSupport } from './CHVariableSupport';
import { cloneDeep, isEmpty, isString } from 'lodash';
import {
  DEFAULT_LOGS_ALIAS,
  getIntervalInfo,
  expandGreptimeIntervalMacros,
  resolveGreptimePanelInterval,
  getTimeFieldRoundingClause,
  LOG_LEVEL_TO_IN_CLAUSE,
  queryLogsVolume,
  TIME_FIELD_ALIAS,
} from './logs';
import { generateSql, getColumnByHint, logAliasToColumnHints } from './sqlGenerator';
import otel from 'otel';
import { createElement as createReactElement, ReactNode } from 'react';
import { dataFrameHasLogLabelWithName, transformQueryResponseWithTraceAndLogLinks } from './utils';
import { pluginVersion } from 'utils/version';
import LogsContextPanel from 'components/LogsContextPanel';
import { transformDataFrameToLogs, transformDataFrameToTraceDetails } from '../greptimedb';
import { framesToMultiFrameTimeSeries } from '../greptimedb/longToMultiFrame';

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
  extends DataSourceWithBackend<CHQuery, CHConfig>
  implements DataSourceWithSupplementaryQueriesSupport<CHQuery>,
  DataSourceWithLogsContextSupport<CHQuery>
{
  // This enables default annotation support for 7.2+
  annotations = {};
  settings: DataSourceInstanceSettings<CHConfig>;
  adHocFilter: AdHocFilter;
  skipAdHocFilter = false; // don't apply adhoc filters to the query
  adHocFiltersStatus = AdHocFilterStatus.none; // ad hoc filters only work with CH 22.7+
  adHocCHVerReq = { major: 22, minor: 7 };

  constructor(instanceSettings: DataSourceInstanceSettings<CHConfig>) {
    super(instanceSettings);
    this.settings = instanceSettings;
    this.adHocFilter = new AdHocFilter();
    this.variables = new CHVariableSupport(this);
  }
  
  private buildFiltersFromAdhoc(adHocFilters: AdHocVariableFilter[]): Filter[] {
    const result: Filter[] = [];

    for (const f of adHocFilters) {
      if (!f || !f.key || !f.operator || f.value === undefined || f.value === null) {
        continue;
      }

      const key = f.key.includes('.') ? f.key.split('.')[1] : f.key;
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
    request: DataQueryRequest<CHQuery>
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

        const targets: CHQuery[] = [];
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

  getSupplementaryLogsVolumeQuery(logsVolumeRequest: DataQueryRequest<CHQuery>, query: CHQuery): CHQuery | undefined {
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
    if (timeColumn === undefined) {
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

  getSupplementaryQuery(options: SupplementaryQueryOptions, originalQuery: CHQuery): CHQuery | undefined {
    return undefined;
  }

  async metricFindQuery(query: CHQuery | string, options: any) {
    if (this.adHocFiltersStatus === AdHocFilterStatus.none) {
      this.adHocFiltersStatus = await this.canUseAdhocFilters();
    }
    const chQuery = isString(query) ? { rawSql: query, editorType: EditorType.SQL } : query;

    if (!(chQuery.editorType === EditorType.SQL || chQuery.editorType === EditorType.Builder || !chQuery.editorType)) {
      return [];
    }

    if (!chQuery.rawSql) {
      return [];
    }
    const frame = await this.runQuery(chQuery, options);
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

  applyTemplateVariables(query: CHQuery, scoped: ScopedVars): CHQuery {
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
  modifyQuery(query: CHQuery, action: QueryFixAction): CHQuery {
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
    if (value !== undefined) {
      return getTemplateSrv().replace(value, scopedVars, this.format);
    }
    return value;
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

  private getTimezone(request: DataQueryRequest<CHQuery>): string | undefined {
    // timezone specified in the time picker
    if (request.timezone && request.timezone !== 'browser') {
      return request.timezone;
    }
    // fall back to the local timezone
    const localTimezoneInfo = getTimeZoneInfo(getTimeZone(), Date.now());
    return localTimezoneInfo?.ianaName;
  }

  query(request: DataQueryRequest<CHQuery>): Observable<DataQueryResponse> {
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
        let next: CHQuery = {
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
          const extraFilters = this.buildFiltersFromAdhoc(adHocFilters);
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
        } else if (
          adHocFilters.length &&
          !this.skipAdHocFilter &&
          !skipAdHocForTarget &&
          next.rawSql
        ) {
          const whereParts = adHocFilters
            .filter((f) => f.key && f.operator && f.value !== undefined && f.value !== null)
            .map((f, i) => {
              const col = f.key.includes('.') ? `"${f.key.split('.')[1]}"` : `"${f.key}"`;
              const connector = i === 0 ? '' : ` ${f.condition || 'AND'} `;

              const isNullLiteral = typeof f.value === 'string' && f.value.trim().toLowerCase() === 'null';
              if (f.operator === '=' && isNullLiteral) {
                return `${connector}${col} IS NULL`;
              }
              if (f.operator === '!=' && isNullLiteral) {
                return `${connector}${col} IS NOT NULL`;
              }

              if (f.operator === '=~') {
                const escapedVal = String(f.value).replace(/'/g, "''");
                return `${connector}${col} LIKE '${escapedVal}'`;
              }
              if (f.operator === '!~') {
                const escapedVal = String(f.value).replace(/'/g, "''");
                return `${connector}${col} NOT LIKE '${escapedVal}'`;
              }
              if (f.operator === 'IN') {
                const parts = String(f.value)
                  .replace(/^\(|\)$/g, '')
                  .split(',')
                  .map((s) => `'${s.trim().replace(/'/g, "''")}'`)
                  .filter((s) => s.length > 2)
                  .join(',');
                if (!parts) {
                  return '';
                }
                return `${connector}${col} IN (${parts})`;
              }

              const escapedVal = String(f.value).replace(/'/g, "''");
              return `${connector}${col} ${f.operator} '${escapedVal}'`;
            })
            .filter((s) => s.length > 0);

          if (whereParts.length) {
            next.rawSql = this.injectAdHocWhere(next.rawSql, whereParts.join(''));
          }
        }

        return next;
      })
      .filter((t) => t.rawSql);
    const range = request.range

    const getInterpolatedSql = (rawSql: string): string => {
      const fromTimeISO = range?.from.toISOString();
      const toTimeISO = range?.to.toISOString();
      const rangeMs = range ? range.to.valueOf() - range.from.valueOf() : undefined;

      // Resolve panel interval from Grafana's request (not logs-style 1s/1m/1h snap).
      // Expand BEFORE templateSrv so `$__interval` inside date_bin() is not left to
      // a mismatched Grafana variable replacement.
      const scopedInterval =
        typeof request.scopedVars?.__interval?.value === 'string'
          ? request.scopedVars.__interval.value
          : undefined;
      const scopedIntervalMs =
        typeof request.scopedVars?.__interval_ms?.value === 'number'
          ? request.scopedVars.__interval_ms.value
          : undefined;
      const resolvedInterval = resolveGreptimePanelInterval({
        interval: request.interval || scopedInterval,
        intervalMs: request.intervalMs ?? scopedIntervalMs,
        rangeMs,
        maxDataPoints: request.maxDataPoints,
      });

      let interpolated = expandGreptimeIntervalMacros(rawSql, resolvedInterval);

      // Dashboard template variables (not $__interval — already expanded above)
      interpolated = getTemplateSrv().replace(interpolated, request.scopedVars);

      // Expand custom time macros
      if (fromTimeISO && toTimeISO) {
        interpolated = interpolated.replace(/\$__fromTime/g, `'${fromTimeISO}'`);
        interpolated = interpolated.replace(/\$__toTime/g, `'${toTimeISO}'`);

        interpolated = interpolated.replace(/\$__timeFilter\(([^)]+)\)/g, (_match, col) => {
          const column = String(col).trim();
          return `${column} >= '${fromTimeISO}' AND ${column} <= '${toTimeISO}'`;
        });
      }

      return interpolated;
    };

    const interpolatedTargets = targets.map((target) => ({
      ...target,
      rawSql: getInterpolatedSql(target.rawSql),
    }));

    return super
      .query({
        ...request,
        targets: interpolatedTargets,
      })
      .pipe(
        map((response) => this.postProcessBackendQueryResponse(response, request, interpolatedTargets)),
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
    request: DataQueryRequest<CHQuery>,
    targets: CHQuery[]
  ): DataQueryResponse {
    const targetByRefId = new Map(targets.map((t) => [t.refId, t]));
    const processedFrames: DataFrame[] = [];

    for (const frame of response.data) {
      const target = targetByRefId.get(frame.refId || '') ?? targets[0];
      processedFrames.push(...this.transformBackendFrame(frame, target));
    }

    return transformQueryResponseWithTraceAndLogLinks(this, request, { data: processedFrames });
  }

  private transformBackendFrame(frame: DataFrame, target: CHQuery): DataFrame[] {
    if (frame.fields?.some((f) => f.name === 'Error')) {
      return [frame];
    }

    const editorType = target.editorType;
    const builderOptions: QueryBuilderOptions =
      editorType === EditorType.SQL
        ? (target.meta?.builderOptions as QueryBuilderOptions) || ({} as QueryBuilderOptions)
        : target.builderOptions || ({} as QueryBuilderOptions);
    const queryType = target.refId === 'Trace ID' ? 'Trace' : builderOptions.queryType || target.queryType;

    if (queryType === QueryType.Logs) {
      const logFrame = transformDataFrameToLogs(frame, target, this.getLogContextColumnNames());
      return logFrame ? [logFrame] : [];
    }

    if (queryType === 'Trace') {
      return transformDataFrameToTraceDetails(frame, builderOptions as QueryBuilderOptions);
    }

    if (queryType === QueryType.TimeSeries) {
      return framesToMultiFrameTimeSeries([frame]);
    }

    return [frame];
  }

  private runQuery(request: Partial<CHQuery>, options?: any): Promise<DataFrame> {
    return new Promise((resolve) => {
      // VariableSupport often passes `{ range: undefined }`. Do not treat a present
      // but empty options object as having a valid range — fall back to dashboard time.
      const range = options?.range ?? (getTemplateSrv() as any).timeRange;
      const req = {
        targets: [{ ...request, refId: String(Math.random()) }],
        range,
      } as DataQueryRequest<CHQuery>;
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
    const { from } = this.getTagSource();
    const [table, col] = key.split('.');
    // Guard against invalid or undefined column names which can generate invalid SQL like
    // `select distinct undefined from host limit 1000`
    if (!table || !col || col === 'undefined') {
      return [];
    }
    const source = from?.includes('.') ? `${from.split('.')[0]}.${table}` : table;
    const rawSql = `select distinct ${col} from ${source} limit 1000`;
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

    if (tagSource.type === TagType.query) {
      this.adHocFilter.setTargetTableFromQuery(tagSource.source);
    }

    const results = await this.runQuery({ rawSql: tagSource.source, meta: adHocQueryMeta } as any);
    return { type: tagSource.type, frame: results };
  }

  private getTagSource() {
    // @todo https://github.com/grafana/grafana/issues/13109
    const ADHOC_VAR = '$clickhouse_adhoc_query';
    const defaultDatabase = this.getDefaultDatabase();
    let source = getTemplateSrv().replace(ADHOC_VAR);
    if (source === ADHOC_VAR && isEmpty(defaultDatabase)) {
      return { type: TagType.schema, source: undefined };
    }
    source = source === ADHOC_VAR ? defaultDatabase! : source;
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

  // Returns true if ClickHouse's version is greater than or equal to 22.7
  // 22.7 added 'settings additional_table_filters' which is used for ad hoc filters
  private async canUseAdhocFilters(): Promise<AdHocFilterStatus> {
    this.skipAdHocFilter = false;
    return Promise.resolve(AdHocFilterStatus.enabled);
    // const data = await this.fetchData(`SELECT version()`);
    // try {
    //   const verString = (data[0] as unknown as string).split('.');
    //   const ver = { major: Number.parseInt(verString[0], 10), minor: Number.parseInt(verString[1], 10) };
    //   return ver.major > this.adHocCHVerReq.major ||
    //     (ver.major === this.adHocCHVerReq.major && ver.minor >= this.adHocCHVerReq.minor)
    //     ? AdHocFilterStatus.enabled
    //     : AdHocFilterStatus.disabled;
    // } catch (err) {
    //   console.error(`Unable to parse ClickHouse version: ${err}`);
    //   throw err;
    // }
  }

  private injectAdHocWhere(sql: string, conditions: string): string {
    sql = sql.replace(/;\s*$/, '');

    const TRAILING_CLAUSES = ['GROUP BY', 'ORDER BY', 'LIMIT', 'OFFSET', 'HAVING',
      'UNION ALL', 'UNION', 'EXCEPT', 'INTERSECT', 'SETTINGS'];

    let depth = 0;
    let lastWhereEnd = -1;
    let firstTrailingIdx = -1;
    let i = 0;

    while (i < sql.length) {
      const ch = sql[i];

      if (ch === "'" || ch === '"' || ch === '`') {
        const quote = ch;
        i++;
        while (i < sql.length) {
          if (sql[i] === '\\') { i += 2; continue; }
          if (sql[i] === quote) { i++; break; }
          i++;
        }
        continue;
      }

      if (ch === '-' && sql[i + 1] === '-') {
        const nl = sql.indexOf('\n', i);
        i = nl > -1 ? nl + 1 : sql.length;
        continue;
      }

      if (ch === '/' && sql[i + 1] === '*') {
        const end = sql.indexOf('*/', i + 2);
        i = end > -1 ? end + 2 : sql.length;
        continue;
      }

      if (ch === '(') { depth++; i++; continue; }
      if (ch === ')') { depth--; i++; continue; }

      if (depth === 0) {
        const rest = sql.substring(i).toUpperCase();

        if (rest.startsWith('WHERE ') || rest.startsWith('WHERE\t') || rest.startsWith('WHERE\n')
            || rest === 'WHERE') {
          lastWhereEnd = i + 5;
          i += 5;
          continue;
        }

        for (const clause of TRAILING_CLAUSES) {
          if (rest.startsWith(clause + ' ') || rest.startsWith(clause + '\t')
              || rest.startsWith(clause + '\n') || rest === clause) {
            if (firstTrailingIdx === -1) {
              firstTrailingIdx = i;
            }
            i += clause.length - 1;
            break;
          }
        }
      }

      i++;
    }

    if (lastWhereEnd > -1) {
      const before = sql.substring(0, lastWhereEnd);
      const after = sql.substring(lastWhereEnd).replace(/^\s+/, '');
      return `${before} (${conditions}) AND ${after}`;
    }

    if (firstTrailingIdx > -1) {
      return `${sql.substring(0, firstTrailingIdx)} WHERE ${conditions} ${sql.substring(firstTrailingIdx)}`;
    }

    return `${sql} WHERE ${conditions}`;
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
  async getLogRowContext(row: LogRowModel, options?: LogRowContextOptions, query?: CHQuery | undefined, cacheFilters?: boolean): Promise<DataQueryResponse> {
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
    } as DataQueryRequest<CHQuery>;

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
  getLogRowContextUi(row: LogRowModel, runContextQuery?: (() => void) | undefined, query?: CHQuery | undefined): ReactNode {
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
