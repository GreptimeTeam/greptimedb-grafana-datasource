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
