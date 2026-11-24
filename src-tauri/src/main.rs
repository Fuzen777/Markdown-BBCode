#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(non_snake_case)]

// ==> Section 1 - Storage Types <==
use base64::Engine as _;
use minisign_verify::{PublicKey, Signature};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::VecDeque,
    fs,
    io::{Cursor, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::{Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags, WindowExt};

const UPDATER_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDFCMzBDOTA5QTExRTYwNDYKUldSR1lCNmhDY2t3R3l1VktrZ0duVE9tSFBkVW9kV0lpM0VCVkhrS2x4WWNxUHBwM2N1OGJhTVgK";
const PORTABLE_MANIFEST_URL: &str =
    "https://github.com/Fuzen777/Markdown-BBCode/releases/latest/download/portable-latest.json";

struct PendingState {
    pendingPaths: Mutex<Vec<String>>,
}

struct AppState {
    dataDirectory: PathBuf,
    writeLock: Mutex<()>,
    isPortable: bool,
    executablePath: PathBuf,
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

    fn missing(message: impl Into<String>) -> Self {
        Self {
            kind: "missing".into(),
            message: message.into(),
        }
    }

    fn exists(message: impl Into<String>) -> Self {
        Self {
            kind: "exists".into(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct FileSnapshot {
    path: String,
    content: String,
    revision: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct DirectoryEntry {
    name: String,
    path: String,
    isDir: bool,
    kind: Option<String>,
    hasReadable: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct DirectoryListing {
    root: String,
    parent: Option<String>,
    entries: Vec<DirectoryEntry>,
    truncated: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct PathKind {
    path: String,
    exists: bool,
    isDir: bool,
}

#[derive(Debug, Serialize, Deserialize)]
struct RuntimeInfo {
    version: String,
    isPortable: bool,
    executablePath: String,
}

#[derive(Debug, Serialize, Deserialize)]
struct UpdateInfo {
    available: bool,
    currentVersion: String,
    latestVersion: String,
    notes: String,
    isPortable: bool,
}

#[derive(Debug, Deserialize)]
struct PortableManifest {
    version: String,
    #[serde(default)]
    notes: String,
    url: String,
    sha256: String,
    signature: String,
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
    let resolvedPath = path.canonicalize().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            StorageError {
                kind: "missing".into(),
                message: "The file no longer exists.".into(),
            }
        } else {
            StorageError::io(error)
        }
    })?;
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
    let sessionPath = state.dataDirectory.join("session.json");
    let backupPath = state.dataDirectory.join("session-v1-backup.json");
    if session.get("version").and_then(|value| value.as_u64()) == Some(2) && !backupPath.exists() {
        if let Ok(previousBytes) = fs::read(&sessionPath) {
            if serde_json::from_slice::<serde_json::Value>(&previousBytes)
                .ok()
                .and_then(|previous| previous.get("version").and_then(|value| value.as_u64()))
                == Some(1)
            {
                atomicWrite(&backupPath, &previousBytes)?;
            }
        }
    }
    atomicWrite(&state.dataDirectory.join("session.json"), &bytes)
}

#[tauri::command]
fn take_pending_paths(state: tauri::State<PendingState>) -> Result<Vec<String>, StorageError> {
    Ok(std::mem::take(
        &mut *state.pendingPaths.lock().map_err(StorageError::io)?,
    ))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct WindowRect {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

fn windowStateFlags() -> StateFlags {
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED | StateFlags::FULLSCREEN
}

fn intersectionArea(a: WindowRect, b: WindowRect) -> i64 {
    let left = i64::from(a.x).max(i64::from(b.x));
    let top = i64::from(a.y).max(i64::from(b.y));
    let right = (i64::from(a.x) + i64::from(a.width)).min(i64::from(b.x) + i64::from(b.width));
    let bottom = (i64::from(a.y) + i64::from(a.height)).min(i64::from(b.y) + i64::from(b.height));
    if right > left && bottom > top {
        (right - left) * (bottom - top)
    } else {
        0
    }
}

fn resolveRescuedWindowRect(
    current: WindowRect,
    workAreas: &[WindowRect],
    primaryWorkArea: Option<WindowRect>,
) -> Option<WindowRect> {
    if workAreas.is_empty() {
        return None;
    }

    let titleHeight = current.height.min(40);
    let minTitleOverlapW = i64::from(current.width.min(120));
    let minTitleOverlapH = i64::from(titleHeight.min(24));

    let currentTop = i64::from(current.y);
    let currentLeft = i64::from(current.x);
    let currentRight = currentLeft + i64::from(current.width);
    let titleBottom = currentTop + i64::from(titleHeight);

    let safelyVisible = workAreas.iter().any(|area| {
        let areaLeft = i64::from(area.x);
        let areaTop = i64::from(area.y);
        let areaRight = areaLeft + i64::from(area.width);
        let areaBottom = areaTop + i64::from(area.height);

        let overlapW = (currentRight.min(areaRight) - currentLeft.max(areaLeft)).max(0);
        let overlapH = (titleBottom.min(areaBottom) - currentTop.max(areaTop)).max(0);
        let fitsSize = current.width <= area.width.saturating_add(16)
            && current.height <= area.height.saturating_add(16);
        let topReachable =
            currentTop >= areaTop - 8 && currentTop + minTitleOverlapH <= areaBottom + 8;

        overlapW >= minTitleOverlapW && overlapH >= minTitleOverlapH && fitsSize && topReachable
    });
    if safelyVisible {
        return None;
    }

    let mut bestArea = None;
    let mut bestOverlap = 0i64;
    for area in workAreas {
        let areaOverlap = intersectionArea(current, *area);
        if areaOverlap > bestOverlap {
            bestOverlap = areaOverlap;
            bestArea = Some(*area);
        }
    }

    let target = bestArea.or(primaryWorkArea).unwrap_or(workAreas[0]);
    let targetWidth = if target.width >= 720 {
        current.width.clamp(720, target.width)
    } else {
        current.width.min(target.width.max(1))
    };
    let targetHeight = if target.height >= 480 {
        current.height.clamp(480, target.height)
    } else {
        current.height.min(target.height.max(1))
    };

    let targetLeft = i64::from(target.x);
    let targetTop = i64::from(target.y);
    let (nextX, nextY) = if bestOverlap > 0 {
        let maxX = (targetLeft + i64::from(target.width) - i64::from(targetWidth)).max(targetLeft);
        let maxY = (targetTop + i64::from(target.height) - i64::from(targetHeight)).max(targetTop);
        (
            currentLeft.clamp(targetLeft, maxX) as i32,
            currentTop.clamp(targetTop, maxY) as i32,
        )
    } else {
        let centeredX = targetLeft + (i64::from(target.width) - i64::from(targetWidth)) / 2;
        let centeredY = targetTop + (i64::from(target.height) - i64::from(targetHeight)) / 2;
        (centeredX as i32, centeredY as i32)
    };

    let rescued = WindowRect {
        x: nextX,
        y: nextY,
        width: targetWidth,
        height: targetHeight,
    };
    (rescued != current).then_some(rescued)
}

fn rescueWindowIfOffScreen(window: &tauri::WebviewWindow) {
    if window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
        return;
    }
    let (Ok(pos), Ok(outerSize), Ok(innerSize), Ok(monitors)) = (
        window.outer_position(),
        window.outer_size(),
        window.inner_size(),
        window.available_monitors(),
    ) else {
        return;
    };
    let monitorToRect = |monitor: &tauri::Monitor| -> WindowRect {
        let work = monitor.work_area();
        WindowRect {
            x: work.position.x,
            y: work.position.y,
            width: work.size.width,
            height: work.size.height,
        }
    };
    let workAreas: Vec<WindowRect> = monitors.iter().map(monitorToRect).collect();
    let primaryWorkArea = window
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| monitorToRect(&monitor));
    let current = WindowRect {
        x: pos.x,
        y: pos.y,
        width: outerSize.width,
        height: outerSize.height,
    };
    let Some(rescued) = resolveRescuedWindowRect(current, &workAreas, primaryWorkArea) else {
        return;
    };
    if rescued.width < current.width || rescued.height < current.height {
        let frameWidth = outerSize.width.saturating_sub(innerSize.width);
        let frameHeight = outerSize.height.saturating_sub(innerSize.height);
        let nextInnerWidth = rescued.width.saturating_sub(frameWidth).max(320);
        let nextInnerHeight = rescued.height.saturating_sub(frameHeight).max(240);
        let _ = window.set_size(tauri::PhysicalSize::new(nextInnerWidth, nextInnerHeight));
    }
    let _ = window.set_position(tauri::PhysicalPosition::new(rescued.x, rescued.y));
}

#[tauri::command]
fn finish_close(app: tauri::AppHandle) {
    let _ = app.save_window_state(windowStateFlags());
    app.exit(0);
}

fn validateExternalUrl(url: &str) -> Result<&str, StorageError> {
    let trimmed = url.trim();
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.starts_with("https://")
        || lower.starts_with("http://")
        || lower.starts_with("mailto:"))
    {
        return Err(StorageError::io(
            "Links must start with http://, https://, or mailto:.",
        ));
    }
    if trimmed.is_empty()
        || trimmed.chars().any(|ch| {
            ch.is_control()
                || ch.is_whitespace()
                || matches!(ch, '"' | '\'' | '<' | '>' | '[' | ']')
        })
    {
        return Err(StorageError::io("Link URL contains disallowed characters."));
    }
    Ok(trimmed)
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), StorageError> {
    let validated = validateExternalUrl(&url)?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("rundll32")
        .args(["url.dll,FileProtocolHandler", validated])
        .spawn()
        .map_err(StorageError::io)?;
    #[cfg(not(target_os = "windows"))]
    let _ = validated;
    Ok(())
}

// ==> Section 2B - Folder Browser Operations <==
fn normalizeDisplayPath(path: &Path) -> String {
    let raw = path.to_string_lossy();
    if let Some(unc) = raw.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{unc}");
    }
    if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        return stripped.to_owned();
    }
    raw.into_owned()
}

fn ignoredDirName(name: &str) -> bool {
    if name.starts_with('.') {
        return true;
    }
    matches!(
        name.to_ascii_lowercase().as_str(),
        ".git"
            | ".hg"
            | ".svn"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | ".vs"
            | ".vscode"
            | "__pycache__"
            | "portable-data"
    )
}

fn fileKind(path: &Path) -> Option<&'static str> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())?;
    match extension.as_str() {
        "md" | "markdown" | "mdbbcode" => Some("markdown"),
        "txt" => Some("txt"),
        "bbcode" => Some("bbcode"),
        _ => None,
    }
}

fn validateFileNamePart(name: &str) -> Result<(), StorageError> {
    let trimmed = name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || name.ends_with([' ', '.'])
        || trimmed.chars().any(|ch| {
            ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
        })
    {
        return Err(StorageError::io(
            "Enter a valid filename without invalid characters.",
        ));
    }
    Ok(())
}

fn dirContainsReadable(dir: &Path, depth: usize, budget: &mut usize) -> bool {
    if *budget == 0 {
        return true;
    }
    if depth == 0 {
        return false;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    let mut subdirs = Vec::new();
    for entry in entries.flatten() {
        if *budget == 0 {
            return true;
        }
        *budget -= 1;
        let entryPath = entry.path();
        let Ok(fileType) = entry.file_type() else {
            continue;
        };
        if fileType.is_dir() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !ignoredDirName(&name) {
                subdirs.push(entryPath);
            }
        } else if (fileType.is_file() || (fileType.is_symlink() && entryPath.is_file()))
            && fileKind(&entryPath).is_some()
        {
            return true;
        }
    }
    for subdir in subdirs {
        if dirContainsReadable(&subdir, depth - 1, budget) {
            return true;
        }
    }
    false
}

fn pathInfoImpl(path: &Path) -> Result<PathKind, StorageError> {
    match fs::metadata(path) {
        Ok(meta) => {
            let resolved = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
            Ok(PathKind {
                path: normalizeDisplayPath(&resolved),
                exists: true,
                isDir: meta.is_dir(),
            })
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(PathKind {
            path: normalizeDisplayPath(path),
            exists: false,
            isDir: false,
        }),
        Err(error) => Err(StorageError::io(error)),
    }
}

fn listDirectoryImpl(path: &Path, showAll: bool) -> Result<DirectoryListing, StorageError> {
    let resolved = path.canonicalize().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            StorageError::missing("Folder no longer exists.")
        } else {
            StorageError::io(error)
        }
    })?;
    if !resolved.is_dir() {
        return Err(StorageError::io("Selected path is not a folder."));
    }
    let readDir = fs::read_dir(&resolved).map_err(StorageError::io)?;
    let mut entries = Vec::new();
    let mut truncated = false;
    for (inspected, item) in readDir.enumerate() {
        if inspected >= 2000 {
            truncated = true;
            break;
        }
        let Ok(entry) = item else {
            continue;
        };
        let entryPath = entry.path();
        let Ok(fileType) = entry.file_type() else {
            continue;
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        if fileType.is_dir() || (fileType.is_symlink() && entryPath.is_dir()) {
            let ignored = ignoredDirName(&name);
            if ignored && !showAll {
                continue;
            }
            let hasReadable = if ignored {
                false
            } else {
                let mut budget = 2000usize;
                dirContainsReadable(&entryPath, 4, &mut budget)
            };
            if !showAll && !hasReadable {
                continue;
            }
            entries.push(DirectoryEntry {
                name,
                path: normalizeDisplayPath(&entryPath),
                isDir: true,
                kind: None,
                hasReadable,
            });
        } else if fileType.is_file() || (fileType.is_symlink() && entryPath.is_file()) {
            let Some(kind) = fileKind(&entryPath) else {
                continue;
            };
            entries.push(DirectoryEntry {
                name,
                path: normalizeDisplayPath(&entryPath),
                isDir: false,
                kind: Some(kind.into()),
                hasReadable: true,
            });
        }
    }
    entries.sort_by(|left, right| {
        right
            .isDir
            .cmp(&left.isDir)
            .then_with(|| {
                left.name
                    .to_ascii_lowercase()
                    .cmp(&right.name.to_ascii_lowercase())
            })
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(DirectoryListing {
        root: normalizeDisplayPath(&resolved),
        parent: resolved.parent().map(normalizeDisplayPath),
        entries,
        truncated,
    })
}

fn searchDirectoryImpl(
    root: &Path,
    query: &str,
    maxResults: usize,
) -> Result<Vec<DirectoryEntry>, StorageError> {
    let resolved = root.canonicalize().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            StorageError::missing("Folder no longer exists.")
        } else {
            StorageError::io(error)
        }
    })?;
    let trimmedQuery = query.trim().to_ascii_lowercase();
    if trimmedQuery.is_empty() {
        return Ok(Vec::new());
    }
    let limit = maxResults.min(500);
    let mut results = Vec::new();
    let mut budget = 6000usize;
    let mut queue = VecDeque::from([(resolved.clone(), 0usize)]);

    while let Some((dir, depth)) = queue.pop_front() {
        if budget == 0 || results.len() >= limit {
            break;
        }
        let Ok(readDir) = fs::read_dir(&dir) else {
            continue;
        };
        for item in readDir.flatten() {
            if budget == 0 || results.len() >= limit {
                break;
            }
            budget -= 1;
            let entryPath = item.path();
            let Ok(fileType) = item.file_type() else {
                continue;
            };
            let name = item.file_name().to_string_lossy().into_owned();
            if fileType.is_dir() {
                if depth < 6 && !ignoredDirName(&name) {
                    queue.push_back((entryPath, depth + 1));
                }
            } else if fileType.is_file() || (fileType.is_symlink() && entryPath.is_file()) {
                let Some(kind) = fileKind(&entryPath) else {
                    continue;
                };
                let relative = entryPath
                    .strip_prefix(&resolved)
                    .map(|rel| {
                        rel.to_string_lossy()
                            .replace('\\', "/")
                            .to_ascii_lowercase()
                    })
                    .unwrap_or_else(|_| name.to_ascii_lowercase());
                if name.to_ascii_lowercase().contains(&trimmedQuery)
                    || relative.contains(&trimmedQuery)
                {
                    results.push(DirectoryEntry {
                        name,
                        path: normalizeDisplayPath(&entryPath),
                        isDir: false,
                        kind: Some(kind.into()),
                        hasReadable: true,
                    });
                }
            }
        }
    }
    results.sort_by(|left, right| {
        left.path
            .to_ascii_lowercase()
            .cmp(&right.path.to_ascii_lowercase())
    });
    Ok(results)
}

fn createFileImpl(target: &Path, content: &str) -> Result<FileSnapshot, StorageError> {
    let fileName = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| StorageError::io("Invalid file path."))?;
    validateFileNamePart(fileName)?;
    let parent = target
        .parent()
        .ok_or_else(|| StorageError::io("Invalid parent folder."))?;
    if !parent.is_dir() {
        return Err(StorageError::missing("Parent folder does not exist."));
    }
    let mut handle = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(target)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                StorageError::exists("A file with that name already exists.")
            } else {
                StorageError::io(error)
            }
        })?;
    handle
        .write_all(content.as_bytes())
        .map_err(StorageError::io)?;
    handle.sync_all().map_err(StorageError::io)?;
    readSnapshot(target)
}

fn renamePathImpl(oldPath: &Path, newPath: &Path) -> Result<String, StorageError> {
    if !oldPath.exists() {
        return Err(StorageError::missing(
            "The item to rename no longer exists.",
        ));
    }
    let newName = newPath
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| StorageError::io("Invalid target name."))?;
    validateFileNamePart(newName)?;
    if newPath.exists() {
        let sameTarget = oldPath.canonicalize().ok() == newPath.canonicalize().ok();
        if !sameTarget {
            return Err(StorageError::exists(
                "An item with that name already exists.",
            ));
        }
    }
    fs::rename(oldPath, newPath).map_err(StorageError::io)?;
    let resolved = newPath
        .canonicalize()
        .unwrap_or_else(|_| newPath.to_path_buf());
    Ok(normalizeDisplayPath(&resolved))
}

#[tauri::command]
fn path_info(path: String) -> Result<PathKind, StorageError> {
    pathInfoImpl(Path::new(&path))
}

#[tauri::command]
fn list_directory(path: String, showAll: Option<bool>) -> Result<DirectoryListing, StorageError> {
    listDirectoryImpl(Path::new(&path), showAll.unwrap_or(false))
}

#[tauri::command]
fn search_directory(
    root: String,
    query: String,
    maxResults: Option<usize>,
) -> Result<Vec<DirectoryEntry>, StorageError> {
    searchDirectoryImpl(Path::new(&root), &query, maxResults.unwrap_or(100))
}

#[tauri::command]
fn create_file(
    state: tauri::State<AppState>,
    path: String,
    content: Option<String>,
) -> Result<FileSnapshot, StorageError> {
    let _writeGuard = state.writeLock.lock().map_err(StorageError::io)?;
    createFileImpl(Path::new(&path), content.as_deref().unwrap_or(""))
}

#[tauri::command]
fn rename_path(
    state: tauri::State<AppState>,
    oldPath: String,
    newPath: String,
) -> Result<String, StorageError> {
    let _writeGuard = state.writeLock.lock().map_err(StorageError::io)?;
    renamePathImpl(Path::new(&oldPath), Path::new(&newPath))
}

#[tauri::command]
fn reveal_in_explorer(path: String) -> Result<(), StorageError> {
    let candidate = Path::new(&path);
    let resolved = candidate.canonicalize().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            StorageError::missing("Item no longer exists.")
        } else {
            StorageError::io(error)
        }
    })?;
    let clean = normalizeDisplayPath(&resolved);
    #[cfg(target_os = "windows")]
    {
        if resolved.is_dir() {
            std::process::Command::new("explorer.exe")
                .arg(&clean)
                .spawn()
                .map_err(StorageError::io)?;
        } else {
            std::process::Command::new("explorer.exe")
                .arg(format!("/select,{clean}"))
                .spawn()
                .map_err(StorageError::io)?;
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = (&clean, resolved.is_dir());
    Ok(())
}

// ==> Section 2C - Runtime Mode And Signed Auto-Updater <==
fn detectPortableMode(executableDir: &Path) -> bool {
    cfg!(debug_assertions)
        || executableDir.join("Portable.txt").is_file()
        || executableDir.join("portable-data").is_dir()
}

fn isNewerVersion(current: &str, candidate: &str) -> Result<bool, StorageError> {
    let cur = Version::parse(current.trim().trim_start_matches('v')).map_err(StorageError::io)?;
    let cand =
        Version::parse(candidate.trim().trim_start_matches('v')).map_err(StorageError::io)?;
    Ok(cand > cur)
}

fn decodeMaybeBase64(value: &str) -> Result<String, StorageError> {
    let trimmed = value.trim();
    if trimmed.starts_with("untrusted comment:") {
        return Ok(trimmed.to_owned());
    }
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(trimmed)
        .map_err(|error| StorageError::io(format!("Invalid signature encoding: {error}")))?;
    String::from_utf8(decoded)
        .map_err(|error| StorageError::io(format!("Invalid UTF-8 signature: {error}")))
}

fn verifyPortablePayload(
    bytes: &[u8],
    expectedSha256: &str,
    signatureRawOrB64: &str,
    pubkeyRawOrB64: &str,
) -> Result<(), StorageError> {
    let actualHash = revision(bytes);
    if !actualHash.eq_ignore_ascii_case(expectedSha256.trim()) {
        return Err(StorageError::io(
            "Portable update checksum verification failed.",
        ));
    }
    let pubkeyText = decodeMaybeBase64(pubkeyRawOrB64)?;
    let publicKey = PublicKey::decode(&pubkeyText)
        .map_err(|error| StorageError::io(format!("Invalid updater public key: {error}")))?;
    let sigText = decodeMaybeBase64(signatureRawOrB64)?;
    let signature = Signature::decode(&sigText)
        .map_err(|error| StorageError::io(format!("Invalid updater signature: {error}")))?;
    publicKey.verify(bytes, &signature, true).map_err(|error| {
        StorageError::io(format!("Updater signature verification failed: {error}"))
    })
}

fn extractZipSafely(zipBytes: &[u8], extractDir: &Path) -> Result<(), StorageError> {
    fs::create_dir_all(extractDir).map_err(StorageError::io)?;
    let mut archive = zip::ZipArchive::new(Cursor::new(zipBytes)).map_err(StorageError::io)?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(StorageError::io)?;
        let Some(relPath) = entry.enclosed_name().map(|p| p.to_path_buf()) else {
            return Err(StorageError::io(
                "Refusing unsafe path inside update archive.",
            ));
        };
        let isPortableData = relPath.components().next().is_some_and(|first| {
            matches!(first, Component::Normal(name) if name.to_string_lossy().eq_ignore_ascii_case("portable-data"))
        });
        if isPortableData {
            continue;
        }
        let targetPath = extractDir.join(&relPath);
        if entry.is_dir() {
            fs::create_dir_all(&targetPath).map_err(StorageError::io)?;
        } else {
            if let Some(parent) = targetPath.parent() {
                fs::create_dir_all(parent).map_err(StorageError::io)?;
            }
            let mut outFile = fs::File::create(&targetPath).map_err(StorageError::io)?;
            std::io::copy(&mut entry, &mut outFile).map_err(StorageError::io)?;
            outFile.sync_all().map_err(StorageError::io)?;
        }
    }
    Ok(())
}

async fn fetchPortableManifest() -> Result<PortableManifest, StorageError> {
    let client = reqwest::Client::builder()
        .user_agent("Markdown-BBCode-Updater")
        .build()
        .map_err(StorageError::io)?;
    let response = client
        .get(PORTABLE_MANIFEST_URL)
        .send()
        .await
        .map_err(StorageError::io)?
        .error_for_status()
        .map_err(StorageError::io)?;
    response
        .json::<PortableManifest>()
        .await
        .map_err(StorageError::io)
}

#[tauri::command]
fn app_runtime_info(state: tauri::State<AppState>) -> RuntimeInfo {
    RuntimeInfo {
        version: env!("CARGO_PKG_VERSION").to_owned(),
        isPortable: state.isPortable,
        executablePath: normalizeDisplayPath(&state.executablePath),
    }
}

#[tauri::command]
async fn check_for_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<UpdateInfo, StorageError> {
    let current = env!("CARGO_PKG_VERSION").to_owned();
    if state.isPortable {
        let manifest = fetchPortableManifest().await?;
        let available = isNewerVersion(&current, &manifest.version)?;
        return Ok(UpdateInfo {
            available,
            currentVersion: current,
            latestVersion: manifest.version.trim_start_matches('v').to_owned(),
            notes: manifest.notes,
            isPortable: true,
        });
    }
    let updater = app.updater().map_err(StorageError::io)?;
    match updater.check().await.map_err(StorageError::io)? {
        Some(update) => Ok(UpdateInfo {
            available: true,
            currentVersion: current,
            latestVersion: update.version,
            notes: update.body.unwrap_or_default(),
            isPortable: false,
        }),
        None => Ok(UpdateInfo {
            available: false,
            currentVersion: current.clone(),
            latestVersion: current,
            notes: String::new(),
            isPortable: false,
        }),
    }
}

#[tauri::command]
async fn install_update(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), StorageError> {
    if !state.isPortable {
        let updater = app.updater().map_err(StorageError::io)?;
        let Some(update) = updater.check().await.map_err(StorageError::io)? else {
            return Err(StorageError::io("Already up to date."));
        };
        update
            .download_and_install(|_, _| {}, || {})
            .await
            .map_err(StorageError::io)?;
        let _ = app.save_window_state(windowStateFlags());
        app.restart();
    }

    let manifest = fetchPortableManifest().await?;
    if !isNewerVersion(env!("CARGO_PKG_VERSION"), &manifest.version)? {
        return Err(StorageError::io("Already up to date."));
    }
    let validatedUrl = validateExternalUrl(&manifest.url)?.to_owned();
    if !validatedUrl
        .to_ascii_lowercase()
        .starts_with("https://github.com/fuzen777/markdown-bbcode/releases/")
    {
        return Err(StorageError::io(
            "Portable update URL must point to official GitHub Releases.",
        ));
    }
    let client = reqwest::Client::builder()
        .user_agent("Markdown-BBCode-Updater")
        .build()
        .map_err(StorageError::io)?;
    let payload = client
        .get(&validatedUrl)
        .send()
        .await
        .map_err(StorageError::io)?
        .error_for_status()
        .map_err(StorageError::io)?
        .bytes()
        .await
        .map_err(StorageError::io)?;
    verifyPortablePayload(
        &payload,
        &manifest.sha256,
        &manifest.signature,
        UPDATER_PUBKEY,
    )?;

    let installDir = state
        .executablePath
        .parent()
        .ok_or_else(|| StorageError::io("Cannot locate install folder."))?
        .to_path_buf();
    let workDir =
        std::env::temp_dir().join(format!("markdown-bbcode-update-{}", std::process::id()));
    let _ = fs::remove_dir_all(&workDir);
    let stagingDir = workDir.join("staging");
    extractZipSafely(&payload, &stagingDir)?;

    #[cfg(target_os = "windows")]
    {
        let scriptPath = workDir.join("apply-update.ps1");
        let psSingle = |p: &Path| normalizeDisplayPath(p).replace('\'', "''");
        let scriptContent = format!(
            "$pidToWait = {pid}\r\n\
            while (Get-Process -Id $pidToWait -ErrorAction SilentlyContinue) {{ Start-Sleep -Milliseconds 200 }}\r\n\
            Start-Sleep -Milliseconds 300\r\n\
            $src = '{src}'\r\n\
            $dst = '{dst}'\r\n\
            Get-ChildItem -LiteralPath $src -Force | ForEach-Object {{\r\n\
              if ($_.Name -ieq 'portable-data') {{ return }}\r\n\
              Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $dst $_.Name) -Recurse -Force\r\n\
            }}\r\n\
            $exe = Join-Path $dst 'Markdown BBCode.exe'\r\n\
            if (Test-Path -LiteralPath $exe) {{ Start-Process -FilePath $exe }}\r\n\
            Remove-Item -LiteralPath '{work}' -Recurse -Force -ErrorAction SilentlyContinue\r\n",
            pid = std::process::id(),
            src = psSingle(&stagingDir),
            dst = psSingle(&installDir),
            work = psSingle(&workDir),
        );
        fs::write(&scriptPath, scriptContent).map_err(StorageError::io)?;
        std::process::Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-WindowStyle",
                "Hidden",
                "-ExecutionPolicy",
                "Bypass",
                "-File",
            ])
            .arg(&scriptPath)
            .spawn()
            .map_err(StorageError::io)?;
        let _ = app.save_window_state(windowStateFlags());
        app.exit(0);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (&installDir, &app);
    }
    Ok(())
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

fn hasGracefulCloseFlag<I, S>(arguments: I) -> bool
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    arguments
        .into_iter()
        .any(|arg| arg.as_ref() == "--graceful-close")
}

fn main() {
    let executablePath = std::env::current_exe().expect("Cannot locate Markdown BBCode");
    let executableDir = executablePath
        .parent()
        .expect("Executable has no directory")
        .to_path_buf();
    let isPortable = detectPortableMode(&executableDir);
    let workingDirectory = std::env::current_dir().unwrap_or_default();
    let gracefulCloseRequested = hasGracefulCloseFlag(std::env::args().skip(1));
    let pendingPaths = argumentPaths(std::env::args().skip(1), &workingDirectory);
    tauri::Builder::default()
        .manage(PendingState {
            pendingPaths: Mutex::new(pendingPaths),
        })
        .plugin(tauri_plugin_single_instance::init(
            |app, arguments, workingDirectory| {
                if hasGracefulCloseFlag(arguments.iter().skip(1)) {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.emit("request-close", ());
                    }
                    return;
                }
                let state = app.state::<PendingState>();
                if let Ok(mut pendingPaths) = state.pendingPaths.lock() {
                    pendingPaths.extend(argumentPaths(
                        arguments.into_iter().skip(1),
                        Path::new(&workingDirectory),
                    ));
                }
                let _ = app.emit("open-files", ());
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            },
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(move |app| {
            if gracefulCloseRequested {
                app.handle().exit(0);
                return Ok(());
            }
            let dataDirectory = if isPortable {
                executableDir.join("portable-data")
            } else {
                app.path().app_data_dir()?
            };
            fs::create_dir_all(&dataDirectory)
                .expect("Application data folder must be writable. Move the app to a writable folder.");
            app.manage(AppState {
                dataDirectory: dataDirectory.clone(),
                writeLock: Mutex::new(()),
                isPortable,
                executablePath: executablePath.clone(),
            });
            let windowStatePath = dataDirectory.join("window-state.json");
            app.handle().plugin(
                tauri_plugin_window_state::Builder::default()
                    .with_filename(windowStatePath.to_string_lossy().into_owned())
                    .with_state_flags(windowStateFlags())
                    .skip_initial_state("main")
                    .build(),
            )?;
            let window = tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Markdown BBCode")
            .inner_size(1120.0, 800.0)
            .min_inner_size(720.0, 480.0)
            .visible(false)
            .data_directory(dataDirectory.join("webview"))
            .build()?;
            let _ = window.restore_state(windowStateFlags());
            rescueWindowIfOffScreen(&window);
            let _ = window.show();
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("request-close", ());
            } else if let tauri::WindowEvent::DragDrop(dragEvent) = event {
                match dragEvent {
                    tauri::DragDropEvent::Enter { .. } => {
                        let _ = window.emit("file-drag", true);
                    }
                    tauri::DragDropEvent::Leave => {
                        let _ = window.emit("file-drag", false);
                    }
                    tauri::DragDropEvent::Drop { paths, .. } => {
                        let _ = window.emit("file-drag", false);
                        let state = window.state::<PendingState>();
                        if let Ok(mut pendingPaths) = state.pendingPaths.lock() {
                            pendingPaths.extend(
                                paths.iter().map(|path| path.to_string_lossy().into_owned()),
                            );
                        }
                        let _ = window.emit("open-files", ());
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            save_file,
            load_session,
            save_session,
            take_pending_paths,
            finish_close,
            open_external_url,
            path_info,
            list_directory,
            search_directory,
            create_file,
            rename_path,
            reveal_in_explorer,
            app_runtime_info,
            check_for_update,
            install_update
        ])
        .run(tauri::generate_context!())
        .expect("Could not start Markdown BBCode. Ensure Microsoft Edge WebView2 is installed and the application folder is writable.");
}

// ==> Section 4 - Persistence Regression Tests <==
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_external_urls() {
        assert_eq!(
            validateExternalUrl("https://www.nexusmods.com/mods/1").unwrap(),
            "https://www.nexusmods.com/mods/1"
        );
        assert_eq!(
            validateExternalUrl("mailto:author@example.com").unwrap(),
            "mailto:author@example.com"
        );
        assert!(validateExternalUrl("file:///C:/Windows/System32/calc.exe").is_err());
        assert!(validateExternalUrl("javascript:alert(1)").is_err());
        assert!(validateExternalUrl("https://example.com/bad url").is_err());
        assert!(validateExternalUrl("https://example.com/\"quote\"").is_err());
    }

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

    #[test]
    fn lists_directories_filters_extensions_and_toggles_show_all() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("mod-with-doc")).unwrap();
        fs::write(root.path().join("mod-with-doc").join("readme.md"), "# Mod").unwrap();
        fs::create_dir(root.path().join("textures")).unwrap();
        fs::write(root.path().join("textures").join("diffuse.dds"), "dds").unwrap();
        fs::create_dir(root.path().join("empty-dir")).unwrap();
        fs::create_dir(root.path().join(".git")).unwrap();
        fs::write(root.path().join(".git").join("HEAD"), "ref").unwrap();
        fs::write(root.path().join("notes.txt"), "notes").unwrap();
        fs::write(root.path().join("nexus.bbcode"), "[b]Hi[/b]").unwrap();
        fs::write(root.path().join("page.mdbbcode"), "page").unwrap();
        fs::write(root.path().join("mesh.nif"), "nif").unwrap();

        let filtered = listDirectoryImpl(root.path(), false).unwrap();
        let filteredNames: Vec<&str> = filtered
            .entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect();
        assert_eq!(
            filteredNames,
            vec!["mod-with-doc", "nexus.bbcode", "notes.txt", "page.mdbbcode"]
        );
        assert_eq!(filtered.entries[1].kind.as_deref(), Some("bbcode"));
        assert_eq!(filtered.entries[2].kind.as_deref(), Some("txt"));
        assert_eq!(filtered.entries[3].kind.as_deref(), Some("markdown"));

        let all = listDirectoryImpl(root.path(), true).unwrap();
        let allNames: Vec<&str> = all
            .entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect();
        assert!(allNames.contains(&"textures"));
        assert!(allNames.contains(&"empty-dir"));
        assert!(allNames.contains(&".git"));
        assert!(!allNames.contains(&"mesh.nif"));
    }

    #[test]
    fn searches_directories_recursively_skipping_git() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("mods").join("skyrim")).unwrap();
        fs::create_dir_all(root.path().join(".git")).unwrap();
        fs::write(
            root.path()
                .join("mods")
                .join("skyrim")
                .join("load-order.md"),
            "# Order",
        )
        .unwrap();
        fs::write(root.path().join("mods").join("changelog.txt"), "changes").unwrap();
        fs::write(root.path().join(".git").join("ignored.md"), "hidden").unwrap();

        let hits = searchDirectoryImpl(root.path(), "load", 50).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "load-order.md");

        let ignored = searchDirectoryImpl(root.path(), "ignored", 50).unwrap();
        assert!(ignored.is_empty());
    }

    #[test]
    fn creates_files_without_overwriting_and_renames_safely() {
        let root = tempfile::tempdir().unwrap();
        let first = root.path().join("alpha.md");
        let snapshot = createFileImpl(&first, "# Alpha").unwrap();
        assert_eq!(snapshot.content, "# Alpha");
        assert_eq!(createFileImpl(&first, "dup").unwrap_err().kind, "exists");

        let second = root.path().join("beta.md");
        let renamed = renamePathImpl(&first, &second).unwrap();
        assert!(renamed.ends_with("beta.md"));
        assert!(!first.exists());
        assert_eq!(fs::read_to_string(&second).unwrap(), "# Alpha");

        let third = root.path().join("gamma.md");
        createFileImpl(&third, "# Gamma").unwrap();
        assert_eq!(renamePathImpl(&second, &third).unwrap_err().kind, "exists");
    }

    #[test]
    fn compares_semver_and_detects_portable_mode() {
        assert!(isNewerVersion("0.2.8", "0.2.9").unwrap());
        assert!(isNewerVersion("0.2.9", "v0.3.0").unwrap());
        assert!(!isNewerVersion("0.2.9", "0.2.9").unwrap());
        assert!(!isNewerVersion("0.3.0", "0.2.9").unwrap());

        let dir = tempfile::tempdir().unwrap();
        assert!(detectPortableMode(dir.path()));
    }

    #[test]
    fn verifies_signed_portable_payloads_and_extracts_zip_safely() {
        const TEST_PUB: &str = "RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3";
        const TEST_SIG: &str = "untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1633700835\tfile:test\tprehashed\nwLMDjy9FLAuxZ3q4NlEvkgtyhrr0gtTu6KC4KBJdITbbOeAi1zBIYo0v4iTgt8jJpIidRJnp94ABQkJAgAooBQ==";
        let encodedPub = base64::engine::general_purpose::STANDARD.encode(format!(
            "untrusted comment: minisign public key\n{TEST_PUB}\n"
        ));
        let encodedSig = base64::engine::general_purpose::STANDARD.encode(TEST_SIG);
        let payload = b"test";
        let hash = revision(payload);

        assert!(verifyPortablePayload(payload, &hash, &encodedSig, &encodedPub).is_ok());
        assert!(verifyPortablePayload(b"tampered", &hash, &encodedSig, &encodedPub).is_err());
        assert!(verifyPortablePayload(payload, &"0".repeat(64), &encodedSig, &encodedPub).is_err());

        let mut zipBuf = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(Cursor::new(&mut zipBuf));
            let opts = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            writer.start_file("Markdown BBCode.exe", opts).unwrap();
            writer.write_all(b"exe-bytes").unwrap();
            writer
                .start_file("portable-data/session.json", opts)
                .unwrap();
            writer.write_all(b"should-not-overwrite").unwrap();
            writer.finish().unwrap();
        }
        let extractDir = tempfile::tempdir().unwrap();
        extractZipSafely(&zipBuf, extractDir.path()).unwrap();
        assert_eq!(
            fs::read(extractDir.path().join("Markdown BBCode.exe")).unwrap(),
            b"exe-bytes"
        );
        assert!(!extractDir.path().join("portable-data").exists());

        let mut evilZip = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(Cursor::new(&mut evilZip));
            let opts = zip::write::SimpleFileOptions::default();
            writer.start_file("../evil.txt", opts).unwrap();
            writer.write_all(b"bad").unwrap();
            writer.finish().unwrap();
        }
        assert!(extractZipSafely(&evilZip, extractDir.path()).is_err());
    }

    #[test]
    fn resolves_offscreen_and_taskbar_window_rescue() {
        let primary = WindowRect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
        };
        let leftMonitor = WindowRect {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1040,
        };

        assert_eq!(
            resolveRescuedWindowRect(
                WindowRect {
                    x: 100,
                    y: 80,
                    width: 1120,
                    height: 800,
                },
                &[primary],
                Some(primary),
            ),
            None
        );

        assert_eq!(
            resolveRescuedWindowRect(
                WindowRect {
                    x: -1700,
                    y: 60,
                    width: 1120,
                    height: 800,
                },
                &[primary, leftMonitor],
                Some(primary),
            ),
            None
        );

        // Aero-snapped half with invisible DWM shadow overhang remains untouched.
        assert_eq!(
            resolveRescuedWindowRect(
                WindowRect {
                    x: -7,
                    y: 0,
                    width: 974,
                    height: 1047,
                },
                &[primary],
                Some(primary),
            ),
            None
        );

        // Disconnected secondary monitor falls back centered onto the primary monitor.
        assert_eq!(
            resolveRescuedWindowRect(
                WindowRect {
                    x: 2500,
                    y: 120,
                    width: 1120,
                    height: 800,
                },
                &[primary],
                Some(primary),
            ),
            Some(WindowRect {
                x: 400,
                y: 120,
                width: 1120,
                height: 800,
            })
        );

        // Title bar dragged off top edge clamps back inside work area.
        assert_eq!(
            resolveRescuedWindowRect(
                WindowRect {
                    x: 200,
                    y: -35,
                    width: 1120,
                    height: 800,
                },
                &[primary],
                Some(primary),
            ),
            Some(WindowRect {
                x: 200,
                y: 0,
                width: 1120,
                height: 800,
            })
        );

        // Title bar pushed behind bottom taskbar clamps upward cleanly.
        assert_eq!(
            resolveRescuedWindowRect(
                WindowRect {
                    x: 200,
                    y: 1025,
                    width: 1120,
                    height: 800,
                },
                &[primary],
                Some(primary),
            ),
            Some(WindowRect {
                x: 200,
                y: 240,
                width: 1120,
                height: 800,
            })
        );

        // Barely protruding left sliver rescues inside right monitor boundary.
        assert_eq!(
            resolveRescuedWindowRect(
                WindowRect {
                    x: 1880,
                    y: 100,
                    width: 1120,
                    height: 800,
                },
                &[primary],
                Some(primary),
            ),
            Some(WindowRect {
                x: 800,
                y: 100,
                width: 1120,
                height: 800,
            })
        );

        // Oversized window on smaller display shrinks to fit cleanly inside work area.
        let laptop = WindowRect {
            x: 0,
            y: 0,
            width: 1366,
            height: 728,
        };
        assert_eq!(
            resolveRescuedWindowRect(
                WindowRect {
                    x: 50,
                    y: 50,
                    width: 1920,
                    height: 1080,
                },
                &[laptop],
                Some(laptop),
            ),
            Some(laptop)
        );

        assert_eq!(
            resolveRescuedWindowRect(
                WindowRect {
                    x: 2500,
                    y: 120,
                    width: 1120,
                    height: 800,
                },
                &[],
                None,
            ),
            None
        );
    }

    #[test]
    fn detects_graceful_close_flag_and_ignores_it_as_path() {
        assert!(hasGracefulCloseFlag(["--graceful-close"]));
        assert!(hasGracefulCloseFlag(["notes.md", "--graceful-close"]));
        assert!(!hasGracefulCloseFlag(["notes.md", "--other-flag"]));

        let args = vec![
            "--graceful-close".to_owned(),
            "doc.md".to_owned(),
            "-x".to_owned(),
        ];
        let paths = argumentPaths(args.into_iter(), Path::new(r"C:\Workspace"));
        assert_eq!(paths, vec![r"C:\Workspace\doc.md".to_owned()]);
    }
}
