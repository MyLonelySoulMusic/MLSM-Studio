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
import { AutoPostApp } from "../autopost/AutoPostApp";
import { StickmanWorkspace } from "../stickman/StickmanWorkspace";

type StudioScreen = "welcome" | "areas" | "editor" | "autopost" | "stickman";

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
      ? <StudioHome onEnterArea={(area) => setScreen(area === "autopost" ? "autopost" : area === "stickman" ? "stickman" : "editor")} />
      : screen === "autopost"
        ? <AutoPostApp onHome={() => setScreen("areas")} />
        : screen === "stickman"
          ? <StickmanWorkspace onHome={() => setScreen("areas")} />
        : <App onHome={() => setScreen("areas")} />;
  const assistantScreen = screen === "editor" || screen === "stickman" ? "editor" : "areas";
  return <>{content}{screen !== "welcome" ? <ApplicationAssistant context={{ modeId: screen === "autopost" ? "autopost" : screen === "stickman" ? "stickman" : mode.id, modeLabel: screen === "areas" ? "Home aree" : screen === "autopost" ? "AutoPost" : screen === "stickman" ? "Stickman Animations" : mode.label, aspectRatio: screen === "stickman" ? "9:16" : project.canvas.aspectRatio, hasAudio: screen === "stickman" ? false : Boolean(imported), analysisReady: screen === "stickman" ? false : Boolean(analysis), screen: assistantScreen }} onNavigate={navigate} /> : null}</>;
}

export function StudioExperience() { return <ArtistSupportProvider><MemoryStudioProvider><UiLocalizationBridge /><StudioRouter /><StudioSettings /></MemoryStudioProvider></ArtistSupportProvider>; }
