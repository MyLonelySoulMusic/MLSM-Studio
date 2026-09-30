import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";

const route = "/__mlsm/postit/favicon";
const maxHtmlBytes = 1024 * 1024;
const maxIconBytes = 512 * 1024;
const chatGptFavicon = "https://cdn.oaistatic.com/assets/favicon-miwirzcw.ico";
const blocked = new BlockList();
for (const [network, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32]] as const) blocked.addSubnet(network, prefix, "ipv6");

function json(response: ServerResponse, status: number, payload: unknown) { response.statusCode = status; response.setHeader("Content-Type", "application/json; charset=utf-8"); response.setHeader("Cache-Control", "no-store"); response.end(JSON.stringify(payload)); }

async function body(request: IncomingMessage): Promise<{ url?: unknown }> {
  const chunks: Buffer[] = []; let total = 0;
  for await (const chunk of request) { const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array); total += value.byteLength; if (total > 16 * 1024) throw new Error("Richiesta troppo grande."); chunks.push(value); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as { url?: unknown } : {};
}

async function validatePublicUrl(value: URL): Promise<void> {
  if (!/^(https?):$/u.test(value.protocol) || value.username || value.password) throw new Error("Sono consentiti soltanto URL HTTP/HTTPS pubblici senza credenziali.");
  if (!value.hostname || value.hostname === "localhost" || value.hostname.endsWith(".localhost") || value.hostname.endsWith(".local")) throw new Error("Gli indirizzi locali non sono consentiti.");
  const directFamily = isIP(value.hostname);
  const addresses = directFamily ? [{ address: value.hostname, family: directFamily }] : await lookup(value.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address, family }) => blocked.check(address, family === 6 ? "ipv6" : "ipv4"))) throw new Error("Il dominio punta a un indirizzo locale o riservato.");
}

async function limitedBytes(response: Response, maximum: number): Promise<Uint8Array> {
  const length = Number(response.headers.get("content-length") || 0); if (length > maximum) throw new Error("Risorsa troppo grande.");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > maximum) { await reader.cancel(); throw new Error("Risorsa troppo grande."); } chunks.push(value); }
  const result = new Uint8Array(total); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; } return result;
}

async function safeFetch(initial: URL, maximum: number): Promise<{ url: URL; bytes: Uint8Array; type: string }> {
  let current = initial;
  for (let redirect = 0; redirect <= 4; redirect += 1) {
    await validatePublicUrl(current);
    const response = await fetch(current, { redirect: "manual", signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "MLSM-Studio/0.1 favicon" } });
    if (response.status >= 300 && response.status < 400) { const location = response.headers.get("location"); if (!location) throw new Error("Redirect non valido."); current = new URL(location, current); continue; }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { url: current, bytes: await limitedBytes(response, maximum), type: (response.headers.get("content-type") || "").split(";")[0]!.trim().toLowerCase() };
  }
  throw new Error("Troppi redirect.");
}

function attribute(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); const match = new RegExp(`\\b${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "iu").exec(tag);
  return (match?.[1] ?? match?.[2] ?? match?.[3])?.trim() || undefined;
}

function iconCandidates(html: string, page: URL): URL[] {
  const result: URL[] = [];
  for (const match of html.matchAll(/<link\b[^>]*>/gisu)) { const tag = match[0]; const rel = attribute(tag, "rel")?.toLowerCase() ?? ""; const href = attribute(tag, "href"); if (href && rel.split(/\s+/u).some((token) => token === "icon" || token === "shortcut")) { try { result.push(new URL(href, page)); } catch { /* Ignore malformed icon links. */ } } }
  for (const path of ["/favicon.ico", "/apple-touch-icon.png", "/favicon.png"]) result.push(new URL(path, page));
  return [...new Map(result.map((value) => [value.href, value])).values()];
}

export function knownFaviconCandidates(page: URL): URL[] {
  const hostname = page.hostname.toLowerCase();
  if (hostname === "chatgpt.com" || hostname.endsWith(".chatgpt.com") || hostname === "chat.openai.com") return [new URL(chatGptFavicon)];
  return [];
}

function imageMime(type: string, bytes: Uint8Array): string | null {
  const starts = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return "image/png"; if (starts(0xff, 0xd8, 0xff)) return "image/jpeg"; if (new TextDecoder().decode(bytes.slice(0, 6)).match(/^GIF8[79]a$/u)) return "image/gif"; if (starts(0, 0, 1, 0)) return "image/x-icon";
  if (new TextDecoder().decode(bytes.slice(0, 256)).trimStart().match(/^(?:<\?xml[^>]*>\s*)?<svg\b/iu)) return "image/svg+xml";
  return ["image/png", "image/jpeg", "image/gif", "image/webp", "image/x-icon", "image/vnd.microsoft.icon", "image/svg+xml"].includes(type) ? (type === "image/vnd.microsoft.icon" ? "image/x-icon" : type) : null;
}

export async function resolvePostItFavicon(pageValue: string): Promise<string | null> {
  const page = new URL(pageValue); await validatePublicUrl(page);
  for (const candidate of knownFaviconCandidates(page)) { try { const icon = await safeFetch(candidate, maxIconBytes); const mime = imageMime(icon.type, icon.bytes); if (mime) return `data:${mime};base64,${Buffer.from(icon.bytes).toString("base64")}`; } catch { /* Continue with page discovery and conventional paths. */ } }
  let resolvedPage = page;
  let html = "";
  try {
    const document = await safeFetch(page, maxHtmlBytes);
    const directMime = imageMime(document.type, document.bytes);
    if (directMime) return `data:${directMime};base64,${Buffer.from(document.bytes).toString("base64")}`;
    resolvedPage = document.url;
    html = new TextDecoder().decode(document.bytes);
  } catch { /* Protected pages can still use a known or conventional favicon. */ }
  const candidates = iconCandidates(html, resolvedPage);
  for (const candidate of [...new Map(candidates.map((value) => [value.href, value])).values()]) { try { const icon = await safeFetch(candidate, maxIconBytes); const mime = imageMime(icon.type, icon.bytes); if (mime) return `data:${mime};base64,${Buffer.from(icon.bytes).toString("base64")}`; } catch { /* Try the next declared, known or conventional icon. */ } }
  return null;
}

export function postItFaviconService(): Plugin {
  return { name: "mlsm-postit-favicon", apply: "serve", configureServer(server) { server.middlewares.use(route, async (request, response) => { try { if (request.method !== "POST") return json(response, 405, { error: "Metodo non consentito." }); const payload = await body(request); if (typeof payload.url !== "string") return json(response, 400, { error: "Link non valido." }); return json(response, 200, { faviconUrl: await resolvePostItFavicon(payload.url) }); } catch (error) { return json(response, 422, { error: error instanceof Error ? error.message : String(error) }); } }); } };
}
