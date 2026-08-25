import { useEffect, useRef, useState, type ChangeEvent } from "react";
import type { RhythmBallProject } from "@rbs/project-schema";
import { chooseUpscalerBatchOutputSink, type UpscalerBatchOutputSink } from "../services/upscaler-batch-output";
import { cloneUpscalerSettings, runUpscalerBatch } from "../services/upscaler-batch";
import { useUpscalerBatchStore, type UpscalerBatchOwner } from "../store/upscaler-batch-store";
import { UpscalerBatchThumbnail } from "./UpscalerBatchThumbnail";

type UpscalerSettings = RhythmBallProject["animation"]["upscaler"];

function statusLabel(status: string): string {
  if (status === "processing") return "In elaborazione";
  if (status === "done") return "Completata";
  if (status === "error") return "Errore";
  if (status === "cancelled") return "Annullata";
  return "In coda";
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function abortError(): DOMException {
  return new DOMException("Operazione annullata.", "AbortError");
}

export function UpscalerBatchPanel({ settings }: { settings: UpscalerSettings }) {
  const items = useUpscalerBatchStore((state) => state.items); const previewItemId = useUpscalerBatchStore((state) => state.previewItemId); const projectEpoch = useUpscalerBatchStore((state) => state.projectEpoch); const running = useUpscalerBatchStore((state) => state.running); const batchOwner = useUpscalerBatchStore((state) => state.batchOwner); const importing = useUpscalerBatchStore((state) => state.importing); const singleOperations = useUpscalerBatchStore((state) => state.singleOperations); const importFailures = useUpscalerBatchStore((state) => state.importFailures); const outputNotice = useUpscalerBatchStore((state) => state.outputNotice);
  const addFiles = useUpscalerBatchStore((state) => state.addFiles); const setPreviewItem = useUpscalerBatchStore((state) => state.setPreviewItem); const removeItem = useUpscalerBatchStore((state) => state.removeItem); const setSelected = useUpscalerBatchStore((state) => state.setSelected); const startBatch = useUpscalerBatchStore((state) => state.startBatch); const cancelBatch = useUpscalerBatchStore((state) => state.cancelBatch); const retryFailed = useUpscalerBatchStore((state) => state.retryFailed); const syncSettings = useUpscalerBatchStore((state) => state.syncSettings); const clear = useUpscalerBatchStore((state) => state.clear); const setOutputNotice = useUpscalerBatchStore((state) => state.setOutputNotice);
  const latestSettings = useRef(settings); latestSettings.current = settings;
  const choosingOutput = useRef(false);
  const pickerToken = useRef(0);
  const mounted = useRef(false);
  const activeBatchOwner = useRef<UpscalerBatchOwner | null>(null);
  const observedProjectEpoch = useRef(projectEpoch);
  const settingsSyncFrame = useRef<number | null>(null);
  const didMountSettingsSync = useRef(false);
  const [importError, setImportError] = useState(""); const [outputDestination, setOutputDestination] = useState<{ projectEpoch: number; sink: UpscalerBatchOutputSink } | null>(null); const [selectingOutput, setSelectingOutput] = useState(false);
  const outputSink = outputDestination?.projectEpoch === projectEpoch ? outputDestination.sink : null;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pickerToken.current += 1;
      choosingOutput.current = false;
      const owner = activeBatchOwner.current;
      if (owner) useUpscalerBatchStore.getState().cancelBatch(owner);
      if (settingsSyncFrame.current !== null) { if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(settingsSyncFrame.current); else window.clearTimeout(settingsSyncFrame.current); }
    };
  }, []);
  useEffect(() => {
    if (observedProjectEpoch.current === projectEpoch) return;
    observedProjectEpoch.current = projectEpoch;
    pickerToken.current += 1;
    choosingOutput.current = false;
    activeBatchOwner.current = null;
    setSelectingOutput(false);
    setOutputDestination(null);
    setImportError("");
    if (settingsSyncFrame.current !== null) {
      if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(settingsSyncFrame.current);
      else window.clearTimeout(settingsSyncFrame.current);
      settingsSyncFrame.current = null;
    }
  }, [projectEpoch]);
  // Sliders can emit several project updates in one frame. Coalescing queue
  // metadata avoids repeated target/output-name calculations while retaining
  // the latest shared settings for every card.
  useEffect(() => {
    if (!didMountSettingsSync.current) { didMountSettingsSync.current = true; return; }
    if (settingsSyncFrame.current !== null) return;
    const schedule = typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame : (callback: FrameRequestCallback) => window.setTimeout(() => callback(Date.now()), 0);
    settingsSyncFrame.current = schedule(() => { settingsSyncFrame.current = null; syncSettings(latestSettings.current); });
  }, [running, settings, syncSettings]);

  const importBatch = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])]; event.target.value = ""; if (!files.length) return; setImportError("");
    try { await addFiles(files, settings); } catch (error) { if (!isAbortError(error)) setImportError(error instanceof Error ? error.message : String(error)); }
  };

  const chooseOutputForEpoch = async (boundaryEpoch: number): Promise<UpscalerBatchOutputSink | null> => {
    const token = ++pickerToken.current;
    choosingOutput.current = true; setSelectingOutput(true);
    try {
      const sink = await chooseUpscalerBatchOutputSink();
      if (!mounted.current || pickerToken.current !== token || useUpscalerBatchStore.getState().projectEpoch !== boundaryEpoch) return null;
      return sink;
    } catch (error) {
      if (mounted.current && pickerToken.current === token && useUpscalerBatchStore.getState().projectEpoch === boundaryEpoch && !isAbortError(error)) {
        setOutputNotice(error instanceof Error ? error.message : String(error));
      }
      return null;
    } finally {
      if (mounted.current && pickerToken.current === token && useUpscalerBatchStore.getState().projectEpoch === boundaryEpoch) {
        choosingOutput.current = false;
        setSelectingOutput(false);
      }
    }
  };

  const processSelected = async () => {
    if (choosingOutput.current || running || importing || singleOperations > 0 || !items.some((item) => item.selected && item.status !== "done")) return;
    const boundaryEpoch = useUpscalerBatchStore.getState().projectEpoch;
    let sink = outputDestination?.projectEpoch === boundaryEpoch ? outputDestination.sink : null;
    if (!sink) sink = await chooseOutputForEpoch(boundaryEpoch);
    if (!sink) return;
    if (!mounted.current || useUpscalerBatchStore.getState().projectEpoch !== boundaryEpoch) return;
    setOutputDestination({ projectEpoch: boundaryEpoch, sink }); setOutputNotice(sink.warning ?? null);
    // The picker may remain open while project settings change. Establish the
    // batch boundary only after it closes, then synchronize queue metadata and
    // capture the queue without another asynchronous gap.
    const snapshot = cloneUpscalerSettings(latestSettings.current);
    syncSettings(snapshot);
    if (useUpscalerBatchStore.getState().projectEpoch !== boundaryEpoch) return;
    const owner = startBatch(snapshot); if (!owner) return;
    activeBatchOwner.current = owner;
    const currentItems = useUpscalerBatchStore.getState().items;
    const selectedSink = sink;
    void Promise.resolve(runUpscalerBatch({
      items: currentItems,
      settings: snapshot,
      signal: owner.controller.signal,
      writeOutput: async (output, item) => {
        if (!useUpscalerBatchStore.getState().isBatchOwnerActive(owner)) throw abortError();
        await selectedSink.write(output.blob, item.outputName || output.fileName);
      },
      onUpdate: (itemUpdate) => { useUpscalerBatchStore.getState().updateBatchItem(owner, itemUpdate.itemId, { status: itemUpdate.status, progress: itemUpdate.progress, error: itemUpdate.error ?? null, ...(itemUpdate.target && itemUpdate.outputName ? { target: itemUpdate.target, outputName: itemUpdate.outputName } : {}) }); }
    })).finally(() => {
      useUpscalerBatchStore.getState().finishBatch(owner);
      if (activeBatchOwner.current === owner) activeBatchOwner.current = null;
    });
  };

  const changeDestination = async () => {
    if (choosingOutput.current || running || importing) return;
    const boundaryEpoch = useUpscalerBatchStore.getState().projectEpoch;
    const sink = await chooseOutputForEpoch(boundaryEpoch);
    if (!sink || !mounted.current || useUpscalerBatchStore.getState().projectEpoch !== boundaryEpoch) return;
    setOutputDestination({ projectEpoch: boundaryEpoch, sink }); setOutputNotice(sink.warning ?? null);
  };

  const clearBatch = () => { clear(); setOutputDestination(null); };

  const failedCount = items.filter((item) => item.status === "error" || item.status === "cancelled").length;
  return <section className="upscaler-batch-panel" aria-label="Upscaling batch">
    <header className="upscaler-batch-heading"><div><h2>Batch foto</h2><p>Applica modello e regolazioni correnti a più immagini in sequenza.</p></div><span>{items.length} file</span></header>
    <label className="flyer-upload upscaler-batch-input">{importing ? "Importazione…" : "Aggiungi altre foto"}<input aria-label="Aggiungi altre foto al batch Upscaler" type="file" accept="image/png,image/jpeg,image/webp,image/avif" multiple disabled={running || importing || selectingOutput} onChange={(event) => void importBatch(event)} /></label>
    {importError ? <p className="upscaler-batch-error">{importError}</p> : null}
    {importFailures.length ? <div className="upscaler-batch-error" role="alert"><strong>{importFailures.length} file non importati.</strong><ul>{importFailures.map((failure, index) => <li key={`${failure.name}-${index}`}>{failure.name}: {failure.error}</li>)}</ul></div> : null}
    {items.length ? <><p className="upscaler-batch-preview-fidelity">Regolazioni live · AI nella preview principale</p><div className="upscaler-batch-list" role="list">{items.map((item) => <article className={`upscaler-batch-item is-${item.status}${previewItemId === item.id ? " is-preview" : ""}`} key={item.id} role="listitem">
      <button type="button" className="upscaler-batch-preview" aria-label={`Anteprima ${item.name}`} aria-pressed={previewItemId === item.id} onClick={() => setPreviewItem(item.id)}><UpscalerBatchThumbnail item={item} settings={settings} /></button>
      <label className="upscaler-batch-select"><input aria-label={`Seleziona ${item.name}`} type="checkbox" checked={item.selected} disabled={running || selectingOutput || item.status === "done"} onKeyDown={(event) => { if (event.key === " ") { event.preventDefault(); setSelected(item.id, !item.selected); } }} onChange={(event) => setSelected(item.id, event.target.checked)} /><span>{item.name}</span></label>
      <div className="upscaler-batch-meta"><span>{item.sourceWidth} × {item.sourceHeight} → {item.target.width} × {item.target.height}</span><strong>{statusLabel(item.status)}</strong></div><small className="upscaler-batch-output-name">Output: {item.outputName}</small>
      {item.status === "processing" ? <progress max="1" value={item.progress || undefined} aria-label={`Progresso ${item.name}`} /> : null}
      {item.error ? <p className="upscaler-batch-error">{item.error}</p> : null}
      {!running ? <button type="button" disabled={selectingOutput} className="upscaler-batch-remove" aria-label={`Rimuovi ${item.name}`} onClick={() => removeItem(item.id)}>Rimuovi</button> : null}
    </article>)}</div></> : <p className="muted">Aggiungi una o più foto per creare una coda batch. I video restano nel flusso singolo.</p>}
    {outputNotice ? <p className="upscaler-batch-notice" role="status">{outputNotice}</p> : null}
    {outputSink ? <p className="upscaler-batch-notice">Destinazione: <strong>{outputSink.label}</strong> <button type="button" disabled={running || importing || selectingOutput} onClick={() => void changeDestination()}>Cambia</button></p> : null}
    <div className="upscaler-batch-actions"><button type="button" className="upscaler-batch-primary" disabled={running || importing || selectingOutput || singleOperations > 0 || !items.some((item) => item.selected && item.status !== "done")} onClick={() => void processSelected()}>{running ? "Elaborazione…" : importing ? "Importazione…" : selectingOutput ? "Scelta destinazione…" : singleOperations > 0 ? "Attendi operazione singola…" : "Elabora selezionate"}</button><button type="button" disabled={!running || !batchOwner} onClick={() => { if (batchOwner) cancelBatch(batchOwner); }}>Annulla</button><button type="button" disabled={running || importing || selectingOutput || failedCount === 0} onClick={retryFailed}>Riprova fallite</button><button type="button" disabled={running || selectingOutput || (!importing && items.length === 0)} onClick={clearBatch}>Svuota</button></div>
  </section>;
}
