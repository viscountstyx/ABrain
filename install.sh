#!/usr/bin/env bash
# install.sh — Register ABrain in the KDE application launcher.
#
# What it does:
#   1. Makes run.sh executable
#   2. Copies the SVG icon to ~/.local/share/icons/hicolor/scalable/apps/
#   3. Writes a .desktop file to ~/.local/share/applications/ with the
#      correct absolute Exec= and Icon= paths for this machine
#   4. Runs update-desktop-database to refresh the launcher index
#
# To uninstall, run:  ./install.sh --uninstall

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="abrain"
DESKTOP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/scalable/apps"

uninstall() {
  rm -f "$DESKTOP_DIR/$APP_NAME.desktop"
  rm -f "$ICON_DIR/$APP_NAME.svg"
  update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
  echo "ABrain removed from application launcher."
  exit 0
}

[[ "${1:-}" == "--uninstall" ]] && uninstall

# ── Preflight ──────────────────────────────────────────────────────────

if [[ ! -f "$SCRIPT_DIR/.venv/bin/python" ]]; then
  echo "ERROR: virtualenv not found at $SCRIPT_DIR/.venv"
  echo "Run this first:"
  echo "  python -m venv .venv && .venv/bin/pip install 'pywebview[qt]' PySide6"
  exit 1
fi

# ── Make run.sh executable ─────────────────────────────────────────────
chmod +x "$SCRIPT_DIR/run.sh"

# ── Install icon ───────────────────────────────────────────────────────
mkdir -p "$ICON_DIR"
cp "$SCRIPT_DIR/ui/icons/abrain.svg" "$ICON_DIR/$APP_NAME.svg"

# ── Write .desktop file ────────────────────────────────────────────────
mkdir -p "$DESKTOP_DIR"
cat > "$DESKTOP_DIR/$APP_NAME.desktop" <<EOF
[Desktop Entry]
Name=ABrain
Comment=Mind map and brain-dump tool
Exec=$SCRIPT_DIR/run.sh
Icon=$APP_NAME
Terminal=false
Type=Application
Categories=Utility;Office;MindMapping;
Keywords=mindmap;notes;brain;ideas;
StartupNotify=true
EOF

# Mark it trusted (required by some KDE versions to show in launcher)
chmod +x "$DESKTOP_DIR/$APP_NAME.desktop"

# ── Refresh launcher database ──────────────────────────────────────────
if command -v update-desktop-database &>/dev/null; then
  update-desktop-database "$DESKTOP_DIR"
fi

echo "Done. ABrain has been added to the KDE application launcher."
echo "You can find it by searching 'ABrain' in KRunner (Alt+F2) or the app menu."
