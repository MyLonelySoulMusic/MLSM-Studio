import { useEffect, useState, type AnimationEvent, type CSSProperties } from "react";

const waveform = [18, 34, 24, 52, 31, 68, 42, 78, 38, 62, 28, 48, 22, 58, 35, 72, 44, 64, 26, 46, 20];

export function WelcomeSplash() {
  const [phase, setPhase] = useState<"intro" | "leaving" | "hidden">("intro");

  useEffect(() => {
    const leaveTimer = window.setTimeout(() => setPhase("leaving"), 3_300);
    const hideTimer = window.setTimeout(() => setPhase("hidden"), 4_300);
    return () => { window.clearTimeout(leaveTimer); window.clearTimeout(hideTimer); };
  }, []);

  if (phase === "hidden") return null;
  const dismiss = () => setPhase("leaving");
  const finishExit = (event: AnimationEvent<HTMLElement>) => {
    if (phase === "leaving" && event.target === event.currentTarget && event.animationName === "mlsm-splash-out") setPhase("hidden");
  };

  return <section className={`welcome-splash ${phase === "leaving" ? "is-leaving" : ""}`} aria-label="Benvenuto in MLSM Studio" onAnimationEnd={finishExit}>
    <img className="welcome-splash__banner" src="/brand/mlsm-welcome-banner.webp" alt="" />
    <div className="welcome-splash__grain" aria-hidden="true" />
    <div className="welcome-splash__scan" aria-hidden="true" />
    <button className="welcome-splash__skip" type="button" onClick={dismiss}>Salta introduzione</button>
    <div className="welcome-splash__brand">
      <img src="/mlsm-studio-favicon-192.png" alt="" />
      <span>My Lonely Soul Music</span>
    </div>
    <div className="welcome-splash__footer">
      <div className="welcome-splash__copy">
        <span>Benvenuto in</span>
        <strong>MLSM <em>Studio</em></strong>
        <small>Sound animation · Photo · Video</small>
      </div>
      <div className="welcome-splash__loader" role="status" aria-live="polite">
        <div className="welcome-splash__wave" aria-hidden="true">
          {waveform.map((height, index) => <i key={index} style={{ "--wave-height": `${height}%`, "--wave-delay": `${index * 38}ms` } as CSSProperties} />)}
        </div>
        <div className="welcome-splash__progress"><i /></div>
        <div className="welcome-splash__loader-copy"><span>Preparazione studio creativo</span><span>MLSM / 01</span></div>
      </div>
    </div>
  </section>;
}
