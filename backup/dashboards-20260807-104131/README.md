# Dashboard backup 20260807-104131

## Why some dashboards "disappeared"

Provisioning provider was changed from:
- `provisioning/dashboards/json`

to:
- `provisioning/dashboards/demo`

So Grafana UI only showed **Greptime Demo**.
Files were still on disk under `json/`, not deleted.

The current demo dashboards were derived from the old builder/otel dashboards and kept the same UIDs:
- greptime-builder-timeseries -> greptime-metrics-demo
- greptime-builder-logs -> greptime-logs-demo
- greptime-builder-traces -> greptime-traces-demo
- greptime-variables-test -> greptime-variables-demo
- otel-test -> greptime-links-demo

## This backup contains

### demo/ (currently provisioned)
greptime-links-demo.json
greptime-logs-demo.json
greptime-metrics-demo.json
greptime-traces-demo.json
greptime-variables-demo.json

### json/ (full directory snapshot before restore)
greptime-builder-logs.json
greptime-builder-timeseries.json
greptime-builder-traces.json
greptime-integration-test.json
greptime-links-demo.json
greptime-logs-demo.json
greptime-logs-test.json
greptime-metrics-demo.json
greptime-timeseries-test.json
greptime-traces-demo.json
greptime-traces-test.json
greptime-variables-demo.json
greptime-variables-test.json
otel-test.json

### src/ (plugin includes)
greptime-links-demo.json
greptime-logs-demo.json
greptime-metrics-demo.json
greptime-traces-demo.json
greptime-variables-demo.json

### provider/default.yml
Provider config at backup time.
