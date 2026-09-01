import type { CSSProperties } from "react";
import { animationCategories, getAnimationMode, type AnimationCategoryId } from "../services/animation-modes";
import { uiCopy, useUiPreferences } from "../services/ui-preferences";
import { useProjectStore } from "../store/project-store";
import { AreaIcon } from "./StudioIcons";
import { SupportArtistButton } from "./ArtistSupport";
import { MemoryButton } from "./MemoryStudio";
import { resetWorkspaceForAreaEntry } from "../services/workspace-area-lifecycle";

const areaCopyKeys = {
  soundAnimation: { label: "soundAnimation", description: "soundDescription" },
  photoVideoStudio: { label: "photoVideoStudio", description: "photoVideoDescription" },
  videoEditor: { label: "videoEditor", description: "videoEditorDescription" },
  music: { label: "music", description: "musicDescription" },
  lipsync: { label: "lipsync", description: "lipsyncDescription" }
} as const;

export type StudioAreaDestination = AnimationCategoryId;

export function StudioHome({ onEnterArea }: { onEnterArea: (category: StudioAreaDestination) => void }) {
  const { language, theme, setLanguage, setTheme } = useUiPreferences(); const copy = uiCopy[language]; const setAnimationMode = useProjectStore((state) => state.setAnimationMode);
  const enter = (categoryId: AnimationCategoryId) => {
    resetWorkspaceForAreaEntry();
    const category = animationCategories.find((item) => item.id === categoryId) ?? animationCategories[0]!;
    const firstMode = getAnimationMode(category.groups[0]!.modeIds[0]!);
    setAnimationMode(firstMode.id, [...firstMode.defaultBaseObjectTypes]); onEnterArea(category.id);
  };
  return <div className="studio-home">
    <div className="studio-home__atmosphere" aria-hidden="true"><i /><i /><i /><i /></div>
    <header className="studio-home__topbar">
      <div className="brand" aria-label="MLSM Studio — My Lonely Soul Music Studio"><img className="brand-mark" src="/mlsm-studio-favicon-192.png" alt="" /><span className="brand-copy"><strong>MLSM Studio</strong><small>My Lonely Soul Music</small></span></div>
      <div className="studio-home__preferences"><MemoryButton /><SupportArtistButton /><label><span>{copy.language}</span><select aria-label={copy.language} value={language} onChange={(event) => setLanguage(event.target.value === "en" ? "en" : "it")}><option value="it">IT</option><option value="en">EN</option></select></label><button className="theme-toggle" aria-label={`${copy.appearance}: ${theme === "day" ? copy.day : copy.night}`} onClick={() => setTheme(theme === "day" ? "night" : "day")}><span aria-hidden="true">{theme === "day" ? "☼" : "◐"}</span>{theme === "day" ? copy.day : copy.night}</button></div>
    </header>
    <main className="studio-home__main">
      <div className="studio-home__intro"><span>MLSM / CREATIVE OS</span><h1>{copy.chooseArea}</h1><p>{copy.chooseAreaDescription}</p></div>
      <section className="studio-area-grid" aria-label={copy.availableAreas}>
        {animationCategories.map((category, index) => {
          const keys = areaCopyKeys[category.id]; const modeCount = category.groups.reduce((total, group) => total + group.modeIds.length, 0);
          return <button key={category.id} className={`studio-area-card area-${category.id}`} style={{ "--area-index": index } as CSSProperties} type="button" onClick={() => enter(category.id)}>
            <span className="studio-area-card__number">0{index + 1}</span><span className="studio-area-card__icon"><AreaIcon category={category.id} /></span>
            <span className="studio-area-card__copy"><small>{modeCount} {copy.creativeModes}</small><strong>{copy[keys.label]}</strong><em>{copy[keys.description]}</em></span>
            <span className="studio-area-card__action">{copy.enterArea}<b>↗</b></span><i className="studio-area-card__shine" aria-hidden="true" />
          </button>;
        })}
      </section>
    </main>
    <footer className="studio-home__footer"><span>MLSM Studio · Creative production suite</span><span>Sound · Image · Video</span></footer>
  </div>;
}
