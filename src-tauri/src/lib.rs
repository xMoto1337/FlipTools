use tauri::{Manager, Emitter};
use tauri_plugin_updater::UpdaterExt;
use std::sync::Mutex;
use std::collections::HashMap;
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

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
// Token capture uses a local TCP server on 127.0.0.1:<random port>.
// The init_script sends the token via fetch() to that server.
// This avoids the unreliable custom-scheme/on_navigation approach on WebView2.

/// State shared between open_depop_login and scan_depop_auth.
struct DepopState {
    port: Mutex<Option<u16>>,
    shutdown_tx: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

/// Percent-decode a URL-encoded string (for reading tokens from HTTP requests).
fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
            if let Ok(b) = u8::from_str_radix(hex, 16) {
                out.push(b as char);
                i += 3;
                continue;
            }
        } else if bytes[i] == b'+' {
            out.push(' ');
            i += 1;
            continue;
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

#[tauri::command]
async fn open_depop_login(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::{WebviewUrl, WebviewWindowBuilder};

    // Close any stale login window from a previous attempt
    if let Some(existing) = app.get_webview_window("depop-login") {
        let _ = existing.close();
    }

    // Cancel any existing token-capture server
    {
        let state = app.state::<DepopState>();
        let tx = state.shutdown_tx.lock().unwrap().take();
        if let Some(tx) = tx {
            let _ = tx.send(());
        }
    }

    // Bind to an OS-assigned port so we don't clash with anything.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to start token server: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    {
        let state = app.state::<DepopState>();
        *state.port.lock().unwrap() = Some(port);
    }

    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    {
        let state = app.state::<DepopState>();
        *state.shutdown_tx.lock().unwrap() = Some(shutdown_tx);
    }

    // Spawn a background task that accepts connections and waits for the token.
    let app_srv = app.clone();
    tokio::spawn(async move {
        let mut shutdown_rx = shutdown_rx;
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => break,
                result = listener.accept() => {
                    let (mut stream, _) = match result {
                        Ok(s) => s,
                        Err(_) => break,
                    };

                    let mut buf = vec![0u8; 8192];
                    let n = match stream.read(&mut buf).await {
                        Ok(n) if n > 0 => n,
                        _ => continue,
                    };

                    // Always respond 200 so the browser doesn't retry/error
                    let _ = stream.write_all(
                        b"HTTP/1.1 200 OK\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                    ).await;
                    drop(stream);

                    // Parse token from "GET /token?t=<TOKEN> HTTP/1.1"
                    let req = String::from_utf8_lossy(&buf[..n]);
                    let token = req.lines().next().and_then(|line| {
                        let path = line.split_whitespace().nth(1)?;
                        path.split('?').nth(1)
                            .and_then(|q| q.split('&').find(|p| p.starts_with("t=")))
                            .map(|p| url_decode(&p[2..]))
                    });

                    if let Some(tok) = token {
                        // Accept JWT/opaque tokens (>= 20 chars) OR DEPOP_WEB:{slug} identifiers.
                        let is_web_token = tok.starts_with("DEPOP_WEB:") && tok.len() > "DEPOP_WEB:".len();
                        let is_bearer = tok.len() >= 20;
                        if (is_web_token || is_bearer) && !tok.chars().any(|c| c.is_whitespace()) {
                            let _ = app_srv.emit("depop-token", tok);
                            let app2 = app_srv.clone();
                            tokio::spawn(async move {
                                tokio::time::sleep(std::time::Duration::from_millis(400)).await;
                                if let Some(win) = app2.get_webview_window("depop-login") {
                                    let _ = win.close();
                                }
                            });
                            break;
                        }
                    }
                }
            }
        }
    });

    // The init_script runs before every page load in this window.
    // It patches fetch/XHR to intercept Bearer tokens and polls storage,
    // sending any found token to our local server via fetch() — which works
    // reliably from HTTPS pages to 127.0.0.1 (treated as a secure origin).
    let init_script = format!("var __FLIPTOOLS_PORT = {port};\n") + r#"(function() {
        if (window.__fliptools_patched) return;
        window.__fliptools_patched = true;

        // Send token via fetch AND <img> tag — the image approach bypasses some
        // fetch-specific mixed-content restrictions in certain WebView2 configs.
        function sendToServer(token) {
            var url = 'http://127.0.0.1:' + __FLIPTOOLS_PORT + '/token?t=' + encodeURIComponent(token);
            try { fetch(url, { mode: 'no-cors' }).catch(function() {}); } catch(e) {}
            try { var img = new Image(); img.src = url; } catch(e) {}
        }

        function captureToken(token) {
            if (!token || typeof token !== 'string') return;
            // DEPOP_WEB:{slug} only needs a non-empty slug; everything else requires 20+ chars
            var minLen = (token.indexOf('DEPOP_WEB:') === 0) ? 11 : 20;
            if (token.length < minLen) return;
            if (/[\s\n\r]/.test(token)) return;   // no whitespace
            if (window.__fliptools_token_sent) return;
            window.__fliptools_token_sent = true;
            sendToServer(token);
        }

        // Prefer values under known auth key names (accept any non-whitespace 20+ char string).
        // Falls back to JWT-only check for unknown keys to reduce false positives.
        function deepScan(obj, depth, underAuthKey) {
            if (!obj || depth > 4) return;
            if (typeof obj === 'string') {
                if (underAuthKey) { captureToken(obj); }
                else if (obj.startsWith('eyJ') && obj.length >= 50) { captureToken(obj); }
                return;
            }
            if (typeof obj !== 'object') return;
            var authKeys = ['access_token','accessToken','token','jwt','id_token','bearer',
                            'authorization','auth_token','sessionToken','session_token',
                            'accessToken','idToken','userToken'];
            for (var i = 0; i < authKeys.length; i++) {
                var v = obj[authKeys[i]];
                if (v && typeof v === 'string') deepScan(v, depth + 1, true);
            }
            try {
                var keys = Object.keys(obj);
                for (var j = 0; j < keys.length; j++) {
                    if (window.__fliptools_token_sent) return;
                    deepScan(obj[keys[j]], depth + 1, false);
                }
            } catch(e) {}
        }

        var AUTH_KEY_RE = /token|auth|session|jwt|bearer|access|refresh/i;

        function scanStorage() {
            try {
                [localStorage, sessionStorage].forEach(function(store) {
                    if (window.__fliptools_token_sent) return;
                    var keys = Object.keys(store);
                    for (var i = 0; i < keys.length; i++) {
                        if (window.__fliptools_token_sent) return;
                        var key = keys[i];
                        var val = store.getItem(key);
                        if (!val || val.length < 20) continue;
                        var isAuthKey = AUTH_KEY_RE.test(key);
                        if (isAuthKey && !/[\s\n\r\{]/.test(val)) {
                            captureToken(val);
                        } else if (val.startsWith('eyJ') && val.length >= 50) {
                            captureToken(val);
                        } else {
                            try { deepScan(JSON.parse(val), 0, isAuthKey); } catch(e) {}
                        }
                    }
                });
            } catch(e) {}
            // Scan visible (non-httpOnly) cookies
            try {
                document.cookie.split(';').forEach(function(c) {
                    if (window.__fliptools_token_sent) return;
                    var eq = c.indexOf('=');
                    if (eq < 0) return;
                    var name = c.substring(0, eq).trim();
                    var val  = c.substring(eq + 1).trim();
                    if (AUTH_KEY_RE.test(name) && val.length >= 20) captureToken(val);
                });
            } catch(e) {}
        }

        // Patch fetch: check outgoing Authorization header + intercept auth endpoint responses
        var _fetch = window.fetch;
        window.fetch = function(input, init) {
            try {
                var hdrs = init && init.headers;
                if (hdrs) {
                    var auth = hdrs instanceof Headers
                        ? (hdrs.get('Authorization') || hdrs.get('authorization'))
                        : (hdrs['Authorization'] || hdrs['authorization']);
                    if (auth && auth.startsWith('Bearer ')) captureToken(auth.slice(7));
                }
            } catch(e) {}

            var url = typeof input === 'string' ? input : ((input && input.url) || '');
            var isAuthUrl = /\/(auth|token|login|oauth|magic|verify|refresh|session)/.test(url);
            var p = _fetch.apply(this, arguments);
            if (isAuthUrl) {
                return p.then(function(resp) {
                    try {
                        var ct = (resp.headers && resp.headers.get('content-type')) || '';
                        if (ct.indexOf('json') >= 0) {
                            resp.clone().json().then(function(data) {
                                try { deepScan(data, 0, false); } catch(e) {}
                            }).catch(function(){});
                        }
                    } catch(e) {}
                    return resp;
                });
            }
            return p;
        };

        // Patch XHR: check outgoing Authorization header
        var _setHeader = XMLHttpRequest.prototype.setRequestHeader;
        XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
            try {
                if (name.toLowerCase() === 'authorization' && value) captureToken(value.replace(/^Bearer\s+/i, ''));
            } catch(e) {}
            return _setHeader.apply(this, arguments);
        };

        // Poll storage every 1.5s as a fallback
        var _iv = setInterval(function() {
            if (window.__fliptools_token_sent) { clearInterval(_iv); return; }
            scanStorage();
        }, 1500);

        // Auto-capture on every non-login page load.
        // After magic-link sign-in, Depop redirects to the home/profile page.
        // We look for the user slug in Next.js SSR data (__NEXT_DATA__) or nav DOM links.
        function autoCapture() {
            if (window.__fliptools_token_sent) return;
            if (/\/(login|signup|register)/.test(window.location.pathname)) return;
            setTimeout(function() {
                if (window.__fliptools_token_sent) return;

                var SYSTEM = /^(login|signup|register|explore|feed|search|sell|help|about|terms|privacy|categories|notifications|en|us|uk|au|de|fr|it|es|products|likes|legal|sitemap|blog|careers|app|download|referral|safety|shipping|payments|returns|shop)$/i;

                // 0. Current URL — after magic-link login Depop may land on /{username}/
                try {
                    var path = window.location.pathname;
                    var pm = path.match(/^\/([a-z0-9_.-]{2,30})\/?$/i);
                    if (pm && !SYSTEM.test(pm[1])) { captureToken('DEPOP_WEB:' + pm[1]); return; }
                } catch(e) {}

                // 1. __NEXT_DATA__ deep scan
                try {
                    var nd = window.__NEXT_DATA__;
                    if (nd) {
                        function findSlug(obj, d) {
                            if (!obj || d > 6 || typeof obj !== 'object') return null;
                            var v = obj.username || obj.slug;
                            if (v && typeof v === 'string' && /^[a-z0-9_.-]{2,30}$/i.test(v)) return v;
                            var ks = Object.keys(obj);
                            for (var ki = 0; ki < Math.min(ks.length, 15); ki++) {
                                var r = findSlug(obj[ks[ki]], d + 1);
                                if (r) return r;
                            }
                            return null;
                        }
                        var s1 = findSlug(nd, 0);
                        if (s1) { captureToken('DEPOP_WEB:' + s1); return; }
                    }
                } catch(e) {}

                // 2. Nav DOM — Depop profiles at /{username}/, not /shop/{username}/
                try {
                    var navEl = document.querySelector('nav, header, [role="navigation"]') || document.body;
                    var links = navEl.querySelectorAll('a[href]');
                    for (var i = 0; i < links.length; i++) {
                        var href = links[i].getAttribute('href') || '';
                        var m = href.match(/^\/([a-z0-9_.-]{2,30})\/?$/i);
                        if (m && !SYSTEM.test(m[1])) { captureToken('DEPOP_WEB:' + m[1]); return; }
                    }
                } catch(e) {}

                // 3. Global window state objects
                try {
                    var GS = ['__STORE__','__APP_STATE__','__INITIAL_STATE__','__REDUX_STATE__','store','App','depop','__depop'];
                    for (var g = 0; g < GS.length; g++) {
                        var gv = window[GS[g]];
                        if (!gv || typeof gv !== 'object') continue;
                        var s2 = (gv.user && (gv.user.username || gv.user.slug)) ||
                                  (gv.auth && gv.auth.user && (gv.auth.user.username || gv.auth.user.slug)) ||
                                  (gv.me && (gv.me.username || gv.me.slug));
                        if (s2) { captureToken('DEPOP_WEB:' + s2); return; }
                    }
                } catch(e) {}
            }, 800);
        }
        window.addEventListener('load', autoCapture);
    })();"#;

    let _webview = WebviewWindowBuilder::new(
        &app,
        "depop-login",
        WebviewUrl::External(
            "https://www.depop.com/login/"
                .parse()
                .map_err(|e| format!("URL parse error: {e}"))?,
        ),
    )
    .title("Sign in to Depop — FlipTools")
    .inner_size(460.0, 680.0)
    .resizable(true)
    .initialization_script(&init_script)
    .build()
    .map_err(|e| format!("Failed to open login window: {e}"))?;

    Ok(())
}

// Manually triggers a storage scan inside the depop-login WebView.
// Called when the user is already signed in but the token wasn't auto-captured.
#[tauri::command]
async fn scan_depop_auth(app: tauri::AppHandle) -> Result<(), String> {
    let port = {
        let state = app.state::<DepopState>();
        let p = *state.port.lock().unwrap();
        p
    }.ok_or_else(|| "Token server not running — click Connect first".to_string())?;

    let win = app.get_webview_window("depop-login")
        .ok_or_else(|| "Depop login window is not open".to_string())?;

    // Depop uses httpOnly session cookies — no Bearer token accessible via JS.
    // Strategy: look for the logged-in user's slug via multiple methods.
    // Depop profiles are at /{username}/ (NOT /shop/{username}/).
    let script = format!(
        r#"(function() {{
            window.__fliptools_token_sent = false;
            var PORT = {port};

            var old = document.getElementById('__ft_panel');
            if (old) old.remove();
            var panel = document.createElement('div');
            panel.id = '__ft_panel';
            panel.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:2147483647;background:#111;color:#0f0;font:11px/1.5 monospace;padding:8px;max-height:240px;overflow-y:auto;border-top:2px solid #0f0;';
            panel.innerHTML = '<b>FlipTools: searching for your account...</b><br>';
            document.body && document.body.appendChild(panel);
            function log(s) {{ panel.innerHTML += s + '<br>'; panel.scrollTop = 9999; }}

            function sendToServer(token) {{
                var url = 'http://127.0.0.1:' + PORT + '/token?t=' + encodeURIComponent(token);
                try {{ fetch(url, {{ mode: 'no-cors' }}).catch(function(){{}}); }} catch(e) {{}}
                try {{ var img = new Image(); img.src = url; }} catch(e) {{}}
            }}

            log('Page: ' + window.location.pathname);

            // ── Method 1: __NEXT_DATA__ deep scan ────────────────────────────────
            log('1. __NEXT_DATA__...');
            try {{
                if (window.__NEXT_DATA__) {{
                    var nd = window.__NEXT_DATA__;
                    log('nd keys: ' + Object.keys(nd).join(', '));
                    function deepSlug(obj, d) {{
                        if (!obj || d > 6 || typeof obj !== 'object') return null;
                        var v = obj.username || obj.slug;
                        if (v && typeof v === 'string' && /^[a-z0-9_.-]{{2,30}}$/i.test(v)) return v;
                        var ks = Object.keys(obj);
                        for (var ki = 0; ki < Math.min(ks.length, 15); ki++) {{
                            var r = deepSlug(obj[ks[ki]], d + 1);
                            if (r) return r;
                        }}
                        return null;
                    }}
                    var s1 = deepSlug(nd, 0);
                    if (s1) {{ log('<b style="color:#ff0">NEXT_DATA: ' + s1 + '</b>'); sendToServer('DEPOP_WEB:' + s1); return; }}
                    log('no username in __NEXT_DATA__');
                }} else {{ log('__NEXT_DATA__ absent'); }}
            }} catch(e) {{ log('NEXT_DATA err: ' + e.message); }}

            // ── Method 2: Nav DOM links — Depop uses /{{username}}/ not /shop/ ────
            log('2. Nav hrefs...');
            var SYSTEM = /^(login|signup|register|explore|feed|search|sell|help|about|terms|privacy|categories|notifications|en|us|uk|au|de|fr|it|es|products|likes|legal|sitemap|blog|careers|app|download|referral|safety|shipping|payments|returns)$/i;
            try {{
                var navEl = document.querySelector('nav, header, [role="navigation"]') || document.body;
                var navLinks = navEl.querySelectorAll('a[href]');
                var allHrefs = [];
                for (var i = 0; i < Math.min(navLinks.length, 20); i++) allHrefs.push(navLinks[i].getAttribute('href'));
                log('hrefs: ' + JSON.stringify(allHrefs).substring(0, 300));
                var candidates = [];
                for (var j = 0; j < navLinks.length; j++) {{
                    var href = navLinks[j].getAttribute('href') || '';
                    var m = href.match(/^\/([a-z0-9_.-]{{2,30}})\/?$/i);
                    if (m && !SYSTEM.test(m[1])) candidates.push(m[1]);
                }}
                if (candidates.length > 0) {{
                    log('<b style="color:#ff0">DOM slug: ' + candidates[0] + '</b>');
                    sendToServer('DEPOP_WEB:' + candidates[0]);
                    return;
                }}
                log('no profile link in nav');
            }} catch(e) {{ log('DOM err: ' + e.message); }}

            // ── Method 3: Global window state ────────────────────────────────────
            log('3. Global state...');
            try {{
                var GS = ['__STORE__','__APP_STATE__','__INITIAL_STATE__','__REDUX_STATE__','store','App','depop','__depop'];
                for (var g = 0; g < GS.length; g++) {{
                    var gv = window[GS[g]];
                    if (!gv || typeof gv !== 'object') continue;
                    log('found window.' + GS[g]);
                    var s2 = (gv.user && (gv.user.username || gv.user.slug)) ||
                              (gv.auth && gv.auth.user && (gv.auth.user.username || gv.auth.user.slug)) ||
                              (gv.me && (gv.me.username || gv.me.slug));
                    if (s2) {{ log('<b style="color:#ff0">Global: ' + s2 + '</b>'); sendToServer('DEPOP_WEB:' + s2); return; }}
                }}
                log('no usable global state');
            }} catch(e) {{ log('global err: ' + e.message); }}

            // ── Method 4: Direct API (CORS will likely block) ────────────────────
            log('4. API call...');
            fetch('https://api.depop.com/api/v2/accounts/me/', {{
                credentials: 'include',
                headers: {{ 'Accept': 'application/json', 'depop-locale': 'en-US' }}
            }})
            .then(function(r) {{
                log('API status: ' + r.status);
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            }})
            .then(function(data) {{
                var s3 = data.username || data.slug || data.legacy_id || (data.user && (data.user.username || data.user.slug));
                if (s3) {{ log('<b style="color:#ff0">API: ' + s3 + '</b>'); sendToServer('DEPOP_WEB:' + s3); }}
                else {{ log('API keys: ' + Object.keys(data || {{}}).join(', ')); }}
            }})
            .catch(function(e) {{ log('<span style="color:#f44">API fail: ' + e.message + '</span>'); }});
        }})();"#,
        port = port
    );

    win.eval(&script).map_err(|e| e.to_string())?;
    Ok(())
}

// Navigate the open Depop WebView to a magic-link URL the user pastes.
#[tauri::command]
async fn navigate_depop_window(app: tauri::AppHandle, url: String) -> Result<(), String> {
    // Accept any https URL on the depop.com domain (including subdomains like auth., magic., etc.)
    let is_depop = url.starts_with("https://") && {
        let host = url.trim_start_matches("https://").split('/').next().unwrap_or("");
        host == "depop.com" || host.ends_with(".depop.com")
    };
    if !is_depop {
        return Err("URL must be a depop.com URL".to_string());
    }
    let win = app.get_webview_window("depop-login")
        .ok_or_else(|| "Depop login window is not open".to_string())?;
    let safe_url = serde_json::to_string(&url).map_err(|e| e.to_string())?;
    win.eval(&format!("window.location.href = {safe_url};"))
        .map_err(|e| e.to_string())?;
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
        .manage(DepopState {
            port: Mutex::new(None),
            shutdown_tx: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            check_for_update,
            install_update,
            get_current_version,
            get_changelog,
            native_fetch,
            open_depop_login,
            navigate_depop_window,
            scan_depop_auth
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
