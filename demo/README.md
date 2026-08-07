# Demo Data Import

This folder provides standalone SQL seed files and an import script for the demo dashboards.

## Prerequisites

- GreptimeDB is reachable (default in this repo: `http://greptimedb:4000` via `docker compose up`)
- Grafana is running with provisioning mounted from `./provisioning`

## Import data

```bash
./demo/seed/import.sh
```

Note: the script defaults to `http://greptimedb:4000` and automatically
falls back to `http://localhost:4000` when running from host environment.

Override target endpoint/database if needed:

```bash
./demo/seed/import.sh --endpoint http://127.0.0.1:4000 --db public
```

## Dashboards

**Provisioned** (folder `Greptime Demo`):

- `provisioning/dashboards/demo/greptime-otel-min-demo.json`
- `provisioning/dashboards/demo/genai-observability.json`

**Plugin packaging:** `src/dashboards/` (same two JSON files in `plugin.json` includes)

## Schema note

`opentelemetry_traces` uses **flattened OTel attribute columns** (e.g.
`` `span_attributes.gen_ai.system` ``), matching GenAI Observability.
Flow-style aggregate tables `genai_status_1m` / `genai_token_usage_1m` are also seeded.

## Validation SQL

```sql
SELECT count(*) AS c FROM cpu_metrics_30;
SELECT count(*) AS c FROM genai_conversations;
SELECT count(*) AS c FROM opentelemetry_traces;
SELECT count(*) AS c FROM genai_status_1m;
SELECT count(*) AS c FROM genai_token_usage_1m;
SELECT count(*) AS c FROM opentelemetry_traces WHERE `span_attributes.gen_ai.system` IS NOT NULL;
SELECT count(*) AS c FROM genai_conversations l JOIN opentelemetry_traces t ON l.trace_id = t.trace_id;
```
