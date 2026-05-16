# CodexMonitor Android 远程端开发文档

本文档是 CodexMonitor Android 手机端支持的 canonical 开发计划。

## 范围

- Android App 使用远程后端模式。
- 桌面端 CodexMonitor 运行 TCP mobile access daemon。
- Android 通过 `remoteBackendHost` 和非空 token 连接桌面端 daemon。
- 传输层使用 TCP，网络路径由用户提供，例如 Tailscale、局域网或模拟器 host 转发。
- Android 必须复用现有 mobile remote 架构，不新增 Android 专属后端业务逻辑。

## 不做范围

- 不在 Android 本地运行 Codex 工作流。
- 不启用 Android 本地 terminal session。
- 不新增托管 relay 服务。
- 不把前端拆成独立 Android App。
- 不用 Android 支持替换 iOS 支持；Android 与 iOS 应并存。

## 当前仓库状态

- Tauri CLI 已支持 Android 命令：
  - `npm run tauri -- android init`
  - `npm run tauri -- android dev`
  - `npm run tauri -- android build`
  - `npm run tauri -- android run`
- 共享移动端运行时判断已包含 Android：`cfg!(any(target_os = "ios", target_os = "android"))`。
- `src-tauri/capabilities/default.json` 已包含 `android` capability。
- Android 启动图标资源已存在于 `src-tauri/icons/android/*`。
- iOS 已有完整远程端 runbook；Android 还没有等价的实现和使用文档。
- 当前没有提交 `src-tauri/gen/android` 生成工程。
- 当前没有提交 Android 专属 Tauri 配置或构建脚本。

## 目标架构

1. 桌面端 CodexMonitor 仍然是执行宿主。
2. 桌面端启动带 TCP listener 和 token 的 `codex_monitor_daemon`。
3. Android CodexMonitor 启动后进入 mobile remote 模式。
4. Android 保存 `remoteBackendProvider = "tcp"`、`remoteBackendHost` 和 `remoteBackendToken`。
5. Android 继续调用 `src/services/tauri.ts` 中的前端 IPC wrapper。
6. 移动端 Tauri command 将可远程执行的操作代理到桌面 daemon。
7. 不支持的本地移动端功能必须禁用，或返回清晰的 unsupported 错误。

## 平台契约

Android 必须保持这些现有契约：

- `is_mobile_runtime` 返回 `true`。
- 移动端默认后端模式是 remote。
- 移动端本地 terminal 不可用。
- 移动端运行时允许图片路径转换。
- 桌面端仍然默认 local-first，除非用户显式切换到 remote 模式。
- 桌面 app、daemon 和 mobile app 的 JSON-RPC 方法名与 payload shape 保持稳定。

## 第一阶段：Android 工程初始化

目标：只补 Android 平台脚手架，不改变业务行为。

涉及文件：

- `src-tauri/tauri.android.conf.json`
- `src-tauri/gen/android/*`
- `scripts/build_run_android.ps1`
- `scripts/build_run_android.sh`

任务：

1. 安装 Android Studio、Android SDK、platform tools、build tools 和 NDK。
2. 安装 Rust Android targets：

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
```

3. 初始化 Tauri Android target：

```bash
npm run tauri -- android init
```

4. 新增 `src-tauri/tauri.android.conf.json`，放 Android package identity 和 Android-only overrides。
5. Android package identifier 必须与 desktop/iOS 区分，例如 `com.dimillian.codexmonitor.android`。
6. 确认生成工程足够稳定，可以提交。

验证：

```bash
npm run typecheck
npm run tauri -- android build --debug --config src-tauri/tauri.android.conf.json
```

验收标准：

- `src-tauri/gen/android` 存在。
- debug APK 可以本地构建。
- 桌面端构建行为不变。

## 第二阶段：Android 网络和远程后端

目标：让 Android 连接桌面端 daemon。

涉及文件：

- `src-tauri/src/settings/mod.rs`
- `src-tauri/src/types.rs`
- `src/features/mobile/hooks/useMobileServerSetup.ts`
- `src/features/settings/hooks/useSettingsServerSection.ts`
- `src/features/settings/components/sections/SettingsServerSection.tsx`
- `src/services/tauri.ts`
- `src-tauri/gen/android/*` 下的 Android manifest/config 文件

任务：

1. 确认 Android 具备网络权限。
2. 保持 token 必填。
3. 支持以下 host 格式：
   - Tailscale DNS，例如 `desktop.tailnet.ts.net:4732`
   - 局域网 IP，例如 `192.168.1.20:4732`
   - Android 模拟器访问宿主机，例如 `10.0.2.2:4732`
4. 确认 `Connect & test` 与 iOS 一样走 TCP remote backend 路径。
5. 连接成功后能加载远程 workspace list。

验证：

```bash
npm run test -- src/services/tauri.test.ts
npm run test -- src/features/settings/components/SettingsView.test.tsx
```

手动验证：

1. 在桌面端 `Settings > Server` 启动 daemon。
2. 安装 Android debug APK。
3. 打开 Android `Settings > Server`。
4. 输入 host 和 token。
5. 点击 `Connect & test`。
6. 确认 workspace list 能加载。

验收标准：

- Android 可以通过 TCP 连接桌面端 daemon。
- token 错误时有清晰认证错误。
- 网络不可达时有清晰连接错误。

## 第三阶段：Android 移动端体验

目标：让现有响应式前端在 Android 设备上可用。

涉及文件：

- `src/main.tsx`
- `src/features/layout/hooks/useLayoutMode.ts`
- `src/features/app/components/MainApp.tsx`
- `src/features/composer/components/ComposerInput.tsx`
- `src/styles/compact-phone.css`
- `src/styles/tabbar.css`
- `src/styles/composer.css`
- `src/styles/messages.css`
- `src/styles/settings.css`
- `src/styles/mobile-setup-wizard.css`

任务：

1. 验证 Android WebView 键盘弹出后的 resize 行为。
2. 输入时 composer 必须保持可见。
3. 保持底部 safe-area 行为。
4. 窄屏设置页使用 mobile master/detail flow。
5. 大 command output、大 diff、长文件树默认必须 bounded。
6. Android touch 流程不能依赖 hover-only 控件。
7. copy button、menu、modal 都必须可触摸访问。

验证：

```bash
npm run test -- src/features/settings/components/SettingsView.test.tsx
npm run test -- src/features/composer/components/ComposerSend.test.tsx
npm run test -- src/features/messages/components/Messages.test.tsx
npm run typecheck
```

手动验证：

- Pixel 7 或类似模拟器。
- 小屏低分辨率模拟器。
- 如条件允许，使用真实 Android 设备。
- 优先验证竖屏；横屏是次要目标。

验收标准：

- 用户能在 Android 上选择 workspace、打开 thread、发送消息、查看输出、修改 Server 设置。
- 键盘不会遮挡 composer。
- 主导航在触摸设备上可用。

## 第四阶段：Android 构建脚本

目标：提供稳定的本地开发和构建命令。

涉及文件：

- `scripts/build_run_android.ps1`
- `scripts/build_run_android.sh`
- `README.md`

PowerShell 脚本要求：

- 检查 `ANDROID_HOME` 或 `ANDROID_SDK_ROOT`。
- 检查 `adb` 是否可用。
- 检查 Rust Android targets。
- 开发模式运行 `npm run tauri -- android dev`。
- 支持 `--build-only`。
- 支持 `--device <serial>`。
- 构建结束后打印 APK 路径。

Shell 脚本要求：

- 行为与 PowerShell 脚本一致，供 macOS/Linux 开发者使用。
- 不写入机器本地绝对路径。

验收标准：

- Windows 开发者可以从 PowerShell 跑 Android dev flow。
- macOS/Linux 开发者可以从 shell 跑 Android dev flow。
- 缺少前置条件时脚本能尽早失败，并给出清晰错误。

## 第五阶段：文档

目标：补齐 Android 用户和开发者文档。

涉及文件：

- `docs/android-remote-development.md`
- `docs/mobile-remote-runbook.md`
- `docs/codebase-map.md`
- `README.md`

任务：

1. 本文档保持为 Android 实现计划。
2. 新增 `docs/mobile-remote-runbook.md`，作为 iOS/Android 共用用户配置文档。
3. iOS 签名和 TestFlight 内容继续留在 iOS 文档。
4. Android 模拟器、APK、AAB、Play Store 内容放到 Android 相关文档。
5. 从 `docs/codebase-map.md` 链接 Android 文档。

验收标准：

- 开发者有唯一 Android 实现计划。
- 用户有唯一 mobile remote 配置 runbook。
- iOS-only 内容不混入 Android-only 指令。

## Android 配置清单

- `src-tauri/tauri.android.conf.json`
  - `identifier`
  - 如需区分桌面端，配置 Android app name
  - 如需覆盖，配置 Android icon mapping
- Android manifest
  - internet permission
  - LAN 开发 cleartext traffic 决策
  - app label
  - launcher activity
- Android network security
  - Tailscale DNS 与 TCP 连接必须可用
  - cleartext LAN access 默认只作为开发选项，除非明确接受生产风险
- 构建产物
  - debug APK
  - release APK
  - 如需分发，生成 AAB

## 后端一致性检查清单

当某个 mobile remote 功能在 Android 上不可用时，按这个顺序检查：

1. `src/features/**` 中的前端调用点。
2. `src/services/tauri.ts` 中的前端 IPC wrapper。
3. `src-tauri/src/lib.rs` 中的 Tauri command 注册。
4. `cfg(any(target_os = "android", target_os = "ios"))` 下的移动端 command 实现。
5. `src-tauri/src/remote_backend.rs` 中的 remote backend forwarding。
6. `src-tauri/src/bin/codex_monitor_daemon/rpc.rs` 中的 daemon RPC 路由。
7. `src-tauri/src/bin/codex_monitor_daemon/rpc/*` 下的领域 handler。
8. `src-tauri/src/shared/*` 下的共享 core。

不要在 Android 专属文件里复制领域逻辑。

## 功能矩阵

| 功能 | Android 目标 |
| --- | --- |
| 远程后端连接 | 必须支持 |
| Workspace list | 必须支持 |
| Thread list 和 message view | 必须支持 |
| 发送 prompt / steer / queue 行为 | 必须支持 |
| Approval 和 user input prompt | 必须支持 |
| 通过远程后端读取文件和显示图片 | 必须支持 |
| Git diff 查看 | 必须支持，默认 bounded |
| Command output 查看 | 必须支持，默认 bounded |
| 本地 terminal | 不支持 |
| 本地 Codex 执行 | 不支持 |
| Android 托管 mobile access daemon | 不支持 |
| Hosted relay | 不在范围内 |

## 发布前检查清单

分发 Android 构建前必须确认：

1. release APK/AAB 可以构建。
2. package identifier 正确。
3. app icon 和 label 正确。
4. 真实 Android 设备上远程连接可用。
5. token 错误路径可用。
6. 网络错误路径可用。
7. 后台/前台恢复行为可用。
8. composer 和 settings 表单的键盘行为可用。
9. 大 output 和大 diff 渲染受控。
10. 桌面 daemon 仍然是唯一执行宿主。

## 风险

- Android WebView 键盘 resize 可能需要 Android 专属布局修复。
- Android cleartext network policy 可能阻止局域网 TCP 开发连接。
- 低端 Android 设备可能难以承受长历史消息和大 diff。
- Tauri Android 生成工程文件可能噪声较多，只提交稳定生成文件。
- 如果前端路径假设本地文件系统可用，remote backend 可能暴露缺口。

## Android MVP 验收标准

- 可以从仓库构建 Android debug APK。
- Android App 可以在模拟器和至少一台真实设备上启动。
- Android App 启动后进入 remote backend 模式。
- 用户可以输入 host/token，并通过连接测试。
- Workspace list 可以从桌面 daemon 加载。
- 用户可以打开 workspace、查看 thread、发送 prompt、接收 streamed output。
- 不支持的本地 terminal 行为清晰且不会崩溃。
- `npm run typecheck` 通过。
- settings、composer、messages、Tauri IPC 的 focused frontend tests 通过。
