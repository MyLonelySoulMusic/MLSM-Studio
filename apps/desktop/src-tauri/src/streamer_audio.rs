use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    ffi::{c_char, c_int, c_void, CStr, CString},
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::Duration,
};
use tauri::{Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use url::Url;

use crate::find_tool;

const AUDIO_EXTENSIONS: &[&str] = &[
    "wav", "mp3", "flac", "aiff", "aif", "aac", "m4a", "ogg", "opus", "wma",
];
const PCM_CHANNELS: u16 = 2;

#[derive(Debug, thiserror::Error)]
pub enum StreamerError {
    #[error("Percorso audio non valido")]
    InvalidPath,
    #[error("Formato audio non supportato")]
    UnsupportedFormat,
    #[error("FFmpeg o FFprobe non sono disponibili")]
    MissingAudioTool,
    #[error("Acquisizione audio non disponibile: {0}")]
    CaptureUnavailable(String),
    #[error("Impossibile analizzare l'audio: {0}")]
    Probe(String),
    #[error("URL Spotify o YouTube non valido")]
    InvalidProviderUrl,
    #[error("Servizio metadata non disponibile: {0}")]
    Metadata(String),
    #[error("Impossibile autorizzare il file audio selezionato: {0}")]
    AssetScope(String),
    #[error("Errore I/O: {0}")]
    Io(#[from] std::io::Error),
}

impl Serialize for StreamerError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamerDevice {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamerApplication {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_id: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamerCapabilities {
    pub platform: String,
    pub backend: String,
    pub system_audio: bool,
    pub application_capture: bool,
    pub output_devices: Vec<StreamerDevice>,
    pub applications: Vec<StreamerApplication>,
    pub input_devices: Vec<StreamerDevice>,
    pub permission: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl StreamerCapabilities {
    fn unavailable(reason: impl Into<String>) -> Self {
        Self {
            platform: std::env::consts::OS.into(),
            backend: "unavailable".into(),
            system_audio: false,
            application_capture: false,
            output_devices: vec![],
            applications: vec![],
            input_devices: vec![],
            permission: "unavailable".into(),
            reason: Some(reason.into()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum StreamerCaptureSource {
    System,
    Application { id: String },
    OutputDevice { id: String },
    InputDevice { id: String },
}

impl StreamerCaptureSource {
    fn native_parts(&self) -> (c_int, Option<&str>) {
        match self {
            Self::System => (0, None),
            Self::Application { id } => (1, Some(id)),
            Self::OutputDevice { id } => (2, Some(id)),
            Self::InputDevice { id } => (3, Some(id)),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamerCaptureSession {
    id: String,
    source: StreamerCaptureSource,
    status: &'static str,
    sample_rate: Option<u32>,
    channels: u16,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CaptureStatus<'a> {
    state: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'a str>,
}

struct CallbackContext {
    channel: tauri::ipc::Channel<tauri::ipc::Response>,
    app: tauri::AppHandle,
}

struct ActiveCapture {
    native_handle: usize,
    callback_context: usize,
}

#[derive(Default)]
pub struct StreamerCaptureState {
    active: Mutex<Option<ActiveCapture>>,
    permission_override: Mutex<Option<String>>,
}

unsafe extern "C" fn pcm_callback(
    context: *mut c_void,
    samples: *const f32,
    frames: usize,
    sample_rate: f32,
) {
    if context.is_null() || samples.is_null() || frames == 0 || !sample_rate.is_finite() {
        return;
    }
    let context = unsafe { &*(context.cast::<CallbackContext>()) };
    let sample_count = match frames.checked_mul(PCM_CHANNELS as usize) {
        Some(value) => value,
        None => return,
    };
    let input = unsafe { std::slice::from_raw_parts(samples, sample_count) };
    let mut packet = Vec::with_capacity(8 + input.len() * 4);
    packet.extend_from_slice(&sample_rate.to_le_bytes());
    packet.extend_from_slice(&(frames.min(u32::MAX as usize) as u32).to_le_bytes());
    for sample in input {
        packet.extend_from_slice(&sample.to_le_bytes());
    }
    let _ = context.channel.send(tauri::ipc::Response::new(packet));
}

unsafe extern "C" fn status_callback(context: *mut c_void, state: c_int, message: *const c_char) {
    if context.is_null() {
        return;
    }
    let context = unsafe { &*(context.cast::<CallbackContext>()) };
    let text = if message.is_null() {
        None
    } else {
        unsafe { CStr::from_ptr(message) }.to_str().ok()
    };
    let state = match state {
        0 => "active",
        1 => "stopped",
        _ => "error",
    };
    let _ = context.app.emit(
        "streamer-capture-status",
        CaptureStatus {
            state,
            message: text,
        },
    );
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
extern "C" {
    fn mlsm_streamer_capabilities_json() -> *mut c_char;
    fn mlsm_streamer_free_string(value: *mut c_char);
    fn mlsm_streamer_start(
        kind: c_int,
        identifier: *const c_char,
        pcm: unsafe extern "C" fn(*mut c_void, *const f32, usize, f32),
        status: unsafe extern "C" fn(*mut c_void, c_int, *const c_char),
        context: *mut c_void,
        error: *mut c_char,
        error_capacity: usize,
    ) -> *mut c_void;
    fn mlsm_streamer_stop(handle: *mut c_void);
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn native_capabilities() -> StreamerCapabilities {
    let pointer = unsafe { mlsm_streamer_capabilities_json() };
    if pointer.is_null() {
        return StreamerCapabilities::unavailable(
            "Il backend nativo non ha restituito le capacità",
        );
    }
    let result = unsafe { CStr::from_ptr(pointer) }
        .to_string_lossy()
        .into_owned();
    unsafe {
        mlsm_streamer_free_string(pointer);
    }
    serde_json::from_str(&result).unwrap_or_else(|error| {
        StreamerCapabilities::unavailable(format!("Risposta backend non valida: {error}"))
    })
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn native_capabilities() -> StreamerCapabilities {
    StreamerCapabilities::unavailable("La cattura nativa è disponibile solo su macOS e Windows")
}

#[tauri::command]
pub fn streamer_capabilities(
    state: tauri::State<'_, StreamerCaptureState>,
) -> StreamerCapabilities {
    let mut capabilities = native_capabilities();
    if let Ok(permission) = state.permission_override.lock() {
        if let Some(permission) = permission.as_ref() {
            capabilities.permission.clone_from(permission);
        }
    }
    capabilities
}

fn stop_active(state: &StreamerCaptureState) {
    let active = state.active.lock().ok().and_then(|mut value| value.take());
    if let Some(active) = active {
        #[cfg(any(target_os = "macos", target_os = "windows"))]
        unsafe {
            mlsm_streamer_stop(active.native_handle as *mut c_void);
        }
        unsafe {
            drop(Box::from_raw(
                active.callback_context as *mut CallbackContext,
            ));
        }
    }
}

#[tauri::command]
pub fn streamer_start_capture(
    app: tauri::AppHandle,
    state: tauri::State<'_, StreamerCaptureState>,
    source: StreamerCaptureSource,
    on_pcm: tauri::ipc::Channel<tauri::ipc::Response>,
) -> Result<StreamerCaptureSession, StreamerError> {
    stop_active(state.inner());
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (app, source, on_pcm);
        return Err(StreamerError::CaptureUnavailable(
            "piattaforma non supportata".into(),
        ));
    }
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let (kind, identifier) = source.native_parts();
        let identifier = identifier.map(CString::new).transpose().map_err(|_| {
            StreamerError::CaptureUnavailable("identificatore sorgente non valido".into())
        })?;
        let context = Box::new(CallbackContext {
            channel: on_pcm,
            app: app.clone(),
        });
        let raw_context = Box::into_raw(context);
        let mut error = vec![0_i8; 1024];
        let handle = unsafe {
            mlsm_streamer_start(
                kind,
                identifier
                    .as_ref()
                    .map_or(std::ptr::null(), |value| value.as_ptr()),
                pcm_callback,
                status_callback,
                raw_context.cast(),
                error.as_mut_ptr(),
                error.len(),
            )
        };
        if handle.is_null() {
            unsafe {
                drop(Box::from_raw(raw_context));
            }
            let message = unsafe { CStr::from_ptr(error.as_ptr()) }
                .to_string_lossy()
                .into_owned();
            if message.to_ascii_lowercase().contains("permission") {
                if let Ok(mut permission) = state.permission_override.lock() {
                    *permission = Some("denied".into());
                }
            }
            return Err(StreamerError::CaptureUnavailable(if message.is_empty() {
                "avvio fallito".into()
            } else {
                message
            }));
        }
        if let Ok(mut permission) = state.permission_override.lock() {
            *permission = Some("granted".into());
        }
        let id = format!("capture-{}", std::process::id());
        *state.active.lock().map_err(|_| {
            StreamerError::CaptureUnavailable("stato acquisizione non disponibile".into())
        })? = Some(ActiveCapture {
            native_handle: handle as usize,
            callback_context: raw_context as usize,
        });
        let _ = app.emit(
            "streamer-capture-status",
            CaptureStatus {
                state: "active",
                message: None,
            },
        );
        Ok(StreamerCaptureSession {
            id,
            source,
            status: "active",
            sample_rate: None,
            channels: PCM_CHANNELS,
        })
    }
}

#[tauri::command]
pub fn streamer_stop_capture(app: tauri::AppHandle, state: tauri::State<'_, StreamerCaptureState>) {
    stop_active(state.inner());
    let _ = app.emit(
        "streamer-capture-status",
        CaptureStatus {
            state: "stopped",
            message: None,
        },
    );
}

pub fn shutdown(state: &StreamerCaptureState) {
    stop_active(state);
}

#[tauri::command]
pub fn streamer_permission_settings() -> Result<(), StreamerError> {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut value = Command::new("open");
        value.arg("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
        value
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut value = Command::new("explorer.exe");
        value.arg("ms-settings:privacy-microphone");
        value
    };
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    return Err(StreamerError::CaptureUnavailable(
        "impostazioni permessi non disponibili".into(),
    ));
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    command.spawn().map(|_| ()).map_err(StreamerError::Io)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamerAudioFile {
    id: String,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    playback_path: Option<String>,
    file_name: String,
    title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    artist: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    album: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    artwork: Option<String>,
    duration: f64,
    sample_rate: u32,
    channels: u16,
    format: String,
    codec: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    bit_depth: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    bitrate: Option<u64>,
    file_size: u64,
}

fn validate_audio_file(path: &Path) -> Result<PathBuf, StreamerError> {
    if !path.is_absolute() {
        return Err(StreamerError::InvalidPath);
    }
    let canonical = fs::canonicalize(path).map_err(|_| StreamerError::InvalidPath)?;
    let extension = canonical
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or(StreamerError::UnsupportedFormat)?;
    if !canonical.is_file() || !AUDIO_EXTENSIONS.contains(&extension.as_str()) {
        return Err(StreamerError::UnsupportedFormat);
    }
    Ok(canonical)
}

fn tag<'a>(tags: &'a serde_json::Map<String, serde_json::Value>, name: &str) -> Option<&'a str> {
    tags.iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .and_then(|(_, value)| value.as_str())
        .filter(|value| !value.trim().is_empty())
}

fn extract_artwork(ffmpeg: &Path, path: &Path) -> Option<String> {
    let output = Command::new(ffmpeg)
        .args(["-v", "error", "-i"])
        .arg(path)
        .args([
            "-map",
            "0:v:0",
            "-frames:v",
            "1",
            "-f",
            "image2pipe",
            "-vcodec",
            "png",
            "pipe:1",
        ])
        .output()
        .ok()?;
    if !output.status.success()
        || output.stdout.is_empty()
        || output.stdout.len() > 10 * 1024 * 1024
    {
        return None;
    }
    Some(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(output.stdout)
    ))
}

fn playback_pcm_codec(bit_depth: Option<u16>) -> &'static str {
    match bit_depth {
        Some(17..=24) => "pcm_s24le",
        Some(25..) => "pcm_f32le",
        _ => "pcm_s16le",
    }
}

fn playback_transcode_args(codec: &'static str) -> [&'static str; 3] {
    ["-vn", "-acodec", codec]
}

fn cached_playback_wav(
    app: &tauri::AppHandle,
    ffmpeg: &Path,
    path: &Path,
    id: &str,
    bit_depth: Option<u16>,
) -> Result<Option<String>, StreamerError> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(
        extension.as_str(),
        "flac" | "aiff" | "aif" | "ogg" | "opus" | "wma"
    ) {
        return Ok(None);
    }
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|error| StreamerError::Probe(format!("cache audio non disponibile: {error}")))?
        .join("streamer-audio");
    fs::create_dir_all(&directory)?;
    let codec = playback_pcm_codec(bit_depth);
    let destination = directory.join(format!("{id}-{codec}.wav"));
    if !destination.is_file() {
        let output = Command::new(ffmpeg)
            .args(["-v", "error", "-y", "-i"])
            .arg(path)
            .args(playback_transcode_args(codec))
            .arg(&destination)
            .output()
            .map_err(|error| {
                StreamerError::Probe(format!("conversione playback fallita: {error}"))
            })?;
        if !output.status.success() {
            let _ = fs::remove_file(&destination);
            return Err(StreamerError::Probe(format!(
                "conversione playback fallita: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
    }
    Ok(Some(destination.to_string_lossy().into_owned()))
}

fn probe_file(app: &tauri::AppHandle, path: &Path) -> Result<StreamerAudioFile, StreamerError> {
    let path = validate_audio_file(path)?;
    let ffprobe = find_tool("ffprobe").ok_or(StreamerError::MissingAudioTool)?;
    let ffmpeg = find_tool("ffmpeg").ok_or(StreamerError::MissingAudioTool)?;
    let output = Command::new(ffprobe).args(["-v", "error", "-select_streams", "a:0", "-show_entries",
        "stream=codec_name,codec_long_name,sample_rate,channels,bits_per_sample,bits_per_raw_sample,bit_rate:format=format_name,duration,bit_rate:format_tags=title,artist,album",
        "-of", "json"]).arg(&path).output().map_err(|_| StreamerError::MissingAudioTool)?;
    if !output.status.success() {
        return Err(StreamerError::Probe(
            String::from_utf8_lossy(&output.stderr).trim().into(),
        ));
    }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| StreamerError::Probe(error.to_string()))?;
    let stream = value
        .get("streams")
        .and_then(|value| value.as_array())
        .and_then(|value| value.first())
        .ok_or_else(|| StreamerError::Probe("nessuna traccia audio".into()))?;
    let format = value
        .get("format")
        .and_then(|value| value.as_object())
        .ok_or_else(|| StreamerError::Probe("formato non disponibile".into()))?;
    let tags = format.get("tags").and_then(|value| value.as_object());
    let parse_u64 = |value: Option<&serde_json::Value>| {
        value
            .and_then(|value| value.as_str())
            .and_then(|value| value.parse::<u64>().ok())
    };
    let parse_u16 = |value: Option<&serde_json::Value>| {
        value
            .and_then(|value| value.as_u64().or_else(|| value.as_str()?.parse().ok()))
            .and_then(|value| u16::try_from(value).ok())
    };
    let sample_rate = parse_u64(stream.get("sample_rate"))
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| StreamerError::Probe("sample rate non disponibile".into()))?;
    let channels = parse_u16(stream.get("channels"))
        .ok_or_else(|| StreamerError::Probe("canali non disponibili".into()))?;
    let duration = format
        .get("duration")
        .and_then(|value| value.as_str())
        .and_then(|value| value.parse().ok())
        .unwrap_or(0.0);
    let metadata = fs::metadata(&path)?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok());
    let mut fingerprint = Sha256::new();
    fingerprint.update(path.to_string_lossy().as_bytes());
    fingerprint.update(metadata.len().to_le_bytes());
    if let Some(modified) = modified {
        fingerprint.update(modified.as_secs().to_le_bytes());
        fingerprint.update(modified.subsec_nanos().to_le_bytes());
    }
    let id = format!("{:x}", fingerprint.finalize());
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("audio")
        .to_owned();
    let title = tags
        .and_then(|tags| tag(tags, "title"))
        .map(str::to_owned)
        .unwrap_or_else(|| {
            path.file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("Audio")
                .to_owned()
        });
    let bit_depth = parse_u16(stream.get("bits_per_raw_sample"))
        .filter(|value| *value > 0)
        .or_else(|| parse_u16(stream.get("bits_per_sample")).filter(|value| *value > 0));
    let bitrate = parse_u64(stream.get("bit_rate")).or_else(|| parse_u64(format.get("bit_rate")));
    app.asset_protocol_scope()
        .allow_file(&path)
        .map_err(|error| StreamerError::AssetScope(error.to_string()))?;
    let playback_path = cached_playback_wav(app, &ffmpeg, &path, &id, bit_depth)?;
    if let Some(playback_path) = playback_path.as_ref() {
        app.asset_protocol_scope()
            .allow_file(playback_path)
            .map_err(|error| StreamerError::AssetScope(error.to_string()))?;
    }
    Ok(StreamerAudioFile {
        playback_path,
        id,
        path: path.to_string_lossy().into_owned(),
        file_name,
        title,
        artist: tags.and_then(|tags| tag(tags, "artist")).map(str::to_owned),
        album: tags.and_then(|tags| tag(tags, "album")).map(str::to_owned),
        artwork: extract_artwork(&ffmpeg, &path),
        duration,
        sample_rate,
        channels,
        format: format
            .get("format_name")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown")
            .to_owned(),
        codec: stream
            .get("codec_name")
            .and_then(|value| value.as_str())
            .unwrap_or("unknown")
            .to_owned(),
        bit_depth,
        bitrate,
        file_size: metadata.len(),
    })
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportProgress {
    completed: usize,
    total: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    file_name: Option<String>,
}

#[tauri::command]
pub async fn streamer_import_audio(
    app: tauri::AppHandle,
    paths: Option<Vec<String>>,
) -> Result<Vec<StreamerAudioFile>, StreamerError> {
    tauri::async_runtime::spawn_blocking(move || {
        let paths: Vec<PathBuf> = match paths {
            Some(paths) => paths.into_iter().map(PathBuf::from).collect(),
            None => app
                .dialog()
                .file()
                .add_filter("Audio", AUDIO_EXTENSIONS)
                .blocking_pick_files()
                .unwrap_or_default()
                .into_iter()
                .filter_map(|path| path.into_path().ok())
                .collect(),
        };
        let total = paths.len();
        let _ = app.emit(
            "streamer-import-progress",
            ImportProgress {
                completed: 0,
                total,
                file_name: None,
            },
        );
        let mut imported = Vec::with_capacity(total);
        for (index, path) in paths.iter().enumerate() {
            let item = probe_file(&app, path)?;
            let _ = app.emit(
                "streamer-import-progress",
                ImportProgress {
                    completed: index + 1,
                    total,
                    file_name: Some(item.file_name.clone()),
                },
            );
            imported.push(item);
        }
        Ok(imported)
    })
    .await
    .map_err(|error| StreamerError::Probe(format!("worker import interrotto: {error}")))?
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamerOEmbed {
    title: String,
    #[serde(skip_serializing_if = "Option::is_none", alias = "author_name")]
    author_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "thumbnail_url")]
    thumbnail_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "provider_name")]
    provider_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", alias = "provider_url")]
    provider_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    html: Option<String>,
}

fn oembed_endpoint(raw: &str) -> Result<Url, StreamerError> {
    let source = Url::parse(raw).map_err(|_| StreamerError::InvalidProviderUrl)?;
    if source.scheme() != "https" {
        return Err(StreamerError::InvalidProviderUrl);
    }
    let host = source.host_str().unwrap_or_default().to_ascii_lowercase();
    let endpoint = if matches!(host.as_str(), "open.spotify.com" | "play.spotify.com") {
        "https://open.spotify.com/oembed"
    } else if matches!(
        host.as_str(),
        "youtube.com" | "www.youtube.com" | "music.youtube.com" | "youtu.be"
    ) {
        "https://www.youtube.com/oembed"
    } else {
        return Err(StreamerError::InvalidProviderUrl);
    };
    let mut endpoint = Url::parse(endpoint).expect("static oEmbed URL");
    endpoint
        .query_pairs_mut()
        .append_pair("url", source.as_str())
        .append_pair("format", "json");
    Ok(endpoint)
}

#[tauri::command]
pub fn streamer_oembed(url: String) -> Result<StreamerOEmbed, StreamerError> {
    let endpoint = oembed_endpoint(&url)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("MLSM-Studio/0.1")
        .build()
        .map_err(|error| StreamerError::Metadata(error.to_string()))?;
    let response = client
        .get(endpoint)
        .send()
        .and_then(|value| value.error_for_status())
        .map_err(|error| StreamerError::Metadata(error.to_string()))?;
    if response
        .content_length()
        .is_some_and(|length| length > 1_048_576)
    {
        return Err(StreamerError::Metadata(
            "risposta metadata troppo grande".into(),
        ));
    }
    let body = response
        .bytes()
        .map_err(|error| StreamerError::Metadata(error.to_string()))?;
    if body.len() > 1_048_576 {
        return Err(StreamerError::Metadata(
            "risposta metadata troppo grande".into(),
        ));
    }
    let value: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|error| StreamerError::Metadata(error.to_string()))?;
    Ok(StreamerOEmbed {
        title: value
            .get("title")
            .and_then(|value| value.as_str())
            .unwrap_or("Streaming audio")
            .to_owned(),
        author_name: value
            .get("author_name")
            .and_then(|value| value.as_str())
            .map(str::to_owned),
        thumbnail_url: value
            .get("thumbnail_url")
            .and_then(|value| value.as_str())
            .map(str::to_owned),
        provider_name: value
            .get("provider_name")
            .and_then(|value| value.as_str())
            .map(str::to_owned),
        provider_url: value
            .get("provider_url")
            .and_then(|value| value.as_str())
            .map(str::to_owned),
        html: value
            .get("html")
            .and_then(|value| value.as_str())
            .map(str::to_owned),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packet_layout_is_little_endian_stereo_f32() {
        let rate = 48_000_f32;
        let frames = 2_u32;
        let samples = [0.25_f32, -0.25, 1.0, -1.0];
        let mut packet = Vec::new();
        packet.extend_from_slice(&rate.to_le_bytes());
        packet.extend_from_slice(&frames.to_le_bytes());
        for sample in samples {
            packet.extend_from_slice(&sample.to_le_bytes());
        }
        assert_eq!(f32::from_le_bytes(packet[0..4].try_into().unwrap()), rate);
        assert_eq!(u32::from_le_bytes(packet[4..8].try_into().unwrap()), frames);
        assert_eq!(packet.len(), 8 + 2 * 2 * 4);
    }

    #[test]
    fn oembed_only_accepts_official_provider_urls() {
        assert_eq!(
            oembed_endpoint("https://open.spotify.com/track/abc")
                .unwrap()
                .host_str(),
            Some("open.spotify.com")
        );
        assert_eq!(
            oembed_endpoint("https://music.youtube.com/watch?v=abc")
                .unwrap()
                .host_str(),
            Some("www.youtube.com")
        );
        assert!(oembed_endpoint("http://youtube.com/watch?v=abc").is_err());
        assert!(oembed_endpoint("https://youtube.com.evil.test/watch?v=abc").is_err());
    }

    #[test]
    fn capture_source_contract_uses_frontend_camel_case_tags() {
        let application: StreamerCaptureSource = serde_json::from_value(serde_json::json!({
            "kind": "application", "id": "com.spotify.client"
        }))
        .unwrap();
        assert!(
            matches!(application, StreamerCaptureSource::Application { id } if id == "com.spotify.client")
        );
        let output: StreamerCaptureSource = serde_json::from_value(serde_json::json!({
            "kind": "outputDevice", "id": "endpoint-id"
        }))
        .unwrap();
        assert!(
            matches!(output, StreamerCaptureSource::OutputDevice { id } if id == "endpoint-id")
        );
        assert!(
            serde_json::from_value::<StreamerCaptureSource>(serde_json::json!({
                "kind": "application"
            }))
            .is_err()
        );
    }

    #[test]
    fn capabilities_contract_serializes_expected_field_names() {
        let serialized =
            serde_json::to_value(StreamerCapabilities::unavailable("fixture")).unwrap();
        assert_eq!(serialized["systemAudio"], false);
        assert_eq!(serialized["applicationCapture"], false);
        assert!(serialized.get("outputDevices").is_some());
        assert!(serialized.get("inputDevices").is_some());
    }

    #[test]
    fn playback_wav_preserves_high_precision_sources() {
        assert_eq!(playback_pcm_codec(Some(16)), "pcm_s16le");
        assert_eq!(playback_pcm_codec(Some(24)), "pcm_s24le");
        assert_eq!(playback_pcm_codec(Some(32)), "pcm_f32le");
        assert_eq!(playback_pcm_codec(None), "pcm_s16le");
        assert_eq!(
            playback_transcode_args(playback_pcm_codec(Some(24))),
            ["-vn", "-acodec", "pcm_s24le"]
        );
    }
}
