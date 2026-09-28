import { useCallback, useEffect, useState } from "react";
import {
  readAllServiceStatuses,
  readRepairJob,
  restartStudio,
  scanInstallation,
  setAllServicesRunning,
  setServiceRunning,
  startRepair,
  testServiceCycle,
  type InstallationReport,
  type RestoreJob,
  type RestoreServiceId,
  type RestoreServiceStatus,
} from "../services/system-restore";

const labels: Record<string, { it: string; en: string }> = {
  node: { it: "Node.js 22", en: "Node.js 22" }, npm: { it: "npm", en: "npm" }, npmDependencies: { it: "Dipendenze e build", en: "Dependencies and build" },
  python311: { it: "Python 3.11", en: "Python 3.11" }, ffmpeg: { it: "FFmpeg", en: "FFmpeg" }, ffprobe: { it: "FFprobe", en: "FFprobe" }, rubberband: { it: "Rubber Band", en: "Rubber Band" }, rust: { it: "Rust", en: "Rust" }, cargo: { it: "Cargo", en: "Cargo" },
  upscalerPython: { it: "Runtime Upscaler / Frame Booster", en: "Upscaler / Frame Booster runtime" }, quantizerPython: { it: "Runtime AI Quantizer", en: "AI Quantizer runtime" }, songPlayerPython: { it: "Runtime Song Player", en: "Song Player runtime" }, audioTtsPython: { it: "Runtime Audio TTS", en: "Audio TTS runtime" },
};
const serviceLabels: Record<RestoreServiceId, string> = { upscaler: "Upscaler · Frame Booster", quantizer: "AI Quantizer", autopost: "AutoPost" };
const emptyJob: RestoreJob = { state: "idle", progress: 0, detail: "", logs: [], restartRequired: false };

export function RestoreSettingsPanel({ language }: { language: "it" | "en" }) {
  const [report, setReport] = useState<InstallationReport | null>(null);
  const [serviceStatuses, setServiceStatuses] = useState<RestoreServiceStatus[]>([]);
  const [job, setJob] = useState<RestoreJob>(emptyJob);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [confirmRepair, setConfirmRepair] = useState(false);
  const updateService = useCallback((status: RestoreServiceStatus) => setServiceStatuses(current => [...current.filter(item => item.id !== status.id), status].sort((a, b) => a.id.localeCompare(b.id))), []);
  const refresh = useCallback(async () => {
    setBusy("scan"); setError("");
    try {
      const [nextReport, nextServices] = await Promise.all([scanInstallation(), readAllServiceStatuses()]);
      setReport(nextReport); setServiceStatuses(nextServices);
    } catch (scanError) { setError(scanError instanceof Error ? scanError.message : String(scanError)); }
    finally { setBusy(""); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (job.state !== "running") return;
    const timer = window.setInterval(() => void readRepairJob().then(next => {
      setJob(next);
      if (next.state === "success") void refresh();
    }).catch(value => setError(String(value))), 900);
    return () => window.clearInterval(timer);
  }, [job.state, refresh]);
  const runServices = async (name: string, action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(name); setError("");
    try { await action(); setServiceStatuses(await readAllServiceStatuses()); }
    catch (serviceError) { setError(serviceError instanceof Error ? serviceError.message : String(serviceError)); }
    finally { setBusy(""); }
  };
  const repair = async () => {
    setConfirmRepair(false); setBusy("repair"); setError("");
    try {
      await setAllServicesRunning(false, updateService).catch(() => undefined);
      setJob(await startRepair());
    } catch (repairError) { setError(repairError instanceof Error ? repairError.message : String(repairError)); }
    finally { setBusy(""); }
  };
  const failedChecks = report ? Object.values(report.checks).filter(item => !item.ok).length : 0;
  return <section className="settings-restore" data-ui-copy>
    <div className="settings-restore-hero"><div><small>SYSTEM RECOVERY · {report ? `${report.platform}/${report.arch}` : "MAC · WINDOWS"}</small><h3>{language === "it" ? "Diagnostica e ripristina MLSM Studio" : "Diagnose and restore MLSM Studio"}</h3><p>{language === "it" ? "Controlla software, dipendenze e ambienti Python 3.11. Il ripristino usa esclusivamente gli installer inclusi nel progetto e non tocca progetti o file personali." : "Checks software, dependencies and Python 3.11 environments. Restore only uses the installers included with the project and never changes projects or personal files."}</p></div><button type="button" disabled={Boolean(busy) || job.state === "running"} onClick={() => void refresh()}>{busy === "scan" ? (language === "it" ? "Controllo…" : "Checking…") : (language === "it" ? "Controlla tutto" : "Check everything")}</button></div>
    {error ? <p className="settings-feedback is-error" role="alert">{error}</p> : null}
    <div className={`settings-restore-summary ${report?.ok ? "is-ready" : "is-warning"}`}><span>{report?.ok ? "✓" : "!"}</span><div><strong>{report ? report.ok ? (language === "it" ? "Installazione completa" : "Installation complete") : (language === "it" ? `${failedChecks} controlli da correggere` : `${failedChecks} checks need attention`) : (language === "it" ? "Analisi dell’installazione" : "Installation analysis")}</strong><small>{language === "it" ? "Verifica identica su macOS e Windows, con percorsi specifici della piattaforma." : "The same verification runs on macOS and Windows using platform-specific paths."}</small></div></div>
    <div className="settings-restore-checks">{report ? Object.entries(report.checks).map(([id, check]) => <article key={id} className={check.ok ? "is-ready" : "is-error"}><span>{check.ok ? "✓" : "×"}</span><div><strong>{labels[id]?.[language] ?? id}</strong><small>{check.detail}</small></div></article>) : <div className="settings-restore-skeleton" />}</div>
    <section className="settings-restore-services"><header><div><small>ENDPOINT CONTROL</small><h3>{language === "it" ? "Servizi locali" : "Local services"}</h3><p>{language === "it" ? "Avvia, arresta o esegui un ciclo completo. Il test ripristina lo stato iniziale e verifica che nessun processo resti appeso." : "Start, stop or run a complete cycle. The test restores the initial state and checks that no process remains orphaned."}</p></div><div className="settings-actions"><button disabled={Boolean(busy) || job.state === "running"} onClick={() => void runServices("start", () => setAllServicesRunning(true, updateService))}>{language === "it" ? "Avvia tutti" : "Start all"}</button><button disabled={Boolean(busy) || job.state === "running"} onClick={() => void runServices("stop", () => setAllServicesRunning(false, updateService))}>{language === "it" ? "Arresta tutti" : "Stop all"}</button><button className="is-primary" disabled={Boolean(busy) || job.state === "running"} onClick={() => void runServices("cycle", () => testServiceCycle(updateService))}>{busy === "cycle" ? (language === "it" ? "Test in corso…" : "Testing…") : (language === "it" ? "Test ciclo completo" : "Test full cycle")}</button></div></header><div className="settings-restore-service-list">{serviceStatuses.map(service => <article key={service.id}><i className={service.running && service.compatible ? "is-ready" : service.running ? "is-error" : ""} /><div><strong>{serviceLabels[service.id]}</strong><small>{service.detail}{service.progress !== undefined ? ` · ${Math.round(service.progress)}%` : ""}</small></div><span>{service.running ? service.compatible ? "READY" : "ERROR" : "OFF"}</span><div className="settings-actions"><button disabled={Boolean(busy)} onClick={() => void runServices(`${service.id}-start`, () => setServiceRunning(service.id, true, updateService))}>{language === "it" ? "Avvia" : "Start"}</button><button disabled={Boolean(busy) || !service.running} onClick={() => void runServices(`${service.id}-stop`, () => setServiceRunning(service.id, false, updateService))}>{language === "it" ? "Arresta" : "Stop"}</button></div></article>)}</div></section>
    <section className="settings-restore-repair"><div><small>AUTOMATIC REPAIR</small><h3>{language === "it" ? "Ripara ciò che manca" : "Repair missing components"}</h3><p>{language === "it" ? "Arresta i servizi, esegue l’installer della piattaforma, ricrea soltanto gli ambienti mancanti o non validi e verifica nuovamente l’installazione." : "Stops services, runs the platform installer, recreates only missing or invalid environments and verifies the installation again."}</p></div>{confirmRepair ? <div className="settings-actions"><button className="is-primary" onClick={() => void repair()}>{language === "it" ? "Conferma ripristino" : "Confirm restore"}</button><button onClick={() => setConfirmRepair(false)}>{language === "it" ? "Annulla" : "Cancel"}</button></div> : <button className="settings-restore-repair-button" disabled={Boolean(busy) || job.state === "running"} onClick={() => setConfirmRepair(true)}>{language === "it" ? "Avvia ripristino automatico" : "Start automatic restore"}</button>}</section>
    {job.state !== "idle" ? <section className={`settings-restore-job is-${job.state}`}><header><strong>{job.state === "running" ? (language === "it" ? "Ripristino in corso" : "Restore running") : job.state === "success" ? (language === "it" ? "Ripristino completato" : "Restore complete") : (language === "it" ? "Ripristino non riuscito" : "Restore failed")}</strong><b>{job.progress}%</b></header><div className="settings-restore-progress"><i style={{ width: `${job.progress}%` }} /></div><p>{job.detail}</p><details open={job.state === "error"}><summary>{language === "it" ? "Log tecnico" : "Technical log"}</summary><pre>{job.logs.join("\n") || "—"}</pre></details>{job.restartRequired ? <button className="settings-restore-restart" onClick={() => void runServices("restart", restartStudio)}>{language === "it" ? "Riavvia MLSM Studio" : "Restart MLSM Studio"}</button> : null}</section> : null}
  </section>;
}
