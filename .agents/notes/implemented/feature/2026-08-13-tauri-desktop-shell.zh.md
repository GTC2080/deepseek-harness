# Agent Note: 基于 loopback Web 运行时的 Tauri 桌面壳

Status: implemented

[English](2026-08-13-tauri-desktop-shell.md) | 中文

## 问题

Windows 与 macOS 用户需要无需预先安装 Node.js 工具链即可使用的 DeepSeek Harness 安装包。Electron 壳能提供这种体验，但也会附带第二套浏览器引擎，并增加启动耗时、内存、包体积和安全更新成本。

构建后的 Web 文件不是独立应用。`dsh web` 会注入运行时启动 manifest，托管 API 与插件 bundle，并承载 WebSocket 流量。直接在 WebView 中加载 `apps/web/dist` 只会显示不完整的静态文件，同时绕过现有宿主生命周期。

Node 后端也不能继续作为外部前置条件。实测生产部署在尚未加入约 115 MB 的 Node 可执行文件前，就已占用约 328 MB、包含超过 31,000 个文件；这种布局既不能形成小型安装包，也不适合作为稳健的桌面应用结构。

## 决策

桌面应用是在 `src-tauri/` 中实现的 Tauri v2 壳。Tauri 提供原生窗口与操作系统 WebView；它不会替换或复制现有 Web 客户端或 HTTP 载体。

`scripts/build-desktop-sidecar.ts` 会构建仓库、创建生产部署闭包、补回其中必需的 dependency 与 peer dependency 闭包、拒绝残留符号链接，并把该闭包编译为当前原生宿主的单个 Node SEA 可执行文件。Tauri 将其作为 `dsh-backend` external binary 打包。macOS 还会把 node-pty 的 `dsh-backend-spawn-helper` 放在旁边，因为 node-pty 根据 `process.execPath` 查找该可执行文件。

生产部署步骤会在执行前保存、执行后恢复 pnpm 的根工作区状态。否则，pnpm 会把仅属于 staging 的 hoisted production 设置记到开发 checkout 上，并在下一个无交互命令中尝试重装 production 依赖。

桌面壳先打开本地静态加载页，创建操作系统应用数据目录，再以该目录作为 `DSH_HOME` 和工作目录启动 `dsh web --host 127.0.0.1 --port 0`。它只接受精确的就绪前缀，以及紧随其后的无凭据 `http://127.0.0.1:<非零端口>/` origin，然后才让 WebView 导航。45 秒超时、进程过早退出、畸形就绪输出和导航失败都会作为可见启动错误保留下来。关闭主窗口或正常请求退出应用时，会先停止受管子进程，再结束桌面进程。

在 macOS 与 Windows 上，由 Rust 创建配置好的 WebView，以便在首次导航前安装两类范围严格的原生到 Web 信号。平台标记让客户端在随机端口的 `localStorage` origin 与应用 WebView 的主机级 cookie 之间同步经校验、具有大小限制的当前 Session selection。首次迁移没有持久 selection 时，启动流程会从最近活跃 Workspace 中选择最近更新、未归档的非空白 Session，而不是创建一个临时空白 Session。下载标记则让现有 Session Log 控制器等待 WebView 下载完成并显示实际保存文件名；ZIP 流与目标位置仍由既有 Web 下载路径负责。

封闭式运行时设置 `DSH_CLOSED_RUNTIME=1`。其根 Loader 与 bootstrap Include 从可执行文件的安装锚点解析随附 bare 插件，不会从可写 profile 目录解析。客户端模块 host 会先从 profile、再从 Loader 的安装锚点解析每个浏览器插件；因此，随附的浏览器 bundle 会始终留在 SEA 虚拟文件系统内，不依赖指向虚拟路径的操作系统链接。profile 的仅配置 HMR 实例仍监听用户 patch 文件，但其空模块根 watcher 会明确以真实 profile 目录为基础，而不是以可执行文件的虚拟 snapshot 路径为基础。

Agent 预设发现流程只读取目录名，再对每个候选项执行 `lstat`，并保留目录符号链接不会成为预设行的既有规则。这样可以在普通文件系统和 SEA 虚拟文件系统上保持相同 roster 约定；后者的目录项不带 Node `Dirent` 方法。共享 Web 设置行会把 roster 读取失败显示为带重试操作的明确错误；加载失败后的空选择不会继续标为正在加载。

## 打包边界

构建流程把 macOS 与 Windows 的 x64／ARM64 宿主映射到各自原生 Rust 和 SEA 目标。它有意不做交叉编译或发布：每个操作系统分别构建并验证自己的包。生成的 sidecar 与 Rust target 仍是被忽略的构建产物；Tauri 源码、Cargo lock、图标和加载页则进入版本控制。

封闭式可执行文件支持仓库随附的插件图。运行时安装仓库外 Node 插件不属于此桌面约定，因为 bare 插件解析被有意锚定在可执行文件内部。

签名、公证、Windows 安装程序签名、自动更新、CI 发布和可移植 Linux 包属于独立发布事项。本地 macOS 构建使用 ad-hoc 签名。其 Hardened Runtime entitlement 仅保留 Node/V8 的 JIT 代码和内嵌原生库所需权限。

## 安全边界

加载页采用严格的 Content Security Policy，并且没有任何 Tauri JavaScript capability 或原生命令 API。Rust 负责 sidecar 启动与导航。选定 URL 无法把启动导航转向其他主机、scheme、带凭据 authority、固定特权端口、路径、query 或 fragment。selection cookie 上限为 2 KiB，只接受当前 Session／subagent selection 结构，不包含 API key、文件系统路径、prompt 或 Session 内容。下载桥只接受 loopback 上的 `/api/session.export` URL，并在执行固定的事件分发脚本前把原生事件数据序列化为 JSON。

应用仍会在临时 loopback 端口上向本地进程公开现有 Harness HTTP 服务。随机选择端口可以减少冲突，但它不是认证，也不被视为 trust boundary。本设计不会新增 LAN listener，也不会增加从 Web 内容到原生层的 IPC 桥。

## 验证

聚焦的 app-boot 回归测试证明，bootstrap bare 插件和动态创建的 bare 插件都会从封闭式运行时安装锚点解析，不会命中可写 profile 中的同名包。客户端模块回归测试分别证明 profile 优先解析与已安装运行时回退。Agent 预设发现回归测试复现了虚拟文件系统中 `readdir(..., { withFileTypes: true })` 结果缺少 `Dirent` 方法的情况。共享 Web 设置行回归测试证明，初次加载 roster 失败时会显示重试控件，而不会一直显示加载标签。

每次 sidecar 构建都会从隔离的 `DSH_HOME` 启动编译后的可执行文件，要求注入的启动图包含客户端运行时与 UI 布局包，成功下载两项已声明 bundle，调用 `agentPreset.list`，要求宿主返回非空 roster 且其中存在一个有效默认项，再关闭该进程。探针直接使用宿主返回的 roster，不会写死当前预设 id，因此上游加入新预设时不需要修改桌面端专用目录。即使可执行文件的首页仍返回 HTTP 200，只要它提供空客户端图，或者其打包文件系统无法发现随附预设，这项检查就会失败。

端到端 sidecar 构建后，pnpm 根工作区状态仍表明完整开发安装与 isolated linker。后续普通 `pnpm run` 也能直接执行，不会触发依赖修复安装。

Rust 单元测试接受预期就绪 origin，并拒绝 HTTPS、`localhost`、缺失端口、非根路径和凭据。桌面端测试证明，两种受支持的平台标记都会在导航前注入，且原生下载桥只接受 loopback Session 导出，并会在事件分发前对文件名进行 JSON 转义。客户端回归测试覆盖无效或超大 selection cookie、macOS 与 Windows 跨端口恢复、首次迁移回退、普通浏览器隔离、原生下载完成、防重名文件名和原生下载失败。连续两次使用不同 loopback 端口启动开发版，都会恢复同一个真实 Session，不再显示仅在启动时出现的 New Session 行。

生产 macOS arm64 应用与 DMG 均成功构建，严格 deep 代码签名验证通过。通过 macOS LaunchServices 启动已打包应用会在 loopback 上启动内置 sidecar；关闭原生窗口或请求退出应用时，两个进程都会退出并释放端口。在本次构建快照中，应用 bundle 约为 235 MB，压缩 DMG 约为 67 MB；sidecar 约为 225 MB，占安装体积的主要部分。

Windows 源码映射、平台专用窗口配置与共享桌面信号已经存在，但无法在 macOS 上完成可执行验证。发布 Windows 安装程序前仍必须进行 Windows 原生构建。

## 考虑过的替代方案

**使用带 IPC 载体的 Electron。** 本次交付不采用该方案，因为打包 Chromium 会复制操作系统浏览器引擎，并增加包体积、运行时内存、启动成本和浏览器补丁成本。未来的其他桌面壳仍可实现 GUI 分层约定所描述的 IPC 载体；当前 Tauri 壳不需要它。

**直接从磁盘加载 `apps/web/dist`。** 不予采用，因为 Web 宿主负责启动 manifest 注入、API 路由、插件 bundle、WebSocket upgrade 和关闭语义。在桌面壳中重建这些约定，比通过 loopback 复用 `dsh web` 更大，也更脆弱。

**同时打包独立 Node 可执行文件和部署目录。** 不予采用，因为实测布局会把大型运行时与数万个文件组合起来，安装字节数也高于 SEA；它还会扩大杀毒软件扫描、安装程序和部分升级的表面积。

**要求用户安装 Node.js。** 不予采用，因为这不能形成可安装桌面产品，会把运行时选择与升级交给用户，并削弱可复现性。

**用 Rust 重写后端。** 不予采用，因为这只会为打包而复制插件运行时、进程与文件系统能力、agent 生命周期、配置和 Web 宿主。Tauri 是窗口与生命周期壳，不是第二套 Harness 实现。

## 后果

桌面应用不附带 Chromium，并复用产品当前 Web 行为。最终用户获得单个原生应用，无需管理 Node.js；平台 WebView 的安全更新仍由操作系统负责。

Node 后端仍占据主要磁盘与内存：Tauri 让桌面壳变轻，并不会让 Harness 运行时消失。SEA 打包是一种封闭部署，某些假定可以运行任意外部 Node 脚本或动态安装包的功能可能继续暴露不兼容；在声称支持之前，这些路径必须接受已打包应用测试。

macOS 会同时签名应用、sidecar 和 node-pty helper。JIT 与 library validation entitlement 是在 Hardened Runtime 下内嵌 V8 的真实安全成本，因此桌面壳有意不向远程 origin 提供任何原生 capability。公开分发必须以平台身份替换 ad-hoc 签名，并完成操作系统专属发布检查。
