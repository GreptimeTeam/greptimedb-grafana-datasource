package greptime

import (
	"github.com/grafana/grafana-plugin-sdk-go/data"
)

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
		// Trace search stays as a long table (same as previous FE behavior).
		// Trace ID detail: reshape into Grafana Trace panel fields (incl. tags/serviceTags).
		if opts.TraceDetail {
			return TransformTraceDetailFrames(frames, opts.TraceColumns, opts.TraceDuration)
		}
		return frames
	default:
		return frames
	}
}
