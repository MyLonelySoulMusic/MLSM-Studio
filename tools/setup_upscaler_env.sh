#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v pyenv >/dev/null 2>&1; then
  echo "pyenv non trovato. Installalo prima di preparare l'ambiente Upscaler." >&2
  exit 1
fi

python_version="$(tr -d '[:space:]' < .python-version)"
if ! pyenv prefix "$python_version" >/dev/null 2>&1; then
  echo "Installazione Python $python_version tramite pyenv…"
  pyenv install "$python_version"
fi

pyenv local "$python_version"
if [[ ! -x .venv/bin/python ]]; then
  echo "Creazione ambiente isolato .venv…"
  pyenv exec python -m venv .venv
fi

.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements-upscaler.txt

echo "Ambiente Upscaler pronto: $PWD/.venv"
