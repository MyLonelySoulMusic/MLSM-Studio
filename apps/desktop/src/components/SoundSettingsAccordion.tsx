import { useLayoutEffect, useRef, type ReactNode } from "react";

interface SoundSettingsAccordionProps {
  children: ReactNode;
  resetKey: string;
}

interface SettingsGroup {
  heading: HTMLElement;
  content: HTMLElement[];
}

const GROUP_HEADING_SELECTOR = "h2, .song-player-panel > h3";
const INTERACTIVE_SELECTOR = "button, input, select, textarea, [role='button'], [contenteditable='true']";

const isGroupHeading = (element: Element) =>
  element.tagName === "H2" || element.matches(".song-player-panel > h3");

const isEligibleHeading = (heading: HTMLElement) =>
  !heading.closest("[data-settings-accordion-ignore]");

const containsGroupHeading = (element: Element) =>
  Array.from(element.querySelectorAll<HTMLElement>(GROUP_HEADING_SELECTOR)).some(isEligibleHeading);

const containsInteractiveControl = (elements: HTMLElement[]) =>
  elements.some((element) => element.matches(INTERACTIVE_SELECTOR) || Boolean(element.querySelector(INTERACTIVE_SELECTOR)));

function collectGroupContent(heading: HTMLElement): HTMLElement[] {
  const semanticSection = heading.closest("section");
  if (semanticSection) {
    const sectionHeadings = Array.from(semanticSection.querySelectorAll<HTMLElement>(GROUP_HEADING_SELECTOR)).filter(isEligibleHeading);
    let headingBranch: HTMLElement = heading;
    while (headingBranch.parentElement && headingBranch.parentElement !== semanticSection) headingBranch = headingBranch.parentElement;
    if (sectionHeadings.length === 1 && headingBranch !== heading) {
      return Array.from(semanticSection.children)
        .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== headingBranch);
    }
  }

  const content: HTMLElement[] = [];
  let sibling = heading.nextElementSibling;
  // A structural wrapper containing other groups (for example Upscaler's fieldset)
  // is a boundary, never content of the preceding group. Otherwise closing the
  // parent heading makes every nested group impossible to open.
  while (sibling && !isGroupHeading(sibling) && !containsGroupHeading(sibling)) {
    if (sibling instanceof HTMLElement) content.push(sibling);
    sibling = sibling.nextElementSibling;
  }
  return content;
}

/** Exclusive accordion for the actual animation settings column (LibraryPanel). */
export function SoundSettingsAccordion({ children, resetKey }: SoundSettingsAccordionProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let groups: SettingsGroup[] = [];
    let active: HTMLElement | null = null;
    let refreshQueued = false;

    const renderState = () => {
      groups.forEach(({ heading, content }) => {
        const expanded = heading === active;
        heading.classList.toggle("is-open", expanded);
        heading.setAttribute("aria-expanded", String(expanded));
        content.forEach((element) => { element.hidden = !expanded; });
      });
    };

    const clearGroups = () => {
      groups.forEach(({ heading, content }) => {
        heading.classList.remove("animation-settings-heading", "is-open");
        heading.removeAttribute("role");
        heading.removeAttribute("tabindex");
        heading.removeAttribute("aria-expanded");
        content.forEach((element) => { element.hidden = false; });
      });
    };

    const collectGroups = () => {
      const previousActive = active;
      const previousActiveKey = previousActive?.dataset.settingsAccordionKey;
      clearGroups();
      groups = Array.from(root.querySelectorAll<HTMLElement>(GROUP_HEADING_SELECTOR))
        .filter(isEligibleHeading)
        .map((heading) => ({ heading, content: collectGroupContent(heading) }))
        // Descriptive headings stay readable; only real groups of controls become menus.
        .filter(({ content }) => content.length > 0 && containsInteractiveControl(content));
      groups.forEach(({ heading }) => {
        heading.classList.add("animation-settings-heading");
        heading.setAttribute("role", "button");
        heading.setAttribute("tabindex", "0");
      });
      active = previousActive && groups.some(({ heading }) => heading === previousActive)
        ? previousActive
        : previousActiveKey
          ? groups.find(({ heading }) => heading.dataset.settingsAccordionKey === previousActiveKey)?.heading ?? null
          : null;
      renderState();
    };

    const activate = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      const heading = target.closest<HTMLElement>(".animation-settings-heading");
      if (!heading || !root.contains(heading)) return false;
      active = active === heading ? null : heading;
      renderState();
      return true;
    };
    const onClick = (event: MouseEvent) => { activate(event.target); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (activate(event.target)) event.preventDefault();
    };
    const observer = new MutationObserver(() => {
      if (refreshQueued) return;
      refreshQueued = true;
      queueMicrotask(() => { refreshQueued = false; collectGroups(); });
    });

    collectGroups();
    root.addEventListener("click", onClick);
    root.addEventListener("keydown", onKeyDown);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      root.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onKeyDown);
      clearGroups();
    };
  }, [resetKey]);

  return <div ref={rootRef} className="animation-settings-accordion">{children}</div>;
}
