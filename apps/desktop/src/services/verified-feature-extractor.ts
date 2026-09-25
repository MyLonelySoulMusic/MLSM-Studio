import type { LocalFeatureExtractor, LocalFeatureTensor } from "./local-model-runtime";

export const embeddingProbes = [
  "La musica e le canzoni del cantante.",
  "Il musicista canta una canzone.",
  "La ricetta della zuppa di verdure in cucina.",
];

export function featureRows(tensor: LocalFeatureTensor, expectedRows: number): number[][] {
  const rows = tensor.tolist();
  const width = tensor.dims[1];
  if (tensor.dims.length !== 2 || tensor.dims[0] !== expectedRows || !width || !Array.isArray(rows) || rows.length !== expectedRows) {
    throw new Error("Embedding non valido: dimensioni inattese.");
  }
  return rows.map((row: unknown) => {
    if (!Array.isArray(row) || row.length !== width || row.some(v => typeof v !== "number" || !Number.isFinite(v))) {
      throw new Error("Embedding non valido: componenti non numeriche.");
    }
    const norm = Math.hypot(...row as number[]);
    if (!Number.isFinite(norm) || norm < 1e-8) throw new Error("Embedding non valido: vettore nullo.");
    return (row as number[]).map(v => v / norm);
  });
}

const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);

async function verify(extractor: LocalFeatureExtractor): Promise<void> {
  const options = { pooling: "mean", normalize: true } as const;
  const [music, related, cooking] = featureRows(await extractor(embeddingProbes, options), 3);
  const [single] = featureRows(await extractor([embeddingProbes[0]!], options), 1);
  if (!music || !related || !cooking || !single) throw new Error("Embedding di controllo mancanti.");
  const similarity = dot(music, related);
  const unrelated = Math.max(dot(music, cooking), dot(related, cooking));
  const consistency = dot(music, single);
  console.info("[AutoPost embeddings] Verifica semantica", { similarity, unrelated, consistency });
  // Reject collapsed outputs, and batch-dependent embeddings. These broad
  // checks validate the engine, independently of the category threshold.
  if (similarity < 0.45 || unrelated > 0.8 || similarity - unrelated < 0.2 || consistency < 0.95) {
    throw new Error("Il motore embedding non distingue correttamente i testi di controllo.");
  }
}

export async function verifiedFeatureExtractor(
  create: (device: "webgpu" | "wasm") => Promise<LocalFeatureExtractor>,
  preferGpu: boolean,
  repository: string,
  progress: (message: string) => void,
): Promise<LocalFeatureExtractor> {
  const devices = preferGpu ? ["webgpu", "wasm"] as const : ["wasm"] as const;
  for (const device of devices) {
    let extractor: LocalFeatureExtractor | undefined;
    try {
      progress(`Verifica embedding locali · ${device}…`);
      extractor = await create(device);
      await verify(extractor);
      extractor.embeddingSpace = `${repository}:q8:mean:${device}:verified-v1`;
      console.info("[AutoPost embeddings] Motore verificato", { device, embeddingSpace: extractor.embeddingSpace });
      return extractor;
    } catch (error) {
      await extractor?.dispose?.().catch(() => undefined);
      console.warn("[AutoPost embeddings] Motore scartato", { device, error });
      if (device === "wasm") throw new Error("Verifica del modello locale fallita. Associazione interrotta per evitare categorie errate.", { cause: error });
      progress("Verifica embedding non riuscita · nuovo tentativo con WASM…");
    }
  }
  throw new Error("Nessun motore embedding verificato disponibile.");
}
