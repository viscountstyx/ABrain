#!/usr/bin/env bash
# run.sh — wrapper that activates the venv and launches ABrain.
# This is what the .desktop Exec= points to.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec "$SCRIPT_DIR/.venv/bin/python" "$SCRIPT_DIR/main.py" "$@"
