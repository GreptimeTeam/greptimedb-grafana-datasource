# 1. Go Backend（P0）

独立主题文档。本阶段只做三件事，按依赖顺序推进：

1. **Go 发请求**（`QueryData` → GreptimeDB）
2. **宏在 Go 展开**（Greptime 方言）
3. **CH → Greptime 重命名**（代码 / 依赖 / 文案）

做完即解锁 Alerting、Public Dashboard，并消除前后端宏分裂。  
其它主题（Ad-hoc、OTel、JSON Filter、签名、去 Table）见 [README.md](./README.md)，**不依赖本文件未完成项亦可并行的已在路线图标明**。

---

## 为什么必须先做

| 限制 | 原因 |
|------|------|
| Alerting | 规则在 Grafana **服务端**评估，只能调插件 Go `QueryData()` |
| Public Dashboard | 匿名用户不可信，不能经浏览器 proxy 带凭证查库 |
| 时间宏 | Explore 前端展开 ≠ 告警路径；Go 里仍是 ClickHouse 死代码 |

前端 proxy 直连 `/v1/sql` 无法同时满足以上三点。

---

## 目标架构

```
前端：Builder→SQL + dashboard 变量 + $__conditionalAll
        → super.query()
        → gRPC
Go：  时间宏展开 → POST /v1/sql → JSON→DataFrame（含 multi-frame / logs / traces）
        → GreptimeDB
```

| 留前端 | 放 Go |
|--------|--------|
| SQL 生成、查询 UI | HTTP 调 Greptime |
| `$var`、`$__conditionalAll` | `$__timeFilter` / `$__fromTime` / `$__timeInterval` 等 |
| — | DataFrame 构建与 Time series multi-frame |

---

## 宏（Go 实现）

方言对照（CH → Greptime，含 `date_bin` / 禁止再用的 CH 函数）见 [09-greptime-adaptation.md](./09-greptime-adaptation.md)。

**前端保留**：dashboard 变量、`$__conditionalAll`。  
**`$__interval`**：执行时由 Go 用 `query.Interval` 写入 `date_bin`；Builder Preview 可继续显示字面量 `$__interval`。

| 宏 | 目标展开 |
|----|----------|
| `$__fromTime` / `$fromTime` | `'…Z'` ISO |
| `$__toTime` / `$toTime` | 同上 |
| `$__timeFilter(col)` / `$timeFilter(col)` | `col >= 'ISO' AND col <= 'ISO'` |
| `$__timeInterval(col)` / `$timeInterval(col)` | `date_bin('<interval>', col)` |
| `$fromTime_ms` / `$toTime_ms` / `$timeFilter_ms` | 与现前端对齐后定 ISO 或 ms |
| `$dateFilter` / `$dateTimeFilter` / `$dt` / `$interval_s` | Greptime 合法 SQL |

现状：展开在前端；`pkg/macros` 仍输出 `toDateTime` / `toStartOfInterval`，需整文件重写。

---

## 重命名（与 Go 同包收尾）

| 项 | 动作 |
|----|------|
| `go.mod` | 去掉 `clickhouse-go` 等 |
| `pkg/` | 删 CH driver / converters 死代码 |
| TS | `CHDatasource` / `CHQuery` / `CHConfig` 等 → Greptime 前缀 |
| 文案 | 用户可见 ClickHouse → Greptime |
| `plugin.json` | `"alerting": true` |

改名放在行为稳定之后单独 commit/PR，避免和宏/请求 diff 缠在一起。

---

## 实施顺序（被依赖的优先）

```
M1  Go 能查库（骨架）
    QueryData → /v1/sql → 最小 DataFrame
    前端 query() → super.query()
    （宏可暂留前端）

M2  Go 宏
    重写 pkg/macros；删前端时间宏 replace
    验证 Explore / Alert preview 一致

M3  响应对齐
    精度、multi-frame、logs/traces frame
    再删或瘦身前端 transform

M4  重命名 + 清 CH 依赖 + alerting:true
```

| 里程碑 | 依赖 | 预估 |
|--------|------|------|
| M1 | 无 | ~1–2 天 |
| M2 | M1 | ~1 天 |
| M3 | M2 | ~1–2 天 |
| M4 | M3 | ~1 天 |

---

## 验证

```sql
WHERE $__timeFilter(greptime_timestamp)
-- 或 >= $__fromTime AND <= $__toTime

SELECT date_bin('$__interval', greptime_timestamp) AS time, avg(greptime_value)
FROM ... GROUP BY time

SELECT $__timeInterval(greptime_timestamp) AS time, count(*) ...
```

- [ ] 主查询走 gRPC，不再依赖前端 proxy 执行业务 SQL  
- [ ] Explore 与 Alert rule preview 宏结果一致  
- [ ] Public dashboard（可测时）出图  
- [ ] 多 label Time series / Logs / Traces 回归  
- [ ] 无 clickhouse-go；公共命名无 `CH`（或仅兼容 alias）  
- [ ] `alerting: true`，至少一条规则可评估  
- [ ] `pkg/macros` + fake HTTP DataFrame 单测  

---

## DoD

1. 变量处理后 → Go → Greptime → DataFrame  
2. 时间宏仅 Go，Greptime 方言  
3. 重命名与 CH 依赖清理完成  
4. Alerting / Public 路径可用（与 Grafana 版本能力一致）  

---

## 非本主题

Ad-hoc、OTel UI、JSON path Filter、签名默认 unsigned、去掉 Table → 见 `02`–`06`；其中不依赖 Go 的可与 M1 后并行，见 [07-roadmap.md](./07-roadmap.md)。
