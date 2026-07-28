interface ToolbarProps { name: string; dirty: boolean; subtitleVideoMode?: boolean; audioLoading: boolean; canAnalyze: boolean; analysisRunning: boolean; analysisProgress: number; canGenerate: boolean; canExport: boolean; canUndo: boolean; canRedo: boolean; onNew: () => void; onOpen: () => void; onSave: () => void; onImportAudio: () => void; onAnalyze: () => void; onGenerate: () => void; onExport: () => void; onUndo: () => void; onRedo: () => void; }
export function Toolbar({ name, dirty, subtitleVideoMode = false, audioLoading, canAnalyze, analysisRunning, analysisProgress, canGenerate, canExport, canUndo, canRedo, onNew, onOpen, onSave, onImportAudio, onAnalyze, onGenerate, onExport, onUndo, onRedo }: ToolbarProps) {
  return <header className="toolbar">
    <div className="brand" aria-label="Dynamic Sound Animation Studio">
      <img className="brand-mark" src="/brand/dynamic-sound-mark.svg" alt="" />
      <span className="brand-copy"><strong>Dynamic Sound</strong><small>Animation Studio</small></span>
    </div>
    <nav aria-label="Azioni progetto">
      <button onClick={onNew}>Nuovo</button><button onClick={onOpen}>Apri</button><button onClick={onSave}>Salva</button><button aria-label="Annulla" onClick={onUndo} disabled={!canUndo}>↶</button><button aria-label="Ripeti" onClick={onRedo} disabled={!canRedo}>↷</button>
      {subtitleVideoMode ? null : <><span className="separator" /><button onClick={onImportAudio} disabled={audioLoading}>{audioLoading ? "Importazione…" : "Importa audio"}</button><button onClick={onAnalyze} disabled={!canAnalyze || analysisRunning}>{analysisRunning ? `Analisi ${Math.round(analysisProgress * 100)}%` : "Analizza"}</button><button onClick={onGenerate} disabled={!canGenerate}>Genera scena</button></>}
    </nav>
    <div className="project-title" title={name}>{name}{dirty ? " •" : ""}</div>
    <button className="export" onClick={onExport} disabled={!canExport}>Esporta</button>
  </header>;
}
