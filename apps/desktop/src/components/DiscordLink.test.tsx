import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { DiscordLink } from "./DiscordLink";
import { updateUiPreferences } from "../services/ui-preferences";

describe("Discord community link", () => {
  beforeEach(() => updateUiPreferences({ language: "it", theme: "day" }));
  afterEach(() => { cleanup(); updateUiPreferences({ language: "it", theme: "day" }); });

  it("opens the requested invite in a safe new tab with an accessible logo", () => {
    render(<DiscordLink />);
    const link = screen.getByRole("link", { name: "Entra nella community Discord · nuova scheda" });
    expect(link).toHaveAttribute("href", "https://discord.gg/ttG2X9WjU");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(link.querySelector("path")).toHaveAttribute("fill", "currentColor");
    act(() => updateUiPreferences({ language: "en", theme: "night" }));
    expect(screen.getByRole("link", { name: "Join our Discord community · new tab" })).toHaveAttribute("title", "Join our Discord community · new tab");
  });

  it("uses app theme tokens rather than an unrelated Discord brand colour", () => {
    const css = readFileSync("apps/desktop/src/workspace-finish.css", "utf8");
    expect(css).toMatch(/a\.discord-link[^{]*\{[^}]*color:\s*var\(--accent-strong\)/);
    expect(css).toMatch(/a\.discord-link[^{]*\{[^}]*background:\s*var\(--panel-raised\)/);
  });
});
