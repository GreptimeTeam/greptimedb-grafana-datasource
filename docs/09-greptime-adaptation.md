# GreptimeDB 相对 ClickHouse 的适配说明

本插件由 ClickHouse datasource 改造而来。本文单独记录 **SQL / 函数 / 协议 / 查询生成** 上已做的 Greptime 适配，以及仍残留的 CH 行为（需随 [01-go-backend.md](./01-go-backend.md) 清掉）。

其它主题（Ad-hoc、OTel、去 Table 等）见 [README.md](./README.md)；此处只谈「方言与适配层」。

---

## 1. 总览

| 领域 | ClickHouse（上游） | Greptime（本插件目标） | 状态 |
|------|-------------------|------------------------|------|
| 时间分桶 | `toStartOfInterval` / `date_trunc` | `date_bin(interval, col)` | 前端 Builder / `$__timeInterval` ✅ |
| 时间宏展开 | `toDateTime(unix)` / `fromUnixTimestamp64Milli` | ISO 字面量比较 | 前端 ✅；Go `pkg/macros` ❌ 仍是 CH |
| 时间戳→毫秒 | CH 专用函数 | `to_unixtime(col) * 1000` | Trace SQL ✅ |
| Duration | `multiply(...)` | `*` / `FLOOR(...)` | Trace SQL ✅ |
| 全文 | CH 体系 | `@@` / `NOT @@`（+ `lower` 做 CI） | Filter ✅ |
| JSON 过滤 | Map / 其它 | `json_get_*` / `json_path_match` | 规划中，见 [04](./04-json-query.md) |
| Ad-hoc 注入 | `settings additional_table_filters` | 标准 `WHERE` | 部分路径仍 CH，见 [02](./02-adhoc-filter.md) |
| 传输 | clickhouse-go 原生协议 | HTTP `/v1/sql` JSON | 前端 proxy ✅；Go 待接 |
| 类型名 | CH 类型 | `TimestampMillisecond` 等 Greptime 类型串 | `greptimedb/` ✅ |
| 标识符 | 按 CH 习惯 | 双引号 `"ident"`，字符串 `''` 转义 | ✅ |

---

## 2. 时间分桶：`date_bin`

### Builder（Aggregate / Trend）

生成：

```sql
date_bin('$__interval', greptime_timestamp) AS "time"
...
GROUP BY ..., time
ORDER BY time ASC   -- 不可 ORDER BY 原始时间列（聚合规则）
```

相对 CH：

| CH | Greptime |
|----|----------|
| `$__timeInterval(col)` → `toStartOfInterval(toDateTime(col), INTERVAL n second)` | `$__timeInterval(col)` → `date_bin('<interval>', col)` |
| 或 `date_trunc('minute', col)` 等 | 不用 `date_trunc` 作为默认路径 |

### 宏展开（前端现状）

`expandGreptimeIntervalMacros`：

1. `$__timeInterval(col)` → `date_bin('<resolved>', col)`
2. `$__interval` → `15s` / `1m` 等（须在 `$__timeInterval` 之后替换，避免子串污染）

间隔来自 Grafana `request.interval` / `intervalMs`（`resolveGreptimePanelInterval`），格式需 Greptime `date_bin` 可接受（如 `30s`、`1m`、`1h`）。

### Go 宏（待改）

`pkg/macros` 仍输出：

```text
toStartOfInterval(toDateTime(col), INTERVAL n second)
toDateTime(unix)
fromUnixTimestamp64Milli(...)
toDate('...')
```

**P0 M2 必须改成与上表一致的 Greptime SQL**，否则 Alerting 路径会生成非法 SQL。

---

## 3. 时间过滤宏

| 宏 | CH 典型展开 | Greptime 目标 / 前端现状 |
|----|-------------|-------------------------|
| `$__fromTime` / `$__toTime` | `toDateTime(unix)` | `'2026-01-01T00:00:00.000Z'` |
| `$__timeFilter(col)` | `col >= toDateTime(...) AND ...` | `col >= 'ISO' AND col <= 'ISO'` |

Builder 时间范围过滤生成 `$__fromTime` / `$__toTime`，不直接写死字面量。

---

## 4. 其它 Greptime SQL 函数（已用）

| 用途 | 生成示例 | 位置 |
|------|----------|------|
| Trace start → ms | `CAST(to_unixtime(col) * 1000 AS BIGINT)` | `convertTimeFieldToMilliseconds` |
| Duration → ms | `col * 1000` / `FLOOR(col * 0.000001)` 等 | `getTraceDurationSelectSqlGreptimeDB`（替代 CH `multiply`） |
| 全文匹配 | `col @@ 'term'` / `NOT (col @@ '...')` | `FilterOperator.MatchesTerm`（`@@`） |
| 大小写不敏感全文 | `lower(col) @@ 'term'` | `CI @@` 系列 |
| 大小写不敏感 | `lower(col)` | MatchesTermCaseInsensitive |

**不要**在新代码里再引入：`toDateTime`、`toStartOfInterval`、`toUnixTimestamp64Milli`、`multiply(`（CH 风格）、`settings additional_table_filters`。

---

## 5. 标识符与 catalog SQL

- 表/列：`"database"."table"`、必要时 `"ColumnName"`（保留大小写）。
- 变量查询：`SHOW TABLES FROM "db"`；列用 `INFORMATION_SCHEMA.COLUMNS` + `table_schema` / `table_name`（Greptime 信息模式，不是 CH `system.columns`）。
- 字符串字面量：单引号，内部 `'` → `''`（`escapeGreptimeStringLiteral`）。

---

## 6. 协议与类型（相对 CH 客户端）

| | CH 上游 | Greptime 插件 |
|---|--------|----------------|
| 执行 | clickhouse-go | `POST .../v1/sql`，JSON `output[].records` |
| 类型映射 | CH → FieldType | `Timestamp*` / `Int64` / `String` 等 → Grafana FieldType（`src/greptimedb`） |
| 时间值 | 驱动原生 | JSON 解析 + `toMs` 按精度转毫秒 |

Go 后端落地后：同一 JSON 协议在 Go 解析；**删除 clickhouse-go 依赖**（适配的一部分）。

---

## 7. 查询生成行为差异（非函数，但属适配）

| 点 | 说明 |
|----|------|
| Aggregate `ORDER BY` | 必须用 `time` 别名，不能用原始 ts（Greptime GROUP BY 规则） |
| Aggregate 默认无 LIMIT | 避免 `date_bin` + 多维 GROUP BY 被全局 LIMIT 截断 |
| Group By 排除 Time 列 | Time 已由 `date_bin` 表达，勿再 SELECT 原始 ts |
| Time series 结果 | long 表 + string 维 → multi-frame labels（CH 旧 GROUP BY 拆帧逻辑已弃） |
| 去 Table 查询类型 | 见 [06](./06-query-types.md)，定位差异而非函数差异 |

---

## 8. 仍残留的 ClickHouse 适配债

| 项 | 位置 | 处理 |
|----|------|------|
| Go 宏 CH SQL | `pkg/macros/macros.go` | P0 M2 重写为 Greptime |
| Go driver / converters | `pkg/plugin/driver.go`、`pkg/converters` | P0 删除，改 HTTP JSON |
| Ad-hoc `settings ...` | `adHocFilter.ts`（及旧测试期望） | 主题 2：标准 WHERE |
| `$clickhouse_adhoc_query` | Datasource | 改名 / 文档 |
| `CH*` 类型与文件名 | 前端大量 | P0 M4 重命名 |
| 注释掉的 CH Trace SQL | `arrayMap` / `mapKeys` 等 | 勿恢复；用 Greptime/OTel 列模型 |
| `convertOperatorToClickHouseOperator` | `adHocFilter.ts` | 随 Ad-hoc 清理改名 |

---

## 9. 适配检查清单（改 SQL 生成 / 宏时）

- [ ] 分桶只用 `date_bin`，不用 `toStartOfInterval` / 默认 `date_trunc`
- [ ] 时间边界用 ISO（或明确的 Greptime 时间函数），不用 `toDateTime(unix)`
- [ ] Trace 时间用 `to_unixtime`，duration 用算术 / `FLOOR`
- [ ] 全文用 `@@`，不用 CH 全文方言
- [ ] 新过滤不用 `settings additional_table_filters`
- [ ] Go 与前端展开结果对同一宏一致（P0 后仅 Go 为准）

---

## 10. 与 P0 的关系

| 适配项 | 何时完成 |
|--------|----------|
| 前端 `date_bin` / ISO 宏 / Trace 函数 | **已有** |
| Go 宏 + 去 clickhouse-go + 重命名 | **[01](./01-go-backend.md) M2–M4** |
| Ad-hoc WHERE | **[02](./02-adhoc-filter.md)** |
| JSON 函数过滤 | **[04](./04-json-query.md)** |
