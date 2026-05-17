# CodexMonitor

[![gitcgr](https://gitcgr.com/badge/Dimillian/CodexMonitor.svg)](https://gitcgr.com/Dimillian/CodexMonitor)

![CodexMonitor](screenshot.png)

CodexMonitor 是一个基于 Tauri 的桌面应用，用于在本地工作区之间编排多个 Codex agent。它提供项目侧边栏、快捷操作主页，以及基于 Codex app-server 协议的对话视图。

## 功能

### 工作区与线程

- 添加并持久化工作区，对工作区进行分组和排序，并从首页仪表盘快速跳转到最近的 agent 活动。
- 为每个工作区启动一个 `codex app-server`，恢复线程，并跟踪未读/运行中状态。
- 通过 worktree 和 clone agent 实现隔离工作；worktree 存放在应用数据目录下（兼容旧版 `.codex-worktrees`）。
- 线程管理能力包括：置顶、重命名、归档、复制、按线程保存草稿，以及停止/中断进行中的 turn。
- 支持可选的远程后端（daemon）模式，可在另一台机器上运行 Codex。
- 为自托管连接提供远程配置辅助（TCP 模式下的 Tailscale 检测与主机引导）。

### Composer 与 Agent 控制

- 支持图片附件输入（文件选择、拖拽、粘贴），并可配置运行中追发消息行为（`Queue` 或 `Steer`）。
- 使用 `Shift+Cmd+Enter`（macOS）或 `Shift+Ctrl+Enter`（Windows/Linux）可对单条消息发送相反的追发动作。
- 支持 skills（`$`）、prompts（`/prompts:`）、review（`/review`）和文件路径（`@`）自动补全。
- 支持模型选择、协作模式（启用时）、推理强度、访问模式以及上下文使用环形指示。
- 可渲染 reasoning/tool/diff 项，并处理审批提示。

### Git 与 GitHub

- 提供 diff 统计、已暂存/未暂存文件 diff、revert/stage 控制和提交日志。
- 分支列表支持 checkout/create，并显示与上游的 ahead/behind 计数。
- 通过 `gh` 集成 GitHub Issues 和 Pull Requests（列表、diff、评论），并可在浏览器中打开提交和 PR。
- PR composer 支持 “Ask PR”，可将 PR 上下文发送到新 agent 线程中。

### 文件与 Prompt

- 文件树支持搜索、文件类型图标，以及在 Finder/Explorer 中定位。
- Prompt 库支持全局/工作区 prompt 的创建、编辑、删除、移动，并可在当前线程或新线程中运行。

### UI 与体验

- 侧边栏、右侧面板、计划面板、终端面板、调试面板支持拖拽调整大小，并持久化尺寸。
- 提供桌面、平板、手机三套响应式布局与标签页导航。
- 侧边栏显示账户限额的使用量/额度计量，以及首页的使用量快照。
- 提供多标签终端 dock，用于后台命令（实验性）。
- 支持应用内更新（通过 toast 下载/安装）、调试面板复制/清空、声音通知，以及平台相关窗口效果（macOS 覆盖式标题栏与毛玻璃）和降低透明度开关。

## 环境要求

- Node.js + npm
- Rust toolchain（stable）
- CMake（原生依赖必需）
- 已安装 Codex CLI，并且 `PATH` 中可直接使用 `codex`（或在应用/工作区设置中配置自定义 Codex 可执行文件）
- Git CLI（用于 worktree 操作）
- GitHub CLI（`gh`，GitHub Issues/PR 集成可选）

如果遇到原生构建错误，执行：

```bash
npm run doctor
```

## 快速开始

安装依赖：

```bash
npm install
```

开发模式运行：

```bash
npm run tauri:dev
```

## iOS 支持（开发中）

iOS 支持目前仍在持续完善中。

- 当前状态：移动端布局可运行，远程后端流程已接通，iOS 默认使用远程后端模式。
- 当前限制：终端在移动端本地后端不可用；连接远程 daemon 时通过 daemon 终端 RPC 使用。
- 桌面端行为不变：macOS/Linux/Windows 仍然默认以本地优先方式运行，除非显式选择远程模式。

### iOS + Tailscale 配置（TCP）

当你需要让 iOS 应用通过 Tailscale tailnet 连接到桌面端托管的 daemon 时，使用本流程。
规范操作文档见：`docs/mobile-ios-tailscale-blueprint.md`。

1. 在桌面端和 iPhone 上安装并登录 Tailscale（加入同一个 tailnet）。
2. 在桌面版 CodexMonitor 中打开 `Settings > Server`。
3. 设置 `Remote backend token`。
4. 在 `Mobile access daemon` 中点击 `Start daemon` 启动桌面端 daemon。
5. 在 `Tailscale helper` 中使用 `Detect Tailscale`，记录建议主机名（例如 `your-mac.your-tailnet.ts.net:4732`）。
6. 在 iOS 版 CodexMonitor 中打开 `Settings > Server`。
7. 输入桌面端的 Tailscale 主机名和同一个 token。
8. 点击 `Connect & test`，确认连接成功。

说明：

- iOS 连接期间，桌面端 daemon 必须保持运行。
- 如果测试失败，请确认两台设备都在线且已连接到 Tailscale，并检查 host/token 是否一致。

### 无桌面 UI 的 Daemon 管理

如果你希望在不保持桌面应用常驻的情况下使用 iOS 远程模式，可以使用独立的 daemon 控制 CLI。

构建二进制：

```bash
cd src-tauri
cargo build --bin codex_monitor_daemon --bin codex_monitor_daemonctl
```

示例：

```bash
# 查看当前 daemon 状态
./target/debug/codex_monitor_daemonctl status

# 使用 settings.json 中的 host/token 启动 daemon
./target/debug/codex_monitor_daemonctl start

# 停止 daemon
./target/debug/codex_monitor_daemonctl stop

# 打印等效的 daemon 启动命令
./target/debug/codex_monitor_daemonctl command-preview
```

常用覆盖参数：

- `--data-dir <path>`：包含 `settings.json` / `workspaces.json` 的应用数据目录
- `--listen <addr>`：覆盖绑定地址
- `--token <token>`：覆盖 token
- `--daemon-path <path>`：显式指定 `codex-monitor-daemon` 二进制路径
- `--json`：输出机器可读格式

### iOS 前置条件

- 已安装 Xcode 和 Command Line Tools。
- 已安装 Rust iOS targets：

```bash
rustup target add aarch64-apple-ios aarch64-apple-ios-sim
# 可选（Intel Mac 模拟器构建）：
rustup target add x86_64-apple-ios
```

- 已配置 Apple 签名（development team）。
  - 优先在 `src-tauri/tauri.ios.local.conf.json` 中设置 `bundle.iOS.developmentTeam` 和 `identifier`，适合本机本地配置，或
  - 直接在 `src-tauri/tauri.ios.conf.json` 中设置，或
  - 通过设备脚本传入 `--team <TEAM_ID>`。
  - 若存在 `src-tauri/tauri.ios.local.conf.json`，`build_run_ios*.sh` 和 `release_testflight_ios.sh` 会自动合并它。

### 在 iOS 模拟器上运行

```bash
./scripts/build_run_ios.sh
```

参数：

- `--simulator "<name>"`：指定模拟器。
- `--target aarch64-sim|x86_64-sim`：覆盖架构。
- `--skip-build`：复用现有 app bundle。
- `--no-clean`：保留 `src-tauri/gen/apple/build` 构建目录。

### 在 USB 设备上运行

列出可识别设备：

```bash
./scripts/build_run_ios_device.sh --list-devices
```

在指定设备上构建、安装并启动：

```bash
./scripts/build_run_ios_device.sh --device "<device name or identifier>" --team <TEAM_ID>
```

附加参数：

- `--target aarch64`：覆盖架构。
- `--skip-build`：复用现有 app bundle。
- `--bundle-id <id>`：启动非默认 bundle identifier。

首次连接设备通常需要：

1. iPhone 已解锁，并已信任当前 Mac。
2. iPhone 已开启 Developer Mode。
3. 至少在 Xcode 中完成一次配对和签名授权。

如果签名尚未准备好，可以从脚本流程中打开 Xcode：

```bash
./scripts/build_run_ios_device.sh --open-xcode
```

### iOS TestFlight 发布（脚本化）

使用完整脚本完成归档、上传、配置合规信息、分配 beta 用户组以及提交 beta 审核。

```bash
./scripts/release_testflight_ios.sh
```

脚本会自动从 `.testflight.local.env`（已被 `.gitignore` 忽略）加载发布元数据。
首次配置时，将 `.testflight.local.env.example` 复制为 `.testflight.local.env` 并填入对应值。

## 发布构建

构建生产版 Tauri bundle：

```bash
npm run tauri:build
```

桌面端发布构建会先编译并打包 `codex_monitor_daemon` 和
`codex_monitor_daemonctl` sidecar 二进制，打包后的应用可按远程后端或
restart-safe session 设置自动启动匹配版本的 daemon。

构建产物位于 `src-tauri/target/release/bundle/`（不同平台位于各自子目录）。

### Windows（按需启用）

Windows 构建为可选项，并使用独立的 Tauri 配置文件，以避免 macOS 专用窗口效果影响。

```bash
npm run tauri:build:win
```

构建产物位于：

- `src-tauri/target/release/bundle/nsis/`（安装器 exe）
- `src-tauri/target/release/bundle/msi/`（msi）

注意：在 Windows 上从源码构建时，除了 CMake，还需要 LLVM/Clang（供 `bindgen` / `libclang` 使用）。

## 类型检查

运行 TypeScript 类型检查（不输出构建结果）：

```bash
npm run typecheck
```

注意：`npm run build` 在打包前也会先执行 `tsc`。

## 验证

推荐执行以下验证命令：

```bash
npm run lint
npm run test
npm run typecheck
cd src-tauri && cargo check
```

## 代码导航

如果需要按任务查找文件（“如果你要改 X，就去改 Y”），请参考：

- `docs/codebase-map.md`

## 项目结构

```text
src/
  features/         按功能切分的 UI 与 hooks
  features/app/bootstrap/      应用启动编排
  features/app/orchestration/  应用布局/线程/工作区编排
  features/threads/hooks/threadReducer/  线程 reducer 切片
  services/         Tauri IPC 封装
  styles/           按区域拆分的 CSS
  types.ts          共享类型
src-tauri/
  src/lib.rs        Tauri 应用后端命令注册表
  src/bin/codex_monitor_daemon.rs  远程 daemon JSON-RPC 进程
  src/bin/codex_monitor_daemon/rpc/  daemon RPC 领域处理器
  src/shared/       应用与 daemon 共用的后端核心
  src/shared/git_ui_core/      git/github 共用核心模块
  src/shared/workspaces_core/  workspace/worktree 共用核心模块
  src/workspaces/   workspace/worktree 适配层
  src/codex/        codex app-server 适配层
  src/files/        文件适配层
  tauri.conf.json   窗口配置
```

## 说明

- 工作区数据持久化在应用数据目录下的 `workspaces.json`。
- 应用设置持久化在应用数据目录下的 `settings.json`（包括主题、后端模式/提供方、远程端点/token、Codex 路径、默认访问模式、UI 缩放和追发消息行为）。
- 功能设置支持在 UI 中修改，并在读取/保存时同步到 `$CODEX_HOME/config.toml`（或 `~/.codex/config.toml`）。稳定项包括：协作模式（`features.collaboration_modes`）、personality（`personality`）和后台终端（`features.unified_exec`）。实验项包括：Apps（`features.apps`）。Steering 能力仍遵循 Codex `features.steer`，但默认追发行为由 `Settings → Composer` 控制。
- 应用启动时以及窗口重新获得焦点时，会为每个工作区重新连接并刷新线程列表。
- 线程恢复逻辑通过使用工作区 `cwd` 过滤 `thread/list` 结果完成。
- 选择线程时总会调用 `thread/resume`，以便从磁盘刷新消息。
- 当 CLI session 的 `cwd` 与工作区路径匹配时，它们会显示出来；除非显式恢复，否则不会实时流式更新。
- 应用通过 stdio 使用 `codex app-server`；相关代码见 `src-tauri/src/lib.rs` 和 `src-tauri/src/codex/`。
- 远程 daemon 入口是 `src-tauri/src/bin/codex_monitor_daemon.rs`；RPC 路由位于 `src-tauri/src/bin/codex_monitor_daemon/rpc.rs`，领域处理器位于 `src-tauri/src/bin/codex_monitor_daemon/rpc/`。
- 共享领域逻辑位于 `src-tauri/src/shared/`（尤其是 `src-tauri/src/shared/git_ui_core/` 和 `src-tauri/src/shared/workspaces_core/`）。
- Codex home 的解析顺序为：工作区设置（如果配置了）→ 旧版 `.codexmonitor/` → `$CODEX_HOME`/`~/.codex`。
- worktree agent 存放在应用数据目录下（`worktrees/<workspace-id>`）；仍兼容旧版 `.codex-worktrees/` 路径，且应用不再修改仓库 `.gitignore`。
- UI 状态（面板尺寸、降低透明度开关、最近线程活动）保存在 `localStorage` 中。
- 自定义 prompt 从 `$CODEX_HOME/prompts`（或 `~/.codex/prompts`）加载，并支持可选的 frontmatter 描述/参数提示。

## Tauri IPC 接口面

前端调用位于 `src/services/tauri.ts`，并映射到 `src-tauri/src/lib.rs` 中的命令。当前接口包括：

- 设置/配置/文件：`get_app_settings`、`update_app_settings`、`get_codex_config_path`、`get_config_model`、`file_read`、`file_write`、`codex_doctor`、`menu_set_accelerators`
- 工作区/worktree：`list_workspaces`、`is_workspace_path_dir`、`add_workspace`、`add_clone`、`add_worktree`、`worktree_setup_status`、`worktree_setup_mark_ran`、`rename_worktree`、`rename_worktree_upstream`、`apply_worktree_changes`、`update_workspace_settings`、`remove_workspace`、`remove_worktree`、`connect_workspace`、`list_workspace_files`、`read_workspace_file`、`open_workspace_in`、`get_open_app_icon`
- 线程/turn/review：`start_thread`、`fork_thread`、`compact_thread`、`list_threads`、`resume_thread`、`archive_thread`、`set_thread_name`、`send_user_message`、`turn_interrupt`、`respond_to_server_request`、`start_review`、`remember_approval_rule`、`get_commit_message_prompt`、`generate_commit_message`、`generate_run_metadata`
- 账户/模型/协作：`model_list`、`account_rate_limits`、`account_read`、`skills_list`、`apps_list`、`collaboration_mode_list`、`codex_login`、`codex_login_cancel`、`list_mcp_server_status`
- Git/GitHub：`get_git_status`、`list_git_roots`、`get_git_diffs`、`get_git_log`、`get_git_commit_diff`、`get_git_remote`、`stage_git_file`、`stage_git_all`、`unstage_git_file`、`revert_git_file`、`revert_git_all`、`commit_git`、`push_git`、`pull_git`、`fetch_git`、`sync_git`、`list_git_branches`、`checkout_git_branch`、`create_git_branch`、`get_github_issues`、`get_github_pull_requests`、`get_github_pull_request_diff`、`get_github_pull_request_comments`
- Prompt：`prompts_list`、`prompts_create`、`prompts_update`、`prompts_delete`、`prompts_move`、`prompts_workspace_dir`、`prompts_global_dir`
- 终端/通知/使用量：`terminal_open`、`terminal_write`、`terminal_resize`、`terminal_close`、`send_notification_fallback`、`is_macos_debug_build`、`local_usage_snapshot`
- 远程后端辅助：`tailscale_status`、`tailscale_daemon_command_preview`、`tailscale_daemon_start`、`tailscale_daemon_stop`、`tailscale_daemon_status`
