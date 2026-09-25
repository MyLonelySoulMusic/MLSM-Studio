import { useCallback, useEffect, useMemo, useState, type DragEvent } from "react";
import { parseArticleDocument } from "./media.mjs";
import { api } from "./api";
import type { AppState, ArticleInput, BlogConnection, LibraryMedia, QueueItem, QueueStatus, RecognizedMedia } from "./types";
import { getAutoPostAiStatus, mapAutoPostCategories, type AutoPostAiStatus } from "./category-ai";
import { CATEGORY_VECTOR_MODEL_LABEL, CATEGORY_VECTOR_THRESHOLD, mapAutoPostCategoriesWithVectorDb, readCategoryAssociationMode, readCategorySelectionMode, readCategoryVectorThreshold, writeCategoryAssociationMode, writeCategorySelectionMode, writeCategoryVectorThreshold, type CategoryAssociationMode, type CategorySelectionMode } from "./category-vector";
import { useUiPreferences } from "../services/ui-preferences";
import "./autopost.css";

type Tab = "import" | "queue" | "library" | "stats" | "settings";
type Language = "it" | "en";

type CategoryVectorRankingItem = { id: number; name: string; score: number; evidence?: string };
type CategoryVectorFeedback = {
  categoryName: string;
  score: number;
  fallback: boolean;
  bestCategoryName?: string;
  threshold?: number;
  ranking?: readonly CategoryVectorRankingItem[];
  selectionMode?: CategorySelectionMode;
};
type CategoryMappingState = { state: "loading" | "done" | "error"; label?: string; feedback?: CategoryVectorFeedback };
const EXAMPLE_JSON = JSON.stringify({
  intervalMinutes: 15,
  postsPerRun: 3,
  articles: [{
    title: "Titolo dell’articolo",
    content: "<p>Testo dell’articolo in HTML.</p>",
    excerpt: "Riassunto opzionale",
    slug: "titolo-articolo",
    categories: [1],
    tags: [2],
  }],
}, null, 2);
const copy = {
  it: {
    import: "Importa articoli", queue: "Coda", library: "Libreria", stats: "Statistiche", settings: "WordPress", language: "Lingua", day: "Giorno", night: "Notte",
    eyebrow: "PUBBLICAZIONE EDITORIALE", title: "Dal JSON al blog, senza lavoro ripetitivo.", intro: "Importa fino a 500 articoli, controlla gli embed e lascia che MLSM AutoPost gestisca pubblicazione e ripartenza della coda.",
    choose: "Scegli un file JSON", drop: "oppure trascinalo qui", format: "Scarica JSON di esempio", ready: "Articoli pronti", addQueue: "Aggiungi alla coda", noFile: "Nessun file caricato", pasteJson: "Incolla qui il JSON degli articoli", analyzeJson: "Analizza JSON", pastedJson: "JSON incollato", exactExample: "Esempio esatto da usare", copyExample: "Copia esempio",
    scheduling: "Pianificazione", every: "ogni", articlesPerRun: "Articoli per intervallo", articles: "articoli", minutes: "minuti", start: "Avvia coda", startNow: "Pubblica ora e avvia", pause: "Metti in pausa", next: "Prossima pubblicazione", publishOne: "Pubblica il prossimo ora",
    queued: "In attesa", publishing: "Pubblicazione", published: "Pubblicati", failed: "Errori", emptyQueue: "La coda è vuota. Importa un JSON per iniziare.", retry: "Riprova", remove: "Rimuovi", attempts: "tentativi", openPost: "Apri post", clearQueue: "Elimina tutti", clearQueueConfirm: "Eliminare definitivamente tutti gli articoli dalla coda? La pianificazione verrà arrestata.", queueCleared: "Coda svuotata.",
    statsTitle: "Distribuzione dei brani", statsIntro: "Ogni link viene contato quando il relativo articolo viene inviato correttamente a WordPress.", uses: "pubblicazioni", noStats: "Nessun brano pubblicato al momento.", activity: "Attività recente", clear: "Svuota attività",
    wpTitle: "Gestisci i blog WordPress", wpIntro: "Aggiungi tutti i blog che vuoi usare. Credenziali, categorie e destinazioni di pubblicazione restano separate per ogni sito.", site: "URL sito", user: "Username", password: "Application Password", passwordHint: "Lascia vuoto per mantenere quella salvata", status: "Stato nuovi post", public: "Pubblica", draft: "Bozza", save: "Salva blog", test: "Verifica connessione", connected: "Connesso", localData: "Dati locali", loading: "Caricamento…",
    guideTitle: "Dove trovare i dati", guideIntro: "Servono tre informazioni. Non devi installare plugin se il sito usa WordPress 5.6 o successivo.", guideSite: "Apri il blog e copia soltanto l’indirizzo principale, per esempio https://miosito.it. Non aggiungere /wp-admin o /wp-json.", guideUser: "In WordPress apri Utenti → Profilo. Usa il nome utente dell’account, non il nome pubblico o l’email.", guidePassword: "Sempre in Utenti → Profilo, cerca Password per le applicazioni, scrivi “MLSM AutoPost”, premi Aggiungi nuova e copia la password mostrata una sola volta.", guidePermissions: "L’account deve poter creare e pubblicare articoli: ruolo Autore, Editore o Amministratore.", openProfile: "Apri il profilo WordPress", guideMissing: "Se Password per le applicazioni non compare, controlla HTTPS, WordPress 5.6+ e che un plugin di sicurezza non l’abbia disattivata.", notLoginPassword: "Non inserire la normale password con cui accedi a WordPress.",
    notConfigured: "WordPress non configurato", formatTitle: "Formato degli articoli", formatDescription: "Il JSON contiene la frequenza di pubblicazione e l’elenco degli articoli. La musica viene scelta automaticamente dalla libreria.", spotifyTypes: "Spotify: brano o playlist", youtubeTypes: "YouTube: video o playlist", responsiveLayout: "Carosello responsive automatico", imported: "articoli aggiunti alla coda", noEmbed: "Musica assegnata alla pubblicazione", queueIntro: "La posizione, i tentativi e l’esito di ogni articolo sono salvati sul disco.", totalArticles: "articoli totali", uniqueMedia: "Media unici", publishedEmbeds: "Embed pubblicati", credentialTitle: "Credenziale locale cifrata", credentialText: "La Application Password non viene mai restituita al browser dopo il salvataggio. Il servizio locale la usa soltanto per comunicare con il dominio WordPress configurato.", close: "Chiudi", permissions: "Permessi", invalidJson: "Seleziona un file .json", libraryTitle: "Libreria musicale", libraryIntro: "Salva link Spotify e YouTube. Il tipo viene riconosciuto automaticamente e la priorità determina il peso nell’estrazione.", mediaUrl: "Link Spotify o YouTube", priority: "Priorità", addMedia: "Aggiungi alla libreria", tracksPerPost: "Brani per articolo", playlistEvery: "Playlist ogni quanti brani", saveLibrary: "Salva regole", emptyLibrary: "La libreria è vuota. Aggiungi il primo brano o una playlist.", removeMedia: "Rimuovi", librarySaved: "Libreria aggiornata.", trackCounter: "brani dall’ultima playlist", transferTitle: "Backup della libreria", transferIntro: "Esporta brani, playlist, priorità e regole oppure importa un backup JSON.", exportLibrary: "Esporta libreria", importLibrary: "Importa libreria", importMode: "Modalità di importazione", appendMode: "Aggiungi alle voci esistenti", replaceMode: "Sovrascrivi tutta la libreria", chooseLibraryFile: "Scegli backup JSON", duplicatesIgnored: "duplicati ignorati",
  },
  en: {
    import: "Import articles", queue: "Queue", library: "Library", stats: "Statistics", settings: "WordPress", language: "Language", day: "Day", night: "Night",
    eyebrow: "EDITORIAL PUBLISHING", title: "From JSON to your blog, without repetitive work.", intro: "Import up to 500 articles, review embeds and let MLSM AutoPost publish and safely resume the queue.",
    choose: "Choose a JSON file", drop: "or drop it here", format: "Download sample JSON", ready: "Articles ready", addQueue: "Add to queue", noFile: "No file loaded", pasteJson: "Paste the articles JSON here", analyzeJson: "Analyze JSON", pastedJson: "Pasted JSON", exactExample: "Exact example to use", copyExample: "Copy example",
    scheduling: "Scheduling", every: "every", articlesPerRun: "Articles per interval", articles: "articles", minutes: "minutes", start: "Start queue", startNow: "Publish now and start", pause: "Pause", next: "Next publication", publishOne: "Publish next now",
    queued: "Queued", publishing: "Publishing", published: "Published", failed: "Errors", emptyQueue: "The queue is empty. Import a JSON to begin.", retry: "Retry", remove: "Remove", attempts: "attempts", openPost: "Open post", clearQueue: "Delete all", clearQueueConfirm: "Permanently delete every article from the queue? Scheduling will be stopped.", queueCleared: "Queue cleared.",
    statsTitle: "Track distribution", statsIntro: "A link is counted after its article has been successfully sent to WordPress.", uses: "publications", noStats: "No tracks published yet.", activity: "Recent activity", clear: "Clear activity",
    wpTitle: "Manage WordPress blogs", wpIntro: "Add every blog you want to use. Credentials, categories and publishing targets remain separate for each site.", site: "Site URL", user: "Username", password: "Application Password", passwordHint: "Leave blank to keep the saved password", status: "New post status", public: "Publish", draft: "Draft", save: "Save blog", test: "Test connection", connected: "Connected", localData: "Local data", loading: "Loading…",
    guideTitle: "Where to find the details", guideIntro: "You need three pieces of information. No plugin is required on WordPress 5.6 or later.", guideSite: "Open the blog and copy its main address, for example https://example.com. Do not append /wp-admin or /wp-json.", guideUser: "In WordPress, open Users → Profile. Use the account username, not its public display name or email address.", guidePassword: "Still in Users → Profile, find Application Passwords, enter “MLSM AutoPost”, select Add New and copy the password shown once.", guidePermissions: "The account must be allowed to create and publish posts: Author, Editor or Administrator.", openProfile: "Open WordPress profile", guideMissing: "If Application Passwords is missing, check HTTPS, WordPress 5.6+ and whether a security plugin has disabled it.", notLoginPassword: "Do not enter your normal WordPress login password.",
    notConfigured: "WordPress not configured", formatTitle: "Article format", formatDescription: "The JSON contains the publishing interval and the articles. Music is selected automatically from the library.", spotifyTypes: "Spotify: track or playlist", youtubeTypes: "YouTube: video or playlist", responsiveLayout: "Automatic responsive carousel", imported: "articles added to the queue", noEmbed: "Music assigned on publication", queueIntro: "The position, attempts and outcome of every article are stored on disk.", totalArticles: "total articles", uniqueMedia: "Unique media", publishedEmbeds: "Published embeds", credentialTitle: "Encrypted local credential", credentialText: "The Application Password is never returned to the browser after saving. The local service uses it only to contact the configured WordPress domain.", close: "Close", permissions: "Permissions", invalidJson: "Choose a .json file", libraryTitle: "Music library", libraryIntro: "Save Spotify and YouTube links. Their type is recognized automatically and priority controls their draw weight.", mediaUrl: "Spotify or YouTube link", priority: "Priority", addMedia: "Add to library", tracksPerPost: "Tracks per article", playlistEvery: "Playlist every how many tracks", saveLibrary: "Save rules", emptyLibrary: "The library is empty. Add your first track or playlist.", removeMedia: "Remove", librarySaved: "Library updated.", trackCounter: "tracks since the last playlist", transferTitle: "Library backup", transferIntro: "Export tracks, playlists, priorities and rules, or import a JSON backup.", exportLibrary: "Export library", importLibrary: "Import library", importMode: "Import mode", appendMode: "Append to existing items", replaceMode: "Replace the entire library", chooseLibraryFile: "Choose backup JSON", duplicatesIgnored: "duplicates ignored",
  },
} as const;

const statusLabel = (status: QueueStatus, language: Language) => ({ queued: copy[language].queued, publishing: copy[language].publishing, published: copy[language].published, failed: copy[language].failed })[status];
const formatDate = (value: string | null, language: Language) => value ? new Intl.DateTimeFormat(language === "it" ? "it-IT" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";

const formatCosine = (value: number): string => value.toFixed(2);
const vectorMappingLabel = (result: CategoryVectorFeedback): string => {
  const threshold = result.threshold ?? CATEGORY_VECTOR_THRESHOLD;
  const selectedCategory = result.categoryName || "WordPress default";
  const bestCategory = result.bestCategoryName || "candidata non disponibile";
  const score = formatCosine(result.score);
  const thresholdLabel = formatCosine(threshold);
  return result.fallback
    ? ["Vector DB", "fallback", "migliore candidata “" + bestCategory + "”", "coseno reale " + score, "soglia " + thresholdLabel, "selezionata “" + selectedCategory + "”"].join(" · ")
    : ["Vector DB", "coseno " + score, selectedCategory, "soglia " + thresholdLabel, "selezionata “" + selectedCategory + "”"].join(" · ");
};

function VectorRanking({ ranking, language }: { ranking: readonly CategoryVectorRankingItem[]; language: Language }) {
  const winningEvidence = ranking[0]?.evidence;
  return <details className="autopost-vector-ranking"><summary>{language === "it" ? "Mostra ranking cosine (" + ranking.length + ")" : "Show cosine ranking (" + ranking.length + ")"}</summary>{winningEvidence ? <p>Passaggio con coseno massimo: “{winningEvidence}”</p> : null}<ol>{ranking.map(entry => <li key={entry.id}><span>{entry.name} · {language === "it" ? "coseno" : "cosine"} {formatCosine(entry.score)}{entry.evidence ? " · " + entry.evidence : ""}</span><b>#{entry.id}</b></li>)}</ol></details>;
}
function Brand() {
  return <div className="autopost-brand" aria-label="MLSM AutoPost"><img className="autopost-brand-mark" src="/mlsm-studio-favicon-192.png" alt="" /><span><strong>MLSM AutoPost</strong><small>My Lonely Soul Music</small></span></div>;
}

function NavIcon({ tab }: { tab: Tab }) {
  if (tab === "import") return <path d="M12 3v12m-5-5 5 5 5-5M4 19h16" />;
  if (tab === "queue") return <><path d="M7 6h13M7 12h13M7 18h13" /><path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></>;
  if (tab === "library") return <><path d="M9 18V5l10-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="16" cy="16" r="3" /></>;
  if (tab === "stats") return <path d="M5 19V9m7 10V4m7 15v-7" />;
  return <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" /></>;
}

function MediaBadge({ media, language }: { media: RecognizedMedia; language: Language }) {
  const label = media.kind === "playlist" ? "Playlist" : media.provider === "youtube" ? "Video" : language === "it" ? "Brano" : "Track";
  return <span className={`autopost-media-badge autopost-is-${media.provider}`}><b>{media.provider === "youtube" ? "▶" : "●"}</b>{label}</span>;
}

function Empty({ children }: { children: string }) { return <div className="autopost-empty"><span>◇</span><p>{children}</p></div>; }

function profileUrl(value: string) {
  try { const url = new URL(value); return `${url.origin}${url.pathname.replace(/\/$/, "")}/wp-admin/profile.php`; }
  catch { return ""; }
}

const emptyBlogForm = () => ({ id: "", name: "", siteUrl: "", username: "", password: "", defaultStatus: "publish" as "publish" | "draft" });

export function AutoPostApp({ onHome }: { onHome: () => void }) {
  const [tab, setTab] = useState<Tab>("import");
  const { language, theme, setLanguage, setTheme } = useUiPreferences();
  const [state, setState] = useState<AppState | null>(null);
  const [articleDocument, setArticleDocument] = useState<unknown>(null);
  const [preview, setPreview] = useState<ArticleInput[]>([]);
  const [articleBlogIds, setArticleBlogIds] = useState<string[][]>([]);
  const [articleCategories, setArticleCategories] = useState<Array<Record<string, number[]>>>([]);
  const [sourceBlogId, setSourceBlogId] = useState("");
  const [llmStatus, setLlmStatus] = useState<AutoPostAiStatus | null>(null);
  const [categoryAssociationMode, setCategoryAssociationMode] = useState<CategoryAssociationMode>(readCategoryAssociationMode);
  const [categoryVectorThreshold, setCategoryVectorThreshold] = useState(readCategoryVectorThreshold);
  const [categorySelectionMode, setCategorySelectionMode] = useState<CategorySelectionMode>(readCategorySelectionMode);
  const [categoryMapping, setCategoryMapping] = useState<Record<string, CategoryMappingState>>({});
  const [associationProgress, setAssociationProgress] = useState<{ done: number; total: number; label: string; complete?: boolean } | null>(null);
  const [categoryBlogId, setCategoryBlogId] = useState("");
  const [fileName, setFileName] = useState("");
  const [pastedJson, setPastedJson] = useState("");
  const [interval, setIntervalValue] = useState(15);
  const [postsPerRun, setPostsPerRun] = useState(1);
  const [libraryEntry, setLibraryEntry] = useState({ url: "", priority: 50 });
  const [libraryRules, setLibraryRules] = useState({ tracksPerPost: 2, playlistEveryTracks: 10 });
  const [libraryImportMode, setLibraryImportMode] = useState<"append" | "replace">("append");
  const [blogForm, setBlogForm] = useState(emptyBlogForm);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [now, setNow] = useState(Date.now());
  const t = copy[language];
  const refresh = useCallback(async (quiet = false) => {
    try { const next = await api.state(); setState(next); if (!quiet) { setIntervalValue(next.schedule.intervalMinutes); setPostsPerRun(next.schedule.postsPerRun); setLibraryRules({ tracksPerPost: next.library.tracksPerPost, playlistEveryTracks: next.library.playlistEveryTracks }); } }
    catch (error) { if (!quiet) setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) }); }
  }, []);
  useEffect(() => { void refresh(); const poll = window.setInterval(() => void refresh(true), 4_000); const clock = window.setInterval(() => setNow(Date.now()), 1_000); return () => { clearInterval(poll); clearInterval(clock); }; }, [refresh]);
  useEffect(() => { void getAutoPostAiStatus().then(setLlmStatus).catch(() => setLlmStatus(null)); }, []);
  useEffect(() => {
    if (!state) return;
    if (!state.blogs.some((blog) => blog.id === categoryBlogId)) setCategoryBlogId(state.blogs[0]?.id || "");
  }, [categoryBlogId, state]);

  const run = async (name: string, task: () => Promise<void>) => {
    if (busy) return;
    setBusy(name); setNotice(null);
    try { await task(); } catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(""); }
  };
  const loadDocument = (value: unknown, name: string) => {
    const parsed = parseArticleDocument(value);
    const onlyBlog = state?.blogs.length === 1 ? state.blogs[0] : undefined;
    setArticleDocument(value); setPreview(parsed.articles); setFileName(name);
    setSourceBlogId(onlyBlog?.id || "");
    setArticleBlogIds(parsed.articles.map(() => onlyBlog ? [onlyBlog.id] : []));
    setArticleCategories(parsed.articles.map((article) => onlyBlog ? { [onlyBlog.id]: article.categories } : {}));
    setCategoryMapping({});
    setIntervalValue(parsed.intervalMinutes ?? state?.schedule.intervalMinutes ?? 15);
    setPostsPerRun(parsed.postsPerRun ?? state?.schedule.postsPerRun ?? 1);
  };
  const readFile = async (file?: File) => {
    if (!file) return;
    await run("file", async () => {
      if (!file.name.toLowerCase().endsWith(".json")) throw new Error(t.invalidJson);
      loadDocument(JSON.parse(await file.text()), file.name);
    });
  };
  const exportLibrary = async () => {
    await run("library-export", async () => {
      const document = await api.exportLibrary();
      const blob = new Blob([JSON.stringify(document, null, 2)], { type: "application/json" });
      const href = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = href;
      link.download = `mlsm-library-${new Date().toISOString().slice(0, 10)}.json`;
      window.document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      setNotice({ kind: "ok", text: language === "it" ? "Libreria esportata." : "Library exported." });
    });
  };
  const importLibrary = async (file?: File) => {
    if (!file) return;
    await run("library-import", async () => {
      if (!file.name.toLowerCase().endsWith(".json")) throw new Error(t.invalidJson);
      const result = await api.importLibrary(JSON.parse(await file.text()), libraryImportMode);
      setState(result.state);
      setLibraryRules({ tracksPerPost: result.state.library.tracksPerPost, playlistEveryTracks: result.state.library.playlistEveryTracks });
      const importedLabel = language === "it" ? "elementi importati" : "items imported";
      setNotice({ kind: "ok", text: `${result.imported} ${importedLabel} · ${result.duplicates} ${t.duplicatesIgnored}.` });
    });
  };
  const copyBlogCategories = async (blog: BlogConnection) => {
    const categoryJson = JSON.stringify(blog.categories.map(({ id, name }) => ({ id, name })), null, 2);
    await navigator.clipboard.writeText(categoryJson);
    setNotice({ kind: "ok", text: language === "it" ? `${blog.categories.length} categorie di ${blog.name} copiate.` : `${blog.categories.length} categories from ${blog.name} copied.` });
  };
  const drop = (event: DragEvent) => { event.preventDefault(); void readFile(event.dataTransfer.files[0]); };
  const chooseSourceBlog = async (blogId: string) => {
    setSourceBlogId(blogId);
    setArticleBlogIds(preview.map(() => blogId ? [blogId] : []));
    setArticleCategories(preview.map(article => blogId ? { [blogId]: article.categories } : {}));
    setCategoryMapping({});
    if (!blogId) return;
    try { setState(await api.refreshBlogCategories(blogId)); }
    catch (error) { setNotice({ kind: "error", text: error instanceof Error ? error.message : String(error) }); }
  };
  const changeCategoryAssociationMode = (mode: CategoryAssociationMode) => {
    writeCategoryAssociationMode(mode);
    setCategoryAssociationMode(mode);
    setArticleBlogIds(preview.map(() => sourceBlogId ? [sourceBlogId] : []));
    setArticleCategories(preview.map(article => sourceBlogId ? { [sourceBlogId]: article.categories } : {}));
    setCategoryMapping({});
    setAssociationProgress(null);
  };
  const changeCategoryVectorThreshold = (value: number) => {
    const next = Math.min(1, Math.max(0, value));
    writeCategoryVectorThreshold(next);
    setCategoryVectorThreshold(next);
  };
  const changeCategorySelectionMode = (value: CategorySelectionMode) => {
    writeCategorySelectionMode(value);
    setCategorySelectionMode(value);
  };
  const mapArticleToTarget = async (articleIndex: number, sourceBlog: BlogConnection, targetBlog: BlogConnection): Promise<boolean> => {
    const mappingKey = `${articleIndex}:${targetBlog.id}`;
    const article = preview[articleIndex];
    if (!article) return false;
    setCategoryMapping(current => ({ ...current, [mappingKey]: { state: "loading", label: categoryAssociationMode === "vector" ? "Preparazione Vector DB locale…" : "Invio al modello LLM…" } }));
    try {
      const refreshed = await api.refreshBlogCategories(targetBlog.id);
      setState(refreshed);
      const currentTarget = refreshed.blogs.find(blog => blog.id === targetBlog.id);
      if (!currentTarget || currentTarget.categoryError) throw new Error(currentTarget?.categoryError || "Blog destinazione non disponibile.");
      targetBlog = currentTarget;
      if (categoryAssociationMode === "vector") {
        const result = await mapAutoPostCategoriesWithVectorDb(article, targetBlog, label => {
          setCategoryMapping(current => ({ ...current, [mappingKey]: { state: "loading", label } }));
          setAssociationProgress(current => current ? { ...current, label } : current);
        }, categoryVectorThreshold, categorySelectionMode);
        setCategoriesForArticle(articleIndex, targetBlog.id, result.categoryIds);
        const feedback = result as typeof result & CategoryVectorFeedback;
        const label = vectorMappingLabel(feedback);
        setCategoryMapping(current => ({ ...current, [mappingKey]: { state: "done", label, feedback } }));
      } else {
        const result = await mapAutoPostCategories(article, sourceBlog, targetBlog);
        setCategoriesForArticle(articleIndex, targetBlog.id, result.categoryIds);
        setCategoryMapping(current => ({ ...current, [mappingKey]: { state: "done", label: `${result.label} · ${result.model}` } }));
      }
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setArticleCategories(current => current.map((categories, index) => index === articleIndex ? { ...categories, [targetBlog.id]: [] } : categories));
      setCategoryMapping(current => ({ ...current, [mappingKey]: { state: "error", label: detail } }));
      console.error("[AutoPost] Associazione categorie non riuscita", { mode: categoryAssociationMode, sourceBlogId, targetBlogId: targetBlog.id, detail });
      setNotice({ kind: "error", text: detail });
      return false;
    }
  };
  const toggleArticleBlog = async (articleIndex: number, blogId: string) => {
    const selected = articleBlogIds[articleIndex]?.includes(blogId) || false;
    const mappingKey = `${articleIndex}:${blogId}`;
    setArticleBlogIds(current => current.map((ids, index) => index !== articleIndex ? ids : selected ? ids.filter(id => id !== blogId) : [...ids, blogId]));
    if (selected) {
      setArticleCategories(current => current.map((categories, index) => {
        if (index !== articleIndex) return categories;
        const remaining = { ...categories };
        delete remaining[blogId];
        return remaining;
      }));
      setCategoryMapping(current => { const remaining = { ...current }; delete remaining[mappingKey]; return remaining; });
      return;
    }
    if (blogId === sourceBlogId) {
      setCategoriesForArticle(articleIndex, blogId, preview[articleIndex]?.categories || []);
      return;
    }
    if (!sourceBlogId) {
      setNotice({ kind: "error", text: language === "it" ? "Prima indica il blog sul quale sono stati scritti gli articoli." : "First choose the blog where the articles were originally written." });
      return;
    }
    try {
      const sourceBlog = state?.blogs.find(blog => blog.id === sourceBlogId);
      const targetBlog = state?.blogs.find(blog => blog.id === blogId);
      if (!sourceBlog || !targetBlog) throw new Error(language === "it" ? "Blog sorgente o destinazione non disponibile." : "Source or destination blog is unavailable.");
      setAssociationProgress({ done: 0, total: 1, label: preview[articleIndex]?.title || "Articolo" });
      const completed = await mapArticleToTarget(articleIndex, sourceBlog, targetBlog);
      setAssociationProgress({ done: 1, total: 1, label: completed ? (language === "it" ? "Associazione completata" : "Mapping complete") : (language === "it" ? "Associazione non riuscita" : "Mapping failed"), complete: true });
      window.setTimeout(() => setAssociationProgress(null), 1_500);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setArticleCategories(current => current.map((categories, index) => index === articleIndex ? { ...categories, [blogId]: [] } : categories));
      setCategoryMapping(current => ({ ...current, [mappingKey]: { state: "error", label: detail } }));
      console.error("[AutoPost] Associazione categorie non riuscita", { sourceBlogId, targetBlogId: blogId, detail });
      setNotice({ kind: "error", text: detail });
    }
  };
  const mapTargetBlogForAllArticles = async (blogId: string) => {
    if (!sourceBlogId || !preview.length || blogId === sourceBlogId) return;
    setArticleBlogIds(current => current.map(ids => ids.includes(blogId) ? ids : [...ids, blogId]));
    setAssociationProgress({ done: 0, total: preview.length, label: language === "it" ? "Preparazione categorie…" : "Preparing categories…" });
    try {
      const sourceBlog = state?.blogs.find(blog => blog.id === sourceBlogId);
      const targetBlog = state?.blogs.find(blog => blog.id === blogId);
      if (!sourceBlog || !targetBlog) throw new Error(language === "it" ? "Blog sorgente o destinazione non disponibile." : "Source or destination blog is unavailable.");
      let completed = 0;
      let failures = 0;
      for (let index = 0; index < preview.length; index += 1) {
        const article = preview[index];
        if (!article) continue;
        setAssociationProgress({ done: completed, total: preview.length, label: article.title });
        const succeeded = await mapArticleToTarget(index, sourceBlog, targetBlog);
        if (!succeeded) failures += 1;
        completed += 1;
        setAssociationProgress({ done: completed, total: preview.length, label: article.title });
      }
      const completionLabel = failures
        ? (language === "it" ? `Completata con ${failures} errori per ${targetBlog.name}` : `Completed with ${failures} errors for ${targetBlog.name}`)
        : (language === "it" ? `Associazione completata per ${targetBlog.name}` : `Mapping completed for ${targetBlog.name}`);
      setAssociationProgress({ done: completed, total: preview.length, label: completionLabel, complete: true });
      window.setTimeout(() => setAssociationProgress(null), 1_800);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setAssociationProgress({ done: 0, total: preview.length, label: detail, complete: true });
      setNotice({ kind: "error", text: detail });
    }
  };
  const setCategoriesForArticle = (articleIndex: number, blogId: string, categoryIds: number[]) => {
    setArticleCategories((current) => current.map((categories, index) => index === articleIndex ? { ...categories, [blogId]: categoryIds } : categories));
  };
  const queued = state?.summary.queued || 0;
  const canPublish = Boolean(state?.blogs.length && state.queue.filter((item) => item.status === "queued").every((item) => item.blogIds.every((id) => state.blogs.find((blog) => blog.id === id)?.hasPassword)));
  const nextSeconds = state?.schedule.nextRunAt ? Math.max(0, Math.ceil((Date.parse(state.schedule.nextRunAt) - now) / 1000)) : null;
  const nextLabel = nextSeconds === null ? "—" : nextSeconds < 60 ? `${nextSeconds}s` : `${Math.floor(nextSeconds / 60)}m ${nextSeconds % 60}s`;
  const stats = useMemo(() => Object.values(state?.stats || {}).sort((a, b) => b.publishCount - a.publishCount), [state]);
  const categoryBlog = state?.blogs.find((blog) => blog.id === categoryBlogId);
  const associationBusy = Boolean(associationProgress && !associationProgress.complete);

  return <div className="autopost-shell" data-ui-copy>
    <header className="autopost-topbar">
      <Brand />
      <button className="autopost-home" type="button" onClick={onHome} aria-label={language === "it" ? "Torna alle aree" : "Back to areas"}><span aria-hidden="true">⌂</span>{language === "it" ? "Aree" : "Areas"}</button>
      <div className="autopost-topbar-status"><i className={state?.blogs.some((blog) => blog.hasPassword) ? "autopost-is-online" : ""} /><span>{state?.blogs.length ? `${state.blogs.length} ${state.blogs.length === 1 ? "blog" : "blog"} WordPress` : t.notConfigured}</span></div>
      <div className="autopost-topbar-controls"><label><span>{t.language}</span><select aria-label={t.language} value={language} onChange={(event) => setLanguage(event.target.value as Language)}><option value="it">IT</option><option value="en">EN</option></select></label><button onClick={() => setTheme(theme === "day" ? "night" : "day")} aria-label={theme === "day" ? t.night : t.day}>{theme === "day" ? "☼" : "◐"}<span>{theme === "day" ? t.day : t.night}</span></button></div>
    </header>
    <aside className="autopost-sidebar">
      <nav>{(["import", "queue", "library", "stats", "settings"] as Tab[]).map((item) => <button key={item} className={tab === item ? "autopost-active" : ""} onClick={() => setTab(item)}><svg viewBox="0 0 24 24"><NavIcon tab={item} /></svg><span>{t[item]}</span>{item === "queue" && queued > 0 ? <b>{queued}</b> : null}</button>)}</nav>
      <div className="autopost-sidebar-summary"><small>{t.scheduling}</small><strong>{state?.schedule.enabled ? `${state.schedule.postsPerRun} ${t.articles} ${t.every} ${state.schedule.intervalMinutes} min` : language === "it" ? "In pausa" : "Paused"}</strong><span>{t.next}: {nextLabel}</span></div>
    </aside>
    <main className="autopost-workspace">
      {tab === "import" && <section className="autopost-page autopost-import-page">
        <div className="autopost-hero"><span>{t.eyebrow}</span><h1>{t.title}</h1><p>{t.intro}</p></div>
        {state?.blogs.length ? <article className="autopost-home-categories"><div><span className="autopost-library-kicker">WORDPRESS TAXONOMY</span><h2>{language === "it" ? "Categorie del blog" : "Blog categories"}</h2><p>{language === "it" ? "Seleziona un blog per consultare o copiare in massa le categorie disponibili durante la scrittura." : "Select a blog to browse or bulk-copy the categories available while writing."}</p></div><div className="autopost-home-category-actions"><label>{language === "it" ? "Blog" : "Blog"}<select value={categoryBlogId} onChange={(event) => setCategoryBlogId(event.target.value)}>{state.blogs.map((blog) => <option key={blog.id} value={blog.id}>{blog.name}</option>)}</select></label><button disabled={!categoryBlog?.categories.length} onClick={() => categoryBlog && void run("copy-categories", async () => copyBlogCategories(categoryBlog))}>{language === "it" ? "Copia tutte" : "Copy all"}</button></div><div className="autopost-category-cloud">{categoryBlog?.categories.length ? categoryBlog.categories.map((category) => <span key={category.id}><b>{category.id}</b>{category.name}</span>) : <em>{language === "it" ? "Nessuna categoria sincronizzata." : "No synchronized categories."}</em>}</div></article> : null}
        <div className="autopost-import-grid">
          <article className="autopost-drop-card" onDragOver={(event) => event.preventDefault()} onDrop={drop}>
            <div className="autopost-drop-icon"><svg viewBox="0 0 24 24"><path d="M12 4v11m-5-5 5 5 5-5M5 20h14" /></svg></div>
            <strong>{fileName || t.noFile}</strong><p>{t.drop}</p>
            <label className="autopost-primary autopost-file-button">{t.choose}<input type="file" accept="application/json,.json" onChange={(event) => void readFile(event.target.files?.[0])} /></label>
            <a href="/autopost-example-articles.json" download>{t.format}</a>
            <span className="autopost-import-divider">{language === "it" ? "oppure incolla" : "or paste"}</span>
            <textarea aria-label={t.pasteJson} placeholder={t.pasteJson} value={pastedJson} onChange={(event) => setPastedJson(event.target.value)} />
            <button disabled={!pastedJson.trim() || Boolean(busy)} onClick={() => void run("paste", async () => loadDocument(JSON.parse(pastedJson), t.pastedJson))}>{t.analyzeJson}</button>
          </article>
          <article className="autopost-format-card"><span>JSON</span><h2>{t.exactExample}</h2><p>{t.formatDescription}</p><pre><code>{EXAMPLE_JSON}</code></pre><div className="autopost-example-actions"><button onClick={() => void navigator.clipboard.writeText(EXAMPLE_JSON).then(() => setNotice({ kind: "ok", text: language === "it" ? "Esempio copiato." : "Example copied." }))}>{t.copyExample}</button><a href="/autopost-example-articles.json" download>{t.format}</a></div><ul><li>{t.spotifyTypes}</li><li>{t.youtubeTypes}</li><li>{t.responsiveLayout}</li></ul></article>
        </div>
        {preview.length > 0 && <section className="autopost-preview-section">
          <header><div><small>{fileName}</small><h2>{preview.length} {t.ready.toLowerCase()}</h2></div><button className="autopost-primary" disabled={Boolean(busy) || associationBusy || !sourceBlogId || articleBlogIds.some(ids => !ids.length) || Object.values(categoryMapping).some(mapping => mapping.state === "loading")} onClick={() => void run("import", async () => { const result = await api.import(articleDocument, articleBlogIds, articleCategories); setState(result.state); setArticleDocument(null); setPreview([]); setArticleBlogIds([]); setArticleCategories([]); setSourceBlogId(""); setCategoryMapping({}); setFileName(""); setPastedJson(""); setNotice({ kind: "ok", text: `${result.imported} ${t.imported}.` }); setTab("queue"); })}>{t.addQueue}</button></header>
          <div className="autopost-taxonomy-assistant">
            <div><small>SMART TAXONOMY</small><strong>{language === "it" ? "Su quale blog sono stati scritti questi articoli?" : "Which blog were these articles written for?"}</strong><p>{categoryAssociationMode === "vector" ? (language === "it" ? `Gli ID originali restano sul blog sorgente. Per gli altri blog un modello locale multilingua sceglie la categoria con il coseno maggiore; sotto ${formatCosine(categoryVectorThreshold)} usa Uncategorized. Il valore è il coseno massimo sui passaggi dell’articolo, non una probabilità.` : `Original IDs remain on the source blog. For other blogs, a local multilingual model selects the category with the highest cosine; below ${formatCosine(categoryVectorThreshold)} it uses Uncategorized. This is the maximum cosine over article passages, not a probability.`) : (language === "it" ? "Gli ID originali restano sul blog sorgente. Per gli altri blog usa il provider LLM configurato; puoi sempre correggere il risultato." : "Original IDs stay on the source blog. Other blogs use the configured LLM provider; you can always edit the result.")}</p></div>
            <label>{language === "it" ? "Blog sorgente" : "Source blog"}<select aria-label={language === "it" ? "Blog sorgente" : "Source blog"} disabled={associationBusy} value={sourceBlogId} onChange={event => void chooseSourceBlog(event.target.value)}><option value="">{language === "it" ? "Seleziona il blog…" : "Choose a blog…"}</option>{state?.blogs.map(blog => <option key={blog.id} value={blog.id}>{blog.name}</option>)}</select></label>
            <label>{language === "it" ? "Metodo associazione" : "Mapping method"}<select aria-label={language === "it" ? "Metodo associazione" : "Mapping method"} disabled={associationBusy} value={categoryAssociationMode} onChange={event => changeCategoryAssociationMode(event.target.value as CategoryAssociationMode)}><option value="vector">Vector DB · locale</option><option value="llm">LLM · API configurata</option></select></label>
            {categoryAssociationMode === "vector" ? <label>{language === "it" ? "Categorie sopra soglia" : "Categories above threshold"}<select aria-label={language === "it" ? "Categorie sopra soglia" : "Categories above threshold"} disabled={associationBusy} value={categorySelectionMode} onChange={event => changeCategorySelectionMode(event.target.value as CategorySelectionMode)}><option value="first">FIRST · {language === "it" ? "solo la migliore" : "best one only"}</option><option value="all">ALL · {language === "it" ? "tutte" : "all"}</option></select></label> : null}
            {categoryAssociationMode === "vector" ? <label className="autopost-vector-threshold"><span>{language === "it" ? "Soglia coseno" : "Cosine threshold"}<b>{formatCosine(categoryVectorThreshold)}</b></span><input aria-label={language === "it" ? "Soglia coseno" : "Cosine threshold"} type="range" min="0" max="1" step="0.01" disabled={associationBusy} value={categoryVectorThreshold} onChange={event => changeCategoryVectorThreshold(Number(event.target.value))} /><small>{language === "it" ? "Salvata in locale · applicata alle nuove associazioni" : "Saved locally · applied to new mappings"}</small></label> : null}
            <span className={`autopost-llm-pill ${categoryAssociationMode === "vector" || llmStatus ? "autopost-is-ready" : ""}`}><i />{categoryAssociationMode === "vector" ? `${CATEGORY_VECTOR_MODEL_LABEL} · locale · soglia ${formatCosine(categoryVectorThreshold)}` : llmStatus ? `${llmStatus.label} · ${llmStatus.model}` : language === "it" ? "Configura un LLM API in Studio" : "Configure an API LLM in Studio"}</span>
          </div>
          {sourceBlogId && <div className="autopost-bulk-mapping"><span>{language === "it" ? "Associa un blog a tutti gli articoli" : "Map one blog across all articles"}</span>{state?.blogs.filter(blog => blog.id !== sourceBlogId).map(blog => <button key={blog.id} disabled={associationBusy} onClick={() => void mapTargetBlogForAllArticles(blog.id)}>{language === "it" ? `Associa tutti · ${blog.name}` : `Map all · ${blog.name}`}</button>)}</div>}
          {associationProgress && <div className={`autopost-association-progress ${associationProgress.complete ? "autopost-is-complete" : ""}`} role="status" aria-live="polite"><div className="autopost-association-orbit"><i /><i /><i /></div><div><strong>{categoryAssociationMode === "vector" ? "Vector DB locale" : "LLM"} · {associationProgress.done}/{associationProgress.total}</strong><span>{associationProgress.label}</span><div className="autopost-association-track"><i style={{ width: `${Math.round((associationProgress.done / Math.max(1, associationProgress.total)) * 100)}%` }} /></div></div><b>{Math.round((associationProgress.done / Math.max(1, associationProgress.total)) * 100)}%</b></div>}
          <div className="autopost-article-preview-grid">{preview.map((article, index) => <article key={`${article.title}-${index}`}><small>#{String(index + 1).padStart(2, "0")}</small><h3>{article.title}</h3><p>{article.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 150)}</p><div>{article.media.length ? article.media.map(media => <MediaBadge key={`${media.provider}-${media.id}`} media={media} language={language} />) : <span className="autopost-muted">{t.noEmbed}</span>}</div><div className="autopost-article-targets"><strong>{language === "it" ? "Pubblica su" : "Publish to"}</strong><div className="autopost-target-blog-list">{state?.blogs.map(blog => { const mapping = categoryMapping[`${index}:${blog.id}`]; return <label key={blog.id} className={mapping?.state === "loading" ? "autopost-is-mapping" : ""}><input type="checkbox" disabled={!sourceBlogId || associationBusy || mapping?.state === "loading"} checked={articleBlogIds[index]?.includes(blog.id) || false} onChange={() => void toggleArticleBlog(index, blog.id)} />{blog.name}{blog.id === sourceBlogId ? <em>{language === "it" ? "origine" : "source"}</em> : mapping?.state === "loading" ? <em>{categoryAssociationMode === "vector" ? "VECTOR…" : "AI…"}</em> : null}</label>; })}</div>{articleBlogIds[index]?.map(blogId => { const blog = state?.blogs.find(entry => entry.id === blogId); const mapping = categoryMapping[`${index}:${blogId}`]; return blog ? <label className="autopost-category-picker" key={blogId}><span>{blog.name} · {language === "it" ? "categorie" : "categories"}{mapping?.label ? <em className={`autopost-mapping-result autopost-is-${mapping?.state}`}>{mapping?.label}</em> : null}{mapping?.feedback?.ranking?.length ? <VectorRanking ranking={mapping?.feedback.ranking} language={language} /> : null}</span><select multiple disabled={associationBusy || mapping?.state === "loading"} value={(articleCategories[index]?.[blogId] || []).map(String)} onChange={event => setCategoriesForArticle(index, blogId, Array.from(event.currentTarget.selectedOptions, option => Number(option.value)))}>{blog.categories.map(category => <option key={category.id} value={category.id}>{category.name} (#{category.id})</option>)}</select></label> : null; })}</div></article>)}</div>
        </section>}
      </section>}
      {tab === "queue" && <section className="autopost-page autopost-queue-page">
        <div className="autopost-page-heading"><div><span>02 / QUEUE</span><h1>{t.queue}</h1><p>{t.queueIntro}</p></div><div className="autopost-metrics"><div><strong>{state?.summary.queued || 0}</strong><span>{t.queued}</span></div><div><strong>{state?.summary.published || 0}</strong><span>{t.published}</span></div><div><strong>{state?.summary.failed || 0}</strong><span>{t.failed}</span></div></div></div>
        <article className="autopost-scheduler"><div><span className={`autopost-schedule-dot ${state?.schedule.enabled ? "autopost-active" : ""}`} /><div><h2>{t.scheduling}</h2><p>{state?.schedule.enabled ? `${state.schedule.postsPerRun} ${t.articles} ${t.every} ${state.schedule.intervalMinutes} ${t.minutes} · ${t.next}: ${formatDate(state.schedule.nextRunAt, language)} · ${nextLabel}` : language === "it" ? "La coda è in pausa." : "The queue is paused."}</p></div></div><label>{t.articlesPerRun}<span><input type="number" min="1" max="100" value={postsPerRun} onChange={(event) => setPostsPerRun(Math.max(1, Number(event.target.value)))} /> {t.articles}</span></label><label>{t.every}<span><input type="number" min="1" max="10080" value={interval} onChange={(event) => setIntervalValue(Math.max(1, Number(event.target.value)))} /> {t.minutes}</span></label><div className="autopost-actions">{state?.schedule.enabled ? <button onClick={() => void run("schedule", async () => setState(await api.schedule(false, interval, postsPerRun)))}>{t.pause}</button> : <><button disabled={!queued || !canPublish} onClick={() => void run("schedule", async () => setState(await api.schedule(true, interval, postsPerRun, false)))}>{t.start}</button><button className="autopost-primary" disabled={!queued || !canPublish} onClick={() => void run("schedule", async () => setState(await api.schedule(true, interval, postsPerRun, true)))}>{t.startNow}</button></>}</div></article>
        <div className="autopost-queue-toolbar"><span>{state?.queue.length || 0} {t.totalArticles}</span><div><button className="autopost-quiet-danger" disabled={!state?.queue.length || Boolean(busy) || state.queue.some((item) => item.status === "publishing")} onClick={() => { if (window.confirm(t.clearQueueConfirm)) void run("queue-clear", async () => { setState(await api.clearQueue()); setNotice({ kind: "ok", text: t.queueCleared }); }); }}>{t.clearQueue}</button><button disabled={!queued || Boolean(busy) || !canPublish} onClick={() => void run("publish", async () => setState((await api.publishNext()).state))}>{t.publishOne}</button></div></div>
        {!state?.queue.length ? <Empty>{t.emptyQueue}</Empty> : <div className="autopost-queue-list">{state.queue.map((item, index) => <QueueRow key={item.id} item={item} index={index} language={language} blogs={state.blogs} busy={Boolean(busy)} onAction={(action) => void run(action, async () => setState(await api.queueAction(item.id, action)))} />)}</div>}
      </section>}
      {tab === "library" && <section className="autopost-page autopost-library-page">
        <div className="autopost-page-heading"><div><span>03 / MUSIC</span><h1>{t.libraryTitle}</h1><p>{t.libraryIntro}</p></div><div className="autopost-metrics"><div><strong>{state?.library.items.filter((item) => item.kind === "track").length || 0}</strong><span>{language === "it" ? "Brani" : "Tracks"}</span></div><div><strong>{state?.library.items.filter((item) => item.kind === "playlist").length || 0}</strong><span>Playlist</span></div></div></div>
        <article className="autopost-library-transfer"><div><span className="autopost-library-kicker">JSON BACKUP</span><h2>{t.transferTitle}</h2><p>{t.transferIntro}</p></div><button disabled={Boolean(busy)} onClick={() => void exportLibrary()}>{t.exportLibrary}</button><label>{t.importMode}<select value={libraryImportMode} onChange={(event) => setLibraryImportMode(event.target.value as "append" | "replace")}><option value="append">{t.appendMode}</option><option value="replace">{t.replaceMode}</option></select></label><label className="autopost-primary autopost-file-button">{t.chooseLibraryFile}<input type="file" accept="application/json,.json" disabled={Boolean(busy)} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void importLibrary(file); }} /></label></article>
        <div className="autopost-library-controls">
          <form className="autopost-library-add" onSubmit={(event) => { event.preventDefault(); void run("library-add", async () => { const next = await api.addLibraryItem(libraryEntry.url, libraryEntry.priority); setState(next); setLibraryEntry({ url: "", priority: 50 }); setNotice({ kind: "ok", text: t.librarySaved }); }); }}><div><span className="autopost-library-kicker">AUTO DETECT</span><h2>{t.addMedia}</h2><p>{t.spotifyTypes} · {t.youtubeTypes}</p></div><label>{t.mediaUrl}<input type="url" required placeholder="https://open.spotify.com/track/…" value={libraryEntry.url} onChange={(event) => setLibraryEntry({ ...libraryEntry, url: event.target.value })} /></label><label>{t.priority}<span className="autopost-priority-input"><input type="range" min="1" max="100" value={libraryEntry.priority} onChange={(event) => setLibraryEntry({ ...libraryEntry, priority: Number(event.target.value) })} /><b>{libraryEntry.priority}</b></span></label><button className="autopost-primary" disabled={!libraryEntry.url.trim() || Boolean(busy)} type="submit">{t.addMedia}</button></form>
          <form className="autopost-library-rules" onSubmit={(event) => { event.preventDefault(); void run("library-rules", async () => { setState(await api.librarySettings(libraryRules.tracksPerPost, libraryRules.playlistEveryTracks)); setNotice({ kind: "ok", text: t.librarySaved }); }); }}><div><span className="autopost-library-kicker">DISTRIBUTION</span><h2>{language === "it" ? "Regole di estrazione" : "Selection rules"}</h2><p>{state?.library.tracksSincePlaylist || 0} {t.trackCounter}</p></div><label>{t.tracksPerPost}<input type="number" min="1" max="10" value={libraryRules.tracksPerPost} onChange={(event) => setLibraryRules({ ...libraryRules, tracksPerPost: Number(event.target.value) })} /></label><label>{t.playlistEvery}<input type="number" min="1" max="10000" value={libraryRules.playlistEveryTracks} onChange={(event) => setLibraryRules({ ...libraryRules, playlistEveryTracks: Number(event.target.value) })} /></label><button type="submit" disabled={Boolean(busy)}>{t.saveLibrary}</button></form>
        </div>
        {!state?.library.items.length ? <Empty>{t.emptyLibrary}</Empty> : <div className="autopost-library-grid">{state.library.items.map((item) => <LibraryCard key={`${item.provider}:${item.kind}:${item.id}`} item={item} language={language} busy={Boolean(busy)} onPriority={(priority) => void run("library-priority", async () => setState(await api.updateLibraryItem(`${item.provider}:${item.kind}:${item.id}`, priority)))} onRemove={() => void run("library-remove", async () => setState(await api.removeLibraryItem(`${item.provider}:${item.kind}:${item.id}`)))} />)}</div>}
      </section>}
      {tab === "stats" && <section className="autopost-page autopost-stats-page"><div className="autopost-page-heading"><div><span>03 / ANALYTICS</span><h1>{t.statsTitle}</h1><p>{t.statsIntro}</p></div><div className="autopost-metrics"><div><strong>{stats.length}</strong><span>{t.uniqueMedia}</span></div><div><strong>{stats.reduce((sum, item) => sum + item.publishCount, 0)}</strong><span>{t.publishedEmbeds}</span></div></div></div>{stats.length ? <div className="autopost-stats-grid">{stats.map((item) => <article key={`${item.provider}-${item.kind}-${item.id}`}>{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" /> : <div className={`autopost-media-art autopost-is-${item.provider}`}>{item.provider === "youtube" ? "▶" : "●"}</div>}<div><MediaBadge media={item} language={language} /><h2>{item.title}</h2><a href={item.canonicalUrl} target="_blank" rel="noreferrer">{item.canonicalUrl}</a><footer><strong>{item.publishCount}</strong><span>{t.uses}<br />{formatDate(item.lastPublishedAt, language)}</span></footer></div></article>)}</div> : <Empty>{t.noStats}</Empty>}<section className="autopost-activity"><header><h2>{t.activity}</h2><button disabled={!state?.history.length} onClick={() => void run("history", async () => setState(await api.clearHistory()))}>{t.clear}</button></header>{state?.history.slice(0, 20).map((item) => <div key={item.id}><i className={`autopost-is-${item.kind}`} /><span>{item.detail}</span><time>{formatDate(item.at, language)}</time></div>)}</section></section>}
      {tab === "settings" && <section className="autopost-page autopost-settings-page">
        <div className="autopost-page-heading"><div><span>04 / CONNECTION</span><h1>{t.wpTitle}</h1><p>{t.wpIntro}</p></div><button onClick={() => setBlogForm(emptyBlogForm())}>{language === "it" ? "+ Nuovo blog" : "+ New blog"}</button></div>
        <article className="autopost-connection-guide"><header><span>?</span><div><h2>{t.guideTitle}</h2><p>{t.guideIntro}</p></div></header><ol><li><b>01</b><div><strong>{t.site}</strong><p>{t.guideSite}</p></div></li><li><b>02</b><div><strong>{t.user}</strong><p>{t.guideUser}</p></div></li><li><b>03</b><div><strong>{t.password}</strong><p>{t.guidePassword}</p><em>{t.notLoginPassword}</em></div></li><li><b>04</b><div><strong>{t.permissions}</strong><p>{t.guidePermissions}</p></div></li></ol><footer><p>{t.guideMissing}</p>{profileUrl(blogForm.siteUrl) && <a href={profileUrl(blogForm.siteUrl)} target="_blank" rel="noreferrer">{t.openProfile} ↗</a>}</footer></article>
        <article className="autopost-settings-card"><div className="autopost-wordpress-mark">W</div><div className="autopost-settings-form">
          <label>{language === "it" ? "Nome blog (opzionale)" : "Blog name (optional)"}<input placeholder={language === "it" ? "Es. Blog principale" : "E.g. Main blog"} value={blogForm.name} onChange={(event) => setBlogForm({ ...blogForm, name: event.target.value })} /></label>
          <label>{t.site}<input type="url" placeholder="https://example.com" value={blogForm.siteUrl} onChange={(event) => setBlogForm({ ...blogForm, siteUrl: event.target.value })} /></label>
          <label>{t.user}<input value={blogForm.username} onChange={(event) => setBlogForm({ ...blogForm, username: event.target.value })} /></label>
          <label>{t.password}<input type="password" value={blogForm.password} placeholder={blogForm.id ? t.passwordHint : "xxxx xxxx xxxx xxxx xxxx xxxx"} onChange={(event) => setBlogForm({ ...blogForm, password: event.target.value })} /></label>
          <label>{t.status}<select value={blogForm.defaultStatus} onChange={(event) => setBlogForm({ ...blogForm, defaultStatus: event.target.value as "publish" | "draft" })}><option value="publish">{t.public}</option><option value="draft">{t.draft}</option></select></label>
          <div className="autopost-settings-actions"><button disabled={Boolean(busy) || !blogForm.siteUrl || !blogForm.username} onClick={() => void run("blog-test", async () => { const result = await api.testBlog(blogForm); setNotice({ kind: "ok", text: `${t.connected}: ${result.name} · ${result.latencyMs} ms` }); })}>{t.test}</button>{blogForm.id && <button onClick={() => setBlogForm(emptyBlogForm())}>{language === "it" ? "Annulla" : "Cancel"}</button>}<button className="autopost-primary" disabled={Boolean(busy) || !blogForm.siteUrl || !blogForm.username} onClick={() => void run("blog-save", async () => { const next = await api.saveBlog(blogForm); setState(next); setBlogForm(emptyBlogForm()); setNotice({ kind: "ok", text: language === "it" ? "Blog e credenziali salvati." : "Blog and credentials saved." }); })}>{t.save}</button></div>
        </div></article>
        <section className="autopost-blog-list"><header><div><span className="autopost-library-kicker">MULTI-SITE</span><h2>{language === "it" ? "Blog configurati" : "Configured blogs"}</h2></div><strong>{state?.blogs.length || 0}</strong></header>{state?.blogs.length ? state.blogs.map((blog) => <BlogCard key={blog.id} blog={blog} language={language} busy={Boolean(busy)} onEdit={() => setBlogForm({ id: blog.id, name: blog.name, siteUrl: blog.siteUrl, username: blog.username, password: "", defaultStatus: blog.defaultStatus })} onRefresh={() => void run(`categories-${blog.id}`, async () => { const next = await api.refreshBlogCategories(blog.id); setState(next); setNotice({ kind: "ok", text: language === "it" ? `Categorie di ${blog.name} aggiornate.` : `${blog.name} categories updated.` }); })} onCopy={() => void copyBlogCategories(blog)} onRemove={() => void run(`remove-${blog.id}`, async () => { setState(await api.removeBlog(blog.id)); if (blogForm.id === blog.id) setBlogForm(emptyBlogForm()); })} />) : <Empty>{language === "it" ? "Nessun blog configurato." : "No blog configured."}</Empty>}</section>
        <div className="autopost-security-note"><svg viewBox="0 0 24 24"><path d="M6 10V7a6 6 0 0 1 12 0v3M5 10h14v11H5Z" /></svg><div><strong>{t.credentialTitle}</strong><p>{t.credentialText}</p><small>{t.localData}: {state?.dataDirectory || "—"}</small></div></div>
      </section>}
    </main>
    {notice && <div className={`autopost-toast autopost-is-${notice.kind}`} role="status"><span>{notice.kind === "ok" ? "✓" : "!"}</span><p>{notice.text}</p><button aria-label={t.close} onClick={() => setNotice(null)}>×</button></div>}
    {busy && <div className="autopost-busy-line" />}
  </div>;
}

function QueueRow({ item, index, language, blogs, busy, onAction }: { item: QueueItem; index: number; language: Language; blogs: BlogConnection[]; busy: boolean; onAction: (action: "retry" | "remove") => void }) {
  const t = copy[language];
  return <article className="autopost-queue-row"><span className="autopost-queue-index">{String(index + 1).padStart(2, "0")}</span><div className="autopost-queue-copy"><div><span className={`autopost-status autopost-is-${item.status}`}><i />{statusLabel(item.status, language)}</span><time>{formatDate(item.publishedAt || item.createdAt, language)}</time></div><h2>{item.article.title}</h2><div className="autopost-queue-media">{item.article.media.map((media) => <MediaBadge key={`${media.provider}-${media.id}`} media={media} language={language} />)}{item.attempts > 0 && <span className="autopost-muted">{item.attempts} {t.attempts}</span>}</div><div className="autopost-queue-destinations">{item.blogIds.map((blogId) => { const blog = blogs.find((entry) => entry.id === blogId); const result = item.blogResults[blogId]; return <span key={blogId} className={`autopost-destination autopost-is-${result?.status || "queued"}`}><i />{blog?.name || blogId}{result?.wordpressUrl ? <a href={result.wordpressUrl} target="_blank" rel="noreferrer">↗</a> : null}</span>; })}</div>{item.lastError && <p className="autopost-error">{item.lastError}</p>}</div><div className="autopost-row-actions">{item.status === "failed" && <button disabled={busy} onClick={() => onAction("retry")}>{t.retry}</button>}{["queued", "failed"].includes(item.status) && <button className="autopost-quiet-danger" disabled={busy} onClick={() => onAction("remove")}>{t.remove}</button>}</div></article>;
}

function BlogCard({ blog, language, busy, onEdit, onRefresh, onCopy, onRemove }: { blog: BlogConnection; language: Language; busy: boolean; onEdit: () => void; onRefresh: () => void; onCopy: () => void; onRemove: () => void }) {
  const synced = blog.categoriesSyncedAt ? formatDate(blog.categoriesSyncedAt, language) : language === "it" ? "Mai sincronizzate" : "Never synchronized";
  return <article className="autopost-blog-card"><header><div><span className={`autopost-connection-state ${blog.hasPassword ? "autopost-is-ready" : ""}`}><i />{blog.hasPassword ? (language === "it" ? "Credenziali salvate" : "Credentials saved") : (language === "it" ? "Password mancante" : "Password missing")}</span><h3>{blog.name}</h3><a href={blog.siteUrl} target="_blank" rel="noreferrer">{blog.siteUrl}</a></div><div className="autopost-blog-actions"><button disabled={busy} onClick={onEdit}>{language === "it" ? "Modifica" : "Edit"}</button><button disabled={busy} onClick={onRefresh}>{language === "it" ? "Aggiorna categorie" : "Refresh categories"}</button><button disabled={busy || !blog.categories.length} onClick={onCopy}>{language === "it" ? "Copia tutte" : "Copy all"}</button><button className="autopost-quiet-danger" disabled={busy} onClick={onRemove}>{language === "it" ? "Rimuovi" : "Remove"}</button></div></header><div className="autopost-blog-category-summary"><strong>{blog.categories.length} {language === "it" ? "categorie" : "categories"}</strong><span>{synced}</span></div>{blog.categoryError && <p className="autopost-error">{blog.categoryError}</p>}<div className="autopost-category-cloud autopost-compact">{blog.categories.length ? blog.categories.map((category) => <span key={category.id}><b>{category.id}</b>{category.name}</span>) : <em>{language === "it" ? "Premi “Aggiorna categorie” per caricarle." : "Select “Refresh categories” to load them."}</em>}</div></article>;
}

function LibraryCard({ item, language, busy, onPriority, onRemove }: { item: LibraryMedia; language: Language; busy: boolean; onPriority: (priority: number) => void; onRemove: () => void }) {
  const t = copy[language];
  return <article className="autopost-library-card">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" /> : <div className={`autopost-media-art autopost-is-${item.provider}`}>{item.provider === "youtube" ? "▶" : "●"}</div>}<div><MediaBadge media={item} language={language} /><h2>{item.title}</h2><a href={item.canonicalUrl} target="_blank" rel="noreferrer">{item.canonicalUrl}</a><label>{t.priority}<span className="autopost-priority-input"><input aria-label={`${t.priority}: ${item.title}`} type="range" min="1" max="100" defaultValue={item.priority} disabled={busy} onPointerUp={(event) => onPriority(Number(event.currentTarget.value))} onKeyUp={(event) => { if (["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"].includes(event.key)) onPriority(Number(event.currentTarget.value)); }} /><b>{item.priority}</b></span></label><button className="autopost-quiet-danger" disabled={busy} onClick={onRemove}>{t.removeMedia}</button></div></article>;
}
