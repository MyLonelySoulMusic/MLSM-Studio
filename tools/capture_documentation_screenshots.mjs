/* eslint-disable no-undef */
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join } from "node:path";

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
const memoryOnly = process.argv.includes("--memory-only");

await rm(temporaryDirectory, { recursive: true, force: true });
await mkdir(temporaryDirectory, { recursive: true });
await mkdir(outputDirectory, { recursive: true });
await cp(sourceDist, temporaryDirectory, { recursive: true });

const publicRoots = ["backgrounds", "brand", "fonts", "favicon", "mlsm-studio"];
async function makeBuildFileSafe(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = new URL(entry.name, directory);
    if (entry.isDirectory()) { await makeBuildFileSafe(new URL(`${entry.name}/`, directory)); continue; }
    if (!/\.(?:html|css|js)$/.test(entry.name)) continue;
    let source = await readFile(path, "utf8");
    if (entry.name === "index.html") source = source.replace(/(["'])\/(assets\/)/g, "$1./$2");
    const rootPattern = new RegExp(`(["'(])\\/(${publicRoots.join("|")})`, "g");
    source = source.replace(rootPattern, `$1${temporaryDirectory.href}$2`);
    await writeFile(path, source);
  }
}
await makeBuildFileSafe(temporaryDirectory);

const chrome = spawn(chromeBinary, [
  "--headless=new", `--remote-debugging-port=${port}`, "--remote-allow-origins=*",
  "--enable-webgl", "--enable-unsafe-swiftshader", "--use-angle=swiftshader",
  "--disable-web-security", "--allow-file-access-from-files",
  "--no-first-run", "--no-default-browser-check", "--hide-scrollbars",
  "--window-size=1600,1000", `--user-data-dir=${join(temporaryDirectory.pathname, "profile")}`,
  new URL("index.html", temporaryDirectory).href,
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
  await delay(1_500);
  const result = await command("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  await writeFile(new URL(`${name}.png`, outputDirectory), Buffer.from(result.data, "base64"));
}
async function click(selector) {
  const clicked = await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; element.click(); return true; })()`);
  if (!clicked) throw new Error(`Elemento non trovato: ${selector}`);
}

try {
  await command("Page.enable"); await command("Runtime.enable"); await delay(2_000);
  await screenshot("01-welcome");
  await click(".welcome-splash__enter");
  await screenshot("02-home-areas");
  if (memoryOnly) {
    await click(".memory-button"); await screenshot("07-memory");
  } else {
    await click(".area-soundAnimation"); await screenshot("03-sound-animation");
    await click(".toolbar-home"); await click(".area-photoVideoStudio"); await screenshot("04-photo-video-studio");
    await click(".toolbar-home"); await click(".area-videoEditor"); await screenshot("05-video-editor");
    await click(".toolbar-home"); await click(".area-music"); await screenshot("06-ai-quantizer");
  }
} finally {
  socket.close();
  const exited = new Promise((resolve) => chrome.once("exit", resolve));
  chrome.kill("SIGTERM");
  await Promise.race([exited, delay(2_000)]);
  await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 });
}

console.log(`Screenshot salvati in ${outputDirectory.pathname.replace(projectRoot.pathname, "")}`);
