#!/usr/bin/env bash
# Crea un DMG nativo macOS con Tauri. Non avvia Vite né alcun servizio locale.
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"
if [[ -d /opt/homebrew/opt/node@22/bin ]]; then export PATH="/opt/homebrew/opt/node@22/bin:$PATH"; fi
if [[ -d /usr/local/opt/node@22/bin ]]; then export PATH="/usr/local/opt/node@22/bin:$PATH"; fi

check() {
  [[ "$(uname -s)" == "Darwin" ]] || { echo "Questo script deve essere eseguito su macOS." >&2; exit 2; }
  command -v node >/dev/null || { echo "Node non trovato: esegui prima scripts/macos/install.sh" >&2; exit 3; }
  command -v cargo >/dev/null || { echo "Cargo non trovato: esegui prima scripts/macos/install.sh" >&2; exit 3; }
  xcode-select -p >/dev/null 2>&1 || { echo "Xcode Command Line Tools non disponibili." >&2; exit 3; }
  node tools/verify_node_dependencies.cjs || { echo "Dipendenze npm incomplete: esegui prima scripts/macos/install.sh" >&2; exit 3; }
  node tools/verify_brand_assets.cjs
}

if [[ "${1:-}" == "--check" ]]; then check; echo "Packaging macOS pronto. Nessuna compilazione avviata."; exit 0; fi
if [[ "${1:-}" == "--dry-run" ]]; then echo "[dry-run] npm exec --workspace @rbs/desktop tauri -- build --bundles dmg"; exit 0; fi

check
echo "Compilazione MLSM Studio per macOS (DMG)…"
# Il bundler DMG tenta AppleScript/Finder per il layout grafico. In una shell non
# interattiva (CI, Terminale senza Finder disponibile) quel passo può fallire pur
# avendo compilato l'app correttamente: CI=true mantiene il DMG installabile.
if [[ -n "${APPLE_CERTIFICATE:-}" || -n "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  # Con credenziali reali lascia che Tauri scelga il certificato Apple e notarizzi.
  if [[ "${MLSM_DMG_PRETTY:-0}" == "1" ]]; then
    npm exec --workspace @rbs/desktop tauri -- build --bundles dmg
  else
    CI=true npm exec --workspace @rbs/desktop tauri -- build --bundles dmg
  fi
else
  # Senza certificato, firma ad-hoc valida per installazione e test locali.
  if [[ "${MLSM_DMG_PRETTY:-0}" == "1" ]]; then
    npm exec --workspace @rbs/desktop tauri -- build --bundles dmg --config '{"bundle":{"macOS":{"signingIdentity":"-"}}}'
  else
    CI=true npm exec --workspace @rbs/desktop tauri -- build --bundles dmg --config '{"bundle":{"macOS":{"signingIdentity":"-"}}}'
  fi
fi
echo "DMG creato in apps/desktop/src-tauri/target/release/bundle/dmg/"
