import { FieldType, MutableDataFrame } from '@grafana/data';
import { lastValueFrom, Observable, throwError, of } from 'rxjs';
import { map, tap, switchMap } from 'rxjs/operators';
import {
  FetchResponse,
} from '@grafana/runtime';
import { GreptimeDataTypes } from './types';

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
