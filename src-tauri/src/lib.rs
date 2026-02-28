use tauri::{Manager, Emitter};
use tauri_plugin_updater::UpdaterExt;
use std::sync::Mutex;
use std::collections::HashMap;
use serde::Serialize;

struct UpdateState {
    update_available: Mutex<Option<UpdateInfo>>,
}

#[derive(Clone, Serialize)]
struct UpdateInfo {
    current_version: String,
    new_version: String,
    notes: String,
}

#[derive(Clone, Serialize)]
struct UpdateCheckResult {
    available: bool,
    current_version: String,
    new_version: Option<String>,
    notes: Option<String>,
}

#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<UpdateCheckResult, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;

    match updater.check().await {
        Ok(Some(update)) => {
            let info = UpdateInfo {
                current_version: update.current_version.to_string(),
                new_version: update.version.clone(),
                notes: update.body.clone().unwrap_or_default(),
            };

            if let Some(state) = app.try_state::<UpdateState>() {
                *state.update_available.lock().unwrap() = Some(info.clone());
            }

            Ok(UpdateCheckResult {
                available: true,
                current_version: info.current_version,
                new_version: Some(info.new_version),
                notes: Some(info.notes),
            })
        }
        Ok(None) => {
            let current = env!("CARGO_PKG_VERSION").to_string();
            Ok(UpdateCheckResult {
                available: false,
                current_version: current,
                new_version: None,
                notes: None,
            })
        }
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
async fn install_update(app: tauri::AppHandle, window: tauri::Window) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;

    let update = updater.check().await.map_err(|e| e.to_string())?;

    if let Some(update) = update {
        let window_clone = window.clone();

        update.download_and_install(
            move |downloaded, total| {
                let progress = if let Some(total) = total {
                    if total > 0 {
                        (downloaded as f64 / total as f64 * 100.0) as u32
                    } else {
                        0
                    }
                } else {
                    0
                };
                let _ = window_clone.emit("update-progress", progress);
            },
            || {}
        ).await.map_err(|e| e.to_string())?;

        app.restart();
    }

    Ok(())
}

#[tauri::command]
fn get_current_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
fn get_changelog() -> String {
    include_str!("../../CHANGELOG.md").to_string()
}

// ── Native HTTP fetch ──────────────────────────────────────────────────────
// Runs on the user's machine using their own residential IP, bypassing
// bot-detection that blocks AWS/Vercel datacenter IPs.
#[derive(Serialize)]
struct NativeFetchResponse {
    status: u16,
    content_type: String,
    body: String,
}

#[tauri::command]
async fn native_fetch(
    url: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<NativeFetchResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .gzip(true)
        .deflate(true)
        .brotli(true)
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("client build: {}", e))?;

    let method_str = method.as_deref().unwrap_or("GET").to_uppercase();
    let mut req = match method_str.as_str() {
        "POST" => client.post(&url),
        "PUT"  => client.put(&url),
        _      => client.get(&url),
    };

    if let Some(hdrs) = headers {
        for (k, v) in &hdrs {
            req = req.header(k.as_str(), v.as_str());
        }
    }

    if let Some(b) = body {
        req = req.body(b);
    }

    let resp = req.send().await.map_err(|e| format!("request: {}", e))?;
    let status = resp.status().as_u16();
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let body = resp.text().await.map_err(|e| format!("body: {}", e))?;

    Ok(NativeFetchResponse { status, content_type, body })
}

// ── Depop native login ─────────────────────────────────────────────────────
// Opens a native WebView window to depop.com/login/. An initialization script
// patches window.fetch and XHR to intercept any outgoing Bearer token, then
// navigates to a custom fliptools-depop:// URL. The on_navigation handler
// captures the token, emits a "depop-token" event to the main window, and
// closes the login window.
#[tauri::command]
async fn open_depop_login(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    // Close any stale login window from a previous attempt
    if let Some(existing) = app.get_webview_window("depop-login") {
        let _ = existing.close();
    }

    // Injected before any page script. Patches fetch + XHR to capture the
    // Bearer token the moment Depop makes an authenticated API call.
    // Also polls storage every 1.5 s in case the token is already cached.
    let init_script = r#"(function() {
        if (window.__fliptools_patched) return;
        window.__fliptools_patched = true;

        function captureToken(token) {
            if (!token || !token.startsWith('eyJ') || token.length < 50) return;
            if (window.__fliptools_token_sent) return;
            window.__fliptools_token_sent = true;
            window.location.href = 'fliptools-depop://token?t=' + encodeURIComponent(token);
        }

        // Patch fetch
        var _fetch = window.fetch;
        window.fetch = function(input, init) {
            try {
                var headers = init && init.headers;
                if (headers) {
                    var auth = headers instanceof Headers
                        ? (headers.get('Authorization') || headers.get('authorization'))
                        : (headers['Authorization'] || headers['authorization']);
                    if (auth && auth.startsWith('Bearer ')) captureToken(auth.slice(7));
                }
            } catch(e) {}
            return _fetch.apply(this, arguments);
        };

        // Patch XHR
        var _setHeader = XMLHttpRequest.prototype.setRequestHeader;
        XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
            try {
                if (name.toLowerCase() === 'authorization' && value && value.startsWith('Bearer ')) {
                    captureToken(value.slice(7));
                }
            } catch(e) {}
            return _setHeader.apply(this, arguments);
        };

        // Poll storage for tokens that are already cached
        var _interval = setInterval(function() {
            if (window.__fliptools_token_sent) { clearInterval(_interval); return; }
            try {
                [localStorage, sessionStorage].forEach(function(store) {
                    if (window.__fliptools_token_sent) return;
                    for (var key in store) {
                        var val = store.getItem(key);
                        if (!val) continue;
                        if (val.startsWith('eyJ') && val.length > 50) { captureToken(val); return; }
                        try {
                            var obj = JSON.parse(val);
                            if (obj && typeof obj === 'object') {
                                var tok = obj.access_token || obj.accessToken || obj.token;
                                if (tok && tok.startsWith('eyJ') && tok.length > 50) { captureToken(tok); return; }
                            }
                        } catch(e) {}
                    }
                });
            } catch(e) {}
        }, 1500);
    })();"#;

    let app_clone = app.clone();

    let _webview = WebviewWindowBuilder::new(
        &app,
        "depop-login",
        WebviewUrl::External(
            "https://www.depop.com/login/"
                .parse()
                .map_err(|e| format!("URL parse error: {}", e))?,
        ),
    )
    .title("Sign in to Depop — FlipTools")
    .inner_size(460.0, 680.0)
    .resizable(true)
    .initialization_script(init_script)
    .on_navigation(move |url| {
        if url.scheme() == "fliptools-depop" {
            let token = url
                .query_pairs()
                .find(|(k, _)| k == "t")
                .map(|(_, v)| v.into_owned())
                .unwrap_or_default();

            if !token.is_empty() {
                let _ = app_clone.emit("depop-token", token);
                let app2 = app_clone.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(300));
                    if let Some(win) = app2.get_webview_window("depop-login") {
                        let _ = win.close();
                    }
                });
            }
            return false; // Block navigation to custom scheme
        }
        true
    })
    .build()
    .map_err(|e| format!("Failed to open login window: {}", e))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .manage(UpdateState {
            update_available: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            check_for_update,
            install_update,
            get_current_version,
            get_changelog,
            native_fetch,
            open_depop_login
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            if let Some(window) = app.get_webview_window("main") {
                let icon_bytes: &[u8] = include_bytes!("../icons/icon.png");
                if let Ok(icon) = tauri::image::Image::from_bytes(icon_bytes) {
                    let _ = window.set_icon(icon);
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
