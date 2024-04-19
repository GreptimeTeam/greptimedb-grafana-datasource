package plugin

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/httpclient"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/data"
)

const (
	path = "/v1/prometheus/api/v1/query_range"
)

var (
	_ backend.QueryDataHandler      = (*Datasource)(nil)
	_ backend.CheckHealthHandler    = (*Datasource)(nil)
	_ instancemgmt.InstanceDisposer = (*Datasource)(nil)
)

func NewDatasource(ctx context.Context, settings backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
	ctxLogger := log.DefaultLogger.FromContext(ctx)

	opts, err := settings.HTTPClientOptions(ctx)
	if err != nil {
		return nil, fmt.Errorf("http client options: %w", err)
	}

	ctxLogger.Debug("************** NewDatasource", "settings", settings)
	ctxLogger.Debug("************** NewDatasource", "http client options", opts)

	cl, err := httpclient.New(opts)
	if err != nil {
		return nil, fmt.Errorf("httpclient new: %w", err)
	}
	return &Datasource{
		settings:   settings,
		httpClient: cl,
	}, nil
}

type Datasource struct {
	settings backend.DataSourceInstanceSettings

	httpClient *http.Client
}

func (d *Datasource) Dispose() {
	d.httpClient.CloseIdleConnections()
}

func (d *Datasource) QueryData(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	ctxLogger := log.DefaultLogger.FromContext(ctx)
	ctxLogger.Debug("QueryData", "queries", len(req.Queries))

	// create response struct
	response := backend.NewQueryDataResponse()

	// loop over queries and execute them individually.
	for i, q := range req.Queries {
		ctxLogger.Debug("Processing query", "number", i, "ref", q.RefID)

		if i%2 != 0 {
			// Just to demonstrate how to return an error with a custom status code.
			response.Responses[q.RefID] = backend.ErrDataResponse(
				backend.StatusBadRequest,
				fmt.Sprintf("user friendly error for query number %v, excluding any sensitive information", i+1),
			)
			continue
		}

		res, err := d.query(ctx, req.PluginContext, q)
		if errors.Is(err, context.DeadlineExceeded) {
			res = backend.ErrDataResponse(backend.StatusTimeout, "gateway timeout")
		} else if err != nil {
			res = backend.ErrDataResponse(backend.StatusInternal, err.Error())
		}

		response.Responses[q.RefID] = res
	}

	return response, nil
}

func (d *Datasource) query(ctx context.Context, pCtx backend.PluginContext, query backend.DataQuery) (backend.DataResponse, error) {
	ctxLogger := log.DefaultLogger.FromContext(ctx)

	ctxLogger.Debug("************** query", "settings", d.settings)
	ctxLogger.Debug("************** query", "plugin context", pCtx)
	ctxLogger.Debug("************** query", "query", query)

	url := d.settings.URL + path
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return backend.DataResponse{}, fmt.Errorf("new request with context: %w", err)
	}
	ctxLogger.Debug("************** query", "req", req)

	httpResp, err := d.httpClient.Do(req)
	if err != nil {
		return backend.DataResponse{}, err
	}
	defer func() {
		if err := httpResp.Body.Close(); err != nil {
			ctxLogger.Error("query: failed to close response body", "err", err)
		}
	}()

	// Make sure the response was successful
	if httpResp.StatusCode < 200 || httpResp.StatusCode >= 300 {
		return backend.DataResponse{}, fmt.Errorf("expected 200 response, but got %d", httpResp.StatusCode)
	}

	// // Decode response
	// var body apiMetrics
	// if err := json.NewDecoder(httpResp.Body).Decode(&body); err != nil {
	// 	return backend.DataResponse{}, fmt.Errorf("decode: %s", err)
	// }

	// Create slice of values for time and values.
	// times := make([]time.Time, len(body.DataPoints))
	// values := make([]float64, len(body.DataPoints))
	// for i, p := range body.DataPoints {
	// 	times[i] = p.Time
	// 	values[i] = p.Value
	// }

	times := []time.Time{time.Now()}
	values := []float64{1.0}

	// Create frame and add it to the response
	dataResp := backend.DataResponse{
		Frames: []*data.Frame{
			data.NewFrame(
				"response",
				data.NewField("time", nil, times),
				data.NewField("values", nil, values),
			),
		},
	}

	return dataResp, nil
}

func (d *Datasource) CheckHealth(ctx context.Context, req *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	ctxLogger := log.DefaultLogger.FromContext(ctx)

	url := removeUrlEndingSlash(d.settings.URL) + "/health"

	r, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return newHealthCheckErrorf("could not create request"), nil
	}
	resp, err := d.httpClient.Do(r)
	if err != nil {
		return newHealthCheckErrorf("request error"), nil
	}
	defer func() {
		if err := resp.Body.Close(); err != nil {
			ctxLogger.Error("check health: failed to close response body", "err", err.Error())
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

func newHealthCheckErrorf(format string, args ...interface{}) *backend.CheckHealthResult {
	return &backend.CheckHealthResult{Status: backend.HealthStatusError, Message: fmt.Sprintf(format, args...)}
}

func removeUrlEndingSlash(url string) string {
	length := len(url)
	if length > 0 && url[length-1] == '/' {
		return url[:len(url)-1]
	}

	return url
}
