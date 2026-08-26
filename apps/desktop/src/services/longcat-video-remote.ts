import { Client, handle_file } from "@gradio/client";
import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { chooseLongCatInput, getLongCatBrowserInputFile, type LongCatVideoJob, type LongCatVideoMode, type LongCatVideoResult, type LongCatVideoStartRequest } from "./longcat-video-native";

export const LONGCAT_COLAB_NOTEBOOK_URL = "https://colab.research.google.com/drive/1-Dcjc4S6GCLhbN4N8qujhzzWBFyG6Bz0?usp=sharing";
export const LONGCAT_REMOTE_STORAGE_KEY = "mlsm.longcat.remote-endpoints.v1";

export interface LongCatRemoteEndpoint { id:string;label:string;url:string;enabled:boolean }
export interface LongCatRemoteCapabilities {
  protocolVersion:number;service:string;ready:boolean;busy:boolean;gpuName:string|null;revision:string;reason:string|null;
  modes:string[];limits:{maxInputBytes:number;maxFrames:number;maxActiveJobs:number};
}
export interface LongCatRemoteEndpointStatus { endpoint:LongCatRemoteEndpoint;ok:boolean;capabilities:LongCatRemoteCapabilities|null;error?:string }

interface ParsedEndpoint { baseUrl:string;token:string }
interface GradioFileResult { url?:string;path?:string;orig_name?:string;mime_type?:string }
const remoteBrowserInputFiles=new Map<string,File>();
function rememberRemoteInput(key:string,file:File):void{remoteBrowserInputFiles.set(key,file);while(remoteBrowserInputFiles.size>4)remoteBrowserInputFiles.delete(remoteBrowserInputFiles.keys().next().value as string);}

function errorMessage(error:unknown):string{return error instanceof Error?error.message:String(error);}
function abortError(signal?:AbortSignal):DOMException|null{return signal?.aborted?new DOMException("Operazione annullata","AbortError"):null;}
function endpointId():string{return globalThis.crypto?.randomUUID?.()??`longcat-${Date.now()}-${Math.random().toString(36).slice(2)}`;}

export function normalizeLongCatRemoteEndpoint(value:string):string{
  try{const url=new URL(value.trim());url.hash="";url.search="";return url.toString().replace(/\/$/,"");}catch{return value.trim().split("#")[0]?.replace(/\/$/,"")??"";}
}
export function parseLongCatRemoteEndpoint(value:string):ParsedEndpoint{
  let url:URL;try{url=new URL(value.trim());}catch{throw new Error("Inserisci un URL Colab completo con https://");}
  if(url.protocol!=="https:"&&url.protocol!=="http:")throw new Error("Il collegamento Colab deve usare HTTP o HTTPS");
  const token=new URLSearchParams(url.hash.replace(/^#/,"")).get("mlsm-token")?.trim()??"";
  if(!token)throw new Error("Il link non contiene #mlsm-token. Copia l’intera stringa stampata dal notebook.");
  url.hash="";url.search="";
  return{baseUrl:url.toString().replace(/\/$/,""),token};
}

export function loadLongCatRemoteEndpoints(storage:Pick<Storage,"getItem">=localStorage):LongCatRemoteEndpoint[]{
  try{const raw=JSON.parse(storage.getItem(LONGCAT_REMOTE_STORAGE_KEY)??"[]") as unknown;if(!Array.isArray(raw))return[];return raw.flatMap((item):LongCatRemoteEndpoint[]=>{if(!item||typeof item!=="object")return[];const value=item as Partial<LongCatRemoteEndpoint>;if(typeof value.id!=="string"||typeof value.label!=="string"||typeof value.url!=="string"||typeof value.enabled!=="boolean")return[];return[{id:value.id,label:value.label.slice(0,80),url:value.url.slice(0,2048),enabled:value.enabled}];}).slice(0,12);}catch{return[];}
}
export function saveLongCatRemoteEndpoints(endpoints:LongCatRemoteEndpoint[],storage:Pick<Storage,"setItem">=localStorage):void{storage.setItem(LONGCAT_REMOTE_STORAGE_KEY,JSON.stringify(endpoints.slice(0,12)));}
export function createLongCatRemoteEndpoint(url:string,index:number):LongCatRemoteEndpoint{parseLongCatRemoteEndpoint(url);return{id:endpointId(),label:`Colab ${index+1}`,url:url.trim(),enabled:true};}

async function withAbort<T>(promise:Promise<T>,signal?:AbortSignal,onAbort?:()=>void):Promise<T>{
  const aborted=abortError(signal);if(aborted)throw aborted;if(!signal)return promise;
  return new Promise<T>((resolve,reject)=>{const stop=()=>{onAbort?.();reject(new DOMException("Operazione annullata","AbortError"));};signal.addEventListener("abort",stop,{once:true});promise.then(value=>{signal.removeEventListener("abort",stop);resolve(value);},error=>{signal.removeEventListener("abort",stop);reject(error);});});
}
function dataValue<T>(result:{data?:unknown}):T{if(!Array.isArray(result.data)||result.data.length<1)throw new Error("Risposta Gradio LongCat vuota");const value=result.data[0];if(typeof value==="string"){try{return JSON.parse(value) as T;}catch{/* JSON components normally return objects */}}return value as T;}
async function connect(endpoint:LongCatRemoteEndpoint,signal?:AbortSignal):Promise<{client:Client;parsed:ParsedEndpoint}>{const parsed=parseLongCatRemoteEndpoint(endpoint.url);const client=await withAbort(Client.connect(parsed.baseUrl,{events:["data","status"],record_history:false}),signal);return{client,parsed};}

function validateCapabilities(value:LongCatRemoteCapabilities):LongCatRemoteCapabilities{
  if(!value||value.protocolVersion!==1||value.service!=="mlsm-longcat-remote"||typeof value.ready!=="boolean"||typeof value.busy!=="boolean"||!Array.isArray(value.modes))throw new Error("Endpoint non compatibile con MLSM LongCat Remote");
  return value;
}
export async function checkLongCatRemoteEndpoint(endpoint:LongCatRemoteEndpoint,signal?:AbortSignal):Promise<LongCatRemoteEndpointStatus>{
  let client:Client|null=null;try{const connection=await connect(endpoint,signal);client=connection.client;const result=await withAbort(client.predict("/longcat_capabilities",[connection.parsed.token]),signal,()=>client?.close());return{endpoint,ok:true,capabilities:validateCapabilities(dataValue<LongCatRemoteCapabilities>(result))};}catch(error){const aborted=abortError(signal);if(aborted)throw aborted;return{endpoint,ok:false,capabilities:null,error:errorMessage(error)};}finally{client?.close();}
}
export async function checkLongCatRemoteEndpoints(endpoints:LongCatRemoteEndpoint[],signal?:AbortSignal):Promise<LongCatRemoteEndpointStatus[]>{
  const active=endpoints.filter(item=>item.enabled);const results=await Promise.allSettled(active.map(endpoint=>checkLongCatRemoteEndpoint(endpoint,signal)));const aborted=abortError(signal);if(aborted)throw aborted;return results.map((result,index)=>result.status==="fulfilled"?result.value:{endpoint:active[index]!,ok:false,capabilities:null,error:errorMessage(result.reason)});
}

function remotePayload(request:LongCatVideoStartRequest):Record<string,unknown>{const payload={...request} as Record<string,unknown>;delete payload.outputDirectory;delete payload.inputPath;return payload;}
function basename(path:string):string{return path.split(/[\\/]/).at(-1)??"source";}
async function inputFile(request:LongCatVideoStartRequest):Promise<File|null>{
  if(request.mode==="textToVideo")return null;const browserFile=remoteBrowserInputFiles.get(request.inputPath)??getLongCatBrowserInputFile(request.inputPath);if(browserFile)return browserFile;
  if(!isTauri())throw new Error("Il file sorgente remoto non è più disponibile: selezionalo di nuovo.");
  const response=await fetch(convertFileSrc(request.inputPath));if(!response.ok)throw new Error(`Lettura sorgente locale fallita: HTTP ${response.status}`);const blob=await response.blob();return new File([blob],basename(request.inputPath),blob.type?{type:blob.type}:undefined);
}

export async function chooseRemoteLongCatInput(mode:Exclude<LongCatVideoMode,"textToVideo">):Promise<string|null>{
  if(isTauri())return chooseLongCatInput(mode);
  return new Promise((resolve)=>{const input=document.createElement("input");input.type="file";input.accept=mode==="imageToVideo"?"image/png,image/jpeg,image/webp":"video/mp4,video/quicktime,video/webm,.mkv";input.addEventListener("cancel",()=>resolve(null),{once:true});input.onchange=()=>{const file=input.files?.[0];if(!file){resolve(null);return;}const key=`mlsm-remote-input:${endpointId()}:${encodeURIComponent(file.name)}`;rememberRemoteInput(key,file);resolve(key);};input.click();});
}

export async function startRemoteLongCatVideoJob(endpoint:LongCatRemoteEndpoint,request:LongCatVideoStartRequest,signal?:AbortSignal):Promise<LongCatVideoJob>{
  const source=await inputFile(request);const aborted=abortError(signal);if(aborted)throw aborted;let client:Client|null=null;
  try{const connection=await connect(endpoint,signal);client=connection.client;const result=await withAbort(client.predict("/longcat_start",[connection.parsed.token,JSON.stringify(remotePayload(request)),source?handle_file(source):null]),signal,()=>client?.close());return dataValue<LongCatVideoJob>(result);}finally{client?.close();}
}
async function remoteJobCall(endpoint:LongCatRemoteEndpoint,api:string,jobId:string,signal?:AbortSignal):Promise<LongCatVideoJob>{let client:Client|null=null;try{const connection=await connect(endpoint,signal);client=connection.client;const result=await withAbort(client.predict(api,[connection.parsed.token,jobId]),signal,()=>client?.close());return dataValue<LongCatVideoJob>(result);}finally{client?.close();}}
export const getRemoteLongCatVideoJob=(endpoint:LongCatRemoteEndpoint,jobId:string,signal?:AbortSignal)=>remoteJobCall(endpoint,"/longcat_get",jobId,signal);
export const cancelRemoteLongCatVideoJob=(endpoint:LongCatRemoteEndpoint,jobId:string,signal?:AbortSignal)=>remoteJobCall(endpoint,"/longcat_cancel",jobId,signal);

async function resultFile(endpoint:LongCatRemoteEndpoint,jobId:string,signal?:AbortSignal):Promise<Blob>{let client:Client|null=null;try{const connection=await connect(endpoint,signal);client=connection.client;const result=await withAbort(client.predict("/longcat_result",[connection.parsed.token,jobId]),signal,()=>client?.close());const file=dataValue<GradioFileResult|string>(result);const value=typeof file==="string"?file:file?.url||file?.path;if(!value)throw new Error("Gradio non ha restituito il file MP4");const url=new URL(value,`${connection.parsed.baseUrl}/`).toString();const response=await withAbort(fetch(url),signal);if(!response.ok)throw new Error(`Download risultato Colab fallito: HTTP ${response.status}`);const blob=await response.blob();if(!blob.size)throw new Error("Il risultato Colab è vuoto");return blob;}finally{client?.close();}}

export async function materializeRemoteLongCatResult(endpoint:LongCatRemoteEndpoint,job:LongCatVideoJob,outputDirectory:string,signal?:AbortSignal):Promise<LongCatVideoJob>{
  if(job.status!=="completed"||!job.result)throw new Error("Il risultato remoto non è pronto");const blob=await resultFile(endpoint,job.jobId,signal);const filename=`longcat-remote-${job.jobId}.mp4`;let path:string;
  if(isTauri()){const payload=Array.from(new Uint8Array(await blob.arrayBuffer()));path=await invoke<string>("longcat_video_write_remote_result",{directoryPath:outputDirectory,filename,payload});}else{path=URL.createObjectURL(blob);}
  return{...job,result:{...(job.result as LongCatVideoResult),path}};
}
export function revokeRemoteLongCatResult(path:string|undefined):void{if(path?.startsWith("blob:"))URL.revokeObjectURL(path);}

export async function openLongCatColabNotebook():Promise<void>{if(isTauri()){await invoke("longcat_video_open_colab");return;}const opened=window.open(LONGCAT_COLAB_NOTEBOOK_URL,"_blank","noopener,noreferrer");if(!opened)throw new Error("Il browser ha bloccato l’apertura del notebook Colab.");}
