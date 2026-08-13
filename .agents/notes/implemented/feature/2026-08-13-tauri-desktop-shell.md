# Agent Note: Tauri desktop shell over the loopback Web runtime

Status: implemented

English | [中文](2026-08-13-tauri-desktop-shell.zh.md)

## Problem

Windows and macOS users need an installable DeepSeek Harness application without first installing a Node.js toolchain. An Electron shell would supply that experience, but it would also ship a second browser engine and add its startup, memory, package-size, and security-update costs.

The built Web files are not a standalone application. `dsh web` injects the runtime boot manifest, hosts the API and plugin bundles, and carries WebSocket traffic. Loading `apps/web/dist` directly in a WebView would display incomplete static files while bypassing the existing host lifecycle.

The Node backend cannot simply remain an external prerequisite. A measured production deployment occupied approximately 328 MB across more than 31,000 files before adding a roughly 115 MB Node executable, which was neither a small installer nor a robust desktop layout.

## Decision

The desktop application is a Tauri v2 shell in `src-tauri/`. Tauri supplies native windows and the operating-system WebView; it does not replace or duplicate the existing Web client or HTTP carrier.

`scripts/build-desktop-sidecar.ts` builds the repository, creates a production deployment closure, restores its required dependency and peer-dependency closure, rejects remaining symbolic links, and compiles that closure into one native-host Node SEA executable. Tauri bundles it as the `dsh-backend` external binary. macOS also bundles node-pty's `dsh-backend-spawn-helper` beside it because node-pty resolves that executable from `process.execPath`.

The production deploy snapshots and restores pnpm's root workspace state. Without that boundary, pnpm records the staging-only hoisted production settings against the development checkout and tries to reinstall production dependencies on the next non-interactive command.

The shell starts a local static loading page, creates the operating-system application-data directory, and launches `dsh web --host 127.0.0.1 --port 0` with that directory as `DSH_HOME` and working directory. It accepts only the exact readiness prefix followed by an uncredentialed `http://127.0.0.1:<nonzero-port>/` origin, then navigates the WebView. A 45-second timeout, early process exit, malformed readiness output, and navigation failure remain visible startup errors. Closing the main window terminates the child and exits the application.

The closed runtime sets `DSH_CLOSED_RUNTIME=1`. Its root Loader and bootstrap Include resolve shipped bare plugins from the executable's installation anchor instead of the writable profile directory. The client-module host resolves each browser plugin from the profile first and then the Loader's installation anchor; shipped browser bundles therefore remain inside the SEA virtual filesystem instead of depending on operating-system links to virtual paths. The profile's config-only HMR instance still watches user patch files, but its empty module-root watcher is explicitly based at the real profile directory rather than the executable's virtual snapshot path.

## Packaging boundary

The build maps macOS and Windows x64/ARM64 hosts to their native Rust and SEA targets. It intentionally does not cross-compile or publish: each operating system builds and validates its own package. Generated sidecars and Rust targets remain ignored build output; the Tauri source, Cargo lock, icons, and loading page are versioned.

The closed executable supports the plugin graph shipped by the repository. Runtime installation of an out-of-tree Node plugin is outside this desktop contract because bare plugin resolution is intentionally anchored inside the executable.

Signing, notarization, Windows installer signing, automatic updates, CI release publication, and a portable Linux package are separate release concerns. The local macOS build uses an ad-hoc signature. Its Hardened Runtime entitlements are limited to the Node/V8 requirements for JIT-generated code and embedded native libraries.

## Security boundary

The loading page has a restrictive Content Security Policy and receives no Tauri JavaScript capability or native command API. Rust owns sidecar launch and navigation. The selected URL cannot redirect startup to another host, scheme, credentialed authority, fixed privileged port, path, query, or fragment.

The application still exposes the existing Harness HTTP service to local processes on an ephemeral loopback port. Random port selection reduces collisions but is not authentication and is not treated as a trust boundary. This design adds no LAN listener and no Web content-to-native IPC bridge.

## Verification

A focused app-boot regression test proves that both bootstrap and dynamically created bare plugins resolve from the closed-runtime installation anchor instead of a same-named package in the writable profile. A client-module regression test proves profile-first resolution and the installed-runtime fallback independently. Every sidecar build starts the compiled executable from an isolated `DSH_HOME`, requires the injected boot graph to contain the client runtime and UI layout packages, downloads both advertised bundles successfully, and shuts the process down. This check fails when the executable serves an empty client graph even if its index still returns HTTP 200.

After an end-to-end sidecar build, pnpm's root workspace state still reports the full development install and isolated linker. A subsequent ordinary `pnpm run` proceeds without a dependency repair install.

Rust unit tests accept the expected readiness origin and reject HTTPS, `localhost`, missing ports, non-root paths, and credentials. The production macOS arm64 application and DMG build successfully; strict deep code-signature verification passes. Launching the packaged application starts the bundled sidecar on loopback, and closing the native window exits both processes and releases the port. In this build snapshot, the application bundle is approximately 235 MB and the compressed DMG is approximately 67 MB; the sidecar is approximately 225 MB and dominates the installed size.

Windows source mappings and bundle configuration are present but are not executable verification from macOS. A Windows-native build remains required before a Windows installer is released.

## Alternatives considered

**Electron with an IPC carrier.** Rejected for this delivery because bundling Chromium would duplicate the operating-system browser engine and increase package, runtime-memory, startup, and browser-patching costs. A different future shell may still implement the IPC carrier described by the GUI layering contract; this Tauri shell does not need it.

**Load `apps/web/dist` directly from disk.** Rejected because the Web host owns boot-manifest injection, API routes, plugin bundles, WebSocket upgrades, and shutdown. Recreating those contracts in the shell would be larger and more fragile than reusing `dsh web` over loopback.

**Bundle a standalone Node executable plus the deployed directory.** Rejected because the measured layout combined a large runtime with tens of thousands of files and more installed bytes than the SEA. It also created more antivirus, installer, and partial-upgrade surface.

**Require users to install Node.js.** Rejected because it is not an installable desktop product, makes runtime selection and upgrades user-owned, and weakens reproducibility.

**Rewrite the backend in Rust.** Rejected because it would duplicate the plugin runtime, process and filesystem capabilities, agent lifecycle, configuration, and Web host solely for packaging. Tauri is the window and lifecycle shell, not a second Harness implementation.

## Consequences

The desktop application avoids a bundled Chromium engine and reuses the product's current Web behavior. End users receive one native application and do not manage Node.js, while platform WebView security updates remain owned by the operating system.

The Node backend still dominates disk and memory use: Tauri makes the shell light, not the Harness runtime free. SEA packaging is a closed deployment and may expose further incompatibilities in features that assume arbitrary external Node scripts or dynamically installed packages; those paths require packaged-application tests before claiming support.

macOS signs the app, sidecar, and node-pty helper together. The JIT and library-validation entitlements are a real security cost of embedding V8 under Hardened Runtime, so the shell deliberately adds no remote-origin native capability. Public distribution must replace ad-hoc signing with platform identities and complete the operating-system-specific release checks.
