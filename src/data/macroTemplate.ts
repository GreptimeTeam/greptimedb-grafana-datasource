/**
 * Backend time macros expanded in Go (pkg/macros). Protect them from
 * templateSrv.replace which may strip unknown $__ names (e.g. $__timeFilter → empty).
 */
const BACKEND_MACRO_PATTERN =
  /\$__(?:timeFilter_ms|timeFilter|timeInterval_ms|timeInterval|fromTime_ms|toTime_ms|fromTime|toTime|dateTimeFilter|dateFilter|interval_s|interval_ms|interval|dt)(?:\([^)]*\))?/g;

export function replacePreservingBackendMacros(sql: string, replaceFn: (sql: string) => string): string {
  const placeholders = new Map<string, string>();
  let index = 0;

  const protectedSql = sql.replace(BACKEND_MACRO_PATTERN, (match) => {
    const key = `__GT_MACRO_${index++}__`;
    placeholders.set(key, match);
    return key;
  });

  let result = replaceFn(protectedSql);
  placeholders.forEach((match, key) => {
    result = result.split(key).join(match);
  });
  return result;
}
