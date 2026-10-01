import { DiscordLink } from "./DiscordLink";
import { SettingsButton } from "./StudioSettings";
import { cloneElement, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { animationCategories, getAnimationMode, type AnimationCategoryId } from "../services/animation-modes";
import { uiCopy, useUiPreferences } from "../services/ui-preferences";
import { useProjectStore } from "../store/project-store";
import { AreaIcon } from "./StudioIcons";
import { AreaArtwork } from "./AreaArtwork";
import { SupportArtistButton } from "./ArtistSupport";
import { MemoryButton } from "./MemoryStudio";
import { resetWorkspaceForAreaEntry } from "../services/workspace-area-lifecycle";
import { areaActivityCounts, readTaskHistory, TASK_HISTORY_EVENT, type StudioTaskArea } from "../services/task-history";

const areaCopyKeys = {
  soundAnimation: { label: "soundAnimation", description: "soundDescription" },
  photoVideoStudio: { label: "photoVideoStudio", description: "photoVideoDescription" },
  videoEditor: { label: "videoEditor", description: "videoEditorDescription" },
  music: { label: "music", description: "musicDescription" },
  lipsync: { label: "lipsync", description: "lipsyncDescription" },
  audio: { label: "audio", description: "audioDescription" }
} as const;

export type StudioAreaDestination = AnimationCategoryId | "autopost" | "stickman" | "reports" | "postit" | "streamer" | "documentation";

export function StudioHome({ onEnterArea }: { onEnterArea: (category: StudioAreaDestination) => void }) {
  const { language, theme, setLanguage, setTheme } = useUiPreferences(); const copy = uiCopy[language]; const setAnimationMode = useProjectStore((state) => state.setAnimationMode);
  const [sortByUsage, setSortByUsage] = useState(false);
  const [tasks, setTasks] = useState(readTaskHistory);
  const counts = areaActivityCounts(tasks);
  const grid = useRef<HTMLElement>(null);
  const previousPositions = useRef(new Map<string, DOMRect>());
  const movements = useRef<Animation[]>([]);
  const capturePositions = useCallback(() => {
    previousPositions.current = new Map(Array.from(grid.current?.querySelectorAll<HTMLElement>(".studio-area-card") ?? [], card => [card.dataset.areaId!, card.getBoundingClientRect()]));
  }, []);
  useEffect(() => {
    const refresh = () => { capturePositions(); setTasks(readTaskHistory()); };
    window.addEventListener(TASK_HISTORY_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => { window.removeEventListener(TASK_HISTORY_EVENT, refresh); window.removeEventListener("storage", refresh); movements.current.forEach(animation => animation.cancel()); };
  }, [capturePositions]);
  useLayoutEffect(() => {
    movements.current.forEach(animation => animation.cancel());
    movements.current = [];
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { previousPositions.current.clear(); return; }
    grid.current?.querySelectorAll<HTMLElement>(".studio-area-card").forEach((card, index) => {
      const before = previousPositions.current.get(card.dataset.areaId!);
      if (!before || !card.animate) return;
      const after = card.getBoundingClientRect();
      const dx = before.left - after.left, dy = before.top - after.top;
      if (Math.abs(dx) + Math.abs(dy) < 1) return;
      movements.current.push(card.animate([
        { translate: `${dx}px ${dy}px`, scale: ".985", zIndex: "2" },
        { translate: `${-dx * .015}px ${-dy * .015}px`, scale: "1.008", offset: .82, zIndex: "2" },
        { translate: "0px 0px", scale: "1", zIndex: "2" },
      ], { duration: 720, delay: Math.min(index * 18, 126), easing: "cubic-bezier(.16,1,.3,1)", fill: "backwards" }));
    });
    previousPositions.current.clear();
  }, [sortByUsage, tasks]);
  const enter = (categoryId: StudioAreaDestination) => {
    resetWorkspaceForAreaEntry();
    if (categoryId === "autopost" || categoryId === "stickman" || categoryId === "reports" || categoryId === "postit" || categoryId === "streamer" || categoryId === "documentation") { onEnterArea(categoryId); return; }
    const category = animationCategories.find((item) => item.id === categoryId) ?? animationCategories[0]!;
    const firstMode = getAnimationMode(category.groups[0]!.modeIds[0]!);
    setAnimationMode(firstMode.id, [...firstMode.defaultBaseObjectTypes]); onEnterArea(category.id);
  };
  return <div className="studio-home" data-ui-copy>
    <div className="studio-home__atmosphere" aria-hidden="true"><i /><i /><i /><i /></div>
    <header className="studio-home__topbar">
      <div className="brand" aria-label="MLSM Studio — My Lonely Soul Music Studio"><img className="brand-mark" src="/mlsm-studio-favicon-192.png" alt="" /><span className="brand-copy"><strong>MLSM Studio</strong><small>My Lonely Soul Music</small></span></div>
      <div className="studio-home__preferences"><DiscordLink /><SettingsButton /><MemoryButton /><SupportArtistButton /><label><span>{copy.language}</span><select aria-label={copy.language} value={language} onChange={(event) => setLanguage(event.target.value === "en" ? "en" : "it")}><option value="it">IT</option><option value="en">EN</option></select></label><button className="theme-toggle" aria-label={`${copy.appearance}: ${theme === "day" ? copy.day : copy.night}`} onClick={() => setTheme(theme === "day" ? "night" : "day")}><span aria-hidden="true">{theme === "day" ? "☼" : "◐"}</span>{theme === "day" ? copy.day : copy.night}</button></div>
    </header>
    <main className="studio-home__main">
      <div className="studio-home__intro"><span>{copy.workspaceEyebrow}</span><h1>{copy.chooseArea}</h1><p>{copy.chooseAreaDescription}</p></div>
      <div className="studio-home__area-controls">
        <button type="button" className="studio-home__usage-sort" aria-pressed={sortByUsage} title={language === "it" ? "Ordina per numero di operazioni registrate in Impostazioni → Attività" : "Sort by the number of operations recorded in Settings → Activity"} onClick={() => { capturePositions(); setSortByUsage(value => !value); }}>
          <span aria-hidden="true">{sortByUsage ? "↶" : "↓"}</span>{sortByUsage ? (language === "it" ? "Torna all’ordine classico" : "Restore default order") : (language === "it" ? "Ordina per utilizzo" : "Sort by usage")}
        </button>
        <span role="status">{sortByUsage ? (language === "it" ? "Più utilizzate prima · dati da Attività" : "Most used first · Activity data") : (language === "it" ? "Ordine classico" : "Default order")}</span>
      </div>
      <section ref={grid} className="studio-area-grid" aria-label={copy.availableAreas}>
        {[
        ...animationCategories.map((category, index) => {
          const keys = areaCopyKeys[category.id]; const modeCount = category.groups.reduce((total, group) => total + group.modeIds.length, 0);
          return <button key={category.id} className={`studio-area-card area-${category.id}`} style={{ "--area-index": index } as CSSProperties} type="button" onClick={() => enter(category.id)}>
            <span className="studio-area-card__number">0{index + 1}</span><span className="studio-area-card__icon"><AreaIcon category={category.id} /></span>
            <span className="studio-area-card__art" aria-hidden="true"><AreaArtwork category={category.id} /></span>
            <span className="studio-area-card__copy"><small>{modeCount} {modeCount === 1 ? copy.creativeMode : copy.creativeModes}</small><strong>{copy[keys.label]}</strong><em>{copy[keys.description]}</em></span>
            <span className="studio-area-card__action">{copy.enterArea}<b>↗</b></span><i className="studio-area-card__shine" aria-hidden="true" />
            </button>;
        }),
        <button key="stickman" className="studio-area-card area-stickman" style={{ "--area-index": animationCategories.length } as CSSProperties} type="button" onClick={() => enter("stickman")}>
          <span className="studio-area-card__number">0{animationCategories.length + 1}</span><span className="studio-area-card__icon"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M31 9v43M8 22h22l-9 8 9 8M33 20h23l-9-8 9-8"/><circle cx="43" cy="43" r="7" className="icon-fill" /></svg></span>
          <span className="studio-area-card__art" aria-hidden="true"><svg className="stickman-area-art" viewBox="0 0 560 300"><defs><linearGradient id="stickmanPaper" x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--panel)"/><stop offset="1" stopColor="var(--accent-soft)"/></linearGradient></defs><rect x="18" y="18" width="524" height="264" rx="22" fill="url(#stickmanPaper)" stroke="var(--line)"/><path d="M42 244c83-55 145-94 228-95 70-1 135-43 244-87" fill="none" stroke="var(--line)" strokeWidth="18" strokeLinecap="round" opacity=".7"/><path d="M42 244c83-55 145-94 228-95 70-1 135-43 244-87" fill="none" stroke="var(--panel)" strokeWidth="12" strokeLinecap="round"/><path d="M283 235c2-73 2-120 0-180M282 93l-48-5 37-28M285 93l51-5-40-28" fill="none" stroke="var(--ink)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/><g stroke="var(--ink)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"><circle cx="81" cy="124" r="10" fill="var(--ink)"/><path d="M81 135v36m0-25-17 15m17-15 17 11m-17 14-15 25m15-25 18 23"/><circle cx="125" cy="152" r="9" fill="var(--ink)"/><path d="M125 162v32m0-22-14 12m14-12 15 8m-15 14-13 21m13-21 16 20"/><circle cx="174" cy="119" r="11" fill="var(--ink)"/><path d="M174 131v39m0-27-18 14m18-14 18 10m-18 17-15 25m15-25 18 24"/><circle cx="222" cy="158" r="8" fill="var(--ink)"/><path d="M222 168v28m0-19-13 11m13-11 13 9m-13 10-12 18m12-18 15 17"/></g><g stroke="var(--accent-strong)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"><circle cx="454" cy="117" r="12" fill="var(--accent-strong)"/><path d="M454 130v46m0-31-19 15m19-15 20 12m-20 19-16 29m16-29 21 27"/></g><circle cx="454" cy="117" r="4" fill="var(--panel)"/></svg></span>
          <span className="studio-area-card__copy"><small>{copy.stickmanTools}</small><strong>{copy.stickman}</strong><em>{copy.stickmanDescription}</em></span>
          <span className="studio-area-card__action">{copy.enterArea}<b>↗</b></span><i className="studio-area-card__shine" aria-hidden="true" />
        </button>,
        <button key="autopost" className="studio-area-card area-autopost" style={{ "--area-index": animationCategories.length + 1 } as CSSProperties} type="button" onClick={() => enter("autopost")}>
          <span className="studio-area-card__number">0{animationCategories.length + 2}</span><span className="studio-area-card__icon"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M15 8h27l8 8v40H15Z"/><path d="M42 8v10h10M23 29h19M23 38h19M23 47h12"/><path d="m8 18 7-7 7 7"/></svg></span>
          <span className="studio-area-card__art" aria-hidden="true"><svg className="autopost-area-art" viewBox="0 0 560 300"><defs><linearGradient id="postPaper" x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--panel)"/><stop offset="1" stopColor="var(--accent-soft)"/></linearGradient></defs><rect x="98" y="42" width="246" height="195" rx="18" fill="url(#postPaper)" stroke="var(--line)"/><path d="M137 93h166M137 121h130M137 149h166M137 177h96" stroke="var(--ink)" strokeWidth="9" strokeLinecap="round" opacity=".72"/><rect x="304" y="91" width="155" height="126" rx="20" fill="var(--ink)"/><path d="M339 142h19l13-31 20 67 16-45 16 27h15" fill="none" stroke="var(--accent)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/><path d="m267 242 29 29 67-75" fill="none" stroke="var(--accent-strong)" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
          <span className="studio-area-card__copy"><small>{copy.autopostTools}</small><strong>{copy.autopost}</strong><em>{copy.autopostDescription}</em></span>
          <span className="studio-area-card__action">{copy.enterArea}<b>↗</b></span><i className="studio-area-card__shine" aria-hidden="true" />
        </button>,
        <button key="reports" className="studio-area-card area-reports" style={{ "--area-index": animationCategories.length + 2 } as CSSProperties} type="button" onClick={() => enter("reports")}>
          <span className="studio-area-card__number">{String(animationCategories.length + 3).padStart(2, "0")}</span>
          <span className="studio-area-card__icon"><svg viewBox="0 0 64 64" aria-hidden="true"><rect x="8" y="8" width="48" height="48" rx="7"/><path d="M8 23h48M25 23v33M34 44V33m9 11V29m-27 4h2m-2 9h2"/></svg></span>
          <span className="studio-area-card__art" aria-hidden="true">
            <svg className="reports-area-art" viewBox="0 0 560 300">
              <rect x="44" y="28" width="472" height="244" rx="20" fill="#ffffff" stroke="var(--line)"/>
              <path d="M44 77h472M131 77v195" stroke="#211b1f" strokeOpacity=".12"/>
              <circle cx="68" cy="52" r="5" fill="#ff4f9a"/><path d="M84 52h81" stroke="#211b1f" strokeWidth="7" strokeLinecap="round"/>
              <g stroke="#211b1f" strokeOpacity=".3" strokeWidth="5" strokeLinecap="round"><path d="M64 103h45M64 126h34M64 149h39M64 172h28"/></g>
              <rect x="151" y="94" width="99" height="52" rx="8" fill="#211b1f"/><rect x="264" y="94" width="99" height="52" rx="8" fill="#ff4f9a"/><rect x="377" y="94" width="117" height="52" rx="8" fill="#ff4f9a" fillOpacity=".12"/>
              <g stroke="#ffffff" strokeWidth="6" strokeLinecap="round"><path d="M166 114h35M166 130h64M279 114h31M279 130h53"/></g><path d="M392 114h39M392 130h66" stroke="#211b1f" strokeWidth="6" strokeLinecap="round"/>
              <path d="M151 249h195" stroke="#211b1f" strokeOpacity=".15"/><rect x="165" y="205" width="24" height="43" rx="4" fill="#ff4f9a" fillOpacity=".4"/><rect x="204" y="181" width="24" height="67" rx="4" fill="#ff4f9a" fillOpacity=".6"/><rect x="243" y="195" width="24" height="53" rx="4" fill="#ff4f9a" fillOpacity=".8"/><rect x="282" y="165" width="24" height="83" rx="4" fill="#ff4f9a"/>
              <circle cx="426" cy="206" r="35" fill="none" stroke="#211b1f" strokeWidth="15"/><circle cx="426" cy="206" r="35" fill="none" stroke="#ff4f9a" strokeWidth="15" strokeDasharray="148 220" transform="rotate(-90 426 206)"/>
            </svg>
          </span>
          <span className="studio-area-card__copy"><small>CSV · Excel · TXT</small><strong>Reports</strong><em>{language === "it" ? "Dai dati alle dashboard. Crea grafici, indicatori e report da condividere." : "Turn data into dashboards. Create charts, metrics and reports to share."}</em></span>
          <span className="studio-area-card__action">{copy.enterArea}<b>↗</b></span><i className="studio-area-card__shine" aria-hidden="true" />
        </button>,
        <button key="postit" className="studio-area-card area-postit" style={{ "--area-index": animationCategories.length + 3 } as CSSProperties} type="button" onClick={() => enter("postit")}>
          <span className="studio-area-card__number">{String(animationCategories.length + 4).padStart(2, "0")}</span>
          <span className="studio-area-card__icon"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M13 10h38v37L40 57H13Z"/><path d="M40 57V46h11M21 22h22M21 31h17M21 40h12"/></svg></span>
          <span className="studio-area-card__art" aria-hidden="true"><svg className="postit-area-art" viewBox="0 0 560 300"><defs><linearGradient id="postitHomePaper" x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--panel)"/><stop offset="1" stopColor="var(--accent-soft)"/></linearGradient></defs><path d="M95 52h190v165l-37 36H95Z" fill="url(#postitHomePaper)" stroke="var(--line)"/><path d="M248 253v-36h37" fill="none" stroke="var(--accent)" strokeWidth="5"/><path d="M130 101h117M130 130h91M130 159h106" stroke="var(--ink)" strokeWidth="10" strokeLinecap="round" opacity=".7"/><g fill="none" stroke="var(--accent-strong)" strokeWidth="7"><circle cx="380" cy="78" r="20"/><circle cx="455" cy="148" r="20"/><circle cx="352" cy="224" r="20"/><path d="m396 92 43 42M441 160l-70 52M365 206l7-107" strokeLinecap="round"/></g><g fill="var(--accent-strong)"><circle cx="380" cy="78" r="7"/><circle cx="455" cy="148" r="7"/><circle cx="352" cy="224" r="7"/></g></svg></span>
          <span className="studio-area-card__copy"><small>{language === "it" ? "Memoria e flussi semantici" : "Semantic memory & flows"}</small><strong>Post-it</strong><em>{language === "it" ? "Salva idee e link, collegali in flussi e ritrovali con ricerca vettoriale locale." : "Save ideas and links, connect them into flows and retrieve them with local vector search."}</em></span>
          <span className="studio-area-card__action">{copy.enterArea}<b>↗</b></span><i className="studio-area-card__shine" aria-hidden="true" />
        </button>,
        <button key="streamer" className="studio-area-card area-streamer" style={{ "--area-index": animationCategories.length + 4 } as CSSProperties} type="button" onClick={() => enter("streamer")}>
          <span className="studio-area-card__number">{String(animationCategories.length + 5).padStart(2, "0")}</span>
          <span className="studio-area-card__icon"><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="21" /><circle cx="32" cy="32" r="7" className="icon-fill" /><path d="M32 11v14M32 39v14M11 32h14M39 32h14" /><path d="M20 20 15 15m29 29 5 5M44 20l5-5M20 44l-5 5" /></svg></span>
          <span className="studio-area-card__art" aria-hidden="true"><svg className="streamer-area-art" viewBox="0 0 560 300"><defs><linearGradient id="streamerPaper" x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--panel)"/><stop offset="1" stopColor="var(--accent-soft)"/></linearGradient></defs><rect x="28" y="35" width="504" height="230" rx="24" fill="url(#streamerPaper)" stroke="var(--line)"/><path d="M67 165c22-37 44 37 66 0s44-37 66 0 44 37 66 0 44-37 66 0 44 37 66 0 44-37 66 0" fill="none" stroke="var(--accent-strong)" strokeWidth="9" strokeLinecap="round"/><path d="M67 208h133M360 208h133" stroke="var(--line)" strokeWidth="7" strokeLinecap="round"/><circle cx="106" cy="99" r="24" fill="var(--ink)"/><circle cx="106" cy="99" r="8" fill="var(--panel)"/><path d="M106 75v13m0 22v13m-24-24h13m22 0h13" stroke="var(--accent)" strokeWidth="5" strokeLinecap="round"/><rect x="342" y="75" width="126" height="49" rx="15" fill="var(--ink)"/><path d="M363 99h43m-43 12h64" stroke="var(--panel)" strokeWidth="6" strokeLinecap="round" opacity=".86"/></svg></span>
          <span className="studio-area-card__copy"><small>{language === "it" ? "Playlist · File locali · Analisi audio professionale" : "Playlists · Local files · Professional audio analysis"}</small><strong>Streamer Audio Viewer</strong><em>{language === "it" ? "Ascolta, analizza e ordina file locali, playlist e player ufficiali in una coda professionale." : "Listen, analyze and reorder local files, playlists and official players in one professional queue."}</em></span>
          <span className="studio-area-card__action">{copy.enterArea}<b>↗</b></span><i className="studio-area-card__shine" aria-hidden="true" />
        </button>,
        <button key="documentation" className="studio-area-card area-documentation" style={{ "--area-index": animationCategories.length + 5 } as CSSProperties} type="button" onClick={() => enter("documentation")}>
          <span className="studio-area-card__number">{String(animationCategories.length + 6).padStart(2, "0")}</span>
          <span className="studio-area-card__icon"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 12h17c4 0 5 3 5 6v34c0-4-3-6-7-6H10Z"/><path d="M54 12H37c-4 0-5 3-5 6v34c0-4 3-6 7-6h15Z"/><path d="M17 22h9M17 29h9M38 22h9M38 29h9"/></svg></span>
          <span className="studio-area-card__art" aria-hidden="true"><svg className="documentation-area-art" viewBox="0 0 560 300"><rect x="38" y="32" width="484" height="236" rx="22" fill="var(--panel)" stroke="var(--line)"/><path d="M280 63c-31-24-82-27-145-17v168c61-10 112-7 145 19 33-26 84-29 145-19V46c-63-10-114-7-145 17Z" fill="var(--accent-soft)" stroke="var(--accent-strong)" strokeWidth="5"/><path d="M280 64v169M159 85h86M159 111h71M159 137h88M315 85h86M315 111h66M315 137h88" fill="none" stroke="var(--ink)" strokeWidth="9" strokeLinecap="round" opacity=".72"/><circle cx="397" cy="190" r="31" fill="var(--ink)"/><path d="m419 213 27 27M384 190h26" stroke="var(--accent)" strokeWidth="8" strokeLinecap="round"/></svg></span>
          <span className="studio-area-card__copy"><small>{language === "it" ? "Guida completa · Ricerca AI locale" : "Complete guide · Local AI search"}</small><strong>Documentation</strong><em>{language === "it" ? "Esplora ogni funzione e trova la risposta descrivendo ciò che vuoi fare." : "Explore every feature and find answers by describing what you want to do."}</em></span>
          <span className="studio-area-card__action">{copy.enterArea}<b>↗</b></span><i className="studio-area-card__shine" aria-hidden="true" />
        </button>,
        ].sort((a, b) => sortByUsage ? (counts[b.key as StudioTaskArea] ?? 0) - (counts[a.key as StudioTaskArea] ?? 0) : 0).map((card, index) => cloneElement(card, {
          "data-area-id": card.key,
          style: { ...card.props.style, "--area-index": index } as CSSProperties,
        }))}
      </section>
    </main>
    <footer className="studio-home__footer"><span>{copy.productionSuite}</span><span>{copy.introSound} · {copy.introImage} · {copy.introVideo}</span></footer>
  </div>;
}
