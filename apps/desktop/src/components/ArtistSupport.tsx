import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { artistMedia, artistSocialLinks } from "../services/artist-socials";
import { FIRST_ARTIST_SUPPORT_REMINDER_MS, REPEAT_ARTIST_SUPPORT_REMINDER_MS, supportReminderDue, type ArtistSupportClock } from "../services/artist-support-reminder";
import { defaultTikTokCreatorProfile, loadTikTokCreatorProfile, TIKTOK_EMBED_REFRESH_MS } from "../services/tiktok-creator-embed";
import { uiCopy, useUiPreferences } from "../services/ui-preferences";
import { ArtistSupportContext, useArtistSupport, type ArtistSupportContextValue } from "./artist-support-context";
import { SocialIcon } from "./StudioIcons";

const STORAGE_KEY = "mlsm-studio.artist-support.v1";

function readClock(now = Date.now()): ArtistSupportClock {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<ArtistSupportClock>;
    if (typeof parsed.firstSeenAt === "number" && Number.isFinite(parsed.firstSeenAt)) return { firstSeenAt: parsed.firstSeenAt, lastOpenedAt: typeof parsed.lastOpenedAt === "number" && Number.isFinite(parsed.lastOpenedAt) ? parsed.lastOpenedAt : null };
  } catch { /* Riparte con un timer pulito. */ }
  const initial = { firstSeenAt: now, lastOpenedAt: null };
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(initial)); } catch { /* Il reminder resta valido per la sessione. */ }
  return initial;
}

export function ArtistSupportProvider({ children }: { children: ReactNode }) {
  const [clock, setClock] = useState(readClock); const [attention, setAttention] = useState(() => supportReminderDue(readClock(), Date.now())); const [open, setOpen] = useState(false);
  useEffect(() => {
    const dueAt = clock.lastOpenedAt === null ? clock.firstSeenAt + FIRST_ARTIST_SUPPORT_REMINDER_MS : clock.lastOpenedAt + REPEAT_ARTIST_SUPPORT_REMINDER_MS;
    const refresh = () => setAttention(supportReminderDue(clock, Date.now()));
    refresh(); const timer = window.setTimeout(refresh, Math.max(0, Math.min(2_147_000_000, dueAt - Date.now())));
    return () => window.clearTimeout(timer);
  }, [clock]);
  const acknowledge = useCallback(() => { const next = { firstSeenAt: clock.firstSeenAt, lastOpenedAt: Date.now() }; setClock(next); setAttention(false); try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* Persistenza opzionale. */ } }, [clock.firstSeenAt]);
  const show = useCallback(() => { acknowledge(); setOpen(true); }, [acknowledge]);
  const close = useCallback(() => setOpen(false), []);
  const value = useMemo<ArtistSupportContextValue>(() => ({ attention, open, show, close, acknowledge }), [acknowledge, attention, close, open, show]);
  return <ArtistSupportContext.Provider value={value}>{children}<ArtistSupportDialog /></ArtistSupportContext.Provider>;
}

export function SupportArtistButton({ compact = false }: { compact?: boolean }) {
  const { language } = useUiPreferences(); const copy = uiCopy[language]; const support = useArtistSupport();
  return <button className={`support-artist-button${compact ? " is-compact" : ""}${support.attention ? " needs-attention" : ""}`} type="button" onClick={support.show} aria-label={copy.supportArtist}><span aria-hidden="true">♥</span>{copy.supportArtist}</button>;
}

type FeaturedArtistMedia = "tiktok" | "spotify" | "youtube";
type ArtistWebSheet = "website" | "journal";
type ArtistSupportSheet = "media" | ArtistWebSheet;
const featuredArtistMedia: readonly FeaturedArtistMedia[] = ["spotify", "youtube", "tiktok"];
const featuredMediaLabels: Record<FeaturedArtistMedia, string> = { tiktok: "TikTok", spotify: "Spotify playlist", youtube: "YouTube playlist" };

function refreshTikTokEmbedScript() {
  document.querySelector<HTMLScriptElement>('script[data-mlsm-tiktok-embed="true"]')?.remove();
  const script = document.createElement("script");
  script.src = "https://www.tiktok.com/embed.js";
  script.async = true;
  script.dataset.mlsmTiktokEmbed = "true";
  document.body.appendChild(script);
  return script;
}

function TikTokCreatorProfile({ refreshToken }: { refreshToken: number }) {
  const [profile, setProfile] = useState(defaultTikTokCreatorProfile);
  useEffect(() => {
    let cancelled = false;
    void loadTikTokCreatorProfile().then((resolved) => { if (!cancelled) setProfile(resolved); }).catch(() => undefined);
    refreshTikTokEmbedScript();
    return () => { cancelled = true; };
  }, [refreshToken]);

  return <article className="artist-media-card tiktok-creator-card">
    <div className="artist-media-label"><SocialIcon kind="tiktok" /><span>TikTok · @{profile.uniqueId}</span><i>OFFICIAL OEMBED</i></div>
    <div className="tiktok-creator-shell">
      <blockquote key={refreshToken} className="tiktok-embed" cite={profile.profileUrl} data-unique-id={profile.uniqueId} data-embed-type="creator" data-embed-from="oembed" aria-label={profile.title}>
        <section><a href={`${profile.profileUrl}?refer=creator_embed`} target="_blank" rel="noreferrer">@{profile.uniqueId}</a></section>
      </blockquote>
      <div className="tiktok-embed-loading" aria-hidden="true"><SocialIcon kind="tiktok" /><span>{profile.authorName}</span><i /><i /><i /></div>
    </div>
  </article>;
}

const artistWebsiteCopy = {
  it: {
    back: "Torna alla scheda precedente",
    website: {
      eyebrow: "SITO UFFICIALE",
      title: "Entra nel mondo di My Lonely Soul Music",
      open: "Apri in una nuova scheda",
      show: "Mostra sito ufficiale",
    },
    journal: {
      eyebrow: "LONELY'S JOURNAL",
      title: "Leggi Lonely's Journal",
      open: "Apri il Journal in una nuova scheda",
      show: "Mostra Lonely's Journal",
    },
  },
  en: {
    back: "Back to the previous panel",
    website: {
      eyebrow: "OFFICIAL WEBSITE",
      title: "Enter the world of My Lonely Soul Music",
      open: "Open in a new tab",
      show: "Show official website",
    },
    journal: {
      eyebrow: "LONELY'S JOURNAL",
      title: "Read Lonely's Journal",
      open: "Open the Journal in a new tab",
      show: "Show Lonely's Journal",
    },
  },
} as const;

function ArtistWebsitePreview({ language, onBack, onNext, onOpen, sheet }: { language: "it" | "en"; onBack: () => void; onNext?: () => void; onOpen: () => void; sheet: ArtistWebSheet }) {
  const copy = artistWebsiteCopy[language];
  const destination = copy[sheet];
  const titleId = `artist-${sheet}-title`;
  const url = artistMedia[sheet];
  const iframeTitle = sheet === "website" ? "My Lonely Soul Music · Official website" : "My Lonely Soul Music · Lonely's Journal";
  return <section className="artist-website" aria-labelledby={titleId}>
    <header>
      <button className="artist-website-back" type="button" onClick={onBack}><span aria-hidden="true">↓</span>{copy.back}</button>
      <div><span>{destination.eyebrow}</span><h3 id={titleId}>{destination.title}</h3></div>
      <a href={url} target="_blank" rel="noopener noreferrer" onClick={onOpen}>{destination.open}</a>
    </header>
    <div className="artist-website-preview">
      <iframe
        title={iframeTitle}
        src={url}
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
    {onNext ? <button className="artist-show-website is-journal artist-show-next-sheet" type="button" onClick={onNext}>{copy.journal.show}<span aria-hidden="true">↑</span></button> : null}
  </section>;
}

function ArtistSupportDialog() {
  const { language } = useUiPreferences(); const copy = uiCopy[language]; const support = useArtistSupport();
  const [activeMedia, setActiveMedia] = useState<FeaturedArtistMedia>("spotify");
  const [activeSheet, setActiveSheet] = useState<ArtistSupportSheet>("media");
  const [websiteVisited, setWebsiteVisited] = useState(false);
  const [journalVisited, setJournalVisited] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const closeDialog = useCallback(() => {
    setActiveSheet("media");
    setWebsiteVisited(false);
    setJournalVisited(false);
    support.close();
  }, [support]);
  const showWebSheet = (sheet: ArtistWebSheet) => {
    if (sheet === "website") setWebsiteVisited(true);
    else setJournalVisited(true);
    setActiveSheet(sheet);
  };
  useEffect(() => {
    const timer = window.setInterval(() => setRefreshToken((current) => current + 1), TIKTOK_EMBED_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!support.open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") closeDialog(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeDialog, support.open]);
  const activeIndex = featuredArtistMedia.indexOf(activeMedia);
  const selectMedia = (media: FeaturedArtistMedia) => setActiveMedia(media);
  const moveMedia = (direction: -1 | 1) => selectMedia(featuredArtistMedia[(activeIndex + direction + featuredArtistMedia.length) % featuredArtistMedia.length]!);
  const websiteSheetState = activeSheet === "website" ? "is-active" : activeSheet === "journal" ? "is-above" : "is-below";
  return <div className="artist-support-backdrop" role="presentation" hidden={!support.open} onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
    <section className="artist-support-dialog" role="dialog" aria-modal="true" aria-label={copy.supportTitle}>
      <div className="artist-support-aurora" aria-hidden="true"><i /><i /><i /></div>
      <header><div><span>MY LONELY SOUL MUSIC</span><h2>{copy.supportTitle}</h2><p>{copy.supportDescription}</p></div><button type="button" onClick={closeDialog} aria-label={copy.close}>×</button></header>
      <div className={`artist-support-sheets is-${activeSheet}`}>
        <section className={`artist-support-sheet artist-support-sheet--media ${activeSheet === "media" ? "is-active" : "is-above"}`} aria-hidden={activeSheet !== "media"}>
          <nav className="artist-media-tabs" aria-label={copy.featuredContent}>{featuredArtistMedia.map((media) => <button key={media} type="button" className={activeMedia === media ? "active" : ""} aria-pressed={activeMedia === media} onClick={() => selectMedia(media)}><SocialIcon kind={media} /><span>{featuredMediaLabels[media]}</span></button>)}</nav>
          <div className="artist-support-featured" aria-live="polite">
            <button className="artist-media-arrow previous" type="button" aria-label={copy.previousContent} onClick={() => moveMedia(-1)}>‹</button>
            <div className="artist-media-stage">
              <div className="artist-media-panel" hidden={activeMedia !== "spotify"}><article className="artist-media-card spotify-card"><div className="artist-media-label"><SocialIcon kind="spotify" /><span>Spotify playlist</span></div><iframe key={`spotify-${refreshToken}`} title="My Lonely Soul Music · Spotify playlist" src={artistMedia.spotifyPlaylist} loading="eager" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" /></article></div>
              <div className="artist-media-panel" hidden={activeMedia !== "youtube"}><article className="artist-media-card youtube-card"><div className="artist-media-label"><SocialIcon kind="youtube" /><span>YouTube playlist</span></div><iframe key={`youtube-${refreshToken}`} title="My Lonely Soul Music · YouTube playlist" src={artistMedia.youtubePlaylist} loading="eager" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen /></article></div>
              <div className="artist-media-panel" hidden={activeMedia !== "tiktok"}><TikTokCreatorProfile refreshToken={refreshToken} /></div>
            </div>
            <button className="artist-media-arrow next" type="button" aria-label={copy.nextContent} onClick={() => moveMedia(1)}>›</button>
          </div>
          <div className="artist-media-pagination" aria-hidden="true">{featuredArtistMedia.map((media) => <i key={media} className={activeMedia === media ? "active" : ""} />)}</div>
          <nav className="artist-support-links" aria-label={copy.artistChannels}>{artistSocialLinks.map((link) => featuredArtistMedia.some((media) => media === link.kind) ? <button key={link.kind} type="button" className={activeMedia === link.kind ? "active" : ""} onClick={() => selectMedia(link.kind as FeaturedArtistMedia)}><SocialIcon kind={link.kind} /><span>{link.label}</span></button> : <a key={link.kind} href={link.href} target={link.kind === "email" ? undefined : "_blank"} rel={link.kind === "email" ? undefined : "noreferrer"} onClick={support.acknowledge}><SocialIcon kind={link.kind} /><span>{link.label}</span></a>)}</nav>
          <div className="artist-web-sheet-launchers">
            <button className="artist-show-website" type="button" onClick={() => showWebSheet("website")}>{artistWebsiteCopy[language].website.show}<span aria-hidden="true">↑</span></button>
          </div>
        </section>
        <section className={`artist-support-sheet artist-support-sheet--website ${websiteSheetState}`} aria-hidden={activeSheet !== "website"}>
          {websiteVisited ? <ArtistWebsitePreview language={language} sheet="website" onBack={() => setActiveSheet("media")} onNext={() => showWebSheet("journal")} onOpen={support.acknowledge} /> : null}
        </section>
        <section className={`artist-support-sheet artist-support-sheet--journal ${activeSheet === "journal" ? "is-active" : "is-below"}`} aria-hidden={activeSheet !== "journal"}>
          {journalVisited ? <ArtistWebsitePreview language={language} sheet="journal" onBack={() => setActiveSheet("website")} onOpen={support.acknowledge} /> : null}
        </section>
      </div>
    </section>
  </div>;
}
