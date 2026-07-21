package greptime

import (
	"encoding/json"
	"strings"
)

// Query types mirrored from src/types/queryBuilder.ts QueryType.
const (
	QueryTypeTable      = "table"
	QueryTypeLogs       = "logs"
	QueryTypeTimeSeries = "timeseries"
	QueryTypeTraces     = "traces"
)

// QueryModel is the subset of CHQuery JSON needed for response formatting.
type QueryModel struct {
	RawSQL         string          `json:"rawSql"`
	EditorType     string          `json:"editorType,omitempty"`
	QueryType      string          `json:"queryType,omitempty"`
	Format         json.RawMessage `json:"format,omitempty"`
	RefID          string          `json:"-"` // set from backend.DataQuery.RefID
	BuilderOptions *BuilderOptions `json:"builderOptions,omitempty"`
	Meta           *QueryMeta      `json:"meta,omitempty"`
}

type QueryMeta struct {
	BuilderOptions *BuilderOptions `json:"builderOptions,omitempty"`
}

type BuilderOptions struct {
	QueryType string             `json:"queryType,omitempty"`
	Meta      *BuilderOptionsMeta `json:"meta,omitempty"`
}

type BuilderOptionsMeta struct {
	IsTraceIdMode bool   `json:"isTraceIdMode,omitempty"`
	TraceId       string `json:"traceId,omitempty"`
}

// FormatOptions controls post-processing after ResponseToFrames.
type FormatOptions struct {
	QueryType      string
	ContextColumns []string
	TraceDetail    bool // Trace ID waterfall (vs traces search table)
}

// ResolveQueryType mirrors frontend transformBackendFrame query-type resolution.
func ResolveQueryType(model QueryModel) string {
	if model.RefID == "Trace ID" {
		return QueryTypeTraces
	}

	builderOpts := model.BuilderOptions
	if strings.EqualFold(model.EditorType, "sql") && model.Meta != nil && model.Meta.BuilderOptions != nil {
		builderOpts = model.Meta.BuilderOptions
	}

	if builderOpts != nil && builderOpts.QueryType != "" {
		return builderOpts.QueryType
	}
	if model.QueryType != "" {
		return model.QueryType
	}
	return QueryTypeTable
}

// IsTraceDetailQuery is true for Trace ID waterfall lookups.
func IsTraceDetailQuery(model QueryModel) bool {
	if model.RefID == "Trace ID" {
		return true
	}
	builderOpts := model.BuilderOptions
	if strings.EqualFold(model.EditorType, "sql") && model.Meta != nil && model.Meta.BuilderOptions != nil {
		builderOpts = model.Meta.BuilderOptions
	}
	if builderOpts == nil || builderOpts.Meta == nil {
		return false
	}
	return ResolveQueryType(model) == QueryTypeTraces && builderOpts.Meta.IsTraceIdMode
}
