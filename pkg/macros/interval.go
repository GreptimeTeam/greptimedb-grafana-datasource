package macros

import (
	"math"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
)

// MsToGreptimeDateBinInterval converts milliseconds to a Greptime date_bin duration literal.
func MsToGreptimeDateBinInterval(ms int64) string {
	sec := int64(math.Max(math.Round(float64(ms)/1000), 1))
	if sec < 60 {
		return formatDuration(sec, 's')
	}
	min := int64(math.Round(float64(sec) / 60))
	if min < 60 {
		return formatDuration(int64(math.Max(float64(min), 1)), 'm')
	}
	hour := int64(math.Round(float64(min) / 60))
	if hour < 24 {
		return formatDuration(int64(math.Max(float64(hour), 1)), 'h')
	}
	day := int64(math.Max(math.Round(float64(hour)/24), 1))
	return formatDuration(day, 'd')
}

func formatDuration(value int64, unit rune) string {
	var b strings.Builder
	b.WriteString(strInt(value))
	b.WriteRune(unit)
	return b.String()
}

func strInt(v int64) string {
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		v = -v
	}
	var buf [20]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// ResolveGreptimePanelInterval mirrors src/data/logs.ts resolveGreptimePanelInterval.
func ResolveGreptimePanelInterval(interval time.Duration, timeRange backend.TimeRange, maxDataPoints int64) string {
	if interval > 0 {
		return MsToGreptimeDateBinInterval(interval.Milliseconds())
	}

	from := timeRange.From
	to := timeRange.To
	if !from.IsZero() && !to.IsZero() {
		rangeMs := to.Sub(from).Milliseconds()
		if rangeMs > 0 {
			points := maxDataPoints
			if points <= 0 {
				points = 1000
			}
			stepMs := int64(math.Max(float64(rangeMs/points), 1000))
			return MsToGreptimeDateBinInterval(stepMs)
		}
	}

	return "1m"
}
