package greptime

import (
	"strings"

	"github.com/grafana/grafana-plugin-sdk-go/data"
)

// isSingleTraceDetail detects whether the frames represent a single-trace
// detail (waterfall) query vs a multi-trace search result. It counts unique
// trace_id values across all rows: 1 → detail, >1 or 0 → search/table.
func isSingleTraceDetail(frames []*data.Frame) bool {
	for _, frame := range frames {
		if frame == nil || len(frame.Fields) == 0 || frame.Rows() == 0 {
			continue
		}
		var traceField *data.Field
		for _, f := range frame.Fields {
			switch strings.ToLower(f.Name) {
			case "traceid", "trace_id":
				traceField = f
			}
		}
		if traceField == nil {
			continue
		}
		seen := map[string]bool{}
		for row := 0; row < frame.Rows(); row++ {
			seen[stringAt(traceField, row)] = true
			if len(seen) > 1 {
				return false
			}
		}
		return len(seen) == 1
	}
	return false
}

// FormatFrames applies query-type-specific shaping after ResponseToFrames.
// Time series → multi-frame; logs → LogLines; traces detail → Grafana Trace fields.
func FormatFrames(frames []*data.Frame, opts FormatOptions) []*data.Frame {
	if len(frames) == 0 {
		return frames
	}

	// Preserve error frames as-is.
	if len(frames) == 1 && frames[0] != nil && len(frames[0].Fields) > 0 && frames[0].Fields[0].Name == "Error" {
		return frames
	}

	switch opts.QueryType {
	case QueryTypeTimeSeries:
		return FramesToMultiFrameTimeSeries(frames)
	case QueryTypeLogs:
		out := make([]*data.Frame, 0, len(frames))
		for _, frame := range frames {
			logFrame := TransformLogsFrame(frame, opts.ContextColumns)
			if logFrame != nil {
				out = append(out, logFrame)
			}
		}
		return out
	case QueryTypeTraces:
		if opts.TraceDetail || isSingleTraceDetail(frames) {
			return TransformTraceDetailFrames(frames, opts.TraceColumns, opts.TraceDuration)
		}
		return frames
	default:
		return frames
	}
}
