# DeepSeek Harness Desktop

English | [中文](README.zh.md)

I made this desktop edition of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) for one simple reason: I want to open it like a normal app, without asking every user to install Node.js, open a terminal, and remember startup commands.

This is an independent desktop package I maintain on top of the upstream project, not an official DeepSeek release. I keep the original harness and plugin system intact. The desktop layer only starts the local runtime, opens the interface, and shuts everything down with the window.

## Why I chose Tauri

I did not choose Electron because I do not want to bundle another full copy of Chromium for a local interface. This edition uses Tauri and the operating system's WebView. The runtime travels with the app and listens only on a random `127.0.0.1` port, so users do not need to install Node.js separately.

"Lightweight" does not mean pretending the whole app can fit into a few megabytes. DeepSeek Harness and its runtime still take real space. My goal is simpler: avoid duplicated browser machinery and keep the desktop layer small, understandable, and easy to maintain.

## Can I use it now?

Yes, but I treat it as a preview rather than a finished public release.

- I have tested the macOS Apple Silicon build end to end, including startup, page loading, window shutdown, and runtime cleanup.
- The Windows x64 and ARM64 build paths are in place, but I have not yet verified the installer on a real Windows machine.
- The packaged app contains the plugins shipped by this repository. Adding outside Node.js plugins still requires rebuilding the app.
- The macOS package is not notarized, Windows code signing is not complete, and automatic updates are not included.

<a id="run"></a><a id="run-from-source"></a>

## Build it yourself

For now, this repository provides source code rather than an officially signed installer. If you want to try it, install Node.js, pnpm, and Rust, then build on the operating system you want to package:

```sh
pnpm install
pnpm run desktop:build
```

The detailed prerequisites and platform notes live in the [desktop build guide](desktop/README.md).

## What I want this project to stay

I do not want this to turn into another large framework. I want it to remain a practical desktop home for DeepSeek Harness: easy to open, local by default, honest about what is ready, and no heavier than it needs to be.

## Upstream and license

The core project is developed by [DeepSeek AI](https://deepseek.com). This repository adds the independent desktop packaging around it. The code is available under the [MIT License](LICENSE), with dependency notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
