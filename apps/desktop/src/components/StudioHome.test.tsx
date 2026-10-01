import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { useProjectStore } from "../store/project-store";
import { useAudioStore } from "../store/audio-store";
import { createProject } from "@rbs/project-schema";
import { registerVideoEditorFiles, videoEditorSessionFile } from "../services/video-editor-import";
import { StudioHome } from "./StudioHome";
import { animationCategories } from "../services/animation-modes";
import { clearTaskHistory, TASK_HISTORY_EVENT } from "../services/task-history";

describe("StudioHome", () => {
  beforeEach(() => { localStorage.clear(); useProjectStore.getState().newProject(); });
  afterEach(cleanup);

  it("presenta le aree come ingressi grandi e apre la prima modalità pertinente", () => {
    const onEnterArea = vi.fn();
    render(<StudioHome onEnterArea={onEnterArea} />);
    expect(screen.getByRole("link", { name: /Discord/ })).toHaveAttribute("href", "https://discord.gg/ttG2X9WjU");
    expect(within(screen.getByRole("region", { name: "Aree creative disponibili" })).getAllByRole("button")).toHaveLength(animationCategories.length + 6);
    expect(screen.getByRole("button", { name: /Sound Animation/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Photo & Video Studio/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Video Editor/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Music/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Lipsync/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Stickman Animations/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /AutoPost/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reports/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Post-it/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Streamer Audio Viewer/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Documentation/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Photo & Video Studio/ }));
    expect(onEnterArea).toHaveBeenCalledWith("photoVideoStudio");
    expect(useProjectStore.getState().project.animation.modeId).toBe("staticWatermark");
    fireEvent.click(screen.getByRole("button", { name: /Music/ }));
    expect(onEnterArea).toHaveBeenLastCalledWith("music");
    expect(useProjectStore.getState().project.animation.modeId).toBe("aiQuantizer");
    fireEvent.click(screen.getByRole("button", { name: /Lipsync/ }));
    expect(onEnterArea).toHaveBeenLastCalledWith("lipsync");
    expect(useProjectStore.getState().project.animation.modeId).toBe("mlsmPostLipsync");
    fireEvent.click(screen.getByRole("button", { name: /AutoPost/ }));
    expect(onEnterArea).toHaveBeenLastCalledWith("autopost");
    fireEvent.click(screen.getByRole("button", { name: /Stickman Animations/ }));
    expect(onEnterArea).toHaveBeenLastCalledWith("stickman");
    fireEvent.click(screen.getByRole("button", { name: /Reports/ }));
    expect(onEnterArea).toHaveBeenLastCalledWith("reports");
    fireEvent.click(screen.getByRole("button", { name: /Post-it/ }));
    expect(onEnterArea).toHaveBeenLastCalledWith("postit");
    fireEvent.click(screen.getByRole("button", { name: /Streamer Audio Viewer/ }));
    expect(onEnterArea).toHaveBeenLastCalledWith("streamer");
    fireEvent.click(screen.getByRole("button", { name: /Documentation/ }));
    expect(onEnterArea).toHaveBeenLastCalledWith("documentation");
  });

  it("usa l'intera card come unico target senza bloccare lo scorrimento verticale", () => {
    const css = readFileSync("apps/desktop/src/workspace-finish.css", "utf8");
    expect(css).toMatch(/\.studio-area-card\s*\{[^}]*touch-action:\s*pan-y;/s);
    expect(css).toMatch(/\.studio-area-card\s*>\s*\*\s*\{[^}]*pointer-events:\s*none;/s);
  });

  it("toggles real DOM ordering by Activity counts and restores the classic order", () => {
    localStorage.setItem("mlsm.task-history.v1", JSON.stringify([
      { id: "1", label: "Upscaler · Image", startedAt: 1, status: "completed" },
      { id: "2", label: "Frame Booster", startedAt: 2, status: "completed" },
      { id: "3", label: "Audio · Whisper", startedAt: 3, status: "completed" },
      { id: "4", label: "Report export", areaId: "reports", startedAt: 4, status: "completed" },
    ]));
    const { container } = render(<StudioHome onEnterArea={vi.fn()} />);
    const areaIds = () => [...container.querySelectorAll<HTMLElement>(".studio-area-card")].map(card => card.dataset.areaId);
    const original = areaIds();
    expect(original[0]).toBe("soundAnimation");
    const toggle = screen.getByRole("button", { name: "Ordina per utilizzo" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(areaIds().slice(0, 3)).toEqual(["photoVideoStudio", "audio", "reports"]);
    expect(areaIds().slice(3)).toEqual(original.filter(id => !["photoVideoStudio", "audio", "reports"].includes(id!)));
    fireEvent.click(screen.getByRole("button", { name: "Torna all’ordine classico" }));
    expect(areaIds()).toEqual(original);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(toggle);
    act(() => { clearTaskHistory(); });
    expect(areaIds()).toEqual(original);
  });

  it("animates horizontal and vertical moves in both directions", () => {
    localStorage.setItem("mlsm.task-history.v1", JSON.stringify([
      { id: "1", label: "Frame Booster", startedAt: 1, status: "completed" },
      { id: "2", label: "Report export", areaId: "reports", startedAt: 2, status: "completed" },
      { id: "3", label: "Report export", areaId: "reports", startedAt: 3, status: "completed" },
    ]));
    const { container } = render(<StudioHome onEnterArea={vi.fn()} />);
    const cards = [...container.querySelectorAll<HTMLElement>(".studio-area-card")];
    const animate = vi.fn(() => ({ cancel: vi.fn() } as unknown as Animation));
    cards.forEach(card => {
      card.animate = animate;
      card.getBoundingClientRect = () => {
        const index = [...card.parentElement!.children].indexOf(card);
        return { left: (index % 3) * 300, top: Math.floor(index / 3) * 400 } as DOMRect;
      };
    });
    fireEvent.click(screen.getByRole("button", { name: "Ordina per utilizzo" }));
    expect(animate).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ translate: "600px 800px" })]), expect.objectContaining({ duration: 720 }));
    animate.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Torna all’ordine classico" }));
    expect(animate).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ translate: "-600px -800px" })]), expect.any(Object));
    act(() => window.dispatchEvent(new Event(TASK_HISTORY_EVENT)));
  });

  it("apre ogni area come workspace pulito senza dati del Video Editor in Pro Subtitles",()=>{
    const previous=createProject();previous.animation.modeId="videoEditor";previous.animation.proSubtitles.videoUrl="blob:old-pro-subtitles";previous.animation.proSubtitles.videoName="old.mp4";previous.subtitles.cues=[{id:"old-cue",startSeconds:0,endSeconds:1,text:"VECCHIO",confidence:1,verified:true,manual:true}];previous.animation.videoEditor.assets=[{id:"old-asset",name:"old.mp4",kind:"video",url:"blob:old-editor",thumbnailUrl:null,durationSeconds:4,width:1920,height:1080,hasAudio:true,waveform:[],bpm:null,beats:[],downbeats:[]}];
    useProjectStore.getState().setProject(previous,null);useAudioStore.setState({imported:{url:"blob:old-pro-subtitles",metadata:{path:"",fileName:"old.mp4",durationSeconds:4,sampleRate:48_000,channels:2,codec:"h264/aac",fileSize:3,hash:"old"},waveform:[]}});registerVideoEditorFiles(new Map([["old-asset",new File(["old"],"old.mp4",{type:"video/mp4"})]]));const revoke=vi.fn();Object.defineProperty(URL,"revokeObjectURL",{configurable:true,value:revoke});
    render(<StudioHome onEnterArea={vi.fn()}/>);fireEvent.click(screen.getByRole("button",{name:/Sound Animation/}));
    const clean=useProjectStore.getState().project;expect(clean.animation.proSubtitles).toMatchObject({videoUrl:null,videoName:"",cueStyles:[]});expect(clean.animation.videoEditor.assets).toEqual([]);expect(clean.subtitles.cues).toEqual([]);expect(useAudioStore.getState().imported).toBeNull();expect(videoEditorSessionFile("old-asset")).toBeNull();expect(revoke).toHaveBeenCalledWith("blob:old-editor");expect(revoke).toHaveBeenCalledWith("blob:old-pro-subtitles");
  });
});
