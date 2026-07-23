# 2. Ad-hoc Filter 完善

> 主题 2。Dashboard 顶栏键值过滤自动注入 panel 查询。

## 1. 概念

Variables → Ad hoc filters → 选 GreptimeDB 数据源 → 过滤条件注入各 panel。

## 2. 当前实现

### 数据流

```
getTagKeys()
  → $greptime_adhoc_query 变量 或 Default Database
  → INFORMATION_SCHEMA.COLUMNS
  → ["table.col", ...]

getTagValues({ key })
  → SELECT DISTINCT ... LIMIT 1000

注入：
  Builder → buildFiltersFromAdhoc() → Filter[] → standard WHERE
```

### 唯一路径

| 模式 | 行为 | 状态 |
|------|------|------|
| Builder | 合并 `builderOptions.filters` → 标准 WHERE | ✅ 可用 |
| SQL Editor | **不支持 adhoc filter 注入** | 明确限定 |

### 已修复问题

| 问题 | 说明 | 状态 |
|------|------|------|
| CH `settings` 语法 | 移除 `AdHocFilter.apply()` + `injectAdHocWhere()` | ✅ 已清理 |
| Builder/SQL 双路径 | 砍掉 SQL Editor 路径，只保留 Builder | ✅ 已统一 |
| 跨表 filter | `buildFiltersFromAdhoc()` 校验 `table.column` 前缀，不匹配则跳过 | ✅ 已修复 |
| `escapeValue()` 转义 | apostrophe 等特殊字符正确 `''` 转义，LIKE 路径同步修复 | ✅ 已修复 |

### 未修复（低优先级）

| 问题 | 说明 |
|------|------|
| `$clickhouse_adhoc_query` 命名 | 作为 fallback 保留，`$greptime_adhoc_query` 优先 |
| `INFORMATION_SCHEMA` 无缓存 | 每次加载都查询，暂不影响正确性 |

## 3. 跨表 filter 逻辑

```
buildFiltersFromAdhoc(filters, targetTable):
  for each filter:
    tc = tableAndColumnFromAdhocKey(filter.key)
    if tc exists AND targetTable is set AND tc.table != targetTable:
      skip   // filter 属于其他表，不注入
    // 无表前缀（unscoped）的 filter 保留，注入所有 panel
```

## 4. 验证

测试 Dashboard：`dashboard-for-adhoc-test.json`

### 前置准备

1. 在 Grafana 中导入 `dashboard-for-adhoc-test.json`
2. 准备两个表（示例：`test.orders` 和 `test.users`），含不同列：
   - `test.orders`: `greptime_timestamp`, `amount`, `status`
   - `test.users`: `created_at`, `name`, `email`
3. 在两个表中插入一些测试数据

### 测试项

#### T1 — Builder 模式基础过滤

| 步骤 | 预期 |
|------|------|
| 添加 filter：`orders.status = paid` | Panel A 查询含 `WHERE ... "status" = 'paid'` |
| 修改 value 为 `shipped` | Panel A 查询同时更新 |
| 移除 filter | Panel A 恢复原始查询（无额外 WHERE） |

#### T2 — 操作符覆盖

依次测试以下 filter，检查对应 SQL 是否正确生成：

| Filter | 预期 SQL 片段 |
|--------|--------------|
| `orders.amount > 100` | `"amount" > 100`（number 类型） |
| `orders.amount < 50` | `"amount" < 50` |
| `orders.status = null` | `"status" IS NULL` |
| `orders.status != null` | `"status" IS NOT NULL` |
| `orders.status =~ ship%` | `"status" LIKE '%ship%%'` (Builder 用 `LIKE` + `%` 包裹) |
| `orders.status !~ cancel%` | `"status" NOT LIKE '%cancel%%'` |
| `orders.status IN paid,new` | `"status" IN ('paid', 'new')` |

#### T3 — 转义（apostrophe 等特殊字符）

| 步骤 | 预期 |
|------|------|
| 添加 filter：`orders.status = it's good` | SQL 中 value 被正确转义为 `'it''s good'` |
| `orders.status =~ foo'bar` | LIKE 路径也正确转义 `'%foo''bar%'` |

#### T4 — 跨表 filter 隔离（核心）

| 步骤 | 预期 |
|------|------|
| 添加 filter：`orders.status = paid` | Panel A（orders 表）注入此 filter；Panel B（users 表）**不注入** |
| 添加 filter：`users.name = Alice` | Panel B（users 表）注入此 filter；Panel A（orders 表）**不注入** |
| 同时存在两个 filter | Panel A 只含 `orders.status` 的 filter，Panel B 只含 `users.name` 的 filter |
| 移除所有 filter 后添加无表前缀的 filter：`status = active` | Panel A **和** Panel B 都注入（unscoped filter 对所有表生效） |

验证方法：打开浏览器 DevTools → Network 面板，查看 `/api/ds/query` 请求 body 中的 `rawSql` 字段。

#### T5 — SQL Editor 不注入

| 步骤 | 预期 |
|------|------|
| 添加任意 filter | Panel C（SQL Editor 模式）的 `rawSql` **保持不变**，不注入任何 WHERE 条件 |

#### T6 — Dashboard 级条件组合

| 步骤 | 预期 |
|------|------|
| Panel A 自身已有 filter `status = paid`，Dashboard 级添加 `orders.amount > 50` | 两个 filter 以 `AND` 组合出现在 WHERE 中 |
| 切换 condition 为 `OR` | filter 之间以 `OR` 连接 |
