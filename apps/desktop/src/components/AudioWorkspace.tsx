import { useEffect, useRef, useState } from "react";
import { releaseImportedAudio } from "../services/audio-import";
import {
  correctAudioTranscript,
  downloadAudioText,
  exportAudioArtifact,
  selectAudioToolMedia,
  transcriptAsSrt,
  transcriptAsVtt,
  transcribeAudioMedia,
  type AudioToolMedia,
} from "../services/audio-tools";
import { separateCassetteDeskVocals } from "../services/cassette-desk-vocals";
import {
  subtitleTranscriptJson,
  whisperModelOptions,
  type WhisperModelId,
  type WhisperTranscriptDocument,
} from "../services/subtitle-generation";
import { uiCopy, useUiPreferences } from "../services/ui-preferences";
import { SupportArtistButton } from "./ArtistSupport";
import { MemoryButton } from "./MemoryStudio";
import { SettingsButton } from "./StudioSettings";

type Tab = "transcribe" | "vocals";
const languages = [["it", "Italiano"], ["en", "English"], ["es", "Español"], ["fr", "Français"], ["de", "Deutsch"], ["pt", "Português"], ["auto", "Automatico"]] as const;
const copy = {
  it: {
    eyebrow: "Produzione e analisi vocale",
    title: "Audio",
    description: "Trascrizione professionale e isolamento della voce, interamente in locale.",
    transcribe: "Da audio a testo / SRT",
    vocals: "Estrai voce",
    replace: "Sostituisci file",
    language: "Lingua",
    model: "Modello Whisper",
    reference: "Testo originale · opzionale",
    referenceHint: "Se presente, Qwen corregge parole e punteggiatura mantenendo i timestamp misurati da Whisper.",
    start: "Trascrivi",
    cancel: "Annulla",
    result: "Risultato",
    plainText: "Testo",
    downloadSrt: "Scarica SRT",
    downloadVtt: "Scarica VTT",
    downloadTxt: "Scarica TXT",
    downloadJson: "Scarica JSON Whisper completo",
    vocalHint: "Demucs htdemucs separa realmente la voce da musica e altri suoni. L’originale non viene modificato.",
    separate: "Estrai voce",
    downloadVocal: "Scarica voce WAV",
    home: "Home",
    working: "Operazione in corso",
    ready: "Pronto",
  },
  en: {
    eyebrow: "Voice production and analysis",
    title: "Audio",
    description: "Professional transcription and vocal isolation, running locally.",
    transcribe: "Audio to text / SRT",
    vocals: "Extract vocals",
    replace: "Replace file",
    language: "Language",
    model: "Whisper model",
    reference: "Original text · optional",
    referenceHint: "When provided, Qwen corrects words and punctuation while keeping timestamps measured by Whisper.",
    start: "Transcribe",
    cancel: "Cancel",
    result: "Result",
    plainText: "Text",
    downloadSrt: "Download SRT",
    downloadVtt: "Download VTT",
    downloadTxt: "Download TXT",
    downloadJson: "Download full Whisper JSON",
    vocalHint: "Demucs htdemucs genuinely separates vocals from music and other sounds. The original is never modified.",
    separate: "Extract vocals",
    downloadVocal: "Download vocal WAV",
    home: "Home",
    working: "Operation running",
    ready: "Ready",
  },
} as const;

function MediaPicker({ media, onPick, label }: { media: AudioToolMedia | null; onPick: (value: AudioToolMedia) => void; label: string }) {
  const [picking, setPicking] = useState(false);
  return <div className="audio-media-picker">
    <button disabled={picking} onClick={() => {
      setPicking(true);
      void selectAudioToolMedia().then((value) => { if (value) onPick(value); }).finally(() => setPicking(false));
    }}>{picking ? "…" : media ? label : "＋"} {media?.name ?? ""}</button>
    {media ? <small>{media.durationSeconds.toFixed(2)} s</small> : null}
  </div>;
}

function Progress({ value, message }: { value: number; message: string }) {
  return <div className="audio-job-progress" role="status"><div><i style={{ width: `${Math.round(value * 100)}%` }} /></div><span>{message}</span></div>;
}

export function AudioWorkspace({ onHome }: { onHome?: () => void }) {
  const { language: uiLanguage, theme, setLanguage, setTheme } = useUiPreferences();
  const t = copy[uiLanguage];
  const [tab, setTab] = useState<Tab>("transcribe");
  const [media, setMedia] = useState<AudioToolMedia | null>(null);
  const [language, setSpeechLanguage] = useState("it");
  const [model, setModel] = useState<WhisperModelId>("whisper-medium_timestamped");
  const [reference, setReference] = useState("");
  const [transcript, setTranscript] = useState<WhisperTranscriptDocument | null>(null);
  const [status, setStatus] = useState<string>(t.ready);
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [vocalResult, setVocalResult] = useState<{ path: string; url: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const mediaRef = useRef<AudioToolMedia | null>(null);

  useEffect(() => () => {
    abort.current?.abort();
    releaseImportedAudio(mediaRef.current?.imported ?? null);
  }, []);

  const replaceMedia = (value: AudioToolMedia) => {
    if (media) releaseImportedAudio(media.imported);
    mediaRef.current = value;
    setMedia(value);
    setTranscript(null);
    setVocalResult(null);
    setStatus(t.ready);
  };
  const runTranscription = async () => {
    if (!media || running) return;
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setTranscript(null);
    try {
      let result = await transcribeAudioMedia(media, { language, model, signal: controller.signal, onProgress: (value) => { setProgress(value.progress); setStatus(value.message); } });
      if (reference.trim()) result = await correctAudioTranscript(result, reference, setStatus);
      setTranscript(result);
      setProgress(1);
      setStatus(`${result.words.length} timestamp Whisper`);
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) setStatus(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRunning(false);
      abort.current = null;
    }
  };
  const separate = async () => {
    if (!media || running) return;
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setVocalResult(null);
    try {
      const result = await separateCassetteDeskVocals(media.imported, controller.signal, (value, message) => { setProgress(value); setStatus(message); });
      const url = result.stemPath.startsWith("/") && result.stemPath.includes("__mlsm")
        ? result.stemPath
        : result.stemPath.startsWith("browser:")
          ? result.stemPath
          : await import("@tauri-apps/api/core").then((module) => module.convertFileSrc(result.stemPath));
      setVocalResult({ path: result.stemPath, url });
      setProgress(1);
      setStatus("Voce isolata con Demucs htdemucs");
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) setStatus(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRunning(false);
      abort.current = null;
    }
  };

  return <div className="audio-workspace">
    <header className="audio-toolbar">
      <div className="brand"><img className="brand-mark" src="/mlsm-studio-favicon-192.png" alt="" /><span className="brand-copy"><strong>MLSM Studio</strong><small>My Lonely Soul Music</small></span></div>
      {onHome ? <button onClick={onHome}>⌂ {t.home}</button> : null}
      <span className="audio-toolbar-spacer" />
      <SettingsButton />
      <MemoryButton compact />
      <SupportArtistButton compact />
      <label><span>{uiCopy[uiLanguage].language}</span><select value={uiLanguage} onChange={(event) => setLanguage(event.target.value === "en" ? "en" : "it")}><option value="it">IT</option><option value="en">EN</option></select></label>
      <button onClick={() => setTheme(theme === "day" ? "night" : "day")}>{theme === "day" ? "☼" : "◐"}</button>
    </header>
    <main>
      <section className="audio-hero"><small>{t.eyebrow}</small><h1>{t.title}</h1><p>{t.description}</p></section>
      <nav className="audio-tabs">{(["transcribe", "vocals"] as Tab[]).map((id) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{t[id]}</button>)}</nav>
      {tab === "transcribe" ? <section className="audio-tool-card">
        <MediaPicker media={media} onPick={replaceMedia} label={t.replace} />
        <div className="audio-form-grid">
          <label>{t.language}<select value={language} onChange={(event) => setSpeechLanguage(event.target.value)}>{languages.map((item) => <option key={item[0]} value={item[0]}>{item[1]}</option>)}</select></label>
          <label>{t.model}<select value={model} onChange={(event) => setModel(event.target.value as WhisperModelId)}>{whisperModelOptions.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.localSize}</option>)}</select></label>
        </div>
        <label>{t.reference}<textarea rows={5} value={reference} onChange={(event) => setReference(event.target.value)} /><small>{t.referenceHint}</small></label>
        <button className="audio-primary" disabled={!media || running} onClick={() => void runTranscription()}>{running ? t.working : t.start}</button>
        {transcript ? <div className="audio-result"><h2>{t.result}</h2><textarea aria-label={t.plainText} readOnly rows={9} value={transcript.transcript} /><div className="audio-actions"><button onClick={() => downloadAudioText("subtitles.srt", transcriptAsSrt(transcript), "application/x-subrip")}>{t.downloadSrt}</button><button onClick={() => downloadAudioText("subtitles.vtt", transcriptAsVtt(transcript), "text/vtt")}>{t.downloadVtt}</button><button onClick={() => downloadAudioText("transcript.txt", transcript.transcript, "text/plain")}>{t.downloadTxt}</button><button onClick={() => downloadAudioText("whisper-complete.json", subtitleTranscriptJson(transcript), "application/json")}>{t.downloadJson}</button></div><details><summary>JSON</summary><pre>{subtitleTranscriptJson(transcript)}</pre></details></div> : null}
      </section> : null}
      {tab === "vocals" ? <section className="audio-tool-card">
        <p>{t.vocalHint}</p>
        <MediaPicker media={media} onPick={replaceMedia} label={t.replace} />
        <button className="audio-primary" disabled={!media || running} onClick={() => void separate()}>{running ? t.working : t.separate}</button>
        {vocalResult ? <div className="audio-result"><audio controls src={vocalResult.url} /><button onClick={() => void exportAudioArtifact(vocalResult.path, vocalResult.url, "mlsm-vocals.wav")}>{t.downloadVocal}</button></div> : null}
      </section> : null}
      {running ? <Progress value={progress} message={status} /> : <p className="audio-status">{status}</p>}
    </main>
  </div>;
}
