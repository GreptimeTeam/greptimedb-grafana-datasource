package plugin

import (
	"context"
	"fmt"

	"github.com/grafana/grafana-plugin-sdk-go/backend"
	"github.com/grafana/grafana-plugin-sdk-go/backend/instancemgmt"

	"github.com/greptime/greptimedb/pkg/plugin/instance/promql"
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
	return d.promqlQuerier.QueryData(ctx, req)
}

func (d *Datasource) CheckHealth(ctx context.Context, req *backend.CheckHealthRequest) (*backend.CheckHealthResult, error) {
	return d.promqlQuerier.CheckHealth(ctx, req)
}
