import type { CassetteDeskSettings } from "@rbs/project-schema";
import { cassetteDeskActiveNote, cassetteDeskSpectrumBars, cassetteDeskTimeline, type CassetteDeskAnalysis } from "./cassette-desk";

export interface CassetteDeskRenderInput { settings: CassetteDeskSettings; analysis: CassetteDeskAnalysis | null; timeSeconds: number; songDurationSeconds: number; }
const ease = (value: number) => value * value * (3 - 2 * value);
const rounded = (context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) => { context.beginPath(); context.roundRect(x, y, width, height, radius); };
const resolvedColor = (mode: "auto" | "manual", manual: string, automatic: string) => mode === "manual" ? manual : automatic;
const mixCassetteColor=(color:string,target:string,amount:number)=>{const parse=(value:string)=>{const match=value.match(/^#([\da-f]{6})$/i);return match?[0,2,4].map(offset=>parseInt(match[1]!.slice(offset,offset+2),16)):null;};const source=parse(color),destination=parse(target);if(!source||!destination)return color;return`#${source.map((channel,index)=>Math.round(channel+(destination[index]!-channel)*amount).toString(16).padStart(2,"0")).join("")}`;};
const elide = (context: CanvasRenderingContext2D, text: string, maxWidth: number) => { if (context.measureText(text).width <= maxWidth) return text; let value=text; while(value.length>1&&context.measureText(`${value}…`).width>maxWidth)value=value.slice(0,-1);return `${value}…`; };
export function readableCassetteTextColor(color:string){const match=color.trim().match(/^#([\da-f]{6})$/i);if(!match)return"#ffffff";const value=match[1]!;const channel=(offset:number)=>{const raw=parseInt(value.slice(offset,offset+2),16)/255;return raw<=.04045?raw/12.92:Math.pow((raw+.055)/1.055,2.4);};const luminance=.2126*channel(0)+.7152*channel(2)+.0722*channel(4);return luminance>.38?"#08090b":"#ffffff";}
export function cassetteCaseLidMatrix(openAmount:number){const open=Math.max(0,Math.min(1,openAmount));const horizontalScale=open<=.5?1-ease(open*2):-.12*ease((open-.5)*2);return{horizontalScale,verticalShear:-.08*Math.sin(open*Math.PI)};}
export function cassetteInsertionRotation(insertProgress:number){const progress=Math.max(0,Math.min(1,insertProgress));return(Math.PI/2-.075)*(1-ease(progress));}
export interface CassetteArtworkRect { x: number; y: number; width: number; height: number; }
export function fitCassetteArtwork(sourceWidth:number,sourceHeight:number,box:CassetteArtworkRect):CassetteArtworkRect{if(sourceWidth<=0||sourceHeight<=0||box.width<=0||box.height<=0)return{x:box.x,y:box.y,width:0,height:0};const scale=Math.min(box.width/sourceWidth,box.height/sourceHeight);const width=sourceWidth*scale,height=sourceHeight*scale;return{x:box.x+(box.width-width)/2,y:box.y+(box.height-height)/2,width,height};}
export function cassetteStereoBayRect(style:CassetteDeskSettings["stereoStyle"],stereo:CassetteArtworkRect):CassetteArtworkRect{return style==="poster"?{x:stereo.x+stereo.width*.35,y:stereo.y+stereo.height*.33,width:stereo.width*.3,height:stereo.height*.48}:{x:stereo.x+stereo.width*.29,y:stereo.y+stereo.height*.34,width:stereo.width*.42,height:stereo.height*.43};}
export function cassetteStereoDoorRect(bay:CassetteArtworkRect,openAmount:number):CassetteArtworkRect{const open=Math.max(0,Math.min(1,openAmount));return{x:bay.x,y:bay.y+bay.height*open*.66,width:bay.width,height:bay.height*(1-open*.66)};}
export function cassetteMugRect(width:number,height:number,horizon=height*.55):CassetteArtworkRect{const mugWidth=Math.min(width*.145,height*.11),mugHeight=Math.min(mugWidth*1.25,height*.13),baseY=horizon+height*.075;return{x:width*.5-mugWidth*.5,y:baseY-mugHeight,width:mugWidth,height:mugHeight};}
export interface CassettePianoKey { midi:number;kind:"white"|"black";x:number;width:number; }
const whitePitchClasses=new Set([0,2,4,5,7,9,11]);
export function cassettePianoLayout(startMidi=60,endMidi=71):CassettePianoKey[]{const whiteMidis=Array.from({length:Math.max(0,endMidi-startMidi+1)},(_,index)=>startMidi+index).filter(midi=>whitePitchClasses.has((midi%12+12)%12));if(!whiteMidis.length)return[];const whiteWidth=1/whiteMidis.length,blackWidth=whiteWidth*.58;const whites=whiteMidis.map((midi,index)=>({midi,kind:"white" as const,x:index*whiteWidth,width:whiteWidth}));const blacks=Array.from({length:Math.max(0,endMidi-startMidi+1)},(_,index)=>startMidi+index).filter(midi=>!whitePitchClasses.has((midi%12+12)%12)).flatMap(midi=>{const boundary=whiteMidis.filter(whiteMidi=>whiteMidi<midi).length;if(boundary<=0||boundary>=whiteMidis.length)return[];return[{midi,kind:"black" as const,x:boundary*whiteWidth-blackWidth/2,width:blackWidth}];});return[...whites,...blacks];}
export function cassettePianoKeyIsActive(keyMidi:number,activeMidi:number|null|undefined){return activeMidi!==null&&activeMidi!==undefined&&((keyMidi%12+12)%12===((activeMidi%12+12)%12));}
const italianNoteNames=["DO","DO♯","RE","RE♯","MI","FA","FA♯","SOL","SOL♯","LA","LA♯","SI"] as const;
export function cassettePianoNoteLabel(midi:number){return italianNoteNames[(midi%12+12)%12]??"—";}
const drawContainedArtwork=(context:CanvasRenderingContext2D,image:HTMLImageElement|null,box:CassetteArtworkRect,radius:number,backdrop:string)=>{context.fillStyle=backdrop;rounded(context,box.x,box.y,box.width,box.height,radius);context.fill();if(!image?.complete||!image.naturalWidth||!image.naturalHeight)return;context.save();rounded(context,box.x,box.y,box.width,box.height,radius);context.clip();const fitted=fitCassetteArtwork(image.naturalWidth,image.naturalHeight,box);context.drawImage(image,fitted.x,fitted.y,fitted.width,fitted.height);context.restore();};

export const CASSETTE_WINDOW_ENVIRONMENT_ATLAS_URL = "/cassette-desk/window-environments-v1.png";
const cassetteWindowEnvironmentOrder: readonly CassetteDeskSettings["windowEnvironment"][] = [
  "summer-day", "snow-day", "night", "rain-night", "starry-moon", "pink-moon", "pink-meteor"
];
export function cassetteWindowEnvironmentPanel(environment: CassetteDeskSettings["windowEnvironment"]): number {
  const panel = cassetteWindowEnvironmentOrder.indexOf(environment);
  return panel < 0 ? 4 : panel;
}
export function cassetteWindowEnvironmentEffect(environment:CassetteDeskSettings["windowEnvironment"]):"rain"|"snow"|null{return environment==="rain-night"?"rain":environment==="snow-day"?"snow":null;}

function drawEnvironmentAtlasPanel(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  environment: CassetteDeskSettings["windowEnvironment"],
  box: CassetteArtworkRect
): void {
  context.fillStyle = environment === "summer-day" || environment === "snow-day" ? "#9cb8c8" : "#071426";
  context.fillRect(box.x, box.y, box.width, box.height);
  if (!image?.complete || !image.naturalWidth || !image.naturalHeight) return;
  const sourceWidth = image.naturalWidth / cassetteWindowEnvironmentOrder.length;
  context.drawImage(
    image,
    sourceWidth * cassetteWindowEnvironmentPanel(environment), 0, sourceWidth, image.naturalHeight,
    box.x, box.y, box.width, box.height
  );
}

function traceMugSteamWisp(context:CanvasRenderingContext2D,mug:CassetteArtworkRect,height:number,timeSeconds:number,index:number):void{const rise=height*.165,baseX=mug.x+mug.width*(.3+index*.13),phase=timeSeconds*(.68+index*.04)+index*1.71;context.beginPath();for(let step=0;step<=24;step++){const progress=step/24,spread=mug.width*(.012+progress*.13),curl=Math.sin(phase+progress*4.8)*spread+Math.sin(phase*.61+progress*9.2)*spread*.25,drift=Math.sin(phase*.37)*mug.width*.045*progress*progress;const x=baseX+curl+drift,y=mug.y-progress*rise+Math.sin(phase+progress*3.7)*height*.0014;if(step===0)context.moveTo(x,y);else context.lineTo(x,y);}}

function drawMugSteam(context:CanvasRenderingContext2D,mug:CassetteArtworkRect,width:number,height:number,timeSeconds:number):void{const rise=height*.165,steamGradient=()=>{const gradient=context.createLinearGradient(0,mug.y,0,mug.y-rise);gradient.addColorStop(0,"rgba(255,255,255,.68)");gradient.addColorStop(.24,"rgba(244,249,250,.5)");gradient.addColorStop(.68,"rgba(225,235,239,.2)");gradient.addColorStop(1,"rgba(220,231,235,0)");return gradient;};context.save();context.globalCompositeOperation="screen";context.lineCap="round";context.lineJoin="round";for(const pass of[{blur:Math.max(6,Math.min(width,height)*.014),line:Math.max(7,width*.011),alpha:.18},{blur:Math.max(3,Math.min(width,height)*.006),line:Math.max(3,width*.0048),alpha:.28},{blur:Math.max(1.2,Math.min(width,height)*.0024),line:Math.max(1.2,width*.0018),alpha:.2}]){context.filter=`blur(${pass.blur}px)`;context.lineWidth=pass.line;context.strokeStyle=steamGradient();for(let index=0;index<4;index++){context.globalAlpha=pass.alpha*(.72+.28*Math.sin(timeSeconds*.8+index*1.9));traceMugSteamWisp(context,mug,height,timeSeconds,index);context.stroke();}}context.filter="none";for(let index=0;index<10;index++){const life=(timeSeconds*.115+index*.109)%1,phase=timeSeconds*.39+index*2.17,cx=mug.x+mug.width*(.5+Math.sin(phase)*(.06+life*.2)),cy=mug.y-height*(.018+life*.14),radius=mug.width*(.055+life*.12),puff=context.createRadialGradient(cx,cy,0,cx,cy,radius);puff.addColorStop(0,`rgba(255,255,255,${.19*(1-life)})`);puff.addColorStop(.5,`rgba(239,247,249,${.11*(1-life)})`);puff.addColorStop(1,"rgba(225,237,240,0)");context.globalAlpha=1;context.fillStyle=puff;context.beginPath();context.arc(cx,cy,radius,0,Math.PI*2);context.fill();}context.restore();}

function drawCassetteMug(context:CanvasRenderingContext2D,mug:CassetteArtworkRect,width:number,height:number,timeSeconds:number,accent:string):void{
  drawMugSteam(context,mug,width,height,timeSeconds);
  context.save();
  context.shadowColor="#0009";
  context.shadowBlur=height*.012;
  const porcelain=context.createLinearGradient(mug.x,mug.y,mug.x+mug.width,mug.y);
  porcelain.addColorStop(0,"#aaa6a1");
  porcelain.addColorStop(.38,"#fffdf5");
  porcelain.addColorStop(.72,"#e8e3da");
  porcelain.addColorStop(1,"#85817e");
  context.fillStyle=porcelain;
  context.beginPath();
  context.moveTo(mug.x+mug.width*.045,mug.y+mug.height*.045);
  context.quadraticCurveTo(mug.x,mug.y+mug.height*.08,mug.x+mug.width*.075,mug.y+mug.height*.91);
  context.quadraticCurveTo(mug.x+mug.width*.5,mug.y+mug.height,mug.x+mug.width*.925,mug.y+mug.height*.91);
  context.quadraticCurveTo(mug.x+mug.width,mug.y+mug.height*.08,mug.x+mug.width*.955,mug.y+mug.height*.045);
  context.closePath();
  context.fill();
  context.shadowColor="transparent";
  context.strokeStyle="#d7d2ca";
  context.lineWidth=Math.max(2,width*.004);
  context.beginPath();
  context.ellipse(mug.x+mug.width*.98,mug.y+mug.height*.45,mug.width*.28,mug.height*.25,0,-Math.PI/2,Math.PI/2);
  context.stroke();
  context.fillStyle="#f6f0e7";
  context.beginPath();
  context.ellipse(mug.x+mug.width*.5,mug.y+mug.height*.055,mug.width*.46,mug.height*.065,0,0,Math.PI*2);
  context.fill();
  context.fillStyle="#49352b";
  context.beginPath();
  context.ellipse(mug.x+mug.width*.5,mug.y+mug.height*.06,mug.width*.4,mug.height*.047,0,0,Math.PI*2);
  context.fill();
  context.strokeStyle="rgba(255,255,255,.72)";
  context.lineWidth=Math.max(1,width*.0018);
  context.stroke();
  context.fillStyle="#171218";
  context.textAlign="center";
  context.font=`900 ${Math.max(7,Math.min(width*.011,height*.01))}px ui-sans-serif`;
  context.fillText("my lonely",mug.x+mug.width*.5,mug.y+mug.height*.48,mug.width*.82);
  context.fillStyle=accent;
  context.fillText("soul music",mug.x+mug.width*.5,mug.y+mug.height*.64,mug.width*.82);
  context.textAlign="start";
  context.restore();
}

export class CassetteDeskRenderer {
  readonly canvas: HTMLCanvasElement; private context: CanvasRenderingContext2D | null; private input: CassetteDeskRenderInput | null = null; private width = 1; private height = 1; private image: HTMLImageElement | null = null; private imageUrl: string | null = null; private imagePromise: Promise<void> | null = null; private environmentImage: HTMLImageElement | null = null; private environmentPromise: Promise<void> | null = null; private disposed = false;
  constructor(canvas?: HTMLCanvasElement) { this.canvas = canvas ?? document.createElement("canvas"); this.context = this.canvas.getContext("2d"); }
  setExportSize(width: number, height: number) { this.width = Math.max(1, Math.round(width)); this.height = Math.max(1, Math.round(height)); this.canvas.width = this.width; this.canvas.height = this.height; }
  restorePreviewSize() { const box = this.canvas.getBoundingClientRect(); const dpr = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1; this.setExportSize((box.width || this.width) * dpr, (box.height || this.height) * dpr); }
  update(input: CassetteDeskRenderInput) { this.input = input; this.ensureImage(input.settings.coverImageUrl); this.ensureEnvironmentImage(); this.renderNow(input.timeSeconds); }
  private ensureImage(url: string | null) { if (url === this.imageUrl) return; this.imageUrl = url;this.image=null;this.imagePromise=null;if(!url){this.renderNow();return;}const image = new Image(); this.image = image; this.imagePromise = new Promise((resolve, reject) => { image.onload = () => { if(this.image===image)this.renderNow();resolve(); }; image.onerror = () => {if(this.image===image)this.image=null;reject(new Error("Immagine Cassette Desk non caricabile."));}; }); void this.imagePromise.catch(() => undefined); image.src = url; }
  private ensureEnvironmentImage() { if (this.environmentImage || this.environmentPromise) return; const image = new Image(); this.environmentImage = image; this.environmentPromise = new Promise((resolve, reject) => { image.onload = () => { if(this.environmentImage===image)this.renderNow();resolve(); }; image.onerror = () => {if(this.environmentImage===image)this.environmentImage=null;reject(new Error("Atlante ambienti Cassette Desk non caricabile."));}; }); void this.environmentPromise.catch(() => undefined); image.src = CASSETTE_WINDOW_ENVIRONMENT_ATLAS_URL; }
  async prepare() { if (this.disposed) throw new Error("Renderer Cassette Desk dismesso."); this.ensureImage(this.input?.settings.coverImageUrl ?? null); this.ensureEnvironmentImage(); await Promise.all([this.imagePromise,this.environmentPromise]); if (this.disposed) throw new Error("Renderer Cassette Desk dismesso."); }
  renderNow(timeSeconds = this.input?.timeSeconds ?? 0) {
    const context = this.context; const input = this.input; if (!context || !input) return; const { settings, analysis } = input; const timeline = cassetteDeskTimeline(timeSeconds, settings.introDurationSeconds); const palette = settings.palette; const waveformColor = resolvedColor(settings.waveformColorMode, settings.waveformColor, palette[2]);const displaySpectrumColor=resolvedColor(settings.displaySpectrumColorMode,settings.displaySpectrumColor,palette[2]);const stereoBodyColor=resolvedColor(settings.stereoBodyColorMode,settings.stereoBodyColor,palette[0]); const pianoColor = resolvedColor(settings.pianoColorMode, settings.pianoColor, palette[0]); const deskColor = resolvedColor(settings.deskColorMode, settings.deskColor, palette[1]); const w = this.width; const h = this.height; const landscape = w >= h;
    context.clearRect(0, 0, w, h);
    const daylight = settings.windowEnvironment === "summer-day" || settings.windowEnvironment === "snow-day";
    const wall = context.createLinearGradient(0, 0, 0, h);
    wall.addColorStop(0, daylight ? "#b7aea5" : "#37323e");
    wall.addColorStop(.58, daylight ? "#716867" : "#27222c");
    wall.addColorStop(1, mixCassetteColor(deskColor, "#171216", .35));
    context.fillStyle = wall;
    context.fillRect(0, 0, w, h);
    context.save();
    context.globalAlpha = daylight ? .11 : .2;
    context.fillStyle = palette[0];
    for (let i = 0; i < 100; i++) context.fillRect((i * 97) % w, (i * 53) % h, 1 + (i % 3 === 0 ? 1 : 0), 1);
    context.restore();

    // La finestra è realmente parte della scena: l'atlante mantiene la stessa
    // inquadratura in tutti gli ambienti, mentre vetro e meteo restano animati.
    const windowBox = landscape
      ? { x: w * .035, y: h * .045, width: w * .51, height: h * .42 }
      : { x: w * .055, y: h * .025, width: w * .89, height: h * .34 };
    context.save();
    context.shadowColor = "rgba(0,0,0,.62)";
    context.shadowBlur = Math.min(w, h) * .025;
    context.fillStyle = daylight ? "#e8e1d6" : "#171820";
    rounded(context, windowBox.x - w * .012, windowBox.y - h * .009, windowBox.width + w * .024, windowBox.height + h * .024, Math.min(w, h) * .01);
    context.fill();
    context.shadowColor = "transparent";
    rounded(context, windowBox.x, windowBox.y, windowBox.width, windowBox.height, Math.min(w, h) * .006);
    context.clip();
    drawEnvironmentAtlasPanel(context, this.environmentImage, settings.windowEnvironment, windowBox);
    if(!landscape&&(settings.windowEnvironment==="starry-moon"||settings.windowEnvironment==="pink-moon")){const moonX=windowBox.x+windowBox.width*.2,moonY=windowBox.y+windowBox.height*.2,moonRadius=Math.min(windowBox.width,windowBox.height)*.075;const moon=context.createRadialGradient(moonX-moonRadius*.25,moonY-moonRadius*.3,moonRadius*.05,moonX,moonY,moonRadius);moon.addColorStop(0,"#fffef2");moon.addColorStop(.58,settings.windowEnvironment==="pink-moon"?"#ef99bd":"#e9e5d8");moon.addColorStop(1,settings.windowEnvironment==="pink-moon"?"rgba(220,77,137,.1)":"rgba(234,238,242,.08)");context.fillStyle=moon;context.shadowColor=settings.windowEnvironment==="pink-moon"?palette[2]:"#dbe8ff";context.shadowBlur=moonRadius*.75;context.beginPath();context.arc(moonX,moonY,moonRadius,0,Math.PI*2);context.fill();context.shadowColor="transparent";}
    const glass = context.createLinearGradient(windowBox.x, windowBox.y, windowBox.x + windowBox.width, windowBox.y + windowBox.height);
    glass.addColorStop(0, "rgba(255,255,255,.24)"); glass.addColorStop(.3, "rgba(255,255,255,.025)"); glass.addColorStop(1, daylight ? "rgba(255,224,190,.08)" : "rgba(121,145,190,.12)");
    context.fillStyle = glass; context.fillRect(windowBox.x, windowBox.y, windowBox.width, windowBox.height);
    const windowEffect=cassetteWindowEnvironmentEffect(settings.windowEnvironment);
    if (windowEffect === "rain") {
      context.strokeStyle = "rgba(185,215,235,.42)"; context.lineWidth = Math.max(1, w * .0014);
      for (let i = 0; i < 36; i++) { const rx = windowBox.x + ((i * 67 + timeSeconds * 61) % 100) / 100 * windowBox.width; const ry = windowBox.y + ((i * 29 + timeSeconds * 123) % 100) / 100 * windowBox.height; context.beginPath(); context.moveTo(rx, ry); context.lineTo(rx - windowBox.width * .008, ry + windowBox.height * .07); context.stroke(); }
    } else if (windowEffect === "snow") {
      context.fillStyle = "rgba(255,255,255,.78)";
      for (let i = 0; i < 42; i++) { const sx = windowBox.x + ((i * 73 + Math.sin(timeSeconds * .7 + i) * 8) % 100 + 100) % 100 / 100 * windowBox.width; const sy = windowBox.y + ((i * 37 + timeSeconds * (5 + i % 4)) % 100) / 100 * windowBox.height; context.beginPath(); context.arc(sx, sy, Math.max(1, Math.min(w, h) * (.0012 + (i % 3) * .0006)), 0, Math.PI * 2); context.fill(); }
    }
    context.restore();
    context.strokeStyle = daylight ? "rgba(255,255,255,.72)" : "rgba(160,175,195,.42)"; context.lineWidth = Math.max(2, Math.min(w, h) * .006);
    context.beginPath(); context.moveTo(windowBox.x + windowBox.width * .5, windowBox.y); context.lineTo(windowBox.x + windowBox.width * .5, windowBox.y + windowBox.height); context.stroke();

    const horizon = h * .55;
    const desk = context.createLinearGradient(0, horizon, 0, h); desk.addColorStop(0, mixCassetteColor(deskColor, "#ffffff", .18)); desk.addColorStop(.28, deskColor); desk.addColorStop(1, mixCassetteColor(deskColor, "#080709", .52));
    context.fillStyle = desk; context.beginPath(); context.moveTo(0, horizon); context.lineTo(w, horizon * .94); context.lineTo(w, h); context.lineTo(0, h); context.closePath(); context.fill();
    context.save(); context.globalAlpha = .18; context.strokeStyle = mixCassetteColor(deskColor, "#ffffff", .55); context.lineWidth = Math.max(1, h * .001);
    for (let i = 0; i < 26; i++) { const y = horizon + (i / 25) * (h - horizon); context.beginPath(); context.moveTo(0, y + Math.sin(i * 1.7) * h * .003); context.bezierCurveTo(w * .3, y - h * .006, w * .7, y + h * .007, w, y); context.stroke(); }
    context.restore();

    // Fogli, penne e una lattina schiacciata aggiungono profondità alla scrivania.
    context.save(); context.translate(w * .12, horizon + h * .08); context.rotate(-.12); context.shadowColor = "#0006"; context.shadowBlur = h * .01; context.fillStyle = "#eee8dc"; context.fillRect(0, 0, w * .23, h * .17); context.shadowColor = "transparent"; context.strokeStyle = palette[1]; context.globalAlpha = .5; for (let i = 1; i < 6; i++) { context.beginPath(); context.moveTo(w * .02, h * .02 + i * h * .022); context.lineTo(w * .2, h * .02 + i * h * .022); context.stroke(); } context.restore();
    context.save(); context.translate(w * .76, horizon + h * .13); context.rotate(.2); const can = context.createLinearGradient(0, 0, w * .06, 0); can.addColorStop(0, "#721322"); can.addColorStop(.5, "#df3147"); can.addColorStop(1, "#5a101c"); context.fillStyle = can; rounded(context, 0, 0, w * .058, h * .13, w * .017); context.fill(); context.strokeStyle = "rgba(255,255,255,.55)"; context.beginPath(); context.moveTo(w * .008, h * .048); context.bezierCurveTo(w * .02, h * .063, w * .037, h * .038, w * .05, h * .056); context.stroke(); context.restore();
    context.save(); context.translate(w * .25, horizon + h * .28); context.rotate(-.32); context.fillStyle = palette[2]; rounded(context, 0, 0, w * .22, h * .012, h * .006); context.fill(); context.fillStyle = "rgba(255,255,255,.65)"; context.fillRect(w * .025, h * .002, w * .14, h * .002); context.restore();

    const stereo = { x: w * (landscape ? .47 : .3), y: h * .105, width: w * (landscape ? .47 : .64), height: h * .43 };
    const posterStereo=settings.stereoStyle==="poster";
    context.save(); context.shadowColor="#000c"; context.shadowBlur=Math.min(w,h)*.045; context.shadowOffsetY=h*.018;
    const body=context.createLinearGradient(stereo.x,stereo.y,stereo.x,stereo.y+stereo.height);
    if(posterStereo){body.addColorStop(0,mixCassetteColor(stereoBodyColor,"#ffffff",.78));body.addColorStop(.14,mixCassetteColor(stereoBodyColor,"#ffffff",.36));body.addColorStop(.58,stereoBodyColor);body.addColorStop(1,mixCassetteColor(stereoBodyColor,"#000000",.34));}
    else{body.addColorStop(0,"#676a70");body.addColorStop(.055,"#2b2e34");body.addColorStop(.48,"#17191e");body.addColorStop(1,"#07080b");}
    context.fillStyle=body; rounded(context,stereo.x,stereo.y,stereo.width,stereo.height,Math.min(w,h)*.025); context.fill(); context.restore();
    context.strokeStyle=posterStereo?"#25262b":"#858a94"; context.lineWidth=Math.max(1,w*.0015); context.stroke();
    context.save(); rounded(context,stereo.x,stereo.y,stereo.width,stereo.height,Math.min(w,h)*.025); context.clip();
    context.globalAlpha=posterStereo?.24:.11; context.strokeStyle=posterStereo?palette[2]:"#b6bac0"; context.lineWidth=Math.max(1,w*.00065);
    for(let i=0;i<34;i++){const sy=stereo.y+stereo.height*(.025+i/36);context.beginPath();context.moveTo(stereo.x,sy);context.lineTo(stereo.x+stereo.width,sy+(i%3-1)*h*.0008);context.stroke();}
    if(posterStereo){context.globalAlpha=.38;context.lineWidth=Math.max(1,w*.0011);for(let i=0;i<18;i++){const sx=stereo.x+stereo.width*(.04+((i*37)%89)/100),sy=stereo.y+stereo.height*(.1+((i*23)%74)/100);context.beginPath();context.moveTo(sx,sy);context.lineTo(sx+stereo.width*(.025+(i%4)*.014),sy-stereo.height*(.018+(i%3)*.012));context.lineTo(sx+stereo.width*(.04+(i%5)*.01),sy+stereo.height*.012);context.stroke();}context.globalAlpha=.9;context.fillStyle=palette[2];context.fillRect(stereo.x+stereo.width*.955,stereo.y+stereo.height*.13,stereo.width*.012,stereo.height*.67);}
    context.globalAlpha=.7; context.fillStyle=posterStereo?"#17181d":"#a5a8ad"; for(const px of[.035,.965])for(const py of[.045,.955]){context.beginPath();context.arc(stereo.x+stereo.width*px,stereo.y+stereo.height*py,Math.max(1,w*.002),0,Math.PI*2);context.fill();}
    context.restore();

    const speakerBands=timeline.musicStarted?cassetteDeskSpectrumBars(analysis,timeline.songTimeSeconds):Array(12).fill(0);
    const waveformPulse=timeline.musicStarted&&analysis?.waveform.length?Math.abs(analysis.waveform[Math.floor((timeline.songTimeSeconds*24)%analysis.waveform.length)]??0):0;
    const bassPulse=Math.max(waveformPulse,...speakerBands.slice(0,4));
    const beatPhase=timeline.musicStarted?Math.sin(timeline.songTimeSeconds*Math.PI*2*Math.max(.8,(analysis?.bpm??96)/60)):0;
    const drawSpeaker=(cx:number)=>{const baseCy=stereo.y+stereo.height*.59;const baseRadius=Math.min(stereo.width*.135,stereo.height*.29);const excursion=beatPhase*bassPulse*baseRadius*.055;const cy=baseCy+excursion;const radius=baseRadius*(1+bassPulse*.09);context.save();context.shadowColor=timeline.musicStarted?`${palette[2]}88`:"#000";context.shadowBlur=timeline.musicStarted?baseRadius*.2:baseRadius*.08;context.fillStyle="#050609";context.beginPath();context.arc(cx,baseCy,baseRadius*1.16,0,Math.PI*2);context.fill();context.shadowColor="transparent";const surround=context.createRadialGradient(cx,cy,radius*.56,cx,cy,radius);surround.addColorStop(0,"#353942");surround.addColorStop(.72,"#111318");surround.addColorStop(.9,"#52565e");surround.addColorStop(1,"#08090c");context.fillStyle=surround;context.beginPath();context.arc(cx,cy,radius,0,Math.PI*2);context.fill();const cone=context.createRadialGradient(cx-radius*.16,cy-radius*.2,0,cx,cy,radius*.75);cone.addColorStop(0,timeline.musicStarted?mixCassetteColor(palette[2],"#ffffff",.38):"#777b83");cone.addColorStop(.16,"#1a1c21");cone.addColorStop(.72,"#292c32");cone.addColorStop(1,"#08090c");context.fillStyle=cone;context.beginPath();context.arc(cx,cy,radius*.73,0,Math.PI*2);context.fill();context.strokeStyle=posterStereo?palette[2]:"#747880";context.lineWidth=Math.max(1,w*.0016);context.beginPath();context.arc(cx,cy,radius*.99,0,Math.PI*2);context.stroke();context.globalAlpha=.16;context.strokeStyle="#ffffff";context.lineWidth=Math.max(1,w*.00055);for(let ring=1;ring<=5;ring++){context.beginPath();context.arc(cx,cy,radius*(.12+ring*.13),0,Math.PI*2);context.stroke();}context.globalAlpha=1;context.fillStyle="#08090c";context.beginPath();context.arc(cx,cy-radius*1.48,radius*.27,0,Math.PI*2);context.fill();context.strokeStyle=posterStereo?palette[2]:"#6a6d72";context.stroke();context.restore();};
    drawSpeaker(stereo.x+stereo.width*.13);drawSpeaker(stereo.x+stereo.width*.87);
    const display={x:stereo.x+stereo.width*.235,y:stereo.y+stereo.height*.075,width:stereo.width*.53,height:stereo.height*.235};context.fillStyle="#050709";rounded(context,display.x,display.y,display.width,display.height,6);context.fill();context.strokeStyle=timeline.musicStarted?displaySpectrumColor:"#59645c";context.lineWidth=Math.max(1,w*.001);context.stroke();context.fillStyle="#f4f7f0";context.textAlign="center";context.font=`800 ${Math.max(11,Math.min(w*.018,h*.021))}px ui-sans-serif`;context.fillText(elide(context,settings.title||"UNTITLED TAPE",display.width*.88),display.x+display.width*.5,display.y+display.height*.25);context.globalAlpha=.9;context.font=`600 ${Math.max(8,Math.min(w*.0135,h*.015))}px ui-sans-serif`;context.fillText(elide(context,settings.artist||"UNKNOWN ARTIST",display.width*.88),display.x+display.width*.5,display.y+display.height*.47);context.globalAlpha=1;if(timeline.musicStarted){const bars=cassetteDeskSpectrumBars(analysis,timeline.songTimeSeconds),regionX=display.x+display.width*.08,regionY=display.y+display.height*.57,regionW=display.width*.84,regionH=display.height*.34,step=regionW/12,barW=step*.58;context.fillStyle=displaySpectrumColor;for(let index=0;index<12;index++){const energy=Math.max(.08,bars[index]??0);const barH=regionH*(.18+energy*.82);rounded(context,regionX+index*step+(step-barW)/2,regionY+regionH-barH,barW,barH,Math.min(3,barW*.3));context.fill();}}else{context.font=`700 ${Math.max(7,Math.min(w*.009,h*.01))}px ui-monospace`;context.fillText("TAPE READY",display.x+display.width*.5,display.y+display.height*.82);}context.textAlign="start";
    const bay=cassetteStereoBayRect(settings.stereoStyle,stereo);
    context.fillStyle="#050609";rounded(context,bay.x,bay.y,bay.width,bay.height,8);context.fill();context.strokeStyle=posterStereo?"#34363c":"#62666e";context.lineWidth=Math.max(2,w*.002);context.stroke();
    const installed=timeline.phase==="closing"||timeline.phase==="pressing"||timeline.musicStarted;
    if(installed){const cx=bay.x+bay.width*.5,cy=bay.y+bay.height*.5,cw=Math.min(stereo.width*.31,bay.width*.84),ch=cw*.62;const cassetteBody=context.createLinearGradient(cx-cw/2,cy-ch/2,cx+cw/2,cy+ch/2);cassetteBody.addColorStop(0,mixCassetteColor(palette[0],"#ffffff",.25));cassetteBody.addColorStop(.5,palette[0]);cassetteBody.addColorStop(1,mixCassetteColor(palette[0],"#000000",.28));context.fillStyle=cassetteBody;rounded(context,cx-cw/2,cy-ch/2,cw,ch,5);context.fill();context.strokeStyle="rgba(255,255,255,.36)";context.stroke();const installedLabelHeight=ch*.72,installedLabelWidth=installedLabelHeight*.75;drawContainedArtwork(context,this.image,{x:cx-installedLabelWidth/2,y:cy-installedLabelHeight/2,width:installedLabelWidth,height:installedLabelHeight},2,"#111318");context.fillStyle="#17191d";const rotation=timeline.songTimeSeconds*4;for(const side of[-1,1]){const reelX=cx+side*cw*.27;context.beginPath();context.arc(reelX,cy,cw*.085,0,Math.PI*2);context.fill();context.save();context.translate(reelX,cy);context.rotate(rotation*side);context.strokeStyle="#d8d8d3";context.lineWidth=Math.max(1,w*.0015);for(let spoke=0;spoke<3;spoke++){context.rotate(Math.PI*2/3);context.beginPath();context.moveTo(0,0);context.lineTo(cw*.07,0);context.stroke();}context.restore();}}
    // Sportello fold-down: sempre rettangolare e allineato al vano. L'apertura
    // è resa con scorciamento verticale e traslazione sul cardine, mai shear.
    const doorOpen=timeline.phase==="closing"?1-ease(timeline.phaseProgress):timeline.phase==="playing"||timeline.phase==="pressing"?0:1;
    const door=cassetteStereoDoorRect(bay,doorOpen);
    context.save();const doorGlass=context.createLinearGradient(door.x,door.y,door.x+door.width,door.y+door.height);doorGlass.addColorStop(0,posterStereo?"rgba(116,122,134,.62)":"rgba(92,98,107,.74)");doorGlass.addColorStop(.45,"rgba(20,23,29,.48)");doorGlass.addColorStop(1,posterStereo?"rgba(59,63,73,.78)":"rgba(37,41,48,.84)");context.fillStyle=doorGlass;rounded(context,door.x,door.y,door.width,door.height,Math.min(8,door.width*.035));context.fill();context.strokeStyle=palette[2];context.lineWidth=Math.max(1,w*.002);context.stroke();context.globalAlpha=.28;context.strokeStyle="#ffffff";context.beginPath();context.moveTo(door.x+door.width*.08,door.y+door.height*.13);context.lineTo(door.x+door.width*.85,door.y+door.height*.13);context.stroke();context.globalAlpha=1;context.fillStyle="#090a0d";for(const side of[.08,.92]){context.beginPath();context.arc(door.x+door.width*side,bay.y+bay.height,door.width*.026,0,Math.PI*2);context.fill();}context.restore();
    const buttonX=stereo.x+stereo.width*.76;const buttonY=stereo.y+stereo.height*.84;const pressed=timeline.phase==="pressing"?ease(timeline.phaseProgress):timeline.musicStarted?1:0;if(posterStereo){const radius=Math.min(stereo.width*.07,stereo.height*.08),cx=buttonX+radius,cy=buttonY+radius+pressed*h*.006;context.fillStyle="#101116";context.beginPath();context.arc(cx,cy,radius,0,Math.PI*2);context.fill();context.strokeStyle=palette[2];context.lineWidth=Math.max(2,w*.0025);context.stroke();context.fillStyle=palette[2];context.beginPath();context.moveTo(cx-radius*.22,cy-radius*.38);context.lineTo(cx+radius*.42,cy);context.lineTo(cx-radius*.22,cy+radius*.38);context.closePath();context.fill();}else{context.fillStyle=pressed?palette[2]:"#d8d9dc";rounded(context,buttonX,buttonY+pressed*h*.006,stereo.width*.12,stereo.height*.065,4);context.fill();context.fillStyle="#090a0d";context.font=`700 ${Math.max(7,w*.008)}px ui-monospace`;context.fillText("▶ PLAY",buttonX+4,buttonY+stereo.height*.045);}
    const caseX=w*(landscape?.2:.12),caseY=h*.47,caseW=Math.min(w*(landscape?.18:.3),h*.25),caseH=caseW*4/3;const openAmount=timeline.phase==="opening"?ease(timeline.phaseProgress):timeline.phase==="inserting"||timeline.phase==="closing"||timeline.phase==="pressing"||timeline.musicStarted?1:0;
    // Il fondo resta dietro alla cassetta. La cover viene disegnata sul coperchio
    // solo dopo la cassetta, così da nasconderla completamente a custodia chiusa.
    context.save();context.translate(caseX,caseY);context.rotate(-.075);context.shadowColor="#0009";context.shadowBlur=Math.min(w,h)*.018;context.fillStyle="#0d0e12";rounded(context,-caseW/2,-caseH/2,caseW,caseH,caseW*.045);context.fill();context.shadowColor="transparent";context.fillStyle="#202127";rounded(context,-caseW*.43,-caseH*.43,caseW*.86,caseH*.86,caseW*.025);context.fill();context.strokeStyle="rgba(240,247,246,.72)";context.lineWidth=Math.max(1,w*.002);rounded(context,-caseW/2,-caseH/2,caseW,caseH,caseW*.045);context.stroke();context.restore();
    if(openAmount>.45){context.save();context.translate(caseX,caseY);context.rotate(-.075);context.strokeStyle="rgba(255,255,255,.12)";context.lineWidth=Math.max(1,w*.0012);for(const cy of[-.21,.08,.27]){rounded(context,-caseW*.32,caseH*cy,caseW*.64,caseH*.09,caseW*.02);context.stroke();}context.fillStyle="#111217";for(const side of[-1,1]){context.beginPath();context.arc(side*caseW*.2,-caseH*.12,caseW*.105,0,Math.PI*2);context.fill();context.strokeStyle=palette[2];context.globalAlpha=.32;context.stroke();}context.restore();}
    const insertP=timeline.phase==="inserting"?ease(timeline.phaseProgress):timeline.phase==="closing"||timeline.phase==="pressing"||timeline.musicStarted?1:0;const cassetteX=caseX+(stereo.x+stereo.width*.5-caseX)*insertP;const cassetteY=caseY+(stereo.y+stereo.height*.53-caseY)*insertP-Math.sin(insertP*Math.PI)*h*.21;const cassetteRotation=cassetteInsertionRotation(insertP);const cassetteScale=1-insertP*.43;
    if(!timeline.musicStarted&&insertP<.92){const cw=caseW*.92*cassetteScale;const ch=cw*.62;context.save();context.translate(cassetteX,cassetteY);context.rotate(cassetteRotation);context.shadowColor="#0009";context.shadowBlur=Math.min(w,h)*.018;context.fillStyle=palette[0];rounded(context,-cw/2,-ch/2,cw,ch,cw*.055);context.fill();context.shadowColor="transparent";context.strokeStyle="#121318";context.lineWidth=Math.max(2,w*.003);context.stroke();const labelH=ch*.55,labelW=labelH*.75;drawContainedArtwork(context,this.image,{x:-labelW/2,y:-labelH*.62,width:labelW,height:labelH},3,"#17191d");context.fillStyle="#17191d";for(const side of[-1,1]){context.beginPath();context.arc(side*cw*.28,ch*.18,cw*.09,0,Math.PI*2);context.fill();context.strokeStyle="#a6a8aa";context.stroke();}context.restore();}
    context.save();context.translate(caseX,caseY);context.rotate(-.075);const lid=cassetteCaseLidMatrix(openAmount);context.translate(-caseW/2,0);context.transform(lid.horizontalScale,lid.verticalShear,0,1,0,0);context.fillStyle="#17181d";rounded(context,0,-caseH/2,caseW,caseH,caseW*.045);context.fill();drawContainedArtwork(context,this.image,{x:caseW*.05,y:-caseH*.45,width:caseW*.9,height:caseH*.9},caseW*.025,"#202127");context.fillStyle="rgba(218,228,230,.10)";rounded(context,0,-caseH/2,caseW,caseH,caseW*.045);context.fill();context.strokeStyle="rgba(240,247,246,.82)";context.lineWidth=Math.max(1,w*.002);context.stroke();context.restore();
    // La tazza è al centro del piano e viene composta dopo stereo e custodia:
    // corpo e vapore rimangono quindi sempre in primo piano e leggibili.
    const mug=cassetteMugRect(w,h,horizon);drawCassetteMug(context,mug,w,h,timeSeconds,palette[2]);
    const card={x:w*.045,y:h*.64,width:w*.91,height:h*.315};context.fillStyle="rgba(6,7,10,.93)";rounded(context,card.x,card.y,card.width,card.height,Math.min(w,h)*.022);context.fill();context.strokeStyle="rgba(255,255,255,.2)";context.lineWidth=Math.max(1,w*.001);context.stroke();const pad=card.width*.035;const titleY=card.y+card.height*.105;
    if(settings.showTrackInfo){const chipY=titleY;const chip=(label:string,value:string,x:number,color:string)=>{const fontSize=Math.max(12,Math.min(w*.019,h*.018)),height=Math.max(h*.048,fontSize*1.75);context.font=`900 ${fontSize}px ui-monospace`;const width=context.measureText(`${label}  ${value}`).width+pad*.75;context.fillStyle=color;rounded(context,x,chipY,width,height,height*.24);context.fill();context.strokeStyle="rgba(255,255,255,.34)";context.lineWidth=Math.max(1,w*.001);context.stroke();context.fillStyle=readableCassetteTextColor(color);context.fillText(`${label}  ${value}`,x+pad*.32,chipY+height*.68);return x+width+pad*.22;};let chipX=card.x+pad;chipX=chip("BPM",analysis?.bpm?analysis.bpm.toFixed(1):"—",chipX,palette[0]);chip("KEY",analysis?.keyLabel??"—",chipX,palette[2]);}
    if(settings.showWaveform){const waveform=analysis?.waveform??[];const x=card.x+pad,width=card.width-pad*2,center=card.y+card.height*.59;context.strokeStyle=waveformColor;context.lineWidth=Math.max(1,w*.002);context.beginPath();const columns=Math.min(520,Math.max(100,Math.floor(width/2.5)));for(let i=0;i<columns;i++){const sample=Math.abs(waveform[Math.floor(i/columns*waveform.length)]??.025);const amp=(.08+sample*.92)*card.height*.16*(timeline.musicStarted?1:.2);const px=x+i/(columns-1)*width;context.moveTo(px,center-amp);context.lineTo(px,center+amp);}context.stroke();const progress=timeline.musicStarted?Math.min(1,timeline.songTimeSeconds/Math.max(.001,input.songDurationSeconds)):0;context.fillStyle="#fff";context.fillRect(x+width*progress-1,center-card.height*.19,2,card.height*.38);}
    if(settings.showPiano){const pianoY=card.y+card.height*.755,pianoX=card.x+pad,pianoW=card.width-pad*2,keyH=card.height*.18;const active=cassetteDeskActiveNote(analysis,timeline.songTimeSeconds);const keyboard=cassettePianoLayout();context.save();context.shadowColor="#000b";context.shadowBlur=keyH*.18;const bed=context.createLinearGradient(pianoX,pianoY-keyH*.15,pianoX,pianoY+keyH*1.12);bed.addColorStop(0,"#3c2921");bed.addColorStop(.16,"#171316");bed.addColorStop(1,"#050608");context.fillStyle=bed;rounded(context,pianoX-pad*.16,pianoY-keyH*.13,pianoW+pad*.32,keyH*1.24,Math.min(9,keyH*.14));context.fill();context.shadowColor="transparent";context.strokeStyle="#5b4a42";context.lineWidth=Math.max(1,w*.001);context.stroke();for(const key of keyboard){if(key.kind!=="white")continue;const x=pianoX+key.x*pianoW,width=key.width*pianoW;const activeKey=cassettePianoKeyIsActive(key.midi,active?.midi);const ivory=context.createLinearGradient(x,pianoY,x,pianoY+keyH);if(activeKey){ivory.addColorStop(0,mixCassetteColor(pianoColor,"#ffffff",.48));ivory.addColorStop(.56,pianoColor);ivory.addColorStop(1,mixCassetteColor(pianoColor,"#000000",.22));}else{ivory.addColorStop(0,"#fffdf4");ivory.addColorStop(.55,"#eee9dc");ivory.addColorStop(1,"#bcb6aa");}context.fillStyle=ivory;context.fillRect(x+1,pianoY,width-2,keyH);context.strokeStyle="#6b6762";context.lineWidth=Math.max(1,w*.0007);context.strokeRect(x+1,pianoY,width-2,keyH);context.fillStyle=activeKey?"rgba(255,255,255,.5)":"rgba(255,255,255,.36)";context.fillRect(x+width*.14,pianoY+keyH*.05,width*.14,keyH*.82);context.fillStyle="rgba(30,25,26,.16)";rounded(context,x+width*.18,pianoY+keyH*.88,width*.64,keyH*.055,keyH*.02);context.fill();}for(const key of keyboard){if(key.kind!=="black")continue;const x=pianoX+key.x*pianoW,width=key.width*pianoW,activeKey=cassettePianoKeyIsActive(key.midi,active?.midi);context.shadowColor="#000b";context.shadowBlur=keyH*.08;context.shadowOffsetY=keyH*.035;const ebony=context.createLinearGradient(x,pianoY,x+width,pianoY+keyH*.64);if(activeKey){ebony.addColorStop(0,mixCassetteColor(pianoColor,"#ffffff",.36));ebony.addColorStop(.5,pianoColor);ebony.addColorStop(1,mixCassetteColor(pianoColor,"#000000",.36));}else{ebony.addColorStop(0,"#4b4c51");ebony.addColorStop(.22,"#191a1e");ebony.addColorStop(1,"#050507");}context.fillStyle=ebony;rounded(context,x,pianoY,width,keyH*.64,Math.min(4,width*.12));context.fill();context.shadowColor="transparent";context.fillStyle="rgba(255,255,255,.18)";rounded(context,x+width*.14,pianoY+keyH*.035,width*.2,keyH*.46,2);context.fill();}context.restore();}
    context.save(); context.globalAlpha=.22; context.fillStyle="#000"; context.fillRect(0,0,w,h*.018); context.restore();
  }
  dispose() { this.disposed=true; if(this.image){this.image.onload=null;this.image.onerror=null;} if(this.environmentImage){this.environmentImage.onload=null;this.environmentImage.onerror=null;} this.image=null;this.environmentImage=null;this.context=null;this.input=null; }
}
