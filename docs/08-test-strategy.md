# 测试策略

> 横切：随六大主题调整保留 / 精简 / 补充。

## 1. 原则

- **保留** Greptime 业务逻辑测试  
- **精简** 纯 UI 渲染测试  
- **移除** 通用组件、不可达测试  
- **补充** 转换器与 Go 宏 / DataFrame（主题 1）

## 2. 保留（核心）

| 区域 | 说明 |
|------|------|
| `sqlGenerator` | 三类查询；去掉 Table 后更新断言（主题 6） |
| Datasource | metricFind、ad-hoc、变量 / conditionalAll（主题 2） |
| `logs` / interval | 宏迁 Go 后改为契约或删前端展开测 |
| `longToMultiFrame` / greptimedb transform | 迁 Go 后改 fixture→Go 或删除 |
| migration / utils / tracking | 保留 |
| Builder hooks、Config 相关 | 保留业务向 |

## 3. 精简

多个 Query Builder 小组件测试可合并为少量集成文件。

## 4. 移除

通用 `ConfigSection` 等无业务逻辑测试；已注释且不可达的 OTel 版本选择测试（恢复 UI 后再补）。

## 5. 补充（优先）

| 测试 | 对应主题 |
|------|----------|
| Go `pkg/macros` 表驱动 | 1 |
| Go JSON→DataFrame + multi-frame fixture | 1 |
| Logs / Trace transform（或 Go 等价）fixture | 1 / 3 |
| Ad-hoc WHERE 注入 | 2 |
| JSON filter SQL 生成 | 4 |
| 无 Table 的 QueryType / 迁移 | 6 |

```
test/fixtures/
  logs-response.json
  traces-response.json
  timeseries-response.json
→ 解析为 DataFrame 字段断言
```
