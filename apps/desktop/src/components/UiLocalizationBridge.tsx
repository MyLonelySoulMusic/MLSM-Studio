import { useEffect } from "react";
import { localizeUiText } from "../services/ui-localization";
import { useUiPreferences, type UiLanguage } from "../services/ui-preferences";

const textState = new WeakMap<Text, { source: string; output: string }>();
const attributeState = new WeakMap<Element, Map<string, { source: string; output: string }>>();
const translatedAttributes = ["aria-label", "title", "placeholder", "alt"] as const;

function excluded(node: Node) {
  const element = node instanceof Element ? node : node.parentElement;
  return Boolean(element?.closest("script, style, code, pre, [data-no-localize]"));
}

function localizeTextNode(node: Text, language: UiLanguage) {
  if (excluded(node)) return;
  const current = node.nodeValue ?? "";
  const previous = textState.get(node);
  const source = previous && current === previous.output ? previous.source : current;
  const output = localizeUiText(source, language);
  textState.set(node, { source, output });
  if (current !== output) node.nodeValue = output;
}

function localizeAttributes(element: Element, language: UiLanguage) {
  if (excluded(element)) return;
  let states = attributeState.get(element);
  if (!states) { states = new Map(); attributeState.set(element, states); }
  for (const attribute of translatedAttributes) {
    const current = element.getAttribute(attribute);
    if (current === null) continue;
    const previous = states.get(attribute);
    const source = previous && current === previous.output ? previous.source : current;
    const output = localizeUiText(source, language);
    states.set(attribute, { source, output });
    if (current !== output) element.setAttribute(attribute, output);
  }
}

function localizeTree(root: Node, language: UiLanguage) {
  if (root instanceof Text) { localizeTextNode(root, language); return; }
  if (root instanceof Element) localizeAttributes(root, language);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node instanceof Text) localizeTextNode(node, language);
    else if (node instanceof Element) localizeAttributes(node, language);
    node = walker.nextNode();
  }
}

export function UiLocalizationBridge() {
  const { language } = useUiPreferences();
  useEffect(() => {
    const root = document.getElementById("root") ?? document.body;
    localizeTree(root, language);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") localizeTree(mutation.target, language);
        else if (mutation.type === "attributes" && mutation.target instanceof Element) localizeAttributes(mutation.target, language);
        else for (const node of mutation.addedNodes) localizeTree(node, language);
      }
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...translatedAttributes] });
    return () => observer.disconnect();
  }, [language]);
  return null;
}

