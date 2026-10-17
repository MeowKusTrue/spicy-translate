// Spicy Translate desktop: a WebView2 window onto the editor served by the bundled server (spicy-server.exe,
// the same server/index.ts as a single Node executable). A current server already on the port (the MCP server
// started by Claude, a browser launch) is reused, so they share one project. An outdated one is asked to hand the
// port over (/api/yield); one too old for that is left alone and the app takes the next free port.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpListener, TcpStream},
    process::{Child, Command},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

/// server API the editor in this build needs (server/index.ts `API`)
const API: u32 = 10;
struct Server(Mutex<Option<Child>>);

/// «Сохранить как»: the system dialog instead of a silent download into Downloads. None = cancelled.
#[tauri::command]
async fn save_file(app: tauri::AppHandle, name: String, text: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let ext = name.rsplit('.').next().unwrap_or("txt").to_string();
    let Some(path) = app.dialog().file().set_file_name(&name).add_filter(ext.to_uppercase(), &[ext.as_str()]).blocking_save_file() else {
        return Ok(None);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())?;
    Ok(Some(path.display().to_string()))
}

/* ---------- the project folder: TTML, project and audio side by side; Ctrl+S writes there without asking ---------- */
/// only plain file names of lyrics / project / audio files: nothing else can be read or written through these
fn in_folder(dir: &str, name: &str) -> Result<std::path::PathBuf, String> {
    let n = name.to_lowercase();
    let ok = !name.contains(['/', '\\', ':']) && !name.starts_with('.')
        && [".ttml", ".json", ".lrc", ".srt", ".mp3", ".flac", ".wav", ".ogg", ".m4a", ".opus", ".aac"].iter().any(|e| n.ends_with(e));
    let d = std::path::Path::new(dir);
    if !ok || !d.is_absolute() || !d.is_dir() { return Err(format!("нельзя: {name}")); }
    Ok(d.join(name))
}
fn unhex(v: Option<&tauri::http::HeaderValue>) -> Result<String, String> {
    let s = v.and_then(|h| h.to_str().ok()).ok_or("нет заголовка")?;
    let b: Result<Vec<u8>, _> = (0..s.len()).step_by(2).map(|i| u8::from_str_radix(s.get(i..i + 2).unwrap_or("x"), 16)).collect();
    String::from_utf8(b.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
#[tauri::command]
async fn pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(p) = app.dialog().file().set_title("Папка проекта: TTML, проект и аудио будут лежать здесь").blocking_pick_folder() else { return Ok(None) };
    Ok(Some(p.into_path().map_err(|e| e.to_string())?.display().to_string()))
}
#[tauri::command]
fn list_dir(dir: String) -> Result<Vec<String>, String> {
    let mut out = vec![];
    for e in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        if e.path().is_file() { if let Some(n) = e.file_name().to_str() { if in_folder(&dir, n).is_ok() { out.push(n.to_string()); } } }
    }
    Ok(out)
}
#[tauri::command]
fn read_text(dir: String, name: String) -> Result<String, String> { std::fs::read_to_string(in_folder(&dir, &name)?).map_err(|e| e.to_string()) }
#[tauri::command]
fn read_bytes(dir: String, name: String) -> Result<tauri::ipc::Response, String> {
    Ok(tauri::ipc::Response::new(std::fs::read(in_folder(&dir, &name)?).map_err(|e| e.to_string())?))
}
#[tauri::command]
fn write_text(dir: String, name: String, text: String) -> Result<(), String> { std::fs::write(in_folder(&dir, &name)?, text).map_err(|e| e.to_string()) }
/// raw body (the audio), folder and file name in hex headers (headers are ASCII only)
#[tauri::command]
fn write_bytes(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else { return Err("нужны байты".into()) };
    let (dir, name) = (unhex(request.headers().get("x-dir"))?, unhex(request.headers().get("x-name"))?);
    std::fs::write(in_folder(&dir, &name)?, data).map_err(|e| e.to_string())
}

/// 8787 like the MCP server, so both share one project; SPICY_PORT overrides
fn base_port() -> u16 { std::env::var("SPICY_PORT").ok().and_then(|v| v.parse().ok()).unwrap_or(8787) }
fn addr(port: u16) -> SocketAddr { SocketAddr::from(([127, 0, 0, 1], port)) }
fn up(port: u16) -> bool { TcpStream::connect_timeout(&addr(port), Duration::from_millis(150)).is_ok() }
fn free(port: u16) -> bool { TcpListener::bind(addr(port)).is_ok() }

/// a tiny HTTP/1.0 request; None = nothing listens on the port
fn http(port: u16, method: &str, path: &str) -> Option<String> {
    let mut s = TcpStream::connect_timeout(&addr(port), Duration::from_millis(300)).ok()?;
    let _ = s.set_read_timeout(Some(Duration::from_millis(1500)));
    let _ = write!(s, "{method} {path} HTTP/1.0\r\nHost: 127.0.0.1\r\nContent-Length: 0\r\n\r\n");
    let mut out = String::new();
    let _ = s.read_to_string(&mut out);
    Some(out)
}
/// Some(0) = something old or unknown holds the port
fn api_version(port: u16) -> Option<u32> {
    let r = http(port, "GET", "/api/version")?;
    let v = r.split("\"api\":").nth(1).map(|t| t.chars().take_while(|c| c.is_ascii_digit()).collect::<String>());
    Some(v.and_then(|d| d.parse().ok()).unwrap_or(0))
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
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![save_file, pick_folder, list_dir, read_text, read_bytes, write_text, write_bytes])
        .manage(Server(Mutex::new(None)))
        .setup(|app| {
            let mut port = base_port();
            let reuse = match api_version(port) {
                Some(v) if v >= API => true,
                Some(_) => {
                    let _ = http(port, "POST", "/api/yield"); // newer servers hand the port over
                    let t = Instant::now();
                    while !free(port) && t.elapsed() < Duration::from_secs(3) {
                        std::thread::sleep(Duration::from_millis(100));
                    }
                    while !free(port) {
                        port += 1; // too old to hand over: run next to it
                    }
                    false
                }
                None => false,
            };
            if !reuse {
                let res = app.path().resource_dir()?;
                let data = app.path().app_local_data_dir()?; // %LOCALAPPDATA%: project + the auto-timing Python (GBs; not the roaming profile)
                std::fs::create_dir_all(&data)?;
                let mut cmd = Command::new(std::env::current_exe()?.with_file_name("spicy-server.exe"));
                cmd.arg("--http")
                    .env("SPICY_PORT", port.to_string())
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
                while !up(port) && t.elapsed() < Duration::from_secs(20) {
                    std::thread::sleep(Duration::from_millis(100));
                }
            }
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(format!("http://127.0.0.1:{port}/").parse()?))
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
                let _ = c.kill(); // our server only; a reused one keeps running
            }
        }
    });
}
