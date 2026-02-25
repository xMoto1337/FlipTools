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
            native_fetch
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
