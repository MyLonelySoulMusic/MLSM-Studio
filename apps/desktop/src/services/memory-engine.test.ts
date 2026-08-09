import { describe, expect, it } from "vitest";
import { DeterministicMemoryEmbedder, cosineSimilarity } from "./memory-embedding";
import { MemoryEngine, inferMemoryAssetKind, normalizeMemoryPath } from "./memory-engine";
import { createMemoryRepository, InMemoryMemoryRepository } from "./memory-repository";

const fixedNow = () => new Date("2026-08-09T12:00:00.000Z");

describe("Memory semantic engine", () => {
  it("crea vettori deterministici e avvicina sinonimi italiani e inglesi", () => {
    const embedder = new DeterministicMemoryEmbedder(128);
    expect(embedder.embed("foto notturna rosa")).toEqual(embedder.embed("foto notturna rosa"));
    expect(cosineSimilarity(embedder.embed("foto notturna rosa"), embedder.embed("pink night photo"))).toBeGreaterThan(cosineSimilarity(embedder.embed("foto notturna rosa"), embedder.embed("audio drums kick")));
  });

  it("catalogha file, deduce il tipo e crea la cartella come categoria", async () => {
    const repository = new InMemoryMemoryRepository(); const engine = new MemoryEngine({ repository, now: fixedNow });
    const record = await engine.upsertRecord({ path: "/Music/Covers/empty-streets.png", description: "Copertina rosa, pioggia e strada di notte", tags: ["Suno", "cover"] });
    expect(record.kind).toBe("image"); expect(record.name).toBe("empty-streets.png"); expect(record.embedding).toHaveLength(384);
    const categories = await engine.listCategories();
    expect(categories).toEqual([expect.objectContaining({ name: "Covers", kind: "folder", path: "/Music/Covers" })]);
    expect(record.categoryIds).toContain(categories[0]?.id);
  });

  it("ordina la ricerca semantica e applica filtri di tipo e categoria", async () => {
    const engine = new MemoryEngine({ repository: new InMemoryMemoryRepository(), now: fixedNow });
    const favorites = await engine.createCategory({ name: "Preferiti", color: "#ec4899" });
    await engine.upsertRecord({ path: "/media/night-cover.jpg", description: "Fotografia urbana rosa scattata di notte", categoryIds: [favorites.id] });
    await engine.upsertRecord({ path: "/media/drums.wav", description: "Registrazione audio della batteria" });
    await engine.upsertRecord({ path: "/media/city.mov", description: "Video della città durante il giorno" });
    const results = await engine.search("pink night photo");
    expect(results[0]?.record.name).toBe("night-cover.jpg"); expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
    const filtered = await engine.search("notte", { kinds: ["image"], categoryIds: [favorites.id] });
    expect(filtered.map((result) => result.record.name)).toEqual(["night-cover.jpg"]);
  });

  it("aggiorna lo stesso percorso senza duplicarlo e conserva la data di creazione", async () => {
    let date = new Date("2026-01-01T00:00:00.000Z"); const engine = new MemoryEngine({ repository: new InMemoryMemoryRepository(), now: () => date });
    const first = await engine.upsertRecord({ path: "/files/note.txt", description: "Prima descrizione" }); date = new Date("2026-02-01T00:00:00.000Z");
    const second = await engine.upsertRecord({ path: "/files/note.txt", description: "Descrizione aggiornata" });
    expect(await engine.listRecords()).toHaveLength(1); expect(second.id).toBe(first.id); expect(second.createdAt).toBe(first.createdAt); expect(second.updatedAt).not.toBe(first.updatedAt);
  });

  it("indicizza selezioni grandi in batch e comunica un avanzamento monotono", async () => {
    const engine = new MemoryEngine({ repository: new InMemoryMemoryRepository(), now: fixedNow }); const progress: number[] = [];
    const records = await engine.upsertRecords(Array.from({ length: 260 }, (_, index) => ({ path: `/batch/item-${index}.txt`, description: `Nota ${index}` })), (completed) => progress.push(completed));
    expect(records).toHaveLength(260); expect(await engine.listRecords()).toHaveLength(260);
    expect(progress).toHaveLength(260); expect(progress[0]).toBe(1); expect(progress.at(-1)).toBe(260);
  });

  it("costruisce un grafo navigabile con categorie, cartelle e affinità semantiche", async () => {
    const engine = new MemoryEngine({ repository: new InMemoryMemoryRepository(), now: fixedNow });
    const project = await engine.createCategory({ name: "Empty Streets", description: "Materiali del singolo" });
    const first = await engine.upsertRecord({ path: "/project/cover.jpg", description: "Foto rosa di una strada notturna", categoryIds: [project.id] });
    const second = await engine.upsertRecord({ path: "/project/poster.png", description: "Immagine rosa della strada di notte", categoryIds: [project.id] });
    const graph = await engine.graph({ similarityThreshold: .1 });
    expect(graph.nodes.find((node) => node.id === `record:${first.id}`)?.details.path).toBe("/project/cover.jpg");
    expect(graph.edges).toContainEqual(expect.objectContaining({ source: `record:${first.id}`, target: `category:${project.id}`, kind: "category" }));
    expect(graph.edges.some((edge) => edge.kind === "semantic" && [edge.source, edge.target].includes(`record:${second.id}`))).toBe(true);
  });

  it("usa automaticamente il fallback in memoria quando IndexedDB non è disponibile", async () => {
    const repository = createMemoryRepository({ forceMemory: true });
    expect(repository).toBeInstanceOf(InMemoryMemoryRepository);
    const engine = new MemoryEngine({ repository, now: fixedNow }); await engine.upsertRecord({ path: "C:\\Media\\song.flac", description: "Brano" });
    expect((await engine.listRecords())[0]).toMatchObject({ path: "C:/Media/song.flac", kind: "audio" });
  });

  it("normalizza percorsi e riconosce i formati principali", () => {
    expect(normalizeMemoryPath("/media//covers/")) .toBe("/media/covers");
    expect(normalizeMemoryPath("browser://Album//cover.png")).toBe("browser://Album/cover.png");
    expect(inferMemoryAssetKind("clip.MOV")).toBe("video"); expect(inferMemoryAssetKind("unknown.bin", "audio/wav")).toBe("audio");
  });
});
