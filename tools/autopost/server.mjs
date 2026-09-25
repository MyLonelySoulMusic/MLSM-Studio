import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { centerEmbeddedImages, libraryMediaKey, parseArticleDocument, parseLibraryDocument, recognizeMedia, renderEmbedSection, selectLibraryMedia } from "./media.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const development = process.argv.includes("--dev");
const port = Number(process.env.MLSM_AUTOPOST_PORT || 1430);
const dataDirectory = resolve(process.env.MLSM_AUTOPOST_DATA_DIR || join(homedir(), ".mlsm-autopost"));
const statePath = join(dataDirectory, "state.json");
const keyPath = join(dataDirectory, ".key");
const emptyState = () => ({
  version: 4,
  blogs: [],
  schedule: { enabled: false, intervalMinutes: 15, postsPerRun: 1, nextRunAt: null },
  queue: [],
  stats: {},
  library: { items: [], tracksPerPost: 2, playlistEveryTracks: 10, tracksSincePlaylist: 0 },
  history: [],
});
let state = emptyState();
let timer = null;
let publishing = false;

async function saveState() {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const temporary = `${statePath}.tmp`;
  const serialized = JSON.stringify(state, null, 2);
  await writeFile(temporary, serialized, { mode: 0o600 });
  try {
    await rename(temporary, statePath);
  } catch (error) {
    if (!['EACCES', 'EBUSY', 'EEXIST', 'EPERM'].includes(error?.code)) throw error;
    // Alcuni filesystem Windows non permettono di sostituire un file esistente
    // tramite rename. In quel caso writeFile mantiene la persistenza portabile.
    await writeFile(statePath, serialized, { mode: 0o600 });
    await unlink(temporary).catch((cleanupError) => {
      if (cleanupError?.code !== "ENOENT") throw cleanupError;
    });
  }
}

async function loadState() {
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  let recovered = false;
  try {
    const stored = JSON.parse(await readFile(statePath, "utf8"));
    const defaults = emptyState();
    const migratedBlogs = Array.isArray(stored.blogs) ? stored.blogs.map((blog) => ({ ...blog, categories: Array.isArray(blog.categories) ? blog.categories : [], categoriesSyncedAt: blog.categoriesSyncedAt || null })) : [];
    if (!migratedBlogs.length && stored.config?.siteUrl) {
      let name = "Blog WordPress";
      try { name = new URL(stored.config.siteUrl).hostname; } catch { /* Mantiene il nome generico. */ }
      migratedBlogs.push({ id: randomUUID(), name, siteUrl: stored.config.siteUrl, username: stored.config.username || "", password: stored.config.password || null, defaultStatus: stored.config.defaultStatus === "draft" ? "draft" : "publish", categories: [], categoriesSyncedAt: null });
    }
    state = { ...defaults, ...stored, blogs: migratedBlogs, schedule: { ...defaults.schedule, ...(stored.schedule || {}) }, library: { ...defaults.library, ...(stored.library || {}), items: Array.isArray(stored.library?.items) ? stored.library.items : [] }, version: 4 };
    delete state.config;
    recovered = stored.version !== 4 || Boolean(stored.config);
  }
  catch (error) { if (error?.code !== "ENOENT") throw error; }
  for (const item of state.queue) {
    if (item.status === "publishing") { item.status = "queued"; item.lastError = "Pubblicazione interrotta dalla chiusura dell’app; rimessa in coda."; recovered = true; }
    if (!Array.isArray(item.blogIds) || !item.blogIds.length) { item.blogIds = state.blogs[0] ? [state.blogs[0].id] : []; recovered = true; }
    if (!item.categoriesByBlog || typeof item.categoriesByBlog !== "object") { item.categoriesByBlog = Object.fromEntries(item.blogIds.map((id) => [id, item.article.categories || []])); recovered = true; }
    if (!item.blogResults || typeof item.blogResults !== "object") { item.blogResults = {}; recovered = true; }
  }
  if (recovered) await saveState();
}

async function encryptionKey() {
  try { return Buffer.from(await readFile(keyPath, "utf8"), "base64"); }
  catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const key = randomBytes(32);
    await writeFile(keyPath, key.toString("base64"), { mode: 0o600 });
    return key;
  }
}

async function encryptSecret(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${encrypted.toString("base64")}`;
}

async function decryptSecret(value) {
  const [iv, tag, encrypted] = String(value || "").split(".");
  if (!iv || !tag || !encrypted) return "";
  const decipher = createDecipheriv("aes-256-gcm", await encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]).toString("utf8");
}

function publicState() {
  const safeState = Object.fromEntries(Object.entries(state).filter(([key]) => key !== "config"));
  return {
    ...safeState,
    blogs: state.blogs.map(({ password, ...blog }) => ({ ...blog, hasPassword: Boolean(password) })),
    summary: state.queue.reduce((counts, item) => ({ ...counts, [item.status]: (counts[item.status] || 0) + 1 }), {}),
    dataDirectory,
  };
}

function normalizeSiteUrl(value) {
  const url = new URL(String(value).trim());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("WordPress deve usare HTTPS (HTTP è ammesso soltanto in locale).");
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.href.replace(/\/$/, "");
}

async function fetchWithTimeout(url, options = {}, milliseconds = 20_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), milliseconds);
  try { return await fetch(url, { ...options, signal: controller.signal, redirect: "error" }); }
  finally { clearTimeout(timeout); }
}

async function wpRequest(path, body, blog = {}, override = {}) {
  const siteUrl = normalizeSiteUrl(override.siteUrl || blog.siteUrl);
  const username = String(override.username || blog.username).trim();
  const password = String(override.password || await decryptSecret(blog.password)).replace(/\s+/g, "");
  if (!username || !password) throw new Error("Configura username e Application Password.");
  const response = await fetchWithTimeout(`${siteUrl}/wp-json/wp/v2/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { message: text.slice(0, 500) }; }
  if (!response.ok) throw new Error(`WordPress ${response.status}: ${payload.message || payload.code || "richiesta rifiutata"}`);
  return payload;
}

async function fetchBlogCategories(blog) {
  const siteUrl = normalizeSiteUrl(blog.siteUrl);
  const categories = [];
  let totalPages = 1;
  for (let page = 1; page <= totalPages; page += 1) {
    const response = await fetchWithTimeout(`${siteUrl}/wp-json/wp/v2/categories?per_page=100&page=${page}&orderby=id&order=asc&_fields=id,name,slug,parent,count`, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      if (page > 1 && response.status === 400) break;
      const payload = await response.json().catch(() => ({}));
      throw new Error(`Categorie WordPress ${response.status}: ${payload.message || "richiesta rifiutata"}`);
    }
    const batch = await response.json();
    if (!Array.isArray(batch)) throw new Error("Risposta categorie WordPress non valida.");
    const reportedPages = Number(response.headers.get("x-wp-totalpages"));
    if (page === 1 && Number.isInteger(reportedPages) && reportedPages > 0) totalPages = Math.min(reportedPages, 1_000);
    categories.push(...batch.map((category) => ({ id: Number(category.id), name: String(category.name || ""), slug: String(category.slug || ""), parent: Number(category.parent) || 0, count: Number(category.count) || 0 })).filter((category) => Number.isInteger(category.id) && category.name));
    if (batch.length < 100) break;
  }
  return categories.sort((left, right) => left.name.localeCompare(right.name, "it", { sensitivity: "base" }));
}

async function enrichMedia(media) {
  const endpoint = media.provider === "youtube" ? `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(media.canonicalUrl)}` : `https://open.spotify.com/oembed?url=${encodeURIComponent(media.canonicalUrl)}`;
  try {
    const response = await fetchWithTimeout(endpoint, { headers: { Accept: "application/json" } }, 7_000);
    if (!response.ok) return media;
    const payload = await response.json();
    return { ...media, title: String(payload.title || media.title), thumbnailUrl: typeof payload.thumbnail_url === "string" ? payload.thumbnail_url : undefined };
  } catch { return media; }
}

function addHistory(kind, detail, itemId) {
  state.history.unshift({ id: randomUUID(), kind, detail, itemId: itemId || null, at: new Date().toISOString() });
  state.history = state.history.slice(0, 300);
}

async function publishOne() {
  if (publishing) return null;
  const item = state.queue.find((entry) => entry.status === "queued");
  if (!item) return null;
  publishing = true;
  item.status = "publishing";
  item.attempts = (item.attempts || 0) + 1;
  item.lastError = "";
  await saveState();
  try {
    let publishedMedia = item.article.media || [];
    if (state.library.items.length && !item.mediaSelectedFromLibrary) {
      const selection = selectLibraryMedia(state.library.items, state.library);
      publishedMedia = selection.media;
      item.article.media = publishedMedia;
      item.mediaSelectedFromLibrary = true;
      item.selectionNextTracksSincePlaylist = selection.tracksSincePlaylist;
      await saveState();
    }
    const targetBlogs = item.blogIds.map((id) => state.blogs.find((blog) => blog.id === id));
    if (!targetBlogs.length || targetBlogs.some((blog) => !blog)) throw new Error("Uno o più blog selezionati non sono più disponibili.");
    const pendingBlogs = targetBlogs.filter((blog) => item.blogResults?.[blog.id]?.status !== "published");
    const outcomes = await Promise.all(pendingBlogs.map(async (blog) => {
      try {
        const content = `${centerEmbeddedImages(item.article.content)}${renderEmbedSection(publishedMedia, blog.name)}`;
        const payload = await wpRequest("posts", {
          title: item.article.title,
          content,
          status: blog.defaultStatus || "publish",
          ...(item.article.excerpt ? { excerpt: item.article.excerpt } : {}),
          ...(item.article.slug ? { slug: item.article.slug } : {}),
          ...((item.categoriesByBlog?.[blog.id] || item.article.categories).length ? { categories: item.categoriesByBlog?.[blog.id] || item.article.categories } : {}),
          ...(item.article.tags.length ? { tags: item.article.tags } : {}),
        }, blog);
        return { blog, status: "published", wordpressId: payload.id, wordpressUrl: payload.link || "", publishedAt: new Date().toISOString() };
      } catch (error) {
        return { blog, status: "failed", error: error instanceof Error ? error.message : String(error) };
      }
    }));
    item.blogResults ||= {};
    for (const outcome of outcomes) {
      item.blogResults[outcome.blog.id] = outcome.status === "published"
        ? { status: "published", wordpressId: outcome.wordpressId, wordpressUrl: outcome.wordpressUrl, publishedAt: outcome.publishedAt }
        : { status: "failed", error: outcome.error };
    }
    const successes = outcomes.filter((outcome) => outcome.status === "published");
    if (successes.length && item.mediaSelectedFromLibrary && !item.selectionCounted) {
      state.library.tracksSincePlaylist = item.selectionNextTracksSincePlaylist;
      item.selectionCounted = true;
    }
    if (successes.length) {
      const publishedAt = successes[successes.length - 1].publishedAt;
      for (const media of publishedMedia) {
        const key = `${media.provider}:${media.kind}:${media.id}`;
        const previous = state.stats[key];
        state.stats[key] = { ...media, publishCount: (previous?.publishCount || 0) + successes.length, firstPublishedAt: previous?.firstPublishedAt || publishedAt, lastPublishedAt: publishedAt };
      }
      const first = successes[0];
      item.wordpressId ||= first.wordpressId;
      item.wordpressUrl ||= first.wordpressUrl;
    }
    const allPublished = item.blogIds.every((id) => item.blogResults[id]?.status === "published");
    if (allPublished) {
      item.status = "published";
      item.publishedAt = new Date().toISOString();
      item.lastError = "";
      addHistory("published", `Pubblicato “${item.article.title}” su ${item.blogIds.length} blog`, item.id);
    } else {
      item.status = "failed";
      item.lastError = targetBlogs.filter((blog) => item.blogResults[blog.id]?.status === "failed").map((blog) => `${blog.name}: ${item.blogResults[blog.id].error}`).join(" · ");
      addHistory("failed", `Pubblicazione parziale “${item.article.title}”: ${successes.length}/${item.blogIds.length} blog completati`, item.id);
    }
  } catch (error) {
    item.status = "failed";
    item.lastError = error instanceof Error ? error.message : String(error);
    addHistory("failed", `Errore “${item.article.title}”: ${item.lastError}`, item.id);
  } finally {
    publishing = false;
    await saveState();
  }
  return item;
}

function pendingCount() { return state.queue.filter((item) => item.status === "queued").length; }

async function schedulerTick() {
  timer = null;
  if (!state.schedule.enabled || !pendingCount()) return;
  const batchSize = Math.max(1, Math.min(100, Math.round(Number(state.schedule.postsPerRun) || 1)));
  for (let index = 0; index < batchSize && pendingCount(); index += 1) await publishOne();
  if (state.schedule.enabled && pendingCount()) {
    state.schedule.nextRunAt = new Date(Date.now() + state.schedule.intervalMinutes * 60_000).toISOString();
    await saveState();
    armScheduler();
  } else {
    state.schedule.nextRunAt = null;
    await saveState();
  }
}

function armScheduler() {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!state.schedule.enabled || !pendingCount()) return;
  const due = Date.parse(state.schedule.nextRunAt || "") || Date.now();
  timer = setTimeout(() => void schedulerTick(), Math.max(250, Math.min(due - Date.now(), 2_147_000_000)));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 6_000_000) throw new Error("Richiesta troppo grande (massimo 6 MB).");
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

async function api(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/state") return sendJson(response, 200, publicState());
  if (request.method === "GET" && url.pathname === "/api/library/export") {
    return sendJson(response, 200, {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: { tracksPerPost: state.library.tracksPerPost, playlistEveryTracks: state.library.playlistEveryTracks },
      items: [...new Map(state.library.items.map((item) => [libraryMediaKey(item), item])).values()],
    });
  }
  if (request.method === "POST" && url.pathname === "/api/blogs") {
    const input = await readJson(request);
    const existing = state.blogs.find((blog) => blog.id === input.id);
    const siteUrl = normalizeSiteUrl(input.siteUrl);
    const name = String(input.name || "").trim() || new URL(siteUrl).hostname.replace(/^www\./i, "");
    const blog = existing || { id: randomUUID(), password: null, categories: [], categoriesSyncedAt: null };
    blog.name = name;
    blog.siteUrl = siteUrl;
    blog.username = String(input.username || "").trim();
    blog.defaultStatus = input.defaultStatus === "draft" ? "draft" : "publish";
    if (String(input.password || "").trim()) blog.password = await encryptSecret(String(input.password).replace(/\s+/g, ""));
    if (!existing) state.blogs.push(blog);
    try { blog.categories = await fetchBlogCategories(blog); blog.categoriesSyncedAt = new Date().toISOString(); delete blog.categoryError; }
    catch (error) { blog.categoryError = error instanceof Error ? error.message : String(error); }
    addHistory(existing ? "blog-updated" : "blog-added", `${existing ? "Aggiornato" : "Aggiunto"} blog “${blog.name}”`);
    await saveState();
    return sendJson(response, 200, publicState());
  }
  if (request.method === "POST" && url.pathname === "/api/blogs/test") {
    const input = await readJson(request);
    const started = Date.now();
    const existing = state.blogs.find((blog) => blog.id === input.id) || {};
    const user = await wpRequest("users/me?context=edit", undefined, existing, input);
    return sendJson(response, 200, { ok: true, latencyMs: Date.now() - started, name: user.name, roles: user.roles || [] });
  }
  const categoryMatch = url.pathname.match(/^\/api\/blogs\/([^/]+)\/categories$/);
  if (request.method === "POST" && categoryMatch) {
    const blog = state.blogs.find((entry) => entry.id === decodeURIComponent(categoryMatch[1]));
    if (!blog) return sendJson(response, 404, { error: "Blog non trovato" });
    try {
      blog.categories = await fetchBlogCategories(blog);
      blog.categoriesSyncedAt = new Date().toISOString();
      delete blog.categoryError;
      await saveState();
      return sendJson(response, 200, publicState());
    } catch (error) {
      blog.categoryError = error instanceof Error ? error.message : String(error);
      await saveState();
      throw error;
    }
  }
  const blogMatch = url.pathname.match(/^\/api\/blogs\/([^/]+)\/remove$/);
  if (request.method === "POST" && blogMatch) {
    const id = decodeURIComponent(blogMatch[1]);
    const blog = state.blogs.find((entry) => entry.id === id);
    if (!blog) return sendJson(response, 404, { error: "Blog non trovato" });
    if (state.queue.some((item) => ["queued", "publishing", "failed"].includes(item.status) && item.blogIds?.includes(id))) throw new Error("Il blog è associato ad articoli ancora in coda. Rimuovi prima quegli articoli.");
    state.blogs = state.blogs.filter((entry) => entry.id !== id);
    addHistory("blog-removed", `Rimosso blog “${blog.name}”`);
    await saveState();
    return sendJson(response, 200, publicState());
  }
  if (request.method === "POST" && url.pathname === "/api/import") {
    const input = await readJson(request);
    const document = parseArticleDocument(input.document);
    const blogIdsByArticle = document.articles.map((article, index) => {
      const requestedIds = Array.isArray(input.blogIdsByArticle?.[index]) ? [...new Set(input.blogIdsByArticle[index].map(String))] : state.blogs.length === 1 ? [state.blogs[0].id] : [];
      if (!requestedIds.length) throw new Error(`Articolo ${index + 1}: seleziona almeno un blog`);
      if (requestedIds.some((id) => !state.blogs.some((blog) => blog.id === id))) throw new Error(`Articolo ${index + 1}: contiene un blog non valido`);
      return requestedIds;
    });
    const enrichedArticles = await Promise.all(document.articles.map(async (article) => ({ ...article, media: await Promise.all(article.media.map(enrichMedia)) })));
    const imported = enrichedArticles.map((article, index) => {
      const requestedIds = blogIdsByArticle[index];
      const categoriesByBlog = Object.fromEntries(requestedIds.map((blogId) => {
        const blog = state.blogs.find((entry) => entry.id === blogId);
        const values = Array.isArray(input.categoriesByArticle?.[index]?.[blogId]) ? input.categoriesByArticle[index][blogId].map(Number).filter(Number.isInteger) : article.categories;
        const unique = [...new Set(values)];
        if (blog.categories?.length && unique.some((id) => !blog.categories.some((category) => category.id === id))) throw new Error(`Articolo ${index + 1}: categoria non valida per ${blog.name}`);
        return [blogId, unique];
      }));
      return { id: randomUUID(), article, blogIds: requestedIds, categoriesByBlog, blogResults: {}, status: "queued", createdAt: new Date().toISOString(), attempts: 0, lastError: "" };
    });
    state.queue.push(...imported);
    if (document.intervalMinutes) state.schedule.intervalMinutes = document.intervalMinutes;
    if (document.postsPerRun) state.schedule.postsPerRun = document.postsPerRun;
    addHistory("imported", `Importati ${imported.length} articoli`);
    await saveState();
    armScheduler();
    return sendJson(response, 200, { imported: imported.length, state: publicState() });
  }
  if (request.method === "POST" && url.pathname === "/api/library/item") {
    const input = await readJson(request);
    const recognized = await enrichMedia(recognizeMedia(input.url));
    const priority = Math.max(1, Math.min(100, Math.round(Number(input.priority) || 50)));
    const key = `${recognized.provider}:${recognized.kind}:${recognized.id}`;
    const existing = state.library.items.find((item) => `${item.provider}:${item.kind}:${item.id}` === key);
    if (existing) Object.assign(existing, recognized, { priority });
    else state.library.items.push({ ...recognized, priority, createdAt: new Date().toISOString() });
    addHistory(existing ? "library-updated" : "library-added", `${existing ? "Aggiornato" : "Aggiunto"} “${recognized.title}” nella libreria`);
    await saveState();
    return sendJson(response, 200, publicState());
  }
  if (request.method === "POST" && url.pathname === "/api/library/settings") {
    const input = await readJson(request);
    state.library.tracksPerPost = Math.max(1, Math.min(10, Math.round(Number(input.tracksPerPost) || 1)));
    state.library.playlistEveryTracks = Math.max(1, Math.min(10_000, Math.round(Number(input.playlistEveryTracks) || 10)));
    await saveState();
    return sendJson(response, 200, publicState());
  }
  if (request.method === "POST" && url.pathname === "/api/library/import") {
    const input = await readJson(request);
    const mode = input.mode === "replace" ? "replace" : "append";
    const importedDocument = parseLibraryDocument(input.document);
    const uniqueCurrent = [...new Map(state.library.items.map((item) => [libraryMediaKey(item), item])).values()];
    let duplicates = importedDocument.duplicateCount;
    let imported;
    if (mode === "replace") {
      state.library.items = importedDocument.items;
      state.library.tracksPerPost = importedDocument.settings.tracksPerPost;
      state.library.playlistEveryTracks = importedDocument.settings.playlistEveryTracks;
      state.library.tracksSincePlaylist = 0;
      imported = importedDocument.items.length;
    } else {
      duplicates += state.library.items.length - uniqueCurrent.length;
      const existingKeys = new Set(uniqueCurrent.map(libraryMediaKey));
      const additions = importedDocument.items.filter((item) => {
        const key = libraryMediaKey(item);
        if (existingKeys.has(key)) { duplicates += 1; return false; }
        existingKeys.add(key);
        return true;
      });
      state.library.items = [...uniqueCurrent, ...additions];
      imported = additions.length;
    }
    addHistory("library-imported", `Libreria ${mode === "replace" ? "sostituita" : "ampliata"}: ${imported} elementi importati, ${duplicates} duplicati ignorati`);
    await saveState();
    return sendJson(response, 200, { imported, duplicates, mode, state: publicState() });
  }
  const libraryMatch = url.pathname.match(/^\/api\/library\/([^/]+)\/(update|remove)$/);
  if (request.method === "POST" && libraryMatch) {
    const key = decodeURIComponent(libraryMatch[1]);
    const item = state.library.items.find((entry) => `${entry.provider}:${entry.kind}:${entry.id}` === key);
    if (!item) return sendJson(response, 404, { error: "Elemento della libreria non trovato" });
    if (libraryMatch[2] === "remove") {
      state.library.items = state.library.items.filter((entry) => entry !== item);
      addHistory("library-removed", `Rimosso “${item.title}” dalla libreria`);
    } else {
      const input = await readJson(request);
      item.priority = Math.max(1, Math.min(100, Math.round(Number(input.priority) || 1)));
    }
    await saveState();
    return sendJson(response, 200, publicState());
  }
  if (request.method === "POST" && url.pathname === "/api/schedule") {
    const input = await readJson(request);
    state.schedule.intervalMinutes = Math.max(1, Math.min(10_080, Math.round(Number(input.intervalMinutes) || 15)));
    state.schedule.postsPerRun = Math.max(1, Math.min(100, Math.round(Number(input.postsPerRun) || 1)));
    state.schedule.enabled = Boolean(input.enabled);
    state.schedule.nextRunAt = state.schedule.enabled && pendingCount() ? new Date(input.publishNow ? Date.now() : Date.now() + state.schedule.intervalMinutes * 60_000).toISOString() : null;
    addHistory(state.schedule.enabled ? "schedule-started" : "schedule-paused", state.schedule.enabled ? `Coda avviata: ${state.schedule.postsPerRun} articoli ogni ${state.schedule.intervalMinutes} minuti` : "Coda in pausa");
    await saveState();
    armScheduler();
    return sendJson(response, 200, publicState());
  }
  if (request.method === "POST" && url.pathname === "/api/publish-next") {
    const item = await publishOne();
    return sendJson(response, 200, { item, state: publicState() });
  }
  if (request.method === "POST" && url.pathname === "/api/queue/clear") {
    if (publishing || state.queue.some((item) => item.status === "publishing")) throw new Error("Attendi il termine della pubblicazione in corso prima di svuotare la coda.");
    const removed = state.queue.length;
    state.queue = [];
    state.schedule.enabled = false;
    state.schedule.nextRunAt = null;
    addHistory("queue-cleared", `Svuotata la coda: rimossi ${removed} articoli`);
    await saveState();
    armScheduler();
    return sendJson(response, 200, publicState());
  }
  const itemMatch = url.pathname.match(/^\/api\/queue\/([^/]+)\/(retry|remove)$/);
  if (request.method === "POST" && itemMatch) {
    const item = state.queue.find((entry) => entry.id === itemMatch[1]);
    if (!item) return sendJson(response, 404, { error: "Elemento non trovato" });
    if (itemMatch[2] === "retry" && item.status === "failed") { item.status = "queued"; item.lastError = ""; }
    if (itemMatch[2] === "remove" && !["published", "publishing"].includes(item.status)) state.queue = state.queue.filter((entry) => entry.id !== item.id);
    await saveState();
    armScheduler();
    return sendJson(response, 200, publicState());
  }
  if (request.method === "POST" && url.pathname === "/api/clear-history") {
    state.history = [];
    await saveState();
    return sendJson(response, 200, publicState());
  }
  return sendJson(response, 404, { error: "Endpoint non trovato" });
}

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".json": "application/json" };
async function serveProduction(request, response, url) {
  const dist = join(projectRoot, "dist");
  const requested = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.(\/|\\|$))+/, "");
  let path = resolve(dist, `.${requested}`);
  if (!path.startsWith(dist) || !existsSync(path) || url.pathname === "/") path = join(dist, "index.html");
  try { const body = await readFile(path); response.writeHead(200, { "Content-Type": mime[extname(path)] || "application/octet-stream" }); response.end(body); }
  catch { response.writeHead(404); response.end("Not found"); }
}

await loadState();
if (state.schedule.enabled && pendingCount()) {
  // A missed slot is due immediately; a future slot keeps its original time.
  if (!state.schedule.nextRunAt || Date.parse(state.schedule.nextRunAt) <= Date.now()) state.schedule.nextRunAt = new Date(Date.now() + 750).toISOString();
  await saveState();
}
armScheduler();
let vite;
if (development) {
  const { createServer: createViteServer } = await import("vite");
  vite = await createViteServer({ root: projectRoot, server: { middlewareMode: true }, appType: "spa" });
}
const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const origin = String(request.headers.origin || "");
  if (/^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|tauri:\/\/localhost|https:\/\/tauri\.localhost)$/.test(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
  try {
    if (url.pathname.startsWith("/api/")) return await api(request, response, url);
    if (vite) return vite.middlewares(request, response, () => { response.writeHead(404); response.end("Not found"); });
    return await serveProduction(request, response, url);
  } catch (error) { return sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) }); }
});
server.listen(port, "127.0.0.1", () => console.log(`MLSM AutoPost: http://127.0.0.1:${port}${development ? " (development)" : ""}`));
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => { if (timer) clearTimeout(timer); server.close(() => process.exit(0)); });
