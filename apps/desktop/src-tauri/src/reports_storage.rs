use atomicwrites::{AllowOverwrite, AtomicFile};
use serde_json::{json, Value};
use std::{fs, io::Write, path::Path, sync::Mutex};
use tauri::Manager;

const MAX_REQUEST_BYTES: usize = 52 * 1024 * 1024;
const MAX_ARCHIVE_BYTES: u64 = 512 * 1024 * 1024;
static REPORTS_LOCK: Mutex<()> = Mutex::new(());

fn dashboard_id(value: &Value) -> Result<&str, String> {
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .ok_or("ID dashboard non valido")?;
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
    {
        return Err("ID dashboard non valido".into());
    }
    Ok(id)
}

fn read_archive(path: &Path) -> Result<Value, String> {
    if !path.exists() {
        return Ok(json!({ "schemaVersion": 1, "dashboards": [] }));
    }
    if path.metadata().map_err(|error| error.to_string())?.len() > MAX_ARCHIVE_BYTES {
        return Err("L’archivio Reports locale è troppo grande".into());
    }
    let archive: Value =
        serde_json::from_str(&fs::read_to_string(path).map_err(|error| error.to_string())?)
            .map_err(|_| "L’archivio Reports locale non è valido")?;
    if archive.get("schemaVersion").and_then(Value::as_u64) != Some(1)
        || !archive.get("dashboards").is_some_and(Value::is_array)
    {
        return Err("L’archivio Reports locale non è valido".into());
    }
    Ok(archive)
}

fn write_archive(path: &Path, archive: &Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or("Percorso archivio Reports non valido")?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let content = serde_json::to_vec(archive).map_err(|error| error.to_string())?;
    AtomicFile::new(path, AllowOverwrite)
        .write(|file| {
            file.write_all(&content)?;
            file.sync_all()
        })
        .map_err(|error| match error {
            atomicwrites::Error::Internal(error) | atomicwrites::Error::User(error) => {
                error.to_string()
            }
        })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(parent, fs::Permissions::from_mode(0o700));
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[tauri::command]
pub async fn reports_storage(app: tauri::AppHandle, request: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = REPORTS_LOCK
            .lock()
            .map_err(|_| "Archivio Reports temporaneamente non disponibile")?;
        if serde_json::to_vec(&request)
            .map_err(|error| error.to_string())?
            .len()
            > MAX_REQUEST_BYTES
        {
            return Err("La dashboard supera il limite di 50 MB".into());
        }
        let path = app
            .path()
            .app_local_data_dir()
            .map_err(|error| error.to_string())?
            .join("reports/dashboards.json");
        let action = request
            .get("action")
            .and_then(Value::as_str)
            .ok_or("Operazione Reports non valida")?;
        let mut archive = read_archive(&path)?;
        if action == "list" {
            return Ok(archive["dashboards"].clone());
        }
        let dashboards = archive
            .get_mut("dashboards")
            .and_then(Value::as_array_mut)
            .ok_or("L’archivio Reports locale non è valido")?;
        for dashboard in dashboards.iter() {
            dashboard_id(dashboard)?;
        }
        if action == "save" {
            let dashboard = request
                .get("dashboard")
                .cloned()
                .ok_or("Dashboard mancante")?;
            let id = dashboard_id(&dashboard)?.to_string();
            dashboards.retain(|item| dashboard_id(item).is_ok_and(|item_id| item_id != id));
            dashboards.insert(0, dashboard);
        } else if action == "delete" {
            let id = request
                .get("dashboardId")
                .and_then(Value::as_str)
                .ok_or("ID dashboard non valido")?;
            dashboard_id(&json!({ "id": id }))?;
            dashboards.retain(|item| dashboard_id(item).is_ok_and(|item_id| item_id != id));
        } else {
            return Err("Operazione Reports non supportata".into());
        }
        write_archive(&path, &archive)?;
        Ok(Value::Null)
    })
    .await
    .map_err(|error| error.to_string())?
}
