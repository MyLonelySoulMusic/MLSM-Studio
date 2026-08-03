import { uiCopy, useUiPreferences } from "../services/ui-preferences";

interface ToolbarProps { name: string; dirty: boolean; subtitleVideoMode?: boolean; analysisOnlyMode?: boolean; audioLoading: boolean; canAnalyze: boolean; analysisRunning: boolean; analysisProgress: number; canGenerate: boolean; canExport: boolean; canUndo: boolean; canRedo: boolean; onNew: () => void; onOpen: () => void; onSave: () => void; onImportAudio: () => void; onAnalyze: () => void; onGenerate: () => void; onExport: () => void; onUndo: () => void; onRedo: () => void; }
export function Toolbar({ name, dirty, subtitleVideoMode = false, analysisOnlyMode = false, audioLoading, canAnalyze, analysisRunning, analysisProgress, canGenerate, canExport, canUndo, canRedo, onNew, onOpen, onSave, onImportAudio, onAnalyze, onGenerate, onExport, onUndo, onRedo }: ToolbarProps) {
  const { language, theme, setLanguage, setTheme } = useUiPreferences();
  const copy = uiCopy[language];
  return <header className="toolbar">
    <div className="brand" aria-label="MLSM Studio — My Lonely Soul Music Studio">
      <img className="brand-mark" src="/mlsm-studio-favicon-192.png" alt="" />
      <span className="brand-copy"><strong>MLSM Studio</strong><small>My Lonely Soul Music</small></span>
    </div>
    <nav aria-label={copy.projectActions}>
      <button onClick={onNew}>{copy.new}</button><button onClick={onOpen}>{copy.open}</button><button onClick={onSave}>{copy.save}</button><button aria-label={copy.undo} onClick={onUndo} disabled={!canUndo}>↶</button><button aria-label={copy.redo} onClick={onRedo} disabled={!canRedo}>↷</button>
      {subtitleVideoMode ? null : analysisOnlyMode ? <><span className="separator" /><button onClick={onAnalyze} disabled={!canAnalyze || analysisRunning}>{analysisRunning ? `${copy.analysis} ${Math.round(analysisProgress * 100)}%` : copy.analyze}</button></> : <><span className="separator" /><button onClick={onImportAudio} disabled={audioLoading}>{audioLoading ? copy.importing : copy.importAudio}</button><button onClick={onAnalyze} disabled={!canAnalyze || analysisRunning}>{analysisRunning ? `${copy.analysis} ${Math.round(analysisProgress * 100)}%` : copy.analyze}</button><button onClick={onGenerate} disabled={!canGenerate}>{copy.generate}</button></>}
    </nav>
    <div className="project-title" title={name}>{name}{dirty ? " •" : ""}</div>
    <div className="ui-preferences">
      <label><span>{copy.language}</span><select aria-label={copy.language} value={language} onChange={(event) => setLanguage(event.target.value === "en" ? "en" : "it")}><option value="it">IT</option><option value="en">EN</option></select></label>
      <button className="theme-toggle" aria-label={`${copy.appearance}: ${theme === "day" ? copy.day : copy.night}`} aria-pressed={theme === "night"} onClick={() => setTheme(theme === "day" ? "night" : "day")}><span aria-hidden="true">{theme === "day" ? "☼" : "◐"}</span>{theme === "day" ? copy.day : copy.night}</button>
    </div>
    <button className="export" onClick={onExport} disabled={!canExport}>{copy.export}</button>
  </header>;
}
