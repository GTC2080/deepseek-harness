# Desktop application

English | [中文](README.zh.md)

DeepSeek Harness ships a lightweight Tauri shell for Windows and macOS. Tauri uses the operating system WebView instead of bundling Chromium; the existing Harness Web runtime remains the application backend and is packaged as a native sidecar, so end users do not need Node.js, pnpm, or Rust.

## Supported targets

- macOS: Apple Silicon and Intel build mappings are available; the Apple Silicon package is verified locally.
- Windows: x64 and ARM64 build mappings are available; build and installer validation must run on their matching Windows hosts.
- Builds are native-host only. Build macOS artifacts on macOS and Windows artifacts on Windows.

## Prerequisites

- Install the repository's normal Node.js and pnpm dependencies before building.
- On macOS, install the stable Rust toolchain and Xcode Command Line Tools.
- On Windows, install the stable MSVC Rust toolchain, Microsoft C++ Build Tools, and WebView2 build prerequisites.

## Build

Build the production Web application, the closed Node SEA sidecar, and the native installer with:

```sh
pnpm run desktop:build
```

Artifacts are written below `src-tauri/target/release/bundle/`. The sidecar builder deliberately targets only the current operating system and architecture.

For an unpackaged development window, use:

```sh
pnpm run desktop:dev
```

Both commands rebuild the application and sidecar; they are release-oriented commands, not watch processes.

## Runtime model

The Tauri window opens a local startup page, launches the packaged `dsh web` sidecar on `127.0.0.1` with an operating-system-selected port, validates the exact loopback readiness URL, and then navigates the system WebView to it. The startup page has no Tauri JavaScript capability or native command surface.

Desktop state is stored in the operating system application-data directory under the `ai.deepseek.harness` identifier. Closing the main window exits the application and terminates the sidecar.

The closed executable contains the shipped plugin graph. Installing additional out-of-tree Node plugins into this desktop build is not supported; add and validate a plugin in the repository before producing a new desktop package.

## Distribution boundary

- The macOS development package is ad-hoc signed so the complete bundle and its sidecars can be validated locally. Public macOS distribution still requires a Developer ID signature and notarization.
- A public Windows installer still requires Windows code signing and validation on Windows.
- Automatic updates are not included.
- The verified macOS Apple Silicon build is approximately 235 MB as an application bundle and 67 MB as a DMG. Sizes vary by target and release contents.
