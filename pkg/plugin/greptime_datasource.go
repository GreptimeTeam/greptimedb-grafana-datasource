package plugin

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/grafana/grafana-plugin-sdk-go/data"

	"github.com/grafana/clickhouse-datasource/pkg/greptime"
	"github.com/grafana/clickhouse-datasource/pkg/macros"
)

type queryModel = greptime.QueryModel

// GreptimeDatasource implements Grafana backend query handling for GreptimeDB.
type GreptimeDatasource struct {
	settings Settings
}

func NewGreptimeDatasource(ctx context.Context, config backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
	settings, err := LoadSettings(ctx, config)
	if err != nil {
		return nil, err
	}
	return &GreptimeDatasource{settings: settings}, nil
}

func (ds *GreptimeDatasource) QueryData(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	client, err := ds.newClient(ctx)
	if err != nil {
		return nil, err
	}

	forwarded := req.GetHTTPHeaders()
	response := backend.NewQueryDataResponse()

	for _, query := range req.Queries {
		var model queryModel
		if err := json.Unmarshal(query.JSON, &model); err != nil {
			response.Responses[query.RefID] = backend.DataResponse{Error: backend.DownstreamError(err)}
			continue
		}
		model.RefID = query.RefID

		sql := strings.TrimSpace(model.RawSQL)
		if sql == "" {
			response.Responses[query.RefID] = backend.DataResponse{
				Frames: []*data.Frame{},
			}
			continue
		}

		sql, err = macros.InterpolateSQL(sql, query.TimeRange, query.Interval, query.MaxDataPoints)
		if err != nil {
			response.Responses[query.RefID] = backend.DataResponse{Error: err}
			continue
		}

		greptime.LogExecutedSQL(query.RefID, sql)
		greptimeResp, err := client.ExecuteSQL(ctx, sql, forwarded)
		if err != nil {
			response.Responses[query.RefID] = backend.DataResponse{Error: err}
			continue
		}

		frames, err := greptime.ResponseToFrames(greptimeResp, query.RefID)
		if err != nil {
			response.Responses[query.RefID] = backend.DataResponse{Error: backend.DownstreamError(err)}
			continue
		}

		frames = greptime.FormatFrames(frames, greptime.FormatOptions{
			QueryType:      greptime.ResolveQueryType(model),
			ContextColumns: ds.settings.LogsContextColumns,
			TraceDetail:    greptime.IsTraceDetailQuery(model),
		})
		setExecutedQueryString(frames, sql)

		response.Responses[query.RefID] = backend.DataResponse{Frames: frames}
	}

	return response, nil
}

func setExecutedQueryString(frames []*data.Frame, sql string) {
	for _, frame := range frames {
		if frame == nil {
			continue
		}
		if frame.Meta == nil {
			frame.Meta = &data.FrameMeta{}
		}
		frame.Meta.ExecutedQueryString = sql
	}
}

func (ds *GreptimeDatasource) CheckHealth(ctx context.Context, req *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	client, err := ds.newClient(ctx)
	if err != nil {
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: err.Error(),
		}, nil
	}

	greptime.LogExecutedSQL("health", "SELECT 1")
	if err := client.Ping(ctx, req.GetHTTPHeaders()); err != nil {
		log.DefaultLogger.Error("greptime health check failed", "error", err)
		return &backend.CheckHealthResult{
			Status:  backend.HealthStatusError,
			Message: err.Error(),
		}, nil
	}

	return &backend.CheckHealthResult{
		Status:  backend.HealthStatusOk,
		Message: "Database connection OK",
	}, nil
}

func (ds *GreptimeDatasource) newClient(ctx context.Context) (*greptime.Client, error) {
	tlsConfig, err := ds.tlsConfig()
	if err != nil {
		return nil, err
	}

	timeout := 60 * time.Second
	if t, err := strconv.Atoi(strings.TrimSpace(ds.settings.QueryTimeout)); err == nil && t > 0 {
		timeout = time.Duration(t) * time.Second
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = tlsConfig

	if dialCtx, err := getPDCDialContext(ds.settings); err != nil {
		return nil, err
	} else if dialCtx != nil {
		transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
			return dialCtx(ctx, addr)
		}
	}

	return greptime.NewClient(greptime.ClientSettings{
		SQLURL:                ds.settings.SQLURL(),
		DefaultDatabase:       ds.settings.DefaultDatabase,
		Username:              ds.settings.Username,
		Password:              ds.settings.Password,
		HttpHeaders:           ds.settings.HttpHeaders,
		ForwardGrafanaHeaders: ds.settings.ForwardGrafanaHeaders,
		QueryTimeout:          timeout,
		TLSConfig:             tlsConfig,
		Transport:             transport,
	}), nil
}

func (ds *GreptimeDatasource) tlsConfig() (*tls.Config, error) {
	if ds.settings.TlsAuthWithCACert || ds.settings.TlsClientAuth {
		return getTLSConfig(ds.settings)
	}
	if ds.settings.Secure {
		return &tls.Config{InsecureSkipVerify: ds.settings.InsecureSkipVerify}, nil
	}
	host := strings.TrimSpace(ds.settings.Host)
	if strings.HasPrefix(host, "https://") {
		return &tls.Config{InsecureSkipVerify: ds.settings.InsecureSkipVerify}, nil
	}
	return nil, nil
}

// SQLURL returns the Greptime HTTP SQL endpoint.
func (settings Settings) SQLURL() string {
	host := strings.TrimRight(strings.TrimSpace(settings.Host), "/")
	if strings.HasPrefix(host, "http://") || strings.HasPrefix(host, "https://") {
		return host + "/v1/sql"
	}

	scheme := "http"
	if settings.Secure {
		scheme = "https"
	}
	port := settings.Port
	if port == 0 {
		port = 4000
	}
	return fmt.Sprintf("%s://%s:%d/v1/sql", scheme, host, port)
}
