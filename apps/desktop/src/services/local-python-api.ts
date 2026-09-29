const directUpscalerOrigin = "http://127.0.0.1:8765";
const viteUpscalerProxy = "/__mlsm/upscaler-api";

/**
 * Browser development uses Vite as a same-origin bridge. This avoids Windows
 * WebView/browser CORS, Private Network Access and localhost IPv4/IPv6 policy
 * differences. The packaged Tauri application talks to the owned process
 * directly because no Vite server exists there.
 */
export function localUpscalerApiBaseUrl(scope: typeof globalThis = globalThis): string {
  return "__TAURI_INTERNALS__" in scope ? directUpscalerOrigin : viteUpscalerProxy;
}

export { directUpscalerOrigin, viteUpscalerProxy };
