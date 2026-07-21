package greptime

import (
	"fmt"
	"math"
	"sort"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/data"
)

type seriesBucket struct {
	labels  data.Labels
	times   []time.Time
	metrics map[string][]*float64
}

// LongToMultiFrame converts a long DataFrame (time + string dims + numbers) into
// multi-frame time series, matching Grafana "Prepare time series → Multi-frame"
// and src/greptimedb/longToMultiFrame.ts.
//
// Returns the input unchanged when there is no time field, no string dims,
// or no numeric values.
func LongToMultiFrame(frame *data.Frame) []*data.Frame {
	if frame == nil || len(frame.Fields) == 0 || frame.Rows() == 0 {
		return []*data.Frame{frame}
	}

	var timeField *data.Field
	var stringFields []*data.Field
	var numberFields []*data.Field

	for _, f := range frame.Fields {
		switch f.Type() {
		case data.FieldTypeTime, data.FieldTypeNullableTime:
			if timeField == nil {
				timeField = f
			}
		case data.FieldTypeString, data.FieldTypeNullableString:
			stringFields = append(stringFields, f)
		case data.FieldTypeFloat64, data.FieldTypeNullableFloat64,
			data.FieldTypeInt64, data.FieldTypeNullableInt64,
			data.FieldTypeUint64, data.FieldTypeNullableUint64,
			data.FieldTypeFloat32, data.FieldTypeNullableFloat32,
			data.FieldTypeInt32, data.FieldTypeNullableInt32:
			numberFields = append(numberFields, f)
		}
	}

	if timeField == nil || len(stringFields) == 0 || len(numberFields) == 0 {
		return []*data.Frame{frame}
	}

	buckets := map[string]*seriesBucket{}
	rowCount := frame.Rows()

	for row := 0; row < rowCount; row++ {
		labels := data.Labels{}
		for _, sf := range stringFields {
			labels[sf.Name] = stringAt(sf, row)
		}
		key := labelKey(labels)

		bucket, ok := buckets[key]
		if !ok {
			bucket = &seriesBucket{
				labels:  labels,
				times:   make([]time.Time, 0, rowCount),
				metrics: make(map[string][]*float64, len(numberFields)),
			}
			for _, nf := range numberFields {
				bucket.metrics[nf.Name] = make([]*float64, 0, rowCount)
			}
			buckets[key] = bucket
		}

		bucket.times = append(bucket.times, timeAt(timeField, row))
		for _, nf := range numberFields {
			bucket.metrics[nf.Name] = append(bucket.metrics[nf.Name], floatPtrAt(nf, row))
		}
	}

	keys := make([]string, 0, len(buckets))
	for k := range buckets {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	out := make([]*data.Frame, 0, len(keys)*len(numberFields))
	for _, key := range keys {
		bucket := buckets[key]
		for _, nf := range numberFields {
			timeOut := data.NewField(timeField.Name, nil, append([]time.Time(nil), bucket.times...))
			timeOut.SetConfig(&data.FieldConfig{})

			valueOut := data.NewField(nf.Name, bucket.labels.Copy(), append([]*float64(nil), bucket.metrics[nf.Name]...))
			valueOut.SetConfig(&data.FieldConfig{})

			f := data.NewFrame(nf.Name, timeOut, valueOut)
			f.RefID = frame.RefID
			out = append(out, f)
		}
	}

	if len(out) == 0 {
		return []*data.Frame{frame}
	}
	return out
}

// FramesToMultiFrameTimeSeries applies LongToMultiFrame to each frame.
func FramesToMultiFrameTimeSeries(frames []*data.Frame) []*data.Frame {
	out := make([]*data.Frame, 0, len(frames))
	for _, frame := range frames {
		out = append(out, LongToMultiFrame(frame)...)
	}
	return out
}

func labelKey(labels data.Labels) string {
	if len(labels) == 0 {
		return ""
	}
	keys := make([]string, 0, len(labels))
	for k := range labels {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, fmt.Sprintf("%s=%s", k, labels[k]))
	}
	return strings.Join(parts, ",")
}

func stringAt(field *data.Field, row int) string {
	if field == nil || row < 0 || row >= field.Len() {
		return ""
	}
	v := field.At(row)
	if v == nil {
		return ""
	}
	switch t := v.(type) {
	case string:
		return t
	case *string:
		if t == nil {
			return ""
		}
		return *t
	default:
		return fmt.Sprint(t)
	}
}

func timeAt(field *data.Field, row int) time.Time {
	if field == nil || row < 0 || row >= field.Len() {
		return time.Time{}
	}
	v := field.At(row)
	switch t := v.(type) {
	case time.Time:
		return t
	case *time.Time:
		if t == nil {
			return time.Time{}
		}
		return *t
	case float64:
		return time.UnixMilli(int64(t))
	case *float64:
		if t == nil {
			return time.Time{}
		}
		return time.UnixMilli(int64(*t))
	case int64:
		return time.UnixMilli(t)
	default:
		return time.Time{}
	}
}

func floatPtrAt(field *data.Field, row int) *float64 {
	if field == nil || row < 0 || row >= field.Len() {
		return nil
	}
	v := field.At(row)
	if v == nil {
		return nil
	}
	switch t := v.(type) {
	case float64:
		if math.IsNaN(t) || math.IsInf(t, 0) {
			return nil
		}
		return &t
	case *float64:
		if t == nil || math.IsNaN(*t) || math.IsInf(*t, 0) {
			return nil
		}
		return t
	case float32:
		f := float64(t)
		return &f
	case *float32:
		if t == nil {
			return nil
		}
		f := float64(*t)
		return &f
	case int64:
		f := float64(t)
		return &f
	case *int64:
		if t == nil {
			return nil
		}
		f := float64(*t)
		return &f
	case int:
		f := float64(t)
		return &f
	default:
		if f, ok := toFloat64(v); ok {
			return &f
		}
		return nil
	}
}
