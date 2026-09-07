import { useState } from "react";
import { App } from "../App";
import { ArtistSupportProvider } from "./ArtistSupport";
import { StudioHome } from "./StudioHome";
import { WelcomeSplash } from "./WelcomeSplash";
import { MemoryStudioProvider } from "./MemoryStudio";
import { resetWorkspaceForAreaEntry } from "../services/workspace-area-lifecycle";
import { UiLocalizationBridge } from "./UiLocalizationBridge";
import { ApplicationAssistant } from "./ApplicationAssistant";
import { useProjectStore } from "../store/project-store";
import { useAudioStore } from "../store/audio-store";
import { useAnalysisStore } from "../store/analysis-store";
import { getAnimationMode } from "../services/animation-modes";
import { StudioSettings } from "./StudioSettings";

type StudioScreen = "welcome" | "areas" | "editor";

function StudioRouter() {
  const [screen, setScreen] = useState<StudioScreen>(() => { resetWorkspaceForAreaEntry(); return "welcome"; });
  const project = useProjectStore((state) => state.project);
  const setAnimationMode = useProjectStore((state) => state.setAnimationMode);
  const imported = useAudioStore((state) => state.imported);
  const analysis = useAnalysisStore((state) => state.result);
  const mode = getAnimationMode(project.animation.modeId);
  const navigate = (modeId: string) => {
    const destination = getAnimationMode(modeId);
    resetWorkspaceForAreaEntry();
    setAnimationMode(destination.id, [...destination.defaultBaseObjectTypes]);
    setScreen("editor");
  };
  const content = screen === "welcome"
    ? <WelcomeSplash onContinue={() => setScreen("areas")} />
    : screen === "areas"
      ? <StudioHome onEnterArea={() => setScreen("editor")} />
      : <App onHome={() => setScreen("areas")} />;
  return <>{content}{screen !== "welcome" ? <ApplicationAssistant context={{ modeId: mode.id, modeLabel: screen === "areas" ? "Home aree" : mode.label, aspectRatio: project.canvas.aspectRatio, hasAudio: Boolean(imported), analysisReady: Boolean(analysis), screen }} onNavigate={navigate} /> : null}</>;
}

export function StudioExperience() { return <ArtistSupportProvider><MemoryStudioProvider><UiLocalizationBridge /><StudioRouter /><StudioSettings /></MemoryStudioProvider></ArtistSupportProvider>; }
