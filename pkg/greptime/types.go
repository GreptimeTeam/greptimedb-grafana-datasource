package greptime

// Response mirrors GreptimeDB POST /v1/sql JSON (subset used by the plugin).
type Response struct {
	Code            int      `json:"code"`
	ExecutionTimeMs int64    `json:"execution_time_ms,omitempty"`
	Output          []Output `json:"output,omitempty"`
	Error           string   `json:"error,omitempty"`
}

type Output struct {
	Records Records `json:"records"`
}

type Records struct {
	Schema Schema  `json:"schema"`
	Rows   [][]any `json:"rows"`
}

type Schema struct {
	ColumnSchemas []ColumnSchema `json:"column_schemas"`
}

type ColumnSchema struct {
	Name     string `json:"name"`
	DataType string `json:"data_type"`
}
