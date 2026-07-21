package greptime

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/data"
)

// Log column aliases produced by sqlGenerator (logColumnHintsToAlias).
const (
	logAliasTimestamp = "timestamp"
	logAliasBody      = "body"
	logAliasLevel     = "level"
)

// TransformLogsFrame converts a long backend DataFrame into a LogLines frame.
// Mirrors src/greptimedb transformDataFrameToLogs.
func TransformLogsFrame(frame *data.Frame, contextColumns []string) *data.Frame {
	if frame == nil || len(frame.Fields) == 0 || frame.Rows() == 0 {
		return nil
	}

	fieldByName := map[string]*data.Field{}
	for _, f := range frame.Fields {
		fieldByName[strings.ToLower(f.Name)] = f
	}

	timestampField := fieldByName[logAliasTimestamp]
	bodyField := fieldByName[logAliasBody]
	severityField := fieldByName[logAliasLevel]

	contextSet := map[string]bool{}
	for _, c := range contextColumns {
		contextSet[c] = true
	}

	var labelFields []*data.Field
	var contextFields []*data.Field
	for _, f := range frame.Fields {
		lower := strings.ToLower(f.Name)
		if lower == logAliasTimestamp || lower == logAliasBody || lower == logAliasLevel {
			continue
		}
		if contextSet[f.Name] {
			contextFields = append(contextFields, f)
			continue
		}
		if f.Type() == data.FieldTypeString || f.Type() == data.FieldTypeNullableString {
			labelFields = append(labelFields, f)
		}
	}

	rowCount := frame.Rows()
	timestamps := make([]time.Time, rowCount)
	bodies := make([]*string, rowCount)
	var severities []*string
	if severityField != nil {
		severities = make([]*string, rowCount)
	}
	labelsJSON := make([]json.RawMessage, rowCount)
	contextValues := map[string][]*string{}
	for _, cf := range contextFields {
		contextValues[cf.Name] = make([]*string, rowCount)
	}

	for row := 0; row < rowCount; row++ {
		timestamps[row] = timeAt(timestampField, row)

		if bodyField != nil {
			s := stringAt(bodyField, row)
			bodies[row] = &s
		} else {
			empty := ""
			bodies[row] = &empty
		}

		if severityField != nil {
			s := stringAt(severityField, row)
			severities[row] = &s
		}

		labels := map[string]any{}
		for _, lf := range labelFields {
			labels[lf.Name] = stringAt(lf, row)
		}
		for _, cf := range contextFields {
			s := stringAt(cf, row)
			contextValues[cf.Name][row] = &s
			labels[cf.Name] = s
		}
		raw, _ := json.Marshal(labels)
		labelsJSON[row] = raw
	}

	fields := []*data.Field{
		data.NewField(logAliasTimestamp, nil, timestamps),
		data.NewField(logAliasBody, nil, bodies),
	}
	for _, f := range fields {
		f.SetConfig(&data.FieldConfig{})
	}

	if severityField != nil {
		sev := data.NewField("severity", nil, severities)
		sev.SetConfig(&data.FieldConfig{})
		fields = append(fields, sev)
	}

	for _, cf := range contextFields {
		f := data.NewField(cf.Name, nil, contextValues[cf.Name])
		f.SetConfig(&data.FieldConfig{})
		fields = append(fields, f)
	}

	labelsField := data.NewField("labels", nil, labelsJSON)
	labelsField.SetConfig(&data.FieldConfig{})
	fields = append(fields, labelsField)

	out := data.NewFrame(frame.Name, fields...)
	out.RefID = frame.RefID
	out.Meta = &data.FrameMeta{
		PreferredVisualization: data.VisTypeLogs,
		Type:                   data.FrameTypeLogLines,
	}
	return out
}
