package macros

import (
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data/sqlutil"
)

var timeIntervalMacroPattern = regexp.MustCompile(`\$__timeInterval\(([^)]+)\)`)

// expandQuotedIntervalMacros expands $__interval inside quotes and bare tokens.
// Needed because Greptime Builder emits date_bin('$__interval', col); sqlutil only
// matches unquoted $__interval. ClickHouse avoids this by using $__timeInterval(col).
func expandQuotedIntervalMacros(sql string, resolvedInterval string) string {
	sql = timeIntervalMacroPattern.ReplaceAllStringFunc(sql, func(match string) string {
		sub := timeIntervalMacroPattern.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		return fmt.Sprintf("date_bin('%s', %s)", resolvedInterval, strings.TrimSpace(sub[1]))
	})

	sql = strings.ReplaceAll(sql, "'$__interval'", "'"+resolvedInterval+"'")
	sql = strings.ReplaceAll(sql, "\"$__interval\"", "\""+resolvedInterval+"\"")
	// Use regex with word boundary so $__interval does not corrupt longer macros like $__interval_s.
	bareIntervalRe := regexp.MustCompile(`\$__interval\b`)
	sql = bareIntervalRe.ReplaceAllLiteralString(sql, resolvedInterval)
	return sql
}

// InterpolateSQL expands Grafana time macros in raw SQL using Greptime dialect.
// Same role as sqlds.Interpolate + driver.Macros() in the ClickHouse plugin.
func InterpolateSQL(rawSQL string, timeRange backend.TimeRange, interval time.Duration, maxDataPoints int64) (string, error) {
	resolvedInterval := ResolveGreptimePanelInterval(interval, timeRange, maxDataPoints)
	// Expand quoted/bare $__interval before sqlutil (see expandQuotedIntervalMacros).
	rawSQL = expandQuotedIntervalMacros(rawSQL, resolvedInterval)

	query := &sqlutil.Query{
		RawSQL:        rawSQL,
		TimeRange:     timeRange,
		Interval:      interval,
		MaxDataPoints: maxDataPoints,
	}
	return sqlutil.Interpolate(query, Macros)
}
