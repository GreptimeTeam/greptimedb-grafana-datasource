# 6. 查询类型简化

> 主题 6。去掉 Table；保留 TimeSeries / Logs / Traces，与 GreptimeDB 时序定位一致。

## 1. 原则

- **移除 Table**：来自 ClickHouse 通用分析模型，Greptime 主场景不需要单独查询类型。
- **保留三种**：TimeSeries（指标趋势）、Logs、Traces（与 OTel 配置绑定）。
- SQL Editor 三种皆可；宏与响应整形由（目标）Go 统一处理。

## 2. TimeSeries

```sql
SELECT
  date_bin('$__interval', ts) AS time,
  avg(cpu) AS value,
  host
FROM monitor
WHERE $__timeFilter(ts)
GROUP BY time, host
ORDER BY time
```

- 需要 time + 数值；string 维 → series labels / multi-frame（见主题 1）。
- Builder：Time、聚合、Group by、Filter；Aggregate 模式用 `date_bin`。
- 面板：Time series / Stat / Gauge 等；需要表格时用面板 Format，不必单独 Query type。

## 3. Logs

```sql
SELECT timestamp AS time, message AS line, level, ...
FROM otel_logs
WHERE $__timeFilter(timestamp)
ORDER BY timestamp DESC
```

- time + body/message；配置列映射（主题 3）。

## 4. Traces

```sql
SELECT start_time, trace_id, span_id, parent_span_id, operation_name, service_name, duration, ...
FROM otel_traces
WHERE $__timeFilter(...)
```

- Trace 详情按 trace_id；Grafana Trace waterfall；列映射见主题 3。

## 5. 为何删 Table

| 原因 | 说明 |
|------|------|
| 与 TimeSeries 数据可重叠 | 无维度时 long 表即可被 Table 面板渲染 |
| 产品定位 | Greptime 以时序 / 可观测为主，非通用 SQL 分析仓 |
| 降低概念与代码 | QueryType / Builder / format 分支更少 |

## 6. Builder UI（目标）

| 类型 | 选项 |
|------|------|
| TimeSeries | Time、聚合、Group by、Filter、Order、Limit |
| Logs | Time、Message、Level、Filter |
| Traces | Trace/Span/Parent、Service、Duration、Tags、Filter |

## 7. 实施注意

- 迁移：已存 dashboard 中 `queryType: Table` → 映射为 TimeSeries 或提示用户改面板 Format。
- 测试：`sqlGenerator` / QueryTypeSwitcher 去掉 Table 分支（见 [08-test-strategy.md](./08-test-strategy.md)）。
- 可与主题 1 **并行**（纯前端类型清理）；与 Go format 提示对齐时在 M3 一并回归。
