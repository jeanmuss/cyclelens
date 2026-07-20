# Telegram 每日早报运行说明

## 采用的机器人方案

CycleLens 直接使用 Telegram 官方 Bot Platform：由官方 `@BotFather` 创建 bot，由 GitHub Actions 在上海时间每日 07:00 调用官方 Bot API 的 `sendMessage`。不接入第三方“机器人搭建”“群发”或托管服务。

Telegram 提供 bot 身份、频道权限和消息 API，但不会替 CycleLens 执行业务脚本或定时任务。当前只有每日一次的单向早报，因此 GitHub Actions 足够，不需要常驻 webhook 服务器；未来若增加交互命令，再单独评审 webhook、入站数据和权限边界。

推荐使用一个私有 Telegram 频道作为正式目标。将 bot 设为管理员时只授予“发布消息”这一项最小权限，不授予管理成员、编辑频道信息或新增管理员等权限。测试阶段也可以先在与 bot 的一对一对话中发送。

## 固定产品 contract

- contract 版本：`v1`。
- 固定清单：当前首页全部 8 个分组、25 个默认指标；最终用户不能自定义。
- 每项包含：名称、数值、日变化、周变化、观测时间、新鲜度、质量状态和来源。
- 没有合格观测或无法计算变化时显示 `N/A`，不补零。
- 旧观测必须带真实观测时间和“陈旧”标记，不冒充当日值。
- Telegram 单条消息限制在 4096 字符内；当前模板有确定性长度测试。

## 安全配置（真实发送前一次性完成）

1. 在 Telegram 中确认对象确为官方 `@BotFather`，执行 `/newbot` 并保存生成的 token。token 等同于 bot 的完全控制权，不要发到聊天、工单、截图或命令参数中。
2. 创建目标频道并把 bot 加为仅可发布消息的管理员。公开频道可用 `@channel_username` 作为目标；私有频道使用数字 chat ID。私有 ID 可以在 bot 成为管理员后发布一条临时频道消息，再通过官方 Bot API `getUpdates` 安全读取，不需要第三方查询 bot。
3. 在 `jeanmuss/cyclelens` 的 GitHub Actions Secret Store 中新增：
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
4. 不要先开启定时发送。手动运行 `Telegram morning brief`，选择默认 `dry-run`，下载并审核 7 天保留的预览 artifact。
5. 模板确认后手动选择 `send` 做一次真实投递；确认频道只收到一条且内容正确。
6. 最后把仓库 Variable `TELEGRAM_MORNING_BRIEF_ENABLED` 设为 `1`。未设置或不为 `1` 时，定时任务只生成预览，不发送。

Secret 值不由应用、日志或构建产物回显。需要配置时应在 GitHub 网页 Secret Store 或本机 `gh secret set` 的隐藏输入提示中完成，不能粘贴到 Codex 对话。

## 调度、幂等与失败策略

- cron 为 `0 23 * * *`（UTC），对应次日上海时间 07:00。GitHub 托管调度是尽力而为，平台拥堵时可能晚于 07:00 启动，不提供硬实时 SLA。
- 幂等键为 `telegram-morning-brief-v<contract>-<上海日期>`。同键 workflow 使用并发锁；成功后保存不含 token、chat ID 或 message ID 的 90 天 receipt artifact，后续同日运行检测到 receipt 即跳过。
- Telegram 明确返回 `429` 且给出 1–30 秒 `retry_after` 时只重试一次。网络超时和 `5xx` 的投递结果可能不确定，因此不自动重试，以降低重复消息风险；应先人工检查频道，再决定是否手动重跑。
- 每个 chat 官方建议不超过每秒 1 条；本项目每天 1 条，远低于免费默认限制。

## Node 20 Actions 提醒

提醒针对 GitHub 官方 action 自己声明的 JavaScript 运行时，不是 CycleLens 业务脚本选择的 Node 22。工作流已升级到当前 Node 24 兼容的官方 action major；继续显式使用 Node 22 执行项目脚本。GitHub 托管 runner 无需用户安装 Node 或修改电脑配置。
