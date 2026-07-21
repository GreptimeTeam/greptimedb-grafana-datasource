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
