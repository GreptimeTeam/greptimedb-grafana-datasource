import {
  DataFrame,
  Field,
  FieldType,
  createDataFrame,
  DataFrameType,
} from '@grafana/data';

import { GreptimeDataTypes, GreptimeResponse } from './types';
import { getColumnsByHint, logColumnHintsToAlias } from 'data/sqlGenerator';
import { ColumnHint, QueryBuilderOptions } from 'types/queryBuilder';
import { CHQuery } from 'types/sql';

/**
 * Maps GreptimeDB data type strings to Grafana FieldType enums.
 */
function mapGreptimeTypeToGrafana(greptimeType: string | undefined | null): FieldType {
  if (!greptimeType) {
    return FieldType.other;
  }
  const lowerType = greptimeType.toLowerCase();

  if (lowerType.includes('timestamp')) {
    return FieldType.time;
  }
  if (lowerType.includes('int') || lowerType.includes('float') || lowerType.includes('double') || lowerType.includes('decimal') || lowerType.includes('numeric')) {
    return FieldType.number;
  }
  if (lowerType.includes('bool')) {
    return FieldType.boolean;
  }
  if (lowerType.includes('string') || lowerType.includes('varchar') || lowerType.includes('text')) {
    return FieldType.string;
  }
  if (lowerType.includes('date')) {
    return FieldType.time;
  }
  if (lowerType.includes('interval')) {
    return FieldType.string;
  }

  console.warn(`Unhandled GreptimeDB type: "${greptimeType}", mapping to FieldType.other.`);
  return FieldType.other;
}

export const greptimeTypeToGrafana: Record<GreptimeDataTypes, FieldType> = {
  [GreptimeDataTypes.Null]: FieldType.other,

  // Numeric types:
  [GreptimeDataTypes.Boolean]: FieldType.boolean,
  [GreptimeDataTypes.UInt8]: FieldType.number,
  [GreptimeDataTypes.UInt16]: FieldType.number,
  [GreptimeDataTypes.UInt32]: FieldType.number,
  [GreptimeDataTypes.UInt64]: FieldType.number,
  [GreptimeDataTypes.Int8]: FieldType.number,
  [GreptimeDataTypes.Int16]: FieldType.number,
  [GreptimeDataTypes.Int32]: FieldType.number,
  [GreptimeDataTypes.Int64]: FieldType.number,
  [GreptimeDataTypes.Float32]: FieldType.number,
  [GreptimeDataTypes.Float64]: FieldType.number,

  // String types:
  [GreptimeDataTypes.String]: FieldType.string,
  [GreptimeDataTypes.Binary]: FieldType.string,

  // Date & Time types:
  [GreptimeDataTypes.Date]: FieldType.time,
  [GreptimeDataTypes.DateTime]: FieldType.time,

  [GreptimeDataTypes.TimestampSecond]: FieldType.time,
  [GreptimeDataTypes.TimestampMillisecond]: FieldType.time,
  [GreptimeDataTypes.TimestampMicrosecond]: FieldType.time,
  [GreptimeDataTypes.TimestampNanosecond]: FieldType.time,

  [GreptimeDataTypes.List]: FieldType.other,
};


type GreptimeTimeType = GreptimeDataTypes.Date | GreptimeDataTypes.TimestampSecond | GreptimeDataTypes.TimestampMillisecond | GreptimeDataTypes.TimestampMicrosecond | GreptimeDataTypes.TimestampNanosecond
export function toMs(time: number, columnType: GreptimeTimeType) {
  switch (columnType) {
    case GreptimeDataTypes.Date:
      return time * 86400000
    case GreptimeDataTypes.TimestampSecond:
      return time * 1000
    case GreptimeDataTypes.TimestampMillisecond:
      return time
    case GreptimeDataTypes.TimestampMicrosecond:
      return time / 1000
    case GreptimeDataTypes.TimestampNanosecond:
      return time / 1000000
    default:  // Handle unexpected types
      console.warn(`Unexpected column type: ${columnType}. Defaulting to milliseconds.`);
      return time; // Default to milliseconds
  }
}


export function transformGreptimeDBLogs(sqlResponse: GreptimeResponse, query: CHQuery, contextColumns: string[]) {
  if (!sqlResponse.output || sqlResponse.output.length === 0) {
    console.error('GreptimeDB query failed or returned no data:', sqlResponse.error);
    return null; // Or handle the error as needed
  }

  const records = sqlResponse.output[0]?.records;
  if (!records || !records.schema || !records.rows) {
    console.error('Invalid GreptimeDB records format:', records);
    return null;
  }

  const columnSchemas = records.schema.column_schemas;
  const rows = records.rows;

  let timestampColumnIndex = -1;
  let bodyColumnIndex = -1;
  let severityColumnIndex = -1;
  let idColumnIndex = -1;
  const labelColumnIndices: Record<string, number> = {};
  const contextColumnIndices: Record<string, number> = {};

  
  if('builderOptions' in query) {

    columnSchemas.forEach((schema, index) => {
      const lowerCaseName = schema.name.toLowerCase();
      if (lowerCaseName === logColumnHintsToAlias.get(ColumnHint.Time)) {
        timestampColumnIndex = index;
      } else if (lowerCaseName === logColumnHintsToAlias.get(ColumnHint.LogMessage)) {
        bodyColumnIndex = index;
      } else if (lowerCaseName === logColumnHintsToAlias.get(ColumnHint.LogLevel)) {
        severityColumnIndex = index;
      } else if (contextColumns.includes(schema.name)) {
        contextColumnIndices[schema.name] = index;
      } else {
        // Consider other columns as potential labels
        labelColumnIndices[schema.name] = index;
      }
    });
  }

  const timestamps: number[] = [];
  const bodies: string[] = [];
  const severities: string[] = [];
  const ids: string[] = [];
  const labelsArray: Array<Record<string, any>> = [];
  const contextColumnValues: Record<string, string[]> = {};
  rows.forEach((row) => {
    const timestampValue = toMs(row[timestampColumnIndex], columnSchemas[timestampColumnIndex].data_type as GreptimeTimeType);

    timestamps.push(
      typeof timestampValue === 'string' || typeof timestampValue === 'number'
        ? new Date(timestampValue).getTime()
        : timestampValue
    );
    if (bodyColumnIndex !== -1) {
      bodies.push(String(row[bodyColumnIndex]));
    }
    if (severityColumnIndex !== -1) {
      severities.push(String(row[severityColumnIndex]));
    }


    const labels: Record<string, any> = {};
    for (const labelName in labelColumnIndices) {
      if (Object.prototype.hasOwnProperty.call(labelColumnIndices, labelName)) {
        labels[labelName] = row[labelColumnIndices[labelName]];
      }
    }
    // Per Grafana dataplane LogLines: extra top-level fields are ignored by the logs UI.
    // Put context columns into `labels` so they appear in single-line log details (Fields/Labels).
    for (const contextName in contextColumnIndices) {
      if (!contextColumnValues[contextName]) {
        contextColumnValues[contextName] = [];
      }
      const contextValue = row[contextColumnIndices[contextName]];
      contextColumnValues[contextName].push(contextValue);
      labels[contextName] = contextValue;
    }
    labelsArray.push(labels);

  });

  const fields = [
    { name: 'timestamp', type: FieldType.time, values: timestamps },
    { name: 'body', type: FieldType.string, values: bodies },
  ] as any;

  if (severityColumnIndex !== -1) {
    fields.push({ name: 'severity', type: FieldType.string, values: severities });
  }

  if (idColumnIndex !== -1) {
    fields.push({ name: 'id', type: FieldType.string, values: ids });
  }

  for (const contextName in contextColumnValues) {
    fields.push({ name: contextName, type: FieldType.string, values: contextColumnValues[contextName] });
  }

  fields.push({ name: 'labels', type: FieldType.other, values: labelsArray });

  const result = createDataFrame({
    refId: query.refId,
    fields: fields,
    meta: {
      preferredVisualisationType: 'logs',
      type: DataFrameType.LogLines,
    },
  });

  return result;
}

function getFieldValues(field: Field, rowCount: number): any[] {
  const values = field.values as any;
  if (values == null) {
    return [];
  }
  if (typeof values.toArray === 'function') {
    return values.toArray();
  }
  if (typeof values.get === 'function') {
    return Array.from({ length: rowCount }, (_, i) => values.get(i));
  }
  return Array.from(values);
}

/** Converts a long backend DataFrame (M1 Go path) into a LogLines frame. */
export function transformDataFrameToLogs(frame: DataFrame, query: CHQuery, contextColumns: string[]): DataFrame | null {
  if (!frame?.fields?.length || !frame.length) {
    return null;
  }

  const fieldByName = new Map(frame.fields.map((f) => [f.name.toLowerCase(), f]));
  const timeAlias = logColumnHintsToAlias.get(ColumnHint.Time)?.toLowerCase();
  const bodyAlias = logColumnHintsToAlias.get(ColumnHint.LogMessage)?.toLowerCase();
  const levelAlias = logColumnHintsToAlias.get(ColumnHint.LogLevel)?.toLowerCase();

  const timestampField = timeAlias ? fieldByName.get(timeAlias) : undefined;
  const bodyField = bodyAlias ? fieldByName.get(bodyAlias) : undefined;
  const severityField = levelAlias ? fieldByName.get(levelAlias) : undefined;

  const timestamps: number[] = [];
  const bodies: string[] = [];
  const severities: string[] = [];
  const labelsArray: Array<Record<string, any>> = [];
  const contextColumnValues: Record<string, string[]> = {};

  const labelFields = frame.fields.filter((f) => {
    const lower = f.name.toLowerCase();
    if (lower === timeAlias || lower === bodyAlias || lower === levelAlias) {
      return false;
    }
    if (contextColumns.includes(f.name)) {
      return false;
    }
    return f.type === FieldType.string;
  });

  const contextFields = frame.fields.filter((f) => contextColumns.includes(f.name));

  for (let row = 0; row < frame.length; row++) {
    const tsVal = timestampField ? getFieldValues(timestampField, frame.length)[row] : undefined;
    timestamps.push(typeof tsVal === 'number' ? tsVal : new Date(tsVal).getTime());

    if (bodyField) {
      bodies.push(String(getFieldValues(bodyField, frame.length)[row] ?? ''));
    }
    if (severityField) {
      severities.push(String(getFieldValues(severityField, frame.length)[row] ?? ''));
    }

    const labels: Record<string, any> = {};
    for (const lf of labelFields) {
      labels[lf.name] = getFieldValues(lf, frame.length)[row];
    }
    for (const cf of contextFields) {
      if (!contextColumnValues[cf.name]) {
        contextColumnValues[cf.name] = [];
      }
      const contextValue = getFieldValues(cf, frame.length)[row];
      contextColumnValues[cf.name].push(String(contextValue ?? ''));
      labels[cf.name] = contextValue;
    }
    labelsArray.push(labels);
  }

  const fields = [
    { name: 'timestamp', type: FieldType.time, values: timestamps },
    { name: 'body', type: FieldType.string, values: bodies },
  ] as any;

  if (severityField) {
    fields.push({ name: 'severity', type: FieldType.string, values: severities });
  }

  for (const contextName in contextColumnValues) {
    fields.push({ name: contextName, type: FieldType.string, values: contextColumnValues[contextName] });
  }

  fields.push({ name: 'labels', type: FieldType.other, values: labelsArray });

  return createDataFrame({
    refId: frame.refId,
    fields,
    meta: {
      preferredVisualisationType: 'logs',
      type: DataFrameType.LogLines,
    },
  });
}

/** Converts a long backend DataFrame (M1 Go path) into trace detail frames. */
export function transformDataFrameToTraceDetails(frame: DataFrame, builderOptions: QueryBuilderOptions): DataFrame[] {
  if (!frame?.fields?.length || !frame.length) {
    return [];
  }

  const columns = builderOptions.columns || [];
  const tagColumnNames = getColumnsByHint(builderOptions, ColumnHint.TraceTags)?.map((v) => v.name) || [];
  const serviceTagColumnNames = getColumnsByHint(builderOptions, ColumnHint.TraceServiceTags)?.map((v) => v.name) || [];

  const fieldMap = new Map(frame.fields.map((f) => [f.name, f]));
  const rowCount = frame.length;

  const spans: GrafanaTraceSpan[] = [];
  for (let row = 0; row < rowCount; row++) {
    const data: Record<string, any> = { span_attributes: [], service_attributes: [] };

    columns.forEach((schema) => {
      const field = fieldMap.get(schema.name);
      const value = field ? getFieldValues(field, rowCount)[row] : undefined;
      if (tagColumnNames.indexOf(schema.name) > -1) {
        data.span_attributes.push({ key: schema.name, value });
      } else if (serviceTagColumnNames.indexOf(schema.name) > -1) {
        data.service_attributes.push({ key: schema.name, value });
      } else {
        data[schema.name] = value;
      }
    });

    let logs: GrafanaTraceSpan['logs'] = [];
    if (data.span_events) {
      let events: any[] | null = null;
      if (Array.isArray(data.span_events)) {
        events = data.span_events;
      } else if (typeof data.span_events === 'string' && data.span_events.trim()) {
        try {
          events = JSON.parse(data.span_events);
        } catch (e) {
          console.error('Failed to parse span_events from GreptimeDB:', data.span_events, e);
          events = null;
        }
      }
      if (Array.isArray(events) && events.length > 0) {
        logs = transformGreptimeDBEvents(events);
      }
    }

    spans.push({
      traceId: data.trace_id,
      spanId: data.span_id,
      parentSpanId: data.parent_span_id || undefined,
      operationName: data.span_name || 'unknown',
      serviceName: data.service_name || 'unknown',
      startTime: new Date(data.timestamp).getTime(),
      duration: data.duration_nano,
      tags: data.span_attributes,
      serviceTags: data.service_attributes,
      logs,
    });
  }

  const traceFrame = createDataFrame({
    refId: frame.refId || 'Trace ID',
    name: 'Trace Details',
    fields: [
      { name: 'traceID', type: FieldType.string, values: spans.map((s) => s.traceId) },
      { name: 'spanID', type: FieldType.string, values: spans.map((s) => s.spanId) },
      { name: 'parentSpanID', type: FieldType.string, values: spans.map((s) => s.parentSpanId) },
      { name: 'operationName', type: FieldType.string, values: spans.map((s) => s.operationName) },
      { name: 'serviceName', type: FieldType.string, values: spans.map((s) => s.serviceName) },
      { name: 'startTime', type: FieldType.time, values: spans.map((s) => s.startTime) },
      { name: 'duration', type: FieldType.number, values: spans.map((s) => s.duration), config: { unit: 'ms' } },
      { name: 'tags', type: FieldType.other, values: spans.map((s) => s.tags) },
      { name: 'serviceTags', type: FieldType.other, values: spans.map((s) => s.serviceTags) },
    ],
    meta: {
      preferredVisualisationType: 'trace',
    },
  });

  return [traceFrame];
}


interface GrafanaTraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  operationName: string;
  serviceName: string;
  startTime: number; // Unix timestamp in milliseconds
  duration: number;  // Duration in milliseconds
  tags?: Array<Record<string, any>>;
  serviceTags?: Array<Record<string, any>>;
  logs?: Array<{ timestamp: number; fields: Record<string, any> }>;
  // Add other relevant fields as needed (kind, status, etc.)
}

export type Column = {
  name: string,
  alias: string
}

export function transformGreptimeDBTraceDetails(response: GreptimeResponse, builderOptions: QueryBuilderOptions): DataFrame[] {
  if (!response?.output?.[0]?.records?.rows) {
    return [];
  }
  const columns = builderOptions.columns || []
  const records = response.output[0].records;
  // const columnSchemas = records.schema.column_schemas;
  const rows = records.rows;

  const spans: GrafanaTraceSpan[] = rows.map(row => {
    const data: Record<string, any> = { span_attributes: [], service_attributes: [] };
    const tagColumnNames = getColumnsByHint(builderOptions, ColumnHint.TraceTags)?.map((v) => v.name) || []
    const serticeTagColumnNames = getColumnsByHint(builderOptions, ColumnHint.TraceServiceTags)?.map((v) => v.name) || []
    columns.forEach((schema, index) => {
      if (tagColumnNames?.indexOf(schema.name) > -1) {
        data['span_attributes'].push({
          key: schema.name,
          value: row[index]
        })
      } else if (serticeTagColumnNames?.indexOf(schema.name) > -1) {
        data['service_attributes'].push({
          key: schema.name,
          value: row[index]
        })
      } else {
        data[schema.name] = row[index];
      }

    });


    let logs: GrafanaTraceSpan['logs'] = [];

    if (data.span_events) {
      let events: any[] | null = null;

      if (Array.isArray(data.span_events)) {
        // GreptimeDB already returned a parsed array (including the empty [] case)
        events = data.span_events;
      } else if (typeof data.span_events === 'string' && data.span_events.trim()) {
        // Non-empty JSON string – attempt to parse
        try {
          events = JSON.parse(data.span_events);
        } catch (e) {
          console.error('Failed to parse span_events from GreptimeDB:', data.span_events, e);
          events = null;
        }
      }

      if (Array.isArray(events) && events.length > 0) {
        logs = transformGreptimeDBEvents(events);
      }
    }

    return {
      traceId: data.trace_id,
      spanId: data.span_id,
      parentSpanId: data.parent_span_id || undefined,
      operationName: data.span_name || 'unknown',
      serviceName: data.service_name || 'unknown',
      startTime: new Date(data.timestamp).getTime(),
      duration: data.duration_nano,
      tags: data.span_attributes,
      serviceTags: data.service_attributes,
      logs,
      // Map other relevant fields like span_kind, span_status_code, etc.
    };
  });

  const fields = [
    { name: 'traceID', type: FieldType.string, values: spans.map(s => s.traceId) },
    { name: 'spanID', type: FieldType.string, values: spans.map(s => s.spanId) },
    { name: 'parentSpanID', type: FieldType.string, values: spans.map(s => s.parentSpanId) },
    { name: 'operationName', type: FieldType.string, values: spans.map(s => s.operationName) },
    { name: 'serviceName', type: FieldType.string, values: spans.map(s => s.serviceName) },
    { name: 'startTime', type: FieldType.time, values: spans.map(s => s.startTime) },
    //   { name: 'duration', type: FieldType.number, values: [
    //     50,
    //     100
    // ],
    // "config": { "unit": "ms" }, },
    { name: 'duration', type: FieldType.number, values: spans.map(s => s.duration), "config": { "unit": "ms" }, },
    { name: 'tags', type: FieldType.other, values: spans.map(s => s.tags) },
    { name: 'serviceTags', type: FieldType.other, values: spans.map(s => s.serviceTags) },
    // { name: 'logs', type: FieldType.other, values: spans.map(s => s.logs) },
    // Add fields for other relevant span properties
  ];

  const frame = createDataFrame({
    refId: 'Trace ID',
    name: 'Trace Details',
    fields: fields,
    meta: {
      preferredVisualisationType: 'trace',
    },
  });

  return [frame];
}

function transformGreptimeDBEvents(events: any[]): Array<{ timestamp: number; fields: Record<string, any> }> {
  if (!Array.isArray(events)) {
    return [];
  }
  return events.map(event => ({
    timestamp: new Date(event.time).getTime(), // Assuming 'time' field in your events
    fields: event.attributes || {},
  }));
}


/**
 * Transforms GreptimeDB /v1/sql JSON into Grafana DataFrames (long table format).
 * Mirrors ClickHouse/sqlutil FrameFromRows: one frame per result set, no GROUP BY
 * splitting, and no forced displayName (so panel Display name and Grafana labels work).
 */
export function transformGreptimeResponseToGrafana(
  response: GreptimeResponse,
  refId?: string
): DataFrame[] {
  const dataFrames: DataFrame[] = [];

  if (!response || !response.output || !Array.isArray(response.output)) {
    if (response?.error) {
      console.error(`GreptimeDB query failed: ${response.error} (Code: ${response.code})`);
      dataFrames.push({
        refId: refId,
        fields: [{ name: 'Error', type: FieldType.string, values: [response.error], config: {} }],
        length: 1,
      });
    } else {
      console.error('Invalid or missing "output" array in GreptimeDB response.');
    }
    return dataFrames;
  }

  response.output.forEach((resultSet, index) => {
    if (!resultSet?.records?.schema?.column_schemas || !resultSet?.records?.rows) {
      console.warn(`Skipping invalid result set at index ${index}. Missing schema, column_schemas, or rows.`);
      return;
    }

    const { schema, rows } = resultSet.records;
    const columnSchemas = schema.column_schemas;
    const numCols = columnSchemas.length;
    const numRows = rows.length;

    if (numCols === 0) {
      console.info(`Result set at index ${index} contains no columns.`);
      dataFrames.push({ name: `Result ${index + 1}`, refId, fields: [], length: 0 });
      return;
    }

    const columnValueArrays: any[][] = Array.from({ length: numCols }, () => new Array(numRows));

    for (let rowIndex = 0; rowIndex < numRows; rowIndex++) {
      const row = rows[rowIndex];

      if (!Array.isArray(row) || row.length !== numCols) {
        console.error(
          `Row ${rowIndex} in result set ${index} has incorrect length (${row?.length ?? 'undefined'}), expected ${numCols}. Filling with undefined.`
        );
        for (let colIndex = 0; colIndex < numCols; colIndex++) {
          columnValueArrays[colIndex][rowIndex] = undefined;
        }
        continue;
      }

      for (let colIndex = 0; colIndex < numCols; colIndex++) {
        const colSchema = columnSchemas[colIndex];
        const grafanaDataType = mapGreptimeTypeToGrafana(colSchema.data_type);
        if (grafanaDataType === FieldType.time) {
          columnValueArrays[colIndex][rowIndex] = toMs(row[colIndex], colSchema.data_type as GreptimeTimeType);
        } else {
          columnValueArrays[colIndex][rowIndex] = row[colIndex];
        }
      }
    }

    const fields: Field[] = columnSchemas.map((colSchema, i) => {
      const fieldName = colSchema.name || `column_${i + 1}`;
      return {
        name: fieldName,
        type: mapGreptimeTypeToGrafana(colSchema.data_type),
        // Empty config: do not set displayName (ClickHouse/sqlutil behavior; fixes #63)
        config: {},
        values: columnValueArrays[i],
      };
    });

    dataFrames.push({
      name: `Result ${index + 1}`,
      refId: refId,
      fields: fields,
      length: numRows,
    });
  });

  return dataFrames;
}
