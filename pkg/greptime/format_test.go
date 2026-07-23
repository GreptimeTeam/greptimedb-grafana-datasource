package greptime

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLongToMultiFrame_NoStringDims(t *testing.T) {
	frame := data.NewFrame("A",
		data.NewField("time", nil, []time.Time{time.UnixMilli(1000), time.UnixMilli(2000)}),
		data.NewField("value", nil, []*float64{f64(1), f64(2)}),
	)
	frame.RefID = "A"

	out := LongToMultiFrame(frame)
	require.Len(t, out, 1)
	assert.Same(t, frame, out[0])
}

func TestLongToMultiFrame_SplitsByLabels(t *testing.T) {
	frame := data.NewFrame("A",
		data.NewField("time", nil, []time.Time{
			time.UnixMilli(1000), time.UnixMilli(1000), time.UnixMilli(2000), time.UnixMilli(2000),
		}),
		data.NewField("instance", nil, []*string{str("localhost:9090"), str("localhost:9100"), str("localhost:9090"), str("localhost:9100")}),
		data.NewField("value", nil, []*float64{f64(10), f64(20), f64(11), f64(21)}),
	)
	frame.RefID = "A"

	out := LongToMultiFrame(frame)
	require.Len(t, out, 2)

	byLabel := map[string]*data.Frame{}
	for _, f := range out {
		byLabel[f.Fields[1].Labels["instance"]] = f
	}

	require.Contains(t, byLabel, "localhost:9090")
	require.Contains(t, byLabel, "localhost:9100")

	a := byLabel["localhost:9090"]
	require.Equal(t, 2, a.Rows())
	assert.Equal(t, time.UnixMilli(1000), a.Fields[0].At(0))
	assert.Equal(t, time.UnixMilli(2000), a.Fields[0].At(1))
	assert.Equal(t, 10.0, *a.Fields[1].At(0).(*float64))
	assert.Equal(t, 11.0, *a.Fields[1].At(1).(*float64))
	assert.Equal(t, data.Labels{"instance": "localhost:9090"}, a.Fields[1].Labels)
	assert.Empty(t, a.Fields[1].Config.DisplayName)

	b := byLabel["localhost:9100"]
	assert.Equal(t, 20.0, *b.Fields[1].At(0).(*float64))
	assert.Equal(t, 21.0, *b.Fields[1].At(1).(*float64))
}

func TestLongToMultiFrame_AllStringColumnsAreLabels(t *testing.T) {
	frame := data.NewFrame("A",
		data.NewField("time", nil, []time.Time{time.UnixMilli(1000), time.UnixMilli(1000)}),
		data.NewField("instance", nil, []*string{str("a"), str("a")}),
		data.NewField("job", nil, []*string{str("prometheus"), str("node")}),
		data.NewField("value", nil, []*float64{f64(1), f64(2)}),
	)

	out := LongToMultiFrame(frame)
	require.Len(t, out, 2)

	labels := []data.Labels{out[0].Fields[1].Labels, out[1].Fields[1].Labels}
	assert.Contains(t, labels, data.Labels{"instance": "a", "job": "node"})
	assert.Contains(t, labels, data.Labels{"instance": "a", "job": "prometheus"})
}

func TestTransformLogsFrame(t *testing.T) {
	frame := data.NewFrame("Result 1",
		data.NewField("timestamp", nil, []time.Time{time.UnixMilli(1000), time.UnixMilli(2000)}),
		data.NewField("body", nil, []*string{str("hello"), str("world")}),
		data.NewField("level", nil, []*string{str("info"), str("error")}),
		data.NewField("service", nil, []*string{str("api"), str("api")}),
		data.NewField("hostname", nil, []*string{str("h1"), str("h2")}),
	)
	frame.RefID = "A"

	out := TransformLogsFrame(frame, []string{"hostname"})
	require.NotNil(t, out)
	require.Equal(t, data.VisType("logs"), out.Meta.PreferredVisualization)
	require.Equal(t, data.FrameType("log-lines"), out.Meta.Type)

	names := make([]string, len(out.Fields))
	for i, f := range out.Fields {
		names[i] = f.Name
	}
	assert.Equal(t, []string{"timestamp", "body", "severity", "hostname", "labels"}, names)
	assert.Equal(t, 2, out.Rows())
	assert.Equal(t, "hello", *out.Fields[1].At(0).(*string))
	assert.Equal(t, "info", *out.Fields[2].At(0).(*string))
	assert.Equal(t, "h1", *out.Fields[3].At(0).(*string))

	var labels map[string]any
	require.NoError(t, json.Unmarshal(out.Fields[4].At(0).(json.RawMessage), &labels))
	assert.Equal(t, "api", labels["service"])
	assert.Equal(t, "h1", labels["hostname"])
}

func TestFormatFrames_TimeSeries(t *testing.T) {
	raw := `{
		"code": 0,
		"output": [{
			"records": {
				"schema": {
					"column_schemas": [
						{"name": "time", "data_type": "TimestampMillisecond"},
						{"name": "instance", "data_type": "String"},
						{"name": "value", "data_type": "Float64"}
					]
				},
				"rows": [
					[1700000000000, "a", 1.5],
					[1700000060000, "b", 2.5]
				]
			}
		}]
	}`
	var response Response
	require.NoError(t, json.Unmarshal([]byte(raw), &response))
	frames, err := ResponseToFrames(&response, "A")
	require.NoError(t, err)

	out := FormatFrames(frames, FormatOptions{QueryType: QueryTypeTimeSeries})
	require.Len(t, out, 2)
	assert.Equal(t, "a", out[0].Fields[1].Labels["instance"])
	assert.Equal(t, "b", out[1].Fields[1].Labels["instance"])
}

func TestResolveQueryType(t *testing.T) {
	assert.Equal(t, QueryTypeTraces, ResolveQueryType(QueryModel{RefID: "Trace ID"}))
	assert.Equal(t, QueryTypeLogs, ResolveQueryType(QueryModel{
		BuilderOptions: &BuilderOptions{QueryType: QueryTypeLogs},
	}))
	assert.Equal(t, QueryTypeTimeSeries, ResolveQueryType(QueryModel{
		EditorType: "sql",
		Meta:       &QueryMeta{BuilderOptions: &BuilderOptions{QueryType: QueryTypeTimeSeries}},
	}))
	assert.Equal(t, QueryTypeTable, ResolveQueryType(QueryModel{}))
}

func f64(v float64) *float64 { return &v }
func str(v string) *string   { return &v }

// ---------------------------------------------------------------------------
// FormatFrames dispatch tests
// ---------------------------------------------------------------------------

func TestFormatFrames_Logs(t *testing.T) {
	frame := data.NewFrame("A",
		data.NewField("timestamp", nil, []time.Time{time.UnixMilli(1000), time.UnixMilli(2000)}),
		data.NewField("body", nil, []*string{str("hello"), str("world")}),
		data.NewField("level", nil, []*string{str("info"), str("error")}),
	)
	frame.RefID = "A"

	out := FormatFrames([]*data.Frame{frame}, FormatOptions{
		QueryType:      QueryTypeLogs,
		ContextColumns: []string{"service"},
	})
	require.Len(t, out, 1)
	lf := out[0]
	require.NotNil(t, lf.Meta)
	assert.Equal(t, data.VisType("logs"), lf.Meta.PreferredVisualization)

	names := make([]string, len(lf.Fields))
	for i, f := range lf.Fields {
		names[i] = f.Name
	}
	assert.Equal(t, []string{"timestamp", "body", "severity", "labels"}, names)
	assert.Equal(t, 2, lf.Rows())
}

func TestFormatFrames_TracesSearchTable(t *testing.T) {
	frame := data.NewFrame("A",
		data.NewField("trace_id", nil, []*string{str("abc"), str("def")}),
		data.NewField("span_name", nil, []*string{str("GET"), str("POST")}),
		data.NewField("duration", nil, []*float64{f64(100), f64(200)}),
	)
	frame.RefID = "A"

	out := FormatFrames([]*data.Frame{frame}, FormatOptions{
		QueryType:   QueryTypeTraces,
		TraceDetail: false,
	})
	require.Len(t, out, 1)
	assert.Same(t, frame, out[0])
	// No trace-specific meta; frame returned as-is.
	if out[0].Meta != nil {
		assert.NotEqual(t, data.VisType("trace"), out[0].Meta.PreferredVisualization)
	}
}

func TestFormatFrames_Table(t *testing.T) {
	frame := data.NewFrame("A",
		data.NewField("name", nil, []*string{str("foo"), str("bar")}),
		data.NewField("value", nil, []*float64{f64(1), f64(2)}),
	)
	frame.RefID = "A"

	out := FormatFrames([]*data.Frame{frame}, FormatOptions{QueryType: QueryTypeTable})
	require.Len(t, out, 1)
	assert.Same(t, frame, out[0])
}

func TestFormatFrames_EmptyFrames(t *testing.T) {
	out := FormatFrames([]*data.Frame{}, FormatOptions{QueryType: QueryTypeLogs})
	assert.Empty(t, out)
}

// ---------------------------------------------------------------------------
// ResolveQueryType additional tests
// ---------------------------------------------------------------------------

func TestResolveQueryType_BuilderOptions(t *testing.T) {
	// Directly set BuilderOptions.QueryType with no EditorType (non-SQL path).
	model := QueryModel{
		BuilderOptions: &BuilderOptions{QueryType: QueryTypeTimeSeries},
	}
	assert.Equal(t, QueryTypeTimeSeries, ResolveQueryType(model))
}

func TestIsTraceDetailQuery(t *testing.T) {
	// RefID = "Trace ID" → true
	assert.True(t, IsTraceDetailQuery(QueryModel{RefID: "Trace ID"}))

	// RefID = "A" with no meta → false
	assert.False(t, IsTraceDetailQuery(QueryModel{RefID: "A"}))

	// BuilderOptions with QueryType=traces and Meta.IsTraceIdMode=true → true
	model := QueryModel{
		BuilderOptions: &BuilderOptions{
			QueryType: QueryTypeTraces,
			Meta:      &BuilderOptionsMeta{IsTraceIdMode: true},
		},
	}
	assert.True(t, IsTraceDetailQuery(model))
}

// ---------------------------------------------------------------------------
// LongToMultiFrame edge cases
// ---------------------------------------------------------------------------

func TestLongToMultiFrame_MultiMetricMultiLabel(t *testing.T) {
	frame := data.NewFrame("A",
		data.NewField("time", nil, []time.Time{
			time.UnixMilli(1000), time.UnixMilli(1000),
			time.UnixMilli(2000), time.UnixMilli(2000),
		}),
		data.NewField("host", nil, []*string{str("h1"), str("h2"), str("h1"), str("h2")}),
		data.NewField("region", nil, []*string{str("us-east"), str("eu-west"), str("us-east"), str("eu-west")}),
		data.NewField("cpu", nil, []*float64{f64(1.1), f64(2.1), f64(3.1), f64(4.1)}),
		data.NewField("mem", nil, []*float64{f64(10), f64(20), f64(30), f64(40)}),
	)
	frame.RefID = "A"

	out := LongToMultiFrame(frame)
	require.Len(t, out, 4)

	// Index frames by (metric, host, region).
	type key struct{ metric, host, region string }
	got := map[key]*data.Frame{}
	for _, f := range out {
		k := key{
			metric: f.Name,
			host:   f.Fields[1].Labels["host"],
			region: f.Fields[1].Labels["region"],
		}
		got[k] = f
	}

	// cpu, host=h1, region=us-east
	f := got[key{"cpu", "h1", "us-east"}]
	require.NotNil(t, f)
	assert.Equal(t, 1.1, *f.Fields[1].At(0).(*float64))
	assert.Equal(t, 3.1, *f.Fields[1].At(1).(*float64))

	// cpu, host=h2, region=eu-west
	f = got[key{"cpu", "h2", "eu-west"}]
	require.NotNil(t, f)
	assert.Equal(t, 2.1, *f.Fields[1].At(0).(*float64))
	assert.Equal(t, 4.1, *f.Fields[1].At(1).(*float64))

	// mem, host=h1, region=us-east
	f = got[key{"mem", "h1", "us-east"}]
	require.NotNil(t, f)
	assert.Equal(t, 10.0, *f.Fields[1].At(0).(*float64))
	assert.Equal(t, 30.0, *f.Fields[1].At(1).(*float64))

	// mem, host=h2, region=eu-west
	f = got[key{"mem", "h2", "eu-west"}]
	require.NotNil(t, f)
	assert.Equal(t, 20.0, *f.Fields[1].At(0).(*float64))
	assert.Equal(t, 40.0, *f.Fields[1].At(1).(*float64))
}

func TestLongToMultiFrame_SingleRow(t *testing.T) {
	frame := data.NewFrame("A",
		data.NewField("time", nil, []time.Time{time.UnixMilli(1000)}),
		data.NewField("host", nil, []*string{str("h1")}),
		data.NewField("val", nil, []*float64{f64(42)}),
	)
	frame.RefID = "A"

	out := LongToMultiFrame(frame)
	require.Len(t, out, 1)
	assert.Equal(t, "val", out[0].Name)
	assert.Equal(t, 1, out[0].Rows())
	assert.Equal(t, 42.0, *out[0].Fields[1].At(0).(*float64))
}

func TestLongToMultiFrame_NullLabels(t *testing.T) {
	frame := data.NewFrame("A",
		data.NewField("time", nil, []time.Time{time.UnixMilli(1000), time.UnixMilli(2000)}),
		data.NewField("host", nil, []*string{str("a"), nil}),  // second row has null label
		data.NewField("val", nil, []*float64{f64(1), f64(2)}),
	)
	frame.RefID = "A"

	out := LongToMultiFrame(frame)
	// Two distinct label keys: "host=a" and "host="  →  2 frames.
	require.Len(t, out, 2)

	// Row with null label is placed in a valid bucket (no panic).
	labels := make([]data.Labels, 2)
	for i, f := range out {
		labels[i] = f.Fields[1].Labels
	}
	assert.Contains(t, labels, data.Labels{"host": "a"})
	assert.Contains(t, labels, data.Labels{"host": ""})
}

// ---------------------------------------------------------------------------
// TransformLogsFrame additional tests
// ---------------------------------------------------------------------------

func TestTransformLogsFrame_NilFrame(t *testing.T) {
	out := TransformLogsFrame(nil, []string{"hostname"})
	assert.Nil(t, out)
}

func TestTransformLogsFrame_NoContextColumns(t *testing.T) {
	frame := data.NewFrame("A",
		data.NewField("timestamp", nil, []time.Time{time.UnixMilli(1000)}),
		data.NewField("body", nil, []*string{str("hello")}),
		data.NewField("level", nil, []*string{str("info")}),
		data.NewField("service", nil, []*string{str("api")}),
	)
	frame.RefID = "A"

	out := TransformLogsFrame(frame, []string{})
	require.NotNil(t, out)

	names := make([]string, len(out.Fields))
	for i, f := range out.Fields {
		names[i] = f.Name
	}
	// "service" is a string field outside timestamp/body/level → goes into labels.
	assert.Equal(t, []string{"timestamp", "body", "severity", "labels"}, names)

	var labels map[string]any
	require.NoError(t, json.Unmarshal(out.Fields[3].At(0).(json.RawMessage), &labels))
	assert.Equal(t, "api", labels["service"])
}

func TestTransformLogsFrame_ContextColumns(t *testing.T) {
	frame := data.NewFrame("A",
		data.NewField("timestamp", nil, []time.Time{time.UnixMilli(1000), time.UnixMilli(2000)}),
		data.NewField("body", nil, []*string{str("hello"), str("world")}),
		data.NewField("level", nil, []*string{str("info"), str("error")}),
		data.NewField("service", nil, []*string{str("api"), str("api")}),
		data.NewField("hostname", nil, []*string{str("h1"), str("h2")}),
	)
	frame.RefID = "A"

	out := TransformLogsFrame(frame, []string{"hostname"})
	require.NotNil(t, out)

	names := make([]string, len(out.Fields))
	for i, f := range out.Fields {
		names[i] = f.Name
	}
	// hostname is a context column → separate field AND in labels.
	// service is only in labels.
	assert.Equal(t, []string{"timestamp", "body", "severity", "hostname", "labels"}, names)

	// Row 0
	var labels map[string]any
	require.NoError(t, json.Unmarshal(out.Fields[4].At(0).(json.RawMessage), &labels))
	assert.Equal(t, "api", labels["service"])
	assert.Equal(t, "h1", labels["hostname"])
	assert.Equal(t, "h1", *out.Fields[3].At(0).(*string))

	// Row 1
	require.NoError(t, json.Unmarshal(out.Fields[4].At(1).(json.RawMessage), &labels))
	assert.Equal(t, "api", labels["service"])
	assert.Equal(t, "h2", labels["hostname"])
	assert.Equal(t, "h2", *out.Fields[3].At(1).(*string))
}
