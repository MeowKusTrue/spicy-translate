// save_file is an app command the editor page (a remote URL) may call: it needs its own permission (allow-save-file)
fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&["save_file"])))
        .expect("tauri build");
}
