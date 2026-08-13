# 桌面应用

[English](README.md) | 中文

DeepSeek Harness 为 Windows 与 macOS 提供轻量的 Tauri 壳。Tauri 使用操作系统 WebView，不会随应用打包 Chromium；现有 Harness Web 运行时仍是应用后端，并被打包为原生 sidecar，因此最终用户不需要安装 Node.js、pnpm 或 Rust。

## 支持的目标

- macOS：已提供 Apple Silicon 与 Intel 构建映射；Apple Silicon 包已在本机验证。
- Windows：已提供 x64 与 ARM64 构建映射；构建和安装程序验证必须在对应的 Windows 宿主上运行。
- 仅支持原生宿主构建。macOS 产物在 macOS 上构建，Windows 产物在 Windows 上构建。

## 前置条件

- 构建前，按仓库常规流程安装 Node.js 与 pnpm 依赖。
- 在 macOS 上，安装稳定版 Rust 工具链和 Xcode Command Line Tools。
- 在 Windows 上，安装稳定版 MSVC Rust 工具链、Microsoft C++ Build Tools 和 WebView2 构建前置组件。

## 构建

使用以下命令构建生产 Web 应用、封闭式 Node SEA sidecar 和原生安装程序：

```sh
pnpm run desktop:build
```

产物写入 `src-tauri/target/release/bundle/`。sidecar 构建器有意只面向当前操作系统和架构。

如需启动未打包的开发窗口，请使用：

```sh
pnpm run desktop:dev
```

两个命令都会重新构建应用和 sidecar；它们面向发布构建，不是 watch 常驻进程。

## 运行时模型

Tauri 窗口先打开本地启动页，在 `127.0.0.1` 上使用操作系统分配的端口启动已打包的 `dsh web` sidecar，严格校验 loopback 就绪 URL，然后让系统 WebView 导航至该地址。启动页不具备任何 Tauri JavaScript capability 或原生命令接口。

在 macOS 上，loopback 端口会随每次启动变化。因此，桌面客户端会在 Web 常规启动前恢复上次选中的 Session，并通过应用 WebView 的主机级存储同步后续选择。首次迁移还没有持久桌面选择时，会打开最近更新的非空白 Session，而不会创建一个只在启动时出现的空白草稿。Session Log 下载仍由 WebView 下载管理器处理；原生壳会把完成状态和实际保存文件名反馈给现有 Web 弹窗。

桌面状态存储在操作系统应用数据目录中，使用 `ai.deepseek.harness` 标识符。关闭主窗口或退出应用时，会先终止 sidecar，再结束桌面进程。

封闭式可执行文件包含仓库随附的插件图。此桌面构建不支持额外安装仓库外 Node 插件；请先在仓库中加入并验证插件，再生成新的桌面包。

## 分发边界

- macOS 开发包使用 ad-hoc 签名，以便在本地验证完整 bundle 及其 sidecar。公开分发 macOS 版本仍需 Developer ID 签名和 notarization（公证）。
- 公开分发 Windows 安装程序仍需 Windows 代码签名，并在 Windows 上完成验证。
- 当前不包含自动更新。
- 已验证的 macOS Apple Silicon 构建中，应用 bundle 约为 235 MB，DMG 约为 67 MB；实际大小会随目标和发布内容变化。
