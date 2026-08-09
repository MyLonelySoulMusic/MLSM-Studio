const FACE_GRID = 48;
const FACE_OUTPUT = 192;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Impossibile leggere la fotografia del personaggio."));
    image.src = url;
  });
}

/**
 * Converte localmente una foto frontale in uno sprite quadrato a pixel netti.
 * Il crop privilegia il centro alto, dove si trova normalmente il viso, e la
 * quantizzazione conserva incarnato, capelli e contrasto senza inviare dati.
 */
export async function createPixelArtFace(sourceUrl: string): Promise<string> {
  const image = await loadImage(sourceUrl);
  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = Math.max(0, (image.naturalWidth - sourceSize) / 2);
  const sourceY = Math.max(0, Math.min(image.naturalHeight - sourceSize, (image.naturalHeight - sourceSize) * .28));
  const grid = document.createElement("canvas"); grid.width = FACE_GRID; grid.height = FACE_GRID;
  const gridContext = grid.getContext("2d", { willReadFrequently: true });
  if (!gridContext) throw new Error("Canvas 2D non disponibile.");
  gridContext.imageSmoothingEnabled = true;
  gridContext.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, FACE_GRID, FACE_GRID);
  const pixels = gridContext.getImageData(0, 0, FACE_GRID, FACE_GRID);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const red = pixels.data[index]!; const green = pixels.data[index + 1]!; const blue = pixels.data[index + 2]!;
    const luminance = red * .2126 + green * .7152 + blue * .0722;
    const contrast = 1.12; const quantize = (value: number) => Math.max(0, Math.min(255, Math.round(((value - luminance) * contrast + luminance) / 17) * 17));
    pixels.data[index] = quantize(red); pixels.data[index + 1] = quantize(green); pixels.data[index + 2] = quantize(blue);
  }
  gridContext.putImageData(pixels, 0, 0);
  const output = document.createElement("canvas"); output.width = FACE_OUTPUT; output.height = FACE_OUTPUT;
  const outputContext = output.getContext("2d"); if (!outputContext) throw new Error("Canvas 2D non disponibile.");
  outputContext.imageSmoothingEnabled = false;
  outputContext.drawImage(grid, 0, 0, FACE_OUTPUT, FACE_OUTPUT);
  return output.toDataURL("image/png");
}

