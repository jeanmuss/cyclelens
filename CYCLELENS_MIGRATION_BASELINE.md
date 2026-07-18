# CycleLens 迁移基线

记录日期：2026-07-18

开发来源：`C:\Users\hovyf\Documents\cycle-map`

当前公开仓库：`jeanmuss/cycle-map`

目标空仓库：`jeanmuss/cyclelens`

本文只记录迁移所需的名称、分支和权限契约，不记录任何 Secret、Variable 或凭据的值。

## 1. 仓库与工作区基线

- 当前唯一 remote 是 `origin = https://github.com/jeanmuss/cycle-map.git`；Phase 8 前不替换 `origin`，也不添加或推送 `cyclelens` remote。
- GitHub App 只读核验显示 `jeanmuss/cyclelens` 为公开空仓库，仓库大小为 `0`，默认分支名为 `main`，当前账号具备管理员和推送权限。
- 本批开始时当前分支为 `codex/cyclelens-refactor`，HEAD 为 `7eea593`；该提交与 `origin/codex/add-site-favicon` 一致，当前分支未设置 upstream。
- 权威主分支基线使用 `origin/main = 0f66323`。本地 `main = 2718ab8` 已陈旧，相对 `origin/main` 为 ahead 1 / behind 19；不要从本地 `main` 推送或据此判断迁移差异。
- `codex/cyclelens-refactor` 相对 `origin/main` 只有 1 个提交，涉及 `app/index.html` 和两个 favicon 文件。
- 本批开始时没有未提交的 tracked 文件；已有未跟踪文件仅为 `CYCLELENS_DEVELOPMENT_PLAN.md`，本批保留并按计划更新它。

## 2. 远端分支基线

以 `origin/main` 为合并判断基线：

- 尚未合并：`origin/codex/add-site-favicon`。当前开发分支指向同一提交，迁移前需纳入干净提交历史。
- 已合并但远端仍保留：`origin/codex-data-trust-footers`、`origin/codex/polish-market-phase-intro`。
- 特殊数据分支：`origin/data-cache = 5619a64`，最后记录时间为 2026-07-17T23:15:41Z。它不是功能合并分支，不应合并进 `main`。
- `data-cache` 由 `.github/workflows/update-market-data.yml` 幂等更新。迁移时应迁移该分支或在新仓库重新生成，只允许工作流列明的数据快照路径变化，不携带本地 `tmp/`、`.env*` 或其他临时文件。

当前 `data-cache` 工作流维护的路径：

- `app/data/manual-macro-events.json`
- `app/public/data/market-monthly.json`
- `app/public/data/crypto-liquidity.json`
- `app/public/data/market-session.json`
- `app/public/data/equity-weekly.json`
- `app/public/data/equity-fast.json`
- `app/public/data/macro-calendar.json`
- `app/public/data/chip-chain-hotspots.json`
- `app/public/data/robot-chain-watchlist.json`
- `app/public/data/chart-series.json`

## 3. 当前 GitHub Pages 契约

当前公开地址为 `https://jeanmuss.github.io/cycle-map/`，2026-07-18 本批只读验证返回 HTTP 200。

仓库内可审计的 Pages 配置如下：

- 构建来源：GitHub Actions，工作流 `.github/workflows/deploy-pages.yml`。
- 触发：推送到 `main`、每小时定时任务、每小时 15/30/45 分快速任务和手动触发。
- 构建环境变量：`GITHUB_PAGES=true`；Vite 根据 `GITHUB_REPOSITORY` 自动生成 `/<repository>/` base path。
- 构建产物：`app/dist`，通过 `actions/upload-pages-artifact` 上传。
- 部署环境名称：`github-pages`；部署 URL 使用 `actions/deploy-pages` 的 `page_url` 输出。
- Pages 工作流权限：`contents: read`、`pages: write`、`id-token: write`。
- Pages 并发组：`github-pages`，`cancel-in-progress: false`。
- 没有仓库内 `CNAME` 文件，当前基线不包含自定义域名。

仓库设置页中的环境保护规则、Pages source 选择和 Actions 仓库级默认权限不是代码内事实。Phase 8 切换前应在 GitHub Settings 中再次逐项核对，不从旧仓库自动复制未知设置。

## 4. 待迁移配置名称

以下名称来自当前 GitHub Actions 工作流引用。只迁移仍被新仓库工作流使用的项目，并通过 GitHub Settings、GitHub CLI 安全认证或部署 secret store 重新设置；不得把值写入命令、文件、日志或对话。

### GitHub Actions Secrets

- `APCA_API_KEY_ID`
- `APCA_API_SECRET_KEY`
- `BLOCKBEATS_API_KEY`
- `CMC_PRO_API_KEY`
- `FRED_API_KEY`
- `SEC_USER_AGENT`
- `SOSOVALUE_API_KEY`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_URL`

`SUPABASE_SECRET_KEY` 是优先使用的新 opaque secret；`SUPABASE_SERVICE_ROLE_KEY` 是当前工作流仍兼容的旧名称。Phase 8 前应确认是否可以移除旧 service-role 兼容项，避免无必要地复制高权限凭据。

### GitHub Actions Variables

- `BLOCKBEATS_AUX_ENABLED`
- `CHIP_CHAIN_US_FEED`
- `MARKET_HISTORY_REQUIRED`

### Environment 与权限

- Environment：`github-pages`
- Pages 部署权限：`contents: read`、`pages: write`、`id-token: write`
- 数据快照工作流权限：`contents: write`

构建 job 没有绑定 `github-pages` environment，因此数据采集所需 Secrets/Variables 当前应按 repository 级配置重新建立；部署 job 不读取这些数据源凭据。

## 5. Phase 8 前置核对

- 在所有重构、测试和提交完成前，不向 `jeanmuss/cyclelens` 推送，也不克隆到 `C:\Users\hovyf\Documents\cyclelens`。
- 推送前从 `origin/main` 重新核对功能分支，处理陈旧的本地 `main`，并确认工作区完全干净。
- 本机 GitHub CLI 的 keyring 凭据在本批核验时无效。需要在 Phase 8 前通过本机安全流程刷新认证；不要把 token 写入命令行、文件或聊天。
- 在目标仓库重新配置上述名称后，先验证 Actions 最小权限、`/cyclelens/` base path、`data-cache`、Pages environment 和公开站点，再切换后续工作目录。
