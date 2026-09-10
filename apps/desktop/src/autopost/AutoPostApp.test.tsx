import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoPostApp } from "./AutoPostApp";

const apiMock = vi.hoisted(() => ({ state: vi.fn(), clearQueue: vi.fn() }));
vi.mock("./api", () => ({ api: apiMock }));

const state = {
  blogs: [{ id: "blog-1", name: "Blog principale", siteUrl: "https://example.com", username: "author", defaultStatus: "publish", hasPassword: true, categories: [{ id: 7, name: "Musica", slug: "musica", parent: 0, count: 2 }], categoriesSyncedAt: "2026-09-10T00:00:00Z" }],
  schedule: { enabled: true, intervalMinutes: 15, postsPerRun: 1, nextRunAt: null },
  queue: [{ id: "post-1", article: { title: "Articolo migrato", content: "<p>Testo</p>", excerpt: "", slug: "articolo", categories: [7], tags: [], media: [] }, blogIds: ["blog-1"], categoriesByBlog: { "blog-1": [7] }, blogResults: { "blog-1": { status: "published", wordpressId: 8 } }, status: "published", createdAt: "2026-09-10T00:00:00Z", attempts: 1, lastError: "" }],
  stats: { song: { provider: "spotify", kind: "track", id: "track", canonicalUrl: "https://open.spotify.com/track/testtest", title: "Brano migrato", publishCount: 4, firstPublishedAt: "2026-09-01T00:00:00Z", lastPublishedAt: "2026-09-10T00:00:00Z" } },
  library: { items: [{ provider: "youtube", kind: "track", id: "videoid", canonicalUrl: "https://youtu.be/videoid", title: "Video migrato", priority: 50, createdAt: "2026-09-01T00:00:00Z" }], tracksPerPost: 2, playlistEveryTracks: 10, tracksSincePlaylist: 1 },
  history: [], summary: { published: 1 }, dataDirectory: "/Users/test/.mlsm-autopost",
} as const;

describe("AutoPost integrato", () => {
  beforeEach(() => { localStorage.clear(); apiMock.state.mockResolvedValue(state); });
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
});
