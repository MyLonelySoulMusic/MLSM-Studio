import type { AnimationCategoryId } from "../services/animation-modes";
import type { ArtistSocialKind } from "../services/artist-socials";

export function SocialIcon({ kind }: { kind: ArtistSocialKind }) {
  if (kind === "youtube") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5.5" width="19" height="13" rx="5" /><path d="m10 9 5 3-5 3Z" className="icon-fill" /></svg>;
  if (kind === "spotify") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" /><path d="M7 9.2c4.2-1 8-.4 10.7 1M7.8 12.2c3.5-.8 6.7-.3 9 1M8.8 15c2.6-.5 4.9-.2 6.9.8" /></svg>;
  if (kind === "instagram") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.3" cy="6.8" r=".8" className="icon-fill" /></svg>;
  if (kind === "tiktok") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4v10.2a4.2 4.2 0 1 1-3.3-4.1v3a1.5 1.5 0 1 0 .6 1.2V4h2.7c.4 2 1.7 3.1 3.7 3.5v2.8a7.6 7.6 0 0 1-3.7-1.4" /></svg>;
  if (kind === "appleMusic") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9.5 6.2 19 4v11.2a3.1 3.1 0 1 1-2-2.9V8l-5.5 1.3v7a3.1 3.1 0 1 1-2-2.9Z" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="3" /><path d="m4.5 7 7.5 6 7.5-6" /></svg>;
}

export function AreaIcon({ category }: { category: AnimationCategoryId }) {
  if (category === "soundAnimation") return <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M7 34h7l5-17 8 33 8-39 8 32 6-17 8 8" /><circle cx="32" cy="32" r="27" /></svg>;
  if (category === "photoVideoStudio") return <svg viewBox="0 0 64 64" aria-hidden="true"><rect x="9" y="14" width="36" height="36" rx="7" /><path d="m16 42 10-11 8 8 7-6M45 24l10-6v28l-10-6" /><circle cx="23" cy="25" r="4" /></svg>;
  if (category === "music") return <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M24 43V15l27-6v27" /><circle cx="17" cy="45" r="8" /><circle cx="44" cy="38" r="8" /><path d="M24 23l27-6M7 16h8M11 12v8" /></svg>;
  if (category === "lipsync") return <svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 33c7-10 15-15 22-15s15 5 22 15c-7 9-15 14-22 14S17 42 10 33Z" /><path d="M18 33c5-3 9-4 14-4s9 1 14 4c-5 4-9 6-14 6s-9-2-14-6Z" /><path d="M9 12h15M40 52h15" /></svg>;
  return <svg viewBox="0 0 64 64" aria-hidden="true"><rect x="7" y="11" width="50" height="42" rx="7" /><path d="M13 22h38M19 22v31M43 22v31M13 34h38M13 44h38" /><circle cx="31" cy="34" r="3" className="icon-fill" /></svg>;
}
