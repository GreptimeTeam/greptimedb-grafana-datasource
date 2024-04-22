package promql

import (
	"context"
	"fmt"
	"net/http"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/grafana/grafana-plugin-sdk-go/data/utils/maputil"
	jsoniter "github.com/json-iterator/go"

	"github.com/grafana/grafana-plugin-sdk-go/backend/httpclient"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
)

type Promql struct {
	client *http.Client
	log    log.Logger

	ID      int64
	BaseURL string

	intervalCalculator Calculator
	TimeInterval       string
}

func New(ctx context.Context, settings backend.DataSourceInstanceSettings) (*Promql, error) {
	jsonData, err := GetJsonData(settings)
	if err != nil {
		return nil, err
	}

	timeInterval, err := maputil.GetStringOptional(jsonData, "timeInterval")
	if err != nil {
		return nil, err
	}

	opts, err := settings.HTTPClientOptions(ctx)
	if err != nil {
		return nil, fmt.Errorf("http client options: %w", err)
	}

	cli, err := httpclient.New(opts)
	if err != nil {
		return nil, fmt.Errorf("httpclient new: %w", err)
	}

	log := backend.NewLoggerWith("logger", "greptimedb.promql")

	return &Promql{
		client: cli,
		log:    log,

		TimeInterval: timeInterval,
		ID:           settings.ID,
		BaseURL:      settings.URL,
	}, nil
}

func (p *Promql) Execute(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	result := backend.QueryDataResponse{
		Responses: backend.Responses{},
	}

	for _, q := range req.Queries {
		r := p.handleQuery(ctx, q)
		if r == nil {
			continue
		}
		result.Responses[q.RefID] = *r
	}

	return &result, nil
}

func (p *Promql) handleQuery(ctx context.Context, q backend.DataQuery) *backend.DataResponse {
	query, err := Parse(q, p.TimeInterval, p.intervalCalculator)
	if err != nil {
		return &backend.DataResponse{
			Error: err,
		}
	}

	r := p.fetch(query)
	if r == nil {
		p.log.FromContext(ctx).Debug("Received nil response from runQuery", "query", query.Expr)
	}
	return r
}

func (s *Promql) fetch(q *Query) *backend.DataResponse {
	dr := &backend.DataResponse{
		Frames: data.Frames{},
		Error:  nil,
	}

	if q.InstantQuery {
		res := s.instantQuery(q)
		dr.Error = res.Error
		dr.Frames = res.Frames
		dr.Status = res.Status
	}

	if q.RangeQuery {
		res := s.rangeQuery(q)
		if res.Error != nil {
			if dr.Error == nil {
				dr.Error = res.Error
			} else {
				dr.Error = fmt.Errorf("%v %w", dr.Error, res.Error)
			}
			// When both instant and range are true, we may overwrite the status code.
			// To fix this (and other things) they should come in separate http requests.
			dr.Status = res.Status
		}
		dr.Frames = append(dr.Frames, res.Frames...)
	}

	return dr
}

func (s *Promql) rangeQuery(q *Query) backend.DataResponse {
	ctx := context.Background()
	res, err := c.QueryRange(ctx, q)
	if err != nil {
		return backend.DataResponse{
			Error:  err,
			Status: backend.StatusBadGateway,
		}
	}

	defer func() {
		err := res.Body.Close()
		if err != nil {
			s.log.Warn("Failed to close query range response body", "error", err)
		}
	}()

	return s.parseResponse(ctx, q, res)
}

func (s *Promql) instantQuery(ctx context.Context, q *Query) backend.DataResponse {
	res, err := c.QueryInstant(ctx, q)
	if err != nil {
		return backend.DataResponse{
			Error:  err,
			Status: backend.StatusBadGateway,
		}
	}

	defer func() {
		err := res.Body.Close()
		if err != nil {
			s.log.Warn("Failed to close response body", "error", err)
		}
	}()

	return s.parseResponse(ctx, q, res)
}

func (p *Promql) parseResponse(ctx context.Context, q *Query, res *http.Response) backend.DataResponse {
	defer func() {
		if err := res.Body.Close(); err != nil {
			p.log.FromContext(ctx).Error("Failed to close response body", "err", err)
		}
	}()

	iter := jsoniter.Parse(jsoniter.ConfigDefault, res.Body, 1024)
	r := ReadPrometheusStyleResult(iter, Options{})
	r.Status = backend.Status(res.StatusCode)

	// Add frame to attach metadata
	if len(r.Frames) == 0 {
		r.Frames = append(r.Frames, data.NewFrame(""))
	}

	// The ExecutedQueryString can be viewed in QueryInspector in UI
	for i, frame := range r.Frames {
		addMetadataToMultiFrame(q, frame)
		if i == 0 {
			frame.Meta.ExecutedQueryString = executedQueryString(q)
		}
	}

	return r
}
