use serde_json::Value;
use std::{io::Write, path::Path, process::{Command, Stdio}, time::{Duration, Instant}};
use tauri::Manager;

#[tauri::command]
pub async fn studio_settings(app: tauri::AppHandle, request: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3).ok_or("Workspace unavailable")?;
        let native = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
        let development = cfg!(debug_assertions) && root.join("tools/settings/worker.py").is_file();
        let worker = if development { root.join("tools/settings/worker.py") } else { app.path().resource_dir().map_err(|e| e.to_string())?.join("settings/worker.py") };
        let data = if development { root.join(".mlsm-settings") } else { native.join("settings") };
        let scan_root = if development { root.to_path_buf() } else { native.clone() };
        let payload = serde_json::to_vec(&request).map_err(|e| e.to_string())?;
        if payload.len() > 140_000 { return Err("Settings request too large".into()); }
        let mut programs = vec!["python3".to_string(), "python".to_string()];
        let managed = if cfg!(windows) { native.join("audio/tts-runtime/Scripts/python.exe") } else { native.join("audio/tts-runtime/bin/python") };
        if managed.is_file() { programs.insert(0, managed.to_string_lossy().into_owned()); }
        let mut child = None;
        for program in programs {
            if let Ok(process) = Command::new(program).arg(&worker).arg(&scan_root).arg(&data).arg(&native).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn() { child = Some(process); break; }
        }
        let mut child = child.ok_or("Python unavailable for settings bridge")?;
        if let Some(mut input) = child.stdin.take() { input.write_all(&payload).map_err(|e| e.to_string())?; input.write_all(b"\n").map_err(|e| e.to_string())?; }
        // Drain stdout concurrently so long answers cannot block on a full pipe.
        let output = child.stdout.take().ok_or("Settings output unavailable")?;
        let reader = std::thread::spawn(move || { use std::io::Read; let mut data = String::new(); output.take(2_000_000).read_to_string(&mut data).map(|_| data) });
        let start = Instant::now();
        loop {
            if child.try_wait().map_err(|e| e.to_string())?.is_some() { break; }
            if start.elapsed() > Duration::from_secs(60) { let _ = child.kill(); let _ = child.wait(); let _ = reader.join(); return Err("Settings / NVIDIA timeout".into()); }
            std::thread::sleep(Duration::from_millis(30));
        }
        let text = reader.join().map_err(|_| "Settings output failed")?.map_err(|e| e.to_string())?;
        let result: Value = serde_json::from_str(&text).map_err(|_| "Invalid settings response")?;
        if let Some(error) = result.get("error").and_then(Value::as_str) { return Err(error.into()); }
        Ok(result["result"].clone())
    }).await.map_err(|e| e.to_string())?
}
