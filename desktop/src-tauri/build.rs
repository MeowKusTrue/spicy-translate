// app commands the editor page (a remote URL) may call need their own permissions (allow-save-file, allow-write-text…)
fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&["save_file", "pick_folder", "list_dir", "read_text", "read_bytes", "write_text", "write_bytes"])))
        .expect("tauri build");
}
