import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createProject } from "@rbs/project-schema";
import { useProjectStore } from "../store/project-store";
import { CassetteDeskInspector } from "./CassetteDeskInspector";

describe("CassetteDeskInspector",()=>{
  beforeEach(()=>useProjectStore.getState().setProject(createProject(),null));
  afterEach(cleanup);
  it("offers half-time plus exact manual BPM and key overrides",()=>{
    render(<CassetteDeskInspector aspectRatio="9:16" onAspectRatio={()=>undefined}/>);
    const halfTime=screen.getByLabelText("Half Time (BPM ÷ 2)");expect(halfTime.closest("label")).toHaveClass("cassette-toggle");fireEvent.click(halfTime);
    fireEvent.change(screen.getByLabelText("Origine BPM"),{target:{value:"manual"}});
    fireEvent.change(screen.getByLabelText("BPM manuale"),{target:{value:"121.5"}});
    fireEvent.change(screen.getByLabelText("Origine tonalità"),{target:{value:"manual"}});
    fireEvent.change(screen.getByLabelText("Tonica manuale"),{target:{value:"9"}});
    fireEvent.change(screen.getByLabelText("Modo manuale"),{target:{value:"major"}});
    expect(screen.getByRole("option",{name:"Major"})).toBeInTheDocument();expect(screen.getByRole("option",{name:"Minor"})).toBeInTheDocument();expect(screen.getByLabelText("BPM e tonalità").closest("label")).toHaveClass("cassette-toggle");
    expect(useProjectStore.getState().project.animation.cassetteDesk).toMatchObject({halfTime:true,tempoDetectionMode:"manual",manualBpm:121.5,keyDetectionMode:"manual",manualKeyRoot:9,manualKeyMode:"major"});
  });
  it("keeps both stereo designs selectable and persisted",()=>{
    render(<CassetteDeskInspector aspectRatio="9:16" onAspectRatio={()=>undefined}/>);
    expect(screen.getByRole("option",{name:"Classico scuro"})).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Versione stereo"),{target:{value:"poster"}});
    const paletteToggle=screen.getByLabelText("Scocca stereo Hi-Fi dalla palette");
    expect(paletteToggle).toBeChecked();fireEvent.click(paletteToggle);
    fireEvent.change(screen.getByLabelText("Colore Scocca stereo Hi-Fi"),{target:{value:"#f4f1ea"}});
    expect(useProjectStore.getState().project.animation.cassetteDesk).toMatchObject({stereoStyle:"poster",stereoBodyColorMode:"manual",stereoBodyColor:"#f4f1ea"});
  });
});
