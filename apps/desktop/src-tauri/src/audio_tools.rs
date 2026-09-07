use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const PROTOCOL_VERSION: u8 = 1;
const MAX_REFERENCE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_TEXT_CHARS: usize = 8_000;
const VOICE_EXTENSIONS: &[&str] = &["aac", "flac", "m4a", "mp3", "ogg", "opus", "wav", "webm"];
const LANGUAGES: &[&str] = &[
    "ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "it", "ja", "ko", "ms", "nl", "no",
    "pl", "pt", "ru", "sv", "sw", "tr", "zh",
];

#[derive(Debug, thiserror::Error)]
pub enum AudioToolsError {
    #[error("Richiesta Audio non valida: {0}")]
    InvalidRequest(String),
    #[error("Runtime Text to Speech non pronto: {0}")]
    RuntimeUnavailable(String),
    #[error("Un job Text to Speech è già in corso")]
    ActiveJob,
    #[error("Job Audio non trovato")]
    JobNotFound,
    #[error("Errore I/O Audio: {0}")]
    Io(#[from] std::io::Error),
}

impl Serialize for AudioToolsError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioRuntimeStatus {
    status: String,
    progress: u8,
    message: String,
    error: Option<String>,
    ready: bool,
}

impl Default for AudioRuntimeStatus {
    fn default() -> Self {
        Self {
            status: "idle".into(),
            progress: 0,
            message: "Chatterbox verrà installato al primo utilizzo".into(),
            error: None,
            ready: false,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioJob {
    job_id: String,
    status: String,
    progress: f64,
    message: String,
    result: Option<Value>,
    error: Option<String>,
}

struct JobRecord {
    snapshot: AudioJob,
    pid: Option<u32>,
}

#[derive(Clone, Default)]
pub struct AudioToolsState {
    runtime: Arc<Mutex<AudioRuntimeStatus>>,
    installing: Arc<AtomicBool>,
    installer_pid: Arc<Mutex<Option<u32>>>,
    jobs: Arc<Mutex<HashMap<String, JobRecord>>>,
    sequence: Arc<AtomicU64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SynthesizeRequest {
    reference_path: String,
    text: String,
    language: String,
    exaggeration: f64,
    cfg_weight: f64,
    temperature: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceProfile {
    id: String,
    name: String,
    path: String,
    created_at_ms: u64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
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
fn runtime_root(app: &tauri::AppHandle) -> Result<PathBuf, AudioToolsError> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| AudioToolsError::Io(std::io::Error::other(e.to_string())))?
        .join("audio/tts-runtime"))
}
fn data_root(app: &tauri::AppHandle) -> Result<PathBuf, AudioToolsError> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|e| AudioToolsError::Io(std::io::Error::other(e.to_string())))?
        .join("audio");
    fs::create_dir_all(&path)?;
    Ok(path)
}
fn resource_root(app: &tauri::AppHandle) -> Result<PathBuf, AudioToolsError> {
    let local = workspace_root().join("tools/audio");
    if local.join("worker.py").is_file() {
        return Ok(local);
    }
    let bundled = app
        .path()
        .resource_dir()
        .map_err(|e| AudioToolsError::Io(std::io::Error::other(e.to_string())))?
        .join("audio");
    if bundled.join("worker.py").is_file() {
        Ok(bundled)
    } else {
        Err(AudioToolsError::RuntimeUnavailable(
            "risorse Chatterbox mancanti".into(),
        ))
    }
}
fn python_command() -> Option<(String, Vec<String>)> {
    let mut values = vec![
        ("python3.11".into(), vec![]),
        ("python3".into(), vec![]),
        ("python".into(), vec![]),
    ];
    if cfg!(windows) {
        values.insert(0, ("py".into(), vec!["-3.11".into()]));
    }
    values.into_iter().find(|(program, prefix)| {
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
fn run(
    program: &str,
    prefix: &[String],
    args: &[String],
    state: &AudioToolsState,
) -> Result<(), String> {
    let mut command = Command::new(program);
    command
        .args(prefix)
        .args(args)
        .current_dir(workspace_root())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_child(&mut command);
    let child = command.spawn().map_err(|e| e.to_string())?;
    *state
        .installer_pid
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = Some(child.id());
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    *state
        .installer_pid
        .lock()
        .unwrap_or_else(|e| e.into_inner()) = None;
    if output.status.success() {
        Ok(())
    } else {
        let value = if output.stderr.is_empty() {
            &output.stdout
        } else {
            &output.stderr
        };
        Err(String::from_utf8_lossy(value)
            .chars()
            .rev()
            .take(4_000)
            .collect::<String>()
            .chars()
            .rev()
            .collect())
    }
}
fn set_runtime(
    state: &AudioToolsState,
    status: &str,
    progress: u8,
    message: &str,
    error: Option<String>,
) {
    *state.runtime.lock().unwrap_or_else(|e| e.into_inner()) = AudioRuntimeStatus {
        status: status.into(),
        progress,
        message: message.into(),
        error,
        ready: status == "ready",
    };
}
fn verify_worker(python: &Path, worker: &Path) -> bool {
    let mut child = match Command::new(python)
        .arg(worker)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
    {
        Ok(value) => value,
        Err(_) => return false,
    };
    if child
        .stdin
        .take()
        .and_then(|mut input| {
            input
                .write_all(b"{\"protocolVersion\":1,\"action\":\"capabilities\"}\n")
                .err()
        })
        .is_some()
    {
        let _ = child.kill();
        return false;
    }
    child.wait_with_output().is_ok_and(|output| {
        output.status.success()
            && String::from_utf8_lossy(&output.stdout).contains("\"ready\":true")
    })
}

#[tauri::command]
pub fn audio_ensure_tts_runtime(
    app: tauri::AppHandle,
    state: tauri::State<'_, AudioToolsState>,
) -> AudioRuntimeStatus {
    if state
        .installing
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_ok()
    {
        let owned = state.inner().clone();
        thread::spawn(move || {
            let result = (|| -> Result<(), String> {
                let root = runtime_root(&app).map_err(|e| e.to_string())?;
                let resources = resource_root(&app).map_err(|e| e.to_string())?;
                let python = venv_python(&root);
                if !python.is_file() {
                    set_runtime(
                        &owned,
                        "installing",
                        8,
                        "Creazione runtime isolato Chatterbox",
                        None,
                    );
                    fs::create_dir_all(root.parent().ok_or("percorso runtime non valido")?)
                        .map_err(|e| e.to_string())?;
                    let (program, prefix) =
                        python_command().ok_or("Python 3.11 non disponibile")?;
                    run(
                        &program,
                        &prefix,
                        &[
                            "-m".into(),
                            "venv".into(),
                            root.to_string_lossy().into_owned(),
                        ],
                        &owned,
                    )?;
                }
                let executable = python.to_string_lossy().into_owned();
                set_runtime(
                    &owned,
                    "installing",
                    25,
                    "Aggiornamento strumenti Python",
                    None,
                );
                run(
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
                    &owned,
                )?;
                set_runtime(
                    &owned,
                    "installing",
                    42,
                    "Installazione automatica Chatterbox Multilingual",
                    None,
                );
                run(
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
                    &owned,
                )?;
                set_runtime(
                    &owned,
                    "installing",
                    94,
                    "Verifica del motore Text to Speech",
                    None,
                );
                if !verify_worker(&python, &resources.join("worker.py")) {
                    return Err("Chatterbox non ha superato la verifica finale".into());
                }
                Ok(())
            })();
            match result {
                Ok(()) => set_runtime(
                    &owned,
                    "ready",
                    100,
                    "Chatterbox Multilingual pronto",
                    None,
                ),
                Err(error) => set_runtime(
                    &owned,
                    "failed",
                    0,
                    "Installazione Text to Speech non riuscita",
                    Some(error),
                ),
            }
            owned.installing.store(false, Ordering::Release);
        });
    }
    state
        .runtime
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

#[tauri::command]
pub fn audio_get_tts_runtime(state: tauri::State<'_, AudioToolsState>) -> AudioRuntimeStatus {
    state
        .runtime
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
}

fn validate_reference(path: &str) -> Result<PathBuf, AudioToolsError> {
    let source = Path::new(path);
    if !source.is_absolute() || source.is_symlink() || !source.is_file() {
        return Err(AudioToolsError::InvalidRequest(
            "voce di riferimento non valida".into(),
        ));
    }
    let source = fs::canonicalize(source)?;
    let metadata = fs::metadata(&source)?;
    if metadata.len() > MAX_REFERENCE_BYTES {
        return Err(AudioToolsError::InvalidRequest(
            "voce di riferimento oltre 256 MB".into(),
        ));
    }
    let extension = source
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| AudioToolsError::InvalidRequest("formato voce assente".into()))?;
    if !VOICE_EXTENSIONS.contains(&extension.as_str()) {
        return Err(AudioToolsError::InvalidRequest(
            "formato voce non supportato".into(),
        ));
    }
    Ok(source)
}

fn terminate_pid(pid: u32) {
    #[cfg(unix)]
    {
        let value = pid as libc::pid_t;
        unsafe {
            libc::kill(-value, libc::SIGKILL);
        }
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .status();
    }
}
fn configure_child(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
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

#[tauri::command]
pub fn audio_start_tts(
    request: SynthesizeRequest,
    app: tauri::AppHandle,
    state: tauri::State<'_, AudioToolsState>,
) -> Result<AudioJob, AudioToolsError> {
    if request.text.trim().is_empty()
        || request.text.len() > MAX_TEXT_CHARS
        || !LANGUAGES.contains(&request.language.as_str())
        || !(0.0..=1.0).contains(&request.exaggeration)
        || !(0.0..=1.0).contains(&request.cfg_weight)
        || !(0.05..=2.0).contains(&request.temperature)
    {
        return Err(AudioToolsError::InvalidRequest(
            "parametri sintesi non validi".into(),
        ));
    }
    let reference = validate_reference(&request.reference_path)?;
    let runtime = state
        .runtime
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone();
    if !runtime.ready {
        return Err(AudioToolsError::RuntimeUnavailable(
            runtime.error.unwrap_or(runtime.message),
        ));
    }
    let mut jobs = state.jobs.lock().unwrap_or_else(|e| e.into_inner());
    if jobs
        .values()
        .any(|job| job.snapshot.status == "queued" || job.snapshot.status == "running")
    {
        return Err(AudioToolsError::ActiveJob);
    }
    let id = format!(
        "audio-{}-{}",
        now_ms(),
        state.sequence.fetch_add(1, Ordering::Relaxed)
    );
    let root = data_root(&app)?.join("jobs").join(&id);
    fs::create_dir_all(&root)?;
    let snapshot = AudioJob {
        job_id: id.clone(),
        status: "queued".into(),
        progress: 0.0,
        message: "Sintesi in coda".into(),
        result: None,
        error: None,
    };
    jobs.insert(
        id.clone(),
        JobRecord {
            snapshot: snapshot.clone(),
            pid: None,
        },
    );
    drop(jobs);
    let owned = state.inner().clone();
    let resources = resource_root(&app)?;
    let python = venv_python(&runtime_root(&app)?);
    thread::spawn(move || {
        let payload = json!({"protocolVersion":PROTOCOL_VERSION,"action":"synthesizeSpeech","jobRoot":root,"referencePath":reference,"text":request.text,"language":request.language,"exaggeration":request.exaggeration,"cfgWeight":request.cfg_weight,"temperature":request.temperature});
        let mut command = Command::new(python);
        command
            .arg(resources.join("worker.py"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        configure_child(&mut command);
        let mut child = match command.spawn() {
            Ok(value) => value,
            Err(error) => {
                let mut jobs = owned.jobs.lock().unwrap_or_else(|e| e.into_inner());
                if let Some(job) = jobs.get_mut(&id) {
                    job.snapshot.status = "failed".into();
                    job.snapshot.error = Some(error.to_string());
                }
                return;
            }
        };
        {
            let mut jobs = owned.jobs.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(job) = jobs.get_mut(&id) {
                job.pid = Some(child.id());
                job.snapshot.status = "running".into();
                job.snapshot.message = "Avvio Chatterbox".into();
            }
        }
        let payload_line = format!("{}\n", payload);
        if child
            .stdin
            .take()
            .and_then(|mut input| input.write_all(payload_line.as_bytes()).err())
            .is_some()
        {
            let _ = child.kill();
        }
        let mut terminal: Option<Result<Value, String>> = None;
        if let Some(stdout) = child.stdout.take() {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Ok(value) = serde_json::from_str::<Value>(&line) {
                    if value.get("type").and_then(Value::as_str) == Some("progress") {
                        let mut jobs = owned.jobs.lock().unwrap_or_else(|e| e.into_inner());
                        if let Some(job) = jobs.get_mut(&id) {
                            job.snapshot.progress = value
                                .get("progress")
                                .and_then(Value::as_f64)
                                .unwrap_or(job.snapshot.progress);
                            job.snapshot.message = value
                                .get("message")
                                .and_then(Value::as_str)
                                .unwrap_or("Sintesi in corso")
                                .into();
                        }
                    } else if value.get("type").and_then(Value::as_str) == Some("result") {
                        terminal = Some(Ok(value.get("result").cloned().unwrap_or(Value::Null)));
                    } else if value.get("type").and_then(Value::as_str) == Some("error") {
                        terminal = Some(Err(value
                            .pointer("/error/message")
                            .and_then(Value::as_str)
                            .unwrap_or("Sintesi fallita")
                            .into()));
                    }
                }
            }
        }
        let status = child.wait();
        let mut jobs = owned.jobs.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(job) = jobs.get_mut(&id) {
            job.pid = None;
            if job.snapshot.status == "cancelled" {
                return;
            }
            match terminal {
                Some(Ok(result)) if status.is_ok_and(|s| s.success()) => {
                    job.snapshot.status = "completed".into();
                    job.snapshot.progress = 1.0;
                    job.snapshot.message = "Audio pronto".into();
                    job.snapshot.result = Some(result);
                }
                Some(Err(error)) => {
                    job.snapshot.status = "failed".into();
                    job.snapshot.error = Some(error);
                }
                _ => {
                    job.snapshot.status = "failed".into();
                    job.snapshot.error =
                        Some("Il worker Chatterbox è terminato senza un risultato valido".into());
                }
            }
        }
    });
    Ok(snapshot)
}

#[tauri::command(rename_all = "camelCase")]
pub fn audio_get_job(
    job_id: String,
    state: tauri::State<'_, AudioToolsState>,
) -> Result<AudioJob, AudioToolsError> {
    state
        .jobs
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&job_id)
        .map(|j| j.snapshot.clone())
        .ok_or(AudioToolsError::JobNotFound)
}

#[tauri::command(rename_all = "camelCase")]
pub fn audio_cancel_job(
    job_id: String,
    state: tauri::State<'_, AudioToolsState>,
) -> Result<AudioJob, AudioToolsError> {
    let mut jobs = state.jobs.lock().unwrap_or_else(|e| e.into_inner());
    let job = jobs.get_mut(&job_id).ok_or(AudioToolsError::JobNotFound)?;
    if let Some(pid) = job.pid {
        terminate_pid(pid);
    }
    job.snapshot.status = "cancelled".into();
    job.snapshot.message = "Sintesi annullata".into();
    Ok(job.snapshot.clone())
}

fn voice_directory(app: &tauri::AppHandle) -> Result<PathBuf, AudioToolsError> {
    let path = data_root(app)?.join("voices");
    fs::create_dir_all(&path)?;
    Ok(path)
}
#[tauri::command(rename_all = "camelCase")]
pub fn audio_save_voice(
    name: String,
    source_path: String,
    app: tauri::AppHandle,
) -> Result<VoiceProfile, AudioToolsError> {
    let clean = name.trim();
    if clean.is_empty() || clean.len() > 100 {
        return Err(AudioToolsError::InvalidRequest(
            "nome voce non valido".into(),
        ));
    }
    let source = validate_reference(&source_path)?;
    let id = format!("voice-{}", now_ms());
    let extension = source.extension().and_then(|e| e.to_str()).unwrap_or("wav");
    let root = voice_directory(&app)?;
    let target = root.join(format!("{id}.{extension}"));
    fs::copy(source, target.as_path())?;
    let profile = VoiceProfile {
        id: id.clone(),
        name: clean.into(),
        path: target.to_string_lossy().into_owned(),
        created_at_ms: now_ms(),
    };
    fs::write(
        root.join(format!("{id}.json")),
        serde_json::to_vec_pretty(&profile)
            .map_err(|e| AudioToolsError::InvalidRequest(e.to_string()))?,
    )?;
    Ok(profile)
}
#[tauri::command]
pub fn audio_list_voices(app: tauri::AppHandle) -> Result<Vec<VoiceProfile>, AudioToolsError> {
    let root = voice_directory(&app)?;
    let mut profiles = Vec::new();
    for entry in fs::read_dir(root)? {
        let path = entry?.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(bytes) = fs::read(&path) {
            if let Ok(value) = serde_json::from_slice::<VoiceProfile>(&bytes) {
                if Path::new(&value.path).is_file() {
                    profiles.push(value);
                }
            }
        }
    }
    profiles.sort_by_key(|p| std::cmp::Reverse(p.created_at_ms));
    Ok(profiles)
}
#[tauri::command(rename_all = "camelCase")]
pub fn audio_delete_voice(voice_id: String, app: tauri::AppHandle) -> Result<(), AudioToolsError> {
    if !voice_id.starts_with("voice-")
        || !voice_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err(AudioToolsError::InvalidRequest("id voce non valido".into()));
    }
    let root = voice_directory(&app)?;
    for entry in fs::read_dir(&root)? {
        let path = entry?.path();
        if path.file_stem().and_then(|v| v.to_str()) == Some(&voice_id) {
            fs::remove_file(path)?;
        }
    }
    Ok(())
}
#[tauri::command(rename_all = "camelCase")]
pub fn audio_copy_artifact(
    source_path: String,
    destination_path: String,
    app: tauri::AppHandle,
) -> Result<u64, AudioToolsError> {
    let source = fs::canonicalize(&source_path)?;
    let jobs = fs::canonicalize(data_root(&app)?.join("jobs"))?;
    let destination = Path::new(&destination_path);
    if !source.starts_with(&jobs)
        || !source.is_file()
        || !destination.is_absolute()
        || destination.is_symlink()
        || destination
            .extension()
            .and_then(|value| value.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref()
            != Some("wav")
    {
        return Err(AudioToolsError::InvalidRequest(
            "percorso export non valido".into(),
        ));
    }
    Ok(fs::copy(source, destination)?)
}

pub fn shutdown(state: &AudioToolsState) {
    if let Some(pid) = *state
        .installer_pid
        .lock()
        .unwrap_or_else(|e| e.into_inner())
    {
        terminate_pid(pid);
    }
    let jobs = state.jobs.lock().unwrap_or_else(|e| e.into_inner());
    for job in jobs.values() {
        if let Some(pid) = job.pid {
            terminate_pid(pid);
        }
    }
}
