import {
  DataFrame,
  Field,
  FieldType, // Imported for mapGreptimeTypeToGrafana
  FieldConfig,
  createDataFrame,
  DataFrameType,
} from '@grafana/data';

import { GreptimeDataTypes } from './types';
import { getColumnsByHint, logColumnHintsToAlias } from 'data/sqlGenerator';
import { ColumnHint, QueryBuilderOptions } from 'types/queryBuilder';
import { CHQuery } from 'types/sql';


/**
 * Maps GreptimeDB data type strings to Grafana FieldType enums.
 * @param greptimeType The data_type string from GreptimeDB schema.
 * @returns Corresponding Grafana FieldType.
 */
function mapGreptimeTypeToGrafana(greptimeType: string | undefined | null): FieldType {
  if (!greptimeType) {
    return FieldType.other;
  }
  const lowerType = greptimeType.toLowerCase();

  // Time types
  if (lowerType.includes('timestamp')) {
    return FieldType.time;
  }
  // Numeric types (covers int, float, double, decimal, numeric variants)
  if (lowerType.includes('int') || lowerType.includes('float') || lowerType.includes('double') || lowerType.includes('decimal') || lowerType.includes('numeric')) {
    return FieldType.number;
  }
  // Boolean types
  if (lowerType.includes('bool')) {
    return FieldType.boolean;
  }
  // String types
  if (lowerType.includes('string') || lowerType.includes('varchar') || lowerType.includes('text')) {
    return FieldType.string;
  }
  // Date types -> map to time for Grafana representation
  if (lowerType.includes('date')) {
    return FieldType.time;
  }
  // Interval types -> map to string for now
  if (lowerType.includes('interval')) {
    return FieldType.string;
  }

  // Log unhandled types and default to 'other'
  console.warn(`Unhandled GreptimeDB type: "${greptimeType}", mapping to FieldType.other.`);
  return FieldType.other;
}


// Assumes GreptimeResponse, GreptimeOutput etc interfaces are defined as above
// Assumes mapGreptimeTypeToGrafana function is defined as above

/**
 * Transforms a GreptimeDB /v1/sql API JSON response into Grafana DataFrames.
 * Designed for use in Grafana frontend datasources.
 *
 * @param response The parsed JSON object from the GreptimeDB API response.
 * @param refId Optional: The reference ID of the query that generated this response.
 * @returns An array of Grafana DataFrame objects.
 */
export function transformGreptimeResponseToGrafana1(
  response: GreptimeResponse,
  refId?: string
): DataFrame[] {
  const dataFrames: DataFrame[] = [];

  // Basic validation and error handling
  if (!response || !response.output || !Array.isArray(response.output)) {
    if (response?.error) {
      console.error(`GreptimeDB query failed: ${response.error} (Code: ${response.code})`);
      // Consider throwing an error or returning a specific error frame if needed
      // Example: throw new Error(`GreptimeDB Error: ${response.error}`);
    } else {
      console.error('Invalid or missing "output" array in GreptimeDB response.');
    }
    return dataFrames; // Return empty array if response structure is invalid
  }

  // Process each result set in the 'output' array
  response.output.forEach((resultSet, index) => {
    // Validate structure of the current result set
    if (!resultSet?.records?.schema?.column_schemas || !resultSet?.records?.rows) {
      console.warn(`Skipping invalid result set at index ${index}. Missing schema, column_schemas, or rows.`);
      return; // continue to next iteration
    }

    const { schema, rows } = resultSet.records;
    const columnSchemas = schema.column_schemas;
    const numCols = columnSchemas.length;
    const numRows = rows.length;

    // Handle cases with no columns
    if (numCols === 0) {
      console.info(`Result set at index ${index} contains no columns.`);
      // Optionally create and push an empty frame if needed:
      // dataFrames.push({ name: `Result ${index + 1}`, refId, fields: [], length: 0 });
      return; // continue to next iteration
    }

    // --- Data Transposition ---
    // Create arrays to hold the data for each column
    const columnValueArrays: any[][] = Array.from({ length: numCols }, () => new Array(numRows));

    // Iterate through rows from the response
    for (let rowIndex = 0; rowIndex < numRows; rowIndex++) {
      const row = rows[rowIndex];

      // Validate row structure
      if (!Array.isArray(row) || row.length !== numCols) {
        console.error(`Row ${rowIndex} in result set ${index} has incorrect length (${row?.length ?? 'undefined'}), expected ${numCols}. Filling with undefined.`);
        // Fill this row's values with undefined in all columns
        for (let colIndex = 0; colIndex < numCols; colIndex++) {
          columnValueArrays[colIndex][rowIndex] = undefined;
        }
        continue; // Move to the next row
      }

      // Populate the column arrays with data from the current row
      for (let colIndex = 0; colIndex < numCols; colIndex++) {
        // GreptimeDB JSON null becomes JS null. Grafana's Array<T> handles null.
        // Map to undefined if strict undefined is preferred, though null is usually fine.
        const grafanaDataType = mapGreptimeTypeToGrafana(columnSchemas[colIndex].data_type)
        if (grafanaDataType === FieldType.time) {
          columnValueArrays[colIndex][rowIndex] = toMs(row[colIndex], columnSchemas[colIndex].data_type as GreptimeTimeType);
        } else {
          columnValueArrays[colIndex][rowIndex] = row[colIndex];
        }
      }
    }
    // --- End Data Transposition ---


    // Create Grafana Fields from the transposed column data
    const fields: Field[] = columnSchemas.map((colSchema, i) => {
      const fieldName = colSchema.name || `column_${i + 1}`; // Fallback name
      const fieldType = mapGreptimeTypeToGrafana(colSchema.data_type);
      const values: any[] = columnValueArrays[i]; // Use simple Array<T>

      // Basic field configuration (can be expanded)
      const config: FieldConfig = {
        displayName: fieldName, // Use column name as display name initially
        // Add units, decimals, mappings etc. based on colSchema or query options if needed
      };

      return {
        name: fieldName,
        type: fieldType,
        config: config,
        values: values, // The array containing column data
      };
    });

    // Construct the Grafana DataFrame for this result set
    const frame: DataFrame = {
      name: `Result ${index + 1}`, // Assign a basic name (could be based on query alias)
      refId: refId, // Link back to the query
      fields: fields, // The array of Field objects
      length: numRows, // Explicitly set the number of rows
    };

    dataFrames.push(frame);
  });

  return dataFrames;
}

// Interfaces defining the structure of the GreptimeDB /v1/sql response
interface GreptimeColumnSchema {
  name: string;
  data_type: string;
}

interface GreptimeSchema {
  column_schemas: GreptimeColumnSchema[];
}

interface GreptimeRecords {
  schema: GreptimeSchema;
  rows: any[][]; // Array of rows, each row is an array of values
}

interface GreptimeOutput {
  // May have other properties, but 'records' is key for data
  records: GreptimeRecords;
}

interface GreptimeResponse {
  code: number;
  execution_time_ms?: number; // Optional
  output?: GreptimeOutput[]; // Array of result sets
  error?: string; // Optional error message
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


type GreptimeTimeType = GreptimeDataTypes.TimestampSecond | GreptimeDataTypes.TimestampMillisecond | GreptimeDataTypes.TimestampMicrosecond | GreptimeDataTypes.TimestampNanosecond
export function toMs(time: number, columnType: GreptimeTimeType) {
  switch (columnType) {
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
    labelsArray.push(labels);

    for (const contextName in contextColumnIndices) {
      if (!contextColumnValues[contextName]) {
        contextColumnValues[contextName] = [];
      }
      contextColumnValues[contextName].push(row[contextColumnIndices[contextName]]);
    }

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
      logs: data.span_events ? transformGreptimeDBEvents(JSON.parse(data.span_events)) : [],
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


// Function to parse the GROUP BY clause from the SQL query (simplified)
function parseGroupByColumns(sql: string): string[] {
  const groupByColumns: string[] = [];
  const groupByClause = sql.match(/GROUP BY\s+([^\s]+(?:,\s*[^\s]+)*)/i); // Case-insensitive

  if (groupByClause && groupByClause[1]) {
    // Split the GROUP BY clause by commas and trim whitespace
    groupByClause[1].split(',').forEach(column => {
      groupByColumns.push(column.trim());
    });
  }
  return groupByColumns;
}

export function transformGreptimeResponseToGrafana(
  response: GreptimeResponse,
  refId?: string,
  sql?: string // Added the optional sql parameter
): DataFrame[] {
  const dataFrames: DataFrame[] = [];

  // Basic validation and error handling
  if (!response || !response.output || !Array.isArray(response.output)) {
    if (response?.error) {
      console.error(`GreptimeDB query failed: ${response.error} (Code: ${response.code})`);
      // Consider throwing an error or returning a specific error frame if needed
      dataFrames.push({
        refId: refId,
        fields: [{ name: 'Error', type: FieldType.string, values: [response.error], config: {} }],
        length: 1,
      });
    } else {
      console.error('Invalid or missing "output" array in GreptimeDB response.');
    }
    return dataFrames; // Return even with error frame
  }

  // Process each result set in the 'output' array
  response.output.forEach((resultSet, index) => {
    // Validate structure of the current result set
    if (!resultSet?.records?.schema?.column_schemas || !resultSet?.records?.rows) {
      console.warn(`Skipping invalid result set at index ${index}. Missing schema, column_schemas, or rows.`);
      return; // continue to next iteration
    }

    const { schema, rows } = resultSet.records;
    const columnSchemas = schema.column_schemas;
    const numCols = columnSchemas.length;
    const numRows = rows.length;

    // Handle cases with no columns
    if (numCols === 0) {
      console.info(`Result set at index ${index} contains no columns.`);
      dataFrames.push({ name: `Result ${index + 1}`, refId, fields: [], length: 0 });
      return;
    }

    // --- Identify Grouping Columns and Value Columns ---
    let groupingColumnIndices: number[] = [];

    if (sql) {
      // Use the parsed GROUP BY columns from the SQL query
      const groupByColumns = parseGroupByColumns(sql);
      groupingColumnIndices = columnSchemas.map((colSchema, i) => {
        return groupByColumns.includes(colSchema.name) ? i : -1;
      }).filter(i => i !== -1);
    }

    // --- Data Transposition and Series Creation ---
    const seriesMap: Record<string, any[][]> = {}; // { groupKey: columnDataArrays }

    // Case 1: No grouping columns or only one grouping column.
    if (groupingColumnIndices.length === 0) {
      const columnValueArrays: any[][] = Array.from({ length: numCols }, () => new Array(numRows));

      for (let rowIndex = 0; rowIndex < numRows; rowIndex++) {
        const row = rows[rowIndex];
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
        const fieldType = mapGreptimeTypeToGrafana(colSchema.data_type);
        const values = columnValueArrays[i];
        const config: FieldConfig = {
          displayName: fieldName,
        };
        return {
          name: fieldName,
          type: fieldType,
          config: config,
          values: values,
        };
      });
      const frame: DataFrame = {
        name: `Result ${index + 1}`,
        refId: refId,
        fields: fields,
        length: numRows,
      };
      dataFrames.push(frame);
    } else {
      // Case 2: Multiple grouping columns - create multiple series
      // Iterate through rows from the response
      for (let rowIndex = 0; rowIndex < numRows; rowIndex++) {
        const row = rows[rowIndex];

        // Validate row structure
        if (!Array.isArray(row) || row.length !== numCols) {
          console.error(`Row ${rowIndex} in result set ${index} has incorrect length (${row?.length ?? 'undefined'}), expected ${numCols}. Skipping row.`);
          continue; // Move to the next row
        }

        // Construct a unique key for the series based on the grouping column values.
        let groupKey = '';
        for (const groupIndex of groupingColumnIndices) {
          groupKey += `${columnSchemas[groupIndex].name}:${row[groupIndex]};`;
        }

        // Initialize the series entry if it doesn't exist
        if (!seriesMap[groupKey]) {
          seriesMap[groupKey] = Array.from({ length: numCols }, () => []);
        }

        // Populate the series data
        for (let colIndex = 0; colIndex < numCols; colIndex++) {
          const colSchema = columnSchemas[colIndex];
          const grafanaDataType = mapGreptimeTypeToGrafana(colSchema.data_type);

          if (grafanaDataType === FieldType.time) {
            seriesMap[groupKey][colIndex].push(toMs(row[colIndex], colSchema.data_type as GreptimeTimeType));
          } else {
            seriesMap[groupKey][colIndex].push(row[colIndex]);
          }
        }
      }
      // --- Create Grafana DataFrames from Series ---
      for (const groupKey in seriesMap) {
        if (!Object.prototype.hasOwnProperty.call(seriesMap, groupKey)) {
          continue;
        }
        const columnValueArrays = seriesMap[groupKey];
        const fields: Field[] = columnSchemas.map((colSchema, i) => {
          const fieldName = colSchema.name || `column_${i + 1}`;
          const fieldType = mapGreptimeTypeToGrafana(colSchema.data_type);
          const values = columnValueArrays[i];

          const config: FieldConfig = {
            displayName: fieldName + '_' + groupKey,
          };

          return {
            name: fieldName,
            type: fieldType,
            config: config,
            values: values,
          };
        });

        const frame: DataFrame = {
          name: groupKey, // Use the group key as the frame name
          refId: refId,
          fields: fields,
          length: columnValueArrays[0]?.length || 0,
        };
        dataFrames.push(frame);
      }
    }
  });

  return dataFrames;
}
