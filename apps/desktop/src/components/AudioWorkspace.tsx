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
  type AudioTranscriptReviewer,
} from "../services/audio-tools";
import { separateCassetteDeskVocals } from "../services/cassette-desk-vocals";
import {
  subtitleTranscriptJson,
  whisperModelOptions,
  type WhisperModelId,
  type WhisperTranscriptDocument,
} from "../services/subtitle-generation";
import { uiCopy, useUiPreferences } from "../services/ui-preferences";
import { getLlmSettings, providerLabels, type LlmProvider, type LlmSettings } from "../services/studio-settings";
import { SupportArtistButton } from "./ArtistSupport";
import { MemoryButton } from "./MemoryStudio";
import { SettingsButton } from "./StudioSettings";

type Tab = "transcribe" | "vocals";
const languages = [["it", "Italiano"], ["en", "English"], ["es", "Español"], ["fr", "Français"], ["de", "Deutsch"], ["pt", "Português"], ["auto", "Automatico"]] as const;
const copy = {
  it: {
    eyebrow: "Produzione e analisi vocale",
    title: "Audio",
    description: "Trascrizione professionale locale con revisione opzionale tramite i modelli configurati, più isolamento della voce.",
    transcribe: "Da audio a testo / SRT",
    vocals: "Estrai voce",
    replace: "Sostituisci file",
    language: "Lingua",
    model: "Rilevamento vocale Whisper",
    reviewer: "Modello di revisione testo / SRT",
    enableReview: "Attiva revisione LLM",
    reviewDisabledHint: "Disattivata di default. Inserisci il testo originale per abilitarla.",
    localReviewer: "Locale · Qwen2.5 0.5B",
    reviewerHint: "Whisper misura parole e timestamp in locale; il modello scelto revisiona il testo senza modificare i tempi.",
    noRemoteReviewer: "Configura e abilita un provider nelle Impostazioni per usarlo qui.",
    reference: "Testo originale · opzionale",
    referenceHint: "Se presente, diventa la fonte autorevole delle parole. Il revisore mantiene i timestamp misurati da Whisper.",
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
    description: "Professional local transcription with optional review through configured models, plus vocal isolation.",
    transcribe: "Audio to text / SRT",
    vocals: "Extract vocals",
    replace: "Replace file",
    language: "Language",
    model: "Whisper speech recognition",
    reviewer: "Text / SRT review model",
    enableReview: "Enable LLM review",
    reviewDisabledHint: "Disabled by default. Enter the original text to enable it.",
    localReviewer: "Local · Qwen2.5 0.5B",
    reviewerHint: "Whisper measures words and timestamps locally; the selected model reviews the text without changing timing.",
    noRemoteReviewer: "Configure and enable a provider in Settings to use it here.",
    reference: "Original text · optional",
    referenceHint: "When provided, it is the authoritative word source. The reviewer preserves Whisper's measured timestamps.",
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

function audioErrorMessage(reason: unknown, language: "it" | "en"): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (/cublas(?:64)?(?:_\d+)?\.dll|library\s+cublas|cannot\s+load\s+cublas/i.test(message)) {
    return language === "en"
      ? "The NVIDIA CUDA runtime is incomplete or unavailable. MLSM could not load cuBLAS; retry using the automatic CPU fallback."
      : "Il runtime NVIDIA CUDA è incompleto o non disponibile. MLSM non ha potuto caricare cuBLAS: riprova usando il fallback automatico su CPU.";
  }
  if (/requested\s+float16\s+compute\s+type|support efficient float16 computation/i.test(message)) {
    return language === "en"
      ? "This device cannot run Whisper efficiently with float16. MLSM will use a compatible precision automatically; retry the transcription."
      : "Questo dispositivo non può eseguire Whisper in modo efficiente con float16. MLSM userà automaticamente una precisione compatibile: riprova la trascrizione.";
  }
  return message;
}

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
  const [reviewer, setReviewer] = useState<AudioTranscriptReviewer>("local");
  const [reviewEnabled, setReviewEnabled] = useState(false);
  const [llmSettings, setLlmSettings] = useState<LlmSettings | null>(null);
  const [reference, setReference] = useState("");
  const [transcript, setTranscript] = useState<WhisperTranscriptDocument | null>(null);
  const [status, setStatus] = useState<string>(t.ready);
  const [progress, setProgress] = useState(0);
  const [running, setRunning] = useState(false);
  const [vocalResult, setVocalResult] = useState<{ path: string; url: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const mediaRef = useRef<AudioToolMedia | null>(null);
  const initializedReviewer = useRef(false);

  useEffect(() => {
    let active = true;
    const refresh = () => { void getLlmSettings().then((settings) => {
      if (!active) return;
      setLlmSettings(settings);
      setReviewer((current) => {
        if (!initializedReviewer.current) {
          initializedReviewer.current = true;
          const preferred = settings.activeProvider;
          return preferred !== "local" && settings.providers[preferred].configured && settings.providers[preferred].enabled ? preferred : "local";
        }
        return current !== "local" && (!settings.providers[current].configured || !settings.providers[current].enabled) ? "local" : current;
      });
    }).catch(() => { if (active) setLlmSettings(null); }); };
    refresh();
    window.addEventListener("mlsm-llm-settings-changed", refresh);
    return () => { active = false; window.removeEventListener("mlsm-llm-settings-changed", refresh); };
  }, []);

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
    setReviewEnabled(false);
    setStatus(t.ready);
  };
  const changeReference = (value: string) => {
    setReference(value);
    if (!value.trim()) setReviewEnabled(false);
  };
  const runTranscription = async () => {
    if (!media || running) return;
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setTranscript(null);
    try {
      let result = await transcribeAudioMedia(media, { language, model, signal: controller.signal, onProgress: (value) => { setProgress(value.progress); setStatus(value.message); } });
      if (reviewEnabled && reference.trim()) {
        result = await correctAudioTranscript(result, reference, setStatus, { reviewer, signal: controller.signal });
      }
      setTranscript(result);
      setProgress(1);
      setStatus(`${result.words.length} timestamp Whisper`);
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError")) setStatus(audioErrorMessage(reason, uiLanguage));
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
        <label>{t.reviewer}<select aria-label={t.reviewer} disabled={!reviewEnabled} value={reviewer} onChange={(event) => setReviewer(event.target.value as AudioTranscriptReviewer)}><option value="local">{t.localReviewer}</option>{llmSettings ? (Object.keys(providerLabels) as LlmProvider[]).filter((provider) => llmSettings.providers[provider].configured && llmSettings.providers[provider].enabled).map((provider) => <option key={provider} value={provider}>{providerLabels[provider]} · {llmSettings.providers[provider].model}</option>) : null}</select><small>{t.reviewerHint}{llmSettings && !(Object.keys(providerLabels) as LlmProvider[]).some((provider) => llmSettings.providers[provider].configured && llmSettings.providers[provider].enabled) ? ` ${t.noRemoteReviewer}` : ""}</small></label>
        <label>{t.reference}<textarea aria-label={t.reference} rows={5} value={reference} onChange={(event) => changeReference(event.target.value)} /><small>{t.referenceHint}</small></label>
        <label className="audio-review-toggle"><span>{t.enableReview}</span><input aria-label={t.enableReview} type="checkbox" checked={reviewEnabled} disabled={!reference.trim()} onChange={(event) => setReviewEnabled(event.target.checked && Boolean(reference.trim()))} /></label>
        {!reference.trim() ? <small className="audio-review-hint">{t.reviewDisabledHint}</small> : null}
        <div className="audio-run-actions"><button className="audio-primary" disabled={!media || running} onClick={() => void runTranscription()}>{running ? t.working : t.start}</button>{running ? <button type="button" onClick={() => abort.current?.abort()}>{t.cancel}</button> : null}</div>
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
