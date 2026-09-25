import { useEffect } from "react";
import type { ArticleInput } from "./types";
import { articlePreviewDocument } from "./article-preview";

export function ArticlePreviewModal({ article, language, blogName, onClose }: { article: ArticleInput; language: "it" | "en"; blogName?: string | undefined; onClose: () => void }) {
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return <div className="autopost-article-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="autopost-article-modal" role="dialog" aria-modal="true" aria-labelledby="autopost-preview-title">
      <header><div><small>MLSM AUTOPOST · PREVIEW</small><h2 id="autopost-preview-title">{article.title}</h2><p>{language === "it" ? "Anteprima editoriale del contenuto che sarà inviato a WordPress." : "Editorial preview of the content that will be sent to WordPress."}</p></div><button type="button" aria-label={language === "it" ? "Chiudi anteprima" : "Close preview"} onClick={onClose}>×</button></header>
      <iframe title={`${language === "it" ? "Anteprima" : "Preview"}: ${article.title}`} sandbox="allow-presentation" referrerPolicy="no-referrer" srcDoc={articlePreviewDocument(article, language, blogName)} />
    </section>
  </div>;
}
