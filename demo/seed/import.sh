#!/usr/bin/env bash
set -euo pipefail

ENDPOINT="http://greptimedb:4000"
DB="public"
ENDPOINT_OVERRIDDEN=0

usage() {
  echo "Usage: $0 [--endpoint http://host:4000] [--db public]"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --endpoint)
      ENDPOINT="$2"
      ENDPOINT_OVERRIDDEN=1
      shift 2
      ;;
    --db)
      DB="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1"
      usage
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${SCRIPT_DIR}/../data"

check_endpoint() {
  local endpoint="$1"
  curl -sS -m 5 -X POST "${endpoint}/v1/sql?db=${DB}" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode "sql=SELECT 1" >/dev/null
}

if [[ "${ENDPOINT_OVERRIDDEN}" -eq 0 ]]; then
  if ! check_endpoint "${ENDPOINT}"; then
    echo "Default endpoint ${ENDPOINT} is not reachable from current environment."
    echo "Falling back to http://localhost:4000 ..."
    ENDPOINT="http://localhost:4000"
    check_endpoint "${ENDPOINT}"
  fi
fi

run_sql_file() {
  local file="$1"
  echo "Importing $(basename "$file") to ${ENDPOINT} (db=${DB})"

  awk 'BEGIN{RS=";"; ORS=""} {gsub(/^[[:space:]]+|[[:space:]]+$/, "", $0); if (length($0) > 0) printf "%s;%c", $0, 0}' "$file" | while IFS= read -r -d '' stmt; do
    local body_file
    body_file="$(mktemp)"
    local http_code
    http_code="$(curl -sS -o "${body_file}" -w "%{http_code}" -X POST "${ENDPOINT}/v1/sql?db=${DB}" -H 'Content-Type: application/x-www-form-urlencoded' --data-urlencode "sql=${stmt}")"
    if [[ "${http_code}" -lt 200 || "${http_code}" -ge 300 ]] || ! python3 - "${body_file}" <<'PY'
import json
import sys
from pathlib import Path

try:
    data = json.loads(Path(sys.argv[1]).read_text())
except Exception:
    sys.exit(0)

code = data.get("code")
if isinstance(code, int) and code != 0:
    sys.exit(1)
sys.exit(0)
PY
    then
      echo "Import failed (HTTP ${http_code}) on statement:"
      echo "${stmt}"
      echo "Response:"
      python3 - <<'PY' "${body_file}"
import sys
from pathlib import Path
print(Path(sys.argv[1]).read_text())
PY
      rm -f "${body_file}"
      exit 1
    fi
    rm -f "${body_file}"
  done
}

run_sql_file "${DATA_DIR}/metrics.sql"
run_sql_file "${DATA_DIR}/logs.sql"
run_sql_file "${DATA_DIR}/traces.sql"
run_sql_file "${DATA_DIR}/genai_flows.sql"

echo "Done. Validation queries:"
echo "  SELECT count(*) AS c FROM cpu_metrics_30;"
echo "  SELECT count(*) AS c FROM genai_conversations;"
echo "  SELECT count(*) AS c FROM opentelemetry_traces;"
echo "  SELECT count(*) AS c FROM genai_status_1m;"
echo "  SELECT count(*) AS c FROM genai_token_usage_1m;"
echo "  SELECT count(*) AS c FROM genai_conversations l JOIN opentelemetry_traces t ON l.trace_id = t.trace_id;"
echo "  SELECT count(*) AS c FROM opentelemetry_traces WHERE \`span_attributes.gen_ai.system\` IS NOT NULL;"
