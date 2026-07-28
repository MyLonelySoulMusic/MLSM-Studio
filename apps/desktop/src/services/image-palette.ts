function toHex(red: number, green: number, blue: number): string { return `#${[red, green, blue].map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`; }
function distance(a: readonly number[], b: readonly number[]): number { return Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0)); }

export function extractDominantColors(pixels: Uint8ClampedArray, maximumColors = 5): string[] {
  const buckets = new Map<string, { count: number; red: number; green: number; blue: number; score: number }>();
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3] ?? 0; if (alpha < 180) continue;
    const red = pixels[index] ?? 0; const green = pixels[index + 1] ?? 0; const blue = pixels[index + 2] ?? 0; const maximum = Math.max(red, green, blue); const minimum = Math.min(red, green, blue);
    if (maximum < 12 || minimum > 246) continue;
    const key = `${red >> 4}:${green >> 4}:${blue >> 4}`; const saturation = (maximum - minimum) / Math.max(1, maximum); const current = buckets.get(key) ?? { count: 0, red: 0, green: 0, blue: 0, score: 0 };
    current.count += 1; current.red += red; current.green += green; current.blue += blue; current.score += .55 + saturation * .75; buckets.set(key, current);
  }
  const candidates = [...buckets.values()].map((bucket) => ({ color: [bucket.red / bucket.count, bucket.green / bucket.count, bucket.blue / bucket.count] as const, score: bucket.score })).sort((a, b) => b.score - a.score);
  const selected: (readonly number[])[] = [];
  for (const candidate of candidates) { if (selected.every((color) => distance(color, candidate.color) > 58)) selected.push(candidate.color); if (selected.length >= maximumColors) break; }
  return selected.length ? selected.map((color) => toHex(color[0] ?? 0, color[1] ?? 0, color[2] ?? 0)) : ["#63f0d1", "#7657ff"];
}

export function extractPaletteFromImage(source: string, maximumColors = 5): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas"); canvas.width = 80; canvas.height = 80; const context = canvas.getContext("2d", { willReadFrequently: true }); if (!context) throw new Error("Canvas non disponibile");
        const scale = Math.max(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight); const width = image.naturalWidth * scale; const height = image.naturalHeight * scale;
        context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height); resolve(extractDominantColors(context.getImageData(0, 0, canvas.width, canvas.height).data, maximumColors));
      } catch (error) { reject(error); }
    };
    image.onerror = () => reject(new Error("Impossibile analizzare lo sfondo")); image.src = source;
  });
}

export function extractPaletteFromVideo(source: string, maximumColors = 5): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video"); video.muted = true; video.playsInline = true; video.preload = "auto";
    const analyze = () => {
      try {
        const canvas = document.createElement("canvas"); canvas.width = 80; canvas.height = 80; const context = canvas.getContext("2d", { willReadFrequently: true }); if (!context || !video.videoWidth || !video.videoHeight) throw new Error("Fotogramma video non disponibile");
        const scale = Math.max(canvas.width / video.videoWidth, canvas.height / video.videoHeight); const width = video.videoWidth * scale; const height = video.videoHeight * scale;
        context.drawImage(video, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height); resolve(extractDominantColors(context.getImageData(0, 0, canvas.width, canvas.height).data, maximumColors));
      } catch (error) { reject(error); }
    };
    video.onerror = () => reject(new Error("Impossibile analizzare il video di sfondo"));
    video.onloadeddata = () => { if (Number.isFinite(video.duration) && video.duration > .15) { video.onseeked = analyze; video.currentTime = Math.min(.12, video.duration / 3); } else analyze(); };
    video.src = source; video.load();
  });
}
