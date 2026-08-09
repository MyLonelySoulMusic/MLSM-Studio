import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supportReminderDue } from "../services/artist-support-reminder";
import { ArtistSupportProvider, SupportArtistButton } from "./ArtistSupport";

describe("ArtistSupport", () => {
  beforeEach(() => {
    localStorage.clear(); sessionStorage.clear(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-08-08T10:00:00Z"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ type: "rich", provider_name: "TikTok", embed_type: "profile", embed_product_id: "mylonelysoulmusic", author_url: "https://www.tiktok.com/@mylonelysoulmusic", author_name: "My Lonely Soul Music", title: "My Lonely Soul Music's Creator Profile" }) }));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("ricorda il supporto dopo cinque minuti al primo avvio e poi ogni otto ore", () => {
    expect(supportReminderDue({ firstSeenAt: 1_000, lastOpenedAt: null }, 300_999)).toBe(false);
    expect(supportReminderDue({ firstSeenAt: 1_000, lastOpenedAt: null }, 301_000)).toBe(true);
    expect(supportReminderDue({ firstSeenAt: 1_000, lastOpenedAt: 2_000 }, 28_801_999)).toBe(false);
    expect(supportReminderDue({ firstSeenAt: 1_000, lastOpenedAt: 2_000 }, 28_802_000)).toBe(true);
  });

  it("anima il pulsante, apre i contenuti e azzera il timer", () => {
    render(<ArtistSupportProvider><SupportArtistButton /></ArtistSupportProvider>);
    const button = screen.getByRole("button", { name: "Supportami" });
    expect(button).not.toHaveClass("needs-attention");
    act(() => vi.advanceTimersByTime(5 * 60 * 1_000));
    expect(button).toHaveClass("needs-attention");
    fireEvent.click(button);
    expect(button).not.toHaveClass("needs-attention");
    expect(screen.getByRole("dialog", { name: "Sostieni My Lonely Soul Music" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Chiudi" }));
    expect(screen.queryByRole("dialog", { name: "Sostieni My Lonely Soul Music" })).not.toBeInTheDocument();
    expect(document.querySelector(".artist-support-backdrop")).toHaveAttribute("hidden");
    act(() => vi.advanceTimersByTime(8 * 60 * 60 * 1_000));
    expect(button).toHaveClass("needs-attention");
  });

  it("precarica i tre contenuti, mostra un solo pannello e li aggiorna ogni ora", async () => {
    const { container } = render(<ArtistSupportProvider><SupportArtistButton /></ArtistSupportProvider>);
    const initialSpotify = screen.getByTitle("My Lonely Soul Music · Spotify playlist");
    const initialYoutube = screen.getByTitle("My Lonely Soul Music · YouTube playlist");
    const initialTiktok = container.querySelector('blockquote.tiktok-embed[data-embed-type="creator"][data-unique-id="mylonelysoulmusic"]');
    expect(initialSpotify).toHaveAttribute("loading", "eager");
    expect(initialYoutube).toHaveAttribute("loading", "eager");
    expect(initialTiktok).toBeInTheDocument();
    expect(document.querySelectorAll('script[src="https://www.tiktok.com/embed.js"][data-mlsm-tiktok-embed="true"]')).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Supportami" }));
    const tabs = screen.getByRole("navigation", { name: "Contenuto in evidenza" });
    expect([...tabs.querySelectorAll("button")].map((button) => button.textContent)).toEqual(["Spotify playlist", "YouTube playlist", "TikTok"]);
    expect(initialSpotify.closest(".artist-media-panel")).not.toHaveAttribute("hidden");
    expect(initialYoutube.closest(".artist-media-panel")).toHaveAttribute("hidden");
    expect(initialTiktok?.closest(".artist-media-panel")).toHaveAttribute("hidden");

    fireEvent.click(screen.getByRole("button", { name: "Contenuto successivo" }));
    expect(initialYoutube.closest(".artist-media-panel")).not.toHaveAttribute("hidden");
    expect(initialSpotify.closest(".artist-media-panel")).toHaveAttribute("hidden");

    fireEvent.click(screen.getByRole("button", { name: "Contenuto successivo" }));
    expect(initialTiktok?.closest(".artist-media-panel")).not.toHaveAttribute("hidden");

    await act(async () => { vi.advanceTimersByTime(60 * 60 * 1_000); await Promise.resolve(); });
    expect(screen.getByTitle("My Lonely Soul Music · Spotify playlist")).not.toBe(initialSpotify);
    expect(screen.getByTitle("My Lonely Soul Music · YouTube playlist")).not.toBe(initialYoutube);
    expect(container.querySelector("blockquote.tiktok-embed")).not.toBe(initialTiktok);
    expect(document.querySelectorAll('script[src="https://www.tiktok.com/embed.js"][data-mlsm-tiktok-embed="true"]')).toHaveLength(1);
  });
});
