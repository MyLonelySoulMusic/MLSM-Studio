export type ArtistSocialKind = "youtube" | "spotify" | "appleMusic" | "tiktok" | "instagram" | "email";

export interface ArtistSocialLink {
  kind: ArtistSocialKind;
  label: string;
  href: string;
}

/** Riferimenti ufficiali mantenuti anche nel file social.md alla radice del progetto. */
export const artistSocialLinks: readonly ArtistSocialLink[] = [
  { kind: "youtube", label: "YouTube", href: "https://www.youtube.com/@MyLonelySoulMusic" },
  { kind: "spotify", label: "Spotify", href: "https://open.spotify.com/intl-it/artist/46IsvOJtw1vXE6nFqHxz3R?si=f8dGOH_BSvKfJblN4upcdQ" },
  { kind: "appleMusic", label: "Apple Music", href: "https://music.apple.com/it/artist/my-lonely-soul-music/6792151463" },
  { kind: "tiktok", label: "TikTok", href: "https://www.tiktok.com/@mylonelysoulmusic" },
  { kind: "instagram", label: "Instagram", href: "https://www.instagram.com/mylonelysoulmusic/" },
  { kind: "email", label: "Email", href: "mailto:mylonelysoulmusic@gmail.com" }
];

export const artistMedia = {
  youtubePlaylist: "https://www.youtube-nocookie.com/embed/videoseries?list=PLM_wfIXb_aOg",
  youtubePlaylistLink: "https://youtube.com/playlist?list=PLM_wfIXb_aOg",
  spotifyPlaylist: "https://open.spotify.com/embed/playlist/74PKRqLbaRT5ghhuyoGovF?utm_source=generator&theme=0",
  spotifyPlaylistLink: "https://open.spotify.com/playlist/74PKRqLbaRT5ghhuyoGovF",
  tiktokProfile: "https://www.tiktok.com/@mylonelysoulmusic",
  tiktokOEmbed: "https://www.tiktok.com/oembed?url=https%3A%2F%2Fwww.tiktok.com%2F%40mylonelysoulmusic"
} as const;
