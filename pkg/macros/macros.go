package macros

import (
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data/sqlutil"
)

// timeToDate converts a time.Time to a Greptime date literal.
// ClickHouse equivalent: toDate('YYYY-MM-DD')
func timeToDate(t time.Time) string {
	return fmt.Sprintf("'%s'", t.UTC().Format("2006-01-02"))
}

// timeToDateTime converts a time.Time to a Greptime timestamp literal (ms precision).
// ClickHouse equivalent: toDateTime(unix)
func timeToDateTime(t time.Time) string {
	return fmt.Sprintf("'%s'", t.UTC().Format("2006-01-02T15:04:05.000Z"))
}

// timeToDateTime64 is the millisecond-precision counterpart of timeToDateTime.
// Greptime uses the same ISO literal for both; ClickHouse uses fromUnixTimestamp64Milli.
func timeToDateTime64(t time.Time) string {
	return timeToDateTime(t)
}

// FromTimeFilter returns a time filter expression based on grafana's timepicker "from" time.
func FromTimeFilter(query *sqlutil.Query, args []string) (string, error) {
	return timeToDateTime(query.TimeRange.From), nil
}

// ToTimeFilter returns a time filter expression based on grafana's timepicker "to" time.
func ToTimeFilter(query *sqlutil.Query, args []string) (string, error) {
	return timeToDateTime(query.TimeRange.To), nil
}

// FromTimeFilterMs returns a millisecond-precision "from" time literal.
func FromTimeFilterMs(query *sqlutil.Query, args []string) (string, error) {
	return timeToDateTime64(query.TimeRange.From), nil
}

// ToTimeFilterMs returns a millisecond-precision "to" time literal.
func ToTimeFilterMs(query *sqlutil.Query, args []string) (string, error) {
	return timeToDateTime64(query.TimeRange.To), nil
}

func TimeFilter(query *sqlutil.Query, args []string) (string, error) {
	if len(args) != 1 {
		return "", backend.DownstreamError(fmt.Errorf("%w: expected 1 argument, received %d", sqlutil.ErrorBadArgumentCount, len(args)))
	}

	var (
		column = args[0]
		from   = query.TimeRange.From
		to     = query.TimeRange.To
	)

	return fmt.Sprintf("%s >= %s AND %s <= %s", column, timeToDateTime(from), column, timeToDateTime(to)), nil
}

func TimeFilterMs(query *sqlutil.Query, args []string) (string, error) {
	if len(args) != 1 {
		return "", backend.DownstreamError(fmt.Errorf("%w: expected 1 argument, received %d", sqlutil.ErrorBadArgumentCount, len(args)))
	}

	var (
		column = args[0]
		from   = query.TimeRange.From
		to     = query.TimeRange.To
	)

	return fmt.Sprintf("%s >= %s AND %s <= %s", column, timeToDateTime64(from), column, timeToDateTime64(to)), nil
}

func DateFilter(query *sqlutil.Query, args []string) (string, error) {
	if len(args) != 1 {
		return "", backend.DownstreamError(fmt.Errorf("%w: expected 1 argument, received %d", sqlutil.ErrorBadArgumentCount, len(args)))
	}
	var (
		column = args[0]
		from   = query.TimeRange.From
		to     = query.TimeRange.To
	)

	return fmt.Sprintf("%s >= %s AND %s <= %s", column, timeToDate(from), column, timeToDate(to)), nil
}

func DateTimeFilter(query *sqlutil.Query, args []string) (string, error) {
	if len(args) != 2 {
		return "", backend.DownstreamError(fmt.Errorf("%w: expected 2 arguments, received %d", sqlutil.ErrorBadArgumentCount, len(args)))
	}
	var (
		dateColumn = args[0]
		timeColumn = args[1]
		from       = query.TimeRange.From
		to         = query.TimeRange.To
	)

	dateFilter := fmt.Sprintf("(%s >= %s AND %s <= %s)", dateColumn, timeToDate(from), dateColumn, timeToDate(to))
	timeFilter := fmt.Sprintf("(%s >= %s AND %s <= %s)", timeColumn, timeToDateTime(from), timeColumn, timeToDateTime(to))
	return fmt.Sprintf("%s AND %s", dateFilter, timeFilter), nil
}

// TimeInterval expands $__timeInterval(col) to Greptime date_bin.
// ClickHouse equivalent: toStartOfInterval(toDateTime(col), INTERVAL N second)
func TimeInterval(query *sqlutil.Query, args []string) (string, error) {
	if len(args) != 1 {
		return "", backend.DownstreamError(fmt.Errorf("%w: expected 1 argument, received %d", sqlutil.ErrorBadArgumentCount, len(args)))
	}

	seconds := math.Max(query.Interval.Seconds(), 1)
	interval := MsToGreptimeDateBinInterval(int64(seconds) * 1000)
	return fmt.Sprintf("date_bin('%s', %s)", interval, strings.TrimSpace(args[0])), nil
}

// TimeIntervalMs expands $__timeInterval_ms(col) to Greptime date_bin.
// ClickHouse equivalent: toStartOfInterval(toDateTime64(col, 3), INTERVAL N millisecond)
func TimeIntervalMs(query *sqlutil.Query, args []string) (string, error) {
	if len(args) != 1 {
		return "", backend.DownstreamError(fmt.Errorf("%w: expected 1 argument, received %d", sqlutil.ErrorBadArgumentCount, len(args)))
	}

	milliseconds := math.Max(float64(query.Interval.Milliseconds()), 1)
	interval := MsToGreptimeDateBinInterval(int64(milliseconds))
	return fmt.Sprintf("date_bin('%s', %s)", interval, strings.TrimSpace(args[0])), nil
}

func IntervalSeconds(query *sqlutil.Query, args []string) (string, error) {
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

// Macros is a map of all macro functions — same keys as the ClickHouse plugin.
// Dialect output differs (ISO / date_bin); $__interval is handled in InterpolateSQL
// because Builder emits date_bin('$__interval', col) which sqlutil cannot expand inside quotes.
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
	"interval_s":      IntervalSeconds,
}
