import { useCallback, useEffect, useRef, useState, type AnimationEvent } from "react";
import { artistSocialLinks } from "../services/artist-socials";
import { uiCopy, useUiPreferences } from "../services/ui-preferences";
import { useArtistSupport } from "./artist-support-context";
import { SocialIcon } from "./StudioIcons";
import { WelcomeScene } from "./WelcomeScene";

export function WelcomeSplash({ onContinue }: { onContinue?: () => void }) {
  const [phase, setPhase] = useState<"intro" | "leaving" | "hidden">("intro");
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const completed = useRef(false);
  const stage = useRef<HTMLElement>(null);
  const { language, theme, setLanguage, setTheme } = useUiPreferences();
  const copy = uiCopy[language];
  const support = useArtistSupport();
  const completeExit = useCallback(() => {
    if (completed.current) return;
    completed.current = true;
    setPhase("hidden");
    onContinue?.();
  }, [onContinue]);

  useEffect(() => {
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!preference) return;
    const change = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", change);
    return () => preference.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (phase !== "leaving") return;
    const fallback = window.setTimeout(completeExit, reducedMotion ? 0 : 650);
    return () => window.clearTimeout(fallback);
  }, [completeExit, phase, reducedMotion]);

  if (phase === "hidden") return null;
  const finishExit = (event: AnimationEvent<HTMLElement>) => {
    if (phase === "leaving" && event.target === event.currentTarget && event.animationName === "studio-intro-out") completeExit();
  };

  return <section ref={stage} className={`welcome-splash welcome-splash--3d${phase === "leaving" ? " is-leaving" : ""}`} aria-label={copy.welcomeLabel} data-ui-copy onAnimationEnd={finishExit}>
    <header className="intro-header">
      <div className="brand"><img className="brand-mark" src="/mlsm-studio-favicon-192.png" alt="" /><span className="brand-copy"><strong>MLSM Studio</strong><small>My Lonely Soul Music</small></span></div>
      <div className="intro-controls">
        <button type="button" className="intro-theme" aria-label={`${copy.appearance}: ${theme === "day" ? copy.day : copy.night}`} aria-pressed={theme === "night"} onClick={() => setTheme(theme === "day" ? "night" : "day")}><span aria-hidden="true">{theme === "day" ? "☼" : "◐"}</span>{theme === "day" ? copy.day : copy.night}</button>
        {!reducedMotion && <button type="button" className="intro-motion" aria-label={paused ? copy.resumeAnimation : copy.pauseAnimation} aria-pressed={paused} onClick={() => setPaused(!paused)}><svg viewBox="0 0 20 20" aria-hidden="true">{paused ? <path d="m7 4 9 6-9 6Z" /> : <path d="M6 4v12M14 4v12" />}</svg><span>{paused ? copy.resumeAnimation : copy.pauseAnimation}</span></button>}
        <label className="intro-language"><span>{copy.language}</span><select aria-label={copy.language} value={language} onChange={(event) => setLanguage(event.target.value === "en" ? "en" : "it")}><option value="it">IT</option><option value="en">EN</option></select></label>
        <button type="button" className="intro-skip" disabled={phase === "leaving"} onClick={() => setPhase("leaving")}>{copy.skipIntro}<span aria-hidden="true">↗</span></button>
      </div>
    </header>
    <div className="intro-layout">
      <div className="intro-content">
        <p className="intro-eyebrow"><span />{copy.creativeStudio}</p>
        <h1>{copy.introTitle}<br /><em>{copy.introTitleAccent}</em></h1>
        <p className="intro-description">{copy.introDescription}</p>
        <button className="intro-enter" type="button" disabled={phase === "leaving"} onClick={() => setPhase("leaving")}><span>{copy.enterStudio}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg></button>
        <div className="intro-disciplines"><span>{copy.introSound}</span><span>{copy.introImage}</span><span>{copy.introVideo}</span></div>
      </div>
      <figure className="intro-art">
        <WelcomeScene animated={phase === "intro" && !paused && !reducedMotion} reducedMotion={reducedMotion} theme={theme} stage={stage} />
        <figcaption><span className="intro-art__index">My Lonely Soul Music</span><span>{copy.soundInMotion}</span></figcaption>
      </figure>
    </div>
    <footer className="intro-footer"><span>{copy.productionSuite}</span><nav aria-label={copy.supportOnSocials}>{artistSocialLinks.map((link) => <a key={link.kind} href={link.href} target={link.kind === "email" ? undefined : "_blank"} rel={link.kind === "email" ? undefined : "noreferrer"} aria-label={link.label} title={link.label} onClick={support.acknowledge}><SocialIcon kind={link.kind} /></a>)}</nav></footer>
  </section>;
}
