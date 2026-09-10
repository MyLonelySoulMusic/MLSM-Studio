import { SettingsButton } from "./StudioSettings";
import type { CSSProperties } from "react";
import { animationCategories, getAnimationMode, type AnimationCategoryId } from "../services/animation-modes";
import { uiCopy, useUiPreferences } from "../services/ui-preferences";
import { useProjectStore } from "../store/project-store";
import { AreaIcon } from "./StudioIcons";
import { AreaArtwork } from "./AreaArtwork";
import { SupportArtistButton } from "./ArtistSupport";
import { MemoryButton } from "./MemoryStudio";
import { resetWorkspaceForAreaEntry } from "../services/workspace-area-lifecycle";

const areaCopyKeys = {
  soundAnimation: { label: "soundAnimation", description: "soundDescription" },
  photoVideoStudio: { label: "photoVideoStudio", description: "photoVideoDescription" },
  videoEditor: { label: "videoEditor", description: "videoEditorDescription" },
  music: { label: "music", description: "musicDescription" },
  lipsync: { label: "lipsync", description: "lipsyncDescription" },
  audio: { label: "audio", description: "audioDescription" }
} as const;

export type StudioAreaDestination = AnimationCategoryId | "autopost" | "stickman";

export function StudioHome({ onEnterArea }: { onEnterArea: (category: StudioAreaDestination) => void }) {
  const { language, theme, setLanguage, setTheme } = useUiPreferences(); const copy = uiCopy[language]; const setAnimationMode = useProjectStore((state) => state.setAnimationMode);
  const enter = (categoryId: StudioAreaDestination) => {
    resetWorkspaceForAreaEntry();
    if (categoryId === "autopost" || categoryId === "stickman") { onEnterArea(categoryId); return; }
    const category = animationCategories.find((item) => item.id === categoryId) ?? animationCategories[0]!;
    const firstMode = getAnimationMode(category.groups[0]!.modeIds[0]!);
    setAnimationMode(firstMode.id, [...firstMode.defaultBaseObjectTypes]); onEnterArea(category.id);
  };
  return <div className="studio-home" data-ui-copy>
    <div className="studio-home__atmosphere" aria-hidden="true"><i /><i /><i /><i /></div>
    <header className="studio-home__topbar">
      <div className="brand" aria-label="MLSM Studio — My Lonely Soul Music Studio"><img className="brand-mark" src="/mlsm-studio-favicon-192.png" alt="" /><span className="brand-copy"><strong>MLSM Studio</strong><small>My Lonely Soul Music</small></span></div>
      <div className="studio-home__preferences"><SettingsButton /><MemoryButton /><SupportArtistButton /><label><span>{copy.language}</span><select aria-label={copy.language} value={language} onChange={(event) => setLanguage(event.target.value === "en" ? "en" : "it")}><option value="it">IT</option><option value="en">EN</option></select></label><button className="theme-toggle" aria-label={`${copy.appearance}: ${theme === "day" ? copy.day : copy.night}`} onClick={() => setTheme(theme === "day" ? "night" : "day")}><span aria-hidden="true">{theme === "day" ? "☼" : "◐"}</span>{theme === "day" ? copy.day : copy.night}</button></div>
    </header>
    <main className="studio-home__main">
      <div className="studio-home__intro"><span>{copy.workspaceEyebrow}</span><h1>{copy.chooseArea}</h1><p>{copy.chooseAreaDescription}</p></div>
      <section className="studio-area-grid" aria-label={copy.availableAreas}>
        {animationCategories.map((category, index) => {
          const keys = areaCopyKeys[category.id]; const modeCount = category.groups.reduce((total, group) => total + group.modeIds.length, 0);
          return <button key={category.id} className={`studio-area-card area-${category.id}`} style={{ "--area-index": index } as CSSProperties} type="button" onClick={() => enter(category.id)}>
            <span className="studio-area-card__number">0{index + 1}</span><span className="studio-area-card__icon"><AreaIcon category={category.id} /></span>
            <span className="studio-area-card__art" aria-hidden="true"><AreaArtwork category={category.id} /></span>
            <span className="studio-area-card__copy"><small>{modeCount} {modeCount === 1 ? copy.creativeMode : copy.creativeModes}</small><strong>{copy[keys.label]}</strong><em>{copy[keys.description]}</em></span>
            <span className="studio-area-card__action">{copy.enterArea}<b>↗</b></span><i className="studio-area-card__shine" aria-hidden="true" />
            </button>;
        })}
        <button className="studio-area-card area-stickman" style={{ "--area-index": animationCategories.length } as CSSProperties} type="button" onClick={() => enter("stickman")}>
          <span className="studio-area-card__number">0{animationCategories.length + 1}</span><span className="studio-area-card__icon"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M31 9v43M8 22h22l-9 8 9 8M33 20h23l-9-8 9-8"/><circle cx="43" cy="43" r="7" className="icon-fill" /></svg></span>
          <span className="studio-area-card__art" aria-hidden="true"><svg className="stickman-area-art" viewBox="0 0 560 300"><defs><linearGradient id="stickmanPaper" x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--panel)"/><stop offset="1" stopColor="var(--accent-soft)"/></linearGradient></defs><rect x="18" y="18" width="524" height="264" rx="22" fill="url(#stickmanPaper)" stroke="var(--line)"/><path d="M42 244c83-55 145-94 228-95 70-1 135-43 244-87" fill="none" stroke="var(--line)" strokeWidth="18" strokeLinecap="round" opacity=".7"/><path d="M42 244c83-55 145-94 228-95 70-1 135-43 244-87" fill="none" stroke="var(--panel)" strokeWidth="12" strokeLinecap="round"/><path d="M283 235c2-73 2-120 0-180M282 93l-48-5 37-28M285 93l51-5-40-28" fill="none" stroke="var(--ink)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/><g stroke="var(--ink)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"><circle cx="81" cy="124" r="10" fill="var(--ink)"/><path d="M81 135v36m0-25-17 15m17-15 17 11m-17 14-15 25m15-25 18 23"/><circle cx="125" cy="152" r="9" fill="var(--ink)"/><path d="M125 162v32m0-22-14 12m14-12 15 8m-15 14-13 21m13-21 16 20"/><circle cx="174" cy="119" r="11" fill="var(--ink)"/><path d="M174 131v39m0-27-18 14m18-14 18 10m-18 17-15 25m15-25 18 24"/><circle cx="222" cy="158" r="8" fill="var(--ink)"/><path d="M222 168v28m0-19-13 11m13-11 13 9m-13 10-12 18m12-18 15 17"/></g><g stroke="var(--accent-strong)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"><circle cx="454" cy="117" r="12" fill="var(--accent-strong)"/><path d="M454 130v46m0-31-19 15m19-15 20 12m-20 19-16 29m16-29 21 27"/></g><circle cx="454" cy="117" r="4" fill="var(--panel)"/></svg></span>
          <span className="studio-area-card__copy"><small>{copy.stickmanTools}</small><strong>{copy.stickman}</strong><em>{copy.stickmanDescription}</em></span>
          <span className="studio-area-card__action">{copy.enterArea}<b>↗</b></span><i className="studio-area-card__shine" aria-hidden="true" />
        </button>
        <button className="studio-area-card area-autopost" style={{ "--area-index": animationCategories.length + 1 } as CSSProperties} type="button" onClick={() => enter("autopost")}>
          <span className="studio-area-card__number">0{animationCategories.length + 2}</span><span className="studio-area-card__icon"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M15 8h27l8 8v40H15Z"/><path d="M42 8v10h10M23 29h19M23 38h19M23 47h12"/><path d="m8 18 7-7 7 7"/></svg></span>
          <span className="studio-area-card__art" aria-hidden="true"><svg className="autopost-area-art" viewBox="0 0 560 300"><defs><linearGradient id="postPaper" x1="0" y1="0" x2="1" y2="1"><stop stopColor="var(--panel)"/><stop offset="1" stopColor="var(--accent-soft)"/></linearGradient></defs><rect x="98" y="42" width="246" height="195" rx="18" fill="url(#postPaper)" stroke="var(--line)"/><path d="M137 93h166M137 121h130M137 149h166M137 177h96" stroke="var(--ink)" strokeWidth="9" strokeLinecap="round" opacity=".72"/><rect x="304" y="91" width="155" height="126" rx="20" fill="var(--ink)"/><path d="M339 142h19l13-31 20 67 16-45 16 27h15" fill="none" stroke="var(--accent)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round"/><path d="m267 242 29 29 67-75" fill="none" stroke="var(--accent-strong)" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round"/></svg></span>
          <span className="studio-area-card__copy"><small>{copy.autopostTools}</small><strong>{copy.autopost}</strong><em>{copy.autopostDescription}</em></span>
          <span className="studio-area-card__action">{copy.enterArea}<b>↗</b></span><i className="studio-area-card__shine" aria-hidden="true" />
        </button>
      </section>
    </main>
    <footer className="studio-home__footer"><span>{copy.productionSuite}</span><span>{copy.introSound} · {copy.introImage} · {copy.introVideo}</span></footer>
  </div>;
}
