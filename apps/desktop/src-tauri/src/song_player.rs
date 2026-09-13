use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, ExitStatus, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const PROTOCOL_VERSION: u8 = 1;
const MAX_LOCAL_INPUT_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_MEDIA_DURATION_SECONDS: f64 = 2.0 * 60.0 * 60.0;
const MAX_REQUEST_BYTES: usize = 64 * 1024;
const MAX_STDOUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_STDOUT_LINE_BYTES: usize = 1024 * 1024;
const MAX_STDERR_BYTES: usize = 64 * 1024;
const TERMINAL_JOB_TTL_MS: u64 = 30 * 60 * 1000;
const POLL_INTERVAL: Duration = Duration::from_millis(25);
const CAPABILITIES_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_JOB_RUNTIME: Duration = Duration::from_secs(2 * 60 * 60 + 5 * 60);
const MAX_ACTIVE_JOBS: usize = 1;
const SUPPORTED_MEDIA_EXTENSIONS: &[&str] = &[
    "aac", "avi", "flac", "m4a", "m4v", "mkv", "mov", "mp3", "mp4", "ogg", "opus", "wav", "webm",
];

#[derive(Debug, thiserror::Error)]
pub enum SongPlayerError {
    #[error("Richiesta Song Player non valida: {0}")]
    InvalidRequest(String),
    #[error("Il percorso audio locale non e valido")]
    InvalidLocalPath,
    #[error("Il formato audio locale non e supportato")]
    UnsupportedMedia,
    #[error("Il file audio supera il limite di 1 GiB")]
    MediaTooLarge,
    #[error("Il runtime Song Player non e pronto: {0}")]
    RuntimeUnavailable(String),
    #[error("Un job Song Player e gia attivo; attendi il completamento o annullalo")]
    ActiveJobLimit,
    #[error("Job Song Player non trovato")]
    JobNotFound,
    #[error("Errore I/O Song Player: {0}")]
    Io(#[from] std::io::Error),
}

impl Serialize for SongPlayerError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

/// Native request contract.  The fields are deliberately tagged by operation so
/// that hashes, shell flags, and output paths can never accidentally cross the
/// trust boundary.  Download output is always selected by the backend.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum SongPlayerStartRequest {
    Download {
        #[serde(rename = "youtubeUrl")]
        youtube_url: String,
    },
    Analyze {
        #[serde(rename = "inputPath")]
        input_path: String,
    },
    Match {
        #[serde(rename = "referencePath")]
        reference_path: String,
        #[serde(rename = "targetPath")]
        target_path: String,
    },
    SeparateVocals {
        #[serde(rename = "inputPath")]
        input_path: String,
        #[serde(rename = "startSeconds")]
        start_seconds: Option<f64>,
        #[serde(rename = "endSeconds")]
        end_seconds: Option<f64>,
    },
    ExtractAudio {
        #[serde(rename = "inputPath")]
        input_path: String,
    },
    AlignWaveform {
        #[serde(rename = "sourcePath")]
        source_path: String,
        #[serde(rename = "targetPath")]
        target_path: String,
    },
    RefineAlignment {
        #[serde(rename = "sourcePath")]
        source_path: String,
        #[serde(rename = "targetPath")]
        target_path: String,
        anchors: Vec<LipsyncRefineAnchor>,
    },
    AnalyzeVisemes {
        #[serde(rename = "inputPath")]
        input_path: String,
        anchors: Vec<LipsyncVisualAnchor>,
        language: String,
    },
    TranscribeWords {
        #[serde(rename = "inputPath")]
        input_path: String,
        language: String,
        model: String,
        #[serde(rename = "startSeconds")]
        start_seconds: Option<f64>,
        #[serde(rename = "endSeconds")]
        end_seconds: Option<f64>,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LipsyncRefineAnchor {
    id: String,
    cue_index: usize,
    source_start: f64,
    source_center: f64,
    source_end: f64,
    target_start: f64,
    target_center: f64,
    target_end: f64,
    max_shift_ms: f64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LipsyncVisualAnchor {
    id: String,
    text: String,
    canonical_index: usize,
    cue_index: usize,
    source_start: f64,
    source_center: f64,
    source_end: f64,
    source_confidence: f64,
}

#[derive(Debug, Clone)]
enum ValidatedRequest {
    Download {
        youtube_url: String,
    },
    Analyze {
        input_path: PathBuf,
    },
    Match {
        reference_path: PathBuf,
        target_path: PathBuf,
    },
    SeparateVocals {
        input_path: PathBuf,
        start_seconds: Option<f64>,
        end_seconds: Option<f64>,
    },
    ExtractAudio {
        input_path: PathBuf,
    },
    AlignWaveform {
        source_path: PathBuf,
        target_path: PathBuf,
    },
    RefineAlignment {
        source_path: PathBuf,
        target_path: PathBuf,
        anchors: Vec<LipsyncRefineAnchor>,
    },
    AnalyzeVisemes {
        input_path: PathBuf,
        anchors: Vec<LipsyncVisualAnchor>,
        language: String,
    },
    TranscribeWords {
        input_path: PathBuf,
        language: String,
        model: String,
        start_seconds: Option<f64>,
        end_seconds: Option<f64>,
    },
}

impl ValidatedRequest {
    fn kind(&self) -> &'static str {
        match self {
            Self::Download { .. } => "download",
            Self::Analyze { .. } => "analyze",
            Self::Match { .. } => "match",
            Self::SeparateVocals { .. } => "separateVocals",
            Self::ExtractAudio { .. } => "extractAudio",
            Self::AlignWaveform { .. } => "alignWaveform",
            Self::RefineAlignment { .. } => "refineAlignment",
            Self::AnalyzeVisemes { .. } => "analyzeVisemes",
            Self::TranscribeWords { .. } => "transcribeWords",
        }
    }

    fn worker_payload(&self, job_root: &Path, library_root: &Path) -> Value {
        match self {
            Self::Download { youtube_url } => json!({
                "protocolVersion": PROTOCOL_VERSION,
                "action": "download",
                "youtubeUrl": youtube_url,
                "jobRoot": job_root,
                "libraryRoot": library_root,
            }),
            Self::Analyze { input_path } => json!({
                "protocolVersion": PROTOCOL_VERSION,
                "action": "analyze",
                "inputPath": input_path,
                "jobRoot": job_root,
            }),
            Self::Match {
                reference_path,
                target_path,
            } => json!({
                "protocolVersion": PROTOCOL_VERSION,
                "action": "match",
                "referencePath": reference_path,
                "targetPath": target_path,
                "jobRoot": job_root,
            }),
            Self::SeparateVocals {
                input_path,
                start_seconds,
                end_seconds,
            } => json!({
                "protocolVersion": PROTOCOL_VERSION,
                "action": "separateVocals",
                "inputPath": input_path,
                "jobRoot": job_root,
                "startSeconds": start_seconds,
                "endSeconds": end_seconds,
            }),
            Self::ExtractAudio { input_path } => json!({
                "protocolVersion": PROTOCOL_VERSION,
                "action": "extractAudio",
                "inputPath": input_path,
                "jobRoot": job_root,
            }),
            Self::AlignWaveform {
                source_path,
                target_path,
            } => json!({
                "protocolVersion": PROTOCOL_VERSION,
                "action": "alignWaveform",
                "sourcePath": source_path,
                "targetPath": target_path,
                "jobRoot": job_root,
            }),
            Self::RefineAlignment {
                source_path,
                target_path,
                anchors,
            } => json!({
                "protocolVersion": PROTOCOL_VERSION,
                "action": "refineAlignment",
                "sourcePath": source_path,
                "targetPath": target_path,
                "anchors": anchors,
                "jobRoot": job_root,
            }),
            Self::AnalyzeVisemes {
                input_path,
                anchors,
                language,
            } => json!({
                "protocolVersion": PROTOCOL_VERSION,
                "action": "analyzeVisemes",
                "inputPath": input_path,
                "anchors": anchors,
                "language": language,
                "jobRoot": job_root,
            }),
            Self::TranscribeWords {
                input_path,
                language,
                model,
                start_seconds,
                end_seconds,
            } => json!({
                "protocolVersion": PROTOCOL_VERSION,
                "action": "transcribeWords",
                "inputPath": input_path,
                "language": language,
                "model": model,
                "startSeconds": start_seconds,
                "endSeconds": end_seconds,
                "jobRoot": job_root,
            }),
        }
    }
}

fn validate_start_request(
    request: SongPlayerStartRequest,
) -> Result<ValidatedRequest, SongPlayerError> {
    match request {
        SongPlayerStartRequest::Download { youtube_url } => {
            if youtube_url.len() > 2_048
                || !youtube_url.starts_with("https://")
                || youtube_url.chars().any(char::is_control)
            {
                return Err(SongPlayerError::InvalidRequest(
                    "youtubeUrl deve essere un URL HTTPS diretto".into(),
                ));
            }
            // The Python worker performs strict host/video-id/playlist/live validation.
            Ok(ValidatedRequest::Download { youtube_url })
        }
        SongPlayerStartRequest::Analyze { input_path } => Ok(ValidatedRequest::Analyze {
            input_path: validate_local_media(Path::new(&input_path))?,
        }),
        SongPlayerStartRequest::Match {
            reference_path,
            target_path,
        } => Ok(ValidatedRequest::Match {
            reference_path: validate_local_media(Path::new(&reference_path))?,
            target_path: validate_local_media(Path::new(&target_path))?,
        }),
        SongPlayerStartRequest::SeparateVocals {
            input_path,
            start_seconds,
            end_seconds,
        } => {
            if start_seconds.is_some() != end_seconds.is_some()
                || start_seconds.is_some_and(|value| !value.is_finite() || value < 0.0)
                || end_seconds.is_some_and(|value| !value.is_finite() || value <= 0.0)
                || matches!((start_seconds, end_seconds), (Some(start), Some(end)) if end <= start + 0.05 || end - start > MAX_MEDIA_DURATION_SECONDS)
            {
                return Err(SongPlayerError::InvalidRequest(
                    "intervallo startSeconds/endSeconds non valido".into(),
                ));
            }
            Ok(ValidatedRequest::SeparateVocals {
                input_path: validate_local_media(Path::new(&input_path))?,
                start_seconds,
                end_seconds,
            })
        }
        SongPlayerStartRequest::ExtractAudio { input_path } => Ok(ValidatedRequest::ExtractAudio {
            input_path: validate_local_media(Path::new(&input_path))?,
        }),
        SongPlayerStartRequest::AlignWaveform {
            source_path,
            target_path,
        } => Ok(ValidatedRequest::AlignWaveform {
            source_path: validate_local_media(Path::new(&source_path))?,
            target_path: validate_local_media(Path::new(&target_path))?,
        }),
        SongPlayerStartRequest::RefineAlignment {
            source_path,
            target_path,
            anchors,
        } => {
            if anchors.is_empty()
                || anchors.len() > 128
                || anchors.iter().any(|anchor| {
                    anchor.id.is_empty()
                        || anchor.id.len() > 200
                        || !anchor.source_start.is_finite()
                        || !anchor.source_center.is_finite()
                        || !anchor.source_end.is_finite()
                        || !anchor.target_start.is_finite()
                        || !anchor.target_center.is_finite()
                        || !anchor.target_end.is_finite()
                        || !anchor.max_shift_ms.is_finite()
                        || !(0.0..=30_000.0).contains(&anchor.max_shift_ms)
                        || anchor.source_start < 0.0
                        || anchor.source_start > anchor.source_center
                        || anchor.source_center > anchor.source_end
                        || anchor.target_start < 0.0
                        || anchor.target_start > anchor.target_center
                        || anchor.target_center > anchor.target_end
                })
            {
                return Err(SongPlayerError::InvalidRequest(
                    "anchor di micro allineamento non validi".into(),
                ));
            }
            Ok(ValidatedRequest::RefineAlignment {
                source_path: validate_local_media(Path::new(&source_path))?,
                target_path: validate_local_media(Path::new(&target_path))?,
                anchors,
            })
        }
        SongPlayerStartRequest::AnalyzeVisemes {
            input_path,
            anchors,
            language,
        } => {
            if anchors.is_empty()
                || anchors.len() > 128
                || language.is_empty()
                || language.len() > 16
                || !language
                    .chars()
                    .all(|value| value.is_ascii_alphabetic() || value == '-')
                || anchors.iter().any(|anchor| {
                    anchor.id.is_empty()
                        || anchor.id.len() > 200
                        || anchor.text.trim().is_empty()
                        || anchor.text.len() > 120
                        || !anchor.source_start.is_finite()
                        || !anchor.source_center.is_finite()
                        || !anchor.source_end.is_finite()
                        || !anchor.source_confidence.is_finite()
                        || !(0.0..=1.0).contains(&anchor.source_confidence)
                        || anchor.source_start < 0.0
                        || anchor.source_start > anchor.source_center
                        || anchor.source_center > anchor.source_end
                })
            {
                return Err(SongPlayerError::InvalidRequest(
                    "anchor o lingua Auto-AVSR non validi".into(),
                ));
            }
            let mut ids = std::collections::HashSet::new();
            let mut indexes = std::collections::HashSet::new();
            if anchors.iter().any(|anchor| {
                !ids.insert(anchor.id.clone()) || !indexes.insert(anchor.canonical_index)
            }) {
                return Err(SongPlayerError::InvalidRequest(
                    "anchor Auto-AVSR duplicati".into(),
                ));
            }
            Ok(ValidatedRequest::AnalyzeVisemes {
                input_path: validate_local_media(Path::new(&input_path))?,
                anchors,
                language,
            })
        }
        SongPlayerStartRequest::TranscribeWords {
            input_path,
            language,
            model,
            start_seconds,
            end_seconds,
        } => {
            if language.is_empty()
                || language.len() > 16
                || (language != "auto"
                    && !language
                        .chars()
                        .all(|value| value.is_ascii_alphabetic() || value == '-'))
                || !matches!(
                    model.as_str(),
                    "whisper-tiny_timestamped"
                        | "whisper-base_timestamped"
                        | "whisper-medium_timestamped"
                )
                || start_seconds.is_some() != end_seconds.is_some()
                || start_seconds.is_some_and(|value| !value.is_finite() || value < 0.0)
                || end_seconds.is_some_and(|value| !value.is_finite() || value <= 0.0)
                || matches!((start_seconds, end_seconds), (Some(start), Some(end)) if end <= start + 0.05 || end - start > MAX_MEDIA_DURATION_SECONDS)
            {
                return Err(SongPlayerError::InvalidRequest(
                    "parametri Whisper non validi".into(),
                ));
            }
            Ok(ValidatedRequest::TranscribeWords {
                input_path: validate_local_media(Path::new(&input_path))?,
                language,
                model,
                start_seconds,
                end_seconds,
            })
        }
    }
}

fn validate_local_media(path: &Path) -> Result<PathBuf, SongPlayerError> {
    if !path.is_absolute() || path.is_symlink() || !path.is_file() {
        return Err(SongPlayerError::InvalidLocalPath);
    }
    let canonical = fs::canonicalize(path).map_err(|_| SongPlayerError::InvalidLocalPath)?;
    let metadata = fs::metadata(&canonical).map_err(|_| SongPlayerError::InvalidLocalPath)?;
    if !metadata.is_file() {
        return Err(SongPlayerError::InvalidLocalPath);
    }
    if metadata.len() > MAX_LOCAL_INPUT_BYTES {
        return Err(SongPlayerError::MediaTooLarge);
    }
    let extension = canonical
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or(SongPlayerError::UnsupportedMedia)?;
    if !SUPPORTED_MEDIA_EXTENSIONS.contains(&extension.as_str()) {
        return Err(SongPlayerError::UnsupportedMedia);
    }
    Ok(canonical)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongPlayerCapabilities {
    protocol_version: u8,
    ready: bool,
    runtime_ready: bool,
    worker_ready: bool,
    features: Value,
    dependencies: Value,
    limits: Value,
    reason: Option<String>,
}

impl SongPlayerCapabilities {
    fn unavailable(runtime_ready: bool, worker_ready: bool, reason: String) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            ready: false,
            runtime_ready,
            worker_ready,
            features: json!({ "download": false, "analyze": false, "match": false, "separateVocals": false, "extractAudio": false, "alignWaveform": false, "refineAlignment": false, "analyzeVisemes": false, "transcribeWords": false }),
            dependencies: json!({}),
            limits: json!({}),
            reason: Some(reason),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SongPlayerJobStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

impl SongPlayerJobStatus {
    fn is_terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongPlayerJob {
    job_id: String,
    kind: String,
    status: SongPlayerJobStatus,
    progress: f64,
    message: Option<String>,
    result: Option<Value>,
    error: Option<String>,
    created_at_ms: u64,
    updated_at_ms: u64,
}

struct JobRecord {
    snapshot: SongPlayerJob,
    cancel: Arc<AtomicBool>,
    job_root: PathBuf,
    jobs_root: PathBuf,
    process_id: Option<u32>,
    /// Remains true from registration through the worker thread's final cleanup,
    /// including the interval before a child PID is available.
    worker_active: bool,
}

#[derive(Default)]
struct SharedState {
    jobs: Mutex<HashMap<String, JobRecord>>,
    sequence: AtomicU64,
}

#[derive(Clone, Default)]
pub struct SongPlayerState {
    shared: Arc<SharedState>,
    runtime_setup: Arc<Mutex<SongPlayerRuntimeSetup>>,
    runtime_setup_active: Arc<AtomicBool>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SongPlayerRuntimeSetupStatus {
    Idle,
    Installing,
    Ready,
    Failed,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongPlayerRuntimeSetup {
    status: SongPlayerRuntimeSetupStatus,
    progress: u8,
    message: String,
    error: Option<String>,
    updated_at_ms: u64,
}

impl Default for SongPlayerRuntimeSetup {
    fn default() -> Self {
        Self {
            status: SongPlayerRuntimeSetupStatus::Idle,
            progress: 0,
            message: "Runtime vocale non ancora verificato".into(),
            error: None,
            updated_at_ms: now_ms(),
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn valid_job_id(value: &str) -> bool {
    value.len() >= 20
        && value.len() <= 80
        && value.starts_with("sp-")
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

fn next_job_id(state: &SharedState) -> String {
    let sequence = state.sequence.fetch_add(1, Ordering::Relaxed);
    format!("sp-{:x}-{:x}-{:x}", now_ms(), std::process::id(), sequence)
}

fn direct_child_directory(root: &Path, name: &str) -> Result<PathBuf, SongPlayerError> {
    if !valid_job_id(name) {
        return Err(SongPlayerError::InvalidRequest("jobId non valido".into()));
    }
    fs::create_dir_all(root)?;
    let root = fs::canonicalize(root)?;
    let child = root.join(name);
    fs::create_dir(&child)?;
    let child = fs::canonicalize(child)?;
    if child.parent() != Some(root.as_path())
        || child.file_name().and_then(|v| v.to_str()) != Some(name)
    {
        return Err(SongPlayerError::InvalidRequest(
            "Directory job non confinata".into(),
        ));
    }
    Ok(child)
}

fn safe_remove_job_root(jobs_root: &Path, job_root: &Path, job_id: &str) -> bool {
    if !valid_job_id(job_id) || !job_root.exists() || job_root.is_symlink() {
        return false;
    }
    let Ok(root) = fs::canonicalize(jobs_root) else {
        return false;
    };
    let Ok(target) = fs::canonicalize(job_root) else {
        return false;
    };
    if target.parent() != Some(root.as_path())
        || target.file_name().and_then(|value| value.to_str()) != Some(job_id)
    {
        return false;
    }
    fs::remove_dir_all(target).is_ok()
}

fn cleanup_staging(job_root: &Path) {
    if job_root.is_symlink() {
        return;
    }
    let Ok(root) = fs::canonicalize(job_root) else {
        return;
    };
    let staging = root.join("staging");
    if staging.is_symlink() || !staging.exists() {
        return;
    }
    let Ok(staging) = fs::canonicalize(staging) else {
        return;
    };
    if staging.parent() == Some(root.as_path())
        && staging.file_name().and_then(|v| v.to_str()) == Some("staging")
    {
        let _ = fs::remove_dir_all(staging);
    }
}

fn cleanup_expired_jobs(state: &SharedState, current_ms: u64) {
    let expired: Vec<(String, PathBuf, PathBuf)> = {
        let jobs = state
            .jobs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        jobs.iter()
            .filter(|(_, record)| {
                record.snapshot.status.is_terminal()
                    && record.process_id.is_none()
                    && !record.worker_active
                    && current_ms.saturating_sub(record.snapshot.updated_at_ms)
                        > TERMINAL_JOB_TTL_MS
            })
            .map(|(id, record)| {
                (
                    id.clone(),
                    record.jobs_root.clone(),
                    record.job_root.clone(),
                )
            })
            .collect()
    };
    if expired.is_empty() {
        return;
    }
    let mut jobs = state
        .jobs
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    for (job_id, jobs_root, job_root) in expired {
        let should_remove = jobs.get(&job_id).is_some_and(|record| {
            record.snapshot.status.is_terminal()
                && record.process_id.is_none()
                && !record.worker_active
                && current_ms.saturating_sub(record.snapshot.updated_at_ms) > TERMINAL_JOB_TTL_MS
        });
        if should_remove {
            jobs.remove(&job_id);
            let _ = safe_remove_job_root(&jobs_root, &job_root, &job_id);
        }
    }
}

fn has_active_job(state: &SharedState) -> bool {
    let jobs = state
        .jobs
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    jobs.values()
        .filter(|record| {
            // A cancelled running job remains active until its process has actually
            // exited.  This prevents a replacement job from running concurrently
            // during the cancellation grace period.
            record.worker_active
                || !record.snapshot.status.is_terminal()
                || record.process_id.is_some()
        })
        .count()
        >= MAX_ACTIVE_JOBS
}

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")))
        .to_path_buf()
}

fn venv_python(root: &Path) -> PathBuf {
    if cfg!(windows) {
        root.join("Scripts/python.exe")
    } else {
        root.join("bin/python")
    }
}

fn song_player_resource_root(app: &tauri::AppHandle) -> Result<PathBuf, SongPlayerError> {
    let workspace = workspace_root().join("tools/song-player");
    if workspace.join("worker.py").is_file() && workspace.join("requirements.txt").is_file() {
        return Ok(workspace);
    }
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|error| SongPlayerError::Io(std::io::Error::other(error.to_string())))?
        .join("song-player");
    if bundled.join("worker.py").is_file() && bundled.join("requirements.txt").is_file() {
        Ok(bundled)
    } else {
        Err(SongPlayerError::RuntimeUnavailable(
            "Risorse interne Song Player non presenti nell’installazione".into(),
        ))
    }
}

fn runtime_root(app: &tauri::AppHandle) -> Result<PathBuf, SongPlayerError> {
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| SongPlayerError::Io(std::io::Error::other(error.to_string())))?
        .join("song-player/runtime");
    fs::create_dir_all(root.parent().ok_or_else(|| {
        SongPlayerError::RuntimeUnavailable("Percorso runtime non valido".into())
    })?)?;
    Ok(root)
}

fn worker_paths(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), SongPlayerError> {
    let managed_python = venv_python(&runtime_root(app)?);
    let legacy_root = workspace_root().join(".venv-song-player");
    let legacy_python = venv_python(&legacy_root);
    let python = if managed_python.is_file() {
        managed_python
    } else {
        legacy_python
    };
    Ok((python, song_player_resource_root(app)?.join("worker.py")))
}

fn set_runtime_setup(
    state: &SongPlayerState,
    status: SongPlayerRuntimeSetupStatus,
    progress: u8,
    message: impl Into<String>,
    error: Option<String>,
) {
    let mut setup = state
        .runtime_setup
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *setup = SongPlayerRuntimeSetup {
        status,
        progress: progress.min(100),
        message: message.into(),
        error,
        updated_at_ms: now_ms(),
    };
}

fn python_311_command() -> Option<(String, Vec<String>)> {
    let mut candidates = Vec::new();
    if let Ok(value) = std::env::var("MLSM_PYTHON") {
        if !value.trim().is_empty() {
            candidates.push((value, vec![]));
        }
    }
    candidates.extend([
        ("python3.11".into(), vec![]),
        ("python3".into(), vec![]),
        ("python".into(), vec![]),
    ]);
    if cfg!(windows) {
        candidates.insert(0, ("py".into(), vec!["-3.11".into()]));
    }
    candidates.into_iter().find(|(program, prefix)| {
        Command::new(program)
            .args(prefix)
            .args([
                "-c",
                "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)",
            ])
            .status()
            .is_ok_and(|status| status.success())
    })
}

fn run_runtime_step(program: &str, prefix: &[String], arguments: &[String]) -> Result<(), String> {
    let output = Command::new(program)
        .args(prefix)
        .args(arguments)
        .current_dir(workspace_root())
        .output()
        .map_err(|error| error.to_string())?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    let detail = if stderr.trim().is_empty() {
        stdout.trim()
    } else {
        stderr.trim()
    };
    Err(detail
        .chars()
        .rev()
        .take(4_000)
        .collect::<String>()
        .chars()
        .rev()
        .collect())
}

fn install_song_player_runtime(app: tauri::AppHandle, state: SongPlayerState) {
    let result = (|| -> Result<(), String> {
        let resources = song_player_resource_root(&app).map_err(|error| error.to_string())?;
        let root = runtime_root(&app).map_err(|error| error.to_string())?;
        let python = venv_python(&root);
        if !python.is_file() {
            set_runtime_setup(
                &state,
                SongPlayerRuntimeSetupStatus::Installing,
                8,
                "Preparazione automatica di Python",
                None,
            );
            let (program, prefix) = python_311_command().ok_or_else(|| {
                "Python 3.11 non è disponibile nell’installazione di MLSM Studio".to_string()
            })?;
            let mut arguments = vec![
                "-m".into(),
                "venv".into(),
                root.to_string_lossy().into_owned(),
            ];
            run_runtime_step(&program, &prefix, &arguments)?;
            arguments.clear();
        }
        let executable = python.to_string_lossy().into_owned();
        set_runtime_setup(
            &state,
            SongPlayerRuntimeSetupStatus::Installing,
            22,
            "Aggiornamento del runtime isolato",
            None,
        );
        run_runtime_step(
            &executable,
            &[],
            &[
                "-m".into(),
                "pip".into(),
                "install".into(),
                "--upgrade".into(),
                "pip".into(),
                "setuptools".into(),
                "wheel".into(),
            ],
        )?;
        set_runtime_setup(
            &state,
            SongPlayerRuntimeSetupStatus::Installing,
            34,
            "Rimozione di distribuzioni OpenCV incompatibili",
            None,
        );
        run_runtime_step(
            &executable,
            &[],
            &[
                "-m".into(),
                "pip".into(),
                "uninstall".into(),
                "--yes".into(),
                "opencv-python".into(),
                "opencv-python-headless".into(),
            ],
        )?;
        set_runtime_setup(
            &state,
            SongPlayerRuntimeSetupStatus::Installing,
            42,
            "Installazione automatica di Demucs, pYIN, Auto-AVSR e Whisper",
            None,
        );
        run_runtime_step(
            &executable,
            &[],
            &[
                "-m".into(),
                "pip".into(),
                "install".into(),
                "--requirement".into(),
                resources
                    .join("requirements.txt")
                    .to_string_lossy()
                    .into_owned(),
            ],
        )?;
        set_runtime_setup(
            &state,
            SongPlayerRuntimeSetupStatus::Installing,
            78,
            "Download e verifica del modello vocale htdemucs",
            None,
        );
        run_runtime_step(
            &executable,
            &[],
            &[
                "-c".into(),
                "from demucs.pretrained import get_model; get_model('htdemucs')".into(),
            ],
        )?;
        set_runtime_setup(
            &state,
            SongPlayerRuntimeSetupStatus::Installing,
            94,
            "Verifica finale del motore vocale",
            None,
        );
        let worker = resources.join("worker.py").to_string_lossy().into_owned();
        let output = Command::new(&executable)
            .arg(worker)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .and_then(|mut child| {
                child
                    .stdin
                    .take()
                    .ok_or_else(|| std::io::Error::other("stdin worker assente"))?
                    .write_all(b"{\"protocolVersion\":1,\"action\":\"capabilities\"}\n")?;
                child.wait_with_output()
            })
            .map_err(|error| error.to_string())?;
        let capability = parse_capability_output(&output.stdout)?;
        if !output.status.success()
            || capability
                .pointer("/features/separateVocals")
                .and_then(Value::as_bool)
                != Some(true)
            || capability
                .pointer("/features/analyzeVisemes")
                .and_then(Value::as_bool)
                != Some(true)
            || capability
                .pointer("/features/transcribeWords")
                .and_then(Value::as_bool)
                != Some(true)
        {
            return Err(
                "Il runtime installato non ha superato la verifica Demucs/pYIN/FFmpeg/Auto-AVSR/Whisper".into(),
            );
        }
        Ok(())
    })();
    match result {
        Ok(()) => set_runtime_setup(
            &state,
            SongPlayerRuntimeSetupStatus::Ready,
            100,
            "Runtime vocale pronto",
            None,
        ),
        Err(error) => set_runtime_setup(
            &state,
            SongPlayerRuntimeSetupStatus::Failed,
            0,
            "Installazione automatica non riuscita",
            Some(error),
        ),
    }
    state.runtime_setup_active.store(false, Ordering::Release);
}

#[tauri::command]
pub fn song_player_ensure_runtime(
    app: tauri::AppHandle,
    state: tauri::State<'_, SongPlayerState>,
) -> SongPlayerRuntimeSetup {
    if state
        .runtime_setup_active
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
    {
        set_runtime_setup(
            &state,
            SongPlayerRuntimeSetupStatus::Installing,
            1,
            "Avvio installazione automatica del motore vocale",
            None,
        );
        let owned = state.inner().clone();
        thread::spawn(move || install_song_player_runtime(app, owned));
    }
    state
        .runtime_setup
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

#[tauri::command]
pub fn song_player_get_runtime_setup(
    state: tauri::State<'_, SongPlayerState>,
) -> SongPlayerRuntimeSetup {
    state
        .runtime_setup
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone()
}

fn configure_worker_command(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Put the Python worker and every descendant in a dedicated process
        // group.  Cancellation can then terminate ffmpeg/ffprobe and yt-dlp
        // descendants atomically instead of leaving orphaned work behind.
        unsafe {
            command.pre_exec(|| {
                if libc::setpgid(0, 0) == -1 {
                    Err(std::io::Error::last_os_error())
                } else {
                    Ok(())
                }
            });
        }
    }
}

fn terminate_worker(child: &mut Child) {
    #[cfg(unix)]
    {
        // A negative pid addresses the process group whose id is the worker pid.
        // If the group has already disappeared, retain the portable fallback.
        let pid = child.id() as libc::pid_t;
        if pid > 0 && unsafe { libc::kill(-pid, libc::SIGKILL) } == 0 {
            return;
        }
    }
    #[cfg(windows)]
    {
        // `Child::kill` only targets Python on Windows; taskkill's /T option
        // provides the equivalent process-tree fallback when available.
        let pid = child.id().to_string();
        if Command::new("taskkill")
            .args(["/PID", &pid, "/T", "/F"])
            .status()
            .is_ok_and(|status| status.success())
        {
            return;
        }
    }
    let _ = child.kill();
}

pub fn shutdown(state: &SongPlayerState) {
    let pids = {
        let mut jobs = state.shared.jobs.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        jobs.values_mut().filter_map(|record| {
            record.cancel.store(true, Ordering::Release);
            if !record.snapshot.status.is_terminal() {
                record.snapshot.status = SongPlayerJobStatus::Cancelled;
                record.snapshot.message = Some("Job annullato al cambio modalità".into());
                record.snapshot.error = None;
                record.snapshot.updated_at_ms = now_ms();
            }
            record.process_id.take()
        }).collect::<Vec<_>>()
    };
    for pid in pids {
        #[cfg(unix)]
        unsafe { libc::kill(-(pid as libc::pid_t), libc::SIGKILL); }
        #[cfg(windows)]
        { let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).status(); }
    }
}

fn parse_capability_output(stdout: &[u8]) -> Result<Value, String> {
    if stdout.len() > MAX_STDOUT_BYTES {
        return Err("output capabilities troppo grande".into());
    }
    let mut result = None;
    for line in stdout
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
    {
        if line.len() > MAX_STDOUT_LINE_BYTES {
            return Err("riga capabilities troppo grande".into());
        }
        let value: Value = serde_json::from_slice(line).map_err(|error| error.to_string())?;
        if value.get("protocolVersion").and_then(Value::as_u64) != Some(PROTOCOL_VERSION.into()) {
            return Err("protocolVersion capabilities non valida".into());
        }
        if value.get("type").and_then(Value::as_str) == Some("result") {
            if result.is_some() {
                return Err("risultati capabilities multipli".into());
            }
            result = value.get("result").cloned();
        }
    }
    result.ok_or_else(|| "risultato capabilities assente".into())
}

#[tauri::command]
pub fn song_player_capabilities(app: tauri::AppHandle) -> SongPlayerCapabilities {
    let (python, worker) = match worker_paths(&app) {
        Ok(paths) => paths,
        Err(error) => return SongPlayerCapabilities::unavailable(false, false, error.to_string()),
    };
    let runtime_ready = python.is_file();
    let worker_ready = worker.is_file();
    if !runtime_ready || !worker_ready {
        return SongPlayerCapabilities::unavailable(
            runtime_ready,
            worker_ready,
            "Il runtime vocale verrà installato automaticamente al primo utilizzo".into(),
        );
    }
    let mut command = Command::new(&python);
    command
        .arg(&worker)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_worker_command(&mut command);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return SongPlayerCapabilities::unavailable(
                true,
                true,
                format!("avvio worker non riuscito: {error}"),
            )
        }
    };
    let request = b"{\"protocolVersion\":1,\"action\":\"capabilities\"}\n";
    if child
        .stdin
        .take()
        .and_then(|mut stdin| stdin.write_all(request).err())
        .is_some()
    {
        terminate_worker(&mut child);
        return SongPlayerCapabilities::unavailable(
            true,
            true,
            "stdin worker non disponibile".into(),
        );
    }
    let capability_started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if capability_started.elapsed() < CAPABILITIES_TIMEOUT => {
                thread::sleep(POLL_INTERVAL)
            }
            Ok(None) => {
                terminate_worker(&mut child);
                break;
            }
            Err(_) => {
                terminate_worker(&mut child);
                break;
            }
        }
    }
    let output = match child.wait_with_output() {
        Ok(output) => output,
        Err(error) => {
            return SongPlayerCapabilities::unavailable(
                true,
                true,
                format!("worker capabilities fallito: {error}"),
            )
        }
    };
    match parse_capability_output(&output.stdout) {
        Ok(result) => {
            let worker_succeeded = output.status.success();
            let worker_reported_ready = result.get("ready").and_then(Value::as_bool) == Some(true);
            SongPlayerCapabilities {
                protocol_version: PROTOCOL_VERSION,
                ready: worker_succeeded && worker_reported_ready,
                runtime_ready: true,
                worker_ready: true,
                features: result.get("features").cloned().unwrap_or_else(|| json!({})),
                dependencies: result
                    .get("dependencies")
                    .cloned()
                    .unwrap_or_else(|| json!({})),
                limits: result.get("limits").cloned().unwrap_or_else(|| json!({})),
                reason: if worker_succeeded && worker_reported_ready {
                    None
                } else {
                    Some("Dipendenze Song Player incomplete".into())
                },
            }
        }
        Err(reason) => SongPlayerCapabilities::unavailable(true, true, reason),
    }
}

fn app_storage_roots(app: &tauri::AppHandle) -> Result<(PathBuf, PathBuf), SongPlayerError> {
    let data_root = app
        .path()
        .app_local_data_dir()
        .map_err(|error| SongPlayerError::Io(std::io::Error::other(error.to_string())))?
        .join("song-player");
    let jobs = data_root.join("jobs");
    let library = data_root.join("library");
    fs::create_dir_all(&jobs)?;
    fs::create_dir_all(&library)?;
    Ok((fs::canonicalize(jobs)?, fs::canonicalize(library)?))
}

#[tauri::command]
pub fn song_player_start_job(
    request: SongPlayerStartRequest,
    state: tauri::State<'_, SongPlayerState>,
    app: tauri::AppHandle,
) -> Result<SongPlayerJob, SongPlayerError> {
    let validated = validate_start_request(request)?;
    if state.runtime_setup_active.load(Ordering::Acquire) {
        return Err(SongPlayerError::RuntimeUnavailable(
            "installazione automatica in corso".into(),
        ));
    }
    let (python, worker) = worker_paths(&app)?;
    if !python.is_file() || !worker.is_file() {
        return Err(SongPlayerError::RuntimeUnavailable(
            "installazione automatica necessaria".into(),
        ));
    }
    cleanup_expired_jobs(&state.shared, now_ms());
    if has_active_job(&state.shared) {
        return Err(SongPlayerError::ActiveJobLimit);
    }
    let (jobs_root, library_root) = app_storage_roots(&app)?;
    let job_id = next_job_id(&state.shared);
    let job_root = direct_child_directory(&jobs_root, &job_id)?;
    let payload = validated.worker_payload(&job_root, &library_root);
    let payload = serde_json::to_vec(&payload)
        .map_err(|error| SongPlayerError::InvalidRequest(error.to_string()))?;
    if payload.len() + 1 > MAX_REQUEST_BYTES {
        let _ = safe_remove_job_root(&jobs_root, &job_root, &job_id);
        return Err(SongPlayerError::InvalidRequest(
            "payload worker troppo grande".into(),
        ));
    }
    let timestamp = now_ms();
    let cancel = Arc::new(AtomicBool::new(false));
    let snapshot = SongPlayerJob {
        job_id: job_id.clone(),
        kind: validated.kind().into(),
        status: SongPlayerJobStatus::Queued,
        progress: 0.0,
        message: Some("Job in coda".into()),
        result: None,
        error: None,
        created_at_ms: timestamp,
        updated_at_ms: timestamp,
    };
    {
        let mut jobs = state
            .shared
            .jobs
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if jobs
            .values()
            .filter(|record| {
                record.worker_active
                    || !record.snapshot.status.is_terminal()
                    || record.process_id.is_some()
            })
            .count()
            >= MAX_ACTIVE_JOBS
        {
            drop(jobs);
            let _ = safe_remove_job_root(&jobs_root, &job_root, &job_id);
            return Err(SongPlayerError::ActiveJobLimit);
        }
        jobs.insert(
            job_id.clone(),
            JobRecord {
                snapshot: snapshot.clone(),
                cancel: Arc::clone(&cancel),
                job_root: job_root.clone(),
                jobs_root,
                process_id: None,
                worker_active: true,
            },
        );
    }
    let shared = Arc::clone(&state.shared);
    thread::spawn(move || run_job(shared, job_id, cancel, python, worker, payload, job_root));
    Ok(snapshot)
}

#[tauri::command(rename_all = "camelCase")]
pub fn song_player_get_job(
    job_id: String,
    state: tauri::State<'_, SongPlayerState>,
) -> Result<SongPlayerJob, SongPlayerError> {
    if !valid_job_id(&job_id) {
        return Err(SongPlayerError::InvalidRequest("jobId non valido".into()));
    }
    cleanup_expired_jobs(&state.shared, now_ms());
    let jobs = state
        .shared
        .jobs
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    jobs.get(&job_id)
        .map(|record| record.snapshot.clone())
        .ok_or(SongPlayerError::JobNotFound)
}

#[tauri::command(rename_all = "camelCase")]
pub fn song_player_cancel_job(
    job_id: String,
    state: tauri::State<'_, SongPlayerState>,
) -> Result<SongPlayerJob, SongPlayerError> {
    if !valid_job_id(&job_id) {
        return Err(SongPlayerError::InvalidRequest("jobId non valido".into()));
    }
    cleanup_expired_jobs(&state.shared, now_ms());
    let mut jobs = state
        .shared
        .jobs
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let record = jobs.get_mut(&job_id).ok_or(SongPlayerError::JobNotFound)?;
    if !record.snapshot.status.is_terminal() {
        record.cancel.store(true, Ordering::Release);
        record.snapshot.status = SongPlayerJobStatus::Cancelled;
        record.snapshot.message = Some("Job annullato".into());
        record.snapshot.error = None;
        record.snapshot.updated_at_ms = now_ms();
    }
    Ok(record.snapshot.clone())
}

enum ProcessMessage {
    Stdout(Result<Vec<u8>, String>),
    Stderr(String),
}

fn read_stdout(stdout: impl Read, sender: mpsc::Sender<ProcessMessage>) {
    let limited = stdout.take((MAX_STDOUT_BYTES + 1) as u64);
    let mut reader = BufReader::new(limited);
    let mut total = 0usize;
    loop {
        let mut line = Vec::new();
        match reader.read_until(b'\n', &mut line) {
            Ok(0) => break,
            Ok(read) => {
                total = total.saturating_add(read);
                if total > MAX_STDOUT_BYTES {
                    let _ = sender.send(ProcessMessage::Stdout(Err(
                        "stdout worker oltre 4 MiB".into()
                    )));
                    break;
                }
                if line.len() > MAX_STDOUT_LINE_BYTES {
                    let _ = sender.send(ProcessMessage::Stdout(Err(
                        "riga JSONL worker oltre 1 MiB".into(),
                    )));
                    break;
                }
                if sender.send(ProcessMessage::Stdout(Ok(line))).is_err() {
                    break;
                }
            }
            Err(error) => {
                let _ = sender.send(ProcessMessage::Stdout(Err(error.to_string())));
                break;
            }
        }
    }
}

fn read_stderr(stderr: impl Read, sender: mpsc::Sender<ProcessMessage>) {
    let mut bytes = Vec::new();
    let mut limited = stderr.take((MAX_STDERR_BYTES + 1) as u64);
    let initial_read = limited.read_to_end(&mut bytes);
    let mut remainder = limited.into_inner();
    let _ = std::io::copy(&mut remainder, &mut std::io::sink());
    let message = match initial_read {
        Ok(_) => {
            if bytes.len() > MAX_STDERR_BYTES {
                bytes.truncate(MAX_STDERR_BYTES);
                bytes.extend_from_slice(b"\n[stderr truncated]");
            }
            String::from_utf8_lossy(&bytes).trim().to_owned()
        }
        Err(error) => format!("lettura stderr fallita: {error}"),
    };
    let _ = sender.send(ProcessMessage::Stderr(message));
}

fn set_running(state: &SharedState, job_id: &str) -> bool {
    let mut jobs = state
        .jobs
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(record) = jobs.get_mut(job_id) else {
        return false;
    };
    if record.snapshot.status != SongPlayerJobStatus::Queued {
        return false;
    }
    record.snapshot.status = SongPlayerJobStatus::Running;
    record.snapshot.message = Some("Worker avviato".into());
    record.snapshot.updated_at_ms = now_ms();
    true
}

fn set_process_id(state: &SharedState, job_id: &str, process_id: Option<u32>) {
    let mut jobs = state
        .jobs
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(record) = jobs.get_mut(job_id) {
        record.process_id = process_id;
    }
}

fn set_worker_inactive(state: &SharedState, job_id: &str) {
    let mut jobs = state
        .jobs
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if let Some(record) = jobs.get_mut(job_id) {
        record.worker_active = false;
    }
}

struct WorkerLifecycleGuard {
    state: Arc<SharedState>,
    job_id: String,
}

impl Drop for WorkerLifecycleGuard {
    fn drop(&mut self) {
        set_worker_inactive(&self.state, &self.job_id);
    }
}

fn update_progress(state: &SharedState, job_id: &str, progress: f64, message: Option<&str>) {
    let mut jobs = state
        .jobs
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(record) = jobs.get_mut(job_id) else {
        return;
    };
    if record.snapshot.status != SongPlayerJobStatus::Running {
        return;
    }
    record.snapshot.progress = progress.clamp(record.snapshot.progress, 0.99);
    record.snapshot.message = message.map(|value| value.chars().take(512).collect());
    record.snapshot.updated_at_ms = now_ms();
}

fn finish_job(
    state: &SharedState,
    job_id: &str,
    status: SongPlayerJobStatus,
    result: Option<Value>,
    error: Option<String>,
) {
    let mut jobs = state
        .jobs
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let Some(record) = jobs.get_mut(job_id) else {
        return;
    };
    if record.snapshot.status == SongPlayerJobStatus::Cancelled {
        record.process_id = None;
        return;
    }
    if record.snapshot.status != SongPlayerJobStatus::Running || !status.is_terminal() {
        return;
    }
    record.snapshot.status = status;
    record.snapshot.progress = if status == SongPlayerJobStatus::Completed {
        1.0
    } else {
        record.snapshot.progress
    };
    record.snapshot.message = Some(
        match status {
            SongPlayerJobStatus::Completed => "Job completato",
            SongPlayerJobStatus::Failed => "Job non riuscito",
            SongPlayerJobStatus::Cancelled => "Job annullato",
            _ => unreachable!(),
        }
        .into(),
    );
    record.snapshot.result = result;
    record.snapshot.error = error.map(|value| value.chars().take(2_000).collect());
    record.snapshot.updated_at_ms = now_ms();
    record.process_id = None;
}

fn parse_worker_line(
    line: &[u8],
    state: &SharedState,
    job_id: &str,
    result: &mut Option<Value>,
    worker_error: &mut Option<String>,
) -> Result<(), String> {
    let value: Value = serde_json::from_slice(line).map_err(|error| error.to_string())?;
    if value.get("protocolVersion").and_then(Value::as_u64) != Some(PROTOCOL_VERSION.into()) {
        return Err("protocolVersion worker non valida".into());
    }
    match value.get("type").and_then(Value::as_str) {
        Some("progress") => {
            let progress = value
                .get("progress")
                .and_then(Value::as_f64)
                .ok_or_else(|| "progress worker non valido".to_string())?;
            if !progress.is_finite() || !(0.0..=1.0).contains(&progress) {
                return Err("progress worker fuori intervallo".into());
            }
            update_progress(
                state,
                job_id,
                progress,
                value.get("message").and_then(Value::as_str),
            );
        }
        Some("result") => {
            if result.is_some() {
                return Err("risultati worker multipli".into());
            }
            let payload = value
                .get("result")
                .cloned()
                .ok_or_else(|| "payload result assente".to_string())?;
            if !payload.is_object() {
                return Err("payload result non e un oggetto".into());
            }
            *result = Some(payload);
        }
        Some("error") => {
            let code = value
                .pointer("/error/code")
                .and_then(Value::as_str)
                .unwrap_or("worker_error");
            let message = value
                .pointer("/error/message")
                .and_then(Value::as_str)
                .unwrap_or("Errore worker non specificato");
            *worker_error = Some(format!("{code}: {message}"));
        }
        _ => return Err("tipo messaggio worker non supportato".into()),
    }
    Ok(())
}

fn child_exit(child: &mut Child) -> Result<Option<ExitStatus>, String> {
    child.try_wait().map_err(|error| error.to_string())
}

fn run_job(
    state: Arc<SharedState>,
    job_id: String,
    cancel: Arc<AtomicBool>,
    python: PathBuf,
    worker: PathBuf,
    mut payload: Vec<u8>,
    job_root: PathBuf,
) {
    let _lifecycle = WorkerLifecycleGuard {
        state: Arc::clone(&state),
        job_id: job_id.clone(),
    };
    if !set_running(&state, &job_id) {
        cleanup_staging(&job_root);
        return;
    }
    payload.push(b'\n');
    let mut command = Command::new(python);
    command
        .arg(worker)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_worker_command(&mut command);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            finish_job(
                &state,
                &job_id,
                SongPlayerJobStatus::Failed,
                None,
                Some(format!("Avvio worker fallito: {error}")),
            );
            cleanup_staging(&job_root);
            return;
        }
    };
    set_process_id(&state, &job_id, Some(child.id()));
    if let Some(mut stdin) = child.stdin.take() {
        if let Err(error) = stdin.write_all(&payload) {
            terminate_worker(&mut child);
            let _ = child.wait();
            finish_job(
                &state,
                &job_id,
                SongPlayerJobStatus::Failed,
                None,
                Some(format!("Invio richiesta worker fallito: {error}")),
            );
            cleanup_staging(&job_root);
            return;
        }
    } else {
        terminate_worker(&mut child);
        let _ = child.wait();
        finish_job(
            &state,
            &job_id,
            SongPlayerJobStatus::Failed,
            None,
            Some("stdin worker assente".into()),
        );
        cleanup_staging(&job_root);
        return;
    }

    let (sender, receiver) = mpsc::channel();
    if let Some(stdout) = child.stdout.take() {
        let sender = sender.clone();
        thread::spawn(move || read_stdout(stdout, sender));
    }
    if let Some(stderr) = child.stderr.take() {
        let sender = sender.clone();
        thread::spawn(move || read_stderr(stderr, sender));
    }
    drop(sender);

    let mut result = None;
    let mut worker_error = None;
    let mut protocol_error = None;
    let mut stderr_message = String::new();
    let started = Instant::now();
    let exit_status = loop {
        while let Ok(message) = receiver.try_recv() {
            match message {
                ProcessMessage::Stdout(Ok(line)) => {
                    if protocol_error.is_none() {
                        if let Err(error) = parse_worker_line(
                            &line,
                            &state,
                            &job_id,
                            &mut result,
                            &mut worker_error,
                        ) {
                            protocol_error = Some(error);
                        }
                    }
                }
                ProcessMessage::Stdout(Err(error)) => protocol_error = Some(error),
                ProcessMessage::Stderr(message) => stderr_message = message,
            }
        }
        if protocol_error.is_some() {
            terminate_worker(&mut child);
            break child.wait().ok();
        }
        if cancel.load(Ordering::Acquire) {
            terminate_worker(&mut child);
            let status = child.wait().ok();
            break status;
        }
        if started.elapsed() > MAX_JOB_RUNTIME {
            protocol_error = Some("Il job ha superato il limite di esecuzione".into());
            terminate_worker(&mut child);
            break child.wait().ok();
        }
        match child_exit(&mut child) {
            Ok(Some(status)) => break Some(status),
            Ok(None) => thread::sleep(POLL_INTERVAL),
            Err(error) => {
                protocol_error = Some(format!("Attesa worker fallita: {error}"));
                terminate_worker(&mut child);
                break child.wait().ok();
            }
        }
    };

    for message in receiver {
        match message {
            ProcessMessage::Stdout(Ok(line)) if protocol_error.is_none() => {
                if let Err(error) =
                    parse_worker_line(&line, &state, &job_id, &mut result, &mut worker_error)
                {
                    protocol_error = Some(error);
                }
            }
            ProcessMessage::Stdout(Err(error)) => protocol_error = Some(error),
            ProcessMessage::Stderr(message) => stderr_message = message,
            _ => {}
        }
    }
    set_process_id(&state, &job_id, None);
    if !cancel.load(Ordering::Acquire) {
        let succeeded = exit_status.is_some_and(|status| status.success());
        if succeeded && protocol_error.is_none() && worker_error.is_none() && result.is_some() {
            finish_job(
                &state,
                &job_id,
                SongPlayerJobStatus::Completed,
                result,
                None,
            );
        } else {
            let error = protocol_error
                .or(worker_error)
                .or_else(|| (!stderr_message.is_empty()).then_some(stderr_message))
                .unwrap_or_else(|| "Il worker e terminato senza risultato".into());
            finish_job(
                &state,
                &job_id,
                SongPlayerJobStatus::Failed,
                None,
                Some(error),
            );
        }
    }
    cleanup_staging(&job_root);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_ids_are_scoped_and_valid() {
        let state = SharedState::default();
        let first = next_job_id(&state);
        let second = next_job_id(&state);
        assert!(valid_job_id(&first));
        assert!(valid_job_id(&second));
        assert_ne!(first, second);
        assert!(!valid_job_id("../outside"));
    }

    #[test]
    fn automatic_runtime_setup_has_one_owner_and_publishable_progress() {
        let state = SongPlayerState::default();
        assert!(state
            .runtime_setup_active
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok());
        assert!(state
            .runtime_setup_active
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err());
        set_runtime_setup(
            &state,
            SongPlayerRuntimeSetupStatus::Installing,
            142,
            "Download modello",
            None,
        );
        let snapshot = state.runtime_setup.lock().unwrap().clone();
        assert_eq!(snapshot.status, SongPlayerRuntimeSetupStatus::Installing);
        assert_eq!(snapshot.progress, 100);
        assert_eq!(snapshot.message, "Download modello");
        state.runtime_setup_active.store(false, Ordering::Release);
    }

    #[test]
    fn managed_runtime_uses_platform_specific_venv_python_path() {
        let root = Path::new("/runtime");
        let path = venv_python(root);
        if cfg!(windows) {
            assert!(path.ends_with("Scripts/python.exe"));
        } else {
            assert!(path.ends_with("bin/python"));
        }
    }

    #[test]
    fn validates_local_media_canonically_and_rejects_mixed_requests() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let audio = directory.path().join("track.wav");
        fs::write(&audio, b"RIFF fixture").expect("audio fixture");
        assert_eq!(
            validate_local_media(&audio).expect("canonical"),
            fs::canonicalize(&audio).unwrap()
        );
        let text = directory.path().join("track.txt");
        fs::write(&text, b"fixture").unwrap();
        assert!(matches!(
            validate_local_media(&text),
            Err(SongPlayerError::UnsupportedMedia)
        ));

        let request = SongPlayerStartRequest::Download {
            youtube_url: "http://youtu.be/dQw4w9WgXcQ".into(),
        };
        assert!(validate_start_request(request).is_err());
    }

    #[test]
    fn serde_contract_is_camel_case_and_rejects_arbitrary_flags() {
        let request: SongPlayerStartRequest = serde_json::from_value(json!({
            "kind": "download",
            "youtubeUrl": "https://youtu.be/dQw4w9WgXcQ"
        }))
        .expect("camelCase request");
        assert!(matches!(
            validate_start_request(request),
            Ok(ValidatedRequest::Download { .. })
        ));
        assert!(serde_json::from_value::<SongPlayerStartRequest>(json!({
            "kind": "download",
            "youtubeUrl": "https://youtu.be/dQw4w9WgXcQ",
            "flags": ["--exec", "anything"]
        }))
        .is_err());
        assert!(serde_json::from_value::<SongPlayerStartRequest>(json!({
            "kind": "match",
            "referencePath": "/tmp/full.wav",
            "targetPath": "/tmp/fragment.wav",
            "fragmentHash": "ignored"
        }))
        .is_err());
        assert!(serde_json::from_value::<SongPlayerStartRequest>(json!({
            "kind": "analyze",
            "inputPath": "/tmp/fragment.wav",
            "sourceHash": "ignored"
        }))
        .is_err());
        let vocals: SongPlayerStartRequest = serde_json::from_value(json!({
            "kind": "separateVocals",
            "inputPath": "/tmp/full.wav"
        }))
        .expect("strict vocal separation request");
        assert!(matches!(
            vocals,
            SongPlayerStartRequest::SeparateVocals { .. }
        ));
        assert!(serde_json::from_value::<SongPlayerStartRequest>(json!({
            "kind": "separateVocals",
            "inputPath": "/tmp/full.wav",
            "targetPath": "/tmp/instrumental.wav"
        }))
        .is_err());
        let extraction: SongPlayerStartRequest = serde_json::from_value(json!({
            "kind": "extractAudio",
            "inputPath": "/tmp/source.mov"
        }))
        .expect("strict audio extraction request");
        assert!(matches!(
            extraction,
            SongPlayerStartRequest::ExtractAudio { .. }
        ));
        assert!(serde_json::from_value::<SongPlayerStartRequest>(json!({
            "kind": "extractAudio",
            "inputPath": "/tmp/source.mov",
            "outputPath": "/tmp/unsafe.wav"
        }))
        .is_err());
        let refinement: SongPlayerStartRequest = serde_json::from_value(json!({
            "kind": "refineAlignment",
            "sourcePath": "/tmp/source.wav",
            "targetPath": "/tmp/target.wav",
            "anchors": [{
                "id": "word-1",
                "cueIndex": 0,
                "sourceStart": 1.0,
                "sourceCenter": 1.1,
                "sourceEnd": 1.2,
                "targetStart": 1.02,
                "targetCenter": 1.12,
                "targetEnd": 1.22,
                "maxShiftMs": 50.0
            }]
        }))
        .expect("strict alignment refinement request");
        assert!(matches!(
            refinement,
            SongPlayerStartRequest::RefineAlignment { .. }
        ));
        assert!(serde_json::from_value::<SongPlayerStartRequest>(json!({
            "kind": "refineAlignment",
            "sourcePath": "/tmp/source.wav",
            "targetPath": "/tmp/target.wav",
            "anchors": [],
            "shellCommand": "anything"
        }))
        .is_err());
        let visual: SongPlayerStartRequest = serde_json::from_value(json!({
            "kind": "analyzeVisemes",
            "inputPath": "/tmp/source.mp4",
            "language": "en",
            "anchors": [{
                "id": "word-1",
                "text": "Fallen",
                "canonicalIndex": 0,
                "cueIndex": 0,
                "sourceStart": 1.0,
                "sourceCenter": 1.2,
                "sourceEnd": 1.5,
                "sourceConfidence": 0.4
            }]
        }))
        .expect("strict Auto-AVSR request");
        assert!(matches!(
            visual,
            SongPlayerStartRequest::AnalyzeVisemes { .. }
        ));
        assert!(serde_json::from_value::<SongPlayerStartRequest>(json!({
            "kind": "analyzeVisemes",
            "inputPath": "/tmp/source.mp4",
            "language": "en",
            "anchors": [],
            "shellCommand": "anything"
        }))
        .is_err());
        let transcription: SongPlayerStartRequest = serde_json::from_value(json!({
            "kind": "transcribeWords",
            "inputPath": "/tmp/source.wav",
            "language": "en",
            "model": "whisper-medium_timestamped",
            "startSeconds": 4.0,
            "endSeconds": 12.0
        }))
        .expect("strict Whisper word transcription request");
        assert!(matches!(
            transcription,
            SongPlayerStartRequest::TranscribeWords { .. }
        ));
        assert!(serde_json::from_value::<SongPlayerStartRequest>(json!({
            "kind": "transcribeWords",
            "inputPath": "/tmp/source.wav",
            "language": "en",
            "model": "whisper-medium_timestamped",
            "fallbackModel": "whisper-base_timestamped"
        }))
        .is_err());

        let snapshot = SongPlayerJob {
            job_id: "sp-123456789abc-1234-0".into(),
            kind: "download".into(),
            status: SongPlayerJobStatus::Completed,
            progress: 1.0,
            message: None,
            result: Some(json!({ "kind": "download" })),
            error: None,
            created_at_ms: 10,
            updated_at_ms: 20,
        };
        let serialized = serde_json::to_value(snapshot).expect("serialized job");
        assert_eq!(serialized["jobId"], "sp-123456789abc-1234-0");
        assert_eq!(serialized["status"], "completed");
        assert_eq!(serialized["createdAtMs"], 10);
        assert!(serialized.get("job_id").is_none());
    }

    #[test]
    fn worker_match_payload_contains_only_operational_paths() {
        let request = ValidatedRequest::Match {
            reference_path: PathBuf::from("/tmp/full.wav"),
            target_path: PathBuf::from("/tmp/fragment.wav"),
        };
        let payload = request.worker_payload(Path::new("/tmp/job"), Path::new("/tmp/library"));
        assert_eq!(payload["referencePath"], "/tmp/full.wav");
        assert_eq!(payload["targetPath"], "/tmp/fragment.wav");
        assert!(payload.get("fragmentHash").is_none());
        assert!(payload.get("fullTrackHash").is_none());
    }

    #[test]
    fn cleanup_only_removes_the_verified_direct_job_child() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let jobs = directory.path().join("jobs");
        fs::create_dir(&jobs).unwrap();
        let job_id = "sp-123456789abc-1234-0";
        let job = direct_child_directory(&jobs, job_id).expect("job root");
        fs::write(job.join("temporary"), b"data").unwrap();
        let sibling = directory.path().join("keep");
        fs::create_dir(&sibling).unwrap();
        assert!(!safe_remove_job_root(&jobs, &sibling, job_id));
        assert!(sibling.exists());
        assert!(safe_remove_job_root(&jobs, &job, job_id));
        assert!(!job.exists());
    }

    #[test]
    fn status_transitions_do_not_overwrite_cancellation() {
        let state = SharedState::default();
        let job_id = next_job_id(&state);
        let directory = tempfile::tempdir().unwrap();
        let jobs_root = directory.path().to_path_buf();
        let job_root = direct_child_directory(&jobs_root, &job_id).unwrap();
        let timestamp = now_ms();
        state.jobs.lock().unwrap().insert(
            job_id.clone(),
            JobRecord {
                snapshot: SongPlayerJob {
                    job_id: job_id.clone(),
                    kind: "analyze".into(),
                    status: SongPlayerJobStatus::Queued,
                    progress: 0.0,
                    message: None,
                    result: None,
                    error: None,
                    created_at_ms: timestamp,
                    updated_at_ms: timestamp,
                },
                cancel: Arc::new(AtomicBool::new(false)),
                job_root,
                jobs_root,
                process_id: None,
                worker_active: true,
            },
        );
        assert!(set_running(&state, &job_id));
        state
            .jobs
            .lock()
            .unwrap()
            .get_mut(&job_id)
            .unwrap()
            .snapshot
            .status = SongPlayerJobStatus::Cancelled;
        finish_job(
            &state,
            &job_id,
            SongPlayerJobStatus::Completed,
            Some(json!({ "unexpected": true })),
            None,
        );
        let jobs = state.jobs.lock().unwrap();
        assert_eq!(
            jobs[&job_id].snapshot.status,
            SongPlayerJobStatus::Cancelled
        );
        assert!(jobs[&job_id].snapshot.result.is_none());
    }

    #[test]
    fn active_job_cap_counts_running_processes_until_they_exit() {
        let state = SharedState::default();
        let directory = tempfile::tempdir().unwrap();
        let job_id = next_job_id(&state);
        let job_root = direct_child_directory(directory.path(), &job_id).unwrap();
        let timestamp = now_ms();
        state.jobs.lock().unwrap().insert(
            job_id.clone(),
            JobRecord {
                snapshot: SongPlayerJob {
                    job_id,
                    kind: "match".into(),
                    status: SongPlayerJobStatus::Cancelled,
                    progress: 0.0,
                    message: None,
                    result: None,
                    error: None,
                    created_at_ms: timestamp,
                    updated_at_ms: timestamp,
                },
                cancel: Arc::new(AtomicBool::new(true)),
                job_root,
                jobs_root: directory.path().to_path_buf(),
                process_id: Some(1234),
                worker_active: true,
            },
        );
        assert!(has_active_job(&state));
        state
            .jobs
            .lock()
            .unwrap()
            .values_mut()
            .next()
            .unwrap()
            .process_id = None;
        state
            .jobs
            .lock()
            .unwrap()
            .values_mut()
            .next()
            .unwrap()
            .worker_active = false;
        assert!(!has_active_job(&state));
    }

    #[test]
    fn cancellation_before_spawn_pid_keeps_lifecycle_slot_reserved() {
        let state = SharedState::default();
        let directory = tempfile::tempdir().unwrap();
        let job_id = next_job_id(&state);
        let job_root = direct_child_directory(directory.path(), &job_id).unwrap();
        let timestamp = now_ms();
        state.jobs.lock().unwrap().insert(
            job_id.clone(),
            JobRecord {
                snapshot: SongPlayerJob {
                    job_id: job_id.clone(),
                    kind: "analyze".into(),
                    status: SongPlayerJobStatus::Queued,
                    progress: 0.0,
                    message: None,
                    result: None,
                    error: None,
                    created_at_ms: timestamp,
                    updated_at_ms: timestamp,
                },
                cancel: Arc::new(AtomicBool::new(false)),
                job_root,
                jobs_root: directory.path().to_path_buf(),
                process_id: None,
                worker_active: true,
            },
        );
        {
            let mut jobs = state.jobs.lock().unwrap();
            let record = jobs.get_mut(&job_id).unwrap();
            record.cancel.store(true, Ordering::Release);
            record.snapshot.status = SongPlayerJobStatus::Cancelled;
        }
        // Cancellation can mark the snapshot terminal before run_job reaches
        // Command::spawn; the lifecycle flag still reserves the only slot.
        assert!(has_active_job(&state));
        set_worker_inactive(&state, &job_id);
        assert!(!has_active_job(&state));
    }
}
