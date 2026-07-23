package macros

import (
	"fmt"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data/sqlutil"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTimeToDate(t *testing.T) {
	d, _ := time.Parse("2006-01-02T15:04:05.000Z", "2014-11-12T11:45:26.371Z")
	assert.Equal(t, "'2014-11-12'", timeToDate(d))
}

func TestTimeToDateTime(t *testing.T) {
	dt, _ := time.Parse("2006-01-02T15:04:05.000Z", "2014-11-12T11:45:26.371Z")
	assert.Equal(t, "'2014-11-12T11:45:26.371Z'", timeToDateTime(dt))
}

func TestMsToGreptimeDateBinInterval(t *testing.T) {
	assert.Equal(t, "15s", MsToGreptimeDateBinInterval(15_000))
	assert.Equal(t, "3m", MsToGreptimeDateBinInterval(172_800))
	assert.Equal(t, "1h", MsToGreptimeDateBinInterval(3_600_000))
	assert.Equal(t, "1d", MsToGreptimeDateBinInterval(86_400_000))
}

func TestResolveGreptimePanelInterval(t *testing.T) {
	twoDays := 2 * 24 * time.Hour
	from := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	to := from.Add(twoDays)
	tr := backend.TimeRange{From: from, To: to}

	assert.Equal(t, "5m", ResolveGreptimePanelInterval(5*time.Minute, tr, 1000))
	assert.Equal(t, "3m", ResolveGreptimePanelInterval(172_800*time.Millisecond, tr, 1000))
	assert.Equal(t, "3m", ResolveGreptimePanelInterval(0, tr, 1000))
	assert.Equal(t, "1m", ResolveGreptimePanelInterval(0, backend.TimeRange{}, 0))
}

func TestMacroFromTimeFilter(t *testing.T) {
	from, _ := time.Parse("2006-01-02T15:04:05.000Z", "2014-11-12T11:45:26.371Z")
	to, _ := time.Parse("2006-01-02T15:04:05.000Z", "2015-11-12T11:45:26.371Z")
	query := sqlutil.Query{
		TimeRange: backend.TimeRange{From: from, To: to},
		RawSQL:    "select foo from foo where bar > $__fromTime",
	}
	got, err := FromTimeFilter(&query, []string{})
	require.NoError(t, err)
	assert.Equal(t, "'2014-11-12T11:45:26.371Z'", got)
}

func TestMacroToTimeFilter(t *testing.T) {
	from, _ := time.Parse("2006-01-02T15:04:05.000Z", "2014-11-12T11:45:26.371Z")
	to, _ := time.Parse("2006-01-02T15:04:05.000Z", "2015-11-12T11:45:26.371Z")
	query := sqlutil.Query{
		TimeRange: backend.TimeRange{From: from, To: to},
	}
	got, err := ToTimeFilter(&query, []string{})
	require.NoError(t, err)
	assert.Equal(t, "'2015-11-12T11:45:26.371Z'", got)
}

func TestMacroFromTimeFilterMs(t *testing.T) {
	from, _ := time.Parse("2006-01-02T15:04:05.000Z", "2014-11-12T11:45:26.371Z")
	query := sqlutil.Query{TimeRange: backend.TimeRange{From: from, To: from}}
	got, err := FromTimeFilterMs(&query, []string{})
	require.NoError(t, err)
	assert.Equal(t, "'2014-11-12T11:45:26.371Z'", got)
}

func TestMacroDateFilter(t *testing.T) {
	from, _ := time.Parse("2006-01-02T15:04:05.000Z", "2014-11-12T11:45:26.371Z")
	to, _ := time.Parse("2006-01-02T15:04:05.000Z", "2015-11-12T11:45:26.371Z")
	query := sqlutil.Query{TimeRange: backend.TimeRange{From: from, To: to}}
	got, err := DateFilter(&query, []string{"dateCol"})
	require.NoError(t, err)
	assert.Equal(t, "dateCol >= '2014-11-12' AND dateCol <= '2015-11-12'", got)
}

func TestMacroDateTimeFilter(t *testing.T) {
	from, _ := time.Parse("2006-01-02T15:04:05.000Z", "2014-11-12T11:45:26.371Z")
	to, _ := time.Parse("2006-01-02T15:04:05.000Z", "2015-11-12T11:45:26.371Z")
	query := sqlutil.Query{TimeRange: backend.TimeRange{From: from, To: to}}
	got, err := DateTimeFilter(&query, []string{"dateCol", "timeCol"})
	require.NoError(t, err)
	assert.Equal(t,
		"(dateCol >= '2014-11-12' AND dateCol <= '2015-11-12') AND (timeCol >= '2014-11-12T11:45:26.371Z' AND timeCol <= '2015-11-12T11:45:26.371Z')",
		got,
	)
}

func TestMacroTimeFilter(t *testing.T) {
	from, _ := time.Parse("2006-01-02T15:04:05.000Z", "2014-11-12T11:45:26.123Z")
	to, _ := time.Parse("2006-01-02T15:04:05.000Z", "2015-11-12T11:45:26.456Z")
	query := sqlutil.Query{TimeRange: backend.TimeRange{From: from, To: to}}
	got, err := TimeFilter(&query, []string{"cast(sth as timestamp)"})
	require.NoError(t, err)
	assert.Equal(t, "cast(sth as timestamp) >= '2014-11-12T11:45:26.123Z' AND cast(sth as timestamp) <= '2015-11-12T11:45:26.456Z'", got)
}

func TestMacroTimeFilterMs(t *testing.T) {
	from, _ := time.Parse("2006-01-02T15:04:05.000Z", "2014-11-12T11:45:26.123Z")
	to, _ := time.Parse("2006-01-02T15:04:05.000Z", "2015-11-12T11:45:26.456Z")
	query := sqlutil.Query{TimeRange: backend.TimeRange{From: from, To: to}}
	got, err := TimeFilterMs(&query, []string{"col"})
	require.NoError(t, err)
	assert.Equal(t, "col >= '2014-11-12T11:45:26.123Z' AND col <= '2015-11-12T11:45:26.456Z'", got)
}

func TestMacroTimeInterval(t *testing.T) {
	query := sqlutil.Query{
		RawSQL:   "select $__timeInterval(col) from foo",
		Interval: 20 * time.Second,
	}
	got, err := TimeInterval(&query, []string{"col"})
	require.NoError(t, err)
	assert.Equal(t, "date_bin('20s', col)", got)
}

func TestMacroTimeIntervalMs(t *testing.T) {
	query := sqlutil.Query{
		RawSQL:   "select $__timeInterval_ms(col) from foo",
		Interval: 20 * time.Second,
	}
	got, err := TimeIntervalMs(&query, []string{"col"})
	require.NoError(t, err)
	assert.Equal(t, "date_bin('20s', col)", got)
}

func TestMacroIntervalSeconds(t *testing.T) {
	query := sqlutil.Query{
		RawSQL:   "select date_bin(INTERVAL $__interval_s second, col) AS time from foo",
		Interval: 20 * time.Second,
	}
	got, err := IntervalSeconds(&query, []string{})
	require.NoError(t, err)
	assert.Equal(t, "20", got)
}

// TestInterpolate mirrors ClickHouse's TestInterpolate: end-to-end macro expansion.
func TestInterpolate(t *testing.T) {
	from, _ := time.Parse("2006-01-02T15:04:05.000Z", "2014-11-12T11:45:26.123Z")
	to, _ := time.Parse("2006-01-02T15:04:05.000Z", "2015-11-12T11:45:26.456Z")
	tr := backend.TimeRange{From: from, To: to}
	interval := 20 * time.Second

	tests := []struct {
		name   string
		input  string
		output string
	}{
		{
			name:   "timeFilter",
			input:  "select * from foo where $__timeFilter(cast(sth as timestamp))",
			output: "select * from foo where cast(sth as timestamp) >= '2014-11-12T11:45:26.123Z' AND cast(sth as timestamp) <= '2015-11-12T11:45:26.456Z'",
		},
		{
			name:   "fromTime and toTime",
			input:  "select * from foo where ( date >= $__fromTime and date <= $__toTime ) limit 100",
			output: "select * from foo where ( date >= '2014-11-12T11:45:26.123Z' and date <= '2015-11-12T11:45:26.456Z' ) limit 100",
		},
		{
			name:   "timeInterval",
			input:  "SELECT $__timeInterval(greptime_timestamp) as time FROM t",
			output: "SELECT date_bin('20s', greptime_timestamp) as time FROM t",
		},
		{
			name:   "date_bin with quoted interval (Greptime Builder)",
			input:  "SELECT date_bin('$__interval', greptime_timestamp) AS time FROM t",
			output: "SELECT date_bin('20s', greptime_timestamp) AS time FROM t",
		},
		{
			name:   "aggregate with timeFilter",
			input:  `SELECT date_bin('$__interval', ts) as "time", max(cpu_usage) FROM "public"."cpu_metrics_30" WHERE $__timeFilter(ts) GROUP BY time ORDER BY time ASC`,
			output: `SELECT date_bin('20s', ts) as "time", max(cpu_usage) FROM "public"."cpu_metrics_30" WHERE ts >= '2014-11-12T11:45:26.123Z' AND ts <= '2015-11-12T11:45:26.456Z' GROUP BY time ORDER BY time ASC`,
		},
		{
			name:   "timeFilter_ms",
			input:  "SELECT * FROM foo WHERE $__timeFilter_ms(col)",
			output: "SELECT * FROM foo WHERE col >= '2014-11-12T11:45:26.123Z' AND col <= '2015-11-12T11:45:26.456Z'",
		},
		{
			name:   "toTime_ms standalone",
			input:  "SELECT $__toTime_ms",
			output: "SELECT '2015-11-12T11:45:26.456Z'",
		},
		{
			name:   "dt alias for dateTimeFilter",
			input:  "SELECT * FROM foo WHERE $__dt(dateCol, timeCol)",
			output: "SELECT * FROM foo WHERE (dateCol >= '2014-11-12' AND dateCol <= '2015-11-12') AND (timeCol >= '2014-11-12T11:45:26.123Z' AND timeCol <= '2015-11-12T11:45:26.456Z')",
		},
		{
			name:   "interval_s in CTE",
			input:  "WITH cte AS (SELECT $__interval_s) SELECT * FROM cte",
			output: "WITH cte AS (SELECT 20) SELECT * FROM cte",
		},
		{
			name:   "preserve dashboard variable",
			input:  "SELECT * FROM foo WHERE bar = '${table:sqlstring}'",
			output: "SELECT * FROM foo WHERE bar = '${table:sqlstring}'",
		},
	}

	for i, tc := range tests {
		t.Run(fmt.Sprintf("[%d/%d] %s", i+1, len(tests), tc.name), func(t *testing.T) {
			got, err := InterpolateSQL(tc.input, tr, interval, 1000)
			require.NoError(t, err)
			assert.Equal(t, tc.output, got)
		})
	}
}

func TestMacroToTimeFilterMs(t *testing.T) {
	from, _ := time.Parse("2006-01-02T15:04:05.000Z", "2014-11-12T11:45:26.371Z")
	to, _ := time.Parse("2006-01-02T15:04:05.000Z", "2015-11-12T11:45:26.371Z")
	query := sqlutil.Query{TimeRange: backend.TimeRange{From: from, To: to}}
	got, err := ToTimeFilterMs(&query, []string{})
	require.NoError(t, err)
	assert.Equal(t, "'2015-11-12T11:45:26.371Z'", got)
}

func TestMacroTimeFilter_ErrorNoArgs(t *testing.T) {
	from, _ := time.Parse("2006-01-02T15:04:05.000Z", "2014-11-12T11:45:26.371Z")
	to, _ := time.Parse("2006-01-02T15:04:05.000Z", "2015-11-12T11:45:26.371Z")
	query := sqlutil.Query{TimeRange: backend.TimeRange{From: from, To: to}}
	_, err := TimeFilter(&query, []string{})
	require.Error(t, err)
}

func TestMacroTimeInterval_ZeroInterval(t *testing.T) {
	query := sqlutil.Query{
		RawSQL:   "select $__timeInterval(col) from foo",
		Interval: 0,
	}
	got, err := TimeInterval(&query, []string{"col"})
	require.NoError(t, err)
	assert.Equal(t, "date_bin('1s', col)", got)
}

func TestMacroDateTimeFilter_ErrorWrongArgs(t *testing.T) {
	from, _ := time.Parse("2006-01-02T15:04:05.000Z", "2014-11-12T11:45:26.371Z")
	to, _ := time.Parse("2006-01-02T15:04:05.000Z", "2015-11-12T11:45:26.371Z")
	query := sqlutil.Query{TimeRange: backend.TimeRange{From: from, To: to}}
	// 0 args
	_, err0 := DateTimeFilter(&query, []string{})
	require.Error(t, err0)
	// 1 arg
	_, err1 := DateTimeFilter(&query, []string{"dateCol"})
	require.Error(t, err1)
	// 3 args
	_, err3 := DateTimeFilter(&query, []string{"a", "b", "c"})
	require.Error(t, err3)
}

func TestMacroDt(t *testing.T) {
	from, _ := time.Parse("2006-01-02T15:04:05.000Z", "2014-11-12T11:45:26.371Z")
	to, _ := time.Parse("2006-01-02T15:04:05.000Z", "2015-11-12T11:45:26.371Z")
	query := sqlutil.Query{TimeRange: backend.TimeRange{From: from, To: to}}
	got, err := DateTimeFilter(&query, []string{"dateCol", "timeCol"})
	require.NoError(t, err)
	assert.Equal(t,
		"(dateCol >= '2014-11-12' AND dateCol <= '2015-11-12') AND (timeCol >= '2014-11-12T11:45:26.371Z' AND timeCol <= '2015-11-12T11:45:26.371Z')",
		got,
	)
}
