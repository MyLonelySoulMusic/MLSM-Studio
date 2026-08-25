import { useState } from "react";
import { App } from "../App";
import { ArtistSupportProvider } from "./ArtistSupport";
import { StudioHome } from "./StudioHome";
import { WelcomeSplash } from "./WelcomeSplash";
import { MemoryStudioProvider } from "./MemoryStudio";
import { LongCatVideoWorkspace } from "./LongCatVideoWorkspace";

type StudioScreen = "welcome" | "areas" | "editor" | "longCatVideo";

function StudioRouter() {
  const [screen, setScreen] = useState<StudioScreen>("welcome");
  if (screen === "welcome") return <WelcomeSplash onContinue={() => setScreen("areas")} />;
  if (screen === "areas") return <StudioHome onEnterArea={(area) => setScreen(area === "longCatVideo" ? "longCatVideo" : "editor")} />;
  if (screen === "longCatVideo") return <LongCatVideoWorkspace onHome={() => setScreen("areas")} />;
  return <App onHome={() => setScreen("areas")} />;
}

export function StudioExperience() { return <ArtistSupportProvider><MemoryStudioProvider><StudioRouter /></MemoryStudioProvider></ArtistSupportProvider>; }
