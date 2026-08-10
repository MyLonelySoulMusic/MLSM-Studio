import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { scanLocalMemoryPaths } from "./vite-memory-service";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("servizio filesystem locale Memory", () => {
  it("restituisce percorsi assoluti reali e metadati usabili per preview e copia", async () => {
    const root = await mkdtemp(join(tmpdir(), "mlsm-memory-test-")); temporaryDirectories.push(root);
    const album = join(root, "Album"); const cover = join(album, "cover.png");
    await mkdir(album); await writeFile(cover, Buffer.from("png"));
    const realAlbum = await realpath(album); const realCover = await realpath(cover);
    const result = await scanLocalMemoryPaths([album], 100);
    expect(result.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: realAlbum, entryType: "folder", mediaKind: "folder" }),
      expect.objectContaining({ path: realCover, parentPath: realAlbum, name: "cover.png", entryType: "file", mediaKind: "image", mimeType: "image/png", previewSupported: true })
    ]));
    expect(result.entries.every((entry) => String(entry.path).startsWith("/"))).toBe(true);
  });

  it("non inserisce elementi nascosti e segnala il limite senza creare percorsi virtuali", async () => {
    const root = await mkdtemp(join(tmpdir(), "mlsm-memory-test-")); temporaryDirectories.push(root);
    await writeFile(join(root, ".secret.txt"), "secret"); await writeFile(join(root, "visible.txt"), "visible"); await writeFile(join(root, "second.txt"), "second");
    const result = await scanLocalMemoryPaths([root], 2);
    expect(result.entries.some((entry) => String(entry.path).startsWith("browser://"))).toBe(false);
    expect(result.entries.some((entry) => entry.name === ".secret.txt")).toBe(false);
    expect(result.truncated).toBe(true);
  });
});
