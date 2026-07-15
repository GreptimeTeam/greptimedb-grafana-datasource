import { aggregateRawLogsVolume, expandGreptimeIntervalMacros, getIntervalInfo, getTimeFieldRoundingClause, LOG_LEVEL_TO_IN_CLAUSE, msToGreptimeDateBinInterval, resolveGreptimePanelInterval } from './logs';
import { FieldType } from '@grafana/data';

describe('logs', () => {
  describe('aggregateRawLogsVolume', () => {
    const timeField = {
      config: {},
      name: 'Time',
      type: 'time',
      values: [1680140003000, 1680140004000, 1680140027000, 1680140053000],
    };
    it('should do nothing if we have no DataFrames available', async () => {
      expect(aggregateRawLogsVolume([])).toEqual([]);
    });
    it('should do nothing if DataFrame format is invalid', async () => {
      expect(aggregateRawLogsVolume([{ foo: 'bar' }] as any)).toEqual([]);
    });
    it('should produce a single DataFrame if log level field was not defined', async () => {
      const rawDataFrame = [
        {
          length: 4,
          fields: [
            {
              name: 'time',
              type: FieldType.time,
              typeInfo: {
                frame: 'time.Time',
              },
              config: {},
              values: [1680140003000, 1680140004000, 1680140027000, 1680140053000],
              entities: {},
            },
            {
              name: 'logs',
              type: FieldType.number,
              typeInfo: {
                frame: 'uint64',
              },
              config: {},
              values: [0, 3, 4, 10],
              entities: {},
            },
          ],
        },
      ];
      const dataFrames = aggregateRawLogsVolume(rawDataFrame);
      expect(dataFrames).toHaveLength(1);
      const [df] = dataFrames;

      expect(df.fields[0]).toEqual(timeField);
      expect(df.fields[1].config.displayNameFromDS).toEqual('logs');
      expect(df.fields[1]).toMatchObject({
        name: 'Value',
        type: 'number',
        values: [0, 3, 4, 10],
      });
      expect(df.fields).toHaveLength(2);
    });
    it('should split a single DataFrame with level into multiple DataFrames per level', async () => {
      const rawDataFrame = [
        {
          length: 4,
          fields: [
            {
              name: 'time',
              type: FieldType.time,
              typeInfo: {
                frame: 'time.Time',
              },
              config: {},
              values: [1680140003000, 1680140004000, 1680140027000, 1680140053000],
              entities: {},
            },
            {
              name: 'debug',
              type: FieldType.number,
              typeInfo: {
                frame: 'uint64',
              },
              config: {},
              values: [1, 0, 0, 0],
              entities: {},
            },
            {
              name: 'info',
              type: FieldType.number,
              typeInfo: {
                frame: 'uint64',
              },
              config: {},
              values: [0, 3, 4, 10],
              entities: {},
            },
          ],
        },
      ];
      const dataFrames = aggregateRawLogsVolume(rawDataFrame);
      expect(dataFrames).toHaveLength(2);
      const [df1, df2] = dataFrames;

      expect(df1.fields[0]).toEqual(timeField);
      expect(df1.fields[1].config.displayNameFromDS).toEqual('debug');
      expect(df1.fields[1]).toMatchObject({
        name: 'Value',
        type: 'number',
        values: [1, 0, 0, 0],
      });
      expect(df1.fields).toHaveLength(2);

      expect(df2.fields[0]).toEqual(timeField);
      expect(df2.fields[1].config.displayNameFromDS).toEqual('info');
      expect(df2.fields[1]).toMatchObject({
        name: 'Value',
        type: 'number',
        values: [0, 3, 4, 10],
      });
      expect(df2.fields).toHaveLength(2);
    });
  });

  describe('getIntervalInfo', () => {
    it('should return the default value when no interval info is provided', async () => {
      expect(getIntervalInfo({})).toEqual({ interval: '$__interval' });
    });
    it('should do buckets per day when the provided interval greater than an hour', async () => {
      expect(
        getIntervalInfo({
          __interval_ms: {
            text: '',
            value: 60 * 60 * 1000 + 1,
          },
        })
      ).toEqual({ interval: '1d', intervalMs: 24 * 60 * 60 * 1000 });
    });
    it('should do buckets per hour when the provided interval greater than a minute', async () => {
      expect(
        getIntervalInfo({
          __interval_ms: {
            text: '',
            value: 60 * 1000 + 1,
          },
        })
      ).toEqual({ interval: '1h', intervalMs: 60 * 60 * 1000 });
    });
    it('should do buckets per minute when the provided interval greater than a second', async () => {
      expect(
        getIntervalInfo({
          __interval_ms: {
            text: '',
            value: 1001,
          },
        })
      ).toEqual({ interval: '1m', intervalMs: 60 * 1000 });
    });
    it('should do buckets per second', async () => {
      expect(
        getIntervalInfo({
          __interval_ms: {
            text: '',
            value: 1,
          },
        })
      ).toEqual({ interval: '1s', intervalMs: 1000 });
    });
  });

  describe('getTimeFieldRoundingClause', () => {
    it('should fall back to DAY grouping when no interval info is provided', async () => {
      expect(getTimeFieldRoundingClause({}, 'created_at')).toEqual("date_bin('1d', \"created_at\")");
    });
    it('should do buckets per day when the provided interval greater than an hour', async () => {
      expect(
        getTimeFieldRoundingClause(
          {
            __interval_ms: {
              text: '',
              value: 60 * 60 * 1000 + 1,
            },
          },
          'created_at'
        )
      ).toEqual("date_bin('1d', \"created_at\")");
    });
    it('should do buckets per hour when the provided interval greater than a minute', async () => {
      expect(
        getTimeFieldRoundingClause(
          {
            __interval_ms: {
              text: '',
              value: 60 * 1000 + 1,
            },
          },
          'created_at'
        )
      ).toEqual("date_bin('1h', \"created_at\")");
    });
    it('should do buckets per minute when the provided interval greater than a second', async () => {
      expect(
        getTimeFieldRoundingClause(
          {
            __interval_ms: {
              text: '',
              value: 1001,
            },
          },
          'created_at'
        )
      ).toEqual("date_bin('1m', \"created_at\")");
    });
    it('should do buckets per second', async () => {
      expect(
        getTimeFieldRoundingClause(
          {
            __interval_ms: {
              text: '',
              value: 1,
            },
          },
          'created_at'
        )
      ).toEqual("date_bin('1s', \"created_at\")");
    });
  });

  describe('resolveGreptimePanelInterval', () => {
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000;

    it('follows Grafana interval string as-is (no range coarsening)', () => {
      expect(resolveGreptimePanelInterval({ interval: '5m', intervalMs: 60_000, rangeMs: twoDaysMs, maxDataPoints: 1000 })).toBe(
        '5m'
      );
      // Even on a multi-day range, trust Grafana's 1m when that is what it sent
      expect(resolveGreptimePanelInterval({ interval: '1m', intervalMs: 60_000, rangeMs: twoDaysMs, maxDataPoints: 1000 })).toBe(
        '1m'
      );
    });

    it('converts intervalMs with fine granularity (not logs 1s/1m/1h snap)', () => {
      // ~2 day range / 1000 points ≈ 172.8s → should be minutes, not forced 1h/1m snap only
      expect(msToGreptimeDateBinInterval(172_800)).toBe('3m');
      expect(resolveGreptimePanelInterval({ intervalMs: 172_800 })).toBe('3m');
      expect(resolveGreptimePanelInterval({ intervalMs: 3_600_000 })).toBe('1h');
    });

    it('uses range and maxDataPoints only as fallback when Grafana interval is absent', () => {
      expect(resolveGreptimePanelInterval({ rangeMs: twoDaysMs, maxDataPoints: 1000 })).toBe('3m');
    });
  });

  describe('expandGreptimeIntervalMacros', () => {
    it('expands $__timeInterval to date_bin before bare $__interval', () => {
      const sql =
        "SELECT $__timeInterval(greptime_timestamp) as time, avg(v) FROM t WHERE $__interval IS NOT NULL GROUP BY time";
      expect(expandGreptimeIntervalMacros(sql, '1m')).toBe(
        "SELECT date_bin('1m', greptime_timestamp) as time, avg(v) FROM t WHERE 1m IS NOT NULL GROUP BY time"
      );
    });

    it('does not leave a corrupted $__timeInterval when replacing $__interval', () => {
      const sql = 'SELECT $__timeInterval(ts) AS time';
      const expanded = expandGreptimeIntervalMacros(sql, '5m');
      expect(expanded).toBe("SELECT date_bin('5m', ts) AS time");
      expect(expanded).not.toContain('$__');
    });
  });

  describe('LOG_LEVEL_TO_IN_CLAUSE', () => {
    it('should generate correct IN clauses', async () => {
      expect(LOG_LEVEL_TO_IN_CLAUSE).toEqual({
        critical:
          "'critical','fatal','crit','alert','emerg','CRITICAL','FATAL','CRIT','ALERT','EMERG','Critical','Fatal','Crit','Alert','Emerg'",
        debug: "'debug','dbug','DEBUG','DBUG','Debug','Dbug'",
        error: "'error','err','eror','ERROR','ERR','EROR','Error','Err','Eror'",
        info: "'info','information','informational','INFO','INFORMATION','INFORMATIONAL','Info','Information','Informational'",
        trace: "'trace','TRACE','Trace'",
        unknown: "'unknown','UNKNOWN','Unknown'",
        warn: "'warn','warning','WARN','WARNING','Warn','Warning'",
      });
    });
  });
});
