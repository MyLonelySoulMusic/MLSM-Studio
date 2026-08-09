import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode, type WheelEvent as ReactWheelEvent } from "react";
import { createMemoryEngine, type MemoryEngine } from "../services/memory-engine";
import { copyMemoryRecords, loadMemoryPreview, releaseMemoryPreview, selectAndScanMemorySources, type MemoryPreview, type MemorySourceEntry } from "../services/memory-native";
import type { MemoryAssetKind, MemoryCategory, MemoryGraph, MemoryGraphNode, MemoryRecord, MemorySearchResult } from "../services/memory-types";
import { uiCopy, useUiPreferences } from "../services/ui-preferences";
import { MemoryStudioContext, useMemoryStudio } from "./memory-context";

const defaultEngine = createMemoryEngine();
const kinds: readonly MemoryAssetKind[] = ["image", "video", "audio", "text", "document", "archive", "folder", "other"];
const kindIcon: Record<MemoryAssetKind, string> = { image: "▧", video: "▶", audio: "♫", text: "¶", document: "▤", archive: "▥", folder: "▰", other: "◇" };
const kindLabel = {
  it: { image: "Immagine", video: "Video", audio: "Audio", text: "Testo", document: "Documento", archive: "Archivio", folder: "Cartella", other: "Altro" },
  en: { image: "Image", video: "Video", audio: "Audio", text: "Text", document: "Document", archive: "Archive", folder: "Folder", other: "Other" }
} as const;

const copy = {
  it: {
    title: "Memory", subtitle: "Memoria semantica locale per ritrovare, capire e organizzare i tuoi file.", find: "Trova memoria", build: "Costruisci memoria", close: "Chiudi Memory",
    searchPlaceholder: "Descrivi ciò che cerchi: “cover rosa con strada di notte”…", search: "Cerca", allTypes: "Tutti i tipi", allCategories: "Tutte le categorie", results: "Risultati pertinenti", noResults: "Nessun risultato. Prova una descrizione diversa o costruisci prima la memoria.",
    selected: "selezionati", copyFiles: "Copia selezionati", copyAll: "Copia tutti i risultati", copied: "File copiati", relevance: "pertinenza", preview: "Anteprima", graph: "Grafo relazioni", list: "Elenco risultati", graphHelp: "Trascina per spostare · rotella per zoom · passa sui nodi per i dettagli", path: "Percorso", description: "Descrizione", categories: "Categorie", tags: "Tag", type: "Tipo", size: "Dimensione", updated: "Aggiornato",
    chooseFiles: "Seleziona file", chooseFolder: "Seleziona cartella", scanHelp: "Le cartelle vengono scansionate ricorsivamente. I file restano locali: nel database vengono salvati percorso, metadati, descrizione e vettore.", selectionDescription: "Descrizione comune", selectionDescriptionPlaceholder: "Spiega cosa contiene questa selezione, il progetto, il periodo, l’atmosfera o qualsiasi dettaglio utile…", tagsPlaceholder: "cover, singolo, notte (separati da virgola)", customCategory: "Nuova categoria", categoryName: "Nome categoria", categoryColor: "Colore categoria", createCategory: "Crea categoria", indexedItems: "Elementi da catalogare", noSelection: "Seleziona uno o più file oppure una cartella.", specificDescription: "Descrizione specifica", save: "Salva nella memoria", saving: "Indicizzazione", saved: "Memoria aggiornata", folderCategory: "La cartella viene aggiunta automaticamente come categoria.", errors: "Elementi ignorati", copyFailures: "errori", limitReached: "limite raggiunto", moreIndexed: "elementi indicizzati senza sovraccaricare l’interfaccia", remove: "Rimuovi dalla memoria", loading: "Caricamento…", emptyPreview: "Seleziona un risultato o un nodo del grafo per vedere l’anteprima.", unsupportedPreview: "Questo tipo di elemento non dispone di anteprima.", browserRelink: "Il browser non può riaprire il file dopo il riavvio. Selezionalo nuovamente oppure usa la build desktop.", localOnly: "Database vettoriale locale · nessun upload cloud", records: "file catalogati", model: "MLSM Semantic Vector 384D"
  },
  en: {
    title: "Memory", subtitle: "Local semantic memory to find, understand and organize your files.", find: "Find memory", build: "Build memory", close: "Close Memory",
    searchPlaceholder: "Describe what you need: “pink cover with a street at night”…", search: "Search", allTypes: "All types", allCategories: "All categories", results: "Relevant results", noResults: "No results. Try another description or build the memory first.",
    selected: "selected", copyFiles: "Copy selected", copyAll: "Copy all results", copied: "Files copied", relevance: "relevance", preview: "Preview", graph: "Relationship graph", list: "Results list", graphHelp: "Drag to pan · wheel to zoom · hover nodes for details", path: "Path", description: "Description", categories: "Categories", tags: "Tags", type: "Type", size: "Size", updated: "Updated",
    chooseFiles: "Select files", chooseFolder: "Select folder", scanHelp: "Folders are scanned recursively. Files stay local: only path, metadata, description and vector are stored in the database.", selectionDescription: "Shared description", selectionDescriptionPlaceholder: "Describe this selection, project, period, mood or any useful detail…", tagsPlaceholder: "cover, single, night (comma separated)", customCategory: "New category", categoryName: "Category name", categoryColor: "Category colour", createCategory: "Create category", indexedItems: "Items to catalog", noSelection: "Select one or more files or a folder.", specificDescription: "Specific description", save: "Save to memory", saving: "Indexing", saved: "Memory updated", folderCategory: "The folder is automatically added as a category.", errors: "Skipped items", copyFailures: "errors", limitReached: "limit reached", moreIndexed: "items indexed without overloading the interface", remove: "Remove from memory", loading: "Loading…", emptyPreview: "Select a result or graph node to see its preview.", unsupportedPreview: "Preview is not available for this item type.", browserRelink: "The browser cannot reopen this file after a restart. Select it again or use the desktop build.", localOnly: "Local vector database · no cloud upload", records: "catalogued files", model: "MLSM Semantic Vector 384D"
  }
} as const;

function formatBytes(value?: number) {
  if (!value) return "—"; const units = ["B", "KB", "MB", "GB", "TB"]; let amount = value; let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

export function MemoryButton({ compact = false }: { compact?: boolean }) {
  const { language } = useUiPreferences(); const memory = useMemoryStudio(); const labels = uiCopy[language];
  return <button type="button" className={`memory-button${compact ? " is-compact" : ""}`} onClick={memory.show} aria-label={labels.openMemory}>
    <svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="7.5" ry="3" /><path d="M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" /><circle cx="17.5" cy="17.5" r="2.2" /></svg>
    <span>{labels.memory}</span>
  </button>;
}

export function MemoryStudioProvider({ children, engine = defaultEngine }: { children: ReactNode; engine?: MemoryEngine }) {
  const [open, setOpen] = useState(false); const show = useCallback(() => setOpen(true), []); const close = useCallback(() => setOpen(false), []);
  const context = useMemo(() => ({ open, show, close }), [close, open, show]);
  return <MemoryStudioContext.Provider value={context}>{children}<MemoryDialog engine={engine} /></MemoryStudioContext.Provider>;
}

function MemoryPreviewPanel({ record, categories, onDelete }: { record: MemoryRecord | null; categories: readonly MemoryCategory[]; onDelete: (record: MemoryRecord) => void }) {
  const { language } = useUiPreferences(); const c = copy[language]; const [preview, setPreview] = useState<MemoryPreview | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true; let loaded: MemoryPreview | null = null; setPreview(null); setError(null);
    if (!record) return () => undefined;
    setLoading(true); void loadMemoryPreview(record).then((value) => { loaded = value; if (active) setPreview(value); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; releaseMemoryPreview(loaded); };
  }, [record]);
  if (!record) return <aside className="memory-preview memory-preview-empty"><div className="memory-preview-symbol">◇</div><p>{c.emptyPreview}</p></aside>;
  const recordCategories = categories.filter((category) => record.categoryIds.includes(category.id));
  const unavailablePreview = preview?.unavailableCode === "browser-relink" ? c.browserRelink : preview?.unavailableReason ?? c.unsupportedPreview;
  return <aside className="memory-preview" aria-label={`${c.preview}: ${record.name}`}>
    <header><span className={`memory-kind kind-${record.kind}`}>{kindIcon[record.kind]}</span><div><strong>{record.name}</strong><small>{record.kind} · {formatBytes(record.sizeBytes)}</small></div></header>
    <div className="memory-preview-media">
      {loading ? <p>{c.loading}</p> : error ? <p className="status-error">{error}</p> : preview?.url && record.kind === "image" ? <img src={preview.url} alt={record.description || record.name} /> : preview?.url && record.kind === "video" ? <video src={preview.url} controls preload="metadata" /> : preview?.url && record.kind === "audio" ? <audio src={preview.url} controls preload="metadata" /> : preview?.url && record.kind === "document" && record.mimeType === "application/pdf" ? <iframe src={preview.url} title={record.name} /> : preview?.text !== undefined ? <pre>{preview.text}{preview.truncated ? "\n…" : ""}</pre> : <div className="memory-no-preview"><b>{kindIcon[record.kind]}</b><span>{unavailablePreview}</span></div>}
    </div>
    <dl><div><dt>{c.path}</dt><dd title={record.path}>{record.path}</dd></div><div><dt>{c.description}</dt><dd>{record.description || "—"}</dd></div><div><dt>{c.categories}</dt><dd>{recordCategories.map((category) => <span key={category.id} style={{ "--memory-category": category.color } as CSSProperties}>{category.name}</span>)}</dd></div><div><dt>{c.tags}</dt><dd>{record.tags.length ? record.tags.join(" · ") : "—"}</dd></div></dl>
    <button type="button" className="memory-delete" onClick={() => onDelete(record)}>{c.remove}</button>
  </aside>;
}

interface GraphPoint { node: MemoryGraphNode; x: number; y: number }
function layoutGraph(graph: MemoryGraph): GraphPoint[] {
  const categories = graph.nodes.filter((node) => node.kind === "category"); const records = graph.nodes.filter((node) => node.kind === "record"); const points: GraphPoint[] = [];
  categories.forEach((node, index) => { const angle = index / Math.max(1, categories.length) * Math.PI * 2 - Math.PI / 2; points.push({ node, x: 450 + Math.cos(angle) * 135, y: 270 + Math.sin(angle) * 135 }); });
  records.forEach((node, index) => { const angle = index * 2.399963229728653; const radius = 205 + (index % 5) * 28; points.push({ node, x: 450 + Math.cos(angle) * radius, y: 270 + Math.sin(angle) * Math.min(radius, 225) }); });
  return points;
}

function MemoryGraphView({ graph, onSelect }: { graph: MemoryGraph; onSelect: (id: string) => void }) {
  const { language } = useUiPreferences(); const c = copy[language]; const points = useMemo(() => layoutGraph(graph), [graph]); const byId = useMemo(() => new Map(points.map((point) => [point.node.id, point])), [points]);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 }); const [hovered, setHovered] = useState<GraphPoint | null>(null); const drag = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null);
  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => { drag.current = { x: event.clientX, y: event.clientY, originX: view.x, originY: view.y }; event.currentTarget.setPointerCapture(event.pointerId); };
  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => { if (!drag.current) return; setView((current) => ({ ...current, x: drag.current!.originX + event.clientX - drag.current!.x, y: drag.current!.originY + event.clientY - drag.current!.y })); };
  const onWheel = (event: ReactWheelEvent<SVGSVGElement>) => { event.preventDefault(); setView((current) => ({ ...current, scale: Math.max(.55, Math.min(2.4, current.scale * (event.deltaY > 0 ? .9 : 1.1))) })); };
  const selectPoint = (point: GraphPoint) => { if (point.node.kind === "record") onSelect(point.node.id.replace(/^record:/, "")); };
  return <div className="memory-graph-wrap"><svg className="memory-graph" viewBox="0 0 900 540" role="img" aria-label={c.graph} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => { drag.current = null; }} onWheel={onWheel}>
    <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
      {graph.edges.map((edge) => { const from = byId.get(edge.source); const to = byId.get(edge.target); return from && to ? <line key={edge.id} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className={`edge-${edge.kind}`} strokeWidth={Math.max(.7, edge.weight * 2.2)} /> : null; })}
      {points.map((point) => <g key={point.node.id} className={`memory-graph-node node-${point.node.kind}`} transform={`translate(${point.x} ${point.y})`} role="button" tabIndex={0} aria-label={point.node.label} onPointerDown={(event) => event.stopPropagation()} onMouseEnter={() => setHovered(point)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(point)} onBlur={() => setHovered(null)} onClick={() => selectPoint(point)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectPoint(point); } }}>
        <circle r={point.node.size} fill={point.node.color} /><circle className="memory-node-ring" r={point.node.size + 4} /><text y={point.node.size + 13} textAnchor="middle">{point.node.label.slice(0, 22)}</text>
      </g>)}
    </g>
  </svg>{hovered ? <div className="memory-graph-tooltip" style={{ left: `${(hovered.x * view.scale + view.x) / 9}%`, top: `${(hovered.y * view.scale + view.y) / 5.4}%` }}><strong>{hovered.node.label}</strong><span>{hovered.node.details.description || hovered.node.details.path}</span><small>{hovered.node.details.path}</small></div> : null}<p>{c.graphHelp}</p></div>;
}

function MemoryDialog({ engine }: { engine: MemoryEngine }) {
  const { language } = useUiPreferences(); const c = copy[language]; const memory = useMemoryStudio(); const [tab, setTab] = useState<"find" | "build">("find"); const [view, setView] = useState<"list" | "graph">("list");
  const [query, setQuery] = useState(""); const [kindFilter, setKindFilter] = useState<MemoryAssetKind | "all">("all"); const [categoryFilter, setCategoryFilter] = useState("all"); const [results, setResults] = useState<MemorySearchResult[]>([]); const [records, setRecords] = useState<MemoryRecord[]>([]); const [categories, setCategories] = useState<MemoryCategory[]>([]); const [graph, setGraph] = useState<MemoryGraph>({ nodes: [], edges: [] });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set()); const [activeRecord, setActiveRecord] = useState<MemoryRecord | null>(null); const [status, setStatus] = useState(""); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  const [sources, setSources] = useState<MemorySourceEntry[]>([]); const [scanInfo, setScanInfo] = useState<{ skipped: number; truncated: boolean; errors: string[] } | null>(null); const [description, setDescription] = useState(""); const [tags, setTags] = useState(""); const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(new Set()); const [categoryName, setCategoryName] = useState(""); const [categoryColor, setCategoryColor] = useState("#ed75a7"); const [kindOverrides, setKindOverrides] = useState<Record<string, MemoryAssetKind>>({}); const [descriptionOverrides, setDescriptionOverrides] = useState<Record<string, string>>({}); const [activeSourcePath, setActiveSourcePath] = useState<string | null>(null); const [progress, setProgress] = useState(0);

  const queryRef = useRef(query); const refreshVersion = useRef(0);
  useEffect(() => { queryRef.current = query; }, [query]);
  const refresh = useCallback(async (searchQuery: string, rebuildGraph = true) => {
    const version = ++refreshVersion.current;
    const [nextRecords, nextCategories, nextGraph, nextResults] = await Promise.all([engine.listRecords(), engine.listCategories(), rebuildGraph ? engine.graph({ similarityThreshold: .16, maxSemanticNeighbors: 3, maxRecords: 180 }) : Promise.resolve(null), engine.search(searchQuery, { limit: 250, ...(kindFilter !== "all" ? { kinds: [kindFilter] } : {}), ...(categoryFilter !== "all" ? { categoryIds: [categoryFilter] } : {}) })]);
    if (version !== refreshVersion.current) return;
    const resultIds = new Set(nextResults.map((result) => result.record.id));
    setRecords(nextRecords); setCategories(nextCategories); if (nextGraph) setGraph(nextGraph); setResults(nextResults); setSelectedIds((current) => new Set([...current].filter((id) => resultIds.has(id))));
  }, [categoryFilter, engine, kindFilter]);

  useEffect(() => { if (!memory.open) return; setError(null); void refresh(queryRef.current).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason))); const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") memory.close(); }; window.addEventListener("keydown", closeOnEscape); return () => window.removeEventListener("keydown", closeOnEscape); }, [memory, refresh]);
  const runSearch = async () => { setLoading(true); setError(null); try { await refresh(query, false); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setLoading(false); } };
  const choose = async (mode: "files" | "folder") => { setLoading(true); setError(null); try { const selected = await selectAndScanMemorySources(mode); if (!selected) return; setSources(selected.entries); setScanInfo({ skipped: selected.skippedCount, truncated: selected.truncated, errors: selected.errors }); setActiveSourcePath(selected.entries[0]?.path ?? null); setTab("build"); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setLoading(false); } };
  const createCategory = async () => { if (!categoryName.trim()) return; setLoading(true); setError(null); try { const category = await engine.createCategory({ name: categoryName, color: categoryColor, description: description.trim() }); setCategoryName(""); setSelectedCategoryIds((current) => new Set([...current, category.id])); await refresh(query, true); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setLoading(false); } };
  const saveSources = async () => {
    if (!sources.length) return; setLoading(true); setError(null); setProgress(0);
    try {
      const tagList = tags.split(",").map((tag) => tag.trim()).filter(Boolean);
      await engine.upsertRecords(sources.map((source) => ({ path: source.path, name: source.name, kind: kindOverrides[source.path] ?? source.mediaKind, mimeType: source.mimeType, description: descriptionOverrides[source.path]?.trim() || description.trim(), tags: tagList, categoryIds: [...selectedCategoryIds], sizeBytes: source.sizeBytes, ...(source.modifiedAtMs ? { modifiedAt: new Date(source.modifiedAtMs).toISOString() } : {}) })), (completed, total) => setProgress(total ? completed / total : 1));
      setStatus(`${c.saved} · ${sources.length}`); setSources([]); setScanInfo(null); setDescription(""); setTags(""); setSelectedCategoryIds(new Set()); setKindOverrides({}); setDescriptionOverrides({}); setActiveSourcePath(null); setQuery(""); queryRef.current = ""; await refresh("", true); setTab("find");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setLoading(false); }
  };
  const copyRecords = async (toCopy: readonly MemoryRecord[]) => { setLoading(true); setError(null); try { const result = await copyMemoryRecords(toCopy); if (result) setStatus(`${c.copied}: ${result.copiedFiles}${result.failures.length ? ` · ${result.failures.length} ${c.copyFailures}` : ""}`); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setLoading(false); } };
  const deleteRecord = async (record: MemoryRecord) => { setLoading(true); setError(null); try { await engine.deleteRecord(record.id); if (activeRecord?.id === record.id) setActiveRecord(null); setSelectedIds((current) => { const next = new Set(current); next.delete(record.id); return next; }); await refresh(queryRef.current, true); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setLoading(false); } };
  const selectedRecords = results.filter((result) => selectedIds.has(result.record.id)).map((result) => result.record); const activeSource = sources.find((source) => source.path === activeSourcePath) ?? null;
  if (!memory.open) return null;
  return <div className="memory-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) memory.close(); }}><section className="memory-dialog" role="dialog" aria-modal="true" aria-label={c.title}>
    <header className="memory-dialog-header"><div><span>MLSM / LOCAL INTELLIGENCE</span><h2>{c.title}</h2><p>{c.subtitle}</p></div><div className="memory-health"><b>{records.length}</b><span>{c.records}</span><small>{c.model}</small></div><button type="button" className="memory-close" onClick={memory.close} aria-label={c.close}>×</button></header>
    <nav className="memory-tabs" aria-label={c.title}><button type="button" className={tab === "find" ? "active" : ""} onClick={() => setTab("find")}><b>01</b>{c.find}</button><button type="button" className={tab === "build" ? "active" : ""} onClick={() => setTab("build")}><b>02</b>{c.build}</button><small>{c.localOnly}</small></nav>
    {error ? <div className="memory-message error">{error}</div> : status ? <div className="memory-message">{status}</div> : null}
    {tab === "find" ? <div className="memory-find">
      <form className="memory-search" onSubmit={(event) => { event.preventDefault(); void runSearch(); }}><label><span>{c.find}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={c.searchPlaceholder} autoFocus /></label><select aria-label={c.type} value={kindFilter} onChange={(event) => setKindFilter(event.target.value as MemoryAssetKind | "all")}><option value="all">{c.allTypes}</option>{kinds.map((kind) => <option key={kind} value={kind}>{kindLabel[language][kind]}</option>)}</select><select aria-label={c.categories} value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="all">{c.allCategories}</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select><button type="submit" disabled={loading}>{c.search}</button></form>
      <div className="memory-find-toolbar"><div><button type="button" className={view === "list" ? "active" : ""} onClick={() => setView("list")}>{c.list}</button><button type="button" className={view === "graph" ? "active" : ""} onClick={() => setView("graph")}>{c.graph}</button></div><span>{results.length} {c.results.toLocaleLowerCase()} · {selectedIds.size} {c.selected}</span><button type="button" disabled={!selectedRecords.length || loading} onClick={() => void copyRecords(selectedRecords)}>{c.copyFiles}</button><button type="button" disabled={!results.length || loading} onClick={() => void copyRecords(results.map((result) => result.record))}>{c.copyAll}</button></div>
      <div className="memory-find-body"><main className="memory-results-stage">{view === "graph" ? <MemoryGraphView graph={graph} onSelect={(id) => { const record = records.find((item) => item.id === id) ?? null; setActiveRecord(record); }} /> : <section className="memory-results" aria-label={c.results}>{results.length ? results.map((result, index) => <article key={result.record.id} className={activeRecord?.id === result.record.id ? "active" : ""} onClick={() => setActiveRecord(result.record)}><label onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selectedIds.has(result.record.id)} onChange={(event) => setSelectedIds((current) => { const next = new Set(current); if (event.target.checked) next.add(result.record.id); else next.delete(result.record.id); return next; })} /><span /></label><span className={`memory-kind kind-${result.record.kind}`}>{kindIcon[result.record.kind]}</span><div><small>#{String(index + 1).padStart(2, "0")} · {Math.round(result.score * 100)}% {c.relevance}</small><strong>{result.record.name}</strong><p>{result.record.description || result.record.path}</p><em title={result.record.path}>{result.record.path}</em></div><output>{Math.round(result.score * 100)}</output></article>) : <div className="memory-empty"><b>⌁</b><p>{c.noResults}</p></div>}</section>}</main><MemoryPreviewPanel record={activeRecord} categories={categories} onDelete={(record) => void deleteRecord(record)} /></div>
    </div> : <div className="memory-build">
      <aside className="memory-build-controls"><div className="memory-source-actions"><button type="button" onClick={() => void choose("files")} disabled={loading}>＋ {c.chooseFiles}</button><button type="button" onClick={() => void choose("folder")} disabled={loading}>▰ {c.chooseFolder}</button></div><p>{c.scanHelp}</p>
        <label><span>{c.selectionDescription}</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder={c.selectionDescriptionPlaceholder} rows={5} /></label><label><span>{c.tags}</span><input value={tags} onChange={(event) => setTags(event.target.value)} placeholder={c.tagsPlaceholder} /></label>
        <fieldset><legend>{c.categories}</legend><div className="memory-category-options">{categories.filter((category) => category.kind === "custom").map((category) => <label key={category.id} style={{ "--memory-category": category.color } as CSSProperties}><input type="checkbox" checked={selectedCategoryIds.has(category.id)} onChange={(event) => setSelectedCategoryIds((current) => { const next = new Set(current); if (event.target.checked) next.add(category.id); else next.delete(category.id); return next; })} /><span>{category.name}</span></label>)}</div><small>{c.folderCategory}</small></fieldset>
        <div className="memory-new-category"><strong>{c.customCategory}</strong><input aria-label={c.categoryName} value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder={c.categoryName} /><input type="color" value={categoryColor} onChange={(event) => setCategoryColor(event.target.value)} aria-label={c.categoryColor} /><button type="button" onClick={() => void createCategory()} disabled={!categoryName.trim() || loading}>{c.createCategory}</button></div>
        <button type="button" className="memory-save" disabled={!sources.length || loading} onClick={() => void saveSources()}>{loading && sources.length ? `${c.saving} ${Math.round(progress * 100)}%` : c.save}</button>{loading && sources.length ? <progress max={1} value={progress} /> : null}
      </aside>
      <main className="memory-source-browser"><header><div><strong>{c.indexedItems}</strong><span>{sources.length}</span></div>{scanInfo && (scanInfo.skipped || scanInfo.truncated || scanInfo.errors.length) ? <small>{c.errors}: {scanInfo.skipped + scanInfo.errors.length}{scanInfo.truncated ? ` · ${c.limitReached}` : ""}</small> : null}</header>{sources.length ? <div className="memory-source-list">{sources.slice(0, 500).map((source) => <button type="button" key={source.path} className={activeSourcePath === source.path ? "active" : ""} onClick={() => setActiveSourcePath(source.path)}><span className={`memory-kind kind-${kindOverrides[source.path] ?? source.mediaKind}`}>{kindIcon[kindOverrides[source.path] ?? source.mediaKind]}</span><span><strong>{source.name}</strong><small>{source.path}</small></span><em>{formatBytes(source.sizeBytes)}</em></button>)}{sources.length > 500 ? <p>+ {sources.length - 500} {c.moreIndexed}</p> : null}</div> : <div className="memory-empty"><b>▰</b><p>{c.noSelection}</p></div>}
        {activeSource ? <section className="memory-source-editor"><header><strong>{activeSource.name}</strong><small>{activeSource.path}</small></header><label><span>{c.type}</span><select value={kindOverrides[activeSource.path] ?? activeSource.mediaKind} onChange={(event) => setKindOverrides((current) => ({ ...current, [activeSource.path]: event.target.value as MemoryAssetKind }))}>{kinds.map((kind) => <option key={kind} value={kind}>{kindLabel[language][kind]}</option>)}</select></label><label><span>{c.specificDescription}</span><textarea rows={3} value={descriptionOverrides[activeSource.path] ?? ""} onChange={(event) => setDescriptionOverrides((current) => ({ ...current, [activeSource.path]: event.target.value }))} placeholder={description || c.selectionDescriptionPlaceholder} /></label></section> : null}
      </main>
    </div>}
  </section></div>;
}
