import { DataFrame, Field, FieldType } from '@grafana/data';

function fieldValueAt(field: Field, index: number): unknown {
  const values = field.values as any;
  if (values == null) {
    return undefined;
  }
  if (typeof values.get === 'function') {
    return values.get(index);
  }
  return values[index];
}

function labelKey(labels: Record<string, string>): string {
  // Stable key independent of object insertion quirks
  return Object.keys(labels)
    .sort()
    .map((k) => `${k}=${labels[k]}`)
    .join(',');
}

type SeriesBucket = {
  labels: Record<string, string>;
  times: number[];
  metrics: Record<string, Array<number | null>>;
};

/**
 * Convert a long DataFrame (time + string dims + numbers) into multi-frame
 * time series, matching Grafana "Prepare time series → Multi-frame" semantics:
 * string columns become field.labels; time is never a label.
 *
 * Returns the input unchanged when there is no time field, no string dims,
 * or no numeric values (avoids splitting Table-only or single-series results).
 */
export function longToMultiFrame(frame: DataFrame): DataFrame[] {
  if (!frame?.fields?.length || !frame.length) {
    return [frame];
  }

  const timeField = frame.fields.find((f) => f.type === FieldType.time);
  const stringFields = frame.fields.filter((f) => f.type === FieldType.string);
  const numberFields = frame.fields.filter((f) => f.type === FieldType.number);

  if (!timeField || stringFields.length === 0 || numberFields.length === 0) {
    return [frame];
  }

  const buckets = new Map<string, SeriesBucket>();

  for (let row = 0; row < frame.length; row++) {
    const labels: Record<string, string> = {};
    for (const sf of stringFields) {
      const raw = fieldValueAt(sf, row);
      labels[sf.name] = raw == null ? '' : String(raw);
    }

    const key = labelKey(labels);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        labels,
        times: [],
        metrics: Object.fromEntries(numberFields.map((nf) => [nf.name, []])),
      };
      buckets.set(key, bucket);
    }

    const t = fieldValueAt(timeField, row);
    bucket.times.push(typeof t === 'number' ? t : Number(t));

    for (const nf of numberFields) {
      const v = fieldValueAt(nf, row);
      const num = v == null || v === '' ? null : Number(v);
      bucket.metrics[nf.name].push(num != null && Number.isFinite(num) ? num : null);
    }
  }

  const frames: DataFrame[] = [];
  for (const bucket of buckets.values()) {
    for (const nf of numberFields) {
      frames.push({
        name: nf.name,
        refId: frame.refId,
        length: bucket.times.length,
        fields: [
          {
            name: timeField.name,
            type: FieldType.time,
            config: {},
            values: bucket.times,
          },
          {
            name: nf.name,
            type: FieldType.number,
            config: {},
            labels: { ...bucket.labels },
            values: bucket.metrics[nf.name],
          },
        ],
      });
    }
  }

  return frames.length > 0 ? frames : [frame];
}

/** Apply longToMultiFrame to each frame; leaves frames without string dims intact. */
export function framesToMultiFrameTimeSeries(frames: DataFrame[]): DataFrame[] {
  return frames.flatMap((frame) => longToMultiFrame(frame));
}
