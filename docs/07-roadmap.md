# 路线图

> 主题说明见 [README.md](./README.md)。**先做被依赖的主题 1。**

## 执行顺序

```
P0  01 Go Backend（请求 → 宏 → 重命名）
      │
      │  完成后解锁：Alerting、Public Dashboard、服务端宏
      │
      ├─ 可并行（不依赖 Go 完成）：02 Ad-hoc、05 签名、06 去 Table
      │
P1  03 OTel、04 JSON Filter
      │
      └─ 测试随各主题补（08）
```

## 主题 1（唯一 P0）— [01-go-backend.md](./01-go-backend.md)

| 顺序 | 内容 |
|------|------|
| M1 | Go 请求 + `super.query()` |
| M2 | Go 宏（Greptime 方言） |
| M3 | DataFrame / multi-frame / logs / traces |
| M4 | 重命名 + 删 clickhouse 依赖 + `alerting: true` |

覆盖：FEAT-1/2、IMP-1、GO-1~3、IMP-6。

## 其它主题（P1，文档独立）

| 主题 | 文档 | 要点 |
|------|------|------|
| 2 Ad-hoc | [02](./02-adhoc-filter.md) | FIX-1 WHERE 注入 |
| 3 OTel | [03](./03-otel-support.md) | fallback、版本 UI、links 回归 |
| 4 JSON | [04](./04-json-query.md) | Filter path；自动完成可选依赖 Go resource |
| 5 签名 | [05](./05-plugin-signing.md) | 公开 unsigned |
| 6 查询类型 | [06](./06-query-types.md) | 去 Table |

## 依赖关系（简）

| 能力 | 依赖 |
|------|------|
| Alerting / Public / 服务端宏 | **仅 01** |
| Ad-hoc / 签名 / 去 Table | 可不等人 01 做完 |
| JSON path 自动完成 API | 可选依赖 01 resource |
| OTel frame 随后端化回归 | 01 M3 后更稳 |

SQL / `date_bin` / 宏方言对照与 CH 残留清单：[09-greptime-adaptation.md](./09-greptime-adaptation.md)（P0 改 Go 宏时必读）。
