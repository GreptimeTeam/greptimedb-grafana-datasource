# 2. Ad-hoc Filter 完善

> 主题 2。Dashboard 顶栏键值过滤自动注入 panel 查询。

## 1. 概念

Variables → Ad hoc filters → 选 GreptimeDB 数据源 → 过滤条件注入各 panel。

## 2. 当前实现

### 数据流

```
getTagKeys()
  → $clickhouse_adhoc_query 变量（硬编码名）或 Default Database
  → INFORMATION_SCHEMA.COLUMNS
  → ["table.col", ...]

getTagValues({ key })
  → SELECT DISTINCT ... LIMIT 1000

注入：
  Builder → Filter[] → WHERE
  SQL Editor → adHocFilter.ts（仍可能走 CH settings 语法）
```

### 两条路径

| 模式 | 行为 | 状态 |
|------|------|------|
| Builder | 合并 `builderOptions.filters` → 标准 WHERE | 可用 |
| SQL Editor | 曾用 `settings additional_table_filters`（ClickHouse） | **失效 / 需修** |

> 注：仓库内若已部分改为 WHERE 注入，以代码为准；文档目标仍是**两条路径都用标准 WHERE**。

## 3. 问题清单

| 问题 | 说明 |
|------|------|
| SQL Editor CH `settings` 语法 | Greptime 不识别 |
| `$clickhouse_adhoc_query` 命名 | ClickHouse 残留，应改为 Greptime 友好名或配置项 |
| `INFORMATION_SCHEMA` 无缓存 | 每次加载都打 |
| 跨表 filter | 列不属于当前表时未跳过 |
| Builder / SQL 行为不一致 | 体验分裂 |

## 4. 改进方案

1. **SQL Editor**：标准 `WHERE` / `AND` 注入（禁止 CH settings）。
2. **变量名 / 配置**：去掉 clickhouse 前缀；文档与 UI 说明 Default Database 回退。
3. **（可选，随 Go 后端）** `getTagKeys` / `getTagValues` 资源端点 + 缓存。
4. **跨表**：Builder 下校验列属于目标表，否则跳过。

## 5. 与 P0 关系

不阻塞 Go 后端；可与主题 1 **并行**。若 Go 提供 resource API，标签发现可二期迁服务端。
