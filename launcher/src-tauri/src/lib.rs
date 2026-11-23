use serde::Serialize;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::menu::{Menu, PredefinedMenuItem, Submenu};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiscoveredApp {
    name: String,
    path: String,
    running: bool,
    mcp_port: Option<u16>,
    mcp_online: bool,
}

fn hub_root() -> PathBuf {
    let default_root = PathBuf::from("/Users/nice2mu/Desktop/MU Launcher");
    if let Ok(exe) = std::env::current_exe() {
        // Inside MU Launcher.app/Contents/MacOS/mu-launcher -> go up 3 levels to folder containing MU Launcher.app
        if let Some(app_parent) = exe
            .parent()
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
            .and_then(|p| p.parent())
        {
            if app_parent.join("MU Launcher.app").exists() {
                return app_parent.to_path_buf();
            }
        }
    }
    default_root
}

fn is_port_open(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(80)).is_ok()
}

fn is_app_running(name: &str) -> bool {
    let lower = name.to_lowercase();
    let out = std::process::Command::new("pgrep")
        .args(["-x", &lower])
        .output();
    if let Ok(o) = out {
        if o.status.success() {
            return true;
        }
    }
    let out2 = std::process::Command::new("pgrep")
        .args(["-if", &format!("/{name}.app/")])
        .output();
    matches!(out2, Ok(o) if o.status.success())
}

fn collect_apps(dir: &Path, depth: usize, out: &mut Vec<DiscoveredApp>) {
    if depth > 2 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Some(fname) = path.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        if fname.starts_with('.')
            || fname == "target"
            || fname == "node_modules"
            || fname == "launcher"
            || fname == "MU Launcher.app"
        {
            continue;
        }
        if path.is_dir() {
            if fname.ends_with(".app") {
                let name = fname.trim_end_matches(".app").to_string();
                let mcp_port = if name.eq_ignore_ascii_case("MURIG") {
                    Some(7820)
                } else {
                    None
                };
                let mcp_online = mcp_port.map(is_port_open).unwrap_or(false);
                let running = mcp_online || is_app_running(&name);
                out.push(DiscoveredApp {
                    name,
                    path: path.to_string_lossy().to_string(),
                    running,
                    mcp_port,
                    mcp_online,
                });
            } else {
                collect_apps(&path, depth + 1, out);
            }
        }
    }
}

#[tauri::command]
fn get_hub_root() -> String {
    hub_root().to_string_lossy().to_string()
}

#[tauri::command]
fn scan_launcher_apps() -> Vec<DiscoveredApp> {
    let root = hub_root();
    let mut apps = Vec::new();
    collect_apps(&root, 0, &mut apps);
    apps.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    apps
}

#[tauri::command]
fn check_app_status(name: String, mcp_port: Option<u16>) -> (bool, bool) {
    let mcp_online = mcp_port.map(is_port_open).unwrap_or(false);
    let running = mcp_online || is_app_running(&name);
    (running, mcp_online)
}

#[tauri::command]
fn load_registry() -> Result<String, String> {
    let path = hub_root().join(".mu-launcher.json");
    if !path.exists() {
        return Ok(String::new());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_registry(content: String) -> Result<(), String> {
    let path = hub_root().join(".mu-launcher.json");
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn launch_app(path: String) -> Result<(), String> {
    let status = std::process::Command::new("open")
        .arg(&path)
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("Failed to open {path}"));
    }
    Ok(())
}

#[tauri::command]
fn quit_app(name: String) -> Result<(), String> {
    let _ = std::process::Command::new("osascript")
        .args(["-e", &format!("tell application \"{}\" to quit", name.replace('"', ""))])
        .output();
    let _ = std::process::Command::new("pkill")
        .args(["-x", &name.to_lowercase()])
        .output();
    Ok(())
}

#[tauri::command]
fn reveal_in_finder(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .args(["-R", &path])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    std::process::Command::new("open")
        .arg(&path)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn pick_app_bundle() -> Result<Option<String>, String> {
    let out = std::process::Command::new("osascript")
        .args(["-e", "POSIX path of (choose file with prompt \"Add App to MU Launcher\")"])
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
            get_hub_root,
            scan_launcher_apps,
            check_app_status,
            load_registry,
            save_registry,
            launch_app,
            quit_app,
            reveal_in_finder,
            open_folder,
            pick_app_bundle,
        ])
        .setup(|app| {
            let app_menu = Submenu::with_items(
                app,
                "MU Launcher",
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
            let edit_menu = Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?;
            let menu = Menu::with_items(app, &[&app_menu, &edit_menu])?;
            app.set_menu(menu)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
