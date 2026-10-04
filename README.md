# MLSM Studio

**English** · [Italiano](README.it.md)

![MLSM Studio welcome screen](docs/screenshots/01-welcome.png)

**MLSM Studio — My Lonely Soul Music Studio** is a local-first, cross-platform creative desktop suite for audio, video, music, publishing and data-driven production. It combines reactive visualizers, multitrack editing, restoration and upscaling, audio processing, transcription, lip-sync, WordPress automation, interactive dashboards, knowledge tools and professional audio metering in one coherent interface.

The UI is built with React/Vite inside a Tauri shell. Isolated Python services start only when a feature needs them and stop when the user leaves that workspace. Projects, media references, model caches and application databases remain on the computer; network access is limited to explicit operations such as configured AI providers, WordPress publishing, model downloads, Gradio/Colab endpoints and OpenStreetMap tiles.

> MLSM Studio is evolving software. Keep source-media backups and verify final exports before using them in production.

## Contents

- [Overview](#overview)
- [Workspaces](#workspaces)
- [Installation](#installation)
- [First run](#first-run)
- [Privacy and persistence](#privacy-and-persistence)
- [Architecture](#architecture)
- [Development and tests](#development-and-tests)
- [Troubleshooting](#troubleshooting)
- [Technical documentation](#technical-documentation)
- [My Lonely Soul Music](#my-lonely-soul-music)

## Overview

MLSM Studio follows four core principles:

- **one ecosystem:** all workspaces share theme, language, settings, projects, Memory, diagnostics and export conventions;
- **local processing first:** FFmpeg, Python, WebAudio, WebCodecs, Metal/MPS, CUDA and CPU are selected according to the machine and feature;
- **verifiable output:** offline render and validation are preferred over recording a live preview;
- **isolated runtimes:** incompatible Python dependencies live in separate virtual environments and are never committed to the repository.

![MLSM Studio workspace selection after the entrance animation has completed](docs/screenshots/02-home-areas.png)

| Domain | Capabilities |
| --- | --- |
| Visual creation | Audio-reactive visualizers, 3D scenes, social layouts, kinetic subtitles and narrative animation. |
| Photo and video | Authorized watermark replacement, image/video upscaling, photo batches and frame interpolation. |
| Editing | Multitrack timeline, compositing, transitions, automation, colour correction and audio mixing. |
| Music and voice | Quantization, stem alignment, restoration, mastering, Whisper transcription and vocal separation. |
| Data | CSV/TXT/Excel, calculated fields, filters, dashboards, maps, pivot tables and animated charts. |
| Publishing | Multi-site WordPress queues, scheduling, taxonomy mapping, media and activity statistics. |
| Local knowledge | Semantic Memory, Post-it notes and flows, and intelligent in-app Documentation search. |

### Gallery

| Sound Animation | Photo & Video Studio |
| --- | --- |
| ![Sound Animation editor](docs/screenshots/03-sound-animation.png) | ![Photo and Video Studio](docs/screenshots/04-photo-video-studio.png) |

| Video Editor | Music · AI Quantizer |
| --- | --- |
| ![Multitrack Video Editor](docs/screenshots/05-video-editor.png) | ![AI Quantizer runtime preparation](docs/screenshots/06-ai-quantizer.png) |

## Workspaces

The Home screen exposes twelve dedicated workspaces. **Home** returns to this screen without restarting the application. **Settings**, **Memory**, language, theme, Support and Lonely Bot remain available from the global shell.

### 1. Sound Animation

Creates visualizers, stories and typography synchronized to music.

- **Instrumental Falling**, **Cover Sphere**, **Stereo Unfold**, **Cube Animation**, **Circular Spectrum Auto Detector** and **Overlay Spectral**;
- **From 9:16 to 16:9**, **Cassette Desk** and **Song Player**;
- **Teddy Walk**, **Teddy Sing** and **Comments Invasion**;
- **Pro Subtitles** and **Pixels Subtitles**, with cue import/generation and per-word styling;
- beat, energy, stereo spectrum, phoneme and palette analysis;
- synchronized preview, timeline and deterministic offline export.

**From 9:16 to 16:9 audio compatibility:** existing AAC audio is copied without re-encoding whenever its timeline permits. Other audio uses native AAC encoding or the bundled [Mediabunny AAC software encoder](https://mediabunny.dev/guide/extensions/aac-encoder) automatically. No external service or manual codec installation is required on Windows or Mac; stereo channels are preserved.

See [Sound Animation](docs/sound-animation.md).

### 2. Photo & Video Studio

- **Static Watermark Remover** for content you own or are authorized to modify, with a mask, clean image or temporally aligned clean reference video;
- **Upscaler** with Canvas Enhanced, Real-ESRGAN and RealESRNet, local CUDA/Metal/CPU selection and optional Gradio/Colab endpoints;
- optional **MLX-DLSS 5** on compatible Apple Silicon, using an isolated Metal backend and user-supplied authorized NVIDIA model;
- image batches, comparison, blending, colour controls and custom resolution;
- **Frame Booster** with isolated runtime, explicit startup/model progress, logs, audio preservation and output validation.

Proprietary NVIDIA weights are not included. A user-authorized source such as `nvngx_dlssnr.dll` or a prepared `.dlssmodel` is stored outside Git. See [Photo & Video Studio](docs/photo-video-studio.md).

### 3. Video Editor

- media pool with drag-and-drop for video, images and audio;
- move, trim, split, reverse, snap, reorder and lock;
- effects, transitions, transforms, opacity, blend modes and colour grading;
- audio mixing with volume, pan, EQ, compressor, generic fades and parameter envelopes;
- offline export with dedicated audio mix and optional frame interpolation.

See [Video Editor](docs/video-editor.md).

### 4. Music · AI Quantizer

Guided pipeline: **Import → Quantize → Align → Restore → Master → Export**. Every stage must be performed or explicitly skipped. Playback never starts automatically after processing.

- tempo detection and a shared warp map;
- DAW-style alignment without re-running completed quantization;
- waveform and marker comparison before and after correction;
- optional restoration and mastering;
- separate AI Forensics and visible ZIP preparation progress.

If a reliable strictly increasing beat map cannot be built, the track is reported as non-quantizable instead of exporting shifted timing. See [Music · AI Quantizer](docs/music.md).

### 5. MLSM Post Lipsync

Realigns an already-performed video to a final vocal or master. It analyzes the voice, builds word anchors, creates a monotonic time map and keeps the result inspectable before export.

### 6. Audio

- local Whisper transcription for audio/video with automatic or explicit language;
- compatible precision selection on Windows instead of forcing unsupported `float16`;
- SRT, VTT, TXT and complete Whisper JSON export;
- optional LLM review, **off by default** and enabled only with reference text;
- selectable local model or configured API provider;
- vocal/accompaniment separation with Demucs `htdemucs`.

### 7. Stickman Animations

A collection for stylized scenes. **Bivio** builds a vertical choice-based animation with configurable text, colours, 720p/1080p output and 24/30 fps.

### 8. AutoPost

- paste or import JSON documents with up to 500 articles;
- preview, edit text/image URL, and remove one or multiple articles;
- assign each article to one or more blogs and categories;
- refresh categories from `/wp-json/wp/v2/categories` on open and blog change;
- map cross-blog categories using a configured LLM or local multilingual MiniLM;
- adjustable cosine threshold, First/All selection and visible ranking/progress;
- persistent queue, scheduling, pause, retry and removal;
- encrypted local Application Password storage, media library and statistics.

### 9. Reports

- replace or append compatible CSV/TXT/Excel sources while preserving each contribution;
- preview and recognizable calculated fields using **MLSM Formula**, including row formulas and aggregate expressions such as `SUM(a) / SUM(b)`;
- formula assistance from a selected local model or configured API provider;
- KPI, horizontal/vertical bars, line, area, doughnut, scatter, real maps, tables, pivots, text and **Replicate XLS**;
- configurable aggregations, formats, X/Y labels, ticks, ordering, grouping, first/last N and filters;
- **Time Series** and **Bar Race** animations with period/cumulative values, trends, maxima and progressive interpolation;
- local archive, JSON import/export, read-only URLs and self-contained HTML embed code.

Replicate XLS analyzes a workbook template, preserves formatting, empty cells and layout, lets the user annotate ranges, and grows the report with new data.

### 10. Post-it

Private local notes, links and flows. Favicons are cached locally; notes can be edited, deleted, connected into described flows and retrieved through local semantic similarity. Links and data are not committed to the repository.

### 11. Streamer Audio Viewer

- deletable queue, favourites and configurable automatic/manual advance;
- turntable/player, uncropped artwork and YouTube artwork cropping;
- square YouTube artwork, with 16:9 sides and 4:3 letterboxing removed;
- meter, stereo spectrum, LUFS, stereo image, phase correlation, spectrogram, oscilloscope, dynamics and tonal distribution;
- movable, removable and restorable widgets with a documented default layout;
- theme-aware full-screen workspace while the player remains visible and audible;
- direct PCM for local files and explicit ScreenCaptureKit/WASAPI capture for web playback.

**Reactive ripples** in the analysis toolbar toggles a shared pink water surface. Sudden stereo openings and strong peak/true-peak changes emit wave packets from their widgets; the signed waves interfere before being lit, then fade naturally. The setting is saved locally and also works in full screen. Rendering uses WebGL with a bounded software fallback, respects reduced-motion preferences and never alters playback or audio measurements.

The turntable widget includes local **Whisper-Streaming** transcription: provisional words are revised as more audio arrives, then confirmed. Apple Silicon uses MLX; Windows uses Faster-Whisper with CUDA when supported and an INT8 CPU fallback. The first use prepares the engine and downloads multilingual weights with visible progress. Models and the pinned upstream runtime are cached outside the repository, and audio is never uploaded. Audio waiting for inference is preserved; an explicit error replaces silent dropping if the engine cannot keep up. Singing recognition and latency depend on the track and hardware.

**Record**, next to Play, arms a local video recording: choose the **MLSM Studio tab/window**, then press Play. For YouTube/Spotify, enable system-audio analysis first. Pause pauses the recording; Stop or the end of a non-advancing queue finalizes it. Fullscreen widgets remain audible and are captured normally. Saved takes offer **Save video** (with stereo audio) and **Save WAV audio** (uncompressed Float32 at the received sample rate, before playback volume), and remain available locally when reopening the area. Deleting a take removes its local recording files, not the source track.

Recording uses browser screen-sharing permission in Chrome/Edge on Mac and Windows. Unsupported app webviews show an explicit browser requirement. Video requests up to 4K/60 fps, uses a high-bitrate supported codec (VP9/Opus preferred, with VP8/MP4 fallbacks), and displays the actual captured dimensions, frame rate and encoder bitrate. These settings cannot recover resolution or audio quality absent from the source. Chunks are written to browser-private disk storage, not accumulated indefinitely in RAM or committed to Git. Keep sufficient free disk space and export valuable takes before clearing browser/site data. The separate WAV preserves source samples; its duration excludes periods where no PCM was received.

MLSM does not download or bypass protected streams. Captured PCM is processed on-device, never uploaded, and recorded only after explicit opt-in. Only record sources you are authorized to use.

### 12. Documentation

The bilingual in-app guide documents every workspace and operational flow. Search accepts a control name, a problem or a natural-language goal.

- lexical results appear immediately;
- verified multilingual **MiniLM** embeddings rerank results by meaning;
- WebGPU is used only when available, with verified WASM fallback;
- the model loads lazily after a search, never at application startup;
- queries and index stay on-device and are not sent to an external provider;
- local text search remains available if the model cannot load.

![Documentation workspace with local intelligent search](docs/screenshots/08-documentation.png)

## Installation

| Platform | Initial requirement |
| --- | --- |
| macOS | Internet access and Xcode Command Line Tools. Homebrew is installed if needed. |
| Windows | Windows Package Manager (`winget`, supplied by App Installer) and Internet access. |

Installers verify or install Node.js 22+, exact npm dependencies, Python 3.11, isolated virtual environments, FFmpeg/FFprobe, Rubber Band, Rust/Cargo, Tauri requirements and build tools. Large AI models are downloaded on first use when licenses permit and reused from local cache.

### macOS

```bash
bash scripts/macos/install.sh
scripts/macos/launch.sh
```

MLX-DLSS additionally requires full Xcode, the Metal toolchain and an authorized NVIDIA model. It is not required by the rest of MLSM Studio.

### Windows

```bat
scripts\windows\install.bat
scripts\windows\launch.bat
```

After `git pull`, the launcher fingerprints manifest/lockfiles and sources. Missing state is treated as a first run: it safely performs both `npm ci --include=dev` and `npm run build`. State lives under `node_modules/.cache/mlsm-studio/` and is not versioned.

### App icons and branded launchers

Native builds explicitly use the original MLSM logo: Retina ICNS for macOS, multi-resolution ICO for Windows and PNG assets for Tauri. Windows NSIS installers and uninstallers also use the logo. Packaging scripts validate the icon files before building. See [Tauri App Icons](https://v2.tauri.app/develop/icons/) for the native format requirements.

Installation and normal launch generate a double-click launcher with the same logo: **`scripts/macos/MLSM Studio.app`** on Mac or **`scripts/windows/MLSM Studio.lnk`** on Windows. To create/update it without starting the app, run `node tools/create_branded_launchers.cjs` from the project root. Original `.sh`/`.bat` launchers remain available, and the graphical launcher delegates to them with visible terminal logs.

These launchers contain machine-specific project paths and are ignored by Git. No Desktop shortcut is created automatically; you can copy the generated launcher there. Regenerate after moving the project. Existing unrelated apps/shortcuts are never overwritten, and launcher-generation failure does not prevent the original scripts from running. Full desktop distributions are still built with `npm run package:mac` (DMG) or `npm run package:windows` (NSIS/MSI); no native package build is triggered by generating a launcher.

### Verify or repair

```bash
npm run install:verify
node tools/repair_installation.cjs --dry-run
node tools/repair_installation.cjs
```

**Settings → Restore** performs targeted checks and repairs only missing or failed components.

## First run

1. Launch MLSM Studio with the platform script.
2. Select **Enter MLSM Studio**, then choose a workspace.
3. Open **Settings** to choose language, theme and optional AI providers/limits.
4. Import media or a dataset and start the required action explicitly.
5. On first use of a local model, wait for download; later runs use the cache.

| Runtime | Directory | Responsibility |
| --- | --- | --- |
| Upscaler | `.venv` | Real-ESRGAN/RealESRNet, images, video and remote jobs. |
| AI Quantizer | `.venv-ai-quantizer` | Quantization, alignment, restoration and mastering. |
| Song Player | `.venv-song-player` | Dedicated audio/video analysis and synchronization. |
| Audio | `.venv-audio-tts` | Whisper, voice processing and audio services. |

Services start on demand and stop when their workspace closes.

## Privacy and persistence

MLSM Studio is **local-first**, not “offline at any cost.” Projects, preferences, task history, Reports datasets, Memory vectors, Post-it data, AutoPost queues, virtual environments, local models and caches remain on the machine.

External access occurs only for explicit operations: dependency/model downloads, selected Gradio/Colab endpoints, configured LLM providers, WordPress publishing, OpenStreetMap tiles, and supported media previews or embeds.

Never commit credentials, proprietary DLLs/models, exports, caches or application databases. Memory stores metadata, embeddings and paths rather than duplicating original media.

## Architecture

```text
MLSM Studio
├── apps/desktop/             React, Vite, Tauri and workspaces
│   ├── src/                  UI, state, services, editors and modes
│   └── src-tauri/            Native desktop shell and commands
├── packages/                 Shared TypeScript schemas and libraries
├── tools/                    Python/Node runtimes and utilities
├── scripts/macos|windows/    Installation, launch and packaging
├── docs/                     Guides, screenshots and architecture
├── tests/                    Cross-cutting integration tests
└── assets/, img/, mixamo/    Application resources
```

React/Vite owns UI and browser-based processing; Tauri provides native dialogs/filesystem access; Python services host native ML pipelines; FFmpeg/Rubber Band handle encoding and temporal transforms; workers keep intensive analysis off the UI thread.

## Development and tests

```bash
npm ci --include=dev
npm run dev
```

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start development UI and managed services. |
| `npm run build` | Type-check and build the web application. |
| `npm run typecheck` | Validate workspace TypeScript. |
| `npm run lint` | Run ESLint with zero warnings. |
| `npm test` | Run Vitest. |
| `npm run test:coverage` | Run the coverage suite. |
| `npm run install:verify` | Verify the installation. |
| `npm run setup:runtimes` | Prepare all Python runtimes. |

Recommended release gate:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run install:verify
```

Regenerate screenshots with `node tools/capture_documentation_screenshots.mjs` after a build. The script waits for Home animations to complete.

## Troubleshooting

| Problem | Recommended check |
| --- | --- |
| Installation stops before ready | Run the platform installer again, then `npm run install:verify`; inspect the first failing command. |
| A backend does not respond | Leave and re-enter its workspace, inspect startup logs, then use **Settings → Restore**. |
| Windows reports CUDA DLLs missing | Use CPU fallback or complete the NVIDIA runtime; MLSM must not force `float16`. |
| MLX-DLSS cannot be configured | Confirm Apple Silicon, Xcode/Metal and an authorized `nvngx_dlssnr.dll` or `.dlssmodel`. |
| Video export needs substantial storage | Free temporary space; offline pipelines may keep frames until validation succeeds. |
| An exported map is empty | Leaflet/OpenStreetMap tiles require Internet access. |
| A dashboard is missing elsewhere | Export `.mlsm-report.json` and import it on the other installation. |

## Technical documentation

- [Documentation index](docs/index.md)
- [User guide](docs/user-guide.md)
- [Sound Animation](docs/sound-animation.md)
- [Photo & Video Studio](docs/photo-video-studio.md)
- [Video Editor](docs/video-editor.md)
- [Music · AI Quantizer](docs/music.md)
- [Memory](docs/memory.md)
- [Offline export](docs/export.md)
- [Audio analysis](docs/audio-analysis.md)
- [Local AI models](docs/local-models.md)
- [Project format](docs/project-format.md)
- [Installation and development](docs/development.md)
- [macOS and Windows scripts](scripts/README.md)
- [Architecture](docs/architecture.md)

## My Lonely Soul Music

- [Official website](https://mylonelysoulmusic.altervista.org/) · [Lonely’s Journal](https://mylonelysoulmusic.altervista.org/journal/)
- [YouTube](https://www.youtube.com/@MyLonelySoulMusic) · [Spotify](https://open.spotify.com/intl-it/artist/46IsvOJtw1vXE6nFqHxz3R) · [Apple Music](https://music.apple.com/it/artist/my-lonely-soul-music/6792151463)
- [TikTok](https://www.tiktok.com/@mylonelysoulmusic) · [Instagram](https://www.instagram.com/mylonelysoulmusic/) · [Email](mailto:mylonelysoulmusic@gmail.com)

---

**MLSM Studio** · My Lonely Soul Music Studio
