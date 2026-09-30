import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPostIt, createPostItFlow, faviconUrlForLink, loadPostItWorkspace, rankPostItFlows, rankPostIts, resetPostItWorkspaceForTests, savePostItWorkspace } from "./postit-store";

describe("Post-it local vector workspace", () => {
  beforeEach(() => { vi.stubGlobal("indexedDB", new IDBFactory()); resetPostItWorkspaceForTests(); });
  afterEach(() => vi.unstubAllGlobals());

  it("salva post-it e flussi in IndexedDB e genera una favicon locale", async () => {
    const music = createPostIt({ title: "Suno", link: "suno.com", text: "Strumento per creare una canzone" }, 10);
    const release = createPostIt({ title: "Release", text: "Pubblicazione del nuovo brano" }, 20);
    const flow = createPostItFlow({ title: "Lancio singolo", description: "Dalla creazione alla pubblicazione", postItIds: [music.id, release.id] }, [music, release], 30);
    await savePostItWorkspace({ postIts: [music, release], flows: [flow] });
    resetPostItWorkspaceForTests();
    const loaded = await loadPostItWorkspace();
    expect(loaded.postIts.map((item) => item.title)).toEqual(["Suno", "Release"]);
    expect(loaded.flows[0]?.postItIds).toEqual([music.id, release.id]);
    expect(loaded.postIts[0]?.faviconUrl).toMatch(/^data:image\/svg\+xml/);
    expect(faviconUrlForLink("https://example.com/page")).not.toContain("example.com/favicon");
  });

  it("riordina note e flussi nello stesso spazio semantico locale", () => {
    const music = createPostIt({ title: "Produzione", text: "Creare una canzone e lavorare sulla musica" }, 10);
    const photo = createPostIt({ title: "Copertina", text: "Ritratto fotografico in bianco e nero" }, 20);
    const release = createPostIt({ title: "Distribuzione", text: "Pubblicare il nuovo brano" }, 30);
    const musicFlow = createPostItFlow({ title: "Uscita musicale", description: "Preparazione del singolo", postItIds: [music.id, release.id] }, [music, photo, release], 40);
    const photoFlow = createPostItFlow({ title: "Servizio fotografico", description: "Selezione delle immagini", postItIds: [photo.id, release.id] }, [music, photo, release], 50);
    expect(rankPostIts([photo, music], "musica e canzone")[0]?.item.id).toBe(music.id);
    expect(rankPostItFlows([photoFlow, musicFlow], [music, photo, release], "produzione musica")[0]?.item.id).toBe(musicFlow.id);
  });
});
