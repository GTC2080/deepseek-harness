# DeepSeek Harness Desktop

[English](README.md) | 中文

我做这个桌面版本的原因很简单：我希望 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 能像普通软件一样直接打开，而不是让每个使用者都先安装 Node.js、打开终端，再记住一串启动命令。

这是我基于上游项目维护的独立桌面封装，并不是 DeepSeek 官方发行版。我没有重写原来的 Harness 和插件体系；桌面层只负责启动本地运行时、打开界面，并在窗口关闭时把相关进程一起干净地结束。

## 为什么选择 Tauri

我没有选择 Electron，因为我不想为了一个本地界面再打包一整套 Chromium。这个版本使用 Tauri 和操作系统自带的 WebView。运行时会随应用一起提供，并且只监听随机的 `127.0.0.1` 端口，所以普通用户不需要另外安装 Node.js。

我说的“轻量”并不是假装整个软件可以被压缩到几 MB。DeepSeek Harness 和它的运行时本身仍然有真实体积。我的目标更实际：不重复打包浏览器，也尽量让桌面层保持简单、透明和容易维护。

## 现在能用吗？

可以，但我更愿意把它称为预览版，而不是已经完成公开分发准备的正式版本。

- macOS Apple Silicon 版本已经完整验证过，包括启动、页面加载、关闭窗口和运行时清理。
- Windows x64 与 ARM64 的构建路径已经接好，但我还没有在真实 Windows 机器上验证安装程序。
- 打包后的应用包含这个仓库随附的插件；如果要加入仓库外的 Node.js 插件，目前仍然需要重新构建应用。
- macOS 包尚未 notarize，Windows 代码签名也没有完成，并且当前不包含自动更新。

## 下载

第一个 macOS Apple Silicon 预览安装包已经放在 [GitHub Releases](https://github.com/GTC2080/deepseek-harness-desktop/releases)。我会把它标记为 prerelease，因为它目前只使用 ad-hoc 签名，并且尚未 notarize。打开前请先核对随附的 SHA-256。

<a id="run"></a><a id="run-from-source"></a>

## 自己构建

如果你需要其他平台，或者希望自己在本地构建，请安装 Node.js、pnpm 和 Rust，然后在希望打包的操作系统上运行：

```sh
pnpm install
pnpm run desktop:build
```

完整的前置条件和平台说明放在[桌面端构建文档](desktop/README.md)里。

## 我希望它保持什么样子

我不希望这个项目最后又变成一套庞大的框架。我希望它一直是 DeepSeek Harness 一个实用的桌面入口：打开简单、默认在本地运行、对完成度保持诚实，并且只保留真正需要的重量。

## 上游项目与许可证

核心项目由 [DeepSeek AI](https://deepseek.com) 开发，这个仓库在它的基础上加入独立桌面封装。代码使用 [MIT License](LICENSE)，第三方依赖说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
