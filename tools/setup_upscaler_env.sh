#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exec node tools/setup_python_runtime.cjs upscaler "$@"
