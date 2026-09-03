# 给 Agent 的操作指引（实测经验 · 每个 agent 接手前必读）

> 本文档汇总了实际交付中踩过的坑与结论。**任何 agent 读取本 Skill 后都应先通读本节**，
> 遇到同类问题按本文操作，避免重复踩坑。所有操作基于"通用客户表"，不针对任何一张具体表。

---

## 0. 安装 Skill（git 不通自动降级 zip）

- 用 `git clone` 安装本 Skill；**若 `git clone` 因 TLS 握手 / 网络代理失败，自动降级为下载仓库 zip 压缩包安装**（解压后放到 Skill 安装目录，内容与 git 版本一致），不要因 git 不通卡死或放弃。
- **git 的 stderr 输出不能当作失败信号**：部分 shell（如 Windows PowerShell）会把 git 的正常 stderr 输出（进度信息）误判为错误，导致"克隆失败"误报。正确处理：克隆后**检查目标目录是否已创建成功**（或把 stderr 重定向到文件看真实报错），不要凭 stderr 报错就重试。
- 安装前若已有同名旧副本，**先删除旧副本再安装**，保证装的是干净最新版。
- **lark-cli 用 npm 版并确认支持 `auth`**：npm 上的包名是 **`@larksuite/cli`**（安装到 PATH 后的命令是 `lark-cli` / `lark-cli.cmd`）。安装后先检测：`lark-cli auth status` 报 `unknown command "auth"` → 说明命中不支持 `auth` 的旧版（如平台内置二进制），**统一改用 npm 版 `@larksuite/cli`**（`npm i -g @larksuite/cli`）再进入流程，避免多个 lark-cli 并存导致版本混乱。

---

## 1. 授权（最容易翻车，务必先看）

**目标**：确认 lark-cli 能以"用户身份"读写客户飞书表格；未授权/已登出时必须触发扫码，绝不静默跳过。

**① 用哪个 lark-cli**
- 授权（`auth login` / `auth status` / `auth logout`）**必须使用支持 `auth` 命令的 lark-cli**（npm 版 `lark-cli` / `lark-cli.cmd` 通常支持）。
- **警告**：某些环境里的 lark-cli（如部分平台内置二进制）**不支持 `auth` 子命令**，执行 `auth status` 会报 `unknown command "auth"`。此时**绝不能静默跳过授权检查**，必须改用支持 `auth` 的 lark-cli，或用"读表实测"探测授权。
- `LARK_CLI_BIN` 若被显式指向某个二进制，需确认它**支持 `auth` 命令**；否则授权检查会失败被跳过，导致"页面连不上、却没让用户扫码"。

**② 如何检查授权状态**
- 首选：`lark-cli auth status --json --verify`，看 `identities.user.status`。
  - `ready` / `needs_refresh` → 已授权，继续。
  - `missing`（"no user logged in"）→ 用户未登录，需重新授权。
  - 命令报 `unknown command "auth"` → 换支持 `auth` 的 lark-cli，或改用"读表实测"。
- 兜底（任何 lark-cli 都可用）：直接跑一条真实读表命令（如 `base +table-list --base-token <token> --as user --json`）。
  - 能返回数据 → 已授权。
  - 报 `temporary token expired` / 未授权错误 → 需要重新扫码授权。

**③ 用户已登出 / 授权过期时怎么办（本次核心坑）**
- 用户可能为了体验全流程而主动 `auth logout`，或 token 自然过期。此时页面读表会失败并降级为静态占位（只剩管理员）。
- **处理（关键：必须完成令牌兑换，否则会让用户扫两次码）**：
  1. 用支持 `auth` 的 lark-cli 发起授权并保留 `device_code`：`lark-cli auth login --domain base --no-wait --json`（返回 `verification_uri_complete` + `device_code`）；
  2. 把授权链接/二维码发给用户扫码，用户点「同意」；
  3. **用户同意后，必须先执行令牌兑换**（用第 1 步拿到的 `device_code`）：`lark-cli auth login --device-code <device_code> --domain base`——该命令会阻塞直到授权完成并把令牌落盘；**跳过这一步，令牌不会生效，`auth status` 会一直 `missing`，用户会被要求再扫一次码**；
  4. 兑换成功后，`lark-cli auth status --json --verify` 确认 user 身份 `ready`，再继续（重跑 `deliver.mjs` 或刷新页面）。
- **绝不在用户已登出/未授权时**把"连不上"误判为代码或限流问题，也不要说"授权已就绪"。

**④ 授权日志排查**
- 授权相关操作会写入 `~/.lark-cli/logs/auth-*.log`（含 `auth login` / `auth status` / `auth logout` 的时间线与状态码）。
- 用它判断：用户何时登出、上次授权是否成功、是否 token 过期。

---

## 2. "连不上 / 页面只剩管理员一个人 / 链接打不开" 的排查顺序（必按此顺序）

页面只显示管理员、快照接口返回 `source: static`、或浏览器报 `ERR_CONNECTION_REFUSED` 时，按顺序排查，**不要凭页面文案猜**：

0. **服务进程被 agent 环境回收 / 系统账户读不到凭据（链接打不开或只剩管理员时最先查）**：交付的 `localhost` 链接打不开，先看服务是否在运行（Windows：`netstat -ano | findstr :<端口>`；macOS：`lsof -i :<端口>`）。**服务没在跑 = 启动方式用了裸 `npm run dev` 后台进程或 `schtasks /Run` 立即运行，被 agent 平台回收**（现象：交付时还能打开，过一段时间莫名连接被拒；与用户是否操作无关）。**修复：改用「用户级登录自启」方式启动（Windows：登录触发计划任务 + VBScript 隐藏窗口；macOS：用户级 `launchd` LaunchAgent），见 deployment.md「启动页面」**——普通 `Start-Process` 会弹黑色 cmd 窗口、`schtasks /Run` 可能被回收（0xC000013A）、**系统服务/系统账户（LocalSystem）读不到用户飞书凭据**（快照 `source: static`、只剩管理员），都不可用作交付。启动后验证首页 200 与快照 **`source: feishu`** 再交付。
1. **看服务端日志真实错误**：快照接口失败时服务端会 `console.error("[office-live] 快照读取失败…")` 输出真实错误（授权过期 / 限流 / 字段问题）。
2. **授权失效（常见）**：`temporary token expired` / `user identity missing` → 走本文档第 1 节重新扫码授权。
3. **飞书限流**：`800050828` / `fine-grained rate limiting` → 已内置退避重试；不要手动降级为静态数据。
4. **lark 环境不一致**：`deliver.mjs` 能读、页面读不到 → 检查页面服务是否继承了同一套 lark 环境变量（`LARK_CLI_BIN` 等）。前台启动优先，避免脱离会话的后台进程作为最终验证。
5. **字段/解析错误**：错误信息里含字段名或解析栈 → 按对应字段类型处理。

**注意**：快照接口**不得长期返回静态兜底**。每次读表失败都要留痕（真实日志），并尽量区分"授权失效（需重新扫码）"与"其他错误"。

---

## 3. 8 秒轮询的正确用法（客户要求保留）

- 页面**每 8 秒轮询一次**是客户明确要求（保证飞书表格改动后，网页侧 8 秒内能看到变化）——**必须保留，不要删除或拉长**。
- 但轮询请求**必须走缓存（不带 `force=1`）**：命中后端 8 秒 TTL 缓存，避免每次轮询都全量重读飞书把接口打限流（高频全量重读会导致"连不上"）。
- **只有以下情况才 `force=1` 全量重读**：页面初始化、窗口重新可见、手动刷新、写回之后。
- 效果不变：飞书改动仍会在 8 秒内反映到页面；同时不再因高频全量读表触发限流。

---

## 4. 产物输出目录（任何 agent、任何安装位置都不落进 skill）

- **默认统一写到用户文档目录**：`Documents\office-live-output`（不依赖当前 skill 装在哪个路径、不依赖用户用的是哪个 agent/平台）。
- 可用环境变量 `OFFICE_LIVE_OUTPUT_DIR` 显式覆盖。
- **禁止**在 skill 安装目录、`.skills`、`.user_skills`、仓库根目录或任何其他 agent 目录内残留 `office-live-output`、`node_modules`、`.next`、临时授权文件——否则会导致 skill 目录膨胀、位置错乱。

---

## 5. 快照读取与写回的关键行为（已是 Skill 内置，agent 不要重复"修"）

- **已闭合状态不报超期**：状态值命中"已归还/已完成/已结束/已办结/已交付/已关闭/Closed/Done/Returned"等闭合词时，不再按截止日期反推"超期"（历史事实日期不输出风险结论）。
- **截止日期识别（保守）**：只认明确期限语义的列（截止/到期/应还/还款/回款/下次/跟进/回访/预约/续约/计划完成/预计交付/Deadline/Due/Expire/结束/End）；事件/历史类日期（借出/创建/注册/归还/完成/开始/签约/生效/上线/归档）不设截止，不推断超期。
- **未选表（data 表）自动识别名称列**：供关联字段（link）解析成可读名称；识别不到就显示原值，不编造。
- **名称关联字段解析/写回**：事项名称列若为关联字段，先解析为目标表记录 ID 再写回；匹配不到则明确提示不写。
- **并行读表**：快照读取多张表为并行，单次快照约 2 秒（不要改回串行）。

---

## 6. 敏感信息红线（Skill 内容必须干净）

- Skill 文档与产物中**不得出现**：真实姓名、open_id / user_id、邮箱、手机号、appId、appSecret、token、授权码、测试客户数据、违规词、敏感词。
- 检查项：`auth status` 输出、config 文件、日志片段中的用户标识都不能写入文档或提交到仓库。
- 演示时用"某客户 / 测试表"等占位描述，不用真实个人信息。
