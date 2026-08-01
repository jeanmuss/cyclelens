# CycleLens

CycleLens 是面向单一所有者的风险资产数据工作台。当前公开站点只发布不含产品数据的退役提示页；完整产品使用独立的 owner-private 数据目录和构建目录，并且只能部署到同时受 Cloudflare Access 与 Pages Functions 保护的站点。

## 安全边界

- “仅自己使用”允许在明确的账户条款内扩大数据覆盖，但不等于获得抓取、缓存或二次展示许可。
- 只连接已登记、已审查的官方或有授权的数据接口。AKShare、yfinance、非官方 TradingView 接口、浏览器 cookie 和会话复用仍被阻断。
- Provider 密钥只存在于忽略的本地环境文件或部署 Secret Store；不得进入前端、Git、Actions artifact/cache、日志、截图或对话。
- Owner 原始数据位于 `app/data/private/`，临时缓存位于 `tmp/owner-private/`，两者均不提交。`app/dist-owner/` 是明文私有产物，绝不能镜像到普通静态托管。
- Owner 发布在同一临时 runner 内完成采集、投影、校验、构建和部署。发布前会校验数据范围、时效、大小、manifest 哈希及匿名访问拒绝；任一环节失败时不覆盖 Cloudflare 上一版部署。
- 仓库中已有的 `app/public/data/` 和 Git 历史属于既有公开数据，切换为 owner-private 不能追溯地使它们保密。

## 本地开发

```bash
cd app
npm ci
npm run dev
```

`npm run build` 只生成无数据的公开退役壳。Owner 构建必须显式设置：

```text
CYCLELENS_DATA_USE_SCOPE=owner_private
CYCLELENS_OWNER_PRIVATE_USE_APPROVED=1
CYCLELENS_PROTECTED_BUILD_APPROVED=1
```

随后按顺序运行 `prepare-owner-data`、所需采集器、`project-owner-data`、`generate-owner-data-manifest` 和 `build:owner`。不要在命令行、文档或聊天中填写任何真实密钥。

Python 依赖使用完全固定并带哈希的清单：

```bash
python -m pip install --require-hashes -r app/requirements-equity.txt
```

## 部署

- `.github/workflows/deploy-pages.yml`：只部署 `dist-public` 退役壳。
- `.github/workflows/deploy-owner.yml`：在 `cyclelens-admin` GitHub Environment 中执行 owner-only 发布。
- `.github/workflows/update-market-data.yml`、Telegram 和旧公开投影工作流均已退役或设为惰性，不再发布数据。

部署前先完成 [Cloudflare owner 边界配置](docs/deployment/ADMIN_CLOUDFLARE.md) 和 [数据源审查](app/DATA_SOURCE_REVIEW.md)。生产数据库变更文件位于 `supabase/migrations/`；仓库内存在 migration 不代表它已经应用到远端。
