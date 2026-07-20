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
	from, _ := time.Parse(time.RFC3339Nano, "2014-11-12T11:45:26.371Z")
	query := sqlutil.Query{
		TimeRange: backend.TimeRange{From: from, To: from},
	}
	got, err := FromTimeFilter(&query, nil)
	require.NoError(t, err)
	assert.Equal(t, "'2014-11-12T11:45:26.371Z'", got)
}

func TestMacroTimeFilter(t *testing.T) {
	from, _ := time.Parse(time.RFC3339Nano, "2014-11-12T11:45:26.123Z")
	to, _ := time.Parse(time.RFC3339Nano, "2015-11-12T11:45:26.456Z")
	query := sqlutil.Query{
		TimeRange: backend.TimeRange{From: from, To: to},
	}
	got, err := TimeFilter(&query, []string{"cast(sth as timestamp)"})
	require.NoError(t, err)
	assert.Equal(t, "cast(sth as timestamp) >= '2014-11-12T11:45:26.123Z' AND cast(sth as timestamp) <= '2015-11-12T11:45:26.456Z'", got)
}

func TestMacroTimeInterval(t *testing.T) {
	query := sqlutil.Query{
		Interval: 20 * time.Second,
	}
	got, err := TimeInterval(&query, []string{"col"})
	require.NoError(t, err)
	assert.Equal(t, "date_bin('20s', col)", got)
}

func TestMacroInterval(t *testing.T) {
	query := sqlutil.Query{Interval: 5 * time.Minute}
	got, err := IntervalMacro(&query, nil)
	require.NoError(t, err)
	assert.Equal(t, "5m", got)
}

func TestInterpolateGreptimeMacros(t *testing.T) {
	from, _ := time.Parse(time.RFC3339Nano, "2014-11-12T11:45:26.123Z")
	to, _ := time.Parse(time.RFC3339Nano, "2015-11-12T11:45:26.456Z")
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
			name:   "timeInterval before interval",
			input:  "SELECT $__timeInterval(greptime_timestamp) as time, avg(v) FROM t WHERE $__interval IS NOT NULL GROUP BY time",
			output: "SELECT date_bin('20s', greptime_timestamp) as time, avg(v) FROM t WHERE 20s IS NOT NULL GROUP BY time",
		},
		{
			name:   "date_bin with interval macro",
			input:  "SELECT date_bin('$__interval', greptime_timestamp) AS time FROM t",
			output: "SELECT date_bin('20s', greptime_timestamp) AS time FROM t",
		},
		{
			name:   "user aggregate query",
			input:  `SELECT date_bin('$__interval', ts) as "time", max(cpu_usage) FROM "public"."cpu_metrics_30" WHERE $__timeFilter(ts) GROUP BY time ORDER BY time ASC`,
			output: "", // filled below with dynamic ISO bounds check via substrings
		},
		{
			name:   "user aggregate query without where",
			input:  `SELECT date_bin('$__interval', ts) as "time", max(cpu_usage) FROM "public"."cpu_metrics_30" GROUP BY time ORDER BY time ASC`,
			output: `SELECT date_bin('20s', ts) as "time", max(cpu_usage) FROM "public"."cpu_metrics_30" GROUP BY time ORDER BY time ASC`,
		},
	}

	for i, tc := range tests {
		t.Run(fmt.Sprintf("[%d] %s", i+1, tc.name), func(t *testing.T) {
			got, err := InterpolateSQL(tc.input, tr, interval, 1000)
			require.NoError(t, err)
			if tc.name == "user aggregate query" {
				assert.Contains(t, got, "date_bin('20s', ts)")
				assert.Contains(t, got, "ts >= '2014-11-12T11:45:26.123Z'")
				assert.Contains(t, got, "ts <= '2015-11-12T11:45:26.456Z'")
				assert.NotContains(t, got, "$__")
				return
			}
			assert.Equal(t, tc.output, got)
		})
	}
}
