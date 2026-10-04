import { useState } from "react";
import { artworkCrop, initialArtworkSize } from "./artwork-crop";

/** Shared by the sleeve, record label, queue and track information. */
export function TrackArtwork({ src, alt, youtube = false }: { src: string; alt: string; youtube?: boolean }) {
  const [loaded, setLoaded] = useState<{ src: string; width: number; height: number } | null>(null);
  const [width, height] = loaded?.src === src ? [loaded.width, loaded.height] : initialArtworkSize(src);
  const crop = artworkCrop(width!, height!, youtube);
  return <span className={`sav-cover-art${youtube ? " is-cropped" : ""}`}><img src={src} alt={alt} referrerPolicy="no-referrer"
    style={youtube ? { width: `${crop.width}%`, height: `${crop.height}%` } : undefined}
    onLoad={event => { const image = event.currentTarget; setLoaded({ src, width: image.naturalWidth, height: image.naturalHeight }); }} /></span>;
}
