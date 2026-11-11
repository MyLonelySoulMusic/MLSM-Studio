import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { codeFormerDefaults, createFaceJob, faceModels, faceRequest, faceResultUrl, type FaceJob, type FaceModel, type FaceSettings } from "../services/face-restoration-client";
import { createPortal } from "react-dom";
import "./FaceRestorationWorkspace.css";

export function FaceRestorationWorkspace() {
  const [targets, setTargets] = useState<{ controls: HTMLElement; inspector: HTMLElement } | null>(null);
  useLayoutEffect(() => { const controls = document.getElementById("face-restoration-controls"); const inspector = document.getElementById("face-restoration-inspector"); if (controls && inspector) setTargets({ controls, inspector }); }, []);
  const [checking, setChecking] = useState(true);
  const [models, setModels] = useState<FaceModel[]>([{ id: "codeformer", label: "CodeFormer", defaults: codeFormerDefaults }]);
  const [settings, setSettings] = useState<FaceSettings>({ ...codeFormerDefaults });
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState("");
  const [job, setJob] = useState<FaceJob | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const runGeneration = useRef(0);
  const activeId = useRef<string | null>(null);
  const mounted = useRef(true);
  const video = /\.(mp4|mov|avi|mkv)$/i.test(file?.name ?? "");
  const patch = (value: Partial<FaceSettings>) => setSettings(current => ({ ...current, ...value }));
  const check = () => { setChecking(true); setError(""); void faceModels().then(result => { if (!mounted.current) return; setModels(result.models); setReady(result.runtimeReady); if (!result.runtimeReady) setError("Runtime dedicato da installare: npm run face-restoration:setup. Poi premi Verifica runtime."); }).catch(reason => { if (mounted.current) { setReady(false); setError(String(reason)); } }).finally(() => { if (mounted.current) setChecking(false); }); };
  useEffect(() => {
    mounted.current = true;
    check();
    return () => { mounted.current = false; runGeneration.current += 1; if (activeId.current) void faceRequest(`/jobs/${activeId.current}`, { method: "DELETE" }).catch(() => undefined); };
  }, []);
  useEffect(() => { if (!file) { setSourceUrl(""); return; } const url = URL.createObjectURL(file); setSourceUrl(url); return () => URL.revokeObjectURL(url); }, [file]);
  useEffect(() => {
    if (!job || ["ready", "error", "cancelled"].includes(job.phase)) return;
    let disposed = false;
    const timer = window.setInterval(() => {
      void faceRequest<FaceJob>(`/jobs/${job.id}`).then(next => {
        if (disposed) return;
        setJob(next);
        if (["ready", "error", "cancelled"].includes(next.phase)) setBusy(false);
        if (next.phase === "error") setError(next.message);
      }).catch(reason => { if (!disposed) { setError(String(reason)); setBusy(false); } });
    }, 1000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [job]);
  const clear = async () => { if (activeId.current) await faceRequest(`/jobs/${activeId.current}`, { method: "DELETE" }); activeId.current = null; setJob(null); };
  const start = async () => {
    if (!file || busy) return;
    for (const [key, min, max, integer] of [["fidelity_weight", 0, 1, false], ["upscale", 1, 4, true], ["bg_tile", 64, 1024, true], ["crf", 0, 35, true], ["save_video_fps", 0, 120, false]] as const) {
      const value = settings[key];
      if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) { setError(`Parametro ${key}: inserisci un valore ${integer ? "intero " : ""}tra ${min} e ${max}.`); return; }
    }
    if (file.size === 0 || file.size > 2 * 1024 ** 3) { setError("Il file deve avere dimensione compresa tra 1 byte e 2 GB."); return; }
    const generation = ++runGeneration.current;
    setBusy(true); setError("");
    try { await clear(); const next = await createFaceJob(file, settings); if (!mounted.current || generation !== runGeneration.current) { await faceRequest(`/jobs/${next.id}`, { method: "DELETE" }); return; } activeId.current = next.id; setJob(next); if (["ready", "error", "cancelled"].includes(next.phase)) setBusy(false); }
    catch (reason) { setError(String(reason)); setBusy(false); }
  };
  const cancel = async () => { runGeneration.current += 1; try { await clear(); setBusy(false); } catch (reason) { setError(String(reason)); } };
  const number = (key: "fidelity_weight" | "upscale" | "bg_tile" | "crf" | "save_video_fps", label: string, min: number, max: number, step: number) => <label>{label}<input type="number" min={min} max={max} step={step} required value={Number.isNaN(settings[key]) ? "" : settings[key]} onChange={event => patch({ [key]: event.target.value === "" ? NaN : Number(event.target.value) })} /></label>;
  const toggle = (key: "has_aligned" | "only_center_face" | "draw_box" | "bg_upsampler" | "face_upsample", label: string) => <label className="face-toggle"><input type="checkbox" checked={settings[key]} onChange={event => patch({ [key]: event.target.checked })} />{label}</label>;
  useEffect(() => { const download = () => { if (job?.phase === "ready") { const link = document.createElement("a"); link.href = faceResultUrl(job.id); link.download = job.outputName; link.click(); } else setError("Ripristina prima una foto o un video dal pannello a sinistra."); }; window.addEventListener("face-restoration:export", download); return () => window.removeEventListener("face-restoration:export", download); }, [job]);
  const preview = (url: string, label: string) => <figure><figcaption>{label}</figcaption>{video ? <video src={url} controls preload="metadata" /> : <img src={url} alt={label} />}</figure>;
  const controls = <div className="face-controls">
      {error ? <p className="face-error" role="alert">{error}</p> : null}
      <div className="face-runtime-status" role="status">{checking ? "Avvio del servizio locale…" : ready ? "● CodeFormer pronto" : "Servizio non disponibile"}</div>
      <form noValidate onSubmit={event => { event.preventDefault(); void start(); }}>
      <fieldset disabled={busy}><legend>Sorgente e modello</legend>
        <label className="flyer-upload">Foto o video<input type="file" accept="image/png,image/jpeg,image/webp,image/bmp,video/mp4,video/quicktime,video/x-msvideo,video/x-matroska,.mkv" onChange={event => { const next = event.target.files?.[0]; if (next) { setError(""); if (!/\.(png|jpg|jpeg|webp|bmp|mp4|mov|avi|mkv)$/i.test(next.name)) { setError("Formato non supportato. Scegli una foto PNG/JPEG/WebP/BMP o un video MP4/MOV/AVI/MKV."); return; } setFile(next); void clear().catch(reason => setError(String(reason))); } }} /></label>
        <p className="muted">{file?.name || "Nessun file caricato"}</p><small>PNG, JPEG, WebP, BMP · MP4, MOV, AVI, MKV · massimo 2 GB</small>
        <label>Modello<select value={settings.model} onChange={event => { const model = models.find(item => item.id === event.target.value); if (model) setSettings({ ...model.defaults }); }}>{models.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
        {number("fidelity_weight", "Fedeltà del volto", 0, 1, .05)}<small>0: maggiore ricostruzione · 1: maggiore fedeltà all’originale.</small>
        {number("upscale", "Ingrandimento (×)", 1, 4, 1)}
        <label>Rilevamento volti<select value={settings.detection_model} onChange={event => patch({ detection_model: event.target.value })}><option value="retinaface_resnet50">RetinaFace ResNet50</option><option value="retinaface_mobile0.25">RetinaFace Mobile · leggero</option><option value="YOLOv5l">YOLOv5 large</option><option value="YOLOv5n">YOLOv5 nano</option></select></label>
        <label>Dispositivo<select value={settings.device} onChange={event => patch({ device: event.target.value })}><option value="auto">Automatico</option><option value="cpu">CPU</option><option value="mps">Apple Metal / MPS</option><option value="cuda">NVIDIA CUDA</option></select></label>
        {toggle("only_center_face", "Ripristina solo il volto centrale")}{toggle("bg_upsampler", "Migliora sfondo · Real-ESRGAN")}{toggle("face_upsample", "Ingrandisci volto · Real-ESRGAN")}
        <details><summary>Parametri avanzati</summary>{number("bg_tile", "Tile Real-ESRGAN (pixel)", 64, 1024, 1)}{toggle("has_aligned", "Volto già ritagliato e allineato (output 512 × 512)")}{toggle("draw_box", "Disegna contorni dei volti")}{video ? <>{number("crf", "Qualità video CRF (minore = migliore)", 0, 35, 1)}{number("save_video_fps", "FPS output (0 = sorgente)", 0, 120, .01)}</> : null}<small>Con volto già allineato, ingrandimento, sfondo e rilevamento non vengono applicati.</small></details>
        <button type="button" onClick={() => setSettings({ ...(models.find(model => model.id === settings.model)?.defaults ?? codeFormerDefaults) })}>Ripristina valori predefiniti</button>
      </fieldset>
      <p>Il primo utilizzo scarica i pesi nella cache locale. I video mantengono audio e FPS nominali (output CFR), senza file PNG intermedi.</p>
      <button type="button" disabled={busy} onClick={check}>Verifica runtime</button> <button type="submit" disabled={!file || busy || checking}>{busy ? "Elaborazione…" : "Ripristina volti"}</button>
      {busy || (job && !["ready", "error"].includes(job.phase)) ? <button type="button" onClick={() => void cancel()}>Annulla</button> : null}
      <p><a href="https://github.com/sczhou/CodeFormer" target="_blank" rel="noreferrer">CodeFormer · modello e licenza NTU S-Lab</a></p>
    </form></div>;
  const inspector = <div className="face-inspector"><h2>Face restoration</h2><div className="property"><span>Modello</span><output>CodeFormer</output></div><p className="muted">{file?.name || "Nessuna sorgente"}</p>
      {job ? <div role="status"><p>{job.message}</p><progress max={Math.max(1, job.totalFrames)} value={job.currentFrame} /><p>{job.currentFrame} / {job.totalFrames || "…"} frame · {job.faces} volti elaborati</p>{job.timings ? <p>Decodifica: {job.timings.decodeSeconds.toFixed(2)} s · AI: {job.timings.inferenceSeconds.toFixed(2)} s · Codifica: {(job.timings.encodePipeSeconds + job.timings.finalizeSeconds).toFixed(2)} s</p> : null}{job.phase === "ready" && job.faces === 0 ? <p>Nessun volto rilevato: il risultato contiene soltanto l’ingrandimento e le eventuali modifiche allo sfondo.</p> : null}</div> : null}

      {job?.phase === "ready" ? <><a className="face-download" href={faceResultUrl(job.id)} download={job.outputName}>Scarica {video ? "video MP4" : "foto PNG"}</a><p>Scarica il risultato prima di uscire dal modulo.</p></> : null}
    </div>;
  return <>{targets ? createPortal(controls, targets.controls) : controls}<section className="viewport face-preview" aria-label="Confronto restauro"><div className="viewport-tools"><strong>Face restoration</strong><span /> <span>CodeFormer · {video ? "Video" : "Photo"}</span></div><div className="face-preview-stage">{sourceUrl ? <div className="face-comparison">{preview(sourceUrl, "Originale")}{job?.phase === "ready" ? preview(faceResultUrl(job.id), "Risultato") : <div className="face-empty"><strong>{busy ? "Restauro in corso…" : "Anteprima risultato"}</strong><p>{busy ? job?.message || "Caricamento sorgente…" : "Imposta i parametri e premi Ripristina volti."}</p></div>}</div> : <div className="face-empty"><strong>Ripristina i volti in foto e video</strong><p>Carica una sorgente dal pannello a sinistra.</p></div>}</div><div className="viewport-footer"><span>{job?.message || (checking ? "Avvio servizio…" : ready ? "Pronto" : "In attesa del servizio")}</span><span>{file?.name}</span></div></section>{targets ? createPortal(inspector, targets.inspector) : inspector}</>;
}
