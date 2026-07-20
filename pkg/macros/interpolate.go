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

// expandGreptimeIntervalMacros mirrors src/data/logs.ts expandGreptimeIntervalMacros.
// Run before sqlutil.Interpolate so date_bin('$__interval', col) is expanded even when
// the macro token sits inside quotes (sqlutil only matches bare $__interval tokens).
func expandGreptimeIntervalMacros(sql string, resolvedInterval string) string {
	sql = timeIntervalMacroPattern.ReplaceAllStringFunc(sql, func(match string) string {
		sub := timeIntervalMacroPattern.FindStringSubmatch(match)
		if len(sub) < 2 {
			return match
		}
		return fmt.Sprintf("date_bin('%s', %s)", resolvedInterval, strings.TrimSpace(sub[1]))
	})

	sql = strings.ReplaceAll(sql, "'$__interval'", "'"+resolvedInterval+"'")
	sql = strings.ReplaceAll(sql, "\"$__interval\"", "\""+resolvedInterval+"\"")
	sql = strings.ReplaceAll(sql, "$__interval", resolvedInterval)
	return sql
}

// InterpolateSQL expands Grafana time macros in raw SQL using Greptime dialect.
func InterpolateSQL(rawSQL string, timeRange backend.TimeRange, interval time.Duration, maxDataPoints int64) (string, error) {
	resolvedInterval := ResolveGreptimePanelInterval(interval, timeRange, maxDataPoints)
	rawSQL = expandGreptimeIntervalMacros(rawSQL, resolvedInterval)

	query := &sqlutil.Query{
		RawSQL:        rawSQL,
		TimeRange:     timeRange,
		Interval:      interval,
		MaxDataPoints: maxDataPoints,
	}
	sql, err := sqlutil.Interpolate(query, Macros)
	if err != nil {
		return "", err
	}

	// Safety net: expand any $__interval left after sqlutil (should be rare).
	return expandGreptimeIntervalMacros(sql, resolvedInterval), nil
}
