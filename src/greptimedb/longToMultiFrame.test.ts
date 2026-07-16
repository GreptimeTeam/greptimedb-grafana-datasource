import { FieldType } from '@grafana/data';
import { framesToMultiFrameTimeSeries, longToMultiFrame } from './longToMultiFrame';

describe('longToMultiFrame', () => {
  it('returns the frame unchanged when there are no string dimensions', () => {
    const frame = {
      refId: 'A',
      length: 2,
      fields: [
        { name: 'time', type: FieldType.time, config: {}, values: [1000, 2000] },
        { name: 'value', type: FieldType.number, config: {}, values: [1, 2] },
      ],
    };

    const out = longToMultiFrame(frame as any);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(frame);
  });

  it('splits by string labels into multi-frame series without displayName', () => {
    const frame = {
      refId: 'A',
      length: 4,
      fields: [
        { name: 'time', type: FieldType.time, config: {}, values: [1000, 1000, 2000, 2000] },
        {
          name: 'instance',
          type: FieldType.string,
          config: {},
          values: ['localhost:9090', 'localhost:9100', 'localhost:9090', 'localhost:9100'],
        },
        { name: 'value', type: FieldType.number, config: {}, values: [10, 20, 11, 21] },
      ],
    };

    const out = longToMultiFrame(frame as any);
    expect(out).toHaveLength(2);

    const byLabel = Object.fromEntries(
      out.map((f) => [f.fields[1].labels?.instance, f])
    );

    expect(byLabel['localhost:9090'].fields[0].values).toEqual([1000, 2000]);
    expect(byLabel['localhost:9090'].fields[1].values).toEqual([10, 11]);
    expect(byLabel['localhost:9090'].fields[1].labels).toEqual({ instance: 'localhost:9090' });
    expect(byLabel['localhost:9090'].fields[1].config.displayName).toBeUndefined();

    expect(byLabel['localhost:9100'].fields[1].values).toEqual([20, 21]);
    expect(byLabel['localhost:9100'].fields[1].labels).toEqual({ instance: 'localhost:9100' });
  });

  it('uses all string columns as labels (not only the first)', () => {
    const frame = {
      refId: 'A',
      length: 2,
      fields: [
        { name: 'time', type: FieldType.time, config: {}, values: [1000, 1000] },
        { name: 'instance', type: FieldType.string, config: {}, values: ['a', 'a'] },
        { name: 'job', type: FieldType.string, config: {}, values: ['prometheus', 'node'] },
        { name: 'value', type: FieldType.number, config: {}, values: [1, 2] },
      ],
    };

    const out = longToMultiFrame(frame as any);
    expect(out).toHaveLength(2);
    const labels = out.map((f) => f.fields[1].labels).sort((a, b) => String(a?.job).localeCompare(String(b?.job)));
    expect(labels).toEqual([
      { instance: 'a', job: 'node' },
      { instance: 'a', job: 'prometheus' },
    ]);
  });

  it('never treats time as a label key (one series when only time+value)', () => {
    // Same timestamps repeated would have exploded under old GROUP BY time parsing
    const frame = {
      refId: 'A',
      length: 3,
      fields: [
        { name: 'time', type: FieldType.time, config: {}, values: [1000, 2000, 3000] },
        { name: 'value', type: FieldType.number, config: {}, values: [1, 2, 3] },
      ],
    };
    expect(longToMultiFrame(frame as any)).toHaveLength(1);
  });
});

describe('framesToMultiFrameTimeSeries', () => {
  it('flattens multiple long frames', () => {
    const frames = [
      {
        refId: 'A',
        length: 2,
        fields: [
          { name: 'time', type: FieldType.time, config: {}, values: [1, 1] },
          { name: 'host', type: FieldType.string, config: {}, values: ['x', 'y'] },
          { name: 'v', type: FieldType.number, config: {}, values: [1, 2] },
        ],
      },
    ];
    expect(framesToMultiFrameTimeSeries(frames as any)).toHaveLength(2);
  });
});
