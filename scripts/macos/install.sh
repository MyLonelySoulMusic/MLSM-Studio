#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"

DRY_RUN=0
[[ " ${*:-} " == *" --dry-run "* ]] && DRY_RUN=1
run() { if [[ "$DRY_RUN" == 1 ]]; then printf '[dry-run]'; printf ' %q' "$@"; printf '\n'; else "$@"; fi; }
need() { command -v "$1" >/dev/null 2>&1; }

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Questo installer è per macOS. Su Windows usa scripts\\windows\\install.bat." >&2
  exit 2
fi

echo "MLSM Studio · installazione completa macOS ($(uname -m))"
if ! xcode-select -p >/dev/null 2>&1; then
  if [[ "$DRY_RUN" == 1 ]]; then echo "[dry-run] xcode-select --install"; else
    xcode-select --install
    echo "Completa l’installazione dei Command Line Tools, poi riesegui scripts/macos/install.sh."
    exit 3
  fi
fi

if ! need brew; then
  if [[ "$DRY_RUN" == 1 ]]; then echo "[dry-run] installazione Homebrew dal repository ufficiale"; else
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    if [[ -x /opt/homebrew/bin/brew ]]; then eval "$(/opt/homebrew/bin/brew shellenv)"; else eval "$(/usr/local/bin/brew shellenv)"; fi
  fi
fi

run brew update
for formula in node@22 python@3.11 ffmpeg rubberband rust; do
  if ! brew list --versions "$formula" >/dev/null 2>&1; then run brew install "$formula"; fi
done
if [[ -d /opt/homebrew/opt/node@22/bin ]]; then export PATH="/opt/homebrew/opt/node@22/bin:$PATH"; fi
if [[ -d /usr/local/opt/node@22/bin ]]; then export PATH="/usr/local/opt/node@22/bin:$PATH"; fi
export MLSM_PYTHON="$(brew --prefix python@3.11)/bin/python3.11"

run npm ci --include=dev
run node tools/verify_node_dependencies.cjs
run node tools/setup_python_runtime.cjs upscaler
run node tools/setup_python_runtime.cjs ai-quantizer
run node tools/setup_python_runtime.cjs song-player
run node tools/setup_python_runtime.cjs audio-tts
run cargo fetch --manifest-path apps/desktop/src-tauri/Cargo.toml
if [[ "$DRY_RUN" == 0 ]]; then node tools/verify_installation.cjs; fi
run chmod +x scripts/macos/install.sh scripts/macos/launch.sh scripts/macos/build.sh scripts/macos/setup-ai-quantizer.sh scripts/macos/setup-upscaler.sh

if [[ "$DRY_RUN" == 1 ]]; then
  echo "Dry-run completata: nessuna modifica eseguita."
else
  echo "MLSM Studio è pronto. L’installer non ha avviato alcun server."
fi
