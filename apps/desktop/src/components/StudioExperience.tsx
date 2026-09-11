import { lazy, Suspense, useEffect, useState } from "react";
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
import { reportViewIdFromHash } from "../reports/url";

const ReportsWorkspace = lazy(() => import("../reports/ReportsWorkspace").then((module) => ({ default: module.ReportsWorkspace })));

type StudioScreen = "welcome" | "areas" | "editor" | "autopost" | "stickman" | "reports";

function StudioRouter() {
  const initialReportViewId = reportViewIdFromHash(window.location.hash);
  const [screen, setScreen] = useState<StudioScreen>(() => { resetWorkspaceForAreaEntry(); return initialReportViewId ? "reports" : "welcome"; });
  const [reportViewId, setReportViewId] = useState<string | null>(initialReportViewId);
  const project = useProjectStore((state) => state.project);
  const setAnimationMode = useProjectStore((state) => state.setAnimationMode);
  const imported = useAudioStore((state) => state.imported);
  const analysis = useAnalysisStore((state) => state.result);
  const mode = getAnimationMode(project.animation.modeId);
  useEffect(() => { const syncHash = () => { const id = reportViewIdFromHash(window.location.hash); if (id) { setReportViewId(id); setScreen("reports"); } }; window.addEventListener("hashchange", syncHash); return () => window.removeEventListener("hashchange", syncHash); }, []);
  const closeReports = () => { if (reportViewId) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`); setReportViewId(null); setScreen("areas"); };
  const navigate = (modeId: string) => {
    if (modeId === "reports") { resetWorkspaceForAreaEntry(); setReportViewId(null); setScreen("reports"); return; }
    const destination = getAnimationMode(modeId);
    resetWorkspaceForAreaEntry();
    setAnimationMode(destination.id, [...destination.defaultBaseObjectTypes]);
    setScreen("editor");
  };
  const content = screen === "welcome"
    ? <WelcomeSplash onContinue={() => setScreen("areas")} />
    : screen === "areas"
      ? <StudioHome onEnterArea={(area) => { if (area === "reports") setReportViewId(null); setScreen(area === "autopost" || area === "stickman" || area === "reports" ? area : "editor"); }} />
      : screen === "autopost"
        ? <AutoPostApp onHome={() => setScreen("areas")} />
        : screen === "stickman"
          ? <StickmanWorkspace onHome={() => setScreen("areas")} />
        : screen === "reports"
          ? <Suspense fallback={<main className="studio-home"><p role="status">Caricamento Reports…</p></main>}><ReportsWorkspace onHome={closeReports} viewDashboardId={reportViewId} onOpenViewer={id => { setReportViewId(id); setScreen("reports"); }} /></Suspense>
        : <App onHome={() => setScreen("areas")} />;
  const assistantScreen = screen === "editor" || screen === "stickman" || screen === "reports" ? "editor" : "areas";
  return <>{content}{screen !== "welcome" && !reportViewId ? <ApplicationAssistant context={{ modeId: screen === "autopost" ? "autopost" : screen === "stickman" ? "stickman" : screen === "reports" ? "reports" : mode.id, modeLabel: screen === "areas" ? "Home aree" : screen === "autopost" ? "AutoPost" : screen === "stickman" ? "Stickman Animations" : screen === "reports" ? "Reports" : mode.label, aspectRatio: screen === "stickman" ? "9:16" : screen === "reports" ? "dashboard" : project.canvas.aspectRatio, hasAudio: screen === "stickman" || screen === "reports" ? false : Boolean(imported), analysisReady: screen === "stickman" || screen === "reports" ? false : Boolean(analysis), screen: assistantScreen }} onNavigate={navigate} /> : null}</>;
}

export function StudioExperience() { return <ArtistSupportProvider><MemoryStudioProvider><UiLocalizationBridge /><StudioRouter /><StudioSettings /></MemoryStudioProvider></ArtistSupportProvider>; }
