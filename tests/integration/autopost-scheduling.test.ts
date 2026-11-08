// @vitest-environment node
import { expect, it } from "vitest";
import { createServer } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

it("sends schedules to WordPress, persists them, and retries only failed destinations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "autopost-schedule-"));
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  let failSecond = true;
  const wordpress = createServer(async (request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.method !== "POST") { response.end("[]"); return; }
    let body = "";
    for await (const chunk of request) body += chunk;
    const parsed = JSON.parse(body);
    posts.push({ path: request.url!, body: parsed });
    if (request.url!.startsWith("/two") && failSecond) {
      response.statusCode = 500;
      response.end(JSON.stringify({ message: "Temporary failure" }));
    } else {
      response.end(JSON.stringify({ id: posts.length, status: parsed.status, date_gmt: parsed.date_gmt, link: "https://example.test/post" }));
    }
  });
  let child: ChildProcess | undefined;
  let base = "";
  async function start() {
    child = spawn(process.execPath, ["tools/autopost/server.mjs"], {
      env: { ...process.env, MLSM_AUTOPOST_PORT: "0", MLSM_AUTOPOST_DATA_DIR: directory },
      stdio: ["ignore", "pipe", "pipe"],
    });
    base = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("AutoPost startup timed out")), 8000);
      child!.once("error", reject);
      child!.once("exit", code => { clearTimeout(timeout); reject(new Error("AutoPost exited: " + code)); });
      child!.stdout!.on("data", chunk => {
        const match = String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timeout); resolve(match[0]); }
      });
    });
  }
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }
  async function api(path: string, body?: unknown) {
    const response = await fetch(base + "/api/" + path, body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    return response.json();
  }
  try {
    wordpress.listen(0, "127.0.0.1");
    await once(wordpress, "listening");
    const port = (wordpress.address() as { port: number }).port;
    await start();
    let state;
    for (const name of ["one", "two"]) {
      state = await api("blogs", { name, siteUrl: `http://127.0.0.1:${port}/${name}`, username: "test", password: "test", defaultStatus: "draft" });
    }
    const ids = state.blogs.map((blog: { id: string }) => blog.id);
    await api("import", {
      document: { articles: [{ title: "Future", content: "<p>Body</p>", status: "future", date_gmt: "2099-01-10T14:30:00" }] },
      blogIdsByArticle: [ids],
    });
    state = (await api("publish-next", {})).state;
    expect(state.queue[0].status).toBe("failed");
    expect(state.queue[0].blogResults[ids[0]].status).toBe("scheduled");
    expect(posts[0].body).toMatchObject({ status: "future", date_gmt: "2099-01-10T14:30:00" });
    failSecond = false;
    await api(`queue/${state.queue[0].id}/retry`, {});
    state = (await api("publish-next", {})).state;
    expect(posts.filter(post => post.path.startsWith("/one"))).toHaveLength(1);
    expect(state.queue[0]).toMatchObject({ status: "scheduled", scheduledAt: "2099-01-10T14:30:00Z" });
    expect(state.summary.scheduled).toBe(1);
    await stop();
    await start();
    expect((await api("state")).queue[0].status).toBe("scheduled");
    await api("publish-next", {});
    expect(posts).toHaveLength(3);
    await api("import", { document: [{ title: "Normal", content: "Body" }], blogIdsByArticle: [[ids[0]]] });
    await api("publish-next", {});
    expect(posts[3].body.status).toBe("draft");
    expect(posts[3].body).not.toHaveProperty("date_gmt");
  } finally {
    await stop();
    await new Promise<void>(resolve => wordpress.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);
