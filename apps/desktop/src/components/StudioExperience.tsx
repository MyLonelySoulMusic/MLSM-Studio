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
import { getAnimationCategory, getAnimationMode } from "../services/animation-modes";
import { setTaskHistoryArea } from "../services/task-history";
import { StudioSettings } from "./StudioSettings";
import { AutoPostApp } from "../autopost/AutoPostApp";
import { StickmanWorkspace } from "../stickman/StickmanWorkspace";
import { reportViewIdFromHash } from "../reports/url";

const ReportsWorkspace = lazy(() => import("../reports/ReportsWorkspace").then((module) => ({ default: module.ReportsWorkspace })));
const PostItWorkspace = lazy(() => import("../postit/PostItWorkspace").then((module) => ({ default: module.PostItWorkspace })));
const StreamerAudioViewer = lazy(() => import("../streamer/StreamerAudioViewer").then((module) => ({ default: module.StreamerAudioViewer })));
const DocumentationWorkspace = lazy(() => import("../documentation/DocumentationWorkspace").then((module) => ({ default: module.DocumentationWorkspace })));

type StudioScreen = "welcome" | "areas" | "editor" | "autopost" | "stickman" | "reports" | "postit" | "streamer" | "documentation";

function StudioRouter() {
  const initialReportViewId = reportViewIdFromHash(window.location.hash);
  const [screen, setScreen] = useState<StudioScreen>(() => { resetWorkspaceForAreaEntry(); return initialReportViewId ? "reports" : "welcome"; });
  const [reportViewId, setReportViewId] = useState<string | null>(initialReportViewId);
  const project = useProjectStore((state) => state.project);
  const setAnimationMode = useProjectStore((state) => state.setAnimationMode);
  const imported = useAudioStore((state) => state.imported);
  const analysis = useAnalysisStore((state) => state.result);
  const mode = getAnimationMode(project.animation.modeId);
  useEffect(() => {
    const area = screen === "editor" ? getAnimationCategory(mode.id).id : screen === "welcome" || screen === "areas" ? undefined : screen;
    setTaskHistoryArea(area);
    return () => setTaskHistoryArea(undefined);
  }, [screen, mode.id]);
  useEffect(() => { const syncHash = () => { const id = reportViewIdFromHash(window.location.hash); if (id) { setReportViewId(id); setScreen("reports"); } }; window.addEventListener("hashchange", syncHash); return () => window.removeEventListener("hashchange", syncHash); }, []);
  const goHome = () => { resetWorkspaceForAreaEntry(); setScreen("areas"); };
  const closeReports = () => { if (reportViewId) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`); setReportViewId(null); goHome(); };
  const navigate = (modeId: string) => {
    if (modeId === "reports") { resetWorkspaceForAreaEntry(); setReportViewId(null); setScreen("reports"); return; }
    if (modeId === "postit") { resetWorkspaceForAreaEntry(); setScreen("postit"); return; }
    if (modeId === "streamer") { resetWorkspaceForAreaEntry(); setScreen("streamer"); return; }
    if (modeId === "documentation") { resetWorkspaceForAreaEntry(); setScreen("documentation"); return; }
    const destination = getAnimationMode(modeId);
    resetWorkspaceForAreaEntry();
    setAnimationMode(destination.id, [...destination.defaultBaseObjectTypes]);
    setScreen("editor");
  };
  const content = screen === "welcome"
    ? <WelcomeSplash onContinue={() => setScreen("areas")} />
    : screen === "areas"
      ? <StudioHome onEnterArea={(area) => { if (area === "reports") setReportViewId(null); setScreen(area === "autopost" || area === "stickman" || area === "reports" || area === "postit" || area === "streamer" || area === "documentation" ? area : "editor"); }} />
      : screen === "autopost"
        ? <AutoPostApp onHome={goHome} />
        : screen === "stickman"
          ? <StickmanWorkspace onHome={goHome} />
          : screen === "documentation"
            ? <Suspense fallback={<main className="studio-home"><p role="status">Loading Documentation…</p></main>}><DocumentationWorkspace onHome={goHome} /></Suspense>
          : screen === "streamer"
            ? <Suspense fallback={<main className="studio-home"><p role="status">Caricamento Streamer…</p></main>}><StreamerAudioViewer onHome={goHome} /></Suspense>
            : screen === "postit"
              ? <Suspense fallback={<main className="studio-home"><p role="status">Caricamento Post-it…</p></main>}><PostItWorkspace onHome={goHome} /></Suspense>
              : screen === "reports"
                ? <Suspense fallback={<main className="studio-home"><p role="status">Caricamento Reports…</p></main>}><ReportsWorkspace onHome={closeReports} viewDashboardId={reportViewId} onOpenViewer={id => { setReportViewId(id); setScreen("reports"); }} /></Suspense>
                : <App onHome={goHome} />;
  const assistantScreen = screen === "editor" || screen === "stickman" || screen === "reports" || screen === "postit" || screen === "streamer" || screen === "documentation" ? "editor" : "areas";
  const standalone = screen === "stickman" || screen === "reports" || screen === "postit" || screen === "streamer" || screen === "documentation";
  return <>{content}{screen !== "welcome" && !reportViewId ? <ApplicationAssistant hideLauncher={screen === "streamer"} context={{ modeId: screen === "autopost" ? "autopost" : screen === "stickman" ? "stickman" : screen === "reports" ? "reports" : screen === "postit" ? "postit" : screen === "streamer" ? "streamer" : screen === "documentation" ? "documentation" : mode.id, modeLabel: screen === "areas" ? "Home aree" : screen === "autopost" ? "AutoPost" : screen === "stickman" ? "Stickman Animations" : screen === "reports" ? "Reports" : screen === "postit" ? "Post-it" : screen === "streamer" ? "Streamer Audio Viewer" : screen === "documentation" ? "Documentation" : mode.label, aspectRatio: screen === "stickman" ? "9:16" : screen === "reports" ? "dashboard" : screen === "streamer" ? "audio" : standalone ? "workspace" : project.canvas.aspectRatio, hasAudio: standalone ? false : Boolean(imported), analysisReady: standalone ? false : Boolean(analysis), screen: assistantScreen }} onNavigate={navigate} /> : null}</>;
}

export function StudioExperience() { return <ArtistSupportProvider><MemoryStudioProvider><UiLocalizationBridge /><StudioRouter /><StudioSettings /></MemoryStudioProvider></ArtistSupportProvider>; }
