# 3. OpenTelemetry 支持

> 主题 3。Logs / Traces 与 OTel 列映射、Data Links、体验缺口。

## 1. 列映射（以配置 / otel 预设为准）

### Logs（示例默认）

| 配置 | 典型列 |
|------|--------|
| Database / Table | `otel` / `otel_logs` |
| Time | `timestamp` |
| Level | `severity_text` |
| Message | `body` |

### Traces（示例默认）

| 配置 | 典型列 |
|------|--------|
| Trace / Span / Parent | `trace_id` / `span_id` / `parent_span_id` |
| Operation / Service | `name` / `resource.service.name` |
| Duration / Start | duration 表达式 / `start_time_unix_nano` |
| Tags | `attributes` / `resource.attributes` |

具体以 datasource 配置与 `otel` 版本映射表为准。

## 2. 数据流

```
datasource config（logs / traces 列）
  → QueryBuilder hooks（默认列、时间过滤）
  → sqlGenerator
  →（目标）Go QueryData → Greptime
  → Logs / Trace DataFrame（preferredVisualisationType）
```

## 3. 已知改进点

| 项 | 说明 |
|----|------|
| `OtelVersionSelect` UI 被注释 | 版本选择不可见，需评估后恢复 |
| Logs 列无 fallback | ColumnHint 未匹配时面板空白；应对 message/body/log 等模糊匹配 |
| Trace 触发条件 | 避免仅依赖脆弱硬编码；以 `QueryType.Traces` / 明确 meta 为准 |
| Data Links | Log ↔ Trace 跳转已有能力，随后端化需回归 |

## 4. 与其它主题

- **主题 1**：Logs/Traces 整形最终在 Go；列映射配置仍前端。
- **主题 4**：`span_events` / `span_links` JSON 过滤增强 Trace Builder。
- **主题 6**：Logs / Traces 为保留的查询类型。
