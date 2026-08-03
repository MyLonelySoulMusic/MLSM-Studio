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
    <div className="property"><span>Riferimento</span><output>{settings.referenceImageName || "Non caricato"}</output></div>
    <h2>Area selezionata</h2>
    <div className="watermark-pixel-readout"><strong>{rect.width} × {rect.height} px</strong><span>X {rect.x} · Y {rect.y}</span></div>
    <h2>Export</h2>
    <div className="export-integrity-card"><strong>Frame-accurate</strong><span>Ogni frame sorgente viene decodificato, corretto e ricodificato offline. Il file viene consegnato soltanto se il controllo finale non rileva frame mancanti.</span></div>
    <div className="export-integrity-card"><strong>Audio silenzioso durante l’export</strong><span>La traccia viene processata internamente e non viene riprodotta dagli altoparlanti.</span></div>
  </aside>;
}
