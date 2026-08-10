import { ColumnHint, TimeUnit } from "types/queryBuilder";

export const defaultLogsTable = '';
export const defaultTraceTable = '';

export const traceTimestampTableSuffix = '_trace_id_ts';

export interface OtelVersion {
  name: string;
  version: string;
  specUrl?: string;
  logsTable: string;
  logColumnMap: Map<ColumnHint, string>;
  logLevels: string[];
  traceTable: string;
  traceColumnMap: Map<ColumnHint, string>;
  traceDurationUnit: TimeUnit.Nanoseconds;
}

const otel129: OtelVersion = {
  name: '1.2.9',
  version: '1.29.0',
  specUrl: 'https://opentelemetry.io/docs/specs/otel',
  logsTable: defaultLogsTable,
  logColumnMap: new Map<ColumnHint, string>([
    [ColumnHint.Time, 'timestamp'],
    [ColumnHint.LogMessage, 'body'],
    [ColumnHint.LogLevel, 'severity_text'],
    [ColumnHint.LogLabels, 'log_attributes'],
    [ColumnHint.TraceId, 'trace_id'],
  ]),
  logLevels: [
    'TRACE',
    'DEBUG',
    'INFO',
    'WARN',
    'ERROR',
    'FATAL'
  ],
  traceTable: defaultTraceTable,
  traceColumnMap: new Map<ColumnHint, string>([
    [ColumnHint.Time, 'timestamp'],
    [ColumnHint.TraceId, 'trace_id'],
    [ColumnHint.TraceSpanId, 'span_id'],
    [ColumnHint.TraceParentSpanId, 'parent_span_id'],
    [ColumnHint.TraceServiceName, 'service_name'],
    [ColumnHint.TraceOperationName, 'span_name'],
    [ColumnHint.TraceDurationTime, 'duration_nano'],
    [ColumnHint.TraceTags, 'span_attributes'],
    [ColumnHint.TraceServiceTags, 'resource_attributes'],
    [ColumnHint.TraceStatusCode, 'span_status_code'],
    [ColumnHint.TraceEventsPrefix, 'span_events'],
  ]),
  traceDurationUnit: TimeUnit.Nanoseconds,
};

export const versions: readonly OtelVersion[] = [
  // When selected, will always keep OTEL config up to date as new versions are added
  { ...otel129, name: `latest (${otel129.name})`, version: 'latest' },
  otel129,
];

export const getLatestVersion = (): OtelVersion => versions[0];
export const getVersion = (version: string | undefined): OtelVersion | undefined => {
  if (!version) {
    return;
  }

  return versions.find(v => v.version === version);
};

export default {
  traceTimestampTableSuffix,
  versions,
  getLatestVersion,
  getVersion
};
