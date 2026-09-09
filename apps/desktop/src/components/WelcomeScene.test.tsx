import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WelcomeScene } from "./WelcomeScene";

const scene = vi.hoisted(() => ({ setAnimating: vi.fn(), setTime: vi.fn(), setTheme: vi.fn(), dispose: vi.fn() }));
const create = vi.hoisted(() => vi.fn());
vi.mock("../services/welcome-scene", () => ({ createWelcomeScene: create }));

describe("WelcomeScene lifecycle", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("WebGL2RenderingContext", class {}); create.mockResolvedValue(scene); });
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("joins a late renderer to the current time and keeps its fallback synchronized while paused", async () => {
    vi.useFakeTimers();
    let finish: (value: typeof scene) => void = () => {};
    create.mockImplementation(() => new Promise<typeof scene>((resolve) => { finish = resolve; }));
    const view = render(<WelcomeScene animated theme="day" />);
    await act(async () => {});
    expect(create).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(3_000));
    await act(async () => { finish(scene); });
    expect(scene.setTime.mock.lastCall?.[0]).toBeGreaterThan(2.8);
    act(() => vi.advanceTimersByTime(500));
    view.rerender(<WelcomeScene animated={false} theme="day" />);
    const fallback = view.container.querySelector<SVGElement>(".intro-sculpture__fallback")!;
    const transform = fallback.style.transform;
    const calls = scene.setTime.mock.calls.length;
    act(() => vi.advanceTimersByTime(10_000));
    expect(scene.setTime).toHaveBeenCalledTimes(calls);
    act(() => create.mock.calls[0]![1].onContextLost());
    expect(screen.getByRole("img", { name: "My Lonely Soul Music" })).toHaveAttribute("data-renderer", "static");
    expect(fallback.style.transform).toBe(transform);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("pauses and changes theme without creating another renderer, then disposes on exit", async () => {
    const view = render(<WelcomeScene animated theme="day" />);
    await waitFor(() => expect(screen.getByRole("img", { name: "My Lonely Soul Music" })).toHaveAttribute("data-renderer", "webgl"));
    view.rerender(<WelcomeScene animated={false} theme="night" />);
    expect(create).toHaveBeenCalledTimes(1);
    expect(scene.setAnimating).toHaveBeenLastCalledWith(false);
    expect(scene.setTheme).toHaveBeenLastCalledWith("night");
    view.unmount();
    expect(scene.dispose).toHaveBeenCalledOnce();
  });

  it("disposes a late-loading scene when the user enters the studio before it is ready", async () => {
    let finish: (value: typeof scene) => void = () => {};
    create.mockImplementation(() => new Promise<typeof scene>((resolve) => { finish = resolve; }));
    const view = render(<WelcomeScene animated theme="day" />);
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    const signal = create.mock.calls[0]![1].signal as AbortSignal;
    view.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => { finish(scene); });
    expect(scene.dispose).toHaveBeenCalledOnce();
    expect(scene.setAnimating).not.toHaveBeenCalled();
  });

  it("restores the readable vector logo if the graphics context is lost", async () => {
    render(<WelcomeScene animated theme="day" />);
    const logo = screen.getByRole("img", { name: "My Lonely Soul Music" });
    await waitFor(() => expect(logo).toHaveAttribute("data-renderer", "webgl"));
    act(() => create.mock.calls[0]![1].onContextLost());
    expect(logo).toHaveAttribute("data-renderer", "static");
  });
});
