import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { AGGREGATION_LABELS_BY_LANGUAGE, CURRENCY_LABELS_BY_LANGUAGE, DEFAULT_MAP_BACKGROUND, DEFAULT_REPORT_THEME, WIDGET_LABELS, WIDGET_LABELS_BY_LANGUAGE, createDashboard, createWidget, defaultDashboardName, reportId, type Aggregation, type ReportDashboard, type ReportDataset, type ReportField, type ReportFilter, type ReportWidget, type TimeSeriesChartType, type TimeSeriesValueMode, type WidgetType } from "./types";
import { createDemoDashboard, importReportFile } from "./data";
import { deleteDashboard, importDashboard, listDashboards, saveDashboard } from "./storage";
import { dashboardEmbedCode, downloadDashboard, downloadDashboardHtml } from "./files";
import { ReportIcon } from "./ReportIcon";
import { TIME_GRAIN_LABELS_BY_LANGUAGE } from "./time-buckets";
import { DashboardGrid } from "./DashboardGrid";
import { createDashboardViewUrl } from "./url";
import { decodeFilterOption, encodeFilterOption, filterOptions, resolveFilterDefault, uniqueFilterValues } from "./filter-config";
import { isTemporalDimension } from "./aggregation";
import { TimeSeriesAnimationModal } from "./TimeSeriesAnimationModal";
import { useUiPreferences, type UiLanguage } from "../services/ui-preferences";
import "./reports.css";

const fieldSymbols = { text: "Abc", number: "#", date: "◷", boolean: "✓" };
type Confirmation = { title: string; message: string; label: string; run: () => void };
const messageOf = (error: unknown) => error instanceof Error ? error.message : "Operazione non riuscita. Riprova.";
type ChartOrder = "x-asc" | "x-desc" | "source" | "value-asc" | "value-desc";

function chartOrderValue(widget: ReportWidget, temporalSequence: boolean): ChartOrder {
  if (!temporalSequence && widget.sort !== "source") return `value-${widget.sort}`;
  return widget.xSort === "source" ? "source" : `x-${widget.xSort}`;
}

function chartOrderPatch(order: ChartOrder): Pick<ReportWidget, "sort" | "xSort"> {
  if (order === "source") return { sort: "source", xSort: "source" };
  if (order === "x-asc" || order === "x-desc") return { sort: "source", xSort: order === "x-asc" ? "asc" : "desc" };
  return { sort: order === "value-asc" ? "asc" : "desc", xSort: "source" };
}

function widgetDefaults(type: WidgetType, dataset?: ReportDataset, rowId = "", language: UiLanguage = "it"): ReportWidget {
  const widget = createWidget(type, dataset, rowId, language);
  if (type !== "scatter" || !dataset) return widget;
  const numeric = dataset.fields.filter(field => field.type === "number");
  return { ...widget, dimension: numeric[0]?.id ?? "", measure: numeric[1]?.id ?? numeric[0]?.id ?? "" };
}

function valuesForFilter(dashboard: ReportDashboard, filter: ReportFilter): string[] {
  const dataset = dashboard.datasets.find(item => item.id === filter.datasetId);
  return uniqueFilterValues(dataset?.rows.map(row => String(row[filter.fieldId] ?? "")) ?? []);
}

function FilterControl({ dashboard, filter, onChange }: { dashboard: ReportDashboard; filter: ReportFilter; onChange: (value: string | null) => void }) {
  const dataset = dashboard.datasets.find(item => item.id === filter.datasetId);
  const field = dataset?.fields.find(item => item.id === filter.fieldId);
  const options = filterOptions(valuesForFilter(dashboard, filter), filter);
  return <label className="rpt-filter-chip"><span>{field?.name}</span><select aria-label={`Filtro ${field?.name}`} value={encodeFilterOption(filter.value)} onChange={event => onChange(decodeFilterOption(event.target.value))}>{options.map(value => <option key={encodeFilterOption(value)} value={encodeFilterOption(value)}>{value === null ? "(Tutti)" : value || "(vuoto)"}</option>)}</select></label>;
}

function FilterEditor({ dashboard, filter, onPatch, onDelete }: { dashboard: ReportDashboard; filter: ReportFilter; onPatch: (patch: Partial<ReportFilter>) => void; onDelete: () => void }) {
  const dataset = dashboard.datasets.find(item => item.id === filter.datasetId);
  const field = dataset?.fields.find(item => item.id === filter.fieldId);
  const values = valuesForFilter(dashboard, filter);
  const defaults = filterOptions(values, filter);
  const targets = dashboard.widgets.filter(widget => widget.datasetId === filter.datasetId && widget.type !== "text");
  return <article className="rpt-filter-editor"><div className="rpt-filter-editor-main"><strong>{field?.name ?? "Campo non disponibile"}</strong><small>{dataset?.name}</small>
    <label>Valore iniziale<select aria-label={`Valore iniziale filtro ${field?.name}`} value={encodeFilterOption(filter.defaultValue)} onChange={event => { const defaultValue = decodeFilterOption(event.target.value); onPatch({ defaultValue, value: defaultValue }); }}>{defaults.map(value => <option key={encodeFilterOption(value)} value={encodeFilterOption(value)}>{value === null ? "(Tutti)" : value || "(vuoto)"}</option>)}</select></label>
    <label>Destinazione<select aria-label={`Destinazione filtro ${field?.name}`} value={filter.targetMode} onChange={event => onPatch({ targetMode: event.target.value as "all" | "selected", widgetIds: event.target.value === "all" ? [] : filter.widgetIds })}><option value="all">Tutti i widget dell’origine</option><option value="selected">Solo widget selezionati</option></select></label>
    <button className="rpt-icon-button" aria-label={`Elimina filtro ${field?.name}`} onClick={onDelete}><ReportIcon name="trash" /></button>
  </div><label className="rpt-filter-all-toggle"><input type="checkbox" checked={filter.includeAll} onChange={event => { const includeAll = event.target.checked; const defaultValue = resolveFilterDefault(values, { includeAll, defaultValue: filter.defaultValue }); onPatch({ includeAll, defaultValue, value: defaultValue }); }} /><span>Includi l’opzione “(Tutti)”</span></label>
  {filter.targetMode === "selected" && <fieldset className="rpt-filter-targets"><legend>Widget associati</legend>{targets.length ? targets.map(widget => <label key={widget.id}><input type="checkbox" checked={filter.widgetIds.includes(widget.id)} onChange={event => onPatch({ widgetIds: event.target.checked ? [...filter.widgetIds, widget.id] : filter.widgetIds.filter(id => id !== widget.id) })} /><span>{widget.title || WIDGET_LABELS[widget.type]}</span><small>{WIDGET_LABELS[widget.type]}</small></label>) : <p>Nessun widget usa questa origine dati.</p>}</fieldset>}
  </article>;
}

function DashboardTabBar({ dashboard, activeTabId, editable, onSelect, onAdd }: { dashboard: ReportDashboard; activeTabId: string; editable?: boolean; onSelect: (tabId: string) => void; onAdd?: () => void }) {
  if (!editable && dashboard.tabs.length < 2) return null;
  return <nav className="rpt-dashboard-tabs" aria-label="Tab dashboard">{dashboard.tabs.map(tab => <button key={tab.id} type="button" className={tab.id === activeTabId ? "is-active" : ""} aria-pressed={tab.id === activeTabId} onClick={() => onSelect(tab.id)}><ReportIcon name="tab" />{tab.name}</button>)}{editable && <button type="button" className="rpt-add-tab" onClick={onAdd}><ReportIcon name="plus" />Nuovo tab</button>}</nav>;
}

export function ReportsWorkspace({ onHome, viewDashboardId = null, onOpenViewer }: { onHome: () => void; viewDashboardId?: string | null; onOpenViewer?: (dashboardId: string) => void }) {
  const { language } = useUiPreferences();
  const locale = language === "en" ? "en-GB" : "it-IT";
  const widgetLabels = WIDGET_LABELS_BY_LANGUAGE[language];
  const aggregationLabels = AGGREGATION_LABELS_BY_LANGUAGE[language];
  const currencyLabels = CURRENCY_LABELS_BY_LANGUAGE[language];
  const timeGrainLabels = TIME_GRAIN_LABELS_BY_LANGUAGE[language];
  const [dashboard, setDashboard] = useState<ReportDashboard>(() => createDashboard(undefined, language));
  const [savedSnapshot, setSavedSnapshot] = useState(() => "");
  const [saved, setSaved] = useState<ReportDashboard[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string>(() => dashboard.layoutRows[0]!.id);
  const [activeTabId, setActiveTabId] = useState<string>(() => dashboard.tabs[0]!.id);
  const [activeDatasetId, setActiveDatasetId] = useState("");
  const [fieldSearch, setFieldSearch] = useState("");
  const [view, setView] = useState<"dashboard" | "data">("dashboard");
  const [preview, setPreview] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const [widgetMenuOpen, setWidgetMenuOpen] = useState(false);
  const [widgetMenuMode, setWidgetMenuMode] = useState<"add" | "replace">("add");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Il tuo prossimo report inizia qui.");
  const [dataPage, setDataPage] = useState(0);
  const [filterField, setFilterField] = useState("");
  const [activeFilterValues, setActiveFilterValues] = useState<Record<string, string | null>>({});
  const [shareUrl, setShareUrl] = useState("");
  const [embedCode, setEmbedCode] = useState("");
  const [viewerLoading, setViewerLoading] = useState(Boolean(viewDashboardId));
  const [animationWidgetId, setAnimationWidgetId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const dashboardRef = useRef(dashboard); dashboardRef.current = dashboard;
  const selected = dashboard.widgets.find(widget => widget.id === selectedId);
  const activeDataset = dashboard.datasets.find(dataset => dataset.id === activeDatasetId) ?? dashboard.datasets[0];
  const selectedDataset = dashboard.datasets.find(dataset => dataset.id === selected?.datasetId);
  const selectedDimensionField = selectedDataset?.fields.find(field => field.id === selected?.dimension);
  const selectedTemporalSequence = Boolean(selected && (["line", "area"] as WidgetType[]).includes(selected.type) && isTemporalDimension(selectedDimensionField, selectedDataset?.rows ?? []));
  const activeTab = dashboard.tabs.find(tab => tab.id === activeTabId) ?? dashboard.tabs[0];
  const activeTabRows = dashboard.layoutRows.filter(row => row.tabId === activeTab?.id);
  const activeRowIds = new Set(activeTabRows.map(row => row.id));
  const activeTabWidgets = dashboard.widgets.filter(widget => activeRowIds.has(widget.rowId));
  const selectedRow = activeTabRows.find(row => row.id === selectedRowId) ?? activeTabRows[0];
  const snapshot = useMemo(() => JSON.stringify(dashboard), [dashboard]);
  const dirty = savedSnapshot ? snapshot !== savedSnapshot : Boolean(
    dashboard.datasets.length || dashboard.widgets.length || dashboard.name !== defaultDashboardName(language) || dashboard.description
    || dashboard.tabs.length !== 1 || dashboard.tabs[0]?.name !== (language === "en" ? "Page 1" : "Pagina 1") || dashboard.layoutRows.length !== 1 || dashboard.layoutRows[0]?.columns !== null
    || JSON.stringify(dashboard.theme) !== JSON.stringify(DEFAULT_REPORT_THEME),
  );
  const totalRows = dashboard.datasets.reduce((sum, dataset) => sum + dataset.rows.length, 0);
  const fields = activeDataset?.fields.filter(field => field.name.toLocaleLowerCase().includes(fieldSearch.toLocaleLowerCase())) ?? [];
  const activeFilters = useMemo(() => dashboard.filters.map(filter => ({ ...filter, value: Object.hasOwn(activeFilterValues, filter.id) ? activeFilterValues[filter.id]! : filter.defaultValue })), [activeFilterValues, dashboard.filters]);
  const renderedDashboard = useMemo(() => ({ ...dashboard, filters: activeFilters }), [activeFilters, dashboard]);
  const animationWidget = dashboard.widgets.find(widget => widget.id === animationWidgetId);
  const animationDataset = dashboard.datasets.find(dataset => dataset.id === animationWidget?.datasetId);

  useEffect(() => { let active = true; void listDashboards().then(items => {
    if (!active) return;
    setSaved(items);
    if (viewDashboardId) {
      const target = items.find(item => item.id === viewDashboardId);
      if (target) load(target, true);
      else setError("Dashboard non trovata nell’archivio locale di MLSM Studio.");
      setViewerLoading(false);
    }
  }).catch(reason => { if (active) { setError(messageOf(reason)); setViewerLoading(false); } }); return () => { active = false; }; }, [viewDashboardId]);
  useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler); }, [dirty]);
  useEffect(() => { const handler = (event: KeyboardEvent) => { if (event.key === "Escape") { setLibraryOpen(false); setFilterMenuOpen(false); setWidgetMenuOpen(false); setEmbedCode(""); setConfirmation(null); } }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, []);

  function change(updater: (current: ReportDashboard) => ReportDashboard) { setDashboard(updater); setError(""); setStatus("Modifiche da salvare"); }
  function patchWidget(patch: Partial<ReportWidget>) { if (selectedId) change(current => ({
    ...current,
    widgets: current.widgets.map(widget => widget.id === selectedId ? { ...widget, ...patch } : widget),
    filters: patch.datasetId === undefined ? current.filters : current.filters.map(filter => filter.targetMode === "selected" && filter.datasetId !== patch.datasetId ? { ...filter, widgetIds: filter.widgetIds.filter(id => id !== selectedId) } : filter),
  })); }
  function load(next: ReportDashboard, persisted = false) {
    setDashboard(next); setSavedSnapshot(persisted ? JSON.stringify(next) : ""); setSelectedId(null); setActiveDatasetId(next.datasets[0]?.id ?? "");
    setActiveFilterValues(Object.fromEntries(next.filters.map(filter => { const dataset = next.datasets.find(item => item.id === filter.datasetId); const values = dataset?.rows.map(row => String(row[filter.fieldId] ?? "")) ?? []; return [filter.id, resolveFilterDefault(values, filter)]; })));
    setLibraryOpen(false); setFilterMenuOpen(false); setWidgetMenuOpen(false); setShareUrl(""); setEmbedCode(""); setAnimationWidgetId(null); setView("dashboard"); setPreview(false); setError(""); setDataPage(0); setFilterField(""); setActiveTabId(next.tabs[0]!.id); setSelectedRowId(next.layoutRows.find(row => row.tabId === next.tabs[0]!.id)!.id); setStatus(persisted ? "Dashboard caricata" : "Modifiche da salvare");
  }
  function protect(run: () => void) { if (dirty) setConfirmation({ title: "Modifiche non salvate", message: "Le modifiche di questa dashboard andranno perse. Puoi annullare e salvarle prima di continuare.", label: "Continua senza salvare", run }); else run(); }
  async function saveCurrent(): Promise<ReportDashboard | null> {
    setBusy(true); setError("");
    try {
      const next = { ...dashboardRef.current, name: dashboardRef.current.name.trim() || defaultDashboardName(language), updatedAt: new Date().toISOString(), filters: dashboardRef.current.filters.map(filter => ({ ...filter, value: filter.defaultValue })) };
      await saveDashboard(next); setDashboard(next); setSavedSnapshot(JSON.stringify(next));
      setSaved(current => [next, ...current.filter(item => item.id !== next.id)]); setStatus("Salvata nell’archivio locale di MLSM Studio");
      return next;
    } catch (reason) { setError(messageOf(reason)); return null; } finally { setBusy(false); }
  }
  async function addFiles(files: File[]) {
    if (!files.length) return; setBusy(true); setError(""); setStatus("Lettura dei dati…");
    try {
      const datasets: ReportDataset[] = [];
      for (const file of files) datasets.push(...await importReportFile(file));
      if (dashboardRef.current.datasets.length + datasets.length > 20) throw new Error("Una dashboard può contenere al massimo 20 origini dati.");
      change(current => ({ ...current, datasets: [...current.datasets, ...datasets] })); setActiveDatasetId(datasets[0]?.id ?? ""); setDataPage(0); setFilterField("");
      setStatus(`${datasets.length} ${datasets.length === 1 ? "origine caricata" : "origini caricate"}. Scegli un widget per iniziare.`);
    } catch (reason) { setError(messageOf(reason)); setStatus("Importazione non completata"); } finally { setBusy(false); }
  }
  async function readJson(file: File) {
    setBusy(true); setError("");
    try { if (file.size > 50 * 1024 * 1024) throw new Error("Il JSON supera il limite di 50 MB."); const imported = importDashboard(await file.text()); load(imported); setStatus("Dashboard importata. Salvala per aggiungerla alla libreria."); }
    catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); }
  }
  function addWidget(type: WidgetType) {
    if (dashboard.widgets.length >= 100) { setError("Puoi inserire fino a 100 widget."); return; }
    const rowId = selectedRow?.id ?? activeTabRows[0]!.id;
    const widget = widgetDefaults(type, activeDataset, rowId, language);
    change(current => ({ ...current, widgets: [...current.widgets, widget] })); setSelectedId(widget.id); setView("dashboard"); setWidgetMenuOpen(false);
  }
  function convertSelectedWidget(type: WidgetType) {
    if (!selected) return;
    const targetDataset = selectedDataset ?? activeDataset;
    const defaults = widgetDefaults(type, targetDataset, selected.rowId, language);
    const genericTitle = Object.values(WIDGET_LABELS_BY_LANGUAGE).some(labels => Object.values(labels).includes(selected.title));
    const patch: Partial<ReportWidget> = { type, title: genericTitle ? WIDGET_LABELS_BY_LANGUAGE[language][type] : selected.title };
    if (type !== "text" && targetDataset) {
      if (!selected.datasetId && activeDataset) patch.datasetId = activeDataset.id;
      if (!["kpi", "table"].includes(type) && !selected.dimension) patch.dimension = defaults.dimension;
      if (type !== "table" && !selected.measure) patch.measure = defaults.measure;
    }
    if (type === "scatter") {
      const numeric = selectedDataset?.fields.filter(field => field.type === "number") ?? [];
      patch.dimension = numeric.some(field => field.id === selected.dimension) ? selected.dimension : numeric[0]?.id ?? "";
      patch.measure = numeric.some(field => field.id === selected.measure) ? selected.measure : numeric[1]?.id ?? numeric[0]?.id ?? "";
    }
    if (type === "pivot" && !selected.secondaryDimension) patch.secondaryDimension = defaults.secondaryDimension;
    if (type === "text") patch.animation = null;
    patchWidget(patch); setWidgetMenuOpen(false); setWidgetMenuMode("add");
  }
  function openWidgetLibrary(mode: "add" | "replace") { setWidgetMenuMode(mode); setWidgetMenuOpen(true); }
  function duplicateWidget(widget: ReportWidget) {
    if (dashboard.widgets.length >= 100) { setError("Puoi inserire fino a 100 widget."); return; }
    const copy = { ...widget, id: reportId(), title: `${widget.title} · copia` };
    change(current => ({ ...current, widgets: [...current.widgets, copy] })); setSelectedId(copy.id);
  }
  function moveWidget(id: string, offset: number) { change(current => { const widgets = [...current.widgets]; const item = widgets.find(widget => widget.id === id); if (!item) return current; const rowWidgets = widgets.filter(widget => widget.rowId === item.rowId); const rowIndex = rowWidgets.findIndex(widget => widget.id === id); const target = rowWidgets[rowIndex + offset]; if (!target) return current; const from = widgets.findIndex(widget => widget.id === id); const to = widgets.findIndex(widget => widget.id === target.id); [widgets[from], widgets[to]] = [widgets[to]!, widgets[from]!]; return { ...current, widgets }; }); }
  function moveWidgetTo(id: string, targetId: string, rowId: string) { if (id === targetId) return; change(current => { const widgets = [...current.widgets]; const from = widgets.findIndex(widget => widget.id === id); const to = widgets.findIndex(widget => widget.id === targetId); if (from < 0 || to < 0) return current; const [item] = widgets.splice(from, 1); const nextTarget = widgets.findIndex(widget => widget.id === targetId); widgets.splice(nextTarget < 0 ? widgets.length : nextTarget, 0, { ...item!, rowId }); return { ...current, widgets }; }); setSelectedRowId(rowId); }
  function deleteWidget(widget: ReportWidget) { change(current => ({ ...current, widgets: current.widgets.filter(item => item.id !== widget.id), filters: current.filters.map(filter => filter.targetMode === "selected" ? { ...filter, widgetIds: filter.widgetIds.filter(id => id !== widget.id) } : filter) })); if (selectedId === widget.id) setSelectedId(null); }
  function addLayoutRow() { if (!activeTab) return; const row = { id: reportId(), tabId: activeTab.id, columns: null }; change(current => ({ ...current, layoutRows: [...current.layoutRows, row] })); setSelectedRowId(row.id); setSelectedId(null); }
  function setRowColumns(rowId: string, columns: number | null) { change(current => ({ ...current, layoutRows: current.layoutRows.map(row => row.id === rowId ? { ...row, columns } : row) })); setSelectedRowId(rowId); }
  function deleteLayoutRow(rowId: string) { const fallback = activeTabRows.find(row => row.id !== rowId); if (!fallback) return; change(current => ({ ...current, layoutRows: current.layoutRows.filter(row => row.id !== rowId), widgets: current.widgets.map(widget => widget.rowId === rowId ? { ...widget, rowId: fallback.id } : widget) })); setSelectedRowId(fallback.id); }
  function selectTab(tabId: string) { const row = dashboard.layoutRows.find(item => item.tabId === tabId); if (!row) return; setActiveTabId(tabId); setSelectedRowId(row.id); setSelectedId(null); setView("dashboard"); }
  function addTab() { if (dashboard.tabs.length >= 20) { setError("Una dashboard può contenere al massimo 20 tab."); return; } const tab = { id: reportId(), name: `${language === "en" ? "Page" : "Pagina"} ${dashboard.tabs.length + 1}` }; const row = { id: reportId(), tabId: tab.id, columns: null }; change(current => ({ ...current, tabs: [...current.tabs, tab], layoutRows: [...current.layoutRows, row] })); setActiveTabId(tab.id); setSelectedRowId(row.id); setSelectedId(null); setView("dashboard"); }
  function deleteActiveTab() { if (!activeTab || dashboard.tabs.length === 1) return; const fallback = dashboard.tabs.find(tab => tab.id !== activeTab.id)!; setConfirmation({ title: `Eliminare il tab “${activeTab.name}”?`, message: "Verranno eliminati i widget e le righe contenuti in questo tab. Le origini dati restano disponibili.", label: "Elimina tab", run: () => { const removedRows = new Set(dashboard.layoutRows.filter(row => row.tabId === activeTab.id).map(row => row.id)); const removedWidgets = new Set(dashboard.widgets.filter(widget => removedRows.has(widget.rowId)).map(widget => widget.id)); change(current => ({ ...current, tabs: current.tabs.filter(tab => tab.id !== activeTab.id), layoutRows: current.layoutRows.filter(row => row.tabId !== activeTab.id), widgets: current.widgets.filter(widget => !removedRows.has(widget.rowId)), filters: current.filters.map(filter => ({ ...filter, widgetIds: filter.widgetIds.filter(id => !removedWidgets.has(id)) })) })); setActiveTabId(fallback.id); setSelectedRowId(dashboard.layoutRows.find(row => row.tabId === fallback.id)!.id); setSelectedId(null); } }); }
  function applyAggregation(aggregation: Aggregation) { if (!selected) return; const numeric = selectedDataset?.fields.find(field => field.type === "number")?.id ?? ""; const any = selectedDataset?.fields[0]?.id ?? ""; patchWidget({ aggregation, measure: aggregation === "count" ? selected.measure : aggregation === "distinct" ? selected.measure || any : selectedDataset?.fields.find(field => field.id === selected.measure)?.type === "number" ? selected.measure : numeric }); }
  function addTimeSeriesAnimation() {
    const dimension = selectedDataset?.fields.find(field => field.type === "date")?.id;
    if (!dimension) { setError("Per aggiungere Time Series serve almeno un campo data nell’origine del widget."); return; }
    patchWidget({ animation: { type: "timeSeries", chartType: "line", dimension, timeGrain: "month", valueMode: "period", showTrendLine: false, highlightMaximum: true } });
  }
  function patchAnimation(patch: Partial<NonNullable<ReportWidget["animation"]>>) {
    if (selected?.animation) patchWidget({ animation: { ...selected.animation, ...patch } });
  }
  async function createShareLink() { const savedDashboard = await saveCurrent(); if (!savedDashboard) return; setShareUrl(createDashboardViewUrl(savedDashboard.id)); }
  async function exportHtml() { setBusy(true); setError(""); try { const done = await downloadDashboardHtml(dashboardRef.current); if (done) { setEmbedCode(dashboardEmbedCode(dashboardRef.current)); setStatus("Dashboard HTML esportata con codice di incorporamento"); } } catch (reason) { setError(messageOf(reason)); } finally { setBusy(false); } }
  function bindField(field: ReportField, dataset = activeDataset) {
    if (!dataset || !selected || selected.type === "text") return;
    const defaults = selected.datasetId !== dataset.id ? widgetDefaults(selected.type, dataset, "", language) : selected;
    const patch: Partial<ReportWidget> = { datasetId: dataset.id, dimension: defaults.dimension, measure: defaults.measure, aggregation: defaults.aggregation, xSort: defaults.xSort, ...(selected.datasetId !== dataset.id ? { animation: null } : {}) };
    if (field.type === "number") { patch.measure = field.id; patch.aggregation = selected.aggregation === "count" ? "sum" : selected.aggregation; }
    else { patch.dimension = field.id; patch.xSort = "asc"; }
    patchWidget(patch);
  }
  function fieldDrop(event: DragEvent, target: "dimension" | "measure") {
    event.preventDefault();
    try { const value: unknown = JSON.parse(event.dataTransfer.getData("application/mlsm-report-field")); if (typeof value !== "object" || value === null || !("datasetId" in value) || !("fieldId" in value)) return;
      const dataset = dashboard.datasets.find(item => item.id === value.datasetId); const field = dataset?.fields.find(item => item.id === value.fieldId);
      const numericMeasureRequired = selected?.type === "scatter" || (target === "measure" && selected?.aggregation !== "distinct");
      if (!dataset || !field || !selected || (numericMeasureRequired && field.type !== "number")) return;
      const defaults = widgetDefaults(selected.type, dataset, "", language); patchWidget({ ...(selected.datasetId !== dataset.id ? { dimension: defaults.dimension, measure: defaults.measure, xSort: defaults.xSort, animation: null } : {}), datasetId: dataset.id, [target]: field.id, ...(target === "dimension" ? { xSort: "asc" } : {}), ...(target === "measure" && selected.aggregation !== "distinct" ? { aggregation: "sum" } : {}) });
    } catch { /* Ignore unrelated dragged content. */ }
  }
  function removeDataset(dataset: ReportDataset) { setConfirmation({ title: `Rimuovere “${dataset.name}”?`, message: "Verranno rimossi anche i widget e i filtri collegati a questa origine nella dashboard corrente.", label: "Rimuovi origine", run: () => { change(current => ({ ...current, datasets: current.datasets.filter(item => item.id !== dataset.id), widgets: current.widgets.flatMap(item => item.datasetId !== dataset.id ? [item] : item.type === "text" ? [{ ...item, datasetId: "", dimension: "", secondaryDimension: "", measure: "" }] : []), filters: current.filters.filter(item => item.datasetId !== dataset.id) })); setActiveDatasetId(""); setSelectedId(null); setFilterField(""); } }); }
  function addFilter() { if (!activeDataset || !filterField) return; const id = reportId(); change(current => ({ ...current, filters: [...current.filters, { id, datasetId: activeDataset.id, fieldId: filterField, value: null, defaultValue: null, includeAll: true, targetMode: "all", widgetIds: [] }] })); setActiveFilterValues(current => ({ ...current, [id]: null })); setFilterField(""); }
  const themeStyle = { "--rpt-accent": dashboard.theme.accent, "--rpt-ink": dashboard.theme.ink, "--rpt-paper": dashboard.theme.paper } as CSSProperties;

  if (viewDashboardId) return <main className="rpt-workspace rpt-shared-view" style={themeStyle} aria-label="Report in sola visualizzazione">
    <header className="rpt-shared-header"><div className="rpt-brand"><span className="rpt-brand-mark"><ReportIcon name="reports" /></span><span><strong>Reports<span className="rpt-brand-dot">.</span></strong><small>MLSM STUDIO · SOLA VISUALIZZAZIONE</small></span></div><button className="rpt-button" onClick={onHome}><ReportIcon name="back" />Torna a Studio</button></header>
    {viewerLoading ? <div className="rpt-shared-state" role="status">Caricamento dashboard…</div> : error ? <div className="rpt-shared-state" role="alert">{error}</div> : <div className="rpt-shared-scroll">
      <section className="rpt-dashboard-paper">
        <header className="rpt-report-heading"><span className="rpt-eyebrow">MLSM REPORTS</span><h1>{dashboard.name}</h1>{dashboard.description && <p>{dashboard.description}</p>}</header>
        <DashboardTabBar dashboard={dashboard} activeTabId={activeTab?.id ?? ""} onSelect={selectTab} />
        {activeFilters.length > 0 && <div className="rpt-filter-bar">{activeFilters.map(filter => <FilterControl key={filter.id} dashboard={dashboard} filter={filter} onChange={value => setActiveFilterValues(current => ({ ...current, [filter.id]: value }))} />)}</div>}
        <DashboardGrid dashboard={renderedDashboard} tabId={activeTab?.id} readOnly onPlayAnimation={widget => setAnimationWidgetId(widget.id)} />
      </section>
      {animationWidget && animationDataset && <TimeSeriesAnimationModal widget={animationWidget} dataset={animationDataset} filters={activeFilters} theme={dashboard.theme} onClose={() => setAnimationWidgetId(null)} />}
    </div>}
  </main>;

  return <main className={`rpt-workspace${preview ? " rpt-preview" : ""}`} style={themeStyle} aria-label="MLSM Reports">
    <input ref={fileInput} className="rpt-sr-only" type="file" tabIndex={-1} aria-label="Carica dati CSV, testo o Excel" multiple accept=".csv,.tsv,.txt,.xlsx,.xls" onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void addFiles(files); }} />
    <input ref={jsonInput} className="rpt-sr-only" type="file" tabIndex={-1} aria-label="Importa dashboard JSON" accept=".json,application/json" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) protect(() => { void readJson(file); }); }} />
    <fieldset className="rpt-app" disabled={busy}>
      <header className="rpt-topbar">
        <button className="rpt-icon-button" aria-label="Torna alle aree" title="Torna alle aree" onClick={() => protect(onHome)}><ReportIcon name="back" /></button>
        <div className="rpt-brand"><span className="rpt-brand-mark"><ReportIcon name="reports" /></span><span><strong>Reports<span className="rpt-brand-dot">.</span></strong><small>MLSM STUDIO</small></span></div>
        <span className="rpt-topbar-divider" />
        <button className="rpt-button" onClick={() => setLibraryOpen(true)}><ReportIcon name="folder" />Le mie dashboard<span className="rpt-count">{saved.length}</span></button>
        <div className="rpt-topbar-actions">
          <button className="rpt-button" onClick={() => jsonInput.current?.click()}><ReportIcon name="upload" />Importa JSON</button>
          <button className="rpt-button" onClick={() => { setBusy(true); void downloadDashboard(dashboard).then(done => { if (done) setStatus("JSON esportato con dati, widget e colori"); }).catch(reason => setError(messageOf(reason))).finally(() => setBusy(false)); }}><ReportIcon name="download" />Esporta JSON</button>
          <button className="rpt-button" onClick={() => { void exportHtml(); }}><ReportIcon name="code" />Esporta HTML</button>
          <button className="rpt-button" onClick={() => { void createShareLink(); }}><ReportIcon name="link" />Link visualizzazione</button>
          <button className="rpt-button rpt-button-primary" onClick={() => { void saveCurrent(); }}><ReportIcon name="save" />Salva dashboard</button>
        </div>
      </header>
      <div className="rpt-document-bar">
        <div className="rpt-document-title"><label htmlFor="rpt-dashboard-name">NOME DASHBOARD</label><div><input ref={nameInput} id="rpt-dashboard-name" aria-label="Nome dashboard" value={dashboard.name} maxLength={120} onChange={event => change(current => ({ ...current, name: event.target.value }))} /><button type="button" className="rpt-icon-button" aria-label="Modifica nome dashboard" onClick={() => { nameInput.current?.focus(); nameInput.current?.select(); }}><ReportIcon name="edit" /></button></div><span className={`rpt-save-state${dirty ? " is-dirty" : ""}`}>{dirty ? "Modifiche non salvate" : savedSnapshot ? "Salvata" : "Nuova dashboard"}</span></div>
        <div className="rpt-document-actions"><button className="rpt-button" onClick={() => protect(() => load(createDashboard(undefined, language)))}><ReportIcon name="plus" />Nuova</button><button className={`rpt-button${preview ? " is-active" : ""}`} aria-pressed={preview} onClick={() => { setPreview(!preview); setView("dashboard"); }}><ReportIcon name={preview ? "edit" : "eye"} />{preview ? "Torna all’editor" : "Anteprima"}</button></div>
      </div>
      {error && <div className="rpt-alert" role="alert"><span>{error}</span><button className="rpt-icon-button" aria-label="Chiudi messaggio" onClick={() => setError("")}><ReportIcon name="close" /></button></div>}
      <div className="rpt-body">
        {!preview && <aside className="rpt-data-panel" aria-label="Origini e campi">
          <div className="rpt-panel-heading"><span>DATI</span><span className="rpt-small-badge">{dashboard.datasets.length} origini</span></div>
          <button className="rpt-add-source" onClick={() => fileInput.current?.click()}><ReportIcon name="plus" /><span>Aggiungi dati<small>CSV, TXT, TSV, Excel</small></span><ReportIcon name="upload" /></button>
          {dashboard.datasets.length > 0 && <div className="rpt-source-list">{dashboard.datasets.map(dataset => <div key={dataset.id} className={`rpt-source${dataset.id === activeDataset?.id ? " is-active" : ""}`}><button title={dataset.sourceName} onClick={() => { setActiveDatasetId(dataset.id); setDataPage(0); setFilterField(""); }}><ReportIcon name="file" /><span>{dataset.name}<small>{dataset.rows.length.toLocaleString(locale)} righe · {dataset.fields.length} campi</small></span></button><button className="rpt-icon-button" aria-label={`Rimuovi origine ${dataset.name}`} onClick={() => removeDataset(dataset)}><ReportIcon name="close" /></button></div>)}</div>}
          <div className="rpt-panel-heading"><span>CAMPI</span><span className="rpt-small-badge">{activeDataset?.fields.length ?? 0}</span></div>
          <label className="rpt-search"><ReportIcon name="search" /><input placeholder="Cerca un campo…" aria-label="Cerca campi" value={fieldSearch} onChange={event => setFieldSearch(event.target.value)} /></label>
          <div className="rpt-field-list">{fields.length ? fields.map(field => <button key={field.id} draggable onDragStart={event => { event.dataTransfer.setData("application/mlsm-report-field", JSON.stringify({ datasetId: activeDataset?.id, fieldId: field.id })); event.dataTransfer.effectAllowed = "copy"; }} className={`rpt-field rpt-field-${field.type}`} title={`${field.name} · ${field.type === "number" ? "Misura numerica" : "Dimensione"}. ${selected ? "Clicca per assegnare al widget selezionato" : "Seleziona un widget, poi assegna il campo"}`} onClick={() => bindField(field)}><span>{fieldSymbols[field.type]}</span><b>{field.name}</b><ReportIcon name="grip" /></button>) : <p className="rpt-panel-hint">{activeDataset ? "Nessun campo trovato." : "Carica un file per esplorare dimensioni e misure."}</p>}</div>
          {activeDataset && <p className="rpt-panel-hint">Trascina i campi sulle aree Dimensione e Misura, oppure seleziona un widget e clicca un campo.</p>}
          <div className="rpt-local-note"><span className="rpt-status-dot" />Elaborazione e archivio locale · mai su Git</div>
        </aside>}
        <section className="rpt-center" aria-label="Composizione dashboard">
          <div className="rpt-canvas-toolbar"><div className="rpt-view-tabs"><button className={view === "dashboard" ? "is-active" : ""} onClick={() => setView("dashboard")}><ReportIcon name="reports" />Dashboard</button>{!preview && <button className={view === "data" ? "is-active" : ""} disabled={!activeDataset} onClick={() => setView("data")}><ReportIcon name="table" />Anteprima dati</button>}</div><div className="rpt-canvas-actions">{!preview && <><button className="rpt-button" onClick={addLayoutRow}><ReportIcon name="row" />Aggiungi riga</button><button className="rpt-button" onClick={() => openWidgetLibrary("add")}><ReportIcon name="plus" />Aggiungi widget</button></>}<button className={`rpt-button${filterMenuOpen ? " is-active" : ""}`} onClick={() => setFilterMenuOpen(open => !open)}><ReportIcon name="filter" />Filtri <span className="rpt-count">{dashboard.filters.length}</span></button><span className="rpt-canvas-meta">{activeTabWidgets.length} widget nel tab <span>·</span> {totalRows.toLocaleString("it-IT")} righe</span></div></div>
          {filterMenuOpen && <section className="rpt-filter-menu" aria-label="Configura filtri dashboard">
            <header><div><span className="rpt-eyebrow">FILTRI INTERATTIVI</span><h2>Controlli della dashboard</h2><p>Scegli il campo, il valore e i grafici che devono rispondere al filtro.</p></div><button className="rpt-icon-button" aria-label="Chiudi menu filtri" onClick={() => setFilterMenuOpen(false)}><ReportIcon name="close" /></button></header>
            <div className="rpt-filter-create"><label className="rpt-control">Origine<select value={activeDataset?.id ?? ""} onChange={event => { setActiveDatasetId(event.target.value); setFilterField(""); }}><option value="" disabled>Seleziona origine</option>{dashboard.datasets.map(dataset => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select></label><label className="rpt-control">Campo<select value={filterField} onChange={event => setFilterField(event.target.value)}><option value="">Seleziona campo</option>{activeDataset?.fields.map(field => <option key={field.id} value={field.id}>{field.name}</option>)}</select></label><button className="rpt-button rpt-button-primary" disabled={!filterField} onClick={addFilter}><ReportIcon name="plus" />Crea filtro</button></div>
            {dashboard.filters.length ? <div className="rpt-filter-editor-list">{dashboard.filters.map(filter => <FilterEditor key={filter.id} dashboard={dashboard} filter={filter} onPatch={patch => { change(current => ({ ...current, filters: current.filters.map(item => item.id === filter.id ? { ...item, ...patch } : item) })); if (Object.hasOwn(patch, "defaultValue")) setActiveFilterValues(current => ({ ...current, [filter.id]: patch.defaultValue ?? null })); }} onDelete={() => { change(current => ({ ...current, filters: current.filters.filter(item => item.id !== filter.id) })); setActiveFilterValues(current => { const next = { ...current }; delete next[filter.id]; return next; }); }} />)}</div> : <p className="rpt-filter-menu-empty">Non ci sono filtri. Creane uno scegliendo un campo dell’origine attiva.</p>}
          </section>}
          <div className="rpt-canvas-scroll">
            {view === "data" && activeDataset ? <div className="rpt-data-preview"><div><span className="rpt-eyebrow">ORIGINE DATI</span><h2>{activeDataset.name}</h2><p>{activeDataset.sourceName} · {activeDataset.rows.length.toLocaleString("it-IT")} righe</p></div><div className="rpt-table-wrap"><table className="rpt-data-table"><thead><tr>{activeDataset.fields.map(field => <th key={field.id}><small>{fieldSymbols[field.type]}</small> {field.name}</th>)}</tr></thead><tbody>{activeDataset.rows.slice(dataPage * 50, (dataPage + 1) * 50).map((row, index) => <tr key={index}>{activeDataset.fields.map(field => <td key={field.id}>{row[field.id] === null ? "—" : String(row[field.id] ?? "")}</td>)}</tr>)}</tbody></table></div><div className="rpt-table-footer"><span>Pagina {dataPage + 1} di {Math.max(1, Math.ceil(activeDataset.rows.length / 50))}</span><button className="rpt-button" disabled={!dataPage} onClick={() => setDataPage(page => page - 1)}>Precedente</button><button className="rpt-button" disabled={(dataPage + 1) * 50 >= activeDataset.rows.length} onClick={() => setDataPage(page => page + 1)}>Successiva</button></div></div> : <>
              <DashboardTabBar dashboard={dashboard} activeTabId={activeTab?.id ?? ""} editable={!preview} onSelect={selectTab} onAdd={addTab} />
              {activeFilters.length > 0 && <div className="rpt-filter-bar"><ReportIcon name="filter" />{activeFilters.map(filter => <FilterControl key={filter.id} dashboard={dashboard} filter={filter} onChange={value => setActiveFilterValues(current => ({ ...current, [filter.id]: value }))} />)}</div>}
              {!activeTabWidgets.length ? <div className="rpt-empty" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (event.dataTransfer.files.length) void addFiles(Array.from(event.dataTransfer.files)); }}>
                <div className="rpt-empty-art" aria-hidden="true"><span className="rpt-mini-kpi"><small>TOTAL OVERVIEW</small><b>24.8k</b><i>↗ +18.6%</i></span><span className="rpt-mini-bars"><i /><i /><i /><i /><i /><i /><i /></span><span className="rpt-mini-donut" /><span className="rpt-mini-label">I tuoi dati. Una nuova prospettiva.</span></div>
                <span className="rpt-eyebrow">DAI NUMERI ALLE IDEE</span><h1>{activeDataset ? "I dati ci sono. Dai forma al report." : "Una storia da raccontare,\nun dato alla volta."}</h1><p>{activeDataset ? "Aggiungi un widget dal pannello a destra. Collega i campi e guarda la tua dashboard prendere forma." : "Carica un file, scegli i campi e componi una dashboard. Tutto il necessario, nello spazio giusto."}</p>
                <div className="rpt-empty-actions">{activeDataset ? <button className="rpt-button rpt-button-primary" onClick={() => openWidgetLibrary("add")}><ReportIcon name="plus" />Scegli il primo widget</button> : <button className="rpt-button rpt-button-primary" onClick={() => fileInput.current?.click()}><ReportIcon name="upload" />Carica il tuo primo file</button>}<button className="rpt-button" onClick={() => protect(() => load(createDemoDashboard(language)))}>Esplora un esempio <span>↗</span></button></div><span className="rpt-empty-formats">CSV · TESTO · EXCEL <span>·</span> Trascina qui il file</span>
                <div className="rpt-steps"><span><b>01</b>Collega i dati</span><span><b>02</b>Componi il report</span><span><b>03</b>Salva e condividi</span></div>
              </div> : <div className="rpt-dashboard-paper">
                <header className="rpt-report-heading"><span className="rpt-eyebrow">MLSM REPORTS</span><h1>{dashboard.name || defaultDashboardName(language)}</h1>{dashboard.description && <p>{dashboard.description}</p>}</header>
                <DashboardGrid dashboard={renderedDashboard} tabId={activeTab?.id} readOnly={preview} selectedWidgetId={selectedId} selectedRowId={selectedRowId} onSelectWidget={setSelectedId} onSelectRow={setSelectedRowId} onMoveWidget={moveWidget} onMoveWidgetTo={moveWidgetTo} onDuplicateWidget={duplicateWidget} onDeleteWidget={deleteWidget} onSetRowColumns={setRowColumns} onDeleteRow={deleteLayoutRow} onChangeWidgetType={() => openWidgetLibrary("replace")} onPlayAnimation={widget => setAnimationWidgetId(widget.id)} />
                {!preview && <button className="rpt-add-widget-hint" onClick={() => openWidgetLibrary("add")}><ReportIcon name="plus" />Aggiungi un altro widget</button>}
              </div>}
            </>}
          </div>
          <footer className="rpt-statusbar" role="status"><span className="rpt-status-dot" />{busy ? "Operazione in corso…" : status}<span>MLSM REPORTS · {preview ? "PRESENTAZIONE" : "EDITOR"}</span></footer>
        </section>
        {!preview && <aside className="rpt-inspector" aria-label="Widget e proprietà">
          <div className="rpt-panel-heading"><span>AGGIUNGI WIDGET</span><span className="rpt-small-badge">{Object.keys(WIDGET_LABELS).length} tipi</span></div>
          <div className="rpt-widget-picker">{(Object.keys(widgetLabels) as WidgetType[]).map(type => <button key={type} disabled={type !== "text" && !activeDataset} onClick={() => addWidget(type)} title={widgetLabels[type]}><ReportIcon name={type} /><span>{type === "kpi" ? "KPI" : widgetLabels[type]}</span></button>)}</div>
          {selected ? <section className="rpt-settings-section"><div className="rpt-panel-heading"><span>PROPRIETÀ WIDGET</span><button className="rpt-icon-button" aria-label="Deseleziona widget" onClick={() => setSelectedId(null)}><ReportIcon name="close" /></button></div>
            <label className="rpt-control">Titolo<input value={selected.title} maxLength={160} onChange={event => patchWidget({ title: event.target.value })} /></label>
            <label className="rpt-control">Tipo widget<select aria-label="Tipo widget" value={selected.type} onChange={event => convertSelectedWidget(event.target.value as WidgetType)}>{(Object.keys(widgetLabels) as WidgetType[]).map(type => <option key={type} value={type}>{widgetLabels[type]}</option>)}</select><small>Il cambio mantiene titolo, posizione, dimensioni, colore e campi compatibili.</small></label>
            <button type="button" className="rpt-button rpt-full-width rpt-change-type" onClick={() => openWidgetLibrary("replace")}><ReportIcon name="swap" />Cambia visualizzazione</button>
            {selected.type === "text" ? <label className="rpt-control">Contenuto<textarea rows={6} value={selected.text} maxLength={10000} onChange={event => patchWidget({ text: event.target.value })} /></label> : <>
              <label className="rpt-control">Origine<select value={selected.datasetId} onChange={event => { const dataset = dashboard.datasets.find(item => item.id === event.target.value); const defaults = widgetDefaults(selected.type, dataset, "", language); patchWidget({ datasetId: event.target.value, dimension: defaults.dimension, secondaryDimension: defaults.secondaryDimension, measure: defaults.measure, aggregation: defaults.aggregation, timeGrain: defaults.timeGrain, xSort: defaults.xSort, animation: null }); }}><option value="" disabled>Seleziona origine</option>{dashboard.datasets.map(dataset => <option key={dataset.id} value={dataset.id}>{dataset.name}</option>)}</select></label>
              {selected.type !== "kpi" && selected.type !== "table" && <label className="rpt-control rpt-drop-zone" onDragOver={event => event.preventDefault()} onDrop={event => fieldDrop(event, "dimension")}>{selected.type === "scatter" ? "Asse X (numerico)" : selected.type === "pivot" ? "Righe" : "Dimensione / asse X"}<select value={selected.dimension} onChange={event => patchWidget({ dimension: event.target.value, timeGrain: "exact", xSort: "asc" })}><option value="">Seleziona campo</option>{selectedDataset?.fields.filter(field => selected.type !== "scatter" || field.type === "number").map(field => <option key={field.id} value={field.id}>{field.name}</option>)}</select><small>Trascina un campo qui</small></label>}
              {selected.type === "pivot" && <label className="rpt-control">Colonne<select value={selected.secondaryDimension} onChange={event => patchWidget({ secondaryDimension: event.target.value })}><option value="">Seleziona campo</option>{selectedDataset?.fields.map(field => <option key={field.id} value={field.id}>{field.name}</option>)}</select></label>}
              {selectedDimensionField?.type === "date" && selected.type !== "scatter" && <label className="rpt-control">Raggruppa il tempo<select value={selected.timeGrain} onChange={event => patchWidget({ timeGrain: event.target.value as ReportWidget["timeGrain"] })}>{Object.entries(timeGrainLabels).map(([grain, label]) => <option key={grain} value={grain}>{label}</option>)}</select><small>Disponibile per linee, area, barre, ciambella e righe della pivot.</small></label>}
              {selected.type !== "table" && <><label className="rpt-control rpt-drop-zone" onDragOver={event => event.preventDefault()} onDrop={event => fieldDrop(event, "measure")}>{selected.type === "scatter" ? "Asse Y (numerico)" : selected.aggregation === "distinct" ? "Campo da contare" : "Misura"}<select disabled={selected.aggregation === "count" && selected.type !== "scatter"} value={selected.measure} onChange={event => patchWidget({ measure: event.target.value })}><option value="">Seleziona campo</option>{selectedDataset?.fields.filter(field => selected.aggregation === "distinct" || field.type === "number").map(field => <option key={field.id} value={field.id}>{field.name}</option>)}</select><small>{selected.aggregation === "distinct" ? "Può essere numerico, testuale, data o booleano." : "Trascina una misura qui"}</small></label>
              {selected.type !== "scatter" && <label className="rpt-control">Aggregazione<select value={selected.aggregation} onChange={event => applyAggregation(event.target.value as Aggregation)}>{Object.entries(aggregationLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
              <div className="rpt-control-row"><label className="rpt-control">Formato<select value={selected.format} onChange={event => patchWidget({ format: event.target.value as ReportWidget["format"] })}><option value="number">Numero</option><option value="currency">Valuta</option><option value="percent">Percentuale</option></select></label><label className="rpt-control">Decimali massimi<input type="number" min={0} max={6} value={selected.decimals} onChange={event => patchWidget({ decimals: Math.max(0, Math.min(6, Number(event.target.value) || 0)) })} /></label></div>
              {selected.format === "currency" && <label className="rpt-control">Valuta<select value={selected.currency} onChange={event => patchWidget({ currency: event.target.value as ReportWidget["currency"] })}>{Object.entries(currencyLabels).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>}
              {(["bar", "line", "area", "doughnut", "map"] as WidgetType[]).includes(selected.type) && <div className="rpt-control-row"><label className="rpt-control">Ordinamento grafico<select aria-label="Ordinamento grafico" value={chartOrderValue(selected, selectedTemporalSequence)} onChange={event => patchWidget(chartOrderPatch(event.target.value as ChartOrder))}><option value="x-asc">Asse X crescente</option><option value="x-desc">Asse X decrescente</option><option value="source">Ordine del file</option>{!selectedTemporalSequence && <><option value="value-desc">Valore decrescente</option><option value="value-asc">Valore crescente</option></>}</select><small>{selectedTemporalSequence ? "Sequenza temporale protetta: i punti vengono collegati in ordine cronologico." : "Date e periodi sono cronologici; i numeri vengono ordinati numericamente."}</small></label><label className="rpt-control">Categorie<input type="number" min={1} max={1000} placeholder="Tutte" value={selected.limit ?? ""} onChange={event => patchWidget({ limit: event.target.value === "" ? null : Math.max(1, Math.min(1000, Number(event.target.value) || 1)) })} /><small>Vuoto = tutte</small></label></div>}</>}
            </>}
            <label className="rpt-control">Riga<select value={selected.rowId} onChange={event => { patchWidget({ rowId: event.target.value }); setSelectedRowId(event.target.value); }}>{activeTabRows.map((row, index) => <option key={row.id} value={row.id}>Riga {index + 1}{row.columns ? ` · ${row.columns} elementi` : " · automatica"}</option>)}</select></label>
            <div className="rpt-control-row"><label className="rpt-control">Larghezza predefinita<select disabled={selectedRow?.columns !== null} value={[3, 4, 6, 8, 12].includes(selected.width) ? selected.width : "custom"} onChange={event => { if (event.target.value !== "custom") patchWidget({ width: Number(event.target.value) }); }}><option value={3}>¼ pagina</option><option value={4}>⅓ pagina</option><option value={6}>½ pagina</option><option value={8}>⅔ pagina</option><option value={12}>Pagina intera</option><option value="custom">Personalizzata</option></select></label><label className="rpt-control">Larghezza manuale (1–12)<input disabled={selectedRow?.columns !== null} type="number" min={1} max={12} value={selected.width} onChange={event => patchWidget({ width: Math.max(1, Math.min(12, Number(event.target.value) || 1)) })} /></label></div>
            {selectedRow?.columns != null && <p className="rpt-setting-note">La riga selezionata impone {selectedRow.columns} elementi: la larghezza del widget è temporaneamente ignorata.</p>}
            <label className="rpt-control">Altezza<select value={selected.height} onChange={event => patchWidget({ height: Number(event.target.value) as ReportWidget["height"] })}><option value={240}>Compatta</option><option value={320}>Standard</option><option value={420}>Ampia</option></select></label>
            {selected.type === "map" ? <div className="rpt-map-color-controls">
              <label className="rpt-color-control">Sfondo mappa<input type="color" aria-label="Colore sfondo mappa" value={selected.mapBackground} onChange={event => patchWidget({ mapBackground: event.target.value })} /><button className="rpt-icon-button" title="Ripristina sfondo grigio" aria-label="Ripristina sfondo mappa" onClick={() => patchWidget({ mapBackground: DEFAULT_MAP_BACKGROUND })}><ReportIcon name="reset" /></button></label>
              <label className="rpt-color-control">Colore pallini<input type="color" aria-label="Colore pallini mappa" value={selected.color || dashboard.theme.accent} onChange={event => patchWidget({ color: event.target.value })} /><button className="rpt-icon-button" title="Usa colore accento dashboard" aria-label="Usa colore dashboard per i pallini" onClick={() => patchWidget({ color: "" })}><ReportIcon name="reset" /></button></label>
            </div> : <label className="rpt-color-control">Colore widget<input type="color" aria-label="Colore widget" value={selected.color || dashboard.theme.accent} onChange={event => patchWidget({ color: event.target.value })} /><button className="rpt-icon-button" title="Usa palette dashboard" aria-label="Usa colore della dashboard" onClick={() => patchWidget({ color: "" })}><ReportIcon name="reset" /></button></label>}
            {selected.type !== "text" && <details className="rpt-animation-settings" open={Boolean(selected.animation)}>
              <summary><span><ReportIcon name="play" />{selected.animation ? "ANIMAZIONE · TIME SERIES" : "AGGIUNGI ANIMAZIONE"}</span><ReportIcon name="down" /></summary>
              {!selected.animation ? <div className="rpt-animation-picker"><p>Le animazioni trasformano un widget in una storia interattiva. Altri modelli saranno aggiunti qui.</p><button type="button" disabled={!selectedDataset?.fields.some(field => field.type === "date")} onClick={addTimeSeriesAnimation}><span><ReportIcon name="line" /></span><strong>Time Series</strong><small>Mostra come la misura cambia nel tempo.</small><em>DISPONIBILE</em></button>{!selectedDataset?.fields.some(field => field.type === "date") && <small>Questa origine non contiene campi data.</small>}</div> : <div className="rpt-animation-controls">
                <label className="rpt-control">Animazione<select aria-label="Animazione widget" value={selected.animation.type} onChange={() => undefined}><option value="timeSeries">Time Series</option></select><small>Menu predisposto per i prossimi modelli di animazione.</small></label>
                <label className="rpt-control">Grafico animato<select aria-label="Grafico animato" value={selected.animation.chartType} onChange={event => patchAnimation({ chartType: event.target.value as TimeSeriesChartType })}><option value="line">Linea</option><option value="area">Area</option><option value="bar">Barre</option></select></label>
                <label className="rpt-control">Asse X da animare<select aria-label="Asse X animazione" value={selected.animation.dimension} onChange={event => patchAnimation({ dimension: event.target.value })}>{selectedDataset?.fields.filter(field => field.type === "date").map(field => <option key={field.id} value={field.id}>{field.name}</option>)}</select><small>I periodi vengono sempre ordinati cronologicamente.</small></label>
                <label className="rpt-control">Raggruppa asse X<select aria-label="Raggruppa asse X animazione" value={selected.animation.timeGrain} onChange={event => patchAnimation({ timeGrain: event.target.value as ReportWidget["timeGrain"] })}>{Object.entries(timeGrainLabels).map(([grain, label]) => <option key={grain} value={grain}>{label}</option>)}</select></label>
                <label className="rpt-control">Valore mostrato<select aria-label="Valore animazione Time Series" value={selected.animation.valueMode} onChange={event => patchAnimation({ valueMode: event.target.value as TimeSeriesValueMode })}><option value="period">Singolo periodo</option><option value="cumulative">Cumulativo</option></select><small>Il cumulativo somma progressivamente i valori dei periodi in ordine cronologico.</small></label>
                <label className="rpt-animation-toggle"><input type="checkbox" checked={selected.animation.showTrendLine} onChange={event => patchAnimation({ showTrendLine: event.target.checked })} /><span><strong>Linea di tendenza</strong><small>Regressione lineare tratteggiata sulla serie.</small></span></label>
                <label className="rpt-animation-toggle"><input type="checkbox" checked={selected.animation.highlightMaximum} onChange={event => patchAnimation({ highlightMaximum: event.target.checked })} /><span><strong>Evidenzia massimo</strong><small>Marca il picco e ne mostra periodo e valore.</small></span></label>
                <div className="rpt-animation-actions"><button type="button" className="rpt-button" onClick={() => setAnimationWidgetId(selected.id)}><ReportIcon name="play" />Anteprima</button><button type="button" className="rpt-text-button" onClick={() => patchWidget({ animation: null })}>Rimuovi</button></div>
              </div>}
            </details>}
          </section> : <p className="rpt-inspector-hint">Seleziona un widget nella dashboard per configurare dati, aspetto e dimensioni.</p>}
          {selectedRow && <section className="rpt-settings-section"><div className="rpt-panel-heading"><span>LAYOUT RIGA {dashboard.layoutRows.findIndex(row => row.id === selectedRow.id) + 1}</span></div><label className="rpt-control">Elementi per riga<input type="number" min={1} max={12} placeholder="Automatico" value={selectedRow.columns ?? ""} onChange={event => setRowColumns(selectedRow.id, event.target.value === "" ? null : Math.max(1, Math.min(12, Number(event.target.value) || 1)))} /><small>Lascia vuoto per usare le larghezze individuali; inserisci 6, 7 o un altro valore per creare colonne uguali.</small></label><button className="rpt-button rpt-full-width" onClick={addLayoutRow}><ReportIcon name="plus" />Aggiungi una nuova riga</button></section>}
          <section className="rpt-settings-section"><div className="rpt-panel-heading"><span>DASHBOARD</span></div>{activeTab && <><label className="rpt-control">Nome tab<input aria-label="Nome tab attivo" maxLength={120} value={activeTab.name} onChange={event => change(current => ({ ...current, tabs: current.tabs.map(tab => tab.id === activeTab.id ? { ...tab, name: event.target.value || "Senza titolo" } : tab) }))} /></label>{dashboard.tabs.length > 1 && <button type="button" className="rpt-button rpt-danger-soft rpt-full-width" onClick={deleteActiveTab}><ReportIcon name="trash" />Elimina tab attivo</button>}</>}<label className="rpt-control">Descrizione<textarea rows={2} placeholder="Il contesto dietro i numeri…" maxLength={2000} value={dashboard.description} onChange={event => change(current => ({ ...current, description: event.target.value }))} /></label>
            <div className="rpt-palette-label">Palette MLSM <button className="rpt-text-button" onClick={() => change(current => ({ ...current, theme: { ...DEFAULT_REPORT_THEME } }))}>Ripristina</button></div><div className="rpt-palette">{(["accent", "ink", "paper"] as const).map(key => <label key={key}><input type="color" aria-label={key === "accent" ? "Colore accento" : key === "ink" ? "Colore testo" : "Colore sfondo"} value={dashboard.theme[key]} onChange={event => change(current => ({ ...current, theme: { ...current.theme, [key]: event.target.value } }))} /><span>{key === "accent" ? "Accento" : key === "ink" ? "Testo" : "Sfondo"}</span><small>{dashboard.theme[key].toUpperCase()}</small></label>)}</div>
          </section>
        </aside>}
      </div>
    </fieldset>
    {shareUrl && <div className="rpt-modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setShareUrl(""); }}><section className="rpt-modal rpt-share-modal" role="dialog" aria-modal="true" aria-labelledby="rpt-share-title"><header><div><span className="rpt-eyebrow">SOLA VISUALIZZAZIONE</span><h2 id="rpt-share-title">URL della dashboard</h2><p>Questo link apre una vista professionale senza editor e pannelli laterali. La dashboard resta salvata sul dispositivo.</p></div><button className="rpt-icon-button" aria-label="Chiudi URL dashboard" onClick={() => setShareUrl("")}><ReportIcon name="close" /></button></header><label className="rpt-control">URL<input readOnly aria-label="URL visualizzazione dashboard" value={shareUrl} onFocus={event => event.currentTarget.select()} /></label><div className="rpt-share-actions"><button className="rpt-button" onClick={() => { void navigator.clipboard?.writeText(shareUrl).then(() => setStatus("URL copiato negli appunti")).catch(() => setStatus("Seleziona e copia manualmente l’URL")); }}><ReportIcon name="copy" />Copia URL</button><button className="rpt-button rpt-button-primary" onClick={() => { window.location.hash = new URL(shareUrl).hash; setShareUrl(""); onOpenViewer?.(dashboard.id); }}><ReportIcon name="eye" />Apri sola visualizzazione</button></div></section></div>}
    {embedCode && <div className="rpt-modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setEmbedCode(""); }}><section className="rpt-modal rpt-share-modal" role="dialog" aria-modal="true" aria-labelledby="rpt-embed-title"><header><div><span className="rpt-eyebrow">HTML DA INCORPORARE</span><h2 id="rpt-embed-title">Dashboard pronta da incorporare</h2><p>Il file HTML contiene grafici, mappe, tab e stile MLSM. Le mappe reali usano Leaflet e OpenStreetMap e richiedono una connessione Internet.</p></div><button className="rpt-icon-button" aria-label="Chiudi codice incorporamento" onClick={() => setEmbedCode("")}><ReportIcon name="close" /></button></header><label className="rpt-control">Codice HTML<textarea readOnly rows={4} aria-label="Codice HTML incorporamento" value={embedCode} onFocus={event => event.currentTarget.select()} /></label><div className="rpt-share-actions"><button className="rpt-button rpt-button-primary" onClick={() => { void navigator.clipboard?.writeText(embedCode).then(() => setStatus("Codice HTML copiato negli appunti")).catch(() => setStatus("Seleziona e copia manualmente il codice")); }}><ReportIcon name="copy" />Copia codice</button></div></section></div>}
    {widgetMenuOpen && <div className="rpt-modal-backdrop" onClick={event => { if (event.target === event.currentTarget) { setWidgetMenuOpen(false); setWidgetMenuMode("add"); } }}><section className="rpt-modal rpt-widget-library" role="dialog" aria-modal="true" aria-labelledby="rpt-widget-library-title"><header><div><span className="rpt-eyebrow">{widgetMenuMode === "replace" ? "CONVERTI SENZA RICOMINCIARE" : "COMPONI LA DASHBOARD"}</span><h2 id="rpt-widget-library-title">{widgetMenuMode === "replace" ? "Cambia tipo di widget" : "Scegli un widget"}</h2><p>{widgetMenuMode === "replace" ? "Titolo, posizione, dimensioni, colore e campi compatibili restano invariati." : "Puoi inserirne quanti vuoi e configurarli dopo nella barra laterale."}</p></div><button autoFocus className="rpt-icon-button" aria-label="Chiudi selezione widget" onClick={() => { setWidgetMenuOpen(false); setWidgetMenuMode("add"); }}><ReportIcon name="close" /></button></header><div className="rpt-widget-library-grid">{(Object.keys(WIDGET_LABELS) as WidgetType[]).map(type => { const descriptions: Record<WidgetType, string> = { kpi: "Un numero chiave in grande evidenza.", bar: "Confronta categorie e periodi.", line: "Mostra l’andamento nel tempo.", area: "Evidenzia volumi e tendenze.", doughnut: "Visualizza la composizione percentuale.", scatter: "Scopri relazioni tra due misure.", map: "Riconosce offline città, nazioni e codici ISO.", table: "Consulta le righe originali.", pivot: "Incrocia righe, colonne, totali e aggregazioni.", text: "Aggiungi note, contesto e conclusioni." }; return <button key={type} className={widgetMenuMode === "replace" && selected?.type === type ? "is-current" : ""} disabled={(type !== "text" && !activeDataset) || (widgetMenuMode === "replace" && selected?.type === type)} onClick={() => widgetMenuMode === "replace" ? convertSelectedWidget(type) : addWidget(type)}><span><ReportIcon name={type} /></span><strong>{WIDGET_LABELS[type]}</strong><small>{descriptions[type]}</small>{(["pivot", "map"] as WidgetType[]).includes(type) && <em>NUOVO</em>}</button>; })}</div>{!activeDataset && <p className="rpt-widget-library-note">Carica prima un file per usare i widget collegati ai dati. Il widget Testo è già disponibile.</p>}</section></div>}
    {libraryOpen && <div className="rpt-modal-backdrop" onClick={event => { if (event.target === event.currentTarget) setLibraryOpen(false); }}><section className="rpt-modal rpt-library" role="dialog" aria-modal="true" aria-labelledby="rpt-library-title"><header><div><span className="rpt-eyebrow">IL TUO SPAZIO DATI</span><h2 id="rpt-library-title">Le mie dashboard</h2><p>Report salvati su questo dispositivo.</p></div><button autoFocus className="rpt-icon-button" aria-label="Chiudi libreria" onClick={() => setLibraryOpen(false)}><ReportIcon name="close" /></button></header>{saved.length ? <div className="rpt-library-grid">{saved.map(item => <article key={item.id} className="rpt-library-card"><span className="rpt-library-visual" style={{ color: item.theme.accent }}><ReportIcon name="reports" /><i /><i /><i /></span><h3>{item.name}</h3><p>{item.widgets.length} widget · {item.datasets.length} origini</p><small>{new Date(item.updatedAt).toLocaleString(language === "en" ? "en-GB" : "it-IT")}</small><div><button className="rpt-button" onClick={() => { setLibraryOpen(false); protect(() => load(item, true)); }}>Apri dashboard</button><button className="rpt-icon-button" aria-label={`Duplica dashboard ${item.name}`} title="Apri una copia" onClick={() => { setLibraryOpen(false); protect(() => load({ ...structuredClone(item), id: reportId(), name: `${item.name} · ${language === "en" ? "copy" : "copia"}`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() })); }}><ReportIcon name="copy" /></button><button className="rpt-icon-button" aria-label={`Elimina dashboard ${item.name}`} onClick={() => setConfirmation({ title: "Eliminare la dashboard salvata?", message: `“${item.name}” verrà rimossa dalla libreria di questo dispositivo. Eventuali JSON esportati rimangono disponibili.`, label: "Elimina dashboard", run: () => { setBusy(true); void deleteDashboard(item.id).then(() => { setSaved(current => current.filter(entry => entry.id !== item.id)); if (dashboard.id === item.id) setSavedSnapshot(""); setStatus("Dashboard rimossa dalla libreria"); }).catch(reason => { setLibraryOpen(false); setError(messageOf(reason)); }).finally(() => setBusy(false)); } })}><ReportIcon name="trash" /></button></div></article>)}</div> : <div className="rpt-library-empty"><ReportIcon name="folder" /><h3>Il primo report merita un posto qui.</h3><p>Usa “Salva dashboard” per ritrovarlo alla prossima apertura.</p></div>}</section></div>}
    {confirmation && <div className="rpt-modal-backdrop rpt-confirm-backdrop"><section className="rpt-modal rpt-confirm" role="alertdialog" aria-modal="true" aria-labelledby="rpt-confirm-title" aria-describedby="rpt-confirm-description"><h2 id="rpt-confirm-title">{confirmation.title}</h2><p id="rpt-confirm-description">{confirmation.message}</p><div><button className="rpt-button" autoFocus onClick={() => setConfirmation(null)}>Annulla</button><button className="rpt-button rpt-button-primary" onClick={() => { const action = confirmation.run; setConfirmation(null); action(); }}>{confirmation.label}</button></div></section></div>}
    {animationWidget && animationDataset && <TimeSeriesAnimationModal widget={animationWidget} dataset={animationDataset} filters={activeFilters} theme={dashboard.theme} onClose={() => setAnimationWidgetId(null)} />}
  </main>;
}
