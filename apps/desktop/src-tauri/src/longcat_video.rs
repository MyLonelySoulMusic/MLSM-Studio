use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;

const PROTOCOL_VERSION: u8 = 1;
const PINNED_REVISION: &str = "6b3f4b8582a8bc3f20f795735f5383716c4ba794";
const MAX_ACTIVE_JOBS: usize = 1;
const MAX_REQUEST_BYTES: usize = 64 * 1024;
const MAX_INPUT_BYTES: u64 = 4 * 1024 * 1024 * 1024;
const MAX_STDOUT_LINE_BYTES: usize = 1024 * 1024;
const MAX_STDERR_BYTES: usize = 128 * 1024;
const JOB_TIMEOUT: Duration = Duration::from_secs(12 * 60 * 60);

#[derive(Debug, thiserror::Error)]
pub enum LongCatVideoError {
    #[error("Richiesta LongCat-Video non valida: {0}")]
    InvalidRequest(String),
    #[error("Il runtime LongCat-Video non è pronto: {0}")]
    RuntimeUnavailable(String),
    #[error("Un job LongCat-Video è già attivo")]
    ActiveJob,
    #[error("Job LongCat-Video non trovato")]
    JobNotFound,
    #[error("Errore I/O LongCat-Video: {0}")]
    Io(#[from] std::io::Error),
}

impl Serialize for LongCatVideoError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "mode", rename_all = "camelCase", deny_unknown_fields)]
pub enum LongCatVideoStartRequest {
    TextToVideo {
        prompt: String,
        #[serde(rename = "negativePrompt")]
        negative_prompt: String,
        #[serde(rename = "outputDirectory")]
        output_directory: String,
        width: u32,
        height: u32,
        #[serde(rename = "numFrames")]
        num_frames: u32,
        #[serde(rename = "numInferenceSteps")]
        num_inference_steps: u32,
        #[serde(rename = "guidanceScale")]
        guidance_scale: f64,
        seed: u32,
        #[serde(rename = "useDistill")]
        use_distill: bool,
        #[serde(rename = "enableCompile")]
        enable_compile: bool,
    },
    ImageToVideo {
        prompt: String,
        #[serde(rename = "negativePrompt")]
        negative_prompt: String,
        #[serde(rename = "outputDirectory")]
        output_directory: String,
        #[serde(rename = "inputPath")]
        input_path: String,
        resolution: String,
        #[serde(rename = "numFrames")]
        num_frames: u32,
        #[serde(rename = "numInferenceSteps")]
        num_inference_steps: u32,
        #[serde(rename = "guidanceScale")]
        guidance_scale: f64,
        seed: u32,
        #[serde(rename = "useDistill")]
        use_distill: bool,
        #[serde(rename = "enableCompile")]
        enable_compile: bool,
    },
    VideoContinuation {
        prompt: String,
        #[serde(rename = "negativePrompt")]
        negative_prompt: String,
        #[serde(rename = "outputDirectory")]
        output_directory: String,
        #[serde(rename = "inputPath")]
        input_path: String,
        resolution: String,
        #[serde(rename = "numFrames")]
        num_frames: u32,
        #[serde(rename = "numCondFrames")]
        num_cond_frames: u32,
        #[serde(rename = "numInferenceSteps")]
        num_inference_steps: u32,
        #[serde(rename = "guidanceScale")]
        guidance_scale: f64,
        seed: u32,
        #[serde(rename = "useDistill")]
        use_distill: bool,
        #[serde(rename = "enableCompile")]
        enable_compile: bool,
    },
}

#[derive(Debug)]
struct ValidatedRequest {
    mode: &'static str,
    output_directory: PathBuf,
    input_path: Option<PathBuf>,
    payload: Value,
}

fn validate_common(
    prompt: &str,
    negative: &str,
    frames: u32,
    steps: u32,
    guidance: f64,
    use_distill: bool,
) -> Result<(), LongCatVideoError> {
    if prompt.trim().is_empty()
        || prompt.len() > 4_000
        || negative.len() > 4_000
        || prompt
            .chars()
            .chain(negative.chars())
            .any(|value| value.is_control() && value != '\n' && value != '\t')
    {
        return Err(LongCatVideoError::InvalidRequest(
            "prompt non valido".into(),
        ));
    }
    if !(5..=257).contains(&frames) || !(frames - 1).is_multiple_of(4) {
        return Err(LongCatVideoError::InvalidRequest(
            "numFrames deve rispettare (n - 1) divisibile per 4".into(),
        ));
    }
    if !(1..=100).contains(&steps) || !guidance.is_finite() || !(0.0..=20.0).contains(&guidance) {
        return Err(LongCatVideoError::InvalidRequest(
            "step o guidance fuori intervallo".into(),
        ));
    }
    if use_distill && (steps != 16 || (guidance - 1.0).abs() > f64::EPSILON) {
        return Err(LongCatVideoError::InvalidRequest(
            "il profilo distilled richiede 16 step e guidance 1".into(),
        ));
    }
    Ok(())
}

fn canonical_directory(value: &str) -> Result<PathBuf, LongCatVideoError> {
    let path = Path::new(value);
    if !path.is_absolute() || !path.is_dir() || path.is_symlink() {
        return Err(LongCatVideoError::InvalidRequest(
            "cartella di output non valida".into(),
        ));
    }
    fs::canonicalize(path).map_err(LongCatVideoError::Io)
}

fn canonical_input(value: &str, extensions: &[&str]) -> Result<PathBuf, LongCatVideoError> {
    let path = Path::new(value);
    if !path.is_absolute() || !path.is_file() || path.is_symlink() {
        return Err(LongCatVideoError::InvalidRequest(
            "sorgente locale non valida".into(),
        ));
    }
    if fs::metadata(path)?.len() > MAX_INPUT_BYTES {
        return Err(LongCatVideoError::InvalidRequest(
            "sorgente oltre 4 GiB".into(),
        ));
    }
    let extension = path
        .extension()
        .and_then(|item| item.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();
    if !extensions.contains(&extension.as_str()) {
        return Err(LongCatVideoError::InvalidRequest(
            "formato sorgente non supportato".into(),
        ));
    }
    fs::canonicalize(path).map_err(LongCatVideoError::Io)
}

fn validate_request(
    request: LongCatVideoStartRequest,
) -> Result<ValidatedRequest, LongCatVideoError> {
    match request {
        LongCatVideoStartRequest::TextToVideo {
            prompt,
            negative_prompt,
            output_directory,
            width,
            height,
            num_frames,
            num_inference_steps,
            guidance_scale,
            seed,
            use_distill,
            enable_compile,
        } => {
            validate_common(
                &prompt,
                &negative_prompt,
                num_frames,
                num_inference_steps,
                guidance_scale,
                use_distill,
            )?;
            if !(256..=1280).contains(&width)
                || !(256..=1280).contains(&height)
                || width % 16 != 0
                || height % 16 != 0
            {
                return Err(LongCatVideoError::InvalidRequest(
                    "dimensioni non valide".into(),
                ));
            }
            Ok(ValidatedRequest {
                mode: "textToVideo",
                output_directory: canonical_directory(&output_directory)?,
                input_path: None,
                payload: json!({ "prompt": prompt.trim(), "negativePrompt": negative_prompt.trim(), "width": width, "height": height, "numFrames": num_frames, "numInferenceSteps": num_inference_steps, "guidanceScale": guidance_scale, "seed": seed, "useDistill": use_distill, "enableCompile": enable_compile }),
            })
        }
        LongCatVideoStartRequest::ImageToVideo {
            prompt,
            negative_prompt,
            output_directory,
            input_path,
            resolution,
            num_frames,
            num_inference_steps,
            guidance_scale,
            seed,
            use_distill,
            enable_compile,
        } => {
            validate_common(
                &prompt,
                &negative_prompt,
                num_frames,
                num_inference_steps,
                guidance_scale,
                use_distill,
            )?;
            if resolution != "480p" && resolution != "720p" {
                return Err(LongCatVideoError::InvalidRequest(
                    "risoluzione non valida".into(),
                ));
            }
            let input = canonical_input(&input_path, &["png", "jpg", "jpeg", "webp"])?;
            Ok(ValidatedRequest {
                mode: "imageToVideo",
                output_directory: canonical_directory(&output_directory)?,
                input_path: Some(input.clone()),
                payload: json!({ "prompt": prompt.trim(), "negativePrompt": negative_prompt.trim(), "inputPath": input, "resolution": resolution, "numFrames": num_frames, "numInferenceSteps": num_inference_steps, "guidanceScale": guidance_scale, "seed": seed, "useDistill": use_distill, "enableCompile": enable_compile }),
            })
        }
        LongCatVideoStartRequest::VideoContinuation {
            prompt,
            negative_prompt,
            output_directory,
            input_path,
            resolution,
            num_frames,
            num_cond_frames,
            num_inference_steps,
            guidance_scale,
            seed,
            use_distill,
            enable_compile,
        } => {
            validate_common(
                &prompt,
                &negative_prompt,
                num_frames,
                num_inference_steps,
                guidance_scale,
                use_distill,
            )?;
            if resolution != "480p" && resolution != "720p"
                || !(1..=num_frames.min(65)).contains(&num_cond_frames)
            {
                return Err(LongCatVideoError::InvalidRequest(
                    "risoluzione o frame condizionanti non validi".into(),
                ));
            }
            let input = canonical_input(&input_path, &["mp4", "mov", "webm", "mkv"])?;
            Ok(ValidatedRequest {
                mode: "videoContinuation",
                output_directory: canonical_directory(&output_directory)?,
                input_path: Some(input.clone()),
                payload: json!({ "prompt": prompt.trim(), "negativePrompt": negative_prompt.trim(), "inputPath": input, "resolution": resolution, "numFrames": num_frames, "numCondFrames": num_cond_frames, "numInferenceSteps": num_inference_steps, "guidanceScale": guidance_scale, "seed": seed, "useDistill": use_distill, "enableCompile": enable_compile }),
            })
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LongCatVideoCapabilities {
    desktop: bool,
    ready: bool,
    platform_supported: bool,
    runtime_ready: bool,
    repository_ready: bool,
    checkpoint_ready: bool,
    cuda_ready: bool,
    gpu_name: Option<String>,
    revision: String,
    reason: Option<String>,
    setup_command: String,
}

impl LongCatVideoCapabilities {
    fn unavailable(reason: String) -> Self {
        Self {
            desktop: true,
            ready: false,
            platform_supported: cfg!(target_os = "linux"),
            runtime_ready: false,
            repository_ready: false,
            checkpoint_ready: false,
            cuda_ready: false,
            gpu_name: None,
            revision: PINNED_REVISION.into(),
            reason: Some(reason),
            setup_command: "npm run longcat-video:setup".into(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LongCatVideoJobStatus {
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}
impl LongCatVideoJobStatus {
    fn terminal(self) -> bool {
        matches!(self, Self::Completed | Self::Failed | Self::Cancelled)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LongCatVideoJob {
    job_id: String,
    mode: String,
    status: LongCatVideoJobStatus,
    progress: f64,
    message: Option<String>,
    result: Option<Value>,
    error: Option<String>,
}

struct JobRecord {
    snapshot: LongCatVideoJob,
    cancel: Arc<AtomicBool>,
    process_id: Option<u32>,
    worker_active: bool,
}
#[derive(Default)]
struct Shared {
    jobs: Mutex<HashMap<String, JobRecord>>,
    sequence: AtomicU64,
}
#[derive(Clone, Default)]
pub struct LongCatVideoState {
    shared: Arc<Shared>,
}

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")))
        .to_path_buf()
}
fn runtime_paths() -> (PathBuf, PathBuf, PathBuf) {
    let root = workspace_root();
    let python = std::env::var_os("MLSM_LONGCAT_PYTHON")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            if cfg!(windows) {
                root.join(".venv-longcat-video/Scripts/python.exe")
            } else {
                root.join(".venv-longcat-video/bin/python")
            }
        });
    let torchrun = std::env::var_os("MLSM_LONGCAT_TORCHRUN")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            if cfg!(windows) {
                root.join(".venv-longcat-video/Scripts/torchrun.exe")
            } else {
                root.join(".venv-longcat-video/bin/torchrun")
            }
        });
    (python, torchrun, root.join("tools/longcat-video/worker.py"))
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
    value.starts_with("lc-")
        && value.len() <= 80
        && value
            .bytes()
            .all(|item| item.is_ascii_lowercase() || item.is_ascii_digit() || item == b'-')
}
fn next_job_id(shared: &Shared) -> String {
    format!(
        "lc-{:x}-{:x}-{:x}",
        now_ms(),
        std::process::id(),
        shared.sequence.fetch_add(1, Ordering::Relaxed)
    )
}

fn configure_process(command: &mut Command) {
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
fn terminate_process(child: &mut Child) {
    #[cfg(unix)]
    {
        let pid = child.id() as libc::pid_t;
        if pid > 0 && unsafe { libc::kill(-pid, libc::SIGKILL) } == 0 {
            return;
        }
    }
    #[cfg(windows)]
    {
        if Command::new("taskkill")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .status()
            .is_ok_and(|status| status.success())
        {
            return;
        }
    }
    let _ = child.kill();
}

#[tauri::command]
pub fn longcat_video_capabilities() -> LongCatVideoCapabilities {
    let (python, _, worker) = runtime_paths();
    if !python.is_file() || !worker.is_file() {
        return LongCatVideoCapabilities::unavailable("Esegui npm run longcat-video:setup".into());
    }
    let mut command = Command::new(python);
    command
        .arg(worker)
        .arg("--capabilities")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process(&mut command);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => return LongCatVideoCapabilities::unavailable(error.to_string()),
    };
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < Duration::from_secs(30) => {
                thread::sleep(Duration::from_millis(25))
            }
            _ => {
                terminate_process(&mut child);
                break;
            }
        }
    }
    let output = match child.wait_with_output() {
        Ok(output) => output,
        Err(error) => return LongCatVideoCapabilities::unavailable(error.to_string()),
    };
    let result = output
        .stdout
        .split(|byte| *byte == b'\n')
        .filter_map(|line| serde_json::from_slice::<Value>(line).ok())
        .find(|value| value.get("type").and_then(Value::as_str) == Some("result"))
        .and_then(|value| value.get("result").cloned());
    let Some(value) = result else {
        return LongCatVideoCapabilities::unavailable(
            String::from_utf8_lossy(&output.stderr)
                .chars()
                .take(1000)
                .collect(),
        );
    };
    LongCatVideoCapabilities {
        desktop: true,
        ready: value.get("ready").and_then(Value::as_bool).unwrap_or(false),
        platform_supported: value
            .get("platformSupported")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        runtime_ready: value
            .get("runtimeReady")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        repository_ready: value
            .get("repositoryReady")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        checkpoint_ready: value
            .get("checkpointReady")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        cuda_ready: value
            .get("cudaReady")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        gpu_name: value
            .get("gpuName")
            .and_then(Value::as_str)
            .map(str::to_owned),
        revision: value
            .get("revision")
            .and_then(Value::as_str)
            .unwrap_or(PINNED_REVISION)
            .to_owned(),
        reason: value
            .get("reason")
            .and_then(Value::as_str)
            .map(str::to_owned),
        setup_command: "npm run longcat-video:setup".into(),
    }
}

fn app_jobs_root(app: &tauri::AppHandle) -> Result<PathBuf, LongCatVideoError> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|error| LongCatVideoError::Io(std::io::Error::other(error.to_string())))?
        .join("longcat-video/jobs");
    fs::create_dir_all(&path)?;
    fs::canonicalize(path).map_err(LongCatVideoError::Io)
}

#[tauri::command]
pub fn longcat_video_start_job(
    request: LongCatVideoStartRequest,
    state: tauri::State<'_, LongCatVideoState>,
    app: tauri::AppHandle,
) -> Result<LongCatVideoJob, LongCatVideoError> {
    let validated = validate_request(request)?;
    let (_, torchrun, worker) = runtime_paths();
    if !torchrun.is_file() || !worker.is_file() {
        return Err(LongCatVideoError::RuntimeUnavailable(
            "esegui npm run longcat-video:setup".into(),
        ));
    }
    let mut jobs = state
        .shared
        .jobs
        .lock()
        .unwrap_or_else(|value| value.into_inner());
    if jobs
        .values()
        .filter(|record| record.worker_active || !record.snapshot.status.terminal())
        .count()
        >= MAX_ACTIVE_JOBS
    {
        return Err(LongCatVideoError::ActiveJob);
    }
    let job_id = next_job_id(&state.shared);
    let jobs_root = app_jobs_root(&app)?;
    let job_root = jobs_root.join(&job_id);
    fs::create_dir(&job_root)?;
    let output_path = validated.output_directory.join(format!(
        "longcat-{}-{}.mp4",
        validated
            .mode
            .replace("ToVideo", "")
            .replace("Continuation", "-continuation")
            .to_ascii_lowercase(),
        &job_id[3..]
    ));
    if output_path.exists() {
        let _ = fs::remove_dir_all(&job_root);
        return Err(LongCatVideoError::InvalidRequest(
            "file di output già esistente".into(),
        ));
    }
    let mut payload = validated.payload;
    if let Some(object) = payload.as_object_mut() {
        object.insert("protocolVersion".into(), json!(PROTOCOL_VERSION));
        object.insert("mode".into(), json!(validated.mode));
        object.insert("outputPath".into(), json!(output_path));
    }
    let bytes = serde_json::to_vec(&payload)
        .map_err(|error| LongCatVideoError::InvalidRequest(error.to_string()))?;
    if bytes.len() > MAX_REQUEST_BYTES {
        let _ = fs::remove_dir_all(&job_root);
        return Err(LongCatVideoError::InvalidRequest(
            "payload troppo grande".into(),
        ));
    }
    let request_path = job_root.join("request.json");
    fs::write(&request_path, bytes)?;
    let cancel = Arc::new(AtomicBool::new(false));
    let snapshot = LongCatVideoJob {
        job_id: job_id.clone(),
        mode: validated.mode.into(),
        status: LongCatVideoJobStatus::Queued,
        progress: 0.0,
        message: Some("Job in coda".into()),
        result: None,
        error: None,
    };
    let _keep_input_alive = validated.input_path;
    jobs.insert(
        job_id.clone(),
        JobRecord {
            snapshot: snapshot.clone(),
            cancel: Arc::clone(&cancel),
            process_id: None,
            worker_active: true,
        },
    );
    drop(jobs);
    let shared = Arc::clone(&state.shared);
    let worker_run = WorkerRun {
        torchrun,
        worker,
        request_path,
        job_root,
        expected_output: output_path,
    };
    thread::spawn(move || run_job(shared, job_id, cancel, worker_run));
    Ok(snapshot)
}

#[tauri::command(rename_all = "camelCase")]
pub fn longcat_video_get_job(
    job_id: String,
    state: tauri::State<'_, LongCatVideoState>,
) -> Result<LongCatVideoJob, LongCatVideoError> {
    if !valid_job_id(&job_id) {
        return Err(LongCatVideoError::InvalidRequest("jobId non valido".into()));
    }
    state
        .shared
        .jobs
        .lock()
        .unwrap_or_else(|value| value.into_inner())
        .get(&job_id)
        .map(|record| record.snapshot.clone())
        .ok_or(LongCatVideoError::JobNotFound)
}

#[tauri::command(rename_all = "camelCase")]
pub fn longcat_video_cancel_job(
    job_id: String,
    state: tauri::State<'_, LongCatVideoState>,
) -> Result<LongCatVideoJob, LongCatVideoError> {
    if !valid_job_id(&job_id) {
        return Err(LongCatVideoError::InvalidRequest("jobId non valido".into()));
    }
    let mut jobs = state
        .shared
        .jobs
        .lock()
        .unwrap_or_else(|value| value.into_inner());
    let record = jobs
        .get_mut(&job_id)
        .ok_or(LongCatVideoError::JobNotFound)?;
    if !record.snapshot.status.terminal() {
        record.cancel.store(true, Ordering::Release);
        record.snapshot.status = LongCatVideoJobStatus::Cancelled;
        record.snapshot.message = Some("Job annullato".into());
    }
    Ok(record.snapshot.clone())
}

enum Message {
    Stdout(Vec<u8>),
    Stderr(String),
}
fn set_process(shared: &Shared, id: &str, pid: Option<u32>) {
    if let Some(record) = shared
        .jobs
        .lock()
        .unwrap_or_else(|value| value.into_inner())
        .get_mut(id)
    {
        record.process_id = pid;
    }
}
fn update_progress(shared: &Shared, id: &str, value: f64, message: Option<&str>) {
    if let Some(record) = shared
        .jobs
        .lock()
        .unwrap_or_else(|value| value.into_inner())
        .get_mut(id)
    {
        if record.snapshot.status == LongCatVideoJobStatus::Running {
            record.snapshot.progress = value.clamp(record.snapshot.progress, 0.99);
            record.snapshot.message = message.map(|item| item.chars().take(500).collect());
        }
    }
}
fn finish(
    shared: &Shared,
    id: &str,
    status: LongCatVideoJobStatus,
    result: Option<Value>,
    error: Option<String>,
) {
    if let Some(record) = shared
        .jobs
        .lock()
        .unwrap_or_else(|value| value.into_inner())
        .get_mut(id)
    {
        if record.snapshot.status != LongCatVideoJobStatus::Cancelled {
            record.snapshot.status = status;
            record.snapshot.progress = if status == LongCatVideoJobStatus::Completed {
                1.0
            } else {
                record.snapshot.progress
            };
            record.snapshot.message = Some(
                if status == LongCatVideoJobStatus::Completed {
                    "Video completato"
                } else {
                    "Generazione non riuscita"
                }
                .into(),
            );
            record.snapshot.result = result;
            record.snapshot.error = error.map(|item| item.chars().take(4_000).collect());
        }
        record.process_id = None;
        record.worker_active = false;
    }
}
fn parse_line(
    line: &[u8],
    shared: &Shared,
    id: &str,
    result: &mut Option<Value>,
    error: &mut Option<String>,
) -> Result<(), String> {
    if line.len() > MAX_STDOUT_LINE_BYTES {
        return Err("riga worker troppo grande".into());
    }
    let value: Value = serde_json::from_slice(line).map_err(|failure| failure.to_string())?;
    if value.get("protocolVersion").and_then(Value::as_u64) != Some(PROTOCOL_VERSION.into()) {
        return Err("protocolVersion worker non valida".into());
    }
    match value.get("type").and_then(Value::as_str) {
        Some("progress") => {
            let progress = value
                .get("progress")
                .and_then(Value::as_f64)
                .ok_or("progress assente")?;
            if !(0.0..=1.0).contains(&progress) {
                return Err("progress fuori intervallo".into());
            }
            update_progress(
                shared,
                id,
                progress,
                value.get("message").and_then(Value::as_str),
            );
        }
        Some("result") => {
            if result.is_some() {
                return Err("risultati multipli".into());
            }
            *result = value.get("result").cloned();
        }
        Some("error") => {
            *error = Some(format!(
                "{}: {}",
                value
                    .pointer("/error/code")
                    .and_then(Value::as_str)
                    .unwrap_or("worker_error"),
                value
                    .pointer("/error/message")
                    .and_then(Value::as_str)
                    .unwrap_or("errore non specificato")
            ))
        }
        _ => return Err("messaggio worker non supportato".into()),
    }
    Ok(())
}

struct WorkerRun {
    torchrun: PathBuf,
    worker: PathBuf,
    request_path: PathBuf,
    job_root: PathBuf,
    expected_output: PathBuf,
}

fn run_job(shared: Arc<Shared>, id: String, cancel: Arc<AtomicBool>, run: WorkerRun) {
    {
        let mut jobs = shared
            .jobs
            .lock()
            .unwrap_or_else(|value| value.into_inner());
        let Some(record) = jobs.get_mut(&id) else {
            return;
        };
        if record.snapshot.status != LongCatVideoJobStatus::Queued {
            record.worker_active = false;
            return;
        }
        record.snapshot.status = LongCatVideoJobStatus::Running;
        record.snapshot.message = Some("Avvio LongCat-Video".into());
    }
    let mut command = Command::new(run.torchrun);
    command
        .args(["--standalone", "--nproc_per_node=1"])
        .arg(run.worker)
        .arg("--request")
        .arg(run.request_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process(&mut command);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(failure) => {
            finish(
                &shared,
                &id,
                LongCatVideoJobStatus::Failed,
                None,
                Some(failure.to_string()),
            );
            let _ = fs::remove_dir_all(run.job_root);
            return;
        }
    };
    set_process(&shared, &id, Some(child.id()));
    let (sender, receiver) = mpsc::channel();
    if let Some(stdout) = child.stdout.take() {
        let sender = sender.clone();
        thread::spawn(move || {
            for line in BufReader::new(stdout).split(b'\n').flatten() {
                if sender.send(Message::Stdout(line)).is_err() {
                    break;
                }
            }
        });
    }
    if let Some(mut stderr) = child.stderr.take() {
        let sender = sender.clone();
        thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = stderr
                .by_ref()
                .take((MAX_STDERR_BYTES + 1) as u64)
                .read_to_end(&mut bytes);
            bytes.truncate(MAX_STDERR_BYTES);
            let _ = sender.send(Message::Stderr(
                String::from_utf8_lossy(&bytes).trim().to_owned(),
            ));
        });
    }
    drop(sender);
    let mut result = None;
    let mut worker_error = None;
    let mut protocol_error = None;
    let mut stderr = String::new();
    let started = Instant::now();
    let exit = loop {
        while let Ok(message) = receiver.try_recv() {
            match message {
                Message::Stdout(line) => {
                    if protocol_error.is_none() {
                        if let Err(failure) =
                            parse_line(&line, &shared, &id, &mut result, &mut worker_error)
                        {
                            protocol_error = Some(failure);
                        }
                    }
                }
                Message::Stderr(value) => stderr = value,
            }
        }
        if cancel.load(Ordering::Acquire)
            || protocol_error.is_some()
            || started.elapsed() > JOB_TIMEOUT
        {
            if started.elapsed() > JOB_TIMEOUT {
                protocol_error = Some("timeout di 12 ore superato".into());
            }
            terminate_process(&mut child);
            break child.wait().ok();
        }
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(failure) => {
                protocol_error = Some(failure.to_string());
                terminate_process(&mut child);
                break child.wait().ok();
            }
        }
    };
    for message in receiver {
        match message {
            Message::Stdout(line) if protocol_error.is_none() => {
                if let Err(failure) =
                    parse_line(&line, &shared, &id, &mut result, &mut worker_error)
                {
                    protocol_error = Some(failure);
                }
            }
            Message::Stderr(value) => stderr = value,
            _ => {}
        }
    }
    set_process(&shared, &id, None);
    let valid_result = result.as_ref().is_some_and(|value| {
        value.get("path").and_then(Value::as_str).map(Path::new)
            == Some(run.expected_output.as_path())
            && run.expected_output.is_file()
            && fs::metadata(&run.expected_output).is_ok_and(|meta| meta.len() > 0)
    });
    if !cancel.load(Ordering::Acquire)
        && exit.is_some_and(|status| status.success())
        && protocol_error.is_none()
        && worker_error.is_none()
        && valid_result
    {
        finish(&shared, &id, LongCatVideoJobStatus::Completed, result, None);
    } else if !cancel.load(Ordering::Acquire) {
        let error = protocol_error
            .or(worker_error)
            .or_else(|| (!stderr.is_empty()).then_some(stderr))
            .unwrap_or_else(|| "worker terminato senza MP4 valido".into());
        let _ = fs::remove_file(&run.expected_output);
        finish(
            &shared,
            &id,
            LongCatVideoJobStatus::Failed,
            None,
            Some(error),
        );
    } else {
        if let Some(record) = shared
            .jobs
            .lock()
            .unwrap_or_else(|value| value.into_inner())
            .get_mut(&id)
        {
            record.worker_active = false;
            record.process_id = None;
        }
        let _ = fs::remove_file(&run.expected_output);
    }
    let _ = fs::remove_dir_all(run.job_root);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ids_and_worker_protocol_are_strict() {
        let shared = Shared::default();
        let id = next_job_id(&shared);
        assert!(valid_job_id(&id));
        assert!(!valid_job_id("../outside"));
        let mut result = None;
        let mut error = None;
        parse_line(
            br#"{"protocolVersion":1,"type":"result","result":{"path":"/tmp/x.mp4"}}"#,
            &shared,
            &id,
            &mut result,
            &mut error,
        )
        .unwrap();
        assert_eq!(result.unwrap()["path"], "/tmp/x.mp4");
    }
    #[test]
    fn serde_rejects_cross_mode_fields() {
        let raw = json!({"mode":"textToVideo","prompt":"cat","negativePrompt":"","outputDirectory":"/tmp","width":832,"height":480,"resolution":"480p","numFrames":93,"numInferenceSteps":16,"guidanceScale":1,"seed":1,"useDistill":true,"enableCompile":false});
        assert!(serde_json::from_value::<LongCatVideoStartRequest>(raw).is_err());
    }
    #[test]
    fn validates_t2v_dimensions_and_output_directory() {
        let directory = tempfile::tempdir().unwrap();
        let valid = LongCatVideoStartRequest::TextToVideo {
            prompt: "cat".into(),
            negative_prompt: "".into(),
            output_directory: directory.path().to_string_lossy().into_owned(),
            width: 832,
            height: 480,
            num_frames: 93,
            num_inference_steps: 16,
            guidance_scale: 1.0,
            seed: 1,
            use_distill: true,
            enable_compile: false,
        };
        assert!(validate_request(valid).is_ok());
    }
}
