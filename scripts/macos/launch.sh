#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT_DIR"
if [[ -d /opt/homebrew/opt/node@22/bin ]]; then export PATH="/opt/homebrew/opt/node@22/bin:$PATH"; fi
if [[ -d /usr/local/opt/node@22/bin ]]; then export PATH="/usr/local/opt/node@22/bin:$PATH"; fi

if [[ "${1:-}" == "--check" ]]; then
  command -v node >/dev/null
  command -v npm >/dev/null
  node -e 'const [M,m]=process.versions.node.split(".").map(Number); if(M<22||(M===22&&m<12)) process.exit(1)'
  test -f package-lock.json
  node tools/prepare_node_workspace.cjs --check
  echo "Launcher macOS pronto. Nessun server avviato."
  exit 0
fi

if [[ "$(uname -s)" != "Darwin" ]]; then echo "Su Windows usa scripts\\windows\\launch.bat." >&2; exit 2; fi
node tools/prepare_node_workspace.cjs || { echo "Aggiornamento dipendenze/build non riuscito. Controlla l'errore precedente." >&2; exit 3; }

echo "Avvio MLSM Studio su http://localhost:1421"
echo "Per arrestare applicazione e servizi premi Ctrl+C."
exec npm run dev --workspace @rbs/desktop -- --port 1421
