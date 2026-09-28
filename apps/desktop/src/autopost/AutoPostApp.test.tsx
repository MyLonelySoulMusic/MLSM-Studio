import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoPostApp } from "./AutoPostApp";

const apiMock = vi.hoisted(() => ({ state: vi.fn(), clearQueue: vi.fn(), refreshBlogCategories: vi.fn(), refreshAllBlogCategories: vi.fn(), import: vi.fn() }));
const categoryAiMock = vi.hoisted(() => ({ status: vi.fn(), map: vi.fn() }));
const categoryVectorMock = vi.hoisted(() => ({ map: vi.fn(), writeMode: vi.fn(), writeThreshold: vi.fn(), writeSelectionMode: vi.fn() }));
vi.mock("./api", () => ({ api: apiMock }));
vi.mock("./category-ai", () => ({ getAutoPostAiStatus: categoryAiMock.status, mapAutoPostCategories: categoryAiMock.map }));
vi.mock("./category-vector", () => ({
  CATEGORY_VECTOR_MODEL_LABEL: "MiniLM multilingua",
  CATEGORY_VECTOR_THRESHOLD: 0.4,
  readCategoryAssociationMode: () => "vector",
  readCategoryVectorThreshold: () => 0.4,
  writeCategoryVectorThreshold: categoryVectorMock.writeThreshold,
  readCategorySelectionMode: () => "first",
  writeCategorySelectionMode: categoryVectorMock.writeSelectionMode,
  writeCategoryAssociationMode: categoryVectorMock.writeMode,
  mapAutoPostCategoriesWithVectorDb: categoryVectorMock.map,
}));

const state = {
  blogs: [{ id: "blog-1", name: "Blog principale", siteUrl: "https://example.com", username: "author", defaultStatus: "publish", hasPassword: true, categories: [{ id: 7, name: "Musica", slug: "musica", parent: 0, count: 2 }], categoriesSyncedAt: "2026-09-10T00:00:00Z" }],
  schedule: { enabled: true, intervalMinutes: 15, postsPerRun: 1, nextRunAt: null },
  queue: [{ id: "post-1", article: { title: "Articolo migrato", content: "<p>Testo</p>", excerpt: "", slug: "articolo", categories: [7], tags: [], media: [] }, blogIds: ["blog-1"], categoriesByBlog: { "blog-1": [7] }, blogResults: { "blog-1": { status: "published", wordpressId: 8 } }, status: "published", createdAt: "2026-09-10T00:00:00Z", attempts: 1, lastError: "" }],
  stats: { song: { provider: "spotify", kind: "track", id: "track", canonicalUrl: "https://open.spotify.com/track/testtest", title: "Brano migrato", publishCount: 4, firstPublishedAt: "2026-09-01T00:00:00Z", lastPublishedAt: "2026-09-10T00:00:00Z" } },
  library: { items: [{ provider: "youtube", kind: "track", id: "videoid", canonicalUrl: "https://youtu.be/videoid", title: "Video migrato", priority: 50, createdAt: "2026-09-01T00:00:00Z" }], tracksPerPost: 2, playlistEveryTracks: 10, tracksSincePlaylist: 1 },
  history: [], summary: { published: 1 }, dataDirectory: "/Users/test/.mlsm-autopost",
} as const;

describe("AutoPost integrato", () => {
  beforeEach(() => {
    localStorage.clear();
    apiMock.state.mockResolvedValue(state);
    apiMock.refreshBlogCategories.mockResolvedValue(state);
    apiMock.refreshAllBlogCategories.mockImplementation(async () => {
      const current = await apiMock.state();
      return { state: current, results: current.blogs.map((blog: typeof state.blogs[number]) => ({ blogId: blog.id, blogName: blog.name, endpoint: `${blog.siteUrl}/wp-json/wp/v2/categories`, ok: true, count: blog.categories.length })) };
    });
    categoryAiMock.status.mockResolvedValue({ provider: "nvidia", label: "NVIDIA", model: "openai/gpt-oss-20b" });
    categoryAiMock.map.mockResolvedValue({ provider: "nvidia", label: "NVIDIA", model: "openai/gpt-oss-20b", categoryIds: [2] });
    categoryVectorMock.map.mockResolvedValue({ categoryIds: [2], categoryName: "NEWS MUSIC AI", score: 0.81, fallback: false, bestCategoryName: "NEWS MUSIC AI", threshold: 0.5, ranking: [{ id: 2, name: "NEWS MUSIC AI", score: 0.81, evidence: "Suno v6" }, { id: 3, name: "Tecnologia", score: 0.32 }], model: "paraphrase-multilingual-MiniLM-L12-v2" });
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("mostra i dati persistiti, tutte le schede e torna alle aree", async () => {
    const onHome = vi.fn();
    render(<AutoPostApp onHome={onHome} />);
    await waitFor(() => expect(screen.getByText("Blog principale")).toBeInTheDocument());
    expect(screen.getByText("Categorie del blog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Libreria" }));
    expect(screen.getByText("Video migrato")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Statistiche" }));
    expect(screen.getByText("Brano migrato")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Coda" }));
    expect(screen.getByText("Articolo migrato")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Torna alle aree" }));
    expect(onHome).toHaveBeenCalledOnce();
  });

  it("mostra la foto dell'articolo e apre la sua anteprima editoriale", async () => {
    render(<AutoPostApp onHome={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Blog principale")).toBeInTheDocument());
    const content = '<figure><img src="https://cdn.example/suno.jpg" alt="Suno"></figure><p>Testo completo dell’articolo.</p>';
    fireEvent.change(screen.getByLabelText("Incolla qui il JSON degli articoli"), { target: { value: JSON.stringify({ articles: [{ title: "Suno v6", content, excerpt: "Anteprima Suno" }] }) } });
    fireEvent.click(screen.getByRole("button", { name: "Analizza JSON" }));

    const cover = document.querySelector<HTMLImageElement>(".autopost-article-cover");
    expect(cover?.src).toBe("https://cdn.example/suno.jpg");
    fireEvent.click(screen.getByRole("button", { name: "Modifica e anteprima" }));
    expect(screen.getByRole("dialog", { name: "Suno v6" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Salva modifiche" })).toBeEnabled();
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.querySelector<HTMLElement>(".autopost-workspace")?.style.overflow).toBe("");
    const frame = screen.getByTitle("Anteprima: Suno v6");
    expect(frame.getAttribute("srcdoc")).toContain("Testo completo dell’articolo.");
    fireEvent.click(screen.getByRole("button", { name: "Chiudi anteprima" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe("");
  });

  it("elimina uno o più articoli e importa soltanto quelli rimasti", async () => {
    apiMock.import.mockResolvedValue({ imported: 1, state });
    render(<AutoPostApp onHome={vi.fn()} />);
    await screen.findByText("Blog principale");
    const articles = [
      { title: "Primo articolo", content: "<p>Primo testo</p>", categories: [7] },
      { title: "Articolo da mantenere", content: "<p>Testo centrale</p>", categories: [7] },
      { title: "Terzo articolo", content: "<p>Terzo testo</p>", categories: [7] },
    ];
    fireEvent.change(screen.getByLabelText("Incolla qui il JSON degli articoli"), { target: { value: JSON.stringify({ intervalMinutes: 12, articles }) } });
    fireEvent.click(screen.getByRole("button", { name: "Analizza JSON" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Seleziona articolo: Primo articolo" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Seleziona articolo: Terzo articolo" }));
    fireEvent.click(screen.getByRole("button", { name: "Elimina selezionati (2)" }));

    expect(screen.queryByRole("heading", { name: "Primo articolo" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Articolo da mantenere" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Terzo articolo" })).not.toBeInTheDocument();
    const importButton = screen.getByRole("button", { name: "Aggiungi alla coda" });
    await waitFor(() => expect(importButton).toBeEnabled());
    fireEvent.click(importButton);
    await waitFor(() => expect(apiMock.import).toHaveBeenCalledOnce());
    expect(apiMock.import.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ intervalMinutes: 12, articles: [expect.objectContaining({ title: "Articolo da mantenere" })] }));
  });

  it("modifica testo e immagine dall'anteprima e invia le modifiche alla coda", async () => {
    apiMock.import.mockResolvedValue({ imported: 1, state });
    render(<AutoPostApp onHome={vi.fn()} />);
    await screen.findByText("Blog principale");
    const articleDocument = { articles: [{ title: "Titolo originale", content: '<figure><img src="https://cdn.example/old.jpg"></figure><p>Testo originale</p>', excerpt: "Riassunto originale", categories: [7] }] };
    fireEvent.change(screen.getByLabelText("Incolla qui il JSON degli articoli"), { target: { value: JSON.stringify(articleDocument) } });
    fireEvent.click(screen.getByRole("button", { name: "Analizza JSON" }));
    fireEvent.click(screen.getByRole("button", { name: "Modifica e anteprima" }));

    fireEvent.change(screen.getByLabelText("Titolo articolo"), { target: { value: "Titolo aggiornato" } });
    fireEvent.change(screen.getByLabelText("Riassunto articolo"), { target: { value: "Riassunto aggiornato" } });
    fireEvent.change(screen.getByLabelText("Link immagine principale"), { target: { value: "https://cdn.example/new.jpg" } });
    const editor = screen.getByRole("textbox", { name: "Testo articolo" });
    editor.innerHTML = "<p>Testo aggiornato e corretto</p>";
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: "Salva modifiche" }));

    expect(screen.getByRole("heading", { name: "Titolo aggiornato" })).toBeInTheDocument();
    expect(document.querySelector<HTMLImageElement>(".autopost-article-cover")?.src).toBe("https://cdn.example/new.jpg");
    const importButton = screen.getByRole("button", { name: "Aggiungi alla coda" });
    await waitFor(() => expect(importButton).toBeEnabled());
    fireEvent.click(importButton);
    await waitFor(() => expect(apiMock.import).toHaveBeenCalledOnce());
    expect(apiMock.import.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ articles: [expect.objectContaining({ title: "Titolo aggiornato", excerpt: "Riassunto aggiornato", content: expect.stringContaining("Testo aggiornato e corretto") })] }));
    expect(apiMock.import.mock.calls[0]?.[0].articles[0].content).toContain("https://cdn.example/new.jpg");
  });

  it("legge le categorie WordPress all'apertura e a ogni cambio blog", async () => {
    const secondBlog = { ...state.blogs[0], id: "blog-2", name: "Music TodAI", siteUrl: "https://musictodai.altervista.org", categories: [{ id: 1, name: "Uncategorized", slug: "uncategorized", parent: 0, count: 0 }] };
    const multiState = { ...state, blogs: [state.blogs[0], secondBlog] };
    const refreshedState = { ...multiState, blogs: [state.blogs[0], { ...secondBlog, categories: [{ id: 2, name: "NEWS MUSIC AI", slug: "news-music-ai", parent: 0, count: 3 }], categoriesSyncedAt: "2026-09-25T10:00:00Z" }] };
    apiMock.state.mockResolvedValue(multiState);
    apiMock.refreshAllBlogCategories.mockResolvedValue({ state: multiState, results: multiState.blogs.map((blog) => ({ blogId: blog.id, blogName: blog.name, endpoint: `${blog.siteUrl}/wp-json/wp/v2/categories`, ok: true, count: blog.categories.length })) });
    apiMock.refreshBlogCategories.mockResolvedValue(refreshedState);

    render(<AutoPostApp onHome={vi.fn()} />);
    await waitFor(() => expect(apiMock.refreshAllBlogCategories).toHaveBeenCalledOnce());
    fireEvent.change(screen.getByLabelText("Blog"), { target: { value: "blog-2" } });

    await waitFor(() => expect(apiMock.refreshBlogCategories).toHaveBeenCalledWith("blog-2"));
    expect(await screen.findByText("NEWS MUSIC AI")).toBeInTheDocument();
  });

  it("mantiene il layout AutoPost isolato dalla griglia globale dello Studio", async () => {
    render(<AutoPostApp onHome={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Blog principale")).toBeInTheDocument());

    const shell = document.querySelector<HTMLElement>(".autopost-shell");
    expect(shell).not.toBeNull();
    expect(shell?.querySelector(".autopost-topbar")).not.toBeNull();
    expect(shell?.querySelector(".autopost-sidebar")).not.toBeNull();
    expect(shell?.querySelector(".autopost-workspace")).not.toBeNull();
    expect(shell?.querySelector(".workspace")).toBeNull();

    const tabs = [
      ["Importa articoli", ".autopost-import-page"],
      ["Coda", ".autopost-queue-page"],
      ["Libreria", ".autopost-library-page"],
      ["Statistiche", ".autopost-stats-page"],
      ["WordPress", ".autopost-settings-page"],
    ] as const;
    for (const [label, selector] of tabs) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(shell?.querySelector(selector)).not.toBeNull();
      const leakedClasses = Array.from(shell?.querySelectorAll<HTMLElement>("[class]") || [])
        .flatMap((element) => Array.from(element.classList))
        .filter((className) => !className.startsWith("autopost-"));
      expect(leakedClasses, `${label} leaked a non-AutoPost class`).toEqual([]);
    }
  });

  it("elimina tutti gli articoli dalla coda dopo la conferma", async () => {
    const clearedState = { ...state, queue: [], schedule: { ...state.schedule, enabled: false }, summary: {} };
    apiMock.clearQueue.mockResolvedValue(clearedState);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<AutoPostApp onHome={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Blog principale")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Coda" }));
    fireEvent.click(screen.getByRole("button", { name: "Elimina tutti" }));

    expect(window.confirm).toHaveBeenCalledOnce();
    await waitFor(() => expect(apiMock.clearQueue).toHaveBeenCalledOnce());
    expect(await screen.findByText("Coda svuotata.")).toBeInTheDocument();
  });

  it("chiede il blog sorgente e associa con l'LLM le categorie del blog destinazione", async () => {
    const sourceBlog = { ...state.blogs[0], categories: [{ id: 7, name: "Sport", slug: "sport", parent: 0, count: 66 }] };
    const secondBlog = { ...state.blogs[0], id: "blog-2", name: "Music TodAI", siteUrl: "https://music.example", categories: [{ id: 2, name: "NEWS MUSIC AI", slug: "news-music-ai", parent: 0, count: 1 }] };
    const multiState = { ...state, blogs: [sourceBlog, secondBlog] };
    apiMock.state.mockResolvedValue(multiState);
    apiMock.refreshBlogCategories.mockResolvedValue(multiState);
    render(<AutoPostApp onHome={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Music TodAI")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Incolla qui il JSON degli articoli"), { target: { value: JSON.stringify({ articles: [{ title: "Suno v6", content: "Musica AI", categories: [7] }] }) } });
    fireEvent.click(screen.getByRole("button", { name: "Analizza JSON" }));
    fireEvent.change(await screen.findByLabelText("Blog sorgente"), { target: { value: "blog-1" } });
    fireEvent.change(screen.getByLabelText("Metodo associazione"), { target: { value: "llm" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Music TodAI" }));

    await waitFor(() => expect(categoryAiMock.map).toHaveBeenCalledWith(expect.objectContaining({ title: "Suno v6", categories: [7] }), expect.objectContaining({ id: "blog-1" }), expect.objectContaining({ id: "blog-2" })));
    expect((await screen.findAllByText("NVIDIA · openai/gpt-oss-20b")).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole<HTMLOptionElement>("option", { name: "NEWS MUSIC AI (#2)" }).selected).toBe(true);
  });

  it("mostra il vero errore del provider quando l'associazione fallisce", async () => {
    const sourceBlog = { ...state.blogs[0], categories: [{ id: 7, name: "Sport", slug: "sport", parent: 0, count: 66 }] };
    const secondBlog = { ...state.blogs[0], id: "blog-2", name: "Music TodAI", siteUrl: "https://music.example", categories: [{ id: 2, name: "NEWS MUSIC AI", slug: "news-music-ai", parent: 0, count: 1 }] };
    const multiState = { ...state, blogs: [sourceBlog, secondBlog] };
    apiMock.state.mockResolvedValue(multiState);
    apiMock.refreshBlogCategories.mockResolvedValue(multiState);
    categoryAiMock.map.mockRejectedValue(new Error("nvidia · openai/gpt-oss-20b: limite richieste raggiunto (HTTP 429)"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<AutoPostApp onHome={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Music TodAI")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Incolla qui il JSON degli articoli"), { target: { value: JSON.stringify({ articles: [{ title: "Suno v6", content: "Musica AI", categories: [7] }] }) } });
    fireEvent.click(screen.getByRole("button", { name: "Analizza JSON" }));
    fireEvent.change(await screen.findByLabelText("Blog sorgente"), { target: { value: "blog-1" } });
    fireEvent.change(screen.getByLabelText("Metodo associazione"), { target: { value: "llm" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Music TodAI" }));

    expect((await screen.findAllByText(/limite richieste raggiunto \(HTTP 429\)/)).length).toBeGreaterThanOrEqual(1);
  });

  it("usa Vector DB locale di default e mostra l'avanzamento animato", async () => {
    const sourceBlog = { ...state.blogs[0], categories: [{ id: 7, name: "Sport", slug: "sport", parent: 0, count: 66 }] };
    const secondBlog = { ...state.blogs[0], id: "blog-2", name: "Music TodAI", siteUrl: "https://music.example", categories: [{ id: 2, name: "NEWS MUSIC AI", slug: "news-music-ai", parent: 0, count: 1 }] };
    const multiState = { ...state, blogs: [sourceBlog, secondBlog] };
    apiMock.state.mockResolvedValue(multiState);
    apiMock.refreshBlogCategories.mockResolvedValue(multiState);
    let finishMapping: ((value: unknown) => void) | undefined;
    categoryVectorMock.map.mockImplementation((_article, _blog, progress: (message: string) => void) => {
      progress("Initial download MiniLM · 42%");
      return new Promise(resolve => { finishMapping = resolve; });
    });
    render(<AutoPostApp onHome={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Music TodAI")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Incolla qui il JSON degli articoli"), { target: { value: JSON.stringify({ articles: [{ title: "Suno v6", content: "Musica AI", categories: [7] }] }) } });
    fireEvent.click(screen.getByRole("button", { name: "Analizza JSON" }));
    fireEvent.change(await screen.findByLabelText("Blog sorgente"), { target: { value: "blog-1" } });
    const threshold = screen.getByLabelText("Soglia coseno") as HTMLInputElement;
    expect(threshold.value).toBe("0.4");
    fireEvent.change(threshold, { target: { value: "0.55" } });
    expect(categoryVectorMock.writeThreshold).toHaveBeenCalledWith(0.55);
    fireEvent.change(screen.getByLabelText("Categorie sopra soglia"), { target: { value: "all" } });
    expect(categoryVectorMock.writeSelectionMode).toHaveBeenCalledWith("all");
    fireEvent.click(screen.getByRole("checkbox", { name: "Music TodAI" }));
    await waitFor(() => expect(categoryVectorMock.map).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.any(Function), 0.55, "all"));

    expect((await screen.findAllByText("Initial download MiniLM · 42%")).length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector(".autopost-association-orbit")).not.toBeNull();
    finishMapping?.({ categoryIds: [2], categoryName: "NEWS MUSIC AI", score: 0.81, fallback: false, bestCategoryName: "NEWS MUSIC AI", threshold: 0.5, ranking: [{ id: 2, name: "NEWS MUSIC AI", score: 0.81, evidence: "Suno v6" }, { id: 3, name: "Tecnologia", score: 0.32 }], model: "paraphrase-multilingual-MiniLM-L12-v2" });
    await waitFor(() => expect(screen.getByText(/Vector DB · coseno 0.81/)).toBeInTheDocument());
    expect(screen.getByText(/selezionata “NEWS MUSIC AI”/)).toBeInTheDocument();
    expect(screen.getByText(/soglia 0.50/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Mostra ranking cosine (2)"));
    expect(screen.getByText(/Passaggio con coseno massimo: “Suno v6”/)).toBeInTheDocument();
    expect(screen.getByText(/NEWS MUSIC AI · coseno 0.81/)).toBeInTheDocument();
    expect(screen.getByText(/Tecnologia · coseno 0.32/)).toBeInTheDocument();
  });

  it("mostra la candidata migliore e il ranking quando il coseno è sotto soglia", async () => {
    const sourceBlog = { ...state.blogs[0], categories: [{ id: 7, name: "Sport", slug: "sport", parent: 0, count: 66 }] };
    const secondBlog = { ...state.blogs[0], id: "blog-2", name: "Music TodAI", siteUrl: "https://music.example", categories: [
      { id: 2, name: "NEWS MUSIC AI", slug: "news-music-ai", parent: 0, count: 1 },
      { id: 3, name: "Tecnologia", slug: "tecnologia", parent: 0, count: 1 },
      { id: 1, name: "Uncategorized", slug: "uncategorized", parent: 0, count: 1 },
    ] };
    const multiState = { ...state, blogs: [sourceBlog, secondBlog] };
    apiMock.state.mockResolvedValue(multiState);
    apiMock.refreshBlogCategories.mockResolvedValue(multiState);
    categoryVectorMock.map.mockResolvedValue({
      categoryIds: [1],
      categoryName: "Uncategorized",
      score: 0.42,
      fallback: true,
      bestCategoryName: "NEWS MUSIC AI",
      threshold: 0.5,
      ranking: [
        { id: 2, name: "NEWS MUSIC AI", score: 0.42, evidence: "Suno v6" },
        { id: 3, name: "Tecnologia", score: 0.39 },
        { id: 1, name: "Uncategorized", score: 0.18 },
      ],
      model: "paraphrase-multilingual-MiniLM-L12-v2",
    });
    render(<AutoPostApp onHome={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Music TodAI")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Incolla qui il JSON degli articoli"), { target: { value: JSON.stringify({ articles: [{ title: "Suno v6", content: "Musica AI", categories: [7] }] }) } });
    fireEvent.click(screen.getByRole("button", { name: "Analizza JSON" }));
    fireEvent.change(await screen.findByLabelText("Blog sorgente"), { target: { value: "blog-1" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Music TodAI" }));

    expect(await screen.findByText(/migliore candidata “NEWS MUSIC AI”/)).toBeInTheDocument();
    expect(screen.getByText(/coseno reale 0.42/)).toBeInTheDocument();
    expect(screen.getByText(/soglia 0.50/)).toBeInTheDocument();
    expect(screen.getByText(/selezionata “Uncategorized”/)).toBeInTheDocument();
    expect(screen.queryByText(/Vector DB · coseno 0.42/)).toBeNull();
    fireEvent.click(screen.getByText("Mostra ranking cosine (3)"));
    expect(screen.getByText(/Passaggio con coseno massimo: “Suno v6”/)).toBeInTheDocument();
    expect(screen.getByText(/NEWS MUSIC AI · coseno 0.42/)).toBeInTheDocument();
    expect(screen.getByText(/Tecnologia · coseno 0.39/)).toBeInTheDocument();
    expect(screen.getByText(/Uncategorized · coseno 0.18/)).toBeInTheDocument();
  });
  it("associa con Vector DB tutti gli articoli mostrando il progresso batch", async () => {
    const sourceBlog = { ...state.blogs[0], categories: [{ id: 7, name: "Sport", slug: "sport", parent: 0, count: 66 }] };
    const secondBlog = { ...state.blogs[0], id: "blog-2", name: "Music TodAI", siteUrl: "https://music.example", categories: [{ id: 2, name: "NEWS MUSIC AI", slug: "news-music-ai", parent: 0, count: 1 }] };
    const multiState = { ...state, blogs: [sourceBlog, secondBlog] };
    apiMock.state.mockResolvedValue(multiState);
    const addedCategory = { id: 9, name: "Nuova categoria", slug: "nuova", parent: 0, count: 0 };
    let targetRefreshes = 0;
    apiMock.refreshBlogCategories.mockImplementation(async (id: string) => {
      if (id === "blog-2") targetRefreshes += 1;
      return targetRefreshes >= 2 ? { ...multiState, blogs: [sourceBlog, { ...secondBlog, categories: [...secondBlog.categories, addedCategory] }] } : multiState;
    });
    categoryVectorMock.map.mockImplementation(async (article: { title: string }, _blog, progress: (message: string) => void) => {
      progress(`Vector DB · analisi semantica di “${article.title}”`);
      return { categoryIds: [2], categoryName: "NEWS MUSIC AI", score: 0.81, fallback: false, bestCategoryName: "NEWS MUSIC AI", threshold: 0.5, ranking: [{ id: 2, name: "NEWS MUSIC AI", score: 0.81 }, { id: 3, name: "Tecnologia", score: 0.32 }], model: "paraphrase-multilingual-MiniLM-L12-v2" };
    });
    render(<AutoPostApp onHome={vi.fn()} />);
    await waitFor(() => expect(screen.getByText("Music TodAI")).toBeInTheDocument());

    const articles = [
      { title: "Suno v6", content: "Musica AI", categories: [7] },
      { title: "Nuovo sintetizzatore", content: "Produzione musicale", categories: [7] },
    ];
    fireEvent.change(screen.getByLabelText("Incolla qui il JSON degli articoli"), { target: { value: JSON.stringify({ articles }) } });
    fireEvent.click(screen.getByRole("button", { name: "Analizza JSON" }));
    fireEvent.change(await screen.findByLabelText("Blog sorgente"), { target: { value: "blog-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Associa tutti · Music TodAI" }));

    await waitFor(() => expect(categoryVectorMock.map).toHaveBeenCalledTimes(2));
    expect(targetRefreshes).toBe(2);
    expect(categoryVectorMock.map.mock.calls[1]?.[1].categories).toContainEqual(addedCategory);
    expect(await screen.findByText("Vector DB locale · 2/2")).toBeInTheDocument();
    expect(screen.getByText("Associazione completata per Music TodAI")).toBeInTheDocument();
  });

  it("non usa categorie vecchie se il refresh WordPress fallisce", async () => {
    const secondBlog = { ...state.blogs[0], id: "blog-2", name: "Music TodAI" };
    const multiState = { ...state, blogs: [state.blogs[0], secondBlog] };
    apiMock.state.mockResolvedValue(multiState);
    apiMock.refreshBlogCategories.mockImplementation(async (id: string) => {
      if (id === "blog-2") throw new Error("Categorie WordPress non raggiungibili");
      return multiState;
    });
    render(<AutoPostApp onHome={vi.fn()} />);
    await screen.findByText("Music TodAI");
    fireEvent.change(screen.getByLabelText("Incolla qui il JSON degli articoli"), { target: { value: JSON.stringify({ articles: [{ title: "Cucina", content: "Ricette", categories: [7] }] }) } });
    fireEvent.click(screen.getByRole("button", { name: "Analizza JSON" }));
    fireEvent.change(await screen.findByLabelText("Blog sorgente"), { target: { value: "blog-1" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Music TodAI" }));
    expect((await screen.findAllByText("Categorie WordPress non raggiungibili")).length).toBeGreaterThan(0);
    expect(categoryVectorMock.map).not.toHaveBeenCalled();
  });
});
