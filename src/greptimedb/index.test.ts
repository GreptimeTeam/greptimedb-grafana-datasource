import { FieldType } from '@grafana/data';
import { transformGreptimeResponseToGrafana, toMs } from './index';
import { GreptimeDataTypes, GreptimeResponse } from './types';

function makeResponse(columns: Array<{ name: string; data_type: string }>, rows: any[][]): GreptimeResponse {
  return {
    code: 0,
    output: [
      {
        records: {
          schema: { column_schemas: columns },
          rows,
        },
      },
    ],
  };
}

describe('transformGreptimeResponseToGrafana', () => {
  it('returns one long frame without displayName (even when SQL would have GROUP BY time)', () => {
    const response = makeResponse(
      [
        { name: 'time', data_type: GreptimeDataTypes.TimestampMillisecond },
        { name: 'cpu', data_type: GreptimeDataTypes.Float64 },
      ],
      [
        [1000, 1.5],
        [2000, 2.5],
      ]
    );

    const frames = transformGreptimeResponseToGrafana(response, 'A');

    expect(frames).toHaveLength(1);
    expect(frames[0].length).toBe(2);
    expect(frames[0].fields).toHaveLength(2);
    expect(frames[0].fields[0].type).toBe(FieldType.time);
    expect(frames[0].fields[0].values).toEqual([1000, 2000]);
    expect(frames[0].fields[1].type).toBe(FieldType.number);
    expect(frames[0].fields[1].config.displayName).toBeUndefined();
    expect(frames[0].fields[1].config).toEqual({});
  });

  it('keeps multiple string dimensions in a single frame', () => {
    const response = makeResponse(
      [
        { name: 'foo', data_type: GreptimeDataTypes.String },
        { name: 'bar', data_type: GreptimeDataTypes.String },
        { name: 'sum(value)', data_type: GreptimeDataTypes.Int64 },
      ],
      [
        ['a', 'b', 1],
        ['a', 'c', 1],
      ]
    );

    const frames = transformGreptimeResponseToGrafana(response, 'A');

    expect(frames).toHaveLength(1);
    expect(frames[0].fields.map((f) => f.name)).toEqual(['foo', 'bar', 'sum(value)']);
    expect(frames[0].fields[0].type).toBe(FieldType.string);
    expect(frames[0].fields[1].type).toBe(FieldType.string);
    frames[0].fields.forEach((f) => {
      expect(f.config.displayName).toBeUndefined();
    });
  });

  it('converts TimestampSecond to milliseconds', () => {
    const response = makeResponse(
      [{ name: 'time', data_type: GreptimeDataTypes.TimestampSecond }],
      [[10], [20]]
    );

    const frames = transformGreptimeResponseToGrafana(response, 'A');
    expect(frames[0].fields[0].values).toEqual([10000, 20000]);
  });

  it('returns an error frame when response has an error', () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const frames = transformGreptimeResponseToGrafana({ code: 1, error: 'boom' }, 'A');
    expect(frames).toHaveLength(1);
    expect(frames[0].fields[0].name).toBe('Error');
    expect(frames[0].fields[0].values).toEqual(['boom']);
    errSpy.mockRestore();
  });
});

describe('toMs', () => {
  it('scales timestamp units to milliseconds', () => {
    expect(toMs(1, GreptimeDataTypes.TimestampSecond)).toBe(1000);
    expect(toMs(1000, GreptimeDataTypes.TimestampMillisecond)).toBe(1000);
    expect(toMs(1_000_000, GreptimeDataTypes.TimestampMicrosecond)).toBe(1000);
    expect(toMs(1_000_000_000, GreptimeDataTypes.TimestampNanosecond)).toBe(1000);
  });
});
