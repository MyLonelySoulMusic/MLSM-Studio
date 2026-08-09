import { useCallback, useEffect, useState, type AnimationEvent, type CSSProperties } from "react";
import { artistSocialLinks } from "../services/artist-socials";
import { uiCopy, useUiPreferences } from "../services/ui-preferences";
import { useArtistSupport } from "./artist-support-context";
import { SocialIcon } from "./StudioIcons";

const waveform = [18, 34, 24, 52, 31, 68, 42, 78, 38, 62, 28, 48, 22, 58, 35, 72, 44, 64, 26, 46, 20];

export function WelcomeSplash({ onContinue }: { onContinue?: () => void }) {
  const [phase, setPhase] = useState<"intro" | "leaving" | "hidden">("intro");
  const { language, setLanguage } = useUiPreferences();
  const copy = uiCopy[language];
  const support = useArtistSupport();
  const completeExit = useCallback(() => {
    setPhase("hidden");
    onContinue?.();
  }, [onContinue]);

  useEffect(() => {
    if (phase !== "leaving") return;
    const fallback = window.setTimeout(completeExit, 850);
    return () => window.clearTimeout(fallback);
  }, [completeExit, phase]);

  if (phase === "hidden") return null;
  const finishExit = (event: AnimationEvent<HTMLElement>) => {
    if (phase === "leaving" && event.target === event.currentTarget && event.animationName === "mlsm-splash-out") completeExit();
  };

  return <section className={`welcome-splash ${phase === "leaving" ? "is-leaving" : ""}`} aria-label="Benvenuto in MLSM Studio" onAnimationEnd={finishExit}>
    <img className="welcome-splash__banner" src="/brand/mlsm-welcome-banner.webp" alt="" />
    <div className="welcome-splash__grain" aria-hidden="true" />
    <div className="welcome-splash__scan" aria-hidden="true" />
    <div className="welcome-splash__brand">
      <img src="/mlsm-studio-favicon-192.png" alt="" />
      <span>My Lonely Soul Music</span>
    </div>
    <label className="welcome-splash__language"><span>{copy.language}</span><select aria-label={copy.language} value={language} onChange={(event) => setLanguage(event.target.value === "en" ? "en" : "it")}><option value="it">IT</option><option value="en">EN</option></select></label>
    <div className="welcome-splash__footer">
      <div className="welcome-splash__copy">
        <span>{language === "it" ? "Benvenuto in" : "Welcome to"}</span>
        <strong>MLSM <em>Studio</em></strong>
        <small>Sound animation · Photo · Video</small>
        <nav className="welcome-splash__socials" aria-label={copy.supportOnSocials}>
          {artistSocialLinks.map((link) => <a key={link.kind} href={link.href} target={link.kind === "email" ? undefined : "_blank"} rel={link.kind === "email" ? undefined : "noreferrer"} aria-label={link.label} title={link.label} onClick={support.acknowledge}><SocialIcon kind={link.kind} /><span>{link.label}</span></a>)}
        </nav>
      </div>
      <div className="welcome-splash__loader" role="status" aria-live="polite">
        <div className="welcome-splash__wave" aria-hidden="true">
          {waveform.map((height, index) => <i key={index} style={{ "--wave-height": `${height}%`, "--wave-delay": `${index * 38}ms` } as CSSProperties} />)}
        </div>
        <div className="welcome-splash__progress"><i /></div>
        <div className="welcome-splash__loader-copy"><span>{language === "it" ? "Studio creativo pronto" : "Creative studio ready"}</span><span>MLSM / 01</span></div>
        <button className="welcome-splash__enter" type="button" disabled={phase === "leaving"} onClick={() => setPhase("leaving")}><span>{copy.enterStudio}</span><b aria-hidden="true">↗</b></button>
      </div>
    </div>
  </section>;
}
