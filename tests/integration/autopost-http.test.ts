// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
// @ts-expect-error Runtime service module has no TypeScript declaration.
import { fetchWithTimeout } from "../../tools/autopost/http.mjs";

afterEach(() => vi.unstubAllGlobals());

it("follows the www redirect preserving the WordPress POST and credentials", async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(new Response(null, { status: 301, headers: { Location: "https://www.example.com/wp-json/wp/v2/posts" } }))
    .mockResolvedValueOnce(new Response('{"id":1}'));
  vi.stubGlobal("fetch", fetcher);
  const options = { method: "POST", headers: { Authorization: "Basic test" }, body: '{"title":"Post"}' };
  const response = await fetchWithTimeout("https://example.com/wp-json/wp/v2/posts", options);
  expect(await response.json()).toEqual({ id: 1 });
  expect(String(fetcher.mock.calls[1][0])).toBe("https://www.example.com/wp-json/wp/v2/posts");
  expect(fetcher.mock.calls[1][1]).toMatchObject({ ...options, redirect: "manual" });
});

it.each(["https://other.example/posts", "http://example.com/posts", "https://example.com:444/posts", "https://user:pass@example.com/posts"])("blocks unsafe redirect %s before sending credentials", async location => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { Location: location } }));
  vi.stubGlobal("fetch", fetcher);
  await expect(fetchWithTimeout("https://example.com/posts", { headers: { Authorization: "Basic test" } })).rejects.toThrow(/indirizzo finale/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("limits redirect loops", async () => {
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(null, { status: 307, headers: { Location: "/posts" } })));
  vi.stubGlobal("fetch", fetcher);
  await expect(fetchWithTimeout("https://example.com/posts")).rejects.toThrow(/Troppi reindirizzamenti/);
  expect(fetcher).toHaveBeenCalledTimes(6);
});

it("reports the DNS failure instead of fetch failed", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } })));
  await expect(fetchWithTimeout("https://example.com")).rejects.toThrow(/DNS/);
});

it("does not replay a POST redirected with 303", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 303, headers: { Location: "/login" } }));
  vi.stubGlobal("fetch", fetcher);
  await expect(fetchWithTimeout("https://example.com/posts", { method: "POST" })).rejects.toThrow(/303/);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
