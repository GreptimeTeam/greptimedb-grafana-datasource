# 4. JSON 查询 / 过滤支持

> 主题 4。Builder 对 JSON 列（及 path）的过滤与查询体验。  
> 范围以 **WHERE 侧 JSON path** 为主；SELECT 投影可后续扩展。

## 1. 背景

| 列 | 说明 |
|----|------|
| `span_events` / `span_links` | Trace JSON |
| 用户自定义 JSON | pipeline 等场景 |

已扁平为 STRING 的路径列（如部分 attribute 列）按普通列过滤即可。

### 当前问题

选中 JSON 列后 FilterEditor 无法填 path，容易生成 `WHERE "span_events" = 'exception'` 这类错误 SQL。

## 2. FilterEditor 目标

```
列: span_events（JSON）
JSON path: $.name
值类型: String | Number | Boolean | Predicate
操作符 / 值 → json_get_* / json_path_match
```

| 值类型 | 函数 | 操作符 |
|--------|------|--------|
| String | `json_get_string(col, path)` | `=` `!=` `LIKE` `MATCHES` 等 |
| Number | `json_get_int` / `json_get_float` | 比较 |
| Boolean | `json_get_bool` | `=` `!=` |
| Predicate | `json_path_match(col, path)` | path 内写完整表达式 |

## 3. 模型与 SQL

`CommonFilterProps` 增加 `jsonPath`、`jsonValueType`；`sqlGenerator.getFilters()` 按类型生成函数调用。

可选：Go `/json-keys` 资源端点做 path 自动完成（依赖主题 1 资源 API）。

## 4. 实现触及

| 组件 | 改动 |
|------|------|
| `FilterEditor.tsx` | JSON 分支 UI |
| `queryBuilder` 类型 | 新字段 |
| `sqlGenerator.ts` | JSON WHERE |
| Go（可选） | json-keys 发现 |

## 5. 优先级

P1；不阻塞 Go P0。与 OTel Trace Builder 体验强相关，可在主题 1 后或并行（纯前端 JSON SQL 生成可先做）。
