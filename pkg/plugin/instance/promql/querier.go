package promql

import (
	"bytes"
	"context"
	"fmt"
	"net/http"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/httpclient"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/data"
	"github.com/grafana/grafana-plugin-sdk-go/data/utils/maputil"
	jsoniter "github.com/json-iterator/go"
)

const (
	prefixPath = "/v1/prometheus/"
)

type Querier struct {
	client *Client
	log    log.Logger

	ID                 int64
	IntervalCalculator Calculator
	TimeInterval       string
	URL                string
}

func NewQuerier(ctx context.Context, settings backend.DataSourceInstanceSettings) (*Querier, error) {
	log := backend.NewLoggerWith("logger", "greptimedb.promql")

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

	httpClient, err := httpclient.New(opts)
	if err != nil {
		return nil, fmt.Errorf("error creating http client: %w", err)
	}

	baseUrl := removeUrlEndingSlash(settings.URL) + prefixPath
	promClient := NewClient(httpClient, http.MethodGet, baseUrl)

	calculator := NewCalculator()

	return &Querier{
		ID:                 settings.ID,
		client:             promClient,
		log:                log,
		TimeInterval:       timeInterval,
		IntervalCalculator: calculator,
		URL:                settings.URL,
	}, nil
}

func (querier *Querier) QueryData(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	result := backend.QueryDataResponse{
		Responses: backend.Responses{},
	}

	for _, q := range req.Queries {
		r := querier.handleQuery(ctx, q)
		if r == nil {
			continue
		}
		result.Responses[q.RefID] = *r
	}

	return &result, nil
}

func (querier *Querier) handleQuery(ctx context.Context, q backend.DataQuery) *backend.DataResponse {
	query, err := Parse(q, querier.TimeInterval, querier.IntervalCalculator)
	if err != nil {
		return &backend.DataResponse{
			Error: err,
		}
	}

	r := querier.fetch(ctx, query)
	if r == nil {
		querier.log.FromContext(ctx).Debug("Received nil response from runQuery", "query", query.Expr)
	}
	return r
}

func (querier *Querier) fetch(ctx context.Context, q *Query) *backend.DataResponse {
	dr := &backend.DataResponse{
		Frames: data.Frames{},
		Error:  nil,
	}

	if q.InstantQuery {
		res := querier.instantQuery(ctx, q)
		dr.Error = res.Error
		dr.Frames = res.Frames
		dr.Status = res.Status
	}

	if q.RangeQuery {
		res := querier.rangeQuery(ctx, q)
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

func (querier *Querier) rangeQuery(ctx context.Context, q *Query) backend.DataResponse {
	res, err := querier.client.QueryRange(ctx, q)
	if err != nil {
		return backend.DataResponse{
			Error:  err,
			Status: backend.StatusBadGateway,
		}
	}

	return querier.parseResponse(ctx, q, res)
}

func (querier *Querier) instantQuery(ctx context.Context, q *Query) backend.DataResponse {
	res, err := querier.client.QueryInstant(ctx, q)
	if err != nil {
		return backend.DataResponse{
			Error:  err,
			Status: backend.StatusBadGateway,
		}
	}

	return querier.parseResponse(ctx, q, res)
}

func (querier *Querier) parseResponse(ctx context.Context, q *Query, res *http.Response) backend.DataResponse {
	defer func() {
		if err := res.Body.Close(); err != nil {
			querier.log.FromContext(ctx).Error("Failed to close response body", "err", err)
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

func (querier *Querier) Dispose() {
	querier.client.doer.CloseIdleConnections()
}

func (querier *Querier) CheckHealth(ctx context.Context, req *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	newHealthCheckErrorf := func(format string, args ...interface{}) *backend.CheckHealthResult {
		return &backend.CheckHealthResult{Status: backend.HealthStatusError, Message: fmt.Sprintf(format, args...)}
	}

	url := removeUrlEndingSlash(querier.URL) + "/health"

	r, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return newHealthCheckErrorf("could not create request"), nil
	}
	resp, err := querier.client.Do(r)
	if err != nil {
		return newHealthCheckErrorf("request error"), nil
	}

	defer func() {
		if err := resp.Body.Close(); err != nil {
			querier.log.Error("check health: failed to close response body", "err", err.Error())
		}
	}()

	if resp.StatusCode != http.StatusOK {
		return newHealthCheckErrorf("got response code %d", resp.StatusCode), nil
	}

	return &backend.CheckHealthResult{
		Status:  backend.HealthStatusOk,
		Message: "Data source is working",
	}, nil
}

func (querier *Querier) CallResource(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	resp, err := querier.client.QueryResource(ctx, req)
	if err != nil {
		return fmt.Errorf("error querying resource: %v", err)
	}

	defer func() {
		tmpErr := resp.Body.Close()
		if tmpErr != nil && err == nil {
			err = tmpErr
		}
	}()

	var buf bytes.Buffer
	// Should be more efficient than ReadAll. See https://github.com/prometheus/client_golang/pull/976
	_, err = buf.ReadFrom(resp.Body)
	body := buf.Bytes()
	if err != nil {
		return err
	}
	callResponse := &backend.CallResourceResponse{
		Status:  resp.StatusCode,
		Headers: resp.Header,
		Body:    body,
	}

	return sender.Send(callResponse)
}
