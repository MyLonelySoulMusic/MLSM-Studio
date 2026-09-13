import { useProjectStore } from "../store/project-store";
import { useCommentsInvasionStore } from "../store/comments-invasion-store";
import { SoundInspectorAccordion } from "./SoundInspectorAccordion";

export function CommentsInvasionInspector() {
  const canvas = useProjectStore((state) => state.project.canvas);
  const settings = useProjectStore((state) => state.project.animation.commentsInvasion);
  const setAspectRatio = useProjectStore((state) => state.setAspectRatio);
  const setCanvasFormat = useProjectStore((state) => state.setCanvasFormat);
  const commentCount = useCommentsInvasionStore((state) => state.assets.length);
  const invasionEnd = commentCount ? settings.initialDelaySeconds + (commentCount - 1) * settings.intervalSeconds : 0;
  return <SoundInspectorAccordion className="inspector comments-invasion-inspector" aria-label="Inspector Comments Invasion">
    <div className="panel-heading"><strong>Comments Invasion</strong><span className="type-badge">Inspector</span></div>
    <section><h2>Materiali</h2><div className="portrait-inspector-card"><div className={settings.videoUrl ? "ready" : "missing"}>{settings.videoUrl ? "✓" : "○"} Video sorgente</div><div className={commentCount ? "ready" : "missing"}>{commentCount ? "✓" : "○"} {commentCount} screenshot</div></div><p className="muted">Gli screenshot restano nella memoria della sessione e vengono rilasciati cambiando progetto o area.</p></section>
    <section><h2>Formato finale</h2><label>Rapporto<select aria-label="Rapporto Comments Invasion" value={canvas.aspectRatio} onChange={(event) => setAspectRatio(event.target.value as typeof canvas.aspectRatio)}><option value="9:16">9:16 verticale</option><option value="16:9">16:9 orizzontale</option><option value="1:1">1:1 quadrato</option><option value="4:5">4:5 social</option><option value="custom">Rapporto originale / personalizzato</option></select></label>{canvas.aspectRatio === "custom" ? <div className="comments-custom-ratio"><label>Larghezza<input aria-label="Larghezza Comments Invasion" type="number" min="64" max="7680" step="2" value={canvas.previewWidth} onChange={(event) => setCanvasFormat({ aspectRatio: "custom", width: Number(event.target.value), height: canvas.previewHeight })} /></label><label>Altezza<input aria-label="Altezza Comments Invasion" type="number" min="64" max="7680" step="2" value={canvas.previewHeight} onChange={(event) => setCanvasFormat({ aspectRatio: "custom", width: canvas.previewWidth, height: Number(event.target.value) })} /></label></div> : null}</section>
    <section><h2>Sequenza</h2><div className="portrait-inspector-card export"><span>{settings.maxVisible} commenti simultanei · permanenza {settings.holdDurationSeconds.toFixed(2)} s</span><small>{commentCount ? `L’ultimo dei ${commentCount} commenti entra a ${invasionEnd.toFixed(2)} s, poi esce con ${settings.exitAnimation}.` : "Carica una cartella per calcolare la sequenza."}</small></div><p className="muted">In export gli screenshot vengono decodificati con una cache limitata ai soli commenti visibili.</p></section>
  </SoundInspectorAccordion>;
}
