import type { UiLanguage } from "../services/ui-preferences";

// Full phrases: this workspace must not use the legacy DOM word translator.
const english = {
  "Completa tutte le colonne della riga.": "Complete every column in the row.",
  "Intervallo clip non valido.": "Invalid clip range.",
  "Reazione non disponibile.": "Reaction unavailable.",
  "Sfondo non disponibile.": "Background unavailable.",
  "← Aree": "← Areas",
  "CLIP INEDITE + REAZIONI RIUTILIZZABILI": "NEW CLIPS + REUSABLE REACTIONS",
  "+ Nuovo format": "+ New format",
  "Elaborazione in corso…": "Processing…",
  "I tuoi format": "Your formats",
  "Crea il tuo primo format, per esempio “Gaming reaction”.": "Create your first format, for example “Gaming reaction”.",
  "Nome del format": "Format name",
  "Formato": "Aspect ratio",
  "Zoom standard clip inedite": "Default zoom for new clips",
  "Applicato alle nuove clip caricate. Ogni inserimento può avere uno zoom diverso.": "Applied to newly uploaded clips. Each insertion can have its own zoom.",
  "Salva format e bozza": "Save format and draft",
  "1. Libreria del format": "1. Format library",
  "Descrivi cosa succede nella reazione, per ritrovarla nella ricerca Memory condivisa.": "Describe what happens in the reaction to find it through shared Memory search.",
  "Descrizione dei video da caricare": "Description of the videos to upload",
  "Reazione king: esulta per una bella azione, vittoria incredibile": "King reaction: celebrates a great play, an incredible victory",
  "Carica reazioni nella libreria": "Upload reactions to the library",
  "Cerca reazioni": "Search reactions",
  "Cerca: reazione king…": "Search: king reaction…",
  "Cerca in Memory": "Search Memory",
  "Scena per il prossimo inserimento": "Scene for the next insertion",
  "Video a schermo intero": "Full-screen video",
  "Inserimento nella posizione": "Insert at position",
  ". Scegli un “+” sulla timeline.": ". Choose a “+” on the timeline.",
  "Descrizione": "Description",
  "Anteprima": "Preview",
  "+ Inserisci reazione": "+ Insert reaction",
  "Nessuna reazione trovata. Prova un’altra descrizione.": "No reactions found. Try another description.",
  "Carica le reazioni che vuoi riutilizzare.": "Upload the reactions you want to reuse.",
  "2. Scene preimpostate": "2. Scene presets",
  "Nuova scena": "New scene",
  "+ Scena": "+ Scene",
  "Nome scena": "Scene name",
  "Zoom video": "Video zoom",
  "Mostra ultimo frame della clip precedente": "Show the last frame of the previous clip",
  "Posizione orizzontale": "Horizontal position",
  "Posizione verticale": "Vertical position",
  "Dimensione fermo immagine": "Still frame size",
  "Ultimo frame": "Last frame",
  "3. Componi il nuovo video": "3. Compose your new video",
  "+ Carica clip inedite qui": "+ Upload new clips here",
  "Nuovo contenuto · svuota bozza": "New content · clear draft",
  "Inserisci alla posizione": "Insert at position",
  "Scena": "Scene",
  "Schermo intero": "Full screen",
  "← Sposta": "← Move",
  "Rimuovi": "Remove",
  "Crea video → anteprima ed esportazione": "Create video → preview and export",
  "Il montaggio si apre nel Video Editor, con audio, zoom e fermi immagine già applicati. Il format resta disponibile per il prossimo contenuto.": "The composition opens in Video Editor with audio, zoom and still frames already applied. The format remains available for your next video.",
  "Format e bozza salvati sul dispositivo.": "Format and draft saved on this device.",
  "Modifiche da salvare": "Unsaved changes",
  "Questa scena richiede una clip precedente.": "This scene requires a previous clip.",
  "Seleziona un video con durata valida.": "Choose a video with a valid duration.",
  "Reazione con ultimo frame": "Reaction with last frame",
  "Caricamento Video Format Builder…": "Loading Video Format Builder…",
  "Crea format riutilizzabili. Alterna nuove clip e reazioni, con scene e fermi immagine automatici.": "Create reusable formats. Alternate new clips and reactions with automatic scenes and still frames.",
  "FORMAT · REACTION · GAMEPLAY": "FORMATS · REACTIONS · GAMEPLAY",
  "Una clip della timeline non è disponibile.": "A timeline clip is unavailable.",
  "La scena con ultimo frame richiede una clip precedente.": "The last-frame scene requires a previous clip.",
  "Inserisci una clip prima della scena con ultimo frame.": "Insert a clip before the last-frame scene.",
  "Fermo immagine mancante.": "Still frame missing.",
  "Salvataggio non riuscito.": "Saving failed.",
  "Operazione non riuscita. Riprova e verifica che i file siano disponibili e ci sia spazio sul dispositivo.": "The operation failed. Try again and check that the files are available and your device has free space."
} as const;
export type FormatCopyKey = keyof typeof english;
export function formatText(language: UiLanguage, key: FormatCopyKey): string { return language === "en" ? english[key] : key; }

export function formatError(language: UiLanguage, message: string): string {
  if (language === "it") return message;
  if (Object.hasOwn(english, message)) return english[message as FormatCopyKey];
  if (message.startsWith("Media mancante: ")) return `Missing media: ${message.slice("Media mancante: ".length)}`;
  if (message.startsWith("Impossibile estrarre l’ultimo frame di ")) return `Unable to extract the last frame of ${message.slice("Impossibile estrarre l’ultimo frame di ".length)}`;
  return english["Operazione non riuscita. Riprova e verifica che i file siano disponibili e ci sia spazio sul dispositivo."];
}
