import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "../store/project-store";
import { useAudioStore } from "../store/audio-store";
import { createProject } from "@rbs/project-schema";
import { registerVideoEditorFiles, videoEditorSessionFile } from "../services/video-editor-import";
import { StudioHome } from "./StudioHome";

describe("StudioHome", () => {
  beforeEach(() => { localStorage.clear(); useProjectStore.getState().newProject(); });
  afterEach(cleanup);

  it("presenta le aree come ingressi grandi e apre la prima modalità pertinente", () => {
    const onEnterArea = vi.fn();
    render(<StudioHome onEnterArea={onEnterArea} />);
    expect(screen.getByRole("button", { name: /Sound Animation/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Photo & Video Studio/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Video Editor/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Music/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Photo & Video Studio/ }));
    expect(onEnterArea).toHaveBeenCalledWith("photoVideoStudio");
    expect(useProjectStore.getState().project.animation.modeId).toBe("staticWatermark");
    fireEvent.click(screen.getByRole("button", { name: /Music/ }));
    expect(onEnterArea).toHaveBeenLastCalledWith("music");
    expect(useProjectStore.getState().project.animation.modeId).toBe("aiQuantizer");
  });

  it("apre ogni area come workspace pulito senza dati del Video Editor in Pro Subtitles",()=>{
    const previous=createProject();previous.animation.modeId="videoEditor";previous.animation.proSubtitles.videoUrl="blob:old-pro-subtitles";previous.animation.proSubtitles.videoName="old.mp4";previous.subtitles.cues=[{id:"old-cue",startSeconds:0,endSeconds:1,text:"VECCHIO",confidence:1,verified:true,manual:true}];previous.animation.videoEditor.assets=[{id:"old-asset",name:"old.mp4",kind:"video",url:"blob:old-editor",thumbnailUrl:null,durationSeconds:4,width:1920,height:1080,hasAudio:true,waveform:[],bpm:null,beats:[],downbeats:[]}];
    useProjectStore.getState().setProject(previous,null);useAudioStore.setState({imported:{url:"blob:old-pro-subtitles",metadata:{path:"",fileName:"old.mp4",durationSeconds:4,sampleRate:48_000,channels:2,codec:"h264/aac",fileSize:3,hash:"old"},waveform:[]}});registerVideoEditorFiles(new Map([["old-asset",new File(["old"],"old.mp4",{type:"video/mp4"})]]));const revoke=vi.fn();Object.defineProperty(URL,"revokeObjectURL",{configurable:true,value:revoke});
    render(<StudioHome onEnterArea={vi.fn()}/>);fireEvent.click(screen.getByRole("button",{name:/Sound Animation/}));
    const clean=useProjectStore.getState().project;expect(clean.animation.proSubtitles).toMatchObject({videoUrl:null,videoName:"",cueStyles:[]});expect(clean.animation.videoEditor.assets).toEqual([]);expect(clean.subtitles.cues).toEqual([]);expect(useAudioStore.getState().imported).toBeNull();expect(videoEditorSessionFile("old-asset")).toBeNull();expect(revoke).toHaveBeenCalledWith("blob:old-editor");expect(revoke).toHaveBeenCalledWith("blob:old-pro-subtitles");
  });
});
