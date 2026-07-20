package greptime

import (
	"fmt"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/data"
)

func mapGreptimeTypeToGrafana(greptimeType string) data.FieldType {
	if greptimeType == "" {
		return data.FieldTypeUnknown
	}

	lower := strings.ToLower(greptimeType)
	switch {
	case strings.Contains(lower, "timestamp"), strings.Contains(lower, "datetime"), lower == "date":
		return data.FieldTypeTime
	case strings.Contains(lower, "int"), strings.Contains(lower, "float"), strings.Contains(lower, "double"),
		strings.Contains(lower, "decimal"), strings.Contains(lower, "numeric"):
		return data.FieldTypeFloat64
	case strings.Contains(lower, "bool"):
		return data.FieldTypeBool
	case strings.Contains(lower, "string"), strings.Contains(lower, "varchar"), strings.Contains(lower, "text"),
		strings.Contains(lower, "binary"):
		return data.FieldTypeString
	default:
		return data.FieldTypeUnknown
	}
}

func toMilliseconds(value any, greptimeType string) (int64, bool) {
	num, ok := toFloat64(value)
	if !ok {
		return 0, false
	}

	lower := strings.ToLower(greptimeType)
	switch {
	case lower == "date":
		return int64(num * 86400000), true
	case strings.Contains(lower, "timestampsecond"):
		return int64(num * 1000), true
	case strings.Contains(lower, "timestampmillisecond"):
		return int64(num), true
	case strings.Contains(lower, "timestampmicrosecond"):
		return int64(num / 1000), true
	case strings.Contains(lower, "timestampnanosecond"):
		return int64(num / 1000000), true
	default:
		return int64(num), true
	}
}

func toFloat64(value any) (float64, bool) {
	switch v := value.(type) {
	case nil:
		return 0, false
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int32:
		return float64(v), true
	case int64:
		return float64(v), true
	case uint:
		return float64(v), true
	case uint32:
		return float64(v), true
	case uint64:
		return float64(v), true
	default:
		return 0, false
	}
}

// ResponseToFrames converts Greptime /v1/sql JSON to long-format Grafana DataFrames.
func ResponseToFrames(response *Response, refID string) ([]*data.Frame, error) {
	if response == nil {
		return nil, fmt.Errorf("empty greptime response")
	}

	if len(response.Output) == 0 {
		if response.Error != "" {
			return errorFrame(refID, response.Error), nil
		}
		return []*data.Frame{}, nil
	}

	frames := make([]*data.Frame, 0, len(response.Output))
	for i, resultSet := range response.Output {
		columnSchemas := resultSet.Records.Schema.ColumnSchemas
		rows := resultSet.Records.Rows
		numCols := len(columnSchemas)
		numRows := len(rows)

		frameName := fmt.Sprintf("Result %d", i+1)
		if numCols == 0 {
			frame := data.NewFrame(frameName)
			frame.RefID = refID
			frames = append(frames, frame)
			continue
		}

		columnValues := make([][]any, numCols)
		for colIndex := range columnValues {
			columnValues[colIndex] = make([]any, numRows)
		}

		for rowIndex, row := range rows {
			if len(row) != numCols {
				continue
			}
			for colIndex, cell := range row {
				colSchema := columnSchemas[colIndex]
				fieldType := mapGreptimeTypeToGrafana(colSchema.DataType)
				if fieldType == data.FieldTypeTime {
					if ms, ok := toMilliseconds(cell, colSchema.DataType); ok {
						columnValues[colIndex][rowIndex] = time.UnixMilli(ms)
						continue
					}
				}
				columnValues[colIndex][rowIndex] = cell
			}
		}

		fields := make([]*data.Field, numCols)
		for colIndex, colSchema := range columnSchemas {
			fieldName := colSchema.Name
			if fieldName == "" {
				fieldName = fmt.Sprintf("column_%d", colIndex+1)
			}
			fieldType := mapGreptimeTypeToGrafana(colSchema.DataType)
			fields[colIndex] = newField(fieldName, fieldType, columnValues[colIndex])
			fields[colIndex].SetConfig(&data.FieldConfig{})
		}

		frame := data.NewFrame(frameName, fields...)
		frame.RefID = refID
		frames = append(frames, frame)
	}

	return frames, nil
}

func newField(name string, fieldType data.FieldType, values []any) *data.Field {
	switch fieldType {
	case data.FieldTypeTime:
		times := make([]time.Time, len(values))
		for i, v := range values {
			if t, ok := v.(time.Time); ok {
				times[i] = t
			}
		}
		return data.NewField(name, nil, times)
	case data.FieldTypeFloat64:
		nums := make([]*float64, len(values))
		for i, v := range values {
			if v == nil {
				continue
			}
			if f, ok := toFloat64(v); ok {
				nums[i] = &f
			}
		}
		return data.NewField(name, nil, nums)
	case data.FieldTypeBool:
		bools := make([]*bool, len(values))
		for i, v := range values {
			if v == nil {
				continue
			}
			if b, ok := v.(bool); ok {
				bools[i] = &b
			}
		}
		return data.NewField(name, nil, bools)
	case data.FieldTypeString:
		strs := make([]*string, len(values))
		for i, v := range values {
			if v == nil {
				continue
			}
			s := fmt.Sprint(v)
			strs[i] = &s
		}
		return data.NewField(name, nil, strs)
	default:
		return data.NewField(name, nil, values)
	}
}

func errorFrame(refID, message string) []*data.Frame {
	frame := data.NewFrame("Error",
		data.NewField("Error", nil, []string{message}),
	)
	frame.RefID = refID
	frame.Meta = &data.FrameMeta{PreferredVisualization: data.VisTypeTable}
	return []*data.Frame{frame}
}
