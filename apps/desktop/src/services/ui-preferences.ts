import { useEffect, useState } from "react";

export type UiLanguage = "it" | "en";
export type UiTheme = "day" | "night";

export interface UiPreferences { language: UiLanguage; theme: UiTheme; }

const STORAGE_KEY = "dynamic-sound-animation-studio.ui.v1";
const CHANGE_EVENT = "dsas-ui-preferences";
const defaults: UiPreferences = { language: "it", theme: "day" };

function readPreferences(): UiPreferences {
  if (typeof window === "undefined") return defaults;
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<UiPreferences>;
    return {
      language: value.language === "en" ? "en" : "it",
      theme: value.theme === "night" ? "night" : "day"
    };
  } catch {
    return defaults;
  }
}

function applyPreferences(value: UiPreferences) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = value.theme;
  document.documentElement.lang = value.language;
  document.documentElement.style.colorScheme = value.theme === "night" ? "dark" : "light";
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", value.theme === "night" ? "#000000" : "#ffffff");
}

export function initializeUiPreferences() { applyPreferences(readPreferences()); }

export function updateUiPreferences(patch: Partial<UiPreferences>) {
  const value = { ...readPreferences(), ...patch };
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch { /* Preferences still apply for the current session. */ }
  applyPreferences(value);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

export function useUiPreferences() {
  const [preferences, setPreferences] = useState(readPreferences);
  useEffect(() => {
    applyPreferences(readPreferences());
    const sync = () => setPreferences(readPreferences());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(CHANGE_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  return {
    ...preferences,
    setLanguage: (language: UiLanguage) => updateUiPreferences({ language }),
    setTheme: (theme: UiTheme) => updateUiPreferences({ theme })
  };
}

export const uiCopy = {
  it: {
    projectActions: "Azioni progetto", new: "Nuovo", open: "Apri", save: "Salva", undo: "Annulla", redo: "Ripeti",
    importAudio: "Importa audio", importing: "Importazione…", analyze: "Analizza", analysis: "Analisi", generate: "Genera scena", export: "Esporta",
    language: "Lingua", appearance: "Aspetto", day: "Giorno", night: "Notte", navigation: "Navigazione creativa",
    category: "Area", mode: "Modalità", soundAnimation: "Sound Animation", soundDescription: "Animazioni guidate da audio, ritmo e spettro.",
    visualizers: "Visualizer", stories: "Storie e personaggi", typography: "Testo e sottotitoli", restoration: "Restauro e upscaling", photoVideoStudio: "Photo & Video Studio", photoVideoDescription: "Riparazione, compositing e strumenti professionali per immagini e video.",
    editing: "Montaggio multitraccia", videoEditor: "Video Editor", videoEditorDescription: "Montaggio professionale con pool media, timeline multitraccia, fusione, correzione colore ed export interpolato.", music: "Music", musicDescription: "Produzione audio, quantizzazione intelligente, restauro e mastering.", musicTools: "Produzione e mastering", currentMode: "MODALITÀ ATTIVA",
    home: "Home", memory: "Memory", openMemory: "Apri memoria intelligente", supportArtist: "Supportami", supportTitle: "Sostieni My Lonely Soul Music", supportDescription: "Ascolta, condividi e scopri le ultime uscite dell’artista che rende possibile MLSM Studio.", close: "Chiudi", latestVideos: "Guarda gli ultimi contenuti", artistChannels: "Canali ufficiali dell’artista", featuredContent: "Contenuto in evidenza", previousContent: "Contenuto precedente", nextContent: "Contenuto successivo", chooseArea: "Cosa vuoi creare?", chooseAreaDescription: "Scegli un ambiente di lavoro. All’interno troverai soltanto gli strumenti e le modalità pertinenti al tuo progetto.", availableAreas: "Aree creative disponibili", creativeModes: "modalità creative", enterArea: "Apri area", enterStudio: "Entra in MLSM Studio", supportOnSocials: "Supporta l’artista"
  },
  en: {
    projectActions: "Project actions", new: "New", open: "Open", save: "Save", undo: "Undo", redo: "Redo",
    importAudio: "Import audio", importing: "Importing…", analyze: "Analyze", analysis: "Analysis", generate: "Generate scene", export: "Export",
    language: "Language", appearance: "Appearance", day: "Day", night: "Night", navigation: "Creative navigation",
    category: "Area", mode: "Mode", soundAnimation: "Sound Animation", soundDescription: "Animations driven by audio, rhythm and spectrum.",
    visualizers: "Visualizers", stories: "Stories & characters", typography: "Text & subtitles", restoration: "Restoration & upscaling", photoVideoStudio: "Photo & Video Studio", photoVideoDescription: "Professional image and video repair, compositing and production tools.",
    editing: "Multitrack editing", videoEditor: "Video Editor", videoEditorDescription: "Professional editing with media pool, multitrack timeline, blending, colour grading and interpolated export.", music: "Music", musicDescription: "Audio production, intelligent quantization, restoration and mastering.", musicTools: "Production & mastering", currentMode: "ACTIVE MODE",
    home: "Home", memory: "Memory", openMemory: "Open intelligent memory", supportArtist: "Support me", supportTitle: "Support My Lonely Soul Music", supportDescription: "Listen, share and discover the artist’s latest releases while supporting the work behind MLSM Studio.", close: "Close", latestVideos: "Watch the latest content", artistChannels: "Official artist channels", featuredContent: "Featured content", previousContent: "Previous content", nextContent: "Next content", chooseArea: "What do you want to create?", chooseAreaDescription: "Choose a workspace. Inside it you will only find tools and modes relevant to your project.", availableAreas: "Available creative areas", creativeModes: "creative modes", enterArea: "Open area", enterStudio: "Enter MLSM Studio", supportOnSocials: "Support the artist"
  }
} as const;
