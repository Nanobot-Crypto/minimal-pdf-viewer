//! Vela — visor local de PDF y Markdown.
//!
//! Este binario expone únicamente comandos de acceso a archivos locales y
//! persistencia de la sesión. No hay red, cuentas ni analítica: ningún dato
//! del usuario sale de la máquina.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::Serialize;
use std::fs;
use std::path::Path;
use std::sync::Mutex;
use tauri::Manager;

#[derive(Serialize)]
struct DirEntryInfo {
    name: String,
    id: String,
    #[serde(rename = "isDir")]
    is_dir: bool,
    kind: Option<String>,
}

/// Archivos recibidos al abrir la aplicación (doble clic / «Abrir con»).
struct StartupFiles(Mutex<Vec<String>>);

fn doc_kind(name: &str) -> Option<&'static str> {
    let lower = name.to_lowercase();
    if lower.ends_with(".pdf") {
        Some("pdf")
    } else if lower.ends_with(".md") || lower.ends_with(".markdown") || lower.ends_with(".mdown") {
        Some("md")
    } else {
        None
    }
}

#[tauri::command]
fn vela_read_file(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("No se pudo leer «{path}»: {e}"))?;
    Ok(B64.encode(bytes))
}

/// Escribe texto. `overwrite` solo llega `true` tras confirmación explícita
/// del usuario en la interfaz: nunca se sobrescribe en silencio.
#[tauri::command]
fn vela_write_file(path: String, content_b64: String, overwrite: bool) -> Result<String, String> {
    let p = Path::new(&path);
    if p.exists() && !overwrite {
        return Ok("exists".to_string());
    }
    if let Some(parent) = p.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let bytes = B64
        .decode(content_b64.as_bytes())
        .map_err(|e| format!("Contenido inválido: {e}"))?;
    fs::write(p, bytes).map_err(|e| format!("No se pudo guardar «{path}»: {e}"))?;
    Ok("ok".to_string())
}

#[tauri::command]
fn vela_file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
fn vela_read_dir(path: String) -> Result<Vec<DirEntryInfo>, String> {
    let mut out: Vec<DirEntryInfo> = Vec::new();
    collect_docs(Path::new(&path), 0, &mut out);
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Recorre la carpeta con profundidad limitada (2 niveles) y solo recoge
/// documentos compatibles: PDF y Markdown.
fn collect_docs(dir: &Path, depth: u32, out: &mut Vec<DirEntryInfo>) {
    if depth > 2 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let p = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if p.is_dir() {
            collect_docs(&p, depth + 1, out);
        } else if let Some(kind) = doc_kind(&name) {
            out.push(DirEntryInfo {
                name,
                id: p.to_string_lossy().to_string(),
                is_dir: false,
                kind: Some(kind.to_string()),
            });
        }
    }
}

fn state_file(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Directorio de configuración no disponible: {e}"))?;
    let _ = fs::create_dir_all(&dir);
    Ok(dir.join("vela-state.json"))
}

#[tauri::command]
fn vela_load_state(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let p = state_file(&app)?;
    match fs::read_to_string(p) {
        Ok(json) => Ok(Some(json)),
        Err(_) => Ok(None),
    }
}

#[tauri::command]
fn vela_save_state(app: tauri::AppHandle, json: String) -> Result<(), String> {
    let p = state_file(&app)?;
    fs::write(p, json).map_err(|e| format!("No se pudo guardar la sesión: {e}"))
}

/// Abre el documento con la aplicación predeterminada del sistema
/// (visor PDF del escritorio, editor de texto, etc.).
#[tauri::command]
fn vela_open_with_system(path: String) -> Result<bool, String> {
    let p = path.clone();
    #[cfg(target_os = "windows")]
    let spawned = std::process::Command::new("cmd")
        .args(["/C", "start", "", &p])
        .spawn();
    #[cfg(target_os = "macos")]
    let spawned = std::process::Command::new("open").arg(&p).spawn();
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let spawned = std::process::Command::new("xdg-open").arg(&p).spawn();
    spawned
        .map(|_| true)
        .map_err(|e| format!("No se pudo abrir con el sistema: {e}"))
}

/// Devuelve (una sola vez) los documentos con los que se lanzó la aplicación.
#[tauri::command]
fn vela_startup_files(state: tauri::State<'_, StartupFiles>) -> Vec<String> {
    match state.0.lock() {
        Ok(mut guard) => std::mem::take(&mut *guard),
        Err(_) => Vec::new(),
    }
}

fn main() {
    let startup: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| doc_kind(a).is_some())
        .collect();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(StartupFiles(Mutex::new(startup)))
        .invoke_handler(tauri::generate_handler![
            vela_read_file,
            vela_write_file,
            vela_file_exists,
            vela_read_dir,
            vela_load_state,
            vela_save_state,
            vela_open_with_system,
            vela_startup_files,
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar Vela");
}
