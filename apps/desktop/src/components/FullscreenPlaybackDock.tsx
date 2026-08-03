function formatClock(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const remaining = Math.floor(safe % 60);
  return `${minutes}:${remaining.toString().padStart(2, "0")}`;
}

export function FullscreenPlaybackDock({ currentTime, duration, playing, onPlayPause, onStop, onSeek }: { currentTime: number; duration: number; playing: boolean; onPlayPause: () => void; onStop: () => void; onSeek: (seconds: number) => void }) {
  const ready = duration > 0;
  return <div className="viewport-fullscreen-transport" role="group" aria-label="Controlli riproduzione a tutto schermo">
    <button type="button" aria-label="Indietro 5 secondi" disabled={!ready} onClick={() => onSeek(Math.max(0, currentTime - 5))}>↶ 5</button>
    <button type="button" className="fullscreen-play" aria-label={playing ? "Pausa" : "Play"} aria-keyshortcuts="Space" disabled={!ready} onClick={onPlayPause}>{playing ? "❚❚" : "▶"}</button>
    <button type="button" aria-label="Stop" disabled={!ready} onClick={onStop}>■</button>
    <input aria-label="Posizione riproduzione a tutto schermo" type="range" min="0" max={Math.max(.01, duration)} step=".01" value={Math.min(Math.max(0, currentTime), Math.max(.01, duration))} disabled={!ready} onChange={(event) => onSeek(Number(event.target.value))} />
    <output>{formatClock(currentTime)} / {formatClock(duration)}</output>
  </div>;
}
