package greptime

import (
	"github.com/grafana/grafana-plugin-sdk-go/data"
)

// FormatFrames applies query-type-specific shaping after ResponseToFrames.
// Time series → multi-frame; logs → LogLines; traces detail → PreferredVisualization=trace.
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
		// Trace ID detail gets PreferredVisualization=trace for the waterfall panel.
		if opts.TraceDetail {
			return markTraceFrames(frames)
		}
		return frames
	default:
		return frames
	}
}

// markTraceFrames sets PreferredVisualization=trace. Trace search/detail SQL
// already aliases Grafana Trace panel columns (traceID, spanID, …).
func markTraceFrames(frames []*data.Frame) []*data.Frame {
	for _, frame := range frames {
		if frame == nil {
			continue
		}
		if frame.Meta == nil {
			frame.Meta = &data.FrameMeta{}
		}
		frame.Meta.PreferredVisualization = data.VisTypeTrace
		for _, f := range frame.Fields {
			if f.Name == "duration" {
				if f.Config == nil {
					f.SetConfig(&data.FieldConfig{})
				}
				if f.Config.Unit == "" {
					f.Config.Unit = "ms"
				}
			}
		}
	}
	return frames
}
