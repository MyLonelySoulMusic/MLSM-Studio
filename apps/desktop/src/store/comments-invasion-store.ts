import { create } from "zustand";

export interface CommentsInvasionAsset {
  id: string;
  key: string;
  name: string;
  relativePath: string;
  url: string;
  width: number;
  height: number;
  file: File;
}

export interface CommentsInvasionImportResult { added: number; rejected: number; }

interface CommentsInvasionRuntimeState {
  assets: CommentsInvasionAsset[];
  importing: boolean;
  error: string | null;
  addFiles: (files: readonly File[]) => Promise<CommentsInvasionImportResult>;
  removeAsset: (id: string) => void;
  clear: () => void;
}

const supportedImage = (file: File): boolean => file.type.startsWith("image/") || /\.(png|jpe?g|webp|avif)$/i.test(file.name);
const naturalOrder = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
let generation = 0;

function assetKey(file: File): string {
  return `${file.webkitRelativePath || file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

function imageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const width = image.naturalWidth || image.width; const height = image.naturalHeight || image.height;
      image.src = "";
      if (width > 0 && height > 0) resolve({ width, height });
      else reject(new Error("dimensioni immagine non valide"));
    };
    image.onerror = () => { image.src = ""; reject(new Error("immagine non leggibile")); };
    image.src = url;
  });
}

async function decodeAssets(files: readonly File[], owner: number): Promise<Array<CommentsInvasionAsset | null>> {
  const results: Array<CommentsInvasionAsset | null> = Array.from({ length: files.length }, () => null);
  let cursor = 0;
  const worker = async () => {
    while (cursor < files.length) {
      const index = cursor; cursor += 1; const file = files[index]!; const url = URL.createObjectURL(file);
      try {
        const dimensions = await imageDimensions(url);
        if (owner !== generation) { URL.revokeObjectURL(url); continue; }
        results[index] = {
          id: globalThis.crypto?.randomUUID?.() ?? `comment-${Date.now()}-${index}`,
          key: assetKey(file), name: file.name, relativePath: file.webkitRelativePath || file.name,
          url, width: dimensions.width, height: dimensions.height, file
        };
      } catch { URL.revokeObjectURL(url); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, files.length) }, worker));
  return results;
}

export const useCommentsInvasionStore = create<CommentsInvasionRuntimeState>((set, get) => ({
  assets: [], importing: false, error: null,
  addFiles: async (input) => {
    if (get().importing) return { added: 0, rejected: 0 };
    const owner = generation;
    const existing = new Set(get().assets.map((asset) => asset.key));
    const supported = input.filter(supportedImage).sort((left, right) => naturalOrder.compare(left.webkitRelativePath || left.name, right.webkitRelativePath || right.name));
    const unique = supported.filter((file) => { const key = assetKey(file); if (existing.has(key)) return false; existing.add(key); return true; });
    const immediatelyRejected = input.length - unique.length;
    if (!unique.length) {
      set({ error: input.length ? "Nessuna nuova immagine PNG, JPEG, WebP o AVIF valida nella selezione." : null });
      return { added: 0, rejected: immediatelyRejected };
    }
    set({ importing: true, error: null });
    const decoded = await decodeAssets(unique, owner);
    const assets = decoded.filter((asset): asset is CommentsInvasionAsset => asset !== null);
    if (owner !== generation) return { added: 0, rejected: input.length };
    set((state) => ({
      assets: [...state.assets, ...assets], importing: false,
      error: assets.length === unique.length ? null : `${unique.length - assets.length} immagini non leggibili sono state ignorate.`
    }));
    return { added: assets.length, rejected: immediatelyRejected + unique.length - assets.length };
  },
  removeAsset: (id) => set((state) => {
    const removed = state.assets.find((asset) => asset.id === id); if (removed) URL.revokeObjectURL(removed.url);
    return { assets: state.assets.filter((asset) => asset.id !== id) };
  }),
  clear: () => resetCommentsInvasionRuntime()
}));

export function resetCommentsInvasionRuntime(): void {
  generation += 1;
  const assets = useCommentsInvasionStore.getState().assets;
  for (const asset of assets) URL.revokeObjectURL(asset.url);
  useCommentsInvasionStore.setState({ assets: [], importing: false, error: null });
}

