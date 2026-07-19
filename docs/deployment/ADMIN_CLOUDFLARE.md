# CycleLens 管理端：Cloudflare Pages / Access 部署交接

更新日期：2026-07-19

状态：`cyclelens-admin` 已通过 Cloudflare Pages Direct Upload 部署；生产域和预览域均由 Cloudflare Access 保护，Pages Functions 已连接现有 CycleLens Supabase 项目并完成真实写入与审计验证。

## 1. 已实现边界

- `npm run build:admin` 生成独立管理端构建，根路径默认进入宏观事件后台，并生成 `noindex` 元标签与覆盖 `/*` 的 `_routes.json`。
- 公开构建继续静态排除 `MacroAdminRoute`；管理端故障不会改变 GitHub Pages 公共站点的数据读取路径。
- 根 Pages middleware 在返回 HTML、静态资源或 API 之前验证 `Cf-Access-Jwt-Assertion`：只接受 RS256、指定 issuer/audience、有效期内并由当前 Access JWKS 签名的 token。
- API 再校验同源、HTTP 方法、JSON content type、64 KiB body 上限、300 条事件上限和共享字段 schema。
- Access subject 经过 SHA-256 截断后成为稳定的非敏感审计 actor；不记录邮箱、JWT、Supabase 响应正文或 secret。
- 远程页面只调用同源 `/api/manual-macro-events`。远程构建不发送或信任本地 `x-cyclelens-admin` header，也不包含 Python 子进程、校验或发布命令。
- 保存只执行 Supabase CRUD，并返回 `queued_for_next_projection`；静态 JSON 仍由后续 GitHub Actions / 定时投影任务生成。

## 2. 凭据与工具边界

不要把任何 key、token、Access JWT 或项目私有 URL 发到对话、提交到仓库或写入前端环境变量。六个运行时字段只保存在 Cloudflare Pages 的 encrypted secrets 中；仓库仅保留变量名和无值示例。

Wrangler 已作为固定版本的开发依赖加入 `app/package.json`。Supabase CLI 不是构建或部署的必需项，本次 migration、查询和 advisors 均通过已连接的 Supabase 工具完成。GitHub CLI 未参与 Phase 6，Phase 8 前也不会推送或切换仓库。

## 3. 已完成的外部配置

### 3.1 Supabase

1. 复用并升级 CycleLens 前身项目对应的现有 Supabase 项目；没有新建第二个项目，也没有删除已有业务数据。
2. 已核对并应用 `phase3_metric_catalog`、`strategy_official_source` 和 `phase6_admin_grants_and_legacy_catalog` migration；仓库保留与远端历史一致的 Phase 6 migration 文件。
3. Phase 6 migration 显式授予 `service_role` 最小 CRUD/审计权限，同时撤销 `anon`、`authenticated` 和 `PUBLIC` 对管理表与 trigger 函数的权限并保留 RLS。
4. migration 前后数据量不变：手动事件 1、审计 1、指标观测 13,714、修订 558；catalog 为 15 项，其中 14 项 active，旧 `equity.JGB10Y.value` 仅作为 private/inactive alias 保留。
5. Security Advisor 为 0；Performance Advisor 为 5 条 `unused_index` INFO，当前数据量太小，先保留索引并在真实流量后复核。
6. Pages Function 使用新的后端 secret key；其 Supabase 控制台显示名称为 `cyclelens_admin_pages`，运行时 Cloudflare binding 仍为 `SUPABASE_SECRET_KEY`。

### 3.2 Cloudflare Pages 与 Access

1. 已创建 Direct Upload Pages 项目 `cyclelens-admin`，生产分支为 `main`；预览验收分支为 `phase6-preview`。
2. 已分别配置生产精确域和预览通配域的 Access self-hosted application，策略 fail closed，仅允许指定成员邮箱通过 OTP；没有共享静态密码。
3. Access policy 在 Pages 内容前生效，Pages middleware 的 JWT 校验继续作为第二道边界。
4. 生产和预览环境均保存下表六项 encrypted secrets；`CF_ACCESS_AUD` 按两个 Access application 分别配置。

需要在 Pages 项目中设置的变量全部通过 Cloudflare encrypted secrets 保存：

| 名称 | 用途 |
| --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | `https://<team>.cloudflareaccess.com` issuer/JWKS origin |
| `CF_ACCESS_AUD` | Access application audience |
| `CYCLELENS_ADMIN_ORIGINS` | 逗号分隔的精确 HTTPS 管理端 origin |
| `CYCLELENS_ADMIN_HOST_SUFFIXES` | 仅允许项目自身的 `<project>.pages.dev`，用于其 preview 子域 |
| `SUPABASE_URL` | Supabase 项目 HTTPS API origin |
| `SUPABASE_SECRET_KEY` | 后端 `sb_secret_...` key；当前 Supabase 控制台密钥名称为 `cyclelens_admin_pages`（显示标签，不是运行时字段名） |

本地调试时复制 `app/.dev.vars.example` 为未跟踪的 `app/.dev.vars`，只在本机填写。`.dev.vars*` 已被 git 忽略，示例文件除外。

## 4. 构建、部署和验证顺序

在 `app` 目录执行：

```powershell
npm ci
npm run check
npm run build:admin
npm run build:admin:functions
```

确认以上检查通过后，才使用 Wrangler Direct Upload 部署；命令不固化 token，凭据只由本机 Wrangler 登录态管理。当前 Wrangler 版本为 4.112.0，Pages 配置仅保留该产品支持的字段。

上线 smoke test 结果（2026-07-19）：

1. 未认证的生产根路径、生产 API、预览 alias 和预览 hash 地址均返回 Access `302`，拿不到 Pages HTML 或 API 正文。
2. 通过邮箱 OTP 后，生产根路径进入宏观事件后台，受保护 API 成功读取 Supabase 中原有的 1 条事件。
3. 页面保存了唯一的 `CYCLELENS_PHASE6_SMOKE` 草稿，明确显示“等待下一轮静态投影”；数据库确认该记录与 INSERT 审计存在，审计 actor 符合 `cf-access:<24 hex>`。
4. 临时记录已按唯一键清理，数据库事件总数恢复为 1；INSERT/DELETE 审计各 1 条且 actor 格式均正确，原有事件未被删除。
5. API 的身份、同源、方法、body、schema 和 `noindex` 边界由 158 项回归测试及独立 admin/Functions 构建共同验证；公开 bundle 继续静态排除管理路由。
6. 公开 GitHub Pages 继续匿名可读；管理端 Direct Upload 与公共站构建、域名和数据路径相互独立。

## 5. 剩余风险与后续增强

- 当前“替换整个事件列表”由 PostgREST 的 upsert、标记删除 actor、delete 多次调用组成，不具备跨请求事务性；小规模 MVP 可用，但上线前应避免多人并发编辑。若出现并发需求，应改为受限数据库 RPC，在单事务内校验版本并替换。
- 尚未加入速率限制或受限 workflow dispatch；第一版依赖 Access、来源校验、体积/条数限制并等待定时投影。
- 预览域已验证未认证请求 fail closed，但没有重复执行生产端的完整 CRUD；两者使用同一 Functions 产物，bindings 则按环境独立维护。
- 5 个未使用索引目前只属于 INFO；不要因空闲期统计立即删除，待有实际查询流量后再复核。

回滚顺序：

1. Pages 代码异常时，重新部署上一个已验证的 Direct Upload 产物；不要绕过或删除 Access policy 来恢复页面。
2. Supabase migration 只收紧并显式化 grants、补齐 catalog，不删除业务行；若需回退应用代码，保留新 secret key 和兼容表结构即可。
3. 若怀疑密钥泄露，先在 Supabase 撤销名为 `cyclelens_admin_pages` 的 key，再在生产和预览分别写入替代 key 并重新部署；不要在日志或工单中复制旧值。
4. 管理端故障不影响公共 GitHub Pages；旧公开站仍是 Phase 8 前的回滚入口。

## 6. 官方依据

- [Cloudflare Access：验证 Access JWT](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/)
- [Cloudflare Pages Wrangler 配置](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)
- [Cloudflare Pages Functions bindings 与 secrets](https://developers.cloudflare.com/pages/functions/bindings/)
- [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [Supabase：Securing your API](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
