# CycleLens 管理端：Cloudflare Pages / Access 部署交接

更新日期：2026-07-18

状态：本地安全边界、独立构建和 Pages Function 已完成；尚未创建 Pages 项目、配置 Access、写入远程 secrets 或部署。

## 1. 已实现边界

- `npm run build:admin` 生成独立管理端构建，根路径默认进入宏观事件后台，并生成 `noindex` 元标签与覆盖 `/*` 的 `_routes.json`。
- 公开构建继续静态排除 `MacroAdminRoute`；管理端故障不会改变 GitHub Pages 公共站点的数据读取路径。
- 根 Pages middleware 在返回 HTML、静态资源或 API 之前验证 `Cf-Access-Jwt-Assertion`：只接受 RS256、指定 issuer/audience、有效期内并由当前 Access JWKS 签名的 token。
- API 再校验同源、HTTP 方法、JSON content type、64 KiB body 上限、300 条事件上限和共享字段 schema。
- Access subject 经过 SHA-256 截断后成为稳定的非敏感审计 actor；不记录邮箱、JWT、Supabase 响应正文或 secret。
- 远程页面只调用同源 `/api/manual-macro-events`。远程构建不发送或信任本地 `x-cyclelens-admin` header，也不包含 Python 子进程、校验或发布命令。
- 保存只执行 Supabase CRUD，并返回 `queued_for_next_projection`；静态 JSON 仍由后续 GitHub Actions / 定时投影任务生成。

## 2. 现在不需要用户准备的内容

本地构建、测试和提交不需要 Cloudflare、Supabase 或 GitHub 凭据。不要把任何 key、token、Access JWT 或项目私有 URL 发到对话、提交到仓库或写入前端环境变量。

Wrangler 已作为固定版本的开发依赖加入 `app/package.json`。Supabase CLI 不是本地代码构建的必需项；已连接的 Supabase 工具也可以在选定项目后应用 migration 和运行安全/性能 advisors。GitHub CLI 在本阶段不参与管理端构建。

## 3. 部署前必须完成的外部配置

### 3.1 Supabase

1. 明确选择 CycleLens 对应的 Supabase 项目，不要凭项目名猜测。
2. 核对并应用仓库现有 migration。
3. 由于 2026-04 起新表不再默认暴露到 Data API，需要用一个新的、可审计的 migration 显式授予 `service_role` 对 `manual_macro_events` 的 `select/insert/update/delete`，以及审计 trigger 写入 `manual_macro_event_audit` 所需的最小权限；继续撤销 `anon`、`authenticated` 和 `public` 权限并保留 RLS。
4. migration 后运行 Supabase security 与 performance advisors，并检查一次插入、更新、删除分别写入审计表；`changed_by` 应为 `cf-access:<24 hex>`，不应出现邮箱或 token。
5. 仅为 Pages Function 创建/选用后端 `sb_secret_...` key；不要使用 publishable/anon key，也不要把 secret 暴露给 Vite。

当前本机没有 Supabase CLI，所以第 3 步没有在本批手写一个无法由 CLI/远端 migration 历史确认的文件。部署批次可二选一：使用已连接的 Supabase 工具应用命名 migration，或先安装官方 CLI 后由 `supabase migration new` 创建。CLI 并非因为产品必须使用，而是为了让 migration 历史和文件名可追踪。

### 3.2 Cloudflare Pages 与 Access

1. 在本机执行 Wrangler 登录；登录信息只进入本机凭据存储。
2. 创建 Pages 项目，首选名称 `cyclelens-admin`；若不可用，以实际项目名更新 origin 配置和本文档。
3. 为生产 `*.pages.dev` 地址和所有预览地址配置 Access self-hosted application。首选 Cloudflare 账户成员/组织身份并要求 MFA；备选为指定邮箱 OTP。不要使用共享静态密码。
4. Access policy 必须在 Pages 内容之前生效。Pages middleware 的 JWT 验证是第二道边界，不替代 Access policy。
5. 从 Access 应用复制 team domain 和 application audience 到 Cloudflare secret；不要写入仓库。

需要在 Pages 项目中设置的变量全部通过 Cloudflare encrypted secrets 保存：

| 名称 | 用途 |
| --- | --- |
| `CF_ACCESS_TEAM_DOMAIN` | `https://<team>.cloudflareaccess.com` issuer/JWKS origin |
| `CF_ACCESS_AUD` | Access application audience |
| `CYCLELENS_ADMIN_ORIGINS` | 逗号分隔的精确 HTTPS 管理端 origin |
| `CYCLELENS_ADMIN_HOST_SUFFIXES` | 仅允许项目自身的 `<project>.pages.dev`，用于其 preview 子域 |
| `SUPABASE_URL` | Supabase 项目 HTTPS API origin |
| `SUPABASE_SECRET_KEY` | 后端 `sb_secret_...` key |

本地调试时复制 `app/.dev.vars.example` 为未跟踪的 `app/.dev.vars`，只在本机填写。`.dev.vars*` 已被 git 忽略，示例文件除外。

## 4. 构建、部署和验证顺序

在 `app` 目录执行：

```powershell
npm ci
npm run check
npm run build:admin
npm run build:admin:functions
```

确认以上检查通过后，才使用 Wrangler 创建/部署 Pages 项目并在本机交互式写入 secrets。部署命令和项目名必须以 Wrangler 当前 `--help` 与实际 Cloudflare 项目为准，不能在脚本中固化 token。

上线 smoke test：

1. 未通过 Access 的生产和预览请求拿不到 HTML、静态资源或 `/api/manual-macro-events`。
2. 通过 Access 后根路径直接进入宏观事件后台；响应含 `X-Robots-Tag: noindex, nofollow, noarchive`。
3. API 的跨源 PUT、缺少 Origin 的 PUT、非 GET/PUT、超限 body 和非法 schema 均被拒绝。
4. 保存一条无敏感信息的测试事件，确认数据库行和审计行；删除它并再次确认审计 actor。
5. 保存后页面明确显示“等待下一轮静态投影”，且不会触发 Python 或即时公共发布。
6. 公开 GitHub Pages 仍匿名可读，公开 bundle 不含 `MacroAdminRoute`，上游管理端故障不影响公共快照。

## 5. 剩余风险与后续增强

- Access policy、MFA、Pages production/preview host 覆盖和真实 JWT 尚未在远端验证；这些是完成 Phase 6 部署验收的硬条件。
- `service_role` 显式 grants 的新 migration 尚未应用，远程 CRUD 不能据此视为可用。
- 当前“替换整个事件列表”由 PostgREST 的 upsert、标记删除 actor、delete 多次调用组成，不具备跨请求事务性；小规模 MVP 可用，但上线前应避免多人并发编辑。若出现并发需求，应改为受限数据库 RPC，在单事务内校验版本并替换。
- 尚未加入速率限制或受限 workflow dispatch；第一版依赖 Access、来源校验、体积/条数限制并等待定时投影。

## 6. 官方依据

- [Cloudflare Access：验证 Access JWT](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)
- [Cloudflare Pages Functions](https://developers.cloudflare.com/pages/functions/)
- [Cloudflare Pages Wrangler 配置](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)
- [Cloudflare Pages Functions bindings 与 secrets](https://developers.cloudflare.com/pages/functions/bindings/)
- [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)
- [Supabase：Securing your API](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys)
