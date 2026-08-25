import { type ChangeEvent } from "react";
import { extractPaletteFromImage } from "../services/image-palette";
import { useProjectStore } from "../store/project-store";

function dataUrl(file: File): Promise<string> { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Immagine non leggibile.")); reader.onerror = () => reject(reader.error ?? new Error("Immagine non leggibile.")); reader.readAsDataURL(file); }); }
export function CassetteDeskPanel({ onImportAudio }: { onImportAudio: () => void }) {
  const settings = useProjectStore((state) => state.project.animation.cassetteDesk); const update = useProjectStore((state) => state.updateCassetteDesk); const applyPalette = useProjectStore((state) => state.applyCassetteDeskExtractedPalette);
  const loadCover = async (event: ChangeEvent<HTMLInputElement>) => { const file=event.target.files?.[0]; event.target.value=""; if(!file)return; const url=await dataUrl(file); update({coverImageUrl:url}); const colors=await extractPaletteFromImage(url).catch(()=>[]); if(colors.length) applyPalette(colors); };
  return <section className="cassette-desk-panel">
    <h2>Cassette Desk</h2><p className="muted">Carica un brano intero. L’intro dura {settings.introDurationSeconds.toFixed(1)} s: inserimento, sportello e PLAY vengono prima della musica anche nell’export.</p>
    <button type="button" onClick={onImportAudio}>Carica brano intero</button>
    <label className="flyer-upload">Carica immagine 3:4<input aria-label="Carica immagine Cassette Desk" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event)=>void loadCover(event)}/></label>
    {settings.coverImageUrl?<div className="cassette-cover-preview" style={{backgroundImage:`url(${settings.coverImageUrl})`}}/>:null}
    <h2>Informazioni brano</h2><label>Titolo<input value={settings.title} maxLength={160} onChange={(event)=>update({title:event.target.value})}/></label><label>Artista<input value={settings.artist} maxLength={160} onChange={(event)=>update({artist:event.target.value})}/></label>
    <h2>Palette</h2><label className="teddy-dance-toggle"><span>Automatica dall’immagine</span><input type="checkbox" checked={settings.autoPalette} onChange={(event)=>update({autoPalette:event.target.checked})}/></label>
    <div className="teddy-palette">{settings.palette.map((color,index)=><label key={index}>Colore {index+1}<input type="color" value={color} onChange={(event)=>{const palette=[...settings.palette] as [string,string,string];palette[index]=event.target.value;update({palette,autoPalette:false});}}/></label>)}</div>
    <h2>Analisi voce reale</h2><label>Tolleranza alla tonalità: {settings.vocalToleranceCents} cent<input type="range" min="10" max="100" step="1" value={settings.vocalToleranceCents} onChange={(event)=>update({vocalToleranceCents:Number(event.target.value)})}/></label><p className="muted">Demucs htdemucs separa realmente lo stem vocale dal brano; pYIN rileva le altezze solo su quello stem. Runtime e modello vengono installati automaticamente al primo utilizzo e poi riusati dalla cache locale. Se la separazione fallisce, il pianoforte resta vuoto: non vengono usate note del mix.</p><button type="button" onClick={()=>window.dispatchEvent(new Event("cassette-desk:retry-vocals"))}>Riprova preparazione automatica</button>
  </section>;
}
