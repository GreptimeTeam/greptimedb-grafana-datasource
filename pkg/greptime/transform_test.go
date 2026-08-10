package greptime

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/stretchr/testify/require"
)

func TestResponseToFrames_TimeSeries(t *testing.T) {
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
	require.Len(t, frames, 1)

	frame := frames[0]
	require.Equal(t, "A", frame.RefID)
	require.Len(t, frame.Fields, 3)
	require.Equal(t, data.FieldTypeTime, frame.Fields[0].Type())
	require.Equal(t, 2, frame.Fields[0].Len())

	ts := frame.Fields[0].At(0).(time.Time)
	require.Equal(t, time.UnixMilli(1700000000000), ts)
}

func TestResponseToFrames_Error(t *testing.T) {
	frames, err := ResponseToFrames(&Response{Error: "syntax error"}, "A")
	require.NoError(t, err)
	require.Len(t, frames, 1)
	require.Equal(t, "Error", frames[0].Fields[0].Name)
}

func TestResponseToFrames_JSONColumnAsString(t *testing.T) {
	raw := `{
		"code": 0,
		"output": [{
			"records": {
				"schema": {
					"column_schemas": [
						{"name": "finish_reason", "data_type": "Json"},
						{"name": "tags", "data_type": "Json"}
					]
				},
				"rows": [
					[["stop"], {"k": "v"}],
					[null, null]
				]
			}
		}]
	}`

	var response Response
	require.NoError(t, json.Unmarshal([]byte(raw), &response))

	frames, err := ResponseToFrames(&response, "A")
	require.NoError(t, err)
	require.Len(t, frames, 1)

	frame := frames[0]
	require.Equal(t, data.FieldTypeNullableString, frame.Fields[0].Type())
	require.Equal(t, data.FieldTypeNullableString, frame.Fields[1].Type())

	require.Equal(t, `["stop"]`, *frame.Fields[0].At(0).(*string))
	require.Equal(t, `{"k":"v"}`, *frame.Fields[1].At(0).(*string))
	require.Nil(t, frame.Fields[0].At(1))
}

func TestResponseToFrames_Logs(t *testing.T) {
	raw := `{
		"code": 0,
		"output": [{
			"records": {
				"schema": {
					"column_schemas": [
						{"name": "timestamp", "data_type": "TimestampMillisecond"},
						{"name": "body", "data_type": "String"},
						{"name": "level", "data_type": "String"},
						{"name": "service", "data_type": "String"}
					]
				},
				"rows": [
					[1700000000000, "request started", "info", "web"],
					[1700000001000, "request completed", "info", "db"]
				]
			}
		}]
	}`

	var response Response
	require.NoError(t, json.Unmarshal([]byte(raw), &response))

	frames, err := ResponseToFrames(&response, "A")
	require.NoError(t, err)
	require.Len(t, frames, 1)

	frame := frames[0]
	require.Len(t, frame.Fields, 4)

	// timestamp
	require.Equal(t, data.FieldTypeTime, frame.Fields[0].Type())
	require.Equal(t, "timestamp", frame.Fields[0].Name)
	require.Equal(t, 2, frame.Fields[0].Len())
	require.Equal(t, time.UnixMilli(1700000000000), frame.Fields[0].At(0).(time.Time))
	require.Equal(t, time.UnixMilli(1700000001000), frame.Fields[0].At(1).(time.Time))

	// body
	require.Equal(t, data.FieldTypeNullableString, frame.Fields[1].Type())
	require.Equal(t, "body", frame.Fields[1].Name)
	require.Equal(t, "request started", *frame.Fields[1].At(0).(*string))
	require.Equal(t, "request completed", *frame.Fields[1].At(1).(*string))

	// level
	require.Equal(t, data.FieldTypeNullableString, frame.Fields[2].Type())
	require.Equal(t, "level", frame.Fields[2].Name)
	require.Equal(t, "info", *frame.Fields[2].At(0).(*string))
	require.Equal(t, "info", *frame.Fields[2].At(1).(*string))

	// service
	require.Equal(t, data.FieldTypeNullableString, frame.Fields[3].Type())
	require.Equal(t, "service", frame.Fields[3].Name)
	require.Equal(t, "web", *frame.Fields[3].At(0).(*string))
	require.Equal(t, "db", *frame.Fields[3].At(1).(*string))
}

func TestResponseToFrames_Traces(t *testing.T) {
	raw := `{
		"code": 0,
		"output": [{
			"records": {
				"schema": {
					"column_schemas": [
						{"name": "trace_id", "data_type": "String"},
						{"name": "span_id", "data_type": "String"},
						{"name": "parent_span_id", "data_type": "String"},
						{"name": "service_name", "data_type": "String"},
						{"name": "span_name", "data_type": "String"},
						{"name": "timestamp", "data_type": "TimestampMillisecond"},
						{"name": "duration_nano", "data_type": "Float64"},
						{"name": "span_status_code", "data_type": "String"}
					]
				},
				"rows": [
					["abc123", "span1", "parent1", "service-a", "HTTP GET", 1700000000000, 1000000.5, "OK"],
					["def456", "span2", "parent2", "service-b", "DB Query", 1700000001000, 2000000.5, "ERROR"]
				]
			}
		}]
	}`

	var response Response
	require.NoError(t, json.Unmarshal([]byte(raw), &response))

	frames, err := ResponseToFrames(&response, "A")
	require.NoError(t, err)
	require.Len(t, frames, 1)

	frame := frames[0]
	require.Len(t, frame.Fields, 8)

	// trace_id (String -> NullableString)
	require.Equal(t, data.FieldTypeNullableString, frame.Fields[0].Type())
	require.Equal(t, "trace_id", frame.Fields[0].Name)
	require.Equal(t, "abc123", *frame.Fields[0].At(0).(*string))
	require.Equal(t, "def456", *frame.Fields[0].At(1).(*string))

	// span_id (String -> NullableString)
	require.Equal(t, data.FieldTypeNullableString, frame.Fields[1].Type())
	require.Equal(t, "span_id", frame.Fields[1].Name)
	require.Equal(t, "span1", *frame.Fields[1].At(0).(*string))
	require.Equal(t, "span2", *frame.Fields[1].At(1).(*string))

	// parent_span_id (String -> NullableString)
	require.Equal(t, data.FieldTypeNullableString, frame.Fields[2].Type())
	require.Equal(t, "parent_span_id", frame.Fields[2].Name)
	require.Equal(t, "parent1", *frame.Fields[2].At(0).(*string))
	require.Equal(t, "parent2", *frame.Fields[2].At(1).(*string))

	// service_name (String -> NullableString)
	require.Equal(t, data.FieldTypeNullableString, frame.Fields[3].Type())
	require.Equal(t, "service_name", frame.Fields[3].Name)
	require.Equal(t, "service-a", *frame.Fields[3].At(0).(*string))
	require.Equal(t, "service-b", *frame.Fields[3].At(1).(*string))

	// span_name (String -> NullableString)
	require.Equal(t, data.FieldTypeNullableString, frame.Fields[4].Type())
	require.Equal(t, "span_name", frame.Fields[4].Name)
	require.Equal(t, "HTTP GET", *frame.Fields[4].At(0).(*string))
	require.Equal(t, "DB Query", *frame.Fields[4].At(1).(*string))

	// timestamp (TimestampMillisecond -> Time)
	require.Equal(t, data.FieldTypeTime, frame.Fields[5].Type())
	require.Equal(t, "timestamp", frame.Fields[5].Name)
	require.Equal(t, time.UnixMilli(1700000000000), frame.Fields[5].At(0).(time.Time))
	require.Equal(t, time.UnixMilli(1700000001000), frame.Fields[5].At(1).(time.Time))

	// duration_nano (Float64 -> NullableFloat64)
	require.Equal(t, data.FieldTypeNullableFloat64, frame.Fields[6].Type())
	require.Equal(t, "duration_nano", frame.Fields[6].Name)
	require.Equal(t, 1000000.5, *frame.Fields[6].At(0).(*float64))
	require.Equal(t, 2000000.5, *frame.Fields[6].At(1).(*float64))

	// span_status_code (String -> NullableString)
	require.Equal(t, data.FieldTypeNullableString, frame.Fields[7].Type())
	require.Equal(t, "span_status_code", frame.Fields[7].Name)
	require.Equal(t, "OK", *frame.Fields[7].At(0).(*string))
	require.Equal(t, "ERROR", *frame.Fields[7].At(1).(*string))
}

func TestResponseToFrames_MultiOutput(t *testing.T) {
	raw := `{
		"code": 0,
		"output": [
			{
				"records": {
					"schema": {
						"column_schemas": [
							{"name": "value", "data_type": "Float64"}
						]
					},
					"rows": [[1.0]]
				}
			},
			{
				"records": {
					"schema": {
						"column_schemas": [
							{"name": "name", "data_type": "String"}
						]
					},
					"rows": [["hello"]]
				}
			}
		]
	}`

	var response Response
	require.NoError(t, json.Unmarshal([]byte(raw), &response))

	frames, err := ResponseToFrames(&response, "A")
	require.NoError(t, err)
	require.Len(t, frames, 2)

	// First frame
	require.Equal(t, "Result 1", frames[0].Name)
	require.Len(t, frames[0].Fields, 1)
	require.Equal(t, data.FieldTypeNullableFloat64, frames[0].Fields[0].Type())
	require.Equal(t, "value", frames[0].Fields[0].Name)
	require.Equal(t, 1.0, *frames[0].Fields[0].At(0).(*float64))

	// Second frame
	require.Equal(t, "Result 2", frames[1].Name)
	require.Len(t, frames[1].Fields, 1)
	require.Equal(t, data.FieldTypeNullableString, frames[1].Fields[0].Type())
	require.Equal(t, "name", frames[1].Fields[0].Name)
	require.Equal(t, "hello", *frames[1].Fields[0].At(0).(*string))
}

func TestResponseToFrames_EmptyRows(t *testing.T) {
	raw := `{
		"code": 0,
		"output": [{
			"records": {
				"schema": {
					"column_schemas": [
						{"name": "col1", "data_type": "String"},
						{"name": "col2", "data_type": "Float64"}
					]
				},
				"rows": []
			}
		}]
	}`

	var response Response
	require.NoError(t, json.Unmarshal([]byte(raw), &response))

	frames, err := ResponseToFrames(&response, "A")
	require.NoError(t, err)
	require.Len(t, frames, 1)

	frame := frames[0]
	require.Len(t, frame.Fields, 2)
	require.Equal(t, 0, frame.Fields[0].Len())
	require.Equal(t, 0, frame.Fields[1].Len())
}

func TestResponseToFrames_BoolType(t *testing.T) {
	raw := `{
		"code": 0,
		"output": [{
			"records": {
				"schema": {
					"column_schemas": [
						{"name": "active", "data_type": "Boolean"}
					]
				},
				"rows": [
					[true],
					[false],
					[null]
				]
			}
		}]
	}`

	var response Response
	require.NoError(t, json.Unmarshal([]byte(raw), &response))

	frames, err := ResponseToFrames(&response, "A")
	require.NoError(t, err)
	require.Len(t, frames, 1)

	frame := frames[0]
	require.Len(t, frame.Fields, 1)
	require.Equal(t, data.FieldTypeNullableBool, frame.Fields[0].Type())
	require.Equal(t, "active", frame.Fields[0].Name)
	require.Equal(t, 3, frame.Fields[0].Len())

	require.True(t, *frame.Fields[0].At(0).(*bool))
	require.False(t, *frame.Fields[0].At(1).(*bool))
	require.Nil(t, frame.Fields[0].At(2))
}

func TestResponseToFrames_MultiLabelTimeSeries(t *testing.T) {
	raw := `{
		"code": 0,
		"output": [{
			"records": {
				"schema": {
					"column_schemas": [
						{"name": "time", "data_type": "TimestampMillisecond"},
						{"name": "host", "data_type": "String"},
						{"name": "region", "data_type": "String"},
						{"name": "cpu", "data_type": "Float64"}
					]
				},
				"rows": [
					[1700000000000, "host1", "us-east", 0.5],
					[1700000000000, "host2", "us-east", 0.6],
					[1700000060000, "host1", "us-east", 0.7],
					[1700000060000, "host2", "us-east", 0.8]
				]
			}
		}]
	}`

	var response Response
	require.NoError(t, json.Unmarshal([]byte(raw), &response))

	frames, err := ResponseToFrames(&response, "A")
	require.NoError(t, err)
	require.Len(t, frames, 1)

	frame := frames[0]
	require.Len(t, frame.Fields, 4)

	// time
	require.Equal(t, data.FieldTypeTime, frame.Fields[0].Type())
	require.Equal(t, "time", frame.Fields[0].Name)
	require.Equal(t, 4, frame.Fields[0].Len())
	require.Equal(t, time.UnixMilli(1700000000000), frame.Fields[0].At(0).(time.Time))
	require.Equal(t, time.UnixMilli(1700000000000), frame.Fields[0].At(1).(time.Time))
	require.Equal(t, time.UnixMilli(1700000060000), frame.Fields[0].At(2).(time.Time))
	require.Equal(t, time.UnixMilli(1700000060000), frame.Fields[0].At(3).(time.Time))

	// host
	require.Equal(t, data.FieldTypeNullableString, frame.Fields[1].Type())
	require.Equal(t, "host", frame.Fields[1].Name)
	require.Equal(t, "host1", *frame.Fields[1].At(0).(*string))
	require.Equal(t, "host2", *frame.Fields[1].At(1).(*string))
	require.Equal(t, "host1", *frame.Fields[1].At(2).(*string))
	require.Equal(t, "host2", *frame.Fields[1].At(3).(*string))

	// region
	require.Equal(t, data.FieldTypeNullableString, frame.Fields[2].Type())
	require.Equal(t, "region", frame.Fields[2].Name)
	require.Equal(t, "us-east", *frame.Fields[2].At(0).(*string))
	require.Equal(t, "us-east", *frame.Fields[2].At(1).(*string))
	require.Equal(t, "us-east", *frame.Fields[2].At(2).(*string))
	require.Equal(t, "us-east", *frame.Fields[2].At(3).(*string))

	// cpu
	require.Equal(t, data.FieldTypeNullableFloat64, frame.Fields[3].Type())
	require.Equal(t, "cpu", frame.Fields[3].Name)
	require.Equal(t, 0.5, *frame.Fields[3].At(0).(*float64))
	require.Equal(t, 0.6, *frame.Fields[3].At(1).(*float64))
	require.Equal(t, 0.7, *frame.Fields[3].At(2).(*float64))
	require.Equal(t, 0.8, *frame.Fields[3].At(3).(*float64))
}

func TestResponseToFrames_IntTypes(t *testing.T) {
	raw := `{
		"code": 0,
		"output": [{
			"records": {
				"schema": {
					"column_schemas": [
						{"name": "value", "data_type": "Int64"},
						{"name": "count", "data_type": "UInt64"}
					]
				},
				"rows": [
					[42, 100],
					[-7, 200],
					[0, 300]
				]
			}
		}]
	}`

	var response Response
	require.NoError(t, json.Unmarshal([]byte(raw), &response))

	frames, err := ResponseToFrames(&response, "A")
	require.NoError(t, err)
	require.Len(t, frames, 1)

	frame := frames[0]
	require.Len(t, frame.Fields, 2)

	// value (Int64 -> Float64)
	require.Equal(t, data.FieldTypeNullableFloat64, frame.Fields[0].Type())
	require.Equal(t, "value", frame.Fields[0].Name)
	require.Equal(t, 3, frame.Fields[0].Len())
	require.Equal(t, float64(42), *frame.Fields[0].At(0).(*float64))
	require.Equal(t, float64(-7), *frame.Fields[0].At(1).(*float64))
	require.Equal(t, float64(0), *frame.Fields[0].At(2).(*float64))

	// count (UInt64 -> Float64)
	require.Equal(t, data.FieldTypeNullableFloat64, frame.Fields[1].Type())
	require.Equal(t, "count", frame.Fields[1].Name)
	require.Equal(t, 3, frame.Fields[1].Len())
	require.Equal(t, float64(100), *frame.Fields[1].At(0).(*float64))
	require.Equal(t, float64(200), *frame.Fields[1].At(1).(*float64))
	require.Equal(t, float64(300), *frame.Fields[1].At(2).(*float64))
}
