import { useEffect, useRef, useState } from 'react';
import type { RhythmBallProject } from '@rbs/project-schema';
import { compositionRows, exportRowFormat, type VideoFormat } from './model';
import type { UiLanguage } from '../services/ui-preferences';
import { prepareFormat } from './render';
import { exportOptions, probeExportMedia, type ExportMediaInfo } from './export-options';
import { forgetVideoEditorFile } from '../services/video-editor-import';
import { exportVideoEditorOfflineVideo } from '../services/video-editor-offline-exporter';
import { videoEditorTimelineDuration } from '../services/video-editor';

function release(project: RhythmBallProject) {
  const urls = new Set<string>();
  for (const asset of project.animation.videoEditor.assets) {
    forgetVideoEditorFile(asset.id); urls.add(asset.url); if (asset.thumbnailUrl) urls.add(asset.thumbnailUrl);
  }
  urls.forEach(url => URL.revokeObjectURL(url));
}
export function FormatExportDialog({ format, activeId, language, onClose }: { format: VideoFormat; activeId: string | undefined; language: UiLanguage; onClose: () => void }) {
  const it = language === 'it', t = (italian: string, english: string) => it ? italian : english;
  const rows = compositionRows(format);
  const [rowId, setRowId] = useState(rows.find(row => row.media.some(media => media.id === activeId))?.id ?? rows[0]?.id ?? '');
  const selectedRowId = rows.some(row => row.id === rowId) ? rowId : rows.find(row => row.media.some(media => media.id === activeId))?.id ?? rows[0]?.id ?? '';
  const [project, setProject] = useState<RhythmBallProject | null>(null);
  const [info, setInfo] = useState<ExportMediaInfo[]>([]);
  const [resolution, setResolution] = useState(format.aspect === '9:16' ? '1080x1920' : '1920x1080'), [fps, setFps] = useState(30);
  const [loading, setLoading] = useState(true), [running, setRunning] = useState(false), [error, setError] = useState(''), [result, setResult] = useState('');
  const [progress, setProgress] = useState(0);
  const manualResolution = useRef(false), manualFps = useRef(false);
  const dialog = useRef<HTMLDialogElement>(null), controller = useRef<AbortController | null>(null);
  useEffect(() => { dialog.current?.showModal(); return () => controller.current?.abort(); }, []);
  useEffect(() => {
    let active = true, prepared: RhythmBallProject | null = null;
    manualResolution.current = false; manualFps.current = false;
    setResolution(format.aspect === '9:16' ? '1080x1920' : '1920x1080'); setFps(30);
    setLoading(true); setProject(null); setError(''); setResult(''); setInfo([]);
    void (async () => {
      try {
        const selected = exportRowFormat(format, selectedRowId);
        const used = [...new Map(selected.clips.map(clip => {
          const media = [...selected.uploads, ...selected.library].find(media => media.id === clip.mediaId)!;
          return [media.id, media] as const;
        })).values()];
        void Promise.all(used.map(async media => {
          try { return await probeExportMedia(media); }
          catch { return { id: media.id, name: media.name, width: media.width ?? 0, height: media.height ?? 0, fps: null }; }
        })).then(metadata => {
        if (!active) return;
        const settings = exportOptions(metadata, format.aspect);
        setInfo(metadata); if (!manualResolution.current) setResolution(settings.resolutions.find(item => item.recommended)!.value); if (!manualFps.current) setFps(settings.suggestedFps);
        });
        prepared = await prepareFormat(selected);
        if (!active) { release(prepared); prepared = null; return; }
        setProject(prepared);
      } catch (reason) { if (active) setError(reason instanceof Error ? reason.message : String(reason)); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; if (prepared) release(prepared); };
  }, [format, selectedRowId]);
  const options = exportOptions(info, format.aspect);
  const start = async () => {
    if (!project || loading || running) return;
    const selected = options.resolutions.find(item => item.value === resolution);
    if (!selected) return;
    manualResolution.current = true; manualFps.current = true;
    const abort = new AbortController(); controller.current = abort;
    setRunning(true); setProgress(0); setError(''); setResult('');
    try {
      const editor = { ...project.animation.videoEditor, outputWidth: selected.width, outputHeight: selected.height };
      const output = await exportVideoEditorOfflineVideo({
        width: selected.width, height: selected.height, fps, durationSeconds: videoEditorTimelineDuration(editor),
        projectName: `${format.name}-${rows.findIndex(row => row.id === selectedRowId) + 1}`,
        quality: 'maximum', videoEditorSettings: editor, interpolationEnabled: false, interpolationTargetFps: fps, interpolationMethod: 'motion',
      }, abort.signal, update => setProgress(update.progress));
      setResult(output.fileName);
    } catch (reason) {
      setError(reason instanceof DOMException && reason.name === 'AbortError' ? t('Esportazione annullata.', 'Export cancelled.') : reason instanceof Error ? reason.message : String(reason));
    } finally { controller.current = null; setRunning(false); }
  };
  return <dialog ref={dialog} className="vfb-export-dialog" aria-label={t('Esporta video', 'Export video')} onCancel={event => { if (running) event.preventDefault(); else onClose(); }}>
    <h2>{t('Esporta video', 'Export video')} · MP4</h2>
    <label>{t('Video da esportare', 'Video to export')}<select value={selectedRowId} disabled={running} onChange={event => setRowId(event.target.value)}>{rows.map((row, index) => <option key={row.id} value={row.id}>{t('Video finale', 'Final video')} {index + 1} · {row.media.length} {t('blocchi', 'blocks')}</option>)}</select></label>
    {loading && <p role="status">{t('Analisi delle clip e preparazione del montaggio…', 'Analyzing clips and preparing the composition…')}</p>}
    {!!info.length && <><p>{t('Massimi rilevati tra le clip utilizzate (video nuovi e reaction). La risoluzione suggerita rispetta il formato del progetto.', 'Highest detected values among the used clips (new videos and reactions). The suggested resolution follows the project aspect ratio.')}</p>
      <table><thead><tr><th>{t('Clip', 'Clip')}</th><th>{t('Risoluzione originale', 'Source resolution')}</th><th>FPS</th></tr></thead><tbody>{info.map(item => <tr key={item.id}><td>{item.name}</td><td>{item.width && item.height ? <span className={Math.max(item.width, item.height) === options.maxEdge ? 'vfb-source-maximum' : ''}>{item.width} × {item.height}{Math.max(item.width, item.height) === options.maxEdge ? ' ★' : ''}</span> : '—'}</td><td><span className={item.fps === options.maxFps ? 'vfb-source-maximum' : ''}>{item.fps ?? '—'}{item.fps && item.fps === options.maxFps ? ' ★' : ''}</span></td></tr>)}</tbody></table>
      {info.some(item => !item.fps || !item.width) && <p>{t('Alcuni metadati non sono disponibili: i suggerimenti usano i valori rilevati, oppure 1080p e 30 FPS come fallback.', 'Some metadata is unavailable: suggestions use detected values, or 1080p and 30 FPS as fallback.')}</p>}
    </>}
    <fieldset disabled={running}><label>{t('Risoluzione di esportazione', 'Export resolution')}<select value={resolution} onChange={event => { manualResolution.current = true; setResolution(event.target.value); }}>{options.resolutions.map(item => <option key={item.value} value={item.value}>{item.width} × {item.height}{item.recommended ? t(' ★ Consigliata', ' ★ Recommended') : ''}</option>)}</select></label>
      <label>FPS<select aria-label="FPS" value={fps} onChange={event => { manualFps.current = true; setFps(Number(event.target.value)); }}>{options.fps.map(value => <option key={value} value={value}>{value}{value === options.suggestedFps ? t(' ★ Consigliati', ' ★ Recommended') : ''}</option>)}</select></label>
      <p>{t('Gli FPS sono la frequenza media rilevata. Valori superiori alle sorgenti non aggiungono dettaglio o nuovi fotogrammi reali.', 'FPS is the detected average frame rate. Values above the sources do not add detail or new real frames.')}</p>
    </fieldset>
    {running && <div role="status"><progress max="1" value={progress} /><span>{Math.round(progress * 100)}%</span><button onClick={() => controller.current?.abort()}>{t('Annulla esportazione', 'Cancel export')}</button></div>}
    {error && <p role="alert">{error}</p>}{result && <p role="status">{t('Esportazione completata', 'Export complete')}: {result}</p>}
    <footer><button disabled={running} onClick={onClose}>{t('Chiudi', 'Close')}</button><button className="vfb-primary" disabled={!project || loading || running} onClick={() => void start()}>{loading ? t('Preparazione video…', 'Preparing video…') : t('Esporta MP4', 'Export MP4')}</button></footer>
  </dialog>;
}
