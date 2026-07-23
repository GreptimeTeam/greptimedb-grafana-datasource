package greptime

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/data"
)

// Column hints mirrored from src/types/queryBuilder.ts ColumnHint.
const (
	hintTraceID           = "trace_id"
	hintTraceSpanID       = "trace_span_id"
	hintTraceParentSpanID = "trace_parent_span_id"
	hintTraceServiceName  = "trace_service_name"
	hintTraceOperation    = "trace_operation_name"
	hintTime              = "time"
	hintTraceDuration     = "trace_duration_time"
	hintTraceTags         = "trace_tags"
	hintTraceServiceTags  = "trace_service_tags"
	hintTraceStatusCode   = "trace_status_code"
)

// TransformTraceDetailFrames reshapes long SQL frames into Grafana Trace panel frames.
// Mirrors src/greptimedb transformDataFrameToTraceDetails:
//   - maps core columns (via Grafana aliases or builder column hints)
//   - folds flattened attribute columns into tags / serviceTags [{key,value},…]
func TransformTraceDetailFrames(frames []*data.Frame, columns []BuilderColumn, durationUnit string) []*data.Frame {
	out := make([]*data.Frame, 0, len(frames))
	for _, frame := range frames {
		if transformed := TransformTraceDetailFrame(frame, columns, durationUnit); transformed != nil {
			out = append(out, transformed)
		}
	}
	return out
}

// TransformTraceDetailFrame converts one long frame into a Trace Details frame.
func TransformTraceDetailFrame(frame *data.Frame, columns []BuilderColumn, durationUnit string) *data.Frame {
	if frame == nil || len(frame.Fields) == 0 || frame.Rows() == 0 {
		return nil
	}

	fieldByName := map[string]*data.Field{}
	for _, f := range frame.Fields {
		fieldByName[strings.ToLower(f.Name)] = f
	}

	tagNames := columnNamesByHint(columns, hintTraceTags)
	serviceTagNames := columnNamesByHint(columns, hintTraceServiceTags)

	// Auto-discover span_attributes.* and resource_attributes.* columns not
	// explicitly listed in builder columns. This lets SELECT * include all
	// attribute columns without requiring the builder to enumerate every one.
	knownNames := map[string]bool{}
	for _, f := range frame.Fields {
		knownNames[strings.ToLower(f.Name)] = true
	}
	knownSet := make(map[string]bool, len(tagNames)+len(serviceTagNames))
	for _, n := range tagNames {
		knownSet[strings.ToLower(n)] = true
	}
	for _, n := range serviceTagNames {
		knownSet[strings.ToLower(n)] = true
	}
	for name := range knownNames {
		lower := strings.ToLower(name)
		if !knownSet[lower] {
			if strings.HasPrefix(lower, "span_attributes.") {
				tagNames = append(tagNames, name)
			} else if strings.HasPrefix(lower, "resource_attributes.") {
				serviceTagNames = append(serviceTagNames, name)
			}
		}
	}

	traceIDField := findTraceField(fieldByName, columns, hintTraceID, "traceID", "trace_id")
	spanIDField := findTraceField(fieldByName, columns, hintTraceSpanID, "spanID", "span_id")
	parentField := findTraceField(fieldByName, columns, hintTraceParentSpanID, "parentSpanID", "parent_span_id")
	serviceField := findTraceField(fieldByName, columns, hintTraceServiceName, "serviceName", "service_name")
	opField := findTraceField(fieldByName, columns, hintTraceOperation, "operationName", "span_name", "operation_name")
	startField := findTraceField(fieldByName, columns, hintTime, "startTime", "timestamp", "ts_ms")
	durationField := findTraceField(fieldByName, columns, hintTraceDuration, "duration", "duration_nano", "dur_ms")
	statusField := findTraceField(fieldByName, columns, hintTraceStatusCode, "statusCode", "span_status_code")

	// Prefer already-assembled tags/serviceTags when SQL provided them.
	existingTags := fieldByName["tags"]
	existingServiceTags := fieldByName["servicetags"]

	rowCount := frame.Rows()
	traceIDs := make([]*string, rowCount)
	spanIDs := make([]*string, rowCount)
	parentIDs := make([]*string, rowCount)
	serviceNames := make([]*string, rowCount)
	operationNames := make([]*string, rowCount)
	startTimes := make([]time.Time, rowCount)
	durations := make([]*float64, rowCount)
	statusCodes := make([]*float64, rowCount)
	tagsJSON := make([]json.RawMessage, rowCount)
	serviceTagsJSON := make([]json.RawMessage, rowCount)

	durationIsAlreadyMs := durationField != nil && strings.EqualFold(durationField.Name, "duration")
	durationIsMsAlias := durationField != nil && strings.EqualFold(durationField.Name, "dur_ms")

	for row := 0; row < rowCount; row++ {
		traceIDs[row] = strPtr(stringAt(traceIDField, row))
		spanIDs[row] = strPtr(stringAt(spanIDField, row))
		parentIDs[row] = strPtr(stringAt(parentField, row))

		svc := stringAt(serviceField, row)
		if svc == "" {
			svc = "unknown"
		}
		serviceNames[row] = &svc

		op := stringAt(opField, row)
		if op == "" {
			op = "unknown"
		}
		operationNames[row] = &op

		startTimes[row] = startTimeAt(startField, row)
		durations[row] = durationMsAt(durationField, row, durationUnit, durationIsAlreadyMs || durationIsMsAlias)

		if statusField != nil {
			statusCodes[row] = statusCodeAt(statusField, row)
		}

		if existingTags != nil {
			tagsJSON[row] = rawJSONAt(existingTags, row)
		} else {
			tagsJSON[row] = marshalKeyValues(collectKeyValues(fieldByName, tagNames, row))
		}
		if existingServiceTags != nil {
			serviceTagsJSON[row] = rawJSONAt(existingServiceTags, row)
		} else {
			serviceTagsJSON[row] = marshalKeyValues(collectKeyValues(fieldByName, serviceTagNames, row))
		}
	}

	fields := []*data.Field{
		data.NewField("traceID", nil, traceIDs),
		data.NewField("spanID", nil, spanIDs),
		data.NewField("parentSpanID", nil, parentIDs),
		data.NewField("operationName", nil, operationNames),
		data.NewField("serviceName", nil, serviceNames),
		data.NewField("startTime", nil, startTimes),
		data.NewField("duration", nil, durations),
	}
	for _, f := range fields {
		f.SetConfig(&data.FieldConfig{})
	}
	fields[6].SetConfig(&data.FieldConfig{Unit: "ms"})

	if statusField != nil {
		sc := data.NewField("statusCode", nil, statusCodes)
		sc.SetConfig(&data.FieldConfig{})
		fields = append(fields, sc)
	}

	tagsField := data.NewField("tags", nil, tagsJSON)
	tagsField.SetConfig(&data.FieldConfig{})
	serviceTagsField := data.NewField("serviceTags", nil, serviceTagsJSON)
	serviceTagsField.SetConfig(&data.FieldConfig{})
	fields = append(fields, tagsField, serviceTagsField)

	out := data.NewFrame("Trace Details", fields...)
	out.RefID = frame.RefID
	if out.RefID == "" {
		out.RefID = "Trace ID"
	}
	out.Meta = &data.FrameMeta{
		PreferredVisualization: data.VisTypeTrace,
	}
	return out
}

func columnNamesByHint(columns []BuilderColumn, hint string) []string {
	var names []string
	for _, c := range columns {
		if c.Hint == hint && c.Name != "" {
			names = append(names, c.Name)
		}
	}
	return names
}

func findTraceField(fieldByName map[string]*data.Field, columns []BuilderColumn, hint string, aliases ...string) *data.Field {
	for _, alias := range aliases {
		if f := fieldByName[strings.ToLower(alias)]; f != nil {
			return f
		}
	}
	for _, c := range columns {
		if c.Hint == hint && c.Name != "" {
			if f := fieldByName[strings.ToLower(c.Name)]; f != nil {
				return f
			}
		}
	}
	return nil
}

func collectKeyValues(fieldByName map[string]*data.Field, names []string, row int) []map[string]any {
	out := make([]map[string]any, 0, len(names))
	for _, name := range names {
		f := fieldByName[strings.ToLower(name)]
		if f == nil {
			continue
		}
		v := valueAt(f, row)
		if v == nil {
			continue
		}
		out = append(out, map[string]any{"key": name, "value": v})
	}
	return out
}

func marshalKeyValues(kvs []map[string]any) json.RawMessage {
	if kvs == nil {
		kvs = []map[string]any{}
	}
	raw, err := json.Marshal(kvs)
	if err != nil {
		return json.RawMessage("[]")
	}
	return raw
}

func rawJSONAt(field *data.Field, row int) json.RawMessage {
	if field == nil || row < 0 || row >= field.Len() {
		return json.RawMessage("[]")
	}
	v := field.At(row)
	switch t := v.(type) {
	case json.RawMessage:
		if len(t) == 0 {
			return json.RawMessage("[]")
		}
		return t
	case []byte:
		if len(t) == 0 {
			return json.RawMessage("[]")
		}
		return json.RawMessage(t)
	case string:
		if strings.TrimSpace(t) == "" {
			return json.RawMessage("[]")
		}
		return json.RawMessage(t)
	case *string:
		if t == nil || strings.TrimSpace(*t) == "" {
			return json.RawMessage("[]")
		}
		return json.RawMessage(*t)
	default:
		raw, err := json.Marshal(v)
		if err != nil {
			return json.RawMessage("[]")
		}
		return raw
	}
}

func valueAt(field *data.Field, row int) any {
	if field == nil || row < 0 || row >= field.Len() {
		return nil
	}
	v := field.At(row)
	if v == nil {
		return nil
	}
	switch t := v.(type) {
	case *string:
		if t == nil {
			return nil
		}
		return *t
	case *float64:
		if t == nil {
			return nil
		}
		return *t
	case *bool:
		if t == nil {
			return nil
		}
		return *t
	case *int64:
		if t == nil {
			return nil
		}
		return *t
	case time.Time:
		if t.IsZero() {
			return nil
		}
		return t
	case *time.Time:
		if t == nil || t.IsZero() {
			return nil
		}
		return *t
	default:
		return v
	}
}

func strPtr(s string) *string { return &s }

func startTimeAt(field *data.Field, row int) time.Time {
	if field == nil {
		return time.Time{}
	}
	// Prefer numeric epoch ms when the column is already startTime / ts_ms.
	lower := strings.ToLower(field.Name)
	if lower == "starttime" || lower == "ts_ms" {
		if ms, ok := numericAt(field, row); ok {
			return time.UnixMilli(int64(ms))
		}
	}
	return timeAt(field, row)
}

func durationMsAt(field *data.Field, row int, unit string, alreadyMs bool) *float64 {
	ms, ok := numericAt(field, row)
	if !ok {
		return nil
	}
	if alreadyMs {
		return &ms
	}
	switch strings.ToLower(unit) {
	case "seconds":
		v := ms * 1000
		return &v
	case "milliseconds", "ms":
		return &ms
	case "microseconds":
		v := math.Floor(ms * 0.001)
		return &v
	case "nanoseconds":
		v := math.Floor(ms * 0.000001)
		return &v
	default:
		// Greptime OTel stores duration_nano; convert when column name indicates ns.
		if field != nil && strings.Contains(strings.ToLower(field.Name), "nano") {
			v := math.Floor(ms * 0.000001)
			return &v
		}
		return &ms
	}
}

func statusCodeAt(field *data.Field, row int) *float64 {
	if field == nil {
		return nil
	}
	// Already numeric statusCode (0/2).
	if ms, ok := numericAt(field, row); ok && (field.Type() == data.FieldTypeFloat64 || field.Type() == data.FieldTypeNullableFloat64) {
		return &ms
	}
	s := strings.ToUpper(stringAt(field, row))
	var code float64
	if s == "ERROR" || s == "STATUS_CODE_ERROR" {
		code = 2
	}
	return &code
}

func numericAt(field *data.Field, row int) (float64, bool) {
	if field == nil || row < 0 || row >= field.Len() {
		return 0, false
	}
	v := field.At(row)
	switch t := v.(type) {
	case float64:
		return t, true
	case *float64:
		if t == nil {
			return 0, false
		}
		return *t, true
	case int64:
		return float64(t), true
	case *int64:
		if t == nil {
			return 0, false
		}
		return float64(*t), true
	case int:
		return float64(t), true
	case json.Number:
		f, err := t.Float64()
		return f, err == nil
	case string:
		var f float64
		_, err := fmt.Sscanf(t, "%f", &f)
		return f, err == nil
	default:
		return 0, false
	}
}

// ResolveBuilderOptions returns builder options from either top-level or SQL meta.
func ResolveBuilderOptions(model QueryModel) *BuilderOptions {
	if strings.EqualFold(model.EditorType, "sql") && model.Meta != nil && model.Meta.BuilderOptions != nil {
		return model.Meta.BuilderOptions
	}
	return model.BuilderOptions
}
