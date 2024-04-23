package plugin

import (
	"context"
	"fmt"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"
	"github.com/grafana/grafana-plugin-sdk-go/backend/log"
	"github.com/greptime/greptimedb/pkg/plugin/instance/promql"
)

var (
	_ backend.QueryDataHandler      = (*Datasource)(nil)
	_ backend.CheckHealthHandler    = (*Datasource)(nil)
	_ backend.CallResourceHandler   = (*Datasource)(nil)
	_ instancemgmt.InstanceDisposer = (*Datasource)(nil)
)

func NewDatasource(ctx context.Context, settings backend.DataSourceInstanceSettings) (instancemgmt.Instance, error) {
	promqlQuerier, err := promql.NewQuerier(ctx, settings)
	if err != nil {
		return nil, fmt.Errorf("error creating promql querier: %w", err)
	}

	return &Datasource{promqlQuerier: promqlQuerier}, nil
}

type Datasource struct {
	promqlQuerier *promql.Querier
	// TODO: sqlQuerier
}

func (d *Datasource) Dispose() {
	d.promqlQuerier.Dispose()
}

func (d *Datasource) QueryData(ctx context.Context, req *backend.QueryDataRequest) (*backend.QueryDataResponse, error) {
	logger := log.DefaultLogger.FromContext(ctx)
	logger.Debug("************* QueryData", "request", req)
	return d.promqlQuerier.QueryData(ctx, req)
}

func (d *Datasource) CallResource(ctx context.Context, req *backend.CallResourceRequest, sender backend.CallResourceResponseSender) error {
	return d.promqlQuerier.CallResource(ctx, req, sender)
}

func (d *Datasource) CheckHealth(ctx context.Context, req *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	logger := log.DefaultLogger.FromContext(ctx)
	logger.Debug("************* CheckHealth", "request", req)
	return d.promqlQuerier.CheckHealth(ctx, req)
}
