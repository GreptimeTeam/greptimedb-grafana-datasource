package macros

import (
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data/sqlutil"
)

func timeToISO(t time.Time) string {
	return fmt.Sprintf("'%s'", t.UTC().Format("2006-01-02T15:04:05.000Z"))
}

func timeToDate(t time.Time) string {
	return fmt.Sprintf("'%s'", t.UTC().Format("2006-01-02"))
}

func resolvedInterval(query *sqlutil.Query) string {
	return ResolveGreptimePanelInterval(query.Interval, query.TimeRange, query.MaxDataPoints)
}

func FromTimeFilter(query *sqlutil.Query, _ []string) (string, error) {
	return timeToISO(query.TimeRange.From), nil
}

func ToTimeFilter(query *sqlutil.Query, _ []string) (string, error) {
	return timeToISO(query.TimeRange.To), nil
}

func FromTimeFilterMs(query *sqlutil.Query, _ []string) (string, error) {
	return timeToISO(query.TimeRange.From), nil
}

func ToTimeFilterMs(query *sqlutil.Query, _ []string) (string, error) {
	return timeToISO(query.TimeRange.To), nil
}

func TimeFilter(query *sqlutil.Query, args []string) (string, error) {
	if len(args) != 1 {
		return "", backend.DownstreamError(fmt.Errorf("%w: expected 1 argument, received %d", sqlutil.ErrorBadArgumentCount, len(args)))
	}

	column := args[0]
	from := query.TimeRange.From
	to := query.TimeRange.To
	return fmt.Sprintf("%s >= %s AND %s <= %s", column, timeToISO(from), column, timeToISO(to)), nil
}

func TimeFilterMs(query *sqlutil.Query, args []string) (string, error) {
	return TimeFilter(query, args)
}

func DateFilter(query *sqlutil.Query, args []string) (string, error) {
	if len(args) != 1 {
		return "", backend.DownstreamError(fmt.Errorf("%w: expected 1 argument, received %d", sqlutil.ErrorBadArgumentCount, len(args)))
	}

	column := args[0]
	from := query.TimeRange.From
	to := query.TimeRange.To
	return fmt.Sprintf("%s >= %s AND %s <= %s", column, timeToDate(from), column, timeToDate(to)), nil
}

func DateTimeFilter(query *sqlutil.Query, args []string) (string, error) {
	if len(args) != 2 {
		return "", backend.DownstreamError(fmt.Errorf("%w: expected 2 arguments, received %d", sqlutil.ErrorBadArgumentCount, len(args)))
	}

	dateColumn := args[0]
	timeColumn := args[1]
	from := query.TimeRange.From
	to := query.TimeRange.To

	dateFilter := fmt.Sprintf("(%s >= %s AND %s <= %s)", dateColumn, timeToDate(from), dateColumn, timeToDate(to))
	timeFilter := fmt.Sprintf("(%s >= %s AND %s <= %s)", timeColumn, timeToISO(from), timeColumn, timeToISO(to))
	return fmt.Sprintf("%s AND %s", dateFilter, timeFilter), nil
}

func TimeInterval(query *sqlutil.Query, args []string) (string, error) {
	if len(args) != 1 {
		return "", backend.DownstreamError(fmt.Errorf("%w: expected 1 argument, received %d", sqlutil.ErrorBadArgumentCount, len(args)))
	}
	return fmt.Sprintf("date_bin('%s', %s)", resolvedInterval(query), strings.TrimSpace(args[0])), nil
}

func TimeIntervalMs(query *sqlutil.Query, args []string) (string, error) {
	return TimeInterval(query, args)
}

func IntervalMacro(query *sqlutil.Query, _ []string) (string, error) {
	return resolvedInterval(query), nil
}

func IntervalSeconds(query *sqlutil.Query, _ []string) (string, error) {
	seconds := math.Max(query.Interval.Seconds(), 1)
	return fmt.Sprintf("%d", int(seconds)), nil
}

// RemoveQuotesInArgs remove all quotes from macro arguments and return
func RemoveQuotesInArgs(args []string) []string {
	updatedArgs := []string{}
	for _, arg := range args {
		replacer := strings.NewReplacer(
			"\"", "",
			"'", "",
		)
		updatedArgs = append(updatedArgs, replacer.Replace(arg))
	}
	return updatedArgs
}

// IsValidComparisonPredicates checks for a string and return true if it is a valid SQL comparison predicate
func IsValidComparisonPredicates(comparison_predicates string) bool {
	switch comparison_predicates {
	case "=", "!=", "<>", "<", "<=", ">", ">=":
		return true
	}
	return false
}

// Macros is the Greptime macro registry used by sqlutil.Interpolate.
// Keys map to $__<key> in SQL (e.g. "fromTime" → $__fromTime).
var Macros = sqlutil.Macros{
	"fromTime":        FromTimeFilter,
	"toTime":          ToTimeFilter,
	"fromTime_ms":     FromTimeFilterMs,
	"toTime_ms":       ToTimeFilterMs,
	"timeFilter":      TimeFilter,
	"timeFilter_ms":   TimeFilterMs,
	"dateFilter":      DateFilter,
	"dateTimeFilter":  DateTimeFilter,
	"dt":              DateTimeFilter,
	"timeInterval":    TimeInterval,
	"timeInterval_ms": TimeIntervalMs,
	"interval":        IntervalMacro,
	"interval_s":      IntervalSeconds,
}
