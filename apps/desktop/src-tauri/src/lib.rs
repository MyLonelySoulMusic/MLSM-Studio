use atomicwrites::{AllowOverwrite, AtomicFile};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::Manager;

mod memory;
mod song_player;
mod audio_tools;
mod studio_settings;

#[derive(Debug, thiserror::Error)]
enum ProjectIoError {
    #[error("Il percorso del progetto non è valido")]
    InvalidPath,
    #[error("Impossibile leggere o scrivere il progetto: {0}")]
    Io(#[from] std::io::Error),
    #[error("Il formato audio non è supportato. Seleziona un file MP3 o WAV")]
    UnsupportedAudio,
    #[error("FFmpeg o FFprobe non sono disponibili")]
    MissingAudioTool,
    #[error("Impossibile analizzare l'audio: {0}")]
    AudioProbe(String),
    #[error("La cartella di destinazione batch non è valida")]
    InvalidUpscalerBatchDirectory,
    #[error("Il nome file batch deve essere un basename PNG valido")]
    InvalidUpscalerBatchFilename,
    #[error("Il payload PNG batch è vuoto")]
    EmptyUpscalerBatchPayload,
    #[error("Il payload batch non contiene una firma PNG valida")]
    InvalidUpscalerBatchPayload,
    #[error("Il payload PNG batch supera il limite di 512 MB")]
    UpscalerBatchPayloadTooLarge,
    #[error("Il percorso del video Upscaler non è valido")]
    InvalidUpscalerVideoPath,
    #[error("Servizio Upscaler locale non avviabile: {0}")]
    UpscalerRuntime(String),
    #[error("Servizio AutoPost locale non avviabile: {0}")]
    AutoPostRuntime(String),
}

#[derive(Default)]
struct UpscalerServiceState {
    child: Mutex<Option<Child>>,
}

#[derive(Default)]
struct AutoPostServiceState { child: Mutex<Option<Child>> }

impl AutoPostServiceState {
    fn shutdown(&self) {
        if let Ok(mut child) = self.child.lock() {
            if let Some(mut process) = child.take() { terminate_upscaler_child(&mut process); }
        }
    }
}

impl Drop for AutoPostServiceState {
    fn drop(&mut self) {
        if let Ok(child) = self.child.get_mut() {
            if let Some(mut process) = child.take() { terminate_upscaler_child(&mut process); }
        }
    }
}

fn terminate_upscaler_child(process: &mut Child) {
    #[cfg(unix)]
    {
        // Give Uvicorn a bounded graceful shutdown window. Its shutdown hook
        // terminates/reaps active ffmpeg workers before the Python process exits.
        let _ = Command::new("kill")
            .args(["-TERM", &process.id().to_string()])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            match process.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => std::thread::sleep(Duration::from_millis(50)),
                Err(_) => break,
            }
        }
    }
    let _ = process.kill();
    // Reap synchronously: closing MLSM must not leave a zombie or a live
    // backend listening on 8765 after the application has gone away.
    let _ = process.wait();
}

impl UpscalerServiceState {
    fn shutdown(&self) {
        if let Ok(mut child) = self.child.lock() {
            if let Some(mut process) = child.take() {
                terminate_upscaler_child(&mut process);
            }
        }
    }
}

impl Drop for UpscalerServiceState {
    fn drop(&mut self) {
        if let Ok(child) = self.child.get_mut() {
            if let Some(mut process) = child.take() {
                terminate_upscaler_child(&mut process);
            }
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpscalerServiceStatus {
    running: bool,
    started: bool,
    pid: Option<u32>,
}

fn upscaler_port_is_open() -> bool {
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 8765);
    TcpStream::connect_timeout(&address, Duration::from_millis(150)).is_ok()
}

fn autopost_port_is_open() -> bool {
    let address = SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 1430);
    TcpStream::connect_timeout(&address, Duration::from_millis(150)).is_ok()
}

fn autopost_server_from(start: &Path) -> Option<PathBuf> {
    start.ancestors().map(|root| root.join("tools/autopost/server.mjs")).find(|path| path.is_file())
}

#[tauri::command]
fn ensure_autopost_service(app: tauri::AppHandle, state: tauri::State<'_, AutoPostServiceState>) -> Result<UpscalerServiceStatus, ProjectIoError> {
    let mut child = state.child.lock().map_err(|_| ProjectIoError::AutoPostRuntime("stato del processo non disponibile".into()))?;
    if let Some(process) = child.as_mut() {
        match process.try_wait() {
            Ok(None) => return Ok(UpscalerServiceStatus { running: true, started: false, pid: Some(process.id()) }),
            Ok(Some(_)) => { *child = None; }
            Err(error) => return Err(ProjectIoError::AutoPostRuntime(error.to_string())),
        }
    }
    // The Vite development plugin or the standalone legacy app may already own
    // the service. Reuse it without ever terminating a process we did not start.
    if autopost_port_is_open() {
        return Ok(UpscalerServiceStatus { running: true, started: false, pid: None });
    }
    let bundled = app.path().resource_dir().ok().map(|root| root.join("autopost/server.mjs"));
    let source = std::env::current_dir().ok().and_then(|root| autopost_server_from(&root))
        .or_else(|| autopost_server_from(Path::new(env!("CARGO_MANIFEST_DIR"))));
    let server = bundled.filter(|path| path.is_file()).or(source).ok_or_else(|| ProjectIoError::AutoPostRuntime("server.mjs non trovato nell’installazione".into()))?;
    let node = find_tool("node").ok_or_else(|| ProjectIoError::AutoPostRuntime("Node.js 20 o successivo non è disponibile".into()))?;
    let process = Command::new(node).arg(&server).current_dir(server.parent().unwrap_or(Path::new("."))).env("MLSM_AUTOPOST_PORT", "1430").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map_err(|error| ProjectIoError::AutoPostRuntime(error.to_string()))?;
    let pid = process.id();
    *child = Some(process);
    Ok(UpscalerServiceStatus { running: false, started: true, pid: Some(pid) })
}

fn upscaler_runtime_from(start: &Path) -> Option<(PathBuf, PathBuf, PathBuf)> {
    for root in start.ancestors() {
        let server = root.join("tools/upscaler_server.py");
        let python = if cfg!(windows) {
            root.join(".venv/Scripts/python.exe")
        } else {
            root.join(".venv/bin/python")
        };
        if server.is_file() && python.is_file() {
            return Some((root.to_path_buf(), python, server));
        }
    }
    None
}

fn find_upscaler_runtime() -> Option<(PathBuf, PathBuf, PathBuf)> {
    let mut starts = Vec::new();
    if let Ok(directory) = std::env::current_dir() { starts.push(directory); }
    starts.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")));
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() { starts.push(parent.to_path_buf()); }
    }
    starts.iter().find_map(|start| upscaler_runtime_from(start))
}

#[tauri::command]
fn ensure_upscaler_service(
    state: tauri::State<'_, UpscalerServiceState>,
) -> Result<UpscalerServiceStatus, ProjectIoError> {
    let mut child = state.child.lock().map_err(|_| {
        ProjectIoError::UpscalerRuntime("stato del processo non disponibile".into())
    })?;
    if let Some(process) = child.as_mut() {
        match process.try_wait() {
            Ok(None) => return Ok(UpscalerServiceStatus {
                running: false, started: false, pid: Some(process.id()),
            }),
            Ok(Some(_)) => { *child = None; }
            Err(error) => return Err(ProjectIoError::UpscalerRuntime(error.to_string())),
        }
    }
    if upscaler_port_is_open() {
        return Err(ProjectIoError::UpscalerRuntime(
            "la porta 8765 è occupata da un processo non posseduto da questa istanza; MLSM non lo adotterà né lo lascerà attivo alla chiusura".into(),
        ));
    }
    let (root, python, server) = find_upscaler_runtime().ok_or_else(|| {
        ProjectIoError::UpscalerRuntime(
            "runtime .venv o tools/upscaler_server.py non trovati nell'installazione".into(),
        )
    })?;
    let process = Command::new(python)
        .arg(server)
        .current_dir(root)
        .env("PYTHONUNBUFFERED", "1")
        .env("MLSM_UPSCALER_PARENT_PID", std::process::id().to_string())
        .env("MLSM_UPSCALER_OWNER_KIND", "tauri")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| ProjectIoError::UpscalerRuntime(error.to_string()))?;
    let pid = process.id();
    *child = Some(process);
    Ok(UpscalerServiceStatus { running: false, started: true, pid: Some(pid) })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioMetadata {
    path: String,
    file_name: String,
    hash: String,
    duration_seconds: f64,
    sample_rate: u32,
    channels: u16,
    codec: String,
    file_size: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct WaveformData {
    sample_rate: u32,
    peaks: Vec<f32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioToolStatus {
    ffmpeg: bool,
    ffprobe: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpscalerHardwareStatus {
    platform: String,
    architecture: String,
    apple_silicon: bool,
    cuda: bool,
    gpu_name: Option<String>,
}

#[tauri::command]
fn detect_upscaler_hardware() -> UpscalerHardwareStatus {
    let architecture = std::env::consts::ARCH.to_owned();
    let apple_silicon = cfg!(target_os = "macos") && architecture == "aarch64";
    let nvidia = find_tool("nvidia-smi")
        .and_then(|tool| {
            Command::new(tool)
                .args(["--query-gpu=name", "--format=csv,noheader"])
                .output()
                .ok()
        })
        .filter(|output| output.status.success());
    let gpu_name = nvidia
        .as_ref()
        .and_then(|output| String::from_utf8(output.stdout.clone()).ok())
        .and_then(|value| {
            value
                .lines()
                .next()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned)
        });
    UpscalerHardwareStatus {
        platform: std::env::consts::OS.to_owned(),
        architecture,
        apple_silicon,
        cuda: nvidia.is_some(),
        gpu_name,
    }
}

fn validate_audio_path(path: &Path) -> Result<PathBuf, ProjectIoError> {
    if !path.is_absolute() || !path.is_file() { return Err(ProjectIoError::InvalidPath); }
    match path.extension().and_then(|value| value.to_str()).map(str::to_ascii_lowercase).as_deref() {
        Some("mp3" | "wav") => Ok(path.to_path_buf()),
        _ => Err(ProjectIoError::UnsupportedAudio),
    }
}

fn find_tool(name: &str) -> Option<PathBuf> {
    let executable = if cfg!(windows) { format!("{name}.exe") } else { name.to_owned() };
    if let Some(paths) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&paths) { let candidate = directory.join(&executable); if candidate.is_file() { return Some(candidate); } }
    }
    ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"].iter().map(|directory| Path::new(directory).join(&executable)).find(|candidate| candidate.is_file())
}

fn tool_available(name: &str) -> bool {
    find_tool(name).and_then(|path| Command::new(path).arg("-version").output().ok()).is_some_and(|output| output.status.success())
}

#[tauri::command]
fn detect_audio_tools() -> AudioToolStatus {
    AudioToolStatus { ffmpeg: tool_available("ffmpeg"), ffprobe: tool_available("ffprobe") }
}

#[tauri::command]
fn probe_audio(path: String) -> Result<AudioMetadata, ProjectIoError> {
    let path = validate_audio_path(Path::new(&path))?;
    let ffprobe = find_tool("ffprobe").ok_or(ProjectIoError::MissingAudioTool)?;
    let output = Command::new(ffprobe).args([
        "-v", "error", "-select_streams", "a:0", "-show_entries",
        "stream=codec_name,sample_rate,channels:format=duration", "-of", "json"
    ]).arg(&path).output().map_err(|_| ProjectIoError::MissingAudioTool)?;
    if !output.status.success() { return Err(ProjectIoError::AudioProbe(String::from_utf8_lossy(&output.stderr).trim().to_owned())); }
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).map_err(|error| ProjectIoError::AudioProbe(error.to_string()))?;
    let stream = value.get("streams").and_then(|streams| streams.as_array()).and_then(|streams| streams.first()).ok_or_else(|| ProjectIoError::AudioProbe("nessuna traccia audio trovata".into()))?;
    let duration_seconds = value.pointer("/format/duration").and_then(|duration| duration.as_str()).and_then(|duration| duration.parse().ok()).ok_or_else(|| ProjectIoError::AudioProbe("durata non disponibile".into()))?;
    let sample_rate = stream.get("sample_rate").and_then(|rate| rate.as_str()).and_then(|rate| rate.parse().ok()).ok_or_else(|| ProjectIoError::AudioProbe("sample rate non disponibile".into()))?;
    let channels = stream.get("channels").and_then(|channels| channels.as_u64()).and_then(|channels| u16::try_from(channels).ok()).ok_or_else(|| ProjectIoError::AudioProbe("numero canali non disponibile".into()))?;
    let mut source = fs::File::open(&path)?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop { let read = source.read(&mut buffer)?; if read == 0 { break; } hash.update(&buffer[..read]); }
    Ok(AudioMetadata {
        path: path.to_string_lossy().into_owned(), file_name: path.file_name().and_then(|name| name.to_str()).unwrap_or("audio").to_owned(),
        hash: format!("{:x}", hash.finalize()), duration_seconds, sample_rate, channels,
        codec: stream.get("codec_name").and_then(|codec| codec.as_str()).unwrap_or("unknown").to_owned(), file_size: fs::metadata(path)?.len(),
    })
}

#[tauri::command]
fn generate_waveform(path: String, points: usize) -> Result<WaveformData, ProjectIoError> {
    let path = validate_audio_path(Path::new(&path))?;
    let point_count = points.clamp(256, 8192);
    let ffmpeg = find_tool("ffmpeg").ok_or(ProjectIoError::MissingAudioTool)?;
    let output = Command::new(ffmpeg).args(["-v", "error", "-i"]).arg(&path).args(["-vn", "-ac", "1", "-ar", "2000", "-f", "f32le", "pipe:1"]).output().map_err(|_| ProjectIoError::MissingAudioTool)?;
    if !output.status.success() { return Err(ProjectIoError::AudioProbe(String::from_utf8_lossy(&output.stderr).trim().to_owned())); }
    let samples: Vec<f32> = output.stdout.chunks_exact(4).map(|bytes| f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]).clamp(-1.0, 1.0)).collect();
    if samples.is_empty() { return Ok(WaveformData { sample_rate: 2_000, peaks: vec![] }); }
    let bucket_size = samples.len().div_ceil(point_count);
    let mut peaks = Vec::with_capacity(point_count * 2);
    for bucket in samples.chunks(bucket_size) {
        let (minimum, maximum) = bucket.iter().fold((1.0_f32, -1.0_f32), |(minimum, maximum), sample| (minimum.min(*sample), maximum.max(*sample)));
        peaks.extend([minimum, maximum]);
    }
    Ok(WaveformData { sample_rate: 2_000, peaks })
}

#[tauri::command]
fn read_audio_data(path: String) -> Result<tauri::ipc::Response, ProjectIoError> {
    let path = validate_audio_path(Path::new(&path))?;
    const MAX_PREVIEW_BYTES: u64 = 512 * 1024 * 1024;
    if fs::metadata(&path)?.len() > MAX_PREVIEW_BYTES { return Err(ProjectIoError::AudioProbe("file troppo grande per la preview in memoria (limite 512 MB)".into())); }
    Ok(tauri::ipc::Response::new(fs::read(path)?))
}

fn validate_upscaler_batch_directory(path: &Path) -> Result<PathBuf, ProjectIoError> {
    if !path.is_absolute() || !path.is_dir() { return Err(ProjectIoError::InvalidUpscalerBatchDirectory); }
    let canonical = fs::canonicalize(path).map_err(|_| ProjectIoError::InvalidUpscalerBatchDirectory)?;
    if canonical.is_dir() { Ok(canonical) } else { Err(ProjectIoError::InvalidUpscalerBatchDirectory) }
}

fn validate_upscaler_batch_filename(filename: &str) -> Result<(), ProjectIoError> {
    let path = Path::new(filename);
    let is_basename = !filename.is_empty() && !filename.contains('/') && !filename.contains('\\') && path.file_name().and_then(|value| value.to_str()) == Some(filename);
    let is_png = path.extension().and_then(|value| value.to_str()).is_some_and(|value| value.eq_ignore_ascii_case("png"));
    if is_basename && is_png { Ok(()) } else { Err(ProjectIoError::InvalidUpscalerBatchFilename) }
}

const PNG_SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_UPSCALER_BATCH_PAYLOAD_BYTES: usize = 512 * 1024 * 1024;

fn validate_upscaler_batch_payload_size(payload_len: usize) -> Result<(), ProjectIoError> {
    if payload_len > MAX_UPSCALER_BATCH_PAYLOAD_BYTES { Err(ProjectIoError::UpscalerBatchPayloadTooLarge) } else { Ok(()) }
}

fn validate_upscaler_batch_payload(payload: &[u8]) -> Result<(), ProjectIoError> {
    if payload.is_empty() { return Err(ProjectIoError::EmptyUpscalerBatchPayload); }
    validate_upscaler_batch_payload_size(payload.len())?;
    if !payload.starts_with(&PNG_SIGNATURE) { return Err(ProjectIoError::InvalidUpscalerBatchPayload); }
    Ok(())
}

#[tauri::command]
fn write_upscaler_batch_image(directory_path: String, filename: String, payload: Vec<u8>) -> Result<String, ProjectIoError> {
    let directory = validate_upscaler_batch_directory(Path::new(&directory_path))?;
    validate_upscaler_batch_filename(&filename)?;
    validate_upscaler_batch_payload(&payload)?;
    let path = Path::new(&filename);
    let stem = path.file_stem().and_then(|value| value.to_str()).ok_or(ProjectIoError::InvalidUpscalerBatchFilename)?;
    let extension = path.extension().and_then(|value| value.to_str()).unwrap_or("png");
    for suffix in 0_u32..100_000 {
        let candidate_name = if suffix == 0 { filename.clone() } else { format!("{stem}-{suffix}.{extension}") };
        let candidate = directory.join(candidate_name);
        let mut file = match fs::OpenOptions::new().write(true).create_new(true).open(&candidate) {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(ProjectIoError::Io(error)),
        };
        let result = (|| -> Result<(), std::io::Error> { file.write_all(&payload)?; file.sync_all() })();
        if let Err(error) = result { let _ = fs::remove_file(&candidate); return Err(ProjectIoError::Io(error)); }
        return Ok(candidate.to_string_lossy().into_owned());
    }
    Err(ProjectIoError::Io(std::io::Error::new(std::io::ErrorKind::AlreadyExists, "troppi file con lo stesso nome")))
}

fn validate_upscaler_video_path(path: &Path, must_exist: bool) -> Result<PathBuf, ProjectIoError> {
    if !path.is_absolute() || path.extension().and_then(|value| value.to_str()).is_none_or(|value| !value.eq_ignore_ascii_case("mp4")) {
        return Err(ProjectIoError::InvalidUpscalerVideoPath);
    }
    if must_exist {
        let canonical = fs::canonicalize(path).map_err(|_| ProjectIoError::InvalidUpscalerVideoPath)?;
        if !canonical.is_file() || canonical.file_name().and_then(|value| value.to_str()) != Some("upscaled-video.mp4") {
            return Err(ProjectIoError::InvalidUpscalerVideoPath);
        }
        Ok(canonical)
    } else if path.file_name().is_some() {
        Ok(path.to_path_buf())
    } else {
        Err(ProjectIoError::InvalidUpscalerVideoPath)
    }
}

#[tauri::command]
fn copy_upscaler_video_result(source_path: String, destination_path: String) -> Result<u64, ProjectIoError> {
    let source = validate_upscaler_video_path(Path::new(&source_path), true)?;
    let destination = validate_upscaler_video_path(Path::new(&destination_path), false)?;
    let expected_bytes = fs::metadata(&source)?.len();
    if expected_bytes == 0 { return Err(ProjectIoError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, "il video Upscaler sorgente è vuoto"))); }
    let mut input = fs::File::open(source)?;
    let destination_for_audit = destination.clone();
    let copied_bytes = AtomicFile::new(destination, AllowOverwrite).write(|output| {
        let copied = std::io::copy(&mut input, output)?;
        output.sync_all()?;
        Ok(copied)
    }).map_err(|error| match error {
        atomicwrites::Error::Internal(error) | atomicwrites::Error::User(error) => ProjectIoError::Io(error),
    })?;
    let saved_bytes = fs::metadata(destination_for_audit)?.len();
    if copied_bytes != expected_bytes || saved_bytes != expected_bytes {
        return Err(ProjectIoError::Io(std::io::Error::new(std::io::ErrorKind::WriteZero, "copia MP4 incompleta")));
    }
    Ok(saved_bytes)
}

impl serde::Serialize for ProjectIoError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: serde::Serializer { serializer.serialize_str(&self.to_string()) }
}

fn validate_project_path(path: &Path) -> Result<PathBuf, ProjectIoError> {
    if !path.is_absolute() || path.file_name().is_none() { return Err(ProjectIoError::InvalidPath); }
    let name = path.file_name().and_then(|value| value.to_str()).ok_or(ProjectIoError::InvalidPath)?;
    if !(name.ends_with(".rbs.json") || name.ends_with(".json")) { return Err(ProjectIoError::InvalidPath); }
    Ok(path.to_path_buf())
}

#[tauri::command]
fn read_project(path: String) -> Result<String, ProjectIoError> {
    let path = validate_project_path(Path::new(&path))?;
    Ok(fs::read_to_string(path)?)
}

#[tauri::command]
fn write_project(path: String, content: String) -> Result<(), ProjectIoError> {
    let destination = validate_project_path(Path::new(&path))?;
    serde_json::from_str::<serde_json::Value>(&content).map_err(|error| ProjectIoError::Io(std::io::Error::new(std::io::ErrorKind::InvalidData, error)))?;
    AtomicFile::new(destination, AllowOverwrite).write(|file| {
        file.write_all(content.as_bytes())?;
        file.sync_all()
    }).map_err(|error| match error {
        atomicwrites::Error::Internal(error) | atomicwrites::Error::User(error) => ProjectIoError::Io(error),
    })?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(song_player::SongPlayerState::default())
        .manage(audio_tools::AudioToolsState::default())
        .manage(UpscalerServiceState::default())
        .manage(AutoPostServiceState::default())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_project,
            write_project,
            detect_audio_tools,
            detect_upscaler_hardware,
            ensure_upscaler_service,
            ensure_autopost_service,
            probe_audio,
            generate_waveform,
            read_audio_data,
            write_upscaler_batch_image,
            copy_upscaler_video_result,
            memory::memory_scan_paths,
            memory::memory_read_preview,
            memory::memory_read_text_preview,
            memory::memory_copy_entries,
            song_player::song_player_capabilities,
            song_player::song_player_ensure_runtime,
            song_player::song_player_get_runtime_setup,
            song_player::song_player_start_job,
            song_player::song_player_get_job,
            song_player::song_player_cancel_job
            ,audio_tools::audio_ensure_tts_runtime
            ,audio_tools::audio_get_tts_runtime
            ,audio_tools::audio_start_tts
            ,studio_settings::studio_settings
            ,audio_tools::audio_get_job
            ,audio_tools::audio_cancel_job
            ,audio_tools::audio_save_voice
            ,audio_tools::audio_list_voices
            ,audio_tools::audio_delete_voice
            ,audio_tools::audio_copy_artifact
        ])
        .build(tauri::generate_context!())
        .expect("errore durante l'avvio di MLSM Studio");
    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit) {
            app_handle.state::<UpscalerServiceState>().shutdown();
            app_handle.state::<AutoPostServiceState>().shutdown();
            audio_tools::shutdown(app_handle.state::<audio_tools::AudioToolsState>().inner());
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_relative_and_wrong_extension_paths() {
        assert!(validate_project_path(Path::new("relative.rbs.json")).is_err());
        assert!(validate_project_path(Path::new("/tmp/project.txt")).is_err());
    }

    #[test]
    fn rejects_unsupported_audio_extensions() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("track.txt");
        fs::write(&path, b"not audio").expect("fixture");
        assert!(matches!(validate_audio_path(&path), Err(ProjectIoError::UnsupportedAudio)));
    }

    #[test]
    fn writes_batch_png_with_collision_suffix_and_validates_inputs() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let first_payload = [PNG_SIGNATURE.as_slice(), &[1, 2, 3]].concat();
        let second_payload = [PNG_SIGNATURE.as_slice(), &[4, 5]].concat();
        let path = write_upscaler_batch_image(directory.path().to_string_lossy().into_owned(), "photo.png".into(), first_payload.clone()).expect("first batch image");
        let second = write_upscaler_batch_image(directory.path().to_string_lossy().into_owned(), "photo.png".into(), second_payload.clone()).expect("collision batch image");
        assert_eq!(fs::read(path).expect("first payload"), first_payload);
        assert_eq!(fs::read(second).expect("second payload"), second_payload);
        assert!(validate_upscaler_batch_filename("../photo.png").is_err());
        assert!(write_upscaler_batch_image(directory.path().to_string_lossy().into_owned(), "empty.png".into(), vec![]).is_err());
        assert!(matches!(validate_upscaler_batch_payload(b"not a png"), Err(ProjectIoError::InvalidUpscalerBatchPayload)));
        assert!(MAX_UPSCALER_BATCH_PAYLOAD_BYTES > 7680 * 7680 * 4);
        assert!(matches!(validate_upscaler_batch_payload_size(MAX_UPSCALER_BATCH_PAYLOAD_BYTES + 1), Err(ProjectIoError::UpscalerBatchPayloadTooLarge)));
    }

    #[test]
    fn atomically_overwrites_a_project() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("project.rbs.json");
        write_project(path.to_string_lossy().into_owned(), "{\"version\":1}".into()).expect("first save");
        write_project(path.to_string_lossy().into_owned(), "{\"version\":2}".into()).expect("overwrite");
        assert_eq!(fs::read_to_string(path).expect("saved file"), "{\"version\":2}");
    }

    #[test]
    fn copies_a_completed_upscaler_video_to_the_chosen_mp4() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let workspace = directory.path().join("job"); fs::create_dir(&workspace).expect("workspace");
        let source = workspace.join("upscaled-video.mp4"); let destination = directory.path().join("export.mp4");
        fs::write(&source, b"verified mp4 fixture").expect("source video");
        let copied = copy_upscaler_video_result(source.to_string_lossy().into_owned(), destination.to_string_lossy().into_owned()).expect("copy result");
        assert_eq!(copied, b"verified mp4 fixture".len() as u64);
        assert_eq!(fs::read(destination).expect("exported video"), b"verified mp4 fixture");
        assert!(copy_upscaler_video_result(workspace.join("other.mp4").to_string_lossy().into_owned(), directory.path().join("bad.mp4").to_string_lossy().into_owned()).is_err());
        fs::write(&source, b"").expect("empty source fixture");
        assert!(copy_upscaler_video_result(source.to_string_lossy().into_owned(), directory.path().join("empty.mp4").to_string_lossy().into_owned()).is_err());
        assert!(validate_upscaler_video_path(Path::new("relative.mp4"), false).is_err());
    }

    #[test]
    fn resolves_the_project_upscaler_runtime_from_nested_directories() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let root = directory.path();
        let nested = root.join("apps/desktop/src-tauri");
        fs::create_dir_all(&nested).expect("nested fixture");
        let server = root.join("tools/upscaler_server.py");
        fs::create_dir_all(server.parent().expect("tools directory")).expect("tools fixture");
        fs::write(&server, b"# fixture").expect("server fixture");
        let python = if cfg!(windows) { root.join(".venv/Scripts/python.exe") } else { root.join(".venv/bin/python") };
        fs::create_dir_all(python.parent().expect("venv directory")).expect("venv fixture");
        fs::write(&python, b"fixture").expect("python fixture");
        assert_eq!(upscaler_runtime_from(&nested), Some((root.to_path_buf(), python, server)));
    }

    #[cfg(unix)]
    #[test]
    fn upscaler_state_terminates_and_reaps_its_owned_child() {
        let process = Command::new("sh")
            .args(["-c", "sleep 30"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("child fixture");
        let state = UpscalerServiceState { child: Mutex::new(Some(process)) };
        state.shutdown();
        assert!(state.child.lock().expect("state lock").is_none());
    }

    fn write_test_wav(path: &Path) {
        let sample_rate = 8_000_u32; let sample_count = 800_u32; let data_size = sample_count * 2; let mut wav = Vec::new();
        wav.extend(b"RIFF"); wav.extend((36 + data_size).to_le_bytes()); wav.extend(b"WAVEfmt "); wav.extend(16_u32.to_le_bytes());
        wav.extend(1_u16.to_le_bytes()); wav.extend(1_u16.to_le_bytes()); wav.extend(sample_rate.to_le_bytes()); wav.extend((sample_rate * 2).to_le_bytes());
        wav.extend(2_u16.to_le_bytes()); wav.extend(16_u16.to_le_bytes()); wav.extend(b"data"); wav.extend(data_size.to_le_bytes());
        for index in 0..sample_count { let sample = if index % 80 < 4 { i16::MAX / 2 } else { 0 }; wav.extend(sample.to_le_bytes()); }
        fs::write(path, wav).expect("wav fixture");
    }

    #[test]
    fn probes_and_generates_a_waveform() {
        assert!(tool_available("ffmpeg") && tool_available("ffprobe"), "FFmpeg test prerequisite");
        let directory = tempfile::tempdir().expect("temporary directory"); let path = directory.path().join("click.wav"); write_test_wav(&path);
        let metadata = probe_audio(path.to_string_lossy().into_owned()).expect("audio metadata");
        assert_eq!(metadata.sample_rate, 8_000); assert_eq!(metadata.channels, 1); assert!(metadata.duration_seconds > 0.09);
        let waveform = generate_waveform(path.to_string_lossy().into_owned(), 256).expect("waveform");
        assert!(!waveform.peaks.is_empty()); assert!(waveform.peaks.iter().any(|peak| *peak > 0.1));
    }
}
