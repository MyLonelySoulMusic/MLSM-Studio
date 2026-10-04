#!/bin/bash
set -euo pipefail
CONTENTS_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
IFS= read -r MLSM_PROJECT_ROOT < "$CONTENTS_DIR/Resources/project-root.txt"
if [[ ! -f "$MLSM_PROJECT_ROOT/scripts/macos/launch.sh" ]]; then
  /usr/bin/osascript -e 'display alert "MLSM Studio" message "La cartella del progetto non e disponibile. / Project folder unavailable. Recreate the launcher with: node tools/create_branded_launchers.cjs" as critical'
  exit 2
fi
if [[ "${1:-}" == "--check" ]]; then
  [[ -s "$CONTENTS_DIR/Resources/MLSMStudio.icns" && -f "$CONTENTS_DIR/Resources/launch.applescript" ]]
  printf 'MLSM Studio launcher: ready. No server started.\n'
  exit 0
fi
exec /usr/bin/osascript "$CONTENTS_DIR/Resources/launch.applescript" "$MLSM_PROJECT_ROOT"
