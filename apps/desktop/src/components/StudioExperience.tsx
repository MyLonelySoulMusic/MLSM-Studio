import { useState } from "react";
import { App } from "../App";
import { ArtistSupportProvider } from "./ArtistSupport";
import { StudioHome } from "./StudioHome";
import { WelcomeSplash } from "./WelcomeSplash";
import { MemoryStudioProvider } from "./MemoryStudio";
import { resetWorkspaceForAreaEntry } from "../services/workspace-area-lifecycle";
import { UiLocalizationBridge } from "./UiLocalizationBridge";

type StudioScreen = "welcome" | "areas" | "editor";

function StudioRouter() {
  const [screen, setScreen] = useState<StudioScreen>(() => { resetWorkspaceForAreaEntry(); return "welcome"; });
  if (screen === "welcome") return <WelcomeSplash onContinue={() => setScreen("areas")} />;
  if (screen === "areas") return <StudioHome onEnterArea={() => setScreen("editor")} />;
  return <App onHome={() => setScreen("areas")} />;
}

export function StudioExperience() { return <ArtistSupportProvider><MemoryStudioProvider><UiLocalizationBridge /><StudioRouter /></MemoryStudioProvider></ArtistSupportProvider>; }
