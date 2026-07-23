package plugin

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// makeMockServer creates an httptest.Server that returns the given response body and status code.
// It also captures the last SQL received via form-encoded POST body.
func makeMockServer(responseBody string, statusCode int) (*httptest.Server, *string) {
	var capturedSQL string
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(r.Body)
		if err == nil {
			if vals, parseErr := url.ParseQuery(string(body)); parseErr == nil {
				capturedSQL = vals.Get("sql")
			}
		}
		w.WriteHeader(statusCode)
		_, _ = w.Write([]byte(responseBody))
	}))
	return ts, &capturedSQL
}

// makeDataQuery builds a backend.DataQuery for testing.
func makeDataQuery(refID, rawSQL, editorType, queryType string, extraFields map[string]any) backend.DataQuery {
	q := map[string]any{
		"rawSql":     rawSQL,
		"editorType": editorType,
		"queryType":  queryType,
	}
	for k, v := range extraFields {
		q[k] = v
	}
	raw, _ := json.Marshal(q)

	return backend.DataQuery{
		RefID: refID,
		JSON:  raw,
		TimeRange: backend.TimeRange{
			From: time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC),
			To:   time.Date(2024, 1, 2, 0, 0, 0, 0, time.UTC),
		},
		Interval: 60 * time.Second,
		MaxDataPoints: 1000,
	}
}

// TestQueryData_TimeSeries_DateBin_GroupBy verifies time-series multi-frame output
// with date_bin and GROUP BY, and that macros are expanded.
func TestQueryData_TimeSeries_DateBin_GroupBy(t *testing.T) {
	responseJSON := `{
		"code": 0,
		"output": [{
			"records": {
				"schema": {
					"column_schemas": [
						{"name": "time", "data_type": "TimestampMillisecond"},
						{"name": "host", "data_type": "String"},
						{"name": "avg_cpu", "data_type": "Float64"}
					]
				},
				"rows": [
					[1700000000000, "host-a", 72.5],
					[1700000060000, "host-a", 73.1],
					[1700000000000, "host-b", 45.0],
					[1700000060000, "host-b", 46.2]
				]
			}
		}]
	}`

	ts, capturedSQL := makeMockServer(responseJSON, http.StatusOK)
	defer ts.Close()

	ds := &GreptimeDatasource{
		settings: Settings{
			Host:            ts.URL,
			DefaultDatabase: "public",
		},
	}

	req := &backend.QueryDataRequest{
		Queries: []backend.DataQuery{
			makeDataQuery("A",
				`SELECT date_bin('$__interval', ts) AS time, host, avg(cpu) as avg_cpu FROM cpu WHERE $__timeFilter(ts) GROUP BY time, host ORDER BY time`,
				"sql", "timeseries", nil,
			),
		},
	}

	resp, err := ds.QueryData(context.Background(), req)
	require.NoError(t, err)

	dr, ok := resp.Responses["A"]
	require.True(t, ok, "response must contain ref A")
	assert.NoError(t, dr.Error)

	// Should produce multi-frame time series (split by host, each with avg_cpu).
	require.NotEmpty(t, dr.Frames, "frames should not be empty after time-series formatting")
	for _, f := range dr.Frames {
		assert.NotNil(t, f)
	}

	// Verify macros were expanded in the SQL sent to the mock.
	sqlSent := *capturedSQL
	assert.NotContains(t, sqlSent, "$__fromTime", "macros should be expanded")
	assert.NotContains(t, sqlSent, "$__timeFilter", "macros should be expanded")
	assert.NotContains(t, sqlSent, "$__interval", "macros should be expanded")
}

// TestQueryData_Logs verifies log query type produces LogLines frames with severity mapping.
func TestQueryData_Logs(t *testing.T) {
	responseJSON := `{
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
					[1700000000000, "request completed", "info", "api-gateway"],
					[1700000060000, "timeout error", "error", "db-proxy"]
				]
			}
		}]
	}`

	ts, _ := makeMockServer(responseJSON, http.StatusOK)
	defer ts.Close()

	ds := &GreptimeDatasource{
		settings: Settings{
			Host:            ts.URL,
			DefaultDatabase: "public",
		},
	}

	req := &backend.QueryDataRequest{
		Queries: []backend.DataQuery{
			makeDataQuery("A",
				`SELECT timestamp, body, level, service FROM app_logs WHERE $__timeFilter(timestamp) ORDER BY timestamp DESC LIMIT 100`,
				"sql", "logs", nil,
			),
		},
	}

	resp, err := ds.QueryData(context.Background(), req)
	require.NoError(t, err)

	dr, ok := resp.Responses["A"]
	require.True(t, ok)
	assert.NoError(t, dr.Error)

	// Logs formatting produces a single log-line frame.
	require.NotEmpty(t, dr.Frames, "frames should not be empty for logs query")
	frame := dr.Frames[0]
	require.NotNil(t, frame)

	// Verify PreferredVisualization is logs.
	require.NotNil(t, frame.Meta, "frame meta should be set")
	assert.Equal(t, data.VisType("logs"), frame.Meta.PreferredVisualization)

	// Verify "severity" field exists (mapped from "level").
	hasSeverity := false
	hasLevel := false
	for _, f := range frame.Fields {
		if f.Name == "severity" {
			hasSeverity = true
		}
		if f.Name == "level" {
			hasLevel = true
		}
	}
	assert.True(t, hasSeverity, "logs frame should have severity field (mapped from level)")
	assert.False(t, hasLevel, "logs frame should not contain original level field")
}

// TestQueryData_Traces verifies trace detail query type produces Grafana Trace panel fields.
func TestQueryData_Traces(t *testing.T) {
	responseJSON := `{
		"code": 0,
		"output": [{
			"records": {
				"schema": {
					"column_schemas": [
						{"name": "traceID", "data_type": "String"},
						{"name": "spanID", "data_type": "String"},
						{"name": "parentSpanID", "data_type": "String"},
						{"name": "serviceName", "data_type": "String"},
						{"name": "operationName", "data_type": "String"},
						{"name": "startTime", "data_type": "TimestampMillisecond"},
						{"name": "duration", "data_type": "Float64"},
						{"name": "span_attributes.gen_ai.system", "data_type": "String"}
					]
				},
				"rows": [
					["trace-1", "span-1", "", "my-service", "root", 1700000000000, 12.5, "openai"],
					["trace-1", "span-2", "span-1", "my-service", "child", 1700000000050, 3.2, "openai"]
				]
			}
		}]
	}`

	ts, _ := makeMockServer(responseJSON, http.StatusOK)
	defer ts.Close()

	ds := &GreptimeDatasource{
		settings: Settings{
			Host:            ts.URL,
			DefaultDatabase: "public",
		},
	}

	// RefID "Trace ID" triggers trace detail mode, so IsTraceDetailQuery returns true.
	traceColumns := []map[string]any{
		{"name": "traceID", "hint": "trace_id"},
		{"name": "spanID", "hint": "trace_span_id"},
		{"name": "parentSpanID", "hint": "trace_parent_span_id"},
		{"name": "serviceName", "hint": "trace_service_name"},
		{"name": "operationName", "hint": "trace_operation_name"},
		{"name": "startTime", "hint": "time"},
		{"name": "duration", "hint": "trace_duration_time"},
	}

	extraFields := map[string]any{
		"meta": map[string]any{
			"builderOptions": map[string]any{
				"queryType": "traces",
				"columns":   traceColumns,
				"meta": map[string]any{
					"isTraceIdMode":     true,
					"traceDurationUnit": "milliseconds",
				},
			},
		},
	}

	req := &backend.QueryDataRequest{
		Queries: []backend.DataQuery{
			makeDataQuery("Trace ID",
				`SELECT traceID, spanID, parentSpanID, serviceName, operationName, startTime, duration, span_attributes.gen_ai.system FROM traces WHERE trace_id = 'xxx'`,
				"sql", "traces", extraFields,
			),
		},
	}

	resp, err := ds.QueryData(context.Background(), req)
	require.NoError(t, err)

	dr, ok := resp.Responses["Trace ID"]
	require.True(t, ok)
	assert.NoError(t, dr.Error)

	require.NotEmpty(t, dr.Frames, "frames should not be empty for trace query")
	frame := dr.Frames[0]
	require.NotNil(t, frame)

	// Verify PreferredVisualization is trace.
	require.NotNil(t, frame.Meta, "frame meta should be set")
	assert.Equal(t, data.VisType("trace"), frame.Meta.PreferredVisualization)

	// Verify core trace fields exist.
	expectedTraceFields := []string{"traceID", "spanID", "parentSpanID", "serviceName", "operationName", "startTime", "duration", "tags", "serviceTags"}
	fieldNames := make(map[string]bool)
	for _, f := range frame.Fields {
		fieldNames[f.Name] = true
	}
	for _, name := range expectedTraceFields {
		assert.True(t, fieldNames[name], "trace frame should have field %q", name)
	}
}

// TestQueryData_Table verifies that a plain SQL query (no query type) returns frames as-is.
func TestQueryData_Table(t *testing.T) {
	responseJSON := `{
		"code": 0,
		"output": [{
			"records": {
				"schema": {
					"column_schemas": [
						{"name": "id", "data_type": "Int32"},
						{"name": "name", "data_type": "String"},
						{"name": "value", "data_type": "Float64"}
					]
				},
				"rows": [
					[1, "alpha", 10.5],
					[2, "beta", 20.3]
				]
			}
		}]
	}`

	ts, _ := makeMockServer(responseJSON, http.StatusOK)
	defer ts.Close()

	ds := &GreptimeDatasource{
		settings: Settings{
			Host:            ts.URL,
			DefaultDatabase: "public",
		},
	}

	req := &backend.QueryDataRequest{
		Queries: []backend.DataQuery{
			makeDataQuery("A", "SELECT id, name, value FROM metrics", "sql", "", nil),
		},
	}

	resp, err := ds.QueryData(context.Background(), req)
	require.NoError(t, err)

	dr, ok := resp.Responses["A"]
	require.True(t, ok)
	assert.NoError(t, dr.Error)

	require.NotEmpty(t, dr.Frames, "frames should not be empty for table query")
	frame := dr.Frames[0]
	require.NotNil(t, frame)

	// Table frames should be returned as a single long frame (not multi-frame, not logs).
	expectedColumns := []string{"id", "name", "value"}
	require.Len(t, frame.Fields, len(expectedColumns), "table frame should have 3 fields")
	for i, name := range expectedColumns {
		assert.Equal(t, name, frame.Fields[i].Name)
	}
	assert.Equal(t, 2, frame.Rows(), "table frame should have 2 rows")
}

// TestQueryData_EmptySQL verifies that an empty rawSql returns empty frames (no error).
func TestQueryData_EmptySQL(t *testing.T) {
	// No mock server needed — empty SQL short-circuits before any HTTP call.
	ds := &GreptimeDatasource{
		settings: Settings{
			Host:            "http://localhost:9999",
			DefaultDatabase: "public",
		},
	}

	req := &backend.QueryDataRequest{
		Queries: []backend.DataQuery{
			makeDataQuery("A", "", "sql", "table", nil),
		},
	}

	resp, err := ds.QueryData(context.Background(), req)
	require.NoError(t, err)

	dr, ok := resp.Responses["A"]
	require.True(t, ok)
	assert.NoError(t, dr.Error)
	assert.Empty(t, dr.Frames, "empty SQL should produce empty frames slice")
}

// TestQueryData_SQLError verifies that a GreptimeDB-level error is propagated.
func TestQueryData_SQLError(t *testing.T) {
	responseJSON := `{"code": 1, "error": "syntax error near LIMIT"}`

	ts, _ := makeMockServer(responseJSON, http.StatusOK)
	defer ts.Close()

	ds := &GreptimeDatasource{
		settings: Settings{
			Host:            ts.URL,
			DefaultDatabase: "public",
		},
	}

	req := &backend.QueryDataRequest{
		Queries: []backend.DataQuery{
			makeDataQuery("A", "SELECT bad SQL", "sql", "table", nil),
		},
	}

	resp, err := ds.QueryData(context.Background(), req)
	require.NoError(t, err)

	dr, ok := resp.Responses["A"]
	require.True(t, ok)
	assert.Error(t, dr.Error, "GreptimeDB error should produce a DataResponse error")
	assert.Contains(t, dr.Error.Error(), "syntax error near LIMIT")
}

// TestQueryData_HTTPError verifies that an HTTP-level error is propagated.
func TestQueryData_HTTPError(t *testing.T) {
	ts, _ := makeMockServer("Internal Server Error", http.StatusInternalServerError)
	defer ts.Close()

	ds := &GreptimeDatasource{
		settings: Settings{
			Host:            ts.URL,
			DefaultDatabase: "public",
		},
	}

	req := &backend.QueryDataRequest{
		Queries: []backend.DataQuery{
			makeDataQuery("A", "SELECT 1", "sql", "table", nil),
		},
	}

	resp, err := ds.QueryData(context.Background(), req)
	require.NoError(t, err)

	dr, ok := resp.Responses["A"]
	require.True(t, ok)
	assert.Error(t, dr.Error, "HTTP 500 should produce a DataResponse error")
	assert.Contains(t, dr.Error.Error(), "greptime http 500")
}
