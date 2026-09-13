import { useLayoutEffect, useRef, type HTMLAttributes, type ReactNode } from "react";

interface SoundInspectorAccordionProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
  children: ReactNode;
  resetKey?: string;
}

/**
 * Turns every direct `section` with an h2/h3 into an exclusive accordion.
 * Existing inspector markup stays intact, while every Sound Animation mode
 * shares the same closed-by-default and keyboard-accessible behaviour.
 */
export function SoundInspectorAccordion({ children, className = "", resetKey = "", ...props }: SoundInspectorAccordionProps) {
  const rootRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const sections = Array.from(root.children).filter((element): element is HTMLElement => element instanceof HTMLElement && element.tagName === "SECTION");
    const headings = sections.map((section) => Array.from(section.children).find((element): element is HTMLElement => element instanceof HTMLElement && (element.tagName === "H2" || element.tagName === "H3"))).filter((heading): heading is HTMLElement => Boolean(heading));

    const setOpen = (active: HTMLElement | null) => {
      headings.forEach((heading) => {
        const section = heading.parentElement;
        const expanded = heading === active;
        section?.classList.toggle("is-open", expanded);
        heading.setAttribute("aria-expanded", String(expanded));
      });
    };

    headings.forEach((heading) => {
      heading.setAttribute("role", "button");
      heading.setAttribute("tabindex", "0");
      heading.setAttribute("aria-expanded", "false");
      heading.parentElement?.classList.add("sound-inspector-section");
    });
    setOpen(null);

    const activate = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      const heading = target.closest<HTMLElement>("h2[role='button'], h3[role='button']");
      if (!heading || heading.parentElement?.parentElement !== root) return false;
      setOpen(heading.getAttribute("aria-expanded") === "true" ? null : heading);
      return true;
    };
    const onClick = (event: MouseEvent) => { activate(event.target); };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (activate(event.target)) event.preventDefault();
    };
    root.addEventListener("click", onClick);
    root.addEventListener("keydown", onKeyDown);
    return () => {
      root.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onKeyDown);
      headings.forEach((heading) => {
        heading.removeAttribute("role");
        heading.removeAttribute("tabindex");
        heading.removeAttribute("aria-expanded");
        heading.parentElement?.classList.remove("sound-inspector-section", "is-open");
      });
    };
  }, [resetKey]);

  return <aside ref={rootRef} className={`${className} sound-inspector-accordion`.trim()} {...props}>{children}</aside>;
}
