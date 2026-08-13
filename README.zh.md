# DeepSeek Harness Desktop

[English](README.md) | 中文

DeepSeek Harness Desktop 将 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 打包成适用于 Windows 和 macOS 的原生桌面应用。最终用户无需另行安装 Node.js，也不需要在终端运行启动命令，即可打开现有 Web UI。

本仓库是独立维护的桌面发行版，并非 DeepSeek 官方发行版。上游 Harness、插件图和 Web UI 仍是产品核心；桌面层负责原生启动、本地 loopback 运行时生命周期、平台集成和安装包生成。

## 架构

应用使用 Tauri 和操作系统 WebView，不会随应用重复打包 Chromium。随应用提供的 sidecar 会在操作系统分配的随机 `127.0.0.1` 端口上启动 `dsh web`；原生壳验证就绪端点后，由 WebView 加载与浏览器版本相同的界面。退出应用时，sidecar 也会一并终止。

这种设计避免重复携带浏览器运行时，同时将桌面端专属代码控制在较小范围内，以便持续跟随上游开发，而不需要维护另一套 UI 实现。

## 发布状态

当前提供的是预览版安装包：

- macOS Apple Silicon DMG 已完成启动、页面加载、应用退出和运行时清理验证。
- Windows x64 提供 NSIS 与 MSI 安装程序。Windows CI 会验证桌面行为、原生壳、打包后的文件夹选择器 worker 和安装包构建。
- 打包后的应用包含本仓库随附的插件。加入仓库外 Node.js 插件需要重新构建应用。
- macOS 安装包尚未完成 notarization，Windows 安装程序尚未进行代码签名，当前也不包含自动更新。

## 下载

当前 macOS Apple Silicon 和 Windows x64 预览安装包可从 [GitHub Releases](https://github.com/GTC2080/deepseek-harness-desktop/releases) 下载。Windows 普通安装建议使用 NSIS `.exe`，需要 MSI 格式时使用 `.msi`；两者选择一个即可。安装前请核对 Release 中提供的 SHA-256。

<a id="run"></a><a id="run-from-source"></a>

## 从源码构建

构建需要 Node.js、pnpm、Rust 以及目标平台对应的原生工具链。macOS 产物应在 macOS 上构建，Windows 产物应在 Windows 上构建：

```sh
pnpm install
pnpm run desktop:build
```

完整的前置条件、运行机制和平台说明见[桌面端构建文档](desktop/README.md)。

## 维护方式

桌面端直接复用上游 Web UI 和插件体系。平台专属维护范围限制在应用生命周期、桌面集成和打包流程，使上游更新可以持续合入，而不需要重复实现产品功能。

## 上游项目与许可证

核心项目由 [DeepSeek AI](https://deepseek.com) 开发，本仓库在其基础上提供独立桌面封装。代码使用 [MIT License](LICENSE)，第三方依赖说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
