/* global AbortController, setTimeout, clearTimeout, URL, fetch */
/** Follow canonical same-site redirects without forwarding credentials to other sites. */
export async function fetchWithTimeout(url, options = {}, milliseconds = 20_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), milliseconds);
  let current = new URL(url);
  try {
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const response = await fetch(current, { ...options, signal: controller.signal, redirect: "manual" });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Reindirizzamento WordPress senza destinazione.");
      const next = new URL(location, current);
      const sameOrigin = next.origin === current.origin;
      const canonicalHost = current.protocol === "https:" && next.protocol === "https:"
        && current.port === next.port
        && current.hostname.replace(/^www\./, "") === next.hostname.replace(/^www\./, "");
      if ((!sameOrigin && !canonicalHost) || next.username || next.password) {
        throw new Error("Il sito reindirizza verso un altro dominio. Configura in AutoPost l’indirizzo finale del blog.");
      }
      if (response.status === 303 && !["GET", "HEAD"].includes(options.method || "GET")) {
        throw new Error("Il sito reindirizza la pubblicazione con HTTP 303. Configura l’indirizzo finale del blog.");
      }
      current = next;
    }
    throw new Error("Troppi reindirizzamenti del sito WordPress.");
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Connessione WordPress scaduta: il sito non ha risposto in tempo.");
    if (error?.message === "fetch failed") {
      const code = error.cause?.code;
      const detail = code === "ENOTFOUND" || code === "EAI_AGAIN" ? "dominio non risolto dal DNS"
        : code === "ECONNREFUSED" ? "connessione rifiutata dal server"
        : code?.includes("CERT") || code?.includes("TLS") || code?.includes("SSL") ? "verifica del certificato HTTPS fallita"
        : code || "connessione di rete non riuscita";
      throw new Error(`Connessione a ${current.hostname} fallita: ${detail}.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
