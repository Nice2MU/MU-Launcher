mod mcp;

use std::sync::Arc;
use serde_json::Value;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    Emitter, State,
};

#[tauri::command]
async fn mcp_reply(
    req_id: String,
    result: Value,
    pending: State<'_, Arc<mcp::McpPending>>,
) -> Result<(), String> {
    let mut map = pending.senders.lock().await;
    if let Some(tx) = map.remove(&req_id) {
        let _ = tx.send(result);
    }
    Ok(())
}

#[tauri::command]
async fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Failed to read {path}: {e}"))
}

#[tauri::command]
async fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {path}: {e}"))
}

#[tauri::command]
async fn write_text_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {e}"))?;
    }
    std::fs::write(&path, content).map_err(|e| format!("Failed to write {path}: {e}"))
}

#[tauri::command]
async fn write_binary_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {e}"))?;
    }
    std::fs::write(&path, bytes).map_err(|e| format!("Failed to write {path}: {e}"))
}

#[tauri::command]
async fn pick_export_folder() -> Result<Option<String>, String> {
    let out = std::process::Command::new("osascript")
        .args(["-e", "POSIX path of (choose folder with prompt \"Select Export Folder\")"])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Ok(None);
    }
    Ok(Some(String::from_utf8_lossy(&out.stdout).trim().to_string()))
}

#[tauri::command]
async fn pick_open_psd() -> Result<Option<String>, String> {
    let out = std::process::Command::new("osascript")
        .args(["-e", "POSIX path of (choose file with prompt \"Select PSD File\" of type {\"psd\"})"])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Ok(None);
    }
    Ok(Some(String::from_utf8_lossy(&out.stdout).trim().to_string()))
}

#[tauri::command]
async fn pick_open_project() -> Result<Option<String>, String> {
    let out = std::process::Command::new("osascript")
        .args(["-e", "POSIX path of (choose file with prompt \"Open MURig Project (.murig.json)\")"])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Ok(None);
    }
    Ok(Some(String::from_utf8_lossy(&out.stdout).trim().to_string()))
}

#[tauri::command]
async fn pick_save_project(default_name: String) -> Result<Option<String>, String> {
    let safe_name = default_name.replace('"', "");
    let script = format!(
        "POSIX path of (choose file name with prompt \"Save MURig Project\" default name \"{safe_name}\")"
    );
    let out = std::process::Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Ok(None);
    }
    Ok(Some(String::from_utf8_lossy(&out.stdout).trim().to_string()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            mcp_reply,
            read_file_bytes,
            read_text_file,
            write_text_file,
            write_binary_file,
            pick_open_psd,
            pick_open_project,
            pick_save_project,
            pick_export_folder
        ])
        .setup(|app| {
            mcp::spawn_mcp_server(app.handle().clone());

            let app_menu = Submenu::with_items(
                app,
                "MURig",
                true,
                &[
                    &PredefinedMenuItem::about(app, None, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::show_all(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?;

            let open_item = MenuItem::with_id(app, "file_open", "Open...", true, Some("CmdOrCtrl+O"))?;
            let update_psd_item =
                MenuItem::with_id(app, "file_update_psd", "Update PSD...", true, Some("CmdOrCtrl+U"))?;
            let save_item = MenuItem::with_id(app, "file_save", "Save", true, Some("CmdOrCtrl+S"))?;
            let save_as_item =
                MenuItem::with_id(app, "file_save_as", "Save As...", true, Some("CmdOrCtrl+Shift+S"))?;
            let export_item =
                MenuItem::with_id(app, "file_export", "Export...", true, Some("CmdOrCtrl+E"))?;
            let close_item =
                MenuItem::with_id(app, "file_close", "Close Project", true, Some("CmdOrCtrl+W"))?;

            let file_menu = Submenu::with_items(
                app,
                "File",
                true,
                &[
                    &open_item,
                    &update_psd_item,
                    &PredefinedMenuItem::separator(app)?,
                    &save_item,
                    &save_as_item,
                    &export_item,
                    &PredefinedMenuItem::separator(app)?,
                    &close_item,
                ],
            )?;

            let undo_item = MenuItem::with_id(app, "undo", "Undo", true, Some("CmdOrCtrl+Z"))?;
            let redo_item =
                MenuItem::with_id(app, "redo", "Redo", true, Some("CmdOrCtrl+Shift+Z"))?;

            let edit_menu = Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &undo_item,
                    &redo_item,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?;

            let menu = Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu])?;
            app.set_menu(menu)?;

            app.on_menu_event(|app_handle, event| {
                let id = event.id().as_ref();
                if id == "undo" {
                    let _ = app_handle.emit("murig://undo", ());
                } else if id == "redo" {
                    let _ = app_handle.emit("murig://redo", ());
                } else if id.starts_with("file_") {
                    let _ = app_handle.emit("murig://file-menu", id);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running MURig");
}
