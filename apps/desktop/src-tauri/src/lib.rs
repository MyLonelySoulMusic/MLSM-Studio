use atomicwrites::{AllowOverwrite, AtomicFile};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{fs, io::{Read, Write}, path::{Path, PathBuf}, process::Command};

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
    tauri::Builder::default().plugin(tauri_plugin_dialog::init()).invoke_handler(tauri::generate_handler![
        read_project,
        write_project,
        detect_audio_tools,
        detect_upscaler_hardware,
        probe_audio,
        generate_waveform,
        read_audio_data
    ]).run(tauri::generate_context!()).expect("errore durante l'avvio di MLSM Studio");
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
    fn atomically_overwrites_a_project() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("project.rbs.json");
        write_project(path.to_string_lossy().into_owned(), "{\"version\":1}".into()).expect("first save");
        write_project(path.to_string_lossy().into_owned(), "{\"version\":2}".into()).expect("overwrite");
        assert_eq!(fs::read_to_string(path).expect("saved file"), "{\"version\":2}");
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
