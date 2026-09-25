import { centerEmbeddedImages, escapeHtml, renderEmbedSection } from "./media.mjs";
import type { ArticleInput } from "./types";

const allowedImageUrl = (value: string): string => {
  const candidate = value.trim();
  return /^(https?:|blob:|data:image\/)/i.test(candidate) ? candidate : "";
};

export function articleImageUrl(article: ArticleInput): string {
  if (typeof DOMParser !== "undefined") {
    const document = new DOMParser().parseFromString(article.content, "text/html");
    const image = document.querySelector("img");
    if (image) {
      for (const attribute of ["src", "data-src", "data-lazy-src"]) {
        const value = allowedImageUrl(image.getAttribute(attribute) ?? "");
        if (value) return value;
      }
      const firstSource = (image.getAttribute("srcset") ?? "").split(",")[0]?.trim().split(/\s+/)[0] ?? "";
      const value = allowedImageUrl(firstSource);
      if (value) return value;
    }
  }
  const match = article.content.match(/<img\b[^>]*(?:src|data-src|data-lazy-src)\s*=\s*["']([^"']+)["']/i);
  return allowedImageUrl(match?.[1] ?? "") || article.media.find(item => item.thumbnailUrl)?.thumbnailUrl || "";
}

function safeArticleContent(content: string): string {
  if (typeof DOMParser === "undefined") return centerEmbeddedImages(content.replace(/<script\b[\s\S]*?<\/script>/gi, ""));
  const document = new DOMParser().parseFromString(content, "text/html");
  document.querySelectorAll("script,base,meta[http-equiv],object,embed,form,input,button,link[rel=stylesheet]").forEach(node => node.remove());
  document.querySelectorAll("*").forEach(element => {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name) || attribute.name.toLowerCase() === "srcdoc") element.removeAttribute(attribute.name);
      if (["href", "src", "poster", "action"].includes(attribute.name.toLowerCase()) && /^\s*javascript:/i.test(attribute.value)) element.removeAttribute(attribute.name);
    }
  });
  return centerEmbeddedImages(document.body.innerHTML);
}

export function articlePreviewDocument(article: ArticleInput, language: "it" | "en", blogName = "Music"): string {
  const description = article.excerpt ? `<p class="post-excerpt">${escapeHtml(article.excerpt)}</p>` : "";
  const embeds = article.media.length ? renderEmbedSection(article.media, blogName) : "";
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
  :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f5f2f4;color:#211b1f;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.site-bar{height:8px;background:#ff4f9a}.post-shell{width:min(820px,calc(100% - 32px));margin:0 auto;padding:50px 0 80px}.post-kicker{display:block;margin-bottom:14px;color:#c43c77;font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase}.post-title{max-width:760px;margin:0;color:#211b1f;font-size:clamp(34px,6vw,64px);font-weight:750;line-height:1.04;letter-spacing:-.045em}.post-excerpt{max-width:720px;margin:22px 0 0;color:#73656d;font-size:18px;line-height:1.65}.post-content{margin-top:42px;padding:clamp(24px,5vw,54px);border:1px solid #e7dfe4;border-radius:22px;background:#fff;box-shadow:0 20px 70px rgba(33,27,31,.08);font-size:17px;line-height:1.8;overflow-wrap:anywhere}.post-content>:first-child{margin-top:0}.post-content>:last-child{margin-bottom:0}.post-content h2,.post-content h3{margin:1.7em 0 .55em;line-height:1.2}.post-content p{margin:0 0 1.25em}.post-content figure{margin:30px 0}.post-content img{display:block;max-width:100%;height:auto;margin-inline:auto;border-radius:13px}.post-content figcaption{margin-top:9px;color:#8c7d85;font-size:12px;text-align:center}.post-content a{color:#bd3f77}.post-content blockquote{margin:28px 0;padding:4px 0 4px 22px;border-left:4px solid #ff4f9a;color:#5d5057}.post-content iframe{max-width:100%;border:0;border-radius:12px}@media(max-width:600px){.post-shell{width:min(100% - 20px,820px);padding-top:28px}.post-content{padding:22px}.post-title{font-size:36px}}
  </style></head><body><div class="site-bar"></div><main class="post-shell"><span class="post-kicker">MLSM · ${language === "it" ? "ANTEPRIMA ARTICOLO" : "ARTICLE PREVIEW"}</span><h1 class="post-title">${escapeHtml(article.title)}</h1>${description}<article class="post-content">${safeArticleContent(article.content)}${embeds}</article></main></body></html>`;
}
