/* eslint-disable no-undef */
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { createServer } from "node:http";

const projectRoot = new URL("../", import.meta.url);
const sourceDist = new URL("../apps/desktop/dist/", import.meta.url);
const outputDirectory = new URL("../docs/screenshots/", import.meta.url);
const temporaryDirectory = new URL("mlsm-documentation-preview/", "file:///tmp/");
const chromeBinary = process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "google-chrome";
const port = 9_339;
const previewPort = 9_340;
const memoryOnly = process.argv.includes("--memory-only");
const verifyDocumentationScroll = process.argv.includes("--verify-documentation-scroll");
const verifyHomeSort = process.argv.includes("--verify-home-sort");

await rm(temporaryDirectory, { recursive: true, force: true });
await mkdir(temporaryDirectory, { recursive: true });
await mkdir(outputDirectory, { recursive: true });
await cp(sourceDist, temporaryDirectory, { recursive: true });

async function makeBuildFileSafe(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(entry.name, directory);
    if (entry.isDirectory()) { await makeBuildFileSafe(new URL(`${entry.name}/`, directory)); continue; }
    if (!/\.(?:html|css|js)$/.test(entry.name)) continue;
    let source = await readFile(path, "utf8");
    if (entry.name === "index.html") source = source.replace(/(["'])\/(assets\/)/g, "$1./$2");
    await writeFile(path, source);
  }
}
await makeBuildFileSafe(temporaryDirectory);

const mimeTypes = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".wasm": "application/wasm" };
const previewServer = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", `http://127.0.0.1:${previewPort}`).pathname);
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
    if (relative.includes("..")) throw new Error("Percorso non valido");
    const target = new URL(relative, temporaryDirectory);
    const extension = relative.slice(relative.lastIndexOf("."));
    const body = await readFile(target);
    response.writeHead(200, { "Content-Type": mimeTypes[extension] ?? "application/octet-stream", "Cache-Control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404); response.end("Not found");
  }
});
await new Promise((resolve, reject) => { previewServer.once("error", reject); previewServer.listen(previewPort, "127.0.0.1", resolve); });

const chrome = spawn(chromeBinary, [
  "--headless=new", `--remote-debugging-port=${port}`, "--remote-allow-origins=*",
  "--enable-webgl", "--enable-unsafe-swiftshader", "--use-angle=swiftshader",
  "--disable-web-security", "--allow-file-access-from-files",
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
  "--window-size=1600,1000", `--user-data-dir=${join(temporaryDirectory.pathname, "profile")}`,
  `http://127.0.0.1:${previewPort}/`,
], { stdio: "ignore" });

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function jsonEndpoint(path) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { const response = await fetch(`http://127.0.0.1:${port}${path}`); if (response.ok) return response.json(); }
    catch { /* Chrome non è ancora pronto. */ }
    await delay(100);
  }
  throw new Error("Chrome headless non ha aperto la porta di debug.");
}

const pages = await jsonEndpoint("/json/list");
const page = pages.find((candidate) => candidate.type === "page");
if (!page?.webSocketDebuggerUrl) throw new Error("Pagina di documentazione non trovata.");
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
let messageId = 0;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data));
  if (!message.id) return;
  const callback = pending.get(message.id); pending.delete(message.id);
  if (message.error) callback?.reject(new Error(message.error.message)); else callback?.resolve(message.result);
});
function command(method, params = {}) {
  const id = ++messageId;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result?.value;
}
async function screenshot(name) {
  if (verifyDocumentationScroll || verifyHomeSort) return;
  await delay(1_500);
  const result = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(new URL(`${name}.png`, outputDirectory), Buffer.from(result.data, "base64"));
}
async function waitForAnimations(selector, timeout = 6_000) {
  await evaluate(`(async () => {
    const elements = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const animations = elements.flatMap((element) => element.getAnimations({ subtree: true })).filter((animation) => animation.playState !== "finished");
    await Promise.race([Promise.allSettled(animations.map((animation) => animation.finished)), new Promise((resolve) => setTimeout(resolve, ${timeout}))]);
    return animations.length;
  })()`);
}
async function click(selector) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const clicked = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`);
    if (clicked) return;
    await delay(100);
  }
  throw new Error(`Elemento non trovato: ${selector}`);
}

try {
  await command("Page.enable"); await command("Runtime.enable"); await delay(2_000);
  // Headless Chrome can throttle requestAnimationFrame. Freeze the branded
  // presentation and apply its documented settled pose before the first shot.
  await click(".intro-motion"); await delay(150);
  await evaluate(`(() => {
    const root = document.querySelector(".welcome-splash--3d");
    if (!root) return false;
    root.dataset.copyReady = "true"; root.dataset.intro = "settled";
    const values = {
      "--intro-copy": "1", "--intro-copy-y": "0px", "--intro-reveal": "0%",
      "--intro-logo-opacity": "1", "--intro-wave": "0", "--intro-wave-dash": "0",
      "--intro-wave-y": "0px", "--intro-flight-x": "0px", "--intro-flight-y": "0px",
      "--intro-flight-scale": "1", "--intro-shadow": "1"
    };
    Object.entries(values).forEach(([name, value]) => root.style.setProperty(name, value));
    return true;
  })()`);
  await screenshot("01-welcome");
  await click(".intro-enter");
  await waitForAnimations(".studio-home");
  await screenshot("02-home-areas");
  if (verifyHomeSort) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await evaluate('Boolean(document.querySelector(".studio-home__usage-sort"))')) break;
      await delay(100);
    }
    await waitForAnimations(".studio-home");
    // This preview has an isolated temporary profile, never the user's data.
    await evaluate(`(() => {
      const tasks = ["reports", "reports", "reports", "photoVideoStudio", "photoVideoStudio", "audio"].map((areaId, index) => ({ id: String(index), areaId, label: "Preview activity", startedAt: index, status: "completed" }));
      localStorage.setItem("mlsm.task-history.v1", JSON.stringify(tasks));
      window.dispatchEvent(new Event("mlsm:task-history"));
    })()`);
    await delay(100);
    for (const viewport of [{ width: 1600, height: 1000 }, { width: 1024, height: 680 }]) {
      await command("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false });
      await delay(100);
      const original = await evaluate('[...document.querySelectorAll(".studio-area-card")].map(card => card.dataset.areaId)');
      for (const enabled of [true, false]) {
        await click(".studio-home__usage-sort");
        const state = await evaluate(`(() => {
          const cards = [...document.querySelectorAll(".studio-area-card")];
          const motion = cards.flatMap(card => card.getAnimations()).flatMap(animation => animation.effect.getKeyframes()).filter(frame => frame.translate);
          return { order: cards.map(card => card.dataset.areaId), motion: motion.map(frame => frame.translate), enabled: document.querySelector(".studio-home__usage-sort").getAttribute("aria-pressed") };
        })()`);
        const expected = enabled ? ["reports", "photoVideoStudio", "audio", ...original.filter(id => !["reports", "photoVideoStudio", "audio"].includes(id))] : original;
        if (JSON.stringify(state.order) !== JSON.stringify(expected) || state.enabled !== String(enabled) || !state.motion.some(value => value !== "0px 0px")) {
          throw new Error(`Home sort regression: ${JSON.stringify({ viewport, enabled, state })}`);
        }
        await waitForAnimations(".studio-area-grid");
        console.log(`Animated home sort OK: ${JSON.stringify({ viewport, enabled, order: state.order, movingKeyframes: state.motion.length })}`);
        if (enabled && viewport.width === 1600) {
          const shot = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
          await writeFile("/tmp/mlsm-home-usage-order.png", Buffer.from(shot.data, "base64"));
        }
      }
    }
  } else if (verifyDocumentationScroll) {
    await click(".area-documentation");
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await evaluate('Boolean(document.querySelector(".documentation-workspace"))')) break;
      await delay(100);
    }
    for (const viewport of [{ width: 1600, height: 1000 }, { width: 1024, height: 680 }, { width: 800, height: 600 }]) {
      await command("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false });
      await delay(100);
      const toolbarClear = await evaluate(`(() => {
        const controls = [...document.querySelector(".documentation-preferences").children];
        return controls.every((control, index) => {
          const rect = control.getBoundingClientRect();
          return rect.left >= 0 && rect.right <= innerWidth && controls.slice(index + 1).every((other) => {
            const next = other.getBoundingClientRect();
            return rect.right <= next.left || next.right <= rect.left || rect.bottom <= next.top || next.bottom <= rect.top;
          });
        });
      })()`);
      if (!toolbarClear) throw new Error(`Documentation toolbar overlaps at ${JSON.stringify(viewport)}`);
      await evaluate('document.querySelector(".documentation-workspace").scrollTop = 0');
      await command("Input.dispatchMouseEvent", { type: "mouseWheel", x: viewport.width - 180, y: viewport.height - 180, deltaX: 0, deltaY: 450 });
      await delay(250);
      const wheelScroll = await evaluate('document.querySelector(".documentation-workspace").scrollTop');
      if (wheelScroll <= 0) throw new Error(`Wheel scrolling blocked at ${JSON.stringify(viewport)}`);
      const metrics = await evaluate(`(() => {
        const area = document.querySelector(".documentation-workspace");
        if (!area) throw new Error("Documentation did not load");
        area.scrollTop = 0;
        area.scrollTop = 500;
        const afterScroll = area.scrollTop;
        area.scrollTop = area.scrollHeight;
        const last = area.querySelector(".documentation-topic:last-child");
        const bottomVisible = last.getBoundingClientRect().bottom <= area.getBoundingClientRect().bottom;
        area.scrollTop = 0;
        area.querySelector(".documentation-index a:last-child").click();
        return { height: area.clientHeight, contentHeight: area.scrollHeight, afterScroll, bottomVisible, anchorScroll: area.scrollTop };
      })()`);
      if (metrics.height > viewport.height || metrics.contentHeight <= metrics.height || metrics.afterScroll <= 0 || !metrics.bottomVisible || metrics.anchorScroll <= 0) {
        throw new Error(`Documentation scrolling regression: ${JSON.stringify({ viewport, metrics })}`);
      }
      console.log(`Documentation scrolling OK: ${JSON.stringify({ viewport, wheelScroll, metrics })}`);
    }
  } else if (memoryOnly) {
    await click(".memory-button"); await screenshot("07-memory");
  } else {
    await click(".area-soundAnimation"); await screenshot("03-sound-animation");
    await click(".toolbar-home"); await click(".area-photoVideoStudio"); await screenshot("04-photo-video-studio");
    await click(".toolbar-home"); await click(".area-videoEditor"); await screenshot("05-video-editor");
    await click(".toolbar-home"); await click(".area-music"); await screenshot("06-ai-quantizer");
    await click(".toolbar-home, .home-button"); await waitForAnimations(".studio-home"); await click(".area-documentation"); await screenshot("08-documentation");
  }
} finally {
  socket.close();
  const exited = new Promise((resolve) => chrome.once("exit", resolve));
  chrome.kill("SIGTERM");
  await Promise.race([exited, delay(2_000)]);
  await new Promise((resolve) => previewServer.close(resolve));
  await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 });
}

if (!verifyDocumentationScroll && !verifyHomeSort) console.log(`Screenshot salvati in ${outputDirectory.pathname.replace(projectRoot.pathname, "")}`);
