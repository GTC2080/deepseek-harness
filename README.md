# DeepSeek Harness Desktop

English | [中文](README.zh.md)

DeepSeek Harness Desktop packages [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) as a native application for Windows and macOS. End users can open the existing Web UI without installing Node.js or running startup commands in a terminal.

This repository is an independently maintained desktop distribution, not an official DeepSeek release. The upstream harness, plugin graph, and Web UI remain the product core; the desktop layer is responsible for native startup, loopback runtime lifecycle, platform integration, and installer packaging.

## Architecture

The application uses Tauri and the operating system WebView instead of bundling Chromium. A packaged sidecar starts `dsh web` on an operating-system-selected random `127.0.0.1` port, the native shell validates the readiness endpoint, and the WebView loads the same interface used by the browser version. Closing the application also terminates the sidecar.

This design avoids a duplicated browser runtime while keeping desktop-specific code narrow enough to follow upstream development without maintaining a separate UI implementation.

## Release status

The current stable release includes:

- The macOS Apple Silicon DMG has been validated for startup, page loading, application shutdown, and runtime cleanup.
- Windows x64 NSIS and MSI installers are available. Windows CI validates desktop behavior, the native shell, the packaged folder-dialog worker, and installer production.
- The packaged application contains the plugins shipped by this repository. Adding out-of-tree Node.js plugins requires a new build.
- The macOS package is not notarized, the Windows installers are not code-signed, and automatic updates are not included.

## Download

The current macOS Apple Silicon and Windows x64 packages are available on [GitHub Releases](https://github.com/GTC2080/deepseek-harness-desktop/releases). For Windows, use the NSIS `.exe` for a normal installation or the `.msi` when that format is required; only one installer is needed. Verify the attached SHA-256 checksums before installation.

<a id="run"></a><a id="run-from-source"></a>

## Build from source

Building requires Node.js, pnpm, Rust, and the native toolchain for the target platform. Build macOS artifacts on macOS and Windows artifacts on Windows:

```sh
pnpm install
pnpm run desktop:build
```

Detailed prerequisites, runtime behavior, and platform notes are documented in the [desktop build guide](desktop/README.md).

## Maintenance model

The desktop implementation reuses the upstream Web UI and plugin system. Platform-specific maintenance stays limited to application lifecycle, desktop integrations, and packaging so upstream changes can be incorporated without duplicating product behavior.

## Upstream and license

The core project is developed by [DeepSeek AI](https://deepseek.com). This repository provides independent desktop packaging around it. The code is available under the [MIT License](LICENSE), with dependency notices in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
