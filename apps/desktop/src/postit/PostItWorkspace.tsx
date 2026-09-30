import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { MemoryButton } from "../components/MemoryStudio";
import { SupportArtistButton } from "../components/ArtistSupport";
import { SettingsButton } from "../components/StudioSettings";
import { uiCopy, useUiPreferences } from "../services/ui-preferences";
import { createPostIt, createPostItFlow, loadPostItWorkspace, rankPostItFlows, rankPostIts, savePostItWorkspace, type PostItFlow, type PostItNote, type PostItWorkspaceData } from "./postit-store";
import { fetchRealPostItFavicon, isGeneratedPostItFavicon } from "./postit-favicon";
import "./postit.css";

type ViewMode = "notes" | "flows";
type Editor = { kind: "note"; value?: PostItNote } | { kind: "flow"; value?: PostItFlow } | null;
type DeleteTarget = { kind: "note"; value: PostItNote } | { kind: "flow"; value: PostItFlow } | null;

const copy = {
  it: {
    area: "POST-IT · MEMORIA VISIVA", title: "Idee, riferimenti e flussi.", subtitle: "Raccogli ciò che conta, collega le idee e ritrovale per significato, non soltanto per parola.",
    search: "Cerca per significato…", local: "Vector DB locale", notes: "Post-it", flows: "Flussi", newNote: "Nuovo post-it", newFlow: "Nuovo flusso", emptyNotes: "Nessun post-it. Crea il primo blocco della tua raccolta.", emptyFlows: "Nessun flusso. Collega almeno due post-it per costruirne uno.",
    titleLabel: "Titolo", link: "Link", text: "Testo", description: "Descrizione del flusso", included: "Post-it inclusi", save: "Salva", saving: "Recupero favicon…", cancel: "Annulla", edit: "Modifica", remove: "Elimina", open: "Apri link", score: "coseno", moveUp: "Sposta prima", moveDown: "Sposta dopo", createNote: "Crea post-it", editNote: "Modifica post-it", createFlow: "Crea flusso", editFlow: "Modifica flusso", deleteTitle: "Conferma eliminazione", deleteNote: "Il post-it verrà rimosso anche dai flussi che lo contengono.", deleteFlow: "Il flusso verrà eliminato; i post-it resteranno disponibili.", loading: "Apro la memoria locale…", searching: "Riordino semantico", flowHint: "Seleziona almeno due post-it e definisci il loro ordine.", noMatch: "Nessun risultato semantico disponibile.", untitled: "Senza titolo", openPostIt: "Apri", removeFromFlow: "Rimuovi dal flusso", keepOne: "Un flusso deve conservare almeno un post-it"
  },
  en: {
    area: "POST-IT · VISUAL MEMORY", title: "Ideas, references and flows.", subtitle: "Collect what matters, connect ideas and retrieve them by meaning rather than by exact words.",
    search: "Search by meaning…", local: "Local Vector DB", notes: "Post-its", flows: "Flows", newNote: "New post-it", newFlow: "New flow", emptyNotes: "No post-its yet. Create the first block in your collection.", emptyFlows: "No flows yet. Connect at least two post-its to build one.",
    titleLabel: "Title", link: "Link", text: "Text", description: "Flow description", included: "Included post-its", save: "Save", saving: "Fetching favicon…", cancel: "Cancel", edit: "Edit", remove: "Delete", open: "Open link", score: "cosine", moveUp: "Move earlier", moveDown: "Move later", createNote: "Create post-it", editNote: "Edit post-it", createFlow: "Create flow", editFlow: "Edit flow", deleteTitle: "Confirm deletion", deleteNote: "The post-it will also be removed from every flow containing it.", deleteFlow: "The flow will be deleted; its post-its will remain available.", loading: "Opening local memory…", searching: "Semantic reordering", flowHint: "Select at least two post-its and define their order.", noMatch: "No semantic result available.", untitled: "Untitled", openPostIt: "Open", removeFromFlow: "Remove from flow", keepOne: "A flow must retain at least one post-it"
  }
} as const;

function formatDate(value: number, language: "it" | "en"): string { return new Intl.DateTimeFormat(language === "it" ? "it-IT" : "en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(value); }

function NoteDialog({ language, value, onClose, onSave }: { language: "it" | "en"; value: PostItNote | undefined; onClose: () => void; onSave: (input: { title: string; link: string; text: string }) => Promise<void> }) {
  const c = copy[language]; const [title, setTitle] = useState(value?.title ?? ""); const [link, setLink] = useState(value?.link ?? ""); const [text, setText] = useState(value?.text ?? ""); const [saving, setSaving] = useState(false); const canSave = Boolean(title.trim() || text.trim());
  const submit = async () => { if (!canSave || saving) return; setSaving(true); try { await onSave({ title, link, text }); } finally { setSaving(false); } };
  return <div className="postit-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="postit-modal" role="dialog" aria-modal="true" aria-labelledby="postit-note-dialog-title">
      <header><div><span>POST-IT</span><h2 id="postit-note-dialog-title">{value ? c.editNote : c.createNote}</h2></div><button type="button" onClick={onClose} aria-label={c.cancel}>×</button></header>
      <div className="postit-form">
        <label><span>{c.titleLabel}</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} /></label>
        <label><span>{c.link}</span><input type="url" value={link} onChange={(event) => setLink(event.target.value)} placeholder="https://…" /></label>
        <label><span>{c.text}</span><textarea value={text} onChange={(event) => setText(event.target.value)} rows={8} maxLength={6000} /></label>
      </div>
      <footer><button type="button" disabled={saving} onClick={onClose}>{c.cancel}</button><button className={`primary ${saving ? "is-saving" : ""}`} type="button" disabled={!canSave || saving} onClick={() => { void submit(); }}>{saving ? <><i />{c.saving}</> : c.save}</button></footer>
    </section>
  </div>;
}

function FlowDialog({ language, value, postIts, onClose, onSave }: { language: "it" | "en"; value: PostItFlow | undefined; postIts: PostItNote[]; onClose: () => void; onSave: (input: { title: string; description: string; postItIds: string[] }) => void }) {
  const c = copy[language]; const [title, setTitle] = useState(value?.title ?? ""); const [description, setDescription] = useState(value?.description ?? ""); const [selected, setSelected] = useState<string[]>(value?.postItIds ?? []);
  const toggle = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const move = (id: string, direction: -1 | 1) => setSelected((current) => { const index = current.indexOf(id); const next = index + direction; if (index < 0 || next < 0 || next >= current.length) return current; const result = [...current]; [result[index], result[next]] = [result[next]!, result[index]!]; return result; });
  const byId = new Map(postIts.map((postIt) => [postIt.id, postIt]));
  return <div className="postit-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="postit-modal postit-flow-modal" role="dialog" aria-modal="true" aria-labelledby="postit-flow-dialog-title">
      <header><div><span>FLOW</span><h2 id="postit-flow-dialog-title">{value ? c.editFlow : c.createFlow}</h2></div><button type="button" onClick={onClose} aria-label={c.cancel}>×</button></header>
      <div className="postit-form postit-flow-form">
        <label><span>{c.titleLabel}</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} /></label>
        <label><span>{c.description}</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} maxLength={4000} /></label>
        <fieldset><legend>{c.included}</legend><p>{c.flowHint}</p><div className="postit-flow-picker">{postIts.map((postIt) => <label key={postIt.id} className={selected.includes(postIt.id) ? "selected" : ""}><input type="checkbox" checked={selected.includes(postIt.id)} onChange={() => toggle(postIt.id)} /><span>{postIt.title || c.untitled}</span></label>)}</div></fieldset>
        {selected.length ? <ol className="postit-flow-order">{selected.map((postItId, index) => <li key={postItId}><span>{index + 1}</span><strong>{byId.get(postItId)?.title || c.untitled}</strong><div><button type="button" disabled={index === 0} aria-label={c.moveUp} onClick={() => move(postItId, -1)}>↑</button><button type="button" disabled={index === selected.length - 1} aria-label={c.moveDown} onClick={() => move(postItId, 1)}>↓</button></div></li>)}</ol> : null}
      </div>
      <footer><button type="button" onClick={onClose}>{c.cancel}</button><button className="primary" type="button" disabled={!title.trim() || selected.length < 2} onClick={() => onSave({ title, description, postItIds: selected })}>{c.save}</button></footer>
    </section>
  </div>;
}

function DeleteDialog({ language, target, onClose, onConfirm }: { language: "it" | "en"; target: Exclude<DeleteTarget, null>; onClose: () => void; onConfirm: () => void }) {
  const c = copy[language];
  return <div className="postit-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="postit-modal postit-delete-modal" role="alertdialog" aria-modal="true" aria-labelledby="postit-delete-title"><header><div><span>{target.kind === "note" ? "POST-IT" : "FLOW"}</span><h2 id="postit-delete-title">{c.deleteTitle}</h2></div></header><p>{target.kind === "note" ? c.deleteNote : c.deleteFlow}</p><strong>{target.value.title || c.untitled}</strong><footer><button type="button" onClick={onClose}>{c.cancel}</button><button className="danger" type="button" onClick={onConfirm}>{c.remove}</button></footer></section></div>;
}

function NoteCard({ language, note, score, index, onEdit, onDelete }: { language: "it" | "en"; note: PostItNote; score: number | null; index: number; onEdit: () => void; onDelete: () => void }) {
  const c = copy[language]; const [faviconFailed, setFaviconFailed] = useState(false);
  return <article className="postit-card" style={{ "--postit-index": index } as React.CSSProperties}>
    <header><div className="postit-favicon">{note.faviconUrl && !faviconFailed ? <img src={note.faviconUrl} alt="" referrerPolicy="no-referrer" onError={() => setFaviconFailed(true)} /> : <span>{(note.title || "P").slice(0, 1).toUpperCase()}</span>}</div><div><h3>{note.title || c.untitled}</h3><time>{formatDate(note.updatedAt, language)}</time></div>{score !== null ? <output>{c.score} {score.toFixed(2)}</output> : null}</header>
    <p>{note.text}</p>
    {note.link ? <a href={note.link} target="_blank" rel="noopener noreferrer"><span>{new URL(note.link).hostname.replace(/^www\./u, "")}</span><b aria-hidden="true">↗</b></a> : null}
    <footer><button type="button" onClick={onEdit}>{c.edit}</button><button type="button" onClick={onDelete}>{c.remove}</button></footer>
  </article>;
}

function FlowCard({ language, flow, postIts, score, index, onEdit, onDelete, onRemovePostIt }: { language: "it" | "en"; flow: PostItFlow; postIts: PostItNote[]; score: number | null; index: number; onEdit: () => void; onDelete: () => void; onRemovePostIt: (postItId: string) => void }) {
  const c = copy[language]; const byId = new Map(postIts.map((postIt) => [postIt.id, postIt])); const nodes = flow.postItIds.map((id) => byId.get(id)).filter((note): note is PostItNote => Boolean(note));
  return <article className="postit-flow-card" style={{ "--postit-index": index } as React.CSSProperties}>
    <header><div><span>FLOW · {String(nodes.length).padStart(2, "0")}</span><h3>{flow.title || c.untitled}</h3></div>{score !== null ? <output>{c.score} {score.toFixed(2)}</output> : null}</header>
    <p>{flow.description}</p>
    <ol>{nodes.map((note, nodeIndex) => <li key={note.id}><i>{nodeIndex + 1}</i>{note.link ? <a className="postit-flow-node-copy" href={note.link} target="_blank" rel="noopener noreferrer" aria-label={`${c.openPostIt}: ${note.title || c.untitled}`}><strong>{note.title || c.untitled}</strong><small>{note.text}</small><b aria-hidden="true">↗</b></a> : <div className="postit-flow-node-copy"><strong>{note.title || c.untitled}</strong><small>{note.text}</small></div>}<button className="postit-flow-node-remove" type="button" disabled={nodes.length <= 1} title={nodes.length <= 1 ? c.keepOne : c.removeFromFlow} aria-label={`${c.removeFromFlow}: ${note.title || c.untitled}`} onClick={() => onRemovePostIt(note.id)}>×</button></li>)}</ol>
    <footer><time>{formatDate(flow.updatedAt, language)}</time><div><button type="button" onClick={onEdit}>{c.edit}</button><button type="button" onClick={onDelete}>{c.remove}</button></div></footer>
  </article>;
}

export function PostItWorkspace({ onHome }: { onHome: () => void }) {
  const { language, theme, setLanguage, setTheme } = useUiPreferences(); const ui = uiCopy[language]; const c = copy[language];
  const [data, setData] = useState<PostItWorkspaceData>({ postIts: [], flows: [] }); const [loading, setLoading] = useState(true); const [view, setView] = useState<ViewMode>("notes"); const [query, setQuery] = useState(""); const deferredQuery = useDeferredValue(query); const [editor, setEditor] = useState<Editor>(null); const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  useEffect(() => { let active = true; void loadPostItWorkspace().then((value) => {
    if (!active) return; setData(value); setLoading(false);
    const candidates = value.postIts.filter((note) => note.link && (!note.faviconUrl || isGeneratedPostItFavicon(note.faviconUrl)));
    void Promise.all(candidates.map(async (note) => [note.id, await fetchRealPostItFavicon(note.link)] as const)).then((resolved) => {
      if (!active) return; const icons = new Map(resolved.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))); if (!icons.size) return;
      setData((current) => { const next = { ...current, postIts: current.postIts.map((note) => icons.has(note.id) && (!note.faviconUrl || isGeneratedPostItFavicon(note.faviconUrl)) ? { ...note, faviconUrl: icons.get(note.id)! } : note) }; void savePostItWorkspace(next); return next; });
    });
  }); return () => { active = false; }; }, []);
  const notes = useMemo(() => rankPostIts(data.postIts, deferredQuery), [data.postIts, deferredQuery]);
  const flows = useMemo(() => rankPostItFlows(data.flows, data.postIts, deferredQuery), [data.flows, data.postIts, deferredQuery]);
  const persist = async (next: PostItWorkspaceData) => setData(await savePostItWorkspace(next));
  const saveNote = async (input: { title: string; link: string; text: string }) => {
    const existing = editor?.kind === "note" ? editor.value : undefined; const now = Date.now(); const created = createPostIt(input, now); const realFavicon = await fetchRealPostItFavicon(created.link); const withFavicon = realFavicon ? { ...created, faviconUrl: realFavicon } : created;
    const note = existing ? { ...withFavicon, id: existing.id, createdAt: existing.createdAt } : withFavicon;
    await persist({ ...data, postIts: existing ? data.postIts.map((item) => item.id === existing.id ? note : item) : [note, ...data.postIts] }); setEditor(null);
  };
  const saveFlow = async (input: { title: string; description: string; postItIds: string[] }) => {
    const existing = editor?.kind === "flow" ? editor.value : undefined; const now = Date.now(); const created = createPostItFlow(input, data.postIts, now);
    const flow = existing ? { ...created, id: existing.id, createdAt: existing.createdAt } : created;
    await persist({ ...data, flows: existing ? data.flows.map((item) => item.id === existing.id ? flow : item) : [flow, ...data.flows] }); setEditor(null);
  };
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const next = deleteTarget.kind === "note" ? { postIts: data.postIts.filter((item) => item.id !== deleteTarget.value.id), flows: data.flows.map((flow) => ({ ...flow, postItIds: flow.postItIds.filter((id) => id !== deleteTarget.value.id) })) } : { ...data, flows: data.flows.filter((item) => item.id !== deleteTarget.value.id) };
    await persist(next); setDeleteTarget(null);
  };
  const removePostItFromFlow = async (flow: PostItFlow, postItId: string) => {
    if (flow.postItIds.length <= 1) return;
    const updated = createPostItFlow({ title: flow.title, description: flow.description, postItIds: flow.postItIds.filter((id) => id !== postItId) }, data.postIts, Date.now());
    await persist({ ...data, flows: data.flows.map((item) => item.id === flow.id ? { ...updated, id: flow.id, createdAt: flow.createdAt } : item) });
  };
  const visibleCount = view === "notes" ? notes.length : flows.length;
  return <div className="postit-workspace" data-ui-copy>
    <header className="postit-toolbar"><div className="brand" aria-label="MLSM Studio — My Lonely Soul Music Studio"><img className="brand-mark" src="/mlsm-studio-favicon-192.png" alt="" /><span className="brand-copy"><strong>MLSM Studio</strong><small>Post-it</small></span></div><button className="toolbar-home" type="button" onClick={onHome}><span aria-hidden="true">⌂</span>{ui.home}</button><div className="postit-toolbar-spacer" /><SettingsButton /><MemoryButton compact /><SupportArtistButton compact /><label><span>{ui.language}</span><select aria-label={ui.language} value={language} onChange={(event) => setLanguage(event.target.value === "en" ? "en" : "it")}><option value="it">IT</option><option value="en">EN</option></select></label><button className="theme-toggle" type="button" onClick={() => setTheme(theme === "day" ? "night" : "day")}><span aria-hidden="true">{theme === "day" ? "☼" : "◐"}</span>{theme === "day" ? ui.day : ui.night}</button></header>
    <main aria-label="Post-it">
      <section className="postit-hero"><div><span>{c.area}</span><h1>{c.title}</h1><p>{c.subtitle}</p></div><div className="postit-vector-status"><i /><span>{c.local}</span><strong>384D</strong></div></section>
      <section className="postit-command-bar" aria-label={c.search}><label className={query !== deferredQuery ? "is-searching" : ""}><span aria-hidden="true">⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={c.search} aria-label={c.search} /><i>{query !== deferredQuery ? c.searching : `${visibleCount}`}</i></label><div className="postit-view-tabs"><button type="button" className={view === "notes" ? "active" : ""} onClick={() => setView("notes")}>{c.notes}<b>{data.postIts.length}</b></button><button type="button" className={view === "flows" ? "active" : ""} onClick={() => setView("flows")}>{c.flows}<b>{data.flows.length}</b></button></div><div className="postit-create-actions"><button type="button" onClick={() => setEditor({ kind: "note" })}><span>＋</span>{c.newNote}</button><button type="button" disabled={data.postIts.length < 2} onClick={() => setEditor({ kind: "flow" })}><span>⌁</span>{c.newFlow}</button></div></section>
      {loading ? <div className="postit-loading" role="status"><i /><span>{c.loading}</span></div> : view === "notes" ? <section className="postit-grid" aria-label={c.notes}>{notes.length ? notes.map(({ item, score }, index) => <NoteCard key={`${item.id}-${deferredQuery}`} language={language} note={item} score={score} index={index} onEdit={() => setEditor({ kind: "note", value: item })} onDelete={() => setDeleteTarget({ kind: "note", value: item })} />) : <div className="postit-empty"><span>＋</span><p>{deferredQuery ? c.noMatch : c.emptyNotes}</p><button type="button" onClick={() => setEditor({ kind: "note" })}>{c.newNote}</button></div>}</section> : <section className="postit-flow-grid" aria-label={c.flows}>{flows.length ? flows.map(({ item, score }, index) => <FlowCard key={`${item.id}-${deferredQuery}`} language={language} flow={item} postIts={data.postIts} score={score} index={index} onEdit={() => setEditor({ kind: "flow", value: item })} onDelete={() => setDeleteTarget({ kind: "flow", value: item })} onRemovePostIt={(postItId) => { void removePostItFromFlow(item, postItId); }} />) : <div className="postit-empty"><span>⌁</span><p>{deferredQuery ? c.noMatch : c.emptyFlows}</p><button type="button" disabled={data.postIts.length < 2} onClick={() => setEditor({ kind: "flow" })}>{c.newFlow}</button></div>}</section>}
    </main>
    {editor?.kind === "note" ? <NoteDialog language={language} value={editor.value} onClose={() => setEditor(null)} onSave={saveNote} /> : null}
    {editor?.kind === "flow" ? <FlowDialog language={language} value={editor.value} postIts={data.postIts} onClose={() => setEditor(null)} onSave={saveFlow} /> : null}
    {deleteTarget ? <DeleteDialog language={language} target={deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={confirmDelete} /> : null}
  </div>;
}
