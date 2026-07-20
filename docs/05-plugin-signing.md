# 5. 插件签名与分发

> 主题 5。Release **默认非签名（unsigned）**；企业按需 Private。不上 Catalog 为默认策略。

## 1. 签名级别摘要

| 级别 | Catalog | 说明 |
|------|---------|------|
| Private | 否 | 绑 `rootUrls`；不适合当「通用公开签包」 |
| Community / Commercial | 是 | 需审核；Commercial 更符合有公司主体的产品 |
| Grafana | 官方 | 第三方不可得 |

Catalog **必须**带签名；「上架但不签名」不存在。

## 2. 当前问题

- 公开 Release 曾发 **Private 签包且 rootUrls=localhost** → 对真实域名几乎无效。
- Docker / 自托管主路径本就是 **unsigned + allowlist**。

## 3. 推荐模型（默认）

```
公开 GitHub Release
  └─ 只发 unsigned.zip
       + allow_loading_unsigned_plugins = <plugin-id>

企业按需
  └─ workflow_dispatch：按客户 root_url Private 签名
       → Actions Artifact → 内部转交（不挂公开 Release）
```

## 4. 待实施改动

| 项 | 改动 |
|----|------|
| `release.yaml` | 公开不再强制无效 localhost sign；只发 unsigned |
| `sign` / 新 workflow | `ROOT_URLS` 环境变量；按需 Private |
| README | 公开安装以 unsigned 为唯一推荐 |
| Dockerfile | 保持 unsigned |

## 5. Catalog

默认**不上**。冲 Community 因商业主体风险高；Commercial 需订阅。衍生自 ClickHouse 的审核风险与签名级别相互独立——去 CH 痕迹（主题 1 M4）有助于未来若上架时的说明。

## 6. 详细原文

下文保留策略细节（Artifact、交付形态、政策对照）：

---

### Grafana 签名级别（详）

| 级别 | 费用 | 上 Catalog | 说明 |
|------|------|------------|------|
| **Private** | 免费 | 否 | 绑定 `--rootUrls`；不兼容随意 Cloud 实例 |
| **Community** | 免费 | 是 | 开源 / 非营利导向；需审核 |
| **Commercial** | 订阅 | 是 | 营利公司或商业 backing |
| **Grafana** | 仅 Labs | 是 | 官方插件 |

参考：[Plugins policy](https://grafana.com/legal/plugins/)、[Sign a plugin](https://grafana.com/developers/plugin-tools/publish-a-plugin/sign-a-plugin)。

### 仓库现状

| 位置 | 行为 |
|------|------|
| `package.json` → `sign` | 常绑 localhost rootUrls |
| `release.yaml` | 曾同时发 signed + unsigned |
| `Dockerfile` | unsigned + allowlist |

### 企业 Private 流程

1. 客户提供与 Grafana `root_url` 完全一致的 URL。  
2. 内部触发 Action（客户不能直接触发公开 repo）。  
3. Artifact 下载后邮件 / 工单交付；**不要**挂公开 Release。  

Artifact 约 90 天、无可外链的私有 URL；需要外链时再接对象存储预签名。

### 决策摘要

1. 公开默认 **unsigned**。  
2. 去掉误导性的 localhost Private 公开包。  
3. 企业按需签；Catalog 非默认目标。
