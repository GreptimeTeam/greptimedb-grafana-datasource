# 3. OpenTelemetry 支持

> 主题 3。Logs / Traces 与 OTel 列映射、Data Links、体验缺口。

## 1. 列映射（以配置 / otel 预设为准）

### Logs（OTel 1.29.0 预设，`src/otel.ts`）

| Hint | GreptimeDB 列名 |
|------|----------------|
| Time | `timestamp` |
| LogLevel | `severity_text` |
| LogMessage | `body` |
| TraceId | `trace_id` |

### Traces（OTel 1.29.0 预设）

| Hint | GreptimeDB 列名 |
|------|----------------|
| Time | `timestamp` |
| TraceId | `trace_id` |
| TraceSpanId | `span_id` |
| TraceParentSpanId | `parent_span_id` |
| TraceServiceName | `service_name` |
| TraceOperationName | `span_name` |
| TraceDurationTime | `duration_nano` |
| TraceTags | `span_attributes` |
| TraceServiceTags | `resource_attributes` |
| TraceStatusCode | `span_status_code` |
| TraceEventsPrefix | `span_events` |

列名使用 GreptimeDB 实际小写 underscore 风格，**不是** OTel 标准的 PascalCase（`TraceId`/`SpanId`），因为 GreptimeDB 不保留大小写。

## 2. 数据流

```
datasource config（logs / traces 列）
  → QueryBuilder hooks（默认列、时间过滤、OTel 预设）
  → sqlGenerator（$__timeFilter + 引号处理）
  → Go QueryData → Greptime
  → Logs / Trace DataFrame（preferredVisualisationType）
```

### OTel 启用路径

1. 用户在 datasource 配置或 Query Builder 中开启 OTel 并选版本
2. `useOtelColumns` hook dispatch `setOptions({ columns: otel预设列 })`
3. Builder 列锁定（`disabled={otelEnabled}`），不可手动改
4. 关闭 OTel 恢复手动模式

## 3. 改进状态

| 项 | 状态 | 说明 |
|----|------|------|
| `OtelVersionSelect` UI 恢复 | ✅ 完成 | Logs/Traces QueryBuilder + Config Editor 均已恢复 |
| OTel 列名修正 | ✅ 完成 | PascalCase → GreptimeDB lowercase underscore |
| `useOtelColumns` 首次加载 bug | ✅ 修复 | `useRef(otelEnabled)` → `useRef(false)`，首次必定填充 |
| Data Links — View logs 空表过滤 | ✅ 修复 | 无默认日志表时不创建链接 |
| Logs 列无 fallback | ❌ 放弃 | 模糊猜测弊大于利：逻辑复杂、经常猜错。列映射应走显式配置或 OTel 预设 |
| Trace 触发条件 | ✅ 已有 | `isSingleTraceDetail` 按数据自动区分 search/detail + `RefID == "Trace ID"` 双路径 |

## 4. 与其它主题

- **主题 1**：Logs/Traces 整形最终在 Go；列映射配置仍前端。
- **主题 4**：`span_events` / `span_links` JSON 过滤增强 Trace Builder。
- **主题 6**：Logs / Traces 为保留的查询类型。
