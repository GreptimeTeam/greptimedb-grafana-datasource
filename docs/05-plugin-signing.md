# 5. 插件签名与分发

> 主题 5。公开安装以 **unsigned** 为主；Release 仍附带 localhost Private 签包（兼容，不主推）；企业真实 `root_url` 签名走联系我们 / 本地交付。不上 Catalog 为默认策略。

## 1. 签名级别摘要

| 级别 | Catalog | 说明 |
|------|---------|------|
| Private | 否 | 绑 `rootUrls`；不适合当「通用公开签包」 |
| Community / Commercial | 是 | 需审核；Commercial 更符合有公司主体的产品 |
| Grafana | 官方 | 第三方不可得 |

Catalog **必须**带签名；「上架但不签名」不存在。

## 2. 当前问题

- 公开 Release 的 Private 签包 `rootUrls=localhost` 对真实域名几乎无效，故**不作为推荐安装路径**。
- Docker / 自托管主路径本就是 **unsigned + allowlist**。

## 3. 推荐模型（默认）

```
公开 GitHub Release
  ├─ unsigned.zip          ← 推荐安装
  └─ signed.zip (localhost) ← 兼容保留，不主推

企业按需（真实 root_url）
  └─ 联系我们 / 本地：ROOT_URLS + yarn buildzip:signed
       → 邮件 / 工单交付
```

## 4. 实施改动

| 项 | 改动 |
|----|------|
| `release.yaml` | 仍签 localhost 并同时发 signed + unsigned；文档与 README 主推 unsigned |
| `package.json` → `sign` | `ROOT_URLS`，默认 `http://localhost:3000` |
| `buildzip` / `buildzip:signed` | 默认 unsigned；signed 用于本地按需 |
| README | 公开安装以 unsigned 为主；签名版写联系我们 |
| Dockerfile | 保持 unsigned |

## 5. Catalog

默认**不上**。冲 Community 因商业主体风险高；Commercial 需订阅。衍生自 ClickHouse 的审核风险与签名级别相互独立——去 CH 痕迹（主题 1 M4）有助于未来若上架时的说明。

## 6. 详细原文

下文保留策略细节（交付形态、政策对照）：

---

### Grafana 签名级别（详）

| 级别 | 费用 | 上 Catalog | 说明 |
|------|------|------------|------|
| **Private** | 免费 | 否 | 绑定 `--rootUrls`；不兼容随意 Cloud 实例 |
| **Community** | 免费 | 是 | 开源 / 非营利导向；需审核 |
| **Commercial** | 订阅 | 是 | 营利公司或商业 backing |
| **Grafana** | 仅 Labs | 是 | 官方插件 |

参考：[Plugins policy](https://grafana.com/legal/plugins/)、[Sign a plugin](https://grafana.com/developers/plugin-tools/publish-a-plugin/sign-a-plugin)。

### 仓库现状（目标）

| 位置 | 行为 |
|------|------|
| `package.json` → `sign` | `--rootUrls "${ROOT_URLS:-http://localhost:3000}"` |
| `buildzip` | 构建 unsigned zip |
| `buildzip:signed` | 本地 Private：sign + zip（可覆盖 `ROOT_URLS`） |
| `release.yaml` | 签 localhost；Release 附 signed + unsigned |
| `Dockerfile` | unsigned + allowlist |

### 企业 Private 流程（本地 / 联系我们）

1. 客户提供与 Grafana `root_url` 完全一致的 URL（或走联系我们）。  
2. 维护者本地执行：

```bash
export GRAFANA_ACCESS_POLICY_TOKEN=...
export ROOT_URLS=https://grafana.customer.example
yarn buildzip:signed
```

3. 将生成的 `info8fcc-greptimedb-datasource.zip` 通过邮件 / 工单交付。

### 决策摘要

1. 公开安装默认推荐 **unsigned**。  
2. Release 仍保留 localhost Private 签包（兼容），但不主推。  
3. 真实域名签名版：联系我们 / 本地按需签；Catalog 非默认目标。
