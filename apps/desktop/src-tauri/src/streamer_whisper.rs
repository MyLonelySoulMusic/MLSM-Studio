//! Dedicated, bounded local Whisper session. Uses Song Player's installed venv.
use serde_json::{json, Value};
use std::{io::{BufRead, BufReader, Write}, process::{Child, ChildStdin, Command, Stdio}, sync::{mpsc, Arc, Mutex}, thread, time::Duration};

struct Session {
    child: Child,
    stdin: ChildStdin,
    output: mpsc::Receiver<Value>,
    id: String,
}
impl Drop for Session { fn drop(&mut self) { let _ = self.child.kill(); let _ = self.child.wait(); } }

#[derive(Default, Clone)]
pub struct StreamerWhisperState {
    session: Arc<Mutex<Option<Session>>>,
    process: Arc<Mutex<Option<(String, u32)>>>,
}
// Independent of the inference mutex: stop can interrupt model load/inference.
fn stop_process(state: &StreamerWhisperState, id: Option<&str>) {
    if let Ok(mut owned) = state.process.lock() {
        if let Some((current, pid)) = owned.as_ref() {
            if id.is_some_and(|id| id != current) { return; }
            if *pid > 0 {
            #[cfg(unix)] unsafe { libc::kill(-(*pid as libc::pid_t), libc::SIGKILL); }
            #[cfg(windows)] {
                use std::os::windows::process::CommandExt;
                let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).creation_flags(0x08000000).status();
            }
            }
        }
        owned.take();
    }
}
pub fn shutdown(state: &StreamerWhisperState) { stop_process(state, None); if let Ok(mut session) = state.session.try_lock() { session.take(); } }

fn receive(session: &Session, startup: Option<&tauri::ipc::Channel<Value>>) -> Result<Value, String> {
    let deadline = std::time::Instant::now() + Duration::from_secs(if startup.is_some() { 1200 } else { 90 });
    loop {
        let remaining = deadline.saturating_duration_since(std::time::Instant::now());
        let value = session.output.recv_timeout(remaining).map_err(|_| "Whisper did not respond before the timeout".to_string())?;
        if value["type"] == "progress" { if let Some(channel) = startup { let _ = channel.send(value); } continue; }
        if value["type"] == "error" { return Err(value["error"].as_str().unwrap_or("Whisper failed").to_string()); }
        return Ok(value);
    }
}

#[tauri::command]
pub async fn streamer_whisper_start(id: String, on_startup: tauri::ipc::Channel<Value>, app: tauri::AppHandle, state: tauri::State<'_, StreamerWhisperState>) -> Result<Value, String> {
    if id.len() > 80 || id.is_empty() { return Err("Invalid session id".into()); }
    let owned = state.inner().clone();
    shutdown(&owned);
    // Reserve before spawn: a stop arriving during startup cancels this ID.
    *owned.process.lock().map_err(|_| "Whisper process unavailable")? = Some((id.clone(), 0));
    tauri::async_runtime::spawn_blocking(move || {
        let mut slot = owned.session.lock().map_err(|_| "Whisper state unavailable")?;
        slot.take();
        if !owned.process.lock().map_err(|_| "Whisper process unavailable")?.as_ref().is_some_and(|(current, pid)| current == &id && *pid == 0) {
            return Err("Whisper startup cancelled".into());
        }
        let (python, worker) = crate::song_player::worker_paths(&app).map_err(|error| error.to_string())?;
        if !python.is_file() { return Err("Whisper runtime missing. Restore the existing Song Player runtime in Settings.".into()); }
        let script = worker.with_file_name("live_whisper.py");
        let mut command = Command::new(python);
        command.args(["-u"]).arg(script).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit());
        command.env("MLSM_WHISPER_CACHE", crate::song_player::workspace_root().join(".transformers-cache/faster-whisper"));
        #[cfg(unix)] { use std::os::unix::process::CommandExt; command.process_group(0); }
        #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
        let mut child = command.spawn().map_err(|error| error.to_string())?;
        let stdin = child.stdin.take().ok_or("Whisper input unavailable")?;
        let stdout = child.stdout.take().ok_or("Whisper output unavailable")?;
        {
            let mut control = owned.process.lock().map_err(|_| "Whisper process unavailable")?;
            if !control.as_ref().is_some_and(|(current, pid)| current == &id && *pid == 0) {
                let _ = child.kill(); let _ = child.wait();
                return Err("Whisper startup cancelled".into());
            }
            *control = Some((id.clone(), child.id()));
        }
        let (sender, output) = mpsc::channel();
        thread::spawn(move || { for line in BufReader::new(stdout).lines().map_while(Result::ok) { if let Ok(value) = serde_json::from_str::<Value>(&line) { if sender.send(value).is_err() { break; } } } });
        let session = Session { child, stdin, output, id: id.clone() };
        let mut ready = match receive(&session, Some(&on_startup)) { Ok(ready) => ready, Err(error) => { stop_process(&owned, Some(&id)); return Err(error); } };
        ready["id"] = json!(id);
        *slot = Some(session);
        Ok(ready)
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn streamer_whisper_chunk(id: String, pcm: String, language: String, final_block: bool, state: tauri::State<'_, StreamerWhisperState>) -> Result<Value, String> {
    if pcm.len() > 700_000 { return Err("Audio block too large".into()); }
    let owned = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut slot = owned.session.lock().map_err(|_| "Whisper state unavailable")?;
        let session = slot.as_mut().filter(|session| session.id == id).ok_or("Whisper session expired")?;
        let request = format!("{}\n", json!({"pcm": pcm, "language": language, "final": final_block}));
        let result = session.stdin.write_all(request.as_bytes()).map_err(|error| error.to_string()).and_then(|_| receive(session, None));
        if result.is_err() { stop_process(&owned, Some(&id)); slot.take(); }
        result
    }).await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn streamer_whisper_stop(id: String, state: tauri::State<'_, StreamerWhisperState>) {
    stop_process(state.inner(), Some(&id));
    if let Ok(mut slot) = state.session.try_lock() { if slot.as_ref().is_some_and(|session| session.id == id) { slot.take(); } }
}
