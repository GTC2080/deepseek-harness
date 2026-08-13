use std::{
    collections::VecDeque,
    error::Error,
    fs,
    sync::{
        atomic::{AtomicU8, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

#[cfg(any(target_os = "macos", target_os = "windows"))]
use tauri::{webview::DownloadEvent, WebviewWindowBuilder};
use tauri::{Manager, Url, WebviewWindow, WindowEvent};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent, TerminatedPayload},
    ShellExt,
};

const MAIN_WINDOW: &str = "main";
const READY_PREFIX: &str = "dsh web: ";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(45);
const MAX_DIAGNOSTIC_LINES: usize = 8;
const MAX_DIAGNOSTIC_CHARS: usize = 500;
#[cfg(any(target_os = "macos", target_os = "windows"))]
const DESKTOP_DOWNLOAD_EVENT: &str = "dsh:desktop-download";
#[cfg(target_os = "macos")]
const DESKTOP_PLATFORM: &str = "macos";
#[cfg(target_os = "windows")]
const DESKTOP_PLATFORM: &str = "windows";

const PENDING: u8 = 0;
const NAVIGATING: u8 = 1;
const READY: u8 = 2;
const FAILED: u8 = 3;
const STOPPING: u8 = 4;

struct BackendState {
    phase: AtomicU8,
    child: Mutex<Option<CommandChild>>,
}

impl BackendState {
    fn new(child: CommandChild) -> Self {
        Self {
            phase: AtomicU8::new(PENDING),
            child: Mutex::new(Some(child)),
        }
    }

    fn kill(&self) {
        let child = self.child.lock().ok().and_then(|mut guard| guard.take());
        if let Some(child) = child {
            let _ = child.kill();
        }
    }

    fn stop(&self) {
        self.phase.store(STOPPING, Ordering::SeqCst);
        self.kill();
    }

    fn clear_child(&self) {
        if let Ok(mut guard) = self.child.lock() {
            guard.take();
        }
    }
}

fn parse_ready_line(line: &str) -> Result<Option<Url>, String> {
    let Some(raw_url) = line.strip_prefix(READY_PREFIX) else {
        return Ok(None);
    };
    let url = Url::parse(raw_url).map_err(|error| format!("invalid readiness URL: {error}"))?;
    let port = url.port().filter(|port| *port != 0);
    let is_exact_origin = port.is_some_and(|port| {
        raw_url == format!("http://127.0.0.1:{port}")
            || raw_url == format!("http://127.0.0.1:{port}/")
    });
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || !is_exact_origin
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(
            "backend readiness URL must be an uncredentialed http://127.0.0.1:<port>/ origin"
                .into(),
        );
    }
    Ok(Some(url))
}

fn show_startup_error(window: &WebviewWindow, message: &str) {
    let payload =
        serde_json::to_string(message).unwrap_or_else(|_| "\"Desktop startup failed.\"".into());
    let script = format!(
        r#"(() => {{
          const message = {payload};
          const show = () => {{
            if (typeof window.desktopStartupError === 'function') {{
              window.desktopStartupError(message);
              return;
            }}
            const status = document.getElementById('status');
            const detail = document.getElementById('error-detail');
            if (status) status.textContent = 'DeepSeek Harness could not start.';
            if (detail) {{ detail.textContent = message; detail.hidden = false; }}
          }};
          if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', show, {{ once: true }});
          else show();
        }})();"#
    );
    let _ = window.eval(script);
}

fn fail_pending(state: &BackendState, window: &WebviewWindow, message: &str) {
    if state
        .phase
        .compare_exchange(PENDING, FAILED, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok()
    {
        state.kill();
        show_startup_error(window, message);
    }
}

fn append_diagnostic(lines: &mut VecDeque<String>, bytes: &[u8]) {
    let line: String = String::from_utf8_lossy(bytes)
        .chars()
        .take(MAX_DIAGNOSTIC_CHARS)
        .collect();
    if lines.len() == MAX_DIAGNOSTIC_LINES {
        lines.pop_front();
    }
    lines.push_back(line);
}

fn termination_message(payload: &TerminatedPayload, diagnostics: &VecDeque<String>) -> String {
    let status = match (payload.code, payload.signal) {
        (Some(code), _) => format!("exit code {code}"),
        (None, Some(signal)) => format!("signal {signal}"),
        (None, None) => "an unknown status".into(),
    };
    if diagnostics.is_empty() {
        format!("The local DeepSeek Harness runtime stopped during startup ({status}).")
    } else {
        format!(
            "The local DeepSeek Harness runtime stopped during startup ({status}).\n\n{}",
            diagnostics.iter().cloned().collect::<Vec<_>>().join("\n")
        )
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn is_session_export_download(url: &Url) -> bool {
    url.scheme() == "http"
        && url.host_str() == Some("127.0.0.1")
        && url.port().is_some()
        && url.path() == "/api/session.export"
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn desktop_download_event_script(detail: serde_json::Value) -> String {
    format!(
        "window.dispatchEvent(new CustomEvent({event}, {{ detail: {detail} }}));",
        event = serde_json::to_string(DESKTOP_DOWNLOAD_EVENT)
            .expect("desktop download event name is serializable"),
    )
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn desktop_initialization_script(platform: &str) -> String {
    let platform = serde_json::to_string(platform).expect("desktop platform is serializable");
    format!(
        "window.__DSH_DESKTOP_PLATFORM__ = {platform}; window.__DSH_DESKTOP_DOWNLOADS__ = true;"
    )
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn create_main_window(app: &tauri::App) -> Result<WebviewWindow, Box<dyn Error>> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|config| config.label == MAIN_WINDOW)
        .ok_or("the configured main window is missing")?;
    let window = WebviewWindowBuilder::from_config(app.handle(), config)?
        .initialization_script(desktop_initialization_script(DESKTOP_PLATFORM))
        .on_download(|webview, event| {
            match event {
                DownloadEvent::Requested { url, destination }
                    if is_session_export_download(&url) =>
                {
                    let filename = destination
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or("dsh-session.zip");
                    let script = desktop_download_event_script(serde_json::json!({
                        "url": url.as_str(),
                        "phase": "requested",
                        "filename": filename,
                    }));
                    if let Err(error) = webview.eval(script) {
                        eprintln!("Could not report the desktop download start: {error}");
                    }
                }
                DownloadEvent::Finished { url, success, .. }
                    if is_session_export_download(&url) =>
                {
                    let script = desktop_download_event_script(serde_json::json!({
                        "url": url.as_str(),
                        "phase": "finished",
                        "success": success,
                    }));
                    if let Err(error) = webview.eval(script) {
                        eprintln!("Could not report the desktop download result: {error}");
                    }
                }
                _ => {}
            }
            true
        })
        .build()?;
    Ok(window)
}

fn setup(app: &mut tauri::App) -> Result<(), Box<dyn Error>> {
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    let window = create_main_window(app)?;
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let window = app
        .get_webview_window(MAIN_WINDOW)
        .ok_or("the configured main window is missing")?;
    let data_dir = match app.path().app_data_dir() {
        Ok(path) => path,
        Err(error) => {
            show_startup_error(
                &window,
                &format!("Could not resolve the application data directory: {error}"),
            );
            return Ok(());
        }
    };
    if let Err(error) = fs::create_dir_all(&data_dir) {
        show_startup_error(
            &window,
            &format!("Could not prepare the application data directory: {error}"),
        );
        return Ok(());
    }

    let command = match app.shell().sidecar("dsh-backend") {
        Ok(command) => command,
        Err(error) => {
            show_startup_error(
                &window,
                &format!("Could not locate the bundled runtime: {error}"),
            );
            return Ok(());
        }
    };
    let (mut receiver, child) = match command
        .args(["web", "--host", "127.0.0.1", "--port", "0"])
        .env("DSH_HOME", &data_dir)
        .env("DSH_CLOSED_RUNTIME", "1")
        .current_dir(&data_dir)
        .spawn()
    {
        Ok(process) => process,
        Err(error) => {
            show_startup_error(
                &window,
                &format!("Could not start the bundled runtime: {error}"),
            );
            return Ok(());
        }
    };

    let state = Arc::new(BackendState::new(child));
    app.manage(state.clone());
    let close_state = state.clone();
    let app_handle = app.handle().clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::CloseRequested { .. }) {
            close_state.stop();
            app_handle.exit(0);
        }
    });

    let timeout_state = state.clone();
    let timeout_window = window.clone();
    thread::spawn(move || {
        thread::sleep(STARTUP_TIMEOUT);
        fail_pending(
            &timeout_state,
            &timeout_window,
            "The local DeepSeek Harness runtime did not become ready within 45 seconds.",
        );
    });

    let event_state = state.clone();
    let event_window = window.clone();
    let event_app = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        let mut diagnostics = VecDeque::new();
        while let Some(event) = receiver.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes);
                    match parse_ready_line(line.trim_end_matches(['\r', '\n'])) {
                        Ok(Some(url)) => {
                            if event_state
                                .phase
                                .compare_exchange(
                                    PENDING,
                                    NAVIGATING,
                                    Ordering::SeqCst,
                                    Ordering::SeqCst,
                                )
                                .is_err()
                            {
                                continue;
                            }
                            match event_window.navigate(url) {
                                Ok(()) => event_state.phase.store(READY, Ordering::SeqCst),
                                Err(error) => {
                                    event_state.phase.store(FAILED, Ordering::SeqCst);
                                    event_state.kill();
                                    show_startup_error(
                                        &event_window,
                                        &format!("Could not open the local DeepSeek Harness runtime: {error}"),
                                    );
                                }
                            }
                        }
                        Ok(None) => {}
                        Err(error) => fail_pending(&event_state, &event_window, &error),
                    }
                }
                CommandEvent::Stderr(bytes) => append_diagnostic(&mut diagnostics, &bytes),
                CommandEvent::Error(error) => fail_pending(
                    &event_state,
                    &event_window,
                    &format!("The bundled runtime failed during startup: {error}"),
                ),
                CommandEvent::Terminated(payload) => {
                    event_state.clear_child();
                    let phase = event_state.phase.load(Ordering::SeqCst);
                    if phase == PENDING {
                        fail_pending(
                            &event_state,
                            &event_window,
                            &termination_message(&payload, &diagnostics),
                        );
                    } else if phase == READY {
                        event_app.exit(1);
                    }
                    return;
                }
                _ => {}
            }
        }
        fail_pending(
            &event_state,
            &event_window,
            "The bundled runtime closed its output channel before startup completed.",
        );
    });

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(setup)
        .build(tauri::generate_context!())
        .expect("failed to build the DeepSeek Harness desktop application");
    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            if let Some(state) = app_handle.try_state::<Arc<BackendState>>() {
                state.stop();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::parse_ready_line;
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    use super::{
        desktop_download_event_script, desktop_initialization_script, is_session_export_download,
    };

    #[test]
    fn accepts_only_the_loopback_runtime_origin() {
        let url = parse_ready_line("dsh web: http://127.0.0.1:43125")
            .expect("valid readiness line")
            .expect("readiness URL");
        assert_eq!(url.as_str(), "http://127.0.0.1:43125/");
        assert!(parse_ready_line("unrelated output")
            .expect("ordinary output")
            .is_none());
    }

    #[test]
    fn rejects_untrusted_or_ambiguous_readiness_urls() {
        for line in [
            "dsh web: https://127.0.0.1:43125",
            "dsh web: http://localhost:43125",
            "dsh web: http://127.0.0.1",
            "dsh web: http://127.0.0.1:43125/path",
            "dsh web: http://user@127.0.0.1:43125",
            "dsh web: http://127.1:43125",
            "dsh web: http://0x7f000001:43125",
        ] {
            assert!(parse_ready_line(line).is_err(), "accepted {line}");
        }
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    fn bridges_only_loopback_session_exports_without_interpolating_javascript() {
        assert!(is_session_export_download(
            &"http://127.0.0.1:43125/api/session.export?sessionId=test"
                .parse()
                .expect("valid URL")
        ));
        for raw in [
            "https://127.0.0.1:43125/api/session.export?sessionId=test",
            "http://localhost:43125/api/session.export?sessionId=test",
            "http://127.0.0.1:43125/api/other",
        ] {
            assert!(!is_session_export_download(
                &raw.parse().expect("valid URL")
            ));
        }

        let script = desktop_download_event_script(serde_json::json!({
            "filename": "archive\";window.injected=true;//.zip"
        }));
        assert!(script.contains("archive\\\";window.injected=true;//.zip"));
        assert!(!script.contains("detail: {\"filename\":\"archive\";"));
    }

    #[cfg(any(target_os = "macos", target_os = "windows"))]
    #[test]
    fn initializes_each_supported_desktop_platform_before_navigation() {
        for platform in ["macos", "windows"] {
            let script = desktop_initialization_script(platform);
            assert!(script.contains(&format!("= \"{platform}\";")));
            assert!(script.contains("window.__DSH_DESKTOP_DOWNLOADS__ = true;"));
        }
    }
}
