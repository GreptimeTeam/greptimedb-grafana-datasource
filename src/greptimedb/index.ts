import {  MutableDataFrame, DataFrame,
  Field,
  FieldType, // Imported for mapGreptimeTypeToGrafana
  Vector,
  ArrayVector, // Useful for creating Field values from arrays
  FieldConfig, } from '@grafana/data';
import { lastValueFrom, Observable, throwError, of } from 'rxjs';
import { map, tap, switchMap } from 'rxjs/operators';
import {
  FetchResponse,
} from '@grafana/runtime';
import { GreptimeDataTypes } from './types';


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
export function transformGreptimeResponseToGrafana(
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
        // GreptimeDB JSON null becomes JS null. Grafana's ArrayVector handles null.
        // Map to undefined if strict undefined is preferred, though null is usually fine.
        columnValueArrays[colIndex][rowIndex] = row[colIndex];
      }
    }
    // --- End Data Transposition ---


    // Create Grafana Fields from the transposed column data
    const fields: Field[] = columnSchemas.map((colSchema, i) => {
      const fieldName = colSchema.name || `column_${i + 1}`; // Fallback name
      const fieldType = mapGreptimeTypeToGrafana(colSchema.data_type);
      const values: Vector<any> = new ArrayVector(columnValueArrays[i]); // Create Vector

      // Basic field configuration (can be expanded)
      const config: FieldConfig = {
        displayName: fieldName, // Use column name as display name initially
        // Add units, decimals, mappings etc. based on colSchema or query options if needed
      };

      return {
        name: fieldName,
        type: fieldType,
        config: config,
        values: values, // The vector containing column data
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

function buildDataFrame(columns, rows) {
  const frame = new MutableDataFrame();

  // Example: Assuming `sqlResult` is an array of rows
  if (rows.length > 0) {
    // Get column names from the first row
   
    // Create fields (columns) for the data frame
    columns.forEach((col, index) => {
      frame.addField({
        name: col.name,
        values: rows.map(row => row[index]),
        type: greptimeTypeToGrafana[col.data_type],
      });
    });
  }

  return frame;
}

// Utility function to determine field type (number, string, time, etc.)
function getFieldType(values: any[]) {
  if (typeof values[0] === 'number') {
    return 'number';
  } else if (values[0] instanceof Date) {
    return 'time';
  } else {
    return 'string';
  }
}

export function transformSqlResponse(response: Observable<FetchResponse>) {
  return response.pipe(switchMap((raw) => {
    // console.log(raw)
    
    // const rsp = toDataQueryResponse(raw, queries as DataQuery[]);
    // // Check if any response should subscribe to a live stream
    // if (rsp.data?.length && rsp.data.find((f: DataFrame) => f.meta?.channel)) {
    //   return toStreamingDataResponse(rsp, request, this.streamOptionsProvider);
    // }
    return of(raw);
  })).pipe(map(data => {
    // console.log(data)
    return data.data
  })).pipe(map(
    response => {
      // console.log(response)
      const columnSchemas = response.output[0].records.schema.column_schemas;
      const dataRows = response.output[0].records.rows;

      const frame = new MutableDataFrame({
        refId: 'A',
        fields: columnSchemas.map((columnSchema, idx) => {
          return {
            name: columnSchema.name,
            type: greptimeTypeToGrafana[columnSchema.data_type],
            values: dataRows.map((row) => row[idx]),
          };
        }),
      });
      // const frame = buildDataFrame(columnSchemas, dataRows)
      // const result = {
      //   data: {
      //     ...frame.toJSON(),
      //     refId: 'A'
      //   },
      //   state: 'Done'
      // }
      // console.log(result, 'result')
      return frame
    }
  ))
}

export function addTsCondition (sql, column, start, end) {
  const upperSql = sql.toUpperCase();
  const whereIndex = upperSql.indexOf('WHERE')
  if (whereIndex > -1) {
    return sql.slice(0, whereIndex + 5) + ` ${column} >= '${start}' and ${column} < '${end}' and ` + sql.slice(whereIndex + 5)
  } else {
    const whereIndex = findWhereClausePosition(sql);
    return sql.slice(0, whereIndex) + ` where ${column} >= '${start}' and ${column} < '${end}' ` + sql.slice(whereIndex)
  }
}

function findWhereClausePosition(sql) {
  // Normalize case for easier comparison
  const upperSql = sql.toUpperCase();

  // Find the first keyword after FROM where WHERE should go before
  const groupByIndex = upperSql.indexOf('GROUP BY');
  const orderByIndex = upperSql.indexOf('ORDER BY');
  const limitIndex = upperSql.indexOf('LIMIT');

  // Find the position to insert WHERE clause: 
  // Insert before GROUP BY, ORDER BY, or LIMIT, whichever comes first
  let insertPosition = upperSql.length; // Default to end of the query if no keywords

  if (groupByIndex !== -1 && groupByIndex < insertPosition) {
    insertPosition = groupByIndex;
  }

  if (orderByIndex !== -1 && orderByIndex < insertPosition) {
    insertPosition = orderByIndex;
  }

  if (limitIndex !== -1 && limitIndex < insertPosition) {
    insertPosition = limitIndex;
  }

  return insertPosition;
}