import { useProjectStore } from "../store/project-store";

const layerLabels = { sideImage: "Immagini laterali", cube: "Cubo 3D", centerVideo: "Video 9:16", spectrum: "Spettro 48 bande", rain: "Pioggia", lightning: "Fulmini", feathers: "Piume", particles: "Particelle" } as const;

export function PortraitLandscapeInspector() {
  const settings = useProjectStore((state) => state.project.animation.portraitLandscape);
  const assets = [
    ["Video verticale", Boolean(settings.videoUrl)],
    ["Immagine laterale", Boolean(settings.sideImageUrl)],
    ["Cover del cubo", Boolean(settings.coverImageUrl)]
  ] as const;
  const activeEffects = (Object.keys(settings.effects) as (keyof typeof settings.effects)[]).filter((key) => settings.effects[key]);
  const fixed = new Set(["sideImage", "cube", "centerVideo", "spectrum"]);
  const visibleStack = [...settings.layerOrder].reverse().filter((key) => fixed.has(key) || settings.effects[key as keyof typeof settings.effects]);
  return <aside className="inspector portrait-landscape-inspector">
    <h2>Composizione 16:9</h2>
    <div className="portrait-inspector-card"><strong>Pila livelli · alto → basso</strong><ol>{visibleStack.map((key) => <li key={key}>{layerLabels[key]}</li>)}</ol><small>Attiva gli effetti a sinistra e spostali sopra o sotto direttamente nelle tracce della timeline.</small></div>
    <h3>Materiali richiesti</h3>
    <div className="portrait-asset-checklist">{assets.map(([label, ready]) => <div key={label} className={ready ? "ready" : "missing"}><span>{ready ? "✓" : "○"}</span><strong>{label}</strong></div>)}</div>
    <h3>Effetti attivi</h3>
    {activeEffects.length ? <div className="portrait-layer-summary">{activeEffects.map((key) => <div key={key}><span>{layerLabels[key]}</span><small>Opacità {Math.round(settings.effectOpacity[key] * 100)}%</small></div>)}</div> : <p className="muted">Nessun effetto attivo.</p>}
    <div className="portrait-inspector-card export"><strong>Preset raccomandato</strong><span>3840 × 2160 · 4K (16:9)</span><small>Per un centro 1080 × 1920 conserva quasi tutto il dettaglio verticale senza inventare una risoluzione sproporzionata. Export offline disponibile fino a 120 fps.</small></div>
  </aside>;
}
