import { replacePreservingBackendMacros } from './macroTemplate';

describe('replacePreservingBackendMacros', () => {
  it('preserves $__timeFilter while replacing dashboard variables', () => {
    const sql =
      'SELECT date_bin(\'$__interval\', ts) as "time", max(cpu_usage) FROM "public"."cpu_metrics_30" WHERE $__timeFilter(ts) AND host = $host GROUP BY time';
    const result = replacePreservingBackendMacros(sql, (s) => s.replace(/\$host/g, "'a'"));
    expect(result).toContain('$__timeFilter(ts)');
    expect(result).toContain("'$__interval'");
    expect(result).toContain("host = 'a'");
  });

  it('simulates templateSrv stripping unknown $__ names when unprotected', () => {
    const sql = 'WHERE $__timeFilter(ts)';
    const broken = sql.replace(/\$__timeFilter/g, '');
    expect(broken).toBe('WHERE (ts)');
  });
});
