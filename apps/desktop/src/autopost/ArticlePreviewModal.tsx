import { useEffect, useMemo, useRef, useState } from "react";
import type { ArticleInput } from "./types";
import { articleImageUrl, articlePreviewDocument, replaceArticleImage } from "./article-preview";

export function ArticlePreviewModal({ article, language, blogName, onClose, onSave }: { article: ArticleInput; language: "it" | "en"; blogName?: string | undefined; onClose: () => void; onSave: (article: ArticleInput) => void }) {
  const [draft, setDraft] = useState(article);
  const [imageUrl, setImageUrl] = useState(() => articleImageUrl(article));
  const [error, setError] = useState("");
  const editorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setDraft(article);
    setImageUrl(articleImageUrl(article));
    setError("");
    if (editorRef.current) editorRef.current.innerHTML = article.content;
  }, [article]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  useEffect(() => {
    const bodyOverflow = document.body.style.overflow;
    const bodyPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
    document.body.style.overflow = "hidden";
    if (scrollbarWidth) document.body.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.body.style.paddingRight = bodyPaddingRight;
    };
  }, []);
  const previewArticle = useMemo(() => {
    try { return { ...draft, content: replaceArticleImage(draft.content, imageUrl) }; }
    catch { return draft; }
  }, [draft, imageUrl]);
  const save = () => {
    try {
      const title = draft.title.trim();
      const editedContent = editorRef.current?.innerHTML ?? draft.content;
      if (!title) throw new Error(language === "it" ? "Inserisci il titolo dell’articolo." : "Enter the article title.");
      if (!editedContent.trim()) throw new Error(language === "it" ? "Inserisci il testo dell’articolo." : "Enter the article text.");
      const content = replaceArticleImage(editedContent, imageUrl);
      onSave({ ...draft, title, excerpt: draft.excerpt.trim(), content });
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setError(language === "en" && /http:\/\/|https:\/\//.test(message) ? "Use a valid http:// or https:// image URL." : message);
    }
  };
  return <div className="autopost-article-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="autopost-article-modal" role="dialog" aria-modal="true" aria-labelledby="autopost-preview-title">
      <header><div><small>MLSM AUTOPOST · EDIT &amp; PREVIEW</small><h2 id="autopost-preview-title">{article.title}</h2><p>{language === "it" ? "Modifica il contenuto e controlla in tempo reale ciò che sarà inviato a WordPress." : "Edit the content and review in real time what will be sent to WordPress."}</p></div><button type="button" aria-label={language === "it" ? "Chiudi anteprima" : "Close preview"} onClick={onClose}>×</button></header>
      <div className="autopost-article-modal-workspace">
        <aside className="autopost-article-editor">
          <label>{language === "it" ? "Titolo" : "Title"}<input aria-label={language === "it" ? "Titolo articolo" : "Article title"} value={draft.title} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} /></label>
          <label>{language === "it" ? "Riassunto" : "Excerpt"}<textarea aria-label={language === "it" ? "Riassunto articolo" : "Article excerpt"} value={draft.excerpt} onChange={event => setDraft(current => ({ ...current, excerpt: event.target.value }))} /></label>
          <label>{language === "it" ? "Link immagine principale" : "Main image URL"}<input aria-label={language === "it" ? "Link immagine principale" : "Main image URL"} type="url" placeholder="https://…" value={imageUrl} onChange={event => { setImageUrl(event.target.value); setError(""); }} /><small>{language === "it" ? "Incolla un nuovo link oppure svuota il campo per rimuovere l’immagine." : "Paste a new link or clear the field to remove the image."}</small></label>
          <label>{language === "it" ? "Testo articolo" : "Article text"}<div ref={editorRef} className="autopost-article-rich-editor" role="textbox" aria-label={language === "it" ? "Testo articolo" : "Article text"} aria-multiline="true" contentEditable suppressContentEditableWarning onInput={event => { const content = event.currentTarget.innerHTML; setDraft(current => ({ ...current, content })); }} /></label>
          {error ? <p className="autopost-article-editor-error" role="alert">{error}</p> : null}
          <div className="autopost-article-editor-actions"><button type="button" onClick={onClose}>{language === "it" ? "Annulla" : "Cancel"}</button><button type="button" className="autopost-primary" onClick={save}>{language === "it" ? "Salva modifiche" : "Save changes"}</button></div>
        </aside>
        <iframe title={`${language === "it" ? "Anteprima" : "Preview"}: ${article.title}`} sandbox="allow-presentation" referrerPolicy="no-referrer" srcDoc={articlePreviewDocument(previewArticle, language, blogName)} />
      </div>
    </section>
  </div>;
}
