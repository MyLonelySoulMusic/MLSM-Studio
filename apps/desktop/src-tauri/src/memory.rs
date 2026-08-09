use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const DEFAULT_MAX_ENTRIES: usize = 20_000;
const HARD_MAX_ENTRIES: usize = 100_000;
const DEFAULT_MAX_DEPTH: usize = 24;
const HARD_MAX_DEPTH: usize = 64;
const DEFAULT_PREVIEW_BYTES: u64 = 32 * 1024 * 1024;
const HARD_MAX_PREVIEW_BYTES: u64 = 128 * 1024 * 1024;
const DEFAULT_TEXT_PREVIEW_BYTES: usize = 256 * 1024;
const HARD_MAX_TEXT_PREVIEW_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub(crate) enum MemoryIoError {
    #[error("Il percorso selezionato non è valido o non è assoluto: {0}")]
    InvalidPath(String),
    #[error("La destinazione deve essere una cartella esistente: {0}")]
    InvalidDestination(String),
    #[error("Il file supera il limite di anteprima di {limit_mb} MB: {path}")]
    PreviewTooLarge { path: String, limit_mb: u64 },
    #[error("Impossibile accedere al filesystem: {0}")]
    Io(#[from] std::io::Error),
}

impl Serialize for MemoryIoError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryScanOptions {
    include_hidden: Option<bool>,
    max_entries: Option<usize>,
    max_depth: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryEntryMetadata {
    path: String,
    parent_path: Option<String>,
    name: String,
    extension: Option<String>,
    entry_type: String,
    media_kind: String,
    mime_type: String,
    size_bytes: u64,
    modified_at_ms: Option<u64>,
    created_at_ms: Option<u64>,
    is_hidden: bool,
    preview_supported: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryScanResult {
    entries: Vec<MemoryEntryMetadata>,
    skipped_count: usize,
    truncated: bool,
    errors: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryTextPreview {
    text: String,
    truncated: bool,
    bytes_read: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryCopyItem {
    source_path: String,
    destination_path: String,
    copied_files: usize,
    copied_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryCopyFailure {
    source_path: String,
    message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryCopyResult {
    items: Vec<MemoryCopyItem>,
    failures: Vec<MemoryCopyFailure>,
    copied_files: usize,
    copied_bytes: u64,
}

fn absolute_existing_path(path: &str) -> Result<PathBuf, MemoryIoError> {
    let candidate = Path::new(path);
    if !candidate.is_absolute()
        || !candidate.exists()
        || candidate.symlink_metadata()?.file_type().is_symlink()
    {
        return Err(MemoryIoError::InvalidPath(path.to_owned()));
    }
    Ok(candidate.canonicalize()?)
}

fn absolute_file_path(path: &str) -> Result<PathBuf, MemoryIoError> {
    let candidate = Path::new(path);
    if !candidate.is_absolute()
        || !candidate.is_file()
        || candidate.symlink_metadata()?.file_type().is_symlink()
    {
        return Err(MemoryIoError::InvalidPath(path.to_owned()));
    }
    Ok(candidate.canonicalize()?)
}

fn epoch_millis(value: Result<SystemTime, std::io::Error>) -> Option<u64> {
    value
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .and_then(|duration| u64::try_from(duration.as_millis()).ok())
}

fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .is_some_and(|name| name.starts_with('.'))
}

fn media_description(path: &Path, is_directory: bool) -> (&'static str, &'static str) {
    if is_directory {
        return ("folder", "inode/directory");
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "jpg" | "jpeg" => ("image", "image/jpeg"),
        "png" => ("image", "image/png"),
        "gif" => ("image", "image/gif"),
        "webp" => ("image", "image/webp"),
        "bmp" => ("image", "image/bmp"),
        "tif" | "tiff" => ("image", "image/tiff"),
        "svg" => ("image", "image/svg+xml"),
        "heic" | "heif" => ("image", "image/heic"),
        "avif" => ("image", "image/avif"),
        "mp4" | "m4v" => ("video", "video/mp4"),
        "mov" => ("video", "video/quicktime"),
        "webm" => ("video", "video/webm"),
        "mkv" => ("video", "video/x-matroska"),
        "avi" => ("video", "video/x-msvideo"),
        "mp3" => ("audio", "audio/mpeg"),
        "wav" => ("audio", "audio/wav"),
        "flac" => ("audio", "audio/flac"),
        "aac" => ("audio", "audio/aac"),
        "m4a" => ("audio", "audio/mp4"),
        "ogg" | "oga" => ("audio", "audio/ogg"),
        "opus" => ("audio", "audio/opus"),
        "txt" | "log" => ("text", "text/plain"),
        "md" | "markdown" => ("text", "text/markdown"),
        "csv" => ("text", "text/csv"),
        "tsv" => ("text", "text/tab-separated-values"),
        "json" => ("text", "application/json"),
        "yaml" | "yml" => ("text", "application/yaml"),
        "xml" => ("text", "application/xml"),
        "html" | "htm" => ("text", "text/html"),
        "css" => ("text", "text/css"),
        "js" | "mjs" | "cjs" => ("text", "text/javascript"),
        "ts" | "tsx" | "jsx" | "rs" | "py" | "sh" | "srt" | "vtt" => ("text", "text/plain"),
        "pdf" => ("document", "application/pdf"),
        "doc" => ("document", "application/msword"),
        "docx" => (
            "document",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
        "xls" => ("document", "application/vnd.ms-excel"),
        "xlsx" => (
            "document",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ),
        "ppt" => ("document", "application/vnd.ms-powerpoint"),
        "pptx" => (
            "document",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ),
        "rtf" => ("document", "application/rtf"),
        "zip" => ("archive", "application/zip"),
        "7z" => ("archive", "application/x-7z-compressed"),
        "rar" => ("archive", "application/vnd.rar"),
        "tar" => ("archive", "application/x-tar"),
        "gz" => ("archive", "application/gzip"),
        _ => ("other", "application/octet-stream"),
    }
}

fn metadata_for_path(path: &Path, metadata: &fs::Metadata) -> MemoryEntryMetadata {
    let is_directory = metadata.is_dir();
    let (media_kind, mime_type) = media_description(path, is_directory);
    let size_bytes = if metadata.is_file() {
        metadata.len()
    } else {
        0
    };
    let preview_supported = metadata.is_file()
        && media_kind != "archive"
        && media_kind != "other"
        && size_bytes <= HARD_MAX_PREVIEW_BYTES;
    MemoryEntryMetadata {
        path: path.to_string_lossy().into_owned(),
        parent_path: path
            .parent()
            .map(|parent| parent.to_string_lossy().into_owned()),
        name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or(path.to_string_lossy().as_ref())
            .to_owned(),
        extension: path
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase),
        entry_type: if is_directory { "folder" } else { "file" }.to_owned(),
        media_kind: media_kind.to_owned(),
        mime_type: mime_type.to_owned(),
        size_bytes,
        modified_at_ms: epoch_millis(metadata.modified()),
        created_at_ms: epoch_millis(metadata.created()),
        is_hidden: is_hidden(path),
        preview_supported,
    }
}

fn scan_paths(
    paths: &[String],
    options: MemoryScanOptions,
) -> Result<MemoryScanResult, MemoryIoError> {
    let include_hidden = options.include_hidden.unwrap_or(false);
    let max_entries = options
        .max_entries
        .unwrap_or(DEFAULT_MAX_ENTRIES)
        .clamp(1, HARD_MAX_ENTRIES);
    let max_depth = options
        .max_depth
        .unwrap_or(DEFAULT_MAX_DEPTH)
        .min(HARD_MAX_DEPTH);
    let mut stack = Vec::new();
    for source in paths.iter().rev() {
        stack.push((absolute_existing_path(source)?, 0_usize));
    }
    let mut visited = HashSet::new();
    let mut entries = Vec::new();
    let mut skipped_count = 0_usize;
    let mut truncated = false;
    let mut errors = Vec::new();

    while let Some((path, depth)) = stack.pop() {
        if entries.len() >= max_entries {
            truncated = true;
            break;
        }
        if !visited.insert(path.clone()) {
            continue;
        }
        let symlink_metadata = match path.symlink_metadata() {
            Ok(metadata) => metadata,
            Err(error) => {
                errors.push(format!("{}: {error}", path.to_string_lossy()));
                skipped_count += 1;
                continue;
            }
        };
        if symlink_metadata.file_type().is_symlink() {
            skipped_count += 1;
            continue;
        }
        if !include_hidden && is_hidden(&path) {
            skipped_count += 1;
            continue;
        }
        entries.push(metadata_for_path(&path, &symlink_metadata));
        if !symlink_metadata.is_dir() || depth >= max_depth {
            continue;
        }
        let mut children = match fs::read_dir(&path) {
            Ok(children) => children
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .collect::<Vec<_>>(),
            Err(error) => {
                errors.push(format!("{}: {error}", path.to_string_lossy()));
                skipped_count += 1;
                continue;
            }
        };
        children.sort();
        for child in children.into_iter().rev() {
            stack.push((child, depth + 1));
        }
    }
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(MemoryScanResult {
        entries,
        skipped_count,
        truncated,
        errors,
    })
}

#[tauri::command]
pub(crate) fn memory_scan_paths(
    paths: Vec<String>,
    options: Option<MemoryScanOptions>,
) -> Result<MemoryScanResult, MemoryIoError> {
    if paths.is_empty() {
        return Err(MemoryIoError::InvalidPath("nessun percorso".to_owned()));
    }
    scan_paths(&paths, options.unwrap_or_default())
}

#[tauri::command]
pub(crate) fn memory_read_preview(
    path: String,
    max_bytes: Option<u64>,
) -> Result<tauri::ipc::Response, MemoryIoError> {
    let path = absolute_file_path(&path)?;
    let max_bytes = max_bytes
        .unwrap_or(DEFAULT_PREVIEW_BYTES)
        .clamp(1, HARD_MAX_PREVIEW_BYTES);
    let size = fs::metadata(&path)?.len();
    if size > max_bytes {
        return Err(MemoryIoError::PreviewTooLarge {
            path: path.to_string_lossy().into_owned(),
            limit_mb: max_bytes.div_ceil(1024 * 1024),
        });
    }
    Ok(tauri::ipc::Response::new(fs::read(path)?))
}

#[tauri::command]
pub(crate) fn memory_read_text_preview(
    path: String,
    max_bytes: Option<usize>,
) -> Result<MemoryTextPreview, MemoryIoError> {
    let path = absolute_file_path(&path)?;
    let max_bytes = max_bytes
        .unwrap_or(DEFAULT_TEXT_PREVIEW_BYTES)
        .clamp(1, HARD_MAX_TEXT_PREVIEW_BYTES);
    let file = fs::File::open(path)?;
    let mut bytes = Vec::with_capacity(max_bytes + 1);
    file.take((max_bytes + 1) as u64).read_to_end(&mut bytes)?;
    let truncated = bytes.len() > max_bytes;
    bytes.truncate(max_bytes);
    Ok(MemoryTextPreview {
        text: String::from_utf8_lossy(&bytes).into_owned(),
        truncated,
        bytes_read: bytes.len(),
    })
}

fn available_destination(destination: &Path, name: &std::ffi::OsStr) -> PathBuf {
    let initial = destination.join(name);
    if !initial.exists() {
        return initial;
    }
    let source = Path::new(name);
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("file");
    let extension = source.extension().and_then(|value| value.to_str());
    for index in 2_u32.. {
        let candidate_name = match extension {
            Some(extension) => format!("{stem} ({index}).{extension}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = destination.join(candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!("the destination suffix range is unbounded")
}

fn copy_file_without_overwrite(source: &Path, destination: &Path) -> std::io::Result<u64> {
    let parent = destination.parent().ok_or_else(|| {
        std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "destinazione senza cartella",
        )
    })?;
    fs::create_dir_all(parent)?;
    let mut created = false;
    let result = (|| {
        let mut input = fs::File::open(source)?;
        let mut output = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination)?;
        created = true;
        let bytes = std::io::copy(&mut input, &mut output)?;
        output.flush()?;
        output.sync_all()?;
        Ok(bytes)
    })();
    if result.is_err() && created {
        let _ = fs::remove_file(destination);
    }
    result
}

fn copy_tree(source: &Path, destination: &Path) -> std::io::Result<(usize, u64)> {
    let metadata = source.symlink_metadata()?;
    if metadata.file_type().is_symlink() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "i collegamenti simbolici non vengono copiati",
        ));
    }
    if metadata.is_file() {
        return copy_file_without_overwrite(source, destination).map(|bytes| (1, bytes));
    }
    fs::create_dir(destination)?;
    let mut stack = vec![(source.to_path_buf(), destination.to_path_buf())];
    let mut copied_files = 0_usize;
    let mut copied_bytes = 0_u64;
    while let Some((source_directory, destination_directory)) = stack.pop() {
        let mut children = fs::read_dir(&source_directory)?.collect::<Result<Vec<_>, _>>()?;
        children.sort_by_key(|entry| entry.path());
        for child in children {
            let child_source = child.path();
            let child_metadata = child_source.symlink_metadata()?;
            if child_metadata.file_type().is_symlink() {
                continue;
            }
            let child_destination = destination_directory.join(child.file_name());
            if child_metadata.is_dir() {
                fs::create_dir(&child_destination)?;
                stack.push((child_source, child_destination));
            } else if child_metadata.is_file() {
                copied_bytes += copy_file_without_overwrite(&child_source, &child_destination)?;
                copied_files += 1;
            }
        }
    }
    Ok((copied_files, copied_bytes))
}

fn clean_incomplete_copy(path: &Path) {
    if path.is_dir() {
        let _ = fs::remove_dir_all(path);
    } else if path.is_file() {
        let _ = fs::remove_file(path);
    }
}

#[tauri::command]
pub(crate) fn memory_copy_entries(
    source_paths: Vec<String>,
    destination_directory: String,
) -> Result<MemoryCopyResult, MemoryIoError> {
    let destination = absolute_existing_path(&destination_directory)?;
    if !destination.is_dir() {
        return Err(MemoryIoError::InvalidDestination(destination_directory));
    }
    let mut items = Vec::new();
    let mut failures = Vec::new();
    let mut copied_files = 0_usize;
    let mut copied_bytes = 0_u64;
    let mut seen_sources = HashSet::new();

    for source_path in source_paths {
        let source = match absolute_existing_path(&source_path) {
            Ok(path) => path,
            Err(error) => {
                failures.push(MemoryCopyFailure {
                    source_path,
                    message: error.to_string(),
                });
                continue;
            }
        };
        if !seen_sources.insert(source.clone()) {
            continue;
        }
        if source.is_dir() && destination.starts_with(&source) {
            failures.push(MemoryCopyFailure {
                source_path: source.to_string_lossy().into_owned(),
                message: "La destinazione non può trovarsi dentro la cartella sorgente".to_owned(),
            });
            continue;
        }
        let Some(name) = source.file_name() else {
            failures.push(MemoryCopyFailure {
                source_path: source.to_string_lossy().into_owned(),
                message: "Il percorso sorgente non ha un nome copiabile".to_owned(),
            });
            continue;
        };
        let target = available_destination(&destination, name);
        match copy_tree(&source, &target) {
            Ok((file_count, byte_count)) => {
                copied_files += file_count;
                copied_bytes += byte_count;
                items.push(MemoryCopyItem {
                    source_path: source.to_string_lossy().into_owned(),
                    destination_path: target.to_string_lossy().into_owned(),
                    copied_files: file_count,
                    copied_bytes: byte_count,
                });
            }
            Err(error) => {
                clean_incomplete_copy(&target);
                failures.push(MemoryCopyFailure {
                    source_path: source.to_string_lossy().into_owned(),
                    message: error.to_string(),
                });
            }
        }
    }
    Ok(MemoryCopyResult {
        items,
        failures,
        copied_files,
        copied_bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scans_supported_files_and_ignores_hidden_entries() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let nested = directory.path().join("Album");
        fs::create_dir(&nested).expect("nested folder");
        fs::write(nested.join("cover.png"), b"png").expect("image fixture");
        fs::write(nested.join("lyrics.md"), b"lyrics").expect("text fixture");
        fs::write(nested.join(".draft.txt"), b"hidden").expect("hidden fixture");
        let result = scan_paths(
            &[nested.to_string_lossy().into_owned()],
            MemoryScanOptions::default(),
        )
        .expect("scan result");
        assert_eq!(result.entries.len(), 3);
        assert_eq!(result.skipped_count, 1);
        assert!(result.entries.iter().any(|entry| {
            entry.name == "cover.png"
                && entry.media_kind == "image"
                && entry.mime_type == "image/png"
        }));
        assert!(result.entries.iter().any(|entry| {
            entry.name == "lyrics.md" && entry.media_kind == "text" && entry.preview_supported
        }));
    }

    #[test]
    fn scan_limits_are_reported_without_walking_forever() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let visible_directory = directory.path().join("Library");
        fs::create_dir(&visible_directory).expect("visible fixture directory");
        for index in 0..5 {
            fs::write(visible_directory.join(format!("{index}.txt")), b"text").expect("fixture");
        }
        let result = scan_paths(
            &[visible_directory.to_string_lossy().into_owned()],
            MemoryScanOptions {
                max_entries: Some(2),
                ..MemoryScanOptions::default()
            },
        )
        .expect("limited scan");
        assert_eq!(result.entries.len(), 2);
        assert!(result.truncated);
    }

    #[test]
    fn text_preview_is_bounded_and_marks_truncation() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("notes.txt");
        fs::write(&path, b"abcdefghij").expect("fixture");
        let preview = memory_read_text_preview(path.to_string_lossy().into_owned(), Some(4))
            .expect("preview");
        assert_eq!(preview.text, "abcd");
        assert_eq!(preview.bytes_read, 4);
        assert!(preview.truncated);
    }

    #[test]
    fn copy_never_overwrites_an_existing_file() {
        let source_directory = tempfile::tempdir().expect("source directory");
        let destination_directory = tempfile::tempdir().expect("destination directory");
        let source = source_directory.path().join("cover.png");
        fs::write(&source, b"new").expect("source fixture");
        fs::write(destination_directory.path().join("cover.png"), b"existing")
            .expect("destination fixture");
        let result = memory_copy_entries(
            vec![source.to_string_lossy().into_owned()],
            destination_directory.path().to_string_lossy().into_owned(),
        )
        .expect("copy result");
        assert_eq!(result.copied_files, 1);
        assert_eq!(result.failures.len(), 0);
        assert_eq!(
            fs::read(destination_directory.path().join("cover.png")).expect("original destination"),
            b"existing"
        );
        assert_eq!(
            fs::read(destination_directory.path().join("cover (2).png"))
                .expect("copied destination"),
            b"new"
        );
    }

    #[test]
    fn refuses_to_copy_a_folder_inside_itself() {
        let source_directory = tempfile::tempdir().expect("source directory");
        let destination = source_directory.path().join("inside");
        fs::create_dir(&destination).expect("destination");
        let result = memory_copy_entries(
            vec![source_directory.path().to_string_lossy().into_owned()],
            destination.to_string_lossy().into_owned(),
        )
        .expect("copy result");
        assert_eq!(result.copied_files, 0);
        assert_eq!(result.failures.len(), 1);
    }
}
