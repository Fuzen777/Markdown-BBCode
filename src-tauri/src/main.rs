#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(non_snake_case)]

// ==> Section 1 - Storage Types <==
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Emitter, Manager};

struct AppState {
    dataDirectory: PathBuf,
    pendingPaths: Mutex<Vec<String>>,
    writeLock: Mutex<()>,
}

#[derive(Debug, Serialize)]
struct StorageError {
    kind: String,
    message: String,
}

impl StorageError {
    fn io(error: impl std::fmt::Display) -> Self {
        Self {
            kind: "io".into(),
            message: error.to_string(),
        }
    }

    fn conflict() -> Self {
        Self {
            kind: "conflict".into(),
            message: "The file changed outside the editor. Choose which version to keep.".into(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct FileSnapshot {
    path: String,
    content: String,
    revision: String,
}

// ==> Section 2 - Atomic File Operations <==
fn revision(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn atomicWrite(path: &Path, bytes: &[u8]) -> Result<(), StorageError> {
    let parentDirectory = path
        .parent()
        .ok_or_else(|| StorageError::io("Invalid file path"))?;
    let mut temporaryFile =
        tempfile::NamedTempFile::new_in(parentDirectory).map_err(StorageError::io)?;
    temporaryFile.write_all(bytes).map_err(StorageError::io)?;
    temporaryFile
        .as_file()
        .sync_all()
        .map_err(StorageError::io)?;
    temporaryFile.persist(path).map_err(StorageError::io)?;
    Ok(())
}

fn readSnapshot(path: &Path) -> Result<FileSnapshot, StorageError> {
    let resolvedPath = path.canonicalize().map_err(StorageError::io)?;
    let bytes = fs::read(&resolvedPath).map_err(StorageError::io)?;
    let content = String::from_utf8(bytes.clone()).map_err(|_| {
        StorageError::io("This file is not UTF-8 text. Convert a copy to UTF-8 before opening it.")
    })?;
    Ok(FileSnapshot {
        path: resolvedPath.to_string_lossy().into_owned(),
        content,
        revision: revision(&bytes),
    })
}

fn writeSnapshot(
    path: &Path,
    content: &str,
    expectedRevision: Option<&str>,
) -> Result<FileSnapshot, StorageError> {
    match fs::read(path) {
        Ok(bytes) if expectedRevision != Some(revision(&bytes).as_str()) => {
            return Err(StorageError::conflict())
        }
        Ok(_) => (),
        Err(error)
            if error.kind() == std::io::ErrorKind::NotFound && expectedRevision.is_none() => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(StorageError::conflict())
        }
        Err(error) => return Err(StorageError::io(error)),
    }
    atomicWrite(path, content.as_bytes())?;
    readSnapshot(path)
}

#[tauri::command]
fn read_file(path: String) -> Result<FileSnapshot, StorageError> {
    readSnapshot(Path::new(&path))
}

#[tauri::command]
fn save_file(
    state: tauri::State<AppState>,
    path: String,
    content: String,
    expectedRevision: Option<String>,
) -> Result<FileSnapshot, StorageError> {
    let _writeGuard = state.writeLock.lock().map_err(StorageError::io)?;
    writeSnapshot(Path::new(&path), &content, expectedRevision.as_deref())
}

#[tauri::command]
fn load_session(state: tauri::State<AppState>) -> Result<Option<serde_json::Value>, StorageError> {
    let sessionPath = state.dataDirectory.join("session.json");
    match fs::read(&sessionPath) {
        Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|error| {
            StorageError::io(format!(
                "Recovery data could not be read at {}: {error}",
                sessionPath.display()
            ))
        }),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(StorageError::io(error)),
    }
}

#[tauri::command]
fn save_session(
    state: tauri::State<AppState>,
    session: serde_json::Value,
) -> Result<(), StorageError> {
    let _writeGuard = state.writeLock.lock().map_err(StorageError::io)?;
    let bytes = serde_json::to_vec(&session).map_err(StorageError::io)?;
    atomicWrite(&state.dataDirectory.join("session.json"), &bytes)
}

#[tauri::command]
fn take_pending_paths(state: tauri::State<AppState>) -> Result<Vec<String>, StorageError> {
    Ok(std::mem::take(
        &mut *state.pendingPaths.lock().map_err(StorageError::io)?,
    ))
}

#[tauri::command]
fn finish_close(app: tauri::AppHandle) {
    app.exit(0);
}

// ==> Section 3 - Portable Window Lifecycle <==
fn argumentPaths(arguments: impl Iterator<Item = String>, workingDirectory: &Path) -> Vec<String> {
    arguments
        .filter(|argument| !argument.starts_with('-'))
        .map(|argument| {
            workingDirectory
                .join(argument)
                .to_string_lossy()
                .into_owned()
        })
        .collect()
}

fn main() {
    let executablePath = std::env::current_exe().expect("Cannot locate the portable application");
    let dataDirectory = executablePath
        .parent()
        .expect("Executable has no directory")
        .join("portable-data");
    fs::create_dir_all(&dataDirectory)
        .expect("The portable folder must be writable. Move the app to a writable folder.");
    let workingDirectory = std::env::current_dir().unwrap_or_default();
    let pendingPaths = argumentPaths(std::env::args().skip(1), &workingDirectory);
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, arguments, workingDirectory| {
            let state = app.state::<AppState>();
            if let Ok(mut pendingPaths) = state.pendingPaths.lock() {
                pendingPaths.extend(argumentPaths(arguments.into_iter().skip(1), Path::new(&workingDirectory)));
            }
            let _ = app.emit("open-files", ());
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState { dataDirectory: dataDirectory.clone(), pendingPaths: Mutex::new(pendingPaths), writeLock: Mutex::new(()) })
        .setup(move |app| {
            tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
                .title("BBCode Editor")
                .inner_size(1120.0, 800.0)
                .min_inner_size(720.0, 480.0)
                .data_directory(dataDirectory.join("webview"))
                .build()?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("request-close", ());
            }
        })
        .invoke_handler(tauri::generate_handler![read_file, save_file, load_session, save_session, take_pending_paths, finish_close])
        .run(tauri::generate_context!())
        .expect("Could not start BBCode Editor. Ensure Microsoft Edge WebView2 is installed and the portable folder is writable.");
}

// ==> Section 4 - Persistence Regression Tests <==
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_external_changes_and_missing_files() {
        let directory = tempfile::tempdir().unwrap();
        let filePath = directory.path().join("description.bbcode");
        let initial = writeSnapshot(&filePath, "[b]Original[/b]", None).unwrap();
        fs::write(&filePath, "External edit").unwrap();
        assert_eq!(
            writeSnapshot(&filePath, "My edit", Some(&initial.revision))
                .unwrap_err()
                .kind,
            "conflict"
        );
        assert_eq!(fs::read_to_string(&filePath).unwrap(), "External edit");
        fs::remove_file(&filePath).unwrap();
        assert_eq!(
            writeSnapshot(&filePath, "My edit", Some(&initial.revision))
                .unwrap_err()
                .kind,
            "conflict"
        );
    }

    #[test]
    fn saves_unicode_and_protects_existing_save_as_target() {
        let directory = tempfile::tempdir().unwrap();
        let filePath = directory.path().join("é.bbcode");
        let initial = writeSnapshot(&filePath, "[spoiler]雪 🐈[/spoiler]\r\n", None).unwrap();
        assert_eq!(readSnapshot(&filePath).unwrap().content, initial.content);
        assert_eq!(
            writeSnapshot(&filePath, "Overwrite", None)
                .unwrap_err()
                .kind,
            "conflict"
        );
        let updated = writeSnapshot(&filePath, "Updated", Some(&initial.revision)).unwrap();
        assert_ne!(updated.revision, initial.revision);
        assert_eq!(fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn rejects_non_utf8_without_touching_file() {
        let directory = tempfile::tempdir().unwrap();
        let filePath = directory.path().join("legacy.bbcode");
        fs::write(&filePath, [0xff, 0xfe]).unwrap();
        assert!(readSnapshot(&filePath).is_err());
        assert_eq!(fs::read(&filePath).unwrap(), [0xff, 0xfe]);
    }
}
