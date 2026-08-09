#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "[AIQ_PROGRESS] 5|Verifica dell’ambiente Python"

python_version="$(tr -d '[:space:]' < .python-version)"
runtime_dir=".venv-ai-quantizer"

if command -v pyenv >/dev/null 2>&1; then
  if ! pyenv prefix "$python_version" >/dev/null 2>&1; then
    echo "[AIQ_PROGRESS] 10|Installazione di Python $python_version"
    echo "[AI Quantizer] installazione Python $python_version tramite pyenv…"
    pyenv install "$python_version"
  fi
  python_command=(pyenv exec python)
else
  echo "[AI Quantizer] pyenv non trovato: uso python3 disponibile nel sistema."
  python_command=(python3)
fi

if [[ ! -x "$runtime_dir/bin/python" ]]; then
  echo "[AIQ_PROGRESS] 18|Creazione dell’ambiente isolato .venv-ai-quantizer"
  echo "[AI Quantizer] creazione ambiente isolato ${runtime_dir}..."
  "${python_command[@]}" -m venv "$runtime_dir"
fi

echo "[AIQ_PROGRESS] 28|Aggiornamento di pip"
echo "[AI Quantizer] aggiornamento runtime Python…"
"$runtime_dir/bin/python" -m pip install --upgrade pip
echo "[AIQ_PROGRESS] 42|Installazione di Beat This, PyTorch e dipendenze audio"
"$runtime_dir/bin/python" -m pip install -r tools/ai-quantizer/requirements.txt

echo "[AIQ_PROGRESS] 92|Ambiente Python pronto, avvio del backend"
touch "$runtime_dir/.mlsm-aiq-ready"
echo "[AI Quantizer] runtime pronto. I modelli vengono scaricati e conservati al primo utilizzo."
