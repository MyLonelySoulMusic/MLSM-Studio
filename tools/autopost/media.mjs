/* global URL */
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be", "music.youtube.com"]);
const SPOTIFY_HOSTS = new Set(["open.spotify.com", "play.spotify.com"]);

function cleanId(value) { return /^[\w-]{6,128}$/.test(value ?? "") ? value : ""; }

export function recognizeMedia(input) {
  let url;
  try { url = new URL(String(input).trim()); } catch { throw new Error(`Link non valido: ${input}`); }
  const hostname = url.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.has(hostname)) {
    const playlistId = cleanId(url.searchParams.get("list"));
    if (playlistId) return { provider: "youtube", kind: "playlist", id: playlistId, url: url.href, canonicalUrl: `https://www.youtube.com/playlist?list=${playlistId}`, embedUrl: `https://www.youtube-nocookie.com/embed/videoseries?list=${playlistId}`, title: "Playlist YouTube" };
    const parts = url.pathname.split("/").filter(Boolean);
    const videoId = cleanId(hostname.includes("youtu.be") ? parts[0] : url.searchParams.get("v") || (["shorts", "embed", "live"].includes(parts[0]) ? parts[1] : ""));
    if (videoId) return { provider: "youtube", kind: "track", id: videoId, url: url.href, canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`, embedUrl: `https://www.youtube-nocookie.com/embed/${videoId}`, title: "Video YouTube" };
    throw new Error(`Link YouTube non riconosciuto: ${input}`);
  }
  if (SPOTIFY_HOSTS.has(hostname)) {
    const parts = url.pathname.split("/").filter(Boolean);
    const offset = parts[0]?.startsWith("intl-") ? 1 : 0;
    const kind = parts[offset];
    const id = cleanId(parts[offset + 1]);
    if (!id || !["track", "playlist"].includes(kind)) throw new Error(`Sono supportati brani e playlist Spotify: ${input}`);
    return { provider: "spotify", kind, id, url: url.href, canonicalUrl: `https://open.spotify.com/${kind}/${id}`, embedUrl: `https://open.spotify.com/embed/${kind}/${id}?utm_source=generator&theme=0`, title: kind === "track" ? "Brano Spotify" : "Playlist Spotify" };
  }
  throw new Error(`Provider non supportato: ${hostname}`);
}

export function normalizeArticle(raw, index = 0) {
  if (!raw || typeof raw !== "object") throw new Error(`Articolo ${index + 1}: formato non valido`);
  const title = String(raw.title ?? "").trim();
  const content = String(raw.content ?? raw.body ?? "").trim();
  if (!title) throw new Error(`Articolo ${index + 1}: titolo mancante`);
  if (!content) throw new Error(`Articolo ${index + 1}: contenuto mancante`);
  const candidates = raw.embeds ?? raw.media ?? raw.links ?? [];
  if (!Array.isArray(candidates)) throw new Error(`Articolo ${index + 1}: embeds deve essere un array`);
  if (candidates.length > 3) throw new Error(`Articolo ${index + 1}: sono ammessi al massimo 3 embed`);
  const media = candidates.map((item) => recognizeMedia(typeof item === "string" ? item : item?.url));
  return {
    title,
    content,
    excerpt: String(raw.excerpt ?? "").trim(),
    slug: String(raw.slug ?? "").trim(),
    categories: Array.isArray(raw.categories) ? raw.categories.map(Number).filter(Number.isInteger) : [],
    tags: Array.isArray(raw.tags) ? raw.tags.map(Number).filter(Number.isInteger) : [],
    media,
  };
}

export function parseArticleDocument(value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  const articles = Array.isArray(parsed) ? parsed : parsed?.articles;
  if (!Array.isArray(articles) || !articles.length) throw new Error("Il JSON deve contenere almeno un articolo");
  if (articles.length > 500) throw new Error("Un singolo file può contenere al massimo 500 articoli");
  return {
    articles: articles.map(normalizeArticle),
    intervalMinutes: Number.isFinite(Number(parsed?.intervalMinutes)) ? Math.max(1, Math.round(Number(parsed.intervalMinutes))) : undefined,
    postsPerRun: Number.isFinite(Number(parsed?.postsPerRun)) ? Math.max(1, Math.min(100, Math.round(Number(parsed.postsPerRun)))) : undefined,
  };
}

function normalizedPriority(value) {
  return Math.max(1, Math.min(100, Math.round(Number(value) || 50)));
}

export function weightedSample(items, count, random = Math.random) {
  const available = [...(items || [])];
  const selected = [];
  while (available.length && selected.length < Math.max(0, Math.floor(Number(count) || 0))) {
    const total = available.reduce((sum, item) => sum + normalizedPriority(item.priority), 0);
    let ticket = Math.max(0, Math.min(0.999999999, Number(random()) || 0)) * total;
    let index = available.length - 1;
    for (let cursor = 0; cursor < available.length; cursor += 1) {
      ticket -= normalizedPriority(available[cursor].priority);
      if (ticket < 0) { index = cursor; break; }
    }
    selected.push(available.splice(index, 1)[0]);
  }
  return selected;
}

export function selectLibraryMedia(items, settings = {}, random = Math.random) {
  const tracks = (items || []).filter((item) => item.kind === "track");
  const playlists = (items || []).filter((item) => item.kind === "playlist");
  const tracksPerPost = Math.max(1, Math.min(10, Math.round(Number(settings.tracksPerPost) || 1)));
  const playlistEveryTracks = Math.max(1, Math.min(10_000, Math.round(Number(settings.playlistEveryTracks) || 10)));
  const tracksSincePlaylist = Math.max(0, Math.round(Number(settings.tracksSincePlaylist) || 0));
  if (playlists.length && (tracksSincePlaylist >= playlistEveryTracks || !tracks.length)) {
    return { media: weightedSample(playlists, 1, random), tracksSincePlaylist: 0, usedPlaylist: true };
  }
  const media = weightedSample(tracks, tracksPerPost, random);
  return { media, tracksSincePlaylist: tracksSincePlaylist + media.length, usedPlaylist: false };
}

export function libraryMediaKey(item) {
  return `${item.provider}:${item.kind}:${item.id}`;
}

export function parseLibraryDocument(value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  const candidates = Array.isArray(parsed) ? parsed : parsed?.items;
  if (!Array.isArray(candidates)) throw new Error("Il JSON della libreria deve contenere un array items");
  if (candidates.length > 2_000) throw new Error("Una libreria può contenere al massimo 2.000 elementi");
  const items = [];
  const seen = new Set();
  let duplicateCount = 0;
  for (const [index, candidate] of candidates.entries()) {
    const rawUrl = typeof candidate === "string" ? candidate : candidate?.url ?? candidate?.canonicalUrl;
    if (!rawUrl) throw new Error(`Elemento ${index + 1}: link mancante`);
    const recognized = recognizeMedia(rawUrl);
    const key = libraryMediaKey(recognized);
    if (seen.has(key)) { duplicateCount += 1; continue; }
    seen.add(key);
    const title = typeof candidate?.title === "string" && candidate.title.trim() ? candidate.title.trim().slice(0, 300) : recognized.title;
    let thumbnailUrl;
    try {
      const thumbnail = new URL(String(candidate?.thumbnailUrl || ""));
      if (thumbnail.protocol === "https:") thumbnailUrl = thumbnail.href;
    } catch { /* La copertina è facoltativa. */ }
    const createdAt = Number.isFinite(Date.parse(candidate?.createdAt)) ? new Date(candidate.createdAt).toISOString() : new Date().toISOString();
    items.push({ ...recognized, title, ...(thumbnailUrl ? { thumbnailUrl } : {}), priority: normalizedPriority(candidate?.priority), createdAt });
  }
  const rawSettings = parsed?.settings || parsed || {};
  return {
    items,
    duplicateCount,
    settings: {
      tracksPerPost: Math.max(1, Math.min(10, Math.round(Number(rawSettings.tracksPerPost) || 2))),
      playlistEveryTracks: Math.max(1, Math.min(10_000, Math.round(Number(rawSettings.playlistEveryTracks) || 10))),
    },
  };
}

export function centerEmbeddedImages(content) {
  return String(content || "").replace(/<img\b([^>]*)>/gi, (tag, attributes) => {
    const centered = "display:block;margin-left:auto;margin-right:auto;max-width:100%;height:auto;";
    if (/\sstyle\s*=\s*(["'])/i.test(attributes)) {
      return `<img${attributes.replace(/\sstyle\s*=\s*(["'])/i, (match, quote) => ` style=${quote}${centered}`)}>`;
    }
    return `<img${attributes} style="${centered}">`;
  });
}

export function renderEmbedSection(media, blogName = "Music") {
  if (!media?.length) return "";
  const playlist = media.find((item) => item.kind === "playlist");
  const visibleMedia = playlist ? [playlist] : media.filter((item) => item.kind === "track");
  const cards = visibleMedia.map((item, index) => {
    const height = item.provider === "youtube" ? "315" : item.kind === "track" ? "152" : "352";
    const mediaType = item.kind === "playlist" ? "Playlist" : item.provider === "youtube" ? "Video" : "Brano";
    const label = `${mediaType} ${item.provider === "youtube" ? "YouTube" : "Spotify"}: ${item.title}`;
    const width = playlist ? "100%" : "min(88vw,430px)";
    return `<article aria-label="${escapeHtml(label)}" style="position:relative;flex:0 0 ${width};min-width:0;margin:${playlist ? "0 auto" : "0"};scroll-snap-align:start;border:1px solid #eadde4;border-radius:18px;overflow:hidden;background:#121014;box-shadow:0 16px 42px rgba(35,18,27,.16)"><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 14px;color:#f9f4f7;background:linear-gradient(135deg,#221820,#3a1f2c)"><span style="font:700 11px/1.2 system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase">${escapeHtml(mediaType)} · ${escapeHtml(item.provider)}</span><span aria-hidden="true" style="font:700 11px/1 system-ui,sans-serif;color:#e889b1">${String(index + 1).padStart(2, "0")}</span></div><iframe title="${escapeHtml(label)}" src="${escapeHtml(item.embedUrl)}" width="100%" height="${height}" style="display:block;margin:0 auto;border:0;max-height:352px;background:#121014" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" allowfullscreen></iframe></article>`;
  }).join("");
  const layout = playlist ? "display:block" : `display:flex;${visibleMedia.length === 1 ? "justify-content:center;" : ""}gap:18px;overflow-x:auto;overscroll-behavior-inline:contain;scroll-snap-type:x mandatory;padding:4px 4px 18px;scrollbar-color:#d56b99 #f5eaf0`;
  const hint = playlist || visibleMedia.length < 2 ? "" : `<span style="color:#8c7782;font:500 11px/1.4 system-ui,sans-serif">Scorri per ascoltare →</span>`;
  const selectionLabel = `${String(blogName || "Music").trim().toUpperCase()} SELECTION`;
  return `<section aria-label="Ascolta la musica" style="margin:48px 0 12px;padding:28px clamp(16px,3vw,28px);border:1px solid #eadde4;border-radius:22px;background:linear-gradient(145deg,#fff 0%,#fbf4f7 100%);box-shadow:0 18px 55px rgba(68,31,49,.08)"><header style="display:flex;align-items:end;justify-content:space-between;gap:16px;margin:0 0 19px"><div><span style="display:block;margin-bottom:5px;color:#bd3f77;font:750 10px/1.2 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase">${escapeHtml(selectionLabel)}</span><h2 style="margin:0;color:#211b1f;font:650 21px/1.25 system-ui,sans-serif;letter-spacing:-.02em">Ascolta la musica</h2></div>${hint}</header><div role="region" aria-label="${playlist ? "Playlist selezionata" : "Carosello musicale"}" style="${layout}">${cards}</div></section>`;
}

export function escapeHtml(value) { return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]); }
