# 本地启动指南

> 方案 C（本地模式）：页面运行在用户 agent 环境，通过 lark-cli 以用户扫码授权后的身份读写飞书表格。**不部署到任何平台、不需要任何应用凭证、不依赖外部托管。**

## 前置（一次性准备）

1. **lark-cli 已安装**：`lark-cli`（各机器用自己的 lark 账号，Skill 不绑定任何机器的 profile/路径，deliver.mjs 直接用运行环境里的 `lark-cli`；未授权时 deliver.mjs 会自动弹出授权链接引导扫码）
2. **Node.js**：本地运行页面所需（`npm run dev` / `npm run build`）
3. **页面模板**：本 Skill 自带 `templates/page/`（完整 Next.js 项目）

## 首次生成的授权流程（两段式，不后台等待）

1. 运行 `node scripts/deliver.mjs --base <base_token或链接> --admin <管理员姓名> [--code <管理口令>] --task-table <页面主入口表名> [--member-table <人员档案表名>] [--project-table <项目表名>] --owner-field <负责人列名> --name-field <事项名称列名>`
2. deliver.mjs 检测到未授权飞书表格读写 → 输出授权链接/二维码并退出
3. 用户扫码 → 浏览器打开飞书授权页 → 点「同意」
4. 用户确认授权完成后，agent 先运行 `lark-cli auth status --json --verify`；确认通过后重跑同一条 `deliver.mjs` 命令
5. deliver.mjs 继续读表分析 → 生成配置 → 输出本地启动指引
6. **一次性**：同一环境授权一次后，后续生成不再弹出（lark-cli 自动续期）

## 生成步骤（约 5-10 分钟）

1. **生成配置**：按 config-guide 确认主入口和字段后，deliver.mjs 自动改写 `lib/office-config.ts`（baseToken / 表 ID / 字段映射 / 管理员 / 口令），并把未选表追加为全量数据表
2. **本地模式准备**：deliver.mjs 清空部署前缀（basePath/BASE_PATH 置空）
3. **验证数据**：deliver.mjs 直接调 lark-cli 读表确认授权与数据可用
4. **启动页面（必须用「系统托管」方式，防被回收）**：
   - **为什么**：直接用 `npm run dev` 启动的后台进程会挂靠在 agent 会话上，部分 agent 平台会自动回收这类进程，导致「交付的链接打不开」（浏览器报 `ERR_CONNECTION_REFUSED`）。**必须改用操作系统托管**——服务由系统管理、不依赖 agent 会话，交付后链接持续存活（已实测：Windows 计划任务方式启动后连续在线、进程 PID 不变）。
   - **Windows（计划任务 `schtasks`）**：
     ```
     schtasks /create /tn office-live /tr "cmd /c cd /d <输出目录> && set PORT=<端口>&& set OFFICE_LIVE_PORT=<端口>&& npm run dev > <输出目录>\server.log 2>&1" /sc once /st 23:59 /f
     schtasks /run /tn office-live
     ```
     停止服务：`schtasks /end /tn office-live`；查看是否在运行：`netstat -ano | findstr :<端口>`。
   - **macOS（`launchd`）**：加载一个 LaunchAgent plist 启动服务（`KeepAlive` 保持运行），同样由系统托管、不依赖 agent 会话。示例 `~/Library/LaunchAgents/com.office-live.server.plist`：
     ```xml
     <?xml version="1.0" encoding="UTF-8"?>
     <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
     <plist version="1.0"><dict>
       <key>Label</key><string>com.office-live.server</string>
       <key>ProgramArguments</key><array>
         <string>/bin/bash</string>
         <string>-lc</string>
         <string>cd "$HOME/Documents/office-live-output" &amp;&amp; PORT=&lt;端口&gt; OFFICE_LIVE_PORT=&lt;端口&gt; npm run dev &gt; "$HOME/Documents/office-live-output/server.log" 2&gt;&amp;1</string>
       </array>
       <key>RunAtLoad</key><true/>
       <key>KeepAlive</key><true/>
     </dict></plist>
     ```
     加载：`launchctl load ~/Library/LaunchAgents/com.office-live.server.plist`；停止：`launchctl unload ~/Library/LaunchAgents/com.office-live.server.plist`；查看是否在运行：`lsof -i :<端口>`。
   - 启动后必须验证：`curl -I http://localhost:<端口>` 期望 200；`curl http://localhost:<端口>/api/office/snapshot?force=1` 返回 `source: feishu`。验证通过后才交付地址。

> 一键完成前 3 步：`node scripts/deliver.mjs --base <base_token或链接> --admin <管理员姓名> [--code <管理口令>] --task-table <页面主入口表名> [--member-table <人员档案表名>] [--project-table <项目表名>] --owner-field <负责人列名> --name-field <事项名称列名>`

**运行要求**：安装依赖、启动服务和验证接口必须连续做完。不得在 `npm install` 仍在运行、服务未启动、或 `/api/office/snapshot?force=1` 未验证时结束回复。只有用户授权未完成、必答确认未完成、或命令明确失败时，才暂停并把原因说清楚。

**汇报要求**：正常过程只汇报阶段结果，不连续输出排查细节。若遇到已知问题，按下表直接处理，并只告诉用户结论、影响和下一步。

## 验证

```bash
# 页面（启动后）
curl -I http://localhost:<端口>       # 期望 HTTP 200
# 数据
curl "http://localhost:<端口>/api/office/snapshot?force=1"   # 返回全量表数据与分析画像（source: feishu）
```

端口以 `deliver.mjs` 输出和 `office-live-output/.office-live-port` 为准。3000 被占用时使用自动选择的新端口，不能继续验证旧的 3000 服务。

## 常见问题

| 问题 | 处理 |
|---|---|
| 构建失败（依赖错误） | 看构建日志；常见是 puppeteer 等无关依赖，从 package.json 移除 |
| 页面 404 | 本地模式 basePath 应为空；确认 `next.config.ts` 与 `lib/base-path.ts` 的 basePath/BASE_PATH 为空字符串 |
| 数据读不到 | 先查授权：页面显示「未授权/读失败」= lark-cli 未授权或已过期 → **回到生成阶段运行 deliver.mjs 弹码扫码**（用表格所有者账号），授权后刷新页面。不要改代码、不要换其他 lark-cli |
| `deliver.mjs` 能读，页面读不到 | 检查页面服务是否继承同一套 lark 环境变量；前台终端启动优先，避免脱离会话的后台进程作为最终验证 |
| 飞书细粒度限流 | 自动退避重试；不要让用户手动等、手动重跑，也不要把瞬时限流直接判定为失败 |
| 3000 被占用 | 使用自动选择的新端口，并按该端口启动和验证；不要误连旧服务，也不要擅自关闭未知进程 |
| `.next/dev/lock` 残留 | 只清理当前 `office-live-output/.next/dev/lock` 和自己启动失败留下的进程；不要扩大到其他目录 |
| 首页 500 但 API 正常 | 先看页面编译日志；当前模板默认使用稳定 webpack 编译，只有显式设置 `OFFICE_LIVE_BUNDLER=turbopack` 才使用 Turbopack |
| 数据读到但写回失败（91403） | 表格无编辑权限：请用户在表格右上角「分享」把权限改为「互联网上获得链接的人可编辑」（或确认用户对表格有编辑权限），刷新页面即可 |
| 转任务报字段格式错误 | 按负责人列真实类型处理：文本写姓名，人员字段写用户身份，关联字段写目标记录 ID；lookup/公式/自动编号等只读列只能展示，不能写回 |
| lark-cli 找不到 | 确认 lark-cli 已安装且加入 PATH；`LARK_CLI_BIN` 仅用于指定安装位置，**绝不能**用它换一个有旧授权的二进制绕过扫码 |

## 环境变量

| 变量 | 说明 |
|---|---|
| LARK_CLI_BIN | 可选；lark-cli 可执行文件路径（默认取 PATH 中的 lark-cli）。**仅用于指定安装位置，禁止用它绕开授权**——授权一律通过 deliver.mjs 弹出的二维码扫码完成 |
| PUPPETEER_SKIP_DOWNLOAD | 构建时跳过浏览器下载（如遇 puppeteer 问题，设 true） |
