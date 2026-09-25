import { useEffect, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import type { WorkBook } from "xlsx";
import { ReportIcon } from "./ReportIcon";
import { suggestReplicateXlsModel } from "./reports-ai";
import {
  buildReplicatedWorkbook, createReplicateXlsGrid, downloadReplicatedWorkbook,
  inspectReplicateXlsTemplate, inspectStoredReplicateXlsTemplate, selectionRange,
  type ReplicateXlsGridPreview, type ReplicateXlsTemplateSummary,
} from "./replicate-xls";
import { reportId, type ReportDataset, type ReplicateXlsConfig, type ReplicateXlsRegion, type ReplicateXlsRegionMode, type ReportWidget } from "./types";
import type { UiLanguage } from "../services/ui-preferences";

interface Props {
  widget: ReportWidget;
  dataset: ReportDataset;
  language: UiLanguage;
  onSave: (config: ReplicateXlsConfig) => void;
  onClose: () => void;
}

const labels = {
  it: { title: "Costruisci Replica Excel", upload: "Carica template", analyze: "Analizza con AI", refine: "Correggi modello", test: "Genera anteprima", export: "Esporta report", save: "Salva modello", area: "Aggiungi area", empty: "Carica un template Excel per iniziare." },
  en: { title: "Build Replicate XLS", upload: "Upload template", analyze: "Analyze with AI", refine: "Refine model", test: "Generate preview", export: "Export report", save: "Save model", area: "Add region", empty: "Upload an Excel template to begin." },
};

function blankConfig(): ReplicateXlsConfig {
  return { templateName: "", templateFormat: "xlsx", templateBase64: "", sheetName: "", selectedRange: "A1:A1", regions: [], aiSummary: "", aiProvider: "", aiModel: "", correctionNotes: "", lastTestedAt: null };
}

function modeLabel(mode: ReplicateXlsRegionMode, language: UiLanguage): string {
  const values = language === "en"
    ? { static: "Keep unchanged", singleCell: "Single value", tableRows: "Records by rows", tableColumns: "Records by columns" }
    : { static: "Mantieni invariata", singleCell: "Valore singolo", tableRows: "Record per righe", tableColumns: "Record per colonne" };
  return values[mode];
}

export function ReplicateXlsModal({ widget, dataset, language, onSave, onClose }: Props) {
  const t = labels[language];
  const input = useRef<HTMLInputElement>(null);
  const [config, setConfig] = useState<ReplicateXlsConfig>(() => widget.replicateXls ? structuredClone(widget.replicateXls) : blankConfig());
  const [workbook, setWorkbook] = useState<WorkBook | null>(null);
  const [summary, setSummary] = useState<ReplicateXlsTemplateSummary | null>(null);
  const [grid, setGrid] = useState<ReplicateXlsGridPreview | null>(null);
  const [draft, setDraft] = useState<Omit<ReplicateXlsRegion, "id">>({ sheetName: "", range: "A1:A1", label: "", description: "", mode: "tableColumns", fieldIds: [], includeHeaders: true });
  const [dragStart, setDragStart] = useState<{ row: number; column: number } | null>(null);
  const [busy, setBusy] = useState<"upload" | "ai" | "test" | "export" | null>(null);
  const [error, setError] = useState("");
  const [testReady, setTestReady] = useState(false);

  async function showGrid(source: WorkBook, sheetName: string) {
    const next = await createReplicateXlsGrid(source, sheetName);
    setGrid(next);
    setDraft(current => ({ ...current, sheetName, range: current.sheetName === sheetName ? current.range : `${next.cells[0]?.[0]?.address ?? "A1"}:${next.cells[0]?.[0]?.address ?? "A1"}` }));
  }

  useEffect(() => {
    const storedConfig = widget.replicateXls;
    if (!storedConfig?.templateBase64) return;
    let active = true;
    void inspectStoredReplicateXlsTemplate(storedConfig).then(async result => {
      if (!active) return;
      setWorkbook(result.workbook); setSummary(result.summary);
      const sheetName = storedConfig.sheetName || result.workbook.SheetNames[0]!;
      const next = await createReplicateXlsGrid(result.workbook, sheetName);
      if (!active) return;
      setGrid(next);
      setDraft(current => ({ ...current, sheetName, range: current.sheetName === sheetName ? current.range : `${next.cells[0]?.[0]?.address ?? "A1"}:${next.cells[0]?.[0]?.address ?? "A1"}` }));
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [widget.replicateXls]);

  async function askAi(nextConfig: ReplicateXlsConfig, nextSummary: ReplicateXlsTemplateSummary, feedback = "") {
    setBusy("ai"); setError("");
    try {
      const suggestion = await suggestReplicateXlsModel(nextSummary, dataset, language, nextConfig.templateBase64 ? nextConfig : null, feedback);
      setConfig(current => ({ ...current, regions: suggestion.regions, aiSummary: suggestion.summary, aiProvider: suggestion.provider, aiModel: suggestion.model, correctionNotes: "" }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  }

  async function upload(file: File) {
    setBusy("upload"); setError(""); setTestReady(false);
    try {
      const inspected = await inspectReplicateXlsTemplate(file);
      const sheetName = inspected.workbook.SheetNames[0]!;
      const next: ReplicateXlsConfig = { ...blankConfig(), templateName: file.name, templateFormat: inspected.summary.format, templateBase64: inspected.base64, sheetName };
      setConfig(next); setWorkbook(inspected.workbook); setSummary(inspected.summary);
      setDraft(current => ({ ...current, sheetName }));
      await showGrid(inspected.workbook, sheetName);
      await askAi(next, inspected.summary);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(current => current === "upload" ? null : current); }
  }

  function selectCell(row: number, column: number, finish = false) {
    const start = dragStart ?? { row, column };
    const range = selectionRange(start, { row, column });
    setDraft(current => ({ ...current, range }));
    setConfig(current => ({ ...current, selectedRange: range }));
    if (finish) setDragStart(null);
  }

  function addRegion() {
    if (!draft.sheetName || !draft.range || !draft.description.trim()) { setError(language === "en" ? "Describe what happens in the selected region." : "Spiega cosa avviene nell’area selezionata."); return; }
    if (draft.mode !== "static" && !draft.fieldIds.length) { setError(language === "en" ? "Select at least one dataset field." : "Seleziona almeno un campo del dataset."); return; }
    setConfig(current => ({ ...current, regions: [...current.regions, { ...draft, id: reportId(), label: draft.label.trim() || `Area ${current.regions.length + 1}` }] }));
    setDraft(current => ({ ...current, label: "", description: "" })); setError("");
  }

  async function testModel() {
    setBusy("test"); setError("");
    try {
      const result = await buildReplicatedWorkbook(config, dataset);
      setWorkbook(result); await showGrid(result, config.sheetName); setConfig(current => ({ ...current, lastTestedAt: new Date().toISOString() })); setTestReady(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(null); }
  }

  const rangeContains = (range: string, row: number, column: number) => {
    const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i.exec(range);
    if (!match) return false;
    const col = (value: string) => [...value.toUpperCase()].reduce((sum, char) => sum * 26 + char.charCodeAt(0) - 64, 0) - 1;
    return row >= Number(match[2]) - 1 && row <= Number(match[4]) - 1 && column >= col(match[1]!) && column <= col(match[3]!);
  };
  const regionAt = (row: number, column: number) => config.regions.find(region => region.sheetName === config.sheetName && rangeContains(region.range, row, column));
  const busyLabel = busy === "ai"
    ? (language === "en" ? "AI is analyzing the workbook structure…" : "L’AI sta analizzando la struttura del workbook…")
    : busy === "upload"
      ? (language === "en" ? "Reading the original template…" : "Lettura del template originale…")
      : busy === "test"
        ? (language === "en" ? "Generating the formatted preview…" : "Generazione dell’anteprima formattata…")
        : busy === "export"
          ? (language === "en" ? "Generating the report without altering its design…" : "Generazione del report senza alterarne il design…")
          : "";

  return <div className="rpt-modal-backdrop rpt-replicate-backdrop" onMouseUp={() => setDragStart(null)}>
    <section className="rpt-modal rpt-replicate-modal" role="dialog" aria-modal="true" aria-labelledby="rpt-replicate-title">
      <header><div><span className="rpt-eyebrow">REPORTS · REPLICATE XLS</span><h2 id="rpt-replicate-title">{t.title}</h2><p>{language === "en" ? "Teach MLSM how your workbook is structured, preserve its design and extend it as new records arrive." : "Insegna a MLSM come è costruito il workbook, conserva il design e fallo crescere quando arrivano nuovi dati."}</p></div><button className="rpt-icon-button rpt-animation-close" aria-label="Chiudi" onClick={onClose}><ReportIcon name="close" /></button></header>
      <div className="rpt-replicate-steps"><span className={config.templateBase64 ? "is-done" : "is-active"}>1 <b>Template</b></span><span className={config.regions.length ? "is-done" : config.templateBase64 ? "is-active" : ""}>2 <b>Modello</b></span><span className={testReady ? "is-done" : config.regions.length ? "is-active" : ""}>3 <b>Test</b></span></div>
      <div className="rpt-replicate-body">
        <aside className="rpt-replicate-sidebar">
          <section><h3>{language === "en" ? "Data source" : "Base dati"}</h3><strong>{dataset.name}</strong><small>{dataset.rows.length.toLocaleString()} {language === "en" ? "rows" : "righe"} · {dataset.fields.length} {language === "en" ? "fields" : "campi"}</small></section>
          <section><h3>{language === "en" ? "Original template" : "Template originale"}</h3><input ref={input} className="rpt-sr-only" type="file" accept=".xlsx,.xls,.xlsm,.xlsb,.ods" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ""; }} /><button className="rpt-button rpt-full-width" disabled={Boolean(busy)} onClick={() => input.current?.click()}><ReportIcon name="file" />{config.templateName || t.upload}</button>{config.templateName && <small>{language === "en" ? "Stored inside this dashboard model." : "Memorizzato nel modello della dashboard."}</small>}</section>
          {summary && <section><h3>{language === "en" ? "AI model" : "Modello AI"}</h3><button className="rpt-button rpt-button-primary rpt-full-width" disabled={Boolean(busy)} onClick={() => void askAi(config, summary)}><ReportIcon name="sparkle" />{busy === "ai" ? (language === "en" ? "Analyzing…" : "Analisi…") : t.analyze}</button><textarea rows={5} placeholder={language === "en" ? "Explain what the AI should correct…" : "Spiega cosa deve correggere l’AI…"} value={config.correctionNotes} onChange={event => setConfig(current => ({ ...current, correctionNotes: event.target.value }))} /><button className="rpt-button rpt-full-width" disabled={Boolean(busy) || !config.correctionNotes.trim()} onClick={() => void askAi(config, summary, config.correctionNotes)}>{t.refine}</button>{config.aiProvider && <small>{config.aiProvider} · {config.aiModel}</small>}</section>}
        </aside>
        <main className="rpt-replicate-sheet-panel">
          {workbook && grid ? <><div className="rpt-replicate-sheet-toolbar"><select aria-label="Foglio" value={config.sheetName} onChange={event => { const sheetName = event.target.value; setConfig(current => ({ ...current, sheetName })); void showGrid(workbook, sheetName); }}>{workbook.SheetNames.map(name => <option key={name}>{name}</option>)}</select><span>{draft.range}</span><small>{grid.truncated ? (language === "en" ? "Preview limited to 80 × 40 cells" : "Anteprima limitata a 80 × 40 celle") : `${grid.rowCount} × ${grid.columnCount}`}</small></div>
            <div className="rpt-replicate-grid-wrap"><table className="rpt-replicate-grid"><colgroup><col className="rpt-replicate-row-number" />{grid.columnWidths.map((width, index) => <col key={index} style={{ width }} />)}</colgroup><thead><tr><th /><>{grid.cells[0]?.map(cell => <th key={cell.column} onClick={() => { const first = grid.cells[0]?.[0]; const last = grid.cells.at(-1)?.[cell.column - grid.startColumn]; if (first && last) { const range = selectionRange({ row: first.row, column: cell.column }, { row: last.row, column: cell.column }); setDraft(current => ({ ...current, range })); } }}>{cell.address.replace(/\d+$/, "")}</th>)}</></tr></thead><tbody>{grid.cells.map((row, rowIndex) => <tr key={rowIndex} style={{ height: grid.rowHeights[rowIndex] }}><th onClick={() => { const first = row[0]; const last = row.at(-1); if (first && last) setDraft(current => ({ ...current, range: selectionRange({ row: first.row, column: first.column }, { row: last.row, column: last.column }) })); }}>{row[0]!.row + 1}</th>{row.map(cell => { const region = regionAt(cell.row, cell.column); return <td key={cell.address} title={cell.formula ? `=${cell.formula}` : cell.display} className={region ? "is-mapped" : ""} style={{ ...cell.style, "--region-color": region ? `hsl(${(config.regions.indexOf(region) * 71 + 326) % 360} 78% 55%)` : undefined } as CSSProperties} onMouseDown={(event: MouseEvent) => { event.preventDefault(); setDragStart({ row: cell.row, column: cell.column }); selectCell(cell.row, cell.column); }} onMouseEnter={() => { if (dragStart) selectCell(cell.row, cell.column); }} onMouseUp={() => selectCell(cell.row, cell.column, true)}>{cell.display}</td>; })}</tr>)}</tbody></table></div></> : <div className="rpt-replicate-empty"><ReportIcon name="replicateXls" /><h3>{t.empty}</h3><button className="rpt-button rpt-button-primary" onClick={() => input.current?.click()}>{t.upload}</button></div>}
        </main>
        <aside className="rpt-replicate-model">
          <section className="rpt-replicate-ai-summary"><span><ReportIcon name="sparkle" />{language === "en" ? "AI STRUCTURE ANALYSIS" : "ANALISI STRUTTURA AI"}</span><p>{config.aiSummary || (language === "en" ? "After upload, the selected Reports AI analyzes sheets and proposes a first editable model." : "Dopo il caricamento, l’AI scelta in Reports analizza i fogli e propone un primo modello modificabile.")}</p></section>
          {config.templateBase64 && <section className="rpt-replicate-region-form"><h3>{language === "en" ? "Describe selected region" : "Descrivi l’area selezionata"}</h3><label>{language === "en" ? "Range" : "Intervallo"}<input value={draft.range} onChange={event => setDraft(current => ({ ...current, range: event.target.value.toUpperCase() }))} /></label><label>{language === "en" ? "Name" : "Nome"}<input value={draft.label} onChange={event => setDraft(current => ({ ...current, label: event.target.value }))} /></label><label>{language === "en" ? "Behavior" : "Comportamento"}<select value={draft.mode} onChange={event => setDraft(current => ({ ...current, mode: event.target.value as ReplicateXlsRegionMode }))}>{(["static", "singleCell", "tableRows", "tableColumns"] as const).map(mode => <option key={mode} value={mode}>{modeLabel(mode, language)}</option>)}</select></label><label>{language === "en" ? "What happens here" : "Cosa avviene qui"}<textarea rows={3} value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} /></label>{draft.mode !== "static" && <fieldset><legend>{language === "en" ? "Dataset fields" : "Campi del dataset"}</legend>{dataset.fields.map(field => <label key={field.id}><input type="checkbox" checked={draft.fieldIds.includes(field.id)} onChange={event => setDraft(current => ({ ...current, fieldIds: event.target.checked ? [...current.fieldIds, field.id] : current.fieldIds.filter(id => id !== field.id) }))} /><span>{field.name}</span><small>{field.type}</small></label>)}</fieldset>}{draft.mode === "tableRows" || draft.mode === "tableColumns" ? <label className="rpt-replicate-check"><input type="checkbox" checked={draft.includeHeaders} onChange={event => setDraft(current => ({ ...current, includeHeaders: event.target.checked }))} />{language === "en" ? "Write field names" : "Scrivi nomi dei campi"}</label> : null}<button className="rpt-button rpt-full-width" onClick={addRegion}><ReportIcon name="plus" />{t.area}</button></section>}
          <section className="rpt-replicate-regions"><h3>{language === "en" ? "Mapped regions" : "Aree mappate"} <span>{config.regions.length}</span></h3>{config.regions.map(region => <article key={region.id}><div><strong>{region.label}</strong><small>{region.sheetName} · {region.range} · {modeLabel(region.mode, language)}</small></div><p>{region.description}</p><button className="rpt-icon-button" aria-label="Elimina area" onClick={() => setConfig(current => ({ ...current, regions: current.regions.filter(item => item.id !== region.id) }))}><ReportIcon name="trash" /></button></article>)}</section>
        </aside>
      </div>
      {error && <div className="rpt-replicate-error" role="alert">{error}</div>}
      <footer><span aria-live="polite">{busy ? busyLabel : testReady ? (language === "en" ? "Test generated: inspect the populated sheet above." : "Test generato: controlla il foglio popolato qui sopra.") : (language === "en" ? "The original template is never modified." : "Il template originale non viene mai modificato.")}</span><button className="rpt-button" disabled={!config.templateBase64 || !config.regions.length || Boolean(busy)} onClick={() => void testModel()}>{t.test}</button><button className="rpt-button" disabled={!config.templateBase64 || !config.regions.length || Boolean(busy)} onClick={() => { setBusy("export"); void downloadReplicatedWorkbook(config, dataset).catch(reason => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setBusy(null)); }}>{t.export}</button><button className="rpt-button rpt-button-primary" disabled={!config.templateBase64 || !config.regions.length || Boolean(busy)} onClick={() => onSave(config)}>{t.save}</button></footer>
    </section>
  </div>;
}
