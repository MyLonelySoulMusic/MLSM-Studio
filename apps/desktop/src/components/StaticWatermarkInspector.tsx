import { watermarkPixelRect } from "../services/static-watermark-renderer";
import { useProjectStore } from "../store/project-store";

export function StaticWatermarkInspector() {
  const name = useProjectStore((state) => state.project.project.name);
  const settings = useProjectStore((state) => state.project.animation.staticWatermark);
  const rename = useProjectStore((state) => state.renameProject);
  const rect = watermarkPixelRect(settings.videoWidth || 1, settings.videoHeight || 1, settings);
  return <aside className="panel inspector static-watermark-inspector" aria-label="Inspector Static Watermark Remover">
    <h2>Progetto</h2><label>Nome<input value={name} onChange={(event) => rename(event.target.value)} /></label>
    <h2>Sorgenti</h2>
    <div className="property"><span>Video</span><output>{settings.videoName || "Non caricato"}</output></div>
    <div className="property"><span>Risoluzione</span><output>{settings.videoWidth && settings.videoHeight ? `${settings.videoWidth} × ${settings.videoHeight}` : "—"}</output></div>
    <div className="property"><span>Riferimento</span><output>{settings.referenceKind === "video" ? settings.referenceVideoName || "Non caricato" : settings.referenceImageName || "Non caricato"}</output></div>
    <div className="property"><span>Tipo</span><output>{settings.referenceKind === "video" ? "Video pulito" : "Fotografia"}</output></div>
    {settings.referenceKind === "video" ? <><div className="property"><span>Offset</span><output>{settings.referenceTimeOffsetSeconds >= 0 ? "+" : ""}{settings.referenceTimeOffsetSeconds.toFixed(3)} s</output></div><div className="property"><span>Confidenza</span><output>{settings.alignmentConfidence ? `${Math.round(settings.alignmentConfidence * 100)}%` : "Da analizzare"}</output></div></> : null}
    {settings.referenceKind === "video" && settings.sourceFrameRate > 0 ? <div className="property"><span>Base FPS</span><output>{settings.frameRateBasis === "reference" ? `Pulito · ${settings.referenceFrameRate.toFixed(2)}` : settings.frameRateBasis === "source" ? `Watermark · ${settings.sourceFrameRate.toFixed(2)}` : "Da scegliere"}</output></div> : null}
    <h2>Area selezionata</h2>
    <div className="watermark-pixel-readout"><strong>{rect.width} × {rect.height} px</strong><span>X {rect.x} · Y {rect.y}</span></div>
    <h2>Export</h2>
    <div className="export-integrity-card"><strong>Frame-accurate</strong><span>Ogni frame sorgente viene decodificato, corretto e ricodificato offline. Il file viene consegnato soltanto se il controllo finale non rileva frame mancanti.</span></div>
    {settings.referenceKind === "video" ? <div className="export-integrity-card"><strong>Controllo anti-anomalia</strong><span>Sincronizzazione, copertura temporale e stabilità spaziale vengono verificate prima e durante l’export. Un riferimento non affidabile interrompe il processo senza consegnare un file difettoso.</span></div> : null}
    <div className="export-integrity-card"><strong>Audio silenzioso durante l’export</strong><span>La traccia viene processata internamente e non viene riprodotta dagli altoparlanti.</span></div>
  </aside>;
}
