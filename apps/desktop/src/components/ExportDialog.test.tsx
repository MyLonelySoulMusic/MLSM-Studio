import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExportDialog } from "./ExportDialog";

describe("ExportDialog", () => {
  afterEach(cleanup);

  it("indica il rapporto in ogni risoluzione disponibile", () => {
    render(<ExportDialog duration={10} running={false} progress={0} currentFrame={0} totalFrames={0} error={null} onClose={vi.fn()} onCancel={vi.fn()} onStart={vi.fn()} />);
    const resolutions = screen.getByLabelText("Risoluzione").querySelectorAll("option");
    expect(resolutions).toHaveLength(5);
    for (const option of resolutions) expect(option.textContent).toMatch(/\((?:9:16|16:9)(?: · .+)?\)$/);
  });

  it("usa la qualità massima come impostazione predefinita", () => {
    const onStart = vi.fn(); render(<ExportDialog duration={10} running={false} progress={0} currentFrame={0} totalFrames={0} error={null} onClose={vi.fn()} onCancel={vi.fn()} onStart={onStart} />);
    expect(screen.getByLabelText("Qualità codifica")).toHaveValue("maximum"); fireEvent.click(screen.getByText("Scegli destinazione e crea video")); expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ quality: "maximum" }));
  });

  it("descrive l'export Pixels Subtitles come codifica offline senza drop volontari", () => {
    render(<ExportDialog duration={10} running={false} progress={0} currentFrame={0} totalFrames={0} error={null} offlineFrameExport onClose={vi.fn()} onCancel={vi.fn()} onStart={vi.fn()} />);
    expect(screen.getByText("MP4 · H.264/AAC offline")).toBeInTheDocument();
    expect(screen.getByText(/calcola ogni frame offline/i)).toBeInTheDocument();
  });

  it("offre i preset 16:9 fino a 8K e 120 fps per From 9:16 to 16:9", () => {
    const onStart = vi.fn();
    render(<ExportDialog duration={10} running={false} progress={0} currentFrame={0} totalFrames={0} error={null} offlineFrameExport offlineExportProfile={{ title: "Esporta From 9:16 to 16:9", defaultResolution: "3840x2160", defaultFps: 60, recommendation: "4K consigliato" }} onClose={vi.fn()} onCancel={vi.fn()} onStart={onStart} />);
    expect(screen.getByRole("heading", { name: "Esporta From 9:16 to 16:9" })).toBeInTheDocument();
    expect(screen.getByLabelText("Risoluzione")).toHaveValue("3840x2160");
    expect(screen.getByLabelText("Risoluzione")).toHaveTextContent("7680 × 4320 (16:9 · 8K)");
    expect(screen.getByText("4K consigliato")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Risoluzione"), { target: { value: "2560x1440" } });
    fireEvent.change(screen.getByLabelText("Frame rate"), { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "Scegli destinazione e crea video" }));
    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ width: 2560, height: 1440, fps: 120 }));
  });

  it("mantiene le proprietà del video sorgente per Static Watermark Remover", () => {
    render(<ExportDialog duration={37} running={false} progress={.2} currentFrame={200} totalFrames={1000} error={null} sourceVideoExport={{ label: "Static Watermark Remover" }} onClose={vi.fn()} onCancel={vi.fn()} onStart={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Esporta Static Watermark Remover" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Risoluzione")).not.toBeInTheDocument();
    expect(screen.queryByText("Frame rate")).not.toBeInTheDocument();
    expect(screen.getByText(/ordine, timestamp e durata di ogni frame/)).toBeInTheDocument();
    expect(screen.getByText("MP4 · H.264 + audio originale · proprietà sorgente")).toBeInTheDocument();
  });

  it("inizializza ProSubtitles con la risoluzione coerente al ratio del progetto", () => {
    const commonProps = {
      duration: 10,
      running: false,
      progress: 0,
      currentFrame: 0,
      totalFrames: 0,
      error: null,
      proSubtitles: {
        backgroundMode: "transparent" as const,
        backgroundColor: "#1257d6",
        exportFormat: "webmVp9Alpha" as const,
        hasSourceVideo: true
      },
      onClose: vi.fn(),
      onCancel: vi.fn(),
      onStart: vi.fn()
    };
    const portrait = render(<ExportDialog {...commonProps} aspectRatio="9:16" />);
    expect(screen.getByLabelText("Risoluzione")).toHaveValue("1080x1920");
    portrait.unmount();

    render(<ExportDialog {...commonProps} aspectRatio="16:9" />);
    expect(screen.getByLabelText("Risoluzione")).toHaveValue("1920x1080");
  });

  it("consente WebM VP9 alpha e restituisce un layer trasparente video-only", () => {
    const onStart = vi.fn();
    render(<ExportDialog
      duration={12}
      running={false}
      progress={0}
      currentFrame={0}
      totalFrames={0}
      error={null}
      aspectRatio="9:16"
      proSubtitles={{
        backgroundMode: "transparent",
        backgroundColor: "#2b6ff2",
        exportFormat: "webmVp9Alpha",
        hasSourceVideo: true
      }}
      onClose={vi.fn()}
      onCancel={vi.fn()}
      onStart={onStart}
    />);

    expect(screen.getByLabelText("Formato ProSubtitles"))
      .toHaveValue("webmVp9Alpha");
    expect(screen.getByRole("button", { name: "Scegli destinazione e crea video" }))
      .toBeEnabled();
    fireEvent.click(screen.getByRole("button", {
      name: "Scegli destinazione e crea video"
    }));

    expect(onStart).toHaveBeenCalledWith({
      width: 1080,
      height: 1920,
      fps: 30,
      durationSeconds: 12,
      quality: "maximum",
      proSubtitles: {
        outputMode: "subtitleLayer",
        backgroundMode: "transparent",
        backgroundColor: "#2b6ff2",
        format: "webmVp9Alpha",
        allowOpaqueWebmFallback: false
      }
    });
  });

  it("blocca MOV ProRes 4444 nel web mostrando una spiegazione precisa", () => {
    const onStart = vi.fn();
    render(<ExportDialog
      duration={12}
      running={false}
      progress={0}
      currentFrame={0}
      totalFrames={0}
      error={null}
      proSubtitles={{
        backgroundMode: "transparent",
        backgroundColor: "#2b6ff2",
        exportFormat: "webmVp9Alpha",
        hasSourceVideo: true
      }}
      onClose={vi.fn()}
      onCancel={vi.fn()}
      onStart={onStart}
    />);

    fireEvent.change(screen.getByLabelText("Formato ProSubtitles"), {
      target: { value: "movProRes4444" }
    });

    expect(screen.getByText(/ProRes 4444 richiede la build desktop con FFmpeg/))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scegli destinazione e crea video" }))
      .toBeDisabled();
    fireEvent.click(screen.getByRole("button", {
      name: "Scegli destinazione e crea video"
    }));
    expect(onStart).not.toHaveBeenCalled();
  });

  it("restituisce MP4 H.264 e il colore scelto per lo sfondo pieno", () => {
    const onStart = vi.fn();
    render(<ExportDialog
      duration={8}
      running={false}
      progress={0}
      currentFrame={0}
      totalFrames={0}
      error={null}
      aspectRatio="16:9"
      proSubtitles={{
        backgroundMode: "transparent",
        backgroundColor: "#00ff00",
        exportFormat: "webmVp9Alpha",
        hasSourceVideo: true
      }}
      onClose={vi.fn()}
      onCancel={vi.fn()}
      onStart={onStart}
    />);

    fireEvent.change(screen.getByLabelText("Tipo di livello ProSubtitles"), {
      target: { value: "solid" }
    });
    fireEvent.change(screen.getByLabelText("Colore sfondo export ProSubtitles"), {
      target: { value: "#e83f79" }
    });
    fireEvent.click(screen.getByRole("button", {
      name: "Scegli destinazione e crea video"
    }));

    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({
      width: 1920,
      height: 1080,
      proSubtitles: {
        outputMode: "subtitleLayer",
        backgroundMode: "solid",
        backgroundColor: "#e83f79",
        format: "mp4H264Solid",
        allowOpaqueWebmFallback: false
      }
    }));
  });

  it("esporta il video completo usando frame rate e risoluzione del sorgente", () => {
    const onStart = vi.fn();
    render(<ExportDialog
      duration={8}
      running={false}
      progress={0}
      currentFrame={0}
      totalFrames={0}
      error={null}
      aspectRatio="9:16"
      proSubtitles={{
        backgroundMode: "transparent",
        backgroundColor: "#00ff00",
        exportFormat: "webmVp9Alpha",
        hasSourceVideo: true
      }}
      onClose={vi.fn()}
      onCancel={vi.fn()}
      onStart={onStart}
    />);

    fireEvent.change(screen.getByLabelText("Contenuto export ProSubtitles"), {
      target: { value: "completeVideo" }
    });

    expect(screen.queryByLabelText("Risoluzione")).not.toBeInTheDocument();
    expect(screen.queryByText("Frame rate")).not.toBeInTheDocument();
    expect(screen.getByText(/ordine, timestamp e durata di ogni frame/))
      .toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", {
      name: "Scegli destinazione e crea video"
    }));

    expect(onStart).toHaveBeenCalledWith(expect.objectContaining({
      proSubtitles: expect.objectContaining({
        outputMode: "completeVideo",
        format: "mp4H264Solid"
      })
    }));
  });
});
