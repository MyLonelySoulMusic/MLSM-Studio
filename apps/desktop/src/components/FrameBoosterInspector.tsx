import { type ReactElement } from "react";
import { useProjectStore } from "../store/project-store";

export function FrameBoosterInspector(): ReactElement {
  const settings = useProjectStore((state) => state.project.animation.frameBooster);
  return <aside className="frame-booster-inspector"><h2>Inspector</h2><dl><dt>Sorgente</dt><dd>{settings.sourceName || "Nessun video"}</dd><dt>Ingresso</dt><dd>{settings.sourceFps ? `${settings.sourceFps.toFixed(3)} fps` : "Rilevamento server"}</dd><dt>Target</dt><dd>{settings.targetMode === "multiplier" ? `${settings.targetMultiplier}×` : `${settings.targetFps} fps`}</dd><dt>Dimensioni</dt><dd>{settings.sourceWidth && settings.sourceHeight ? `${settings.sourceWidth} × ${settings.sourceHeight}` : "—"}</dd><dt>Audio</dt><dd>{settings.sourceHasAudio ? "Presente" : "Da verificare"}</dd><dt>Backend</dt><dd>{settings.lastOutput?.backend ?? "—"}</dd></dl>{settings.lastOutput ? <p className="muted">Ultimo output: {settings.lastOutput.fps.toFixed(2)} fps · {settings.lastOutput.frameCount} frame.</p> : <p className="muted">Il file finale verrà accettato solo dopo l’audit di FPS, durata, DAR, dimensioni e audio.</p>}</aside>;
}
