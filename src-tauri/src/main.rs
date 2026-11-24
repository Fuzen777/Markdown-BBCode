#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(non_snake_case)]

// ==> Section 1 - Storage Types <==
use base64::Engine as _;
use minisign_verify::{PublicKey, Signature};
use semver::Version;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashSet, VecDeque},
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
    kind: Option<String>,
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

fn resolveWriteTarget(path: &Path) -> PathBuf {
    if let Ok(meta) = fs::symlink_metadata(path) {
        if meta.file_type().is_symlink() {
            if let Ok(resolved) = path.canonicalize() {
                return resolved;
            }
        }
    }
    path.to_path_buf()
}

#[cfg(target_os = "windows")]
fn fileLinkCount(path: &Path) -> Option<u32> {
    use std::os::windows::io::AsRawHandle;

    #[repr(C)]
    #[derive(Default)]
    struct FileTime {
        dwLowDateTime: u32,
        dwHighDateTime: u32,
    }

    #[repr(C)]
    #[derive(Default)]
    struct ByHandleFileInformation {
        dwFileAttributes: u32,
        ftCreationTime: FileTime,
        ftLastAccessTime: FileTime,
        ftLastWriteTime: FileTime,
        dwVolumeSerialNumber: u32,
        nFileSizeHigh: u32,
        nFileSizeLow: u32,
        nNumberOfLinks: u32,
        nFileIndexHigh: u32,
        nFileIndexLow: u32,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetFileInformationByHandle(
            hFile: *mut std::ffi::c_void,
            lpFileInformation: *mut ByHandleFileInformation,
        ) -> i32;
    }

    let file = fs::File::open(path).ok()?;
    let mut info = ByHandleFileInformation::default();
    let ok = unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) };
    (ok != 0).then_some(info.nNumberOfLinks)
}

#[cfg(not(target_os = "windows"))]
fn fileLinkCount(_path: &Path) -> Option<u32> {
    None
}

fn atomicWrite(path: &Path, bytes: &[u8]) -> Result<(), StorageError> {
    let writeTarget = resolveWriteTarget(path);
    if fileLinkCount(&writeTarget).unwrap_or(1) > 1 {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(&writeTarget)
            .map_err(StorageError::io)?;
        file.write_all(bytes).map_err(StorageError::io)?;
        file.sync_all().map_err(StorageError::io)?;
        return Ok(());
    }
    let parentDirectory = writeTarget
        .parent()
        .ok_or_else(|| StorageError::io("Invalid file path"))?;
    let mut temporaryFile =
        tempfile::NamedTempFile::new_in(parentDirectory).map_err(StorageError::io)?;
    temporaryFile.write_all(bytes).map_err(StorageError::io)?;
    temporaryFile
        .as_file()
        .sync_all()
        .map_err(StorageError::io)?;
    temporaryFile
        .persist(&writeTarget)
        .map_err(StorageError::io)?;
    Ok(())
}

fn readSnapshot(path: &Path) -> Result<FileSnapshot, StorageError> {
    let meta = fs::metadata(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            StorageError::missing("The file no longer exists.")
        } else {
            StorageError::io(error)
        }
    })?;
    if meta.is_dir() {
        return Err(StorageError::io("Selected path is a folder."));
    }
    let logicalPath = normalizeLogicalPath(path)?;
    let bytes = fs::read(&logicalPath).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            StorageError::missing("The file no longer exists.")
        } else {
            StorageError::io(error)
        }
    })?;
    let content = String::from_utf8(bytes.clone()).map_err(|_| {
        StorageError::io("This file is not UTF-8 text. Convert a copy to UTF-8 before opening it.")
    })?;
    Ok(FileSnapshot {
        path: normalizeDisplayPath(&logicalPath),
        content,
        revision: revision(&bytes),
    })
}

fn writeSnapshot(
    path: &Path,
    content: &str,
    expectedRevision: Option<&str>,
) -> Result<FileSnapshot, StorageError> {
    let writeTarget = resolveWriteTarget(path);
    match fs::read(&writeTarget) {
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
    atomicWrite(&writeTarget, content.as_bytes())?;
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
        "node_modules" | "target" | "__pycache__" | "portable-data"
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

fn normalizeLogicalPath(path: &Path) -> Result<PathBuf, StorageError> {
    let cleanDisplay = normalizeDisplayPath(path);
    let cleanPath = Path::new(&cleanDisplay);
    let absolute = if cleanPath.is_absolute() {
        cleanPath.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(StorageError::io)?
            .join(cleanPath)
    };
    let mut normalized = PathBuf::new();
    for component in absolute.components() {
        match component {
            Component::Prefix(_) | Component::RootDir => normalized.push(component.as_os_str()),
            Component::CurDir => {}
            Component::ParentDir => {
                if matches!(
                    normalized.components().next_back(),
                    Some(Component::Normal(_))
                ) {
                    normalized.pop();
                }
            }
            Component::Normal(part) => normalized.push(part),
        }
    }
    Ok(normalized)
}

enum EntryTarget {
    File { isLink: bool },
    Dir,
    Skip,
}

fn classifyEntry(entryPath: &Path, fileType: fs::FileType) -> EntryTarget {
    if fileType.is_file() {
        EntryTarget::File { isLink: false }
    } else if fileType.is_dir() {
        EntryTarget::Dir
    } else if let Ok(meta) = fs::metadata(entryPath) {
        if meta.is_dir() {
            EntryTarget::Dir
        } else if meta.is_file() {
            EntryTarget::File { isLink: true }
        } else {
            EntryTarget::Skip
        }
    } else {
        EntryTarget::Skip
    }
}

fn readableFileKind(entryPath: &Path, isLink: bool) -> Option<&'static str> {
    if let Some(kind) = fileKind(entryPath) {
        return Some(kind);
    }
    if isLink {
        if let Ok(target) = entryPath.canonicalize() {
            return fileKind(&target);
        }
    }
    None
}

fn dirContainsReadable(
    dir: &Path,
    depth: usize,
    budget: &mut usize,
    visited: &mut HashSet<PathBuf>,
) -> bool {
    if *budget == 0 {
        return true;
    }
    if depth == 0 {
        return false;
    }
    if let Ok(canonical) = dir.canonicalize() {
        if !visited.insert(canonical) {
            return false;
        }
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
        match classifyEntry(&entryPath, fileType) {
            EntryTarget::Dir => {
                let name = entry.file_name().to_string_lossy().into_owned();
                if !ignoredDirName(&name) {
                    subdirs.push(entryPath);
                }
            }
            EntryTarget::File { isLink } => {
                if readableFileKind(&entryPath, isLink).is_some() {
                    return true;
                }
            }
            EntryTarget::Skip => {}
        }
    }
    for subdir in subdirs {
        if dirContainsReadable(&subdir, depth - 1, budget, visited) {
            return true;
        }
    }
    false
}

fn pathInfoImpl(path: &Path) -> Result<PathKind, StorageError> {
    match fs::metadata(path) {
        Ok(meta) => {
            let logical = normalizeLogicalPath(path).unwrap_or_else(|_| path.to_path_buf());
            let isLink = fs::symlink_metadata(&logical)
                .map(|symMeta| symMeta.file_type().is_symlink())
                .unwrap_or(false);
            let kind = if meta.is_dir() {
                None
            } else {
                readableFileKind(&logical, isLink).map(str::to_owned)
            };
            Ok(PathKind {
                path: normalizeDisplayPath(&logical),
                exists: true,
                isDir: meta.is_dir(),
                kind,
            })
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(PathKind {
            path: normalizeDisplayPath(path),
            exists: false,
            isDir: false,
            kind: None,
        }),
        Err(error) => Err(StorageError::io(error)),
    }
}

fn listDirectoryImpl(path: &Path, showAll: bool) -> Result<DirectoryListing, StorageError> {
    let meta = fs::metadata(path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            StorageError::missing("Folder no longer exists.")
        } else {
            StorageError::io(error)
        }
    })?;
    if !meta.is_dir() {
        return Err(StorageError::io("Selected path is not a folder."));
    }
    let logicalDir = normalizeLogicalPath(path)?;
    let rootCanonical = logicalDir.canonicalize().ok();
    let readDir = fs::read_dir(&logicalDir).map_err(StorageError::io)?;
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
        match classifyEntry(&entryPath, fileType) {
            EntryTarget::Dir => {
                let ignored = ignoredDirName(&name);
                if ignored && !showAll {
                    continue;
                }
                let hasReadable = if ignored {
                    false
                } else {
                    let mut budget = 2000usize;
                    let mut visited = HashSet::new();
                    if let Some(ref canonicalRoot) = rootCanonical {
                        visited.insert(canonicalRoot.clone());
                    }
                    dirContainsReadable(&entryPath, 4, &mut budget, &mut visited)
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
            }
            EntryTarget::File { isLink } => {
                let Some(kind) = readableFileKind(&entryPath, isLink) else {
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
            EntryTarget::Skip => {}
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
        root: normalizeDisplayPath(&logicalDir),
        parent: logicalDir.parent().map(normalizeDisplayPath),
        entries,
        truncated,
    })
}

fn searchDirectoryImpl(
    root: &Path,
    query: &str,
    maxResults: usize,
) -> Result<Vec<DirectoryEntry>, StorageError> {
    let meta = fs::metadata(root).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            StorageError::missing("Folder no longer exists.")
        } else {
            StorageError::io(error)
        }
    })?;
    if !meta.is_dir() {
        return Err(StorageError::io("Selected path is not a folder."));
    }
    let logicalRoot = normalizeLogicalPath(root)?;
    let trimmedQuery = query.trim().to_ascii_lowercase();
    if trimmedQuery.is_empty() {
        return Ok(Vec::new());
    }
    let limit = maxResults.min(500);
    let mut results = Vec::new();
    let mut budget = 6000usize;
    let mut visited = HashSet::new();
    if let Ok(canonicalRoot) = logicalRoot.canonicalize() {
        visited.insert(canonicalRoot);
    }
    let mut queue = VecDeque::from([(logicalRoot.clone(), 0usize)]);

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
            match classifyEntry(&entryPath, fileType) {
                EntryTarget::Dir => {
                    if depth < 6 && !ignoredDirName(&name) {
                        let isUnvisited = entryPath
                            .canonicalize()
                            .map(|canonical| visited.insert(canonical))
                            .unwrap_or(true);
                        if isUnvisited {
                            queue.push_back((entryPath, depth + 1));
                        }
                    }
                }
                EntryTarget::File { isLink } => {
                    let Some(kind) = readableFileKind(&entryPath, isLink) else {
                        continue;
                    };
                    let relative = entryPath
                        .strip_prefix(&logicalRoot)
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
                EntryTarget::Skip => {}
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
    if fs::symlink_metadata(oldPath).is_err() {
        return Err(StorageError::missing(
            "The item to rename no longer exists.",
        ));
    }
    let newName = newPath
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| StorageError::io("Invalid target name."))?;
    validateFileNamePart(newName)?;
    let normalizedOld = normalizeLogicalPath(oldPath)?;
    let normalizedNew = normalizeLogicalPath(newPath)?;
    if fs::symlink_metadata(&normalizedNew).is_ok() {
        #[cfg(target_os = "windows")]
        let sameLogical = normalizeDisplayPath(&normalizedOld)
            .eq_ignore_ascii_case(&normalizeDisplayPath(&normalizedNew));
        #[cfg(not(target_os = "windows"))]
        let sameLogical = normalizedOld == normalizedNew;
        if !sameLogical {
            return Err(StorageError::exists(
                "An item with that name already exists.",
            ));
        }
    }
    fs::rename(&normalizedOld, &normalizedNew).map_err(StorageError::io)?;
    Ok(normalizeDisplayPath(&normalizedNew))
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
    let meta = fs::metadata(candidate).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            StorageError::missing("Item no longer exists.")
        } else {
            StorageError::io(error)
        }
    })?;
    let logical = normalizeLogicalPath(candidate)?;
    let clean = normalizeDisplayPath(&logical);
    #[cfg(target_os = "windows")]
    {
        if meta.is_dir() {
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
    let _ = (&clean, meta.is_dir());
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

struct ContextMenuEntry {
    name: String,
    isSeparator: bool,
}

fn shouldKeepContextMenuEntry(name: &str, isEditable: bool, hasSelection: bool) -> bool {
    if isEditable {
        matches!(
            name.to_ascii_lowercase().as_str(),
            "cut"
                | "copy"
                | "paste"
                | "pasteandmatchstyle"
                | "pasteasplaintext"
                | "selectall"
                | "undo"
                | "redo"
                | "spellcheck"
                | "spelling"
                | "checkspelling"
                | "addtodictionary"
                | "ignoreall"
                | "nospellingsuggestions"
        )
    } else if hasSelection {
        name.eq_ignore_ascii_case("copy")
    } else {
        false
    }
}

fn planContextMenuRemovals(
    entries: &[ContextMenuEntry],
    isEditable: bool,
    hasSelection: bool,
) -> (Vec<usize>, bool) {
    if !isEditable && !hasSelection {
        return ((0..entries.len()).collect(), true);
    }

    let mut keep = vec![false; entries.len()];
    let mut lastKeptSeparator: Option<usize> = None;
    let mut hasActionItem = false;

    for (index, entry) in entries.iter().enumerate() {
        if entry.isSeparator {
            if hasActionItem && lastKeptSeparator.is_none() {
                keep[index] = true;
                lastKeptSeparator = Some(index);
            }
        } else if shouldKeepContextMenuEntry(&entry.name, isEditable, hasSelection) {
            keep[index] = true;
            lastKeptSeparator = None;
            hasActionItem = true;
        }
    }

    if let Some(trailingSeparator) = lastKeptSeparator {
        keep[trailingSeparator] = false;
    }

    if !hasActionItem {
        return ((0..entries.len()).collect(), true);
    }

    let removals = keep
        .into_iter()
        .enumerate()
        .filter_map(|(index, kept)| (!kept).then_some(index))
        .collect();
    (removals, false)
}

#[cfg(target_os = "windows")]
fn configureContextMenuFilter(window: &tauri::WebviewWindow) {
    use webview2_com::{
        take_pwstr, ContextMenuRequestedEventHandler,
        Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_11, COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND,
            COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR,
        },
    };
    use windows_core::{Interface, BOOL, PWSTR};

    let _ = window.with_webview(|webview| unsafe {
        let Ok(coreWebView) = webview.controller().CoreWebView2() else {
            return;
        };
        let Ok(coreWebView11) = coreWebView.cast::<ICoreWebView2_11>() else {
            return;
        };
        let handler = ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            let Ok(target) = args.ContextMenuTarget() else {
                return Ok(());
            };
            let mut isEditable = BOOL::default();
            let mut hasSelection = BOOL::default();
            let _ = target.IsEditable(&mut isEditable);
            let _ = target.HasSelection(&mut hasSelection);
            let editable = isEditable.as_bool();
            let selected = hasSelection.as_bool();
            if !editable && !selected {
                let _ = args.SetHandled(true);
                return Ok(());
            }

            let Ok(items) = args.MenuItems() else {
                return Ok(());
            };
            let mut count = 0u32;
            if items.Count(&mut count).is_err() {
                return Ok(());
            }
            let mut entries = Vec::with_capacity(count as usize);
            for index in 0..count {
                let Ok(item) = items.GetValueAtIndex(index) else {
                    entries.push(ContextMenuEntry {
                        name: String::new(),
                        isSeparator: false,
                    });
                    continue;
                };
                let mut kind = COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND::default();
                let _ = item.Kind(&mut kind);
                let mut rawName = PWSTR::null();
                let name = if item.Name(&mut rawName).is_ok() {
                    take_pwstr(rawName)
                } else {
                    String::new()
                };
                entries.push(ContextMenuEntry {
                    name,
                    isSeparator: kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR,
                });
            }

            let (removals, suppressMenu) = planContextMenuRemovals(&entries, editable, selected);
            if suppressMenu {
                let _ = args.SetHandled(true);
                return Ok(());
            }
            for index in removals.into_iter().rev() {
                let _ = items.RemoveValueAtIndex(index as u32);
            }
            Ok(())
        }));
        let mut token = 0i64;
        let _ = coreWebView11.add_ContextMenuRequested(&handler, &mut token);
    });
}

#[cfg(not(target_os = "windows"))]
fn configureContextMenuFilter(_window: &tauri::WebviewWindow) {}

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
            configureContextMenuFilter(&window);
            let _ = window.restore_state(windowStateFlags());
            rescueWindowIfOffScreen(&window);
            let _ = window.show();
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.emit("request-close", ());
            } else if let tauri::WindowEvent::Focused(true) = event {
                let _ = window.emit("window-focused", ());
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

    #[test]
    fn handles_hard_links_and_preserves_link_on_save() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let original = outside.path().join("source.md");
        fs::write(&original, "Initial hard-linked text").unwrap();

        let subDir = root.path().join("linked-mod");
        fs::create_dir(&subDir).unwrap();
        let hardLink = subDir.join("readme.md");
        if fs::hard_link(&original, &hardLink).is_err() {
            return;
        }

        let rootListing = listDirectoryImpl(root.path(), false).unwrap();
        assert_eq!(rootListing.entries.len(), 1);
        assert_eq!(rootListing.entries[0].name, "linked-mod");
        assert!(rootListing.entries[0].isDir);
        assert!(rootListing.entries[0].hasReadable);

        let subListing = listDirectoryImpl(&subDir, false).unwrap();
        assert_eq!(subListing.entries.len(), 1);
        assert_eq!(subListing.entries[0].name, "readme.md");
        assert_eq!(subListing.entries[0].kind.as_deref(), Some("markdown"));

        let hits = searchDirectoryImpl(root.path(), "readme", 50).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "readme.md");

        let snap = readSnapshot(&hardLink).unwrap();
        assert_eq!(snap.content, "Initial hard-linked text");
        let saved =
            writeSnapshot(&hardLink, "Updated via hard link", Some(&snap.revision)).unwrap();
        assert_eq!(saved.content, "Updated via hard link");
        assert_eq!(
            fs::read_to_string(&original).unwrap(),
            "Updated via hard link"
        );
        #[cfg(target_os = "windows")]
        assert_eq!(fileLinkCount(&hardLink), Some(2));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn handles_directory_junctions_and_prevents_cycles() {
        let root = tempfile::tempdir().unwrap();
        let external = tempfile::tempdir().unwrap();
        fs::write(external.path().join("guide.md"), "# Junction Guide").unwrap();

        let junction = root.path().join("junction-mod");
        let status = std::process::Command::new("cmd")
            .args([
                "/C",
                "mklink",
                "/J",
                &junction.to_string_lossy(),
                &external.path().to_string_lossy(),
            ])
            .output()
            .unwrap();
        assert!(
            status.status.success(),
            "mklink /J failed: {}",
            String::from_utf8_lossy(&status.stderr)
        );

        let cycle = external.path().join("back-to-root");
        let cycleStatus = std::process::Command::new("cmd")
            .args([
                "/C",
                "mklink",
                "/J",
                &cycle.to_string_lossy(),
                &root.path().to_string_lossy(),
            ])
            .output()
            .unwrap();
        assert!(cycleStatus.status.success());

        let rootListing = listDirectoryImpl(root.path(), false).unwrap();
        assert!(rootListing
            .entries
            .iter()
            .any(|entry| entry.name == "junction-mod" && entry.isDir && entry.hasReadable));

        let subListing = listDirectoryImpl(&junction, false).unwrap();
        assert!(subListing.root.ends_with("junction-mod"));
        assert!(subListing
            .entries
            .iter()
            .any(|entry| entry.name == "guide.md" && entry.kind.as_deref() == Some("markdown")));

        let hits = searchDirectoryImpl(root.path(), "guide", 50).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "guide.md");
        assert!(hits[0].path.contains("junction-mod"));
    }

    #[test]
    fn handles_file_and_directory_symlinks_when_permitted() {
        let root = tempfile::tempdir().unwrap();
        let external = tempfile::tempdir().unwrap();
        let targetMd = external.path().join("target.md");
        let targetDds = external.path().join("diffuse.dds");
        let targetSubDir = external.path().join("nested-docs");
        fs::write(&targetMd, "# Linked Markdown").unwrap();
        fs::write(&targetDds, "dds").unwrap();
        fs::create_dir(&targetSubDir).unwrap();
        fs::write(targetSubDir.join("sub.txt"), "Hello").unwrap();

        let mdLink = root.path().join("notes.md");
        let otherMdLink = root.path().join("other.md");
        let aliasLink = root.path().join("README");
        let ddsAliasLink = root.path().join("texture-alias");
        let brokenLink = root.path().join("broken.md");
        let dirLink = root.path().join("docs-link");

        #[cfg(target_os = "windows")]
        let createFileSym = |link: &Path, target: &Path| -> std::io::Result<()> {
            std::os::windows::fs::symlink_file(target, link)
        };
        #[cfg(not(target_os = "windows"))]
        let createFileSym = |link: &Path, target: &Path| -> std::io::Result<()> {
            std::os::unix::fs::symlink(target, link)
        };
        #[cfg(target_os = "windows")]
        let createDirSym = |link: &Path, target: &Path| -> std::io::Result<()> {
            std::os::windows::fs::symlink_dir(target, link)
        };
        #[cfg(not(target_os = "windows"))]
        let createDirSym = |link: &Path, target: &Path| -> std::io::Result<()> {
            std::os::unix::fs::symlink(target, link)
        };

        if let Err(err) = createFileSym(&mdLink, &targetMd) {
            if err.kind() == std::io::ErrorKind::PermissionDenied {
                return;
            }
            panic!("Unexpected symlink creation error: {err}");
        }
        createFileSym(&otherMdLink, &targetMd).unwrap();
        createFileSym(&aliasLink, &targetMd).unwrap();
        createFileSym(&ddsAliasLink, &targetDds).unwrap();
        createFileSym(&brokenLink, &external.path().join("missing.md")).unwrap();
        createDirSym(&dirLink, &targetSubDir).unwrap();

        let listing = listDirectoryImpl(root.path(), false).unwrap();
        let names: Vec<&str> = listing
            .entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect();
        assert!(names.contains(&"docs-link"));
        assert!(names.contains(&"notes.md"));
        assert!(names.contains(&"README"));
        assert!(!names.contains(&"texture-alias"));
        assert!(!names.contains(&"broken.md"));

        let aliasInfo = pathInfoImpl(&aliasLink).unwrap();
        assert!(aliasInfo.exists);
        assert!(!aliasInfo.isDir);
        assert_eq!(aliasInfo.kind.as_deref(), Some("markdown"));

        let snap = readSnapshot(&aliasLink).unwrap();
        assert!(snap.path.ends_with("README"));
        assert_eq!(snap.content, "# Linked Markdown");

        let saved = writeSnapshot(&mdLink, "# Edited via Symlink", Some(&snap.revision)).unwrap();
        assert!(saved.path.ends_with("notes.md"));
        assert_eq!(
            fs::read_to_string(&targetMd).unwrap(),
            "# Edited via Symlink"
        );
        assert!(fs::symlink_metadata(&mdLink)
            .unwrap()
            .file_type()
            .is_symlink());

        assert_eq!(
            renamePathImpl(&mdLink, &otherMdLink).unwrap_err().kind,
            "exists"
        );
        let renamedLink = root.path().join("renamed-notes.md");
        let renamedPath = renamePathImpl(&mdLink, &renamedLink).unwrap();
        assert!(renamedPath.ends_with("renamed-notes.md"));
        assert!(fs::symlink_metadata(&renamedLink)
            .unwrap()
            .file_type()
            .is_symlink());
    }

    #[test]
    fn shows_dist_and_build_only_when_containing_readable_files() {
        let root = tempfile::tempdir().unwrap();
        let external = tempfile::tempdir().unwrap();
        let distDir = root.path().join("Dist");
        let buildDir = root.path().join("Build");
        let nodeModules = root.path().join("node_modules");
        let targetDir = root.path().join("target");
        fs::create_dir_all(&distDir).unwrap();
        fs::create_dir_all(&buildDir).unwrap();
        fs::create_dir_all(&nodeModules).unwrap();
        fs::create_dir_all(&targetDir).unwrap();

        fs::write(distDir.join("notes.mdbbcode"), "# Dist Notes").unwrap();
        fs::write(distDir.join("cover.png"), "png").unwrap();
        fs::write(buildDir.join("archive.zip"), "zip").unwrap();
        fs::write(buildDir.join("preview.png"), "png").unwrap();
        fs::write(nodeModules.join("readme.md"), "# Ignored").unwrap();
        fs::write(targetDir.join("notes.md"), "# Ignored").unwrap();

        let externalDesc = external.path().join("Nexus Description.mdbbcode");
        fs::write(&externalDesc, "# Linked Description").unwrap();
        let symlinkedDesc = distDir.join("Auto Doors - Nexus Description.mdbbcode");
        #[cfg(target_os = "windows")]
        let symResult = std::os::windows::fs::symlink_file(&externalDesc, &symlinkedDesc);
        #[cfg(not(target_os = "windows"))]
        let symResult = std::os::unix::fs::symlink(&externalDesc, &symlinkedDesc);
        let symlinkCreated = match symResult {
            Ok(()) => true,
            Err(err) if err.kind() == std::io::ErrorKind::PermissionDenied => false,
            Err(err) => panic!("Unexpected symlink creation error: {err}"),
        };

        let rootListing = listDirectoryImpl(root.path(), false).unwrap();
        let rootNames: Vec<&str> = rootListing
            .entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect();
        assert!(rootListing
            .entries
            .iter()
            .any(|entry| entry.name == "Dist" && entry.isDir && entry.hasReadable));
        assert!(!rootNames.contains(&"Build"));
        assert!(!rootNames.contains(&"node_modules"));
        assert!(!rootNames.contains(&"target"));

        let distListing = listDirectoryImpl(&distDir, false).unwrap();
        let distNames: Vec<&str> = distListing
            .entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect();
        assert!(distNames.contains(&"notes.mdbbcode"));
        assert!(!distNames.contains(&"cover.png"));
        if symlinkCreated {
            assert!(distNames.contains(&"Auto Doors - Nexus Description.mdbbcode"));
        }

        let hits = searchDirectoryImpl(root.path(), "notes", 50).unwrap();
        let hitPaths: Vec<&str> = hits.iter().map(|entry| entry.path.as_str()).collect();
        assert!(hits
            .iter()
            .any(|entry| entry.name == "notes.mdbbcode" && entry.path.contains("Dist")));
        assert!(!hitPaths.iter().any(|p| p.contains("target")));

        let allHits = searchDirectoryImpl(root.path(), "readme", 50).unwrap();
        assert!(allHits.is_empty());

        let allListing = listDirectoryImpl(root.path(), true).unwrap();
        let allNames: Vec<&str> = allListing
            .entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect();
        assert!(allNames.contains(&"Dist"));
        assert!(allNames.contains(&"Build"));
        assert!(allNames.contains(&"node_modules"));
        assert!(allNames.contains(&"target"));
    }

    fn menuItem(name: &str) -> ContextMenuEntry {
        ContextMenuEntry {
            name: name.into(),
            isSeparator: false,
        }
    }

    fn menuSeparator() -> ContextMenuEntry {
        ContextMenuEntry {
            name: "other".into(),
            isSeparator: true,
        }
    }

    #[test]
    fn context_menu_suppresses_non_editable_without_selection() {
        let entries = vec![
            menuItem("back"),
            menuItem("reload"),
            menuSeparator(),
            menuItem("saveAs"),
            menuItem("print"),
            menuItem("selectAll"),
            menuItem("inspectElement"),
        ];
        let (removals, suppress) = planContextMenuRemovals(&entries, false, false);
        assert!(suppress);
        assert_eq!(removals, vec![0, 1, 2, 3, 4, 5, 6]);
    }

    #[test]
    fn context_menu_keeps_only_copy_for_readonly_selection() {
        let entries = vec![
            menuItem("copy"),
            menuItem("copyLink"),
            menuSeparator(),
            menuItem("searchWebFor"),
            menuItem("print"),
            menuItem("share"),
            menuItem("webCapture"),
            menuItem("inspectElement"),
        ];
        let (removals, suppress) = planContextMenuRemovals(&entries, false, true);
        assert!(!suppress);
        assert_eq!(removals, vec![1, 2, 3, 4, 5, 6, 7]);
    }

    #[test]
    fn context_menu_keeps_edit_and_spellcheck_and_normalizes_separators() {
        let entries = vec![
            menuSeparator(),
            menuItem("emoji"),
            menuItem("spellCheck"),
            menuItem("spellcheck"),
            menuItem("addToDictionary"),
            menuSeparator(),
            menuItem("writingAssistance"),
            menuSeparator(),
            menuItem("undo"),
            menuItem("redo"),
            menuItem("cut"),
            menuItem("copy"),
            menuItem("paste"),
            menuItem("pasteAndMatchStyle"),
            menuItem("pasteAsPlainText"),
            menuItem("selectAll"),
            menuSeparator(),
            menuItem("rewrite"),
            menuItem("askCopilot"),
            menuItem("back"),
            menuItem("reload"),
            menuItem("saveAs"),
            menuItem("print"),
            menuItem("share"),
            menuItem("webCapture"),
            menuItem("readAloud"),
            menuItem("inspectElement"),
            menuItem("other"),
            menuItem("extension"),
            menuSeparator(),
        ];
        let (removals, suppress) = planContextMenuRemovals(&entries, true, false);
        assert!(!suppress);
        assert_eq!(
            removals,
            vec![0, 1, 6, 7, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29]
        );
    }

    #[test]
    fn context_menu_suppresses_when_all_items_are_clutter() {
        let entries = vec![
            menuSeparator(),
            menuItem("reload"),
            menuItem("print"),
            menuItem("inspectElement"),
            menuSeparator(),
        ];
        let (removals, suppress) = planContextMenuRemovals(&entries, true, true);
        assert!(suppress);
        assert_eq!(removals, vec![0, 1, 2, 3, 4]);
    }
}
