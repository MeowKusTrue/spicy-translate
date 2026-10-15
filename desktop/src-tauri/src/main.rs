// Spicy Translate desktop: a WebView2 window onto the editor served by the bundled server (spicy-server.exe,
// the same server/index.ts as a single Node executable). If a server already listens on the port (the MCP server
// started by Claude), the window just uses it, so the app and the agent share one project.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{
    net::{SocketAddr, TcpStream},
    process::{Child, Command},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

struct Server(Mutex<Option<Child>>);

/// 8787 like the MCP server, so both share one project; SPICY_PORT overrides (a second, separate editor)
fn port() -> u16 { std::env::var("SPICY_PORT").ok().and_then(|v| v.parse().ok()).unwrap_or(8787) }
fn up() -> bool {
    TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], port())), Duration::from_millis(150)).is_ok()
}

fn main() {
    let app = tauri::Builder::default()
        // a second launch brings the open window to the front instead of starting another editor
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build()) // size / position remembered between launches
        .manage(Server(Mutex::new(None)))
        .setup(|app| {
            if !up() {
                let res = app.path().resource_dir()?;
                let data = app.path().app_local_data_dir()?; // %LOCALAPPDATA%: project + the auto-timing Python (GBs; not the roaming profile)
                std::fs::create_dir_all(&data)?;
                let mut cmd = Command::new(std::env::current_exe()?.with_file_name("spicy-server.exe"));
                cmd.arg("--http")
                    .env("SPICY_PORT", port().to_string())
                    .env("SPICY_PARENT_PID", std::process::id().to_string()) // the server quits if this app dies
                    .env("SPICY_DIR", &data)
                    .env("SPICY_ROOT", &res)
                    .env("SPICY_HTML", res.join("web").join("index.html"))
                    .env("SPICY_ALIGN_DIR", res.join("auto-align"));
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console behind the app
                }
                app.state::<Server>().0.lock().unwrap().replace(cmd.spawn()?);
                let t = Instant::now();
                while !up() && t.elapsed() < Duration::from_secs(20) {
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(format!("http://127.0.0.1:{}/", port()).parse()?))
                .title("Spicy Translate")
                .inner_size(1440.0, 920.0)
                .min_inner_size(900.0, 600.0)
                .decorations(false) // our own title bar (tabs + window buttons) instead of the system frame
                .shadow(true)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Spicy Translate failed to start");
    app.run(|app, ev| {
        if let RunEvent::Exit = ev {
            if let Some(mut c) = app.state::<Server>().0.lock().unwrap().take() {
                let _ = c.kill(); // our server only; a reused MCP server keeps running
            }
        }
    });
}
