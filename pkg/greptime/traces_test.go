package greptime

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTransformTraceDetailFrame_FoldsTags(t *testing.T) {
	frame := data.NewFrame("Result 1",
		data.NewField("trace_id", nil, []*string{str("t1"), str("t1")}),
		data.NewField("span_id", nil, []*string{str("s1"), str("s2")}),
		data.NewField("parent_span_id", nil, []*string{str(""), str("s1")}),
		data.NewField("service_name", nil, []*string{str("api"), str("api")}),
		data.NewField("span_name", nil, []*string{str("root"), str("child")}),
		data.NewField("timestamp", nil, []time.Time{time.UnixMilli(1000), time.UnixMilli(1100)}),
		data.NewField("duration_nano", nil, []*float64{f64(2_000_000), f64(500_000)}),
		data.NewField("span_attributes.gen_ai.system", nil, []*string{str("openai"), str("openai")}),
		data.NewField("span_attributes.gen_ai.request.model", nil, []*string{str("gpt"), str("gpt")}),
		data.NewField("resource_attributes.telemetry.sdk.name", nil, []*string{str("opentelemetry"), str("opentelemetry")}),
		data.NewField("span_status_code", nil, []*string{str("STATUS_CODE_UNSET"), str("STATUS_CODE_ERROR")}),
	)
	frame.RefID = "Trace ID"

	columns := []BuilderColumn{
		{Name: "trace_id", Hint: hintTraceID},
		{Name: "span_id", Hint: hintTraceSpanID},
		{Name: "parent_span_id", Hint: hintTraceParentSpanID},
		{Name: "service_name", Hint: hintTraceServiceName},
		{Name: "span_name", Hint: hintTraceOperation},
		{Name: "timestamp", Hint: hintTime},
		{Name: "duration_nano", Hint: hintTraceDuration},
		{Name: "span_attributes.gen_ai.system", Hint: hintTraceTags},
		{Name: "span_attributes.gen_ai.request.model", Hint: hintTraceTags},
		{Name: "resource_attributes.telemetry.sdk.name", Hint: hintTraceServiceTags},
		{Name: "span_status_code", Hint: hintTraceStatusCode},
	}

	out := TransformTraceDetailFrame(frame, columns, "nanoseconds")
	require.NotNil(t, out)
	assert.Equal(t, data.VisType("trace"), out.Meta.PreferredVisualization)

	names := fieldNames(out)
	assert.Equal(t, []string{
		"traceID", "spanID", "parentSpanID", "operationName", "serviceName",
		"startTime", "duration", "statusCode", "tags", "serviceTags",
	}, names)

	assert.Equal(t, "t1", *out.Fields[0].At(0).(*string))
	assert.Equal(t, "s1", *out.Fields[1].At(0).(*string))
	assert.Equal(t, "root", *out.Fields[3].At(0).(*string))
	assert.Equal(t, time.UnixMilli(1000), out.Fields[5].At(0).(time.Time))
	assert.Equal(t, 2.0, *out.Fields[6].At(0).(*float64)) // 2ms from 2e6 ns
	assert.Equal(t, "ms", out.Fields[6].Config.Unit)
	assert.Equal(t, 0.0, *out.Fields[7].At(0).(*float64))
	assert.Equal(t, 2.0, *out.Fields[7].At(1).(*float64)) // ERROR

	var tags []map[string]any
	require.NoError(t, json.Unmarshal(out.Fields[8].At(0).(json.RawMessage), &tags))
	require.Len(t, tags, 2)
	assert.Equal(t, "span_attributes.gen_ai.system", tags[0]["key"])
	assert.Equal(t, "openai", tags[0]["value"])
	assert.Equal(t, "span_attributes.gen_ai.request.model", tags[1]["key"])
	assert.Equal(t, "gpt", tags[1]["value"])

	var serviceTags []map[string]any
	require.NoError(t, json.Unmarshal(out.Fields[9].At(0).(json.RawMessage), &serviceTags))
	require.Len(t, serviceTags, 1)
	assert.Equal(t, "resource_attributes.telemetry.sdk.name", serviceTags[0]["key"])
	assert.Equal(t, "opentelemetry", serviceTags[0]["value"])
}

func TestTransformTraceDetailFrame_KeepsGrafanaAliases(t *testing.T) {
	frame := data.NewFrame("Result 1",
		data.NewField("traceID", nil, []*string{str("abc")}),
		data.NewField("spanID", nil, []*string{str("s1")}),
		data.NewField("parentSpanID", nil, []*string{str("")}),
		data.NewField("serviceName", nil, []*string{str("svc")}),
		data.NewField("operationName", nil, []*string{str("op")}),
		data.NewField("startTime", nil, []*float64{f64(1700000000000)}),
		data.NewField("duration", nil, []*float64{f64(12.5)}),
		data.NewField("span_attributes.gen_ai.system", nil, []*string{str("openai")}),
		data.NewField("resource_attributes.telemetry.sdk.name", nil, []*string{str("otel")}),
	)

	columns := []BuilderColumn{
		{Name: "span_attributes.gen_ai.system", Hint: hintTraceTags},
		{Name: "resource_attributes.telemetry.sdk.name", Hint: hintTraceServiceTags},
	}

	out := TransformTraceDetailFrame(frame, columns, "milliseconds")
	require.NotNil(t, out)
	assert.Equal(t, "abc", *out.Fields[0].At(0).(*string))
	assert.Equal(t, time.UnixMilli(1700000000000), out.Fields[5].At(0).(time.Time))
	assert.Equal(t, 12.5, *out.Fields[6].At(0).(*float64))

	var tags []map[string]any
	require.NoError(t, json.Unmarshal(out.Fields[7].At(0).(json.RawMessage), &tags))
	require.Len(t, tags, 1)
	assert.Equal(t, "openai", tags[0]["value"])
}

func TestFormatFrames_TraceDetail(t *testing.T) {
	frame := data.NewFrame("Result 1",
		data.NewField("traceID", nil, []*string{str("t")}),
		data.NewField("spanID", nil, []*string{str("s")}),
		data.NewField("parentSpanID", nil, []*string{str("")}),
		data.NewField("serviceName", nil, []*string{str("svc")}),
		data.NewField("operationName", nil, []*string{str("op")}),
		data.NewField("startTime", nil, []*float64{f64(1)}),
		data.NewField("duration", nil, []*float64{f64(1)}),
		data.NewField("attr.a", nil, []*string{str("v")}),
	)
	out := FormatFrames([]*data.Frame{frame}, FormatOptions{
		QueryType:     QueryTypeTraces,
		TraceDetail:   true,
		TraceColumns:  []BuilderColumn{{Name: "attr.a", Hint: hintTraceTags}},
		TraceDuration: "milliseconds",
	})
	require.Len(t, out, 1)
	assert.Equal(t, data.VisType("trace"), out[0].Meta.PreferredVisualization)
	names := fieldNames(out[0])
	assert.Contains(t, names, "tags")
	assert.Contains(t, names, "serviceTags")
}

func fieldNames(frame *data.Frame) []string {
	names := make([]string, len(frame.Fields))
	for i, f := range frame.Fields {
		names[i] = f.Name
	}
	return names
}
