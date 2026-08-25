import { beforeEach,describe,expect,it,vi } from "vitest";
const offline=vi.hoisted(()=>({exportOfflineSceneVideo:vi.fn()}));
vi.mock("./offline-video-exporter",()=>offline);
import { exportCassetteDeskOfflineVideo } from "./cassette-desk-offline-exporter";
const renderer={canvas:{} as HTMLCanvasElement,setExportSize:vi.fn(),restorePreviewSize:vi.fn(),renderNow:vi.fn(),prepare:vi.fn()};
const base={width:1080,height:1920,fps:30,aspectRatio:"9:16" as const,songDurationSeconds:60,introDurationSeconds:4.8,sourceUrl:"blob:song",projectName:"Tape",quality:"maximum" as const,renderer};
describe("Cassette Desk offline audio",()=>{beforeEach(()=>{vi.clearAllMocks();offline.exportOfflineSceneVideo.mockResolvedValue({fileName:"tape.mp4"});});it.each([[true,true],[false,false]])("threads song audio=%s while keeping mechanical effects",async(includeSongAudio,expected)=>{await exportCassetteDeskOfflineVideo({...base,includeSongAudio},new AbortController().signal);expect(offline.exportOfflineSceneVideo).toHaveBeenCalledWith(expect.objectContaining({audioLeadIn:expect.objectContaining({includeSourceAudio:expected,events:expect.arrayContaining([expect.objectContaining({kind:"slide"}),expect.objectContaining({kind:"door"}),expect.objectContaining({kind:"play"})])})}),renderer,expect.any(Function),expect.any(AbortSignal),expect.any(Function));});});
